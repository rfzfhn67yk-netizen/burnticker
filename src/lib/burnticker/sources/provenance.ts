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
 *   confirmation  a second, independent operator where one can read the game: the league's official feed where free, the payout and the
 *                 licensed final confirming each other, or a second licensed provider. Owner 2026-10-14: a game no second source can read
 *                 (no Polymarket market, no league feed) settles on TheSportsDB alone once its final has stood 12 hours (SINGLE_SOURCE_LINE).
 *                 Owner 2026-10-16 and 2026-10-18: a single-game coin burns once two sources agree, else once one source shows the same final twice (GAME_BURN_LINE)
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
  confirmationOther: "For other leagues, the on-chain payout and the licensed score must agree when both exist.",
  // walkthrough snag 15: a rule's series name starts with "espn", an older label; say that instead of a flat denial next to it
  noEspn: "Some rule names start with espn, an older label. ESPN is not a source for any result.",
} as const;

/** The chip on sports cards (venueLabel). */
export const SPORTS_CHIP = "On-chain payout · league's official feed";
/** The settlement source name a sports Browse card shows (sourceName). */
export const SPORTS_SOURCE_NAME = "On-chain payout or licensed final score · first-party";

/** One sentence for the exact-market and team-picker footers. */
export function sportsProvenanceLine(): string {
  // HS-38 (hourly run 6): the "espn" label note moved to the docs page, beside the source list (SPORTS_PROVENANCE.noEspn)
  return `Team coins and matchups settle each game on ${SPORTS_PROVENANCE.settlement}. ${sportsConfirmationLine()} Schedules come from ${SPORTS_PROVENANCE.schedule}.`;
}
/** Owner 2026-10-14 ("TheSportsDB should be enough to validate"): what happens to a game no second source can read. */
export const SINGLE_SOURCE_LINE = "A game with no Polymarket market and no league feed settles on TheSportsDB alone, once its final score has stood unchanged for 12 hours.";
/**
 * Owner 2026-10-16: ONE burn schedule for every single-game coin (a game coin, and both coins of two teams in one game). The burn waits
 * until two independent sources agree on the final, or once one source has shown the same final twice a few minutes apart
 * (gameSettle.ts gameSchedule); every source that answers must agree. The on-chain settlement counts as one source.
 */
export { GAME_AGREE_LINE, GAME_BURN_LINE } from "@/lib/burnticker/gameCoin";
/** Where a game coin's result comes from, in the order the reading names them (gameSettle.ts: the first score read, the on-chain settlement last). */
export const GAME_SETTLEMENT = "a licensed final score from TheSportsDB, the league's own feed where it has one, or the game's on-chain settlement where Polymarket lists a market";
/** Who must agree before a team coin's game counts, in three sentences (a game coin's own schedule is said only on game coins: GAME_BURN_LINE). */
export function sportsConfirmationLine(): string {
  return `Where a second source can read the game, such as ${list(OFFICIAL_FEEDS)}, it must agree. ${SPORTS_PROVENANCE.confirmationOther} ${SINGLE_SOURCE_LINE}`;
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
    // qa-12 L4: the missing key is said plainly (the key's name stays in `detail`, behind a disclosure)
    ? { line: `${label}'s schedule is not available on this site right now, so teams are shown without their next game.`, detail }
    : { line: `${label}'s next games could not be read from ${src} just now, so teams are shown without their next game. This only affects the schedule shown here: settlement does not use this read.`, detail };
}
