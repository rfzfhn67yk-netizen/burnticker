import type { CurvePool, CurveConfig, CurvePlatform, CpmmConfig } from "@/lib/burnticker/swap/layouts";

/**
 * THE SWAP PANEL'S QUOTE MATH (swap-1, 2026-10-14). Integer math in bigint, step for step the pinned SDK's (raydium-sdk-v2 0.2.74-alpha):
 *  - the LaunchLab curve: Curve.buyExactIn / Curve.sellExactIn with LaunchConstantProductCurve (curveType 0, the only curve Burnticker
 *    launches use), the fee taken on the SOL side (protocol + platform + creator rates, ppm, rounded up), no share fee;
 *  - the CPMM pool: CurveCalculator.swapBaseInput, the trade fee (and the creator fee when it is on the input side) taken from the input,
 *    else the creator fee from the output.
 * test/burntickerSwap.test.ts runs both against the SDK on saved pool states. A quote is only a quote: the program enforces the minimum
 * out (the slippage setting), so a quote off by a unit can only make a swap fail, never fill worse than the minimum.
 */

export const PPM = BigInt(1_000_000);
const ZERO = BigInt(0), ONE = BigInt(1), BPS = BigInt(10_000);

/** SDK ceilDivBN: zero stays zero, any positive quotient below one is one. */
const ceilDivBN = (a: bigint, b: bigint): bigint => { if (a === ZERO) return ZERO; const q = a / b; if (q === ZERO) return ONE; return a % b > ZERO ? q + ONE : q; };
const feeOf = (amount: bigint, rate: bigint): bigint => (amount * rate + PPM - ONE) / PPM;
const preFee = (post: bigint, rate: bigint): bigint => (rate === ZERO ? post : (post * PPM + (PPM - rate) - ONE) / (PPM - rate));

export interface CurveRates { protocolFeeRate: bigint; platformFeeRate: bigint; creatorFeeRate: bigint }
export const curveRates = (config: CurveConfig, platform: CurvePlatform): CurveRates => ({ protocolFeeRate: config.tradeFeeRate, platformFeeRate: platform.feeRate, creatorFeeRate: platform.creatorFeeRate });

export interface FeeSplit { total: bigint; protocol: bigint; platform: bigint; creator: bigint }
function splitFee(total: bigint, r: CurveRates): FeeSplit {
  const rate = r.protocolFeeRate + r.platformFeeRate + r.creatorFeeRate;
  const platform = rate === ZERO ? ZERO : (total * r.platformFeeRate) / rate;
  const creator = rate === ZERO ? ZERO : (total * r.creatorFeeRate) / rate;
  return { total, protocol: total - platform - creator, platform, creator };
}

export interface CurveQuote {
  /** what goes in: lamports for a swap from SOL, raw token units for a swap to SOL (a swap from SOL that would take more tokens than are left on the curve uses less SOL than offered) */
  amountIn: bigint;
  amountOut: bigint;
  fee: FeeSplit;
  /** true when the curve has fewer tokens left than the SOL offered would take: the swap fills the curve and uses `amountIn` only */
  capped: boolean;
}

/** SOL in → tokens out on the curve (Curve.buyExactIn, curveType 0). */
export function curveSolIn(pool: CurvePool, r: CurveRates, lamportsIn: bigint): CurveQuote {
  const rate = r.protocolFeeRate + r.platformFeeRate + r.creatorFeeRate;
  if (rate > PPM) throw new Error("fee rate above 100%");
  const inReserve = pool.virtualB + pool.realB, outReserve = pool.virtualA - pool.realA;
  let totalFee = feeOf(lamportsIn, rate);
  const lessFee = lamportsIn - totalFee;
  let amountA = (lessFee * outReserve) / (inReserve + lessFee);
  let amountIn = lamportsIn, capped = false;
  const remaining = pool.totalSellA - pool.realA;
  if (amountA > remaining) {
    amountA = remaining; capped = true;
    const need = ceilDivBN(inReserve * amountA, outReserve - amountA);
    amountIn = preFee(need, rate);
    totalFee = amountIn - need;
  }
  return { amountIn, amountOut: amountA, fee: splitFee(totalFee, r), capped };
}

