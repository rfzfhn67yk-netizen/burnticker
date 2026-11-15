// FOURTH PRELAUNCH AUDIT F11 (2026-10-18): a push that the channel refused (HTTP 503) still advanced the cursor and was counted as sent,
// so the alert was never retried after the channel came back and the 08:00 daily line said "sent one alert" for a failed attempt. A failed
// delivery now stays pending and is retried on a bounded backoff (the next check, then 5, 15 and 60 minutes, for up to 24 hours); after
// recovery the pending alert (or one digest of several) is delivered once; the daily line counts only acknowledged deliveries and says
// how many could not be delivered. Every test uses a fake sink; nothing leaves the machine.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { openRegistry } from "@/lib/burnticker/registry";
import { PUSH_STATE_KEY, runPushCheck, type PushState } from "@/lib/burnticker/push";

const M = 60_000, H = 60 * M;
/** 2026-10-20 05:00 Denver: before the daily line's hour. */
const DAWN = Date.parse("2026-10-20T11:00:00Z");
/** 2026-10-20 08:00 Denver. */
const EIGHT = Date.parse("2026-10-20T14:00:00Z");
const ENV = { BURNTICKER_PUSH_URL: "https://push.example/burnticker", BURNTICKER_PUSH_TOKEN: "tok-secret" };

