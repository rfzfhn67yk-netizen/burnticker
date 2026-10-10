// BURN KEEPER (2026-10-09, $DEFICIT / rule DEBT) — the rule file, the money arithmetic and the rule itself (SPEC §2): units per full
// $1B, the carry across consecutive increases only, the reset on a down or flat day, the vault-only settlement with its public shortfall.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { belowFloor, buybackSpend, centsToUsd, debtStep, deltaImplausible, loadRules, parseFraction, parseRules, rawToTokens, rulesFromText, rulesSha256, settleBurn, solToLamports, spendablePool, tokenStringToRaw, tokensToRaw, usdToCents, vestedRaw } from "@/lib/burnKeeper/rules";

const root = path.resolve(import.meta.dirname, "..");
const RULES = path.join(root, "config/burnkeeper/deficit.rules.json");
const B = (n: number | string) => BigInt(n);
const usd = (s: string) => usdToCents(s);

describe("the rule file", () => {
  test("config/burnkeeper/deficit.rules.json parses; ticker DEFICIT, rule key DEBT, memo prefix DEBT", () => {
    const l = loadRules(RULES);
    assert.equal(l.rules.ticker, "DEFICIT");
    assert.equal(l.rules.token, "DEBT");
    assert.equal(l.rules.memo.prefix, "DEBT");
    assert.equal(l.rules.totalSupply, "1000000000");
    assert.equal(l.rules.rule.unitUsd, "1000000000");
    assert.equal(l.rules.rule.burnPerUnitTokens, "100000");
    assert.equal(BigInt(l.rules.rule.burnPerUnitTokens) * B(10_000), BigInt(l.rules.totalSupply), "100,000 = 0.01% of supply");
    assert.equal(l.rules.vault.kind, "vesting");
    assert.equal(l.rules.vault.shortfall, "carry-until-vault-refills");
  });
  test("the hash is of the exact bytes (a stranger's shasum agrees); sha12 is its prefix", () => {
    const text = fs.readFileSync(RULES, "utf8");
    const l = rulesFromText(text);
    assert.equal(l.sha256, rulesSha256(Buffer.from(text, "utf8")));
    assert.match(l.sha256, /^[0-9a-f]{64}$/);
    assert.equal(l.sha12, l.sha256.slice(0, 12));
    assert.notEqual(rulesFromText(text.replace("\n}", " \n}")).sha256, l.sha256, "one byte different → a different hash");
  });
  test("strict: an unknown kind, a missing carry policy, a non-integer amount or a wrong prefix is refused with every problem listed", () => {
    const good = JSON.parse(fs.readFileSync(RULES, "utf8"));
    const bad = { ...good, rule: { ...good.rule, kind: "percent", carry: undefined, unitUsd: "1e9" }, memo: { ...good.memo, prefix: "DEFICIT" } };
    assert.throws(() => parseRules(bad), (e: Error) => /rule\.kind/.test(e.message) && /rule\.carry/.test(e.message) && /rule\.unitUsd/.test(e.message) && /memo\.prefix/.test(e.message));
    assert.throws(() => parseRules({ ...good, vaultAllocation: "2000000000" }), /exceeds totalSupply/);
    assert.throws(() => parseRules({ ...good, schema: "burnkeeper.rules/v2" }), /schema/);
    assert.throws(() => rulesFromText("{not json"), /not valid JSON/);
  });
});

describe("money is integer cents", () => {
  test("parse and format round-trip, including one decimal and negatives", () => {
    assert.equal(usd("40305316210829.72"), B("4030531621082972"));
    assert.equal(centsToUsd(usd("40305316210829.72")), "40305316210829.72");
    assert.equal(centsToUsd(usd("12.5")), "12.50");
    assert.equal(centsToUsd(B(-9119061362600)), "-91190613626.00");
    assert.throws(() => usd("1.234"));
    assert.throws(() => usd("NaN"));
    assert.throws(() => usd("1e12"));
  });
  test("token strings ⇄ raw at 6 decimals", () => {
    assert.equal(rawToTokens(tokensToRaw("2100000", 6), 6), "2100000");
    assert.equal(rawToTokens(B(12_500_000), 6), "12.5");
    assert.equal(tokenStringToRaw("12.5", 6), B(12_500_000));
    assert.equal(tokenStringToRaw("50958904.10959", 6), B("50958904109590"));
    assert.throws(() => tokenStringToRaw("1.1234567", 6));
  });
});

