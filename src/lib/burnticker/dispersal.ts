/**
 * BURN DISPERSAL — THE PURE SCHEDULER (owner decision 2026-10-13 night). A reading's crank spends at most the program's per-crank cap
 * (2 % of the CPMM pool's WSOL reserve) and carries the rest in the TokenConfig (`carried_spend_lamports`). The program's
 * permissionless crank_carried(max_spend_lamports) spends a piece of that carried amount without a new reading. This module decides
 * WHEN and HOW MUCH, with no I/O and no clock of its own (every function takes `now`), so the two keepers share one plan and the tests
 * drive it with fake clocks:
 *
 *   · CHUNK SIZE: at or below the per-crank cap AND below the depth ceiling — a constant-product buy of a fraction f of the SOL reserve
 *     moves the price by about 1/(1−f)² − 1; f ≤ DEPTH_PPM (1.227 %) keeps a single piece's move under 2.5 %, inside the program's 3 %
 *     TWAP guard, so pieces are normally not refused. The amount planned for a window is split evenly over its chunks (no dust tail).
 *   · WHEN: a window of `windowMs` (6 h) opens when there is something carried; its chunks land at RANDOM times inside it (a seeded
 *     generator, so a restart re-derives the same times), at least `minGapMs` (20 min, the TWAP window's upper end) apart, so the pool's
 *     TWAP catches up between pieces. At most floor(window / gap) chunks fit a window; what does not fit stays carried.
 *   · ROLLOVER: when the window ends with carried > 0, the next window opens with the remainder, window after window, until zero.
 *   · CHANGES MID-WINDOW: the chain is the record. Whenever the observed carried amount differs from what the window expects (a new
 *     reading's crank carried more, someone else cranked a piece, a piece was refused) the rest of the window is re-planned from now
 *     with the observed amount (same window end, a new seed derived from the old one).
 *   · DEBTS (for the page and the 24-hour alert): each reading's own spend, drained oldest-first by every spend the chain shows.
 */

export const DISPERSAL_WINDOW_MS = 6 * 3_600_000;
export const DISPERSAL_MIN_GAP_MS = 20 * 60_000;
/** 1 − 1/√1.025 ≈ 0.012270: a buy of this fraction of the SOL reserve moves a constant-product price by 2.5 %. */
export const DEPTH_PPM = 12_270;
/** The program's per-crank cap (MAX_SPEND_RESERVE_BPS). */
export const PROGRAM_CAP_BPS = 200;
export const BEHIND_AFTER_MS = 24 * 3_600_000;

const B0 = BigInt(0), B1 = BigInt(1);
const bmin = (...xs: bigint[]): bigint => xs.reduce((a, b) => (b < a ? b : a));

/** The largest piece one crank_carried should ask for: min(the program's cap, the 2.5 % depth ceiling) of the WSOL reserve. */
export function chunkCeiling(reserveLamports: bigint, capBps = PROGRAM_CAP_BPS): bigint {
  if (reserveLamports <= B0) return B0;
  return bmin((reserveLamports * BigInt(capBps)) / BigInt(10_000), (reserveLamports * BigInt(DEPTH_PPM)) / BigInt(1_000_000));
}

/** The price move a buy of `lamports` into a pool holding `reserveLamports` causes, in percent (1/(1−f)² − 1 with f = lamports / (reserve + lamports) — the share of the post-trade reserve). */
export function priceMovePct(lamports: bigint, reserveLamports: bigint): number {
  const f = Number(lamports) / Number(reserveLamports + lamports);
  return (1 / (1 - f) ** 2 - 1) * 100;
}

