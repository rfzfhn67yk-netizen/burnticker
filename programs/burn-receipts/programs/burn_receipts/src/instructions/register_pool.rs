use anchor_lang::prelude::*;
use anchor_spl::associated_token::get_associated_token_address;
use anchor_spl::token::{self, Mint};

use crate::constants::*;
use crate::cpmm::{self, LaunchLabPoolView, PoolView};
use crate::error::BurnError;
use crate::events::PoolRegistered;
use crate::instructions::crank_common::require_fixed_supply;
use crate::state::TokenConfig;

/// PERMISSIONLESS, ONCE. Verifies the CPMM pool the buyback will trade on (review-2 F5 / F14).
///
///   POOL_POLICY_CREATOR_IS_FEE_PDA (0): records the pool. It must be LaunchLab's own migration pool for this token:
///     * the token's LaunchLab pool (["pool", mint, WSOL] under LaunchLab, owner-checked) records the fee PDA as creator and CPMM as
///       its migration target;
///     * the CPMM pool is the deterministic PDA [POOL_SEED, cpConfigId, token_0, token_1] of the AmmConfig that the token's LaunchLab
///       PLATFORM names for migrations (`cpConfigId`, SDK layout.ts PlatformConfig) — a random-keypair pool or a pool on any other
///       AmmConfig is refused;
///     * its `pool_creator` is the fee PDA;
///     * ≥ 90 % of its LP is burned or held by Raydium's LP lock, as LaunchLab's migration leaves it (platform/creator lock NFTs +
///       burn: SDK instrument.ts createPlatformConfig `migrateCpLockNftScale {platformScale, creatorScale, burnScale}`).
///     * lp-lock blind review RL-3: the mint's FeeKeyRecord exists for THIS pool — register_fee_key ran first and found the
///       migration's lock position (locker = LaunchLab's vault authority) with its Fee Key held by FEE_KEYS. A Fee Key the platform
///       admin redirected before migration therefore fails closed here: `pool_verified` implies the LP fees fund the burn.
///   POOL_POLICY_FIXED (1): the pool was fixed at init by the creator (creator trust); it must still have the fee PDA as
///     `pool_creator` and ≥ 90 % of its LP burned or locked. Sets `pool_verified`; crank_buyback refuses an unverified pool.
///
/// Why all of it: in raydium-cp-swap `initialize_with_permission` the `creator` is an UNCHECKED account chosen by any holder of a
/// Raydium Permission PDA, so `pool_creator == fee PDA` alone does not prove LaunchLab made the pool (blind review 2, F5).
#[event_cpi]
#[derive(Accounts)]
pub struct RegisterPool<'info> {
    /// Anyone (recorded in the event).
    pub registrar: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED, config.mint.as_ref()], bump = config.bump)]
    pub config: Box<Account<'info, TokenConfig>>,
    #[account(seeds = [FEE_SEED, config.mint.as_ref()], bump = config.fee_bump)]
    pub fee_vault: SystemAccount<'info>,
    /// The token's mint: must be fixed-supply with no freeze authority (review L-3).
    #[account(address = config.mint)]
    pub mint: Box<Account<'info, Mint>>,
    /// CHECK: owner, discriminator, address, mints, token programs, creator and LP are checked in the handler.
    pub pool_state: UncheckedAccount<'info>,
    /// The pool's LP mint (must equal pool_state.lp_mint).
    pub lp_mint: Box<Account<'info, Mint>>,
    /// CHECK: Raydium's LP-lock account for this LP mint: ATA(LOCK_CPMM_AUTHORITY, lp_mint), address-checked in the handler; it may
    /// not exist (then nothing is locked).
    pub lp_lock_vault: UncheckedAccount<'info>,
    /// CHECK: policy 0: the token's LaunchLab pool ["pool", mint, WSOL] (owner + address checked; its platformId must be the platform
    /// pinned at initialize_token). Omitted under policy 1.
    pub launchlab_pool: Option<UncheckedAccount<'info>>,
    /// CHECK: policy 0: the mint's FeeKeyRecord ["fee_key", mint] (seeds, owner, discriminator checked in the handler) — lp-lock blind
    /// review RL-3: the migration's LP-lock Fee Key must already be recorded as held by FEE_KEYS for THIS pool, so a Fee Key the
    /// platform admin redirected fails closed before the pool is verified. Omitted under policy 1.
    pub fee_key: Option<UncheckedAccount<'info>>,
}

/// The LaunchLab facts that prove the migration pool (policy 0): the token's LaunchLab pool account, the platform it must record
/// (pinned at initialize_token) and the AmmConfig the CPMM pool PDA is derived from (pinned at init for register_pool; the pinned
/// platform's current one for replace_pool).
pub struct LaunchLabProof<'a, 'info> {
    pub pool: &'a AccountInfo<'info>,
    pub platform: Pubkey,
    pub cp_config: Pubkey,
}

