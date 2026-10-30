//! Review H-2: `claim_launchlab_creator_fee` — the fee PDA (the LaunchLab creator) claims the bonding-curve creator fee into its own
//! WSOL account.
//!   1. The CPI is byte-for-byte the instruction Raydium's SDK builds (fixtures/launchlab-claim-sdk.json, written by
//!      scripts/launchlab-sdk-fixture.mjs from @raydium-io/raydium-sdk-v2 claimCreatorFee).
//!   2. End to end in LiteSVM against a TEST-ONLY LaunchLab stand-in (mocks/launchlab_mock: LaunchLab's source is not public) that
//!      enforces the SDK's account contract and pays the vault's WSOL to the recipient.

// LiteSVM's FailedTransactionMetadata is large by design; test helpers take many accounts.
#![allow(clippy::result_large_err, clippy::too_many_arguments)]

mod common;

use anchor_lang::prelude::Pubkey;
use anchor_lang::solana_program::program_pack::Pack;
use anchor_lang::{AnchorDeserialize, Discriminator};
use anchor_spl::associated_token::get_associated_token_address;
use anchor_spl::token::spl_token;
use burn_receipts::constants::*;
use burn_receipts::events::LaunchLabCreatorFeeClaimed;
use common::*;
use solana_keypair::Keypair;
use solana_signer::Signer;

const FIXTURE_MINT_SEED: [u8; 32] = [9u8; 32];

fn fixture() -> serde_json::Value {
    let p = format!("{}/../../fixtures/launchlab-claim-sdk.json", env!("CARGO_MANIFEST_DIR"));
    serde_json::from_str(&std::fs::read_to_string(&p).expect("run scripts/launchlab-sdk-fixture.mjs")).unwrap()
}

#[test]
fn the_cpi_is_the_sdk_instruction_byte_for_byte() {
    let f = fixture();
    let mint = Keypair::new_from_array(FIXTURE_MINT_SEED).pubkey();
    assert_eq!(f["burnReceiptsProgramId"].as_str().unwrap(), burn_receipts::ID.to_string(), "regenerate the fixture after a program-id change");
    assert_eq!(f["mint"].as_str().unwrap(), mint.to_string());
    let fee = fee_pda(&mint);
    let ix = burn_receipts::instructions::claim_launchlab::launchlab_claim_ix(&fee, &launchlab_auth(), &launchlab_creator_vault(&fee), &get_associated_token_address(&fee, &NATIVE_MINT));
    assert_eq!(ix.program_id.to_string(), f["programId"].as_str().unwrap());
    let keys = f["keys"].as_array().unwrap();
    assert_eq!(ix.accounts.len(), keys.len());
    for (m, k) in ix.accounts.iter().zip(keys) {
        assert_eq!(m.pubkey.to_string(), k["pubkey"].as_str().unwrap());
        assert_eq!(m.is_signer, k["isSigner"].as_bool().unwrap(), "{}", m.pubkey);
        assert_eq!(m.is_writable, k["isWritable"].as_bool().unwrap(), "{}", m.pubkey);
    }
    let hex: String = ix.data.iter().map(|b| format!("{b:02x}")).collect();
    assert_eq!(hex, f["dataHex"].as_str().unwrap());
}

fn load_mock(env: &mut Env) {
    let p = format!("{}/../../fixtures/launchlab_mock.so", env!("CARGO_MANIFEST_DIR"));
    let so = std::fs::read(&p).expect("run scripts/build-cpmm-fixture.sh (builds the LaunchLab stand-in)");
    env.svm.add_program(LAUNCHLAB_PROGRAM_ID, &so).unwrap();
}

/// LaunchLab's creator vault for (fee PDA, WSOL) holding `amount` WSOL, authority = LaunchLab's vault-auth PDA.
fn put_creator_vault(env: &mut Env, fee: &Pubkey, amount: u64) {
    let rent = 2_039_280u64;
    let mut data = vec![0u8; spl_token::state::Account::LEN];
    spl_token::state::Account {
        mint: NATIVE_MINT,
        owner: launchlab_auth(),
        amount,
        delegate: None.into(),
        state: spl_token::state::AccountState::Initialized,
        is_native: Some(rent).into(),
        delegated_amount: 0,
        close_authority: None.into(),
    }
    .pack_into_slice(&mut data);
    env.svm.set_account(launchlab_creator_vault(fee), litesvm_account(rent + amount, data, spl_token::ID)).unwrap();
}

