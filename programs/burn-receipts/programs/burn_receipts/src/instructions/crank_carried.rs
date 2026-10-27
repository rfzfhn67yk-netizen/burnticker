use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::token::{self, Burn, Mint, SyncNative, Token, TokenAccount};

use crate::constants::*;
use crate::cpmm::{self, AmmConfigView, PoolView, SwapAccounts};
use crate::error::BurnError;
use crate::events::CarriedSpent;
use crate::guards::{require_fee_pda_intact, require_fee_token_account_intact};
use crate::instructions::crank_common::require_fixed_supply;
use crate::instructions::pool_health::clear_untradeable;
use crate::math;
use crate::memo;
use crate::instructions::pair::create_pda;
use crate::state::{carried_pace_address, CarriedPace, TokenConfig};

/// PERMISSIONLESS (BUYBACK MODE, burn dispersal 2026-10-13). Spends the SOL the rule already owes from earlier cranks
/// (`carried_spend_lamports`, review H-1: spend carried under the floor or past an untradeable pool, and any carry left from before the
/// per-crank bound was removed) WITHOUT a new reading:
///   spend = min(carried_spend_lamports, max_spend_lamports, the spendable pool)
///   max_spend_lamports must be > 0. Owner decision 2026-10-25: there is no per-crank bound (it was 2 % of the pool's WSOL reserve)
///   and no carried budget any more, so one call may spend the whole carried amount. SpendAboveCap is never raised again.
///   The swap is crank_buyback's: same registered + verified pool, same TWAP guard (mandatory), same min-out (the larger of the
///   spot and TWAP quotes less fee and slippage), same post-swap integrity checks; then EVERY token the fee PDA holds is burned and
///   a `carried` memo is written: <prefix>|carried|through=<YYYYMMDD>|spent=…|got=…|burn=…|left=<lamports>|swap=<12>|rules=sha256:<12>|v1
///
/// THE QUEUE RULE (why this can never let anyone skip a reading's own crank): crank_carried is refused (ReadingPending) while ANY
/// submitted reading is unprocessed, i.e. unless crank_cursor == last_record_date. A reading's crank therefore always runs first and
/// always sees the full carried amount in its own target, exactly as before this instruction existed; crank_carried only ever drains
/// what is left once the queue is empty. It never touches a Reading account, never moves crank_cursor, never changes readings/burns
/// ordering. The `through=` date is the crank cursor: the last processed reading whose carried spend this piece drains.
/// It is also refused:
///   · when nothing is carried (NothingCarried), or the piece would be under the rule's floor while more than that stays carried
///     (BelowFloor — the last piece of a remainder may be under the floor so a remainder never sticks);
///   · for a coin with a burn target (BurnTargetSet: its fuel only buys the target, through crank_target_burn);
///   · round-5 review R5-3 / R5-4: NOT refused after an end any more. After a VOID end the coin's wind-down cranks it as before, and
///     the carry it leaves would otherwise have no spender. After a RESOLVED end the carry is owed by readings inside the window (no
///     later reading can exist); forward_on_end / burn_sol_on_end leave it in place for 30 days after the end (end::carry_held_back)
///     so this instruction drains it first, then take whatever is left and zero it. (RuleNotLive stays in the error list, unused.)
///   · while the pool is untradeable / empty (PoolNotTradable / EmptyReserves: no 30-day unblock path here, nothing is owed by date);
///   · round-5 review R5-8: a second piece for the coin in the same second (CarriedTooSoon: two in one transaction are refused).
///     CarriedPace ["carried_pace", mint] (created by the first piece, the cranker paying its rent) records the time and counts the
///     pieces: a carried piece does not add to TokenConfig.burns (that counts reading cranks); the memo carries `piece=<n>`. Its budget
///     field is unused since 2026-10-25 (written 0).
/// Draining the carried amount between readings also means the next reading's basis no longer includes lamports that were already
/// owed (the same basis the pair forward uses since r3 RI-4) — the rule's own fraction is applied to fuel that is not yet promised.
#[event_cpi]
#[derive(Accounts)]
pub struct CrankCarried<'info> {
    /// Pays the CarriedPace rent on the coin's first piece (round-5 review R5-8).
    #[account(mut)]
    pub cranker: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED, config.mint.as_ref()], bump = config.bump)]
    pub config: Box<Account<'info, TokenConfig>>,
    /// CHECK: the platform PDA (seeds-checked), as in crank_buyback.
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
    /// CHECK: must be the registered pool; parsed and validated by cpmm::PoolView.
    #[account(mut, address = config.cpmm_pool @ BurnError::PoolNotRegistered)]
    pub pool_state: UncheckedAccount<'info>,
    /// CHECK: must equal the pool's amm_config; owner + discriminator checked by cpmm::AmmConfigView.
    pub amm_config: UncheckedAccount<'info>,
    /// CHECK: Raydium's vault-and-LP authority PDA; the CPMM program verifies its seeds itself.
    pub cpmm_authority: UncheckedAccount<'info>,
    /// CHECK: the pool's WSOL vault — key-checked against the pool.
    #[account(mut)]
    pub wsol_vault: UncheckedAccount<'info>,
    /// CHECK: the pool's token vault — key-checked against the pool.
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
    /// CHECK: round-5 review R5-8: the coin's CarriedPace ["carried_pace", mint] (address-checked in the handler); created here on the
    /// coin's first piece, then owner + discriminator checked by Anchor's deserializer.
    #[account(mut)]
    pub carried_pace: UncheckedAccount<'info>,
}

