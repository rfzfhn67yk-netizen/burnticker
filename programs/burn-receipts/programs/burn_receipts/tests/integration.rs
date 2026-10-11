//! burn_receipts integration suite (LiteSVM, in-process; `anchor test` runs it after `anchor build`).
//!
//! Requires target/deploy/burn_receipts.so (anchor build) and fixtures/raydium_cp_swap.so (scripts/build-cpmm-fixture.sh — the real
//! Raydium CPMM built from its pinned source).

// LiteSVM's FailedTransactionMetadata is large by design; test helpers take many accounts.
#![allow(clippy::result_large_err, clippy::too_many_arguments)]

mod common;

use anchor_lang::prelude::Pubkey;
use anchor_lang::solana_program::instruction::Instruction;
use anchor_lang::{InstructionData, ToAccountMetas};
use anchor_spl::associated_token::get_associated_token_address;
use burn_receipts::constants::*;
use burn_receipts::math;
use common::cpmm::{self, Pool};
use common::*;
use solana_keypair::Keypair;
use solana_signer::Signer;

// Treasury-shaped readings (cents).
const D1: u32 = 20261005;
const D2: u32 = 20261006;
const D3: u32 = 20261007;
const D4: u32 = 20261008;
const V1: u64 = 4_027_300_000_000_000; // $40.273T baseline
const V2: u64 = 4_028_403_614_736_719; // +$11.036B → 11 units
const V3: u64 = 4_030_531_621_082_972; // +$21.280B (+0.036 carried) → 21 units

struct Token {
    mint: Keypair,
    authority: Keypair,
    creator: Keypair,
    attesters: Vec<Keypair>,
}

fn new_token(n_attesters: usize) -> Token {
    Token { mint: Keypair::new(), authority: Keypair::new(), creator: Keypair::new(), attesters: (0..n_attesters).map(|_| Keypair::new()).collect() }
}

fn init(env: &mut Env, t: &Token, rule: burn_receipts::state::RuleParams, quorum: u8) -> TxResult {
    let args = init_args(rule, t.attesters.iter().map(|k| k.pubkey()).collect(), quorum);
    let payer = env.payer.pubkey();
    env.send(&[ix_initialize(&payer, &t.creator.pubkey(), &t.mint.pubkey(), args)], &[&t.creator, &t.mint])
}


// ================================================================================================================================
// initialize_token
// ================================================================================================================================

#[test]
fn init_buyback_mode_records_rule_and_funds_fee_pda() {
    let mut env = Env::new();
    let t = new_token(1);
    // initialize_token runs BEFORE the mint exists (the launchpad flow: right before LaunchLab's create).
    assert!(env.svm.get_account(&t.mint.pubkey()).is_none());
    init(&mut env, &t, buyback_rule(), 1).map_err(|e| e.meta.logs.join("\n")).unwrap();
    let c = env.config(&config_pda(&t.mint.pubkey()));
    assert_eq!(c.mint, t.mint.pubkey());
    assert_eq!(c.creator, t.creator.pubkey());
    assert_eq!(c.admin, t.creator.pubkey());
    assert_eq!(c.rule, buyback_rule());
    assert_eq!(c.attester_slice(), &ed(&[t.attesters[0].pubkey()])[..]);
    assert_eq!(c.quorum, 1);
    assert_eq!(c.feed_id_str(), FEED);
    assert_eq!(c.memo_prefix_str(), "DEBT");
    assert_eq!(c.memo_source_str(), SRC);
    assert_eq!(c.rules_sha256, rules_sha256());
    assert_eq!(c.cpmm_pool, Pubkey::default());
    assert_eq!(env.lamports(&fee_pda(&t.mint.pubkey())), buyback_rule().reserve_lamports);

    // params_hash = sha256(domain ‖ mint ‖ borsh(rule) ‖ feed ‖ "|" ‖ prefix ‖ "|" ‖ source ‖ rules_sha256) — reproducible off chain.
    use sha2::Digest;
    let mut h = sha2::Sha256::new();
    h.update(PARAMS_HASH_DOMAIN);
    h.update(t.mint.pubkey().as_ref());
    h.update(anchor_lang::prelude::borsh::to_vec(&buyback_rule()).unwrap());
    h.update(FEED.as_bytes());
    h.update(b"|");
    h.update(b"DEBT");
    h.update(b"|");
    h.update(SRC.as_bytes());
    h.update(rules_sha256());
    let want: [u8; 32] = h.finalize().into();
    assert_eq!(c.params_hash, want);
}

#[test]
fn init_vault_mode() {
    let mut env = Env::new();
    let t = new_token(3);
    init(&mut env, &t, vault_rule(), 2).unwrap();
    let c = env.config(&config_pda(&t.mint.pubkey()));
    assert_eq!(c.rule.mode, MODE_VAULT);
    assert_eq!(c.attester_count, 3);
    assert_eq!(c.quorum, 2);
}

#[test]
fn init_refuses_bad_parameters_and_a_second_init() {
    let mut env = Env::new();
    let t = new_token(2);
    let mut r = buyback_rule();
    r.fraction_per_unit_bps = 0;
    expect_anchor_err(init(&mut env, &t, r, 1), "InvalidRule");
    let mut r = buyback_rule();
    r.reserve_lamports = 1;
    expect_anchor_err(init(&mut env, &t, r, 1), "ReserveBelowRent");
    let mut r = vault_rule();
    r.fraction_per_unit_bps = 500; // buyback field set in vault mode
    expect_anchor_err(init(&mut env, &t, r, 1), "InvalidRule");
    expect_anchor_err(init(&mut env, &t, buyback_rule(), 3), "InvalidAttesters"); // quorum > count
    let dup = init_args(buyback_rule(), vec![t.attesters[0].pubkey(), t.attesters[0].pubkey()], 1);
    let payer = env.payer.pubkey();
    expect_anchor_err(env.send(&[ix_initialize(&payer, &t.creator.pubkey(), &t.mint.pubkey(), dup)], &[&t.creator, &t.mint]), "InvalidAttesters");
    let mut bad = init_args(buyback_rule(), vec![t.attesters[0].pubkey()], 1);
    bad.feed_id = "has|pipe".into();
    expect_anchor_err(env.send(&[ix_initialize(&payer, &t.creator.pubkey(), &t.mint.pubkey(), bad)], &[&t.creator, &t.mint]), "InvalidFeedId");
    // Review H-1 / L-7 / review-2 F1: the TWAP guard is mandatory — deviation ≤ 300 bps, window 600..=1,200 s, and deviation and
    // slippage each cover 15 s of the window (≥ 250 bps at 600 s, ≥ 125 bps at 1,200 s); slippage ≤ 300 bps; floor > 0 (F7).
    for (dev, win, slip, floor) in [
        (0u16, 600u32, 300u16, 1u64),
        (301, 600, 300, 1),
        (300, 599, 300, 1),
        (300, 1_201, 300, 1),
        (249, 600, 300, 1),
        (300, 600, 249, 1),
        (124, 1_200, 300, 1),
        (300, 600, 301, 1),
        (300, 600, 300, 0),
    ] {
        let r = burn_receipts::state::RuleParams { max_twap_deviation_bps: dev, twap_window_secs: win, slippage_bps: slip, floor_lamports: floor, ..buyback_rule() };
        expect_anchor_err(init(&mut env, &t, r, 1), "InvalidRule");
    }
    // Review I-4: a vault-mode fee PDA is never funded.
    let r = burn_receipts::state::RuleParams { reserve_lamports: 1_000_000, ..vault_rule() };
    expect_anchor_err(init(&mut env, &t, r, 1), "InvalidRule");
    // Review L-4: the largest possible vault day must fit in u64.
    let r = burn_receipts::state::RuleParams { unit_value: 1, max_abs_delta: i64::MAX as u64, tokens_per_unit: 100_000_000_000, ..vault_rule() };
    expect_anchor_err(init(&mut env, &t, r, 1), "InvalidRule");
    // Review L-2: the config authority must be explicit.
    let no_admin = init_args(buyback_rule(), vec![t.attesters[0].pubkey()], 1);
    expect_anchor_err(env.send(&[ix_initialize_raw(&payer, &t.creator.pubkey(), &t.mint.pubkey(), no_admin)], &[&t.creator, &t.mint]), "AdminRequired");

    init(&mut env, &t, buyback_rule(), 1).unwrap();
    expect_fail(init(&mut env, &t, buyback_rule(), 1)); // the config PDA exists: one config per mint, ever
}

