// BURN KEEPER — PROGRAM EXECUTION (2026-10-10): the keeper driving the burn_receipts program (programChain.ts) against the in-memory
// program (fakeProgram.ts): readings attested and submitted in order, quorum short, the crank waiting on a pool / on TWAP history,
// spend-cap and burn-pool-cap partial days, vault mode with shortfall, no-units readings, pool health, best-effort claims, the
// write-ahead crank surviving a dropped send, a stranger's crank adopted, dry run, refusals, and the status page built from it.
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { openLedger, type Ledger } from "@/lib/burnKeeper/ledger";
import { ingest, type KeeperCtx } from "@/lib/burnKeeper/cycle";
import { configRefusal, executeProgramPending, executionModeFromEnv, legacyRefusal, WAIT_REASONS, WAIT_RETRY_MS } from "@/lib/burnKeeper/programChain";
import { FakeProgram, readingTxBytes } from "@/lib/burnKeeper/fakeProgram";
import { solanaProgramPort } from "@/lib/burnKeeper/programAdapter";
import { Keypair, PublicKey } from "@solana/web3.js";
import { usdToCents, type LoadedRules } from "@/lib/burnKeeper/rules";
import { buildBurnsJson, buildStatus, renderIndexHtml } from "@/lib/burnKeeper/statusPage";
import { parseBuybackMemo, parseDebtMemo } from "@/lib/burnReceipts/memo";
import { buybackSpend as programSpend } from "@/lib/burnReceipts/math";
import type { DebtReading, FeedValidation } from "@/lib/burnKeeper/feeds/treasury";
import type { ConfirmOutcome as CycleConfirm, SignedTx as CycleSigned } from "@/lib/burnKeeper/cycle";
import type { ConfirmOutcome as PortConfirm, SignedTx as PortSigned } from "@/lib/burnKeeper/programPort";

// Compile-time: programPort.ts's local SignedTx / ConfirmOutcome (import-free, for the public SDK) stay identical to cycle.ts's.
const portTypes = { a: (x: CycleConfirm): PortConfirm => x, b: (x: PortConfirm): CycleConfirm => x, c: (x: CycleSigned): PortSigned => x, d: (x: PortSigned): CycleSigned => x };
void portTypes;
import { buybackRules, raw, vaultRules } from "./burnKeeperHelpers.ts";

const R = (d: string, a: string): DebtReading => ({ recordDate: d, amount: a, cents: usdToCents(a) });
const V = (...readings: DebtReading[]): FeedValidation => ({ readings, refusals: [] });
const T = "DEBT", F = "treasury.debt_to_penny";
const KEEPER = "KeeperDataKey1111111111111111111111111111111";
const SOL = BigInt(1_000_000_000);
const UNIT = BigInt(100_000_000_000);
const D7 = R("2026-10-07", "40284036147367.19"), D8 = R("2026-10-08", "40305316210829.72"); // +$21.28B → 21 units

let ledger: Ledger, loaded: LoadedRules, prog: FakeProgram, ctx: KeeperCtx, lines: string[], clock: number;

function fake(l: LoadedRules, over: Partial<ConstructorParameters<typeof FakeProgram>[0]> = {}): FakeProgram {
  const buyback = l.rules.mode === "buyback";
  return new FakeProgram({ mode: l.rules.mode, rulesSha256: l.sha256, memoPrefix: l.rules.memo.prefix, memoSource: l.rules.feed.memoSource, unitValue: UNIT,
    fractionPerUnitBps: buyback ? 200 : 0, /* 2% per unit, matching deficit.rules.json (owner, 2026-10-10) */ floorLamports: buyback ? BigInt(1_000_000) : BigInt(0), reserveLamports: buyback ? BigInt(20_000_000) : BigInt(0),
    tokensPerUnit: buyback ? BigInt(0) : raw("100000"), vaultAllocation: buyback ? BigInt(0) : raw("250000000"), attesters: [KEEPER], now: () => clock, ...over });
}
function setup(l: LoadedRules, over: Partial<ConstructorParameters<typeof FakeProgram>[0]> = {}) {
  ledger = openLedger(":memory:"); loaded = l; lines = []; clock = Date.parse("2026-10-09T21:00:00Z");
  prog = fake(l, over);
  ctx = { ledger, loaded, log: (s) => lines.push(s), now: () => clock, dryRun: false };
}
const status = (extra: Partial<Parameters<typeof buildStatus>[0]> = {}) => {
  const input = { loaded, readings: ledger.readings(T, F), burns: ledger.burns(T, F), now: clock, nextPollAt: null, lastPoll: null, lastError: null, chain: { cluster: "localnet", mint: prog.mint, vault: prog.feePda, keeper: KEEPER, supplyRaw: prog.supply, vaultRaw: null, feeLamports: prog.feeLamports },
    program: { programId: prog.programId, configAddress: prog.configAddress, feePda: prog.feePda, config: { ...prog.cfg }, feePdaLamports: prog.feeLamports, programReadings: ledger.programReadings(T, F), keeperAttesterKeys: prog.attesterKeys(), lastHealth: null }, ...extra };
  const burns = buildBurnsJson(input);
  return { s: buildStatus(input, burns), burns, html: renderIndexHtml(buildStatus(input, burns), burns, []) };
};

