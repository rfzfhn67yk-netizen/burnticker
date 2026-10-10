// BURN DERBY, part 2 (2026-10-10): the bracket (advancement, tiebreaks, the doubled final, losers retiring), the both-or-neither clause
// every rivalry pair now carries (pending-pair → live in order; void at voidBy → voided receipts + the onEnd wind-down; a voided derby is a
// no-contest), the public API shapes (GET /derby, /derby/{id}, /derby/search against the OpenAPI document), and the creation preflight
// for a WIF-vs-SHIB pair (Pyth on Solana + Hermes, Jupiter + RedStone cross-reads) and a GIGA pair (pool TWAP + Jupiter).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { rulesSha256 } from "@/lib/burnKeeper/rules";
import { lockRule } from "@/lib/burnticker/rules";
import { runCycle } from "@/lib/burnticker/multiKeeper";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import { pairDailyText, pairStateLine } from "@/lib/launch/dailyPost";
import { bracketFanRule, bracketState, compound, finalUnits, lockTournament, matchKey, registerTournament, roundDates, TOURNAMENT_SCHEMA, type MatchDayResult, type Tournament } from "@/lib/burnticker/derby/bracket";
import { derbyStore } from "@/lib/burnticker/derby/store";
import { derbyTournamentJson } from "@/lib/burnticker/derby/page";
import { bracketRoundText } from "@/lib/burnticker/derby/post";
import { derbySeriesId, nextUtcMidnight, windowAt, windowSpan, type CoinVsSpec, type DerbyUnderlying } from "@/lib/burnticker/derby/spec";
import { DerbyAdapter } from "@/lib/burnticker/derby/adapter";
import { pythFeedAccount, pythSnapshotFromAccount, loadPythCatalogue } from "@/lib/burnticker/derby/pyth";
import { preflightSelector } from "@/lib/burnticker/coverage/preflight";
import { openRegistry } from "@/lib/burnticker/registry";
import { FakeBurnProgram } from "@/lib/burnticker/program";
import { buildPairBundles, FakeLaunchLab } from "@/lib/burnticker/launchBundle";
import { prepareLaunch } from "@/lib/burnticker/api/handlers";
import { buildOpenApi } from "@/lib/burnticker/api/spec";
import { pairTally } from "@/lib/burnticker/tokenPage";
import { tokenPageData } from "@/lib/burnticker/server";
import { API, callRoute, makeWorld, validateSchema } from "./burntickerApiHelpers.ts";
import { ATTESTER, B, CREATOR, GIGA, GIGA_MINT, GIGA_POOL, SHIB, WIF, WIF_MINT, coinvsRule, cpmmAccounts, derbyWorld, fixtureFetch, fixtureHermes, fixturePort, fjson, launchSingle, seedCross } from "./burntickerDerbyHelpers.ts";

const lint = (t: string) => lintCopy(t, loadCopyLintConfig()).hits.map((h) => `${h.phrase}:${h.rule}`);
const SEASON: CoinVsSpec = { selector: "coinvs", a: WIF, b: SHIB, window: "daily", measure: "pct", season: { start: "2026-10-05", days: 7 }, flip: false };
const CRYPTO8 = ["WIF", "BONK", "SHIB", "POPCAT", "SOL", "BTC", "ETH", "DOGE"].map((sym): DerbyUnderlying => ({ symbol: sym, pyth: loadPythCatalogue().find((r) => r.symbol === `Crypto.${sym}/USD`)!.id, mint: null, pool: null, cross: `redstone:${sym}` }));
const T: Tournament = { schema: TOURNAMENT_SCHEMA, id: "memecup-1", title: "Meme Cup", underlyings: CRYPTO8, start: "2026-10-05", roundDays: 2, fractionOfPool: 0.01 };

