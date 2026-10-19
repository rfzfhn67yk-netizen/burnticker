import { PublicKey, TransactionMessage, VersionedTransaction, type AccountInfo, type Commitment, type TransactionInstruction } from "@solana/web3.js";
import { decodeCpmmPool } from "@/lib/burnReceipts/cpmm";
import { cpmmPoolExtras, decodeCpmmConfig, decodeCurveConfig, decodeCurvePlatform, decodeCurvePool } from "@/lib/burnticker/swap/layouts";
import { associatedTokenAddress, CPMM_PROGRAM, LAUNCHLAB_PROGRAM, launchLabPoolId, WSOL_MINT } from "@/lib/burnticker/swap/instructions";
import type { Balances, Market, Network } from "@/lib/burnticker/swap/plan";
import { REFUSAL } from "@/lib/burnticker/swap/copy";
import { withFlight } from "@/lib/burnticker/rpcProxy";

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
  getSignatureStatuses(sigs: string[], config?: { searchTransactionHistory: boolean }): Promise<{ value: ({ err: unknown; confirmationStatus?: string } | null)[] }>;
  getBlockHeight(commitment?: Commitment): Promise<number>;
  /** F-30: the second witness before a held swap is called expired (web3.js Connection.getTransaction; null when the RPC has no such transaction). */
  getTransaction(signature: string, opts: { commitment: "confirmed" | "finalized"; maxSupportedTransactionVersion: number }): Promise<{ meta: { err: unknown } | null } | null>;
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

/**
 * What a swap came to. `pending`: the wallet signed and the transaction may be on its way (the send or a status read failed, or the
 * blockhash has not expired yet), so the panel holds it and sends nothing else until a status read settles it. `expired`: the blockhash
 * expired and a final status read (with history) still did not find it, so it can no longer land and nothing changed.
 */
export interface SendResult { signature: string; status: "confirmed" | "failed" | "expired" | "pending"; error?: string; lastValidBlockHeight?: number }
/** The identity of a signed swap, known before it is sent (the signature is the wallet's, the expiry is the blockhash's). */
export interface Submitted { signature: string; lastValidBlockHeight: number }

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
/** Base58 of raw bytes (the transaction signature's printed form). */
export function base58(bytes: Uint8Array): string {
  const digits: number[] = [0];
  for (const b of bytes) {
    let carry = b;
    for (let i = 0; i < digits.length; i++) { carry += digits[i] << 8; digits[i] = carry % 58; carry = (carry / 58) | 0; }
    while (carry > 0) { digits.push(carry % 58); carry = (carry / 58) | 0; }
  }
  let out = "";
  for (let k = 0; k < bytes.length && bytes[k] === 0; k++) out += "1";
  for (let i = digits.length - 1; i >= 0; i--) out += B58[digits[i]];
  return bytes.every((b) => b === 0) ? out.slice(0, bytes.length) : out;
}
/** The fee payer's signature of a signed transaction, or null when the wallet left it empty (all zeros). */
export function signatureOf(tx: VersionedTransaction): string | null {
  const sig = tx.signatures[0];
  return sig && sig.some((b) => b !== 0) ? base58(sig) : null;
}
const short = (e: unknown): string => String((e as Error)?.message ?? e).slice(0, 160);

/**
 * Simulate → sign → send → confirm. The simulation must pass before the wallet is asked. `signTransaction` is the wallet's; nothing else
 * signs. Confirmation polls until the blockhash expires.
 *
 * audit 2026-10-15 F2: once the wallet has signed, the swap's identity (its signature and blockhash expiry) is handed to `onSubmit`
 * BEFORE the send, so the panel can keep it across an error or a reload. Every failure after that point (the send itself, a status read,
 * a block height read) answers `pending` with the signature, never a bare error: the transaction may have landed, and a retry would be
 * a second swap. If `onSubmit` throws, nothing is sent.
 *
 * Review 2026-10-15 (3b): a wallet may replace the blockhash before it signs. The expiry is then not the compiled one: it is held with a
 * conservative bound instead (`signedExpiry`), so a swap is never called expired while its real blockhash could still land.
 */
