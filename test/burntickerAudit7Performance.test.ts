// SEVENTH PRE-LAUNCH AUDIT, PERFORMANCE RESIDUES (2026-10-20): OP7-4 (search 5 to 7 s), OP7-5 (cold home 15 s), OP7-6 (the event loop
// held about 1.1 s every 2 to 3 minutes) and B-10 (the first cold creator page: every coin "Still loading this coin").
// - Polymarket's client: concurrent callers of one Gamma URL share one request (the cold home and coins builds sent 17 for 4 URLs).
// - The search's race index is kept as parsed races (elections.ts cachedRaces): fresh, stale-while-revalidate, shared, failure-safe.
// - boundedMemo: a per-call cold wait; the creator page streams each coin as it resolves (creatorServe.ts creatorStream).
// - warmCoinPages reads every coin into the shared coin-page memo after a production start.
// The linear recordReadings is checked against the old quadratic pass in burntickerSources4.test.ts.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { PolymarketClient } from "@/lib/burnticker/oracle/polymarket";
import { cachedRaces, RACES_FRESH_MS, RACES_MAX_STALE_MS, type Race } from "@/lib/burnticker/elections";
import { boundedMemo } from "@/lib/burnticker/boundedMemo";
import { rememberedCoinPage, warmCoinPages, type CoinPageReader } from "@/lib/burnticker/coinPageMemo";
import { creatorStream } from "@/lib/burnticker/creatorServe";
import { tokenPageData } from "@/lib/burnticker/server";
import { CREATOR_PAGE } from "@/lib/burnticker/creatorBenefits";
import { CREATOR, makeWorld } from "./burntickerApiHelpers.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("OP7-5: one Gamma request per URL, however many callers", () => {
  test("concurrent gets of one URL send one request; a caller queued behind an answered URL is served from the cache", async () => {
    const sent: string[] = [];
    const fetchImpl = (async (u: string) => { sent.push(u); await sleep(5); return { ok: true, status: 200, json: async () => ({ u }) }; }) as never;
    const c = new PolymarketClient({ fetchImpl, minIntervalMs: 0 });
    const a = "https://gamma-api.polymarket.com/markets?condition_ids=0xaa&closed=true", b = "https://gamma-api.polymarket.com/markets?condition_ids=0xbb&closed=true";
    const got = await Promise.all([c.get(a), c.get(a), c.get(b), c.get(a), c.get(b)]);
    assert.deepEqual(sent, [a, b], "two URLs, two requests");
    assert.deepEqual(got.map((g) => (g as { u: string }).u), [a, a, b, a, b], "each caller gets its own URL's answer");
    assert.deepEqual(await c.get(a), { u: a }); assert.equal(sent.length, 2, "then the cache");
    // a fresh read (ttl 0) still goes out, once for its concurrent callers
    await Promise.all([c.get(a, 0), c.get(a, 0)]);
    assert.equal(sent.length, 3);
  });
  test("a failed request fails its joined callers and is sent again by the next caller", async () => {
    let n = 0;
    const fetchImpl = (async () => { n++; return n === 1 ? { ok: false, status: 500, json: async () => ({}) } : { ok: true, status: 200, json: async () => ({ ok: n }) }; }) as never;
    const c = new PolymarketClient({ fetchImpl, minIntervalMs: 0 });
    const u = "https://gamma-api.polymarket.com/events?slug=x";
    const r = await Promise.allSettled([c.get(u), c.get(u)]);
    assert.deepEqual(r.map((x) => x.status), ["rejected", "rejected"]); assert.equal(n, 1);
    assert.deepEqual(await c.get(u), { ok: 2 });
  });
  test("the cold home and coins builds read the same two markets through this client (the route source)", () => {
    assert.match(fs.readFileSync("src/lib/burnticker/oracle/polymarket.ts", "utf8"), /const joined = this\.inflight\.get\(url\);\s*if \(joined\) return joined;/);
  });
});

