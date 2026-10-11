//! LAUNCHPAD-PATH §40 (owner decision 2026-10-11): every pair is WINNER TAKES THE BURN. At each result the loser's fuel for that
//! result — exactly the lamports its own rule would have spent had it won — moves from the loser's fee PDA to the winner's fee PDA,
//! and the winner's ordinary cranks buy and burn the winner's coin. The loser's supply is untouched; nobody is paid.
//!
//!   pairing        TokenConfig.pair_state + PairLink ["pair_link", mint]: written by initialize_token when the creator names the
//!                  partner mint (provisional until the partner's initialize_token names this mint back within PAIRING_WINDOW_SECS;
//!                  an unanswered provisional coin is a plain coin for good), or by link_pair when a pair_curve Pair holds both mints
//!                  (policy 2; register_pair_pool requires it).
//!   result         submit_pair_result: one PairResult per (pair, period), a quorum of EACH coin's attesters over the pair message
//!                  (attest.rs canonical_pair_message); winner = a mint, or Pubkey::default() for a draw. Append-only.
//!   forward        forward_to_winner: processes the LOSER's reading for that period (next in its queue) by moving
//!                  buyback_spend(min(spendable, cap), units, f) from its fee PDA to the winner's (SOL first, then WSOL), marks the
//!                  reading OUTCOME_FORWARDED and records the forward on the PairResult. Idempotent.
//!   crank gate     crank_buyback on a paired coin needs the period's PairResult: LOST refuses (ForwardRequired), WON / DRAW proceed;
//!                  no result yet refuses (PairResultPending) until PAIR_RESULT_GRACE_SECS after the reading, then it burns as an
//!                  unpaired coin would (a missing result never wedges the queue; that period can no longer be forwarded).
//!
//! The winner's own crank for the period is never blocked by the forward: the forwarded lamports simply join its fee PDA and later
//! cranks spend them under the usual guards (cap, TWAP, 2 % reserve cap, floor).

use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::associated_token::get_associated_token_address;
use anchor_spl::token::{self, spl_token, Token};

use crate::attest::{attested_mask, canonical_pair_message};
use crate::constants::*;
use crate::error::BurnError;
use crate::events::{ForwardedToWinner, PairLinked, PairResultSubmitted};
use crate::guards::require_fee_token_account_intact;
use crate::instructions::crank_common::{active_cap, crankers_in_force, require_next_in_line};
use crate::math;
use crate::memo;
use crate::pair_curve::PairView;
use crate::state::{pair_link_address, pair_order, pair_result_address, PairLink, PairResult, Reading, TokenConfig};

// ---------------------------------------------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------------------------------------------

/// Creates a program-owned PDA account (Anchor `init` semantics: an address someone pre-funded is topped up, allocated, assigned).
fn create_pda<'info>(payer: &AccountInfo<'info>, acc: &AccountInfo<'info>, _system: &AccountInfo<'info>, space: usize, seeds: &[&[u8]]) -> Result<()> {
    let need = Rent::get()?.minimum_balance(space);
    let have = acc.lamports();
    if have == 0 {
        system_program::create_account(
            CpiContext::new_with_signer(system_program::ID, system_program::CreateAccount { from: payer.clone(), to: acc.clone() }, &[seeds]),
            need,
            space as u64,
            &crate::ID,
        )
    } else {
        require!(acc.owner == &system_program::ID && acc.data_is_empty(), BurnError::PairMismatch);
        if have < need {
            system_program::transfer(CpiContext::new(system_program::ID, system_program::Transfer { from: payer.clone(), to: acc.clone() }), need - have)?;
        }
        system_program::allocate(CpiContext::new_with_signer(system_program::ID, system_program::Allocate { account_to_allocate: acc.clone() }, &[seeds]), space as u64)?;
        system_program::assign(CpiContext::new_with_signer(system_program::ID, system_program::Assign { account_to_assign: acc.clone() }, &[seeds]), &crate::ID)
    }
}

