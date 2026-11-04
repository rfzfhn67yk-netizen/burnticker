import { highSpecProblems, highStatement, type HighSpec } from "@/lib/burnticker/derby/high";

/**
 * BURN DERBY — THE SELECTOR (owner-approved 2026-10-10: "build it all"). A derby is a rivalry pair whose selector is the RELATIVE
 * PERFORMANCE OF TWO EXISTING COINS over a window: "every UTC day WIF out-gains SHIB". Side A's coin burns on a window A wins, side B's
 * on a window B wins (the owner chose the winning side; nothing is paid to anyone); a tie burns neither and still posts a receipt (a void). A one-shot
 * "flippening" variant reads size (circulating supply × the feed) and settles once: the first window A is bigger than B (side A burns),
 * or the season ending without that (side B burns). A tournament ("Bracket") runs one derby per match per round over 8 or 16 coins.
 *
 * This file is PURE and browser-safe (no node imports): the rule's `derby` block, its validation, the series id (hashing is injected
 * so the wizard can import the rest), the windows and the plain sentences. The keeper's reads live in derby/{pyth,pools,cross,measure,
 * adapter}.ts; the registry side in derby/store.ts; tournaments in derby/bracket.ts.
 */

export type DerbyWindow = "daily" | "weekly";
/** pct = % change of the coin's USD value over the window; mcap = % change of circulating supply × that value (needs a Solana mint). */
export type DerbyMeasure = "pct" | "mcap";

/**
 * One underlying coin. The value source is Pyth when `pyth` names a feed (primary), else the TWAP of `pool` (the coin's deepest SOL
 * pool, read from its vault balances by the keeper across the window; SOL→USD from Pyth SOL/USD). `cross` names the independent
 * cross-read: "jup:<mint>" (Jupiter's price API) or "dexscreener:<chainId>:<token address>". All of it is locked in the rule.
 */
export interface DerbyUnderlying {
  /** Display symbol, A–Z 0–9, 1–12 characters ("WIF", "SHIB"). The feed id / mint is the identity; the symbol is the label. */
  symbol: string;
  /** Pyth price-feed id, 64 lowercase hex (no 0x), or null. */
  pyth: string | null;
  /** The coin's Solana mint, or null (an EVM-native coin read through Pyth only). Required for the mcap measure. */
  mint: string | null;
  /** The coin's deepest SOL pool (Raydium CPMM or PumpSwap) — required when `pyth` is null (the TWAP fallback). */
  pool: string | null;
  /** The cross-read: "jup:<mint>", "dexscreener:<chainId>:<address>" or "redstone:<data feed id>" (equities, FX, metals, commodities). */
  cross: string;
  /**
   * RedStone's data feed id when RedStone may be the PRIMARY (coordinator follow-up, 2026-10-10): used only when Pyth cannot be read (no
   * sponsored Solana account and no Hermes key) and there is no pool for the TWAP — the SHIB case. Optional: absent keeps an underlying's
   * canonical bytes unchanged. The cross-read must then be another operator (DexScreener / Jupiter).
   */
  redstone?: string | null;
}

export interface CoinVsSpec {
  selector: "coinvs";
  a: DerbyUnderlying;
  b: DerbyUnderlying;
  window: DerbyWindow;
  measure: DerbyMeasure;
  /** The season: windows that start on or after `start` (YYYY-MM-DD, 00:00 UTC) and end by start + days count. */
  season: { start: string; days: number };
  /** One-shot flippening (measure must be mcap): yes on the first window A's size > B's, no at the season's end without it. */
  flip: boolean;
}

export interface BracketSpec {
  selector: "bracket";
  tournamentId: string;
  /** sha256 of the tournament's canonical JSON (derby/bracket.ts) — the bracket is locked by hash in every fan coin's rule. */
  tournamentSha: string;
  /** The coin's seed slot (0-based; bracket order: slot 2k meets 2k+1 in round one). */
  slot: number;
  underlying: DerbyUnderlying;
}

/**
 * A SINGLE ASSET (2026-10-10, the coverage audit's Financial-markets primaries): one Pyth feed — a coin, a stock or fund, an FX rate, a
 * metal, a commodity — and its % change over each window, counted in units of `unitPct` percentage points in one direction. A scalar
 * rule (value = the window's % change, fixed baseline 0); a pair inverts the direction (side A counts rises, side B falls).
 * Market-hours feeds (anything but crypto) read the last published value at each boundary, so a closed market is a 0% window.
 */
export interface PriceSpec {
  selector: "price";
  u: DerbyUnderlying;
  window: DerbyWindow;
  season: { start: string; days: number };
}

