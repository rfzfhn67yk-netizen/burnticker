use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::associated_token::{self, AssociatedToken};
use anchor_spl::token::{self, Token};

use burn_receipts::constants::{CPMM_PROGRAM_ID, NATIVE_MINT};
use burn_receipts::cpmm::PoolView;

use crate::constants::*;
use crate::cpmm::{self, InitializeAccounts};
use crate::error::PairError;
use crate::events::SideGraduated;
use crate::guards::{mint_supply, require_token_account_intact, require_vault_intact, token_amount};
use crate::math::{graduation_costs, graduation_ready, price_matched_tokens, side_costs};
use crate::state::Pair;

/// PERMISSIONLESS CRANK, once per side (see docs/burnticker/PAIR-CURVE.md §5.1).
///
/// The FIRST call (status Open) is the decision: it requires the combined raise at target, each side at its minimum share and
/// `now < deadline`, and moves the pair to Graduating — from that instant both curves are closed to buys and sells and the pair can no
/// longer void, so the second side is committed. Each call then creates the CPMM pool of ITS side, burns 100 % of that pool's LP and
/// every token the pool did not need. The call that completes the second side sets Graduated.
///
/// Why two transactions and not one: Solana caps a transaction's instruction trace at 64 (top level + every CPI). One side costs
/// ~26 trace entries, ~35 if a griefer pre-funds the addresses CPMM creates (each create_account becomes transfer + allocate +
/// assign); both sides in one transaction would sit at the cap and could be pushed over it for ~0.01 SOL, forcing every pair to void.
/// One side per transaction stays far below the cap in every case (tests/lifecycle.rs pre-funds them all).
#[event_cpi]
#[derive(Accounts)]
#[instruction(side: u8)]
pub struct Graduate<'info> {
    /// Anyone. Pays only the transaction fee (every rent is paid from the raise, as LaunchLab's migration does).
    pub cranker: Signer<'info>,
    #[account(mut, constraint = side < 2 @ PairError::InvalidSide, seeds = [PAIR_SEED, pair.mints[0].as_ref(), pair.mints[1].as_ref()], bump = pair.bump)]
    pub pair: Box<Account<'info, Pair>>,
    #[account(mut, address = pair.vault @ PairError::AccountMismatch)]
    pub vault: SystemAccount<'info>,
    /// CHECK: ATA(vault, WSOL) (address recorded at init) — created and closed inside this instruction.
    #[account(mut, address = pair.vault_wsol @ PairError::AccountMismatch)]
    pub vault_wsol: UncheckedAccount<'info>,
    /// CHECK: the WSOL mint.
    #[account(address = NATIVE_MINT)]
    pub wsol_mint: UncheckedAccount<'info>,
    /// CHECK: the pinned AmmConfig (address); owner and layout checked in the handler.
    #[account(address = pair.cp_config @ PairError::InvalidAmmConfig)]
    pub amm_config: UncheckedAccount<'info>,
    /// CHECK: CPMM's vault / LP-mint authority PDA (CPMM checks its seeds).
    pub cpmm_authority: UncheckedAccount<'info>,
    /// CHECK: CPMM's create-pool-fee receiver (CPMM checks its address).
    #[account(mut)]
    pub create_pool_fee: UncheckedAccount<'info>,
    /// CHECK: the side's mint (address); writable for the burn of the tokens the pool does not need.
    #[account(mut, address = pair.mints[side as usize] @ PairError::AccountMismatch)]
    pub mint: UncheckedAccount<'info>,
    /// CHECK: the side's token vault (address recorded at init); re-checked after the CPI.
    #[account(mut, address = pair.token_vaults[side as usize] @ PairError::AccountMismatch)]
    pub token_vault: UncheckedAccount<'info>,
    /// CHECK: the side's pool: the pair_curve PDA ["pool", pair, [side]] (signs for its own creation inside CPMM).
    #[account(mut, seeds = [POOL_SEED, pair.key().as_ref(), &[side]], bump = pair.pool_bumps[side as usize])]
    pub pool: UncheckedAccount<'info>,
    /// CHECK: CPMM-derived LP mint (seeds checked by CPMM, matched against the pool after).
    #[account(mut)]
    pub lp_mint: UncheckedAccount<'info>,
    /// CHECK: ATA(vault, lp_mint), created by CPMM (checked by CPMM, then by the guards).
    #[account(mut)]
    pub vault_lp: UncheckedAccount<'info>,
    /// CHECK: CPMM pool vaults (seeds checked by CPMM; matched against the pool after).
    #[account(mut)]
    pub pool_vault_0: UncheckedAccount<'info>,
    /// CHECK: as above.
    #[account(mut)]
    pub pool_vault_1: UncheckedAccount<'info>,
    /// CHECK: CPMM observation account (seeds checked by CPMM).
    #[account(mut)]
    pub observation: UncheckedAccount<'info>,
    /// The side's burn pool (receives this call's residue: rent refunds and dust).
    #[account(mut, address = pair.fee_vaults[side as usize] @ PairError::AccountMismatch)]
    pub fee_vault: SystemAccount<'info>,
    /// CHECK: Raydium CPMM (address).
    #[account(address = CPMM_PROGRAM_ID)]
    pub cpmm_program: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handle_graduate(ctx: Context<Graduate>, side: u8) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let s = side as usize;
    {
        let p = &mut ctx.accounts.pair;
        match p.status {
            STATUS_OPEN => {
                require!(now < p.deadline, PairError::GraduationClosed);
                require!(graduation_ready(p.sol[0], p.sol[1], p.target_raise_lamports, p.min_side_share_bps), PairError::NotReadyToGraduate);
                p.status = STATUS_GRADUATING;
                p.graduation_started_at = now;
                p.raise_at_graduation = p.sol;
            }
            STATUS_GRADUATING => require!(p.pools[s] == Pubkey::default(), PairError::SideAlreadyGraduated),
            _ => return err!(PairError::NotOpen),
        }
    }

    let rent = Rent::get()?;
    let vault_rent = rent.minimum_balance(0);
    let a = &ctx.accounts;
    let amm = a.amm_config.to_account_info();
    let create_pool_fee = {
        require_keys_eq!(*amm.owner, CPMM_PROGRAM_ID, PairError::InvalidAmmConfig);
        let d = amm.try_borrow_data()?;
        require!(d.len() >= burn_receipts::cpmm::AMM_CONFIG_LEN && d[..8] == burn_receipts::cpmm::AMM_CONFIG_DISCRIMINATOR, PairError::InvalidAmmConfig);
        u64::from_le_bytes(d[AMM_CONFIG_CREATE_POOL_FEE..AMM_CONFIG_CREATE_POOL_FEE + 8].try_into().expect("8 bytes"))
    };
    // CPMM's own take (the bound the post-CPI guard enforces) and the side's whole overhead (plus the WSOL account's rent).
    let costs = graduation_costs(&rent, create_pool_fee);
    let overhead = side_costs(&rent, create_pool_fee);

    let pair_key = a.pair.key();
    let vault_seeds: &[&[u8]] = &[VAULT_SEED, pair_key.as_ref(), &[a.pair.vault_bump]];
    let vault = a.vault.to_account_info();
    let vault_wsol = a.vault_wsol.to_account_info();
    let mint = a.mint.to_account_info();
    let token_vault = a.token_vault.to_account_info();
    let (pool_acc, lp_mint, vault_lp) = (a.pool.to_account_info(), a.lp_mint.to_account_info(), a.vault_lp.to_account_info());
    let (pool_vault_0, pool_vault_1, observation) = (a.pool_vault_0.to_account_info(), a.pool_vault_1.to_account_info(), a.observation.to_account_info());

    let p = &a.pair;
    let pool_sol = p.sol[s].checked_sub(overhead).filter(|x| *x > 0).ok_or(PairError::InsufficientPoolSol)?;
    let available = require_token_account_intact(&token_vault, &vault.key(), &mint.key())?;
    let pool_tokens = price_matched_tokens(&p.curve(), p.sold[s], pool_sol, available)?;
    require!(pool_tokens > 0, PairError::InsufficientPoolSol);

    // The vault's WSOL account (idempotent: anyone may have created the ATA already; any WSOL in it is residue).
    associated_token::create_idempotent(CpiContext::new_with_signer(
        associated_token::ID,
        associated_token::Create {
            payer: vault.clone(),
            associated_token: vault_wsol.clone(),
            authority: vault.clone(),
            mint: a.wsol_mint.to_account_info(),
            system_program: a.system_program.to_account_info(),
            token_program: a.token_program.to_account_info(),
        },
        &[vault_seeds],
    ))?;
    let wsol_before = require_token_account_intact(&vault_wsol, &vault.key(), &NATIVE_MINT)?;
    system_program::transfer(
        CpiContext::new_with_signer(system_program::ID, system_program::Transfer { from: vault.clone(), to: vault_wsol.clone() }, &[vault_seeds]),
        pool_sol,
    )?;
    token::sync_native(CpiContext::new(token::ID, token::SyncNative { account: vault_wsol.clone() }))?;

    let wsol_first = NATIVE_MINT < mint.key();
    let (t0, t1, amt0, amt1, c0, c1) = if wsol_first {
        (a.wsol_mint.to_account_info(), mint.clone(), pool_sol, pool_tokens, vault_wsol.clone(), token_vault.clone())
    } else {
        (mint.clone(), a.wsol_mint.to_account_info(), pool_tokens, pool_sol, token_vault.clone(), vault_wsol.clone())
    };
    let lamports_before = vault.lamports();
    let side_byte = [side];
    let pool_bump = [p.pool_bumps[s]];
    let pool_seeds: &[&[u8]] = &[POOL_SEED, pair_key.as_ref(), &side_byte, &pool_bump];
    cpmm::initialize(
        InitializeAccounts {
            creator: &vault,
            amm_config: &amm,
            authority: &a.cpmm_authority.to_account_info(),
            pool_state: &pool_acc,
            token_0_mint: &t0,
            token_1_mint: &t1,
            lp_mint: &lp_mint,
            creator_token_0: &c0,
            creator_token_1: &c1,
            creator_lp_token: &vault_lp,
            token_0_vault: &pool_vault_0,
            token_1_vault: &pool_vault_1,
            create_pool_fee: &a.create_pool_fee.to_account_info(),
            observation_state: &observation,
            token_program: &a.token_program.to_account_info(),
            associated_token_program: &a.associated_token_program.to_account_info(),
            system_program: &a.system_program.to_account_info(),
            rent: &a.rent.to_account_info(),
        },
        amt0,
        amt1,
        &[vault_seeds, pool_seeds],
    )?;

    // ---- post-CPI guards: the vault and its token accounts, then the pool itself ----
    require_vault_intact(&vault, lamports_before.saturating_sub(costs))?;
    require!(require_token_account_intact(&vault_wsol, &vault.key(), &NATIVE_MINT)? == wsol_before, PairError::VaultTampered);
    let tokens_left = require_token_account_intact(&token_vault, &vault.key(), &mint.key())?;
    require!(tokens_left == available - pool_tokens, PairError::VaultTampered);
    let pool = PoolView::load(&pool_acc)?;
    require_keys_eq!(pool.pool_creator, vault.key(), PairError::PoolMismatch);
    require_keys_eq!(pool.amm_config, p.cp_config, PairError::PoolMismatch);
    require!(pool.token_0_mint == t0.key() && pool.token_1_mint == t1.key(), PairError::PoolMismatch);
    require!(pool.token_0_program == token::ID && pool.token_1_program == token::ID, PairError::PoolMismatch);
    require!(pool.token_0_vault == pool_vault_0.key() && pool.token_1_vault == pool_vault_1.key(), PairError::PoolMismatch);
    require!(pool.lp_mint == lp_mint.key() && pool.observation_key == observation.key(), PairError::PoolMismatch);
    require!(token_amount(&pool_vault_0)? == amt0 && token_amount(&pool_vault_1)? == amt1, PairError::PoolMismatch);
    let lp = require_token_account_intact(&vault_lp, &vault.key(), &pool.lp_mint)?;
    require!(lp.checked_add(CPMM_LOCKED_LP) == Some(pool.lp_supply) && mint_supply(&lp_mint)? == lp, PairError::PoolMismatch);

    // ---- burn 100 % of the LP, close the LP account, burn the tokens the pool did not need, close the WSOL account ----
    token::burn(
        CpiContext::new_with_signer(token::ID, token::Burn { mint: lp_mint.clone(), from: vault_lp.clone(), authority: vault.clone() }, &[vault_seeds]),
        lp,
    )?;
    require!(mint_supply(&lp_mint)? == 0, PairError::PoolMismatch);
    token::close_account(CpiContext::new_with_signer(
        token::ID,
        token::CloseAccount { account: vault_lp.clone(), destination: vault.clone(), authority: vault.clone() },
        &[vault_seeds],
    ))?;
    if tokens_left > 0 {
        token::burn(
            CpiContext::new_with_signer(token::ID, token::Burn { mint: mint.clone(), from: token_vault.clone(), authority: vault.clone() }, &[vault_seeds]),
            tokens_left,
        )?;
    }
    token::close_account(CpiContext::new_with_signer(
        token::ID,
        token::CloseAccount { account: vault_wsol.clone(), destination: vault.clone(), authority: vault.clone() },
        &[vault_seeds],
    ))?;

    // Everything above the vault's rent minimum and the OTHER side's still-owed raise is residue (rent refunds, rounding, any
    // donation) — it goes to this side's burn pool.
    let other_owed = if p.pools[1 - s] == Pubkey::default() { p.sol[1 - s] } else { 0 };
    let keep = vault_rent.checked_add(other_owed).ok_or(PairError::MathOverflow)?;
    require_vault_intact(&vault, keep)?;
    let residue = vault.lamports() - keep;
    if residue > 0 {
        system_program::transfer(
            CpiContext::new_with_signer(system_program::ID, system_program::Transfer { from: vault.clone(), to: a.fee_vault.to_account_info() }, &[vault_seeds]),
            residue,
        )?;
    }

    let (pool_key, cranker) = (a.pool.key(), a.cranker.key());
    let raise_now = p.sol[s];
    let p = &mut ctx.accounts.pair;
    p.pools[s] = pool_key;
    p.sol[s] = 0;
    p.lp_supply_at_creation[s] = pool.lp_supply;
    p.lp_burned[s] = lp;
    p.pool_sol[s] = pool_sol;
    p.pool_tokens[s] = pool_tokens;
    p.tokens_burned[s] = tokens_left;
    let done = p.pools[1 - s] != Pubkey::default();
    if done {
        p.status = STATUS_GRADUATED;
        p.graduated_at = now;
    }
    let ev = SideGraduated {
        pair: pair_key,
        side,
        cranker,
        pool: pool_key,
        raise_lamports: raise_now,
        pool_sol,
        pool_tokens,
        lp_supply_at_creation: pool.lp_supply,
        lp_burned: lp,
        tokens_burned: tokens_left,
        residue_lamports: residue,
        pair_graduated: done,
    };
    emit_cpi!(ev);
    Ok(())
}
