//! The "no room for operator corruption" checks (the owner's 10-09 requirements) and the generic N-of-M ed25519 attester model.

// LiteSVM's FailedTransactionMetadata is large by design; test helpers take many accounts.
#![allow(clippy::result_large_err, clippy::too_many_arguments)]

mod common;

use anchor_lang::prelude::Pubkey;
use anchor_lang::AnchorDeserialize;
use anchor_spl::associated_token::get_associated_token_address;
use burn_receipts::constants::*;
use burn_receipts::events::{AttesterChangeProposed, ReadingProcessed, ReadingSubmitted};
use burn_receipts::state::AttesterEntry;
use common::cpmm;
use common::*;
use solana_keypair::Keypair;
use solana_signer::Signer;

const V1: u64 = 4_027_300_000_000_000;
const D1: u32 = 20261005;
const D2: u32 = 20261006;
const D3: u32 = 20261007;

fn mk_init(env: &mut Env, mint: &Keypair, creator: &Keypair, rule: burn_receipts::state::RuleParams, entries: Vec<AttesterEntry>, quorum: u8) -> TxResult {
    let payer = env.payer.pubkey();
    env.send(&[ix_initialize(&payer, &creator.pubkey(), &mint.pubkey(), init_args_entries(rule, entries, quorum))], &[creator, mint])
}

// ================================================================================================================================
// Generic attesters: N-of-M ed25519 keys with informational kind tags; signatures over (feed, period, value, source hash, proof hash)
// ================================================================================================================================

#[test]
fn two_operators_and_a_zktls_relayer_quorum_2() {
    let mut env = Env::new();
    let (mint, creator) = (Keypair::new(), Keypair::new());
    let (keeper, op2, relayer) = (Keypair::new(), Keypair::new(), Keypair::new());
    let entries = vec![
        AttesterEntry { kind: ATTESTER_OPERATOR, key: keeper.pubkey() },
        AttesterEntry { kind: ATTESTER_OPERATOR, key: op2.pubkey() },
        AttesterEntry { kind: ATTESTER_ZKTLS_RELAYER, key: relayer.pubkey() },
    ];
    mk_init(&mut env, &mint, &creator, vault_rule(), entries.clone(), 2).unwrap();
    let m = mint.pubkey();
    let cfg = config_pda(&m);
    assert_eq!(env.config(&cfg).attester_slice(), &entries[..]);
    let payer = env.payer.pubkey();
    let src = src_hash();
    let proof = [0xAB; 32];
    let send = |env: &mut Env, date: u32, value: u64, signed_src: [u8; 32], signed_proof: [u8; 32], sent_src: [u8; 32], sent_proof: [u8; 32], who: &[&Keypair]| {
        let msg = message_h(&m, prev_of(env, &m), date, value, &signed_src, &signed_proof);
        let e: Vec<_> = who.iter().map(|k| (k.pubkey(), sign(k, &msg))).collect();
        env.send(&[ed25519_shared(&e, &msg), ix_submit_h(&payer, &m, date, value, sent_src, sent_proof)], &[])
    };
    // keeper + relayer agree on the value, the source URL and the proof → accepted; both bits recorded with the hashes.
    let meta = send(&mut env, D1, V1, src, proof, src, proof, &[&keeper, &relayer]).unwrap();
    let r = env.reading(&reading_pda(&cfg, D1)).unwrap();
    assert_eq!((r.signers_mask, r.source_url_hash, r.proof_hash), (0b101, src, proof));
    let ev = ReadingSubmitted::try_from_slice(&events(&meta)[0].1).unwrap();
    assert_eq!((ev.source_url_hash, ev.proof_hash, ev.signers_mask), (src, proof, 0b101));
    // One signature is not a quorum.
    expect_anchor_err(send(&mut env, D2, V1 + UNIT, src, proof, src, proof, &[&op2]), "QuorumNotMet");
    // Signatures over a different source hash or proof locator do not count for the one submitted.
    expect_anchor_err(send(&mut env, D2, V1 + UNIT, [1; 32], proof, src, proof, &[&keeper, &op2]), "QuorumNotMet");
    expect_anchor_err(send(&mut env, D2, V1 + UNIT, src, [2; 32], src, proof, &[&keeper, &op2]), "QuorumNotMet");
    // The source hash is mandatory (the proof locator is optional).
    expect_anchor_err(send(&mut env, D2, V1 + UNIT, [0; 32], [0; 32], [0; 32], [0; 32], &[&keeper, &op2]), "InvalidValue");
    // Two operators, no proof → accepted.
    send(&mut env, D2, V1 + UNIT, src, [0; 32], src, [0; 32], &[&keeper, &op2]).unwrap();
    assert_eq!(env.reading(&reading_pda(&cfg, D2)).unwrap().signers_mask, 0b011);
}

