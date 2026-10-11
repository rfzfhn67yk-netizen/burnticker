//! TEST-ONLY Raydium CPMM liquidity-lock stand-in (see Cargo.toml).
#![allow(unexpected_cfgs)]
use anchor_lang::solana_program::{
    account_info::AccountInfo,
    entrypoint,
    entrypoint::ProgramResult,
    instruction::{AccountMeta, Instruction},
    program::{invoke, invoke_signed},
    program_error::ProgramError,
    program_pack::Pack,
    pubkey::Pubkey,
    system_instruction,
};
use anchor_lang::prelude::{Rent, SolanaSysvar};
use anchor_spl::token::spl_token;

pub const LOCK_CP_LIQUIDITY: [u8; 8] = [216, 157, 29, 78, 38, 51, 31, 26];
pub const COLLECT_CP_FEES: [u8; 8] = [8, 30, 51, 199, 209, 184, 247, 133];
pub const STATE_DISCRIMINATOR: [u8; 8] = [0x19, 0x0a, 0xee, 0xc5, 0xcf, 0xea, 0x49, 0x16];
const CPMM_WITHDRAW: [u8; 8] = [183, 18, 70, 156, 148, 109, 161, 34];
pub const AUTH_SEED: &[u8] = b"lock_cp_authority_seed";
pub const LOCKED_SEED: &[u8] = b"locked_liquidity";
pub const STATE_LEN: usize = 256;
const ATA_PROGRAM: Pubkey = anchor_lang::prelude::pubkey!("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

// CPMM PoolState offsets (raydium-cp-swap b3187ae5).
const P_VAULT0: usize = 72;
const P_VAULT1: usize = 104;
const P_LP_MINT: usize = 136;
const P_LP_SUPPLY: usize = 333;
const P_FEES: [usize; 6] = [341, 357, 397, 349, 365, 405];

entrypoint!(process);

fn create_ata<'a>(payer: &AccountInfo<'a>, ata: &AccountInfo<'a>, wallet: &AccountInfo<'a>, mint: &AccountInfo<'a>, system: &AccountInfo<'a>, token: &AccountInfo<'a>, ata_prog: &AccountInfo<'a>) -> ProgramResult {
    let ix = Instruction {
        program_id: ATA_PROGRAM,
        accounts: vec![
            AccountMeta::new(*payer.key, true),
            AccountMeta::new(*ata.key, false),
            AccountMeta::new_readonly(*wallet.key, false),
            AccountMeta::new_readonly(*mint.key, false),
            AccountMeta::new_readonly(*system.key, false),
            AccountMeta::new_readonly(spl_token::ID, false),
        ],
        data: vec![1],
    };
    invoke(&ix, &[payer.clone(), ata.clone(), wallet.clone(), mint.clone(), system.clone(), token.clone(), ata_prog.clone()])
}

/// Anchor `init` semantics (lp-lock blind review I-2 / MF-2): an address someone pre-funded is adopted (top up to rent, allocate,
/// assign) instead of failing the way a bare create_account does — the real program uses Anchor `init` and accepts it.
fn create_or_adopt<'a>(payer: &AccountInfo<'a>, acc: &AccountInfo<'a>, system: &AccountInfo<'a>, space: usize, owner: &Pubkey, seeds: &[&[&[u8]]]) -> ProgramResult {
    let need = Rent::get()?.minimum_balance(space);
    if acc.lamports() == 0 {
        return invoke_signed(&system_instruction::create_account(payer.key, acc.key, need, space as u64, owner), &[payer.clone(), acc.clone(), system.clone()], seeds);
    }
    if acc.lamports() < need {
        invoke(&system_instruction::transfer(payer.key, acc.key, need - acc.lamports()), &[payer.clone(), acc.clone(), system.clone()])?;
    }
    invoke_signed(&system_instruction::allocate(acc.key, space as u64), &[acc.clone(), system.clone()], seeds)?;
    invoke_signed(&system_instruction::assign(acc.key, owner), &[acc.clone(), system.clone()], seeds)
}

