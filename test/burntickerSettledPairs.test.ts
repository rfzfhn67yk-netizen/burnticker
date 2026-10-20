// SETTLED-EVENT PAIRS (owner 2026-10-13: "since it's a settled event, the loser's burn pool should go to burning the winner's token"; the
// linked form is the default and the only form): two candidates in one race (two Polymarket outcome markets, pair.race) and two teams in
// one game (each team's win series of the game, pair.game). Each is one registered LaunchLab pair with both end sinks pair-winner naming
// each other; the keeper reads BOTH sides, holds until both are final, and writes ONE PairResult for the event. No network: the markets
// and the NBA schedule are fakes.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import { openRegistry, type Registry, type TokenRow } from "@/lib/burnticker/registry";
import { FakeBurnProgram } from "@/lib/burnticker/program";
import { buildPairBundles, FakeLaunchLab } from "@/lib/burnticker/launchBundle";
import { CatalogueAdapter } from "@/lib/burnticker/catalogue";
import { runCycle, type KeeperDeps } from "@/lib/burnticker/multiKeeper";
import { raceVerdict, sidePayout } from "@/lib/burnticker/pairForwardKeeper";
import { DEFAULT_ON_END, gameMirrorId, lockRule, validateRule, WIND_DOWN_ON_END, type BurnRule } from "@/lib/burnticker/rules";
import { candidatesRefusals, gamePairRefusals, ruleRefusals, settledPairInput, settledPairSinkProblems, CANDIDATES_SINK_REFUSAL } from "@/lib/burnticker/launchPreflight";
import { buildLaunchReview } from "@/lib/burnticker/launchReview";
import { CANDIDATES_PAIR_SENTENCE, GAME_PAIR_SENTENCE, GAME_PAIR_SENTENCE_NO_TIE, describeRule, endText } from "@/lib/burnticker/describe";
import { candidateFacts, candidatesPairRule, gamePairFacts, gamePairRule, patternOptions, patternWords, PATTERN_REASON, RIVALRY_GAME_LINE } from "@/lib/burnticker/guidedLaunch";
import { settledPairFundsFlow } from "@/lib/burnticker/pairFundsFlow";
import { TEMPLATES } from "@/lib/burnticker/templates";
import { nativeRule, setNativeClients } from "@/lib/burnticker/sources/native";
import { FIRST_READ_STATUS_KEY, GAME_CONFIRM_GAP_MS, statusFirstReadStore } from "@/lib/burnticker/sources/gameSettle";
import { gameSeries } from "@/lib/burnticker/sources/espn";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import type { OracleAdapter } from "@/lib/burnticker/oracle/types";
import type { SettledEvent } from "@/lib/burnticker/units";
import { ATTESTER, CREATOR, FILLER, fakeDeps, game, scheduleClient, type G } from "./burntickerRivalrySeriesHelpers.ts";

const CID_A = `0x${"a1".repeat(32)}`, CID_B = `0x${"b2".repeat(32)}`, SLUG = "michigan-senate-election-winner";
const stub: OracleAdapter = { id: "stub", searchSeries: async () => [], seriesInfo: async () => null, settledSince: async () => ({ events: [], awaitingFinal: 0, refusals: [], settlementSourceUrl: null }), impliedChance: async () => ({ chance: null, marketTicker: null, closeTime: null, basis: "stub" }) };
const ENV = { BURNTICKER_CLUSTER: "devnet", BURNTICKER_CREATOR_LAUNCHES_ENABLED: "1" };

/** The two markets' payouts, set by each test as the race goes on. */
type Pay = { result: "yes" | "no" | "void"; at: string } | null;
function polyFake(pays: Record<string, Pay>): OracleAdapter {
  return { ...stub, id: "polymarket", settledSince: async (rule: BurnRule) => {
    const p = rule.market ? pays[rule.market] : null;
    const events: SettledEvent[] = p ? [{ id: rule.market!, at: p.at, result: p.result, value: null, title: `market ${rule.market!.slice(0, 6)}`, sourceUrl: `https://polymarket.com/m/${rule.market}` }] : [];
    return { events, awaitingFinal: p ? 0 : 1, refusals: [], settlementSourceUrl: null };
  } };
}

