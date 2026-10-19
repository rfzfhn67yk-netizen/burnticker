import { Buffer } from "buffer";
import { AddressLookupTableAccount, Keypair, PublicKey, TransactionInstruction, TransactionMessage, VersionedMessage, VersionedTransaction } from "@solana/web3.js";
import type { PairCurveLaunchBundle } from "@/lib/burnticker/pairCurveLaunch";
import { CONFIRM_LANE_BUSY_CODE, CONFIRM_LANE_BUSY_RETRY_SEC } from "@/lib/burnticker/confirmBusy";
import type { SerializedIx } from "@/lib/burnticker/program";
import { PLAN_EXPIRED_SENTENCE, PLAN_SIGNABLE_MS, planExpired } from "@/lib/burnticker/planAge";

// Prelaunch audit 2026-10-18 F06: the plan-age guard, from the shared runner's own module (every signing entry point imports this one)
export { planExpired, PLAN_EXPIRED_SENTENCE, PLAN_SIGNABLE_MS };

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
 * Rules: a step is built, signed by the wallet FIRST and then by its keys (Phantom's dApp review, ticket 438485, 2026-10-14: Lighthouse
 *   flags a transaction that arrives with other signatures already on it; wallet first, then partialSign), written to storage, sent and
 *   confirmed before the next; the first
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
  /**
   * AUDIT A C1 (5): true for a set whose coins go live together or not at all (the pair curve: neither side is live until init_pair).
   * Otherwise (LaunchLab, single or pair) each coin is confirmed the moment its own create step lands, whatever happens after it.
   */
  confirmTogether?: boolean;
  /** re-review 5: the venue, stored with the record so a later reader decides `together` from it */
  venue?: "launchlab" | "pair-curve";
  /**
   * Prelaunch audit 2026-10-18 F06: the moment (this browser's clock, ms) after which no NEW step of this plan may be signed or sent:
   * when the page received the prepared plan, plus the drafts' 24-hour window, less the margin (planAge.ts). A step already sent may
   * still be looked up on chain and recorded after it. Every launch SignCard requires it (PreparedSignPlan); absent = no deadline.
   */
  deadlineAt?: number;
}
/** A launch plan as every SignCard takes it: with its deadline (F06). */
export type PreparedSignPlan = SignPlan & { deadlineAt: number };
/** F06: the plan with its deadline, from when this page received it (`preparedAt`, this browser's clock). */
export const withPlanDeadline = (plan: SignPlan, preparedAt: number): PreparedSignPlan => ({ ...plan, deadlineAt: preparedAt + PLAN_SIGNABLE_MS });
/** F06: whether a plan is past its deadline at `now` (the same test as planAge.planExpired, read from the plan itself). No deadline: false. */
export const planPastDeadline = (plan: Pick<SignPlan, "deadlineAt">, now: number): boolean => typeof plan.deadlineAt === "number" && planExpired(plan.deadlineAt - PLAN_SIGNABLE_MS, now);
/**
 * F06 review fix: whether a coin's create step is confirmed on chain (in `done`) but the coin is not recorded yet (`recorded`). Such a
 * plan is never closed by the deadline: it can still be recorded, and Start over keeps its stored record for the reload notice.
 */
export const planHasUnrecordedCoin = (plan: Pick<SignPlan, "confirms" | "confirmTogether" | "steps">, done: string[], recorded: string[]): boolean => planConfirmations(plan as SignPlan, done).some((l) => !recorded.includes(l.mint));
/** F06: what the card offers once the plan is past its deadline: Start over, unless a step is sent and unread, every step is in, or a landed coin waits to be recorded. */
export const deadlineCardStartsOver = (o: { expired: boolean; stoppedState?: StepState | null; done: number; steps: number; unrecorded: boolean }): boolean => o.expired && o.stoppedState !== "sent" && o.done < o.steps && !o.unrecorded;
/** F06 review fix: the card's button past the deadline when a landed coin is not recorded yet. */
export const RECORD_LANDED_LABEL = "Record the coin that is already on chain";
/** F06: why the runner stopped before a new step at or after the deadline (nothing was signed or sent for it). */
export const planDeadlineSentence = (i: number, n: number): string => `Step ${i + 1} of ${n} was not signed or sent. ${PLAN_EXPIRED_SENTENCE}`;

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
export function buildStepTx(step: SignStep, creator: string, keys: Record<string, string | null | undefined>, recentBlockhash: string, lookupTable: AddressLookupTableAccount | null = null, signKeys = true): VersionedTransaction {
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
  if (signKeys && signers.length) tx.sign(signers);
  return tx;
}

/**
 * Adds the step's own key signatures (the mint keys) to a transaction the wallet has already signed — Phantom's recommended order
 * (wallet first, then partialSign; ticket 438485). The keys are checked against the public keys the plan expects before signing
 * (planProblems), and the wallet's returned message was checked byte for byte (walletReturnProblem) before this is called, so the
 * signatures are made over exactly the bytes this page built.
 */
export function signStepKeys(tx: VersionedTransaction, step: SignStep, keys: Record<string, string | null | undefined>): VersionedTransaction {
  const signers = step.signers.filter((s) => s !== "creator").map((s) => {
    const k = keys[s];
    if (!k) throw new Error(`${step.label} needs the ${s} key`);
    return Keypair.fromSecretKey(base58ToBytes(k));
  });
  if (signers.length) tx.sign(signers);
  return tx;
}

