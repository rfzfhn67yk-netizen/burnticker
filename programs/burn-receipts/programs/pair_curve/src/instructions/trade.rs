use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount};

use crate::commit::{read_amm, try_commit};
use crate::constants::*;
use crate::error::PairError;
use crate::events::{PairCommitted, Trade};
use crate::math::{quote_buy, quote_redeem, quote_sell, FeeSplit};
use crate::state::Pair;

/// buy(side, max_lamports_in, min_tokens_out) — PERMISSIONLESS, for the buyer's own wallet. Only while Open and before the deadline.
///
/// Every lamport goes to the SOL vault: the curve cost, and the 100 bps fee, which is ACCOUNTED there — 75 bps escrowed for the side's
/// burn pool (paid when its pool exists, refunded to its holders on a void), 25 bps accrued for the developer (claim_developer_fee).
/// No trade credits any other account, so no other account's state can block a trade (blind review 1 H-2, blind review 2 M-1).
/// A trade that leaves the pair ready commits it in the same instruction (commit.rs).
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
    /// CHECK: the pinned AmmConfig (address; owner and layout checked) — read for the commit rule (both sides must be able to pay).
    #[account(address = pair.cp_config @ PairError::InvalidAmmConfig)]
    pub amm_config: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

/// sell(side, amount, min_lamports_out) — PERMISSIONLESS, for the seller's own tokens.
///   Open (also past the deadline, before anyone voids): along the curve, 100 bps fee (accounted like a buy's).
///   Voided, or a refunding side: pro-rata redemption at the snapshot taken when redemption began — no fee, no race (the last holder
///   receives exactly what is left).
///   Never on a side whose pool exists or is committed to exist.
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
    /// CHECK: the pinned AmmConfig (address; owner and layout checked) — a curve sell can also leave the pair ready.
    #[account(address = pair.cp_config @ PairError::InvalidAmmConfig)]
    pub amm_config: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

fn accrue(p: &mut Pair, s: usize, fees: FeeSplit) {
    p.burn_escrow[s] = p.burn_escrow[s].saturating_add(fees.burn);
    p.dev_accrued = p.dev_accrued.saturating_add(fees.dev);
    p.burn_fees_lamports[s] = p.burn_fees_lamports[s].saturating_add(fees.burn);
    p.dev_fees_lamports[s] = p.dev_fees_lamports[s].saturating_add(fees.dev);
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
    system_program::transfer(
        CpiContext::new(system_program::ID, system_program::Transfer { from: a.buyer.to_account_info(), to: a.vault.to_account_info() }),
        q.total,
    )?;
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
    let amm = read_amm(&a.amm_config)?;
    let trader = a.buyer.key();
    let rent = Rent::get()?;
    let p = &mut ctx.accounts.pair;
    p.sold[s] = q.sold_after;
    p.sol[s] = q.sol_after;
    p.volume_lamports[s] = p.volume_lamports[s].saturating_add(q.cost);
    p.trades[s] = p.trades[s].saturating_add(1);
    accrue(p, s, q.fees);
    let committed = try_commit(p, now, &amm, &rent);
    let ev = Trade {
        pair: pair_key,
        side,
        is_buy: true,
        trader,
        tokens: q.tokens_out,
        curve_lamports: q.cost,
        fee: q.fees.fee,
        dev_fee: q.fees.dev,
        burn_fee: q.fees.burn,
        redemption: false,
        sold_after: q.sold_after,
        sol_after: q.sol_after,
        sol_total_after: p.total_sol(),
        status: p.status,
    };
    let raise = p.sol;
    emit_cpi!(ev);
    if committed {
        emit_cpi!(PairCommitted { pair: pair_key, by: trader, raise });
    }
    Ok(())
}

pub fn handle_sell(ctx: Context<Sell>, side: u8, amount: u64, min_lamports_out: u64) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let s = side as usize;
    let p = &ctx.accounts.pair;
    let redemption = p.redeeming(s);
    require!(p.status == STATUS_OPEN || redemption, PairError::SellsClosed);
    // (gross out of the side, fee legs, net to the seller, sold after, owed after)
    let (gross, fees, net, sold_after, sol_after) = if redemption {
        let payout = quote_redeem(p.redeem_pool[s], p.redeem_supply[s], p.sold[s], p.sol[s], amount)?;
        (payout, FeeSplit::default(), payout, p.sold[s] - amount, p.sol[s] - payout)
    } else {
        let q = quote_sell(&p.curve(), p.sold[s], amount)?;
        (q.gross, q.fees, q.net, q.sold_after, q.sol_after)
    };
    require!(net >= min_lamports_out, PairError::SlippageExceeded);

    let a = &ctx.accounts;
    token::transfer(
        CpiContext::new(token::ID, token::Transfer { from: a.seller_token.to_account_info(), to: a.token_vault.to_account_info(), authority: a.seller.to_account_info() }),
        amount,
    )?;
    let pair_key = a.pair.key();
    let seeds: &[&[u8]] = &[VAULT_SEED, pair_key.as_ref(), &[a.pair.vault_bump]];
    if net > 0 {
        system_program::transfer(
            CpiContext::new_with_signer(system_program::ID, system_program::Transfer { from: a.vault.to_account_info(), to: a.seller.to_account_info() }, &[seeds]),
            net,
        )?;
    }
    let amm = if redemption { None } else { Some(read_amm(&a.amm_config)?) };
    let trader = a.seller.key();
    let rent = Rent::get()?;
    let p = &mut ctx.accounts.pair;
    p.sold[s] = sold_after;
    p.sol[s] = sol_after;
    p.volume_lamports[s] = p.volume_lamports[s].saturating_add(gross);
    p.trades[s] = p.trades[s].saturating_add(1);
    accrue(p, s, fees);
    let committed = amm.map(|m| try_commit(p, now, &m, &rent)).unwrap_or(false);
    let ev = Trade {
        pair: pair_key,
        side,
        is_buy: false,
        trader,
        tokens: amount,
        curve_lamports: gross,
        fee: fees.fee,
        dev_fee: fees.dev,
        burn_fee: fees.burn,
        redemption,
        sold_after,
        sol_after,
        sol_total_after: p.total_sol(),
        status: p.status,
    };
    let raise = p.sol;
    emit_cpi!(ev);
    if committed {
        emit_cpi!(PairCommitted { pair: pair_key, by: trader, raise });
    }
    Ok(())
}
