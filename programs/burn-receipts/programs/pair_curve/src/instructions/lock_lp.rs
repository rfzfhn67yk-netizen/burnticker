use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::solana_program::program::invoke_signed;
use anchor_spl::associated_token::{get_associated_token_address, AssociatedToken};
use anchor_spl::token::{self, Token};

use burn_receipts::constants::{FEE_KEYS_SEED, LOCKED_LIQUIDITY_DISCRIMINATOR, LOCKED_LIQUIDITY_SEED, LOCK_CPMM_AUTHORITY, LOCK_CPMM_PROGRAM_ID};
use burn_receipts::cpmm::PoolView;

use crate::constants::*;
use crate::error::PairError;
use crate::events::LpLocked;
use crate::guards::{mint_supply, require_token_account_intact, require_vault_intact, token_amount};
use crate::state::Pair;

/// PERMISSIONLESS, once per side, after `graduate` created the side's pool (LAUNCHPAD-PATH §35: graduation LP is locked forever, never
/// burned). CPIs Raydium's CPMM lock program `lock_cp_liquidity` for ALL of the vault's LP: the LP moves into the lock authority's
/// account for good, and the position's Fee Key NFT — mint = the pair_curve PDA ["fee_nft", pair, [side]] — is minted to burn_receipts'
/// FEE_KEYS PDA, so burn_receipts' `claim_lock_fees` collects this pool's LP fees exactly as it does for a LaunchLab coin (80 % to the
/// side's burn pool, 20 % to the operator treasury, the coin side burned). The cranker pays the rents the lock program creates (the
/// NFT mint, FEE_KEYS's NFT account, the lock state, the lock's LP account the first time); the emptied LP account's rent goes to the
/// side's burn pool. The SOL vault signs only as the LP's owner and must keep every lamport.
/// burn_receipts' register_pair_pool refuses the pool until this has run (it requires the recorded LP locked).
#[event_cpi]
#[derive(Accounts)]
#[instruction(side: u8)]
pub struct LockLp<'info> {
    #[account(mut)]
    pub cranker: Signer<'info>,
    #[account(mut, constraint = side < 2 @ PairError::InvalidSide, seeds = [PAIR_SEED, pair.mints[0].as_ref(), pair.mints[1].as_ref()], bump = pair.bump)]
    pub pair: Box<Account<'info, Pair>>,
    #[account(mut, address = pair.vault @ PairError::AccountMismatch)]
    pub vault: SystemAccount<'info>,
    /// CHECK: the side's pool (address = pair.pools[side]); parsed by PoolView.
    #[account(address = pair.pools[side as usize] @ PairError::NothingToLock)]
    pub pool_state: UncheckedAccount<'info>,
    /// CHECK: the pool's LP mint (checked against the pool).
    pub lp_mint: UncheckedAccount<'info>,
    /// CHECK: ATA(vault, lp_mint) — checked in the handler; emptied and closed here.
    #[account(mut)]
    pub vault_lp: UncheckedAccount<'info>,
    /// CHECK: the side's burn pool (address recorded at init) — receives the emptied LP account's rent.
    #[account(mut, address = pair.fee_vaults[side as usize] @ PairError::AccountMismatch)]
    pub fee_vault: UncheckedAccount<'info>,
    /// CHECK: the Fee Key NFT mint: the pair_curve PDA ["fee_nft", pair, [side]] (seeds-checked); created by the lock program.
    #[account(mut, seeds = [FEE_NFT_SEED, pair.key().as_ref(), &[side]], bump)]
    pub fee_nft_mint: UncheckedAccount<'info>,
    /// CHECK: ATA(FEE_KEYS, fee_nft_mint) — address-checked in the handler; created by the lock program.
    #[account(mut)]
    pub fee_nft_account: UncheckedAccount<'info>,
    /// CHECK: burn_receipts' FEE_KEYS PDA (address-checked in the handler).
    pub fee_keys: UncheckedAccount<'info>,
    /// CHECK: the lock program's state PDA ["locked_liquidity", fee_nft_mint] (address-checked in the handler).
    #[account(mut)]
    pub locked_liquidity: UncheckedAccount<'info>,
    /// CHECK: ATA(LOCK_CPMM_AUTHORITY, lp_mint) — address-checked in the handler.
    #[account(mut)]
    pub lock_lp_vault: UncheckedAccount<'info>,
    /// CHECK: the pool's token 0 vault (checked against the pool).
    #[account(mut)]
    pub token_0_vault: UncheckedAccount<'info>,
    /// CHECK: the pool's token 1 vault (checked against the pool).
    #[account(mut)]
    pub token_1_vault: UncheckedAccount<'info>,
    /// CHECK: the Metaplex metadata PDA of the NFT mint (address-checked; not created — with_metadata = false).
    #[account(mut)]
    pub metadata_account: UncheckedAccount<'info>,
    /// CHECK: address-checked: Raydium's CPMM lock program.
    #[account(address = LOCK_CPMM_PROGRAM_ID)]
    pub lock_program: UncheckedAccount<'info>,
    /// CHECK: address-checked: the lock program's authority PDA.
    #[account(address = LOCK_CPMM_AUTHORITY)]
    pub lock_authority: UncheckedAccount<'info>,
    /// CHECK: address-checked: Metaplex Token Metadata.
    #[account(address = METADATA_PROGRAM_ID)]
    pub metadata_program: UncheckedAccount<'info>,
    pub rent: Sysvar<'info, Rent>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

