import type { PublicKey, TransactionInstruction, VersionedTransaction } from "@solana/web3.js";
import { readBalances, reconcileSubmitted, simulateSignSend, type SendResult, type Submitted, type SwapReader, type SwapSender } from "@/lib/burnticker/swap/chain";
import type { Balances, Network, Side } from "@/lib/burnticker/swap/plan";
import { withFlight } from "@/lib/burnticker/rpcProxy";

/**
 * A SUBMITTED SWAP KEEPS ITS IDENTITY (audit 2026-10-15 F2). Once the wallet signs, the swap's signature and blockhash expiry are written
 * to localStorage (review 3a: every tab of this site, and a reopened one, sees it), keyed by network, mint and the signing wallet
 * (review 3c: wallet A's record never blocks or labels wallet B), before the transaction is sent.
 * While a record is held the panel sends nothing else: a status read settles it first (confirmed, failed on chain, or expired so it can
 * no longer land). A failed balance read after a confirmed swap never turns the swap into an error. Nothing here touches a key: the
 * record holds a signature, a block height, the side and a time.
 */

export interface PendingSwap { v: 1; network: Network; mint: string; owner: string; signature: string; lastValidBlockHeight: number; side: Side; at: number }
/** The slice of Storage this needs (sessionStorage in the browser, a Map in the tests). */
export interface SwapStore { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }

export const pendingKey = (network: Network, mint: string, owner: string): string => `bt-swap-pending:${network}:${mint}:${owner}`;

/** The browser's localStorage, or null when it refuses it (a private window, blocked site data). */
export function browserSwapStore(): SwapStore | null {
  try { const s = (globalThis as { localStorage?: SwapStore }).localStorage; if (!s) return null; s.getItem("bt-swap-probe"); return s; } catch { return null; }
}

export function loadPending(store: SwapStore | null, network: Network, mint: string, owner: string | null): PendingSwap | null {
  if (!store || !owner) return null;
  try {
    const raw = store.getItem(pendingKey(network, mint, owner));
    if (!raw) return null;
    const r = JSON.parse(raw) as Partial<PendingSwap>;
    if (r.v !== 1 || r.mint !== mint || r.network !== network || r.owner !== owner || typeof r.signature !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{32,90}$/.test(r.signature) || typeof r.lastValidBlockHeight !== "number") return null;
    return r as PendingSwap;
  } catch { return null; }
}
export function savePending(store: SwapStore | null, rec: PendingSwap): void { store?.setItem(pendingKey(rec.network, rec.mint, rec.owner), JSON.stringify(rec)); }
export function clearPending(store: SwapStore | null, network: Network, mint: string, owner: string): void { try { store?.removeItem(pendingKey(network, mint, owner)); } catch { /* a stale record is settled again by its status read */ } }

/** What the panel shows after a send or a status read. `blocked`: an earlier swap is still unsettled, so nothing new was sent. */
export type SwapOutcome =
  | { kind: "confirmed"; signature: string; balances: Balances | null }
  | { kind: "failed"; signature: string; error: string }
  | { kind: "expired"; signature: string }
  /** review follow-up 2: released after GIVE_UP_AFTER_MS with no answer; the panel tells the visitor to check the wallet's history */
  | { kind: "unconfirmed"; signature: string }
  | { kind: "pending"; signature: string; pending: PendingSwap; error?: string };

export interface SwapContext { conn: SwapSender & SwapReader; store: SwapStore | null; network: Network; mint: PublicKey; owner: PublicKey }

/** A confirmed swap stays a success: the balance read after it is separate, and its failure is a null balance, not an error. */
async function confirmedOutcome(c: SwapContext, signature: string): Promise<SwapOutcome> {
  let balances: Balances | null = null;
  try { balances = await readBalances(c.conn, c.owner, c.mint); } catch { balances = null; }
  return { kind: "confirmed", signature, balances };
}

/** Turns a send or status result into an outcome, clearing the held record once the result is final. */
async function settle(c: SwapContext, r: SendResult, rec: PendingSwap): Promise<SwapOutcome> {
  if (r.status === "pending") return { kind: "pending", signature: r.signature, pending: rec, ...(r.error ? { error: r.error } : {}) };
  clearPending(c.store, rec.network, rec.mint, rec.owner);
  if (r.status === "confirmed") return confirmedOutcome(c, r.signature);
  if (r.status === "failed") return { kind: "failed", signature: r.signature, error: r.error ?? "" };
  return { kind: "expired", signature: r.signature };
}

/**
 * Settles a held swap with one status read. Third prelaunch audit 2026-10-16 F05: inside withFlight (the timer, the manual check and a
 * reload all come here), so a held swap still settles once the proxy's ordinary lane is spent for the day; the balance read after a
 * confirmed swap rides the same flight.
 */