fn write_link(acc: &AccountInfo, link: &PairLink) -> Result<()> {
    let mut data = acc.try_borrow_mut_data()?;
    let mut w: &mut [u8] = &mut data;
    link.try_serialize(&mut w)
}

/// The PairLink stored at `acc`, if any (owner + discriminator checked by Anchor's deserializer).
pub fn read_link(acc: &AccountInfo) -> Result<Option<PairLink>> {
    if acc.owner != &crate::ID || acc.data_is_empty() {
        return Ok(None);
    }
    let data = acc.try_borrow_data()?;
    Ok(Some(PairLink::try_deserialize(&mut &data[..])?))
}

#[allow(clippy::too_many_arguments)]
fn new_link<'info>(
    payer: &AccountInfo<'info>,
    acc: &AccountInfo<'info>,
    system: &AccountInfo<'info>,
    mint: &Pubkey,
    pair_mint: &Pubkey,
    paired: bool,
    witness: u8,
    now: i64,
) -> Result<PairLink> {
    let (addr, bump) = pair_link_address(mint);
    require_keys_eq!(*acc.key, addr, BurnError::PairMismatch);
    create_pda(payer, acc, system, 8 + PairLink::INIT_SPACE, &[PAIR_LINK_SEED, mint.as_ref(), &[bump]])?;
    let link = PairLink {
        version: 1,
        bump,
        mint: *mint,
        pair_mint: *pair_mint,
        paired,
        witness,
        created_at: now,
        pairing_deadline: if paired { 0 } else { now.saturating_add(PAIRING_WINDOW_SECS) },
        paired_at: if paired { now } else { 0 },
        reserved: [0u8; 32],
    };
    write_link(acc, &link)?;
    Ok(link)
}

// ---------------------------------------------------------------------------------------------------------------------------------
// initialize_token: the creator names the partner
// ---------------------------------------------------------------------------------------------------------------------------------

pub struct InitPairAccounts<'a, 'info> {
    pub payer: &'a AccountInfo<'info>,
    pub system: &'a AccountInfo<'info>,
    pub pair_mint: &'a AccountInfo<'info>,
    pub pair_link: &'a AccountInfo<'info>,
    /// The partner's PairLink and TokenConfig — both passed when the partner initialized first (it then becomes paired here).
    pub partner_link: Option<&'a AccountInfo<'info>>,
    pub partner_config: Option<&'a mut Account<'info, TokenConfig>>,
}

