// REVIEW 10 F1 (2026-10-14, P1): a single one-shot coin at 50 % with an end sink. With a 5 SOL burn pool and a 50 SOL swap reserve (a
// 1 SOL per-crank cap), the result's reading asks for 2.5 SOL, spends 1 SOL and carries 1.5 SOL. The keeper used to record the end and
// forward all 4 SOL left to $DEFICIT in the same cycle (forward_on_end clears the carried amount), so the promised 50 % never finished
// on the coin. Now the end waits until the chain shows nothing carried: with burn dispersal (crank_carried, round 5) the 1.5 SOL is
// spent in pieces first and only the 2.5 SOL left over moves; without it (round 4) nothing moves and an alert says why. The launch
// preflight refuses a single one-shot under 100 % on a host without dispersal. No network: the fake program and the NBA fakes.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import { openRegistry } from "@/lib/burnticker/registry";
import { FakeBurnProgram } from "@/lib/burnticker/program";
import { buildLaunchBundle, FakeLaunchLab } from "@/lib/burnticker/launchBundle";
import { CatalogueAdapter } from "@/lib/burnticker/catalogue";
import { runCycle, type KeeperDeps } from "@/lib/burnticker/multiKeeper";
import { DEFAULT_ON_END, lockRule, WIND_DOWN_ON_END, type BurnRule } from "@/lib/burnticker/rules";
import { nativeRule, setNativeClients } from "@/lib/burnticker/sources/native";
import { gameSeries } from "@/lib/burnticker/sources/espn";
import { DISPERSAL_STATE_KEY } from "@/lib/burnticker/dispersalKeeper";
import { ruleRefusals } from "@/lib/burnticker/launchPreflight";
import { ONE_SHOT_SHARE_REFUSAL, presetProblem, sharePresetsForRule, SHARE_PRESETS } from "@/lib/burnticker/launchPresets";
import { budgetCopy } from "@/lib/burnticker/guidedLaunch";
import type { OracleAdapter } from "@/lib/burnticker/oracle/types";
import { ATTESTER, CREATOR, FILLER, fakeDeps, game, scheduleClient, type G } from "./burntickerRivalrySeriesHelpers.ts";

const SOL = BigInt(1_000_000_000);
const Z = BigInt(0);
const stub: OracleAdapter = { id: "stub", searchSeries: async () => [], seriesInfo: async () => null, settledSince: async () => ({ events: [], awaitingFinal: 0, refusals: [], settlementSourceUrl: null }), impliedChance: async () => ({ chance: null, marketTicker: null, closeTime: null, basis: "stub" }) };
const START = "2025-11-03T23:00:00Z";
const LOSS = (id: string) => gameSeries("nba", id, "PHI", "loss");

