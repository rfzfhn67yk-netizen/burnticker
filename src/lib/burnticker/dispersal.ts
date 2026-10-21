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
 *   · SMALL POOLS (devnet 2026-10-20, keeper on publish 109): the program refuses a piece under the rule's floor unless it is the whole
 *     carried remainder (crank_carried.rs:220, BelowFloor). When the depth ceiling is below the floor (a pool under floor / 1.227 % of
 *     SOL: about 0.77 SOL on devnet's 9,399,141-lamport floor, about 0.55 SOL on mainnet's ≈ $1 floor, i.e. a drained pool) the plan
 *     splits the whole carried amount evenly into as many pieces as it can with each piece at or above the floor and at or below the
 *     per-crank cap (n from 1 up to the window's 18), so nothing under the floor is left over to wait a window on its own (devnet
 *     publish 110: 51M carried on a 0.613 SOL pool went as 5 floor pieces and a 4.0M remainder that waited 6 hours; now 5 × 10.2M).
 *     Only when no such n exists does it fall back: less than the floor carried is one whole-remainder piece (the program accepts
 *     it); more than 18 cap-sized pieces carried is 18 cap-sized pieces now and the rest in the next window; and in the narrow case
 *     where the floor-to-cap band holds no even split (e.g. 13M carried with a 9.4M floor and a 12.26M cap) it is floor-sized pieces
 *     plus one whole-remainder piece, as before. A piece of this size on such a pool moves the price by about 3 % or more, so the
 *     program may defer it with TwapDeviation; that is acceptable, the keeper retries it. When even one floor-sized piece is above
 *     the cap (a pool under floor / 2 %), only a carried
 *     amount within the cap can go, as one whole-remainder piece; anything more is STUCK: nothing is planned, the step says so and the
 *     keeper raises bt-dispersal-stuck. Before this, each piece stayed at the depth ceiling under the floor and was refused window after
 *     window (THUVSPURS 114M and CHIVASOK 51M lamports carried on 0.613 SOL pools).
 *   · NOT DISPERSAL PIECES: the rule's one-shot end cranks (the "drain-YYYY-MM-DD" events, multiKeeper.ts planRuleEnd) each take the full
 *     2 % per-crank cap in one transaction. They are not planned here and are not bound by the depth ceiling or the 20-minute gap (the
 *     devnet watcher saw a 20.4M-lamport drain crank 22.6 min after the first); the chain's carried amount after them re-plans the window.
 */

export const DISPERSAL_WINDOW_MS = 6 * 3_600_000;
export const DISPERSAL_MIN_GAP_MS = 20 * 60_000;
/** Round-5 review R5-8: the program's carried budget refills one per-crank cap per this long (CARRIED_BUDGET_WINDOW_SECS), up to one cap.
 *  The plan spaces pieces by budget: a piece of L lamports needs L / cap of a window after the one before it (budgetGapMs). */
export const PROGRAM_BUDGET_WINDOW_MS = 600_000;
/** How long the program's budget takes to refill `lamports` (a piece's size) at one `capLamports` per window; ≤ one window. */
export function budgetGapMs(lamports: bigint, capLamports: bigint): number {
  if (capLamports <= B0 || lamports <= B0) return 0;
  const l = lamports < capLamports ? lamports : capLamports;
  return Number((l * BigInt(PROGRAM_BUDGET_WINDOW_MS) + capLamports - B1) / capLamports);
}
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

/**
 * The size one crank_carried piece is planned at on this pool, given the rule's floor:
 *   depth        the floor fits under the depth ceiling: pieces of the ceiling (the usual case)
 *   floor        the ceiling is under the floor but the floor is within the per-crank cap: pieces between the floor (`size`) and the cap,
 *                an even split of the carry (planWindow)
 *   below-floor  the floor is above the cap: no full piece is accepted; only a whole carried remainder within the cap can go
 */
export interface PieceSize { size: bigint; cap: bigint; mode: "depth" | "floor" | "below-floor" }
export function pieceSize(reserveLamports: bigint, floorLamports: bigint = B0, capBps = PROGRAM_CAP_BPS): PieceSize {
  const cap = reserveLamports > B0 ? (reserveLamports * BigInt(capBps)) / BigInt(10_000) : B0;
  const ceiling = chunkCeiling(reserveLamports, capBps);
  if (floorLamports <= ceiling) return { size: ceiling, cap, mode: "depth" };
  if (floorLamports <= cap) return { size: floorLamports, cap, mode: "floor" };
  return { size: cap, cap, mode: "below-floor" };
}