describe("the $DEBT rule (SPEC §2)", () => {
  const { rules } = loadRules(RULES);
  test("the spec's example: 10-07 → 10-08, +$21,280,063,462.53 → 21 units → 2,100,000 tokens, $280,063,462.53 carried", () => {
    const s = debtStep(rules, usd("40284036147367.19"), usd("40305316210829.72"), B(0));
    assert.equal(centsToUsd(s.deltaCents), "21280063462.53");
    assert.equal(s.units, 21);
    assert.equal(s.burnTokens, B(2_100_000));
    assert.equal(centsToUsd(s.carryOutCents), "280063462.53");
    assert.equal(s.kind, "increase");
  });
  test("the remainder carries across consecutive increases: $0.6B + $0.6B = 1 unit, $0.2B carried", () => {
    const a = debtStep(rules, usd("40000000000000.00"), usd("40000600000000.00"), B(0));
    assert.equal(a.units, 0); assert.equal(centsToUsd(a.carryOutCents), "600000000.00");
    const b = debtStep(rules, usd("40000600000000.00"), usd("40001200000000.00"), a.carryOutCents);
    assert.equal(b.units, 1); assert.equal(centsToUsd(b.carryOutCents), "200000000.00");
  });
  test("a down day burns nothing, banks no credit and RESETS the carry", () => {
    const s = debtStep(rules, usd("40000000000000.00"), usd("39990000000000.00"), usd("900000000.00"));
    assert.equal(s.units, 0); assert.equal(s.burnTokens, B(0)); assert.equal(s.carryOutCents, B(0)); assert.equal(s.kind, "down");
    const next = debtStep(rules, usd("39990000000000.00"), usd("39990500000000.00"), s.carryOutCents);
    assert.equal(next.units, 0, "the $0.9B carried before the down day is gone — $0.5B is under a unit");
  });
  test("a flat day is not an increase: no burn, carry reset", () => {
    const s = debtStep(rules, usd("40000000000000.00"), usd("40000000000000.00"), usd("999999999.99"));
    assert.equal(s.kind, "flat"); assert.equal(s.units, 0); assert.equal(s.carryOutCents, B(0));
  });
  test("exactly $1B is one unit; a cent less is none", () => {
    assert.equal(debtStep(rules, usd("40000000000000.00"), usd("40001000000000.00"), B(0)).units, 1);
    assert.equal(debtStep(rules, usd("40000000000000.00"), usd("40000999999999.99"), B(0)).units, 0);
  });
  test("a corrupt carry (negative or ≥ one unit) throws rather than burning a number nobody can reproduce", () => {
    assert.throws(() => debtStep(rules, usd("1.00"), usd("2.00"), B(-1)), /corrupt/);
    assert.throws(() => debtStep(rules, usd("1.00"), usd("2.00"), usd("1000000000.00")), /corrupt/);
  });
  test("plausibility: |delta| > $2T is implausible, $2T exactly is not", () => {
    assert.equal(deltaImplausible(rules, usd("2000000000000.00")), false);
    assert.equal(deltaImplausible(rules, usd("2000000000000.01")), true);
    assert.equal(deltaImplausible(rules, -usd("2000000000000.01")), true);
  });
});

describe("vault-only settlement with a public shortfall (the vesting vault, 10-09 evening)", () => {
  test("enough in the vault: burn the plan, no shortfall", () => {
    assert.deepEqual(settleBurn({ plannedRaw: B(100), shortfallInRaw: B(0), vaultRaw: B(1_000), allocationLeftRaw: B(10_000) }), { owedRaw: B(100), burnRaw: B(100), shortfallRaw: B(0), exhausted: false });
  });
  test("vault short: burn what is there, carry the rest; the next day owes plan + carried", () => {
    const d1 = settleBurn({ plannedRaw: B(100), shortfallInRaw: B(0), vaultRaw: B(30), allocationLeftRaw: B(10_000) });
    assert.deepEqual(d1, { owedRaw: B(100), burnRaw: B(30), shortfallRaw: B(70), exhausted: false });
    const d2 = settleBurn({ plannedRaw: B(50), shortfallInRaw: d1.shortfallRaw, vaultRaw: B(500), allocationLeftRaw: B(10_000) - d1.burnRaw });
    assert.deepEqual(d2, { owedRaw: B(120), burnRaw: B(120), shortfallRaw: B(0), exhausted: false });
  });
  test("empty (not exhausted) vault: burn 0, the whole owed amount is the shortfall — the day is still posted", () => {
    assert.deepEqual(settleBurn({ plannedRaw: B(100), shortfallInRaw: B(5), vaultRaw: B(0), allocationLeftRaw: B(10_000) }), { owedRaw: B(105), burnRaw: B(0), shortfallRaw: B(105), exhausted: false });
  });
  test("owed is capped at the allocation left; a used-up allocation owes nothing, ever", () => {
    assert.deepEqual(settleBurn({ plannedRaw: B(100), shortfallInRaw: B(50), vaultRaw: B(1_000), allocationLeftRaw: B(80) }), { owedRaw: B(80), burnRaw: B(80), shortfallRaw: B(0), exhausted: false });
    assert.equal(settleBurn({ plannedRaw: B(100), shortfallInRaw: B(50), vaultRaw: B(1_000), allocationLeftRaw: B(0) }).exhausted, true);
  });
  test("linear vest: nothing before the cliff, linear after, all at the end", () => {
    const day = 86_400_000, a = B(365_000_000);
    assert.equal(vestedRaw(a, 0, 10 * day, 30, 365), B(0));
    assert.equal(vestedRaw(a, 0, (30 + 73) * day, 30, 365), B(73_000_000));
    assert.equal(vestedRaw(a, 0, 1_000 * day, 30, 365), a);
    assert.equal(vestedRaw(a, 0, 1, 0, 0), a, "no vest = all at once");
  });
});