#[test]
fn init_requires_the_mint_signature() {
    let mut env = Env::new();
    let t = new_token(1);
    let payer = env.payer.pubkey();
    let mut ix = ix_initialize(&payer, &t.creator.pubkey(), &t.mint.pubkey(), init_args(buyback_rule(), vec![t.attesters[0].pubkey()], 1));
    for m in ix.accounts.iter_mut() {
        if m.pubkey == t.mint.pubkey() {
            m.is_signer = false;
        }
    }
    expect_anchor_err(env.send(&[ix], &[&t.creator]), "AccountNotSigner");
}

// ================================================================================================================================
// submit_reading
// ================================================================================================================================

#[test]
fn quorum_signed_readings_compute_units_and_carry() {
    let mut env = Env::new();
    let t = new_token(3);
    init(&mut env, &t, vault_rule(), 2).unwrap();
    let mint = t.mint.pubkey();
    let cfg = config_pda(&mint);

    submit(&mut env, &mint, D1, V1, &[&t.attesters[0], &t.attesters[2]]).unwrap();
    let r1 = env.reading(&reading_pda(&cfg, D1)).unwrap();
    assert_eq!((r1.kind, r1.units, r1.processed, r1.outcome), (KIND_BASELINE, 0, true, OUTCOME_NO_UNITS));
    assert_eq!(r1.signers_mask, 0b101);

    submit(&mut env, &mint, D2, V2, &[&t.attesters[1], &t.attesters[2]]).unwrap();
    let r2 = env.reading(&reading_pda(&cfg, D2)).unwrap();
    assert_eq!(r2.kind, KIND_INCREASE);
    assert_eq!(r2.delta as u64, V2 - V1);
    assert_eq!(r2.units, 11);
    assert_eq!(r2.carry_out, (V2 - V1) % UNIT);
    assert_eq!(r2.prev_date, D1);
    assert!(!r2.processed);

    submit(&mut env, &mint, D3, V3, &[&t.attesters[0], &t.attesters[1]]).unwrap();
    let r3 = env.reading(&reading_pda(&cfg, D3)).unwrap();
    let total = (V3 - V2) + r2.carry_out;
    assert_eq!(r3.carry_in, r2.carry_out);
    assert_eq!(r3.units, total / UNIT);
    assert_eq!(r3.carry_out, total % UNIT);

    // A down day burns nothing and resets the carry.
    submit(&mut env, &mint, D4, V3 - 5 * UNIT, &[&t.attesters[0], &t.attesters[1]]).unwrap();
    let r4 = env.reading(&reading_pda(&cfg, D4)).unwrap();
    assert_eq!((r4.kind, r4.units, r4.carry_out), (KIND_DOWN, 0, 0));
    let c = env.config(&cfg);
    assert_eq!((c.carry, c.last_record_date, c.last_value, c.readings), (0, D4, V3 - 5 * UNIT, 4));
    // Units reading D2 is still queued, so D3 and D4 wait behind it.
    assert_eq!(c.crank_cursor, D1);
}

#[test]
fn carry_accumulates_only_across_consecutive_increases() {
    let mut env = Env::new();
    let t = new_token(1);
    init(&mut env, &t, vault_rule(), 1).unwrap();
    let mint = t.mint.pubkey();
    let cfg = config_pda(&mint);
    let a = &t.attesters[0];
    let base = 4_000_000_000_000_000u64;
    let steps: [(u32, u64, u64, u64); 5] = [
        (20260901, base, 0, 0),
        (20260902, base + 60 * UNIT / 100, 0, 60 * UNIT / 100),               // +0.6B → carry 0.6B
        (20260903, base + 130 * UNIT / 100, 1, 30 * UNIT / 100),              // +0.7B → 1 unit, carry 0.3B
        (20260904, base + 120 * UNIT / 100, 0, 0),                            // −0.1B → reset
        (20260908, base + 200 * UNIT / 100, 0, 80 * UNIT / 100),              // +0.8B → 0 units (the 0.3B was lost)
    ];
    for (date, value, units, carry) in steps {
        submit(&mut env, &mint, date, value, &[a]).unwrap();
        let r = env.reading(&reading_pda(&cfg, date)).unwrap();
        assert_eq!((r.units, r.carry_out), (units, carry), "date {date}");
        // keep the queue moving so later zero-unit readings auto-process
        if r.units > 0 {
            let m = mint_or_create(&mut env, &t);
            env.create_ata(&cfg, &m); // an empty vault: the burn day is processed as a public shortfall
            let ix = ix_crank_vault(&env.payer.pubkey(), &mint, date);
            env.ok(&[ix], &[]);
        }
    }
}

/// Creates the mint lazily (vault-mode tests need it only once a burn happens).
fn mint_or_create(env: &mut Env, t: &Token) -> Pubkey {
    if env.svm.get_account(&t.mint.pubkey()).map(|a| a.data.is_empty()).unwrap_or(true) {
        let auth = t.authority.pubkey();
        env.create_mint(&t.mint, &auth, DECIMALS);
    }
    t.mint.pubkey()
}

#[test]
fn readings_without_quorum_or_with_wrong_message_are_refused() {
    let mut env = Env::new();
    let t = new_token(3);
    init(&mut env, &t, vault_rule(), 2).unwrap();
    let mint = t.mint.pubkey();
    let cfg = config_pda(&mint);
    let outsider = Keypair::new();

    expect_anchor_err(submit(&mut env, &mint, D1, V1, &[&t.attesters[0]]), "QuorumNotMet");
    expect_anchor_err(submit(&mut env, &mint, D1, V1, &[&t.attesters[0], &outsider]), "QuorumNotMet");
    // The same attester twice counts once.
    expect_anchor_err(submit(&mut env, &mint, D1, V1, &[&t.attesters[0], &t.attesters[0]]), "QuorumNotMet");
    // Valid signatures over a DIFFERENT value do not count for this value.
    let msg_other = message(&mint, 0, D1, V1 + 1);
    let entries: Vec<_> = [&t.attesters[0], &t.attesters[1]].iter().map(|k| (k.pubkey(), sign(k, &msg_other))).collect();
    let payer = env.payer.pubkey();
    expect_anchor_err(env.send(&[ed25519_shared(&entries, &msg_other), ix_submit(&payer, &mint, D1, V1)], &[]), "QuorumNotMet");
    // No ed25519 instruction at all.
    expect_anchor_err(env.send(&[ix_submit(&payer, &mint, D1, V1)], &[]), "QuorumNotMet");
    assert!(env.reading(&reading_pda(&cfg, D1)).is_none());
    submit(&mut env, &mint, D1, V1, &[&t.attesters[1], &t.attesters[2]]).unwrap();
}

