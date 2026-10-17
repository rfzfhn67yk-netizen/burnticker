/**
 * THE REQUEST BUDGET (owner, 2026-10-13 night: "make sure we never exceed our API limits for any keeper"). Every outbound HTTP or
 * JSON-RPC call the two keepers and the web server make passes `take(source)` first. One table (SOURCES below, documented in
 * docs/burnticker/API-BUDGETS.md) holds each provider's published limit; a process may use at most BUDGET_FRACTION (60%) of it,
 * split between the processes that call the same provider (ROLE_SHARES), so the keeper, the $DEFICIT keeper and the site together
 * stay at or under 60% of every documented limit.
 *
 *   rate buckets   per second / minute / hour, as the provider states its limit. An empty bucket WAITS (never fails) up to
 *                  `maxWaitMs`; a wait longer than that answers "busy" and the read is skipped this cycle (it is tried next cycle).
 *                  A bucket never holds more than ten seconds of its rate, so a quiet spell cannot turn into a burst.
 *   day budget     the provider's day or month limit as a per-UTC-day count (a month is read as 30 days). The count lives in the
 *                  database's `status` table (the registry for the keeper and the site, the ledger for the $DEFICIT keeper), so a
 *                  restart does not reset it. When it is spent the source is ON HOLD until midnight UTC: `take` answers "hold" at once,
 *                  no request is made, the hold is logged once, and the keeper skips that source's reads for the rest of the day.
 *   alert          one `bt-api-budget` alert when a source passes 80% of its day budget, and one when it is put on hold.
 *
 * Calls that finish a send already in flight (`sendTransaction`, `getSignatureStatuses`, `getBlockHeight`) are "essential": a hold does not stop them
 * (they still count and still wait for the rate bucket), so a hold never strands a transaction halfway.
 *
 * LANES (2026-10-15 prelaunch audit C2, tightened after its blind review): the site's Helius slice is split so anonymous traffic cannot
 * stop a launch confirmation or a wallet send, and no lane can spend another's share (LANE_SPLIT; only the web role splits):
 *
 *   confirm   the launch verifier (server.ts), 10% of the day, reachable from no browser
 *   flight    a browser swap or launch carrying a flight token (rpcFlight.ts), 15% of the day, and its own rate bucket (a quarter of the
 *             source's rate), so tokens cannot starve the site
 *   proxy     the browser's proxy without a token: at most 35% of the day and half the source's rate
 *   general   every other site read: the day less the two reserves, counted WITHOUT the reserved lanes' spend, so a busy confirm or flight
 *             lane never holds the pages
 *
 * Each reserved lane stops at its own ceiling. Past it only the calls that finish a send already in flight (ESSENTIAL: sendTransaction,
 * getSignatureStatuses, getBlockHeight) still pass, and they still count. In the proxy lane nothing is essential.
 *
 * A process that never calls `configureApiBudget` (the tests, one-off scripts, the browser) runs the budget PASSIVE: it counts but never
 * waits or holds, unless NODE_ENV is "production" (the web server). The keepers configure it at start. Client-safe: no node imports.
 */

export type BudgetRole = "keeper" | "deficit" | "web";
export const BUDGET_FRACTION = 0.6;
export const ALERT_AT = 0.8;
/** The longest one call waits for a rate bucket before it answers "busy". */
export const DEFAULT_MAX_WAIT_MS = 20_000;
/** A bucket holds at most this much of its rate: no bursts after a quiet spell. */
const BURST_WINDOW_MS = 10_000;

export interface SourceLimit { perSec?: number; perMin?: number; perHour?: number; perDay?: number; perMonth?: number }
export interface SourceSpec {
  id: string; label: string;
  /** The provider's documented limit (null: none published; the house default applies and the doc says so). */
  limit: SourceLimit;
  /** Whether `limit` is the provider's own published figure (false: a house default, because none is published). */
  established: boolean;
  /** "credit": the day budget counts the provider's credits (Helius), the rate buckets count requests. */
  unit: "request" | "credit";
  /** This source's split of the 60% between the processes that call it (default ROLE_SHARES). */
  shares?: Partial<Record<BudgetRole, number>>;
}

/** The default split of the 60% between the three processes (sums to 1, so together they never pass 60%). */
export const ROLE_SHARES: Record<BudgetRole, number> = { keeper: 0.5, web: 0.3, deficit: 0.2 };

/**
 * THE TABLE. Figures and their sources: docs/burnticker/API-BUDGETS.md. A house default (established: false) is used where the
 * provider publishes no limit: one request every two seconds, ten a minute, 2,000 a day, before the 60% and the split.
 */
