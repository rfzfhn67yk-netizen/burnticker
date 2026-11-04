// HB-164 FOLLOW-UP (2026-10-20): the first snow's end, pinned across the whole matrix the Codex auditor asked for (fractions 2%, 50%,
// 100%; carried spend 0 and 1,000,000 lamports (since the owner decision of 2026-10-25 the program spends a crank's whole target in one
// run, so a carry after a burn exists only on a reading processed by the earlier program: the matrix keeps it as that legacy case); burn dispersal off and on; a void reading; an already-ended rule; readings in both
// orders). The matrix pins publish 102's end for a share under 100% and the HB-147 drain at 100% for coins drafted before
// FIRST_SNOW_HOLD_FROM_MS; reviewer F (publishes 102-105) adds the hold for coins drafted after it (its own describe below). Driven by runCycle on the same fake world as test/burntickerHourlyRun15.test.ts, with owedBeforeEnd and
// detectRuleEnd called directly where that is simpler.
//
// Note on the auditor's fixture (docs/burnticker/audits/continuous/2026-10-20T1130Z/snow-hold.test.mjs): its "spending enabled"
// control (2%, carry 1,000,000, dispersal on) expects a hold with canSpend true. That is not publish 102: a first snow is not a
// one-shot (rules.ts isOneShot excludes nws.snow; the keeper ends it in detectRuleEnd's own branch), so owedBeforeEnd never holds it,
// with dispersal on or off. The matrix below pins null for that case.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Keypair } from "@solana/web3.js";
import { openRegistry } from "@/lib/burnticker/registry";
import { FakeBurnProgram } from "@/lib/burnticker/program";
import { buildLaunchBundle, FakeLaunchLab } from "@/lib/burnticker/launchBundle";
import { CatalogueAdapter } from "@/lib/burnticker/catalogue";
import { detectRuleEnd, FIRST_SNOW_HOLD_FROM_MS, owedBeforeEnd, runCycle, type KeeperDeps } from "@/lib/burnticker/multiKeeper";
import { DEFAULT_ON_END, isOneShot, lockRule, WIND_DOWN_ON_END, type BurnRule } from "@/lib/burnticker/rules";
import { nativeRule } from "@/lib/burnticker/sources/native";
import { nwsSeries } from "@/lib/burnticker/sources/nws";
import type { OracleAdapter } from "@/lib/burnticker/oracle/types";
import type { FakeProgram } from "@/lib/burnKeeper/fakeProgram";
import { ATTESTER, CREATOR } from "./burntickerRivalrySeriesHelpers.ts";

const SOL = BigInt(1_000_000_000);
const Z = BigInt(0);
const POOL = BigInt(5) * SOL;
const CARRY = BigInt(1_000_000);
const H = 3600_000;
const D = (iso: string) => Date.parse(iso);
const stub: OracleAdapter = { id: "stub", searchSeries: async () => [], seriesInfo: async () => null, settledSince: async () => ({ events: [], awaitingFinal: 0, refusals: [], settlementSourceUrl: null }), impliedChance: async () => ({ chance: null, marketTicker: null, closeTime: null, basis: "stub" }) };

type Day = [string, "0" | "1" | "void"];

/**
 * A carry of exactly `carry` lamports on the first burned crank, as a reading processed by the program before 2026-10-25 (its per-run
 * 2 % bound) left it: the crank spent `carry` less than its target and carried that remainder. The current program never does this
 * (it spends the whole target in one run), so the test sets it on the fake after that one crank lands; every later step is the current
 * program's. Carry 0: nothing is changed.
 */
function legacyCarry(coin: FakeProgram, carry: bigint): void {
  if (carry === Z) return;
  const land = coin.land.bind(coin);
  let done = false;
  coin.land = (sig: string) => {
    const before = coin.cfg.totalSpentLamports;
    land(sig);
    const l = coin.landed.get(sig);
    if (done || !l || l.err || l.payload.kind !== "crank" || coin.cfg.totalSpentLamports - before <= carry) return;
    done = true;
    const rd = coin.readings.get(l.payload.recordDate)!;
    coin.readings.set(rd.recordDate, { ...rd, spentLamports: rd.spentLamports - carry, carriedOutLamports: carry });
    coin.cfg = { ...coin.cfg, totalSpentLamports: coin.cfg.totalSpentLamports - carry, carriedSpendLamports: carry };
    coin.feeLamports += carry;
  };
}

