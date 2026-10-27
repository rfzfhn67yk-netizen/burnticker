import { type AddressLookupTableAccount, AddressLookupTableProgram, ComputeBudgetProgram, type Connection, type Keypair, type ParsedTransactionWithMeta, PublicKey, SystemProgram, type TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { attestReading, sourceUrlHash } from "@/lib/burnReceipts/attestation";
import { bs58, fetchCarriedPace, fetchNextReadingInLine, fetchReading, fetchTokenConfig, type ReadingAccount, type TokenConfigAccount } from "@/lib/burnReceipts/accounts";
import { assertSignableGenesis, CPMM_PROGRAM_ID, type Cluster, GENESIS_HASH, LAUNCHLAB_PROGRAM_ID, LL_POOL_PLATFORM_ID, MEMO_PROGRAM_ID, MODE_BUYBACK, NATIVE_MINT, OUTCOME_NAMES, PACKET_DATA_SIZE, POOL_POLICY_CREATOR_IS_FEE_PDA, SYSVAR_INSTRUCTIONS_ID } from "@/lib/burnReceipts/constants";
import { type BuybackPoolAccounts, buybackPoolAccounts, decodeCpmmPool, decodeObservationRing, fetchCpmmPool, type ObservationRing } from "@/lib/burnReceipts/cpmm";
import { formatDate } from "@/lib/burnReceipts/math";
import { fetchPairLink, fetchPairResult, forwardToWinnerIx, PAIR_RESULT_GRACE_SECS, PAIR_RESULT_LOST, PAIR_STATE_PAIRED, pairResultFor } from "@/lib/burnReceipts/pairs";
import { checkPoolHealthIx, claimLaunchlabCreatorFeeIx, crankBuybackIx, crankCarriedIx, crankNoUnitsIx, crankVaultIx, createAtaIdempotentIx, eventAuthority, registerPoolIx, submitReadingIx, syncNativeIx } from "@/lib/burnReceipts/instructions";
import { configPda, cpmmAuthority, feePda, feeTokenAddress, feeWsolAddress, launchlabPoolPda, vaultAddress } from "@/lib/burnReceipts/pda";
import { burnsTarget as targetCoin, crankTargetBurnIx, feeTargetAddress, fetchBurnTarget, TARGET_POOL_HELD_ERRORS, TARGET_PYTH_RETRY_ERRORS } from "@/lib/burnReceipts/burnTarget";

/**
 * THE KEEPER'S HANDLE ON THE PROGRAM. Two jobs, both safe to retry:
 *
 *   submitAttestedReading — after the keeper fetches and validates a Treasury row, sign the canonical message with the DATA key(s) and
 *     submit it. Idempotent on chain (the same date + value again is a no-op; a different value for a stored date is refused).
 *   crankNext / crankAll — process the next reading in line (PERMISSIONLESS: the cranker key only pays the fee; every amount is
 *     computed by the program). Buyback guard refusals (TWAP / pool closed / a stale WSOL balance) come back as `deferred`, never
 *     thrown: retry later.
 *
 * Every send is simulated first, and every transaction is size-checked against the 1,232-byte packet limit: a legacy transaction
 * when it fits, otherwise a v0 transaction through `ctx.lookupTable` (createReadingLookupTable), otherwise an explicit error.
 * MAINNET IS REFUSED unless the caller passes `allowMainnet: true` (checked against the cluster's genesis hash, not just the
 * `cluster` label) — this repository is localnet/devnet only until the owner deploys.
 */

export interface ProgramContext {
  connection: Connection;
  programId: PublicKey;
  mint: PublicKey;
  /** Which CPMM deployment the program build talks to. */
  cluster: Cluster;
  allowMainnet?: boolean;
  computeUnits?: number;
  /** Review-2 F4: used (v0 transaction) only when a legacy transaction would exceed 1,232 bytes. */
  lookupTable?: AddressLookupTableAccount;
}

/**
 * Review L-6: the genesis hash is ALWAYS fetched and must match the `cluster` label (mainnet ↔ mainnet-beta genesis, devnet ↔ devnet
 * genesis, localnet ↔ neither); `allowMainnet` only lifts the mainnet refusal, never the consistency check. Returns the genesis.
 */
export async function assertClusterAllowed(ctx: ProgramContext): Promise<string> {
  if (ctx.cluster === "mainnet" && !ctx.allowMainnet) throw new Error("burnReceipts: mainnet refused (pass allowMainnet only for the owner's own deployment)");
  const genesis = await ctx.connection.getGenesisHash();
  const actual = genesis === GENESIS_HASH.mainnet ? "mainnet" : genesis === GENESIS_HASH.devnet ? "devnet" : "localnet";
  if (actual !== ctx.cluster) throw new Error(`burnReceipts: the RPC is ${actual} (genesis ${genesis}) but the context says ${ctx.cluster}`);
  return genesis;
}

/** "Error Code: TwapDeviation" → "TwapDeviation". */
export function anchorErrorName(logs: readonly string[] | null | undefined): string | null {
  for (const l of logs ?? []) {
    const m = /Error Code: (\w+)/.exec(l);
    if (m) return m[1];
  }
  return null;
}

/**
 * @deprecated Review-2 F10: the first `Memo (len N)` log line can come from ANY Memo instruction in the transaction (a spoof placed
 * before the crank). Use memoFromTransaction, which reads the Memo CPI made by the burn program's own instruction.
 */
export function memoFromLogs(logs: readonly string[] | null | undefined): string | null {
  for (const l of logs ?? []) {
    const m = /Memo \(len \d+\): "(.*)"$/.exec(l);
    if (m) return m[1];
  }
  return null;
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function bs58decode(s: string): Buffer {
  let x = BigInt(0);
  for (const ch of s) {
    const v = B58.indexOf(ch);
    if (v < 0) throw new Error("not base58");
    x = x * BigInt(58) + BigInt(v);
  }
  let hex = x.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  const body = x === BigInt(0) ? Buffer.alloc(0) : Buffer.from(hex, "hex");
  let zeros = 0;
  while (zeros < s.length && s[zeros] === "1") zeros++;
  return Buffer.concat([Buffer.alloc(zeros), body]);
}

/**
 * Review-2 F10: the memo the BURN PROGRAM wrote — the Memo CPI among the inner instructions of a top-level instruction of
 * `programId` (getParsedTransaction output). A Memo instruction placed anywhere else in the transaction is ignored.
 * Review-3 L-6: with `recordDate`, only the memo for THAT reading (its second field is the reading's YYYY-MM-DD) — one transaction
 * may crank several readings (cranking is permissionless), and the first memo is then someone else's.
 */
export function memoFromTransaction(tx: ParsedTransactionWithMeta | null | undefined, programId: PublicKey, recordDate?: number): string | null {
  if (!tx) return null;
  const want = recordDate === undefined ? null : formatDate(recordDate);
  const top = tx.transaction.message.instructions;
  for (const inner of tx.meta?.innerInstructions ?? []) {
    const parent = top[inner.index];
    if (!parent || !parent.programId.equals(programId)) continue;
    for (const ix of inner.instructions) {
      if (!ix.programId.equals(MEMO_PROGRAM_ID)) continue;
      const memo = "parsed" in ix && typeof ix.parsed === "string" ? ix.parsed : "data" in ix && typeof ix.data === "string" ? bs58decode(ix.data).toString("utf8") : null;
      if (memo === null) continue;
      if (want === null || memo.split("|")[1] === want) return memo;
    }
  }
  return null;
}

/**
 * Review-3 L-5: the pool accounts a crank / health check needs, built from the config alone when the registered pool account is gone
 * or no longer CPMM's (the program then records "pool account" / reports PoolNotTradable without reading the vaults, and after 30
 * continuous days processes the reading below-floor). The stand-ins are unused PDAs of the burn program.
 */
export async function poolAccountsOrStandIns(ctx: ProgramContext, poolKey: PublicKey): Promise<BuybackPoolAccounts & { missing: boolean }> {
  const cpmm = CPMM_PROGRAM_ID[ctx.cluster];
  const info = await ctx.connection.getAccountInfo(poolKey, "confirmed");
  if (info && info.owner.equals(cpmm)) {
    try {
      return { ...buybackPoolAccounts(decodeCpmmPool(poolKey, info.data), ctx.mint, cpmm), missing: false };
    } catch { /* not a readable pool: stand-ins below */ }
  }
  const standIn = (seed: string) => PublicKey.findProgramAddressSync([Buffer.from(seed, "utf8")], ctx.programId)[0];
  return { pool: poolKey, ammConfig: standIn("none"), cpmmAuthority: cpmmAuthority(cpmm), wsolVault: standIn("none"), tokenVault: standIn("none2"), observation: standIn("none"), wsolIsToken0: true, missing: true };
}

/** Wire size of a signed (or unsigned: signatures are fixed-width) transaction. */
export const transactionSize = (tx: VersionedTransaction): number => tx.serialize().length;

/**
 * Review-2 F4: the transaction for `ixs` (a compute-unit limit first): LEGACY when it fits 1,232 bytes, otherwise v0 through
 * `lookupTable`; throws when neither fits. Signed by `signers` (the first pays).
 */
export function buildSizedTransaction(o: { instructions: TransactionInstruction[]; signers: Keypair[]; recentBlockhash: string; computeUnits?: number; lookupTable?: AddressLookupTableAccount }): { tx: VersionedTransaction; version: "legacy" | 0; size: number } {
  const instructions = [ComputeBudgetProgram.setComputeUnitLimit({ units: o.computeUnits ?? 400_000 }), ...o.instructions];
  const msg = new TransactionMessage({ payerKey: o.signers[0].publicKey, recentBlockhash: o.recentBlockhash, instructions });
  const legacy = new VersionedTransaction(msg.compileToLegacyMessage());
  legacy.sign(o.signers);
  const legacySize = transactionSize(legacy);
  if (legacySize <= PACKET_DATA_SIZE) return { tx: legacy, version: "legacy", size: legacySize };
  if (!o.lookupTable) throw new Error(`burnReceipts: the transaction is ${legacySize} bytes (limit ${PACKET_DATA_SIZE}); pass a lookup table (createReadingLookupTable)`);
  const v0 = new VersionedTransaction(msg.compileToV0Message([o.lookupTable]));
  v0.sign(o.signers);
  const size = transactionSize(v0);
  if (size > PACKET_DATA_SIZE) throw new Error(`burnReceipts: the v0 transaction is still ${size} bytes (limit ${PACKET_DATA_SIZE})`);
  return { tx: v0, version: 0, size };
}

/** The accounts a submit_reading lookup table holds: the config, the instructions sysvar, the System program, the event authority. */
export function readingLookupTableAddresses(programId: PublicKey, mint: PublicKey): PublicKey[] {
  return [configPda(programId, mint), SYSVAR_INSTRUCTIONS_ID, SystemProgram.programId, eventAuthority(programId)];
}

/**
 * Creates and fills an address lookup table for this token's submit_reading transactions (the payer pays its rent and is its
 * authority), waits until it is usable and returns it — pass it as `ctx.lookupTable`. Only needed if a transaction would not fit
 * the legacy limit (quorum ≤ 3 always fits with the shared-message layout).
 */
export async function createReadingLookupTable(ctx: ProgramContext, payer: Keypair): Promise<AddressLookupTableAccount> {
  await assertClusterAllowed(ctx);
  const recentSlot = await ctx.connection.getSlot("finalized");
  const [create, address] = AddressLookupTableProgram.createLookupTable({ authority: payer.publicKey, payer: payer.publicKey, recentSlot });
  const extend = AddressLookupTableProgram.extendLookupTable({ lookupTable: address, authority: payer.publicKey, payer: payer.publicKey, addresses: readingLookupTableAddresses(ctx.programId, ctx.mint) });
  const r = await simulateAndSend({ ...ctx, lookupTable: undefined }, [create, extend], [payer]);
  if (!r.ok) throw new Error(`lookup table creation failed: ${r.error}`);
  const startSlot = await ctx.connection.getSlot("confirmed");
  for (;;) {
    const lut = (await ctx.connection.getAddressLookupTable(address, { commitment: "confirmed" })).value;
    if (lut && (await ctx.connection.getSlot("confirmed")) > startSlot) return lut;
    await new Promise((res) => setTimeout(res, 400));
  }
}

/**
 * Builds and signs (does not send) a transaction: compute-unit limit + the instructions, fee payer = the first signer — legacy when
 * it fits 1,232 bytes, else v0 through `ctx.lookupTable` (buildSizedTransaction). Exported for the keeper's program path
 * (src/lib/burnKeeper/programAdapter.ts), which writes the signature to its ledger BEFORE sending. `raw` deserializes with
 * VersionedTransaction.deserialize for both versions.
 */
export async function signTransaction(ctx: ProgramContext, ixs: TransactionInstruction[], signers: Keypair[]): Promise<{ tx: VersionedTransaction; signature: string; raw: Uint8Array; blockhash: string; lastValidBlockHeight: number; version: "legacy" | 0; size: number }> {
  const { blockhash, lastValidBlockHeight } = await ctx.connection.getLatestBlockhash("confirmed");
  const { tx, version, size } = buildSizedTransaction({ instructions: ixs, signers, recentBlockhash: blockhash, computeUnits: ctx.computeUnits, lookupTable: ctx.lookupTable });
  return { tx, signature: bs58(tx.signatures[0]), raw: tx.serialize(), blockhash, lastValidBlockHeight, version, size };
}

async function simulateAndSend(ctx: ProgramContext, ixs: TransactionInstruction[], signers: Keypair[]): Promise<{ ok: true; signature: string; logs: string[]; parsed: ParsedTransactionWithMeta | null } | { ok: false; error: string | null; logs: string[] }> {
  const { tx, lastValidBlockHeight } = await signTransaction(ctx, ixs, signers);
  const sim = await ctx.connection.simulateTransaction(tx, { commitment: "confirmed" });
  const simLogs = sim.value.logs ?? [];
  if (sim.value.err) return { ok: false, error: anchorErrorName(simLogs) ?? JSON.stringify(sim.value.err), logs: simLogs };
  const signature = await ctx.connection.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 5 });
  const err = await confirmByPolling(ctx.connection, signature, lastValidBlockHeight);
  const parsed = await ctx.connection.getParsedTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  const logs = parsed?.meta?.logMessages ?? simLogs;
  if (err) return { ok: false, error: anchorErrorName(logs) ?? JSON.stringify(err), logs };
  return { ok: true, signature, logs, parsed };
}

