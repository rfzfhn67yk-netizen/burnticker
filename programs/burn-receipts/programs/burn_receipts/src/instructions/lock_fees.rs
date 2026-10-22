//! LAUNCHPAD-PATH §35 (owner decision 2026-10-10): graduation LP is LOCKED forever in Raydium's CPMM lock program ("Burn & Earn")
//! instead of burned; the position's Fee Key NFT is held by this program's FEE_KEYS PDA; the LP fees are collected permissionlessly
//! and split by compiled constants — the SOL side 80 % to the coin's burn pool (fee PDA) and 20 % to the operator treasury, the coin
//! side burned outright. No admin key and no config field can change the split or the treasury.
//!
//! Two instructions:
//!   * register_fee_key — once per mint: records which lock position (and Fee Key) belongs to the coin's registered pool.
//!   * claim_lock_fees  — CPIs the lock program's collect_cp_fees with the FEE_KEYS signature and splits what arrived.
//!
//! Both serve LaunchLab coins (the platform's platformLockNftWallet is FEE_KEYS, so the migration's Fee Key lands here) and pair
//! coins (pair_curve's lock_lp names FEE_KEYS as fee_nft_owner).

use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::solana_program::program::invoke_signed;
use anchor_lang::solana_program::program_pack::Pack;
use anchor_lang::system_program;
use anchor_spl::associated_token::{self, get_associated_token_address, AssociatedToken};
use anchor_spl::token::{self, spl_token, Mint, Token};

use crate::constants::*;
use crate::cpmm::{self, PoolView};
use crate::error::BurnError;
use crate::events::{FeeKeyRegistered, LockFeesClaimed};
use crate::guards::{require_fee_pda_intact, require_fee_token_account_intact};
use crate::instructions::crank_common::crankers_in_force;
use crate::memo;
use crate::state::{FeeKeyRecord, TokenConfig};

