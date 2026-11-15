//! Round 5 — the price guard of a target burn: Pyth's PriceUpdateV2 accounts (pyth-solana-receiver), read by byte offset.
//!
//! Why Pyth: a target pool's own state can be pushed inside a Jito bundle of separate transactions (push, observe, push back), so no
//! reference the program records from the pool itself can guard a swap on an AMM v4 pool (which has no observation ring). Pyth prices
//! come from Pyth's publishers, verified by Wormhole guardian signatures, and no trade on the pool moves them. Every target crank (both
//! pool kinds) compares the pool's spot price with the Pyth target/SOL ratio and computes its minimum output from that ratio.
//!
//! Layout (pyth-solana-receiver-sdk PriceUpdateV2, Anchor account): discriminator(8) ‖ write_authority(32) ‖ verification_level (Borsh
//! enum: 0 = Partial { num_signatures: u8 } [2 bytes], 1 = Full [1 byte]) ‖ PriceFeedMessage { feed_id [32], price i64, conf u64,
//! exponent i32, publish_time i64, prev_publish_time i64, ema_price i64, ema_conf u64 } ‖ posted_slot u64. Only FULL verification is
//! accepted (all guardian signatures checked by the receiver; Pyth's sponsored feed accounts are Full); a Partial update is refused.

use anchor_lang::prelude::*;

use crate::constants::{PYTH_MAX_AGE_SECS, PYTH_MAX_CONF_BPS, PYTH_MAX_FEED_SKEW_SECS, PYTH_MAX_FUTURE_SECS, PYTH_RECEIVER_PROGRAM_ID};
use crate::error::BurnError;

/// sha256("account:PriceUpdateV2")[..8]
pub const PRICE_UPDATE_V2_DISCRIMINATOR: [u8; 8] = [34, 241, 35, 99, 157, 126, 244, 205];
/// discriminator + write authority + Full tag + feed id + price + conf + exponent + publish_time (the fields read).
pub const PRICE_UPDATE_V2_MIN_LEN: usize = 8 + 32 + 1 + 32 + 8 + 8 + 4 + 8;
const VERIFICATION_FULL: u8 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PythPrice {
    pub price: i64,
    pub conf: u64,
    pub exponent: i32,
    pub publish_time: i64,
}

/// Reads a Pyth price. The OUTER error is a wrong account (not the receiver's, not a PriceUpdateV2, not fully verified, another feed):
/// a hard refusal the cranker caused. The INNER error is a usable account whose price cannot be used NOW (stale, wide, non-positive):
/// the crank is held like an unhealthy pool (and the 30-day unblock applies).
pub fn read_price(acc: &AccountInfo, feed_id: &[u8; 32], now: i64) -> Result<core::result::Result<PythPrice, BurnError>> {
    require_keys_eq!(*acc.owner, PYTH_RECEIVER_PROGRAM_ID, BurnError::TargetPythInvalid);
    let d = acc.try_borrow_data()?;
    require!(d.len() >= PRICE_UPDATE_V2_MIN_LEN && d[..8] == PRICE_UPDATE_V2_DISCRIMINATOR, BurnError::TargetPythInvalid);
    require!(d[40] == VERIFICATION_FULL, BurnError::TargetPythInvalid);
    let m = 41;
    require!(d[m..m + 32] == feed_id[..], BurnError::TargetPythInvalid);
    let i64_at = |at: usize| i64::from_le_bytes(d[at..at + 8].try_into().expect("8 bytes"));
    let p = PythPrice {
        price: i64_at(m + 32),
        conf: u64::from_le_bytes(d[m + 40..m + 48].try_into().expect("8 bytes")),
        exponent: i32::from_le_bytes(d[m + 48..m + 52].try_into().expect("4 bytes")),
        publish_time: i64_at(m + 52),
    };
    Ok(usable(&p, now).map(|_| p))
}

/// The sponsored (push-oracle) PriceUpdateV2 account of a feed, shard 0: PDA([0u16 LE, feed id], PYTH_PUSH_ORACLE_PROGRAM_ID).
pub fn sponsored_address(feed_id: &[u8; 32]) -> Pubkey {
    Pubkey::find_program_address(&[&0u16.to_le_bytes(), feed_id], &crate::constants::PYTH_PUSH_ORACLE_PROGRAM_ID).0
}

/// Whether a parsed price can be used NOW (the inner error of read_price). A publish time in the future beyond clock skew
/// (PYTH_MAX_FUTURE_SECS, second review R5-01: it was the 60-second age window before) is not a price this cluster can have seen:
/// unusable, never "fresh forever".
pub fn usable(p: &PythPrice, now: i64) -> core::result::Result<(), BurnError> {
    if p.price <= 0 || (p.conf as u128) * 10_000 > (p.price as u128) * PYTH_MAX_CONF_BPS as u128 || p.publish_time > now.saturating_add(PYTH_MAX_FUTURE_SECS) {
        return Err(BurnError::PythUnusable);
    }
    if now.saturating_sub(p.publish_time) > PYTH_MAX_AGE_SECS {
        return Err(BurnError::PythStale);
    }
    Ok(())
}

