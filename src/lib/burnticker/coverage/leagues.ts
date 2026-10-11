import { LEAGUES, teamsOf, type LeagueId, type Sport } from "@/lib/burnticker/sources/espn";
import type { SourceEntry } from "@/lib/burnticker/catalogue";

/**
 * PER-LEAGUE COVERAGE (2026-10-10, final sports sourcing): ESPN's scoreboard only lists the games. Each league's games settle on
 *   primary A  the game's on-chain payout (polymarket.gamepayout) where a moneyline market exists,
 *   primary B  TheSportsDB v2, commercial licence (thesportsdb.v2; needs BURNTICKER_THESPORTSDB_KEY) for every other game,
 * confirmed by the league's official feed (MLB StatsAPI, NHL, NBA cdn) or, where no official feed exists, API-Sports (needs
 * BURNTICKER_APISPORTS_KEY). A league whose only cross-read needs a key that is not set is "cross-read missing" — listed, refused at
 * creation, never dropped. The table states the requirement statically (no host's keys leak into the committed document).
 */
export interface LeagueCoverage {
  id: LeagueId; label: string; sport: Sport; teams: number; draws: boolean;
  primaryA: string | null; primaryB: { id: string; needsKey: string | null } | null;
  crossRead: { id: string; operator: string; needsKey: string | null } | null;
  verdict: "settleable" | "settleable with a key" | "cross-read missing" | "no primary";
}
type Native = { id: string; operator: string; fact: { id: string }; leagues?: string[]; launchable: boolean; readable: boolean; sameOperator?: boolean; settlement?: boolean; needsKey?: string };

export function leagueCoverage(entries: readonly SourceEntry[]): LeagueCoverage[] {
  const natives = entries.filter((e) => (e as { kind?: string }).kind === "native") as unknown as Native[];
  const by = (id: string) => natives.find((n) => n.id === id) ?? null;
  const A = by("polymarket.gamepayout"), B = by("thesportsdb.v2");
  const official = ["mlb.statsapi", "nhl.score", "nba.cdn"].map(by).filter((x): x is Native => !!x);
  const second = by("apisports.games");
  return (Object.keys(LEAGUES) as LeagueId[]).map((id) => {
    const L = LEAGUES[id];
    const a = A && A.launchable && A.leagues?.includes(id) ? A.id : null;
    const b = B && B.launchable && B.leagues?.includes(id) ? { id: B.id, needsKey: B.needsKey ?? null } : null;
    const off = official.find((o) => o.readable && o.leagues?.includes(id)) ?? null;
    const sec = !off && second && second.readable && second.leagues?.includes(id) ? second : null;
    const x = off ?? sec;
    const crossRead = x ? { id: x.id, operator: x.operator, needsKey: x.needsKey ?? null } : null;
    const verdict: LeagueCoverage["verdict"] = !a && !b ? "no primary" : !crossRead ? "cross-read missing" : crossRead.needsKey ? "settleable with a key" : "settleable";
    return { id, label: L.label, sport: L.sport, teams: teamsOf(id).length, draws: L.draws, primaryA: a, primaryB: b, crossRead, verdict };
  });
}

export function renderLeagueCoverage(rows: readonly LeagueCoverage[]): string[] {
  const L = ["## Per league — team coins and matchups", "",
    "ESPN's scoreboard lists the games (which, when, the next game and the record) and is never a settlement input. Each game settles on **primary A**, the game's on-chain payout where a Polymarket moneyline market exists, else **primary B**, TheSportsDB's final under its commercial licence (`BURNTICKER_THESPORTSDB_KEY`). The game is confirmed by the league's official feed, or by API-Sports where no official feed exists (`BURNTICKER_APISPORTS_KEY`). Without that key the league's cross-read is missing and its coins are refused at creation.", "",
    "| League | Sport | Teams | Draws | Primary A | Primary B | Cross-read | Verdict |", "| --- | --- | ---: | :---: | --- | --- | --- | --- |"];
  for (const r of [...rows].sort((a, b) => a.sport.localeCompare(b.sport) || a.label.localeCompare(b.label))) {
    L.push(`| ${r.label} (\`${r.id}\`) | ${r.sport} | ${r.teams} | ${r.draws ? "yes" : "—"} | ${r.primaryA ? "on-chain payout (where a market exists)" : "—"} | ${r.primaryB ? `TheSportsDB commercial${r.primaryB.needsKey ? ` (needs \`${r.primaryB.needsKey}\`)` : ""}` : "—"} | ${r.crossRead ? `${r.crossRead.id} (${r.crossRead.operator})${r.crossRead.needsKey ? ` — needs \`${r.crossRead.needsKey}\`, else missing` : ""}` : "missing"} | ${r.verdict} |`);
  }
  const keyless = rows.filter((r) => r.verdict === "settleable").length, withKey = rows.filter((r) => r.verdict === "settleable with a key").length;
  L.push("", `${keyless} of ${rows.length} leagues have a keyless official cross-read; ${withKey} need the API-Sports key for theirs. Games without a market need the TheSportsDB key in every league.`, "");
  return L;
}
