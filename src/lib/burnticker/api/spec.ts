/**
 * THE PUBLIC API'S ONE SCHEMA SOURCE (2026-10-09; owner: "no tokens will be adopted into the platform, provide the sdk/api so people
 * can incorporate into bots"). Every v1 endpoint is declared ONCE here — method, path, parameters, request and response schemas,
 * cache lifetime and rate-limit bucket — and three things are generated from it: GET /api/burnticker/v1/openapi.json, the route
 * wrapper's cache + rate-limit behaviour (api/http.ts), and the route tests' response validation. Hand-written JSON Schema (OpenAPI
 * 3.1 = JSON Schema 2020-12), because the repository uses no schema library; nothing here is imported by the SDK.
 *
 * VERSIONING. Paths live under /v1. Within v1, changes are additive only (new endpoints, new optional request fields, new response
 * fields); a field is never removed, renamed or retyped, and an enum never loses a value. A breaking change is /v2, and /v1 keeps
 * answering for at least 90 days after /v2 ships, with a `Deprecation` header. `info.version` is the semver of this document.
 */

import { DERBY_ENDPOINTS, DERBY_SCHEMAS } from "@/lib/burnticker/api/derbySpec";
import { TRUSTPACK_ENDPOINTS, TRUSTPACK_SCHEMAS } from "@/lib/burnticker/trustpack/spec";
import { PRODUCT_ENDPOINTS, PRODUCT_SCHEMAS } from "@/lib/burnticker/api/productSpec";
import { BADGE_ENDPOINTS, BADGE_SCHEMAS } from "@/lib/burnticker/api/badgeSpec";
import { OPS_ENDPOINTS, OPS_SCHEMAS } from "@/lib/burnticker/ops/spec";

export type Bucket = "read" | "heavy" | "write";
type Schema = Record<string, unknown>;

export interface Param { name: string; in: "path" | "query"; required: boolean; description: string; schema: Schema }
export interface Endpoint {
  operationId: string; method: "GET" | "POST"; path: string; tag: string; summary: string; description: string;
  params: Param[]; request: string | null; response: string; errors: number[];
  /** Seconds a 200 may be cached (public, CDN + client). 0 = no-store. POST routes are never cached. */
  cacheSec: number;
  bucket: Bucket;
  /** Further 200 media types besides application/json (the badge's image/svg+xml and image/png, since 1.7.0). */
  media?: string[];
}

export const API_VERSION = "1.10.0";
export const API_PREFIX = "/api/burnticker/v1";

/** Requests per client: a token bucket of `burst`, refilled at `perMinute` (or `perHour`). One table, read by the limiter and the docs. */
export const RATE_LIMITS: Record<Bucket, { burst: number; refillPerSec: number; human: string }> = {
  read: { burst: 120, refillPerSec: 2, human: "120 requests burst, 120 per minute sustained" },
  heavy: { burst: 20, refillPerSec: 20 / 60, human: "20 requests burst, 20 per minute sustained (these call Kalshi or Polymarket, or re-read a source)" },
  write: { burst: 10, refillPerSec: 10 / 3600, human: "10 per hour (launch bundles and confirmations)" },
};

const ref = (name: string): Schema => ({ $ref: `#/components/schemas/${name}` });
const str: Schema = { type: "string" };
const nstr: Schema = { type: ["string", "null"] };
const int: Schema = { type: "integer" };
const num: Schema = { type: "number" };
const bool: Schema = { type: "boolean" };
const arr = (items: Schema): Schema => ({ type: "array", items });
const obj = (properties: Record<string, Schema>, required: string[] = [], extra: Schema = {}): Schema => ({ type: "object", properties, required, ...extra });
const nullable = (s: Schema): Schema => ({ anyOf: [s, { type: "null" }] });
const PUBKEY: Schema = { type: "string", pattern: "^[1-9A-HJ-NP-Za-km-z]{32,44}$" };

