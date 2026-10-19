// THIRD PRELAUNCH AUDIT F01 (2026-10-16, P1): an ENDED rule must still drain its carried burn obligation. The round-5 program (deployed
// on mainnet 2026-10-15) runs crank_carried after any end (crank_carried.rs R5-3 / R5-4) and, for 30 days after a RESOLVED end, keeps
// the carried spend on the coin in forward_on_end / burn_sol_on_end (end.rs carry_held_back). The keeper (dispersalKeeper.ts), the
// client planner (crank.ts planCarriedCrank) and the test doubles (FakeProgram, FakeEndSinkPort) used to stop at an ended rule, so a
// carry left by the last reading stayed owed forever (or was forwarded off the coin). Repro: a 2 % event on a 5 SOL pool with a 2 SOL
// trading reserve spends 40,000,000 lamports and carries 60,000,000; 72 five-minute cycles drain it in three pieces while live, and must
// do the same after a RESOLVED or VOID end, across a restart and a lost confirmation, with exact pool / burn / end totals.
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey, type Connection } from "@solana/web3.js";
import { openRegistry, type Registry } from "@/lib/burnticker/registry";
import { FakeBurnProgram } from "@/lib/burnticker/program";
import { buildLaunchBundle, FakeLaunchLab } from "@/lib/burnticker/launchBundle";
import { KalshiClient, fixtureFetch, settledMarketsUrl, seriesApiUrl, openMarketsUrl } from "@/lib/burnticker/oracle/kalshi";
import { CatalogueAdapter, feedById, loadFixture } from "@/lib/burnticker/catalogue";
import { runCycle, type KeeperDeps } from "@/lib/burnticker/multiKeeper";
import { DISPERSAL_STATE_KEY } from "@/lib/burnticker/dispersalKeeper";
import { stateFromJson } from "@/lib/burnticker/dispersal";
import { INCINERATOR_ADDRESS } from "@/lib/burnticker/rules";
import type { FakeProgram } from "@/lib/burnKeeper/fakeProgram";
import { planCarriedCrank } from "@/lib/burnReceipts/crank";
import { carryHeldBack } from "@/lib/burnReceipts/endSink";
import { QUEUE_UNBLOCK_SECS } from "@/lib/burnReceipts/constants";
import { configPda } from "@/lib/burnReceipts/pda";
import { BRONCOS, NOW, fx, treasuryAndCrossFetch } from "./burntickerHelpers.ts";
import { encodeAccount, FakeConnection } from "./burntickerApiHelpers.ts";

const CREATOR = "CreatorWa11et111111111111111111111111111111";
const ATTESTER = "KeeperDataKey1111111111111111111111111111111";
const SOL = BigInt(1_000_000_000);
const Z = BigInt(0);
const H = 3_600_000;
const SPENT = BigInt(40_000_000), CARRIED = BigInt(60_000_000), EVENT = SPENT + CARRIED;
const table = {
  [settledMarketsUrl("KXNFLGAME")]: fx("kalshi/KXNFLGAME.settled.json"), [seriesApiUrl("KXNFLGAME")]: fx("kalshi/series.KXNFLGAME.json"), [openMarketsUrl("KXNFLGAME")]: { cursor: "", markets: [] },
};
const treasuryBody = loadFixture(feedById("treasury.debt")!).body;

let reg: Registry, program: FakeBurnProgram, deps: KeeperDeps, lines: string[], clock: number;
beforeEach(() => {
  reg = openRegistry(":memory:"); program = new FakeBurnProgram("devnet"); program.now = () => clock; lines = []; clock = NOW;
  deps = { registry: reg, program, oracles: { kalshi: new KalshiClient({ fetchImpl: fixtureFetch(table), now: () => clock, minIntervalMs: 0 }), catalogue: new CatalogueAdapter({ fetchImpl: treasuryAndCrossFetch(treasuryBody), now: () => clock }) }, attester: ATTESTER, log: (s) => lines.push(s), now: () => clock, dryRun: false, dispersal: true };
});

