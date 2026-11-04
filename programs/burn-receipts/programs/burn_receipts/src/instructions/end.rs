//! LAUNCHPAD-PATH §45 (owner decision 2026-10-11) — END-OF-RULE FUEL GOES TO A SINK, NOT A SELF-BURN.
//!
//! A coin burns only on its results inside its window. When its rule ENDS RESOLVED (season over; one-shot resolved YES or NO), the
//! fuel left in its fee PDA — and any fee trickle that arrives later — is FORWARDED, as a burn, to its end sink's fee PDA, where the
//! sink coin's ordinary cranks buy and burn the sink coin. When the rule ends VOID (market voided, no award, cancelled season) nothing
//! changes: the coin's hashed 28-day self-burn wind-down applies, as for every coin before §45.
//!
//!   EndSink ["end_sink", mint]   pinned by initialize_token (optional account; never changed). sink_kind:
//!       FLAGSHIP     BURNTICKER_FLAGSHIP ($DEFICIT, compiled per cluster; perpetual)
//!       MINT         a named coin — while it is live (a verified pool, or a pinned burn target (R5-9); its own rule not ended), else
//!                    the flagship
//!       LEAGUE_SET   reserved for league sets (initialize_token refuses it until they land)
//!       INCINERATOR  Solana's incinerator (INCINERATOR_ID): the SOL itself is burned (burn_sol_on_end), no swap, no price impact
//!       PAIR_WINNER  the coin's pair partner — only when the period of the end date (RuleEnd.record_date) has a PairResult naming the
//!                    partner as winner and the partner is live and still paired; otherwise the flagship. (During the contest the
//!                    loser's fuel already moves by forward_to_winner; this is the remainder after the end.)
//!   RuleEnd ["rule_end", mint]   submit_rule_end: a quorum of the coin's attesters signs BURNRECEIPTS-END-v1 (attest.rs
//!                                canonical_end_message) — date and outcome resolved | void. Only a coin with an EndSink can end;
//!                                coins launched before §45 keep their hashed wind-down.
//!   forward_on_end               permissionless, after a RESOLVED end once every reading inside the window is processed:
//!                                spendable SOL above the reserve + synced WSOL → the destination fee PDA
//!                                (SOL first, then WSOL); refused under the EndSink's minimum. Callable again whenever the trickle
//!                                passes the minimum. Memo `<PREFIX>|endfwd|to=<12>|lamports=N|v1`.
//! After a RESOLVED end no reading dated later than the end can be submitted (submit_reading → RuleEnded) and crank_buyback refuses
//! one (ForwardOnEndRequired) — the result reading that ended the rule (dated on or before the end) cranks normally.

use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::associated_token::{self, get_associated_token_address, AssociatedToken};
use anchor_spl::token::{self, Token};

use crate::attest::{attested_mask, canonical_end_message};
use crate::constants::*;
use crate::error::BurnError;
use crate::events::{EndSinkPinned, ForwardedOnEnd, RuleEnded, SolBurnedOnEnd};
use crate::guards::require_fee_token_account_intact;
use crate::instructions::pair::{create_pda, read_link, wsol_synced_or_zero};
use crate::math;
use crate::memo;
use crate::state::{end_sink_address, pair_link_address, pair_result_address, EndSink, PairResult, RuleEnd, TokenConfig};

// ---------------------------------------------------------------------------------------------------------------------------------
// initialize_token: pin the end sink
// ---------------------------------------------------------------------------------------------------------------------------------

/// What initialize_token passes to pin_end_sink.
pub struct EndSinkArgs {
    pub kind: u8,
    pub sink_mint: Option<Pubkey>,
    pub min_forward_lamports: u64,
}

