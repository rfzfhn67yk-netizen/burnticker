import { type AccountMeta, PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, CPMM_PROGRAM_ID, type Cluster, LAUNCHLAB_PROGRAM_ID, LOCK_CPMM_AUTHORITY, LOCK_CPMM_PROGRAM_ID, MEMO_PROGRAM_ID, NATIVE_MINT, OPERATOR_TREASURY, SYSVAR_INSTRUCTIONS_ID, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@/lib/burnReceipts/constants";
import type { BuybackPoolAccounts } from "@/lib/burnReceipts/cpmm";
import { BURN_RECEIPTS_IDL } from "@/lib/burnReceipts/idl";
import { encodeInstruction } from "@/lib/burnReceipts/idlCoder";
import type { RuleParams } from "@/lib/burnReceipts/math";
import { associatedTokenAddress, configPda, cpmmAuthority, endSinkPda, feeKeyRecordPda, feeKeysPda, feeNftAccount, feePda, feeTokenAddress, feeWsolAddress, launchlabCreatorFeeVault, launchlabPoolPda, launchlabVaultAuthority, carriedPacePda, lockedLiquidityPda, lpLockVault, pairLinkPda, pairResultPda, platformPda, programDataAddress, readingPda, vaultAddress } from "@/lib/burnReceipts/pda";

/**
 * Instruction builders. Data comes from the IDL coder; account ORDER and writable/signer flags come from the IDL too (each builder
 * only names the accounts), so a builder cannot drift from the program.
 */

const IDL = BURN_RECEIPTS_IDL;

/** Anchor's event-CPI authority: every instruction carries it (and the program itself) so events ride in inner instructions. */
export const eventAuthority = (programId: PublicKey): PublicKey => PublicKey.findProgramAddressSync([Buffer.from("__event_authority", "utf8")], programId)[0];

/** Builds any burn_receipts instruction from the IDL (account order, optional accounts, args). Exported for pairs.ts. */
export function buildIx(programId: PublicKey, name: string, accounts: Record<string, PublicKey>, args: Record<string, unknown>, remaining: AccountMeta[] = []): TransactionInstruction {
  return build(programId, name, accounts, args, remaining);
}

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
  /** Pair-forward r3 (RN-2): with pair_mint, the pair's locked voidBy as YYYYMMDD (UTC; today or later; both coins the same); 0 without.
   *  initializeTokenIx fills it from `pairVoidBy` (default 0). */
  pair_void_by?: number;
  /** LAUNCHPAD-PATH §45 (with the end_sink account; all zero without): initializeTokenIx fills them from `endSink`. */
  end_sink_kind?: number;
  end_sink_mint?: PublicKey | null;
  end_sink_min_lamports?: bigint | number;
}

/**
 * initialize_token — the launchpad's create flow puts this RIGHT BEFORE LaunchLab's create, signed by the payer, the creator and the
 * MINT KEYPAIR (the mint need not exist yet; its signature is what makes the config unforgeable). Buyback + pool policy 0 needs
 * `launchlabPlatform` (the LaunchLab PlatformConfig the token launches on): its cpConfigId, LP lock/burn scales and
 * platformCpCreator are read and PINNED (review-3 M-3).
 */
/**
 * LAUNCHPAD-PATH §40: `pairMint` names the partner coin (policies 0/1; policy 2 pairs through link_pair). Its PairLink is written:
 * provisional until the partner's initialize_token names this mint back within PAIRING_WINDOW_SECS; pass `partnerFirst: true` when
 * the partner already initialized naming this mint (its PairLink and TokenConfig are then passed and both coins become paired).
 */
/**
 * Pair-forward r3 (RN-2): `pairVoidBy` (YYYYMMDD, UTC) is REQUIRED on chain with `pairMint` — the rules' `pair.voidBy`, the same on
 * both coins; once that day has ended with a coin still lacking a verified pool, unlink_pair may unpair the two. Also r3 (M-1): the
 * partner must have the SAME attester set and quorum (same keys, same order), or the second coin's initialize_token is refused.
 */
/**
 * LAUNCHPAD-PATH §45: `endSink` pins the coin's end sink (endSink.ts): kind END_SINK_FLAGSHIP (sinkMint omitted) / END_SINK_MINT /
 * END_SINK_PAIR_WINNER (sinkMint = the partner; omit it for a LaunchLab pair, where it is `pairMint`; required for a pair_curve coin), and the minimum forward_on_end moves
 * (1,000,000–10,000,000,000 lamports: the rules' onEnd.sweepThresholdLamports). Omitted = no end sink (the hashed wind-down; the coin
 * cannot submit_rule_end). The mainnet build refuses every end sink until its flagship is compiled in (FlagshipNotPinned).
 */
