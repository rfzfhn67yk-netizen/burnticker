use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint};

use crate::constants::*;
use crate::cpmm::PoolView;
use crate::error::BurnError;
use crate::events::PoolRegistered;
use crate::instructions::crank_common::require_fixed_supply;
use crate::pair_curve::{pair_pool, pair_vault, PairView, PAIR_STATUS_GRADUATED, PAIR_STATUS_GRADUATING};
use crate::state::TokenConfig;

/// PERMISSIONLESS, ONCE. Registration policy 2 (POOL_POLICY_PAIR_CURVE, 2026-10-10): records the CPMM pool that pair_curve's
/// `graduate` created for this token. The existing LaunchLab path (register_pool, policy 0) is untouched. Accepted only when:
///   * the Pair account is owned by pair_curve (hard-coded id), carries the Pair discriminator, sits at its PDA
///     ["pair", mint_a, mint_b], has status Graduated (or Graduating — pair_curve graduates one side per transaction) and lists this
///     mint as one of its two sides;
///   * the pool is the one the Pair records for that side AND the pair_curve PDA ["pool", pair, [side]] (only pair_curve can sign
///     for that address, so only its `graduate` can have created a pool there);
///   * the pool is a CPMM PoolState of WSOL / this mint on SPL Token, on the cpConfigId pinned at initialize_token (= the Pair's), and
///     its `pool_creator` is the pair's SOL vault PDA ["vault", pair];
///   * LP: the Pair records ≥ 90 % of the LP that existed at creation as locked (pair_curve's lock_lp moves it into Raydium's CPMM
///     lock — LAUNCHPAD-PATH §35; pairs graduated before that burned it, and the same field then records the burn), and the chain
///     agrees — burned (lp_supply − LP mint supply: every burn plus the 100 never-minted units) + locked (the LP in the lock
///     authority's account ATA(LOCK_CPMM_AUTHORITY, lp_mint)) is at least that record. Measured against the CREATION supply, so a
///     later depositor cannot dilute the ratio and block registration (the blind-review-3 M-2 class).
#[event_cpi]
#[derive(Accounts)]
pub struct RegisterPairPool<'info> {
    /// Anyone (recorded in the event).
    pub registrar: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED, config.mint.as_ref()], bump = config.bump)]
    pub config: Box<Account<'info, TokenConfig>>,
    /// The token's mint: fixed supply, no freeze authority (review L-3).
    #[account(address = config.mint)]
    pub mint: Box<Account<'info, Mint>>,
    /// CHECK: owner, discriminator, address, mints, token programs, creator, AmmConfig and LP are checked in the handler.
    pub pool_state: UncheckedAccount<'info>,
    /// The pool's LP mint (must equal pool_state.lp_mint).
    pub lp_mint: Box<Account<'info, Mint>>,
    /// CHECK: the pair_curve Pair account (owner, discriminator, PDA and status checked in the handler).
    pub pair: UncheckedAccount<'info>,
    /// CHECK: Raydium's LP-lock account for this LP mint: ATA(LOCK_CPMM_AUTHORITY, lp_mint), address-checked in the handler; it may not
    /// exist (then nothing is locked).
    pub lp_lock_vault: UncheckedAccount<'info>,
}

