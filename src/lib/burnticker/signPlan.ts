import { Buffer } from "buffer";
import { Keypair, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
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
 * Rules: a step is built, signed by its keys, then by the wallet, sent and confirmed before the next; the first failure stops the run
 * (a half-signed set is never sent) and a second press resumes at the failed step (a confirmed step is never sent twice). Client-safe.
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

/** One step, built and signed by the key(s) it names (the wallet signs after). */
export function buildStepTx(step: SignStep, creator: string, keys: Record<string, string | null | undefined>, recentBlockhash: string): Transaction {
  const tx = new Transaction({ feePayer: new PublicKey(creator), recentBlockhash });
  for (const ix of step.instructions) tx.add(new TransactionInstruction({ programId: new PublicKey(ix.programId), keys: ix.keys.map((k) => ({ pubkey: new PublicKey(k.pubkey), isSigner: k.isSigner, isWritable: k.isWritable })), data: Buffer.from(ix.dataBase64, "base64") }));
  const signers = step.signers.filter((s) => s !== "creator").map((s) => {
    const k = keys[s];
    if (!k) throw new Error(`${step.label}: needs the ${s} key`);
    return Keypair.fromSecretKey(base58ToBytes(k));
  });
  if (signers.length) tx.partialSign(...signers);
  return tx;
}

export interface SendDeps {
  latestBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: number }>;
  signTransaction(tx: Transaction): Promise<Transaction>;
  sendRaw(raw: Uint8Array): Promise<string>;
  confirm(sig: string, bh: { blockhash: string; lastValidBlockHeight: number }): Promise<{ err: unknown }>;
}
export interface SendResult { signatures: string[]; failedAt: number | null; error: string | null }

/** The steps in order; stops at the first failure; `prior` (confirmed signatures) resumes at the failed step. */
export async function signAndSendPlan(plan: SignPlan, creator: string, d: SendDeps, onStep?: (i: number, sig: string) => void, prior: string[] = []): Promise<SendResult> {
  const n = plan.steps.length, signatures: string[] = prior.slice(0, n);
  for (let i = signatures.length; i < n; i++) {
    try {
      const bh = await d.latestBlockhash();
      const signed = await d.signTransaction(buildStepTx(plan.steps[i], creator, plan.keys, bh.blockhash));
      const sig = await d.sendRaw(signed.serialize());
      const c = await d.confirm(sig, bh);
      if (c.err) throw new Error(`the chain rejected it (${JSON.stringify(c.err).slice(0, 120)})`);
      signatures.push(sig); onStep?.(i, sig);
    } catch (e) {
      const m = (e as Error).message ?? String(e);
      return { signatures, failedAt: i, error: /reject|denied|cancel/i.test(m) && !/chain rejected/.test(m) ? `step ${i + 1} of ${n} was not signed in the wallet` : `step ${i + 1} of ${n} failed: ${m.slice(0, 200)}` };
    }
  }
  return { signatures, failedAt: null, error: null };
}

/** Which signature confirms which draft. */
export const planConfirmations = (plan: SignPlan, sigs: string[]): { mint: string; launchTx: string }[] =>
  plan.confirms.every((c) => sigs[c.step]) ? plan.confirms.map((c) => ({ mint: c.mint, launchTx: sigs[c.step] })) : [];

export interface LaunchErrorBody { error?: string; code?: string; retryAfterSec?: number }
type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; headers: { get(name: string): string | null }; json(): Promise<unknown> }>;
export interface ConfirmResult { confirmed: string[]; error: string | null }

/**
 * Confirms each draft with the launch route, in plan order. A 404 (not visible to the server yet) is retried `retries` times, `waitMs`
 * apart; any other failure stops with the sentence `message` gives. Mints in `already` are skipped.
 */
export async function confirmPlan(fetchFn: FetchLike, plan: SignPlan, sigs: string[], message: (status: number, body: LaunchErrorBody | null, retryAfter: string | null) => string, o: { already?: string[]; retries?: number; waitMs?: number; sleep?: (ms: number) => Promise<void>; url?: string } = {}): Promise<ConfirmResult> {
  const confirmed = [...(o.already ?? [])];
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (const l of planConfirmations(plan, sigs)) {
    if (confirmed.includes(l.mint)) continue;
    for (let attempt = 0; ; attempt++) {
      const r = await fetchFn(o.url ?? "/api/burnticker/launch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "launched", mint: l.mint, launchTx: l.launchTx }) });
      if (r.ok) { confirmed.push(l.mint); break; }
      const j = (await r.json().catch(() => null)) as LaunchErrorBody | null;
      if (r.status === 404 && attempt < (o.retries ?? 5)) { await sleep(o.waitMs ?? 4000); continue; }
      return { confirmed, error: message(r.status, j, r.headers.get("retry-after")) };
    }
  }
  return { confirmed, error: null };
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
