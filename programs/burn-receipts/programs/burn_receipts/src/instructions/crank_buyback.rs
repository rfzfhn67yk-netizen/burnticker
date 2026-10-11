use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::token::{self, Burn, Mint, SyncNative, Token, TokenAccount};

use crate::constants::*;
use crate::cpmm::{self, AmmConfigView, PoolView, SwapAccounts};
use crate::error::BurnError;
use crate::guards::{require_fee_pda_intact, require_fee_token_account_intact};
use crate::events::{BurnPoolCapBound, BuybackQueueUnblocked, PoolUntradeableCleared, PoolUntradeableFlagged, ReadingProcessed, SpendCapBound, SpendCarried};
use crate::instructions::crank_common::{active_cap, crankers_in_force, memo_head, require_fixed_supply, require_next_in_line};
use crate::instructions::pool_health::{clear_untradeable, continuous_untradeable_secs, observe_untradeable, UNTRADEABLE_POOL_ACCOUNT, UNTRADEABLE_RESERVE, UNTRADEABLE_SWAPS_DISABLED};

/// SpendCarried.reason: the spend was under the floor (or the reserve cap pushed it there) / the 2 % cap bound a partial spend /
/// the pool has been untradeable for QUEUE_UNBLOCK_SECS (review-2 F7).
pub const CARRY_REASON_BELOW_FLOOR: u8 = 0;

/// The amount of a pool vault (an SPL Token account; key equality with the pool's vault is checked by the caller).
fn vault_amount(acc: &AccountInfo) -> Result<u64> {
    use anchor_lang::solana_program::program_pack::Pack;
    require_keys_eq!(*acc.owner, token::ID, BurnError::InvalidCpmmAccount);
    let d = acc.try_borrow_data()?;
    Ok(anchor_spl::token::spl_token::state::Account::unpack(&d).map_err(|_| BurnError::InvalidCpmmAccount)?.amount)
}
pub const CARRY_REASON_RESERVE_CAP: u8 = 1;
pub const CARRY_REASON_POOL_UNTRADEABLE: u8 = 2;
use crate::math;
use crate::memo;
use crate::state::{Reading, TokenConfig};

