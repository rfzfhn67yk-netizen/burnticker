// CONTINUOUS AUDIT 2026-10-19 SEC-01: A GRADUATED-POOL SELL OMITTED ITS SOL CREATOR FEE. On the saved supported pool (devnet fixture,
// creator_fee_on token 0 = WSOL), 1,000,000 tokens to SOL pays a 2,500-token trade fee AND a 0.000013511 SOL creator fee taken from the
// SOL out; the review showed only the token fee and called 4,180 tokens the burn pool's share of a 2,500-token fee. Every fee leg now
// carries its own amount, unit, basis and recipients from the same math as the amount out (checked against the pinned Raydium SDK), in
// both directions and both token orderings, and the burn pool's part never exceeds the leg it is part of.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";
import { CpmmConfigInfoLayout, CurveCalculator } from "@raydium-io/raydium-sdk-v2";
import { decodeCpmmConfig, cpmmPoolExtras, decodeCurvePool, decodeCurveConfig, decodeCurvePlatform } from "@/lib/burnticker/swap/layouts";
import { decodeCpmmPool } from "@/lib/burnReceipts/cpmm";
import { CPMM_PROGRAM, LAUNCHLAB_PROGRAM } from "@/lib/burnticker/swap/instructions";
import { LP_SOL_FEES_TO_BURN_POOL_BPS, quoteSwap, type CpmmMarket, type CurveMarket, type FeeLeg } from "@/lib/burnticker/swap/plan";
import { poolFeeLine } from "@/lib/burnticker/swap/copy";
import { formatAmount } from "@/lib/burnticker/swap/math";
import { cpmmTierOf } from "@/lib/burnticker/cpmmTier";
import { LOCK_FEE_BURN_BPS } from "@/lib/burnReceipts/constants";
import { lintCopy } from "@/lib/launch/copyLint";

type Acc = { address: string; owner: string; data: string };
const FX = JSON.parse(fs.readFileSync("test/fixtures/burnticker-swap-devnet.json", "utf8")) as Record<string, Acc>;
const bytes = (a: Acc) => Buffer.from(a.data, "base64");
const bn = (x: bigint) => new BN(x.toString());
const big = (x: { toString(): string }) => BigInt(x.toString());
const cp = decodeCpmmPool(new PublicKey(FX.cpmmPool.address), bytes(FX.cpmmPool)), cpx = cpmmPoolExtras(bytes(FX.cpmmPool));
const amm = decodeCpmmConfig(bytes(FX.ammConfig)), sdkAmm = CpmmConfigInfoLayout.decode(bytes(FX.ammConfig));
const vaultAmt = (a: Acc) => bytes(a).readBigUInt64LE(64);
const r0 = vaultAmt(FX.vault0) - cp.fees0, r1 = vaultAmt(FX.vault1) - cp.fees1;
const market: CpmmMarket = { kind: "cpmm", program: CPMM_PROGRAM.devnet, pool: cp, config: amm, solIsToken0: true, reserveSol: r0, reserveToken: r1, creatorFeeOn: cpx.creatorFeeOn, enableCreatorFee: cpx.enableCreatorFee, swapDisabled: cpx.swapDisabled };
/** the same pool read with the tokens the other way round (SOL as token 1; creator_fee_on follows SOL, so it is token 1 only) */
const flipped: CpmmMarket = { ...market, solIsToken0: false, creatorFeeOn: cpx.creatorFeeOn === 1 ? 2 : cpx.creatorFeeOn === 2 ? 1 : 0 };
const fmt = (x: bigint, u: "SOL" | "tokens") => (u === "SOL" ? `${formatAmount(x, 9, 9)} SOL` : `${formatAmount(x, 6, 6)} $TEST`);
const ZERO = BigInt(0);

/** every leg: parts add up to at most the leg, the burn pool's part never exceeds it */
function sane(legs: FeeLeg[]) {
  for (const l of legs) {
    const parts = (l.burnPoolRaw ?? ZERO) + l.burnedRaw + l.raydiumRaw + l.operatorRaw + l.platformRaw;
    assert.ok(parts <= l.amountRaw, `${l.kind}: parts ${parts} > ${l.amountRaw}`);
    assert.ok((l.burnPoolRaw ?? ZERO) <= l.amountRaw);
  }
}
/** the SDK's own fee legs for this swap */
function sdkFor(m: CpmmMarket, side: "sol-in" | "tokens-in", amount: bigint) {
  const solIn = side === "sol-in", inputIsToken0 = solIn === m.solIsToken0;
  const onInput = m.creatorFeeOn === 0 ? true : m.creatorFeeOn === 1 ? inputIsToken0 : !inputIsToken0;
  return CurveCalculator.swapBaseInput(bn(amount), bn(solIn ? m.reserveSol : m.reserveToken), bn(solIn ? m.reserveToken : m.reserveSol), sdkAmm.tradeFeeRate, m.enableCreatorFee ? sdkAmm.creatorFeeRate : new BN(0), sdkAmm.protocolFeeRate, sdkAmm.fundFeeRate, onInput) as { outputAmount: BN; tradeFee: BN; creatorFee: BN; protocolFee?: BN; fundFee?: BN };
}

