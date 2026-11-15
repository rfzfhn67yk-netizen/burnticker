use anchor_lang::prelude::*;

use crate::attest::{attested_mask, canonical_message};
use crate::constants::*;
use crate::error::BurnError;
use crate::events::{ReadingProcessed, ReadingReset, ReadingSubmitted};
use crate::math;
use crate::state::{Reading, TokenConfig};

/// Anyone may submit (and pay the rent of) a reading; it is valid only with a QUORUM of attester signatures over the canonical
/// message (attest.rs canonical_message, v3: `BURNRECEIPTS-v3|<cluster genesis>|<program>|<mint>|<feed_id>|prev=<date|none>|
/// <YYYY-MM-DD>|<value>|src=<sha256(source URL)>|proof=<proof locator>`), carried by Ed25519SigVerify instruction(s) in the same
/// transaction — the brief's `signatures` argument. The client packs one shared copy of the message (review-2 F4). The program verifies signatures and the
/// quorum, nothing else; `source_url_hash` and `proof_hash` are stored on the reading (and in the event) so an off-chain verifier can
/// refetch the source / locate the zkTLS proof.
///
/// READINGS ARE APPEND-ONLY: a reading account is written once; re-submitting the same date with the same value is a no-op and with
/// a different value is refused. No instruction modifies a reading's (date, value, units, hashes) afterwards; cranks only add the
/// outcome.
#[event_cpi]
#[derive(Accounts)]
#[instruction(record_date: u32)]
pub struct SubmitReading<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED, config.mint.as_ref()], bump = config.bump)]
    pub config: Box<Account<'info, TokenConfig>>,
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + Reading::INIT_SPACE,
        seeds = [READING_SEED, config.key().as_ref(), &record_date.to_le_bytes()],
        bump
    )]
    pub reading: Box<Account<'info, Reading>>,
    /// CHECK: address-checked: the instructions sysvar.
    #[account(address = solana_instructions_sysvar::ID)]
    pub instructions: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handle_submit_reading(ctx: Context<SubmitReading>, record_date: u32, value: u64, source_url_hash: [u8; 32], proof_hash: [u8; 32]) -> Result<()> {
    require!(math::valid_date(record_date), BurnError::InvalidDate);
    let clock = Clock::get()?;
    require!(record_date <= math::utc_date(clock.unix_timestamp), BurnError::FutureDate);
    // LAUNCHPAD-PATH §45: after a RESOLVED end nothing dated later than the end (a VOID end keeps its wind-down readings).
    require!(crate::instructions::end::reading_allowed_after_end(&ctx.accounts.config, record_date), BurnError::RuleEnded);
    require!(value > 0 && value <= i64::MAX as u64, BurnError::InvalidValue);
    require!(source_url_hash != [0u8; 32], BurnError::InvalidValue);

    // Idempotent per date: the same reading again is a no-op; a different value for a stored date is refused.
    if ctx.accounts.reading.record_date != 0 {
        require!(ctx.accounts.reading.value == value, BurnError::ConflictingReading);
        return Ok(());
    }
    if ctx.accounts.config.has_baseline {
        require!(record_date > ctx.accounts.config.last_record_date, BurnError::StaleReading);
    }

    // ----- the quorum of signatures over the canonical message -----
    let entries = ctx.accounts.config.attester_slice().to_vec();
    let decimals = ctx.accounts.config.rule.value_decimals;
    let signed_prev = if ctx.accounts.config.has_baseline { ctx.accounts.config.last_record_date } else { 0 };
    let msg = canonical_message(
        &crate::ID,
        &ctx.accounts.config.mint,
        ctx.accounts.config.feed_id_str(),
        signed_prev,
        record_date,
        value,
        decimals,
        &source_url_hash,
        &proof_hash,
    );
    let mask = attested_mask(&ctx.accounts.instructions.to_account_info(), msg.as_bytes(), &entries)?;
    require!(mask.count_ones() >= ctx.accounts.config.quorum as u32, BurnError::QuorumNotMet);

    let config_key = ctx.accounts.config.key();
    let c = &mut ctx.accounts.config;
    let (kind, delta, carry_in, units, carry_out, prev_date, prev_value) = if !c.has_baseline {
        (KIND_BASELINE, 0i64, 0u64, 0u64, 0u64, 0u32, 0u64)
    } else {
        let s = math::step(c.last_value, value, c.carry, c.rule.unit_value, c.rule.carry_rule).map_err(|_| BurnError::MathOverflow)?;
        if math::delta_plausible(s.delta, c.rule.max_abs_delta) {
            (s.kind, s.delta, s.carry_in, s.units, s.carry_out, c.last_record_date, c.last_value)
        } else {
            // Review M-2: never a wedge. An out-of-bound (but quorum-signed) reading earns nothing, resets the carry and becomes the
            // new baseline, loudly (ReadingReset).
            (KIND_RESET, s.delta, s.carry_in, 0u64, 0u64, c.last_record_date, c.last_value)
        }
    };

    let r = &mut ctx.accounts.reading;
    r.version = 1;
    r.bump = ctx.bumps.reading;
    r.kind = kind;
    r.processed = false;
    r.config = config_key;
    r.record_date = record_date;
    r.prev_date = prev_date;
    r.value = value;
    r.prev_value = prev_value;
    r.delta = delta;
    r.carry_in = carry_in;
    r.carry_out = carry_out;
    r.units = units;
    r.signers_mask = mask;
    r.source_url_hash = source_url_hash;
    r.proof_hash = proof_hash;
    r.submitted_at = clock.unix_timestamp;
    r.outcome = OUTCOME_PENDING;

    c.has_baseline = true;
    c.last_record_date = record_date;
    c.last_value = value;
    c.carry = carry_out;
    c.readings = c.readings.checked_add(1).ok_or(BurnError::MathOverflow)?;

    // A reading with nothing to burn that is next in line is processed on the spot, so the crank queue only ever holds burn days.
    let auto = units == 0 && prev_date == c.crank_cursor;
    if auto {
        r.processed = true;
        r.outcome = OUTCOME_NO_UNITS;
        r.processed_at = clock.unix_timestamp;
        c.crank_cursor = record_date;
    }
    let payer = ctx.accounts.payer.key();

    emit_cpi!(ReadingSubmitted {
        config: config_key,
        record_date,
        prev_date,
        value,
        prev_value,
        delta,
        carry_in,
        carry_out,
        units,
        kind,
        signers_mask: mask,
        source_url_hash,
        proof_hash,
        submitter: payer,
    });
    if kind == KIND_RESET {
        let max_abs_delta = ctx.accounts.config.rule.max_abs_delta;
        emit_cpi!(ReadingReset { config: config_key, record_date, prev_value, value, delta, max_abs_delta });
    }
    if auto {
        emit_cpi!(ReadingProcessed {
            config: config_key,
            record_date,
            units: 0,
            outcome: OUTCOME_NO_UNITS,
            pool_lamports: 0,
            spent_lamports: 0,
            got: 0,
            burned: 0,
            owed: 0,
            shortfall: 0,
            cranker: payer,
        });
    }
    Ok(())
}
