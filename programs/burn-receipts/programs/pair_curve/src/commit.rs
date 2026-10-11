//! The commit rule shared by the trades and `graduate`, and the AmmConfig reader.
//!
//! Blind review 2 L-2: a weak-side holder could sell a hair before the graduate crank landed and un-meet the minimum share at the
//! lamport. The pair now LATCHES: the first trade that leaves it ready (combined raise at target, each side at its minimum share,
//! before the deadline, and both sides able to pay for their pools at the CURRENT AmmConfig — blind review 1 L-1) commits it in the
//! same instruction (status Graduating; curves closed). `graduate` then only creates the pools (its Open branch applies the same rule,
//! for a pair that became ready while Raydium's fee was too high).

use anchor_lang::prelude::*;

use burn_receipts::constants::CPMM_PROGRAM_ID;

use crate::constants::*;
use crate::error::PairError;
use crate::math::{graduation_ready, side_costs};
use crate::state::Pair;

#[derive(Clone, Copy, Debug)]
pub struct AmmView {
    pub disabled: bool,
    pub create_pool_fee: u64,
}

/// The pinned AmmConfig (owner CPMM, discriminator, length; the caller pins the address).
pub fn read_amm(acc: &AccountInfo) -> Result<AmmView> {
    require_keys_eq!(*acc.owner, CPMM_PROGRAM_ID, PairError::InvalidAmmConfig);
    let d = acc.try_borrow_data()?;
    require!(d.len() >= burn_receipts::cpmm::AMM_CONFIG_LEN && d[..8] == burn_receipts::cpmm::AMM_CONFIG_DISCRIMINATOR, PairError::InvalidAmmConfig);
    Ok(AmmView {
        disabled: d[AMM_CONFIG_DISABLE_CREATE_POOL] != 0,
        create_pool_fee: u64::from_le_bytes(d[AMM_CONFIG_CREATE_POOL_FEE..AMM_CONFIG_CREATE_POOL_FEE + 8].try_into().expect("8 bytes")),
    })
}

/// Can side `s` pay for its pool now (pool creation enabled, raise ≥ overhead + the minimum liquidity)?
pub fn side_can_graduate(p: &Pair, s: usize, amm: &AmmView, rent: &Rent) -> bool {
    !amm.disabled && p.sol[s] as u128 >= side_costs(rent, amm.create_pool_fee) as u128 + MIN_POOL_LIQUIDITY_LAMPORTS as u128
}

/// Commit the pair if it is Open, before the deadline, ready, and both sides can pay for their pools. Returns whether it committed.
pub fn try_commit(p: &mut Pair, now: i64, amm: &AmmView, rent: &Rent) -> bool {
    if p.status != STATUS_OPEN || now >= p.deadline {
        return false;
    }
    if !graduation_ready(p.sol[0], p.sol[1], p.target_raise_lamports, p.min_side_share_bps) {
        return false;
    }
    if !side_can_graduate(p, 0, amm, rent) || !side_can_graduate(p, 1, amm, rent) {
        return false;
    }
    p.status = STATUS_GRADUATING;
    p.graduation_started_at = now;
    p.raise_at_graduation = p.sol;
    true
}
