import { type AccountMeta, ComputeBudgetProgram, type Connection, type Keypair, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, CPMM_PROGRAM_ID, type Cluster, GENESIS_HASH, LOCK_CPMM_AUTHORITY, LOCK_CPMM_PROGRAM_ID, NATIVE_MINT, PACKET_DATA_SIZE, PAIR_CURVE_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@/lib/burnReceipts/constants";
import { bs58, decodeTokenConfig } from "@/lib/burnReceipts/accounts";
import { encodeInstruction } from "@/lib/burnReceipts/idlCoder";
import { registerFeeKeyIx, registerPairPoolIx } from "@/lib/burnReceipts/instructions";
import { configPda, feeKeyRecordPda, feeKeysPda, feeNftAccount, feePda, lockedLiquidityPda, lpLockVault } from "@/lib/burnReceipts/pda";
import { anchorErrorName, confirmByPolling } from "@/lib/burnReceipts/crank";
import { PAIR_CURVE_IDL } from "@/lib/pairCurve/idl";
import { ata, CPMM_CREATE_POOL_FEE_RECEIVER, feeNftMintPda, fetchPair, METADATA_PROGRAM_ID, metadataPda, type PairAccount, pairPda, sidePoolAccounts, STATUS_GRADUATED, STATUS_GRADUATING, STATUS_OPEN, STATUS_VOIDED, vaultPda } from "@/lib/pairCurve/accounts";
import { GRADUATION_STUCK_SECS, graduationReady, TOKEN_DECIMALS } from "@/lib/pairCurve/pricing";

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

/** buy: every lamport goes to the SOL vault (cost + fee; the fee is accounted there — escrow for the burn pool, accrual for the
 * developer). `amm_config` is read for the commit rule (the trade that leaves the pair ready commits it). */
export function buyIx(o: { buyer: PublicKey; pairAddress: PublicKey; pair: PairAccount; side: 0 | 1; maxLamportsIn: bigint; minTokensOut: bigint; programId?: PublicKey }): TransactionInstruction {
  const mint = o.pair.mints[o.side];
  return build(o.programId ?? PAIR_CURVE_ID, "buy", {
    buyer: o.buyer, pair: o.pairAddress, vault: o.pair.vault, mint, token_vault: o.pair.token_vaults[o.side], buyer_token: ata(o.buyer, mint),
    amm_config: o.pair.cp_config,
  }, { side: o.side, max_lamports_in: o.maxLamportsIn, min_tokens_out: o.minTokensOut });
}

export function sellIx(o: { seller: PublicKey; pairAddress: PublicKey; pair: PairAccount; side: 0 | 1; amount: bigint; minLamportsOut: bigint; programId?: PublicKey }): TransactionInstruction {
  const mint = o.pair.mints[o.side];
  return build(o.programId ?? PAIR_CURVE_ID, "sell", {
    seller: o.seller, pair: o.pairAddress, vault: o.pair.vault, mint, token_vault: o.pair.token_vaults[o.side], seller_token: ata(o.seller, mint),
    amm_config: o.pair.cp_config,
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

/** void_pair: the whole pair after the deadline, or a stuck side Raydium blocks ≥ 3 days after the commit (the AmmConfig is the evidence). */
export function voidPairIx(o: { caller: PublicKey; pairAddress: PublicKey; pair: PairAccount; programId?: PublicKey }): TransactionInstruction {
  return build(o.programId ?? PAIR_CURVE_ID, "void_pair", { caller: o.caller, pair: o.pairAddress, amm_config: o.pair.cp_config }, {});
}

/** claim_developer_fee: pays the accrued 25 bps to the developer wallet recorded at init (permissionless). */
export function claimDeveloperFeeIx(o: { caller: PublicKey; pairAddress: PublicKey; pair: PairAccount; programId?: PublicKey }): TransactionInstruction {
  return build(o.programId ?? PAIR_CURVE_ID, "claim_developer_fee", { caller: o.caller, pair: o.pairAddress, vault: o.pair.vault, dev_wallet: o.pair.dev_wallet, system_program: SystemProgram.programId }, {});
}

export function closePairIx(o: { caller: PublicKey; pairAddress: PublicKey; pair: PairAccount; programId?: PublicKey }): TransactionInstruction {
  return build(o.programId ?? PAIR_CURVE_ID, "close_pair", {
    caller: o.caller, pair: o.pairAddress, creator: o.pair.creator, vault: o.pair.vault, mint_a: o.pair.mints[0], mint_b: o.pair.mints[1],
    token_vault_a: o.pair.token_vaults[0], token_vault_b: o.pair.token_vaults[1], fee_vault_a: o.pair.fee_vaults[0], fee_vault_b: o.pair.fee_vaults[1],
    dev_wallet: o.pair.dev_wallet,
  }, {});
}

/** burn_receipts.register_pair_pool for one side (the pool and LP mint derived from the pair). */
export function registerSideIx(o: { registrar: PublicKey; pairAddress: PublicKey; pair: PairAccount; side: 0 | 1; cluster: Cluster; burnReceiptsProgramId: PublicKey; programId?: PublicKey }): TransactionInstruction {
  const s = sidePoolAccounts(o.cluster, o.pairAddress, o.side, o.pair.mints[o.side], o.programId ?? PAIR_CURVE_ID);
  return registerPairPoolIx({ programId: o.burnReceiptsProgramId, registrar: o.registrar, mint: o.pair.mints[o.side], pool: s.pool, lpMint: s.lpMint, pair: o.pairAddress, cluster: o.cluster });
}

/**
 * lock_lp(side) (LAUNCHPAD-PATH §35) — permissionless, once per side after graduate: all of the vault's LP into Raydium's CPMM lock
 * forever, Fee Key NFT (mint = the pair_curve PDA ["fee_nft", pair, [side]]) to burn_receipts' FEE_KEYS PDA. The cranker pays the
 * lock's rents (≈ 0.0065 SOL); the emptied LP account's rent goes to the side's burn pool.
 */
export function lockLpIx(o: { cranker: PublicKey; pairAddress: PublicKey; pair: PairAccount; side: 0 | 1; cluster: Cluster; burnReceiptsProgramId: PublicKey; programId?: PublicKey }): TransactionInstruction {
  const programId = o.programId ?? PAIR_CURVE_ID;
  const s = sidePoolAccounts(o.cluster, o.pairAddress, o.side, o.pair.mints[o.side], programId);
  const nft = feeNftMintPda(o.pairAddress, o.side, programId);
  return build(programId, "lock_lp", {
    cranker: o.cranker, pair: o.pairAddress, vault: o.pair.vault, pool_state: s.pool, lp_mint: s.lpMint, vault_lp: s.vaultLp,
    fee_vault: o.pair.fee_vaults[o.side], fee_nft_mint: nft, fee_nft_account: feeNftAccount(o.burnReceiptsProgramId, nft), fee_keys: feeKeysPda(o.burnReceiptsProgramId),
    locked_liquidity: lockedLiquidityPda(o.cluster, nft), lock_lp_vault: lpLockVault(o.cluster, s.lpMint), token_0_vault: s.poolVault0, token_1_vault: s.poolVault1,
    metadata_account: metadataPda(nft), lock_program: LOCK_CPMM_PROGRAM_ID[o.cluster], lock_authority: LOCK_CPMM_AUTHORITY[o.cluster], metadata_program: METADATA_PROGRAM_ID,
    system_program: SystemProgram.programId, token_program: TOKEN_PROGRAM_ID, associated_token_program: ASSOCIATED_TOKEN_PROGRAM_ID,
  }, { side: o.side });
}

/** burn_receipts.register_fee_key for a pair side (its Fee Key is the pair_curve PDA ["fee_nft", pair, [side]]). */
export function registerSideFeeKeyIx(o: { payer: PublicKey; pairAddress: PublicKey; pair: PairAccount; side: 0 | 1; cluster: Cluster; burnReceiptsProgramId: PublicKey; programId?: PublicKey }): TransactionInstruction {
  const programId = o.programId ?? PAIR_CURVE_ID;
  const s = sidePoolAccounts(o.cluster, o.pairAddress, o.side, o.pair.mints[o.side], programId);
  return registerFeeKeyIx({ programId: o.burnReceiptsProgramId, payer: o.payer, mint: o.pair.mints[o.side], pool: s.pool, feeNftMint: feeNftMintPda(o.pairAddress, o.side, programId), cluster: o.cluster, lpMint: s.lpMint });
}

/** pair_curve's 30-day LP-lock fallback (lp-lock blind review L-2): LP_LOCK_FALLBACK_SECS after the graduation decision. */
export const LP_LOCK_FALLBACK_SECS = 30 * 24 * 60 * 60;

/**
 * burn_lp(side) (lp-lock blind review L-2) — permissionless fallback, once per side, only if lock_lp has not run LP_LOCK_FALLBACK_SECS
 * after the graduation decision (Raydium's lock program refused or changed): burns all of the vault's LP and records it in lp_locked,
 * so register_pair_pool still accepts the side (burned + locked); the side's LP fees are forgone. The ONLY instruction that destroys LP.
 */
export function burnLpIx(o: { cranker: PublicKey; pairAddress: PublicKey; pair: PairAccount; side: 0 | 1; cluster: Cluster; programId?: PublicKey }): TransactionInstruction {
  const programId = o.programId ?? PAIR_CURVE_ID;
  const s = sidePoolAccounts(o.cluster, o.pairAddress, o.side, o.pair.mints[o.side], programId);
  return build(programId, "burn_lp", {
    cranker: o.cranker, pair: o.pairAddress, vault: o.pair.vault, pool_state: s.pool, lp_mint: s.lpMint, vault_lp: s.vaultLp,
    fee_vault: o.pair.fee_vaults[o.side], token_program: TOKEN_PROGRAM_ID,
  }, { side: o.side });
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The crank: what a permissionless cranker (the keeper) should send next for one pair
// ---------------------------------------------------------------------------------------------------------------------------------

export type CrankAction =
  | { kind: "graduate"; side: 0 | 1; why: string }
  | { kind: "lock"; side: 0 | 1; why: string }
  | { kind: "burn_lp"; side: 0 | 1; why: string }
  | { kind: "register"; side: 0 | 1; why: string }
  | { kind: "fee_key"; side: 0 | 1; why: string }
  | { kind: "void"; why: string }
  | { kind: "claim"; why: string }
  | { kind: "seed"; side: 0 | 1; why: string }
  | { kind: "wait"; why: string };

/** The developer accrual the keeper pays out once it reaches this much (claim_developer_fee is permissionless; anyone may call it sooner). */
export const CLAIM_THRESHOLD_LAMPORTS = BigInt(10_000_000);

/**
 * The next actions for a pair, in order; the keeper sends EACH AS ITS OWN TRANSACTION (blind review 2 L-3: a failing registration
 * must never block a graduation). `registered[side]` = that mint's TokenConfig already has a verified pool; `seeded[side]` = the side's
 * CPMM pool has at least one oracle observation (blind review 2 L-4 — the keeper seeds it with a dust swap).
 *   Open, ready, before the deadline   → graduate A, graduate B (normally a trade already committed the pair), each followed by lock_lp
 *   Open at/after the deadline         → void
 *   Graduating                         → graduate the missing side(s); a side missing ≥ 3 days after the commit → void (the program
 *                                         accepts it only if Raydium really blocks the side); registrations; seeds
 *   Graduated                          → lock_lp where the LP is not locked yet (LAUNCHPAD-PATH §35), registrations still missing,
 *                                         register_fee_key where the coin has no FeeKeyRecord, seeds
 *   any                                → claim the developer accrual above the threshold
 */
export function planPairCrank(p: PairAccount, now: number, registered: [boolean, boolean], seeded: [boolean, boolean] = [true, true], feeKeys: [boolean, boolean] = [true, true]): CrankAction[] {
  const deadline = Number(p.deadline);
  const missingPool = (s: 0 | 1) => p.pools[s].equals(PublicKey.default);
  const out: CrankAction[] = [];
  const tail = () => {
    for (const s of [0, 1] as const) {
      if (missingPool(s)) continue;
      if (p.lp_locked[s] === BigInt(0)) {
        out.push({ kind: "lock", side: s, why: "the pool's LP is still in the vault: lock_lp locks it forever (Fee Key to FEE_KEYS)" });
        // the fallback (lp-lock blind review L-2), only once Raydium's lock has refused for LP_LOCK_FALLBACK_SECS since the commit
        if (now >= Number(p.graduation_started_at) + LP_LOCK_FALLBACK_SECS) out.push({ kind: "burn_lp", side: s, why: "the LP is still unlocked 30 days after graduation started: burn_lp, the fallback that destroys it" });
      }
      if (!registered[s]) out.push({ kind: "register", side: s, why: "the pool exists but is not registered in burn_receipts" });
      if (!feeKeys[s]) out.push({ kind: "fee_key", side: s, why: "the coin's lock position is not recorded yet (register_fee_key)" });
      if (!seeded[s]) out.push({ kind: "seed", side: s, why: "the pool has no oracle observation yet: a dust swap seeds the TWAP" });
    }
  };
  if (p.status === STATUS_OPEN) {
    if (now >= deadline) out.push({ kind: "void", why: `the deadline ${new Date(deadline * 1000).toISOString()} passed without graduation` });
    else if (graduationReady(p.sol[0], p.sol[1], p.target_raise_lamports, p.min_side_share_bps)) for (const s of [0, 1] as const) out.push({ kind: "graduate", side: s, why: "combined raise at target and both sides at their minimum share" }, { kind: "lock", side: s, why: "lock the new pool's LP forever" });
    else out.push({ kind: "wait", why: `raise ${p.sol[0] + p.sol[1]} of ${p.target_raise_lamports} lamports (or a side under ${p.min_side_share_bps} bps)` });
  } else if (p.status === STATUS_GRADUATING) {
    for (const s of [0, 1] as const) if (missingPool(s) && !p.refunding[s]) out.push({ kind: "graduate", side: s, why: "graduation committed; this side's pool is still to create" }, { kind: "lock", side: s, why: "lock the new pool's LP forever" });
    if ((([0, 1] as const).some((s) => missingPool(s) && !p.refunding[s])) && now >= Number(p.graduation_started_at) + GRADUATION_STUCK_SECS) out.push({ kind: "void", why: "a side is still missing 3 days after the commit: refunded if Raydium blocks it (unconditionally after 30 days)" });
    tail();
  } else if (p.status === STATUS_GRADUATED) {
    tail();
  }
  if (p.dev_accrued >= CLAIM_THRESHOLD_LAMPORTS) out.push({ kind: "claim", why: `developer accrual ${p.dev_accrued} lamports` });
  return out.length ? out : [{ kind: "wait", why: p.status === STATUS_VOIDED ? "voided — holders redeem pro rata; nothing to crank" : "nothing to do" }];
}

/** Does the side's CPMM pool have an oracle observation? (ObservationState: newest index u16 @9, observations of 40 bytes @43.) */
export async function poolSeeded(connection: Connection, observation: PublicKey): Promise<boolean> {
  const a = await connection.getAccountInfo(observation, "confirmed");
  if (!a || a.data.length < 43 + 40 * 100) return false;
  const idx = a.data.readUInt16LE(9);
  return idx < 100 && a.data.readBigUInt64LE(43 + idx * 40) > BigInt(0);
}

/**
 * A dust swap (WSOL → token) on a pair pool, from `payer`: creates the payer's WSOL and token accounts (idempotent), wraps `lamports`,
 * swaps them with min-out 0, and closes the WSOL account. It writes the pool's first oracle observation so burn_receipts'
 * crank_buyback has a TWAP to read (blind review 2 L-4). The payer keeps the dust tokens.
 */
export function seedObservationIxs(o: { cluster: Cluster; payer: PublicKey; pairAddress: PublicKey; pair: PairAccount; side: 0 | 1; lamports?: bigint; programId?: PublicKey }): TransactionInstruction[] {
  const mint = o.pair.mints[o.side];
  const s = sidePoolAccounts(o.cluster, o.pairAddress, o.side, mint, o.programId ?? PAIR_CURVE_ID);
  const wsol = ata(o.payer, NATIVE_MINT), tok = ata(o.payer, mint);
  const amount = o.lamports ?? BigInt(10_000);
  const createAta = (owner: PublicKey, m: PublicKey, addr: PublicKey) => new TransactionInstruction({ programId: ASSOCIATED_TOKEN_PROGRAM_ID, data: Buffer.from([1]), keys: [
    { pubkey: o.payer, isSigner: true, isWritable: true }, { pubkey: addr, isSigner: false, isWritable: true }, { pubkey: owner, isSigner: false, isWritable: false },
    { pubkey: m, isSigner: false, isWritable: false }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false } ] });
  const [inVault, outVault] = s.wsolIsToken0 ? [s.poolVault0, s.poolVault1] : [s.poolVault1, s.poolVault0];
  const data = Buffer.alloc(24);
  Buffer.from([143, 190, 90, 218, 196, 30, 51, 222]).copy(data, 0);
  data.writeBigUInt64LE(amount, 8);
  data.writeBigUInt64LE(BigInt(0), 16);
  const swap = new TransactionInstruction({ programId: CPMM_PROGRAM_ID[o.cluster], data, keys: [
    { pubkey: o.payer, isSigner: true, isWritable: false }, { pubkey: s.cpmmAuthority, isSigner: false, isWritable: false }, { pubkey: o.pair.cp_config, isSigner: false, isWritable: false },
    { pubkey: s.pool, isSigner: false, isWritable: true }, { pubkey: wsol, isSigner: false, isWritable: true }, { pubkey: tok, isSigner: false, isWritable: true },
    { pubkey: inVault, isSigner: false, isWritable: true }, { pubkey: outVault, isSigner: false, isWritable: true }, { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, { pubkey: NATIVE_MINT, isSigner: false, isWritable: false }, { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: s.observation, isSigner: false, isWritable: true } ] });
  const close = new TransactionInstruction({ programId: TOKEN_PROGRAM_ID, data: Buffer.from([9]), keys: [{ pubkey: wsol, isSigner: false, isWritable: true }, { pubkey: o.payer, isSigner: false, isWritable: true }, { pubkey: o.payer, isSigner: true, isWritable: false }] });
  return [createAta(o.payer, NATIVE_MINT, wsol), createAta(o.payer, mint, tok), SystemProgram.transfer({ fromPubkey: o.payer, toPubkey: wsol, lamports: amount }),
    new TransactionInstruction({ programId: TOKEN_PROGRAM_ID, data: Buffer.from([17]), keys: [{ pubkey: wsol, isSigner: false, isWritable: true }] }), swap, close];
}

/**
 * SPL Token SyncNative on the pair vault's WSOL account, when that account exists (permissionless; no signer). The program syncs before
 * it samples the account (ChatGPT PR review, Low); the keeper also prepends it so an unsynced lamport donation never costs a retry.
 */
export async function syncVaultWsolIxs(connection: Connection, p: PairAccount): Promise<TransactionInstruction[]> {
  const a = await connection.getAccountInfo(p.vault_wsol, "confirmed");
  if (!a || !a.owner.equals(TOKEN_PROGRAM_ID) || a.data.length !== 165) return [];
  return [syncNativeIx(p.vault_wsol)];
}
export const syncNativeIx = (account: PublicKey): TransactionInstruction => new TransactionInstruction({ programId: TOKEN_PROGRAM_ID, data: Buffer.from([17]), keys: [{ pubkey: account, isSigner: false, isWritable: true }] });

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

/**
 * Plans and executes one pair's crank, ONE TRANSACTION PER ACTION. A refusal is recorded and the next action still runs when it is
 * independent (a failed registration or seed never stops a graduation, blind review 2 L-3); everything is retried next cycle.
 * `skipClusterCheck`: the caller already checked the genesis this cycle (blind review 2 I-1).
 */
export async function crankPair(ctx: PairCurveContext, cranker: Keypair, pairAddress: PublicKey, o: { now?: number; dryRun?: boolean; log?: (s: string) => void; skipClusterCheck?: boolean } = {}): Promise<CrankStep[]> {
  if (!o.skipClusterCheck) await assertPairCurveCluster(ctx);
  const steps: CrankStep[] = [];
  const now = o.now ?? Math.floor(Date.now() / 1000);
  let p = await fetchPair(ctx.connection, pairAddress);
  if (!p) return [{ action: { kind: "wait", why: "no Pair account" }, result: null }];
  const seeded: [boolean, boolean] = [true, true];
  for (const s of [0, 1] as const) if (!p.pools[s].equals(PublicKey.default)) seeded[s] = await poolSeeded(ctx.connection, sidePoolAccounts(ctx.cluster, pairAddress, s, p.mints[s], ctx.programId ?? PAIR_CURVE_ID).observation);
  const feeKeys: [boolean, boolean] = [true, true];
  for (const s of [0, 1] as const) if (!p.pools[s].equals(PublicKey.default)) feeKeys[s] = !!(await ctx.connection.getAccountInfo(feeKeyRecordPda(ctx.burnReceiptsProgramId, p.mints[s]), "confirmed"));
  const actions = planPairCrank(p, now, await registeredSides(ctx, p), seeded, feeKeys);
  let graduateFailed = false;
  const lockedNow: [boolean, boolean] = [false, false];
  for (const action of actions) {
    if (action.kind === "wait") { steps.push({ action, result: null }); continue; }
    if (action.kind === "graduate" && graduateFailed) continue;
    p = (await fetchPair(ctx.connection, pairAddress)) ?? p;
    let ixs: TransactionInstruction[] = [];
    if (action.kind === "void") ixs = [voidPairIx({ caller: cranker.publicKey, pairAddress, pair: p, programId: ctx.programId })];
    if (action.kind === "graduate") ixs = [...(await syncVaultWsolIxs(ctx.connection, p)), graduateIx({ cranker: cranker.publicKey, pairAddress, pair: p, side: action.side, cluster: ctx.cluster, programId: ctx.programId })];
    if (action.kind === "lock") {
      if (p.pools[action.side].equals(PublicKey.default) || p.lp_locked[action.side] !== BigInt(0)) continue;
      ixs = [lockLpIx({ cranker: cranker.publicKey, pairAddress, pair: p, side: action.side, cluster: ctx.cluster, burnReceiptsProgramId: ctx.burnReceiptsProgramId, programId: ctx.programId })];
    }
    if (action.kind === "burn_lp") {
      if (p.pools[action.side].equals(PublicKey.default) || p.lp_locked[action.side] !== BigInt(0) || lockedNow[action.side]) continue;
      ixs = [burnLpIx({ cranker: cranker.publicKey, pairAddress, pair: p, side: action.side, cluster: ctx.cluster, programId: ctx.programId })];
    }
    if (action.kind === "fee_key") ixs = [registerSideFeeKeyIx({ payer: cranker.publicKey, pairAddress, pair: p, side: action.side, cluster: ctx.cluster, burnReceiptsProgramId: ctx.burnReceiptsProgramId, programId: ctx.programId })];
    if (action.kind === "register") ixs = [registerSideIx({ registrar: cranker.publicKey, pairAddress, pair: p, side: action.side, cluster: ctx.cluster, burnReceiptsProgramId: ctx.burnReceiptsProgramId, programId: ctx.programId })];
    if (action.kind === "claim") ixs = [claimDeveloperFeeIx({ caller: cranker.publicKey, pairAddress, pair: p, programId: ctx.programId })];
    if (action.kind === "seed") ixs = seedObservationIxs({ cluster: ctx.cluster, payer: cranker.publicKey, pairAddress, pair: p, side: action.side, programId: ctx.programId });
    const result = await simulateAndSend(ctx, ixs, [cranker], { dryRun: o.dryRun });
    o.log?.(`  [pair-curve] ${pairAddress.toBase58().slice(0, 8)}… ${action.kind}${"side" in action ? `(${action.side === 0 ? "A" : "B"})` : ""}: ${result.ok ? (result.signature ?? "simulated ok") : `refused — ${result.error}`}${result.units ? ` · ${result.units} CU` : ""}`);
    steps.push({ action, result });
    if (action.kind === "graduate" && !result.ok) graduateFailed = true;
    if (action.kind === "lock" && result.ok) lockedNow[action.side] = true;
    if (o.dryRun && action.kind === "graduate") break;
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
