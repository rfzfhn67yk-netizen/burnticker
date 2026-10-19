import { rulesSha256 } from "@/lib/burnKeeper/rules";
import { derbySeriesId, derbySpecProblems, derbyStatement, isDerbySeries, type DerbySpec } from "@/lib/burnticker/derby/spec";
import { inverseRefusal, KEEPER_ONE_SHOT_RE, PAIR_OUTCOME_SERIES_RE } from "@/lib/burnticker/inverse";
import { burnTargetShapeProblems, type BurnTargetField } from "@/lib/burnticker/burnTarget";
import { regexProblem } from "@/lib/burnticker/safeRegex";
import { hasNoBurnOutcome, isFirstSnowRule, oneShotFull, resolvesOnce } from "@/lib/burnticker/nextResult";

/**
 * BURNTICKER RULES (2026-10-09; the owner's redesign the same evening: the event space is OPEN). A rule is a SELECTOR plus an
 * outcome → burn mapping, locked at launch and applied to markets that do not exist yet ("every Broncos game from now on", "every
 * daily Denver high", "this one election"). Pure.
 *
 * TWO ORACLES, ONE ENGINE.
 *   · "kalshi" (DISCOVERY ONLY — refused by the launch preflight; Kalshi's terms do not permit settlement on its data): the selector names a Kalshi series, or one market, or a series + filter; `kind` says how the settled result is
 *     read — "binary" (result yes/no → onYes / onNo) or "scalar" (the settled value → units of `unit` from a baseline, in a direction).
 *   · "catalogue" (tier 2, for things no market covers): `series` is a first-party feed id (treasury.debt, bls.eggs, noaa.flares,
 *     ll2.launches, jpl.neo, wiki.views). The feed FIXES unit, direction, baseline and carry; the creator chooses only the mapping.
 *
 * THE MAPPING. Each outcome (or each unit) burns either `fractionOfPool` of the fee pool (buyback: swap SOL → token at market, burn all
 * received; the keeper's spend = pool × (1 − (1 − f)^units), compounding) or `tokens` from a vesting vault (vault mode: units ×
 * tokens, shortfall carried and published). A rule uses one or the other everywhere — hybrid is v2 and refused here.
 *
 * LOCKED BY HASH. The rule is serialised canonically (keys sorted at every level, two-space indent, trailing newline) and that exact
 * text is what the registry stores, the token page publishes as rules.json and the receipts cite as rules=sha256:<12>: the hash is of
 * the bytes, with the keeper's `rulesSha256`, so `shasum -a 256 rules.json` reproduces it. A different rule is a different token.
 */

export const BURNTICKER_RULES_SCHEMA = "burnticker.rules/v1";

/**
 * Where a rule's facts come from. "kalshi" = adjudicated markets (tier 1, live); "polymarket" = adjudicated markets (tier 1, live since
 * 2026-10-10: binary only, the result read from the Conditional Tokens payout vector on Polygon — oracle/polymarket.ts); "catalogue" =
 * a configured primary source (config/burnticker/sources.json: attested-http tiers 3–5) or an on-chain fact; "uma" / "drift-bet" /
 * "hedgehog" are accepted by the schema so the format is forward-compatible, but their adapters are stubs and the launch route refuses them.
 */
export type OracleId = "kalshi" | "catalogue" | "polymarket" | "uma" | "drift-bet" | "hedgehog" | "derby";
export const ORACLE_IDS: readonly OracleId[] = ["kalshi", "catalogue", "polymarket", "uma", "drift-bet", "hedgehog", "derby"];
export const LIVE_ORACLES: readonly OracleId[] = ["kalshi", "catalogue", "polymarket", "derby"];
/**
 * The oracles a rivalry pair may use: the tier-1 adjudicated markets, and (2026-10-10) BURN DERBY — "derby" = the relative performance
 * of two existing coins read from Pyth's signed price updates (or an on-chain pool TWAP), cross-read by an independent operator
 * (derby/spec.ts; docs/burnticker/DERBY.md). Only a "coinvs" derby pairs; a bracket fan coin is a single coin.
 */
export const PAIR_ORACLES: readonly OracleId[] = ["kalshi", "polymarket", "derby"];
/**
 * THE RIVALRY SERIES (owner 2026-10-12; sources/espn.ts window `meetings`): the one first-party catalogue source that pairs — every game
 * between two teams this season, one coin per team (side B on the mirror series), winner takes the burn. The pattern repeats
 * espn.ts isMeetingsSeriesId (rules.ts does not import the sports tables); every other catalogue pair stays refused.
 */
export const MEETINGS_SERIES_RE = /^espn\.team:[a-z0-9.]+-[A-Z0-9]{2,6}\.\d{1,7}-win-m\d{4}\.[A-Z0-9]{2,6}\.\d{1,7}$/;
/** A head-to-head window on any outcome but `win` (refused: the rivalry series reads a signed win count). */
const MEETINGS_PAIR_RE = /^espn\.team:[a-z0-9.]+-[A-Z0-9]{2,6}\.\d{1,7}-(windraw|drawloss|winloss)-m\d{4}\./;
/** The other side's series of a rivalry series id, by its spelling alone (espn.ts meetingsMirror is the same with the team tables). */
export function meetingsMirrorId(series: string): string | null {
  const m = /^espn\.team:([a-z0-9.]+)-([A-Z0-9]{2,6})\.(\d{1,7})-win-m(\d{4})\.([A-Z0-9]{2,6})\.(\d{1,7})$/.exec(series);
  return m ? `espn.team:${m[1]}-${m[5]}.${m[6]}-win-m${m[4]}.${m[2]}.${m[3]}` : null;
}
export const isMeetingsRule = (r: { oracle?: unknown; series?: unknown }): boolean => r.oracle === "catalogue" && typeof r.series === "string" && MEETINGS_SERIES_RE.test(r.series);

/**
 * TWO CANDIDATES IN ONE RACE (owner decisions 2026-10-13 ~06:05 and ~06:10 Denver: "since it's a settled event, the loser's burn pool
 * should go to burning the winner's token"; the linked form is the default and the only form for candidates). Each coin follows its own
 * candidate's Polymarket outcome market of ONE race (a one-shot, onYes only); the two are a registered LaunchLab pair whose rules carry
 * `pair.race = { slug, markets: [side A's market, side B's market] }`, so each side's hash locks the race and both markets. The race is
 * decided once, when BOTH markets are final: exactly one paid YES → that coin won, the other lost (the keeper's race result,
 * multiKeeper.planToken); both NO, a split payout or both YES → no winner (each pool goes to $DEFICIT's burn at the end).
 */
export interface PairRace { slug: string; markets: [string, string] }
export const RACE_SLUG_RE = /^[a-z0-9][a-z0-9-]{2,127}$/;
/** Is this a candidates pair side (two outcome markets of one race)? */
export const isCandidatesRule = (r: { pair?: { race?: unknown } | null }): boolean => !!r.pair && typeof r.pair === "object" && r.pair.race !== undefined && r.pair.race !== null;
/** The partner's market of a candidates pair side, or null. */
export const candidatesPartnerMarket = (r: Pick<BurnRule, "pair">): string | null => (r.pair?.race ? r.pair.race.markets[r.pair.side === "A" ? 1 : 0] : null);
/**
 * TWO TEAMS IN ONE GAME (coordinator 2026-10-13, the same owner rule for settled events): the one-game rivalry pair is linked by default.
 * Each coin reads its OWN team's win series of the one game (sources/espn.ts gameSeries, outcome `win`: 1 when that team won, 0 when it
 * lost or drew); the two ids are each other's mirror (the team swapped for the opponent). `pair.game = { series: [side A's, side B's] }`
 * locks both in both hashes. Exactly one win → that coin's whole budget burns it and the loser's pool forwards to it; a draw → no winner
 * (each pool to $DEFICIT's burn at the end); a postponed game waits; a cancelled game ends void (each coin burns down on itself).
 */
export interface PairGame { series: [string, string] }
export const GAME_WIN_SERIES_RE = /^espn\.game:([a-z0-9.]+)-(\d{4,12})-([A-Z0-9]{2,6})-win$/;
/** The other team's win series of the same game (the team swapped), by spelling alone. */
export const gameMirrorId = (series: string, opp: string): string | null => { const m = GAME_WIN_SERIES_RE.exec(series); return m && m[3] !== opp.toUpperCase() ? `espn.game:${m[1]}-${m[2]}-${opp.toUpperCase()}-win` : null; };
export const isGamePairRule = (r: { pair?: { game?: unknown } | null }): boolean => !!r.pair && typeof r.pair === "object" && r.pair.game !== undefined && r.pair.game !== null;
/** The two settled-event pair shapes (one race's two candidates, one game's two teams), or null for any other rule. */
export const settledPairShape = (r: { pair?: { race?: unknown; game?: unknown } | null }): "candidates" | "game" | null => (isCandidatesRule(r) ? "candidates" : isGamePairRule(r) ? "game" : null);
export const isSettledPairRule = (r: { pair?: { race?: unknown; game?: unknown } | null }): boolean => settledPairShape(r) !== null;
/** The problems of a `pair.game` field against its rule (empty = a valid one-game pair side). Pure. */
export function gameProblems(r: { oracle?: unknown; series?: unknown; kind?: unknown; scalar?: { direction?: unknown } | null; inverse?: unknown; pair?: { side?: unknown; game?: unknown; race?: unknown } | null }): string[] {
  const g = r.pair?.game as { series?: unknown } | undefined | null;
  if (g === undefined || g === null) return [];
  const p: string[] = [];
  const ss = typeof g === "object" ? g.series : undefined;
  const m = Array.isArray(ss) && ss.length === 2 && ss.every((x) => typeof x === "string") ? ss.map((x) => GAME_WIN_SERIES_RE.exec(x as string)) : null;
  if (!m || !m[0] || !m[1] || m[0][1] !== m[1][1] || m[0][2] !== m[1][2] || m[0][3] === m[1][3]) p.push("pair.game.series must be the two teams' win series of one game, side A's first");
  if (typeof g === "object" && Object.keys(g).some((k) => k !== "series")) p.push("pair.game takes only series");
  if (r.pair?.race !== undefined) p.push("pair: a pair is two candidates in one race or two teams in one game, not both");
  if (r.oracle !== "catalogue" || !Array.isArray(ss) || ss[r.pair?.side === "B" ? 1 : 0] !== r.series) p.push(`pair.game: side ${r.pair?.side === "B" ? "B" : "A"} reads ${r.pair?.side === "B" ? "the second" : "the first"} series of pair.game.series`);
  if (r.kind !== "scalar" || r.scalar?.direction !== "up" || r.inverse) p.push("pair.game: each team's coin counts its own team's win");
  return p;
}
/** The problems of a `pair.race` field against its rule (empty = a valid candidates side). Pure. */
export function raceProblems(r: { oracle?: unknown; market?: unknown; kind?: unknown; binary?: { onYes?: unknown; onNo?: unknown } | null; pair?: { side?: unknown; race?: unknown } | null }): string[] {
  const race = r.pair?.race as { slug?: unknown; markets?: unknown } | undefined | null;
  if (race === undefined || race === null) return [];
  const p: string[] = [];
  if (typeof race !== "object" || typeof race.slug !== "string" || !RACE_SLUG_RE.test(race.slug)) p.push("pair.race.slug must be the race's Polymarket event slug (3–128 lowercase letters, digits and dashes)");
  const m = (race as { markets?: unknown }).markets;
  if (!Array.isArray(m) || m.length !== 2 || !m.every((x) => typeof x === "string" && POLY_MARKET_RE.test(x)) || m[0] === m[1]) p.push("pair.race.markets must be two different Polymarket condition ids, side A's market first");
  if (typeof race === "object" && Object.keys(race).some((k) => k !== "slug" && k !== "markets")) p.push("pair.race takes only slug and markets");
  if (r.oracle !== "polymarket" || typeof r.market !== "string") p.push("pair.race: a candidates pair reads two Polymarket outcome markets of one race, one market per coin");
  else if (Array.isArray(m) && m[r.pair?.side === "B" ? 1 : 0] !== r.market) p.push(`pair.race: side ${r.pair?.side === "B" ? "B" : "A"} reads ${r.pair?.side === "B" ? "the second" : "the first"} market of pair.race.markets`);
  if (r.kind !== "binary" || !r.binary || !r.binary.onYes || r.binary.onNo) p.push("pair.race: each candidate's coin burns on its own market's YES only");
  return p;
}

