import type { VersionedTransaction } from "@solana/web3.js";
import { buildStepTx, confirmPlan, pairCurvePlan, planProblems, signAndSendPlan, type ConfirmResult, type SendDeps, type SendResult } from "@/lib/burnticker/signPlan";
import type { PairCurveLaunchBundle } from "@/lib/burnticker/pairCurveLaunch";

/**
 * THE WIZARD'S SIDE OF A PAIR LAUNCH (2026-10-10; the fix agent's review N6 contract on POST /api/burnticker/launch). Client-safe: no
 * node built-ins, type-only import of the server's pair-curve bundle.
 *
 *   venue        the catalogue says `venues.pairCurve` (BURNTICKER_PAIR_CURVE_ENABLED on the host) → a pair is sent with
 *                `venue: "pair-curve"` and comes back as ONE pair-curve transaction set (3 txs; signers creator / mintA / mintB),
 *                never the two LaunchLab bundles. Off → `venue: "launchlab"` and `bundles.a / b` as before. A stale catalogue is
 *                corrected by the server's 409 (`pair-curve-required` / `pair-curve-unavailable`): the page switches to the venue it
 *                names (venueFrom409), the review line changes, and the creator presses the button again — never a silent switch.
 *   messages     409 / 429 / 503 become plain sentences (launchErrorMessage); nothing technical reaches the screen.
 *   signing      the three transactions in order, each signed by the mint keypair it names and then by the wallet, sent, confirmed
 *                before the next; the first failure stops the run and says which step (a half-signed set is never sent).
 */

export type PairVenue = "pair-curve" | "launchlab";
export const PAIR_CURVE_REVIEW_LINE = "Both coins graduate together, or neither does.";

/** Which venue to ask for, from the catalogue's venue flags (absent → LaunchLab, the server corrects a stale read with a 409). */
export const venueFor = (venues: { pairCurve?: boolean } | null | undefined): PairVenue => (venues?.pairCurve ? "pair-curve" : "launchlab");

export interface LaunchErrorBody { error?: string; code?: string; retryAfterSec?: number; /** A-19: a 422 whose account the server's RPC has not shown yet (not final) */ missing?: boolean }
/** A-19: a confirm refused only because the server's RPC has not shown the coin's account yet (the card keeps checking first). */
export const LAUNCH_NOT_SEEN_YET_SENTENCE = "The server has not seen this launch on chain yet, so it kept checking. It can take a minute to show up. Wait a minute and press the button again; nothing is lost.";

/** A-19: the prepare's 429 codes for the daily upload limits and for uploads busy right now (api/handlers.ts budgetRefusal). */
export const UPLOAD_LIMIT_CODES: ReadonlySet<string> = new Set(["upload-budget", "upload-budget-client", "upload-budget-creator", "upload-busy"]);
const UPLOAD_LIMIT_FALLBACK = "This site has reached a daily limit for saving coin details. Please try again later.";
/** How long a 429 asks to wait, in words. */
const waitText = (retryAfterHeader: string | null | undefined, body: LaunchErrorBody | null): string => {
  const s = Number(retryAfterHeader ?? body?.retryAfterSec);
  return Number.isFinite(s) && s > 0 ? (s >= 90 ? `about ${Math.ceil(s / 60)} minutes` : `${Math.ceil(s)} seconds`) : "a little while";
};
/** A launch response that is not 200 → one plain sentence for the review step. */
/** The launch answer while the site is being updated (Caddy's fallback 503 during a deploy restart). */
export const LAUNCH_DURING_UPDATE_SENTENCE = "Burnticker is being updated right now, so this launch was not started. Nothing was sent. Wait a minute and press Launch again.";
export function launchErrorMessage(status: number, body: LaunchErrorBody | null, retryAfterHeader?: string | null): string {
  const code = body?.code ?? "";
  if (status === 409 && code === "pair-curve-required") return "On this site a matchup launches as one pair curve: both coins graduate together or neither does. Press the button again to build that.";
  if (status === 409 && code === "pair-curve-unavailable") return "The pair curve is not switched on here, so the two coins launch separately. Press the button again to build those.";
  if (status === 409 && code === "ticker-taken") return `${body?.error ?? "That ticker is taken"}. Pick another ticker.`;
  if (status === 429) {
    // second prelaunch audit 2026-10-18 A-19: chosen by CODE. The daily upload limits and the busy answer carry the server's own
    // sentence (which limit, and when it resets); only the connection's request limit is "too many launch requests".
    if (UPLOAD_LIMIT_CODES.has(code)) return asSentence(body?.error) || UPLOAD_LIMIT_FALLBACK;
    if (code && code !== "rate-limited" && asSentence(body?.error)) return asSentence(body?.error);
    return `Too many launch requests from this connection. Try again in ${waitText(retryAfterHeader, body)}.`;
  }
  // 2026-10-15 (the synthetic creator's deploy-window scenario): while the web unit restarts, Caddy answers the launch with its own JSON 503
  // (code app-unavailable, "the app is catching up"). The creator is told the site is being updated, never the fallback's words
  if (status === 503 && code === "app-unavailable") return LAUNCH_DURING_UPDATE_SENTENCE;
  if (status === 503 && code === "launch-unverifiable") return "This site cannot confirm launches yet (no chain connection is set up on the server). Your coins stay drafts; nothing was lost.";
  // launch walkthrough 2026-10-13: a 503 that carries the server's own sentence (a launch check that could not read a source, sent as 503
  // so Cloudflare passes it through) shows that sentence, not the generic line: the creator needs to know which check stopped the coin
  if (status === 503 && typeof body?.error === "string" && body.error.trim()) return `${body.error.trim().replace(/\.?$/, ".")} Nothing was sent.`;
  if (status === 503) return "The launch service is not available right now. Nothing was sent; try again later.";
  if (status === 409) return body?.error ? `${body.error}.` : "That launch conflicts with an existing coin.";
  return body?.error ?? `The launch request failed (${status}).`;
}

