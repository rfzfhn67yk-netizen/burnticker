//! Driving the real Raydium CPMM program in LiteSVM: an AmmConfig and a permission PDA created by the (test) admin, then a WSOL/token
//! pool created through `initialize_with_permission` with the token's fee PDA as pool creator — the shape a LaunchLab migration
//! produces — plus trader swaps to build up the oracle ring.
#![allow(dead_code)]

use super::*;
use anchor_lang::solana_program::program_pack::Pack;

pub const AUTH_SEED: &[u8] = b"vault_and_lp_mint_auth_seed";
const DISC_CREATE_AMM_CONFIG: [u8; 8] = [137, 52, 237, 212, 215, 117, 108, 104];
const DISC_CREATE_PERMISSION_PDA: [u8; 8] = [135, 136, 2, 216, 137, 169, 181, 202];
const DISC_INITIALIZE_WITH_PERMISSION: [u8; 8] = [63, 55, 254, 65, 49, 178, 89, 121];
const DISC_SWAP_BASE_INPUT: [u8; 8] = [143, 190, 90, 218, 196, 30, 51, 222];

pub const TRADE_FEE_RATE: u64 = 2_500; // 0.25 %
pub const CREATOR_FEE_RATE: u64 = 1_000; // 0.10 %

#[derive(Clone, Copy, Debug)]
pub struct Pool {
    pub amm_config: Pubkey,
    pub pool: Pubkey,
    pub authority: Pubkey,
    pub token_0_mint: Pubkey,
    pub token_1_mint: Pubkey,
    pub token_0_vault: Pubkey,
    pub token_1_vault: Pubkey,
    pub observation: Pubkey,
    pub lp_mint: Pubkey,
    pub wsol_is_0: bool,
}

impl Pool {
    pub fn wsol_vault(&self) -> Pubkey {
        if self.wsol_is_0 { self.token_0_vault } else { self.token_1_vault }
    }
    pub fn token_vault(&self) -> Pubkey {
        if self.wsol_is_0 { self.token_1_vault } else { self.token_0_vault }
    }
}

pub fn pda(seeds: &[&[u8]]) -> Pubkey {
    Pubkey::find_program_address(seeds, &CPMM_PROGRAM_ID).0
}

pub fn admin() -> Keypair {
    Keypair::new_from_array(CPMM_ADMIN_SEED)
}

/// AmmConfig index 0 + a permission PDA for `launcher` + the create-pool-fee receiver account (a WSOL token account at Raydium's
/// hard-coded address; create_pool_fee is 0 so nothing is sent to it).
/// An AmmConfig at `index`, created by the (test) CPMM admin.
pub fn create_amm_config(env: &mut Env, index: u16) -> Pubkey {
    let admin = admin();
    env.fund(&admin.pubkey(), SOL);
    let amm_config = pda(&[b"amm_config", &index.to_be_bytes()]);
    let mut data = DISC_CREATE_AMM_CONFIG.to_vec();
    data.extend_from_slice(&index.to_le_bytes());
    for v in [TRADE_FEE_RATE, 120_000u64, 40_000u64, 0u64, CREATOR_FEE_RATE] {
        data.extend_from_slice(&v.to_le_bytes());
    }
    let ix = Instruction {
        program_id: CPMM_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(admin.pubkey(), true),
            AccountMeta::new(amm_config, false),
            AccountMeta::new_readonly(anchor_lang::solana_program::system_program::ID, false),
        ],
        data,
    };
    env.ok(&[ix], &[&admin]);
    amm_config
}

pub fn setup_amm(env: &mut Env, launcher: &Pubkey) -> Pubkey {
    let admin = admin();
    env.fund(&admin.pubkey(), 10 * SOL);
    let amm_config = create_amm_config(env, 0);
    let _ = &amm_config;
    let permission = pda(&[b"permission", launcher.as_ref()]);
    let ix = Instruction {
        program_id: CPMM_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(admin.pubkey(), true),
            AccountMeta::new_readonly(*launcher, false),
            AccountMeta::new(permission, false),
            AccountMeta::new_readonly(anchor_lang::solana_program::system_program::ID, false),
        ],
        data: DISC_CREATE_PERMISSION_PDA.to_vec(),
    };
    env.ok(&[ix], &[&admin]);

    let mut acc = vec![0u8; spl_token::state::Account::LEN];
    spl_token::state::Account {
        mint: NATIVE_MINT,
        owner: admin.pubkey(),
        amount: 0,
        delegate: None.into(),
        state: spl_token::state::AccountState::Initialized,
        is_native: Some(2_039_280).into(),
        delegated_amount: 0,
        close_authority: None.into(),
    }
    .pack_into_slice(&mut acc);
    env.svm.set_account(CREATE_POOL_FEE_RECEIVER, litesvm_account(2_039_280, acc, spl_token::ID)).unwrap();
    amm_config
}

