// 2026-10-18 PRELAUNCH AUDIT F02: UNBOUNDED STALE COIN SNAPSHOTS. The coin route's memo (keyedSwr.ts) answered "hit" at any age while
// its refresh kept failing or never landed (the audit served a pool read from 01:00 UTC at 22:08 UTC), the route dropped the age, the
// page loaded once, and a past check was still "Next source check". These pin the maximum age, the bounded build time, the route's
// freshness fields, the page's dated snapshot and the overdue label.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { KeyedSwr, SWR_BUILD_TIMEOUT_MS } from "@/lib/burnticker/keyedSwr";
import { COIN_MAX_STALE_MS, STALE_WITHHELD, coinFreshness, lengthWords, snapshotView, staleSnapshotLine, withholdStaleMarket } from "@/lib/burnticker/coinFreshness";
import { OVERDUE_CHECK_NOTE, PASSED_CLOSE_NOTE, nextTimeRow } from "@/lib/burnticker/coinSourceLine";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import { makeWorld } from "./burntickerApiHelpers.ts";

const H = 3_600_000;
const AT_0100 = Date.parse("2026-10-18T01:00:00Z"), AT_2208 = Date.parse("2026-10-18T22:08:00Z");
const deferred = <T,>() => { let ok!: (v: T) => void; const p = new Promise<T>((a) => { ok = a; }); return { p, ok }; };
const settle = () => new Promise((ok) => setImmediate(ok));
const memo = (clock: () => number) => new KeyedSwr<string>({ freshMs: 15_000, coldWaitMs: 20, maxStaleMs: COIN_MAX_STALE_MS, buildTimeoutMs: SWR_BUILD_TIMEOUT_MS }, clock);

describe("the coin memo has a maximum age (keyedSwr.ts maxStaleMs)", () => {
  test("two failed refreshes at 21 hours answer stale with the age, never hit", async () => {
    let t = AT_0100;
    const m = memo(() => t);
    assert.equal((await m.get("MINT", "1", async () => "pool read at 01:00"))!.state, "cold");
    t = AT_2208;
    let fails = 0;
    const failing = async (): Promise<string> => { fails++; throw new Error("rpc down"); };
    for (let i = 0; i < 2; i++) {
      const r = await m.get("MINT", "1", failing);
      assert.equal(r!.state, "stale", `read ${i + 1} after a failed refresh`);
      assert.equal(r!.value, "pool read at 01:00");
      assert.equal(r!.ageMs, AT_2208 - AT_0100);
      assert.ok(r!.ageMs / H > 21);
      await settle();
    }
    assert.equal(fails, 2, "each read past the line tries a refresh");
    const f = coinFreshness(await m.get("MINT", "1", failing) as { state: string; ageMs: number }, null, AT_2208);
    assert.equal(f.stale, true);
  });

  test("a stuck refresh counts as failed after the build timeout and a new one recovers; the stuck one landing late overwrites nothing", async () => {
    let t = AT_0100;
    const m = memo(() => t);
    await m.get("MINT", "1", async () => "old");
    t = AT_0100 + 20 * 60_000;
    const stuck = deferred<string>();
    let stuckBuilds = 0;
    const r1 = await m.get("MINT", "1", () => { stuckBuilds++; return stuck.p; });
    assert.equal(r1!.state, "stale", "the stuck refresh does not make an old answer a hit");
    t += 60_000;
    assert.equal((await m.get("MINT", "1", async () => "unused"))!.state, "stale", "still inside the build timeout: the stuck build is the one in flight");
    t += SWR_BUILD_TIMEOUT_MS;
    const r2 = await m.get("MINT", "1", async () => "fresh");
    assert.equal(r2!.state, "hit"); assert.equal(r2!.value, "fresh"); assert.equal(r2!.ageMs, 0);
    stuck.ok("late stuck answer"); await stuck.p; await settle();
    assert.equal((await m.get("MINT", "1", async () => "x"))!.value, "fresh", "a late landing never overwrites the newer answer");
    assert.equal(stuckBuilds, 1);
  });

  test("a new registry version does not queue behind a stuck build past the timeout; an old version's answer reports its age", async () => {
    let t = AT_0100;
    const m = memo(() => t);
    await m.get("MINT", "1", async () => "v1");
    t = AT_0100 + 20 * 60_000;
    const stuck = deferred<string>();
    await m.get("MINT", "1", () => stuck.p);
    const waiting = await m.get("MINT", "2", async () => "v2");
    assert.equal(waiting!.state, "stale-version", "inside the timeout a new version still waits for the build in flight");
    assert.equal(waiting!.ageMs, 20 * 60_000);
    assert.equal(coinFreshness(waiting!, null, t).stale, true, "an old version's answer past the line is stale too");
    t += SWR_BUILD_TIMEOUT_MS;
    const r = await m.get("MINT", "2", async () => "v2");
    assert.equal(r!.state, "version"); assert.equal(r!.value, "v2");
  });

  test("recovery clears the stale label: a refresh that lands answers hit, and the route and page call it fresh", async () => {
    let t = AT_0100;
    const m = memo(() => t);
    await m.get("MINT", "1", async () => "old");
    t = AT_2208;
    const bad = await m.get("MINT", "1", async () => { throw new Error("rpc down"); });
    await settle();
    const status = (readAt: number) => ({ market: { readAt: new Date(readAt).toISOString() } });
    assert.equal(coinFreshness(bad!, status(AT_0100), t).stale, true);
    const good = await m.get("MINT", "1", async () => "new");
    assert.equal(good!.state, "hit"); assert.equal(good!.value, "new");
    const f = coinFreshness(good!, status(t), t);
    assert.deepEqual(f, { ageMs: 0, marketAgeMs: 0, stale: false });
    assert.equal(snapshotView(f, t, t + 60_000).stale, false);
  });

  test("the build bound is opt-in: a memo without buildTimeoutMs keeps waiting on its one build in flight, as before", async () => {
    let t = 0, builds = 0;
    const m = new KeyedSwr<string>({ freshMs: 15_000, coldWaitMs: 20 }, () => t);
    await m.get("A", "1", async () => "v1");
    t = 20_000;
    const stuck = deferred<string>();
    await m.get("A", "1", () => { builds++; return stuck.p; });
    t += 10 * SWR_BUILD_TIMEOUT_MS;
    await m.get("A", "1", async () => { builds++; return "never"; });
    assert.equal(builds, 1, "no second build while the first is in flight");
    // audit 7 F06 (2026-10-19): the trust memo now opts in, with the coin page's bounds (test/burntickerTrustBounded.test.ts)
    const trust = fs.readFileSync("src/lib/burnticker/trustServe.ts", "utf8");
    assert.match(trust, /maxStaleMs: TRUST_MAX_STALE_MS, buildTimeoutMs: SWR_BUILD_TIMEOUT_MS/, "the trust memo opts in");
  });

  test("without maxStaleMs an old answer stays a hit, as before (the trust memo has one since audit 7 F06)", async () => {
    let t = 0;
    const m = new KeyedSwr<string>({ freshMs: 15_000, coldWaitMs: 20 }, () => t);
    await m.get("A", "1", async () => "v");
    t = 21 * H;
    assert.equal((await m.get("A", "1", async () => { throw new Error("x"); }))!.state, "hit");
  });
});

