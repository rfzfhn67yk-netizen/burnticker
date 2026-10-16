// BURN DISPERSAL ON THE KEEPERS (owner decision 2026-10-13 night): the platform keeper (multiKeeper.ts runCycle, BURNTICKER_DISPERSAL)
// and the $DEFICIT keeper (programChain.ts executeDispersal) drain a reading's carried spend through crank_carried on the in-memory
// program — pieces at random times at least 20 minutes apart, each its own signed transaction and receipt, the status line, the
// 24-hour bt-burn-behind alert and its push mapping, the write-ahead piece surviving a dropped send, and the private send route.
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey, type Connection } from "@solana/web3.js";
import { openRegistry, type Registry } from "@/lib/burnticker/registry";
import { FakeBurnProgram } from "@/lib/burnticker/program";
import { buildLaunchBundle, FakeLaunchLab } from "@/lib/burnticker/launchBundle";
import { KalshiClient, fixtureFetch, settledMarketsUrl, seriesApiUrl, openMarketsUrl } from "@/lib/burnticker/oracle/kalshi";
import { CatalogueAdapter, feedById, loadFixture } from "@/lib/burnticker/catalogue";
import { runCycle, type KeeperDeps } from "@/lib/burnticker/multiKeeper";
import { buildReceiptsJson, buildTokenStatus, renderTokenHtml } from "@/lib/burnticker/tokenPage";
import { programPageBlock } from "@/lib/burnticker/program";
import { DISPERSAL_STATE_KEY, dispersalLines, runDispersal, TOO_SOON_MIN_RETRY_MS, type DispersalDeps } from "@/lib/burnticker/dispersalKeeper";
import { budgetGapMs, chunkCeiling, DISPERSAL_MIN_GAP_MS, planWindow, PROGRAM_BUDGET_WINDOW_MS, stateFromJson } from "@/lib/burnticker/dispersal";
import { CARRIED_BUDGET_WINDOW_SECS } from "@/lib/burnReceipts/constants";
import { carriedBudgetReadySec } from "@/lib/burnReceipts/math";
import type { ProgramPort, SignedTx } from "@/lib/burnKeeper/programPort";
import { PUSH_KIND_OF_ALERT, PUSH_LEAD, PUSH_TITLE } from "@/lib/burnticker/push";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import { openLedger } from "@/lib/burnKeeper/ledger";
import { ingest, type KeeperCtx } from "@/lib/burnKeeper/cycle";
import { deficitDispersalLines, executeDispersal, executeProgramPending } from "@/lib/burnKeeper/programChain";
import { FakeProgram } from "@/lib/burnKeeper/fakeProgram";
import { usdToCents } from "@/lib/burnKeeper/rules";
import { buildBurnsJson, buildStatus, renderIndexHtml } from "@/lib/burnKeeper/statusPage";
import { PRIVATE_SEND_ENV, privateSender, privateSenderFromEnv, redactUrl } from "@/lib/burnKeeper/privateSend";
import { solanaProgramPort } from "@/lib/burnKeeper/programAdapter";
import type { DebtReading } from "@/lib/burnKeeper/feeds/treasury";
import { BRONCOS, NOW, fx, treasuryAndCrossFetch } from "./burntickerHelpers.ts";
import { buybackRules } from "./burnKeeperHelpers.ts";

const CREATOR = "CreatorWa11et111111111111111111111111111111";
const ATTESTER = "KeeperDataKey1111111111111111111111111111111";
const SOL = BigInt(1_000_000_000);
const H = 3_600_000;
const table = {
  [settledMarketsUrl("KXNFLGAME")]: fx("kalshi/KXNFLGAME.settled.json"), [seriesApiUrl("KXNFLGAME")]: fx("kalshi/series.KXNFLGAME.json"), [openMarketsUrl("KXNFLGAME")]: { cursor: "", markets: [] },
};
const treasuryBody = loadFixture(feedById("treasury.debt")!).body;

