//! LAUNCHPAD-PATH §35 test helpers shared by the pair_curve suites: the lock-program stand-in, pair_curve `lock_lp` and the
//! burn_receipts `register_pair_pool` (with its LP-lock account), `register_fee_key` and `claim_lock_fees` builders.
#![allow(dead_code)]

use anchor_lang::prelude::Pubkey;
use anchor_lang::solana_program::instruction::Instruction;
use anchor_lang::{InstructionData, ToAccountMetas};
use anchor_spl::associated_token::get_associated_token_address;
use anchor_spl::token::spl_token;
use burn_receipts::constants::*;

use crate::common::cpmm::Pool;
use crate::common::{config_pda, fee_pda, Env};

pub const METADATA_PROGRAM_ID: Pubkey = anchor_lang::prelude::pubkey!("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
pub const TOKEN_2022: Pubkey = anchor_lang::prelude::pubkey!("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

fn read(rel: &str) -> Vec<u8> {
    let p = format!("{}/../../{rel}", env!("CARGO_MANIFEST_DIR"));
    std::fs::read(&p).unwrap_or_else(|e| panic!("cannot read {p}: {e} (run scripts/test.sh first)"))
}

/// Loads the TEST-ONLY lock-program stand-in at Raydium's lock program id (its authority PDA is then LOCK_CPMM_AUTHORITY) — or, with
/// REVIEW_LOCK_SO=<path> (scripts/test.sh lock-real mode), that binary: the real program dumped read-only, never committed. Metaplex's
/// id gets an inert executable (the real program's account list declares it; with_metadata = false never invokes it).
pub fn add_lock_program(env: &mut Env) {
    let so = match std::env::var("REVIEW_LOCK_SO") {
        Ok(p) if !p.is_empty() => std::fs::read(&p).unwrap_or_else(|e| panic!("REVIEW_LOCK_SO={p}: {e}")),
        _ => read("fixtures/cpmm_lock_mock.so"),
    };
    env.svm.add_program(LOCK_CPMM_PROGRAM_ID, &so).unwrap();
    env.svm.add_program(METADATA_PROGRAM_ID, &read("fixtures/cpmm_lock_mock.so")).unwrap();
}

/// Loads the localnet build of burn_receipts (compiled-in test OPERATOR_TREASURY = [0x7e; 32]) over the default one.
pub fn use_localnet_burn_receipts(env: &mut Env) {
    env.svm.add_program(burn_receipts::ID, &read("target/deploy-localnet/burn_receipts.so")).unwrap();
}

pub fn fee_keys() -> Pubkey {
    Pubkey::find_program_address(&[FEE_KEYS_SEED], &burn_receipts::ID).0
}
pub fn fee_key_record(mint: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[FEE_KEY_SEED, mint.as_ref()], &burn_receipts::ID).0
}
pub fn fee_nft_mint(pair: &Pubkey, side: u8) -> Pubkey {
    Pubkey::find_program_address(&[pair_curve::constants::FEE_NFT_SEED, pair.as_ref(), &[side]], &pair_curve::ID).0
}
pub fn locked_liquidity(nft_mint: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[LOCKED_LIQUIDITY_SEED, nft_mint.as_ref()], &LOCK_CPMM_PROGRAM_ID).0
}
pub fn lock_lp_vault(lp_mint: &Pubkey) -> Pubkey {
    get_associated_token_address(&LOCK_CPMM_AUTHORITY, lp_mint)
}
fn metadata_pda(nft_mint: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[b"metadata", METADATA_PROGRAM_ID.as_ref(), nft_mint.as_ref()], &METADATA_PROGRAM_ID).0
}
fn pc_event_authority() -> Pubkey {
    Pubkey::find_program_address(&[b"__event_authority"], &pair_curve::ID).0
}
fn br_event_authority() -> Pubkey {
    Pubkey::find_program_address(&[b"__event_authority"], &burn_receipts::ID).0
}

pub fn ix_lock_lp(pair: &Pubkey, vault: &Pubkey, mint: &Pubkey, pool: &Pool, cranker: &Pubkey, side: u8) -> Instruction {
    let nft = fee_nft_mint(pair, side);
    Instruction::new_with_bytes(
        pair_curve::ID,
        &pair_curve::instruction::LockLp { side }.data(),
        pair_curve::accounts::LockLp {
            cranker: *cranker,
            pair: *pair,
            vault: *vault,
            pool_state: pool.pool,
            lp_mint: pool.lp_mint,
            vault_lp: get_associated_token_address(vault, &pool.lp_mint),
            fee_vault: fee_pda(mint),
            fee_nft_mint: nft,
            fee_nft_account: get_associated_token_address(&fee_keys(), &nft),
            fee_keys: fee_keys(),
            locked_liquidity: locked_liquidity(&nft),
            lock_lp_vault: lock_lp_vault(&pool.lp_mint),
            token_0_vault: pool.token_0_vault,
            token_1_vault: pool.token_1_vault,
            metadata_account: metadata_pda(&nft),
            lock_program: LOCK_CPMM_PROGRAM_ID,
            lock_authority: LOCK_CPMM_AUTHORITY,
            metadata_program: METADATA_PROGRAM_ID,
            rent: anchor_lang::prelude::pubkey!("SysvarRent111111111111111111111111111111111"),
            system_program: anchor_lang::solana_program::system_program::ID,
            token_program: spl_token::ID,
            associated_token_program: anchor_spl::associated_token::ID,
            event_authority: pc_event_authority(),
            program: pair_curve::ID,
        }
        .to_account_metas(None),
    )
}

