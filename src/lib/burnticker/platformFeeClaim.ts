import { Connection, PublicKey, type TransactionInstruction } from "@solana/web3.js";
import { PlatformConfig, claimPlatformFeeFromVault, getPdaPlatformFeeVaultAuth, getPdaPlatformVault } from "@raydium-io/raydium-sdk-v2";
import { associatedTokenAddress, closeAccountIx, createAtaIdempotentIx, TOKEN_PROGRAM_ID } from "@/lib/burnKeeper/solana";
import { BURNTICKER_PLATFORM, LAUNCHLAB_PROGRAM_ID, OPERATOR_TREASURY } from "@/lib/burnReceipts/constants";
import { budgetedRpcConfig } from "@/lib/burnticker/apiBudget";
import { fail, ok, type ApiResult } from "@/lib/burnticker/api/http";
import { opsAllowed } from "@/lib/burnticker/api/product";
import type { SerializedIx } from "@/lib/burnticker/program";
import { neededLamports, TOKEN_ACCOUNT_RENT_LAMPORTS, WSOL_MINT, type PlatformFeesView } from "@/lib/burnticker/platformFeeClaimPlan";

/**
 * THE PLATFORM-FEE CLAIM, SERVER SIDE (owner, 2026-10-16; the page is /burnticker/operator/claim-fees, the client half is
 * platformFeeClaimPlan.ts). Raydium SDK 0.2.74-alpha `claimPlatformFeeFromVault` (src/raydium/launchpad/instrument.ts) is the vault-level
 * claim: LaunchLab moves each curve trade's platform fee into one vault per (platform, quote mint), getPdaPlatformVault, so the claim names
 * the platform and the vault, not a pool. Its accounts, in the SDK's order:
 *
 *   0 platform_claim_fee_wallet  signer, writable (PlatformConfig.platformClaimFeeWallet; pays the network fee)
 *   1 fee vault authority        getPdaPlatformFeeVaultAuth(LaunchLab)
 *   2 platform config            the platform id
 *   3 platform fee vault         writable, getPdaPlatformVault(LaunchLab, platform, WSOL)
 *   4 recipient token account    writable, the claim wallet's wrapped-SOL ATA
 *   5 quote mint (WSOL), 6 token program, 7 system program, 8 associated token program
 *
 * The claim is wrapped in an idempotent ATA create before it and a CloseAccount after it, so the fee lands as plain SOL. Operator only:
 * the same gate as the post queue (opsAuth.ts: the operator's own network AND the ops PIN).
 */

const WSOL = new PublicKey(WSOL_MINT);
const ser = (ix: TransactionInstruction, label: string): SerializedIx => ({ programId: ix.programId.toBase58(), label, keys: ix.keys.map((k) => ({ pubkey: k.pubkey.toBase58(), isSigner: k.isSigner, isWritable: k.isWritable })), dataBase64: Buffer.from(ix.data).toString("base64") });

export interface ClaimAccounts { vault: PublicKey; vaultAuthority: PublicKey; recipient: PublicKey }
/** The vault, its authority and the recipient, each from the SDK's own PDA helpers (the recipient: the claim wallet's WSOL ATA). */
export function platformFeeClaimAccounts(program: PublicKey, platformId: PublicKey, claimWallet: PublicKey, mint: PublicKey = WSOL): ClaimAccounts {
  return { vault: getPdaPlatformVault(program, platformId, mint).publicKey, vaultAuthority: getPdaPlatformFeeVaultAuth(program).publicKey, recipient: associatedTokenAddress(claimWallet, mint) };
}

/** The three instructions: open the WSOL ATA (idempotent), claim the vault into it, close it into the claim wallet. */
export function platformFeeClaimIxs(program: PublicKey, platformId: PublicKey, claimWallet: PublicKey): SerializedIx[] {
  const a = platformFeeClaimAccounts(program, platformId, claimWallet);
  return [
    ser(createAtaIdempotentIx(claimWallet, claimWallet, WSOL), "Associated token program: open the claim wallet's wrapped-SOL account"),
    ser(claimPlatformFeeFromVault(program, platformId, claimWallet, a.vaultAuthority, a.vault, a.recipient, WSOL, TOKEN_PROGRAM_ID), "LaunchLab: claim_platform_fee_from_vault"),
    ser(closeAccountIx(a.recipient, claimWallet, claimWallet), "Token program: close the wrapped-SOL account into the claim wallet"),
  ];
}