/// Validates and writes the coin's EndSink (initialize_token, `end_sink` account present). `pair_mint` = the partner named at init
/// (policies 0/1), if any.
#[allow(clippy::too_many_arguments)]
pub fn pin_end_sink<'info>(
    payer: &AccountInfo<'info>,
    acc: &AccountInfo<'info>,
    system: &AccountInfo<'info>,
    mint: &Pubkey,
    mode: u8,
    pool_policy: u8,
    pair_mint: Option<Pubkey>,
    a: &EndSinkArgs,
    now: i64,
) -> Result<EndSinkPinned> {
    require!(BURNTICKER_FLAGSHIP != Pubkey::default(), BurnError::FlagshipNotPinned);
    require!(mode == MODE_BUYBACK && *mint != BURNTICKER_FLAGSHIP, BurnError::InvalidEndSink);
    require!((END_FORWARD_MIN_LAMPORTS_FLOOR..=END_FORWARD_MIN_LAMPORTS_CEIL).contains(&a.min_forward_lamports), BurnError::InvalidEndSink);
    let sink_mint = match a.kind {
        END_SINK_FLAGSHIP => {
            require!(a.sink_mint.is_none() || a.sink_mint == Some(BURNTICKER_FLAGSHIP), BurnError::InvalidEndSink);
            BURNTICKER_FLAGSHIP
        }
        END_SINK_MINT => {
            let s = a.sink_mint.ok_or(BurnError::InvalidEndSink)?;
            require!(s != Pubkey::default() && s != *mint, BurnError::InvalidEndSink);
            s
        }
        END_SINK_PAIR_WINNER => {
            // None = the partner named in this instruction (a LaunchLab pair), so the create need not repeat 32 bytes
            let s = a.sink_mint.or(pair_mint).ok_or(BurnError::InvalidEndSink)?;
            require!(s != Pubkey::default() && s != *mint, BurnError::InvalidEndSink);
            match pair_mint {
                // a LaunchLab pair names its partner at init: the sink is that partner
                Some(pm) => require_keys_eq!(pm, s, BurnError::InvalidEndSink),
                // otherwise only a pair_curve coin (paired later by link_pair) may name a partner
                None => require!(pool_policy == POOL_POLICY_PAIR_CURVE, BurnError::InvalidEndSink),
            }
            s
        }
        END_SINK_INCINERATOR => {
            // the SOL itself: no coin is named; the stored "sink mint" is the incinerator address, the only destination allowed
            require!(a.sink_mint.is_none() || a.sink_mint == Some(INCINERATOR_ID), BurnError::InvalidEndSink);
            INCINERATOR_ID
        }
        // END_SINK_LEAGUE_SET: league sets are a later round
        _ => return err!(BurnError::InvalidEndSink),
    };
    let (addr, bump) = end_sink_address(mint);
    require_keys_eq!(*acc.key, addr, BurnError::InvalidEndSink);
    create_pda(payer, acc, system, 8 + EndSink::INIT_SPACE, &[END_SINK_SEED, mint.as_ref(), &[bump]])?;
    let s = EndSink { version: 1, bump, mint: *mint, sink_kind: a.kind, sink_mint, min_forward_lamports: a.min_forward_lamports, created_at: now, reserved: [0u8; 32] };
    let mut data = acc.try_borrow_mut_data()?;
    let mut w: &mut [u8] = &mut data;
    s.try_serialize(&mut w)?;
    Ok(EndSinkPinned { mint: *mint, sink_kind: a.kind, sink_mint, min_forward_lamports: a.min_forward_lamports })
}

// ---------------------------------------------------------------------------------------------------------------------------------
// submit_rule_end
// ---------------------------------------------------------------------------------------------------------------------------------

