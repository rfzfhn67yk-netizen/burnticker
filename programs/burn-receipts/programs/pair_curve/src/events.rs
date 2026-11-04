//! Every state change emits one of these through `emit_cpi!` (inner-instruction data, not truncatable logs), so an indexer can
//! rebuild a pair's whole history — parameters, every trade with its fee legs, graduation with both pools, void, close — from the
//! chain alone.

use anchor_lang::prelude::*;

#[event]
pub struct PairInitialized {
    pub pair: Pubkey,
    pub mint_a: Pubkey,
    pub mint_b: Pubkey,
    pub creator: Pubkey,
    pub vault: Pubkey,
    pub dev_wallet: Pubkey,
    pub fee_vault_a: Pubkey,
    pub fee_vault_b: Pubkey,
    pub ll_platform: Pubkey,
    pub cp_config: Pubkey,
    pub pair_id: [u8; 32],
    pub rules_sha256_a: [u8; 32],
    pub rules_sha256_b: [u8; 32],
    pub virtual_sol_lamports: u64,
    pub virtual_token_amount: u64,
    pub curve_supply: u64,
    pub reserve_supply: u64,
    pub target_raise_lamports: u64,
    pub min_side_share_bps: u16,
    pub deadline: i64,
}

#[event]
pub struct Trade {
    pub pair: Pubkey,
    pub side: u8,
    pub is_buy: bool,
    pub trader: Pubkey,
    pub tokens: u64,
    /// Buy: the curve cost (into the vault). Sell: the curve proceeds (out of the vault), before the fee.
    pub curve_lamports: u64,
    pub fee: u64,
    pub dev_fee: u64,
    pub burn_fee: u64,
    /// A redemption (Voided pair or refunding side): pro rata, no fee.
    pub redemption: bool,
    pub sold_after: u64,
    pub sol_after: u64,
    pub sol_total_after: u64,
    pub status: u8,
}

/// One side's CPMM pool created (graduate runs once per side; the first call is the decision that closes both curves).
#[event]
pub struct SideGraduated {
    pub pair: Pubkey,
    pub side: u8,
    pub cranker: Pubkey,
    pub pool: Pubkey,
    /// The side's raise when its pool was created (moved into the pool less CPMM's fee and rents).
    pub raise_lamports: u64,
    pub pool_sol: u64,
    pub pool_tokens: u64,
    pub lp_supply_at_creation: u64,
    /// The LP CPMM minted to the vault (everything but its 100 never-minted units). It stays in the vault's LP account until lock_lp
    /// locks it (LAUNCHPAD-PATH §35).
    pub lp_minted: u64,
    pub tokens_burned: u64,
    /// The side's escrowed 75 bps burn share, paid to its burn pool now.
    pub burn_escrow_paid: u64,
    /// Rent refunds, rounding dust and donations above what the vault must keep, sent to this side's burn pool too.
    pub residue_lamports: u64,
    /// Lamports someone had pre-funded into the pool's WSOL vault address (now pool liquidity) — blind review 2 H-1.
    pub prefunded_wsol: u64,
    /// True when this call completed the second side (status Graduated).
    pub pair_graduated: bool,
}

/// A void (whole pair, `side` = 2) or a stuck side put into refund (`side` = 0/1): from here its holders redeem pro rata, no fee.
#[event]
pub struct PairVoided {
    pub pair: Pubkey,
    pub caller: Pubkey,
    pub side: u8,
    /// Per side: lamports to redeem (curve SOL + the escrowed burn share) and raw tokens outstanding.
    pub redeem_pool: [u64; 2],
    pub redeem_supply: [u64; 2],
}

#[event]
pub struct DeveloperFeeClaimed {
    pub pair: Pubkey,
    pub caller: Pubkey,
    pub dev_wallet: Pubkey,
    pub lamports: u64,
}

/// The first trade that left the pair ready committed it (status Graduating); graduate then creates the pools.
#[event]
pub struct PairCommitted {
    pub pair: Pubkey,
    pub by: Pubkey,
    pub raise: [u64; 2],
}

#[event]
pub struct PairClosed {
    pub pair: Pubkey,
    pub caller: Pubkey,
    pub rent_to: Pubkey,
    pub status: u8,
    pub tokens_burned: [u64; 2],
    pub residue_lamports: u64,
    /// Developer accrual the wallet could not receive (executable, or the payment would leave it below rent), sent to the burn pools
    /// with the residue instead of blocking the close (re-check RC-5). Included in `residue_lamports`.
    pub dev_accrual_to_burn_pools: u64,
}

/// lock_lp: the side's LP moved into Raydium's CPMM lock forever; its Fee Key NFT is held by burn_receipts' FEE_KEYS PDA, whose
/// claim_lock_fees splits the LP fees 80 % burn pool / 20 % operator (LAUNCHPAD-PATH §35).
#[event]
pub struct LpBurnedFallback {
    pub pair: Pubkey,
    pub side: u8,
    pub cranker: Pubkey,
    pub pool: Pubkey,
    pub lp_amount: u64,
}

#[event]
pub struct LpLocked {
    pub pair: Pubkey,
    pub side: u8,
    pub cranker: Pubkey,
    pub pool: Pubkey,
    pub lp_amount: u64,
    pub fee_nft_mint: Pubkey,
    pub fee_nft_account: Pubkey,
    pub locked_liquidity: Pubkey,
}
