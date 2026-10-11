import { LEAGUES, teamsOf, type LeagueId, type Sport } from "@/lib/burnticker/sources/espn";
import type { SourceEntry } from "@/lib/burnticker/catalogue";

/**
 * PER-LEAGUE COVERAGE (2026-10-10, "all inclusive — really all leagues"): for every league the ESPN scoreboard adapter serves, the
 * primary (espn.scoreboard lists the league) and an independent cross-read (a native descriptor of the same fact, another operator,
 * listing the league). Both → settleable (team coins and matchups launch); no cross-read → "cross-read missing", listed honestly and
 * refused by the creation gate, never dropped.
 */
export interface LeagueCoverage { id: LeagueId; label: string; sport: Sport; teams: number; draws: boolean; primary: string | null; crossRead: { id: string; operator: string } | null; verdict: "settleable" | "cross-read missing" | "no primary" }

export function leagueCoverage(entries: readonly SourceEntry[]): LeagueCoverage[] {
  const natives = entries.filter((e) => (e as { kind?: string }).kind === "native") as unknown as { id: string; operator: string; fact: { id: string }; leagues?: string[]; launchable: boolean; readable: boolean; sameOperator?: boolean }[];
  const primary = natives.find((n) => n.id === "espn.scoreboard") ?? null;
  return (Object.keys(LEAGUES) as LeagueId[]).map((id) => {
    const L = LEAGUES[id];
    const p = primary && primary.leagues?.includes(id) ? primary : null;
    const x = natives.find((n) => n.id !== "espn.scoreboard" && n.readable && !n.sameOperator && n.fact.id === "sports.game.final-score" && n.operator !== p?.operator && n.leagues?.includes(id)) ?? null;
    return { id, label: L.label, sport: L.sport, teams: teamsOf(id).length, draws: L.draws, primary: p ? p.id : null, crossRead: x ? { id: x.id, operator: x.operator } : null, verdict: !p ? "no primary" : x ? "settleable" : "cross-read missing" };
  });
}

export function renderLeagueCoverage(rows: readonly LeagueCoverage[]): string[] {
  const L = ["## Per league — team coins and matchups", "", "Every team-sport league the ESPN scoreboard adapter serves, its independent cross-read, and the verdict. A league without a keyless cross-read is listed as **cross-read missing** and refused at creation (never dropped).", "", "| League | Sport | Teams | Draws | Primary | Cross-read | Verdict |", "| --- | --- | ---: | :---: | --- | --- | --- |"];
  for (const r of [...rows].sort((a, b) => a.sport.localeCompare(b.sport) || a.label.localeCompare(b.label))) L.push(`| ${r.label} (\`${r.id}\`) | ${r.sport} | ${r.teams} | ${r.draws ? "yes" : "—"} | ${r.primary ?? "—"} | ${r.crossRead ? `${r.crossRead.id} (${r.crossRead.operator})` : "—"} | ${r.verdict} |`);
  L.push("", `${rows.filter((r) => r.verdict === "settleable").length} of ${rows.length} leagues settleable.`, "");
  return L;
}