/**
 * POLYMARKET SELECTORS (2026-10-10). One market = its CTF condition id, lowercase hex (`market: "0x…64"`), a one-shot. Recurring =
 * `series` in one of two forms:
 *   tag:<tag slug>[/<sports market type>][:<event slug glob>]   every binary market Gamma lists under the tag (e.g. "tag:nfl/moneyline",
 *                                                               "tag:fed-rates", "tag:nfl/moneyline:nfl-*den-*"); the type narrows the
 *                                                               scan on Gamma's side, the glob (`*` = any run) is matched on the event slug
 *   event:<event slug>                                           every binary market of one event (an election night, a Fed meeting)
 * Filters: `titleRegex` over the market question only (`tickerIncludes` is Kalshi's). Binary only in v1 (no scalar).
 */
export const POLY_MARKET_RE = /^0x[0-9a-f]{64}$/;
export const POLY_TAG_SERIES_RE = /^tag:([A-Za-z0-9][A-Za-z0-9-]{0,63})(?:\/([a-z0-9_]{1,40}))?(?::([a-z0-9*][a-z0-9*-]{0,99}))?$/;
export const POLY_EVENT_SERIES_RE = /^event:([a-z0-9][a-z0-9-]{0,127})$/;
export const isPolySeries = (s: string): boolean => POLY_TAG_SERIES_RE.test(s) || POLY_EVENT_SERIES_RE.test(s);
/** Audit 2026-10-18 A-37: the most `*` wildcards an event slug glob may carry (the matcher is linear; the cap keeps rules readable). */
export const POLY_GLOB_MAX_WILDCARDS = 8;
/**
 * How many wildcards the series' event slug glob carries, a run of `*` counted once as the matcher reads it (0 for an event series or a
 * tag series without a glob).
 */
export const polyGlobWildcards = (s: string): number => { const t = POLY_TAG_SERIES_RE.exec(s); return t?.[3] ? t[3].replace(/\*+/g, "*").split("*").length - 1 : 0; };
export type Direction = "up" | "down" | "abs";
/** One outcome's burn: a fraction of the fee pool (buyback) OR a count of tokens (vault). Exactly one key. */
export interface BurnMapping { fractionOfPool?: number; tokens?: number }

export interface SelectorFilter { tickerIncludes?: string; titleRegex?: string }

export interface BurnRule {
  schema: typeof BURNTICKER_RULES_SCHEMA;
  oracle: OracleId;
  /** Kalshi: the series ticker (null when `market` names one market). Catalogue: the feed id. */
  series: string | null;
  /** Kalshi: one market ticker — a one-shot rule ("resolves once"). */
  market: string | null;
  filter: SelectorFilter;
  kind: "binary" | "scalar";
  /** At least one of onYes / onNo. A rivalry side burns on exactly one outcome (the other side on the other). */
  binary: { onYes: BurnMapping | null; onNo: BurnMapping | null } | null;
  scalar: { unit: number; perUnit: BurnMapping; baseline: "previousSettlement" | number; direction: Direction } | null;
  /**
   * RIVALRY PAIR (the owner, 2026-10-09 night): two coins on the SAME selector with inverted mappings, launched together. The pairId is
   * part of each side's canonical rule (so the link is locked), each side is hashed independently, and side B's rule carries side A's
   * mint as counterpart (A is created first, so A's counterpart is null in the rule and lives in the registry's pairs table).
   */
  pair: PairField | null;
  /**
   * The wind-down when the rule ends, and the retired-coin sweep threshold (see NO BURN POOL IS EVER LEFT BEHIND); absent on rules
   * created before it.
   */
  onEnd?: { windDownDays: number; sweepThresholdLamports: number; /** END SINKS (LAUNCHPAD-PATH §45): see END_SINK below. Absent = the old wind-down for every end. "incinerator" (round 5) = the SOL itself is sent to Solana's incinerator. */ endSink?: true | "incinerator";
    /** NAMED-COIN END SINK (end-sink picker, 2026-10-13; end.rs END_SINK_MINT): the live Burnticker coin whose burn pool takes the rest at a
     *  resolved end, with its ticker for the words. Needs `endSink`. The program falls back to $DEFICIT when that coin is not live then. */
    mint?: string; ticker?: string };
  /**
   * BURN TARGET (round 5, owner 2026-10-13; burnTarget.ts): this coin's burn pool swaps SOL for ANOTHER token on that token's pinned
   * Raydium CPMM pool and burns it, instead of burning itself. Buyback mode only; pinned before the coin exists (pin_burn_target), hashed
   * here so the rules file says exactly which token and pool. Absent = the coin burns itself (every rule before round 5).
   */
  burnTarget?: BurnTargetField;
  /**
   * OUTCOME SETS (opt-in, owner design 2026-10-10; the program instruction is QUEUED — docs/burnticker/PROGRAM-UPGRADE-QUEUE.md): this
   * coin is the member of set `id` bound to ONE `outcome` of the set's selector (a team id in a league season, a Polymarket outcome, a
   * bracket slot). When its rule ends, `forwardBps` (0–10,000; 10,000 when the creator does not dial it) of the leftover burn pool is
   * forwarded to the fee PDA of the set's WINNING member (fixed by the set's quorum-signed winner reading) and burns there. Rivalry pairs
   * are the 2-member case; "league mode" (the wizard's word) a 32-member set; derby brackets forward round by round. Until
   * `forward_to_winner` exists on chain — or when there is no winning coin, or it is not graduated/registered — the WHOLE leftover takes
   * the normal wind-down on this coin (the conditional is in the description). Only selectors with an outcome list (binary rules, not
   * scalar feeds such as debt, CPI or weather). Absent by default; locked by the rule hash.
   */
  set?: { id: string; outcome: string; forwardBps: number };
  /**
   * BURN DERBY (2026-10-10; oracle "derby" only, absent otherwise so every other rule's canonical bytes are unchanged): the two coins (or
   * the bracket slot), the window, the measure and the season, locked with the rule. `series` is derived from it (derbySeriesId).
   */
  derby?: DerbySpec;
  /**
   * THE FADE SIDE (sources-2, 2026-10-12; inverse.ts): a recurring first-party scalar rule may burn on the periods its condition does
   * NOT happen ("burns on every business day the debt stays flat or falls"): one unit per such period, none when it does happen.
   * Absent on every other rule (their canonical bytes are unchanged); locked by the hash where present.
   */
  inverse?: true;
  /** A voided / cancelled market yields a VOID receipt and no burn. The only policy in v1. */
  onVoid: "skip";
  /** Buyback: below this (USD at execution) nothing is bought that period. Decimal string, ≤ 2 decimals. */
  floorUsd: string;
  /** Buyback: SOL kept back for fees. Decimal string, ≤ 9 decimals. */
  reserveSol: string;
  /** Vault mode only: the LaunchLab vesting share that funds the vault (0.10–0.30), 12-month linear. Null in buyback mode. */
  vault: { share: number; vestDays: number; cliffDays: number } | null;
}

export type RuleMode = "buyback" | "vault";

/**
 * BOTH OR NEITHER (owner decision, 2026-10-10): every rivalry pair created from now on carries this clause in BOTH sides' canonical
 * rules (so it is locked by each side's hash):
 *   1. event burns on either side apply only once BOTH coins have a registered pool (the burn program's TokenConfig names its CPMM
 *      pool); a settlement read before that is recorded as a `pending-pair` receipt and executes, in order, when the second pool
 *      registers;
 *   2. if either side is still unregistered when the `voidBy` UTC date ends, the pair VOIDS: no event burn on either side, ever (pending
 *      receipts become `voided`), and the rule has ENDED — each coin's pool then winds down under its `onEnd` clause (below).
 * `voidBy` defaults to the first settlement date of a one-shot, else 30 days after launch. Pairs created before the clause carry none.
 */