describe("the route's freshness fields and the page's dated snapshot (coinFreshness.ts)", () => {
  test("coinFreshness: the memo's age, the pool read's own age, and stale past 15 minutes either way", () => {
    assert.equal(COIN_MAX_STALE_MS, 15 * 60_000);
    assert.deepEqual(coinFreshness({ state: "hit", ageMs: 5_000 }, { market: { readAt: new Date(AT_2208 - 10_000).toISOString() } }, AT_2208), { ageMs: 5_000, marketAgeMs: 10_000, stale: false });
    assert.equal(coinFreshness({ state: "hit", ageMs: 5_000 }, { market: { readAt: new Date(AT_0100).toISOString() } }, AT_2208).stale, true, "an old pool read inside a fresh memo answer");
    assert.equal(coinFreshness({ state: "stale", ageMs: 1 }, null, AT_2208).stale, true);
    assert.equal(coinFreshness({ state: "hit", ageMs: 1 }, { market: null }, AT_2208).marketAgeMs, null);
  });

  test("snapshotView adds the time since the page received the answer, so a page left open goes stale on its own", () => {
    const f = { ageMs: 0, marketAgeMs: 0, stale: false };
    assert.equal(snapshotView(f, AT_0100, AT_0100 + 14 * 60_000).stale, false);
    assert.equal(snapshotView(f, AT_0100, AT_0100 + 15 * 60_000).stale, true);
    assert.equal(snapshotView({ ageMs: 21 * H, marketAgeMs: null, stale: true }, AT_2208, AT_2208).ageMs, 21 * H);
  });

  test("the dated snapshot line, and the trade-sensitive fields withheld", () => {
    assert.equal(staleSnapshotLine(21 * H + 8 * 60_000), "Read 21 hours ago; a fresh read has not succeeded since.");
    assert.equal(lengthWords(60_000), "1 minute"); assert.equal(lengthWords(16 * 60_000), "16 minutes"); assert.equal(lengthWords(3 * 24 * H), "3 days");
    const w = withholdStaleMarket({ phase: "curve", curve: { raised: "40", threshold: "85" }, curveNote: "", pool: { solReserve: "1" }, poolNote: "", readAt: "2026-10-18T01:00:00Z" }, 21 * H);
    assert.equal(w.curve, null); assert.equal(w.pool, null); assert.equal(w.readAt, "2026-10-18T01:00:00Z", "the read time stays on the page");
    assert.match(w.curveNote, /Read 21 hours ago/); assert.match(w.poolNote!, new RegExp(STALE_WITHHELD.replace(/[.'()]/g, "\\$&")));
  });

  test("a past source check is labelled overdue, never next; a future one is unchanged", () => {
    const row = nextTimeRow(null, "2026-10-18T01:39:00Z", AT_2208);
    assert.equal(row.label, "Source check overdue"); assert.equal(row.value, "18 October 2026, 01:39 UTC"); assert.equal(row.note, OVERDUE_CHECK_NOTE);
    assert.notEqual(row.label, "Next source check");
    assert.equal(nextTimeRow(null, "2026-10-18T23:00:00Z", AT_2208).label, "Next source check");
    assert.equal(nextTimeRow("2026-10-18T01:00:00Z", null, AT_2208).label, "Scheduled market close, passed");
    assert.equal(nextTimeRow("2026-10-18T23:00:00Z", null, AT_2208).label, "Next market close");
  });

  test("every new sentence passes the copy lint", () => {
    const cfg = loadCopyLintConfig();
    for (const t of [staleSnapshotLine(21 * H), staleSnapshotLine(60_000), STALE_WITHHELD, OVERDUE_CHECK_NOTE, PASSED_CLOSE_NOTE, "Source check overdue", "Scheduled market close, passed"]) {
      assert.deepEqual(lintCopy(t, cfg).hits.map((h) => h.rule), [], t);
    }
  });

  test("the page re-reads on an interval, dates an old snapshot and withholds reserves and progress; the route sends the fields", () => {
    const page = fs.readFileSync("src/app/burnticker/t/[ticker]/page.tsx", "utf8");
    assert.match(page, /again\(j\?\.stale \? COIN_STALE_POLL_MS : COIN_POLL_MS\)/, "the mounted page asks again, sooner while stale");
    assert.match(page, /const snap = snapshotView\(d, d\.receivedAt, tick\)/);
    assert.match(page, /snap\.stale && d\.status\.market \? withholdStaleMarket\(d\.status\.market, snap\.ageMs\)/);
    assert.match(page, /staleSnapshotLine\(snap\.ageMs\)/);
    // review follow-up: hidden tabs do not poll (the next read waits for visibilitychange), and a 404 or 300 stops the re-reads
    assert.match(page, /timer = setTimeout\(\(\) => \{ if \(hidden\(\)\) \{ waiting = true; return; \} load\(0\); \}, ms\)/);
    assert.match(page, /document\.addEventListener\("visibilitychange", onVisible\)/);
    assert.match(page, /document\.removeEventListener\("visibilitychange", onVisible\)/);
    assert.match(page, /if \(have && \(r\.status === 404 \|\| r\.status === 300\)\) return;/);
    const route = fs.readFileSync("src/app/api/burnticker/tokens/[ticker]/route.ts", "utf8");
    assert.match(fs.readFileSync("src/lib/burnticker/coinAnswerMemo.ts", "utf8"), /maxStaleMs: COIN_MAX_STALE_MS, buildTimeoutMs: SWR_BUILD_TIMEOUT_MS/, "the coin memo (shared with the pair route, HB-35) opts in to the build bound");
    assert.match(route, /\{ \.\.\.got\.value, \.\.\.fresh \}/);
  });

  test("the coin route answers with ageMs, marketAgeMs and stale", async () => {
    const w = await makeWorld();
    const { GET } = await import("../src/app/api/burnticker/tokens/[ticker]/route.ts") as { GET: (req: Request, ctx: { params: Promise<{ ticker: string }> }) => Promise<Response> };
    const r = await GET(new Request(`http://bt.test/api/burnticker/tokens/${w.deficit.mint}`), { params: Promise.resolve({ ticker: w.deficit.mint }) });
    assert.equal(r.status, 200);
    const j = await r.json() as { ageMs?: unknown; stale?: unknown; marketAgeMs?: unknown };
    assert.equal(typeof j.ageMs, "number"); assert.equal(typeof j.stale, "boolean"); assert.ok("marketAgeMs" in j);
  });
});