/** The repro coin: a Broncos YES day asks 2 % of 5 SOL (0.1 SOL) against a 2 SOL trading reserve (cap 0.04): spends 0.04, carries 0.06. */
async function carriedCoin() {
  const b = await buildLaunchBundle({ creator: CREATOR, ticker: "BRONCO", name: "BRONCO coin", description: "a test", imageUrl: null, links: [], rule: BRONCOS, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true }, cluster: "devnet" }, { program, launchLab: new FakeLaunchLab(), devFeeWallet: null, attesters: [ATTESTER], quorum: 1, metadataUri: (m) => `https://x/${m}.json` });
  const t = reg.register({ mint: b.mint, ticker: "BRONCO", name: b.name, creator: CREATOR, description: b.description, imageUrl: null, links: [], rulesText: b.rules.text, feePda: b.addresses.feePda, vault: b.addresses.vault, tokenConfig: b.addresses.tokenConfig, poolId: b.addresses.poolId, launchTx: null, cluster: "devnet", platformId: b.addresses.platformId, baselineAt: "2026-09-01T00:00:00Z", status: "draft" }, clock);
  reg.markLaunched(t.mint, "launchBRONCO", b.addresses.poolId, "2026-09-01T00:00:00Z");
  reg.addAttester({ mint: t.mint, pubkey: ATTESTER, role: "data-key", addedAt: clock, timelockUntil: null });
  program.supplies.set(t.mint, BigInt("1000000000000000"));
  program.deposit(t.mint, BigInt(5) * SOL);
  const f = program.fake(t.mint);
  f.poolReserveWsol = BigInt(2) * SOL;
  const first = await runCycle(deps);
  assert.equal(first.executed[0].outcome, "confirmed");
  assert.equal(f.cfg.totalSpentLamports, SPENT, "the event's crank spent 2 % of the 2 SOL reserve");
  assert.equal(f.cfg.carriedSpendLamports, CARRIED, "and carried the rest of its 0.1 SOL");
  const above0 = f.feeLamports + f.wsol - f.cfg.reserveLamports;
  assert.equal(above0, BigInt(5) * SOL - SPENT);
  return { mint: t.mint, f };
}
const state = (mint: string) => stateFromJson(reg.getStatus(DISPERSAL_STATE_KEY(mint)));
const disp = (r: Awaited<ReturnType<typeof runCycle>>, mint: string) => (r.dispersal ?? []).find((x) => x.mint === mint)!;
/** 72 five-minute cycles (6 hours) — or fewer when the carry reaches zero — collecting the landed pieces and every outcome. */
async function cycles(f: FakeProgram, mint: string, n = 72, stopAtZero = true) {
  const pieces: bigint[] = [], actions: string[] = [];
  for (let i = 0; i < n; i++) {
    clock += 5 * 60_000;
    const d = disp(await runCycle(deps, { fetch: false }), mint);
    actions.push(d.action);
    if (d.action === "landed") pieces.push(d.spentLamports!);
    if (stopAtZero && f.cfg.carriedSpendLamports === Z && !state(mint).inflight) break;
  }
  return { pieces, actions };
}
const sum = (xs: bigint[]) => xs.reduce((a, x) => a + x, Z);
/** Ends the rule on chain through the fake end sink (submit_rule_end), with `kind` as the coin's pinned sink. */
async function endOnChain(mint: string, outcome: "resolved" | "void", kind: "incinerator" = "incinerator") {
  const f = program.fake(mint), port = program.endSink.port(mint);
  port.pinned = { kind, sinkMint: INCINERATOR_ADDRESS, minForwardLamports: Z };
  const tx = await port.buildRuleEnd({ recordDate: f.cfg.lastRecordDate, outcome, sourceUrl: "https://example.test/end" });
  assert.equal((await port.simulate(tx.raw)).err, null);
  await port.send(tx.raw);
  assert.equal((await port.confirm(tx)).status, "confirmed");
  assert.equal(f.endState.state, outcome);
  return port;
}