export const PAIR_CLAUSE = "both-or-neither" as const;
export interface PairField {
  pairId: string; side: "A" | "B"; counterpartMint: string | null;
  clause?: typeof PAIR_CLAUSE;
  /** YYYY-MM-DD (UTC): the pair voids if either side has no registered pool when this date ends. */
  voidBy?: string;
  /**
   * WINNER TAKES THE BURN (owner decision 2026-10-11, LAUNCHPAD-PATH §40; the DEFAULT for every pair created from then on): at each
   * result the loser's fuel for that result — its own fraction dial applied to its own pool, the same amount it would have burned had
   * it won; a one-shot pair 100 % — moves to the winner's burn pool (burn_receipts forward_to_winner) and the winner's normal cranks
   * buy and burn the winner's coin. The loser's supply is untouched; nobody is paid; a draw or a void forwards nothing. Derby: per
   * window; a season matchup: per game; a one-shot: once — and when a one-shot loser's rule ends, its wind-down sweep goes to the
   * winner's burn pool while the winner is live. Locked by both sides' hashes; absent on pairs created before the decision.
   */
  winnerTakesBurn?: true;
  /** A candidates pair (two outcome markets of one race; owner 2026-10-13): the race and both markets, side A's first. Absent otherwise. */
  race?: PairRace;
  /** A one-game pair (two teams in one game; 2026-10-13): both teams' win series of the game, side A's first. Absent otherwise. */
  game?: PairGame;
}
/** Does this pair forward the loser's fuel to the winner (winner takes the burn)? */
export const pairWinnerTakesBurn = (r: Pick<BurnRule, "pair">): boolean => r.pair?.winnerTakesBurn === true;
/** The locked description's sentence for every winner-takes-the-burn pair (lint-clean: nothing is won, nobody is paid). */
export const WINNER_TAKES_BURN_LINE = "Fees from both coins burn the winner's supply.";
/** The pair's clause, or null (a pair created before the clause, or a single coin). */
export const pairClause = (r: Pick<BurnRule, "pair">): { voidBy: string } | null => (r.pair?.clause === PAIR_CLAUSE && r.pair.voidBy ? { voidBy: r.pair.voidBy } : null);

/**
 * NO BURN POOL IS EVER LEFT BEHIND (owner decision, 2026-10-10). `onEnd: { windDownDays }` — when a rule ENDS for any reason (a one-shot
 * resolved NO or void, a pair voided, a derby season over or a bracket coin knocked out, a team coin's season over, a nominee replaced)
 * the remaining burn pool burns down on a daily clock: each day a normal quorum-signed reading counts `windDownUnits(f, days)` units of
 * the rule's own fraction — the geometric schedule that spends ≥ 99 % of the pool within `windDownDays` (28 by default) — the
 * program's 2 %-of-reserve per-crank cap carries the rest to the next day, the $1 floor stops the tail, then the coin retires
 * (src/lib/burnticker/units.ts windDown*, multiKeeper.ts planRuleEnd). Absent on rules created before the clause (their canonical bytes
 * are unchanged); every new launch carries it (api/handlers.ts prepareLaunch).
 *
 * ONE-SHOT 100 %. A one-shot's mapping may spend up to the WHOLE pool (`fractionOfPool` ≤ 1.00; recurring rules stay ≤ 0.10). The
 * program accepts fraction_per_unit_bps up to 10,000 (programs/burn-receipts initialize_token validate_rule: 1 ≤ bps ≤ BPS_DENOMINATOR)
 * and spends min(target, 2 % of the pool's WSOL reserve) per crank, carrying the rest; a crank needs a reading with units, so after a
 * YES the keeper attests one "drain" unit per day — each one's rule spend is the whole pool, exactly (1 − (1 − 1)^1 = 1) — until a
 * crank carries nothing more or falls under the floor. Every amount is the program's, on the receipts.
 */
export const DEFAULT_WIND_DOWN_DAYS = 28;
/**
 * RETIRED-COIN SWEEP (owner addendum, 2026-10-10): a retired coin's fee PDA keeps receiving the post-graduation creator fee, so the
 * keeper sweeps it — when the spendable balance (minus the reserve) exceeds `onEnd.sweepThresholdLamports` (0.05 SOL by default), one
 * "sweep" reading of full-spend units, cranked across days under the per-crank cap — at most one sweep start per coin per 7 days.
 */
export const DEFAULT_SWEEP_THRESHOLD_LAMPORTS = 50_000_000;
export const SWEEP_EVERY_DAYS = 7;
/** The onEnd clause every new launch carries. */
/** An outcome set's default when a coin opts in ("league mode" in the wizard's copy): forward everything that can be forwarded. */
export const DEFAULT_SET_FORWARD_BPS = 10_000;
export const DEFAULT_ON_END = { windDownDays: DEFAULT_WIND_DOWN_DAYS, sweepThresholdLamports: DEFAULT_SWEEP_THRESHOLD_LAMPORTS, endSink: true } as const;
/**
 * END SINKS (owner decision 2026-10-11, LAUNCHPAD-PATH §45; burn_receipts program round 4). `onEnd.endSink: true` — every new launch
 * carries it (DEFAULT_ON_END; it is part of the canonical rule, so the hash locks it):
 *   the rule ENDS RESOLVED (a season over, a one-shot settled YES or NO, a derby season over)  whatever is left in the burn pool, and
 *       any fee income that arrives later, moves to the coin's END SINK's burn pool and burns that coin (burn_receipts forward_on_end):
 *       a winner-takes-the-burn pair coin's sink is its partner when the partner won the last result and is still live; every other
 *       coin's sink, and the fall-through, is $DEFICIT (the platform's flagship, compiled into the program per cluster);
 *   the rule ends VOID (a voided market, a pair that voided, a cancelled season)  the onEnd wind-down below, on the coin itself. A champion-path season coin whose team won the title (website-18, endSinkKeeper.ts) ends this way too.
 * The EndSink is pinned on chain at initialize_token (the launch bundle passes it) and never changes; nobody is paid. League sets (a
 * league season's champion coin) are a later round: a rule with `set` cannot carry `endSink` yet. Vault-mode rules have no burn pool,
 * so `endSink` changes nothing for them (endSinkOf returns null). Rules without the field keep the wind-down for every end.
 */
/** The wind-down clause alone (no end sink): rules made before §45, and league-mode rules (`set`) until league-set sinks exist. */
export const WIND_DOWN_ON_END = { windDownDays: DEFAULT_WIND_DOWN_DAYS, sweepThresholdLamports: DEFAULT_SWEEP_THRESHOLD_LAMPORTS } as const;
/** The onEnd a new launch gets when its rule names none: DEFAULT_ON_END (with the end sink), or the wind-down alone for a league-mode rule. */
export const defaultOnEndFor = (rule: unknown): { windDownDays: number; sweepThresholdLamports: number; endSink?: true | "incinerator" } =>
  rule && typeof rule === "object" && (rule as { set?: unknown }).set != null ? { ...WIND_DOWN_ON_END } : { ...DEFAULT_ON_END };
/** Solana's incinerator (solana_program::incinerator::ID): a vanity address nobody holds a key for; the runtime burns what it is credited. */
export const INCINERATOR_ADDRESS = "1nc1nerator11111111111111111111111111111111";
/**
 * ROUND 5 (owner 2026-10-13): `onEnd.endSink: "incinerator"` — at a RESOLVED end the SOL left in the burn pool (and the later trickle) is
 * sent to Solana's incinerator (burn_receipts burn_sol_on_end; EndSink kind INCINERATOR), no swap and no price impact. Single coins
 * only: a paired coin ends on the pair-winner sink. A VOID end keeps the wind-down on the coin, as for every sink.
 */
export type EndSinkKind = "flagship" | "pair-winner" | "mint" | "incinerator";
export const endSinkOf = (r: Pick<BurnRule, "onEnd" | "pair" | "kind" | "binary" | "scalar">): EndSinkKind | null => {
  const e = r.onEnd?.endSink;
  if (e !== true && e !== "incinerator") return null;
  if (ruleMappings(r).some((m) => m.mapping.tokens !== undefined)) return null;
  if (e === "incinerator") return "incinerator";
  return pairWinnerTakesBurn(r) ? "pair-winner" : r.onEnd?.mint ? "mint" : "flagship";
};
/**
 * THE LOSING PATH NEVER BURNS THIS COIN (owner rule, 2026-10-13 ~09:05 Denver). When the team loses, the event resolves against the coin
 * or the rule ends without firing, the rest must leave the coin: another live coin's burn, $DEFICIT's burn, the pair winner, or (round 5)
 * Solana's incinerator. A new launch whose rule could carry an end sink but ends on the wind-down alone (an onEnd without `endSink`, so
 * the rest burns this coin on every end) is refused with this sentence. Burning the rest here stays only on the winning path (the
 * champion path, a one-shot that fired). Rules that cannot carry a sink are not refused: a league-mode rule (`set`), a fixed-token rule.
 */
export const END_SELF_ON_LOSS_REFUSAL = "This coin cannot burn itself when it loses or its rule ends without firing. Pick where the rest goes then: another live coin's burn or $DEFICIT's burn.";
export function endSelfOnLossProblem(r: Pick<BurnRule, "onEnd" | "pair" | "kind" | "binary" | "scalar" | "set" | "vault">): string | null {
  if (!r.onEnd || r.onEnd.endSink === true || r.onEnd.endSink === "incinerator" || r.set || r.vault) return null;
  if (ruleMappings(r).some((m) => m.mapping.tokens !== undefined)) return null;
  return END_SELF_ON_LOSS_REFUSAL;
}
export const ONE_SHOT_MAX_FRACTION = 1;
// Resolves once. audit 7 F08: the definition lives in nextResult.ts (client-safe, so the coin page and the creator views use the same one); same name here
export { isOneShot } from "@/lib/burnticker/nextResult";

/** ChatGPT audit 6 item 27: the share limits in words, from RULE_BOUNDS (the OpenAPI document, the field help and /about read this). */
export const shareLimitsText = (): string => `A rule that repeats spends ${Math.round(RULE_BOUNDS.fractionOfPool.min * 100)}% to ${Math.round(RULE_BOUNDS.fractionOfPool.max * 100)}% of the burn pool per unit (fractionOfPool ${RULE_BOUNDS.fractionOfPool.min} to ${RULE_BOUNDS.fractionOfPool.max}). A rule that resolves once (one market, a named launch, a milestone, the flippening) may spend up to ${Math.round(ONE_SHOT_MAX_FRACTION * 100)}% (up to ${ONE_SHOT_MAX_FRACTION.toFixed(2)}). A single game and the first snow are not drained at once, so they keep the repeating limits.`;
export const RULE_BOUNDS = {
  /** Recurring rules: 1–25 % of the pool per unit. A one-shot may go to 100 % (ONE_SHOT_MAX_FRACTION; see "ONE-SHOT 100 %" above). */
  // owner, 2026-10-12: a recurring rule may spend up to 25 % per unit (the program allows up to 100 %; one burn run stays capped at 2 % of the pool's SOL)
  fractionOfPool: { min: 0.01, max: 0.25 },
  vaultShare: { min: 0.10, max: 0.30 },
  tokens: { min: 1, max: 100_000_000 },
  unitMinPositive: 1e-9,
} as const;

