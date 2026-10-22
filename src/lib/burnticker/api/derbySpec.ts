/**
 * BURN DERBY IN THE PUBLIC API (2026-10-10; OpenAPI 1.4.0). The three operations and their schemas, kept out of spec.ts's table so the
 * merge with other additions stays a two-line splice; spec.ts spreads them into ENDPOINTS / SCHEMAS. Same conventions (hand-written
 * JSON Schema, additive only within v1).
 */
type Schema = Record<string, unknown>;
const str: Schema = { type: "string" };
const nstr: Schema = { type: ["string", "null"] };
const int: Schema = { type: "integer" };
const num: Schema = { type: "number" };
const bool: Schema = { type: "boolean" };
const arr = (items: Schema): Schema => ({ type: "array", items });
const obj = (properties: Record<string, Schema>, required: string[] = [], extra: Schema = {}): Schema => ({ type: "object", properties, required, ...extra });
const ref = (name: string): Schema => ({ $ref: `#/components/schemas/${name}` });

const UNDERLYING: Schema = obj({ symbol: str, pyth: nstr, mint: nstr, pool: nstr, cross: str }, ["symbol", "pyth", "mint", "pool", "cross"], { description: "One coin or asset of a derby: its Pyth feed id (primary), Solana mint, deepest SOL pool (the TWAP fallback when there is no Pyth feed) and its independent cross-read (jup:<mint>, dexscreener:<chain>:<address> or redstone:<feed>)" });

