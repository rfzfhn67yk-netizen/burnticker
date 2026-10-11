import { Keypair, PublicKey, Transaction, type Connection } from "@solana/web3.js";
import { burnPoolFor } from "@/lib/burnKeeper/burnPool";
import { transactionFrom, PLACEHOLDER_BLOCKHASH } from "@/lib/burnticker/transactions";
import { DEFAULT_ON_END, lockRule } from "@/lib/burnticker/rules";
import { compose, type Mapping, type Selector } from "./rules.ts";
import type { ApiTransport } from "./http.ts";
import type { LaunchBundleResponse, LaunchReview, UnsignedTx } from "./types.ts";

/**
 * LAUNCH A COIN FROM A BOT. The platform builds the bundle (so the refuse list, the ticker registry and the keeper's draft all apply
 * exactly as in the wizard); the SDK keeps every secret local: it generates the mint keypair on your machine and sends only its public
 * key, re-checks what came back (the rule hash, the fee PDA as LaunchLab creator), fetches a fresh blockhash from YOUR RPC, and
 * co-signs with the mint keypair. Your wallet signs last. Nothing is sent by the SDK.
 *
 * Mainnet is refused unless `allowMainnet: true` (checked against the API's cluster AND, when you pass a connection, the RPC's genesis
 * hash). The platform itself refuses mainnet until the Receipts program and the LaunchLab adapter are live and audited.
 */

export const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";

/**
 * The burn pool of a mint: burn_receipts' fee PDA ["fee", mint] under the program id — LaunchLab's recorded creator for every
 * Burnticker coin (so creator fees belong to the burn pool and the graduated pool can be registered). Anyone can deposit; nobody can
 * withdraw.
 */
export function feePdaFor(programId: PublicKey | string, mint: PublicKey | string): PublicKey {
  return burnPoolFor(new PublicKey(programId), new PublicKey(mint)).feePda;
}

export interface LaunchOptions {
  /** The creator wallet: pays LaunchLab's creation cost + gas and signs. It earns no cash from fees (the burn pool gets the creator slot). */
  wallet: PublicKey | string;
  /** Which settled events count. Omit when `rule` is a full rule object. */
  selector?: Selector;
  /** The mapping (with `selector`), or a full rule. */
  rule: Mapping | Record<string, unknown>;
  metadata: { ticker: string; name: string; description?: string; imageUrl?: string | null; links?: { label: string; url: string }[] };
  /** Optional first buy by the creator, decimal SOL ≤ 50. Default "0". */
  firstBuySol?: string;
  /** Both must be true: the rule cannot be changed by anyone; you are not promising anyone anything. */
  acknowledgements: { ruleLocked: true; noReturns: true };
  /** Your own mint keypair (e.g. a vanity grind); default a fresh Keypair.generate(). Its secret never leaves this process. */
  mintKeypair?: Keypair;
  /** Default true: register the DRAFT (reserves the ticker; the keeper attests readings only for registered coins). false = review only. */
  register?: boolean;
  allowMainnet?: boolean;
}

export interface LaunchResult {
  ready: boolean; pending: string[]; cluster: string;
  review: LaunchReview;
  receiptFormat: string; rulesSha256: string; rulesText: string;
  mint: PublicKey; mintKeypair: Keypair;
  /** The burn pool = LaunchLab's recorded creator (the program's fee PDA for the mint). */
  feePda: string;
  /** Transactions to sign with your wallet. Co-signed by the mint keypair when a real blockhash was available. */
  transactions: Transaction[];
  /** The server's compiled unsigned transactions (base64), for wallets that take wire bytes. */
  unsigned: UnsignedTx[];
  blockhash: string; blockhashPlaceholder: boolean;
  registered: LaunchBundleResponse["registered"];
  next: string[];
  /** Rebuild every transaction with a fresh blockhash and co-sign with the mint keypair (call right before your wallet signs). */
  withBlockhash(blockhash: string): Transaction[];
}

export async function assertNotMainnet(connection: Connection | undefined, allowMainnet: boolean | undefined, what: string): Promise<void> {
  if (allowMainnet || !connection) return;
  if ((await connection.getGenesisHash()) === MAINNET_GENESIS) throw new Error(`burnticker: ${what} refused — this RPC is mainnet-beta and allowMainnet is not set`);
}

