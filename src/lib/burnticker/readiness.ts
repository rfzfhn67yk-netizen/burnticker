/**
 * WHERE A COIN STANDS ON THE WAY TO ITS BURNS (website follow-up 2026-10-11; docs/burnticker/FIRST-BURN-PATH.md). A coin cannot burn
 * before graduation: crank_buyback requires a registered, verified CPMM pool (`require!(c.pool_verified, PoolNotVerified)`), and the
 * LaunchLab curve graduates only at 85 SOL raised (launchBundle.ts totalFundRaisingB) — a seed gift to the burn pool does not count
 * toward it. So every coin page shows exactly ONE of these states, derived here from what the page already has (the TokenConfig as
 * the program block reads it, the LaunchLab curve, the latest receipt). Never an unexplained zero, never a bare tick.
 *
 *   not-launched          no mint registered on this host
 *   on-curve              trading on the LaunchLab curve; fuel accumulates in the burn pool; nothing can burn until it graduates
 *   awaiting-registration the curve graduated; the CPMM pool must be registered and verified (register_pool) before any burn
 *   awaiting-event        the pool is verified; no qualifying reading has been published yet (or the latest counted no units)
 *   below-floor           a reading was recorded, but the rule's spend was under the spend floor fixed at launch: nothing bought
 *   deferred              a burn is due and the program deferred it, with its reason (TWAP deviation, pool untradeable, …)
 *   burned                the latest burn executed; "verified" only when its recomputation passed, otherwise it says what failed
 *
 * Pure and client-safe. The coin page, the $DEFICIT pre-launch page and the keeper's status.json (the static $DEFICIT site) all use it.
 */
export const GRADUATION_SOL = 85;
export type ReadinessState = "not-launched" | "on-curve" | "awaiting-registration" | "awaiting-event" | "below-floor" | "deferred" | "burned";
export const READINESS_ORDER: ReadinessState[] = ["not-launched", "on-curve", "awaiting-registration", "awaiting-event", "below-floor", "deferred", "burned"];

export interface ReadinessInput {
  launched: boolean;
  /** LaunchLab curve phase, null when not read */ phase: "curve" | "migrating" | "graduated" | null;
  /** SOL raised on the curve, null when not read */ raisedSol: number | null;
  graduationSol?: number;
  /** TokenConfig: cpmm_pool set AND pool_verified; null when the program account was not read */ poolVerified: boolean | null;
  /** the newest receipt (by reading / settle time), or null */
  latest: { status: string; units: number; skippedReason: string | null; waitReason: string | null; checks?: string[]; verified?: boolean; burned?: string | null; readingDate?: string | null; eventId?: string } | null;
}
export interface Readiness { state: ReadinessState; step: number; label: string; detail: string; ok: boolean | null }

const n2 = (x: number) => (Math.round(x * 100) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 });