/// Round-5 review R5-7: the SOL/USD and target/USD updates of one reference were published within PYTH_MAX_FEED_SKEW_SECS of each other.
pub fn feeds_aligned(sol: &PythPrice, target: &PythPrice) -> bool {
    sol.publish_time.abs_diff(target.publish_time) <= PYTH_MAX_FEED_SKEW_SECS as u64
}

/// The Pyth reference in the program's price unit: target raw units per lamport × 2^32 (the unit of math::sol_price_x32), from SOL/USD
/// and target/USD: (sol / target) × 10^(target_decimals − 9) × 2^32. None when it does not fit (an absurd exponent) or rounds to 0.
pub fn sol_price_x32(sol: &PythPrice, target: &PythPrice, target_decimals: u8) -> Option<u128> {
    let mut num = (sol.price as u128).checked_shl(32)?;
    let mut den = target.price as u128;
    let e = sol.exponent as i64 - target.exponent as i64 + target_decimals as i64 - 9;
    if !(-30..=30).contains(&e) {
        return None;
    }
    let p = 10u128.checked_pow(e.unsigned_abs() as u32)?;
    if e >= 0 {
        num = num.checked_mul(p)?;
    } else {
        den = den.checked_mul(p)?;
    }
    let r = num / den;
    if r == 0 { None } else { Some(r) }
}

/// |spot − reference| ≤ reference × max_dev_bps / 10,000 (two-sided: a pushed price either way holds the crank).
/// Second review R5-01: exact, overflow-safe — if either product overflows u128 the band is refused (fail closed); the saturating
/// version accepted any spot once both sides saturated to u128::MAX.
pub fn within(spot_x32: u128, reference_x32: u128, max_dev_bps: u16) -> bool {
    let diff = spot_x32.abs_diff(reference_x32);
    match (diff.checked_mul(10_000), reference_x32.checked_mul(max_dev_bps as u128)) {
        (Some(lhs), Some(rhs)) => lhs <= rhs,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reference_units() {
        // SOL $100 (expo −8), target $1.0625e-5 (expo −12), 6 decimals → 9,411.76 raw tokens per lamport
        let sol = PythPrice { price: 10_000_000_000, conf: 0, exponent: -8, publish_time: 0 };
        let t = PythPrice { price: 10_625_000, conf: 0, exponent: -12, publish_time: 0 };
        let r = sol_price_x32(&sol, &t, 6).unwrap();
        assert_eq!(r >> 32, 9_411);
        assert!(within(r, r * 102 / 100, 300) && !within(r, r * 104 / 100, 300) && !within(r * 104 / 100, r, 300));
    }

    /// Second review R5-01: SOL (1, expo 0), target (1, expo −28), 9 decimals → a reference of ≈ 4.29e40; both sides of the band used
    /// to saturate to u128::MAX, so a spot of 1 << 32 (an almost 100 % shortfall) passed a 300-bps band.
    #[test]
    fn extreme_reference_must_not_disable_deviation_guard() {
        let sol = PythPrice { price: 1, conf: 0, exponent: 0, publish_time: 0 };
        let t = PythPrice { price: 1, conf: 0, exponent: -28, publish_time: 0 };
        let reference = sol_price_x32(&sol, &t, 9).unwrap();
        assert!(reference > u128::MAX / 10_000, "the reference is large enough to overflow the old products");
        assert!(!within(1u128 << 32, reference, 300));
        assert!(!within(reference, 1u128 << 32, 300));
        // the exact comparison still accepts what is inside the band
        assert!(within(1_000_000, 1_000_000, 0) && within(1_030_000, 1_000_000, 300) && !within(1_030_001, 1_000_000, 300));
    }

    /// Second review: a publish time may run ahead of the clock by the skew allowance only (5 s), not the 60-second age window.
    #[test]
    fn a_future_publish_time_beyond_five_seconds_is_unusable() {
        let at = |publish_time| PythPrice { price: 100, conf: 0, exponent: 0, publish_time };
        let now = 1_000_000;
        assert!(usable(&at(now + 5), now).is_ok());
        assert!(matches!(usable(&at(now + 6), now), Err(BurnError::PythUnusable)));
        assert!(matches!(usable(&at(now + 60), now), Err(BurnError::PythUnusable)));
        assert!(usable(&at(now - 60), now).is_ok());
        assert!(matches!(usable(&at(now - 61), now), Err(BurnError::PythStale)));
    }

    /// R5-7: the two feeds must be published within 60 s of each other.
    #[test]
    fn the_two_feeds_must_be_published_within_sixty_seconds() {
        let at = |publish_time| PythPrice { price: 100, conf: 0, exponent: 0, publish_time };
        assert!(feeds_aligned(&at(1_000), &at(1_060)) && feeds_aligned(&at(1_060), &at(1_000)));
        assert!(!feeds_aligned(&at(1_000), &at(1_061)) && !feeds_aligned(&at(1_061), &at(1_000)));
    }
}
