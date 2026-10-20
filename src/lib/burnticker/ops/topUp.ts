import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { base58Decode } from "@/lib/burnKeeper/keyfile";
import { Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction, type Connection } from "@solana/web3.js";
import type { Registry } from "@/lib/burnticker/registry";
import { takeOrThrow } from "@/lib/burnticker/apiBudget";
import { latestSnapshot } from "@/lib/burnticker/ops/snapshot";
import { confirmByPolling } from "@/lib/burnReceipts/crank";

/**
 * AUTOMATIC SOL TOP-UPS FOR THE OPERATIONS WALLETS (owner, 2026-10-19 night: "make sure any wallet that requires SOL will be
 * automatically topped off"; the night the Irys balance reached zero and the daily snapshot waited for a hand transfer).
 *
 * ONE WALLET IS FED BY HAND: the platform keeper's own key (BURNTICKER_SIGNER_PATH, public key BURNTICKER_KEEPER_PUBKEY). Every other
 * wallet that spends SOL for operations is refilled FROM it by the keeper, once per cycle, right after the snapshot step:
 *
 *   upload-payer-wallet  the SOL of BURNTICKER_UPLOAD_PAYER's own wallet (it pays the fee of every Irys funding transaction)
 *   irys-balance         the payer's PREFUNDED balance on the Irys node, which pays every Arweave pin (metadata, receipt art, the daily
 *                        snapshot). Only the payer can fund it, so it is two steps: keeper key to payer wallet (a plain System transfer,
 *                        simulated, sent, confirmed), then the payer funds Irys from its own wallet. If the first step lands and the
 *                        second fails, the SOL sits in the payer wallet and the next cycle sees it there: it retries the second step only.
 *   deficit-keeper       the $DEFICIT keeper's key (operator.json role "keeper" for this cluster; it pays $DEFICIT's reading rent and
 *                        crank fees from its own wallet). Public key only: this process never holds that key.
 *
 * Not targets, on purpose: the keeper key itself (the owner feeds it; when it cannot refill without breaking its own reserve it raises
 * bt-keeper-balance-low with the amount to send); the second reading signer (it signs messages on its own host and pays no fee); the
 * mint key bank (each creator pays the mint rent at launch); and the operator treasury, the developer fee wallet, the Squads vault and
 * every other wallet in operator.json. A top-up never sends to or from the treasury or the fee wallet, so the trust and transparency
 * pages are unaffected: the only flows are keeper key to an operations wallet, and the payer wallet to its own Irys balance.
 *
 * NO CAPS (owner decision 2026-10-19): a target below its floor is moved to its fill level, every cycle if necessary. What stays is
 * correctness: (1) the keeper key never gives away the SOL it needs for its own fees (its floor plus the day's expected fees); (2) a
 * transfer is the fill level minus the balance, so nothing is overfilled; (3) every transfer is simulated before it is sent and every
 * attempt is recorded in the append-only `top_ups` table; (4) two failures in a row for one target raise bt-top-up-failed; (5) a
 * Denver day whose top-ups exceed what 50 launches would cost is a line in ops.json and the daily summary, never a block. A transfer
 * whose confirmation did not come back is waited out (UNCONFIRMED_WAIT_MS) before that target is planned again, so a slow
 * confirmation cannot send twice.
 *
 * BURNTICKER_TOP_UP=off is the kill switch: the planner still runs and logs what it would do; nothing is sent. The planner is skipped
 * entirely on a read-only keeper (no signer, a dry run, a passive role) and on a non-mainnet keeper without an upload payer.
 *
 * `planTopUps` is pure. `runTopUps` reads the balances and prices, plans, executes and records. `irysPayerAccount` is the shared Irys
 * balance and price reader (the snapshot step's low-balance alert can import it).
 */

export const LAMPORTS_PER_SOL = BigInt(1_000_000_000);
const sol = (n: number): bigint => BigInt(Math.round(n * 1e9));
/** One signature's fee. */
export const TX_FEE_LAMPORTS = BigInt(5_000);
/** What the payer wallet keeps back for the Irys funding transaction's own fee. */
export const IRYS_FUND_FEE_LAMPORTS = BigInt(20_000);
/** A transfer whose confirmation did not come back holds its target this long (past a blockhash's life) before it is planned again. */
export const UNCONFIRMED_WAIT_MS = 3 * 60_000;
/** Rent of one Reading account the keeper key pays per coin per reading: (8 + 286 bytes + 128) × 6,960 lamports per byte. */
export const READING_RENT_LAMPORTS = BigInt(2_937_120);
/** The keeper key's floor (bt-keeper-balance-low below it; it refills nothing below it). */
export const SIGNER_FLOOR_LAMPORTS = sol(0.1);
/** What the owner is asked to bring the keeper key up to when it is short (plus whatever the targets need). */
export const SIGNER_REFILL_TO_LAMPORTS = sol(0.5);
/** Irys prices on 2026-10-19 (uploader.irys.xyz/price/solana/<bytes>), used when the live price cannot be read. */
export const REFERENCE_IRYS_PRICES = { metadata: BigInt(2_210), image: BigInt(56_561), snapshot: BigInt(2_698) } as const;
export const SNAPSHOT_FALLBACK_BYTES = 100_000;

export type TopUpTarget = "upload-payer-wallet" | "irys-balance" | "deficit-keeper";
export const TARGET_LABEL: Record<TopUpTarget, string> = { "upload-payer-wallet": "the upload wallet", "irys-balance": "the Irys upload balance", "deficit-keeper": "the $DEFICIT keeper key" };

