// SEVENTH PRE-LAUNCH AUDIT, REVIEWER FINDINGS ON THE PERFORMANCE BATCH (2026-10-20):
// 1. the coins index names every coin it could not read (`omitted`) and counts tokens and live coins from the registry, never from the
//    coins read; 2. a read joined from an earlier build carries that build's time and is never "fresh", and a kept read older than
//    EARLIER_MAX_AGE_MS is retired; 3. a coin whose listing could not be built keeps its own close time on the Next to settle tab.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { clearBoundedReads, EARLIER_MAX_AGE_MS, earlierReadsNote, readCoinsBounded, ReadTooOldError } from "@/lib/burnticker/boundedReads";
import { settleDateOf, tabCoins } from "@/lib/burnticker/coinsGrid";
import { makeWorld } from "./burntickerApiHelpers.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("finding 2: a read's own time", () => {
  test("a read joined from an earlier build is served as earlier, with the time that build started it", async () => {
    const scope = {}; let clock = 1_000;
    const slow = async () => { await sleep(60); return "v"; };
    const first = await readCoinsBounded([{ key: "k", read: slow }], { concurrency: 1, deadlineMs: 10, scope, now: () => clock });
    assert.equal(first[0].state, "failed", "late with no earlier read");
    clock = 5_000;
    const second = await readCoinsBounded([{ key: "k", read: async () => "never" }], { concurrency: 1, deadlineMs: 200, scope, now: () => clock });
    assert.equal(second[0].state, "earlier");
    if (second[0].state === "earlier") { assert.equal(second[0].why, "joined"); assert.equal(second[0].at, 1_000, "the start time of the read, not now"); assert.equal(second[0].value, "v"); }
    assert.match(earlierReadsNote([{ ticker: "K", r: second[0] }], clock), /joined from the last build/);
    const third = await readCoinsBounded([{ key: "k", read: async () => "w" }], { concurrency: 1, deadlineMs: 200, scope, now: () => clock });
    assert.equal(third[0].state, "fresh"); if (third[0].state === "fresh") assert.equal(third[0].at, 5_000);
  });
  test("a kept read older than the limit is retired: the coin counts as failed, never served from hours ago", async () => {
    const scope = {}; let clock = 0;
    await readCoinsBounded([{ key: "k", read: async () => "old" }], { concurrency: 1, deadlineMs: 50, scope, now: () => clock });
    clock = EARLIER_MAX_AGE_MS - 1;
    const ok = await readCoinsBounded([{ key: "k", read: async () => { throw new Error("down"); } }], { concurrency: 1, deadlineMs: 50, scope, now: () => clock });
    assert.equal(ok[0].state, "earlier", "inside the limit: the earlier read");
    clock = EARLIER_MAX_AGE_MS + 1;
    const old = await readCoinsBounded([{ key: "k", read: async () => { throw new Error("down"); } }], { concurrency: 1, deadlineMs: 50, scope, now: () => clock });
    assert.equal(old[0].state, "failed");
    if (old[0].state === "failed") assert.ok(old[0].error instanceof ReadTooOldError);
    assert.match(earlierReadsNote([{ ticker: "K", r: old[0] }], clock), /too old to serve \(K\)/);
  });
});

describe("finding 3: the Next to settle date", () => {
  const base = { ticker: "A", phase: "curve" as never, progressPct: null, launchedAt: null, status: "live" as never, nextCheckAt: "2026-10-21T00:06:00Z", nextCloseTime: "2026-11-04T00:00:00Z" };
  test("listing null (it could not be built): the coin's own close time, never its next poll", () => {
    assert.equal(settleDateOf({ ...base, listing: null }), "2026-11-04T00:00:00Z");
    assert.equal(settleDateOf({ ...base, nextCloseTime: null, listing: null }), null, "no close time: no date (HB-133: never the poll)");
  });
  test("unchanged otherwise: a listing's own date wins, an older answer with no listing keeps close time then check", () => {
    assert.equal(settleDateOf({ ...base, listing: { next: { at: "2026-10-30T00:00:00Z" } as never } }), "2026-10-30T00:00:00Z");
    assert.equal(settleDateOf({ ...base, listing: { next: null } as never }), null);
    assert.equal(settleDateOf({ ...base }), "2026-11-04T00:00:00Z");
    assert.equal(settleDateOf({ ...base, nextCloseTime: null }), "2026-10-21T00:06:00Z");
  });
  test("such a coin sorts by its date, not last", () => {
    const later = { ...base, ticker: "B", nextCloseTime: "2026-12-01T00:00:00Z", listing: { next: { at: "2026-12-01T00:00:00Z" } as never } };
    assert.deepEqual(tabCoins("next", [later, { ...base, listing: null }]).map((c) => c.ticker), ["A", "B"]);
  });
});

describe("finding 1: the coins index never shrinks its totals on a failed read", () => {
  test("every read past its deadline: each coin is named in omitted, and tokens and live count the registry's rows", async () => {
    const w = await makeWorld();
    clearBoundedReads(w.p.registry);
    // one coin's page cannot be read (its receipts throw), and it has no earlier read: it counts as failed
    const rows0 = w.registry.tokens().filter((t) => t.status === "live");
    const broken = rows0[0].mint;
    const receipts = w.registry.receipts.bind(w.registry);
    (w.registry as unknown as { receipts: typeof receipts }).receipts = ((mint: string, ...rest: unknown[]) => { if (mint === broken) throw new Error("unreadable"); return (receipts as (...a: unknown[]) => unknown)(mint, ...rest); }) as typeof receipts;
    const { GET } = await import("@/app/api/burnticker/tokens/route");
    const r = await GET(new Request("http://localhost/"));
    assert.equal(r.status, 200);
    const body = await r.json() as { tokens: unknown[]; totals: { tokens: number; live: number }; omitted: { mint: string; ticker: string; reason: string }[]; totalsPartial?: boolean };
    const rows = w.registry.tokens().filter((t) => t.status !== "draft" && t.status !== "expired");
    assert.ok(rows.length >= 2);
    assert.equal(body.totals.tokens, rows.length, "tokens counts the registry");
    assert.equal(body.totals.live, rows.filter((t) => t.status === "live").length, "live counts the registry");
    assert.equal(body.omitted.length + body.tokens.length, rows.length, "every coin is listed or named as omitted");
    assert.deepEqual(body.omitted.map((o) => o.mint), [broken], "the failed read is named");
    for (const o of body.omitted) { assert.ok(rows.some((t) => t.mint === o.mint && t.ticker === o.ticker)); assert.equal(o.reason, "This site could not read the coin's page."); }
    assert.equal(body.totalsPartial, true);
  });
});