#[test]
fn a_bad_signature_fails_the_whole_transaction() {
    let mut env = Env::new();
    let t = new_token(1);
    init(&mut env, &t, vault_rule(), 1).unwrap();
    let mint = t.mint.pubkey();
    let msg = message(&mint, 0, D1, V1);
    let mut sig = sign(&t.attesters[0], &msg);
    sig[10] ^= 0x01;
    let payer = env.payer.pubkey();
    let out = expect_fail(env.send(&[ed25519_ix(&[(t.attesters[0].pubkey(), sig, msg)]), ix_submit(&payer, &mint, D1, V1)], &[]));
    assert!(out.contains("InstructionError(1"), "the precompile (instruction 1, after the compute-budget ix) refuses it: {out}");
    assert!(env.reading(&reading_pda(&config_pda(&mint), D1)).is_none());
}

#[test]
fn ed25519_offsets_into_another_instruction_are_refused() {
    let mut env = Env::new();
    let t = new_token(1);
    init(&mut env, &t, vault_rule(), 1).unwrap();
    let mint = t.mint.pubkey();
    let msg = message(&mint, 0, D1, V1);
    let sig = sign(&t.attesters[0], &msg);
    let mut ix = ed25519_ix(&[(t.attesters[0].pubkey(), sig, msg)]);
    // Point the message's instruction index at the ed25519 instruction's real position (1) instead of u16::MAX — allowed — then at
    // the compute-budget instruction (0) — refused (by the precompile or by our parser; either way no reading is stored).
    ix.data[2 + 12..2 + 14].copy_from_slice(&1u16.to_le_bytes());
    let payer = env.payer.pubkey();
    env.send(&[ix.clone(), ix_submit(&payer, &mint, D1, V1)], &[]).unwrap();
    let mut bad = ix.clone();
    bad.data[2 + 12..2 + 14].copy_from_slice(&0u16.to_le_bytes());
    expect_fail(env.send(&[bad, ix_submit(&payer, &mint, D2, V2)], &[]));
    assert!(env.reading(&reading_pda(&config_pda(&mint), D2)).is_none());
}

#[test]
fn stale_future_invalid_conflicting_and_implausible_readings_are_refused() {
    let mut env = Env::new();
    let t = new_token(1);
    init(&mut env, &t, vault_rule(), 1).unwrap();
    let mint = t.mint.pubkey();
    let a = &t.attesters[0];
    submit(&mut env, &mint, D2, V1, &[a]).unwrap();
    // Stale: a date at or before the last accepted one.
    expect_anchor_err(submit(&mut env, &mint, D1, V1, &[a]), "StaleReading");
    // Idempotent: the same reading again is a no-op success; a different value for a stored date is refused.
    submit(&mut env, &mint, D2, V1, &[a]).unwrap();
    expect_anchor_err(submit(&mut env, &mint, D2, V1 + 1, &[a]), "ConflictingReading");
    // Future: NOW is 2026-10-09.
    expect_anchor_err(submit(&mut env, &mint, 20261010, V1, &[a]), "FutureDate");
    submit(&mut env, &mint, 20261009, V1 + UNIT / 2, &[a]).unwrap();
    // Not a date.
    expect_anchor_err(submit(&mut env, &mint, 20261232, V1, &[a]), "InvalidDate");
    expect_anchor_err(submit(&mut env, &mint, 20260230, V1, &[a]), "InvalidDate");
    // Implausible: a jump beyond the $2T bound.
    env.set_time(NOW + 3 * 86_400);
    // Review M-2: an out-of-bound reading is no longer a wedge — it is accepted as a RESET (0 units, new baseline).
    submit(&mut env, &mint, 20261012, V1 + 3_000_000_000_000 * 100, &[a]).unwrap();
    let reset = env.reading(&reading_pda(&config_pda(&mint), 20261012)).unwrap();
    assert_eq!((reset.kind, reset.units, reset.carry_out), (KIND_RESET, 0, 0));
    expect_anchor_err(submit(&mut env, &mint, 20261012, 0, &[a]), "InvalidValue");
    expect_anchor_err(submit(&mut env, &mint, 20261012, i64::MAX as u64 + 1, &[a]), "InvalidValue");
    let c = env.config(&config_pda(&mint));
    assert_eq!((c.readings, c.last_record_date, c.last_value, c.carry), (3, 20261012, V1 + 3_000_000_000_000 * 100, 0));
    // The next reading counts from the reset's new baseline.
    env.set_time(NOW + 4 * 86_400);
    submit(&mut env, &mint, 20261013, V1 + 3_000_000_000_000 * 100 + 2 * UNIT, &[a]).unwrap();
    assert_eq!(env.reading(&reading_pda(&config_pda(&mint), 20261013)).unwrap().units, 2);
}

// ================================================================================================================================
// vault mode crank
// ================================================================================================================================

#[test]
fn vault_burn_with_shortfall_carried_and_refilled() {
    let mut env = Env::new();
    let t = new_token(1);
    init(&mut env, &t, vault_rule(), 1).unwrap();
    let mint = mint_or_create(&mut env, &t);
    let cfg = config_pda(&mint);
    let vault = env.create_ata(&cfg, &mint); // anyone can create the config PDA's ATA
    env.mint_to(&mint, &t.authority, &vault, 1_500_000 * TOKEN);
    let supply0 = env.mint_supply(&mint);
    let fee0 = env.lamports(&fee_pda(&mint));
    let a = &t.attesters[0];

    submit(&mut env, &mint, D1, V1, &[a]).unwrap();
    submit(&mut env, &mint, D2, V1 + 21 * UNIT, &[a]).unwrap();
    let cranker = Keypair::new();
    env.fund(&cranker.pubkey(), SOL);
    let meta = env.ok(&[ix_crank_vault(&cranker.pubkey(), &mint, D2)], &[&cranker]);
    let r = env.reading(&reading_pda(&cfg, D2)).unwrap();
    assert_eq!((r.outcome, r.owed, r.burned, r.shortfall), (OUTCOME_SHORT, 2_100_000 * TOKEN, 1_500_000 * TOKEN, 600_000 * TOKEN));
    assert_eq!(env.token_amount(&vault), 0);
    assert_eq!(env.mint_supply(&mint), supply0 - 1_500_000 * TOKEN);
    let c = env.config(&cfg);
    assert_eq!((c.shortfall, c.total_burned, c.crank_cursor, c.burns), (600_000 * TOKEN, 1_500_000 * TOKEN, D2, 1));
    let memo = format!(
        "DEBT|2026-10-06|src={SRC}|prev=40273000000000.00|now=40294000000000.00|delta=21000000000.00|units=21|burn=1500000|short=600000|rules=sha256:{}|v1",
        math::hex12(&rules_sha256())
    );
    assert!(meta.logs.iter().any(|l| l.contains(&memo)), "memo v1 in the logs:\n{}", meta.logs.join("\n"));

    // Refill; the next burn day pays the shortfall first.
    env.mint_to(&mint, &t.authority, &vault, 5_000_000 * TOKEN);
    submit(&mut env, &mint, D3, V1 + 24 * UNIT, &[a]).unwrap();
    env.ok(&[ix_crank_vault(&cranker.pubkey(), &mint, D3)], &[&cranker]);
    let r = env.reading(&reading_pda(&cfg, D3)).unwrap();
    assert_eq!((r.outcome, r.owed, r.burned, r.shortfall), (OUTCOME_BURNED, 900_000 * TOKEN, 900_000 * TOKEN, 0));
    assert_eq!(env.config(&cfg).shortfall, 0);
    // Not one lamport of the fee PDA moved in vault mode.
    assert_eq!(env.lamports(&fee_pda(&mint)), fee0);
}