pub const TOKEN_2022_PROGRAM_ID: Pubkey = pubkey!("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

/// The lock program's LockedCpLiquidityState, read by offset (see constants.rs).
pub struct LockedLiquidityView {
    pub locked_lp: u64,
    pub pool: Pubkey,
    pub fee_nft_mint: Pubkey,
    /// The liquidity owner who locked (LaunchLab's vault authority for a migration, the pair's vault for lock_lp).
    pub locker: Pubkey,
    pub lp_mint: Pubkey,
}

impl LockedLiquidityView {
    /// Owner = the lock program, the Anchor discriminator, the length and the PDA ["locked_liquidity", fee_nft_mint].
    pub fn load(acc: &AccountInfo, fee_nft_mint: &Pubkey) -> Result<Self> {
        require_keys_eq!(*acc.owner, LOCK_CPMM_PROGRAM_ID, BurnError::InvalidLockAccount);
        let (pda, _) = Pubkey::find_program_address(&[LOCKED_LIQUIDITY_SEED, fee_nft_mint.as_ref()], &LOCK_CPMM_PROGRAM_ID);
        require_keys_eq!(*acc.key, pda, BurnError::InvalidLockAccount);
        let d = acc.try_borrow_data()?;
        require!(d.len() >= LOCKED_LIQUIDITY_MIN_LEN && d[..8] == LOCKED_LIQUIDITY_DISCRIMINATOR, BurnError::InvalidLockAccount);
        let pk = |o: usize| Pubkey::new_from_array(d[o..o + 32].try_into().expect("32 bytes"));
        let v = LockedLiquidityView {
            locked_lp: u64::from_le_bytes(d[LL_LOCKED_LP_AMOUNT..LL_LOCKED_LP_AMOUNT + 8].try_into().expect("8 bytes")),
            pool: pk(LL_LOCKED_POOL),
            fee_nft_mint: pk(LL_LOCKED_FEE_NFT_MINT),
            locker: pk(LL_LOCKED_LOCKER),
            lp_mint: pk(LL_LOCKED_LP_MINT),
        };
        require_keys_eq!(v.fee_nft_mint, *fee_nft_mint, BurnError::InvalidLockAccount);
        Ok(v)
    }
}

/// The Fee Key account: FEE_KEYS's associated token account for the NFT mint, holding exactly 1, no delegate, no close authority.
fn require_fee_key_held(acc: &AccountInfo, fee_keys: &Pubkey, nft_mint: &Pubkey) -> Result<()> {
    require_keys_eq!(*acc.key, get_associated_token_address(fee_keys, nft_mint), BurnError::FeeKeyNotHeld);
    require_keys_eq!(*acc.owner, spl_token::ID, BurnError::FeeKeyNotHeld);
    let t = spl_token::state::Account::unpack(&acc.try_borrow_data()?).map_err(|_| BurnError::FeeKeyNotHeld)?;
    require!(t.owner == *fee_keys && t.mint == *nft_mint && t.amount == 1, BurnError::FeeKeyNotHeld);
    require!(t.delegate.is_none() && t.close_authority.is_none() && t.state == spl_token::state::AccountState::Initialized, BurnError::FeeKeyNotHeld);
    Ok(())
}

fn token_amount(acc: &AccountInfo) -> Result<u64> {
    Ok(spl_token::state::Account::unpack(&acc.try_borrow_data()?).map_err(|_| BurnError::FeeAccountTampered)?.amount)
}

/// PERMISSIONLESS, ONCE per mint. Records the coin's lock position: the lock program's LockedCpLiquidityState for the coin's pool
/// whose Fee Key NFT FEE_KEYS holds. lp-lock blind review RL-2: the position is identified by WHO LOCKED it (LockedCpLiquidityState
/// @128, the liquidity owner), not by a majority of the pool's live LP supply (an unlocked deposit could dilute that and block the
/// coin, the blind-3 M-2 class):
///   * policy 0 (LaunchLab): the pool is the token's migration pool — the PDA of the pinned cpConfigId and the two mints, with the
///     fee PDA as pool_creator — and the locker is LaunchLab's vault authority PDA ["vault_auth_seed"]. This runs BEFORE register_pool
///     (which requires the record: RL-3), or on an already registered pool that is that same migration pool;
///   * policy 2 (pair): the registered, verified pair pool, locker = its pool_creator (the pair's SOL vault, checked by
///     register_pair_pool);
///   * policy 1 (fixed pool): the registered, verified pool; no locker is known.
/// Sanity floor for all: the position holds a strict majority of ALL LP in Raydium's lock account for the LP mint (deposits cannot
/// move that), and the Fee Key NFT is a 0-decimal, supply-1 mint with no mint and no freeze authority (I-6).
#[event_cpi]
#[derive(Accounts)]
pub struct RegisterFeeKey<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED, config.mint.as_ref()], bump = config.bump)]
    pub config: Box<Account<'info, TokenConfig>>,
    #[account(init, payer = payer, space = 8 + FeeKeyRecord::INIT_SPACE, seeds = [FEE_KEY_SEED, config.mint.as_ref()], bump)]
    pub fee_key: Box<Account<'info, FeeKeyRecord>>,
    /// CHECK: the FEE_KEYS PDA (seeds-checked); data-less.
    #[account(seeds = [FEE_KEYS_SEED], bump)]
    pub fee_keys: UncheckedAccount<'info>,
    /// CHECK: the coin's pool (policy 0: the migration pool PDA; policies 1/2: config.cpmm_pool) — checked in the handler.
    pub pool_state: UncheckedAccount<'info>,
    pub fee_nft_mint: Box<Account<'info, Mint>>,
    /// CHECK: FEE_KEYS's ATA for the NFT mint holding 1 (checked in the handler).
    pub fee_nft_account: UncheckedAccount<'info>,
    /// CHECK: the lock program's LockedCpLiquidityState (owner, discriminator, PDA, pool, LP mint, locker checked in the handler).
    pub locked_liquidity: UncheckedAccount<'info>,
    /// CHECK: Raydium's lock account for the pool's LP mint, ATA(LOCK_CPMM_AUTHORITY, lp_mint) (address-checked in the handler).
    pub lp_lock_vault: UncheckedAccount<'info>,
    /// Policy 0: the token's LaunchLab pool ["pool", mint, WSOL]. Required when the pool's AmmConfig differs from the pinned one: the
    /// Fee Key is then accepted only once LaunchLab reads migrated (eighth-pass CH8-4 gap 1, as register_pool). May be omitted otherwise.
    /// CHECK: PDA and owner checked by LaunchLabPoolView::load in the handler.
    pub launchlab_pool: Option<UncheckedAccount<'info>>,
    pub system_program: Program<'info, System>,
}

