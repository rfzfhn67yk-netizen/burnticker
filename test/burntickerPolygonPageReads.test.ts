// NO POLYGON READ ON A PAGE BUILD (owner 2026-10-19: at 09:19 Denver the web's daily Polygon share went from 190 to 600 in about twelve
// minutes and was held until 00:00 UTC). A reported Conditional Tokens payout vector is immutable, so the first read by any role is stored
// in the registry's status table (oracle/payoutStore.ts) and every later read is served from it; an unresolved vector is kept in memory
// for five minutes per condition; a page build never waits on the chain (PolymarketClient.peekOrSchedule: "not read yet" now, one
// background read at most per condition per five minutes); the launch check may read live, says plainly when the budget is on hold, and
// reads only the newest few settled markets of a series. Every count below is a budget take on the Polygon source, on the fakes.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { CREATOR, ATTESTER, makeWorld, type World } from "./burntickerApiHelpers.ts";
import { BUCS_CID, CHAIN, EAGLES_CID, GAMMA_TABLE, PM_BUCS, PM_NFL_MONEYLINE, PM_NOW } from "./burntickerPolyHelpers.ts";
import { CHAIN_UNRESOLVED_TTL_MS, PolymarketClient, gammaFixtureFetch, rpcFixtureFetch, proofOf } from "@/lib/burnticker/oracle/polymarket";
import { memoryPayoutStore, PAYOUT_STATUS_PREFIX, rowToStored, statusPayoutStore } from "@/lib/burnticker/oracle/payoutStore";
import { apiBudget, configureApiBudget, memoryStore, resetApiBudget, sourceForUrl } from "@/lib/burnticker/apiBudget";
import { buildLaunchBundle, FakeLaunchLab } from "@/lib/burnticker/launchBundle";
import { tokenPageData } from "@/lib/burnticker/server";
import { creatorData } from "@/lib/burnticker/creatorServe";
import { runBacktest } from "@/lib/burnticker/api/handlers";
import { setNativeClients, nativeRule } from "@/lib/burnticker/sources/native";
import { gameSeries, type EspnClient, type Game } from "@/lib/burnticker/sources/espn";
import { polymarketGameReaders, type GameMarket } from "@/lib/burnticker/sources/gameSettle";
import { preflightSelector, PREFLIGHT_CHAIN_READS, POLYGON_HOLD_REASON } from "@/lib/burnticker/coverage/preflight";
import { validateRule, type BurnRule } from "@/lib/burnticker/rules";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import type { TokenRow } from "@/lib/burnticker/registry";
import type { FetchLike as RpcFetchLike } from "@/lib/burnKeeper/attesters/polymarketOnchain";

const RPC = "https://polygon-rpc.test";
const SRC = sourceForUrl(RPC);
const FIX = JSON.parse(fs.readFileSync(new URL("./fixtures/burnticker-gameclock/sea-den-2026-10-15.json", import.meta.url), "utf8")) as { game: Game; tsdbRow: Record<string, string>; market: GameMarket };
const G = FIX.game;
const tick = () => new Promise((r) => setTimeout(r, 25));

/** A Polymarket client over the frozen Gamma and Polygon answers, on a movable clock, counting every RPC call it sends. */
function countingClient(o: { store?: ReturnType<typeof memoryPayoutStore> | null; clock: { now: number }; rpc?: Parameters<typeof rpcFixtureFetch>[0] | "held" }) {
  const calls: string[] = [];
  const inner = o.rpc === "held" ? null : rpcFixtureFetch(o.rpc ?? CHAIN);
  const rpcFetch: RpcFetchLike = async (url, init) => {
    calls.push(url);
    if (!inner) throw new Error("Polygon public RPC: today's request budget is spent (600 of 600); reads wait until midnight UTC");
    return inner(url, init);
  };
  const c = new PolymarketClient({ fetchImpl: gammaFixtureFetch(GAMMA_TABLE), rpcFetch, rpcUrls: [RPC], now: () => o.clock.now, minIntervalMs: 0, pageSize: 50, payoutStore: o.store ?? null });
  return { c, calls };
}