/** One PHI-loss game coin with an end sink, the pool `poolLamports` above the reserve, the swap pool's SOL reserve 50 SOL (1 SOL cap). */
async function world(o: { fraction: number; poolLamports?: bigint; dispersal?: boolean; reserveWsol?: bigint }) {
  const registry = openRegistry(":memory:"), program = new FakeBurnProgram("devnet");
  program.autoRegisterPool = true; program.pinEndSinks = true;
  const clock = { now: Date.parse("2025-11-01T00:00:00Z") };
  program.now = () => clock.now;
  const g: G = game(START, "PHI", "BOS", 99, 110);   // BOS wins at Philadelphia: the PHI-loss rule fires
  const all = [g, ...FILLER];
  setNativeClients({ espn: scheduleClient(all, () => clock.now), games: fakeDeps(all) });
  const rule = { ...nativeRule(LOSS(g.id), { fractionOfPool: o.fraction }), onEnd: { ...DEFAULT_ON_END } } as BurnRule;
  const b = await buildLaunchBundle({ creator: CREATOR, ticker: "PHIGM", name: "76ers Game", description: "", imageUrl: null, links: [], rule, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true }, cluster: "devnet" }, { program, launchLab: new FakeLaunchLab(), devFeeWallet: null, attesters: [ATTESTER], quorum: 1, metadataUri: (m) => `https://x/${m}.json` });
  const t0 = registry.register({ mint: b.mint, ticker: "PHIGM", name: "76ers Game", creator: CREATOR, description: b.description, imageUrl: null, links: [], rulesText: b.rules.text, feePda: b.addresses.feePda, vault: b.addresses.vault, tokenConfig: b.addresses.tokenConfig, poolId: b.addresses.poolId, launchTx: null, cluster: "devnet", platformId: null, baselineAt: "2025-10-01T00:00:00Z", status: "draft" }, Date.parse("2025-10-01T00:00:00Z"));
  registry.markLaunched(t0.mint, "launchPHIGM", b.addresses.poolId, "2025-10-01T00:00:00Z");
  registry.addAttester({ mint: t0.mint, pubkey: ATTESTER, role: "data-key", addedAt: 0, timelockUntil: null });
  program.supplies.set(t0.mint, BigInt("1000000000000000"));
  const coin = program.fake(t0.mint);
  coin.poolReserveWsol = o.reserveWsol ?? BigInt(50) * SOL;          // 2 % of 50 SOL: 1 SOL per crank
  program.deposit(t0.mint, o.poolLamports ?? BigInt(5) * SOL);      // the burn pool above the reserve
  const flagship = Keypair.generate().publicKey.toBase58();
  await program.initializeToken({ mint: flagship, creator: CREATOR, ticker: "DEFICIT", rulesSha256: "ab".repeat(32), selectorKey: "flagship", mode: "buyback", attesters: [ATTESTER], quorum: 1, vault: null, rule: lockRule({ ...nativeRule("nws.high:DEN-90"), onEnd: WIND_DOWN_ON_END }).rule });
  program.fake(flagship).registerPool();
  program.endSink.flagship = flagship;
  const logs: string[] = [];
  const deps: KeeperDeps = { registry, program, oracles: { kalshi: stub, catalogue: new CatalogueAdapter() }, attester: ATTESTER, log: (l) => logs.push(l), now: () => clock.now, dryRun: false, ...(o.dispersal ? { dispersal: true } : {}) };
  const mint = t0.mint;
  const sink = program.endSink.port(mint);
  const spentOnCoin = () => coin.cfg.totalSpentLamports;
  const forwarded = async () => (await sink.ruleEnd())?.forwardedLamports ?? Z;
  /** Every cycle checks the invariant: nothing reaches the end sink before the coin spent its share. */
  const run = async (until: number, stepMs = 3 * 3600_000, dd: KeeperDeps = deps, owed: bigint | null = null) => {
    while (clock.now < until) {
      await runCycle(dd);
      if (owed !== null && (await sink.ruleEnd())) assert.equal(spentOnCoin(), owed, `the end was recorded before the share was spent (spent ${spentOnCoin()})\n${logs.slice(-6).join("\n")}`);
      clock.now += stepMs;
    }
  };
  return { registry, program, clock, mint, coin, sink, deps, logs, run, spentOnCoin, forwarded, flagship };
}
const D = (iso: string) => Date.parse(iso);

