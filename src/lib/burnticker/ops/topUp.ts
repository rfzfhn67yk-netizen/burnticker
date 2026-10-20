import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { base58Decode } from "@/lib/burnKeeper/keyfile";
import { Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction, type Connection } from "@solana/web3.js";
import type { Registry } from "@/lib/burnticker/registry";
import { apiBudget, takeOrThrow } from "@/lib/burnticker/apiBudget";
import { latestSnapshot } from "@/lib/burnticker/ops/snapshot";
import { confirmByPolling } from "@/lib/burnReceipts/crank";
import { dropIrysRead, freshIrysRead, IRYS_READ_TTL_MS, publishIrysRead } from "@/lib/burnticker/ops/irysReadMemo";

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
 * GUARDS AGAINST A RUNAWAY (HB-108, hourly audit run 8; still no cap on what a healthy wallet gets):
 *   (a) the DRAIN STOP: a target that needed a top-up `drainStop.count` times inside `drainStop.windowHours` (default 3 in 6 hours), or
 *       `drainStop.perDay` times inside 24 hours (default 6; HB-126), is
 *       refused with the reason "draining" and bt-top-up-draining is pushed naming the target and the amounts. It resumes on its own
 *       once the window has passed since the last of those top-ups, or earlier when the operator clears it
 *       (scripts/ops/top-up.mts --clear-drain <target>). A wallet that spends normally needs one top-up every few days, so the stop
 *       only ever meets a wallet that is losing SOL faster than anything here spends it (a leaked key, a bug).
 *   (b) PAUSE: the keeper skips the step while data/PAUSE-burnticker exists (the same file read that holds its cranks), and the
 *       operator's --apply refuses while it exists.
 *   (c) ONE SENDER: data/burnticker-top-up.lock. The active keeper holds it as long as it leads (refreshed every cycle, lapsing
 *       KEEPER_LOCK_TTL_MS after its last cycle), so --apply refuses while a keeper leads on this host; --apply holds it for its one
 *       pass (CLI_LOCK_TTL_MS at most), and a keeper that starts leading meanwhile skips its step until the pass is done.
 *
 * BURNTICKER_TOP_UP=off is the kill switch: the planner still runs and logs what it would do; nothing is sent. The planner is skipped
 * entirely on a read-only keeper (no signer, a dry run, a passive role) and on a non-mainnet keeper without an upload payer.
 *
 * `planTopUps` is pure. `runTopUps` reads the balances and prices, plans, executes and records. `irysPayerAccount` is the shared Irys
 * balance and price reader. HB-114: its reads are memoised (readTopUpInput): the balance at most once an hour, the prices only when
 * the Irys target is below its floor, and the snapshot step's daily low-balance alert shares the same read (ops/irysReadMemo.ts).
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
  /** The drain stop (HB-108): `count` top-ups of one target inside `windowHours` stop that target until the window has passed. */
  drainStop: { count: number; windowHours: number; /** HB-126: also `perDay` top-ups inside 24 hours (catches a steady drain spaced just past windowHours) */ perDay?: number };
}
export const DEFAULT_TOP_UP_CONFIG: TopUpConfig = {
  signer: { floorLamports: SIGNER_FLOOR_LAMPORTS, refillToLamports: SIGNER_REFILL_TO_LAMPORTS, feesPerCoinPerDayLamports: READING_RENT_LAMPORTS + BigInt(2) * TX_FEE_LAMPORTS, baseFeesPerDayLamports: sol(0.002) },
  uploadPayerWallet: { enabled: true, floorLamports: sol(0.01), fillLamports: sol(0.03) },
  irys: { enabled: true, floorDays: 7, fillDays: 30, minLamports: sol(0.005), maxLamports: sol(0.05), metadataBytes: 4_096, imageBytes: 2 * 1024 * 1024 },
  deficitKeeper: { enabled: true, operatorRole: "keeper", floorLamports: sol(0.03), fillLamports: sol(0.06) },
  noticeLaunchesPerDay: 50,
  drainStop: { count: 3, windowHours: 6, perDay: 6 },
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
  const s = sec("signer"), w = sec("uploadPayerWallet"), i = sec("irys"), k = sec("deficitKeeper"), dr = sec("drainStop");
  const c: TopUpConfig = {
    signer: { floorLamports: lam(s, "floorLamports", d.signer.floorLamports), refillToLamports: lam(s, "refillToLamports", d.signer.refillToLamports), feesPerCoinPerDayLamports: lam(s, "feesPerCoinPerDayLamports", d.signer.feesPerCoinPerDayLamports), baseFeesPerDayLamports: lam(s, "baseFeesPerDayLamports", d.signer.baseFeesPerDayLamports) },
    uploadPayerWallet: { enabled: bool(w, "enabled", true), floorLamports: lam(w, "floorLamports", d.uploadPayerWallet.floorLamports), fillLamports: lam(w, "fillLamports", d.uploadPayerWallet.fillLamports) },
    irys: { enabled: bool(i, "enabled", true), floorDays: num(i, "floorDays", d.irys.floorDays), fillDays: num(i, "fillDays", d.irys.fillDays), minLamports: lam(i, "minLamports", d.irys.minLamports), maxLamports: lam(i, "maxLamports", d.irys.maxLamports), metadataBytes: num(i, "metadataBytes", d.irys.metadataBytes), imageBytes: num(i, "imageBytes", d.irys.imageBytes) },
    deficitKeeper: { enabled: bool(k, "enabled", true), operatorRole: typeof k.operatorRole === "string" ? k.operatorRole : d.deficitKeeper.operatorRole, floorLamports: lam(k, "floorLamports", d.deficitKeeper.floorLamports), fillLamports: lam(k, "fillLamports", d.deficitKeeper.fillLamports) },
    noticeLaunchesPerDay: typeof o.noticeLaunchesPerDay === "number" && o.noticeLaunchesPerDay > 0 ? o.noticeLaunchesPerDay : d.noticeLaunchesPerDay,
    drainStop: { count: num(dr, "count", d.drainStop.count), windowHours: num(dr, "windowHours", d.drainStop.windowHours), perDay: num(dr, "perDay", d.drainStop.perDay ?? 6) },
  };
  if (!Number.isInteger(c.drainStop.count) || c.drainStop.count < 2) throw new Error("top-up.json: drainStop.count must be a whole number of at least 2");
  if (!Number.isInteger(c.drainStop.perDay) || (c.drainStop.perDay ?? 0) < 2) throw new Error("top-up.json: drainStop.perDay must be a whole number of at least 2");
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
  /** When the operator last cleared each target's drain stop (--clear-drain); rows at or before it do not count toward the stop. */
  drainClearedAt?: Partial<Record<TopUpTarget, number>>;
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
  /** Targets the drain stop refused this pass (each is also in `refused`, with a reason starting "draining"). */
  draining: DrainStop[];
}
/** A target stopped by the drain stop: the top-ups that tripped it (oldest first) and when it resumes on its own. */
export interface DrainStop { target: TopUpTarget; count: number; windowHours: number; amounts: bigint[]; since: number; until: number }

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

