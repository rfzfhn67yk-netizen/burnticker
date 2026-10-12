import type { CardView } from "@/lib/burnticker/cardView";
import type { LaunchType } from "@/lib/burnticker/launchAvailability";

/**
 * EXAMPLE COIN TICKETS (website-17, creator benefits item 7; owner, 2026-10-12: "just show them as examples for now", "no weather").
 * Six coins nobody has created, drawn with the real coin card and tagged "Example, not a real coin". They are not launchable templates:
 * a ticket whose shape the wizard can build today opens that wizard path with what it can fill in, and says plainly what it cannot;
 * every other ticket says "Not offered yet." and why. Each names its source by what it does and by its id: a catalogue id from
 * config/burnticker/sources.json, or the Polymarket adapter (oracle id "polymarket"), which reads a market's on-chain payout and has no
 * catalogue entry of its own. The jobs ticket has no source in the catalogue, so it names none and is not offered.
 *
 * Public figures and companies are named only to say what a market or a feed is about; every such ticket carries a no-affiliation line,
 * and no ticker implies an endorsement. There is no Truth Social adapter and there will not be one: the post-count tickets settle only on
 * Polymarket's on-chain payouts. Client-safe; test/burntickerCreatorBenefits.test.ts holds every sentence to the copy lint and every
 * source id to the catalogue.
 */

export type ExampleSource = { kind: "catalogue"; id: string } | { kind: "oracle"; id: "polymarket" };

export interface ExampleTicket {
  ticker: string;
  name: string;
  /** the rule in one sentence */
  rule: string;
  /** the source, named by what it does */
  sourceLine: string;
  /** the source id (catalogue or adapter); null when no source exists for it */
  source: ExampleSource | null;
  /** when results come in, said as a schedule, never a date */
  next: string;
  /** the wizard path the shape belongs to (for this site's availability) */
  type: LaunchType;
  /** a wizard path that exists today, with what it can fill in; null when nothing on this site builds it */
  opens: { href: string; line: string; also?: { label: string; href: string }[] } | null;
  /** the plain "Not offered yet." sentence and its reason; null when `opens` is set */
  notOffered: string | null;
  /** the no-affiliation line, on tickets that name a person, a company or another project */
  affiliation: string | null;
}

export const EXAMPLE_TAG = "Example, not a real coin";
export const EXAMPLES_HEADING = "Example tickets";
export const EXAMPLES_INTRO = "These coins do not exist. They show what a ticket could look like. None of them can be launched as shown.";
export const EXAMPLE_PREREQUISITE = "Before a real coin's first burn, its curve has to raise its amount from buyers, the coin has to move to its Raydium pool, and that pool has to be registered and verified by the burn program.";
export const EXAMPLE_CELL = "Example";
export const EXAMPLE_WHY = "An example is not a coin, so it has no number here.";
export const NOT_OFFERED = "Not offered yet.";
export const LAUNCH_STATE_UNREAD = "This site's launch state was not read.";
export const ALSO_WITH = "Also with";