export const DERBY_SCHEMAS: Record<string, Schema> = {
  DerbyHighRequest: obj({ u: UNDERLYING, span: { enum: ["all", 30, 90] } }, ["u", "span"], { description: "since 1.15.0: the reference and how far back its record reaches" }),
  DerbyHighBaseline: obj({ today: str, span: { enum: ["all", 30, 90] }, baseline: { type: "object", description: "derby/high.ts HighBaseline: kind all (since, through, high, highOn, last, feedBegan) or window (through, closes)" }, line: str, refusal: obj({ code: { enum: ["no-readings", "already-decided"] }, reason: str }, ["code", "reason"]) }, ["today", "span"], { description: "since 1.15.0: the baseline and the current-high line, or the refusal" }),
  DerbyPairCheckRequest: obj({ a: UNDERLYING, b: UNDERLYING, flip: bool }, ["a", "b"], { description: "since 1.16.0 (sources-7): the two picked coins and whether the pair is a flippening" }),
  DerbyPairCheck: obj({ ok: bool, flip: bool, swap: { ...bool, description: "a flippening refused because coin A is already larger: whether the other order would pass" }, refusal: { anyOf: [obj({ code: { enum: ["wrapper-pair", "already-decided", "primary-unreadable", "no-cross-read", "cross-read-unreadable", "disagreement", "no-readings", "stale-primary"] }, reason: str }, ["code", "reason"]), { type: "null" }] } }, ["ok", "flip", "swap", "refusal"], { description: "since 1.16.0 (sources-7): whether the pair can launch, checked when both coins are picked" }),
  DerbyUnderlying: UNDERLYING,
  DerbyDay: obj({
    day: int, windowId: str, at: str, status: { enum: ["decided", "withheld"] }, winner: { enum: ["A", "B", "tie", null] },
    a: obj({ symbol: str, changePct: nstr, start: nstr, end: nstr, source: nstr }, ["symbol"]), b: { anyOf: [obj({ symbol: str, changePct: nstr }, ["symbol"]), { type: "null" }] },
    margin: nstr, crossMargin: nstr, reason: nstr, eventId: nstr, proofSha256: nstr, proof: arr(obj({ label: str, url: nstr, detail: str }, ["label", "detail"])),
    receipts: obj({ a: { anyOf: [obj({ status: str, burned: nstr, signature: nstr, txUrl: nstr }, ["status"]), { type: "null" }] }, b: { anyOf: [obj({ status: str }, ["status"]), { type: "null" }] } }, ["a", "b"]),
  }, ["day", "windowId", "at", "status", "winner", "a", "proof", "receipts"]),
  DerbyPair: obj({
    pairId: str, selector: { enum: ["coinvs", "price"] }, series: str, window: str, measure: str, flip: bool, symbols: obj({ a: str, b: nstr }, ["a"]),
    season: obj({ start: str, days: int, endsOn: str, over: bool, windows: int, windowsDone: int }, ["start", "days", "endsOn", "over"]),
    score: obj({ a: int, b: int, ties: int, withheld: int, dayNumber: int }, ["a", "b", "ties", "withheld", "dayNumber"]),
    scoreboard: { ...obj({ tickers: obj({ a: str, b: str }), daysWon: obj({ a: int, b: int }, ["a", "b"]), ties: int, withheld: int, streak: obj({ side: { enum: ["A", "B", null] }, days: int }, ["side", "days"]), forwardedSol: obj({ toA: str, toB: str }, ["toA", "toB"]), run: obj({ day: int, of: int, over: bool }, ["day", "of", "over"]), line: str }, ["daysWon", "streak", "forwardedSol", "run", "line"]), description: "since 1.18.0: the live scoreboard both coin pages and the share card show" },
    forwarded: { ...obj({ aToB: str, bToA: str, windows: int }, ["aToB", "bToA", "windows"]), description: "since 1.10.0 (winner takes the burn): the SOL each side's lost windows moved to the other side's burn pool, and how many windows forwarded" },
    days: arr(ref("DerbyDay")), retired: obj({ a: nstr, b: nstr }), note: str,
  }, ["pairId", "selector", "series", "season", "score", "days"], { description: "A Burn Derby pair: the running score (the receipts' tally), the day-by-day strip with both readings and proof links, the season end" }),
  DerbyTournament: obj({
    id: str, title: str, sha256: str, size: int, start: str, end: str, roundDays: int, fractionOfPool: num, finalBurn: str, finalUnits: int,
    status: { enum: ["upcoming", "running", "complete"] }, currentRound: { type: ["integer", "null"] }, champion: { anyOf: [obj({ slot: int, symbol: str, ticker: nstr }, ["slot", "symbol"]), { type: "null" }] },
    rounds: arr(obj({ index: int, start: str, end: str, final: bool, matches: arr(obj({ round: int, index: int, final: bool, winsA: int, winsB: int, ties: int, withheld: int, winner: { type: ["integer", "null"] }, tiebreak: nstr, days: arr(obj({ date: str, result: { enum: ["A", "B", "tie", "withheld", "open"] } }, ["date", "result"])) }, ["round", "index", "winsA", "winsB", "days"])) }, ["index", "matches"])),
    coins: arr(obj({ slot: int, symbol: str, ticker: nstr, mint: nstr, status: nstr, retiredReason: nstr, eliminatedInRound: { type: ["integer", "null"] } }, ["slot", "symbol"])),
  }, ["id", "title", "sha256", "size", "start", "roundDays", "status", "rounds", "coins"], { description: "A Burn Derby bracket: rounds, matches with their day strips, who advanced and why, retired fan coins, the final's doubled burn" }),
  DerbyList: obj({
    tournaments: arr(obj({ id: str, title: str, size: int, start: str, end: str, roundDays: int, status: str, currentRound: { type: ["integer", "null"] } }, ["id", "title", "size", "start", "status"])),
    pairs: arr(obj({ pairId: str, a: str, b: str, series: str, selector: str, season: obj({ start: str, days: int, endsOn: str }, ["start", "days"]), score: obj({ a: int, b: int, ties: int }, ["a", "b", "ties"]), page: str }, ["pairId", "a", "b", "series", "page"])),
    note: str,
  }, ["tournaments", "pairs"]),
  DerbyDetail: obj({ kind: { enum: ["tournament", "pair"] }, tournament: { anyOf: [ref("DerbyTournament"), { type: "null" }] }, pair: { anyOf: [ref("DerbyPair"), { type: "null" }] }, tickers: { anyOf: [obj({ a: str, b: str }, ["a", "b"]), { type: "null" }] }, post: nstr }, ["kind"]),
  DerbySearch: obj({ query: str, assets: str, hits: arr(obj({ symbol: str, name: str, source: { enum: ["pyth", "jupiter"] }, assetType: str, feed: nstr, mint: nstr, liquidityUsd: { type: ["number", "null"] }, verified: bool, underlying: { anyOf: [UNDERLYING, { type: "null" }] }, why: nstr }, ["symbol", "source", "underlying"])), note: str }, ["query", "hits"]),
};

