import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_TARGET_RAISE_LAMPORTS, defaultCurve, feeSplit, graduationCosts, graduationReady, initParamProblems, netBudget, pairPhase, priceMatchedTokens, quoteBuy, quoteRedeem, quoteSell, rentExempt, MAX_SIDE_SHARE_BPS, sideCosts, solAt, soldForSol, TOTAL_SUPPLY, type CurveParams } from "../src/lib/pairCurve/pricing.ts";

/**
 * Fixture math for the pair curve (docs/burnticker/PAIR-CURVE.md §3). The reference numbers below were computed independently (Python
 * big integers, the formulas of the design doc) and are asserted identically by the Rust program's math tests — three implementations,
 * one answer.
 */

const B = (n: number | string) => BigInt(n);
const C = defaultCurve();
const SOL = B(1_000_000_000);

describe("pair curve — reference values (Python == TS == Rust)", () => {
  test("F at fixed points and at sell-out (≈ 85.005 SOL)", () => {
    assert.equal(solAt(C, B(0)), B(0));
    assert.equal(solAt(C, B(1)), B(1));
    assert.equal(solAt(C, B(1_000_000)), B(28));
    assert.equal(solAt(C, B("1000000000000")), B(27_985_075));
    assert.equal(solAt(C, B("400000000000000")), B("17830609213"));
    assert.equal(solAt(C, C.curveSupply), B("85005359057"));
  });
  test("buys: tokens, cost, fee split, total", () => {
    const q1 = quoteBuy(C, B(0), SOL);
    assert.deepEqual([q1.tokensOut, q1.cost, q1.fees.fee, q1.fees.dev, q1.fees.burn, q1.total], [B("34281150163062"), B(990_099_010), B(9_900_990), B(2_475_247), B(7_425_743), SOL]);
    const q2 = quoteBuy(C, B(0), B(3) * SOL);
    assert.deepEqual([q2.tokensOut, q2.cost, q2.fees.fee, q2.total], [B("96666666675462"), B(2_970_297_030), B(29_702_970), B(3) * SOL]);
    const q3 = quoteBuy(C, B("123456789000"), B(2_500_000_001));
    assert.deepEqual([q3.tokensOut, q3.cost, q3.total, q3.soldAfter], [B("81765435134082"), B(2_475_247_526), B(2_500_000_001), B("81888891923082")]);
    // a budget past sell-out buys the rest of the curve and charges only what it used
    const q4 = quoteBuy(C, B(0), B(200) * SOL);
    assert.deepEqual([q4.tokensOut, q4.cost, q4.fees.fee, q4.total], [C.curveSupply, B("85005359057"), B(850_053_590), B("85855412647")]);
    assert.throws(() => quoteBuy(C, C.curveSupply, SOL), /ZeroOutput/);
  });
  test("a sell of half the 3-SOL buy", () => {
    const sold = quoteBuy(C, B(0), B(3) * SOL).soldAfter;
    const q = quoteSell(C, sold, sold / B(2));
    assert.deepEqual([q.gross, q.fees.fee, q.fees.dev, q.fees.burn, q.net], [B(1_555_202_690), B(15_552_026), B(3_888_006), B(11_664_020), B(1_555_202_690 - 15_552_026)]);
    assert.throws(() => quoteSell(C, sold, sold + B(1)), /SellExceedsSold/);
  });
});

