import { PublicKey } from "@solana/web3.js";
import { verifyAttestation } from "@/lib/burnReceipts/attestation";
import { formatDate } from "@/lib/burnReceipts/math";
import type { Cosignature, ProgramConfigView, ProgramPort, ReadingInput } from "@/lib/burnKeeper/programPort";

/**
 * THE SECOND READING SIGNER (signer-2, 2026-10-12; docs/burnticker/SIGNER-TWO.md). Two halves (this file is the wire format and the
 * keeper side, kept free of the keepers' own modules so both keepers can import it; the signer side is cosignSigner.ts):
 *
 *   KEEPER SIDE  `Cosigner` (httpCosigner) asks the signer host to co-sign the exact v3 message of a reading (or a pair result), and
 *                `checkCosignature` turns its answer into a signature the program port can put in the ONE shared-message
 *                Ed25519SigVerify instruction, or into a hold. A disagreement is an alert and no reading; a signer that cannot check
 *                (source down, unsupported coin, unreachable) is a wait when the quorum needs it and nothing at all when it does not.
 *   SIGNER SIDE  `decideCosign` runs on the separate host (scripts/burnticker-signer.mts). It trusts nothing in the request except as a
 *                claim to compare: it reads the coin's rules and the primary source itself, recomputes the unit counter with the
 *                keeper's own engine (byo.ts counterAt → multiKeeper.planToken) — or, for a $DEFICIT-style coin, reads Treasury's
 *                row for the day — builds the message with ITS OWN program id and genesis,
 *                and signs only when its bytes equal the keeper's. It never signs two different messages for the same coin and day
 *                (the journal), so a bad keeper cannot collect a second, conflicting signature.
 *
 * The message format is attestation.ts / pairs.ts, unchanged. Not built: pair coins and pair results (the signer answers
 * "cannot-check": replaying a pair's pool gate and roles independently is not written yet), Burn Derby, Kalshi and the end-of-rule clock
 * days (a non-zero proof=), the same limits as the public reader.
 */

// ---------------------------------------------------------------------------------------------------------------------------------
// The wire format (keeper → signer, JSON over HTTPS or a private network)
// ---------------------------------------------------------------------------------------------------------------------------------

export interface ReadingCosignRequest {
  v: 1; kind: "reading";
  mint: string; ticker: string; programId: string; genesis: string; feedId: string;
  /** YYYY-MM-DD; prevDate null = the baseline reading (prev=none). */
  recordDate: string; prevDate: string | null; value: string;
  eventIds: string[]; sourceUrl: string; /** hex, 64 chars */ proofHash: string;
  /** The exact UTF-8 message the keeper will submit. */
  message: string;
}
export interface PairCosignRequest {
  v: 1; kind: "pair";
  mintA: string; mintB: string; programId: string; genesis: string; recordDate: string; winner: string | null; sourceUrl: string; proofHash: string; message: string;
}
export type CosignRequest = ReadingCosignRequest | PairCosignRequest;

export type CosignAnswer =
  | { status: "signed"; key: string; /** base64, 64 bytes */ signature: string }
  | { status: "disagree"; why: string; fields: { field: string; keeper: string; signer: string }[] }
  | { status: "cannot-check"; why: string };

export interface Cosigner { cosign(req: CosignRequest): Promise<CosignAnswer> }

const isHex64 = (s: unknown): s is string => typeof s === "string" && /^[0-9a-f]{64}$/.test(s);
const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const isKey = (s: unknown): s is string => typeof s === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);

