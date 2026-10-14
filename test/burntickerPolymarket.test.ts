// POLYMARKET AS THE SECOND ADJUDICATED ORACLE (2026-10-10; the owner: "do both"). Everything here runs on the frozen Gamma bodies and
// Polygon eth_call answers fetched on 2026-10-10 (config/burnticker/fixtures/polymarket/): the parser, the chain-is-final rule (a
// reading only once the CTF payout vector is on chain; voids; disagreement with Gamma), selectors (one market, a tag with a market type
// and a question regex, an event), the refuse list over questions, the back-test from Gamma's closed markets, the display-only implied
// chance, search, the keeper writing readings with proofs and cranking on the fake program, the v1 API, the SDK, and pairs.
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import { invertMapping, withFullFraction, lockRule, oracleDisclosure, POLYMARKET_DISCLOSURE, ruleStatement, validateRule, descriptionFooter, type BurnRule } from "@/lib/burnticker/rules";
import {
  chainResult, gammaResult, globMatch, impliedChanceFromMarkets, normaliseTime, parseGammaMarket, parseMarketsBody, parsePolySeries, polySelectorMatches, proofOf, resolvePolymarket,
  rpcFixtureFetch, searchHits, settledMarketUrl, marketsByTagUrl, POLYGONSCAN_CTF, type GammaMarket,
} from "@/lib/burnticker/oracle/polymarket";
import { interpretPayouts, readConditionResolution, type ConditionResolution } from "@/lib/burnKeeper/attesters/polymarketOnchain";
import { backtest } from "@/lib/burnticker/oracle/backtest";
import { selectorKeyOf } from "@/lib/burnticker/registry";
import { runCycle } from "@/lib/burnticker/multiKeeper";
import { buildLaunchBundle, buildPairBundles, FakeLaunchLab } from "@/lib/burnticker/launchBundle";
import { polymarketSourceReading, verifyReceiptCore } from "@/lib/burnticker/verify";
import { endpoint, buildOpenApi } from "@/lib/burnticker/api/spec";
import { Burnticker, verifyReceipt } from "../packages/burnticker-sdk/src/index.ts";
import { API, ATTESTER, CREATOR, POST_HEADERS, callRoute, makeWorld, routeFetch, validateSchema, type World } from "./burntickerApiHelpers.ts";
import { NOW } from "./burntickerHelpers.ts";
import { BUCS_CID, CHAIN, EAGLES_CID, GAMMA_TABLE, PM_BUCS, PM_NFL_MONEYLINE, PM_OPEN, PM_RESOLVED, PM_SEARCH, PM_TAG_CLOSED, PM_TAG_OPEN, polyClient } from "./burntickerPolyHelpers.ts";
import { gammaFixtureFetch } from "@/lib/burnticker/oracle/polymarket";

const resolved = parseMarketsBody(PM_RESOLVED.gamma.body)[0];
const open = parseMarketsBody(PM_OPEN.gamma.body)[0];
const tagClosed = PM_TAG_CLOSED.pages.flatMap((p) => parseMarketsBody(p.body, { tags: ["nfl"] }));
const chainOf = async (id: string, chain = CHAIN): Promise<ConditionResolution> => readConditionResolution(id, { rpcUrls: ["https://polygon-rpc.test"], fetchImpl: rpcFixtureFetch(chain) });
const fakeRes = (id: string, nums: number[], den: number): ConditionResolution => ({ conditionId: id, chainId: 137, contract: "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045", rpcUrl: "x", blockNumber: 1, outcomeSlotCount: nums.length, payoutDenominator: String(den), payoutNumerators: nums.map(String), ...interpretPayouts(nums.map((n) => BigInt(n)), BigInt(den)) });