/** One sentence for a failed dry run: the chain's error plus the last program log line that explains it, when there is one. */
export function simulationFailureText(err: unknown, logs?: string[] | null): string {
  const e = typeof err === "string" ? err : JSON.stringify(err);
  const why = (logs ?? []).filter((l) => /Error|failed|insufficient/i.test(l)).at(-1);
  return why ? `${e} (${why.replace(/^Program log: /, "").slice(0, 160)})` : e;
}

/** The signed wire size (signatures are fixed-width, so an unsigned transaction measures the same). */
export function wireSize(tx: VersionedTransaction): number { return tx.serialize().length; }
/** True once the signature slot of the first signer (the fee payer) holds a signature. */
const hasSignature = (s: Uint8Array | undefined): s is Uint8Array => !!s && s.some((b) => b !== 0);
const sameBytes = (a: Uint8Array | undefined, b: Uint8Array | undefined) => !!a && !!b && a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * LAUNCH INTEGRITY 253: what is wrong with the transaction a wallet hands back, or null when it is the one built here plus the wallet's
 * signature. The rule is exact, by design: the wallet may only fill its own signature slot — and, since Phantom's review (2026-10-14),
 * append its own Lighthouse safety-check instructions after ours (appendedGuardProblem). Its message bytes (fee payer, blockhash,
 * signers, accounts, instructions, lookup tables) must equal what it was handed, and every key signature this page had already added
 * (the mint keys; none in the shipped order, where the wallet signs first and the keys sign after) must still be there, byte for byte. A changed message would void those signatures anyway, so no supported wallet can change it and
 * still produce a transaction that lands; a wallet that tries (an added instruction, a different fee payer) is refused before the send.
 * Equal message bytes plus the page's own signature bytes means the mint signatures still verify (they were made over those bytes here).
 * The wallet's own signature is checked only for presence; a bad one is refused by the network, which charges nothing for it.
 */
export function walletReturnProblem(handed: { message: Uint8Array; signatures: Uint8Array[] }, returned: VersionedTransaction, step: SignStep, plan: Pick<SignPlan, "expect" | "labels">, tables: AddressLookupTableAccount[] = []): string | null {
  let got: Uint8Array;
  try { got = returned.message.serialize(); } catch { return "the wallet returned something that is not a transaction"; }
  if (!sameBytes(got, handed.message)) {
    let before: VersionedTransaction["message"];
    try { before = VersionedMessage.deserialize(handed.message); } catch { return "the wallet changed the transaction"; }
    const after = returned.message;
    const keys = (m: VersionedTransaction["message"]) => m.staticAccountKeys.slice(0, m.header.numRequiredSignatures).map((k) => k.toBase58());
    if (before.staticAccountKeys[0]?.toBase58() !== after.staticAccountKeys[0]?.toBase58()) return "the wallet changed who pays the fee";
    if (before.recentBlockhash !== after.recentBlockhash) return "the wallet changed the transaction's blockhash";
    if (keys(before).join(",") !== keys(after).join(",")) return "the wallet changed who signs the transaction";
    // Phantom's dApp review (ticket 438485, 2026-10-14): the wallet signs first and its Lighthouse guard APPENDS assertion instructions.
    // That is the one change accepted: our instructions first, byte for byte (resolved accounts, flags, data), then only extra
    // instructions whose program is Lighthouse or the compute-budget program, adding no signer. Anything else is refused.
    const why = appendedGuardProblem(before, after, tables);
    if (why) return why;
  }
  const n = returned.message.header.numRequiredSignatures;
  if (returned.signatures.length !== n) return "the wallet changed who signs the transaction";
  const index = returned.message.staticAccountKeys.slice(0, n).map((k) => k.toBase58());
  for (const s of step.signers) {
    if (s === "creator") continue;
    const at = index.indexOf(plan.expect[s] ?? "");
    if (at < 0) return `the wallet removed or changed ${plan.labels[s] ?? s}'s signature`;
    if (!hasSignature(handed.signatures[at])) continue; // not signed yet: the key signs after the wallet (signStepKeys)
    if (!sameBytes(returned.signatures[at], handed.signatures[at])) return `the wallet removed or changed ${plan.labels[s] ?? s}'s signature`;
  }
  return null;
}

/** Programs a wallet may append instructions from (Phantom's Lighthouse guard; the compute-budget program it may size with). */
export const WALLET_GUARD_PROGRAMS: readonly string[] = ["L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95", "ComputeBudget111111111111111111111111111111"];

/** One instruction in resolved form: program, accounts with their flags, data — comparable across two compilations. */
function resolvedInstructions(m: VersionedTransaction["message"], tables: AddressLookupTableAccount[]): { program: string; accounts: string[]; data: string }[] | null {
  let keys: ReturnType<VersionedTransaction["message"]["getAccountKeys"]>;
  try { keys = m.getAccountKeys({ addressLookupTableAccounts: tables }); } catch { return null; }
  return m.compiledInstructions.map((ix) => ({
    program: keys.get(ix.programIdIndex)?.toBase58() ?? "?",
    accounts: ix.accountKeyIndexes.map((i) => `${keys.get(i)?.toBase58() ?? "?"}:${m.isAccountSigner(i) ? "s" : "-"}${m.isAccountWritable(i) ? "w" : "-"}`),
    data: Buffer.from(ix.data).toString("base64"),
  }));
}

/**
 * Why the returned message is not "ours plus the wallet's own guard instructions", or null when it is exactly that. Phantom's
 * Lighthouse guard may add assertion instructions before or after ours and may add or replace a compute-budget instruction; so
 * compute-budget instructions are ignored on both sides, Lighthouse ones on the wallet's side, and what remains must equal ours
 * exactly: same programs, same resolved accounts with the same flags, same data, same order.
 */