/// Creates the WSOL/`mint` pool with `creator` recorded as pool_creator (permissioned create, creator fee on), then LOCKS all of
/// the launcher's LP the way LaunchLab's migration leaves it (moved to Raydium's LP-lock account; review-2 F5).
pub fn create_pool(env: &mut Env, launcher: &Keypair, amm_config: &Pubkey, mint: &Pubkey, creator: &Pubkey, sol_amount: u64, token_amount: u64, token_src: &Pubkey) -> Pool {
    let p = create_pool_unlocked(env, launcher, amm_config, mint, creator, sol_amount, token_amount, token_src);
    let all = env.token_amount(&get_associated_token_address(&launcher.pubkey(), &p.lp_mint));
    lock_lp(env, launcher, &p, all);
    p
}

/// The CPMM LP mint PDA of a pool.
pub fn lp_mint_of(pool: &Pubkey) -> Pubkey {
    pda(&[b"pool_lp_mint", pool.as_ref()])
}

/// Moves `amount` of the launcher's LP into Raydium's LP-lock account (ATA of LOCK_CPMM_AUTHORITY) — the state the real lock
/// program (and LaunchLab's migration) leaves; the lock program itself is not needed to test the burn program's check.
pub fn lock_lp(env: &mut Env, launcher: &Keypair, p: &Pool, amount: u64) {
    let vault = env.create_ata(&LOCK_CPMM_AUTHORITY, &p.lp_mint);
    let src = get_associated_token_address(&launcher.pubkey(), &p.lp_mint);
    let ix = spl_token::instruction::transfer(&spl_token::ID, &src, &vault, &launcher.pubkey(), &[], amount).unwrap();
    env.ok(&[ix], &[launcher]);
}

/// Burns `amount` of the launcher's LP (SPL burn: the LP mint supply drops, CPMM's lp_supply does not).
pub fn burn_lp(env: &mut Env, launcher: &Keypair, p: &Pool, amount: u64) {
    let src = get_associated_token_address(&launcher.pubkey(), &p.lp_mint);
    let ix = spl_token::instruction::burn(&spl_token::ID, &src, &p.lp_mint, &launcher.pubkey(), &[], amount).unwrap();
    env.ok(&[ix], &[launcher]);
}

/// Writes the LaunchLab side of a migrated launch for `mint` (LaunchLab's source is closed; the accounts use the SDK's layouts,
/// pinned by fixtures/launchlab-accounts-sdk.json): the LaunchLab pool PDA ["pool", mint, WSOL] recording `creator` and
/// TEST_LAUNCHLAB_PLATFORM, migrate type CPMM; and that platform naming `cp_config` as its migration AmmConfig.
pub fn launchlab_state(env: &mut Env, mint: &Pubkey, creator: &Pubkey, cp_config: &Pubkey) {
    let mut pool = vec![0u8; 429];
    pool[LL_POOL_MIGRATE_TYPE] = LL_MIGRATE_TYPE_CPMM;
    pool[LL_POOL_PLATFORM_ID..LL_POOL_PLATFORM_ID + 32].copy_from_slice(TEST_LAUNCHLAB_PLATFORM.as_ref());
    pool[LL_POOL_MINT_A..LL_POOL_MINT_A + 32].copy_from_slice(mint.as_ref());
    pool[LL_POOL_MINT_B..LL_POOL_MINT_B + 32].copy_from_slice(NATIVE_MINT.as_ref());
    pool[LL_POOL_CREATOR..LL_POOL_CREATOR + 32].copy_from_slice(creator.as_ref());
    let lamports = env.svm.minimum_balance_for_rent_exemption(pool.len());
    env.svm.set_account(launchlab_pool_pda(mint), litesvm_account(lamports, pool, LAUNCHLAB_PROGRAM_ID)).unwrap();
    set_platform_cp_config(env, cp_config);
}