describe("review 10 F1: a 50 % one-shot finishes its share on the coin before the end sink takes the rest", () => {
  test("cap-bound, dispersal on: 2.5 SOL is spent on the coin (1 SOL by the result's crank, 1.5 SOL in carried pieces), then only 2.5 SOL moves to the end sink", async () => {
    const w = await world({ fraction: 0.5, dispersal: true });
    const half = (BigInt(5) * SOL) / BigInt(2);
    await w.run(D("2025-11-14T00:00:00Z"), 3 * 3600_000, w.deps, half);
    const ev = w.registry.receipts(w.mint).find((x) => !["winddown", "drain", "sweep"].includes(x.kind))!;
    assert.equal(ev.units, 1);
    const rd = await w.coin.reading(20251103);
    assert.deepEqual({ rule: rd?.ruleSpendLamports, spent: rd?.spentLamports, carried: rd?.carriedOutLamports }, { rule: half, spent: SOL, carried: half - SOL }, "the result's crank: 2.5 SOL asked, 1 SOL spent, 1.5 SOL carried");
    assert.equal(w.spentOnCoin(), half, "the whole 50 % was spent on the coin");
    assert.equal(w.coin.cfg.carriedSpendLamports, Z);
    assert.equal(await w.forwarded(), half, "only the 2.5 SOL left over moved to the end sink, never all 5");
    assert.equal(w.registry.token(w.mint)!.status, "retired");
    assert.ok(w.logs.some((l) => /the result's share is not fully spent yet \(1\.5 SOL still owed on this coin\)\. It is being spent in pieces/.test(l)), w.logs.join("\n"));
    assert.ok(w.logs.some((l) => /\[dispersal\] \$PHIGM: spent/.test(l)));
    assert.ok(!w.logs.some((l) => /\[dispersal\].*RuleNotLive/.test(l)), "no piece was ever sent after the end");
  });

  test("dispersal off (the round-4 program has no crank_carried): the end waits, nothing moves to the end sink and an alert says why; turning dispersal on later finishes the share, then forwards", async () => {
    const w = await world({ fraction: 0.5 });
    const flag0 = w.program.fake(w.flagship).feeLamports;
    await w.run(D("2025-11-14T00:00:00Z"));
    assert.equal(w.spentOnCoin(), SOL, "the result's crank spent its 1 SOL");
    assert.equal(w.coin.cfg.carriedSpendLamports, BigInt(15) * SOL / BigInt(10), "1.5 SOL still owed");
    assert.equal(await w.sink.ruleEnd(), null, "the end is not recorded on chain");
    assert.equal(w.program.fake(w.flagship).feeLamports, flag0, "nothing reached $DEFICIT");
    assert.equal(w.registry.token(w.mint)!.status, "live");
    assert.ok(w.registry.ruleEnd(w.mint), "the registry knows the result ended the rule");
    const alerts = w.registry.alertsSince(0).filter((a) => a.key === `${w.mint}:end-owed`);
    assert.ok(alerts.length >= 1, "the owner is told");
    assert.match(alerts[0].text, /can only be spent in pieces by burn dispersal, which is not running for this coin, so the end waits and nothing moves to the end sink/);
    // round 5 lands: the keeper is restarted with dispersal on
    const half = (BigInt(5) * SOL) / BigInt(2);
    await w.run(D("2025-11-24T00:00:00Z"), 3 * 3600_000, { ...w.deps, dispersal: true }, half);
    assert.equal(w.spentOnCoin(), half);
    assert.equal(await w.forwarded(), half);
  });

  test("restart and adoption mid-drain: another cranker spends a piece and the keeper's dispersal state is lost; the chain's carried amount still decides, and the totals hold", async () => {
    const w = await world({ fraction: 0.5, dispersal: true });
    const half = (BigInt(5) * SOL) / BigInt(2);
    // up to the result's crank and the first carried piece
    let guard = 0;
    while (w.spentOnCoin() <= SOL && guard++ < 200) { await runCycle(w.deps); w.clock.now += 20 * 60_000; }
    assert.ok(w.spentOnCoin() > SOL && w.spentOnCoin() < half, `mid-drain: ${w.spentOnCoin()}`);
    assert.equal(await w.sink.ruleEnd(), null);
    // another cranker (crank_carried is permissionless) spends a 0.1 SOL piece the keeper never sent
    const plan = await w.coin.planCarried(SOL / BigInt(10));
    assert.ok("build" in plan);
    const tx = await plan.build();
    assert.equal((await w.coin.simulate(tx.raw)).err, null);
    await w.coin.send(tx.raw);
    // the keeper restarts with no dispersal state
    w.registry.setStatus(DISPERSAL_STATE_KEY(w.mint), "", w.clock.now);
    const restarted: KeeperDeps = { ...w.deps };
    await w.run(D("2025-11-14T00:00:00Z"), 3 * 3600_000, restarted, half);
    assert.equal(w.spentOnCoin(), half);
    assert.equal(await w.forwarded(), half);
  });

  test("below the floor: a result whose share is under the floor carries nothing, so the end is not held; a remainder under the floor is still spent before the end", async () => {
    // (a) 50 % of 0.01 SOL is under the 0.0067 SOL floor: the program drops the day's spend, carries nothing, and the end goes ahead
    const a = await world({ fraction: 0.5, poolLamports: SOL / BigInt(100) });
    await a.run(D("2025-11-08T00:00:00Z"));
    assert.equal(a.spentOnCoin(), Z);
    assert.equal(a.coin.cfg.carriedSpendLamports, Z);
    assert.equal(await a.forwarded(), SOL / BigInt(100), "the pool moved to the end sink (nothing was owed)");
    // (b) 50 % of 2.0133 SOL = 1.00665 SOL: 1 SOL spent, 0.00665 SOL carried, under the floor; crank_carried takes a whole remainder under it
    const pool = BigInt(2_013_300_000), owed = pool / BigInt(2);
    const b = await world({ fraction: 0.5, poolLamports: pool, dispersal: true });
    await b.run(D("2025-11-10T00:00:00Z"), 3 * 3600_000, b.deps, owed);
    assert.equal(b.spentOnCoin(), owed);
    assert.equal(await b.forwarded(), pool - owed);
  });

  test("the 100 % control: the drain path spends all 5 SOL on the coin, one capped crank a day, and nothing is left to forward", async () => {
    const w = await world({ fraction: 1 });
    await w.run(D("2025-11-14T00:00:00Z"));
    assert.equal(w.registry.ruleEnd(w.mint)!.mode, "drain");
    assert.equal(w.spentOnCoin(), BigInt(5) * SOL);
    assert.ok(w.registry.receipts(w.mint).filter((r) => r.kind === "drain").length >= 4, "the 1 SOL cap spreads the drain over days");
    assert.equal(await w.forwarded(), Z);
    assert.equal(w.registry.token(w.mint)!.status, "retired");
  });
});

describe("review 10 F1: what the launcher offers and says", () => {
  const rule = (f: number) => lockRule({ ...nativeRule(LOSS("0022500001"), { fractionOfPool: f }), onEnd: { ...DEFAULT_ON_END } } as BurnRule);
  test("single one-shots are 100 % only until burn dispersal is on; the 50 % row is kept for a dispersal host", () => {
    assert.deepEqual(SHARE_PRESETS.oneShot, [1]);
    assert.deepEqual(SHARE_PRESETS.linkedOneShot, [1]);
    assert.deepEqual(sharePresetsForRule(rule(1).rule), [1]);
    assert.deepEqual(sharePresetsForRule(rule(1).rule, { dispersal: true }), [1, 0.5]);
    assert.deepEqual(sharePresetsForRule(rule(1).rule, { dispersal: true, linked: true }), [1], "a linked pair stays 100 %");
    assert.equal(presetProblem(rule(0.5).rule), ONE_SHOT_SHARE_REFUSAL);
    assert.equal(presetProblem(rule(0.5).rule, { dispersal: true }), null);
  });
  test("the preflight refuses a single one-shot under 100 % with an end sink unless the host runs burn dispersal", () => {
    const codes = (f: number, dispersal?: boolean) => ruleRefusals(rule(f), { dispersal }).map((r) => r.code);
    assert.ok(codes(0.5).includes("one-shot-share-needs-dispersal"));
    assert.ok(codes(0.5, false).includes("one-shot-share-needs-dispersal"));
    assert.ok(!codes(0.5, true).includes("one-shot-share-needs-dispersal"));
    assert.ok(!codes(1).includes("one-shot-share-needs-dispersal"));
    const msg = ruleRefusals(rule(0.5), {}).find((r) => r.code === "one-shot-share-needs-dispersal")!.message;
    assert.match(msg, /100%/);
  });
  test("the budget row for a share under 100 % says the share is spent on the coin before the rest moves", () => {
    const line = budgetCopy(rule(0.5).rule, 0.5, null).line;
    assert.match(line, /This coin burns 50% of its pool once, when the result is in\. The burn lands in slices sized to the pool's liquidity\./);
    assert.match(line, /The rest of the pool moves on only after this share has been spent on this coin\./);
    assert.doesNotMatch(budgetCopy(rule(1).rule, 1, null).line, /moves on only after/);
  });
});
