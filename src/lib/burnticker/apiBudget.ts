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
  { id: "polymarket-gamma", label: "Polymarket Gamma", limit: { perSec: 30 }, established: true, unit: "request", shares: { keeper: 0.6, web: 0.4 } },
  // 2026-10-14: the house limit (0.5/s) refused a launch preflight — one payout read is three eth_calls in a row, and the web lane had
  // one call every 8 s. No public node publishes a limit; 4/s, 60/min, 2,000/day stays polite and lets a preflight run at once.
  { id: "polygon-rpc", label: "Polygon public RPC", limit: { perSec: 4, perMin: 60, perDay: 2_000 }, established: false, unit: "request", shares: { keeper: 0.5, web: 0.5 } },
  { id: "kalshi", label: "Kalshi API", limit: { perSec: 20 }, established: true, unit: "request", shares: { keeper: 0.6, web: 0.4 } },
  { id: "pyth-hermes", label: "Pyth Hermes", limit: { perSec: 1 }, established: true, unit: "request", shares: { keeper: 0.6, web: 0.4 } },
  { id: "irys", label: "Irys uploads", limit: HOUSE, established: false, unit: "request", shares: { keeper: 0.5, web: 0.5 } },
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
  [/(^|\.)espn\.com$/, "espn"], [/^gamma-api\.polymarket\.com$/, "polymarket-gamma"],
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
const ESSENTIAL = new Set(["sendTransaction", "getSignatureStatuses", "getBlockHeight"]);
export function rpcCallsOf(body: unknown): { calls: number; credits: number; essential: boolean; sends: number } {
  let parsed: unknown = body;
  if (typeof body === "string") { try { parsed = JSON.parse(body); } catch { return { calls: 1, credits: 1, essential: false, sends: 0 }; } }
  const arr = Array.isArray(parsed) ? parsed : [parsed];
  let credits = 0, sends = 0, essential = arr.length > 0;
  for (const c of arr) {
    const m = c && typeof c === "object" ? String((c as { method?: unknown }).method ?? "") : "";
    credits += TEN_CREDITS.has(m) ? 10 : 1;
    if (!ESSENTIAL.has(m)) essential = false;
    if (m === "sendTransaction") sends++;
  }
  return { calls: Math.max(1, arr.length), credits: Math.max(1, credits), essential, sends };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The persistent day count
// ---------------------------------------------------------------------------------------------------------------------------------

/** Where the day counts live. `add` adds `delta` to `key`'s count for `day` (starting from 0 on a new day) and returns the total. */
export interface BudgetStore {
  add(key: string, day: string, delta: number, now: number): number;
  get(key: string): string | null;
  set(key: string, value: string, now: number): void;
}
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
interface SourceState { buckets: Bucket[]; day: string; stored: number; pending: number; lastFlush: number; alerted80: boolean; held: boolean }

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

  constructor(o: ApiBudgetOpts) {
    this.role = o.role; this.enforce = o.enforce ?? true; this.store = o.store ?? null; this.now = o.now ?? (() => Date.now());
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))); this.maxWait = o.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
    this.log = o.log ?? (() => undefined); this.alert = o.alert ?? null; this.flushUnits = o.flushUnits ?? 20; this.flushMs = o.flushMs ?? 5_000;
  }

  /** The status-table key of a source's day count for this process's role. */
  dayKey(source: string): string { return `apiBudget.day.${this.role}.${source}`; }
  private holdKey(source: string): string { return `apiBudget.hold.${this.role}.${source}`; }

  private state(source: string): SourceState {
    const now = this.now(), day = utcDay(now);
    let s = this.states.get(source);
    if (!s) {
      const b = budgetFor(specOf(source), this.role);
      const buckets = b.rates.map((r) => { const cap = Math.max(1, r.perMs * Math.min(r.windowMs, BURST_WINDOW_MS)); return { ratePerMs: r.perMs, cap, tokens: cap, last: now }; });
      let stored = 0;
      if (this.store) { try { stored = this.store.add(this.dayKey(source), day, 0, now); } catch { stored = 0; } }
      s = { buckets, day, stored, pending: 0, lastFlush: now, alerted80: false, held: false };
      this.states.set(source, s);
    }
    if (s.day !== day) {   // a new UTC day: what was pending belongs to the old day; the new day starts from the store (another process may have counted)
      this.flushOne(source, s);
      s.day = day; s.pending = 0; s.alerted80 = false; s.held = false;
      if (this.store) { try { s.stored = this.store.add(this.dayKey(source), day, 0, now); } catch { s.stored = 0; } } else s.stored = 0;
    }
    return s;
  }
  private flushOne(source: string, s: SourceState): void {
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
  async take(source: string, o: { units?: number; requests?: number; essential?: boolean } = {}): Promise<TakeOutcome> {
    const units = Math.max(0, o.units ?? 1), requests = Math.max(1, o.requests ?? 1);
    const s = this.state(source), budget = this.dayBudget(source);
    const used = s.stored + s.pending;
    if (this.enforce && !o.essential && used + units > budget) { this.onHold(source, s, used, budget); return { state: "hold", used, budget }; }
    let wait = 0;
    if (this.enforce) {
      const now = this.now();
      for (const b of s.buckets) { b.tokens = Math.min(b.cap, b.tokens + (now - b.last) * b.ratePerMs); b.last = now; }
      for (const b of s.buckets) wait = Math.max(wait, b.tokens >= requests ? 0 : (requests - b.tokens) / b.ratePerMs);
      if (wait > this.maxWait) return { state: "busy", waitMs: Math.ceil(wait) };
      for (const b of s.buckets) b.tokens -= requests;   // reserve now (may go negative): concurrent callers queue behind it
    }
    s.pending += units;
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
    if (!seen) this.log(`  [api-budget] ${source} ON HOLD until 00:00 UTC: ${fmt(used)} of ${fmt(budget)} ${spec.unit === "credit" ? "credits" : "requests"} used today (${this.role}); its reads are skipped until then`);
    if (!this.enforce) return;
    this.emit({ level: "hold", key: `bt-api-budget:${this.role}:${source}:${s.day}:hold`, meta: { role: this.role, source, day: s.day, used, budget, unit: spec.unit },
      text: `${who} used all of today's budget for ${spec.label} (${fmt(used)} of ${fmt(budget)} ${spec.unit === "credit" ? "credits" : "requests"}), so it stopped reading from it until midnight UTC. Reads start again on their own after that. Nothing is retried in the meantime.` });
  }
  private emit(a: Omit<BudgetAlert, "kind">): void { try { this.alert?.({ kind: "bt-api-budget", ...a }); } catch { /* an alert never stops a read */ } }

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

/** Takes from the process's budget; throws BudgetHoldError on "hold" or "busy" (the caller's read fails like any network error). */
export async function takeOrThrow(source: string, o: { units?: number; requests?: number; essential?: boolean } = {}): Promise<void> {
  const r = await apiBudget().take(source, o);
  if (r.state !== "ok") throw new BudgetHoldError(source, r);
}
/** A JSON-RPC POST's take: Helius counts credits by method, the buckets count calls; send/confirm calls are essential. */
export async function takeRpc(url: string, body: unknown): Promise<void> {
  const source = rpcSourceFor(url), c = rpcCallsOf(body);
  // Helius states a separate, lower rate for sends (5 a second on the Developer plan): a body with a send also takes from that bucket
  if (source === "helius" && c.sends) await takeOrThrow("helius-send", { requests: c.sends, essential: true });
  await takeOrThrow(source, { units: source === "helius" ? c.credits : c.calls, requests: c.calls, essential: c.essential });
}

type AnyFetch = (input: never, init?: never) => Promise<unknown>;
const urlOf = (input: unknown): string => typeof input === "string" ? input : input && typeof input === "object" && "url" in input ? String((input as { url: unknown }).url) : String(input);
/**
 * Wraps a fetch so every call takes from the budget first. `source`: a fixed id, "rpc" (a Solana JSON-RPC endpoint: credits by
 * method), or omitted (by the URL's host).
 */
export function budgetedFetch<F extends AnyFetch>(inner: F, source?: string | "rpc"): F {
  const wrapped = async (input: unknown, init?: { body?: unknown }) => {
    const url = urlOf(input);
    const id = source === "rpc" ? "rpc" : source ?? sourceForUrl(url);
    if (id === "rpc" || ((id === "helius" || id === "solana-public") && init?.body !== undefined)) await takeRpc(url, init?.body);
    else await takeOrThrow(id);
    return (inner as unknown as (i: unknown, n?: unknown) => Promise<unknown>)(input, init);
  };
  return wrapped as unknown as F;
}
/** A @solana/web3.js ConnectionConfig whose every request goes through the budget (credits by method). */
export function budgetedRpcConfig<const C extends object>(base: C): C & { fetch: typeof fetch } {
  return { ...base, fetch: budgetedFetch(((i: Parameters<typeof fetch>[0], n?: Parameters<typeof fetch>[1]) => fetch(i, n)) as typeof fetch, "rpc") };
}