/** One Denver first-snow coin with an end sink ($DEFICIT); a 5 SOL burn pool; the first burned crank carries `carry` (legacyCarry). */
async function snowWorld(o: { fraction: number; carry: bigint; dispersal: boolean; /** reviewer F: a coin drafted after FIRST_SNOW_HOLD_FROM_MS */ held?: boolean }) {
  const registry = openRegistry(":memory:"), program = new FakeBurnProgram("devnet");
  program.autoRegisterPool = true; program.pinEndSinks = true;
  const clock = { now: D("2025-10-20T00:00:00Z") };
  program.now = () => clock.now;
  const rule = { ...nativeRule(nwsSeries("snow", "DEN"), { fractionOfPool: o.fraction }), onEnd: { ...DEFAULT_ON_END } } as BurnRule;
  const b = await buildLaunchBundle({ creator: CREATOR, ticker: "DENSNOW", name: "Denver First Snow", description: "", imageUrl: null, links: [], rule, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true }, cluster: "devnet" }, { program, launchLab: new FakeLaunchLab(), devFeeWallet: null, attesters: [ATTESTER], quorum: 1, metadataUri: (m) => `https://x/${m}.json` });
  const t0 = registry.register({ mint: b.mint, ticker: "DENSNOW", name: "Denver First Snow", creator: CREATOR, description: b.description, imageUrl: null, links: [], rulesText: b.rules.text, feePda: b.addresses.feePda, vault: b.addresses.vault, tokenConfig: b.addresses.tokenConfig, poolId: b.addresses.poolId, launchTx: null, cluster: "devnet", platformId: null, baselineAt: "2025-10-01T00:00:00Z", status: "draft" }, D("2025-10-01T00:00:00Z"));
  registry.markLaunched(t0.mint, "launchDENSNOW", b.addresses.poolId, "2025-10-01T00:00:00Z");
  registry.addAttester({ mint: t0.mint, pubkey: ATTESTER, role: "data-key", addedAt: 0, timelockUntil: null });
  program.supplies.set(t0.mint, BigInt("1000000000000000"));
  const coin = program.fake(t0.mint);
  coin.poolReserveWsol = BigInt(1_000) * SOL;
  legacyCarry(coin, o.carry);
  program.deposit(t0.mint, POOL);
  const flagship = Keypair.generate().publicKey.toBase58();
  await program.initializeToken({ mint: flagship, creator: CREATOR, ticker: "DEFICIT", rulesSha256: "ab".repeat(32), selectorKey: "flagship", mode: "buyback", attesters: [ATTESTER], quorum: 1, vault: null, rule: lockRule({ ...nativeRule("nws.high:DEN-90"), onEnd: WIND_DOWN_ON_END }).rule });
  program.fake(flagship).registerPool();
  program.endSink.flagship = flagship;
  const sinkCoin = program.fake(flagship);
  const held = (f: { feeLamports: bigint; wsol: bigint; strayWsolLamports: bigint }) => f.feeLamports + f.wsol + f.strayWsolLamports;
  const startCoin = held(coin), startSink = held(sinkCoin);
  const logs: string[] = [];
  const deps: KeeperDeps = { registry, program, oracles: { kalshi: stub, catalogue: new CatalogueAdapter() }, attester: ATTESTER, log: (l) => logs.push(l), now: () => clock.now, dryRun: false, ...(o.dispersal ? { dispersal: true } : {}), ...(o.held ? { firstSnowHoldFromMs: 0 } : {}) };
  const key = registry.token(t0.mint)!.selectorKey;
  const readings = (days: Day[]) => registry.putReadings("catalogue", key, days.map(([id, v]) => ({ id, at: id, result: v === "void" ? "void" : null, value: v === "void" ? null : v, title: `Denver ${id}`, sourceUrl: "https://api.weather.gov/x", method: "nws-cli-final+iem" }) as never), { settlementSourceUrl: null, attestedBy: [ATTESTER] }, clock.now);
  const sink = program.endSink.port(t0.mint);
  /** Every owedBeforeEnd answer the keeper could have got, asked after each cycle while the coin is live (the hold check). */
  const holds: unknown[] = [];
  const probe = async () => {
    const t = registry.token(t0.mint)!;
    const locked = registry.lockedRule(t);
    const end = detectRuleEnd({ ...deps, dryRun: true }, t, locked, null);
    if (end) { const o2 = await owedBeforeEnd(deps, t, locked, null, end); if (o2) holds.push(o2); }
  };
  const run = async (until: number, stepMs = 3 * H) => { while (clock.now < until) { await runCycle(deps, { fetch: false }); await probe(); clock.now += stepMs; } };
  return {
    registry, program, clock, mint: t0.mint, coin, sink, deps, logs, run, readings, holds,
    /** initial = burns (spent on the coin) + forwarded to the end sink + kept on the coin; the sink received exactly what was forwarded. */
    ledger: async () => {
      const re = await sink.ruleEnd();
      const forwarded = re?.forwardedLamports ?? Z;
      return { start: startCoin, spent: coin.cfg.totalSpentLamports, forwarded, kept: held(coin), sinkGot: held(sinkCoin) - startSink + sinkCoin.cfg.totalSpentLamports, endOnChain: re !== null, carried: coin.cfg.carriedSpendLamports, reserve: coin.cfg.reserveLamports };
    },
  };
}