describe("the bracket", () => {
  test("locked by hash; 8 or 16 distinct coins; a bad bracket lists every problem", () => {
    const l = lockTournament(T, rulesSha256);
    assert.match(l.sha256, /^[0-9a-f]{64}$/);
    assert.throws(() => lockTournament({ ...T, underlyings: CRYPTO8.slice(0, 6) }, rulesSha256), /8 or 16/);
    assert.throws(() => lockTournament({ ...T, underlyings: [...CRYPTO8.slice(0, 7), CRYPTO8[0]] }, rulesSha256), /distinct/);
    assert.equal(finalUnits(0.01), 2); assert.equal(finalUnits(0.05), 2); assert.equal(finalUnits(0.06), 1);
    assert.equal(compound(["5", "-2"]), "2.9"); assert.equal(compound([]), "0");
    assert.deepEqual(roundDates(T, 1), ["2026-10-07", "2026-10-08"]);
  });

  test("advancement: more winning days; tiebreak the compounded change, then the lower slot; the loser is eliminated; the champion", () => {
    // Slot s's daily change = s % (so the higher slot wins every day) except: match r0m1 (2 vs 3) splits 1–1 with slot 2 ahead on the
    // compounded change; match r0m3 (6 vs 7) ties every day at 0% (the lower slot advances).
    const res = (r: number, m: number, a: number, b: number, date: string): MatchDayResult => {
      if (r === 0 && m === 1) return date === "2026-10-05" ? { status: "decided", winner: "a", changeA: "9", changeB: "1", eventId: `e${date}`, proofSha256: null } : { status: "decided", winner: "b", changeA: "-1", changeB: "1", eventId: `e${date}`, proofSha256: null };
      if (r === 0 && m === 3) return { status: "decided", winner: "tie", changeA: "0", changeB: "0", eventId: `e${date}`, proofSha256: null };
      return { status: "decided", winner: b > a ? "b" : "a", changeA: String(a), changeB: String(b), eventId: `e${date}`, proofSha256: null };
    };
    const s = bracketState(T, res);
    assert.deepEqual(s.rounds[0].matches.map((m) => [m.winner, m.tiebreak]), [[1, "wins"], [2, "cumulative"], [5, "wins"], [6, "lower-slot"]]);
    assert.deepEqual(s.rounds[1].matches.map((m) => [m.a, m.b, m.winner]), [[1, 2, 2], [5, 6, 6]]);
    assert.equal(s.rounds[2].final, true); assert.equal(s.champion, 6);
    assert.equal(s.eliminatedIn.get(0), 0); assert.equal(s.eliminatedIn.get(2), 2);
    // While a round runs, the next one has no slots yet.
    const open = bracketState(T, (r, m, a, b, date) => (date >= "2026-10-06" ? null : res(r, m, a, b, date)));
    assert.equal(open.current, 0); assert.equal(open.rounds[1].matches[0].a, -1);
  });

  test("fan coins through the keeper: winning days burn (two units in the final), losers' coins retire; the bracket page and the round post", async () => {
    const registry = openRegistry(":memory:");
    const program = new FakeBurnProgram("devnet");
    const clock = { now: B(11) + 3 * 3600_000 };
    program.now = () => clock.now;
    const store = derbyStore(registry.db);
    const { sha256 } = registerTournament(store, T, rulesSha256, B(1));
    assert.throws(() => registerTournament(store, { ...T, title: "Another" }, rulesSha256), /different bracket/);
    const coins = await Promise.all([0, 1, 7].map((slot) => launchSingle(registry, program, lockRule(bracketFanRule(T, sha256, slot)).rule, `FAN${slot}`)));
    // Every match day of the bracket recorded: the higher slot wins every day, except slot 7 beats 6 and then everyone.
    const winnerOf = (a: number, b: number) => (a === 7 || b === 7 ? (a === 7 ? "yes" : "no") : b > a ? "no" : "yes");
    let entrants = T.underlyings.map((_, i) => i);
    for (let r = 0; r < 3; r++) {
      const next: number[] = [];
      for (let m = 0; m < entrants.length / 2; m++) {
        const a = entrants[2 * m], b = entrants[2 * m + 1], result = winnerOf(a, b);
        for (const date of roundDates(T, r)) {
          const w = windowSpan("daily", date);
          store.decide({ selectorKey: matchKey(T.id, r, m), windowId: date, status: "decided", eventId: `${date}:${String(r * 10 + m).padStart(16, "0")}`, at: windowAt(w), result, value: result === "yes" ? "1" : "-1", reason: "seeded", proofSha256: "ab".repeat(32), proof: { a: { changePct: result === "yes" ? "2" : "1" }, b: { changePct: result === "yes" ? "1" : "2" } } }, B(4));
        }
        next.push(result === "yes" ? a : b);
      }
      entrants = next;
    }
    const adapter = new DerbyAdapter({ registry, hermes: null, pools: null, fetchImpl: fixtureFetch(), now: () => clock.now });
    const stub = { id: "stub", searchSeries: async () => [], seriesInfo: async () => null, settledSince: async () => ({ events: [], awaitingFinal: 0, refusals: [], settlementSourceUrl: null }), impliedChance: async () => ({ chance: null, marketTicker: null, closeTime: null, basis: "" }) };
    const deps = { registry, program, oracles: { kalshi: stub, catalogue: stub, derby: adapter }, derby: { sample: (t: Parameters<typeof adapter.sample>[0]) => adapter.sample(t), plan: () => adapter.plan(), ended: (t: Parameters<typeof adapter.ended>[0]) => adapter.ended(t) }, attester: ATTESTER, log: () => {}, now: () => clock.now, dryRun: false };
    await runCycle(deps); await runCycle(deps);
    const rc = (i: number) => registry.receipts(coins[i].mint).filter((r) => r.kind !== "winddown").map((r) => `${r.settledAt.slice(0, 10)}:${r.value}:${r.units}:${r.status}`);
    // Slot 7: wins its two round-one days, two semi-final days, and the two final days at two units each.
    assert.deepEqual(rc(2), ["2026-10-05:1:1:confirmed", "2026-10-06:1:1:confirmed", "2026-10-07:1:1:confirmed", "2026-10-08:1:1:confirmed", "2026-10-09:2:2:confirmed", "2026-10-10:2:2:confirmed"]);
    // Slot 0 loses round one to slot 1 (two zero-point days) and retires; slot 1 wins round one, loses round two to slot 3, retires.
    assert.deepEqual(rc(0), ["2026-10-05:0:0:nothing", "2026-10-06:0:0:nothing"]);
    assert.deepEqual(rc(1), ["2026-10-05:1:1:confirmed", "2026-10-06:1:1:confirmed", "2026-10-07:0:0:nothing", "2026-10-08:0:0:nothing"]);
    // Knocked out: the rule ENDED at the round's end and the pool winds down from that day (slot 0 from 10-07, slot 1 from 10-09).
    assert.match(registry.ruleEnd(coins[0].mint)!.reason, /knocked out in round 1/); assert.match(registry.ruleEnd(coins[1].mint)!.reason, /round 2/);
    assert.equal(registry.receipts(coins[0].mint).filter((r) => r.kind === "winddown")[0].eventId, "winddown-2026-10-07");
    assert.equal(registry.receipts(coins[1].mint).filter((r) => r.kind === "winddown")[0].eventId, "winddown-2026-10-09");
    assert.equal(registry.ruleEnd(coins[2].mint), null, "the champion's rule does not end (nothing more to read; it stays live)");
    clock.now = B(11) + 32 * 86_400_000;
    for (let i = 0; i < 3; i++) await runCycle(deps);
    assert.equal(registry.token(coins[0].mint)!.status, "retired"); assert.equal(registry.token(coins[1].mint)!.status, "retired");
    assert.equal(registry.token(coins[2].mint)!.status, "live");
    const j = derbyTournamentJson(registry, T, sha256, B(11) + 3 * 3600_000);
    assert.equal(j.status, "complete"); assert.equal(j.champion!.symbol, "DOGE"); assert.equal(j.champion!.ticker, "FAN7");
    assert.equal(j.coins[0].eliminatedInRound, 1); assert.match(j.coins[0].retiredReason!, /knocked out/);
    assert.equal(j.finalUnits, 2);
    const post = bracketRoundText(j, 0);
    assert.deepEqual(lint(post), [], post);
    assert.match(post, /WIF 0 – 2 BONK \(BONK advances\)/);
  });
});

