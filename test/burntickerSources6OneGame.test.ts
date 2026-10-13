// sources-6, QA pass 9 #3 (owner decision 2026-10-12: one-shots default to 100 %): a single-game team coin is a one-shot in the rule model
// and the keeper. The result that fires its rule drains the whole budget; a result that does not fire it ends the rule without a burn; a
// postponed game waits; a cancelled game ends void. No network: the NBA schedule and the game market are fakes (rivalry-series helpers).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import { openRegistry } from "@/lib/burnticker/registry";
import { FakeBurnProgram } from "@/lib/burnticker/program";
import { buildLaunchBundle, FakeLaunchLab } from "@/lib/burnticker/launchBundle";
import { CatalogueAdapter } from "@/lib/burnticker/catalogue";
import { runCycle, type KeeperDeps } from "@/lib/burnticker/multiKeeper";
import { DEFAULT_ON_END, isOneShot, lockRule, validateRule, WIND_DOWN_ON_END, type BurnRule } from "@/lib/burnticker/rules";
import { nativeRule, setNativeClients } from "@/lib/burnticker/sources/native";
import { gameSeries } from "@/lib/burnticker/sources/espn";
import { dialsFor } from "@/lib/burnticker/dials";
import { DEFAULT_SHARE, SHARE_PRESETS } from "@/lib/burnticker/launchPresets";
import type { OracleAdapter } from "@/lib/burnticker/oracle/types";
import { ATTESTER, CREATOR, FILLER, fakeDeps, game, scheduleClient, type G } from "./burntickerRivalrySeriesHelpers.ts";

const stub: OracleAdapter = { id: "stub", searchSeries: async () => [], seriesInfo: async () => null, settledSince: async () => ({ events: [], awaitingFinal: 0, refusals: [], settlementSourceUrl: null }), impliedChance: async () => ({ chance: null, marketTicker: null, closeTime: null, basis: "stub" }) };
const START = "2025-11-03T23:00:00Z";

async function world(g: G, ruleSeries: (id: string) => string, fraction = 1) {
  const registry = openRegistry(":memory:"), program = new FakeBurnProgram("devnet");
  program.autoRegisterPool = true; program.pinEndSinks = true;
  const clock = { now: Date.parse("2025-11-01T00:00:00Z") };
  program.now = () => clock.now;
  const all = [g, ...FILLER];
  setNativeClients({ espn: scheduleClient(all, () => clock.now), games: fakeDeps(all) });
  const rule = { ...nativeRule(ruleSeries(g.id), { fractionOfPool: fraction }), onEnd: { ...DEFAULT_ON_END } } as BurnRule;
  const b = await buildLaunchBundle({ creator: CREATOR, ticker: "PHIGM", name: "76ers Game", description: "", imageUrl: null, links: [], rule, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true }, cluster: "devnet" }, { program, launchLab: new FakeLaunchLab(), devFeeWallet: null, attesters: [ATTESTER], quorum: 1, metadataUri: (m) => `https://x/${m}.json` });
  const t0 = registry.register({ mint: b.mint, ticker: "PHIGM", name: "76ers Game", creator: CREATOR, description: b.description, imageUrl: null, links: [], rulesText: b.rules.text, feePda: b.addresses.feePda, vault: b.addresses.vault, tokenConfig: b.addresses.tokenConfig, poolId: b.addresses.poolId, launchTx: null, cluster: "devnet", platformId: null, baselineAt: "2025-10-01T00:00:00Z", status: "draft" }, Date.parse("2025-10-01T00:00:00Z"));
  registry.markLaunched(t0.mint, "launchPHIGM", b.addresses.poolId, "2025-10-01T00:00:00Z");
  registry.addAttester({ mint: t0.mint, pubkey: ATTESTER, role: "data-key", addedAt: 0, timelockUntil: null });
  program.supplies.set(t0.mint, BigInt("1000000000000000"));
  if (program.tokens.has(t0.mint)) program.deposit(t0.mint, BigInt(5_000_000_000));
  const flagship = Keypair.generate().publicKey.toBase58();
  await program.initializeToken({ mint: flagship, creator: CREATOR, ticker: "DEFICIT", rulesSha256: "ab".repeat(32), selectorKey: "flagship", mode: "buyback", attesters: [ATTESTER], quorum: 1, vault: null, rule: lockRule({ ...nativeRule("nws.high:DEN-90"), onEnd: WIND_DOWN_ON_END }).rule });
  program.fake(flagship).registerPool();
  program.endSink.flagship = flagship;
  const logs: string[] = [];
  const deps: KeeperDeps = { registry, program, oracles: { kalshi: stub, catalogue: new CatalogueAdapter() }, attester: ATTESTER, log: (l) => logs.push(l), now: () => clock.now, dryRun: false };
  const run = async (until: number) => { while (clock.now < until) { await runCycle(deps); clock.now += 3 * 3600_000; } };
  return { registry, program, clock, mint: t0.mint, run, logs };
}

