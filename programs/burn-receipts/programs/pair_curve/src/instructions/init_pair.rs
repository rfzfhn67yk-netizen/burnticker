use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::associated_token::{get_associated_token_address, AssociatedToken};
use anchor_spl::token::{self, Mint, Token, TokenAccount};

use burn_receipts::constants as br;
use burn_receipts::state::TokenConfig;

use crate::constants::*;
use crate::error::PairError;
use crate::events::PairInitialized;
use crate::math::{price_matched_tokens, side_costs, sol_at, CurveParams};
use crate::state::Pair;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct InitPairArgs {
    /// sha256 of the registry's pairId string (also inside both sides' locked rules).
    pub pair_id: [u8; 32],
    pub virtual_sol_lamports: u64,
    pub virtual_token_amount: u64,
    /// Raw tokens each curve may sell; the rest of the 10^15 raw supply is the side's liquidity reserve.
    pub curve_supply: u64,
    /// Combined raise needed to graduate.
    pub target_raise_lamports: u64,
    /// Each side must hold at least this share of the combined raise at graduation (default 2,500 = 25 %).
    pub min_side_share_bps: u16,
    /// Unix time: buys close and graduation becomes impossible at this second; void becomes possible.
    pub deadline: i64,
}

/// CREATION, ONCE PER PAIR. Signed by the payer and the CREATOR recorded in both mints' burn_receipts TokenConfigs (which
/// initialize_token created earlier, mint-signed). Mints the full supply of each coin into its token vault and revokes the mint
/// authority; records the parameters (never writable afterwards).
#[event_cpi]
#[derive(Accounts)]
#[instruction(args: InitPairArgs)]
pub struct InitPair<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub creator: Signer<'info>,
    #[account(mut, constraint = mint_a.key() != mint_b.key() @ PairError::SameMint)]
    pub mint_a: Box<Account<'info, Mint>>,
    #[account(mut)]
    pub mint_b: Box<Account<'info, Mint>>,
    #[account(init, payer = payer, space = 8 + Pair::INIT_SPACE, seeds = [PAIR_SEED, mint_a.key().as_ref(), mint_b.key().as_ref()], bump)]
    pub pair: Box<Account<'info, Pair>>,
    /// The SOL vault (System-owned, no data). Funded here with its rent minimum.
    #[account(mut, seeds = [VAULT_SEED, pair.key().as_ref()], bump)]
    pub vault: SystemAccount<'info>,
    /// ATA(vault, mint A). `init_if_needed`: anyone can create this ATA as soon as tx 1 reveals the vault (it is the mint authority),
    /// and a plain `init` would then fail forever (blind review 2 H-3). The handler requires it empty, with no delegate and no close
    /// authority (only the vault could set either).
    #[account(init_if_needed, payer = payer, associated_token::mint = mint_a, associated_token::authority = vault)]
    pub token_vault_a: Box<Account<'info, TokenAccount>>,
    #[account(init_if_needed, payer = payer, associated_token::mint = mint_b, associated_token::authority = vault)]
    pub token_vault_b: Box<Account<'info, TokenAccount>>,
    /// CHECK: burn_receipts TokenConfig of mint A — owner, PDA, discriminator, mode, policy and creator checked in the handler.
    pub config_a: UncheckedAccount<'info>,
    /// CHECK: as config_a, for mint B.
    pub config_b: UncheckedAccount<'info>,
    /// CHECK: the LaunchLab PlatformConfig both TokenConfigs pinned (key + owner checked); the developer wallet is read from it.
    pub launchlab_platform: UncheckedAccount<'info>,
    /// CHECK: the CPMM AmmConfig both TokenConfigs pinned (key + owner checked); its create-pool fee sizes the graduation costs.
    pub amm_config: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

/// The TokenConfig fields init_pair needs (TokenConfig itself is ~900 bytes; two of them on the SBF stack overflow its 4 KB frame).
pub struct ConfigView {
    pub creator: Pubkey,
    pub ll_platform: Pubkey,
    pub ll_cp_config: Pubkey,
    pub rules_sha256: [u8; 32],
    /// The fee PDA ["fee", mint] (with the stored fee bump).
    pub fee: Pubkey,
}

