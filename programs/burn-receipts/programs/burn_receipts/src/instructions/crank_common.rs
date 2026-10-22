use anchor_lang::prelude::*;

use anchor_spl::token::Mint;

use crate::error::BurnError;
use crate::memo::MemoHead;
use crate::state::{default_active_cap, PlatformConfig, Reading, TokenConfig};

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

/// The burn-pool cap in force (review M-1). The account passed is always the platform PDA (seeds-checked by the caller); if it
/// holds a PlatformConfig, that config rules; if it was never created, the hard-coded default (25 SOL until
/// DEFAULT_CAP_SUNSET_TS) applies — so a missing PlatformConfig can never wedge buybacks.
/// Review-3 L-4 + re-check R3-4: the cranker allowlist in force — the PlatformConfig's keys while its cap is in force and for at most
/// 90 days after initialize_platform; empty (permissionless) otherwise, and always when no PlatformConfig exists.
pub fn crankers_in_force(platform: &AccountInfo, now: i64) -> Result<Vec<Pubkey>> {
    if platform.owner == &crate::ID && !platform.data_is_empty() {
        let data = platform.try_borrow_data()?;
        let p = PlatformConfig::try_deserialize(&mut &data[..])?;
        return Ok(p.crankers_in_force(now).to_vec());
    }
    Ok(Vec::new())
}

pub fn active_cap(platform: &AccountInfo, now: i64) -> Result<Option<u64>> {
    if platform.owner == &crate::ID && !platform.data_is_empty() {
        let data = platform.try_borrow_data()?;
        let p = PlatformConfig::try_deserialize(&mut &data[..])?;
        Ok(p.active_cap(now))
    } else {
        Ok(default_active_cap(now))
    }
}