/// PERMISSIONLESS submission (Ed25519SigVerify in the same transaction, a quorum of the coin's attesters over canonical_end_message).
/// Once per coin; only for a coin with an EndSink. The end date is a valid date, not in the future, and exactly the coin's last
/// reading's date (the coin has read at least once); outcome END_STATE_RESOLVED or END_STATE_VOID. Sets TokenConfig.end_state / end_date.
#[event_cpi]
#[derive(Accounts)]
pub struct SubmitRuleEnd<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED, config.mint.as_ref()], bump = config.bump)]
    pub config: Box<Account<'info, TokenConfig>>,
    #[account(seeds = [END_SINK_SEED, config.mint.as_ref()], bump = end_sink.bump)]
    pub end_sink: Box<Account<'info, EndSink>>,
    #[account(init, payer = payer, space = 8 + RuleEnd::INIT_SPACE, seeds = [RULE_END_SEED, config.mint.as_ref()], bump)]
    pub rule_end: Box<Account<'info, RuleEnd>>,
    /// CHECK: address-checked: the instructions sysvar.
    #[account(address = solana_instructions_sysvar::ID)]
    pub instructions: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handle_submit_rule_end(ctx: Context<SubmitRuleEnd>, record_date: u32, outcome: u8, source_url_hash: [u8; 32], proof_hash: [u8; 32]) -> Result<()> {
    let c = &ctx.accounts.config;
    require!(c.end_state == END_STATE_LIVE, BurnError::RuleEnded);
    let clock = Clock::get()?;
    require!(math::valid_date(record_date) && record_date <= math::utc_date(clock.unix_timestamp), BurnError::InvalidRuleEnd);
    // Blind review M-1: the end is dated the coin's last reading (the result that ended the rule), never later, so no forward can run
    // before that reading is processed and no result can arrive after the fuel has gone.
    require!(c.last_record_date != 0 && record_date == c.last_record_date, BurnError::InvalidRuleEnd);
    require!(outcome == END_STATE_RESOLVED || outcome == END_STATE_VOID, BurnError::InvalidRuleEnd);
    require!(source_url_hash != [0u8; 32], BurnError::InvalidValue);
    let mint = c.mint;
    let msg = canonical_end_message(&crate::ID, &mint, record_date, outcome, &source_url_hash, &proof_hash);
    let mask = attested_mask(&ctx.accounts.instructions.to_account_info(), msg.as_bytes(), c.attester_slice())?;
    require!(mask.count_ones() >= c.quorum as u32, BurnError::QuorumNotMet);

    let r = &mut ctx.accounts.rule_end;
    r.version = 1;
    r.bump = ctx.bumps.rule_end;
    r.mint = mint;
    r.record_date = record_date;
    r.outcome = outcome;
    r.signers_mask = mask;
    r.source_url_hash = source_url_hash;
    r.proof_hash = proof_hash;
    r.submitted_at = clock.unix_timestamp;
    r.forwarded_lamports = 0;
    r.forwards = 0;
    r.last_forward_at = 0;
    r.reserved = [0u8; 32];
    let c = &mut ctx.accounts.config;
    c.end_state = outcome;
    c.end_date = record_date;
    emit_cpi!(RuleEnded { mint, record_date, outcome, signers_mask: mask, source_url_hash, proof_hash, submitter: ctx.accounts.payer.key() });
    Ok(())
}

/// The reading-side rule after an end (submit_reading, crank_buyback): after a RESOLVED end nothing dated later than the end.
pub fn reading_allowed_after_end(c: &TokenConfig, record_date: u32) -> bool {
    c.end_state != END_STATE_RESOLVED || record_date <= c.end_date
}

// ---------------------------------------------------------------------------------------------------------------------------------
// forward_on_end
// ---------------------------------------------------------------------------------------------------------------------------------