export class LaunchRequestError extends Error {
  readonly status: number;
  readonly code: string | null;
  constructor(status: number, code: string | null, message: string) { super(message); this.status = status; this.code = code; }
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; headers: { get(name: string): string | null }; json(): Promise<unknown> }>;

export interface LaunchlabPairResult { venue: "launchlab"; pair: { pairId: string; notes?: string[] }; bundles: { a: unknown; b: unknown }; tokens?: unknown }
export interface PairCurvePairResult { venue: "pair-curve"; pair: { pairId: string; notes?: string[] }; pairCurve: PairCurveLaunchBundle; tokens?: unknown; mintSecretKeys: { a: string; b: string } | null }
export type PairLaunchResult = LaunchlabPairResult | PairCurvePairResult;

/** The venue a 409 says this host uses (the catalogue was stale), or null for any other failure. */
export const venueFrom409 = (e: unknown): PairVenue | null =>
  e instanceof LaunchRequestError && e.status === 409 ? (e.code === "pair-curve-required" ? "pair-curve" : e.code === "pair-curve-unavailable" ? "launchlab" : null) : null;

/**
 * POST a pair to the launch route with the venue the catalogue named. Any failure throws a LaunchRequestError carrying the plain message
 * (a venue 409 included: venueFrom409 tells the page which venue to show before the creator presses again).
 */
export async function postPairLaunch(fetchFn: FetchLike, body: Record<string, unknown>, venue: PairVenue, url = "/api/burnticker/launch"): Promise<PairLaunchResult> {
  const send = async (v: PairVenue): Promise<PairLaunchResult> => {
    const r = await fetchFn(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, venue: v }) });
    const j = (await r.json().catch(() => null)) as Record<string, unknown> | null;
    if (!r.ok) {
      const code = typeof j?.code === "string" ? j.code : null;
      throw new LaunchRequestError(r.status, code, launchErrorMessage(r.status, j as LaunchErrorBody | null, r.headers.get("retry-after")));
    }
    if (!j) throw new LaunchRequestError(r.status, null, "The launch response was empty.");
    if (j.venue === "pair-curve" || j.pairCurve) {
      const pc = j.pairCurve as PairCurveLaunchBundle;
      const keys = (j.mintSecretKeys ?? (pc as unknown as { mintSecretKeys?: unknown }).mintSecretKeys ?? null) as { a?: unknown; b?: unknown } | null;
      return { venue: "pair-curve", pair: j.pair as PairCurvePairResult["pair"], pairCurve: pc, tokens: j.tokens, mintSecretKeys: keys && typeof keys.a === "string" && typeof keys.b === "string" ? { a: keys.a, b: keys.b } : null };
    }
    if (!j.bundles) throw new LaunchRequestError(r.status, null, "The launch response carried no bundles.");
    return { venue: "launchlab", pair: j.pair as LaunchlabPairResult["pair"], bundles: j.bundles as LaunchlabPairResult["bundles"], tokens: j.tokens };
  };
  return send(venue);
}

// ---- signing: the shared plan (signPlan.ts); these wrappers keep the pair-curve names the tests and older callers use ----------------
export { base58ToBytes, type SendDeps, type SendResult, type ConfirmResult } from "@/lib/burnticker/signPlan";