export function appendedGuardProblem(before: VersionedTransaction["message"], after: VersionedTransaction["message"], tables: AddressLookupTableAccount[]): string | null {
  const ours0 = resolvedInstructions(before, tables), theirs0 = resolvedInstructions(after, tables);
  if (!ours0 || !theirs0) return "the wallet changed the transaction's instructions or accounts";
  const COMPUTE = "ComputeBudget111111111111111111111111111111";
  const ours = ours0.filter((ix) => ix.program !== COMPUTE), theirs = theirs0.filter((ix) => !WALLET_GUARD_PROGRAMS.includes(ix.program));
  const same = (a: { program: string; accounts: string[]; data: string }, b: typeof a) => a.program === b.program && a.data === b.data && a.accounts.join("|") === b.accounts.join("|");
  if (theirs.length !== ours.length) return `the wallet changed the transaction's instructions or accounts (${ours.length} sent, ${theirs.length} came back after its own guard instructions were set aside)`;
  for (let i = 0; i < ours.length; i++) if (!same(ours[i], theirs[i])) return `the wallet changed the transaction's instructions or accounts (instruction ${i + 1} differs: ${ours[i].program === theirs[i].program ? (ours[i].data === theirs[i].data ? "accounts or flags" : "data") : "program"})`;
  return null;
}

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
  /** AUDIT A C1 (5): the plan's confirmTogether (a pair-curve set records its coins only once every step is confirmed) */
  together?: boolean;
  venue?: "launchlab" | "pair-curve";
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
  try { storage.set(planStorageKey(plan), JSON.stringify({ ...rec, v: 1, updatedAt: Date.now(), confirms: plan.confirms, steps: plan.steps.length, together: !!plan.confirmTogether, ...(plan.venue ? { venue: plan.venue } : {}), stepSigners: plan.steps.map((st) => st.signers.length), paid: rec.paid ?? [] })); } catch { /* storage full or gone: the run goes on */ }
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
/**
 * "expired" from reconcilePending means only "its blockhash has expired and this one read found no status": it can no longer land, but it
 * may already have (launch recovery 255). checkPending turns that into "never-landed" (proven: rebuildable) or "uncertain" (kept as sent).
 */
export type Reconciled = "confirmed" | "failed" | "expired" | "never-landed" | "uncertain" | "accounts-exist" | "unknown";
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
   * Phantom's dApp guidance (ticket 438485, 2026-10-14): a transaction that fails on chain trips the wallet's warning, so each step is
   * dry-run (simulateTransaction, sigVerify false) BEFORE the wallet is asked to sign. Returns why the dry run failed, or null when it
   * passed. Phantom's second review (2026-10-16): a dry run the RPC could not perform (throws) ALSO stops the step before the wallet is
   * asked, so the wallet never sees a transaction nothing has checked. Required.
   */
  simulate(tx: VersionedTransaction): Promise<string | null>;
  /** Diagnostics when a wallet's returned transaction is refused: both messages (base64) and the reason. Optional. */
  onRefused?(info: { handed: string; returned: string; why: string }): void;
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
  /**
   * launch night 2026-10-13: whether a blockhash can still land (Connection.isBlockhashValid(…, { commitment: "confirmed" }).value).
   * Absent → a slow wallet is never re-asked before the send; a "Blockhash not found" refusal still is.
   */
  isBlockhashValid?(blockhash: string): Promise<boolean>;
  /** a sentence for the creator while the run goes on (the wallet is asked to sign a rebuilt step) */
  onNotice?(text: string): void;
  /** the clock (tests); Date.now by default */
  now?(): number;
  /**
   * launch recovery 255: the transaction history for one signature (Connection.getTransaction(sig, { maxSupportedTransactionVersion: 0,
   * commitment: "confirmed" }) → null, or its meta.err). Absent → an expired step is never proven unlanded, so it is never rebuilt.
   */
  getTransaction?(sig: string): Promise<{ err: unknown } | null>;
  /**
   * launch recovery 255: whether the accounts a step creates (its mints) exist: "absent" (none does), "present" (one does: the step may
   * have landed; existence alone is not success, so the step is not adopted either) or "unknown" (the read failed). Absent → never proven.
   */
  expectedAccounts?(mints: string[]): Promise<"absent" | "present" | "unknown">;
}
/** `state` / `signature` describe the step at `failedAt` and are present only when a run stops. */
export interface SendResult { signatures: string[]; failedAt: number | null; error: string | null; state?: Exclude<StepState, "confirmed">; signature?: string; /** F06: stopped because the plan is past its deadline (the card offers Start over) */ expired?: true }

export type ChainReadDeps = Pick<SendDeps, "getSignatureStatus" | "getBlockHeight" | "getTransaction" | "expectedAccounts">;
/**
 * Reads the block height, THEN the status, then reconciles. Launch recovery 255: an "expired" reading is not taken as proof that nothing
 * landed (a load-balanced RPC can answer the height from a current backend and the status from a lagging one; history can be briefly
 * incomplete). Before a step is called "never-landed" (rebuildable), the original signature is read again (status, then the transaction
 * history) and the accounts the step creates (`mints`) must be absent. A landed result found on the second look is adopted or failed as
 * usual; an account that exists, a read that fails, or a missing check leaves the step "uncertain": kept as sent, nothing rebuilt.
 */