describe("parsing Gamma", () => {
  test("timestamps normalise; a resolved market keeps Gamma's report; an open market carries a display-only YES mid", () => {
    assert.equal(normaliseTime("2026-10-09 03:36:14+00"), "2026-10-09T03:36:14Z");
    assert.equal(normaliseTime("2026-10-09T03:36:14.483Z"), "2026-10-09T03:36:14Z");
    assert.equal(normaliseTime("2026-10-09 05:36:14+0200"), "2026-10-09T03:36:14Z");
    assert.equal(normaliseTime("soon"), null);
    assert.equal(resolved.conditionId, BUCS_CID);
    assert.deepEqual(resolved.outcomes, ["Buccaneers", "Cowboys"]);
    assert.equal(resolved.closedTime, "2026-10-09T03:36:14Z");
    assert.equal(resolved.eventSlug, "nfl-tb-dal-2026-10-09");
    assert.equal(resolved.yesPrice, null, "no price on a closed market");
    assert.equal(gammaResult(resolved), "yes");
    assert.equal(open.closed, false); assert.equal(gammaResult(open), null);
    assert.ok(Math.abs(open.yesPrice! - 0.235) < 1e-9, "mid of bestBid 0.23 / bestAsk 0.24 — display only");
    assert.equal(parseGammaMarket({ question: "no id" }), null);
  });
  test("Gamma's report needs closed + resolved + figures exactly 1/0 (0.5/0.5 = void); anything else is not a report", () => {
    const g = (o: Partial<GammaMarket>) => gammaResult({ ...resolved, ...o });
    assert.equal(g({ outcomeFigures: ["0", "1"] }), "no");
    assert.equal(g({ outcomeFigures: ["0.5", "0.5"] }), "void");
    assert.equal(g({ outcomeFigures: ["0.97", "0.03"] }), null, "a price is never a result");
    assert.equal(g({ umaResolutionStatus: "proposed" }), null);
    assert.equal(g({ closed: false }), null);
    assert.equal(g({ outcomes: ["A", "B", "C"], outcomeFigures: ["1", "0", "0"] }), null, "binary only");
  });
});

