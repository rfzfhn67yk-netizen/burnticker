//! Pure arithmetic of the burn rule. No floats, u128 intermediates, every operation checked. Mirrored line for line in
//! `src/lib/burnReceipts/math.ts`; both sides are pinned by the same test vectors (see `tests` below and
//! `test/burnReceiptsMath.test.ts`).

use crate::constants::*;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MathError {
    Overflow,
    InvalidCarry,
    InvalidInput,
}

/// One reading through the rule.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Step {
    pub kind: u8,
    /// now − prev (value units; negative on a down day).
    pub delta: i64,
    /// Remainder carried INTO this reading (always < unit).
    pub carry_in: u64,
    /// Whole units this reading earns.
    pub units: u64,
    /// Remainder carried OUT (0 on a non-increase, and always 0 under CARRY_NONE).
    pub carry_out: u64,
}

/// THE UNIT RULE. On an increase: units = floor((delta + carry_in) / unit), the remainder carries (CARRY_CONSECUTIVE) or is dropped
/// (CARRY_NONE). A down or flat day earns nothing and resets the carry to zero.
pub fn step(prev: u64, now: u64, carry_in: u64, unit: u64, carry_rule: u8) -> Result<Step, MathError> {
    if unit == 0 {
        return Err(MathError::InvalidInput);
    }
    if carry_in >= unit || (carry_rule == CARRY_NONE && carry_in != 0) {
        return Err(MathError::InvalidCarry);
    }
    let delta_wide = (now as i128) - (prev as i128);
    let delta = i64::try_from(delta_wide).map_err(|_| MathError::Overflow)?;
    if delta <= 0 {
        return Ok(Step { kind: if delta == 0 { KIND_FLAT } else { KIND_DOWN }, delta, carry_in, units: 0, carry_out: 0 });
    }
    let total: u128 = match carry_rule {
        CARRY_CONSECUTIVE => (delta as u128).checked_add(carry_in as u128).ok_or(MathError::Overflow)?,
        CARRY_NONE => delta as u128,
        _ => return Err(MathError::InvalidInput),
    };
    let unit_w = unit as u128;
    let units = u64::try_from(total / unit_w).map_err(|_| MathError::Overflow)?;
    let carry_out = if carry_rule == CARRY_CONSECUTIVE { (total % unit_w) as u64 } else { 0 };
    Ok(Step { kind: KIND_INCREASE, delta, carry_in, units, carry_out })
}

/// |delta| above the bound is refused (a corrupt or mistyped reading is never burned).
pub fn delta_plausible(delta: i64, max_abs_delta: u64) -> bool {
    (delta.unsigned_abs()) <= max_abs_delta
}

/// Fixed-point scale of the spend computation.
pub const SPEND_SCALE: u128 = 1_000_000_000_000_000_000; // 1e18

/// (base / SCALE)^exp × SCALE by binary exponentiation, flooring after every multiplication. `base <= SCALE`, so every product
/// is at most 1e36 < u128::MAX. The TS mirror performs the identical sequence of floors.
pub fn pow_scaled_floor(base: u128, mut exp: u64) -> Result<u128, MathError> {
    if base > SPEND_SCALE {
        return Err(MathError::InvalidInput);
    }
    let mut result = SPEND_SCALE;
    let mut b = base;
    while exp > 0 {
        if exp & 1 == 1 {
            result = result.checked_mul(b).ok_or(MathError::Overflow)? / SPEND_SCALE;
        }
        exp >>= 1;
        if exp > 0 {
            b = b.checked_mul(b).ok_or(MathError::Overflow)? / SPEND_SCALE;
        }
    }
    Ok(result)
}

/// THE BUYBACK RULE: spend = pool × (1 − (1 − f)^units), f = fraction_per_unit_bps / 10,000. Computed as
/// keep = floor(pool × floor_pow(1 − f, units) / SCALE), spend = pool − keep, so spend ≤ pool always. Against the keeper's exact
/// rational (pool × (q−p)^u / q^u) the result differs by at most ~pool × 1e-15 (0–1 lamport for any pool under 10^15 lamports;
/// 15 lamports at u64::MAX), pinned by test; the on-chain number is the number of record.
pub fn buyback_spend(pool: u64, units: u64, fraction_per_unit_bps: u16) -> Result<u64, MathError> {
    if units == 0 || pool == 0 {
        return Ok(0);
    }
    let bps = fraction_per_unit_bps as u128;
    if bps == 0 || bps > BPS_DENOMINATOR {
        return Err(MathError::InvalidInput);
    }
    let keep_factor = SPEND_SCALE / BPS_DENOMINATOR * (BPS_DENOMINATOR - bps);
    let keep_pow = pow_scaled_floor(keep_factor, units)?;
    let keep = (pool as u128).checked_mul(keep_pow).ok_or(MathError::Overflow)? / SPEND_SCALE;
    let spend = (pool as u128) - keep;
    Ok(spend as u64)
}

