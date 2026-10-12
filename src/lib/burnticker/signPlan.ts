import { Buffer } from "buffer";
import { AddressLookupTableAccount, Keypair, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import type { PairCurveLaunchBundle } from "@/lib/burnticker/pairCurveLaunch";
import type { SerializedIx } from "@/lib/burnticker/program";

/**
 * ONE SIGNING PLAN FOR EVERY LAUNCH (2026-10-11, the public-launch blocker: a single LaunchLab coin ended at an unsigned bundle card).
 * Every launch the page or the Coin vs Coin tile builds — one LaunchLab coin, two LaunchLab coins (a matchup, a pair with the pair curve
 * off) or a pair-curve set — becomes the same plan, and SignCard.tsx signs it, so the single-coin and the pair behaviour cannot drift:
 *
 *   steps      the transactions in order, each naming its signers ("creator" = the wallet; any other name = a key the server handed
 *              over with the bundle: a LaunchLab bundle's `mintSecretKey`, a pair-curve response's `mintSecretKeys`)
 *   keys       signer name → that key (base58, 64-byte secret), checked against the public key it must be BEFORE anything is signed
 *   confirms   which step's signature confirms which draft with POST /api/burnticker/launch { action: "launched" } — the transaction the
 *              mint itself signed (LaunchLab: initialize_token + create; pair curve: create mint A / create mint B, never init_pair)
 *
 * Rules: a step is built, signed by its keys, then by the wallet, written to storage, sent and confirmed before the next; the first
 * failure stops the run (a half-signed set is never sent) and a second press resumes at the failed step (a confirmed step is never sent
 * twice; a sent step whose confirmation was lost is looked up by its original signature, never blindly rebuilt — review-2 F4). Client-safe.
 */

export interface SignStep { label: string; signers: string[]; instructions: SerializedIx[] }
export interface SignPlan {
  steps: SignStep[];
  keys: Record<string, string | null>;
  /** signer name → the public key its key must have */
  expect: Record<string, string>;
  /** signer name → how the card names it ("mint A key", "the $RAYS26 mint key") */
  labels: Record<string, string>;
  confirms: { mint: string; ticker: string; step: number }[];
  /** why the plan cannot be signed yet (programs not configured on this host, …); [] = ready */
  pending: string[];
  /** the sentence when a key is missing */
  missingKeys: string;
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

/** Why the plan cannot be signed in this browser, or [] when it can. */
export function planProblems(plan: SignPlan, creator: string | null): string[] {
  const out = [...plan.pending];
  if (!creator) out.push("connect the wallet that is the creator");
  const needs = [...new Set(plan.steps.flatMap((s) => s.signers).filter((s) => s !== "creator"))];
  if (needs.some((s) => !plan.keys[s])) out.push(plan.missingKeys);
  for (const s of needs) {
    const k = plan.keys[s];
    if (!k) continue;
    try { if (Keypair.fromSecretKey(base58ToBytes(k)).publicKey.toBase58() !== plan.expect[s]) out.push(`${plan.labels[s] ?? s} does not match mint ${plan.expect[s]}`); } catch { out.push(`${plan.labels[s] ?? s} is not a valid key`); }
  }
  return out;
}

/** The packet limit every transaction must fit (legacy or v0; burnReceipts/constants.ts PACKET_DATA_SIZE). */
export const PACKET_LIMIT = 1_232;
/** The base fee per signature (no step carries a priority-fee instruction, so this is each landed step's whole network fee). */
export const LAMPORTS_PER_SIGNATURE = 5_000;

/**
 * One step, built and signed by the key(s) it names (the wallet signs after). A VERSION-0 transaction (re-check 2026-10-11: a real single
 * coin is 1,262 bytes as a legacy transaction, over the 1,232-byte limit): the fixed accounts are loaded from `lookupTable` — the
 * network's table, verified by lookupTable.ts verifiedLookupTable before this is called; null compiles without one (tests).
 */
export function buildStepTx(step: SignStep, creator: string, keys: Record<string, string | null | undefined>, recentBlockhash: string, lookupTable: AddressLookupTableAccount | null = null): VersionedTransaction {
  const instructions = step.instructions.map((ix) => new TransactionInstruction({ programId: new PublicKey(ix.programId), keys: ix.keys.map((k) => ({ pubkey: new PublicKey(k.pubkey), isSigner: k.isSigner, isWritable: k.isWritable })), data: Buffer.from(ix.dataBase64, "base64") }));
  const signers = step.signers.filter((s) => s !== "creator").map((s) => {
    const k = keys[s];
    if (!k) throw new Error(`${step.label} needs the ${s} key`);
    return Keypair.fromSecretKey(base58ToBytes(k));
  });
  let tx: VersionedTransaction;
  try { tx = new VersionedTransaction(new TransactionMessage({ payerKey: new PublicKey(creator), recentBlockhash, instructions }).compileToV0Message(lookupTable ? [lookupTable] : [])); } catch (e) {
    throw new Error(`${step.label}: the transaction does not fit the ${PACKET_LIMIT.toLocaleString("en-US")}-byte limit (${String((e as Error)?.message ?? e).slice(0, 80)})`);
  }
  const size = wireSize(tx);
  if (size > PACKET_LIMIT) throw new Error(`${step.label}: the transaction is ${size} bytes, over the ${PACKET_LIMIT.toLocaleString("en-US")}-byte limit`);
  if (signers.length) tx.sign(signers);
  return tx;
}

/** The signed wire size (signatures are fixed-width, so an unsigned transaction measures the same). */
export function wireSize(tx: VersionedTransaction): number { return tx.serialize().length; }
/** True once the signature slot of the first signer (the fee payer) holds a signature. */
const hasSignature = (s: Uint8Array | undefined): s is Uint8Array => !!s && s.some((b) => b !== 0);

// ---- sending, with every signed transaction persisted before it is sent (review-2 F4) -----------------------------------------
//
// sendRaw can land a create while confirm throws (an RPC timeout). The create is not idempotent — a rebuilt transaction with a fresh
// blockhash fails because its accounts already exist — so the signed transaction's identity is written to storage BEFORE it is sent,
// and an ambiguous confirmation is settled against the ORIGINAL signature: confirmed → adopted; failed on chain → rebuilt; absent →
// rebuilt only once the blockhash is proven expired (block height past lastValidBlockHeight, read before the status); otherwise the step
// stays "sent" (outcome unknown) and nothing new is built. A resumed run (a second press, or a reload of the same plan) settles any
// stored pending send the same way before it builds anything.

/**
 * "confirmed" on chain · "sent" (outcome unknown; pending reconcile) · "failed" (did not take effect: rejected on chain or expired unsent;
 * rebuildable) · "not-sent" · "abandoned" (F4 residual: the mint key this step needs is gone — keys are never stored — so after a reload
 * the step cannot be rebuilt; the only safe action is a new plan)
 */
export type StepState = "confirmed" | "sent" | "failed" | "not-sent" | "abandoned";

/** A signed step written to storage before sendRaw: enough to look up (and recognise) the exact transaction later. */
export interface PendingSend {
  step: number;
  /** the transaction's first signature (the fee payer's), base58 — the id the chain knows it by */
  signature: string;
  /** the signed transaction, serialized, base64 */
  tx: string;
  blockhash: string;
  lastValidBlockHeight: number;
  /** ms since the epoch */
  sentAt: number;
}

/** What is stored per plan (JSON under planStorageKey). */
export interface PlanRecord {
  v: 1;
  /** the drafts this plan launches (plan.confirms mints) */
  mints: string[];
  /** confirmed signatures, by step, contiguous from step 0 */
  confirmed: string[];
  /** mints the launch route has recorded as launched */
  recorded: string[];
  /** the step sent and not yet settled, or null */
  pending: PendingSend | null;
  /** the last step that did not take effect (rejected on chain, or expired unlanded), or null */
  failed: { step: number; signature: string } | null;
  updatedAt: number;
  /** which step confirms which draft, and how many steps the plan has: enough for a page that no longer holds the plan (after a reload) to reconcile and record */
  confirms?: { mint: string; ticker: string; step: number }[];
  steps?: number;
  /** signatures each step carries (its signer count): a landed step's network fee is this × LAMPORTS_PER_SIGNATURE */
  stepSigners?: number[];
  /** the network fees already paid: every step that landed (confirmed, or rejected on chain — a rejected transaction still pays) */
  paid?: { step: number; signature: string; lamports: number }[];
}

/** A string store (sessionStorage in the browser). */
export interface PlanStorage { get(key: string): string | null; set(key: string, value: string): void; remove(key: string): void; /** every key held (the reload recovery lists stored launches) */ keys?(): string[] }

export const PLAN_STORAGE_PREFIX = "burnticker.signplan.";
/** One key per plan: the drafts' mints in plan order ("burnticker.signplan.<mintA>+<mintB>"). */
export function planStorageKey(plan: SignPlan): string {
  const ids = plan.confirms.length ? plan.confirms.map((c) => c.mint) : Object.values(plan.expect);
  return PLAN_STORAGE_PREFIX + (ids.length ? ids.join("+") : plan.steps.map((s) => s.label).join("|"));
}

/** An in-memory store (tests; the browser fallback when sessionStorage is unavailable). */
export function memoryPlanStorage(): PlanStorage {
  const m = new Map<string, string>();
  return { get: (k) => m.get(k) ?? null, set: (k, v) => { m.set(k, v); }, remove: (k) => { m.delete(k); }, keys: () => [...m.keys()] };
}

/** window.sessionStorage, every access in try/catch; falls back to memory (private mode, no window) so a run never throws on storage. */
export function browserPlanStorage(): PlanStorage {
  const mem = memoryPlanStorage();
  const ss = (): Storage | null => { try { return typeof window !== "undefined" && window.sessionStorage ? window.sessionStorage : null; } catch { return null; } };
  return {
    get: (k) => { try { const s = ss(); if (s) { const v = s.getItem(k); if (v !== null) return v; } } catch { /* fall through */ } return mem.get(k); },
    set: (k, v) => { mem.set(k, v); try { ss()?.setItem(k, v); } catch { /* memory only */ } },
    remove: (k) => { mem.remove(k); try { ss()?.removeItem(k); } catch { /* ignore */ } },
    keys: () => { const out = new Set(mem.keys!()); try { const s = ss(); if (s) for (let i = 0; i < s.length; i++) { const k = s.key(i); if (k) out.add(k); } } catch { /* memory only */ } return [...out]; },
  };
}

const isPending = (p: unknown): p is PendingSend => {
  const x = p as PendingSend | null;
  return !!x && Number.isInteger(x.step) && typeof x.signature === "string" && typeof x.tx === "string" && typeof x.blockhash === "string" && Number.isFinite(x.lastValidBlockHeight) && Number.isFinite(x.sentAt);
};
/** The stored record for this plan, or null (none, unreadable, or for other drafts). */
export function loadPlanRecord(storage: PlanStorage | null | undefined, plan: SignPlan): PlanRecord | null {
  if (!storage) return null;
  let j: Partial<PlanRecord> | null;
  try { j = JSON.parse(storage.get(planStorageKey(plan)) ?? "null") as Partial<PlanRecord> | null; } catch { return null; }
  if (!j || j.v !== 1 || !Array.isArray(j.confirmed) || !j.confirmed.every((s) => typeof s === "string")) return null;
  const mints = plan.confirms.map((c) => c.mint);
  if (Array.isArray(j.mints) && j.mints.join("+") !== mints.join("+")) return null;
  return {
    v: 1, mints, confirmed: j.confirmed.slice(0, plan.steps.length), recorded: Array.isArray(j.recorded) ? j.recorded.filter((m) => typeof m === "string") : [],
    pending: isPending(j.pending) ? j.pending : null,
    failed: j.failed && Number.isInteger(j.failed.step) && typeof j.failed.signature === "string" ? j.failed : null,
    updatedAt: Number(j.updatedAt) || 0, paid: paidOf(j.paid),
  };
}
const paidOf = (p: unknown): { step: number; signature: string; lamports: number }[] => (Array.isArray(p) ? p.filter((x) => x && Number.isInteger(x.step) && typeof x.signature === "string" && Number.isFinite(x.lamports)) : []);
/** Adds a landed step's network fee to the record (once per signature). */
function notePaid(rec: { paid?: { step: number; signature: string; lamports: number }[]; stepSigners?: number[] }, step: number, signature: string, signers: number): void {
  const paid = rec.paid ?? (rec.paid = []);
  if (!paid.some((x) => x.signature === signature)) paid.push({ step, signature, lamports: LAMPORTS_PER_SIGNATURE * Math.max(1, signers) });
}
export function savePlanRecord(storage: PlanStorage | null | undefined, plan: SignPlan, rec: PlanRecord): void {
  if (!storage) return;
  try { storage.set(planStorageKey(plan), JSON.stringify({ ...rec, v: 1, updatedAt: Date.now(), confirms: plan.confirms, steps: plan.steps.length, stepSigners: plan.steps.map((st) => st.signers.length), paid: rec.paid ?? [] })); } catch { /* storage full or gone: the run goes on */ }
}
const emptyRecord = (plan: SignPlan): PlanRecord => ({ v: 1, mints: plan.confirms.map((c) => c.mint), confirmed: [], recorded: [], pending: null, failed: null, updatedAt: 0, paid: [] });
/** Marks drafts recorded as launched (the card, after confirmPlan); the whole record goes once every draft is recorded. */
export function markRecorded(storage: PlanStorage | null | undefined, plan: SignPlan, recorded: string[]): void {
  if (!storage) return;
  if (plan.confirms.length && plan.confirms.every((c) => recorded.includes(c.mint))) { try { storage.remove(planStorageKey(plan)); } catch { /* ignore */ } return; }
  const rec = loadPlanRecord(storage, plan) ?? emptyRecord(plan);
  savePlanRecord(storage, plan, { ...rec, recorded: [...new Set(recorded)] });
}

/** What getSignatureStatuses reports for one signature (null = the chain does not know it). */
export interface ChainStatus { err: unknown; confirmationStatus?: string | null }
export type Reconciled = "confirmed" | "failed" | "expired" | "unknown";
/**
 * Settles a sent transaction, purely: a confirmed/finalized status → "confirmed" (or "failed" if it carries an error); a status the chain
 * holds only as "processed" → "unknown"; no status (null) AND a block height past lastValidBlockHeight → "expired" (it can no longer
 * land); anything else — no block height, the status query failed (undefined), still within its blockhash — → "unknown".
 * The caller reads the block height BEFORE the status, so an absence seen after the height passed is a proof.
 */
export function reconcilePending(p: { lastValidBlockHeight: number }, status: ChainStatus | null | undefined, blockHeight: number | null): Reconciled {
  if (status) {
    if (status.confirmationStatus !== "confirmed" && status.confirmationStatus !== "finalized") return "unknown";
    return status.err ? "failed" : "confirmed";
  }
  if (status === null && blockHeight !== null && Number.isFinite(blockHeight) && blockHeight > p.lastValidBlockHeight) return "expired";
  return "unknown";
}

export interface SendDeps {
  latestBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: number }>;
  signTransaction(tx: VersionedTransaction): Promise<VersionedTransaction>;
  /**
   * The network's lookup table, VERIFIED (lookupTable.ts verifiedLookupTable: the pinned address, every entry at its index, authority the
   * operations key or frozen) — it throws "lookup table mismatch — nothing was sent" otherwise, and the run stops before anything is
   * signed. Read once per run. null = no table (tests; a real launch then fails the size check before the wallet sees it).
   */
  lookupTable(): Promise<AddressLookupTableAccount | null>;
  sendRaw(raw: Uint8Array): Promise<string>;
  confirm(sig: string, bh: { blockhash: string; lastValidBlockHeight: number }): Promise<{ err: unknown }>;
  /** one signature's status (Connection.getSignatureStatuses([sig], { searchTransactionHistory: true }).value[0]); absent → a lost confirmation stays "sent" */
  getSignatureStatus?(sig: string): Promise<ChainStatus | null>;
  /** the current block height (Connection.getBlockHeight); absent → expiry is never proven, so nothing sent is ever rebuilt */
  getBlockHeight?(): Promise<number>;
  /** where each signed transaction is written before it is sent (browserPlanStorage in the card) */
  storage?: PlanStorage | null;
}
/** `state` / `signature` describe the step at `failedAt` and are present only when a run stops. */
export interface SendResult { signatures: string[]; failedAt: number | null; error: string | null; state?: Exclude<StepState, "confirmed">; signature?: string }

/** Reads the block height, THEN the status (the order makes an absence past lastValidBlockHeight a proof), then reconciles. */
export async function checkPending(p: PendingSend, d: Pick<SendDeps, "getSignatureStatus" | "getBlockHeight">): Promise<Reconciled> {
  let height: number | null = null, status: ChainStatus | null | undefined = undefined;
  if (d.getBlockHeight) { try { height = await d.getBlockHeight(); } catch { height = null; } }
  if (d.getSignatureStatus) { try { status = await d.getSignatureStatus(p.signature); } catch { status = undefined; } }
  return reconcilePending(p, status, height);
}

/** bytes → base58 (a transaction signature). */
export function bytesToBase58(b: Uint8Array): string {
  const digits: number[] = [];
  for (const byte of b) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) { carry += digits[i] * 256; digits[i] = carry % 58; carry = Math.floor(carry / 58); }
    while (carry > 0) { digits.push(carry % 58); carry = Math.floor(carry / 58); }
  }
  let out = "";
  for (const x of b) { if (x !== 0) break; out += "1"; }
  for (let i = digits.length - 1; i >= 0; i--) out += B58[digits[i]];
  return out;
}