/** One getMultipleAccountsInfo call (Connection's own shape, so the route passes a budgeted Connection and tests pass a fake). */
export interface FeeAccountReader {
  getMultipleAccountsInfo(keys: PublicKey[], commitment?: "confirmed"): Promise<({ data: Uint8Array | Buffer; lamports: number; owner: PublicKey } | null)[]>;
  /** the current rent-exempt minimum (Connection's own); absent or failing → the classic 165-byte figure */
  getMinimumBalanceForRentExemption?(bytes: number, commitment?: "confirmed"): Promise<number>;
}

type Cluster = PlatformFeesView["cluster"];
const tokenAmount = (d: Uint8Array): bigint => Buffer.from(d.buffer, d.byteOffset, d.byteLength).readBigUInt64LE(64);

/** Reads the platform config, the vault, the claim wallet and its WSOL ATA (one call) and builds the view with the instructions. */
export async function readPlatformFees(reader: FeeAccountReader, cluster: Cluster, now = Date.now()): Promise<PlatformFeesView> {
  const program = LAUNCHLAB_PROGRAM_ID[cluster], platformId = BURNTICKER_PLATFORM[cluster];
  const [cfgAcc] = await reader.getMultipleAccountsInfo([platformId], "confirmed");
  if (!cfgAcc) throw new Error(`the LaunchLab platform ${platformId.toBase58()} was not found on ${cluster}`);
  if (!cfgAcc.owner.equals(program)) throw new Error(`the platform account is not owned by the LaunchLab program`);
  const cfg = PlatformConfig.decode(Buffer.from(cfgAcc.data));
  const claimWallet = new PublicKey(cfg.platformClaimFeeWallet);
  const a = platformFeeClaimAccounts(program, platformId, claimWallet);
  const [vaultAcc, walletAcc, ataAcc] = await reader.getMultipleAccountsInfo([a.vault, claimWallet, a.recipient], "confirmed");
  const recipientExists = !!ataAcc;
  let rent = TOKEN_ACCOUNT_RENT_LAMPORTS;
  if (!recipientExists && reader.getMinimumBalanceForRentExemption) { try { rent = BigInt(await reader.getMinimumBalanceForRentExemption(165, "confirmed")); } catch { /* the classic figure stands */ } }
  return {
    cluster, launchLabProgram: program.toBase58(), platformId: platformId.toBase58(), claimWallet: claimWallet.toBase58(),
    claimWalletIsTreasury: claimWallet.equals(OPERATOR_TREASURY[cluster]), feeRatePpm: Number(cfg.feeRate.toString()), quoteMint: WSOL_MINT,
    vault: a.vault.toBase58(), vaultAuthority: a.vaultAuthority.toBase58(), vaultLamports: vaultAcc && vaultAcc.data.length >= 72 ? tokenAmount(vaultAcc.data).toString() : vaultAcc ? null : "0",
    recipient: a.recipient.toBase58(), recipientExists, claimWalletLamports: walletAcc ? String(walletAcc.lamports) : "0",
    neededLamports: neededLamports(recipientExists, rent).toString(), instructions: platformFeeClaimIxs(program, platformId, claimWallet), readAt: new Date(now).toISOString(),
  };
}

type Env = Readonly<Record<string, string | undefined>>;
const clusterOf = (env: Env): Cluster => (env.BURNTICKER_CLUSTER === "mainnet" ? "mainnet" : env.BURNTICKER_CLUSTER === "localnet" ? "localnet" : "devnet");
/** The host's RPC through the site's budget (apiBudget.ts), like the platform's other server reads; null without BURNTICKER_RPC_URL. */
export function feeReaderFromEnv(env: Env = process.env): FeeAccountReader | null {
  const rpc = (env.BURNTICKER_RPC_URL ?? "").trim();
  return rpc ? (new Connection(rpc, budgetedRpcConfig({ commitment: "confirmed" as const, disableRetryOnRateLimit: true })) as unknown as FeeAccountReader) : null;
}

/** GET /ops/platform-fees: the claim page's view, operator only (the post queue's gate). Reads; never signs or sends. */
export async function v1OpsPlatformFees(req: Request, env: Env = process.env, reader: FeeAccountReader | null = feeReaderFromEnv(env), now = Date.now()): Promise<ApiResult> {
  const denied = opsAllowed(req, env);
  if (denied) return denied;
  if (!reader) return fail(503, "This host has no RPC (BURNTICKER_RPC_URL), so the platform fee vault cannot be read.");
  try { return ok(await readPlatformFees(reader, clusterOf(env), now)); } catch (e) { return fail(502, `The platform fee vault could not be read. The reason given was: ${String((e as Error)?.message ?? e).slice(0, 160)}`); }
}