describe("the payout store: a reported vector is read from Polygon once, by any role, ever", () => {
  test("a reported vector is stored the first time it is read (block and proof kept); a second client on the same store never reads it", async () => {
    const clock = { now: PM_NOW }, store = memoryPayoutStore("keeper");
    const a = countingClient({ store, clock });
    const r = await a.c.readChain(BUCS_CID);
    assert.equal(r.resolved, true);
    assert.equal(a.c.chainReads.length, 1);
    const row = rowToStored(store.rows.get(PAYOUT_STATUS_PREFIX + BUCS_CID)!, BUCS_CID)!;
    assert.deepEqual([row.r.payoutNumerators, row.r.blockNumber !== null, row.proof, row.role], [r.payoutNumerators, true, proofOf(r), "keeper"]);
    // another process (the site) on the same registry: served from the row, after any restart
    const b = countingClient({ store, clock });
    for (let i = 0; i < 10; i++) assert.equal((await b.c.readChain(BUCS_CID)).outcome, r.outcome);
    assert.equal(b.calls.length, 0, "no RPC call for a stored vector");
    assert.equal(b.c.peekChain(BUCS_CID)?.outcome, r.outcome);
  });

  test("an unresolved vector is never stored, is kept in memory five minutes, and concurrent reads share one RPC read", async () => {
    const clock = { now: PM_NOW }, store = memoryPayoutStore();
    const a = countingClient({ store, clock });
    const [x, y] = await Promise.all([a.c.readChain(EAGLES_CID), a.c.readChain(EAGLES_CID)]);
    assert.deepEqual([x.resolved, y.resolved, a.c.chainReads.length], [false, false, 1], "one read for two callers");
    assert.equal(store.rows.size, 0, "an unresolved vector can still change: not stored");
    await a.c.readChain(EAGLES_CID);
    clock.now += CHAIN_UNRESOLVED_TTL_MS - 1;
    await a.c.readChain(EAGLES_CID);
    assert.equal(a.c.chainReads.length, 1, "kept for five minutes");
    clock.now += 2;
    await a.c.readChain(EAGLES_CID);
    assert.equal(a.c.chainReads.length, 2, "read again after five minutes");
  });

  test("the status-table store refuses a row that does not decode to a reported vector, and never overwrites the first reported read", () => {
    const rows = new Map<string, string>();
    const s = statusPayoutStore({ getStatus: (k) => rows.get(k) ?? null, setStatus: (k, v) => { rows.set(k, typeof v === "string" ? v : JSON.stringify(v)); } }, "web");
    rows.set(PAYOUT_STATUS_PREFIX + BUCS_CID, JSON.stringify({ conditionId: BUCS_CID, outcomeSlotCount: 2, payoutDenominator: "0", payoutNumerators: ["0", "0"] }));
    assert.equal(s.get(BUCS_CID), null, "an unresolved row is not a stored vector");
    rows.set(PAYOUT_STATUS_PREFIX + BUCS_CID, JSON.stringify({ conditionId: BUCS_CID, outcomeSlotCount: 2, payoutDenominator: "1", payoutNumerators: ["1", "1"] }));
    assert.equal(s.get(BUCS_CID), null, "numerators that do not sum to the denominator are refused");
    rows.clear();
    const base = { conditionId: BUCS_CID, chainId: 137, contract: "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045", rpcUrl: RPC, blockNumber: 1, outcomeSlotCount: 2, payoutDenominator: "1", payoutNumerators: ["1", "0"], resolved: true, payouts: ["1", "0"], outcome: 0 };
    s.put(base, { readAt: 1, proof: "first" });
    s.put({ ...base, payoutNumerators: ["0", "1"], outcome: 1 }, { readAt: 2, proof: "second" });
    assert.deepEqual([s.get(BUCS_CID)!.r.outcome, s.get(BUCS_CID)!.proof], [0, "first"]);
  });
});

