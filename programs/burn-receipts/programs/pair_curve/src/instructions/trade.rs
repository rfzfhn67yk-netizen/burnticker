use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount};

use crate::constants::*;
use crate::error::PairError;
use crate::events::Trade;
use crate::math::{quote_buy, quote_sell, FeeSplit};
use crate::state::Pair;

/// buy(side, max_lamports_in, min_tokens_out) — PERMISSIONLESS, for the buyer's own wallet. Only while Open and before the deadline.
#[event_cpi]
#[derive(Accounts)]
#[instruction(side: u8)]
pub struct Buy<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    #[account(mut, constraint = side < 2 @ PairError::InvalidSide, seeds = [PAIR_SEED, pair.mints[0].as_ref(), pair.mints[1].as_ref()], bump = pair.bump)]
    pub pair: Box<Account<'info, Pair>>,
    #[account(mut, address = pair.vault @ PairError::AccountMismatch)]
    pub vault: SystemAccount<'info>,
    #[account(address = pair.mints[side as usize] @ PairError::AccountMismatch)]
    pub mint: Box<Account<'info, Mint>>,
    #[account(mut, address = pair.token_vaults[side as usize] @ PairError::AccountMismatch)]
    pub token_vault: Box<Account<'info, TokenAccount>>,
    #[account(init_if_needed, payer = buyer, associated_token::mint = mint, associated_token::authority = buyer)]
    pub buyer_token: Box<Account<'info, TokenAccount>>,
    /// The side's burn pool: the burn_receipts fee PDA ["fee", mint] recorded at init.
    #[account(mut, address = pair.fee_vaults[side as usize] @ PairError::AccountMismatch)]
    pub fee_vault: SystemAccount<'info>,
    /// CHECK: the developer wallet recorded at init (address-checked); only ever credited.
    #[account(mut, address = pair.dev_wallet @ PairError::AccountMismatch)]
    pub dev_wallet: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

/// sell(side, amount, min_lamports_out) — PERMISSIONLESS, for the seller's own tokens. While Open (also after the deadline) and after a
/// void; never once graduation has started (except the stuck-second-side rule, constants.rs GRADUATION_STUCK_SECS).
#[event_cpi]
#[derive(Accounts)]
#[instruction(side: u8)]
pub struct Sell<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,
    #[account(mut, constraint = side < 2 @ PairError::InvalidSide, seeds = [PAIR_SEED, pair.mints[0].as_ref(), pair.mints[1].as_ref()], bump = pair.bump)]
    pub pair: Box<Account<'info, Pair>>,
    #[account(mut, address = pair.vault @ PairError::AccountMismatch)]
    pub vault: SystemAccount<'info>,
    #[account(address = pair.mints[side as usize] @ PairError::AccountMismatch)]
    pub mint: Box<Account<'info, Mint>>,
    #[account(mut, address = pair.token_vaults[side as usize] @ PairError::AccountMismatch)]
    pub token_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = mint, token::authority = seller)]
    pub seller_token: Box<Account<'info, TokenAccount>>,
    #[account(mut, address = pair.fee_vaults[side as usize] @ PairError::AccountMismatch)]
    pub fee_vault: SystemAccount<'info>,
    /// CHECK: the developer wallet recorded at init (address-checked); only ever credited.
    #[account(mut, address = pair.dev_wallet @ PairError::AccountMismatch)]
    pub dev_wallet: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

/// The developer slice is paid only if the developer wallet can hold it (a System transfer that leaves an account with 1..rent-1
/// lamports fails); otherwise it goes to the burn pool, so the developer wallet can never block a trade — or an exit.
fn dev_can_receive(dev: &AccountInfo, amount: u64) -> Result<bool> {
    if amount == 0 {
        return Ok(true);
    }
    let after = dev.lamports().checked_add(amount).ok_or(PairError::MathOverflow)?;
    Ok(after >= Rent::get()?.minimum_balance(dev.data_len()))
}

fn pay<'info>(from: &AccountInfo<'info>, to: &AccountInfo<'info>, amount: u64, seeds: Option<&[&[u8]]>) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    let accs = system_program::Transfer { from: from.clone(), to: to.clone() };
    match seeds {
        Some(s) => system_program::transfer(CpiContext::new_with_signer(system_program::ID, accs, &[s]), amount),
        None => system_program::transfer(CpiContext::new(system_program::ID, accs), amount),
    }
}

