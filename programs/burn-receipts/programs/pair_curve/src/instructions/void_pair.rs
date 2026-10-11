use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::token::{self, Token};

use crate::commit::{read_amm, side_can_graduate};
use crate::constants::*;
use crate::error::PairError;
use crate::events::{DeveloperFeeClaimed, PairClosed, PairVoided};
use crate::guards::{mint_supply, require_token_account_intact, require_vault_intact};
use crate::state::Pair;

/// PERMISSIONLESS. Two cases, both turning trading into a race-free pro-rata redemption without a fee (blind review 2 M-1):
///   * Open, at or after the deadline: the pair is Voided. Each side's redemption pool = its curve SOL + its escrowed 75 bps burn share
///     (the burn share comes back to the holders — nothing is stranded in a burn pool that can never be registered).
///   * Graduating, ≥ 3 days after the commit, and Raydium is actually blocking the missing side's pool (pool creation disabled on the
///     pinned AmmConfig, or its fee leaves the side no liquidity): that side alone goes into redemption (blind review 1 L-2/L-3).
#[event_cpi]
#[derive(Accounts)]
pub struct VoidPair<'info> {
    pub caller: Signer<'info>,
    #[account(mut, seeds = [PAIR_SEED, pair.mints[0].as_ref(), pair.mints[1].as_ref()], bump = pair.bump)]
    pub pair: Box<Account<'info, Pair>>,
    /// CHECK: the pinned AmmConfig (address; owner and layout checked) — evidence of a Raydium block for the stuck-side case.
    #[account(address = pair.cp_config @ PairError::InvalidAmmConfig)]
    pub amm_config: UncheckedAccount<'info>,
}

fn start_redemption(p: &mut Pair, s: usize) {
    p.sol[s] = p.sol[s].saturating_add(p.burn_escrow[s]);
    p.burn_escrow[s] = 0;
    p.redeem_pool[s] = p.sol[s];
    p.redeem_supply[s] = p.sold[s];
}

pub fn handle_void(ctx: Context<VoidPair>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let rent = Rent::get()?;
    let amm = read_amm(&ctx.accounts.amm_config.to_account_info())?;
    let caller = ctx.accounts.caller.key();
    let p = &mut ctx.accounts.pair;
    let side = match p.status {
        STATUS_OPEN => {
            require!(now >= p.deadline, PairError::DeadlineNotReached);
            p.status = STATUS_VOIDED;
            p.voided_at = now;
            start_redemption(p, 0);
            start_redemption(p, 1);
            2u8
        }
        STATUS_GRADUATING => {
            let m = (0..2).find(|&s| p.pools[s] == Pubkey::default() && !p.refunding[s]).ok_or(PairError::NotStuck)?;
            require!(now >= p.graduation_started_at.saturating_add(GRADUATION_STUCK_SECS), PairError::NotStuck);
            require!(!side_can_graduate(p, m, &amm, &rent), PairError::NotStuck);
            p.refunding[m] = true;
            p.voided_at = now;
            start_redemption(p, m);
            m as u8
        }
        _ => return err!(PairError::NotOpen),
    };
    let ev = PairVoided { pair: p.key(), caller, side, redeem_pool: p.redeem_pool, redeem_supply: p.redeem_supply };
    emit_cpi!(ev);
    Ok(())
}

/// PERMISSIONLESS. Pays the accrued 25 bps developer share to the developer wallet recorded at init. Refused (nothing moves, nothing
/// else is affected) while the wallet cannot receive it: executable, or a payment that would leave it below rent.
#[event_cpi]
#[derive(Accounts)]
pub struct ClaimDeveloperFee<'info> {
    pub caller: Signer<'info>,
    #[account(mut, seeds = [PAIR_SEED, pair.mints[0].as_ref(), pair.mints[1].as_ref()], bump = pair.bump)]
    pub pair: Box<Account<'info, Pair>>,
    #[account(mut, address = pair.vault @ PairError::AccountMismatch)]
    pub vault: SystemAccount<'info>,
    /// CHECK: the developer wallet recorded at init (address-checked); only ever credited.
    #[account(mut, address = pair.dev_wallet @ PairError::AccountMismatch)]
    pub dev_wallet: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

/// Can `acc` be credited `amount` lamports by a System transfer without failing the transaction?
pub fn can_receive(acc: &AccountInfo, amount: u64) -> Result<bool> {
    if acc.executable {
        return Ok(false);
    }
    let after = acc.lamports().checked_add(amount).ok_or(PairError::MathOverflow)?;
    Ok(after >= Rent::get()?.minimum_balance(acc.data_len()))
}

fn pay_dev<'info>(vault: &AccountInfo<'info>, dev: &AccountInfo<'info>, seeds: &[&[u8]], amount: u64) -> Result<()> {
    system_program::transfer(CpiContext::new_with_signer(system_program::ID, system_program::Transfer { from: vault.clone(), to: dev.clone() }, &[seeds]), amount)
}

pub fn handle_claim_developer_fee(ctx: Context<ClaimDeveloperFee>) -> Result<()> {
    let a = &ctx.accounts;
    let amount = a.pair.dev_accrued;
    require!(amount > 0 && can_receive(&a.dev_wallet, amount)?, PairError::NothingToClaim);
    let pair_key = a.pair.key();
    let seeds: &[&[u8]] = &[VAULT_SEED, pair_key.as_ref(), &[a.pair.vault_bump]];
    pay_dev(&a.vault.to_account_info(), &a.dev_wallet.to_account_info(), seeds, amount)?;
    let (caller, dev_wallet) = (a.caller.key(), a.dev_wallet.key());
    ctx.accounts.pair.dev_accrued = 0;
    emit_cpi!(DeveloperFeeClaimed { pair: pair_key, caller, dev_wallet, lamports: amount });
    Ok(())
}