/** Shape check of an incoming request (the signer refuses anything else before reading a source). Returns the problem or null. */
export function requestProblem(r: unknown): string | null {
  if (!r || typeof r !== "object") return "the request is not a JSON object";
  const x = r as Record<string, unknown>;
  if (x.v !== 1) return "unknown request version";
  if (x.kind === "reading") {
    if (!isKey(x.mint) || !isKey(x.programId) || !isKey(x.genesis)) return "mint, programId and genesis must be base58 keys";
    if (typeof x.ticker !== "string" || !/^[A-Z0-9]{1,12}$/.test(x.ticker)) return "ticker must be 1-12 capital letters or digits";
    if (typeof x.feedId !== "string" || !x.feedId || x.feedId.length > 32) return "feedId must be 1-32 characters";
    if (!isDate(x.recordDate) || !(x.prevDate === null || isDate(x.prevDate))) return "recordDate must be YYYY-MM-DD and prevDate YYYY-MM-DD or null";
    if (typeof x.value !== "string" || !/^\d{1,30}$/.test(x.value)) return "value must be a whole number in a string";
    if (!Array.isArray(x.eventIds) || x.eventIds.length > 500 || x.eventIds.some((e) => typeof e !== "string")) return "eventIds must be a list of strings";
    if (typeof x.sourceUrl !== "string" || x.sourceUrl.length > 8_000) return "sourceUrl must be a string";
    if (!isHex64(x.proofHash)) return "proofHash must be 64 lowercase hex characters";
    if (typeof x.message !== "string" || x.message.length > 2_000) return "message must be a string";
    return null;
  }
  if (x.kind === "pair") {
    if (!isKey(x.mintA) || !isKey(x.mintB) || !isKey(x.programId) || !isKey(x.genesis)) return "mintA, mintB, programId and genesis must be base58 keys";
    if (!isDate(x.recordDate) || !(x.winner === null || isKey(x.winner))) return "recordDate must be YYYY-MM-DD and winner a mint or null";
    if (typeof x.sourceUrl !== "string" || !isHex64(x.proofHash) || typeof x.message !== "string") return "sourceUrl, proofHash and message are required";
    return null;
  }
  return "kind must be reading or pair";
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Keeper side
// ---------------------------------------------------------------------------------------------------------------------------------

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/**
 * The keeper's client for the signer host: POST <url>/v1/cosign. A network failure, a timeout or a malformed answer is "cannot-check"
 * (the reading waits when the quorum needs the signer). The bearer token only keeps strangers from making the signer read sources; the
 * signer signs nothing it did not compute itself, whoever asks.
 */
export function httpCosigner(o: { url: string; token?: string | null; timeoutMs?: number; fetchImpl?: FetchLike }): Cosigner {
  const base = o.url.replace(/\/+$/, "");
  const f = o.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  return {
    async cosign(req) {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), o.timeoutMs ?? 30_000);
      try {
        const headers: Record<string, string> = { "content-type": "application/json" };
        if (o.token) headers.authorization = `Bearer ${o.token}`;
        const res = await f(`${base}/v1/cosign`, { method: "POST", headers, body: JSON.stringify(req), signal: ac.signal });
        const j = (await res.json().catch(() => null)) as CosignAnswer | null;
        if (j && (j.status === "signed" || j.status === "disagree" || j.status === "cannot-check")) return j;
        return { status: "cannot-check", why: `the second signer answered HTTP ${res.status} without a decision` };
      } catch (e) {
        return { status: "cannot-check", why: `the second signer could not be reached (${((e as Error).message || "error").slice(0, 80)})` };
      } finally { clearTimeout(t); }
    },
  };
}

/**
 * The keeper's cosigner from its environment (names only): BURNTICKER_COSIGNER_URL (https://, or http:// on a loopback or tailnet
 * 100.x address) and BURNTICKER_COSIGNER_TOKEN. Unset URL = no cosigner (the keeper behaves exactly as before).
 */