/// PERMISSIONLESS. For a coin whose rule ended RESOLVED and whose
/// readings inside the window are all processed (crank_cursor == last_record_date; not required of a coin that never registered a pool,
/// which can never crank them): moves min(fee PDA SOL above the reserve + its
/// synced WSOL, less any carry still held back) to the destination's fee PDA — SOL first, then WSOL into the destination fee PDA's WSOL account —
/// if it is at least EndSink.min_forward_lamports. The destination (`target_config`) is decided here, never by the caller:
///   FLAGSHIP → the flagship; MINT → the named coin if live, else the flagship; PAIR_WINNER → the partner if the end date's
///   PairResult names it winner and it is live and still paired, else the flagship.
/// Live = a verified pool, its own rule not ended, buyback mode (the flagship must have a verified pool, or nothing moves). Pass
/// `sink_config` (the named coin's TokenConfig) for MINT / PAIR_WINNER, and `pair_link` + `pair_result` for PAIR_WINNER. The coin's
/// carried spend is cleared (there are no more burns to owe). Callable again for the later trickle.
#[event_cpi]
#[derive(Accounts)]
pub struct ForwardOnEnd<'info> {
    pub cranker: Signer<'info>,
    /// CHECK: the platform PDA (seeds-checked); unused since the cap and the cranker allowlist were removed (2026-10-25).
    #[account(seeds = [PLATFORM_SEED], bump)]
    pub platform: UncheckedAccount<'info>,
    #[account(mut, seeds = [CONFIG_SEED, config.mint.as_ref()], bump = config.bump)]
    pub config: Box<Account<'info, TokenConfig>>,
    #[account(mut, seeds = [FEE_SEED, config.mint.as_ref()], bump = config.fee_bump)]
    pub fee_vault: SystemAccount<'info>,
    /// CHECK: ATA(fee PDA, WSOL) — address-checked; may not exist (then it holds nothing).
    #[account(mut, address = get_associated_token_address(&fee_vault.key(), &NATIVE_MINT) @ BurnError::FeeAccountTampered)]
    pub fee_wsol: UncheckedAccount<'info>,
    #[account(seeds = [END_SINK_SEED, config.mint.as_ref()], bump = end_sink.bump)]
    pub end_sink: Box<Account<'info, EndSink>>,
    #[account(mut, seeds = [RULE_END_SEED, config.mint.as_ref()], bump = rule_end.bump)]
    pub rule_end: Box<Account<'info, RuleEnd>>,
    #[account(seeds = [CONFIG_SEED, target_config.mint.as_ref()], bump = target_config.bump)]
    pub target_config: Box<Account<'info, TokenConfig>>,
    #[account(mut, seeds = [FEE_SEED, target_config.mint.as_ref()], bump = target_config.fee_bump)]
    pub target_fee_vault: SystemAccount<'info>,
    /// CHECK: ATA(target fee PDA, WSOL) — address-checked; must exist only when WSOL is forwarded.
    #[account(mut, address = get_associated_token_address(&target_fee_vault.key(), &NATIVE_MINT) @ BurnError::FeeAccountTampered)]
    pub target_fee_wsol: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    /// CHECK: address-checked: the SPL Memo program.
    #[account(address = MEMO_PROGRAM_ID)]
    pub memo_program: UncheckedAccount<'info>,
    /// CHECK: the EndSink's named coin's TokenConfig address ["config", sink_mint] (address-checked in the handler). It may not exist
    /// (blind review H-1: a named coin that never launched): then the sink is not live and the fuel goes to the flagship.
    pub sink_config: Option<UncheckedAccount<'info>>,
    /// CHECK: PAIR_WINNER: this coin's PairLink ["pair_link", mint] (address-checked in the handler).
    pub pair_link: Option<UncheckedAccount<'info>>,
    /// CHECK: PAIR_WINNER: the PairResult of the end date (address-checked in the handler; may not exist → flagship).
    pub pair_result: Option<UncheckedAccount<'info>>,
    /// CHECK: round-5 review R5-9: the named sink coin's BurnTarget ["burn_target", sink_mint] (address-checked in side_live). Needed
    /// only when the sink coin burns a target and its own pool is not verified yet (refused without it: BurnTargetAccountMissing).
    pub sink_burn_target: Option<UncheckedAccount<'info>>,
}

/// Live = the coin's own pool verified (own_pool_verified: a target coin records it outside `pool_verified`, R5-12), its rule not
/// ended, buyback mode. (The flagship's test; the flagship burns itself.)
pub fn live(c: &TokenConfig) -> bool {
    c.own_pool_verified() && c.end_state == END_STATE_LIVE && c.rule.mode == MODE_BUYBACK
}