export interface TopUpConfig {
  signer: { floorLamports: bigint; refillToLamports: bigint; feesPerCoinPerDayLamports: bigint; baseFeesPerDayLamports: bigint };
  uploadPayerWallet: { enabled: boolean; floorLamports: bigint; fillLamports: bigint };
  irys: { enabled: boolean; floorDays: number; fillDays: number; minLamports: bigint; maxLamports: bigint; metadataBytes: number; imageBytes: number };
  deficitKeeper: { enabled: boolean; operatorRole: string; floorLamports: bigint; fillLamports: bigint };
  /** The informational line: a day's top-ups above what this many launches would cost. */
  noticeLaunchesPerDay: number;
}
export const DEFAULT_TOP_UP_CONFIG: TopUpConfig = {
  signer: { floorLamports: SIGNER_FLOOR_LAMPORTS, refillToLamports: SIGNER_REFILL_TO_LAMPORTS, feesPerCoinPerDayLamports: READING_RENT_LAMPORTS + BigInt(2) * TX_FEE_LAMPORTS, baseFeesPerDayLamports: sol(0.002) },
  uploadPayerWallet: { enabled: true, floorLamports: sol(0.01), fillLamports: sol(0.03) },
  irys: { enabled: true, floorDays: 7, fillDays: 30, minLamports: sol(0.005), maxLamports: sol(0.05), metadataBytes: 4_096, imageBytes: 2 * 1024 * 1024 },
  deficitKeeper: { enabled: true, operatorRole: "keeper", floorLamports: sol(0.03), fillLamports: sol(0.06) },
  noticeLaunchesPerDay: 50,
};
export const TOP_UP_CONFIG_FILE = path.join("config", "burnticker", "top-up.json");

/** config/burnticker/top-up.json over the defaults (amounts in lamports as integers or strings; keys starting "_" are comments). */
export function loadTopUpConfig(root: string = process.cwd()): TopUpConfig {
  const file = path.join(root, TOP_UP_CONFIG_FILE);
  if (!fs.existsSync(file)) return DEFAULT_TOP_UP_CONFIG;
  return parseTopUpConfig(JSON.parse(fs.readFileSync(file, "utf8")));
}
export function parseTopUpConfig(raw: unknown): TopUpConfig {
  const d = DEFAULT_TOP_UP_CONFIG;
  const o = (raw ?? {}) as Record<string, Record<string, unknown> | number | undefined>;
  const sec = (k: string): Record<string, unknown> => (typeof o[k] === "object" && o[k] ? o[k] as Record<string, unknown> : {});
  const lam = (s: Record<string, unknown>, k: string, dflt: bigint): bigint => {
    const v = s[k];
    if (v === undefined) return dflt;
    if ((typeof v !== "number" && typeof v !== "string") || !/^\d+$/.test(String(v))) throw new Error(`top-up.json: ${k} must be a whole number of lamports`);
    return BigInt(String(v));
  };
  const num = (s: Record<string, unknown>, k: string, dflt: number): number => { const v = s[k]; if (v === undefined) return dflt; if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) throw new Error(`top-up.json: ${k} must be a positive number`); return v; };
  const bool = (s: Record<string, unknown>, k: string, dflt: boolean): boolean => (typeof s[k] === "boolean" ? s[k] as boolean : dflt);
  const s = sec("signer"), w = sec("uploadPayerWallet"), i = sec("irys"), k = sec("deficitKeeper");
  const c: TopUpConfig = {
    signer: { floorLamports: lam(s, "floorLamports", d.signer.floorLamports), refillToLamports: lam(s, "refillToLamports", d.signer.refillToLamports), feesPerCoinPerDayLamports: lam(s, "feesPerCoinPerDayLamports", d.signer.feesPerCoinPerDayLamports), baseFeesPerDayLamports: lam(s, "baseFeesPerDayLamports", d.signer.baseFeesPerDayLamports) },
    uploadPayerWallet: { enabled: bool(w, "enabled", true), floorLamports: lam(w, "floorLamports", d.uploadPayerWallet.floorLamports), fillLamports: lam(w, "fillLamports", d.uploadPayerWallet.fillLamports) },
    irys: { enabled: bool(i, "enabled", true), floorDays: num(i, "floorDays", d.irys.floorDays), fillDays: num(i, "fillDays", d.irys.fillDays), minLamports: lam(i, "minLamports", d.irys.minLamports), maxLamports: lam(i, "maxLamports", d.irys.maxLamports), metadataBytes: num(i, "metadataBytes", d.irys.metadataBytes), imageBytes: num(i, "imageBytes", d.irys.imageBytes) },
    deficitKeeper: { enabled: bool(k, "enabled", true), operatorRole: typeof k.operatorRole === "string" ? k.operatorRole : d.deficitKeeper.operatorRole, floorLamports: lam(k, "floorLamports", d.deficitKeeper.floorLamports), fillLamports: lam(k, "fillLamports", d.deficitKeeper.fillLamports) },
    noticeLaunchesPerDay: typeof o.noticeLaunchesPerDay === "number" && o.noticeLaunchesPerDay > 0 ? o.noticeLaunchesPerDay : d.noticeLaunchesPerDay,
  };
  if (c.signer.refillToLamports <= c.signer.floorLamports) throw new Error("top-up.json: signer.refillToLamports must be above signer.floorLamports");
  if (c.uploadPayerWallet.fillLamports <= c.uploadPayerWallet.floorLamports) throw new Error("top-up.json: uploadPayerWallet.fillLamports must be above its floorLamports");
  if (c.deficitKeeper.fillLamports <= c.deficitKeeper.floorLamports) throw new Error("top-up.json: deficitKeeper.fillLamports must be above its floorLamports");
  if (c.irys.maxLamports < c.irys.minLamports) throw new Error("top-up.json: irys.maxLamports must be at least irys.minLamports");
  return c;
}

// ---- the ledger (append-only, in the registry file; created on first use) ----

export type TopUpStatus = "sent" | "unconfirmed" | "failed";
export type TopUpKind = "transfer" | "irys-fund";
export interface TopUpRow { id: number; at: number; day: string; target: TopUpTarget; kind: TopUpKind; from: string; to: string; lamports: bigint; status: TopUpStatus; signature: string | null; reason: string; error: string | null }

