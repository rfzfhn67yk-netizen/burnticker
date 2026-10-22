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
 *
 * CONTINUOUS AUDIT 2026-10-19T1919Z SEC-02 (combined recovery gap): the server's copy is no longer best effort either. The browser's
 * record alone is not durable (cleared site data, another browser), so a swap is sent only when BOTH the browser's record was read back
 * AND the server answered that it kept the record under the same signature (REFUSAL.notRecorded otherwise; the browser's record is then
 * removed and nothing is sent). And "the server could not be read" is no longer "no held swap": with no record in this browser, only a
 * server answer that says there is none lets a new swap go ahead; a failed, timed out or unreadable answer refuses with
 * REFUSAL.recoveryUnknown before the wallet is asked, and the panel offers Check again instead of a swap.
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
 * (the server checks the wallet signed it) and resolves only once the server acknowledged it kept that signature (it throws otherwise);
 * `load` reads the wallet's held swap for this coin: a record, null only when the server answered that there is none, and a throw when
 * the answer failed or could not be read (HB-65: a sealed hold, one that may still land, also throws: unknown, not absent); `clear` asks
 * the server to remove it by its signature, which it does only once its own chain read shows the swap settled.
 */
export interface PendingRemote {
  save(rec: PendingSwap, raw: Uint8Array): Promise<void>;
  load(network: Network, mint: string, owner: string): Promise<PendingSwap | null>;
  clear(rec: PendingSwap): Promise<void>;
}
/** How long the panel waits for the server's copy to answer; no answer in time counts as a failure (the swap is not sent). */
export const REMOTE_WAIT_MS = 8_000;
/** HB-65 v4: how many times a save refused with 503 "chain-unavailable" is tried in all, and the longest wait between tries. */
export const SAVE_ATTEMPTS = 3;
export const SAVE_RETRY_MAX_MS = 1_500;
type Fetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; cache?: "no-store"; signal?: AbortSignal }) => Promise<{ ok: boolean; status?: number; json(): Promise<unknown> }>;
const b64 = (u: Uint8Array): string => { let s = ""; for (const x of u) s += String.fromCharCode(x); return btoa(s); };
/** The panel's client for the server's copy. */
export function httpPendingRemote(fetchFn: Fetch, base = "/api/burnticker/swap-pending", waitMs = REMOTE_WAIT_MS): PendingRemote {
  const timed = async <T,>(f: (signal: AbortSignal) => Promise<T>): Promise<T> => { const c = new AbortController(); const t = setTimeout(() => c.abort(), waitMs); try { return await f(c.signal); } finally { clearTimeout(t); } };
  const send = (method: string, body: unknown) => timed((signal) => fetchFn(base, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal }));
  return {
    // 1919Z SEC-02: acknowledged only by a 2xx answer that names this swap's signature
    // HB-65 v4: a 503 "chain-unavailable" stored nothing (the server could not read the chain to date the swap), so the same save is
    // tried again after a short wait, at most SAVE_ATTEMPTS times in all; the caller's own time limit still bounds the whole save
    async save(rec, raw) {
      const body = { network: rec.network, mint: rec.mint, owner: rec.owner, signature: rec.signature, lastValidBlockHeight: rec.lastValidBlockHeight, side: rec.side, tx: b64(raw) };
      for (let attempt = 1; ; attempt++) {
        const r = await send("POST", body);
        const j = (await Promise.resolve().then(() => r.json()).catch(() => null)) as { signature?: unknown; code?: unknown; retryAfterMs?: unknown } | null;
        if (r.ok && j && j.signature === rec.signature) return;
        if (r.ok || r.status !== 503 || j?.code !== "chain-unavailable" || attempt >= SAVE_ATTEMPTS) throw new Error("the server did not keep the held swap");
        const wait = typeof j.retryAfterMs === "number" && j.retryAfterMs > 0 ? Math.min(j.retryAfterMs, SAVE_RETRY_MAX_MS) : SAVE_RETRY_MAX_MS;
        await new Promise((ok) => setTimeout(ok, wait));
      }
    },
    // 1919Z SEC-02: null only for a 2xx answer of { pending: null }; anything else that is not a valid record throws (unknown, not absent)
    async load(network, mint, owner) {
      const r = await timed((signal) => fetchFn(`${base}?network=${network}&mint=${mint}&owner=${owner}`, { cache: "no-store", signal }));
      if (!r.ok) throw new Error("the server's held swap could not be read");
      const j = (await r.json()) as { pending?: PendingSwap | null } | null;
      if (!j || typeof j !== "object" || !("pending" in j)) throw new Error("the server's answer could not be read");
      const p = j.pending;
      if (p === null) return null;
      // HB-65: a swap that may still land comes back sealed (no signature): held, not absent; the panel offers Check again until the
      // chain shows it can no longer land, when the server sends the whole record and the panel settles it as before
      if (p && (p as { sealed?: unknown }).sealed === true) throw new Error("an earlier swap from this wallet may still settle");
      if (p && p.v === 1 && p.network === network && p.mint === mint && p.owner === owner && typeof p.signature === "string" && Number.isInteger(p.lastValidBlockHeight)) return p;
      throw new Error("the server's held swap could not be read");
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

export interface SwapContext {
  conn: SwapSender & SwapReader; store: SwapStore | null; network: Network; mint: PublicKey; owner: PublicKey;
  /** SEC-02: the server's copy of the hold; absent or null = the browser's record alone (the panel always passes one in a browser) */
  remote?: PendingRemote | null;
  /** 1919Z SEC-02: how long a save or read of the server's copy may take before it counts as failed (REMOTE_WAIT_MS; shorter in tests) */
  remoteWaitMs?: number;
}

/** Rejects when `f` has not settled within `ms` (1919Z SEC-02: a hung server answer is a failure, not a wait forever). */
async function within<T>(ms: number, f: () => Promise<T>): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([f(), new Promise<never>((_, no) => { t = setTimeout(() => no(new Error("the server did not answer in time")), ms); })]); }
  finally { clearTimeout(t); }
}

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
    // 1919Z SEC-02: and the server's copy, acknowledged, before the send: a browser cleared after an ambiguous send must still find it.
    // A failed, refused or timed out save means nothing is sent; the browser's record of a swap that was never sent is removed.
    if (c.remote) {
      const remote = c.remote, kept = rec, raw = x.raw;
      try {
        if (!raw) throw new Error("no signed transaction to show the server");
        await within(c.remoteWaitMs ?? REMOTE_WAIT_MS, () => remote.save(kept, raw));
      } catch {
        clearPending(c.store, kept.network, kept.mint, kept.owner);
        clearRemote(c, kept);   // in case the save landed and only its answer was lost; never sent, so it holds nothing
        rec = null;
        throw new Error(REFUSAL.notRecorded);
      }
    }
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
 * back into the browser's storage so the panel's timer and a later reload see it too. 1919Z SEC-02: with no record here, a server that
 * cannot be read is "unknown", not "none": REFUSAL.recoveryUnknown is thrown before anything is signed or sent.
 */
