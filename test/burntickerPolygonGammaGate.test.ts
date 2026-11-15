// THE GAMMA GATE (2026-10-27). The keeper's public-Polygon share (600 requests a day) was spent by about 03:42 UTC every day from 10-24,
// and the reader then sat on hold until midnight. A one-market Polymarket coin's payout vector is now read on Polygon only when there is
// a reason: Gamma reports the market closed or resolved, its end date has passed, or the condition was last read from the RPC more than
// POLYGON_LIVENESS_MS (24 hours) ago, which is the daily liveness read that stops a Gamma outage from hiding a resolution. Gamma never
// settles anything: the reading stays pending until the payout vector is on chain. Every count below is an RPC request on the fakes.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { POLYGON_LIVENESS_MS, POLY_PRECLOSE_CHECK_MS, PolymarketClient, gammaSaysResolved, marketByConditionUrl, parseGammaMarket } from "@/lib/burnticker/oracle/polymarket";
import { memoryPayoutStore, PAYOUT_CHECKED_PREFIX, PAYOUT_STATUS_PREFIX } from "@/lib/burnticker/oracle/payoutStore";
import { polygonRpcUrlsFromEnv, SEL_OUTCOME_SLOT_COUNT, SEL_PAYOUT_DENOMINATOR, SEL_PAYOUT_NUMERATORS, type FetchLike as RpcFetchLike } from "@/lib/burnKeeper/attesters/polymarketOnchain";
import type { FetchLike } from "@/lib/burnticker/oracle/types";
import { BURNTICKER_RULES_SCHEMA, type BurnRule } from "@/lib/burnticker/rules";

const CID = `0x${"ab".repeat(32)}`;
const NOW = Date.parse("2026-10-27T12:00:00Z");
const H = 3_600_000;
const RULE = { schema: BURNTICKER_RULES_SCHEMA, oracle: "polymarket", series: null, market: CID, filter: {}, kind: "binary", scalar: null, onVoid: "skip", floorUsd: "1", reserveSol: "0.02", vault: null, binary: { onYes: { fractionOfPool: 0.05 }, onNo: null } } as unknown as BurnRule;

/** What Gamma says about the market right now (mutable per test), and whether Gamma answers at all. */
interface GammaState { closed: boolean; endDate: string; closedTime?: string | null; uma?: string | null; umaHistory?: string[]; down?: boolean }
/** What the chain holds: no report yet, or YES (slot 0) paid. */
interface ChainState { resolved: boolean; held?: boolean }

function world(o: { gamma: GammaState; chain?: ChainState; store?: ReturnType<typeof memoryPayoutStore>; clock?: { now: number } }) {
  const clock = o.clock ?? { now: NOW };
  const gamma = o.gamma, chain = o.chain ?? { resolved: false };
  const gammaCalls: string[] = [], rpcCalls: string[] = [];
  const market = () => ({ conditionId: CID, question: "Will the bill be signed into law in 2026?", outcomes: '["Yes","No"]', closed: gamma.closed, active: !gamma.closed, endDate: gamma.endDate,
    closedTime: gamma.closedTime ?? null, umaResolutionStatus: gamma.uma ?? null, umaResolutionStatuses: JSON.stringify(gamma.umaHistory ?? []), outcomePrices: gamma.closed ? '["1","0"]' : '["0.04","0.96"]' });
  const fetchImpl: FetchLike = async (url: string) => {
    gammaCalls.push(url);
    if (gamma.down) return { ok: false, status: 503, json: async () => ({}) };
    const listed = url === marketByConditionUrl(CID, gamma.closed);
    return { ok: true, status: 200, json: async () => (listed ? [market()] : []) };
  };
  const word = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
  const rpcFetch: RpcFetchLike = async (url, init) => {
    rpcCalls.push(url);
    if (chain.held) throw new Error("Polygon public RPC: today's request budget is spent (600 of 600); reads wait until midnight UTC");
    const req = JSON.parse(init?.body ?? "{}") as { method: string; params: { data?: string }[] };
    let result: string;
    if (req.method === "eth_blockNumber") result = word(78_000_000);
    else {
      const data = req.params[0].data ?? "";
      if (data.startsWith(SEL_OUTCOME_SLOT_COUNT)) result = word(2);
      else if (data.startsWith(SEL_PAYOUT_DENOMINATOR)) result = word(chain.resolved ? 1 : 0);
      else if (data.startsWith(SEL_PAYOUT_NUMERATORS)) result = word(chain.resolved && data.endsWith("0".repeat(64)) ? 1 : 0);
      else throw new Error("unexpected call");
    }
    return { ok: true, status: 200, json: async () => ({ jsonrpc: "2.0", id: 1, result }) };
  };
  const store = o.store ?? memoryPayoutStore("keeper");
  const c = new PolymarketClient({ fetchImpl, rpcFetch, rpcUrls: ["https://polygon-rpc.test"], now: () => clock.now, minIntervalMs: 0, ttlMs: 0, payoutStore: store });
  return { c, clock, gamma, chain, store, gammaCalls, rpcCalls };
}
/** One payout read is 5 requests: the slot count, the denominator, two numerators and the block number. */
const READ = 5;
const FAR = "2027-01-01T05:00:00Z";

