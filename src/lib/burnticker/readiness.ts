/**
 * WHERE A COIN STANDS ON THE WAY TO ITS BURNS (website follow-up 2026-10-11; docs/burnticker/FIRST-BURN-PATH.md). A coin cannot burn
 * before graduation: crank_buyback requires a registered, verified CPMM pool (`require!(c.pool_verified, PoolNotVerified)`), and the
 * LaunchLab curve graduates only at its raise (the coin's own totalFundRaisingB, read from its pool; website-14 removed the typed 85 from
 * these sentences: a raise this site has not read is named as "its raise", never a constant) — a seed gift to the burn pool does not count
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
  /** the raise that completes the coin's curve, read from its pool; undefined when not read (the sentences then say "its raise") */
  graduationSol?: number;
  /** TokenConfig: cpmm_pool set AND pool_verified; null when the program account was not read */ poolVerified: boolean | null;
  /** the newest receipt (by reading / settle time), or null */
  latest: { status: string; units: number; skippedReason: string | null; waitReason: string | null; checks?: string[]; verified?: boolean; burned?: string | null; readingDate?: string | null; eventId?: string } | null;
}
export interface Readiness { state: ReadinessState; step: number; label: string; detail: string; ok: boolean | null }

const unitsText = (n: number) => `${n} unit${n === 1 ? "" : "s"}`;
const n2 = (x: number) => (Math.round(x * 100) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 });

export function readinessOf(i: ReadinessInput): Readiness {
  const g = typeof i.graduationSol === "number" && i.graduationSol > 0 ? i.graduationSol : null;
  const reached = g === null ? "The curve reached its raise" : `The curve reached ${n2(g)} SOL`;
  const R = (state: ReadinessState, label: string, detail: string, ok: boolean | null = null): Readiness => ({ state, step: READINESS_ORDER.indexOf(state) + 1, label, detail, ok });
  if (!i.launched) return R("not-launched", "Not launched", "No coin is registered on this site yet. There is no curve, reading or receipt to show.");
  // a confirmed burn proves the pool was verified even when the program account was not read here
  const pv = i.poolVerified ?? (i.latest?.status === "confirmed" ? true : null);
  if (pv !== true) {
    if ((i.phase === "graduated" || i.phase === "migrating") && pv === null) return R("awaiting-registration", "Graduated, but this site could not check the pool", `${reached}. This site could not read the program, so it cannot tell whether the pool has been registered and verified (register_pool). Burns need that step first.`);
    if (i.phase === "graduated" || i.phase === "migrating") return R("awaiting-registration", "Graduated, waiting for pool registration", `${reached} and moved to a Raydium CPMM pool. Burns start only after that pool is registered with the program (register_pool) and the program verifies it. Until then, nothing can burn.`);
    const raised = i.raisedSol === null ? `This site could not read the curve, so the SOL raised is not shown. Graduation needs ${g === null ? "the raise set when the coin was created" : `${n2(g)} SOL`}.` : g === null ? `${n2(i.raisedSol)} SOL raised so far. This site could not read the raise that completes the curve.` : `${n2(i.raisedSol)} of ${n2(g)} SOL raised so far.`;
    return R("on-curve", "On the curve, waiting for graduation", `${raised} Trading fees collect in the burn pool, but nothing can burn before the curve graduates and its pool is registered. A seed gift to the burn pool does not count toward graduation.`);
  }
  const l = i.latest;
  if (!l || l.status === "nothing" || l.status === "void" || (l.units === 0 && l.status !== "confirmed")) return R("awaiting-event", "Pool verified, waiting for a qualifying reading", l ? `The latest reading${l.readingDate ? ` (${l.readingDate})` : ""} counted no units, so nothing was due. The next burn needs a reading with at least one unit.` : "No reading has been published since the pool was verified. The first burn needs a reading with at least one unit.");
  if (l.status === "skipped" && /floor/i.test(l.skippedReason ?? "")) return R("below-floor", "Reading recorded, but the spend was below the spend floor", `The reading${l.readingDate ? ` of ${l.readingDate}` : ""} counted ${unitsText(l.units)}. The rule's spend came in under the spend floor set at launch, so nothing was bought and the burn pool kept the SOL.`);
  if (l.status === "planned" || l.status === "sending" || l.status === "pending-pair" || (l.status === "skipped" && !/floor/i.test(l.skippedReason ?? ""))) {
    const why = l.waitReason ?? l.skippedReason ?? (l.status === "pending-pair" ? "both coins of the pair need a registered pool first" : l.status === "sending" ? "the transaction is being sent" : "the next call to the program has not happened yet");
    return R("deferred", "Burn due, but on hold", `A reading with ${unitsText(l.units)} is due, and the burn is on hold. The recorded reason is: ${why}.`);
  }
  if (l.status === "confirmed") {
    const failed = (l.checks ?? []).length > 0;
    if (failed) return R("burned", "Burned, but the recheck failed", `The latest burn went through, but working it out again does not match: ${(l.checks ?? []).join("; ")}.`, false);
    if (l.verified) return R("burned", "Burned and verified", `The latest burn went through${l.burned ? ` and burned ${l.burned} tokens` : ""}. This site worked out its rule arithmetic and memo again, and they match. The check page fetches the source again in your browser.`, true);
    return R("burned", "Burned, not yet rechecked", "The latest burn went through. This site has not worked it out again yet.", null);
  }
  return R("deferred", "Burn due, but on hold", `The latest receipt's status is "${l.status}".${l.skippedReason ? ` The recorded reason is: ${l.skippedReason}.` : ""}`);
}

