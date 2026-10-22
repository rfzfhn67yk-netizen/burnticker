import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  buybackMinOut, buybackSpend, buybackSpendExact, deltaPlausible, formatDate, formatFixed, formatSignedFixed, hex12, minAmountOut, parseDate, parseFixed,
  rawToTokens, ruleParamsFromKeeperRules, settleVault, solPriceX32, spendablePool, step, twapOk, utcDate, validDate,
} from "../src/lib/burnReceipts/math.ts";
import { CARRY_CONSECUTIVE, CARRY_NONE, KIND_DOWN, KIND_FLAT, KIND_INCREASE, MODE_BUYBACK, MODE_VAULT } from "../src/lib/burnReceipts/constants.ts";

/** The TS mirror of programs/burn-receipts/programs/burn_receipts/src/math.rs — the SAME vectors as the Rust `math::tests`. */
const B = BigInt;
const UNIT = B(100_000_000_000); // $1B in cents

describe("burnReceipts math — units and carry", () => {
  test("SPEC §4 example: $21.28B → 21 units, the remainder carries", () => {
    const s = step(B("4028403614736719"), B("4030531621082972"), B(0), UNIT, CARRY_CONSECUTIVE);
    assert.equal(s.kind, KIND_INCREASE);
    assert.equal(s.delta, B("2128006346253"));
    assert.equal(s.units, B(21));
    assert.equal(s.carryOut, B("28006346253"));
  });
  test("carry only across consecutive increases; a down or flat day resets it; CARRY_NONE drops it", () => {
    const a = step(B(0), B(60_000_000_000), B(0), UNIT, CARRY_CONSECUTIVE);
    assert.deepEqual([a.units, a.carryOut], [B(0), B(60_000_000_000)]);
    const b = step(B(60_000_000_000), B(130_000_000_000), a.carryOut, UNIT, CARRY_CONSECUTIVE);
    assert.deepEqual([b.units, b.carryOut], [B(1), B(30_000_000_000)]);
    const c = step(B(130_000_000_000), B(120_000_000_000), b.carryOut, UNIT, CARRY_CONSECUTIVE);
    assert.deepEqual([c.kind, c.units, c.carryOut], [KIND_DOWN, B(0), B(0)]);
    const d = step(B(120_000_000_000), B(200_000_000_000), c.carryOut, UNIT, CARRY_CONSECUTIVE);
    assert.deepEqual([d.units, d.carryOut], [B(0), B(80_000_000_000)]);
    const f = step(B(200_000_000_000), B(200_000_000_000), d.carryOut, UNIT, CARRY_CONSECUTIVE);
    assert.deepEqual([f.kind, f.units, f.carryOut], [KIND_FLAT, B(0), B(0)]);
    const g = step(B(0), B(250_000_000_000), B(0), UNIT, CARRY_NONE);
    assert.deepEqual([g.units, g.carryOut], [B(2), B(0)]);
    assert.throws(() => step(B(0), B(1), UNIT, UNIT, CARRY_CONSECUTIVE), /carry/);
  });
  test("plausibility bound", () => {
    assert.equal(deltaPlausible(B(-5), B(5)), true);
    assert.equal(deltaPlausible(B(6), B(5)), false);
  });
});