type World = Awaited<ReturnType<typeof snowWorld>>;
const firstSnowCarry = (w: World) => w.registry.receipts(w.mint).find((r) => r.kind !== "drain" && r.kind !== "winddown" && r.kind !== "sweep" && r.units > 0)?.carriedOutLamports ?? null;

async function conserved(w: World, label: string) {
  const l = await w.ledger();
  assert.equal(l.spent + l.forwarded + l.kept, l.start, `${label}: no lamport created or lost (spent ${l.spent} + forwarded ${l.forwarded} + kept ${l.kept} vs start ${l.start})`);
  assert.equal(l.sinkGot, l.forwarded, `${label}: the end sink received exactly what was forwarded`);
  return l;
}

const ORDERS: { name: string; days: Day[] }[] = [
  { name: "zero day first", days: [["2025-11-01", "0"], ["2025-11-03", "1"]] },
  { name: "snow day first", days: [["2025-11-03", "1"], ["2025-11-04", "0"]] },
];
const HORIZON = D("2026-01-15T00:00:00Z");

describe("HB-164 matrix: fraction x carried spend x dispersal x reading order (runCycle)", () => {
  for (const fraction of [0.02, 0.5, 1]) for (const carry of [Z, CARRY]) for (const dispersal of [false, true]) for (const order of ORDERS) {
    const pct = `${fraction * 100}%`;
    test(`${pct}, carry ${carry}, dispersal ${dispersal ? "on" : "off"}, ${order.name}`, async () => {
      const w = await snowWorld({ fraction, carry, dispersal });
      w.readings(order.days);
      await w.run(D("2025-11-20T00:00:00Z"));
      await w.run(HORIZON, 12 * H);
      const tail = w.logs.slice(-12).join("\n");
      const t = w.registry.token(w.mint)!;
      const locked = w.registry.lockedRule(t);
      assert.equal(isOneShot(locked.rule), false, "a first snow is not a one-shot");
      // the first snow's crank carried exactly the legacy carry (carry 0: the whole share in one crank, nothing carried)
      assert.equal(firstSnowCarry(w), carry, `the first snow's crank carried ${carry}\n${tail}`);
      // held: never, at any cycle
      assert.deepEqual(w.holds, [], "owedBeforeEnd never holds a first snow");
      assert.ok(!w.logs.some((l) => /not fully spent yet/.test(l)), "no hold line");
      assert.equal(w.registry.alertsSince(0).filter((a) => a.key === `${w.mint}:end-owed`).length, 0, "no end-owed alert");
      // end mode
      const end = w.registry.ruleEnd(w.mint);
      assert.ok(end, `the rule ended\n${tail}`);
      assert.equal(end.mode, fraction >= 1 ? "drain" : "winddown", tail);
      assert.equal(end.reason, `the first snow of the season fell (2025-11-03)${fraction >= 1 ? " at 100 % of the pool" : ""}`);
      assert.deepEqual(detectRuleEnd(w.deps, t, locked, null), end, "detectRuleEnd returns the recorded end");
      // end sink: the end is recorded on chain in every case; the ledger closes to the lamport
      const l = await conserved(w, "matrix");
      assert.equal(l.endOnChain, true, `the end is recorded on the end sink\n${tail}`);
      assert.equal(t.status, "retired");
      const share = (POOL * BigInt(Math.round(fraction * 10_000))) / BigInt(10_000);
      const strand = !dispersal && carry > Z;
      if (fraction >= 1) {
        // 100%: the whole pool burns on the coin. With dispersal off and a carry the next day's drain crank falls under the floor
        // (drain-<date> skipped) and the drain is done; the carry left in the pool then moves to the end sink with the trickle.
        assert.equal(l.spent, strand ? POOL - carry : POOL, `burned on the coin\n${tail}`);
        assert.equal(l.forwarded, strand ? carry : Z, "forwarded to the end sink");
        assert.equal(l.kept, l.reserve, "the coin keeps only its rent reserve");
        assert.equal(l.carried, Z);
      } else {
        // under 100%: the share burns on the coin and the rest reaches the end sink on the resolved end. With dispersal on the carry is
        // spent on the coin by crank_carried. With dispersal off the round-5 end path holds the carry back on the coin; at 1,000,000
        // lamports it stays there (carried, never spent) past the 30-day grace, because it is under the end sink's minimum forward.
        assert.equal(l.forwarded, POOL - share, "the rest reached the end sink");
        assert.equal(l.spent, strand ? share - carry : share, `burned on the coin\n${tail}`);
        assert.equal(l.kept, strand ? l.reserve + carry : l.reserve, "kept on the coin");
        assert.equal(l.carried, strand ? carry : Z, "left carried on the coin");
      }
    });
  }
});