/// Writes this coin's PairLink; returns the coin's pair_state. Pairs the two coins when the partner already named this mint
/// (inside its window); otherwise the coin is provisional until the partner answers (or for good, as a plain coin).
/// Policy-2 (pair_curve) coins are paired only by link_pair, with the Pair as the witness.
pub fn pair_at_initialize(a: InitPairAccounts, mint: &Pubkey, mode: u8, pool_policy: u8, now: i64) -> Result<(u8, PairLink)> {
    let pair_mint = *a.pair_mint.key;
    require!(mode == MODE_BUYBACK && pool_policy != POOL_POLICY_PAIR_CURVE, BurnError::InvalidPairMint);
    require!(pair_mint != *mint && pair_mint != Pubkey::default(), BurnError::InvalidPairMint);
    let partner = match a.partner_link {
        Some(pl) => {
            require_keys_eq!(*pl.key, pair_link_address(&pair_mint).0, BurnError::PairMismatch);
            read_link(pl)?
        }
        None => None,
    };
    match partner {
        Some(mut theirs) => {
            // The partner initialized first: it must have named THIS mint, still be waiting, and be inside its window.
            require!(theirs.mint == pair_mint && theirs.pair_mint == *mint, BurnError::PairMismatch);
            require!(!theirs.paired && now <= theirs.pairing_deadline, BurnError::PairingClosed);
            let pc = a.partner_config.ok_or(BurnError::PairMismatch)?;
            require!(pc.mint == pair_mint && pc.pair_state == PAIR_STATE_PROVISIONAL, BurnError::PairMismatch);
            let ours = new_link(a.payer, a.pair_link, a.system, mint, &pair_mint, true, PAIR_WITNESS_INITIALIZE, now)?;
            theirs.paired = true;
            theirs.paired_at = now;
            write_link(a.partner_link.expect("checked"), &theirs)?;
            pc.pair_state = PAIR_STATE_PAIRED;
            Ok((PAIR_STATE_PAIRED, ours))
        }
        None => {
            let ours = new_link(a.payer, a.pair_link, a.system, mint, &pair_mint, false, PAIR_WITNESS_INITIALIZE, now)?;
            Ok((PAIR_STATE_PROVISIONAL, ours))
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// link_pair: the pair_curve Pair is the witness (policy 2)
// ---------------------------------------------------------------------------------------------------------------------------------

/// PERMISSIONLESS, idempotent. Pairs the two coins of a pair_curve Pair (policy-2 TokenConfigs, Pair not Voided): writes or completes
/// both PairLinks and sets both configs PAIRED. Refuses if either coin is already linked to another partner.
#[event_cpi]
#[derive(Accounts)]
pub struct LinkPair<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: the pair_curve Pair (owner, discriminator, length, address checked by PairView::load).
    pub pair: UncheckedAccount<'info>,
    #[account(mut, seeds = [CONFIG_SEED, config_a.mint.as_ref()], bump = config_a.bump)]
    pub config_a: Box<Account<'info, TokenConfig>>,
    #[account(mut, seeds = [CONFIG_SEED, config_b.mint.as_ref()], bump = config_b.bump)]
    pub config_b: Box<Account<'info, TokenConfig>>,
    /// CHECK: config_a's PairLink ["pair_link", mint_a] (address-checked; created if absent).
    #[account(mut)]
    pub link_a: UncheckedAccount<'info>,
    /// CHECK: config_b's PairLink ["pair_link", mint_b] (address-checked; created if absent).
    #[account(mut)]
    pub link_b: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handle_link_pair(ctx: Context<LinkPair>) -> Result<()> {
    let pair = PairView::load(&ctx.accounts.pair.to_account_info())?;
    require!(pair.status != PAIR_CURVE_STATUS_VOIDED, BurnError::PairMismatch);
    let (ma, mb) = (ctx.accounts.config_a.mint, ctx.accounts.config_b.mint);
    require!(ma == pair.mints[0] && mb == pair.mints[1], BurnError::PairMismatch);
    for c in [&ctx.accounts.config_a, &ctx.accounts.config_b] {
        require!(c.rule.mode == MODE_BUYBACK && c.rule.pool_policy == POOL_POLICY_PAIR_CURVE, BurnError::WrongPoolPolicy);
    }
    let now = Clock::get()?.unix_timestamp;
    let (payer, system) = (ctx.accounts.payer.to_account_info(), ctx.accounts.system_program.to_account_info());
    let mut linked = Vec::new();
    for (mint, other, acc) in [(ma, mb, ctx.accounts.link_a.to_account_info()), (mb, ma, ctx.accounts.link_b.to_account_info())] {
        require_keys_eq!(*acc.key, pair_link_address(&mint).0, BurnError::PairMismatch);
        match read_link(&acc)? {
            Some(mut l) => {
                require!(l.pair_mint == other, BurnError::PairingClosed);
                if !l.paired {
                    l.paired = true;
                    l.paired_at = now;
                    write_link(&acc, &l)?;
                    linked.push(l);
                }
            }
            None => linked.push(new_link(&payer, &acc, &system, &mint, &other, true, PAIR_WITNESS_PAIR_CURVE, now)?),
        }
    }
    ctx.accounts.config_a.pair_state = PAIR_STATE_PAIRED;
    ctx.accounts.config_b.pair_state = PAIR_STATE_PAIRED;
    for l in linked {
        emit_cpi!(PairLinked { mint: l.mint, pair_mint: l.pair_mint, paired: true, witness: l.witness, pairing_deadline: l.pairing_deadline });
    }
    Ok(())
}

// ---------------------------------------------------------------------------------------------------------------------------------
// submit_pair_result
// ---------------------------------------------------------------------------------------------------------------------------------

/// PERMISSIONLESS submission; valid only with a quorum of EACH coin's attesters over the pair message (Ed25519SigVerify in the same
/// transaction, as for submit_reading). Configs in byte order of their mints. Re-submitting the same result is a no-op; a different
/// one is refused. PairResultSubmitted is a plain log event (emit!, "Program data:"), not a self-CPI: two attester signatures, the
/// shared message and these ten accounts must fit one legacy transaction (with event-CPI's two extra accounts it would be 1,242 B).
#[derive(Accounts)]
#[instruction(record_date: u32)]
pub struct SubmitPairResult<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED, config_lo.mint.as_ref()], bump = config_lo.bump)]
    pub config_lo: Box<Account<'info, TokenConfig>>,
    #[account(seeds = [CONFIG_SEED, config_hi.mint.as_ref()], bump = config_hi.bump)]
    pub config_hi: Box<Account<'info, TokenConfig>>,
    #[account(seeds = [PAIR_LINK_SEED, config_lo.mint.as_ref()], bump = link_lo.bump)]
    pub link_lo: Box<Account<'info, PairLink>>,
    #[account(seeds = [PAIR_LINK_SEED, config_hi.mint.as_ref()], bump = link_hi.bump)]
    pub link_hi: Box<Account<'info, PairLink>>,
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + PairResult::INIT_SPACE,
        seeds = [PAIR_RESULT_SEED, config_lo.mint.as_ref(), config_hi.mint.as_ref(), &record_date.to_le_bytes()],
        bump
    )]
    pub pair_result: Box<Account<'info, PairResult>>,
    /// CHECK: address-checked: the instructions sysvar.
    #[account(address = solana_instructions_sysvar::ID)]
    pub instructions: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

