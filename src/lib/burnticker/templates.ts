/**
 * THE TWELVE CANONICAL RULE SHAPES (2026-10-10, "launch one like this"): the /burnticker/templates gallery, and where "Start from this"
 * lands in the launch flow. Each shape has an example sentence (lint-clean; test/burntickerProduct.test.ts), what settles it, and the
 * launch link. The coin and pair pages' "Launch one like this" uses `likeHref` instead: same shape, the team / race / feed re-pickable,
 * the dials copied. Client-safe.
 */
import { CANDIDATES_PAIR_SENTENCE, GAME_PAIR_SENTENCE, PAIR_BURN_SENTENCE, describeRule } from "@/lib/burnticker/describe";
import type { BurnRule } from "@/lib/burnticker/rules";
import { firstPartyRule } from "@/lib/burnticker/wizard";
import { nwsSeries, stationByCode } from "@/lib/burnticker/sources/nws";
import { DEFAULT_SHARE, pctLabel, presetRowLabel, SHARE_PRESETS } from "@/lib/burnticker/launchPresets";
import type { LaunchType } from "@/lib/burnticker/launchAvailability";
import { raceEndSentence, type DerbyUnderlying } from "@/lib/burnticker/derby/spec";
import { fightLead, fightName, fightTickers } from "@/lib/burnticker/derby/tile";
export type TemplateId = "team-season" | "team-oneshot" | "matchup" | "election-oneshot" | "election-pair" | "number-feed" | "weather" | "launch-count" | "polymarket-oneshot" | "coin-vs-coin" | "bracket" | "flippening";
/**
 * `pairLine` (review 2 F6): a template that launches a REGISTERED rivalry pair carries describe.ts PAIR_BURN_SENTENCE — the one factual
 * sentence every pair surface shares — so no example can say the losing coin burns. Two separate coins (a matchup on two separate
 * results, a bracket's fan coins) carry no pair line: nothing moves between them.
 */
export interface Template {
  id: TemplateId; title: string; example: string; settles: string; shape: "recurring" | "one-shot" | "pair"; href: string; pairLine?: string;
  /**
   * Launch audit 5 L10: where "Start from this" lands. "review" = the advertised draft exactly (the review card opens with the example's
   * rule, name and share); "choices" = a starting point, and `choices` says what is still to pick. Never "one click to the review card"
   * for a template that is not.
   */
  lands: "review" | "choices"; choices: string | null;
  /** The launch type it creates (launchAvailability.ts): the gallery and the page grey out a type this host cannot take. */
  type: LaunchType;
  /** The share the example names — the default preset of the rule's row (launchPresets.ts); test/burntickerLaunchDraft.test.ts pins it. */
  share: number;
  /** A shape only the operator can set up (a bracket is registered by the operator): the link opens the nearest creator flow. */
  operatorOnly?: string;
  /**
   * website-20 item 51: how a two-coin template's coins are linked ON THE LAUNCH PAGE TODAY. "registered" = one shared pair (winner takes
   * the burn: Coin vs Coin, the flippening); "independent" = two separate launches; "race" = two candidates in one race and "game" = two
   * teams in one game, both linked pairs since 2026-10-13 (owner: the loser's pool burns the winner; describe.ts CANDIDATES_PAIR_SENTENCE,
   * GAME_PAIR_SENTENCE).
   * The pair line is derived from this, never written by hand.
   */
  pairing?: "registered" | "independent" | "race" | "game";
  /** website-20 item 60: the link's words, saying where it lands ("Choose a team"), never a generic "Start from this". */
  cta: string;
}

/** website-20 item 51: the one sentence for two separately launched coins. */
export const INDEPENDENT_PAIR_LINE = "These are two separate coins. Each one burns from its own pool, and no SOL moves between them.";
/** The gallery's pair line, from the pairing the launch page really builds. */
export const pairLineFor = (pairing: Template["pairing"]): string | undefined => (pairing === "registered" ? PAIR_BURN_SENTENCE : pairing === "race" ? CANDIDATES_PAIR_SENTENCE : pairing === "game" ? GAME_PAIR_SENTENCE : pairing === "independent" ? INDEPENDENT_PAIR_LINE : undefined);
/**
 * website-20 item 57: what the web launcher lets the creator change for this template, said per template (the gallery used to promise
 * "Every dial stays editable until launch" for every one, though Coin vs Coin fixes its windows and a one-shot burns once).
 */