/// Round-5 review R5-8: CarriedPace field offsets (Anchor's 8-byte discriminator, then the struct's Borsh layout; state.rs). Read and
/// written at fixed offsets rather than through Borsh to keep the binary small (the round-5 program data has little room left).
const PACE_AT: usize = 8 + 1 + 1 + 32; // last_carried_at: i64
const PIECES_AT: usize = PACE_AT + 8; // pieces: u32
const SPENT_AT: usize = PIECES_AT + 4; // spent_lamports: u64
const BUDGET_AT: usize = SPENT_AT + 8; // budget_lamports: u64
const PACE_VERSION: u8 = 1;

/// The coin's pace (last_carried_at, pieces, spent_lamports, budget_lamports), creating the account on its first piece (an address
/// someone pre-funded is topped up and taken over: create_pda). A version other than PACE_VERSION is refused.
fn load_pace<'info>(acc: &AccountInfo<'info>, payer: &AccountInfo<'info>, system: &AccountInfo<'info>, mint: &Pubkey) -> Result<(i64, u32, u64, u64)> {
    let (addr, bump) = carried_pace_address(mint);
    require!(*acc.key == addr, BurnError::InvalidCarriedPace);
    if acc.owner == &crate::ID && !acc.data_is_empty() {
        let d = acc.try_borrow_data()?;
        require!(d.len() >= BUDGET_AT + 8 && d[..8] == CarriedPace::DISCRIMINATOR[..] && d[8] == PACE_VERSION && d[10..42] == mint.to_bytes()[..], BurnError::InvalidCarriedPace);
        let u = |at: usize| u64::from_le_bytes(d[at..at + 8].try_into().unwrap());
        return Ok((u(PACE_AT) as i64, u32::from_le_bytes(d[PIECES_AT..PIECES_AT + 4].try_into().unwrap()), u(SPENT_AT), u(BUDGET_AT)));
    }
    create_pda(payer, acc, system, 8 + CarriedPace::INIT_SPACE, &[CARRIED_PACE_SEED, mint.as_ref(), &[bump]])?;
    let mut d = acc.try_borrow_mut_data()?;
    d[..8].copy_from_slice(CarriedPace::DISCRIMINATOR);
    d[8] = PACE_VERSION;
    d[9] = bump;
    d[10..42].copy_from_slice(mint.as_ref());
    Ok((0, 0, 0, 0))
}

/// Round-5 review R5-8: at most one piece per coin per second (two in one transaction are refused). A coin that never ran a piece may.
pub fn piece_allowed_now(last_carried_at: i64, now: i64) -> bool {
    last_carried_at == 0 || now > last_carried_at
}

fn vault_amount(acc: &AccountInfo) -> Result<u64> {
    use anchor_lang::solana_program::program_pack::Pack;
    require_keys_eq!(*acc.owner, token::ID, BurnError::InvalidCpmmAccount);
    let d = acc.try_borrow_data()?;
    Ok(anchor_spl::token::spl_token::state::Account::unpack(&d).map_err(|_| BurnError::InvalidCpmmAccount)?.amount)
}

/// The queue rule: no submitted reading is waiting for its own crank.
pub fn queue_empty(c: &TokenConfig) -> bool {
    !c.has_baseline || c.crank_cursor == c.last_record_date
}