/// Every provenance check shared by register_pool and replace_pool (and the fixed-pool check without `launchlab`).
pub fn verify_pool_provenance(
    pool_acc: &AccountInfo,
    mint: &Pubkey,
    fee_vault: &Pubkey,
    lp_mint: &Account<Mint>,
    lp_lock_vault: &AccountInfo,
    launchlab: Option<LaunchLabProof>,
) -> Result<(PoolView, u128)> {
    let pool = PoolView::load(pool_acc)?;
    require!(pool.wsol_is_token_0(&NATIVE_MINT, mint).is_some(), BurnError::InvalidPoolMints);
    require!(pool.token_0_program == token::ID && pool.token_1_program == token::ID, BurnError::InvalidPoolMints);
    require_keys_eq!(pool.pool_creator, *fee_vault, BurnError::PoolCreatorMismatch);

    // LP: burned (lp_supply − mint supply) + locked (the lock authority's account) ≥ 50 % of CPMM's live lp_supply (review-3 M-2).
    require_keys_eq!(lp_mint.key(), pool.lp_mint, BurnError::InvalidCpmmAccount);
    require_keys_eq!(*lp_lock_vault.key, get_associated_token_address(&LOCK_CPMM_AUTHORITY, &pool.lp_mint), BurnError::InvalidCpmmAccount);
    let locked = lock_vault_amount(lp_lock_vault, &pool.lp_mint)?;
    let locked_bps = cpmm::locked_lp_bps(pool.lp_supply, lp_mint.supply, locked);
    require!(locked_bps >= MIN_LOCKED_LP_BPS, BurnError::LpNotLocked);

    if let Some(ll) = launchlab {
        let lp = LaunchLabPoolView::load(ll.pool, mint)?;
        require!(lp.mint_a == *mint && lp.mint_b == NATIVE_MINT, BurnError::InvalidLaunchLabAccount);
        require!(lp.migrate_type == LL_MIGRATE_TYPE_CPMM, BurnError::NotMigrationPool);
        require_keys_eq!(lp.creator, *fee_vault, BurnError::PoolCreatorMismatch);
        require_keys_eq!(lp.platform_id, ll.platform, BurnError::InvalidLaunchLabAccount);
        require_keys_eq!(pool.amm_config, ll.cp_config, BurnError::NotMigrationPool);
        require_keys_eq!(*pool_acc.key, cpmm::pool_pda(&ll.cp_config, &NATIVE_MINT, mint), BurnError::NotMigrationPool);
    }
    Ok((pool, locked_bps))
}

pub fn handle_register_pool(ctx: Context<RegisterPool>) -> Result<()> {
    let a = &ctx.accounts;
    let c = &a.config;
    require!(c.rule.mode == MODE_BUYBACK, BurnError::WrongMode);
    require_fixed_supply(&a.mint)?;
    let mint = c.mint;
    let fee = a.fee_vault.key();
    match c.registration_policy {
        POOL_POLICY_CREATOR_IS_FEE_PDA => {
            require!(c.cpmm_pool == Pubkey::default(), BurnError::PoolAlreadyRegistered);
            let Some(ll_pool) = a.launchlab_pool.as_ref() else {
                return err!(BurnError::LaunchLabAccountsRequired);
            };
            let llp = ll_pool.to_account_info();
            // Review-3 M-3: the platform and its cpConfigId as PINNED at initialize_token — a later platform-admin change of
            // cpConfigId (updateCpConfigId) cannot strand or redirect the registration.
            verify_pool_provenance(
                &a.pool_state.to_account_info(),
                &mint,
                &fee,
                &a.lp_mint,
                &a.lp_lock_vault.to_account_info(),
                Some(LaunchLabProof { pool: &llp, platform: c.ll_platform, cp_config: c.ll_cp_config }),
            )?;
            // RL-3: the LP fees must reach the burn — the Fee Key of the migration's lock position is recorded (register_fee_key,
            // which identifies the position by LaunchLab's locker and requires FEE_KEYS to hold its NFT) for this very pool.
            let Some(fk) = a.fee_key.as_ref() else {
                return err!(BurnError::FeeKeyNotRegistered);
            };
            let (fk_pda, _) = Pubkey::find_program_address(&[FEE_KEY_SEED, mint.as_ref()], &crate::ID);
            require_keys_eq!(fk.key(), fk_pda, BurnError::FeeKeyNotRegistered);
            let fki = fk.to_account_info();
            require!(fki.owner == &crate::ID && !fki.data_is_empty(), BurnError::FeeKeyNotRegistered);
            let rec = crate::state::FeeKeyRecord::try_deserialize(&mut &fki.try_borrow_data()?[..]).map_err(|_| BurnError::FeeKeyNotRegistered)?;
            require_keys_eq!(rec.pool, a.pool_state.key(), BurnError::FeeKeyMismatch);
        }
        POOL_POLICY_FIXED => {
            require!(!c.own_pool_verified(), BurnError::PoolAlreadyRegistered);
            require_keys_eq!(a.pool_state.key(), c.cpmm_pool, BurnError::WrongPoolPolicy);
            verify_pool_provenance(&a.pool_state.to_account_info(), &mint, &fee, &a.lp_mint, &a.lp_lock_vault.to_account_info(), None)?;
        }
        _ => return err!(BurnError::WrongPoolPolicy),
    }
    let pool_key = ctx.accounts.pool_state.key();
    let c = &mut ctx.accounts.config;
    c.cpmm_pool = pool_key;
    // Round-5 review R5-12 (rollback fence): a target coin records this outside `pool_verified`, so round 4 can never self-burn it.
    c.set_own_pool_verified(true);
    let config = c.key();
    emit_cpi!(PoolRegistered { config, pool: pool_key, registrar: ctx.accounts.registrar.key() });
    Ok(())
}

/// The LP held by Raydium's lock authority in ATA(LOCK_CPMM_AUTHORITY, lp_mint) (the caller address-checks the account), or 0 when
/// that account does not exist.
pub fn lock_vault_amount(lp_lock_vault: &AccountInfo, lp_mint: &Pubkey) -> Result<u64> {
    if lp_lock_vault.owner == &token::ID && lp_lock_vault.data_len() >= 72 {
        let d = lp_lock_vault.try_borrow_data()?;
        require!(d[..32] == lp_mint.to_bytes()[..] && d[32..64] == LOCK_CPMM_AUTHORITY.to_bytes()[..], BurnError::InvalidCpmmAccount);
        Ok(u64::from_le_bytes(d[64..72].try_into().map_err(|_| BurnError::InvalidCpmmAccount)?))
    } else {
        Ok(0)
    }
}