export function settingsLine(t: Pick<Template, "shape" | "type" | "id">): string {
  // audit 12 item 1: a linked pair on one result (the flippening, two candidates, one game) burns the whole pool, 100 % and nothing else
  if (t.id === "flippening") return `Fixed on the web: one reading a day at 00:00 UTC. You pick a run of 7, 14 or 30 days. The two coins are linked, so the burn uses the whole pool: ${presetRowLabel("linkedOneShot")}.`;
  // website-26 (WIRING-FEATURES item 14): the tile offers three run lengths (derby/spec.ts DERBY_RUN_PRESETS)
  if (t.type === "derby") return "Fixed on the web: one reading a day at 00:00 UTC. You pick a run of 7, 14 or 30 days and the share per burn.";
  if (t.shape === "one-shot") return SHARE_PRESETS.oneShot.length === 1 ? "It burns once, using the whole pool." : `It burns once. You pick ${presetRowLabel("oneShot")} of the pool.`;
  if (t.type === "pairs" || t.type === "matchup") return `Each coin burns once. The two coins are linked, so the coin that burns uses its whole pool and takes the other coin's: ${presetRowLabel("linkedOneShot")}.${t.type === "matchup" ? " You pick one game or the season. The season burns a share per game instead." : ""}`;
  if (t.shape === "pair") return `You pick one game or the season, and the share per burn.`;
  return `You pick the share per burn: ${RROW}.`;
}

/**
 * THE WEATHER TEMPLATE'S DRAFT, EXACTLY (L10: the gallery advertised Detroit / 1%, the station flow defaulted to Denver / 90 °F / 2%).
 * The example sentence below is generated from this rule, and "Start from this" opens the review card with this rule.
 */
export const WEATHER_TEMPLATE = { station: "DTW", metric: "high" as const, threshold: 90, share: DEFAULT_SHARE.recurring, ticker: "DTWHOT" };
export function weatherTemplateRule(): BurnRule { return firstPartyRule(nwsSeries(WEATHER_TEMPLATE.metric, WEATHER_TEMPLATE.station, WEATHER_TEMPLATE.threshold), WEATHER_TEMPLATE.share); }
const weatherText = () => describeRule(weatherTemplateRule(), { ticker: WEATHER_TEMPLATE.ticker });
/** The weather template as the wizard's draft: the rule, its pick title, the generated name and ticker, the settlement line. */
export function weatherTemplateDraft(): { rule: BurnRule; title: string; name: string; ticker: string; settlement: string } {
  const st = stationByCode(WEATHER_TEMPLATE.station)!, t = weatherText();
  return { rule: weatherTemplateRule(), title: `${st.city} daily high ≥ ${WEATHER_TEMPLATE.threshold} °F (NWS)`, name: t.name, ticker: t.ticker, settlement: "the National Weather Service's daily climate report, cross-checked against the Iowa Environmental Mesonet" };
}
const R = pctLabel(DEFAULT_SHARE.recurring), O = pctLabel(DEFAULT_SHARE.oneShot), RROW = presetRowLabel("recurring");