/// Points TEST_LAUNCHLAB_PLATFORM's cpConfigId at `cp_config` (what LaunchLab's updateCpConfigId does).
pub fn set_platform_cp_config(env: &mut Env, cp_config: &Pubkey) {
    set_platform(env, cp_config, &Pubkey::default(), [1_000_000, 0, 0]);
}

/// The test LaunchLab PlatformConfig (SDK layout): platformLockNftWallet (= FEE_KEYS), cpConfigId, platformCpCreator and the LP
/// lock/burn scales (platform, creator, burn; 10⁻⁶).
pub fn set_platform(env: &mut Env, cp_config: &Pubkey, cp_creator: &Pubkey, scales: [u64; 3]) {
    env.svm.set_account(TEST_LAUNCHLAB_PLATFORM, platform_account(env, cp_config, cp_creator, scales)).unwrap();
}

pub fn platform_account(env: &Env, cp_config: &Pubkey, cp_creator: &Pubkey, scales: [u64; 3]) -> solana_account::Account {
    let mut platform = vec![0u8; 944];
    // LAUNCHPAD-PATH §35: the platform's Fee Key wallet is burn_receipts' FEE_KEYS PDA.
    platform[LL_PLATFORM_LOCK_NFT_WALLET..LL_PLATFORM_LOCK_NFT_WALLET + 32].copy_from_slice(fee_keys_pda().as_ref());
    platform[LL_PLATFORM_CP_CONFIG_ID..LL_PLATFORM_CP_CONFIG_ID + 32].copy_from_slice(cp_config.as_ref());
    platform[LL_PLATFORM_CP_CREATOR..LL_PLATFORM_CP_CREATOR + 32].copy_from_slice(cp_creator.as_ref());
    for (i, v) in scales.iter().enumerate() {
        platform[LL_PLATFORM_SCALES + 8 * i..LL_PLATFORM_SCALES + 8 * i + 8].copy_from_slice(&v.to_le_bytes());
    }
    let lamports = env.svm.minimum_balance_for_rent_exemption(platform.len());
    litesvm_account(lamports, platform, LAUNCHLAB_PROGRAM_ID)
}

/// burn_receipts' FEE_KEYS PDA ["fee_keys"] (LAUNCHPAD-PATH §35).
pub fn fee_keys_pda() -> Pubkey {
    Pubkey::find_program_address(&[FEE_KEYS_SEED], &burn_receipts::ID).0
}

/// AmmConfig index 0's address (deterministic) — the test LaunchLab platform's cpConfigId.
pub fn amm_config_0() -> Pubkey {
    pda(&[b"amm_config", &0u16.to_be_bytes()])
}

/// LaunchLab migrated `mint` into `p` with the fee PDA as creator — and (RL-3) the migration's Fee Key is recorded: suites without
/// the lock program get a STAND-IN FeeKeyRecord for `p` written directly (what register_fee_key leaves; the real path — LaunchLab's
/// vault authority as locker, FEE_KEYS holding the NFT — runs in tests/lock_fees.rs and tests/review_lock.rs).
pub fn launchlab_migrated(env: &mut Env, mint: &Pubkey, p: &Pool) {
    launchlab_state(env, mint, &fee_pda(mint), &p.amm_config);
    standin_fee_key_record(env, mint, &p.pool, &p.lp_mint);
}

/// LaunchLab migrated `mint` into `p`, without any FeeKeyRecord (the lock suites run register_fee_key themselves).
pub fn launchlab_migrated_without_fee_key(env: &mut Env, mint: &Pubkey, p: &Pool) {
    launchlab_state(env, mint, &fee_pda(mint), &p.amm_config);
}

