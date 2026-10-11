import { LEAGUES, teamsOf, type LeagueId, type Sport } from "@/lib/burnticker/sources/espn";
import type { SourceEntry } from "@/lib/burnticker/catalogue";

/**
 * PER-LEAGUE COVERAGE (2026-10-10, final sports sourcing; no ESPN reads). For each league:
 *   schedule   the league's free official feed (MLB StatsAPI, NHL api-web, NBA cdn), else TheSportsDB v2 (licensed key)
 *   primary A  the game's on-chain payout (polymarket.gamepayout) where a moneyline market exists
 *   primary B  TheSportsDB v2 under its commercial licence (thesportsdb.v2; BURNTICKER_THESPORTSDB_KEY)
 *   reads      the on-chain payout and TheSportsDB confirm each other when both exist; the league's official feed is a further read
 *              where it is free; API-Sports (BURNTICKER_APISPORTS_KEY) is optional. A game needs TWO independent sources (a source check, not a second signer).
 * The table states the requirement statically (no host's keys leak into the committed document).
 */
export interface LeagueCoverage {
  id: LeagueId; label: string; sport: Sport; teams: number; draws: boolean;
  schedule: { id: string; needsKey: string | null };
  primaryA: string | null; primaryB: { id: string; needsKey: string | null } | null;
  /** The free official feed, a third read (null where none exists). */
  official: { id: string; operator: string } | null;
  /** The optional licensed further read. */
  optional: { id: string; needsKey: string | null } | null;
  /** With a market: payout + (official, else TheSportsDB). Without: TheSportsDB + (official, else API-Sports). */
  withMarket: string; withoutMarket: string;
  verdict: "settleable" | "settleable with the TheSportsDB key" | "no primary";
}
type Native = { id: string; operator: string; fact?: { id: string }; leagues?: string[]; launchable: boolean; readable: boolean; needsKey?: string };

export function leagueCoverage(entries: readonly SourceEntry[]): LeagueCoverage[] {
  const natives = entries.filter((e) => (e as { kind?: string }).kind === "native") as unknown as Native[];
  const by = (id: string) => natives.find((n) => n.id === id) ?? null;
  const A = by("polymarket.gamepayout"), B = by("thesportsdb.v2"), X = by("apisports.games");
  const officials = ["mlb.statsapi", "nhl.score", "nba.cdn"].map(by).filter((x): x is Native => !!x);
  return (Object.keys(LEAGUES) as LeagueId[]).map((id) => {
    const L = LEAGUES[id];
    const a = A && A.launchable && A.leagues?.includes(id) ? A.id : null;
    const b = B && B.launchable && B.leagues?.includes(id) ? { id: B.id, needsKey: B.needsKey ?? null } : null;
    const off = officials.find((o) => o.readable && o.leagues?.includes(id)) ?? null;
    const opt = X && X.readable && X.leagues?.includes(id) ? { id: X.id, needsKey: X.needsKey ?? null } : null;
    const tsdbKey = b?.needsKey ? ` (needs \`${b.needsKey}\`)` : "";
    const withMarket = !a ? "—" : off ? `on-chain payout + ${off.id} (no key)` : b ? `on-chain payout + TheSportsDB${tsdbKey}` : "one source only";
    const withoutMarket = !b ? "—" : off ? `TheSportsDB${tsdbKey} + ${off.id}` : opt ? `TheSportsDB${tsdbKey} + API-Sports (needs \`${opt.needsKey}\`)` : "one source only";
    const verdict: LeagueCoverage["verdict"] = !a && !b ? "no primary" : off ? "settleable" : "settleable with the TheSportsDB key";
    return { id, label: L.label, sport: L.sport, teams: teamsOf(id).length, draws: L.draws, schedule: off ? { id: off.id, needsKey: null } : { id: "thesportsdb.v2", needsKey: B?.needsKey ?? null }, primaryA: a, primaryB: b, official: off ? { id: off.id, operator: off.operator } : null, optional: opt, withMarket, withoutMarket, verdict };
  });
}

export function renderLeagueCoverage(rows: readonly LeagueCoverage[]): string[] {
  const L = ["## Per league — team coins and matchups", "",
    "No ESPN reads. A league's games come from its free official schedule (MLB StatsAPI, NHL api-web, NBA cdn), else from TheSportsDB v2 under its commercial licence (`BURNTICKER_THESPORTSDB_KEY`). Each game settles on **primary A**, its on-chain payout where a Polymarket moneyline market exists, else **primary B**, TheSportsDB's final.", "",
    "The game needs two independent sources (publishers) that agree; that is a source check, and one operator attester still signs the reading. The on-chain payout and TheSportsDB confirm each other when both exist. The league's official feed is a further read where it is free. API-Sports (`BURNTICKER_APISPORTS_KEY`) is optional.", "",
    "| League | Sport | Teams | Schedule | Game with a market | Game without a market | Verdict |", "| --- | --- | ---: | --- | --- | --- | --- |"];
  for (const r of [...rows].sort((a, b) => a.sport.localeCompare(b.sport) || a.label.localeCompare(b.label))) {
    L.push(`| ${r.label} (\`${r.id}\`)${r.draws ? " · draws" : ""} | ${r.sport} | ${r.teams} | ${r.schedule.id}${r.schedule.needsKey ? ` (needs \`${r.schedule.needsKey}\`)` : " (free)"} | ${r.withMarket} | ${r.withoutMarket} | ${r.verdict} |`);
  }
  const free = rows.filter((r) => r.verdict === "settleable").length;
  L.push("", `${free} of ${rows.length} leagues settle games that have a market with no key at all (the on-chain payout plus the league's official feed). The other ${rows.length - free} need the TheSportsDB key for their schedule and their second read. A game without a market in those leagues also needs API-Sports.`, "");
  return L;
}