/** RECORD DAILY CLOSES (sources-4, 2026-10-12; derby/high.ts): one reference coin's daily close against its record. */
export type DerbySpec = CoinVsSpec | BracketSpec | PriceSpec | HighSpec;
export type { HighSpec };

/**
 * Pyth's US index feeds (Equity.Index.US500 / US30 / US100) are excluded unless BURNTICKER_INDEX_PROXIES_ENABLED=1 — index-licence caution:
 * the index names are trademarks licensed for financial products; fund tickers (SPY, QQQ, DIA) are funds and stay in.
 */
export const INDEX_PROXY_SYMBOLS = ["Equity.Index.US500/USD", "Equity.Index.US30/USD", "Equity.Index.US100/USD"] as const;
export const INDEX_PROXIES_FLAG = "BURNTICKER_INDEX_PROXIES_ENABLED";
export const indexProxiesEnabled = (env: Readonly<Record<string, string | undefined>> = typeof process !== "undefined" ? process.env : {}): boolean => ["1", "true", "on", "yes"].includes((env[INDEX_PROXIES_FLAG] ?? "").trim().toLowerCase());

export const DERBY_SEASON_DAYS = { min: 1, max: 366, default: 30 } as const;
export const DERBY_ROUND_DAYS = { min: 1, max: 30, default: 7 } as const;
export const DERBY_BRACKET_SIZES = [8, 16] as const;
/** Cross-read disagreement on the winner-determining metric above this (percentage points) withholds the reading: no reading, no burn. */
export const DERBY_DISAGREEMENT_PP = 2;
/** A Pyth update must be published at or after the boundary and within this many seconds of it. */
export const DERBY_BOUNDARY_TOLERANCE_SEC = 60;
/** A Pyth update whose confidence interval exceeds this share of the value is not used (withheld). */
export const DERBY_MAX_CONF_RATIO = 0.02;
/** A pool / Jupiter / DexScreener read used for a boundary must be within this many seconds of it. */
export const DERBY_SNAPSHOT_TOLERANCE_SEC = 15 * 60;
/** Underlyings without a Pyth feed need at least this much pool liquidity (USD) at launch. */
export const DERBY_MIN_LIQUIDITY_USD = 250_000;

const SYMBOL_RE = /^[A-Z0-9]{1,12}$/;
export const PYTH_ID_RE = /^[0-9a-f]{64}$/;
const PUBKEY_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const CROSS_RE = /^(jup:[1-9A-HJ-NP-Za-km-z]{32,44}|dexscreener:[a-z0-9-]{2,24}:[A-Za-z0-9]{20,64}|redstone:[A-Za-z0-9._-]{1,40})$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const TOURNAMENT_ID_RE = /^[a-z0-9][a-z0-9-]{2,31}$/;

/** coinvs:<A>-<B>:<daily|weekly>:<pct|mcap>[-flip]:<10 hex> · bracket:<tournament id>:<slot> · price:<SYM>:<daily|weekly>:<10 hex> ·
 *  high:<SYM>:<all|30d|90d>[-once]:<10 hex> (sources-4: the hash covers the whole block, baseline included, so each coin has its own stream). */
export const DERBY_SERIES_RE = /^(coinvs:[A-Z0-9]{1,12}-[A-Z0-9]{1,12}:(daily|weekly):(pct|mcap)(-flip)?:[0-9a-f]{10}|bracket:[a-z0-9][a-z0-9-]{2,31}:\d{1,2}|price:[A-Z0-9]{1,12}:(daily|weekly):[0-9a-f]{10}|high:[A-Z0-9]{1,12}:(all|30d|90d)(-once)?:[0-9a-f]{10})$/;
export const isDerbySeries = (s: string): boolean => DERBY_SERIES_RE.test(s);

/** Keys sorted at every level (the same canonical form as rules.json, without the trailing newline). */
export function canonical(v: unknown): string {
  const sort = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(sort);
    if (x && typeof x === "object") return Object.fromEntries(Object.keys(x as object).sort().map((k) => [k, sort((x as Record<string, unknown>)[k])]));
    return x;
  };
  return JSON.stringify(sort(v));
}

/** The stable identity of an underlying (what readings and samples are keyed by): its Pyth feed, else its pool. */
export const underlyingKey = (u: DerbyUnderlying): string => (u.pyth ? `pyth:${u.pyth}` : u.pool ? `pool:${u.pool}` : `redstone:${u.redstone}`);

/**
 * EVERY NAME AN UNDERLYING ANSWERS TO (semantics-verify item 74, 2026-10-12): its Pyth feed, its mint, its pool, its RedStone feed and the
 * token its cross-read reads ("jup:<mint>" and a Solana DexScreener address name the mint; an EVM address is compared without case).
 * Two sides that share any of these are the same coin under two aliases, so a derby of them is refused: underlyingKey alone let a coin
 * read through Pyth on one side and through RedStone or a pool on the other race against itself.
 */
