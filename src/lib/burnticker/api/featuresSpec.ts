/**
 * THE CHEAP-FEATURES PASS IN THE PUBLIC API (owner 2026-10-13; OpenAPI 1.18.0): six operations kept out of spec.ts's table (spread
 * in, like the product batch's). Same conventions: hand-written JSON Schema, additive only within v1.
 */
type Schema = Record<string, unknown>;
const str: Schema = { type: "string" };
const nstr: Schema = { type: ["string", "null"] };
const int: Schema = { type: "integer" };
const bool: Schema = { type: "boolean" };
const nbool: Schema = { type: ["boolean", "null"] };
const nnum: Schema = { type: ["number", "null"] };
const arr = (items: Schema): Schema => ({ type: "array", items });
const obj = (properties: Record<string, Schema>, required: string[] = [], extra: Schema = {}): Schema => ({ type: "object", properties, required, ...extra });

const leaderRow = obj({ rank: int, ticker: str, name: str, mint: str, page: str, value: str, detail: str, at: nstr, signature: nstr }, ["rank", "ticker", "mint", "value", "detail"]);
const digestCoin = obj({ ticker: str, name: str, mint: str, page: str, at: str }, ["ticker", "mint", "at"]);

export const FEATURES_SCHEMAS: Record<string, Schema> = {
  LastSeasonBacktest: obj({
    available: bool, reason: nstr, league: nstr, year: { type: ["integer", "null"] }, season: nstr, games: int, burns: int, spentPct: nnum, sentence: nstr, lines: arr(str),
  }, ["available", "games", "burns", "lines"], { description: "since 1.18.0: a team rule counted over the team's previous season from the league's own schedule (lastSeason.ts); `available: false` carries the reason" }),
  Simulation: obj({
    available: bool, reason: nstr, poolSol: str, tradingPoolSol: str, share: nnum, shareLabel: nstr, firesOn: nstr, pair: { enum: ["winner-takes-the-burn", "separate", null] },
    rows: arr(obj({
      case: { enum: ["result", "tie", "void", "no-result", "no-graduation"] }, label: str, line: str,
      coins: arr(obj({ side: { enum: ["A", "B"] }, ticker: str, spendSol: str, receivedSol: str, sentSol: str, waitsSol: str, poolAfterSol: str, burns: bool, line: str }, ["side", "ticker", "spendSol", "burns", "line"])),
    }, ["case", "label", "coins", "line"])),
    note: str,
  }, ["available", "poolSol", "rows", "note"], { description: "since 1.18.0: the result simulator's math (simulator.ts) for a hypothetical burn pool: the result, a tie, a void, no result and no graduation, both coins for a pair" }),
  CoinCalendar: obj({
    ticker: str, mint: str, page: str, ics: str, source: { enum: ["schedule", "business-days", "status", "none"] }, note: str,
    entries: arr(obj({ id: str, kind: { enum: ["game", "reading-day", "next-check", "market-end"] }, at: nstr, day: str, allDay: bool, title: str, detail: str }, ["id", "kind", "day", "allDay", "title"])),
  }, ["ticker", "mint", "source", "entries", "ics"], { description: "since 1.18.0: a coin's next scheduled readings (at most five)" }),
  CoinChecklist: obj({
    ticker: str, mint: str, page: str, shareImage: str, line: str,
    steps: arr(obj({ id: { enum: ["created", "trading", "graduated", "pool-verified", "first-reading", "first-burn"] }, label: str, done: nbool, detail: str }, ["id", "label", "done", "detail"])),
    next: { anyOf: [obj({ step: str, action: str, who: str }, ["step", "action", "who"]), { type: "null" }] },
  }, ["ticker", "mint", "steps", "next", "line"], { description: "since 1.18.0: where a coin stands on its way to its first burn; `done: null` = not read" }),
  Leaderboard: obj({
    generatedAt: str, coins: int, mostBurned: arr(leaderRow), biggestBurn: arr(leaderRow), longestStreak: arr(leaderRow), newestReceipt: arr(leaderRow), labels: { type: "object" }, note: str,
  }, ["generatedAt", "mostBurned", "biggestBurn", "longestStreak", "newestReceipt"], { description: "since 1.18.0: four lists read from the receipts; memoised per minute" }),
  Digest: obj({
    day: str, generatedAt: str, counts: obj({ readings: int, burns: int, newCoins: int, graduations: int }, ["readings", "burns", "newCoins", "graduations"]),
    readings: arr(obj({ selectorKey: str, id: str, at: str, result: nstr, value: nstr, title: nstr, coins: arr(str) }, ["selectorKey", "id", "at"])),
    burns: arr(obj({ ticker: str, mint: str, page: str, eventId: str, tokens: str, at: str, signature: nstr }, ["ticker", "mint", "tokens", "at"])),
    newCoins: arr(digestCoin), graduations: arr(digestCoin), lines: arr(str), note: str,
  }, ["day", "counts", "readings", "burns", "newCoins", "graduations", "lines"], { description: "since 1.18.0: one UTC day of the platform, from this site's own records" }),
  PostQueue: obj({
    items: arr(obj({ id: str, format: str, account: str, subject: str, posts: arr(str), queuedAt: str, xLength: arr(int), warnings: arr(str), state: { enum: ["waiting", "used"] }, usedAt: nstr }, ["id", "format", "posts", "state"])),
    waiting: int, used: int, note: str,
  }, ["items", "waiting", "used"], { description: "since 1.18.0, operator only: the owner's post queue with each post's state. Nothing posts." }),
  PostUsedRequest: obj({ id: { type: "string", pattern: "^[0-9a-f]{16}$" }, note: str }, ["id"]),
  PostUsed: obj({ ok: bool, id: str, status: { enum: ["marked", "already"] }, usedAt: nstr, note: str }, ["ok", "id", "status"]),
};

