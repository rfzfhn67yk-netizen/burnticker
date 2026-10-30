//! TEST-ONLY generic multicall (ported from the re-check-after-round-3 PoC). Instruction data:
//!   [n u8] then, per call: [program_idx u8][nacc u8][acc_idx u8 × nacc][dlen u16 LE][data × dlen]
//! where the indices point into this instruction's own account list. Each inner account meta inherits the outer signer/writable flags.
#![allow(unexpected_cfgs)]
use anchor_lang::solana_program::{
    account_info::AccountInfo,
    entrypoint,
    entrypoint::ProgramResult,
    instruction::{AccountMeta, Instruction},
    program::invoke,
    program_error::ProgramError,
    pubkey::Pubkey,
};

entrypoint!(process);

fn byte(data: &[u8], at: usize) -> Result<u8, ProgramError> {
    data.get(at).copied().ok_or(ProgramError::InvalidInstructionData)
}

fn process(_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    let account = |i: u8| accounts.get(i as usize).ok_or(ProgramError::NotEnoughAccountKeys);
    let n = byte(data, 0)? as usize;
    let mut at = 1;
    for _ in 0..n {
        let prog = account(byte(data, at)?)?;
        let nacc = byte(data, at + 1)? as usize;
        let idx = data.get(at + 2..at + 2 + nacc).ok_or(ProgramError::InvalidInstructionData)?.to_vec();
        at += 2 + nacc;
        let dlen = u16::from_le_bytes([byte(data, at)?, byte(data, at + 1)?]) as usize;
        at += 2;
        let d = data.get(at..at + dlen).ok_or(ProgramError::InvalidInstructionData)?.to_vec();
        at += dlen;
        let mut metas = Vec::with_capacity(nacc);
        let mut infos = Vec::with_capacity(nacc + 1);
        for &i in &idx {
            let a = account(i)?;
            metas.push(AccountMeta { pubkey: *a.key, is_signer: a.is_signer, is_writable: a.is_writable });
            infos.push(a.clone());
        }
        infos.push(prog.clone());
        invoke(&Instruction { program_id: *prog.key, accounts: metas, data: d }, &infos)?;
    }
    Ok(())
}