async function heldFor(c: SwapContext, held: PendingSwap | null | undefined): Promise<PendingSwap | null> {
  const mint = c.mint.toBase58(), owner = c.owner.toBase58();
  const local = loadPending(c.store, c.network, mint, owner) ?? (held && held.owner === owner && held.mint === mint && held.network === c.network ? held : null);
  if (local || !c.remote) return local;
  const r = await loadRemotePending(c.remote, c.store, c.network, mint, owner, c.remoteWaitMs);
  if (r.kind === "unknown") throw new Error(REFUSAL.recoveryUnknown);
  return r.kind === "held" ? r.rec : null;
}
/** 1919Z SEC-02: what a read of the server's copy found. `absent` only from an answer that says there is none; `unknown` when it failed. */
export type RemoteRead = { kind: "held"; rec: PendingSwap } | { kind: "absent" } | { kind: "unknown" };
/** SEC-02: the server's copy of this wallet's held swap, kept in the browser's storage too when it can be. */
export async function loadRemotePending(remote: PendingRemote | null | undefined, store: SwapStore | null, network: Network, mint: string, owner: string | null, waitMs = REMOTE_WAIT_MS): Promise<RemoteRead> {
  if (!remote || !owner) return { kind: "absent" };
  let r: PendingSwap | null = null;
  try { r = await within(waitMs, () => remote.load(network, mint, owner)); } catch { return { kind: "unknown" }; }
  if (!r) return { kind: "absent" };
  if (r.owner !== owner || r.mint !== mint || r.network !== network) return { kind: "unknown" };
  try { savePending(store, r); } catch { /* the panel holds it in memory */ }
  return { kind: "held", rec: r };
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
