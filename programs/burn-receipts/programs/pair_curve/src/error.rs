use anchor_lang::prelude::*;

#[error_code]
pub enum PairError {
    #[msg("arithmetic overflow")]
    MathOverflow,
    #[msg("side must be 0 (A) or 1 (B)")]
    InvalidSide,
    #[msg("the two mints must differ")]
    SameMint,
    #[msg("pair parameters out of range (virtual reserves, curve supply, reserve, share, target or deadline)")]
    InvalidParams,
    #[msg("a mint must be a classic SPL mint with 6 decimals, zero supply, no freeze authority and the pair's SOL vault as mint authority")]
    InvalidMint,
    #[msg("the burn_receipts TokenConfig is missing, not at its PDA, not buyback mode or not registration policy 2 (pair curve)")]
    InvalidTokenConfig,
    #[msg("the creator must sign and equal the creator recorded in both TokenConfigs")]
    CreatorMismatch,
    #[msg("both TokenConfigs must pin the same LaunchLab platform and cpConfigId, and the accounts passed must be those")]
    PlatformMismatch,
    #[msg("the CPMM AmmConfig is not the pinned one, not CPMM's, or disables pool creation")]
    InvalidAmmConfig,
    #[msg("each side's minimum raise must cover its graduation costs plus 0.01 SOL of liquidity")]
    TargetTooSmall,
    #[msg("the pair is not open")]
    NotOpen,
    #[msg("buys close at the deadline")]
    DeadlinePassed,
    #[msg("sells are closed after graduation (trade on the CPMM pool)")]
    SellsClosed,
    #[msg("the trade would deliver nothing")]
    ZeroOutput,
    #[msg("slippage: the trade delivers less than the minimum")]
    SlippageExceeded,
    #[msg("cannot sell more than the curve has sold")]
    SellExceedsSold,
    #[msg("graduation needs the combined raise at target and each side at its minimum share")]
    NotReadyToGraduate,
    #[msg("graduation is only possible before the deadline")]
    GraduationClosed,
    #[msg("void is only possible at or after the deadline")]
    DeadlineNotReached,
    #[msg("a side's raise does not cover the pool-creation costs")]
    InsufficientPoolSol,
    #[msg("a CPI changed the SOL vault or a vault token account, or took more than its share")]
    VaultTampered,
    #[msg("the CPMM pool does not match what graduate asked for (address, creator, config, mints, vaults, amounts or LP)")]
    PoolMismatch,
    #[msg("close_pair: something is still owed (tokens in circulation, unburned vault tokens or SOL)")]
    NotClosable,
    #[msg("this side's pool already exists")]
    SideAlreadyGraduated,
    #[msg("this build has no Burnticker LaunchLab platform compiled in (mainnet: set BURNTICKER_PLATFORM before deploying)")]
    PlatformNotPinned,
    #[msg("the token vault already holds tokens, a delegate or a close authority")]
    VaultAccountTampered,
    #[msg("nothing to claim, or the developer wallet cannot receive it (executable, or the payment would leave it below rent)")]
    NothingToClaim,
    #[msg("the other side cannot pay for its pool at the current AmmConfig (fee or disabled pool creation)")]
    OtherSideCannotGraduate,
    #[msg("the stuck-side refund needs 3 days since the commit and a pool Raydium actually blocks")]
    NotStuck,
    #[msg("an account passed does not match the pair")]
    AccountMismatch,
    #[msg("lock_lp: the side has no pool yet, or its LP is already locked")]
    NothingToLock,
    #[msg("lock_lp: the lock program did not leave the expected lock (LP moved, Fee Key held by FEE_KEYS, state account)")]
    LockMismatch,
    #[msg("burn_lp: only after LP_LOCK_FALLBACK_SECS (30 days) since the graduation decision with the side's LP still unlocked")]
    LpLockFallbackNotDue,
}