const TOP_UPS_DDL = `
CREATE TABLE IF NOT EXISTS top_ups (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, day TEXT NOT NULL, target TEXT NOT NULL, kind TEXT NOT NULL, from_addr TEXT NOT NULL, to_addr TEXT NOT NULL, lamports TEXT NOT NULL, status TEXT NOT NULL, signature TEXT, reason TEXT NOT NULL, error TEXT);
CREATE INDEX IF NOT EXISTS top_ups_by_at ON top_ups (at);
CREATE TRIGGER IF NOT EXISTS top_ups_no_update BEFORE UPDATE ON top_ups BEGIN SELECT RAISE(ABORT, 'top_ups: append-only'); END;
CREATE TRIGGER IF NOT EXISTS top_ups_no_delete BEFORE DELETE ON top_ups BEGIN SELECT RAISE(ABORT, 'top_ups: append-only'); END;
`;
const ensured = new WeakSet<object>();
export function ensureTopUpsTable(db: DatabaseSync): void { if (ensured.has(db)) return; db.exec(TOP_UPS_DDL); ensured.add(db); }

const DENVER_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit" });
export const denverDay = (ms: number): string => DENVER_DAY.format(new Date(ms));

export function recordTopUp(db: DatabaseSync, r: Omit<TopUpRow, "id" | "day">): TopUpRow {
  ensureTopUpsTable(db);
  const res = db.prepare("INSERT INTO top_ups (at, day, target, kind, from_addr, to_addr, lamports, status, signature, reason, error) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
    .run(r.at, denverDay(r.at), r.target, r.kind, r.from, r.to, r.lamports.toString(), r.status, r.signature, r.reason, r.error);
  return { ...r, id: Number(res.lastInsertRowid), day: denverDay(r.at) };
}
/** Rows at or after `sinceMs`, oldest first. */
export function topUpRowsSince(db: DatabaseSync, sinceMs: number): TopUpRow[] {
  // a reader never creates the table (the check-in opens the registry too); no table yet = no rows
  if (!ensured.has(db) && !db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='top_ups'").get()) return [];
  return (db.prepare("SELECT * FROM top_ups WHERE at >= ? ORDER BY at, id").all(sinceMs) as Record<string, unknown>[]).map((x) => ({
    id: Number(x.id), at: Number(x.at), day: String(x.day), target: String(x.target) as TopUpTarget, kind: String(x.kind) as TopUpKind, from: String(x.from_addr), to: String(x.to_addr),
    lamports: BigInt(String(x.lamports)), status: String(x.status) as TopUpStatus, signature: x.signature == null ? null : String(x.signature), reason: String(x.reason), error: x.error == null ? null : String(x.error),
  }));
}

// ---- the planner (pure) ----

export interface IrysPrices { metadata: bigint; image: bigint; snapshot: bigint }
export interface TopUpInput {
  now: number;
  config: TopUpConfig;
  signer: { address: string; lamports: bigint };
  /** null: no upload payer configured (both payer targets are skipped). irysLamports null: the Irys balance could not be read. */
  payer: { address: string; walletLamports: bigint; irysLamports: bigint | null } | null;
  /** null: the live prices could not be read (the reference prices stand in for the sizing). */
  irysPrices: IrysPrices | null;
  /** Launches pinned in the last 7 days (each pins a metadata JSON and an image). */
  launchesLast7d: number;
  /** Live coins: the keeper key pays one reading's rent and fees per coin per day. */
  liveCoins: number;
  /** null: not resolved for this cluster, or not readable. */
  deficitKeeper: { address: string; lamports: bigint } | null;
  /** Ledger rows of at least the last 8 days (the Denver day, the unconfirmed wait, the failure streaks, the 7-day average). */
  ledger: TopUpRow[];
}
export interface PlannedStep { target: TopUpTarget; kind: TopUpKind; from: string; to: string; lamports: bigint; reason: string; /** index of the step this one waits on (the Irys two-step) */ after: number | null }
export interface TargetLevel { target: TopUpTarget; address: string | null; balance: bigint | null; floor: bigint; fill: bigint }
export interface TopUpPlan {
  steps: PlannedStep[];
  refused: { target: TopUpTarget; reason: string }[];
  levels: TargetLevel[];
  signer: { address: string; lamports: bigint; floor: bigint; reserve: bigint; expectedFeesPerDay: bigint };
  /** When the keeper key is short: what the owner should send and the alert text. */
  signerShort: { sendLamports: bigint; text: string } | null;
  today: { day: string; count: number; signerLamports: bigint };
  /** What `noticeLaunchesPerDay` launches plus 30 days of snapshots would cost (the informational line's mark). */
  noticeMarkLamports: bigint;
  overNotice: boolean;
  /** (keeper key − floor) ÷ (its daily fees + the 7-day average of top-ups); null when nothing is spent. */
  signerDays: number | null;
}

const maxB = (a: bigint, b: bigint): bigint => (a > b ? a : b);
const minB = (a: bigint, b: bigint): bigint => (a < b ? a : b);
const clampB = (v: bigint, lo: bigint, hi: bigint): bigint => minB(hi, maxB(lo, v));
export const solText = (l: bigint, dp = 4): string => (Number(l) / 1e9).toFixed(dp);
/** Rounded up to the next 0.01 SOL. */
const roundUpCent = (l: bigint): bigint => { const c = BigInt(10_000_000); return l <= BigInt(0) ? BigInt(0) : ((l + c - BigInt(1)) / c) * c; };

/** One launch's Arweave pins (metadata JSON + image) plus the keeper key's first reading for the coin. */
export function perLaunchLamports(prices: IrysPrices, cfg: TopUpConfig = DEFAULT_TOP_UP_CONFIG): bigint { return prices.metadata + prices.image + cfg.signer.feesPerCoinPerDayLamports; }
/** The informational mark: `noticeLaunchesPerDay` launches plus 30 days of snapshots. At the reference prices: 50 × 3,005,891 + 30 × 2,698 = 150,375,490 lamports. */
export function noticeMarkLamports(prices: IrysPrices, cfg: TopUpConfig = DEFAULT_TOP_UP_CONFIG): bigint { return BigInt(cfg.noticeLaunchesPerDay) * perLaunchLamports(prices, cfg) + BigInt(30) * prices.snapshot; }

/** The Irys floor and fill: `floorDays` of snapshots plus the last 7 days' launch pins (fill: `fillDays`), inside [min, max]. */
export function irysLevels(prices: IrysPrices, launchesLast7d: number, cfg: TopUpConfig["irys"]): { floor: bigint; fill: bigint } {
  const pinsPerLaunch = prices.metadata + prices.image;
  const perDay7 = (BigInt(Math.max(0, Math.round(launchesLast7d))) * pinsPerLaunch) / BigInt(7);
  const need = (days: number): bigint => BigInt(Math.ceil(days)) * (prices.snapshot + perDay7);
  const floor = clampB(need(cfg.floorDays), cfg.minLamports, cfg.maxLamports);
  let fill = clampB(need(cfg.fillDays), cfg.minLamports, cfg.maxLamports);
  if (fill <= floor) fill = minB(cfg.maxLamports, floor * BigInt(2));
  return { floor, fill };
}

/** What the owner is asked to send to the keeper key: up to its refill level, plus whatever the targets need right now. */
export function signerSendLamports(balance: bigint, needed = BigInt(0), cfg: TopUpConfig = DEFAULT_TOP_UP_CONFIG): bigint {
  return roundUpCent(maxB(BigInt(0), cfg.signer.refillToLamports + needed - balance));
}

export function planTopUps(i: TopUpInput): TopUpPlan {
  const cfg = i.config;
  const prices = i.irysPrices ?? { ...REFERENCE_IRYS_PRICES };
  const steps: PlannedStep[] = [], refused: TopUpPlan["refused"] = [], levels: TargetLevel[] = [];
  const expectedFeesPerDay = cfg.signer.baseFeesPerDayLamports + BigInt(Math.max(0, i.liveCoins)) * cfg.signer.feesPerCoinPerDayLamports;
  const reserve = cfg.signer.floorLamports + expectedFeesPerDay;
  const day = denverDay(i.now);
  const fromSigner = (r: TopUpRow) => r.kind === "transfer" && r.status !== "failed";
  const todayRows = i.ledger.filter((r) => r.day === day && r.status !== "failed");
  const today = { day, count: todayRows.length, signerLamports: todayRows.filter(fromSigner).reduce((a, r) => a + r.lamports, BigInt(0)) };
  const pendingFor = (t: TopUpTarget): TopUpRow | undefined => i.ledger.find((r) => r.target === t && r.status === "unconfirmed" && i.now - r.at < UNCONFIRMED_WAIT_MS);

  // What each target needs, in the order they are funded.
  type Want = { target: TopUpTarget; to: string; lamports: bigint; reason: string; irysFund?: bigint };
  const wants: Want[] = [];
  if (i.payer && cfg.uploadPayerWallet.enabled) {
    const w = cfg.uploadPayerWallet;
    levels.push({ target: "upload-payer-wallet", address: i.payer.address, balance: i.payer.walletLamports, floor: w.floorLamports, fill: w.fillLamports });
    if (i.payer.walletLamports < w.floorLamports) {
      if (pendingFor("upload-payer-wallet")) refused.push({ target: "upload-payer-wallet", reason: "an earlier transfer to it has not confirmed yet; waiting for it to settle" });
      else wants.push({ target: "upload-payer-wallet", to: i.payer.address, lamports: w.fillLamports - i.payer.walletLamports, reason: `the upload wallet holds ${solText(i.payer.walletLamports)} SOL, below its ${solText(w.floorLamports)} SOL floor; filled to ${solText(w.fillLamports)} SOL` });
    }
  }
  if (i.payer && cfg.irys.enabled) {
    const lv = irysLevels(prices, i.launchesLast7d, cfg.irys);
    levels.push({ target: "irys-balance", address: i.payer.address, balance: i.payer.irysLamports, floor: lv.floor, fill: lv.fill });
    if (i.payer.irysLamports === null) refused.push({ target: "irys-balance", reason: "the Irys balance could not be read this cycle" });
    else if (i.payer.irysLamports < lv.floor) {
      if (pendingFor("irys-balance")) refused.push({ target: "irys-balance", reason: "an earlier transfer for it has not confirmed yet; waiting for it to settle" });
      else {
        const fund = lv.fill - i.payer.irysLamports;
        const reason = `the Irys balance holds ${solText(i.payer.irysLamports)} SOL, below its ${solText(lv.floor)} SOL floor (${cfg.irys.floorDays} days of snapshots and launch pins); filled to ${solText(lv.fill)} SOL`;
        // The payer wallet keeps its floor and the funding fee; only SOL above that funds Irys directly (the wallet's own top-up, if
        // any, is planned on top and is not counted here, so a refused wallet top-up never leaves the funding step short).
        const spare = i.payer.walletLamports - (cfg.uploadPayerWallet.enabled ? cfg.uploadPayerWallet.floorLamports : BigInt(0)) - IRYS_FUND_FEE_LAMPORTS;
        wants.push({ target: "irys-balance", to: i.payer.address, lamports: spare >= fund ? BigInt(0) : fund - maxB(-IRYS_FUND_FEE_LAMPORTS, spare), reason, irysFund: fund });
      }
    }
  }
  if (cfg.deficitKeeper.enabled && i.deficitKeeper && i.deficitKeeper.address !== i.signer.address) {
    const k = cfg.deficitKeeper, b = i.deficitKeeper.lamports;
    levels.push({ target: "deficit-keeper", address: i.deficitKeeper.address, balance: b, floor: k.floorLamports, fill: k.fillLamports });
    if (b < k.floorLamports) {
      if (pendingFor("deficit-keeper")) refused.push({ target: "deficit-keeper", reason: "an earlier transfer to it has not confirmed yet; waiting for it to settle" });
      else wants.push({ target: "deficit-keeper", to: i.deficitKeeper.address, lamports: k.fillLamports - b, reason: `the $DEFICIT keeper key holds ${solText(b)} SOL, below its ${solText(k.floorLamports)} SOL floor; filled to ${solText(k.fillLamports)} SOL` });
    }
  }

  // The keeper key's reserve: below its floor it refills nothing; otherwise each transfer must leave the reserve and its own fee.
  let available = i.signer.lamports - reserve;
  const short: bigint[] = [];
  const signerBelowFloor = i.signer.lamports < cfg.signer.floorLamports;
  for (const w of wants) {
    const cost = w.lamports > BigInt(0) ? w.lamports + TX_FEE_LAMPORTS : BigInt(0);
    if (signerBelowFloor && cost > BigInt(0)) { refused.push({ target: w.target, reason: `the keeper key holds ${solText(i.signer.lamports)} SOL, below its own ${solText(cfg.signer.floorLamports)} SOL floor; it needs the owner first` }); short.push(cost); continue; }
    if (cost > BigInt(0) && cost > available) { refused.push({ target: w.target, reason: `the transfer of ${solText(w.lamports)} SOL would take the keeper key under its reserve of ${solText(reserve)} SOL (its floor plus the day's expected fees)` }); short.push(cost); continue; }
    available -= cost;
    let after: number | null = null;
    if (w.lamports > BigInt(0)) { steps.push({ target: w.target, kind: "transfer", from: i.signer.address, to: w.to, lamports: w.lamports, reason: w.reason, after: null }); after = steps.length - 1; }
    if (w.irysFund !== undefined) steps.push({ target: "irys-balance", kind: "irys-fund", from: w.to, to: "irys", lamports: w.irysFund, reason: w.reason, after: w.target === "irys-balance" ? after : null });
  }

  let signerShort: TopUpPlan["signerShort"] = null;
  if (signerBelowFloor || short.length) {
    const needed = short.reduce((a, b) => a + b, BigInt(0));
    const send = signerSendLamports(i.signer.lamports, needed + expectedFeesPerDay, cfg);
    signerShort = { sendLamports: send, text: `Burnticker keeper key holds ${solText(i.signer.lamports)} SOL${signerBelowFloor ? `, below its ${solText(cfg.signer.floorLamports)} SOL floor` : ", too little to refill the other wallets without breaking its own reserve"}. Send about ${solText(send, 2)} SOL to ${i.signer.address}. ${signerBelowFloor ? "Until then it refills no other wallet." : `Until then ${short.length} ${short.length === 1 ? "wallet waits" : "wallets wait"}.`}` };
  }

  const weekRows = i.ledger.filter((r) => fromSigner(r) && i.now - r.at < 7 * 86_400_000);
  const avgTopUpsPerDay = weekRows.reduce((a, r) => a + r.lamports, BigInt(0)) / BigInt(7);
  const burn = expectedFeesPerDay + avgTopUpsPerDay;
  const signerDays = burn > BigInt(0) ? Math.max(0, Number(i.signer.lamports - cfg.signer.floorLamports) / Number(burn)) : null;
  const mark = noticeMarkLamports(prices, cfg);
  return { steps, refused, levels, signer: { address: i.signer.address, lamports: i.signer.lamports, floor: cfg.signer.floorLamports, reserve, expectedFeesPerDay }, signerShort, today, noticeMarkLamports: mark, overNotice: today.signerLamports > mark, signerDays };
}

// ---- the readers and the executor ----

/** The upload payer's public key from BURNTICKER_UPLOAD_PAYER (a base58 secret key); null when unset or unreadable. Never logs the key. */
export function uploadPayerAddress(env: Readonly<Record<string, string | undefined>>): string | null {
  const k = (env.BURNTICKER_UPLOAD_PAYER ?? "").trim();
  if (!k) return null;
  try { return Keypair.fromSecretKey(base58Decode(k)).publicKey.toBase58(); } catch { return null; }
}

/** The payer's Irys account: its balance on the node, the price of an upload, and `fund` (signed by the payer). */
export interface IrysPayerAccount { address: string; balance(): Promise<bigint>; price(bytes: number): Promise<bigint>; fund(lamports: bigint): Promise<{ id: string }> }
/**
 * The shared Irys reader (the snapshot step's low-balance alert can import it): null when BURNTICKER_UPLOAD_PAYER is unset. Mainnet
 * goes through the keyed RPC (BURNTICKER_RPC_URL); elsewhere Irys devnet. Every call takes one unit of the "irys" request budget.
 */
export async function irysPayerAccount(env: Readonly<Record<string, string | undefined>>, cluster: string): Promise<IrysPayerAccount | null> {
  const key = (env.BURNTICKER_UPLOAD_PAYER ?? "").trim();
  if (!key) return null;
  type Client = { address: string; getBalance(): Promise<{ toString(): string }>; getPrice(n: number): Promise<{ toString(): string }>; fund(n: bigint | number | string): Promise<{ id: string }> };
  type Chain = { withWallet(k: string): Chain; withRpc(u: string): Chain; devnet(): Chain; mainnet(): Chain; then: Promise<Client>["then"] };
  const pkgA = "@irys/upload", pkgB = "@irys/upload-solana";
  const { Uploader } = (await import(/* webpackIgnore: true */ pkgA)) as { Uploader: (c: unknown) => Chain };
  const { Solana } = (await import(/* webpackIgnore: true */ pkgB)) as { Solana: unknown };
  const rpc = (env.BURNTICKER_RPC_URL ?? "").trim();
  let chain = Uploader(Solana).withWallet(key);
  if (cluster === "mainnet") { if (rpc) chain = chain.withRpc(rpc); chain = chain.mainnet(); }
  else chain = chain.withRpc(rpc || "https://api.devnet.solana.com").devnet();
  const c = await chain;
  const big = (v: { toString(): string }) => BigInt(v.toString().split(".")[0]);
  return {
    address: c.address,
    balance: async () => { await takeOrThrow("irys"); return big(await c.getBalance()); },
    price: async (bytes) => { await takeOrThrow("irys"); return big(await c.getPrice(bytes)); },
    fund: async (lamports) => { await takeOrThrow("irys"); const r = await c.fund(lamports.toString()); return { id: String(r.id) }; },
  };
}

export type TransferOutcome = { status: "sent"; signature: string } | { status: "unconfirmed"; signature: string; error: string } | { status: "failed"; signature: string | null; error: string };
export type TransferFn = (to: string, lamports: bigint) => Promise<TransferOutcome>;
/** A System transfer from the keeper key: simulated first (a failed simulation sends nothing), then sent and confirmed. */
export function connectionTransfer(conn: Connection, signer: Keypair): TransferFn {
  return async (to, lamports) => {
    let signature: string | null = null;
    try {
      const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
      const msg = new TransactionMessage({ payerKey: signer.publicKey, recentBlockhash: blockhash, instructions: [SystemProgram.transfer({ fromPubkey: signer.publicKey, toPubkey: new PublicKey(to), lamports })] }).compileToV0Message();
      const tx = new VersionedTransaction(msg);
      tx.sign([signer]);
      const sim = await conn.simulateTransaction(tx, { sigVerify: true, commitment: "confirmed" });
      if (sim.value.err) return { status: "failed", signature: null, error: `the simulation failed, nothing was sent: ${JSON.stringify(sim.value.err).slice(0, 160)}` };
      signature = await conn.sendTransaction(tx, { skipPreflight: true, maxRetries: 3 });
      // the keeper's own confirmation (polling, no websocket subscription; crank.ts)
      const err = await confirmByPolling(conn, signature, lastValidBlockHeight);
      if (err) return { status: "failed", signature, error: `the transaction failed on chain: ${JSON.stringify(err).slice(0, 160)}` };
      return { status: "sent", signature };
    } catch (e) {
      const error = (e as Error).message.slice(0, 200);
      // a blockhash that expired before the transaction was seen means it can no longer land: failed, not unconfirmed
      if (signature && /expired unconfirmed/.test(error)) return { status: "failed", signature, error };
      return signature ? { status: "unconfirmed", signature, error } : { status: "failed", signature: null, error };
    }
  };
}

export type TopUpMode = "on" | "off";
export const topUpModeFromEnv = (env: Readonly<Record<string, string | undefined>>): TopUpMode => (/^(off|0|false|no)$/i.test((env.BURNTICKER_TOP_UP ?? "").trim()) ? "off" : "on");

/** The $DEFICIT keeper's public key for this cluster from config/burnticker/operator.json (role from the config); null when absent. */
export function deficitKeeperAddress(cluster: string, role: string, root: string = process.cwd()): string | null {
  try {
    const op = JSON.parse(fs.readFileSync(path.join(root, "config", "burnticker", "operator.json"), "utf8")) as { clusters?: Record<string, { wallets?: { role: string; pubkey: string }[] }> };
    const w = op.clusters?.[cluster]?.wallets?.find((x) => x.role === role);
    return w && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(w.pubkey) ? w.pubkey : null;
  } catch { return null; }
}

/** Launches whose metadata was pinned (not hosted) since `sinceMs`. */
export function launchesSince(db: DatabaseSync, sinceMs: number): number {
  try { return Number((db.prepare("SELECT COUNT(*) AS n FROM token_meta WHERE hosted=0 AND created_at >= ?").get(sinceMs) as { n: number }).n); } catch { return 0; }
}

export interface TopUpDeps {
  signerAddress: string;
  readLamports(address: string): Promise<bigint>;
  transfer: TransferFn;
  /** null: no upload payer. */
  irys: IrysPayerAccount | null;
  /** The $DEFICIT keeper's address, or null. */
  deficitKeeper: string | null;
}
export interface TopUpRunResult { plan: TopUpPlan; mode: TopUpMode; done: TopUpRow[]; skipped: string[] }
export const TOP_UP_STATUS_KEY = "ops.topUp.last";
export const TOP_UP_ALERT = "bt-top-up";
export const TOP_UP_FAILED_ALERT = "bt-top-up-failed";
type Alert = (kind: string, key: string, text: string, meta: Record<string, unknown> | null) => Promise<unknown> | unknown;

/**
 * Reads everything the planner needs: the balances (keeper key, upload wallet, Irys, the $DEFICIT keeper key), the live Irys prices,
 * the launches of the last 7 days and the ledger. Reads only (the operator's --plan uses it on a read-only registry). Throws when a
 * wallet balance does not read; a missing Irys balance or price is logged and left null.
 */
export async function readTopUpInput(o: { db: DatabaseSync; liveCoins: number; config: TopUpConfig; deps: TopUpDeps; now: number; log: (s: string) => void }): Promise<TopUpInput> {
  const { deps, now, log } = o;
  const signerLamports = await deps.readLamports(deps.signerAddress);
  let payer: TopUpInput["payer"] = null, prices: IrysPrices | null = null;
  if (deps.irys) {
    const wallet = await deps.readLamports(deps.irys.address);
    let irysLamports: bigint | null = null;
    try { irysLamports = await deps.irys.balance(); } catch (e) { log(`  [top-up] the Irys balance did not read: ${(e as Error).message.slice(0, 160)}`); }
    let snapBytes = SNAPSHOT_FALLBACK_BYTES;
    try { if (o.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='snapshots'").get()) snapBytes = latestSnapshot({ db: o.db })?.bytes ?? SNAPSHOT_FALLBACK_BYTES; } catch { snapBytes = SNAPSHOT_FALLBACK_BYTES; }
    try { prices = { metadata: await deps.irys.price(o.config.irys.metadataBytes), image: await deps.irys.price(o.config.irys.imageBytes), snapshot: await deps.irys.price(snapBytes) }; }
    catch (e) { log(`  [top-up] Irys prices did not read, the reference prices stand in: ${(e as Error).message.slice(0, 160)}`); }
    payer = { address: deps.irys.address, walletLamports: wallet, irysLamports };
  }
  const deficitKeeper = deps.deficitKeeper ? { address: deps.deficitKeeper, lamports: await deps.readLamports(deps.deficitKeeper) } : null;
  return { now, config: o.config, signer: { address: deps.signerAddress, lamports: signerLamports }, payer, irysPrices: prices, launchesLast7d: launchesSince(o.db, now - 7 * 86_400_000), liveCoins: o.liveCoins, deficitKeeper, ledger: topUpRowsSince(o.db, now - 8 * 86_400_000) };
}

/** Reads, plans, executes (unless the mode is off) and records. Never throws: a failed read is logged and the cycle goes on. */
export async function runTopUps(o: { registry: Pick<Registry, "db" | "setStatus" | "tokens">; config: TopUpConfig; deps: TopUpDeps; mode: TopUpMode; now: number; log: (s: string) => void; alert?: Alert | null }): Promise<TopUpRunResult | null> {
  const { registry: reg, deps, now, log } = o;
  let input: TopUpInput;
  try { input = await readTopUpInput({ db: reg.db, liveCoins: reg.tokens("live").length, config: o.config, deps, now, log }); }
  catch (e) { log(`  [top-up] balances did not read, nothing planned this cycle: ${(e as Error).message.slice(0, 160)}`); return null; }

  const plan = planTopUps(input);
  const done: TopUpRow[] = [], skipped: string[] = [];
  for (const r of plan.refused) log(`  [top-up] ${r.target} not refilled: ${r.reason}`);
  if (plan.signerShort) { log(`  [top-up] ${plan.signerShort.text}`); await safeAlert(o.alert, "bt-keeper-balance-low", `bt-keeper-balance-low:${denverDay(now)}`, plan.signerShort.text, { lamports: plan.signer.lamports.toString(), sendLamports: plan.signerShort.sendLamports.toString() }); }
  const outcomes: (TopUpStatus | null)[] = [];
  for (const s of plan.steps) {
    if (o.mode === "off") { log(`  [top-up] off (BURNTICKER_TOP_UP=off), would ${describeStep(s)}`); skipped.push(describeStep(s)); outcomes.push(null); continue; }
    if (s.after !== null && outcomes[s.after] !== "sent") { const why = `${describeStep(s)} waits: its transfer to the payer wallet did not confirm this cycle`; log(`  [top-up] ${why}`); skipped.push(why); outcomes.push(null); continue; }
    let row: TopUpRow;
    if (s.kind === "transfer") {
      const r = await deps.transfer(s.to, s.lamports);
      row = recordTopUp(reg.db, { at: now, target: s.target, kind: s.kind, from: s.from, to: s.to, lamports: s.lamports, status: r.status, signature: r.signature, reason: s.reason, error: r.status === "sent" ? null : r.error });
    } else {
      let before: bigint | null = null;
      try {
        if (!deps.irys) throw new Error("no upload payer");
        before = await deps.readLamports(s.from);
        const r = await deps.irys.fund(s.lamports);
        row = recordTopUp(reg.db, { at: now, target: s.target, kind: s.kind, from: s.from, to: s.to, lamports: s.lamports, status: "sent", signature: r.id, reason: s.reason, error: null });
      } catch (e) {
        // The funding transaction may have left the wallet although Irys did not answer (it credits late): when the wallet dropped by
        // the amount, the row is "unconfirmed" and the Irys target waits UNCONFIRMED_WAIT_MS instead of funding a second time.
        let left = false;
        try { if (before !== null) left = before - (await deps.readLamports(s.from)) >= s.lamports; } catch { left = false; }
        row = recordTopUp(reg.db, { at: now, target: s.target, kind: s.kind, from: s.from, to: s.to, lamports: s.lamports, status: left ? "unconfirmed" : "failed", signature: null, reason: s.reason, error: (e as Error).message.slice(0, 200) });
      }
    }
    outcomes.push(row.status);
    done.push(row);
    const what = `${solText(row.lamports)} SOL ${row.kind === "transfer" ? `from the keeper key to ${TARGET_LABEL[row.target === "irys-balance" ? "upload-payer-wallet" : row.target]}${row.target === "irys-balance" ? " for the Irys balance" : ""}` : "from the upload wallet into its Irys balance"}`;
    if (row.status === "sent") {
      log(`  [top-up] moved ${what}: ${row.signature} (${s.reason})`);
      await safeAlert(o.alert, TOP_UP_ALERT, `${TOP_UP_ALERT}:${row.id}`, `Burnticker top-up: moved ${what}. ${capital(s.reason)}. Transaction ${row.signature}.`, { target: row.target, kind: row.kind, lamports: row.lamports.toString(), signature: row.signature });
    } else {
      log(`  [top-up] ${row.status === "unconfirmed" ? "sent but not confirmed yet" : "FAILED"}: ${what}${row.signature ? ` (${row.signature})` : ""}: ${row.error}`);
      const last2 = topUpRowsSince(reg.db, now - 8 * 86_400_000).filter((x) => x.target === row.target).slice(-2);
      if (last2.length === 2 && last2.every((x) => x.status === "failed")) await safeAlert(o.alert, TOP_UP_FAILED_ALERT, `${TOP_UP_FAILED_ALERT}:${row.target}:${row.id}`, `Burnticker top-up of ${TARGET_LABEL[row.target]} failed twice in a row. Last error: ${row.error}`, { target: row.target, lamports: row.lamports.toString() });
    }
  }
  try {
    // the signer's days counted after this pass (its own sends included), so the first top-up already moves the ops line
    const spentNow = done.filter((d) => d.kind === "transfer" && d.status !== "failed").reduce((a, d) => a + d.lamports + TX_FEE_LAMPORTS, BigInt(0));
    const weekSum = input.ledger.filter((r) => r.kind === "transfer" && r.status !== "failed" && now - r.at < 7 * 86_400_000).reduce((a, r) => a + r.lamports, BigInt(0)) + spentNow;
    const burnPerDay = plan.signer.expectedFeesPerDay + weekSum / BigInt(7);
    const signerDays = burnPerDay > BigInt(0) ? Math.max(0, Number(plan.signer.lamports - spentNow - plan.signer.floor) / Number(burnPerDay)) : null;
    reg.setStatus(TOP_UP_STATUS_KEY, { at: now, mode: o.mode, signerLamports: (plan.signer.lamports - spentNow).toString(), signerDays, refused: plan.refused, signerShort: plan.signerShort?.text ?? null, wouldDo: skipped, noticeMark: plan.noticeMarkLamports.toString(), levels: plan.levels.map((l) => ({ target: l.target, balance: l.balance?.toString() ?? null, floor: l.floor.toString(), fill: l.fill.toString() })) }, now);
  } catch (e) { log(`  [top-up] status row not written: ${(e as Error).message.slice(0, 120)}`); }
  return { plan, mode: o.mode, done, skipped };
}
async function safeAlert(a: Alert | null | undefined, kind: string, key: string, text: string, meta: Record<string, unknown> | null): Promise<void> { try { await a?.(kind, key, text, meta); } catch { /* the alert channel failing never stops the keeper */ } }
const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
export function describeStep(s: PlannedStep): string {
  return s.kind === "transfer" ? `move ${solText(s.lamports)} SOL from the keeper key to ${s.to} (${s.target}): ${s.reason}` : `fund the Irys balance with ${solText(s.lamports)} SOL from the upload wallet ${s.from}: ${s.reason}`;
}

// ---- the keeper's wiring ----

/**
 * The top-up runner for the keeper, or null with the reason it is skipped: a read-only keeper (no signer or a dry run) and a non-mainnet
 * keeper without an upload payer never plan. `mode` comes from BURNTICKER_TOP_UP (on unless "off").
 */
export function topUpRunnerFromEnv(o: { env: Readonly<Record<string, string | undefined>>; cluster: string; dryRun: boolean; connection: Connection | null; signer: Keypair | null; root?: string; log: (s: string) => void }):
  { runner: ((registry: Pick<Registry, "db" | "setStatus" | "tokens">, now: number, alert: Alert | null) => Promise<TopUpRunResult | null>) | null; why: string } {
  if (o.dryRun) return { runner: null, why: "skipped (dry run)" };
  if (!o.connection || !o.signer) return { runner: null, why: "skipped (read-only keeper: no signer)" };
  const payer = uploadPayerAddress(o.env);
  if (o.cluster !== "mainnet" && !payer) return { runner: null, why: `skipped (${o.cluster} without an upload payer)` };
  let config: TopUpConfig;
  try { config = loadTopUpConfig(o.root); } catch (e) { return { runner: null, why: `skipped (${(e as Error).message.slice(0, 120)})` }; }
  const mode = topUpModeFromEnv(o.env);
  const conn = o.connection, signer = o.signer;
  const deficit = config.deficitKeeper.enabled ? deficitKeeperAddress(o.cluster, config.deficitKeeper.operatorRole, o.root) : null;
  let irys: IrysPayerAccount | null | undefined;
  const runner = async (registry: Pick<Registry, "db" | "setStatus" | "tokens">, now: number, alert: Alert | null): Promise<TopUpRunResult | null> => {
    if (irys === undefined && payer) { try { irys = await irysPayerAccount(o.env, o.cluster); } catch (e) { o.log(`  [top-up] the Irys client did not load, the payer targets wait: ${(e as Error).message.slice(0, 160)}`); } }
    return runTopUps({ registry, config, mode, now, log: o.log, alert, deps: { signerAddress: signer.publicKey.toBase58(), readLamports: async (a) => BigInt(await conn.getBalance(new PublicKey(a), "confirmed")), transfer: connectionTransfer(conn, signer), irys: irys ?? null, deficitKeeper: deficit } });
  };
  return { runner, why: `${mode === "on" ? "on" : "OFF (BURNTICKER_TOP_UP=off: planned and logged, nothing sent)"}${payer ? "" : ", no upload payer"}${deficit ? ", with the $DEFICIT keeper key" : ""}` };
}

// ---- what ops.json and the daily summary say ----

/** Today's top-ups (Denver day) and the last one. Safe on a registry without the table. */
export function topUpDaySummary(db: DatabaseSync, now: number): { count: number; signerLamports: bigint; rows: TopUpRow[]; last: TopUpRow | null } {
  const rows = topUpRowsSince(db, now - 8 * 86_400_000);
  const day = denverDay(now);
  const today = rows.filter((r) => r.day === day && r.status !== "failed");
  const ok = rows.filter((r) => r.status === "sent");
  return { count: today.length, signerLamports: today.filter((r) => r.kind === "transfer").reduce((a, r) => a + r.lamports, BigInt(0)), rows: today, last: ok[ok.length - 1] ?? null };
}

/** The ops.json lines: "Top-ups: N today, X SOL; signer covers about D days." plus the last top-up, refusals and the notice line. */
export function topUpOpsLines(reg: Pick<Registry, "db" | "getStatus">, now: number): string[] {
  let s: { at: number; mode: TopUpMode; signerDays: number | null; refused: { target: string; reason: string }[]; signerShort: string | null; wouldDo: string[]; noticeMark: string } | null = null;
  try { const v = reg.getStatus(TOP_UP_STATUS_KEY); s = v ? JSON.parse(v) : null; } catch { s = null; }
  let sum: ReturnType<typeof topUpDaySummary>;
  try { sum = topUpDaySummary(reg.db, now); } catch { return []; }
  if (!s && !sum.last) return [];
  const days = s?.signerDays == null ? "unknown" : s.signerDays >= 365 ? "more than a year" : `about ${Math.floor(s.signerDays)} days`;
  const out = [`- Top-ups: ${sum.count} today, ${solText(sum.signerLamports)} SOL; signer covers ${days}.${s?.mode === "off" ? " Automatic top-ups are OFF (BURNTICKER_TOP_UP=off)." : ""}`];
  if (sum.last) out.push(`- Last top-up: ${solText(sum.last.lamports)} SOL to ${TARGET_LABEL[sum.last.target]} (${sum.last.kind === "irys-fund" ? "Irys funding" : "transfer"}) at ${new Date(sum.last.at).toLocaleString("en-US", { timeZone: "America/Denver", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })} Denver, ${sum.last.signature}`);
  if (s?.signerShort) out.push(`- ${s.signerShort}`);
  for (const r of s?.refused ?? []) if (!/below its own .* floor/.test(r.reason)) out.push(`- Top-up waiting for ${TARGET_LABEL[r.target as TopUpTarget] ?? r.target}: ${r.reason}`);
  if (s?.mode === "off") for (const w of (s.wouldDo ?? []).slice(0, 3)) out.push(`- Top-up off, would ${w}`);
  const mark = s?.noticeMark ? BigInt(s.noticeMark) : noticeMarkLamports({ ...REFERENCE_IRYS_PRICES });
  if (sum.signerLamports > mark) out.push(`- Top-ups today (${solText(sum.signerLamports)} SOL) are above what 50 launches would cost (${solText(mark)} SOL). Nothing is stopped; check the list.`);
  return out;
}