pub fn ix_register_pair(registrar: &Pubkey, mint: &Pubkey, pool: &Pubkey, lp_mint: &Pubkey, pair: &Pubkey) -> Instruction {
    Instruction::new_with_bytes(
        burn_receipts::ID,
        &burn_receipts::instruction::RegisterPairPool {}.data(),
        burn_receipts::accounts::RegisterPairPool {
            registrar: *registrar,
            config: config_pda(mint),
            mint: *mint,
            pool_state: *pool,
            lp_mint: *lp_mint,
            pair: *pair,
            lp_lock_vault: lock_lp_vault(lp_mint),
            event_authority: br_event_authority(),
            program: burn_receipts::ID,
        }
        .to_account_metas(None),
    )
}

pub fn ix_register_fee_key(payer: &Pubkey, mint: &Pubkey, pool: &Pubkey, nft_mint: &Pubkey) -> Instruction {
    Instruction::new_with_bytes(
        burn_receipts::ID,
        &burn_receipts::instruction::RegisterFeeKey {}.data(),
        burn_receipts::accounts::RegisterFeeKey {
            payer: *payer,
            config: config_pda(mint),
            fee_key: fee_key_record(mint),
            fee_keys: fee_keys(),
            pool_state: *pool,
            fee_nft_mint: *nft_mint,
            fee_nft_account: get_associated_token_address(&fee_keys(), nft_mint),
            locked_liquidity: locked_liquidity(nft_mint),
            lp_lock_vault: lock_lp_vault(&crate::common::cpmm::lp_mint_of(pool)),
            launchlab_pool: None,
            system_program: anchor_lang::solana_program::system_program::ID,
            event_authority: br_event_authority(),
            program: burn_receipts::ID,
        }
        .to_account_metas(None),
    )
}

pub fn ix_claim_lock_fees(cranker: &Pubkey, mint: &Pubkey, pool: &Pool, nft_mint: &Pubkey, treasury: &Pubkey) -> Instruction {
    let fk = fee_keys();
    Instruction::new_with_bytes(
        burn_receipts::ID,
        &burn_receipts::instruction::ClaimLockFees {}.data(),
        burn_receipts::accounts::ClaimLockFees {
            cranker: *cranker,
            platform: Pubkey::find_program_address(&[PLATFORM_SEED], &burn_receipts::ID).0,
            config: config_pda(mint),
            fee_key: fee_key_record(mint),
            fee_keys: fk,
            fee_vault: fee_pda(mint),
            operator_treasury: *treasury,
            mint: *mint,
            wsol_mint: NATIVE_MINT,
            fee_keys_wsol: get_associated_token_address(&fk, &NATIVE_MINT),
            fee_keys_token: get_associated_token_address(&fk, mint),
            fee_nft_account: get_associated_token_address(&fk, nft_mint),
            locked_liquidity: locked_liquidity(nft_mint),
            lock_program: LOCK_CPMM_PROGRAM_ID,
            lock_authority: LOCK_CPMM_AUTHORITY,
            cpmm_program: CPMM_PROGRAM_ID,
            cpmm_authority: pool.authority,
            pool_state: pool.pool,
            lp_mint: pool.lp_mint,
            token_0_vault: pool.token_0_vault,
            token_1_vault: pool.token_1_vault,
            lock_lp_vault: lock_lp_vault(&pool.lp_mint),
            token_program: spl_token::ID,
            token_2022_program: TOKEN_2022,
            memo_program: MEMO_PROGRAM_ID,
            associated_token_program: anchor_spl::associated_token::ID,
            system_program: anchor_lang::solana_program::system_program::ID,
            event_authority: br_event_authority(),
            program: burn_receipts::ID,
        }
        .to_account_metas(None),
    )
}

/// pair_curve burn_lp (lp-lock blind review L-2): the 30-day fallback that burns a graduated side's unlocked LP.
pub fn ix_burn_lp(pair: &Pubkey, vault: &Pubkey, mint: &Pubkey, pool: &Pool, cranker: &Pubkey, side: u8) -> Instruction {
    Instruction::new_with_bytes(
        pair_curve::ID,
        &pair_curve::instruction::BurnLp { side }.data(),
        pair_curve::accounts::BurnLp {
            cranker: *cranker,
            pair: *pair,
            vault: *vault,
            pool_state: pool.pool,
            lp_mint: pool.lp_mint,
            vault_lp: get_associated_token_address(vault, &pool.lp_mint),
            fee_vault: fee_pda(mint),
            token_program: spl_token::ID,
            event_authority: pc_event_authority(),
            program: pair_curve::ID,
        }
        .to_account_metas(None),
    )
}

/// burn_receipts link_pair (LAUNCHPAD-PATH §40): the Pair witnesses both mints; permissionless, idempotent.
pub fn ix_link_pair(payer: &Pubkey, pair: &Pubkey, mint_a: &Pubkey, mint_b: &Pubkey) -> Instruction {
    Instruction::new_with_bytes(
        burn_receipts::ID,
        &burn_receipts::instruction::LinkPair {}.data(),
        burn_receipts::accounts::LinkPair {
            payer: *payer,
            pair: *pair,
            config_a: config_pda(mint_a),
            config_b: config_pda(mint_b),
            link_a: crate::common::pair_link_pda(mint_a),
            link_b: crate::common::pair_link_pda(mint_b),
            system_program: anchor_lang::solana_program::system_program::ID,
            event_authority: br_event_authority(),
            program: burn_receipts::ID,
        }
        .to_account_metas(None),
    )
}