export function underlyingAliases(u: Partial<DerbyUnderlying>): Set<string> {
  const out = new Set<string>();
  if (u.pyth) out.add(`pyth:${u.pyth}`);
  if (u.mint) out.add(`token:solana:${u.mint}`);
  if (u.pool) out.add(`pool:${u.pool}`);
  if (u.redstone) out.add(`redstone:${u.redstone.toUpperCase()}`);
  if (typeof u.cross === "string") {
    const j = /^jup:(.+)$/.exec(u.cross), d = /^dexscreener:([a-z0-9-]+):(.+)$/.exec(u.cross), r = /^redstone:(.+)$/.exec(u.cross);
    if (j) out.add(`token:solana:${j[1]}`);
    else if (d) out.add(`token:${d[1]}:${/^0x/i.test(d[2]) ? d[2].toLowerCase() : d[2]}`);
    else if (r) out.add(`redstone:${r[1].toUpperCase()}`);
  }
  return out;
}
export const sameUnderlying = (a: Partial<DerbyUnderlying>, b: Partial<DerbyUnderlying>): boolean => { const x = underlyingAliases(a); return [...underlyingAliases(b)].some((k) => x.has(k)); };

function underlyingProblems(u: unknown, label: string, p: string[]): void {
  const x = u as Partial<DerbyUnderlying> | null;
  if (!x || typeof x !== "object") { p.push(`derby.${label} must be an underlying { symbol, pyth, mint, pool, cross }`); return; }
  if (typeof x.symbol !== "string" || !SYMBOL_RE.test(x.symbol)) p.push(`derby.${label}.symbol must be 1–12 of A–Z, 0–9`);
  if (x.pyth !== null && (typeof x.pyth !== "string" || !PYTH_ID_RE.test(x.pyth))) p.push(`derby.${label}.pyth must be a Pyth feed id (64 lowercase hex) or null`);
  if (x.mint !== null && (typeof x.mint !== "string" || !PUBKEY_RE.test(x.mint))) p.push(`derby.${label}.mint must be a Solana mint or null`);
  if (x.pool !== null && (typeof x.pool !== "string" || !PUBKEY_RE.test(x.pool))) p.push(`derby.${label}.pool must be a Solana pool address or null`);
  const rs = x.redstone ?? null;
  if (rs !== null && (typeof rs !== "string" || !/^[A-Za-z0-9._-]{1,40}$/.test(rs))) p.push(`derby.${label}.redstone must be a RedStone data feed id or absent`);
  if (x.pyth === null && !x.pool && !rs) p.push(`derby.${label}: without a Pyth feed the coin needs its deepest SOL pool (the TWAP fallback) or a RedStone feed`);
  if (rs && typeof x.cross === "string" && x.cross.startsWith("redstone:")) p.push(`derby.${label}: with RedStone as a primary, the cross-read must be another operator (DexScreener or Jupiter)`);
  if (typeof x.cross === "string" && x.cross.startsWith("redstone:") && !x.pyth) p.push(`derby.${label}: a RedStone cross-read checks a Pyth feed (no pool coin uses it)`);
  if (x.pyth === null && x.pool && !x.mint) p.push(`derby.${label}: the TWAP fallback needs the coin's mint (to orient the pool)`);
  if (typeof x.cross !== "string" || !CROSS_RE.test(x.cross)) p.push(`derby.${label}.cross must be "jup:<mint>" or "dexscreener:<chainId>:<address>" (the independent cross-read)`);
  for (const k of Object.keys(x)) if (!["symbol", "pyth", "mint", "pool", "cross", "redstone"].includes(k)) p.push(`derby.${label}.${k} is not a known key`);
}

const validDate = (s: unknown): s is string => typeof s === "string" && DATE_RE.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