interface World { registry: Registry; program: FakeBurnProgram; deps: KeeperDeps; clock: { now: number }; a: TokenRow; b: TokenRow; pairId: string; logs: string[]; flagship: string; play: (cycles?: number) => Promise<void> }
async function world(o: { rule: BurnRule; tickers: [string, string]; extra: { race?: { slug: string; marketB: string }; game?: { opp: string } }; oracles: Partial<KeeperDeps["oracles"]>; now: number; baselineAt: string }): Promise<World> {
  const registry = openRegistry(":memory:"), program = new FakeBurnProgram("devnet");
  program.autoRegisterPool = true; program.pinEndSinks = true;
  const clock = { now: o.now };
  program.now = () => clock.now;
  const logs: string[] = [];
  const [TA, TB] = o.tickers;
  const pr = await buildPairBundles({ a: { creator: CREATOR, ticker: TA, name: TA, description: "", imageUrl: null, links: [], rule: o.rule, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true }, cluster: "devnet" }, b: { ticker: TB, name: TB, description: "", imageUrl: null, links: [] }, voidBy: "2027-12-31", ...o.extra },
    { program, launchLab: new FakeLaunchLab(), devFeeWallet: null, attesters: [ATTESTER], quorum: 1, metadataUri: (m) => `https://x/${m}.json` });
  const reg = (bundle: typeof pr.a, ticker: string) => {
    const t = registry.register({ mint: bundle.mint, ticker, name: ticker, creator: CREATOR, description: bundle.description, imageUrl: null, links: [], rulesText: bundle.rules.text, feePda: bundle.addresses.feePda, vault: bundle.addresses.vault, tokenConfig: bundle.addresses.tokenConfig, poolId: bundle.addresses.poolId, launchTx: null, cluster: "devnet", platformId: null, baselineAt: o.baselineAt, status: "draft" }, Date.parse(o.baselineAt));
    registry.markLaunched(t.mint, `launch${ticker}`, bundle.addresses.poolId, o.baselineAt);
    registry.addAttester({ mint: t.mint, pubkey: ATTESTER, role: "data-key", addedAt: 0, timelockUntil: null });
    program.supplies.set(t.mint, BigInt("1000000000000000"));
    if (program.tokens.has(t.mint)) program.deposit(t.mint, BigInt(5_000_000_000));
    return registry.token(t.mint)!;
  };
  const a = reg(pr.a, TA), b = reg(pr.b, TB);
  registry.registerPair(pr.pairId, a.mint, b.mint, 0);
  const flagship = Keypair.generate().publicKey.toBase58();
  await program.initializeToken({ mint: flagship, creator: CREATOR, ticker: "DEFICIT", rulesSha256: "ab".repeat(32), selectorKey: "flagship", mode: "buyback", attesters: [ATTESTER], quorum: 1, vault: null, rule: lockRule({ ...nativeRule("nws.high:DEN-90"), onEnd: WIND_DOWN_ON_END }).rule });
  program.fake(flagship).registerPool();
  program.endSink.flagship = flagship;
  const deps: KeeperDeps = { registry, program, oracles: { kalshi: stub, catalogue: new CatalogueAdapter(), ...o.oracles }, attester: ATTESTER, log: (l) => logs.push(l), now: () => clock.now, dryRun: false, kalshiPollMs: 60_000 };
  const play = async (cycles = 6) => { for (let i = 0; i < cycles; i++) { await runCycle(deps); clock.now += 3 * 3600_000; } };
  return { registry, program, deps, clock, a, b, pairId: pr.pairId, logs, flagship, play };
}

const T0 = Date.parse("2026-11-03T12:00:00Z");
async function raceWorld(pays: Record<string, Pay>): Promise<World> {
  return world({ rule: candidatesPairRule(CID_A), tickers: ["ELSAYED", "ROGERS"], extra: { race: { slug: SLUG, marketB: CID_B } }, oracles: { polymarket: polyFake(pays) }, now: T0, baselineAt: "2026-10-01T00:00:00Z" });
}
const results = (w: World) => w.program.pairForward.port(w.a.mint, w.b.mint).results;
const d8 = (iso: string) => Number(iso.slice(0, 10).replace(/-/g, ""));