const sentSentence = (i: number, n: number, sig: string) => `Step ${i + 1} of ${n} was sent, but the confirmation could not be read (signature ${sig})`;
const chainRejected = (i: number, n: number, err: unknown) => `Step ${i + 1} of ${n} failed because the chain rejected it (${(typeof err === "string" ? err : JSON.stringify(err ?? "error")).slice(0, 120)})`;
const expiredSentence = (i: number, n: number, sig: string) => `Step ${i + 1} of ${n} failed because transaction ${sig} did not land before its blockhash expired. Nothing it would have created exists`;
/** A send error that proves the transaction never left the RPC node (preflight / blockhash refused); anything else may have landed. */
const SEND_REFUSED = /simulation failed|preflight|blockhash not found|insufficient funds/i;

/**
 * The steps in order; stops at the first failure; `prior` (confirmed signatures) and the stored record resume at the failed step.
 * Before a step is built, a stored pending send for it is settled (adopt / rebuild / stay "sent"); a step that cannot be settled stops
 * the run with state "sent" and its signature — nothing new is built while the original can still land.
 */
export async function signAndSendPlan(plan: SignPlan, creator: string, d: SendDeps, onStep?: (i: number, sig: string) => void, prior: string[] = []): Promise<SendResult> {
  const n = plan.steps.length, store = d.storage ?? null;
  const rec = loadPlanRecord(store, plan) ?? emptyRecord(plan);
  const signatures: string[] = (rec.confirmed.length > prior.length ? rec.confirmed : prior).slice(0, n);
  rec.confirmed = signatures;
  const save = () => savePlanRecord(store, plan, rec);
  const stop = (i: number, state: Exclude<StepState, "confirmed">, error: string, signature?: string): SendResult => ({ signatures: [...signatures], failedAt: i, error, state, ...(signature ? { signature } : {}) });
  const signersAt = (i: number) => plan.steps[i]?.signers.length ?? 1;
  const adopt = (i: number, sig: string) => { signatures.push(sig); notePaid(rec, i, sig, signersAt(i)); rec.pending = null; rec.failed = null; save(); onStep?.(i, sig); };
  /** settles a pending send against the chain: adopted when confirmed; cleared (rebuildable) when it failed or expired unlanded */
  const settle = async (p: PendingSend): Promise<Reconciled> => {
    const r = await checkPending(p, d);
    if (r === "confirmed") adopt(p.step, p.signature);
    else if (r !== "unknown") { if (r === "failed") notePaid(rec, p.step, p.signature, signersAt(p.step)); rec.pending = null; rec.failed = { step: p.step, signature: p.signature }; save(); }
    return r;
  };
  /** the run stops on an unsettled step ("sent") or one that did not take effect ("failed"); null = adopted, carry on */
  const settledStop = (p: PendingSend, r: Reconciled): SendResult | null =>
    r === "confirmed" ? null : r === "unknown" ? stop(p.step, "sent", sentSentence(p.step, n, p.signature), p.signature) : stop(p.step, "failed", r === "failed" ? chainRejected(p.step, n, `transaction ${p.signature}`) : expiredSentence(p.step, n, p.signature), p.signature);

  // a resumed run settles the stored pending send before anything is built: adopted → next step; failed / expired → rebuilt below
  if (rec.pending && rec.pending.step !== signatures.length) { rec.pending = null; save(); }
  if (rec.pending) {
    const p = rec.pending;
    if ((await settle(p)) === "unknown") return settledStop(p, "unknown")!;
  } else save();

  // F4 residual: a plan that has already put something on chain (a confirmed step, or a step that landed and failed) but no longer holds
  // the mint key a remaining step needs (a reload; keys are never stored) is ABANDONED — no step is built, nothing reaches the wallet, so
  // no second create can be attempted; the card offers only a new plan.
  if (signatures.length < n && planAbandoned(plan, rec)) return stop(signatures.length, "abandoned", abandonedSentence({ ...rec, confirms: plan.confirms, steps: n }));

  // the network's lookup table, verified once before anything is signed (a mismatch stops the run: nothing was sent)
  let lut: AddressLookupTableAccount | null = null;
  if (signatures.length < n) {
    try { lut = await d.lookupTable(); } catch (e) { return stop(signatures.length, "not-sent", `Step ${signatures.length + 1} of ${n} failed. The error was: ${String((e as Error)?.message ?? e).slice(0, 240)}`); }
  }

  for (let i = signatures.length; i < n; i++) {
    let bh: { blockhash: string; lastValidBlockHeight: number }, raw: Uint8Array, pending: PendingSend;
    try {
      bh = await d.latestBlockhash();
      const signed = await d.signTransaction(buildStepTx(plan.steps[i], creator, plan.keys, bh.blockhash, lut));
      raw = signed.serialize();
      if (raw.length > PACKET_LIMIT) throw new Error(`the signed transaction is ${raw.length} bytes, over the ${PACKET_LIMIT.toLocaleString("en-US")}-byte limit`);
      const first = signed.signatures[0];
      if (!hasSignature(first)) throw new Error("the wallet returned the transaction without its signature");
      pending = { step: i, signature: bytesToBase58(first), tx: Buffer.from(raw).toString("base64"), blockhash: bh.blockhash, lastValidBlockHeight: bh.lastValidBlockHeight, sentAt: Date.now() };
      rec.pending = pending; rec.failed = null; save(); // written BEFORE the send
    } catch (e) {
      const m = (e as Error).message ?? String(e);
      return stop(i, "not-sent", /reject|denied|cancel/i.test(m) ? `Step ${i + 1} of ${n} was not signed in the wallet` : `Step ${i + 1} of ${n} failed. The error was: ${m.slice(0, 200)}`);
    }
    let sig: string;
    try {
      sig = await d.sendRaw(raw);
      if (sig && sig !== pending.signature) { pending.signature = sig; save(); }
    } catch (e) {
      const m = (e as Error).message ?? String(e);
      if (SEND_REFUSED.test(m)) { rec.pending = null; save(); return stop(i, "not-sent", `Step ${i + 1} of ${n} failed. The error was: ${m.slice(0, 200)}`); }
      const r = settledStop(pending, await settle(pending)); // the node may have forwarded it: settle against the original
      if (r) return r;
      continue;
    }
    let c: { err: unknown };
    try { c = await d.confirm(sig, bh); } catch {
      const r = settledStop(pending, await settle(pending)); // lost confirmation: never drop the signature
      if (r) return r;
      continue;
    }
    if (c.err) { notePaid(rec, i, sig, signersAt(i)); rec.pending = null; rec.failed = { step: i, signature: sig }; save(); return stop(i, "failed", chainRejected(i, n, c.err), sig); }
    adopt(i, sig);
  }
  return { signatures, failedAt: null, error: null };
}