/** Fixed supply for every Burnticker token (LaunchLab default; decimals must be 6 — the SDK refuses anything else). */
export const TOTAL_SUPPLY = "1000000000";
export const DECIMALS = 6;

/** The footer appended to every token's description, verbatim. States what the rule does; says nothing about price. */
export const DISCLAIMER_FOOTER = "A memecoin. The rule says what the supply does, not what the price does. The rule is locked at launch and cannot be changed by anyone, including the creator. Burns are funded by the token's own trading fees (or a disclosed vault), recomputable by anyone from the public source and the published rule. Nobody is promised anything.";

/** The one extra line on every oracle-backed page (LAUNCHPAD-PATH §11: closer to an event contract than Treasury data is). */
export const EVENT_CONTRACT_DISCLOSURE = "This token's supply rule reads the SETTLED result of a regulated event contract (Kalshi). The token pays nothing on any outcome and holds no position in any market; it only burns its own supply per the published rule. Market prices are shown for information and are never used by the rule.";
/** The Polymarket counterpart (2026-10-10): the result is the market's payout vector as Polygon's Conditional Tokens contract stores it. */
export const POLYMARKET_DISCLOSURE = "This token's supply rule reads the SETTLED result of a Polymarket market: the payout the Conditional Tokens contract on Polygon records once the market is resolved. The token pays nothing on any outcome and holds no position in any market; it only burns its own supply per the published rule. Market prices are shown for information and are never used by the rule.";
/** Burn Derby (2026-10-10): the input is OTHER coins' published feeds; our coins' own trading is never read. */
export const DERBY_DISCLOSURE = "This token's supply rule compares two OTHER coins over a window, read from Pyth's signed feed updates (or an on-chain pool average) and cross-checked by an independent operator. The token pays nothing on any outcome and holds no position in either coin; it only burns its own supply per the published rule. Its own trading is never an input.";
/** The one extra disclosure line for a rule's oracle (null for first-party feeds). */
export const oracleDisclosure = (oracle: OracleId): string | null => (oracle === "kalshi" ? EVENT_CONTRACT_DISCLOSURE : oracle === "polymarket" ? POLYMARKET_DISCLOSURE : oracle === "derby" ? DERBY_DISCLOSURE : null);

/**
 * A catalogue series id: "<source>.<name>" with an optional ":<parameter>" (wiki.views:Bitcoin, github.stars:anza-xyz/agave,
 * edgar.8k:0000320193). Kept to characters the receipt memo's id field accepts (the parameter may carry one "/"). Whether the id
 * names a CONFIGURED source is checked by the catalogue (feedById) at launch and registration, not here — the schema stays static.
 */
export const CATALOGUE_SERIES_RE = /^[a-z][a-z0-9]*\.[A-Za-z0-9_.-]{1,40}(:[A-Za-z0-9_.-]{1,48}(\/[A-Za-z0-9_.-]{1,100})?)?$/;
/** Kept for callers: wiki.views:<Article>. */
export const WIKI_SERIES_RE = /^wiki\.views:[A-Za-z0-9_.-]{1,48}$/;
export const isCatalogueSeries = (s: string): boolean => CATALOGUE_SERIES_RE.test(s);
const TICKER_RE = /^[A-Z0-9][A-Z0-9._-]{1,63}$/;

const isMapping = (m: unknown): m is BurnMapping => !!m && typeof m === "object" && !Array.isArray(m);

/** Which mode a mapping is in; null when it is neither or both. */
export function mappingMode(m: BurnMapping): RuleMode | null {
  const f = m.fractionOfPool !== undefined, t = m.tokens !== undefined;
  if (f && !t) return "buyback";
  if (t && !f) return "vault";
  return null;
}

/** Every mapping the rule carries, labelled. */
export function ruleMappings(r: Pick<BurnRule, "kind" | "binary" | "scalar">): { label: string; mapping: BurnMapping }[] {
  const out: { label: string; mapping: BurnMapping }[] = [];
  if (r.kind === "binary" && r.binary) { if (r.binary.onYes) out.push({ label: "onYes", mapping: r.binary.onYes }); if (r.binary.onNo) out.push({ label: "onNo", mapping: r.binary.onNo }); }
  if (r.kind === "scalar" && r.scalar) out.push({ label: "perUnit", mapping: r.scalar.perUnit });
  return out;
}

/** The rule's mode, from its mappings (all must agree). Throws on a rule that has not been validated. */
export function ruleMode(r: BurnRule): RuleMode {
  const modes = new Set(ruleMappings(r).map((x) => mappingMode(x.mapping)));
  if (modes.size !== 1 || modes.has(null)) throw new Error("rule: mappings do not agree on one mode");
  return [...modes][0] as RuleMode;
}

/**
 * Validates a parsed rule; throws one message listing EVERY problem. Strict: an unknown oracle, a selector that names nothing, a
 * mapping with both keys, a fraction outside the template's bounds — each is a rule a stranger could not reproduce, so it never
 * launches. Returns the rule with its optional fields normalised (null, not undefined), ready for canonical serialisation.
 */
/**
 * `o.stored` (prelaunch audit H6): the rule is one already locked in the registry, re-read for a page or a cycle. Its title filter is
 * not refused again here (a coin launched before a check was added must stay readable); it still never runs unsafely, because
 * safeRegexTest refuses it and the match runs on the linear-time matcher. Every new rule (the launch, the back-test, the API's checks)
 * is validated strictly.
 */
