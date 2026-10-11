//! pair_curve — the launch program for Burnticker rivalry pairs: both coins graduate together, or neither does.
//!
//! One `Pair` account per pair holds two virtual-reserve bonding curves (one per coin), one SOL vault and one graduation condition
//! over the combined raise. See docs/burnticker/PAIR-CURVE.md for the design, the threat model and what reviewers should attack.
//!
//! Instruction set (there is deliberately NO admin, NO authority field, NO parameter update and NO withdraw / sweep path):
//!   init_pair    payer + the creator recorded in both mints' burn_receipts TokenConfigs, once per pair: mint the supplies into the
//!                vaults, revoke the mint authority, fix every parameter
//!   buy / sell   permissionless, for the trader's own wallet: along the curve at the formula's price; 100 bps fee accounted in the
//!                SOL vault (75 escrowed for the side's burn pool, 25 accrued for the developer); the trade that leaves the pair ready
//!                commits it; after a void (or for a refunding side) sells are a pro-rata redemption with no fee
//!   claim_developer_fee  permissionless: pays the accrued 25 bps to the developer wallet pinned at init
//!   graduate     permissionless crank, once per side: the first call (combined raise at target, each side ≥ its minimum share,
//!                before the deadline) commits the pair and closes both curves; each call creates its side's CPMM pool, burns 100 %
//!                of the LP and the leftover tokens; the second completes the pair
//!   void_pair    permissionless: at/after the deadline if not committed (whole pair), or a stuck side Raydium blocks 3 days after
//!                the commit; its holders then redeem pro rata (curve SOL + escrowed burn share), no fee
//!   close_pair   permissionless, voided pairs only, once nothing circulates: rent → the creator, residue → the burn pools

pub mod commit;
pub mod constants;
pub mod cpmm;
pub mod error;
pub mod events;
pub mod guards;
pub mod instructions;
pub mod math;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("2jQotwSG8WKNYr5pccxuVmNa314qcnnwmrhqbuakELkN");

#[program]
pub mod pair_curve {
    use super::*;

    pub fn init_pair(ctx: Context<InitPair>, args: InitPairArgs) -> Result<()> {
        instructions::init_pair::handle_init_pair(ctx, args)
    }

    pub fn buy(ctx: Context<Buy>, side: u8, max_lamports_in: u64, min_tokens_out: u64) -> Result<()> {
        instructions::trade::handle_buy(ctx, side, max_lamports_in, min_tokens_out)
    }

    pub fn sell(ctx: Context<Sell>, side: u8, amount: u64, min_lamports_out: u64) -> Result<()> {
        instructions::trade::handle_sell(ctx, side, amount, min_lamports_out)
    }

    pub fn graduate(ctx: Context<Graduate>, side: u8) -> Result<()> {
        instructions::graduate::handle_graduate(ctx, side)
    }

    pub fn void_pair(ctx: Context<VoidPair>) -> Result<()> {
        instructions::void_pair::handle_void(ctx)
    }

    pub fn close_pair(ctx: Context<ClosePair>) -> Result<()> {
        instructions::void_pair::handle_close(ctx)
    }

    pub fn claim_developer_fee(ctx: Context<ClaimDeveloperFee>) -> Result<()> {
        instructions::void_pair::handle_claim_developer_fee(ctx)
    }
}
