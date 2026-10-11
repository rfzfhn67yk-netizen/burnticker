/**
 * THE PRODUCT BATCH IN THE PUBLIC API (2026-10-10; OpenAPI 1.6.0): three operations kept out of spec.ts's table (spread in, like the
 * trust pack's). Same conventions: hand-written JSON Schema, additive only within v1.
 */
type Schema = Record<string, unknown>;
const str: Schema = { type: "string" };
const nstr: Schema = { type: ["string", "null"] };
const int: Schema = { type: "integer" };
const bool: Schema = { type: "boolean" };
const nnum: Schema = { type: ["number", "null"] };
const arr = (items: Schema): Schema => ({ type: "array", items });
const obj = (properties: Record<string, Schema>, required: string[] = [], extra: Schema = {}): Schema => ({ type: "object", properties, required, ...extra });
const PUBKEY: Schema = { type: "string", pattern: "^[1-9A-HJ-NP-Za-km-z]{32,44}$" };

export const PRODUCT_SCHEMAS: Record<string, Schema> = {
  SearchMissReport: obj({ query: str, cards: int }, ["query", "cards"], { description: "A search that showed cards but got no \"Use this\" click before the person searched again or left. Anonymous: the query is folded to plain words, the hour bucketed; no IP, no id." }),
  SearchMissAck: obj({ ok: bool, stored: bool, note: str }, ["ok", "stored"]),
  OpsSearchMisses: obj({
    days: int,
    misses: obj({ since: str, total: int, noCard: int, noClick: int, queries: arr(obj({ query: str, misses: int, noCard: int, noClick: int, lastHour: str }, ["query", "misses"])) }, ["total", "queries"]),
    timeToLaunch: obj({ since: str, drafts: int, steps: arr(obj({ step: str, label: str, n: int, p50Sec: nnum, p90Sec: nnum }, ["step", "n"])), total: obj({ n: int, p50Sec: nnum, p90Sec: nnum }), flow: obj({ n: int, screensP50: nnum, screensP90: nnum, decisionsP50: nnum, decisionsP90: nnum }) }, ["drafts", "steps"]),
    privacy: str,
  }, ["misses", "timeToLaunch"], { description: "Admin only (a trusted host and the action PIN): searches that missed, by query, and time-to-launch p50 / p90 per wizard step." }),
  CreatorCoin: obj({
    ticker: str, name: str, mint: PUBKEY, page: str, state: { enum: ["draft", "curve", "graduated", "retired", "voided", "expired", "paused"] }, badge: nstr,
    queuedUnits: int, nextSettlementAt: nstr, lastReading: { anyOf: [obj({ id: nstr, value: nstr, at: nstr }), { type: "null" }] },
    agreement: obj({ reads: int, methods: nstr, held: nstr }, ["reads"]), receipts: int, windDown: nstr, pairId: nstr,
    todayPost: obj({ text: str, lintOk: bool, hits: arr(str) }, ["text", "lintOk"]),
  }, ["ticker", "mint", "state", "receipts", "todayPost"]),
  Creator: obj({ wallet: PUBKEY, coins: arr({ $ref: "#/components/schemas/CreatorCoin" }), pairs: arr(obj({ pairId: str, page: str, sides: arr(str), voided: bool }, ["pairId", "sides"])), note: str }, ["wallet", "coins", "pairs"], { description: "Read-only: the coins and pairs whose creator wallet matches." }),
};

export const PRODUCT_ENDPOINTS = [
  { operationId: "reportSearchMiss", method: "POST" as const, path: "/search/miss", tag: "platform", summary: "Report a search that got no click (anonymous)", description: "Since 1.6.0. The launch page sends this when a search showed cards but none was used. A search with no card is logged by the server itself. Stored append-only, without IP, id or cookie.", params: [], request: "SearchMissReport", response: "SearchMissAck", errors: [400, 403, 415, 429], cacheSec: 0, bucket: "read" as const },
  { operationId: "getOpsSearchMisses", method: "GET" as const, path: "/ops/search-misses", tag: "platform", summary: "Ops: search misses and time-to-launch (admin only)", description: "Since 1.6.0. Answers only on the operator's own network with the x-action-pin header: missed searches by query, and p50 / p90 seconds per wizard step from the timings sent with launch bundles.", params: [{ name: "days", in: "query" as const, required: false, description: "1–90 (default 7)", schema: { type: "integer" } }], request: null, response: "OpsSearchMisses", errors: [401, 403, 429, 503], cacheSec: 0, bucket: "read" as const },
  { operationId: "getCreator", method: "GET" as const, path: "/creators/{wallet}", tag: "tokens", summary: "A creator's coins and pairs (read-only)", description: "Since 1.6.0. Every coin whose creator wallet matches: state, queued units, next settlement, last reading and how many independent reads confirmed it, receipts, wind-down, and today's lint-checked post to copy. No signing, no posting.", params: [{ name: "wallet", in: "path" as const, required: true, description: "the creator's public key", schema: PUBKEY }], request: null, response: "Creator", errors: [400, 429], cacheSec: 30, bucket: "read" as const },
];
