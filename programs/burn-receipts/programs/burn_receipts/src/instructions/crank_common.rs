use anchor_lang::prelude::*;

use anchor_spl::token::Mint;

use crate::error::BurnError;
use crate::memo::MemoHead;
use crate::state::{default_recovery_open, PlatformConfig, Reading, TokenConfig};

/// Readings are processed strictly in submission order: the reading must be the successor of the last processed one.
pub fn require_next_in_line(c: &TokenConfig, r: &Reading) -> Result<()> {
    require!(!r.processed, BurnError::AlreadyProcessed);
    require!(r.prev_date == c.crank_cursor, BurnError::OutOfOrder);
    Ok(())
}

pub fn memo_head<'a>(c: &'a TokenConfig, r: &Reading) -> MemoHead<'a> {
    MemoHead {
        prefix: c.memo_prefix_str(),
        record_date: r.record_date,
        source: c.memo_source_str(),
        prev: r.prev_value,
        now: r.value,
        delta: r.delta,
        value_decimals: c.rule.value_decimals,
        units: r.units,
        rules_sha256: &c.rules_sha256,
    }
}

/// Review L-3: burns are only meaningful (and only un-freezable) on a fixed-supply mint with no freeze authority.
pub fn require_fixed_supply(mint: &Mint) -> Result<()> {
    require!(mint.mint_authority.is_none(), BurnError::MintAuthorityRetained);
    require!(mint.freeze_authority.is_none(), BurnError::FreezeAuthorityRetained);
    Ok(())
}

/// Owner decision 2026-10-25: there is no burn-pool cap and no cranker allowlist any more; the crank instructions still take the
/// platform PDA (the IDL is unchanged) but never read it. Only the stranding-recovery registration-policy switch reads it: open before
/// the platform sunset — the PlatformConfig's `cap_sunset_ts` if one lives there (seeds-checked by the caller), the hard-coded
/// DEFAULT_CAP_SUNSET_TS if it was never created (review M-1).
pub fn recovery_open(platform: &AccountInfo, now: i64) -> Result<bool> {
    if platform.owner == &crate::ID && !platform.data_is_empty() {
        let data = platform.try_borrow_data()?;
        let p = PlatformConfig::try_deserialize(&mut &data[..])?;
        Ok(p.recovery_open(now))
    } else {
        Ok(default_recovery_open(now))
    }
}