/** Every problem with a derby block (empty = valid). Pure; the series/hash agreement is checked by `derbySeriesProblems`. */
export function derbySpecProblems(raw: unknown): string[] {
  const p: string[] = [];
  const d = raw as (Partial<Omit<CoinVsSpec, "selector">> & Partial<Omit<BracketSpec, "selector">> & { selector?: string }) | null;
  if (!d || typeof d !== "object" || Array.isArray(d)) return ["derby must be an object"];
  if (d.selector === "coinvs") {
    underlyingProblems(d.a, "a", p); underlyingProblems(d.b, "b", p);
    if (d.a && d.b && typeof d.a === "object" && typeof d.b === "object") {
      if (underlyingKey(d.a as DerbyUnderlying) === underlyingKey(d.b as DerbyUnderlying) || sameUnderlying(d.a, d.b)) p.push("derby: the two coins must be distinct");
      if (d.a.symbol === d.b.symbol) p.push("derby: the two coins need different symbols");
    }
    if (d.window !== "daily" && d.window !== "weekly") p.push('derby.window must be "daily" or "weekly"');
    if (d.measure !== "pct" && d.measure !== "mcap") p.push('derby.measure must be "pct" or "mcap"');
    if (d.measure === "mcap" && d.a && d.b && (!(d.a as DerbyUnderlying).mint || !(d.b as DerbyUnderlying).mint)) p.push("derby: the mcap measure reads circulating supply from each coin's Solana mint — both coins need a mint");
    const s = d.season as CoinVsSpec["season"] | undefined;
    if (!s || typeof s !== "object") p.push("derby.season { start, days } required");
    else {
      if (!validDate(s.start)) p.push("derby.season.start must be a YYYY-MM-DD date (00:00 UTC)");
      if (!Number.isInteger(s.days) || s.days < DERBY_SEASON_DAYS.min || s.days > DERBY_SEASON_DAYS.max) p.push(`derby.season.days must be a whole number ${DERBY_SEASON_DAYS.min}–${DERBY_SEASON_DAYS.max}`);
      if (d.window === "weekly" && Number.isInteger(s.days) && s.days % 7 !== 0) p.push("derby: a weekly season is a whole number of weeks (days a multiple of 7)");
      if (d.window === "weekly" && validDate(s.start) && new Date(`${s.start}T00:00:00Z`).getUTCDay() !== 1) p.push("derby: a weekly season starts on a Monday (windows run from Monday 00:00 to Monday 00:00 UTC)");
      for (const k of Object.keys(s)) if (k !== "start" && k !== "days") p.push(`derby.season.${k} is not a known key`);
    }
    if (typeof d.flip !== "boolean") p.push("derby.flip must be true or false");
    if (d.flip === true && d.measure !== "mcap") p.push("derby: a flippening compares size, so it needs the mcap measure");
    for (const k of Object.keys(d)) if (!["selector", "a", "b", "window", "measure", "season", "flip"].includes(k)) p.push(`derby.${k} is not a known key`);
  } else if (d.selector === "price") {
    const x = d as unknown as Partial<PriceSpec>;
    underlyingProblems(x.u, "u", p);
    if (x.u && typeof x.u === "object" && !x.u.pyth) p.push("derby.u: a single-asset rule reads a Pyth feed");
    if (x.window !== "daily" && x.window !== "weekly") p.push('derby.window must be "daily" or "weekly"');
    seasonProblems(x.season, x.window, p);
    for (const k of Object.keys(x)) if (!["selector", "u", "window", "season"].includes(k)) p.push(`derby.${k} is not a known key`);
  } else if (d.selector === "high") {
    const x = d as unknown as Partial<HighSpec>;
    underlyingProblems(x.u, "u", p);
    highSpecProblems(x, p);
    for (const k of Object.keys(x)) if (!["selector", "u", "span", "once", "season", "baseline"].includes(k)) p.push(`derby.${k} is not a known key`);
  } else if (d.selector === "bracket") {
    if (typeof d.tournamentId !== "string" || !TOURNAMENT_ID_RE.test(d.tournamentId)) p.push("derby.tournamentId must be 3–32 lowercase letters/digits/dashes");
    if (typeof d.tournamentSha !== "string" || !/^[0-9a-f]{64}$/.test(d.tournamentSha)) p.push("derby.tournamentSha must be a sha256 (64 lowercase hex)");
    if (!Number.isInteger(d.slot) || (d.slot as number) < 0 || (d.slot as number) > 15) p.push("derby.slot must be a seed slot 0–15");
    underlyingProblems(d.underlying, "underlying", p);
    for (const k of Object.keys(d)) if (!["selector", "tournamentId", "tournamentSha", "slot", "underlying"].includes(k)) p.push(`derby.${k} is not a known key`);
  } else p.push('derby.selector must be "coinvs", "price", "high" or "bracket"');
  return p;
}

function seasonProblems(s: { start?: unknown; days?: unknown } | undefined, window: unknown, p: string[]): void {
  if (!s || typeof s !== "object") { p.push("derby.season { start, days } required"); return; }
  if (!validDate(s.start)) p.push("derby.season.start must be a YYYY-MM-DD date (00:00 UTC)");
  if (!Number.isInteger(s.days) || (s.days as number) < DERBY_SEASON_DAYS.min || (s.days as number) > DERBY_SEASON_DAYS.max) p.push(`derby.season.days must be a whole number ${DERBY_SEASON_DAYS.min}–${DERBY_SEASON_DAYS.max}`);
  if (window === "weekly" && Number.isInteger(s.days) && (s.days as number) % 7 !== 0) p.push("derby: a weekly season is a whole number of weeks (days a multiple of 7)");
  if (window === "weekly" && validDate(s.start) && new Date(`${s.start}T00:00:00Z`).getUTCDay() !== 1) p.push("derby: a weekly season starts on a Monday (windows run from Monday 00:00 to Monday 00:00 UTC)");
  for (const k of Object.keys(s)) if (k !== "start" && k !== "days") p.push(`derby.season.${k} is not a known key`);
}