export function cosignerFromEnv(env: Readonly<Record<string, string | undefined>>, fetchImpl?: FetchLike): Cosigner | null {
  const url = env.BURNTICKER_COSIGNER_URL?.trim();
  if (!url) return null;
  if (!/^https:\/\//.test(url) && !/^http:\/\/(127\.0\.0\.1|localhost|100\.\d+\.\d+\.\d+)(:\d+)?(\/|$)/.test(url)) throw new Error("BURNTICKER_COSIGNER_URL must be https:// (or http:// on a loopback or tailnet address)");
  return httpCosigner({ url, token: env.BURNTICKER_COSIGNER_TOKEN?.trim() || null, ...(fetchImpl ? { fetchImpl } : {}) });
}

export type CosignOutcome =
  | { kind: "signed"; cosignature: Cosignature; listed: boolean }
  | { kind: "disagree"; why: string }
  | { kind: "cannot-check"; why: string };

/**
 * The keeper's reading of an answer: a "signed" answer is checked over the keeper's own message bytes (a signature that does not verify is
 * treated as a disagreement: the signer is broken or answering another message) and marked `listed` when the TokenConfig holds the key.
 */
export function checkCosignature(answer: CosignAnswer, message: string, listedKeys: readonly string[]): CosignOutcome {
  if (answer.status === "cannot-check") return { kind: "cannot-check", why: answer.why };
  if (answer.status === "disagree") {
    const f = answer.fields.map((x) => `${x.field}: the keeper has ${x.keeper}, the second signer has ${x.signer}`).join("; ");
    return { kind: "disagree", why: `${answer.why}${f ? ` (${f})` : ""}` };
  }
  let sig: Buffer;
  try { sig = Buffer.from(answer.signature, "base64"); new PublicKey(answer.key); } catch { return { kind: "disagree", why: "the second signer answered with a malformed key or signature" }; }
  if (sig.length !== 64 || !verifyAttestation(new PublicKey(answer.key), Buffer.from(message, "utf8"), sig)) return { kind: "disagree", why: `the second signer's signature (${answer.key.slice(0, 8)}…) does not verify over the keeper's message` };
  return { kind: "signed", cosignature: { key: answer.key, signature: new Uint8Array(sig) }, listed: listedKeys.includes(answer.key) };
}

/**
 * The keeper's one call per reading (both keepers: multiKeeper for unit counters, programChain for $DEFICIT): ask the second signer to
 * co-sign the exact message the port will submit. `cosignatures` holds only a key the TokenConfig lists; `disagree` is the reason to hold
 * (the caller raises the alert and sends nothing); `note` says why there is no usable signature (the caller waits only when the quorum
 * needs one). No cosigner: nothing happens, and the keeper behaves exactly as before.
 */
export async function askCosigner(cosigner: Cosigner | null | undefined, port: Pick<ProgramPort, "programId" | "mint" | "readingMessage">, cfg: Pick<ProgramConfigView, "attesters" | "clusterGenesis">, input: ReadingInput, meta: { ticker: string; eventIds: readonly string[] }, log: (s: string) => void = () => {}): Promise<{ cosignatures: Cosignature[]; disagree: string | null; note: string | null }> {
  if (!cosigner) return { cosignatures: [], disagree: null, note: null };
  if (!port.readingMessage || !cfg.clusterGenesis) return { cosignatures: [], disagree: null, note: "This program client cannot show the reading to the second signer." };
  const Ds = formatDate(input.recordDate);
  const message = await port.readingMessage(input);
  const answer = await cosigner.cosign({
    v: 1, kind: "reading", mint: port.mint, ticker: meta.ticker, programId: port.programId, genesis: cfg.clusterGenesis, feedId: input.feedId, recordDate: Ds,
    prevDate: input.prevDate ? formatDate(input.prevDate) : null, value: input.value.toString(), eventIds: [...meta.eventIds], sourceUrl: input.sourceUrl,
    proofHash: input.proofHash ? Buffer.from(input.proofHash).toString("hex") : "0".repeat(64), message,
  });
  const r = checkCosignature(answer, message, cfg.attesters.map((a) => a.key));
  if (r.kind === "disagree") return { cosignatures: [], disagree: r.why, note: null };
  if (r.kind === "cannot-check") { log(`  [cosign] $${meta.ticker} ${Ds}: no second signature (${r.why})`); return { cosignatures: [], disagree: null, note: `The second signer could not check this reading: ${r.why}.` }; }
  if (!r.listed) { log(`  [cosign] $${meta.ticker} ${Ds}: the second signer agrees (its key ${r.cosignature.key.slice(0, 8)}… is not an attester of this coin yet)`); return { cosignatures: [], disagree: null, note: null }; }
  log(`  [cosign] $${meta.ticker} ${Ds}: the second signer agrees and co-signed (${r.cosignature.key.slice(0, 8)}…)`);
  return { cosignatures: [r.cosignature], disagree: null, note: null };
}
