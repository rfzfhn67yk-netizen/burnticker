//! Review H-2 — the ONE fee-inflow path, pinned: the fee PDA is the token's LaunchLab creator (LaunchLab `initializeV2` takes
//! `creator` as a non-signer), so the bonding-curve creator fee accrues in LaunchLab's creator vault for (fee PDA, WSOL), which only
//! the creator's signature can claim. This PERMISSIONLESS instruction makes that signature: it CPIs LaunchLab `claim_creator_fee`
//! with the fee PDA signing by seeds, and the recipient pinned to the fee PDA's own WSOL associated token account — no other
//! destination is possible. After graduation the CPMM creator fee needs no program help: Raydium's
//! `collect_creator_fee_permissionless` pays `pool_creator` (= the fee PDA) into the same ATAs.
//!
//! LaunchLab's account list and discriminator are taken from the Raydium SDK (@raydium-io/raydium-sdk-v2 0.2.74-alpha):
//!   src/raydium/launchpad/instrument.ts  claimCreatorFee(programId, creator, creatorClaimFeeAuth, creatorClaimFeeVault,
//!                                        recipientTokenAccount, mintB, mintProgramB) →
//!     keys [creator (signer, writable), creatorClaimFeeAuth, creatorClaimFeeVault (w), recipientTokenAccount (w), mintB,
//!           mintProgramB, SystemProgram, ASSOCIATED_TOKEN_PROGRAM_ID]; data = anchorDataBuf.claimCreatorFee = [26,97,138,203,132,171,141,252]
//!   src/raydium/launchpad/pda.ts         getPdaCreatorFeeVaultAuth = [b"creator_fee_vault_auth_seed"],
//!                                        getPdaCreatorVault = [creator, mintB]
//! and pinned byte-for-byte by tests/launchlab.rs against the SDK builder's own output (fixtures/launchlab-claim-sdk.json).
//!
//! The fee PDA must be marked writable (LaunchLab may pay for the recipient ATA from it), so the program checks afterwards that the
//! fee PDA lost no lamports, its WSOL account lost no tokens and its token account (CPMM creator fees in the token) lost none: the
//! CPI can only ADD to the burn pool. The CPI receives exactly the SDK's eight accounts — a callee can touch no account it is not
//! passed — and the instruction refuses any remaining accounts (review-2 F13). The recipient ATA must
//! already exist (created by anyone, permissionlessly) so nothing is ever paid from the fee PDA.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_spl::associated_token::{get_associated_token_address, AssociatedToken};
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::constants::*;
use crate::error::BurnError;
use crate::events::LaunchLabCreatorFeeClaimed;
use crate::guards::{require_fee_pda_intact, require_fee_token_account_intact};
use crate::state::TokenConfig;

#[event_cpi]
#[derive(Accounts)]
pub struct ClaimLaunchlabCreatorFee<'info> {
    /// Anyone (recorded in the event).
    pub payer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED, config.mint.as_ref()], bump = config.bump)]
    pub config: Box<Account<'info, TokenConfig>>,
    #[account(mut, seeds = [FEE_SEED, config.mint.as_ref()], bump = config.fee_bump)]
    pub fee_vault: SystemAccount<'info>,
    #[account(
        mut,
        associated_token::mint = wsol_mint,
        associated_token::authority = fee_vault,
        associated_token::token_program = token_program
    )]
    pub fee_wsol: Box<Account<'info, TokenAccount>>,
    #[account(address = NATIVE_MINT)]
    pub wsol_mint: Box<Account<'info, Mint>>,
    /// CHECK: the fee PDA's token ATA (address-checked; it may not exist yet). Review-2 F13: it is NOT passed to the CPI, and its
    /// balance is snapshotted and re-checked anyway, so the claim provably leaves the CPMM creator-fee tokens untouched.
    #[account(address = get_associated_token_address(&fee_vault.key(), &config.mint))]
    pub fee_tokens: UncheckedAccount<'info>,
    /// CHECK: LaunchLab's creator-fee vault authority PDA (seeds-checked under the LaunchLab program).
    #[account(seeds = [LAUNCHLAB_CREATOR_FEE_VAULT_AUTH_SEED], bump, seeds::program = LAUNCHLAB_PROGRAM_ID)]
    pub launchlab_vault_authority: UncheckedAccount<'info>,
    /// CHECK: LaunchLab's creator vault for (fee PDA, WSOL) (seeds-checked under the LaunchLab program).
    #[account(mut, seeds = [fee_vault.key().as_ref(), NATIVE_MINT.as_ref()], bump, seeds::program = LAUNCHLAB_PROGRAM_ID)]
    pub launchlab_creator_fee_vault: UncheckedAccount<'info>,
    /// CHECK: address-checked: Raydium LaunchLab.
    #[account(address = LAUNCHLAB_PROGRAM_ID @ BurnError::InvalidLaunchLabAccount)]
    pub launchlab_program: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