export const SCHEMAS: Record<string, Schema> = {
  ...DERBY_SCHEMAS,
  ...TRUSTPACK_SCHEMAS,
  ...PRODUCT_SCHEMAS,
  ...BADGE_SCHEMAS,
  ...OPS_SCHEMAS,
  Error: obj({ error: str, code: str, problems: arr(str), retryAfterSec: int }, ["error"]),
  // LP LOCKED FOREVER (since 1.8.0; owner decision 2026-10-10): graduation LP is 100 % locked with Raydium's LP lock, the Fee Key NFT is
  // owned by the burn program's fee-keys PDA, and the permissionless claim_lock_fees splits the SOL side 80 % burn pool / 20 % operator.
  LpLock: obj({
    policy: { const: "locked-forever" }, lockProgram: { ...PUBKEY, description: "Raydium's CPMM LP lock program for the cluster" },
    feeKey: { ...nullable(PUBKEY), description: "the Fee Key NFT mint (the locked position); null before graduation" },
    feeKeyOwner: { ...nullable(PUBKEY), description: "who holds the Fee Key: the burn_receipts PDA [\"fee_keys\"]" },
    lockedLiquidity: { ...nullable(PUBKEY), description: "Raydium's LockedCpLiquidityState [\"locked_liquidity\", feeKey]" },
    feeKeyRecord: { ...nullable(PUBKEY), description: "burn_receipts FeeKeyRecord [\"fee_key\", mint] (written by register_fee_key)" },
    feeKeyRegistered: bool, lockedPct: num,
    split: obj({ burnBps: { const: 8000 }, operatorBps: { const: 2000 }, coinSide: { const: "burned" }, fixedInCode: { const: true } }, ["burnBps", "operatorBps"]),
    operatorTreasury: { ...nullable(PUBKEY), description: "where claim_lock_fees pays the 20 % (the Squads vault compiled into the program); null = not pinned on this cluster (claims refuse TreasuryNotPinned and the fees stay in the lock)" },
    lastClaim: nullable(obj({ at: str, signature: str, sol: str, toBurnPool: str, toOperator: str, tokenBurnedRaw: str, txUrl: nstr, line: str }, ["at", "signature", "sol", "toBurnPool", "toOperator", "line"])),
    totals: obj({ claims: int, sol: str, toBurnPool: str, toOperator: str, tokenBurnedRaw: str }, ["claims", "sol", "toBurnPool", "toOperator"]),
    urls: { type: "object" }, line: str, note: nstr,
    lastError: { ...nullable(obj({ at: str, error: str, sentence: str }, ["error", "sentence"])), description: "since 1.9.0: the keeper's last refusal for this coin's lock steps, the program error in plain words" },
  }, ["policy", "lockProgram", "feeKey", "feeKeyOwner", "lockedPct", "lastClaim"], { description: "LP locked forever; its fees fund the burn (80% burned, 20% operator, fixed in code). Since 1.8.0." }),
  LpLockPolicy: obj({
    policy: { const: "locked-forever" }, line: str, lockedPct: num, lockProgram: PUBKEY, lockAuthority: PUBKEY, feeKeysPda: { ...PUBKEY, description: "never null since 1.9.0: a fixed PDA of the program id" }, operatorTreasury: nullable(PUBKEY), treasuryPinned: bool,
    platform: { ...nullable(PUBKEY), description: "since 1.9.0: BURNTICKER_PLATFORM compiled into burn_receipts (initialize_token refuses any other LaunchLab platform); null = not pinned (PlatformNotPinned)" }, platformPinned: bool, launchLabLocker: { ...PUBKEY, description: "since 1.9.0: the locker a policy-0 lock position must carry (LaunchLab's vault_auth PDA)" },
    split: { type: "object" }, perSwapAfterGraduationBps: obj({ lpFees: num, toBurnPool: num, toOperator: num, creatorFeeToBurnPool: num, burnedTotal: num }), instructions: obj({ register: str, claim: str }), urls: { type: "object" },
  }, ["policy", "lockProgram", "split"], { description: "The platform-wide LP policy (since 1.8.0)." }),
  BurnMapping: obj({ fractionOfPool: { type: "number", minimum: 0.01, maximum: 1, description: "buyback: fraction of the burn pool spent buying the token at market, all of it burned (≤ 0.10 for recurring rules; a one-shot may go to 1.00 since 1.4.0)" }, tokens: { type: "integer", minimum: 1, description: "vault: tokens burned from the vesting vault" } }, [], { description: "Exactly one key." }),
  Rule: obj({
    schema: { const: "burnticker.rules/v1" },
    oracle: { enum: ["kalshi", "catalogue", "polymarket", "uma", "drift-bet", "hedgehog", "derby"], description: "kalshi, polymarket (binary only), catalogue and derby (Burn Derby, since 1.4.0) are live; the others are accepted by the schema and refused at launch" },
    series: { ...nstr, description: "Kalshi series ticker; a catalogue source id (treasury.debt, wiki.views:Bitcoin); or a Polymarket series: \"tag:<tag slug>[/<market type>][:<event slug glob>]\" (tag:nfl/moneyline) or \"event:<event slug>\"" },
    market: { ...nstr, description: "one Kalshi market ticker, or one Polymarket condition id (0x + 64 lowercase hex): a one-shot rule" },
    filter: obj({ tickerIncludes: str, titleRegex: str }),
    kind: { enum: ["binary", "scalar"] },
    binary: nullable(obj({ onYes: nullable(ref("BurnMapping")), onNo: nullable(ref("BurnMapping")) }, ["onYes"], { description: "at least one of onYes / onNo is a mapping (a side that burns only on NO has onYes null)" })),
    scalar: nullable(obj({ unit: num, perUnit: ref("BurnMapping"), baseline: { anyOf: [{ const: "previousSettlement" }, num] }, direction: { enum: ["up", "down", "abs"] } }, ["unit", "perUnit", "baseline", "direction"])),
    onVoid: { const: "skip" }, floorUsd: str, reserveSol: str,
    vault: nullable(obj({ share: num, vestDays: int, cliffDays: int }, ["share", "vestDays", "cliffDays"])),
    pair: { ...nullable(obj({ pairId: str, side: { enum: ["A", "B"] }, counterpartMint: nstr, clause: { const: "both-or-neither" }, voidBy: str, fallback: obj({ everyDays: int, units: int }, ["everyDays", "units"]) }, ["pairId", "side", "counterpartMint"])), description: "rivalry pairs (wizard flow): two coins on one selector with inverted mappings; null for a single coin. Since 1.4.0 every new pair carries the both-or-neither clause: event burns apply only once both coins have a registered pool; if either has none when voidBy ends (UTC) the pair voids and each coin falls back to `fallback` (units every N days)" },
    onEnd: { ...obj({ windDownDays: int, sweepThresholdLamports: int }, ["windDownDays", "sweepThresholdLamports"]), description: "Since 1.4.0 (every new launch carries it; a rule sent without it gets { windDownDays: 28, sweepThresholdLamports: 50000000 }): when the rule ends for any reason the pool burns down on a daily clock (≥ 99 % within windDownDays), the coin retires, and later fee income is swept once it passes the threshold (at most weekly)" },
    set: { ...obj({ id: str, outcome: str, forwardBps: int }, ["id", "outcome", "forwardBps"]), description: "Since 1.4.0, opt-in: an outcome-set member (one outcome of a selector with an outcome list); when the rule ends, forwardBps of the leftover is forwarded to the set's winning coin once the program's forward_to_winner instruction exists (queued) — until then all of it winds down here" },
    derby: { type: "object", description: "Burn Derby (since 1.4.0; oracle derby only): { selector: \"coinvs\", a, b, window, measure, season, flip } (two coins' relative performance), { selector: \"price\", u, window, season } (one asset's % change) or { selector: \"bracket\", tournamentId, tournamentSha, slot, underlying }; each underlying is a DerbyUnderlying. `series` is derived from it" },
  }, ["schema", "oracle", "kind", "onVoid", "floorUsd", "reserveSol"], { description: "A selector + outcome→burn mapping, locked at launch by the sha256 of its canonical JSON (keys sorted at every level, two-space indent, trailing newline)." }),
  FeeLeg: obj({ label: str, bps: num, recipient: str, dial: str, note: str }, ["label", "bps", "recipient"]),
  FeeSplit: obj({ phase: { enum: ["curve", "post-graduation"] }, legs: arr(ref("FeeLeg")), totalBps: num }, ["phase", "legs", "totalBps"]),
  SerializedIx: obj({ programId: PUBKEY, label: str, dataBase64: str, keys: arr(obj({ pubkey: PUBKEY, isSigner: bool, isWritable: bool }, ["pubkey", "isSigner", "isWritable"])) }, ["programId", "keys", "dataBase64"]),
  Source: obj({
    id: str, kind: { enum: ["market", "assertion", "attested-http", "onchain"] }, tier: { type: "integer", minimum: 1, maximum: 5 }, tierLabel: str, title: str, sourceName: str, sourceUrl: str, cadence: str,
    unit: nullable(obj({ size: num, label: str, definition: str })), direction: nstr, baseline: {}, carry: nstr, valueLabel: nstr, flags: arr(str),
    launchable: obj({ ok: bool, why: nstr }, ["ok"]), param: {}, needsKey: nstr, fixtureFetchedAt: nstr, refusals: arr(str),
    lastReading: nullable(obj({ id: str, value: nstr, at: str })), preview: {},
    config: { description: "attested-http sources: the selection config a verifier needs (request URL template, selection, period); header VALUES are withheld", anyOf: [{ type: "object" }, { type: "null" }] },
  }, ["id", "kind", "tier", "title", "sourceUrl", "launchable"]),
  Catalogue: obj({ sources: arr(ref("Source")), tiers: { type: "object" }, admission: { type: "object" }, kalshi: obj({ search: str, note: str }), polymarket: obj({ search: str, note: str }) }, ["sources", "tiers", "admission"]),
  SourcePreview: obj({
    id: str, title: str, tier: int, rule: ref("Rule"), sha256: str, statement: str, window: obj({ from: str, to: str }, ["from", "to"]),
    totals: { type: "object" }, rows: arr({ type: "object" }), lastReading: {}, fixtureFetchedAt: nstr, sentence: str, note: str,
  }, ["id", "rule", "window", "totals", "rows"]),
  KalshiSeries: obj({ oracle: str, ticker: str, title: str, category: nstr, frequency: nstr, settlementSource: {}, tags: arr(str), refused: arr(str) }, ["ticker", "title"]),
  KalshiEventHit: obj({
    eventTicker: str, seriesTicker: str, title: str, subTitle: nstr, category: nstr, competition: nstr, expectedAt: { ...nstr, description: "when the result is expected (for a game, roughly its end), UTC" }, closeTime: nstr,
    markets: arr(obj({ ticker: str, suffix: str, label: str, status: str, closeTime: nstr }, ["ticker", "suffix", "label"])), score: num, matchedSides: arr(str), matched: arr(str),
    pair: { description: "for a two-team game: both sides (abbreviation, market, suggested name and ticker) and the two selector modes — thisGameOnly (one market, side B inverted: a partition) and everyGame (each side its own team's games: not a partition in general)", anyOf: [{ type: "object" }, { type: "null" }] },
    refused: arr(str),
  }, ["eventTicker", "seriesTicker", "title", "markets"], { description: "A Kalshi event (a game, a contest, an election) with its markets — tickers and labels only, never prices." }),
  KalshiEvents: obj({
    query: str, series: nstr, events: arr(ref("KalshiEventHit")), scanned: arr(str), teams: arr({ type: "object" }), count: int,
    leagues: arr(obj({ id: str, label: str, series: arr(obj({ ticker: str, title: str }, ["ticker", "title"])) }, ["id", "label", "series"])),
  }, ["events"], { description: "Event-level search. With neither q nor series: the league chooser (head-to-head game series derived from Kalshi's Sports list)." }),
  KalshiTeams: obj({
    series: str, since: { ...str, description: "the season start used for the records" }, note: str,
    teams: arr(obj({ abbr: str, city: str, nickname: nstr, name: str, ticker: str, league: nstr, filter: { ...str, description: "the team's own-leg selector filter for \"every game\" (\"-PHI\")" }, collisions: arr(str), next: { anyOf: [{ type: "object" }, { type: "null" }] }, record: obj({ w: int, l: int, d: int, since: str }, ["w", "l", "d"]) }, ["abbr", "name", "ticker", "filter", "record"])),
  }, ["series", "teams"], { description: "Every team of a head-to-head game series, with its next game and its record so far this season (team coins)." }),
  SourceCard: obj({
    id: str, venue: { enum: ["feed", "polymarket", "kalshi"] }, venueLabel: str, tier: int, tierLabel: str, title: str, cadence: nstr, kind: { enum: ["binary", "scalar"] },
    next: { anyOf: [obj({ label: str, at: nstr }, ["label"]), { type: "null" }], description: "the next thing that settles (market venues), or the last reading (feeds)" },
    example: { ...str, description: "the card's \"burns when …\" line" }, launchable: obj({ ok: bool, why: nstr }, ["ok"]), refused: arr(str), flags: arr(str), sourceName: nstr, sourceUrl: nstr,
    pick: obj({ oracle: { enum: ["catalogue", "polymarket", "kalshi"] }, series: nstr, market: nstr, title: str }, ["oracle", "title"]),
  }, ["id", "venue", "title", "example", "launchable", "pick"], { description: "One source, any venue, in one shape: the wizard's Browse card." }),
  Suggestion: obj({
    id: str, venue: { enum: ["feed", "espn", "nws", "polymarket", "kalshi", "tile"] }, venueLabel: str, title: str, subtitle: str, settlement: { ...str, description: "who settles it, in words" }, settleAt: nstr, howSettles: nstr,
    rule: { anyOf: [{ type: "object" }, { type: "null" }], description: "the complete rule, ready for /rules/validate and /launch/bundle" }, pick: { anyOf: [{ type: "object" }, { type: "null" }] }, source: { anyOf: [{ type: "object" }, { type: "null" }] },
    href: nstr, suggestedName: nstr, suggestedTicker: nstr, refused: arr(str), score: num,
    shape: { enum: ["recurring", "one-shot", "pair", "tile"], description: "recurring (burns on every qualifying reading) or one-shot (resolves once); pair = two coins on one game" },
    crossRead: { ...nstr, description: "the independent second source, in words" }, nextAt: { ...nstr, description: "the next possible burn (a game's start, a market's end)" },
    endAt: nstr, endText: nstr, badge: { ...nstr, description: "the window badge: 2026 SEASON / POSTSEASON 2026 / NEXT 5 GAMES / PERPETUAL / ONE-SHOT · <date>" },
    text: { anyOf: [{ type: "object" }, { type: "null" }], description: "the auto-generated coin text (name, ticker, oneLiner, flavour, ruleBlock, windowSentence, windowKind, badge, paragraph)" },
    descCtx: { anyOf: [{ type: "object" }, { type: "null" }], description: "what the text template needs besides the ticker (re-render as the dials move)" },
    windows: { anyOf: [arr(obj({ kind: { enum: ["season", "post", "next", "perpetual"] }, label: str, title: str, rule: { type: "object" }, text: { type: "object" }, endText: str }, ["kind", "rule"])), { type: "null" }], description: "a team card's window choices, this season first (the default)" },
    group: { enum: ["teams", "elections", "weather", "feeds", "markets", "tiles"], description: "the card's category; cards come grouped, best group first" },
    seasonYear: { type: ["integer", "null"] }, note: { ...nstr, description: "why the card cannot offer its rule (\"market lists no Rays outcome\")" },
    matchup: { anyOf: [{ type: "object" }, { type: "null" }], description: "a pair card's two sides, each with its one-game loss selector" },
  }, ["id", "venue", "title", "settlement", "rule"], { description: "A ready-made rule from the universal search (or a tile, e.g. Coin vs Coin). No price, odds, volume or liquidity." }),
  SearchResult: obj({ query: str, cards: arr(ref("Suggestion")), empty: bool, errors: arr(str), venues: { type: "object" }, categories: arr(obj({ id: str, label: str, blurb: str }, ["id", "label"])), note: str }, ["query", "cards", "empty"]),
  Elections: obj({
    types: arr(obj({ id: str, label: str, races: int }, ["id", "label"])), ballot: str, type: nstr, state: nstr, states: arr(obj({ abbr: str, name: str, races: int }, ["abbr", "name"])),
    races: arr(obj({ slug: str, title: str, url: str, type: str, state: nstr, stateName: nstr, district: nstr, settlesOn: nstr, description: nstr, hiddenPlaceholders: int, sos: { type: "object" }, settlement: str, refused: arr(str),
      outcomes: arr(obj({ conditionId: str, label: str, question: str, yes: str, no: str, partyMarket: bool, title: str, settles: str, rule: { type: "object" } }, ["conditionId", "label", "rule"])) }, ["slug", "title", "type", "outcomes"])),
    note: str,
  }, ["types"], { description: "Race type → state → race → outcome, from Polymarket's open midterm races (named outcomes only; no prices)." }),
  ElectionPair: obj({
    race: { type: "object" }, a: { type: "object" }, b: { type: "object" }, crossRead: obj({ name: str, url: str }),
    voidClause: obj({ kind: str, voidBy: nstr, pendingPair: bool, fallbackClock: str, status: str }, ["kind", "pendingPair"]), launchable: obj({ component: str, why: str }), pending: arr(str), note: str,
  }, ["a", "b", "voidClause", "pending"], { description: "Candidate A vs candidate B for one race: two coins, each with an FEC-beats component (per reporting period) and a one-shot winner component (on-chain payout, the state's certified result as the cross-check). Pending gates are listed, never hidden." }),
  SportsTeams: obj({ scheduleNote: { ...nstr, description: "\"schedule needs the licensed key\" for a league without a free official schedule when BURNTICKER_THESPORTSDB_KEY is not set" }, leagues: arr({ type: "object", description: "every team-sport league Burnticker covers: id, label, sport, crossRead (null = cross-read missing, refused by the gate), draws, teams" }), sports: arr({ type: "object" }), league: str, label: str, source: str, teams: arr(obj({ abbr: str, city: str, nickname: str, name: str, ticker: str, league: str, series: obj({ win: str, loss: str, draw: { ...str, description: "soccer: the draw selector" }, seasonYear: { type: "integer" }, perpetual: obj({ win: str, loss: str }) }, ["win", "loss"]), record: nstr, next: { anyOf: [{ type: "object" }, { type: "null" }] } }, ["abbr", "name", "series"])) }, [], { description: "No league: the leagues. A league: its teams with next game and record (ESPN scoreboard) and each team's win / loss selectors." }),
  SportsGames: obj({ league: str, label: str, source: str, scheduleNote: nstr, count: int, games: arr(obj({ eventId: str, league: str, title: str, startsAt: str, detail: str, a: { type: "object" }, b: { type: "object" }, series: obj({ aLoss: str, bLoss: str }) }, ["eventId", "a", "b", "series"])) }, ["games"], { description: "Upcoming games (the next 8 days) with both sides and each side's one-game loss selector." }),
  Browse: obj({
    categories: arr(obj({ id: str, label: str, blurb: str, feeds: int, polymarket: arr(str), kalshi: arr(str) }, ["id", "label", "feeds"])),
    category: obj({ id: str, label: str, blurb: str }, ["id", "label"]), cards: arr(ref("SourceCard")), counts: obj({ feeds: int, polymarket: int, kalshi: int }),
    venues: obj({ kalshi: bool, polymarket: bool, feeds: bool }, ["kalshi", "polymarket", "feeds"]), errors: arr(str), note: str,
  }, ["venues"], { description: "Without `category`: { categories } — Burnticker's taxonomy with what each venue contributes on this host. With `category`: its source cards, first-party feeds first." }),
  KalshiCategories: obj({
    categories: arr(obj({ category: str, tags: arr(str), seriesCount: { type: ["integer", "null"], description: "series in the category (null when its list could not be read)" }, polymarket: { anyOf: [obj({ slug: str, label: str }, ["slug", "label"]), { type: "null" }], description: "the Polymarket top-level tag this category maps to" } }, ["category", "tags"])),
    category: str, total: int, offset: int, limit: int, tags: arr(obj({ tag: str, count: int }, ["tag", "count"])),
    series: arr(obj({ ticker: str, title: str, category: nstr, frequency: nstr, tags: arr(str), settlementSource: { anyOf: [obj({ name: str, url: str }), { type: "null" }] }, volume: { ...num, description: "Kalshi's traded volume — ordering only, never a rule input" }, kindHint: { enum: ["binary", "scalar"], description: "how the series reads: a yes/no market, or a settled number (a strike ladder); confirmed from the markets when `events` covered it" }, example: str, refused: arr(str), events: { anyOf: [obj({ open: int, next: { anyOf: [{ type: "object" }, { type: "null" }] }, ladder: bool }, ["open", "ladder"]), { type: "null" }] } }, ["ticker", "title", "kindHint", "example", "refused"])),
    polymarket: { anyOf: [obj({ tag: obj({ slug: str, label: str }), events: arr(ref("PolymarketEventHit")), error: nstr }, ["tag", "events"]), { type: "null" }] },
    note: str,
  }, [], { description: "Without `category`: { categories } — Kalshi's own category → tag tree in its order with series counts. With `category`: one page of its series (most traded first) plus the matching Polymarket tag's open events." }),
  KalshiSearch: obj({
    query: str, results: arr(ref("KalshiSeries")), events: arr(ref("KalshiEventHit")), ranking: { enum: ["events", "series"], description: "which list to show first: events when the query names a team or matched a market by name" }, teams: arr({ type: "object" }),
    series: ref("KalshiSeries"), open: arr({ type: "object" }), openCount: int, refusals: arr({ type: "object" }), note: str,
  }, [], { description: "Either { query, results, events, ranking } (a search: series plus event-level hits) or { series, open, openCount, refusals } (?series=TICKER)." }),
  PolymarketMarketHit: obj({ conditionId: str, question: str, yes: { ...str, description: "the first outcome: what YES means" }, no: { ...str, description: "the second outcome: what NO means" }, endDate: nstr, closed: bool, sportsMarketType: nstr, selector: { type: "object" }, outcome: { ...nstr, description: "the outcome name inside its event (Gamma groupItemTitle)" } }, ["conditionId", "question", "yes", "no", "selector"]),
  PolymarketEventHit: obj({ slug: str, title: str, url: str, endDate: nstr, closed: bool, tags: arr(obj({ slug: str, label: str })), markets: arr(ref("PolymarketMarketHit")), marketCount: int, selector: { type: "object", description: "the whole event as a recurring selector (event:<slug>)" }, refused: arr(str) }, ["slug", "title", "markets", "selector", "refused"]),
  PolymarketSearch: obj({
    query: str, status: { enum: ["open", "closed", "all"] }, venue: { const: "polymarket" }, note: str,
    events: arr(ref("PolymarketEventHit")),
    markets: arr(ref("PolymarketMarketHit")),
    tags: arr(obj({ slug: str, label: str, events: int, series: arr(str) }, ["slug", "series"])),
  }, ["query", "events", "markets", "tags"], { description: "Gamma search hits: events with their binary markets (each a one-shot selector), the event as a selector, and the tags seen as recurring selectors. `markets` is filled when q is a condition id." }),
  BacktestRequest: obj({ rule: ref("Rule"), months: { type: "integer", minimum: 1, maximum: 24 } }, ["rule"]),
  Backtest: obj({ rule: ref("Rule"), text: str, sha256: str, sha12: str, mode: { enum: ["buyback", "vault"] }, statement: str, backtest: { type: "object" }, sentence: str, refusals: arr({ type: "object" }), seriesTitle: nstr, matched: int }, ["rule", "text", "sha256", "statement", "backtest", "sentence", "matched"]),
  ValidateRequest: obj({ rule: {} }, ["rule"]),
  Validation: obj({ ok: bool, rule: ref("Rule"), canonical: { type: "string", description: "the exact bytes rules.json will hold" }, sha256: str, sha12: str, mode: { enum: ["buyback", "vault"] }, statement: str, receiptFormat: str, problems: arr(str) }, ["ok"]),
  LaunchRequest: obj({
    creator: { ...PUBKEY, description: "the wallet that pays and signs" },
    mint: { ...PUBKEY, description: "the PUBLIC key of a fresh mint keypair you generated; the secret never leaves your machine" },
    ticker: { type: "string", pattern: "^[A-Z0-9]{2,10}$" }, name: str, description: str, imageUrl: nstr,
    links: arr(obj({ label: str, url: str }, ["label", "url"])), rule: ref("Rule"), firstBuySol: { type: "string", description: "decimal SOL, ≤ 50; \"0\" for none" },
    acknowledgements: obj({ ruleLocked: { const: true }, noReturns: { const: true } }, ["ruleLocked", "noReturns"]),
    recentBlockhash: { type: "string", description: "optional: a recent blockhash from your RPC; otherwise a placeholder you must replace before signing" },
    register: { type: "boolean", description: "default true: register the DRAFT (reserves the ticker for 24 h — confirm the launch within that window or the draft expires and the ticker is released; the keeper serves registered tokens only). false = review only." },
  }, ["creator", "mint", "ticker", "name", "rule", "acknowledgements"]),
  UnsignedTx: obj({ label: str, signers: arr({ enum: ["creator", "mint"] }), transaction: nstr, message: str, sizeBytes: int, oversize: bool, recentBlockhash: str, blockhashPlaceholder: bool, feePayer: PUBKEY, instructions: arr(ref("SerializedIx")) }, ["label", "signers", "message", "recentBlockhash", "blockhashPlaceholder", "instructions"]),
  LaunchReview: obj({
    ticker: str, name: str, description: str, creator: PUBKEY, mint: PUBKEY, cluster: str, seriesTitle: nstr,
    rules: obj({ text: str, sha256: str, sha12: str, statement: str, mode: str }, ["text", "sha256", "statement"]), receiptFormat: str,
    addresses: { type: "object" }, allocation: { type: "object" }, fees: obj({ curve: ref("FeeSplit"), postGraduation: ref("FeeSplit"), creatorSliceBps: { const: 0 }, sentence: str }, ["curve", "postGraduation"]),
    burnPoolAuthority: str, notes: arr(str), disclosure: obj({ disclaimer: str, eventContract: nstr }), operator: obj({ can: arr(str), cannot: arr(str), placeholder: bool }),
    acknowledgements: arr(str),
  }, ["ticker", "mint", "rules", "receiptFormat", "fees", "allocation"]),
  LaunchBundle: obj({ ok: bool, cluster: str, ready: bool, pending: arr(str), review: ref("LaunchReview"), transactions: arr(ref("UnsignedTx")), registered: nullable(obj({ status: str, ticker: str, mint: str })), next: arr(str), stubs: arr(str), preflight: { ...nullable(ref("Preflight")), description: "the creation preflight (since 1.3.0): the selector run live once, primary + cross-read; null when BURNTICKER_PREFLIGHT_STRICT is off on this host" } }, ["ok", "cluster", "ready", "pending", "review", "transactions"]),
  Preflight: obj({
    ok: bool, oracle: str, selector: str,
    primary: obj({ id: str, operator: nstr, lastReading: nullable(obj({ id: str, value: nstr, result: nstr, at: str })), error: nstr }, ["id"]),
    crossRead: nullable(obj({ id: str, operator: nstr, lastReading: nullable(obj({ id: str, value: nstr, result: nstr, at: str })), error: nstr }, ["id"])),
    nextExpectedAt: nstr, nextExpectedBasis: str, agreement: { type: ["boolean", "null"] }, agreementBasis: str,
    refusal: nullable(obj({ code: { enum: ["kalshi-not-settlement", "stub-oracle", "not-primary", "primary-unreadable", "no-readings", "stale-primary", "no-cross-read", "cross-read-unreadable", "disagreement", "unknown-selector"] }, reason: str, status: int }, ["code", "reason"])),
    checkedAt: str,
  }, ["ok", "oracle", "selector", "primary", "agreement", "refusal"], { description: "The selector run live once before creation: the primary and its independent cross-read (Polymarket: the payout vector on Polygon and Gamma's report), the last reading, when the next is expected, whether the two agree, and the refusal if anything failed." }),
  ConfirmRequest: obj({ mint: PUBKEY, signature: { type: "string", pattern: "^[1-9A-HJ-NP-Za-km-z]{80,90}$" } }, ["mint", "signature"]),
  Confirmation: obj({ ok: bool, ticker: str, mint: str, status: str, note: str }, ["ok", "mint", "status"]),
  TokenSummary: obj({ ticker: str, name: str, mint: PUBKEY, status: { enum: ["draft", "live", "paused", "retired", "expired"] }, oracle: str, selectorKey: str, mode: str, rulesSha256: str, creator: str, cluster: str, baselineAt: str, receipts: int, burns: int, burnedTokens: str, imageUrl: nstr, lastBurnAt: nstr, links: obj({ self: str, receipts: str, page: str }) }, ["ticker", "mint", "status", "rulesSha256", "links"]),
  TokenList: obj({ tokens: arr(ref("TokenSummary")), count: int, total: int, cluster: str }, ["tokens", "count", "total"]),
  Receipt: obj({
    eventId: str, settledAt: str, oracle: str, market: str, result: nstr, value: nstr, title: nstr, method: nstr, sourceUrl: nstr, settlementSourceUrl: nstr,
    units: int, kind: str, note: str, prevValue: nstr, carryIn: str, mapping: nullable(ref("BurnMapping")),
    pool: nstr, spent: nstr, got: nstr, burned: nstr, shortOut: nstr, status: { enum: ["planned", "sending", "confirmed", "skipped", "void", "exhausted", "nothing", "pending-pair", "voided", "forwarded"], description: "forwarded (since 1.10.0): this coin lost the period and its fuel (spent, SOL) moved to the winning coin's burn pool by forward_to_winner; nothing of this coin was bought or burned" }, skippedReason: nstr, memo: nstr, signature: nstr, txUrl: nstr,
    verify: obj({ curl: str, formula: str, expected: str, checks: arr(str), verified: bool }, ["checks", "verified"]),
    pairRole: { enum: ["won", "lost", "draw", null], description: "since 1.10.0, rivalry pairs: this receipt's role in its result; a lost receipt carries the units it would have had had it won (its own fraction)" },
  }, ["eventId", "settledAt", "units", "status", "verify"]),
  PairForward: obj({
    recordDate: str, from: { ...str, description: "the losing coin's ticker" }, to: { ...str, description: "the winning coin's ticker" }, fromMint: PUBKEY, toMint: PUBKEY,
    sol: { ...str, description: "SOL moved from the loser's burn pool to the winner's (the program's amount: buyback_spend of the loser's pool at its units and fraction)" }, units: int, signature: str, txUrl: nstr,
  }, ["recordDate", "from", "to", "sol", "signature"], { description: "Since 1.10.0 (winner takes the burn): one forward_to_winner. Nobody is paid; the loser's supply is untouched." }),
  PairInfo: obj({
    pairId: str, side: { enum: ["A", "B"] }, counterpart: { type: "object" }, clause: { anyOf: [{ type: "object" }, { type: "null" }] },
    winnerTakesBurn: { ...bool, description: "since 1.10.0: fees from both coins burn the winner's supply (the coin whose rule a result fires); false for pairs made before 2026-10-11" },
    forwards: { ...arr(ref("PairForward")), description: "since 1.10.0: every forward between the two coins, oldest first" },
    tally: { type: "object" }, pageUrl: str,
  }, ["pairId", "side", "counterpart"]),
  TokenStatus: obj({
    schema: { const: "burnticker.status/v1" }, generatedAt: str, ticker: str, name: str, mint: str, cluster: str, status: str, oracle: str, selectorKey: str, seriesTitle: nstr, mode: str,
    rules: obj({ sha256: str, sha12: str, statement: str, file: str, oneShot: bool }, ["sha256", "statement"]), addresses: { type: "object" },
    supply: obj({ initial: str, current: str, source: str }), burned: obj({ total: str, pctOfSupply: num, count: int, last30d: str }), pool: { type: "object" },
    next: obj({ nextCheckAt: nstr, impliedChance: { type: ["number", "null"], description: "always null: no odds or prices are shown for any coin (owner decision 2026-10-10); kept for schema compatibility" }, impliedBasis: nstr, nextMarket: nstr, nextCloseTime: nstr, awaitingFinal: int }, ["impliedChance"]),
    feed: { type: "object" }, attesters: arr({ type: "object" }), quorum: int, fees: { type: "object" }, health: { type: "object" }, disclosure: { type: "object" }, trust: { type: "object", description: "lpBurnedPct is 0 since 1.8.0 (LP locked forever): lpLockedPct and lpPolicy say what happens to the LP" },
    lp: { ...ref("LpLock"), description: "since 1.8.0: the coin's LP lock (policy, lock program, Fee Key and its owner, the last claim_lock_fees receipt, totals)" },
    pair: { ...nullable(ref("PairInfo")), description: "a rivalry pair's side, counterpart and tally; since 1.10.0 also winnerTakesBurn and forwards[]" },
    profile: obj({ imageUrl: nstr, description: str, links: arr(obj({ label: str, url: str }, ["label", "url"])), oneLiner: { ...str, description: "the coin card's few words, derived from the locked rule (\"burns when the Rays win\")" }, badge: { ...str, description: "the window badge: 2026 SEASON / POSTSEASON 2026 / NEXT 5 GAMES / PERPETUAL / ONE-SHOT · <date>" } }, ["oneLiner"]),
    market: obj({
      phase: { enum: ["curve", "migrating", "graduated", null], description: "LaunchLab pool status (0 curve, 1 migrating, 2 graduated); null when not read" },
      curve: { anyOf: [obj({ phase: str, status: int, raised: str, threshold: { ...str, description: "the raise that completes the curve (graduation)" }, remaining: str, quote: str, progressPct: num, poolId: str }, ["raised", "threshold", "progressPct", "poolId"]), { type: "null" }] },
      curveNote: str, graduatedPool: nstr,
      holders: obj({ count: { type: ["integer", "null"] }, countNote: str, top: { anyOf: [arr(obj({ account: str, owner: nstr, amount: str, pct: num, label: nstr }, ["account", "amount", "pct"])), { type: "null" }] }, topNote: str }, ["count", "countNote"]),
      trade: obj({ links: arr(obj({ id: { enum: ["launchlab", "raydium", "jupiter"] }, label: str, url: str }, ["id", "label", "url"])), note: nstr }, ["links"]),
      chart: obj({ provider: { enum: ["geckoterminal", null] }, embedUrl: nstr, pageUrl: nstr, note: str }, ["embedUrl", "note"]),
      readAt: nstr, error: nstr,
    }, ["phase", "curve", "holders", "trade", "chart"], { description: "Bonding curve, graduation, top holders, chart embed and trade deep links — read from chain as data; Burnticker hosts no swap and reads no price into a rule." }),
  }, ["schema", "ticker", "mint", "rules", "next", "burned"]),
  TokenDetail: obj({ status: ref("TokenStatus"), receipts: arr(ref("Receipt")), readings: arr({ type: "object" }), rulesText: str, stubs: arr(str) }, ["status", "receipts", "rulesText"]),
  Receipts: obj({ ticker: str, mint: str, rulesSha256: str, count: int, receipts: arr(ref("Receipt")) }, ["ticker", "mint", "receipts", "count"]),
  VerifyCheck: obj({ id: { enum: ["rules", "memo", "source", "units", "spend", "chain"] }, ok: { type: ["boolean", "null"] }, detail: str }, ["id", "ok", "detail"]),
  Verification: obj({ ticker: str, eventId: str, verified: bool, checks: arr(ref("VerifyCheck")), recomputed: { type: "object" }, receipt: ref("Receipt"), how: arr(str) }, ["ticker", "eventId", "verified", "checks"]),
  CoverageKind: obj({ kind: { enum: ["scalar", "series-binary", "one-shot", "team-coin", "matchup-game", "matchup-season"] }, verdict: { enum: ["settleable", "adjudicated-only", "uncovered"] }, why: str, primaries: arr(str), crossReads: arr(obj({ primary: str, crossRead: str, fact: str }, ["primary", "crossRead", "fact"])), polymarketTags: arr(str) }, ["kind", "verdict", "why"]),
  CoverageSource: obj({ id: str, title: str, operator: nstr, domain: nstr, tier: int, fact: nstr, of: str, dryRun: { anyOf: [{ type: "object" }, { type: "null" }], description: "the 90-day dry run: schedule, expected vs produced (hit rate), median latency, disagreement with the cross-read (n/a with the reason where a source has no schedule)" } }, ["id", "tier"]),
  CoverageCategory: obj({
    id: str, label: str, verdict: { enum: ["settleable", "adjudicated-only", "uncovered"] }, why: str, primaries: arr(ref("CoverageSource")), crossReads: arr(ref("CoverageSource")),
    notPrimary: arr(obj({ id: str, why: str }, ["id", "why"])), unknownFeeds: arr(str), polymarket: obj({ tags: arr(str), available: bool }, ["tags", "available"]), kalshiDiscoveryOnly: arr(str), kinds: arr(ref("CoverageKind")),
  }, ["id", "label", "verdict", "why", "primaries", "crossReads", "polymarket", "kinds"]),
  Coverage: obj({
    schema: { const: "burnticker.coverage/v1" }, generatedAt: str, mode: { enum: ["offline", "live"] }, taxonomy: obj({ file: str, categories: int }, ["file", "categories"]), rule: str,
    kinds: arr(obj({ id: str, label: str, wizard: str, appliesTo: {} }, ["id", "label"])), categories: arr(ref("CoverageCategory")),
    uncovered: arr(obj({ category: str, kind: str, why: str }, ["category", "kind", "why"])), excluded: arr(obj({ id: str, why: str }, ["id", "why"])),
    summary: obj({ settleable: int, adjudicatedOnly: int, uncovered: int, withoutPrimary: arr(str) }, ["settleable", "adjudicatedOnly", "uncovered", "withoutPrimary"]), notes: arr(str),
  }, ["schema", "generatedAt", "mode", "rule", "categories", "uncovered", "summary"], { description: "The settlement-coverage matrix: per category and selector kind, the primary sources, their independent cross-reads, the 90-day dry run and the verdict (settleable / adjudicated-only on Polymarket / uncovered). Kalshi is never an input." }),
  Trust: obj({
    generatedAt: str, cluster: str, powers: { type: "object" }, operator: { type: "object" },
    fees: obj({ designed: obj({ curve: ref("FeeSplit"), postGraduation: ref("FeeSplit"), devFeeBps: num, lpBurnedPct: { ...num, description: "0 since 1.8.0 (LP locked forever)" }, lpLockedPct: { ...num, description: "since 1.8.0" }, lpFeeSplit: { type: "object", description: "since 1.8.0: { burnPoolBps 16.8, operatorBps 4.2, ofLpBps { burnPool 8000, operator 2000 } }" }, creatorCashBps: { const: 0 }, teamAllocationPct: { const: 0 } }, ["curve", "postGraduation", "devFeeBps"]), live: { type: "object" } }, ["designed", "live"]),
    lpLock: { ...ref("LpLockPolicy"), description: "since 1.8.0" },
    program: { type: "object" }, attesters: arr({ type: "object" }), audit: {}, statements: arr(str), operatorLine: str, useOfFees: str, preAuditCapSol: num, cannot: arr(str), rpcConfigured: bool, stubs: arr(str),
  }, ["powers", "fees", "program", "statements"]),
};