export async function buildLaunchBundle(api: ApiTransport, o: LaunchOptions, ctx: { connection?: Connection; programId?: PublicKey | null } = {}): Promise<LaunchResult> {
  await assertNotMainnet(ctx.connection, o.allowMainnet, "launch");
  const composed = o.selector ? compose(o.selector, o.rule as Mapping) : o.rule;
  // Since API 1.4.0 every new coin carries the onEnd wind-down (no burn pool is ever left behind); the server adds the default to a rule
  // without one, so the SDK adds the same default here and re-checks the exact bytes that come back.
  const ruleObj = (composed as { onEnd?: unknown }).onEnd === undefined ? { ...(composed as object), onEnd: { ...DEFAULT_ON_END } } : composed;
  const locked = lockRule(ruleObj);   // fails here, locally, with every problem listed — before any request
  const kp = o.mintKeypair ?? Keypair.generate();
  const wallet = new PublicKey(o.wallet).toBase58();
  const blockhash = ctx.connection ? (await ctx.connection.getLatestBlockhash("confirmed")).blockhash : null;
  const res = await api.post<LaunchBundleResponse>("/launch/bundle", {
    creator: wallet, mint: kp.publicKey.toBase58(), ticker: o.metadata.ticker.toUpperCase(), name: o.metadata.name, description: o.metadata.description ?? "", imageUrl: o.metadata.imageUrl ?? null, links: o.metadata.links ?? [],
    rule: locked.rule, firstBuySol: o.firstBuySol ?? "0", acknowledgements: o.acknowledgements, register: o.register ?? true, ...(blockhash ? { recentBlockhash: blockhash } : {}),
  });
  if (res.cluster === "mainnet" && !o.allowMainnet) throw new Error("burnticker: the API built a MAINNET bundle and allowMainnet is not set — refusing to sign");
  // Trust nothing that came back: the rule bytes and hash, the mint, the creator, and the burn pool as LaunchLab's recorded creator.
  const problems: string[] = [];
  if (res.review.rules.sha256 !== locked.sha256 || res.review.rules.text !== locked.text) problems.push(`the API's rule hash ${res.review.rules.sha256} ≠ the local ${locked.sha256}`);
  if (res.review.mint !== kp.publicKey.toBase58()) problems.push("the bundle is for a different mint");
  if (res.review.creator !== wallet) problems.push("the bundle is for a different creator wallet");
  if (res.review.burnPoolAuthority !== res.review.addresses.feePda) problems.push("LaunchLab's recorded creator is not the burn pool's fee PDA");
  if (ctx.programId && res.review.addresses.feePda !== feePdaFor(ctx.programId, kp.publicKey).toBase58()) problems.push(`the fee PDA ${res.review.addresses.feePda} is not burn_receipts ["fee", mint] under ${new PublicKey(ctx.programId).toBase58()}`);
  for (const t of res.transactions) for (const ix of t.instructions) for (const k of ix.keys) if (k.isSigner && k.pubkey !== wallet && k.pubkey !== kp.publicKey.toBase58()) problems.push(`instruction "${ix.label}" asks ${k.pubkey} to sign (only your wallet and the mint may)`);
  if (problems.length) throw new Error(`burnticker: launch bundle refused: ${problems.join("; ")}`);
  const build = (bh: string): Transaction[] => res.transactions.map((t) => {
    const tx = transactionFrom(t.instructions, wallet, bh);
    if (bh !== PLACEHOLDER_BLOCKHASH && t.signers.includes("mint")) tx.partialSign(kp);
    return tx;
  });
  const bh = blockhash ?? res.transactions[0]?.recentBlockhash ?? PLACEHOLDER_BLOCKHASH;
  return {
    ready: res.ready, pending: res.pending, cluster: res.cluster, review: res.review, receiptFormat: res.review.receiptFormat, rulesSha256: locked.sha256, rulesText: locked.text,
    mint: kp.publicKey, mintKeypair: kp, feePda: res.review.addresses.feePda, transactions: build(bh), unsigned: res.transactions, blockhash: bh, blockhashPlaceholder: bh === PLACEHOLDER_BLOCKHASH,
    registered: res.registered, next: res.next, withBlockhash: build,
  };
}
