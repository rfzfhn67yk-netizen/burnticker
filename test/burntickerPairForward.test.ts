// WINNER TAKES THE BURN (owner decision 2026-10-11, LAUNCHPAD-PATH §40): the forward amount is the program's buyback_spend of the
// loser's pool over its units at its own fraction (exact lamports; 0 under the floor; the reserve stays; a one-shot pair moves all of
// it); the fake follows the program's refusals (ForwardRequired, PairResultPending until 72 h, ConflictingPairResult, NotWinner on a
// draw, idempotent forwards); the keeper posts the period's result first, forwards the loser before the winner's crank, never cranks
// the loser, records pair_forwards rows and the receipt line; a legacy pair (no clause, not paired on chain) forwards nothing.
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { PublicKey } from "@solana/web3.js";
import { openRegistry, type Registry } from "@/lib/burnticker/registry";
import { FakeBurnProgram } from "@/lib/burnticker/program";
import { buildLaunchBundle, buildPairBundles, FakeLaunchLab } from "@/lib/burnticker/launchBundle";
import { KalshiClient, fixtureFetch, settledMarketsUrl, seriesApiUrl, openMarketsUrl } from "@/lib/burnticker/oracle/kalshi";
import { CatalogueAdapter } from "@/lib/burnticker/catalogue";
import { runCycle, type KeeperDeps } from "@/lib/burnticker/multiKeeper";
import { buybackSpend } from "@/lib/burnReceipts/math";
import { BURN_RECEIPTS_IDL } from "@/lib/burnReceipts/idl";
import { PAIR_ERRORS, PAIR_RESULT_GRACE_SECS, forwardAmount, forwardLine, formatForwardMemo, pairErrorSentence, parseForwardMemo, sortPairMints } from "@/lib/burnticker/pairForward";
import { pairCtxFor, periodWinner } from "@/lib/burnticker/pairForwardKeeper";
import fs from "node:fs";
import path from "node:path";
import { logEventsFrom } from "../packages/burnticker-sdk/src/events.ts";
import { PAIR_DESCRIPTION_SENTENCE, PAIR_REVIEW_LINE, describeRule } from "@/lib/burnticker/describe";
import { FIELD_HELP } from "@/lib/burnticker/fieldHelp";
import { TEMPLATES } from "@/lib/burnticker/templates";
import { pairCounterpartFrom, pairForwardsJson, forwardedSol } from "@/lib/burnticker/tokenPage";
import { buildOpsStatus } from "@/lib/burnticker/ops/status";
import { Keypair } from "@solana/web3.js";
import { ProgramBurnClient } from "@/lib/burnticker/programClient";
import { pairLinkPda, configPda } from "@/lib/burnReceipts/pda";
import { winnerFlatReading } from "@/lib/burnticker/multiKeeper";
import { linkPairDue } from "@/lib/burnKeeper/pairCurveCrank";
import type { PairLinkAccount } from "@/lib/burnReceipts/pairs";
import type { CoinVsSpec } from "@/lib/burnticker/derby/spec";
import { B as DAYMS, BONK, BONK_FEED, BONK_MINT, SHIB, WIF, WIF_FEED, WIF_MINT, derbyWorld, seedCross } from "./burntickerDerbyHelpers.ts";

/** WIF vs SHIB, daily % change, 10-05..10-11 (the derby test's season; the fixture Hermes serves both). Seeds the cross-reads. */
const WIFSHIB: CoinVsSpec = { selector: "coinvs", a: WIF, b: SHIB, window: "daily", measure: "pct", season: { start: "2026-10-05", days: 7 }, flip: false };
function seedWifShib(w: Parameters<typeof seedCross>[0]): void {
  ["0.2", "0.21", "0.2058", "0.2058", "0.21", "0.21", "0.2205", "0.2205"].forEach((v, i) => seedCross(w, WIF, DAYMS(5 + i), v, "jupiter"));
  ["0.0000055", "0.00000561", "0.0000055", "0.0000055", "0.00000561", "0.0000055", "0.0000055", "0.0000055"].forEach((v, i) => seedCross(w, SHIB, DAYMS(5 + i), v, "redstone"));
}
import { WINNER_TAKES_BURN_LINE, invertMapping, lockRule, ruleStatement, validateRule, winnerTakesBurnText } from "@/lib/burnticker/rules";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import { BRONCOS, NOW, fx } from "./burntickerHelpers.ts";

const CREATOR = "CreatorWa11et111111111111111111111111111111", ATTESTER = "KeeperDataKey1111111111111111111111111111111";
const BRONCOS_LOSE = { ...BRONCOS, binary: { onYes: null, onNo: { fractionOfPool: 0.02 } }, pair: null };
const B = (n: number | string) => BigInt(n);