export async function checkPending(p: PendingSend, d: ChainReadDeps, mints: string[] = []): Promise<Reconciled> {
  let height: number | null = null, status: ChainStatus | null | undefined = undefined;
  if (d.getBlockHeight) { try { height = await d.getBlockHeight(); } catch { height = null; } }
  if (d.getSignatureStatus) { try { status = await d.getSignatureStatus(p.signature); } catch { status = undefined; } }
  const first = reconcilePending(p, status, height);
  if (first !== "expired") return first;
  let again: ChainStatus | null | undefined = undefined;
  if (d.getSignatureStatus) { try { again = await d.getSignatureStatus(p.signature); } catch { again = undefined; } }
  if (again) { const r = reconcilePending(p, again, null); if (r !== "unknown") return r; }
  if (!d.getTransaction || !d.expectedAccounts) return "uncertain";
  let tx: { err: unknown } | null | undefined;
  try { tx = await d.getTransaction(p.signature); } catch { tx = undefined; }
  if (tx) return tx.err ? "failed" : "confirmed";
  if (tx === undefined || again === undefined) return "uncertain";
  if (!mints.length) return "never-landed";
  let acc: "absent" | "present" | "unknown";
  try { acc = await d.expectedAccounts(mints); } catch { acc = "unknown"; }
  return acc === "absent" ? "never-landed" : acc === "present" ? "accounts-exist" : "uncertain";
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
/** launch recovery 255: expired now, but not proven unlanded; the signature and its bytes stay saved and nothing new is built */
const uncertainSentence = (i: number, n: number, sig: string) => `Step ${i + 1} of ${n} can no longer land, but the network has not shown whether it landed (signature ${sig}). Its signature and bytes stay saved, and nothing new is built until that is clear`;
const accountsExistSentence = (i: number, n: number, sig: string) => `Step ${i + 1} of ${n} can no longer land. The network has not shown whether it landed, but an account this step creates already exists on chain (signature ${sig}). It may have landed, so nothing new is built from this page`;
/** The sentence for a pending step that stays sent, by what the chain showed. */
export const staysSentSentence = (r: Reconciled, i: number, n: number, sig: string): string => (r === "accounts-exist" ? accountsExistSentence(i, n, sig) : r === "uncertain" ? uncertainSentence(i, n, sig) : sentSentence(i, n, sig));
/** Whether a reconciled pending send stays as sent (nothing rebuilt). */
export const staysSent = (r: Reconciled): boolean => r !== "confirmed" && r !== "failed" && r !== "never-landed";
/**
 * launch night 2026-10-13: a blockhash fetched more than this long before the wallet returned is checked on chain before the send (a
 * blockhash lives about 60 to 90 seconds; Phantom's warning screens can take longer). An expired one is rebuilt and signed again.
 */
export const STALE_BLOCKHASH_MS = 45_000;
/** How many times one step is built again with a fresh blockhash and offered to the wallet before the run stops. */
export const RESIGN_MAX = 2;
const BLOCKHASH_REFUSED = /blockhash not found/i;
/** Only a definite "no" counts as expired; a check that throws leaves the send to go ahead (a refusal then rebuilds it anyway). */
async function blockhashExpired(d: Pick<SendDeps, "isBlockhashValid">, blockhash: string): Promise<boolean> {
  try { return (await d.isBlockhashValid!(blockhash)) === false; } catch { return false; }
}
/** Said to the creator while the wallet is asked again. */
export const resignSentence = (i: number, n: number): string => `Step ${i + 1} of ${n} waited in the wallet longer than the network allows, so it was prepared again. This step was not sent. Approve it in your wallet once more.`;
export const resignExhaustedSentence = (i: number, n: number): string => `Step ${i + 1} of ${n} was not sent because the wallet took longer than the network allows, ${RESIGN_MAX + 1} times in a row. Press the button to try again, and approve the request in your wallet within a minute.`;
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
  const mintsAt = (i: number) => plan.confirms.filter((c) => c.step === i).map((c) => c.mint);
  const settle = async (p: PendingSend): Promise<Reconciled> => {
    const r = await checkPending(p, d, mintsAt(p.step));
    if (r === "confirmed") adopt(p.step, p.signature);
    else if (!staysSent(r)) { if (r === "failed") notePaid(rec, p.step, p.signature, signersAt(p.step)); rec.pending = null; rec.failed = { step: p.step, signature: p.signature }; save(); }
    return r;
  };
  /** the run stops on an unsettled step ("sent") or one that did not take effect ("failed"); null = adopted, carry on */
  const settledStop = (p: PendingSend, r: Reconciled): SendResult | null =>
    r === "confirmed" ? null : staysSent(r) ? stop(p.step, "sent", staysSentSentence(r, p.step, n, p.signature), p.signature) : stop(p.step, "failed", r === "failed" ? chainRejected(p.step, n, `transaction ${p.signature}`) : expiredSentence(p.step, n, p.signature), p.signature);

  // a resumed run settles the stored pending send before anything is built: adopted → next step; failed / expired → rebuilt below
  if (rec.pending && rec.pending.step !== signatures.length) { rec.pending = null; save(); }
  if (rec.pending) {
    const p = rec.pending;
    const r0 = await settle(p);
    if (staysSent(r0)) return settledStop(p, r0)!;
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

  const now = d.now ?? (() => Date.now());
  // F06 (prelaunch audit 2026-10-18): past the plan's deadline no NEW step is signed or sent, from any card. The stored pending send was
  // settled above (a status check) whatever the time, and every step already confirmed stays; only building a new one stops here.
  const pastDeadline = (i: number): SendResult | null => (planPastDeadline(plan, now()) ? { ...stop(i, "not-sent", planDeadlineSentence(i, n)), expired: true } : null);
  for (let i = signatures.length; i < n; i++) {
    let bh!: { blockhash: string; lastValidBlockHeight: number }, raw!: Uint8Array, pending!: PendingSend, sig = "";
    // launch night 2026-10-13: a wallet that takes longer than the blockhash lives (Phantom's warning screens) gets the step built again
    // with a fresh blockhash and is asked to sign once more, up to RESIGN_MAX times, instead of a send that fails "Blockhash not found"
    let resigns = 0;
    for (;;) {
    { const late = pastDeadline(i); if (late) return late; }
    try {
      bh = await d.latestBlockhash();
      const fetchedAt = now();
      // Phantom ticket 438485: the wallet signs first (the transaction it sees carries no other signature), the mint keys sign after
      const built = buildStepTx(plan.steps[i], creator, plan.keys, bh.blockhash, lut, false);
      // launch integrity 253: a copy of what the wallet is handed (a wallet may sign the object in place), checked against what comes back
      const handed = { message: built.message.serialize(), signatures: built.signatures.map((s) => Uint8Array.from(s)) };
      // Phantom ticket 438485, second review 2026-10-16: an unavailable or failed dry run stops the step BEFORE the wallet is asked
      let dry: string | null;
      try { dry = await d.simulate(built); }
      catch (e) { return stop(i, "not-sent", `Step ${i + 1} of ${n} was not sent because its dry run could not be run just now (${String((e as Error)?.message ?? e).slice(0, 160)}). Try again in a moment.`); }
      if (dry) return stop(i, "not-sent", `Step ${i + 1} of ${n} was not sent because a dry run of it failed on chain: ${dry}`);
      const signed = await d.signTransaction(built);
      // F06: the wallet can be held open for hours; the deadline is read again once it returns, before the transaction is kept or sent
      { const late = pastDeadline(i); if (late) return late; }
      const changed = walletReturnProblem(handed, signed, plan.steps[i], plan, lut ? [lut] : []);
      if (changed) {
        // 2026-10-14: what the wallet handed back, for the console (public bytes only: no key material is ever in a message)
        try { d.onRefused?.({ handed: Buffer.from(handed.message).toString("base64"), returned: Buffer.from(signed.message.serialize()).toString("base64"), why: changed }); } catch { /* diagnostics only */ }
        return stop(i, "not-sent", `Step ${i + 1} of ${n} was not sent because ${changed}`);
      }
      signStepKeys(signed, plan.steps[i], plan.keys);
      // the integrity check above ran first; only then is the blockhash's age looked at (a stale one is re-checked on chain)
      if (now() - fetchedAt > STALE_BLOCKHASH_MS && d.isBlockhashValid && (await blockhashExpired(d, bh.blockhash))) {
        if (resigns >= RESIGN_MAX) return stop(i, "not-sent", resignExhaustedSentence(i, n));
        resigns++; d.onNotice?.(resignSentence(i, n)); continue;
      }
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
    try {
      // launch recovery 254: the submitted transaction's own signature is its identity. Whatever the RPC answers (another signature, an
      // empty or malformed string) is a provider inconsistency: the stored signature and bytes stay, and that transaction is confirmed
      await d.sendRaw(raw);
      sig = pending.signature;
    } catch (e) {
      const m = (e as Error).message ?? String(e);
      if (SEND_REFUSED.test(m)) {
        rec.pending = null; save();
        // "Blockhash not found": the node refused it, so nothing left; build it again with a fresh blockhash and ask the wallet once more
        if (BLOCKHASH_REFUSED.test(m) && resigns < RESIGN_MAX) { resigns++; d.onNotice?.(resignSentence(i, n)); continue; }
        return stop(i, "not-sent", `Step ${i + 1} of ${n} failed. The error was: ${m.slice(0, 200)}`);
      }
      const r = settledStop(pending, await settle(pending)); // the node may have forwarded it: settle against the original
      if (r) return r;
      sig = "";
      break;
    }
    break;
    }
    if (!sig) continue;
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

/** "$AYE", "$AYE and $BEE", "$AYE, $BEE and $SEA". */
const tickerList = (xs: { ticker: string }[]): string => { const t = xs.map((x) => `$${x.ticker}`); return t.length <= 2 ? t.join(" and ") : `${t.slice(0, -1).join(", ")} and ${t[t.length - 1]}`; };
/** The fee line (launch audit 236): the network transaction fees the landed steps paid; the rent created accounts hold is named as separate. */
export const feesPaidSentence = (lamports: number): string => `The network transaction fees already paid come to ${solText(lamports)} SOL. Rent held by any account the plan created is separate and is not counted here.`;
/**
 * What each coin of an abandoned plan is on chain (launch audit 232): a coin whose create step confirmed exists on chain but is not
 * recorded; a coin whose create step did not confirm was not created. Said per coin, so "A created, B not" never reads as "nothing is live".
 */
export function abandonedCoinsSentence(rec: Pick<PlanRecord, "confirmed"> & { confirms: { mint: string; ticker: string; step: number }[] }): string {
  const made = rec.confirms.filter((x) => !!rec.confirmed[x.step]), notMade = rec.confirms.filter((x) => !rec.confirmed[x.step]);
  if (!made.length) return "Nothing from this plan is live until the create step confirms.";
  if (!notMade.length) return "Its create steps are confirmed, but the launch is not recorded from this plan.";
  return `${tickerList(made)} ${made.length === 1 ? "was" : "were"} created on chain, but ${made.length === 1 ? "it is" : "they are"} not recorded from this plan. ${tickerList(notMade)} ${notMade.length === 1 ? "was" : "were"} not created.`;
}

/** The abandoned plan's sentence: what is confirmed, what is abandoned and why, what each coin is on chain, the fees already paid, the one safe action. */
export function abandonedSentence(rec: Pick<PlanRecord, "confirmed" | "paid"> & { confirms: { mint: string; ticker: string; step: number }[]; steps: number }, lead?: string): string {
  const n = rec.steps, c = Math.min(rec.confirmed.length, n), names = rec.confirms.map((x) => `$${x.ticker}`).join(" and ") || "this launch";
  const which = n - c === 1 ? `step ${c + 1} of ${n} is` : `steps ${c + 1}–${n} of ${n} are`;
  return `${lead ?? `For ${names}, ${c} of the ${n} steps ${c === 1 ? "is" : "are"} confirmed on chain.`} ${which[0].toUpperCase()}${which.slice(1)} abandoned because the mint key was lost on reload. The key is never stored, so this plan cannot be rebuilt here. ${abandonedCoinsSentence(rec)} ${feesPaidSentence(feesPaidLamports(rec))} The only safe thing to do is to start the launch again from the review, as a new plan.`;
}

// ---- one run per plan at a time (launch audit 250) -----------------------------------------------------------------------------
// The card's `busy` is React state: two presses in the same render both read it as false, and a card that unmounts mid-run (a closed
// panel, Back) and mounts again starts with it false. The lock lives in this module, so it outlives the card, and is keyed by the plan's
// storage key, which the reload recovery notice uses too: one plan is never signed, sent or recorded by two runs at once in this tab.
const RUNNING = new Set<string>();
/** Runs `fn` unless a run for `key` is in progress; `ran: false` means it was refused and nothing was started. Released even on a throw. */
export async function withPlanLock<T>(key: string, fn: () => Promise<T>): Promise<{ ran: true; value: T } | { ran: false }> {
  if (RUNNING.has(key)) return { ran: false };
  RUNNING.add(key);
  try { return { ran: true, value: await fn() }; } finally { RUNNING.delete(key); }
}
export const PLAN_LOCKED_SENTENCE = "This launch is already being signed in this tab. Wait for that run to finish; its progress is saved as each step lands.";
/** Launch audit 240: said beside the sign button, before anything is signed. */
export const SESSION_SCOPE_LINE = "Progress is saved in this browser tab only, so keep the tab open until every step is confirmed. The mint keys are never saved, so a reload cannot finish a step that still needs one.";

/**
 * Why the lookup-table setting blocks signing (launch audit 231): still reading, or the read failed. A failed read is retried IN PLACE by
 * the card's button: reloading the page would drop the mint keys this plan holds in memory.
 */
export function pinReadProblems(pins: unknown): string[] {
  if (pins === undefined) return ["this page is still reading which lookup table this site uses"];
  if (pins === null) return ["this site's lookup table setting could not be read, so nothing can be signed yet. Use Read the setting again below. Keep this page open: the launch's mint keys are held only here"];
  return [];
}

/** The card's sentence on mount when storage holds a sent step whose outcome is not known yet (after a reload). */
export function sentRecoverySentence(p: Pick<PendingSend, "step" | "signature">, n: number, confirmedBefore: string[] = []): string {
  return failureSentence({ signatures: confirmedBefore.slice(0, p.step), failedAt: p.step, error: sentSentence(p.step, n, p.signature), state: "sent", signature: p.signature }, n);
}

/**
 * The card's sentence for a run that stopped. "Nothing was sent." only when no step was confirmed or sent. Third prelaunch audit F11: the
 * step sentences themselves say "This step was not sent" (never "Nothing was sent", which a later step contradicted once the earlier
 * steps were confirmed), and the confirmed earlier steps are described here, once; a step sentence's own full stop is not doubled.
 */
export function failureSentence(r0: SendResult, n: number): string {
  const r = { ...r0, error: r0.error?.replace(/\.+$/, "") };
  const before = r.signatures.length > 0;
  if (r.state === "abandoned") return r0.error ?? "This plan is abandoned. The only safe thing to do is to start the launch again from the review, as a new plan.";
  if (r.state === "sent") return `${r.error}. Pressing the button again checks that transaction on chain first. A new one is built only once the chain shows the old one did not land.${before ? " The steps before it are confirmed on chain." : ""}`;
  if (r.state === "failed") return `${r.error}. ${before ? "The steps before it are confirmed on chain. " : ""}Pressing the button again builds step ${(r.failedAt ?? 0) + 1} of ${n} afresh.`;
  return `${r.error}. ${before ? "The steps before it are confirmed on chain. Pressing the button again continues from the failed step." : "Nothing was sent."}`;
}

/**
 * Which signature confirms which draft. AUDIT A C1 (5): every coin whose own create step has a confirmed signature, even when a later step
 * (the other coin of a LaunchLab pair) failed: before, a pair with A created and B failed recorded neither, and A was lost after 24 h. A
 * plan whose coins go live together (confirmTogether: the pair curve) still confirms only once every confirming step is signed.
 */
export const planConfirmations = (plan: Pick<SignPlan, "confirms" | "confirmTogether">, sigs: string[]): { mint: string; launchTx: string }[] =>
  plan.confirmTogether && !plan.confirms.every((c) => sigs[c.step]) ? [] : plan.confirms.filter((c) => sigs[c.step]).map((c) => ({ mint: c.mint, launchTx: sigs[c.step] }));

export interface LaunchErrorBody { error?: string; code?: string; retryAfterSec?: number; /** second audit 2026-10-18 A-19: an account the server's RPC has not shown yet (not final) */ missing?: boolean }
type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; headers: { get(name: string): string | null }; json(): Promise<unknown> }>;
/** `transport` is set when the launch route could not be reached at all (the chain progress is untouched). */
export interface ConfirmResult { confirmed: string[]; error: string | null; transport?: boolean }

/**
 * Confirms each draft with the launch route, in plan order. A 404 (not visible to the server yet) is retried `retries` times, `waitMs`
 * apart; any other failure stops with the sentence `message` gives; a transport failure (fetch throws) stops with a plain sentence and
 * `transport: true`, keeping what was recorded. Mints in `already` are skipped. A 503 with the confirm lane's busy code (confirmBusy.ts)
 * is retried on its own, up to `busyRetries` times (6), after its Retry-After: a stranger's burst never needs the creator's press.
 */
export async function confirmPlan(fetchFn: FetchLike, plan: SignPlan, sigs: string[], message: (status: number, body: LaunchErrorBody | null, retryAfter: string | null) => string, o: { already?: string[]; retries?: number; waitMs?: number; sleep?: (ms: number) => Promise<void>; url?: string; busyRetries?: number } = {}): Promise<ConfirmResult> {
  const confirmed = [...(o.already ?? [])];
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (const l of planConfirmations(plan, sigs)) {
    if (confirmed.includes(l.mint)) continue;
    for (let attempt = 0, busy = 0; ; attempt++) {
      let r: Awaited<ReturnType<FetchLike>>;
      try {
        r = await fetchFn(o.url ?? "/api/burnticker/launch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "launched", mint: l.mint, launchTx: l.launchTx }) });
      } catch (e) {
        return { confirmed, error: `The launch could not be recorded: the server did not answer (${String((e as Error).message ?? e).slice(0, 80)}). Press the button again to record it.`, transport: true };
      }
      if (r.ok) { confirmed.push(l.mint); break; }
      const j = (await r.json().catch(() => null)) as LaunchErrorBody | null;
      // not seen yet (404), or an account the server's RPC has not shown yet (422 `missing`, A-19): asked again, never final at once
      if ((r.status === 404 || (r.status === 422 && j?.missing === true)) && attempt < (o.retries ?? 5)) { await sleep(o.waitMs ?? 4000); continue; }
      if (r.status === 503 && j?.code === CONFIRM_LANE_BUSY_CODE && busy < (o.busyRetries ?? 6)) {
        busy++;
        const sec = Number(r.headers.get("retry-after"));
        await sleep(1000 * (Number.isFinite(sec) && sec > 0 && sec <= 60 ? sec : CONFIRM_LANE_BUSY_RETRY_SEC));
        continue;
      }
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
 * becomes its own key; its confirming step is its LAST transaction the mint signs, the one that creates the coin: the LaunchLab create
 * after [initialize_token] (every coin that burns itself since 2026-10-15) or after [initialize_token + pin_burn_target] (round 5). A
 * bundle from before the split (one step, initialize_token + create) confirms on that one step.
 */
export function launchlabPlan(bundles: readonly LaunchlabBundleLike[]): SignPlan {
  const plan: SignPlan = { steps: [], keys: {}, expect: {}, labels: {}, confirms: [], venue: "launchlab", pending: [], missingKeys: bundles.length > 1 ? "the server did not hand over the mint keys, so the create transactions cannot be signed here" : "the server did not hand over the mint key, so the create transaction cannot be signed here" };
  bundles.forEach((b, i) => {
    const name = bundles.length > 1 ? `mint${i}` : "mint";
    plan.keys[name] = b.mintSecretKey; plan.expect[name] = b.mint; plan.labels[name] = `the $${b.ticker} mint key`;
    let confirmAt: number | null = null;
    for (const t of b.transactions) {
      const signers = t.signers.map((s) => (s === "mint" ? name : s));
      if (signers.includes(name)) confirmAt = plan.steps.length;
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
    // both graduate or neither: a side is verified only once init_pair (the last step) is on chain
    confirmTogether: true,
    venue: "pair-curve",
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
    const rec = parseStoredRecord(storage.get(key));
    if (rec && (rec.pending || rec.confirms.some((c) => !rec.recorded.includes(c.mint)))) out.push({ key, rec });
  }
  return out.sort((a, b) => b.rec.updatedAt - a.rec.updatedAt);
}

/**
 * One stored record, or null when it is not a well-formed v1 record (launch audit 239). Every index keeps its meaning: an array whose
 * position is a step (`confirmed`, `stepSigners`) is refused whole when one entry is bad, never compacted (dropping a bad entry would move
 * the next signature onto the wrong step), and every step number must fall inside the plan. `recorded` is a set of mints, so a stray
 * non-string is dropped from it without moving anything.
 */
function parseStoredRecord(raw: string | null): StoredLaunch["rec"] | null {
  let j: Partial<PlanRecord> | null = null;
  try { j = JSON.parse(raw ?? "null") as Partial<PlanRecord> | null; } catch { return null; }
  if (!j || j.v !== 1 || !Array.isArray(j.confirmed) || !Array.isArray(j.confirms) || !Number.isInteger(j.steps) || (j.steps as number) < 1) return null;
  const steps = j.steps as number, inPlan = (x: unknown): x is number => Number.isInteger(x) && (x as number) >= 0 && (x as number) < steps;
  if (j.confirmed.length > steps || !j.confirmed.every((x) => typeof x === "string" && x.length > 0)) return null;
  if (!j.confirms.every((c) => c && typeof c.mint === "string" && typeof c.ticker === "string" && inPlan(c.step))) return null;
  if (j.stepSigners !== undefined && (!Array.isArray(j.stepSigners) || j.stepSigners.length !== steps || !j.stepSigners.every((x) => Number.isInteger(x) && x >= 1))) return null;
  if (j.pending != null && !(isPending(j.pending) && inPlan(j.pending.step))) return null;
  if (j.failed != null && !(Number.isInteger(j.failed.step) && inPlan(j.failed.step) && typeof j.failed.signature === "string")) return null;
  const confirms = j.confirms;
  return { v: 1 as const, mints: confirms.map((c) => c.mint), confirmed: [...j.confirmed], recorded: Array.isArray(j.recorded) ? j.recorded.filter((m) => typeof m === "string") : [], pending: j.pending ?? null, failed: j.failed ?? null, updatedAt: Number(j.updatedAt) || 0, confirms, steps, paid: paidOf(j.paid), together: typeof j.together === "boolean" ? j.together : j.venue === "pair-curve" || j.venue === "launchlab" ? j.venue === "pair-curve" : legacyTogether(confirms, steps), ...(j.venue === "pair-curve" || j.venue === "launchlab" ? { venue: j.venue } : {}), ...(Array.isArray(j.stepSigners) ? { stepSigners: [...j.stepSigners] } : {}) };
}

/**
 * Review 2026-10-15 (9; re-review 5): a record stored before `together` and `venue` were written. Only the pair curve's exact shape is
 * read as together: three steps, coin A confirmed at step 0 and coin B at step 1, then init_pair (pairCurvePlan). A LaunchLab pair
 * (creates on steps 1 and 3, perhaps an opening buy after) is never this shape. Records written since carry `together` and `venue`.
 */
export function legacyTogether(confirms: readonly { step: number }[], steps: number): boolean {
  return steps === 3 && confirms.length === 2 && confirms[0].step === 0 && confirms[1].step === 1;
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
export async function recoverStoredLaunch(storage: PlanStorage, s: StoredLaunch, deps: ChainReadDeps, fetchFn: FetchLike, message: (status: number, body: LaunchErrorBody | null, retryAfter: string | null) => string): Promise<{ text: string; done: boolean; rec: StoredLaunch["rec"] }> {
  // launch audit 238: the stored record, not the caller's copy, is the truth. A finished launch's record is removed, so a replay with a
  // stale copy (a second press, a second notice) finds nothing: it posts nothing and never writes the finished record back.
  const raw = storage.get(s.key);
  if (raw === null) {
    const names = s.rec.confirms.map((x) => `$${x.ticker}`).join(" and ");
    return { text: `For ${names}, there is nothing left to check in this tab.`, done: true, rec: s.rec };
  }
  const cur = parseStoredRecord(raw) ?? s.rec;
  const rec = { ...cur, confirmed: [...cur.confirmed], recorded: [...cur.recorded], paid: [...(cur.paid ?? [])] };
  const save = () => { try { storage.set(s.key, JSON.stringify({ ...rec, updatedAt: Date.now() })); } catch { /* keep going */ } };
  if (rec.pending) {
    const p = rec.pending, r = await checkPending(p, deps, rec.confirms.filter((c) => c.step === p.step).map((c) => c.mint));
    const signers = rec.stepSigners?.[p.step] ?? 1;
    if (r === "confirmed" && p.step === rec.confirmed.length) { rec.confirmed.push(p.signature); notePaid(rec, p.step, p.signature, signers); rec.pending = null; }
    else if (r === "failed" || r === "never-landed") { if (r === "failed") notePaid(rec, p.step, p.signature, signers); rec.failed = { step: p.step, signature: p.signature }; rec.pending = null; }
    save();
    if (rec.pending) return { text: r === "uncertain" || r === "accounts-exist" ? `${staysSentSentence(r, p.step, rec.steps, p.signature)}.` : storedLaunchSentence({ key: s.key, rec }), done: false, rec };
  }
  // AUDIT A C1 (5): a coin whose create step is confirmed is recorded even when a later step never will be (a LaunchLab pair whose B
  // create failed: A exists on chain). A set that goes live together (the pair curve) still waits for every step.
  const plan = { confirms: rec.confirms, confirmTogether: rec.together === true } as unknown as SignPlan;
  const partial = rec.confirmed.length < rec.steps;
  if (partial && !planConfirmations(plan, rec.confirmed).some((l) => !rec.recorded.includes(l.mint))) return { text: storedLaunchSentence({ key: s.key, rec }), done: false, rec };
  const c = await confirmPlan(fetchFn, plan, rec.confirmed, message, { already: rec.recorded });
  rec.recorded = c.confirmed;
  const done = rec.confirms.every((x) => rec.recorded.includes(x.mint));
  if (done) { try { storage.remove(s.key); } catch { /* ignore */ } } else save();
  const names = rec.confirms.map((x) => `$${x.ticker}`).join(" and ");
  if (partial && done) { const left = rec.steps - rec.confirmed.length; return { text: `For ${names}, the coin is created on chain and recorded, so its page is live. The later ${left === 1 ? "step was" : "steps were"} not sent, and the coin does not need ${left === 1 ? "it" : "them"} to be live.`, done, rec }; }
  if (partial && !done) { const got = rec.confirms.filter((x) => rec.recorded.includes(x.mint)).map((x) => `$${x.ticker}`).join(" and "); return { text: `${got ? `${got} ${got.includes(" and ") ? "are" : "is"} created on chain and recorded. ` : ""}${storedLaunchSentence({ key: s.key, rec })}${c.error ? ` ${c.error}` : ""}`, done: false, rec }; }
  return { text: done ? `For ${names}, everything is confirmed on chain and recorded. The coin page is live.` : `All ${rec.steps} transaction${rec.steps === 1 ? " is" : "s are"} confirmed on chain. ${c.error ?? ""}`.trim(), done, rec };
}