describe("HB-164 matrix: void readings and an already-ended rule (runCycle)", () => {
  for (const fraction of [0.02, 1]) for (const dispersal of [false, true]) {
    const pct = `${fraction * 100}%`;
    test(`${pct}, dispersal ${dispersal ? "on" : "off"}: a void reading on 11-03 is not the first snow; the 11-05 snow is`, async () => {
      const w = await snowWorld({ fraction, carry: CARRY, dispersal });
      w.readings([["2025-11-03", "void"], ["2025-11-05", "1"]]);
      await w.run(D("2025-11-20T00:00:00Z"));
      await w.run(HORIZON, 12 * H);
      const end = w.registry.ruleEnd(w.mint);
      assert.equal(end?.mode, fraction >= 1 ? "drain" : "winddown", w.logs.slice(-10).join("\n"));
      assert.equal(end?.reason, `the first snow of the season fell (2025-11-05)${fraction >= 1 ? " at 100 % of the pool" : ""}`);
      assert.deepEqual(w.holds, []);
      const l = await conserved(w, "void then snow");
      assert.equal(l.endOnChain, true);
      // the same split as the matrix row at this fraction with carry 1,000,000 (dispersal off strands or forwards the carry)
      const share = (POOL * BigInt(Math.round(fraction * 10_000))) / BigInt(10_000);
      if (fraction >= 1) {
        assert.equal(l.spent, dispersal ? POOL : POOL - CARRY);
        assert.equal(l.forwarded, dispersal ? Z : CARRY);
        assert.equal(l.kept, l.reserve);
      } else {
        assert.equal(l.forwarded, POOL - share);
        assert.equal(l.spent, dispersal ? share : share - CARRY);
        assert.equal(l.kept, dispersal ? l.reserve : l.reserve + CARRY);
      }
    });
    test(`${pct}, dispersal ${dispersal ? "on" : "off"}: a void reading alone does not end it; the season void does (a wind-down on the coin)`, async () => {
      const w = await snowWorld({ fraction, carry: CARRY, dispersal });
      w.readings([["2025-11-03", "void"], ["2025-11-04", "0"]]);
      await w.run(D("2025-11-20T00:00:00Z"));
      assert.equal(w.registry.ruleEnd(w.mint), null, "a void reading is not the result");
      assert.equal(w.coin.cfg.totalSpentLamports, Z, "nothing spent");
      w.clock.now = D("2026-07-02T23:00:00Z");
      await w.run(D("2026-07-03T00:00:00Z"));
      assert.equal(w.registry.ruleEnd(w.mint), null, "the June 30 report is still being read");
      await w.run(D("2026-09-15T00:00:00Z"), 12 * H);
      const end = w.registry.ruleEnd(w.mint);
      assert.equal(end?.mode, "winddown", "a void ends in a wind-down at every fraction");
      assert.match(end!.reason, /^void: the snow season ended on 2026-06-30 with no first snow after launch$/);
      assert.deepEqual(w.holds, []);
      const l = await conserved(w, "season void");
      assert.equal(l.endOnChain, true, "the void end is recorded on the end sink");
      assert.equal(l.forwarded, Z, "a void winds down on the coin; nothing moves to the end sink");
      assert.equal(l.spent + l.kept, l.start);
      assert.ok(w.registry.receipts(w.mint).some((r) => r.kind === "winddown"), "wind-down receipts");
    });
    test(`${pct}, dispersal ${dispersal ? "on" : "off"}: an already-ended rule keeps its recorded end; the snow does not change it`, async () => {
      const w = await snowWorld({ fraction, carry: CARRY, dispersal });
      const marked = w.registry.markRuleEnded(w.mint, "winddown", "the adapter marked the rule ended", D("2025-10-25T00:00:00Z"));
      w.readings([["2025-11-03", "1"]]);
      await w.run(D("2025-11-20T00:00:00Z"));
      await w.run(HORIZON, 12 * H);
      const t = w.registry.token(w.mint)!;
      const locked = w.registry.lockedRule(t);
      assert.deepEqual(w.registry.ruleEnd(w.mint), marked);
      assert.deepEqual(detectRuleEnd(w.deps, t, locked, null), marked, "detectRuleEnd returns the recorded end (ruleEnd non-null)");
      assert.equal(await owedBeforeEnd(w.deps, t, locked, null, marked), null);
      assert.deepEqual(w.holds, []);
      const l = await conserved(w, "already ended");
      assert.equal(l.endOnChain, true);
      assert.equal(l.kept, l.reserve);
    });
  }
});

