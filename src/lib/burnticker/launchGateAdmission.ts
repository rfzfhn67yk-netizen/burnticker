/**
 * The launch gate as the sign card read it right before the plan's FIRST step went to the network (signPlan.ts PlanRecord.gate). It is
 * kept in the plan record and sent with the confirm. `at` is the browser's clock, in ms. Client-safe.
 */
export interface PlanGate { state: "open"; at: number }
/** A well-formed gate record, or undefined. */
export const planGateOf = (g: unknown): PlanGate | undefined => {
  const x = g as PlanGate | null;
  return x && typeof x === "object" && x.state === "open" && Number.isFinite(x.at) && x.at > 0 ? { state: "open", at: Math.floor(x.at) } : undefined;
};

/**
 * THE COMPLETION RULE FOR A CREATE THAT LANDS AFTER CREATOR LAUNCHES CLOSE (continuous audit 2026-10-19 SEC-03).
 *
 * The sign card reads the launch gate before every new step and again when the wallet hands the step back; "closed" and an unreadable
 * gate both stop the step (signPlan.ts). What no check can see is a closure that falls between the last check and the broadcast, or
 * between the broadcast and the confirm. Before, such a create was refused by the confirm (403 launch-after-closure): the creator paid
 * for a coin the site then would not serve. Now:
 *
 *   · a create that landed BEFORE the closure is admitted, as always (the closure moment against its block time);
 *   · a create that landed after the closure is admitted when its plan record carries the open gate read taken right before the plan's
 *     FIRST step was sent (PlanGate, sent with the confirm) and that read is consistent with what this server knows on its own:
 *       - the draft was made before the closure (the server's own clock: no draft is prepared while launches are closed),
 *       - the gate read falls between the draft and the closure (each side allowed CLOCK_SKEW_MS, the read is the browser's clock),
 *       - the create did not land before that read (less the same skew),
 *       - and it landed within AFTER_CLOSURE_GRACE_MS of the closure, so a forged gate record can win at most the same few minutes an
 *         honest race can;
 *     the operator is alerted for every such admission (draftReconciler.ts alertLaunchAdmittedAfterClosure);
 *   · a create with no gate record (an old page, the public /v1/launch/confirm, the keeper's reconciler, which never sees one) that lands
 *     after the closure stays refused, with the existing operator alert and revive command.
 *
 * Pure: the confirm route (api/handlers.ts markLaunched) asks it; the test pins every case.
 */
export const CLOCK_SKEW_MS = 2 * 60_000;
export const AFTER_CLOSURE_GRACE_MS = 15 * 60_000;

export type AfterClosureDecision =
  | { admit: true; reason: "before-closure" | "open-gate-record" }
  | { admit: false; reason: "no-gate-record" | "draft-after-closure" | "gate-outside-window" | "landed-before-gate" | "past-grace" };

export function admitAfterClosure(i: { closedAt: number | null; blockTimeMs: number; draftCreatedAt: number; gate: unknown }): AfterClosureDecision {
  if (i.closedAt === null || i.blockTimeMs <= i.closedAt) return { admit: true, reason: "before-closure" };
  const g: PlanGate | undefined = planGateOf(i.gate);
  if (!g) return { admit: false, reason: "no-gate-record" };
  if (i.draftCreatedAt >= i.closedAt) return { admit: false, reason: "draft-after-closure" };
  if (g.at < i.draftCreatedAt - CLOCK_SKEW_MS || g.at >= i.closedAt + CLOCK_SKEW_MS) return { admit: false, reason: "gate-outside-window" };
  if (i.blockTimeMs < g.at - CLOCK_SKEW_MS) return { admit: false, reason: "landed-before-gate" };
  if (i.blockTimeMs - i.closedAt > AFTER_CLOSURE_GRACE_MS) return { admit: false, reason: "past-grace" };
  return { admit: true, reason: "open-gate-record" };
}