describe("the chain is the record", () => {
  test("the recorded CTF reads: Buccaneers–Cowboys resolved [1, 0] → YES; Eagles–Jaguars unresolved → null", async () => {
    const r = await chainOf(BUCS_CID);
    assert.deepEqual([r.resolved, r.payoutNumerators, r.payoutDenominator, r.outcome], [true, ["1", "0"], "1", 0]);
    assert.equal(chainResult(r), "yes");
    assert.equal(proofOf(r), `polygon:137/ctf:0x4D97DCd97eC945f40cF65F87097ACe5EA0476045/condition:${BUCS_CID}/payouts:1,0/block:${Number(CHAIN.blockNumber)}`);
    const o = await chainOf(EAGLES_CID);
    assert.equal(o.resolved, false); assert.equal(chainResult(o), null);
  });
  test("a split payout is a VOID; a non-binary condition is refused", () => {
    assert.equal(chainResult(fakeRes(BUCS_CID, [1, 1], 2)), "void");
    assert.equal(chainResult(fakeRes(BUCS_CID, [0, 1], 1)), "no");
    assert.throws(() => chainResult(fakeRes(BUCS_CID, [1, 0, 0], 1)), /binary only/);
  });
  test("resolvePolymarket: final only with the vector on chain; Gamma-closed without it = awaiting; disagreement → the chain wins and says so", () => {
    const rule = validateRule(PM_BUCS);
    const none = resolvePolymarket(rule, [{ market: resolved, chain: null }], { sinceIso: null });
    assert.deepEqual([none.events.length, none.awaitingFinal], [0, 1]);
    const unresolved = resolvePolymarket(rule, [{ market: resolved, chain: fakeRes(BUCS_CID, [0, 0], 0) }], { sinceIso: null });
    assert.deepEqual([unresolved.events.length, unresolved.awaitingFinal], [0, 1]);
    const flipped = resolvePolymarket(rule, [{ market: resolved, chain: fakeRes(BUCS_CID, [0, 1], 1) }], { sinceIso: null });
    assert.equal(flipped.events[0].result, "no");
    assert.match(flipped.refusals.join(" "), /Gamma reports yes, the CTF payout vector says no — the chain is the record/);
    const voided = resolvePolymarket(rule, [{ market: { ...resolved, outcomeFigures: ["0.5", "0.5"] }, chain: fakeRes(BUCS_CID, [1, 1], 2) }], { sinceIso: null });
    assert.equal(voided.events[0].result, "void");
    assert.match(voided.events[0].proof!, /payouts:1,1\/denominator:2\//);
    assert.equal(resolvePolymarket(rule, [{ market: resolved, chain: fakeRes(BUCS_CID, [1, 0], 1) }], { sinceIso: "2026-10-09T03:36:14Z" }).events.length, 0, "strictly after since");
    assert.equal(none.settlementSourceUrl, POLYGONSCAN_CTF);
  });
});

describe("rules and selectors", () => {
  test("a condition id (one-shot), tag/type/glob and event series validate; scalar, tickerIncludes, uppercase ids and bad series are refused", () => {
    for (const r of [PM_BUCS, PM_NFL_MONEYLINE, { ...PM_NFL_MONEYLINE, series: "tag:nfl/moneyline:nfl-*den-*" }, { ...PM_NFL_MONEYLINE, series: "event:fed-decision-in-october-20260617190323537", filter: {} }, { ...PM_NFL_MONEYLINE, series: "tag:fed-rates", filter: {} }]) assert.doesNotThrow(() => validateRule(r), JSON.stringify(r.series));
    assert.throws(() => validateRule({ ...PM_BUCS, market: BUCS_CID.toUpperCase().replace("0X", "0x") }), /condition id/);
    assert.throws(() => validateRule({ ...PM_BUCS, kind: "scalar", binary: null, scalar: { unit: 1, perUnit: { fractionOfPool: 0.02 }, baseline: 0, direction: "up" } }), /binary/);
    assert.throws(() => validateRule({ ...PM_NFL_MONEYLINE, filter: { tickerIncludes: "DEN" } }), /titleRegex/);
    assert.throws(() => validateRule({ ...PM_NFL_MONEYLINE, series: "KXNFLGAME" }), /tag:<tag slug>/);
    assert.throws(() => validateRule({ ...PM_BUCS, series: "tag:nfl" }), /series OR one market/);
    assert.throws(() => validateRule({ ...PM_BUCS, oracle: "kalshi" }), /market must be a market ticker/);
  });
  test("selector keys, glob matching, series parsing and the plain statement (YES = the first outcome; a 50-50 resolution is a void)", () => {
    assert.equal(selectorKeyOf(validateRule(PM_BUCS)), `polymarket:market:${BUCS_CID}`);
    assert.equal(selectorKeyOf(validateRule(PM_NFL_MONEYLINE)), "polymarket:tag:nfl/moneyline:binary");
    assert.deepEqual(parsePolySeries("tag:nfl/moneyline:nfl-*den-*"), { kind: "tag", tag: "nfl", type: "moneyline", glob: "nfl-*den-*" });
    assert.deepEqual(parsePolySeries("event:abc-def"), { kind: "event", slug: "abc-def" });
    assert.ok(globMatch("nfl-*den-*", "nfl-den-sf-2026-10-04") && globMatch("nfl-*den-*", "nfl-sea-den-2026-10-16") && !globMatch("nfl-*den-*", "nfl-kc-lv-2026-10-04"));
    const s = ruleStatement(validateRule(PM_BUCS), { marketTitle: "Buccaneers vs. Cowboys" });
    assert.match(s, /Polymarket market 0xd438.*"Buccaneers vs\. Cowboys"/); assert.match(s, /YES is the market's first outcome/); assert.match(s, /50-50 resolution is a void/);
    assert.match(ruleStatement(validateRule(PM_NFL_MONEYLINE), { seriesTitle: "NFL (All)" }), /every binary Polymarket market tagged "nfl" \(NFL \(All\)\) of type moneyline whose question matches/);
    assert.match(descriptionFooter(lockRule(PM_BUCS)), /Polymarket market 0xd438/);
    assert.equal(oracleDisclosure("polymarket"), POLYMARKET_DISCLOSURE); assert.match(POLYMARKET_DISCLOSURE, /Conditional Tokens contract on Polygon/);
    const ml = validateRule(PM_NFL_MONEYLINE);
    const byQ = (q: string) => tagClosed.find((m) => m.question.startsWith(q))!;
    assert.ok(polySelectorMatches(ml, byQ("Broncos vs. 49ers")));
    assert.ok(!polySelectorMatches(ml, byQ("Will the Saints win the season series")), "the question regex keeps head-to-head games only");
    assert.ok(polySelectorMatches(validateRule({ ...PM_NFL_MONEYLINE, series: "tag:nfl/moneyline:nfl-*den-*" }), byQ("Broncos vs. 49ers")));
    assert.ok(!polySelectorMatches(validateRule({ ...PM_NFL_MONEYLINE, series: "tag:nfl/moneyline:nfl-*den-*" }), byQ("Chiefs vs. Raiders")));
  });
  test("why no team coin on Polymarket: the same team is YES in one game and NO in the next (the fixture shows it)", () => {
    const den = tagClosed.filter((m) => m.outcomes.includes("Broncos"));
    assert.ok(den.length >= 2);
    assert.deepEqual(new Set(den.map((m) => m.outcomes.indexOf("Broncos"))), new Set([0, 1]), "Broncos vs. 49ers → slot 0; Rams vs. Broncos → slot 1");
  });
  test("a rivalry pair on one Polymarket market: side A burns on YES, side B on NO (inverted), both locked independently", async () => {
    const a = validateRule({ ...PM_BUCS, pair: { pairId: "bucs-vs-boys-0xd438", side: "A", counterpartMint: null } });
    const b = invertMapping(a, Keypair.generate().publicKey.toBase58());
    assert.deepEqual([b.binary!.onYes, b.binary!.onNo], [null, { fractionOfPool: 0.05 }]);
    assert.notEqual(lockRule(a).sha256, lockRule(b).sha256);
    const { FakeBurnProgram } = await import("@/lib/burnticker/program");
    const deps = { program: new FakeBurnProgram("devnet"), launchLab: new FakeLaunchLab(), devFeeWallet: null, attesters: [ATTESTER], quorum: 1, metadataUri: (m: string) => `https://x/${m}.json` };
    const input = { creator: CREATOR, ticker: "BUCS", name: "Bucs", description: "", imageUrl: null, links: [], rule: withFullFraction(PM_BUCS as BurnRule) /* audit 12: a linked one-market pair is 100 % only */, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true }, cluster: "devnet" as const };
    const pair = await buildPairBundles({ a: input, b: { ticker: "BOYS", name: "Boys", description: "", imageUrl: null, links: [] } }, deps);
    assert.equal(pair.selector, BUCS_CID);
    const ra = lockRule(JSON.parse(pair.a.rules.text)).rule, rb = lockRule(JSON.parse(pair.b.rules.text)).rule;
    assert.deepEqual([ra.binary!.onYes !== null, rb.binary!.onNo !== null, rb.pair!.counterpartMint], [true, true, pair.a.mint]);
  });
});

describe("the client on the fixtures", () => {
  test("one market: Gamma (closed=true) then the chain → one YES reading with the Gamma URL, the proof and the method; the open market → nothing", async () => {
    const c = polyClient();
    const r = await c.settledSince(validateRule(PM_BUCS), null);
    assert.equal(r.events.length, 1);
    const e = r.events[0];
    assert.deepEqual([e.id, e.at, e.result, e.title], [BUCS_CID, "2026-10-09T03:36:14Z", "yes", "Buccaneers vs. Cowboys"]);
    assert.equal(e.sourceUrl, settledMarketUrl(BUCS_CID));
    assert.match(e.proof!, new RegExp(`^polygon:137/ctf:0x4D97DCd97eC945f40cF65F87097ACe5EA0476045/condition:${BUCS_CID}/payouts:1,0/block:\\d+$`));
    assert.match(e.method!, /ctf-payout: \[1, 0\] → yes \(YES = "Buccaneers", NO = "Cowboys"\)/);
    const o = await c.settledSince(validateRule({ ...PM_BUCS, market: EAGLES_CID }), null);
    assert.deepEqual([o.events.length, o.awaitingFinal], [0, 0], "an open market is neither settled nor awaiting");
    // A resolved vector is cached for good; the second read does not touch the RPC.
    const before = c.chainReads.length; await c.settledSince(validateRule(PM_BUCS), null); assert.equal(c.chainReads.length, before);
  });
  test("a tag series (tag:nfl/moneyline + head-to-head regex): every game since 09-30 read on chain, agreeing with Gamma, oldest first", async () => {
    const c = polyClient();
    const r = await c.settledSince(validateRule(PM_NFL_MONEYLINE), "2026-09-30T00:00:00Z");
    const want = tagClosed.filter((m) => /^[^:]+ vs\. [^:]+$/.test(m.question) && m.closedTime! > "2026-09-30T00:00:00Z");
    assert.equal(r.events.length, want.length);
    assert.ok(r.events.length >= 15);
    assert.deepEqual(r.refusals, [], "the chain agrees with Gamma on every game");
    for (const e of r.events) assert.equal(e.result, gammaResult(want.find((m) => m.conditionId === e.id)!));
    assert.deepEqual(r.events.map((e) => e.at), [...r.events.map((e) => e.at)].sort());
    assert.ok(c.requests.includes(marketsByTagUrl("450", { closed: true, type: "moneyline", limit: 50, offset: 0, endMin: "2026-09-24T00:00:00Z", endMax: "2026-10-08T00:00:00Z" })), "14-day end-date windows aligned to the epoch");
    assert.ok(!c.requests.some((u) => u.includes("end_date_max=2026-09-10")), "nothing older than one window before since is read");
  });
  test("the refuse list applies to every question (a refused market is never read); every chain read failing throws; the chain cap and a dense scan say so", async () => {
    const refusing = polyClient({ refuse: (titles) => (titles.some((t) => /Cowboys/.test(t)) ? ["test: no Cowboys"] : []) });
    const r = await refusing.settledSince(validateRule(PM_NFL_MONEYLINE), "2026-09-30T00:00:00Z");
    assert.ok(r.events.every((e) => !/Cowboys/.test(e.title!)));
    assert.ok(r.refusals.some((x) => /refused \(test: no Cowboys\) — never read/.test(x)));
    await assert.rejects(polyClient({ chain: { ...CHAIN, calls: {} } }).settledSince(validateRule(PM_BUCS), null), /every on-chain read failed/);
    const capped = await polyClient({ chainCap: 2 }).settledSince(validateRule(PM_NFL_MONEYLINE), "2026-09-30T00:00:00Z");
    assert.equal(capped.events.length, 2);
    assert.ok(capped.refusals.some((x) => /more closed markets? waits? for the next cycle/.test(x)));
    const dense = await polyClient({ pageCap: 1 }).settledSince(validateRule(PM_NFL_MONEYLINE), "2026-01-01T00:00:00Z");
    assert.ok(dense.refusals.some((x) => /settles more markets than one cycle reads/.test(x)));
  });
  test("the back-test reads Gamma's closed markets (display-grade) through the same unit engine", async () => {
    const c = polyClient();
    const g = await c.gammaSettled(validateRule(PM_NFL_MONEYLINE), "2026-09-30T00:00:00Z");
    const chain = await c.settledSince(validateRule(PM_NFL_MONEYLINE), "2026-09-30T00:00:00Z");
    assert.deepEqual(g.events.map((e) => [e.id, e.result]), chain.events.map((e) => [e.id, e.result]));
    assert.match(g.events[0].method!, /gamma-report/);
    const bt = backtest(validateRule(PM_NFL_MONEYLINE), g.events, Date.parse("2026-10-10T17:30:00Z"), 1);
    assert.equal(bt.totals.events, g.events.length);
    assert.equal(bt.totals.burnEvents, g.events.filter((e) => e.result === "no").length, "burns on NO (the second-listed team won)");
    const one = await c.gammaSettled(validateRule(PM_BUCS), null);
    assert.deepEqual([one.events.length, one.title, one.oneShotCloseTime], [1, "Buccaneers vs. Cowboys", "2026-10-09T00:15:00Z"]);
  });
  test("implied chance (display only): the next open game; a NO side is 1 − the YES mid", async () => {
    const openMarkets = parseMarketsBody(PM_TAG_OPEN.gamma.body);
    const ic = impliedChanceFromMarkets(validateRule(PM_NFL_MONEYLINE), openMarkets);
    assert.equal(ic.marketTicker, EAGLES_CID);
    assert.ok(Math.abs(ic.chance! - 0.765) < 1e-9);
    assert.match(ic.basis, /1 − the "Eagles" \(YES\) mid/);
    const viaClient = await polyClient().impliedChance(validateRule(PM_NFL_MONEYLINE));
    assert.equal(viaClient.marketTicker, EAGLES_CID);
  });
  test("search: events with their binary markets (moneyline first), the event and its tags as recurring selectors, refusals marked", async () => {
    const c = polyClient();
    const r = await c.search("eagles");
    const g = r.events.find((e) => e.slug === "nfl-phi-jax-2026-10-11")!;
    assert.ok(g, "the Eagles–Jaguars game");
    assert.deepEqual([g.markets[0].conditionId, g.markets[0].yes, g.markets[0].no], [EAGLES_CID, "Eagles", "Jaguars"]);
    assert.deepEqual(g.selector, { oracle: "polymarket", series: "event:nfl-phi-jax-2026-10-11", market: null });
    assert.ok(r.tags.some((t) => t.slug === "nfl" && t.series.includes("tag:nfl/moneyline")));
    assert.ok(!r.tags.some((t) => t.slug === "sports"), "generic tags are not offered");
    const refused = searchHits((await import("@/lib/burnticker/oracle/polymarket")).parseEventsBody(PM_SEARCH.gamma.body), { refuse: (t) => (t.some((x) => /Jaguars/.test(x)) ? ["test"] : []) });
    assert.deepEqual(refused.events.find((e) => e.slug === "nfl-phi-jax-2026-10-11")!.refused, ["test"]);
    const byId = await c.search(EAGLES_CID);
    assert.equal(byId.markets[0].question, "Eagles vs. Jaguars");
  });
});

describe("verification", () => {
  test("polymarketSourceReading re-reads Gamma and the payout vector; a tampered receipt result fails the source check", async () => {
    const rule = validateRule(PM_BUCS);
    const src = await polymarketSourceReading(rule, BUCS_CID, { fetchImpl: gammaFixtureFetch(GAMMA_TABLE), rpcFetch: rpcFixtureFetch(CHAIN), rpcUrls: ["https://polygon-rpc.test"] });
    assert.equal(src.error, null);
    assert.deepEqual(src.events!.map((e) => [e.id, e.result]), [[BUCS_CID, "yes"]]);
    const receipt = { eventId: BUCS_CID, result: "yes", value: null, units: 1, prevValue: null, carryIn: "0", mapping: { fractionOfPool: 0.05 }, memo: null, signature: null, status: "planned" };
    const ok = verifyReceiptCore({ ticker: "BUCS", rulesText: lockRule(PM_BUCS).text, receipt, carry: "none", source: src, chain: null });
    assert.deepEqual(ok.checks.filter((c) => c.id === "source" || c.id === "units").map((c) => c.ok), [true, true]);
    const bad = verifyReceiptCore({ ticker: "BUCS", rulesText: lockRule(PM_BUCS).text, receipt: { ...receipt, result: "no", units: 0, mapping: null }, carry: "none", source: src, chain: null });
    assert.equal(bad.checks.find((c) => c.id === "source")!.ok, false);
    assert.equal((await polymarketSourceReading(rule, "KXNFL-1", { fetchImpl: gammaFixtureFetch(GAMMA_TABLE) })).error?.includes("not a Polymarket condition id"), true);
  });
});

describe("the keeper, the API and the SDK (on the fakes)", () => {
  let w: World;
  let bucs: { mint: string };
  before(async () => {
    w = await makeWorld();
    const b = await buildLaunchBundle({ creator: CREATOR, ticker: "BUCS", name: "Bucs coin", description: "", imageUrl: null, links: [], rule: PM_BUCS, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true }, cluster: "devnet" }, { program: w.program, launchLab: new FakeLaunchLab(), devFeeWallet: null, attesters: [ATTESTER], quorum: 1, metadataUri: (m) => `https://x/${m}.json` });
    const t = w.registry.register({ mint: b.mint, ticker: "BUCS", name: b.name, creator: CREATOR, description: b.description, imageUrl: null, links: [], rulesText: b.rules.text, feePda: b.addresses.feePda, vault: null, tokenConfig: b.addresses.tokenConfig, poolId: b.addresses.poolId, launchTx: null, cluster: "devnet", platformId: b.addresses.platformId, baselineAt: "2026-10-01T00:00:00Z", status: "draft" }, NOW);
    w.registry.markLaunched(t.mint, "launchBUCS", b.addresses.poolId, "2026-10-01T00:00:00Z");
    w.registry.addAttester({ mint: t.mint, pubkey: ATTESTER, role: "data-key", addedAt: NOW, timelockUntil: null });
    w.program.supplies.set(t.mint, BigInt("1000000000000000"));
    w.program.deposit(t.mint, BigInt(4_000_000_000));
    bucs = t;
  });
  test("runCycle: the Polymarket key is read on chain, the reading carries its proof, the receipt is cranked; a second cycle writes nothing new", async () => {
    const deps = { registry: w.registry, program: w.program, oracles: { kalshi: w.p.oracles.kalshi, catalogue: w.p.oracles.catalogue, polymarket: w.p.polymarket }, attester: ATTESTER, log: () => {}, now: () => NOW, dryRun: false };
    const rep = await runCycle(deps);
    const f = rep.fetched.find((x) => x.key === `polymarket:market:${BUCS_CID}`)!;
    assert.deepEqual([f.written, f.error], [1, null]);
    const [reading] = w.registry.readings(`polymarket:market:${BUCS_CID}`);
    assert.deepEqual([reading.oracle, reading.result, reading.sourceUrl, reading.settlementSourceUrl], ["polymarket", "yes", settledMarketUrl(BUCS_CID), POLYGONSCAN_CTF]);
    assert.match(reading.proof!, /condition:0xd438.*\/payouts:1,0\/block:/);
    const receipt = w.registry.receipt(bucs.mint, BUCS_CID)!;
    assert.equal(receipt.status, "confirmed", JSON.stringify(rep.executed.filter((x) => x.mint === bucs.mint), (_k, v) => (typeof v === "bigint" ? v.toString() : v)) + JSON.stringify(rep.errors));
    assert.ok((receipt.burnRaw ?? BigInt(0)) > BigInt(0));
    const again = await runCycle({ ...deps, now: () => NOW + 10 * 60_000 });
    assert.equal(again.fetched.find((x) => x.key === `polymarket:market:${BUCS_CID}`)!.written, 0);
    // A keeper without a Polymarket adapter holds the key with an error (it never misreads it as Kalshi).
    const blind = await runCycle({ ...deps, oracles: { kalshi: w.p.oracles.kalshi, catalogue: w.p.oracles.catalogue }, now: () => NOW + 3_600_000 });
    assert.match(blind.fetched.find((x) => x.key === `polymarket:market:${BUCS_CID}`)!.error ?? "", /no Polymarket adapter/);
  });
  test("v1: /polymarket/search and /polymarket/backtest answer schema-valid; the token API shows the proof; verify passes the source check from the chain", async () => {
    const DOC = buildOpenApi() as unknown as Record<string, unknown> & { paths: Record<string, Record<string, { responses: Record<string, { content: { "application/json": { schema: Record<string, unknown> } } }> }>> };
    const call = async (op: string, o: { query?: string; body?: unknown; expect?: number; path?: string } = {}) => {
      const ep = endpoint(op);
      const res = await callRoute(`${API}${o.path ?? ep.path}${o.query ? `?${o.query}` : ""}`, { method: ep.method, headers: ep.method === "POST" ? POST_HEADERS : undefined, body: o.body === undefined ? undefined : JSON.stringify(o.body) });
      const body = await res.json() as Record<string, unknown>;
      assert.equal(res.status, o.expect ?? 200, `${op}: ${JSON.stringify(body).slice(0, 300)}`);
      assert.deepEqual(validateSchema(DOC.paths[ep.path][ep.method.toLowerCase()].responses[String(res.status)].content["application/json"].schema, body, DOC), [], op);
      return body;
    };
    const s = await call("searchPolymarket", { query: "q=eagles" });
    assert.ok((s.events as { slug: string }[]).some((e) => e.slug === "nfl-phi-jax-2026-10-11"));
    await call("searchPolymarket", { query: "q=e", expect: 400 });
    const bt = await call("backtestPolymarket", { body: { rule: PM_NFL_MONEYLINE, months: 1 } });
    assert.ok((bt.matched as number) >= 15);
    assert.equal(bt.scanComplete, true, "one month of end-date windows, every one in the fixture");
    assert.match(bt.sentence as string, /comes from Gamma's closed markets\. The keeper reads each result from the Polygon payout vector\./);
    await call("backtestPolymarket", { body: { rule: { ...PM_BUCS, oracle: "kalshi" } }, expect: 400 });
    const one = await call("backtestKalshi", { body: { rule: PM_BUCS } });
    assert.equal(one.seriesTitle, "Buccaneers vs. Cowboys", "the shared back-test pipeline dispatches on the oracle");
    const tok = await call("getToken", { path: "/tokens/BUCS" });
    const rd = (tok.readings as { id: string; proof: string | null }[]).find((r) => r.id === BUCS_CID)!;
    assert.match(rd.proof!, /^polygon:137\/ctf:/);
    assert.match(((tok.status as { disclosure: { eventContract: string } }).disclosure.eventContract), /Conditional Tokens contract on Polygon/);
    const v = await call("verifyReceipt", { path: `/tokens/BUCS/verify/${BUCS_CID}` });
    const checks = Object.fromEntries((v.checks as { id: string; ok: boolean | null }[]).map((c) => [c.id, c.ok]));
    assert.equal(checks.source, true); assert.equal(checks.units, true); assert.equal(checks.rules, true);
    const cat = await call("getCatalogue");
    assert.equal((cat.sources as { id: string; launchable: { ok: boolean } }[]).find((x) => x.id === "polymarket")!.launchable.ok, true);
  });
  test("v1 launch: a Polymarket one-shot builds a bundle (refuse list on the question, binary check); a tag series passes the weekly density check", async () => {
    // (the second coin on the same market is $TAMPA, not $BUCS2: since the growth batch a copycat suffix of an existing ticker is refused — lookalike.ts)
    const mint = () => Keypair.generate().publicKey.toBase58();
    const res = await callRoute(`${API}/launch/bundle`, { method: "POST", headers: POST_HEADERS, body: JSON.stringify({ creator: CREATOR, mint: mint(), ticker: "TAMPA", name: "tampa bay one shot", rule: PM_BUCS, register: false, acknowledgements: { ruleLocked: true, noReturns: true } }) });
    const body = await res.json() as { review: { seriesTitle: string; receiptFormat: string; disclosure: { eventContract: string } } };
    assert.equal(res.status, 200, JSON.stringify(body).slice(0, 300));
    assert.equal(body.review.seriesTitle, "Buccaneers vs. Cowboys");
    assert.match(body.review.receiptFormat, /oracle=polymarket/);
    assert.match(body.review.disclosure.eventContract, /Polymarket/);
    const tag = await callRoute(`${API}/launch/bundle`, { method: "POST", headers: POST_HEADERS, body: JSON.stringify({ creator: CREATOR, mint: mint(), ticker: "NFLNO", name: "nfl no", rule: PM_NFL_MONEYLINE, register: false, acknowledgements: { ruleLocked: true, noReturns: true } }) });
    assert.equal(tag.status, 200, (await tag.text()).slice(0, 300));
    const unknown = await callRoute(`${API}/launch/bundle`, { method: "POST", headers: POST_HEADERS, body: JSON.stringify({ creator: CREATOR, mint: mint(), ticker: "NOPE", name: "nope", rule: { ...PM_BUCS, market: `0x${"ab".repeat(32)}` }, register: false, acknowledgements: { ruleLocked: true, noReturns: true } }) });
    assert.equal(unknown.status, 502);
  });
  test("SDK: polymarket.search / backtest through the API; verifyReceipt re-reads the payout vector on the caller's machine", async () => {
    const bt = new Burnticker({ apiBase: API, fetch: routeFetch });
    const s = await bt.polymarket.search("eagles");
    assert.ok(s.events.length > 0);
    const b = await bt.polymarket.backtest({ series: "tag:nfl/moneyline", filter: { titleRegex: "^[^:]+ vs\\. [^:]+$" } }, { kind: "binary", binary: { onYes: { fractionOfPool: 0.02 } } }, { months: 1 });
    assert.ok(b.matched >= 15);
    const t = await bt.token("BUCS");
    const r = t.receipts.find((x) => x.eventId === BUCS_CID)!;
    const gammaFetch = gammaFixtureFetch(GAMMA_TABLE);
    const v = await verifyReceipt(r, { ticker: "BUCS", rulesText: t.rulesText, fetch: ((url: string) => gammaFetch(url)) as never, polygonFetch: rpcFixtureFetch(CHAIN) as never, polygonRpcUrls: ["https://polygon-rpc.test"] });
    assert.equal(v.checks.find((c) => c.id === "source")!.ok, true, JSON.stringify(v.checks));
    assert.equal(v.checks.find((c) => c.id === "units")!.ok, true);
  });
});

test("the fixtures are real: fetched 2026-10-10 from Gamma and Polygon, with their URLs", () => {
  for (const f of [PM_RESOLVED, PM_OPEN, PM_TAG_OPEN, PM_SEARCH]) { assert.match(f.fetchedAt, /^2026-10-10T/); assert.match(f.gamma.url, /^https:\/\/gamma-api\.polymarket\.com\//); }
  assert.match(PM_TAG_CLOSED.fetchedAt, /^2026-10-10T/); assert.ok(PM_TAG_CLOSED.pages.every((p) => p.url.startsWith("https://gamma-api.polymarket.com/markets?tag_id=450&closed=true")));
  for (const f of [PM_RESOLVED.chain!, PM_OPEN.chain!, PM_TAG_CLOSED.chain]) assert.equal(f.contract, "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045");
  const rule: BurnRule = validateRule(PM_BUCS); void rule;
});