pub fn handle_register_pair_pool(ctx: Context<RegisterPairPool>) -> Result<()> {
    let a = &ctx.accounts;
    let c = &a.config;
    require!(c.rule.mode == MODE_BUYBACK, BurnError::WrongMode);
    require!(c.registration_policy == POOL_POLICY_PAIR_CURVE, BurnError::WrongPoolPolicy);
    require!(c.cpmm_pool == Pubkey::default() && !c.pool_verified, BurnError::PoolAlreadyRegistered);
    // LAUNCHPAD-PATH §40: every pair is winner-takes-the-burn — the two coins must be paired (link_pair, the Pair as witness) first.
    // Policy-2 coins can only be paired by link_pair (initialize_token refuses a partner for them), so PAIRED means "paired to the
    // other mint of this Pair". Pair-forward r3 (RN-1): a coin unlinked on terminal evidence (its partner side voided / refunding)
    // still registers its own pool — it burns as a plain coin.
    require_fixed_supply(&a.mint)?;
    let mint = c.mint;

    // The Pair: pair_curve's, graduated, naming this mint.
    let pair_key = a.pair.key();
    let pair = PairView::load(&a.pair.to_account_info())?;
    // Graduated, or Graduating with this side's pool already recorded (graduate runs once per side).
    require!(pair.status == PAIR_STATUS_GRADUATED || pair.status == PAIR_STATUS_GRADUATING, BurnError::PairNotGraduated);
    let side = pair.mints.iter().position(|m| *m == mint).ok_or(BurnError::NotPairPool)?;
    // Pair-forward round-3 re-check P3-1: a coin whose link_pair never landed (PAIR_STATE_NONE) registers anyway when the Pair shows the
    // OTHER side refunding — the same terminal evidence unlink_pair accepts, read from this very Pair (owner, PDA and mints checked
    // above/below) — and becomes UNLINKED (a plain coin), so its graduated pool and burn escrow are never frozen. Chosen over an
    // unlink without PairLinks: no new accounts, no account closing, and the evidence is checked where the Pair is already loaded.
    let never_linked_terminal = c.pair_state == PAIR_STATE_NONE && pair.refunding[1 - side];
    require!(c.pair_state == PAIR_STATE_PAIRED || c.pair_state == PAIR_STATE_UNLINKED || never_linked_terminal, BurnError::PairNotLinked);
    let pool_key = a.pool_state.key();
    require_keys_eq!(pool_key, pair.pools[side], BurnError::NotPairPool);
    require_keys_eq!(pool_key, pair_pool(&pair_key, side as u8), BurnError::NotPairPool);
    let vault = pair_vault(&pair_key);
    require_keys_eq!(pair.vault, vault, BurnError::InvalidPairAccount);

    // The pool: WSOL / mint on SPL Token, the pinned AmmConfig, created by the pair's vault.
    let pool = PoolView::load(&a.pool_state.to_account_info())?;
    require!(pool.wsol_is_token_0(&NATIVE_MINT, &mint).is_some(), BurnError::InvalidPoolMints);
    require!(pool.token_0_program == token::ID && pool.token_1_program == token::ID, BurnError::InvalidPoolMints);
    require_keys_eq!(pool.pool_creator, vault, BurnError::PoolCreatorMismatch);
    require!(c.ll_cp_config != Pubkey::default(), BurnError::NotPairPool);
    require_keys_eq!(pool.amm_config, c.ll_cp_config, BurnError::NotPairPool);
    require_keys_eq!(pair.cp_config, c.ll_cp_config, BurnError::NotPairPool);

    // LP: ≥ 90 % of the creation supply burned per the Pair's record, and the burn is real on chain.
    require_keys_eq!(a.lp_mint.key(), pool.lp_mint, BurnError::InvalidCpmmAccount);
    let (created, recorded) = (pair.lp_supply_at_creation[side], pair.lp_locked[side]);
    require!(created > 0 && (recorded as u128) * BPS_DENOMINATOR >= PAIR_MIN_BURNED_LP_BPS * created as u128, BurnError::LpNotLocked);
    let burned_on_chain = pool.lp_supply.saturating_sub(a.lp_mint.supply);
    let lock_vault = a.lp_lock_vault.to_account_info();
    require_keys_eq!(*lock_vault.key, anchor_spl::associated_token::get_associated_token_address(&LOCK_CPMM_AUTHORITY, &pool.lp_mint), BurnError::InvalidCpmmAccount);
    let locked_on_chain = crate::instructions::register_pool::lock_vault_amount(&lock_vault, &pool.lp_mint)?;
    require!(pool.lp_supply >= created && (burned_on_chain as u128) + (locked_on_chain as u128) >= recorded as u128, BurnError::LpNotLocked);

    let c = &mut ctx.accounts.config;
    c.cpmm_pool = pool_key;
    c.pool_verified = true;
    if never_linked_terminal {
        c.pair_state = PAIR_STATE_UNLINKED;
        c.pair_unlinked_at = Clock::get()?.unix_timestamp;
    }
    let config = c.key();
    emit_cpi!(PoolRegistered { config, pool: pool_key, registrar: ctx.accounts.registrar.key() });
    Ok(())
}
