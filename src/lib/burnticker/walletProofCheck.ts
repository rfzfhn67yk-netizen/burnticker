import { statementSignatureFormat } from "@/lib/burnticker/trustpack/operator";
import { NONCE_RE, PROOF_FUTURE_SKEW_MS, PROOF_MAX_AGE_MS, parseWalletProof, type WalletProof } from "@/lib/burnticker/walletProof";

/** Prelaunch audit 2026-10-18 A-3: the server's check of a signed launch request (walletProof.ts). */
export type ProofCheck = { ok: true } | { ok: false; reason: string };

/**
 * Whether `proof` shows that `want.creator` asked for this prepare: the text is ours, names this wallet, every ticker and every mint of
 * the request (a request on the site's prepared keys needs "chosen by this site"), is fresh, and carries the wallet's own signature.
 */
export function checkWalletProof(proof: unknown, want: { creator: string; tickers: readonly string[]; mints: readonly string[]; /** review of block M: the origins this site answers on (the text must name one) */ origins?: readonly string[]; /** the review (not a prepare): any mints, and a spent proof is still good */ review?: boolean }, now = Date.now()): ProofCheck {
  const p = proof as Partial<WalletProof> | null;
  if (!p || typeof p !== "object" || typeof p.message !== "string" || typeof p.signature !== "string" || p.message.length > 1_000 || p.signature.length > 120) return { ok: false, reason: "the signed request is not in the expected form" };
  const f = parseWalletProof(p.message);
  if (!f) return { ok: false, reason: "the signed text is not a Burnticker launch request" };
  if (f.creator !== want.creator) return { ok: false, reason: "the signed text names another wallet" };
  if (want.origins && !want.origins.includes(f.origin)) return { ok: false, reason: "the signed text names another website" };
  if (!NONCE_RE.test(f.nonce)) return { ok: false, reason: "the signed text has no usable nonce" };
  const at = Date.parse(f.issuedAt);
  if (!Number.isFinite(at) || now - at > PROOF_MAX_AGE_MS || at - now > PROOF_FUTURE_SKEW_MS) return { ok: false, reason: "the signed request is too old" };
  const tickers = new Set(f.tickers);
  if (want.tickers.some((t) => !tickers.has(t.toUpperCase()))) return { ok: false, reason: "the signed text names other tickers" };
  if (!want.review && (want.mints.length ? !f.mints || want.mints.some((m) => !f.mints!.includes(m)) : f.mints !== null)) return { ok: false, reason: "the signed text names other mints" };
  // review of block M (HIGH): a hardware wallet (a Ledger behind Phantom or Solflare) signs the text wrapped as a Solana off-chain
  // message, never the raw bytes; both forms are this wallet's signature over this text (trustpack/operator.ts statementSignatureFormat)
  if (statementSignatureFormat(p.message, p.signature, want.creator) === null) return { ok: false, reason: "the signature is not this wallet's" };
  // review of block M: a proof already spent on a prepare that succeeded is never accepted again (a captured proof cannot be replayed)
  if (!want.review && proofSpent(want.creator, proofScope(f.nonce, want), now)) return { ok: false, reason: "the signed request was already used" };
  return { ok: true };
}

/**
 * USED NONCES (review of block M). A proof is spent once the prepare it was sent with succeeds: its wallet, nonce and the request's own
 * tickers and mints (one press of a matchup sends two requests, one per coin, under one signature). Kept PROOF_MAX_AGE_MS, at most
 * NONCES_PER_WALLET per wallet and NONCE_WALLETS wallets (the oldest leave first), in this process: past that window the proof is too
 * old anyway. A refused prepare does not spend it, so the same press can be retried after an upload-busy answer.
 */
export const NONCES_PER_WALLET = 50;
export const NONCE_WALLETS = 5_000;
const spent = new Map<string, Map<string, number>>();
export const proofScope = (nonce: string, want: { tickers: readonly string[]; mints: readonly string[] }): string => `${nonce}|${[...want.tickers].map((t) => t.toUpperCase()).sort().join(",")}|${[...want.mints].sort().join(",")}`;
function proofSpent(wallet: string, scope: string, now: number): boolean {
  const m = spent.get(wallet);
  const at = m?.get(scope);
  return at !== undefined && now - at < PROOF_MAX_AGE_MS;
}
/** Records a proof as spent (the prepare it came with succeeded). */
export function spendProof(proof: unknown, want: { creator: string; tickers: readonly string[]; mints: readonly string[] }, now = Date.now()): void {
  const f = proof && typeof proof === "object" && typeof (proof as WalletProof).message === "string" ? parseWalletProof((proof as WalletProof).message) : null;
  if (!f) return;
  let m = spent.get(want.creator);
  if (m) spent.delete(want.creator); else m = new Map();
  spent.set(want.creator, m);
  for (const [k, at] of m) if (now - at >= PROOF_MAX_AGE_MS) m.delete(k);
  m.set(proofScope(f.nonce, want), now);
  while (m.size > NONCES_PER_WALLET) { const k = m.keys().next().value; if (k === undefined) break; m.delete(k); }
  while (spent.size > NONCE_WALLETS) { const k = spent.keys().next().value; if (k === undefined) break; spent.delete(k); }
}
/** For tests. */
export function resetSpentProofs(): void { spent.clear(); }

/**
 * Review of block M: the wallet a launch review may treat as the creator. A review answers "taken" for a ticker any coin holds, including
 * a draft, unless the request carries the claimed wallet's own signed request over its tickers (any mints; a spent one is still good):
 * otherwise a stranger could ask with someone else's wallet and learn which wallet owns a draft. Null: nobody proven.
 */
export function provenReviewCreator(body: unknown, origins: readonly string[], now = Date.now()): string | null {
  const b = (body ?? {}) as { creator?: unknown; walletProof?: unknown; ticker?: unknown; pair?: { ticker?: unknown } | null; companion?: { ticker?: unknown } | null };
  if (typeof b.creator !== "string" || !b.walletProof) return null;
  const tickers = [b.ticker, b.pair?.ticker, b.companion?.ticker].filter((t): t is string => typeof t === "string" && t.trim().length > 0).map((t) => t.toUpperCase());
  return checkWalletProof(b.walletProof, { creator: b.creator, tickers, mints: [], origins, review: true }, now).ok ? b.creator : null;
}