describe("HB-164: owedBeforeEnd called directly right after the first snow's crank (the auditor's controls on the real fake)", () => {
  for (const fraction of [0.02, 0.5, 1]) for (const carry of [Z, CARRY]) for (const dispersal of [false, true]) {
    test(`${fraction * 100}%, carry ${carry}, dispersal ${dispersal ? "on" : "off"}: null`, async () => {
      const w = await snowWorld({ fraction, carry, dispersal });
      w.readings([["2025-11-03", "1"]]);
      // one cycle at a time until the first snow's crank lands, then ask before the end is recorded on chain
      let guard = 0;
      while (firstSnowCarry(w) === null && guard++ < 400) { await runCycle({ ...w.deps }, { fetch: false }); w.clock.now += 3 * H; }
      assert.equal(firstSnowCarry(w), carry);
      const t = w.registry.token(w.mint)!;
      const locked = w.registry.lockedRule(t);
      for (const mode of ["winddown", "drain"] as const) {
        assert.equal(await owedBeforeEnd(w.deps, t, locked, null, { mode, reason: "the first snow of the season fell (2025-11-03)", at: D("2025-11-03T00:00:00Z") }), null, `${mode}: a first snow is never held`);
      }
    });
  }
  // The auditor's controls on minimal ports: the sink has no end on chain yet, the chain shows a carry, so only the rule decides.
  for (const [label, fraction, mode, carry, dispersal, ended] of [
    ["2% legacy, dispersal off", 0.02, "winddown", CARRY, false, false],
    ["100% drain", 1, "drain", CARRY, false, false],
    ["no carry", 0.02, "winddown", Z, false, false],
    ["already ended on chain", 0.02, "winddown", CARRY, false, true],
    ["spending enabled (2%, carry 1,000,000, dispersal on): publish 102 does not hold it either", 0.02, "winddown", CARRY, true, false],
    ["50%, carry 1,000,000, dispersal on", 0.5, "winddown", CARRY, true, false],
  ] as const) {
    test(`minimal ports: ${label}: null`, async () => {
      const locked = lockRule({ ...nativeRule(nwsSeries("snow", "DEN"), { fractionOfPool: fraction }), onEnd: DEFAULT_ON_END });
      const receipt = { kind: "up", status: "confirmed", units: 1, mapping: { fractionOfPool: fraction }, readingDate: 20261103 };
      const deps = { registry: { receipts: () => [receipt] }, program: { endSink: { port: () => ({ endSink: async () => ({}), ruleEnd: async () => (ended ? {} : null) }) }, port: () => ({ config: async () => ({ carriedSpendLamports: carry, burnsTarget: false }), planCarried: () => { throw new Error("not called"); } }) }, dispersal } as unknown as KeeperDeps;
      assert.equal(await owedBeforeEnd(deps, { mint: "LOCAL_FIXTURE", status: "live" } as never, locked, null, { mode, reason: "first snow fell", at: 0 }), null);
    });
  }
});