#[test]
fn vault_allocation_cap_exhausts() {
    let mut env = Env::new();
    let t = new_token(1);
    let mut rule = vault_rule();
    rule.vault_allocation = 250_000 * TOKEN;
    init(&mut env, &t, rule, 1).unwrap();
    let mint = mint_or_create(&mut env, &t);
    let cfg = config_pda(&mint);
    let vault = env.create_ata(&cfg, &mint);
    env.mint_to(&mint, &t.authority, &vault, 10_000_000 * TOKEN);
    let a = &t.attesters[0];
    submit(&mut env, &mint, D1, V1, &[a]).unwrap();
    submit(&mut env, &mint, D2, V1 + 2 * UNIT, &[a]).unwrap();
    env.ok(&[ix_crank_vault(&env.payer.pubkey(), &mint, D2)], &[]);
    submit(&mut env, &mint, D3, V1 + 5 * UNIT, &[a]).unwrap();
    env.ok(&[ix_crank_vault(&env.payer.pubkey(), &mint, D3)], &[]);
    assert_eq!(env.reading(&reading_pda(&cfg, D3)).unwrap().burned, 50_000 * TOKEN); // capped at what is left
    submit(&mut env, &mint, D4, V1 + 9 * UNIT, &[a]).unwrap();
    env.ok(&[ix_crank_vault(&env.payer.pubkey(), &mint, D4)], &[]);
    let r = env.reading(&reading_pda(&cfg, D4)).unwrap();
    assert_eq!((r.outcome, r.burned), (OUTCOME_EXHAUSTED, 0));
    assert_eq!(env.config(&cfg).total_burned, 250_000 * TOKEN);
}

#[test]
fn cranks_are_idempotent_and_in_order() {
    let mut env = Env::new();
    let t = new_token(1);
    init(&mut env, &t, vault_rule(), 1).unwrap();
    let mint = mint_or_create(&mut env, &t);
    let cfg = config_pda(&mint);
    let vault = env.create_ata(&cfg, &mint);
    env.mint_to(&mint, &t.authority, &vault, 100_000_000 * TOKEN);
    let a = &t.attesters[0];
    let payer = env.payer.pubkey();
    submit(&mut env, &mint, D1, V1, &[a]).unwrap();
    submit(&mut env, &mint, D2, V1 + 3 * UNIT, &[a]).unwrap();
    submit(&mut env, &mint, D3, V1 + 3 * UNIT, &[a]).unwrap(); // flat: zero units, queued behind D2
    submit(&mut env, &mint, D4, V1 + 5 * UNIT, &[a]).unwrap();

    expect_anchor_err(env.send(&[ix_crank_vault(&payer, &mint, D4)], &[]), "OutOfOrder");
    expect_anchor_err(env.send(&[ix_crank_no_units(&payer, &mint, D3)], &[]), "OutOfOrder");
    expect_anchor_err(env.send(&[ix_crank_no_units(&payer, &mint, D2)], &[]), "HasUnits");
    env.ok(&[ix_crank_vault(&payer, &mint, D2)], &[]);
    let supply = env.mint_supply(&mint);
    expect_anchor_err(env.send(&[ix_crank_vault(&payer, &mint, D2)], &[]), "AlreadyProcessed");
    assert_eq!(env.mint_supply(&mint), supply);
    expect_anchor_err(env.send(&[ix_crank_vault(&payer, &mint, D3)], &[]), "NoUnits");
    env.ok(&[ix_crank_no_units(&payer, &mint, D3)], &[]);
    env.ok(&[ix_crank_vault(&payer, &mint, D4)], &[]);
    let c = env.config(&cfg);
    assert_eq!((c.crank_cursor, c.total_burned), (D4, 5 * 100_000 * TOKEN));
}

// ================================================================================================================================
// buyback mode against the real Raydium CPMM
// ================================================================================================================================

struct Market {
    t: Token,
    pool: Pool,
    trader: Keypair,
}

/// init (before the mint exists) → mint → pool with creator = fee PDA → register → fee PDA ATAs → trades for an oracle history.
fn market(env: &mut Env, rule: burn_receipts::state::RuleParams) -> Market {
    // The platform cap at its 25 SOL default (these pools are smaller); the cap has its own tests in platform.rs.
    if env.svm.get_account(&platform_pda()).map(|a| a.data.is_empty()).unwrap_or(true) {
        let auth = Pubkey::new_unique();
        env.init_platform(&auth, DEFAULT_BURN_POOL_CAP_LAMPORTS);
    }
    let t = new_token(1);
    init(env, &t, rule, 1).unwrap();
    let mint = mint_or_create(env, &t);
    let fee = fee_pda(&mint);
    let launcher = Keypair::new();
    env.fund(&launcher.pubkey(), 1_000 * SOL);
    let amm_config = cpmm::setup_amm(env, &launcher.pubkey());
    let launcher_tokens = env.create_ata(&launcher.pubkey(), &mint);
    env.mint_to(&mint, &t.authority, &launcher_tokens, 800_000_000 * TOKEN);
    // 85 SOL against 800M tokens — a LaunchLab graduation-sized pool.
    let pool = cpmm::create_pool(env, &launcher, &amm_config, &mint, &fee, 85 * SOL, 800_000_000 * TOKEN, &launcher_tokens);
    let payer = env.payer.pubkey();
    cpmm::launchlab_migrated(env, &mint, &pool);
    env.ok(&[ix_register_pool(&env.payer.pubkey(), &mint, &pool.pool)], &[]);
    let _ = payer;
    env.create_ata(&fee, &NATIVE_MINT);
    env.create_ata(&fee, &mint);
    // ≈ 900 s of trades: the oracle ring gets entries older than the mandatory 600 s TWAP window.
    let trader = cpmm::seed_history(env, &pool, &mint);
    Market { t, pool, trader }
}