/**
 * WHICH initialize_token LAYOUT (LAUNCHPAD-PATH §45, program round 4). Round 4 adds the optional `end_sink` account and three args.
 * `#[event_cpi]` appends event_authority + program AFTER every account, so the round-4 account list (end_sink slot, then
 * event_authority) is NOT accepted by a round-3 program (it reads the end_sink slot as event_authority: ConstraintAddress 2012), and
 * the round-3 list is not accepted by a round-4 program. The deployed programs (mainnet and devnet, 2026-10-12) are ROUND 3, so the
 * default is "r3": the end_sink slot is dropped and the three end-sink args are cut (a round-3 program reads its args and ignores
 * nothing else; the bytes are exactly round 3's). "r4" is required with `endSink`, and for any create on an upgraded program.
 * FLIP the default to "r4" once both deployments run round 4 (docs/burnticker/END-SINK.md "What flips").
 */
/**
 * ROUND 5 ("r5"): the create is initialize_token_r5 — round 4's accounts and arguments under its own discriminator, plus the owner's rule
 * (2026-10-13) that a coin never burns itself on its losing path: the program refuses a buyback coin without an end sink
 * (LostPathBurnsSelf). The flag value says the deployed program is round 5: only then may a create carry pin_burn_target
 * (burnTarget.ts pinBurnTargetIx) or the incinerator end sink.
 */
export type InitializeTokenLayout = "r3" | "r4" | "r5";
export const INITIALIZE_TOKEN_DEFAULT_LAYOUT: InitializeTokenLayout = "r3";
/** The host flag that flips the default without a code release (the opening sets it to r4 once both deployments run round 4). */
export const INITIALIZE_TOKEN_LAYOUT_ENV = "BURNTICKER_INITIALIZE_TOKEN_LAYOUT";
/**
 * The default layout on this host: BURNTICKER_INITIALIZE_TOKEN_LAYOUT ("r3" | "r4"), else INITIALIZE_TOKEN_DEFAULT_LAYOUT. Any other
 * value is refused, so a typo can never silently send the wrong bytes.
 */
export function initializeTokenLayoutFromEnv(env: Readonly<Record<string, string | undefined>> = typeof process !== "undefined" ? process.env : {}): InitializeTokenLayout {
  const v = (env[INITIALIZE_TOKEN_LAYOUT_ENV] ?? "").trim();
  if (v === "") return INITIALIZE_TOKEN_DEFAULT_LAYOUT;
  if (v === "r3" || v === "r4" || v === "r5") return v;
  throw new Error(`${INITIALIZE_TOKEN_LAYOUT_ENV} must be r3, r4 or r5, not "${v}".`);
}
/** The bytes the three round-4 args take when no end sink is pinned: u8 kind 0, Option None (1 byte), u64 0. */
const R4_EMPTY_END_SINK_ARG_BYTES = 10;

export function initializeTokenIx(o: { programId: PublicKey; payer: PublicKey; creator: PublicKey; mint: PublicKey; args: InitializeTokenArgs; launchlabPlatform?: PublicKey; pairMint?: PublicKey; partnerFirst?: boolean; pairVoidBy?: number; endSink?: { kind: number; sinkMint?: PublicKey; minForwardLamports: bigint | number }; layout?: InitializeTokenLayout }): TransactionInstruction {
  const layout = o.layout ?? (o.endSink ? "r4" : initializeTokenLayoutFromEnv());
  if (layout === "r3" && (o.endSink || o.args.end_sink_kind || o.args.end_sink_mint || o.args.end_sink_min_lamports)) throw new Error("initialize_token: an end sink needs the round-4 program (layout r4)");
  const ix = initializeTokenIxR4(o, layout === "r5" ? "initialize_token_r5" : "initialize_token");
  if (layout === "r4" || layout === "r5") return ix;
  const slot = IDL.instructions.find((i) => i.name === "initialize_token")!.accounts.findIndex((a) => a.name === "end_sink");
  return new TransactionInstruction({ programId: ix.programId, keys: ix.keys.filter((_, i) => i !== slot), data: Buffer.from(ix.data.subarray(0, ix.data.length - R4_EMPTY_END_SINK_ARG_BYTES)) });
}