export async function reconcilePending(c: SwapContext, rec: PendingSwap, now = Date.now()): Promise<SwapOutcome> {
  return withFlight(async () => {
    const out = await settle(c, await reconcileSubmitted(c.conn, { signature: rec.signature, lastValidBlockHeight: rec.lastValidBlockHeight }), rec);
    // review follow-up 2: reads that keep throwing must not hold the panel forever. After GIVE_UP_AFTER_MS, and only when a height read
    // succeeds and the chain is GIVE_UP_PAST_BLOCKS past the swap's expiry (it cannot land any more), the hold is released with a warning
    if (out.kind !== "pending" || now - rec.at <= GIVE_UP_AFTER_MS) return out;
    const height = await c.conn.getBlockHeight("confirmed").catch(() => null);
    if (height === null || height <= rec.lastValidBlockHeight + GIVE_UP_PAST_BLOCKS) return out;
    clearPending(c.store, rec.network, rec.mint, rec.owner);
    return { kind: "unconfirmed", signature: rec.signature };
  });
}
/** Review follow-up 2: how long a held swap with no answer is kept, and how far past its expiry the chain must be before it is released. */
export const GIVE_UP_AFTER_MS = 24 * 3_600_000;
export const GIVE_UP_PAST_BLOCKS = 1_500;

/**
 * One swap, sent at most once. A swap this tab still holds is settled first, and whatever it settles to is returned WITHOUT sending the
 * new one (a confirmed earlier swap is the visitor's trade; they press again knowing). `held` is the panel's own memory of a pending
 * swap, for a browser whose storage refused the record.
 */
export async function submitSwap(c: SwapContext, s: { side: Side; ixs: TransactionInstruction[]; sign: (tx: VersionedTransaction) => Promise<VersionedTransaction>; onStep?: (x: "simulating" | "signing" | "sending" | "confirming") => void; pollMs?: number; held?: PendingSwap | null; now?: number }): Promise<SwapOutcome> {
  return withFlight(() => submitSwapRun(c, s));
}
async function submitSwapRun(c: SwapContext, s: Parameters<typeof submitSwap>[1]): Promise<SwapOutcome> {
  const mint = c.mint.toBase58(), owner = c.owner.toBase58();
  // only this wallet's own held swap blocks it (review 3c)
  const earlier = heldFor(c, s.held);
  if (earlier) return reconcilePending(c, earlier);
  let rec = null as PendingSwap | null;
  const onSubmit = (x: Submitted) => {
    rec = { v: 1, network: c.network, mint, owner, signature: x.signature, lastValidBlockHeight: x.lastValidBlockHeight, side: s.side, at: s.now ?? Date.now() };
    try { savePending(c.store, rec); } catch { /* a full or blocked storage: the panel still holds the swap in memory */ }
  };
  const r = await simulateSignSend(c.conn, c.owner, s.ixs, s.sign, s.onStep, s.pollMs, onSubmit);
  const held: PendingSwap = rec ?? { v: 1, network: c.network, mint, owner, signature: r.signature, lastValidBlockHeight: r.lastValidBlockHeight ?? 0, side: s.side, at: s.now ?? Date.now() };
  return settle(c, r, held);
}

/**
 * The panel's swap, the whole of it inside one flight (F05): the held swap is settled first, then this swap's own fresh reads (`prepare`:
 * the network check, the market and the balances it is built from), then the send, the confirm and the balance read after it. A
 * refusal thrown by `prepare` reaches the caller as it was thrown. The panel's passive refresh never comes through here.
 */
export async function runSwap(c: SwapContext, s: { side: Side; prepare: () => Promise<TransactionInstruction[]>; sign: (tx: VersionedTransaction) => Promise<VersionedTransaction>; onStep?: (x: "simulating" | "signing" | "sending" | "confirming") => void; pollMs?: number; held?: PendingSwap | null; now?: number }): Promise<SwapOutcome> {
  return withFlight(async () => {
    const earlier = heldFor(c, s.held);
    if (earlier) return reconcilePending(c, earlier);
    const ixs = await s.prepare();
    return submitSwapRun(c, { ...s, ixs });
  });
}

/** This wallet's own held swap (review 3c): the stored record, or the panel's memory of one when storage refused it. */
function heldFor(c: SwapContext, held: PendingSwap | null | undefined): PendingSwap | null {
  const mint = c.mint.toBase58(), owner = c.owner.toBase58();
  return loadPending(c.store, c.network, mint, owner) ?? (held && held.owner === owner && held.mint === mint && held.network === c.network ? held : null);
}

/**
 * Review 2026-10-15 (3d): the panel's status reads for a held swap. One read at a time (a click and the 5-second timer never overlap),
 * and a read that comes back after the swap was settled (or replaced by another) is dropped: it can never hold a settled swap again.
 * `check` answers null when it skipped or its answer is stale.
 */
export class PendingWatch {
  current: PendingSwap | null = null;
  private busy = false;
  /** Review follow-up 2: status reads in a row that answered with an error; the panel's check backs off after a few. */
  private failures = 0;
  hold(rec: PendingSwap | null): void { this.current = rec; }
  /** The wait before the next check: 5 seconds, doubling after three errors in a row, at most a minute. */
  delayMs(base = 5_000): number { return this.failures < 3 ? base : Math.min(60_000, base * 2 ** (this.failures - 2)); }
  get checking(): boolean { return this.busy; }
  async check(rec: PendingSwap, reconcile: (r: PendingSwap) => Promise<SwapOutcome>): Promise<SwapOutcome | null> {
    if (this.busy || !this.current || this.current.signature !== rec.signature) return null;
    this.busy = true;
    try {
      const out = await reconcile(rec);
      this.failures = out.kind === "pending" && out.error ? this.failures + 1 : 0;
      if (!this.current || this.current.signature !== rec.signature) return null;
      this.current = out.kind === "pending" ? out.pending : null;
      return out;
    } finally { this.busy = false; }
  }
}