const tickerParam: Param = { name: "ticker", in: "path", required: true, description: "the token's ticker (case-insensitive) or its mint address", schema: str };

export const ENDPOINTS: Endpoint[] = [
  ...DERBY_ENDPOINTS,
  ...TRUSTPACK_ENDPOINTS,
  ...PRODUCT_ENDPOINTS,
  ...BADGE_ENDPOINTS,
  ...OPS_ENDPOINTS,
  { operationId: "getCatalogue", method: "GET", path: "/catalogue", tag: "sources", summary: "Every resolution source with its tier", description: "The configured first-party sources (tiers 3–5, with the last fixture reading, a preview and the public selection config), the on-chain facts, and the market/assertion stubs (shown, not launchable). Kalshi series are searched live through /kalshi/search.", params: [], request: null, response: "Catalogue", errors: [429], cacheSec: 300, bucket: "read" },
  { operationId: "getSourcePreview", method: "GET", path: "/sources/{id}/preview", tag: "sources", summary: "What a catalogue rule would have burned over the source's frozen fixture", description: "The source fixes unit, direction, baseline and carry; you choose only the mapping (fractionOfPool for buyback, or tokens for vault mode).", params: [{ name: "id", in: "path", required: true, description: "source id, e.g. treasury.debt or wiki.views:Bitcoin", schema: str }, { name: "fractionOfPool", in: "query", required: false, description: "buyback mapping per unit, 0.01–0.10 (default 0.02)", schema: num }, { name: "tokens", in: "query", required: false, description: "vault mapping per unit (switches the preview to vault mode)", schema: int }], request: null, response: "SourcePreview", errors: [400, 404, 429], cacheSec: 300, bucket: "read" },
  { operationId: "searchKalshiEvents", method: "GET", path: "/kalshi/events", tag: "kalshi", summary: "Search Kalshi events: games, contests, people (or list a series' upcoming events)", description: "Event-level search: `q` is matched against event title, event ticker, market labels and suffixes, with a team-alias table (city, nickname, abbreviation: eagles / philadelphia / PHI; jaguars / jacksonville / JAC / JAX). Scans `series` when given, else the league series of the teams the query names, else the headline game leagues plus series whose titles share a word with the query. Events are cached 10 minutes per series. `?series=KXNFLGAME` alone lists its upcoming events; no parameters returns the league chooser. Two-team games carry both sides and both selector modes. Tickers and labels only — no prices.", params: [{ name: "q", in: "query", required: false, description: "a team, person, contest or ticker", schema: str }, { name: "series", in: "query", required: false, description: "scan only this series", schema: str }, { name: "status", in: "query", required: false, description: "open (default), closed or settled", schema: { enum: ["open", "closed", "settled"] } }], request: null, response: "KalshiEvents", errors: [429, 502, 503], cacheSec: 60, bucket: "heavy" },
  { operationId: "listKalshiTeams", method: "GET", path: "/kalshi/teams", tag: "kalshi", summary: "Teams of a game series, with next game and season record (team coins)", description: "Derived from the series' open events (names, next game) and its settled markets since the season started (record: own leg YES = win, NO = loss, TIE YES = draw). For a team coin the selector is the series plus the team's own-leg filter (`-PHI`).", params: [{ name: "series", in: "query", required: true, description: "a head-to-head game series (…GAME), e.g. KXNFLGAME", schema: str }], request: null, response: "KalshiTeams", errors: [400, 429, 502, 503], cacheSec: 60, bucket: "heavy" },
  { operationId: "search", method: "GET", path: "/search", tag: "sources", summary: "Universal search: describe the event, get ready-made rules", description: "One query across every enabled venue and feed — teams in every league and their next game (team coins), NWS stations (\"Detroit high above 90\"), first-party feeds (\"US debt rises $1B\"), Polymarket election races and markets (named outcomes only), Kalshi only when enabled, and the Coin vs Coin tile for \"WIF vs SHIB\". Each card carries the complete rule, the venue, who settles it and when, and how it settles. Ranked by text match; empty → the category list. No price, odds, volume or liquidity is returned.", params: [{ name: "q", in: "query", required: true, description: "the event in words, e.g. 'El-Sayed wins Michigan Senate'", schema: str }], request: null, response: "SearchResult", errors: [429], cacheSec: 60, bucket: "heavy" },
  { operationId: "elections", method: "GET", path: "/elections", tag: "sources", summary: "Elections & Politics: race type → state → race → outcome", description: "Polymarket's open midterm races (Gamma, events tagged midterms), classified as US Senate / US House / Governor / party control. `type` lists the states with races; `type`+`state` lists the races with their named outcomes (Gamma groupItemTitle; unnamed placeholders hidden), the resolution rules, the settle date, the state's certified-results publisher as the cross-read, and a ready rule per outcome (one-shot, settled on the on-chain payout). 503 when Polymarket discovery is off.", params: [{ name: "type", in: "query", required: false, description: "senate | house | governor | control", schema: { enum: ["senate", "house", "governor", "control"] } }, { name: "state", in: "query", required: false, description: "a state abbreviation (MI)", schema: str }], request: null, response: "Elections", errors: [429, 502, 503], cacheSec: 300, bucket: "heavy" },
  { operationId: "electionPair", method: "GET", path: "/elections/pair", tag: "sources", summary: "Election-pair template: candidate A vs B → two coins", description: "For one race (its Polymarket event slug) and two of its named outcomes: each side's coin with an FEC-beats component (burns 1% on each FEC reporting period its candidate out-raises the other; FEC candidate ids looked up by surname, office and state) and a winner component (burns 10% once, on the on-chain payout; the state's certified result is the cross-check). The rules core locks one selector per coin, so each side launches on its winner component; the FEC component's same-operator cross-read does not pass the coverage gate yet; the both-or-neither void clause is a stub until the pairs core lands. 503 when Polymarket discovery is off.", params: [{ name: "slug", in: "query", required: true, description: "the race's event slug (michigan-senate-election-winner)", schema: str }, { name: "a", in: "query", required: true, description: "side A's outcome condition id", schema: str }, { name: "b", in: "query", required: true, description: "side B's outcome condition id", schema: str }], request: null, response: "ElectionPair", errors: [400, 404, 429, 502, 503], cacheSec: 300, bucket: "heavy" },
  { operationId: "listSportsTeams", method: "GET", path: "/sports/teams", tag: "sources", summary: "Team picker for team coins (the league's official schedule, or TheSportsDB)", description: "No league: every team-sport league Burnticker covers (MLB, NBA, WNBA, NHL, NFL, college football and basketball, MLS, NWSL, the Premier League, La Liga, Serie A, the Bundesliga, Ligue 1, the UEFA competitions, Liga MX and more) grouped by sport, each with its cross-read (null = cross-read missing: listed, refused at creation). A league: its teams (the static team table) with the next game from the league's official schedule (MLB, NHL, NBA) or TheSportsDB (licensed key; else scheduleNote) and each team's selectors — this season by default (espn.team:<league>-<ABBR>.<ESPN id>-win|loss-s<YYYY>, the team pinned by its ESPN id; soccer adds -draw) and perpetual (…-perpetual); the create screen's window dial also offers this postseason only (p<YYYY>) and the next N games (n<N>.<YYYYMMDD>). Each game settles on the game's on-chain payout where a market exists, else a licensed final score, and counts once a second independent operator agrees.", params: [{ name: "league", in: "query", required: false, description: "a league id from the list: mlb, nba, wnba, nhl, nfl, cfb, mcbb, wcbb, usa.1, eng.1, esp.1, …", schema: str }, { name: "q", in: "query", required: false, description: "filter by name, city or abbreviation", schema: str }], request: null, response: "SportsTeams", errors: [400, 429], cacheSec: 300, bucket: "heavy" },
  { operationId: "listSportsGames", method: "GET", path: "/sports/games", tag: "sources", summary: "Upcoming games for matchups (the league's official schedule, or TheSportsDB)", description: "The next 8 days of a league's games with both sides and each side's one-game loss selector (espn.game:<league>-<event>-<ABBR>-loss): a matchup launches two coins, one per team.", params: [{ name: "league", in: "query", required: true, description: "a league id from /sports/teams (mlb, nba, wnba, nhl, nfl, cfb, mcbb, wcbb, usa.1, eng.1, …)", schema: str }, { name: "q", in: "query", required: false, description: "filter by a team name", schema: str }], request: null, response: "SportsGames", errors: [400, 429, 502], cacheSec: 300, bucket: "heavy" },
  { operationId: "browse", method: "GET", path: "/browse", tag: "sources", summary: "Browse every source by category (feeds, Polymarket, Kalshi when enabled)", description: "Burnticker's own taxonomy (config/burnticker/categories.json: Sports, Elections & Politics, Economics, Financial markets, Weather & Climate, Science & Space, Entertainment & Culture, Crypto & On-chain, Companies, Health, World). No parameters: the categories with what each venue contributes on this host. `?category=<id>`: one card per source — first-party feeds first (tier, cadence, last reading), then the Polymarket tag's open events, then Kalshi series (only while BURNTICKER_KALSHI_ENABLED is on) — each with the \"burns when …\" example, launchability, the refuse-list verdict and the selector to use. The page reads the same with a venue on or off; a venue that fails is named in `errors`.", params: [{ name: "category", in: "query", required: false, description: "a category id (sports, politics, economics, financials, weather, science, culture, crypto, companies, health, world)", schema: str }, { name: "q", in: "query", required: false, description: "text filter over titles and source names", schema: str }], request: null, response: "Browse", errors: [404, 429], cacheSec: 300, bucket: "heavy" },
  { operationId: "browseKalshiCategories", method: "GET", path: "/kalshi/categories", tag: "kalshi", summary: "Browse Kalshi by category → tag → series (and the matching Polymarket tag)", description: "Navigate like Kalshi: no parameters returns Kalshi's categories exactly as its API reports them (GET /search/tags_by_categories), each with its tags, its series count and the Polymarket tag it maps to. `?category=Climate and Weather` returns that category's series, most traded first (volume orders the list and is never a rule input), filtered by `tag` and `q`, paged by `limit`/`offset`; the first `events` series also carry their upcoming-event summary (open events, the next one and its close, whether its markets are a strike ladder → the scalar mapping). Each series has the refuse-list verdict and a one-line example mapping. Where the category maps to a Polymarket tag, that tag's open events come back as a second venue group. Drill down with /kalshi/events?series=.", params: [{ name: "category", in: "query", required: false, description: "a Kalshi category as listed (Sports, Elections, Climate and Weather, …)", schema: str }, { name: "tag", in: "query", required: false, description: "one of the category's tags", schema: str }, { name: "q", in: "query", required: false, description: "text filter over ticker, title and tags", schema: str }, { name: "limit", in: "query", required: false, description: "1–100 (default 24)", schema: int }, { name: "offset", in: "query", required: false, description: "default 0", schema: int }, { name: "events", in: "query", required: false, description: "0–24: how many of the returned series get their upcoming-event summary (default 0; one cached request each)", schema: int }, { name: "polymarket", in: "query", required: false, description: "0 to skip the Polymarket group", schema: str }], request: null, response: "KalshiCategories", errors: [404, 429, 502, 503], cacheSec: 300, bucket: "heavy" },
  { operationId: "searchKalshi", method: "GET", path: "/kalshi/search", tag: "kalshi", summary: "Search Kalshi series and events (or read one series with its open markets)", description: "Live search of Kalshi's public series list, with the refuse-list verdict per series, plus event-level hits (teams, people, contests; see /kalshi/events) ranked first when the query names a team or a market. `?series=TICKER` returns that series and its next open markets; their YES prices are display only and never reach a rule.", params: [{ name: "q", in: "query", required: false, description: "free text matched against ticker, title and tags", schema: str }, { name: "category", in: "query", required: false, description: "a Kalshi category (Sports, Economics, Climate and Weather, …)", schema: str }, { name: "series", in: "query", required: false, description: "one series ticker", schema: str }], request: null, response: "KalshiSearch", errors: [404, 429, 502, 503], cacheSec: 60, bucket: "heavy" },
  { operationId: "backtestKalshi", method: "POST", path: "/kalshi/backtest", tag: "kalshi", summary: "Back-test a rule on the venue's own settled history", description: "\"This selector settled N times in the last 12 months and would have burned X\": the matched markets (so you see what a filter really binds to), the rule's canonical text and hash, and the refuse-list verdict. Catalogue rules preview from the source's frozen fixture.", params: [], request: "BacktestRequest", response: "Backtest", errors: [400, 403, 415, 429, 502, 503], cacheSec: 0, bucket: "heavy" },
  { operationId: "searchPolymarket", method: "GET", path: "/polymarket/search", tag: "polymarket", summary: "Search Polymarket events and binary markets", description: "Live search of Polymarket's Gamma API (text, an event slug, or a condition id). Returns events with their binary markets (YES = a market's first outcome, NO its second; each a one-shot selector `{ oracle: \"polymarket\", market: \"0x…\" }`), the event as a recurring selector (`event:<slug>`), and the tags seen on the hits as recurring selectors (`tag:<slug>`, `tag:<slug>/moneyline` for games). Refused events carry the refuse-list reasons. Gamma responses are cached 10 minutes. Results are read from the Conditional Tokens payout vector on Polygon; No prices, odds or volume are returned (venues.ts).", params: [{ name: "q", in: "query", required: true, description: "text, an event slug or a condition id (2+ characters)", schema: str }, { name: "status", in: "query", required: false, description: "open (default), closed or all", schema: { enum: ["open", "closed", "all"] } }], request: null, response: "PolymarketSearch", errors: [400, 429, 502], cacheSec: 60, bucket: "heavy" },
  { operationId: "backtestPolymarket", method: "POST", path: "/polymarket/backtest", tag: "polymarket", summary: "Back-test a Polymarket rule on Gamma's closed markets", description: "The selector's closed markets as Gamma reports them resolved over the window (paged; `scanComplete: false` says where a dense selector's scan stopped), through the same unit engine as the keeper, with the rule's canonical text, hash and refuse-list verdict. Display-grade by design: the keeper reads every result from the Polygon payout vector and holds a market whose vector is not on chain. `rule.oracle` must be \"polymarket\".", params: [], request: "BacktestRequest", response: "Backtest", errors: [400, 403, 404, 415, 429, 502], cacheSec: 0, bucket: "heavy" },
  { operationId: "validateRule", method: "POST", path: "/rules/validate", tag: "rules", summary: "Validate a rule; get its canonical JSON and sha256", description: "Returns the exact bytes rules.json will hold and their sha256 (what every receipt cites as rules=sha256:<first 12>), the plain-language statement and the receipt format. A rule that does not validate returns 400 with every problem listed.", params: [], request: "ValidateRequest", response: "Validation", errors: [400, 403, 415, 429], cacheSec: 0, bucket: "read" },
  { operationId: "buildLaunchBundle", method: "POST", path: "/launch/bundle", tag: "launch", summary: "Build the unsigned launch transactions + the review payload", description: "initialize_token (burn_receipts) + the Raydium LaunchLab create under the Burnticker platform config, with the token's burn pool as the creator-fee recipient. NEVER signs: you sign with the creator wallet and your own mint keypair. Refusals: the refuse list, rules that do not validate, catalogue rules that disagree with their source, a taken ticker, mainnet (until the program and the LaunchLab adapter are live). Registers a DRAFT unless register=false. There is no path to adopt an existing token: the program requires the new mint's signature at init.", params: [], request: "LaunchRequest", response: "LaunchBundle", errors: [400, 403, 409, 415, 429, 502, 503], cacheSec: 0, bucket: "write" },
  { operationId: "confirmLaunch", method: "POST", path: "/launch/confirm", tag: "launch", summary: "Report the landed launch transaction (takes the draft live)", description: "The transaction is read from the chain first: it must have succeeded, be signed by the coin's mint and its creator, call the burn_receipts program and have landed after the draft was registered (422 otherwise; 404 while it is not confirmed yet; 503 on a host without an RPC). The baseline is the transaction's block time: settlements after it count. Sending the same signature again is a no-op (200, baseline unchanged).", params: [], request: "ConfirmRequest", response: "Confirmation", errors: [400, 403, 404, 409, 415, 422, 429, 502, 503], cacheSec: 0, bucket: "write" },
  { operationId: "listTokens", method: "GET", path: "/tokens", tag: "tokens", summary: "Every token on the platform", description: "From the registry (no network calls): status, rule hash, receipt and burn counts. Paged.", params: [{ name: "status", in: "query", required: false, description: "draft | live | paused | retired | expired (a draft not launched within 24 h; its ticker is free again)", schema: { enum: ["draft", "live", "paused", "retired", "expired"] } }, { name: "limit", in: "query", required: false, description: "1–200 (default 100)", schema: int }, { name: "offset", in: "query", required: false, description: "default 0", schema: int }], request: null, response: "TokenList", errors: [400, 429], cacheSec: 30, bucket: "read" },
  { operationId: "getToken", method: "GET", path: "/tokens/{ticker}", tag: "tokens", summary: "One token: status, receipts, next burn", description: "The token page's data: status.json (supply, burned, pool, the next possible burn — no odds or prices), every receipt with its verify block, the readings, and rules.json's exact text.", params: [tickerParam], request: null, response: "TokenDetail", errors: [404, 429], cacheSec: 30, bucket: "read" },
  { operationId: "getReceipts", method: "GET", path: "/tokens/{ticker}/receipts", tag: "tokens", summary: "A token's receipts", description: "Every receipt (oldest first), recomputed from the recorded reading and the published rule at request time; verify.verified is false when the recomputation disagrees with the row or its memo.", params: [tickerParam], request: null, response: "Receipts", errors: [404, 429], cacheSec: 30, bucket: "read" },
  { operationId: "verifyReceipt", method: "GET", path: "/tokens/{ticker}/verify/{id}", tag: "tokens", summary: "Verify one receipt from the source and the chain", description: "Re-reads the settled result from the original source, re-applies the published rule, recomputes the spend, and compares the memo on chain. The SDK's verifyReceipt does the same on your machine without trusting this server.", params: [tickerParam, { name: "id", in: "path", required: true, description: "the receipt's event id (market ticker, event ticker or feed period)", schema: str }], request: null, response: "Verification", errors: [404, 429], cacheSec: 60, bucket: "heavy" },
  { operationId: "getTrust", method: "GET", path: "/trust", tag: "platform", summary: "The Powers Register and the live fee bps", description: "Every power anyone holds (who, what it can and cannot do, timelock, sunset), the designed fee split next to the LIVE LaunchLab platform config decoded from chain (when the host has an RPC), program facts, attesters, the last audit and the platform statements.", params: [], request: null, response: "Trust", errors: [429], cacheSec: 60, bucket: "read" },
  { operationId: "getCoverage", method: "GET", path: "/coverage", tag: "platform", summary: "Settlement coverage: what can be settled without Kalshi, per category", description: "Since 1.3.0. For every category of config/burnticker/categories.json and every selector kind the wizard can emit: the primary sources (first-party, launchable, never Kalshi), their independent cross-reads (the same fact from another operator on another domain), the 90-day dry run of each (expected vs produced readings, median latency, disagreement with the cross-read) and the verdict — settleable (a primary with a cross-read), adjudicated-only (Polymarket's payout vector on Polygon) or uncovered. Computed from the sources' frozen fixtures (no network), cached; docs/burnticker/SETTLEMENT-COVERAGE.md is rendered from the same object.", params: [], request: null, response: "Coverage", errors: [429], cacheSec: 600, bucket: "read" },
  { operationId: "getOpenApi", method: "GET", path: "/openapi.json", tag: "platform", summary: "This document", description: "OpenAPI 3.1, generated from the same table the routes read their cache and rate-limit settings from.", params: [], request: null, response: "OpenApi", errors: [429], cacheSec: 3600, bucket: "read" },
];