/**
 * Confirmation by polling getSignatureStatuses (no websocket subscription: one less long-lived connection for the keeper, and the
 * same code path on every RPC). Returns the transaction error, or null once confirmed; throws if the blockhash expires unconfirmed.
 */
export async function confirmByPolling(connection: Connection, signature: string, lastValidBlockHeight: number, intervalMs = 500): Promise<unknown> {
  for (;;) {
    const st = (await connection.getSignatureStatuses([signature])).value[0];
    if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) return st.err ?? null;
    if ((await connection.getBlockHeight("confirmed")) > lastValidBlockHeight) throw new Error(`transaction ${signature} expired unconfirmed`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

// ----------------------------------------------------------------------------------------------------------------------------------
// Readings
// ----------------------------------------------------------------------------------------------------------------------------------

export interface SubmitResult { status: "submitted" | "refused"; signature?: string; error?: string | null; recordDate: number; value: bigint }

/**
 * Signs (every attester key passed — e.g. the keeper's data key, or the keeper's and a second operator's) and submits a reading.
 * `sourceUrl` is the exact URL the value was read from (its sha256 is signed and stored); `proofHash` locates a zkTLS proof of that
 * response when a relayer produced one. Signatures from attesters on other machines can be merged by building the shared-message
 * Ed25519SigVerify instruction yourself (attestation.ts ed25519SharedMessageInstruction) and calling submitReadingIx.
 *
 * The signed message binds the TokenConfig's `cluster_genesis` (review-2 F12). On devnet/mainnet it must equal the RPC's genesis
 * (else the program build and the cluster disagree and nothing is signed); a localnet validator runs the mainnet build, so there the
 * config's value is used as is.
 */
export async function submitAttestedReading(ctx: ProgramContext, o: { payer: Keypair; recordDate: number; value: bigint; sourceUrl: string; proofHash?: Uint8Array; attesters: { publicKey: PublicKey; secretKey: Uint8Array }[] }): Promise<SubmitResult> {
  const rpcGenesis = await assertClusterAllowed(ctx);
  const cfg = await fetchTokenConfig(ctx.connection, ctx.programId, ctx.mint);
  if (!cfg) throw new Error(`no burn_receipts config for mint ${ctx.mint.toBase58()}`);
  const genesis = cfg.config.cluster_genesis.toBase58();
  assertSignableGenesis(genesis, ctx.cluster, rpcGenesis);
  const srcHash = sourceUrlHash(o.sourceUrl);
  const ixs: TransactionInstruction[] = [
    attestReading({
      genesisHash: genesis,
      programId: ctx.programId,
      mint: ctx.mint,
      feedId: cfg.config.feedId,
      prevDate: cfg.config.has_baseline ? cfg.config.last_record_date : 0,
      recordDate: o.recordDate,
      value: o.value,
      valueDecimals: cfg.config.rule.value_decimals,
      sourceUrlHash: srcHash,
      proofHash: o.proofHash,
      signers: o.attesters,
    }).instruction,
    submitReadingIx({ programId: ctx.programId, payer: o.payer.publicKey, mint: ctx.mint, recordDate: o.recordDate, value: o.value, sourceUrlHash: srcHash, proofHash: o.proofHash }),
  ];
  const r = await simulateAndSend(ctx, ixs, [o.payer]);
  return r.ok ? { status: "submitted", signature: r.signature, recordDate: o.recordDate, value: o.value } : { status: "refused", error: r.error, recordDate: o.recordDate, value: o.value };
}

// ----------------------------------------------------------------------------------------------------------------------------------
// Cranking
// ----------------------------------------------------------------------------------------------------------------------------------

export type CrankResult =
  | { status: "idle"; cursor: number }
  | { status: "waiting-for-pool"; recordDate: number }
  | { status: "deferred"; recordDate: number; reason: string | null; logs: string[]; healthCheck?: string | null }
  | { status: "processed"; recordDate: number; signature: string; outcome: string; memo: string | null; reading: ReadingAccount };

/**
 * Errors that mean "not now", not "broken": the next run retries. WsolBalanceMismatch (review-2 F3): the fee PDA's WSOL balance moved
 * between the sync and the swap (the crank's own SyncNative normally prevents it) — retry.
 */
export const DEFERRABLE_ERRORS = new Set(["TwapDeviation", "TwapUnavailable", "PoolNotTradable", "EmptyReserves", "WsolBalanceMismatch", "PairResultPending", ...TARGET_POOL_HELD_ERRORS, ...TARGET_PYTH_RETRY_ERRORS]);
/** Deferrals that are also untradeable observations: crankNext records them with check_pool_health (review-2 F6/F7 continuity). */
export const UNTRADEABLE_ERRORS = new Set(["PoolNotTradable", "EmptyReserves"]);

/** `forward` (LAUNCHPAD-PATH §40): a paired coin that LOST the period — its reading is processed by forward_to_winner instead.
 *  `target` (round 5): a coin with a burn target — crank_target_burn on its PINNED pool (`targetMint` names what burns). */
export interface PlannedCrank { kind: "no_units" | "vault" | "buyback" | "forward" | "target"; recordDate: number; instructions: TransactionInstruction[]; config: TokenConfigAccount; targetMint?: PublicKey }

/** Builds (does not send) the instructions for the next reading in line, or explains why there is nothing to do. */
export async function planCrank(ctx: ProgramContext, cranker: PublicKey): Promise<PlannedCrank | Exclude<CrankResult, { status: "processed" | "deferred" }>> {
  const cfg = await fetchTokenConfig(ctx.connection, ctx.programId, ctx.mint);
  if (!cfg) throw new Error(`no burn_receipts config for mint ${ctx.mint.toBase58()}`);
  const c = cfg.config;
  const next = await fetchNextReadingInLine(ctx.connection, ctx.programId, configPda(ctx.programId, ctx.mint), c.crank_cursor);
  if (!next) return { status: "idle", cursor: c.crank_cursor };
  const recordDate = next.reading.record_date;
  const base = { programId: ctx.programId, cranker, mint: ctx.mint, recordDate };
  if (next.reading.units === BigInt(0)) return { kind: "no_units", recordDate, instructions: [crankNoUnitsIx(base)], config: c };
  if (c.rule.mode !== MODE_BUYBACK) {
    const config = configPda(ctx.programId, ctx.mint);
    return { kind: "vault", recordDate, config: c, instructions: [createAtaIdempotentIx({ payer: cranker, owner: config, mint: ctx.mint, ata: vaultAddress(ctx.programId, ctx.mint) }), crankVaultIx(base)] };
  }
  // Round 5: a target coin trades on its pinned target pool, so it never waits for a pool of its own.
  const burnsTarget = targetCoin(c);
  if (!burnsTarget && !c.poolRegistered) return { status: "waiting-for-pool", recordDate };
  // LAUNCHPAD-PATH §40: a PAIRED coin passes its partner (PairLink + the period's PairResult); if it LOST the period, the reading is
  // processed by forward_to_winner (its fuel → the winner's fee PDA) instead of a buyback.
  let partner: PublicKey | undefined;
  if (c.pair_state === PAIR_STATE_PAIRED) {
    const link = await fetchPairLink(ctx.connection, ctx.programId, ctx.mint);
    if (!link) throw new Error(`paired config ${ctx.mint.toBase58()} has no PairLink`);
    partner = link.pair_mint;
    const result = await fetchPairResult(ctx.connection, ctx.programId, ctx.mint, partner, recordDate);
    // r2 H-1(c): a LOST period whose forward never landed opens the program's time-out PAIR_RESULT_GRACE_SECS after the reading — then
    // the buyback (paired accounts; PairForwardMissing) is the instruction to send, not the forward.
    let lostOpen = pairResultFor(result, ctx.mint) === PAIR_RESULT_LOST;
    if (lostOpen) {
      const slot = await ctx.connection.getSlot("confirmed");
      const chainNow = (await ctx.connection.getBlockTime(slot)) ?? Math.floor(Date.now() / 1000);
      if (chainNow >= Number(next.reading.submitted_at) + PAIR_RESULT_GRACE_SECS) lostOpen = false;
    }
    if (lostOpen) {
      // review I-5: the winner fee PDA's WSOL account must exist for a WSOL leg — create it idempotently first.
      const winnerFee = feePda(ctx.programId, partner);
      return {
        kind: "forward",
        recordDate,
        config: c,
        instructions: [
          createAtaIdempotentIx({ payer: cranker, owner: winnerFee, mint: NATIVE_MINT, ata: feeWsolAddress(ctx.programId, partner) }),
          forwardToWinnerIx({ programId: ctx.programId, cranker, loserMint: ctx.mint, winnerMint: partner, recordDate }),
        ],
      };
    }
  }
  const fee = feePda(ctx.programId, ctx.mint);
  const feeWsol = feeWsolAddress(ctx.programId, ctx.mint);
  if (burnsTarget) {
    const bt = await fetchBurnTarget(ctx.connection, ctx.programId, ctx.mint);
    if (!bt) throw new Error(`config ${ctx.mint.toBase58()} burns a target but has no BurnTarget account`);
    const t = bt.target;
    return {
      kind: "target",
      recordDate,
      config: c,
      targetMint: t.target_mint,
      // the program's LiteSVM suite measures this exact shape at 1,114 bytes (tests/burn_target.rs)
      instructions: [
        createAtaIdempotentIx({ payer: cranker, owner: fee, mint: NATIVE_MINT, ata: feeWsol }),
        createAtaIdempotentIx({ payer: cranker, owner: fee, mint: ctx.mint, ata: feeTokenAddress(ctx.programId, ctx.mint) }),
        createAtaIdempotentIx({ payer: cranker, owner: fee, mint: t.target_mint, ata: feeTargetAddress(ctx.programId, ctx.mint, t.target_mint) }),
        syncNativeIx(feeWsol),
        crankTargetBurnIx({ ...base, target: t, cluster: ctx.cluster, ...(partner ? { partner } : {}) }),
      ],
    };
  }
  const pool = await poolAccountsOrStandIns(ctx, c.cpmm_pool);
  return {
    kind: "buyback",
    recordDate,
    config: c,
    instructions: [
      createAtaIdempotentIx({ payer: cranker, owner: fee, mint: NATIVE_MINT, ata: feeWsol }),
      createAtaIdempotentIx({ payer: cranker, owner: fee, mint: ctx.mint, ata: feeTokenAddress(ctx.programId, ctx.mint) }),
      // Review-2 F3: fold any lamports sent straight to the fee PDA's WSOL account into its balance first (the program also does).
      syncNativeIx(feeWsol),
      crankBuybackIx({ ...base, pool, cluster: ctx.cluster, ...(partner ? { partner } : {}) }),
    ],
  };
}

/**
 * The pool's WSOL reserve net of the fees owed out of the vault (what the constant-product move is measured on), or null when the
 * config has no readable CPMM pool. (Until the owner decision of 2026-10-25 the program also bounded one crank to 2 % of it; no longer.)
 */
export async function poolSolReserve(ctx: ProgramContext): Promise<bigint | null> {
  const cfg = await fetchTokenConfig(ctx.connection, ctx.programId, ctx.mint);
  if (!cfg || !cfg.config.poolRegistered) return null;
  const info = await ctx.connection.getAccountInfo(cfg.config.cpmm_pool, "confirmed");
  if (!info || !info.owner.equals(CPMM_PROGRAM_ID[ctx.cluster])) return null;
  let pool;
  try { pool = decodeCpmmPool(cfg.config.cpmm_pool, info.data); } catch { return null; }
  const wsol0 = pool.token0Mint.equals(NATIVE_MINT);
  const vault = await ctx.connection.getAccountInfo(wsol0 ? pool.token0Vault : pool.token1Vault, "confirmed");
  if (!vault || vault.data.length < 72) return null;
  const amount = Buffer.from(vault.data).readBigUInt64LE(64);
  const fees = wsol0 ? pool.fees0 : pool.fees1;
  return amount > fees ? amount - fees : BigInt(0);
}

/**
 * The registered CPMM pool's price-history ring (cpmm.ts decodeObservationRing), read the way poolSolReserve reads the pool, or null when
 * the config has no readable pool or observation account. The keeper reads it when a crank is deferred with TwapUnavailable, to tell a
 * pool that has never traded (the ring is empty; only a swap fixes it) from one whose history is still too short.
 */
export async function poolObservationRing(ctx: ProgramContext): Promise<ObservationRing | null> {
  const cfg = await fetchTokenConfig(ctx.connection, ctx.programId, ctx.mint);
  if (!cfg || !cfg.config.poolRegistered) return null;
  const info = await ctx.connection.getAccountInfo(cfg.config.cpmm_pool, "confirmed");
  if (!info || !info.owner.equals(CPMM_PROGRAM_ID[ctx.cluster])) return null;
  let pool;
  try { pool = decodeCpmmPool(cfg.config.cpmm_pool, info.data); } catch { return null; }
  const obs = await ctx.connection.getAccountInfo(pool.observationKey, "confirmed");
  if (!obs || !obs.owner.equals(CPMM_PROGRAM_ID[ctx.cluster])) return null;
  try { return decodeObservationRing(obs.data); } catch { return null; }
}

/**
 * The crank_carried transaction's instructions for a piece of at most `maxSpendLamports` (the fee PDA's ATAs first, SyncNative as for
 * crank_buyback), or why there is none: no carried spend, a reading still waiting for its own crank, a coin that is not a self-burn
 * buyback, no pool, or a piece already ran this second (the program's only pacing left after the owner decision of 2026-10-25: one
 * piece per coin per second; there is no carried budget and no per-run bound) — "too-soon" carries the time (ms, local clock) the program
 * will accept it, computed against the CHAIN's clock (the latest block time) so a lagging or leading local clock does not make the keeper
 * retry early.
 * An ENDED rule is not a refusal (round-5 review R5-3 / R5-4, deployed on mainnet 2026-10-15): crank_carried runs after a VOID end (the
 * wind-down's carry) and after a RESOLVED end (the 30-day grace in which forward_on_end / burn_sol_on_end leave the carry on the coin), so
 * the plan is the same as for a live rule — the TWAP, pool and reserve checks are the program's either way.
 */
export async function planCarriedCrank(ctx: ProgramContext, cranker: PublicKey, maxSpendLamports: bigint, nowMs: number = Date.now()): Promise<{ instructions: TransactionInstruction[]; carriedLamports: bigint; throughDate: number } | { status: "nothing-carried" | "reading-pending" | "not-buyback" | "waiting-for-pool" } | { status: "too-soon"; nextAtMs: number }> {
  const cfg = await fetchTokenConfig(ctx.connection, ctx.programId, ctx.mint);
  if (!cfg) throw new Error(`no burn_receipts config for mint ${ctx.mint.toBase58()}`);
  const c = cfg.config;
  if (c.rule.mode !== MODE_BUYBACK || targetCoin(c)) return { status: "not-buyback" };
  if (!c.poolRegistered) return { status: "waiting-for-pool" };
  if (c.has_baseline && c.crank_cursor !== c.last_record_date) return { status: "reading-pending" };
  if (c.carried_spend_lamports <= BigInt(0)) return { status: "nothing-carried" };
  const pace = await carriedPaceView(ctx);
  if (pace && pace.lastCarriedAt > 0) {
    const chainNow = pace.chainNowSec ?? Math.floor(nowMs / 1000);
    if (chainNow <= pace.lastCarriedAt) return { status: "too-soon", nextAtMs: nowMs + (pace.lastCarriedAt + 1 - chainNow) * 1000 };
  }
  const pool = await poolAccountsOrStandIns(ctx, c.cpmm_pool);
  const fee = feePda(ctx.programId, ctx.mint);
  const feeWsol = feeWsolAddress(ctx.programId, ctx.mint);
  return {
    carriedLamports: c.carried_spend_lamports,
    throughDate: c.crank_cursor,
    instructions: [
      createAtaIdempotentIx({ payer: cranker, owner: fee, mint: NATIVE_MINT, ata: feeWsol }),
      createAtaIdempotentIx({ payer: cranker, owner: fee, mint: ctx.mint, ata: feeTokenAddress(ctx.programId, ctx.mint) }),
      syncNativeIx(feeWsol),
      crankCarriedIx({ programId: ctx.programId, cranker, mint: ctx.mint, pool, cluster: ctx.cluster, maxSpendLamports }),
    ],
  };
}

/** The chain's clock: the block time of the latest confirmed slot (unix seconds), or null when the RPC cannot say. */
export async function chainNowSec(connection: Connection): Promise<number | null> {
  try { return await connection.getBlockTime(await connection.getSlot("confirmed")); } catch { return null; }
}

/** The coin's CarriedPace as the program judges it (lastCarriedAt 0 = never ran a piece). budgetLamports is always 0 since the owner
 *  decision of 2026-10-25 (the program writes 0; the field stays for the unchanged layout). */
export async function carriedPaceView(ctx: ProgramContext): Promise<{ lastCarriedAt: number; budgetLamports: bigint; chainNowSec: number | null }> {
  const pace = await fetchCarriedPace(ctx.connection, ctx.programId, ctx.mint);
  return { lastCarriedAt: pace ? Number(pace.last_carried_at) : 0, budgetLamports: pace?.budget_lamports ?? BigInt(0), chainNowSec: pace ? await chainNowSec(ctx.connection) : null };
}

export async function crankNext(ctx: ProgramContext, cranker: Keypair): Promise<CrankResult> {
  await assertClusterAllowed(ctx);
  const plan = await planCrank(ctx, cranker.publicKey);
  if ("status" in plan) return plan;
  const r = await simulateAndSend(ctx, plan.instructions, [cranker]);
  if (!r.ok) {
    if (r.error && DEFERRABLE_ERRORS.has(r.error)) {
      // An untradeable pool is recorded on chain (one observation per run keeps the 24 h continuity the replacement / queue-unblock
      // rules need); a failure to record is not an error of the crank.
      let healthCheck: string | null | undefined;
      if (UNTRADEABLE_ERRORS.has(r.error)) {
        const h = await checkPoolHealth(ctx, cranker).catch(() => ({ ok: false as const, error: null }));
        healthCheck = h.ok ? (h.signature ?? null) : null;
      }
      return { status: "deferred", recordDate: plan.recordDate, reason: r.error, logs: r.logs, ...(healthCheck !== undefined ? { healthCheck } : {}) };
    }
    throw new Error(`crank ${plan.kind} ${plan.recordDate} refused: ${r.error}\n${r.logs.join("\n")}`);
  }
  const reading = await fetchReading(ctx.connection, ctx.programId, configPda(ctx.programId, ctx.mint), plan.recordDate);
  if (!reading?.processed) throw new Error(`crank ${plan.recordDate} confirmed but the reading is not processed`);
  return { status: "processed", recordDate: plan.recordDate, signature: r.signature, outcome: OUTCOME_NAMES[reading.outcome] ?? String(reading.outcome), memo: memoFromTransaction(r.parsed, ctx.programId, plan.recordDate), reading };
}

/** Cranks until idle, deferred or waiting (at most `max` readings per call). */
export async function crankAll(ctx: ProgramContext, cranker: Keypair, max = 30): Promise<CrankResult[]> {
  const out: CrankResult[] = [];
  for (let i = 0; i < max; i++) {
    const r = await crankNext(ctx, cranker);
    out.push(r);
    if (r.status !== "processed") break;
  }
  return out;
}

/**
 * Re-check R3-5: an RPC URL for logs and printed JSON — scheme + host[:port] only, so an API key carried in the path, the query or
 * the userinfo of a provider URL is never printed.
 */
export function redactRpcUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return "<unparseable rpc url>";
  }
}