const TEMPLATES0: Template[] = [
  { id: "team-season", title: "Team, this season", shape: "recurring", example: `$RAYS26 burns ${R} of its pool every time the Rays win a game this season, then retires.`, settles: "each game's on-chain payout where a market exists, or otherwise a licensed final score, confirmed by the league's official feed", href: "/burnticker/launch?template=team-season", lands: "choices", choices: "pick the league and the team", type: "team", share: DEFAULT_SHARE.recurring, cta: "Choose a team" },
  { id: "team-oneshot", title: "Team wins the title", shape: "one-shot", example: `$RAYSWS burns ${O} once if the Rays win the World Series.`, settles: "Polymarket's on-chain payout for the championship market, checked against the league's official results", href: "/burnticker/launch?template=team-oneshot", lands: "choices", choices: "pick the championship card from a search for the example", type: "markets", share: DEFAULT_SHARE.oneShot, cta: "Find the title market" },
  { id: "matchup", title: "Matchup: two coins, one game", shape: "pair", example: "$LAKERS and $CELTICS on tonight's game, a linked pair: the winning team's coin burns its own pool on the result and takes the losing team's coin's pool at the end. After a draw, both pools go to $DEFICIT's burn.", settles: "a licensed final score or the game's on-chain settlement; a one-game pair burns once two sources agree on the final, or once one source has shown the same final twice a few minutes apart, and every source that answers must agree", href: "/burnticker/launch?template=matchup", pairing: "game", lands: "choices", choices: "pick the league and two teams, then one game or the season", type: "matchup", share: DEFAULT_SHARE.oneShot, cta: "Choose two teams" },
  { id: "election-oneshot", title: "A candidate wins a race", shape: "one-shot", example: `$ELSAYED burns ${O} once if Abdul El-Sayed wins the Michigan Senate race.`, settles: "Polymarket's on-chain payout, checked against the state's certified result", href: "/burnticker/launch?template=election-oneshot", lands: "choices", choices: "pick the race and the candidate", type: "elections", share: DEFAULT_SHARE.oneShot, cta: "Choose a race" },
  { id: "election-pair", title: "Two candidates in one race", shape: "pair", example: "$ELSAYED and $ROGERS, two markets, one race: the winner's coin burns its own pool on the result and takes the loser's pool at the end. If neither candidate wins, both pools go to $DEFICIT's burn.", settles: "both candidates' markets, on their on-chain payouts, checked against the state's certified result", href: "/burnticker/launch?template=election-pair", pairing: "race", lands: "choices", choices: "pick the race and two candidates", type: "pairs", share: DEFAULT_SHARE.oneShot, cta: "Choose a race and two candidates" },
  { id: "number-feed", title: "A public number (debt, CPI)", shape: "recurring", example: `$DEBTUP burns ${R} of its pool for every $1B the U.S. debt rises.`, settles: "the publisher's own feed (Treasury, BLS, FRED), confirmed by a second publisher of the same figure", href: "/burnticker/launch?template=number-feed", lands: "choices", choices: "pick the Treasury card from a search for the example", type: "feeds", share: DEFAULT_SHARE.recurring, cta: "Find the debt source" },
  { id: "weather", title: "Weather threshold", shape: "recurring", example: weatherText().lead, settles: "the National Weather Service's daily climate report, checked against the Iowa Environmental Mesonet", href: "/burnticker/launch?template=weather", lands: "review", choices: null, type: "weather", share: WEATHER_TEMPLATE.share, cta: "Open this example" },
  { id: "launch-count", title: "Rocket launches", shape: "recurring", example: `$LAUNCH burns ${R} of its pool for every orbital launch that reaches orbit.`, settles: "Launch Library 2's records (shown on Polymarket where a market exists)", href: "/burnticker/launch?template=launch-count", lands: "choices", choices: "pick the Launch Library card from a search for the example", type: "feeds", share: DEFAULT_SHARE.recurring, cta: "Find the launch source" },
  { id: "polymarket-oneshot", title: "Any adjudicated market", shape: "one-shot", example: `$OSCAR burns ${O} once if the film named in the market wins Best Picture.`, settles: "Polymarket's on-chain payout for that market", href: "/burnticker/launch?template=polymarket-oneshot", lands: "choices", choices: "search for the market and pick it", type: "markets", share: DEFAULT_SHARE.oneShot, cta: "Search for a market" },
  { id: "coin-vs-coin", title: "Coin vs Coin (the Burn Derby)", shape: "pair", example: `$TEAMWIF burns on a day WIF out-gains SHIB, and $TEAMSHIB's share for that day goes to $TEAMWIF's burn. On a day SHIB out-gains WIF, it is the other way round. WIF and SHIB are only read, never traded or burned. Each burn spends ${R} of the pool by default, and you can choose ${RROW}.`, settles: "Pyth's published feeds, checked against a second feed (RedStone) or the pool TWAP", href: "/burnticker/launch?template=coin-vs-coin", pairing: "registered", lands: "choices", choices: "pick the two reference coins", type: "derby", share: DEFAULT_SHARE.recurring, cta: "Choose two coins" },
  { id: "bracket", title: "Bracket (a Coin vs Coin season)", shape: "pair", example: "Eight new fan coins in a bracket, one for each reference coin. Each day, the fan coin whose reference coin wins its match burns from its own pool. The reference coins are only read, never traded or burned. A round's loser retires.", settles: "the same Coin vs Coin readings, round by round. The operator registers the bracket", href: "/burnticker/launch?template=bracket", lands: "choices", choices: "pick one pairing in Coin vs Coin, because the operator sets up the bracket itself", type: "derby", share: DEFAULT_SHARE.recurring, operatorOnly: "Only the operator can set up a bracket. Creators launch single pairings through Coin vs Coin.", cta: "Choose one pairing" },
  // ChatGPT launch-intent audit item 4: the flippening is a two-coin pair, read once a day for 30 days, with shared funding; the example says so
  { id: "flippening", title: "The flippening (two coins, once)", shape: "pair", example: `$SOLVETH and $ETHVSOL: two new coins, read once a day at 00:00 UTC for 30 days. On the first day SOL's market value is above ETH's, $SOLVETH burns ${O} of its pool once and takes $ETHVSOL's pool. If that day never comes, $ETHVSOL burns once at the end of the run instead and takes $SOLVETH's pool. SOL and ETH are only read, never traded or burned.`, settles: "Pyth's feeds and both coins' circulating supplies, read once a day at 00:00 UTC. Fees from both coins fund the coin whose rule fires", href: "/burnticker/launch?template=flippening", pairing: "registered", lands: "choices", choices: "pick the two reference coins; the run lasts 30 days from the next 00:00 UTC", type: "derby", share: DEFAULT_SHARE.oneShot, cta: "Choose two coins" },
];
/** The gallery: each pair template's line derived from its pairing (website-20 item 51). */
export const TEMPLATES: Template[] = TEMPLATES0.map((t) => (t.pairing ? { ...t, pairLine: pairLineFor(t.pairing) } : t));