describe("SEC-01: every fee leg of a graduated-pool swap, in its own unit", () => {
  test("the audit's case: 1,000,000 tokens to SOL shows the 2,500-token trade fee AND the 0.000013511 SOL creator fee from the SOL out", () => {
    const q = quoteSwap(market, "tokens-in", BigInt(1_000_000_000_000));
    assert.equal(q.amountOut, BigInt(5_390_493));
    const [trade, creator] = q.legs;
    assert.deepEqual([trade.kind, trade.amountRaw, trade.unit, trade.basis], ["trade", BigInt(2_500_000_000), "tokens", "input"]);
    assert.deepEqual([creator.kind, creator.amountRaw, creator.unit, creator.basis], ["creator", BigInt(13_511), "SOL", "output"]);
    sane(q.legs);
    // the coin side of the liquidity's fees is burned, never called a burn-pool share in tokens
    assert.equal(trade.burnPoolRaw, ZERO);
    assert.equal(trade.burnedRaw, trade.amountRaw - trade.raydiumRaw);
    const line = poolFeeLine(q.legs, fmt);
    assert.match(line, /Trading fee: 2,500 \$TEST \(0\.25% of the tokens in\)/);
    assert.match(line, /Creator fee: 0\.000013511 SOL \(0\.25% of the SOL out\), taken from the SOL out before it reaches your wallet\. 0\.000013511 SOL of it goes to this coin's burn pool\./);
    assert.doesNotMatch(line, /4,180/);
    assert.deepEqual(lintCopy(line).hits, [], line);
  });

  test("both directions, both token orderings, creator fee on and off: legs match the SDK and the amount out", () => {
    for (const m of [market, flipped]) for (const enabled of [true, false]) for (const side of ["sol-in", "tokens-in"] as const) for (const amount of [BigInt(10_000_000), BigInt(1_000_000_000_000), BigInt(777_777)]) {
      const mk = { ...m, enableCreatorFee: enabled };
      const q = quoteSwap(mk, side, amount), sdk = sdkFor(mk, side, amount);
      assert.equal(q.amountOut, big(sdk.outputAmount));
      const trade = q.legs.find((l) => l.kind === "trade")!, creator = q.legs.find((l) => l.kind === "creator");
      assert.equal(trade.amountRaw, big(sdk.tradeFee));
      assert.equal(trade.unit, side === "sol-in" ? "SOL" : "tokens");
      if (sdk.protocolFee && sdk.fundFee) assert.equal(trade.raydiumRaw, big(sdk.protocolFee) + big(sdk.fundFee));
      if (big(sdk.creatorFee) > ZERO) {
        assert.ok(creator, "the creator fee is shown");
        assert.equal(creator!.amountRaw, big(sdk.creatorFee));
        // creator_fee_on follows SOL in this fixture: the creator fee is always in SOL, from the SOL in or the SOL out
        assert.equal(creator!.unit, "SOL"); assert.equal(creator!.basis, side === "sol-in" ? "input" : "output");
      } else assert.equal(creator, undefined);
      if (side === "sol-in") assert.equal(trade.burnPoolRaw, ((trade.amountRaw - trade.raydiumRaw) * BigInt(LP_SOL_FEES_TO_BURN_POOL_BPS)) / BigInt(10_000));
      sane(q.legs);
      assert.deepEqual(lintCopy(poolFeeLine(q.legs, fmt)).hits, []);
    }
  });

  test("SOL to tokens: both legs in SOL; the burn pool's parts are parts of each leg", () => {
    const q = quoteSwap(market, "sol-in", BigInt(1_000_000_000));
    const line = poolFeeLine(q.legs, fmt);
    assert.match(line, /^Trading fee: 0\.0025 SOL \(0\.25% of the SOL in\)\. Raydium keeps [\d.]+ SOL\. The locked liquidity's share is [\d.]+ SOL\. [\d.]+ SOL of it goes to this coin's burn pool when those fees are claimed, and [\d.]+ SOL to the operator\./);
    assert.match(line, /Creator fee: 0\.0025 SOL \(0\.25% of the SOL in\)\. 0\.0025 SOL of it goes to this coin's burn pool\./);
    sane(q.legs);
  });

  test("an unlisted fee tier never names a burn-pool amount for the creator fee; the constant matches the program's", () => {
    assert.ok(cpmmTierOf(cp.ammConfig.toBase58()), "the fixture's pool is on a known tier");
    const unknown = { ...market, pool: { ...cp, ammConfig: new PublicKey(FX.curvePool.address) } };
    const creator = quoteSwap(unknown, "tokens-in", BigInt(1_000_000_000_000)).legs.find((l) => l.kind === "creator")!;
    assert.equal(creator.burnPoolRaw, null);
    assert.match(poolFeeLine([creator], fmt), /It goes to this coin's burn pool, less Raydium's share\./);
    assert.equal(LP_SOL_FEES_TO_BURN_POOL_BPS, LOCK_FEE_BURN_BPS);
  });

  test("the curve: one SOL leg, its burn-pool part inside it; the panel renders the pool line for a graduated pool", () => {
    const curve: CurveMarket = { kind: "curve", program: LAUNCHLAB_PROGRAM.devnet, poolId: new PublicKey(FX.curvePool.address), pool: decodeCurvePool(bytes(FX.curvePool)), config: decodeCurveConfig(bytes(FX.config)), platform: decodeCurvePlatform(bytes(FX.platform)) };
    for (const side of ["sol-in", "tokens-in"] as const) {
      const q = quoteSwap(curve, side, side === "sol-in" ? BigInt(100_000_000) : BigInt(1_000_000_000));
      assert.equal(q.legs.length, 1); assert.equal(q.legs[0].unit, "SOL"); assert.equal(q.legs[0].basis, side === "sol-in" ? "input" : "output");
      sane(q.legs);
    }
    const panel = fs.readFileSync("src/app/burnticker/t/[ticker]/TradePanel.tsx", "utf8");
    assert.match(panel, /market\?\.kind === "cpmm" \? poolFeeLine\(quote\.legs,/);
  });
});