const HOUSE: SourceLimit = { perSec: 0.5, perMin: 10, perDay: 2_000 };
export const SOURCES: readonly SourceSpec[] = [
  // Solana RPC: the Helius Developer plan (one plan, two keys: keeper, site; OPS-EDGE.md). 10M credits a month, 50 requests a second.
  { id: "helius", label: "Helius RPC", limit: { perSec: 50, perMonth: 10_000_000 }, established: true, unit: "credit", shares: { keeper: 0.6, web: 0.3, deficit: 0.1 } },
  { id: "helius-send", label: "Helius sendTransaction", limit: { perSec: 5 }, established: true, unit: "request", shares: { keeper: 0.6, web: 0.3, deficit: 0.1 } },
  { id: "solana-public", label: "Solana public RPC", limit: { perSec: 4 }, established: true, unit: "request" },
  { id: "thesportsdb", label: "TheSportsDB", limit: { perMin: 100 }, established: true, /* Premium: the owner holds both Premium plans since 2026-10-10 (Single Developer 100/min, Business 120/min; Paddle receipts); 100/min is right for either key */ unit: "request", shares: { keeper: 0.6, web: 0.4 } },
  { id: "mlb-stats", label: "MLB Stats API", limit: HOUSE, established: false, unit: "request", shares: { keeper: 0.6, web: 0.4 } },
  { id: "nhl-api", label: "NHL web API", limit: HOUSE, established: false, unit: "request", shares: { keeper: 0.6, web: 0.4 } },
  { id: "nba-cdn", label: "NBA data feed", limit: HOUSE, established: false, unit: "request", shares: { keeper: 0.6, web: 0.4 } },
  { id: "espn", label: "ESPN site API", limit: HOUSE, established: false, unit: "request", shares: { keeper: 0.6, web: 0.4 } },
  // API-Sports (BURNTICKER_APISPORTS_KEY; the settlement cross-read and, since 2026-10-16 audit F-4, the NFL day listing's second source):
  // the free plan allows 100 requests a day and 10 a minute on EACH sport's API, so each API host is its own source. Before this row
  // the hosts fell under the house default (2,000 a day), which the provider would have refused long before. The keeper holds 0.85 of
  // the 60% (it settles games on it; the site only reads the NFL day listing while TheSportsDB is down), the web 0.15.
  { id: "apisports-american-football", label: "API-Sports American football", limit: { perMin: 10, perDay: 100 }, established: true, unit: "request", shares: { keeper: 0.85, web: 0.15 } },
  { id: "apisports-football", label: "API-Sports football (soccer)", limit: { perMin: 10, perDay: 100 }, established: true, unit: "request", shares: { keeper: 0.85, web: 0.15 } },
  { id: "apisports-basketball", label: "API-Sports basketball", limit: { perMin: 10, perDay: 100 }, established: true, unit: "request", shares: { keeper: 0.85, web: 0.15 } },
  { id: "polymarket-gamma", label: "Polymarket Gamma", limit: { perSec: 30 }, established: true, unit: "request", shares: { keeper: 0.6, web: 0.4 } },
  // 2026-10-14: the house limit (0.5/s) refused a launch preflight — one payout read is three eth_calls in a row, and the web lane had
  // one call every 8 s. No public node publishes a limit; 4/s, 60/min, 2,000/day stays polite and lets a preflight run at once.
  // Alchemy Polygon app "Burnticker keeper" (made 2026-10-14, first in BURNTICKER_POLYGON_RPC_URLS). Alchemy's free tier is metered
  // in compute units (eth_call 26 CU, 330 CU/s throughput, 30M CU a month): 10/s and 100,000/day stay well inside it.
  { id: "alchemy-polygon", label: "Alchemy Polygon RPC", limit: { perSec: 10, perDay: 100_000 }, established: true, unit: "request", shares: { keeper: 0.5, web: 0.5 } },
  { id: "polygon-rpc", label: "Polygon public RPC", limit: { perSec: 4, perMin: 60, perDay: 2_000 }, established: false, unit: "request", shares: { keeper: 0.5, web: 0.5 } },
  { id: "kalshi", label: "Kalshi API", limit: { perSec: 20 }, established: true, unit: "request", shares: { keeper: 0.6, web: 0.4 } },
  { id: "pyth-hermes", label: "Pyth Hermes", limit: { perSec: 1 }, established: true, unit: "request", shares: { keeper: 0.6, web: 0.4 } },
  // audit 2026-10-15 H4: the house limit gave the web lane 0.15 uploads a second (one every 7 s), so a pair's four uploads queued for
  // about half a minute inside the launch request. Irys's upload node publishes no per-client limit and takes bursts; 5/s, 120/min,
  // 5,000/day before the 60% and the split leaves the web lane 1.5/s and 36/min, so a pair's uploads run at once.
  { id: "irys", label: "Irys uploads", limit: { perSec: 5, perMin: 120, perDay: 5_000 }, established: false, unit: "request", shares: { keeper: 0.5, web: 0.5 } },
  { id: "fiscal-data", label: "Treasury Fiscal Data", limit: HOUSE, established: false, unit: "request", shares: { deficit: 0.5, keeper: 0.3, web: 0.2 } },
  { id: "fred", label: "FRED", limit: { perMin: 120 }, established: true, unit: "request" },
  { id: "nws", label: "NWS api.weather.gov", limit: HOUSE, established: false, unit: "request" },
  { id: "iem", label: "Iowa Environmental Mesonet", limit: HOUSE, established: false, unit: "request" },
  { id: "fec", label: "FEC API", limit: { perHour: 1_000 }, established: true, unit: "request" },
  { id: "jupiter", label: "Jupiter API (keyless)", limit: { perMin: 30 }, established: true, unit: "request" },
  { id: "dexscreener", label: "DexScreener API", limit: { perMin: 60 }, established: true, unit: "request" },
  { id: "geckoterminal", label: "GeckoTerminal API", limit: { perMin: 10 }, established: true, unit: "request" },
  { id: "redstone", label: "RedStone gateway", limit: HOUSE, established: false, unit: "request" },
  { id: "bls", label: "BLS API", limit: { perDay: 500 }, established: true, unit: "request" },
  { id: "launch-library", label: "Launch Library 2", limit: { perHour: 15 }, established: true, unit: "request" },
  { id: "github", label: "GitHub API", limit: { perHour: 60 }, established: true, unit: "request" },
  { id: "reclaim", label: "Reclaim attestor list", limit: HOUSE, established: false, unit: "request" },
  /** Every other host (the catalogue's long tail): the house default, per host. */
  { id: "other-http", label: "Other public hosts (each)", limit: HOUSE, established: false, unit: "request" },
];
const SPEC_BY_ID = new Map(SOURCES.map((s) => [s.id, s]));
export const specOf = (id: string): SourceSpec => SPEC_BY_ID.get(id) ?? SPEC_BY_ID.get(id.startsWith("http:") ? "other-http" : id)!;

/** Host → source. Anything unlisted is `http:<host>` (the house default, counted per host). */
const HOSTS: [RegExp, string][] = [
  [/(^|\.)helius-rpc\.com$|(^|\.)helius\.xyz$/, "helius"],
  [/^api\.(mainnet-beta|devnet|testnet)\.solana\.com$/, "solana-public"],
  [/(^|\.)thesportsdb\.com$/, "thesportsdb"], [/^statsapi\.mlb\.com$/, "mlb-stats"], [/^api-web\.nhle\.com$/, "nhl-api"], [/(^|\.)nba\.com$/, "nba-cdn"],
  [/^v1\.american-football\.api-sports\.io$/, "apisports-american-football"], [/^v3\.football\.api-sports\.io$/, "apisports-football"], [/^v1\.basketball\.api-sports\.io$/, "apisports-basketball"],
  [/(^|\.)espn\.com$/, "espn"], [/^gamma-api\.polymarket\.com$/, "polymarket-gamma"],
  [/^polygon-mainnet\.g\.alchemy\.com$/, "alchemy-polygon"],
  [/^(polygon-rpc\.com|polygon-bor\.publicnode\.com|polygon-bor-rpc\.publicnode\.com|polygon\.drpc\.org|1rpc\.io)$/, "polygon-rpc"],
  [/(^|\.)kalshi\.com$/, "kalshi"], [/^hermes(-beta)?\.pyth\.network$|(^|\.)pyth\.network$/, "pyth-hermes"], [/(^|\.)irys\.xyz$/, "irys"],
  [/^api\.fiscaldata\.treasury\.gov$/, "fiscal-data"], [/(^|\.)stlouisfed\.org$/, "fred"], [/^api\.weather\.gov$/, "nws"], [/^mesonet\.agron\.iastate\.edu$/, "iem"],
  [/^api\.open\.fec\.gov$/, "fec"], [/(^|\.)jup\.ag$/, "jupiter"], [/^api\.dexscreener\.com$/, "dexscreener"], [/^api\.geckoterminal\.com$/, "geckoterminal"],
  [/(^|\.)redstone\.finance$/, "redstone"], [/^api\.bls\.gov$/, "bls"], [/^ll\.thespacedevs\.com$/, "launch-library"], [/^api\.github\.com$/, "github"],
  [/(^|\.)reclaimprotocol\.org$/, "reclaim"],
];
const hostOf = (url: string): string => { try { return new URL(url).hostname.toLowerCase(); } catch { return "invalid"; } };
export function sourceForUrl(url: string): string {
  const h = hostOf(url);
  for (const [re, id] of HOSTS) if (re.test(h)) return id;
  return `http:${h}`;
}
/** A Solana RPC URL's source: the public endpoints by host; any other RPC is the keyed plan (Helius, OPS-EDGE.md). */
export function rpcSourceFor(url: string): string {
  const s = sourceForUrl(url);
  return s === "solana-public" ? s : "helius";
}

