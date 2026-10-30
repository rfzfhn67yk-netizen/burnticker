//! LAUNCHPAD-PATH §40 (owner decision 2026-10-11): every pair is WINNER TAKES THE BURN. At each result the loser's fuel for that
//! result — exactly the lamports its own rule would have spent had it won — moves from the loser's fee PDA to the winner's fee PDA,
//! and the winner's ordinary cranks buy and burn the winner's coin. The loser's supply is untouched; nobody is paid.
//!
//!   pairing        TokenConfig.pair_state + PairLink ["pair_link", mint]: written by initialize_token when the creator names the
//!                  partner mint (provisional until the partner's initialize_token names this mint back within PAIRING_WINDOW_SECS;
//!                  an unanswered provisional coin is a plain coin for good), or by link_pair when a pair_curve Pair holds both mints
//!                  (policy 2; register_pair_pool requires it, or an unlink). r3: both coins must share ONE attester set and quorum
//!                  (M-1), a LaunchLab pair carries its locked voidBy on both coins (RN-2), and periods already read stay unpaired.
//!   result         submit_pair_result: one PairResult per (pair, period), a quorum of EACH coin's attesters over the pair message
//!                  (attest.rs canonical_pair_message) — with the one common set, one set of signatures; winner = a mint, or
//!                  Pubkey::default() for a draw. Append-only.
//!   unlink         unlink_pair on terminal evidence only (Pair voided, a side refunding, a LaunchLab voidBy ended without both pools).
//!   forward        forward_to_winner: processes the LOSER's reading for that period (next in its queue) by moving
//!                  buyback_spend(spendable, units, f) from its fee PDA to the winner's (SOL first, then WSOL), marks the
//!                  reading OUTCOME_FORWARDED and records the forward on the PairResult. Idempotent. Only inside the 72 h window (r3).
//!   crank gate     crank_buyback on a paired coin needs the period's PairResult: LOST refuses (ForwardRequired), WON / DRAW proceed;
//!                  no result yet refuses (PairResultPending) until PAIR_RESULT_GRACE_SECS after the reading, then it burns as an
//!                  unpaired coin would (a missing result never wedges the queue; that period can no longer be forwarded).
//!
//! The winner's own crank for the period is never blocked by the forward: the forwarded lamports simply join its fee PDA and later
//! cranks spend them under the usual guards (TWAP, min-out, floor).

use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::associated_token::get_associated_token_address;
use anchor_spl::token::{self, spl_token, Token};

use crate::attest::{attested_mask, canonical_pair_message};
use crate::constants::*;
use crate::error::BurnError;
use crate::events::{ForwardedToWinner, PairLinked, PairResultSubmitted, PairUnlinked};
use crate::guards::require_fee_token_account_intact;
use crate::instructions::crank_common::require_next_in_line;
use crate::math;
use crate::memo;
use crate::pair_curve::PairView;
use crate::instructions::burn_target::side_live;
use crate::state::{pair_link_address, pair_order, pair_result_address, PairLink, PairResult, Reading, TokenConfig};

// ---------------------------------------------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------------------------------------------

