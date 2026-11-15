use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, Mint, Token, TokenAccount};

use crate::constants::*;
use crate::error::BurnError;
use crate::events::ReadingProcessed;
use crate::instructions::crank_common::{memo_head, require_fixed_supply, require_next_in_line};
use crate::math;
use crate::memo;
use crate::state::{Reading, TokenConfig};

/// PERMISSIONLESS (VAULT MODE). Burns units × tokens_per_unit (+ any shortfall carried in, capped by the allocation) from the vault —
/// the config PDA's associated token account — capped at the vault balance; the rest is stored as a public shortfall and carried.
/// The memo (v1) is written by the program in the same instruction. The cranker chooses nothing but the date.
#[event_cpi]
#[derive(Accounts)]
#[instruction(record_date: u32)]
pub struct CrankVault<'info> {
    pub cranker: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED, config.mint.as_ref()], bump = config.bump)]
    pub config: Box<Account<'info, TokenConfig>>,
    #[account(mut, seeds = [READING_SEED, config.key().as_ref(), &record_date.to_le_bytes()], bump = reading.bump)]
    pub reading: Box<Account<'info, Reading>>,
    #[account(mut, address = config.mint, mint::token_program = token_program)]
    pub mint: Box<Account<'info, Mint>>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = config,
        associated_token::token_program = token_program
    )]
    pub vault: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
    /// CHECK: address-checked: the SPL Memo program.
    #[account(address = MEMO_PROGRAM_ID)]
    pub memo_program: UncheckedAccount<'info>,
}

pub fn handle_crank_vault(ctx: Context<CrankVault>, _record_date: u32) -> Result<()> {
    let c = &ctx.accounts.config;
    let r = &ctx.accounts.reading;
    require!(c.rule.mode == MODE_VAULT, BurnError::WrongMode);
    require_next_in_line(c, r)?;
    require!(r.units > 0, BurnError::NoUnits);
    require_fixed_supply(&ctx.accounts.mint)?;

    let planned = r.units.checked_mul(c.rule.tokens_per_unit).ok_or(BurnError::MathOverflow)?;
    let s = math::settle_vault(planned, c.shortfall, ctx.accounts.vault.amount, c.rule.vault_allocation, c.total_burned)
        .map_err(|_| BurnError::MathOverflow)?;

    if s.burn > 0 {
        let mint_key = c.mint;
        let seeds: &[&[u8]] = &[CONFIG_SEED, mint_key.as_ref(), &[c.bump]];
        token::burn(
            CpiContext::new_with_signer(
                token::ID,
                Burn {
                    mint: ctx.accounts.mint.to_account_info(),
                    from: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.config.to_account_info(),
                },
                &[seeds],
            ),
            s.burn,
        )?;
    }

    let outcome = if s.exhausted {
        OUTCOME_EXHAUSTED
    } else if s.shortfall > 0 {
        OUTCOME_SHORT
    } else {
        OUTCOME_BURNED
    };
    if !s.exhausted {
        let m = memo::format_v1(&memo_head(&ctx.accounts.config, &ctx.accounts.reading), s.burn, s.shortfall, ctx.accounts.mint.decimals);
        memo::emit_memo(&ctx.accounts.memo_program.to_account_info(), &m)?;
    }

    let now = Clock::get()?.unix_timestamp;
    let config_key = ctx.accounts.config.key();
    let r = &mut ctx.accounts.reading;
    r.processed = true;
    r.outcome = outcome;
    r.processed_at = now;
    r.owed = s.owed;
    r.burned = s.burn;
    r.shortfall = s.shortfall;
    let c = &mut ctx.accounts.config;
    c.crank_cursor = r.record_date;
    c.shortfall = s.shortfall;
    c.total_burned = c.total_burned.checked_add(s.burn).ok_or(BurnError::MathOverflow)?;
    if s.burn > 0 {
        c.burns = c.burns.checked_add(1).ok_or(BurnError::MathOverflow)?;
    }
    emit_cpi!(ReadingProcessed {
        config: config_key,
        record_date: r.record_date,
        units: r.units,
        outcome,
        pool_lamports: 0,
        spent_lamports: 0,
        got: 0,
        burned: s.burn,
        owed: s.owed,
        shortfall: s.shortfall,
        cranker: ctx.accounts.cranker.key(),
    });
    Ok(())
}