/// A burn_receipts TokenConfig for `mint`: owned by burn_receipts, at ["config", mint] (its own bump), buyback mode, registration
/// policy POOL_POLICY_PAIR_CURVE. Deserialised in its own frame (never inlined) straight into a Box.
#[inline(never)]
fn load_config(acc: &AccountInfo, mint: &Pubkey) -> Result<ConfigView> {
    require_keys_eq!(*acc.owner, burn_receipts::ID, PairError::InvalidTokenConfig);
    let data = acc.try_borrow_data()?;
    let c: Box<TokenConfig> = Box::new(TokenConfig::try_deserialize(&mut &data[..]).map_err(|_| error!(PairError::InvalidTokenConfig))?);
    require_keys_eq!(c.mint, *mint, PairError::InvalidTokenConfig);
    let expected = Pubkey::create_program_address(&[br::CONFIG_SEED, mint.as_ref(), &[c.bump]], &burn_receipts::ID).map_err(|_| error!(PairError::InvalidTokenConfig))?;
    require_keys_eq!(*acc.key, expected, PairError::InvalidTokenConfig);
    require!(c.rule.mode == br::MODE_BUYBACK && c.registration_policy == br::POOL_POLICY_PAIR_CURVE, PairError::InvalidTokenConfig);
    let fee = Pubkey::create_program_address(&[br::FEE_SEED, mint.as_ref(), &[c.fee_bump]], &burn_receipts::ID).map_err(|_| error!(PairError::InvalidTokenConfig))?;
    Ok(ConfigView { creator: c.creator, ll_platform: c.ll_platform, ll_cp_config: c.ll_cp_config, rules_sha256: c.rules_sha256, fee })
}

fn require_fresh_mint(m: &Mint, vault: &Pubkey) -> Result<()> {
    require!(m.decimals == TOKEN_DECIMALS && m.supply == 0 && m.is_initialized, PairError::InvalidMint);
    require!(m.freeze_authority.is_none(), PairError::InvalidMint);
    require!(m.mint_authority == anchor_lang::solana_program::program_option::COption::Some(*vault), PairError::InvalidMint);
    Ok(())
}

pub fn validate_params(args: &InitPairArgs, now: i64, side_costs: u64) -> Result<()> {
    let p = CurveParams { virtual_sol: args.virtual_sol_lamports, virtual_token: args.virtual_token_amount, curve_supply: args.curve_supply };
    require!(args.virtual_sol_lamports >= MIN_VIRTUAL_SOL_LAMPORTS, PairError::InvalidParams);
    require!(args.curve_supply >= 1 && args.curve_supply < TOTAL_SUPPLY && args.virtual_token_amount > args.curve_supply, PairError::InvalidParams);
    let reserve = TOTAL_SUPPLY - args.curve_supply;
    let reserve_bps = reserve as u128 * BPS_DENOMINATOR as u128 / TOTAL_SUPPLY as u128;
    require!((MIN_RESERVE_BPS as u128..=MAX_RESERVE_BPS as u128).contains(&reserve_bps), PairError::InvalidParams);
    require!((MIN_SIDE_SHARE_BPS..=MAX_SIDE_SHARE_BPS).contains(&args.min_side_share_bps), PairError::InvalidParams);
    require!(args.target_raise_lamports >= MIN_TARGET_RAISE_LAMPORTS, PairError::InvalidParams);
    let duration = args.deadline.checked_sub(now).ok_or(PairError::InvalidParams)?;
    require!((MIN_DURATION_SECS..=MAX_DURATION_SECS).contains(&duration), PairError::InvalidParams);
    // u128 sell-out raise of one side (also bounds every u64 sum in the program).
    let sell_out = (args.virtual_sol_lamports as u128 * args.curve_supply as u128).div_ceil((args.virtual_token_amount - args.curve_supply) as u128);
    require!(sell_out <= MAX_SIDE_RAISE_LAMPORTS as u128, PairError::InvalidParams);
    let sell_out = sol_at(&p, args.curve_supply)?;
    // Reachable: the two sides together can reach the target, and each side can reach its minimum share of it.
    let side_min = args.target_raise_lamports as u128 * args.min_side_share_bps as u128 / BPS_DENOMINATOR as u128;
    require!(2 * sell_out as u128 >= args.target_raise_lamports as u128 && sell_out as u128 >= side_min, PairError::InvalidParams);
    // Each side's minimum raise pays for its pool and leaves liquidity.
    require!(side_min >= side_costs as u128 + MIN_POOL_LIQUIDITY_LAMPORTS as u128, PairError::TargetTooSmall);
    // At sell-out the price-matched pool needs no more than the reserve (it is capped by the vault anyway; this keeps the default
    // path uncapped).
    let need = price_matched_tokens(&p, args.curve_supply, sell_out, u64::MAX)?;
    require!(need <= reserve, PairError::InvalidParams);
    Ok(())
}

