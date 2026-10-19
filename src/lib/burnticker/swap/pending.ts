import type { PublicKey, TransactionInstruction, VersionedTransaction } from "@solana/web3.js";
import { readBalances, reconcileSubmitted, simulateSignSend, type SendResult, type Submitted, type SwapReader, type SwapSender } from "@/lib/burnticker/swap/chain";
import type { Balances, Network, Side } from "@/lib/burnticker/swap/plan";
import { withFlight } from "@/lib/burnticker/rpcProxy";
import { REFUSAL } from "@/lib/burnticker/swap/copy";

/**
 * A SUBMITTED SWAP KEEPS ITS IDENTITY (audit 2026-10-15 F2). Once the wallet signs, the swap's signature and blockhash expiry are written
 * to localStorage (review 3a: every tab of this site, and a reopened one, sees it), keyed by network, mint and the signing wallet
 * (review 3c: wallet A's record never blocks or labels wallet B), before the transaction is sent.
 * While a record is held the panel sends nothing else: a status read settles it first (confirmed, failed on chain, or expired so it can
 * no longer land). A failed balance read after a confirmed swap never turns the swap into an error. Nothing here touches a key: the
 * record holds a signature, a block height, the side and a time.
 *
 * CONTINUOUS AUDIT 2026-10-19 SEC-02: the record is no longer best effort. A swap is sent only once its record has been written AND read
 * back from this browser's storage; storage that is missing, throws, or silently drops the value stops the swap before the wallet is
 * asked (a write test) and again before the send (the real record), with REFUSAL.storageUnavailable, so the first send count is zero.
 * A second copy goes to the server (swap/pendingServer.ts, `remote`), keyed by network, coin and wallet, so a browser whose site data was
 * cleared after an ambiguous send still finds the held swap when the panel mounts, and settles it before anything new is sent.
 */

export interface PendingSwap { v: 1; network: Network; mint: string; owner: string; signature: string; lastValidBlockHeight: number; side: Side; at: number }
/** The slice of Storage this needs (sessionStorage in the browser, a Map in the tests). */
export interface SwapStore { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }

export const pendingKey = (network: Network, mint: string, owner: string): string => `bt-swap-pending:${network}:${mint}:${owner}`;

/** SEC-02: true only when the store keeps a value: a test value is written, read back and removed. */
export function storeWritable(store: SwapStore | null): boolean {
  if (!store) return false;
  try {
    const k = "bt-swap-probe", v = `${Date.now()}:${Math.random()}`;
    store.setItem(k, v);
    const ok = store.getItem(k) === v;
    store.removeItem(k);
    return ok;
  } catch { return false; }
}

/** The browser's localStorage, or null when it refuses it or does not keep a value (a private window, blocked site data, a full quota). */
export function browserSwapStore(): SwapStore | null {
  try { const s = (globalThis as { localStorage?: SwapStore }).localStorage; return s && storeWritable(s) ? s : null; } catch { return null; }
}

/**
 * SEC-02: the server's copy of a held swap (swap/pendingServer.ts, /api/burnticker/swap-pending). `save` posts the signed transaction
 * (the server checks the wallet signed it); `load` reads the wallet's held swap for this coin; `clear` removes it by its signature.
 */