#[test]
fn register_pool_accepts_only_the_fee_pda_pool() {
    let mut env = Env::new();
    let m = market(&mut env, buyback_rule());
    let mint = m.t.mint.pubkey();
    assert_eq!(env.config(&config_pda(&mint)).cpmm_pool, m.pool.pool);
    expect_anchor_err(env.send(&[ix_register_pool(&env.payer.pubkey(), &mint, &m.pool.pool)], &[]), "PoolAlreadyRegistered");

    // A second token: copies of the real pool account with one field changed, owned by CPMM — each refused.
    let t2 = new_token(1);
    init(&mut env, &t2, buyback_rule(), 1).unwrap();
    let mint2 = mint_or_create(&mut env, &t2);
    let real = env.svm.get_account(&m.pool.pool).unwrap();
    let fake = |env: &mut Env, data: Vec<u8>, owner: Pubkey| -> Pubkey {
        let k = Pubkey::new_unique();
        env.svm.set_account(k, litesvm_account(real.lamports, data, owner)).unwrap();
        k
    };
    let mut d = real.data.clone();
    let (m0, m1) = (if m.pool.wsol_is_0 { 200 } else { 168 }, 40); // the token-mint slot, pool_creator
    d[m0..m0 + 32].copy_from_slice(mint2.as_ref());
    // creator is still the FIRST token's fee PDA → refused
    let k = fake(&mut env, d.clone(), CPMM_PROGRAM_ID);
    expect_anchor_err(env.send(&[ix_register_pool_full(&env.payer.pubkey(), &mint2, &k, &m.pool.lp_mint, Some((launchlab_pool_pda(&mint2), TEST_LAUNCHLAB_PLATFORM)))], &[]), "PoolCreatorMismatch");
    // creator = token 2's fee PDA, but owned by someone else → refused
    d[m1..m1 + 32].copy_from_slice(fee_pda(&mint2).as_ref());
    let k = fake(&mut env, d.clone(), Pubkey::new_unique());
    expect_anchor_err(env.send(&[ix_register_pool_full(&env.payer.pubkey(), &mint2, &k, &m.pool.lp_mint, Some((launchlab_pool_pda(&mint2), TEST_LAUNCHLAB_PLATFORM)))], &[]), "InvalidCpmmAccount");
    // right creator and owner, wrong mint pair → refused
    let mut d2 = d.clone();
    d2[m0..m0 + 32].copy_from_slice(Pubkey::new_unique().as_ref());
    let k = fake(&mut env, d2, CPMM_PROGRAM_ID);
    expect_anchor_err(env.send(&[ix_register_pool_full(&env.payer.pubkey(), &mint2, &k, &m.pool.lp_mint, Some((launchlab_pool_pda(&mint2), TEST_LAUNCHLAB_PLATFORM)))], &[]), "InvalidPoolMints");
    // vault mode never registers a pool
    let t3 = new_token(1);
    init(&mut env, &t3, vault_rule(), 1).unwrap();
    mint_or_create(&mut env, &t3);
    expect_anchor_err(env.send(&[ix_register_pool(&env.payer.pubkey(), &t3.mint.pubkey(), &m.pool.pool)], &[]), "WrongMode");
}

#[test]
fn buyback_crank_swaps_on_cpmm_and_burns_everything_received() {
    let mut env = Env::new();
    let m = market(&mut env, buyback_rule());
    let mint = m.t.mint.pubkey();
    let cfg = config_pda(&mint);
    let fee = fee_pda(&mint);
    let fee_wsol = get_associated_token_address(&fee, &NATIVE_MINT);
    let fee_tokens = get_associated_token_address(&fee, &mint);
    let a = &m.t.attesters[0];

    // Creator fees arrive: 10 SOL of lamports + 0.5 SOL as WSOL + 1,234.5 tokens (CPMM pays creator fees to the fee PDA's ATAs).
    env.transfer_sol(&fee, 10 * SOL);
    let ixs = [
        anchor_lang::solana_program::system_instruction::transfer(&env.payer.pubkey(), &fee_wsol, SOL / 2),
        anchor_spl::token::spl_token::instruction::sync_native(&anchor_spl::token::ID, &fee_wsol).unwrap(),
    ];
    env.ok(&ixs, &[]);
    env.mint_to(&mint, &m.t.authority, &fee_tokens, 1_234_500_000);

    submit(&mut env, &mint, D1, V1, &[a]).unwrap();
    submit(&mut env, &mint, D2, V1 + 21 * UNIT + 12_345, &[a]).unwrap();

    let fee_before = env.lamports(&fee);
    let wsol_before = env.token_amount(&fee_wsol);
    let pool_before = fee_before - buyback_rule().reserve_lamports + wsol_before;
    let rule_spend = math::buyback_spend(pool_before, 21, 500).unwrap();
    let (r_sol, r_tok) = cpmm::reserves(&env, &m.pool);
    // Review H-1: one crank spends at most 2 % of the pool's WSOL reserve; the rest of the rule's spend is carried.
    let reserve_cap = math::reserve_spend_cap(r_sol, MAX_SPEND_RESERVE_BPS);
    let spend = rule_spend.min(reserve_cap).min(pool_before);
    assert!(spend < rule_spend, "this market is set up so the reserve cap binds");
    let min_out = math::min_amount_out(spend, r_sol, r_tok, cpmm::TRADE_FEE_RATE + cpmm::CREATOR_FEE_RATE, 300).unwrap();
    let supply_before = env.mint_supply(&mint);

    let cranker = Keypair::new();
    env.fund(&cranker.pubkey(), SOL);
    let meta = env.ok(&[cpmm::ix_crank_buyback(&cranker.pubkey(), &mint, &m.pool, D2)], &[&cranker]);
    let r = env.reading(&reading_pda(&cfg, D2)).unwrap();
    assert_eq!(r.outcome, OUTCOME_BURNED);
    assert_eq!(r.pool_lamports, pool_before);
    assert_eq!(r.spent_lamports, spend);
    assert!(r.got >= min_out, "got {} ≥ min_out {}", r.got, min_out);
    assert_eq!(r.burned, r.got + 1_234_500_000, "burned = what the swap delivered + the creator-fee tokens already held");
    assert_eq!(env.mint_supply(&mint), supply_before - r.burned);
    assert_eq!(env.token_amount(&fee_tokens), 0);
    // Exactly `spend` left the fee PDA's SOL+WSOL; the WSOL account was used first.
    assert_eq!(env.lamports(&fee) + env.token_amount(&fee_wsol), fee_before + wsol_before - spend);
    assert!(env.lamports(&fee) >= buyback_rule().reserve_lamports);
    let c = env.config(&cfg);
    assert_eq!((c.total_spent_lamports, c.total_burned, c.crank_cursor), (spend, r.burned, D2));
    assert_eq!((r.rule_spend_lamports, r.carried_in_lamports, r.carried_out_lamports), (rule_spend, 0, rule_spend - spend));
    assert_eq!(c.carried_spend_lamports, rule_spend - spend);
    let ev = events(&meta).into_iter().find(|(d, _)| d[..] == <burn_receipts::events::SpendCapBound as anchor_lang::Discriminator>::DISCRIMINATOR[..]).expect("SpendCapBound");
    let b = <burn_receipts::events::SpendCapBound as anchor_lang::AnchorDeserialize>::try_from_slice(&ev.1).unwrap();
    assert_eq!((b.target_lamports, b.spent_lamports, b.reserve_cap_lamports, b.carried_out_lamports), (rule_spend, spend, reserve_cap, rule_spend - spend));

    let memo = burn_receipts::memo::format_v2(
        &burn_receipts::memo::MemoHead {
            prefix: "DEBT",
            record_date: D2,
            source: SRC,
            prev: V1,
            now: V1 + 21 * UNIT + 12_345,
            delta: (21 * UNIT + 12_345) as i64,
            value_decimals: 2,
            units: 21,
            rules_sha256: &rules_sha256(),
        },
        pool_before,
        spend,
        r.got,
        r.burned,
        &m.pool.pool.to_string()[..12],
        DECIMALS,
    );
    assert!(meta.logs.iter().any(|l| l.contains(&memo)), "memo v2 {memo} in logs:\n{}", meta.logs.join("\n"));
    println!("crank_buyback CU: {}\nmemo: {memo}", meta.compute_units_consumed);

    // Idempotent.
    expect_anchor_err(env.send(&[cpmm::ix_crank_buyback(&cranker.pubkey(), &mint, &m.pool, D2)], &[&cranker]), "AlreadyProcessed");

    // The next burn day's target = its own rule spend + the carried remainder; again capped, again carried.
    env.set_time(env.now() + 86_400);
    let carried = rule_spend - spend;
    submit(&mut env, &mint, D3, V1 + 22 * UNIT + 12_345, &[a]).unwrap();
    let fee_before = env.lamports(&fee);
    let wsol_before = env.token_amount(&fee_wsol);
    let pool2 = fee_before - buyback_rule().reserve_lamports + wsol_before;
    let rule2 = math::buyback_spend(pool2, 1, 500).unwrap();
    let (r_sol2, _) = cpmm::reserves(&env, &m.pool);
    let cap2 = math::reserve_spend_cap(r_sol2, MAX_SPEND_RESERVE_BPS);
    let target2 = (rule2 + carried).min(pool2);
    let spend2 = target2.min(cap2).min(pool2);
    env.ok(&[cpmm::ix_crank_buyback(&cranker.pubkey(), &mint, &m.pool, D3)], &[&cranker]);
    let r3 = env.reading(&reading_pda(&cfg, D3)).unwrap();
    assert_eq!((r3.carried_in_lamports, r3.spent_lamports, r3.carried_out_lamports), (carried, spend2, target2 - spend2));
}