describe("the forward amount (the program's rule)", () => {
  test("buyback_spend(min(fee − reserve + WSOL, cap), units, fraction) — exact lamports, the reserve stays", () => {
    const a = forwardAmount({ feeLamports: B(5_000_000_000), reserveLamports: B(20_000_000), wsolLamports: B(7), capLamports: B(25_000_000_000), units: 1, fractionBps: 200, floorLamports: B(6_666_667) });
    assert.equal(a.pool, B(4_980_000_007));
    assert.equal(a.lamports, buybackSpend(B(4_980_000_007), B(1), 200));
    assert.ok(a.lamports > B(99_600_000) && a.lamports < B(99_600_002), "≈ 2 % of the pool, the program's fixed-point rounding");
    const two = forwardAmount({ feeLamports: B(5_000_000_000), reserveLamports: B(20_000_000), wsolLamports: B(0), capLamports: null, units: 2, fractionBps: 200, floorLamports: B(0) });
    assert.equal(two.lamports, buybackSpend(B(4_980_000_000), B(2), 200), "pool × (1 − 0.98²)");
  });
  test("one-shot pairs move all of it (100 %); under the floor nothing moves; the platform cap bounds the pool", () => {
    assert.equal(forwardAmount({ feeLamports: B(3_000_000_001), reserveLamports: B(1), wsolLamports: B(0), capLamports: null, units: 1, fractionBps: 10_000, floorLamports: B(0) }).lamports, B(3_000_000_000));
    assert.equal(forwardAmount({ feeLamports: B(100_000_000), reserveLamports: B(0), wsolLamports: B(0), capLamports: null, units: 1, fractionBps: 200, floorLamports: B(6_666_667) }).lamports, B(0), "2 % of 0.1 SOL is under a $1 floor");
    assert.equal(forwardAmount({ feeLamports: B(40_000_000_000), reserveLamports: B(0), wsolLamports: B(0), capLamports: B(25_000_000_000), units: 1, fractionBps: 10_000, floorLamports: B(0) }).lamports, B(25_000_000_000));
  });
  test("memo, line, mint order, plain-word errors", () => {
    const loser = "So11111111111111111111111111111111111111112", winner = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
    const memo = formatForwardMemo("CHIEFS", loser, winner, 20261004, B(99_600_000));
    assert.equal(memo, "CHIEFS|forward|from=So1111111111|to=TokenkegQfeZ|period=2026-10-04|lamports=99600000|v1");
    assert.deepEqual(parseForwardMemo(memo), { prefix: "CHIEFS", from: "So1111111111", to: "TokenkegQfeZ", period: "2026-10-04", lamports: B(99_600_000) });
    assert.equal(parseForwardMemo(memo.replace("|v1", "|v2")), null);
    assert.equal(forwardLine("CHIEFS", "BRONCOS", B(99_600_000)), "forwarded from $CHIEFS: 0.0996 SOL → $BRONCOS burn pool");
    const [lo, hi] = sortPairMints(winner, loser);
    assert.equal(Buffer.compare(new PublicKey(lo).toBuffer(), new PublicKey(hi).toBuffer()), -1);
    assert.equal(Object.keys(PAIR_ERRORS).length, 17);
    assert.deepEqual(Object.values(PAIR_ERRORS).map((e) => e.code), Array.from({ length: 17 }, (_, i) => 6077 + i));
    // every pair error of the program's IDL has a plain sentence (6077–6093)
    for (const e of BURN_RECEIPTS_IDL.errors.filter((x) => x.code >= 6077 && x.code <= 6093)) assert.equal(PAIR_ERRORS[e.name]?.code, e.code, e.name);
    assert.match(pairErrorSentence("PairResultNotServable"), /no draw is substituted/);
    assert.match(pairErrorSentence("custom program error: 0x17c5"), /^ForwardRequired: /);
    const cfg = loadCopyLintConfig();
    for (const [k, e] of Object.entries(PAIR_ERRORS)) assert.equal(lintCopy(e.sentence, cfg).ok, true, k);
  });
  test("the period winner from one coin's receipts: won > lost → it; lost > won → the other; equal → draw", () => {
    assert.equal(periodWinner([{ pairRole: "won", units: 1 }], "A", "B"), "A");
    assert.equal(periodWinner([{ pairRole: "lost", units: 1 }], "A", "B"), "B");
    assert.equal(periodWinner([{ pairRole: "won", units: 1 }, { pairRole: "lost", units: 1 }], "A", "B"), null, "a split doubleheader is a draw");
    assert.equal(periodWinner([], "A", "B"), null, "a clock day is a draw");
  });
});