export async function simulateSignSend(conn: SwapSender, payer: PublicKey, ixs: TransactionInstruction[], signTransaction: (tx: VersionedTransaction) => Promise<VersionedTransaction>, onStep: (s: "simulating" | "signing" | "sending" | "confirming") => void = () => {}, pollMs = 1500, onSubmit: (s: Submitted) => void = () => {}): Promise<SendResult> {
  // prelaunch audit C2 re-review 3: the proxy's flight token rides this run's reads and sends only (rpcProxy.ts withFlight)
  return withFlight(() => simulateSignSendRun(conn, payer, ixs, signTransaction, onStep, pollMs, onSubmit));
}
async function simulateSignSendRun(conn: SwapSender, payer: PublicKey, ixs: TransactionInstruction[], signTransaction: (tx: VersionedTransaction) => Promise<VersionedTransaction>, onStep: (s: "simulating" | "signing" | "sending" | "confirming") => void, pollMs: number, onSubmit: (s: Submitted) => void): Promise<SendResult> {
  onStep("simulating");
  const { tx, blockhash: compiledBlockhash, lastValidBlockHeight: compiledLast } = await compile(conn, payer, ixs);
  const sim = await conn.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" });
  if (sim.value.err) throw new Error(REFUSAL.simulation(simulationReason(sim.value.err, sim.value.logs)));
  onStep("signing");
  let signed: VersionedTransaction;
  try { signed = await signTransaction(tx); } catch { throw new Error(REFUSAL.rejected); }
  const local = signatureOf(signed);
  const lastValidBlockHeight = await signedExpiry(conn, compiledBlockhash, signed, compiledLast);
  if (local) onSubmit({ signature: local, lastValidBlockHeight });
  onStep("sending");
  let signature: string;
  // the wallet's own signature is the swap's identity (the record already holds it); the RPC's answer is used only when there is none
  try { const sent = await conn.sendRawTransaction(signed.serialize(), { skipPreflight: true, maxRetries: 5 }); signature = local ?? sent; }
  catch (e) {
    if (!local) throw e;
    return { signature: local, status: "pending", error: short(e), lastValidBlockHeight };
  }
  if (!local) onSubmit({ signature, lastValidBlockHeight });
  onStep("confirming");
  for (;;) {
    let st: { err: unknown; confirmationStatus?: string } | null;
    let height: number;
    try {
      st = (await conn.getSignatureStatuses([signature])).value[0];
      if (st?.err) return { signature, status: "failed", error: JSON.stringify(st.err).slice(0, 160), lastValidBlockHeight };
      if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) return { signature, status: "confirmed", lastValidBlockHeight };
      height = await conn.getBlockHeight("confirmed");
    } catch (e) { return { signature, status: "pending", error: short(e), lastValidBlockHeight }; }
    if (height > lastValidBlockHeight) return reconcileSubmitted(conn, { signature, lastValidBlockHeight });
    await new Promise((res) => setTimeout(res, pollMs));
  }
}

/** How many blocks a blockhash stays valid (Solana's MAX_PROCESSING_AGE), and the margin added when the wallet chose the blockhash. */
export const BLOCKHASH_VALID_BLOCKS = 150;
export const WALLET_BLOCKHASH_MARGIN = 30;
/** The fallback when the wallet chose the blockhash and the height could not be read: about ten minutes past the compiled expiry. */
export const UNKNOWN_EXPIRY_BLOCKS = 1_500;
/**
 * Fourth audit pass 2026-10-16 F-30: a swap is called expired only once the height is this far past its expiry (about a minute), so an
 * RPC that lags a few blocks behind cannot release the hold on a swap that landed.
 */
export const EXPIRY_MARGIN_BLOCKS = 150;
/**
 * The expiry to hold a signed swap by. The compiled blockhash's expiry when the wallet kept it; when the wallet replaced it, the wallet's
 * blockhash is at most as new as the chain right now, so it cannot outlive (height now + 150 + a margin); if the height cannot be read,
 * the compiled expiry plus UNKNOWN_EXPIRY_BLOCKS.
 */