#[test]
fn buyback_below_floor_buys_nothing_but_still_burns_held_tokens() {
    let mut env = Env::new();
    let mut rule = buyback_rule();
    rule.floor_lamports = 100 * SOL;
    let m = market(&mut env, rule);
    let mint = m.t.mint.pubkey();
    let fee = fee_pda(&mint);
    let fee_tokens = get_associated_token_address(&fee, &mint);
    env.transfer_sol(&fee, 2 * SOL);
    env.mint_to(&mint, &m.t.authority, &fee_tokens, 7 * TOKEN);
    let a = &m.t.attesters[0];
    submit(&mut env, &mint, D1, V1, &[a]).unwrap();
    submit(&mut env, &mint, D2, V1 + 3 * UNIT, &[a]).unwrap();
    let fee_before = env.lamports(&fee);
    let meta = env.ok(&[cpmm::ix_crank_buyback(&env.payer.pubkey(), &mint, &m.pool, D2)], &[]);
    let r = env.reading(&reading_pda(&config_pda(&mint), D2)).unwrap();
    assert_eq!((r.outcome, r.spent_lamports, r.got, r.burned), (OUTCOME_BELOW_FLOOR, 0, 0, 7 * TOKEN));
    assert_eq!(env.lamports(&fee), fee_before);
    assert!(meta.logs.iter().any(|l| l.contains("|spent=0|got=0|burn=7|swap=none|")), "{}", meta.logs.join("\n"));
}

#[test]
fn buyback_refuses_a_pushed_price_then_succeeds_once_it_reverts() {
    let mut env = Env::new();
    let m = market(&mut env, buyback_rule());
    let mint = m.t.mint.pubkey();
    let fee = fee_pda(&mint);
    env.transfer_sol(&fee, 10 * SOL);
    let a = &m.t.attesters[0];
    submit(&mut env, &mint, D1, V1, &[a]).unwrap();
    submit(&mut env, &mint, D2, V1 + 10 * UNIT, &[a]).unwrap();

    // Front-run in the same second: a 60 SOL buy pushes the token ~70 % up. The oracle records the PRE-swap price only.
    let tokens_before = env.token_amount(&get_associated_token_address(&m.trader.pubkey(), &mint));
    cpmm::swap(&mut env, &m.trader, &m.pool, &mint, true, 60 * SOL).unwrap();
    let fee_before = env.lamports(&fee);
    expect_anchor_err(env.send(&[cpmm::ix_crank_buyback(&env.payer.pubkey(), &mint, &m.pool, D2)], &[]), "TwapDeviation");
    assert_eq!(env.lamports(&fee), fee_before);
    // The attacker unwinds; the crank now goes through.
    let bought = env.token_amount(&get_associated_token_address(&m.trader.pubkey(), &mint)) - tokens_before;
    cpmm::swap(&mut env, &m.trader, &m.pool, &mint, false, bought).unwrap();
    env.ok(&[cpmm::ix_crank_buyback(&env.payer.pubkey(), &mint, &m.pool, D2)], &[]);
    assert_eq!(env.reading(&reading_pda(&config_pda(&mint), D2)).unwrap().outcome, OUTCOME_BURNED);
}

#[test]
fn buyback_needs_a_registered_pool_and_the_right_accounts() {
    let mut env = Env::new();
    let m = market(&mut env, buyback_rule());
    let mint = m.t.mint.pubkey();
    env.transfer_sol(&fee_pda(&mint), 10 * SOL);
    let a = &m.t.attesters[0];
    submit(&mut env, &mint, D1, V1, &[a]).unwrap();
    submit(&mut env, &mint, D2, V1 + 2 * UNIT, &[a]).unwrap();
    let payer = env.payer.pubkey();
    // Swapped vaults → refused.
    let mut p = m.pool;
    std::mem::swap(&mut p.token_0_vault, &mut p.token_1_vault);
    expect_anchor_err(env.send(&[cpmm::ix_crank_buyback(&payer, &mint, &p, D2)], &[]), "InvalidCpmmAccount");
    // Wrong observation account → refused.
    let mut p = m.pool;
    p.observation = m.pool.pool;
    expect_anchor_err(env.send(&[cpmm::ix_crank_buyback(&payer, &mint, &p, D2)], &[]), "InvalidCpmmAccount");
    // A different "pool" → refused by the address constraint.
    let mut p = m.pool;
    p.pool = Pubkey::new_unique();
    expect_anchor_err(env.send(&[cpmm::ix_crank_buyback(&payer, &mint, &p, D2)], &[]), "PoolNotRegistered");
    // Vault crank on a buyback token → refused.
    expect_anchor_err(env.send(&[ix_crank_vault(&payer, &mint, D2)], &[]), "AccountNotInitialized");

    // A buyback token whose pool is not registered yet: the burn day waits (late, never lost).
    let t2 = new_token(1);
    init(&mut env, &t2, buyback_rule(), 1).unwrap();
    let mint2 = mint_or_create(&mut env, &t2);
    env.create_ata(&fee_pda(&mint2), &NATIVE_MINT);
    env.create_ata(&fee_pda(&mint2), &mint2);
    submit(&mut env, &mint2, D1, V1, &[&t2.attesters[0]]).unwrap();
    submit(&mut env, &mint2, D2, V1 + 2 * UNIT, &[&t2.attesters[0]]).unwrap();
    // (token 2's config has no pool; offering token 1's real pool is refused by the address constraint)
    expect_anchor_err(env.send(&[cpmm::ix_crank_buyback(&payer, &mint2, &m.pool, D2)], &[]), "PoolNotRegistered");
}