/// PERMISSIONLESS (BUYBACK MODE, primary). For the next burn day in line:
///   pool  = fee PDA lamports − reserve + WSOL already in the fee PDA's WSOL account, capped at the platform's burn-pool cap while
///           that pre-audit cap is in force (the excess stays in the fee PDA; BurnPoolCapBound is emitted)
///   spend = pool × (1 − (1 − f)^units)                                  (math::buyback_spend)
///           + spend carried from earlier capped cranks, capped at 2 % of the pool's WSOL reserve and at the platform basis;
///           the remainder is carried to the next crank (SpendCapBound)
///   if spend ≥ floor: wrap `spend` → swap WSOL → token on the registered Raydium CPMM pool (swap_base_input; min-out = the larger of
///   the spot-reserve and TWAP-price quotes less fee and slippage; TWAP guard against a same-block push), then burn EVERY token the
///   fee PDA holds (what the swap delivered plus any creator-fee tokens already there), and write memo v2 — all in this one
///   instruction. The fee PDA's WSOL account is synced first (review-2 F3). After 30 days of continuous pool untradeability the
///   reading is processed below-floor with its target carried, so the queue cannot wedge (review-2 F7).
/// The cranker passes accounts and a date; every amount is computed here. Lamports leave the fee PDA only into its own WSOL
/// account, and WSOL leaves that account only into the CPMM pool vault in exchange for tokens that are then burned.
#[event_cpi]
#[derive(Accounts)]
#[instruction(record_date: u32)]
pub struct CrankBuyback<'info> {
    pub cranker: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED, config.mint.as_ref()], bump = config.bump)]
    pub config: Box<Account<'info, TokenConfig>>,
    #[account(mut, seeds = [READING_SEED, config.key().as_ref(), &record_date.to_le_bytes()], bump = reading.bump)]
    pub reading: Box<Account<'info, Reading>>,
    /// CHECK: the platform PDA (seeds-checked). If a PlatformConfig lives there its cap rules; if it was never created the
    /// hard-coded default applies (review M-1) — so this account can never be missing in a way that wedges buybacks.
    #[account(seeds = [PLATFORM_SEED], bump)]
    pub platform: UncheckedAccount<'info>,
    #[account(mut, address = config.mint, mint::token_program = token_program)]
    pub mint: Box<Account<'info, Mint>>,
    #[account(mut, seeds = [FEE_SEED, config.mint.as_ref()], bump = config.fee_bump)]
    pub fee_vault: SystemAccount<'info>,
    #[account(
        mut,
        associated_token::mint = wsol_mint,
        associated_token::authority = fee_vault,
        associated_token::token_program = token_program
    )]
    pub fee_wsol: Box<Account<'info, TokenAccount>>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = fee_vault,
        associated_token::token_program = token_program
    )]
    pub fee_tokens: Box<Account<'info, TokenAccount>>,
    #[account(address = NATIVE_MINT)]
    pub wsol_mint: Box<Account<'info, Mint>>,
    /// CHECK: must be the registered pool; parsed and validated by cpmm::PoolView (owner, discriminator, mints).
    #[account(mut, address = config.cpmm_pool @ BurnError::PoolNotRegistered)]
    pub pool_state: UncheckedAccount<'info>,
    /// CHECK: must equal the pool's amm_config; owner + discriminator checked by cpmm::AmmConfigView.
    pub amm_config: UncheckedAccount<'info>,
    /// CHECK: Raydium's vault-and-LP authority PDA; the CPMM program verifies its seeds itself.
    pub cpmm_authority: UncheckedAccount<'info>,
    /// CHECK: the pool's WSOL vault — key-checked against the pool and read as an SPL Token account when the pool
    /// is readable; any account when the pool account is gone (review-3 L-5: a crank can then be built from the config alone).
    #[account(mut)]
    pub wsol_vault: UncheckedAccount<'info>,
    /// CHECK: the pool's token vault — key-checked against the pool and read as an SPL Token account when the pool
    /// is readable; any account when the pool account is gone (review-3 L-5: a crank can then be built from the config alone).
    #[account(mut)]
    pub token_vault: UncheckedAccount<'info>,
    /// CHECK: must equal the pool's observation_key; owner + discriminator checked by cpmm::twap_sol_price_x32.
    #[account(mut)]
    pub observation_state: UncheckedAccount<'info>,
    /// CHECK: address-checked: the Raydium CPMM program.
    #[account(address = CPMM_PROGRAM_ID)]
    pub cpmm_program: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    /// CHECK: address-checked: the SPL Memo program.
    #[account(address = MEMO_PROGRAM_ID)]
    pub memo_program: UncheckedAccount<'info>,
    /// CHECK: LAUNCHPAD-PATH §40, paired coins only: this coin's PairLink ["pair_link", mint] (address-checked in pair::crank_pair_gate).
    pub pair_link: Option<UncheckedAccount<'info>>,
    /// CHECK: paired coins only: the period's PairResult ["pair_result", mint_lo, mint_hi, record_date] (address-checked; may be
    /// empty: then the crank waits PAIR_RESULT_GRACE_SECS after the reading).
    pub pair_result: Option<UncheckedAccount<'info>>,
}

