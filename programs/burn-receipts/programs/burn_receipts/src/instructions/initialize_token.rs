use anchor_lang::prelude::*;
use anchor_lang::system_program;

use crate::constants::*;
use crate::error::BurnError;
use crate::events::TokenInitialized;
use crate::state::{AttesterEntry, RuleParams, TokenConfig};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitializeTokenArgs {
    /// e.g. "treasury.debt_to_penny" — part of every attestation message.
    pub feed_id: String,
    /// The memo's rule key, e.g. "DEBT" (never the ticker).
    pub memo_prefix: String,
    /// The memo's `src=` text, e.g. "fiscaldata.treasury.gov debt_to_penny".
    pub memo_source: String,
    /// sha256 of the published rules file's exact bytes.
    pub rules_sha256: [u8; 32],
    pub rule: RuleParams,
    /// 1-5 attesters (ed25519 keys with a kind tag); `quorum` of them must sign every reading.
    pub attesters: Vec<AttesterEntry>,
    pub quorum: u8,
    /// POOL_POLICY_FIXED only: the CPMM pool address (creator trust; it must pass register_pool's creator + LP checks before any
    /// buyback, and is validated at every crank). Pubkey::default() otherwise.
    pub fixed_pool: Pubkey,
    /// The config authority (attester proposals only; renounceable) — the Squads 2-of-3 vault. Mandatory (review L-2).
    pub admin: Pubkey,
}

#[event_cpi]
#[derive(Accounts)]
#[instruction(args: InitializeTokenArgs)]
pub struct InitializeToken<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// Recorded as creator and initial admin.
    pub creator: Signer<'info>,
    /// CHECK: the mint ADDRESS. It must SIGN, so only the holder of the mint keypair (the launchpad, in the same flow that creates
    /// the token) can create the one config this mint will ever have. The mint account need not exist yet (LaunchLab creates it in
    /// the next instruction); it is validated as an SPL Token mint at every crank.
    pub mint: Signer<'info>,
    #[account(
        init,
        payer = payer,
        space = 8 + TokenConfig::INIT_SPACE,
        seeds = [CONFIG_SEED, mint.key().as_ref()],
        bump
    )]
    pub config: Box<Account<'info, TokenConfig>>,
    /// The fee PDA (system-owned, no data). Funded here with the rule's reserve so that fee transfers of any size can land in it.
    #[account(mut, seeds = [FEE_SEED, mint.key().as_ref()], bump)]
    pub fee_vault: SystemAccount<'info>,
    pub system_program: Program<'info, System>,
    /// CHECK: buyback + pool policy 0: the LaunchLab PlatformConfig the token launches on (owner LaunchLab). Its cpConfigId, LP
    /// lock/burn scales and platformCpCreator are read and PINNED here (review-3 M-3). Omitted otherwise.
    pub launchlab_platform: Option<UncheckedAccount<'info>>,
}

/// Review-3 M-3: (platform, cpConfigId, lock+burn scales in 10⁻⁶) read from a LaunchLab PlatformConfig and checked: the AmmConfig is
/// set, platformCpCreator is unset or the fee PDA (anything else would become the migrated pool's creator and strand registration),
/// and at least half of the migrated LP is locked or burned.
pub fn pin_launchlab_platform(acc: &AccountInfo, fee_pda: &Pubkey) -> Result<(Pubkey, Pubkey, u64)> {
    require_keys_eq!(*acc.owner, LAUNCHLAB_PROGRAM_ID, BurnError::InvalidLaunchLabAccount);
    let d = acc.try_borrow_data()?;
    require!(d.len() >= LL_PLATFORM_MIN_LEN, BurnError::InvalidLaunchLabAccount);
    let key = |at: usize| Pubkey::new_from_array(d[at..at + 32].try_into().expect("32 bytes"));
    let u64_at = |at: usize| u64::from_le_bytes(d[at..at + 8].try_into().expect("8 bytes"));
    let cp_config = key(LL_PLATFORM_CP_CONFIG_ID);
    let cp_creator = key(LL_PLATFORM_CP_CREATOR);
    let scales = u64_at(LL_PLATFORM_SCALES).saturating_add(u64_at(LL_PLATFORM_SCALES + 8)).saturating_add(u64_at(LL_PLATFORM_SCALES + 16));
    require!(cp_config != Pubkey::default(), BurnError::PlatformNotAllowed);
    require!(cp_creator == Pubkey::default() || cp_creator == *fee_pda, BurnError::PlatformNotAllowed);
    require!((MIN_LL_LOCK_SCALE_PPM..=LL_SCALE_DENOMINATOR).contains(&scales), BurnError::PlatformNotAllowed);
    Ok((*acc.key, cp_config, scales))
}