export function readinessOf(i: ReadinessInput): Readiness {
  const grad = i.graduationSol ?? GRADUATION_SOL;
  const R = (state: ReadinessState, label: string, detail: string, ok: boolean | null = null): Readiness => ({ state, step: READINESS_ORDER.indexOf(state) + 1, label, detail, ok });
  if (!i.launched) return R("not-launched", "Not launched", "No mint is registered on this host yet, so there is no curve, reading or receipt to show.");
  // a confirmed burn proves the pool was verified even when the program account was not read here
  const pv = i.poolVerified ?? (i.latest?.status === "confirmed" ? true : null);
  if (pv !== true) {
    if ((i.phase === "graduated" || i.phase === "migrating") && pv === null) return R("awaiting-registration", "Graduated; pool registration not read on this host", `The curve reached ${grad} SOL. Whether register_pool has recorded and verified the pool could not be read on this host (no program read); burns need it.`);
    if (i.phase === "graduated" || i.phase === "migrating") return R("awaiting-registration", "Graduated, waiting for pool registration", `The curve reached ${grad} SOL and moved to a Raydium CPMM pool. Burns start only after register_pool records that pool and the program verifies it (TokenConfig.pool_verified); until then nothing can burn.`);
    const raised = i.raisedSol === null ? `SOL raised: unavailable on this host (the curve was not read). Graduation needs ${grad} SOL.` : `${n2(i.raisedSol)} of ${grad} SOL raised.`;
    return R("on-curve", "On the curve, waiting for graduation", `${raised} Trading fees collect in the burn pool, but nothing can burn before the curve graduates and its pool is registered; a seed gift to the burn pool does not count toward graduation.`);
  }
  const l = i.latest;
  if (!l || l.status === "nothing" || l.status === "void" || (l.units === 0 && l.status !== "confirmed")) return R("awaiting-event", "Pool verified, waiting for a qualifying reading", l ? `The latest reading${l.readingDate ? ` (${l.readingDate})` : ""} counted no units, so nothing was due. The next burn needs a reading with at least one unit.` : "No reading has been published since the pool was verified. The first burn needs a reading with at least one unit.");
  if (l.status === "skipped" && /floor/i.test(l.skippedReason ?? "")) return R("below-floor", "Reading recorded, budget below the spend floor", `The reading${l.readingDate ? ` of ${l.readingDate}` : ""} counted ${l.units} unit(s), but the rule's spend was under the spend floor fixed at launch: nothing was bought and the burn pool kept the SOL.`);
  if (l.status === "planned" || l.status === "sending" || l.status === "pending-pair" || (l.status === "skipped" && !/floor/i.test(l.skippedReason ?? ""))) {
    const why = l.waitReason ?? l.skippedReason ?? (l.status === "pending-pair" ? "both coins of the pair need a registered pool first" : l.status === "sending" ? "the transaction is being sent" : "queued behind the program's next crank");
    return R("deferred", "Burn due, execution deferred", `A reading with ${l.units} unit(s) is waiting: ${why}.`);
  }
  if (l.status === "confirmed") {
    const failed = (l.checks ?? []).length > 0;
    if (failed) return R("burned", "Burned; recomputation failed", `The latest burn executed, but its recomputation does not match: ${(l.checks ?? []).join("; ")}.`, false);
    if (l.verified) return R("burned", "Burned and verified", `The latest burn executed${l.burned ? ` (${l.burned} tokens burned)` : ""} and its rule arithmetic and memo recompute on this host; the browser check re-fetches the source.`, true);
    return R("burned", "Burned; not yet recomputed", "The latest burn executed; its recomputation has not run on this host.", null);
  }
  return R("deferred", "Burn due, execution deferred", `The latest receipt is ${l.status}${l.skippedReason ? `: ${l.skippedReason}` : ""}.`);
}

/** From the app's status.json (TokenStatusJson) and its receipts. */
export function readinessFromStatus(s: { status: string; market?: { phase: "curve" | "migrating" | "graduated" | null; curve: { raised: string; threshold: string } | null } | null; program?: { initialized: boolean; pool: { registered: boolean } } | null } | null, receipts: { status: string; units: number; skippedReason: string | null; waitReason: string | null; settledAt: string; readingDate?: string | null; burned?: string | null; verify?: { verified: boolean; checks: string[] } }[]): Readiness {
  if (!s || s.status === "draft") return readinessOf({ launched: false, phase: null, raisedSol: null, poolVerified: null, latest: null });
  const latest = [...receipts].sort((a, b) => (a.settledAt < b.settledAt ? 1 : -1))[0] ?? null;
  const c = s.market?.curve ?? null;
  return readinessOf({
    launched: true, phase: s.market?.phase ?? null, raisedSol: c ? Number(c.raised) : null, graduationSol: c && Number(c.threshold) > 0 ? Number(c.threshold) : GRADUATION_SOL,
    poolVerified: s.program ? (s.program.initialized ? s.program.pool.registered : false) : null,
    latest: latest ? { status: latest.status, units: latest.units, skippedReason: latest.skippedReason, waitReason: latest.waitReason, checks: latest.verify?.checks, verified: latest.verify?.verified, burned: latest.burned ?? null, readingDate: latest.readingDate ?? null } : null,
  });
}
