import crypto from "node:crypto";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import { base58Encode } from "@/lib/burnKeeper/solana";
import { LAUNCHLAB_INITIALIZE_V2, LL_SLOTS } from "@/lib/burnticker/launchCreateArgs";
import type { Registry, TokenRow } from "@/lib/burnticker/registry";
import { decodeTokenConfig } from "@/lib/burnReceipts/accounts";
import { configPda } from "@/lib/burnReceipts/pda";

/**
 * ONE CREATOR, ONE TICKER, ONE COIN (B-2, third audit 2026-10-19). The creator signed the first create; the page refreshed while it was
 * pending (the prepare's idempotency key lived in page memory); they pressed Launch again, got a new mint from the bank and signed a
 * second bundle. Both creates landed: two creates and two reserves paid, two live coins on one ticker. The ticker rules exempt the same
 * creator so that a retry of an unfinished draft reuses it, and that exemption let the second draft through.
 *
 *   SENT      the launch page posts the creator-signed create transaction just before it sends it (signPlan.ts onSent, the route's
 *             `action: "sent"`). verifySentCreate checks it is this draft's create, signed by the draft's creator and its mint (so nobody
 *             else can mark someone's draft), and the registry records the signature (draft_sends, append-only).
 *   PREPARE   launchPendingRefusal: a registering prepare by the same creator for the same ticker on another mint is refused with 409
 *             "launch-pending" while that draft's create can still land (sent in the last CREATE_SEND_PENDING_MS) or has landed (the creator's
 *             TokenConfig for its mint exists on chain, B-15; checked for the creator's recent drafts of the ticker whether or not a send was posted). The answer sends
 *             the creator to the launch page's recovery notice, which checks the pending create and records it. A draft whose create was
 *             never sent keeps the exemption (a genuine retry reuses that draft, as before). The creator's own live coin on the ticker
 *             refuses the prepare too: a ticker is one coin.
 *   CONFIRM   registry.takeLiveFromChain refuses a draft whose ticker already has a live coin (409 "ticker-live") and alerts the owner, so
 *             a race that slips past prepare still cannot produce two live coins. The confirm, the draft reconciler and the operator's
 *             revive all pass there.
 */

/** A create sent this recently may still land: a blockhash lives about 60 to 90 seconds, and the page rebuilds a slow step at most twice. */
export const CREATE_SEND_PENDING_MS = 5 * 60_000;
/** The creator's drafts of the ticker whose mint is checked on chain (newest first), so one prepare costs a bounded number of reads. */
export const PENDING_CHAIN_CHECKS = 4;
/** Drafts older than this cannot go live from the confirm (24 h + the grace), so their mints are not read. */
const CHAIN_CHECK_WINDOW_MS = 25 * 3_600_000;

export const LAUNCH_PENDING_CODE = "launch-pending";

export function launchPendingSentence(ticker: string, mint: string, landed: boolean): string {
  return `Your launch of $${ticker} is still going: ${landed ? "its coin was already created on chain" : "its create was sent from your wallet a few minutes ago and may still land"} (mint ${mint}). Open the notice at the top of the launch page and press "Check on chain and record" to finish that launch. Starting again would create and pay for a second $${ticker}.`;
}
export function ownLiveTickerSentence(ticker: string, mint: string): string {
  return `You already launched $${ticker} on this site (mint ${mint}), and a ticker is one coin here. Please pick another ticker.`;
}

export type SentCheck = { ok: true; signature: string } | { ok: false; status: 400 | 404 | 409 | 422; reason: string };

function verifySig(message: Uint8Array, sig: Uint8Array, key: PublicKey): boolean {
  if (sig.length !== 64 || sig.every((b) => b === 0)) return false;
  try {
    const k = crypto.createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: Buffer.from(key.toBytes()).toString("base64url") }, format: "jwk" });
    return crypto.verify(null, Buffer.from(message), k, Buffer.from(sig));
  } catch { return false; }
}

