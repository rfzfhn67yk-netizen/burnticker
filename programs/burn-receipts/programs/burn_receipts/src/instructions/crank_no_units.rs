use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::BurnError;
use crate::events::ReadingProcessed;
use crate::instructions::crank_common::require_next_in_line;
use crate::state::{Reading, TokenConfig};

/// PERMISSIONLESS. Processes a reading with zero units that is next in line (one that arrived while a burn day was still queued).
/// Moves no tokens and no lamports.
#[event_cpi]
#[derive(Accounts)]
#[instruction(record_date: u32)]
pub struct CrankNoUnits<'info> {
    pub cranker: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED, config.mint.as_ref()], bump = config.bump)]
    pub config: Box<Account<'info, TokenConfig>>,
    #[account(mut, seeds = [READING_SEED, config.key().as_ref(), &record_date.to_le_bytes()], bump = reading.bump)]
    pub reading: Box<Account<'info, Reading>>,
}

pub fn handle_crank_no_units(ctx: Context<CrankNoUnits>, _record_date: u32) -> Result<()> {
    let c = &mut ctx.accounts.config;
    let r = &mut ctx.accounts.reading;
    require_next_in_line(c, r)?;
    require!(r.units == 0, BurnError::HasUnits);
    let now = Clock::get()?.unix_timestamp;
    r.processed = true;
    r.outcome = OUTCOME_NO_UNITS;
    r.processed_at = now;
    c.crank_cursor = r.record_date;
    emit_cpi!(ReadingProcessed {
        config: c.key(),
        record_date: r.record_date,
        units: 0,
        outcome: OUTCOME_NO_UNITS,
        pool_lamports: 0,
        spent_lamports: 0,
        got: 0,
        burned: 0,
        owed: 0,
        shortfall: 0,
        cranker: ctx.accounts.cranker.key(),
    });
    Ok(())
}
