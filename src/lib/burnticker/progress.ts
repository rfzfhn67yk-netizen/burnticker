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
export type ProgressStepState = "done" | "current" | "todo";
export interface ProgressView {
  steps: { label: (typeof PROGRESS_STEPS)[number]; state: ProgressStepState }[];
  /** how many steps are done (0 to 6) */
  done: number;
  /** the next unmet condition, one plain sentence; when all six are done, what the next burn needs */
  next: string;
  /** the readiness state it was read from */
  from: ReadinessState;
}

/** Steps done for each readiness state. A burn that is due but on hold is "Ready to burn"; a burned coin has done all six. */
const DONE: Record<ReadinessState, number> = { "not-launched": 0, "on-curve": 1, "awaiting-registration": 3, "awaiting-event": 4, "below-floor": 4, deferred: 5, burned: 6 };

const n2 = (x: number) => (Math.round(x * 100) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 });

export interface ProgressFacts {
  /** SOL raised on the curve and the coin's own raise, when read */
  raisedSol?: number | null;
  raiseSol?: number | null;
  /** queued units waiting for the pool (the $DEFICIT keeper's files), when read */
  queuedUnits?: number | null;
}

export function progressOf(r: Readiness, f: ProgressFacts = {}): ProgressView {
  const done = DONE[r.state];
  const steps = PROGRESS_STEPS.map((label, k) => ({ label, state: (k < done ? "done" : k === done ? "current" : "todo") as ProgressStepState }));
  const raise = typeof f.raiseSol === "number" && f.raiseSol > 0 ? f.raiseSol : null;
  const raised = typeof f.raisedSol === "number" ? f.raisedSol : null;
  const queued = typeof f.queuedUnits === "number" && f.queuedUnits > 0 ? ` ${f.queuedUnits === 1 ? "One unit is" : `${f.queuedUnits} units are`} queued for that moment.` : "";
  let next: string;
  switch (r.state) {
    case "not-launched": next = "Next, the coin has to be created."; break;
    case "on-curve":
      next = raise !== null && raised !== null ? `Next, the curve has to raise ${n2(Math.max(0, raise - raised))} more SOL to reach its ${n2(raise)} SOL raise and graduate.`
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
  return { steps, done, next, from: r.state };
}

/** "Step 3 of 6: Graduated" for a screen reader or a one-line summary. */
export const progressSummary = (p: ProgressView): string => (p.done >= PROGRESS_STEPS.length ? `All ${PROGRESS_STEPS.length} steps are done.` : `${p.done} of ${PROGRESS_STEPS.length} steps are done. The current step is ${PROGRESS_STEPS[p.done].toLowerCase()}.`);
