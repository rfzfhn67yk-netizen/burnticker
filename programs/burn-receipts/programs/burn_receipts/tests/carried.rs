//! crank_carried — burn dispersal (2026-10-13). Owner decision 2026-10-25: a reading's crank spends its whole target in one run (the
//! 2 % per-crank bound is gone), so a carry now comes only from a 30-day untradeable pool, or is one left by the program before the
//! decision. crank_carried spends a carry in caller-sized pieces (up to the whole carry, no per-crank bound, no budget) without a new
//! reading, under the same pool, TWAP, slippage and integrity checks, and only while no reading waits for its own crank (the queue
//! rule). Round-5 review R5-8 (what is left of it): one piece per coin per second, counted in CarriedPace.pieces, never in
//! TokenConfig.burns.

#![allow(clippy::result_large_err, clippy::too_many_arguments)]

mod common;

use anchor_lang::prelude::Pubkey;
use anchor_spl::associated_token::get_associated_token_address;
use burn_receipts::constants::*;
use common::cpmm::{self, Pool};
use common::*;
use solana_keypair::Keypair;
use solana_signer::Signer;

const D1: u32 = 20261005;
const D2: u32 = 20261006;
const D3: u32 = 20261007;
const V1: u64 = 4_027_300_000_000_000;

struct Token {
    mint: Keypair,
    authority: Keypair,
    creator: Keypair,
    attesters: Vec<Keypair>,
}

struct Market {
    t: Token,
    pool: Pool,
    trader: Keypair,
}

fn market(env: &mut Env) -> Market {
    if env.svm.get_account(&platform_pda()).map(|a| a.data.is_empty()).unwrap_or(true) {
        let auth = Pubkey::new_unique();
        env.init_platform(&auth, LEGACY_CAP_ARG);
    }
    let t = Token { mint: Keypair::new(), authority: Keypair::new(), creator: Keypair::new(), attesters: vec![Keypair::new()] };
    let args = init_args(buyback_rule(), t.attesters.iter().map(|k| k.pubkey()).collect(), 1);
    let payer = env.payer.pubkey();
    env.send(&[ix_initialize(&payer, &t.creator.pubkey(), &t.mint.pubkey(), args)], &[&t.creator, &t.mint]).unwrap();
    let auth = t.authority.pubkey();
    env.create_mint(&t.mint, &auth, DECIMALS);
    let mint = t.mint.pubkey();
    let fee = fee_pda(&mint);
    let launcher = Keypair::new();
    env.fund(&launcher.pubkey(), 1_000 * SOL);
    let amm_config = cpmm::setup_amm(env, &launcher.pubkey());
    let launcher_tokens = env.create_ata(&launcher.pubkey(), &mint);
    env.mint_to(&mint, &t.authority, &launcher_tokens, 800_000_000 * TOKEN);
    let pool = cpmm::create_pool(env, &launcher, &amm_config, &mint, &fee, 85 * SOL, 800_000_000 * TOKEN, &launcher_tokens);
    cpmm::launchlab_migrated(env, &mint, &pool);
    env.ok(&[ix_register_pool(&env.payer.pubkey(), &mint, &pool.pool)], &[]);
    env.create_ata(&fee, &NATIVE_MINT);
    env.create_ata(&fee, &mint);
    let trader = cpmm::seed_history(env, &pool, &mint);
    Market { t, pool, trader }
}

/// The carry the tests start from: one left by the program before 2026-10-25.
const LEGACY_CARRY: u64 = 5 * SOL;

/// 20 SOL of creator fees and a 21-unit reading: the rule's spend (~13.2 SOL) is far above 2 % of the pool's WSOL reserve (~1.7 SOL),
/// and the reading's crank spends ALL of it in one run (owner decision 2026-10-25), carrying nothing. Then a 5 SOL legacy carry is
/// set (as left by the program before the decision). Returns the carried amount.
fn carried_market(env: &mut Env, m: &Market) -> u64 {
    let mint = m.t.mint.pubkey();
    env.transfer_sol(&fee_pda(&mint), 20 * SOL);
    let a = &m.t.attesters[0];
    submit(env, &mint, D1, V1, &[a]).unwrap();
    submit(env, &mint, D2, V1 + 21 * UNIT, &[a]).unwrap();
    let (r_sol, _) = cpmm::reserves(env, &m.pool);
    env.ok(&[cpmm::ix_crank_buyback(&env.payer.pubkey(), &mint, &m.pool, D2)], &[]);
    let r = env.reading(&reading_pda(&config_pda(&mint), D2)).unwrap();
    assert_eq!(r.outcome, OUTCOME_BURNED);
    assert!(r.rule_spend_lamports > r_sol / 50, "the rule's spend is above 2 % of the reserve");
    assert_eq!((r.spent_lamports, r.carried_out_lamports), (r.rule_spend_lamports, 0), "spent in full in one run");
    assert_eq!(env.config(&config_pda(&mint)).carried_spend_lamports, 0);
    assert!(fee_sol(env, &mint) > LEGACY_CARRY + buyback_rule().reserve_lamports);
    set_legacy_carry(env, &mint, LEGACY_CARRY);
    LEGACY_CARRY
}