/// The spendable pool: SOL above the reserve, plus any WSOL already in the fee PDA's WSOL account.
pub fn spendable_pool(fee_lamports: u64, reserve_lamports: u64, wsol_balance: u64) -> Result<u64, MathError> {
    fee_lamports.saturating_sub(reserve_lamports).checked_add(wsol_balance).ok_or(MathError::Overflow)
}

/// Minimum acceptable output of the buyback swap, derived from the pool's reserves at crank time:
/// constant-product output with no fee, less the pool's whole fee rate (trade + creator, parts per million), less the rule's
/// slippage tolerance. The cranker supplies no amounts at all.
pub fn min_amount_out(amount_in: u64, reserve_in: u64, reserve_out: u64, fee_rate_ppm: u64, slippage_bps: u16) -> Result<u64, MathError> {
    if reserve_in == 0 || reserve_out == 0 {
        return Err(MathError::InvalidInput);
    }
    if (fee_rate_ppm as u128) >= CPMM_FEE_DENOMINATOR || (slippage_bps as u128) >= BPS_DENOMINATOR {
        return Err(MathError::InvalidInput);
    }
    let a = amount_in as u128;
    let ideal = a.checked_mul(reserve_out as u128).ok_or(MathError::Overflow)? / (reserve_in as u128).checked_add(a).ok_or(MathError::Overflow)?;
    let after_fee = ideal.checked_mul(CPMM_FEE_DENOMINATOR - fee_rate_ppm as u128).ok_or(MathError::Overflow)? / CPMM_FEE_DENOMINATOR;
    let after_slip = after_fee.checked_mul(BPS_DENOMINATOR - slippage_bps as u128).ok_or(MathError::Overflow)? / BPS_DENOMINATOR;
    u64::try_from(after_slip).map_err(|_| MathError::Overflow)
}

/// Q32 price of SOL in tokens (token raw units per lamport × 2^32) from reserves — the high-precision side for a memecoin.
pub fn sol_price_x32(reserve_sol: u64, reserve_token: u64) -> Result<u128, MathError> {
    if reserve_sol == 0 {
        return Err(MathError::InvalidInput);
    }
    Ok(((reserve_token as u128) << 32) / reserve_sol as u128)
}

/// TWAP guard: a buy is refused when the spot SOL price (in tokens) is more than `max_dev_bps` BELOW the time-weighted average —
/// i.e. when the token has just been pushed up (a sandwich's front leg). `twap_x32` comes from the CPMM oracle ring, which records the
/// price BEFORE each swap and never the current block's manipulated spot.
pub fn twap_ok(spot_x32: u128, twap_x32: u128, max_dev_bps: u16) -> Result<bool, MathError> {
    let lhs = spot_x32.checked_mul(BPS_DENOMINATOR).ok_or(MathError::Overflow)?;
    let rhs = twap_x32.checked_mul(BPS_DENOMINATOR.checked_sub(max_dev_bps as u128).ok_or(MathError::InvalidInput)?).ok_or(MathError::Overflow)?;
    Ok(lhs >= rhs)
}

/// The token reserve a pool with `reserve_sol` lamports would hold if its price were the TWAP (`twap_x32` = tokens per lamport × 2^32),
/// saturating at u64::MAX.
pub fn twap_token_reserve(reserve_sol: u64, twap_x32: u128) -> u64 {
    let r = (reserve_sol as u128).saturating_mul(twap_x32) >> 32;
    u64::try_from(r).unwrap_or(u64::MAX)
}

/// Review-2 F1: the buyback's minimum output = max(spot quote, TWAP quote), each the constant-product output for `amount_in` less the
/// pool fee and `slippage_bps`:
///   spot quote: on the live reserves (r_sol, r_tok) — what min_amount_out always gave;
///   TWAP quote: on a pool of the same SOL depth priced at the TWAP, (r_sol, r_sol × twap / 2^32) — the same relative price impact
///               as the live pool, at the oracle's price.
/// A same-transaction push of the spot price (the sandwich front leg) lowers the spot quote but not the TWAP quote, so the swap must
/// still deliver the TWAP quote less slippage: the most a sandwich can extract is slippage_bps of the spend.
pub fn buyback_min_out(amount_in: u64, r_sol: u64, r_tok: u64, twap_x32: u128, fee_rate_ppm: u64, slippage_bps: u16) -> Result<u64, MathError> {
    let spot = min_amount_out(amount_in, r_sol, r_tok, fee_rate_ppm, slippage_bps)?;
    let twap_tok = twap_token_reserve(r_sol, twap_x32);
    if twap_tok == 0 {
        return Ok(spot);
    }
    let twap = min_amount_out(amount_in, r_sol, twap_tok, fee_rate_ppm, slippage_bps)?;
    Ok(spot.max(twap))
}

