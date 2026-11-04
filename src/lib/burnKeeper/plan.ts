import { centsToUsd, debtStep, deltaImplausible, rawToTokens, tokensToRaw, type DebtRuleFile, type DebtStep } from "@/lib/burnKeeper/rules";
import { formatDebtMemo } from "@/lib/burnKeeper/memo";
import type { DebtReading } from "@/lib/burnKeeper/feeds/treasury";

/**
 * THE PLANNER (burn keeper, 2026-10-09). Given the ledger's last processed reading and a new validated reading → what the rule
 * says to do with it. Pure: no clock, no network, no database — the keeper, the --replay mode and the tests all run the same
 * function, so the replay printed in docs/burnkeeper/ IS the keeper's arithmetic, not a re-implementation of it.
 *
 * Outcomes:
 *   baseline  the ledger is empty: this reading is the starting point; nothing is burned for it (there is no "previous reading" the
 *             rule could measure against — burning the debt's whole history on day one is not the rule)
 *   seen      the same date and value the ledger already holds (a re-poll) — nothing to do, which is what makes polling idempotent
 *   refuse    older than the last processed date, the same date with a DIFFERENT value, or an implausible delta: the keeper holds
 *   nothing   processed, no burn (a down/flat day, or an increase under one full unit) — the carry moves per the rule
 *   burn      processed, `plannedRaw` base units to burn (before the vault cap, which execution applies against the live balance)
 */

export interface LastReading {
  recordDate: string;
  cents: bigint;
  carryOutCents: bigint;
}

export type PlanStep =
  | { kind: "baseline"; reading: DebtReading }
  | { kind: "seen"; reading: DebtReading }
  | { kind: "refuse"; reading: DebtReading; reason: string }
  | { kind: "nothing"; reading: DebtReading; prev: LastReading; step: DebtStep; reason: string }
  | { kind: "burn"; reading: DebtReading; prev: LastReading; step: DebtStep; plannedRaw: bigint };

/** One reading through the rule. `lastBurnedDate` guards the spec's "refuse readings older than the last burned one". */
export function planReading(rules: DebtRuleFile, last: LastReading | null, lastBurnedDate: string | null, reading: DebtReading): PlanStep {
  if (lastBurnedDate && reading.recordDate < lastBurnedDate) return { kind: "refuse", reading, reason: `${reading.recordDate} is older than the last burned date ${lastBurnedDate}` };
  if (!last) return { kind: "baseline", reading };
  if (reading.recordDate === last.recordDate) {
    return reading.cents === last.cents ? { kind: "seen", reading } : { kind: "refuse", reading, reason: `${reading.recordDate} now reads $${reading.amount}, the ledger holds $${centsToUsd(last.cents)} (a revision — held for the owner)` };
  }
  if (reading.recordDate < last.recordDate) return { kind: "refuse", reading, reason: `${reading.recordDate} is older than the last processed reading ${last.recordDate}` };
  const delta = reading.cents - last.cents;
  if (deltaImplausible(rules, delta)) return { kind: "refuse", reading, reason: `delta $${centsToUsd(delta)} from ${last.recordDate} is beyond the rule's ±$${rules.rule.maxAbsDeltaUsd} bound` };
  const step = debtStep(rules, last.cents, reading.cents, last.carryOutCents);
  if (step.units === 0) {
    const reason = step.kind === "down" ? `down day ($${centsToUsd(step.deltaCents)}): no burn, carry reset to 0`
      : step.kind === "flat" ? "flat day: no burn, carry reset to 0"
      : `+$${centsToUsd(step.deltaCents)} with $${centsToUsd(step.carryInCents)} carried is under one $${rules.rule.unitUsd} unit — carried $${centsToUsd(step.carryOutCents)}`;
    return { kind: "nothing", reading, prev: last, step, reason };
  }
  return { kind: "burn", reading, prev: last, step, plannedRaw: tokensToRaw(step.burnTokens, rules.decimals) };
}

/** The state after a step (what the ledger records): only processed steps move it. */
export function advance(last: LastReading | null, s: PlanStep): LastReading | null {
  if (s.kind === "baseline") return { recordDate: s.reading.recordDate, cents: s.reading.cents, carryOutCents: BigInt(0) };
  if (s.kind === "nothing" || s.kind === "burn") return { recordDate: s.reading.recordDate, cents: s.reading.cents, carryOutCents: s.step.carryOutCents };
  return last;
}

/**
 * Many readings in date order (a keeper that was down for a week, or the replay). Stops at the first refusal — every later
 * reading's delta depends on the refused one, so "never skip a date" means hold there.
 */
export function planReadings(rules: DebtRuleFile, last: LastReading | null, lastBurnedDate: string | null, readings: readonly DebtReading[]): PlanStep[] {
  const out: PlanStep[] = [];
  let state = last, burned = lastBurnedDate;
  for (const r of [...readings].sort((a, b) => (a.recordDate < b.recordDate ? -1 : a.recordDate > b.recordDate ? 1 : 0))) {
    const s = planReading(rules, state, burned, r);
    out.push(s);
    if (s.kind === "refuse") break;
    state = advance(state, s);
    if (s.kind === "burn") burned = s.reading.recordDate;
  }
  return out;
}

/** The canonical memo for a burn day, with the ACTUAL amount burned and (when > 0) the shortfall carried forward. */
export function burnMemo(rules: DebtRuleFile, sha12: string, b: { recordDate: string; prevCents: bigint; nowCents: bigint; deltaCents: bigint; units: number }, burnRaw: bigint, shortfallRaw: bigint = BigInt(0)): string {
  return formatDebtMemo({
    prefix: rules.memo.prefix, recordDate: b.recordDate, source: rules.feed.memoSource,
    prev: centsToUsd(b.prevCents), now: centsToUsd(b.nowCents), delta: centsToUsd(b.deltaCents),
    units: b.units, burn: rawToTokens(burnRaw, rules.decimals),
    ...(shortfallRaw > BigInt(0) ? { short: rawToTokens(shortfallRaw, rules.decimals) } : {}),
    rulesSha12: sha12, version: "v1",
  });
}