/** Each step's state for the card: confirmed up to the signatures, the stopped step's state, not sent after it ("abandoned" carries on to every later step). */
export function planStepStates(n: number, signatures: string[], failure: { failedAt: number | null; state?: StepState } | null): StepState[] {
  return Array.from({ length: n }, (_, i) => (signatures[i] ? "confirmed" : failure && failure.state === "abandoned" && failure.failedAt !== null && i >= failure.failedAt ? "abandoned" : failure && failure.failedAt === i && failure.state ? failure.state : "not-sent"));
}

/** The per-step line the card shows next to a step. */
export function stepStatusText(state: StepState, signature?: string | null): string {
  const short = signature ? `${signature.slice(0, 10)}…` : "";
  if (state === "confirmed") return `confirmed ${short}`.trim();
  if (state === "sent") return `sent, but the confirmation could not be read (signature ${signature ?? "unknown"})`;
  if (state === "failed") return signature ? `did not take effect (signature ${short})` : "did not take effect";
  if (state === "abandoned") return "abandoned because the mint key was lost on reload";
  return "not sent";
}

// ---- the F4 residual: a plan that cannot continue after a reload ------------------------------------------------------------------

/** SOL from lamports, without trailing zeros ("0.00001"). */
const solText = (lamports: number) => (lamports / 1e9).toFixed(9).replace(/0+$/, "").replace(/\.$/, "");
/** The network fees a record says were paid (every landed step, confirmed or rejected on chain). */
export const feesPaidLamports = (rec: Pick<PlanRecord, "paid">): number => (rec.paid ?? []).reduce((a, x) => a + x.lamports, 0);

