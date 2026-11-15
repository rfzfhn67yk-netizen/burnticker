//! The read-only view of a `pair_curve` Pair account (programs/pair_curve/src/state.rs) that register_pair_pool needs.
//!
//! Read by byte offset, like the LaunchLab views in cpmm.rs: owner (the hard-coded PAIR_CURVE_PROGRAM_ID), Anchor discriminator
//! sha256("account:Pair")[..8], length and address (["pair", mint_a, mint_b] under pair_curve) are checked before any field is used.
//! The offsets are pair_curve's LAYOUT CONTRACT (state.rs `offsets`), pinned by programs/pair_curve/tests/lifecycle.rs against a real
//! account created by the real program — except `refunding` (offset 880, outside state.rs `offsets`), which is pinned by
//! programs/pair_curve/tests/review_pc1.rs `pf_r2_half_graduated_pair_refuses_a_win_for_the_dead_side_and_unlinks_on_the_refund`
//! (pair-forward r3 RI-5).

use anchor_lang::prelude::*;

use crate::constants::{PAIR_CURVE_PAIR_SEED, PAIR_CURVE_POOL_SEED, PAIR_CURVE_PROGRAM_ID, PAIR_CURVE_VAULT_SEED};
use crate::error::BurnError;

pub const PAIR_DISCRIMINATOR: [u8; 8] = [85, 72, 49, 176, 182, 228, 141, 82];
pub const PAIR_STATUS_GRADUATED: u8 = 1;
/// pair_curve's `graduate` runs once per side; between the two calls the pair is Graduating and the first side's pool is final.
pub const PAIR_STATUS_GRADUATING: u8 = 3;

mod off {
    pub const STATUS: usize = 11;
    pub const MINTS: usize = 12;
    pub const POOLS: usize = 76;
    pub const LP_SUPPLY_AT_CREATION: usize = 140;
    /// lp_locked (named lp_burned before LAUNCHPAD-PATH §35; same offset): the LP pair_curve's lock_lp moved into the lock.
    pub const LP_LOCKED: usize = 156;
    pub const CP_CONFIG: usize = 172;
    pub const VAULT: usize = 204;
    /// `refunding: [bool; 2]` (pair_curve state.rs; NOT in its `offsets` module — pinned by programs/pair_curve/tests/review_pc1.rs
    /// pf_r2_half_graduated_pair_refuses_a_win_for_the_dead_side_and_unlinks_on_the_refund, against a real account; 880 is correct for
    /// the 946-byte layout) — read only when the account is long enough (unlink_pair / link_pair evidence).
    pub const REFUNDING: usize = 880;
    pub const MIN_LEN: usize = 236;
}

#[derive(Debug, Clone, Copy)]
pub struct PairView {
    pub status: u8,
    pub mints: [Pubkey; 2],
    pub pools: [Pubkey; 2],
    pub lp_supply_at_creation: [u64; 2],
    pub lp_locked: [u64; 2],
    pub cp_config: Pubkey,
    pub vault: Pubkey,
    /// pair_curve's per-side refund flag (a side whose pool never came; its holders redeem pro rata).
    pub refunding: [bool; 2],
}

fn pk(d: &[u8], at: usize) -> Pubkey {
    Pubkey::new_from_array(d[at..at + 32].try_into().expect("32 bytes"))
}
fn u64_at(d: &[u8], at: usize) -> u64 {
    u64::from_le_bytes(d[at..at + 8].try_into().expect("8 bytes"))
}

impl PairView {
    pub fn load(acc: &AccountInfo) -> Result<Self> {
        require_keys_eq!(*acc.owner, PAIR_CURVE_PROGRAM_ID, BurnError::InvalidPairAccount);
        let d = acc.try_borrow_data()?;
        require!(d.len() >= off::MIN_LEN && d[..8] == PAIR_DISCRIMINATOR, BurnError::InvalidPairAccount);
        let v = PairView {
            status: d[off::STATUS],
            mints: [pk(&d, off::MINTS), pk(&d, off::MINTS + 32)],
            pools: [pk(&d, off::POOLS), pk(&d, off::POOLS + 32)],
            lp_supply_at_creation: [u64_at(&d, off::LP_SUPPLY_AT_CREATION), u64_at(&d, off::LP_SUPPLY_AT_CREATION + 8)],
            lp_locked: [u64_at(&d, off::LP_LOCKED), u64_at(&d, off::LP_LOCKED + 8)],
            cp_config: pk(&d, off::CP_CONFIG),
            vault: pk(&d, off::VAULT),
            refunding: if d.len() >= off::REFUNDING + 2 { [d[off::REFUNDING] != 0, d[off::REFUNDING + 1] != 0] } else { [false, false] },
        };
        let expected = Pubkey::find_program_address(&[PAIR_CURVE_PAIR_SEED, v.mints[0].as_ref(), v.mints[1].as_ref()], &PAIR_CURVE_PROGRAM_ID).0;
        require_keys_eq!(*acc.key, expected, BurnError::InvalidPairAccount);
        Ok(v)
    }
}

/// The pair's SOL vault (the CPMM pool_creator of both pools): ["vault", pair] under pair_curve.
pub fn pair_vault(pair: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[PAIR_CURVE_VAULT_SEED, pair.as_ref()], &PAIR_CURVE_PROGRAM_ID).0
}

/// A graduated pool's address: ["pool", pair, [side]] under pair_curve — only pair_curve can sign for it, so only pair_curve's
/// `graduate` can have created a CPMM pool there.
pub fn pair_pool(pair: &Pubkey, side: u8) -> Pubkey {
    Pubkey::find_program_address(&[PAIR_CURVE_POOL_SEED, pair.as_ref(), &[side]], &PAIR_CURVE_PROGRAM_ID).0
}