/// LAUNCHPAD-PATH §35, policy 0 (LaunchLab migrations): the platform must lock 100 % of the migrated LP (platformScale =
/// 1,000,000, creatorScale = burnScale = 0) and send the Fee Key to this program's FEE_KEYS PDA (platformLockNftWallet), so
/// claim_lock_fees can collect the LP fees. The platform admin can change these fields later (D-3): the launch gate
/// (verify-platform-pins) re-reads them immediately before LaunchLab's create.
pub fn require_platform_locks_to_fee_keys(acc: &AccountInfo) -> Result<()> {
    let d = acc.try_borrow_data()?;
    let u64_at = |at: usize| u64::from_le_bytes(d[at..at + 8].try_into().expect("8 bytes"));
    let nft_wallet = Pubkey::new_from_array(d[LL_PLATFORM_LOCK_NFT_WALLET..LL_PLATFORM_LOCK_NFT_WALLET + 32].try_into().expect("32 bytes"));
    let (fee_keys, _) = Pubkey::find_program_address(&[FEE_KEYS_SEED], &crate::ID);
    require_keys_eq!(nft_wallet, fee_keys, BurnError::PlatformNotAllowed);
    require!(u64_at(LL_PLATFORM_SCALES) == REQUIRED_LL_PLATFORM_SCALE_PPM, BurnError::PlatformNotAllowed);
    require!(u64_at(LL_PLATFORM_SCALES + 8) == 0 && u64_at(LL_PLATFORM_SCALES + 16) == 0, BurnError::PlatformNotAllowed);
    Ok(())
}

fn ascii_text(s: &str, max: usize) -> bool {
    !s.is_empty() && s.len() <= max && s.bytes().all(|b| (0x20..0x7f).contains(&b) && b != b'|')
}

