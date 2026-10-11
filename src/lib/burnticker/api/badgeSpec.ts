/**
 * The receipt badge's two operations (growth batch, API 1.7.0; src/lib/burnticker/badge.ts). Kept beside spec.ts like the derby and
 * trust-pack tables and spread into ENDPOINTS / SCHEMAS there. Each answers `<id>.json` (the BadgeJson payload, application/json) or
 * the card itself as `<id>.svg` / `<id>.png` (`media`). No payload carries a price, a market cap, odds, an implied chance or volume.
 */
type Schema = Record<string, unknown>;
const str: Schema = { type: "string" };
const num: Schema = { type: "number" };
const arr = (items: Schema): Schema => ({ type: "array", items });
const nstr: Schema = { type: ["string", "null"] };
const int: Schema = { type: "integer" };
const obj = (properties: Record<string, Schema>, required: string[] = [], extra: Schema = {}): Schema => ({ type: "object", properties, required, ...extra });
const ref = (name: string): Schema => ({ $ref: `#/components/schemas/${name}` });

const LAST_BURN: Schema = { anyOf: [obj({ at: str, units: int, burned: { ...str, description: "tokens burned, decimal string" } }, ["at", "units", "burned"]), { type: "null" }] };
const RECEIPTS: Schema = obj({ count: int, label: { ...str, description: "a team coin's own season (\"2026–27 season\"), else the calendar year (\"in 2026\")" } }, ["count", "label"]);
const SIDE = obj({
  ticker: str, name: str, oneLiner: { ...str, description: "the rule's one-liner (coinCard.ts), derived from the locked rule" }, window: nstr, status: str,
  lastBurn: LAST_BURN, receipts: RECEIPTS, rulesSha12: str, pageUrl: str, verifyUrl: str,
}, ["ticker", "name", "oneLiner", "status", "lastBurn", "receipts", "rulesSha12", "pageUrl", "verifyUrl"]);
const URLS = obj({ svg: str, png: str, json: str }, ["svg", "png", "json"]);
const SNIPPETS = obj({ iframe: str, markdown: str, html: str }, ["iframe", "markdown", "html"]);

const CHECK = obj({ id: str, ok: { type: ["boolean", "null"] }, detail: str }, ["id", "ok", "detail"]);
const CLONE = obj({
  mint: str, chain: { const: "solana" }, symbol: str, name: str, pool: nstr, dex: nstr, url: nstr, firstSeenAt: str, lastSeenAt: str, poolCreatedAt: nstr,
  matched: obj({ term: str, how: str }, ["term", "how"]), registered: { type: ["boolean", "null"], description: "true / false from the burn_receipts program; null when this host does not read the program" },
  bundle: { anyOf: [obj({ wallets: int, sharePct: num }, ["wallets", "sharePct"]), { type: "null" }] },
  lp: obj({ state: { enum: ["present", "thin", "pulled", "unknown"] }, pulledAt: nstr }, ["state", "pulledAt"]),
  evidence: { ...arr(str), description: "plain evidence lines (copy lint applies); never a person's name" },
}, ["mint", "chain", "symbol", "name", "firstSeenAt", "lastSeenAt", "matched", "registered", "bundle", "lp", "evidence"]);

export const BADGE_SCHEMAS: Record<string, Schema> = {
  MintVerification: obj({
    schema: { const: "burnticker.verify-mint/v1" }, mint: str, cluster: str, programId: str, checkedAt: str,
    verdict: { enum: ["burnticker", "program-only", "not-launched", "not-registered", "invalid"] }, headline: str, summary: str,
    program: obj({ read: { type: "boolean" }, config: nstr, rulesSha256: nstr, readings: { type: ["integer", "null"] }, burns: { type: ["integer", "null"] } }, ["read", "config", "rulesSha256"]),
    coin: { anyOf: [obj({ ticker: str, name: str, status: str, creator: str, launchedAt: nstr, rulesSha256: str, receipts: int, burns: int, platformId: nstr, pageUrl: str, rulesMatch: { type: ["boolean", "null"] } }, ["ticker", "name", "status", "creator", "rulesSha256", "receipts", "pageUrl"]), { type: "null" }] },
    checks: arr(CHECK), links: obj({ verifier: str, page: nstr, self: str }, ["verifier", "page", "self"]),
  }, ["schema", "mint", "verdict", "headline", "summary", "program", "coin", "checks", "links"], { description: "Is this mint a Burnticker coin? The program's TokenConfig and the registry, compared. Plain words, never an accusation." }),
  Clone: CLONE,
  Clones: obj({ schema: { const: "burnticker.clones/v1" }, generatedAt: str, terms: arr(str), note: str, clones: arr(ref("Clone")), lastScan: { anyOf: [obj({ at: str, hits: int, errors: arr(str) }, ["at", "hits", "errors"]), { type: "null" }] } }, ["schema", "generatedAt", "terms", "note", "clones", "lastScan"], { description: "The public \"Not Burnticker\" list: Solana tokens whose name or ticker matches DEFICIT, Burnticker or a launched ticker and that are not Burnticker coins, with evidence only." }),
  BadgeSide: SIDE,
  Badge: {
    description: "One coin's (kind coin: the BadgeSide fields at the top level) or one rivalry pair's (kind pair: a, b, score) receipt card. No market data of any kind.",
    type: "object", required: ["schema", "kind", "generatedAt", "nextSettlementAt", "nextSettlementNote", "badgeUrl", "embedUrl", "embed", "disclaimer"],
    properties: {
      schema: { const: "burnticker.badge/v1" }, kind: { enum: ["coin", "pair"] }, generatedAt: str,
      ticker: str, name: str, oneLiner: str, window: nstr, status: str, lastBurn: LAST_BURN, receipts: RECEIPTS, rulesSha12: str,
      pairId: str, a: ref("BadgeSide"), b: ref("BadgeSide"), score: obj({ a: int, b: int }, ["a", "b"]),
      nextSettlementAt: { ...nstr, description: "the next market close the venue lists, else the keeper's next read of the source" }, nextSettlementNote: str,
      pageUrl: str, verifyUrl: str, badgeUrl: URLS, embedUrl: str, embed: SNIPPETS, disclaimer: str, affiliation: str,
    },
  },
};

