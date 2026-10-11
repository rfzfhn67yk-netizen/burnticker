use anchor_lang::prelude::*;

#[error_code]
pub enum BurnError {
    #[msg("rule: invalid mode")]
    InvalidMode,
    #[msg("rule: invalid parameter")]
    InvalidRule,
    #[msg("feed id must be 1-32 printable ASCII bytes without '|'")]
    InvalidFeedId,
    #[msg("memo prefix must be 2-12 capitals/digits; memo source 1-64 printable ASCII bytes without '|'")]
    InvalidMemoText,
    #[msg("attesters: 1-5 distinct, non-default ed25519 keys with a known kind tag; 1 <= quorum <= min(count, 3)")]
    InvalidAttesters,
    #[msg("reserve_lamports must be at least the rent-exempt minimum of the fee PDA")]
    ReserveBelowRent,
    #[msg("record_date is not a valid YYYYMMDD date")]
    InvalidDate,
    #[msg("record_date is in the future")]
    FutureDate,
    #[msg("record_date is not after the last accepted reading")]
    StaleReading,
    #[msg("a reading for this date already exists with a different value")]
    ConflictingReading,
    #[msg("value out of range")]
    InvalidValue,
    #[msg("not enough attester signatures over the canonical message")]
    QuorumNotMet,
    #[msg("malformed ed25519 instruction (offsets must point into the ed25519 instruction itself)")]
    BadEd25519Instruction,
    #[msg("reading already processed")]
    AlreadyProcessed,
    #[msg("readings are processed in order: an earlier reading is still pending")]
    OutOfOrder,
    #[msg("this reading has units; use the mode's crank")]
    HasUnits,
    #[msg("this reading has no units to burn")]
    NoUnits,
    #[msg("instruction does not match the token's mode")]
    WrongMode,
    #[msg("the CPMM pool is not registered yet")]
    PoolNotRegistered,
    #[msg("the CPMM pool is already registered")]
    PoolAlreadyRegistered,
    #[msg("pool policy does not allow this")]
    WrongPoolPolicy,
    #[msg("account is not the expected Raydium CPMM account")]
    InvalidCpmmAccount,
    #[msg("pool is not WSOL/<mint> on the SPL Token program")]
    InvalidPoolMints,
    #[msg("pool creator is not this token's fee PDA")]
    PoolCreatorMismatch,
    #[msg("pool swaps are disabled or not open yet")]
    PoolNotTradable,
    #[msg("pool reserves are empty")]
    EmptyReserves,
    #[msg("the pool's spot price deviates from its recent TWAP beyond the rule's tolerance; crank later")]
    TwapDeviation,
    #[msg("no oracle observation old enough for the TWAP window; crank later")]
    TwapUnavailable,
    #[msg("the swap would return zero tokens")]
    ZeroOutput,
    #[msg("math overflow")]
    MathOverflow,
    #[msg("memo exceeds the 566-byte ceiling")]
    MemoTooLong,
    #[msg("only the admin may do this")]
    NotAdmin,
    #[msg("admin has been renounced")]
    AdminRenounced,
    #[msg("no attester change is pending")]
    NoPendingChange,
    #[msg("the attester change timelock has not elapsed")]
    TimelockNotElapsed,
    #[msg("mint must be an SPL Token (classic) mint")]
    UnsupportedMint,
    #[msg("the quorum may never be lowered")]
    QuorumLowered,
    #[msg("only the program's upgrade authority may create the platform config")]
    NotUpgradeAuthority,
    #[msg("the cap sunset must be in the future, at most 365 days away and no later than the default sunset (2027-10-01)")]
    InvalidSunset,
    #[msg("the burn-pool cap can only be raised")]
    CapNotRaised,
    #[msg("a proposed attester set must keep at least `quorum` current keys (≥ 7 days old when it adds keys) and add fewer new keys than the new quorum")]
    TooManyAttestersReplaced,
    #[msg("the config authority (admin) must be given explicitly at init")]
    AdminRequired,
    #[msg("the mint still has a mint authority (supply could be inflated)")]
    MintAuthorityRetained,
    #[msg("the mint still has a freeze authority (the program's token accounts could be frozen)")]
    FreezeAuthorityRetained,
    #[msg("the fee PDA's lamport reserve would be breached")]
    ReserveBreached,
    #[msg("the registered pool has not been untradeable for the full replacement delay")]
    PoolStillTradeable,
    #[msg("the replacement must be a different pool")]
    SamePool,
    #[msg("the LaunchLab claim moved value out of the fee PDA or its WSOL account")]
    ClaimOutflow,
    #[msg("account is not the expected Raydium LaunchLab account")]
    InvalidLaunchLabAccount,
    #[msg("not the SPL Memo program")]
    InvalidMemoProgram,
    #[msg("less than the required share of the pool's live LP is burned or locked (50 % at registration, 90 % for a policy fallback pool)")]
    LpNotLocked,
    #[msg("not LaunchLab's migration pool for this token (LaunchLab pool, platform cpConfigId and the CPMM pool PDA must agree)")]
    NotMigrationPool,
    #[msg("pool policy 0 needs the token's LaunchLab pool and platform accounts")]
    LaunchLabAccountsRequired,
    #[msg("the pool has not passed register_pool's provenance checks")]
    PoolNotVerified,
    #[msg("the fee PDA's WSOL balance moved by something other than the swap; crank again")]
    WsolBalanceMismatch,
    #[msg("the LaunchLab claim takes no extra accounts")]
    UnexpectedAccounts,
    #[msg("a CPI changed the fee PDA's owner/data/lamports or a fee-PDA token account's owner, mint, delegate or close authority")]
    FeeAccountTampered,
    #[msg("the CPMM pool's output vault did not pay exactly the tokens the fee PDA received")]
    SwapOutputMismatch,
    #[msg("policy 0 needs the LaunchLab platform account at initialize_token")]
    LaunchLabPlatformRequired,
    #[msg("the LaunchLab platform does not allow this token's registration (platformCpCreator or LP lock/burn scales)")]
    PlatformNotAllowed,
    #[msg("check_pool_health / replace_pool must be top-level and may not share a transaction with an instruction touching the pool, its vaults or its observation account")]
    PoolTouchedInTransaction,
    #[msg("only a key on the platform's cranker allowlist may crank buybacks while the pre-audit cap is in force")]
    CrankerNotAllowed,
    #[msg("the registration-policy switch is not allowed now (pool working, cap sunset passed, or nothing pending)")]
    PolicySwitchNotAllowed,
    #[msg("the burn-pool cap at initialize_platform must equal the default (raise only afterwards)")]
    CapNotDefault,
    #[msg("the pending registration-policy proposal expired (14 days after it was proposed); propose again")]
    PolicyProposalExpired,
    #[msg("only a current attester may veto a pending registration-policy proposal")]
    NotAttester,
    #[msg("the account is not a pair_curve Pair (owner, discriminator, length or address)")]
    InvalidPairAccount,
    #[msg("the pair has not graduated")]
    PairNotGraduated,
    #[msg("the pool is not the pair_curve pool of this mint (Pair record, pair_curve PDA or pinned cpConfigId)")]
    NotPairPool,
    #[msg("the operator treasury is not compiled into this build (mainnet placeholder): claim_lock_fees is disabled; the fees stay in the lock")]
    TreasuryNotPinned,
    #[msg("the account is not the lock program's LockedCpLiquidityState for this pool / Fee Key (owner, discriminator, PDA, pool or LP mint)")]
    InvalidLockAccount,
    #[msg("the Fee Key NFT is not held by the program's fee_keys PDA")]
    FeeKeyNotHeld,
    #[msg("the lock position holds no majority of the pool's LP")]
    LockNotMajority,
    #[msg("the Fee Key account, lock position or pool does not match this mint's registered record")]
    FeeKeyMismatch,
    #[msg("this build pins no Burnticker LaunchLab platform (mainnet placeholder): policy 0/2 tokens cannot be initialised until the owner's platform is compiled in")]
    PlatformNotPinned,
    #[msg("the lock position was not made by the pool's own locker (LaunchLab's migration authority, or the pair's vault)")]
    LockerMismatch,
    #[msg("policy 0: register the coin's LP-lock Fee Key (register_fee_key) before register_pool — the pool is verified only when its LP fees reach the burn")]
    FeeKeyNotRegistered,
    #[msg("pair: the partner mint is invalid (itself, empty, or a vault-mode token)")]
    InvalidPairMint,
    #[msg("pair: the accounts do not form a pair (PairLink / partner config / pair_curve Pair do not name each other)")]
    PairMismatch,
    #[msg("pair: the partner named this mint after its pairing window closed, or the coin is already linked to another partner")]
    PairingClosed,
    #[msg("pair: the two coins are not paired to each other")]
    NotPaired,
    #[msg("pair: policy 2 — run link_pair (the pair_curve Pair witnesses both mints) before register_pair_pool")]
    PairNotLinked,
    #[msg("pair result: pass the configs in byte order of their mints (mint_lo first)")]
    PairOrder,
    #[msg("pair result: the winner must be one of the two mints, or Pubkey::default() for a draw")]
    InvalidWinner,
    #[msg("pair result: a different result is already recorded for this period")]
    ConflictingPairResult,
    #[msg("this coin LOST the period's pair result: its fuel goes to the winner with forward_to_winner, not crank_buyback")]
    ForwardRequired,
    #[msg("a paired coin's crank waits for the period's pair result (or PAIR_RESULT_GRACE_SECS after the reading); retry later")]
    PairResultPending,
    #[msg("the account is not this period's PairResult for this pair")]
    InvalidPairResult,
    #[msg("forward_to_winner: the period's result is a draw (nothing is forwarded) or names the other coin")]
    NotWinner,
    #[msg("forward_to_winner: both coins must be live (a verified pool) — a voided or unregistered side forwards nothing")]
    PairSideNotLive,
    #[msg("pair result: a winner needs both coins' readings for the date and the loser's still unprocessed")]
    PairResultNotServable,
    #[msg("pair result: the date is before the coins were paired")]
    PairDateBeforePairing,
    #[msg("link_pair: a coin already has readings under its unpaired rule; pairs are linked before their first reading")]
    PairHasReadings,
    #[msg("unlink_pair: no on-chain evidence that the partner can never be live (Pair voided / side refunding, or no verified pool 30 days after pairing)")]
    PairStillLive,
}
