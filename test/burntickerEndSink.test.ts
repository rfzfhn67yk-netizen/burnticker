// END SINKS (owner decision 2026-10-11, LAUNCHPAD-PATH §45; burn_receipts program round 4): when a coin's rule ends RESOLVED, its leftover
// fuel and later fee trickle move to its end sink's burn pool through forward_on_end (the pair winner while it is live, else $DEFICIT);
// a VOID end keeps the coin's own wind-down. These tests drive the keeper (multiKeeper.runCycle → endSinkKeeper.endSinkStep) against the
// fake program with end sinks pinned, plus the pieces around it: the outcome classification, the pin a rule asks for, the real client's
// refusal while end sinks are not live on the program, the pair-curve re-encode and the plain lines.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { runCycle } from "@/lib/burnticker/multiKeeper";
import { endOutcomeOf, ruleEndSourceUrl } from "@/lib/burnticker/endSinkKeeper";
import { endForwardLine } from "@/lib/burnticker/endSinkClient";
import { endSinkPin, type FakeBurnProgram } from "@/lib/burnticker/program";
import { ProgramBurnClient } from "@/lib/burnticker/programClient";
import { DEFAULT_ON_END, lockRule, WIND_DOWN_ON_END, type BurnRule } from "@/lib/burnticker/rules";
import { BURN_RECEIPTS_IDL } from "@/lib/burnReceipts/idl";
import { decodeType } from "@/lib/burnReceipts/idlCoder";
import { END_SINK_FLAGSHIP, END_SINK_PAIR_WINNER, endSinkPda } from "@/lib/burnReceipts/endSink";
import { toPairCurvePolicy } from "@/lib/burnticker/pairCurveLaunch";
import { PROGRAM_IDS } from "@/lib/burnticker/networks";
import { BURNTICKER_PLATFORM } from "@/lib/burnReceipts/constants";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import type { CoinVsSpec } from "@/lib/burnticker/derby/spec";
import { ATTESTER, B, CREATOR, DAY, SHIB, WIF, coinvsRule, derbyWorld, seedCross, type DerbyWorld } from "./burntickerDerbyHelpers.ts";
import { launchlabPair } from "./burntickerLutFixtures.ts";
import { BRONCOS } from "./burntickerHelpers.ts";

const SOL = BigInt(1_000_000_000);
const SPEC: CoinVsSpec = { selector: "coinvs", a: WIF, b: SHIB, window: "daily", measure: "pct", season: { start: "2026-10-05", days: 1 }, flip: false };

/** A derby pair on a round-4 fake (EndSinks pinned) and a live flagship coin ($DEFICIT stand-in) the fake forwards to. */
async function sinkWorld(o: { voidBy?: string; autoRegisterPool?: boolean } = {}): Promise<DerbyWorld & { flagship: string }> {
  const w = await derbyWorld(SPEC, { endSinks: true, ...o });
  const flagship = Keypair.generate().publicKey.toBase58();
  await w.program.initializeToken({ mint: flagship, creator: CREATOR, ticker: "DEFICIT", rulesSha256: "ab".repeat(32), selectorKey: "flagship", mode: "buyback", attesters: [ATTESTER], quorum: 1, vault: null, rule: lockRule({ ...coinvsRule(SPEC), onEnd: WIND_DOWN_ON_END }).rule });
  w.program.fake(flagship).registerPool();
  w.program.endSink.flagship = flagship;
  return { ...w, flagship };
}
const fee = (w: { program: FakeBurnProgram }, m: string) => w.program.fake(m).feeLamports;
const port = (w: { program: FakeBurnProgram }, m: string) => w.program.endSink.port(m);

/** Seeds the one-day season: WIF +5 % vs SHIB +2 % (WIF's coin wins), or both +5 % (a tie: no winner). */
function seedSeason(w: DerbyWorld, tie = false): void {
  seedCross(w, WIF, B(5), "0.2"); seedCross(w, WIF, B(6), "0.21");
  seedCross(w, SHIB, B(5), "0.0000055"); seedCross(w, SHIB, B(6), tie ? "0.000005775" : "0.00000561");
}
/** The end date's result: [winner, loser] mints (null winner = a tie / draw). */
async function ends(w: DerbyWorld): Promise<{ winner: string | null; loser: string | null }> {
  const r = await w.program.pairForward.port(w.a.mint, w.b.mint).result(20261005);
  const winner = r?.winner ?? null;
  return { winner, loser: winner === null ? null : winner === w.a.mint ? w.b.mint : w.a.mint };
}

