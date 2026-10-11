import { type AccountMeta, ComputeBudgetProgram, type Connection, type Keypair, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, CPMM_PROGRAM_ID, type Cluster, GENESIS_HASH, NATIVE_MINT, PACKET_DATA_SIZE, PAIR_CURVE_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@/lib/burnReceipts/constants";
import { bs58, decodeTokenConfig } from "@/lib/burnReceipts/accounts";
import { encodeInstruction } from "@/lib/burnReceipts/idlCoder";
import { registerPairPoolIx } from "@/lib/burnReceipts/instructions";
import { configPda, feePda } from "@/lib/burnReceipts/pda";
import { anchorErrorName, confirmByPolling } from "@/lib/burnReceipts/crank";
import { PAIR_CURVE_IDL } from "@/lib/pairCurve/idl";
import { ata, CPMM_CREATE_POOL_FEE_RECEIVER, fetchPair, type PairAccount, pairPda, sidePoolAccounts, STATUS_GRADUATED, STATUS_GRADUATING, STATUS_OPEN, vaultPda } from "@/lib/pairCurve/accounts";
import { graduationReady, TOKEN_DECIMALS } from "@/lib/pairCurve/pricing";

/**
 * pair_curve TypeScript client: instruction builders driven by the program's IDL (src/lib/pairCurve/idl.ts — account order and flags
 * come from it, so a builder cannot drift), the mint-creation instructions a launcher sends before init_pair, the crank planner the
 * keeper runs (graduate per side + register_pair_pool, or void), and a simulate-then-send helper. Design: docs/burnticker/PAIR-CURVE.md.
 *
 * MAINNET IS REFUSED unless `allowMainnet` (checked against the RPC's genesis hash, not the `cluster` label) — the owner deploys.
 */

const IDL = PAIR_CURVE_IDL;
export const PAIR_CURVE_ID = PAIR_CURVE_PROGRAM_ID;

export const pairCurveEventAuthority = (programId: PublicKey = PAIR_CURVE_ID): PublicKey => PublicKey.findProgramAddressSync([Buffer.from("__event_authority", "utf8")], programId)[0];

function build(programId: PublicKey, name: string, accounts: Record<string, PublicKey>, args: Record<string, unknown>): TransactionInstruction {
  const ix = IDL.instructions.find((i) => i.name === name);
  if (!ix) throw new Error(`pair_curve IDL has no instruction ${name}`);
  const auto: Record<string, PublicKey> = { event_authority: pairCurveEventAuthority(programId), program: programId, rent: SYSVAR_RENT_PUBKEY };
  const keys: AccountMeta[] = ix.accounts.map((a) => {
    const given = accounts[a.name] ?? auto[a.name] ?? (a.address ? new PublicKey(a.address) : undefined);
    if (!given) throw new Error(`pair_curve ${name}: account ${a.name} missing`);
    return { pubkey: given, isSigner: !!a.signer, isWritable: !!a.writable };
  });
  return new TransactionInstruction({ programId, keys, data: encodeInstruction(IDL, name, args) });
}

export interface InitPairArgs {
  pair_id: Uint8Array;
  virtual_sol_lamports: bigint;
  virtual_token_amount: bigint;
  curve_supply: bigint;
  target_raise_lamports: bigint;
  min_side_share_bps: number;
  deadline: bigint;
}

/**
 * The two instructions that create a pair mint BEFORE init_pair: a classic SPL mint (82 bytes, 6 decimals, no freeze authority) whose
 * mint authority is the pair's SOL vault PDA. The mint keypair signs. (A launcher that wants Metaplex metadata creates the mint with
 * its own key as authority, adds metadata, then SetAuthority → the vault PDA; init_pair only checks the end state.)
 */
export function createPairMintIxs(o: { payer: PublicKey; mint: PublicKey; vault: PublicKey; rentLamports: number }): TransactionInstruction[] {
  const create = SystemProgram.createAccount({ fromPubkey: o.payer, newAccountPubkey: o.mint, lamports: o.rentLamports, space: 82, programId: TOKEN_PROGRAM_ID });
  // SPL Token InitializeMint2 (20): decimals, mint authority, freeze authority option (0 = none).
  const data = Buffer.concat([Buffer.from([20, TOKEN_DECIMALS]), o.vault.toBuffer(), Buffer.from([0])]);
  const init = new TransactionInstruction({ programId: TOKEN_PROGRAM_ID, keys: [{ pubkey: o.mint, isSigner: false, isWritable: true }], data });
  return [create, init];
}

export function initPairIx(o: { payer: PublicKey; creator: PublicKey; mintA: PublicKey; mintB: PublicKey; args: InitPairArgs; launchlabPlatform: PublicKey; ammConfig: PublicKey; burnReceiptsProgramId: PublicKey; programId?: PublicKey }): TransactionInstruction {
  const programId = o.programId ?? PAIR_CURVE_ID;
  const pair = pairPda(o.mintA, o.mintB, programId);
  const vault = vaultPda(pair, programId);
  return build(programId, "init_pair", {
    payer: o.payer, creator: o.creator, mint_a: o.mintA, mint_b: o.mintB, pair, vault,
    token_vault_a: ata(vault, o.mintA), token_vault_b: ata(vault, o.mintB),
    config_a: configPda(o.burnReceiptsProgramId, o.mintA), config_b: configPda(o.burnReceiptsProgramId, o.mintB),
    launchlab_platform: o.launchlabPlatform, amm_config: o.ammConfig,
  }, { args: o.args });
}

export function buyIx(o: { buyer: PublicKey; pairAddress: PublicKey; pair: PairAccount; side: 0 | 1; maxLamportsIn: bigint; minTokensOut: bigint; programId?: PublicKey }): TransactionInstruction {
  const mint = o.pair.mints[o.side];
  return build(o.programId ?? PAIR_CURVE_ID, "buy", {
    buyer: o.buyer, pair: o.pairAddress, vault: o.pair.vault, mint, token_vault: o.pair.token_vaults[o.side], buyer_token: ata(o.buyer, mint),
    fee_vault: o.pair.fee_vaults[o.side], dev_wallet: o.pair.dev_wallet,
  }, { side: o.side, max_lamports_in: o.maxLamportsIn, min_tokens_out: o.minTokensOut });
}

export function sellIx(o: { seller: PublicKey; pairAddress: PublicKey; pair: PairAccount; side: 0 | 1; amount: bigint; minLamportsOut: bigint; programId?: PublicKey }): TransactionInstruction {
  const mint = o.pair.mints[o.side];
  return build(o.programId ?? PAIR_CURVE_ID, "sell", {
    seller: o.seller, pair: o.pairAddress, vault: o.pair.vault, mint, token_vault: o.pair.token_vaults[o.side], seller_token: ata(o.seller, mint),
    fee_vault: o.pair.fee_vaults[o.side], dev_wallet: o.pair.dev_wallet,
  }, { side: o.side, amount: o.amount, min_lamports_out: o.minLamportsOut });
}

/** graduate(side): the CPMM program id and its create-pool-fee receiver are per cluster (the IDL carries the mainnet build's). */
export function graduateIx(o: { cranker: PublicKey; pairAddress: PublicKey; pair: PairAccount; side: 0 | 1; cluster: Cluster; programId?: PublicKey }): TransactionInstruction {
  const programId = o.programId ?? PAIR_CURVE_ID;
  const mint = o.pair.mints[o.side];
  const s = sidePoolAccounts(o.cluster, o.pairAddress, o.side, mint, programId);
  return build(programId, "graduate", {
    cranker: o.cranker, pair: o.pairAddress, vault: o.pair.vault, vault_wsol: o.pair.vault_wsol, wsol_mint: NATIVE_MINT, amm_config: o.pair.cp_config,
    cpmm_authority: s.cpmmAuthority, create_pool_fee: CPMM_CREATE_POOL_FEE_RECEIVER[o.cluster], mint, token_vault: o.pair.token_vaults[o.side],
    pool: s.pool, lp_mint: s.lpMint, vault_lp: s.vaultLp, pool_vault_0: s.poolVault0, pool_vault_1: s.poolVault1, observation: s.observation,
    fee_vault: o.pair.fee_vaults[o.side], cpmm_program: CPMM_PROGRAM_ID[o.cluster], token_program: TOKEN_PROGRAM_ID, associated_token_program: ASSOCIATED_TOKEN_PROGRAM_ID,
    system_program: SystemProgram.programId,
  }, { side: o.side });
}

export function voidPairIx(o: { caller: PublicKey; pairAddress: PublicKey; programId?: PublicKey }): TransactionInstruction {
  return build(o.programId ?? PAIR_CURVE_ID, "void_pair", { caller: o.caller, pair: o.pairAddress }, {});
}

export function closePairIx(o: { caller: PublicKey; pairAddress: PublicKey; pair: PairAccount; programId?: PublicKey }): TransactionInstruction {
  return build(o.programId ?? PAIR_CURVE_ID, "close_pair", {
    caller: o.caller, pair: o.pairAddress, creator: o.pair.creator, vault: o.pair.vault, mint_a: o.pair.mints[0], mint_b: o.pair.mints[1],
    token_vault_a: o.pair.token_vaults[0], token_vault_b: o.pair.token_vaults[1], fee_vault_a: o.pair.fee_vaults[0], fee_vault_b: o.pair.fee_vaults[1],
  }, {});
}

/** burn_receipts.register_pair_pool for one side (the pool and LP mint derived from the pair). */
export function registerSideIx(o: { registrar: PublicKey; pairAddress: PublicKey; pair: PairAccount; side: 0 | 1; cluster: Cluster; burnReceiptsProgramId: PublicKey; programId?: PublicKey }): TransactionInstruction {
  const s = sidePoolAccounts(o.cluster, o.pairAddress, o.side, o.pair.mints[o.side], o.programId ?? PAIR_CURVE_ID);
  return registerPairPoolIx({ programId: o.burnReceiptsProgramId, registrar: o.registrar, mint: o.pair.mints[o.side], pool: s.pool, lpMint: s.lpMint, pair: o.pairAddress });
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The crank: what a permissionless cranker (the keeper) should send next for one pair
// ---------------------------------------------------------------------------------------------------------------------------------

export type CrankAction =
  | { kind: "graduate"; side: 0 | 1; register: boolean; why: string }
  | { kind: "register"; side: 0 | 1; why: string }
  | { kind: "void"; why: string }
  | { kind: "wait"; why: string };

/**
 * The next actions for a pair, in order. `registered[side]` = that mint's TokenConfig already has a verified pool. Open + ready +
 * before the deadline → graduate both sides (each with its register_pair_pool in the same transaction); Graduating → the missing side;
 * Graduated → any registration still missing; Open at/after the deadline → void. Everything else waits.
 */
export function planPairCrank(p: PairAccount, now: number, registered: [boolean, boolean]): CrankAction[] {
  const deadline = Number(p.deadline);
  const missingPool = (s: 0 | 1) => p.pools[s].equals(PublicKey.default);
  if (p.status === STATUS_OPEN) {
    if (now >= deadline) return [{ kind: "void", why: `the deadline ${new Date(deadline * 1000).toISOString()} passed without graduation` }];
    if (graduationReady(p.sol[0], p.sol[1], p.target_raise_lamports, p.min_side_share_bps)) {
      return [0, 1].map((s) => ({ kind: "graduate" as const, side: s as 0 | 1, register: !registered[s], why: "combined raise at target and both sides at their minimum share" }));
    }
    return [{ kind: "wait", why: `raise ${p.sol[0] + p.sol[1]} of ${p.target_raise_lamports} lamports (or a side under ${p.min_side_share_bps} bps)` }];
  }
  if (p.status === STATUS_GRADUATING) {
    const out: CrankAction[] = [];
    for (const s of [0, 1] as const) {
      if (missingPool(s)) out.push({ kind: "graduate", side: s, register: !registered[s], why: "graduation started; this side's pool is still to create" });
      else if (!registered[s]) out.push({ kind: "register", side: s, why: "this side's pool exists but is not registered in burn_receipts" });
    }
    return out;
  }
  if (p.status === STATUS_GRADUATED) {
    const out: CrankAction[] = [];
    for (const s of [0, 1] as const) if (!registered[s]) out.push({ kind: "register", side: s, why: "graduated; the pool is not registered in burn_receipts yet" });
    return out.length ? out : [{ kind: "wait", why: "graduated and registered — nothing to do" }];
  }
  return [{ kind: "wait", why: "voided — holders sell back on the curve; nothing to crank" }];
}

export interface PairCurveContext {
  connection: Connection;
  cluster: Cluster;
  burnReceiptsProgramId: PublicKey;
  programId?: PublicKey;
  allowMainnet?: boolean;
  computeUnits?: number;
}

/** The RPC's genesis must match `cluster`; mainnet only with allowMainnet. */
export async function assertPairCurveCluster(ctx: PairCurveContext): Promise<void> {
  const g = await ctx.connection.getGenesisHash();
  if (g === GENESIS_HASH.mainnet && !ctx.allowMainnet) throw new Error("pairCurve: the RPC is mainnet — refused (the owner deploys and sends on mainnet)");
  if (ctx.cluster === "devnet" && g !== GENESIS_HASH.devnet) throw new Error(`pairCurve: cluster devnet but the RPC's genesis is ${g}`);
  if (ctx.cluster === "mainnet" && g !== GENESIS_HASH.mainnet) throw new Error(`pairCurve: cluster mainnet but the RPC's genesis is ${g}`);
}

export interface SendResult { ok: boolean; signature?: string; error?: string | null; logs: string[]; units?: number | null; size?: number }

/** Compute-budget + `ixs` as a legacy transaction (must fit 1,232 bytes), simulated first, sent, confirmed by polling. */
export async function simulateAndSend(ctx: PairCurveContext, ixs: TransactionInstruction[], signers: Keypair[], o: { dryRun?: boolean } = {}): Promise<SendResult> {
  const { blockhash, lastValidBlockHeight } = await ctx.connection.getLatestBlockhash("confirmed");
  const msg = new TransactionMessage({ payerKey: signers[0].publicKey, recentBlockhash: blockhash, instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: ctx.computeUnits ?? 600_000 }), ...ixs] });
  const tx = new VersionedTransaction(msg.compileToLegacyMessage());
  tx.sign(signers);
  const size = tx.serialize().length;
  if (size > PACKET_DATA_SIZE) return { ok: false, error: `transaction is ${size} bytes (limit ${PACKET_DATA_SIZE})`, logs: [], size };
  const sim = await ctx.connection.simulateTransaction(tx, { commitment: "confirmed" });
  const simLogs = sim.value.logs ?? [];
  if (sim.value.err) return { ok: false, error: anchorErrorName(simLogs) ?? JSON.stringify(sim.value.err), logs: simLogs, units: sim.value.unitsConsumed ?? null, size };
  if (o.dryRun) return { ok: true, logs: simLogs, units: sim.value.unitsConsumed ?? null, size };
  const signature = await ctx.connection.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 5 });
  const err = await confirmByPolling(ctx.connection, signature, lastValidBlockHeight);
  if (err) return { ok: false, signature, error: JSON.stringify(err), logs: simLogs, size };
  const landed = await ctx.connection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  return { ok: true, signature, logs: landed?.meta?.logMessages ?? simLogs, units: landed?.meta?.computeUnitsConsumed ?? sim.value.unitsConsumed ?? null, size };
}