describe("BUYBACK mode (the primary mechanic since 10-09 evening)", () => {
  test("the committed file: mode buyback, source fee-pool-buyback, memo v2, mint null until launch, 1% per unit (owner decision 2026-10-09, recorded in the file), $1 floor, 0.02 SOL reserve, no router (program execution)", () => {
    const { rules } = loadRules(RULES);
    assert.equal(rules.mode, "buyback");
    assert.equal(rules.source, "fee-pool-buyback");
    assert.equal(rules.memo.version, "v2");
    assert.equal(rules.mint, null);
    assert.deepEqual([rules.buyback.fractionPerUnit, rules.buyback.floorUsd, rules.buyback.reserveSol, rules.buyback.router, rules.buyback.burnShare], ["0.01", "1", "0.02", undefined, "all-received"]);
    assert.match((rules.buyback as unknown as { fractionPerUnitDecision: string }).fractionPerUnitDecision, /OWNER DECISION 2026-10-09: 0\.01/);
    assert.doesNotMatch(JSON.stringify(rules), /PENDING|jupiter|next transaction/i, "no stale pre-program wording inside the hashed bytes");
    assert.match(rules.statement, /burn_receipts program[\s\S]*CPMM pool[\s\S]*same instruction/, "the statement describes program execution");
    assert.match(rules.statement, /1 - 0\.99\^units/, "the statement names the same fraction as the dial");
    assert.equal(buybackSpend(BigInt(1_000_000_000), 1, rules.buyback.fractionPerUnit), BigInt(10_000_000), "1 unit = 1% of the pool");
    assert.equal(buybackSpend(BigInt(1_000_000_000), 21, rules.buyback.fractionPerUnit), BigInt(190_272_132), "21 units = 1 − 0.99^21 ≈ 19.03% (keep = floor(1e9 × 99^21 / 100^21) = 809,727,868)");
  });
  test("mode, source and memo version must agree; a bad fraction or a bad mint is refused", () => {
    const good = JSON.parse(fs.readFileSync(RULES, "utf8"));
    assert.throws(() => parseRules({ ...good, mode: "vault" }), /source must be "vault-only"/);
    assert.throws(() => parseRules({ ...good, memo: { ...good.memo, version: "v1" } }), /version: v2/);
    assert.throws(() => parseRules({ ...good, buyback: { ...good.buyback, fractionPerUnit: "1.5" } }), /buyback must be/);
    assert.throws(() => parseRules({ ...good, mint: "not a mint" }), /mint must be null/);
    assert.equal(parseRules({ ...good, buyback: { ...good.buyback, router: "jupiter" } }).buyback.router, "jupiter", "router stays accepted for legacy files");
    assert.throws(() => parseRules({ ...good, buyback: { ...good.buyback, router: "raydium" } }), /buyback must be/);
    assert.equal(parseRules({ ...good, mint: "So11111111111111111111111111111111111111112" }).mint, "So11111111111111111111111111111111111111112");
  });
  test("spend = pool × (1 − 0.95^units), exact: 1 unit = 5%, 2 units = 9.75%, 0 units = nothing, never more than the pool", () => {
    const pool = BigInt(1_000_000_000);
    assert.equal(buybackSpend(pool, 1, "0.05"), BigInt(50_000_000));
    assert.equal(buybackSpend(pool, 2, "0.05"), BigInt(97_500_000));
    assert.equal(buybackSpend(pool, 0, "0.05"), BigInt(0));
    assert.equal(buybackSpend(BigInt(0), 5, "0.05"), BigInt(0));
    const big = buybackSpend(pool, 366, "0.05");   // the 2025-07-07 day
    assert.ok(big <= pool && big > pool - BigInt(10), "a 366-unit day spends ≈ the whole pool, never more");
    // floor(keep) → the spend rounds UP by under a lamport; a stranger reproduces it with the same integer arithmetic
    assert.equal(buybackSpend(BigInt(7), 1, "0.05"), BigInt(1));
    assert.deepEqual(parseFraction("0.05"), { p: BigInt(5), q: BigInt(100) });
    assert.throws(() => parseFraction("0"), /fraction/);
  });
  test("the pool is the balance less the 0.02 SOL reserve; the $1 floor at the SOL price read at execution", () => {
    assert.equal(solToLamports("0.02"), BigInt(20_000_000));
    assert.equal(spendablePool(BigInt(1_020_000_000), "0.02"), BigInt(1_000_000_000));
    assert.equal(spendablePool(BigInt(10), "0.02"), BigInt(0));
    assert.equal(belowFloor(BigInt(6_000_000), 150, "1"), true, "0.006 SOL × $150 = $0.90");
    assert.equal(belowFloor(BigInt(7_000_000), 150, "1"), false, "$1.05");
  });
});