/// One window of quiet trading: a quiet pool's TWAP is its current price again one window after its last trade.
fn quiet(env: &mut Env) {
    env.set_time(env.now() + 601);
}

fn fee_sol(env: &Env, mint: &Pubkey) -> u64 {
    let fee = fee_pda(mint);
    env.lamports(&fee) + env.token_amount(&get_associated_token_address(&fee, &NATIVE_MINT))
}

/// No per-crank bound: one piece spends the whole carry (5 SOL, above 2 % of the ≈ 85 SOL reserve) without touching readings.
#[test]
fn a_carried_spend_drains_in_one_piece_without_touching_readings() {
    let mut env = Env::new();
    let m = market(&mut env);
    let mint = m.t.mint.pubkey();
    let cfg = config_pda(&mint);
    let fee_tokens = get_associated_token_address(&fee_pda(&mint), &mint);
    let carried = carried_market(&mut env, &m);
    let before = env.config(&cfg);
    let reading_before = env.reading(&reading_pda(&cfg, D2)).unwrap();
    let cranker = Keypair::new();
    env.fund(&cranker.pubkey(), SOL);
    quiet(&mut env);
    let (r_sol, _) = cpmm::reserves(&env, &m.pool);
    assert!(carried > r_sol / 50, "the carry is above the old 2 % bound");
    let supply = env.mint_supply(&mint);
    let sol_before = fee_sol(&env, &mint);
    let meta = env.ok(&[cpmm::ix_crank_carried(&cranker.pubkey(), &mint, &m.pool, carried)], &[&cranker]);
    assert_eq!(env.config(&cfg).carried_spend_lamports, 0);
    assert_eq!(fee_sol(&env, &mint), sol_before - carried, "exactly the carry left the fee PDA");
    assert_eq!(env.token_amount(&fee_tokens), 0, "every token the fee PDA held is burned");
    let burned = supply - env.mint_supply(&mint);
    assert!(burned > 0);
    // The event row and the memo name the date this piece drains through (the crank cursor); the retired fields are 0.
    let ev = events(&meta)
        .into_iter()
        .find(|(d, _)| d[..] == <burn_receipts::events::CarriedSpent as anchor_lang::Discriminator>::DISCRIMINATOR[..])
        .expect("CarriedSpent");
    let e = <burn_receipts::events::CarriedSpent as anchor_lang::AnchorDeserialize>::try_from_slice(&ev.1).unwrap();
    assert_eq!(
        (e.through_date, e.max_spend_lamports, e.reserve_cap_lamports, e.carried_in_lamports, e.spent_lamports, e.burned, e.carried_out_lamports),
        (D2, carried, 0, carried, carried, burned, 0)
    );
    assert_eq!((e.piece, e.budget_left_lamports), (1, 0));
    let head = format!("DEBT|carried|through=2026-10-06|spent={carried}|");
    assert!(meta.logs.iter().any(|l| l.contains(&head) && l.contains("|left=0|piece=1|") && l.contains("|v1")), "memo {head} in logs:\n{}", meta.logs.join("\n"));
    let c = env.config(&cfg);
    // Never a reading, never the cursor: only the money totals moved.
    assert_eq!((c.crank_cursor, c.last_record_date, c.readings), (before.crank_cursor, before.last_record_date, before.readings));
    // R5-8: the pieces are counted in CarriedPace, not in `burns` (reading cranks only).
    assert_eq!((c.total_spent_lamports, c.total_burned, c.burns), (before.total_spent_lamports + carried, before.total_burned + burned, before.burns));
    let p = carried_pace(&env, &mint).expect("pace");
    assert_eq!((p.mint, p.pieces, p.spent_lamports, p.last_carried_at, p.budget_lamports), (mint, 1, carried, env.now(), 0));
    let r = env.reading(&reading_pda(&cfg, D2)).unwrap();
    assert_eq!((r.spent_lamports, r.carried_out_lamports, r.burned), (reading_before.spent_lamports, reading_before.carried_out_lamports, reading_before.burned));
    // Nothing left: refused at zero.
    quiet(&mut env);
    expect_anchor_err(env.send(&[cpmm::ix_crank_carried(&cranker.pubkey(), &mint, &m.pool, SOL)], &[&cranker]), "NothingCarried");
}