/// Creates a program-owned PDA account (Anchor `init` semantics: an address someone pre-funded is topped up, allocated, assigned).
pub(crate) fn create_pda<'info>(payer: &AccountInfo<'info>, acc: &AccountInfo<'info>, _system: &AccountInfo<'info>, space: usize, seeds: &[&[u8]]) -> Result<()> {
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

/// sha256(PAIR_ATTESTERS_DOMAIN ‖ quorum ‖ (kind ‖ key) per attester).
pub fn set_hash(quorum: u8, attesters: &[crate::state::AttesterEntry]) -> [u8; 32] {
    let mut parts: Vec<u8> = Vec::with_capacity(1 + MAX_ATTESTERS * 33);
    parts.push(quorum);
    for a in attesters {
        parts.push(a.kind);
        parts.extend_from_slice(a.key.as_ref());
    }
    solana_sha256_hasher::hashv(&[PAIR_ATTESTERS_DOMAIN, &parts]).to_bytes()
}

/// The coin's CURRENT attester set and quorum, hashed (set_hash) — r3 M-1: pairing requires the two coins' hashes to be equal; the
/// PairLinks record it.
pub fn attester_set_hash(c: &TokenConfig) -> [u8; 32] {
    set_hash(c.quorum, c.attester_slice())
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
    attesters: [u8; 32],
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
        attester_set_hash: attesters,
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
    /// The partner's PairLink address — ALWAYS passed with pair_mint (pair-forward blind review L-3): empty = this coin is first;
    /// a link naming this mint = the partner was first (its TokenConfig is then required and both coins pair here).
    pub partner_link: Option<&'a AccountInfo<'info>>,
    pub partner_config: Option<&'a mut Account<'info, TokenConfig>>,
}

/// Writes this coin's PairLink; returns the coin's pair_state. Pairs the two coins when the partner already named this mint
/// (inside its window); otherwise the coin is provisional until the partner answers (or for good, as a plain coin).
/// Policy-2 (pair_curve) coins are paired only by link_pair, with the Pair as the witness.
/// Pair-forward r3: the two coins must share one attester set and quorum (M-1) and name the same voidBy (RN-2); periods the first
/// coin already read while provisional stay unpaired (pair_after_date on both coins).
#[allow(clippy::too_many_arguments)]
pub fn pair_at_initialize(
    a: InitPairAccounts,
    mint: &Pubkey,
    mode: u8,
    pool_policy: u8,
    now: i64,
    void_by: u32,
    attesters: [u8; 32],
) -> Result<(u8, PairLink, u32)> {
    let pair_mint = *a.pair_mint.key;
    require!(mode == MODE_BUYBACK && pool_policy != POOL_POLICY_PAIR_CURVE, BurnError::InvalidPairMint);
    require!(pair_mint != *mint && pair_mint != Pubkey::default(), BurnError::InvalidPairMint);
    require!(math::valid_date(void_by) && void_by >= math::utc_date(now), BurnError::InvalidPairVoidBy);
    // L-3: the partner's PairLink address is mandatory, so a second coin can never "forget" it and leave both coins provisional.
    let pl = a.partner_link.ok_or(BurnError::PairMismatch)?;
    require_keys_eq!(*pl.key, pair_link_address(&pair_mint).0, BurnError::PairMismatch);
    match read_link(pl)? {
        Some(mut theirs) => {
            // The partner initialized first: it must have named THIS mint, still be waiting, and be inside its window.
            require!(theirs.mint == pair_mint && theirs.pair_mint == *mint, BurnError::PairMismatch);
            require!(!theirs.paired && now <= theirs.pairing_deadline, BurnError::PairingClosed);
            let pc = a.partner_config.ok_or(BurnError::PairMismatch)?;
            require!(pc.mint == pair_mint && pc.pair_state == PAIR_STATE_PROVISIONAL, BurnError::PairMismatch);
            // r3 M-1: one attester set for the pair — a result signed by it is signed by both sides.
            require!(attester_set_hash(pc) == attesters, BurnError::PairAttestersDiffer);
            // r3 RN-2: both coins carry the same locked voidBy.
            require!(pc.pair_void_by == void_by, BurnError::InvalidPairVoidBy);
            let ours = new_link(a.payer, a.pair_link, a.system, mint, &pair_mint, true, PAIR_WITNESS_INITIALIZE, now, attesters)?;
            theirs.paired = true;
            theirs.paired_at = now;
            theirs.attester_set_hash = attesters;
            write_link(pl, &theirs)?;
            pc.pair_state = PAIR_STATE_PAIRED;
            // r3 (RN-1 second route): what the first coin read while provisional stays unpaired history.
            pc.pair_after_date = pc.last_record_date;
            Ok((PAIR_STATE_PAIRED, ours, pc.pair_after_date))
        }
        None => {
            let ours = new_link(a.payer, a.pair_link, a.system, mint, &pair_mint, false, PAIR_WITNESS_INITIALIZE, now, attesters)?;
            Ok((PAIR_STATE_PROVISIONAL, ours, 0))
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// link_pair: the pair_curve Pair is the witness (policy 2)
// ---------------------------------------------------------------------------------------------------------------------------------

/// PERMISSIONLESS, idempotent. Pairs the two coins of a pair_curve Pair (policy-2 TokenConfigs; the Pair neither Voided nor with a
/// refunding side): writes or completes both PairLinks and sets both configs PAIRED. Refuses if either coin is already linked to another
/// partner, or (pair-forward r3 M-1) if the two coins do not share one attester set and quorum.
/// Readings that already exist (pair-forward r3, RN-1 second route — r2 refused them, which froze a coin read before its link): the
/// periods dated on or before the later of the two coins' last readings stay UNPAIRED history (pair_after_date): the crank gate passes
/// them and no PairResult may name them, so nothing processed under the unpaired rule is ever re-interpreted (r2 L-1). The same rule
/// lets a pair re-link after unlink_pair (whose evidence is terminal, so in practice this only matters if evidence ever widens).
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
    require!(pair.status != PAIR_CURVE_STATUS_VOIDED && !pair.refunding[0] && !pair.refunding[1], BurnError::PairTerminal);
    let (ma, mb) = (ctx.accounts.config_a.mint, ctx.accounts.config_b.mint);
    require!(ma == pair.mints[0] && mb == pair.mints[1], BurnError::PairMismatch);
    for c in [&ctx.accounts.config_a, &ctx.accounts.config_b] {
        require!(c.rule.mode == MODE_BUYBACK && c.rule.pool_policy == POOL_POLICY_PAIR_CURVE, BurnError::WrongPoolPolicy);
    }
    let already = ctx.accounts.config_a.pair_state == PAIR_STATE_PAIRED
        && ctx.accounts.config_b.pair_state == PAIR_STATE_PAIRED
        && read_link(&ctx.accounts.link_a.to_account_info())?.is_some_and(|l| l.paired && l.pair_mint == mb)
        && read_link(&ctx.accounts.link_b.to_account_info())?.is_some_and(|l| l.paired && l.pair_mint == ma);
    if already {
        return Ok(());
    }
    // r3 M-1: one attester set for the pair.
    let common = attester_set_hash(&ctx.accounts.config_a);
    require!(attester_set_hash(&ctx.accounts.config_b) == common, BurnError::PairAttestersDiffer);
    let hashes = [common, common];
    // r3: periods already read stay unpaired history.
    let after = ctx.accounts.config_a.last_record_date.max(ctx.accounts.config_b.last_record_date);
    let now = Clock::get()?.unix_timestamp;
    let (payer, system) = (ctx.accounts.payer.to_account_info(), ctx.accounts.system_program.to_account_info());
    let mut linked = Vec::new();
    for (i, (mint, other, acc)) in [(ma, mb, ctx.accounts.link_a.to_account_info()), (mb, ma, ctx.accounts.link_b.to_account_info())].into_iter().enumerate() {
        require_keys_eq!(*acc.key, pair_link_address(&mint).0, BurnError::PairMismatch);
        match read_link(&acc)? {
            Some(mut l) => {
                require!(l.pair_mint == other, BurnError::PairingClosed);
                if !l.paired {
                    l.paired = true;
                    l.paired_at = now;
                    l.attester_set_hash = hashes[i];
                    write_link(&acc, &l)?;
                    linked.push(l);
                }
            }
            None => linked.push(new_link(&payer, &acc, &system, &mint, &other, true, PAIR_WITNESS_PAIR_CURVE, now, hashes[i])?),
        }
    }
    for c in [&mut ctx.accounts.config_a, &mut ctx.accounts.config_b] {
        c.pair_state = PAIR_STATE_PAIRED;
        c.pair_after_date = after;
    }
    for l in linked {
        emit_cpi!(PairLinked { mint: l.mint, pair_mint: l.pair_mint, paired: true, witness: l.witness, pairing_deadline: l.pairing_deadline });
    }
    Ok(())
}

// ---------------------------------------------------------------------------------------------------------------------------------
// submit_pair_result
// ---------------------------------------------------------------------------------------------------------------------------------

/// PERMISSIONLESS submission (Ed25519SigVerify in the same transaction, as for submit_reading). Configs in byte order of their mints.
/// Who must sign (pair-forward r3 M-1): EVERY result — win or draw — needs both coins' quorums. Pairing requires the two coins to share
/// one attester set and quorum, and a paired coin's set changes only with the partner's quorum co-signing
/// (apply_paired_attester_change applies the same set to BOTH coins at once, re-check P3-2), so one set of signatures meets both: no
/// side's attesters can sign its wins and withhold its losses.
/// (Residual: whoever holds that common quorum decides every result; on Burnticker that is the operator keeper alone, quorum 1.)
/// What a WIN needs on chain (H-1(a), L-2): both coins' readings for the date exist (reading_lo / reading_hi) and the loser's is still
/// unprocessed — so forward_to_winner can always run. Pools are NOT required: a side without a verified pool makes the forward a
/// 0-lamport FORWARDED (the loser's fuel stays with the loser for later periods, never burned for a period it lost). Any result: the date is on or
/// after the day the coins were paired, and after pair_after_date (periods read before the pairing stay unpaired). Re-submitting the same result is a no-op (after the signature check, I-2); a different one is
/// refused. PairResultSubmitted is a plain log event (emit!), so a win signed by one quorum fits a legacy transaction.
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
    /// CHECK: config_lo's Reading for record_date (address-checked; required for a win, may be omitted for a draw).
    pub reading_lo: Option<UncheckedAccount<'info>>,
    /// CHECK: config_hi's Reading for record_date (address-checked; required for a win, may be omitted for a draw).
    pub reading_hi: Option<UncheckedAccount<'info>>,
}

/// Both coins paired to each other.
fn require_paired(a: &TokenConfig, b: &TokenConfig, la: &PairLink, lb: &PairLink) -> Result<()> {
    require!(a.pair_state == PAIR_STATE_PAIRED && b.pair_state == PAIR_STATE_PAIRED, BurnError::NotPaired);
    require!(la.paired && lb.paired && la.pair_mint == b.mint && lb.pair_mint == a.mint, BurnError::NotPaired);
    Ok(())
}

/// The Reading of `config` for `date` at `acc` (address-checked), if it exists.
fn read_reading(acc: Option<&AccountInfo>, config: &Pubkey, date: u32) -> Result<Option<Reading>> {
    let Some(acc) = acc else { return Ok(None) };
    let expected = Pubkey::find_program_address(&[READING_SEED, config.as_ref(), &date.to_le_bytes()], &crate::ID).0;
    require_keys_eq!(*acc.key, expected, BurnError::PairResultNotServable);
    if acc.owner != &crate::ID || acc.data_is_empty() {
        return Ok(None);
    }
    let data = acc.try_borrow_data()?;
    Ok(Some(Reading::try_deserialize(&mut &data[..])?))
}

pub fn handle_submit_pair_result(ctx: Context<SubmitPairResult>, record_date: u32, winner: Pubkey, source_url_hash: [u8; 32], proof_hash: [u8; 32]) -> Result<()> {
    let a = &ctx.accounts;
    let (lo, hi) = (a.config_lo.mint, a.config_hi.mint);
    require!(lo.to_bytes() < hi.to_bytes(), BurnError::PairOrder);
    require_paired(&a.config_lo, &a.config_hi, &a.link_lo, &a.link_hi)?;
    require!(math::valid_date(record_date), BurnError::InvalidDate);
    let clock = Clock::get()?;
    require!(record_date <= math::utc_date(clock.unix_timestamp), BurnError::FutureDate);
    require!(winner == lo || winner == hi || winner == Pubkey::default(), BurnError::InvalidWinner);
    require!(source_url_hash != [0u8; 32], BurnError::InvalidValue);
    // L-2: never a period from before the pairing.
    let paired_on = math::utc_date(a.link_lo.paired_at.max(a.link_hi.paired_at));
    require!(record_date >= paired_on, BurnError::PairDateBeforePairing);
    // r3: periods with readings from before the pairing stay unpaired.
    require!(record_date > a.config_lo.pair_after_date.max(a.config_hi.pair_after_date), BurnError::PairPeriodUnpaired);

    // Signatures (checked before the idempotent return too: I-2).
    let msg = canonical_pair_message(&crate::ID, &lo, &hi, record_date, &winner, &source_url_hash, &proof_hash);
    let ix = a.instructions.to_account_info();
    let mask_lo = attested_mask(&ix, msg.as_bytes(), a.config_lo.attester_slice())?;
    let mask_hi = attested_mask(&ix, msg.as_bytes(), a.config_hi.attester_slice())?;
    let ok_lo = mask_lo.count_ones() >= a.config_lo.quorum as u32;
    let ok_hi = mask_hi.count_ones() >= a.config_hi.quorum as u32;
    // r3 M-1: both quorums, whatever the result (one common set at pairing → the same signatures).
    require!(ok_lo && ok_hi, BurnError::QuorumNotMet);
    if a.pair_result.record_date != 0 {
        require!(a.pair_result.winner == winner, BurnError::ConflictingPairResult);
        return Ok(());
    }
    if winner != Pubkey::default() {
        // H-1(a): forward_to_winner must be able to run — both readings exist and the loser's is unprocessed. (A dead / unverified pool
        // is handled by the forward itself: 0 lamports, the reading still processed.)
        let r_lo = read_reading(a.reading_lo.as_ref().map(|x| x.as_ref()), &a.config_lo.key(), record_date)?;
        let r_hi = read_reading(a.reading_hi.as_ref().map(|x| x.as_ref()), &a.config_hi.key(), record_date)?;
        let (Some(r_lo), Some(r_hi)) = (r_lo, r_hi) else {
            return err!(BurnError::PairResultNotServable);
        };
        let loser_reading = if winner == hi { &r_lo } else { &r_hi };
        require!(!loser_reading.processed, BurnError::PairResultNotServable);
    }

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

/// What crank_pair_gate decided when the crank may proceed.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum PairGate {
    /// Unpaired / provisional coin, or the coin WON or drew the period.
    Proceed,
    /// No result PAIR_RESULT_GRACE_SECS after the reading: crank as unpaired (PairResultMissing).
    ResultMissing,
    /// The coin LOST but no forward landed PAIR_RESULT_GRACE_SECS after the reading: crank as unpaired (PairForwardMissing, H-1(c)).
    ForwardMissing,
}

/// crank_buyback on a PAIRED coin: the period's PairResult decides. WON / DRAW → crank normally. LOST → ForwardRequired until
/// PAIR_RESULT_GRACE_SECS after the reading's submission, then (no forward having landed — a forward processes the reading) crank as
/// unpaired, so no precondition of the forward can wedge the queue (pair-forward blind review H-1(c)). No result: PairResultPending
/// for the same time, then crank as unpaired. Unpaired, provisional and unlinked coins pass straight through, and so do periods from
/// before the pairing (r3: dated on or before pair_after_date, or before the pairing day — no result can ever name them).
pub fn crank_pair_gate(c: &TokenConfig, r: &Reading, link: Option<&AccountInfo>, result: Option<&AccountInfo>, now: i64) -> Result<PairGate> {
    if c.pair_state != PAIR_STATE_PAIRED {
        return Ok(PairGate::Proceed);
    }
    let link = link.ok_or(BurnError::PairMismatch)?;
    require_keys_eq!(*link.key, pair_link_address(&c.mint).0, BurnError::PairMismatch);
    let pl = read_link(link)?.ok_or(BurnError::PairMismatch)?;
    require!(pl.paired, BurnError::NotPaired);
    // r3: a period from before the pairing (read before it, or dated before the pairing day) can never have a result — unpaired history.
    if r.record_date <= c.pair_after_date || r.record_date < math::utc_date(pl.paired_at) {
        return Ok(PairGate::Proceed);
    }
    let res = result.ok_or(BurnError::InvalidPairResult)?;
    require_keys_eq!(*res.key, pair_result_address(&c.mint, &pl.pair_mint, r.record_date).0, BurnError::InvalidPairResult);
    let timed_out = now >= r.submitted_at.saturating_add(PAIR_RESULT_GRACE_SECS);
    if res.owner == &crate::ID && !res.data_is_empty() {
        let data = res.try_borrow_data()?;
        let pr = PairResult::try_deserialize(&mut &data[..])?;
        require!(pr.record_date == r.record_date, BurnError::InvalidPairResult);
        match pr.result_for(&c.mint) {
            PAIR_RESULT_LOST if timed_out => Ok(PairGate::ForwardMissing),
            PAIR_RESULT_LOST => err!(BurnError::ForwardRequired),
            PAIR_RESULT_WON | PAIR_RESULT_DRAW => Ok(PairGate::Proceed),
            _ => err!(BurnError::InvalidPairResult),
        }
    } else {
        require!(timed_out, BurnError::PairResultPending);
        Ok(PairGate::ResultMissing)
    }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// forward_to_winner
// ---------------------------------------------------------------------------------------------------------------------------------

/// PERMISSIONLESS. For the period
/// `record_date` whose PairResult names `winner_config` the winner:
///   pool   = loser fee PDA lamports − reserve + the loser fee PDA's WSOL (synced: lamports − rent, like the crank — L-4), minus the
///            spend it still owes earlier periods (carried_spend_lamports, r3 RI-4); no platform cap (owner decision 2026-10-25)
///   amount = pool × (1 − (1 − f)^units)   (the loser's own rule and its reading's units: what it would have spent had it won;
///            0 if under its floor; a one-shot rule with f = 100 % forwards the whole pool basis)
///            and 0 when either coin is not live (pair-forward blind review H-1(b): a voided / unregistered / switched-away side
///            forwards nothing — and never blocks the loser's queue). Live (round-5 review R5-9, burn_target::side_live): its own pool
///            verified, or a target coin whose BurnTarget is pinned (it cranks on the target's pool before it has a pool of its own);
///            each side's BurnTarget account is passed (Option: required only for a target coin without its own verified pool)
/// moved loser fee PDA → winner fee PDA (SOL above the reserve first, then WSOL token → the winner fee PDA's WSOL account). The loser's
/// reading is processed with OUTCOME_FORWARDED (it must be next in the loser's queue) and the PairResult records the forward; the memo
/// is written every time (lamports=0 included). The winner's reading is not needed (H-1(b)). A second call is a no-op. Refused once
/// PAIR_RESULT_GRACE_SECS have passed since the loser's reading was submitted (r3 RI-1): the period then burns as unpaired.
#[event_cpi]
#[derive(Accounts)]
#[instruction(record_date: u32)]
pub struct ForwardToWinner<'info> {
    pub cranker: Signer<'info>,
    /// CHECK: the platform PDA (seeds-checked); unused since the cap and the cranker allowlist were removed (2026-10-25).
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
    /// The period's PairResult (address checked in the handler: ["pair_result", mint_lo, mint_hi, record_date]).
    #[account(mut)]
    pub pair_result: Box<Account<'info, PairResult>>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    /// CHECK: address-checked: the SPL Memo program.
    #[account(address = MEMO_PROGRAM_ID)]
    pub memo_program: UncheckedAccount<'info>,
    /// CHECK: round-5 review R5-9: the loser's / the winner's BurnTarget ["burn_target", mint] (address-checked in side_live). Needed
    /// only for a target coin whose own pool is not verified (refused without it: BurnTargetAccountMissing); otherwise ignored.
    pub loser_burn_target: Option<UncheckedAccount<'info>>,
    /// CHECK: as loser_burn_target, for the winner.
    pub winner_burn_target: Option<UncheckedAccount<'info>>,
}

/// A native WSOL account's synced balance (lamports − its rent reserve), as the crank measures it; 0 if the account does not exist.
pub(crate) fn wsol_synced_or_zero(acc: &AccountInfo) -> Result<u64> {
    use anchor_lang::solana_program::program_pack::Pack;
    if acc.owner != &token::ID || acc.data_is_empty() {
        return Ok(0);
    }
    let t = spl_token::state::Account::unpack(&acc.try_borrow_data()?).map_err(|_| BurnError::FeeAccountTampered)?;
    let reserve: Option<u64> = t.is_native.into();
    let reserve = reserve.ok_or(BurnError::FeeAccountTampered)?;
    Ok(acc.lamports().saturating_sub(reserve))
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
    // Pair-forward round-3 re-check P3-I1: after unlink_pair both coins are plain — a result recorded before the unlink no longer
    // forwards, so the loser's own crank burns that period (the crank gate passes UNLINKED coins).
    require!(a.loser_config.pair_state == PAIR_STATE_PAIRED && a.winner_config.pair_state == PAIR_STATE_PAIRED, BurnError::NotPaired);
    require!(a.loser_config.rule.mode == MODE_BUYBACK && a.winner_config.rule.mode == MODE_BUYBACK, BurnError::WrongMode);
    require_next_in_line(&a.loser_config, &a.loser_reading)?;
    // r3 RI-1: the 72 h time-out ends the forward window — from then on the period belongs to the loser's own crank (no race).
    require!(now < a.loser_reading.submitted_at.saturating_add(PAIR_RESULT_GRACE_SECS), BurnError::ForwardWindowClosed);
    // H-1(b): a side without a verified pool forwards nothing — the reading is still processed. (Unlinked: refused above, P3-I1.)
    // Round-5 review R5-9: a target coin with a pinned BurnTarget is live before its own pool is verified.
    let live = side_live(&a.loser_config, a.loser_burn_target.as_ref().map(|x| x.as_ref()))?
        && side_live(&a.winner_config, a.winner_burn_target.as_ref().map(|x| x.as_ref()))?;

    let rule = a.loser_config.rule;
    let units = a.loser_reading.units;
    let fee_bump = a.loser_config.fee_bump;
    let fee_seeds: &[&[u8]] = &[FEE_SEED, lm.as_ref(), &[fee_bump]];
    let wsol_acc = a.loser_fee_wsol.to_account_info();
    let wsol_avail = wsol_synced_or_zero(&wsol_acc)?;
    if wsol_avail > 0 {
        require_fee_token_account_intact(&wsol_acc, &a.loser_fee_vault.key(), &NATIVE_MINT, false)?;
    }
    let sol_avail = a.loser_fee_vault.lamports().saturating_sub(rule.reserve_lamports);
    let pool_actual = sol_avail.checked_add(wsol_avail).ok_or(BurnError::MathOverflow)?;
    // r3 RI-4: lamports the loser still owes its own earlier periods (carried_spend_lamports, review H-1) are not this period's fuel —
    // they stay in its fee PDA for the crank that owes them.
    let basis = pool_actual.saturating_sub(a.loser_config.carried_spend_lamports);
    // Owner decision 2026-10-25: no platform cap; the rule applies to the whole basis.
    let pool_before = basis;
    let rule_spend = math::buyback_spend(pool_before, units, rule.fraction_per_unit_bps).map_err(|_| BurnError::MathOverflow)?;
    let amount = if !live || rule_spend < rule.floor_lamports { 0 } else { rule_spend };
    let sol_part = amount.min(sol_avail);
    let wsol_part = amount - sol_part;

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
        // L-4: fold stray lamports into the WSOL balance first, so the token amount matches the basis measured above.
        token::sync_native(CpiContext::new(token::ID, token::SyncNative { account: wsol_acc.clone() }))?;
        token::transfer(
            CpiContext::new_with_signer(
                token::ID,
                token::Transfer { from: wsol_acc.clone(), to: a.winner_fee_wsol.to_account_info(), authority: a.loser_fee_vault.to_account_info() },
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

// ---------------------------------------------------------------------------------------------------------------------------------
// unlink_pair (pair-forward blind review M-2)
// ---------------------------------------------------------------------------------------------------------------------------------

/// PERMISSIONLESS. Undoes a pairing on TERMINAL on-chain evidence only (pair-forward r3 RN-1/RN-2):
///   UNLINK_PAIR_VOIDED       the pair_curve Pair holding both mints is Voided (pass `pair`);
///   UNLINK_SIDE_REFUNDING    one side of that Pair is refunding (its pool can never come; the other side may still graduate);
///   UNLINK_VOID_BY_PASSED    a LaunchLab pair (paired by initialize_token): its locked voidBy day (TokenConfig.pair_void_by) has ended
///                            (UTC) and a coin still has no verified pool.
/// Never while a pair_curve Pair is Open or Graduating without a refunding side — however long its curves take (r2's "no verified
/// pool 30 days after pairing" is gone). A policy-2 coin is unlinked only with its Pair as evidence. Sets both configs to
/// PAIR_STATE_UNLINKED (pair_unlinked_at = now) and closes both PairLinks (their rent to each coin's own fee PDA). Afterwards both are
/// plain coins (the crank gate passes them through; no new result can be recorded) and a policy-2 coin can still register its pool.
/// Existing PairResults stay as history. (A partner whose rule "ended" has no on-chain end state — no wind-down flag exists in
/// TokenConfig — so it is not evidence: the keeper posts no more results for it and each period falls back after 72 h.)
#[event_cpi]
#[derive(Accounts)]
pub struct UnlinkPair<'info> {
    pub cranker: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED, config_a.mint.as_ref()], bump = config_a.bump)]
    pub config_a: Box<Account<'info, TokenConfig>>,
    #[account(mut, seeds = [CONFIG_SEED, config_b.mint.as_ref()], bump = config_b.bump)]
    pub config_b: Box<Account<'info, TokenConfig>>,
    #[account(mut, close = fee_a, seeds = [PAIR_LINK_SEED, config_a.mint.as_ref()], bump = link_a.bump)]
    pub link_a: Box<Account<'info, PairLink>>,
    #[account(mut, close = fee_b, seeds = [PAIR_LINK_SEED, config_b.mint.as_ref()], bump = link_b.bump)]
    pub link_b: Box<Account<'info, PairLink>>,
    #[account(mut, seeds = [FEE_SEED, config_a.mint.as_ref()], bump = config_a.fee_bump)]
    pub fee_a: SystemAccount<'info>,
    #[account(mut, seeds = [FEE_SEED, config_b.mint.as_ref()], bump = config_b.fee_bump)]
    pub fee_b: SystemAccount<'info>,
    /// CHECK: the pair_curve Pair holding both mints (PairView::load) — the evidence for UNLINK_PAIR_VOIDED / UNLINK_SIDE_REFUNDING;
    /// required when either coin is policy 2.
    pub pair: Option<UncheckedAccount<'info>>,
}

pub fn handle_unlink_pair(ctx: Context<UnlinkPair>) -> Result<()> {
    let a = &ctx.accounts;
    let (ma, mb) = (a.config_a.mint, a.config_b.mint);
    require!(a.link_a.pair_mint == mb && a.link_b.pair_mint == ma, BurnError::NotPaired);
    let now = Clock::get()?.unix_timestamp;
    let pair_curve = a.config_a.rule.pool_policy == POOL_POLICY_PAIR_CURVE || a.config_b.rule.pool_policy == POOL_POLICY_PAIR_CURVE;
    let mut reason: Option<u8> = None;
    if pair_curve {
        // A pair_curve pair: only its Pair's terminal state counts.
        let p = a.pair.as_ref().ok_or(BurnError::PairStillLive)?;
        let pair = PairView::load(&p.to_account_info())?;
        require!(pair.mints[0] == ma && pair.mints[1] == mb || pair.mints[0] == mb && pair.mints[1] == ma, BurnError::PairMismatch);
        if pair.status == PAIR_CURVE_STATUS_VOIDED {
            reason = Some(UNLINK_PAIR_VOIDED);
        } else if pair.refunding[0] || pair.refunding[1] {
            reason = Some(UNLINK_SIDE_REFUNDING);
        }
    } else {
        // A LaunchLab pair: its locked voidBy has ended (the day after it has begun, UTC) without both pools.
        let void_by = a.config_a.pair_void_by.max(a.config_b.pair_void_by);
        let one_dead = !a.config_a.own_pool_verified() || !a.config_b.own_pool_verified();
        if void_by != 0 && one_dead && math::utc_date(now) > void_by {
            reason = Some(UNLINK_VOID_BY_PASSED);
        }
    }
    let reason = reason.ok_or(BurnError::PairStillLive)?;
    for c in [&mut ctx.accounts.config_a, &mut ctx.accounts.config_b] {
        c.pair_state = PAIR_STATE_UNLINKED;
        c.pair_unlinked_at = now;
    }
    emit_cpi!(PairUnlinked { mint_a: ma, mint_b: mb, reason, cranker: ctx.accounts.cranker.key() });
    Ok(())
}
