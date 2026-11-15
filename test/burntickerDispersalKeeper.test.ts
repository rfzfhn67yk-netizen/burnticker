// BURN DISPERSAL ON THE KEEPERS (owner decision 2026-10-13 night; simplified by the owner decision of 2026-10-25): the platform keeper
// (multiKeeper.ts runCycle, BURNTICKER_DISPERSAL) and the $DEFICIT keeper (programChain.ts executeDispersal) drain a coin's carried spend
// through ONE crank_carried piece for the whole carried amount on the in-memory program (no per-run bound, no carried budget, no
// windows), its receipt, the status line, the 24-hour bt-burn-behind alert and its push mapping, the write-ahead piece surviving a
// dropped send, the one-piece-per-second pacing, small pools that are never stuck, and the private send route.
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
import { stateFromJson } from "@/lib/burnticker/dispersal";
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

/**
 * A Broncos coin whose YES day (0.1 SOL: 2 % of 5 SOL, against a 2 SOL pool) is CARRIED whole. Since the owner decision of 2026-10-25 a
 * crank spends its whole target in one run, so a burn-sized spend is carried only when the pool has been untradeable for 30 days (the
 * program then processes the reading below-floor with its target carried, review-2 F7) or the minimum output is 0. The pool here has
 * been untradeable for 31 days; `reopen()` makes it tradeable again, and dispersal then drains the carry in one piece.
 */
