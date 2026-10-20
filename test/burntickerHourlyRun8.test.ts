// HOURLY LAUNCH AUDIT RUN 8 (2026-10-19 20:10 Denver, docs/burnticker/audits/continuous/2026-10-19-2010-Denver.md): the fixes for
// HB-101..110, HS-42..45 and the HB-92 / HB-99 residues. Each describe names its register entry.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Keypair, type Connection } from "@solana/web3.js";
import {
  clearDrainStop, connectionTransfer, DEFAULT_TOP_UP_CONFIG, drainStopFor, drainStopText, KEEPER_LOCK_TTL_MS, CLI_LOCK_TTL_MS, planTopUps, readTopUpLock,
  REFERENCE_IRYS_PRICES, releaseTopUpLock, runTopUps, takeTopUpLock, topUpRowsSince, UNCONFIRMED_WAIT_MS, denverDay,
  type IrysPayerAccount, type TopUpInput, type TopUpRow, type TransferFn,
} from "@/lib/burnticker/ops/topUp";
import { KeeperOps } from "@/lib/burnticker/ops/keeperOps";
import { openRegistry } from "@/lib/burnticker/registry";
import { PUSH_KIND_OF_ALERT } from "@/lib/burnticker/push";
import { buildLaunchReview } from "@/lib/burnticker/launchReview";
import { CANDIDATES_END_RESULT, GAME_END_RESULT, GAME_END_RESULT_NO_TIE, GAME_PAIR_SENTENCE, GAME_PAIR_SENTENCE_NO_TIE, RACE_PAIR_VOID_SENTENCE, endText } from "@/lib/burnticker/describe";
import { budgetCopy, candidatesPairRule, fadeDaySentence, gamePairRule, patternWords, PERPETUAL_UPFRONT_LINE, PICK_BOTH_LINE, upfrontEndLine, wholePoolSliceLine } from "@/lib/burnticker/guidedLaunch";
import { DEFAULT_SHARE } from "@/lib/burnticker/launchPresets";
import { settledPairBody, type SettledPick } from "@/app/burnticker/launch/settledPair";
import { edgeCase, edgeCaseFor, RACE_SPLIT_LINE } from "@/lib/burnticker/ruleEdgeCases";
import { ruleStatement, type BurnRule } from "@/lib/burnticker/rules";
import { walletPromptCount, walletPromptsLine } from "@/lib/burnticker/walletProof";
import { signsLine } from "@/lib/burnticker/mintAddressCopy";
import { HOME_MAX_STALE_MS, homeMaxStaleMs, homeMemoState } from "@/lib/burnticker/webReadCache";
import { migrateLinkedShare } from "@/lib/burnticker/launchDraft";
import { draftLabel, pickOffer, savedDraftLine } from "@/lib/burnticker/launchDraftStore";
import { sosLinkLabel, SOS_FALLBACK_LABEL } from "@/lib/burnticker/sosLabel";
import { coinStatusFactsOf, coinStatusSentence, type StatusInput } from "@/lib/burnticker/coinStatus";
import { coinLifecycleState } from "@/lib/burnticker/decidedWarning";
import { gameDayWord, gameSoonLine } from "@/lib/burnticker/gameSoon";
import { simulateResults } from "@/lib/burnticker/simulator";
import { leagueCannotTie } from "@/lib/burnticker/sources/espn";
import { PUBLIC_COMMIT_NOTE } from "@/lib/burnticker/releaseManifest";
import { RELEASE_LINES } from "@/lib/burnticker/historyCopy";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";

const ROOT = path.join(import.meta.dirname, "..");
const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const sol = (n: number) => BigInt(Math.round(n * 1e9));
const NOON = Date.parse("2026-10-19T18:00:00Z");
const HOUR = 3_600_000;

// ---------------------------------------------------------------------------------------------------------------------------------
// HB-108: guards against a runaway top-up, with no cap on what a healthy wallet gets (owner: "top up as needed")
// ---------------------------------------------------------------------------------------------------------------------------------
const SIGNER_KP = Keypair.generate();
const SIGNER = SIGNER_KP.publicKey.toBase58();
const PAYER = Keypair.generate().publicKey.toBase58(), DEFICIT = Keypair.generate().publicKey.toBase58();
const cfg = DEFAULT_TOP_UP_CONFIG;
const input = (o: Partial<TopUpInput> = {}): TopUpInput => ({
  now: NOON, config: cfg, signer: { address: SIGNER, lamports: sol(1) },
  payer: { address: PAYER, walletLamports: sol(0.03), irysLamports: sol(0.02) },
  irysPrices: { ...REFERENCE_IRYS_PRICES }, launchesLast7d: 0, liveCoins: 2,
  deficitKeeper: { address: DEFICIT, lamports: sol(0.05) }, ledger: [], ...o,
});
const row = (o: Partial<TopUpRow>): TopUpRow => ({ id: 1, at: NOON, day: denverDay(o.at ?? NOON), target: "deficit-keeper", kind: "transfer", from: SIGNER, to: DEFICIT, lamports: sol(0.05), status: "sent", signature: "sig", reason: "r", error: null, ...o });

/** A fake Connection for connectionTransfer: records the call order and moves the balance on send. */
function fakeConnection(o: { bal: Map<string, bigint>; simErr?: unknown; statusThrows?: boolean; expire?: boolean; chainErr?: unknown }) {
  const order: string[] = [];
  let pending: { to: string; lamports: bigint } | null = null;
  const conn = {
    getLatestBlockhash: async () => { order.push("blockhash"); return { blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 100 }; },
    simulateTransaction: async () => { order.push("simulate"); return { value: { err: o.simErr ?? null } }; },
    sendTransaction: async () => {
      order.push("send");
      if (pending) { o.bal.set(SIGNER, (o.bal.get(SIGNER) ?? BigInt(0)) - pending.lamports - BigInt(5_000)); o.bal.set(pending.to, (o.bal.get(pending.to) ?? BigInt(0)) + pending.lamports); }
      return `sig${order.filter((x) => x === "send").length}`;
    },
    getSignatureStatuses: async () => { order.push("status"); if (o.statusThrows) throw new Error("fetch failed"); if (o.expire) return { value: [null] }; return { value: [{ confirmationStatus: "confirmed", err: o.chainErr ?? null }] }; },
    getBlockHeight: async () => { order.push("height"); return o.expire ? 101 : 50; },
  } as unknown as Connection;
  const inner = connectionTransfer(conn, SIGNER_KP);
  const transfer: TransferFn = async (to, lamports) => { pending = { to, lamports }; return inner(to, lamports); };
  return { conn, order, transfer };
}