describe("the keeper: a RESOLVED end forwards what is left to the end sink", () => {
  test("a derby pair's season ends: the loser records a quorum-signed RESOLVED end, forwards its leftover to the winner and retires; the winner (the sink) records nothing, stays live and winds down on its own coin", async () => {
    const w = await sinkWorld();
    // both coins pinned PAIR_WINNER (winner-takes-the-burn pair, partner named in the create), minimum = the rule's sweep threshold
    for (const [m, other] of [[w.a.mint, w.b.mint], [w.b.mint, w.a.mint]]) assert.deepEqual(await port(w, m).endSink(), { kind: "pair-winner", sinkMint: other, minForwardLamports: BigInt(50_000_000) });
    seedSeason(w);
    w.clock.now = B(6) + 3 * 3600_000;
    for (let i = 0; i < 3; i++) await runCycle(w.deps);
    const { winner, loser } = await ends(w);
    assert.equal(winner, w.a.mint, "WIF out-gained SHIB on the only day");
    const re = await port(w, loser!).ruleEnd();
    assert.deepEqual({ outcome: re?.outcome, recordDate: re?.recordDate, forwards: re?.forwards }, { outcome: "resolved", recordDate: 20261005, forwards: 1 });
    assert.ok(re!.forwardedLamports > BigInt(4) * SOL, `${re!.forwardedLamports}`);
    const rec = JSON.parse(w.registry.getStatus(`rule.endfwd.${loser}`)!);
    assert.equal(rec.to, winner); assert.equal(rec.intended, winner);
    assert.match(rec.line, /^\$TEAMSHIB's rule ended with a result, so [\d.]+ SOL left in its burn pool moved to the \$TEAMWIF burn pool, where it burns \$TEAMWIF\.$/);
    assert.ok(lintCopy(rec.line, loadCopyLintConfig()).ok, rec.line);
    assert.equal(w.registry.token(loser!)!.status, "retired");
    assert.equal(w.registry.receipts(loser!).filter((r) => r.kind === "winddown" || r.kind === "drain" || r.kind === "sweep").length, 0, "no wind-down on the loser");
    assert.ok(fee(w, loser!) <= w.program.fake(loser!).cfg.reserveLamports + BigInt(50_000_000), "only the reserve (and dust under the minimum) is left");
    // the program refuses any reading on the loser dated after its resolved end, and any crank of one
    const lp = w.program.fake(loser!);
    const tx = await lp.buildReading({ recordDate: 20261007, prevDate: lp.cfg.lastRecordDate, value: lp.cfg.lastValue + BigInt(1), sourceUrl: "x", feedId: lp.cfg.feedId, valueDecimals: 0 });
    assert.equal((await lp.simulate(tx.raw)).err, "RuleEnded");
    // the winner: no RuleEnd (it stays live, so the forward could land), and its pool winds down on its own coin
    assert.equal(await port(w, winner!).ruleEnd(), null);
    assert.equal(w.program.fake(winner!).endState.state, "live");
    assert.ok(w.registry.receipts(winner!).some((r) => r.kind === "winddown"), "the winner burns down what is left, its partner's leftover included");
    // …through to its own retirement and the self-burn sweep (the winning coin is the sink)
    for (let d = 7; d <= 40; d++) { w.clock.now = B(6) + (d - 6) * DAY + 3 * 3600_000; await runCycle(w.deps); }
    assert.equal(w.registry.token(winner!)!.status, "retired");
    assert.equal(await port(w, winner!).ruleEnd(), null, "the winner never records an end");
  });

  test("the trickle follows the sink: under the minimum nothing moves; over it, at most once a week; the end is never recorded twice", async () => {
    const w = await sinkWorld();
    seedSeason(w);
    w.clock.now = B(6) + 3 * 3600_000; for (let i = 0; i < 3; i++) await runCycle(w.deps);
    const { loser } = await ends(w);
    const forwards = async () => (await port(w, loser!).ruleEnd())!.forwards;
    assert.equal(await forwards(), 1);
    w.program.deposit(loser!, BigInt(1_000_000));              // 0.001 SOL: under the 0.05 SOL minimum
    await runCycle(w.deps);
    assert.equal(await forwards(), 1);
    w.program.deposit(loser!, BigInt(200_000_000));            // 0.2 SOL, but the last forward was today
    await runCycle(w.deps);
    assert.equal(await forwards(), 1, "at most once a week");
    w.clock.now += 7 * DAY;
    await runCycle(w.deps);
    assert.equal(await forwards(), 2, "a week later the trickle is forwarded");
    assert.equal(w.registry.signatures(loser!, "rule-end:resolved").length, 1, "the end is recorded once");
  });

  test("a tie on the last day (no winner): both coins record RESOLVED ends and forward to $DEFICIT; while the flagship is not live the forward waits and nothing retires", async () => {
    const w = await sinkWorld();
    w.program.fake(w.flagship).cfg = { ...w.program.fake(w.flagship).cfg, poolRegistered: false };
    seedSeason(w, true);
    const flag0 = fee(w, w.flagship);
    w.clock.now = B(6) + 3 * 3600_000; for (let i = 0; i < 3; i++) await runCycle(w.deps);
    assert.equal((await ends(w)).winner, null, "a tie");
    for (const m of [w.a.mint, w.b.mint]) {
      const re = await port(w, m).ruleEnd();
      assert.equal(re?.outcome, "resolved"); assert.equal(re?.forwards, 0);
      assert.equal(w.registry.token(m)!.status, "live");
    }
    assert.ok(w.logs.some((l) => /forward to the end sink waits \(flagship-not-live\)/.test(l)));
    w.program.fake(w.flagship).registerPool();
    await runCycle(w.deps);
    let moved = BigInt(0);
    for (const m of [w.a.mint, w.b.mint]) {
      const re = (await port(w, m).ruleEnd())!;
      assert.equal(re.forwards, 1); moved += re.forwardedLamports;
      assert.equal(JSON.parse(w.registry.getStatus(`rule.endfwd.${m}`)!).to, w.flagship);
      assert.equal(w.registry.token(m)!.status, "retired");
    }
    assert.equal(fee(w, w.flagship) - flag0, moved, "every forwarded lamport landed in the flagship's burn pool");
  });
});

describe("the keeper: a VOID end keeps the wind-down on the coin itself", () => {
  test("a pair that voids (no second pool by voidBy): the end is recorded VOID on chain, nothing is forwarded, the wind-down days are planned", async () => {
    const w = await sinkWorld({ voidBy: "2026-10-07", autoRegisterPool: false });
    w.program.fake(w.a.mint).registerPool();                   // one side registers, the other never does → the pair voids
    w.clock.now = B(9) + 3 * 3600_000;
    for (let i = 0; i < 3; i++) await runCycle(w.deps);
    const re = await port(w, w.a.mint).ruleEnd();
    assert.equal(re?.outcome, "void");
    assert.equal(re?.forwards, 0);
    assert.equal(w.program.fake(w.a.mint).endState.state, "void");
    assert.ok(w.registry.receipts(w.a.mint).some((r) => r.kind === "winddown"), "the wind-down runs on the coin");
  });
});

describe("the pieces", () => {
  test("endOutcomeOf: a voided pair, a voided one-shot, a void or cancelled reason → void; a season over, a settled one-shot → resolved", () => {
    const reg = { receipts: () => [] } as never;
    const t = { mint: "M" };
    const locked = { rule: lockRule({ ...BRONCOS, onEnd: DEFAULT_ON_END }).rule } as never;
    assert.equal(endOutcomeOf(reg, t, locked, { state: "voided", atMs: 0 } as never, { reason: "the pair voided (both or neither)" }), "void");
    assert.equal(endOutcomeOf(reg, t, locked, null, { reason: "the coin's window ended: the season was cancelled" }), "void");
    assert.equal(endOutcomeOf(reg, t, locked, null, { reason: "the coin's window ended: the Broncos' season is over" }), "resolved");
    const one = { rule: lockRule({ ...BRONCOS, series: null, market: "KXNFLGAME-26OCT04DENSF-DEN", filter: {}, onEnd: DEFAULT_ON_END }).rule } as never;
    assert.equal(endOutcomeOf({ receipts: () => [{ kind: "event", status: "voided" }] } as never, t, one, null, { reason: "the one-shot settled VOIDED" }), "void");
    assert.equal(endOutcomeOf({ receipts: () => [{ kind: "event", status: "confirmed" }] } as never, t, one, null, { reason: "the one-shot settled NO" }), "resolved");
    assert.match(ruleEndSourceUrl("RAYS26", "2026-10-31", "resolved", "the season is over"), /^burnticker:\/\/RAYS26\/end\/2026-10-31\?outcome=resolved&reason=the%20season%20is%20over$/);
  });

  test("endSinkPin: FLAGSHIP for a single coin, PAIR_WINNER for a winner-takes-the-burn pair (a partner required), nothing without onEnd.endSink or in vault mode", () => {
    const single = lockRule({ ...BRONCOS, onEnd: DEFAULT_ON_END }).rule;
    assert.deepEqual(endSinkPin(single, null), { kind: "flagship", minForwardLamports: BigInt(50_000_000) });
    const pair = { ...single, pair: { pairId: "pair-1", side: "A", counterpartMint: null, winnerTakesBurn: true } } as BurnRule;
    assert.deepEqual(endSinkPin(pair, "Partner1111111111111111111111111111111111111"), { kind: "pair-winner", minForwardLamports: BigInt(50_000_000) });
    assert.throws(() => endSinkPin(pair, null), /no partner mint/);
    assert.equal(endSinkPin(lockRule({ ...BRONCOS, onEnd: WIND_DOWN_ON_END }).rule, null), null);
    assert.equal(endSinkPin({ ...single, binary: { onYes: { tokens: 1000 }, onNo: null }, vault: { share: 0.1, vestDays: 365, cliffDays: 0 } } as BurnRule, null), null);
  });

  test("ProgramBurnClient: a rule with an end sink is refused while BURNTICKER_END_SINKS_LIVE is off; on, initialize_token carries the EndSink account and its args", async () => {
    const programId = new PublicKey(PROGRAM_IDS.devnet.burn_receipts);
    const mk = (live: boolean) => new ProgramBurnClient({ connection: new Connection("http://127.0.0.1:1"), programId, cluster: "devnet", payer: null, admin: Keypair.generate().publicKey, solUsd: async () => 150, endSinksLive: live });
    const mint = Keypair.generate().publicKey.toBase58();
    const rule = lockRule({ ...BRONCOS, onEnd: DEFAULT_ON_END }).rule;
    const input = { mint, creator: Keypair.generate().publicKey.toBase58(), ticker: "BRONCO", rulesSha256: "cd".repeat(32), selectorKey: "kalshi:KXNFLGAME", mode: "buyback" as const, attesters: [Keypair.generate().publicKey.toBase58()], quorum: 1, vault: null, rule };
    await assert.rejects(mk(false).initializeToken(input), /end sinks are not live on this program yet \(BURNTICKER_END_SINKS_LIVE is off\)/);
    const r = await mk(true).initializeToken(input);
    const ix = r.instructions[0];
    assert.ok(ix.keys.some((k) => k.pubkey === endSinkPda(programId, new PublicKey(mint)).toBase58() && k.isWritable), "the EndSink PDA rides, writable");
    const def = BURN_RECEIPTS_IDL.instructions.find((i) => i.name === "initialize_token")!;
    const args = decodeType(BURN_RECEIPTS_IDL, def.args[0].type, Buffer.from(ix.dataBase64, "base64"), 8).value as { end_sink_kind: number; end_sink_mint: PublicKey | null; end_sink_min_lamports: bigint };
    assert.equal(args.end_sink_kind, END_SINK_FLAGSHIP); assert.equal(args.end_sink_mint, null); assert.equal(BigInt(args.end_sink_min_lamports), BigInt(50_000_000));
    // a rule from before §45 still launches with no EndSink, with the flag off
    const old = await mk(false).initializeToken({ ...input, rule: lockRule({ ...BRONCOS, onEnd: WIND_DOWN_ON_END }).rule });
    assert.ok(!old.instructions[0].keys.some((k) => k.pubkey === endSinkPda(programId, new PublicKey(mint)).toBase58()));
  });

  test("the pair-curve re-encode names the partner in end_sink_mint (pair_mint is dropped for policy 2)", async () => {
    const { pair } = await launchlabPair("devnet");
    const pid = PROGRAM_IDS.devnet.burn_receipts;
    for (const [side, partner] of [[pair.a, pair.b.mint], [pair.b, pair.a.mint]] as const) {
      const init = side.transactions.flatMap((t) => t.instructions).find((ix) => ix.label.startsWith("burn_receipts.initialize_token"))!;
      const re = toPairCurvePolicy(init, pid, BURNTICKER_PLATFORM.devnet.toBase58())!;
      const def = BURN_RECEIPTS_IDL.instructions.find((i) => i.name === "initialize_token")!;
      const args = decodeType(BURN_RECEIPTS_IDL, def.args[0].type, Buffer.from(re.dataBase64, "base64"), 8).value as { end_sink_kind: number; end_sink_mint: PublicKey | null };
      assert.equal(args.end_sink_kind, END_SINK_PAIR_WINNER);
      assert.equal(args.end_sink_mint?.toBase58(), partner);
    }
  });

  test("the receipt line is plain and lint-clean", () => {
    const line = endForwardLine("RAYS26", "DEFICIT", BigInt(1_234_500_000));
    assert.equal(line, "$RAYS26's rule ended with a result, so 1.2345 SOL left in its burn pool moved to the $DEFICIT burn pool, where it burns $DEFICIT.");
    assert.ok(lintCopy(line, loadCopyLintConfig()).ok);
    assert.equal(SOL, BigInt(1_000_000_000));
  });
});