describe("execution mode", () => {
  test("BURNKEEPER_EXECUTION picks; the default is program when BURNTICKER_PROGRAM_ID is set; anything else is refused", () => {
    assert.equal(executionModeFromEnv({}), "legacy");
    assert.equal(executionModeFromEnv({ BURNTICKER_PROGRAM_ID: "GV9CMj" }), "program");
    assert.equal(executionModeFromEnv({ BURNTICKER_PROGRAM_ID: "GV9CMj", BURNKEEPER_EXECUTION: "legacy" }), "legacy");
    assert.equal(executionModeFromEnv({ BURNKEEPER_EXECUTION: "PROGRAM" }), "program");
    assert.throws(() => executionModeFromEnv({ BURNKEEPER_EXECUTION: "jupiter" }), /expected "program" or "legacy"/);
  });
  test("the legacy Jupiter leg refuses a fee-PDA creator, an off-curve creator, a mint with a TokenConfig, and the creator-fee claim; vault mode is allowed", () => {
    const base = { mode: "buyback" as const, programId: "P", feePda: "FEE", launchCreator: "KEEPERKEY", tokenConfigExists: false };
    assert.equal(legacyRefusal(base), null);
    assert.match(legacyRefusal({ ...base, launchCreator: "FEE" })!, /creator is the program's fee PDA FEE/);
    assert.match(legacyRefusal({ ...base, tokenConfigExists: true })!, /has a burn_receipts TokenConfig/);
    assert.match(legacyRefusal({ ...base, launchCreator: "SOMEPDA", launchCreatorOffCurve: true })!, /off the ed25519 curve/);
    assert.match(legacyRefusal({ ...base, claimCreatorFees: true })!, /claiming them is the program path's job/);
    assert.equal(legacyRefusal({ ...base, mode: "vault", launchCreator: "FEE", tokenConfigExists: true }), null);
  });
});

describe("program execution, buyback", () => {
  beforeEach(() => setup(buybackRules()));

  test("readings are attested in order (baseline, then the unit day); the program counts the units; no pool yet → a WAIT, not an error", async () => {
    ingest(ctx, V(D7, D8));
    const rep = await executeProgramPending(ctx, prog);
    assert.deepEqual(rep.readings.map((r) => [r.recordDate, r.outcome, r.units]), [["2026-10-07", "submitted", 0], ["2026-10-08", "submitted", 21]]);
    assert.equal(prog.cfg.lastRecordDate, 20261008);
    assert.deepEqual(ledger.programReadings(T, F).map((r) => [r.recordDate, r.status, r.units]), [["2026-10-07", "confirmed", 0], ["2026-10-08", "confirmed", 21]]);
    assert.equal(ledger.signatures(T, F, "2026-10-08", "reading").length, 1, "write-ahead signature for the reading");
    assert.match(ledger.signatures(T, F, "2026-10-08", "reading")[0].memo, /^BURNRECEIPTS-v3\|5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d\|.*\|prev=2026-10-07\|2026-10-08\|40305316210829\.72\|/);
    assert.deepEqual(rep.cranks.map((c) => c.outcome), ["waiting"]);
    const b = ledger.burn(T, F, "2026-10-08")!;
    assert.equal(b.status, "planned"); assert.equal(b.lastError, null); assert.equal(b.attempts, 0);
    assert.equal(b.waitReason, WAIT_REASONS["waiting-for-pool"]);
    // A second cycle submits nothing new.
    const again = await executeProgramPending(ctx, prog);
    assert.deepEqual(again.readings, []);
    assert.equal(prog.signed.filter((s) => s.payload.kind === "reading").length, 2);
  });

  test("crank_buyback after register_pool: the ledger row is the Reading account (rule spend, spent, got, burned) and the memo the program wrote; the status page verifies it", async () => {
    prog.registerPool(); prog.deposit(BigInt(5) * SOL);
    ingest(ctx, V(D7, D8));
    const rep = await executeProgramPending(ctx, prog);
    assert.equal(rep.cranks[0].outcome, "confirmed");
    const b = ledger.burn(T, F, "2026-10-08")!;
    const pool = BigInt(5) * SOL; // fee − reserve (+ 0 WSOL): the deposit, since the reserve was funded at init
    const rule = programSpend(pool, BigInt(21), 200);
    assert.equal(b.status, "confirmed"); assert.equal(b.execution, "program"); assert.equal(b.chainOutcome, "burned"); assert.equal(b.chainUnits, 21);
    assert.equal(b.poolLamports, pool); assert.equal(b.ruleSpendLamports, rule); assert.equal(b.spendLamports, rule); assert.equal(b.carriedOutLamports, BigInt(0));
    assert.equal(b.gotRaw, (rule * raw("1000000")) / SOL); assert.equal(b.burnRaw, b.gotRaw);
    assert.equal(b.swapPool, prog.cfg.pool); assert.equal(b.swapSig, null, "no keeper swap");
    const m = parseBuybackMemo(b.memo!)!;
    assert.ok(m, "the memo the program wrote (v2)"); assert.equal(m.units, 21); assert.equal(m.spent, rule.toString()); assert.equal(m.swap, prog.cfg.pool!.slice(0, 12));
    assert.equal(ledger.signatures(T, F, "2026-10-08", "crank")[0].status, "confirmed");
    const { burns, s, html } = status();
    assert.equal(burns[0].verify.verified, true, burns[0].verify.checks.join("; "));
    assert.equal(burns[0].execution, "program");
    assert.equal(s.execution, "program"); assert.equal(s.program!.attestation.quorum, 1); assert.equal(s.program!.attestation.quorumMet, true);
    assert.equal(s.program!.attestation.lastReading!.recordDate, "2026-10-08");
    assert.equal(s.program!.pool.registered, true);
    assert.match(html, /The burn program/); assert.match(html, /Quorum <strong>1<\/strong>/);
    assert.equal(s.buyback!.funding.feeWallet, prog.feePda, "the fee pool is the program's fee PDA, not the keeper");
    // Tampering with the recorded rule spend turns it red.
    const tampered = buildBurnsJson({ loaded, readings: ledger.readings(T, F), burns: ledger.burns(T, F).map((x) => ({ ...x, ruleSpendLamports: x.ruleSpendLamports! + BigInt(1) })), now: clock, nextPollAt: null, lastPoll: null, lastError: null, chain: { cluster: "localnet", mint: null, vault: null, keeper: null, supplyRaw: null, vaultRaw: null } });
    assert.equal(tampered[0].verify.verified, false);
  });

  test("QUORUM SHORT: a 2-of-2 config with one key held → nothing is signed; the reading is held and the status page says so", async () => {
    setup(buybackRules(), { attesters: [KEEPER, "SecondOperator11111111111111111111111111111"], quorum: 2, heldKeys: [KEEPER] });
    ingest(ctx, V(D7, D8));
    const rep = await executeProgramPending(ctx, prog);
    assert.deepEqual(rep.readings.map((r) => r.outcome), ["quorum-short"]);
    assert.equal(prog.signed.length, 0);
    assert.equal(ledger.programReading(T, F, "2026-10-07")!.status, "quorum-short");
    const { s } = status();
    assert.equal(s.program!.attestation.quorumMet, false);
    assert.equal(s.program!.attestation.held!.status, "quorum-short");
    // The program itself also refuses a reading without quorum (the keys the keeper thinks it holds are not the config's).
    setup(buybackRules(), { attesters: ["SomeoneElse1111111111111111111111111111111"], heldKeys: ["SomeoneElse1111111111111111111111111111111"] });
    prog.heldKeys = [KEEPER]; prog.attesterKeys = () => ["SomeoneElse1111111111111111111111111111111"];
    ingest(ctx, V(D7));
    const r2 = await executeProgramPending(ctx, prog);
    assert.equal(r2.readings[0].outcome, "quorum-short"); assert.match(r2.readings[0].why!, /QuorumNotMet/);
    assert.equal(prog.landed.size, 0);
  });

  test("TWAP UNAVAILABLE: the crank waits (wait reason, no error, no attempt counted) and retries after 10 min; then it burns", async () => {
    prog.registerPool(); prog.deposit(BigInt(5) * SOL); prog.twap = "unavailable";
    ingest(ctx, V(D7, D8));
    const rep = await executeProgramPending(ctx, prog);
    assert.equal(rep.cranks[0].outcome, "waiting");
    let b = ledger.burn(T, F, "2026-10-08")!;
    assert.match(b.waitReason!, /^TwapUnavailable: waiting for TWAP history/);
    assert.equal(b.lastError, null); assert.equal(b.attempts, 0); assert.equal(b.status, "planned");
    assert.equal(prog.landed.size, 2, "only the two readings landed");
    assert.equal((await executeProgramPending(ctx, prog)).cranks[0].outcome, "waiting", "inside the retry window");
    const { s, html } = status();
    assert.equal(s.program!.queue.waits[0].recordDate, "2026-10-08"); assert.equal(s.health.waiting, 1); assert.match(html, /waiting for TWAP history/);
    prog.twap = "ok"; clock += 10 * 60_000 + 1;
    const ok = await executeProgramPending(ctx, prog);
    assert.equal(ok.cranks[0].outcome, "confirmed");
    b = ledger.burn(T, F, "2026-10-08")!;
    assert.equal(b.waitReason, null); assert.equal(b.status, "confirmed");
  });

  test("SPEND CAP BOUND: one crank spends ≤ 2% of the pool's reserve; the rest is carried (a PARTIAL day) and spent by the next crank", async () => {
    prog.registerPool(); prog.deposit(BigInt(5) * SOL); prog.poolReserveWsol = BigInt(20) * SOL; // cap = 0.4 SOL
    ingest(ctx, V(D7, D8));
    await executeProgramPending(ctx, prog);
    const b = ledger.burn(T, F, "2026-10-08")!;
    assert.equal(b.status, "confirmed");
    assert.equal(b.spendLamports, BigInt(400_000_000));
    assert.equal(b.carriedOutLamports, b.ruleSpendLamports! - BigInt(400_000_000));
    assert.equal(prog.cfg.carriedSpendLamports, b.carriedOutLamports);
    const { burns, s } = status();
    assert.match(burns[0].partial!, /spend cap bound/); assert.equal(burns[0].verify.verified, true, burns[0].verify.checks.join("; "));
    assert.equal(s.program!.queue.partials.length, 1); assert.notEqual(s.program!.queue.carriedSpendSol, "0");
    assert.match(lines.join("\n"), /PARTIAL — SpendCapBound/);
    // The next unit day carries it in.
    ingest(ctx, V(R("2026-10-09", "40310316210829.72")));
    await executeProgramPending(ctx, prog);
    const b9 = ledger.burn(T, F, "2026-10-09")!;
    assert.equal(b9.carriedInLamports, b.carriedOutLamports);
  });

  test("BURN-POOL CAP BOUND: above 25 SOL the rule applies to the cap; the excess stays in the fee PDA; recorded as partial", async () => {
    prog.registerPool(); prog.deposit(BigInt(40) * SOL); prog.poolReserveWsol = BigInt(100_000) * SOL;
    ingest(ctx, V(D7, D8));
    await executeProgramPending(ctx, prog);
    const b = ledger.burn(T, F, "2026-10-08")!;
    assert.equal(b.poolLamports, BigInt(25) * SOL); assert.equal(b.poolActualLamports, BigInt(40) * SOL);
    assert.equal(b.ruleSpendLamports, programSpend(BigInt(25) * SOL, BigInt(21), 200));
    assert.match(status().burns[0].partial!, /burn-pool cap bound: the rule applied to 25 of 40 SOL/);
  });

  test("BELOW THE FLOOR: the program buys nothing — the row is skipped with the program's reason, still verified", async () => {
    prog.registerPool(); prog.deposit(BigInt(10_000)); // 0.00001 SOL
    ingest(ctx, V(D7, R("2026-10-08", "40285036147367.19"))); // +$1B → 1 unit
    const rep = await executeProgramPending(ctx, prog);
    assert.equal(rep.cranks[0].outcome, "skipped");
    const b = ledger.burn(T, F, "2026-10-08")!;
    assert.equal(b.status, "skipped"); assert.equal(b.chainOutcome, "below-floor"); assert.match(b.skippedReason!, /under its floor/);
    assert.equal(status().burns[0].verify.verified, true);
  });

  test("POOL HEALTH: check_pool_health once per cycle; an untradeable pool defers the crank (PoolNotTradable wait) and shows on the status page", async () => {
    prog.registerPool(); prog.deposit(BigInt(5) * SOL); prog.poolTradable = false;
    ingest(ctx, V(D7, D8));
    const rep = await executeProgramPending(ctx, prog);
    assert.equal(prog.healthCalls, 1);
    assert.match(rep.health!, /UNTRADEABLE/);
    assert.equal(rep.cranks[0].outcome, "waiting"); assert.match(ledger.burn(T, F, "2026-10-08")!.waitReason!, /^PoolNotTradable/);
    assert.ok(status().s.program!.pool.untradeableSince);
    await executeProgramPending(ctx, prog);
    assert.equal(prog.healthCalls, 2, "once per cycle");
  });

  test("CLAIMS ARE BEST-EFFORT: a throwing claim is logged and the crank goes on; notes and sent claims are reported", async () => {
    prog.registerPool(); prog.deposit(BigInt(5) * SOL);
    prog.claim = new Error("LaunchLab vault not found");
    ingest(ctx, V(D7, D8));
    const rep = await executeProgramPending(ctx, prog);
    assert.match(rep.claims[0], /claim failed: LaunchLab vault not found/);
    assert.equal(rep.cranks[0].outcome, "confirmed");
    setup(buybackRules()); prog.registerPool();
    prog.claim = (p) => { p.wsol += BigInt(2) * SOL; return { sent: ["claimSig1"], notes: ["cpmm: nothing accrued"] }; };
    ingest(ctx, V(D7, D8));
    const r2 = await executeProgramPending(ctx, prog);
    assert.deepEqual(r2.claims, ["sent claimSig1", "cpmm: nothing accrued"]);
    assert.equal(ledger.burn(T, F, "2026-10-08")!.poolLamports, BigInt(2) * SOL, "the claimed WSOL counts in the program's pool");
  });

  test("CRASH AFTER SEND: the crank's signature was written first; the next cycle waits while it may land, then adopts it — one crank", async () => {
    prog.registerPool(); prog.deposit(BigInt(5) * SOL);
    ingest(ctx, V(D7, D8));
    prog.dropSends = true;
    const r1 = await executeProgramPending(ctx, prog);
    assert.equal(r1.readings[0].outcome, "waiting", "the first reading was dropped: nothing after it is signed");
    prog.land(prog.signed[0].sig); prog.dropSends = false;
    const r2 = await executeProgramPending(ctx, prog);
    assert.deepEqual(r2.readings.map((r) => [r.recordDate, r.outcome]), [["2026-10-07", "adopted"], ["2026-10-08", "submitted"]]);
    assert.equal(ledger.signatures(T, F, "2026-10-07", "reading")[0].status, "confirmed");
    assert.equal(r2.cranks[0].outcome, "confirmed");
    setup(buybackRules()); prog.registerPool(); prog.deposit(BigInt(5) * SOL);
    ingest(ctx, V(D7, D8));
    const realPlan = prog.planCrank.bind(prog);
    prog.planCrank = async () => ({ status: "idle" });
    await executeProgramPending(ctx, prog);
    prog.planCrank = realPlan;
    // readings in; now the crank is dropped
    prog.dropSends = true;
    const c1 = await executeProgramPending(ctx, prog);
    assert.equal(c1.cranks[0].outcome, "waiting");
    assert.equal(ledger.burn(T, F, "2026-10-08")!.status, "sending");
    const c2 = await executeProgramPending(ctx, prog);
    assert.equal(c2.cranks[0].outcome, "waiting", "still inside its blockhash life: no second crank signed");
    const cranks = () => prog.signed.filter((s) => s.payload.kind === "crank");
    assert.equal(cranks().length, 1);
    prog.land(cranks()[0].sig); prog.dropSends = false;
    const c3 = await executeProgramPending(ctx, prog);
    assert.equal(c3.cranks[0].outcome, "confirmed"); assert.equal(cranks().length, 1);
    assert.equal(ledger.burn(T, F, "2026-10-08")!.signature, cranks()[0].sig);
  });

  test("an expired, never-landed crank is re-signed; the program — not the keeper — fixes the amounts", async () => {
    prog.registerPool(); prog.deposit(BigInt(5) * SOL);
    ingest(ctx, V(D7, D8));
    const realPlan = prog.planCrank.bind(prog);
    prog.planCrank = async () => ({ status: "idle" });
    await executeProgramPending(ctx, prog);
    prog.planCrank = realPlan;
    prog.dropSends = true;
    await executeProgramPending(ctx, prog);
    prog.height += 1_000; prog.dropSends = false;
    const out = await executeProgramPending(ctx, prog);
    assert.equal(out.cranks[0].outcome, "confirmed");
    assert.deepEqual(ledger.signatures(T, F, "2026-10-08", "crank").map((s) => s.status), ["expired", "confirmed"]);
  });

  test("A STRANGER CRANKED (cranking is permissionless): the processed reading is adopted from its own transaction, nothing re-sent", async () => {
    prog.registerPool(); prog.deposit(BigInt(5) * SOL);
    ingest(ctx, V(D7, D8));
    const realPlan = prog.planCrank.bind(prog);
    prog.planCrank = async () => ({ status: "idle" });
    await executeProgramPending(ctx, prog);
    prog.planCrank = realPlan;
    const sig = prog.strangerCrank()!;
    const rep = await executeProgramPending(ctx, prog);
    assert.equal(rep.cranks[0].outcome, "confirmed"); if (rep.cranks[0].outcome === "confirmed") assert.equal(rep.cranks[0].adopted, true);
    assert.equal(ledger.burn(T, F, "2026-10-08")!.signature, sig);
    assert.equal(prog.signed.filter((s) => s.payload.kind === "crank").length, 0);
  });

  test("a crank refused for another reason is an ERROR with backoff (not a wait)", async () => {
    prog.registerPool(); prog.deposit(BigInt(5) * SOL);
    ingest(ctx, V(D7, D8));
    const realSim = prog.simulate.bind(prog);
    prog.simulate = async (rawTx) => (new TextDecoder().decode(rawTx).startsWith("fakecrank") ? { err: "InvalidCpmmAccount", logs: [] } : realSim(rawTx));
    const rep = await executeProgramPending(ctx, prog);
    assert.equal(rep.cranks[0].outcome, "error");
    const b = ledger.burn(T, F, "2026-10-08")!;
    assert.match(b.lastError!, /InvalidCpmmAccount/); assert.ok(b.nextAttemptAt! > clock); assert.equal(b.waitReason, null);
  });

  test("DRY RUN signs nothing; a config for another rule file, mode or prefix is refused; a ledger with legacy burns is refused", async () => {
    ingest(ctx, V(D7, D8));
    const rep = await executeProgramPending({ ...ctx, dryRun: true }, prog);
    assert.equal(rep.readings[0].outcome, "dry-run"); assert.equal(prog.signed.length, 0);
    assert.match(configRefusal({ ...prog.cfg, rulesSha256: "00".repeat(32) }, loaded)!, /rules sha256/);
    assert.match(configRefusal({ ...prog.cfg, mode: "vault" }, loaded)!, /vault mode/);
    assert.match(configRefusal({ ...prog.cfg, memoPrefix: "XX" }, loaded)!, /prefix XX/);
    assert.match(configRefusal({ ...prog.cfg, valueDecimals: 0 }, loaded)!, /cents/);
    const noCfg = { ...prog, config: async () => null } as unknown as FakeProgram;
    await assert.rejects(executeProgramPending(ctx, noCfg), /initialize_token must run first/);
    ledger.markConfirmed(T, F, "2026-10-08", { signature: "legacySig", slot: 1, burnRaw: BigInt(1), memo: "m" });
    await assert.rejects(executeProgramPending(ctx, prog), /legacy leg — program execution needs a fresh BURNKEEPER_DB/);
  });
});

describe("program execution, vault mode and no-units readings", () => {
  test("crank_vault burns units × tokens from the program's vault, carries the shortfall (memo v1), then exhausts", async () => {
    setup(vaultRules(), { vaultAllocation: raw("3000000") });
    prog.vaultTokens = raw("1500000");
    ingest(ctx, V(D7, D8));
    const rep = await executeProgramPending(ctx, prog);
    assert.equal(rep.cranks[0].outcome, "confirmed");
    const b = ledger.burn(T, F, "2026-10-08")!;
    assert.equal(b.chainOutcome, "short"); assert.equal(b.burnRaw, raw("1500000")); assert.equal(b.shortOutRaw, raw("600000")); assert.equal(b.owedRaw, raw("2100000"));
    assert.match(b.memo!, /\|units=21\|burn=1500000\|short=600000\|/); assert.ok(parseDebtMemo(b.memo!));
    assert.equal(status().burns[0].verify.verified, true, status().burns[0].verify.checks.join("; "));
    prog.vaultTokens = raw("5000000");
    ingest(ctx, V(R("2026-10-09", "40320316210829.72"), R("2026-10-13", "40340316210829.72")));
    const r2 = await executeProgramPending(ctx, prog);
    assert.deepEqual(r2.cranks.map((c) => c.outcome), ["confirmed", "exhausted"]);
    assert.equal(ledger.burn(T, F, "2026-10-09")!.burnRaw, raw("1500000"), "allocation left (3,000,000 − 1,500,000) caps what is owed");
    assert.equal(ledger.burn(T, F, "2026-10-13")!.status, "exhausted");
  });

  test("a down day is processed by the program on submission (no units, no crank); out of line it needs crank_no_units — the keeper sends it", async () => {
    setup(buybackRules());
    ingest(ctx, V(D7, D8, R("2026-10-09", "40300316210829.72"))); // 10-09 is a down day
    const r1 = await executeProgramPending(ctx, prog); // no pool → 10-08 waits; 10-09 (down) cannot auto-process: not next in line
    assert.deepEqual(r1.readings.map((r) => [r.recordDate, r.units]), [["2026-10-07", 0], ["2026-10-08", 21], ["2026-10-09", 0]]);
    assert.equal((await prog.reading(20261009))!.processed, false);
    prog.registerPool(); prog.deposit(BigInt(5) * SOL); clock += WAIT_MS + 1;
    const r2 = await executeProgramPending(ctx, prog);
    assert.deepEqual(r2.cranks.map((c) => [c.recordDate, c.outcome]), [["2026-10-08", "confirmed"], ["2026-10-09", "skipped"]]);
    assert.equal((await prog.reading(20261009))!.outcome, "no-units");
    assert.equal(prog.signed.filter((s) => s.payload.kind === "crank" && s.payload.crank === "no_units").length, 1);
    assert.equal(prog.cfg.crankCursor, 20261009);
  });
});
const WAIT_MS = 10 * 60_000;

describe("program execution — client v3 (second blind review)", () => {
  const OP2 = "SecondOperator11111111111111111111111111111", OP3 = "ThirdOperator111111111111111111111111111111";
  test("QUORUM 2 and 3 with every key held locally: one shared-message reading per day, all keys counted, the legacy transaction fits", async () => {
    for (const keys of [[KEEPER, OP2], [KEEPER, OP2, OP3]]) {
      setup(buybackRules(), { attesters: keys, quorum: keys.length, heldKeys: keys });
      ingest(ctx, V(D7, D8));
      const rep = await executeProgramPending(ctx, prog);
      assert.deepEqual(rep.readings.map((r) => r.outcome), ["submitted", "submitted"]);
      assert.equal(prog.readings.get(20261008)!.signersMask, (1 << keys.length) - 1, "every held key counted once");
      assert.ok(prog.lastReadingBytes <= 1_232, `${keys.length} keys: ${prog.lastReadingBytes} B`);
    }
    // The client's measured sizes for the 358-byte v3 message (programs/burn-receipts tests/review2.rs).
    assert.deepEqual([1, 2, 3, 4].map((n) => readingTxBytes(n, 358)), [966, 1_076, 1_186, 1_296]);
    // Quorum ≤ 3 (the program refuses 4–5 at init); more than 3 keys never sign one reading.
    assert.throws(() => fake(buybackRules(), { attesters: [KEEPER, OP2, OP3, "Fourth111111111111111111111111111111111111"], quorum: 4 }), /InvalidAttesters/);
    setup(buybackRules(), { attesters: [KEEPER, OP2, OP3], quorum: 3, heldKeys: [KEEPER, OP2, OP3, "Fourth111111111111111111111111111111111111"] });
    await assert.rejects(prog.buildReading({ recordDate: 20261007, prevDate: 0, value: D7.cents, sourceUrl: "x", feedId: F, valueDecimals: 2 }), /at most 3/);
  });
  test("the Solana adapter signs with at most maxLocalAttesters keys (default 1, never more than 3) — refused before any RPC call", async () => {
    const ks = Array.from({ length: 4 }, () => Keypair.generate());
    const port = (n: number, max?: number) => solanaProgramPort({ connection: {} as never, programId: new PublicKey(Buffer.alloc(32, 3)), mint: new PublicKey(Buffer.alloc(32, 4)), cluster: "localnet", payer: ks[0], attesters: ks.slice(0, n), maxLocalAttesters: max });
    const args = { recordDate: 20261007, prevDate: 0, value: D7.cents, sourceUrl: "x", feedId: F, valueDecimals: 2 };
    await assert.rejects(port(2).buildReading(args), /at most 1 attester key/);
    await assert.rejects(port(4, 9).buildReading(args), /at most 3 attester key/);
    assert.ok(port(1).retryableErrors!.has("WsolBalanceMismatch"), "the client's deferrable errors are the adapter's retryable set");
  });
  test("WsolBalanceMismatch (a stale fee-WSOL balance) is a WAIT, not an error; a stray lamport on the fee WSOL account is synced into the pool", async () => {
    setup(buybackRules());
    prog.deposit(BigInt(5) * SOL);
    ingest(ctx, V(D7, D8));
    await executeProgramPending(ctx, prog); // readings in; no pool yet
    prog.registerPool(); prog.simErr = "WsolBalanceMismatch"; clock += WAIT_RETRY_MS + 1;
    const r1 = await executeProgramPending(ctx, prog);
    assert.equal(r1.cranks[0].outcome, "waiting"); assert.match((r1.cranks[0] as { why?: string }).why ?? "", /^WsolBalanceMismatch: waiting — the program reported a retryable condition/);
    assert.equal(ledger.burn(T, F, "2026-10-08")!.attempts, 0, "a wait is not an attempt");
    prog.simErr = null; prog.strayWsolLamports = BigInt(1); clock += WAIT_RETRY_MS + 1;
    const r2 = await executeProgramPending(ctx, prog);
    assert.equal(r2.cranks[0].outcome, "confirmed");
    const rd = prog.readings.get(20261008)!;
    assert.equal(rd.poolActualLamports, BigInt(5) * SOL + BigInt(1), "the stray lamport is part of the pool");
    assert.equal(rd.pool, prog.cfg.pool, "the reading records the pool it traded on");
    assert.equal(ledger.burn(T, F, "2026-10-08")!.swapPool, prog.cfg.pool);
  });
  test("a dead pool: check_pool_health keeps the spell continuous (daily), and after 30 days the program processes the day below-floor with the target carried", async () => {
    setup(buybackRules());
    prog.registerPool(); prog.deposit(BigInt(5) * SOL); prog.poolTradable = false;
    ingest(ctx, V(D7, D8));
    const r0 = await executeProgramPending(ctx, prog);
    assert.match((r0.cranks[0] as { why?: string }).why ?? "", /^PoolNotTradable/);
    const since = prog.cfg.poolUntradeableSince!;
    for (let day = 1; day < 30; day++) { clock += 86_400_000; const r = await executeProgramPending(ctx, prog); assert.equal(r.cranks[0].outcome, "waiting", `day ${day}`); }
    assert.equal(prog.cfg.poolUntradeableSince, since, "observations ≤ 24 h apart keep one spell");
    clock += 86_400_000; // day 30, still ≤ 24 h after the previous observation
    await executeProgramPending(ctx, prog);
    const rd = prog.readings.get(20261008)!;
    assert.equal(rd.outcome, "below-floor"); assert.equal(rd.spentLamports, BigInt(0));
    assert.ok(rd.carriedOutLamports > BigInt(0) && prog.cfg.carriedSpendLamports === rd.carriedOutLamports, "the whole target is carried");
    // A gap of more than 24 h between observations restarts the spell.
    setup(buybackRules());
    prog.registerPool(); prog.poolTradable = false;
    await prog.checkPoolHealth(); const s0 = prog.cfg.poolUntradeableSince!;
    clock += 25 * 3_600_000; await prog.checkPoolHealth();
    assert.ok(prog.cfg.poolUntradeableSince! > s0);
  });
});
