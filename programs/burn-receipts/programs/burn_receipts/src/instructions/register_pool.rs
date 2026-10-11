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
    let locked = if lp_lock_vault.owner == &token::ID && lp_lock_vault.data_len() >= 72 {
        let d = lp_lock_vault.try_borrow_data()?;
        require!(d[..32] == pool.lp_mint.to_bytes()[..] && d[32..64] == LOCK_CPMM_AUTHORITY.to_bytes()[..], BurnError::InvalidCpmmAccount);
        u64::from_le_bytes(d[64..72].try_into().map_err(|_| BurnError::InvalidCpmmAccount)?)
    } else {
        0
    };
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
        }
        POOL_POLICY_FIXED => {
            require!(!c.pool_verified, BurnError::PoolAlreadyRegistered);
            require_keys_eq!(a.pool_state.key(), c.cpmm_pool, BurnError::WrongPoolPolicy);
            verify_pool_provenance(&a.pool_state.to_account_info(), &mint, &fee, &a.lp_mint, &a.lp_lock_vault.to_account_info(), None)?;
        }
        _ => return err!(BurnError::WrongPoolPolicy),
    }
    let pool_key = ctx.accounts.pool_state.key();
    let c = &mut ctx.accounts.config;
    c.cpmm_pool = pool_key;
    c.pool_verified = true;
    let config = c.key();
    emit_cpi!(PoolRegistered { config, pool: pool_key, registrar: ctx.accounts.registrar.key() });
    Ok(())
}
