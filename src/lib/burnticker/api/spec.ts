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

export type Bucket = "read" | "heavy" | "write";
type Schema = Record<string, unknown>;

export interface Param { name: string; in: "path" | "query"; required: boolean; description: string; schema: Schema }
export interface Endpoint {
  operationId: string; method: "GET" | "POST"; path: string; tag: string; summary: string; description: string;
  params: Param[]; request: string | null; response: string; errors: number[];
  /** Seconds a 200 may be cached (public, CDN + client). 0 = no-store. POST routes are never cached. */
  cacheSec: number;
  bucket: Bucket;
}

export const API_VERSION = "1.1.0";
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
  Error: obj({ error: str, code: str, problems: arr(str), retryAfterSec: int }, ["error"]),
  BurnMapping: obj({ fractionOfPool: { type: "number", minimum: 0.01, maximum: 0.1, description: "buyback: fraction of the burn pool spent buying the token at market, all of it burned" }, tokens: { type: "integer", minimum: 1, description: "vault: tokens burned from the vesting vault" } }, [], { description: "Exactly one key." }),
  Rule: obj({
    schema: { const: "burnticker.rules/v1" },
    oracle: { enum: ["kalshi", "catalogue", "polymarket", "uma", "drift-bet", "hedgehog"], description: "kalshi, polymarket (binary only) and catalogue are live; the others are accepted by the schema and refused at launch" },
    series: { ...nstr, description: "Kalshi series ticker; a catalogue source id (treasury.debt, wiki.views:Bitcoin); or a Polymarket series: \"tag:<tag slug>[/<market type>][:<event slug glob>]\" (tag:nfl/moneyline) or \"event:<event slug>\"" },
    market: { ...nstr, description: "one Kalshi market ticker, or one Polymarket condition id (0x + 64 lowercase hex): a one-shot rule" },
    filter: obj({ tickerIncludes: str, titleRegex: str }),
    kind: { enum: ["binary", "scalar"] },
    binary: nullable(obj({ onYes: nullable(ref("BurnMapping")), onNo: nullable(ref("BurnMapping")) }, ["onYes"], { description: "at least one of onYes / onNo is a mapping (a side that burns only on NO has onYes null)" })),
    scalar: nullable(obj({ unit: num, perUnit: ref("BurnMapping"), baseline: { anyOf: [{ const: "previousSettlement" }, num] }, direction: { enum: ["up", "down", "abs"] } }, ["unit", "perUnit", "baseline", "direction"])),
    onVoid: { const: "skip" }, floorUsd: str, reserveSol: str,
    vault: nullable(obj({ share: num, vestDays: int, cliffDays: int }, ["share", "vestDays", "cliffDays"])),
    pair: { ...nullable(obj({ pairId: str, side: { enum: ["A", "B"] }, counterpartMint: nstr }, ["pairId", "side", "counterpartMint"])), description: "rivalry pairs (wizard flow): two coins on one selector with inverted mappings; null for a single coin" },
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
  KalshiSearch: obj({
    query: str, results: arr(ref("KalshiSeries")), events: arr(ref("KalshiEventHit")), ranking: { enum: ["events", "series"], description: "which list to show first: events when the query names a team or matched a market by name" }, teams: arr({ type: "object" }),
    series: ref("KalshiSeries"), open: arr({ type: "object" }), openCount: int, refusals: arr({ type: "object" }), note: str,
  }, [], { description: "Either { query, results, events, ranking } (a search: series plus event-level hits) or { series, open, openCount, refusals } (?series=TICKER)." }),
  PolymarketMarketHit: obj({ conditionId: str, question: str, yes: { ...str, description: "the first outcome: what YES means" }, no: { ...str, description: "the second outcome: what NO means" }, endDate: nstr, closed: bool, sportsMarketType: nstr, selector: { type: "object" }, impliedYes: { anyOf: [num, { type: "null" }], description: "display only" } }, ["conditionId", "question", "yes", "no", "selector"]),
  PolymarketSearch: obj({
    query: str, status: { enum: ["open", "closed", "all"] }, venue: { const: "polymarket" }, note: str,
    events: arr(obj({ slug: str, title: str, url: str, endDate: nstr, closed: bool, tags: arr(obj({ slug: str, label: str })), markets: arr(ref("PolymarketMarketHit")), marketCount: int, selector: { type: "object", description: "the whole event as a recurring selector (event:<slug>)" }, refused: arr(str) }, ["slug", "title", "markets", "selector", "refused"])),
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
  LaunchBundle: obj({ ok: bool, cluster: str, ready: bool, pending: arr(str), review: ref("LaunchReview"), transactions: arr(ref("UnsignedTx")), registered: nullable(obj({ status: str, ticker: str, mint: str })), next: arr(str), stubs: arr(str) }, ["ok", "cluster", "ready", "pending", "review", "transactions"]),
  ConfirmRequest: obj({ mint: PUBKEY, signature: { type: "string", pattern: "^[1-9A-HJ-NP-Za-km-z]{80,90}$" } }, ["mint", "signature"]),
  Confirmation: obj({ ok: bool, ticker: str, mint: str, status: str, note: str }, ["ok", "mint", "status"]),
  TokenSummary: obj({ ticker: str, name: str, mint: PUBKEY, status: { enum: ["draft", "live", "paused", "retired", "expired"] }, oracle: str, selectorKey: str, mode: str, rulesSha256: str, creator: str, cluster: str, baselineAt: str, receipts: int, burns: int, burnedTokens: str, links: obj({ self: str, receipts: str, page: str }) }, ["ticker", "mint", "status", "rulesSha256", "links"]),
  TokenList: obj({ tokens: arr(ref("TokenSummary")), count: int, total: int, cluster: str }, ["tokens", "count", "total"]),
  Receipt: obj({
    eventId: str, settledAt: str, oracle: str, market: str, result: nstr, value: nstr, title: nstr, method: nstr, sourceUrl: nstr, settlementSourceUrl: nstr,
    units: int, kind: str, note: str, prevValue: nstr, carryIn: str, mapping: nullable(ref("BurnMapping")),
    pool: nstr, spent: nstr, got: nstr, burned: nstr, shortOut: nstr, status: { enum: ["planned", "sending", "confirmed", "skipped", "void", "exhausted", "nothing"] }, skippedReason: nstr, memo: nstr, signature: nstr, txUrl: nstr,
    verify: obj({ curl: str, formula: str, expected: str, checks: arr(str), verified: bool }, ["checks", "verified"]),
  }, ["eventId", "settledAt", "units", "status", "verify"]),
  TokenStatus: obj({
    schema: { const: "burnticker.status/v1" }, generatedAt: str, ticker: str, name: str, mint: str, cluster: str, status: str, oracle: str, selectorKey: str, seriesTitle: nstr, mode: str,
    rules: obj({ sha256: str, sha12: str, statement: str, file: str, oneShot: bool }, ["sha256", "statement"]), addresses: { type: "object" },
    supply: obj({ initial: str, current: str, source: str }), burned: obj({ total: str, pctOfSupply: num, count: int, last30d: str }), pool: { type: "object" },
    next: obj({ nextCheckAt: nstr, impliedChance: { type: ["number", "null"], description: "market-implied chance of the next burn — DISPLAY ONLY, never read by the rule" }, impliedBasis: nstr, nextMarket: nstr, nextCloseTime: nstr, awaitingFinal: int }, ["impliedChance"]),
    feed: { type: "object" }, attesters: arr({ type: "object" }), quorum: int, fees: { type: "object" }, health: { type: "object" }, disclosure: { type: "object" }, trust: { type: "object" },
  }, ["schema", "ticker", "mint", "rules", "next", "burned"]),
  TokenDetail: obj({ status: ref("TokenStatus"), receipts: arr(ref("Receipt")), readings: arr({ type: "object" }), rulesText: str, stubs: arr(str) }, ["status", "receipts", "rulesText"]),
  Receipts: obj({ ticker: str, mint: str, rulesSha256: str, count: int, receipts: arr(ref("Receipt")) }, ["ticker", "mint", "receipts", "count"]),
  VerifyCheck: obj({ id: { enum: ["rules", "memo", "source", "units", "spend", "chain"] }, ok: { type: ["boolean", "null"] }, detail: str }, ["id", "ok", "detail"]),
  Verification: obj({ ticker: str, eventId: str, verified: bool, checks: arr(ref("VerifyCheck")), recomputed: { type: "object" }, receipt: ref("Receipt"), how: arr(str) }, ["ticker", "eventId", "verified", "checks"]),
  Trust: obj({
    generatedAt: str, cluster: str, powers: { type: "object" }, operator: { type: "object" },
    fees: obj({ designed: obj({ curve: ref("FeeSplit"), postGraduation: ref("FeeSplit"), devFeeBps: num, lpBurnedPct: num, creatorCashBps: { const: 0 }, teamAllocationPct: { const: 0 } }, ["curve", "postGraduation", "devFeeBps"]), live: { type: "object" } }, ["designed", "live"]),
    program: { type: "object" }, attesters: arr({ type: "object" }), audit: {}, statements: arr(str), operatorLine: str, useOfFees: str, preAuditCapSol: num, cannot: arr(str), rpcConfigured: bool, stubs: arr(str),
  }, ["powers", "fees", "program", "statements"]),
};

const tickerParam: Param = { name: "ticker", in: "path", required: true, description: "the token's ticker (case-insensitive) or its mint address", schema: str };

export const ENDPOINTS: Endpoint[] = [
  { operationId: "getCatalogue", method: "GET", path: "/catalogue", tag: "sources", summary: "Every resolution source with its tier", description: "The configured first-party sources (tiers 3–5, with the last fixture reading, a preview and the public selection config), the on-chain facts, and the market/assertion stubs (shown, not launchable). Kalshi series are searched live through /kalshi/search.", params: [], request: null, response: "Catalogue", errors: [429], cacheSec: 300, bucket: "read" },
  { operationId: "getSourcePreview", method: "GET", path: "/sources/{id}/preview", tag: "sources", summary: "What a catalogue rule would have burned over the source's frozen fixture", description: "The source fixes unit, direction, baseline and carry; you choose only the mapping (fractionOfPool for buyback, or tokens for vault mode).", params: [{ name: "id", in: "path", required: true, description: "source id, e.g. treasury.debt or wiki.views:Bitcoin", schema: str }, { name: "fractionOfPool", in: "query", required: false, description: "buyback mapping per unit, 0.01–0.10 (default 0.02)", schema: num }, { name: "tokens", in: "query", required: false, description: "vault mapping per unit (switches the preview to vault mode)", schema: int }], request: null, response: "SourcePreview", errors: [400, 404, 429], cacheSec: 300, bucket: "read" },
  { operationId: "searchKalshiEvents", method: "GET", path: "/kalshi/events", tag: "kalshi", summary: "Search Kalshi events: games, contests, people (or list a series' upcoming events)", description: "Event-level search: `q` is matched against event title, event ticker, market labels and suffixes, with a team-alias table (city, nickname, abbreviation: eagles / philadelphia / PHI; jaguars / jacksonville / JAC / JAX). Scans `series` when given, else the league series of the teams the query names, else the headline game leagues plus series whose titles share a word with the query. Events are cached 10 minutes per series. `?series=KXNFLGAME` alone lists its upcoming events; no parameters returns the league chooser. Two-team games carry both sides and both selector modes. Tickers and labels only — no prices.", params: [{ name: "q", in: "query", required: false, description: "a team, person, contest or ticker", schema: str }, { name: "series", in: "query", required: false, description: "scan only this series", schema: str }, { name: "status", in: "query", required: false, description: "open (default), closed or settled", schema: { enum: ["open", "closed", "settled"] } }], request: null, response: "KalshiEvents", errors: [429, 502], cacheSec: 60, bucket: "heavy" },
  { operationId: "listKalshiTeams", method: "GET", path: "/kalshi/teams", tag: "kalshi", summary: "Teams of a game series, with next game and season record (team coins)", description: "Derived from the series' open events (names, next game) and its settled markets since the season started (record: own leg YES = win, NO = loss, TIE YES = draw). For a team coin the selector is the series plus the team's own-leg filter (`-PHI`).", params: [{ name: "series", in: "query", required: true, description: "a head-to-head game series (…GAME), e.g. KXNFLGAME", schema: str }], request: null, response: "KalshiTeams", errors: [400, 429, 502], cacheSec: 60, bucket: "heavy" },
  { operationId: "searchKalshi", method: "GET", path: "/kalshi/search", tag: "kalshi", summary: "Search Kalshi series and events (or read one series with its open markets)", description: "Live search of Kalshi's public series list, with the refuse-list verdict per series, plus event-level hits (teams, people, contests; see /kalshi/events) ranked first when the query names a team or a market. `?series=TICKER` returns that series and its next open markets; their YES prices are display only and never reach a rule.", params: [{ name: "q", in: "query", required: false, description: "free text matched against ticker, title and tags", schema: str }, { name: "category", in: "query", required: false, description: "a Kalshi category (Sports, Economics, Climate and Weather, …)", schema: str }, { name: "series", in: "query", required: false, description: "one series ticker", schema: str }], request: null, response: "KalshiSearch", errors: [404, 429, 502], cacheSec: 60, bucket: "heavy" },
  { operationId: "backtestKalshi", method: "POST", path: "/kalshi/backtest", tag: "kalshi", summary: "Back-test a rule on the venue's own settled history", description: "\"This selector settled N times in the last 12 months and would have burned X\": the matched markets (so you see what a filter really binds to), the rule's canonical text and hash, and the refuse-list verdict. Catalogue rules preview from the source's frozen fixture.", params: [], request: "BacktestRequest", response: "Backtest", errors: [400, 403, 415, 429, 502], cacheSec: 0, bucket: "heavy" },
  { operationId: "searchPolymarket", method: "GET", path: "/polymarket/search", tag: "polymarket", summary: "Search Polymarket events and binary markets", description: "Live search of Polymarket's Gamma API (text, an event slug, or a condition id). Returns events with their binary markets (YES = a market's first outcome, NO its second; each a one-shot selector `{ oracle: \"polymarket\", market: \"0x…\" }`), the event as a recurring selector (`event:<slug>`), and the tags seen on the hits as recurring selectors (`tag:<slug>`, `tag:<slug>/moneyline` for games). Refused events carry the refuse-list reasons. Gamma responses are cached 10 minutes. Results are read from the Conditional Tokens payout vector on Polygon; `impliedYes` is display only.", params: [{ name: "q", in: "query", required: true, description: "text, an event slug or a condition id (2+ characters)", schema: str }, { name: "status", in: "query", required: false, description: "open (default), closed or all", schema: { enum: ["open", "closed", "all"] } }], request: null, response: "PolymarketSearch", errors: [400, 429, 502], cacheSec: 60, bucket: "heavy" },
  { operationId: "backtestPolymarket", method: "POST", path: "/polymarket/backtest", tag: "polymarket", summary: "Back-test a Polymarket rule on Gamma's closed markets", description: "The selector's closed markets as Gamma reports them resolved over the window (paged; `scanComplete: false` says where a dense selector's scan stopped), through the same unit engine as the keeper, with the rule's canonical text, hash and refuse-list verdict. Display-grade by design: the keeper reads every result from the Polygon payout vector and holds a market whose vector is not on chain. `rule.oracle` must be \"polymarket\".", params: [], request: "BacktestRequest", response: "Backtest", errors: [400, 403, 404, 415, 429, 502], cacheSec: 0, bucket: "heavy" },
  { operationId: "validateRule", method: "POST", path: "/rules/validate", tag: "rules", summary: "Validate a rule; get its canonical JSON and sha256", description: "Returns the exact bytes rules.json will hold and their sha256 (what every receipt cites as rules=sha256:<first 12>), the plain-language statement and the receipt format. A rule that does not validate returns 400 with every problem listed.", params: [], request: "ValidateRequest", response: "Validation", errors: [400, 403, 415, 429], cacheSec: 0, bucket: "read" },
  { operationId: "buildLaunchBundle", method: "POST", path: "/launch/bundle", tag: "launch", summary: "Build the unsigned launch transactions + the review payload", description: "initialize_token (burn_receipts) + the Raydium LaunchLab create under the Burnticker platform config, with the token's burn pool as the creator-fee recipient. NEVER signs: you sign with the creator wallet and your own mint keypair. Refusals: the refuse list, rules that do not validate, catalogue rules that disagree with their source, a taken ticker, mainnet (until the program and the LaunchLab adapter are live). Registers a DRAFT unless register=false. There is no path to adopt an existing token: the program requires the new mint's signature at init.", params: [], request: "LaunchRequest", response: "LaunchBundle", errors: [400, 403, 409, 415, 429, 502], cacheSec: 0, bucket: "write" },
  { operationId: "confirmLaunch", method: "POST", path: "/launch/confirm", tag: "launch", summary: "Report the landed launch transaction (takes the draft live)", description: "Sets the baseline to now: settlements after this moment count. The keeper verifies the transaction on its next cycle.", params: [], request: "ConfirmRequest", response: "Confirmation", errors: [400, 403, 404, 409, 415, 429], cacheSec: 0, bucket: "write" },
  { operationId: "listTokens", method: "GET", path: "/tokens", tag: "tokens", summary: "Every token on the platform", description: "From the registry (no network calls): status, rule hash, receipt and burn counts. Paged.", params: [{ name: "status", in: "query", required: false, description: "draft | live | paused | retired | expired (a draft not launched within 24 h; its ticker is free again)", schema: { enum: ["draft", "live", "paused", "retired", "expired"] } }, { name: "limit", in: "query", required: false, description: "1–200 (default 100)", schema: int }, { name: "offset", in: "query", required: false, description: "default 0", schema: int }], request: null, response: "TokenList", errors: [400, 429], cacheSec: 30, bucket: "read" },
  { operationId: "getToken", method: "GET", path: "/tokens/{ticker}", tag: "tokens", summary: "One token: status, receipts, next burn, implied chance", description: "The token page's data: status.json (supply, burned, pool, the next possible burn and the market-implied chance of it — display only), every receipt with its verify block, the readings, and rules.json's exact text.", params: [tickerParam], request: null, response: "TokenDetail", errors: [404, 429], cacheSec: 30, bucket: "read" },
  { operationId: "getReceipts", method: "GET", path: "/tokens/{ticker}/receipts", tag: "tokens", summary: "A token's receipts", description: "Every receipt (oldest first), recomputed from the recorded reading and the published rule at request time; verify.verified is false when the recomputation disagrees with the row or its memo.", params: [tickerParam], request: null, response: "Receipts", errors: [404, 429], cacheSec: 30, bucket: "read" },
  { operationId: "verifyReceipt", method: "GET", path: "/tokens/{ticker}/verify/{id}", tag: "tokens", summary: "Verify one receipt from the source and the chain", description: "Re-reads the settled result from the original source, re-applies the published rule, recomputes the spend, and compares the memo on chain. The SDK's verifyReceipt does the same on your machine without trusting this server.", params: [tickerParam, { name: "id", in: "path", required: true, description: "the receipt's event id (market ticker, event ticker or feed period)", schema: str }], request: null, response: "Verification", errors: [404, 429], cacheSec: 60, bucket: "heavy" },
  { operationId: "getTrust", method: "GET", path: "/trust", tag: "platform", summary: "The Powers Register and the live fee bps", description: "Every power anyone holds (who, what it can and cannot do, timelock, sunset), the designed fee split next to the LIVE LaunchLab platform config decoded from chain (when the host has an RPC), program facts, attesters, the last audit and the platform statements.", params: [], request: null, response: "Trust", errors: [429], cacheSec: 60, bucket: "read" },
  { operationId: "getOpenApi", method: "GET", path: "/openapi.json", tag: "platform", summary: "This document", description: "OpenAPI 3.1, generated from the same table the routes read their cache and rate-limit settings from.", params: [], request: null, response: "OpenApi", errors: [429], cacheSec: 3600, bucket: "read" },
];

export function endpoint(operationId: string): Endpoint {
  const e = ENDPOINTS.find((x) => x.operationId === operationId);
  if (!e) throw new Error(`no endpoint ${operationId}`);
  return e;
}

const ERROR_TEXT: Record<number, string> = { 400: "the request does not validate (every problem listed)", 403: "refused: cross-site request, or the refuse list", 404: "not found", 409: "conflict (ticker taken, draft already live)", 415: "POST bodies must be application/json", 429: "rate limited: wait Retry-After seconds", 502: "the upstream source (Kalshi) did not answer" };

/** The OpenAPI 3.1 document, generated from ENDPOINTS + SCHEMAS. */
export function buildOpenApi(serverUrl = API_PREFIX): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const e of ENDPOINTS) {
    const op: Record<string, unknown> = {
      operationId: e.operationId, tags: [e.tag], summary: e.summary, description: e.description,
      parameters: e.params.map((p) => ({ name: p.name, in: p.in, required: p.required, description: p.description, schema: p.schema })),
      responses: {
        200: { description: "OK", headers: { "RateLimit-Limit": { schema: int }, "RateLimit-Remaining": { schema: int } }, content: { "application/json": { schema: e.response === "OpenApi" ? { type: "object" } : ref(e.response) } } },
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
