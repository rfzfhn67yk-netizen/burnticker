import { type AccountMeta, PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, CPMM_PROGRAM_ID, type Cluster, LAUNCHLAB_PROGRAM_ID, MEMO_PROGRAM_ID, NATIVE_MINT, SYSVAR_INSTRUCTIONS_ID, TOKEN_PROGRAM_ID } from "@/lib/burnReceipts/constants";
import type { BuybackPoolAccounts } from "@/lib/burnReceipts/cpmm";
import { BURN_RECEIPTS_IDL } from "@/lib/burnReceipts/idl";
import { encodeInstruction } from "@/lib/burnReceipts/idlCoder";
import type { RuleParams } from "@/lib/burnReceipts/math";
import { configPda, feePda, feeTokenAddress, feeWsolAddress, launchlabCreatorFeeVault, launchlabPoolPda, launchlabVaultAuthority, lpLockVault, platformPda, programDataAddress, readingPda, vaultAddress } from "@/lib/burnReceipts/pda";

/**
 * Instruction builders. Data comes from the IDL coder; account ORDER and writable/signer flags come from the IDL too (each builder
 * only names the accounts), so a builder cannot drift from the program.
 */

const IDL = BURN_RECEIPTS_IDL;

/** Anchor's event-CPI authority: every instruction carries it (and the program itself) so events ride in inner instructions. */
export const eventAuthority = (programId: PublicKey): PublicKey => PublicKey.findProgramAddressSync([Buffer.from("__event_authority", "utf8")], programId)[0];

function build(programId: PublicKey, name: string, accounts: Record<string, PublicKey>, args: Record<string, unknown>, remaining: AccountMeta[] = []): TransactionInstruction {
  const ix = IDL.instructions.find((i) => i.name === name);
  if (!ix) throw new Error(`IDL has no instruction ${name}`);
  const auto: Record<string, PublicKey> = { event_authority: eventAuthority(programId), program: programId, platform: platformPda(programId), instructions: SYSVAR_INSTRUCTIONS_ID };
  const keys: AccountMeta[] = ix.accounts.map((a) => {
    const given = accounts[a.name] ?? auto[a.name] ?? (a.address ? new PublicKey(a.address) : undefined);
    // Anchor's convention for an omitted optional account: the program id in its slot (read-only, not a signer).
    if (!given && a.optional) return { pubkey: programId, isSigner: false, isWritable: false };
    if (!given) throw new Error(`${name}: account ${a.name} missing`);
    return { pubkey: given, isSigner: !!a.signer, isWritable: !!a.writable };
  });
  return new TransactionInstruction({ programId, keys: [...keys, ...remaining], data: encodeInstruction(IDL, name, args) });
}

/**
 * One attester (IDL `AttesterEntry`): an ed25519 key and an INFORMATIONAL kind tag — the program verifies only signatures and the
 * quorum; the tag says what stands behind the key.
 */
export interface AttesterEntry {
  kind: number;
  key: PublicKey;
}

export const ATTESTER_OPERATOR = 0;
export const ATTESTER_ZKTLS_RELAYER = 1;
export const ATTESTER_ORACLE = 2;

export const operatorAttester = (key: PublicKey): AttesterEntry => ({ kind: ATTESTER_OPERATOR, key });
export const zktlsRelayerAttester = (key: PublicKey): AttesterEntry => ({ kind: ATTESTER_ZKTLS_RELAYER, key });
export const oracleAttester = (key: PublicKey): AttesterEntry => ({ kind: ATTESTER_ORACLE, key });

export interface InitializeTokenArgs {
  feed_id: string;
  memo_prefix: string;
  memo_source: string;
  rules_sha256: Uint8Array;
  rule: RuleParams;
  attesters: AttesterEntry[];
  quorum: number;
  /** POOL_POLICY_FIXED only; PublicKey.default otherwise. */
  fixed_pool: PublicKey;
  /** The config authority (attester proposals only; renounceable) — the Squads 2-of-3 vault. Mandatory (review L-2). */
  admin: PublicKey;
}