/**
 * The message bytes a wallet signed, sliced from a serialized transaction without re-encoding it. A version-1 transaction (first byte
 * 0x81, SIMD-0298) is the message followed by its signatures; a legacy or version-0 one is a short-vector count, the signatures, then the
 * message. null when the bytes are too short for the signatures they declare.
 */
export function signedMessageBytes(raw: Uint8Array, numRequiredSignatures: number): Uint8Array | null {
  if (raw.length === 0) return null;
  if (raw[0] === 0x81) {
    const end = raw.length - numRequiredSignatures * 64;
    return end > 0 ? raw.subarray(0, end) : null;
  }
  let count = 0, shift = 0, i = 0;
  for (;;) { if (i >= raw.length) return null; const b = raw[i++]; count |= (b & 0x7f) << shift; if (!(b & 0x80)) break; shift += 7; if (shift > 14) return null; }
  const start = i + count * 64;
  return start < raw.length ? raw.subarray(start) : null;
}

/**
 * Whether `txBase64` (the signed transaction the page is about to send) is this draft's create: it deserializes, the draft's creator and
 * mint are among its signers and both signatures verify over its message, and (a LaunchLab draft) it carries initialize_v2 for the mint.
 * The first signature (the transaction's id) is returned.
 */
export function verifySentCreate(t: Pick<TokenRow, "mint" | "creator" | "poolId">, txBase64: unknown): SentCheck {
  if (typeof txBase64 !== "string" || txBase64.length < 100 || txBase64.length > 4_000) return { ok: false, status: 400, reason: "The sent launch must carry the signed transaction." };
  let tx: VersionedTransaction;
  try { tx = VersionedTransaction.deserialize(Buffer.from(txBase64, "base64")); } catch { return { ok: false, status: 400, reason: "The sent launch transaction could not be read." }; }
  const msg = tx.message;
  const keys = msg.staticAccountKeys.map((k) => k.toBase58());
  const n = msg.header.numRequiredSignatures;
  // Phantom v1 step 3 (devnet, 2026-10-20): web3.js 1.99 reads version-1 messages but cannot serialize them, so the signatures are checked
  // against the exact message bytes the wallet signed, sliced from the raw transaction (signedMessageBytes), for both layouts.
  const bytes = signedMessageBytes(Buffer.from(txBase64, "base64"), n);
  if (!bytes) return { ok: false, status: 400, reason: "The sent launch transaction could not be read." };
  for (const who of [t.creator, t.mint]) {
    const i = keys.indexOf(who);
    if (i < 0 || i >= n || !tx.signatures[i] || !verifySig(bytes, tx.signatures[i], new PublicKey(who))) return { ok: false, status: 422, reason: "The sent launch transaction is not signed by this draft's creator and mint." };
  }
  if (t.poolId !== null) {
    const isCreate = msg.compiledInstructions.some((ix) => ix.data.length >= 8 && Buffer.from(ix.data.subarray(0, 8)).equals(LAUNCHLAB_INITIALIZE_V2) && keys[ix.accountKeyIndexes[LL_SLOTS.mint]] === t.mint);
    if (!isCreate) return { ok: false, status: 422, reason: "The sent launch transaction is not this coin's create." };
  }
  return { ok: true, signature: base58Encode(tx.signatures[0]) };
}

/** What launchPendingRefusal reads: the registry and, when the host has one, a chain reader and the burn program it checks against. */
export interface PendingDeps {
  registry: Pick<Registry, "tokens" | "createSends">;
  market?: { getAccountInfo(k: PublicKey): Promise<unknown> } | null;
  program?: { programId: string } | null;
}

/**
 * B-15 / HB-55 (sixth pre-launch audit 2026-10-19): whether `creator` created this draft's coin on chain. A prepare needs no wallet proof,
 * so anyone can register a draft in another wallet's name, and anyone can send dust to its mint address; "an account exists at the mint"
 * proved nothing and blocked the named creator's own launch of the ticker for about 25 hours. Only the burn program's TokenConfig for the
 * mint (["config", mint]) counts: owned by the program, decoding as a TokenConfig, naming this mint and this creator. initialize_token
 * requires the creator's signature, so this is the creator's own act and no stranger can make it true. Dust sent to the config address
 * leaves a system-owned account with no data, which is not a TokenConfig.
 *   true   the creator's coin exists on chain
 *   false  the chain answered and there is no such TokenConfig
 *   null   unknown: no chain reader, no program id or stored config address, or the read failed
 */