/** Tokens in → SOL out on the curve (Curve.sellExactIn, curveType 0). */
export function curveTokensIn(pool: CurvePool, r: CurveRates, tokensIn: bigint): CurveQuote {
  const rate = r.protocolFeeRate + r.platformFeeRate + r.creatorFeeRate;
  if (rate > PPM) throw new Error("fee rate above 100%");
  const inReserve = pool.virtualA - pool.realA, outReserve = pool.virtualB + pool.realB;
  const gross = (tokensIn * outReserve) / (inReserve + tokensIn);
  const totalFee = feeOf(gross, rate);
  return { amountIn: tokensIn, amountOut: gross - totalFee, fee: splitFee(totalFee, r), capped: false };
}

export interface CpmmQuote { amountIn: bigint; amountOut: bigint; tradeFee: bigint; creatorFee: bigint; creatorFeeOnInput: boolean }

/**
 * The CPMM's swap_base_input. `reserveIn`/`reserveOut` are the vault balances less the fees the pool owes (protocol, fund, creator).
 * `creatorFeeOnInput` from the pool's creator_fee_on and the direction (cpmmCreatorFeeOnInput).
 */
export function cpmmSwapIn(amountIn: bigint, reserveIn: bigint, reserveOut: bigint, c: CpmmConfig, creatorFeeOnInput: boolean, creatorFeeEnabled: boolean): CpmmQuote {
  if (reserveIn <= ZERO || reserveOut <= ZERO) throw new Error("the pool is empty");
  const creatorRate = creatorFeeEnabled ? c.creatorFeeRate : ZERO;
  const tradeFee = feeOf(amountIn, c.tradeFeeRate);
  let creatorFee = ZERO, lessFees = amountIn - tradeFee;
  if (creatorFeeOnInput) { creatorFee = feeOf(amountIn, creatorRate); lessFees -= creatorFee; }
  const swapped = (lessFees * reserveOut) / (reserveIn + lessFees);
  let amountOut = swapped;
  if (!creatorFeeOnInput) { creatorFee = feeOf(swapped, creatorRate); amountOut = swapped - creatorFee; }
  return { amountIn, amountOut, tradeFee, creatorFee, creatorFeeOnInput };
}

/** raydium-cp-swap PoolState.is_creator_fee_on_input: both tokens → always the input; token 0 only → when token 0 goes in; token 1 only → when token 1 goes in. */
export function cpmmCreatorFeeOnInput(creatorFeeOn: number, inputIsToken0: boolean): boolean {
  if (creatorFeeOn === 0) return true;
  if (creatorFeeOn === 1) return inputIsToken0;
  if (creatorFeeOn === 2) return !inputIsToken0;
  throw new Error(`unknown creator_fee_on ${creatorFeeOn}`);
}

/** The least the program may return at a slippage setting in basis points (rounded down). */
export const minOut = (quoted: bigint, slippageBps: number): bigint => (quoted * (BPS - BigInt(slippageBps))) / BPS;

/** Decimal text → raw units; null when it is not a plain non-negative decimal with at most `decimals` places. */
export function parseAmount(text: string, decimals: number): bigint | null {
  const t = text.trim();
  if (!/^\d+(\.\d*)?$|^\.\d+$/.test(t)) return null;
  const [w, f = ""] = t.split(".");
  if (f.length > decimals) return null;
  return BigInt(w || "0") * BigInt(10) ** BigInt(decimals) + BigInt((f + "0".repeat(decimals)).slice(0, decimals) || "0");
}

/** Raw units → decimal text with at most `places` decimals (trailing zeros dropped). */
export function formatAmount(raw: bigint, decimals: number, places = decimals): string {
  const neg = raw < ZERO, v = neg ? -raw : raw, base = BigInt(10) ** BigInt(decimals);
  const whole = (v / base).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = (v % base).toString().padStart(decimals, "0").slice(0, places).replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}