export interface PendingRemote {
  save(rec: PendingSwap, raw: Uint8Array): Promise<void>;
  load(network: Network, mint: string, owner: string): Promise<PendingSwap | null>;
  clear(rec: PendingSwap): Promise<void>;
}
/** How long the panel waits for the server's copy before it goes on with the browser's record alone. */
export const REMOTE_WAIT_MS = 4_000;
type Fetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; cache?: "no-store"; signal?: AbortSignal }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;
const b64 = (u: Uint8Array): string => { let s = ""; for (const x of u) s += String.fromCharCode(x); return btoa(s); };
/** The panel's client for the server's copy. */
export function httpPendingRemote(fetchFn: Fetch, base = "/api/burnticker/swap-pending", waitMs = REMOTE_WAIT_MS): PendingRemote {
  const timed = async <T,>(f: (signal: AbortSignal) => Promise<T>): Promise<T> => { const c = new AbortController(); const t = setTimeout(() => c.abort(), waitMs); try { return await f(c.signal); } finally { clearTimeout(t); } };
  const send = (method: string, body: unknown) => timed((signal) => fetchFn(base, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal }));
  return {
    async save(rec, raw) { const r = await send("POST", { network: rec.network, mint: rec.mint, owner: rec.owner, signature: rec.signature, lastValidBlockHeight: rec.lastValidBlockHeight, side: rec.side, tx: b64(raw) }); if (!r.ok) throw new Error("the server did not keep the held swap"); },
    async load(network, mint, owner) {
      const r = await timed((signal) => fetchFn(`${base}?network=${network}&mint=${mint}&owner=${owner}`, { cache: "no-store", signal }));
      if (!r.ok) throw new Error("the server's held swap could not be read");
      const p = ((await r.json()) as { pending?: PendingSwap | null }).pending ?? null;
      return p && p.v === 1 && p.network === network && p.mint === mint && p.owner === owner && typeof p.signature === "string" && Number.isInteger(p.lastValidBlockHeight) ? p : null;
    },
    async clear(rec) { await send("DELETE", { network: rec.network, mint: rec.mint, owner: rec.owner, signature: rec.signature }); },
  };
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
/**
 * A WALLET'S LAST SWAP OUTCOME, KEPT FOR WHEN IT IS CONNECTED AGAIN (review of prelaunch audit 2026-10-18 F04). The panel shows an
 * outcome only for the wallet that is connected; one that lands for wallet A while B is connected (a confirmed swap, a failure, the
 * 24-hour "check your wallet's history" release) is kept here under network:mint:owner and shown, once, when A is connected again.
 * The text is stored as shown (the panel's own sentences), with the signature for the explorer link.
 */
export interface LastOutcome { v: 1; signature: string; done?: { balance: string; earlier: boolean }; err?: string; at?: number }
export const outcomeKey = (network: Network, mint: string, owner: string): string => `bt-swap-outcome:${network}:${mint}:${owner}`;
export function saveOutcome(store: SwapStore | null, network: Network, mint: string, owner: string, o: LastOutcome): void {
  try { store?.setItem(outcomeKey(network, mint, owner), JSON.stringify({ ...o, at: o.at ?? Date.now() })); } catch { /* a full or blocked storage: the panel's memory keeps it */ }
}
/** Reads and removes a wallet's kept outcome (shown once); null when there is none or it is unreadable. */
export function takeOutcome(store: SwapStore | null, network: Network, mint: string, owner: string | null): LastOutcome | null {
  if (!store || !owner) return null;
  try {
    const k = outcomeKey(network, mint, owner), raw = store.getItem(k);
    if (!raw) return null;
    store.removeItem(k);
    const o = JSON.parse(raw) as LastOutcome;
    return o && o.v === 1 && typeof o.signature === "string" && (typeof o.err === "string" || (o.done && typeof o.done.balance === "string")) ? o : null;
  } catch { return null; }
}

export function savePending(store: SwapStore | null, rec: PendingSwap): void { store?.setItem(pendingKey(rec.network, rec.mint, rec.owner), JSON.stringify(rec)); }
/** SEC-02: writes the record and reads it back; throws REFUSAL.storageUnavailable when the store is missing, throws, or did not keep it. */
export function savePendingVerified(store: SwapStore | null, rec: PendingSwap): void {
  let kept: PendingSwap | null = null;
  try { savePending(store, rec); kept = loadPending(store, rec.network, rec.mint, rec.owner); } catch { kept = null; }
  if (!kept || kept.signature !== rec.signature || kept.lastValidBlockHeight !== rec.lastValidBlockHeight) throw new Error(REFUSAL.storageUnavailable);
}
export function clearPending(store: SwapStore | null, network: Network, mint: string, owner: string): void { try { store?.removeItem(pendingKey(network, mint, owner)); } catch { /* a stale record is settled again by its status read */ } }

/** What the panel shows after a send or a status read. `blocked`: an earlier swap is still unsettled, so nothing new was sent. */
export type SwapOutcome =
  | { kind: "confirmed"; signature: string; balances: Balances | null }
  | { kind: "failed"; signature: string; error: string }
  | { kind: "expired"; signature: string }
  /** review follow-up 2: released after GIVE_UP_AFTER_MS with no answer; the panel tells the visitor to check the wallet's history */
  | { kind: "unconfirmed"; signature: string }
  | { kind: "pending"; signature: string; pending: PendingSwap; error?: string };