/**
 * The drain stop for one target (pure): the last `count` top-ups of it (one per pass: the Irys two-step's transfer and funding share a
 * pass; failed rows moved nothing and do not count; rows at or before the operator's clear do not count) fall inside `windowHours`,
 * and the window has not yet passed since the last of them. null = not stopped.
 */
export function drainStopFor(target: TopUpTarget, ledger: readonly TopUpRow[], now: number, ds: TopUpConfig["drainStop"], clearedAt = 0): DrainStop | null {
  // HB-126: the short window (3 in 6 h) never trips on a steady 3 h 01 min cadence, so `perDay` top-ups inside 24 hours stop it too
  return drainStopWindow(target, ledger, now, { count: ds.count, windowHours: ds.windowHours }, clearedAt)
    ?? (ds.perDay ? drainStopWindow(target, ledger, now, { count: ds.perDay, windowHours: 24 }, clearedAt) : null);
}
function drainStopWindow(target: TopUpTarget, ledger: readonly TopUpRow[], now: number, ds: { count: number; windowHours: number }, clearedAt: number): DrainStop | null {
  // HB-129 (hourly run 11): only passes that moved SOL count. A failed attempt moved nothing, and counting it meant one real top-up
  // plus two failed tries (an RPC blip and its back-off retry) refused the next genuine refill for hours with a false draining alarm.
  // A run of failures is the failure back-off's job (failureBackoffFor), not the drain stop's.
  const passes = new Map<number, bigint>();
  for (const r of ledger) {
    if (r.target !== target || r.at <= clearedAt || r.at > now || r.status === "failed") continue;
    passes.set(r.at, maxB(passes.get(r.at) ?? BigInt(0), r.lamports));
  }
  const ats = [...passes.keys()].sort((a, b) => a - b).slice(-ds.count);
  if (ats.length < ds.count) return null;
  const windowMs = ds.windowHours * 3_600_000, first = ats[0], last = ats[ats.length - 1];
  if (last - first > windowMs || now - last >= windowMs) return null;
  return { target, count: ats.length, windowHours: ds.windowHours, amounts: ats.map((a) => passes.get(a)!), since: first, until: last + windowMs };
}
/** HB-125: the first failed pass holds its target this long; each further consecutive failure doubles it, up to FAILURE_BACKOFF_CAP_MS. */
export const FAILURE_BACKOFF_FIRST_MS = 10 * 60_000;
export const FAILURE_BACKOFF_CAP_MS = 60 * 60_000;
/** HB-125: at most this many failed passes per target in any 24 hours (the doubling's first hour would otherwise make 26 a day). */
export const FAILURE_MAX_PER_DAY = 24;
export interface FailureBackoff { target: TopUpTarget; failures: number; lastAt: number; until: number }
/**
 * HB-125 (hourly run 10): a target whose last pass failed (a failed funding, or a failed step-one transfer) waits a back-off window
 * before it is tried again: 10 minutes after the first failure, doubling to a cap of 1 hour, reset by any pass that did not fail. Also
 * at most FAILURE_MAX_PER_DAY failed passes per rolling 24 hours. One pass = the rows sharing one `at` (the two-step shares a pass); a
 * pass with any failed row is a failed pass. Pure; null = not held. The first cycle after the window retries.
 */