#[test]
fn refused_with_nothing_carried_and_for_a_zero_piece() {
    let mut env = Env::new();
    let m = market(&mut env);
    let mint = m.t.mint.pubkey();
    // No reading at all yet: nothing carried.
    expect_anchor_err(env.send(&[cpmm::ix_crank_carried(&env.payer.pubkey(), &mint, &m.pool, SOL)], &[]), "NothingCarried");
    carried_market(&mut env, &m);
    quiet(&mut env);
    expect_anchor_err(env.send(&[cpmm::ix_crank_carried(&env.payer.pubkey(), &mint, &m.pool, 0)], &[]), "NothingCarried");
}

/// Owner decision 2026-10-25: a piece above the old per-crank cap (2 % of the reserve) is accepted, never SpendAboveCap; a request
/// above the carry spends the carry; a piece under the floor that is not the whole remainder is still refused.
#[test]
fn a_piece_above_the_old_per_crank_cap_is_accepted() {
    let mut env = Env::new();
    let m = market(&mut env);
    let mint = m.t.mint.pubkey();
    let carried = carried_market(&mut env, &m);
    quiet(&mut env);
    let (r_sol, _) = cpmm::reserves(&env, &m.pool);
    let old_cap = r_sol / 50;
    expect_anchor_err(env.send(&[cpmm::ix_crank_carried(&env.payer.pubkey(), &mint, &m.pool, buyback_rule().floor_lamports - 1)], &[]), "BelowFloor");
    env.ok(&[cpmm::ix_crank_carried(&env.payer.pubkey(), &mint, &m.pool, old_cap + 1)], &[]);
    assert_eq!(env.config(&config_pda(&mint)).carried_spend_lamports, carried - old_cap - 1);
    quiet(&mut env);
    env.ok(&[cpmm::ix_crank_carried(&env.payer.pubkey(), &mint, &m.pool, u64::MAX)], &[]);
    assert_eq!(env.config(&config_pda(&mint)).carried_spend_lamports, 0);
}

#[test]
fn the_twap_guard_holds_a_piece_against_a_pushed_price() {
    let mut env = Env::new();
    let m = market(&mut env);
    let mint = m.t.mint.pubkey();
    let carried = carried_market(&mut env, &m);
    quiet(&mut env);
    quiet(&mut env); // two windows: the TWAP has fully caught up with the reading's whole-target buy
    // A same-second push: the oracle has only the pre-push price, the spot sits far from it.
    let tokens_before = env.token_amount(&get_associated_token_address(&m.trader.pubkey(), &mint));
    cpmm::swap(&mut env, &m.trader, &m.pool, &mint, true, 60 * SOL).unwrap();
    let sol_before = fee_sol(&env, &mint);
    expect_anchor_err(env.send(&[cpmm::ix_crank_carried(&env.payer.pubkey(), &mint, &m.pool, SOL)], &[]), "TwapDeviation");
    assert_eq!(fee_sol(&env, &mint), sol_before);
    assert_eq!(env.config(&config_pda(&mint)).carried_spend_lamports, carried);
    // Unwound in the same second: the piece goes through.
    let bought = env.token_amount(&get_associated_token_address(&m.trader.pubkey(), &mint)) - tokens_before;
    cpmm::swap(&mut env, &m.trader, &m.pool, &mint, false, bought).unwrap();
    env.ok(&[cpmm::ix_crank_carried(&env.payer.pubkey(), &mint, &m.pool, SOL)], &[]);
    assert_eq!(env.config(&config_pda(&mint)).carried_spend_lamports, carried - SOL);
}

