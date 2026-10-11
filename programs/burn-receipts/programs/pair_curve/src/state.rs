use anchor_lang::prelude::*;

use crate::constants::*;
use crate::math::CurveParams;

/// One rivalry pair. Parameters are written once by init_pair and never again (no instruction takes a `&mut` to them).
///
/// LAYOUT CONTRACT: burn_receipts reads the first fields of this account BY BYTE OFFSET (register_pair_pool, burn_receipts
/// src/pair_curve.rs). Do not reorder or resize anything before `vault`:
///   version @8, bump @9, vault_bump @10, status @11, mints @12/@44, pools @76/@108, lp_supply_at_creation @140/@148,
///   lp_burned @156/@164, cp_config @172, vault @204 (236 bytes).
/// tests/lifecycle.rs pins these offsets against a real account.
#[account]
#[derive(InitSpace)]
pub struct Pair {
    pub version: u8,
    pub bump: u8,
    pub vault_bump: u8,
    /// STATUS_OPEN / STATUS_GRADUATED / STATUS_VOIDED / STATUS_GRADUATING.
    pub status: u8,
    /// [side A, side B].
    pub mints: [Pubkey; 2],
    /// The graduated CPMM pools (default until that side graduates): the pair_curve PDAs ["pool", pair, [side]].
    pub pools: [Pubkey; 2],
    /// PoolState.lp_supply right after `initialize` (all LP that ever existed at creation, incl. CPMM's 100 unminted units).
    pub lp_supply_at_creation: [u64; 2],
    /// LP burned by graduate (everything the vault received).
    pub lp_burned: [u64; 2],
    /// The CPMM AmmConfig both pools use — the cpConfigId pinned in both mints' burn_receipts TokenConfigs.
    pub cp_config: Pubkey,
    /// The SOL vault PDA ["vault", pair] (also the CPMM pool_creator).
    pub vault: Pubkey,
    // ----- fixed at init -----
    /// The creator recorded in both burn_receipts TokenConfigs; receives the rent when close_pair closes the accounts.
    pub creator: Pubkey,
    /// The developer wallet (25 bps of every trade): platformClaimFeeWallet of the pinned LaunchLab platform at init.
    pub dev_wallet: Pubkey,
    pub ll_platform: Pubkey,
    /// burn_receipts fee PDAs ["fee", mint] — the burn pools (75 bps of every trade on that side).
    pub fee_vaults: [Pubkey; 2],
    /// ATA(vault, mint) per side.
    pub token_vaults: [Pubkey; 2],
    /// ATA(vault, WSOL): created and closed inside graduate.
    pub vault_wsol: Pubkey,
    pub pool_bumps: [u8; 2],
    /// sha256 of the pair id string (the registry's pairId) — the link between the two locked rules.
    pub pair_id: [u8; 32],
    /// rules_sha256 of each side, copied from its TokenConfig.
    pub rules_sha256_a: [u8; 32],
    pub rules_sha256_b: [u8; 32],
    pub virtual_sol_lamports: u64,
    pub virtual_token_amount: u64,
    /// Raw tokens each side's curve may sell; TOTAL_SUPPLY − curve_supply is the side's liquidity reserve.
    pub curve_supply: u64,
    pub reserve_supply: u64,
    /// Combined raise (sol_A + sol_B) needed to graduate.
    pub target_raise_lamports: u64,
    pub min_side_share_bps: u16,
    pub deadline: i64,
    pub created_at: i64,
    // ----- state -----
    /// Raw tokens each curve has sold (net of sells).
    pub sold: [u64; 2],
    /// Lamports owed to each side: while Open/Graduating = F(sold) (invariant; zeroed when the side's pool is created); once the side is
    /// in redemption (Voided, or a refunding side) = what its remaining holders will receive, pro rata.
    pub sol: [u64; 2],
    /// Gross curve SOL traded per side (cost of buys + proceeds of sells).
    pub volume_lamports: [u64; 2],
    pub burn_fees_lamports: [u64; 2],
    pub dev_fees_lamports: [u64; 2],
    pub trades: [u32; 2],
    pub graduated_at: i64,
    pub voided_at: i64,
    /// Graduation: lamports and tokens deposited in each pool, and tokens burned from each token vault.
    pub pool_sol: [u64; 2],
    pub pool_tokens: [u64; 2],
    pub tokens_burned: [u64; 2],
    /// When the first side's graduate ran (the decision), and the two raises at that moment.
    pub graduation_started_at: i64,
    pub raise_at_graduation: [u64; 2],
    // ----- review round 1+2 (2026-10-10 night) -----
    /// The 75 bps burn share of each side, ESCROWED in the SOL vault until that side's pool exists (then paid to its burn pool); on a
    /// void it is returned to that side's holders with the curve SOL (blind review 2 M-1).
    pub burn_escrow: [u64; 2],
    /// The 25 bps developer share, accrued in the SOL vault and paid by the permissionless `claim_developer_fee` (blind review 1 H-2:
    /// trades never credit the developer wallet, so an executable or emptied wallet cannot block them).
    pub dev_accrued: u64,
    /// Redemption snapshot per side (Voided, or a refunding side): the lamports and the raw tokens outstanding when redemption began.
    /// Each sell then pays amount × pool / supply (no fee); the last holder receives the remainder (blind review 2 M-1).
    pub redeem_pool: [u64; 2],
    pub redeem_supply: [u64; 2],
    /// A side whose pool Raydium blocked after the commit: its holders redeem pro rata (blind review 1 L-2/L-3).
    pub refunding: [bool; 2],
    pub reserved: [u8; 64],
}

impl Pair {
    pub fn curve(&self) -> CurveParams {
        CurveParams { virtual_sol: self.virtual_sol_lamports, virtual_token: self.virtual_token_amount, curve_supply: self.curve_supply }
    }
    pub fn total_sol(&self) -> u64 {
        self.sol[0].saturating_add(self.sol[1])
    }
    /// Lamports the SOL vault owes beyond its rent minimum: both sides' SOL, the escrowed burn shares, the developer accrual.
    pub fn owed(&self) -> u64 {
        self.sol[0].saturating_add(self.sol[1]).saturating_add(self.burn_escrow[0]).saturating_add(self.burn_escrow[1]).saturating_add(self.dev_accrued)
    }
    /// Is side `s` in pro-rata redemption?
    pub fn redeeming(&self, s: usize) -> bool {
        self.status == STATUS_VOIDED || self.refunding[s]
    }
}

/// Byte offsets burn_receipts depends on (8-byte discriminator included).
pub mod offsets {
    pub const VERSION: usize = 8;
    pub const STATUS: usize = 11;
    pub const MINTS: usize = 12;
    pub const POOLS: usize = 76;
    pub const LP_SUPPLY_AT_CREATION: usize = 140;
    pub const LP_BURNED: usize = 156;
    pub const CP_CONFIG: usize = 172;
    pub const VAULT: usize = 204;
    pub const MIN_LEN: usize = 236;
}

#[allow(dead_code)]
const _: () = assert!(TOTAL_SUPPLY > 0);
