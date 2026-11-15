// POLYMARKET ON-CHAIN RESOLUTION (2026-10-09): the three hand-encoded eth_calls against a fake RPC serving the fixture (the real
// bytes read from Polygon for the 2024 election market), the payout interpretation, RPC failover, and input refusals. No network.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { decodeUint, encodeCall, interpretPayouts, isConditionId, outcomeLabel, POLYMARKET_CTF, readConditionResolution, SEL_OUTCOME_SLOT_COUNT, SEL_PAYOUT_DENOMINATOR, SEL_PAYOUT_NUMERATORS, type FetchLike } from "@/lib/burnKeeper/attesters/polymarketOnchain";

const fx = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "fixtures/polymarket-trump-2024-condition.json"), "utf8")) as { gamma: { conditionId: string; outcomes: string[] }; chain: { blockNumber: string; calls: Record<string, { data: string; result: string }> }; second: { conditionId: string; payoutNumerators: string[] } };
const COND = fx.gamma.conditionId;

/** An RPC that answers exactly the fixture's calls (and a few synthetic conditions). */
function fakeRpc(opts: { failUrls?: string[]; unresolved?: string; split?: string } = {}): FetchLike & { calls: { url: string; data: string }[] } {
  const byData = new Map(Object.values(fx.chain.calls).map((c) => [c.data.toLowerCase(), c.result]));
  const word = (n: number | bigint) => `0x${BigInt(n).toString(16).padStart(64, "0")}`;
  const f = (async (url: string, init?: { body?: string }) => {
    const body = JSON.parse(init?.body ?? "{}") as { method: string; params: [{ to: string; data: string }] };
    if (opts.failUrls?.includes(url)) return { ok: false, status: 503, json: async () => ({}) };
    if (body.method === "eth_blockNumber") return { ok: true, status: 200, json: async () => ({ jsonrpc: "2.0", id: 1, result: fx.chain.blockNumber }) };
    const data = body.params[0].data.toLowerCase();
    f.calls.push({ url, data });
    assert.equal(body.params[0].to, POLYMARKET_CTF);
    let result: string | undefined = byData.get(data);
    const sel = data.slice(0, 10), cond = `0x${data.slice(10, 74)}`, idx = data.length > 74 ? Number(BigInt(`0x${data.slice(74)}`)) : 0;
    if (!result && cond === opts.unresolved) result = sel === SEL_OUTCOME_SLOT_COUNT ? word(2) : word(0);
    if (!result && cond === opts.split) result = sel === SEL_OUTCOME_SLOT_COUNT ? word(2) : sel === SEL_PAYOUT_DENOMINATOR ? word(2) : word(1);
    if (!result && cond === fx.second.conditionId) result = sel === SEL_OUTCOME_SLOT_COUNT ? word(2) : sel === SEL_PAYOUT_DENOMINATOR ? word(1) : word(BigInt(fx.second.payoutNumerators[idx]));
    if (!result) result = word(0);   // an unknown condition: slot count 0 → "not prepared"
    return { ok: true, status: 200, json: async () => ({ jsonrpc: "2.0", id: 1, result }) };
  }) as FetchLike & { calls: { url: string; data: string }[] };
  f.calls = [];
  return f;
}

describe("ABI by hand", () => {
  test("selectors and encodings are the bytes that were sent to Polygon", () => {
    assert.equal(encodeCall(SEL_OUTCOME_SLOT_COUNT, [COND]), fx.chain.calls.getOutcomeSlotCount.data);
    assert.equal(encodeCall(SEL_PAYOUT_DENOMINATOR, [COND]), fx.chain.calls.payoutDenominator.data);
    assert.equal(encodeCall(SEL_PAYOUT_NUMERATORS, [COND, 0]), fx.chain.calls["payoutNumerators[0]"].data);
    assert.equal(encodeCall(SEL_PAYOUT_NUMERATORS, [COND, 1]), fx.chain.calls["payoutNumerators[1]"].data);
    assert.equal(decodeUint(fx.chain.calls.payoutDenominator.result), BigInt(1));
    assert.throws(() => decodeUint("0x"), /empty data/); assert.throws(() => encodeCall(SEL_PAYOUT_DENOMINATOR, ["0x12"]), /bytes32/);
    assert.equal(isConditionId(COND), true); assert.equal(isConditionId(COND.slice(0, 60)), false);
  });
});