/** The sentence for a carried amount no piece can spend (the floor is above the per-crank cap and more than the cap is carried). */
export function stuckWhy(carriedLamports: bigint, reserveLamports: bigint, floorLamports: bigint, capBps = PROGRAM_CAP_BPS): string {
  const cap = (reserveLamports * BigInt(capBps)) / BigInt(10_000);
  const need = (floorLamports * BigInt(10_000) + BigInt(capBps) - B1) / BigInt(capBps);
  return `stuck: ${sol(carriedLamports)} SOL is carried, but the rule's smallest allowed burn (${sol(floorLamports)} SOL) is above the program's per-crank cap on this pool (${capBps / 100} % of ${sol(reserveLamports)} SOL = ${sol(cap)} SOL), so no piece can be spent; it stays carried until the pool holds about ${sol(need)} SOL`;
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
  /** Set when nothing can be planned because no piece the program accepts fits (stuckWhy); the window is re-planned on every step. */
  stuck?: string | null;
}

export interface PlanInput { carriedLamports: bigint; reserveLamports: bigint; capBps?: number; now: number; windowMs?: number; minGapMs?: number; seed: number; /** keep a window's end when re-planning */ endMs?: number; floorLamports?: bigint; /** the latest piece's time: the first new piece is at least the gap after it */ lastAtMs?: number | null }

/**
 * Plans [now, end): n = min(⌈carried / ceiling⌉, how many chunks fit at the minimum gap) pieces of an even split of min(carried, n ×
 * ceiling), at random times at least `minGapMs` apart (n sorted uniform points in [now, end − (n−1)·gap], the i-th shifted by i·gap).
 * The first piece is never earlier than `now`; the last is before `end`. On a pool whose depth ceiling is under the floor (pieceSize)
 * the carried amount is split evenly into the most pieces that each stay between the floor and the per-crank cap (no sub-floor
 * remainder); see SMALL POOLS in the header for the cases with no such split.
 */