pub fn handle_buy(ctx: Context<Buy>, side: u8, max_lamports_in: u64, min_tokens_out: u64) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let s = side as usize;
    let p = &ctx.accounts.pair;
    require!(p.status == STATUS_OPEN, PairError::NotOpen);
    require!(now < p.deadline, PairError::DeadlinePassed);
    let q = quote_buy(&p.curve(), p.sold[s], max_lamports_in)?;
    require!(q.tokens_out >= min_tokens_out, PairError::SlippageExceeded);

    let a = &ctx.accounts;
    let buyer = a.buyer.to_account_info();
    let redirected = !dev_can_receive(&a.dev_wallet, q.fees.dev)?;
    let fees = if redirected { FeeSplit { fee: q.fees.fee, dev: 0, burn: q.fees.fee } } else { q.fees };
    pay(&buyer, &a.vault.to_account_info(), q.cost, None)?;
    pay(&buyer, &a.dev_wallet.to_account_info(), fees.dev, None)?;
    pay(&buyer, &a.fee_vault.to_account_info(), fees.burn, None)?;

    let pair_key = a.pair.key();
    let seeds: &[&[u8]] = &[VAULT_SEED, pair_key.as_ref(), &[a.pair.vault_bump]];
    token::transfer(
        CpiContext::new_with_signer(
            token::ID,
            token::Transfer { from: a.token_vault.to_account_info(), to: a.buyer_token.to_account_info(), authority: a.vault.to_account_info() },
            &[seeds],
        ),
        q.tokens_out,
    )?;

    let trader = a.buyer.key();
    let p = &mut ctx.accounts.pair;
    p.sold[s] = q.sold_after;
    p.sol[s] = q.sol_after;
    p.volume_lamports[s] = p.volume_lamports[s].saturating_add(q.cost);
    p.burn_fees_lamports[s] = p.burn_fees_lamports[s].saturating_add(fees.burn);
    p.dev_fees_lamports[s] = p.dev_fees_lamports[s].saturating_add(fees.dev);
    p.trades[s] = p.trades[s].saturating_add(1);
    let ev = Trade {
        pair: pair_key,
        side,
        is_buy: true,
        trader,
        tokens: q.tokens_out,
        curve_lamports: q.cost,
        fee: fees.fee,
        dev_fee: fees.dev,
        burn_fee: fees.burn,
        dev_fee_redirected: redirected,
        sold_after: q.sold_after,
        sol_after: q.sol_after,
        sol_total_after: p.total_sol(),
        status: p.status,
    };
    emit_cpi!(ev);
    Ok(())
}

pub fn handle_sell(ctx: Context<Sell>, side: u8, amount: u64, min_lamports_out: u64) -> Result<()> {
    let s = side as usize;
    let p = &ctx.accounts.pair;
    // Open (also past the deadline, before anyone voids) and Voided; and — only if Raydium blocks the second side's pool for
    // GRADUATION_STUCK_SECS — the side whose pool does not exist yet, so its holders can always leave.
    let stuck = p.status == STATUS_GRADUATING
        && p.pools[s] == Pubkey::default()
        && Clock::get()?.unix_timestamp >= p.graduation_started_at.saturating_add(GRADUATION_STUCK_SECS);
    require!(p.status == STATUS_OPEN || p.status == STATUS_VOIDED || stuck, PairError::SellsClosed);
    let q = quote_sell(&p.curve(), p.sold[s], amount)?;
    require!(q.net >= min_lamports_out, PairError::SlippageExceeded);

    let a = &ctx.accounts;
    token::transfer(
        CpiContext::new(token::ID, token::Transfer { from: a.seller_token.to_account_info(), to: a.token_vault.to_account_info(), authority: a.seller.to_account_info() }),
        amount,
    )?;
    let redirected = !dev_can_receive(&a.dev_wallet, q.fees.dev)?;
    let fees = if redirected { FeeSplit { fee: q.fees.fee, dev: 0, burn: q.fees.fee } } else { q.fees };
    let pair_key = a.pair.key();
    let seeds: &[&[u8]] = &[VAULT_SEED, pair_key.as_ref(), &[a.pair.vault_bump]];
    let vault = a.vault.to_account_info();
    pay(&vault, &a.seller.to_account_info(), q.net, Some(seeds))?;
    pay(&vault, &a.dev_wallet.to_account_info(), fees.dev, Some(seeds))?;
    pay(&vault, &a.fee_vault.to_account_info(), fees.burn, Some(seeds))?;

    let trader = a.seller.key();
    let p = &mut ctx.accounts.pair;
    p.sold[s] = q.sold_after;
    p.sol[s] = q.sol_after;
    p.volume_lamports[s] = p.volume_lamports[s].saturating_add(q.gross);
    p.burn_fees_lamports[s] = p.burn_fees_lamports[s].saturating_add(fees.burn);
    p.dev_fees_lamports[s] = p.dev_fees_lamports[s].saturating_add(fees.dev);
    p.trades[s] = p.trades[s].saturating_add(1);
    let ev = Trade {
        pair: pair_key,
        side,
        is_buy: false,
        trader,
        tokens: amount,
        curve_lamports: q.gross,
        fee: fees.fee,
        dev_fee: fees.dev,
        burn_fee: fees.burn,
        dev_fee_redirected: redirected,
        sold_after: q.sold_after,
        sol_after: q.sol_after,
        sol_total_after: p.total_sol(),
        status: p.status,
    };
    emit_cpi!(ev);
    Ok(())
}
