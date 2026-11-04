// The owner's devnet check 2026-10-19: pressing Launch on an "every M6" earthquake coin answered "usgs.quakes:6 could not be read just
// now … the request rate budget is full" twice in a row. The launch pre-flight now reuses a reading of the same selector made in the last
// five minutes (coverage/freshReading.ts), waits out a short busy bucket, says how long to wait past that, and a shared host's minute
// bucket holds at least two tokens (apiBudget.ts burstCapOf).
import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { BUDGET_FRACTION, ROLE_SHARES, budgetFor, burstCapOf, configureApiBudget, memoryStore, resetApiBudget, sourceForUrl, specOf } from "@/lib/burnticker/apiBudget";
import { feedById, loadFixture } from "@/lib/burnticker/catalogue";
import { preflightSelector } from "@/lib/burnticker/coverage/preflight";
import { clearFreshReadings, FRESH_READING_MS, HOLD_WAIT_MAX_MS } from "@/lib/burnticker/coverage/freshReading";
import type { BurnRule } from "@/lib/burnticker/rules";
import type { FetchLike } from "@/lib/burnticker/oracle/types";

const SERIES = "usgs.quakes:6";
const feed = feedById(SERIES)!;
const fixture = loadFixture(feed);
const NOW = Date.parse(fixture.fetchedAt!);
const SOURCE = sourceForUrl("https://earthquake.usgs.gov/fdsnws/event/1/query");
const rule = { oracle: "catalogue", series: SERIES } as BurnRule;

/** A fake clock whose sleep advances it: waits are measured, never slept. */
function clock(start = NOW) {
  let t = start; const slept: number[] = [];
  return { now: () => t, sleep: async (ms: number) => { slept.push(ms); t += ms; }, advance: (ms: number) => { t += ms; }, slept };
}
/** The USGS answer from the saved sample, counting each HTTP read. */
function usgs() {
  const urls: string[] = [];
  const f: FetchLike = (async (url: string) => { urls.push(url); return { ok: true, status: 200, json: async () => fixture.body }; }) as unknown as FetchLike;
  return { f, urls };
}
const budget = (c: ReturnType<typeof clock>, maxWaitMs?: number) =>
  configureApiBudget({ role: "web", enforce: true, store: memoryStore(), now: c.now, sleep: c.sleep, ...(maxWaitMs !== undefined ? { maxWaitMs } : {}) });

afterEach(() => { resetApiBudget(); clearFreshReadings(); });

describe("the pre-flight reuses a fresh reading of the same selector", () => {
  test("a reading made 1 minute earlier (the review's) serves the pre-flight: zero HTTP reads, zero budget spent", async () => {
    assert.equal(SOURCE, "http:earthquake.usgs.gov");
    const c = clock(), b = budget(c), u = usgs();
    const review = await preflightSelector(rule, { fetchImpl: u.f, now: NOW - 60_000, sleep: c.sleep });
    assert.equal(review.refusal, null, review.refusal?.reason);
    assert.equal(u.urls.length, 1);
    const spent = b.used(SOURCE);
    const launch = await preflightSelector(rule, { fetchImpl: u.f, now: NOW, sleep: c.sleep });
    assert.equal(launch.refusal, null, launch.refusal?.reason);
    assert.equal(u.urls.length, 1, "no second HTTP read");
    assert.equal(b.used(SOURCE), spent, "no budget spent");
    assert.deepEqual(launch.primary.lastReading, review.primary.lastReading);
  });
  test("a reading 6 minutes old is past the window: the pre-flight reads once", async () => {
    assert.ok(6 * 60_000 > FRESH_READING_MS);
    const c = clock(), b = budget(c), u = usgs();
    await preflightSelector(rule, { fetchImpl: u.f, now: NOW - 6 * 60_000, sleep: c.sleep });
    c.advance(6 * 60_000);
    const spent = b.used(SOURCE);
    const launch = await preflightSelector(rule, { fetchImpl: u.f, now: NOW, sleep: c.sleep });
    assert.equal(launch.refusal, null, launch.refusal?.reason);
    assert.equal(u.urls.length, 2);
    assert.equal(b.used(SOURCE), spent + 1);
  });
});