/// A named sink coin's test (round-5 review R5-9): as `live`, except that a target coin whose BurnTarget is pinned counts as live
/// before its own pool is verified (burn_target::side_live; `bt` = its BurnTarget account).
pub fn sink_live(c: &TokenConfig, bt: Option<&AccountInfo>) -> Result<bool> {
    Ok(c.end_state == END_STATE_LIVE && c.rule.mode == MODE_BUYBACK && crate::instructions::burn_target::side_live(c, bt)?)
}

/// Round-5 review R5-1: the end paths wait for every reading inside the window, except for a coin that has no burn path at all — a
/// SELF coin that never registered a pool (its readings can never crank). A target coin cranks without its own pool
/// (crank_target_burn), so it always waits.
pub fn end_readings_done(c: &TokenConfig) -> bool {
    c.crank_cursor == c.last_record_date || (c.cpmm_pool == Pubkey::default() && c.burn_target_kind == BURN_TARGET_SELF)
}

/// Round-5 review R5-4: the carried spend a SELF coin with a verified pool still owes from readings inside its window is drained by
/// crank_carried first. For END_CARRY_GRACE_SECS (30 days) after a RESOLVED end the end paths move only the fuel above it, so the
/// keeper's order (crank_carried, then forward) is enforced on chain; after that they move everything (nothing can strand).
pub fn carry_held_back(c: &TokenConfig, rule_end: &RuleEnd, now: i64) -> u64 {
    let drainable = c.burn_target_kind == BURN_TARGET_SELF && c.pool_verified && c.cpmm_pool != Pubkey::default();
    if drainable && now.saturating_sub(rule_end.submitted_at) < QUEUE_UNBLOCK_SECS {
        c.carried_spend_lamports
    } else {
        0
    }
}

/// PAIR_WINNER: this coin is still paired to `sink`, and the PairResult of `date` names `sink` as winner.
fn partner_won(c: &TokenConfig, sink: &Pubkey, date: u32, link: Option<&AccountInfo>, result: Option<&AccountInfo>) -> Result<bool> {
    if c.pair_state != PAIR_STATE_PAIRED {
        return Ok(false);
    }
    let link = link.ok_or(BurnError::EndSinkMismatch)?;
    require_keys_eq!(*link.key, pair_link_address(&c.mint).0, BurnError::EndSinkMismatch);
    let Some(l) = read_link(link)? else { return Ok(false) };
    if !l.paired || l.pair_mint != *sink {
        return Ok(false);
    }
    let res = result.ok_or(BurnError::EndSinkMismatch)?;
    require_keys_eq!(*res.key, pair_result_address(&c.mint, sink, date).0, BurnError::EndSinkMismatch);
    if res.owner != &crate::ID || res.data_is_empty() {
        return Ok(false);
    }
    let data = res.try_borrow_data()?;
    let pr = PairResult::try_deserialize(&mut &data[..])?;
    Ok(pr.record_date == date && pr.winner == *sink)
}