function initializeTokenIxR4(o: Parameters<typeof initializeTokenIx>[0], name: "initialize_token" | "initialize_token_r5" = "initialize_token"): TransactionInstruction {
  return build(o.programId, name, {
    payer: o.payer,
    creator: o.creator,
    mint: o.mint,
    config: configPda(o.programId, o.mint),
    fee_vault: feePda(o.programId, o.mint),
    ...(o.launchlabPlatform ? { launchlab_platform: o.launchlabPlatform } : {}),
    // r2 L-3: the partner's PairLink address always rides with pairMint (empty when this coin is first).
    ...(o.pairMint ? { pair_mint: o.pairMint, pair_link: pairLinkPda(o.programId, o.mint), partner_link: pairLinkPda(o.programId, o.pairMint) } : {}),
    ...(o.pairMint && o.partnerFirst ? { partner_config: configPda(o.programId, o.pairMint) } : {}),
    ...(o.endSink ? { end_sink: endSinkPda(o.programId, o.mint) } : {}),
  }, {
    args: {
      ...o.args,
      pair_void_by: o.pairVoidBy ?? o.args.pair_void_by ?? 0,
      end_sink_kind: o.endSink?.kind ?? o.args.end_sink_kind ?? 0,
      // an Option on chain: null = none (FLAGSHIP; PAIR_WINNER with pairMint = the partner) — 31 bytes fewer in the create
      end_sink_mint: o.endSink ? o.endSink.sinkMint ?? null : o.args.end_sink_mint ?? null,
      end_sink_min_lamports: BigInt(o.endSink?.minForwardLamports ?? o.args.end_sink_min_lamports ?? 0),
    },
  });
}

/**
 * register_pool (review-2 F5/F14, review-3 M-2/M-3). Policy 0 (default): the token's LaunchLab pool PDA is passed; the program checks
 * it records the fee PDA as creator, CPMM migration and the platform PINNED at init, that the CPMM pool is the PDA of the pinned
 * cpConfigId, that pool_creator is the fee PDA, and that ≥ 50 % of the live LP is burned or locked. lp-lock blind review r2 (RL-3):
 * policy 0 also passes the mint's FeeKeyRecord ["fee_key", mint] — register_fee_key must have run first for this very pool, so the
 * pool is verified only when its LP fees reach the burn. `fixedPool: true` (policy 1, or after a set_registration_policy switch): the
 * LaunchLab pool and the FeeKeyRecord are omitted. `lpMint` is the pool's LP mint (CpmmPool.lpMint).
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
  if (!o.fixedPool) {
    accounts.launchlab_pool = launchlabPoolPda(LAUNCHLAB_PROGRAM_ID[o.cluster], o.mint);
    accounts.fee_key = feeKeyRecordPda(o.programId, o.mint);
  }
  return build(o.programId, "register_pool", accounts, {});
}

/**
 * register_pair_pool (2026-10-10, registration policy 2): the CPMM pool pair_curve's `graduate` created for this mint. Permissionless;
 * `pair` is the pair_curve Pair account (src/lib/pairCurve/accounts.ts pairPda), `pool` the side's pool (poolPda), `lpMint` its LP mint.
 */
export function registerPairPoolIx(o: { programId: PublicKey; registrar: PublicKey; mint: PublicKey; pool: PublicKey; lpMint: PublicKey; pair: PublicKey; cluster: Cluster }): TransactionInstruction {
  return build(o.programId, "register_pair_pool", { registrar: o.registrar, config: configPda(o.programId, o.mint), mint: o.mint, pool_state: o.pool, lp_mint: o.lpMint, pair: o.pair, lp_lock_vault: lpLockVault(o.cluster, o.lpMint) }, {});
}

/**
 * register_fee_key (LAUNCHPAD-PATH §35) — permissionless, once per mint: records the coin's lock position whose Fee Key NFT the
 * FEE_KEYS PDA holds, in FeeKeyRecord ["fee_key", mint]. lp-lock blind review r2: the position is identified by its LOCKER
 * (LockedCpLiquidityState @128 — LaunchLab's vault authority for policy 0, the pair's vault for pairs) and must hold a majority of the
 * LP in Raydium's lock account `lp_lock_vault`; for policy 0 it runs BEFORE register_pool, on the migration pool. `lpMint` defaults to
 * the CPMM LP mint PDA ["pool_lp_mint", pool].
 *
 * WHICH ACCOUNT LIST (B-17). The B-17 program adds the optional `launchlab_pool` account just before system_program. `#[event_cpi]`
 * appends event_authority and program after every account, and Anchor reads accounts by position, so the two lists are not
 * interchangeable: the round-5 program now on mainnet and devnet reads a LaunchLab pool in the system_program slot and refuses the
 * whole instruction (InvalidProgramId), and the B-17 program given the round-5 list reads system_program as the LaunchLab pool and
 * event_authority as system_program. `launchlabPoolSlot: true` builds the B-17 list; the default is the round-5 list, the one the
 * deployed program reads. The keeper decides from the deployed program's hash (programHash.ts registerFeeKeyLaunchlabSlot).
 */