const FILE = (what: string) => ({ name: "file", in: "path" as const, required: true, description: `${what}.svg (the card), .png (the card, 2× density) or .json (the payload)`, schema: { type: "string", pattern: "^[A-Za-z0-9_-]{2,64}\\.(svg|png|json)$" } });

export const BADGE_ENDPOINTS = [
  { operationId: "verifyMint", method: "GET" as const, path: "/verify-mint/{mint}", tag: "tokens", summary: "Is this mint a Burnticker coin?", description: "Since 1.7.0. Reads the burn_receipts program's TokenConfig for the mint (through the platform's read-only program client; a host without the deployed program says it did not read it) and Burnticker's registry, and compares the rules sha256. Verdict burnticker (\"Burnticker coin: yes\" — ticker, creator, launch date, receipts, page link), program-only, not-launched (a draft), not-registered (\"NOT registered with the burn_receipts program\") or invalid. Plain words, never an accusation. Cached 60 s per mint. The page is /burnticker/verify.", params: [{ name: "mint", in: "path" as const, required: true, description: "any Solana mint address (base58)", schema: str }], request: null, response: "MintVerification", errors: [429], cacheSec: 60, bucket: "heavy" as const },
  { operationId: "listClones", method: "GET" as const, path: "/clones", tag: "tokens", summary: "The \"Not Burnticker\" list: lookalike tokens, with evidence", description: "Since 1.7.0. What the clone watch (src/lib/burnticker/ops/cloneWatch.ts, a keeper-side job) recorded: Solana tokens whose name or ticker matches DEFICIT, Burnticker or a launched ticker (lookalike spellings included) and that are not Burnticker coins — mint, pool, first seen, whether the burn_receipts program knows the mint, the holder-stack signal (top holders with identical shares), the LP state and when it was pulled. Evidence only: no person is named, no claim is made beyond what the chain and the pool index showed.", params: [], request: null, response: "Clones", errors: [429], cacheSec: 300, bucket: "read" as const },
  { operationId: "getBadge", method: "GET" as const, path: "/badge/{file}", tag: "tokens", summary: "A coin's embeddable receipt card (SVG, PNG or JSON)", description: "Since 1.7.0. A small B1-receipt card for one launched coin: the ticker, the rule's one-liner, the last burn (date and units), the receipts this season and a \"verify →\" link to the coin page's verifier. Built from the coin page's own status and receipts; no price, market cap, odds, implied chance or volume. Cached 60 s. The iframe version with a live next-settlement line is /burnticker/embed/<TICKER>.", params: [FILE("<TICKER> (or the mint)")], request: null, response: "Badge", media: ["image/svg+xml", "image/png"], errors: [404, 429], cacheSec: 60, bucket: "read" as const },
  { operationId: "getPairBadge", method: "GET" as const, path: "/badge/pairs/{file}", tag: "tokens", summary: "A rivalry pair's embeddable receipt card (SVG, PNG or JSON)", description: "Since 1.7.0. Both coins of a pair on one card: the burns per side (the receipts are the scoreboard), each side's one-liner, the last burn and a \"verify →\" link to the pair page. Same rules as /badge/{file}. The iframe version is /burnticker/embed/pairs/<pairId>.", params: [FILE("<pairId>")], request: null, response: "Badge", media: ["image/svg+xml", "image/png"], errors: [404, 429], cacheSec: 60, bucket: "read" as const },
];