pub fn handle_forward_on_end(ctx: Context<ForwardOnEnd>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let a = &ctx.accounts;
    let c = &a.config;
    require!(c.end_state == END_STATE_RESOLVED, BurnError::NotEndedResolved);
    require!(c.rule.mode == MODE_BUYBACK, BurnError::WrongMode);
    // Every reading inside the window is processed first (the result reading burns or forwards to the pair winner) — unless the coin
    // has no verified pool, whose readings can never crank (a one-shot that never graduated): its fuel goes to the sink regardless.
    // Blind review L-3: the exception is a coin that never registered a pool (not one whose pool is mid-verification).
    require!(end_readings_done(c), BurnError::EndReadingsPending);
    require!(BURNTICKER_FLAGSHIP != Pubkey::default(), BurnError::FlagshipNotPinned);

    // ----- the destination -----
    let sink = a.end_sink.sink_mint;
    let kind = a.end_sink.sink_kind;
    let intended = match kind {
        END_SINK_FLAGSHIP => BURNTICKER_FLAGSHIP,
        END_SINK_MINT => sink,
        END_SINK_PAIR_WINNER => {
            if partner_won(c, &sink, c.end_date, a.pair_link.as_ref().map(|x| x.as_ref()), a.pair_result.as_ref().map(|x| x.as_ref()))? {
                sink
            } else {
                BURNTICKER_FLAGSHIP
            }
        }
        _ => return err!(BurnError::InvalidEndSink),
    };
    let dest = if intended == BURNTICKER_FLAGSHIP {
        BURNTICKER_FLAGSHIP
    } else {
        let sc = a.sink_config.as_ref().ok_or(BurnError::EndSinkMismatch)?;
        let (want, _) = Pubkey::find_program_address(&[CONFIG_SEED, intended.as_ref()], &crate::ID);
        require_keys_eq!(*sc.key, want, BurnError::EndSinkMismatch);
        let ok = if sc.owner != &crate::ID || sc.data_is_empty() {
            false
        } else {
            let data = sc.try_borrow_data()?;
            let cfg = TokenConfig::try_deserialize(&mut &data[..])?;
            cfg.mint == intended
                && sink_live(&cfg, a.sink_burn_target.as_ref().map(|x| x.as_ref()))?
                && (kind != END_SINK_PAIR_WINNER || cfg.pair_state == PAIR_STATE_PAIRED)
        };
        if ok {
            intended
        } else {
            BURNTICKER_FLAGSHIP
        }
    };
    require_keys_eq!(a.target_config.mint, dest, BurnError::EndSinkMismatch);
    if dest == BURNTICKER_FLAGSHIP {
        require!(live(&a.target_config), BurnError::FlagshipNotLive);
    }

    // ----- the amount: what is spendable (owner decision 2026-10-25: no platform cap) -----
    let reserve = c.rule.reserve_lamports;
    let mint = c.mint;
    let fee_bump = c.fee_bump;
    let fee_seeds: &[&[u8]] = &[FEE_SEED, mint.as_ref(), &[fee_bump]];
    let wsol_acc = a.fee_wsol.to_account_info();
    let wsol_avail = wsol_synced_or_zero(&wsol_acc)?;
    if wsol_avail > 0 {
        require_fee_token_account_intact(&wsol_acc, &a.fee_vault.key(), &NATIVE_MINT, false)?;
    }
    let sol_avail = a.fee_vault.lamports().saturating_sub(reserve);
    let held_back = carry_held_back(c, &a.rule_end, now);
    let pool_actual = sol_avail.checked_add(wsol_avail).ok_or(BurnError::MathOverflow)?.saturating_sub(held_back);
    let amount = pool_actual;
    // Blind review M-3: the first forward moves whatever is there (a small coin's remainder is never stranded under the minimum); the
    // minimum gates the later trickle.
    require!(amount > 0 && (amount >= a.end_sink.min_forward_lamports || a.rule_end.forwards == 0), BurnError::NothingToForward);
    let sol_part = amount.min(sol_avail);
    let wsol_part = amount - sol_part;
    let clear_carry = held_back == 0;

    if sol_part > 0 {
        system_program::transfer(
            CpiContext::new_with_signer(
                system_program::ID,
                system_program::Transfer { from: a.fee_vault.to_account_info(), to: a.target_fee_vault.to_account_info() },
                &[fee_seeds],
            ),
            sol_part,
        )?;
        require!(a.fee_vault.lamports() >= reserve, BurnError::ReserveBreached);
    }
    if wsol_part > 0 {
        require_fee_token_account_intact(&a.target_fee_wsol.to_account_info(), &a.target_fee_vault.key(), &NATIVE_MINT, false)?;
        token::sync_native(CpiContext::new(token::ID, token::SyncNative { account: wsol_acc.clone() }))?;
        token::transfer(
            CpiContext::new_with_signer(
                token::ID,
                token::Transfer { from: wsol_acc.clone(), to: a.target_fee_wsol.to_account_info(), authority: a.fee_vault.to_account_info() },
                &[fee_seeds],
            ),
            wsol_part,
        )?;
    }
    let m = memo::format_end_forward(c.memo_prefix_str(), &dest, amount);
    memo::emit_memo(&a.memo_program.to_account_info(), &m)?;

    if clear_carry {
        ctx.accounts.config.carried_spend_lamports = 0;
    }
    let r = &mut ctx.accounts.rule_end;
    r.forwarded_lamports = r.forwarded_lamports.saturating_add(amount);
    r.forwards = r.forwards.saturating_add(1);
    r.last_forward_at = now;
    emit_cpi!(ForwardedOnEnd {
        mint,
        to_mint: dest,
        intended_mint: intended,
        sink_kind: kind,
        lamports: amount,
        sol_lamports: sol_part,
        wsol_lamports: wsol_part,
        cranker: ctx.accounts.cranker.key(),
    });
    Ok(())
}