/**
 * Helius credits for one JSON-RPC body (a call or a batch), from helius.dev/docs/billing/credits (read 2026-10-13): a standard call,
 * an archival read (getTransaction, getSignaturesForAddress, getBlock) and a send are 1 credit; getProgramAccounts and every DAS call
 * (searchAssets, getAsset …) are 10. An unparseable body counts 1 per call.
 */
const TEN_CREDITS = new Set(["getProgramAccounts", "searchAssets", "getAsset", "getAssetBatch", "getAssetsByOwner", "getAssetsByAuthority", "getAssetsByCreator",
  "getAssetsByGroup", "getAssetProof", "getAssetProofBatch", "getTokenAccounts", "getSignaturesForAsset", "getNftEditions", "sendBundle"]);
/** Essential: a hold never stops them (they still count). */
const ESSENTIAL = new Set(["sendTransaction", "getSignatureStatuses", "getBlockHeight"]);
/** The budget lanes (C2): "general" (the default), "proxy", "flight" and "confirm" (see the header). */
export type BudgetLane = "general" | "proxy" | "flight" | "confirm";
/** Per source, the web role's split of its day (fractions of the day budget) and of its rate (fractions of each rate bucket). */
export interface LaneSplitSpec { confirmReserve: number; flightReserve: number; proxyCap: number; proxyRate: number; flightRate: number }
export const LANE_SPLIT: Readonly<Record<string, LaneSplitSpec>> = { helius: { confirmReserve: 0.10, flightReserve: 0.15, proxyCap: 0.35, proxyRate: 0.5, flightRate: 0.25 } };
/** Methods made essential for the duration of one call (withEssential): the keeper's startup genesis read only (re-review N5). */
const essentialNow = new Set<string>();
/**
 * Runs `fn` with `methods` essential: the Burnticker keeper's startup getGenesisHash (2026-10-15 review): the cluster check must read
 * the KEYED RPC even on a spent day (one credit per process), never a fallback. Every other role and every later call: ordinary.
 */
export async function withEssential<T>(methods: readonly string[], fn: () => Promise<T>): Promise<T> {
  const added = methods.filter((m) => !essentialNow.has(m));
  for (const m of added) essentialNow.add(m);
  try { return await fn(); } finally { for (const m of added) essentialNow.delete(m); }
}
/**
 * Never moved to the hold fallback (2026-10-15 review): the calls that build or describe one of the keeper's own sends. On a spent day they
 * fail like any held read, so nothing is signed from public-RPC state and sent through the keyed RPC (stale prev → QuorumNotMet, fees).
 */
export const NO_FALLBACK = new Set(["getGenesisHash", "getLatestBlockhash", "simulateTransaction", "getTransaction", "getParsedTransaction", "sendTransaction",
  "getSignatureStatuses", "getBlockHeight", "getFeeForMessage", "getRecentPrioritizationFees"]);
/**
 * Reads that DESCRIBE a landed transaction (memos, claim and forward facts). They may move to the fallback only while the keeper runs a
 * cycle with its sends held (re-review N4: a held day's adoption step reads them; nothing is built from them on such a cycle).
 */