/// Both coins paired to each other.
fn require_paired(a: &TokenConfig, b: &TokenConfig, la: &PairLink, lb: &PairLink) -> Result<()> {
    require!(a.pair_state == PAIR_STATE_PAIRED && b.pair_state == PAIR_STATE_PAIRED, BurnError::NotPaired);
    require!(la.paired && lb.paired && la.pair_mint == b.mint && lb.pair_mint == a.mint, BurnError::NotPaired);
    Ok(())
}

pub fn handle_submit_pair_result(ctx: Context<SubmitPairResult>, record_date: u32, winner: Pubkey, source_url_hash: [u8; 32], proof_hash: [u8; 32]) -> Result<()> {
    let (lo, hi) = (ctx.accounts.config_lo.mint, ctx.accounts.config_hi.mint);
    require!(lo.to_bytes() < hi.to_bytes(), BurnError::PairOrder);
    require_paired(&ctx.accounts.config_lo, &ctx.accounts.config_hi, &ctx.accounts.link_lo, &ctx.accounts.link_hi)?;
    require!(math::valid_date(record_date), BurnError::InvalidDate);
    let clock = Clock::get()?;
    require!(record_date <= math::utc_date(clock.unix_timestamp), BurnError::FutureDate);
    require!(winner == lo || winner == hi || winner == Pubkey::default(), BurnError::InvalidWinner);
    require!(source_url_hash != [0u8; 32], BurnError::InvalidValue);
    if ctx.accounts.pair_result.record_date != 0 {
        require!(ctx.accounts.pair_result.winner == winner, BurnError::ConflictingPairResult);
        return Ok(());
    }
    let msg = canonical_pair_message(&crate::ID, &lo, &hi, record_date, &winner, &source_url_hash, &proof_hash);
    let ix = ctx.accounts.instructions.to_account_info();
    let mask_lo = attested_mask(&ix, msg.as_bytes(), ctx.accounts.config_lo.attester_slice())?;
    let mask_hi = attested_mask(&ix, msg.as_bytes(), ctx.accounts.config_hi.attester_slice())?;
    require!(mask_lo.count_ones() >= ctx.accounts.config_lo.quorum as u32, BurnError::QuorumNotMet);
    require!(mask_hi.count_ones() >= ctx.accounts.config_hi.quorum as u32, BurnError::QuorumNotMet);

    let r = &mut ctx.accounts.pair_result;
    r.version = 1;
    r.bump = ctx.bumps.pair_result;
    r.mint_lo = lo;
    r.mint_hi = hi;
    r.record_date = record_date;
    r.winner = winner;
    r.signers_mask_lo = mask_lo;
    r.signers_mask_hi = mask_hi;
    r.source_url_hash = source_url_hash;
    r.proof_hash = proof_hash;
    r.submitted_at = clock.unix_timestamp;
    r.forwarded = false;
    r.forwarded_lamports = 0;
    r.forwarded_at = 0;
    r.reserved = [0u8; 32];
    emit!(PairResultSubmitted {
        mint_lo: lo,
        mint_hi: hi,
        record_date,
        winner,
        signers_mask_lo: mask_lo,
        signers_mask_hi: mask_hi,
        source_url_hash,
        proof_hash,
        submitter: ctx.accounts.payer.key(),
    });
    Ok(())
}