describe("OP7-4: the parsed race index is kept", () => {
  const race = (slug: string) => ({ slug }) as unknown as Race;
  test("fresh: served without a read; concurrent cold callers share one read", async () => {
    let clock = 1_000_000, loads = 0;
    const owner = {};
    const load = async () => { loads++; await sleep(5); return [race(`r${loads}`)]; };
    const [x, y] = await Promise.all([cachedRaces(owner, load, { now: () => clock }), cachedRaces(owner, load, { now: () => clock })]);
    assert.equal(loads, 1); assert.equal(x, y);
    clock += RACES_FRESH_MS - 1;
    assert.equal((await cachedRaces(owner, load, { now: () => clock }))[0].slug, "r1"); assert.equal(loads, 1);
  });
  test("stale: the kept index at once and one re-read behind it; past the maximum staleness the caller waits", async () => {
    let clock = 0, loads = 0;
    const owner = {};
    const load = async () => { loads++; await sleep(5); return [race(`r${loads}`)]; };
    await cachedRaces(owner, load, { now: () => clock });
    clock = RACES_FRESH_MS + 1;
    const [a, b] = await Promise.all([cachedRaces(owner, load, { now: () => clock }), cachedRaces(owner, load, { now: () => clock })]);
    assert.equal(a[0].slug, "r1"); assert.equal(b[0].slug, "r1"); assert.equal(loads, 2, "one re-read for both");
    await sleep(15);
    assert.equal((await cachedRaces(owner, load, { now: () => clock }))[0].slug, "r2", "the re-read replaced it");
    clock += RACES_MAX_STALE_MS;
    assert.equal((await cachedRaces(owner, load, { now: () => clock }))[0].slug, "r3", "too old: waited for");
  });
  test("a failed re-read keeps the last index; a failed cold read rejects (the search reports it, as before)", async () => {
    let clock = 0, fail = false;
    const owner = {};
    const load = async () => { if (fail) throw new Error("gamma down"); return [race("ok")]; };
    await cachedRaces(owner, load, { now: () => clock });
    fail = true; clock = RACES_FRESH_MS + 1;
    assert.equal((await cachedRaces(owner, load, { now: () => clock }))[0].slug, "ok");
    await sleep(5);
    assert.equal((await cachedRaces(owner, load, { now: () => clock }))[0].slug, "ok", "still kept after the failure");
    await assert.rejects(cachedRaces({}, load, { now: () => clock }), /gamma down/);
  });
  test("one index per client: another client never sees it", async () => {
    const a = {}, b = {};
    await cachedRaces(a, async () => [race("a")]);
    assert.equal((await cachedRaces(b, async () => [race("b")]))[0].slug, "b");
  });
  test("the search and the elections routes read through the kept index (handlers.ts racesFor)", () => {
    const h = fs.readFileSync("src/lib/burnticker/api/handlers.ts", "utf8"), s = fs.readFileSync("src/lib/burnticker/search.ts", "utf8");
    assert.match(h, /races: \(\) => racesFor\(p\)/);
    assert.equal((h.match(/const races = await racesFor\(p\);/g) ?? []).length, 2);
    assert.doesNotMatch(s, /await loadRaces\(d\.polyGet/);
  });
});

describe("B-10: the creator page streams each coin", () => {
  test("boundedMemo: a per-call cold wait overrides the memo's", async () => {
    const m = boundedMemo<number>({ freshMs: 60_000, coldWaitMs: 10 });
    assert.equal(await m.get("a", async () => { await sleep(40); return 1; }), null, "the memo's 10 ms");
    assert.equal(await m.get("b", async () => { await sleep(40); return 2; }, { coldWaitMs: 200 }), 2, "this call's 200 ms");
  });
  test("creatorStream: every coin's loading card at once, each full card as its own read finishes, a coin past its bound stays loading", async () => {
    const w = await makeWorld();
    const rows = w.registry.tokens().filter((t) => t.creator === CREATOR && t.status !== "draft" && t.status !== "expired");
    assert.ok(rows.length >= 2);
    const slowMint = rows[0].mint;
    const read: CoinPageReader = async (p, t, n) => { await sleep(t.mint === slowMint ? 400 : 20); return tokenPageData(p, t, n); };
    const t0 = Date.now();
    const d = creatorStream(CREATOR, Date.now(), w.p, { waitMs: 150, read });
    assert.equal(d.kind, "ok");
    if (d.kind !== "ok") return;
    assert.ok(Date.now() - t0 < 100, "the shell does not wait for any coin");
    assert.equal(d.coins.length, rows.length);
    for (const c of d.coins) { assert.equal(c.loading.loading, true); assert.equal(c.loading.nextLine, CREATOR_PAGE.coinLoading); }
    const order: string[] = [];
    const views = await Promise.all(d.coins.map((c) => c.view.then((v) => { order.push(v.mint); return v; })));
    assert.equal(order.at(-1), slowMint, "the slow coin resolves last; the others did not wait for it");
    for (const v of views) {
      if (v.mint === slowMint) { assert.equal(v.loading, true, "past its bound: still loading"); assert.equal(v.available, false); }
      else { assert.equal(v.available, true); assert.equal(v.loading, false); }
    }
    await sleep(350);
    const again = creatorStream(CREATOR, Date.now(), w.p, { waitMs: 150, read });
    if (again.kind === "ok") assert.ok((await Promise.all(again.coins.map((c) => c.view))).every((v) => v.available), "the read carried on for the next visit");
  });
  test("the page renders each coin inside its own Suspense, its loading card as the fallback", () => {
    const page = fs.readFileSync("src/app/burnticker/creator/[wallet]/page.tsx", "utf8");
    assert.match(page, /creatorStream\(wallet\)/);
    assert.match(page, /<Suspense key=\{c\.loading\.mint\} fallback=\{<CoinItem c=\{c\.loading\}/);
    assert.match(page, /<ResolvedCoin view=\{c\.view\}/);
  });
  test("warmCoinPages reads every coin once into the shared memo; the next page read is served from it", async () => {
    const w = await makeWorld();
    let reads = 0;
    const read: CoinPageReader = async (p, t, n) => { reads++; return tokenPageData(p, t, n); };
    const n = await warmCoinPages(w.p, read);
    const rows = w.registry.tokens().filter((t) => t.status !== "draft" && t.status !== "expired");
    assert.equal(n, rows.length); assert.equal(reads, rows.length);
    assert.notEqual(await rememberedCoinPage(w.p, rows[0], Date.now(), read, { waitMs: 0 }), null);
    assert.equal(reads, rows.length, "no second read");
  });
  test("a production start schedules the warm reads behind the home and coins warm builds (server.ts)", () => {
    const s = fs.readFileSync("src/lib/burnticker/server.ts", "utf8");
    assert.match(s, /m\.warmCoinPages\(p\)\)\.catch\(\(\) => null\); \}, COIN_WARM_DELAY_MS\)/);
    assert.match(s, /m\.warmRaces\(p\)\)\.catch\(\(\) => null\); \}, RACE_WARM_DELAY_MS\)/);
  });
});