async function carriedCoin() {
  const t = await launch("BRONCO");
  program.deposit(t.mint, BigInt(5) * SOL);
  const f = program.fake(t.mint);
  f.poolReserveWsol = BigInt(2) * SOL;
  const s = Math.floor(clock / 1000);
  f.poolTradable = false;
  f.cfg = { ...f.cfg, poolUntradeableSince: s - 31 * 86_400, poolUntradeableLastSeen: s - 3_600 };
  const reopen = () => { f.poolTradable = true; };
  return { t, f, reopen };
}
const CARRIED = SOL / BigInt(10);

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
  test("a coin's carried spend is drained by ONE crank_carried piece of the whole amount: one transaction, one receipt, far above 2 % of the pool", async () => {
    const { t, f, reopen } = await carriedCoin();
    await runCycle(deps);
    const carried = f.cfg.carriedSpendLamports;
    assert.equal(carried, CARRIED, "the untradeable spell carried the whole 0.1 SOL target");
    const rd = f.readings.get(f.cfg.crankCursor)!;
    assert.equal(rd.carriedOutLamports, carried);
    reopen();
    const pieces = await drainCycles(f);
    assert.equal(f.cfg.carriedSpendLamports, BigInt(0), "drained to zero");
    assert.equal(pieces.length, 1, "one piece for the whole carried amount");
    assert.equal(pieces[0].spent, carried);
    assert.ok(carried > (f.poolReserveWsol * BigInt(200)) / BigInt(10_000), "the piece is above the old 2 % bound (0.04 SOL on 2 SOL); the program accepts it");
    assert.equal([...f.landed.values()].filter((l) => l.payload.kind === "carried" && !l.err).length, 1, "one carried transaction landed");
    assert.equal(f.carriedPieces, 1);
    const st = stateFromJson(reg.getStatus(DISPERSAL_STATE_KEY(t.mint)));
    assert.equal(st.receipts.length, 1);
    assert.match(st.receipts[0].memo!, /^BRONCO\|carried\|through=2026-09-28\|spent=100000000\|.*\|left=0\|piece=1\|/);
    assert.equal(st.receipts[0].requestedLamports, carried, "max_spend = the whole carried amount");
    assert.equal(st.debts.length, 0, "the reading is fully spent");
    assert.ok(lines.some((l) => /\[dispersal\] \$BRONCO: spent 0\.1000 SOL of the carried amount \(one piece for the whole carried amount\)/.test(l)), lines.join("\n"));
    assert.ok(!lines.some((l) => /window|budget/.test(l) && /\[dispersal\]/.test(l)), "no windows and no budget waits any more");
  });

  test("the status page carries the plain-English line while a reading is carried", async () => {
    const { t, f } = await carriedCoin();
    await runCycle(deps);
    const ls = dispersalLines(reg.getStatus(DISPERSAL_STATE_KEY(t.mint)));
    assert.equal(ls.length, 1);
    assert.equal(ls[0], "spent 0 of 0.1 SOL for the reading of 2026-09-28; remainder being spent");
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
    // (the paragraph around the line is the public page's copy, owned by tokenPage.ts)
    assert.match(html, /Spent 0 of 0\.1 SOL for the reading of 2026-09-28; remainder being spent\./);
  });

  test("off by default: without the flag no piece is sent and the carried amount waits for the next reading", async () => {
    const { f, reopen } = await carriedCoin();
    deps.dispersal = false;
    await runCycle(deps);
    reopen();
    const carried = f.cfg.carriedSpendLamports;
    assert.equal(carried, CARRIED);
    for (let i = 0; i < 100; i++) { clock += 5 * 60_000; const r = await runCycle(deps, { fetch: false }); assert.equal(r.dispersal, undefined); }
    assert.equal(f.cfg.carriedSpendLamports, carried);
  });

  test("24 hours behind: bt-burn-behind is recorded once for the reading and maps to a plain push", async () => {
    const { t, f, reopen } = await carriedCoin();
    await runCycle(deps);
    reopen();
    f.twap = "deviation";   // every piece deferred
    for (let i = 0; i < 26 * 12; i++) { clock += 5 * 60_000; await runCycle(deps, { fetch: false }); }
    const alerts = reg.alertsSince(0).filter((a) => a.kind === "bt-burn-behind");
    assert.equal(alerts.length, 1, "one alert per reading");
    assert.equal(alerts[0].key, `${t.mint}:20260928`);
    assert.match(alerts[0].text, /^\$BRONCO: the reading of 2026-09-28 is not fully spent a day after it landed\. Spent 0 of 0\.1 SOL for the reading of 2026-09-28; remainder being spent\.$/);
    assert.equal(PUSH_KIND_OF_ALERT["bt-burn-behind"], "burn-behind");
    const cfg = loadCopyLintConfig();
    for (const s of [PUSH_TITLE["burn-behind"], PUSH_LEAD["burn-behind"], alerts[0].text]) assert.ok(lintCopy(s, cfg).ok, `${s}: ${JSON.stringify(lintCopy(s, cfg).hits)}`);
    assert.ok(lines.some((l) => /deferred by the program \(TwapDeviation\); retrying in 10 min/.test(l)));
    // the pool recovers: the piece goes out and the reading drains
    f.twap = "ok";
    const pieces = await drainCycles(f);
    assert.equal(f.cfg.carriedSpendLamports, BigInt(0));
    assert.equal(pieces.length, 1);
  });

  test("a dropped send: the piece's signature is on record; no second piece is signed until it resolves; a late landing is its receipt", async () => {
    const { t, f, reopen } = await carriedCoin();
    await runCycle(deps);
    reopen();
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

  test("a second reading lands while the first is carried: its crank carries both; one piece drains them; the debts reconcile to zero", async () => {
    const { t, f, reopen } = await carriedCoin();
    await runCycle(deps);
    const before = f.cfg.carriedSpendLamports;
    // a stranger submits and cranks a further unit day straight on the fake (the pool is still untradeable: the whole target carries)
    const prev = f.cfg.lastRecordDate, value = f.cfg.lastValue;
    const tx = await f.buildReading({ recordDate: 20260929, prevDate: prev, value: value + BigInt(1), sourceUrl: "burnticker://BRONCO/units/2026-09-29", feedId: f.cfg.feedId, valueDecimals: f.cfg.valueDecimals });
    await f.send(tx.raw);
    assert.ok(f.strangerCrank());
    assert.ok(f.cfg.carriedSpendLamports > before, "the new reading carried more");
    const both = f.cfg.carriedSpendLamports;
    reopen();
    const pieces = await drainCycles(f);
    assert.equal(f.cfg.carriedSpendLamports, BigInt(0));
    assert.deepEqual(pieces.map((p) => p.spent), [both], "one piece for both readings' carry");
    const st = stateFromJson(reg.getStatus(DISPERSAL_STATE_KEY(t.mint)));
    assert.equal(st.cursor, 20260929);
    assert.deepEqual(st.receipts.map((r) => r.throughDate), [20260929]);
    assert.equal(st.debts.length, 0);
  });

  test("a later reading on a tradeable pool pays the carried amount in its own run: nothing is left for a piece", async () => {
    const { t, f, reopen } = await carriedCoin();
    deps.dispersal = false;
    await runCycle(deps);
    reopen();
    f.cfg = { ...f.cfg, poolUntradeableSince: null, poolUntradeableLastSeen: null };
    const prev = f.cfg.lastRecordDate, value = f.cfg.lastValue;
    const tx = await f.buildReading({ recordDate: 20260929, prevDate: prev, value: value + BigInt(1), sourceUrl: "burnticker://BRONCO/units/2026-09-29", feedId: f.cfg.feedId, valueDecimals: f.cfg.valueDecimals });
    await f.send(tx.raw);
    assert.ok(f.strangerCrank());
    const rd = f.readings.get(20260929)!;
    assert.equal(rd.carriedInLamports, CARRIED);
    assert.equal(rd.carriedOutLamports, BigInt(0), "no per-run bound: the target (rule spend + carried in) is spent in one run");
    assert.equal(rd.spentLamports, rd.ruleSpendLamports + CARRIED);
    assert.equal(f.cfg.carriedSpendLamports, BigInt(0));
    deps.dispersal = true;
    clock += 5 * 60_000;
    const r = await runCycle(deps, { fetch: false });
    assert.equal(r.dispersal?.[0]?.action, "idle");
    assert.equal(f.signed.filter((x) => x.payload.kind === "carried").length, 0);
    assert.equal(stateFromJson(reg.getStatus(DISPERSAL_STATE_KEY(t.mint))).debts.length, 0);
  });
});