// ---------------------------------------------------------------------------------------------------------------------------------
// burn_sol_on_end (the incinerator end sink, owner 2026-10-13)
// ---------------------------------------------------------------------------------------------------------------------------------

/// PERMISSIONLESS, for a coin whose EndSink kind is INCINERATOR and
/// whose rule ended RESOLVED with every reading inside the window processed (the same gates as forward_on_end). The fee PDA's WSOL is
/// unwrapped first (its account closed into the fee PDA and created again at the cranker's cost, refunded from the account's own
/// rent), then the fee PDA's SOL above the reserve is transferred to Solana's incinerator — the account is
/// address-checked, so no other destination can be passed. No swap, no price impact. The reserve stays. Memo
/// `<PREFIX>|endburn|to=1nc1nerator1|lamports=N|v1`, event SolBurnedOnEnd. Callable again for the later trickle (minimum as for
/// forward_on_end). forward_on_end refuses this kind (InvalidEndSink), so the SOL can only ever reach the incinerator.
#[event_cpi]
#[derive(Accounts)]
pub struct BurnSolOnEnd<'info> {
    #[account(mut)]
    pub cranker: Signer<'info>,
    /// CHECK: the platform PDA (seeds-checked); unused since the cap and the cranker allowlist were removed (2026-10-25).
    #[account(seeds = [PLATFORM_SEED], bump)]
    pub platform: UncheckedAccount<'info>,
    #[account(mut, seeds = [CONFIG_SEED, config.mint.as_ref()], bump = config.bump)]
    pub config: Box<Account<'info, TokenConfig>>,
    #[account(mut, seeds = [FEE_SEED, config.mint.as_ref()], bump = config.fee_bump)]
    pub fee_vault: SystemAccount<'info>,
    /// CHECK: ATA(fee PDA, WSOL) — address-checked; may not exist (then it holds nothing and is left alone).
    #[account(mut, address = get_associated_token_address(&fee_vault.key(), &NATIVE_MINT) @ BurnError::FeeAccountTampered)]
    pub fee_wsol: UncheckedAccount<'info>,
    /// CHECK: address-checked: the WSOL mint (to create the fee PDA's WSOL account again after unwrapping).
    #[account(address = NATIVE_MINT)]
    pub wsol_mint: UncheckedAccount<'info>,
    #[account(seeds = [END_SINK_SEED, config.mint.as_ref()], bump = end_sink.bump)]
    pub end_sink: Box<Account<'info, EndSink>>,
    #[account(mut, seeds = [RULE_END_SEED, config.mint.as_ref()], bump = rule_end.bump)]
    pub rule_end: Box<Account<'info, RuleEnd>>,
    /// CHECK: address-checked: Solana's incinerator, the only destination.
    #[account(mut, address = INCINERATOR_ID @ BurnError::NotIncineratorSink)]
    pub incinerator: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    /// CHECK: address-checked: the SPL Memo program.
    #[account(address = MEMO_PROGRAM_ID)]
    pub memo_program: UncheckedAccount<'info>,
}