export function validateRule(raw: unknown, o: { stored?: boolean } = {}): BurnRule {
  const p: string[] = [];
  const r = raw as Partial<BurnRule> | null;
  if (!r || typeof r !== "object") throw new Error("rule: not a JSON object");
  if (r.schema !== BURNTICKER_RULES_SCHEMA) p.push(`schema must be "${BURNTICKER_RULES_SCHEMA}"`);
  if (!ORACLE_IDS.includes(r.oracle as OracleId)) p.push(`oracle must be one of ${ORACLE_IDS.join(", ")}`);
  const marketLike = r.oracle === "kalshi" || r.oracle === "polymarket" || r.oracle === "uma" || r.oracle === "drift-bet" || r.oracle === "hedgehog";
  const series = r.series ?? null, market = r.market ?? null;
  const derby = (r as { derby?: unknown }).derby;
  if (r.oracle === "derby") {
    const dp = derby === undefined || derby === null ? ["derby: the derby block { selector, … } is required"] : derbySpecProblems(derby);
    p.push(...dp);
    if (typeof series !== "string" || !isDerbySeries(series)) p.push('derby: series must be "coinvs:<A>-<B>:<daily|weekly>:<pct|mcap>[-flip]:<hash>" or "bracket:<tournament id>:<slot>" (derbySeriesId)');
    else if (!dp.length && series !== derbySeriesId(derby as DerbySpec, rulesSha256)) p.push(`derby: series must be ${derbySeriesId(derby as DerbySpec, rulesSha256)} (derived from the derby block)`);
    if (market !== null) p.push("derby: market must be null");
    const sel = !dp.length ? (derby as DerbySpec).selector : null;
    if (sel === "coinvs" && r.kind !== "binary") p.push('derby: a coin-vs-coin rule is "binary" (YES = coin A wins the window, NO = coin B wins)');
    if (sel === "price") {
      if (r.kind !== "scalar") p.push('derby: a single-asset rule is "scalar" (the window\'s % change counted in units of percentage points)');
      else if (r.scalar && (r.scalar.baseline !== 0 || (r.scalar.direction !== "up" && r.scalar.direction !== "down") || typeof r.scalar.unit !== "number" || r.scalar.unit < 0.1 || r.scalar.unit > 100)) p.push('derby: a single-asset scalar is { unit: 0.1–100 (percentage points), baseline: 0, direction: "up" | "down" }');
    }
    if (sel === "high") {
      // sources-4: a record-close day is one unit (reading 1), any other day 0; a single coin (no pair), never inverted.
      if (r.kind !== "scalar") p.push('derby: a record-close rule is "scalar" (1 for a record day, 0 otherwise)');
      else if (r.scalar && (r.scalar.unit !== 1 || r.scalar.baseline !== 0 || r.scalar.direction !== "up")) p.push('derby: a record-close rule\'s scalar is { unit: 1, baseline: 0, direction: "up" }');
      if (r.pair !== null && r.pair !== undefined) p.push("pair: a record-close coin is a single coin (it reads one reference against its own record)");
    }
    if (sel === "bracket") {
      if (r.kind !== "scalar") p.push('derby: a bracket fan coin is "scalar" (the day\'s points: 1 for a win, 2 in the final, 0 for a loss)');
      else if (r.scalar && (r.scalar.unit !== 1 || r.scalar.baseline !== 0 || r.scalar.direction !== "up")) p.push("derby: a bracket fan coin's scalar is { unit: 1, baseline: 0, direction: \"up\" }");
    }
  } else if (derby !== undefined && derby !== null) p.push('derby: only an oracle "derby" rule carries a derby block');
  if (r.oracle === "derby") { /* checked above */ }
  else if (r.oracle === "polymarket") {
    if (series !== null && (typeof series !== "string" || !isPolySeries(series))) p.push('polymarket: series must be "tag:<tag slug>[/<market type>][:<event slug glob>]" or "event:<event slug>"');
    else if (typeof series === "string" && polyGlobWildcards(series) > POLY_GLOB_MAX_WILDCARDS) p.push(`polymarket: the event slug pattern has too many wildcards. Use ${POLY_GLOB_MAX_WILDCARDS} or fewer.`);
    if (market !== null && (typeof market !== "string" || !POLY_MARKET_RE.test(market))) p.push("polymarket: market must be a condition id (0x + 64 lowercase hex)");
    if (r.kind !== "binary") p.push('polymarket: kind must be "binary" (scalar Polymarket markets are not supported in v1)');
    if (r.filter && typeof r.filter === "object" && (r.filter as SelectorFilter).tickerIncludes !== undefined) p.push("polymarket: filter with titleRegex over the market question (tickerIncludes is for Kalshi tickers)");
  } else {
    if (series !== null && (typeof series !== "string" || !TICKER_RE.test(series) && !isCatalogueSeries(series))) p.push("series must be a ticker (A–Z, 0–9, . _ -) or null");
    if (market !== null && (typeof market !== "string" || !TICKER_RE.test(market))) p.push("market must be a market ticker or null");
  }
  if (marketLike) {
    if (series === null && market === null) p.push(`${r.oracle}: name a series or a market`);
    if (series !== null && market !== null) p.push(`${r.oracle}: a series OR one market, not both`);
  }
  if (r.oracle === "catalogue") {
    if (!series || !isCatalogueSeries(series)) p.push("catalogue: series must be a source id like treasury.debt or wiki.views:<Article> (config/burnticker/sources.json)");
    if (market !== null) p.push("catalogue: market must be null");
    if (r.kind !== "scalar") p.push('catalogue: kind must be "scalar" (the feed fixes the unit)');
    // two of a game's three results (espn.ts PairOutcome, owner 2026-10-13) only exist where a game can end in a draw: the soccer leagues,
    // whose ESPN ids all carry a dot ("eng.1", "uefa.champions"); a league id without one (nba, nfl, mlb, nhl, college) has no draws
    // (pinned in test/burntickerThreeWayOutcomes.test.ts). The catalogue (parseEspnSeries) refuses the same ids at launch and registration.
    if (series && PAIR_OUTCOME_SERIES_RE.test(series) && (/^espn\.(team|game):[a-z0-9]+-/.test(series) || MEETINGS_PAIR_RE.test(series))) p.push("catalogue: a coin on two of the three results (win or draw, draw or loss, win or loss) needs a league with draws, and not a head-to-head series");
  }
  const filter = (r.filter ?? {}) as SelectorFilter;
  if (typeof filter !== "object" || Array.isArray(filter)) p.push("filter must be an object");
  else {
    if (filter.tickerIncludes !== undefined && (typeof filter.tickerIncludes !== "string" || !/^[A-Z0-9._-]{1,32}$/.test(filter.tickerIncludes))) p.push("filter.tickerIncludes must be 1–32 ticker characters");
    if (filter.titleRegex !== undefined) {
      if (typeof filter.titleRegex !== "string" || filter.titleRegex.length > 120) p.push("filter.titleRegex must be a string ≤ 120 chars");
      else {
        // prelaunch audit H6: every rule check refuses a pattern the safe matcher refuses (the back-test and the API validate through here)
        let compiles = true;
        try { new RegExp(filter.titleRegex); } catch { compiles = false; p.push("filter.titleRegex is not a valid regular expression"); }
        const why = compiles && !o.stored ? regexProblem(filter.titleRegex) : null;
        if (why) p.push(`filter.titleRegex: ${why}`);
      }
    }
    if (market !== null && (filter.tickerIncludes !== undefined || filter.titleRegex !== undefined)) p.push("a one-market rule takes no filter");
    for (const k of Object.keys(filter)) if (k !== "tickerIncludes" && k !== "titleRegex") p.push(`filter.${k} is not a known key`);
    if (r.oracle === "derby" && Object.keys(filter).length) p.push("derby: filter must be {} (the derby block is the whole selector)");
  }
  if (r.kind !== "binary" && r.kind !== "scalar") p.push('kind must be "binary" or "scalar"');
  const oneShot = market !== null || (r.oracle === "derby" && (derby as { selector?: string; flip?: boolean } | undefined)?.selector === "coinvs" && (derby as { flip?: boolean }).flip === true) || (r.oracle === "derby" && (derby as { selector?: string; once?: boolean } | undefined)?.selector === "high" && (derby as { once?: boolean }).once === true) || (r.oracle === "catalogue" && typeof series === "string" && KEEPER_ONE_SHOT_RE.test(series));
  const checkMapping = (label: string, m: unknown): void => {
    if (!isMapping(m)) { p.push(`${label} must be { fractionOfPool } or { tokens }`); return; }
    const mode = mappingMode(m);
    if (!mode) { p.push(`${label} must set exactly one of fractionOfPool, tokens`); return; }
    for (const k of Object.keys(m)) if (k !== "fractionOfPool" && k !== "tokens") p.push(`${label}.${k} is not a known key`);
    if (mode === "buyback") {
      const f = m.fractionOfPool as number;
      const max = oneShot ? ONE_SHOT_MAX_FRACTION : RULE_BOUNDS.fractionOfPool.max;
      if (typeof f !== "number" || !Number.isFinite(f) || f < RULE_BOUNDS.fractionOfPool.min || f > max || Math.round(f * 1e6) !== f * 1e6) p.push(`${label}.fractionOfPool must be a number in [${RULE_BOUNDS.fractionOfPool.min}, ${max}] with ≤ 6 decimals${oneShot ? "" : " (a one-shot may go to 1.00)"}`);
    } else {
      const t = m.tokens as number;
      if (!Number.isInteger(t) || t < RULE_BOUNDS.tokens.min || t > RULE_BOUNDS.tokens.max) p.push(`${label}.tokens must be a whole number in [${RULE_BOUNDS.tokens.min}, ${RULE_BOUNDS.tokens.max}]`);
    }
  };
  if (r.kind === "binary") {
    if (!r.binary || typeof r.binary !== "object") p.push("binary: { onYes, onNo } required");
    else {
      const hasYes = r.binary.onYes !== null && r.binary.onYes !== undefined, hasNo = r.binary.onNo !== null && r.binary.onNo !== undefined;
      if (!hasYes && !hasNo) p.push("binary: at least one of onYes, onNo");
      if (hasYes) checkMapping("binary.onYes", r.binary.onYes);
      if (hasNo) checkMapping("binary.onNo", r.binary.onNo);
    }
    if (r.scalar) p.push("binary rule: scalar must be null");
  }
  // Rivalry pair: tier-1 (adjudicated market) sources only in v1; a scalar side needs a direction that can be flipped (not abs).
  const pair = r.pair ?? null;
  if (pair !== null) {
    if (typeof pair !== "object") p.push("pair must be { pairId, side, counterpartMint } or null");
    else {
      if (typeof pair.pairId !== "string" || !/^[a-z0-9][a-z0-9-]{3,39}$/.test(pair.pairId)) p.push("pair.pairId must be 4–40 lowercase letters/digits/dashes");
      if (pair.side !== "A" && pair.side !== "B") p.push('pair.side must be "A" or "B"');
      if (pair.counterpartMint !== null && (typeof pair.counterpartMint !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(pair.counterpartMint))) p.push("pair.counterpartMint must be a Solana address or null");
      if (pair.side === "B" && pair.counterpartMint === null) p.push("pair side B must name side A's mint as counterpartMint");
      if (!PAIR_ORACLES.includes(r.oracle as OracleId) && !isMeetingsRule(r) && pair.game === undefined) p.push("pair: v1 pairs must use a tier-1 adjudicated market source (kalshi or polymarket), a Burn Derby coin-vs-coin selector, or a head-to-head season series between two teams");
      if (isMeetingsRule(r) && r.kind === "scalar" && r.scalar && r.scalar.direction !== "up") p.push('pair: a head-to-head series side counts its own team\'s wins (direction "up"); the other team\'s coin reads the mirror series');
      if (r.oracle === "derby" && (derby as DerbySpec | undefined)?.selector === "bracket") p.push("pair: a bracket fan coin is a single coin (coin-vs-coin and single-asset derby rules pair)");
      if (r.kind === "scalar" && r.scalar && r.scalar.direction === "abs") p.push('pair: a scalar side needs direction "up" or "down" (abs cannot be inverted)');
      if (r.kind === "binary" && r.binary && r.binary.onYes && r.binary.onNo) p.push("pair: a binary side burns on exactly one outcome (onYes or onNo, not both)");
      const hasClause = pair.clause !== undefined || pair.voidBy !== undefined;
      if (hasClause) {
        if (pair.clause !== PAIR_CLAUSE) p.push(`pair.clause must be "${PAIR_CLAUSE}"`);
        if (typeof pair.voidBy !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(pair.voidBy) || new Date(`${pair.voidBy}T00:00:00Z`).toISOString().slice(0, 10) !== pair.voidBy) p.push("pair.voidBy must be a YYYY-MM-DD date (UTC)");
      }
      if (pair.winnerTakesBurn !== undefined && pair.winnerTakesBurn !== true) p.push("pair.winnerTakesBurn must be true or absent (pairs created before 2026-10-11 carry none)");
      // two candidates of one race: each side on its own outcome market, both markets locked in both rules (raceProblems)
      if (pair.race !== undefined) { p.push(...raceProblems(r as Parameters<typeof raceProblems>[0])); if (pair.winnerTakesBurn !== true) p.push("pair.race: a candidates pair is a winner-takes-the-burn pair (pair.winnerTakesBurn: true)"); }
      // two teams in one game: each side on its own team's win series of that game (gameProblems)
      if (pair.game !== undefined) { p.push(...gameProblems(r as Parameters<typeof gameProblems>[0])); if (pair.winnerTakesBurn !== true) p.push("pair.game: a one-game pair is a winner-takes-the-burn pair (pair.winnerTakesBurn: true)"); }
      for (const k of Object.keys(pair)) if (!["pairId", "side", "counterpartMint", "clause", "voidBy", "winnerTakesBurn", "race", "game"].includes(k)) p.push(`pair.${k} is not a known key`);
    }
  }
  if (r.kind === "scalar") {
    const s = r.scalar;
    if (!s || typeof s !== "object") p.push("scalar: { unit, perUnit, baseline, direction } required");
    else {
      if (typeof s.unit !== "number" || !Number.isFinite(s.unit) || s.unit < RULE_BOUNDS.unitMinPositive) p.push("scalar.unit must be a positive number");
      checkMapping("scalar.perUnit", s.perUnit);
      if (s.baseline !== "previousSettlement" && (typeof s.baseline !== "number" || !Number.isFinite(s.baseline))) p.push('scalar.baseline must be "previousSettlement" or a number');
      if (s.direction !== "up" && s.direction !== "down" && s.direction !== "abs") p.push('scalar.direction must be "up", "down" or "abs"');
    }
    if (r.binary) p.push("scalar rule: binary must be null");
  }
  if (r.onVoid !== "skip") p.push('onVoid must be "skip"');
  const set = (r as { set?: unknown }).set;
  if (set !== undefined && set !== null) {
    const l = set as { id?: unknown; outcome?: unknown; forwardBps?: unknown };
    if (typeof l !== "object" || typeof l.id !== "string" || !/^[a-z0-9][a-z0-9-]{2,47}$/.test(l.id) || typeof l.outcome !== "string" || !/^[A-Za-z0-9._:\/-]{1,64}$/.test(l.outcome) || !Number.isInteger(l.forwardBps) || (l.forwardBps as number) < 0 || (l.forwardBps as number) > 10_000 || Object.keys(l).some((k) => !["id", "outcome", "forwardBps"].includes(k))) p.push("set must be { id: 3–48 lowercase letters/digits/dashes, outcome: 1–64 id characters, forwardBps: 0–10,000 }");
    if ((r as { onEnd?: unknown }).onEnd === undefined || (r as { onEnd?: unknown }).onEnd === null) p.push("an outcome set needs the onEnd clause (the leftover that is not forwarded winds down on this coin)");
    // A team coin of one league season (an ESPN team series with a season or postseason window) is a member of that league's set: the
    // champion is the winner. Every other catalogue / scalar series has no winner (league mode on the create screen, 2026-10-10).
    const leagueSeason = r.oracle === "catalogue" && /^espn\.team:[a-z0-9.]+-[A-Z]{2,5}\.\d{1,6}-(win|loss|draw)-[sp]\d{4}$/.test(r.series ?? "");
    if ((r.kind === "scalar" || r.oracle === "catalogue") && !leagueSeason) p.push("an outcome set needs a selector with an outcome list (scalar feeds such as debt, CPI or weather have no winner)");
  }
  // THE FADE SIDE (inverse.ts): true or absent; only where inverseRefusal allows it.
  const inverse = (r as { inverse?: unknown }).inverse;
  if (inverse !== undefined && inverse !== null) {
    if (inverse !== true) p.push("inverse must be true or absent");
    else { const why = inverseRefusal({ oracle: r.oracle as OracleId, kind: r.kind as BurnRule["kind"], series, market, pair: (r.pair ?? null) as BurnRule["pair"], set, derby }); if (why) p.push(`inverse: ${why}`); }
  }
  const onEnd = (r as { onEnd?: unknown }).onEnd;
  if (onEnd !== undefined && onEnd !== null) {
    const o = onEnd as { windDownDays?: unknown; sweepThresholdLamports?: unknown; endSink?: unknown; mint?: unknown; ticker?: unknown };
    if (typeof o !== "object" || !Number.isInteger(o.windDownDays) || (o.windDownDays as number) < 7 || (o.windDownDays as number) > 90 || !Number.isInteger(o.sweepThresholdLamports) || (o.sweepThresholdLamports as number) < 1_000_000 || (o.sweepThresholdLamports as number) > 10_000_000_000 || (o.endSink !== undefined && o.endSink !== true && o.endSink !== "incinerator") || Object.keys(o).some((k) => !["windDownDays", "sweepThresholdLamports", "endSink", "mint", "ticker"].includes(k))) p.push("onEnd must be { windDownDays: 7–90, sweepThresholdLamports: 1,000,000–10,000,000,000, endSink?: true | \"incinerator\", mint?: <coin mint>, ticker?: <its ticker> }");
    // the named-coin end sink: a mint and its ticker together, on a rule with the end sink, never on a pair-winner pair
    if (o.mint !== undefined || o.ticker !== undefined) {
      if (typeof o.mint !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(o.mint) || typeof o.ticker !== "string" || !/^[A-Z0-9]{1,10}$/.test(o.ticker)) p.push("onEnd.mint and onEnd.ticker name the coin whose burn takes the rest: a mint address and its ticker (capital letters and digits), both or neither");
      if (o.endSink !== true) p.push("onEnd.mint needs onEnd.endSink: true");
      if ((r.pair as { winnerTakesBurn?: unknown } | null | undefined)?.winnerTakesBurn === true) p.push("onEnd.mint: a winner-takes-the-burn pair sends the rest to the pair winner, so it cannot name another coin");
    }
    // §45: league sets (the champion coin of a league season) are a later program round; the program refuses that sink kind today.
    if ((o.endSink === true || o.endSink === "incinerator") && set !== undefined && set !== null) p.push("onEnd.endSink cannot be combined with an outcome set yet (league-set end sinks are a later program round)");
    if (o.endSink === "incinerator" && r.pair !== undefined && r.pair !== null) p.push("onEnd.endSink \"incinerator\" is for a single coin: a paired coin ends on the pair-winner sink (endSink: true)");
  }
  if (typeof r.floorUsd !== "string" || !/^\d+(\.\d{1,2})?$/.test(r.floorUsd)) p.push("floorUsd must be a decimal string with ≤ 2 decimals");
  if (typeof r.reserveSol !== "string" || !/^\d+(\.\d{1,9})?$/.test(r.reserveSol)) p.push("reserveSol must be a decimal string with ≤ 9 decimals");
  // Mode agreement and the vault block.
  const modes = new Set(ruleMappings({ kind: r.kind as BurnRule["kind"], binary: (r.binary ?? null) as BurnRule["binary"], scalar: (r.scalar ?? null) as BurnRule["scalar"] }).map((x) => (isMapping(x.mapping) ? mappingMode(x.mapping) : null)));
  if (modes.size > 1) p.push("all mappings must use the same mode (fractionOfPool everywhere, or tokens everywhere) — hybrid is v2");
  const mode = modes.size === 1 ? [...modes][0] : null;
  const vault = r.vault ?? null;
  if (mode === "vault") {
    if (!vault || typeof vault !== "object") p.push("vault mode: vault { share, vestDays, cliffDays } required");
    else {
      if (typeof vault.share !== "number" || vault.share < RULE_BOUNDS.vaultShare.min || vault.share > RULE_BOUNDS.vaultShare.max || Math.round(vault.share * 100) !== vault.share * 100) p.push(`vault.share must be in [${RULE_BOUNDS.vaultShare.min}, ${RULE_BOUNDS.vaultShare.max}] with ≤ 2 decimals`);
      if (!Number.isInteger(vault.vestDays) || vault.vestDays < 30 || vault.vestDays > 1460) p.push("vault.vestDays must be a whole number 30–1460");
      if (!Number.isInteger(vault.cliffDays) || vault.cliffDays < 0 || vault.cliffDays > 365) p.push("vault.cliffDays must be a whole number 0–365");
    }
  } else if (vault !== null) p.push("buyback mode: vault must be null");
  const burnTarget = (r as { burnTarget?: unknown }).burnTarget;
  if (burnTarget !== undefined && burnTarget !== null) {
    p.push(...burnTargetShapeProblems(burnTarget));
    if (mode === "vault") p.push("burnTarget: a vault-mode coin has no burn pool to spend on a target");
  }
  for (const k of Object.keys(r)) if (!["schema", "oracle", "series", "market", "filter", "kind", "binary", "scalar", "onVoid", "floorUsd", "reserveSol", "vault", "pair", "derby", "onEnd", "set", "inverse", "burnTarget"].includes(k)) p.push(`${k} is not a known key`);
  if (p.length) throw new Error(`rule: ${p.join("; ")}`);
  return {
    schema: BURNTICKER_RULES_SCHEMA, oracle: r.oracle as OracleId, series, market, filter,
    kind: r.kind as BurnRule["kind"],
    binary: r.kind === "binary" ? { onYes: r.binary!.onYes ?? null, onNo: r.binary!.onNo ?? null } : null,
    scalar: r.kind === "scalar" ? { unit: r.scalar!.unit, perUnit: r.scalar!.perUnit, baseline: r.scalar!.baseline, direction: r.scalar!.direction } : null,
    onVoid: "skip", floorUsd: r.floorUsd as string, reserveSol: r.reserveSol as string, vault: mode === "vault" ? vault : null,
    pair: pair === null ? null : { pairId: pair.pairId, side: pair.side, counterpartMint: pair.counterpartMint ?? null, ...(pair.clause !== undefined ? { clause: pair.clause, voidBy: pair.voidBy } : {}), ...(pair.winnerTakesBurn === true ? { winnerTakesBurn: true as const } : {}), ...(pair.race ? { race: { slug: pair.race.slug, markets: [pair.race.markets[0], pair.race.markets[1]] as [string, string] } } : {}), ...(pair.game ? { game: { series: [pair.game.series[0], pair.game.series[1]] as [string, string] } } : {}) },
    ...(set !== undefined && set !== null ? { set: { id: (set as { id: string }).id, outcome: (set as { outcome: string }).outcome, forwardBps: (set as { forwardBps: number }).forwardBps } } : {}),
    ...(onEnd !== undefined && onEnd !== null ? { onEnd: { windDownDays: (onEnd as { windDownDays: number }).windDownDays, sweepThresholdLamports: (onEnd as { sweepThresholdLamports: number }).sweepThresholdLamports, ...((onEnd as { endSink?: unknown }).endSink === true ? { endSink: true as const } : (onEnd as { endSink?: unknown }).endSink === "incinerator" ? { endSink: "incinerator" as const } : {}), ...(typeof (onEnd as { mint?: unknown }).mint === "string" ? { mint: (onEnd as { mint: string }).mint, ticker: (onEnd as { ticker: string }).ticker } : {}) } } : {}),
    ...(r.oracle === "derby" ? { derby: derby as DerbySpec } : {}),
    ...(inverse === true ? { inverse: true as const } : {}),
    ...(burnTarget !== undefined && burnTarget !== null ? { burnTarget: { mint: (burnTarget as BurnTargetField).mint, pool: (burnTarget as BurnTargetField).pool, symbol: (burnTarget as BurnTargetField).symbol, feedId: (burnTarget as BurnTargetField).feedId } } : {}),
  };
}