describe("the rule text and the locked description sentence", () => {
  test("every new pair carries the clause; the statement says fees from both coins burn the winner's supply; lint-clean, no prize words", () => {
    const r = lockRule({ ...BRONCOS_LOSE, pair: { pairId: "broncos-vs-chiefs-kxnflgame-den", side: "A", counterpartMint: null, winnerTakesBurn: true } }).rule;
    const s = ruleStatement(r);
    assert.match(s, /Winner takes the burn: fees from both coins burn the winner's supply\./);
    assert.deepEqual(lintCopy(winnerTakesBurnText(r), loadCopyLintConfig()).hits.map((h) => h.rule), []);
    assert.doesNotMatch(s, /\b(prize|reward|payout|win fees)\b/i);
    assert.equal(WINNER_TAKES_BURN_LINE, "Fees from both coins burn the winner's supply.");
    assert.throws(() => validateRule({ ...BRONCOS_LOSE, pair: { pairId: "x-vs-y-z", side: "A", counterpartMint: null, winnerTakesBurn: false } }), /winnerTakesBurn must be true or absent/);
    assert.doesNotMatch(ruleStatement(lockRule({ ...BRONCOS_LOSE, pair: { pairId: "x-vs-y-z", side: "A", counterpartMint: null } }).rule), /Winner takes the burn/, "a legacy pair's text is unchanged");
  });
});

describe("a Broncos pair through the keeper (winner takes the burn)", () => {
  let reg: Registry, program: FakeBurnProgram, deps: KeeperDeps, clock: number, logs: string[];
  const table = { [settledMarketsUrl("KXNFLGAME")]: fx("kalshi/KXNFLGAME.settled.json"), [seriesApiUrl("KXNFLGAME")]: fx("kalshi/series.KXNFLGAME.json"), [openMarketsUrl("KXNFLGAME")]: { cursor: "", markets: [] } };
  beforeEach(() => { reg = openRegistry(":memory:"); program = new FakeBurnProgram("devnet"); clock = NOW; logs = []; deps = { registry: reg, program, oracles: { kalshi: new KalshiClient({ fetchImpl: fixtureFetch(table), now: () => clock, minIntervalMs: 0 }), catalogue: new CatalogueAdapter() }, attester: ATTESTER, log: (s) => logs.push(s), now: () => clock, dryRun: false }; });
  async function launchPairNamed(ta: string, tb: string) { return launchPair({ tickers: [ta, tb] }); }
  async function launchPair(o: { legacy?: boolean; tickers?: [string, string] } = {}) {
    const [TA, TB] = o.tickers ?? ["BRONCOS", "CHIEFS"];
    const inputA = { creator: CREATOR, ticker: TA, name: TA, description: "", imageUrl: null, links: [], rule: BRONCOS_LOSE, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true }, cluster: "devnet" as const };
    const deps0 = { program, launchLab: new FakeLaunchLab(), devFeeWallet: null, attesters: [ATTESTER], quorum: 1, metadataUri: (m: string) => `https://x/${m}.json` };
    let pr: { pairId: string; a: Awaited<ReturnType<typeof buildLaunchBundle>>; b: Awaited<ReturnType<typeof buildLaunchBundle>> };
    if (o.legacy) {
      // a legacy pair: rules made before 2026-10-11 (no clause, no winnerTakesBurn)
      const pairId = "broncos-vs-chiefs-legacy";
      const ruleA = validateRule({ ...BRONCOS_LOSE, pair: { pairId, side: "A", counterpartMint: null } });
      const a = await buildLaunchBundle({ ...inputA, rule: ruleA }, deps0);
      const b = await buildLaunchBundle({ ...inputA, ticker: "CHIEFS", name: "Chiefs", rule: invertMapping(ruleA, a.mint, pairId) }, deps0);
      pr = { pairId, a, b };
    } else pr = await buildPairBundles({ a: inputA, b: { ticker: TB, name: TB, description: "", imageUrl: null, links: [] }, voidBy: "2026-11-30" }, deps0);
    for (const [b, ticker] of [[pr.a, TA], [pr.b, TB]] as const) {
      reg.register({ mint: b.mint, ticker, name: b.name, creator: CREATOR, description: b.description, imageUrl: null, links: [], rulesText: b.rules.text, feePda: b.addresses.feePda, vault: null, tokenConfig: null, poolId: null, launchTx: null, cluster: "devnet", platformId: null, baselineAt: "2026-09-01T00:00:00Z", status: "draft" }, clock);
      reg.markLaunched(b.mint, `launch${ticker}`, null, "2026-09-01T00:00:00Z");
      program.deposit(b.mint, B(5_000_000_000)); program.supplies.set(b.mint, B("1000000000000000"));
    }
    reg.registerPair(pr.pairId, pr.a.mint, pr.b.mint);
    return { a: reg.token(pr.a.mint)!, b: reg.token(pr.b.mint)!, pairId: pr.pairId };
  }

  test("each result: the PairResult first, the loser's fuel forwarded (exact amount, never cranked), the winner burns; receipts and pair_forwards agree", async () => {
    const { a, b, pairId } = await launchPair();
    const feeA0 = program.fake(a.mint).feeLamports, feeB0 = program.fake(b.mint).feeLamports;
    await runCycle(deps);
    const ra = reg.receipts(a.mint), rb = reg.receipts(b.mint);
    const LAR = "KXNFLGAME-26SEP27LARDEN-DEN", SF = "KXNFLGAME-26OCT04DENSF-DEN";
    // Denver beat LAR: $CHIEFS (burns on a Denver win) won; $BRONCOS lost and forwarded. Denver lost to SF: the reverse.
    assert.deepEqual([ra.find((x) => x.eventId === LAR)!.status, ra.find((x) => x.eventId === LAR)!.pairRole], ["forwarded", "lost"]);
    assert.deepEqual([rb.find((x) => x.eventId === LAR)!.status, rb.find((x) => x.eventId === LAR)!.pairRole], ["confirmed", "won"]);
    assert.deepEqual([ra.find((x) => x.eventId === SF)!.status, rb.find((x) => x.eventId === SF)!.status], ["confirmed", "forwarded"]);
    assert.equal(ra.find((x) => x.eventId === LAR)!.units, 1, "the loser carries the units it would have had");
    const fw = reg.pairForwards(pairId);
    assert.equal(fw.length, 2);
    const first = fw.find((f) => f.loserMint === a.mint)!;
    // BRONCOS' first period: its untouched pool, 1 unit at its own 2 %.
    assert.equal(first.lamports, buybackSpend(feeA0 - B(20_000_000), B(1), 200));
    assert.equal(first.solLamports + first.wsolLamports, first.lamports);
    assert.equal(ra.find((x) => x.eventId === LAR)!.spendLamports, first.lamports, "the forwarded receipt carries the program's amount");
    assert.ok(program.fake(a.mint).feeLamports < feeA0 && program.fake(b.mint).feeLamports < feeB0);
    // the PairResults the keeper posted, one per period
    const port = program.pairForward.port(a.mint, b.mint);
    assert.equal(port.results.size, 2);
    assert.ok([...port.results.values()].every((r) => r.forwarded));
    // the forward for a period lands before the winner's crank for it (losers execute first)
    const iFwd = logs.findIndex((l) => l.includes("forwarded from $BRONCOS")), iCrank = logs.findIndex((l) => /\$CHIEFS 2026-09-28: CRANKED/.test(l));
    assert.ok(iFwd >= 0 && iCrank >= 0 && iFwd < iCrank, `forward ${iFwd} before the winner's crank ${iCrank}`);
    assert.ok(logs.some((l) => /forwarded from \$BRONCOS: [0-9.]+ SOL → \$CHIEFS burn pool/.test(l)));
    // a second cycle changes nothing (idempotent)
    await runCycle(deps);
    assert.equal(reg.pairForwards(pairId).length, 2); assert.equal(port.forwards, 2);
    assert.throws(() => reg.db.exec("DELETE FROM pair_forwards"), /append-only/);
    assert.throws(() => reg.db.exec("UPDATE burns SET status='planned' WHERE status='forwarded'"), /forwarded receipt is final/);
  });

  test("the program's gate: a lost period refuses its crank (ForwardRequired) for 72 h, then cranks unpaired; no result waits 72 h; a win needs both readings; a conflicting result is refused", async () => {
    const { a, b } = await launchPair();
    const fa = program.fake(a.mint), port = program.pairForward.port(a.mint, b.mint);
    assert.equal(port.gate(a.mint, 20260928, clock), "pending");
    assert.equal(port.gate(a.mint, 20260928, clock - PAIR_RESULT_GRACE_SECS * 1000), "missing");
    // r2 H-1(a): no readings for the date yet → a win is not servable (the keeper posts a draw instead)
    const t0 = await port.buildSubmitResult({ recordDate: 20260928, winner: b.mint, sourceUrl: "x" });
    assert.equal((await port.simulate(t0.raw)).err, "PairResultNotServable");
    port.results.set(20260928, { recordDate: 20260928, winner: b.mint, submittedAt: 0, forwarded: false, forwardedLamports: B(0), forwardedAt: null });
    assert.equal(port.gate(a.mint, 20260928, clock), "lost"); assert.equal(port.gate(b.mint, 20260928, clock), "won");
    // r2 H-1(c): no forward within 72 h of the reading → the loser cranks unpaired (PairForwardMissing)
    assert.equal(port.gate(a.mint, 20260928, clock - PAIR_RESULT_GRACE_SECS * 1000), "forward-missing");
    // no result dated before the pairing day
    port.pairedAtSec = Math.floor(Date.UTC(2026, 9, 1) / 1000);
    const early = await port.buildSubmitResult({ recordDate: 20260930, winner: null, sourceUrl: "x" });
    assert.equal((await port.simulate(early.raw)).err, "PairDateBeforePairing");
    port.pairedAtSec = 0;
    const t2 = await port.buildSubmitResult({ recordDate: 20260928, winner: a.mint, sourceUrl: "x" });
    assert.equal((await port.simulate(t2.raw)).err, "ConflictingPairResult");
    const t3 = await port.buildSubmitResult({ recordDate: 20260928, winner: b.mint, sourceUrl: "x" });
    assert.equal((await port.simulate(t3.raw)).err, null, "the same result again is a no-op");
    const draw = await port.buildSubmitResult({ recordDate: 20261005, winner: null, sourceUrl: "x" }); await port.send(draw.raw);
    const fwdDraw = await port.buildForward({ loserMint: a.mint, recordDate: 20261005 });
    assert.equal((await port.simulate(fwdDraw.raw)).err, "NotWinner", "a draw forwards nothing");
    assert.ok(fa.pairGate, "the gate is installed on the coin's program");
  });

  test("a legacy pair (no clause in its rules, not paired on chain) forwards nothing: each coin burns its own fuel", async () => {
    const { a, b, pairId } = await launchPair({ legacy: true });
    program.pairForward.port(a.mint, b.mint).paired = false;
    for (const m of [a.mint, b.mint]) program.fake(m).pairGate = null;
    await runCycle(deps);
    assert.equal(reg.pairForwards(pairId).length, 0);
    assert.ok(reg.receipts(a.mint).every((x) => x.status !== "forwarded" && x.pairRole === null));
    assert.equal(reg.receipts(a.mint).filter((x) => x.status === "confirmed").length + reg.receipts(b.mint).filter((x) => x.status === "confirmed").length, 2);
  });

  test("the API shape: the counterpart carries winnerTakesBurn and forwards[]; the tally sums forwarded SOL; status.json pairs[].lastForward", async () => {
    const { a, b, pairId } = await launchPair();
    await runCycle(deps);
    const cp = (await pairCounterpartFrom(reg, async () => null, a))!;
    assert.equal(cp.winnerTakesBurn, true);
    assert.equal(cp.forwards!.length, 2);
    const f0 = cp.forwards![0], row0 = reg.pairForwards(pairId)[0];
    assert.deepEqual([f0.from, f0.to, f0.signature], [reg.token(row0.loserMint)!.ticker, reg.token(row0.winnerMint)!.ticker, row0.signature]);
    assert.match(f0.recordDate, /^\d{4}-\d{2}-\d{2}$/); assert.match(f0.sol, /^\d+(\.\d+)?$/);
    assert.deepEqual(pairForwardsJson(reg, pairId, "devnet"), cp.forwards);
    assert.equal(forwardedSol([{ status: "forwarded", spent: "0.1" }, { status: "forwarded", spent: "0.05" }, { status: "confirmed", spent: "9" }]), "0.15");
    const ops = buildOpsStatus({ now: clock, registry: reg, role: { role: "leader", active: true, reason: "x", missed: 0, missedLimit: 5, takeover: null, peer: { url: null, reachable: false, role: null, active: null, lastCycleAt: null, hostIdHash: null, takeoverValid: false, error: null, checkedAt: null } } as never, hostIdHash: "h", cluster: "devnet", paused: false, startedAt: clock, feeds: [], snapshot: null, programs: [] });
    const p = ops.pairs!.find((x) => x.pairId === pairId)!;
    assert.deepEqual([p.a, p.b, p.winnerTakesBurn, p.forwards], ["BRONCOS", "CHIEFS", true, 2]);
    assert.equal(p.lastForward!.signature, reg.pairForwards(pairId)[1].signature);
    void b;
  });

  // ---- round 2 (the pair-forward blind review: H-1, M-1, M-2, L-1..L-4) ----
  test("r2: against a dead winner (no verified pool) the win is still recorded and the forward moves 0 lamports — the loser keeps its fuel and never burns a period it lost", async () => {
    const { a, b, pairId } = await launchPair();
    program.now = () => clock;
    const port = program.pairForward.port(a.mint, b.mint);
    port.winnerLive = false;
    const fee0 = { [a.mint]: program.fake(a.mint).feeLamports, [b.mint]: program.fake(b.mint).feeLamports };
    await runCycle(deps);
    assert.ok(port.results.size >= 2 && [...port.results.values()].every((r) => r.winner !== null), "wins recorded, no substitute draw");
    const fw = reg.pairForwards(pairId);
    assert.ok(fw.length >= 2 && fw.every((f) => f.lamports === B(0)), "0-lamport forwards");
    const lost = [...reg.receipts(a.mint), ...reg.receipts(b.mint)].filter((r) => r.pairRole === "lost");
    assert.ok(lost.length >= 2 && lost.every((r) => r.status === "forwarded" && (r.burnRaw ?? B(0)) === B(0)), "a lost period never burns the losing coin");
    for (const f of fw) assert.equal(program.fake(f.loserMint).feeLamports <= fee0[f.loserMint], true);
    const kinds = reg.alertsSince(0).map((x) => x.kind);
    assert.ok(!kinds.includes("pair-result-draw") && !kinds.includes("pair-forward-missing"));
    assert.ok(logs.some((l) => /0 SOL → \$\w+ burn pool \(nothing to move/.test(l)));
  });

  test("r2: a win that cannot be recorded (PairResultNotServable) raises an alert and posts NO draw; without a result the period waits, then cranks unpaired after 72 h", async () => {
    const { a, b } = await launchPair();
    program.now = () => clock;
    const port = program.pairForward.port(a.mint, b.mint);
    port.simErr = "PairResultNotServable";
    await runCycle(deps);
    assert.equal(port.results.size, 0, "no result, no substitute draw");
    assert.ok(reg.alertsSince(0).some((x) => x.kind === "pair-result-unservable" && /no draw is posted/.test(x.text)));
    assert.ok([...reg.receipts(a.mint), ...reg.receipts(b.mint)].every((r) => r.status !== "confirmed" && r.status !== "forwarded"), "nothing burned while the program waits");
    clock += 73 * 3600_000;
    await runCycle(deps); await runCycle(deps);
    const evs = [...program.fake(a.mint).pairEvents, ...program.fake(b.mint).pairEvents];
    assert.ok(evs.some((e) => e.name === "PairResultMissing"), "the program's time-out: cranked unpaired");
  });

  test("r2: forward_to_winner against a dead winner moves 0 lamports, still processes the loser's reading, and writes the memo", async () => {
    const { a, b } = await launchPair();
    const port = program.pairForward.port(a.mint, b.mint), fa = program.fake(a.mint);
    const D = 20261001, fee0 = fa.feeLamports;
    fa.readings.set(D, { recordDate: D, prevDate: fa.cfg.crankCursor, kind: 1, processed: false, value: B(2), prevValue: B(1), delta: B(1), units: 1, signersMask: 1, pool: null, outcome: "pending", poolLamports: B(0), poolActualLamports: B(0), spentLamports: B(0), ruleSpendLamports: B(0), carriedInLamports: B(0), carriedOutLamports: B(0), got: B(0), burned: B(0), owed: B(0), shortfall: B(0) } as never);
    port.results.set(D, { recordDate: D, winner: b.mint, submittedAt: 0, forwarded: false, forwardedLamports: B(0), forwardedAt: null });
    port.winnerLive = false;
    const tx = await port.buildForward({ loserMint: a.mint, recordDate: D });
    assert.equal((await port.simulate(tx.raw)).err, null, "no PairSideNotLive any more");
    await port.send(tx.raw);
    const f = await port.forwardFacts(tx.signature);
    assert.ok(f && f !== "none"); assert.equal(f.lamports, B(0)); assert.match(f.memo!, /\|lamports=0\|v1$/);
    assert.deepEqual([fa.readings.get(D)!.processed, fa.readings.get(D)!.outcome], [true, "forwarded"]);
    assert.equal(fa.feeLamports, fee0, "nothing left the loser's pool");
    assert.match(forwardLine("BRONCOS", "CHIEFS", B(0)), /0 SOL → \$CHIEFS burn pool \(nothing to move/);
  });

  test("r2: a forward that cannot land alerts pair-forward-pending well inside 72 h; past 72 h the planner plans the paired buyback (PairForwardMissing) and pair-forward-missing fires", async () => {
    const { a, b } = await launchPair();
    program.now = () => clock;
    const port = program.pairForward.port(a.mint, b.mint);
    port.forwardErr = "OutOfOrder";
    await runCycle(deps);
    assert.ok(port.results.size >= 1 && port.forwards === 0, "results posted, no forward landed");
    clock += 2 * 3600_000;
    await runCycle(deps);
    const pending = reg.alertsSince(0).filter((x) => x.kind === "pair-forward-pending");
    assert.ok(pending.length >= 1, "pending alert at +2 h");
    assert.ok(!reg.alertsSince(0).some((x) => x.kind === "pair-forward-missing"));
    const loserMint = [a.mint, b.mint].find((m) => reg.pending(m).some((r) => r.pairRole === "lost"))!;
    const kindOf = async () => { const p = await program.fake(loserMint).planCrank(); return "kind" in p ? p.kind : p.status; };
    assert.equal(await kindOf(), "forward", "inside the grace the planner plans the forward");
    clock += 72 * 3600_000;
    assert.equal(await kindOf(), "buyback", "past the grace the planner plans the paired buyback — the keeper does not repeat the time-out");
    await runCycle(deps); await runCycle(deps);
    const missing = reg.alertsSince(0).filter((x) => x.kind === "pair-forward-missing");
    assert.ok(missing.length >= 1, "forward-missing after the 72 h grace");
    assert.match(missing[0].text, /cranked it unpaired \(PairForwardMissing\)/);
    const evs = [...program.fake(a.mint).pairEvents, ...program.fake(b.mint).pairEvents];
    assert.ok(evs.some((e) => e.name === "PairForwardMissing"));
    const lost = [...reg.receipts(a.mint), ...reg.receipts(b.mint)].filter((r) => r.pairRole === "lost");
    assert.ok(lost.length > 0 && lost.every((r) => r.status === "confirmed" || r.status === "skipped"), "the lost periods burned their own coin");
  });

  test("r2: unlink_pair runs only on evidence; afterwards the pair is 'unpaired (reason)', new receipts carry no role; an unlink by someone else is recorded too", async () => {
    const { a, b, pairId } = await launchPair();
    program.now = () => clock;
    const port = program.pairForward.port(a.mint, b.mint);
    await runCycle(deps);
    assert.equal(reg.getStatus(`pair.unlinked.${pairId}`), null, "no evidence: PairStillLive, nothing sent");
    port.unlinkReason = 2;
    await runCycle(deps);
    assert.ok(port.unlinked, "unlink_pair landed");
    const cp = (await pairCounterpartFrom(reg, async () => null, a))!;
    assert.equal(cp.unpaired!.reason, "one coin had no verified pool 30 days after the pairing");
    assert.ok(reg.alertsSince(0).some((x) => x.kind === "pair-unlinked"));
    const ctx = (await pairCtxFor(reg, program, a, clock))!;
    assert.equal(ctx.active, false, "both are plain coins now");
    // someone else unlinked another pair: recorded from the chain (both links closed)
    const o = await launchPairNamed("BULLS", "BEARS");
    await runCycle(deps);
    const p2 = program.pairForward.port(o.a.mint, o.b.mint);
    p2.unlinked = { reason: 0 }; p2.paired = false;
    await runCycle(deps);
    assert.match(reg.getStatus(`pair.unlinked.${o.pairId}`) ?? "", /unlinked on chain/);
  });

  test("an unpaired LaunchLab pair raises pair-unmatched until its second coin names the first back", async () => {
    const { a, b, pairId } = await launchPair();
    program.pairForward.port(a.mint, b.mint).paired = false;
    await runCycle(deps);
    const al = reg.alertsSince(0).filter((x) => x.kind === "pair-unmatched");
    assert.equal(al.length, 1); assert.match(al[0].text, new RegExp(`pair ${pairId}`)); assert.match(al[0].text, /plain coins for good/);
  });
});

describe("pairing on chain: the pairing window, link_pair, the launch's pair_mint", () => {
  test("a flagged pair inside its 7-day pairing window is held (no receipt is planned with a guessed role); after an unpaired close, two plain coins", async () => {
    const w = await derbyWorld(WIFSHIB);
    const port = w.program.pairForward.port(w.a.mint, w.b.mint);
    port.paired = false; port.pairingDeadline = Math.floor(w.clock.now / 1000) + 86_400;
    const ctx = await pairCtxFor(w.registry, w.program, w.a, w.clock.now);
    assert.equal(ctx!.active, false); assert.match(ctx!.hold!, /pairing window open/);
    seedWifShib(w);
    await runCycle(w.deps);
    assert.equal(w.registry.receipts(w.a.mint).length + w.registry.receipts(w.b.mint).length, 0, "nothing planned while the pairing is undecided");
    assert.ok(w.logs.some((l) => /held this cycle — pairing window open/.test(l)));
    // the window closed unpaired: two plain coins — planned without pair roles (the loser burns nothing, nothing forwards)
    port.pairingDeadline = Math.floor(w.clock.now / 1000) - 1;
    for (const m of [w.a.mint, w.b.mint]) w.program.fake(m).pairGate = null;
    await runCycle(w.deps); await runCycle(w.deps);
    assert.ok(w.registry.receipts(w.a.mint).length > 0);
    assert.ok([...w.registry.receipts(w.a.mint), ...w.registry.receipts(w.b.mint)].every((r) => r.pairRole === null && r.status !== "forwarded"));
    assert.equal(w.registry.pairForwards(w.pairId).length, 0);
  });

  test("link_pair is due right after init_pair (both TokenConfigs, links not naming each other), never for a voided Pair", () => {
    const [m1, m2] = [new PublicKey(Buffer.alloc(32, 1)), new PublicKey(Buffer.alloc(32, 2))];
    const link = (mint: PublicKey, other: PublicKey, paired: boolean) => ({ mint, pair_mint: other, paired } as unknown as PairLinkAccount);
    const pair = (status: number) => ({ status, mints: [m1, m2] });
    assert.equal(linkPairDue(pair(0), [true, true], [null, null]), true, "open, no pool yet: link now (before any reading)");
    assert.equal(linkPairDue(pair(0), [true, false], [null, null]), false, "side B has no TokenConfig yet");
    assert.equal(linkPairDue(pair(1), [true, true], [link(m1, m2, true), link(m2, m1, false)]), true, "half-linked");
    assert.equal(linkPairDue(pair(1), [true, true], [link(m1, m2, true), link(m2, m1, true)]), false, "already paired (a no-op)");
    assert.equal(linkPairDue(pair(2), [true, true], [null, null]), false, "voided: never");
  });

  test("a launched pair names its partner in initialize_token: A provisional, B completes the pairing; a single coin's instruction is unchanged", async () => {
    const program = new FakeBurnProgram("devnet");
    const deps0 = { program, launchLab: new FakeLaunchLab(), devFeeWallet: null, attesters: [ATTESTER], quorum: 1, metadataUri: (m: string) => `https://x/${m}.json` };
    const inputA = { creator: CREATOR, ticker: "BRONCOS", name: "Broncos", description: "", imageUrl: null, links: [], rule: BRONCOS_LOSE, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true }, cluster: "devnet" as const };
    const seen: { mint: string; pairMint?: string | null; partnerFirst?: boolean }[] = [];
    const orig = program.initializeToken.bind(program);
    program.initializeToken = async (i) => { seen.push({ mint: i.mint, pairMint: i.pairMint, partnerFirst: i.partnerFirst }); return orig(i); };
    const pr = await buildPairBundles({ a: inputA, b: { ticker: "CHIEFS", name: "Chiefs", description: "", imageUrl: null, links: [] }, voidBy: "2026-11-30" }, deps0);
    assert.deepEqual(seen, [{ mint: pr.a.mint, pairMint: pr.b.mint, partnerFirst: false }, { mint: pr.b.mint, pairMint: pr.a.mint, partnerFirst: true }]);
    assert.ok(pr.b.mintSecretKey, "B's fresh mint keypair (made before A's bundle) still co-signs B's create");
    seen.length = 0;
    await buildLaunchBundle({ ...inputA, rule: { ...BRONCOS_LOSE } }, deps0);
    assert.deepEqual(seen.map((x) => [x.pairMint, x.partnerFirst]), [[undefined, undefined]], "a single coin passes no pair accounts");
  });
});

describe("a one-shot loser's end-of-rule days forward to the live winner", () => {
  test("the flippening loser forwards its pool at the result, retires, and its sweep forwards too while the winner still drains; a flat winner reading when the winner has nothing that day", async () => {
    const spec: CoinVsSpec = { selector: "coinvs", a: WIF, b: BONK, window: "daily", measure: "mcap", season: { start: "2026-10-05", days: 5 }, flip: true };
    const w = await derbyWorld(spec, { tickers: ["TEAMWIF", "TEAMBONK"], hermes: null });
    // side A (the winner) drains under the 2 %-of-reserve cap: 1 SOL a crank from a pool of ~10 SOL → live for days
    w.program.fake(w.a.mint).poolReserveWsol = BigInt(50) * BigInt(1_000_000_000);
    const snap = (feed: string, b: number, value: string) => w.adapter.store.putSample({ key: `pyth:${feed}`, kind: "pyth", ts: b + 60_000, slot: 1, value, detail: { source: "pyth-solana", publishTime: b / 1000 + 5 } });
    const sup = (mint: string, b: number, v: string) => w.adapter.store.putSample({ key: `supply:${mint}`, kind: "supply", ts: b + 60_000, slot: 1, value: v, detail: {} });
    for (const [b, wv] of [[DAYMS(6), "0.2"], [DAYMS(7), "0.25"]] as const) { snap(WIF_FEED, b, wv); snap(BONK_FEED, b, "0.0000025"); sup(WIF_MINT, b, "999000000"); sup(BONK_MINT, b, "88000000000000"); seedCross(w, WIF, b, wv); seedCross(w, BONK, b, "0.0000025"); }
    w.clock.now = DAYMS(7) + 3 * 3600_000;
    await runCycle(w.deps); await runCycle(w.deps);
    assert.equal(w.registry.pairForwards(w.pairId).length, 1, "the result's forward");
    w.clock.now = DAYMS(8) + 3 * 3600_000;
    await runCycle(w.deps); await runCycle(w.deps);
    assert.equal(w.registry.token(w.b.mint)!.status, "retired", "the loser's pool went to the winner: nothing left to drain");
    assert.equal(w.registry.token(w.a.mint)!.status, "live", "the winner still drains");
    // new fee income on the retired loser, over the sweep threshold → its sweep forwards to the live winner
    w.program.deposit(w.b.mint, BigInt(400_000_000));
    w.clock.now = DAYMS(9) + 3 * 3600_000;
    await runCycle(w.deps); await runCycle(w.deps);
    w.clock.now = DAYMS(10) + 3 * 3600_000;
    await runCycle(w.deps); await runCycle(w.deps);
    const sweep = w.registry.receipts(w.b.mint).find((r) => r.kind === "sweep")!;
    assert.ok(sweep, "the loser's sweep was planned");
    assert.equal(sweep.pairRole, "lost"); assert.match(sweep.note, /forwards to \$TEAMWIF's burn pool/);
    assert.equal(sweep.status, "forwarded", w.logs.filter((l) => /TEAMBONK|pair/.test(l)).slice(-12).join("\n"));
    const fw = w.registry.pairForwards(w.pairId);
    assert.equal(fw.length, 2); assert.equal(fw[1].loserMint, w.b.mint); assert.ok(fw[1].lamports > BigInt(0));
    const port = w.program.pairForward.port(w.a.mint, w.b.mint);
    assert.equal(port.results.get(Number(sweep.eventId.slice(6).replace(/-/g, "")))!.winner, w.a.mint);
  });

  test("winnerFlatReading: exists / a flat 0-unit reading for a quiet winner / cannot once the winner read past the day", async () => {
    const w = await derbyWorld(WIFSHIB);
    seedWifShib(w);
    await runCycle(w.deps); await runCycle(w.deps);
    const fa = w.program.fake(w.a.mint);
    const last = fa.cfg.lastRecordDate;
    assert.ok(last >= 20261011, String(last));
    const ctxB = (await pairCtxFor(w.registry, w.program, w.b, w.clock.now))!;   // B's view: the winner is A
    assert.equal(await winnerFlatReading(w.deps, ctxB, last), "exists");
    const D = 20261013;
    assert.deepEqual(await winnerFlatReading(w.deps, ctxB, D), { waiting: "the flat reading for $TEAMWIF waits until 2026-10-13 is over (UTC)" });
    w.clock.now = DAYMS(14) + 3600_000;
    const value0 = fa.cfg.lastValue;
    assert.equal(await winnerFlatReading(w.deps, ctxB, D), "submitted");
    const rd = fa.readings.get(D)!;
    assert.equal(rd.units, 0); assert.equal(rd.value, value0); assert.equal(rd.processed, true, "0 units: processed at once");
    assert.equal(await winnerFlatReading(w.deps, ctxB, D), "exists", "idempotent");
    const gap = [20261005, 20261006, 20261007, 20261008, 20261009, 20261010, 20261011].find((x) => !fa.readings.has(x))!;
    assert.ok(gap, "a day inside the season without a reading");
    assert.equal(await winnerFlatReading(w.deps, ctxB, gap), "cannot", "the winner already read past that day");
  });

  test("the fake planner, like the chain's, returns kind forward for a lost period", async () => {
    const spec: CoinVsSpec = { selector: "coinvs", a: WIF, b: BONK, window: "daily", measure: "pct", season: { start: "2026-10-05", days: 2 }, flip: false };
    const w = await derbyWorld(spec, { tickers: ["TEAMWIF", "TEAMBONK"] });
    const fa = w.program.fake(w.a.mint);
    fa.pairGate = () => "lost";
    fa.readings.set(20261006, { ...[...fa.readings.values()][0] ?? {}, recordDate: 20261006, prevDate: fa.cfg.crankCursor, processed: false, units: 1 } as never);
    fa.cfg = { ...fa.cfg, poolRegistered: true, mode: "buyback" };
    const plan = await fa.planCrank();
    assert.ok("kind" in plan && plan.kind === "forward");
  });
});

describe("the devnet pair-6 run (2026-10-11 evidence): the receipt line, the forward memo, the plain emit! event", () => {
  const EV = path.resolve(import.meta.dirname, "../docs/burnkeeper/evidence/devnet-pair-forward-2026-10-11");
  const j = (f: string) => JSON.parse(fs.readFileSync(path.join(EV, f), "utf8"));
  test("the forward for 10-11 moved exactly 79,306,876 lamports B → A; the memo parses and the receipt line says so", () => {
    const logs: string[] = j("pair6-forward-B-to-A-20261011.json").simulation.logs;
    const memo = /Memo \(len \d+\): "(.*)"$/.exec(logs.find((l) => l.includes("|forward|"))!)![1];
    const f = parseForwardMemo(memo)!;
    assert.deepEqual([f.prefix, f.period, f.lamports], ["PCLB", "2026-10-11", B(79_306_876)]);
    assert.equal(forwardLine("PCLB", "PCLA", f.lamports), "forwarded from $PCLB: 0.079306876 SOL → $PCLA burn pool");
  });
  test("PairResultSubmitted is read from the program's own 'Program data:' log line (not a self-CPI)", () => {
    const r = j("pair6-pair-result-20261011.json");
    const evs = logEventsFrom(r.simulation.logs, new PublicKey(r.programId));
    assert.equal(evs.length, 1); assert.equal(evs[0].name, "PairResultSubmitted"); assert.equal(Number(evs[0].data.record_date), 20261011);
    // a "Program data:" line written by another program is not ours
    assert.equal(logEventsFrom(r.simulation.logs, new PublicKey(Buffer.alloc(32, 3))).length, 0);
  });
});

describe("pair copy: the locked description, the review line, help and templates — no prize words", () => {
  const PRIZE = /\b(prizes?|rewards?|rewarded|pay-?outs?|(win|wins|winning|won)( the| all| both| their| its)? (fees?|fuel))\b/i;
  test("a winner-takes-the-burn pair coin's locked description carries the sentence; a single coin's does not", async () => {
    const program = new FakeBurnProgram("devnet");
    const deps0 = { program, launchLab: new FakeLaunchLab(), devFeeWallet: null, attesters: [ATTESTER], quorum: 1, metadataUri: (m: string) => `https://x/${m}.json` };
    const inputA = { creator: CREATOR, ticker: "BRONCOS", name: "Broncos", description: "", imageUrl: null, links: [], rule: BRONCOS_LOSE, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true }, cluster: "devnet" as const };
    const pr = await buildPairBundles({ a: inputA, b: { ticker: "CHIEFS", name: "Chiefs", description: "", imageUrl: null, links: [] }, voidBy: "2026-11-30" }, deps0);
    const ra = JSON.parse(pr.a.rules.text), rb = JSON.parse(pr.b.rules.text);
    for (const [r, t] of [[ra, "BRONCOS"], [rb, "CHIEFS"]] as const) assert.ok(describeRule(r, { ticker: t }).ruleBlock.includes(PAIR_DESCRIPTION_SENTENCE), t);
    assert.ok(!describeRule(validateRule(BRONCOS_LOSE), { ticker: "BRONCOS" }).ruleBlock.includes("rival coin"));
    assert.match(PAIR_DESCRIPTION_SENTENCE, /fees from both coins burn the winner's supply/);
  });
  test("every pair sentence is lint-clean and never says prize / reward / payout / win fees", () => {
    const cfg = loadCopyLintConfig();
    const texts = [PAIR_DESCRIPTION_SENTENCE, PAIR_REVIEW_LINE, WINNER_TAKES_BURN_LINE, FIELD_HELP["pair-burn"].what, FIELD_HELP["pair-burn"].does, forwardLine("PCLB", "PCLA", B(79_306_876)),
      winnerTakesBurnText({ pair: { pairId: "x", side: "A", counterpartMint: null, winnerTakesBurn: true }, market: null } as never), winnerTakesBurnText({ pair: { pairId: "x", side: "A", counterpartMint: null, winnerTakesBurn: true }, market: "KX-1" } as never),
      ...TEMPLATES.filter((t) => t.id === "election-pair" || t.id === "coin-vs-coin").map((t) => t.example)];
    for (const t of texts) { assert.doesNotMatch(t, PRIZE, t); assert.deepEqual(lintCopy(t, cfg).hits.map((h) => h.rule), [], t); }
    // the lint itself refuses "win fees" in any copy
    assert.equal(lintCopy("the winner wins the fees of both coins", cfg).hits.some((h) => h.rule === "win-fees"), true);
  });
});

describe("r2: initialize_token at launch always carries the partner's PairLink (L-3)", () => {
  test("side A (first): pair_mint, its own PairLink and the partner's (empty) PairLink; side B (second): plus the partner's TokenConfig; a single coin: none", async () => {
    const programId = new PublicKey("AuQjoSgq7upmyPBv2itwy2TSZ1VjoVipyy4z9wd7zhMM"), admin = Keypair.generate().publicKey;
    const client = new ProgramBurnClient({ connection: {} as never, programId, cluster: "devnet", payer: null, admin, solUsd: async () => 150 });
    const locked = lockRule(BRONCOS_LOSE);
    const [mA, mB, creator] = [Keypair.generate().publicKey, Keypair.generate().publicKey, Keypair.generate().publicKey].map((k) => k.toBase58());
    const base = { creator, ticker: "BRONCOS", rulesSha256: locked.sha256, selectorKey: "kalshi:KXNFLGAME:-DEN", mode: "buyback" as const, attesters: [creator], quorum: 1, vault: null, rule: locked.rule };
    const def = BURN_RECEIPTS_IDL.instructions.find((i) => i.name === "initialize_token")!;
    const slot = (keys: { pubkey: string }[], n: string) => keys[def.accounts.findIndex((a) => a.name === n)].pubkey;
    const A = (await client.initializeToken({ ...base, mint: mA, pairMint: mB, partnerFirst: false })).instructions[0];
    assert.deepEqual([slot(A.keys, "pair_mint"), slot(A.keys, "pair_link"), slot(A.keys, "partner_link"), slot(A.keys, "partner_config")], [mB, pairLinkPda(programId, new PublicKey(mA)).toBase58(), pairLinkPda(programId, new PublicKey(mB)).toBase58(), programId.toBase58()]);
    const Bx = (await client.initializeToken({ ...base, ticker: "CHIEFS", mint: mB, pairMint: mA, partnerFirst: true })).instructions[0];
    assert.deepEqual([slot(Bx.keys, "partner_link"), slot(Bx.keys, "partner_config")], [pairLinkPda(programId, new PublicKey(mA)).toBase58(), configPda(programId, new PublicKey(mA)).toBase58()]);
    const single = (await client.initializeToken({ ...base, mint: mA })).instructions[0];
    for (const n of ["pair_mint", "pair_link", "partner_link", "partner_config"]) assert.equal(slot(single.keys, n), programId.toBase58(), n);
  });
});