let reg: Registry, program: FakeBurnProgram, deps: KeeperDeps, lines: string[], clock: number;
async function launch(ticker: string) {
  const b = await buildLaunchBundle({ creator: CREATOR, ticker, name: `${ticker} coin`, description: "a test", imageUrl: null, links: [], rule: BRONCOS, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true }, cluster: "devnet" }, { program, launchLab: new FakeLaunchLab(), devFeeWallet: null, attesters: [ATTESTER], quorum: 1, metadataUri: (m) => `https://x/${m}.json` });
  const t = reg.register({ mint: b.mint, ticker, name: b.name, creator: CREATOR, description: b.description, imageUrl: null, links: [], rulesText: b.rules.text, feePda: b.addresses.feePda, vault: b.addresses.vault, tokenConfig: b.addresses.tokenConfig, poolId: b.addresses.poolId, launchTx: null, cluster: "devnet", platformId: b.addresses.platformId, baselineAt: "2026-09-01T00:00:00Z", status: "draft" }, clock);
  reg.markLaunched(t.mint, `launch${ticker}`, b.addresses.poolId, "2026-09-01T00:00:00Z");
  reg.addAttester({ mint: t.mint, pubkey: ATTESTER, role: "data-key", addedAt: clock, timelockUntil: null });
  if (program.tokens.has(t.mint)) program.supplies.set(t.mint, BigInt("1000000000000000"));
  return reg.token(t.mint)!;
}
beforeEach(() => {
  reg = openRegistry(":memory:"); program = new FakeBurnProgram("devnet"); program.now = () => clock; lines = []; clock = NOW;
  deps = { registry: reg, program, oracles: { kalshi: new KalshiClient({ fetchImpl: fixtureFetch(table), now: () => clock, minIntervalMs: 0 }), catalogue: new CatalogueAdapter({ fetchImpl: treasuryAndCrossFetch(treasuryBody), now: () => clock }) }, attester: ATTESTER, log: (s) => lines.push(s), now: () => clock, dryRun: false, dispersal: true };
});

/** A Broncos coin whose YES day spends 0.1 SOL (2 % of 5 SOL) against a 2 SOL pool: the crank spends 0.04 (2 %) and carries 0.06. */
async function carriedCoin() {
  const t = await launch("BRONCO");
  program.deposit(t.mint, BigInt(5) * SOL);
  const f = program.fake(t.mint);
  f.poolReserveWsol = BigInt(2) * SOL;
  return { t, f };
}

/** Runs cycles every 5 minutes until the carried amount is zero (or the limit), collecting each landed piece. */
async function drainCycles(f: FakeProgram, limitMs = 30 * H) {
  const pieces: { at: number; signature: string; spent: bigint }[] = [];
  const end = clock + limitMs;
  while (clock < end) {
    const r = await runCycle(deps, { fetch: false });
    for (const d of r.dispersal ?? []) if (d.action === "landed") pieces.push({ at: clock, signature: d.signature!, spent: d.spentLamports! });
    if (f.cfg.carriedSpendLamports === BigInt(0)) break;
    clock += 5 * 60_000;
  }
  return pieces;
}