#[test]
fn malformed_attester_sets_are_refused_at_init() {
    let mut env = Env::new();
    let k = Pubkey::new_unique();
    for (entries, quorum) in [
        (vec![AttesterEntry { kind: 3, key: k }], 1),                                       // unknown kind
        (vec![AttesterEntry { kind: ATTESTER_ORACLE, key: Pubkey::default() }], 1),        // default key
        (vec![AttesterEntry::operator(k), AttesterEntry { kind: ATTESTER_ORACLE, key: k }], 1), // same key twice
        (vec![AttesterEntry::operator(k)], 2),                                             // quorum above count
        (vec![AttesterEntry::operator(k)], 0),                                             // quorum zero
        ((0..6).map(|_| AttesterEntry::operator(Pubkey::new_unique())).collect(), 1),       // more than 5
    ] {
        let (mint, creator) = (Keypair::new(), Keypair::new());
        expect_anchor_err(mk_init(&mut env, &mint, &creator, vault_rule(), entries, quorum), "InvalidAttesters");
    }
}

// ================================================================================================================================
// Append-only readings
// ================================================================================================================================

#[test]
fn readings_are_append_only() {
    let mut env = Env::new();
    let (mint, creator, a) = (Keypair::new(), Keypair::new(), Keypair::new());
    mk_init(&mut env, &mint, &creator, vault_rule(), ed(&[a.pubkey()]), 1).unwrap();
    let m = mint.pubkey();
    let cfg = config_pda(&m);
    submit(&mut env, &m, D1, V1, &[&a]).unwrap();
    let r1 = env.svm.get_account(&reading_pda(&cfg, D1)).unwrap();
    // Re-submitting the same reading changes nothing — not one byte, not one lamport.
    env.set_time(NOW + 3_600);
    submit(&mut env, &m, D1, V1, &[&a]).unwrap();
    assert_eq!(env.svm.get_account(&reading_pda(&cfg, D1)).unwrap(), r1);
    // A different value for a written date is refused; an older date can never be inserted.
    expect_anchor_err(submit(&mut env, &m, D1, V1 + 1, &[&a]), "ConflictingReading");
    submit(&mut env, &m, D2, V1 + 2 * UNIT, &[&a]).unwrap();
    expect_anchor_err(submit(&mut env, &m, 20261001, V1, &[&a]), "StaleReading");
    // After processing, a re-submission does not reopen it.
    mint_or_create_simple(&mut env, &mint);
    env.create_ata(&cfg, &m);
    env.ok(&[ix_crank_vault(&env.payer.pubkey(), &m, D2)], &[]);
    let r2 = env.svm.get_account(&reading_pda(&cfg, D2)).unwrap();
    submit(&mut env, &m, D2, V1 + 2 * UNIT, &[&a]).unwrap();
    assert_eq!(env.svm.get_account(&reading_pda(&cfg, D2)).unwrap(), r2);
    expect_anchor_err(env.send(&[ix_crank_vault(&env.payer.pubkey(), &m, D2)], &[]), "AlreadyProcessed");
}

fn mint_or_create_simple(env: &mut Env, mint: &Keypair) {
    let auth = env.payer.pubkey();
    env.create_mint(mint, &auth, DECIMALS);
}

// ================================================================================================================================
// Attester governance: quorum floor, rotation, events
// ================================================================================================================================

