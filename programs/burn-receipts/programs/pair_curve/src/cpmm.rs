//! The one Raydium CPMM instruction pair_curve calls: `initialize` (raydium-cp-swap@b3187ae5 instructions/initialize.rs), with the
//! SOL vault as `creator` (signer + payer) and a pair_curve PDA as the pool account (signer — CPMM's "random account" path).

use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};

use burn_receipts::constants::CPMM_PROGRAM_ID;

use crate::constants::CPMM_INITIALIZE_DISCRIMINATOR;

/// The accounts of `initialize`, in CPMM's order.
pub struct InitializeAccounts<'a, 'info> {
    pub creator: &'a AccountInfo<'info>,
    pub amm_config: &'a AccountInfo<'info>,
    pub authority: &'a AccountInfo<'info>,
    pub pool_state: &'a AccountInfo<'info>,
    pub token_0_mint: &'a AccountInfo<'info>,
    pub token_1_mint: &'a AccountInfo<'info>,
    pub lp_mint: &'a AccountInfo<'info>,
    pub creator_token_0: &'a AccountInfo<'info>,
    pub creator_token_1: &'a AccountInfo<'info>,
    pub creator_lp_token: &'a AccountInfo<'info>,
    pub token_0_vault: &'a AccountInfo<'info>,
    pub token_1_vault: &'a AccountInfo<'info>,
    pub create_pool_fee: &'a AccountInfo<'info>,
    pub observation_state: &'a AccountInfo<'info>,
    pub token_program: &'a AccountInfo<'info>,
    pub associated_token_program: &'a AccountInfo<'info>,
    pub system_program: &'a AccountInfo<'info>,
    pub rent: &'a AccountInfo<'info>,
}

pub fn initialize<'info>(a: InitializeAccounts<'_, 'info>, init_amount_0: u64, init_amount_1: u64, signer_seeds: &[&[&[u8]]]) -> Result<()> {
    let mut data = Vec::with_capacity(32);
    data.extend_from_slice(&CPMM_INITIALIZE_DISCRIMINATOR);
    data.extend_from_slice(&init_amount_0.to_le_bytes());
    data.extend_from_slice(&init_amount_1.to_le_bytes());
    data.extend_from_slice(&0u64.to_le_bytes()); // open_time: CPMM sets now + 1
    let ix = Instruction {
        program_id: CPMM_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(*a.creator.key, true),
            AccountMeta::new_readonly(*a.amm_config.key, false),
            AccountMeta::new_readonly(*a.authority.key, false),
            AccountMeta::new(*a.pool_state.key, true),
            AccountMeta::new_readonly(*a.token_0_mint.key, false),
            AccountMeta::new_readonly(*a.token_1_mint.key, false),
            AccountMeta::new(*a.lp_mint.key, false),
            AccountMeta::new(*a.creator_token_0.key, false),
            AccountMeta::new(*a.creator_token_1.key, false),
            AccountMeta::new(*a.creator_lp_token.key, false),
            AccountMeta::new(*a.token_0_vault.key, false),
            AccountMeta::new(*a.token_1_vault.key, false),
            AccountMeta::new(*a.create_pool_fee.key, false),
            AccountMeta::new(*a.observation_state.key, false),
            AccountMeta::new_readonly(*a.token_program.key, false),
            AccountMeta::new_readonly(*a.token_program.key, false),
            AccountMeta::new_readonly(*a.token_program.key, false),
            AccountMeta::new_readonly(*a.associated_token_program.key, false),
            AccountMeta::new_readonly(*a.system_program.key, false),
            AccountMeta::new_readonly(*a.rent.key, false),
        ],
        data,
    };
    anchor_lang::solana_program::program::invoke_signed(
        &ix,
        &[
            a.creator.clone(),
            a.amm_config.clone(),
            a.authority.clone(),
            a.pool_state.clone(),
            a.token_0_mint.clone(),
            a.token_1_mint.clone(),
            a.lp_mint.clone(),
            a.creator_token_0.clone(),
            a.creator_token_1.clone(),
            a.creator_lp_token.clone(),
            a.token_0_vault.clone(),
            a.token_1_vault.clone(),
            a.create_pool_fee.clone(),
            a.observation_state.clone(),
            a.token_program.clone(),
            a.associated_token_program.clone(),
            a.system_program.clone(),
            a.rent.clone(),
        ],
        signer_seeds,
    )
    .map_err(Into::into)
}
