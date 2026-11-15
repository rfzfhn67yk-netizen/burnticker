// A fake MLB Stats API and TheSportsDB for one rivalry pair (MIL vs TB, 2026) with every request counted by endpoint. The real sports
// client reads through it, so the counts are the keeper's own reads, cache and all. Used by burntickerMlbCycleReads.test.ts. No network.
import { EspnClient as SportsClient, asMeetings, meetingsSeries, parseEspnSeries, type MeetingsSeries } from "@/lib/burnticker/sources/espn";
import { memoryFinalCheckStore, type GameDeps } from "@/lib/burnticker/sources/gameSettle";

export interface MG { pk: number; at: string; home: "MIL" | "TB"; hs: number | null; as: number | null; type: "R" | "W"; live?: boolean }
const NAME = { MIL: "Milwaukee Brewers", TB: "Tampa Bay Rays" } as const;
const ID = { MIL: "158", TB: "139" } as const;
const H = 3_600_000;
/** Three regular-season meetings and World Series games 1 to 3 final; game 4 in play (2026-10-27 00:08Z, the 10-27 incident). */
export const MEETINGS: MG[] = [
  { pk: 801, at: "2026-06-09T00:10:00Z", home: "MIL", hs: 5, as: 3, type: "R" },
  { pk: 802, at: "2026-06-10T00:10:00Z", home: "MIL", hs: 2, as: 4, type: "R" },
  { pk: 803, at: "2026-06-10T18:10:00Z", home: "MIL", hs: 6, as: 1, type: "R" },
  { pk: 901, at: "2026-10-24T00:08:00Z", home: "MIL", hs: 3, as: 2, type: "W" },
  { pk: 902, at: "2026-10-25T00:08:00Z", home: "MIL", hs: 1, as: 5, type: "W" },
  { pk: 903, at: "2026-10-26T00:08:00Z", home: "TB", hs: 4, as: 2, type: "W" },
  { pk: 904, at: "2026-10-27T00:08:00Z", home: "TB", hs: 2, as: 1, type: "W", live: true },
];
const away = (g: MG) => (g.home === "MIL" ? "TB" : "MIL");
/** The local (US) date MLB lists a game under: its start five hours back. */
const localDate = (at: string) => new Date(Date.parse(at) - 5 * H).toISOString().slice(0, 10);
const mlbRow = (g: MG) => ({
  gamePk: g.pk, gameDate: g.at, gameType: g.type, season: "2026",
  status: g.live ? { abstractGameState: "Live", detailedState: "In Progress" } : { abstractGameState: "Final", detailedState: "Final" },
  teams: { home: { team: { id: Number(ID[g.home]), name: NAME[g.home] }, score: g.hs }, away: { team: { id: Number(ID[away(g)]), name: NAME[away(g)] }, score: g.as } },
});
const mlbBody = (gs: MG[]) => ({ dates: gs.length ? [{ games: gs.map(mlbRow) }] : [] });
/** TheSportsDB v2 day listing: no league, no start time (the real one's shape), so every candidate is looked up. */
const tsdbDayRow = (g: MG) => ({ idEvent: String(g.pk), strEvent: `${NAME[g.home]} vs ${NAME[away(g)]}`, strHomeTeam: NAME[g.home], strAwayTeam: NAME[away(g)], dateEvent: localDate(g.at) });
const tsdbFull = (g: MG) => ({ ...tsdbDayRow(g), idLeague: "4424", strTimestamp: g.at.slice(0, 19), strStatus: g.live ? "IN" : "FT", intHomeScore: String(g.hs), intAwayScore: String(g.as) });

/** The endpoint a URL reads (the shape only: no key, no ids, no dates). */
export function endpointOf(url: string): string {
  const u = new URL(url);
  if (u.hostname === "statsapi.mlb.com") return u.searchParams.has("teamId") ? "mlb team season" : u.searchParams.has("startDate") ? "mlb day range (live)" : u.searchParams.has("date") ? "mlb schedule day" : "mlb other";
  if (/\/filter\/events\/day\//.test(u.pathname) || /eventsday\.php/.test(u.pathname)) return "tsdb day listing";
  if (/\/lookup\/event\//.test(u.pathname) || /lookupevent\.php/.test(u.pathname)) return "tsdb event lookup";
  return "other";
}

export function mlbWorld(games: MG[] = MEETINGS) {
  const clock = { now: Date.parse("2026-10-27T01:45:00Z") };
  const counts = new Map<string, number>();
  const fetchImpl = (async (url: string) => {
    const k = endpointOf(url); counts.set(k, (counts.get(k) ?? 0) + 1);
    const u = new URL(url);
    const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
    if (u.hostname === "statsapi.mlb.com") {
      const team = u.searchParams.get("teamId"), date = u.searchParams.get("date"), from = u.searchParams.get("startDate"), to = u.searchParams.get("endDate");
      if (team) return ok(mlbBody(games.filter((g) => ID[g.home] === team || ID[away(g)] === team)));
      if (date) return ok(mlbBody(games.filter((g) => localDate(g.at) === date)));
      if (from && to) return ok(mlbBody(games.filter((g) => localDate(g.at) >= from && localDate(g.at) <= to)));
    }
    const day = /\/filter\/events\/day\/([\d-]+)/.exec(u.pathname)?.[1];
    if (day) return ok({ events: games.filter((g) => localDate(g.at) === day).map(tsdbDayRow) });
    const id = /\/lookup\/event\/(\d+)/.exec(u.pathname)?.[1];
    if (id) return ok({ events: games.filter((g) => String(g.pk) === id).map(tsdbFull) });
    return { ok: false, status: 404, json: async () => ({}) };
  }) as never;
  const client = new SportsClient({ fetchImpl, now: () => clock.now, minIntervalMs: 0, tsdbKey: "k", apiSportsKey: null });
  /** Both sides of the pair. */
  const sides = [meetingsSeries("mlb", "MIL", "TB", 2026), meetingsSeries("mlb", "TB", "MIL", 2026)].map((id) => asMeetings(parseEspnSeries(id))! as MeetingsSeries);
  // every finished meeting's final was confirmed long ago (its FINAL CHECK record stays in games.finalChecks, as on the host)
  const finalChecks = memoryFinalCheckStore();
  for (const g of games.filter((x) => !x.live)) finalChecks.set(`mlb:${g.pk}`, { winner: g.hs! > g.as! ? "home" : "away", home: g.hs, away: g.as, at: Date.parse(g.at) + 4 * H, startsAt: g.at });
  const payouts = { all: 0, fresh: 0 };
  const deps = (): GameDeps => ({
    tsdbKey: "k", apiSportsKey: null, now: () => clock.now, liveSchedule: true, finalChecks,
    market: async (g) => ({ conditionId: `0x${g.eventId}`, question: `${g.away.name} vs ${g.home.name}`, outcomes: [g.away.name, g.home.name], url: "https://polymarket.com/x" }),
    payout: async (_id, o) => { payouts.all++; if (o?.fresh) payouts.fresh++; return { resolved: false, outcome: null }; },
  });
  const take = () => { const o = Object.fromEntries([...counts.entries()].sort()); counts.clear(); return o as Record<string, number>; };
  return { clock, client, sides, deps, finalChecks, payouts, take };
}