describe("pacing (owner decision 2026-10-25): no carried budget, only one piece per coin per second", () => {
  /** A carried coin (the reading cranked, dispersal not yet run, the pool tradeable again) and a runDispersal harness over its own state. */
  async function harness() {
    const { f, reopen } = await carriedCoin();
    deps.dispersal = false;
    await runCycle(deps);
    reopen();
    assert.equal(f.cfg.carriedSpendLamports, CARRIED);
    let json: string | null = null;
    const log: string[] = [];
    const run = (port: ProgramPort = f) => runDispersal({ port, mint: f.mint, ticker: "BRONCO", load: () => json, save: (j) => { json = j; }, log: (l) => log.push(l), now: () => clock, dryRun: false } satisfies DispersalDeps);
    const state = () => stateFromJson(json);
    return { f, run, state, log, signedCarried: () => f.signed.filter((x) => x.payload.kind === "carried").length };
  }
  /** Forwards everything to the fake except the named overrides (`this` stays the fake). */
  const port = (f: FakeProgram, over: Partial<Record<keyof ProgramPort, unknown>>): ProgramPort =>
    new Proxy(f, { get(t, k) { if (k in over) return over[k as keyof ProgramPort]; const v = Reflect.get(t, k, t); return typeof v === "function" ? v.bind(t) : v; } }) as unknown as ProgramPort;
  const sec = (ms: number) => Math.floor(ms / 1000);

  test("another cranker's piece a minute earlier does not delay ours: the whole carry lands at once (counted apart from burns)", async () => {
    const h = await harness();
    const burns = h.f.cfg.burns;
    h.f.lastCarriedAt = sec(clock) - 60;
    const r = await h.run();
    assert.equal(r.action, "landed", r.why);
    assert.equal(r.spentLamports, CARRIED);
    assert.equal(h.f.carriedPieces, 1);
    assert.equal(h.f.cfg.burns, burns, "a carried piece does not count in burns");
    assert.match(h.state().receipts[0].memo!, /\|left=0\|piece=1\|swap=/);
    assert.equal(r.nextDueAt, null, "nothing left carried: no wake needed");
  });

  test("the CarriedPace budget is always 0 and never consulted: a piece far above 2 % of the reserve is not refused", async () => {
    const h = await harness();
    assert.equal((await h.f.carriedPace()).budgetLamports, BigInt(0));
    h.f.poolReserveWsol = SOL;   // 0.1 SOL carried is 10 % of this pool's SOL
    const r = await h.run();
    assert.equal(r.action, "landed", r.why);
    assert.ok(!h.log.some((l) => /SpendAboveCap|budget/.test(l)), h.log.join("\n"));
  });

  test("a piece already ran this second: the plan says too-soon and the keeper wakes a second later", async () => {
    const h = await harness();
    h.f.lastCarriedAt = sec(clock);
    const r = await h.run();
    assert.equal(r.action, "wait");
    assert.equal(r.why, "too-soon");
    assert.equal(r.nextDueAt, clock + 1_000);
    assert.equal(h.signedCarried(), 0);
    clock += 1_000;
    assert.equal((await h.run()).action, "landed");
  });

  test("a race (another piece landed in the same second after the plan): CarriedTooSoon in simulation waits at least 30 s, the carry is kept", async () => {
    const h = await harness();
    h.f.lastCarriedAt = sec(clock);
    const mk = (m: bigint) => (h.f as unknown as { mk(p: unknown): Promise<SignedTx> }).mk({ kind: "carried", maxSpend: m });
    const stale = port(h.f, { planCarried: async (m: bigint) => ({ build: () => mk(m) }) });
    const r = await h.run(stale);
    assert.equal(r.action, "wait");
    assert.equal(r.why, "CarriedTooSoon");
    assert.equal(r.nextDueAt, clock + TOO_SOON_MIN_RETRY_MS, "never a retry every second");
    assert.equal(h.f.cfg.carriedSpendLamports, CARRIED, "the carry is kept");
    assert.ok(h.log.some((l) => /another piece ran this second; retrying in 30 s/.test(l)), h.log.join("\n"));
    clock = r.nextDueAt!;
    const r2 = await h.run();
    assert.equal(r2.action, "landed", r2.why);
  });

  test("a refusal that is not \"not now\" keeps the carry and tries again in an hour (not every wake)", async () => {
    const h = await harness();
    h.f.simErr = "SomethingElse";
    const r = await h.run();
    assert.equal(r.action, "refused");
    assert.equal(r.nextDueAt, clock + 60 * 60_000);
    h.f.simErr = null;
    clock += 30 * 60_000;
    assert.equal((await h.run()).action, "wait");
    clock += 31 * 60_000;
    assert.equal((await h.run()).action, "landed");
  });
});

