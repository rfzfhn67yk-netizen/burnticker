import { Buffer } from "buffer";
import { Keypair, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
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
export const PAIR_CURVE_REVIEW_LINE = "pair curve · both graduate or neither";

/** Which venue to ask for, from the catalogue's venue flags (absent → LaunchLab, the server corrects a stale read with a 409). */
export const venueFor = (venues: { pairCurve?: boolean } | null | undefined): PairVenue => (venues?.pairCurve ? "pair-curve" : "launchlab");

export interface LaunchErrorBody { error?: string; code?: string; retryAfterSec?: number }

/** A launch response that is not 200 → one plain sentence for the review step. */
export function launchErrorMessage(status: number, body: LaunchErrorBody | null, retryAfterHeader?: string | null): string {
  const code = body?.code ?? "";
  if (status === 409 && code === "pair-curve-required") return "On this site a matchup launches as one pair curve: both coins graduate together or neither does. Press the button again to build that.";
  if (status === 409 && code === "pair-curve-unavailable") return "The pair curve is not switched on here, so the two coins launch separately. Press the button again to build those.";
  if (status === 409 && code === "ticker-taken") return `${body?.error ?? "That ticker is taken"}. Pick another ticker.`;
  if (status === 429) {
    const s = Number(retryAfterHeader ?? body?.retryAfterSec);
    const wait = Number.isFinite(s) && s > 0 ? (s >= 90 ? `about ${Math.ceil(s / 60)} minutes` : `${Math.ceil(s)} seconds`) : "a little while";
    return `Too many launch requests from this connection. Try again in ${wait}.`;
  }
  if (status === 503 && code === "launch-unverifiable") return "This site cannot confirm launches yet (no chain connection is set up on the server). Your coins stay drafts; nothing was lost.";
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

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
/** base58 → bytes (a mint secret key from the launch response). */
export function base58ToBytes(s: string): Uint8Array {
  const bytes: number[] = [0];
  for (const ch of s) {
    let carry = B58.indexOf(ch);
    if (carry < 0) throw new Error("not base58");
    for (let i = 0; i < bytes.length; i++) { carry += bytes[i] * 58; bytes[i] = carry & 0xff; carry >>= 8; }
    while (carry > 0) { bytes.push(carry & 0xff); carry >>= 8; }
  }
  for (const ch of s) { if (ch !== "1") break; bytes.push(0); }
  return Uint8Array.from(bytes.reverse());
}

/** Why the pair-curve set cannot be signed in this browser, or [] when it can. */
export function pairCurveSignProblems(pc: PairCurveLaunchBundle, creator: string | null, keys: { a: string; b: string } | null): string[] {
  const out: string[] = [];
  if (!pc.ready) out.push(...pc.pending.filter((p) => !/^Metaplex metadata/.test(p)));
  if (!creator) out.push("connect the wallet that is the creator");
  const needs = new Set(pc.transactions.flatMap((t) => t.signers));
  if ((needs.has("mintA") || needs.has("mintB")) && !keys) out.push("the server did not hand over the two mint keys, so the mint transactions cannot be signed here");
  if (keys) {
    for (const [side, k, want] of [["A", keys.a, pc.mints.a], ["B", keys.b, pc.mints.b]] as const) {
      try { if (Keypair.fromSecretKey(base58ToBytes(k)).publicKey.toBase58() !== want) out.push(`mint key ${side} does not match mint ${want}`); } catch { out.push(`mint key ${side} is not a valid key`); }
    }
  }
  return out;
}

/** One pair-curve transaction, built and signed by the mint keypair(s) it names (the wallet signs after). */
export function buildPairCurveTx(t: PairCurveLaunchBundle["transactions"][number], creator: string, keys: { a: string; b: string } | null, recentBlockhash: string): Transaction {
  const tx = new Transaction({ feePayer: new PublicKey(creator), recentBlockhash });
  for (const ix of t.instructions) tx.add(new TransactionInstruction({ programId: new PublicKey(ix.programId), keys: ix.keys.map((k) => ({ pubkey: new PublicKey(k.pubkey), isSigner: k.isSigner, isWritable: k.isWritable })), data: Buffer.from(ix.dataBase64, "base64") }));
  const mintSigners = t.signers.filter((s) => s !== "creator").map((s) => {
    const k = s === "mintA" ? keys?.a : keys?.b;
    if (!k) throw new Error(`${t.label}: needs the ${s} key`);
    return Keypair.fromSecretKey(base58ToBytes(k));
  });
  if (mintSigners.length) tx.partialSign(...mintSigners);
  return tx;
}

export interface SendDeps {
  latestBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: number }>;
  signTransaction(tx: Transaction): Promise<Transaction>;
  sendRaw(raw: Uint8Array): Promise<string>;
  confirm(sig: string, bh: { blockhash: string; lastValidBlockHeight: number }): Promise<{ err: unknown }>;
}
export interface SendResult { signatures: string[]; failedAt: number | null; error: string | null }

/**
 * The three transactions in order: build → mint keys sign → wallet signs → send → confirmed, then the next. Stops at the first failure;
 * `prior` (the signatures already confirmed) resumes at the failed step, so a confirmed step is never sent twice.
 */
export async function signAndSendPairCurve(pc: PairCurveLaunchBundle, creator: string, keys: { a: string; b: string } | null, d: SendDeps, onStep?: (i: number, sig: string) => void, prior: string[] = []): Promise<SendResult> {
  const signatures: string[] = prior.slice(0, pc.transactions.length);
  for (let i = signatures.length; i < pc.transactions.length; i++) {
    try {
      const bh = await d.latestBlockhash();
      const signed = await d.signTransaction(buildPairCurveTx(pc.transactions[i], creator, keys, bh.blockhash));
      const sig = await d.sendRaw(signed.serialize());
      const c = await d.confirm(sig, bh);
      if (c.err) throw new Error(`the chain rejected it (${JSON.stringify(c.err).slice(0, 120)})`);
      signatures.push(sig); onStep?.(i, sig);
    } catch (e) {
      const m = (e as Error).message ?? String(e);
      return { signatures, failedAt: i, error: /reject|denied|cancel/i.test(m) && !/chain rejected/.test(m) ? `step ${i + 1} of ${pc.transactions.length} was not signed in the wallet` : `step ${i + 1} of ${pc.transactions.length} failed: ${m.slice(0, 200)}` };
    }
  }
  return { signatures, failedAt: null, error: null };
}

/**
 * Which transaction confirms which draft (`action: "launched"`): tx 1 for side A, tx 2 for side B (the fix agent, commit 04c7bc4e:
 * launchVerify wants a successful transaction signed by that coin's mint and its creator that calls burn_receipts and landed after the
 * draft; init_pair is refused because no mint signs it). Burns stay pending-pair until both pools exist, so confirming A first is safe.
 */
export const PAIR_CURVE_LAUNCHED_TX: { a: number; b: number } = { a: 0, b: 1 };
export const launchedSignatures = (pc: PairCurveLaunchBundle, sigs: string[], map: { a: number; b: number } = PAIR_CURVE_LAUNCHED_TX): { mint: string; launchTx: string }[] =>
  sigs[map.a] && sigs[map.b] ? [{ mint: pc.mints.a, launchTx: sigs[map.a] }, { mint: pc.mints.b, launchTx: sigs[map.b] }] : [];

/** A failed `launched` confirmation → one plain sentence (404 = not seen yet, retried before this is shown). */
export function launchedErrorMessage(status: number, body: LaunchErrorBody | null, retryAfterHeader?: string | null): string {
  if (status === 404) return "The server has not seen the transaction on chain yet. Wait a minute and press the button again.";
  if (status === 422) return "The server did not accept that transaction as this coin's launch. Nothing changed; the coin stays a draft.";
  if (status === 409) return "This coin is already recorded as launched in a different transaction.";
  return launchErrorMessage(status, body, retryAfterHeader);
}

export interface ConfirmResult { confirmed: string[]; error: string | null }
/**
 * Confirms each side with the launch route, A then B. A 404 (the transaction is not visible to the server yet) is retried `retries`
 * times, `waitMs` apart; any other failure stops with a plain sentence. Mints in `already` are skipped (a re-press never re-sends them;
 * the server would answer replay anyway). Two of the client's ten writes an hour.
 */
export async function confirmLaunched(fetchFn: FetchLike, pc: PairCurveLaunchBundle, sigs: string[], o: { already?: string[]; retries?: number; waitMs?: number; sleep?: (ms: number) => Promise<void>; url?: string } = {}): Promise<ConfirmResult> {
  const confirmed = [...(o.already ?? [])];
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (const l of launchedSignatures(pc, sigs)) {
    if (confirmed.includes(l.mint)) continue;
    for (let attempt = 0; ; attempt++) {
      const r = await fetchFn(o.url ?? "/api/burnticker/launch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "launched", mint: l.mint, launchTx: l.launchTx }) });
      if (r.ok) { confirmed.push(l.mint); break; }
      const j = (await r.json().catch(() => null)) as LaunchErrorBody | null;
      if (r.status === 404 && attempt < (o.retries ?? 5)) { await sleep(o.waitMs ?? 4000); continue; }
      return { confirmed, error: launchedErrorMessage(r.status, j, r.headers.get("retry-after")) };
    }
  }
  return { confirmed, error: null };
}