/// Vault settlement (mirrors the keeper's settleBurn): owed = min(planned + shortfall_in, allocation_left) (no cap when the
/// allocation is 0 = uncapped), burn = min(owed, vault balance), shortfall_out = owed − burn.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Settle {
    pub owed: u64,
    pub burn: u64,
    pub shortfall: u64,
    pub exhausted: bool,
}

pub fn settle_vault(planned: u64, shortfall_in: u64, vault_balance: u64, allocation: u64, total_burned: u64) -> Result<Settle, MathError> {
    // Saturating (review L-4): an owed amount beyond u64 can never be burned anyway, and an overflow must not wedge a reading.
    let want = planned.saturating_add(shortfall_in);
    let owed = if allocation == 0 {
        want
    } else {
        let left = allocation.saturating_sub(total_burned);
        if left == 0 {
            return Ok(Settle { owed: 0, burn: 0, shortfall: 0, exhausted: true });
        }
        want.min(left)
    };
    let burn = owed.min(vault_balance);
    Ok(Settle { owed, burn, shortfall: owed - burn, exhausted: false })
}

// ------------------------------------------------------------------------------------------------------------------------------
// Dates (record_date is a u32 YYYYMMDD) and canonical text
// ------------------------------------------------------------------------------------------------------------------------------

fn is_leap(y: u32) -> bool {
    (y.is_multiple_of(4) && !y.is_multiple_of(100)) || y.is_multiple_of(400)
}

fn days_in_month(y: u32, m: u32) -> u32 {
    match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => if is_leap(y) { 29 } else { 28 },
        _ => 0,
    }
}

/// A calendar date between 2000-01-01 and 2199-12-31.
pub fn valid_date(d: u32) -> bool {
    let (y, m, day) = (d / 10_000, (d / 100) % 100, d % 100);
    (2000..=2199).contains(&y) && (1..=12).contains(&m) && day >= 1 && day <= days_in_month(y, m)
}

/// UTC calendar date (YYYYMMDD) of a unix timestamp (Howard Hinnant's civil_from_days).
pub fn utc_date(unix_ts: i64) -> u32 {
    let z = unix_ts.div_euclid(86_400) + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y as u32) * 10_000 + (m as u32) * 100 + d as u32
}

/// "2026-10-08".
pub fn format_date(d: u32) -> String {
    format!("{:04}-{:02}-{:02}", d / 10_000, (d / 100) % 100, d % 100)
}

/// A fixed-point decimal with exactly `decimals` places ("40305316210829.72" for cents). Used for the attestation message and
/// the memo's prev/now/delta.
pub fn format_fixed(value: u128, decimals: u8, negative: bool) -> String {
    let sign = if negative && value != 0 { "-" } else { "" };
    if decimals == 0 {
        return format!("{}{}", sign, value);
    }
    let scale = 10u128.pow(decimals as u32);
    format!("{}{}.{:0width$}", sign, value / scale, value % scale, width = decimals as usize)
}

pub fn format_signed_fixed(delta: i64, decimals: u8) -> String {
    format_fixed(delta.unsigned_abs() as u128, decimals, delta < 0)
}

/// Raw base units → a token string with no trailing zeros ("2100000", "12.5"); the keeper's rawToTokens.
/// Second review (B): decimal-string splitting, so any u8 `decimals` works (10^20 and up no longer fit a u64 scale). The output is the
/// same as before for every decimals the old version could handle.
pub fn raw_to_tokens(raw: u64, decimals: u8) -> String {
    let digits = raw.to_string();
    let d = decimals as usize;
    if d == 0 {
        return digits;
    }
    let padded = if digits.len() <= d { format!("{}{}", "0".repeat(d + 1 - digits.len()), digits) } else { digits };
    let (whole, frac) = padded.split_at(padded.len() - d);
    let frac = frac.trim_end_matches('0');
    if frac.is_empty() {
        whole.to_string()
    } else {
        format!("{whole}.{frac}")
    }
}

/// Lowercase hex of the first 6 bytes (the memo's `rules=sha256:<12>`).
pub fn hex12(bytes: &[u8; 32]) -> String {
    let mut s = String::with_capacity(12);
    for b in &bytes[..6] {
        s.push_str(&format!("{:02x}", b));
    }
    s
}