export async function signedExpiry(conn: Pick<SwapSender, "getBlockHeight">, compiledBlockhash: string, signed: VersionedTransaction, compiledLast: number): Promise<number> {
  // compared with the blockhash string taken BEFORE the wallet saw the transaction (a wallet may change the very object it was handed)
  if (signed.message.recentBlockhash === compiledBlockhash) return compiledLast;
  try { return Math.max(compiledLast, (await conn.getBlockHeight("confirmed")) + BLOCKHASH_VALID_BLOCKS + WALLET_BLOCKHASH_MARGIN); }
  catch { return compiledLast + UNKNOWN_EXPIRY_BLOCKS; }
}

/**
 * Settles a swap the panel holds (after an error, or after a reload): a status read with history. Confirmed or failed on chain is
 * final; not found while the blockhash is still valid is `pending`. Fourth audit pass F-30: `expired` (it can no longer land) needs the
 * height past the expiry plus EXPIRY_MARGIN_BLOCKS AND a second status read with history AND getTransaction to find nothing; a
 * transaction either of them finds settles as what it found (before: one empty status read released the hold, so a lagging RPC could
 * free a swap that had landed and the visitor bought again). Any read error is `pending`.
 */
export async function reconcileSubmitted(conn: Pick<SwapSender, "getSignatureStatuses" | "getBlockHeight" | "getTransaction">, s: Submitted): Promise<SendResult> {
  const base = { signature: s.signature, lastValidBlockHeight: s.lastValidBlockHeight };
  try {
    // the height first: a status read after it that still finds nothing proves the transaction can no longer land
    const height = await conn.getBlockHeight("confirmed");
    const st = (await conn.getSignatureStatuses([s.signature], { searchTransactionHistory: true })).value[0];
    if (st?.err) return { ...base, status: "failed", error: JSON.stringify(st.err).slice(0, 160) };
    if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) return { ...base, status: "confirmed" };
    if (st || height <= s.lastValidBlockHeight + EXPIRY_MARGIN_BLOCKS) return { ...base, status: "pending" };
    const again = (await conn.getSignatureStatuses([s.signature], { searchTransactionHistory: true })).value[0];
    if (again?.err) return { ...base, status: "failed", error: JSON.stringify(again.err).slice(0, 160) };
    if (again && (again.confirmationStatus === "confirmed" || again.confirmationStatus === "finalized")) return { ...base, status: "confirmed" };
    if (again) return { ...base, status: "pending" };
    const tx = await conn.getTransaction(s.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    if (tx) return tx.meta?.err ? { ...base, status: "failed", error: JSON.stringify(tx.meta.err).slice(0, 160) } : { ...base, status: "confirmed" };
    return { ...base, status: "expired" };
  } catch (e) { return { ...base, status: "pending", error: short(e) }; }
}

export function explorerTxUrl(network: Network, signature: string): string {
  return `https://explorer.solana.com/tx/${signature}${network === "devnet" ? "?cluster=devnet" : ""}`;
}

/** The two networks' genesis hashes: the panel checks its connection is on the coin's network before it sends anything. */
export const GENESIS_HASH: Record<Network, string> = { mainnet: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d", devnet: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG" };
/**
 * True when the connection is on the network; false when the genesis hash it read is another network's. Prelaunch audit 2026-10-18 F03:
 * a genesis read that FAILED was turned into false, so an ordinary RPC outage read as "not on the coin's network". It now throws
 * REFUSAL.networkUnreadable, which the panel treats as recoverable (it retries, and offers Try again).
 */
export async function connectionOn(conn: { getGenesisHash(): Promise<string> }, network: Network): Promise<boolean> {
  let hash: unknown;
  try { hash = await conn.getGenesisHash(); } catch (e) { throw new Error(REFUSAL.networkUnreadable, { cause: e }); }
  if (typeof hash !== "string" || !hash) throw new Error(REFUSAL.networkUnreadable);
  return hash === GENESIS_HASH[network];
}
