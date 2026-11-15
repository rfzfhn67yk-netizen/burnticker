// HS-119 (ninth audit addendum): the Polymarket search keeps its last good answer per query and serves it, marked stale, when Gamma fails.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { polymarketSearch } from "@/lib/burnticker/api/handlers";
import { edgeStatus } from "@/lib/burnticker/api/http";
import type { Platform } from "@/lib/burnticker/server";
import { SEARCH_MEMO_INDEX_KEY, SEARCH_MEMO_MAX_AGE_MS, SEARCH_MEMO_ROW_PREFIX, searchMemoKey, searchMemoStore, withSearchMemo } from "@/lib/burnticker/searchMemo";

const statusTable = () => {
  const rows = new Map<string, string>();
  return { rows, getStatus: (k: string) => rows.get(k) ?? null, setStatus: (k: string, v: unknown) => { rows.set(k, typeof v === "string" ? v : JSON.stringify(v)); }, deleteStatus: (k: string) => { rows.delete(k); } };
};
const hit = (cid: string) => ({ events: [], tags: [], markets: [{ conditionId: cid, question: "Will it?", yes: "Yes", no: "No", endDate: null, closed: false, sportsMarketType: null, selector: { oracle: "polymarket", market: cid } }] });
const platformWith = (reg: ReturnType<typeof statusTable>, search: () => Promise<unknown>) => ({ registry: reg, polymarket: { search } }) as unknown as Platform;

describe("HS-119: the Polymarket search's last good answer", () => {
  test("a fresh answer is stored, in memory and in the registry's status table; it goes out marked fresh", async () => {
    const reg = statusTable();
    const r = await polymarketSearch(platformWith(reg, async () => hit("0xaaa")), { q: "Election " });
    assert.equal(r.status, 200);
    assert.equal((r.body as { stale?: boolean }).stale, undefined);
    assert.equal(r.headers?.["x-search-memo"], "fresh");
    const key = searchMemoKey("election", "open");
    assert.equal(searchMemoKey("  ELECTION  ", "open"), key, "the query is normalised");
    assert.notEqual(searchMemoKey("election", "closed"), key, "the status is part of the key");
    assert.deepEqual(JSON.parse(reg.rows.get(SEARCH_MEMO_INDEX_KEY)!).map((e: [string, number]) => e[0]), [key]);
    assert.equal(JSON.parse(reg.rows.get(SEARCH_MEMO_ROW_PREFIX + key)!).body.markets[0].conditionId, "0xaaa");
  });

  test("an upstream 404 serves the held answer with x-search-memo: stale and stale: true; a restart reads it from the registry", async () => {
    const reg = statusTable();
    await polymarketSearch(platformWith(reg, async () => hit("0xbbb")), { q: "senate" });
    const down = async () => { throw new Error("Gamma HTTP 404"); };
    const r = await polymarketSearch(platformWith(reg, down), { q: "Senate" });
    assert.equal(r.status, 200);
    const b = r.body as { stale?: boolean; staleAgeSec?: number; staleNote?: string; markets: { conditionId: string }[] };
    assert.equal(b.stale, true); assert.equal(typeof b.staleAgeSec, "number"); assert.match(b.staleNote!, /last answer we had/);
    assert.equal(b.markets[0].conditionId, "0xbbb");
    assert.equal(r.headers?.["x-search-memo"], "stale"); assert.equal(r.headers?.["cache-control"], "no-store");
    // a new process: only the registry row is left
    const store = searchMemoStore(reg);
    const s = await withSearchMemo(store, searchMemoKey("senate", "open"), down, { deadlineMs: 50 });
    assert.equal(s.stale, true); assert.equal((s.body as ReturnType<typeof hit>).markets[0].conditionId, "0xbbb");
  });

  test("with nothing held, an upstream failure is the error (502, sent as 503 at the edge)", async () => {
    const r = await polymarketSearch(platformWith(statusTable(), async () => { throw new Error("Gamma HTTP 404"); }), { q: "nothing held" });
    assert.equal(r.status, 502); assert.equal(edgeStatus(r.status), 503);
    assert.match((r.body as { error: string }).error, /Polymarket could not be reached just now/);
  });

  test("a read that hangs past the deadline serves the held copy; with nothing held the read is waited for", async () => {
    const store = searchMemoStore<string>(null);
    store.save("k", { at: Date.now() - 5_000, body: "old" });
    const hang = () => new Promise<string>(() => { /* never answers */ });
    const s = await withSearchMemo(store, "k", hang, { deadlineMs: 20 });
    assert.deepEqual([s.body, s.stale], ["old", true]); assert.ok(s.ageMs >= 5_000);
    const slow = () => new Promise<string>((r) => setTimeout(() => r("new"), 40));
    const t = await withSearchMemo(store, "other", slow, { deadlineMs: 5 });
    assert.deepEqual([t.body, t.stale], ["new", false]);
  });

  test("the bound: at most maxKeys queries are kept, the oldest rows removed; a copy past 24 h is not served", async () => {
    const reg = statusTable();
    const store = searchMemoStore<string>(reg, { maxKeys: 3 });
    const t0 = 1_000_000;
    for (let i = 0; i < 5; i++) store.save(`q${i}`, { at: t0 + i, body: `b${i}` });
    assert.deepEqual(store.keys(), ["q4", "q3", "q2"]);
    assert.ok(!reg.rows.has(SEARCH_MEMO_ROW_PREFIX + "q0") && !reg.rows.has(SEARCH_MEMO_ROW_PREFIX + "q1"), "rows past the bound are removed");
    assert.equal([...reg.rows.keys()].filter((k) => k.startsWith(SEARCH_MEMO_ROW_PREFIX)).length, 3);
    const fresh = searchMemoStore<string>(reg, { maxKeys: 3 });
    assert.equal(fresh.load("q0", t0 + 10), null);
    assert.equal(fresh.load("q4", t0 + 10)?.body, "b4");
    assert.equal(fresh.load("q3", t0 + 3 + SEARCH_MEMO_MAX_AGE_MS + 1), null, "past 24 hours");
    // the default bound is 200 queries
    const big = searchMemoStore<number>(statusTable());
    for (let i = 0; i < 230; i++) big.save(`k${i}`, { at: t0 + i, body: i });
    assert.equal(big.keys().length, 200); assert.equal(big.keys()[0], "k229");
  });
});
