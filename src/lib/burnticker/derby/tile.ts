import type { BurnRule } from "@/lib/burnticker/rules";
import { coinvsHashInput, wrapperPairProblem, derbySentence, derbySeriesId, derbySpecProblems, DERBY_SEASON_DAYS, nextUtcMidnight, nextUtcMonday, type CoinVsSpec, type DerbyUnderlying, type DerbyWindow } from "@/lib/burnticker/derby/spec";

/**
 * THE "COIN VS COIN" WIZARD TILE'S MODEL (2026-10-10). Pure and browser-safe: from two picked coins, a window, a season length and the
 * flippening toggle, the side-A rule (the server derives side B by inversion, as for every pair), the plain review sentence and the
 * default names. The series hash is computed by the caller (the tile with Web Crypto, the tests with node's) and passed in, so the
 * same function runs in both places and the review sentence is exactly what the rule does.
 */

export interface TileChoice { a: DerbyUnderlying; b: DerbyUnderlying; window: DerbyWindow; seasonDays: number; flip: boolean; fraction: number; now: number }

/** The default fan-coin ticker for a coin ("WIF" → "TEAMWIF"; the program's memo prefix allows 2–12 of A–Z/0–9). */
export const defaultTicker = (symbol: string): string => `TEAM${symbol}`.replace(/[^A-Z0-9]/g, "").slice(0, 12);
export const defaultName = (symbol: string): string => `Team ${symbol}`;
/**
 * Cheap-features item 15 (owner 2026-10-13): fight-style tickers for the two sides of a daily race ("$WIFWINS" / "$BONKWINS"), at most
 * ten characters (the launch limit): the symbol and WINS, else WIN, else the symbol's first six letters and WINS. The pair id and the
 * flippening's tickers ($SOLVETH) do not change.
 */
export const fightTicker = (symbol: string): string => { const s = symbol.toUpperCase().replace(/[^A-Z0-9]/g, ""); return s.length + 4 <= 10 ? `${s}WINS` : s.length + 3 <= 10 ? `${s}WIN` : `${s.slice(0, 6)}WINS`; };
export const fightName = (symbol: string): string => `${symbol} Wins`;
export const fightTickers = (a: string, b: string): { a: string; b: string } => ({ a: fightTicker(a), b: fightTicker(b) });
/** The matchup tickers ("WIFVBONK" / "BONKVWIF"): each side's first four letters, a V, the other's first four (guidedLaunch.ts pairTickers). */
export function matchupTickers(a: string, b: string): { a: string; b: string } {
  const code = (s: string): string => s.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
  const A = code(a), B = code(b);
  return { a: `${A}V${B}`.slice(0, 10), b: `${B}V${A}`.slice(0, 10) };
}
/**
 * THE SUGGESTED TICKERS OF A COIN VS COIN PAIR (continuous audit HB-3, 2026-10-19: the server review suggested COINVSWIFB while the page
 * suggested WIFWINS). One function for the page (coinPicker.ts generatedNames) and the server (describe.ts describeRule): a daily race
 * carries the fight, the flippening the matchup.
 */
export const coinvsTickers = (a: string, b: string, flip: boolean): { a: string; b: string } => (flip ? matchupTickers(a, b) : fightTickers(a, b));

/** The derby block for a choice (season starts at the first full window after `now`). */
export function tileSpec(c: TileChoice): CoinVsSpec {
  const start = c.window === "weekly" ? nextUtcMonday(c.now) : nextUtcMidnight(c.now);
  const days = c.window === "weekly" ? Math.max(7, Math.round(c.seasonDays / 7) * 7) : Math.min(DERBY_SEASON_DAYS.max, Math.max(DERBY_SEASON_DAYS.min, Math.round(c.seasonDays)));
  return { selector: "coinvs", a: c.a, b: c.b, window: c.window, measure: c.flip ? "mcap" : "pct", season: { start, days }, flip: c.flip };
}

/** What the series hash covers, for the caller to hash (sha256, hex). */
export const tileHashInput = (c: TileChoice): string => coinvsHashInput(tileSpec(c));

/** Side A's rule (binary: YES = coin A wins the window → side A burns) and the review sentence; `problems` when the choice cannot launch. */
export function tileRule(c: TileChoice, seriesHash: string, tickers: { a: string; b: string }): { rule: BurnRule | null; spec: CoinVsSpec; sentence: string; problems: string[] } {
  const spec = tileSpec(c);
  const problems = derbySpecProblems(spec);
  // sources-7 H7: a coin against its own staked or wrapped form is refused when the pair is picked
  { const w = wrapperPairProblem(spec.a, spec.b); if (w) problems.push(w); }
  // website-19: the flippening resolves once (rules.ts isOneShot), so it takes the one-shot share, up to the whole pool
  if (!(c.fraction >= 0.01 && c.fraction <= (c.flip ? 1 : 0.25))) problems.push(c.flip ? "the one-time burn is 1–100% of the burn pool" : "the burn per winning window is 1–25% of the burn pool");
  const sentence = derbySentence(spec, tickers.a, tickers.b, c.fraction);
  if (problems.length) return { rule: null, spec, sentence, problems };
  const m = { fractionOfPool: Number(c.fraction.toFixed(4)) };
  const rule = { schema: "burnticker.rules/v1", oracle: "derby", series: derbySeriesId(spec, () => seriesHash), market: null, filter: {}, kind: "binary", binary: { onYes: m, onNo: null }, scalar: null, pair: null, onVoid: "skip", floorUsd: "1", reserveSol: "0.02", vault: null, derby: spec, onEnd: { windDownDays: 28, sweepThresholdLamports: 50_000_000, endSink: true } } as BurnRule;
  return { rule, spec, sentence, problems };
}

/** sha256 → hex with Web Crypto (the browser) — the node side uses rulesSha256. */
export async function sha256HexWeb(s: string): Promise<string> {
  const bytes = new TextEncoder().encode(s);
  const d = await crypto.subtle.digest("SHA-256", bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Cheap-features item 11: the line a daily race's tile and review open with ("$WIFWINS vs $BONKWINS: 30 days, every day a winner."). */
export const fightLead = (tickerA: string, tickerB: string, days: number): string => `$${tickerA} vs $${tickerB}: ${days} ${days === 1 ? "day" : "days"}, every day a winner.`;
