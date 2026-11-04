//! Round 5 — Raydium AMM v4 (raydium-amm), the second target-pool kind: the read-only view of AmmInfo and the one CPI (swap_base_in_v2).
//!
//! Layout read by byte offset from raydium-amm commit d26944bfb76fb5fa8f91e5d440c2050ed358ef81 (program/src/state.rs AmmInfo,
//! `#[repr(C)]`, 752 bytes, no discriminator), confirmed against live mainnet pools (WIF EP2ib6dY…, POPCAT FRhB8L7Y…, BONK HVNwzt7P…,
//! MEW 879F697i…, FARTCOIN Bzc9NZfM…: 752 bytes, status 6, nonce 254, swap fee 25/10000). Only SWAP-ONLY pools (status 6) are admitted:
//! no OpenBook orders, so the tradeable reserve is exactly the vault less the owed protocol PnL — the program's own
//! `calc_total_without_take_pnl_no_orderbook`. swap_base_in_v2 (instruction 16, 8 accounts, no market accounts) was confirmed live on
//! mainnet on 2026-10-13: 22 of 22 AMM v4 instructions in the last 40 transactions on WIF's pool were tag 16
//! (docs/burnticker/EXTERNAL-BURN-VENUES.md).

use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};

use crate::constants::AMM_V4_PROGRAM_ID;
use crate::error::BurnError;

pub const AMM_INFO_LEN: usize = 752;
pub const AMM_STATUS_SWAP_ONLY: u64 = 6;
pub const AMM_AUTHORITY_SEED: &[u8] = b"amm authority";
pub const SWAP_BASE_IN_V2_TAG: u8 = 16;

mod off {
    pub const STATUS: usize = 0;
    pub const NONCE: usize = 8;
    pub const SWAP_FEE_NUMERATOR: usize = 176;
    pub const SWAP_FEE_DENOMINATOR: usize = 184;
    pub const NEED_TAKE_PNL_COIN: usize = 192;
    pub const NEED_TAKE_PNL_PC: usize = 200;
    pub const COIN_VAULT: usize = 336;
    pub const PC_VAULT: usize = 368;
    pub const COIN_MINT: usize = 400;
    pub const PC_MINT: usize = 432;
}

#[derive(Debug, Clone, Copy)]
pub struct AmmV4View {
    pub status: u64,
    pub nonce: u64,
    pub swap_fee_numerator: u64,
    pub swap_fee_denominator: u64,
    pub need_take_pnl_coin: u64,
    pub need_take_pnl_pc: u64,
    pub coin_vault: Pubkey,
    pub pc_vault: Pubkey,
    pub coin_mint: Pubkey,
    pub pc_mint: Pubkey,
}

impl AmmV4View {
    pub fn load(acc: &AccountInfo) -> Result<Self> {
        require_keys_eq!(*acc.owner, AMM_V4_PROGRAM_ID, BurnError::TargetPoolInvalid);
        let d = acc.try_borrow_data()?;
        require!(d.len() == AMM_INFO_LEN, BurnError::TargetPoolInvalid);
        let u = |at: usize| u64::from_le_bytes(d[at..at + 8].try_into().expect("8 bytes"));
        let k = |at: usize| Pubkey::new_from_array(d[at..at + 32].try_into().expect("32 bytes"));
        Ok(AmmV4View {
            status: u(off::STATUS),
            nonce: u(off::NONCE),
            swap_fee_numerator: u(off::SWAP_FEE_NUMERATOR),
            swap_fee_denominator: u(off::SWAP_FEE_DENOMINATOR),
            need_take_pnl_coin: u(off::NEED_TAKE_PNL_COIN),
            need_take_pnl_pc: u(off::NEED_TAKE_PNL_PC),
            coin_vault: k(off::COIN_VAULT),
            pc_vault: k(off::PC_VAULT),
            coin_mint: k(off::COIN_MINT),
            pc_mint: k(off::PC_MINT),
        })
    }

    pub fn try_load(acc: &AccountInfo) -> Option<Self> {
        if *acc.owner != AMM_V4_PROGRAM_ID {
            return None;
        }
        Self::load(acc).ok()
    }