interface Call { title: string; tags: string; body: string; ok: boolean }
/** A sink whose answer is decided per call: `accept(call)` true = HTTP 200, false = HTTP 503. */
function sink(accept: (c: { title: string; tags: string; body: string }) => boolean) {
  const calls: Call[] = [];
  const fetchImpl = (async (_url: string, init: { headers: Record<string, string>; body: string }) => {
    const c = { title: init.headers.title, tags: init.headers.tags, body: init.body };
    const ok = accept(c); calls.push({ ...c, ok });
    return { ok, status: ok ? 200 : 503 } as Response;
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}
type Reg = ReturnType<typeof openRegistry>;
const state = (reg: Reg) => JSON.parse(reg.getStatus(PUSH_STATE_KEY)!) as PushState;
const feedDown = (reg: Reg, ts: number, sel = "espn") =>
  reg.recordAlert({ kind: "bt-feed-down", key: `bt-feed-down:${sel}`, text: `The source ${sel} failed 5 reads in a row.`, meta: null }, ts);

describe("F11: a failed push is retried, never counted as sent", () => {
  test("503, then the channel recovers 5 minutes later: the alert is delivered once after recovery and only then counted", async () => {
    const reg = openRegistry(":memory:");
    let up = false;
    const s = sink(() => up);
    feedDown(reg, DAWN - 1000);
    const r1 = await runPushCheck({ registry: reg, env: ENV, now: DAWN, fetchImpl: s.fetchImpl });
    assert.equal(r1.sent.length, 0); assert.equal(r1.failed.length, 1);
    assert.equal(state(reg).sent.length, 0, "a failed attempt is not a delivery");
    up = true;
    const r2 = await runPushCheck({ registry: reg, env: ENV, now: DAWN + 5 * M, fetchImpl: s.fetchImpl });
    assert.equal(r2.sent.length, 1, "delivered after recovery");
    const delivered = s.calls.filter((c) => c.ok);
    assert.equal(delivered.length, 1);
    assert.equal(delivered[0].title, "Burnticker source down");
    assert.match(delivered[0].body, /The source espn failed 5 reads in a row\./);
    assert.match(delivered[0].body, /could not be delivered at first/);
    for (const t of [10, 15, 30, 60, 120]) await runPushCheck({ registry: reg, env: ENV, now: DAWN + t * M, fetchImpl: s.fetchImpl });
    assert.equal(s.calls.filter((c) => c.ok && c.tags !== "daily").length, 1, "delivered once, never again");
    // the 08:00 line counts the one acknowledged delivery and no failure is left to report
    await runPushCheck({ registry: reg, env: ENV, now: EIGHT, fetchImpl: s.fetchImpl });
    const daily = s.calls.filter((c) => c.tags === "daily");
    assert.equal(daily.length, 1);
    assert.equal(daily[0].body, "Burnticker sent one alert to this phone in the last 24 hours. This line arrives once a day.");
  });

  test("the daily line counts only acknowledged deliveries and says what could not be delivered", async () => {
    const reg = openRegistry(":memory:");
    const s = sink((c) => c.tags === "daily");                         // the channel takes only the daily line
    feedDown(reg, DAWN - 1000, "espn");
    reg.recordAlert({ kind: "bt-crank-failed", key: "bt-crank-failed:X", text: "The burn run for $X failed three times.", meta: null }, DAWN - 900);
    await runPushCheck({ registry: reg, env: ENV, now: DAWN, fetchImpl: s.fetchImpl });
    await runPushCheck({ registry: reg, env: ENV, now: EIGHT, fetchImpl: s.fetchImpl });
    const daily = s.calls.filter((c) => c.tags === "daily" && c.ok);
    assert.equal(daily.length, 1);
    assert.equal(daily[0].title, "Burnticker daily line");
    assert.equal(daily[0].body, "Burnticker sent no alerts to this phone in the last 24 hours. 2 alerts could not be delivered, and they are still being retried. This line arrives once a day.");
    assert.doesNotMatch(daily[0].body, /→|\bwill\b|\d{4}-\d{2}-\d{2}/);
  });

  test("several failed alerts: after recovery one digest names each, delivered once", async () => {
    const reg = openRegistry(":memory:");
    let up = false;
    const s = sink(() => up);
    feedDown(reg, DAWN - 1000, "espn");
    reg.recordAlert({ kind: "bt-crank-failed", key: "bt-crank-failed:X", text: "The burn run for $X failed three times.", meta: null }, DAWN - 900);
    await runPushCheck({ registry: reg, env: ENV, now: DAWN, fetchImpl: s.fetchImpl });
    up = true;
    await runPushCheck({ registry: reg, env: ENV, now: DAWN + 5 * M, fetchImpl: s.fetchImpl });
    await runPushCheck({ registry: reg, env: ENV, now: DAWN + 10 * M, fetchImpl: s.fetchImpl });
    const ok = s.calls.filter((c) => c.ok);
    assert.equal(ok.length, 1, "one digest, not one push per alert");
    assert.equal(ok[0].title, "Burnticker alerts not delivered earlier");
    assert.match(ok[0].body, /Burnticker source down: The source espn failed 5 reads in a row\./);
    assert.match(ok[0].body, /Burnticker burn run failing: The burn run for \$X failed three times\./);
    assert.doesNotMatch(ok[0].body, /→|\bwill\b/);
    assert.equal(state(reg).delivered?.length, 2, "two alerts delivered");
    assert.equal(state(reg).sent.length, 1, "one push against the hourly cap");
  });

  test("a channel that never recovers: retries follow the backoff (next check, 5, 15, 60 min) and stop after 24 hours", async () => {
    const reg = openRegistry(":memory:");
    const s = sink(() => false);
    const t0 = DAWN;
    feedDown(reg, t0 - 1000);
    const at: number[] = [];
    for (let t = t0; t <= t0 + 30 * H; t += 5 * M) {
      const before = s.calls.filter((c) => c.tags !== "daily").length;
      await runPushCheck({ registry: reg, env: ENV, now: t, fetchImpl: s.fetchImpl });
      if (s.calls.filter((c) => c.tags !== "daily").length > before) at.push((t - t0) / M);
    }
    // the first try, the next check, then 5, 15 and 60 minutes apart
    assert.deepEqual(at.slice(0, 5), [0, 5, 10, 25, 85], `attempt minutes: ${at.join(",")}`);
    assert.ok(at.length <= 1 + 1 + 1 + 1 + 24, `bounded: ${at.length} attempts`);
    assert.ok(at[at.length - 1] < 24 * 60, "no attempt after 24 hours");
    // the daily line is bounded the same way (it never reaches the phone here either)
    const dailyTries = s.calls.filter((c) => c.tags === "daily").length;
    assert.ok(dailyTries > 1 && dailyTries <= 2 * 28, `daily attempts bounded: ${dailyTries}`);
    assert.equal((state(reg) as PushState & { pending?: unknown[] }).pending?.length ?? 0, 0, "given up after 24 hours");
  });

  // review (2026-10-18): the digest counted one send per alert it carried and took each kind's hourly slot, so after an outage a new
  // serious alert in the next hour was only "held". The reviewer's scenario: six pending, recovery, the digest, then a keeper refusal.
  test("review: after a six-alert digest, a keeper refusal five minutes later is pushed, and so is a new alert of a summarised kind", async () => {
    const reg = openRegistry(":memory:");
    let up = false;
    const s = sink(() => up);
    const kinds = ["bt-crank-failed", "bt-pin-failed", "bt-feed-down", "bt-unit-failed", "bt-backup-failed", "bt-burn-behind"];
    kinds.forEach((k, i) => reg.recordAlert({ kind: k, key: `${k}:a`, text: `${k} happened.`, meta: null }, DAWN - 1000 + i));
    await runPushCheck({ registry: reg, env: ENV, now: DAWN, fetchImpl: s.fetchImpl });
    assert.equal(state(reg).pending?.length, 6);
    up = true;
    await runPushCheck({ registry: reg, env: ENV, now: DAWN + 5 * M, fetchImpl: s.fetchImpl });
    const digest = s.calls.filter((c) => c.ok);
    assert.equal(digest.length, 1); assert.equal(digest[0].title, "Burnticker alerts not delivered earlier");
    assert.equal(state(reg).sent.length, 1, "the digest is one push against the hourly cap");
    assert.equal(state(reg).delivered?.length, 6, "six alerts delivered for the daily line");
    reg.recordAlert({ kind: "bt-keeper-refused", key: "bt-keeper-refused:x", text: "The keeper refused to start. The reason given was: no key", meta: null }, DAWN + 9 * M);
    reg.recordAlert({ kind: "bt-crank-failed", key: "bt-crank-failed:b", text: "Another burn run failed three times.", meta: null }, DAWN + 9 * M + 1);
    await runPushCheck({ registry: reg, env: ENV, now: DAWN + 10 * M, fetchImpl: s.fetchImpl });
    const after = s.calls.filter((c) => c.ok).slice(1).map((c) => c.title);
    assert.deepEqual(after, ["Burnticker keeper refused to start", "Burnticker burn run failing"], "neither is held behind the digest");
  });

  test("review: an urgent kind is never held by the six-per-hour cap; an ordinary kind still is", async () => {
    const { planPushes, PUSH_MAX_PER_HOUR } = await import("@/lib/burnticker/push");
    const full = { cursor: DAWN - H, lastByKind: {}, sent: Array.from({ length: PUSH_MAX_PER_HOUR }, (_, i) => DAWN - i * 1000), held: {}, heldToday: 0, lastDaily: "2026-10-20" };
    const r = planPushes({ now: DAWN, state: full, alerts: [{ ts: DAWN - 2, kind: "bt-crank-failed", key: "c", text: "c" }, { ts: DAWN - 1, kind: "bt-keeper-takeover", key: "t", text: "t" }] });
    assert.deepEqual(r.messages.map((m) => m.kind), ["keeper-takeover"]);
    assert.equal(r.state.heldToday, 1, "the ordinary one is held");
    assert.match(r.messages[0].body, /One more alert was held back by the rate limit/);
  });
});