describe("F01: a carried burn obligation drains after the rule ends (round-5 program lifecycle)", () => {
  test("control, live rule: 72 five-minute cycles drain the 60,000,000 carried lamports in three pieces", async () => {
    const { mint, f } = await carriedCoin();
    const { pieces } = await cycles(f, mint);
    assert.equal(pieces.length, 3);
    assert.equal(sum(pieces), CARRIED);
    assert.equal(f.cfg.totalSpentLamports, EVENT);
  });

  test("RESOLVED end before the drain (the final reading of a season carried): the keeper keeps spending pieces until the carry is zero", async () => {
    const { mint, f } = await carriedCoin();
    f.endState = { state: "resolved", date: f.cfg.lastRecordDate };   // the end lands right after the season's last crank
    const { pieces, actions } = await cycles(f, mint);
    assert.ok(!actions.every((a) => a === "idle"), `not 72 idle outcomes: ${actions.slice(0, 5).join(",")}`);
    assert.equal(pieces.length, 3, actions.join(","));
    assert.equal(sum(pieces), CARRIED, "exactly the carried 60,000,000 lamports");
    assert.equal(f.cfg.carriedSpendLamports, Z);
    assert.equal(f.cfg.totalSpentLamports, EVENT, "the event's whole 0.1 SOL was spent on the coin");
    assert.equal(state(mint).debts.length, 0);
    assert.ok(!lines.some((l) => /the rule has ended/.test(l)));
  });

  test("VOID end (a champion's end and every void: the wind-down stays on the coin): the carry drains the same way", async () => {
    const { mint, f } = await carriedCoin();
    f.endState = { state: "void", date: f.cfg.lastRecordDate };
    const { pieces } = await cycles(f, mint);
    assert.equal(sum(pieces), CARRIED);
    assert.equal(f.cfg.totalSpentLamports, EVENT);
  });

  test("the program contract (fake = crank_carried.rs): a piece after an end is accepted, never RuleNotLive; the planner offers it", async () => {
    const { f } = await carriedCoin();
    for (const s of ["resolved", "void"] as const) {
      f.endState = { state: s, date: f.cfg.lastRecordDate };
      const plan = await f.planCarried(BigInt(10_000_000));
      assert.ok("build" in plan, `planCarried after a ${s} end: ${JSON.stringify(plan)}`);
      const tx = await plan.build();
      assert.equal((await f.simulate(tx.raw)).err, null);
    }
    assert.equal((await f.config()).endState, "void");
  });

  test("a piece in flight when the rule ends: it is reconciled (late landing = its receipt) before any lifecycle answer, then the rest drains", async () => {
    const { mint, f } = await carriedCoin();
    f.dropSends = true;
    let guard = 0;
    while (!state(mint).inflight && guard++ < 72) { clock += 5 * 60_000; await runCycle(deps, { fetch: false }); }
    const sig = state(mint).inflight!.signature;
    f.endState = { state: "resolved", date: f.cfg.lastRecordDate };
    f.dropSends = false; f.land(sig);                                  // the piece lands after all (sent before the end)
    clock += 5 * 60_000;
    await runCycle(deps, { fetch: false });
    const st = state(mint);
    assert.equal(st.inflight, null, "the in-flight piece was resolved after the end");
    assert.equal(st.receipts[0]?.signature, sig, "and recorded as its own receipt");
    assert.ok(lines.some((l) => /a piece landed after a restart/.test(l)));
    await cycles(f, mint);
    assert.equal(f.cfg.carriedSpendLamports, Z);
    assert.equal(f.cfg.totalSpentLamports, EVENT);
    assert.ok(state(mint).receipts.every((r) => r.status === "landed" && r.spentLamports !== null), "every piece's memo was read");
    assert.equal(sum(state(mint).receipts.map((r) => r.spentLamports ?? Z)), CARRIED,"receipts add up to the carried amount, the late piece counted once");
  });

  test("a lost confirmation after the end: the expired piece is released and planned again; totals exact", async () => {
    const { mint, f } = await carriedCoin();
    f.endState = { state: "resolved", date: f.cfg.lastRecordDate };
    f.dropSends = true;
    let guard = 0;
    while (!state(mint).inflight && guard++ < 72) { clock += 5 * 60_000; await runCycle(deps, { fetch: false }); }
    assert.ok(state(mint).inflight, "a piece was signed and sent after the end");
    f.height = state(mint).inflight!.lastValidBlockHeight + 1;       // never lands; its blockhash expires
    f.dropSends = false;
    await cycles(f, mint);
    assert.ok(lines.some((l) => /expired without landing; it is planned again/.test(l)));
    assert.equal(f.cfg.carriedSpendLamports, Z);
    assert.equal(f.cfg.totalSpentLamports, EVENT);
  });

  test("restart mid-drain after the end with the dispersal state lost: the chain's carried amount still decides; totals exact", async () => {
    const { mint, f } = await carriedCoin();
    f.endState = { state: "resolved", date: f.cfg.lastRecordDate };
    let guard = 0;
    while (f.cfg.totalSpentLamports === SPENT && guard++ < 72) { clock += 5 * 60_000; await runCycle(deps, { fetch: false }); }
    assert.ok(f.cfg.carriedSpendLamports > Z && f.cfg.carriedSpendLamports < CARRIED, `mid-drain: ${f.cfg.carriedSpendLamports}`);
    reg.setStatus(DISPERSAL_STATE_KEY(mint), "", clock);               // the keeper restarts with no dispersal state
    await cycles(f, mint, 144);                                         // a fresh 6-hour window from the restart
    assert.equal(f.cfg.carriedSpendLamports, Z);
    assert.equal(f.cfg.totalSpentLamports, EVENT);
  });
});

