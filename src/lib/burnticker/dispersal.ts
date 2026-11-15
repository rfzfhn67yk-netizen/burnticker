/**
 * BURN DISPERSAL — THE PURE STEP (owner decision 2026-10-13 night; simplified by the owner decision of 2026-10-25). A reading's crank
 * spends its share in one run; the program carries spend in the TokenConfig (`carried_spend_lamports`) only when the target is under the
 * floor, past a 30-day untradeable pool, or the swap's minimum output is 0. The program's permissionless crank_carried(max_spend_lamports)
 * spends min(carried, max_spend, pool) without a new reading. This module decides WHEN and HOW MUCH, with no I/O and no clock of its own
 * (every function takes `now`), so the two keepers share one rule and the tests drive it with fake clocks:
 *
 *   · HOW MUCH: the whole carried amount, in ONE piece (max_spend = the carried amount). The whole remainder is always accepted even
 *     under the floor (crank_carried.rs BelowFloor applies only to a piece that is not the whole remainder).
 *   · WHEN: as soon as the queue is empty (the program refuses crank_carried while a reading waits for its own crank). "Not now" refusals
 *     (TWAP, pool) are retried after the keeper's retry delay (dispersalKeeper.ts).
 *   · DEBTS (for the page and the 24-hour alert): each reading's own spend, drained oldest-first by every spend the chain shows.
 *
 * What was here before 2026-10-25 and is gone with the per-run 2 % bound and the carried budget: the six-hour windows, random piece times
 * at least 20 minutes apart, the 1.227 % depth ceiling, the budget waits, the small-pool "floor" / "below-floor" piece sizing and the
 * stuck state (and its bt-dispersal-stuck alert). A state saved with an old window still loads: its window is ignored (stateFromJson).
 */

export const BEHIND_AFTER_MS = 24 * 3_600_000;
/** While a reading waits for its own crank, look again after this long. */
export const QUEUE_WAIT_MS = 60_000;

const B0 = BigInt(0);
const bmin = (...xs: bigint[]): bigint => xs.reduce((a, b) => (b < a ? b : a));

/** The price move a buy of `lamports` into a pool holding `reserveLamports` causes, in percent (1/(1−f)² − 1 with f = lamports / (reserve + lamports) — the share of the post-trade reserve). */
export function priceMovePct(lamports: bigint, reserveLamports: bigint): number {
  const f = Number(lamports) / Number(reserveLamports + lamports);
  return (1 / (1 - f) ** 2 - 1) * 100;
}

export interface Observation {
  now: number;
  /** TokenConfig.carried_spend_lamports as read now. */
  carriedLamports: bigint;
  /** False while a reading waits for its own crank (the program refuses crank_carried then). */
  queueEmpty: boolean;
}

export type DispersalAction =
  | { kind: "idle"; why: string }
  | { kind: "wait"; untilMs: number; why: string }
  | { kind: "crank"; lamports: bigint };

/** One wake of the keeper: nothing carried → idle; a reading waiting → wait; else crank the whole carried amount in one piece. */
export function step(o: Observation): DispersalAction {
  if (o.carriedLamports <= B0) return { kind: "idle", why: "nothing carried" };
  if (!o.queueEmpty) return { kind: "wait", untilMs: o.now + QUEUE_WAIT_MS, why: "a reading is waiting for its own crank; it carries the owed spend in its target" };
  return { kind: "crank", lamports: o.carriedLamports };
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
  debts: Debt[];
  /** The crank cursor the debts last accounted for. */
  cursor: number;
  /** A piece whose signature was written before its send and is not resolved yet: never a second piece while it may land. */
  inflight: { signature: string; lastValidBlockHeight: number; lamports: bigint; carriedBefore: bigint; sentAt: number } | null;
  /** The latest pieces that landed, newest last (capped). */
  receipts: DispersalReceipt[];
  /** The last 24-hour alert's reading date (one alert per reading). */
  alerted: number | null;
  /** A piece the program deferred ("not now": TWAP, pool) is tried again from this time. */
  retryAt: number | null;
}
export const EMPTY_STATE: DispersalState = { debts: [], cursor: 0, inflight: null, receipts: [], alerted: null, retryAt: null };
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
    const parsed = JSON.parse(j, (_k, v) => (typeof v === "string" && /^-?\d+n$/.test(v) ? BigInt(v.slice(0, -1)) : v)) as DispersalState & { window?: unknown };
    // a state saved before 2026-10-25 carries a six-hour window (and an inflight chunk index): both are ignored now
    const { window: _oldWindow, ...s } = parsed;
    void _oldWindow;
    const inflight = s.inflight ? { signature: s.inflight.signature, lastValidBlockHeight: s.inflight.lastValidBlockHeight, lamports: s.inflight.lamports, carriedBefore: s.inflight.carriedBefore, sentAt: s.inflight.sentAt } : null;
    // receipts written before F10 carry no status: they were recorded with an amount, so they read as landed
    const receipts = (s.receipts ?? []).map((r) => ({ ...r, status: r.status === "pending" ? "pending" as const : "landed" as const, spentLamports: r.spentLamports ?? null }));
    return { ...EMPTY_STATE, ...s, inflight, receipts };
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
  if (d.on) return `burn dispersal: on (${d.source === "flag-on" ? `${DISPERSAL_FLAG}=1` : "the program has crank_carried"}): a carried amount is spent in one crank_carried piece`;
  if (d.source === "flag-off") return `burn dispersal: OFF on purpose (${DISPERSAL_FLAG}=0)${d.crankCarried ? ": the program has crank_carried, so a finished rule's carried amount goes to its end sink after 30 days" : ""}`;
  return `burn dispersal: off (${d.source === "not-understood" ? `${DISPERSAL_FLAG} is not 1 or 0` : "the program on this cluster has no crank_carried"})`;
}