#[test]
fn a_waiting_reading_is_always_cranked_first() {
    let mut env = Env::new();
    let m = market(&mut env);
    let mint = m.t.mint.pubkey();
    let cfg = config_pda(&mint);
    let carried = carried_market(&mut env, &m);
    env.set_time(env.now() + 86_400);
    submit(&mut env, &mint, D3, V1 + 22 * UNIT, &[&m.t.attesters[0]]).unwrap();
    // The queue rule: a submitted reading is waiting, so the carried spend belongs to ITS crank's target first.
    expect_anchor_err(env.send(&[cpmm::ix_crank_carried(&env.payer.pubkey(), &mint, &m.pool, SOL)], &[]), "ReadingPending");
    env.ok(&[cpmm::ix_crank_buyback(&env.payer.pubkey(), &mint, &m.pool, D3)], &[]);
    let r = env.reading(&reading_pda(&cfg, D3)).unwrap();
    assert_eq!(r.carried_in_lamports, carried, "the reading's crank saw the whole carried amount");
    // ... and spent it with its own share in the same run (no per-crank bound): nothing is left for crank_carried.
    assert_eq!((r.spent_lamports, r.carried_out_lamports), (r.rule_spend_lamports + carried, 0));
    assert_eq!(env.config(&cfg).carried_spend_lamports, 0);
    quiet(&mut env);
    expect_anchor_err(env.send(&[cpmm::ix_crank_carried(&env.payer.pubkey(), &mint, &m.pool, SOL)], &[]), "NothingCarried");
    // The through date follows the cursor.
    assert_eq!(env.config(&cfg).crank_cursor, D3);
}

// =================================================================================================================================
// round-5 review R5-8 (budget removed 2026-10-25): one piece per coin per second, counted apart from `burns`
// =================================================================================================================================

fn pace_ix_with(env: &Env, m: &Market, max: u64, f: impl FnOnce(&mut anchor_lang::solana_program::instruction::Instruction)) -> anchor_lang::solana_program::instruction::Instruction {
    let mut ix = cpmm::ix_crank_carried(&env.payer.pubkey(), &m.t.mint.pubkey(), &m.pool, max);
    f(&mut ix);
    ix
}

#[test]
fn the_first_piece_creates_the_pace_and_a_second_piece_waits_only_for_the_next_second() {
    let mut env = Env::new();
    let m = market(&mut env);
    let mint = m.t.mint.pubkey();
    let cfg = config_pda(&mint);
    let carried = carried_market(&mut env, &m);
    quiet(&mut env);
    let burns = env.config(&cfg).burns;
    assert!(carried_pace(&env, &mint).is_none(), "no pace before the first piece");
    let cranker = Keypair::new();
    env.fund(&cranker.pubkey(), SOL);
    let cranker_before = env.lamports(&cranker.pubkey());
    env.ok(&[cpmm::ix_crank_carried(&cranker.pubkey(), &mint, &m.pool, SOL)], &[&cranker]);
    let t1 = env.now();
    let rent = env.svm.minimum_balance_for_rent_exemption(8 + <burn_receipts::state::CarriedPace as anchor_lang::Space>::INIT_SPACE);
    assert_eq!(env.lamports(&carried_pace_pda(&mint)), rent);
    assert_eq!(cranker_before - env.lamports(&cranker.pubkey()), rent, "the cranker paid the pace rent (the harness payer pays the fee)");
    let p = carried_pace(&env, &mint).unwrap();
    assert_eq!((p.version, p.pieces, p.spent_lamports, p.last_carried_at, p.budget_lamports), (1, 1, SOL, t1, 0));
    // The same second: refused, by anyone; nothing moves.
    expect_anchor_err(env.send(&[cpmm::ix_crank_carried(&env.payer.pubkey(), &mint, &m.pool, buyback_rule().floor_lamports)], &[]), "CarriedTooSoon");
    assert_eq!(env.config(&cfg).carried_spend_lamports, carried - SOL);
    // One second later there is no budget to wait for: the guards (here the pool's own TWAP, still carrying the 1 SOL buy a second
    // ago in this quiet test pool) are the only thing that can hold a piece.
    env.set_time(t1 + 1);
    let r = env.send(&[cpmm::ix_crank_carried(&cranker.pubkey(), &mint, &m.pool, SOL)], &[&cranker]);
    if let Err(e) = &r { assert!(!format!("{e:?}").contains("CarriedTooSoon"), "{e:?}"); }
    quiet(&mut env);
    let left = env.config(&cfg).carried_spend_lamports;
    env.ok(&[cpmm::ix_crank_carried(&cranker.pubkey(), &mint, &m.pool, left)], &[&cranker]);
    let c = env.config(&cfg);
    assert_eq!((c.carried_spend_lamports, c.burns), (0, burns), "the carried counter moves, `burns` does not");
    let p = carried_pace(&env, &mint).unwrap();
    assert_eq!((p.spent_lamports, p.budget_lamports), (carried, 0));
}