export function endpoint(operationId: string): Endpoint {
  const e = ENDPOINTS.find((x) => x.operationId === operationId);
  if (!e) throw new Error(`no endpoint ${operationId}`);
  return e;
}

const ERROR_TEXT: Record<number, string> = { 400: "the request does not validate (every problem listed)", 403: "refused: cross-site request, or the refuse list", 404: "not found", 409: "conflict (ticker taken, draft already live)", 415: "POST bodies must be application/json", 429: "rate limited: wait Retry-After seconds", 502: "the upstream source (Kalshi) did not answer", 503: "venue unavailable: Kalshi is not enabled on this host (BURNTICKER_KALSHI_ENABLED=0)" };

/** The OpenAPI 3.1 document, generated from ENDPOINTS + SCHEMAS. */
export function buildOpenApi(serverUrl = API_PREFIX): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const e of ENDPOINTS) {
    const op: Record<string, unknown> = {
      operationId: e.operationId, tags: [e.tag], summary: e.summary, description: e.description,
      parameters: e.params.map((p) => ({ name: p.name, in: p.in, required: p.required, description: p.description, schema: p.schema })),
      responses: {
        200: { description: "OK", headers: { "RateLimit-Limit": { schema: int }, "RateLimit-Remaining": { schema: int } }, content: { "application/json": { schema: e.response === "OpenApi" ? { type: "object" } : ref(e.response) }, ...Object.fromEntries((e.media ?? []).map((m) => [m, { schema: { type: "string", format: "binary" } }])) } },
        ...Object.fromEntries(e.errors.map((c) => [c, { description: ERROR_TEXT[c] ?? "error", content: { "application/json": { schema: ref("Error") } } }])),
      },
      "x-cache-seconds": e.cacheSec, "x-rate-limit": RATE_LIMITS[e.bucket].human,
    };
    if (e.request) op.requestBody = { required: true, content: { "application/json": { schema: ref(e.request) } } };
    (paths[e.path] ??= {})[e.method.toLowerCase()] = op;
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "Burnticker public API", version: API_VERSION,
      description: "Public data and UNSIGNED transactions only: no keys, no accounts, no signing. Read routes are keyless and cacheable (CORS open). POST routes refuse cross-site browser requests: send `Content-Type: application/json` and, from a bot, an `Origin` header equal to the API's origin. Rate limits per client IP: see x-rate-limit on each operation. Versioning: additive within /v1; breaking changes ship as /v2 with /v1 kept ≥ 90 days. Nothing here can change a rule, claim a fee, or adopt an existing token.",
      license: { name: "see the repository" },
    },
    servers: [{ url: serverUrl }],
    tags: [{ name: "sources" }, { name: "kalshi" }, { name: "polymarket" }, { name: "rules" }, { name: "launch" }, { name: "tokens" }, { name: "platform" }],
    paths,
    components: { schemas: SCHEMAS },
  };
}