pub fn handle_register_fee_key(ctx: Context<RegisterFeeKey>) -> Result<()> {
    let a = &ctx.accounts;
    let c = &a.config;
    require!(c.rule.mode == MODE_BUYBACK, BurnError::WrongMode);
    let pool_key = a.pool_state.key();
    let pool = PoolView::load(&a.pool_state.to_account_info())?;
    let mint = c.mint;
    let nft_mint = a.fee_nft_mint.key();
    // I-6: a real Fee Key — one indivisible token whose mint can never mint again or freeze it.
    require!(a.fee_nft_mint.decimals == 0 && a.fee_nft_mint.supply == 1, BurnError::FeeKeyNotHeld);
    require!(a.fee_nft_mint.mint_authority.is_none() && a.fee_nft_mint.freeze_authority.is_none(), BurnError::FeeKeyNotHeld);
    require_fee_key_held(&a.fee_nft_account.to_account_info(), &a.fee_keys.key(), &nft_mint)?;
    let lock = LockedLiquidityView::load(&a.locked_liquidity.to_account_info(), &nft_mint)?;
    require_keys_eq!(lock.pool, pool_key, BurnError::InvalidLockAccount);
    require_keys_eq!(lock.lp_mint, pool.lp_mint, BurnError::InvalidLockAccount);
    match c.registration_policy {
        POOL_POLICY_CREATOR_IS_FEE_PDA => {
            // The migration pool: the pool PDA of its own AmmConfig for WSOL / mint (a CPMM-owned account at that PDA proves CPMM
            // created it under that genuine AmmConfig), created with the fee PDA as pool_creator, its LP locked by LaunchLab's vault
            // authority (checked below: only LaunchLab's migrate_to_cpswap locks as that PDA). B-17 / HB-167: the AmmConfig may differ
            // from the one pinned at initialize_token — LaunchLab migrates under the platform's cpConfigId at migration time.
            require!(c.ll_cp_config != Pubkey::default(), BurnError::PoolNotRegistered);
            require_keys_eq!(pool_key, cpmm::pool_pda(&pool.amm_config, &NATIVE_MINT, &mint), BurnError::NotMigrationPool);
            require!(pool.wsol_is_token_0(&NATIVE_MINT, &mint).is_some(), BurnError::InvalidPoolMints);
            let (fee_pda, _) = Pubkey::find_program_address(&[FEE_SEED, mint.as_ref()], &crate::ID);
            require_keys_eq!(pool.pool_creator, fee_pda, BurnError::PoolCreatorMismatch);
            if c.cpmm_pool != Pubkey::default() {
                require_keys_eq!(c.cpmm_pool, pool_key, BurnError::FeeKeyMismatch);
            }
            if pool.amm_config != c.ll_cp_config {
                // Eighth-pass CH8-4 gap 1 (defence in depth): a pool on another AmmConfig than the pin is accepted only once LaunchLab
                // reads this coin migrated (status 2 at byte 17 of its LaunchLab-owned pool PDA, which only LaunchLab writes), its
                // migration was to CPMM, its creator is the fee PDA and its platform the pinned one — the same checks register_pool makes.
                let Some(ll_pool) = a.launchlab_pool.as_ref() else {
                    return err!(BurnError::LaunchLabAccountsRequired);
                };
                let lp = cpmm::LaunchLabPoolView::load(&ll_pool.to_account_info(), &mint)?;
                require!(lp.mint_a == mint && lp.mint_b == NATIVE_MINT, BurnError::InvalidLaunchLabAccount);
                require!(lp.migrate_type == LL_MIGRATE_TYPE_CPMM, BurnError::NotMigrationPool);
                require_keys_eq!(lp.creator, fee_pda, BurnError::PoolCreatorMismatch);
                require_keys_eq!(lp.platform_id, c.ll_platform, BurnError::InvalidLaunchLabAccount);
                require!(lp.status == LL_POOL_STATUS_MIGRATED, BurnError::NotMigrationPool);
            }
            let (vault_auth, _) = Pubkey::find_program_address(&[LAUNCHLAB_VAULT_AUTH_SEED], &LAUNCHLAB_PROGRAM_ID);
            require_keys_eq!(lock.locker, vault_auth, BurnError::LockerMismatch);
        }
        POOL_POLICY_PAIR_CURVE => {
            require!(c.own_pool_verified() && c.cpmm_pool == pool_key, BurnError::PoolNotVerified);
            require_keys_eq!(lock.locker, pool.pool_creator, BurnError::LockerMismatch);
        }
        POOL_POLICY_FIXED => {
            require!(c.own_pool_verified() && c.cpmm_pool == pool_key, BurnError::PoolNotVerified);
        }
        _ => return err!(BurnError::WrongPoolPolicy),
    }
    // Sanity floor (RL-2 b): a strict majority of all LP in Raydium's lock account — an unlocked deposit cannot dilute it.
    let lock_vault = a.lp_lock_vault.to_account_info();
    require_keys_eq!(*lock_vault.key, get_associated_token_address(&LOCK_CPMM_AUTHORITY, &pool.lp_mint), BurnError::InvalidCpmmAccount);
    let in_lock = crate::instructions::register_pool::lock_vault_amount(&lock_vault, &pool.lp_mint)?;
    require!((lock.locked_lp as u128) * BPS_DENOMINATOR > FEE_KEY_MIN_LOCKED_LP_BPS * in_lock as u128, BurnError::LockNotMajority);

    let registrar = a.payer.key();
    let (fee_nft_account, locked_liquidity) = (a.fee_nft_account.key(), a.locked_liquidity.key());
    let r = &mut ctx.accounts.fee_key;
    r.version = 1;
    r.bump = ctx.bumps.fee_key;
    r.mint = mint;
    r.pool = pool_key;
    r.lp_mint = pool.lp_mint;
    r.fee_nft_mint = nft_mint;
    r.fee_nft_account = fee_nft_account;
    r.locked_liquidity = locked_liquidity;
    r.locked_lp_at_registration = lock.locked_lp;
    r.registered_at = Clock::get()?.unix_timestamp;
    emit_cpi!(FeeKeyRegistered { mint, pool: pool_key, fee_nft_mint: nft_mint, fee_nft_account, locked_liquidity, locked_lp: lock.locked_lp, registrar });
    Ok(())
}