// ---------------------------------------------------------------------------------------------------------------------------------
// the crank gate (crank_buyback)
// ---------------------------------------------------------------------------------------------------------------------------------

/// crank_buyback on a PAIRED coin: the period's PairResult decides. LOST → ForwardRequired; WON / DRAW → crank normally. No result:
/// PairResultPending until PAIR_RESULT_GRACE_SECS after the reading's submission, then crank normally (returns true = "missing").
/// Unpaired and provisional coins pass straight through.
pub fn crank_pair_gate(c: &TokenConfig, r: &Reading, link: Option<&AccountInfo>, result: Option<&AccountInfo>, now: i64) -> Result<bool> {
    if c.pair_state != PAIR_STATE_PAIRED {
        return Ok(false);
    }
    let link = link.ok_or(BurnError::PairMismatch)?;
    require_keys_eq!(*link.key, pair_link_address(&c.mint).0, BurnError::PairMismatch);
    let pl = read_link(link)?.ok_or(BurnError::PairMismatch)?;
    require!(pl.paired, BurnError::NotPaired);
    let res = result.ok_or(BurnError::InvalidPairResult)?;
    require_keys_eq!(*res.key, pair_result_address(&c.mint, &pl.pair_mint, r.record_date).0, BurnError::InvalidPairResult);
    if res.owner == &crate::ID && !res.data_is_empty() {
        let data = res.try_borrow_data()?;
        let pr = PairResult::try_deserialize(&mut &data[..])?;
        require!(pr.record_date == r.record_date, BurnError::InvalidPairResult);
        match pr.result_for(&c.mint) {
            PAIR_RESULT_LOST => err!(BurnError::ForwardRequired),
            PAIR_RESULT_WON | PAIR_RESULT_DRAW => Ok(false),
            _ => err!(BurnError::InvalidPairResult),
        }
    } else {
        require!(now >= r.submitted_at.saturating_add(PAIR_RESULT_GRACE_SECS), BurnError::PairResultPending);
        Ok(true)
    }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// forward_to_winner
// ---------------------------------------------------------------------------------------------------------------------------------

/// PERMISSIONLESS (the cranker allowlist of crank_buyback applies while the pre-audit cap is in force). For the period
/// `record_date` whose PairResult names `winner_config` the winner:
///   pool   = loser fee PDA lamports − reserve + WSOL in the loser fee PDA's WSOL account, capped at the burn-pool cap while in force
///   amount = pool × (1 − (1 − f)^units)   (the loser's own rule and its reading's units: what it would have spent had it won;
///            0 if under its floor; a one-shot rule with f = 100 % forwards the whole pool basis)
/// moved loser fee PDA → winner fee PDA (SOL above the reserve first, then WSOL token → the winner fee PDA's WSOL account). The loser's
/// reading is processed with OUTCOME_FORWARDED (it must be next in the loser's queue) and the PairResult records the forward. A
/// second call for a forwarded period is a no-op. Both coins must be live (verified pools): a voided / unregistered side forwards
/// nothing.
#[event_cpi]
#[derive(Accounts)]
#[instruction(record_date: u32)]
pub struct ForwardToWinner<'info> {
    pub cranker: Signer<'info>,
    /// CHECK: the platform PDA (seeds-checked) — its cap and cranker allowlist, as for crank_buyback.
    #[account(seeds = [PLATFORM_SEED], bump)]
    pub platform: UncheckedAccount<'info>,
    #[account(mut, seeds = [CONFIG_SEED, loser_config.mint.as_ref()], bump = loser_config.bump)]
    pub loser_config: Box<Account<'info, TokenConfig>>,
    #[account(mut, seeds = [FEE_SEED, loser_config.mint.as_ref()], bump = loser_config.fee_bump)]
    pub loser_fee_vault: SystemAccount<'info>,
    /// CHECK: ATA(loser fee PDA, WSOL) — address-checked; may not exist (then it holds nothing).
    #[account(mut, address = get_associated_token_address(&loser_fee_vault.key(), &NATIVE_MINT) @ BurnError::FeeAccountTampered)]
    pub loser_fee_wsol: UncheckedAccount<'info>,
    #[account(mut, seeds = [READING_SEED, loser_config.key().as_ref(), &record_date.to_le_bytes()], bump = loser_reading.bump)]
    pub loser_reading: Box<Account<'info, Reading>>,
    #[account(seeds = [CONFIG_SEED, winner_config.mint.as_ref()], bump = winner_config.bump)]
    pub winner_config: Box<Account<'info, TokenConfig>>,
    #[account(mut, seeds = [FEE_SEED, winner_config.mint.as_ref()], bump = winner_config.fee_bump)]
    pub winner_fee_vault: SystemAccount<'info>,
    /// CHECK: ATA(winner fee PDA, WSOL) — address-checked; must exist only when WSOL is forwarded.
    #[account(mut, address = get_associated_token_address(&winner_fee_vault.key(), &NATIVE_MINT) @ BurnError::FeeAccountTampered)]
    pub winner_fee_wsol: UncheckedAccount<'info>,
    /// The winner's reading for the same period (it exists: both coins read the period).
    #[account(seeds = [READING_SEED, winner_config.key().as_ref(), &record_date.to_le_bytes()], bump = winner_reading.bump)]
    pub winner_reading: Box<Account<'info, Reading>>,
    /// The period's PairResult (address checked in the handler: ["pair_result", mint_lo, mint_hi, record_date]).
    #[account(mut)]
    pub pair_result: Box<Account<'info, PairResult>>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    /// CHECK: address-checked: the SPL Memo program.
    #[account(address = MEMO_PROGRAM_ID)]
    pub memo_program: UncheckedAccount<'info>,
}