describe("burnReceipts math — the buyback rule", () => {
  // SPEND_VECTORS — identical to math::tests::spend_vectors in Rust.
  const SPEND_VECTORS: [string, number, number, string][] = [
    ["1000000000", 1, 500, "50000000"],
    ["1000000000", 2, 500, "97500000"],
    ["1000000000", 21, 500, "659438374"],
    ["123456789012", 366, 500, "123456788145"],
    ["5000000000", 0, 500, "0"],
    ["5000000000", 3, 10_000, "5000000000"],
    ["18446744073709551615", 7, 1, "12908847680912705"],
    ["987654321", 13, 777, "642555338"],
  ];
  test("fixed-point spend matches the Rust vectors", () => {
    for (const [pool, units, bps, want] of SPEND_VECTORS) assert.equal(buybackSpend(B(pool), B(units), bps).toString(), want, `${pool}/${units}/${bps}`);
    assert.throws(() => buybackSpend(B(1), B(1), 0));
    assert.throws(() => buybackSpend(B(1), B(1), 10_001));
  });
  test("on-chain fixed point vs the keeper's exact rational: ≤ 1 lamport for pools under 10^15 lamports", () => {
    let worst = B(0);
    for (const pool of [B(1), B(999), B(1_000_000_000), B(77_777_777_777), B(9_000_000_000_000), B(999_999_999_999_999)]) {
      for (const units of [1, 2, 3, 7, 21, 50, 100, 366, 1000]) {
        const d = buybackSpend(pool, B(units), 500) - buybackSpendExact(pool, B(units), 500);
        const a = d < B(0) ? -d : d;
        if (a > worst) worst = a;
      }
    }
    assert.ok(worst <= B(1), `worst difference ${worst}`);
  });
  test("spend never exceeds the pool and grows with units", () => {
    let last = B(-1);
    for (let u = 0; u <= 400; u += 7) {
      const s = buybackSpend(B(10_000_000_000), B(u), 500);
      assert.ok(s <= B(10_000_000_000) && s >= last);
      last = s;
    }
  });
  test("pool = SOL above the reserve + WSOL already held", () => {
    assert.equal(spendablePool(B(10_020_000_000), B(20_000_000), B(500_000_000)), B(10_500_000_000));
    assert.equal(spendablePool(B(1), B(20_000_000), B(7)), B(7));
  });
  test("min-out from reserves (Rust min_out_vectors)", () => {
    assert.equal(minAmountOut(B(1_000_000_000), B(100_000_000_000), B("1000000000000000"), B(2_500), 300), B("9579950495048"));
    assert.equal(minAmountOut(B(1), B(1_000_000_000_000), B(1), B(0), 0), B(0));
    // Review-2 F1: max(spot quote, TWAP quote) — mirrors math::buyback_min_out (src/math.rs unit test).
    const [rs, rt] = [B(100_000_000_000), B("1000000000000000")];
    const spotX32 = (rt << B(32)) / rs;
    const atSpot = minAmountOut(B(2_000_000_000), rs, rt, B(3_500), 300);
    assert.equal(buybackMinOut(B(2_000_000_000), rs, rt, spotX32, B(3_500), 300), atSpot);
    const pushed = (rt / B(100)) * B(97);
    const m = buybackMinOut(B(2_000_000_000), rs, pushed, spotX32, B(3_500), 300);
    assert.ok(m > minAmountOut(B(2_000_000_000), rs, pushed, B(3_500), 300) && m <= atSpot && m >= atSpot - atSpot / B(10_000));
    assert.equal(buybackMinOut(B(2_000_000_000), rs, rt, spotX32 / B(2), B(3_500), 300), atSpot);
    assert.throws(() => minAmountOut(B(1), B(0), B(1), B(0), 0));
  });
  test("TWAP guard (Rust twap_guard)", () => {
    const twap = B(1000) << B(32);
    assert.equal(twapOk(twap, twap, 1_500), true);
    assert.equal(twapOk((twap * B(86)) / B(100), twap, 1_500), true);
    assert.equal(twapOk((twap * B(84)) / B(100), twap, 1_500), false);
    assert.equal(twapOk(twap * B(2), twap, 0), true);
    assert.equal(solPriceX32(B(1), B(1)), B(1) << B(32));
  });
  test("vault settlement (Rust vault_settlement)", () => {
    assert.deepEqual(settleVault(B(2_100_000), B(0), B(10_000_000), B(0), B(0)), { owed: B(2_100_000), burn: B(2_100_000), shortfall: B(0), exhausted: false });
    assert.deepEqual(settleVault(B(2_100_000), B(600_000), B(1_500_000), B(0), B(0)), { owed: B(2_700_000), burn: B(1_500_000), shortfall: B(1_200_000), exhausted: false });
    assert.deepEqual(settleVault(B(2_100_000), B(0), B(9_999_999), B(3_000_000), B(2_000_000)), { owed: B(1_000_000), burn: B(1_000_000), shortfall: B(0), exhausted: false });
    assert.equal(settleVault(B(1), B(0), B(1), B(3_000_000), B(3_000_000)).exhausted, true);
  });
});