/// PERMISSIONLESS (the cranker allowlist of crank_buyback applies while the pre-audit cap is in force). collect_cp_fees on the coin's
/// RECORDED lock position (lp-lock blind review L-1: against fee_key.pool, which the lock state pins forever — not config.cpmm_pool,
/// which replace_pool / apply_registration_policy can move), always for everything accrued (L-3: lp_fee_amount = u64::MAX, no caller
/// choice), signed by FEE_KEYS, into FEE_KEYS's own WSOL and token accounts; then, in this instruction:
///   * the coin side (the whole token account) is burned;
///   * the WSOL account is closed into FEE_KEYS and the claimed SOL is split: operator = floor(claimed · 2000 / 10000) to the compiled
///     OPERATOR_TREASURY, the rest (≥ 80 %) to the coin's fee PDA; the account's rent goes back to the cranker only when this
///     instruction created the account (I-5: a pre-existing account's rent, and any lamports someone else had put there, go to the
///     fee PDA); the same for the coin account's rent;
///   * a memo (receipt line, v2 with paid/pending) and LockFeesClaimed — only when SOL was claimed or operator_pending was delivered
///     (I-5: a coin-token donation alone is burned and counted in total_tokens_burned, without a memo or a claim).
/// No minimum-out on the LP withdrawal (I-4, accepted): a sandwich can shift a claim's WSOL/coin mix toward the burned coin side, at the
/// sandwicher's cost; nothing is extracted.
/// The operator share waits in the FeeKeyRecord account while the treasury cannot receive it (below its rent-exempt minimum) and is
/// paid with the next claim that can deliver it. Only the claimed delta is split; nothing accrued (and nothing pending to pay) is a
/// no-op (no transfer, no memo, counters unchanged). After the CPI the program
/// checks that FEE_KEYS still holds the Fee Key and that its accounts kept owner, mint, no delegate and no close authority (the lock
/// program is an external upgradeable program holding FEE_KEYS's signature for the call).
#[event_cpi]
#[derive(Accounts)]
pub struct ClaimLockFees<'info> {
    #[account(mut)]
    pub cranker: Signer<'info>,
    /// CHECK: the platform PDA (seeds-checked) — its cranker allowlist, as for crank_buyback.
    #[account(seeds = [PLATFORM_SEED], bump)]
    pub platform: UncheckedAccount<'info>,
    #[account(seeds = [CONFIG_SEED, config.mint.as_ref()], bump = config.bump)]
    pub config: Box<Account<'info, TokenConfig>>,
    #[account(mut, seeds = [FEE_KEY_SEED, config.mint.as_ref()], bump = fee_key.bump)]
    pub fee_key: Box<Account<'info, FeeKeyRecord>>,
    /// CHECK: the FEE_KEYS PDA (seeds-checked); System-owned and data-less, or not yet existing.
    #[account(mut, seeds = [FEE_KEYS_SEED], bump)]
    pub fee_keys: UncheckedAccount<'info>,
    #[account(mut, seeds = [FEE_SEED, config.mint.as_ref()], bump = config.fee_bump)]
    pub fee_vault: SystemAccount<'info>,
    /// CHECK: the compiled operator treasury (address-checked).
    #[account(mut, address = OPERATOR_TREASURY @ BurnError::TreasuryNotPinned)]
    pub operator_treasury: UncheckedAccount<'info>,
    #[account(mut, address = config.mint)]
    pub mint: Box<Account<'info, Mint>>,
    #[account(address = NATIVE_MINT)]
    pub wsol_mint: Box<Account<'info, Mint>>,
    /// CHECK: ATA(FEE_KEYS, WSOL) — address-checked; created idempotently, closed at the end.
    #[account(mut, address = get_associated_token_address(&fee_keys.key(), &NATIVE_MINT) @ BurnError::FeeAccountTampered)]
    pub fee_keys_wsol: UncheckedAccount<'info>,
    /// CHECK: ATA(FEE_KEYS, mint) — address-checked; created idempotently, emptied by the burn and closed at the end.
    #[account(mut, address = get_associated_token_address(&fee_keys.key(), &config.mint) @ BurnError::FeeAccountTampered)]
    pub fee_keys_token: UncheckedAccount<'info>,
    /// CHECK: the recorded Fee Key account (address = fee_key.fee_nft_account); holding checked before and after the CPI.
    #[account(mut, address = fee_key.fee_nft_account @ BurnError::FeeKeyMismatch)]
    pub fee_nft_account: UncheckedAccount<'info>,
    /// CHECK: the recorded lock position (address = fee_key.locked_liquidity).
    #[account(mut, address = fee_key.locked_liquidity @ BurnError::FeeKeyMismatch)]
    pub locked_liquidity: UncheckedAccount<'info>,
    /// CHECK: address-checked: Raydium's CPMM lock program.
    #[account(address = LOCK_CPMM_PROGRAM_ID)]
    pub lock_program: UncheckedAccount<'info>,
    /// CHECK: address-checked: the lock program's authority PDA.
    #[account(address = LOCK_CPMM_AUTHORITY)]
    pub lock_authority: UncheckedAccount<'info>,
    /// CHECK: address-checked: the Raydium CPMM program.
    #[account(address = CPMM_PROGRAM_ID)]
    pub cpmm_program: UncheckedAccount<'info>,
    /// CHECK: Raydium's vault-and-LP authority PDA; CPMM verifies its seeds.
    pub cpmm_authority: UncheckedAccount<'info>,
    /// CHECK: the recorded position's pool (address = fee_key.pool); parsed by cpmm::PoolView.
    #[account(mut, address = fee_key.pool @ BurnError::FeeKeyMismatch)]
    pub pool_state: UncheckedAccount<'info>,
    /// CHECK: the pool's LP mint (key-checked against the pool).
    #[account(mut)]
    pub lp_mint: UncheckedAccount<'info>,
    /// CHECK: the pool's token 0 vault (key-checked against the pool).
    #[account(mut)]
    pub token_0_vault: UncheckedAccount<'info>,
    /// CHECK: the pool's token 1 vault (key-checked against the pool).
    #[account(mut)]
    pub token_1_vault: UncheckedAccount<'info>,
    /// CHECK: ATA(LOCK_CPMM_AUTHORITY, lp_mint) — address-checked; the lock program moves LP out of it.
    #[account(mut)]
    pub lock_lp_vault: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    /// CHECK: address-checked: SPL Token-2022 (the lock program's account list carries it).
    #[account(address = TOKEN_2022_PROGRAM_ID)]
    pub token_2022_program: UncheckedAccount<'info>,
    /// CHECK: address-checked: the SPL Memo program.
    #[account(address = MEMO_PROGRAM_ID)]
    pub memo_program: UncheckedAccount<'info>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handle_claim_lock_fees(ctx: Context<ClaimLockFees>) -> Result<()> {
    require!(OPERATOR_TREASURY != Pubkey::default(), BurnError::TreasuryNotPinned);
    let now = Clock::get()?.unix_timestamp;
    let a = &ctx.accounts;
    let crankers = crankers_in_force(&a.platform.to_account_info(), now)?;
    require!(crankers.is_empty() || crankers.contains(&a.cranker.key()), BurnError::CrankerNotAllowed);
    let c = &a.config;
    require!(c.rule.mode == MODE_BUYBACK, BurnError::WrongMode);
    // L-1: no pool_verified / config.cpmm_pool check — the record was verified at register_fee_key and its pool is immutable in the
    // lock state; a later pool replacement must not strand the position's fees (they still go 80 % burn pool / 20 % treasury).
    let r = &a.fee_key;
    let mint_key = c.mint;
    let pool = PoolView::load(&a.pool_state.to_account_info())?;
    let wsol0 = pool.wsol_is_token_0(&NATIVE_MINT, &mint_key).ok_or(BurnError::InvalidPoolMints)?;
    require_keys_eq!(a.token_0_vault.key(), pool.token_0_vault, BurnError::InvalidCpmmAccount);
    require_keys_eq!(a.token_1_vault.key(), pool.token_1_vault, BurnError::InvalidCpmmAccount);
    require_keys_eq!(a.lp_mint.key(), pool.lp_mint, BurnError::InvalidCpmmAccount);
    require_keys_eq!(pool.lp_mint, r.lp_mint, BurnError::FeeKeyMismatch);
    require_keys_eq!(a.lock_lp_vault.key(), get_associated_token_address(&LOCK_CPMM_AUTHORITY, &pool.lp_mint), BurnError::InvalidCpmmAccount);
    let fee_keys_key = a.fee_keys.key();
    require_fee_key_held(&a.fee_nft_account.to_account_info(), &fee_keys_key, &r.fee_nft_mint)?;
    LockedLiquidityView::load(&a.locked_liquidity.to_account_info(), &r.fee_nft_mint)?;

    let fee_keys_seeds: &[&[u8]] = &[FEE_KEYS_SEED, &[ctx.bumps.fee_keys]];
    let fee_keys = a.fee_keys.to_account_info();
    let (wsol_acc, tok_acc) = (a.fee_keys_wsol.to_account_info(), a.fee_keys_token.to_account_info());
    // I-5: whose rent is it — the cranker's only if this instruction creates the account.
    let (wsol_created, tok_created) = (wsol_acc.lamports() == 0, tok_acc.lamports() == 0);
    for (acc, m) in [(&wsol_acc, a.wsol_mint.to_account_info()), (&tok_acc, a.mint.to_account_info())] {
        associated_token::create_idempotent(CpiContext::new(
            associated_token::ID,
            associated_token::Create {
                payer: a.cranker.to_account_info(),
                associated_token: acc.clone(),
                authority: fee_keys.clone(),
                mint: m,
                system_program: a.system_program.to_account_info(),
                token_program: a.token_program.to_account_info(),
            },
        ))?;
    }
    require_fee_token_account_intact(&wsol_acc, &fee_keys_key, &NATIVE_MINT, false)?;
    require_fee_token_account_intact(&tok_acc, &fee_keys_key, &mint_key, false)?;
    // Lamports sent to the WSOL account without SyncNative are synced first, so they are counted as a donation, not as claimed fees.
    token::sync_native(CpiContext::new(token::ID, token::SyncNative { account: wsol_acc.clone() }))?;
    let wsol_before = token_amount(&wsol_acc)?;
    let fee_keys_lamports_before = fee_keys.lamports();

    // collect_cp_fees, accounts in the lock program's order (SDK collectCpFeeInstruction), signed by FEE_KEYS.
    let (r0, r1) = if wsol0 { (&wsol_acc, &tok_acc) } else { (&tok_acc, &wsol_acc) };
    let (m0, m1) = (pool.token_0_mint, pool.token_1_mint);
    let mut data = LOCK_COLLECT_CP_FEES_DISCRIMINATOR.to_vec();
    data.extend_from_slice(&u64::MAX.to_le_bytes()); // L-3: always everything accrued
    let metas = vec![
        AccountMeta::new_readonly(LOCK_CPMM_AUTHORITY, false),
        AccountMeta::new_readonly(fee_keys_key, true),
        AccountMeta::new(a.fee_nft_account.key(), false),
        AccountMeta::new(a.locked_liquidity.key(), false),
        AccountMeta::new_readonly(CPMM_PROGRAM_ID, false),
        AccountMeta::new_readonly(a.cpmm_authority.key(), false),
        AccountMeta::new(a.pool_state.key(), false),
        AccountMeta::new(a.lp_mint.key(), false),
        AccountMeta::new(r0.key(), false),
        AccountMeta::new(r1.key(), false),
        AccountMeta::new(a.token_0_vault.key(), false),
        AccountMeta::new(a.token_1_vault.key(), false),
        AccountMeta::new_readonly(m0, false),
        AccountMeta::new_readonly(m1, false),
        AccountMeta::new(a.lock_lp_vault.key(), false),
        AccountMeta::new_readonly(token::ID, false),
        AccountMeta::new_readonly(TOKEN_2022_PROGRAM_ID, false),
        AccountMeta::new_readonly(MEMO_PROGRAM_ID, false),
    ];
    let (mint0, mint1) = if wsol0 { (a.wsol_mint.to_account_info(), a.mint.to_account_info()) } else { (a.mint.to_account_info(), a.wsol_mint.to_account_info()) };
    let infos = [
        a.lock_authority.to_account_info(),
        fee_keys.clone(),
        a.fee_nft_account.to_account_info(),
        a.locked_liquidity.to_account_info(),
        a.cpmm_program.to_account_info(),
        a.cpmm_authority.to_account_info(),
        a.pool_state.to_account_info(),
        a.lp_mint.to_account_info(),
        r0.clone(),
        r1.clone(),
        a.token_0_vault.to_account_info(),
        a.token_1_vault.to_account_info(),
        mint0,
        mint1,
        a.lock_lp_vault.to_account_info(),
        a.token_program.to_account_info(),
        a.token_2022_program.to_account_info(),
        a.memo_program.to_account_info(),
        a.lock_program.to_account_info(),
    ];
    invoke_signed(&Instruction { program_id: LOCK_CPMM_PROGRAM_ID, accounts: metas, data }, &infos, &[fee_keys_seeds])?;

    // ---- post-CPI: FEE_KEYS and its accounts untouched except for the incoming fees ----
    require_fee_pda_intact(&fee_keys, fee_keys_lamports_before)?;
    require_fee_key_held(&a.fee_nft_account.to_account_info(), &fee_keys_key, &r.fee_nft_mint)?;
    require_fee_token_account_intact(&wsol_acc, &fee_keys_key, &NATIVE_MINT, false)?;
    require_fee_token_account_intact(&tok_acc, &fee_keys_key, &mint_key, false)?;
    let wsol_after = token_amount(&wsol_acc)?;
    let claimed = wsol_after.checked_sub(wsol_before).ok_or(BurnError::FeeAccountTampered)?;
    let tokens = token_amount(&tok_acc)?;

    // The coin side: every token in FEE_KEYS's account is burned, then the account is closed (rent back to the cranker).
    if tokens > 0 {
        token::burn(CpiContext::new_with_signer(token::ID, token::Burn { mint: a.mint.to_account_info(), from: tok_acc.clone(), authority: fee_keys.clone() }, &[fee_keys_seeds]), tokens)?;
    }
    token::close_account(CpiContext::new_with_signer(
        token::ID,
        token::CloseAccount {
            account: tok_acc.clone(),
            destination: if tok_created { a.cranker.to_account_info() } else { a.fee_vault.to_account_info() },
            authority: fee_keys.clone(),
        },
        &[fee_keys_seeds],
    ))?;
    // The SOL side: close the WSOL account into FEE_KEYS, then pay out exactly what arrived.
    let before_close = fee_keys.lamports();
    token::close_account(CpiContext::new_with_signer(
        token::ID,
        token::CloseAccount { account: wsol_acc.clone(), destination: fee_keys.clone(), authority: fee_keys.clone() },
        &[fee_keys_seeds],
    ))?;
    let released = fee_keys.lamports().checked_sub(before_close).ok_or(BurnError::MathOverflow)?;
    let (to_operator, to_burn_pool) = split_lock_fees(claimed);
    let extra = released.checked_sub(claimed).ok_or(BurnError::MathOverflow)?;
    let rent_back = if wsol_created { extra.min(Rent::get()?.minimum_balance(spl_token::state::Account::LEN)) } else { 0 };
    let to_fee_vault = to_burn_pool + (extra - rent_back);
    // The operator share is parked in the FeeKeyRecord account (program-owned) and paid to the treasury from there as soon as the
    // treasury can receive it: a treasury holding less than its rent-exempt minimum (an unfunded Squads vault) cannot be credited a
    // small amount without failing the whole claim — and with it the burn pool's 80 %.
    let record_info = a.fee_key.to_account_info();
    for (to, amount) in [(a.fee_vault.to_account_info(), to_fee_vault), (record_info.clone(), to_operator), (a.cranker.to_account_info(), rent_back)] {
        if amount > 0 {
            system_program::transfer(CpiContext::new_with_signer(system_program::ID, system_program::Transfer { from: fee_keys.clone(), to }, &[fee_keys_seeds]), amount)?;
        }
    }
    require!(fee_keys.lamports() == before_close, BurnError::FeeAccountTampered);
    let pending = a.fee_key.operator_pending().saturating_add(to_operator);
    let treasury = a.operator_treasury.to_account_info();
    let rent = Rent::get()?;
    let treasury_after = treasury.lamports().checked_add(pending).ok_or(BurnError::MathOverflow)?;
    let operator_paid = if pending > 0 && treasury_after >= rent.minimum_balance(treasury.data_len()) {
        **record_info.try_borrow_mut_lamports()? -= pending;
        **treasury.try_borrow_mut_lamports()? += pending;
        pending
    } else {
        0
    };
    let new_pending = pending - operator_paid;

    if claimed == 0 && operator_paid == 0 {
        // Nothing accrued and nothing delivered: no receipt, no claim. Donated coin tokens (if any) were burned above.
        if tokens > 0 {
            let r = &mut ctx.accounts.fee_key;
            r.total_tokens_burned = r.total_tokens_burned.saturating_add(tokens);
        }
        return Ok(());
    }
    let memo_text = memo::format_lock_fees(c.memo_prefix_str(), claimed, to_burn_pool, to_operator, operator_paid, new_pending, tokens, &r.fee_nft_mint);
    memo::emit_memo(&a.memo_program.to_account_info(), &memo_text)?;
    let (pool_key, nft_mint, cranker) = (r.pool, r.fee_nft_mint, a.cranker.key());
    let r = &mut ctx.accounts.fee_key;
    r.set_operator_pending(new_pending);
    r.claims = r.claims.saturating_add(1);
    r.total_wsol_claimed = r.total_wsol_claimed.saturating_add(claimed);
    r.total_to_burn_pool = r.total_to_burn_pool.saturating_add(to_burn_pool);
    r.total_to_operator = r.total_to_operator.saturating_add(to_operator);
    r.total_tokens_burned = r.total_tokens_burned.saturating_add(tokens);
    r.last_claim_at = now;
    let operator_pending = new_pending;
    emit_cpi!(LockFeesClaimed { mint: mint_key, pool: pool_key, fee_nft_mint: nft_mint, cranker, wsol_claimed: claimed, to_burn_pool, to_operator, tokens_burned: tokens, operator_paid, operator_pending });
    Ok(())
}

/// (operator, burn pool) shares of a claim: operator = floor(x · LOCK_FEE_OPERATOR_BPS / 10000), burn pool = the rest.
pub fn split_lock_fees(x: u64) -> (u64, u64) {
    let operator = ((x as u128) * LOCK_FEE_OPERATOR_BPS as u128 / BPS_DENOMINATOR) as u64;
    (operator, x - operator)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_split_is_80_20_and_rounds_toward_the_burn() {
        assert_eq!(LOCK_FEE_BURN_BPS + LOCK_FEE_OPERATOR_BPS, 10_000);
        assert_eq!((LOCK_FEE_BURN_BPS, LOCK_FEE_OPERATOR_BPS), (8_000, 2_000));
        assert_eq!(split_lock_fees(1_000_000), (200_000, 800_000));
        assert_eq!(split_lock_fees(4), (0, 4));
        assert_eq!(split_lock_fees(5), (1, 4));
        assert_eq!(split_lock_fees(0), (0, 0));
        for x in [1u64, 7, 99, 12_345, u64::MAX] {
            let (o, b) = split_lock_fees(x);
            assert_eq!(o + b, x);
            assert!((b as u128) * 10_000 >= (x as u128) * 8_000);
        }
    }
}
