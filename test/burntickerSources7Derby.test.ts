// SOURCES-7 (QA walkthrough 11 H7): the flippening's "A is already larger" check runs when both coins are picked (POST /v1/derby/pair,
// the same preflight the bundle runs), and SOL against its own staking tokens (or BTC/ETH against their wrappers) is refused for the daily
// race and the flippening with a plain reason, at pick time (the tile's problems), on the review and at the bundle (admission).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { openRegistry } from "@/lib/burnticker/registry";
import { derbySeriesId, flipAlreadyAheadSentence, wrapperPairProblem, type CoinVsSpec, type DerbyUnderlying } from "@/lib/burnticker/derby/spec";
import { rulesSha256 } from "@/lib/burnKeeper/rules";
import { tileRule } from "@/lib/burnticker/derby/tile";
import { derbyAdmission } from "@/lib/burnticker/derby/admission";
import { v1DerbyPairCheck } from "@/lib/burnticker/api/derby";
import { buildLaunchReview } from "@/lib/burnticker/launchReview";
import type { Platform } from "@/lib/burnticker/server";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import { BONK, BONK_MINT, WIF, WIF_MINT, fixtureFetch, fixturePort } from "./burntickerDerbyHelpers.ts";

const cfgLint = loadCopyLintConfig();
const lint = (t: string) => { const r = lintCopy(t, cfgLint); assert.ok(r.ok, `${r.hits.map((h) => `${h.phrase} (${h.rule})`).join(", ")}\n${t}`); };
const hex = (s: string) => Buffer.from(s.padEnd(32, "x")).toString("hex").slice(0, 64);
const u = (symbol: string, mint: string | null = null): DerbyUnderlying => ({ symbol, pyth: hex(symbol), mint, pool: null, cross: mint ? `jup:${mint}` : `redstone:${symbol}` });
const SOL = u("SOL", "So11111111111111111111111111111111111111112");
const JITOSOL = u("JITOSOL", "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn");
const NOW = Date.UTC(2026, 9, 10, 22, 20);

describe("H7: wrapper pairs", () => {
  test("SOL against its staking tokens, BTC against its wrappers, ETH against its own: refused with one plain reason; unrelated coins pass", () => {
    for (const [a, b] of [["SOL", "JITOSOL"], ["MSOL", "SOL"], ["SOL", "BSOL"], ["SOL", "BNSOL"], ["JITOSOL", "MSOL"], ["BTC", "WBTC"], ["CBBTC", "BTC"], ["ETH", "WETH"], ["STETH", "ETH"], ["sol", "jitoSOL"]]) {
      const p = wrapperPairProblem(u(a), u(b));
      assert.ok(p, `${a} vs ${b}`);
      lint(p!);
    }
    assert.match(wrapperPairProblem(SOL, JITOSOL)!, /^JITOSOL is a wrapped form of SOL/);
    assert.match(wrapperPairProblem(u("JITOSOL"), u("MSOL"))!, /both forms of SOL/);
    for (const [a, b] of [["SOL", "BTC"], ["WIF", "BONK"], ["ETH", "BTC"], ["SOL", "JUP"]]) assert.equal(wrapperPairProblem(u(a), u(b)), null, `${a} vs ${b}`);
  });

  test("the tile refuses the pair when it is picked, for the daily race and the flippening", () => {
    for (const flip of [false, true]) {
      const t = tileRule({ a: SOL, b: JITOSOL, window: "daily", seasonDays: 30, flip, fraction: flip ? 1 : 0.02, now: NOW }, "0".repeat(64), { a: "SOLVJITO", b: "JITOVSOL" });
      assert.equal(t.rule, null);
      assert.ok(t.problems.includes(wrapperPairProblem(SOL, JITOSOL)!), t.problems.join("; "));
    }
  });

  test("the bundle's admission and the review refuse it too", async () => {
    const t = tileRule({ a: WIF, b: BONK, window: "daily", seasonDays: 30, flip: false, fraction: 0.02, now: NOW }, "0".repeat(64), { a: "A", b: "B" });
    const derby = { ...t.rule!.derby!, a: SOL, b: JITOSOL } as CoinVsSpec;
    const rule = { ...t.rule!, derby, series: derbySeriesId(derby, rulesSha256) };
    const refusals = await derbyAdmission(rule as never, { registry: openRegistry(":memory:"), fetchImpl: fixtureFetch(), now: NOW });
    assert.ok(refusals.some((r) => r.reason === wrapperPairProblem(SOL, JITOSOL)), JSON.stringify(refusals));
    const v = buildLaunchReview({ rule, ticker: "SOLVJITO", name: "SOL vs JITOSOL", pair: { ticker: "JITOVSOL", name: "JITOSOL vs SOL" } }, { env: { BURNTICKER_CLUSTER: "devnet", BURNTICKER_CREATOR_LAUNCHES_ENABLED: "1" }, now: NOW });
    assert.ok("review" in v, JSON.stringify(v));
    assert.ok(v.review.problems.includes(wrapperPairProblem(SOL, JITOSOL)!), v.review.problems.join("; "));
  });
});

describe("H7: the flippening's precondition at pick time", () => {
  const mint = (supplyRaw: bigint, decimals: number) => { const m = Buffer.alloc(82); m.writeBigUInt64LE(supplyRaw, 36); m[44] = decimals; return { owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", data: m }; };
  const platformWith = (wifSupply: bigint) => ({ derbyPools: fixturePort({ [WIF_MINT]: mint(wifSupply, 6), [BONK_MINT]: mint(BigInt("8800000000000000000"), 5) }), derbyFetch: fixtureFetch(), derbyHermes: null }) as unknown as Platform;
  const body = (o: Record<string, unknown> = {}) => ({ a: WIF, b: BONK, flip: true, ...o });
  const out = async (p: Platform, b: Record<string, unknown>) => { const r = await v1DerbyPairCheck(p, b, NOW); return { status: r.status, body: r.body as { ok: boolean; refusal: { code: string; reason: string } | null; swap: boolean } }; };

  test("A already larger: refused when both coins are picked, with the swap offered", async () => {
    const r = await out(platformWith(BigInt("999000000000000000")), body());
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, false);
    assert.equal(r.body.refusal?.code, "already-decided");
    assert.equal(r.body.refusal?.reason, flipAlreadyAheadSentence("WIF", "BONK"));
    assert.equal(r.body.swap, true, "the other order is a real flippening");
  });
  test("A smaller: allowed; the daily race needs no sizes; a wrapper pair is refused before anything is read", async () => {
    assert.equal((await out(platformWith(BigInt("1000000")), body())).body.ok, true);
    assert.equal((await out(platformWith(BigInt("999000000000000000")), body({ flip: false }))).body.ok, true);
    const w = await out({ derbyPools: null, derbyFetch: async () => { throw new Error("no read expected"); }, derbyHermes: null } as unknown as Platform, { a: SOL, b: JITOSOL, flip: true });
    assert.equal(w.body.ok, false); assert.equal(w.body.refusal?.code, "wrapper-pair"); assert.equal(w.body.refusal?.reason, wrapperPairProblem(SOL, JITOSOL));
  });
  test("bad input is a 400 in plain words", async () => {
    const r = await v1DerbyPairCheck(platformWith(BigInt(1)), { a: WIF }, NOW);
    assert.equal(r.status, 400);
  });
});