/** What the coinvs series hash covers: the two coins, window, measure, flip — and the season only for a flippening (a one-shot). */
export const coinvsHashInput = (d: CoinVsSpec): string => canonical({ a: d.a, b: d.b, window: d.window, measure: d.measure, flip: d.flip, season: d.flip ? d.season : null });

/** The rule's `series` for a derby block (sha256Hex: the keeper's rulesSha256, or any sha256 → hex). */
export function derbySeriesId(d: DerbySpec, sha256Hex: (s: string) => string): string {
  if (d.selector === "bracket") return `bracket:${d.tournamentId}:${d.slot}`;
  if (d.selector === "price") return `price:${d.u.symbol}:${d.window}:${sha256Hex(canonical({ u: d.u, window: d.window })).slice(0, 10)}`;
  if (d.selector === "high") return `high:${d.u.symbol}:${d.span === "all" ? "all" : `${d.span}d`}${d.once ? "-once" : ""}:${sha256Hex(canonical(d)).slice(0, 10)}`;
  return `coinvs:${d.a.symbol}-${d.b.symbol}:${d.window}:${d.measure}${d.flip ? "-flip" : ""}:${sha256Hex(coinvsHashInput(d)).slice(0, 10)}`;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Windows (UTC)
// ---------------------------------------------------------------------------------------------------------------------------------

const DAY_MS = 86_400_000;
export const dayMs = (date: string): number => Date.parse(`${date}T00:00:00Z`);
export const isoDate = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
export const addDays = (date: string, n: number): string => isoDate(dayMs(date) + n * DAY_MS);

/** One window: [startMs, endMs). `id` = its first UTC date ("2026-10-11"; a weekly window is named by its Monday). */
export interface DerbyWindowSpan { id: string; startMs: number; endMs: number }

export function windowSpan(window: DerbyWindow, id: string): DerbyWindowSpan {
  const startMs = dayMs(id);
  return { id, startMs, endMs: startMs + (window === "weekly" ? 7 : 1) * DAY_MS };
}

/** The season's windows in order. */
export function seasonWindows(d: { window: DerbyWindow; season: { start: string; days: number } }): DerbyWindowSpan[] {
  const step = d.window === "weekly" ? 7 : 1;
  const out: DerbyWindowSpan[] = [];
  for (let i = 0; i + step <= d.season.days; i += step) out.push(windowSpan(d.window, addDays(d.season.start, i)));
  return out;
}

export const seasonEndMs = (d: { season: { start: string; days: number } }): number => dayMs(d.season.start) + d.season.days * DAY_MS;

/** A settled window's `at` (the registry reading's time): the window's last second, so the program reads it on the window's own UTC day. */
export const windowAt = (w: DerbyWindowSpan): string => `${new Date(w.endMs - 1000).toISOString().slice(0, 19)}Z`;

/** The next 00:00 UTC strictly after `ms` (the default season start: the first full window after launch). */
export const nextUtcMidnight = (ms: number): string => isoDate(Math.floor(ms / DAY_MS) * DAY_MS + DAY_MS);
/** The next Monday 00:00 UTC strictly after `ms`. */
export function nextUtcMonday(ms: number): string { let d = nextUtcMidnight(ms); while (new Date(`${d}T00:00:00Z`).getUTCDay() !== 1) d = addDays(d, 1); return d; }

// ---------------------------------------------------------------------------------------------------------------------------------
// Plain sentences (the wizard's review step, the token page). Lint-clean under config/launch/copy-lint.json: other coins' moves are
// named only as the rule's input ("WIF out-gains SHIB"); nothing is said about OUR coins except what their supply does.
// ---------------------------------------------------------------------------------------------------------------------------------

const pctText = (f: number): string => `${Math.round(f * 10_000) / 100}%`;
const sourceText = (u: DerbyUnderlying): string => (u.pyth ? "Pyth" : "pool TWAP");
const windowText = (w: DerbyWindow): string => (w === "daily" ? "every day" : "every week");
const boundary = (w: DerbyWindow): string => (w === "daily" ? "00:00 UTC" : "Monday 00:00 UTC");

/**
 * The review sentence, e.g. "$TEAMWIF burns 1% every day WIF out-gains SHIB (Pyth, 00:00 UTC). $TEAMSHIB burns when SHIB wins. Runs for 30 days, then winds down."
 * `tickerB` null = a single coin (side A only).
 */
export function derbySentence(d: CoinVsSpec, tickerA: string, tickerB: string | null, fraction: number): string {
  const src = d.a.pyth && d.b.pyth ? "Pyth" : `${sourceText(d.a)} and ${sourceText(d.b)}`;
  if (d.flip) {
    const a = `$${tickerA} burns ${pctText(fraction)} once, the first ${d.window === "daily" ? "day" : "week"} ${d.a.symbol}'s market cap passes ${d.b.symbol}'s (${src} × circulating supply, ${boundary(d.window)}).`;
    const b = tickerB ? ` $${tickerB} burns ${pctText(fraction)} once if the run ends without it.` : "";
    // HB-78 (hourly run 5): a flippening pair says its one end (FLIP_REST_LINE), the same words as the "At the end" block and the review
    return `${a}${b} ${derbyReadOnlySentence(d)} ${tickerB ? `Runs for ${d.season.days} days. ${FLIP_REST_LINE}` : `Runs for ${d.season.days} days, then winds down.`}`;
  }
  const by = d.measure === "mcap" ? " by market cap" : "";
  const verb = `${d.a.symbol} out-gains ${d.b.symbol}${by}`;
  // the owner, 2026-10-13: "the winner's coin burns" read as if the reference coins burn; every derby sentence names the NEW coin that
  // burns, says where the other new coin's share goes, and says the reference coins are only read
  const day = d.window === "daily" ? "day" : "week";
  const head = `$${tickerA} burns ${pctText(fraction)} ${windowText(d.window)} ${verb} (${src}, ${boundary(d.window)})`;
  const ab = tickerB ? `${head}, and $${tickerB}'s share for that ${day} goes to $${tickerA}'s burn. On a ${day} ${d.b.symbol} out-gains ${d.a.symbol}${by}, $${tickerB} burns and takes $${tickerA}'s share.` : `${head}.`;
  // "Runs for N days" (the owner, 2026-10-10: "in the coin vs coin it reads as seasons for the duration")
  // cheap-features item 15 (owner 2026-10-13): a two-coin daily race ends on its tally of winning days, so the end is said as a result
  return `${ab} ${derbyReadOnlySentence(d)} ${tickerB ? raceEndSentence(d.season.days, d.window === "weekly" ? "weeks" : "days") : `Runs for ${d.season.days} days, then winds down.`}`;
}

/**
 * HB-78 (hourly run 5): the flippening pair's one end. The coin whose rule fires is the pair's winner (coin A when its market cap passes,
 * coin B when the run ends without that); describe.ts's pair-winner end then sends the other coin's rest to the winner's burn and the
 * winner's own rest to $DEFICIT's burn. The burn step's sentence, the "At the end" block and the review's "When it ends" all say this.
 */
export const FLIP_REST_LINE = "The coin that burns is the winner. At the end, the rest of the other coin's pool, and any fees that arrive later, goes to the winner's burn, and whatever is left on the winner goes to $DEFICIT's burn. Then both coins retire.";
/** Cheap-features item 14: the run lengths the web launcher offers beside the share presets (the API takes any length up to 366 days). */
export const DERBY_RUN_PRESETS = [7, 14, 30] as const;
export const runPresetLabel = (days: number): string => `${days} days`;
/**
 * THE ONE END OF A TWO-COIN DAILY RACE (continuous audit HB-2, 2026-10-19: the burn step, its "At the end" block, the review's "When it
 * ends" and the server review's endsLine said the end four different ways). What the keeper does (derby/adapter.ts recordTally, then
 * endSinkKeeper's PAIR WINNER): once every window of the run is recorded, the coin with more winning windows burns its share once more;
 * the other coin's rest, and any fees that arrive later, go to the winner's burn while the two are linked, else to $DEFICIT's burn; the
 * winner burns down what is left on itself. Level on winning windows is a void reading: nothing moves and each coin burns down what is
 * left on itself over the wind-down. Every surface says the race's end with these sentences and no other.
 */
export interface RaceEnd { season: string; result: string; tie: string; line: string }
export function raceEnd(days: number, unit: "days" | "weeks" = "days", windDownDays = 28): RaceEnd {
  const over = windDownDays === 28 ? "over four weeks" : `over ${windDownDays} days`;
  const season = `Runs for ${days} days.`;
  const result = `When the run ends, the coin with more winning ${unit} burns its share once more. The other coin sends the rest of its pool, and any fees that arrive later, to that coin's burn while the two are linked, or to $DEFICIT's burn if they are not. The coin with more winning ${unit} burns down what is left on itself. Then the coin retires.`;
  const tie = `If both coins won the same number of ${unit}, nothing moves between them, and each coin burns down what is left on itself ${over}.`;
  return { season, result, tie, line: `${season} ${result} ${tie}` };
}
/** The race's end from its derby block (the run length and the window unit). */
export const raceEndOf = (d: Pick<CoinVsSpec, "season" | "window">, windDownDays = 28): RaceEnd => raceEnd(d.season.days, d.window === "weekly" ? "weeks" : "days", windDownDays);
/** Cheap-features item 15: a daily race's end, said as a result (raceEnd's whole line). */
export const raceEndSentence = (days: number, unit: "days" | "weeks" = "days"): string => raceEnd(days, unit).line;
/** The reference coins are inputs only (the owner, 2026-10-13). */
export const derbyReadOnlySentence = (d: Pick<CoinVsSpec, "a" | "b">): string => `${d.a.symbol} and ${d.b.symbol} are only read, never traded or burned.`;

/** The rule paragraph for the token page (rules.ts ruleStatement delegates here for oracle "derby"). */
export function derbyStatement(d: DerbySpec, side: "A" | "B" | null, pairId: string | null, scalar: { unit: number; direction: string } | null = null): string {
  const feed = (u: DerbyUnderlying) => (u.pyth ? `${u.symbol}/USD on Pyth (feed ${u.pyth.slice(0, 12)}…)` : `${u.symbol} from the time-weighted average of pool ${u.pool!.slice(0, 8)}… (its vault balances, turned from SOL into USD with Pyth)`);
  if (d.selector === "high") return highStatement(d);
  if (d.selector === "price") {
    const wnd = d.window === "daily" ? "UTC day (00:00 to 00:00)" : "UTC week (Monday 00:00 to Monday 00:00)";
    const dir = scalar?.direction === "down" ? "fall" : "rise";
    const pairText = pairId ? ` This coin is side ${side} of Burn Derby pair ${pairId}, and the other side counts the opposite direction.` : "";
    return `Every ${wnd}, the percentage change of ${feed(d.u)} is read. Every full ${scalar?.unit ?? "?"} percentage points of ${dir} is one unit.${pairText} A market that is closed at a boundary reads its last published value, so a closed day is a 0% window. The season runs ${d.season.days} days from ${d.season.start}. A cross-read from an independent operator that disagrees by more than ${DERBY_DISAGREEMENT_PP} points on the change withholds the window, so there is no reading and no burn.`;
  }
  if (d.selector === "bracket") {
    return `This is the fan coin of slot ${d.slot} (${d.underlying.symbol}) in Burn Derby bracket ${d.tournamentId}, whose sha256 starts with ${d.tournamentSha.slice(0, 12)}. Every UTC day, ${d.underlying.symbol} plays its current match. The side whose ${feed(d.underlying)} has the larger percentage change from 00:00 to 00:00 wins the day, and a win burns one unit (two in the final). A tie burns nothing. The side with more winning days wins the round and advances. If winning days are level, the larger compounded percentage change over the round decides, and then the lower slot. The loser's coin retires and reads nothing more. An independent cross-read that disagrees by more than ${DERBY_DISAGREEMENT_PP} points on the margin withholds the day, so there is no reading and no burn.`;
  }
  const measure = d.measure === "mcap" ? "percentage change in size (circulating supply read from the mint, times the feed value)" : "percentage change";
  const wnd = d.window === "daily" ? "UTC day (00:00 to 00:00)" : "UTC week (Monday 00:00 to Monday 00:00)";
  // the owner, 2026-10-13: name the new coin that burns, never "the winner's coin", and say the reference coins are only read
  const mine = side === "B" ? d.b.symbol : d.a.symbol, theirs = side === "B" ? d.a.symbol : d.b.symbol;
  const pairText = pairId ? (d.flip
    ? ` This coin is side ${side} of Burn Derby pair ${pairId}, one of two new coins. ${side === "B" ? `It burns once if the season ends without ${d.a.symbol} passing ${d.b.symbol}.` : `It burns once on the first window ${d.a.symbol} passes ${d.b.symbol}.`} ${derbyReadOnlySentence(d)}`
    : ` This coin is side ${side} of Burn Derby pair ${pairId}, one of two new coins. This coin burns on a window ${mine} wins. On a window ${theirs} wins, the other new coin burns, and this coin's share for that window goes to the other new coin's burn. ${derbyReadOnlySentence(d)}`) : "";
  const season = `The season runs ${d.season.days} days from ${d.season.start}. Windows after that read nothing.`;
  if (d.flip) return `This is a one-shot flippening. The first ${wnd} that ends with ${d.a.symbol}'s size above ${d.b.symbol}'s settles YES. Size is circulating supply times ${feed(d.a)} for ${d.a.symbol}, and times ${feed(d.b)} for ${d.b.symbol}. If the season ends without that, it settles NO.${pairText} ${season} After that, nothing more is read. A cross-read that disagrees by more than ${DERBY_DISAGREEMENT_PP}% on the comparison withholds the reading, so there is no reading and no burn.`;
  return `Every ${wnd}, ${d.a.symbol}'s ${measure} (${feed(d.a)}) is compared with ${d.b.symbol}'s (${feed(d.b)}). The larger one wins the window. A window ${d.a.symbol} wins settles YES, and a window ${d.b.symbol} wins settles NO. An exact tie is a void and burns nothing.${pairText} ${season} A cross-read from an independent operator that disagrees by more than ${DERBY_DISAGREEMENT_PP} points on the margin withholds the window, so there is no reading and no burn. Readings use each coin's feed at the boundaries. Our own coins' trading is never read.`;
}

/**
 * A FLIPPENING THAT IS ALREADY DECIDED (owner decision 2026-10-12, website-20 item 66): a flippening whose first coin is already larger
 * than the second when it is created has nothing to flip, so it is refused at creation (coverage/preflight.ts, code "already-decided",
 * from the live primary values times each mint's circulating supply). The daily comparison is not affected. Equal sizes are not ahead.
 */
/**
 * WRAPPER PAIRS (sources-7, QA walkthrough 11 H7): SOL against one of its own staking tokens (JITOSOL, MSOL, BSOL, BNSOL and the rest),
 * BTC against a wrapped bitcoin, ETH against a wrapped or staked ether, or two forms of the same asset. The two move almost together and
 * the staking yield or the wrapper's discount decides nearly every window, so the race is close to settled in advance. Refused at pick
 * time (the tile), on the review and at admission. By symbol, case-insensitive.
 */
export const WRAPPED_FORMS: Readonly<Record<string, readonly string[]>> = {
  SOL: ["WSOL", "JITOSOL", "MSOL", "BSOL", "BNSOL", "JUPSOL", "INF", "STSOL", "HSOL", "DSOL", "VSOL", "BBSOL", "PICOSOL", "HUBSOL", "STRONGSOL", "EZSOL", "LAINESOL", "COMPASSSOL", "BONKSOL", "SSOL", "JSOL", "ADRASOL", "CGNTSOL", "EDGESOL", "PATHSOL"],
  BTC: ["WBTC", "CBBTC", "TBTC", "ZBTC", "LBTC", "XBTC", "SOLVBTC", "FBTC", "BTCB", "UBTC"],
  ETH: ["WETH", "STETH", "WSTETH", "CBETH", "RETH", "WEETH", "METH", "EZETH", "RSETH", "SFRXETH", "FRXETH", "OETH"],
};
const wrappedBaseOf = (symbol: string): string | null => {
  const s = symbol.trim().toUpperCase().replace(/^\$/, "");
  if (WRAPPED_FORMS[s]) return s;
  for (const [base, forms] of Object.entries(WRAPPED_FORMS)) if (forms.includes(s)) return base;
  return null;
};
/** The plain refusal for a wrapper pair, or null when the two coins are not forms of the same asset. */
export function wrapperPairProblem(a: Pick<DerbyUnderlying, "symbol">, b: Pick<DerbyUnderlying, "symbol">): string | null {
  const ba = wrappedBaseOf(a.symbol), bb = wrappedBaseOf(b.symbol);
  if (!ba || ba !== bb) return null;
  const A = a.symbol.trim().toUpperCase(), Bs = b.symbol.trim().toUpperCase();
  const tail = "so the two move almost together and the small gap between them decides nearly every day. Pick two coins that are not forms of the same asset.";
  if (A === ba) return `${Bs} is a wrapped form of ${ba}, ${tail}`;
  if (Bs === ba) return `${A} is a wrapped form of ${ba}, ${tail}`;
  return `${A} and ${Bs} are both forms of ${ba}, ${tail}`;
}

export const flipAlreadyAheadSentence = (a: string, b: string): string => `${a} already closes above ${b} in size, so there is nothing to flip. A flippening can launch only while ${a} is the smaller of the two.`;

/** Cheap-features item 12: a derby pair's live scoreboard (built by derby/page.ts derbyScoreboard; a pure type, so the page types can name it). */
export interface DerbyScoreboard {
  tickers: { a: string; b: string };
  daysWon: { a: number; b: number }; ties: number; withheld: number;
  streak: { side: "A" | "B" | null; days: number };
  forwardedSol: { toA: string; toB: string };
  run: { day: number; of: number; over: boolean };
  line: string;
}