export function planWindow(i: PlanInput): DispersalWindow {
  const windowMs = i.windowMs ?? DISPERSAL_WINDOW_MS;
  const endMs = i.endMs ?? i.now + windowMs;
  const base: DispersalWindow = { startMs: i.now, endMs, seed: i.seed >>> 0, chunks: [], done: 0, expectedCarried: i.carriedLamports, lastAtMs: i.lastAtMs ?? null };
  const floor = i.floorLamports ?? B0;
  const ps = pieceSize(i.reserveLamports, floor, i.capBps);
  const ceiling = ps.size;
  // R5-8: never closer than the program's budget refills a full-size piece, whatever the caller asks (a 20-minute gap always is)
  // (on a small pool a piece can be as large as the cap, so the budget gap is the cap's)
  const gap = Math.max(i.minGapMs ?? DISPERSAL_MIN_GAP_MS, budgetGapMs(ps.mode === "floor" ? ps.cap : ceiling, ps.cap));
  const from = i.lastAtMs != null ? Math.max(i.now, i.lastAtMs + gap) : i.now;
  const span = endMs - from;
  if (i.carriedLamports <= B0 || ceiling <= B0 || span <= 0) return base;
  const fit = Math.max(1, Math.floor((span - 1) / gap) + 1);   // n points with n−1 gaps inside [now, end)
  let sizes: bigint[];
  if (ps.mode === "depth") {
    const need = (i.carriedLamports + ceiling - B1) / ceiling;
    let n = Number(need < BigInt(fit) ? need : BigInt(fit));
    let amount = bmin(i.carriedLamports, BigInt(n) * ceiling);
    // never a piece under the floor unless it is the whole remainder
    while (n > 1 && amount / BigInt(n) < floor) n--;
    amount = bmin(i.carriedLamports, BigInt(n) * ceiling);
    const each = amount / BigInt(n), extra = amount % BigInt(n);
    sizes = Array.from({ length: n }, (_, k) => each + (BigInt(k) < extra ? B1 : B0));
  } else if (ps.mode === "floor") {
    const carried = i.carriedLamports, cap = ps.cap;
    const most = carried / floor;                                   // the most pieces that can each be at least the floor
    const n = Number(most < BigInt(fit) ? most : BigInt(fit));
    if (n === 0) {
      sizes = [carried];                                            // under the floor: one whole-remainder piece (within the cap)
    } else if (carried > BigInt(fit) * cap) {
      sizes = Array.from({ length: fit }, () => cap);               // more than a window of cap-sized pieces: the rest next window
    } else {
      const each = carried / BigInt(n), extra = carried % BigInt(n);
      if (each + (extra > B0 ? B1 : B0) <= cap) {
        // the even split: every piece between the floor (n ≤ carried / floor) and the cap, nothing left under the floor
        sizes = Array.from({ length: n }, (_, k) => each + (BigInt(k) < extra ? B1 : B0));
      } else {
        // no even split fits the floor-to-cap band: floor-sized pieces, then what is left under the floor as the whole remainder
        const rest = carried % floor;
        sizes = Array.from({ length: n }, () => floor);
        if (n < fit && rest > B0) sizes.push(rest);
      }
    }
  } else {
    // even one floor-sized piece is above the cap: only a whole remainder within the cap is accepted
    if (i.carriedLamports > ps.cap) return { ...base, stuck: stuckWhy(i.carriedLamports, i.reserveLamports, floor, i.capBps) };
    sizes = [i.carriedLamports];
  }
  const n = sizes.length;
  const r = rng(i.seed);
  const free = span - 1 - (n - 1) * gap;
  const offs = Array.from({ length: n }, () => Math.floor(r() * (free + 1))).sort((a, b) => a - b);
  base.chunks = offs.map((o, k) => ({ atMs: from + o + k * gap, lamports: sizes[k] }));
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
  | { kind: "wait"; untilMs: number; why: string; /** set when no piece the program accepts fits (stuckWhy) */ stuck?: boolean }
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
  if (!w || w.stuck || (o.now >= w.endMs && !overdue)) w = planWindow({ ...common, carriedLamports: o.carriedLamports, now: o.now, seed: o.seed, lastAtMs: w?.lastAtMs ?? null });
  else if (w.expectedCarried !== o.carriedLamports) w = { ...planWindow({ ...common, carriedLamports: o.carriedLamports, now: o.now, seed: (w.seed ^ seedOf(`${o.now}`)) >>> 0, endMs: w.endMs, lastAtMs: w.lastAtMs ?? null }), startMs: w.startMs };
  if (!o.queueEmpty) return { window: w, action: { kind: "wait", untilMs: o.now + 60_000, why: "a reading is waiting for its own crank; it carries the owed spend in its target" } };
  const floor = o.floorLamports ?? B0;
  const live = pieceSize(o.reserveLamports, floor, o.capBps);
  if (w.stuck || (live.mode === "below-floor" && o.carriedLamports > live.cap)) {
    return { window: w, action: { kind: "wait", untilMs: o.now + 10 * 60_000, why: w.stuck ?? stuckWhy(o.carriedLamports, o.reserveLamports, floor, o.capBps), stuck: true } };
  }
  const next = w.chunks[w.done];
  if (!next) return { window: w, action: { kind: "wait", untilMs: w.endMs, why: "this window's pieces are done; the rest opens a new window" } };
  if (next.atMs > o.now) return { window: w, action: { kind: "wait", untilMs: next.atMs, why: "the next piece is not due yet" } };
  // (on a small pool the planned piece may be anywhere between the floor and the cap, so the live clamp there is the cap)
  let lamports = bmin(next.lamports, live.mode === "floor" ? live.cap : live.size, o.carriedLamports);
  // A piece under the floor that is not the whole remainder is refused (BelowFloor): raise it to the floor, or to the whole remainder
  // when less than the floor is carried, as long as that stays within the per-crank cap (an earlier piece refused, the reserve moved).
  if (lamports < floor && lamports < o.carriedLamports) { const up = bmin(floor, o.carriedLamports); if (up <= live.cap) lamports = up; }
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

/**
 * One landed piece. Fourth prelaunch audit F10 (2026-10-18): the amount is THIS transaction's own spend, read from its `carried` memo
 * (clamped to the piece's requested maximum), never the change in the coin's carried balance (another cranker, a new reading or the
 * rule's end path can move that in between). Until the memo is read the receipt is "pending" with spentLamports null, and the keeper
 * reads it again on later wakes. A receipt written before this field existed reads as "landed".
 */
export interface DispersalReceipt {
  signature: string;
  at: number;
  /** null while the transaction's own memo has not been read (status "pending"). */
  spentLamports: bigint | null;
  status: "landed" | "pending";
  /** The piece's requested maximum (crank_carried max_spend), the clamp for the memo's amount. Absent on receipts from before F10. */
  requestedLamports?: bigint;
  /** The last wake that tried to read the memo (pending receipts only). */
  checkedAt?: number;
  /** How many times the memo was looked up while pending (the retry backoff is min(2^tries minutes, 6 h)). */
  tries?: number;
  /** Set when an unread memo was given up (three days after landing): no more lookups, one alert raised. */
  gaveUpAt?: number;
  /** The memo named more than the piece asked for: recorded at the request and alerted (a program bug or the wrong memo read). */
  clamped?: boolean;
  throughDate: number;
  memo: string | null;
  slot: number | null;
}
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
/** The receipts kept: at most RECEIPTS_KEPT, dropping the oldest LANDED ones first, so a pending receipt stays to be read. */
export function keepReceipts(rs: DispersalReceipt[]): DispersalReceipt[] {
  if (rs.length <= RECEIPTS_KEPT) return rs;
  let drop = rs.length - RECEIPTS_KEPT;
  const kept = rs.filter((r) => { if (drop > 0 && r.status !== "pending") { drop--; return false; } return true; });
  return kept.slice(-RECEIPTS_KEPT);
}

export function stateToJson(s: DispersalState): string {
  return JSON.stringify(s, (_k, v) => (typeof v === "bigint" ? `${v}n` : v));
}
export function stateFromJson(j: string | null): DispersalState {
  if (!j) return { ...EMPTY_STATE };
  try {
    const s = JSON.parse(j, (_k, v) => (typeof v === "string" && /^-?\d+n$/.test(v) ? BigInt(v.slice(0, -1)) : v)) as DispersalState;
    // receipts written before F10 carry no status: they were recorded with an amount, so they read as landed
    const receipts = (s.receipts ?? []).map((r) => ({ ...r, status: r.status === "pending" ? "pending" as const : "landed" as const, spentLamports: r.spentLamports ?? null }));
    return { ...EMPTY_STATE, ...s, receipts };
  } catch { return { ...EMPTY_STATE }; }
}

/** BURNTICKER_DISPERSAL=1 turns dispersal on; =0 turns it off on purpose. Round 5 (crank_carried) is deployed on both clusters. */
export const DISPERSAL_FLAG = "BURNTICKER_DISPERSAL";
/** True only for an explicit BURNTICKER_DISPERSAL=1 (the raw flag; hosts decide through `dispersalDecision`). */
export function dispersalEnabled(env: Readonly<Record<string, string | undefined>>): boolean { return env[DISPERSAL_FLAG]?.trim() === "1"; }

/**
 * ONE DECISION FOR BOTH HOSTS (prelaunch audit 2026-10-18 A-1). The keeper never drove crank_carried on the mainnet host because the flag
 * was never set there, so a finished rule's owed carry would go to its end sink after the program's 30-day hold. The web host's copy of
 * the flag decides which one-shot shares the launcher offers, so the two hosts could disagree.
 *
 *   BURNTICKER_DISPERSAL=1   on
 *   BURNTICKER_DISPERSAL=0   off on purpose (allowed; the keeper raises bt-dispersal-off once a day)
 *   unset                    on when the burn program deployed on the cluster has crank_carried (round 5 or later), off before that
 *   anything else            off, and named as not understood
 *
 * The keeper is stricter than the web: on a program with crank_carried it refuses to start unless the flag is set one way or the other
 * (`keeperDispersalStart`), so the keeper unit carries BURNTICKER_DISPERSAL=1 and a keeper never runs with dispersal off by accident.
 */
export type DispersalSource = "flag-on" | "flag-off" | "default-on" | "default-off" | "not-understood";
export interface DispersalDecision { on: boolean; source: DispersalSource; crankCarried: boolean }
/** `programRound`: the burn program round deployed on this host's cluster (verified-build.json); null when not known. */
export function dispersalDecision(env: Readonly<Record<string, string | undefined>>, programRound: number | null): DispersalDecision {
  const raw = (env[DISPERSAL_FLAG] ?? "").trim();
  const crankCarried = programRound !== null && programRound >= 5;
  if (raw === "1") return { on: true, source: "flag-on", crankCarried };
  if (raw === "0") return { on: false, source: "flag-off", crankCarried };
  if (raw === "") return { on: crankCarried, source: crankCarried ? "default-on" : "default-off", crankCarried };
  return { on: false, source: "not-understood", crankCarried };
}
/** The keeper's start: refuse (with the sentence it exits on) when the program has crank_carried and the flag is neither 1 nor 0. */
export function keeperDispersalStart(env: Readonly<Record<string, string | undefined>>, programRound: number | null): { ok: true; decision: DispersalDecision; line: string } | { ok: false; decision: DispersalDecision; reason: string } {
  const d = dispersalDecision(env, programRound);
  if (d.crankCarried && d.source !== "flag-on" && d.source !== "flag-off") {
    return { ok: false, decision: d, reason: `The burn program on this cluster has crank_carried (round ${programRound}), but ${DISPERSAL_FLAG} is ${d.source === "not-understood" ? "set to a value other than 1 or 0" : "not set"}. Without dispersal a finished rule's carried amount goes to its end sink after 30 days instead of burning the coin. Set ${DISPERSAL_FLAG}=1 in the keeper unit (deploy/systemd/mct-burnticker-keeper.service), or ${DISPERSAL_FLAG}=0 to run without it on purpose.` };
  }
  return { ok: true, decision: d, line: dispersalLine(d) };
}
/**
 * The file the $DEFICIT keeper records its own decision in at start (scripts/burn-keeper.mts), beside the platform registry it already
 * writes its alerts to (BURNTICKER_DB's directory); the platform keeper reads it there for ops.json.
 */
export const DEFICIT_DISPERSAL_NAME = "burnkeeper-dispersal.json";
/**
 * The ops.json line for every process that decides (review 4 and 5 of A-1): the platform keeper, the web launcher (the keeper's record
 * when the host has one, else the same rule on its own environment) and the $DEFICIT keeper (its own flag; null = not reported).
 */
export function dispersalHostLine(keeper: DispersalDecision, web: DispersalDecision & { follows?: "keeper" | "own-env" }, deficit: boolean | null): string {
  const why = (d: DispersalDecision) => (d.source === "flag-on" ? `${DISPERSAL_FLAG}=1` : d.source === "flag-off" ? `${DISPERSAL_FLAG}=0` : d.source === "default-on" ? "unset, on for a round-5 program" : d.source === "default-off" ? "unset, no crank_carried" : `${DISPERSAL_FLAG} is not 1 or 0`);
  const st = (d: DispersalDecision) => `${d.on ? "on" : "OFF"} (${why(d)})`;
  return `burn dispersal: platform keeper ${st(keeper)}; web launcher ${web.follows === "keeper" ? `${web.on ? "on" : "OFF"} (follows the platform keeper's record)` : st(web)}; $DEFICIT keeper ${deficit === null ? "not reported" : deficit ? "on" : "off"} (its own flag)`;
}
/** One line for the keeper's log and ops.json. */
export function dispersalLine(d: DispersalDecision): string {
  if (d.on) return `burn dispersal: on (${d.source === "flag-on" ? `${DISPERSAL_FLAG}=1` : "the program has crank_carried"}): carried amounts are spent in crank_carried pieces over 6-hour windows`;
  if (d.source === "flag-off") return `burn dispersal: OFF on purpose (${DISPERSAL_FLAG}=0)${d.crankCarried ? ": the program has crank_carried, so a finished rule's carried amount goes to its end sink after 30 days" : ""}`;
  return `burn dispersal: off (${d.source === "not-understood" ? `${DISPERSAL_FLAG} is not 1 or 0` : "the program on this cluster has no crank_carried"})`;
}