#[test]
fn quorum_never_lowered_and_set_never_below_quorum() {
    let mut env = Env::new();
    let (mint, creator) = (Keypair::new(), Keypair::new());
    let ks: Vec<Keypair> = (0..3).map(|_| Keypair::new()).collect();
    mk_init(&mut env, &mint, &creator, vault_rule(), ed(&ks.iter().map(|k| k.pubkey()).collect::<Vec<_>>()), 2).unwrap();
    let m = mint.pubkey();
    let c = creator.pubkey();
    // 2-of-3 → 1-of-1 refused; → 1-of-3 refused; → 2-of-1 refused.
    expect_anchor_err(env.send(&[ix_admin("propose", &c, &m, ed(&[ks[0].pubkey()]), 1)], &[&creator]), "QuorumLowered");
    expect_anchor_err(env.send(&[ix_admin("propose", &c, &m, ed(&ks.iter().map(|k| k.pubkey()).collect::<Vec<_>>()), 1)], &[&creator]), "QuorumLowered");
    expect_anchor_err(env.send(&[ix_admin("propose", &c, &m, ed(&[ks[0].pubkey()]), 2)], &[&creator]), "InvalidAttesters");
    // Rotating a compromised key out (keeping 2-of-3) and adding a zkTLS relayer (raising to 3-of-4) are allowed — once the kept keys
    // have been in the set ≥ 7 days (review-3 L-2).
    env.set_time(NOW + ATTESTER_SENIORITY_SECS);
    let fresh = Keypair::new();
    let relayer = AttesterEntry { kind: ATTESTER_ZKTLS_RELAYER, key: Pubkey::new_unique() };
    let set = vec![AttesterEntry::operator(ks[0].pubkey()), AttesterEntry::operator(ks[1].pubkey()), AttesterEntry::operator(fresh.pubkey()), relayer];
    let meta = env.ok(&[ix_admin("propose", &c, &m, set.clone(), 3)], &[&creator]);
    let ev = events(&meta);
    let p = AttesterChangeProposed::try_from_slice(&ev[0].1).unwrap();
    assert_eq!(p.added, vec![AttesterEntry::operator(fresh.pubkey()), relayer]);
    assert_eq!(p.removed, vec![AttesterEntry::operator(ks[2].pubkey())]);
    assert_eq!((p.quorum, p.eta, p.proposed_by), (3, NOW + ATTESTER_SENIORITY_SECS + ATTESTER_TIMELOCK_SECS, c));
    env.set_time(NOW + ATTESTER_SENIORITY_SECS + ATTESTER_TIMELOCK_SECS);
    let meta = env.ok(&[ix_apply(&env.payer.pubkey(), &m)], &[]);
    assert_eq!(event_names(&meta), vec!["AttesterChangeApplied"]);
    let cfg = env.config(&config_pda(&m));
    assert_eq!((cfg.attester_slice().to_vec(), cfg.quorum), (set, 3));
}

#[test]
fn every_state_change_emits_an_event() {
    let mut env = Env::new();
    let t_mint = Keypair::new();
    let creator = Keypair::new();
    let a = Keypair::new();
    let payer = env.payer.pubkey();
    // init
    let meta = env.ok(&[ix_initialize(&payer, &creator.pubkey(), &t_mint.pubkey(), init_args(buyback_rule(), vec![a.pubkey()], 1))], &[&creator, &t_mint]);
    assert_eq!(event_names(&meta), vec!["TokenInitialized"]);
    let m = t_mint.pubkey();
    // pool + register
    let auth = env.payer.pubkey();
    env.create_mint(&t_mint, &auth, DECIMALS);
    let launcher = Keypair::new();
    env.fund(&launcher.pubkey(), 200 * SOL);
    let amm = cpmm::setup_amm(&mut env, &launcher.pubkey());
    let lt = env.create_ata(&launcher.pubkey(), &m);
    env.mint_to(&m, &env.payer.insecure_clone(), &lt, 800_000_000 * TOKEN);
    let pool = cpmm::create_pool(&mut env, &launcher, &amm, &m, &fee_pda(&m), 85 * SOL, 800_000_000 * TOKEN, &lt);
    let pa = Keypair::new();
    let ua = env.upgrade_authority.insecure_clone();
    let meta = env.ok(&[ix_initialize_platform(&payer, &ua.pubkey(), &pa.pubkey(), DEFAULT_BURN_POOL_CAP_LAMPORTS, NOW + 86_400)], &[&ua]);
    assert_eq!(event_names(&meta), vec!["PlatformInitialized"]);
    cpmm::launchlab_migrated(&mut env, &m, &pool);
    let meta = env.ok(&[ix_register_pool(&payer, &m, &pool.pool)], &[]);
    assert_eq!(event_names(&meta), vec!["PoolRegistered"]);
    env.create_ata(&fee_pda(&m), &NATIVE_MINT);
    env.create_ata(&fee_pda(&m), &m);
    env.transfer_sol(&fee_pda(&m), 3 * SOL);
    cpmm::seed_history(&mut env, &pool, &m);
    // readings: baseline (submitted + auto-processed), a units day (submitted), a zero day behind it (submitted only)
    let sub = |env: &mut Env, d: u32, v: u64| {
        let mm = message(&m, prev_of(env, &m), d, v);
        let ix0 = ed25519_ix(&[(a.pubkey(), sign(&a, &mm), mm.clone())]);
        let p = env.payer.pubkey();
        env.ok(&[ix0, ix_submit(&p, &m, d, v)], &[])
    };
    assert_eq!(event_names(&sub(&mut env, D1, V1)), vec!["ReadingSubmitted", "ReadingProcessed"]);
    let meta = sub(&mut env, D2, V1 + 2 * UNIT);
    assert_eq!(event_names(&meta), vec!["ReadingSubmitted"]);
    let rs = ReadingSubmitted::try_from_slice(&events(&meta)[0].1).unwrap();
    assert_eq!((rs.record_date, rs.units, rs.value, rs.signers_mask, rs.submitter), (D2, 2, V1 + 2 * UNIT, 1, payer));
    assert_eq!(event_names(&sub(&mut env, D3, V1 + 2 * UNIT)), vec!["ReadingSubmitted"]);
    // cranks
    env.set_time(env.now() + 10);
    let meta = env.ok(&[cpmm::ix_crank_buyback(&payer, &m, &pool, D2)], &[]);
    assert!(event_names(&meta).contains(&"ReadingProcessed"));
    let rp = ReadingProcessed::try_from_slice(&events(&meta).last().unwrap().1).unwrap();
    let r = env.reading(&reading_pda(&config_pda(&m), D2)).unwrap();
    assert_eq!((rp.record_date, rp.outcome, rp.spent_lamports, rp.burned), (D2, OUTCOME_BURNED, r.spent_lamports, r.burned));
    assert_eq!(event_names(&env.ok(&[ix_crank_no_units(&payer, &m, D3)], &[])), vec!["ReadingProcessed"]);
    // admin (review-3 L-2: adding a key needs kept keys ≥ 7 days old)
    env.set_time(env.now() + ATTESTER_SENIORITY_SECS);
    let c = creator.pubkey();
    assert_eq!(event_names(&env.ok(&[ix_admin("propose", &c, &m, ed(&[a.pubkey(), Pubkey::new_unique()]), 2)], &[&creator])), vec!["AttesterChangeProposed"]);
    assert_eq!(event_names(&env.ok(&[ix_admin("cancel", &c, &m, vec![], 0)], &[&creator])), vec!["AttesterChangeCancelled"]);
    env.ok(&[ix_admin("propose", &c, &m, ed(&[a.pubkey(), Pubkey::new_unique()]), 2)], &[&creator]);
    assert_eq!(event_names(&env.ok(&[ix_admin("renounce", &c, &m, vec![], 0)], &[&creator])), vec!["AttesterChangeCancelled", "AdminRenounced"]);
    let _ = get_associated_token_address(&c, &m);
}