/**
 * True when the plan has already put something on chain (a confirmed step, or one that landed and was rejected) and a remaining step needs
 * a mint key this page does not hold (after a reload: keys are never stored). Such a plan is abandoned: nothing is built from it again.
 */
export function planAbandoned(plan: SignPlan, rec: Pick<PlanRecord, "confirmed" | "pending" | "failed" | "paid"> | null): boolean {
  if (!rec || rec.pending) return false;
  const progress = rec.confirmed.length > 0 || !!rec.failed || (rec.paid ?? []).length > 0;
  return progress && plan.steps.slice(rec.confirmed.length).some((st) => st.signers.some((x) => x !== "creator" && !plan.keys[x]));
}

/** Each step of a stored record: confirmed · sent (pending reconcile) · abandoned (no key to rebuild it with). */
export function storedStepStates(rec: Pick<PlanRecord, "confirmed" | "pending"> & { steps: number }): StepState[] {
  return Array.from({ length: rec.steps }, (_, i) => (rec.confirmed[i] ? "confirmed" : rec.pending && rec.pending.step === i ? "sent" : "abandoned"));
}

/** The abandoned plan's sentence: what is confirmed, what is abandoned and why, whether anything is live, the fees already paid, the one safe action. */
export function abandonedSentence(rec: Pick<PlanRecord, "confirmed" | "paid"> & { confirms: { mint: string; ticker: string; step: number }[]; steps: number }, lead?: string): string {
  const n = rec.steps, c = Math.min(rec.confirmed.length, n), names = rec.confirms.map((x) => `$${x.ticker}`).join(" and ") || "this launch";
  const which = n - c === 1 ? `step ${c + 1} of ${n} is` : `steps ${c + 1}–${n} of ${n} are`;
  const creates = rec.confirms.length > 0 && rec.confirms.every((x) => rec.confirmed[x.step]);
  return `${lead ?? `For ${names}, ${c} of the ${n} steps ${c === 1 ? "is" : "are"} confirmed on chain.`} ${which[0].toUpperCase()}${which.slice(1)} abandoned because the mint key was lost on reload. The key is never stored, so this plan cannot be rebuilt here. ${creates ? "Its create steps are confirmed, but the launch is not recorded from this plan." : "Nothing from this plan is live until the create step confirms."} The fee already spent is ${solText(feesPaidLamports(rec))} SOL. The only safe thing to do is to start the launch again from the review, as a new plan.`;
}