describe("the platform keeper (runCycle with dispersal on)", () => {
  test("a reading's carried spend is drained by crank_carried pieces: each its own transaction and receipt, ≥ 20 min apart, inside a 6-hour window", async () => {
    const { t, f } = await carriedCoin();
    const first = await runCycle(deps);
    assert.equal(first.executed[0].outcome, "confirmed");
    const carried = f.cfg.carriedSpendLamports;
    assert.ok(carried > BigInt(0), "the reading's crank carried part of its spend");
    const rd = f.readings.get(f.cfg.crankCursor)!;
    assert.equal(rd.carriedOutLamports, carried);
    const pieces = await drainCycles(f);
    assert.equal(f.cfg.carriedSpendLamports, BigInt(0), "drained to zero");
    assert.equal(pieces.length, 3, "0.06 SOL in pieces of at most 1.227 % of 2 SOL (0.0245)");
    assert.equal(pieces.reduce((a, p) => a + p.spent, BigInt(0)), carried);
    assert.equal(new Set(pieces.map((p) => p.signature)).size, 3, "one transaction per piece");
    for (let i = 1; i < pieces.length; i++) assert.ok(pieces[i].at - pieces[i - 1].at >= DISPERSAL_MIN_GAP_MS - 5 * 60_000, "spread out, not back to back");
    assert.ok(pieces[pieces.length - 1].at - NOW <= 6 * H + 10 * 60_000, "inside the first window");
    // each piece's receipt: the signature, the program's `carried` memo, the amount
    const st = stateFromJson(reg.getStatus(DISPERSAL_STATE_KEY(t.mint)));
    assert.equal(st.receipts.length, 3);
    for (const r of st.receipts) { assert.match(r.memo!, /^BRONCO\|carried\|through=2026-09-28\|spent=\d+\|/); assert.equal(r.throughDate, 20260928); }
    assert.equal(st.debts.length, 0, "the reading is fully spent");
    assert.ok(lines.some((l) => /\[dispersal\] \$BRONCO: spent 0\.0\d+ SOL of the carried amount \(piece 1 of 3 this window\)/.test(l)), lines.join("\n"));
  });

  test("the status page carries the plain-English line while a reading is being spent", async () => {
    const { t, f } = await carriedCoin();
    await runCycle(deps);
    // one piece lands
    while (stateFromJson(reg.getStatus(DISPERSAL_STATE_KEY(t.mint))).receipts.length < 1) { clock += 5 * 60_000; await runCycle(deps, { fetch: false }); }
    const ls = dispersalLines(reg.getStatus(DISPERSAL_STATE_KEY(t.mint)));
    assert.equal(ls.length, 1);
    assert.match(ls[0], /^spent 0\.0\d+ of 0\.1 SOL for the reading of 2026-09-28; remainder being spent$/);
    const cfg = loadCopyLintConfig();
    assert.ok(lintCopy(ls[0], cfg).ok, JSON.stringify(lintCopy(ls[0], cfg).hits));
    const locked = reg.lockedRule(t);
    const input = { token: t, locked, readings: reg.readings(t.selectorKey, t.baselineAt), receipts: reg.receipts(t.mint), attesters: reg.attesters(t.mint), state: reg.state(t.mint), feedState: reg.feedState(t.selectorKey),
      chain: { cluster: "devnet", programId: program.programId, supplyRaw: null, feePdaLamports: f.feeLamports, vaultRaw: null, program: await programPageBlock(program, t.mint, null, ls) },
      now: clock, nextCheckAt: null, implied: null, seriesTitle: null, selectorPending: 0, operator: { can: ["crank a burn the rule computes"], cannot: ["change a rule"], placeholder: true }, pair: null } as unknown as Parameters<typeof buildTokenStatus>[0];
    const receipts = buildReceiptsJson(input);
    const status = buildTokenStatus(input, receipts);
    assert.deepEqual(status.program!.queue.dispersal, ls);
    const html = renderTokenHtml(status, receipts, []);
    assert.match(html, /bought in small pieces at random times over six-hour windows/);
    assert.match(html, /Spent 0\.0\d+ of 0\.1 SOL for the reading of 2026-09-28; remainder being spent\./);
  });

  test("off by default: without the flag no piece is sent and the carried amount waits for the next reading", async () => {
    const { f } = await carriedCoin();
    deps.dispersal = false;
    await runCycle(deps);
    const carried = f.cfg.carriedSpendLamports;
    for (let i = 0; i < 100; i++) { clock += 5 * 60_000; const r = await runCycle(deps, { fetch: false }); assert.equal(r.dispersal, undefined); }
    assert.equal(f.cfg.carriedSpendLamports, carried);
  });

  test("24 hours behind: bt-burn-behind is recorded once for the reading and maps to a plain push", async () => {
    const { t, f } = await carriedCoin();
    await runCycle(deps);
    f.twap = "deviation";   // every piece deferred
    for (let i = 0; i < 26 * 12; i++) { clock += 5 * 60_000; await runCycle(deps, { fetch: false }); }
    const alerts = reg.alertsSince(0).filter((a) => a.kind === "bt-burn-behind");
    assert.equal(alerts.length, 1, "one alert per reading");
    assert.equal(alerts[0].key, `${t.mint}:20260928`);
    assert.match(alerts[0].text, /^\$BRONCO: the reading of 2026-09-28 is not fully spent a day after it landed\. Spent 0\.04 of 0\.1 SOL for the reading of 2026-09-28; remainder being spent\.$/);
    assert.equal(PUSH_KIND_OF_ALERT["bt-burn-behind"], "burn-behind");
    const cfg = loadCopyLintConfig();
    for (const s of [PUSH_TITLE["burn-behind"], PUSH_LEAD["burn-behind"], alerts[0].text]) assert.ok(lintCopy(s, cfg).ok, `${s}: ${JSON.stringify(lintCopy(s, cfg).hits)}`);
    assert.ok(lines.some((l) => /deferred by the program \(TwapDeviation\); retrying in 10 min/.test(l)));
    // the pool recovers: the pieces resume and the reading drains
    f.twap = "ok";
    await drainCycles(f);
    assert.equal(f.cfg.carriedSpendLamports, BigInt(0));
  });

  test("a dropped send: the piece's signature is on record; no second piece is signed until it resolves; a late landing is its receipt", async () => {
    const { t, f } = await carriedCoin();
    await runCycle(deps);
    f.dropSends = true;
    let st = stateFromJson(reg.getStatus(DISPERSAL_STATE_KEY(t.mint)));
    while (!st.inflight) { clock += 5 * 60_000; await runCycle(deps, { fetch: false }); st = stateFromJson(reg.getStatus(DISPERSAL_STATE_KEY(t.mint))); }
    const sig = st.inflight.signature;
    const signedBefore = f.signed.filter((s) => s.payload.kind === "carried").length;
    for (let i = 0; i < 12; i++) { clock += 5 * 60_000; await runCycle(deps, { fetch: false }); }
    assert.equal(f.signed.filter((s) => s.payload.kind === "carried").length, signedBefore, "no second piece while one may land");
    f.dropSends = false; f.land(sig);
    clock += 5 * 60_000; await runCycle(deps, { fetch: false });
    st = stateFromJson(reg.getStatus(DISPERSAL_STATE_KEY(t.mint)));
    assert.equal(st.inflight, null);
    assert.equal(st.receipts[0].signature, sig);
    assert.ok(lines.some((l) => /a piece landed after a restart/.test(l)));
  });

  test("a second reading lands mid-window: its crank pays the older carried amount first, the plan re-sizes, both drain to zero", async () => {
    const { t, f } = await carriedCoin();
    await runCycle(deps);
    const D1 = f.cfg.crankCursor;
    // one piece, then a new reading's crank carries more (someone else's crank: permissionless)
    while (stateFromJson(reg.getStatus(DISPERSAL_STATE_KEY(t.mint))).receipts.length < 1) { clock += 5 * 60_000; await runCycle(deps, { fetch: false }); }
    const before = f.cfg.carriedSpendLamports;
    // a stranger submits and cranks a further unit day straight on the fake
    const prev = f.cfg.lastRecordDate, value = f.cfg.lastValue;
    const tx = await f.buildReading({ recordDate: 20260929, prevDate: prev, value: value + BigInt(1), sourceUrl: "burnticker://BRONCO/units/2026-09-29", feedId: f.cfg.feedId, valueDecimals: f.cfg.valueDecimals });
    await f.send(tx.raw);
    assert.ok(f.strangerCrank());
    assert.ok(f.cfg.carriedSpendLamports > before, "the new reading carried more");
    await drainCycles(f);
    assert.equal(f.cfg.carriedSpendLamports, BigInt(0));
    const st = stateFromJson(reg.getStatus(DISPERSAL_STATE_KEY(t.mint)));
    assert.equal(st.cursor, 20260929);
    assert.ok(st.receipts.some((r) => r.throughDate === D1) && st.receipts.some((r) => r.throughDate === 20260929));
    assert.equal(st.debts.length, 0);
  });
});