const mintParam = { name: "mint", in: "path" as const, required: true, description: "the coin's mint address (a ticker one coin holds also answers)", schema: str };

export const FEATURES_ENDPOINTS = [
  { operationId: "getCoinCalendar", method: "GET" as const, path: "/coins/{mint}/calendar", tag: "tokens", summary: "A coin's next scheduled readings", description: "Since 1.18.0. The next five games inside a team coin's window (from the league's own schedule), the next Treasury business days for a Treasury coin, or the next check and the market's end from the coin's status. Each entry is a time a result can arrive, not a burn.", params: [mintParam], request: null, response: "CoinCalendar", errors: [404, 429], cacheSec: 300, bucket: "heavy" as const },
  { operationId: "getCoinCalendarIcs", method: "GET" as const, path: "/coins/{mint}/calendar.ics", tag: "tokens", summary: "A coin's next scheduled readings as a calendar file", description: "Since 1.18.0. The same entries as /coins/{mint}/calendar, as an iCalendar (.ics) file to add to a calendar app.", params: [mintParam], request: null, response: "CoinCalendar", errors: [404, 429], cacheSec: 300, bucket: "heavy" as const, media: ["text/calendar"] },
  { operationId: "getCoinChecklist", method: "GET" as const, path: "/coins/{mint}/checklist", tag: "tokens", summary: "Where a coin stands on its way to its first burn", description: "Since 1.18.0. Six steps in order (created, trading, graduated, pool verified, first reading, first burn), each done, not done or not read, and the next action with who does it.", params: [mintParam], request: null, response: "CoinChecklist", errors: [404, 429], cacheSec: 30, bucket: "read" as const },
  { operationId: "getLeaderboard", method: "GET" as const, path: "/leaderboard", tag: "tokens", summary: "Most burned, biggest single burn, longest streak, newest receipt", description: "Since 1.18.0. Read-only from the receipts this site records, launched coins only, ten rows each, memoised per minute. A receipt count is not a prize.", params: [], request: null, response: "Leaderboard", errors: [429], cacheSec: 60, bucket: "read" as const },
  { operationId: "getDigest", method: "GET" as const, path: "/digest", tag: "platform", summary: "One day of results, burns, new coins and graduations", description: "Since 1.18.0. One UTC day from this site's own records (default today). The post generator reads a saved answer to make the day's post for the owner's queue.", params: [{ name: "day", in: "query" as const, required: false, description: "YYYY-MM-DD, UTC (default today)", schema: str }], request: null, response: "Digest", errors: [400, 429], cacheSec: 300, bucket: "read" as const },
  { operationId: "getOpsPostQueue", method: "GET" as const, path: "/ops/post-queue", tag: "platform", summary: "The owner's post queue, for the operator only", description: "Since 1.18.0. Answers only on the operator's own network with the x-action-pin header: every queued post with its state (waiting or used). Nothing posts.", params: [{ name: "state", in: "query" as const, required: false, description: "waiting, used or all (default all)", schema: str }], request: null, response: "PostQueue", errors: [400, 401, 403, 429, 503], cacheSec: 0, bucket: "read" as const },
  { operationId: "markPostUsed", method: "POST" as const, path: "/ops/post-queue/used", tag: "platform", summary: "Mark a queued post as used, for the operator only", description: "Since 1.18.0. Answers only on the operator's own network with the x-action-pin header. Appends a mark to its own file; the queue is never changed and nothing posts.", params: [], request: "PostUsedRequest", response: "PostUsed", errors: [400, 401, 403, 404, 415, 429, 503], cacheSec: 0, bucket: "read" as const },
];
