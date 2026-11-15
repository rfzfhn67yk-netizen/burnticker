//! Post-CPI integrity (the burn_receipts guards.rs pattern, blind review 3 M-1).
//!
//! `graduate` passes the SOL vault — a System account holding the whole raise — to Raydium CPMM (an external, upgradeable program)
//! as signer + writable, twice. Balance checks alone cannot see an authority change: a hostile callee holding the vault's signature
//! could `system::assign` it to itself, or re-authorise a vault token account (SetAuthority / Approve / close authority) with every
//! balance unchanged, and drain it later. After every such CPI the program therefore requires the vault to still be System-owned
//! with no data and no less than the lamports it should have, and each vault token account to keep its owner and mint with no
//! delegate and no close authority. A violation is a hard error: the whole transaction reverts.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::program_pack::Pack;
use anchor_spl::token::spl_token;

use crate::error::PairError;

pub fn require_vault_intact(vault: &AccountInfo, lamports_floor: u64) -> Result<()> {
    require_keys_eq!(*vault.owner, anchor_lang::system_program::ID, PairError::VaultTampered);
    require!(vault.data_is_empty(), PairError::VaultTampered);
    require!(vault.lamports() >= lamports_floor, PairError::VaultTampered);
    Ok(())
}

/// A vault-owned SPL token account after a CPI; returns its amount.
pub fn require_token_account_intact(acc: &AccountInfo, owner: &Pubkey, mint: &Pubkey) -> Result<u64> {
    require_keys_eq!(*acc.owner, spl_token::ID, PairError::VaultTampered);
    let data = acc.try_borrow_data()?;
    let t = spl_token::state::Account::unpack(&data).map_err(|_| PairError::VaultTampered)?;
    require_keys_eq!(t.owner, *owner, PairError::VaultTampered);
    require_keys_eq!(t.mint, *mint, PairError::VaultTampered);
    require!(t.delegate.is_none() && t.delegated_amount == 0, PairError::VaultTampered);
    require!(t.close_authority.is_none(), PairError::VaultTampered);
    require!(t.state == spl_token::state::AccountState::Initialized, PairError::VaultTampered);
    Ok(t.amount)
}

/// Amount of any SPL token account (CPMM's pool vaults), owner-checked.
pub fn token_amount(acc: &AccountInfo) -> Result<u64> {
    require_keys_eq!(*acc.owner, spl_token::ID, PairError::PoolMismatch);
    let data = acc.try_borrow_data()?;
    let t = spl_token::state::Account::unpack(&data).map_err(|_| PairError::PoolMismatch)?;
    Ok(t.amount)
}

pub fn mint_supply(acc: &AccountInfo) -> Result<u64> {
    require_keys_eq!(*acc.owner, spl_token::ID, PairError::PoolMismatch);
    let data = acc.try_borrow_data()?;
    let m = spl_token::state::Mint::unpack(&data).map_err(|_| PairError::PoolMismatch)?;
    Ok(m.supply)
}