/** Whether each side's TokenConfig already has a verified pool. */
export async function registeredSides(ctx: PairCurveContext, p: PairAccount): Promise<[boolean, boolean]> {
  const out: boolean[] = [];
  for (const m of p.mints) {
    const a = await ctx.connection.getAccountInfo(configPda(ctx.burnReceiptsProgramId, m), "confirmed");
    out.push(!!a && decodeTokenConfig(a.data).pool_verified);
  }
  return [out[0], out[1]];
}

export interface CrankStep { action: CrankAction; result: SendResult | null }

/** Plans and executes one pair's crank (graduate per side with its registration, register, or void). Stops at the first failure. */
export async function crankPair(ctx: PairCurveContext, cranker: Keypair, pairAddress: PublicKey, o: { now?: number; dryRun?: boolean; log?: (s: string) => void } = {}): Promise<CrankStep[]> {
  await assertPairCurveCluster(ctx);
  const steps: CrankStep[] = [];
  const now = o.now ?? Math.floor(Date.now() / 1000);
  let p = await fetchPair(ctx.connection, pairAddress);
  if (!p) return [{ action: { kind: "wait", why: "no Pair account" }, result: null }];
  const actions = planPairCrank(p, now, await registeredSides(ctx, p));
  for (const action of actions) {
    if (action.kind === "wait") { steps.push({ action, result: null }); continue; }
    p = (await fetchPair(ctx.connection, pairAddress)) ?? p;
    const ixs: TransactionInstruction[] = [];
    if (action.kind === "void") ixs.push(voidPairIx({ caller: cranker.publicKey, pairAddress, programId: ctx.programId }));
    if (action.kind === "graduate") ixs.push(graduateIx({ cranker: cranker.publicKey, pairAddress, pair: p, side: action.side, cluster: ctx.cluster, programId: ctx.programId }));
    if (action.kind === "register" || (action.kind === "graduate" && action.register)) ixs.push(registerSideIx({ registrar: cranker.publicKey, pairAddress, pair: p, side: action.side, cluster: ctx.cluster, burnReceiptsProgramId: ctx.burnReceiptsProgramId, programId: ctx.programId }));
    const result = await simulateAndSend(ctx, ixs, [cranker], { dryRun: o.dryRun });
    o.log?.(`  [pair-curve] ${pairAddress.toBase58().slice(0, 8)}… ${action.kind}${"side" in action ? `(${action.side === 0 ? "A" : "B"})` : ""}: ${result.ok ? (result.signature ?? "simulated ok") : `refused — ${result.error}`}${result.units ? ` · ${result.units} CU` : ""}`);
    steps.push({ action, result });
    if (!result.ok || o.dryRun) break;
  }
  return steps;
}

/** The fee PDA of a pair mint (burn_receipts ["fee", mint]) — the burn pool its 75 bps go to. */
export const burnPoolOf = (burnReceiptsProgramId: PublicKey, mint: PublicKey): PublicKey => feePda(burnReceiptsProgramId, mint);

/** A pair id as the program stores it: sha256 of the registry's pairId string. */
export async function pairIdHash(pairId: string): Promise<Uint8Array> {
  const { createHash } = await import("node:crypto");
  return Uint8Array.from(createHash("sha256").update(pairId, "utf8").digest());
}

export const shortSig = (sig: Uint8Array): string => bs58(sig);