fn u64_at(d: &[u8], o: usize) -> u64 {
    u64::from_le_bytes(d[o..o + 8].try_into().unwrap())
}
fn pk_at(d: &[u8], o: usize) -> Pubkey {
    Pubkey::new_from_array(d[o..o + 32].try_into().unwrap())
}
fn token_amount(a: &AccountInfo) -> Result<u64, ProgramError> {
    Ok(spl_token::state::Account::unpack(&a.try_borrow_data()?)?.amount)
}
fn isqrt(n: u128) -> u128 {
    if n < 2 {
        return n;
    }
    let mut x = (n as f64).sqrt() as u128;
    while x * x > n {
        x -= 1;
    }
    while (x + 1) * (x + 1) <= n {
        x += 1;
    }
    x
}
/// (k = net reserve product, lp_supply) of a CPMM pool, reading its vault accounts.
fn pool_k(pool: &AccountInfo, v0: &AccountInfo, v1: &AccountInfo) -> Result<(u128, u64), ProgramError> {
    let d = pool.try_borrow_data()?;
    if pk_at(&d, P_VAULT0) != *v0.key || pk_at(&d, P_VAULT1) != *v1.key {
        return Err(ProgramError::InvalidAccountData);
    }
    let f0 = u64_at(&d, P_FEES[0]) + u64_at(&d, P_FEES[1]) + u64_at(&d, P_FEES[2]);
    let f1 = u64_at(&d, P_FEES[3]) + u64_at(&d, P_FEES[4]) + u64_at(&d, P_FEES[5]);
    let r0 = token_amount(v0)?.saturating_sub(f0) as u128;
    let r1 = token_amount(v1)?.saturating_sub(f1) as u128;
    Ok((r0 * r1, u64_at(&d, P_LP_SUPPLY)))
}

