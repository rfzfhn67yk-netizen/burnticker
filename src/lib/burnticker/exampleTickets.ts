import type { LaunchType } from "@/lib/burnticker/launchAvailability";

/**
 * EXAMPLE COIN TICKETS (website-17, creator benefits item 7; owner, 2026-10-12: "just show them as examples for now", "no weather").
 * Coins nobody has created (six at first, eight since the two sports tickets of 2026-10-19), each tagged "Example, not a real coin". They are not launchable templates: a ticket whose shape the
 * wizard can build today opens that wizard path with what it can fill in, and says plainly what it cannot; every other ticket says
 * "Not offered yet." Each names its source by what it does and by its id: a catalogue id from config/burnticker/sources.json, or the
 * Polymarket adapter (oracle id "polymarket"), which reads a market's on-chain payout and has no catalogue entry of its own. The jobs
 * ticket has no source in the catalogue, so it names none and is not offered.
 *
 * website-18 (the owner, 2026-10-12: "example tickets should have less info, be more brief in the description"): a card shows the
 * ticker, the name, one short rule sentence, the source in two or three words and the example tag. The detail stays only where a ticket
 * opens the wizard (its link line); the reason a ticket is not offered is kept here for the record; the no-affiliation lines are said
 * once for the section (EXAMPLES_AFFILIATION).
 *
 * Public figures and companies are named only to say what a market or a feed is about, and no ticker implies an endorsement. There is
 * no Truth Social adapter: the post-count tickets settle only on Polymarket's on-chain payouts. Client-safe;
 * test/burntickerCreatorBenefits.test.ts holds every sentence to the copy lint and every source id to the catalogue.
 */

export type ExampleSource = { kind: "catalogue"; id: string } | { kind: "oracle"; id: "polymarket" };

export interface ExampleTicket {
  ticker: string;
  name: string;
  /** the rule in one short sentence, under about twelve words */
  rule: string;
  /** the source, named by what it does in two or three words */
  sourceLine: string;
  /** the source id (catalogue or adapter); null when no source exists for it */
  source: ExampleSource | null;
  /** the wizard path the shape belongs to (for this site's availability) */
  type: LaunchType;
  /** a wizard path that exists today, with what it can fill in; null when nothing on this site builds it */
  opens: { href: string; line: string; also?: { label: string; href: string }[] } | null;
  /** the plain "Not offered yet." sentence and its reason (kept for the record; the card shows only "Not offered yet."); null when `opens` is set */
  notOffered: string | null;
  /** the no-affiliation line, on tickets that name a person, a company or another project (the section shows EXAMPLES_AFFILIATION once) */
  affiliation: string | null;
}

export const EXAMPLE_TAG = "Example, not a real coin";
export const EXAMPLES_HEADING = "Example tickets";
/** website-18: the launch page's one closed disclosure at the bottom that holds the creator benefits and these examples. */
export const EXAMPLES_AND_BENEFITS_LABEL = "Examples and what creators get";
export const EXAMPLES_INTRO = "These coins do not exist. They show what a ticket could look like. None of them can be launched as shown.";
/** website-18: one line for the whole section instead of one per card. */
export const EXAMPLES_AFFILIATION = "Examples that name a person, a company or a project are not affiliated with them.";
export const SOURCE_LABEL = "Source";
export const NOT_OFFERED = "Not offered yet.";
export const LAUNCH_STATE_UNREAD = "This site's launch state was not read.";
export const ALSO_WITH = "Also with";

