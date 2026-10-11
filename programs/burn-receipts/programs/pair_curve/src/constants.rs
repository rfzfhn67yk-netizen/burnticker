use anchor_lang::prelude::*;

/// PDA seeds (all under pair_curve).
/// The Pair: ["pair", mint_a, mint_b] — one per pair, ever (its mints lose their mint authority at init).
pub const PAIR_SEED: &[u8] = b"pair";
/// The SOL vault: ["vault", pair] — a System-owned account without data. Holds every lamport the curves raised; owns both token
/// vaults; is the mints' authority until init_pair revokes it; is the CPMM `creator` at graduation.
pub const VAULT_SEED: &[u8] = b"vault";
/// The graduated CPMM pool accounts: ["pool", pair, [side]] — pair_curve PDAs that CPMM's `initialize` accepts as a signing
/// ("random account") pool address. Only pair_curve can sign for them, so nobody can squat the address graduation needs.
pub const POOL_SEED: &[u8] = b"pool";

pub const SIDE_A: u8 = 0;
pub const SIDE_B: u8 = 1;

pub const STATUS_OPEN: u8 = 0;
pub const STATUS_GRADUATED: u8 = 1;
pub const STATUS_VOIDED: u8 = 2;
/// Between the first and the second side's `graduate`: both curves closed, the pair committed (it can no longer void).
pub const STATUS_GRADUATING: u8 = 3;
/// If the second side's pool still cannot be created this long after the first (only Raydium's admin can cause that: raising the
/// create-pool fee above the side's raise, or disabling pool creation on the pinned AmmConfig), sells reopen on THAT side's curve so
/// its holders are never locked in. Graduation of that side stays possible.
pub const GRADUATION_STUCK_SECS: i64 = 3 * 24 * 60 * 60;

/// Each coin: 1,000,000,000 tokens at 6 decimals, all minted into the side's token vault at init_pair.
pub const TOKEN_DECIMALS: u8 = 6;
pub const TOTAL_SUPPLY: u64 = 1_000_000_000 * 1_000_000;

/// The curve fee: 100 bps of every trade's SOL leg (buy: of the curve cost; sell: of the curve proceeds), rounded DOWN. Of it,
/// floor(fee × 25 / 100) goes to the developer wallet and the rest to the traded mint's burn_receipts fee PDA (the burn pool).
pub const FEE_BPS: u64 = 100;
pub const DEV_FEE_BPS: u64 = 25;
pub const BPS_DENOMINATOR: u64 = 10_000;

/// Defaults (pump.fun's published constants; the TS client passes them unless a pair overrides).
pub const DEFAULT_VIRTUAL_SOL_LAMPORTS: u64 = 30_000_000_000;
pub const DEFAULT_VIRTUAL_TOKEN_AMOUNT: u64 = 1_073_000_000 * 1_000_000;
pub const DEFAULT_CURVE_SUPPLY: u64 = 793_100_000 * 1_000_000;
pub const DEFAULT_TARGET_RAISE_LAMPORTS: u64 = 85_000_000_000;
pub const DEFAULT_MIN_SIDE_SHARE_BPS: u16 = 2_500;

/// init_pair bounds.
pub const MIN_VIRTUAL_SOL_LAMPORTS: u64 = 10_000_000;
pub const MIN_RESERVE_BPS: u64 = 1_000;
pub const MAX_RESERVE_BPS: u64 = 5_000;
pub const MIN_SIDE_SHARE_BPS: u16 = 1_000;
pub const MAX_SIDE_SHARE_BPS: u16 = 5_000;
pub const MIN_TARGET_RAISE_LAMPORTS: u64 = 100_000_000;
/// Each side's minimum raise (target × share) must cover its graduation costs plus this much pool liquidity.
pub const MIN_POOL_LIQUIDITY_LAMPORTS: u64 = 10_000_000;
pub const MIN_DURATION_SECS: i64 = 60;
pub const MAX_DURATION_SECS: i64 = 90 * 24 * 60 * 60;
/// The largest raise one side may represent (F(curve_supply)), so every u64 sum in the program has headroom: 10^9 SOL.
pub const MAX_SIDE_RAISE_LAMPORTS: u64 = 1_000_000_000_000_000_000;

/// Raydium CPMM (raydium-cp-swap@b3187ae5): instruction `initialize` and the accounts it creates.
pub const CPMM_INITIALIZE_DISCRIMINATOR: [u8; 8] = [175, 175, 109, 31, 13, 152, 155, 237];
pub const CPMM_AUTH_SEED: &[u8] = b"vault_and_lp_mint_auth_seed";
/// initialize never mints these 100 LP units (lock_lp_amount); they stay counted in PoolState.lp_supply.
pub const CPMM_LOCKED_LP: u64 = 100;
/// PoolState::LEN, ObservationState::LEN, SPL Mint::LEN, SPL Account::LEN — the rent `initialize` charges its creator.
pub const CPMM_POOL_STATE_LEN: usize = 637;
pub const CPMM_OBSERVATION_LEN: usize = 4_075;
pub const SPL_MINT_LEN: usize = 82;
pub const SPL_ACCOUNT_LEN: usize = 165;
/// AmmConfig (borsh, 8-byte discriminator): disable_create_pool @9, create_pool_fee @36 (states/config.rs).
pub const AMM_CONFIG_DISABLE_CREATE_POOL: usize = 9;
pub const AMM_CONFIG_CREATE_POOL_FEE: usize = 36;

/// LaunchLab PlatformConfig (SDK layout.ts): platformClaimFeeWallet @16 — the developer's fee wallet on LaunchLab, and therefore on
/// the pair curve.
pub const LL_PLATFORM_CLAIM_FEE_WALLET: usize = 16;