/** From the app's status.json (TokenStatusJson) and its receipts. */
export function readinessFromStatus(s: { status: string; market?: { phase: "curve" | "migrating" | "graduated" | null; curve: { raised: string; threshold: string } | null } | null; program?: { initialized: boolean; pool: { registered: boolean } } | null } | null, receipts: { status: string; units: number; skippedReason: string | null; waitReason: string | null; settledAt: string; readingDate?: string | null; burned?: string | null; verify?: { verified: boolean; checks: string[] } }[]): Readiness {
  if (!s || s.status === "draft") return readinessOf({ launched: false, phase: null, raisedSol: null, poolVerified: null, latest: null });
  const latest = [...receipts].sort((a, b) => (a.settledAt < b.settledAt ? 1 : -1))[0] ?? null;
  const c = s.market?.curve ?? null;
  return readinessOf({
    launched: true, phase: s.market?.phase ?? null, raisedSol: c ? Number(c.raised) : null, graduationSol: c && Number(c.threshold) > 0 ? Number(c.threshold) : undefined,
    poolVerified: s.program ? (s.program.initialized ? s.program.pool.registered : false) : null,
    latest: latest ? { status: latest.status, units: latest.units, skippedReason: latest.skippedReason, waitReason: latest.waitReason, checks: latest.verify?.checks, verified: latest.verify?.verified, burned: latest.burned ?? null, readingDate: latest.readingDate ?? null } : null,
  });
}

/**
 * FIVE DISTINCT DATA STATES (ChatGPT chat audit 6, A5, 2026-10-12: "About to graduate" said "No coin is past half its bonding curve. This
 * site does not read curve progress, so this list stays empty." The second sentence cannot establish the first). Every list or reading
 * that can be missing says which of these it is, in its own sentence, and never shows "unavailable" as "none":
 *
 *   loading      the read has not answered yet
 *   empty        the read answered, and nothing matches
 *   unavailable  this site does not read it (not connected), so nothing can be said either way
 *   stale        the last good read is older than its freshness window
 *   error        the read was tried and failed
 *
 * Pure and client-safe; website-13's grid, tabs and cards use these words (curveProgressSentence for "About to graduate").
 */
export type DataState = "loading" | "empty" | "unavailable" | "stale" | "error";
export const DATA_STATES: DataState[] = ["loading", "empty", "unavailable", "stale", "error"];
const hhmm = (iso: string | null | undefined): string | null => {
  if (!iso || Number.isNaN(Date.parse(iso))) return null;
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
};
/** One sentence for a data state. `what` names the data in words ("curve progress", "the burn history"); `empty` says what none means. */
export function dataStateSentence(state: DataState, what: string, o: { empty?: string; readAt?: string | null } = {}): string {
  const What = what.charAt(0).toUpperCase() + what.slice(1);
  const at = hhmm(o.readAt);
  switch (state) {
    case "loading": return `Reading ${what}.`;
    case "empty": return o.empty ?? `${What} was read, and there is nothing to show.`;
    case "unavailable": return `${What} is unavailable on this site, so this cannot say whether anything matches.`;
    case "stale": return at ? `${What} was last read on ${at} Denver time and may be out of date.` : `${What} may be out of date.`;
    case "error": return `${What} could not be read just now. Try again in a moment.`;
  }
}
/** "About to graduate": what the tab says in each state (never "no coin" when progress is not read). */
export function curveProgressSentence(state: DataState, o: { readAt?: string | null } = {}): string {
  if (state === "unavailable") return "Curve progress is unavailable on this site, so this list cannot show which coins are close to graduating. Every coin and its receipts can still be viewed.";
  return dataStateSentence(state, "curve progress", { empty: "No coin is past half its curve right now.", readAt: o.readAt });
}