/**
 * initialize_token — the launchpad's create flow puts this RIGHT BEFORE LaunchLab's create, signed by the payer, the creator and the
 * MINT KEYPAIR (the mint need not exist yet; its signature is what makes the config unforgeable). Buyback + pool policy 0 needs
 * `launchlabPlatform` (the LaunchLab PlatformConfig the token launches on): its cpConfigId, LP lock/burn scales and
 * platformCpCreator are read and PINNED (review-3 M-3).
 */
export function initializeTokenIx(o: { programId: PublicKey; payer: PublicKey; creator: PublicKey; mint: PublicKey; args: InitializeTokenArgs; launchlabPlatform?: PublicKey }): TransactionInstruction {
  return build(o.programId, "initialize_token", {
    payer: o.payer,
    creator: o.creator,
    mint: o.mint,
    config: configPda(o.programId, o.mint),
    fee_vault: feePda(o.programId, o.mint),
    ...(o.launchlabPlatform ? { launchlab_platform: o.launchlabPlatform } : {}),
  }, { args: o.args });
}

/**
 * register_pool (review-2 F5/F14, review-3 M-2/M-3). Policy 0 (default): the token's LaunchLab pool PDA is passed; the program checks
 * it records the fee PDA as creator, CPMM migration and the platform PINNED at init, that the CPMM pool is the PDA of the pinned
 * cpConfigId, that pool_creator is the fee PDA, and that ≥ 50 % of the live LP is burned or locked. `fixedPool: true` (policy 1, or
 * after a set_registration_policy switch): the LaunchLab pool is omitted. `lpMint` is the pool's LP mint (CpmmPool.lpMint).
 */
export function registerPoolIx(o: { programId: PublicKey; registrar: PublicKey; mint: PublicKey; pool: PublicKey; lpMint: PublicKey; cluster: Cluster; fixedPool?: boolean }): TransactionInstruction {
  const accounts: Record<string, PublicKey> = {
    registrar: o.registrar,
    config: configPda(o.programId, o.mint),
    fee_vault: feePda(o.programId, o.mint),
    mint: o.mint,
    pool_state: o.pool,
    lp_mint: o.lpMint,
    lp_lock_vault: lpLockVault(o.cluster, o.lpMint),
  };
  if (!o.fixedPool) accounts.launchlab_pool = launchlabPoolPda(LAUNCHLAB_PROGRAM_ID[o.cluster], o.mint);
  return build(o.programId, "register_pool", accounts, {});
}

/** SPL Token SyncNative (instruction 17) — the client prepends it for the fee PDA's WSOL account before every buyback (review-2 F3). */
export function syncNativeIx(account: PublicKey): TransactionInstruction {
  return new TransactionInstruction({ programId: TOKEN_PROGRAM_ID, keys: [{ pubkey: account, isSigner: false, isWritable: true }], data: Buffer.from([17]) });
}

/**
 * submit_reading — preceded (anywhere in the same transaction) by an Ed25519SigVerify instruction carrying the quorum's signatures
 * over the canonical message (attestation.ts), which includes `sourceUrlHash` and `proofHash` (zero when there is no zkTLS proof).
 */
export function submitReadingIx(o: { programId: PublicKey; payer: PublicKey; mint: PublicKey; recordDate: number; value: bigint; sourceUrlHash: Uint8Array; proofHash?: Uint8Array }): TransactionInstruction {
  const config = configPda(o.programId, o.mint);
  return build(o.programId, "submit_reading", {
    payer: o.payer,
    config,
    reading: readingPda(o.programId, config, o.recordDate),
    instructions: SYSVAR_INSTRUCTIONS_ID,
    system_program: SystemProgram.programId,
  }, { record_date: o.recordDate, value: o.value, source_url_hash: o.sourceUrlHash, proof_hash: o.proofHash ?? new Uint8Array(32) });
}

export function crankVaultIx(o: { programId: PublicKey; cranker: PublicKey; mint: PublicKey; recordDate: number }): TransactionInstruction {
  const config = configPda(o.programId, o.mint);
  return build(o.programId, "crank_vault", {
    cranker: o.cranker,
    config,
    reading: readingPda(o.programId, config, o.recordDate),
    mint: o.mint,
    vault: vaultAddress(o.programId, o.mint),
    token_program: TOKEN_PROGRAM_ID,
    memo_program: MEMO_PROGRAM_ID,
  }, { record_date: o.recordDate });
}