describe("F01: the end paths keep the carry on the coin for 30 days (end.rs carry_held_back) and the keeper drains it first", () => {
  test("RESOLVED end, incinerator sink: the first forward moves only the fuel above the carry; dispersal then burns the 0.06 SOL on the coin", async () => {
    const { mint, f } = await carriedCoin();
    const port = await endOnChain(mint, "resolved");
    const above = f.feeLamports + f.wsol - f.cfg.reserveLamports;
    assert.equal(await port.spendableLamports(), above - CARRIED, "spendable leaves the held carry out");
    const tx = await port.buildForward();
    await port.send(tx.raw);
    assert.equal((await port.confirm(tx)).status, "confirmed");
    assert.equal(port.incinerated, BigInt(5) * SOL - EVENT, "4.9 SOL burned as SOL; the 0.06 SOL owed stays on the coin");
    assert.equal(f.cfg.carriedSpendLamports, CARRIED, "the carry is not cleared inside the grace");
    // the keeper restarts with its dispersal state lost, after the end and the forward
    reg.setStatus(DISPERSAL_STATE_KEY(mint), "", clock);
    const { pieces } = await cycles(f, mint, 144);                      // a fresh 6-hour window from the restart
    assert.equal(sum(pieces), CARRIED);
    assert.equal(f.cfg.carriedSpendLamports, Z);
    assert.equal(f.cfg.totalSpentLamports, EVENT, "pool 5 SOL = 0.1 SOL burned on the coin + 4.9 SOL to the incinerator");
    assert.equal(f.feeLamports + f.wsol - f.cfg.reserveLamports, Z, "nothing left above the reserve");
    assert.equal(port.incinerated + f.cfg.totalSpentLamports, BigInt(5) * SOL);
  });

  test("after the 30-day grace the end path disposes of a carry nobody could drain (dead pool): it moves everything and clears it; the keeper's debts reconcile away", async () => {
    const { mint, f } = await carriedCoin();
    f.poolTradable = false;                                             // the pool is dead: no piece can land
    const port = await endOnChain(mint, "resolved");
    const r1 = await cycles(f, mint, 12, false);
    assert.equal(sum(r1.pieces), Z);
    assert.equal(stateFromJson(reg.getStatus(DISPERSAL_STATE_KEY(mint))).debts.reduce((a, d) => a + d.remainingLamports, Z), CARRIED, "still owed, still tracked after the end");
    clock += QUEUE_UNBLOCK_SECS * 1000;
    assert.equal(port.heldBack(), Z, "the grace is over");
    const tx = await port.buildForward();
    await port.send(tx.raw);
    assert.equal((await port.confirm(tx)).status, "confirmed");
    assert.equal(f.cfg.carriedSpendLamports, Z, "disposed: cleared by the end path");
    assert.equal(port.incinerated, BigInt(5) * SOL - SPENT);
    clock += 5 * 60_000;
    const d = disp(await runCycle(deps, { fetch: false }), mint);
    assert.equal(d.action, "idle");
    assert.equal(state(mint).debts.length, 0);
  });

  test("carryHeldBack mirrors end.rs: SELF coin with a verified pool, RESOLVED, inside 30 days; never for VOID, a target coin or no pool", () => {
    const pool = Keypair.generate().publicKey;
    const base = { end_state: 1, burn_target_kind: 0, pool_verified: true, cpmm_pool: pool, carried_spend_lamports: CARRIED };
    assert.equal(carryHeldBack(base, 1_000, 1_000 + QUEUE_UNBLOCK_SECS - 1), CARRIED);
    assert.equal(carryHeldBack(base, 1_000, 1_000 + QUEUE_UNBLOCK_SECS), Z);
    assert.equal(carryHeldBack({ ...base, end_state: 2 }, 1_000, 1_001), Z);
    assert.equal(carryHeldBack({ ...base, burn_target_kind: 1 }, 1_000, 1_001), Z);
    assert.equal(carryHeldBack({ ...base, cpmm_pool: PublicKey.default }, 1_000, 1_001), Z);
    assert.equal(carryHeldBack({ ...base, pool_verified: false }, 1_000, 1_001), Z);
  });
});

