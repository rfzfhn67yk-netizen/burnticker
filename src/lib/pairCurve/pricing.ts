/**
 * The pair curve's arithmetic in TypeScript — a line-for-line mirror of programs/burn-receipts/programs/pair_curve/src/math.rs (bigint,
 * no floating point). The program is the source of truth; test/pairCurvePricing.test.ts pins the two together on fixtures and on
 * the invariants (path independence, exact fee split, the graduation edge, the exact drain after a void).
 *
 *   F(sold) = ceil(V_s · sold / (V_t − sold))      lamports a side's curve holds once `sold` raw tokens left it
 *
 * Buy: the net budget N is the largest with N + fee(N) ≤ max_in; tokens = min(floor((F + N)·V_t / (V_s + F + N)), curve_supply) − sold;
 * the buyer pays exactly F(sold + tokens) − F(sold) plus fee(cost). Sell: gross = F(sold) − F(sold − amount); net = gross − fee(gross).
 * fee(x) = floor(x · 100 / 10,000); dev = floor(fee · 25 / 100); burn = fee − dev.
 */

export const TOKEN_DECIMALS = 6;
export const TOTAL_SUPPLY = BigInt(1_000_000_000) * BigInt(1_000_000);
export const FEE_BPS = BigInt(100);
export const DEV_FEE_BPS = BigInt(25);
export const BPS = BigInt(10_000);

export const DEFAULT_VIRTUAL_SOL_LAMPORTS = BigInt(30_000_000_000);
export const DEFAULT_VIRTUAL_TOKEN_AMOUNT = BigInt(1_073_000_000) * BigInt(1_000_000);
export const DEFAULT_CURVE_SUPPLY = BigInt(793_100_000) * BigInt(1_000_000);
export const DEFAULT_TARGET_RAISE_LAMPORTS = BigInt(85_000_000_000);
export const DEFAULT_MIN_SIDE_SHARE_BPS = 2_500;

export const MIN_VIRTUAL_SOL_LAMPORTS = BigInt(10_000_000);
export const MIN_RESERVE_BPS = BigInt(1_000);
export const MAX_RESERVE_BPS = BigInt(5_000);
export const MIN_SIDE_SHARE_BPS = 1_000;
export const MAX_SIDE_SHARE_BPS = 5_000;
export const MIN_TARGET_RAISE_LAMPORTS = BigInt(100_000_000);
export const MIN_POOL_LIQUIDITY_LAMPORTS = BigInt(10_000_000);
export const MIN_DURATION_SECS = 60;
export const MAX_DURATION_SECS = 90 * 24 * 60 * 60;
export const MAX_SIDE_RAISE_LAMPORTS = BigInt("1000000000000000000");
/** Graduation runs once per side; if the second side's pool is blocked this long, that side's sells reopen (constants.rs). */
export const GRADUATION_STUCK_SECS = 3 * 24 * 60 * 60;

/**
 * Account sizes CPMM `initialize` creates for one pool, and the rent model: lamports = (128 + size) × RENT_LAMPORTS_PER_BYTE. Mainnet and
 * devnet charge 5,080 per byte (read 2026-10-10: `solana rent 0` = 0.00065024 SOL on both); the classic 6,960 is what LiteSVM's default
 * Rent (and the Rust suite) uses. The PROGRAM always reads the Rent sysvar — these helpers are for quotes and pre-flight checks; pass
 * `connection.getMinimumBalanceForRentExemption` when exactness matters.
 */
export const CPMM_POOL_STATE_LEN = 637;
export const CPMM_OBSERVATION_LEN = 4_075;
export const SPL_MINT_LEN = 82;
export const SPL_ACCOUNT_LEN = 165;
export const RENT_LAMPORTS_PER_BYTE = 5_080;
export const CLASSIC_RENT_LAMPORTS_PER_BYTE = 6_960;
export const rentExempt = (size: number, perByte: number = RENT_LAMPORTS_PER_BYTE): bigint => BigInt(128 + size) * BigInt(perByte);

export interface CurveParams {
  virtualSol: bigint;
  virtualToken: bigint;
  curveSupply: bigint;
}