/** The pool untradeable for 31 days (observed an hour ago): the next buyback crank processes below-floor with its target carried. */
function untradeable30d(prog: FakeProgram, nowMs: number) {
  const s = Math.floor(nowMs / 1000);
  prog.poolTradable = false;
  prog.cfg = { ...prog.cfg, poolUntradeableSince: s - 31 * 86_400, poolUntradeableLastSeen: s - 3_600 };
}

describe("the $DEFICIT keeper (executeDispersal on its ledger)", () => {
  const R = (d: string, a: string): DebtReading => ({ recordDate: d, amount: a, cents: usdToCents(a) });
  const D7 = R("2026-10-07", "40284036147367.19"), D8 = R("2026-10-08", "40305316210829.72"); // 21 units
  test("the same dispersal: one crank_carried piece drains the carry, its receipt in the ledger's status table", async () => {
    const loaded = buybackRules();
    let now = Date.parse("2026-10-09T21:00:00Z");
    const ledger = openLedger(":memory:");
    const log: string[] = [];
    const prog = new FakeProgram({ mode: "buyback", rulesSha256: loaded.sha256, memoPrefix: loaded.rules.memo.prefix, memoSource: loaded.rules.feed.memoSource, unitValue: BigInt(100_000_000_000), fractionPerUnitBps: 200, floorLamports: BigInt(1_000_000), reserveLamports: BigInt(20_000_000), attesters: [ATTESTER], now: () => now });
    const ctx: KeeperCtx = { ledger, loaded, log: (s) => log.push(s), now: () => now, dryRun: false };
    prog.registerPool(); prog.deposit(BigInt(5) * SOL); prog.poolReserveWsol = BigInt(20) * SOL;   // the rule spends ~1.73 SOL
    untradeable30d(prog, now);
    ingest(ctx, { readings: [D7, D8], refusals: [] });
    await executeProgramPending(ctx, prog);
    const carried = prog.cfg.carriedSpendLamports;
    assert.ok(carried > SOL, `${carried}`);
    prog.poolTradable = true;
    const alerts: string[] = [];
    let landed = 0;
    for (let i = 0; i < 24 * 12 && prog.cfg.carriedSpendLamports > BigInt(0); i++) {
      const r = await executeDispersal(ctx, prog, { alert: (a) => alerts.push(a.text) });
      if (r.action === "landed") landed++;
      now += 5 * 60_000;
    }
    assert.equal(prog.cfg.carriedSpendLamports, BigInt(0));
    assert.equal(landed, 1, "one piece for the whole carried amount (no per-run bound)");
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
    untradeable30d(prog, now);
    ingest(ctx, { readings: [D7, D8], refusals: [] });
    await executeProgramPending(ctx, prog);
    await executeDispersal(ctx, prog);   // accounts the reading (the pool is still untradeable: the piece waits)
    const ls = deficitDispersalLines(ledger, prog.mint);
    assert.equal(ls.length, 1);
    assert.match(ls[0], /^spent 0 of 1\.\d+ SOL for the reading of 2026-10-08; remainder being spent$/);
    const input = { loaded, readings: ledger.readings("DEBT", "treasury.debt_to_penny"), burns: ledger.burns("DEBT", "treasury.debt_to_penny"), now, nextPollAt: null, lastPoll: null, lastError: null, chain: { cluster: "localnet", mint: prog.mint, vault: prog.feePda, keeper: ATTESTER, supplyRaw: prog.supply, vaultRaw: null, feeLamports: prog.feeLamports },
      program: { programId: prog.programId, configAddress: prog.configAddress, feePda: prog.feePda, config: { ...prog.cfg }, feePdaLamports: prog.feeLamports, programReadings: ledger.programReadings("DEBT", "treasury.debt_to_penny"), keeperAttesterKeys: prog.attesterKeys(), lastHealth: null, dispersal: ls } };
    const burns = buildBurnsJson(input);
    const s = buildStatus(input, burns);
    assert.deepEqual(s.program!.queue.dispersal, ls);
    const html = renderIndexHtml(s, burns, []);
    assert.match(html, /Spent 0 of 1\.\d+ SOL for the reading of 2026-10-08; remainder being spent\./);
    assert.match(html, /Spending carried from earlier days goes out in one burn once the pool's guards allow it\./);
    assert.doesNotMatch(html, /2% of the pool|six-hour windows|cap bound/);
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

describe("small pools (devnet 2026-10-20): with no per-run bound the whole carry is one whole-remainder piece, never stuck", () => {
  const FLOOR = BigInt(9_399_141);
  for (const reserve of [BigInt(613_000_000), BigInt(300_000_000)]) {
    test(`a ${Number(reserve) / 1e9} SOL pool with a 0.0094 SOL floor: one piece of all of it, accepted; no stuck state, no alert`, async () => {
      const { f, reopen } = await carriedCoin();
      deps.dispersal = false;
      await runCycle(deps);
      reopen();
      f.cfg = { ...f.cfg, floorLamports: FLOOR };
      f.poolReserveWsol = reserve;
      let json: string | null = null;
      const log: string[] = [], alerts: { kind: string }[] = [];
      const r = await runDispersal({ port: f, mint: f.mint, ticker: "BRONCO", load: () => json, save: (j) => { json = j; }, log: (l) => log.push(l), now: () => clock, dryRun: false, alert: (a) => alerts.push(a) } satisfies DispersalDeps);
      assert.equal(r.action, "landed", r.why);
      assert.equal(r.spentLamports, CARRIED);
      assert.equal(f.cfg.carriedSpendLamports, BigInt(0));
      assert.ok(!log.some((l) => /BelowFloor|stuck/.test(l)), log.join("\n"));
      assert.deepEqual(alerts, []);
    });
  }
  test("bt-dispersal-stuck and bt-cap-binding no longer exist as push kinds", () => {
    assert.equal(PUSH_KIND_OF_ALERT["bt-dispersal-stuck"], undefined);
    assert.equal(PUSH_KIND_OF_ALERT["bt-cap-binding"], undefined);
    assert.equal((PUSH_TITLE as Record<string, string>)["dispersal-stuck"], undefined);
    assert.equal((PUSH_LEAD as Record<string, string>)["cap-binding"], undefined);
  });
});