describe("HB-164: a carry above the end sink's minimum forward, dispersal off, leaves the coin after the round-5 grace", () => {
  test("50%, carry 0.1 SOL, dispersal off: held on the coin for 30 days, then forwarded with nothing left carried", async () => {
    const carry = BigInt(100_000_000);
    const w = await snowWorld({ fraction: 0.5, carry, dispersal: false });
    w.readings([["2025-11-03", "1"]]);
    await w.run(D("2025-11-20T00:00:00Z"));
    const mid = await w.ledger();
    assert.equal(mid.carried, carry, "held back on the coin inside the grace");
    assert.equal(mid.kept, mid.reserve + carry);
    await w.run(HORIZON, 12 * H);
    assert.deepEqual(w.holds, []);
    const l = await conserved(w, "big carry");
    assert.equal(l.carried, Z);
    assert.equal(l.spent, POOL / BigInt(2) - carry, "the carry was not burned on the coin");
    assert.equal(l.forwarded, POOL / BigInt(2) + carry, "the carry went to the end sink after the grace");
    assert.equal(l.kept, l.reserve);
  });
});

// owedBeforeEnd exactly as it was before cf36eb4c (publish 102), from `git show cf36eb4c^:src/lib/burnticker/multiKeeper.ts`.
const OWED_BEFORE_END_PUBLISH_102 = `export async function owedBeforeEnd(d: KeeperDeps, t: TokenRow, locked: LockedRule, gate: PairGate | null, end: { mode: "drain" | "winddown"; reason: string; at: number }): Promise<{ owedLamports: bigint; canSpend: boolean; readingDate: number | null } | null> {
  const rule = locked.rule;
  if (end.mode !== "winddown" || t.status === "retired" || locked.mode !== "buyback" || !isOneShot(rule) || !endSinkOf(rule) || !d.program.endSink) return null;
  const ev = d.registry.receipts(t.mint).filter((b) => !END_KINDS.has(b.kind) && b.status !== "pending-pair")[0];
  const f = ev?.mapping?.fractionOfPool ?? 0;
  if (!ev || !(ev.units > 0) || ev.status === "voided" || !(f > 0 && f < 1) || ev.pairRole === "lost") return null;
  const sinkPort = d.program.endSink.port(t.mint);
  if (!(await sinkPort.endSink())) return null;
  if (await sinkPort.ruleEnd()) return null;
  if (endOutcomeOf(d.registry, t, locked, gate, end) !== "resolved") return null;
  const port = d.program.port(t.mint);
  const cfg = await port.config();
  if (!cfg || cfg.carriedSpendLamports <= BigInt(0)) return null;
  return { owedLamports: cfg.carriedSpendLamports, canSpend: !!d.dispersal && typeof port.planCarried === "function" && !cfg.burnsTarget, readingDate: ev.readingDate ?? null };
}`;