/// A FeeKeyRecord for (mint, pool) written straight into the account (test stand-in for register_fee_key).
pub fn standin_fee_key_record(env: &mut Env, mint: &Pubkey, pool: &Pubkey, lp_mint: &Pubkey) {
    use anchor_lang::{AccountSerialize, Space};
    let (key, bump) = Pubkey::find_program_address(&[FEE_KEY_SEED, mint.as_ref()], &burn_receipts::ID);
    let nft = Pubkey::new_unique();
    let rec = burn_receipts::state::FeeKeyRecord {
        version: 1,
        bump,
        mint: *mint,
        pool: *pool,
        lp_mint: *lp_mint,
        fee_nft_mint: nft,
        fee_nft_account: get_associated_token_address(&fee_keys_pda(), &nft),
        locked_liquidity: Pubkey::find_program_address(&[LOCKED_LIQUIDITY_SEED, nft.as_ref()], &LOCK_CPMM_PROGRAM_ID).0,
        locked_lp_at_registration: 1,
        registered_at: 0,
        claims: 0,
        total_wsol_claimed: 0,
        total_to_burn_pool: 0,
        total_to_operator: 0,
        total_tokens_burned: 0,
        last_claim_at: 0,
        operator_pending: 0,
        reserved: [0; 56],
    };
    let mut data = Vec::with_capacity(8 + burn_receipts::state::FeeKeyRecord::INIT_SPACE);
    rec.try_serialize(&mut data).unwrap();
    let lamports = env.svm.minimum_balance_for_rent_exemption(data.len());
    env.svm.set_account(key, litesvm_account(lamports, data, burn_receipts::ID)).unwrap();
}

/// create_pool without the LP lock (the launcher keeps every LP token).
#[allow(clippy::too_many_arguments)]
pub fn create_pool_unlocked(env: &mut Env, launcher: &Keypair, amm_config: &Pubkey, mint: &Pubkey, creator: &Pubkey, sol_amount: u64, token_amount: u64, token_src: &Pubkey) -> Pool {
    let wsol_src = env.wrap_sol(launcher, sol_amount);
    let (t0, t1, a0, a1, src0, src1, wsol_is_0) = if NATIVE_MINT < *mint {
        (NATIVE_MINT, *mint, sol_amount, token_amount, wsol_src, *token_src, true)
    } else {
        (*mint, NATIVE_MINT, token_amount, sol_amount, *token_src, wsol_src, false)
    };
    let pool = pda(&[b"pool", amm_config.as_ref(), t0.as_ref(), t1.as_ref()]);
    let authority = pda(&[AUTH_SEED]);
    let lp_mint = pda(&[b"pool_lp_mint", pool.as_ref()]);
    let v0 = pda(&[b"pool_vault", pool.as_ref(), t0.as_ref()]);
    let v1 = pda(&[b"pool_vault", pool.as_ref(), t1.as_ref()]);
    let observation = pda(&[b"observation", pool.as_ref()]);
    let permission = pda(&[b"permission", launcher.pubkey().as_ref()]);
    let lp_ata = get_associated_token_address(&launcher.pubkey(), &lp_mint);
    let mut data = DISC_INITIALIZE_WITH_PERMISSION.to_vec();
    data.extend_from_slice(&a0.to_le_bytes());
    data.extend_from_slice(&a1.to_le_bytes());
    data.extend_from_slice(&0u64.to_le_bytes()); // open_time: now + 1
    data.push(0); // CreatorFeeOn::BothToken
    let sys = anchor_lang::solana_program::system_program::ID;
    let ix = Instruction {
        program_id: CPMM_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(launcher.pubkey(), true),
            AccountMeta::new_readonly(*creator, false),
            AccountMeta::new_readonly(*amm_config, false),
            AccountMeta::new_readonly(authority, false),
            AccountMeta::new(pool, false),
            AccountMeta::new_readonly(t0, false),
            AccountMeta::new_readonly(t1, false),
            AccountMeta::new(lp_mint, false),
            AccountMeta::new(src0, false),
            AccountMeta::new(src1, false),
            AccountMeta::new(lp_ata, false),
            AccountMeta::new(v0, false),
            AccountMeta::new(v1, false),
            AccountMeta::new(CREATE_POOL_FEE_RECEIVER, false),
            AccountMeta::new(observation, false),
            AccountMeta::new_readonly(permission, false),
            AccountMeta::new_readonly(spl_token::ID, false),
            AccountMeta::new_readonly(spl_token::ID, false),
            AccountMeta::new_readonly(spl_token::ID, false),
            AccountMeta::new_readonly(anchor_spl::associated_token::ID, false),
            AccountMeta::new_readonly(sys, false),
        ],
        data,
    };
    env.ok(&[ix], &[launcher]);
    Pool { amm_config: *amm_config, pool, authority, token_0_mint: t0, token_1_mint: t1, token_0_vault: v0, token_1_vault: v1, observation, lp_mint, wsol_is_0 }
}