export function failureBackoffFor(target: TopUpTarget, ledger: readonly TopUpRow[], now: number): FailureBackoff | null {
  const passes = new Map<number, boolean>();
  for (const r of ledger) { if (r.target !== target || r.at > now) continue; passes.set(r.at, (passes.get(r.at) ?? false) || r.status === "failed"); }
  const ats = [...passes.keys()].sort((a, b) => a - b);
  let n = 0;
  for (let k = ats.length - 1; k >= 0 && passes.get(ats[k]); k--) n++;
  if (n === 0) return null;
  const lastAt = ats[ats.length - 1];
  let until = lastAt + Math.min(FAILURE_BACKOFF_CAP_MS, FAILURE_BACKOFF_FIRST_MS * 2 ** Math.min(n - 1, 20));
  const dayFails = ats.filter((a) => passes.get(a) && now - a < 86_400_000);
  if (dayFails.length >= FAILURE_MAX_PER_DAY) until = Math.max(until, dayFails[dayFails.length - FAILURE_MAX_PER_DAY] + 86_400_000);
  return now < until ? { target, failures: n, lastAt, until } : null;
}
const hoursText = (h: number): string => `${h} ${h === 1 ? "hour" : "hours"}`;
/** The alarm text for a drain stop: the target, the amounts, and how it resumes. */
export function drainStopText(d: DrainStop): string {
  const total = d.amounts.reduce((a, b) => a + b, BigInt(0));
  return `Burnticker stopped topping up ${TARGET_LABEL[d.target]}: it needed SOL ${d.count} times in ${hoursText(d.windowHours)} (${d.amounts.map((a) => solText(a)).join(", ")} SOL, ${solText(total)} SOL in all), so it is treated as draining. Nothing more goes to it until ${hoursText(d.windowHours)} have passed since the last top-up, or until the operator clears it with scripts/ops/top-up.mts --clear-drain ${d.target}.`;
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
  // HB-114 follow-up: an Irys funding recorded as "sent" holds the Irys target for the same wait as an unconfirmed one, because the node
  // can credit it late and the next cycle's balance read would otherwise plan a second funding
  const pendingFor = (t: TopUpTarget): TopUpRow | undefined => i.ledger.find((r) => r.target === t && (r.status === "unconfirmed" || (r.kind === "irys-fund" && r.status === "sent")) && i.now - r.at >= 0 && i.now - r.at < UNCONFIRMED_WAIT_MS);
  // HB-125: a failed pass holds its target for the failure back-off window
  const backedOff = (t: TopUpTarget): boolean => {
    const b = failureBackoffFor(t, i.ledger, i.now);
    if (!b) return false;
    refused.push({ target: t, reason: `the last ${b.failures === 1 ? "attempt" : `${b.failures} attempts`} failed; the next try is at ${new Date(b.until).toISOString()} (back-off)` });
    return true;
  };
  // HB-108: the drain stop, checked only for a target that needs SOL now (a stopped target at or above its floor raises nothing)
  const draining: DrainStop[] = [];
  const drained = (t: TopUpTarget): boolean => {
    const d = drainStopFor(t, i.ledger, i.now, cfg.drainStop, i.drainClearedAt?.[t] ?? 0);
    if (!d) return false;
    draining.push(d);
    refused.push({ target: t, reason: `draining: it needed SOL ${d.count} times in ${hoursText(d.windowHours)} (${d.amounts.map((a) => solText(a)).join(", ")} SOL); stopped until ${hoursText(d.windowHours)} after the last top-up or until the operator clears it` });
    return true;
  };

  // What each target needs, in the order they are funded.
  type Want = { target: TopUpTarget; to: string; lamports: bigint; reason: string; irysFund?: bigint };
  const wants: Want[] = [];
  if (i.payer && cfg.uploadPayerWallet.enabled) {
    const w = cfg.uploadPayerWallet;
    levels.push({ target: "upload-payer-wallet", address: i.payer.address, balance: i.payer.walletLamports, floor: w.floorLamports, fill: w.fillLamports });
    if (i.payer.walletLamports < w.floorLamports) {
      if (pendingFor("upload-payer-wallet")) refused.push({ target: "upload-payer-wallet", reason: "an earlier transfer to it has not confirmed yet; waiting for it to settle" });
      else if (backedOff("upload-payer-wallet") || drained("upload-payer-wallet")) { /* refused above */ }
      else wants.push({ target: "upload-payer-wallet", to: i.payer.address, lamports: w.fillLamports - i.payer.walletLamports, reason: `the upload wallet holds ${solText(i.payer.walletLamports)} SOL, below its ${solText(w.floorLamports)} SOL floor; filled to ${solText(w.fillLamports)} SOL` });
    }
  }
  if (i.payer && cfg.irys.enabled) {
    const lv = irysLevels(prices, i.launchesLast7d, cfg.irys);
    levels.push({ target: "irys-balance", address: i.payer.address, balance: i.payer.irysLamports, floor: lv.floor, fill: lv.fill });
    if (i.payer.irysLamports === null) refused.push({ target: "irys-balance", reason: "the Irys balance could not be read this cycle" });
    else if (i.payer.irysLamports < lv.floor) {
      const pending = pendingFor("irys-balance");
      if (pending) refused.push({ target: "irys-balance", reason: pending.status === "sent" ? "an Irys funding was sent less than 3 minutes ago and the node may not have credited it yet; waiting for it to settle" : "an earlier transfer for it has not confirmed yet; waiting for it to settle" });
      else if (backedOff("irys-balance") || drained("irys-balance")) { /* refused above */ }
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
      else if (backedOff("deficit-keeper") || drained("deficit-keeper")) { /* refused above */ }
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
  return { steps, refused, levels, signer: { address: i.signer.address, lamports: i.signer.lamports, floor: cfg.signer.floorLamports, reserve, expectedFeesPerDay }, signerShort, today, noticeMarkLamports: mark, overNotice: today.signerLamports > mark, signerDays, draining };
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
/** HB-108: pushed when the drain stop refuses a target (once per stop: the key carries the first top-up of the run that tripped it). */
export const TOP_UP_DRAINING_ALERT = "bt-top-up-draining";
/** The registry status row holding the operator's drain-stop clears: { [target]: ms }. */
export const TOP_UP_DRAIN_CLEARED_KEY = "ops.topUp.drainCleared";
export const TOP_UP_TARGETS: readonly TopUpTarget[] = ["upload-payer-wallet", "irys-balance", "deficit-keeper"];
/** The operator's clears, read straight from the registry's status table (safe on a registry without one). */
export function drainClears(db: DatabaseSync): Partial<Record<TopUpTarget, number>> {
  try {
    const r = db.prepare("SELECT value FROM status WHERE key=?").get(TOP_UP_DRAIN_CLEARED_KEY) as { value: string } | undefined;
    const j = r ? JSON.parse(r.value) as Record<string, unknown> : {};
    const out: Partial<Record<TopUpTarget, number>> = {};
    for (const t of TOP_UP_TARGETS) { const v = j[t]; if (typeof v === "number" && Number.isFinite(v)) out[t] = v; }
    return out;
  } catch { return {}; }
}
/** The operator clears one target's drain stop (scripts/ops/top-up.mts --clear-drain): the top-ups up to `now` stop counting. */
export function clearDrainStop(reg: Pick<Registry, "db" | "setStatus">, target: TopUpTarget, now: number): void {
  if (!TOP_UP_TARGETS.includes(target)) throw new Error(`unknown top-up target ${target} (one of ${TOP_UP_TARGETS.join(", ")})`);
  reg.setStatus(TOP_UP_DRAIN_CLEARED_KEY, { ...drainClears(reg.db), [target]: now }, now);
}

// ---- one sender at a time (HB-108): the lock file the keeper and the operator's --apply share ----

export const TOP_UP_LOCK_FILE = path.join("data", "burnticker-top-up.lock");
/** The keeper refreshes its hold every cycle; it lapses this long after the last cycle (the standby heartbeat window). */
export const KEEPER_LOCK_TTL_MS = 180_000;
/** The operator's --apply holds the lock for one pass, at most this long. */
export const CLI_LOCK_TTL_MS = 5 * 60_000;
export type TopUpLockHolder = "keeper" | "cli";
export interface TopUpLock { holder: TopUpLockHolder; pid: number; at: number; expiresAt: number }
/** The lock as it stands now: null when there is none, or it has lapsed, or it does not read. */
export function readTopUpLock(file: string, now: number): TopUpLock | null {
  try {
    const j = JSON.parse(fs.readFileSync(file, "utf8")) as TopUpLock;
    if ((j.holder !== "keeper" && j.holder !== "cli") || typeof j.expiresAt !== "number") return null;
    return j.expiresAt > now ? j : null;
  } catch { return null; }
}
/**
 * Takes (or, for the keeper, refreshes) the lock. Refused while the other holder has it; the operator's pass is also refused while
 * another operator pass holds it. The keeper writes over its own or a lapsed lock; the operator creates the file exclusively.
 */
export function takeTopUpLock(file: string, holder: TopUpLockHolder, now: number, ttlMs: number, pid = process.pid): { ok: true } | { ok: false; held: TopUpLock } {
  const held = readTopUpLock(file, now);
  if (held && (held.holder !== holder || (holder === "cli" && held.pid !== pid))) return { ok: false, held };
  const body = `${JSON.stringify({ holder, pid, at: now, expiresAt: now + ttlMs } satisfies TopUpLock)}\n`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (holder === "cli") {
    if (!held) { try { fs.unlinkSync(file); } catch { /* none */ } }
    try { fs.writeFileSync(file, body, { flag: held ? "w" : "wx" }); }
    catch { const now2 = readTopUpLock(file, now); return now2 ? { ok: false, held: now2 } : { ok: false, held: { holder: "keeper", pid: 0, at: now, expiresAt: now } }; }
    const mine = readTopUpLock(file, now);
    return mine && mine.holder === "cli" && mine.pid === pid ? { ok: true } : { ok: false, held: mine ?? { holder: "keeper", pid: 0, at: now, expiresAt: now } };
  }
  const tmp = `${file}.tmp-${pid}`;
  fs.writeFileSync(tmp, body);
  fs.renameSync(tmp, file);
  return { ok: true };
}
/** Removes the lock when this holder (and, for the operator, this process) has it. */
export function releaseTopUpLock(file: string, holder: TopUpLockHolder, now: number, pid = process.pid): void {
  const held = readTopUpLock(file, now);
  if (held && held.holder === holder && (holder === "keeper" || held.pid === pid)) { try { fs.unlinkSync(file); } catch { /* gone */ } }
}
/** The keeper's PAUSE file (scripts/burnticker-keeper.mts reads the same path to hold its cranks). */
export const KEEPER_PAUSE_FILE = path.join("data", "PAUSE-burnticker");
type Alert = (kind: string, key: string, text: string, meta: Record<string, unknown> | null) => Promise<unknown> | unknown;

/**
 * HB-114 (hourly audit, publish 100): the Irys reads are memoised per Irys client (the keeper builds one client and keeps it). The
 * balance is read at most once per IRYS_READ_TTL_MS; the prices only when the Irys target is below its floor (judged on the last live
 * prices, else the reference prices), at most once per window, and only the sizes the floor needs (the snapshot size always; the
 * metadata and image sizes only when launches were pinned in the last 7 days). Before this, every 60 s cycle made 4 Irys requests
 * (balance + 3 prices), so the keeper's 1,500-a-day share was gone about 6 h into each UTC day.
 *
 * A balance read is reused only when it was taken at least UNCONFIRMED_WAIT_MS after the last Irys funding in the ledger (sent or
 * unconfirmed), so a funding that lands (from this keeper or the operator's --apply) makes the next cycles re-read until the node has
 * had time to credit it; one stale low read is never reused for an hour to fund the target again every cycle.
 */
interface IrysMemo { balance: { lamports: bigint | null; at: number } | null; prices: { value: IrysPrices; at: number; sizes: "all" | "snapshot" } | null; lastPrices: IrysPrices | null }
const irysMemos = new WeakMap<IrysPayerAccount, IrysMemo>();
const memoOf = (a: IrysPayerAccount): IrysMemo => { let m = irysMemos.get(a); if (!m) { m = { balance: null, prices: null, lastPrices: null }; irysMemos.set(a, m); } return m; };
/** Drops the memoised balance of this client (and the shared read for its payer): the next read goes to the node. */
export function invalidateIrysBalance(a: IrysPayerAccount): void { memoOf(a).balance = null; dropIrysRead(a.address); }
/** HB-125: how long the Irys reads stay good while the Irys target's last pass failed. */
export const FAILING_READ_TTL_MS = 6 * 3_600_000;
/** Whether the target's latest pass (rows sharing its `at`) had a failed row. */
const failedLastPass = (ledger: readonly TopUpRow[], t: TopUpTarget): boolean => {
  const mine = ledger.filter((r) => r.target === t);
  if (!mine.length) return false;
  const last = mine.reduce((m, r) => Math.max(m, r.at), 0);
  return mine.some((r) => r.at === last && r.status === "failed");
};
/** The last Irys funding (not failed) in the ledger, or 0. */
const lastIrysFundAt = (ledger: readonly TopUpRow[]): number => ledger.reduce((m, r) => (r.kind === "irys-fund" && r.status !== "failed" && r.at > m ? r.at : m), 0);

/**
 * Reads everything the planner needs: the balances (keeper key, upload wallet, Irys, the $DEFICIT keeper key), the live Irys prices
 * (only when a refill of the Irys balance is due; HB-114 above), the launches of the last 7 days and the ledger. Reads only (the
 * operator's --plan uses it on a read-only registry). Throws when a wallet balance does not read; a missing Irys balance or price is
 * logged and left null.
 */
export async function readTopUpInput(o: { db: DatabaseSync; liveCoins: number; config: TopUpConfig; deps: TopUpDeps; now: number; log: (s: string) => void }): Promise<TopUpInput> {
  const { deps, now, log } = o;
  const signerLamports = await deps.readLamports(deps.signerAddress);
  const ledger = topUpRowsSince(o.db, now - 8 * 86_400_000);
  const launchesLast7d = launchesSince(o.db, now - 7 * 86_400_000);
  let payer: TopUpInput["payer"] = null, prices: IrysPrices | null = null;
  if (deps.irys) {
    const acct = deps.irys, memo = memoOf(acct);
    const wallet = await deps.readLamports(acct.address);
    const fundAt = lastIrysFundAt(ledger);
    // HB-125: while the Irys target's last pass failed (a failed attempt moved nothing), the last reads stay good for FAILING_READ_TTL_MS,
    // so a failure streak costs about one fund call an hour and little else
    const ttl = failedLastPass(ledger, "irys-balance") ? FAILING_READ_TTL_MS : IRYS_READ_TTL_MS;
    const usable = (at: number): boolean => now - at >= 0 && now - at < ttl && (fundAt === 0 || at >= fundAt + UNCONFIRMED_WAIT_MS);
    let irysLamports: bigint | null = null;
    if (memo.balance && usable(memo.balance.at)) irysLamports = memo.balance.lamports;
    else {
      // the HB-82 balance alert's read of this hour (it runs just before this step, once a UTC day) stands in for our own
      const shared = freshIrysRead({ now, notBy: "top-up", address: acct.address });
      if (shared && usable(shared.at)) { irysLamports = shared.balanceLamports; memo.balance = { lamports: irysLamports, at: shared.at }; }
      else {
        try { irysLamports = await acct.balance(); } catch (e) { log(`  [top-up] the Irys balance did not read (next try in an hour): ${(e as Error).message.slice(0, 160)}`); }
        // a failed read counts too: the next attempt waits out the window instead of spending a request every cycle
        memo.balance = { lamports: irysLamports, at: now };
        if (irysLamports !== null) publishIrysRead({ address: acct.address, balanceLamports: irysLamports, at: now, by: "top-up", snapshotPrice: null });
      }
    }
    // the prices: only when the Irys target is below its floor (judged on the last live prices, else the reference prices)
    if (o.config.irys.enabled && irysLamports !== null) {
      const judge = memo.lastPrices ?? { ...REFERENCE_IRYS_PRICES };
      const due = irysLamports < irysLevels(judge, launchesLast7d, o.config.irys).floor;
      const sizes: "all" | "snapshot" = launchesLast7d > 0 ? "all" : "snapshot";
      const cached = memo.prices && now - memo.prices.at >= 0 && now - memo.prices.at < ttl && (memo.prices.sizes === "all" || sizes === "snapshot") ? memo.prices.value : null;
      if (due && cached) prices = cached;
      else if (due) {
        let snapBytes = SNAPSHOT_FALLBACK_BYTES;
        try { if (o.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='snapshots'").get()) snapBytes = latestSnapshot({ db: o.db })?.bytes ?? SNAPSHOT_FALLBACK_BYTES; } catch { snapBytes = SNAPSHOT_FALLBACK_BYTES; }
        try {
          const snapshot = await acct.price(snapBytes);
          // the metadata and image pins weigh in the floor only when launches were pinned this week; otherwise the last known prices stand
          const metadata = sizes === "all" ? await acct.price(o.config.irys.metadataBytes) : judge.metadata;
          const image = sizes === "all" ? await acct.price(o.config.irys.imageBytes) : judge.image;
          prices = { metadata, image, snapshot };
          memo.prices = { value: prices, at: now, sizes };
          memo.lastPrices = prices;
          publishIrysRead({ address: acct.address, balanceLamports: irysLamports, at: memo.balance?.at ?? now, by: "top-up", snapshotPrice: { lamports: snapshot, bytes: snapBytes, at: now } });
        } catch (e) { memo.prices = { value: judge, at: now, sizes }; log(`  [top-up] Irys prices did not read (next try in an hour), the last known prices stand in: ${(e as Error).message.slice(0, 160)}`); }
      } else if (memo.lastPrices) prices = memo.lastPrices;
    }
    payer = { address: acct.address, walletLamports: wallet, irysLamports };
  }
  const deficitKeeper = deps.deficitKeeper ? { address: deps.deficitKeeper, lamports: await deps.readLamports(deps.deficitKeeper) } : null;
  return { now, config: o.config, signer: { address: deps.signerAddress, lamports: signerLamports }, payer, irysPrices: prices, launchesLast7d, liveCoins: o.liveCoins, deficitKeeper, ledger, drainClearedAt: drainClears(o.db) };
}

/** Reads, plans, executes (unless the mode is off) and records. Never throws: a failed read is logged and the cycle goes on. */
export async function runTopUps(o: { registry: Pick<Registry, "db" | "setStatus" | "tokens">; config: TopUpConfig; deps: TopUpDeps; mode: TopUpMode; now: number; log: (s: string) => void; alert?: Alert | null; /** HB-126: re-takes the sender lock before each step; false = the lock is gone, the pass stops */ refreshLock?: (() => boolean) | null }): Promise<TopUpRunResult | null> {
  const { registry: reg, deps, now, log } = o;
  let input: TopUpInput;
  try { input = await readTopUpInput({ db: reg.db, liveCoins: reg.tokens("live").length, config: o.config, deps, now, log }); }
  catch (e) { log(`  [top-up] balances did not read, nothing planned this cycle: ${(e as Error).message.slice(0, 160)}`); return null; }

  const plan = planTopUps(input);
  const done: TopUpRow[] = [], skipped: string[] = [];
  for (const r of plan.refused) log(`  [top-up] ${r.target} not refilled: ${r.reason}`);
  for (const d of plan.draining) await safeAlert(o.alert, TOP_UP_DRAINING_ALERT, `${TOP_UP_DRAINING_ALERT}:${d.target}:${d.since}`, drainStopText(d), { target: d.target, count: d.count, windowHours: d.windowHours, lamports: d.amounts.map(String), until: d.until });

  if (plan.signerShort) { log(`  [top-up] ${plan.signerShort.text}`); await safeAlert(o.alert, "bt-keeper-balance-low", `bt-keeper-balance-low:${denverDay(now)}`, plan.signerShort.text, { lamports: plan.signer.lamports.toString(), sendLamports: plan.signerShort.sendLamports.toString() }); }
  const outcomes: (TopUpStatus | null)[] = [];
  for (const s of plan.steps) {
    if (o.mode === "off") { log(`  [top-up] off (BURNTICKER_TOP_UP=off), would ${describeStep(s)}`); skipped.push(describeStep(s)); outcomes.push(null); continue; }
    if (s.after !== null && outcomes[s.after] !== "sent") { const why = `${describeStep(s)} waits: its transfer to the payer wallet did not confirm this cycle`; log(`  [top-up] ${why}`); skipped.push(why); outcomes.push(null); continue; }
    // HB-126: a pass can outlive the lock's TTL (slow confirmations), so the lock is re-taken before every step; lost = stop the pass
    let held = true;
    try { held = o.refreshLock ? o.refreshLock() : true; } catch { held = false; }
    if (!held) { const why = `${describeStep(s)} not sent: the top-up lock is no longer this keeper's`; log(`  [top-up] ${why}; the pass stops here`); skipped.push(why); break; }
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
    // HB-114: a funding that may have landed drops the memoised Irys balance (the ledger rule in readTopUpInput also holds off reuse
    // until the node has had UNCONFIRMED_WAIT_MS to credit it)
    if (row.kind === "irys-fund" && row.status !== "failed" && deps.irys) invalidateIrysBalance(deps.irys);
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
    // HB-114: the keeper's Irys requests today against its share (ops.json's top-up line)
    let irysReads: { used: number; share: number } | null = null;
    try { const b = apiBudget(); irysReads = { used: b.used("irys"), share: b.dayBudget("irys") }; } catch { irysReads = null; }
    reg.setStatus(TOP_UP_STATUS_KEY, { at: now, mode: o.mode, irysReads, signerLamports: (plan.signer.lamports - spentNow).toString(), signerDays, refused: plan.refused, signerShort: plan.signerShort?.text ?? null, wouldDo: skipped, noticeMark: plan.noticeMarkLamports.toString(), levels: plan.levels.map((l) => ({ target: l.target, balance: l.balance?.toString() ?? null, floor: l.floor.toString(), fill: l.fill.toString() })) }, now);
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
  { runner: ((registry: Pick<Registry, "db" | "setStatus" | "tokens">, now: number, alert: Alert | null, refreshLock?: (() => boolean) | null) => Promise<TopUpRunResult | null>) | null; why: string } {
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
  // HB-126 note: the Irys funding (`irys.fund`) sends its Solana transaction through the Irys SDK's own connection to the keyed RPC
  // URL, not the keeper's budgeted fetch (the SDK takes only a URL, no fetch). It counts one "irys" unit per attempt; its RPC calls
  // (a blockhash, the send, a few status polls) are not counted in the helius lane. The failure back-off (HB-125) bounds the attempts
  // to at most 24 a day, and a successful funding happens about once in several days.
  const runner = async (registry: Pick<Registry, "db" | "setStatus" | "tokens">, now: number, alert: Alert | null, refreshLock?: (() => boolean) | null): Promise<TopUpRunResult | null> => {
    if (irys === undefined && payer) { try { irys = await irysPayerAccount(o.env, o.cluster); } catch (e) { o.log(`  [top-up] the Irys client did not load, the payer targets wait: ${(e as Error).message.slice(0, 160)}`); } }
    return runTopUps({ registry, config, mode, now, log: o.log, alert, refreshLock, deps: { signerAddress: signer.publicKey.toBase58(), readLamports: async (a) => BigInt(await conn.getBalance(new PublicKey(a), "confirmed")), transfer: connectionTransfer(conn, signer), irys: irys ?? null, deficitKeeper: deficit } });
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
  let s: { at: number; mode: TopUpMode; irysReads?: { used: number; share: number } | null; signerDays: number | null; refused: { target: string; reason: string }[]; signerShort: string | null; wouldDo: string[]; noticeMark: string } | null = null;
  try { const v = reg.getStatus(TOP_UP_STATUS_KEY); s = v ? JSON.parse(v) : null; } catch { s = null; }
  let sum: ReturnType<typeof topUpDaySummary>;
  try { sum = topUpDaySummary(reg.db, now); } catch { return []; }
  if (!s && !sum.last) return [];
  const days = s?.signerDays == null ? "unknown" : s.signerDays >= 365 ? "more than a year" : `about ${Math.floor(s.signerDays)} days`;
  const out = [`- Top-ups: ${sum.count} today, ${solText(sum.signerLamports)} SOL; signer covers ${days}.${s?.mode === "off" ? " Automatic top-ups are OFF (BURNTICKER_TOP_UP=off)." : ""}`];
  if (sum.last) out.push(`- Last top-up: ${solText(sum.last.lamports)} SOL to ${TARGET_LABEL[sum.last.target]} (${sum.last.kind === "irys-fund" ? "Irys funding" : "transfer"}) at ${new Date(sum.last.at).toLocaleString("en-US", { timeZone: "America/Denver", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })} Denver, ${sum.last.signature}`);
  // HB-114: the keeper process's UTC-day count when the step last ran (the top-up, snapshot, balance alert and pin requests together)
  if (s?.irysReads && Number.isFinite(s.irysReads.used) && s.irysReads.share > 0 && new Date(s.at).toISOString().slice(0, 10) === new Date(now).toISOString().slice(0, 10)) out.push(`- Irys reads today: ${s.irysReads.used} of the keeper's ${s.irysReads.share} share.`);
  if (s?.signerShort) out.push(`- ${s.signerShort}`);
  for (const r of s?.refused ?? []) if (!/below its own .* floor/.test(r.reason)) out.push(`- Top-up waiting for ${TARGET_LABEL[r.target as TopUpTarget] ?? r.target}: ${r.reason}`);
  if (s?.mode === "off") for (const w of (s.wouldDo ?? []).slice(0, 3)) out.push(`- Top-up off, would ${w}`);
  const mark = s?.noticeMark ? BigInt(s.noticeMark) : noticeMarkLamports({ ...REFERENCE_IRYS_PRICES });
  if (sum.signerLamports > mark) out.push(`- Top-ups today (${solText(sum.signerLamports)} SOL) are above what 50 launches would cost (${solText(mark)} SOL). Nothing is stopped; check the list.`);
  return out;
}