#[test]
fn two_pieces_in_one_transaction_are_refused() {
    let mut env = Env::new();
    let m = market(&mut env);
    let mint = m.t.mint.pubkey();
    let cfg = config_pda(&mint);
    let carried = carried_market(&mut env, &m);
    quiet(&mut env);
    let floor = buyback_rule().floor_lamports;
    // Two pieces in one transaction (one second): the second is refused, so the whole transaction is.
    let two = [cpmm::ix_crank_carried(&env.payer.pubkey(), &mint, &m.pool, floor), pace_ix_with(&env, &m, floor + 1, |_| {})];
    expect_anchor_err(env.send(&two, &[]), "CarriedTooSoon");
    assert!(carried_pace(&env, &mint).is_none());
    assert_eq!(env.config(&cfg).carried_spend_lamports, carried);
    // One piece of the whole carry goes through.
    env.ok(&[cpmm::ix_crank_carried(&env.payer.pubkey(), &mint, &m.pool, carried)], &[]);
    assert_eq!(env.config(&cfg).carried_spend_lamports, 0);
    assert_eq!(carried_pace(&env, &mint).unwrap().pieces, 1);
}

#[test]
fn a_pace_account_that_is_not_the_coins_or_of_an_unknown_version_is_refused() {
    let mut env = Env::new();
    let m = market(&mut env);
    let mint = m.t.mint.pubkey();
    carried_market(&mut env, &m);
    quiet(&mut env);
    // Another coin's pace address (or any other account) in the pace slot: refused, so the one-per-second rule cannot be dodged.
    for wrong in [carried_pace_pda(&Pubkey::new_unique()), Pubkey::new_unique()] {
        let ix = pace_ix_with(&env, &m, SOL, |ix| {
            let at = ix.accounts.iter().position(|a| a.pubkey == carried_pace_pda(&mint)).unwrap();
            ix.accounts[at].pubkey = wrong;
        });
        expect_anchor_err(env.send(&[ix], &[]), "InvalidCarriedPace");
    }
    env.ok(&[cpmm::ix_crank_carried(&env.payer.pubkey(), &mint, &m.pool, SOL)], &[]);
    assert_eq!(carried_pace(&env, &mint).unwrap().pieces, 1);
    // A pace whose version byte is not 1 (a later layout this program does not know): refused.
    let key = carried_pace_pda(&mint);
    let mut acc = env.svm.get_account(&key).unwrap();
    acc.data[8] = 2;
    env.svm.set_account(key, acc).unwrap();
    quiet(&mut env);
    expect_anchor_err(env.send(&[cpmm::ix_crank_carried(&env.payer.pubkey(), &mint, &m.pool, SOL)], &[]), "InvalidCarriedPace");
}

#[test]
fn a_pre_funded_pace_address_is_taken_over_by_the_first_piece() {
    let mut env = Env::new();
    let m = market(&mut env);
    let mint = m.t.mint.pubkey();
    carried_market(&mut env, &m);
    quiet(&mut env);
    // Someone sends lamports to the pace PDA's address before the coin's first piece (a system-owned account with no data).
    let key = carried_pace_pda(&mint);
    env.transfer_sol(&key, 1_000_000);
    assert_eq!(env.lamports(&key), 1_000_000);
    env.ok(&[cpmm::ix_crank_carried(&env.payer.pubkey(), &mint, &m.pool, SOL)], &[]);
    let rent = env.svm.minimum_balance_for_rent_exemption(8 + <burn_receipts::state::CarriedPace as anchor_lang::Space>::INIT_SPACE);
    let acc = env.svm.get_account(&key).unwrap();
    assert_eq!((acc.owner, acc.lamports), (burn_receipts::ID, rent), "topped up to rent, allocated and assigned to the program");
    let p = carried_pace(&env, &mint).unwrap();
    assert_eq!((p.mint, p.pieces, p.spent_lamports), (mint, 1, SOL));
}