describe("the Gamma gate: Polygon is read only when there is a reason", () => {
  test("Gamma reports the market open and its end date months ahead: one liveness read, then no Polygon read for 24 hourly cycles, then one more", async () => {
    const w = world({ gamma: { closed: false, endDate: FAR } });
    const first = await w.c.settledSince(RULE, null);
    assert.equal(w.rpcCalls.length, READ, "the first read ever is the liveness read");
    assert.deepEqual([first.events.length, first.awaitingFinal], [0, 0], "pending, nothing settled");
    assert.ok(first.dueAt && first.dueAt <= NOW + POLY_PRECLOSE_CHECK_MS, "Gamma is asked again within the hour");
    for (let h = 1; h < 24; h++) { w.clock.now = NOW + h * H; const r = await w.c.settledSince(RULE, null); assert.equal(r.events.length, 0); }
    assert.equal(w.rpcCalls.length, READ, "23 hourly cycles inside the window: Gamma only, no Polygon read");
    assert.ok(w.gammaCalls.length >= 24, "Gamma was read every cycle");
    w.clock.now = NOW + POLYGON_LIVENESS_MS;
    await w.c.settledSince(RULE, null);
    assert.equal(w.rpcCalls.length, 2 * READ, "24 hours after the last check: one more liveness read");
  });

  test("the last check survives a restart (the store keeps its time), so a new keeper does not read again inside the window", async () => {
    const store = memoryPayoutStore("keeper");
    const a = world({ gamma: { closed: false, endDate: FAR }, store });
    await a.c.settledSince(RULE, null);
    assert.ok(store.rows.has(PAYOUT_CHECKED_PREFIX + CID), "the check time is stored");
    assert.ok(![...store.rows.keys()].some((k) => k.startsWith(PAYOUT_STATUS_PREFIX)), "an unresolved answer is never stored");
    const b = world({ gamma: { closed: false, endDate: FAR }, store, clock: { now: NOW + 5 * H } });
    await b.c.settledSince(RULE, null);
    assert.equal(b.rpcCalls.length, 0, "restarted 5 hours later: no Polygon read");
    const c = world({ gamma: { closed: false, endDate: FAR }, store, clock: { now: NOW + 25 * H } });
    await c.c.settledSince(RULE, null);
    assert.equal(c.rpcCalls.length, READ, "restarted 25 hours later: the stale check is read again");
  });

  test("Gamma reports the market closed and resolved: Polygon is read, and the reading comes from the payout vector", async () => {
    const w = world({ gamma: { closed: true, endDate: FAR, closedTime: "2026-10-27T11:00:00Z", uma: "resolved" }, chain: { resolved: true } });
    const r = await w.c.settledSince(RULE, null);
    assert.equal(w.rpcCalls.length, READ);
    assert.equal(r.events.length, 1);
    assert.equal(r.events[0].result, "yes");
    assert.match(r.events[0].proof ?? "", /^polygon:137\/ctf:.*\/payouts:1,0\//, "the proof is the on-chain payout");
    await w.c.settledSince(RULE, null);
    assert.equal(w.rpcCalls.length, READ, "a reported vector is stored and never read again");
  });

  test("Gamma says resolved but the payout vector is not on chain yet: pending, read again next cycle; Gamma alone never settles", async () => {
    const w = world({ gamma: { closed: true, endDate: FAR, closedTime: "2026-10-27T11:00:00Z", uma: "resolved" }, chain: { resolved: false } });
    const r = await w.c.settledSince(RULE, null);
    assert.deepEqual([r.events.length, r.awaitingFinal, w.rpcCalls.length], [0, 1, READ]);
    w.clock.now += 5 * 60_000;
    await w.c.settledSince(RULE, null);
    assert.equal(w.rpcCalls.length, 2 * READ, "every cycle until the vector is on chain, as before");
  });

  test("UMA's status says resolved while Gamma's closed flag lags: that is a reason to read too", async () => {
    assert.equal(gammaSaysResolved(parseGammaMarket({ conditionId: CID, question: "q", closed: false, umaResolutionStatus: "resolved" })!), true);
    assert.equal(gammaSaysResolved(parseGammaMarket({ conditionId: CID, question: "q", closed: false, umaResolutionStatuses: '["proposed","resolved"]' })!), true);
    assert.equal(gammaSaysResolved(parseGammaMarket({ conditionId: CID, question: "q", closed: false, umaResolutionStatus: "proposed" })!), false);
    const w = world({ gamma: { closed: false, endDate: FAR, uma: "resolved" } });
    w.store.noteChecked!(CID, NOW - H);   // checked an hour ago: the liveness read is not due
    await w.c.settledSince(RULE, null);
    assert.equal(w.rpcCalls.length, READ);
  });

  test("the end date has passed and Gamma has not closed the market: read, at most hourly", async () => {
    const w = world({ gamma: { closed: false, endDate: "2026-10-27T06:00:00Z" } });
    w.store.noteChecked!(CID, NOW - H);
    await w.c.settledSince(RULE, null);
    assert.equal(w.rpcCalls.length, READ, "past its end: read");
    w.clock.now += 10 * 60_000;
    await w.c.settledSince(RULE, null);
    assert.equal(w.rpcCalls.length, READ, "ten minutes later: not again");
    w.clock.now += H;
    await w.c.settledSince(RULE, null);
    assert.equal(w.rpcCalls.length, 2 * READ, "an hour later: again");
  });

  test("the liveness read finds a payout while Gamma still lists the market open: stored, pending, then settled on Gamma's close with no further Polygon read", async () => {
    const w = world({ gamma: { closed: false, endDate: FAR }, chain: { resolved: true } });
    const r = await w.c.settledSince(RULE, null);
    assert.deepEqual([r.events.length, r.awaitingFinal], [0, 1], "never dated in the future, never settled on Gamma's word");
    assert.ok(r.refusals.some((x) => /waits for Gamma's close time/.test(x)));
    assert.ok(w.store.rows.has(PAYOUT_STATUS_PREFIX + CID), "the vector is on record");
    w.gamma.closed = true; w.gamma.closedTime = "2026-10-27T12:30:00Z"; w.gamma.uma = "resolved";
    w.clock.now += H;
    const s = await w.c.settledSince(RULE, null);
    assert.equal(s.events.length, 1);
    assert.equal(s.events[0].at, "2026-10-27T12:30:00Z");
    assert.equal(w.rpcCalls.length, READ, "the stored vector settles it");
  });

  test("Gamma is down: the cycle still fails (the keeper backs off), and the daily liveness read still happens, once a day", async () => {
    const w = world({ gamma: { closed: false, endDate: FAR, down: true }, chain: { resolved: true } });
    await assert.rejects(w.c.settledSince(RULE, null), /HTTP 503/);
    assert.equal(w.rpcCalls.length, READ, "the liveness read ran during the outage");
    assert.ok(w.store.rows.has(PAYOUT_STATUS_PREFIX + CID), "a resolution during the outage is on record");
    w.clock.now += 2 * H;
    await assert.rejects(w.c.settledSince(RULE, null), /HTTP 503/);
    assert.equal(w.rpcCalls.length, READ, "not again inside the day");
  });

  test("the budget is on hold: the liveness read is skipped without failing the cycle; a due read still fails it as before", async () => {
    const w = world({ gamma: { closed: false, endDate: FAR }, chain: { resolved: false, held: true } });
    const r = await w.c.settledSince(RULE, null);
    assert.deepEqual([r.events.length, r.awaitingFinal], [0, 0]);
    assert.ok(r.refusals.some((x) => /chain read failed/.test(x)));
    const v = world({ gamma: { closed: true, endDate: FAR, closedTime: "2026-10-27T11:00:00Z", uma: "resolved" }, chain: { resolved: false, held: true } });
    await assert.rejects(v.c.settledSince(RULE, null), /every on-chain read failed/);
  });
});

describe("BURNTICKER_POLYGON_RPC_URLS: an entry that is not an https URL is skipped with a plain warning", () => {
  test("a placeholder first: one warning, the value is not printed beyond four characters, the real URLs are kept in order", () => {
    const warnings: string[] = [];
    const secret = "YOUR_ALCHEMY_POLYGON_URL_WITH_KEY_abc123";
    const urls = polygonRpcUrlsFromEnv(` ${secret} , https://polygon-bor.publicnode.com,https://1rpc.io/matic`, (l) => warnings.push(l));
    assert.deepEqual(urls, ["https://polygon-bor.publicnode.com", "https://1rpc.io/matic"]);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /entry 1 of 3 is not an https URL/);
    assert.match(warnings[0], /starts "YOUR…"/);
    assert.ok(!warnings[0].includes(secret.slice(0, 5)), "no more than four characters of the value");
    assert.match(warnings[0], /The other entries are used\./);
  });
  test("an http URL, a bare host and an empty list", () => {
    const warnings: string[] = [];
    assert.deepEqual(polygonRpcUrlsFromEnv("http://polygon-rpc.com,polygon-rpc.com", (l) => warnings.push(l)), []);
    assert.equal(warnings.length, 2);
    assert.match(warnings[1], /No entry is left, so the public Polygon RPCs are used\./);
    const none: string[] = [];
    assert.deepEqual(polygonRpcUrlsFromEnv(undefined, (l) => none.push(l)), []);
    assert.deepEqual(polygonRpcUrlsFromEnv("https://polygon-mainnet.g.alchemy.com/v2/k", (l) => none.push(l)), ["https://polygon-mainnet.g.alchemy.com/v2/k"]);
    assert.equal(none.length, 0, "no warning when every entry is an https URL");
  });
});