#[cfg(test)]
mod tests {
    #[test]
    fn buyback_min_out_is_the_larger_quote() {
        // 100 SOL / 1e15 raw tokens pool; TWAP = spot → both quotes equal.
        let (r_sol, r_tok) = (100_000_000_000u64, 1_000_000_000_000_000u64);
        let spot_x32 = sol_price_x32(r_sol, r_tok).unwrap();
        let a = 2_000_000_000u64;
        let at_spot = min_amount_out(a, r_sol, r_tok, 3_500, 300).unwrap();
        assert_eq!(buyback_min_out(a, r_sol, r_tok, spot_x32, 3_500, 300).unwrap(), at_spot);
        // Spot pushed 3 % below the TWAP (front leg): the TWAP quote rules and is ≈ 3 % above the spot quote.
        let pushed_tok = r_tok / 100 * 97;
        let pushed = min_amount_out(a, r_sol, pushed_tok, 3_500, 300).unwrap();
        let m = buyback_min_out(a, r_sol, pushed_tok, spot_x32, 3_500, 300).unwrap();
        assert!(m > pushed && m <= at_spot && m >= at_spot - at_spot / 10_000);
        // ... and the pushed pool cannot deliver it even with zero slippage once the push exceeds slippage_bps.
        assert!(min_amount_out(a, r_sol, r_tok / 100 * 96, 3_500, 0).unwrap() < m);
        // Spot ABOVE the TWAP (cheaper tokens): the spot quote rules.
        let low_twap = spot_x32 / 2;
        assert_eq!(buyback_min_out(a, r_sol, r_tok, low_twap, 3_500, 300).unwrap(), at_spot);
        // No overflow at the extremes.
        assert!(buyback_min_out(u64::MAX / 2, u64::MAX, u64::MAX, u128::MAX >> 1, 0, 0).is_ok());
    }

    use super::*;

    const UNIT: u64 = 100_000_000_000; // $1B in cents

    #[test]
    fn spec_example_step() {
        // SPEC §4: prev=40284036147367.19 now=40305316210829.72 → delta $21.28B → 21 units, remainder carries.
        let s = step(4_028_403_614_736_719, 4_030_531_621_082_972, 0, UNIT, CARRY_CONSECUTIVE).unwrap();
        assert_eq!(s.kind, KIND_INCREASE);
        assert_eq!(s.delta, 2_128_006_346_253);
        assert_eq!(s.units, 21);
        assert_eq!(s.carry_out, 28_006_346_253);
    }

    #[test]
    fn carry_and_reset() {
        // +0.6B, +0.7B (→ 1 unit, 0.3B carried), −0.1B (reset), +0.8B (→ 0 units)
        let a = step(0, 60_000_000_000, 0, UNIT, CARRY_CONSECUTIVE).unwrap();
        assert_eq!((a.units, a.carry_out), (0, 60_000_000_000));
        let b = step(60_000_000_000, 130_000_000_000, a.carry_out, UNIT, CARRY_CONSECUTIVE).unwrap();
        assert_eq!((b.units, b.carry_out), (1, 30_000_000_000));
        let c = step(130_000_000_000, 120_000_000_000, b.carry_out, UNIT, CARRY_CONSECUTIVE).unwrap();
        assert_eq!((c.kind, c.units, c.carry_out), (KIND_DOWN, 0, 0));
        let d = step(120_000_000_000, 200_000_000_000, c.carry_out, UNIT, CARRY_CONSECUTIVE).unwrap();
        assert_eq!((d.units, d.carry_out), (0, 80_000_000_000));
        let f = step(200_000_000_000, 200_000_000_000, d.carry_out, UNIT, CARRY_CONSECUTIVE).unwrap();
        assert_eq!((f.kind, f.units, f.carry_out), (KIND_FLAT, 0, 0));
        // CARRY_NONE drops the remainder
        let g = step(0, 250_000_000_000, 0, UNIT, CARRY_NONE).unwrap();
        assert_eq!((g.units, g.carry_out), (2, 0));
        assert_eq!(step(0, 1, UNIT, UNIT, CARRY_CONSECUTIVE), Err(MathError::InvalidCarry));
    }