pub fn handle_init_pair(ctx: Context<InitPair>, args: InitPairArgs) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let rent = Rent::get()?;
    let a = &ctx.accounts;
    let vault = a.vault.key();
    require_fresh_mint(&a.mint_a, &vault)?;
    require_fresh_mint(&a.mint_b, &vault)?;

    for tv in [&a.token_vault_a, &a.token_vault_b] {
        require!(tv.amount == 0 && tv.delegate.is_none() && tv.close_authority.is_none(), PairError::VaultAccountTampered);
    }
    // Blind review 1 M-1: only Burnticker's own LaunchLab platform (compiled in per build) — the developer wallet is read from it.
    require!(BURNTICKER_PLATFORM != Pubkey::default(), PairError::PlatformNotPinned);
    let ca = load_config(&a.config_a, &a.mint_a.key())?;
    let cb = load_config(&a.config_b, &a.mint_b.key())?;
    let (fee_a, fee_b) = (ca.fee, cb.fee);
    require!(ca.creator == a.creator.key() && cb.creator == a.creator.key(), PairError::CreatorMismatch);
    require!(ca.ll_platform == cb.ll_platform && ca.ll_cp_config == cb.ll_cp_config && ca.ll_cp_config != Pubkey::default(), PairError::PlatformMismatch);

    // The developer wallet: the pinned LaunchLab platform's platformClaimFeeWallet.
    let plat = a.launchlab_platform.to_account_info();
    require_keys_eq!(plat.key(), ca.ll_platform, PairError::PlatformMismatch);
    require_keys_eq!(plat.key(), BURNTICKER_PLATFORM, PairError::PlatformMismatch);
    require_keys_eq!(*plat.owner, br::LAUNCHLAB_PROGRAM_ID, PairError::PlatformMismatch);
    let dev_wallet = {
        let d = plat.try_borrow_data()?;
        require!(d.len() >= br::LL_PLATFORM_MIN_LEN, PairError::PlatformMismatch);
        Pubkey::new_from_array(d[LL_PLATFORM_CLAIM_FEE_WALLET..LL_PLATFORM_CLAIM_FEE_WALLET + 32].try_into().expect("32 bytes"))
    };
    // Never one of the pair's own accounts (a duplicate writable account would make every trade fail).
    require!(dev_wallet != Pubkey::default() && dev_wallet != a.vault.key() && dev_wallet != fee_a && dev_wallet != fee_b, PairError::PlatformMismatch);

    // The pinned AmmConfig: CPMM's, pool creation enabled; its fee sizes each side's graduation costs.
    let amm = a.amm_config.to_account_info();
    require_keys_eq!(amm.key(), ca.ll_cp_config, PairError::InvalidAmmConfig);
    let create_pool_fee = {
        require_keys_eq!(*amm.owner, br::CPMM_PROGRAM_ID, PairError::InvalidAmmConfig);
        let d = amm.try_borrow_data()?;
        require!(d.len() >= burn_receipts::cpmm::AMM_CONFIG_LEN && d[..8] == burn_receipts::cpmm::AMM_CONFIG_DISCRIMINATOR, PairError::InvalidAmmConfig);
        require!(d[AMM_CONFIG_DISABLE_CREATE_POOL] == 0, PairError::InvalidAmmConfig);
        u64::from_le_bytes(d[AMM_CONFIG_CREATE_POOL_FEE..AMM_CONFIG_CREATE_POOL_FEE + 8].try_into().expect("8 bytes"))
    };
    validate_params(&args, now, side_costs(&rent, create_pool_fee))?;

    // Fund the SOL vault to its rent minimum (it may already hold lamports: anyone can send SOL to an address).
    let vault_rent = rent.minimum_balance(0);
    let have = a.vault.lamports();
    if have < vault_rent {
        system_program::transfer(
            CpiContext::new(system_program::ID, system_program::Transfer { from: a.payer.to_account_info(), to: a.vault.to_account_info() }),
            vault_rent - have,
        )?;
    }

    // Mint the full supply of each coin into its token vault, then revoke the mint authority (the vault PDA signs).
    let pair_key = a.pair.key();
    let vault_seeds: &[&[u8]] = &[VAULT_SEED, pair_key.as_ref(), &[ctx.bumps.vault]];
    for (mint, dest) in [(&a.mint_a, &a.token_vault_a), (&a.mint_b, &a.token_vault_b)] {
        token::mint_to(
            CpiContext::new_with_signer(token::ID, token::MintTo { mint: mint.to_account_info(), to: dest.to_account_info(), authority: a.vault.to_account_info() }, &[vault_seeds]),
            TOTAL_SUPPLY,
        )?;
        token::set_authority(
            CpiContext::new_with_signer(token::ID, token::SetAuthority { current_authority: a.vault.to_account_info(), account_or_mint: mint.to_account_info() }, &[vault_seeds]),
            token::spl_token::instruction::AuthorityType::MintTokens,
            None,
        )?;
    }

    let pool_bump = |side: u8| Pubkey::find_program_address(&[POOL_SEED, pair_key.as_ref(), &[side]], &crate::ID).1;
    let (mint_a, mint_b) = (a.mint_a.key(), a.mint_b.key());
    let (tva, tvb) = (a.token_vault_a.key(), a.token_vault_b.key());
    let creator = a.creator.key();
    let p = &mut ctx.accounts.pair;
    p.version = 1;
    p.bump = ctx.bumps.pair;
    p.vault_bump = ctx.bumps.vault;
    p.status = STATUS_OPEN;
    p.mints = [mint_a, mint_b];
    p.pools = [Pubkey::default(); 2];
    p.lp_supply_at_creation = [0; 2];
    p.lp_burned = [0; 2];
    p.cp_config = ca.ll_cp_config;
    p.vault = vault;
    p.creator = creator;
    p.dev_wallet = dev_wallet;
    p.ll_platform = ca.ll_platform;
    p.fee_vaults = [fee_a, fee_b];
    p.token_vaults = [tva, tvb];
    p.vault_wsol = get_associated_token_address(&vault, &br::NATIVE_MINT);
    p.pool_bumps = [pool_bump(SIDE_A), pool_bump(SIDE_B)];
    p.pair_id = args.pair_id;
    p.rules_sha256_a = ca.rules_sha256;
    p.rules_sha256_b = cb.rules_sha256;
    p.virtual_sol_lamports = args.virtual_sol_lamports;
    p.virtual_token_amount = args.virtual_token_amount;
    p.curve_supply = args.curve_supply;
    p.reserve_supply = TOTAL_SUPPLY - args.curve_supply;
    p.target_raise_lamports = args.target_raise_lamports;
    p.min_side_share_bps = args.min_side_share_bps;
    p.deadline = args.deadline;
    p.created_at = now;
    p.sold = [0; 2];
    p.sol = [0; 2];
    p.volume_lamports = [0; 2];
    p.burn_fees_lamports = [0; 2];
    p.dev_fees_lamports = [0; 2];
    p.trades = [0; 2];
    p.graduated_at = 0;
    p.voided_at = 0;
    p.pool_sol = [0; 2];
    p.pool_tokens = [0; 2];
    p.tokens_burned = [0; 2];
    p.reserved = [0; 64];

    emit_cpi!(PairInitialized {
        pair: pair_key,
        mint_a,
        mint_b,
        creator,
        vault,
        dev_wallet,
        fee_vault_a: fee_a,
        fee_vault_b: fee_b,
        ll_platform: p.ll_platform,
        cp_config: p.cp_config,
        pair_id: args.pair_id,
        rules_sha256_a: p.rules_sha256_a,
        rules_sha256_b: p.rules_sha256_b,
        virtual_sol_lamports: args.virtual_sol_lamports,
        virtual_token_amount: args.virtual_token_amount,
        curve_supply: args.curve_supply,
        reserve_supply: p.reserve_supply,
        target_raise_lamports: args.target_raise_lamports,
        min_side_share_bps: args.min_side_share_bps,
        deadline: args.deadline,
    });
    Ok(())
}
