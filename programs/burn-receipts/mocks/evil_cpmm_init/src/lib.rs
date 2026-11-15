//! TEST-ONLY hostile Raydium CPMM `initialize` (see Cargo.toml). MODE = byte 200 of the AmmConfig account passed (padding in the
//! real AmmConfig; the suite writes a CPMM-owned AmmConfig with the mode there):
//!   1 system Assign of the creator (the pair's SOL vault) to this program
//!   2 an extra 1 SOL System transfer from the creator to THIEF (more than the pool costs)
//!   3 SPL Approve of a delegate (the create-pool-fee account it was given) on creator_token_0, signed by the creator
//!   4 SPL SetAuthority(CloseAccount → THIEF) on creator_token_1, signed by the creator
//!   5 create no pool at all (return Ok)
//! Account order = CPMM `initialize`: 0 creator, 1 amm_config, 7 creator_token_0, 8 creator_token_1, 14 token_program, 18 system.
#![allow(unexpected_cfgs)]
use anchor_lang::solana_program::{
    account_info::AccountInfo, entrypoint, entrypoint::ProgramResult, program::invoke, program_error::ProgramError, pubkey::Pubkey, system_instruction,
};
use anchor_spl::token::spl_token;

const INITIALIZE: [u8; 8] = [175, 175, 109, 31, 13, 152, 155, 237];
pub const THIEF: Pubkey = anchor_lang::prelude::pubkey!("Thief11111111111111111111111111111111111111");

entrypoint!(process);

fn process(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    if data.len() < 8 || data[..8] != INITIALIZE || accounts.len() < 19 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let (creator, amm, t0, t1) = (&accounts[0], &accounts[1], &accounts[7], &accounts[8]);
    let find = |k: &Pubkey| accounts.iter().find(|a| a.key == k).ok_or(ProgramError::NotEnoughAccountKeys);
    let system = find(&anchor_lang::solana_program::system_program::ID)?;
    let token = find(&spl_token::ID)?;
    let mode = amm.try_borrow_data()?[200];
    match mode {
        1 => invoke(&system_instruction::assign(creator.key, program_id), &[creator.clone(), system.clone()]),
        2 => {
            let thief = accounts.iter().find(|a| *a.key == THIEF).ok_or(ProgramError::NotEnoughAccountKeys);
            match thief {
                Ok(t) => invoke(&system_instruction::transfer(creator.key, t.key, 1_000_000_000), &[creator.clone(), t.clone(), system.clone()]),
                // THIEF is not in the transaction: burn the lamports into the create-pool-fee account instead (index 12).
                Err(_) => invoke(&system_instruction::transfer(creator.key, accounts[12].key, 1_000_000_000), &[creator.clone(), accounts[12].clone(), system.clone()]),
            }
        }
        3 => {
            // delegate = an account the callee was given (the create-pool-fee receiver): Approve needs it in the account list
            let delegate = &accounts[12];
            let ix = spl_token::instruction::approve(&spl_token::ID, t0.key, delegate.key, creator.key, &[], u64::MAX)?;
            invoke(&ix, &[t0.clone(), delegate.clone(), creator.clone(), token.clone()])
        }
        4 => {
            let ix = spl_token::instruction::set_authority(&spl_token::ID, t1.key, Some(&THIEF), spl_token::instruction::AuthorityType::CloseAccount, creator.key, &[])?;
            invoke(&ix, &[t1.clone(), creator.clone(), token.clone()])
        }
        5 => Ok(()),
        _ => Err(ProgramError::InvalidArgument),
    }
}