fn process(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    if data.len() < 8 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let (auth_key, auth_bump) = Pubkey::find_program_address(&[AUTH_SEED], program_id);
    let auth_seeds: &[&[u8]] = &[AUTH_SEED, &[auth_bump]];
    match data[..8].try_into().unwrap() {
        LOCK_CP_LIQUIDITY => lock(program_id, accounts, data, &auth_key, auth_seeds),
        COLLECT_CP_FEES => collect(program_id, accounts, data, &auth_key, auth_seeds),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

/// lock_cp_liquidity(lp_amount u64, with_metadata bool). Accounts (SDK order): 0 authority, 1 payer (s,w), 2 liquidity_owner (s),
/// 3 fee_nft_owner, 4 fee_nft_mint (s,w), 5 fee_nft_account (w), 6 pool_state, 7 locked_liquidity (w), 8 lp_mint,
/// 9 liquidity_owner_lp (w), 10 locked_lp_vault (w), 11 token_0_vault (w), 12 token_1_vault (w), 13 metadata_account (w), 14 rent,
/// 15 system, 16 token, 17 associated token, 18 metadata program.
fn lock(program_id: &Pubkey, a: &[AccountInfo], data: &[u8], auth_key: &Pubkey, auth_seeds: &[&[u8]]) -> ProgramResult {
    if a.len() < 19 || data.len() < 17 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }
    let lp_amount = u64::from_le_bytes(data[8..16].try_into().unwrap());
    let (auth, payer, owner, nft_owner, nft_mint, nft_acc, pool, locked, lp_mint, owner_lp, lock_vault, v0, v1) =
        (&a[0], &a[1], &a[2], &a[3], &a[4], &a[5], &a[6], &a[7], &a[8], &a[9], &a[10], &a[11], &a[12]);
    let (system, token) = (&a[15], &a[16]);
    if auth.key != auth_key || !payer.is_signer || !owner.is_signer || !nft_mint.is_signer || lp_amount == 0 {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if pool.owner != &anchor_lang::prelude::pubkey!("CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C") && pool.owner != &anchor_lang::prelude::pubkey!("DRaycpLY18LhpbydsBWbVJtxpNv9oXPgjRSfpF2bWpYb") {
        return Err(ProgramError::IllegalOwner);
    }
    if pk_at(&pool.try_borrow_data()?, P_LP_MINT) != *lp_mint.key {
        return Err(ProgramError::InvalidAccountData);
    }
    // the Fee Key NFT: a fresh 0-decimal mint, one token to fee_nft_owner's ATA, mint authority removed, no freeze authority
    create_or_adopt(payer, nft_mint, system, 82, &spl_token::ID, &[])?;
    invoke(&spl_token::instruction::initialize_mint2(&spl_token::ID, nft_mint.key, auth_key, None, 0)?, &[nft_mint.clone(), token.clone()])?;
    create_ata(payer, nft_acc, nft_owner, nft_mint, system, token, &a[17])?;
    invoke_signed(&spl_token::instruction::mint_to(&spl_token::ID, nft_mint.key, nft_acc.key, auth_key, &[], 1)?, &[nft_mint.clone(), nft_acc.clone(), auth.clone(), token.clone()], &[auth_seeds])?;
    invoke_signed(
        &spl_token::instruction::set_authority(&spl_token::ID, nft_mint.key, None, spl_token::instruction::AuthorityType::MintTokens, auth_key, &[])?,
        &[nft_mint.clone(), auth.clone(), token.clone()],
        &[auth_seeds],
    )?;
    // the LP moves into the lock authority's LP account
    create_ata(payer, lock_vault, auth, lp_mint, system, token, &a[17])?;
    invoke(&spl_token::instruction::transfer(&spl_token::ID, owner_lp.key, lock_vault.key, owner.key, &[], lp_amount)?, &[owner_lp.clone(), lock_vault.clone(), owner.clone(), token.clone()])?;
    // the state account
    let (state_key, state_bump) = Pubkey::find_program_address(&[LOCKED_SEED, nft_mint.key.as_ref()], program_id);
    if *locked.key != state_key {
        return Err(ProgramError::InvalidSeeds);
    }
    create_or_adopt(payer, locked, system, STATE_LEN, program_id, &[&[LOCKED_SEED, nft_mint.key.as_ref(), &[state_bump]]])?;
    let (k, lp) = pool_k(pool, v0, v1)?;
    let mut d = locked.try_borrow_mut_data()?;
    d[..8].copy_from_slice(&STATE_DISCRIMINATOR);
    d[8..16].copy_from_slice(&lp_amount.to_le_bytes());
    d[32..40].copy_from_slice(&lp.to_le_bytes());
    d[40..56].copy_from_slice(&k.to_le_bytes());
    d[64..96].copy_from_slice(pool.key.as_ref());
    d[96..128].copy_from_slice(nft_mint.key.as_ref());
    // lp-lock blind review I-3: @128 is the LIQUIDITY OWNER (the locker), as the real program writes it — not the Fee Key owner.
    d[128..160].copy_from_slice(owner.key.as_ref());
    d[160..192].copy_from_slice(lp_mint.key.as_ref());
    Ok(())
}

/// collect_cp_fees(fee_lp_amount u64). Accounts (SDK order): 0 authority, 1 fee_nft_owner (s), 2 fee_nft_account (w),
/// 3 locked_liquidity (w), 4 cpmm_program, 5 cp_authority, 6 pool_state (w), 7 lp_mint (w), 8 recipient_token_0 (w),
/// 9 recipient_token_1 (w), 10 token_0_vault (w), 11 token_1_vault (w), 12 vault_0_mint, 13 vault_1_mint, 14 locked_lp_vault (w),
/// 15 token_program, 16 token_program_2022, 17 memo_program.
/// Fee LP = the locked LP's share of k growth since the last collect: locked − locked·√k_last·lp_now / (√k_now·lp_last); withdraws
/// min(requested, fee LP + unclaimed) through CPMM `withdraw` to the recipients and carries the rest as unclaimed @24 (I-1 / MF-1: the
/// real program keeps the remainder of a partial collect; the fee LP leaves the principal @8 either way). Nothing accrued → returns
/// Ok without moving anything.
fn collect(program_id: &Pubkey, a: &[AccountInfo], data: &[u8], auth_key: &Pubkey, auth_seeds: &[&[u8]]) -> ProgramResult {
    if a.len() < 18 || data.len() < 16 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }
    let requested = u64::from_le_bytes(data[8..16].try_into().unwrap());
    let (auth, nft_owner, nft_acc, locked, cpmm, cp_auth, pool, lp_mint, r0, r1, v0, v1, m0, m1, lock_vault) =
        (&a[0], &a[1], &a[2], &a[3], &a[4], &a[5], &a[6], &a[7], &a[8], &a[9], &a[10], &a[11], &a[12], &a[13], &a[14]);
    if auth.key != auth_key || !nft_owner.is_signer || locked.owner != program_id {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let (nft_mint, pool_key, locked_lp, unclaimed, last_lp, last_k) = {
        let d = locked.try_borrow_data()?;
        if d.len() < STATE_LEN || d[..8] != STATE_DISCRIMINATOR {
            return Err(ProgramError::InvalidAccountData);
        }
        (pk_at(&d, 96), pk_at(&d, 64), u64_at(&d, 8), u64_at(&d, 24), u64_at(&d, 32), u128::from_le_bytes(d[40..56].try_into().unwrap()))
    };
    if pool_key != *pool.key {
        return Err(ProgramError::InvalidAccountData);
    }
    let nft = spl_token::state::Account::unpack(&nft_acc.try_borrow_data()?)?;
    if nft.mint != nft_mint || nft.owner != *nft_owner.key || nft.amount != 1 {
        return Err(ProgramError::IllegalOwner);
    }
    let (k_now, lp_now) = pool_k(pool, v0, v1)?;
    // keep = locked · (√k_last · lp_now / lp_last) / √k_now — ordered so no product exceeds u128
    let per = isqrt(last_k).checked_mul(lp_now as u128).ok_or(ProgramError::ArithmeticOverflow)? / (last_lp as u128).max(1);
    let keep = (locked_lp as u128).checked_mul(per).ok_or(ProgramError::ArithmeticOverflow)? / isqrt(k_now).max(1);
    let fee_lp = (locked_lp as u128).saturating_sub(keep) as u64;
    let accrued = fee_lp.checked_add(unclaimed).ok_or(ProgramError::ArithmeticOverflow)?;
    let amount = accrued.min(requested);
    if amount > 0 {
        let mut w = CPMM_WITHDRAW.to_vec();
        w.extend_from_slice(&amount.to_le_bytes());
        w.extend_from_slice(&0u64.to_le_bytes());
        w.extend_from_slice(&0u64.to_le_bytes());
        let ix = Instruction {
            program_id: *cpmm.key,
            accounts: vec![
                AccountMeta::new_readonly(*auth.key, true),
                AccountMeta::new_readonly(*cp_auth.key, false),
                AccountMeta::new(*pool.key, false),
                AccountMeta::new(*lock_vault.key, false),
                AccountMeta::new(*r0.key, false),
                AccountMeta::new(*r1.key, false),
                AccountMeta::new(*v0.key, false),
                AccountMeta::new(*v1.key, false),
                AccountMeta::new_readonly(*a[15].key, false),
                AccountMeta::new_readonly(*a[16].key, false),
                AccountMeta::new_readonly(*m0.key, false),
                AccountMeta::new_readonly(*m1.key, false),
                AccountMeta::new(*lp_mint.key, false),
                AccountMeta::new_readonly(*a[17].key, false),
            ],
            data: w,
        };
        invoke_signed(&ix, a, &[auth_seeds])?;
    }
    let (k_after, lp_after) = pool_k(pool, v0, v1)?;
    let mut d = locked.try_borrow_mut_data()?;
    let claimed = u64_at(&d, 16) + amount;
    d[8..16].copy_from_slice(&(locked_lp - fee_lp).to_le_bytes());
    d[16..24].copy_from_slice(&claimed.to_le_bytes());
    d[24..32].copy_from_slice(&(accrued - amount).to_le_bytes());
    d[32..40].copy_from_slice(&lp_after.to_le_bytes());
    d[40..56].copy_from_slice(&k_after.to_le_bytes());
    Ok(())
}