export const DESCRIBE_METHODS = new Set(["getTransaction", "getParsedTransaction"]);
let describeFallback = false;
/** The keeper sets this true for a cycle it runs with sends held on a spent day, false otherwise. */
export function setDescribeFallback(on: boolean): void { describeFallback = on; }
export function rpcCallsOf(body: unknown): { calls: number; credits: number; essential: boolean; sends: number; methods: Record<string, number>; callsByMethod: Record<string, number> } {
  let parsed: unknown = body;
  if (typeof body === "string") { try { parsed = JSON.parse(body); } catch { return { calls: 1, credits: 1, essential: false, sends: 0, methods: { unknown: 1 }, callsByMethod: { unknown: 1 } }; } }
  const arr = Array.isArray(parsed) ? parsed : [parsed];
  let credits = 0, sends = 0, essential = arr.length > 0;
  const methods: Record<string, number> = {}, callsByMethod: Record<string, number> = {};
  for (const c of arr) {
    const m = c && typeof c === "object" ? String((c as { method?: unknown }).method ?? "") : "";
    const cr = TEN_CREDITS.has(m) ? 10 : 1;
    credits += cr;
    methods[m || "unknown"] = (methods[m || "unknown"] ?? 0) + cr;
    callsByMethod[m || "unknown"] = (callsByMethod[m || "unknown"] ?? 0) + 1;
    if (!ESSENTIAL.has(m) && !essentialNow.has(m)) essential = false;
    if (m === "sendTransaction") sends++;
  }
  if (!arr.length) { methods.unknown = 1; callsByMethod.unknown = 1; }
  return { calls: Math.max(1, arr.length), credits: Math.max(1, credits), essential, sends, methods, callsByMethod };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The persistent day count
// ---------------------------------------------------------------------------------------------------------------------------------

/** Where the day counts live. `add` adds `delta` to `key`'s count for `day` (starting from 0 on a new day) and returns the total. */
export interface BudgetStore {
  add(key: string, day: string, delta: number, now: number): number;
  get(key: string): string | null;
  set(key: string, value: string, now: number): void;
  /** Adds each delta to `key`'s {day, counts} object atomically per entry (a new day starts from zero). */
  addCounts?(key: string, day: string, deltas: Record<string, number>, now: number): void;
}
const countPath = (k: string): string => `$.counts."${k.replace(/["\\]/g, "")}"`;
/** Minimal node:sqlite surface (the registry's and the ledger's `db`). Method syntax keeps it assignable from DatabaseSync. */
export interface SqlLike { prepare(sql: string): { run(...a: never[]): unknown; get(...a: never[]): unknown } }

/**
 * The store over a `status (key TEXT PRIMARY KEY, value TEXT, updated_at INTEGER)` table — the registry's and the ledger's. The add
 * is one atomic UPSERT, so two processes adding to the same key never lose a count.
 */
export function statusTableStore(db: SqlLike): BudgetStore {
  const run = (sql: string, ...a: unknown[]) => (db.prepare(sql).run as (...x: unknown[]) => unknown)(...a);
  const get = (sql: string, ...a: unknown[]) => (db.prepare(sql).get as (...x: unknown[]) => unknown)(...a) as { value?: string } | undefined;
  return {
    add(key, day, delta, now) {
      run(`INSERT INTO status (key, value, updated_at) VALUES (?, json_object('day', ?, 'used', ?), ?)
           ON CONFLICT(key) DO UPDATE SET value = CASE WHEN json_extract(status.value, '$.day') = ? THEN json_set(status.value, '$.used', json_extract(status.value, '$.used') + ?)
           ELSE json_object('day', ?, 'used', ?) END, updated_at = excluded.updated_at`, key, day, delta, now, day, delta, day, delta);
      const r = get("SELECT value FROM status WHERE key=?", key);
      try { const j = JSON.parse(r?.value ?? "{}") as { day?: string; used?: number }; return j.day === day ? Number(j.used ?? 0) : 0; } catch { return 0; }
    },
    get(key) { return get("SELECT value FROM status WHERE key=?", key)?.value ?? null; },
    set(key, value, now) { run("INSERT INTO status (key, value, updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at", key, value, now); },
    addCounts(key, day, deltas, now) {
      run(`INSERT INTO status (key, value, updated_at) VALUES (?, json_object('day', ?, 'counts', json_object()), ?) ON CONFLICT(key) DO NOTHING`, key, day, now);
      for (const [k, d] of Object.entries(deltas)) {
        const pth = countPath(k);
        run(`UPDATE status SET value = CASE WHEN json_extract(value, '$.day') = ? AND json_type(value, '$.counts') = 'object'
               THEN json_set(value, ?, coalesce(json_extract(value, ?), 0) + ?) ELSE json_set(json_object('day', ?, 'counts', json_object()), ?, ?) END,
             updated_at = ? WHERE key = ?`, day, pth, pth, d, day, pth, d, now, key);
      }
    },
  };
}
/** An in-memory store (tests; a process with no database). Shared between ApiBudget instances to simulate a restart. */
export function memoryStore(): BudgetStore & { rows: Map<string, string> } {
  const rows = new Map<string, string>();
  return {
    rows,
    add(key, day, delta) { let j: { day?: string; used?: number } = {}; try { j = JSON.parse(rows.get(key) ?? "{}"); } catch { j = {}; } const used = (j.day === day ? Number(j.used ?? 0) : 0) + delta; rows.set(key, JSON.stringify({ day, used })); return used; },
    get(key) { return rows.get(key) ?? null; },
    set(key, value) { rows.set(key, value); },
    addCounts(key, day, deltas) {
      let j: { day?: string; counts?: Record<string, number> } = {};
      try { j = JSON.parse(rows.get(key) ?? "{}"); } catch { j = {}; }
      const counts = j.day === day && j.counts ? j.counts : {};
      for (const [k, d] of Object.entries(deltas)) counts[k] = (counts[k] ?? 0) + d;
      rows.set(key, JSON.stringify({ day, counts }));
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The budget
// ---------------------------------------------------------------------------------------------------------------------------------

export type TakeOutcome = { state: "ok"; waitedMs: number } | { state: "hold"; used: number; budget: number } | { state: "busy"; waitMs: number };
export interface BudgetAlert { kind: "bt-api-budget"; key: string; text: string; meta: Record<string, unknown>; level: "80" | "hold" }
export interface BudgetLine { source: string; label: string; role: BudgetRole; day: string; used: number; budget: number; unit: SourceSpec["unit"]; state: "ok" | "past-80" | "hold"; established: boolean }

export class BudgetHoldError extends Error {
  readonly source: string; readonly outcome: Exclude<TakeOutcome, { state: "ok" }>;
  constructor(source: string, outcome: Exclude<TakeOutcome, { state: "ok" }>) {
    super(outcome.state === "hold" ? `${specOf(source).label}: today's request budget is spent (${outcome.used} of ${outcome.budget}); reads wait until midnight UTC`
      : `${specOf(source).label}: the request rate budget is full; this read waits for the next cycle`);
    this.name = "BudgetHoldError"; this.source = source; this.outcome = outcome;
  }
}

interface Bucket { ratePerMs: number; cap: number; tokens: number; last: number }
interface SourceState { buckets: Bucket[]; day: string; stored: number; pending: number; lastFlush: number; alerted80: boolean; held: boolean;
  /** Today's spend by "phase:method" (2026-10-15: the keeper's log prints the top lines, so a credit burn is measured, not guessed). */
  /** Not yet written deltas (flushed with the atomic addCounts); `local` holds the totals when there is no store. */
  methodDeltas: Record<string, number>; methodsLocal: Record<string, number>;
  /** Today's spend per lane (C2; the web role's split sources only): stored + pending, flushed with the day count. */
  lanes: Partial<Record<BudgetLane, { stored: number; pending: number; held: boolean }>>;
  /** The proxy's and the flight lane's own rate buckets (a fraction of the source's), on top of the shared ones. */
  laneBuckets: Partial<Record<BudgetLane, Bucket[]>> }

export interface ApiBudgetOpts {
  role: BudgetRole; store?: BudgetStore | null; now?: () => number; sleep?: (ms: number) => Promise<void>; maxWaitMs?: number;
  log?: (s: string) => void; alert?: (a: BudgetAlert) => void;
  /** false: count only, never wait or hold (the passive default for an unconfigured process). */
  enforce?: boolean;
  /** Flush the pending count to the store after this many units or this long, whichever comes first. */
  flushUnits?: number; flushMs?: number;
}

const utcDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const fmt = (n: number): string => Math.round(n).toLocaleString("en-US");

/** A source's numbers for one role: its rate buckets (per ms) and its day budget, after the 60% and the role's share. */
export function budgetFor(spec: SourceSpec, role: BudgetRole): { rates: { perMs: number; windowMs: number }[]; perDay: number; share: number } {
  const share = spec.shares ? (spec.shares[role] ?? 0) : ROLE_SHARES[role];
  const f = BUDGET_FRACTION * share, L = spec.limit;
  const rates: { perMs: number; windowMs: number }[] = [];
  if (L.perSec) rates.push({ perMs: (L.perSec * f) / 1_000, windowMs: 1_000 });
  if (L.perMin) rates.push({ perMs: (L.perMin * f) / 60_000, windowMs: 60_000 });
  if (L.perHour) rates.push({ perMs: (L.perHour * f) / 3_600_000, windowMs: 3_600_000 });
  // the day budget: the tightest of the stated limits read as a day (a month is 30 days); rate limits bound it too
  const caps = [L.perDay, L.perMonth ? L.perMonth / 30 : undefined, L.perHour ? L.perHour * 24 : undefined, L.perMin ? L.perMin * 1_440 : undefined, L.perSec ? L.perSec * 86_400 : undefined]
    .filter((x): x is number => typeof x === "number");
  const perDay = Math.floor((caps.length ? Math.min(...caps) : 0) * f + 1e-6);
  return { rates, perDay, share };
}

export class ApiBudget {
  readonly role: BudgetRole;
  readonly enforce: boolean;
  private store: BudgetStore | null; private now: () => number; private sleep: (ms: number) => Promise<void>; private maxWait: number;
  private log: (s: string) => void; private alert: ((a: BudgetAlert) => void) | null; private flushUnits: number; private flushMs: number;
  private states = new Map<string, SourceState>();
  private phase = "";
  private fallbacks = new Map<string, string>();

  constructor(o: ApiBudgetOpts) {
    this.role = o.role; this.enforce = o.enforce ?? true; this.store = o.store ?? null; this.now = o.now ?? (() => Date.now());
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))); this.maxWait = o.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
    this.log = o.log ?? (() => undefined); this.alert = o.alert ?? null; this.flushUnits = o.flushUnits ?? 20; this.flushMs = o.flushMs ?? 5_000;
  }

  /** The status-table key of a source's day count for this process's role. */
  dayKey(source: string): string { return `apiBudget.day.${this.role}.${source}`; }
  private holdKey(source: string): string { return `apiBudget.hold.${this.role}.${source}`; }
  /** The status-table key of a source's per-method spend for this role (one writer: this role's process). */
  methodsKey(source: string): string { return `apiBudget.methods.${this.role}.${source}`; }
  /**
   * The phase the next calls are counted under ("cycle", "pair-curve", "publish", "ops" in the keeper). The keeper runs its phases one
   * after another, so the phase names the module that spent the credits. Returns the previous phase.
   */
  /**
   * Names the fallback that serves `source`'s reads while it is on hold (the keeper: "the public Solana RPC"), so the hold's log line and
   * alert say what really happens; null: no fallback (reads stop).
   */
  setFallback(source: string, label: string | null): void { if (label) this.fallbacks.set(source, label); else this.fallbacks.delete(source); }
  /** True when `source`'s day budget is spent (enforcing budgets only): the keeper runs such a cycle with its sends held. */
  isHeld(source: string): boolean { if (!this.enforce) return false; const s = this.state(source); return s.held || s.stored + s.pending >= this.dayBudget(source); }
  /** A log line through this budget's logger (the keeper's log). */
  note(line: string): void { try { this.log(line); } catch { /* logging never stops a read */ } }
  setPhase(phase: string): string { const was = this.phase; this.phase = phase; return was; }
  private loadMethods(source: string, day: string): Record<string, number> {
    if (!this.store) return {};
    try { const j = JSON.parse(this.store.get(this.methodsKey(source)) ?? "{}") as { day?: string; counts?: Record<string, number> }; return j.day === day && j.counts ? { ...j.counts } : {}; } catch { return {}; }
  }

  private state(source: string): SourceState {
    const now = this.now(), day = utcDay(now);
    let s = this.states.get(source);
    if (!s) {
      const b = budgetFor(specOf(source), this.role);
      const buckets = b.rates.map((r) => { const cap = Math.max(1, r.perMs * Math.min(r.windowMs, BURST_WINDOW_MS)); return { ratePerMs: r.perMs, cap, tokens: cap, last: now }; });
      let stored = 0;
      if (this.store) { try { stored = this.store.add(this.dayKey(source), day, 0, now); } catch { stored = 0; } }
      s = { buckets, day, stored, pending: 0, lastFlush: now, alerted80: false, held: false, methodDeltas: {}, methodsLocal: {}, lanes: {}, laneBuckets: {} };
      this.states.set(source, s);
    }
    if (s.day !== day) {   // a new UTC day: what was pending belongs to the old day; the new day starts from the store (another process may have counted)
      this.flushOne(source, s);
      s.day = day; s.pending = 0; s.alerted80 = false; s.held = false; s.methodDeltas = {}; s.methodsLocal = {}; s.lanes = {};
      if (this.store) { try { s.stored = this.store.add(this.dayKey(source), day, 0, now); } catch { s.stored = 0; } } else s.stored = 0;
    }
    return s;
  }
  private flushMethods(source: string, s: SourceState): void {
    const deltas = s.methodDeltas;
    if (!Object.keys(deltas).length) return;
    s.methodDeltas = {};
    const into = (t: Record<string, number>) => { for (const [k, d] of Object.entries(deltas)) t[k] = (t[k] ?? 0) + d; };
    if (!this.store) { into(s.methodsLocal); return; }
    try {
      if (this.store.addCounts) this.store.addCounts(this.methodsKey(source), s.day, deltas, this.now());
      else { const t = this.loadMethods(source, s.day); into(t); this.store.set(this.methodsKey(source), JSON.stringify({ day: s.day, counts: t }), this.now()); }
    } catch { /* the method split is a measurement; never stops a read */ }
  }
  /** The status-table key of a lane's day count (C2). */
  laneKey(source: string, lane: BudgetLane): string { return `apiBudget.lane.${this.role}.${source}.${lane}`; }
  private lane(source: string, s: SourceState, lane: BudgetLane): { stored: number; pending: number; held: boolean } {
    let l = s.lanes[lane];
    if (!l) {
      let stored = 0;
      if (this.store) { try { stored = this.store.add(this.laneKey(source, lane), s.day, 0, this.now()); } catch { stored = 0; } }
      l = s.lanes[lane] = { stored, pending: 0, held: false };
    }
    return l;
  }
  /** The web role's lane split of `source` in units (null: no split, every call is "general"). */
  laneSplit(source: string): { confirm: number; flight: number; general: number; proxyCap: number; spec: LaneSplitSpec } | null {
    const sp = this.role === "web" ? LANE_SPLIT[source] : undefined;
    if (!sp) return null;
    const budget = this.dayBudget(source);
    const confirm = Math.floor(budget * sp.confirmReserve), flight = Math.floor(budget * sp.flightReserve);
    return { confirm, flight, general: budget - confirm - flight, proxyCap: Math.floor(budget * sp.proxyCap), spec: sp };
  }
  private laneBucketsFor(source: string, s: SourceState, lane: BudgetLane, sp: LaneSplitSpec): Bucket[] {
    const f = lane === "proxy" ? sp.proxyRate : lane === "flight" ? sp.flightRate : 0;
    if (!f) return [];
    let b = s.laneBuckets[lane];
    if (!b) {
      const now = this.now();
      b = s.laneBuckets[lane] = budgetFor(specOf(source), this.role).rates.map((r) => { const perMs = r.perMs * f, cap = Math.max(1, perMs * Math.min(r.windowMs, BURST_WINDOW_MS)); return { ratePerMs: perMs, cap, tokens: cap, last: now }; });
    }
    return b;
  }
  /** Today's spend in one lane (C2). */
  laneUsed(source: string, lane: BudgetLane): number { const s = this.state(source), l = this.lane(source, s, lane); return l.stored + l.pending; }
  private flushOne(source: string, s: SourceState): void {
    this.flushMethods(source, s);
    for (const [lane, l] of Object.entries(s.lanes) as [BudgetLane, { stored: number; pending: number }][]) {
      if (!l.pending) continue;
      if (this.store) { try { l.stored = this.store.add(this.laneKey(source, lane), s.day, l.pending, this.now()); } catch { l.stored += l.pending; } } else l.stored += l.pending;
      l.pending = 0;
    }
    if (!s.pending) return;
    if (this.store) { try { s.stored = this.store.add(this.dayKey(source), s.day, s.pending, this.now()); } catch { s.stored += s.pending; } } else s.stored += s.pending;
    s.pending = 0; s.lastFlush = this.now();
  }
  /** Writes every pending count to the store (the keeper calls it at the end of each cycle and on exit). */
  flush(): void { for (const [k, s] of this.states) this.flushOne(k, s); }

  used(source: string): number { const s = this.state(source); return s.stored + s.pending; }
  dayBudget(source: string): number { return budgetFor(specOf(source), this.role).perDay; }

  /**
   * Takes `requests` from the rate buckets and `units` from the day budget. Waits (never fails) up to maxWaitMs for the buckets;
   * "busy" past that; "hold" at once when the day budget is spent (unless `essential`).
   */
  async take(source: string, o: { units?: number; requests?: number; essential?: boolean; methods?: Record<string, number>; lane?: BudgetLane } = {}): Promise<TakeOutcome> {
    const units = Math.max(0, o.units ?? 1), requests = Math.max(1, o.requests ?? 1);
    const s = this.state(source), budget = this.dayBudget(source);
    const used = s.stored + s.pending;
    // C2 lanes (the web role's split sources): each lane has its own ceiling; the general and proxy lanes are counted without the reserved
    // lanes' spend, so a busy confirm or flight lane never holds the pages; past a ceiling only ESSENTIAL calls pass (never in the proxy lane)
    const split = this.laneSplit(source), lane: BudgetLane = split ? (o.lane ?? "general") : "general";
    const laneState = split ? this.lane(source, s, lane) : null;
    const essential = !!o.essential && lane !== "proxy";
    if (this.enforce && split && laneState && !essential) {
      const lu = laneState.stored + laneState.pending;
      const reserved = (l: BudgetLane) => { const x = this.lane(source, s, l); return x.stored + x.pending; };
      if (lane === "confirm" || lane === "flight") {
        const ceiling = lane === "confirm" ? split.confirm : split.flight;
        if (lu + units > ceiling) { this.onLaneHold(source, s, lane, laneState, lu, ceiling, "cap"); return { state: "hold", used: lu, budget: ceiling }; }
      } else {
        const ordinary = used - reserved("confirm") - reserved("flight");
        if (ordinary + units > split.general) { this.onLaneHold(source, s, lane, laneState, ordinary, split.general, "reserve"); return { state: "hold", used: ordinary, budget: split.general }; }
        if (lane === "proxy" && lu + units > split.proxyCap) { this.onLaneHold(source, s, lane, laneState, lu, split.proxyCap, "cap"); return { state: "hold", used: lu, budget: split.proxyCap }; }
      }
    }
    if (this.enforce && !split && !essential && used + units > budget) { this.onHold(source, s, used, budget); return { state: "hold", used, budget }; }
    let wait = 0;
    if (this.enforce) {
      const now = this.now();
      const buckets = split ? [...s.buckets, ...this.laneBucketsFor(source, s, lane, split.spec)] : s.buckets;
      for (const b of buckets) { b.tokens = Math.min(b.cap, b.tokens + (now - b.last) * b.ratePerMs); b.last = now; }
      for (const b of buckets) wait = Math.max(wait, b.tokens >= requests ? 0 : (requests - b.tokens) / b.ratePerMs);
      if (wait > this.maxWait) return { state: "busy", waitMs: Math.ceil(wait) };
      for (const b of buckets) b.tokens -= requests;   // reserve now (may go negative): concurrent callers queue behind it
    }
    s.pending += units;
    if (laneState) laneState.pending += units;
    const tag = this.phase ? `${this.phase}:` : "";
    for (const [m, n] of Object.entries(o.methods ?? { request: units })) s.methodDeltas[tag + m] = (s.methodDeltas[tag + m] ?? 0) + n;
    const total = s.stored + s.pending;
    if (this.store && (s.pending >= this.flushUnits || this.now() - s.lastFlush >= this.flushMs)) this.flushOne(source, s);
    if (!s.alerted80 && budget > 0 && total >= ALERT_AT * budget) this.on80(source, s, total, budget);
    if (wait > 0) await this.sleep(Math.ceil(wait));
    return { state: "ok", waitedMs: Math.ceil(wait) };
  }

  private on80(source: string, s: SourceState, used: number, budget: number): void {
    s.alerted80 = true;
    if (!this.enforce) return;
    const spec = specOf(source), who = WHO[this.role];
    this.emit({ level: "80", key: `bt-api-budget:${this.role}:${source}:${s.day}:80`, meta: { role: this.role, source, day: s.day, used, budget, unit: spec.unit },
      text: `${who} has used ${Math.floor((100 * used) / budget)}% of today's budget for ${spec.label} (${fmt(used)} of ${fmt(budget)} ${spec.unit === "credit" ? "credits" : "requests"}). If it reaches the budget, reads from ${spec.label} stop until midnight UTC.` });
  }
  private onHold(source: string, s: SourceState, used: number, budget: number): void {
    if (s.held) return;
    s.held = true;
    this.flushOne(source, s);
    const spec = specOf(source), who = WHO[this.role];
    // logged once per day per source, across restarts: the hold marker lives in the store too
    let seen = false;
    if (this.store) { try { seen = this.store.get(this.holdKey(source)) === s.day; this.store.set(this.holdKey(source), s.day, this.now()); } catch { seen = false; } }
    const fb = this.fallbacks.get(source) ?? null;
    if (!seen) this.log(`  [api-budget] ${source} ON HOLD until 00:00 UTC: ${fmt(used)} of ${fmt(budget)} ${spec.unit === "credit" ? "credits" : "requests"} used today (${this.role}); ${fb ? `its reads go to ${fb} (its own budget) and the keeper sends nothing until then` : "its reads are skipped until then"}`);
    if (!this.enforce) return;
    this.emit({ level: "hold", key: `bt-api-budget:${this.role}:${source}:${s.day}:hold`, meta: { role: this.role, source, day: s.day, used, budget, unit: spec.unit },
      text: fb
        ? `${who} used all of today's budget for ${spec.label} (${fmt(used)} of ${fmt(budget)} ${spec.unit === "credit" ? "credits" : "requests"}). Until midnight UTC it reads from ${fb} instead, more slowly, and sends nothing: readings, cranks and claims wait until then.`
        : `${who} used all of today's budget for ${spec.label} (${fmt(used)} of ${fmt(budget)} ${spec.unit === "credit" ? "credits" : "requests"}), so it stopped reading from it until midnight UTC. Reads start again on their own after that. Nothing is retried in the meantime.` });
  }
  /** A lane stopped (C2): logged once per lane per day; the reserve's stop also alerts (ordinary reads wait while confirmations go on). */
  private onLaneHold(source: string, s: SourceState, lane: BudgetLane, l: { held: boolean }, used: number, ceiling: number, why: "reserve" | "cap"): void {
    if (l.held) return;
    l.held = true;
    this.flushOne(source, s);
    const spec = specOf(source), unit = spec.unit === "credit" ? "credits" : "requests";
    const who = lane === "proxy" ? "the browser proxy" : lane === "flight" ? "swaps and launches in visitors' browsers" : lane === "confirm" ? "launch confirmations" : "the site's pages";
    const text = why === "cap"
      ? `${WHO[this.role]}: ${who} used their share of today's ${spec.label} budget (${fmt(used)} of ${fmt(ceiling)} ${unit}). Those reads wait until midnight UTC; transactions already sent are still confirmed, and the other shares go on.`
      : `${WHO[this.role]} used today's ${spec.label} budget up to the parts kept for launch confirmations and swaps in flight (${fmt(used)} of ${fmt(ceiling)} ${unit}); other reads wait until midnight UTC.`;
    this.log(`  [api-budget] ${source} ${lane} lane ON HOLD until 00:00 UTC: ${text}`);
    if (!this.enforce || lane === "proxy") return;
    this.emit({ level: "hold", key: `bt-api-budget:${this.role}:${source}:${s.day}:${lane}`, meta: { role: this.role, source, day: s.day, used, budget: ceiling, unit: spec.unit, lane }, text });
  }
  private emit(a: Omit<BudgetAlert, "kind">): void { try { this.alert?.({ kind: "bt-api-budget", ...a }); } catch { /* an alert never stops a read */ } }

  /** Today's spend for `source` by "phase:method", largest first (this process's role; survives a restart through the store). */
  topMethods(source: string, n = 8): { key: string; used: number }[] {
    const s = this.state(source);
    const t: Record<string, number> = this.store ? this.loadMethods(source, s.day) : { ...s.methodsLocal };
    for (const [k, d] of Object.entries(s.methodDeltas)) t[k] = (t[k] ?? 0) + d;
    return Object.entries(t).map(([key, used]) => ({ key, used })).sort((a, b) => b.used - a.used || a.key.localeCompare(b.key)).slice(0, n);
  }

  /** One line per source this process has touched today, plus every source with a spend recorded in the store. */
  lines(): BudgetLine[] {
    const out: BudgetLine[] = [];
    for (const [source] of this.states) {
      const s = this.state(source), spec = specOf(source), budget = this.dayBudget(source), used = s.stored + s.pending;
      out.push({ source, label: spec.label, role: this.role, day: s.day, used, budget, unit: spec.unit, established: spec.established, state: used >= budget || s.held ? "hold" : used >= ALERT_AT * budget ? "past-80" : "ok" });
    }
    return out.sort((a, b) => a.source.localeCompare(b.source));
  }
}
const WHO: Record<BudgetRole, string> = { keeper: "The Burnticker keeper", deficit: "The $DEFICIT keeper", web: "The Burnticker site" };

/**
 * The top-spenders line per credit-metered source (2026-10-15, after the keeper spent its Helius slice by 20:33Z with six coins):
 * "api budget helius top today: publish:getAccountInfo 40,120 · pair-curve:getProgramAccounts 17,280 · …".
 */
export function budgetTopMethodLines(b: ApiBudget, n = 8): string[] {
  const out: string[] = [];
  for (const l of b.lines()) {
    if (l.unit !== "credit" && l.source !== "solana-public") continue;
    const top = b.topMethods(l.source, n);
    if (top.length) out.push(`api budget ${l.source} top today: ${top.map((t) => `${t.key} ${fmt(t.used)}`).join(" · ")}`);
  }
  return out;
}

/** The status lines: "api budget helius: 1,234 / 120,000 credits today (1%) · ok". */
export function budgetStatusLines(lines: readonly BudgetLine[]): string[] {
  return lines.map((l) => `api budget ${l.source}: ${fmt(l.used)} / ${fmt(l.budget)} ${l.unit === "credit" ? "credits" : "requests"} today (${l.budget ? Math.floor((100 * l.used) / l.budget) : 0}%) · ${l.state === "hold" ? "ON HOLD until 00:00 UTC" : l.state === "past-80" ? "past 80%" : "ok"}`);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The process's budget and the call-site helpers
// ---------------------------------------------------------------------------------------------------------------------------------

let current: ApiBudget | null = null;
/** A production server enforces by default; a browser never does (each visitor's tab is its own small client of the public hosts). */
const isProduction = (): boolean => { try { return typeof window === "undefined" && typeof process !== "undefined" && process.env?.NODE_ENV === "production"; } catch { return false; } };
/** This process's budget: the configured one, else a passive counter (enforcing on a production web server). */
export function apiBudget(): ApiBudget { return (current ??= new ApiBudget({ role: "web", enforce: isProduction() })); }
/** Called once at a process's start (the keepers, the web server's platform()). Replaces any earlier budget (its counts are flushed). */
export function configureApiBudget(o: ApiBudgetOpts): ApiBudget { current?.flush(); current = new ApiBudget(o); return current; }
/** For tests. */
export function resetApiBudget(): void { current = null; }
/** Names the phase this process's next calls are counted under (ApiBudget.setPhase); returns the previous one. */
export function budgetPhase(phase: string): string { return apiBudget().setPhase(phase); }

/** Takes from the process's budget; throws BudgetHoldError on "hold" or "busy" (the caller's read fails like any network error). */
export async function takeOrThrow(source: string, o: { units?: number; requests?: number; essential?: boolean; methods?: Record<string, number>; lane?: BudgetLane } = {}): Promise<void> {
  const r = await apiBudget().take(source, o);
  if (r.state !== "ok") throw new BudgetHoldError(source, r);
}
/**
 * A JSON-RPC POST's take: Helius counts credits by method, the buckets count calls; send/confirm calls are essential. `lane` (C2): the
 * web's lane (see the header); past a lane's ceiling only ESSENTIAL calls pass. In the "proxy" lane nothing is
 * essential: an anonymous caller's getSignatureStatuses counts against the proxy's cap like any read.
 */
export async function takeRpc(url: string, body: unknown, sourceOverride?: string, o: { lane?: BudgetLane } = {}): Promise<void> {
  const source = sourceOverride ?? rpcSourceFor(url), c = rpcCallsOf(body);
  const lane = o.lane ?? "general";
  const essential = lane === "proxy" ? false : c.essential;
  // Helius states a separate, lower rate for sends (5 a second on the Developer plan): a body with a send also takes from that bucket
  if (source === "helius" && c.sends) await takeOrThrow("helius-send", { requests: c.sends, essential: lane !== "proxy" });
  await takeOrThrow(source, { units: source === "helius" ? c.credits : c.calls, requests: c.calls, essential, methods: source === "helius" ? c.methods : c.callsByMethod, lane });
}

/**
 * The public RPC of a cluster: the keeper's fallback while its keyed plan is on hold (its own "solana-public" budget). null for any other
 * cluster (localnet has no public endpoint; never guess mainnet). Pass the cluster the keyed RPC's GENESIS says, not the env's.
 */
export function publicRpcFor(cluster: string): string | null {
  return cluster === "mainnet" ? "https://api.mainnet-beta.solana.com" : cluster === "devnet" ? "https://api.devnet.solana.com" : cluster === "testnet" ? "https://api.testnet.solana.com" : null;
}
/** Whether every call in a JSON-RPC body may move to the fallback (none of NO_FALLBACK). */
export function fallbackEligible(body: unknown): boolean {
  let parsed: unknown = body;
  if (typeof body === "string") { try { parsed = JSON.parse(body); } catch { return false; } }
  const arr = Array.isArray(parsed) ? parsed : [parsed];
  return arr.length > 0 && arr.every((c) => { const m = c && typeof c === "object" ? String((c as { method?: unknown }).method ?? "") : ""; return !!m && (!NO_FALLBACK.has(m) || (describeFallback && DESCRIBE_METHODS.has(m))); });
}
/** True when `e` is the keyed plan's day budget being spent (not a busy rate bucket, not another source). */
/**
 * A budget hold or busy bucket, also when a library rethrew it wrapped (web3.js turns a failed getLatestBlockhash or getBalance into a
 * plain Error("failed to get recent blockhash: …") carrying our message): the error, its cause chain, or our message text.
 */
export function isBudgetHold(e: unknown): boolean {
  for (let x: unknown = e, i = 0; x && i < 5; x = (x as { cause?: unknown }).cause, i++) {
    if (x instanceof BudgetHoldError) return true;
    if (/today's request budget is spent|the request rate budget is full/.test(String((x as { message?: unknown }).message ?? ""))) return true;
  }
  return false;
}
export const isHeliusHold = (e: unknown): boolean => e instanceof BudgetHoldError && e.source === "helius" && e.outcome.state === "hold";

let fallbackNotedDay = "";
/**
 * HOLD FALLBACK (owner 2026-10-15, after a spent slice left the keeper blind and a restart crash-looped on the startup genesis read): a
 * JSON-RPC call the keyed plan's day budget refuses is sent to the cluster's public RPC instead, counted against "solana-public" (its own
 * rate buckets: slower reads, never blindness). A send never reaches the hold (sends are essential), so only reads move. Logged once a day.
 */
export type FallbackUrl = string | null | undefined | (() => string | null | undefined);
async function takeRpcOrFallback(url: string, body: unknown, fallback: FallbackUrl, lane?: BudgetLane): Promise<string> {
  try { await takeRpc(url, body, undefined, { lane }); return url; }
  catch (e) {
    const fallbackUrl = typeof fallback === "function" ? fallback() : fallback;
    if (!fallbackUrl || fallbackUrl === url || !isHeliusHold(e) || !fallbackEligible(body)) throw e;
    const day = new Date().toISOString().slice(0, 10);
    if (fallbackNotedDay !== day) { fallbackNotedDay = day; apiBudget().note(`  [api-budget] helius on hold: reads go to the public RPC (${new URL(fallbackUrl).hostname}, its own budget) until 00:00 UTC`); }
    await takeRpc(fallbackUrl, body, "solana-public");   // by role, not by host: a private fallback URL is not the keyed plan
    return fallbackUrl;
  }
}

type AnyFetch = (input: never, init?: never) => Promise<unknown>;
const urlOf = (input: unknown): string => typeof input === "string" ? input : input && typeof input === "object" && "url" in input ? String((input as { url: unknown }).url) : String(input);
/**
 * Wraps a fetch so every call takes from the budget first. `source`: a fixed id, "rpc" (a Solana JSON-RPC endpoint: credits by
 * method), or omitted (by the URL's host).
 */
export function budgetedFetch<F extends AnyFetch>(inner: F, source?: string | "rpc", o: { fallbackUrl?: FallbackUrl; lane?: BudgetLane } = {}): F {
  const wrapped = async (input: unknown, init?: { body?: unknown }) => {
    const url = urlOf(input);
    const id = source === "rpc" ? "rpc" : source ?? sourceForUrl(url);
    let target: unknown = input;
    if (id === "rpc" || ((id === "helius" || id === "solana-public") && init?.body !== undefined)) {
      const used = await takeRpcOrFallback(url, init?.body, id === "rpc" ? o.fallbackUrl : undefined, o.lane);
      if (used !== url) target = used;
    } else await takeOrThrow(id);
    return (inner as unknown as (i: unknown, n?: unknown) => Promise<unknown>)(target, init);
  };
  return wrapped as unknown as F;
}
/**
 * A @solana/web3.js ConnectionConfig whose every request goes through the budget (credits by method). `fallbackUrl` (the keeper:
 * publicRpcFor(cluster)): while the keyed plan's day budget is spent, reads go there instead of failing. `lane` (C2): the site's
 * launch verifier passes "confirm".
 */
export function budgetedRpcConfig<const C extends object>(base: C, o: { fallbackUrl?: FallbackUrl; lane?: BudgetLane } = {}): C & { fetch: typeof fetch } {
  return { ...base, fetch: budgetedFetch(((i: Parameters<typeof fetch>[0], n?: Parameters<typeof fetch>[1]) => fetch(i, n)) as typeof fetch, "rpc", o) };
}

/**
 * The hold fallback is used only when its genesis is the KEYED RPC's genesis (2026-10-15 review item 1: a fallback named for the env's
 * cluster could point at another chain). One getGenesisHash on `url` (counted against solana-public). Returns `url`, or null (logged).
 */
export async function verifyRpcFallback(url: string, keyedGenesis: string, o: { log: (s: string) => void; fetchImpl?: typeof fetch }): Promise<string | null> {
  const host = (() => { try { return new URL(url).hostname; } catch { return "an unparseable URL"; } })();
  try {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getGenesisHash" });
    await takeRpc(url, body, "solana-public");
    const r = await (o.fetchImpl ?? fetch)(url, { method: "POST", headers: { "content-type": "application/json" }, body, signal: AbortSignal.timeout(10_000) });
    const j = (await r.json()) as { result?: unknown };
    if (typeof j.result !== "string") { o.log(`  [api-budget] hold fallback ${host} refused: no genesis hash in its answer; a held day's reads wait instead`); return null; }
    if (j.result !== keyedGenesis) { o.log(`  [api-budget] hold fallback ${host} refused: its genesis ${j.result.slice(0, 8)}… is not the keyed RPC's ${keyedGenesis.slice(0, 8)}… (another cluster)`); return null; }
    return url;
  } catch (e) { o.log(`  [api-budget] hold fallback ${host} not verified (${(e as Error).message.slice(0, 120)}); a held day's reads wait instead`); return null; }
}

/**
 * Runs a startup step that reads the RPC, waiting out a budget hold or a busy bucket instead of crashing (2026-10-15: a restart while
 * the slice was spent threw BudgetHoldError from the genesis read and systemd restarted the keeper every 30 s until midnight UTC). Any
 * other error is thrown. `stop()` true ends the wait (SIGTERM) with the last hold error.
 */
export async function retryThroughBudgetHold<T>(step: () => Promise<T>, o: { log: (s: string) => void; sleep?: (ms: number) => Promise<void>; everyMs?: number; stop?: () => boolean; what?: string }): Promise<T> {
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let logged = false;
  for (;;) {
    try { return await step(); }
    catch (e) {
      if (!(e instanceof BudgetHoldError) || o.stop?.()) throw e;
      if (!logged) { o.log(`  [api-budget] ${o.what ?? "startup"} waits: ${e.message}; retrying every ${Math.round((o.everyMs ?? 60_000) / 1000)} s`); logged = true; }
      await sleep(o.everyMs ?? 60_000);
    }
  }
}