describe("reviewer F: a first snow drafted after the pin finishes its share on the coin before the end sink takes the rest", () => {
  for (const fraction of [0.02, 0.5]) for (const dispersal of [false, true]) {
    test(`${fraction * 100}%, carry ${CARRY}, dispersal ${dispersal ? "on" : "off"}`, async () => {
      const w = await snowWorld({ fraction, carry: CARRY, dispersal, held: true });
      w.readings([["2025-11-01", "0"], ["2025-11-03", "1"]]);
      await w.run(D("2025-11-20T00:00:00Z"));
      await w.run(HORIZON, 12 * H);
      const tail = w.logs.slice(-12).join("\n");
      const share = (POOL * BigInt(Math.round(fraction * 10_000))) / BigInt(10_000);
      // with dispersal off the end is held while the share is carried; with dispersal on the one carried piece (the whole carry, no
      // per-run bound) lands in the same cycle as the crank, before the end step looks, so there may be no cycle that sees a hold
      if (!dispersal) assert.ok(w.holds.length > 0, `held while the share is carried\n${tail}`);
      else assert.ok(w.logs.some((l) => /\[dispersal\] \$DENSNOW: spent 0\.0010 SOL of the carried amount \(one piece/.test(l)), `the carry went in one piece\n${tail}`);
      const l = await w.ledger();
      assert.equal(l.spent + l.forwarded + l.kept, l.start, "no lamport created or lost");
      if (dispersal) {
        // crank_carried spends the carry on the coin, then the end is recorded and the rest moves to the end sink
        assert.equal(l.spent, share, `the whole share burned on the coin\n${tail}`);
        assert.equal(l.carried, Z, "nothing left carried");
        assert.equal(l.forwarded, POOL - share, "the rest reached the end sink");
        assert.equal(l.endOnChain, true);
      } else {
        // nothing on this program can spend the carry without dispersal: the end waits, nothing moves, and the owner is told
        assert.equal(l.spent, share - CARRY);
        assert.equal(l.carried, CARRY, "the carry stays owed on the coin, not forwarded");
        assert.equal(l.forwarded, Z, "nothing moved to the end sink while the share is owed");
        assert.ok(w.registry.alertsSince(0).some((a) => a.key === `${w.mint}:end-owed`), "the end-owed alert");
      }
    });
  }
  test("carry 0: nothing is owed, so nothing is held (the end is the same as before)", async () => {
    const w = await snowWorld({ fraction: 0.5, carry: Z, dispersal: false, held: true });
    w.readings([["2025-11-03", "1"]]);
    await w.run(D("2025-11-20T00:00:00Z"));
    await w.run(HORIZON, 12 * H);
    assert.deepEqual(w.holds, []);
    const l = await conserved(w, "held, no carry");
    assert.equal(l.spent, POOL / BigInt(2)); assert.equal(l.forwarded, POOL / BigInt(2));
  });
  test("a coin drafted before the pin keeps the publish-102 end (the matrix above)", () => {
    assert.equal(FIRST_SNOW_HOLD_FROM_MS, Date.parse("2026-10-21T03:00:00Z"));
  });
});

describe("HB-164: owedBeforeEnd cannot drift from publish 102 (reviewer F's first-snow hold aside)", () => {
  test("the current function body equals the pre-cf36eb4c one, the comment lines and the reviewer F lines aside", () => {
    const src = fs.readFileSync(path.join(import.meta.dirname, "..", "src/lib/burnticker/multiKeeper.ts"), "utf8");
    const i = src.indexOf("export async function owedBeforeEnd(");
    assert.ok(i >= 0, "owedBeforeEnd is still exported from multiKeeper.ts");
    const body = src.slice(i, src.indexOf("\n}\n", i) + 2);
    const lines = body.split("\n");
    const start = lines.findIndex((l) => /^\s*\/\/ HB-164/.test(l));
    // the HB-164 note: its first line and the comment lines that continue it
    let stop = start;
    if (start >= 0) while (stop + 1 < lines.length && /^\s*\/\//.test(lines[stop + 1])) stop++;
    const kept = (start >= 0 ? [...lines.slice(0, start), ...lines.slice(stop + 1)] : lines).filter((l) => !/^\s*\/\//.test(l));
    // reviewer F changed exactly these lines: the hold also takes a first snow drafted after the pin, whose result is its first day that burned
    const f = [
      `  const snowHeld = rule.oracle === "catalogue" && isFirstSnowSeries(rule.series) && typeof t.createdAt === "number" && t.createdAt >= (d.firstSnowHoldFromMs ?? FIRST_SNOW_HOLD_FROM_MS);`,
      `  if (end.mode !== "winddown" || t.status === "retired" || locked.mode !== "buyback" || !(isOneShot(rule) || snowHeld) || !endSinkOf(rule) || !d.program.endSink) return null;`,
      `  const ev = snowHeld ? d.registry.receipts(t.mint).find((b) => !END_KINDS.has(b.kind) && b.status !== "pending-pair" && b.units > 0) : d.registry.receipts(t.mint).filter((b) => !END_KINDS.has(b.kind) && b.status !== "pending-pair")[0];`,
    ];
    const was = OWED_BEFORE_END_PUBLISH_102.split("\n");
    const expected = [was[0], was[1], ...f, ...was.slice(4)];
    assert.equal(kept.join("\n"), expected.join("\n"));
  });
});
