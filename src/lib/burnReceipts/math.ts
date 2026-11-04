import { CARRY_CONSECUTIVE, CARRY_NONE, KIND_DOWN, KIND_FLAT, KIND_INCREASE, MODE_BUYBACK, MODE_VAULT, POOL_POLICY_CREATOR_IS_FEE_PDA } from "@/lib/burnReceipts/constants";

/**
 * The burn rule's arithmetic, mirrored line for line from programs/burn-receipts/programs/burn_receipts/src/math.rs (the program
 * is the number of record; this mirror lets the keeper, the status page and a stranger reproduce every reading and burn to the unit
 * and the lamport). BigInt throughout, no floats. Both sides are pinned by the same vectors (test/burnReceiptsMath.test.ts and the
 * Rust `math::tests`).
 */

const B = (n: number | bigint | string): bigint => BigInt(n);
const ZERO = B(0);
const BPS = B(10_000);
const PPM = B(1_000_000);
const U64_MAX = (B(1) << B(64)) - B(1);
const I64_MAX = (B(1) << B(63)) - B(1);
export const SPEND_SCALE = B(10) ** B(18);

export interface Step {
  kind: number;
  /** now − prev (value units). */
  delta: bigint;
  carryIn: bigint;
  units: bigint;
  carryOut: bigint;
}

/** THE UNIT RULE (math::step). */
export function step(prev: bigint, now: bigint, carryIn: bigint, unit: bigint, carryRule: number): Step {
  if (unit <= ZERO) throw new Error("unit must be positive");
  if (carryIn < ZERO || carryIn >= unit || (carryRule === CARRY_NONE && carryIn !== ZERO)) throw new Error("invalid carry");
  const delta = now - prev;
  if (delta > I64_MAX || delta < -I64_MAX - B(1)) throw new Error("delta overflows i64");
  if (delta <= ZERO) return { kind: delta === ZERO ? KIND_FLAT : KIND_DOWN, delta, carryIn, units: ZERO, carryOut: ZERO };
  let total: bigint;
  if (carryRule === CARRY_CONSECUTIVE) total = delta + carryIn;
  else if (carryRule === CARRY_NONE) total = delta;
  else throw new Error("unknown carry rule");
  const units = total / unit;
  if (units > U64_MAX) throw new Error("units overflow u64");
  return { kind: KIND_INCREASE, delta, carryIn, units, carryOut: carryRule === CARRY_CONSECUTIVE ? total % unit : ZERO };
}

export const deltaPlausible = (delta: bigint, maxAbsDelta: bigint): boolean => (delta < ZERO ? -delta : delta) <= maxAbsDelta;

/** (base/SCALE)^exp × SCALE, flooring after every multiplication, in the same order as the Rust (binary exponentiation). */
export function powScaledFloor(base: bigint, exp: bigint): bigint {
  if (base > SPEND_SCALE || base < ZERO) throw new Error("base out of range");
  let result = SPEND_SCALE;
  let b = base;
  let e = exp;
  while (e > ZERO) {
    if ((e & B(1)) === B(1)) result = (result * b) / SPEND_SCALE;
    e >>= B(1);
    if (e > ZERO) b = (b * b) / SPEND_SCALE;
  }
  return result;
}

/** THE BUYBACK RULE: spend = pool × (1 − (1 − f)^units), f = bps / 10,000 (math::buyback_spend). */
export function buybackSpend(pool: bigint, units: bigint, fractionPerUnitBps: number): bigint {
  if (units <= ZERO || pool <= ZERO) return ZERO;
  const bps = B(fractionPerUnitBps);
  if (bps <= ZERO || bps > BPS) throw new Error("fraction_per_unit_bps must be 1..=10000");
  const keepFactor = (SPEND_SCALE / BPS) * (BPS - bps);
  const keep = (pool * powScaledFloor(keepFactor, units)) / SPEND_SCALE;
  return pool - keep;
}

/** The keeper's exact rational (rules.ts buybackSpend): pool − floor(pool·(q−p)^u / q^u) with f = p/q. For comparison only. */
export function buybackSpendExact(pool: bigint, units: bigint, fractionPerUnitBps: number): bigint {
  if (units <= ZERO || pool <= ZERO) return ZERO;
  const p = B(fractionPerUnitBps);
  return pool - (pool * (BPS - p) ** units) / BPS ** units;
}

export const spendablePool = (feeLamports: bigint, reserveLamports: bigint, wsolBalance: bigint): bigint =>
  (feeLamports > reserveLamports ? feeLamports - reserveLamports : ZERO) + wsolBalance;