/// A trader swap (exact input). `buy` = WSOL → token.
pub fn swap(env: &mut Env, trader: &Keypair, p: &Pool, mint: &Pubkey, buy: bool, amount_in: u64) -> TxResult {
    let ix = ix_swap(&trader.pubkey(), p, mint, buy, amount_in);
    env.send(&[ix], &[trader])
}

/// The swap instruction alone (to place it in the same transaction as a crank — a sandwich's front leg).
pub fn ix_swap(trader: &Pubkey, p: &Pool, mint: &Pubkey, buy: bool, amount_in: u64) -> Instruction {
    ix_swap_raw(trader, p, mint, buy, amount_in)
}

fn ix_swap_raw(trader_key: &Pubkey, p: &Pool, mint: &Pubkey, buy: bool, amount_in: u64) -> Instruction {
    let trader_pk = *trader_key;
    let wsol_ata = get_associated_token_address(&trader_pk, &NATIVE_MINT);
    let tok_ata = get_associated_token_address(&trader_pk, mint);
    let (in_acc, out_acc, in_vault, out_vault, in_mint, out_mint) = if buy {
        (wsol_ata, tok_ata, p.wsol_vault(), p.token_vault(), NATIVE_MINT, *mint)
    } else {
        (tok_ata, wsol_ata, p.token_vault(), p.wsol_vault(), *mint, NATIVE_MINT)
    };
    let mut data = DISC_SWAP_BASE_INPUT.to_vec();
    data.extend_from_slice(&amount_in.to_le_bytes());
    data.extend_from_slice(&0u64.to_le_bytes());
    Instruction {
        program_id: CPMM_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new_readonly(trader_pk, true),
            AccountMeta::new_readonly(p.authority, false),
            AccountMeta::new_readonly(p.amm_config, false),
            AccountMeta::new(p.pool, false),
            AccountMeta::new(in_acc, false),
            AccountMeta::new(out_acc, false),
            AccountMeta::new(in_vault, false),
            AccountMeta::new(out_vault, false),
            AccountMeta::new_readonly(spl_token::ID, false),
            AccountMeta::new_readonly(spl_token::ID, false),
            AccountMeta::new_readonly(in_mint, false),
            AccountMeta::new_readonly(out_mint, false),
            AccountMeta::new(p.observation, false),
        ],
        data,
    }
}

pub fn ix_crank_buyback(cranker: &Pubkey, mint: &Pubkey, p: &Pool, date: u32) -> Instruction {
    ix_crank_buyback_paired(cranker, mint, p, date, None)
}

/// crank_buyback for a PAIRED coin (LAUNCHPAD-PATH §40): `partner` = the partner mint (the PairLink and the period's PairResult
/// are passed).
pub fn ix_crank_buyback_paired(cranker: &Pubkey, mint: &Pubkey, p: &Pool, date: u32, partner: Option<Pubkey>) -> Instruction {
    let config = config_pda(mint);
    let fee = fee_pda(mint);
    Instruction::new_with_bytes(
        burn_receipts::ID,
        &burn_receipts::instruction::CrankBuyback { record_date: date }.data(),
        burn_receipts::accounts::CrankBuyback {
            cranker: *cranker,
            config,
            reading: reading_pda(&config, date),
            platform: platform_pda(),
            mint: *mint,
            fee_vault: fee,
            fee_wsol: get_associated_token_address(&fee, &NATIVE_MINT),
            fee_tokens: get_associated_token_address(&fee, mint),
            wsol_mint: NATIVE_MINT,
            pool_state: p.pool,
            amm_config: p.amm_config,
            cpmm_authority: p.authority,
            wsol_vault: p.wsol_vault(),
            token_vault: p.token_vault(),
            observation_state: p.observation,
            pair_link: partner.map(|_| pair_link_pda(mint)),
            pair_result: partner.map(|q| pair_result_pda(mint, &q, date)),
            cpmm_program: CPMM_PROGRAM_ID,
            token_program: spl_token::ID,
            system_program: anchor_lang::solana_program::system_program::ID,
            memo_program: MEMO_PROGRAM_ID,
            event_authority: event_authority(),
            program: burn_receipts::ID,
        }
        .to_account_metas(None),
    )
}