    #[test]
    fn spend_vectors() {
        // Shared with test/burnReceiptsMath.test.ts (SPEND_VECTORS). Every vector equals the keeper's exact rational
        // pool − floor(pool·(q−p)^u/q^u) except u64::MAX (exact 12_908_847_680_912_690: 15 lamports, 1e-15 relative).
        assert_eq!(buyback_spend(1_000_000_000, 1, 500).unwrap(), 50_000_000);
        assert_eq!(buyback_spend(1_000_000_000, 2, 500).unwrap(), 97_500_000);
        assert_eq!(buyback_spend(1_000_000_000, 21, 500).unwrap(), 659_438_374);
        assert_eq!(buyback_spend(123_456_789_012, 366, 500).unwrap(), 123_456_788_145);
        assert_eq!(buyback_spend(5_000_000_000, 0, 500).unwrap(), 0);
        assert_eq!(buyback_spend(5_000_000_000, 3, 10_000).unwrap(), 5_000_000_000);
        assert_eq!(buyback_spend(u64::MAX, 7, 1).unwrap(), 12_908_847_680_912_705);
        assert_eq!(buyback_spend(987_654_321, 13, 777).unwrap(), 642_555_338);
        assert!(buyback_spend(1, 1, 0).is_err());
        assert!(buyback_spend(1, 1, 10_001).is_err());
    }

    #[test]
    fn min_out_vectors() {
        // 1 SOL into 100 SOL / 1e15 raw tokens, 0.25% + 0% fee, 3% slippage.
        assert_eq!(min_amount_out(1_000_000_000, 100_000_000_000, 1_000_000_000_000_000, 2_500, 300).unwrap(), 9_579_950_495_048);
        assert!(min_amount_out(1, 0, 1, 0, 0).is_err());
        assert_eq!(min_amount_out(1, 1_000_000_000_000, 1, 0, 0).unwrap(), 0);
    }

    #[test]
    fn twap_guard() {
        let twap = 1_000u128 << 32;
        assert!(twap_ok(twap, twap, 1_500).unwrap());
        assert!(twap_ok(twap * 86 / 100, twap, 1_500).unwrap());
        assert!(!twap_ok(twap * 84 / 100, twap, 1_500).unwrap());
        assert!(twap_ok(twap * 2, twap, 0).unwrap());
    }

    #[test]
    fn vault_settlement() {
        assert_eq!(settle_vault(2_100_000, 0, 10_000_000, 0, 0).unwrap(), Settle { owed: 2_100_000, burn: 2_100_000, shortfall: 0, exhausted: false });
        assert_eq!(settle_vault(2_100_000, 600_000, 1_500_000, 0, 0).unwrap(), Settle { owed: 2_700_000, burn: 1_500_000, shortfall: 1_200_000, exhausted: false });
        assert_eq!(settle_vault(2_100_000, 0, 9_999_999, 3_000_000, 2_000_000).unwrap(), Settle { owed: 1_000_000, burn: 1_000_000, shortfall: 0, exhausted: false });
        assert!(settle_vault(1, 0, 1, 3_000_000, 3_000_000).unwrap().exhausted);
    }

    #[test]
    fn dates_and_text() {
        assert!(valid_date(20261008));
        assert!(valid_date(20240229));
        assert!(!valid_date(20250229));
        assert!(!valid_date(20261301));
        assert!(!valid_date(19991231));
        assert_eq!(utc_date(0), 19700101);
        assert_eq!(utc_date(1_791_590_400), 20261010); // 2026-10-10T00:00:00Z
        assert_eq!(utc_date(1_791_590_399), 20261009);
        assert_eq!(format_date(20261008), "2026-10-08");
        assert_eq!(format_fixed(4_030_531_621_082_972, 2, false), "40305316210829.72");
        assert_eq!(format_signed_fixed(-1_000_000_005, 2), "-10000000.05");
        assert_eq!(format_signed_fixed(5, 2), "0.05");
        assert_eq!(format_fixed(2272, 3, false), "2.272");
        assert_eq!(raw_to_tokens(2_100_000_000_000, 6), "2100000");
        assert_eq!(raw_to_tokens(12_500_000, 6), "12.5");
        assert_eq!(raw_to_tokens(0, 6), "0");
        assert_eq!(raw_to_tokens(1, 6), "0.000001");
        // second review (B): decimals past u64's 10^19 scale
        assert_eq!(raw_to_tokens(10_000_000_000_000_000_000u64, 20), "0.1");
        assert_eq!(raw_to_tokens(u64::MAX, 255).len(), 2 + 255, "0. then 255 digits");
        assert_eq!(raw_to_tokens(u64::MAX, 19), "1.8446744073709551615");
        assert_eq!(raw_to_tokens(u64::MAX, 0), "18446744073709551615");
        assert_eq!(raw_to_tokens(1_000, 3), "1");
        let mut h = [0u8; 32];
        h[0] = 0xab; h[5] = 0x01;
        assert_eq!(hex12(&h), "ab0000000001");
    }
}
