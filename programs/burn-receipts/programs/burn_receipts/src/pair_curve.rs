//! The read-only view of a `pair_curve` Pair account (programs/pair_curve/src/state.rs) that register_pair_pool needs.
//!
//! Read by byte offset, like the LaunchLab views in cpmm.rs: owner (the hard-coded PAIR_CURVE_PROGRAM_ID), Anchor discriminator
//! sha256("account:Pair")[..8], length and address (["pair", mint_a, mint_b] under pair_curve) are checked before any field is used.
//! The offsets are pair_curve's LAYOUT CONTRACT (state.rs `offsets`), pinned by programs/pair_curve/tests/lifecycle.rs against a real
//! account created by the real program.

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
    pub const LP_BURNED: usize = 156;
    pub const CP_CONFIG: usize = 172;
    pub const VAULT: usize = 204;
    pub const MIN_LEN: usize = 236;
}

#[derive(Debug, Clone, Copy)]
pub struct PairView {
    pub status: u8,
    pub mints: [Pubkey; 2],
    pub pools: [Pubkey; 2],
    pub lp_supply_at_creation: [u64; 2],
    pub lp_burned: [u64; 2],
    pub cp_config: Pubkey,
    pub vault: Pubkey,
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
            lp_burned: [u64_at(&d, off::LP_BURNED), u64_at(&d, off::LP_BURNED + 8)],
            cp_config: pk(&d, off::CP_CONFIG),
            vault: pk(&d, off::VAULT),
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