// ================================================================================================================================
// no withdraw path
// ================================================================================================================================

#[test]
fn the_idl_has_no_withdraw_close_or_sweep_instruction() {
    let p = format!("{}/../../target/idl/burn_receipts.json", env!("CARGO_MANIFEST_DIR"));
    let idl: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&p).expect("run anchor build")).unwrap();
    let mut names: Vec<String> = idl["instructions"].as_array().unwrap().iter().map(|i| i["name"].as_str().unwrap().to_string()).collect();
    names.sort();
    assert_eq!(
        names,
        vec![
            "apply_attester_change",
            "apply_cap_raise",
            "apply_registration_policy",
            "cancel_attester_change",
            "cancel_cap_raise",
            "cancel_registration_policy",
            "check_pool_health",
            "claim_launchlab_creator_fee",
            "claim_lock_fees",
            "clear_cranker_allowlist",
            "crank_buyback",
            "crank_no_units",
            "crank_vault",
            "forward_to_winner",
            "initialize_platform",
            "initialize_token",
            "link_pair",
            "propose_attesters",
            "propose_cap_raise",
            "register_fee_key",
            "register_pair_pool",
            "register_pool",
            "renounce_admin",
            "renounce_platform_authority",
            "replace_pool",
            "set_registration_policy",
            "submit_pair_result",
            "submit_reading",
            "veto_registration_policy",
        ]
    );
    for n in &names {
        // (claim_launchlab_creator_fee claims INTO the fee PDA's own WSOL account; tested in launchlab.rs)
        // (claim_lock_fees, LAUNCHPAD-PATH §35, claims the locked LP's fees INTO the fee PDA (80 %) and the compiled treasury (20 %) and
        // burns the coin side; tested in lock_fees.rs)
        let bads: &[&str] = if n == "claim_launchlab_creator_fee" || n == "claim_lock_fees" {
            &["withdraw", "close", "sweep", "transfer"]
        } else if n == "set_registration_policy" {
            // review-3 M-3: the 48 h timelocked stranding-recovery switch (register: temporary power, sunsets with the cap)
            &["withdraw", "close", "sweep", "transfer", "mint", "pause", "freeze"]
        } else {
            &["withdraw", "close", "sweep", "transfer", "claim", "migrate", "set_", "mint", "pause", "freeze", "update"]
        };
        for bad in bads {
            assert!(!n.contains(bad), "{n}");
        }
    }
}

#[test]
fn fee_pda_lamports_move_only_in_crank_buyback() {
    let mut env = Env::new();
    let m = market(&mut env, buyback_rule());
    let mint = m.t.mint.pubkey();
    let fee = fee_pda(&mint);
    env.transfer_sol(&fee, 5 * SOL);
    let a = &m.t.attesters[0];
    let creator = m.t.creator.insecure_clone();
    let payer = env.payer.pubkey();
    let track = |env: &mut Env, what: &str, f: &mut dyn FnMut(&mut Env)| {
        let before = env.lamports(&fee);
        f(env);
        assert_eq!(env.lamports(&fee), before, "{what} moved fee PDA lamports");
    };
    track(&mut env, "submit_reading", &mut |e| { submit(e, &mint, D1, V1, &[a]).unwrap(); });
    track(&mut env, "submit_reading (units)", &mut |e| { submit(e, &mint, D2, V1 + UNIT, &[a]).unwrap(); });
    env.set_time(env.now() + ATTESTER_SENIORITY_SECS); // review-3 L-2: kept keys must be ≥ 7 days old to add one
    track(&mut env, "propose", &mut |e| { e.ok(&[ix_admin("propose", &creator.pubkey(), &mint, ed(&[a.pubkey(), Pubkey::new_unique()]), 2)], &[&creator]); });
    track(&mut env, "cancel", &mut |e| { e.ok(&[ix_admin("cancel", &creator.pubkey(), &mint, vec![], 0)], &[&creator]); });
    track(&mut env, "register (refused)", &mut |e| { let p = e.payer.pubkey(); let _ = e.send(&[ix_register_pool(&p, &mint, &m.pool.pool)], &[]); });
    track(&mut env, "crank_no_units (refused)", &mut |e| { let _ = e.send(&[ix_crank_no_units(&payer, &mint, D2)], &[]); });
    // A system transfer out of the fee PDA cannot be signed by anyone but the program.
    let steal = anchor_lang::solana_program::system_instruction::transfer(&fee, &payer, SOL);
    let mut unsigned = steal.clone();
    unsigned.accounts[0].is_signer = false;
    track(&mut env, "unsigned transfer", &mut |e| { expect_fail(e.send(&[unsigned.clone()], &[])); });
    track(&mut env, "renounce", &mut |e| { e.ok(&[ix_admin("renounce", &creator.pubkey(), &mint, vec![], 0)], &[&creator]); });
    // crank_buyback is the one place: exactly `spend` leaves, never below the reserve.
    let before = env.lamports(&fee);
    env.ok(&[cpmm::ix_crank_buyback(&payer, &mint, &m.pool, D2)], &[]);
    let r = env.reading(&reading_pda(&config_pda(&mint), D2)).unwrap();
    assert_eq!(before - env.lamports(&fee), r.spent_lamports);
    assert_eq!(r.spent_lamports, math::buyback_spend(before - buyback_rule().reserve_lamports, 1, 500).unwrap());
}

// ================================================================================================================================
// attester rotation: 48 h timelock, renounce
// ================================================================================================================================