export function crankNoUnitsIx(o: { programId: PublicKey; cranker: PublicKey; mint: PublicKey; recordDate: number }): TransactionInstruction {
  const config = configPda(o.programId, o.mint);
  return build(o.programId, "crank_no_units", { cranker: o.cranker, config, reading: readingPda(o.programId, config, o.recordDate) }, { record_date: o.recordDate });
}

export function crankBuybackIx(o: { programId: PublicKey; cranker: PublicKey; mint: PublicKey; recordDate: number; pool: BuybackPoolAccounts; cluster: Cluster }): TransactionInstruction {
  const config = configPda(o.programId, o.mint);
  return build(o.programId, "crank_buyback", {
    cranker: o.cranker,
    config,
    reading: readingPda(o.programId, config, o.recordDate),
    mint: o.mint,
    fee_vault: feePda(o.programId, o.mint),
    fee_wsol: feeWsolAddress(o.programId, o.mint),
    fee_tokens: feeTokenAddress(o.programId, o.mint),
    wsol_mint: NATIVE_MINT,
    pool_state: o.pool.pool,
    amm_config: o.pool.ammConfig,
    cpmm_authority: o.pool.cpmmAuthority,
    wsol_vault: o.pool.wsolVault,
    token_vault: o.pool.tokenVault,
    observation_state: o.pool.observation,
    // The IDL pins the mainnet CPMM id (the program's default build); a devnet build of the program expects Raydium's devnet id.
    cpmm_program: CPMM_PROGRAM_ID[o.cluster],
    token_program: TOKEN_PROGRAM_ID,
    system_program: SystemProgram.programId,
    memo_program: MEMO_PROGRAM_ID,
  }, { record_date: o.recordDate });
}

export function proposeAttestersIx(o: { programId: PublicKey; admin: PublicKey; mint: PublicKey; attesters: AttesterEntry[]; quorum: number }): TransactionInstruction {
  return build(o.programId, "propose_attesters", { admin: o.admin, config: configPda(o.programId, o.mint) }, { attesters: o.attesters, quorum: o.quorum });
}
export function cancelAttesterChangeIx(o: { programId: PublicKey; admin: PublicKey; mint: PublicKey }): TransactionInstruction {
  return build(o.programId, "cancel_attester_change", { admin: o.admin, config: configPda(o.programId, o.mint) }, {});
}
export function renounceAdminIx(o: { programId: PublicKey; admin: PublicKey; mint: PublicKey }): TransactionInstruction {
  return build(o.programId, "renounce_admin", { admin: o.admin, config: configPda(o.programId, o.mint) }, {});
}
export function applyAttesterChangeIx(o: { programId: PublicKey; caller: PublicKey; mint: PublicKey }): TransactionInstruction {
  return build(o.programId, "apply_attester_change", { caller: o.caller, config: configPda(o.programId, o.mint) }, {});
}

/** The Associated Token program's CreateIdempotent (data [1]) — used to make sure the fee PDA's / config's ATAs exist before a crank. */
export function createAtaIdempotentIx(o: { payer: PublicKey; owner: PublicKey; mint: PublicKey; ata: PublicKey }): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"),
    keys: [
      { pubkey: o.payer, isSigner: true, isWritable: true },
      { pubkey: o.ata, isSigner: false, isWritable: true },
      { pubkey: o.owner, isSigner: false, isWritable: false },
      { pubkey: o.mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]),
  });
}

// ---------------------------------------------------------------------------------------------------------------------------------
// PlatformConfig: the temporary, pre-audit burn-pool cap (owner, 2026-10-09)
// ---------------------------------------------------------------------------------------------------------------------------------

/**
 * Once, signed by the program's upgrade authority. The cap must EQUAL the default (review-3 I-2); `capSunsetTs` ≤ now + 365 days and
 * ≤ 2027-10-01; `crankers` (≤ 3, review-3 L-4) restrict crank_buyback while the cap is in force (empty = permissionless).
 */