/** Why the pair-curve set cannot be signed in this browser, or [] when it can. */
export const pairCurveSignProblems = (pc: PairCurveLaunchBundle, creator: string | null, keys: { a: string; b: string } | null): string[] => planProblems(pairCurvePlan(pc, keys), creator);
/** One pair-curve transaction, built and signed by the mint keypair(s) it names (tests; the live runner has the wallet sign first, then the keys). */
export const buildPairCurveTx = (t: PairCurveLaunchBundle["transactions"][number], creator: string, keys: { a: string; b: string } | null, recentBlockhash: string): VersionedTransaction =>
  buildStepTx({ label: t.label, signers: [...t.signers], instructions: t.instructions }, creator, { mintA: keys?.a, mintB: keys?.b }, recentBlockhash);
/** The three transactions in order (signAndSendPlan); `prior` resumes at the failed step. */
export const signAndSendPairCurve = (pc: PairCurveLaunchBundle, creator: string, keys: { a: string; b: string } | null, d: SendDeps, onStep?: (i: number, sig: string) => void, prior: string[] = []): Promise<SendResult> =>
  signAndSendPlan(pairCurvePlan(pc, keys), creator, d, onStep, prior);

/** Which transaction confirms which draft: tx 1 for side A, tx 2 for side B (launchVerify, the fix agent's 04c7bc4e). */
export const PAIR_CURVE_LAUNCHED_TX: { a: number; b: number } = { a: 0, b: 1 };
export const launchedSignatures = (pc: PairCurveLaunchBundle, sigs: string[], map: { a: number; b: number } = PAIR_CURVE_LAUNCHED_TX): { mint: string; launchTx: string }[] =>
  sigs[map.a] && sigs[map.b] ? [{ mint: pc.mints.a, launchTx: sigs[map.a] }, { mint: pc.mints.b, launchTx: sigs[map.b] }] : [];

/** The server's own sentence as one sentence: first letter capitalised, ending with a full stop. "" when it gave none. */
const asSentence = (s: string | undefined): string => { const t = (s ?? "").trim(); if (!t) return ""; const c = t[0].toUpperCase() + t.slice(1); return /[.!?]$/.test(c) ? c : `${c}.`; };
const KEPT_DRAFT = "Nothing changed, and the coin stays a draft.";

/**
 * A failed `launched` confirmation, one plain sentence chosen by the response's CODE (prelaunch audit 2026-10-16 F-17; the codes are
 * api/handlers.ts markLaunched's), falling back to the server's own sentence. 404 = not seen yet (retried before this is shown).
 */
export function launchedErrorMessage(status: number, body: LaunchErrorBody | null, retryAfterHeader?: string | null): string {
  const code = body?.code ?? "", own = asSentence(body?.error);
  if (status === 404) return "The server has not seen the transaction on chain yet. Wait a minute and press the button again.";
  if (code === "already-launched") return "This coin is already recorded as launched in a different transaction.";
  if (code === "launch-late") return "This launch landed more than 24 hours after its draft was made, so it is not recorded. Start over to build a new launch.";
  if (code === "launch-after-closure") return own || "This launch landed after creator launches closed, so it is not recorded.";
  if (code === "launch-race") return "This coin was being recorded by another check at the same moment. Reload the page to see whether it is live.";
  if (code === "launch-unverified") {
    // A-19: an account the server's RPC has not shown yet (`missing`) is not a final answer: the card asks again before this is shown
    if (status === 422 && body?.missing === true) return LAUNCH_NOT_SEEN_YET_SENTENCE;
    if (status === 422) return own ? `The server did not accept that transaction as this coin's launch. ${own} ${KEPT_DRAFT}` : `The server did not accept that transaction as this coin's launch. ${KEPT_DRAFT}`;
    return own || `The server could not confirm this launch just now. ${KEPT_DRAFT}`;
  }
  // A-19: the launch route's own per-connection confirm limit is not the coin's signature ceiling
  if (status === 429 && code === "confirm-busy") return `This connection sent many launch records in the last minute. Try again in ${waitText(retryAfterHeader, body)}. The coin itself is not affected.`;
  if (status === 429 && code === "rate-limited") return `This coin's launch was checked with too many different transactions in the last hour. Try again in ${waitText(retryAfterHeader, body)}.`;
  if ((status === 409 || status === 422 || status === 403) && own) return own;
  if (status === 409 || status === 422) return `The server could not record this launch. ${KEPT_DRAFT}`;
  return launchErrorMessage(status, body, retryAfterHeader);
}

/** Confirms each pair-curve draft (confirmPlan): A then B; 404 retried; other failures a plain sentence. */
export const confirmLaunched = (fetchFn: FetchLike, pc: PairCurveLaunchBundle, sigs: string[], o: { already?: string[]; retries?: number; waitMs?: number; sleep?: (ms: number) => Promise<void>; url?: string } = {}): Promise<ConfirmResult> =>
  confirmPlan(fetchFn, pairCurvePlan(pc, null), sigs, (st, b, ra) => launchedErrorMessage(st, b, ra), o);
