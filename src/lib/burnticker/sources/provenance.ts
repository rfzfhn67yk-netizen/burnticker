import { CROSS_LABEL, SETTLED_ON, crossIdOf } from "@/lib/burnticker/sources/gameSettle";
import { LEAGUES, type LeagueId } from "@/lib/burnticker/sources/espn";

/**
 * WHERE A SPORTS RULE'S DATA COMES FROM, IN WORDS GENERATED FROM THE RESOLVER (ChatGPT launch audit 5, L05, 2026-10-11: the exact-market
 * footer said team coins "run on the ESPN scoreboard" and Browse cards named ESPN as first-party, while the resolver reads no ESPN data).
 * Four roles, kept apart because they fail differently:
 *
 *   discovery     how the wizard finds teams and games (the static team table; the schedule below)
 *   schedule      the next games shown on the picker — the league's own free feed (MLB, NHL, NBA) or TheSportsDB under its licence;
 *                 when it cannot be read, only the "next game" line is missing: settlement does not use this read
 *   settlement    gameSettle.ts PRIMARY A / B: the game's on-chain payout where a Polymarket moneyline market exists, else
 *                 TheSportsDB's licensed final score
 *   confirmation  a second, independent operator: the league's official feed where free, the payout and the licensed final confirming
 *                 each other, or a second licensed provider
 *
 * Every launch-flow sentence about sports provenance comes from here; the labels themselves come from gameSettle.ts (SETTLED_ON,
 * CROSS_LABEL), so a change of resolver changes the copy. ESPN appears only as a plain human link on a game row (never fetched).
 * Client-safe.
 */
const OFFICIAL_FEEDS = (["mlb", "nhl", "nba"] as LeagueId[]).map((l) => CROSS_LABEL[crossIdOf(l)]);
const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} or ${xs[xs.length - 1]}`);

export const SPORTS_PROVENANCE = {
  discovery: "Burnticker's own team table for every league it covers",
  schedule: `the league's own free schedule for MLB, the NHL and the NBA, and TheSportsDB's licensed feed for other leagues`,
  settlement: `${SETTLED_ON["on-chain payout"]} when Polymarket lists a market for it, and otherwise ${SETTLED_ON.TheSportsDB} from TheSportsDB`,
  confirmation: `a second, independent source, such as ${list(OFFICIAL_FEEDS)}`,
  confirmationOther: `For other leagues, the on-chain payout and the licensed score confirm each other, or ${CROSS_LABEL["apisports.games"]} does.`,
  noEspn: "Burnticker reads no ESPN data.",
} as const;

/** The chip on sports cards (venueLabel). */
export const SPORTS_CHIP = "On-chain payout · league's official feed";
/** The settlement source name a sports Browse card shows (sourceName). */
export const SPORTS_SOURCE_NAME = "On-chain payout or licensed final score · first-party";

/** One sentence for the exact-market and team-picker footers. */
export function sportsProvenanceLine(): string {
  return `Team coins and matchups settle each game on ${SPORTS_PROVENANCE.settlement}. ${sportsConfirmationLine()} Schedules come from ${SPORTS_PROVENANCE.schedule}. ${SPORTS_PROVENANCE.noEspn}`;
}
/** Who must agree before a game counts, in two sentences. */
export function sportsConfirmationLine(): string {
  return `A second, independent source must agree, such as ${list(OFFICIAL_FEEDS)}. ${SPORTS_PROVENANCE.confirmationOther}`;
}

/** A league's schedule source and its confirmation source, in words. */
export function leagueProvenance(league: LeagueId): { schedule: string; confirmation: string } {
  const cross = crossIdOf(league);
  return { schedule: cross === "apisports.games" ? "TheSportsDB (licensed)" : `${CROSS_LABEL[cross]} (free)`, confirmation: CROSS_LABEL[cross] };
}

/**
 * L05: a schedule that could not be read is a DISPLAY problem, never a settlement one. The plain sentence for the picker, and the
 * technical detail kept apart (shown behind a disclosure, never as the sentence itself).
 */
export function scheduleProblem(league: LeagueId, kind: "needs-licence" | "unreadable", detail: string | null = null): { line: string; detail: string | null } {
  const label = LEAGUES[league]?.label ?? league;
  const src = leagueProvenance(league).schedule.replace(/ \((free|licensed)\)$/, "");
  return kind === "needs-licence"
    ? { line: `${label}'s schedule comes from TheSportsDB's licensed feed, which is not linked on this host: teams are listed without their next game.`, detail }
    : { line: `${label}'s next games could not be read from ${src} just now: teams are listed without their next game. This affects only the schedule shown here; settlement does not use this read.`, detail };
}