export const DERBY_ENDPOINTS = [
  { operationId: "derbyPairCheck", method: "POST" as const, path: "/derby/pair", tag: "derby", summary: "Check two picked coins before the review: wrapper pairs and a flippening that is already decided", description: "Since 1.16.0 (sources-7). A coin against its own staked or wrapped form (SOL and JITOSOL, BTC and WBTC) is refused before anything is read. A flippening reads both coins' sizes through the same preflight the bundle runs and is refused when coin A is already the larger one, with swap true when the other order would pass. The daily race reads nothing here.", params: [], request: "DerbyPairCheckRequest", response: "DerbyPairCheck", errors: [400, 403, 415, 429, 502], cacheSec: 0, bucket: "heavy" as const },
  { operationId: "derbyHighBaseline", method: "POST" as const, path: "/derby/high", tag: "derby", summary: "Read a coin's record daily close, the starting point of a record-close coin", description: "Since 1.15.0 (sources-4). For one reference (a derby underlying with a Pyth feed) and a span (all, 30 or 90 days): its daily closes read from Pyth at each past 00:00 UTC boundary, back to the feed's start (at most 1,826 days) or over the last 30 or 90 days. Answers the baseline to lock into the rule's derby block (selector high, season starting today in UTC) and the review's line on the current high and the distance to it, or a refusal: no-readings (the closes could not be read here) or already-decided (the last close before launch is already the record, so no coin is offered).", params: [], request: "DerbyHighRequest", response: "DerbyHighBaseline", errors: [400, 403, 415, 429, 502], cacheSec: 0, bucket: "heavy" as const },
  { operationId: "listDerby", method: "GET" as const, path: "/derby", tag: "derby", summary: "Every Burn Derby bracket and every coin-vs-coin pair", description: "Since 1.4.0. Brackets (tournaments of 8 or 16 coins, one derby per match per round; losers' fan coins retire) and derby pairs (two coins indexed to the relative performance of two other coins over a UTC day or week, read from Pyth and cross-checked by an independent operator; the winner's coin burns). From the registry, no network.", params: [], request: null, response: "DerbyList", errors: [429], cacheSec: 30, bucket: "read" as const },
  { operationId: "searchDerby", method: "GET" as const, path: "/derby/search", tag: "derby", summary: "Search coins for a derby, or also stocks, currencies and metals with assets=all", description: "Since 1.4.0. Pyth's catalogue (Crypto/USD feeds; with assets=all also equities/funds, FX, metals and commodities — Pyth's US index feeds stay out unless the host enables BURNTICKER_INDEX_PROXIES_ENABLED) merged with Jupiter's token list. Each hit carries the underlying the wizard locks into a rule (Pyth feed, mint, cross-read) or why it cannot be used (no cross-read, no Pyth feed and under $250K of liquidity).", params: [{ name: "q", in: "query" as const, required: true, description: "a ticker, name or mint (2+ characters)", schema: str }, { name: "assets", in: "query" as const, required: false, description: "crypto (default) or all", schema: { enum: ["crypto", "all"] } }], request: null, response: "DerbySearch", errors: [400, 429, 502], cacheSec: 60, bucket: "heavy" as const },
  { operationId: "getDerby", method: "GET" as const, path: "/derby/{id}", tag: "derby", summary: "One bracket, or one derby pair", description: "Since 1.4.0. A tournament id returns the bracket (rounds, matches, day strips, advancement, retired fan coins, the champion). A pair id returns the derby block: the running score as a receipt tally, the day-by-day strip with both coins' readings, the season end, and proof links per window (the Pyth update and its sha256, Pyth's Solana account and slot, or the pool's sample slots), plus the latest day's post.", params: [{ name: "id", in: "path" as const, required: true, description: "a tournament id or a pair id", schema: str }], request: null, response: "DerbyDetail", errors: [404, 429], cacheSec: 30, bucket: "read" as const },
];