describe("both or neither", () => {
  const wifPyth = ["0.2", "0.21", "0.2058", "0.2058", "0.21", "0.21", "0.2205", "0.2205"], shibPyth = ["0.0000055", "0.00000561", "0.0000055", "0.0000055", "0.00000561", "0.0000055", "0.0000055", "0.0000055"];
  // WIF's cross-read 6% off at 10-09 → days 4 and 5 withheld, as in the main WIF-vs-SHIB test.
  const seedAll = (w: Parameters<typeof seedCross>[0]) => { wifPyth.forEach((v, i) => seedCross(w, WIF, B(5 + i), i === 4 ? "0.2181" : v)); shibPyth.forEach((v, i) => seedCross(w, SHIB, B(5 + i), v)); };

  test("readings before both pools register wait as pending-pair; the second registration takes the pair live and the waits execute in order", async () => {
    const w = await derbyWorld(SEASON, { autoRegisterPool: false });
    seedAll(w);
    await runCycle(w.deps);
    const st = (m: string) => w.registry.receipts(m).filter((r) => r.kind !== "winddown").map((r) => `${r.eventId.slice(0, 10)}:${r.status}`);
    assert.deepEqual(st(w.a.mint), ["2026-10-05:pending-pair", "2026-10-06:nothing", "2026-10-07:void", "2026-10-10:pending-pair", "2026-10-11:void"]);
    assert.deepEqual(st(w.b.mint), ["2026-10-05:nothing", "2026-10-06:pending-pair", "2026-10-07:void", "2026-10-10:nothing", "2026-10-11:void"]);
    assert.equal(w.registry.pairOutcome(w.pairId), null);
    w.program.fake(w.a.mint).registerPool();
    await runCycle(w.deps);
    assert.equal(w.registry.pairOutcome(w.pairId), null, "one pool is not enough");
    w.program.fake(w.b.mint).registerPool();
    await runCycle(w.deps); await runCycle(w.deps);
    assert.equal(w.registry.pairOutcome(w.pairId)!.state, "live");
    assert.deepEqual(st(w.a.mint), ["2026-10-05:confirmed", "2026-10-06:nothing", "2026-10-07:void", "2026-10-10:confirmed", "2026-10-11:void"]);
    assert.deepEqual(st(w.b.mint), ["2026-10-05:nothing", "2026-10-06:confirmed", "2026-10-07:void", "2026-10-10:nothing", "2026-10-11:void"]);
    const dates = w.registry.receipts(w.a.mint).filter((r) => r.status === "confirmed").map((r) => r.readingDate!);
    assert.deepEqual(dates, [...dates].sort((x, y) => x - y), "executed in settlement order");
    assert.ok(w.logs.some((l) => /LIVE — both pools registered; 3 pending-pair receipt\(s\) now planned/.test(l)), w.logs.filter((l) => l.includes("[pair]")).join("\n"));
  });

  test("one side still unregistered when voidBy ends: the pair voids — pending receipts voided, no event burn ever; the rule ends and both pools wind down (executed where a pool exists)", async () => {
    const w = await derbyWorld(SEASON, { autoRegisterPool: false, voidBy: "2026-10-08" });
    seedAll(w);
    w.program.fake(w.a.mint).registerPool();
    await runCycle(w.deps);
    const o = w.registry.pairOutcome(w.pairId)!;
    assert.equal(o.state, "voided"); assert.equal(o.at, B(9)); assert.match(o.detail!, /\$TEAMSHIB had no registered pool when 2026-10-08 ended/);
    const ra = w.registry.receipts(w.a.mint).filter((r) => r.kind !== "winddown");
    assert.ok(ra.every((r) => r.status !== "planned" && r.status !== "confirmed" && r.status !== "pending-pair"), JSON.stringify(ra.map((r) => r.status)));
    assert.equal(ra.find((r) => r.eventId.startsWith("2026-10-05"))!.status, "voided");
    assert.throws(() => w.registry.db.exec(`UPDATE burns SET status='planned' WHERE status='voided'`), /voided receipt is final/);
    // A voided pair is a no-contest and the rule has ENDED: both pools wind down from the void (10-09), 17 units of 1 % a day —
    // executed where the coin has a pool (A), waiting for one where it has none (B).
    assert.match(w.registry.ruleEnd(w.a.mint)!.reason, /pair voided/); assert.equal(w.registry.ruleEnd(w.a.mint)!.at, B(9));
    const wdA = w.registry.receipts(w.a.mint).filter((r) => r.kind === "winddown"), wdB = w.registry.receipts(w.b.mint).filter((r) => r.kind === "winddown");
    assert.deepEqual(wdA.map((r) => `${r.eventId}:${r.units}:${r.status}`), ["winddown-2026-10-09:17:confirmed", "winddown-2026-10-10:17:confirmed", "winddown-2026-10-11:17:confirmed", "winddown-2026-10-12:17:confirmed"]);
    assert.ok(wdB.length === 4 && wdB.every((r) => r.status === "planned"), "B waits for its pool");
    // The receipts page recomputes the wind-down receipts against the rule (units from onEnd, the rule's mapping).
    const p = { registry: w.registry, program: w.program, oracles: w.deps.oracles, cluster: "devnet", stubs: [] } as unknown as Parameters<typeof tokenPageData>[0];
    const dA = await tokenPageData(p, w.registry.token(w.a.mint)!, w.clock.now, { live: false });
    assert.deepEqual(dA.receipts.filter((r) => r.kind === "winddown").flatMap((r) => r.verify.checks), []);
    assert.equal(dA.status.pair!.clause!.state, "voided");
    const dB = await tokenPageData(p, w.registry.token(w.b.mint)!, w.clock.now, { live: false });
    const tally = pairTally(dA.status, dB.status, dA.receipts, dB.receipts);
    assert.equal(pairStateLine(tally), "Pair voided — both pools wind down over four weeks (no event burns; 2026-10-08 ended without both pools)");
    assert.deepEqual(lint(pairDailyText(tally, "https://burnticker.com")), []);
  });

  test("the state lines are reports, lint-clean", () => {
    const side = (ticker: string) => ({ ticker, name: ticker, mint: `${ticker}m`, burns: 0, burned: "0", supply: "1", lastBurnAt: null });
    const t = (clause: unknown) => ({ a: side("TEAMWIF"), b: side("TEAMSHIB"), clause }) as Parameters<typeof pairStateLine>[0];
    const lines = [pairStateLine(t({ voidBy: "2026-11-09", state: "live", waitingOn: [] })), pairStateLine(t({ voidBy: "2026-11-09", state: "waiting", waitingOn: ["B"] })), pairStateLine(t({ voidBy: "2026-11-09", state: "waiting", waitingOn: ["A", "B"] })), pairStateLine(t({ voidBy: "2026-11-09", state: "voided", waitingOn: [] }))];
    assert.deepEqual(lines, ["Pair live: both pools registered, every settlement burns one side", "Waiting on $TEAMSHIB's pool (both or neither: settlements wait as pending; the pair voids if 2026-11-09 ends without both)", "Waiting on both pools (both or neither: settlements wait as pending; the pair voids if 2026-11-09 ends without both)", "Pair voided — both pools wind down over four weeks (no event burns; 2026-11-09 ended without both pools)"]);
    for (const l of lines) assert.deepEqual(lint(l!), [], l!);
    assert.equal(pairStateLine(t(null)), null);
  });
});