export async function createdOnChainBy(d: Pick<PendingDeps, "market" | "program">, t: Pick<TokenRow, "mint" | "creator"> & { tokenConfig?: string | null }): Promise<boolean | null> {
  if (!d.market) return null;
  const programId = (d.program?.programId ?? "").trim();
  let address: PublicKey | null = null;
  try { address = programId ? configPda(new PublicKey(programId), new PublicKey(t.mint)) : t.tokenConfig ? new PublicKey(t.tokenConfig) : null; } catch { return null; }
  if (!address) return null;
  let info: unknown;
  try { info = await d.market.getAccountInfo(address); } catch { return null; }
  if (info === null || info === undefined) return false;
  const a = info as { data?: Uint8Array | Buffer; owner?: { toBase58(): string } };
  if (programId && (!a.owner || typeof a.owner.toBase58 !== "function" || a.owner.toBase58() !== programId)) return false;
  if (!a.data) return false;
  try {
    const cfg = decodeTokenConfig(a.data);
    return cfg.mint.toBase58() === t.mint && cfg.creator.toBase58() === t.creator;
  } catch { return false; }
}

/**
 * B-2 at prepare: the refusal for a registering prepare by `creator` of `ticker` on a mint other than `exceptMint`, or null. A chain read
 * that fails counts as "may have landed" for a draft whose create was sent (fail closed); for a draft with no send it proves nothing.
 * B-15: every refusal rests on something only the creator's wallet can make: a recorded send (verifySentCreate checks the creator signed
 * it) or the creator's TokenConfig on chain (createdOnChainBy). A draft someone else registered in the creator's name, unsigned, never
 * blocks that creator by itself.
 */
export async function launchPendingRefusal(d: PendingDeps, c: { creator: string; ticker: string; exceptMint: string | null }, now = Date.now()): Promise<{ status: 409; error: string; extra: { code: string; mint: string } } | null> {
  const ticker = c.ticker.trim().replace(/^\$/, "").toUpperCase();
  let mine: TokenRow[];
  try { mine = d.registry.tokens().filter((t) => t.creator === c.creator && t.ticker.toUpperCase() === ticker && t.mint !== c.exceptMint); } catch { return null; }
  const live = mine.find((t) => !!t.launchTx && (t.status === "live" || t.status === "paused"));
  if (live) return { status: 409, error: ownLiveTickerSentence(ticker, live.mint), extra: { code: "ticker-taken", mint: live.mint } };
  const open = mine.filter((t) => !t.launchTx && (t.status === "draft" || t.status === "expired") && now - t.createdAt < CHAIN_CHECK_WINDOW_MS).sort((a, b) => b.createdAt - a.createdAt);
  for (const [i, t] of open.entries()) {
    const sends = (() => { try { return d.registry.createSends(t.mint); } catch { return []; } })();
    const lastSent = sends.length ? Math.max(...sends.map((s) => s.sentAt)) : null;
    if (lastSent !== null && now - lastSent < CREATE_SEND_PENDING_MS) return { status: 409, error: launchPendingSentence(ticker, t.mint, false), extra: { code: LAUNCH_PENDING_CODE, mint: t.mint } };
    if (i >= PENDING_CHAIN_CHECKS) continue;
    // B-15: "landed" is the creator's own TokenConfig for the mint, never a bare account a stranger can fund (createdOnChainBy)
    const onChain = await createdOnChainBy(d, t);
    if (onChain === true) return { status: 409, error: launchPendingSentence(ticker, t.mint, true), extra: { code: LAUNCH_PENDING_CODE, mint: t.mint } };
    if (onChain === null && lastSent !== null && d.market) return { status: 409, error: launchPendingSentence(ticker, t.mint, false), extra: { code: LAUNCH_PENDING_CODE, mint: t.mint } };
  }
  return null;
}