pub fn handle_crank_carried(ctx: Context<CrankCarried>, max_spend_lamports: u64) -> Result<()> {
    let (rule, mint_key, fee_bump, pool_key, carried_in, through) = {
        let c = &ctx.accounts.config;
        require!(c.rule.mode == MODE_BUYBACK, BurnError::WrongMode);
        require!(c.burn_target_kind == BURN_TARGET_SELF, BurnError::BurnTargetSet);
        require!(c.cpmm_pool != Pubkey::default(), BurnError::PoolNotRegistered);
        require!(c.pool_verified, BurnError::PoolNotVerified);
        require!(queue_empty(c), BurnError::ReadingPending);
        require!(c.carried_spend_lamports > 0, BurnError::NothingCarried);
        require!(max_spend_lamports > 0, BurnError::NothingCarried);
        (c.rule, c.mint, c.fee_bump, c.cpmm_pool, c.carried_spend_lamports, c.crank_cursor)
    };
    require_fixed_supply(&ctx.accounts.mint)?;
    let fee_seeds: &[&[u8]] = &[FEE_SEED, mint_key.as_ref(), &[fee_bump]];
    let now = Clock::get()?.unix_timestamp;
    // Round-5 review R5-8: the coin's pace record (one piece per second).
    let (last_at, pieces, pace_spent, _unused_budget) = load_pace(
        &ctx.accounts.carried_pace.to_account_info(),
        &ctx.accounts.cranker.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
        &mint_key,
    )?;

    // The synced WSOL balance (review-2 F3), as crank_buyback.
    let wsol_reserve: Option<u64> = ctx.accounts.fee_wsol.is_native.into();
    let wsol_reserve = wsol_reserve.ok_or(BurnError::InvalidCpmmAccount)?;
    let wsol_balance = ctx.accounts.fee_wsol.to_account_info().lamports().checked_sub(wsol_reserve).ok_or(BurnError::MathOverflow)?;
    let wsol_unsynced = wsol_balance != ctx.accounts.fee_wsol.amount;
    let pool_actual = math::spendable_pool(ctx.accounts.fee_vault.lamports(), rule.reserve_lamports, wsol_balance).map_err(|_| BurnError::MathOverflow)?;
    let pool_before = pool_actual;

    // ----- the pool: tradeable now, or refuse -----
    let pool = PoolView::try_load(&ctx.accounts.pool_state.to_account_info()).ok_or(BurnError::PoolNotTradable)?;
    require!(pool.swaps_enabled(now), BurnError::PoolNotTradable);
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

    // Owner decision 2026-10-25: no per-crank bound on the request.
    let spend = carried_in.min(max_spend_lamports).min(pool_before);
    require!(spend > 0, BurnError::NothingCarried);
    // A piece under the floor only when it is the whole remainder (a remainder never sticks under the floor).
    require!(spend >= rule.floor_lamports || spend == carried_in, BurnError::BelowFloor);
    require!(piece_allowed_now(last_at, now), BurnError::CarriedTooSoon);

    // TWAP guard (mandatory, review H-1) and min-out (review-2 F1), exactly as crank_buyback.
    let spot = math::sol_price_x32(r_wsol, r_tok).map_err(|_| BurnError::EmptyReserves)?;
    let twap = cpmm::twap_sol_price_x32(&ctx.accounts.observation_state.to_account_info(), wsol0, rule.twap_window_secs, now, spot)?.ok_or(BurnError::TwapUnavailable)?;
    require!(math::twap_ok(spot, twap, rule.max_twap_deviation_bps).map_err(|_| BurnError::MathOverflow)?, BurnError::TwapDeviation);
    let amm = AmmConfigView::load(&ctx.accounts.amm_config.to_account_info())?;
    let fee_ppm = amm.trade_fee_rate.checked_add(if pool.enable_creator_fee { amm.creator_fee_rate } else { 0 }).ok_or(BurnError::MathOverflow)?;
    let min_out = math::buyback_min_out(spend, r_wsol, r_tok, twap, fee_ppm, rule.slippage_bps).map_err(|_| BurnError::MathOverflow)?;
    require!(min_out > 0, BurnError::ZeroOutput);
    let spot_out = math::min_amount_out(spend, r_wsol, r_tok, fee_ppm, 0).map_err(|_| BurnError::MathOverflow)?;
    require!(spot_out >= min_out, BurnError::TwapDeviation);

    let tokens_before = ctx.accounts.fee_tokens.amount;
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
    {
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
    }
    // Review-3 M-1: nothing about the fee PDA or its accounts changed beyond the intended balances.
    {
        let a = &ctx.accounts;
        let fee = a.fee_vault.key();
        require_fee_pda_intact(&a.fee_vault.to_account_info(), lamports_before_swap)?;
        require_fee_token_account_intact(&a.fee_wsol.to_account_info(), &fee, &NATIVE_MINT, false)?;
        require_fee_token_account_intact(&a.fee_tokens.to_account_info(), &fee, &mint_key, false)?;
    }
    ctx.accounts.fee_tokens.reload()?;
    ctx.accounts.fee_wsol.reload()?;
    require!(
        ctx.accounts.fee_wsol.amount.checked_add(spend) == Some(wsol_balance.checked_add(from_lamports).ok_or(BurnError::MathOverflow)?),
        BurnError::WsolBalanceMismatch
    );
    let got = ctx.accounts.fee_tokens.amount.checked_sub(tokens_before).ok_or(BurnError::MathOverflow)?;
    require!(got >= min_out, BurnError::ZeroOutput);
    require!(token_vault_before.checked_sub(vault_amount(&ctx.accounts.token_vault)?) == Some(got), BurnError::SwapOutputMismatch);

    // ----- burn everything the fee PDA holds in the token -----
    let burn_amount = ctx.accounts.fee_tokens.amount;
    if burn_amount > 0 {
        token::burn(
            CpiContext::new_with_signer(
                token::ID,
                Burn { mint: ctx.accounts.mint.to_account_info(), from: ctx.accounts.fee_tokens.to_account_info(), authority: ctx.accounts.fee_vault.to_account_info() },
                &[fee_seeds],
            ),
            burn_amount,
        )?;
    }
    let carried_out = carried_in - spend;
    let piece = pieces.checked_add(1).ok_or(BurnError::MathOverflow)?;
    {
        let acc = ctx.accounts.carried_pace.to_account_info();
        let mut d = acc.try_borrow_mut_data()?;
        d[PACE_AT..PACE_AT + 8].copy_from_slice(&now.to_le_bytes());
        d[PIECES_AT..PIECES_AT + 4].copy_from_slice(&piece.to_le_bytes());
        d[SPENT_AT..SPENT_AT + 8].copy_from_slice(&pace_spent.saturating_add(spend).to_le_bytes());
        d[BUDGET_AT..BUDGET_AT + 8].copy_from_slice(&0u64.to_le_bytes());
    }
    let m = memo::format_carried(
        ctx.accounts.config.memo_prefix_str(),
        through,
        spend,
        got,
        burn_amount,
        carried_out,
        piece,
        &memo::swap_ref(&pool_key),
        &ctx.accounts.config.rules_sha256,
        ctx.accounts.mint.decimals,
    );
    memo::emit_memo(&ctx.accounts.memo_program.to_account_info(), &m)?;

    let config_key = ctx.accounts.config.key();
    let c = &mut ctx.accounts.config;
    c.total_burned = c.total_burned.checked_add(burn_amount).ok_or(BurnError::MathOverflow)?;
    c.total_spent_lamports = c.total_spent_lamports.checked_add(spend).ok_or(BurnError::MathOverflow)?;
    // Round-5 review R5-8: carried pieces are counted in CarriedPace.pieces, not in `burns` (reading cranks only).
    c.carried_spend_lamports = carried_out;
    if clear_untradeable(c) {
        emit_cpi!(crate::events::PoolUntradeableCleared { config: config_key, pool: pool_key });
    }
    emit_cpi!(CarriedSpent {
        config: config_key,
        through_date: through,
        max_spend_lamports,
        // Unused since 2026-10-25 (the per-crank bound and the carried budget are gone); kept so the event decodes unchanged.
        reserve_cap_lamports: 0,
        carried_in_lamports: carried_in,
        spent_lamports: spend,
        got,
        burned: burn_amount,
        carried_out_lamports: carried_out,
        cranker: ctx.accounts.cranker.key(),
        piece,
        budget_left_lamports: 0,
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// R5-8: the fixed offsets crank_carried reads and writes match CarriedPace's Borsh layout.
    #[test]
    fn pace_offsets_match_the_carried_pace_layout() {
        let p = CarriedPace { version: 1, bump: 254, mint: Pubkey::new_from_array([0x44; 32]), last_carried_at: -2, pieces: 7, spent_lamports: 9, budget_lamports: 11, reserved: [0; 24] };
        let mut d = Vec::new();
        p.try_serialize(&mut d).unwrap();
        assert_eq!(d.len(), 8 + CarriedPace::INIT_SPACE);
        assert_eq!(d.len(), 94);
        assert_eq!((&d[..8], d[8], d[9], &d[10..42]), (CarriedPace::DISCRIMINATOR, PACE_VERSION, 254, &[0x44u8; 32][..]));
        assert_eq!(i64::from_le_bytes(d[PACE_AT..PACE_AT + 8].try_into().unwrap()), -2);
        assert_eq!(u32::from_le_bytes(d[PIECES_AT..PIECES_AT + 4].try_into().unwrap()), 7);
        assert_eq!(u64::from_le_bytes(d[SPENT_AT..SPENT_AT + 8].try_into().unwrap()), 9);
        assert_eq!(u64::from_le_bytes(d[BUDGET_AT..BUDGET_AT + 8].try_into().unwrap()), 11);
    }

    /// R5-8 (budget removed 2026-10-25): the first piece may run; later pieces in a later second only.
    #[test]
    fn one_piece_per_second() {
        assert!(piece_allowed_now(0, 5));
        assert!(!piece_allowed_now(100, 100));
        assert!(!piece_allowed_now(100, 99));
        assert!(piece_allowed_now(100, 101));
    }
}