describe("pair curve — invariants", () => {
  test("the inverse is exact: F(soldForSol(σ)) ≤ σ < F(soldForSol(σ) + 1)", () => {
    for (const s of [0, 1, 999, 1_000_000_007, 42_500_000_000, 84_000_000_000]) {
      const sigma = B(s);
      const x = soldForSol(C, sigma);
      assert.ok(solAt(C, x) <= sigma);
      if (x < C.curveSupply) assert.ok(solAt(C, x + B(1)) > sigma, `σ ${s}`);
    }
  });
  test("fee split is exact on every amount: dev + burn = fee, dev = floor(fee / 4), fee = floor(x / 100)", () => {
    for (const x of [0, 1, 99, 100, 101, 399, 400, 401, 12_345_678_901]) {
      const f = feeSplit(B(x));
      assert.equal(f.dev + f.burn, f.fee);
      assert.equal(f.fee, B(x) / B(100));
      assert.equal(f.dev, f.fee / B(4));
    }
  });
  test("net budget is maximal and never overspends", () => {
    for (const m of [0, 1, 100, 101, 102, 10_099, 10_100, 10_101, 1_000_000_000, 123_456_789_012]) {
      const n = netBudget(B(m));
      assert.ok(n + feeSplit(n).fee <= B(m));
      assert.ok(n === B(m) || n + B(1) + feeSplit(n + B(1)).fee > B(m));
    }
  });
  test("path independence: any interleaving of buys and sells leaves the vault at exactly F(sold); selling everything drains it to 0", () => {
    // deterministic pseudo-random walk
    let seed = 7;
    const rnd = () => { seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648; return seed; };
    let sold = B(0), vault = B(0);
    const holders: bigint[] = [];
    for (let i = 0; i < 400; i++) {
      if (holders.length === 0 || rnd() % 3 !== 0) {
        try {
          const q = quoteBuy(C, sold, B(rnd() % 5_000_000_000 + 1));
          sold = q.soldAfter; vault += q.cost; holders.push(q.tokensOut);
          assert.ok(q.total <= q.cost + q.fees.fee);
        } catch { /* sold out or dust */ }
      } else {
        const k = rnd() % holders.length;
        const amt = holders[k] / B(1 + (rnd() % 3));
        if (amt === B(0)) continue;
        const q = quoteSell(C, sold, amt);
        sold = q.soldAfter; vault -= q.gross; holders[k] -= amt;
      }
      assert.equal(vault, solAt(C, sold), `step ${i}`);
    }
    // every holder exits, in a scrambled order
    for (const k of holders.map((_, i) => i).sort((a, b) => (a * 7919) % holders.length - (b * 7919) % holders.length)) {
      if (holders[k] === B(0)) continue;
      const q = quoteSell(C, sold, holders[k]);
      sold = q.soldAfter; vault -= q.gross; holders[k] = B(0);
      assert.ok(vault >= B(0), "the vault never goes short");
    }
    assert.equal(sold, B(0));
    assert.equal(vault, B(0), "sells after a void drain to exactly the SOL vault's rent minimum (the curve part is exactly 0)");
  });
  test("rounding never favours the program: a buy followed by selling the same tokens returns exactly the cost to the vault", () => {
    let sold = B("123456789012");
    for (const m of [1_000_003, 777_777_777, 9_999_999_999]) {
      const b = quoteBuy(C, sold, B(m));
      const s = quoteSell(C, b.soldAfter, b.tokensOut);
      assert.equal(s.gross, b.cost, "the vault keeps nothing from a round trip");
      assert.equal(s.soldAfter, sold);
      // fees round down: the trader pays at most fee(cost), never a lamport more
      assert.equal(b.total - b.cost, feeSplit(b.cost).fee);
      sold = b.soldAfter;
    }
  });
});