function world(o: { signer?: bigint; wallet?: bigint; irys?: bigint; deficit?: bigint; drainDeficit?: boolean; statusThrows?: boolean; simErr?: unknown } = {}) {
  const bal = new Map<string, bigint>([[SIGNER, o.signer ?? sol(1)], [PAYER, o.wallet ?? sol(0.03)], [DEFICIT, o.deficit ?? sol(0.05)]]);
  let irysBal = o.irys ?? sol(0.02);
  const funds: bigint[] = [];
  const irys: IrysPayerAccount = {
    address: PAYER, balance: async () => irysBal, price: async () => REFERENCE_IRYS_PRICES.snapshot,
    fund: async (l) => { funds.push(l); bal.set(PAYER, bal.get(PAYER)! - l); irysBal += l; return { id: `fund${funds.length}` }; },
  };
  const fc = fakeConnection({ bal, statusThrows: o.statusThrows, simErr: o.simErr });
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE status (key TEXT PRIMARY KEY, value TEXT, updated_at INTEGER)");
  const registry = { db, setStatus: (k: string, v: unknown, now = Date.now()) => { db.prepare("INSERT INTO status (key, value, updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(k, typeof v === "string" ? v : JSON.stringify(v), now); }, tokens: () => [] as never[] };
  const alerts: { kind: string; key: string; text: string }[] = [];
  const logs: string[] = [];
  const run = (now = NOON) => runTopUps({ registry, config: cfg, mode: "on", now, log: (s) => logs.push(s), alert: (kind, key, text) => { alerts.push({ kind, key, text }); },
    deps: { signerAddress: SIGNER, readLamports: async (a) => (o.drainDeficit && a === DEFICIT ? BigInt(0) : bal.get(a) ?? BigInt(0)), transfer: fc.transfer, irys, deficitKeeper: DEFICIT } });
  return { bal, run, registry, alerts, logs, order: fc.order, funds, irysBalance: () => irysBal };
}

describe("HB-108 · the send path on a fake connection", () => {
  test("simulate, then send, then confirm: in that order, and only a confirmed transfer is 'sent'", async () => {
    const bal = new Map<string, bigint>([[SIGNER, sol(1)]]);
    const fc = fakeConnection({ bal });
    const r = await fc.transfer(DEFICIT, sol(0.05));
    assert.deepEqual(r, { status: "sent", signature: "sig1" });
    assert.deepEqual(fc.order, ["blockhash", "simulate", "send", "status"]);
    assert.equal(bal.get(DEFICIT), sol(0.05));
  });
  test("a failed simulation sends nothing", async () => {
    const fc = fakeConnection({ bal: new Map(), simErr: { InstructionError: [0, "InsufficientFunds"] } });
    const r = await fc.transfer(DEFICIT, sol(0.05));
    assert.equal(r.status, "failed"); assert.equal(r.signature, null); assert.match((r as { error: string }).error, /simulation failed, nothing was sent/);
    assert.deepEqual(fc.order, ["blockhash", "simulate"]);
  });
  test("a confirmation that does not come back is 'unconfirmed' with its signature; an expired blockhash is 'failed'; a chain error is 'failed'", async () => {
    const lost = await fakeConnection({ bal: new Map(), statusThrows: true }).transfer(DEFICIT, sol(0.05));
    assert.equal(lost.status, "unconfirmed"); assert.equal(lost.signature, "sig1");
    const expired = await fakeConnection({ bal: new Map(), expire: true }).transfer(DEFICIT, sol(0.05));
    assert.equal(expired.status, "failed"); assert.match((expired as { error: string }).error, /expired unconfirmed/);
    const onChain = await fakeConnection({ bal: new Map(), chainErr: { InstructionError: [0, "Custom"] } }).transfer(DEFICIT, sol(0.05));
    assert.equal(onChain.status, "failed"); assert.match((onChain as { error: string }).error, /failed on chain/);
  });
  test("the confirmation hold: an unconfirmed transfer holds its target for UNCONFIRMED_WAIT_MS, nothing is sent twice meanwhile", async () => {
    const w = world({ deficit: sol(0.01), statusThrows: true });
    const r1 = await w.run();
    assert.deepEqual(r1!.done.map((d) => [d.target, d.status]), [["deficit-keeper", "unconfirmed"]]);
    const sends = () => w.order.filter((x) => x === "send").length;
    w.bal.set(DEFICIT, sol(0.01));   // a stale read: the balance still looks low
    const r2 = await w.run(NOON + 60_000);
    assert.equal(r2!.done.length, 0); assert.equal(sends(), 1);
    assert.match(r2!.plan.refused[0].reason, /not confirmed yet/);
    const r3 = await w.run(NOON + UNCONFIRMED_WAIT_MS + 1);
    assert.equal(r3!.done.length, 1, "planned again after the wait"); assert.equal(sends(), 2);
  });
  test("the two-step Irys path through the real transfer: keeper key to the wallet (confirmed), then the wallet funds Irys", async () => {
    const w = world({ wallet: sol(0.01), irys: BigInt(0) });
    const r = await w.run();
    assert.deepEqual(r!.done.map((d) => [d.target, d.kind, d.status]), [["irys-balance", "transfer", "sent"], ["irys-balance", "irys-fund", "sent"]]);
    assert.deepEqual(w.order, ["blockhash", "simulate", "send", "status"]);
    assert.equal(w.funds.length, 1); assert.ok(w.irysBalance() > BigInt(0));
  });
  test("the two-step Irys path: when the transfer does not confirm, the funding step waits and nothing is funded", async () => {
    const w = world({ wallet: sol(0.01), irys: BigInt(0), statusThrows: true });
    const r = await w.run();
    assert.deepEqual(r!.done.map((d) => [d.kind, d.status]), [["transfer", "unconfirmed"]]);
    assert.equal(w.funds.length, 0); assert.ok(r!.skipped.some((s) => /waits: its transfer to the payer wallet did not confirm/.test(s)));
  });
});

describe("HB-108 · the drain stop (3 top-ups of one wallet in 6 hours by default; a guard, not a cap)", () => {
  test("the config carries the stop and the default is 3 in 6 hours, and 6 in 24 hours (HB-126)", () => {
    assert.deepEqual(cfg.drainStop, { count: 3, windowHours: 6, perDay: 6 });
  });
  test("HB-126: a steady drain every 3 h 01 min never meets 3 in 6 hours but trips the 24-hour count on the sixth top-up", () => {
    const cadence = (n: number) => Array.from({ length: n }, (_, k) => row({ id: k + 1, at: NOON - (n - k) * (3 * HOUR + 60_000) + 1 }));
    const ds = { count: 3, windowHours: 6 };
    assert.equal(drainStopFor("deficit-keeper", cadence(8), NOON, ds), null, "the short window alone never trips");
    assert.equal(drainStopFor("deficit-keeper", cadence(5), NOON, cfg.drainStop), null, "five in 24 hours is fine");
    const d = drainStopFor("deficit-keeper", cadence(6), NOON, cfg.drainStop);
    assert.ok(d); assert.equal(d.windowHours, 24); assert.equal(d.count, 6);
    assert.match(drainStopText(d), /6 times in 24 hours/);
  });
  test("two top-ups in the window: the third still goes; three: the fourth is refused with 'draining'", () => {
    const low = { deficitKeeper: { address: DEFICIT, lamports: sol(0.01) } };
    const two = [row({ at: NOON - 2 * HOUR }), row({ id: 2, at: NOON - HOUR })];
    assert.equal(planTopUps(input({ ...low, ledger: two })).steps.length, 1);
    const three = [...two, row({ id: 3, at: NOON - 30 * 60_000, lamports: sol(0.04) })];
    const p = planTopUps(input({ ...low, ledger: three }));
    assert.equal(p.steps.length, 0);
    assert.match(p.refused[0].reason, /^draining: it needed SOL 3 times in 6 hours \(0\.0500, 0\.0500, 0\.0400 SOL\)/);
    assert.equal(p.draining.length, 1); assert.equal(p.draining[0].until, NOON - 30 * 60_000 + 6 * HOUR);
  });
  test("the stop holds for the window after the last top-up, then the wallet is refilled again", () => {
    const three = [row({ at: NOON }), row({ id: 2, at: NOON + HOUR }), row({ id: 3, at: NOON + 2 * HOUR })];
    const low = { deficitKeeper: { address: DEFICIT, lamports: sol(0.01) }, ledger: three };
    assert.equal(planTopUps(input({ ...low, now: NOON + 7 * HOUR })).steps.length, 0, "the first top-up left the window, the stop still holds");
    assert.equal(planTopUps(input({ ...low, now: NOON + 8 * HOUR })).steps.length, 1, "6 hours after the last: resumes");
  });
  test("top-ups spread wider than the window never stop a wallet; other wallets do not count; failed attempts never count (HB-129: one real top-up plus two failed tries is not a drain)", () => {
    const spread = [row({ at: NOON - 13 * HOUR }), row({ id: 2, at: NOON - 7 * HOUR }), row({ id: 3, at: NOON - HOUR })];
    assert.equal(drainStopFor("deficit-keeper", spread, NOON, cfg.drainStop), null);
    const failed = [row({ at: NOON - 2 * HOUR }), row({ id: 2, at: NOON - HOUR, status: "failed" }), row({ id: 3, at: NOON - 1000 })];
    assert.equal(drainStopFor("deficit-keeper", failed, NOON, cfg.drainStop), null, "a failed attempt between two sends does not count (HB-129)");
    const realAndTwoFailed = [row({ at: NOON - 3 * HOUR }), row({ id: 2, at: NOON - 2 * HOUR, status: "failed" }), row({ id: 3, at: NOON - HOUR, status: "failed" })];
    assert.equal(drainStopFor("deficit-keeper", realAndTwoFailed, NOON, cfg.drainStop), null, "HB-129: one real top-up plus a blip and its retry is not a drain");
    const failedOnly = [1, 2, 3].map((k) => row({ id: k, at: NOON - k * HOUR, status: "failed" }));
    assert.equal(drainStopFor("deficit-keeper", failedOnly, NOON, cfg.drainStop), null, "a pure failure loop is the back-off's job");
    assert.equal(drainStopFor("upload-payer-wallet", [...spread, ...failed], NOON, cfg.drainStop), null);
  });
  test("the Irys two-step counts as one top-up per pass", () => {
    const pass = (at: number) => [row({ at, target: "irys-balance", to: PAYER }), row({ at, target: "irys-balance", kind: "irys-fund", to: "irys", id: 9 })];
    assert.equal(drainStopFor("irys-balance", [...pass(NOON - 2 * HOUR), ...pass(NOON - HOUR)], NOON, cfg.drainStop), null);
    assert.ok(drainStopFor("irys-balance", [...pass(NOON - 3 * HOUR), ...pass(NOON - 2 * HOUR), ...pass(NOON - HOUR)], NOON, cfg.drainStop));
  });
  test("a draining wallet on the executor: three sends, then refused, the alarm pushed naming the wallet and the amounts; the operator's clear resumes it", async () => {
    const w = world({ drainDeficit: true });
    for (let k = 0; k < 3; k++) await w.run(NOON + k * HOUR);
    assert.equal(topUpRowsSince(w.registry.db, 0).filter((r) => r.status === "sent").length, 3);
    const r4 = await w.run(NOON + 3 * HOUR);
    assert.equal(r4!.done.length, 0);
    const alarm = w.alerts.filter((a) => a.kind === "bt-top-up-draining");
    assert.equal(alarm.length, 1);
    assert.match(alarm[0].text, /stopped topping up the \$DEFICIT keeper key: it needed SOL 3 times in 6 hours \(0\.0600, 0\.0600, 0\.0600 SOL, 0\.1800 SOL in all\)/);
    assert.match(alarm[0].text, /--clear-drain deficit-keeper/);
    assert.equal(PUSH_KIND_OF_ALERT["bt-top-up-draining"], "top-up-draining", "pushed to the owner's phone");
    // the same stop raises the same key again (the alert sink records a key once)
    await w.run(NOON + 3 * HOUR + 60_000);
    assert.deepEqual([...new Set(w.alerts.filter((a) => a.kind === "bt-top-up-draining").map((a) => a.key))].length, 1);
    clearDrainStop(w.registry, "deficit-keeper", NOON + 4 * HOUR);
    const r5 = await w.run(NOON + 4 * HOUR + 60_000);
    assert.equal(r5!.done.length, 1, "cleared by the operator: refilled at once");
    assert.throws(() => clearDrainStop(w.registry, "nope" as never, NOON), /unknown top-up target/);
  });
  test("the text names the wallet, each amount and the total", () => {
    const d = drainStopFor("upload-payer-wallet", [row({ target: "upload-payer-wallet", at: NOON - 3, lamports: sol(0.02) }), row({ target: "upload-payer-wallet", at: NOON - 2, lamports: sol(0.02) }), row({ target: "upload-payer-wallet", at: NOON - 1, lamports: sol(0.02) })], NOON, cfg.drainStop)!;
    assert.match(drainStopText(d), /the upload wallet: it needed SOL 3 times in 6 hours \(0\.0200, 0\.0200, 0\.0200 SOL, 0\.0600 SOL in all\)/);
  });
});

describe("HB-108 · PAUSE and the one-sender lock", () => {
  async function keeperWith(o: { paused: boolean; lockFile: string }) {
    const reg = openRegistry(":memory:");
    let calls = 0;
    const logs: string[] = [];
    const ops = new KeeperOps({ registry: reg, siteDir: tmp("bt-r8-site-"), cluster: "devnet", env: {}, log: (s) => logs.push(s), uploader: null, root: ROOT, hostId: "r8", topUp: async () => { calls++; return null; }, topUpLockFile: o.lockFile });
    await ops.beforeCycle();
    await ops.afterCycle(null, o.paused, null);
    return { calls: () => calls, logs, ops };
  }
  test("the keeper skips the top-up step while PAUSE is set (the same flag that holds its cranks)", async () => {
    const lockFile = path.join(tmp("bt-r8-lock-"), "lock");
    const k = await keeperWith({ paused: true, lockFile });
    assert.equal(k.calls(), 0); assert.ok(k.logs.some((l) => /\[top-up\] skipped: PAUSE is set/.test(l)));
    const k2 = await keeperWith({ paused: false, lockFile: path.join(tmp("bt-r8-lock-"), "lock") });
    assert.equal(k2.calls(), 1);
  });
  test("HB-126: the keeper skips the top-up step while the reading fence holds its sends, and passes a lock refresh to the step", async () => {
    const reg = openRegistry(":memory:");
    let calls = 0, refresh: (() => boolean) | null | undefined;
    const logs: string[] = [];
    const lockFile = path.join(tmp("bt-r8-lock-"), "lock");
    const ops = new KeeperOps({ registry: reg, siteDir: tmp("bt-r8-site-"), cluster: "devnet", env: {}, log: (s) => logs.push(s), uploader: null, root: ROOT, hostId: "r8", topUp: async (_r, _n, _a, rl) => { calls++; refresh = rl; return null; }, topUpLockFile: lockFile });
    await ops.beforeCycle();
    (ops as unknown as { fence: unknown }).fence = { held: [{ mint: "m", ticker: "T", why: "foreign reading" }], adopted: [], checked: 1 };
    await ops.afterCycle(null, false, null);
    assert.equal(calls, 0); assert.ok(logs.some((l) => /\[top-up\] skipped: the reading fence holds/.test(l)));
    (ops as unknown as { fence: unknown }).fence = null;
    await ops.afterCycle(null, false, null);
    assert.equal(calls, 1); assert.equal(typeof refresh, "function"); assert.equal(refresh!(), true, "the keeper still holds the lock");
  });
  test("the leading keeper holds the lock, so the operator's --apply is refused; the lock lapses after the keeper stops", async () => {
    const lockFile = path.join(tmp("bt-r8-lock-"), "lock");
    const k = await keeperWith({ paused: false, lockFile });
    assert.equal(k.calls(), 1);
    const now = Date.now();
    assert.equal(readTopUpLock(lockFile, now)?.holder, "keeper");
    const cli = takeTopUpLock(lockFile, "cli", now, CLI_LOCK_TTL_MS, 4242);
    assert.equal(cli.ok, false); assert.equal(!cli.ok && cli.held.holder, "keeper");
    // after the keeper's last cycle the hold lapses: the operator's pass may run
    assert.equal(takeTopUpLock(lockFile, "cli", now + KEEPER_LOCK_TTL_MS + 1, CLI_LOCK_TTL_MS, 4242).ok, true);
  });
  test("the keeper skips its step while the operator's pass holds the lock, and runs again once it is released", async () => {
    const lockFile = path.join(tmp("bt-r8-lock-"), "lock");
    assert.equal(takeTopUpLock(lockFile, "cli", Date.now(), CLI_LOCK_TTL_MS, 4242).ok, true);
    assert.equal(takeTopUpLock(lockFile, "cli", Date.now(), CLI_LOCK_TTL_MS, 4343).ok, false, "a second operator pass is refused too");
    const k = await keeperWith({ paused: false, lockFile });
    assert.equal(k.calls(), 0); assert.ok(k.logs.some((l) => /skipped: the operator's top-up pass holds/.test(l)));
    releaseTopUpLock(lockFile, "cli", Date.now(), 4242);
    const k2 = await keeperWith({ paused: false, lockFile });
    assert.equal(k2.calls(), 1);
  });
  test("the operator's tool refuses --apply under PAUSE and while the lock is held, and offers --clear-drain", () => {
    const src = fs.readFileSync(path.join(ROOT, "scripts", "ops", "top-up.mts"), "utf8");
    assert.match(src, /apply && fs\.existsSync\(KEEPER_PAUSE_FILE\)/);
    assert.match(src, /takeTopUpLock\(TOP_UP_LOCK_FILE, "cli"/);
    assert.match(src, /--clear-drain/);
    // the keeper reads the same PAUSE path
    const keeper = path.join(ROOT, "scripts", "burnticker-keeper.mts");
    if (fs.existsSync(keeper)) assert.match(fs.readFileSync(keeper, "utf8"), /const PAUSE = path\.join\("data", "PAUSE-burnticker"\)/);
  });
  test("still no cap: the config and the code name no daily or hourly limit", () => {
    const raw = fs.readFileSync(path.join(ROOT, "config", "burnticker", "top-up.json"), "utf8");
    assert.doesNotMatch(raw, /maxPerDay|perHour|dailyCap|"cap"/i);
    assert.match(raw, /There is no daily cap/);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// HB-101: a deploy-time script may only run files that are in the public tree (publish 99 ran a monorepo-only script on the host)
// ---------------------------------------------------------------------------------------------------------------------------------
/** Whether a repository path is covered by an allowlist line (a file, a directory, or a git glob with * and **). */
function allowlisted(file: string, lines: readonly string[]): boolean {
  return lines.some((l) => {
    if (l === file || file.startsWith(`${l.replace(/\/$/, "")}/`)) return true;
    if (!/[*?]/.test(l)) return false;
    const re = new RegExp(`^${l.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]").replace(/\u0000/g, ".*")}$`);
    return re.test(file);
  });
}
describe("HB-101 · every scripts/ path deploy-sites.sh runs is in the public tree", () => {
  const sh = path.join(ROOT, "scripts", "ops", "deploy-sites.sh"), allow = path.join(ROOT, "config", "public-repo.allowlist");
  test("each script the deploy step runs is allowlisted (and exists here)", () => {
    assert.ok(fs.existsSync(sh), "scripts/ops/deploy-sites.sh ships in the public tree");
    if (!fs.existsSync(allow)) return;
    const lines = fs.readFileSync(allow, "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
    const code = fs.readFileSync(sh, "utf8").split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
    const run = [...new Set([...code.matchAll(/(?:\.\/)?(scripts\/[A-Za-z0-9_./-]+\.(?:sh|mts|mjs|js|ts))/g)].map((m) => m[1]))];
    assert.ok(run.includes("scripts/ops/deficit-first-paint.mts"), "the first-paint step is still found by the scan");
    assert.ok(run.length >= 3);
    for (const f of run) {
      assert.ok(allowlisted(f, lines), `${f} is run by scripts/ops/deploy-sites.sh but is not in config/public-repo.allowlist`);
      assert.ok(fs.existsSync(path.join(ROOT, f)), `${f} is run by scripts/ops/deploy-sites.sh but is missing from this tree`);
    }
  });
  test("the matcher: files, directories and globs", () => {
    assert.equal(allowlisted("scripts/ops/x.sh", ["scripts/ops"]), true);
    assert.equal(allowlisted("scripts/ops/x.sh", ["scripts/ops/x.sh"]), true);
    assert.equal(allowlisted("scripts/ops/x.sh", ["scripts/op"]), false);
    assert.equal(allowlisted("test/burnticker-a.test.ts", ["test/burnticker*.ts"]), true);
    assert.equal(allowlisted("scripts/ops/mac/pull.sh", ["scripts/ops/*.sh"]), false);
  });
  test("the step logs a skip line when a release lacks the first-paint script, and the incident is in the log", () => {
    assert.match(fs.readFileSync(sh, "utf8"), /\[ -f scripts\/ops\/deficit-first-paint\.mts \] \|\| \{ add "  deficit first paint: skipped/);
    const log = fs.readFileSync(path.join(ROOT, "docs", "burnticker", "incidents", "LOG.md"), "utf8");
    const entry = log.slice(log.indexOf("## 2026-10-19 — the every-minute static publish failed"));
    assert.ok(entry.length > 200);
    assert.match(entry, /19:39 to 19:55 Denver/); assert.match(entry, /bt-unit-failed/); assert.match(entry, /9b25e3b4/);
    assert.match(entry, /Until publish 100, the served release held that one hand-placed file outside its release record/);
    assert.match(entry, /a deploy-time script may only run files that are in the public tree/);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// The wizard and copy items (HB-92..110, HS-42..45, HB-99 and HB-25 residues)
// ---------------------------------------------------------------------------------------------------------------------------------

const lintCfg = loadCopyLintConfig();
const plain = (t: string) => { const r = lintCopy(t, lintCfg); assert.ok(r.ok, `${r.hits.map((h) => `${h.phrase} (${h.rule})`).join(", ")}\n${t}`); };
const src = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
const ENV = { BURNTICKER_CLUSTER: "devnet", BURNTICKER_CREATOR_LAUNCHES_ENABLED: "1", BURNTICKER_PAIR_CURVE_ENABLED: "1" } as Record<string, string>;
const CID_A = `0x${"a1".repeat(32)}`, CID_B = `0x${"b2".repeat(32)}`, SLUG = "colorado-governor-election-winner";
const RACE: SettledPick = { shape: "candidates", market: CID_B, race: SLUG, names: { a: "Democratic Party", b: "Republican Party" } };
const GAME: SettledPick = { shape: "game", opp: "BOS", names: { a: "76ers", b: "Celtics" } };
function review(p: SettledPick, o: { descA?: unknown; descB?: unknown; now?: number; pairVoidBy?: string } = {}) {
  const rules = p.shape === "candidates" ? { a: candidatesPairRule(CID_A, DEFAULT_SHARE.oneShot) } : { a: gamePairRule("nba", "0022500001", "PHI", DEFAULT_SHARE.oneShot) };
  const pair = { ...settledPairBody(p, { ticker: p.shape === "candidates" ? "republicans" : "bosvphi", name: "B side", creatorDescription: "", links: [] }), ...(o.descB ? { descCtx: o.descB } : {}) };
  const body = { rule: rules.a, ticker: p.shape === "candidates" ? "DEMOCRATS" : "PHIVBOS", name: "A side", raiseSol: "85", pair, ...(o.descA ? { descCtx: o.descA } : {}) };
  const rv = buildLaunchReview(body as never, { env: ENV, reserved: new Set(), ...(o.now ? { now: o.now } : {}), ...(o.pairVoidBy ? { pairVoidBy: o.pairVoidBy } : {}) });
  assert.ok("review" in rv, JSON.stringify(rv).slice(0, 400));
  return (rv as { review: Extract<ReturnType<typeof buildLaunchReview>, { review: unknown }>["review"] }).review;
}

describe("HB-103 · a 50-50 market in a candidates pair ends one way everywhere ($DEFICIT's burn, as the keeper does)", () => {
  test("When it ends, the RULE VERSION block, Unusual cases and the signed statement agree", () => {
    const r = review(RACE);
    assert.match(r.end.result, /a market settled 50-50, the rest goes to \$DEFICIT's burn/);
    assert.equal(r.end.void, RACE_PAIR_VOID_SENTENCE, "the void sentence is the pair's own, never 'the result is voided'");
    assert.ok(r.settled?.flow.outcomes.some((x) => x.when === "A market settles 50-50" && /at the end each pool goes to \$DEFICIT's burn/.test(x.then)));
    const s = r.rule.statement;
    assert.match(s, /In this pair a 50-50 resolution counts as no single winner, not as a void\./);
    assert.doesNotMatch(s, /a 50-50 resolution is a void/);
    assert.match(s, /When the rule ends void \(a voided pair\)/);
    assert.match(s, /and \$DEFICIT's burn pool otherwise/);
    for (const item of [82, 178]) {
      const line = edgeCaseFor(item, { racePair: true })!;
      assert.doesNotMatch(line, /is void, and nothing burns/, `${item}: ${line}`);
      assert.match(line, /at the end each pool goes to \$DEFICIT's burn/);
      plain(line);
    }
    assert.ok(edgeCaseFor(82, { racePair: true })!.endsWith(RACE_SPLIT_LINE));
    assert.equal(edgeCaseFor(82), edgeCase(82), "a single Polymarket coin keeps its own words");
    assert.equal(CANDIDATES_END_RESULT.includes("a market settled 50-50, the rest goes to $DEFICIT's burn"), true);
    plain(RACE_PAIR_VOID_SENTENCE);
  });
  test("a single Polymarket coin still says a 50-50 resolution is a void", () => {
    assert.match(ruleStatement(candidatesPairRule(CID_A) as BurnRule), /a 50-50 resolution is a void/);
  });
  test("the page passes racePair to the unusual cases", () => {
    assert.match(src("src/app/burnticker/launch/page.tsx"), /racePair: !!rule\.pair\?\.race/);
  });
});

describe("HB-104 · side B of a candidates pair gets its own suggested ticker and its own description", () => {
  test("coins[1].suggestedTicker is not side A's and coins[1].description is side B's paragraph", () => {
    const r = review(RACE, { descA: { eventPhrase: "the Democrats win the Colorado governor race" }, descB: { eventPhrase: "the Republicans win the Colorado governor race" } });
    assert.ok(r.coins[0].suggestedTicker);
    assert.ok(r.coins[1].suggestedTicker);
    assert.notEqual(r.coins[1].suggestedTicker, r.coins[0].suggestedTicker);
    assert.match(String(r.coins[1].suggestedTicker), /REP/);
    assert.equal(typeof r.coins[1].description, "string");
    assert.equal(r.coins[1].description, r.settled?.descriptionB);
    assert.match(String(r.coins[1].description), /Republicans/);
  });
});

describe("HB-105 · a share from another flow never shows as a saved pair's share", () => {
  test("a fresh one-game pair whose page dial still holds the Team default resumes at 100% with no notice", () => {
    const rule = gamePairRule("nhl", "401000001", "COL", 1);
    const m = migrateLinkedShare({ flow: "pair", pairMode: "game", fraction: 0.02, draft: { key: "k", a: rule, b: null } });
    assert.equal(m.notice, null);
    assert.equal(m.draft.fraction, 1);
    const old = migrateLinkedShare({ flow: "pair", pairMode: "game", fraction: 0.02, draft: { key: "k", a: gamePairRule("nhl", "401000001", "COL", 0.5), b: null } });
    assert.match(old.notice ?? "", /had 50% on a linked pair/, "a saved RULE with a share still gets the notice");
  });
});

describe("HB-106 · the draft banner never names a coin from an earlier Which choice", () => {
  const reviewed = { guide: { follow: "rivalry", phase: "review", pairKind: "candidates" }, step: "launch", name: "Weiser vs Marx", ticker: "WEISVMARX" };
  const changed = { guide: { follow: "rivalry", phase: "which", pairKind: "teams" }, step: "pick", name: "Weiser vs Marx", ticker: "WEISVMARX" };
  test("a draft back on the Which step is labelled by what it follows, and the offer is the reviewed draft (what Resume opens)", () => {
    assert.equal(draftLabel(changed), "a rivalry pair, not named yet");
    assert.doesNotMatch(savedDraftLine(changed), /WEISVMARX/);
    assert.deepEqual(pickOffer(changed, reviewed), reviewed, "banner and Resume name the same draft");
    assert.equal(pickOffer(changed, null), changed);
    assert.equal(savedDraftLine(pickOffer(changed, null)!), "You have a draft: a rivalry pair, not named yet.");
    assert.equal(draftLabel({ ...changed, guide: { ...changed.guide, phase: "name" } }), "Weiser vs Marx ($WEISVMARX)", "past the Which step the name is its own");
  });
});

describe("HB-107 · copy residues", () => {
  test("(a) a rule with no end says so in What to know, never 'when the rule ends on a result'", () => {
    assert.equal(upfrontEndLine({ team: false, end: null, pair: false, perpetual: true }), PERPETUAL_UPFRONT_LINE);
    plain(PERPETUAL_UPFRONT_LINE);
    assert.match(src("src/app/burnticker/launch/page.tsx"), /perpetual: !pairOn && windowKindOf\(rule\) === "perpetual"/);
  });
  test("(b) a plural source takes 'confirm'", () => {
    assert.match(src("src/lib/burnticker/describe.ts"), /\/s\$\/\.test\(cross\) \? "confirm" : "confirms"/);
  });
  test("(c) the election office is named once: the fallback link has its own label", () => {
    assert.equal(sosLinkLabel({ name: "the state's election office (U.S. Election Assistance Commission directory)" }), SOS_FALLBACK_LABEL);
    assert.equal(sosLinkLabel({ name: "Michigan Department of State — certified election results" }), "Michigan Department of State — certified election results");
    plain(SOS_FALLBACK_LABEL);
    assert.doesNotMatch(src("src/app/burnticker/launch/page.tsx"), /\{r\.settlement\} — <a/);
  });
  test("(e) a space before the season badge; (f) the meetings list says the visitor's time zone", () => {
    const page = src("src/app/burnticker/launch/page.tsx");
    assert.match(page, /<span className="block font-medium">\{rivalrySeriesLabel\(rv\?\.season\)\}<\/span>/);   // HB-162 (d) (hourly run 15)
    assert.doesNotMatch(page, /Dates are in Denver time/);
    assert.match(page, /data-schedule-source>\{rv\.source\} \{VISITOR_TIME_LINE\}/);
  });
});

describe("HS-42 · leagues whose games cannot end tied say nothing about ties", () => {
  test("NHL, NBA and MLB cannot tie; the NFL and soccer can", () => {
    assert.deepEqual(["nhl", "nba", "mlb", "nfl", "eng.1"].map(leagueCannotTie), [true, true, true, false, false]);
  });
  test("the fade sentence, the pattern words, the one-game end and the review flow drop the tie words for the NBA", () => {
    assert.doesNotMatch(fadeDaySentence("the Avalanche", "win", "The coin", true), /tie/i);
    assert.match(fadeDaySentence("the Broncos", "win"), /A tie is not a win\./);
    assert.equal(patternWords("winner", { follow: "rivalry", pairKind: "teams", rivalryScope: "game", league: "nhl" }).sentence, GAME_PAIR_SENTENCE_NO_TIE);
    assert.equal(patternWords("winner", { follow: "rivalry", pairKind: "teams", rivalryScope: "game", league: "nfl" }).sentence, GAME_PAIR_SENTENCE);
    const r = review(GAME);
    assert.equal(r.end.result, GAME_END_RESULT_NO_TIE);
    assert.equal(r.settled?.sentence, GAME_PAIR_SENTENCE_NO_TIE);
    assert.ok(!r.settled?.flow.outcomes.some((x) => /draw/i.test(x.when)));
    assert.equal(endText(gamePairRule("nfl", "401000002", "DEN") as BurnRule).result.includes("draw"), false, "an unpaired rule is not a pair end");
    assert.doesNotMatch(GAME_END_RESULT_NO_TIE, /draw/); assert.match(GAME_END_RESULT, /draw/);
  });
  test("the worked results drop the tie row for an NHL team coin and keep it for the NFL", () => {
    const rows = (series: string) => simulateResults({ ...gamePairRule("nhl", "401000001", "COL"), series, pair: null } as BurnRule, {}).rows.map((x) => x.case);
    const nhl = rows("espn.team:nhl-COL.1-win-s2026"), nfl = rows("espn.team:nfl-DEN.1-win-s2026");
    assert.ok(!nhl.includes("tie"), nhl.join());
    assert.ok(nfl.includes("tie"), nfl.join());
  });
});

describe("HS-43 · the whole-pool burn says its per-run slice in numbers", () => {
  test("85 SOL raise: about 1.7 SOL a run", () => {
    assert.equal(wholePoolSliceLine("85"), "The whole pool is spent, but not in one go: each daily run spends at most 2% of the trading pool's SOL (about 1.7 SOL on an 85 SOL raise), so a large burn lands over several days.");
    assert.match(wholePoolSliceLine("40"), /about 0\.8 SOL on a 40 SOL raise/);
    plain(wholePoolSliceLine("85"));
    assert.match(budgetCopy(candidatesPairRule(CID_A) as BurnRule, 1, null, { raiseSol: "60" }).line, /^This coin burns its whole pool once, when the result is in\. The whole pool is spent, but not in one go: .*about 1\.2 SOL on a 60 SOL raise/);
  });
});

describe("HS-44 · a one-game pair under 7 days from its game says what has to happen for it to burn", () => {
  const NOW = Date.parse("2026-10-20T03:00:00Z");   // 21:00 Denver on Oct 19
  test("the day word by the Denver calendar, and nothing at 7 days or after the start", () => {
    assert.equal(gameDayWord("2026-10-20T23:00:00Z", NOW), "tomorrow");   // 17:00 Denver Oct 20
    assert.equal(gameDayWord("2026-10-20T05:00:00Z", NOW), "today");      // 23:00 Denver Oct 19
    assert.equal(gameDayWord("2026-10-23T23:00:00Z", NOW), "in 4 days");
    assert.equal(gameDayWord("2026-10-26T23:00:00Z", NOW), null);
    assert.equal(gameDayWord("2026-10-19T23:00:00Z", NOW), null);
  });
  test("the line, with the raise and the void date computed", () => {
    const line = gameSoonLine({ startsAt: "2026-10-20T23:00:00Z", now: NOW, raiseSol: "85", voidBy: "2026-11-19" })!;
    assert.equal(line, "This game is tomorrow. The result is recorded either way, but it burns only if both coins raise 85 SOL and register pools by 19 November 2026. If they do not, the pair is void and each coin burns down its own pool.");
    plain(line);
    assert.equal(gameSoonLine({ startsAt: "2026-11-20T23:00:00Z", now: NOW, raiseSol: "85", voidBy: "2026-11-19" }), null);
  });
  test("the server review returns it first in warnings for a one-game pair", () => {
    const startsAt = "2026-10-20T23:00:00Z";
    const r = review(GAME, { now: NOW, pairVoidBy: "2026-11-19", descA: { game: { opponent: "Celtics", home: true, startsAt } } });
    assert.match(r.warnings[0] ?? "", /^This game is tomorrow\. .*register pools by 19 November 2026\./);
    const far = review(GAME, { now: NOW, pairVoidBy: "2026-11-19", descA: { game: { opponent: "Celtics", home: true, startsAt: "2026-11-01T23:00:00Z" } } });
    assert.ok(!far.warnings.some((w) => /^This game is/.test(w)));
  });
});

describe("HS-45 · the candidate Pick buttons say their state", () => {
  test("aria-pressed, a 'Picked:' name and the hint under the list", () => {
    const page = src("src/app/burnticker/launch/page.tsx");
    assert.match(page, /aria-label=\{`\$\{esel\.includes\(o\.conditionId\) \? "Picked: " : "Pick "\}/);
    assert.match(page, /data-pick-both>\{PICK_BOTH_LINE\}/);
    plain(PICK_BOTH_LINE);
  });
});

describe("HB-102 · the candidates step shows no category blurb and no source filter", () => {
  test("the blurb and the filter sit behind pairKind !== candidates", () => {
    assert.match(src("src/app/burnticker/launch/page.tsx"), /\{guide\.pairKind !== "candidates" && <>\s*<div className="flex flex-wrap items-center gap-2">\s*<p className="text-sm text-neutral-400 flex-1 min-w-0">\{cats\.find/);
  });
});

describe("HB-92 residue · the button's prompt line is walletPromptsLine too", () => {
  test("button and disclosure give the same count and the same sentence", () => {
    for (const [tx, proof] of [[2, true], [4, true], [2, false], [1, true]] as const) {
      const n = walletPromptCount({ transactions: tx, proof });
      assert.ok(signsLine(n, { proof }).startsWith(walletPromptsLine(tx, proof, "plain")), signsLine(n, { proof }));
      assert.match(walletPromptsLine(tx, proof), new RegExp(`asks ${n} `));
      plain(signsLine(n, { proof }));
    }
    assert.doesNotMatch(walletPromptsLine(1, true), /each of the 1 transactions/);
  });
});

describe("HB-99 residue · the home memo is bounded like the pair memo", () => {
  test("a hit inside the window, a background refresh after it, and stale (wait, then no-store with the age) past 45 s", () => {
    assert.equal(HOME_MAX_STALE_MS, 45_000);
    assert.equal(homeMemoState(5_000, 15_000), "hit");
    assert.equal(homeMemoState(20_000, 15_000), "refresh");
    assert.equal(homeMemoState(45_000, 15_000), "stale");
    assert.equal(homeMemoState(547_000, 15_000), "stale", "the 547 s answer of run 8");
    assert.equal(homeMaxStaleMs(120_000), 150_000, "a long memo window is never stale inside itself");
    const route = src("src/app/api/burnticker/home/route.ts");
    assert.match(route, /SWR_BUILD_TIMEOUT_MS/);
    assert.match(route, /"cache-control": "no-store", "x-home-memo": "stale", "x-home-age-sec"/);
    assert.match(route, /if \(mine > homeWritten\)/);
  });
});

describe("HB-109 · the home card never says 'Burns once' on a losing pair coin", () => {
  const base: StatusInput = { status: "live", ticker: "SEAWIN", name: "Seahawks win", rules: { oneShot: true }, profile: { badge: "ONE-SHOT · Oct 15, 2026", oneLiner: "burns when the Seahawks win", sideName: "Seahawks" }, market: { phase: "curve" }, pair: { counterpart: { name: "Broncos win" }, clause: { state: "waiting", voidBy: "2026-11-14" } } };
  const rec = (pairRole: "won" | "lost") => [{ status: "pending-pair", units: 1, settledAt: "2026-10-16T06:00:00Z", pairRole, result: pairRole === "won" ? "win" : "loss" }];
  test("SEAWIN lost: the tail says it cannot burn on this result; DENWIN won: the tail names the void date", () => {
    const lost = coinStatusSentence(coinStatusFactsOf(base, rec("lost"), { profile: { sideName: "Broncos" } }));
    assert.equal(lost, "Decided: Broncos won. $SEAWIN lost, so this result cannot make it burn.");
    const won = coinStatusSentence(coinStatusFactsOf({ ...base, ticker: "DENWIN", profile: { ...base.profile, sideName: "Broncos" } }, rec("won")));
    assert.equal(won, "Decided: Broncos won. Burns if both coins graduate by 14 November 2026; otherwise the pair is voided.");
    plain(lost); plain(won);
  });
});

describe("HB-110 · the build JSON names both public commits and the changelog says the programs were not rebuilt", () => {
  test("the note and the copy", () => {
    assert.match(PUBLIC_COMMIT_NOTE, /releaseCommit is that release commit, the one the changelog and \/v1\/trust link/);
    assert.equal(RELEASE_LINES.programNotRecorded, "This release did not rebuild the programs.");
  });
});

describe("HB-25 residue · status.lifecycleState says what the coin is doing; status.status stays the row state", () => {
  test("a decided pair coin is 'decided' while its row stays 'live'", () => {
    const s = { status: "live", rules: { oneShot: true }, next: { result: "decided" }, selectorKey: "catalogue:espn.game:nfl-1-SEA-win", profile: { badge: "ONE-SHOT · Oct 15, 2026" }, pair: { clause: { state: "waiting", voidBy: "2026-11-14" } } };
    const receipts = [{ status: "pending-pair", settledAt: "2026-10-16T06:00:00Z", pairRole: "lost" }];
    assert.equal(coinLifecycleState(s, receipts), "decided");
    assert.equal(s.status, "live");
    assert.equal(coinLifecycleState({ ...s, next: { result: "pending" } }, []), "live");
    assert.equal(coinLifecycleState({ ...s, pair: { clause: { state: "voided", voidBy: null } } }, receipts), "voided");
    assert.equal(coinLifecycleState({ ...s, status: "retired" }, receipts), "retired");
    assert.equal(coinLifecycleState({ ...s, lifecycle: { ended: { mode: "winddown" } } }, receipts), "ended");
  });
  test("the token status, the badge JSON and the home rows carry it; the API docs say which is which", () => {
    assert.match(src("src/lib/burnticker/server.ts"), /status\.lifecycleState = coinLifecycleState\(status, receipts\);/);
    assert.match(src("src/lib/burnticker/badge.ts"), /lifecycleState: coinLifecycleState\(s, i\.receipts\),/);
    assert.match(src("src/lib/burnticker/upcoming.ts"), /const dp = lifecycleState === "decided" \? decidedPairOf\(s, receipts\) : null;/);
    const api = path.join(ROOT, "docs", "burnticker", "API.md");
    if (fs.existsSync(api)) assert.match(fs.readFileSync(api, "utf8"), /`status\.status` is the registry row state, and `status\.lifecycleState` is what the coin is doing now/);
  });
});