export interface SwapContext { conn: SwapSender & SwapReader; store: SwapStore | null; network: Network; mint: PublicKey; owner: PublicKey; /** SEC-02: the server's copy of the hold; absent or null = the browser's record alone */ remote?: PendingRemote | null }

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
  clearRemote(c, rec);
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
    clearRemote(c, rec);
    return { kind: "unconfirmed", signature: rec.signature };
  });
}
/** Review follow-up 2: how long a held swap with no answer is kept, and how far past its expiry the chain must be before it is released. */
export const GIVE_UP_AFTER_MS = 24 * 3_600_000;
export const GIVE_UP_PAST_BLOCKS = 1_500;

/**
 * One swap, sent at most once. A swap this tab still holds is settled first, and whatever it settles to is returned WITHOUT sending the
 * new one (a confirmed earlier swap is the visitor's trade; they press again knowing). `held` is the panel's own memory of a pending
 * swap. SEC-02: a browser whose storage does not keep the record is refused before anything is signed (REFUSAL.storageUnavailable).
 */
export async function submitSwap(c: SwapContext, s: { side: Side; ixs: TransactionInstruction[]; sign: (tx: VersionedTransaction) => Promise<VersionedTransaction>; onStep?: (x: "simulating" | "signing" | "sending" | "confirming") => void; pollMs?: number; held?: PendingSwap | null; now?: number }): Promise<SwapOutcome> {
  return withFlight(() => submitSwapRun(c, s));
}
async function submitSwapRun(c: SwapContext, s: Parameters<typeof submitSwap>[1]): Promise<SwapOutcome> {
  const mint = c.mint.toBase58(), owner = c.owner.toBase58();
  // only this wallet's own held swap blocks it (review 3c): the browser's record, the panel's memory, or the server's copy (SEC-02)
  const earlier = await heldFor(c, s.held);
  if (earlier) return reconcilePending(c, earlier);
  // SEC-02: a store that cannot keep a value stops the swap before the wallet is asked; nothing is signed or sent
  if (!storeWritable(c.store)) throw new Error(REFUSAL.storageUnavailable);
  let rec = null as PendingSwap | null;
  const onSubmit = async (x: Submitted) => {
    rec = { v: 1, network: c.network, mint, owner, signature: x.signature, lastValidBlockHeight: x.lastValidBlockHeight, side: s.side, at: s.now ?? Date.now() };
    // SEC-02: written and read back BEFORE the send; a throw here means nothing is sent (chain.ts simulateSignSend)
    savePendingVerified(c.store, rec);
    // and the server's copy, so a browser cleared after an ambiguous send still finds it; its failure does not stop the swap
    if (c.remote && x.raw) { try { await c.remote.save(rec, x.raw); } catch { /* the browser's verified record still holds the swap */ } }
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
    const earlier = await heldFor(c, s.held);
    if (earlier) return reconcilePending(c, earlier);
    if (!storeWritable(c.store)) throw new Error(REFUSAL.storageUnavailable);   // SEC-02: before any read or the wallet
    const ixs = await s.prepare();
    return submitSwapRun(c, { ...s, ixs });
  });
}

/**
 * This wallet's own held swap (review 3c): the stored record, the panel's memory of one, or (SEC-02) the server's copy, which is written
 * back into the browser's storage so the panel's timer and a later reload see it too. A server that cannot be read is not a hold: the
 * browser's own verified record is the guarantee, the server's copy covers a browser that lost it.
 */
async function heldFor(c: SwapContext, held: PendingSwap | null | undefined): Promise<PendingSwap | null> {
  const mint = c.mint.toBase58(), owner = c.owner.toBase58();
  const local = loadPending(c.store, c.network, mint, owner) ?? (held && held.owner === owner && held.mint === mint && held.network === c.network ? held : null);
  if (local || !c.remote) return local;
  return loadRemotePending(c.remote, c.store, c.network, mint, owner);
}
/** SEC-02: the server's copy of this wallet's held swap, kept in the browser's storage too when it can be; null when none or unreadable. */
export async function loadRemotePending(remote: PendingRemote | null | undefined, store: SwapStore | null, network: Network, mint: string, owner: string | null): Promise<PendingSwap | null> {
  if (!remote || !owner) return null;
  let r: PendingSwap | null = null;
  try { r = await remote.load(network, mint, owner); } catch { return null; }
  if (!r || r.owner !== owner || r.mint !== mint || r.network !== network) return null;
  try { savePending(store, r); } catch { /* the panel holds it in memory */ }
  return r;
}
function clearRemote(c: SwapContext, rec: PendingSwap): void { if (c.remote) void c.remote.clear(rec).catch(() => { /* it lapses on the server after a day */ }); }

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
