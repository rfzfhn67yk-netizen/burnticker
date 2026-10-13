import { CROSS_LABEL, SETTLED_ON, countedOfficialOf, crossIdOf } from "@/lib/burnticker/sources/gameSettle";
import { LEAGUES, NBA_FEED_WORDING, type LeagueId } from "@/lib/burnticker/sources/espn";

/**
 * WHERE A SPORTS RULE'S DATA COMES FROM, IN WORDS GENERATED FROM THE RESOLVER (ChatGPT launch audit 5, L05, 2026-10-11: the exact-market
 * footer said team coins "run on the ESPN scoreboard" and Browse cards named ESPN as first-party, while the resolver reads no ESPN data).
 * Four roles, kept apart because they fail differently:
 *
 *   discovery     how the wizard finds teams and games (the static team table; the schedule below)
 *   schedule      the next games shown on the picker — the league's own free feed (MLB, NHL), the NBA's feed when it answers (it answers
 *                 HTTP 403 since 2026-10-12, espn.ts probe note), or TheSportsDB under its licence;
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
/** The official feeds counted as a confirmation today (the NBA's only while it answers: gameSettle.ts countedOfficialOf). */
const OFFICIAL_FEEDS = (["mlb", "nhl", "nba"] as LeagueId[]).map(countedOfficialOf).filter((x): x is NonNullable<typeof x> => !!x).map((id) => CROSS_LABEL[id]);
/** The NBA's schedule while its own feed does not answer: the feed when it answers, else TheSportsDB under licence. */
const NBA_SCHEDULE = NBA_FEED_WORDING;
const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} or ${xs[xs.length - 1]}`);

export const SPORTS_PROVENANCE = {
  discovery: "Burnticker's own team table for every league it covers",
  schedule: countedOfficialOf("nba") ? `the league's own free schedule for MLB, the NHL and the NBA, and TheSportsDB's licensed feed for other leagues` : `the league's own free schedule for MLB and the NHL, ${NBA_SCHEDULE} for the NBA, and TheSportsDB's licensed feed for other leagues`,
  settlement: `${SETTLED_ON["on-chain payout"]} when Polymarket lists a market for it, and otherwise ${SETTLED_ON.TheSportsDB} from TheSportsDB`,
  confirmation: `a second, independent source, such as ${list(OFFICIAL_FEEDS)}`,
  confirmationOther: `For other leagues, the on-chain payout and the licensed score confirm each other, or ${CROSS_LABEL["apisports.games"]} does.`,
  // walkthrough snag 15: a rule's series name starts with "espn", an older label; say that instead of a flat denial next to it
  noEspn: "Some rule names start with espn, an older label. ESPN is not a source for any result.",
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
  if (cross === "nba.cdn" && !countedOfficialOf(league)) return { schedule: NBA_SCHEDULE, confirmation: "the on-chain payout and the licensed final score, each confirming the other" };
  return { schedule: cross === "apisports.games" ? "TheSportsDB (licensed)" : `${CROSS_LABEL[cross]} (free)`, confirmation: CROSS_LABEL[cross] };
}

/**
 * What a card shows when a league's schedule could not be read (website-15 item 8, Claude site audit 3 item 6): this one line, on the
 * card only. The reason goes to the server log and the API's scheduleDetail, never into the page's copy.
 */
export const NEXT_GAME_UNAVAILABLE = "Next game: not available.";

/**
 * A source a creator cannot use yet, in one plain line (website-15 item 8, ChatGPT repair 4). A source that needs a key this host does
 * not have is "not configured"; any other reason is "not available". The raw reason (a key name, a schema refusal) goes behind Details.
 */
export const SOURCE_NOT_CONFIGURED = "Unavailable: this data source is not configured on this site.";
export const SOURCE_NOT_AVAILABLE = "Unavailable: this data source cannot be used for a launch yet.";
export const sourceUnavailableLine = (why: string | null | undefined): string => (/needs a key|API_KEY|not configured|licen[cs]ed key/i.test(why ?? "") ? SOURCE_NOT_CONFIGURED : SOURCE_NOT_AVAILABLE);

/**
 * L05: a schedule that could not be read is a DISPLAY problem, never a settlement one. The plain sentence for the picker, and the
 * technical detail kept apart (shown behind a disclosure, never as the sentence itself).
 */
export function scheduleProblem(league: LeagueId, kind: "needs-licence" | "unreadable", detail: string | null = null): { line: string; detail: string | null } {
  const label = LEAGUES[league]?.label ?? league;
  const src = league === "nba" && !countedOfficialOf(league) ? "the NBA's feed or TheSportsDB" : leagueProvenance(league).schedule.replace(/ \((free|licensed)\)$/, "");
  return kind === "needs-licence"
    ? { line: `${label}'s schedule comes from TheSportsDB's licensed feed, which is not linked on this host: teams are listed without their next game.`, detail }
    : { line: `${label}'s next games could not be read from ${src} just now: teams are listed without their next game. This affects only the schedule shown here; settlement does not use this read.`, detail };
}