pub fn validate_rule(rule: &RuleParams, rent_min_fee_pda: u64) -> Result<()> {
    require!(rule.mode == MODE_BUYBACK || rule.mode == MODE_VAULT, BurnError::InvalidMode);
    require!(rule.carry_rule == CARRY_CONSECUTIVE || rule.carry_rule == CARRY_NONE, BurnError::InvalidRule);
    require!(rule.value_decimals <= 9, BurnError::InvalidRule);
    require!(rule.unit_value > 0, BurnError::InvalidRule);
    require!(rule.max_abs_delta >= rule.unit_value && rule.max_abs_delta <= i64::MAX as u64, BurnError::InvalidRule);
    if rule.mode == MODE_BUYBACK {
        require!(rule.fraction_per_unit_bps >= 1 && rule.fraction_per_unit_bps as u128 <= BPS_DENOMINATOR, BurnError::InvalidRule);
        // Review-2 F1: slippage is the whole sandwich budget now (min-out = max(spot, TWAP) quote less slippage), so it is capped.
        require!(rule.slippage_bps <= MAX_SLIPPAGE_BPS, BurnError::InvalidRule);
        // Review-2 F7: a positive floor, so a dust spend is below-floor, never a zero-output swap.
        require!(rule.floor_lamports > 0, BurnError::InvalidRule);
        // Review H-1 / L-7: the TWAP guard is mandatory, tight, and its window fits CPMM's 100-entry oracle ring.
        require!(rule.max_twap_deviation_bps >= 1 && rule.max_twap_deviation_bps <= MAX_TWAP_DEVIATION_BPS, BurnError::InvalidRule);
        require!(rule.twap_window_secs >= MIN_TWAP_WINDOW_SECS && rule.twap_window_secs <= MAX_TWAP_WINDOW_SECS, BurnError::InvalidRule);
        // Review-2 F1: both tolerances cover the oracle's conservative 15-second bucket margin (constants.rs).
        require!(
            (rule.max_twap_deviation_bps as u32) * rule.twap_window_secs >= TWAP_BUCKET_TOLERANCE_BPS_SECS
                && (rule.slippage_bps as u32) * rule.twap_window_secs >= TWAP_BUCKET_TOLERANCE_BPS_SECS,
            BurnError::InvalidRule
        );
        require!(
            rule.pool_policy == POOL_POLICY_CREATOR_IS_FEE_PDA || rule.pool_policy == POOL_POLICY_FIXED || rule.pool_policy == POOL_POLICY_PAIR_CURVE,
            BurnError::InvalidRule
        );
        require!(rule.tokens_per_unit == 0 && rule.vault_allocation == 0, BurnError::InvalidRule);
        require!(rule.reserve_lamports >= rent_min_fee_pda, BurnError::ReserveBelowRent);
    } else {
        require!(rule.tokens_per_unit > 0, BurnError::InvalidRule);
        require!(
            rule.fraction_per_unit_bps == 0 && rule.slippage_bps == 0 && rule.max_twap_deviation_bps == 0 && rule.twap_window_secs == 0 && rule.floor_lamports == 0,
            BurnError::InvalidRule
        );
        // Review I-4: a vault-mode fee PDA has no spend path, so it is not funded at all.
        require!(rule.reserve_lamports == 0, BurnError::InvalidRule);
        // Review L-4: the largest possible day (max_abs_delta / unit_value + 1 units) must fit in u64 raw tokens.
        let max_units = (rule.max_abs_delta / rule.unit_value) as u128 + 1;
        require!(max_units.checked_mul(rule.tokens_per_unit as u128).map(|x| x <= u64::MAX as u128).unwrap_or(false), BurnError::InvalidRule);
    }
    Ok(())
}

/// 1-5 distinct, non-default ed25519 keys with a known kind tag, and 1 <= quorum <= min(count, MAX_QUORUM = 3) (review-2 F4: a
/// quorum of 4-5 cannot post a reading in a legacy transaction, and the quorum can never be lowered).
pub fn validate_attesters(attesters: &[AttesterEntry], quorum: u8) -> Result<()> {
    require!(!attesters.is_empty() && attesters.len() <= MAX_ATTESTERS, BurnError::InvalidAttesters);
    require!((1..=MAX_QUORUM).contains(&quorum) && (quorum as usize) <= attesters.len(), BurnError::InvalidAttesters);
    for (i, a) in attesters.iter().enumerate() {
        require!(a.key != Pubkey::default(), BurnError::InvalidAttesters);
        require!(a.kind <= ATTESTER_ORACLE, BurnError::InvalidAttesters);
        require!(!attesters[..i].iter().any(|b| b.key == a.key), BurnError::InvalidAttesters);
    }
    Ok(())
}

/// sha256(GOVERNANCE_HASH_DOMAIN ‖ admin ‖ quorum ‖ (kind ‖ key) per attester) — one value an indexer can compare against the
/// published governance (review-2 F11).
pub fn governance_hash(admin: &Pubkey, quorum: u8, attesters: &[AttesterEntry]) -> [u8; 32] {
    let mut parts: Vec<u8> = Vec::with_capacity(33 + attesters.len() * 33);
    parts.extend_from_slice(admin.as_ref());
    parts.push(quorum);
    for a in attesters {
        parts.push(a.kind);
        parts.extend_from_slice(a.key.as_ref());
    }
    solana_sha256_hasher::hashv(&[GOVERNANCE_HASH_DOMAIN, &parts]).to_bytes()
}