/**
 * RIVALRY: side B's rule from side A's — the same selector, the mapping inverted (binary: swap onYes/onNo; scalar: flip up↔down),
 * the same pairId, side "B", side A's mint as counterpart. Validated, so an un-invertible side A (abs, or a binary that burns on
 * both outcomes) throws. Each side is then hashed on its own (lockRule): two rules, two hashes, one pairId in both.
 */
export function invertMapping(a: BurnRule, counterpartMint: string | null, pairId: string = a.pair?.pairId ?? ""): BurnRule {
  // Round 5: a burn target is chosen per side ("Burn the real <symbol>" on each tile), so side B never inherits side A's.
  const { burnTarget: _sideATarget, ...rest } = a;
  void _sideATarget;
  const base = { ...rest, pair: { ...(a.pair ?? {}), pairId, side: "B" as const, counterpartMint } };
  if (a.kind === "binary" && a.binary) return validateRule({ ...base, binary: { onYes: a.binary.onNo, onNo: a.binary.onYes } });
  if (a.kind === "scalar" && a.scalar) return validateRule({ ...base, scalar: { ...a.scalar, direction: a.scalar.direction === "up" ? "down" : a.scalar.direction === "down" ? "up" : "abs" } });
  throw new Error("invertMapping: not a binary or scalar rule");
}