export function initializePlatformIx(o: { programId: PublicKey; payer: PublicKey; upgradeAuthority: PublicKey; authority: PublicKey; burnPoolCapLamports: bigint; capSunsetTs: bigint; crankers?: PublicKey[] }): TransactionInstruction {
  return build(o.programId, "initialize_platform", {
    payer: o.payer,
    upgrade_authority: o.upgradeAuthority,
    program_data: programDataAddress(o.programId),
    platform: platformPda(o.programId),
    system_program: SystemProgram.programId,
  }, { authority: o.authority, burn_pool_cap_lamports: o.burnPoolCapLamports, cap_sunset_ts: o.capSunsetTs, crankers: o.crankers ?? [] });
}
/** Review-3 L-4: the platform authority returns crank_buyback to permissionless. */
/** Re-check R3-4: the platform authority OR any allowlisted key (`caller`) clears the cranker allowlist. */
export function clearCrankerAllowlistIx(o: { programId: PublicKey; caller: PublicKey }): TransactionInstruction {
  return build(o.programId, "clear_cranker_allowlist", { caller: o.caller }, {});
}
export function proposeCapRaiseIx(o: { programId: PublicKey; authority: PublicKey; newCapLamports: bigint }): TransactionInstruction {
  return build(o.programId, "propose_cap_raise", { authority: o.authority }, { new_cap_lamports: o.newCapLamports });
}
export function cancelCapRaiseIx(o: { programId: PublicKey; authority: PublicKey }): TransactionInstruction {
  return build(o.programId, "cancel_cap_raise", { authority: o.authority }, {});
}
export function renouncePlatformAuthorityIx(o: { programId: PublicKey; authority: PublicKey }): TransactionInstruction {
  return build(o.programId, "renounce_platform_authority", { authority: o.authority }, {});
}
export function applyCapRaiseIx(o: { programId: PublicKey; caller: PublicKey }): TransactionInstruction {
  return build(o.programId, "apply_cap_raise", { caller: o.caller }, {});
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Review H-2 / M-4
// ---------------------------------------------------------------------------------------------------------------------------------

/**
 * claim_launchlab_creator_fee — permissionless. Account names match the keeper's src/lib/burnKeeper/burnPool.ts: payer, config,
 * fee_vault, fee_wsol, fee_tokens (review-2 F13: the fee PDA's token ATA, balance re-checked; it need not exist),
 * launchlab_creator_fee_vault, launchlab_vault_authority, wsol_mint, launchlab_program, token_program, associated_token_program,
 * system_program (+ event_authority, program). The fee PDA's WSOL ATA must exist.
 */
export function claimLaunchlabCreatorFeeIx(o: { programId: PublicKey; payer: PublicKey; mint: PublicKey; cluster: Cluster }): TransactionInstruction {
  const fee = feePda(o.programId, o.mint);
  const ll = LAUNCHLAB_PROGRAM_ID[o.cluster];
  return build(o.programId, "claim_launchlab_creator_fee", {
    payer: o.payer,
    config: configPda(o.programId, o.mint),
    fee_vault: fee,
    fee_wsol: feeWsolAddress(o.programId, o.mint),
    fee_tokens: feeTokenAddress(o.programId, o.mint),
    wsol_mint: NATIVE_MINT,
    launchlab_vault_authority: launchlabVaultAuthority(ll),
    launchlab_creator_fee_vault: launchlabCreatorFeeVault(ll, fee),
    launchlab_program: ll,
    token_program: TOKEN_PROGRAM_ID,
    system_program: SystemProgram.programId,
    associated_token_program: ASSOCIATED_TOKEN_PROGRAM_ID,
  }, {});
}

/**
 * check_pool_health — must be the only instruction in its transaction that touches the pool (review-3 L-3). `wsolVault` may be any
 * account when the pool account is gone (review-3 L-5: the program then records "pool account" without reading the vault).
 */
export function checkPoolHealthIx(o: { programId: PublicKey; caller: PublicKey; mint: PublicKey; pool: PublicKey; wsolVault: PublicKey }): TransactionInstruction {
  return build(o.programId, "check_pool_health", { caller: o.caller, config: configPda(o.programId, o.mint), pool_state: o.pool, wsol_vault: o.wsolVault }, {});
}

/** replace_pool — the candidate must pass every register_pool provenance check (review-2 F5) after 7 CONTINUOUS days (F6). */
export function replacePoolIx(o: { programId: PublicKey; caller: PublicKey; mint: PublicKey; oldPool: PublicKey; oldWsolVault: PublicKey; newPool: PublicKey; newWsolVault: PublicKey; newLpMint: PublicKey; launchlabPlatform: PublicKey; cluster: Cluster }): TransactionInstruction {
  return build(o.programId, "replace_pool", {
    caller: o.caller,
    config: configPda(o.programId, o.mint),
    fee_vault: feePda(o.programId, o.mint),
    mint: o.mint,
    old_pool: o.oldPool,
    old_wsol_vault: o.oldWsolVault,
    new_pool: o.newPool,
    new_wsol_vault: o.newWsolVault,
    new_lp_mint: o.newLpMint,
    new_lp_lock_vault: lpLockVault(o.cluster, o.newLpMint),
    launchlab_pool: launchlabPoolPda(LAUNCHLAB_PROGRAM_ID[o.cluster], o.mint),
    launchlab_platform: o.launchlabPlatform,
  }, {});
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Review-3 M-3: the stranding-recovery switch of the registration policy (admin, 48 h timelock, sunsets with the cap)
// ---------------------------------------------------------------------------------------------------------------------------------

/** Admin: propose POOL_POLICY_FIXED with `pool` (must pass the creator + LP checks), or POOL_POLICY_CREATOR_IS_FEE_PDA (pool = default). */
export function setRegistrationPolicyIx(o: { programId: PublicKey; admin: PublicKey; mint: PublicKey; policy: number; pool: PublicKey }): TransactionInstruction {
  return build(o.programId, "set_registration_policy", { admin: o.admin, config: configPda(o.programId, o.mint) }, { policy: o.policy, pool: o.pool });
}
export function cancelRegistrationPolicyIx(o: { programId: PublicKey; admin: PublicKey; mint: PublicKey }): TransactionInstruction {
  return build(o.programId, "cancel_registration_policy", { admin: o.admin, config: configPda(o.programId, o.mint) }, {});
}
/**
 * Permissionless after the timelock and before the proposal expires (14 days after it was proposed). For a fixed-pool switch pass the
 * pool and its LP mint (the lock account is derived). Re-check R3-2: a fallback pool with < 90 % of its LP burned/locked must be the
 * pool PDA of a LaunchLab-known AmmConfig — the pinned cpConfigId, or (pass `launchlabPlatform`, the pinned platform) its current one.
 */
export function applyRegistrationPolicyIx(o: { programId: PublicKey; caller: PublicKey; mint: PublicKey; cluster: Cluster; pool?: PublicKey; lpMint?: PublicKey; launchlabPlatform?: PublicKey }): TransactionInstruction {
  const accounts: Record<string, PublicKey> = { caller: o.caller, config: configPda(o.programId, o.mint), fee_vault: feePda(o.programId, o.mint), mint: o.mint };
  if (o.pool && o.lpMint) Object.assign(accounts, { pool_state: o.pool, lp_mint: o.lpMint, lp_lock_vault: lpLockVault(o.cluster, o.lpMint) });
  if (o.launchlabPlatform) accounts.launchlab_platform = o.launchlabPlatform;
  return build(o.programId, "apply_registration_policy", accounts, {});
}
/** Re-check R3-2 — the cheap veto: any CURRENT attester (its own signature; no quorum) clears a pending registration-policy proposal. */
export function vetoRegistrationPolicyIx(o: { programId: PublicKey; attester: PublicKey; mint: PublicKey }): TransactionInstruction {
  return build(o.programId, "veto_registration_policy", { attester: o.attester, config: configPda(o.programId, o.mint) }, {});
}