export const defaultCurve = (): CurveParams => ({ virtualSol: DEFAULT_VIRTUAL_SOL_LAMPORTS, virtualToken: DEFAULT_VIRTUAL_TOKEN_AMOUNT, curveSupply: DEFAULT_CURVE_SUPPLY });

const ceilDiv = (a: bigint, b: bigint): bigint => (a + b - BigInt(1)) / b;
const min = (a: bigint, b: bigint): bigint => (a < b ? a : b);

/** F(sold). Throws outside 0 ≤ sold ≤ curveSupply < virtualToken (the program's MathOverflow). */
export function solAt(p: CurveParams, sold: bigint): bigint {
  if (sold < BigInt(0) || sold > p.curveSupply || p.curveSupply >= p.virtualToken) throw new Error(`pairCurve: sold ${sold} outside [0, ${p.curveSupply}]`);
  return ceilDiv(p.virtualSol * sold, p.virtualToken - sold);
}

/** The largest sold ≤ curveSupply with F(sold) ≤ sigma (exact closed form). */
export function soldForSol(p: CurveParams, sigma: bigint): bigint {
  return min((sigma * p.virtualToken) / (p.virtualSol + sigma), p.curveSupply);
}

export interface FeeSplit { fee: bigint; dev: bigint; burn: bigint }

export function feeSplit(x: bigint): FeeSplit {
  const fee = (x * FEE_BPS) / BPS;
  const dev = (fee * DEV_FEE_BPS) / FEE_BPS;
  return { fee, dev, burn: fee - dev };
}

export function netBudget(maxIn: bigint): bigint {
  let n = (maxIn * BPS) / (BPS + FEE_BPS);
  while (n < maxIn && n + BigInt(1) + feeSplit(n + BigInt(1)).fee <= maxIn) n += BigInt(1);
  while (n > BigInt(0) && n + feeSplit(n).fee > maxIn) n -= BigInt(1);
  return n;
}

export interface BuyQuote { tokensOut: bigint; cost: bigint; fees: FeeSplit; total: bigint; soldAfter: bigint; solAfter: bigint }

export function quoteBuy(p: CurveParams, sold: bigint, maxIn: bigint): BuyQuote {
  const f0 = solAt(p, sold);
  const n = netBudget(maxIn);
  let target = soldForSol(p, f0 + n);
  if (target < sold) target = sold;
  const tokensOut = target - sold;
  if (tokensOut <= BigInt(0)) throw new Error("pairCurve: the buy would deliver nothing (ZeroOutput)");
  const solAfter = solAt(p, target);
  const cost = solAfter - f0;
  const fees = feeSplit(cost);
  return { tokensOut, cost, fees, total: cost + fees.fee, soldAfter: target, solAfter };
}

export interface SellQuote { gross: bigint; fees: FeeSplit; net: bigint; soldAfter: bigint; solAfter: bigint }

export function quoteSell(p: CurveParams, sold: bigint, amount: bigint): SellQuote {
  if (amount <= BigInt(0) || amount > sold) throw new Error("pairCurve: cannot sell more than the curve has sold (SellExceedsSold)");
  const soldAfter = sold - amount;
  const solAfter = solAt(p, soldAfter);
  const gross = solAt(p, sold) - solAfter;
  const fees = feeSplit(gross);
  return { gross, fees, net: gross - fees.fee, soldAfter, solAfter };
}

/** The marginal price in lamports per WHOLE token (10^6 raw), as a float for display only. */
export function priceLamportsPerToken(p: CurveParams, sold: bigint): number {
  return (Number(p.virtualSol + solAt(p, sold)) / Number(p.virtualToken - sold)) * 10 ** TOKEN_DECIMALS;
}

export function graduationReady(solA: bigint, solB: bigint, target: bigint, shareBps: number): boolean {
  const total = solA + solB;
  const need = BigInt(shareBps) * total;
  return total >= target && solA * BPS >= need && solB * BPS >= need;
}

export function priceMatchedTokens(p: CurveParams, sold: bigint, poolSol: bigint, available: bigint): bigint {
  const sRes = p.virtualSol + solAt(p, sold);
  const tRes = p.virtualToken - sold;
  return min((poolSol * tRes) / sRes, available);
}