/** Where a template lands in the wizard: a flow, a search query, a Browse category, or the Coin vs Coin tile. */
export const TEMPLATE_START: Record<TemplateId, { flow?: "team" | "pair" | "single"; search?: string; browse?: string; derby?: "pair" | "bracket" | "flip"; draft?: "weather" }> = {
  "team-season": { flow: "team" },
  "team-oneshot": { search: "Rays win the World Series" },
  matchup: { flow: "pair" },
  "election-oneshot": { browse: "politics" },
  "election-pair": { browse: "politics" },
  "number-feed": { search: "US debt rises $1B" },
  weather: { draft: "weather" },
  "launch-count": { search: "rocket launches" },
  "polymarket-oneshot": { flow: "single" },
  "coin-vs-coin": { derby: "pair" },
  bracket: { derby: "bracket" },
  flippening: { derby: "flip" },
};

/** "Launch one like this" from a coin or pair page. */
export const likeHref = (ticker: string): string => `/burnticker/launch?like=${encodeURIComponent(ticker)}`;

// ---------------------------------------------------------------------------------------------------------------------------------
// PRE-MADE RIVALRIES (cheap-features pass item 13, owner 2026-10-13 "Coin vs Coin adoption"): three Coin vs Coin pairs with both
// reference coins already picked, one tap to the Name step. The reference coins are only read (Pyth, cross-read by Jupiter or RedStone),
// never traded or burned. Each underlying is exactly what the tile would lock (derby/spec.ts DerbyUnderlying; derbySpecProblems passes:
// test/burntickerFeatures.test.ts). Kept beside the twelve canonical shapes, not among them.
// ---------------------------------------------------------------------------------------------------------------------------------
export type RivalryId = "wif-bonk" | "pengu-fartcoin" | "sol-eth-flip";
export interface RivalryTemplate {
  id: RivalryId; title: string; example: string; a: DerbyUnderlying; b: DerbyUnderlying; flip: boolean; window: "daily"; seasonDays: number;
  tickers: { a: string; b: string }; names: { a: string; b: string };
  /** Where the tap lands: the launch page's Coin vs Coin tile with both coins picked, at the Name step. */
  href: string; lands: "name"; cta: string;
}
const jupU = (symbol: string, pyth: string, mint: string): DerbyUnderlying => ({ symbol, pyth, mint, pool: null, cross: `jup:${mint}` });
const PYTH = {
  WIF: "4ca4beeca86f0d164160323817a4e42b10010a724c2217c6ee41b54cd4cc61fc", BONK: "72b021217ca3fe68922a19aaf990109cb9d84e9ad004b4d2025ad6f529314419",
  PENGU: "bed3097008b9b5e3c93bec20be79cb43986b85a996475589351a21e67bae9b61", FARTCOIN: "58cd29ef0e714c5affc44f269b2c1899a52da4169d7acc147b9da692e6953608",
  SOL: "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d", ETH: "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
};
const race = (id: RivalryId, title: string, a: DerbyUnderlying, b: DerbyUnderlying): RivalryTemplate => {
  const t = fightTickers(a.symbol, b.symbol);
  return {
    id, title, a, b, flip: false, window: "daily", seasonDays: 30, tickers: t, names: { a: fightName(a.symbol), b: fightName(b.symbol) },
    example: `${fightLead(t.a, t.b, 30)} On a day ${a.symbol} out-gains ${b.symbol}, $${t.a} burns and takes $${t.b}'s share for that day, and the other way round. ${a.symbol} and ${b.symbol} are only read, never traded or burned. ${raceEndSentence(30)}`,
    href: `/burnticker/launch?template=coin-vs-coin&rivalry=${id}`, lands: "name", cta: "Name the two coins",
  };
};
export const RIVALRY_TEMPLATES: readonly RivalryTemplate[] = [
  race("wif-bonk", "WIF vs BONK, a daily race", jupU("WIF", PYTH.WIF, "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm"), jupU("BONK", PYTH.BONK, "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263")),
  race("pengu-fartcoin", "PENGU vs FARTCOIN, a daily race", jupU("PENGU", PYTH.PENGU, "2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv"), jupU("FARTCOIN", PYTH.FARTCOIN, "9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump")),
  {
    id: "sol-eth-flip", title: "SOL vs ETH, the flippening",
    a: { symbol: "SOL", pyth: PYTH.SOL, mint: "So11111111111111111111111111111111111111112", pool: null, cross: "redstone:SOL" },
    b: { symbol: "ETH", pyth: PYTH.ETH, mint: "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs", pool: null, cross: "redstone:ETH" },
    flip: true, window: "daily", seasonDays: 30, tickers: { a: "SOLVETH", b: "ETHVSOL" }, names: { a: "SOL vs ETH, SOL side", b: "ETH vs SOL, ETH side" },
    example: `$SOLVETH and $ETHVSOL, read once a day for 30 days. On the first day SOL's market value is above ETH's, $SOLVETH burns ${O} of its pool once. If that never happens, $ETHVSOL burns once when the run ends. SOL and ETH are only read, never traded or burned.`,
    href: "/burnticker/launch?template=flippening&rivalry=sol-eth-flip", lands: "name", cta: "Name the two coins",
  },
];
export const rivalryById = (id: string | null | undefined): RivalryTemplate | null => RIVALRY_TEMPLATES.find((r) => r.id === id) ?? null;
