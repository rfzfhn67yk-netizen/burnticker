import { PublicKey, TransactionMessage, VersionedTransaction, type AccountInfo, type Commitment, type TransactionInstruction } from "@solana/web3.js";
import { decodeCpmmPool } from "@/lib/burnReceipts/cpmm";
import { cpmmPoolExtras, decodeCpmmConfig, decodeCurveConfig, decodeCurvePlatform, decodeCurvePool } from "@/lib/burnticker/swap/layouts";
import { associatedTokenAddress, CPMM_PROGRAM, LAUNCHLAB_PROGRAM, launchLabPoolId, WSOL_MINT } from "@/lib/burnticker/swap/instructions";
import type { Balances, Market, Network } from "@/lib/burnticker/swap/plan";
import { REFUSAL } from "@/lib/burnticker/swap/copy";

/**
 * THE SWAP PANEL'S CHAIN STEPS (swap-1, 2026-10-14): read the pool, read the wallet, simulate, sign, send, confirm. Each takes the small
 * slice of a web3.js Connection it needs, so the browser passes the wallet adapter's connection (pointed at /api/burnticker/rpc, whose
 * allow-list covers every method used here) and the devnet proof passes a plain Connection. Confirmation polls getSignatureStatuses
 * (the proxy carries no websocket). No key is read or held: signing is the wallet's `signTransaction`.
 */

export interface SwapReader {
  getMultipleAccountsInfo(keys: PublicKey[], commitment?: Commitment): Promise<(AccountInfo<Buffer> | null)[]>;
  getBalance(key: PublicKey, commitment?: Commitment): Promise<number>;
}
export interface SwapSender {
  getLatestBlockhash(commitment?: Commitment): Promise<{ blockhash: string; lastValidBlockHeight: number }>;
  simulateTransaction(tx: VersionedTransaction, opts: { sigVerify: boolean; replaceRecentBlockhash: boolean; commitment: Commitment }): Promise<{ value: { err: unknown; logs: string[] | null; unitsConsumed?: number } }>;
  sendRawTransaction(raw: Uint8Array, opts: { skipPreflight: boolean; maxRetries: number }): Promise<string>;
  getSignatureStatuses(sigs: string[]): Promise<{ value: ({ err: unknown; confirmationStatus?: string } | null)[] }>;
  getBlockHeight(commitment?: Commitment): Promise<number>;
}

const tokenAmount = (data: Uint8Array): bigint => new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(64, true);

/**
 * The market the coin trades in now: its CPMM pool when the page names a registered one, else its LaunchLab curve. Account owners
 * are checked against the network's Raydium programs; anything else is a refusal (thrown as the sentence).
 */
export async function readMarket(conn: SwapReader, network: Network, mint: PublicKey, cpmmPool: PublicKey | null): Promise<Market> {
  if (cpmmPool) {
    const program = CPMM_PROGRAM[network];
    const [acc] = await conn.getMultipleAccountsInfo([cpmmPool], "confirmed");
    if (!acc || !acc.owner.equals(program)) throw new Error(REFUSAL.noPool);
    const pool = decodeCpmmPool(cpmmPool, acc.data), x = cpmmPoolExtras(acc.data);
    const [cfg, v0, v1] = await conn.getMultipleAccountsInfo([pool.ammConfig, pool.token0Vault, pool.token1Vault], "confirmed");
    if (!cfg || !cfg.owner.equals(program) || !v0 || !v1) throw new Error(REFUSAL.noPool);
    const solIsToken0 = pool.token0Mint.equals(WSOL_MINT);
    const r0 = tokenAmount(v0.data) - pool.fees0, r1 = tokenAmount(v1.data) - pool.fees1;
    return { kind: "cpmm", program, pool, config: decodeCpmmConfig(cfg.data), solIsToken0, reserveSol: solIsToken0 ? r0 : r1, reserveToken: solIsToken0 ? r1 : r0, creatorFeeOn: x.creatorFeeOn, enableCreatorFee: x.enableCreatorFee, swapDisabled: x.swapDisabled };
  }
  const program = LAUNCHLAB_PROGRAM[network], poolId = launchLabPoolId(program, mint);
  const [acc] = await conn.getMultipleAccountsInfo([poolId], "confirmed");
  if (!acc || !acc.owner.equals(program)) throw new Error(REFUSAL.noPool);
  const pool = decodeCurvePool(acc.data);
  const [cfg, plat] = await conn.getMultipleAccountsInfo([pool.configId, pool.platformId], "confirmed");
  if (!cfg || !plat || !cfg.owner.equals(program) || !plat.owner.equals(program)) throw new Error(REFUSAL.noPool);
  return { kind: "curve", program, poolId, pool, config: decodeCurveConfig(cfg.data), platform: decodeCurvePlatform(plat.data) };
}

