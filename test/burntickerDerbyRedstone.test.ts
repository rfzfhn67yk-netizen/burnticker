// BURN DERBY — RedStone as a keyless PRIMARY (coordinator follow-up, 2026-10-10): signed packages verified against RedStone's published
// redstone-primary-prod signer set; the preflight's order Pyth account → Hermes → pool TWAP → RedStone; WIF vs SHIB passing the preflight
// with no Pyth key (SHIB through RedStone, cross-read DexScreener on Ethereum); a window decided from RedStone boundary snapshots.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { redstonePrimary, REDSTONE_PRIMARY_PROD_SIGNERS, recoverRedstoneSigner } from "@/lib/burnticker/derby/redstone";
import { derbySpecProblems, type CoinVsSpec, type DerbyUnderlying } from "@/lib/burnticker/derby/spec";
import { preflightSelector } from "@/lib/burnticker/coverage/preflight";
import { searchDerbyCoins } from "@/lib/burnticker/derby/search";
import { lockRule } from "@/lib/burnticker/rules";
import { B, BONK, SHIB_FEED, WIF, WIF_FEED, coinvsRule, derbyWorld, fixtureFetch, fixturePort, fjson, seedCross } from "./burntickerDerbyHelpers.ts";

const RS = fjson("derby/redstone.latest.json").body;
const SHIB_RS: DerbyUnderlying = { symbol: "SHIB", pyth: SHIB_FEED, mint: null, pool: null, cross: "dexscreener:ethereum:0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE", redstone: "SHIB" };
const SPEC: CoinVsSpec = { selector: "coinvs", a: WIF, b: SHIB_RS, window: "daily", measure: "pct", season: { start: "2026-10-05", days: 1 }, flip: false };

describe("RedStone's signed packages", () => {
  test("every fixture package recovers to one of the five published primary-prod signers; the median of ≥ 3 verified signers is the value", async () => {
    for (const p of RS.SHIB) assert.ok(REDSTONE_PRIMARY_PROD_SIGNERS.map((a) => a.toLowerCase()).includes(String(await recoverRedstoneSigner("SHIB", p)).toLowerCase()));
    const r = await redstonePrimary(RS, "SHIB", "u");
    assert.ok(r.ok); assert.equal(r.ok && r.value, "0.00000545");
    assert.equal(r.ok && (r.proof.packages as unknown[]).length, 3); assert.equal(r.ok && r.proof.signatureVerified, true); assert.match(r.ok ? String(r.proof.packagesSha256) : "", /^[0-9a-f]{64}$/);
    // A tampered value no longer recovers to the signer: refused, never averaged in.
    const tampered = { SHIB: RS.SHIB.map((p: { dataPoints: { value: number }[] }, i: number) => (i === 0 ? { ...p, dataPoints: [{ ...p.dataPoints[0], value: 0.00001 }] } : p)) };
    const t = await redstonePrimary(tampered, "SHIB", "u");
    assert.equal(t.ok, false); assert.match(!t.ok ? t.reason : "", /2 package\(s\) of SHIB verified/);
  });

  test("the schema: a RedStone primary needs another operator as its cross-read; it keeps the canonical bytes of underlyings without it", () => {
    assert.deepEqual(derbySpecProblems(SPEC), []);
    assert.match(derbySpecProblems({ ...SPEC, b: { ...SHIB_RS, cross: "redstone:SHIB" } }).join(";"), /another operator/);
    assert.ok(!lockRule(coinvsRule({ ...SPEC, b: BONK })).text.includes("redstone"));
    assert.ok(lockRule(coinvsRule(SPEC)).text.includes('"redstone": "SHIB"'));
  });
});

describe("the preflight and the keeper", () => {
  test("WIF vs SHIB passes the creation preflight with NO Pyth key: WIF from Pyth's Solana account, SHIB from RedStone (cross-read DexScreener on Ethereum)", async () => {
    const r = await preflightSelector(coinvsRule(SPEC), { now: Date.UTC(2026, 9, 10, 22, 20), derby: { pools: fixturePort(), fetchImpl: fixtureFetch(), hermes: null } });
    assert.equal(r.ok, true, JSON.stringify(r.refusal));
    assert.match(r.agreementBasis, /WIF: pyth:4ca4beeca86f .* · SHIB: redstone:SHIB 0\.00000545 vs dexscreener\.pairs:ethereum:0x95aD/);
    // RedStone packages two days old are stale: refused, never used.
    const stale = await preflightSelector(coinvsRule(SPEC), { now: Date.UTC(2026, 9, 12, 22, 20), derby: { pools: fixturePort(), fetchImpl: fixtureFetch(), hermes: null } });
    assert.equal(stale.ok, false);
  });

  test("a window decided from RedStone boundary snapshots; the sampler refuses packages that were not signed at the boundary", async () => {
    const w = await derbyWorld(SPEC, { hermes: null });
    const pyth = (b: number, v: string) => w.adapter.store.putSample({ key: `pyth:${WIF_FEED}`, kind: "pyth", ts: b + 60_000, slot: 1, value: v, detail: { source: "pyth-solana", publishTime: b / 1000 + 10 } });
    const rs = (b: number, v: string) => w.adapter.store.putSample({ key: "redstone:SHIB", kind: "redstone", ts: b + 60_000, slot: null, value: v, detail: { source: "redstone", route: "redstone", signatureVerified: true, packagesSha256: "ab".repeat(32) } });
    pyth(B(5), "0.2"); pyth(B(6), "0.21"); rs(B(5), "0.0000055"); rs(B(6), "0.00000561");
    seedCross(w, WIF, B(5), "0.2"); seedCross(w, WIF, B(6), "0.21"); seedCross(w, SHIB_RS, B(5), "0.0000055"); seedCross(w, SHIB_RS, B(6), "0.0000056");
    w.clock.now = B(6) + 3600_000;
    const r = await w.adapter.settledSince(w.registry.lockedRule(w.a).rule, null);
    assert.equal(r.events.length, 1, JSON.stringify(r.refusals)); assert.equal(r.events[0].result, "yes", "WIF +5% vs SHIB +2%");
    const doc = w.adapter.store.windows(w.a.selectorKey)[0].proof as { b: { source: string; proof: { end: { route: string } } } };
    assert.equal(doc.b.source, "redstone"); assert.equal(doc.b.proof.end.route, "redstone");
    // The fixture's packages were signed on 10-10 at 22:12 UTC: five minutes after the 10-11 boundary they are stale → no snapshot.
    w.clock.now = B(11) + 5 * 60_000;
    const s = await w.adapter.sample([w.registry.token(w.a.mint)!]);
    assert.ok(s.errors.some((e) => /not at the 2026-10-11T00:00:00.000Z boundary/.test(e)), s.errors.join("\n"));
  });

  test("the wizard's search suggests the RedStone primary for SHIB (no Solana mint, a curated home-chain contract)", async () => {
    const hits = await searchDerbyCoins("shib", { fetchImpl: fixtureFetch() });
    const h = hits.find((x) => x.symbol === "SHIB" && x.source === "pyth")!;
    assert.deepEqual(h.underlying, { symbol: "SHIB", pyth: SHIB_FEED, mint: null, pool: null, cross: "dexscreener:ethereum:0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE", redstone: "SHIB" });
  });
});