/// The vault and the fee PDA's token accounts can only lose tokens through the program's burn: nobody can sign a transfer, an
/// approval, a close or an authority change for them (their authority is a PDA the program never signs for outside a burn).
#[test]
fn program_token_accounts_cannot_be_moved_closed_or_reassigned() {
    use anchor_spl::token::spl_token;
    let mut env = Env::new();
    let (mint, creator, a) = (Keypair::new(), Keypair::new(), Keypair::new());
    mk_init(&mut env, &mint, &creator, vault_rule(), ed(&[a.pubkey()]), 1).unwrap();
    let m = mint.pubkey();
    let auth = env.payer.pubkey();
    env.create_mint(&mint, &auth, DECIMALS);
    let cfg = config_pda(&m);
    let vault = env.create_ata(&cfg, &m);
    env.mint_to(&m, &env.payer.insecure_clone(), &vault, 1_000 * TOKEN);
    let thief = env.create_ata(&auth, &m);
    let unsigned = |mut ix: anchor_lang::solana_program::instruction::Instruction, signer: &Pubkey| {
        for k in ix.accounts.iter_mut() {
            if k.pubkey == *signer {
                k.is_signer = false;
            }
        }
        ix
    };
    let attempts = [
        spl_token::instruction::transfer(&spl_token::ID, &vault, &thief, &cfg, &[], 1).unwrap(),
        spl_token::instruction::approve(&spl_token::ID, &vault, &auth, &cfg, &[], 1).unwrap(),
        spl_token::instruction::close_account(&spl_token::ID, &vault, &auth, &cfg, &[]).unwrap(),
        spl_token::instruction::set_authority(&spl_token::ID, &vault, Some(&auth), spl_token::instruction::AuthorityType::AccountOwner, &cfg, &[]).unwrap(),
        spl_token::instruction::burn(&spl_token::ID, &vault, &m, &cfg, &[], 1).unwrap(),
    ];
    for ix in attempts {
        expect_fail(env.send(&[unsigned(ix, &cfg)], &[]));
    }
    assert_eq!(env.token_amount(&vault), 1_000 * TOKEN);
}