export function registerFeeKeyIx(o: { programId: PublicKey; payer: PublicKey; mint: PublicKey; pool: PublicKey; feeNftMint: PublicKey; cluster: Cluster; lpMint?: PublicKey; launchlabPoolSlot?: boolean }): TransactionInstruction {
  const lpMint = o.lpMint ?? PublicKey.findProgramAddressSync([Buffer.from("pool_lp_mint"), o.pool.toBuffer()], CPMM_PROGRAM_ID[o.cluster])[0];
  const ix = build(o.programId, "register_fee_key", {
    payer: o.payer,
    config: configPda(o.programId, o.mint),
    fee_key: feeKeyRecordPda(o.programId, o.mint),
    fee_keys: feeKeysPda(o.programId),
    pool_state: o.pool,
    fee_nft_mint: o.feeNftMint,
    fee_nft_account: feeNftAccount(o.programId, o.feeNftMint),
    locked_liquidity: lockedLiquidityPda(o.cluster, o.feeNftMint),
    lp_lock_vault: lpLockVault(o.cluster, lpMint),
    // eighth-pass CH8-4 gap 1: the coin's LaunchLab pool, read only when the pool's AmmConfig is not the pinned one (then it must read
    // migrated); unused for policies 1 and 2
    launchlab_pool: launchlabPoolPda(LAUNCHLAB_PROGRAM_ID[o.cluster], o.mint),
    system_program: SystemProgram.programId,
  }, {});
  if (o.launchlabPoolSlot) return ix;
  // The round-5 program has no launchlab_pool slot: drop it, so system_program, event_authority and program sit where it reads them.
  const slot = IDL.instructions.find((i) => i.name === "register_fee_key")!.accounts.findIndex((a) => a.name === "launchlab_pool");
  return new TransactionInstruction({ programId: ix.programId, keys: ix.keys.filter((_, i) => i !== slot), data: ix.data });
}

/** The CPMM pool accounts claim_lock_fees needs (all from the PoolState): vaults and LP mint. */
export interface LockFeePoolAccounts { pool: PublicKey; lpMint: PublicKey; token0Vault: PublicKey; token1Vault: PublicKey }

/**
 * claim_lock_fees (LAUNCHPAD-PATH §35) — permissionless (the cranker allowlist applies while the cap is in force). Collects ALL the
 * locked LP's accrued fees (lp-lock blind review L-3: no amount argument) with the FEE_KEYS signature; the SOL side goes 80 % to the fee
 * PDA and 20 % to the compiled OPERATOR_TREASURY, the coin side is burned. `pool` must be the FeeKeyRecord's pool (L-1). The cranker
 * pays (and gets back) the ATA rents it creates.
 */
export function claimLockFeesIx(o: { programId: PublicKey; cranker: PublicKey; mint: PublicKey; feeNftMint: PublicKey; pool: LockFeePoolAccounts; cluster: Cluster; treasury?: PublicKey }): TransactionInstruction {
  const fk = feeKeysPda(o.programId);
  return build(o.programId, "claim_lock_fees", {
    cranker: o.cranker,
    config: configPda(o.programId, o.mint),
    fee_key: feeKeyRecordPda(o.programId, o.mint),
    fee_keys: fk,
    fee_vault: feePda(o.programId, o.mint),
    operator_treasury: o.treasury ?? OPERATOR_TREASURY[o.cluster],
    mint: o.mint,
    wsol_mint: NATIVE_MINT,
    fee_keys_wsol: associatedTokenAddress(fk, NATIVE_MINT),
    fee_keys_token: associatedTokenAddress(fk, o.mint),
    fee_nft_account: associatedTokenAddress(fk, o.feeNftMint),
    locked_liquidity: lockedLiquidityPda(o.cluster, o.feeNftMint),
    lock_program: LOCK_CPMM_PROGRAM_ID[o.cluster],
    lock_authority: LOCK_CPMM_AUTHORITY[o.cluster],
    cpmm_program: CPMM_PROGRAM_ID[o.cluster],
    cpmm_authority: cpmmAuthority(CPMM_PROGRAM_ID[o.cluster]),
    pool_state: o.pool.pool,
    lp_mint: o.pool.lpMint,
    token_0_vault: o.pool.token0Vault,
    token_1_vault: o.pool.token1Vault,
    lock_lp_vault: lpLockVault(o.cluster, o.pool.lpMint),
    token_program: TOKEN_PROGRAM_ID,
    token_2022_program: TOKEN_2022_PROGRAM_ID,
    memo_program: MEMO_PROGRAM_ID,
    associated_token_program: ASSOCIATED_TOKEN_PROGRAM_ID,
    system_program: SystemProgram.programId,
  }, {});
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

/** `partner` (LAUNCHPAD-PATH §40): a PAIRED coin passes its partner mint — the PairLink and the period's PairResult are added. */
export function crankBuybackIx(o: { programId: PublicKey; cranker: PublicKey; mint: PublicKey; recordDate: number; pool: BuybackPoolAccounts; cluster: Cluster; partner?: PublicKey }): TransactionInstruction {
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
    ...(o.partner ? { pair_link: pairLinkPda(o.programId, o.mint), pair_result: pairResultPda(o.programId, o.mint, o.partner, o.recordDate) } : {}),
  }, { record_date: o.recordDate });
}