describe("QA pass 9 #3: a single game is a one-shot", () => {
  test("the rule model: one-shot, 100 % allowed, presets 100 / 50 with 100 the default", () => {
    const r = nativeRule(gameSeries("nba", "0022500001", "PHI", "loss"), { fractionOfPool: 1 });
    assert.equal(isOneShot(r), true);
    assert.doesNotThrow(() => validateRule(r));
    assert.equal(dialsFor(r).bounds.max, 1);
    assert.deepEqual(SHARE_PRESETS.oneShot, [1, 0.5]); assert.equal(DEFAULT_SHARE.oneShot, 1);
  });
  test("the result fires the rule: the whole budget burns (a drain), then the end", async () => {
    // BOS beats PHI at Philadelphia: the PHI-loss coin's rule fires
    const w = await world(game(START, "PHI", "BOS", 99, 110), (id) => gameSeries("nba", id, "PHI", "loss"));
    await w.run(Date.parse("2025-11-14T00:00:00Z"));
    const rs = w.registry.receipts(w.mint);
    const ev = rs.find((x) => !["winddown", "drain", "sweep"].includes(x.kind))!;
    assert.ok(ev && ev.units > 0, JSON.stringify(rs.map((x) => [x.kind, x.eventId, x.units, x.status])));
    assert.equal(ev.mapping?.fractionOfPool, 1);
    const end = w.registry.ruleEnd(w.mint)!;
    assert.equal(end.mode, "drain", end.reason);
    assert.match(end.reason, /one-shot settled .* at 100 % of the pool/);
    // the fake program spends the whole pool in that one burn, so nothing carries over: the drain is done at once, the coin retires and its
    // end is recorded on chain as resolved (a larger pool adds one drain day at a time while the burn-run cap carries spend)
    assert.equal(w.registry.token(w.mint)!.status, "retired");
    assert.ok(w.logs.some((l) => /rule end \(resolved, 2025-11-03\) recorded on chain/.test(l)), w.logs.slice(-6).join("\n"));
  });
  test("the result does not fire the rule: the rule ends without a burn and the rest goes to the end sink", async () => {
    const w = await world(game(START, "PHI", "BOS", 120, 100), (id) => gameSeries("nba", id, "PHI", "loss"));
    await w.run(Date.parse("2025-11-08T00:00:00Z"));
    const end = w.registry.ruleEnd(w.mint);
    assert.ok(end, w.logs.slice(-12).join("\n"));
    assert.notEqual(end!.mode, "drain");
    assert.ok(!w.registry.receipts(w.mint).some((x) => x.kind === "drain"));
  });
  test("a postponed game waits; a cancelled game ends void", async () => {
    const p = await world(game(START, "PHI", "BOS", null, null, { status: 1, text: "Postponed" }), (id) => gameSeries("nba", id, "PHI", "loss"));
    await p.run(Date.parse("2025-11-12T00:00:00Z"));
    assert.equal(p.registry.ruleEnd(p.mint), null, "a postponed game keeps the coin open");
    const c = await world(game(START, "PHI", "BOS", null, null, { status: 1, text: "Cancelled" }), (id) => gameSeries("nba", id, "PHI", "loss"));
    await c.run(Date.parse("2025-11-12T00:00:00Z"));
    const end = c.registry.ruleEnd(c.mint);
    assert.ok(end && /void/.test(end.reason), end?.reason ?? c.logs.slice(-8).join("\n"));
    assert.ok(!c.registry.receipts(c.mint).some((x) => x.kind === "drain"));
  });
});
