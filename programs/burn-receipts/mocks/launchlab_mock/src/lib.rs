//! TEST-ONLY LaunchLab `claim_creator_fee` stand-in (see Cargo.toml). Account contract from @raydium-io/raydium-sdk-v2 0.2.74-alpha
//! src/raydium/launchpad/instrument.ts `claimCreatorFee` and pda.ts:
//!   0 creator (signer, writable)  1 creator_fee_vault_auth = PDA[b"creator_fee_vault_auth_seed"]  2 creator vault = PDA[creator, mintB] (w)
//!   3 recipient token account (w)  4 mintB  5 token program  6 system program  7 associated token program
//!   data = [26, 97, 138, 203, 132, 171, 141, 252]
#![allow(unexpected_cfgs)]

use anchor_lang::solana_program::{
    account_info::AccountInfo, entrypoint, entrypoint::ProgramResult, program::invoke_signed, program_error::ProgramError, pubkey::Pubkey,
};
use anchor_spl::token::spl_token;

const DISC: [u8; 8] = [26, 97, 138, 203, 132, 171, 141, 252];
const AUTH_SEED: &[u8] = b"creator_fee_vault_auth_seed";

entrypoint!(process);

fn process(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    if data != DISC || accounts.len() < 8 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let (creator, auth, vault, recipient, mint_b, token, system, ata) =
        (&accounts[0], &accounts[1], &accounts[2], &accounts[3], &accounts[4], &accounts[5], &accounts[6], &accounts[7]);
    if !creator.is_signer || !creator.is_writable || !vault.is_writable || !recipient.is_writable {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let (auth_key, auth_bump) = Pubkey::find_program_address(&[AUTH_SEED], program_id);
    let (vault_key, _) = Pubkey::find_program_address(&[creator.key.as_ref(), mint_b.key.as_ref()], program_id);
    if *auth.key != auth_key || *vault.key != vault_key || *token.key != spl_token::ID {
        return Err(ProgramError::InvalidSeeds);
    }
    if *system.key != anchor_lang::solana_program::system_program::ID || ata.key.to_string() != "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL" {
        return Err(ProgramError::IncorrectProgramId);
    }
    let amount = {
        let d = vault.try_borrow_data()?;
        if d.len() < 72 {
            return Err(ProgramError::InvalidAccountData);
        }
        u64::from_le_bytes(d[64..72].try_into().unwrap())
    };
    if amount > 0 {
        let ix = spl_token::instruction::transfer(&spl_token::ID, vault.key, recipient.key, &auth_key, &[], amount)?;
        invoke_signed(&ix, &[vault.clone(), recipient.clone(), auth.clone(), token.clone()], &[&[AUTH_SEED, &[auth_bump]]])?;
    }
    Ok(())
}