/** The wallet's SOL and its token account for the coin (raw units; a missing account is zero and costs rent to open). */
export async function readBalances(conn: SwapReader, owner: PublicKey, mint: PublicKey): Promise<Balances> {
  const [lamports, [ata]] = await Promise.all([conn.getBalance(owner, "confirmed"), conn.getMultipleAccountsInfo([associatedTokenAddress(owner, mint)], "confirmed")]);
  return { lamports: BigInt(lamports), tokens: ata ? tokenAmount(ata.data) : BigInt(0), tokenAccountExists: !!ata };
}

export async function compile(conn: Pick<SwapSender, "getLatestBlockhash">, payer: PublicKey, ixs: TransactionInstruction[]): Promise<{ tx: VersionedTransaction; blockhash: string; lastValidBlockHeight: number }> {
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  return { tx: new VersionedTransaction(new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message()), blockhash, lastValidBlockHeight };
}

/** A short reason from the program's logs: Raydium's slippage error by name, else the last log line. */
export function simulationReason(err: unknown, logs: readonly string[] | null): string {
  const text = (logs ?? []).join("\n");
  if (/ExceededSlippage|slippage|exceeds desired slippage/i.test(text)) return "The pool would give less than your minimum out.";
  if (/insufficient (funds|lamports)/i.test(text)) return "The wallet does not hold enough for this swap.";
  const last = [...(logs ?? [])].reverse().find((l) => /Error|failed/i.test(l));
  return last ? `The program said: ${last.replace(/^Program log: /, "").slice(0, 160)}` : `The network said: ${JSON.stringify(err).slice(0, 160)}`;
}

export interface SendResult { signature: string; status: "confirmed" | "failed" | "unconfirmed"; error?: string }

/**
 * Simulate → sign → send → confirm. The simulation must pass before the wallet is asked. `signTransaction` is the wallet's; nothing else
 * signs. Confirmation polls until the blockhash expires.
 */
export async function simulateSignSend(conn: SwapSender, payer: PublicKey, ixs: TransactionInstruction[], signTransaction: (tx: VersionedTransaction) => Promise<VersionedTransaction>, onStep: (s: "simulating" | "signing" | "sending" | "confirming") => void = () => {}, pollMs = 1500): Promise<SendResult> {
  onStep("simulating");
  const { tx, lastValidBlockHeight } = await compile(conn, payer, ixs);
  const sim = await conn.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" });
  if (sim.value.err) throw new Error(REFUSAL.simulation(simulationReason(sim.value.err, sim.value.logs)));
  onStep("signing");
  let signed: VersionedTransaction;
  try { signed = await signTransaction(tx); } catch { throw new Error(REFUSAL.rejected); }
  onStep("sending");
  const signature = await conn.sendRawTransaction(signed.serialize(), { skipPreflight: true, maxRetries: 5 });
  onStep("confirming");
  for (;;) {
    const st = (await conn.getSignatureStatuses([signature])).value[0];
    if (st?.err) return { signature, status: "failed", error: JSON.stringify(st.err).slice(0, 160) };
    if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) return { signature, status: "confirmed" };
    if ((await conn.getBlockHeight("confirmed")) > lastValidBlockHeight) return { signature, status: "unconfirmed" };
    await new Promise((res) => setTimeout(res, pollMs));
  }
}

export function explorerTxUrl(network: Network, signature: string): string {
  return `https://explorer.solana.com/tx/${signature}${network === "devnet" ? "?cluster=devnet" : ""}`;
}

/** The two networks' genesis hashes: the panel checks its connection is on the coin's network before it sends anything. */
export const GENESIS_HASH: Record<Network, string> = { mainnet: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d", devnet: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG" };
export async function connectionOn(conn: { getGenesisHash(): Promise<string> }, network: Network): Promise<boolean> {
  return (await conn.getGenesisHash().catch(() => "")) === GENESIS_HASH[network];
}
