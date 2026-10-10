/**
 * WHICH VENUES THIS HOST USES (2026-10-10, decisions recorded in docs/burnticker/ui-conventions.md § Venues).
 *
 * KALSHI — `BURNTICKER_KALSHI_ENABLED`, DEFAULT OFF. Kalshi's Developer Agreement limits API use to a member's own trading and forbids
 * caching or sharing its data with third parties without written authorization; its Data Terms forbid using Kalshi Data to settle
 * products. Kalshi stays behind this switch for an eventual written consent. Off (the default):
 *   · the public API's Kalshi routes (/kalshi/search, /kalshi/events, /kalshi/teams, /kalshi/categories) answer 503 "venue unavailable"
 *   · back-tests and launch bundles of a rule with oracle "kalshi" are refused (503)
 *   · Kalshi display reads (series titles, the market-implied chance) are not made by the app or the keeper's page publish
 *   · the keeper reads Kalshi ONLY for coins already registered with a Kalshi rule, logging a warning per read
 *   · Browse, the universal search and Any market list no Kalshi source; no default copy names Kalshi
 * Team coins and matchups never depend on it: they run on the ESPN scoreboard with a second cross-read (sources/espn.ts).
 *
 * POLYMARKET DISCOVERY — `BURNTICKER_POLYMARKET_DISCOVERY_ENABLED`, DEFAULT ON, NO MARKET DATA. Creators find Polymarket markets
 * (question text, outcomes, end date, resolution rules, conditionId) through Gamma; NO price, odds, volume or liquidity is rendered or
 * returned anywhere — that keeps Burnticker out of "market data distributor" territory (test/burntickerSearch.test.ts scans the payloads).
 * Off: the Polymarket search, back-test, Browse group, elections flow and search suggestions are withheld. SETTLEMENT is unaffected
 * either way: the keeper reads the Conditional Tokens payout vector on Polygon.
 */
export const KALSHI_FLAG = "BURNTICKER_KALSHI_ENABLED";
export const POLYMARKET_DISCOVERY_FLAG = "BURNTICKER_POLYMARKET_DISCOVERY_ENABLED";

type Env = Readonly<Record<string, string | undefined>>;
const on = (v: string | undefined) => ["1", "true", "on", "yes"].includes((v ?? "").trim().toLowerCase());
const off = (v: string | undefined) => ["0", "false", "off", "no"].includes((v ?? "").trim().toLowerCase());

/** Kalshi: off unless explicitly enabled. */
export function kalshiEnabled(env: Env = process.env): boolean { return on(env[KALSHI_FLAG]); }
/** Polymarket discovery (no market data): on unless explicitly disabled. */
export function polymarketDiscoveryEnabled(env: Env = process.env): boolean { return !off(env[POLYMARKET_DISCOVERY_FLAG]); }

export const KALSHI_UNAVAILABLE = `This venue is not enabled on this host (${KALSHI_FLAG} is off): venue unavailable. First-party feeds and the ESPN scoreboard still work.`;
export const POLYMARKET_UNAVAILABLE = `Polymarket discovery is not enabled on this host (${POLYMARKET_DISCOVERY_FLAG}=0). Settlement of existing coins reads the on-chain payout regardless.`;

export interface VenueFlags { kalshi: boolean; polymarket: boolean; feeds: boolean }
export const venueFlagsFromEnv = (env: Env = process.env): VenueFlags => ({ kalshi: kalshiEnabled(env), polymarket: polymarketDiscoveryEnabled(env), feeds: true });

/** Keys that are market data (prices, odds, volume, liquidity) — never in a discovery payload. Used by the payload scrubber and its test. */
export const MARKET_DATA_KEY = /^(?:.*price.*|.*odds.*|.*volume.*|.*liquidity.*|implied.*|best_?(?:bid|ask)|(?:yes|no)_?(?:bid|ask).*|bid|ask|spread|.*chance.*)$/i;

/** Drops every market-data key from a JSON-shaped value, recursively (defence in depth on discovery payloads). */
export function scrubMarketData<T>(v: T): T {
  if (Array.isArray(v)) return v.map(scrubMarketData) as unknown as T;
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([k]) => !MARKET_DATA_KEY.test(k)).map(([k, x]) => [k, scrubMarketData(x)])) as T;
  return v;
}