/** The token's LaunchLab platform (LaunchpadPool.platformId at byte 173 of ["pool", mint, WSOL] under LaunchLab). */
export async function fetchLaunchLabPlatformId(connection: Connection, cluster: Cluster, mint: PublicKey): Promise<PublicKey> {
  const ll = LAUNCHLAB_PROGRAM_ID[cluster];
  const address = launchlabPoolPda(ll, mint);
  const info = await connection.getAccountInfo(address, "confirmed");
  if (!info || !info.owner.equals(ll) || info.data.length < LL_POOL_PLATFORM_ID + 32) throw new Error(`no LaunchLab pool for ${mint.toBase58()} at ${address.toBase58()}`);
  return new PublicKey(info.data.subarray(LL_POOL_PLATFORM_ID, LL_POOL_PLATFORM_ID + 32));
}

/**
 * Permissionless pool registration once LaunchLab has migrated the token to its CPMM pool (policy 0), or verification of the fixed
 * pool (policy 1). Reads the pool's LP mint and (policy 0) the LaunchLab platform from chain.
 */
export async function registerPool(ctx: ProgramContext, payer: Keypair, pool: PublicKey): Promise<{ ok: boolean; signature?: string; error?: string | null }> {
  await assertClusterAllowed(ctx);
  const cfg = await fetchTokenConfig(ctx.connection, ctx.programId, ctx.mint);
  if (!cfg) throw new Error(`no burn_receipts config for mint ${ctx.mint.toBase58()}`);
  const p = await fetchCpmmPool(ctx.connection, pool, CPMM_PROGRAM_ID[ctx.cluster]);
  // Review-3 M-3: the program compares against the platform pinned at initialize_token — no platform account is passed any more.
  const ix = registerPoolIx({ programId: ctx.programId, registrar: payer.publicKey, mint: ctx.mint, pool, lpMint: p.lpMint, cluster: ctx.cluster, fixedPool: cfg.config.registration_policy !== POOL_POLICY_CREATOR_IS_FEE_PDA });
  const r = await simulateAndSend(ctx, [ix], [payer]);
  return r.ok ? { ok: true, signature: r.signature } : { ok: false, error: r.error };
}

