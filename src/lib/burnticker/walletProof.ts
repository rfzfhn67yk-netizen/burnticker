/**
 * THE WALLET'S SIGNED LAUNCH REQUEST (prelaunch audit 2026-10-18 A-3). A prepare costs this site a paid Arweave upload and, on the launch
 * page, a key from the mint bank, while its `creator` field is only a claim. The launch page therefore asks the wallet to sign one short
 * message per Launch press (signMessage: no transaction, no fee) naming the wallet, the tickers, the mints (or "chosen by this site" when
 * the site's prepared keys are used), a random nonce and the time. The server checks the signature against the creator's public key
 * (ed25519 over the exact UTF-8 text) before it counts the upload. A signed request may use the whole daily upload limit; an unsigned
 * one (an API caller, a wallet that cannot sign messages) only the part of it that is not kept for signed requests. The proof is good for
 * PROOF_MAX_AGE_MS, so a retry of the same press needs no second signature; it only ever speaks for its own wallet and tickers.
 * Client-safe; the server's check is walletProofCheck.ts.
 */
export interface WalletProof { message: string; signature: string }
export interface ProofFields { creator: string; tickers: readonly string[]; mints: readonly string[] | null; nonce: string; issuedAt: string; /** review of block M: the page's origin, so another site cannot reuse the text */ origin: string }

export const PROOF_MAX_AGE_MS = 15 * 60_000;
/** A clock up to this far ahead of the server's is still accepted. */
export const PROOF_FUTURE_SKEW_MS = 2 * 60_000;
const HEAD = "Burnticker launch request";
const BANK = "chosen by this site";
/** Review of block M: the domain line every signed text carries (another site's text never verifies here). */
export const PROOF_SITE = "burnticker.com";
/** The public site, the origin a request from outside a page (the SDK without its own base) names. */
export const DEFAULT_PROOF_ORIGIN = "https://burnticker.com";
export const NONCE_RE = /^[A-Za-z0-9]{16,64}$/;

/** The exact text the wallet signs (one field per line). */
export function walletProofMessage(f: ProofFields): string {
  return [HEAD, `Site: ${PROOF_SITE}`, `Origin: ${f.origin}`, `Wallet: ${f.creator}`, `Tickers: ${f.tickers.map((t) => `$${t.toUpperCase()}`).join(" ")}`, `Mints: ${f.mints && f.mints.length ? f.mints.join(" ") : BANK}`, `Nonce: ${f.nonce}`, `Issued: ${f.issuedAt}`,
    "Signing this costs nothing and sends nothing. It only shows that this wallet asked for the launch."].join("\n");
}

/** A random nonce for one press (browser or server: Web Crypto). */
export function newProofNonce(): string {
  const b = new Uint8Array(16);
  globalThis.crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/** The fields of a signed text, or null when it is not ours. */
export function parseWalletProof(message: string): ProofFields | null {
  const lines = message.split("\n");
  if (lines[0] !== HEAD) return null;
  const get = (k: string) => { const l = lines.find((x) => x.startsWith(`${k}: `)); return l ? l.slice(k.length + 2).trim() : null; };
  const creator = get("Wallet"), tickers = get("Tickers"), mints = get("Mints"), nonce = get("Nonce"), issuedAt = get("Issued"), origin = get("Origin");
  if (get("Site") !== PROOF_SITE || !origin || !creator || !tickers || !mints || !nonce || !issuedAt) return null;
  return { origin, creator, tickers: tickers.split(/\s+/).map((t) => t.replace(/^\$/, "").toUpperCase()).filter(Boolean), mints: mints === BANK ? null : mints.split(/\s+/).filter(Boolean), nonce, issuedAt };
}

/**
 * The launch page's side (A-3): asks the wallet to sign the request text for one Launch press. A wallet that cannot sign messages, or a
 * creator who declines, gives null and the press goes on unsigned (it then uses only the unsigned part of the day's uploads).
 */
export async function signLaunchRequest(signMessage: ((m: Uint8Array) => Promise<Uint8Array>) | undefined, f: { creator: string; tickers: readonly string[]; mints: readonly string[]; /** the page's origin (window.location.origin); default the public site */ origin?: string }, encode58: (b: Uint8Array) => string, now = Date.now()): Promise<WalletProof | null> {
  if (!signMessage || !f.creator) return null;
  const message = walletProofMessage({ origin: f.origin ?? DEFAULT_PROOF_ORIGIN, creator: f.creator, tickers: f.tickers, mints: f.mints.length ? f.mints : null, nonce: newProofNonce(), issuedAt: new Date(now).toISOString() });
  try { return { message, signature: encode58(await signMessage(new TextEncoder().encode(message))) }; } catch { return null; }
}

/**
 * Sixth-pass audit HB-53 / B-13: a wallet that can sign messages is ASKED to sign the request, and a refusal (or a failure) stops the press
 * before anything is prepared or sent. Only a wallet that cannot sign messages at all goes on unsigned (it is never asked, so it is not
 * counted as a prompt either).
 */
export const PROOF_REJECTED_SENTENCE = "The wallet did not sign the request that proves this launch is yours, so nothing was sent. Press the button to try again.";
export class LaunchProofRejected extends Error { constructor() { super(PROOF_REJECTED_SENTENCE); this.name = "LaunchProofRejected"; } }
export async function requireLaunchProof(signMessage: ((m: Uint8Array) => Promise<Uint8Array>) | undefined, f: Parameters<typeof signLaunchRequest>[1], encode58: (b: Uint8Array) => string, now = Date.now()): Promise<WalletProof | null> {
  if (!signMessage || !f.creator) return null;
  const p = await signLaunchRequest(signMessage, f, encode58, now);
  if (!p) throw new LaunchProofRejected();
  return p;
}
/** HB-53: the wallet prompts a launch plan asks for: the sign-message proof when the wallet is asked for it, plus one per transaction step. */
export const walletPromptCount = (o: { transactions: number; proof: boolean }): number => Math.max(0, o.transactions) + (o.proof ? 1 : 0);

/** The prepare's code for a signature that does not check out (api/handlers.ts). */
export const WALLET_PROOF_INVALID_CODE = "wallet-proof-invalid";
/**
 * Review of block M: a press whose signed request is refused (401 wallet-proof-invalid: a wallet whose signature form this site cannot
 * read, a clock far off) is sent ONCE more without the signature, so the creator still launches from the unsigned share instead of
 * being refused on every press. `send` throws an error carrying `code` (pairLaunchClient.ts LaunchRequestError) on a refusal.
 */
export async function sendWithProofFallback<T>(body: Record<string, unknown>, send: (b: Record<string, unknown>) => Promise<T>): Promise<T> {
  try { return await send(body); }
  catch (e) {
    if (!body.walletProof || (e as { code?: unknown })?.code !== WALLET_PROOF_INVALID_CODE) throw e;
    const { walletProof: _drop, ...unsigned } = body;
    void _drop;
    return send(unsigned);
  }
}

/** Review of block M: the review's button for a creator whose own unfinished launch holds the ticker. */
export const PROVE_TICKER_LABEL = "Is this ticker held by your own unfinished launch? Confirm it with your wallet.";