describe("burnReceipts math — dates and text (Rust dates_and_text)", () => {
  test("dates", () => {
    assert.equal(validDate(20261008), true);
    assert.equal(validDate(20240229), true);
    assert.equal(validDate(20250229), false);
    assert.equal(validDate(20261301), false);
    assert.equal(validDate(19991231), false);
    assert.equal(utcDate(0), 19700101);
    assert.equal(utcDate(1_791_590_400), 20261010);
    assert.equal(utcDate(1_791_590_399), 20261009);
    assert.equal(formatDate(20261008), "2026-10-08");
    assert.equal(parseDate("2026-10-08"), 20261008);
    assert.throws(() => parseDate("2026-02-30"));
  });
  test("fixed-point text", () => {
    assert.equal(formatFixed(B("4030531621082972"), 2), "40305316210829.72");
    assert.equal(formatSignedFixed(B(-1_000_000_005), 2), "-10000000.05");
    assert.equal(formatSignedFixed(B(5), 2), "0.05");
    assert.equal(formatFixed(B(2272), 3), "2.272");
    assert.equal(parseFixed("40305316210829.72", 2), B("4030531621082972"));
    assert.throws(() => parseFixed("40305316210829.7", 2));
    assert.equal(rawToTokens(B("2100000000000"), 6), "2100000");
    assert.equal(rawToTokens(B(12_500_000), 6), "12.5");
    assert.equal(rawToTokens(B(0), 6), "0");
    assert.equal(rawToTokens(B(1), 6), "0.000001");
    const h = new Uint8Array(32); h[0] = 0xab; h[5] = 0x01;
    assert.equal(hex12(h), "ab0000000001");
  });
});

describe("burnReceipts math — rule params from the keeper's rules.json", () => {
  const deficit = {
    mode: "buyback" as const, decimals: 6, vaultAllocation: "250000000",
    buyback: { fractionPerUnit: "0.05", reserveSol: "0.02", slippageBps: 300 },
    rule: { unitUsd: "1000000000", burnPerUnitTokens: "100000", maxAbsDeltaUsd: "2000000000000", carry: "consecutive-increases", onNonIncrease: "burn-nothing-reset-carry" },
  };
  test("$DEFICIT buyback", () => {
    const r = ruleParamsFromKeeperRules(deficit, { floorLamports: B(5_000_000), maxTwapDeviationBps: 1_500, twapWindowSecs: 600 });
    assert.equal(r.mode, MODE_BUYBACK);
    assert.equal(r.unit_value, UNIT);
    assert.equal(r.max_abs_delta, B("200000000000000"));
    assert.equal(r.fraction_per_unit_bps, 500);
    assert.equal(r.reserve_lamports, B(20_000_000));
    assert.equal(r.slippage_bps, 300);
    assert.equal(r.tokens_per_unit, B(0));
  });
  test("vault alternative", () => {
    const r = ruleParamsFromKeeperRules({ ...deficit, mode: "vault" }, { floorLamports: B(0), maxTwapDeviationBps: 0, twapWindowSecs: 0 });
    assert.equal(r.mode, MODE_VAULT);
    assert.equal(r.tokens_per_unit, B(100_000_000_000));
    assert.equal(r.vault_allocation, B("250000000000000"));
    assert.equal(r.fraction_per_unit_bps, 0);
  });
  test("a fraction finer than a basis point is refused, not rounded", () => {
    assert.throws(() => ruleParamsFromKeeperRules({ ...deficit, buyback: { ...deficit.buyback, fractionPerUnit: "0.00005" } }, { floorLamports: B(0), maxTwapDeviationBps: 0, twapWindowSecs: 0 }));
  });
});
