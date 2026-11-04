// Shared fixture clients for the first-party source tests (ESPN scoreboard + cross-reads, NWS climate + IEM). Not a test file itself.
import { EspnClient, mlbRangeUrl, mlbTeamScheduleUrl } from "@/lib/burnticker/sources/espn";
import { NwsClient, cliListUrl, productUrl } from "@/lib/burnticker/sources/nws";
import type { FetchLike } from "@/lib/burnticker/oracle/types";
import { fx } from "./burntickerHelpers.ts";

export const ESPN_NOW = Date.parse("2026-10-10T20:00:00Z");
export type Fx = { url: string; body: unknown };
export const F = (f: string) => fx(f) as Fx;
/** Exact-URL fetch over a table (a missing URL is a 404). */
export const exactFetch = (table: Record<string, unknown>): FetchLike => async (url) => (url in table ? { ok: true, status: 200, json: async () => table[url] } : { ok: false, status: 404, json: async () => ({}) });

/** The schedule and cross-read fixtures (no ESPN): MLB StatsAPI for the Rays' 2026 and 2025 seasons and the week of Oct 10, and the day files of the Rays' postseason games. */
export const ESPN_TABLE: Record<string, unknown> = {
  [mlbTeamScheduleUrl("TB", 2026)]: F("sports/mlb.tb.2026.json").body,
  [mlbTeamScheduleUrl("TB", 2025)]: F("sports/mlb.tb.2025.json").body,
  [mlbRangeUrl("2026-10-10", "2026-10-18")]: F("sports/mlb.week.20261010.json").body,
  [mlbRangeUrl("2026-10-10", "2026-10-17")]: F("sports/mlb.week.20261010.json").body,
  ...Object.fromEntries(["20261003", "20261005", "20261007", "20261008"].map((d) => { const f = F(`espn/mlb.schedule.${d}.json`); return [f.url, f.body]; })),
};
/**
 * PRIMARY A as a fake (gameSettle.ts): a moneyline market for every Rays–Yankees game, paying the named winner (null: unresolved).
 * `tsdbKey` switches primary B on for games without a market (`marketFor` false).
 */
export function fakeGameDeps(o: { winner?: (g: { date: string }) => "Tampa Bay Rays" | "New York Yankees" | null; marketFor?: (g: { date: string }) => boolean; tsdbKey?: string | null; apiSportsKey?: string | null } = {}) {
  const winner = o.winner ?? (() => "Tampa Bay Rays"), has = o.marketFor ?? (() => true);
  const markets = new Map<string, string>();
  return {
    tsdbKey: o.tsdbKey ?? null, apiSportsKey: o.apiSportsKey ?? null,
    market: async (g: { date: string; eventId: string; home: { name: string }; away: { name: string } }) => { if (!has(g) || !/Rays|Yankees/.test(g.home.name + g.away.name)) return null; const id = `0x${g.eventId.padStart(64, "0")}`; markets.set(id, g.date); return { conditionId: id, question: `${g.away.name} vs. ${g.home.name}`, outcomes: ["Tampa Bay Rays", "New York Yankees"] as [string, string], url: `https://polymarket.com/event/mlb-${g.eventId}` }; },
    payout: async (id: string) => { const w = winner({ date: markets.get(id) ?? "" }); return w === null ? { resolved: false, outcome: null } : { resolved: true, outcome: w === "Tampa Bay Rays" ? 0 : 1 }; },
  };
}
/** Gamma: each league's championship search and the matching events (config/burnticker/fixtures/polymarket/championships.json). */
export const CHAMPIONSHIPS = (fx("polymarket/championships.json") as { search: Record<string, unknown> }).search;
export function espnFixtureClient(extra: Record<string, unknown> = {}, o: { tsdbKey?: string | null } = {}): EspnClient {
  return new EspnClient({ fetchImpl: exactFetch({ ...ESPN_TABLE, ...extra }), now: () => ESPN_NOW, minIntervalMs: 0, tsdbKey: o.tsdbKey ?? null });
}
export const CLI = fx("nws/cli.DEN.json") as { body: { "@graph": { id: string }[] }; products: Record<string, { productText: string }> };
export const IEM = fx("nws/iem.DEN.json") as { daily: Fx; cli: Fx };
export function nwsFixtureClient(extra: Record<string, unknown> = {}): NwsClient {
  const t: Record<string, unknown> = { [cliListUrl("DEN")]: CLI.body, [IEM.daily.url]: IEM.daily.body, [IEM.cli.url]: IEM.cli.body, ...extra };
  for (const [id, p] of Object.entries(CLI.products)) t[productUrl(id)] = p;
  return new NwsClient({ fetchImpl: exactFetch(t), now: () => ESPN_NOW, minIntervalMs: 0 });
}