export const EXAMPLE_TICKETS: readonly ExampleTicket[] = [
  {
    ticker: "TSLAvAAPL", name: "Tesla vs Apple, weekly", type: "derby",
    rule: "Each week, the coin whose stock rose more in percentage terms spends 2% of its burn budget, and the tokens bought are burned.",
    sourceLine: "Source: Pyth's published U.S. stock feeds, read at 00:00 UTC each Monday and checked against RedStone's.",
    source: { kind: "catalogue", id: "pyth.equity" }, next: "Each Monday at 00:00 UTC",
    opens: null, notOffered: `${NOT_OFFERED} The Coin vs Coin screen lists crypto feeds only, and it builds daily windows.`,
    affiliation: "This example is not affiliated with Tesla or Apple.",
  },
  {
    ticker: "SOLvETH", name: "SOL vs ETH, weekly", type: "derby",
    rule: "Each week, the coin on the side that rose more, SOL or ETH, spends 2% of its burn budget, and the tokens bought are burned.",
    sourceLine: "Source: Pyth's published crypto feeds, read at 00:00 UTC each Monday and checked against a second feed.",
    source: { kind: "catalogue", id: "pyth.crypto" }, next: "Each Monday at 00:00 UTC",
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
    rule: "Spends 10% of its burn budget once if nonfarm payrolls come in above the month before, and the tokens bought are burned.",
    sourceLine: "Source: the Bureau of Labor Statistics employment report, on the release days BLS publishes.",
    source: null, next: "The day BLS publishes the employment report",
    opens: null, notOffered: `${NOT_OFFERED} The source catalogue has no feed for the payrolls number.`,
    affiliation: null,
  },
  {
    ticker: "TRUTHPOSTS", name: "Truth Social posts, one week", type: "markets",
    rule: "Spends 10% of its burn budget once if the week's post count settles in the chosen range, and the tokens bought are burned.",
    sourceLine: "Source: Polymarket's on-chain payout for that week's post-count market.",
    source: { kind: "oracle", id: "polymarket" }, next: "When that week's market settles on chain",
    opens: { href: "/burnticker/launch?template=polymarket-oneshot", line: "Opens the market search. Search for the week's post-count market and pick one range." },
    notOffered: null,
    affiliation: "This example is not affiliated with Donald Trump, Truth Social or Polymarket.",
  },
  {
    ticker: "POSTS", name: "Trump vs Elon posts, weekly", type: "pairs",
    rule: "Each week, the coin whose account's post-count market settles higher takes the burn.",
    sourceLine: "Source: Polymarket's on-chain payouts for the two accounts' weekly post-count markets.",
    source: { kind: "oracle", id: "polymarket" }, next: "When both weekly markets settle on chain",
    opens: null, notOffered: `${NOT_OFFERED} A pair that compares two different markets cannot be built on this site.`,
    affiliation: "This example is not affiliated with Donald Trump, Elon Musk, Truth Social, X or Polymarket.",
  },
  {
    ticker: "WEEKEND", name: "Box-office weekend", type: "pairs",
    rule: "Two coins, two films: the coin whose film tops the weekend box office takes the burn.",
    sourceLine: "Source: Polymarket's on-chain payout for that weekend's box-office market, only where one exists.",
    source: { kind: "oracle", id: "polymarket" }, next: "When that weekend's market settles on chain",
    opens: null, notOffered: `${NOT_OFFERED} Without a Polymarket market for that weekend's films it would refuse to launch, because no other box-office publisher is in the catalogue as a source.`,
    affiliation: "This example is not affiliated with any film, studio or Polymarket.",
  },
];

/** Every sentence a ticket shows (the tests lint each one). */
export function exampleStrings(e: ExampleTicket): string[] {
  return [e.name, e.rule, e.sourceLine, e.next, e.opens?.line ?? "", e.notOffered ?? "", e.affiliation ?? ""].filter(Boolean);
}

/** A ticket as the real coin card: the badge row says it is an example; market cap, holders and burned say "Example". */
export function exampleCardView(e: ExampleTicket): CardView {
  const ex = { text: EXAMPLE_CELL, why: EXAMPLE_WHY };
  return {
    id: `example-${e.ticker}`, ticker: e.ticker, name: e.name, imageUrl: null, group: "test",
    tags: [{ label: EXAMPLE_TAG, tone: "neutral" }],
    note: [EXAMPLE_PREREQUISITE, e.affiliation].filter(Boolean).join(" "),
    rule: e.rule, stated: e.sourceLine, creatorText: null, links: [],
    nextSettle: { text: e.next, why: null },
    progress: null, progressWhy: EXAMPLE_WHY,
    curve: { raised: null, of: null, pct: null, done: false, na: true, why: EXAMPLE_WHY },
    mcap: ex, holders: ex, burned: ex,
    createdAt: null, createdWhy: EXAMPLE_WHY,
    mint: null, href: null, receipt: null, receiptWhy: "An example has no receipts.",
  };
}