describe("F01: the client planner (crank.ts planCarriedCrank) over an ended TokenConfig", () => {
  for (const [name, endState] of [["resolved", 1], ["void", 2]] as const) {
    test(`a ${name} end with a carried spend: the plan is the crank_carried transaction, not "rule-ended"`, async () => {
      const conn = new FakeConnection();
      const programId = Keypair.generate().publicKey, mint = Keypair.generate().publicKey, pool = Keypair.generate().publicKey;
      conn.accounts.set(configPda(programId, mint).toBase58(), { owner: programId, lamports: 1, data: encodeAccount("TokenConfig", (v) => {
        v.mint = mint; v.cpmm_pool = pool; v.pool_verified = true; v.has_baseline = true;
        v.last_record_date = 20260928; v.crank_cursor = 20260928; v.carried_spend_lamports = CARRIED; v.end_state = endState;
      }) });
      const plan = await planCarriedCrank({ connection: conn as unknown as Connection, programId, mint, cluster: "devnet" }, Keypair.generate().publicKey, BigInt(20_000_000), NOW);
      assert.ok("instructions" in plan, "status" in plan ? plan.status : "?");
      assert.equal(plan.carriedLamports, CARRIED);
      assert.equal(plan.throughDate, 20260928);
    });
  }
});

describe("F01 follow-ups (review of the branch): the chain's clock and the refusal wording", () => {
  test("the chain client judges the 30-day grace on the chain's clock (latest block time), not this host's", async () => {
    const { ChainEndSink } = await import("@/lib/burnticker/endSinkChain");
    const { feePda, ruleEndPda } = await import("@/lib/burnReceipts/pda");
    const conn = new FakeConnection() as FakeConnection & { getBalance(k: PublicKey): Promise<number>; getSlot(): Promise<number>; getBlockTime(s: number): Promise<number | null> };
    const programId = Keypair.generate().publicKey, mint = Keypair.generate().publicKey, pool = Keypair.generate().publicKey;
    const submittedAt = Math.floor(Date.now() / 1000) - 86_400;                 // on this host's clock: a day into the grace
    let blockTime = submittedAt + QUEUE_UNBLOCK_SECS + 60;                         // on the chain's: the grace is over
    conn.accounts.set(configPda(programId, mint).toBase58(), { owner: programId, lamports: 1, data: encodeAccount("TokenConfig", (v) => {
      v.mint = mint; v.cpmm_pool = pool; v.pool_verified = true; v.has_baseline = true; v.last_record_date = 20260928; v.crank_cursor = 20260928; v.carried_spend_lamports = CARRIED; v.end_state = 1;
    }) });
    conn.accounts.set(ruleEndPda(programId, mint).toBase58(), { owner: programId, lamports: 1, data: encodeAccount("RuleEnd", (v) => { v.mint = mint; v.record_date = 20260928; v.outcome = 1; v.submitted_at = BigInt(submittedAt); }) });
    const fee = feePda(programId, mint).toBase58();
    conn.getBalance = async (k: PublicKey) => (k.toBase58() === fee ? Number(SOL) : 0);
    conn.getSlot = async () => 1;
    conn.getBlockTime = async () => blockTime;
    const port = new ChainEndSink({ connection: conn as unknown as Connection, programId, cluster: "devnet", payer: null }).port(mint.toBase58());
    assert.equal(await port.spendableLamports(), SOL, "grace over by the chain's clock: everything is spendable (the host clock would hold the carry back)");
    blockTime = submittedAt + 3600;
    assert.equal(await port.spendableLamports(), SOL - CARRIED, "inside the grace by the chain's clock: the carry is held back");
  });

  test("a piece refused because nothing is carried any more does not claim the amount 'stays carried'", async () => {
    const { mint, f } = await carriedCoin();
    const orig = f.simulate.bind(f);
    f.simulate = async (raw: Uint8Array) => { f.cfg = { ...f.cfg, carriedSpendLamports: Z }; return orig(raw); };   // cleared between the read and the piece
    let guard = 0;
    while (!lines.some((l) => /NothingCarried/.test(l)) && guard++ < 72) { clock += 5 * 60_000; await runCycle(deps, { fetch: false }); }
    const line = lines.find((l) => /NothingCarried/.test(l))!;
    assert.match(line, /nothing is carried on chain any more \(spent by another cranker, or cleared by the rule's end path\)/);
    assert.doesNotMatch(line, /stays carried/);
    assert.equal(state(mint).window, null, "no plan is kept for an amount that is gone");
  });
});