describe("the public API (OpenAPI 1.4.0) and the creation preflight", () => {
  const DOC = buildOpenApi() as Record<string, unknown> & { paths: Record<string, Record<string, { responses: Record<string, { content: { "application/json": { schema: Record<string, unknown> } } }> }>> };
  const get = async (path: string, docPath: string, expect = 200) => {
    const res = await callRoute(`${API}${path}`);
    const body = await res.json();
    assert.equal(res.status, expect, JSON.stringify(body).slice(0, 300));
    const schema = DOC.paths[docPath].get.responses[String(res.status)].content["application/json"].schema;
    assert.deepEqual(validateSchema(schema, body, DOC), [], `${path} matches its schema`);
    return body as Record<string, unknown>;
  };

  test("GET /derby, /derby/{pair}, /derby/{bracket}, /derby/search match the document", async () => {
    const world = await makeWorld();
    world.p.derbyFetch = fixtureFetch();
    const pr = await buildPairBundles({ a: { creator: CREATOR, ticker: "TEAMWIF", name: "Team WIF", description: "d", imageUrl: null, links: [], rule: coinvsRule(SEASON), firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true }, cluster: "devnet" }, b: { ticker: "TEAMSHIB", name: "Team SHIB", description: "d", imageUrl: null, links: [] }, voidBy: "2026-11-30" }, { program: world.program, launchLab: new FakeLaunchLab(), devFeeWallet: null, attesters: [ATTESTER], quorum: 1, metadataUri: (m) => `https://x/${m}.json` });
    const reg = (b: typeof pr.a, ticker: string) => world.registry.register({ mint: b.mint, ticker, name: ticker, creator: CREATOR, description: "", imageUrl: null, links: [], rulesText: b.rules.text, feePda: b.addresses.feePda, vault: null, tokenConfig: b.addresses.tokenConfig, poolId: null, launchTx: null, cluster: "devnet", platformId: null, baselineAt: "2026-10-04T00:00:00Z", status: "draft" });
    const ta = reg(pr.a, "TEAMWIF"), tb = reg(pr.b, "TEAMSHIB");
    world.registry.registerPair(pr.pairId, ta.mint, tb.mint);
    derbyStore(world.registry.db).decide({ selectorKey: ta.selectorKey, windowId: "2026-10-05", status: "decided", eventId: "2026-10-05:00000000000000aa", at: "2026-10-05T23:59:59Z", result: "yes", value: "3", reason: "WIF wins", proofSha256: "cd".repeat(32), proof: { a: { symbol: "WIF", changePct: "5", proof: { start: { route: "hermes", url: "https://hermes.pyth.network/x", publishTime: 1, updateSha256: "ef".repeat(32) } } }, b: { symbol: "SHIB", changePct: "2" }, decision: { margin: "3", crossMargin: "3.1" } } });
    registerTournament(derbyStore(world.registry.db), T, rulesSha256);
    const list = await get("/derby", "/derby");
    assert.equal((list.pairs as unknown[]).length, 1); assert.equal((list.tournaments as { id: string }[])[0].id, "memecup-1");
    const pair = await get(`/derby/${pr.pairId}`, "/derby/{id}");
    assert.equal(pair.kind, "pair"); assert.equal((pair.pair as { days: unknown[] }).days.length, 1);
    const br = await get("/derby/memecup-1", "/derby/{id}");
    assert.equal(br.kind, "tournament"); assert.equal((br.tournament as { rounds: unknown[] }).rounds.length, 3);
    await get("/derby/nope", "/derby/{id}", 404);
    const s = await get("/derby/search?q=wif", "/derby/search");
    const hit = (s.hits as { symbol: string; source: string; underlying: DerbyUnderlying | null }[]).find((h) => h.symbol === "WIF" && h.source === "pyth")!;
    assert.deepEqual(hit.underlying, { symbol: "WIF", pyth: WIF.pyth, mint: WIF_MINT, pool: null, cross: `jup:${WIF_MINT}` });
    await get("/derby/search?q=w", "/derby/search", 400);
  });

  test("the preflight: WIF vs SHIB passes (Pyth on Solana / Hermes, Jupiter / RedStone agree), a GIGA pair passes (pool TWAP + Jupiter), a disagreement is refused", async () => {
    const now = Date.UTC(2026, 9, 10, 22, 20);
    const r = await preflightSelector(coinvsRule(SEASON), { now, derby: { pools: fixturePort(), fetchImpl: fixtureFetch(), hermes: fixtureHermes } });
    assert.equal(r.ok, true, JSON.stringify(r.refusal)); assert.equal(r.agreement, true); assert.equal(r.primary.operator, "Pyth Data Association"); assert.equal(r.crossRead!.operator, "Jupiter");
    assert.match(r.agreementBasis, /WIF: .* · SHIB: /);
    // GIGA: spot 0.0002 SOL × Pyth SOL/USD from the real account; Jupiter quotes the same within 1%.
    const sol = fjson("derby/pyth.solana.accounts.json").accounts.SOL;
    const solUsd = Number(pythSnapshotFromAccount(sol.feed, { owner: sol.owner, data: Buffer.from(sol.dataBase64, "base64") }, null, pythFeedAccount(sol.feed)).value);
    const port = fixturePort(cpmmAccounts({ pool: GIGA_POOL, mint: GIGA_MINT, tokenRaw: BigInt(5_000_000) * BigInt(10) ** BigInt(5), solRaw: BigInt(1000) * BigInt(10) ** BigInt(9), decimals: 5 }));
    const gigaFetch = (usd: number) => fixtureFetch({ "https://lite-api.jup.ag/price/v3": { ...fjson("derby/jupiter.price.v3.json").body, [GIGA_MINT]: { usdPrice: usd, liquidity: 900_000 } } });
    const giga = coinvsRule({ ...SEASON, a: GIGA, b: WIF });
    const ok = await preflightSelector(giga, { now, derby: { pools: port, fetchImpl: gigaFetch(0.0002 * solUsd * 1.005), hermes: null } });
    assert.equal(ok.ok, true, JSON.stringify(ok.refusal)); assert.equal(ok.primary.operator, "Raydium pool (on-chain)");
    const bad = await preflightSelector(giga, { now, derby: { pools: port, fetchImpl: gigaFetch(0.0002 * solUsd * 1.2), hermes: null } });
    assert.equal(bad.ok, false); assert.equal(bad.refusal!.code, "disagreement");
    // No read port and no Hermes key: SHIB cannot be read → refused (502), never guessed.
    const none = await preflightSelector(coinvsRule(SEASON), { now, derby: { pools: null, fetchImpl: fixtureFetch(), hermes: null } });
    assert.equal(none.refusal!.code, "primary-unreadable");
  });

  test("the launch pipeline runs the derby preflight under strict mode (the gate applies to derby pairs)", async () => {
    const world = await makeWorld();
    world.p.derbyFetch = fixtureFetch();
    const start = nextUtcMidnight(Date.now());
    const spec: CoinVsSpec = { ...SEASON, season: { start, days: 30 } };
    const body = { creator: CREATOR, ticker: "TEAMWIF", name: "Team WIF", description: "", imageUrl: null, links: [], rule: lockRule({ ...coinvsRule(spec), series: derbySeriesId(spec, rulesSha256) }).rule, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true }, pair: { ticker: "TEAMSHIB", name: "Team SHIB", description: "", imageUrl: null, links: [] } };
    const now = Date.UTC(2026, 9, 10, 22, 20);
    const okR = await prepareLaunch(world.p, body, { register: false, preflight: { strict: true, deps: { now, derby: { pools: fixturePort(), fetchImpl: fixtureFetch(), hermes: fixtureHermes } } } });
    assert.ok("pair" in okR, JSON.stringify("error" in okR ? okR.error.body : okR).slice(0, 300));
    const badR = await prepareLaunch(world.p, body, { register: false, preflight: { strict: true, deps: { now, derby: { pools: null, fetchImpl: fixtureFetch(), hermes: null } } } });
    assert.ok("error" in badR && badR.error.status === 502 && /preflight refused/.test(JSON.stringify(badR.error.body)));
  });
});

void B; void GIGA;