/**
 * The other side's mapping applied to THIS coin (winner takes the burn): binary onYes/onNo swapped, scalar direction flipped. Used to
 * compute the units a losing coin "would have had had it won" for a result (its fuel forwards with those units) — and by the receipt
 * check to recompute a lost receipt. Not validated (a mirror is never a published rule).
 */
export function pairMirrorRule(r: BurnRule): BurnRule {
  if (r.kind === "binary" && r.binary) return { ...r, binary: { onYes: r.binary.onNo, onNo: r.binary.onYes } };
  if (r.kind === "scalar" && r.scalar) return { ...r, scalar: { ...r.scalar, direction: r.scalar.direction === "up" ? "down" : r.scalar.direction === "down" ? "up" : r.scalar.direction } };
  return r;
}
/** One-shot winner-takes-the-burn pairs move the whole pool (owner decision 2026-10-11): every mapping of the rule at 100 %. */
export function withFullFraction(r: BurnRule): BurnRule {
  const full = (m: BurnMapping | null): BurnMapping | null => (m && m.fractionOfPool !== undefined ? { fractionOfPool: 1 } : m);
  if (r.kind === "binary" && r.binary) return { ...r, binary: { onYes: full(r.binary.onYes), onNo: full(r.binary.onNo) } };
  if (r.kind === "scalar" && r.scalar) return { ...r, scalar: { ...r.scalar, perUnit: full(r.scalar.perUnit)! } };
  return r;
}

/** A pair id from the two tickers and the selector (lowercase, dashed; deterministic so a retry does not mint a second pair). */
export function pairIdFor(tickerA: string, tickerB: string, selector: string): string {
  return `${tickerA}-vs-${tickerB}-${selector}`.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 40).replace(/-$/, "");
}

/** Keys sorted at every level, two-space indent, trailing newline — one spelling per rule. */
export function canonicalJson(v: unknown): string {
  const sort = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(sort);
    if (x && typeof x === "object") return Object.fromEntries(Object.keys(x as object).sort().map((k) => [k, sort((x as Record<string, unknown>)[k])]));
    return x;
  };
  return `${JSON.stringify(sort(v), null, 2)}\n`;
}

export interface LockedRule { rule: BurnRule; text: string; sha256: string; sha12: string; mode: RuleMode }

/** Validate → canonical text → hash. The text is what gets stored and published; the hash is of exactly those bytes. */
export function lockRule(raw: unknown, o: { stored?: boolean } = {}): LockedRule {
  const rule = validateRule(raw, o);
  const text = canonicalJson(rule);
  const sha256 = rulesSha256(text);
  return { rule, text, sha256, sha12: sha256.slice(0, 12), mode: ruleMode(rule) };
}

/** Parse a stored canonical text back; refuses text whose bytes do not re-serialise to themselves (an edited rules.json). */
export function rulesFromText(text: string): LockedRule {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new Error("rule: not valid JSON"); }
  const locked = lockRule(raw, { stored: true });
  if (locked.text !== text) throw new Error("rule: the text is not in canonical form (re-serialising it changes the bytes, so its hash would not be the published one)");
  return locked;
}

const pctOf = (f: number) => `${(f * 100).toFixed(f * 100 % 1 === 0 ? 0 : 2)}%`;
const mapText = (m: BurnMapping, what: string) => (m.fractionOfPool !== undefined ? (m.fractionOfPool >= 1 ? `spends the whole fee pool (100%) buying the token at market ${what} — across daily cranks, each at most 2% of the pool's reserve, until nothing is carried — and burns everything received` : `spends ${pctOf(m.fractionOfPool)} of the fee pool buying the token at market and burns everything received ${what}`) : `burns ${m.tokens!.toLocaleString("en-US")} tokens from the vault ${what}`);

/** The rule in one plain paragraph for the review step and the token page. States the rule; says nothing about price. */
/** A Polymarket selector in words ("every binary Polymarket market tagged nfl of type moneyline whose event slug matches nfl-*den-*"). */
export function polySelectorText(r: Pick<BurnRule, "series" | "market" | "filter">, names: { seriesTitle?: string | null; marketTitle?: string | null } = {}): string {
  const re = r.filter.titleRegex ? ` whose question matches /${r.filter.titleRegex}/` : "";
  if (r.market) { const t = names.marketTitle ?? names.seriesTitle; return `the Polymarket market ${r.market}${t ? ` ("${t}")` : ""}`; }
  const t = POLY_TAG_SERIES_RE.exec(r.series ?? "");
  if (t) return `every binary Polymarket market tagged "${t[1]}"${names.seriesTitle && names.seriesTitle !== t[1] ? ` (${names.seriesTitle})` : ""}${t[2] ? ` of type ${t[2]}` : ""}${t[3] ? ` whose event slug matches ${t[3]}` : ""}${re}`;
  const e = POLY_EVENT_SERIES_RE.exec(r.series ?? "");
  return `every binary market of the Polymarket event ${e ? e[1] : r.series}${names.seriesTitle ? ` ("${names.seriesTitle}")` : ""}${re}`;
}

/** The both-or-neither clause in words ("" without one). Lint-clean (no future tense, nothing about price). */
export function pairClauseText(r: Pick<BurnRule, "pair">): string {
  const c = pairClause(r);
  if (!c) return "";
  return ` Both or neither: event burns on either side apply only once both coins have a registered pool; a settlement read before that waits as a pending-pair receipt and executes, in order, when the second pool registers. If either side has no registered pool when ${c.voidBy} ends (UTC), the pair voids: no event burn on either side, ever, and the rule has ended.`;
}

/**
 * The winner-takes-the-burn clause in words ("" when the pair carries none). Lint-clean: nothing is won or paid; fuel moves between burn
 * pools and burns the winner's coin.
 */
export function winnerTakesBurnText(r: Pick<BurnRule, "pair" | "market">): string {
  if (!pairWinnerTakesBurn(r)) return "";
  const oneShot = !!r.market || !!r.pair?.game;
  return ` Winner takes the burn: ${WINNER_TAKES_BURN_LINE.toLowerCase()} At each result the other coin's fuel for that result (its own fraction of its own burn pool${oneShot ? ", all of it for this one-shot pair" : ""}) moves to the winning coin's burn pool, and the winning coin's next burn buys and burns the winning coin; the other coin's supply is untouched and nobody is paid. A draw or a void moves nothing.${oneShot ? " After the result, whatever the other coin's burn pool still spends (its end-of-rule burns and later sweeps) also goes to the winning coin's burn pool while that coin is live." : ""}`;
}

/** The onEnd clause in words ("" without one); `endDate` names the day the rule ends when it is known (a one-shot's settlement date). */
/**
 * Walkthrough 13: the champion path's series in the statement, without importing the sports source into this module (the SDK's closure
 * keeps rules.ts free of src/lib/burnticker/sources and config). A team's WINS over a whole season in a league whose schedule can tell a
 * champion (espn.ts CHAMPION_KNOWN: MLB, the NBA, the NHL, the NFL); test/burntickerWalkthrough13.test.ts pins it to espn.ts championSeries.
 */
export const CHAMPION_SERIES_RE = /^espn\.team:(mlb|nba|nhl|nfl)-[A-Z0-9]{2,6}\.\d{1,7}-win-s\d{4}$/;
// launch wizard audit 2026-10-19 F11: `voidWords` names what voids THIS rule (a one-shot reading), else the general list stands
export function onEndText(r: Pick<BurnRule, "onEnd" | "set" | "pair" | "kind" | "binary" | "scalar">, endDate: string | null = null, voidWords: string | null = null): string {
  if (!r.onEnd) return "";
  const sink = endSinkOf(r);
  if (sink) {
    const weeks0 = r.onEnd.windDownDays % 7 === 0 ? `${r.onEnd.windDownDays / 7 === 4 ? "four" : r.onEnd.windDownDays / 7} weeks` : `${r.onEnd.windDownDays} days`;
    const where = sink === "pair-winner" ? "the winning coin's burn pool when the partner coin won the last result and is still live, and $DEFICIT's burn pool otherwise" : sink === "mint" ? `$${r.onEnd.ticker}'s burn pool (coin ${r.onEnd.mint}) when that coin is live then, and $DEFICIT's burn pool otherwise` : "$DEFICIT's burn pool (the platform's flagship coin)";
    // owner decision 2026-10-19 (nextResult.ts oneShotFull): one burn of the whole pool; what the end sends on is what reaches the pool later
    const once = oneShotFull(r as BurnRule) && !r.pair;
    if (once) {
      const voidTail = ` When the rule ends void (${voidWords ?? "a voided market or a cancelled season"}), whatever is left burns down on this coin on a daily clock over ${weeks0} (at least 99% of it), then the coin retires, and later fee income is swept and burned whenever it passes ${r.onEnd.sweepThresholdLamports / 1e9} SOL (at most once a week).`;
      const later = `The rule resolves once${endDate ? ` (${endDate} at the latest)` : ""} and spends the whole burn pool in that one burn. After it, whatever reaches the burn pool later (trading fees that arrive after the burn, the reserve the rule keeps back on every crank, and rounding)`;
      const noBurn = hasNoBurnOutcome(r) ? ` If the rule ends with the result that burns nothing, whatever is left in the burn pool goes the same way.` : "";
      if (sink === "incinerator") return ` ${later} is sent to Solana's incinerator (${INCINERATOR_ADDRESS}), which nothing can spend from; no coin is swapped for it, nothing is refunded and nobody is paid.${noBurn}${voidTail}`;
      return ` ${later} moves to ${where} and burns that coin; nothing is refunded and nobody is paid.${noBurn}${voidTail}`;
    }
    if (sink === "incinerator") return ` When the rule ends with a result${endDate ? ` (${endDate} at the latest for a one-shot)` : ""}, whatever SOL is left in the burn pool is sent to Solana's incinerator (${INCINERATOR_ADDRESS}), which nothing can spend from, and so is any fee income that arrives after that; no coin is swapped for it, nothing is refunded and nobody is paid. When the rule ends void (${voidWords ?? "a voided market or a cancelled season"}), whatever is left burns down on this coin on a daily clock over ${weeks0} (at least 99% of it), then the coin retires, and later fee income is swept and burned whenever it passes ${r.onEnd.sweepThresholdLamports / 1e9} SOL (at most once a week).`;
    // walkthrough 13: the champion path (describe.ts championPathRule, endSinkKeeper championVerdict) is in the statement too; the coin's
    // description said it and the keeper does it, but the locked rule's statement sent every result end to the sink
    const full = r as Partial<BurnRule>;
    const champion = (sink === "flagship" || sink === "mint") && full.oracle === "catalogue" && !full.inverse && !full.set && CHAMPION_SERIES_RE.test(full.series ?? "");
    if (champion) return ` When the season ends and the team won the championship (its last game is a win this coin burned on), whatever is left in the burn pool burns down on this coin on a daily clock over ${weeks0} (at least 99% of it), then the coin retires. When the rule ends with any other result, whatever is left in the burn pool moves to ${where} and burns that coin, and so does any fee income that arrives after that; nothing is refunded and nobody is paid. When the rule ends void (${voidWords ?? "a voided market, a voided pair or a cancelled season"}), whatever is left burns down on this coin on a daily clock over ${weeks0} (at least 99% of it), then the coin retires, and later fee income is swept and burned whenever it passes ${r.onEnd.sweepThresholdLamports / 1e9} SOL (at most once a week).`;
    return ` When the rule ends with a result${endDate ? ` (${endDate} at the latest for a one-shot)` : ""}, whatever is left in the burn pool moves to ${where} and burns that coin, and so does any fee income that arrives after that; nothing is refunded and nobody is paid. When the rule ends void (${voidWords ?? "a voided market, a voided pair or a cancelled season"}), whatever is left burns down on this coin on a daily clock over ${weeks0} (at least 99% of it), then the coin retires, and later fee income is swept and burned whenever it passes ${r.onEnd.sweepThresholdLamports / 1e9} SOL (at most once a week).`;
  }
  const lg = r.set && r.set.forwardBps > 0 ? ` and ${Math.round(r.set.forwardBps) / 100}% of the leftover burns the winning coin of set ${r.set.id} once the program's forward_to_winner instruction is live (queued, not deployed); when it is not — or there is no winning coin, or it is not graduated — all of it stays here`: "";
  const weeks = r.onEnd.windDownDays % 7 === 0 ? `${r.onEnd.windDownDays / 7 === 4 ? "four" : r.onEnd.windDownDays / 7} weeks` : `${r.onEnd.windDownDays} days`;
  return ` When the rule ends for any reason${endDate ? ` (${endDate} at the latest for a one-shot)` : ""}${lg}, whatever is left in the burn pool burns down on a daily clock over ${weeks} (at least 99% of it), then the coin retires; fee income that arrives after that is swept and burned whenever it passes ${r.onEnd.sweepThresholdLamports / 1e9} SOL (at most once a week) — no pool is left behind.`;
}