/** mulberry32: a small seeded generator in [0, 1). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** A 32-bit seed from a string (FNV-1a), e.g. `${mint}:${windowStart}`. */
export function seedOf(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

export interface Chunk { atMs: number; lamports: bigint }
export interface DispersalWindow {
  startMs: number; endMs: number; seed: number;
  /** Planned pieces, ascending in time; `done` counts the pieces already landed (or given up) from the front. */
  chunks: Chunk[]; done: number;
  /** The carried amount this window expects on chain now (planned at re-plan time, minus each landed piece). */
  expectedCarried: bigint;
  /** When the latest piece went out (carried across re-plans and into the next window, so the gap holds across them too). */
  lastAtMs?: number | null;
}

export interface PlanInput { carriedLamports: bigint; reserveLamports: bigint; capBps?: number; now: number; windowMs?: number; minGapMs?: number; seed: number; /** keep a window's end when re-planning */ endMs?: number; floorLamports?: bigint; /** the latest piece's time: the first new piece is at least the gap after it */ lastAtMs?: number | null }

/**
 * Plans [now, end): n = min(⌈carried / ceiling⌉, how many chunks fit at the minimum gap) pieces of an even split of min(carried, n ×
 * ceiling), at random times at least `minGapMs` apart (n sorted uniform points in [now, end − (n−1)·gap], the i-th shifted by i·gap).
 * The first piece is never earlier than `now`; the last is before `end`.
 */
export function planWindow(i: PlanInput): DispersalWindow {
  const windowMs = i.windowMs ?? DISPERSAL_WINDOW_MS, gap = i.minGapMs ?? DISPERSAL_MIN_GAP_MS;
  const endMs = i.endMs ?? i.now + windowMs;
  const base: DispersalWindow = { startMs: i.now, endMs, seed: i.seed >>> 0, chunks: [], done: 0, expectedCarried: i.carriedLamports, lastAtMs: i.lastAtMs ?? null };
  const ceiling = chunkCeiling(i.reserveLamports, i.capBps);
  const from = i.lastAtMs != null ? Math.max(i.now, i.lastAtMs + gap) : i.now;
  const span = endMs - from;
  if (i.carriedLamports <= B0 || ceiling <= B0 || span <= 0) return base;
  const fit = Math.max(1, Math.floor((span - 1) / gap) + 1);   // n points with n−1 gaps inside [now, end)
  const need = (i.carriedLamports + ceiling - B1) / ceiling;
  let n = Number(need < BigInt(fit) ? need : BigInt(fit));
  let amount = bmin(i.carriedLamports, BigInt(n) * ceiling);
  // never a piece under the floor unless it is the whole remainder
  const floor = i.floorLamports ?? B0;
  while (n > 1 && amount / BigInt(n) < floor) n--;
  amount = bmin(i.carriedLamports, BigInt(n) * ceiling);
  const r = rng(i.seed);
  const free = span - 1 - (n - 1) * gap;
  const offs = Array.from({ length: n }, () => Math.floor(r() * (free + 1))).sort((a, b) => a - b);
  const each = amount / BigInt(n), extra = amount % BigInt(n);
  base.chunks = offs.map((o, k) => ({ atMs: from + o + k * gap, lamports: each + (BigInt(k) < extra ? B1 : B0) }));
  return base;
}

export interface Observation {
  now: number;
  /** TokenConfig.carried_spend_lamports as read now. */
  carriedLamports: bigint;
  /** The pool's WSOL reserve now (net of owed fees). */
  reserveLamports: bigint;
  /** False while a reading waits for its own crank (the program refuses crank_carried then). */
  queueEmpty: boolean;
  capBps?: number; windowMs?: number; minGapMs?: number; floorLamports?: bigint;
  /** Seed for a NEW window (the caller derives it, e.g. seedOf(`${mint}:${now}`)). */
  seed: number;
}

export type DispersalAction =
  | { kind: "idle"; why: string }
  | { kind: "wait"; untilMs: number; why: string }
  | { kind: "crank"; lamports: bigint; chunkIndex: number };

/**
 * One wake of the keeper: the window to keep (null when nothing is carried) and what to do now. Pure: the same inputs give the same
 * plan. The crank's size is re-clamped to the LIVE ceiling and the carried amount (the reserve moved since the plan).
 */
export function step(w0: DispersalWindow | null, o: Observation): { window: DispersalWindow | null; action: DispersalAction } {
  if (o.carriedLamports <= B0) return { window: null, action: { kind: "idle", why: "nothing carried" } };
  const common = { reserveLamports: o.reserveLamports, capBps: o.capBps, windowMs: o.windowMs, minGapMs: o.minGapMs, floorLamports: o.floorLamports };
  let w = w0;
  // A piece planned inside the window but caught by the keeper's wake just after the window ended (the wake is coarser than the plan)
  // still goes out, within one gap of the end, instead of being pushed into a new random window.
  const gapMs = o.minGapMs ?? DISPERSAL_MIN_GAP_MS;
  const overdue = !!w && o.now >= w.endMs && o.now < w.endMs + gapMs && !!w.chunks[w.done] && w.expectedCarried === o.carriedLamports;
  if (!w || (o.now >= w.endMs && !overdue)) w = planWindow({ ...common, carriedLamports: o.carriedLamports, now: o.now, seed: o.seed, lastAtMs: w?.lastAtMs ?? null });
  else if (w.expectedCarried !== o.carriedLamports) w = { ...planWindow({ ...common, carriedLamports: o.carriedLamports, now: o.now, seed: (w.seed ^ seedOf(`${o.now}`)) >>> 0, endMs: w.endMs, lastAtMs: w.lastAtMs ?? null }), startMs: w.startMs };
  if (!o.queueEmpty) return { window: w, action: { kind: "wait", untilMs: o.now + 60_000, why: "a reading is waiting for its own crank; it carries the owed spend in its target" } };
  const next = w.chunks[w.done];
  if (!next) return { window: w, action: { kind: "wait", untilMs: w.endMs, why: "this window's pieces are done; the rest opens a new window" } };
  if (next.atMs > o.now) return { window: w, action: { kind: "wait", untilMs: next.atMs, why: "the next piece is not due yet" } };
  const lamports = bmin(next.lamports, chunkCeiling(o.reserveLamports, o.capBps), o.carriedLamports);
  if (lamports <= B0) return { window: w, action: { kind: "wait", untilMs: o.now + 10 * 60_000, why: "the pool has no reserve to size a piece against" } };
  return { window: w, action: { kind: "crank", lamports, chunkIndex: w.done } };
}

/**
 * After a piece: `spent` is what the chain shows left the carried amount (0 when the piece was refused and is given up); `atMs` when it
 * went out (default: its planned time) — the next piece, in this window or the next, is at least the gap after it.
 */
export function markChunk(w: DispersalWindow, spent: bigint, atMs?: number): DispersalWindow {
  const sentAt = spent > B0 ? Math.max(atMs ?? 0, w.chunks[w.done]?.atMs ?? 0) : w.lastAtMs ?? null;
  return { ...w, done: w.done + 1, expectedCarried: w.expectedCarried - spent, lastAtMs: sentAt };
}

/** When the next wake is useful: the next piece's time, the window's end, or never (null) when nothing is carried. */
export function nextDueAt(w: DispersalWindow | null): number | null {
  if (!w) return null;
  const c = w.chunks[w.done];
  return c ? c.atMs : w.endMs;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Debts: each reading's own spend, drained oldest first
// ---------------------------------------------------------------------------------------------------------------------------------

export interface Debt { readingDate: number; landedAt: number; totalLamports: bigint; remainingLamports: bigint }

function drain(debts: Debt[], amount: bigint): Debt[] {
  let left = amount;
  return debts.map((d) => {
    if (left <= B0 || d.remainingLamports <= B0) return d;
    const take = bmin(left, d.remainingLamports);
    left -= take;
    return { ...d, remainingLamports: d.remainingLamports - take };
  });
}

/**
 * A reading's crank landed (from its Reading account): its spend went first to the older carried amounts (`carriedIn`), the rest to its
 * own rule spend; its own remainder is what it carried out beyond the older debts it could not pay.
 */
export function addReading(debts: readonly Debt[], r: { readingDate: number; landedAt: number; spentLamports: bigint; carriedInLamports: bigint; carriedOutLamports: bigint }): Debt[] {
  const paidOld = bmin(r.spentLamports, r.carriedInLamports);
  const out = drain([...debts], paidOld);
  const ownSpent = r.spentLamports > r.carriedInLamports ? r.spentLamports - r.carriedInLamports : B0;
  const oldLeft = r.carriedInLamports - paidOld;
  const ownLeft = r.carriedOutLamports > oldLeft ? r.carriedOutLamports - oldLeft : B0;
  if (ownLeft > B0) out.push({ readingDate: r.readingDate, landedAt: r.landedAt, totalLamports: ownSpent + ownLeft, remainingLamports: ownLeft });
  return out;
}

/**
 * The chain's carried amount is the record: debts are drained oldest-first down to it; an amount the debts do not explain (a crank
 * the keeper did not see) becomes a debt of `throughDate`. Fully paid debts are dropped.
 */
export function reconcile(debts: readonly Debt[], carriedLamports: bigint, throughDate: number, now: number): Debt[] {
  const owed = debts.reduce((a, d) => a + d.remainingLamports, B0);
  let out = owed > carriedLamports ? drain([...debts], owed - carriedLamports) : [...debts];
  if (carriedLamports > owed) out.push({ readingDate: throughDate, landedAt: now, totalLamports: carriedLamports - owed, remainingLamports: carriedLamports - owed });
  out = out.filter((d) => d.remainingLamports > B0);
  return out;
}

/** The oldest reading not fully spent `BEHIND_AFTER_MS` after it landed, or null. */
export function behind(debts: readonly Debt[], now: number, afterMs = BEHIND_AFTER_MS): Debt | null {
  return debts.find((d) => d.remainingLamports > B0 && now - d.landedAt >= afterMs) ?? null;
}

const sol = (l: bigint): string => {
  const s = (Number(l) / 1e9).toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  return s === "" ? "0" : s;
};
const day = (d: number): string => { const s = String(d); return s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}` : s; };

/** The page line for one debt: "spent X of Y SOL for the reading of <date>; remainder being spent". */
export function debtLine(d: Debt): string {
  return `spent ${sol(d.totalLamports - d.remainingLamports)} of ${sol(d.totalLamports)} SOL for the reading of ${day(d.readingDate)}; remainder being spent`;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Persisted state (JSON-safe: bigints as strings)
// ---------------------------------------------------------------------------------------------------------------------------------

export interface DispersalReceipt { signature: string; at: number; spentLamports: bigint; throughDate: number; memo: string | null; slot: number | null }
export interface DispersalState {
  window: DispersalWindow | null;
  debts: Debt[];
  /** The crank cursor the debts last accounted for. */
  cursor: number;
  /** A piece whose signature was written before its send and is not resolved yet: never a second piece while it may land. */
  inflight: { signature: string; lastValidBlockHeight: number; lamports: bigint; carriedBefore: bigint; sentAt: number; chunkIndex: number } | null;
  /** The latest pieces that landed, newest last (capped). */
  receipts: DispersalReceipt[];
  /** The last 24-hour alert's reading date (one alert per reading). */
  alerted: number | null;
  /** A piece the program deferred ("not now": TWAP, pool) is tried again from this time. */
  retryAt: number | null;
}
export const EMPTY_STATE: DispersalState = { window: null, debts: [], cursor: 0, inflight: null, receipts: [], alerted: null, retryAt: null };
export const RECEIPTS_KEPT = 200;

export function stateToJson(s: DispersalState): string {
  return JSON.stringify(s, (_k, v) => (typeof v === "bigint" ? `${v}n` : v));
}
export function stateFromJson(j: string | null): DispersalState {
  if (!j) return { ...EMPTY_STATE };
  try {
    const s = JSON.parse(j, (_k, v) => (typeof v === "string" && /^-?\d+n$/.test(v) ? BigInt(v.slice(0, -1)) : v)) as DispersalState;
    return { ...EMPTY_STATE, ...s };
  } catch { return { ...EMPTY_STATE }; }
}

/** BURNTICKER_DISPERSAL=1 turns the keeper's dispersal on (off until crank_carried is deployed). */
export const DISPERSAL_FLAG = "BURNTICKER_DISPERSAL";
export function dispersalEnabled(env: Readonly<Record<string, string | undefined>>): boolean { return env[DISPERSAL_FLAG]?.trim() === "1"; }