pub fn handle_initialize_token(ctx: Context<InitializeToken>, args: InitializeTokenArgs) -> Result<()> {
    let rent_min = Rent::get()?.minimum_balance(0);
    validate_rule(&args.rule, rent_min)?;
    validate_attesters(&args.attesters, args.quorum)?;
    require!(ascii_text(&args.feed_id, MAX_FEED_ID_LEN), BurnError::InvalidFeedId);
    require!(
        args.memo_prefix.len() >= 2 && args.memo_prefix.len() <= MAX_MEMO_PREFIX_LEN && args.memo_prefix.bytes().all(|b| b.is_ascii_uppercase() || b.is_ascii_digit()),
        BurnError::InvalidMemoText
    );
    require!(ascii_text(&args.memo_source, MAX_MEMO_SOURCE_LEN), BurnError::InvalidMemoText);
    if args.rule.mode == MODE_BUYBACK && args.rule.pool_policy == POOL_POLICY_FIXED {
        require!(args.fixed_pool != Pubkey::default(), BurnError::WrongPoolPolicy);
    } else {
        require!(args.fixed_pool == Pubkey::default(), BurnError::WrongPoolPolicy);
    }

    // Review L-2: the config authority is explicit (the Squads vault), never an implicit default.
    require!(args.admin != Pubkey::default(), BurnError::AdminRequired);
    // Policy 2 (pair curve) pins the platform exactly like policy 0: its cpConfigId is the AmmConfig pair_curve's pools must use.
    let pins_platform = args.rule.pool_policy == POOL_POLICY_CREATOR_IS_FEE_PDA || args.rule.pool_policy == POOL_POLICY_PAIR_CURVE;
    let (ll_platform, ll_cp_config, ll_lock_scale_ppm) = if args.rule.mode == MODE_BUYBACK && pins_platform {
        let Some(p) = ctx.accounts.launchlab_platform.as_ref() else {
            return err!(BurnError::LaunchLabPlatformRequired);
        };
        // lp-lock blind review RL-3: only the operator's own platform (compiled per cluster; its admin under the Squads vault) — a
        // creator-controlled platform's admin could redirect the LP-lock Fee Key, and with it the LP fees, before migration.
        require!(BURNTICKER_PLATFORM != Pubkey::default(), BurnError::PlatformNotPinned);
        require_keys_eq!(p.key(), BURNTICKER_PLATFORM, BurnError::PlatformNotAllowed);
        let pins = pin_launchlab_platform(&p.to_account_info(), &ctx.accounts.fee_vault.key())?;
        if args.rule.pool_policy == POOL_POLICY_CREATOR_IS_FEE_PDA {
            require_platform_locks_to_fee_keys(&p.to_account_info())?;
        }
        pins
    } else {
        (Pubkey::default(), Pubkey::default(), 0)
    };
    let mint = ctx.accounts.mint.key();
    let rule_bytes = anchor_lang::prelude::borsh::to_vec(&args.rule)?;
    let params_hash = solana_sha256_hasher::hashv(&[
        PARAMS_HASH_DOMAIN,
        mint.as_ref(),
        &rule_bytes,
        args.feed_id.as_bytes(),
        b"|",
        args.memo_prefix.as_bytes(),
        b"|",
        args.memo_source.as_bytes(),
        &args.rules_sha256,
    ])
    .to_bytes();

    // Fund the fee PDA up to the reserve (it may already hold lamports: anyone can send SOL to an address).
    let have = ctx.accounts.fee_vault.lamports();
    if have < args.rule.reserve_lamports {
        system_program::transfer(
            CpiContext::new(
                system_program::ID,
                system_program::Transfer { from: ctx.accounts.payer.to_account_info(), to: ctx.accounts.fee_vault.to_account_info() },
            ),
            args.rule.reserve_lamports - have,
        )?;
    }

    let c = &mut ctx.accounts.config;
    c.version = 1;
    c.bump = ctx.bumps.config;
    c.fee_bump = ctx.bumps.fee_vault;
    c.has_baseline = false;
    c.mint = mint;
    c.creator = ctx.accounts.creator.key();
    c.admin = args.admin;
    c.rule = args.rule;
    c.rules_sha256 = args.rules_sha256;
    c.params_hash = params_hash;
    c.feed_id = [0u8; MAX_FEED_ID_LEN];
    c.feed_id[..args.feed_id.len()].copy_from_slice(args.feed_id.as_bytes());
    c.feed_id_len = args.feed_id.len() as u8;
    c.memo_prefix = [0u8; MAX_MEMO_PREFIX_LEN];
    c.memo_prefix[..args.memo_prefix.len()].copy_from_slice(args.memo_prefix.as_bytes());
    c.memo_prefix_len = args.memo_prefix.len() as u8;
    c.memo_source = [0u8; MAX_MEMO_SOURCE_LEN];
    c.memo_source[..args.memo_source.len()].copy_from_slice(args.memo_source.as_bytes());
    c.memo_source_len = args.memo_source.len() as u8;
    c.attesters = [AttesterEntry::default(); MAX_ATTESTERS];
    c.attesters[..args.attesters.len()].copy_from_slice(&args.attesters);
    c.attester_count = args.attesters.len() as u8;
    c.quorum = args.quorum;
    c.pending_attesters = [AttesterEntry::default(); MAX_ATTESTERS];
    c.pending_count = 0;
    c.pending_quorum = 0;
    c.pending_eta = 0;
    c.cpmm_pool = args.fixed_pool;
    c.last_record_date = 0;
    c.last_value = 0;
    c.carry = 0;
    c.crank_cursor = 0;
    c.readings = 0;
    c.burns = 0;
    c.total_burned = 0;
    c.total_spent_lamports = 0;
    c.shortfall = 0;
    c.created_at = Clock::get()?.unix_timestamp;
    c.carried_spend_lamports = 0;
    c.pool_untradeable_since = 0;
    c.pool_untradeable_last_seen = 0;
    c.pool_verified = false;
    c.cluster_genesis = CLUSTER_GENESIS_HASH;
    c.registration_policy = args.rule.pool_policy;
    c.ll_platform = ll_platform;
    c.ll_cp_config = ll_cp_config;
    c.ll_lock_scale_ppm = ll_lock_scale_ppm;
    c.pool_untradeable_candidate_at = 0;
    c.attester_added_at = [0i64; MAX_ATTESTERS];
    let joined = c.created_at;
    for t in c.attester_added_at[..args.attesters.len()].iter_mut() {
        *t = joined;
    }
    c.pending_policy = 0;
    c.pending_policy_pool = Pubkey::default();
    c.pending_policy_eta = 0;
    c.reserved = [0u8; 23];

    let config_key = c.key();
    let creator = c.creator;
    let governance_hash = governance_hash(&args.admin, args.quorum, &args.attesters);
    emit_cpi!(TokenInitialized {
        config: config_key,
        mint,
        creator,
        fee_vault: ctx.accounts.fee_vault.key(),
        rule: args.rule,
        rules_sha256: args.rules_sha256,
        params_hash,
        feed_id: args.feed_id.clone(),
        memo_prefix: args.memo_prefix.clone(),
        memo_source: args.memo_source.clone(),
        attesters: args.attesters.clone(),
        quorum: args.quorum,
        cpmm_pool: args.fixed_pool,
        admin: args.admin,
        governance_hash,
        cluster_genesis: CLUSTER_GENESIS_HASH,
        ll_platform,
        ll_cp_config,
    });
    Ok(())
}