/** Minimum swap output from reserves at crank time (math::min_amount_out). */
export function minAmountOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint, feeRatePpm: bigint, slippageBps: number): bigint {
  if (reserveIn <= ZERO || reserveOut <= ZERO) throw new Error("empty reserves");
  if (feeRatePpm >= PPM || B(slippageBps) >= BPS) throw new Error("fee or slippage out of range");
  const ideal = (amountIn * reserveOut) / (reserveIn + amountIn);
  const afterFee = (ideal * (PPM - feeRatePpm)) / PPM;
  return (afterFee * (BPS - B(slippageBps))) / BPS;
}

/** Token reserve of a pool with `reserveSol` lamports priced at the TWAP (math::twap_token_reserve), saturating at u64::MAX. */
export const twapTokenReserve = (reserveSol: bigint, twapX32: bigint): bigint => {
  const r = (reserveSol * twapX32) >> B(32);
  return r > U64_MAX ? U64_MAX : r;
};

/**
 * Review-2 F1 (math::buyback_min_out): the crank's minimum output = max(spot quote, TWAP quote), each the constant-product output
 * less the pool fee and slippage — the spot quote on the live reserves, the TWAP quote on a pool of the same SOL depth priced at the
 * oracle's TWAP. A same-transaction push of the spot price cannot lower it.
 */
export function buybackMinOut(amountIn: bigint, reserveSol: bigint, reserveToken: bigint, twapX32: bigint, feeRatePpm: bigint, slippageBps: number): bigint {
  const spot = minAmountOut(amountIn, reserveSol, reserveToken, feeRatePpm, slippageBps);
  const twapTok = twapTokenReserve(reserveSol, twapX32);
  if (twapTok === ZERO) return spot;
  const twap = minAmountOut(amountIn, reserveSol, twapTok, feeRatePpm, slippageBps);
  return spot > twap ? spot : twap;
}

export const solPriceX32 = (reserveSol: bigint, reserveToken: bigint): bigint => (reserveToken << B(32)) / reserveSol;

export const twapOk = (spotX32: bigint, twapX32: bigint, maxDevBps: number): boolean => spotX32 * BPS >= twapX32 * (BPS - B(maxDevBps));

export interface Settle { owed: bigint; burn: bigint; shortfall: bigint; exhausted: boolean }

/** Vault settlement (math::settle_vault; the keeper's settleBurn). allocation 0 = uncapped. */
export function settleVault(planned: bigint, shortfallIn: bigint, vaultBalance: bigint, allocation: bigint, totalBurned: bigint): Settle {
  const want = planned + shortfallIn;
  let owed = want;
  if (allocation !== ZERO) {
    const left = allocation > totalBurned ? allocation - totalBurned : ZERO;
    if (left === ZERO) return { owed: ZERO, burn: ZERO, shortfall: ZERO, exhausted: true };
    owed = want < left ? want : left;
  }
  const burn = owed < vaultBalance ? owed : vaultBalance;
  return { owed, burn, shortfall: owed - burn, exhausted: false };
}

// ------------------------------------------------------------------------------------------------------------------------------
// Dates and canonical text
// ------------------------------------------------------------------------------------------------------------------------------

const daysInMonth = (y: number, m: number): number => (m === 2 ? ((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28) : [4, 6, 9, 11].includes(m) ? 30 : m >= 1 && m <= 12 ? 31 : 0);

export function validDate(d: number): boolean {
  if (!Number.isInteger(d)) return false;
  const y = Math.floor(d / 10_000), m = Math.floor(d / 100) % 100, day = d % 100;
  return y >= 2000 && y <= 2199 && m >= 1 && m <= 12 && day >= 1 && day <= daysInMonth(y, m);
}

/** 20261008 ⇄ "2026-10-08". */
export function formatDate(d: number): string {
  return `${String(Math.floor(d / 10_000)).padStart(4, "0")}-${String(Math.floor(d / 100) % 100).padStart(2, "0")}-${String(d % 100).padStart(2, "0")}`;
}
export function parseDate(s: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) throw new Error(`not a YYYY-MM-DD date: ${s}`);
  const d = Number(m[1]) * 10_000 + Number(m[2]) * 100 + Number(m[3]);
  if (!validDate(d)) throw new Error(`not a calendar date: ${s}`);
  return d;
}

/** UTC calendar date (YYYYMMDD) of a unix timestamp (seconds). */
export function utcDate(unixSeconds: number): number {
  const d = new Date(unixSeconds * 1000);
  return d.getUTCFullYear() * 10_000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
}

/** Exactly `decimals` places ("40305316210829.72"). */
export function formatFixed(value: bigint, decimals: number, negative = false): string {
  const sign = negative && value !== ZERO ? "-" : "";
  if (decimals === 0) return `${sign}${value}`;
  const scale = B(10) ** B(decimals);
  return `${sign}${value / scale}.${(value % scale).toString().padStart(decimals, "0")}`;
}
export const formatSignedFixed = (delta: bigint, decimals: number): string => formatFixed(delta < ZERO ? -delta : delta, decimals, delta < ZERO);

