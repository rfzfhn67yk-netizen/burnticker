//! Review-3 M-1 — post-CPI integrity of the fee PDA and its token accounts.
//!
//! Two instructions lend the fee PDA's signature to an external, upgradeable program: the LaunchLab claim (signer + writable) and the
//! CPMM swap (signer, read-only; the fee PDA's WSOL and token accounts writable). Balance checks alone cannot see an AUTHORITY change:
//! a callee holding the signature could `system::assign` the fee PDA to itself, or `SetAuthority` / `Approve` / set a close authority
//! on the fee PDA's token accounts — every balance unchanged — and drain them in a later instruction. After every such CPI the program
//! therefore requires:
//!   * the fee PDA is still owned by the System program, holds no data, and has at least the lamports it is supposed to have;
//!   * each fee-PDA token account is still an initialised SPL Token account of the same mint, owned by the fee PDA, with no delegate
//!     and no close authority.
//!
//! A violation is a hard error (the whole transaction reverts), never an event.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::program_pack::Pack;
use anchor_spl::token::spl_token;

use crate::error::BurnError;

/// The fee PDA after a CPI: System-owned, no data, lamports ≥ `lamports_floor`.
pub fn require_fee_pda_intact(fee: &AccountInfo, lamports_floor: u64) -> Result<()> {
    require_keys_eq!(*fee.owner, anchor_lang::system_program::ID, BurnError::FeeAccountTampered);
    require!(fee.data_is_empty(), BurnError::FeeAccountTampered);
    require!(fee.lamports() >= lamports_floor, BurnError::FeeAccountTampered);
    Ok(())
}

/// A fee-PDA token account after a CPI. `may_be_absent`: an account that did not exist (owned by the System program, no data) passes.
pub fn require_fee_token_account_intact(acc: &AccountInfo, fee: &Pubkey, mint: &Pubkey, may_be_absent: bool) -> Result<()> {
    if may_be_absent && acc.owner == &anchor_lang::system_program::ID && acc.data_is_empty() {
        return Ok(());
    }
    require_keys_eq!(*acc.owner, spl_token::ID, BurnError::FeeAccountTampered);
    let data = acc.try_borrow_data()?;
    let t = spl_token::state::Account::unpack(&data).map_err(|_| BurnError::FeeAccountTampered)?;
    require_keys_eq!(t.owner, *fee, BurnError::FeeAccountTampered);
    require_keys_eq!(t.mint, *mint, BurnError::FeeAccountTampered);
    require!(t.delegate.is_none() && t.delegated_amount == 0, BurnError::FeeAccountTampered);
    require!(t.close_authority.is_none(), BurnError::FeeAccountTampered);
    require!(t.state == spl_token::state::AccountState::Initialized, BurnError::FeeAccountTampered);
    Ok(())
}