/** The card's sentence on mount when storage holds a sent step whose outcome is not known yet (after a reload). */
export function sentRecoverySentence(p: Pick<PendingSend, "step" | "signature">, n: number, confirmedBefore: string[] = []): string {
  return failureSentence({ signatures: confirmedBefore.slice(0, p.step), failedAt: p.step, error: sentSentence(p.step, n, p.signature), state: "sent", signature: p.signature }, n);
}

/** The card's sentence for a run that stopped. "Nothing was sent." only when no step was confirmed or sent. */
export function failureSentence(r: SendResult, n: number): string {
  const before = r.signatures.length > 0;
  if (r.state === "abandoned") return r.error ?? "This plan is abandoned. The only safe thing to do is to start the launch again from the review, as a new plan.";
  if (r.state === "sent") return `${r.error}. Pressing the button again checks that transaction on chain first. A new one is built only once the old one can no longer land.${before ? " The steps before it are confirmed on chain." : ""}`;
  if (r.state === "failed") return `${r.error}. ${before ? "The steps before it are confirmed on chain. " : ""}Pressing the button again builds step ${(r.failedAt ?? 0) + 1} of ${n} afresh.`;
  return `${r.error}. ${before ? "The steps before it are confirmed on chain. Pressing the button again continues from the failed step." : "Nothing was sent."}`;
}