/// The LaunchLab `claim_creator_fee` instruction this program signs — the SDK's `claimCreatorFee` with creator = the fee PDA, mintB =
/// WSOL, mintProgramB = SPL Token. Pinned against the SDK's own bytes by tests/launchlab.rs.
pub fn launchlab_claim_ix(fee_vault: &Pubkey, vault_authority: &Pubkey, creator_fee_vault: &Pubkey, fee_wsol: &Pubkey) -> Instruction {
    Instruction {
        program_id: LAUNCHLAB_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(*fee_vault, true),
            AccountMeta::new_readonly(*vault_authority, false),
            AccountMeta::new(*creator_fee_vault, false),
            AccountMeta::new(*fee_wsol, false),
            AccountMeta::new_readonly(NATIVE_MINT, false),
            AccountMeta::new_readonly(anchor_spl::token::ID, false),
            AccountMeta::new_readonly(anchor_lang::solana_program::system_program::ID, false),
            AccountMeta::new_readonly(anchor_spl::associated_token::ID, false),
        ],
        data: LAUNCHLAB_CLAIM_CREATOR_FEE_DISCRIMINATOR.to_vec(),
    }
}

/// The token balance of an SPL Token account, or 0 when it does not exist (yet).
fn token_balance(acc: &AccountInfo) -> Result<u64> {
    if acc.owner != &anchor_spl::token::ID || acc.data_len() < 72 {
        return Ok(0);
    }
    let d = acc.try_borrow_data()?;
    Ok(u64::from_le_bytes(d[64..72].try_into().map_err(|_| BurnError::ClaimOutflow)?))
}

pub fn handle_claim_launchlab_creator_fee(ctx: Context<ClaimLaunchlabCreatorFee>) -> Result<()> {
    // Review-2 F13: no extra accounts, so no other fee-PDA-owned account can ride along (writable or not).
    require!(ctx.remaining_accounts.is_empty(), BurnError::UnexpectedAccounts);
    let a = &ctx.accounts;
    let mint_key = a.config.mint;
    let fee_seeds: &[&[u8]] = &[FEE_SEED, mint_key.as_ref(), &[a.config.fee_bump]];
    let lamports_before = a.fee_vault.lamports();
    let wsol_before = a.fee_wsol.amount;
    let tokens_before = token_balance(&a.fee_tokens.to_account_info())?;

    let ix = launchlab_claim_ix(&a.fee_vault.key(), &a.launchlab_vault_authority.key(), &a.launchlab_creator_fee_vault.key(), &a.fee_wsol.key());
    anchor_lang::solana_program::program::invoke_signed(
        &ix,
        &[
            a.fee_vault.to_account_info(),
            a.launchlab_vault_authority.to_account_info(),
            a.launchlab_creator_fee_vault.to_account_info(),
            a.fee_wsol.to_account_info(),
            a.wsol_mint.to_account_info(),
            a.token_program.to_account_info(),
            a.system_program.to_account_info(),
            a.associated_token_program.to_account_info(),
            a.launchlab_program.to_account_info(),
        ],
        &[fee_seeds],
    )?;

    // Review-3 M-1: the fee PDA and its token accounts must come back exactly as they went in — System-owned, no data, no delegate,
    // no close authority, same owner and mint — so a callee abusing the fee PDA's signature (assign, SetAuthority, Approve) reverts.
    let a = &ctx.accounts;
    require_fee_pda_intact(&a.fee_vault.to_account_info(), lamports_before)?;
    require_fee_token_account_intact(&a.fee_wsol.to_account_info(), &a.fee_vault.key(), &NATIVE_MINT, false)?;
    require_fee_token_account_intact(&a.fee_tokens.to_account_info(), &a.fee_vault.key(), &mint_key, true)?;
    ctx.accounts.fee_wsol.reload()?;
    let wsol_after = ctx.accounts.fee_wsol.amount;
    require!(ctx.accounts.fee_vault.lamports() >= lamports_before, BurnError::ClaimOutflow);
    require!(wsol_after >= wsol_before, BurnError::ClaimOutflow);
    require!(token_balance(&ctx.accounts.fee_tokens.to_account_info())? >= tokens_before, BurnError::ClaimOutflow);
    let claimed = wsol_after - wsol_before;
    let config = ctx.accounts.config.key();
    emit_cpi!(LaunchLabCreatorFeeClaimed { config, claimed_lamports: claimed, caller: ctx.accounts.payer.key() });
    Ok(())
}