export function ruleStatement(r: BurnRule, names: { seriesTitle?: string | null; marketTitle?: string | null; feedTitle?: string | null; /** audit 6 item 26: the catalogue unit in words ("1 win", "$1B added") */ unitLabel?: string | null } = {}): string {
  if (r.oracle === "derby" && r.derby) {
    const m = ruleMappings(r)[0]?.mapping;
    const burn = m ? mapText(m, r.derby.selector === "coinvs" ? "for that window" : "per unit") : "burns nothing";
    if (r.derby.selector === "high") return `${derbyStatement(r.derby, null, null, null)} On a record day, the keeper ${m ? mapText(m, r.derby.once ? "once" : "for that day") : "burns nothing"}.${onEndText(r)}`;
    return `${derbyStatement(r.derby, r.pair?.side ?? null, r.pair?.pairId ?? null, r.scalar ? { unit: r.scalar.unit, direction: r.scalar.direction } : null)} On a window this coin wins, the keeper ${burn}. A voided (tied) window burns nothing.${pairClauseText(r)}${winnerTakesBurnText(r)}${onEndText(r)}`;
  }
  // ChatGPT audit 6 item 26: a catalogue source is named by its title, never by its id ("espn.team:mlb-LAD.19-win-s2026"); a caller
  // without the title gets "this coin's source" (the rule's canonical text and fingerprint carry the id)
  const what = r.oracle === "catalogue" ? (names.feedTitle ? `the source "${names.feedTitle}"` : "this coin's source")
    : r.oracle === "polymarket" ? polySelectorText(r, names)
    : r.market ? `the Kalshi market ${r.market}${names.marketTitle ? ` ("${names.marketTitle}")` : ""}`
    : `every market in the Kalshi series ${r.series}${names.seriesTitle ? ` ("${names.seriesTitle}")` : ""}${r.filter.tickerIncludes ? ` whose ticker contains "${r.filter.tickerIncludes}"` : ""}${r.filter.titleRegex ? ` whose title matches /${r.filter.titleRegex}/` : ""}`;
  if (r.kind === "binary" && r.binary) {
    const yes = r.binary.onYes ? `When ${what} settles YES, the keeper ${mapText(r.binary.onYes, "for that market")}.` : `A YES settlement of ${what} burns nothing.`;
    const no = r.binary.onNo ? ` When it settles NO, ${r.binary.onYes ? "it" : "the keeper"} ${mapText(r.binary.onNo, "for that market")}.` : " A NO settlement burns nothing.";
    const pair = r.pair?.race ? ` Candidates pair ${r.pair.pairId}, side ${r.pair.side}: the other coin follows the other candidate's market (${candidatesPartnerMarket(r)}) of the same race (${r.pair.race.slug}). The race counts once, when both markets are final: if exactly one of the two settles YES, that coin won the race and the other lost it; if both settle NO, both settle YES or either one splits its payout, neither coin won and the result moves nothing between them.`
      : r.pair ? ` Rivalry pair ${r.pair.pairId}, side ${r.pair.side}: the other side burns on the opposite outcome, so each settlement burns exactly one of the two.` : "";
    const poly = r.oracle === "polymarket" ? " YES is the market's first outcome and NO its second; the result is the payout the Conditional Tokens contract on Polygon records, and a 50-50 resolution is a void." : "";
    return `${yes}${no}${pair}${pairClauseText(r)}${winnerTakesBurnText(r)}${poly} A voided market burns nothing. Settled results only; prices are never read.${onEndText(r)}`;
  }
  const s = r.scalar!;
  const base = s.baseline === "previousSettlement" ? "the previous settlement" : `a fixed baseline of ${s.baseline}`;
  if (r.inverse) {
    const did = s.direction === "up" ? "rise above" : s.direction === "down" ? "fall below" : "move away from";
    return `Each time ${what} ${r.oracle === "catalogue" ? "publishes a reading" : "settles"}, a reading that does not ${did} ${base} is one unit, and the keeper ${mapText(s.perUnit, "per unit")}. A reading that does ${did} it, by any amount, burns nothing. ${r.oracle === "catalogue" ? "A voided reading" : "A voided market"} burns nothing. Settled results only; prices are never read.${onEndText(r)}`;
  }
  const dir = s.direction === "up" ? "above" : s.direction === "down" ? "below" : "away from (either direction)";
  const pair = r.pair?.game ? ` One-game pair ${r.pair.pairId}, side ${r.pair.side}: the other coin counts the other team's win in the same game (${r.pair.game.series[r.pair.side === "A" ? 1 : 0]}). The game counts once both results are final: the coin of the team that won burns, the other coin's pool moves to its burn, and a draw moves nothing between them.${pairClauseText(r)}${winnerTakesBurnText(r)}`
    : r.pair ? ` Rivalry pair ${r.pair.pairId}, side ${r.pair.side}: the other side counts the opposite direction.${pairClauseText(r)}${winnerTakesBurnText(r)}` : "";
  // LAUNCH WIZARD AUDIT 2026-10-19 F11: a catalogue rule that resolves once (the next earthquake, hurricane, tornado day, wildfire,
  // volcano warning or record TVL day, a named launch, a milestone, a single game, the first snow) has one qualifying reading, spent once;
  // it never read "each time ... every full 1 above a fixed baseline of 0 is one unit ... per unit". Derived text, not hashed.
  if (r.oracle === "catalogue" && resolvesOnce(r)) {
    const game = /^espn\.game:/.test(r.series ?? "");
    const voidWords = game ? (r.pair ? "a cancelled game or a voided pair" : "a voided or cancelled game") : isFirstSnowRule(r) ? "a voided reading, or a season that ends with no first snow" : r.pair ? "a voided reading or a voided pair" : "a voided reading";
    return `This rule resolves once. It fires on the first reading of ${what} after launch that counts${names.unitLabel ? ` (${names.unitLabel})` : ""}, and on that one result the keeper ${mapText(s.perUnit, "once")}. No later reading burns again.${pair} ${game ? "A voided or cancelled game" : "A voided reading"} burns nothing. Settled results only; prices are never read.${onEndText(r, null, voidWords)}`;
  }
  // a catalogue count ("1 win", "1 launch") from a baseline of 0 reads as a count; any other unit as "every <unit> <direction> <baseline>"
  const unitWords = names.unitLabel ? names.unitLabel : `full ${s.unit}`;
  const counted = r.oracle === "catalogue" && s.baseline === 0 && s.direction === "up" && !!names.unitLabel;
  const head = r.oracle === "catalogue" ? `Each time ${what} publishes a reading, ${counted ? `every ${unitWords} in it counts as one unit` : `every ${unitWords} ${dir} ${base} is one unit`}` : `Each time ${what} settles, every full ${s.unit} ${dir} ${base} is one unit`;
  return `${head}, and the keeper ${mapText(s.perUnit, "per unit")} (buyback spend compounds: pool × (1 − (1 − f)^units)).${pair} ${r.oracle === "catalogue" ? "A voided reading" : "A voided market"} burns nothing. Settled results only; prices are never read.${onEndText(r)}`;
}

/** The description footer: feed/selector, the rule hash and the fixed disclaimer. */
export function descriptionFooter(locked: LockedRule): string {
  const r = locked.rule;
  const src = r.oracle === "derby" ? `Burn Derby ${r.series}` : r.oracle === "catalogue" ? `feed ${r.series}${r.inverse ? " (burns when it does not happen)" : ""}` : r.oracle === "polymarket" ? (r.market ? `Polymarket market ${r.market}` : `Polymarket ${r.series}`) : r.market ? `Kalshi market ${r.market}` : `Kalshi series ${r.series}${r.filter.tickerIncludes ? ` (ticker ∋ ${r.filter.tickerIncludes})` : ""}`;
  return `— ${src} · rule sha256:${locked.sha12} · ${DISCLAIMER_FOOTER}`;
}