/** CPMM `initialize`'s take for one pool: create-pool fee + the rent of the six accounts it creates. */
export function graduationCosts(createPoolFee: bigint, rent: (size: number) => bigint = rentExempt): bigint {
  return createPoolFee + rent(CPMM_POOL_STATE_LEN) + rent(CPMM_OBSERVATION_LEN) + rent(SPL_MINT_LEN) + rent(SPL_ACCOUNT_LEN) * BigInt(3);
}

/** A side's whole overhead: CPMM's take plus the vault's WSOL account rent (refunded as residue to the side's burn pool). */
export function sideCosts(createPoolFee: bigint, rent: (size: number) => bigint = rentExempt): bigint {
  return graduationCosts(createPoolFee, rent) + rent(SPL_ACCOUNT_LEN);
}

export interface InitParams {
  virtualSolLamports: bigint;
  virtualTokenAmount: bigint;
  curveSupply: bigint;
  targetRaiseLamports: bigint;
  minSideShareBps: number;
  deadline: number;
}

/** init_pair's parameter checks (init_pair.rs validate_params), so a launcher can refuse before signing. Lists every problem. */
export function initParamProblems(a: InitParams, now: number, createPoolFee: bigint, rent: (size: number) => bigint = rentExempt): string[] {
  const out: string[] = [];
  if (a.virtualSolLamports < MIN_VIRTUAL_SOL_LAMPORTS) out.push("virtual SOL below 0.01 SOL");
  if (!(a.curveSupply >= BigInt(1) && a.curveSupply < TOTAL_SUPPLY && a.virtualTokenAmount > a.curveSupply)) { out.push("need 1 ≤ curve supply < total supply and virtual tokens > curve supply"); return out; }
  const reserve = TOTAL_SUPPLY - a.curveSupply;
  const reserveBps = (reserve * BPS) / TOTAL_SUPPLY;
  if (reserveBps < MIN_RESERVE_BPS || reserveBps > MAX_RESERVE_BPS) out.push("the liquidity reserve must be 10–50 % of supply");
  if (a.minSideShareBps < MIN_SIDE_SHARE_BPS || a.minSideShareBps > MAX_SIDE_SHARE_BPS) out.push("minimum side share must be 1,000–5,000 bps");
  if (a.targetRaiseLamports < MIN_TARGET_RAISE_LAMPORTS) out.push("target raise below 0.1 SOL");
  const duration = a.deadline - now;
  if (duration < MIN_DURATION_SECS || duration > MAX_DURATION_SECS) out.push("deadline must be 60 s – 90 days from now");
  const p: CurveParams = { virtualSol: a.virtualSolLamports, virtualToken: a.virtualTokenAmount, curveSupply: a.curveSupply };
  const sellOut = solAt(p, a.curveSupply);
  if (sellOut > MAX_SIDE_RAISE_LAMPORTS) out.push("one side's sell-out raise is absurdly large");
  const sideMin = (a.targetRaiseLamports * BigInt(a.minSideShareBps)) / BPS;
  if (BigInt(2) * sellOut < a.targetRaiseLamports || sellOut < sideMin) out.push("the target is unreachable with these curves");
  if (sideMin < sideCosts(createPoolFee, rent) + MIN_POOL_LIQUIDITY_LAMPORTS) out.push("each side's minimum raise must cover its graduation costs plus 0.01 SOL (TargetTooSmall)");
  if (priceMatchedTokens(p, a.curveSupply, sellOut, BigInt("18446744073709551615")) > reserve) out.push("at sell-out the price-matched pool would need more than the reserve");
  return out;
}

/** The pair's lifecycle phase for a UI / keeper, from the Pair's fields. */
export type PairPhase = "open" | "ready" | "expired-open" | "graduating" | "graduated" | "voided";

export function pairPhase(o: { status: number; solA: bigint; solB: bigint; target: bigint; shareBps: number; deadline: number }, now: number): PairPhase {
  if (o.status === 1) return "graduated";
  if (o.status === 2) return "voided";
  if (o.status === 3) return "graduating";
  if (now >= o.deadline) return "expired-open";
  return graduationReady(o.solA, o.solB, o.target, o.shareBps) ? "ready" : "open";
}