/// crank_carried (burn dispersal): a piece of at most `max_spend` of the carried spend, without a reading.
pub fn ix_crank_carried(cranker: &Pubkey, mint: &Pubkey, p: &Pool, max_spend: u64) -> Instruction {
    let config = config_pda(mint);
    let fee = fee_pda(mint);
    Instruction::new_with_bytes(
        burn_receipts::ID,
        &burn_receipts::instruction::CrankCarried { max_spend_lamports: max_spend }.data(),
        burn_receipts::accounts::CrankCarried {
            cranker: *cranker,
            config,
            platform: platform_pda(),
            mint: *mint,
            fee_vault: fee,
            fee_wsol: get_associated_token_address(&fee, &NATIVE_MINT),
            fee_tokens: get_associated_token_address(&fee, mint),
            wsol_mint: NATIVE_MINT,
            pool_state: p.pool,
            amm_config: p.amm_config,
            cpmm_authority: p.authority,
            wsol_vault: p.wsol_vault(),
            token_vault: p.token_vault(),
            observation_state: p.observation,
            cpmm_program: CPMM_PROGRAM_ID,
            token_program: spl_token::ID,
            system_program: anchor_lang::solana_program::system_program::ID,
            memo_program: MEMO_PROGRAM_ID,
            carried_pace: carried_pace_pda(mint),
            event_authority: event_authority(),
            program: burn_receipts::ID,
        }
        .to_account_metas(None),
    )
}

/// Reserves net of the fees owed out of each vault (what the CPMM curve uses).
pub fn reserves(env: &Env, p: &Pool) -> (u64, u64) {
    let d = env.svm.get_account(&p.pool).unwrap().data;
    let u = |at: usize| u64::from_le_bytes(d[at..at + 8].try_into().unwrap());
    let fees0 = u(341) + u(357) + u(397);
    let fees1 = u(349) + u(365) + u(405);
    let v0 = env.token_amount(&p.token_0_vault) - fees0;
    let v1 = env.token_amount(&p.token_1_vault) - fees1;
    if p.wsol_is_0 { (v0, v1) } else { (v1, v0) }
}

/// Six trades 150 s apart (≈ 900 s of oracle history, more than the mandatory 600 s TWAP window), alternating buys of 0.5 SOL and
/// sells of about the same value (4.7M tokens at the 85 SOL / 800M launch price), so the price ends where it started. Returns the
/// trader.
pub fn seed_history(env: &mut Env, p: &Pool, mint: &Pubkey) -> Keypair {
    let trader = Keypair::new();
    env.fund(&trader.pubkey(), 10_000 * SOL);
    env.wrap_sol(&trader, 5_000 * SOL);
    let me = env.payer.insecure_clone();
    let tata = env.create_ata(&trader.pubkey(), mint);
    env.mint_to(mint, &me, &tata, 50_000_000 * TOKEN);
    let mut now = env.now();
    for i in 0..6 {
        now += 150;
        env.set_time(now);
        swap(env, &trader, p, mint, i % 2 == 0, if i % 2 == 0 { SOL / 2 } else { 4_700_000 * TOKEN }).unwrap();
    }
    trader
}

/// LaunchLab's vault authority PDA ["vault_auth_seed"] — the liquidity owner LaunchLab's migration locks the LP as (devnet $LOCKT's
/// LockedCpLiquidityState @128 = 5xqNaZXX…, the devnet program's PDA; the harness uses the mainnet LaunchLab id).
pub fn launchlab_vault_auth() -> Pubkey {
    Pubkey::find_program_address(&[LAUNCHLAB_VAULT_AUTH_SEED], &LAUNCHLAB_PROGRAM_ID).0
}

/// Rewrites LockedCpLiquidityState @128 (the locker / liquidity owner) of a lock position: a LiteSVM test cannot sign as LaunchLab's
/// vault authority PDA, so a migration is simulated by locking from a test wallet and then recording LaunchLab's PDA as the locker —
/// exactly the bytes the real migration leaves (lp-lock blind review I-3).
pub fn set_locker(env: &mut Env, locked_liquidity: &Pubkey, locker: &Pubkey) {
    let mut a = env.svm.get_account(locked_liquidity).expect("lock state");
    a.data[LL_LOCKED_LOCKER..LL_LOCKED_LOCKER + 32].copy_from_slice(locker.as_ref());
    env.svm.set_account(*locked_liquidity, a).unwrap();
}