    /// Some(true) when WSOL is the coin side and `target` the pc side, Some(false) for the reverse, None otherwise.
    pub fn wsol_is_coin(&self, wsol: &Pubkey, target: &Pubkey) -> Option<bool> {
        if self.coin_mint == *wsol && self.pc_mint == *target {
            Some(true)
        } else if self.pc_mint == *wsol && self.coin_mint == *target {
            Some(false)
        } else {
            None
        }
    }

    /// The swap fee in parts per million, rounded UP (the program takes ceil(amount × num / den)), or None for a malformed fee.
    pub fn fee_ppm(&self) -> Option<u64> {
        if self.swap_fee_denominator == 0 || self.swap_fee_numerator >= self.swap_fee_denominator {
            return None;
        }
        let n = (self.swap_fee_numerator as u128) * 1_000_000;
        let d = self.swap_fee_denominator as u128;
        u64::try_from(n.div_ceil(d)).ok()
    }

    /// The vault-and-authority PDA the program signs with: create_program_address(["amm authority", nonce]).
    pub fn authority(&self) -> Option<Pubkey> {
        let nonce = u8::try_from(self.nonce).ok()?;
        Pubkey::create_program_address(&[AMM_AUTHORITY_SEED, &[nonce]], &AMM_V4_PROGRAM_ID).ok()
    }

    /// (wsol vault, target vault, owed PnL on the WSOL side, owed PnL on the target side).
    pub fn sides(&self, wsol_is_coin: bool) -> (Pubkey, Pubkey, u64, u64) {
        if wsol_is_coin {
            (self.coin_vault, self.pc_vault, self.need_take_pnl_coin, self.need_take_pnl_pc)
        } else {
            (self.pc_vault, self.coin_vault, self.need_take_pnl_pc, self.need_take_pnl_coin)
        }
    }
}

pub struct AmmV4SwapAccounts<'a, 'info> {
    pub token_program: &'a AccountInfo<'info>,
    pub amm: &'a AccountInfo<'info>,
    pub authority: &'a AccountInfo<'info>,
    pub coin_vault: &'a AccountInfo<'info>,
    pub pc_vault: &'a AccountInfo<'info>,
    pub user_source: &'a AccountInfo<'info>,
    pub user_destination: &'a AccountInfo<'info>,
    pub user_owner: &'a AccountInfo<'info>,
}

/// swap_base_in_v2: [16, amount_in u64, minimum_amount_out u64]; accounts token program, amm (w), authority, coin vault (w), pc vault (w),
/// user source (w), user destination (w), user owner (signer) — raydium-amm instruction.rs `swap_base_in_v2`.
pub fn swap_base_in_v2<'info>(a: AmmV4SwapAccounts<'_, 'info>, amount_in: u64, minimum_amount_out: u64, signer_seeds: &[&[&[u8]]]) -> Result<()> {
    let mut data = Vec::with_capacity(17);
    data.push(SWAP_BASE_IN_V2_TAG);
    data.extend_from_slice(&amount_in.to_le_bytes());
    data.extend_from_slice(&minimum_amount_out.to_le_bytes());
    let ix = Instruction {
        program_id: AMM_V4_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new_readonly(*a.token_program.key, false),
            AccountMeta::new(*a.amm.key, false),
            AccountMeta::new_readonly(*a.authority.key, false),
            AccountMeta::new(*a.coin_vault.key, false),
            AccountMeta::new(*a.pc_vault.key, false),
            AccountMeta::new(*a.user_source.key, false),
            AccountMeta::new(*a.user_destination.key, false),
            AccountMeta::new_readonly(*a.user_owner.key, true),
        ],
        data,
    };
    anchor_lang::solana_program::program::invoke_signed(
        &ix,
        &[a.token_program.clone(), a.amm.clone(), a.authority.clone(), a.coin_vault.clone(), a.pc_vault.clone(), a.user_source.clone(), a.user_destination.clone(), a.user_owner.clone()],
        signer_seeds,
    )
    .map_err(Into::into)
}
