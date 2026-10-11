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
/// The Fee Key NFT mint of a side's LP lock: ["fee_nft", pair, [side]] — a pair_curve PDA, so lock_lp needs no keypair signer and the
/// address is known before the lock exists (LAUNCHPAD-PATH §35).
pub const FEE_NFT_SEED: &[u8] = b"fee_nft";
/// Metaplex Token Metadata (an account of the lock program's instruction; pair_curve locks with with_metadata = false).
pub const METADATA_PROGRAM_ID: Pubkey = pubkey!("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
/// lock_cp_liquidity (SDK src/raydium/cpmm/instruction.ts anchorDataBuf.lockCpLiquidity).
pub const LOCK_CP_LIQUIDITY_DISCRIMINATOR: [u8; 8] = [216, 157, 29, 78, 38, 51, 31, 26];

pub const SIDE_A: u8 = 0;
pub const SIDE_B: u8 = 1;

pub const STATUS_OPEN: u8 = 0;
pub const STATUS_GRADUATED: u8 = 1;
pub const STATUS_VOIDED: u8 = 2;
/// Between the first and the second side's `graduate`: both curves closed, the pair committed (it can no longer void).
pub const STATUS_GRADUATING: u8 = 3;
/// If the second side's pool still cannot be created this long after the commit AND Raydium is actually blocking it (the pinned
/// AmmConfig disables pool creation, or its create-pool fee leaves the side no liquidity), `void_pair` puts THAT side into pro-rata
/// redemption so its holders are never locked in. Mere inactivity never triggers it (blind review 1 L-3).
pub const GRADUATION_STUCK_SECS: i64 = 3 * 24 * 60 * 60;

/// Unconditional fallback (re-check RC-2): a side whose pool is still missing this long after the commit is put into pro-rata
/// redemption whatever the reason — a CPMM-side refusal (an upgrade that changes `initialize`, a new check the pair's PDA-signed pool
/// fails) leaves no trace in the AmmConfig, and a failed `graduate` reverts, so it cannot leave evidence on chain either.
pub const GRADUATION_FALLBACK_SECS: i64 = 30 * 24 * 60 * 60;

/// lp-lock blind review L-2: if a graduated side's LP is still unlocked this long after the graduation decision (Raydium's
/// upgradeable lock program refused or changed `lock_cp_liquidity`), anyone may BURN it instead (`burn_lp`) — the side's pool then
/// registers on the burned LP (register_pair_pool counts burned + locked), at the cost of the LP fees. The keeper locks at once.
pub const LP_LOCK_FALLBACK_SECS: i64 = 30 * 24 * 60 * 60;

/// The LaunchLab PlatformConfig every pair must pin (blind review 1 M-1: the developer wallet is read from it, so it cannot be a
/// creator's own platform). Per build: devnet = Burnticker's devnet platform (docs/burnkeeper/devnet-run-log-2026-10-10.md A10);
/// `localnet` (LiteSVM suite) = the harness's test platform; the default (mainnet) build = Burnticker's mainnet platform 94x5qDDJ…
/// (getPdaPlatformId(LaunchLab LanMV9sA…, admin EMht6aGc…), compiled in 2026-10-11; created on chain by that admin before launch —
/// until then init_pair cannot read it). A build left at all zeros refuses init_pair (`PlatformNotPinned`).
#[cfg(feature = "devnet")]
pub const BURNTICKER_PLATFORM: Pubkey = pubkey!("GvSKpe5pwLuRzCQ56EGAA1urjtcxx554NivsGHexv3tf");
#[cfg(all(feature = "localnet", not(feature = "devnet")))]
pub const BURNTICKER_PLATFORM: Pubkey = Pubkey::new_from_array([0x5a; 32]);
#[cfg(not(any(feature = "devnet", feature = "localnet")))]
pub const BURNTICKER_PLATFORM: Pubkey = pubkey!("94x5qDDJP4UCkeMWppnmvqTmMgo971h3d6MDRnjEfYy9");

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
/// Blind review 2 L-2: at 5,000 both raises had to be equal to the lamport.
pub const MAX_SIDE_SHARE_BPS: u16 = 4_000;
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
