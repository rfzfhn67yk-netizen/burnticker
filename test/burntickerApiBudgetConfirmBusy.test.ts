// Review of audit 2026-10-18 A-38: the confirm lane has its own rate, but anyone can reach it (POST /v1/launch/confirm, the page's
// `launched` action). Thirty made-up signatures from one address queued a real creator's confirmation 28 s behind them. The verifier now
// asks laneBusy first: while the lane's rate is spent it reads nothing and answers 503 "please confirm again".
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ApiBudget, memoryStore, LANE_SPLIT, sharedRateOf } from "@/lib/burnticker/apiBudget";
import { connectionLaunchVerifier, type TxReader } from "@/lib/burnticker/launchVerify";
import { CONFIRM_LANE_BUSY_CODE, CONFIRM_LANE_BUSY_REASON, markLaneBusy } from "@/lib/burnticker/confirmBusy";
import { confirmPlan, type SignPlan } from "@/lib/burnticker/signPlan";

const EXPECT = { mint: "M1nt111111111111111111111111111111111111111", creator: "Creator111111111111111111111111111111111111", draftCreatedAtMs: 0, rulesSha: "0".repeat(64), venue: { kind: "launchlab" } } as never;

function world() {
  let t = Date.parse("2026-10-18T15:00:00Z");
  const b = new ApiBudget({ role: "web", store: memoryStore(), now: () => t, sleep: async (ms) => { t += ms; } });
  let reads = 0, waited = 0;
  // each read takes from the confirm lane, as the server's budgeted Connection does; a made-up signature reads as "not found"
  const reader: TxReader = {
    async getTransaction() { reads++; const r = await b.take("helius", { lane: "confirm", methods: { getTransaction: 1 } }); if (r.state === "ok") waited += r.waitedMs; else throw new Error(r.state); return null; },
    async getAccountInfo() { return null; },
    async getSignatureStatuses() { reads++; const r = await b.take("helius", { lane: "confirm", methods: { getSignatureStatuses: 1 } }); if (r.state === "ok") waited += r.waitedMs; else throw new Error(r.state); return { value: [null] }; },
  };
  const v = connectionLaunchVerifier(reader, { burnProgramId: "Prog111111111111111111111111111111111111111", busy: () => b.laneBusy("helius", "confirm") });
  return { b, v, advance: (ms: number) => { t += ms; }, reads: () => reads, waited: () => { const w = waited; waited = 0; return w; } };
}

describe("review of A-38: a spent confirm lane answers 503 at once instead of queueing", () => {
  test("thirty made-up signatures: the ones past the lane's rate read nothing and answer 503; a real confirm a few seconds later waits under 2 s", async () => {
    const w = world();
    const statuses: number[] = [];
    for (let i = 0; i < 30; i++) {
      const seen = await w.v.seen!(`fake${i}`);
      if (seen === false) { statuses.push(404); continue; }
      const r = await w.v.verify(`fake${i}`, EXPECT);
      statuses.push(r.ok ? 200 : r.status);
    }
    assert.ok(statuses.filter((s) => s === 503).length >= 20, statuses.join(","));
    assert.ok(w.reads() <= 10, `${w.reads()} reads for thirty made-up signatures`);
    w.waited();
    w.advance(5_000);
    await w.v.seen!("real");
    await w.v.verify("real", EXPECT);
    const waited = w.waited();
    assert.ok(waited < 2_000, `the real confirmation waited ${waited} ms`);
  });

  test("laneBusy is false for a budget that does not enforce and for a source without lanes", () => {
    const passive = new ApiBudget({ role: "web", enforce: false });
    assert.equal(passive.laneBusy("helius", "confirm"), false);
    const keeper = new ApiBudget({ role: "keeper" });
    assert.equal(keeper.laneBusy("helius", "confirm"), false);
  });
});

describe("the lane-busy 503 carries its code and Retry-After, and the sign card retries it on its own", () => {
  const plan = { steps: [{ label: "create" }], keys: {}, expect: {}, labels: {}, confirms: [{ mint: "Mint1111111111111111111111111111111111111111", ticker: "ABC", step: 0 }], venue: "launchlab", pending: [], missingKeys: "" } as unknown as SignPlan;
  const busy = () => markLaneBusy<{ status: number; body: unknown; headers?: Record<string, string> }>({ status: 503, body: { error: CONFIRM_LANE_BUSY_REASON, code: "launch-unverified" } });
  const resp = (r: { status: number; body: unknown; headers?: Record<string, string> }) => ({ ok: r.status < 400, status: r.status, headers: { get: (n: string) => r.headers?.[n.toLowerCase()] ?? null }, json: async () => r.body });

  test("markLaneBusy marks only the lane-busy answer", () => {
    const m = busy();
    assert.equal(m.headers?.["retry-after"], "3");
    assert.deepEqual(m.body, { error: CONFIRM_LANE_BUSY_REASON, code: CONFIRM_LANE_BUSY_CODE, retryAfterSec: 3 });
    const other = { status: 503, body: { error: "the RPC is down", code: "launch-unverified" } };
    assert.equal(markLaneBusy(other), other);
  });

  test("two busy answers then a 200: confirmed with no press, after two 3 s waits", async () => {
    const answers = [resp(busy()), resp(busy()), resp({ status: 200, body: { ok: true } })];
    const waits: number[] = [];
    const c = await confirmPlan(async () => answers.shift()!, plan, ["sig"], () => "refused", { sleep: async (ms) => { waits.push(ms); } });
    assert.deepEqual(c, { confirmed: [plan.confirms[0].mint], error: null });
    assert.deepEqual(waits, [3000, 3000]);
  });

  test("the retries are bounded: after six busy answers the card says so", async () => {
    let n = 0;
    const c = await confirmPlan(async () => { n++; return resp(busy()); }, plan, ["sig"], (st, b) => `refused ${st} ${b?.code}`, { sleep: async () => undefined });
    assert.equal(n, 7);
    assert.equal(c.error, `refused 503 ${CONFIRM_LANE_BUSY_CODE}`);
  });

  test("a 503 for any other reason is not retried", async () => {
    let n = 0;
    const c = await confirmPlan(async () => { n++; return resp({ status: 503, body: { error: "x", code: "launch-unverified" } }); }, plan, ["sig"], (st) => `refused ${st}`, { sleep: async () => undefined });
    assert.equal(n, 1); assert.equal(c.error, "refused 503");
  });

  test("helius-send gives the confirm lane no slice: the shared half is what the flight lane leaves", () => {
    assert.equal(LANE_SPLIT["helius-send"].confirmRate, 0);
    assert.equal(sharedRateOf(LANE_SPLIT["helius-send"]), 0.5);
  });
});