pub fn handle_lock_lp(ctx: Context<LockLp>, side: u8) -> Result<()> {
    let s = side as usize;
    let a = &ctx.accounts;
    let p = &a.pair;
    require!(p.pools[s] != Pubkey::default() && p.lp_locked[s] == 0, PairError::NothingToLock);
    let pool = PoolView::load(&a.pool_state.to_account_info())?;
    require_keys_eq!(a.lp_mint.key(), pool.lp_mint, PairError::PoolMismatch);
    require!(a.token_0_vault.key() == pool.token_0_vault && a.token_1_vault.key() == pool.token_1_vault, PairError::PoolMismatch);
    let vault = a.vault.to_account_info();
    require_keys_eq!(a.vault_lp.key(), get_associated_token_address(&vault.key(), &pool.lp_mint), PairError::AccountMismatch);
    let lp = require_token_account_intact(&a.vault_lp.to_account_info(), &vault.key(), &pool.lp_mint)?;
    require!(lp > 0, PairError::NothingToLock);
    let (fee_keys, _) = Pubkey::find_program_address(&[FEE_KEYS_SEED], &burn_receipts::ID);
    require_keys_eq!(a.fee_keys.key(), fee_keys, PairError::AccountMismatch);
    let nft_mint = a.fee_nft_mint.key();
    require_keys_eq!(a.fee_nft_account.key(), get_associated_token_address(&fee_keys, &nft_mint), PairError::AccountMismatch);
    let (locked_pda, _) = Pubkey::find_program_address(&[LOCKED_LIQUIDITY_SEED, nft_mint.as_ref()], &LOCK_CPMM_PROGRAM_ID);
    require_keys_eq!(a.locked_liquidity.key(), locked_pda, PairError::AccountMismatch);
    let lock_vault_key = get_associated_token_address(&LOCK_CPMM_AUTHORITY, &pool.lp_mint);
    require_keys_eq!(a.lock_lp_vault.key(), lock_vault_key, PairError::AccountMismatch);
    let (metadata, _) = Pubkey::find_program_address(&[b"metadata", METADATA_PROGRAM_ID.as_ref(), nft_mint.as_ref()], &METADATA_PROGRAM_ID);
    require_keys_eq!(a.metadata_account.key(), metadata, PairError::AccountMismatch);
    let locked_before = if a.lock_lp_vault.owner == &token::ID { token_amount(&a.lock_lp_vault.to_account_info())? } else { 0 };

    let pair_key = p.key();
    let vault_seeds: &[&[u8]] = &[VAULT_SEED, pair_key.as_ref(), &[p.vault_bump]];
    let side_byte = [side];
    let nft_bump = [ctx.bumps.fee_nft_mint];
    let nft_seeds: &[&[u8]] = &[FEE_NFT_SEED, pair_key.as_ref(), &side_byte, &nft_bump];
    let vault_lamports = vault.lamports();

    // lock_cp_liquidity(lp_amount, with_metadata = false), accounts in the lock program's order (SDK cpmmLockPositionInstruction).
    let mut data = LOCK_CP_LIQUIDITY_DISCRIMINATOR.to_vec();
    data.extend_from_slice(&lp.to_le_bytes());
    data.push(0);
    let metas = vec![
        AccountMeta::new_readonly(LOCK_CPMM_AUTHORITY, false),
        AccountMeta::new(a.cranker.key(), true),
        AccountMeta::new_readonly(vault.key(), true),
        AccountMeta::new_readonly(fee_keys, false),
        AccountMeta::new(nft_mint, true),
        AccountMeta::new(a.fee_nft_account.key(), false),
        AccountMeta::new_readonly(a.pool_state.key(), false),
        AccountMeta::new(a.locked_liquidity.key(), false),
        AccountMeta::new_readonly(pool.lp_mint, false),
        AccountMeta::new(a.vault_lp.key(), false),
        AccountMeta::new(lock_vault_key, false),
        AccountMeta::new(pool.token_0_vault, false),
        AccountMeta::new(pool.token_1_vault, false),
        AccountMeta::new(metadata, false),
        AccountMeta::new_readonly(a.rent.key(), false),
        AccountMeta::new_readonly(a.system_program.key(), false),
        AccountMeta::new_readonly(token::ID, false),
        AccountMeta::new_readonly(anchor_spl::associated_token::ID, false),
        AccountMeta::new_readonly(METADATA_PROGRAM_ID, false),
    ];
    let infos = [
        a.lock_authority.to_account_info(),
        a.cranker.to_account_info(),
        vault.clone(),
        a.fee_keys.to_account_info(),
        a.fee_nft_mint.to_account_info(),
        a.fee_nft_account.to_account_info(),
        a.pool_state.to_account_info(),
        a.locked_liquidity.to_account_info(),
        a.lp_mint.to_account_info(),
        a.vault_lp.to_account_info(),
        a.lock_lp_vault.to_account_info(),
        a.token_0_vault.to_account_info(),
        a.token_1_vault.to_account_info(),
        a.metadata_account.to_account_info(),
        a.rent.to_account_info(),
        a.system_program.to_account_info(),
        a.token_program.to_account_info(),
        a.associated_token_program.to_account_info(),
        a.metadata_program.to_account_info(),
        a.lock_program.to_account_info(),
    ];
    invoke_signed(&Instruction { program_id: LOCK_CPMM_PROGRAM_ID, accounts: metas, data }, &infos, &[vault_seeds, nft_seeds])?;

    // ---- post-CPI: the vault kept every lamport and is still the System account; all LP moved into the lock; the Fee Key is
    // FEE_KEYS's; the lock state names this pool and NFT ----
    require_vault_intact(&vault, vault_lamports)?;
    require!(require_token_account_intact(&a.vault_lp.to_account_info(), &vault.key(), &pool.lp_mint)? == 0, PairError::LockMismatch);
    require!(token_amount(&a.lock_lp_vault.to_account_info())? == locked_before.checked_add(lp).ok_or(PairError::MathOverflow)?, PairError::LockMismatch);
    require!(require_token_account_intact(&a.fee_nft_account.to_account_info(), &fee_keys, &nft_mint)? == 1 && mint_supply(&a.fee_nft_mint.to_account_info())? == 1, PairError::LockMismatch);
    {
        let l = &a.locked_liquidity;
        require!(l.owner == &LOCK_CPMM_PROGRAM_ID, PairError::LockMismatch);
        let d = l.try_borrow_data()?;
        require!(d.len() >= 192 && d[..8] == LOCKED_LIQUIDITY_DISCRIMINATOR, PairError::LockMismatch);
        require!(d[64..96] == a.pool_state.key().to_bytes()[..] && d[96..128] == nft_mint.to_bytes()[..], PairError::LockMismatch);
    }
    // The emptied LP account's rent belongs to the side (CPMM charged it to the raise): to its burn pool.
    token::close_account(CpiContext::new_with_signer(
        token::ID,
        token::CloseAccount { account: a.vault_lp.to_account_info(), destination: a.fee_vault.to_account_info(), authority: vault.clone() },
        &[vault_seeds],
    ))?;

    let (pool_key, cranker, fee_nft_account, locked_liquidity) = (a.pool_state.key(), a.cranker.key(), a.fee_nft_account.key(), a.locked_liquidity.key());
    ctx.accounts.pair.lp_locked[s] = lp;
    emit_cpi!(LpLocked { pair: pair_key, side, cranker, pool: pool_key, lp_amount: lp, fee_nft_mint: nft_mint, fee_nft_account, locked_liquidity });
    Ok(())
}
