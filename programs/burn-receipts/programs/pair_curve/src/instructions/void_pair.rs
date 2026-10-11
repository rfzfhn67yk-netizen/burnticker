use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::token::{self, Token};

use crate::constants::*;
use crate::error::PairError;
use crate::events::{PairClosed, PairVoided};
use crate::guards::{require_token_account_intact, require_vault_intact};
use crate::state::Pair;

/// PERMISSIONLESS. At or after the deadline, a pair that has not graduated becomes Voided: buys stay closed, sells stay open along
/// the same curves so every holder can exit to the SOL vault.
#[event_cpi]
#[derive(Accounts)]
pub struct VoidPair<'info> {
    pub caller: Signer<'info>,
    #[account(mut, seeds = [PAIR_SEED, pair.mints[0].as_ref(), pair.mints[1].as_ref()], bump = pair.bump)]
    pub pair: Box<Account<'info, Pair>>,
}

pub fn handle_void(ctx: Context<VoidPair>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let p = &mut ctx.accounts.pair;
    require!(p.status == STATUS_OPEN, PairError::NotOpen);
    require!(now >= p.deadline, PairError::DeadlineNotReached);
    p.status = STATUS_VOIDED;
    p.voided_at = now;
    let ev = PairVoided { pair: p.key(), caller: ctx.accounts.caller.key(), sol: p.sol, sold: p.sold };
    emit_cpi!(ev);
    Ok(())
}

/// PERMISSIONLESS, only when nothing is owed: Graduated (both token vaults empty), or Voided with every curve token sold back
/// (sold = 0 on both sides; the vaults' full supplies are burned here). Tokens sent to a graduated pair's vaults are burned as well. Residue above the SOL vault's rent minimum goes to the burn
/// pools; the token-vault accounts and the Pair are closed with their rent returned to the creator who paid it.
#[event_cpi]
#[derive(Accounts)]
pub struct ClosePair<'info> {
    pub caller: Signer<'info>,
    #[account(mut, close = creator, seeds = [PAIR_SEED, pair.mints[0].as_ref(), pair.mints[1].as_ref()], bump = pair.bump)]
    pub pair: Box<Account<'info, Pair>>,
    /// CHECK: the creator recorded at init (address) — receives the rent of the accounts closed here.
    #[account(mut, address = pair.creator @ PairError::AccountMismatch)]
    pub creator: UncheckedAccount<'info>,
    #[account(mut, address = pair.vault @ PairError::AccountMismatch)]
    pub vault: SystemAccount<'info>,
    /// CHECK: mint A (address); writable for the voided-pair burn.
    #[account(mut, address = pair.mints[0] @ PairError::AccountMismatch)]
    pub mint_a: UncheckedAccount<'info>,
    /// CHECK: mint B (address).
    #[account(mut, address = pair.mints[1] @ PairError::AccountMismatch)]
    pub mint_b: UncheckedAccount<'info>,
    /// CHECK: token vault A (address).
    #[account(mut, address = pair.token_vaults[0] @ PairError::AccountMismatch)]
    pub token_vault_a: UncheckedAccount<'info>,
    /// CHECK: token vault B (address).
    #[account(mut, address = pair.token_vaults[1] @ PairError::AccountMismatch)]
    pub token_vault_b: UncheckedAccount<'info>,
    #[account(mut, address = pair.fee_vaults[0] @ PairError::AccountMismatch)]
    pub fee_vault_a: SystemAccount<'info>,
    #[account(mut, address = pair.fee_vaults[1] @ PairError::AccountMismatch)]
    pub fee_vault_b: SystemAccount<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handle_close(ctx: Context<ClosePair>) -> Result<()> {
    let a = &ctx.accounts;
    let p = &a.pair;
    let status = p.status;
    match status {
        STATUS_GRADUATED => {}
        STATUS_VOIDED => require!(p.sold == [0, 0] && p.sol == [0, 0], PairError::NotClosable),
        _ => return err!(PairError::NotClosable),
    }
    let pair_key = p.key();
    let vault = a.vault.to_account_info();
    let seeds: &[&[u8]] = &[VAULT_SEED, pair_key.as_ref(), &[p.vault_bump]];
    let mut burned = [0u64; 2];
    for (i, (mint, tv)) in [(a.mint_a.to_account_info(), a.token_vault_a.to_account_info()), (a.mint_b.to_account_info(), a.token_vault_b.to_account_info())].into_iter().enumerate() {
        let left = require_token_account_intact(&tv, &vault.key(), &mint.key())?;
        if left > 0 {
            // A voided pair with every curve token back: the whole supply is burned. A graduated pair's vaults are empty unless someone
            // sent tokens to them afterwards — a donation, burned too (it cannot block the close).
            token::burn(CpiContext::new_with_signer(token::ID, token::Burn { mint: mint.clone(), from: tv.clone(), authority: vault.clone() }, &[seeds]), left)?;
            burned[i] = left;
        }
        token::close_account(CpiContext::new_with_signer(
            token::ID,
            token::CloseAccount { account: tv.clone(), destination: a.creator.to_account_info(), authority: vault.clone() },
            &[seeds],
        ))?;
    }
    let vault_rent = Rent::get()?.minimum_balance(0);
    require_vault_intact(&vault, vault_rent)?;
    let residue = vault.lamports() - vault_rent;
    let half = residue / 2;
    for (to, amount) in [(a.fee_vault_a.to_account_info(), half), (a.fee_vault_b.to_account_info(), residue - half)] {
        if amount > 0 {
            system_program::transfer(CpiContext::new_with_signer(system_program::ID, system_program::Transfer { from: vault.clone(), to }, &[seeds]), amount)?;
        }
    }
    let ev = PairClosed { pair: pair_key, caller: a.caller.key(), rent_to: a.creator.key(), status, tokens_burned: burned, residue_lamports: residue };
    emit_cpi!(ev);
    Ok(())
}