describe("pair curve — graduation", () => {
  test("the minimum-side-share edge: exactly 25 % passes, one lamport less fails", () => {
    assert.equal(graduationReady(B(25), B(75), B(100), 2_500), true);
    assert.equal(graduationReady(B(25), B(74), B(100), 2_500), false); // under target
    assert.equal(graduationReady(B(250_000_000), B(750_000_000), SOL, 2_500), true);
    assert.equal(graduationReady(B(249_999_999), B(750_000_001), SOL, 2_500), false);
    assert.equal(graduationReady(B(0), B(100) * SOL, SOL, 2_500), false);
    assert.equal(graduationReady(B(50) * SOL, B(50) * SOL, DEFAULT_TARGET_RAISE_LAMPORTS, 2_500), true);
  });
  test("the graduation price match: the pool opens at or a hair above the curve's last price, and never needs more than the reserve", () => {
    const reserve = TOTAL_SUPPLY - C.curveSupply;
    const sold = C.curveSupply;
    const sol = solAt(C, sold);
    assert.ok(priceMatchedTokens(C, sold, sol, B("18446744073709551615")) <= reserve);
    for (const budget of [10, 42, 60, 84]) {
      const q = quoteBuy(C, B(0), B(budget) * SOL);
      const poolSol = q.solAfter - sideCosts(B(150_000_000));
      const t = priceMatchedTokens(C, q.soldAfter, poolSol, TOTAL_SUPPLY - q.soldAfter);
      const sRes = C.virtualSol + q.solAfter, tRes = C.virtualToken - q.soldAfter;
      assert.ok(poolSol * tRes >= sRes * t, "pool price ≥ curve price");
      assert.ok(poolSol * tRes < sRes * (t + B(1)), "and within one raw token of it");
      assert.ok(t <= TOTAL_SUPPLY - q.soldAfter, "never more than the vault holds");
    }
  });
  test("graduation costs: CPMM's take and the side's overhead (devnet/mainnet create-pool fee 0.15 SOL)", () => {
    assert.equal(rentExempt(0), B(650_240), "mainnet/devnet 2026-10-10: solana rent 0 = 0.00065024 SOL");
    assert.equal(rentExempt(165), B(1_488_440), "solana rent 165 = 0.00148844 SOL");
    assert.equal(rentExempt(0, 6_960), B(890_880), "the classic rent LiteSVM's default uses");
    assert.equal(graduationCosts(B(150_000_000)), B(150_000_000) + rentExempt(637) + rentExempt(4_075) + rentExempt(82) + B(3) * rentExempt(165));
    assert.equal(sideCosts(B(150_000_000)) - graduationCosts(B(150_000_000)), rentExempt(165));
  });
  test("init parameter checks mirror init_pair (defaults pass; each bad parameter is named)", () => {
    const now = 1_800_000_000;
    const good = { virtualSolLamports: C.virtualSol, virtualTokenAmount: C.virtualToken, curveSupply: C.curveSupply, targetRaiseLamports: DEFAULT_TARGET_RAISE_LAMPORTS, minSideShareBps: 2_500, deadline: now + 86_400 };
    assert.deepEqual(initParamProblems(good, now, B(150_000_000)), []);
    assert.match(initParamProblems({ ...good, deadline: now + 30 }, now, B(0)).join(), /deadline/);
    assert.match(initParamProblems({ ...good, minSideShareBps: 900 }, now, B(0)).join(), /share/);
    assert.match(initParamProblems({ ...good, minSideShareBps: MAX_SIDE_SHARE_BPS + 1 }, now, B(0)).join(), /share/);
    assert.match(initParamProblems({ ...good, targetRaiseLamports: B(500) * SOL }, now, B(0)).join(), /unreachable/);
    assert.match(initParamProblems({ ...good, targetRaiseLamports: SOL / B(2) }, now, B(150_000_000)).join(), /TargetTooSmall/);
    assert.match(initParamProblems({ ...good, curveSupply: B(950_000_000) * B(1_000_000) }, now, B(0)).join(), /reserve/);
    // the devnet rehearsal's parameters pass too
    const devnet: CurveParams = { virtualSol: B(300_000_000), virtualToken: C.virtualToken, curveSupply: C.curveSupply };
    assert.deepEqual(initParamProblems({ ...good, virtualSolLamports: devnet.virtualSol, targetRaiseLamports: B(1_200_000_000), minSideShareBps: 2_500 }, now, B(150_000_000)), []);
  });
  test("pair phase for the UI / keeper", () => {
    const base = { solA: B(50) * SOL, solB: B(40) * SOL, target: DEFAULT_TARGET_RAISE_LAMPORTS, shareBps: 2_500, deadline: 2_000 };
    assert.equal(pairPhase({ ...base, status: 0 }, 1_000), "ready");
    assert.equal(pairPhase({ ...base, status: 0, solB: B(0) }, 1_000), "open");
    assert.equal(pairPhase({ ...base, status: 0 }, 2_000), "expired-open");
    assert.equal(pairPhase({ ...base, status: 3 }, 1_000), "graduating");
    assert.equal(pairPhase({ ...base, status: 1 }, 1_000), "graduated");
    assert.equal(pairPhase({ ...base, status: 2 }, 1_000), "voided");
  });
});

describe("pairCurve pricing — redemption and bounds (blind reviews)", () => {
  test("pro-rata redemption is order-independent and drains the side exactly (no first-seller race, no fee)", () => {
    const pool = B(7_777_777_777), supply = B(123_456_789_012);
    const holdings = [B(1), B(50_000_000_000), B(3_333_333_333), B(70_123_455_678)];
    for (const order of [[0, 1, 2, 3], [3, 2, 1, 0], [2, 0, 3, 1]]) {
      let outstanding = supply, left = pool;
      const paid: bigint[] = [];
      for (const i of order) { const x = quoteRedeem(pool, supply, outstanding, left, holdings[i]); paid[i] = x; outstanding -= holdings[i]; left -= x; }
      assert.equal(left, B(0));
      for (const i of order.slice(0, 3)) assert.equal(paid[i], (holdings[i] * pool) / supply);
    }
    assert.throws(() => quoteRedeem(pool, supply, B(10), pool, B(11)));
  });
  test("the minimum side share is capped at 40% (a 50% share would make graduation a knife-edge)", () => {
    assert.equal(MAX_SIDE_SHARE_BPS, 4_000);
  });
  test("no tokens for free: a zero budget is refused, the smallest buy pays at least one lamport of curve cost", () => {
    assert.throws(() => quoteBuy(defaultCurve(), B(0), B(0)));
    const q = quoteBuy(defaultCurve(), B(0), B(1));
    assert.equal(q.cost, B(1));
    assert.ok(q.tokensOut > B(0) && solAt(defaultCurve(), q.soldAfter) === B(1));
  });
});

