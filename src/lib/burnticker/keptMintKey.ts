import { serverKeyFor, withMintSource, MINT_MISMATCH_LINE, MINT_SERVER_KEY_LINE, type GroundMint, type MintGrindPool } from "@/lib/burnticker/vanityMint";

/**
 * LA6-4 (sixth pass, 2026-10-19): THE PREPARED MINT KEY ACROSS A RELOAD. A press of Launch takes a key from the server's bank and the
 * key lived only in page memory, so a wallet refusal followed by a reload took a new bank key and left the first draft holding its ticker.
 * The key the server handed back for a single coin is now kept in this tab (sessionStorage), scoped like keptReviewProof: the wallet and
 * the ticker it was prepared for, and an age limit inside the draft's own lifetime. The next press for the same wallet and ticker sends
 * that key's address, and the server reuses the creator's own unfinished draft (registry.ownDraft) instead of taking another key. It is
 * cleared on launch, on Start over, and when the server refuses a press made with it. Pure apart from the storage the page passes in.
 */
export const PREPARED_MINT_STORE = "burnticker.launch.mint.v1";
/** Kept a little under the registry's 24-hour draft lifetime (registry.ts DRAFT_TTL_MS), so a kept key never outlives its draft. */
export const KEPT_MINT_MAX_AGE_MS = 23 * 60 * 60 * 1000;

interface KeptMint { creator: string; ticker: string; mint: string; secret: string; at: number }
/** The key check (the server's own: 64 bytes that derive the address, which ends in burn or BURN); a test passes its own suffix rule. */
type KeyCheck = (mint: string, secret: string) => GroundMint;

/** The stored text for a key the server prepared (null when anything is missing: nothing is kept). */
export function keptMintText(k: { creator: string | null | undefined; ticker: string; mint: string; secret: string | null | undefined }, now = Date.now(), check: KeyCheck = serverKeyFor): string | null {
  if (!k.creator || !k.ticker || !k.mint || !k.secret) return null;
  try { check(k.mint, k.secret); } catch { return null; }
  const v: KeptMint = { creator: k.creator, ticker: k.ticker.trim().toUpperCase(), mint: k.mint, secret: k.secret, at: now };
  return JSON.stringify(v);
}

/** The kept key for this wallet and ticker, when it is sound and inside its age limit; else null. */
export function keptMintKey(raw: string | null | undefined, want: { creator: string | null | undefined; ticker: string }, now = Date.now(), maxAgeMs = KEPT_MINT_MAX_AGE_MS, check: KeyCheck = serverKeyFor): GroundMint | null {
  if (!raw || !want.creator) return null;
  let v: Partial<KeptMint> | null;
  try { v = JSON.parse(raw) as Partial<KeptMint> | null; } catch { return null; }
  if (!v || typeof v !== "object" || typeof v.creator !== "string" || typeof v.ticker !== "string" || typeof v.mint !== "string" || typeof v.secret !== "string" || typeof v.at !== "number") return null;
  if (v.creator !== want.creator || v.ticker !== want.ticker.trim().toUpperCase()) return null;
  if (!(now - v.at >= 0 && now - v.at < maxAgeMs)) return null;
  try { return check(v.mint, v.secret); } catch { return null; }
}

/** One press: with a kept key the press goes on with it (its address is sent); otherwise the usual source (the bank, then the search). */
export function withKeptMint<T>(kept: GroundMint | null, o: { pool: Pick<MintGrindPool, "ensure"> | null; n: number; stale?: () => boolean; staleLine?: string }, run: (keys: GroundMint[] | null) => Promise<T>): Promise<T> {
  return kept && o.n === 1 ? run([kept]) : withMintSource(o, run);
}

/**
 * Whether a failed press made with a kept key drops it: the server refused the request (a 4xx such as mint-taken, own-draft-changed or an
 * expired draft), or the answer named another address. A busy server (429), a refused wallet signature (401, retried unsigned) or a
 * network failure keeps it, so the next press still reuses the draft.
 */
export function dropsKeptMint(e: unknown): boolean {
  const s = (e as { status?: unknown } | null)?.status;
  if (typeof s === "number") return s >= 400 && s < 500 && s !== 401 && s !== 429;
  const m = (e as { message?: unknown } | null)?.message;
  return m === MINT_MISMATCH_LINE || m === MINT_SERVER_KEY_LINE;
}