#[test]
fn attester_rotation_waits_48h_and_renounce_freezes_the_set() {
    let mut env = Env::new();
    let t = new_token(1);
    init(&mut env, &t, vault_rule(), 1).unwrap();
    let mint = t.mint.pubkey();
    let cfg = config_pda(&mint);
    let creator = &t.creator;
    let new_a = Keypair::new();
    let stranger = Keypair::new();
    env.fund(&stranger.pubkey(), SOL);
    // Review-3 L-2: adding a key needs kept keys that have been in the set ≥ 7 days.
    let t0 = NOW + ATTESTER_SENIORITY_SECS;
    env.set_time(t0);

    expect_anchor_err(env.send(&[ix_admin("propose", &stranger.pubkey(), &mint, ed(&[new_a.pubkey()]), 1)], &[&stranger]), "NotAdmin");
    expect_anchor_err(env.send(&[ix_apply(&env.payer.pubkey(), &mint)], &[]), "NoPendingChange");
    // Review L-2: a proposal must keep at least `quorum` current keys — replacing the whole set at once is refused …
    expect_anchor_err(env.send(&[ix_admin("propose", &creator.pubkey(), &mint, ed(&[new_a.pubkey()]), 1)], &[creator]), "TooManyAttestersReplaced");
    // … and (review-2 F2) at quorum 1 even ADDING one key is refused — that key alone would be a quorum …
    expect_anchor_err(env.send(&[ix_admin("propose", &creator.pubkey(), &mint, ed(&[t.attesters[0].pubkey(), new_a.pubkey()]), 1)], &[creator]), "TooManyAttestersReplaced");
    // … so a new key comes in with the quorum raised to 2 (every 2-key subset then holds a current key).
    env.ok(&[ix_admin("propose", &creator.pubkey(), &mint, ed(&[t.attesters[0].pubkey(), new_a.pubkey()]), 2)], &[creator]);
    let c = env.config(&cfg);
    assert_eq!(c.pending_eta, t0 + ATTESTER_TIMELOCK_SECS);
    expect_anchor_err(env.send(&[ix_apply(&env.payer.pubkey(), &mint)], &[]), "TimelockNotElapsed");
    // The OLD attester still rules during the timelock.
    submit(&mut env, &mint, D1, V1, &[&t.attesters[0]]).unwrap();
    env.set_time(t0 + ATTESTER_TIMELOCK_SECS - 1);
    expect_anchor_err(env.send(&[ix_apply(&env.payer.pubkey(), &mint)], &[]), "TimelockNotElapsed");
    env.set_time(t0 + ATTESTER_TIMELOCK_SECS);
    env.ok(&[ix_apply(&env.payer.pubkey(), &mint)], &[]); // anyone may apply
    let c = env.config(&cfg);
    assert_eq!((c.attester_slice(), c.pending_eta, c.quorum), (&ed(&[t.attesters[0].pubkey(), new_a.pubkey()])[..], 0, 2));
    // Dropping the old key at quorum 2: bring in a second new key (1 new < quorum 2) …
    let new_b = Keypair::new();
    // new_a is only 0 days old: it cannot yet vouch for another new key (review-3 L-2) …
    expect_anchor_err(env.send(&[ix_admin("propose", &creator.pubkey(), &mint, ed(&[t.attesters[0].pubkey(), new_a.pubkey(), new_b.pubkey()]), 2)], &[creator]), "TooManyAttestersReplaced");
    // … after 7 days it can.
    let t1 = t0 + ATTESTER_TIMELOCK_SECS + ATTESTER_SENIORITY_SECS;
    env.set_time(t1);
    env.ok(&[ix_admin("propose", &creator.pubkey(), &mint, ed(&[t.attesters[0].pubkey(), new_a.pubkey(), new_b.pubkey()]), 2)], &[creator]);
    env.set_time(t1 + ATTESTER_TIMELOCK_SECS);
    env.ok(&[ix_apply(&env.payer.pubkey(), &mint)], &[]);
    // … then drop the old one (keeps 2 current keys, adds none).
    env.ok(&[ix_admin("propose", &creator.pubkey(), &mint, ed(&[new_a.pubkey(), new_b.pubkey()]), 2)], &[creator]);
    env.set_time(t1 + 2 * ATTESTER_TIMELOCK_SECS);
    env.ok(&[ix_apply(&env.payer.pubkey(), &mint)], &[]);
    let c = env.config(&cfg);
    assert_eq!((c.attester_slice(), c.pending_eta), (&ed(&[new_a.pubkey(), new_b.pubkey()])[..], 0));
    expect_anchor_err(submit(&mut env, &mint, D2, V2, &[&t.attesters[0], &new_a]), "QuorumNotMet");
    submit(&mut env, &mint, D2, V2, &[&new_a, &new_b]).unwrap();

    // Propose, then renounce: the proposal dies with the admin and nothing can be proposed again.
    env.set_time(t1 + 2 * ATTESTER_TIMELOCK_SECS + ATTESTER_SENIORITY_SECS);
    env.ok(&[ix_admin("propose", &creator.pubkey(), &mint, ed(&[new_a.pubkey(), new_b.pubkey(), stranger.pubkey()]), 2)], &[creator]);
    env.ok(&[ix_admin("renounce", &creator.pubkey(), &mint, vec![], 0)], &[creator]);
    let c = env.config(&cfg);
    assert_eq!((c.admin, c.pending_eta), (Pubkey::default(), 0));
    env.set_time(t1 + 20 * ATTESTER_TIMELOCK_SECS);
    expect_anchor_err(env.send(&[ix_apply(&env.payer.pubkey(), &mint)], &[]), "NoPendingChange");
    expect_anchor_err(env.send(&[ix_admin("propose", &creator.pubkey(), &mint, ed(&[stranger.pubkey()]), 1)], &[creator]), "AdminRenounced");
    expect_anchor_err(env.send(&[ix_admin("renounce", &creator.pubkey(), &mint, vec![], 0)], &[creator]), "AdminRenounced");
}

// ================================================================================================================================
// registration policy 2 (pair_curve, 2026-10-10) — the full path (graduate → register_pair_pool → crank) is in
// programs/pair_curve/tests/lifecycle.rs, against the real pair_curve program
// ================================================================================================================================

#[test]
fn policy_2_pins_the_launchlab_platform_and_only_register_pair_pool_accepts_it() {
    let mut env = Env::new();
    let t = new_token(1);
    let mut rule = buyback_rule();
    rule.pool_policy = POOL_POLICY_PAIR_CURVE;
    let mut args = init_args(rule, t.attesters.iter().map(|k| k.pubkey()).collect(), 1);
    args.admin = t.creator.pubkey();
    let payer = env.payer.pubkey();
    // like policy 0, policy 2 needs the LaunchLab platform (its cpConfigId is the AmmConfig the pair pools must use)
    expect_anchor_err(env.send(&[ix_initialize_with_platform(&payer, &t.creator.pubkey(), &t.mint.pubkey(), args.clone(), None)], &[&t.creator, &t.mint]), "LaunchLabPlatformRequired");
    env.ok(&[ix_initialize_with_platform(&payer, &t.creator.pubkey(), &t.mint.pubkey(), args, Some(TEST_LAUNCHLAB_PLATFORM))], &[&t.creator, &t.mint]);
    let c = env.config(&config_pda(&t.mint.pubkey()));
    assert_eq!((c.registration_policy, c.ll_platform, c.ll_cp_config), (POOL_POLICY_PAIR_CURVE, TEST_LAUNCHLAB_PLATFORM, cpmm::amm_config_0()));
    assert!(!c.pool_verified && c.cpmm_pool == Pubkey::default());
    // the LaunchLab path refuses a policy-2 token; an unknown policy value is refused at init
    mint_or_create(&mut env, &t);
    expect_anchor_err(env.send(&[ix_register_pool_full(&payer, &t.mint.pubkey(), &Pubkey::new_unique(), &t.mint.pubkey(), None)], &[]), "WrongPoolPolicy");
    let t2 = new_token(1);
    let mut rule3 = buyback_rule();
    rule3.pool_policy = 3;
    let mut args3 = init_args(rule3, t2.attesters.iter().map(|k| k.pubkey()).collect(), 1);
    args3.admin = t2.creator.pubkey();
    expect_anchor_err(env.send(&[ix_initialize_with_platform(&payer, &t2.creator.pubkey(), &t2.mint.pubkey(), args3, Some(TEST_LAUNCHLAB_PLATFORM))], &[&t2.creator, &t2.mint]), "InvalidRule");
    // the admin's stranding-recovery switch cannot target policy 2 (no new admin power)
    let ix = Instruction::new_with_bytes(
        burn_receipts::ID,
        &burn_receipts::instruction::SetRegistrationPolicy { policy: POOL_POLICY_PAIR_CURVE, pool: Pubkey::default() }.data(),
        burn_receipts::accounts::RegistrationPolicyAdmin { admin: t.creator.pubkey(), config: config_pda(&t.mint.pubkey()), platform: platform_pda(), event_authority: event_authority(), program: burn_receipts::ID }.to_account_metas(None),
    );
    expect_anchor_err(env.send(&[ix], &[&t.creator]), "WrongPoolPolicy");
}