export const EXAMPLE_TICKETS: readonly ExampleTicket[] = [
  {
    ticker: "TSLAvAAPL", name: "Tesla vs Apple, weekly", type: "derby",
    rule: "Burns every week Tesla's stock beats Apple's.",
    sourceLine: "Pyth stock feeds", source: { kind: "catalogue", id: "pyth.equity" },
    opens: null, notOffered: `${NOT_OFFERED} The Coin vs Coin screen lists crypto feeds only, and it builds daily windows.`,
    affiliation: "This example is not affiliated with Tesla or Apple.",
  },
  {
    ticker: "SOLvETH", name: "SOL vs ETH, weekly", type: "derby",
    rule: "Burns every week SOL beats ETH.",
    sourceLine: "Pyth crypto feeds", source: { kind: "catalogue", id: "pyth.crypto" },
    opens: {
      href: "/burnticker/launch?derby=1&a=SOL&b=ETH",
      line: "Opens Coin vs Coin with SOL and ETH filled in. That screen builds daily windows, so the weekly version is not offered yet.",
      also: [{ label: "BTC vs ETH", href: "/burnticker/launch?derby=1&a=BTC&b=ETH" }, { label: "BONK vs WIF", href: "/burnticker/launch?derby=1&a=BONK&b=WIF" }],
    },
    notOffered: null,
    affiliation: "This example is not affiliated with Solana, Ethereum or any other project.",
  },
  {
    ticker: "JOBS", name: "The jobs print", type: "feeds",
    rule: "Burns once if payrolls beat the month before.",
    sourceLine: "The jobs report", source: null,
    opens: null, notOffered: `${NOT_OFFERED} The source catalogue has no feed for the payrolls number.`,
    affiliation: null,
  },
  {
    ticker: "TRUTHPOSTS", name: "Truth Social posts, one week", type: "markets",
    rule: "Burns once if the week's post count lands in range.",
    sourceLine: "Polymarket on-chain payout", source: { kind: "oracle", id: "polymarket" },
    opens: { href: "/burnticker/launch?template=polymarket-oneshot", line: "Opens the market search. Search for the week's post-count market and pick one range." },
    notOffered: null,
    affiliation: "This example is not affiliated with Donald Trump, Truth Social or Polymarket.",
  },
  {
    ticker: "POSTS", name: "Trump vs Elon posts, weekly", type: "pairs",
    rule: "Burns every week Trump posts more than Elon.",
    sourceLine: "Polymarket on-chain payouts", source: { kind: "oracle", id: "polymarket" },
    opens: null, notOffered: `${NOT_OFFERED} A pair that compares two different markets cannot be built on this site.`,
    affiliation: "This example is not affiliated with Donald Trump, Elon Musk, Truth Social, X or Polymarket.",
  },
  {
    ticker: "WEEKEND", name: "Box-office weekend", type: "pairs",
    rule: "Burns when its film tops the weekend box office.",
    sourceLine: "Polymarket on-chain payout", source: { kind: "oracle", id: "polymarket" },
    opens: null, notOffered: `${NOT_OFFERED} Without a Polymarket market for that weekend's films it would refuse to launch, because no other box-office publisher is in the catalogue as a source.`,
    affiliation: "This example is not affiliated with any film, studio or Polymarket.",
  },
  // owner 2026-10-19: two sports tickets, on the NBA ("more fans"). A team for one season (the team path opens on the league with the team
  // picked, the same link a league page's team row uses: leagues.ts launchHref; /v1/sports/teams lists the NBA), and a rivalry pair over
  // every game between two teams this season (the pair path's rivalry series, guidedLaunch.ts isMeetingsSelector; a link cannot pick the
  // two teams yet, so its line says so). Owner: the 76ers and the Celtics.
  {
    ticker: "SIXERS", name: "Philadelphia 76ers, one season", type: "team",
    rule: "Each 76ers win burns a share; retires when the season ends.",
    sourceLine: "NBA official feed", source: { kind: "catalogue", id: "nba.cdn" },
    opens: { href: "/burnticker/launch?league=nba&team=PHI", line: "Opens the team path on the NBA with the 76ers picked. Choose this season there." },
    notOffered: null,
    affiliation: "This example is not affiliated with the Philadelphia 76ers or the NBA.",
  },
  {
    ticker: "PHIvBOS", name: "76ers vs Celtics, one season", type: "matchup",
    rule: "Each game between them, the loser's pool burns the winner.",
    sourceLine: "NBA official feed", source: { kind: "catalogue", id: "nba.cdn" },
    opens: { href: "/burnticker/launch?template=matchup", line: "Opens the pair path. Pick the NBA, the 76ers and the Celtics, then every game between them. A link cannot fill in the two teams yet." },
    notOffered: null,
    affiliation: "This example is not affiliated with the Philadelphia 76ers, the Boston Celtics or the NBA.",
  },
];

/** Every sentence a ticket carries (the tests lint each one). */
export function exampleStrings(e: ExampleTicket): string[] {
  return [e.name, e.rule, e.sourceLine, e.opens?.line ?? "", e.notOffered ?? "", e.affiliation ?? ""].filter(Boolean);
}
