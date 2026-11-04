/**
 * THE PLAN-AGE GUARD (prelaunch audit 2026-10-16 F-3). A launch plan registers its drafts when it is built, and a draft's create counts
 * only inside its 24-hour window (registry.ts DRAFT_TTL_MS, judged on the create's block time). A create that lands after that is never
 * taken live (the confirm answers launch-late and the owner is alerted), so the launch page stops a plan from being signed once it is
 * older than the window, less a margin: a prepare replayed from the server's memory (api/idempotency.ts, 15 minutes) can already be that
 * old when it arrives, and a send needs a moment to land. Client-safe: no registry import (the test pins the window to the registry's).
 */
export const PLAN_WINDOW_MS = 24 * 3_600_000;
export const PLAN_MARGIN_MS = 20 * 60_000;
export const PLAN_SIGNABLE_MS = PLAN_WINDOW_MS - PLAN_MARGIN_MS;

/** Whether a plan built at `planAt` (this page's clock) can no longer be signed. No plan: false. */
export const planExpired = (planAt: number | null, now: number): boolean => planAt !== null && now - planAt >= PLAN_SIGNABLE_MS;
/** How long until the plan stops being signable (0 when it already has). */
export const planExpiresInMs = (planAt: number, now: number): number => Math.max(0, planAt + PLAN_SIGNABLE_MS - now);

export const PLAN_EXPIRED_SENTENCE = "This launch plan was built almost a day ago. Its drafts only count a launch made within 24 hours of building them, so it can no longer be signed. Start over to build a fresh launch. Anything already sent from this plan stays on chain.";
