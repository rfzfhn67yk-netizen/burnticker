/**
 * WHICH VENUES THIS HOST USES (2026-10-10). Kalshi's Developer Agreement limits API use to a member's own trading and forbids caching
 * or sharing its data with third parties without written authorization, and its Data Terms forbid using Kalshi Data to settle
 * products — so Kalshi is ONE venue adapter behind a switch, not the backbone. `BURNTICKER_KALSHI_ENABLED` (default on, so the owner's
 * live wizard keeps working; `0` / `false` / `off` / `no` turns it off) controls every Kalshi-facing surface of the app:
 *
 *   · the public API's Kalshi routes (/kalshi/search, /kalshi/events, /kalshi/teams, /kalshi/categories) answer 503 "venue unavailable"
 *   · back-tests and launch bundles of a rule with oracle "kalshi" are refused (503 / a launch problem)
 *   · the wizard: Team coin and Matchup pair show "venue unavailable"; Browse and Any market list no Kalshi sources
 *   · Browse (/browse) leaves Kalshi out of every category; first-party feeds and Polymarket are unaffected
 *
 * It does NOT stop the keeper from reading the settled results of coins already launched on a Kalshi rule (their receipts depend on
 * it); that is an owner decision recorded in docs/burnticker/ui-conventions.md.
 */
export const KALSHI_FLAG = "BURNTICKER_KALSHI_ENABLED";

export function kalshiEnabled(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  const v = (env[KALSHI_FLAG] ?? "").trim().toLowerCase();
  return !["0", "false", "off", "no"].includes(v);
}

export const KALSHI_UNAVAILABLE = `Kalshi is not enabled on this host (${KALSHI_FLAG}=0): venue unavailable. First-party feeds and Polymarket still work.`;

export interface VenueFlags { kalshi: boolean; polymarket: boolean; feeds: boolean }