describe("page builds on the site: zero Polygon reads once the vector is stored, at most one per condition per five minutes before", () => {
  let w: World, client: ReturnType<typeof countingClient>, bucs: TokenRow, den: TokenRow;
  const clock = { now: PM_NOW };
  const realFetch = globalThis.fetch;
  const used = () => apiBudget().used(SRC);

  before(async () => {
    w = await makeWorld();
    resetApiBudget();
    configureApiBudget({ role: "web", store: memoryStore(), enforce: false, log: () => {} });
    client = countingClient({ store: memoryPayoutStore("web"), clock });
    w.p.polymarket = client.c; w.p.oracles.polymarket = client.c;
    const launch = async (rule: unknown, ticker: string) => {
      const b = await buildLaunchBundle({ creator: CREATOR, ticker, name: `${ticker} coin`, description: "a test", imageUrl: null, links: [], rule, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true }, cluster: "devnet" }, { program: w.program, launchLab: new FakeLaunchLab(), devFeeWallet: null, attesters: [ATTESTER], quorum: 1, metadataUri: (m) => `https://x/${m}.json` });
      const t = w.registry.register({ mint: b.mint, ticker, name: b.name, creator: CREATOR, description: b.description, imageUrl: null, links: [], rulesText: b.rules.text, feePda: b.addresses.feePda, vault: b.addresses.vault, tokenConfig: b.addresses.tokenConfig, poolId: b.addresses.poolId, launchTx: null, cluster: "devnet", platformId: b.addresses.platformId, baselineAt: "2026-10-01T00:00:00Z", status: "draft" }, PM_NOW);
      w.registry.markLaunched(t.mint, `launch${ticker}`, b.addresses.poolId, "2026-10-01T00:00:00Z");
      w.program.supplies.set(t.mint, BigInt("1000000000000000"));
      return w.registry.token(t.mint)!;
    };
    bucs = await launch(PM_BUCS, "BUCSPAGE");
    den = await launch(nativeRule(gameSeries("nfl", G.eventId, "DEN", "win")), "DENPAGE");
    // the game's readers as the site registers them (server.ts): its market resolves on the BUCS condition, its payout never blocks
    const espn = { tsdbRead: async () => ({ events: [] }), get: async () => { throw new Error("HTTP 404"); }, season: async () => [G], upcoming: async () => [] } as unknown as EspnClient;
    const readers = polymarketGameReaders(client.c, { nonBlocking: true });
    setNativeClients({ espn, games: { tsdbKey: null, apiSportsKey: null, market: async () => ({ ...FIX.market, conditionId: BUCS_CID }), payout: readers.payout } });
    globalThis.fetch = (async () => new Response(JSON.stringify({}), { status: 404 })) as typeof fetch;
  });
  after(() => { globalThis.fetch = realFetch; setNativeClients({ espn: null, games: null }); resetApiBudget(); });

  const buildAll = async () => {
    const { GET } = await import("@/app/api/burnticker/tokens/route");
    assert.equal((await GET()).status, 200);
    const c = await creatorData(CREATOR, clock.now, w.p, { memo: null });
    assert.notEqual(c.kind, "bad-wallet");
    for (const t of [bucs, den]) await tokenPageData(w.p, t, clock.now);
  };

  test("the token index, the creator page and the coin pages (a Polymarket coin, a game coin), ten builds each: no Polygon read at all", async () => {
    const u0 = used(), c0 = client.calls.length;
    for (let i = 0; i < 10; i++) await buildAll();
    assert.deepEqual([client.calls.length - c0, used() - u0, client.c.chainReads.length], [0, 0, 0], "a page build never reads the payout vector");
  });

  test("a page path that does show a game's payout (the game coin's back-test, ten builds): one background read, never awaited, then the stored vector", async () => {
    const rule = validateRule(nativeRule(gameSeries("nfl", G.eventId, "DEN", "win"))) as BurnRule;
    const u0 = used();
    for (let i = 0; i < 10; i++) {
      const r = await runBacktest(w.p, { rule, months: 1 }, clock.now);
      assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 300));
    }
    assert.equal(client.c.chainReads.length, 1, "at most one read per condition per five minutes before the vector is stored");
    await tick();
    const perRead = used() - u0;
    assert.ok(perRead > 0 && perRead <= 6, `one payout read is a handful of eth_calls (${perRead})`);
    // stored now: ten more back-tests, ten more of every page, an hour later: nothing
    clock.now += 3_600_000;
    const u1 = used(), c1 = client.calls.length;
    for (let i = 0; i < 10; i++) { await runBacktest(w.p, { rule, months: 1 }, clock.now); await buildAll(); }
    assert.deepEqual([client.calls.length - c1, used() - u1, client.c.chainReads.length], [0, 0, 1], "served from the store");
    console.log(`  [polygon] page builds: 0 reads before and after; the back-test: 1 read (${perRead} budget takes) for 10 builds, then 0`);
  });

  test("an unresolved condition on a page build: at most one background read per five minutes, and the page never waits", async () => {
    const before = client.c.chainReads.length;
    for (let i = 0; i < 10; i++) assert.equal(client.c.peekOrSchedule(EAGLES_CID), null, "not read yet");
    await tick();
    assert.equal(client.c.chainReads.length - before, 1);
    for (let i = 0; i < 10; i++) assert.equal(client.c.peekOrSchedule(EAGLES_CID)?.resolved, false, "the unresolved vector, held in memory");
    clock.now += CHAIN_UNRESOLVED_TTL_MS + 1;
    for (let i = 0; i < 10; i++) client.c.peekOrSchedule(EAGLES_CID);
    await tick();
    assert.equal(client.c.chainReads.length - before, 2, "one more after five minutes");
  });
});

describe("the launch check (a creator action: may read live)", () => {
  test("says plainly when today's Polygon requests are used up, and the sentence passes the copy lint", async () => {
    const held = countingClient({ clock: { now: PM_NOW }, rpc: "held" });
    const r = await preflightSelector(validateRule(PM_BUCS), { polymarket: held.c, now: PM_NOW });
    assert.equal(r.ok, false);
    assert.equal(r.refusal?.reason, POLYGON_HOLD_REASON);
    assert.equal(lintCopy(POLYGON_HOLD_REASON, loadCopyLintConfig()).ok, true, JSON.stringify(lintCopy(POLYGON_HOLD_REASON, loadCopyLintConfig()).hits));
  });

  test("a series is proven on its newest settled markets only, not a backlog of up to forty", async () => {
    const c = countingClient({ clock: { now: PM_NOW } });
    const r = await preflightSelector(validateRule(PM_NFL_MONEYLINE), { polymarket: c.c, now: PM_NOW });
    assert.ok(c.c.chainReads.length >= 1 && c.c.chainReads.length <= PREFLIGHT_CHAIN_READS, `${c.c.chainReads.length} chain reads`);
    assert.ok(r.primary.lastReading, JSON.stringify(r.refusal));
  });
});
