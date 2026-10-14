//! crank_carried — burn dispersal (2026-10-13). A reading's crank spends at most 2 % of the pool's WSOL reserve and carries the rest
//! (review H-1); crank_carried spends that carried amount in caller-sized pieces without a new reading, under the same pool, TWAP,
//! slippage and integrity checks, and only while no reading waits for its own crank (the queue rule).

#![allow(clippy::result_large_err, clippy::too_many_arguments)]

mod common;

use anchor_lang::prelude::Pubkey;
use anchor_spl::associated_token::get_associated_token_address;
use burn_receipts::constants::*;
use burn_receipts::math;
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
        env.init_platform(&auth, DEFAULT_BURN_POOL_CAP_LAMPORTS);
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

/// 10 SOL of creator fees and a 21-unit reading: the rule's spend (~6.6 SOL) is far above the 2 % cap (~1.7 SOL), so the reading's
/// crank carries ~4.9 SOL. Returns the carried amount.
fn carried_market(env: &mut Env, m: &Market) -> u64 {
    let mint = m.t.mint.pubkey();
    env.transfer_sol(&fee_pda(&mint), 10 * SOL);
    let a = &m.t.attesters[0];
    submit(env, &mint, D1, V1, &[a]).unwrap();
    submit(env, &mint, D2, V1 + 21 * UNIT, &[a]).unwrap();
    env.ok(&[cpmm::ix_crank_buyback(&env.payer.pubkey(), &mint, &m.pool, D2)], &[]);
    let c = env.config(&config_pda(&mint));
    assert!(c.carried_spend_lamports > 3 * SOL, "the market carries a large spend: {}", c.carried_spend_lamports);
    c.carried_spend_lamports
}

/// One window of quiet trading: a quiet pool's TWAP is its current price again one window after its last trade.
fn quiet(env: &mut Env) {
    env.set_time(env.now() + 601);
}

fn fee_sol(env: &Env, mint: &Pubkey) -> u64 {
    let fee = fee_pda(mint);
    env.lamports(&fee) + env.token_amount(&get_associated_token_address(&fee, &NATIVE_MINT))
}

#[test]
fn a_carried_spend_drains_in_three_capped_pieces_without_touching_readings() {
    let mut env = Env::new();
    let m = market(&mut env);
    let mint = m.t.mint.pubkey();
    let cfg = config_pda(&mint);
    let fee_tokens = get_associated_token_address(&fee_pda(&mint), &mint);
    let mut carried = carried_market(&mut env, &m);
    let before = env.config(&cfg);
    let reading_before = env.reading(&reading_pda(&cfg, D2)).unwrap();
    let cranker = Keypair::new();
    env.fund(&cranker.pubkey(), SOL);

    let mut calls = 0;
    let mut spent_total = 0u64;
    let mut burned_total = 0u64;
    while carried > 0 {
        quiet(&mut env);
        calls += 1;
        assert!(calls <= 3, "drained in three calls");
        let (r_sol, _) = cpmm::reserves(&env, &m.pool);
        let cap = math::reserve_spend_cap(r_sol, MAX_SPEND_RESERVE_BPS);
        let supply = env.mint_supply(&mint);
        let sol_before = fee_sol(&env, &mint);
        let meta = env.ok(&[cpmm::ix_crank_carried(&cranker.pubkey(), &mint, &m.pool, cap)], &[&cranker]);
        let piece = carried.min(cap);
        assert_eq!(env.config(&cfg).carried_spend_lamports, carried - piece);
        assert_eq!(fee_sol(&env, &mint), sol_before - piece, "exactly the piece left the fee PDA");
        assert_eq!(env.token_amount(&fee_tokens), 0, "every token the fee PDA held is burned");
        let burned = supply - env.mint_supply(&mint);
        assert!(burned > 0);
        // The event row and the memo name the date this piece drains through (the crank cursor).
        let ev = events(&meta)
            .into_iter()
            .find(|(d, _)| d[..] == <burn_receipts::events::CarriedSpent as anchor_lang::Discriminator>::DISCRIMINATOR[..])
            .expect("CarriedSpent");
        let e = <burn_receipts::events::CarriedSpent as anchor_lang::AnchorDeserialize>::try_from_slice(&ev.1).unwrap();
        assert_eq!(
            (e.through_date, e.max_spend_lamports, e.reserve_cap_lamports, e.carried_in_lamports, e.spent_lamports, e.burned, e.carried_out_lamports),
            (D2, cap, cap, carried, piece, burned, carried - piece)
        );
        let head = format!("DEBT|carried|through=2026-10-06|spent={piece}|");
        let left = format!("|left={}|", carried - piece);
        assert!(meta.logs.iter().any(|l| l.contains(&head) && l.contains(&left) && l.contains("|v1")), "memo {head}…{left} in logs:\n{}", meta.logs.join("\n"));
        spent_total += piece;
        burned_total += burned;
        carried -= piece;
    }
    assert_eq!(calls, 3);
    let c = env.config(&cfg);
    // Never a reading, never the cursor: only the money totals moved.
    assert_eq!((c.crank_cursor, c.last_record_date, c.readings), (before.crank_cursor, before.last_record_date, before.readings));
    assert_eq!((c.total_spent_lamports, c.total_burned, c.burns), (before.total_spent_lamports + spent_total, before.total_burned + burned_total, before.burns + 3));
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

#[test]
fn a_piece_above_the_per_crank_cap_is_refused_not_clamped() {
    let mut env = Env::new();
    let m = market(&mut env);
    let mint = m.t.mint.pubkey();
    let carried = carried_market(&mut env, &m);
    quiet(&mut env);
    let (r_sol, _) = cpmm::reserves(&env, &m.pool);
    let cap = math::reserve_spend_cap(r_sol, MAX_SPEND_RESERVE_BPS);
    expect_anchor_err(env.send(&[cpmm::ix_crank_carried(&env.payer.pubkey(), &mint, &m.pool, cap + 1)], &[]), "SpendAboveCap");
    assert_eq!(env.config(&config_pda(&mint)).carried_spend_lamports, carried);
    // A piece under the floor that is not the whole remainder is refused too.
    expect_anchor_err(env.send(&[cpmm::ix_crank_carried(&env.payer.pubkey(), &mint, &m.pool, buyback_rule().floor_lamports - 1)], &[]), "BelowFloor");
    env.ok(&[cpmm::ix_crank_carried(&env.payer.pubkey(), &mint, &m.pool, cap)], &[]);
    assert_eq!(env.config(&config_pda(&mint)).carried_spend_lamports, carried - cap);
}

#[test]
fn the_twap_guard_holds_a_piece_against_a_pushed_price() {
    let mut env = Env::new();
    let m = market(&mut env);
    let mint = m.t.mint.pubkey();
    let carried = carried_market(&mut env, &m);
    quiet(&mut env);
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
    quiet(&mut env);
    env.ok(&[cpmm::ix_crank_carried(&env.payer.pubkey(), &mint, &m.pool, SOL)], &[]);
    assert_eq!(env.config(&cfg).carried_spend_lamports, r.carried_out_lamports - SOL);
    // The through date follows the cursor.
    assert_eq!(env.config(&cfg).crank_cursor, D3);
}