describe("readConditionResolution", () => {
  test("the 2024 election market: resolved, payouts [1, 0], outcome 0 = Yes", async () => {
    const rpc = fakeRpc();
    const r = await readConditionResolution(COND, { fetchImpl: rpc, rpcUrls: ["https://rpc.one"] });
    assert.equal(r.resolved, true); assert.equal(r.outcomeSlotCount, 2); assert.equal(r.payoutDenominator, "1");
    assert.deepEqual(r.payoutNumerators, ["1", "0"]); assert.deepEqual(r.payouts, ["1", "0"]); assert.equal(r.outcome, 0);
    assert.equal(outcomeLabel(r, fx.gamma.outcomes), "Yes");
    assert.equal(r.blockNumber, Number(BigInt(fx.chain.blockNumber))); assert.equal(r.rpcUrl, "https://rpc.one"); assert.equal(r.contract, POLYMARKET_CTF);
    assert.equal(rpc.calls.length, 4, "slot count, denominator, two numerators");
  });
  test("the Harris market resolves No; an unresolved condition is not resolved; a split payout has no single outcome", async () => {
    const rpc = fakeRpc({ unresolved: "0x" + "11".repeat(32), split: "0x" + "22".repeat(32) });
    const no = await readConditionResolution(fx.second.conditionId, { fetchImpl: rpc, rpcUrls: ["https://rpc.one"] });
    assert.equal(no.outcome, 1); assert.equal(outcomeLabel(no, ["Yes", "No"]), "No");
    const un = await readConditionResolution("0x" + "11".repeat(32), { fetchImpl: rpc, rpcUrls: ["https://rpc.one"] });
    assert.equal(un.resolved, false); assert.equal(un.outcome, null); assert.deepEqual(un.payouts, []); assert.equal(outcomeLabel(un, ["Yes", "No"]), null);
    const sp = await readConditionResolution("0x" + "22".repeat(32), { fetchImpl: rpc, rpcUrls: ["https://rpc.one"] });
    assert.equal(sp.resolved, true); assert.equal(sp.outcome, null); assert.deepEqual(sp.payouts, ["1/2", "1/2"]); assert.equal(outcomeLabel(sp, ["Yes", "No"]), "split (1/2, 1/2)");
  });
  test("fails over to the next RPC; every RPC failing is one error naming them; a bad id or an unprepared condition is refused", async () => {
    const rpc = fakeRpc({ failUrls: ["https://rpc.dead"] });
    const r = await readConditionResolution(COND, { fetchImpl: rpc, rpcUrls: ["https://rpc.dead", "https://rpc.one"] });
    assert.equal(r.rpcUrl, "https://rpc.one");
    await assert.rejects(readConditionResolution(COND, { fetchImpl: fakeRpc({ failUrls: ["https://a", "https://b"] }), rpcUrls: ["https://a", "https://b"] }), /every Polygon RPC failed — https:\/\/a: HTTP 503 · https:\/\/b: HTTP 503/);
    await assert.rejects(readConditionResolution("0xabc", { fetchImpl: rpc }), /0x \+ 64 hex/);
    await assert.rejects(readConditionResolution("0x" + "33".repeat(32), { fetchImpl: rpc, rpcUrls: ["https://rpc.one"] }), /not prepared on this contract/);
  });
  test("interpretPayouts refuses a vector that does not sum to the denominator", () => {
    assert.throws(() => interpretPayouts([BigInt(1), BigInt(1)], BigInt(1)), /sum to 2, denominator is 1/);
    assert.deepEqual(interpretPayouts([BigInt(0), BigInt(3)], BigInt(3)), { resolved: true, payouts: ["0", "1"], outcome: 1 });
  });
});