describe("round-5 review R5-8: the program's carried budget (one cap per 600 s; the keeper waits, never gives a piece up)", () => {
  /** A carried coin (the reading cranked, dispersal not yet run) and a runDispersal harness over its own state. */
  async function harness() {
    const { f } = await carriedCoin();
    deps.dispersal = false;
    await runCycle(deps);
    assert.ok(f.cfg.carriedSpendLamports > BigInt(0));
    let json: string | null = null;
    const log: string[] = [];
    const run = (port: ProgramPort = f) => runDispersal({ port, mint: f.mint, ticker: "BRONCO", load: () => json, save: (j) => { json = j; }, log: (l) => log.push(l), now: () => clock, dryRun: false } satisfies DispersalDeps);
    const state = () => stateFromJson(json);
    // the first wake plans the window; its first piece is due at T
    const first = await run();
    assert.equal(first.action, "wait");
    const T = state().window!.chunks[0].atMs;
    const cap = (f.poolReserveWsol * BigInt(200)) / BigInt(10_000);
    return { f, run, state, log, T, cap, piece: () => state().window!.chunks[state().window!.done].lamports, signedCarried: () => f.signed.filter((x) => x.payload.kind === "carried").length };
  }
  /** Forwards everything to the fake except the named overrides (`this` stays the fake). */
  const port = (f: FakeProgram, over: Partial<Record<keyof ProgramPort, unknown>>): ProgramPort =>
    new Proxy(f, { get(t, k) { if (k in over) return over[k as keyof ProgramPort]; const v = Reflect.get(t, k, t); return typeof v === "function" ? v.bind(t) : v; } }) as unknown as ProgramPort;
  const sec = (ms: number) => Math.floor(ms / 1000);

  test("the plan spaces pieces by the program's budget, never closer than it refills a full-size piece", () => {
    assert.equal(PROGRAM_BUDGET_WINDOW_MS, CARRIED_BUDGET_WINDOW_SECS * 1000);
    const cap = BigInt(40_000_000);
    assert.deepEqual([budgetGapMs(cap, cap), budgetGapMs(cap / BigInt(2), cap), budgetGapMs(cap * BigInt(3), cap), budgetGapMs(BigInt(1), cap)], [600_000, 300_000, 600_000, 1]);
    assert.ok(DISPERSAL_MIN_GAP_MS >= budgetGapMs(cap, cap), "the default 20-minute gap always lets the budget refill");
    const reserve = BigInt(2) * SOL;
    const w = planWindow({ carriedLamports: BigInt(10) * SOL, reserveLamports: reserve, now: NOW, seed: 7, minGapMs: 1_000 });
    const need = budgetGapMs(chunkCeiling(reserve), (reserve * BigInt(200)) / BigInt(10_000));
    assert.ok(need > 1_000);
    for (let i = 1; i < w.chunks.length; i++) assert.ok(w.chunks[i].atMs - w.chunks[i - 1].atMs >= need, "a smaller gap asked for is raised to the budget's");
  });

  test("another cranker spent the whole budget a minute before our piece: the keeper waits until it refills, then lands (counted apart from burns)", async () => {
    const h = await harness();
    const burns = h.f.cfg.burns;
    h.f.lastCarriedAt = sec(h.T) - 60;      // anyone may crank: a full-cap piece landed a minute before ours was due
    h.f.carriedBudgetLamports = BigInt(0);
    clock = h.T;
    const L = h.piece();
    const ready = carriedBudgetReadySec(h.f.lastCarriedAt, BigInt(0), h.cap, L, sec(clock))!;
    assert.ok(ready > sec(clock));
    const r = await h.run();
    assert.equal(r.action, "wait");
    assert.equal(r.nextDueAt, clock + (ready - sec(clock)) * 1000, "the wake is set to the second the budget fits the piece");
    assert.match(r.why!, /carried budget refills/);
    assert.equal(h.signedCarried(), 0, "nothing signed over the budget");
    assert.equal(h.state().window!.done, 0, "the piece is not given up");
    clock = r.nextDueAt!;
    const r2 = await h.run();
    assert.equal(r2.action, "landed", r2.why);
    assert.equal(h.f.carriedPieces, 1);
    assert.equal(h.f.cfg.burns, burns, "a carried piece does not count in burns");
    assert.match(h.state().receipts[0].memo!, /\|left=\d+\|piece=1\|swap=/);
  });

  test("a dust piece by someone else a second earlier takes only a dust budget: the keeper's piece lands at once", async () => {
    const h = await harness();
    h.f.lastCarriedAt = sec(h.T) - 1;
    h.f.carriedBudgetLamports = h.cap - h.f.cfg.floorLamports;   // a floor-size piece spent
    clock = h.T;
    const r = await h.run();
    assert.equal(r.action, "landed", r.why);
  });

  test("a lagging cluster clock: the wait is measured on the chain's clock", async () => {
    const h = await harness();
    h.f.lastCarriedAt = sec(h.T) - 60;
    h.f.carriedBudgetLamports = BigInt(0);
    clock = h.T;
    const lag = 20;
    const lagging = port(h.f, { carriedPace: async () => ({ lastCarriedAt: h.f.lastCarriedAt, budgetLamports: BigInt(0), chainNowSec: sec(clock) - lag }) });
    const ready = carriedBudgetReadySec(h.f.lastCarriedAt, BigInt(0), h.cap, h.piece(), sec(clock) - lag)!;
    const r = await h.run(lagging);
    assert.equal(r.action, "wait");
    assert.equal(r.nextDueAt, clock + (ready - (sec(clock) - lag)) * 1000, "20 s later than the local clock would say");
  });

  test("a port that cannot read the budget: the plan says too-soon and the keeper waits until then", async () => {
    const h = await harness();
    h.f.lastCarriedAt = sec(h.T) - 30;
    h.f.carriedBudgetLamports = BigInt(0);
    clock = h.T;
    const r = await h.run(port(h.f, { carriedPace: undefined }));
    assert.equal(r.action, "wait");
    assert.equal(r.why, "too-soon");
    const ready = carriedBudgetReadySec(h.f.lastCarriedAt, BigInt(0), h.cap, h.piece(), sec(clock))!;
    assert.equal(r.nextDueAt, clock + (ready - sec(clock)) * 1000);
    assert.equal(h.signedCarried(), 0);
  });

  test("a race (the budget read before another piece landed): CarriedTooSoon in simulation waits at least 30 s, the piece is kept", async () => {
    const h = await harness();
    h.f.lastCarriedAt = sec(h.T) - 10;
    h.f.carriedBudgetLamports = BigInt(0);
    clock = h.T;
    const mk = (m: bigint) => (h.f as unknown as { mk(p: unknown): Promise<SignedTx> }).mk({ kind: "carried", maxSpend: m });
    // the port's view says "ready now" (stale, or a clock that runs ahead): no wait before the send; the program refuses
    const stale = port(h.f, { carriedPace: async () => ({ lastCarriedAt: 0, budgetLamports: BigInt(0), chainNowSec: null }), planCarried: async (m: bigint) => ({ build: () => mk(m) }) });
    const r = await h.run(stale);
    assert.equal(r.action, "wait");
    assert.equal(r.why, "CarriedTooSoon");
    assert.equal(r.nextDueAt, clock + TOO_SOON_MIN_RETRY_MS, "never a retry every second");
    assert.equal(h.state().window!.done, 0, "the piece is kept");
    assert.ok(h.log.some((l) => /waits for the program's carried budget/.test(l)), h.log.join("\n"));
    // the retry, once the budget has refilled: the real view, the piece lands
    clock = Math.max(r.nextDueAt!, (h.f.lastCarriedAt + CARRIED_BUDGET_WINDOW_SECS) * 1000);
    const r2 = await h.run();
    assert.equal(r2.action, "landed", r2.why);
  });
});

describe("the $DEFICIT keeper (executeDispersal on its ledger)", () => {
  const R = (d: string, a: string): DebtReading => ({ recordDate: d, amount: a, cents: usdToCents(a) });
  const D7 = R("2026-10-07", "40284036147367.19"), D8 = R("2026-10-08", "40305316210829.72"); // 21 units
  test("the same dispersal: pieces through crank_carried until zero, receipts in the ledger's status table, the status page line", async () => {
    const loaded = buybackRules();
    let now = Date.parse("2026-10-09T21:00:00Z");
    const ledger = openLedger(":memory:");
    const log: string[] = [];
    const prog = new FakeProgram({ mode: "buyback", rulesSha256: loaded.sha256, memoPrefix: loaded.rules.memo.prefix, memoSource: loaded.rules.feed.memoSource, unitValue: BigInt(100_000_000_000), fractionPerUnitBps: 200, floorLamports: BigInt(1_000_000), reserveLamports: BigInt(20_000_000), attesters: [ATTESTER], now: () => now });
    const ctx: KeeperCtx = { ledger, loaded, log: (s) => log.push(s), now: () => now, dryRun: false };
    prog.registerPool(); prog.deposit(BigInt(5) * SOL); prog.poolReserveWsol = BigInt(20) * SOL;   // cap 0.4 SOL; the rule spends ~1.73 SOL
    ingest(ctx, { readings: [D7, D8], refusals: [] });
    await executeProgramPending(ctx, prog);
    const carried = prog.cfg.carriedSpendLamports;
    assert.ok(carried > SOL, `${carried}`);
    const alerts: string[] = [];
    let landed = 0;
    for (let i = 0; i < 24 * 12 && prog.cfg.carriedSpendLamports > BigInt(0); i++) {
      const r = await executeDispersal(ctx, prog, { alert: (a) => alerts.push(a.text) });
      if (r.action === "landed") landed++;
      now += 5 * 60_000;
    }
    assert.equal(prog.cfg.carriedSpendLamports, BigInt(0));
    assert.ok(landed >= 6, `${landed} pieces (≤ 0.245 SOL each against a 20 SOL pool)`);
    assert.deepEqual(alerts, [], "drained inside a day: no alert");
    assert.deepEqual(deficitDispersalLines(ledger, prog.mint), []);
    assert.equal(prog.cfg.crankCursor, 20261008, "the cursor never moved");
  });
  test("the status page shows the line while the reading is being spent", async () => {
    const loaded = buybackRules();
    let now = Date.parse("2026-10-09T21:00:00Z");
    const ledger = openLedger(":memory:");
    const prog = new FakeProgram({ mode: "buyback", rulesSha256: loaded.sha256, memoPrefix: loaded.rules.memo.prefix, memoSource: loaded.rules.feed.memoSource, unitValue: BigInt(100_000_000_000), fractionPerUnitBps: 200, floorLamports: BigInt(1_000_000), reserveLamports: BigInt(20_000_000), attesters: [ATTESTER], now: () => now });
    const ctx: KeeperCtx = { ledger, loaded, log: () => {}, now: () => now, dryRun: false };
    prog.registerPool(); prog.deposit(BigInt(5) * SOL); prog.poolReserveWsol = BigInt(20) * SOL;
    ingest(ctx, { readings: [D7, D8], refusals: [] });
    await executeProgramPending(ctx, prog);
    await executeDispersal(ctx, prog);   // accounts the reading
    const ls = deficitDispersalLines(ledger, prog.mint);
    assert.equal(ls.length, 1);
    assert.match(ls[0], /^spent 0\.4 of 1\.\d+ SOL for the reading of 2026-10-08; remainder being spent$/);
    const input = { loaded, readings: ledger.readings("DEBT", "treasury.debt_to_penny"), burns: ledger.burns("DEBT", "treasury.debt_to_penny"), now, nextPollAt: null, lastPoll: null, lastError: null, chain: { cluster: "localnet", mint: prog.mint, vault: prog.feePda, keeper: ATTESTER, supplyRaw: prog.supply, vaultRaw: null, feeLamports: prog.feeLamports },
      program: { programId: prog.programId, configAddress: prog.configAddress, feePda: prog.feePda, config: { ...prog.cfg }, feePdaLamports: prog.feeLamports, programReadings: ledger.programReadings("DEBT", "treasury.debt_to_penny"), keeperAttesterKeys: prog.attesterKeys(), lastHealth: null, dispersal: ls } };
    const burns = buildBurnsJson(input);
    const s = buildStatus(input, burns);
    assert.deepEqual(s.program!.queue.dispersal, ls);
    assert.match(renderIndexHtml(s, burns, []), /Spent 0\.4 of 1\.\d+ SOL for the reading of 2026-10-08; remainder being spent\./);
    void now;
  });
});

describe("the private send route (BURNTICKER_PRIVATE_SEND_URL)", () => {
  const URL_WITH_KEY = "https://user:pa55@mainnet.block-engine.example/api/v1/transactions?uuid=SECRET-TOKEN";
  test("sendTransaction as JSON-RPC base64; the URL's credentials are never in a label or an error", async () => {
    const calls: { url: string; body: string }[] = [];
    const s = privateSender(URL_WITH_KEY, async (url, init) => { calls.push({ url, body: init.body }); return { ok: true, status: 200, json: async () => ({ jsonrpc: "2.0", id: 1, result: "SIG" }) }; });
    assert.equal(await s.send(new Uint8Array([1, 2, 3])), "SIG");
    assert.equal(calls[0].url, URL_WITH_KEY);
    assert.deepEqual(JSON.parse(calls[0].body), { jsonrpc: "2.0", id: 1, method: "sendTransaction", params: ["AQID", { encoding: "base64" }] });
    assert.equal(s.label, "private route https://mainnet.block-engine.example");
    const bad = privateSender(URL_WITH_KEY, async () => ({ ok: false, status: 429, json: async () => ({ error: { message: "rate limited" } }) }));
    await assert.rejects(bad.send(new Uint8Array([1])), (e: Error) => /refused \(HTTP 429: rate limited\)/.test(e.message) && !/SECRET|pa55|user/.test(e.message));
    const down = privateSender(URL_WITH_KEY, async () => { throw new Error(`connect ECONNREFUSED ${URL_WITH_KEY}`); });
    await assert.rejects(down.send(new Uint8Array([1])), (e: Error) => /unreachable/.test(e.message) && !/SECRET|pa55/.test(e.message));
    assert.equal(redactUrl(URL_WITH_KEY), "https://mainnet.block-engine.example");
    assert.throws(() => privateSender("ftp://x"), /must be an https URL/);
  });
  test("unset: no route (the port sends through its RPC); set: the program port's send and its rebroadcasts go through it", async () => {
    assert.equal(privateSenderFromEnv({}), null);
    assert.equal(PRIVATE_SEND_ENV, "BURNTICKER_PRIVATE_SEND_URL");
    const routed: number[] = [], rpc: number[] = [];
    const connection = { sendRawTransaction: async (raw: Uint8Array) => { rpc.push(raw.length); return "x"; } } as unknown as Connection;
    const base = { connection, programId: new PublicKey("AuQjoSgq7upmyPBv2itwy2TSZ1VjoVipyy4z9wd7zhMM"), mint: Keypair.generate().publicKey, cluster: "devnet" as const, payer: Keypair.generate(), attesters: [] };
    const logs: string[] = [];
    const viaRoute = solanaProgramPort({ ...base, log: (s) => logs.push(s), privateSend: { label: "private route https://h", send: async (raw) => { routed.push(raw.length); return null; } } });
    await viaRoute.send(new Uint8Array(5));
    assert.deepEqual([routed, rpc], [[5], []]);
    assert.ok(logs.some((l) => /go through the private route https:\/\/h/.test(l)));
    const plain = solanaProgramPort({ ...base, privateSend: null });
    await plain.send(new Uint8Array(7));
    assert.deepEqual(rpc, [7]);
    assert.equal(typeof plain.planCarried, "function");
    assert.equal(typeof plain.poolSolReserve, "function");
  });
});