#[test]
fn claim_moves_the_curve_creator_fee_into_the_fee_pdas_wsol_account_only() {
    let mut env = Env::new();
    load_mock(&mut env);
    let (mint, creator, a) = (Keypair::new_from_array(FIXTURE_MINT_SEED), Keypair::new(), Keypair::new());
    let payer = env.payer.pubkey();
    env.ok(&[ix_initialize(&payer, &creator.pubkey(), &mint.pubkey(), init_args(buyback_rule(), vec![a.pubkey()], 1))], &[&creator, &mint]);
    let m = mint.pubkey();
    let fee = fee_pda(&m);
    // Before the recipient ATA exists the claim is refused (nothing may be paid from the fee PDA to create it).
    put_creator_vault(&mut env, &fee, 3 * SOL);
    expect_anchor_err(env.send(&[ix_claim_launchlab(&payer, &m)], &[]), "AccountNotInitialized");
    let fee_wsol = env.create_ata(&fee, &NATIVE_MINT);
    let lamports_before = env.lamports(&fee);
    let meta = env.ok(&[ix_claim_launchlab(&payer, &m)], &[]);
    assert_eq!(env.token_amount(&fee_wsol), 3 * SOL);
    assert_eq!(env.lamports(&fee), lamports_before, "the fee PDA paid nothing");
    let ev = events(&meta).into_iter().find(|(d, _)| d[..] == LaunchLabCreatorFeeClaimed::DISCRIMINATOR[..]).unwrap();
    let e = LaunchLabCreatorFeeClaimed::try_from_slice(&ev.1).unwrap();
    assert_eq!((e.claimed_lamports, e.caller), (3 * SOL, payer));
    // The executed CPI matches the SDK fixture's keys and data (signer/writable flags are pinned by the builder test above and
    // enforced by the stand-in).
    let f = fixture();
    let ll = meta
        .inner_instructions
        .iter()
        .flatten()
        .find(|ii| env.last_keys[ii.instruction.program_id_index as usize] == LAUNCHLAB_PROGRAM_ID)
        .expect("a CPI into LaunchLab");
    let keys: Vec<String> = ll.instruction.accounts.iter().map(|i| env.last_keys[*i as usize].to_string()).collect();
    let want: Vec<String> = f["keys"].as_array().unwrap().iter().map(|k| k["pubkey"].as_str().unwrap().to_string()).collect();
    assert_eq!(keys, want);
    let hex: String = ll.instruction.data.iter().map(|b| format!("{b:02x}")).collect();
    assert_eq!(hex, f["dataHex"].as_str().unwrap());
    // An empty vault claims zero, harmlessly.
    let meta = env.ok(&[ix_claim_launchlab(&payer, &m)], &[]);
    let ev = events(&meta).into_iter().find(|(d, _)| d[..] == LaunchLabCreatorFeeClaimed::DISCRIMINATOR[..]).unwrap();
    assert_eq!(LaunchLabCreatorFeeClaimed::try_from_slice(&ev.1).unwrap().claimed_lamports, 0);
}

#[test]
fn claim_accepts_no_substitute_accounts() {
    let mut env = Env::new();
    load_mock(&mut env);
    let (mint, creator, a) = (Keypair::new(), Keypair::new(), Keypair::new());
    let payer = env.payer.pubkey();
    env.ok(&[ix_initialize(&payer, &creator.pubkey(), &mint.pubkey(), init_args(buyback_rule(), vec![a.pubkey()], 1))], &[&creator, &mint]);
    let m = mint.pubkey();
    let fee = fee_pda(&m);
    env.create_ata(&fee, &NATIVE_MINT);
    let attacker = Keypair::new().pubkey();
    let attacker_wsol = env.create_ata(&attacker, &NATIVE_MINT);
    let base = ix_claim_launchlab(&payer, &m);
    let swap_key = |ix: &anchor_lang::solana_program::instruction::Instruction, from: Pubkey, to: Pubkey| {
        let mut ix = ix.clone();
        for k in ix.accounts.iter_mut() {
            if k.pubkey == from {
                k.pubkey = to;
            }
        }
        ix
    };
    // Another recipient, another creator vault, another "LaunchLab" program: all refused by the program's constraints.
    let out = expect_fail(env.send(&[swap_key(&base, get_associated_token_address(&fee, &NATIVE_MINT), attacker_wsol)], &[]));
    assert!(out.contains("Error Code: Constraint"), "{out}");
    expect_anchor_err(env.send(&[swap_key(&base, launchlab_creator_vault(&fee), Pubkey::new_unique())], &[]), "ConstraintSeeds");
    expect_anchor_err(env.send(&[swap_key(&base, LAUNCHLAB_PROGRAM_ID, CPMM_PROGRAM_ID)], &[]), "InvalidLaunchLabAccount");
    // Review-2 F13: the fee PDA's token account must be its own ATA, and no extra (remaining) accounts are accepted.
    expect_anchor_err(env.send(&[swap_key(&base, get_associated_token_address(&fee, &m), Pubkey::new_unique())], &[]), "ConstraintAddress");
    let mut extra = base.clone();
    extra.accounts.push(anchor_lang::solana_program::instruction::AccountMeta::new(Pubkey::new_unique(), false));
    expect_anchor_err(env.send(&[extra], &[]), "UnexpectedAccounts");
}