/** "40305316210829.72" → 4030531621082972n (exactly `decimals` places required, so a value has one spelling). */
export function parseFixed(s: string, decimals: number): bigint {
  const re = decimals === 0 ? /^(\d+)$/ : new RegExp(`^(\\d+)\\.(\\d{${decimals}})$`);
  const m = re.exec(s);
  if (!m) throw new Error(`not a value with exactly ${decimals} decimals: ${s}`);
  return B(m[1]) * B(10) ** B(decimals) + (decimals ? B(m[2]) : ZERO);
}

/** Raw base units → token string without trailing zeros ("2100000", "12.5"); the keeper's rawToTokens. */
export function rawToTokens(raw: bigint, decimals: number): string {
  if (decimals === 0) return raw.toString();
  const scale = B(10) ** B(decimals);
  const whole = raw / scale, frac = raw % scale;
  if (frac === ZERO) return whole.toString();
  return `${whole}.${frac.toString().padStart(decimals, "0").replace(/0+$/, "")}`;
}

export const hex12 = (sha256: Uint8Array): string => Buffer.from(sha256.subarray(0, 6)).toString("hex");

// ------------------------------------------------------------------------------------------------------------------------------
// Rule parameters from the keeper's rules.json
// ------------------------------------------------------------------------------------------------------------------------------

/** The on-chain RuleParams (snake_case, as the IDL names them). */
export interface RuleParams {
  mode: number;
  carry_rule: number;
  pool_policy: number;
  value_decimals: number;
  unit_value: bigint;
  max_abs_delta: bigint;
  fraction_per_unit_bps: number;
  slippage_bps: number;
  max_twap_deviation_bps: number;
  twap_window_secs: number;
  floor_lamports: bigint;
  reserve_lamports: bigint;
  tokens_per_unit: bigint;
  vault_allocation: bigint;
}

/** The fields of config/burnkeeper/deficit.rules.json this mapping reads (structural, so the keeper's type need not be imported). */
export interface KeeperRulesLike {
  mode: "buyback" | "vault";
  decimals: number;
  vaultAllocation: string;
  buyback: { fractionPerUnit: string; reserveSol: string; slippageBps: number };
  rule: { unitUsd: string; burnPerUnitTokens: string; maxAbsDeltaUsd: string; carry: string; onNonIncrease: string };
}

const solToLamports = (s: string): bigint => {
  const m = /^(\d+)(?:\.(\d{1,9}))?$/.exec(s);
  if (!m) throw new Error(`not a SOL amount: ${s}`);
  return B(m[1]) * B(1_000_000_000) + B((m[2] ?? "").padEnd(9, "0") || "0");
};

/**
 * Maps the keeper's rule file to the program's RuleParams. Two inputs the file prices off chain are explicit here: the floor (the
 * file says USD; on chain it is lamports) and the TWAP guard (on chain only). Value decimals are 2 (Treasury cents).
 */
export function ruleParamsFromKeeperRules(r: KeeperRulesLike, o: { floorLamports: bigint; maxTwapDeviationBps: number; twapWindowSecs: number }): RuleParams {
  if (r.rule.carry !== "consecutive-increases" || r.rule.onNonIncrease !== "burn-nothing-reset-carry") throw new Error("only the consecutive-increases carry rule maps on chain");
  const m = /^0\.(\d{1,4})$/.exec(r.buyback.fractionPerUnit);
  if (!m) throw new Error(`fractionPerUnit ${r.buyback.fractionPerUnit} is not expressible in basis points`);
  const bps = Number(m[1].padEnd(4, "0"));
  const scale = B(10) ** B(r.decimals);
  const buyback = r.mode === "buyback";
  return {
    mode: buyback ? MODE_BUYBACK : MODE_VAULT,
    carry_rule: CARRY_CONSECUTIVE,
    pool_policy: POOL_POLICY_CREATOR_IS_FEE_PDA,
    value_decimals: 2,
    unit_value: B(r.rule.unitUsd) * B(100),
    max_abs_delta: B(r.rule.maxAbsDeltaUsd) * B(100),
    fraction_per_unit_bps: buyback ? bps : 0,
    slippage_bps: buyback ? r.buyback.slippageBps : 0,
    max_twap_deviation_bps: buyback ? o.maxTwapDeviationBps : 0,
    twap_window_secs: buyback ? o.twapWindowSecs : 0,
    floor_lamports: buyback ? o.floorLamports : ZERO,
    reserve_lamports: buyback ? solToLamports(r.buyback.reserveSol) : ZERO,
    tokens_per_unit: buyback ? ZERO : B(r.rule.burnPerUnitTokens) * scale,
    vault_allocation: buyback ? ZERO : B(r.vaultAllocation) * scale,
  };
}