describe("a busy rate bucket on the launch path", () => {
  test("a refusal whose bucket refills in 4 s is waited out, then the read succeeds", async () => {
    const c = clock(), b = budget(c, 0), u = usgs();
    assert.equal((await b.take(SOURCE)).state, "ok");
    const busy = await b.take(SOURCE);
    assert.equal(busy.state, "busy");
    c.advance((busy as { waitMs: number }).waitMs - 4_000);   // the bucket now refills in about 4 s
    const r = await preflightSelector(rule, { fetchImpl: u.f, now: NOW, sleep: c.sleep });
    assert.equal(r.refusal, null, r.refusal?.reason);
    assert.equal(u.urls.length, 1);
    assert.equal(c.slept.length, 1);
    assert.ok(c.slept[0] > 3_000 && c.slept[0] <= 4_000, `waited ${c.slept[0]} ms`);
  });
  test("a refusal past 15 s keeps the sentence and adds how long to wait, without waiting", async () => {
    const c = clock(), b = budget(c, 0), u = usgs();
    // two reads 11 s apart leave the minute bucket (1.8 a minute for the web) needing about 22 s for its next token
    assert.equal((await b.take(SOURCE)).state, "ok");
    c.advance(11_112);
    assert.equal((await b.take(SOURCE)).state, "ok");
    const r = await preflightSelector(rule, { fetchImpl: u.f, now: NOW, sleep: c.sleep });
    assert.equal(r.refusal?.code, "primary-unreadable");
    assert.match(r.refusal!.reason, /^usgs\.quakes:6 could not be read just now\. The error was: Other public hosts \(each\): the request rate budget is full; this read waits for the next cycle\. Try again in about (\d+) seconds\.$/);
    const secs = Number(/about (\d+) seconds/.exec(r.refusal!.reason)![1]);
    assert.ok(secs * 1000 > HOLD_WAIT_MAX_MS && secs <= 25, `${secs} s`);
    assert.equal(u.urls.length, 0);
    assert.deepEqual(c.slept, []);
  });
});

describe("the two-read floor on a shared host's minute bucket", () => {
  test("other-http under the web share: the minute bucket holds at least 2 tokens; the per-second and day limits are unchanged", () => {
    const spec = specOf("other-http"), b = budgetFor(spec, "web");
    const f = BUDGET_FRACTION * ROLE_SHARES.web;
    const sec = b.rates.find((r) => r.windowMs === 1_000)!, min = b.rates.find((r) => r.windowMs === 60_000)!;
    assert.ok(Math.abs(sec.perMs * 1_000 - 0.5 * f) < 1e-12, "per-second rate unchanged");
    assert.ok(Math.abs(min.perMs * 60_000 - 10 * f) < 1e-12, "per-minute rate unchanged");
    assert.equal(b.perDay, Math.floor(2_000 * f + 1e-6), "per-day budget unchanged");
    assert.ok(burstCapOf(min.perMs, min.windowMs, spec) >= 2, "minute cap at least 2");
    assert.equal(burstCapOf(sec.perMs, sec.windowMs, spec), 1, "second cap stays 1");
  });
  test("a review read and a pre-flight read seconds apart are both served under the production wait", async () => {
    const c = clock(), b = budget(c);
    assert.equal((await b.take(SOURCE)).state, "ok");
    c.advance(3_000);
    const second = await b.take(SOURCE);
    assert.equal(second.state, "ok");
    assert.ok((second as { waitedMs: number }).waitedMs <= HOLD_WAIT_MAX_MS, "waited only for the per-second bucket");
  });
  test("a source that spends its whole plan (API-Sports) keeps the plain cap; a share under one a minute keeps one token", () => {
    const as = specOf("apisports-football"), w = budgetFor(as, "web").rates[0];
    assert.ok(burstCapOf(w.perMs, w.windowMs, as) < 2);
    assert.equal(burstCapOf(0.5 / 60_000, 60_000, { fraction: undefined }), 1);
  });
});