/**
 * Review H-2: claim LaunchLab's bonding-curve creator fee into the fee PDA's WSOL account (permissionless; the fee PDA is the
 * LaunchLab creator and the program signs for it). The payer creates the WSOL ATA first if needed (the program never pays for it).
 */
export async function claimLaunchLabCreatorFee(ctx: ProgramContext, payer: Keypair): Promise<{ ok: boolean; signature?: string; error?: string | null }> {
  await assertClusterAllowed(ctx);
  const fee = feePda(ctx.programId, ctx.mint);
  const r = await simulateAndSend(ctx, [
    createAtaIdempotentIx({ payer: payer.publicKey, owner: fee, mint: NATIVE_MINT, ata: feeWsolAddress(ctx.programId, ctx.mint) }),
    claimLaunchlabCreatorFeeIx({ programId: ctx.programId, payer: payer.publicKey, mint: ctx.mint, cluster: ctx.cluster }),
  ], [payer]);
  return r.ok ? { ok: true, signature: r.signature } : { ok: false, error: r.error };
}

/** Review M-4 / review-2 F6: record (or clear) the registered pool's untradeability (permissionless; see check_pool_health). */
export async function checkPoolHealth(ctx: ProgramContext, payer: Keypair): Promise<{ ok: boolean; signature?: string; error?: string | null }> {
  await assertClusterAllowed(ctx);
  const cfg = await fetchTokenConfig(ctx.connection, ctx.programId, ctx.mint);
  if (!cfg?.config.poolRegistered) throw new Error("no pool registered");
  const pool = await poolAccountsOrStandIns(ctx, cfg.config.cpmm_pool);
  const r = await simulateAndSend(ctx, [checkPoolHealthIx({ programId: ctx.programId, caller: payer.publicKey, mint: ctx.mint, pool: pool.pool, wsolVault: pool.wsolVault })], [payer]);
  return r.ok ? { ok: true, signature: r.signature } : { ok: false, error: r.error };
}
