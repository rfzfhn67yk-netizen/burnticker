// Shared fixture clients for the first-party source tests (ESPN scoreboard + cross-reads, NWS climate + IEM). Not a test file itself.
import { EspnClient, parseGames, scheduleUrl, scoreboardUrl, tsdbUrl } from "@/lib/burnticker/sources/espn";
import { NwsClient, cliListUrl, productUrl } from "@/lib/burnticker/sources/nws";
import type { FetchLike } from "@/lib/burnticker/oracle/types";
import { fx } from "./burntickerHelpers.ts";

export const ESPN_NOW = Date.parse("2026-10-10T20:00:00Z");
export type Fx = { url: string; body: unknown };
export const F = (f: string) => fx(f) as Fx;
/** Exact-URL fetch over a table (a missing URL is a 404). */
export const exactFetch = (table: Record<string, unknown>): FetchLike => async (url) => (url in table ? { ok: true, status: 200, json: async () => table[url] } : { ok: false, status: 404, json: async () => ({}) });

export const ESPN_TABLE: Record<string, unknown> = {
  [scheduleUrl("nfl", "PHI", 2)]: F("espn/nfl.phi.schedule.json").body,
  [scoreboardUrl("nfl", "20261011")]: F("espn/nfl.scoreboard.20261011.json").body,
  [scoreboardUrl("nfl", "20261004")]: F("espn/nfl.scoreboard.20261004.json").body,
};
export const TSDB = F("espn/tsdb.phi-lar.20261004.json");
export function espnFixtureClient(extra: Record<string, unknown> = {}): EspnClient {
  const g = parseGames("nfl", F("espn/nfl.phi.schedule.json").body).find((x) => x.eventId === "401872970")!;
  return new EspnClient({ fetchImpl: exactFetch({ ...ESPN_TABLE, [tsdbUrl("123", g)]: TSDB.body, ...extra }), now: () => ESPN_NOW, minIntervalMs: 0, tsdbKey: "123" });
}
export const CLI = fx("nws/cli.DEN.json") as { body: { "@graph": { id: string }[] }; products: Record<string, { productText: string }> };
export const IEM = fx("nws/iem.DEN.json") as { daily: Fx; cli: Fx };
export function nwsFixtureClient(extra: Record<string, unknown> = {}): NwsClient {
  const t: Record<string, unknown> = { [cliListUrl("DEN")]: CLI.body, [IEM.daily.url]: IEM.daily.body, [IEM.cli.url]: IEM.cli.body, ...extra };
  for (const [id, p] of Object.entries(CLI.products)) t[productUrl(id)] = p;
  return new NwsClient({ fetchImpl: exactFetch(t), now: () => ESPN_NOW, minIntervalMs: 0 });
}