describe("the rules: a candidates pair and a one-game pair", () => {
  test("buildPairBundles: both sides lock the race (or the game), each on its own market (or team), YES / own win only, 100 %, the pair-winner end sink", async () => {
    const w = await raceWorld({});
    const ra = w.registry.lockedRule(w.a).rule, rb = w.registry.lockedRule(w.b).rule;
    assert.deepEqual(ra.pair?.race, { slug: SLUG, markets: [CID_A, CID_B] }); assert.deepEqual(rb.pair?.race, ra.pair?.race);
    assert.equal(ra.market, CID_A); assert.equal(rb.market, CID_B);
    assert.deepEqual(rb.binary, { onYes: { fractionOfPool: 1 }, onNo: null }, "side B is never the inverted rule");
    assert.equal(rb.pair?.counterpartMint, w.a.mint);
    assert.deepEqual(settledPairSinkProblems({ rule: ra, mint: w.a.mint }, { rule: rb, mint: w.b.mint }), []);
    // both sinks pinned PAIR_WINNER, each naming the other
    assert.equal((await w.program.endSink.port(w.a.mint).endSink())?.sinkMint, w.b.mint);
    assert.equal((await w.program.endSink.port(w.b.mint).endSink())?.sinkMint, w.a.mint);
    assert.equal((await w.program.endSink.port(w.a.mint).endSink())?.kind, "pair-winner");
  });
  test("the pair gate: a race needs two different Polymarket markets, YES only; a game needs two teams' win series of one game", () => {
    const base = { ...candidatesPairRule(CID_A), pair: { pairId: "elsayed-vs-rogers", side: "A", counterpartMint: null, winnerTakesBurn: true, race: { slug: SLUG, markets: [CID_A, CID_B] } } };
    assert.doesNotThrow(() => validateRule(base));
    assert.throws(() => validateRule({ ...base, pair: { ...base.pair, race: { slug: SLUG, markets: [CID_A, CID_A] } } }), /two different Polymarket condition ids/);
    assert.throws(() => validateRule({ ...base, binary: { onYes: null, onNo: { fractionOfPool: 1 } } }), /YES only/);
    assert.throws(() => validateRule({ ...base, market: CID_B }), /side A reads the first market/);
    const ga = gameSeries("nba", "0022500001", "PHI", "win"), gb = gameMirrorId(ga, "BOS")!;
    assert.equal(gb, "espn.game:nba-0022500001-BOS-win");
    const g = { ...gamePairRule("nba", "0022500001", "PHI"), pair: { pairId: "phi-vs-bos-game", side: "A", counterpartMint: null, winnerTakesBurn: true, game: { series: [ga, gb] } } };
    assert.doesNotThrow(() => validateRule(g));
    assert.throws(() => validateRule({ ...g, pair: { ...g.pair, game: { series: [ga, "espn.game:nba-0022500002-BOS-win"] } } }), /two teams' win series of one game/);
    assert.throws(() => validateRule({ ...g, series: gameSeries("nba", "0022500001", "PHI", "loss"), pair: { ...g.pair } }), /side A reads the first series/);
  });
  test("the preflight: both sinks required; the markets and the race named; the game's other team named", () => {
    const r = lockRule(candidatesPairRule(CID_A)).rule;
    assert.deepEqual(candidatesRefusals(r, { candidates: { marketB: CID_B, race: SLUG } }), []);
    assert.deepEqual(candidatesRefusals({ ...r, onEnd: { windDownDays: 28, sweepThresholdLamports: 50_000_000 } }, { candidates: { marketB: CID_B, race: SLUG } }).map((x) => x.message), [CANDIDATES_SINK_REFUSAL]);
    assert.deepEqual(candidatesRefusals(r, { candidates: { marketB: CID_A, race: null } }).map((x) => x.code), ["candidates-markets", "candidates-race"]);
    const g = lockRule(gamePairRule("nba", "0022500001", "PHI")).rule;
    assert.deepEqual(gamePairRefusals(g, { game: { opp: "BOS" } }), []);
    assert.deepEqual(gamePairRefusals(g, { game: { opp: "PHI" } }).map((x) => x.code), ["game-pair-series"]);
    assert.ok(ruleRefusals(lockRule(g), { pair: true, game: { opp: "BOS" } }).every((x) => !/game-pair/.test(x.code)));
    assert.deepEqual(settledPairInput({ ticker: "ROGERS", market: CID_B.toUpperCase(), race: SLUG })?.bundle, { race: { slug: SLUG, marketB: CID_B } });
    assert.deepEqual(settledPairInput({ ticker: "BOS", opp: "bos" })?.bundle, { game: { opp: "BOS" } });
    assert.equal(settledPairInput({ ticker: "X" }), null);
  });
  test("raceVerdict: held until both are final; exactly one YES wins; both NO, both YES or a split → no winner; the day is the later payout", () => {
    const y = (at: string) => ({ state: "fired" as const, at }), n = (at: string) => ({ state: "not" as const, at }), v = (at: string) => ({ state: "void" as const, at });
    const names = { me: "A", other: "B" };
    assert.equal(raceVerdict(y("2026-11-04T10:00:00Z"), null, names).kind, "held");
    assert.deepEqual([raceVerdict(y("2026-11-04T10:00:00Z"), n("2026-11-05T02:00:00Z"), names)].map((x) => [x.kind, "at" in x ? x.at : null]), [["won", "2026-11-05T02:00:00Z"]]);
    assert.equal(raceVerdict(n("2026-11-04T10:00:00Z"), y("2026-11-04T09:00:00Z"), names).kind, "lost");
    for (const [m, t] of [[n("x"), n("x")], [y("x"), y("x")], [v("x"), y("x")], [y("x"), v("x")]] as const) assert.equal(raceVerdict(m, t, names).kind, "none");
    assert.deepEqual(sidePayout({ result: null, value: "1", at: "2025-11-03" }), { state: "fired", at: "2025-11-03" });
    assert.deepEqual(sidePayout({ result: null, value: "0", at: "2025-11-03" }), { state: "not", at: "2025-11-03" });
  });
});

describe("two candidates in one race through the keeper", () => {
  test("A YES / B NO: ONE race PairResult names $ELSAYED; its YES burns its own pool; $ROGERS's pool forwards to it; $ROGERS's end goes to $ELSAYED", async () => {
    const w = await raceWorld({ [CID_A]: { result: "yes", at: "2026-11-04T08:00:00Z" }, [CID_B]: { result: "no", at: "2026-11-04T20:00:00Z" } });
    w.clock.now = Date.parse("2026-11-05T06:00:00Z");
    await w.play(10);
    const R = results(w);
    const winners = [...R.values()].filter((x) => x.winner !== null);
    assert.equal(winners[0].recordDate, 20261104, "the race's day: the later payout"); assert.equal(winners[0].winner, w.a.mint);
    assert.equal(R.get(20261104)?.winner, w.a.mint);
    const ra = w.registry.receipts(w.a.mint).find((x) => x.eventId === CID_A)!, rb = w.registry.receipts(w.b.mint).find((x) => x.eventId === CID_B)!;
    assert.equal(ra.pairRole, "won"); assert.equal(ra.units, 1); assert.equal(ra.settledAt, "2026-11-04T20:00:00Z");
    assert.equal(rb.pairRole, "lost"); assert.equal(rb.status, "forwarded", w.logs.filter((l) => /ROGERS|race/.test(l)).slice(-10).join("\n"));
    assert.ok(w.registry.pairForwards(w.pairId).some((f) => f.loserMint === w.b.mint && f.winnerMint === w.a.mint && f.recordDate === 20261104));
    // the winner's own one-shot burned on its YES
    assert.ok(w.registry.receipts(w.a.mint).some((x) => x.eventId === CID_A && x.status === "confirmed"), JSON.stringify(w.registry.receipts(w.a.mint).map((x) => [x.eventId, x.status])));
    // the loser records no forward to $DEFICIT; the winner records no end (it is the sink)
    assert.equal(await w.program.endSink.port(w.a.mint).ruleEnd(), null);
    const fwd = w.registry.getStatus(`rule.endfwd.${w.b.mint}`);
    if (fwd) assert.equal(JSON.parse(fwd).to, w.a.mint, "the loser's end forward goes to the winner, never to $DEFICIT");
  });
  test("B YES / A NO: the mirror", async () => {
    const w = await raceWorld({ [CID_A]: { result: "no", at: "2026-11-04T08:00:00Z" }, [CID_B]: { result: "yes", at: "2026-11-04T09:00:00Z" } });
    w.clock.now = Date.parse("2026-11-05T06:00:00Z");
    await w.play(10);
    assert.equal(results(w).get(20261104)?.winner, w.b.mint);
    assert.equal(w.registry.receipts(w.a.mint).find((x) => x.eventId === CID_A)?.pairRole, "lost");
    assert.equal(w.registry.receipts(w.b.mint).find((x) => x.eventId === CID_B)?.pairRole, "won");
    assert.ok(w.registry.pairForwards(w.pairId).every((f) => f.winnerMint === w.b.mint));
  });
  test("both NO (a third candidate won): no PairResult, nothing burns or moves, both ends resolved and sent to $DEFICIT", async () => {
    const w = await raceWorld({ [CID_A]: { result: "no", at: "2026-11-04T08:00:00Z" }, [CID_B]: { result: "no", at: "2026-11-04T09:00:00Z" } });
    w.clock.now = Date.parse("2026-11-05T06:00:00Z");
    await w.play(10);
    assert.equal([...results(w).values()].filter((x) => x.winner !== null).length, 0);
    assert.equal(w.registry.pairForwards(w.pairId).length, 0);
    for (const t of [w.a, w.b]) {
      const r = w.registry.receipts(t.mint).find((x) => !["winddown", "drain", "sweep"].includes(x.kind))!;
      assert.equal(r.units, 0); assert.equal(r.pairRole, null);
      const end = w.registry.ruleEnd(t.mint)!;
      assert.match(end.reason, /no single winner .*\$DEFICIT's burn/);
      assert.equal((await w.program.endSink.port(t.mint).ruleEnd())?.outcome, "resolved", w.logs.filter((l) => l.includes(t.ticker)).slice(-6).join("\n"));
      assert.equal(JSON.parse(w.registry.getStatus(`rule.endfwd.${t.mint}`)!).to, w.flagship);
    }
  });
  test("one market unresolved: held — nothing planned on either coin, no PairResult; it settles once the other market is final", async () => {
    const pays: Record<string, Pay> = { [CID_A]: { result: "yes", at: "2026-11-04T08:00:00Z" }, [CID_B]: null };
    const w = await raceWorld(pays);
    w.clock.now = Date.parse("2026-11-05T06:00:00Z");
    await w.play(4);
    assert.equal(w.registry.receipts(w.a.mint).length, 0); assert.equal(w.registry.receipts(w.b.mint).length, 0);
    assert.equal(results(w).size, 0);
    assert.ok(w.logs.some((l) => /\[race\] \$ELSAYED: held — \$ROGERS's market is not final yet/.test(l)));
    pays[CID_B] = { result: "no", at: "2026-11-06T01:00:00Z" };
    w.clock.now = Date.parse("2026-11-07T06:00:00Z");
    await w.play(8);
    assert.equal(results(w).get(20261106)?.winner, w.a.mint, "the race is dated at the later payout");
  });
  test("a split payout: no winner — even the coin whose market paid YES burns nothing for the race; both ends go to $DEFICIT", async () => {
    const w = await raceWorld({ [CID_A]: { result: "void", at: "2026-11-04T08:00:00Z" }, [CID_B]: { result: "yes", at: "2026-11-04T09:00:00Z" } });
    w.clock.now = Date.parse("2026-11-05T06:00:00Z");
    await w.play(10);
    assert.equal([...results(w).values()].filter((x) => x.winner !== null).length, 0);
    const rb = w.registry.receipts(w.b.mint).find((x) => x.eventId === CID_B)!;
    assert.equal(rb.units, 0); assert.match(rb.note, /settled 50-50/);
    for (const t of [w.a, w.b]) assert.equal((await w.program.endSink.port(t.mint).ruleEnd())?.outcome, "resolved", `${t.ticker}: a race with no single winner ends on a result, so the rest goes to $DEFICIT`);
  });
});

describe("two teams in one game through the keeper", () => {
  const START = "2025-11-03T23:00:00Z";
  async function gameWorld(g: G): Promise<World> {
    const all = [g, ...FILLER];
    const w = await world({ rule: gamePairRule("nba", g.id, g.home), tickers: ["PHIGM", "BOSGM"], extra: { game: { opp: g.away } }, oracles: {}, now: Date.parse("2025-11-01T00:00:00Z"), baselineAt: "2025-10-01T00:00:00Z" });
    setNativeClients({ espn: scheduleClient(all, () => w.clock.now), games: fakeDeps(all, () => w.clock.now) });
    return w;
  }
  const run = async (w: World, until: number) => { while (w.clock.now < until) { await runCycle(w.deps); w.clock.now += 3 * 3600_000; } };
  test("PHI beats BOS: one PairResult names $PHIGM, its win burns its whole pool, $BOSGM's pool forwards to it", async () => {
    const w = await gameWorld(game(START, "PHI", "BOS", 120, 100));
    await run(w, Date.parse("2025-11-10T00:00:00Z"));
    assert.equal(results(w).get(20251103)?.winner, w.a.mint, w.logs.filter((l) => /game|pair/.test(l)).slice(-10).join("\n"));
    assert.equal(w.registry.receipts(w.a.mint).find((x) => x.eventId === "2025-11-03")?.pairRole, "won");
    const rb = w.registry.receipts(w.b.mint).find((x) => x.eventId === "2025-11-03")!;
    assert.equal(rb.pairRole, "lost"); assert.equal(rb.units, 1); assert.equal(rb.status, "forwarded");
    assert.ok(w.registry.pairForwards(w.pairId).some((f) => f.loserMint === w.b.mint && f.winnerMint === w.a.mint));
  });
  test("owner 2026-10-16: two sources agreeing (the market and the NBA feed) burn both coins on the cycle that reads them both, on one shared record", async () => {
    const g = game(START, "PHI", "BOS", 120, 100), all = [g, ...FILLER];
    const w = await gameWorld(g);
    setNativeClients({ espn: scheduleClient(all, () => w.clock.now), games: { ...fakeDeps(all, () => w.clock.now), firstReads: statusFirstReadStore(w.registry, () => w.clock.now) } });
    const step = 50 * 60_000;
    let firstRead: number | null = null, resultAt: number | null = null;
    while (w.clock.now < Date.parse("2025-11-08T00:00:00Z") && resultAt === null) {
      await runCycle(w.deps);
      const marks = JSON.parse(w.registry.getStatus(FIRST_READ_STATUS_KEY) ?? "{}") as Record<string, { firstReadAt: number }>;
      if (firstRead === null && Object.keys(marks).length) { assert.equal(Object.keys(marks).length, 1, "one record for the game, shared by both coins"); firstRead = Object.values(marks)[0].firstReadAt; }
      if (results(w).get(20251103)) resultAt = w.clock.now;
      else w.clock.now += step;
    }
    assert.ok(firstRead !== null && resultAt !== null, w.logs.slice(-8).join("\n"));
    assert.equal(resultAt, firstRead, "settled on the cycle that first read both sources, not 12 hours later");
    assert.equal(results(w).get(20251103)?.winner, w.a.mint);
  });
  test("owner 2026-10-18 evening: with one source, both coins burn once that source shows the same final on a second read (persisted, shared); the keeper reads again for it", async () => {
    const g = game(START, "PHI", "BOS", 120, 100), all = [g, ...FILLER];
    const w = await gameWorld(g);
    setNativeClients({ espn: scheduleClient(all, () => w.clock.now), games: { ...fakeDeps(all, () => w.clock.now), payout: async () => ({ resolved: false, outcome: null }), firstReads: statusFirstReadStore(w.registry, () => w.clock.now) } });
    const step = 50 * 60_000;   // off the hourly poll grid
    let firstRead: number | null = null, resultAt: number | null = null;
    while (w.clock.now < Date.parse("2025-11-08T00:00:00Z") && resultAt === null) {
      await runCycle(w.deps);
      const marks = JSON.parse(w.registry.getStatus(FIRST_READ_STATUS_KEY) ?? "{}") as Record<string, { firstReadAt: number }>;
      if (firstRead === null && Object.keys(marks).length) { assert.equal(Object.keys(marks).length, 1, "one record for the game, shared by both coins"); firstRead = Object.values(marks)[0].firstReadAt; }
      if (results(w).get(20251103)) resultAt = w.clock.now;
      else w.clock.now += step;
    }
    assert.ok(firstRead !== null && resultAt !== null, w.logs.slice(-8).join("\n"));
    assert.ok(resultAt! >= firstRead! + GAME_CONFIRM_GAP_MS, "never on the first read alone");
    assert.ok(resultAt! - firstRead! <= step, `burned on the next read of the same final, not 12 hours later (${new Date(resultAt!).toISOString()} vs first read ${new Date(firstRead!).toISOString()})`);
    assert.equal(results(w).get(20251103)?.winner, w.a.mint);
  });
  test("BOS wins at PHI: the mirror", async () => {
    const w = await gameWorld(game(START, "PHI", "BOS", 99, 110));
    await run(w, Date.parse("2025-11-10T00:00:00Z"));
    assert.equal(results(w).get(20251103)?.winner, w.b.mint);
    assert.equal(w.registry.receipts(w.a.mint).find((x) => x.eventId === "2025-11-03")?.pairRole, "lost");
  });
  test("a postponed game waits: nothing planned, no result", async () => {
    const w = await gameWorld(game(START, "PHI", "BOS", null, null, { status: 1, text: "Postponed" }));
    await run(w, Date.parse("2025-11-10T00:00:00Z"));
    assert.equal(results(w).size, 0); assert.equal(w.registry.ruleEnd(w.a.mint), null); assert.equal(w.registry.ruleEnd(w.b.mint), null);
  });
  test("a cancelled game: no result, nothing moves between the coins, each ends void", async () => {
    const w = await gameWorld(game(START, "PHI", "BOS", null, null, { status: 1, text: "Cancelled" }));
    await run(w, Date.parse("2025-11-12T00:00:00Z"));
    assert.equal([...results(w).values()].filter((x) => x.winner !== null).length, 0);
    assert.equal(w.registry.pairForwards(w.pairId).length, 0);
    for (const t of [w.a, w.b]) assert.match(w.registry.ruleEnd(t.mint)?.reason ?? "", /void/);
  });
});

describe("the review, the copy and the templates", () => {
  test("the review: a candidates pair launches as one LaunchLab pair (never the pair curve), with the linked sentence and money path", () => {
    const body = { rule: candidatesPairRule(CID_A), ticker: "ELSAYED", name: "El-Sayed MI", pair: { ticker: "ROGERS", name: "Rogers MI", market: CID_B, race: SLUG, names: { a: "Abdul El-Sayed", b: "Mike Rogers" } } };
    const rv = buildLaunchReview(body as never, { env: { ...ENV, BURNTICKER_PAIR_CURVE_ENABLED: "1" }, reserved: new Set() });
    assert.ok("review" in rv, JSON.stringify(rv));
    if (!("review" in rv)) return;
    assert.equal(rv.review.venue, "launchlab");
    assert.equal(rv.review.settled?.shape, "candidates"); assert.equal(rv.review.settled?.sentence, CANDIDATES_PAIR_SENTENCE);
    assert.equal(rv.review.end.kind, "pair-winner");
    assert.match(rv.review.coins[0].description ?? "", /Two markets, one race/);
    assert.match(rv.review.settled?.descriptionB ?? "", /Two markets, one race/);
    assert.ok(!rv.review.problems.some((p) => /candidates|race/i.test(p)), rv.review.problems.join(" | "));
  });
  test("the review: a one-game pair is a linked LaunchLab pair too", () => {
    const body = { rule: gamePairRule("nba", "0022500001", "PHI"), ticker: "PHIGM", name: "76ers Game", pair: { ticker: "BOSGM", name: "Celtics Game", opp: "BOS", names: { a: "76ers", b: "Celtics" } } };
    const rv = buildLaunchReview(body as never, { env: { ...ENV, BURNTICKER_PAIR_CURVE_ENABLED: "1" }, reserved: new Set() });
    assert.ok("review" in rv);
    if (!("review" in rv)) return;
    assert.equal(rv.review.venue, "launchlab"); assert.equal(rv.review.settled?.shape, "game"); assert.equal(rv.review.settled?.sentence, GAME_PAIR_SENTENCE_NO_TIE); // HS-42 (hourly run 8): an NBA game cannot end tied
  });
  test("every new sentence is plain and lint-clean: no buy, price, will, dates or coming soon", () => {
    const cfg = loadCopyLintConfig();
    const flowC = settledPairFundsFlow("candidates", { a: "ELSAYED", b: "ROGERS" }, { a: "Abdul El-Sayed", b: "Mike Rogers" }), flowG = settledPairFundsFlow("game", { a: "PHIGM", b: "BOSGM" }, { a: "76ers", b: "Celtics" });
    const cf = candidateFacts({ a: "ELSAYED", b: "ROGERS", candA: "Abdul El-Sayed", candB: "Mike Rogers" }), gf = gamePairFacts({ a: "PHIGM", b: "BOSGM", teamA: "76ers", teamB: "Celtics", tie: "tie" });
    const rule = { ...candidatesPairRule(CID_A), pair: { pairId: "x-vs-y", side: "A", counterpartMint: null, winnerTakesBurn: true, race: { slug: SLUG, markets: [CID_A, CID_B] } } } as BurnRule;
    const texts = [CANDIDATES_PAIR_SENTENCE, GAME_PAIR_SENTENCE, RIVALRY_GAME_LINE, endText(rule).result, flowC.oneLiner, ...flowC.steps.map((s) => s.text), ...flowC.outcomes.map((o) => o.then), ...flowG.steps.map((s) => s.text), ...flowG.outcomes.map((o) => o.then),
      ...Object.values(cf).slice(1), ...Object.values(gf).slice(1), PATTERN_REASON.candidatesLinked, PATTERN_REASON.gameLinked, TEMPLATES.find((t) => t.id === "election-pair")!.example, TEMPLATES.find((t) => t.id === "matchup")!.example];
    for (const t of texts) {
      assert.ok(lintCopy(t, cfg).ok, `${t}\n${JSON.stringify(lintCopy(t, cfg).hits)}`);
      assert.doesNotMatch(t, /\b(buy|buys|bought|price|prices|will|coming soon)\b/i, t);
    }
    assert.match(describeRule(rule, { ticker: "ELSAYED" }).paragraph, /Two markets, one race/);
  });
  test("templates and the guide offer only the linked form for candidates and for one game", () => {
    const t = TEMPLATES.find((x) => x.id === "election-pair")!;
    assert.equal(t.pairLine, CANDIDATES_PAIR_SENTENCE); assert.equal(t.pairing, "race");
    assert.equal(TEMPLATES.find((x) => x.id === "matchup")!.pairLine, GAME_PAIR_SENTENCE);
    const c = patternOptions({ follow: "rivalry", rule: null, pairKind: "candidates" });
    assert.equal(c.preselected, "winner"); assert.deepEqual(c.options.filter((o) => o.available).map((o) => o.id), ["winner"]);
    const g = patternOptions({ follow: "rivalry", rule: null, pairKind: "teams", rivalryScope: "game" });
    assert.equal(g.preselected, "winner"); assert.deepEqual(g.options.filter((o) => o.available).map((o) => o.id), ["winner"]);
    assert.equal(patternWords("winner", { follow: "rivalry", pairKind: "candidates" }).sentence, CANDIDATES_PAIR_SENTENCE);
    assert.equal(patternWords("winner", { follow: "rivalry", pairKind: "teams", rivalryScope: "game" }).sentence, GAME_PAIR_SENTENCE);
    void DEFAULT_ON_END;
  });
});

describe("side B is described from its own event, never side A's (website-23: \"$ROGEVELSA burns if the Democrats win\")", () => {
  test("Michigan: coin B's review description reads candidate B's market words from pair.descCtx", () => {
    const body = { rule: candidatesPairRule(CID_A), ticker: "ELSAVROGE", name: "El-Sayed MI", descCtx: { eventPhrase: "the Democrats win the Michigan Senate race" }, pair: { ticker: "ROGEVELSA", name: "Rogers MI", market: CID_B, race: SLUG, descCtx: { eventPhrase: "the Republicans win the Michigan Senate race" } } };
    const rv = buildLaunchReview(body as never, { env: ENV, reserved: new Set() });
    assert.ok("review" in rv); if (!("review" in rv)) return;
    assert.match(rv.review.coins[0].description ?? "", /^\$ELSAVROGE burns if the Democrats win/);
    assert.match(rv.review.settled!.descriptionB, /^\$ROGEVELSA burns if the Republicans win the Michigan Senate race\./);
    assert.doesNotMatch(rv.review.settled!.descriptionB, /Democrats/);
  });
  test("an NHL game: coin B reads its own team's win (from pair.descCtx, or mirrored from side A's game when absent)", () => {
    const ctxA = { game: { opponent: "Bruins", home: true, startsAt: "2026-11-05T00:00:00Z" } };
    for (const pairCtx of [{ game: { opponent: "Ducks", home: false, startsAt: "2026-11-05T00:00:00Z" } }, undefined]) {
      const body = { rule: gamePairRule("nhl", "2025020001", "ANA"), ticker: "ANAGM", name: "Ducks Game", descCtx: ctxA, pair: { ticker: "BOSGM", name: "Bruins Game", opp: "BOS", ...(pairCtx ? { descCtx: pairCtx } : {}) } };
      const rv = buildLaunchReview(body as never, { env: ENV, reserved: new Set() });
      assert.ok("review" in rv); if (!("review" in rv)) return;
      assert.match(rv.review.coins[0].description ?? "", /^\$ANAGM burns if the Ducks win against the Bruins\./);
      assert.match(rv.review.settled!.descriptionB, /^\$BOSGM burns if the Bruins win at the Ducks\./, String(pairCtx));
    }
  });
  test("the bundle route launches coin B with that description (an NHL game, side B's own context)", async () => {
    const { makeWorld } = await import("./burntickerApiHelpers.ts");
    const { prepareLaunch } = await import("@/lib/burnticker/api/handlers");
    const w = await makeWorld();
    const r = await prepareLaunch(w.p, { creator: CREATOR, ticker: "ANAGM", name: "Ducks Game", description: "", firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true }, rule: gamePairRule("nhl", "2025020001", "ANA"), descCtx: { game: { opponent: "Bruins", home: true, startsAt: "2026-11-05T00:00:00Z" } }, pair: { ticker: "BOSGM", name: "Bruins Game", opp: "BOS", descCtx: { game: { opponent: "Ducks", home: false, startsAt: "2026-11-05T00:00:00Z" } } } }, { register: false });
    assert.ok("pair" in r, JSON.stringify("error" in r ? r.error.body : r).slice(0, 300)); if (!("pair" in r)) return;
    assert.match(r.pair.bundles.b.description, /^\$BOSGM burns if the Bruins win at the Ducks\./);
    assert.match(r.pair.bundles.a.description, /^\$ANAGM burns if the Ducks win against the Bruins\./);
  });
});

describe("the bundle route (handlers.ts prepareLaunch)", () => {
  test("a one-game pair builds one LaunchLab pair (never the pair curve), both sinks naming each other, voidBy 30 days out", async () => {
    const { makeWorld } = await import("./burntickerApiHelpers.ts");
    const { prepareLaunch } = await import("@/lib/burnticker/api/handlers");
    const w = await makeWorld();
    process.env.BURNTICKER_PAIR_CURVE_ENABLED = "1";
    try {
      const r = await prepareLaunch(w.p, { creator: CREATOR, ticker: "PHIGM", name: "76ers Game", description: "", firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true }, rule: gamePairRule("nba", "0022500001", "PHI"), pair: { ticker: "BOSGM", name: "Celtics Game", opp: "BOS" } }, { register: false });
      assert.ok("pair" in r, JSON.stringify("error" in r ? r.error.body : r).slice(0, 400));
      if (!("pair" in r)) return;
      assert.equal(r.pair.pairCurve, undefined, "never the pair curve");
      const ra = lockRule(JSON.parse(r.pair.bundles.a.rules.text)).rule, rb = lockRule(JSON.parse(r.pair.bundles.b.rules.text)).rule;
      assert.equal(rb.series, "espn.game:nba-0022500001-BOS-win");
      assert.deepEqual(settledPairSinkProblems({ rule: ra, mint: r.pair.bundles.a.mint }, { rule: rb, mint: r.pair.bundles.b.mint }), []);
      const days = (Date.parse(`${ra.pair!.voidBy}T00:00:00Z`) - Date.now()) / 86_400_000;
      assert.ok(days > 28 && days <= 31, String(ra.pair!.voidBy));
    } finally { delete process.env.BURNTICKER_PAIR_CURVE_ENABLED; }
  });
  test("a candidates pair whose markets are not both outcomes of the named race is refused", async () => {
    const { makeWorld } = await import("./burntickerApiHelpers.ts");
    const { prepareLaunch } = await import("@/lib/burnticker/api/handlers");
    const w = await makeWorld();
    const r = await prepareLaunch(w.p, { creator: CREATOR, ticker: "ELSAYED", name: "El-Sayed MI", description: "", firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true }, rule: candidatesPairRule(CID_A), pair: { ticker: "ROGERS", name: "Rogers MI", market: CID_B, race: SLUG } }, { register: false });
    assert.ok("error" in r);
    if ("error" in r) assert.ok([400, 502].includes(r.error.status), JSON.stringify(r.error.body));
  });
});