/**
 * crank_carried (burn dispersal, 2026-10-13): spend a piece of at most `maxSpendLamports` of the config's carried spend without a
 * reading — same pool accounts as crank_buyback, no Reading. It spends min(carried, maxSpendLamports, pool) (owner decision 2026-10-25:
 * no per-run bound, no carried budget; SpendAboveCap is never raised). The program refuses with nothing carried (NothingCarried), while a
 * reading waits for its own crank (ReadingPending), a piece under the floor that is not the whole remainder (BelowFloor), and a second
 * piece in the same second as the coin's last one (CarriedTooSoon).
 */
export function crankCarriedIx(o: { programId: PublicKey; cranker: PublicKey; mint: PublicKey; pool: BuybackPoolAccounts; cluster: Cluster; maxSpendLamports: bigint }): TransactionInstruction {
  return build(o.programId, "crank_carried", {
    cranker: o.cranker,
    config: configPda(o.programId, o.mint),
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
    cpmm_program: CPMM_PROGRAM_ID[o.cluster],
    token_program: TOKEN_PROGRAM_ID,
    system_program: SystemProgram.programId,
    memo_program: MEMO_PROGRAM_ID,
    // round-5 review R5-8: the coin's pace (created on its first piece; the cranker pays the rent)
    carried_pace: carriedPacePda(o.programId, o.mint),
  }, { max_spend_lamports: o.maxSpendLamports });
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
// PlatformConfig. The burn-pool cap and the cranker allowlist were removed (owner decision 2026-10-25). The builders below stay because
// the IDL keeps the entry points; the cap-raise ones are NOT a working power: the program always refuses them with CapRemoved (6144).
// ---------------------------------------------------------------------------------------------------------------------------------

/**
 * Once, signed by the program's upgrade authority. The program keeps the signature but ignores `burnPoolCapLamports` and `crankers`
 * (it stores 0 / empty); `capSunsetTs` must be in the future, ≤ now + 365 days and ≤ 2027-10-01, and now only closes the
 * registration-policy switch.
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
/** Clears the (legacy) cranker allowlist. Still accepted by the program; it has no effect on cranking since 2026-10-25. */
export function clearCrankerAllowlistIx(o: { programId: PublicKey; caller: PublicKey }): TransactionInstruction {
  return build(o.programId, "clear_cranker_allowlist", { caller: o.caller }, {});
}
/** @deprecated the program refuses it with CapRemoved (6144) since the owner decision of 2026-10-25. */
export function proposeCapRaiseIx(o: { programId: PublicKey; authority: PublicKey; newCapLamports: bigint }): TransactionInstruction {
  return build(o.programId, "propose_cap_raise", { authority: o.authority }, { new_cap_lamports: o.newCapLamports });
}
/** @deprecated the program refuses it with CapRemoved (6144) since the owner decision of 2026-10-25. */
export function cancelCapRaiseIx(o: { programId: PublicKey; authority: PublicKey }): TransactionInstruction {
  return build(o.programId, "cancel_cap_raise", { authority: o.authority }, {});
}
export function renouncePlatformAuthorityIx(o: { programId: PublicKey; authority: PublicKey }): TransactionInstruction {
  return build(o.programId, "renounce_platform_authority", { authority: o.authority }, {});
}
/** @deprecated the program refuses it with CapRemoved (6144) since the owner decision of 2026-10-25. */
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
