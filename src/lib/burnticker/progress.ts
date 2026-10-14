import type { Readiness, ReadinessState } from "@/lib/burnticker/readiness";

/**
 * THE PROGRESS STRIP (website-14, ChatGPT product idea 4). Six plain steps a visitor can follow on every card and coin page:
 *
 *   Created · Trading on curve · Graduated · Pool registered · Ready to burn · Burned
 *
 * with the next unmet condition in one sentence. It is a VIEW of readiness.ts, not a second model: each of readiness.ts's seven states
 * maps to how many of these steps are done, and the sentence comes from the same facts (the curve's raise is the coin's own, read from
 * its pool; an unread raise is named "its raise"). Pure and client-safe.
 */
export const PROGRESS_STEPS = ["Created", "Trading on curve", "Graduated", "Pool registered", "Ready to burn", "Burned"] as const;
/** website-15 item 6: "na" marks a step that does not apply to this coin (the devnet rehearsal coin had no curve), never invented history */
export type ProgressStepState = "done" | "current" | "todo" | "na";
export interface ProgressView {
  steps: { label: (typeof PROGRESS_STEPS)[number]; state: ProgressStepState }[];
  /** how many steps are done (0 to 6) */
  done: number;
  /**
   * The short heading beside the dots (website-15 item 6, Claude site audit 3 item 4a): "Not created" before the coin exists, then the
   * next unmet milestone as "Next: graduated", and "Burned" once all six are done. Never "Now:" on a step that has not happened.
   */
  now: string;
  /** the next unmet condition, one plain sentence; when all six are done, what the next burn needs */
  next: string;
  /** the readiness state it was read from */
  from: ReadinessState;
}

/** Steps done for each readiness state. A burn that is due but on hold is "Ready to burn"; a burned coin has done all six. */
// website-15 item 6: a coin on its curve has done "Created" and "Trading on curve"; its next unmet milestone is graduation
export const PROGRESS_DONE: Record<ReadinessState, number> = { "not-launched": 0, "on-curve": 2, "awaiting-registration": 3, "awaiting-event": 4, "below-floor": 4, deferred: 5, burned: 6 };

/**
 * Each step as the thing that happens next, a noun (ChatGPT audit 6 item 23: "Next: graduated" read as a state, so it says "Next:
 * graduation").
 */
export const PROGRESS_NEXT: Record<(typeof PROGRESS_STEPS)[number], string> = {
  Created: "creation", "Trading on curve": "trading on the curve", Graduated: "graduation", "Pool registered": "pool registration", "Ready to burn": "ready to burn", Burned: "first burn",
};
/** The heading for a number of done steps: "Not created", "Next: <step>" or "Burned". */
export const progressNow = (done: number): string => (done <= 0 ? "Not created" : done >= PROGRESS_STEPS.length ? "Burned" : `Next: ${PROGRESS_NEXT[PROGRESS_STEPS[done]]}`);

const n2 = (x: number) => (Math.round(x * 100) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 });
/** Below this much SOL raised, the curve is said as not started (walkthrough 13). */
export const CURVE_STARTED_SOL = 0.01;

export interface ProgressFacts {
  /** SOL raised on the curve and the coin's own raise, when read */
  raisedSol?: number | null;
  raiseSol?: number | null;
  /** queued units waiting for the pool (the $DEFICIT keeper's files), when read */
  queuedUnits?: number | null;
  /** steps that do not apply to this coin (website-15: the devnet rehearsal coin's curve and graduation); shown as not applicable */
  notApplicable?: readonly (typeof PROGRESS_STEPS)[number][];
}

export function progressOf(r: Readiness, f: ProgressFacts = {}): ProgressView {
  const done = PROGRESS_DONE[r.state];
  const na = new Set(f.notApplicable ?? []);
  // a coin that is not created has no current step: nothing is lit (website-15 item 6)
  const steps = PROGRESS_STEPS.map((label, k) => ({ label, state: (na.has(label) ? "na" : k < done ? "done" : k === done && done > 0 ? "current" : "todo") as ProgressStepState }));
  const raise = typeof f.raiseSol === "number" && f.raiseSol > 0 ? f.raiseSol : null;
  const raised = typeof f.raisedSol === "number" ? f.raisedSol : null;
  const queued = typeof f.queuedUnits === "number" && f.queuedUnits > 0 ? ` ${f.queuedUnits === 1 ? "One unit is" : `${f.queuedUnits} units are`} queued for that moment.` : "";
  let next: string;
  switch (r.state) {
    case "not-launched": next = "Next, the coin has to be created."; break;
    case "on-curve":
      // walkthrough 13 (2026-10-14): "has to raise 85 more SOL to reach its 85 SOL raise" read oddly at 0.00000004 SOL raised
      next = raise !== null && raised !== null ? (raised < CURVE_STARTED_SOL ? `The curve has not started filling. It graduates at ${n2(raise)} SOL raised.` : `${n2(raised)} of ${n2(raise)} SOL raised; ${n2(Math.max(0, raise - raised))} more to graduate.`)
        : raise !== null ? `Next, the curve has to reach its ${n2(raise)} SOL raise and graduate.`
        : "Next, the curve has to reach its raise and graduate.";
      next += queued;
      break;
    case "awaiting-registration": next = `Next, the coin's Raydium pool has to be registered with the burn program and verified.${queued}`; break;
    case "awaiting-event": next = "Next, a published result has to count at least one unit."; break;
    case "below-floor": next = "Next, a published result has to count a spend above the spend floor set at launch."; break;
    case "deferred": next = `Next, the burn run has to go through. ${r.detail}`; break;
    case "burned": next = "This coin has burned. The next burn needs the next result that counts."; break;
  }
  return { steps, done, now: progressNow(done), next, from: r.state };
}

/** "Step 3 of 6 is done. The next step is pool registered." for a screen reader and the readiness panel's heading. */
export const progressSummary = (p: ProgressView): string => {
  const na = p.steps.filter((x) => x.state === "na").map((x) => x.label.toLowerCase());
  const naText = na.length ? ` ${na.length === 1 ? `The step ${na[0]} does` : `The steps ${na.slice(0, -1).join(", ")} and ${na[na.length - 1]} do`} not apply to this coin.` : "";
  if (p.done <= 0) return `Step 0 of ${PROGRESS_STEPS.length}. The coin is not created yet.`;
  if (p.done >= PROGRESS_STEPS.length) return `All ${PROGRESS_STEPS.length} steps are done.${naText}`;
  return `Step ${p.done} of ${PROGRESS_STEPS.length} is done. The next step is ${PROGRESS_STEPS[p.done].toLowerCase()}.${naText}`;
};
