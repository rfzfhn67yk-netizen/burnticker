import type { BurnRule } from "@/lib/burnticker/rules";
import { LEAGUES, parseEspnSeries, seasonLabel, type LeagueId, type Sport } from "@/lib/burnticker/sources/espn";

/**
 * THE SEASONS PAGE (2026-10-10; the owner rejected one table ranking NHL, MLB, NBA and NFL coins together): one SCOREBOARD CARD PER
 * LEAGUE AND SEASON ("NHL 2026–27", "MLB 2026 postseason"), each ranking only that league's team coins of that window by receipts,
 * then by the share of supply burned. During the season the top row reads "most receipts so far"; "champion" appears only once the
 * league's season has ended for every coin on the card. Across leagues there is never an ordering — only a count ("yesterday across
 * all leagues: N coins burned"). Date ranges, never "week N". Pure: the page feeds it the registry's rows.
 */

export interface SeasonCoinInput {
  ticker: string; mint: string; rule: BurnRule;
  /** Confirmed burns: the settlement date of each (ISO). */
  burns: readonly { settledAt: string }[];
  /** Share of the initial supply burned so far, percent. */
  burnedPct: number;
  /** The rule end the keeper recorded (registry.ruleEnd), or null while the window reads. */
  ended: boolean;
}
export interface SeasonRow { rank: number; ticker: string; mint: string; outcome: string; receipts: number; burnedPct: number; lastBurnAt: string | null }
export interface SeasonBoard {
  key: string; league: LeagueId; leagueLabel: string; sport: Sport;
  /** "NHL 2026–27", "MLB 2026 postseason", "Premier League · perpetual and next-N coins" */
  label: string; window: "season" | "post" | "other";
  /** The date range the receipts cover ("" when there are none yet). */
  from: string | null; to: string | null;
  ended: boolean;
  /** "most receipts so far" during the window; "champion" only after it ended for every coin here; null with no receipt yet. */
  leader: { ticker: string; title: "most receipts so far" | "champion" } | null;
  rows: SeasonRow[];
}

/** The scoreboard cards: grouped by league + window + season, each ranked on its own. Boards are ordered by sport, league, season. */
export function seasonBoards(coins: readonly SeasonCoinInput[]): SeasonBoard[] {
  const groups = new Map<string, { league: LeagueId; window: SeasonBoard["window"]; year: number | null; coins: SeasonCoinInput[] }>();
  for (const c of coins) {
    const e = c.rule.oracle === "catalogue" && c.rule.series ? parseEspnSeries(c.rule.series) : null;
    if (!e || e.kind !== "team") continue;
    const w = e.window.kind === "season" || e.window.kind === "post" ? e.window.kind : "other";
    const year = e.window.kind === "season" || e.window.kind === "post" ? e.window.year : null;
    const key = `${e.league}:${w}:${year ?? "-"}`;
    const g = groups.get(key) ?? { league: e.league, window: w, year, coins: [] };
    g.coins.push(c); groups.set(key, g);
  }
  const boards: SeasonBoard[] = [];
  for (const [key, g] of groups) {
    const L = LEAGUES[g.league];
    const rows = g.coins.map((c) => {
      const e = parseEspnSeries(c.rule.series!) as Extract<ReturnType<typeof parseEspnSeries>, { kind: "team" }>;
      const dates = c.burns.map((b) => b.settledAt).sort();
      return { ticker: c.ticker, mint: c.mint, outcome: e.outcome, receipts: c.burns.length, burnedPct: c.burnedPct, lastBurnAt: dates[dates.length - 1] ?? null, first: dates[0] ?? null };
    }).sort((a, b) => b.receipts - a.receipts || b.burnedPct - a.burnedPct || a.ticker.localeCompare(b.ticker));
    const all = rows.flatMap((r) => [r.first, r.lastBurnAt]).filter((x): x is string => !!x).sort();
    const ended = g.window !== "other" && g.coins.length > 0 && g.coins.every((c) => c.ended);
    const label = g.window === "season" ? `${L.label} ${seasonLabel(g.league, g.year!)}` : g.window === "post" ? `${L.label} ${seasonLabel(g.league, g.year!)} postseason` : `${L.label} · perpetual and next-N coins`;
    const top = rows[0];
    boards.push({
      key, league: g.league, leagueLabel: L.label, sport: L.sport, label, window: g.window, from: all[0]?.slice(0, 10) ?? null, to: all[all.length - 1]?.slice(0, 10) ?? null, ended,
      leader: top && top.receipts > 0 && g.window !== "other" ? { ticker: top.ticker, title: ended ? "champion" : "most receipts so far" } : null,
      rows: rows.map((r, i) => ({ rank: i + 1, ticker: r.ticker, mint: r.mint, outcome: r.outcome, receipts: r.receipts, burnedPct: r.burnedPct, lastBurnAt: r.lastBurnAt })),
    });
  }
  const sportOrder = ["baseball", "basketball", "football", "hockey", "soccer"];
  return boards.sort((a, b) => sportOrder.indexOf(a.sport) - sportOrder.indexOf(b.sport) || a.leagueLabel.localeCompare(b.leagueLabel) || b.key.localeCompare(a.key));
}

/** The only cross-league line: how many coins (any league, any rule) burned on the given UTC day. A count, never an ordering. */
export function coinsBurnedOn(coins: readonly Pick<SeasonCoinInput, "burns">[], day: string): number {
  return coins.filter((c) => c.burns.some((b) => b.settledAt.slice(0, 10) === day)).length;
}

/** "Oct 1 – Oct 10, 2026" (a date range; the page never says "week"). */
export function dateRange(from: string | null, to: string | null): string {
  if (!from) return "no receipts yet";
  const f = (d: string, year: boolean) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", ...(year ? { year: "numeric" } : {}), timeZone: "UTC" });
  return !to || to === from ? f(from, true) : `${f(from, from.slice(0, 4) !== to.slice(0, 4))} – ${f(to, true)}`;
}