pub fn handle_burn_sol_on_end(ctx: Context<BurnSolOnEnd>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let a = &ctx.accounts;
    let c = &a.config;
    require!(a.end_sink.sink_kind == END_SINK_INCINERATOR && a.end_sink.sink_mint == INCINERATOR_ID, BurnError::NotIncineratorSink);
    require!(c.end_state == END_STATE_RESOLVED, BurnError::NotEndedResolved);
    require!(c.rule.mode == MODE_BUYBACK, BurnError::WrongMode);
    require!(end_readings_done(c), BurnError::EndReadingsPending);
    let held_back = carry_held_back(c, &a.rule_end, now);

    let reserve = c.rule.reserve_lamports;
    let mint = c.mint;
    let fee_bump = c.fee_bump;
    let fee_seeds: &[&[u8]] = &[FEE_SEED, mint.as_ref(), &[fee_bump]];
    let fee = a.fee_vault.to_account_info();

    // ----- unwrap the WSOL into the fee PDA, keeping its WSOL account (the LaunchLab claim lands there) -----
    let wsol_acc = a.fee_wsol.to_account_info();
    let mut unwrapped = 0u64;
    if wsol_synced_or_zero(&wsol_acc)? > 0 {
        require_fee_token_account_intact(&wsol_acc, &fee.key(), &NATIVE_MINT, false)?;
        let before = fee.lamports();
        token::close_account(CpiContext::new_with_signer(
            token::ID,
            token::CloseAccount { account: wsol_acc.clone(), destination: fee.clone(), authority: fee.clone() },
            &[fee_seeds],
        ))?;
        let released = fee.lamports().checked_sub(before).ok_or(BurnError::MathOverflow)?;
        let cranker_before = a.cranker.lamports();
        associated_token::create_idempotent(CpiContext::new(
            associated_token::ID,
            associated_token::Create {
                payer: a.cranker.to_account_info(),
                associated_token: wsol_acc.clone(),
                authority: fee.clone(),
                mint: a.wsol_mint.to_account_info(),
                system_program: a.system_program.to_account_info(),
                token_program: a.token_program.to_account_info(),
            },
        ))?;
        let rent = cranker_before.checked_sub(a.cranker.lamports()).ok_or(BurnError::MathOverflow)?;
        require!(rent <= released, BurnError::MathOverflow);
        if rent > 0 {
            system_program::transfer(
                CpiContext::new_with_signer(system_program::ID, system_program::Transfer { from: fee.clone(), to: a.cranker.to_account_info() }, &[fee_seeds]),
                rent,
            )?;
        }
        unwrapped = released - rent;
        require_fee_token_account_intact(&wsol_acc, &fee.key(), &NATIVE_MINT, false)?;
    }

    // ----- the amount: the SOL above the reserve (owner decision 2026-10-25: no platform cap) -----
    let amount = fee.lamports().saturating_sub(reserve).saturating_sub(held_back);
    require!(amount > 0 && (amount >= a.end_sink.min_forward_lamports || a.rule_end.forwards == 0), BurnError::NothingToForward);
    // the incinerator holds nothing between blocks (the runtime burns what it is credited), so each transfer must itself reach the
    // rent-exempt minimum of an empty account, or the runtime refuses it; a smaller remainder waits for the trickle
    require!(amount >= Rent::get()?.minimum_balance(0), BurnError::NothingToForward);
    system_program::transfer(
        CpiContext::new_with_signer(system_program::ID, system_program::Transfer { from: fee.clone(), to: a.incinerator.to_account_info() }, &[fee_seeds]),
        amount,
    )?;
    require!(fee.lamports() >= reserve, BurnError::ReserveBreached);
    let m = memo::format_end_burn(c.memo_prefix_str(), amount);
    memo::emit_memo(&a.memo_program.to_account_info(), &m)?;

    if held_back == 0 {
        ctx.accounts.config.carried_spend_lamports = 0;
    }
    let r = &mut ctx.accounts.rule_end;
    r.forwarded_lamports = r.forwarded_lamports.saturating_add(amount);
    r.forwards = r.forwards.saturating_add(1);
    r.last_forward_at = now;
    emit_cpi!(SolBurnedOnEnd { mint, to: INCINERATOR_ID, lamports: amount, unwrapped_lamports: unwrapped.min(amount), cranker: ctx.accounts.cranker.key() });
    Ok(())
}