pub fn handle_crank_buyback(ctx: Context<CrankBuyback>, _record_date: u32) -> Result<()> {
    let (rule, mint_key, fee_bump, pool_key) = {
        let c = &ctx.accounts.config;
        require!(c.rule.mode == MODE_BUYBACK, BurnError::WrongMode);
        require!(c.cpmm_pool != Pubkey::default(), BurnError::PoolNotRegistered);
        // Review-2 F5/F14: only a pool that passed register_pool's provenance checks (fixed pools included) is ever traded on.
        require!(c.pool_verified, BurnError::PoolNotVerified);
        require_next_in_line(c, &ctx.accounts.reading)?;
        require!(ctx.accounts.reading.units > 0, BurnError::NoUnits);
        (c.rule, c.mint, c.fee_bump, c.cpmm_pool)
    };
    let units = ctx.accounts.reading.units;
    require_fixed_supply(&ctx.accounts.mint)?;
    // LAUNCHPAD-PATH §40: a paired coin that LOST this period's result does not burn — forward_to_winner moves its fuel.
    let pair_gate = crate::instructions::pair::crank_pair_gate(
        &ctx.accounts.config,
        &ctx.accounts.reading,
        ctx.accounts.pair_link.as_ref().map(|a| a.as_ref()),
        ctx.accounts.pair_result.as_ref().map(|a| a.as_ref()),
        Clock::get()?.unix_timestamp,
    )?;
    let fee_seeds: &[&[u8]] = &[FEE_SEED, mint_key.as_ref(), &[fee_bump]];

    // Review-2 F3: anyone can send lamports straight to the fee PDA's WSOL account without a SyncNative. Every amount below is
    // measured on the SYNCED balance — lamports − the account's rent-exempt reserve, exactly what SyncNative would set — and the
    // account is synced before the swap whenever the stored amount lags (or lamports are wrapped), so the post-swap check holds.
    let wsol_reserve: Option<u64> = ctx.accounts.fee_wsol.is_native.into();
    let wsol_reserve = wsol_reserve.ok_or(BurnError::InvalidCpmmAccount)?;
    let wsol_balance = ctx.accounts.fee_wsol.to_account_info().lamports().checked_sub(wsol_reserve).ok_or(BurnError::MathOverflow)?;
    let wsol_unsynced = wsol_balance != ctx.accounts.fee_wsol.amount;

    // ----- the rule -----
    let now = Clock::get()?.unix_timestamp;
    // Review-3 L-4: while the pre-audit cap is in force a PlatformConfig may restrict who cranks (≤ 3 keys); permissionless otherwise.
    let crankers = crankers_in_force(&ctx.accounts.platform.to_account_info(), now)?;
    require!(crankers.is_empty() || crankers.contains(&ctx.accounts.cranker.key()), BurnError::CrankerNotAllowed);
    let pool_actual = math::spendable_pool(ctx.accounts.fee_vault.lamports(), rule.reserve_lamports, wsol_balance).map_err(|_| BurnError::MathOverflow)?;
    // The platform's pre-audit cap: while in force, the rule applies to min(pool, cap); the excess simply stays in the fee PDA.
    let cap = active_cap(&ctx.accounts.platform.to_account_info(), now)?;
    let pool_before = match cap {
        Some(c) if pool_actual > c => c,
        _ => pool_actual,
    };
    let cap_bound = pool_before < pool_actual;
    let rule_spend = math::buyback_spend(pool_before, units, rule.fraction_per_unit_bps).map_err(|_| BurnError::MathOverflow)?;
    // Review H-1: spend carried from earlier capped cranks joins this crank's target (never more than the pool holds).
    let carried_in = ctx.accounts.config.carried_spend_lamports;
    let target = rule_spend.saturating_add(carried_in).min(pool_actual);
    let tokens_before = ctx.accounts.fee_tokens.amount;
    let mut reserve_cap = 0u64;
    let mut carry_reason = CARRY_REASON_BELOW_FLOOR;
    let mut unblocked_since: Option<i64> = None;
    let mut unblocked_reason = UNTRADEABLE_SWAPS_DISABLED;

    let (spent, got, outcome, swap_ref, carried_out) = if target == 0 || target < rule.floor_lamports {
        // Nothing worth buying: the day's own spend is dropped (the pool keeps it), carried spend stays owed.
        (0u64, 0u64, OUTCOME_BELOW_FLOOR, String::from("none"), carried_in.min(pool_actual))
    } else {
        // ----- the pool: tradeable, or (review-2 F7) continuously untradeable long enough to stop waiting for it -----
        let blocked: Option<(BurnError, u8)> = match PoolView::try_load(&ctx.accounts.pool_state.to_account_info()) {
            None => Some((BurnError::PoolNotTradable, UNTRADEABLE_POOL_ACCOUNT)),
            Some(p) if !p.swaps_enabled(now) => Some((BurnError::PoolNotTradable, UNTRADEABLE_SWAPS_DISABLED)),
            Some(p) => {
                let wsol0 = p.wsol_is_token_0(&NATIVE_MINT, &mint_key).ok_or(BurnError::InvalidPoolMints)?;
                let (wsol_vault_key, token_vault_key, wsol_fees, token_fees) =
                    if wsol0 { (p.token_0_vault, p.token_1_vault, p.fees_0, p.fees_1) } else { (p.token_1_vault, p.token_0_vault, p.fees_1, p.fees_0) };
                require_keys_eq!(ctx.accounts.wsol_vault.key(), wsol_vault_key, BurnError::InvalidCpmmAccount);
                require_keys_eq!(ctx.accounts.token_vault.key(), token_vault_key, BurnError::InvalidCpmmAccount);
                let empty = vault_amount(&ctx.accounts.wsol_vault)? <= wsol_fees || vault_amount(&ctx.accounts.token_vault)? <= token_fees;
                if empty { Some((BurnError::EmptyReserves, UNTRADEABLE_RESERVE)) } else { None }
            }
        };
        if let Some((why, reason)) = blocked {
            if continuous_untradeable_secs(&ctx.accounts.config, now) < QUEUE_UNBLOCK_SECS {
                // Not now (the keeper records the observation with check_pool_health and retries).
                return Err(why.into());
            }
            // 30 days of continuous untradeability: process the reading as below-floor and carry its whole target, so the queue
            // advances; nothing is spent. The pool stays registered (replace_pool remains the way to a new one).
            carry_reason = CARRY_REASON_POOL_UNTRADEABLE;
            unblocked_since = Some(ctx.accounts.config.pool_untradeable_since);
            unblocked_reason = reason;
            (0u64, 0u64, OUTCOME_BELOW_FLOOR, String::from("none"), target)
        } else {
            let pool = PoolView::load(&ctx.accounts.pool_state.to_account_info())?;
            let wsol0 = pool.wsol_is_token_0(&NATIVE_MINT, &mint_key).ok_or(BurnError::InvalidPoolMints)?;
            require!(pool.token_0_program == token::ID && pool.token_1_program == token::ID, BurnError::InvalidPoolMints);
            let (wsol_vault_key, token_vault_key, wsol_fees, token_fees) =
                if wsol0 { (pool.token_0_vault, pool.token_1_vault, pool.fees_0, pool.fees_1) } else { (pool.token_1_vault, pool.token_0_vault, pool.fees_1, pool.fees_0) };
            require_keys_eq!(ctx.accounts.wsol_vault.key(), wsol_vault_key, BurnError::InvalidCpmmAccount);
            require_keys_eq!(ctx.accounts.token_vault.key(), token_vault_key, BurnError::InvalidCpmmAccount);
            require_keys_eq!(ctx.accounts.amm_config.key(), pool.amm_config, BurnError::InvalidCpmmAccount);
            require_keys_eq!(ctx.accounts.observation_state.key(), pool.observation_key, BurnError::InvalidCpmmAccount);
            let r_wsol = vault_amount(&ctx.accounts.wsol_vault)?.checked_sub(wsol_fees).ok_or(BurnError::EmptyReserves)?;
            let r_tok = vault_amount(&ctx.accounts.token_vault)?.checked_sub(token_fees).ok_or(BurnError::EmptyReserves)?;
            require!(r_wsol > 0 && r_tok > 0, BurnError::EmptyReserves);

            // Review H-1: the TWAP guard is mandatory (validated at init: ≤ 3 % over 600–1,200 s).
            let spot = math::sol_price_x32(r_wsol, r_tok).map_err(|_| BurnError::EmptyReserves)?;
            let twap = cpmm::twap_sol_price_x32(&ctx.accounts.observation_state.to_account_info(), wsol0, rule.twap_window_secs, now, spot)?
                .ok_or(BurnError::TwapUnavailable)?;
            require!(math::twap_ok(spot, twap, rule.max_twap_deviation_bps).map_err(|_| BurnError::MathOverflow)?, BurnError::TwapDeviation);

            // Review H-1: one crank spends at most 2 % of the pool's WSOL reserve (price impact < ~4 %), and never more than the
            // platform basis; the rest of the target is carried to the next crank.
            reserve_cap = math::reserve_spend_cap(r_wsol, MAX_SPEND_RESERVE_BPS);
            let spend = target.min(reserve_cap).min(pool_before);
            let cfg = AmmConfigView::load(&ctx.accounts.amm_config.to_account_info())?;
            let fee_ppm = cfg.trade_fee_rate.checked_add(if pool.enable_creator_fee { cfg.creator_fee_rate } else { 0 }).ok_or(BurnError::MathOverflow)?;
            // Review-2 F1: the minimum output is the larger of the spot-reserve quote and the TWAP-price quote (both less the fee and
            // slippage_bps), so a same-transaction push of the spot price can extract at most slippage_bps from the swap.
            let min_out = if spend == 0 || spend < rule.floor_lamports {
                0
            } else {
                math::buyback_min_out(spend, r_wsol, r_tok, twap, fee_ppm, rule.slippage_bps).map_err(|_| BurnError::MathOverflow)?
            };
            // Review-2 F7: a spend too small to buy a single raw token is below-floor too (never a ZeroOutput revert).
            if spend == 0 || spend < rule.floor_lamports || min_out == 0 {
                (0u64, 0u64, OUTCOME_BELOW_FLOOR, String::from("none"), target)
            } else {
                // The spot pool must be able to deliver the TWAP quote; if it cannot, the price was just pushed (or moved faster than
                // the TWAP): crank later rather than buy below the oracle's price.
                let spot_out = math::min_amount_out(spend, r_wsol, r_tok, fee_ppm, 0).map_err(|_| BurnError::MathOverflow)?;
                require!(spot_out >= min_out, BurnError::TwapDeviation);

                // Wrap what the WSOL account does not already hold, then sync (also folding in any stray lamports: review-2 F3).
                let from_lamports = spend.saturating_sub(wsol_balance);
                if from_lamports > 0 {
                    system_program::transfer(
                        CpiContext::new_with_signer(
                            system_program::ID,
                            system_program::Transfer { from: ctx.accounts.fee_vault.to_account_info(), to: ctx.accounts.fee_wsol.to_account_info() },
                            &[fee_seeds],
                        ),
                        from_lamports,
                    )?;
                }
                if from_lamports > 0 || wsol_unsynced {
                    token::sync_native(CpiContext::new(token::ID, SyncNative { account: ctx.accounts.fee_wsol.to_account_info() }))?;
                }
                require!(ctx.accounts.fee_vault.lamports() >= rule.reserve_lamports, BurnError::ReserveBreached);
                let lamports_before_swap = ctx.accounts.fee_vault.lamports();
                let token_vault_before = vault_amount(&ctx.accounts.token_vault)?;

                let a = &ctx.accounts;
                cpmm::swap_base_input(
                    SwapAccounts {
                        payer: &a.fee_vault.to_account_info(),
                        authority: &a.cpmm_authority.to_account_info(),
                        amm_config: &a.amm_config.to_account_info(),
                        pool_state: &a.pool_state.to_account_info(),
                        input_token_account: &a.fee_wsol.to_account_info(),
                        output_token_account: &a.fee_tokens.to_account_info(),
                        input_vault: &a.wsol_vault.to_account_info(),
                        output_vault: &a.token_vault.to_account_info(),
                        input_token_program: &a.token_program.to_account_info(),
                        output_token_program: &a.token_program.to_account_info(),
                        input_token_mint: &a.wsol_mint.to_account_info(),
                        output_token_mint: &a.mint.to_account_info(),
                        observation_state: &a.observation_state.to_account_info(),
                    },
                    spend,
                    min_out,
                    &[fee_seeds],
                )?;
                // Review-3 M-1: the swap lent the fee PDA's signature to CPMM — nothing about the fee PDA or its accounts may change
                // beyond the intended balances.
                {
                    let a = &ctx.accounts;
                    let fee = a.fee_vault.key();
                    require_fee_pda_intact(&a.fee_vault.to_account_info(), lamports_before_swap)?;
                    require_fee_token_account_intact(&a.fee_wsol.to_account_info(), &fee, &NATIVE_MINT, false)?;
                    require_fee_token_account_intact(&a.fee_tokens.to_account_info(), &fee, &mint_key, false)?;
                }
                ctx.accounts.fee_tokens.reload()?;
                ctx.accounts.fee_wsol.reload()?;
                let wsol_after = ctx.accounts.fee_wsol.amount;
                // Exactly `spend` WSOL left the (synced) account and nothing else moved it.
                require!(
                    wsol_after.checked_add(spend) == Some(wsol_balance.checked_add(from_lamports).ok_or(BurnError::MathOverflow)?),
                    BurnError::WsolBalanceMismatch
                );
                let got = ctx.accounts.fee_tokens.amount.checked_sub(tokens_before).ok_or(BurnError::MathOverflow)?;
                require!(got >= min_out, BurnError::ZeroOutput);
                // ... and the pool's output vault paid exactly what the fee PDA received (review-3 M-1).
                require!(token_vault_before.checked_sub(vault_amount(&ctx.accounts.token_vault)?) == Some(got), BurnError::SwapOutputMismatch);
                carry_reason = CARRY_REASON_RESERVE_CAP;
                (spend, got, OUTCOME_BURNED, memo::swap_ref(&pool_key), target - spend)
            }
        }
    };

    // ----- burn everything the fee PDA holds in the token -----
    let burn_amount = ctx.accounts.fee_tokens.amount;
    if burn_amount > 0 {
        token::burn(
            CpiContext::new_with_signer(
                token::ID,
                Burn {
                    mint: ctx.accounts.mint.to_account_info(),
                    from: ctx.accounts.fee_tokens.to_account_info(),
                    authority: ctx.accounts.fee_vault.to_account_info(),
                },
                &[fee_seeds],
            ),
            burn_amount,
        )?;
    }

    let m = memo::format_v2(
        &memo_head(&ctx.accounts.config, &ctx.accounts.reading),
        pool_before,
        spent,
        got,
        burn_amount,
        &swap_ref,
        ctx.accounts.mint.decimals,
    );
    memo::emit_memo(&ctx.accounts.memo_program.to_account_info(), &m)?;

    let config_key = ctx.accounts.config.key();
    let r = &mut ctx.accounts.reading;
    r.processed = true;
    r.outcome = outcome;
    r.processed_at = now;
    r.pool_lamports = pool_before;
    r.pool_actual_lamports = pool_actual;
    r.rule_spend_lamports = rule_spend;
    r.carried_in_lamports = carried_in;
    r.carried_out_lamports = carried_out;
    r.spent_lamports = spent;
    r.got = got;
    r.burned = burn_amount;
    r.pool = pool_key;
    let c = &mut ctx.accounts.config;
    c.crank_cursor = r.record_date;
    c.total_burned = c.total_burned.checked_add(burn_amount).ok_or(BurnError::MathOverflow)?;
    c.total_spent_lamports = c.total_spent_lamports.checked_add(spent).ok_or(BurnError::MathOverflow)?;
    if burn_amount > 0 {
        c.burns = c.burns.checked_add(1).ok_or(BurnError::MathOverflow)?;
    }
    c.carried_spend_lamports = carried_out;
    // A successful swap proves the pool tradeable (review M-4): any pending untradeable observation is cleared.
    let cleared = outcome == OUTCOME_BURNED && clear_untradeable(c);
    if cleared {
        emit_cpi!(PoolUntradeableCleared { config: config_key, pool: pool_key });
    }
    // Review-2 F7: the crank itself observed the pool untradeable (it is the observation that unblocked the queue).
    if let Some(prev_since) = unblocked_since {
        let (since, restarted, candidate_at) = observe_untradeable(c, now);
        emit_cpi!(PoolUntradeableFlagged { config: config_key, pool: pool_key, since, observed_at: now, restarted, reason: unblocked_reason, candidate_at });
        emit_cpi!(BuybackQueueUnblocked { config: config_key, record_date: r.record_date, untradeable_since: prev_since, carried_out_lamports: carried_out });
    }
    // Review-2 F15: a carry with nothing spent gets its own event (SpendCapBound below covers a partial spend).
    if spent == 0 && carried_out > 0 {
        emit_cpi!(SpendCarried {
            config: config_key,
            record_date: r.record_date,
            target_lamports: target,
            carried_in_lamports: carried_in,
            carried_out_lamports: carried_out,
            reason: carry_reason,
        });
    }
    if spent > 0 && spent < target {
        emit_cpi!(SpendCapBound {
            config: config_key,
            record_date: r.record_date,
            target_lamports: target,
            spent_lamports: spent,
            reserve_cap_lamports: reserve_cap,
            carried_out_lamports: carried_out,
        });
    }
    if cap_bound {
        emit_cpi!(BurnPoolCapBound {
            config: config_key,
            record_date: r.record_date,
            pool_actual_lamports: pool_actual,
            cap_lamports: cap.unwrap_or(0),
            spent_lamports: spent,
        });
    }
    match pair_gate {
        crate::instructions::pair::PairGate::ResultMissing => emit_cpi!(crate::events::PairResultMissing { mint: mint_key, record_date: r.record_date }),
        crate::instructions::pair::PairGate::ForwardMissing => emit_cpi!(crate::events::PairForwardMissing { mint: mint_key, record_date: r.record_date }),
        crate::instructions::pair::PairGate::Proceed => {}
    }
    emit_cpi!(ReadingProcessed {
        config: config_key,
        record_date: r.record_date,
        units,
        outcome,
        pool_lamports: pool_before,
        spent_lamports: spent,
        got,
        burned: burn_amount,
        owed: 0,
        shortfall: 0,
        cranker: ctx.accounts.cranker.key(),
    });
    Ok(())
}