/// Review-2 F13: the claim leaves the fee PDA's token balance (CPMM creator fees in the token) untouched — and the program checks.
#[test]
fn claim_leaves_the_fee_pdas_token_account_untouched() {
    let mut env = Env::new();
    load_mock(&mut env);
    let (mint, creator, a) = (Keypair::new(), Keypair::new(), Keypair::new());
    let payer = env.payer.pubkey();
    env.ok(&[ix_initialize(&payer, &creator.pubkey(), &mint.pubkey(), init_args(buyback_rule(), vec![a.pubkey()], 1))], &[&creator, &mint]);
    let m = mint.pubkey();
    env.create_mint(&mint, &payer, DECIMALS);
    let fee = fee_pda(&m);
    env.create_ata(&fee, &NATIVE_MINT);
    let fee_tokens = env.create_ata(&fee, &m);
    let me = env.payer.insecure_clone();
    env.mint_to(&m, &me, &fee_tokens, 777 * TOKEN);
    put_creator_vault(&mut env, &fee, SOL);
    env.ok(&[ix_claim_launchlab(&payer, &m)], &[]);
    assert_eq!(env.token_amount(&fee_tokens), 777 * TOKEN);
}

/// Review-2 F5: the byte offsets the program reads from LaunchLab's LaunchpadPool and PlatformConfig are the SDK's own
/// (fixtures/launchlab-accounts-sdk.json: accounts ENCODED by @raydium-io/raydium-sdk-v2's layouts, with its offsetOf()).
#[test]
fn launchlab_account_offsets_are_the_sdks() {
    let p = format!("{}/../../fixtures/launchlab-accounts-sdk.json", env!("CARGO_MANIFEST_DIR"));
    let f: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&p).expect("run scripts/launchlab-sdk-fixture.mjs")).unwrap();
    let off = |k: &str| f["pool"]["offsets"][k].as_u64().unwrap() as usize;
    assert_eq!((off("migrateType"), off("platformId"), off("mintA"), off("mintB"), off("creator")), (LL_POOL_MIGRATE_TYPE, LL_POOL_PLATFORM_ID, LL_POOL_MINT_A, LL_POOL_MINT_B, LL_POOL_CREATOR));
    assert_eq!(f["platform"]["offsets"]["cpConfigId"].as_u64().unwrap() as usize, LL_PLATFORM_CP_CONFIG_ID);
    assert!(f["pool"]["span"].as_u64().unwrap() as usize >= LL_POOL_MIN_LEN && f["platform"]["span"].as_u64().unwrap() as usize >= LL_PLATFORM_MIN_LEN);
    let hex = |s: &str| (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap()).collect::<Vec<u8>>();
    let pool = hex(f["pool"]["dataHex"].as_str().unwrap());
    let platform = hex(f["platform"]["dataHex"].as_str().unwrap());
    let key = |d: &[u8], at: usize| Pubkey::new_from_array(d[at..at + 32].try_into().unwrap()).to_string();
    let mint = Keypair::new_from_array(FIXTURE_MINT_SEED).pubkey();
    assert_eq!(f["mint"].as_str().unwrap(), mint.to_string());
    assert_eq!(pool[LL_POOL_MIGRATE_TYPE], LL_MIGRATE_TYPE_CPMM);
    assert_eq!(key(&pool, LL_POOL_PLATFORM_ID), f["platformId"].as_str().unwrap());
    assert_eq!(key(&pool, LL_POOL_MINT_A), mint.to_string());
    assert_eq!(key(&pool, LL_POOL_MINT_B), NATIVE_MINT.to_string());
    assert_eq!(key(&pool, LL_POOL_CREATOR), fee_pda(&mint).to_string());
    assert_eq!(key(&platform, LL_PLATFORM_CP_CONFIG_ID), f["cpConfigId"].as_str().unwrap());
    // The LaunchLab pool PDA the program derives is the SDK's getPdaLaunchpadPoolId.
    assert_eq!(launchlab_pool_pda(&mint).to_string(), f["launchpadPoolPda"].as_str().unwrap());
}