/** Which signature confirms which draft. */
export const planConfirmations = (plan: SignPlan, sigs: string[]): { mint: string; launchTx: string }[] =>
  plan.confirms.every((c) => sigs[c.step]) ? plan.confirms.map((c) => ({ mint: c.mint, launchTx: sigs[c.step] })) : [];

export interface LaunchErrorBody { error?: string; code?: string; retryAfterSec?: number }
type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; headers: { get(name: string): string | null }; json(): Promise<unknown> }>;
/** `transport` is set when the launch route could not be reached at all (the chain progress is untouched). */
export interface ConfirmResult { confirmed: string[]; error: string | null; transport?: boolean }

/**
 * Confirms each draft with the launch route, in plan order. A 404 (not visible to the server yet) is retried `retries` times, `waitMs`
 * apart; any other failure stops with the sentence `message` gives; a transport failure (fetch throws) stops with a plain sentence and
 * `transport: true`, keeping what was recorded. Mints in `already` are skipped.
 */
export async function confirmPlan(fetchFn: FetchLike, plan: SignPlan, sigs: string[], message: (status: number, body: LaunchErrorBody | null, retryAfter: string | null) => string, o: { already?: string[]; retries?: number; waitMs?: number; sleep?: (ms: number) => Promise<void>; url?: string } = {}): Promise<ConfirmResult> {
  const confirmed = [...(o.already ?? [])];
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (const l of planConfirmations(plan, sigs)) {
    if (confirmed.includes(l.mint)) continue;
    for (let attempt = 0; ; attempt++) {
      let r: Awaited<ReturnType<FetchLike>>;
      try {
        r = await fetchFn(o.url ?? "/api/burnticker/launch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "launched", mint: l.mint, launchTx: l.launchTx }) });
      } catch (e) {
        return { confirmed, error: `The launch could not be recorded: the server did not answer (${String((e as Error).message ?? e).slice(0, 80)}). Press the button again to record it.`, transport: true };
      }
      if (r.ok) { confirmed.push(l.mint); break; }
      const j = (await r.json().catch(() => null)) as LaunchErrorBody | null;
      if (r.status === 404 && attempt < (o.retries ?? 5)) { await sleep(o.waitMs ?? 4000); continue; }
      return { confirmed, error: message(r.status, j, r.headers.get("retry-after")) };
    }
  }
  return { confirmed, error: null };
}

/**
 * The "launched" failure sentence for the card: a 5xx (other than "this site cannot confirm launches") says the record failed — never
 * "Nothing was sent", because by then the transactions are on chain; everything else is `base`'s sentence.
 */
export function recordFailureSentence(status: number, body: LaunchErrorBody | null, retryAfter: string | null, base: (status: number, body: LaunchErrorBody | null, retryAfter: string | null) => string): string {
  if (status >= 500 && body?.code !== "launch-unverifiable") return `The server could not record the launch right now (HTTP ${status}). Press the button again to record it.`;
  return base(status, body, retryAfter);
}

// ---- the plans ----------------------------------------------------------------------------------------------------------------

/** What the page and the tile hold of a LaunchLab bundle (launchBundle.ts LaunchBundle). */
export interface LaunchlabBundleLike { mint: string; ticker: string; ready: boolean; pending: string[]; mintSecretKey: string | null; transactions: { label: string; signers: string[]; instructions: SerializedIx[] }[] }

/**
 * One or more LaunchLab bundles → one plan, in the order given (a pair: A then B — B's rule names A's mint). Each bundle's "mint" signer
 * becomes its own key; its confirming step is its first transaction the mint signs (initialize_token + LaunchLab create).
 */
export function launchlabPlan(bundles: readonly LaunchlabBundleLike[]): SignPlan {
  const plan: SignPlan = { steps: [], keys: {}, expect: {}, labels: {}, confirms: [], pending: [], missingKeys: bundles.length > 1 ? "the server did not hand over the mint keys, so the create transactions cannot be signed here" : "the server did not hand over the mint key, so the create transaction cannot be signed here" };
  bundles.forEach((b, i) => {
    const name = bundles.length > 1 ? `mint${i}` : "mint";
    plan.keys[name] = b.mintSecretKey; plan.expect[name] = b.mint; plan.labels[name] = `the $${b.ticker} mint key`;
    let confirmAt: number | null = null;
    for (const t of b.transactions) {
      const signers = t.signers.map((s) => (s === "mint" ? name : s));
      if (confirmAt === null && signers.includes(name)) confirmAt = plan.steps.length;
      plan.steps.push({ label: bundles.length > 1 ? `$${b.ticker}: ${t.label}` : t.label, signers, instructions: t.instructions });
    }
    if (confirmAt !== null) plan.confirms.push({ mint: b.mint, ticker: b.ticker, step: confirmAt });
    if (!b.ready) plan.pending.push(...b.pending.map((p) => (bundles.length > 1 ? `$${b.ticker}: ${p}` : p)));
  });
  return plan;
}

/** A pair-curve set (3 steps; signers creator / mintA / mintB) → the plan; tx 1 confirms A, tx 2 confirms B (launchVerify, 04c7bc4e). */
export function pairCurvePlan(pc: PairCurveLaunchBundle, keys: { a: string; b: string } | null, tickers: { a: string; b: string } = { a: "A", b: "B" }): SignPlan {
  return {
    steps: pc.transactions.map((t) => ({ label: t.label, signers: [...t.signers], instructions: t.instructions })),
    keys: { mintA: keys?.a ?? null, mintB: keys?.b ?? null },
    expect: { mintA: pc.mints.a, mintB: pc.mints.b },
    labels: { mintA: "mint key A", mintB: "mint key B" },
    confirms: [{ mint: pc.mints.a, ticker: tickers.a, step: 0 }, { mint: pc.mints.b, ticker: tickers.b, step: 1 }],
    pending: pc.ready ? [] : pc.pending.filter((p) => !/^Metaplex metadata/.test(p)),
    missingKeys: "the server did not hand over the two mint keys, so the mint transactions cannot be signed here",
  };
}

// ---- recovery after a reload (review-2 F4) ---------------------------------------------------------------------------------------
// A reload drops the plan (the bundle and its mint keys are never stored), so a fresh launch page cannot resume a half-signed set. What
// it CAN do from storage alone is the part that matters for an ambiguous confirmation: look the sent transaction up on chain, adopt it
// when it landed (no second create), and record the drafts as launched once every step is confirmed. A step that did not take effect
// cannot be rebuilt here (that needs the mint keys): it is ABANDONED (storedStepStates / abandonedSentence: what is confirmed, that nothing
// from the plan is live until the create step confirms, the network fees already paid) and the one safe action is a new plan.

export interface StoredLaunch { key: string; rec: PlanRecord & { confirms: { mint: string; ticker: string; step: number }[]; steps: number } }
/** Every stored launch with something left to do (a sent step to settle, or confirmed steps not recorded yet). */
export function listStoredLaunches(storage: PlanStorage | null | undefined): StoredLaunch[] {
  if (!storage?.keys) return [];
  const out: StoredLaunch[] = [];
  for (const key of storage.keys()) {
    if (!key.startsWith(PLAN_STORAGE_PREFIX)) continue;
    let j: Partial<PlanRecord> | null = null;
    try { j = JSON.parse(storage.get(key) ?? "null") as Partial<PlanRecord> | null; } catch { continue; }
    if (!j || j.v !== 1 || !Array.isArray(j.confirmed) || !Array.isArray(j.confirms) || !Number.isInteger(j.steps)) continue;
    const confirms = j.confirms.filter((c) => c && typeof c.mint === "string" && typeof c.ticker === "string" && Number.isInteger(c.step));
    const rec = { v: 1 as const, mints: confirms.map((c) => c.mint), confirmed: j.confirmed.filter((x) => typeof x === "string"), recorded: Array.isArray(j.recorded) ? j.recorded.filter((m) => typeof m === "string") : [], pending: isPending(j.pending) ? j.pending : null, failed: j.failed && Number.isInteger(j.failed.step) && typeof j.failed.signature === "string" ? j.failed : null, updatedAt: Number(j.updatedAt) || 0, confirms, steps: j.steps as number, paid: paidOf(j.paid), ...(Array.isArray(j.stepSigners) ? { stepSigners: j.stepSigners.filter((x) => Number.isInteger(x)) } : {}) };
    if (rec.pending || confirms.some((c) => !rec.recorded.includes(c.mint))) out.push({ key, rec });
  }
  return out.sort((a, b) => b.rec.updatedAt - a.rec.updatedAt);
}

/** The line a stored launch shows before anything is checked. */
export function storedLaunchSentence(s: StoredLaunch): string {
  const r = s.rec, n = r.steps, names = r.confirms.map((c) => `$${c.ticker}`).join(" and ");
  if (r.pending) return `For ${names}, step ${r.pending.step + 1} of ${n} was ${stepStatusText("sent", r.pending.signature)}.`;
  if (r.confirmed.length >= n) return `For ${names}, ${n === 1 ? "the transaction is" : `all ${n} transactions are`} confirmed on chain. The launch is not recorded yet.`;
  // F4 residual: the mint keys are gone with the reload, so every step not confirmed is abandoned — the sentence says so, with the fees paid
  if (r.failed && r.confirmed.length <= r.failed.step) return abandonedSentence(r, `For ${names}, step ${r.failed.step + 1} of ${n} did not take effect (signature ${r.failed.signature}). ${r.confirmed.length} of the ${n} steps ${r.confirmed.length === 1 ? "is" : "are"} confirmed on chain.`);
  return abandonedSentence(r);
}

/**
 * Settles a stored launch: the sent step is looked up (adopted when it landed; marked failed when it was rejected or provably expired;
 * left as sent otherwise), the record is saved, and once every step is confirmed the drafts are recorded as launched (confirmPlan). A
 * finished record is removed.
 */
export async function recoverStoredLaunch(storage: PlanStorage, s: StoredLaunch, deps: Pick<SendDeps, "getSignatureStatus" | "getBlockHeight">, fetchFn: FetchLike, message: (status: number, body: LaunchErrorBody | null, retryAfter: string | null) => string): Promise<{ text: string; done: boolean; rec: StoredLaunch["rec"] }> {
  const rec = { ...s.rec, confirmed: [...s.rec.confirmed], recorded: [...s.rec.recorded], paid: [...(s.rec.paid ?? [])] };
  const save = () => { try { storage.set(s.key, JSON.stringify({ ...rec, updatedAt: Date.now() })); } catch { /* keep going */ } };
  if (rec.pending) {
    const p = rec.pending, r = await checkPending(p, deps);
    const signers = rec.stepSigners?.[p.step] ?? 1;
    if (r === "confirmed" && p.step === rec.confirmed.length) { rec.confirmed.push(p.signature); notePaid(rec, p.step, p.signature, signers); rec.pending = null; }
    else if (r === "failed" || r === "expired") { if (r === "failed") notePaid(rec, p.step, p.signature, signers); rec.failed = { step: p.step, signature: p.signature }; rec.pending = null; }
    save();
    if (rec.pending) return { text: storedLaunchSentence({ key: s.key, rec }), done: false, rec };
  }
  if (rec.confirmed.length < rec.steps) return { text: storedLaunchSentence({ key: s.key, rec }), done: false, rec };
  const c = await confirmPlan(fetchFn, { confirms: rec.confirms } as unknown as SignPlan, rec.confirmed, message, { already: rec.recorded });
  rec.recorded = c.confirmed;
  const done = rec.confirms.every((x) => rec.recorded.includes(x.mint));
  if (done) { try { storage.remove(s.key); } catch { /* ignore */ } } else save();
  const names = rec.confirms.map((x) => `$${x.ticker}`).join(" and ");
  return { text: done ? `For ${names}, everything is confirmed on chain and recorded. The coin page is live.` : `All ${rec.steps} transaction${rec.steps === 1 ? " is" : "s are"} confirmed on chain. ${c.error ?? ""}`.trim(), done, rec };
}
