/**
 * NEXT RESULT vs NEXT SOURCE CHECK (audit 7 F08, 2026-10-19). The token status producer set `rules.oneShot` from `!!rule.market`, so a
 * one-game catalogue coin (no market) was not one-shot; the creator page then showed the keeper's next poll of the source as the coin's
 * "Next result" for a game that was already decided (the live DENWIN: a one-game pair result settled 2026-10-16, waiting for graduation).
 * One-shot-ness now comes from rules.ts isOneShot everywhere, and the status JSON carries two different times: `nextSourceCheckAt` (when
 * the keeper reads the source next; a poll, not a result) and `nextResultAt` (when a new result can arrive: null for a decided or voided
 * one-shot, a scheduled close for a pending one-shot, the next read for a repeating rule), with `result` saying which case it is.
 * Pure and client-safe.
 */
import type { BurnRule } from "@/lib/burnticker/rules";
import { CATALOGUE_ONE_SHOT_RE, KEEPER_ONE_SHOT_RE } from "@/lib/burnticker/inverse";

/**
 * Resolves once (rules.ts re-exports this as the canonical isOneShot): one market, a derby flippening or one-time high, or (sources-2,
 * 2026-10-12) a first-party one-shot that has exactly one reading ever: a single game (espn.game, which every pair game reads), a named
 * launch (ll2.launch), a star or channel milestone (github.milestone, youtube.milestone) and the other KEEPER_ONE_SHOT_RE series. The
 * keeper ends those after the reading.
 */
export const isOneShot = (r: Pick<BurnRule, "market" | "oracle" | "derby"> & { series?: string | null }): boolean => r.market !== null || (r.oracle === "derby" && r.derby?.selector === "coinvs" && r.derby.flip === true) || (r.oracle === "derby" && r.derby?.selector === "high" && r.derby.once === true) || (r.oracle === "catalogue" && KEEPER_ONE_SHOT_RE.test(r.series ?? ""));

/**
 * ONE BURN OF THE WHOLE POOL (owner decision 2026-10-19, the live NEXTM6): a rule that resolves once (isOneShot) and whose every mapping
 * spends 100 % of the pool. Such a coin spends its pool in its one burn, so what reaches the pool afterwards (trading fees that arrive
 * after the burn, the reserve the rule keeps back on every crank, rounding) is what its end sends on; the end words say that instead of
 * the losing-path words. A vault amount (no fractionOfPool) is not a share, so it is not this.
 */
export const oneShotFull = (r: Pick<BurnRule, "market" | "oracle" | "derby" | "kind" | "binary" | "scalar"> & { series?: string | null }): boolean => {
  // HB-147 (hourly run 13): the first snow at 100% is one burn of the whole pool too (multiKeeper.ts drains it after its first snow)
  if (!isOneShot(r) && !isFirstSnowRule(r)) return false;
  const maps = (r.kind === "binary" ? [r.binary?.onYes, r.binary?.onNo] : [r.scalar?.perUnit]).filter((m) => !!m);
  return maps.length > 0 && maps.every((m) => m!.fractionOfPool === 1);
};
/** A one-shot binary rule with an outcome that burns nothing (onYes or onNo is null): that outcome ends the rule with the pool untouched. */
export const hasNoBurnOutcome = (r: Pick<BurnRule, "kind" | "binary">): boolean => r.kind === "binary" && !!r.binary && (!r.binary.onYes || !r.binary.onNo);
/**
 * RESOLVES ONCE, AS A READER SEES IT (launch wizard audit 2026-10-19 F14). The first snow (nws.snow) resolves once: its catalogue cadence
 * is "once a season", describe.ts windowKindOf calls it a one-shot, and the keeper ends the coin after its first snow that burned
 * (multiKeeper.ts detectRuleEnd, its own branch) or VOID once the season's June 30 has passed. It stays OUT of isOneShot on purpose: the
 * keeper's one-shot branch would end it on its first reading of 0, and its default share is not the one-shot 100%. Every page, the status
 * producer and the statement read this instead, so they say what the keeper does. Every other one-shot is isOneShot itself.
 */
export const isFirstSnowRule = (r: Pick<BurnRule, "oracle"> & { series?: string | null }): boolean => r.oracle === "catalogue" && /^nws\.snow:[A-Z]{3}$/.test(r.series ?? "");
export const resolvesOnce = (r: Pick<BurnRule, "market" | "oracle" | "derby"> & { series?: string | null }): boolean => isOneShot(r) || (r.oracle === "catalogue" && CATALOGUE_ONE_SHOT_RE.test(r.series ?? ""));

/** "recurring" (a rule that repeats), or a one-shot's state: "pending" (no result yet), "decided" (a result settled), "void". */
export type ResultState = "recurring" | "pending" | "decided" | "void";

/** The rule's end receipts: they follow a result (or the rule's end) and never are one. */
const END_KINDS = new Set(["winddown", "drain", "sweep"]);
/** A result receipt in one of these states settled a result (burned, waiting to burn, waiting for its pair, or forwarded to the winner). */
export const SETTLED_RESULT = new Set(["confirmed", "planned", "sending", "pending-pair", "forwarded"]);
const VOIDED = new Set(["void", "voided"]);

export interface ResultReceipt { status: string; kind?: string | null; settledAt?: string | null; units?: number | null }

/** The latest result receipt (end receipts aside), or null. */
export function latestResult(receipts: readonly ResultReceipt[]): ResultReceipt | null {
  return receipts.filter((r) => !END_KINDS.has(r.kind ?? "")).sort((a, b) => String(b.settledAt ?? "").localeCompare(String(a.settledAt ?? "")))[0] ?? null;
}

/**
 * A one-shot's state from its receipts: decided once its latest result receipt settled a result, void once it was voided, otherwise
 * pending (a skipped, failed or zero-unit receipt does not decide it; prelaunch review 2026-10-18, A-26).
 */
export function oneShotState(receipts: readonly ResultReceipt[], o: { burnedOnly?: boolean } = {}): Exclude<ResultState, "recurring"> {
  // the first snow (F14): a daily reading of 0 is not its result; only a day that burned decides it (multiKeeper.ts detectRuleEnd)
  const l = latestResult(o.burnedOnly ? receipts.filter((b) => (b.units ?? 0) > 0) : receipts);
  if (l && SETTLED_RESULT.has(l.status)) return "decided";
  if (l && VOIDED.has(l.status)) return "void";
  return "pending";
}

export interface NextTimes { result: ResultState; nextResultAt: string | null; nextSourceCheckAt: string | null }

/**
 * The status JSON's next block times. A one-shot's next result is its scheduled close while pending, and none once decided or voided;
 * the keeper's next source check is never a result for it. A repeating rule's next result is the next close the venue lists, else the
 * keeper's next read of the source.
 */
export function nextTimes(i: { oneShot: boolean; receipts: readonly ResultReceipt[]; nextCloseTime: string | null; nextCheckAt: string | null; burnedOnly?: boolean }): NextTimes {
  if (!i.oneShot) return { result: "recurring", nextResultAt: i.nextCloseTime ?? i.nextCheckAt, nextSourceCheckAt: i.nextCheckAt };
  const result = oneShotState(i.receipts, { burnedOnly: i.burnedOnly });
  return { result, nextResultAt: result === "pending" ? i.nextCloseTime : null, nextSourceCheckAt: i.nextCheckAt };
}