fn token_amount_or_zero(acc: &AccountInfo) -> Result<u64> {
    use anchor_lang::solana_program::program_pack::Pack;
    if acc.owner != &token::ID || acc.data_is_empty() {
        return Ok(0);
    }
    Ok(spl_token::state::Account::unpack(&acc.try_borrow_data()?).map_err(|_| BurnError::FeeAccountTampered)?.amount)
}

pub fn handle_forward_to_winner(ctx: Context<ForwardToWinner>, record_date: u32) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let a = &ctx.accounts;
    let (lm, wm) = (a.loser_config.mint, a.winner_config.mint);
    let pr = &a.pair_result;
    require_keys_eq!(pr.key(), pair_result_address(&lm, &wm, record_date).0, BurnError::InvalidPairResult);
    let (lo, hi) = pair_order(&lm, &wm);
    require!(pr.mint_lo == lo && pr.mint_hi == hi && pr.record_date == record_date, BurnError::InvalidPairResult);
    require!(!pr.is_draw() && pr.winner == wm, BurnError::NotWinner);
    // Idempotent: the period was forwarded already.
    if a.loser_reading.processed && a.loser_reading.outcome == OUTCOME_FORWARDED {
        return Ok(());
    }
    // The PairResult proves the pairing at submission; it is immutable, so it is re-checked here only through the configs' state.
    require!(a.loser_config.pair_state == PAIR_STATE_PAIRED && a.winner_config.pair_state == PAIR_STATE_PAIRED, BurnError::NotPaired);
    require!(a.loser_config.rule.mode == MODE_BUYBACK && a.winner_config.rule.mode == MODE_BUYBACK, BurnError::WrongMode);
    require!(a.loser_config.pool_verified && a.winner_config.pool_verified, BurnError::PairSideNotLive);
    require!(a.winner_reading.config == a.winner_config.key() && a.winner_reading.record_date == record_date, BurnError::InvalidPairResult);
    require_next_in_line(&a.loser_config, &a.loser_reading)?;
    let crankers = crankers_in_force(&a.platform.to_account_info(), now)?;
    require!(crankers.is_empty() || crankers.contains(&a.cranker.key()), BurnError::CrankerNotAllowed);

    let rule = a.loser_config.rule;
    let units = a.loser_reading.units;
    let wsol_avail = token_amount_or_zero(&a.loser_fee_wsol.to_account_info())?;
    if wsol_avail > 0 {
        require_fee_token_account_intact(&a.loser_fee_wsol.to_account_info(), &a.loser_fee_vault.key(), &NATIVE_MINT, false)?;
    }
    let sol_avail = a.loser_fee_vault.lamports().saturating_sub(rule.reserve_lamports);
    let pool_actual = sol_avail.checked_add(wsol_avail).ok_or(BurnError::MathOverflow)?;
    let cap = active_cap(&a.platform.to_account_info(), now)?;
    let pool_before = match cap {
        Some(c) if pool_actual > c => c,
        _ => pool_actual,
    };
    let rule_spend = math::buyback_spend(pool_before, units, rule.fraction_per_unit_bps).map_err(|_| BurnError::MathOverflow)?;
    let amount = if rule_spend < rule.floor_lamports { 0 } else { rule_spend };
    let sol_part = amount.min(sol_avail);
    let wsol_part = amount - sol_part;

    let fee_bump = a.loser_config.fee_bump;
    let fee_seeds: &[&[u8]] = &[FEE_SEED, lm.as_ref(), &[fee_bump]];
    if sol_part > 0 {
        system_program::transfer(
            CpiContext::new_with_signer(
                system_program::ID,
                system_program::Transfer { from: a.loser_fee_vault.to_account_info(), to: a.winner_fee_vault.to_account_info() },
                &[fee_seeds],
            ),
            sol_part,
        )?;
        require!(a.loser_fee_vault.lamports() >= rule.reserve_lamports, BurnError::ReserveBreached);
    }
    if wsol_part > 0 {
        require_fee_token_account_intact(&a.winner_fee_wsol.to_account_info(), &a.winner_fee_vault.key(), &NATIVE_MINT, false)?;
        token::transfer(
            CpiContext::new_with_signer(
                token::ID,
                token::Transfer { from: a.loser_fee_wsol.to_account_info(), to: a.winner_fee_wsol.to_account_info(), authority: a.loser_fee_vault.to_account_info() },
                &[fee_seeds],
            ),
            wsol_part,
        )?;
    }

    let m = memo::format_forward(a.loser_config.memo_prefix_str(), &lm, &wm, record_date, amount);
    memo::emit_memo(&a.memo_program.to_account_info(), &m)?;

    let r = &mut ctx.accounts.loser_reading;
    r.processed = true;
    r.outcome = OUTCOME_FORWARDED;
    r.processed_at = now;
    r.pool_lamports = pool_before;
    r.pool_actual_lamports = pool_actual;
    r.rule_spend_lamports = amount;
    r.spent_lamports = 0;
    r.got = 0;
    r.burned = 0;
    ctx.accounts.loser_config.crank_cursor = record_date;
    let p = &mut ctx.accounts.pair_result;
    p.forwarded = true;
    p.forwarded_lamports = amount;
    p.forwarded_at = now;
    emit_cpi!(ForwardedToWinner {
        loser_mint: lm,
        winner_mint: wm,
        record_date,
        units,
        pool_lamports: pool_before,
        lamports: amount,
        sol_lamports: sol_part,
        wsol_lamports: wsol_part,
        cranker: ctx.accounts.cranker.key(),
    });
    Ok(())
}