/// PERMISSIONLESS, Voided pairs only (blind review 2 H-2 / blind review 1 H-1: a graduated or graduating pair is never closed — its
/// Pair account is what `burn_receipts.register_pair_pool` reads, so closing it could strand a burn pool forever). Allowed once no
/// token of either coin circulates outside the vault (mint supply − vault balance = 0; tokens a holder burned count as gone, so dust
/// burned after a void cannot block it — blind review 2 L-1). The vault's tokens are burned; the developer accrual is paid if the
/// wallet can receive it (otherwise the close waits); any lamports above the SOL vault's rent minimum (dust left by burned tokens,
/// donations) go to the two burn pools; the token-vault and Pair rent go to the creator who paid it — or, if that address is
/// executable and cannot be credited, to burn pool A (blind review 1 I-3).
#[event_cpi]
#[derive(Accounts)]
pub struct ClosePair<'info> {
    pub caller: Signer<'info>,
    #[account(mut, seeds = [PAIR_SEED, pair.mints[0].as_ref(), pair.mints[1].as_ref()], bump = pair.bump)]
    pub pair: Box<Account<'info, Pair>>,
    /// CHECK: the creator recorded at init (address) — receives the rent of the accounts closed here unless it is executable.
    #[account(mut, address = pair.creator @ PairError::AccountMismatch)]
    pub creator: UncheckedAccount<'info>,
    #[account(mut, address = pair.vault @ PairError::AccountMismatch)]
    pub vault: SystemAccount<'info>,
    /// CHECK: mint A (address); writable for the burn of the returned supply.
    #[account(mut, address = pair.mints[0] @ PairError::AccountMismatch)]
    pub mint_a: UncheckedAccount<'info>,
    /// CHECK: mint B (address).
    #[account(mut, address = pair.mints[1] @ PairError::AccountMismatch)]
    pub mint_b: UncheckedAccount<'info>,
    /// CHECK: token vault A (address).
    #[account(mut, address = pair.token_vaults[0] @ PairError::AccountMismatch)]
    pub token_vault_a: UncheckedAccount<'info>,
    /// CHECK: token vault B (address).
    #[account(mut, address = pair.token_vaults[1] @ PairError::AccountMismatch)]
    pub token_vault_b: UncheckedAccount<'info>,
    #[account(mut, address = pair.fee_vaults[0] @ PairError::AccountMismatch)]
    pub fee_vault_a: SystemAccount<'info>,
    #[account(mut, address = pair.fee_vaults[1] @ PairError::AccountMismatch)]
    pub fee_vault_b: SystemAccount<'info>,
    /// CHECK: the developer wallet recorded at init (address) — paid any remaining accrual here.
    #[account(mut, address = pair.dev_wallet @ PairError::AccountMismatch)]
    pub dev_wallet: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handle_close(ctx: Context<ClosePair>) -> Result<()> {
    let a = &ctx.accounts;
    let p = &a.pair;
    require!(p.status == STATUS_VOIDED, PairError::NotClosable);
    let pair_key = p.key();
    let vault = a.vault.to_account_info();
    let seeds: &[&[u8]] = &[VAULT_SEED, pair_key.as_ref(), &[p.vault_bump]];
    let rent_to = if a.creator.executable { a.fee_vault_a.to_account_info() } else { a.creator.to_account_info() };
    let mut burned = [0u64; 2];
    for (i, (mint, tv)) in [(a.mint_a.to_account_info(), a.token_vault_a.to_account_info()), (a.mint_b.to_account_info(), a.token_vault_b.to_account_info())].into_iter().enumerate() {
        let left = require_token_account_intact(&tv, &vault.key(), &mint.key())?;
        // Every token not in the vault circulates; any circulating token keeps the side open.
        require!(mint_supply(&mint)? == left, PairError::NotClosable);
        if left > 0 {
            token::burn(CpiContext::new_with_signer(token::ID, token::Burn { mint: mint.clone(), from: tv.clone(), authority: vault.clone() }, &[seeds]), left)?;
            burned[i] = left;
        }
        token::close_account(CpiContext::new_with_signer(token::ID, token::CloseAccount { account: tv.clone(), destination: rent_to.clone(), authority: vault.clone() }, &[seeds]))?;
    }
    let dev = p.dev_accrued;
    if dev > 0 {
        require!(can_receive(&a.dev_wallet, dev)?, PairError::NotClosable);
        pay_dev(&vault, &a.dev_wallet.to_account_info(), seeds, dev)?;
    }
    let vault_rent = Rent::get()?.minimum_balance(0);
    require_vault_intact(&vault, vault_rent)?;
    let residue = vault.lamports() - vault_rent;
    let half = residue / 2;
    for (to, amount) in [(a.fee_vault_a.to_account_info(), half), (a.fee_vault_b.to_account_info(), residue - half)] {
        if amount > 0 {
            system_program::transfer(CpiContext::new_with_signer(system_program::ID, system_program::Transfer { from: vault.clone(), to }, &[seeds]), amount)?;
        }
    }
    let ev = PairClosed { pair: pair_key, caller: a.caller.key(), rent_to: rent_to.key(), status: STATUS_VOIDED, tokens_burned: burned, residue_lamports: residue };
    let p = &mut ctx.accounts.pair;
    p.dev_accrued = 0;
    p.sol = [0, 0];
    emit_cpi!(ev);
    ctx.accounts.pair.close(rent_to)?;
    Ok(())
}
