import type { BurnRule } from "@/lib/burnticker/rules";
import { canonical, derbySeriesId, type DerbyUnderlying } from "@/lib/burnticker/derby/spec";
import { HIGH_ONCE_MAX_DAYS, type HighBaseline, type HighSpan, type HighSpec } from "@/lib/burnticker/derby/high";
import { inverseRefusal } from "@/lib/burnticker/inverse";
import { DEFAULT_SHARE, SHARE_PRESETS } from "@/lib/burnticker/launchPresets";

/**
 * A COIN'S RECORD CLOSE ON THE LAUNCH PAGE (WIRING-SOURCES4, website-21; the owner, 2026-10-12: "burn every time an existing coin reaches
 * a new high, or similar"). The Coin vs Coin tile's third choice: one reference coin's daily close against its record (derby/high.ts,
 * `selector: "high"`). Pure and browser-safe: the words the tile shows, the block it locks and the rule it sends. The baseline comes from
 * the server (POST /v1/derby/high, derby/adapter.ts highBaseline); the series hash is computed by the caller (Web Crypto in the tile,
 * node in the tests) over canonical(block), exactly what derbySeriesId hashes. The copy lint refuses the words for a market high, so
 * every label says "record close" or "record daily close".
 */

export const HIGH_CHOICE_LABEL = "A coin's record close";
export const HIGH_CHOICE_LINE = "Burn when a coin's daily close beats its record.";
export const PAIR_CHOICE_LABEL = "Two coins";
export const PAIR_CHOICE_LINE = "Two new coins race on two coins' daily feeds.";
export const HIGH_PICKER_LABEL = "Reference coin, the one whose record close is read";
export const HIGH_SPAN_LABEL = "How far back the record reaches";
export const HIGH_SPAN_CHOICES: readonly { span: HighSpan; label: string }[] = [{ span: "all", label: "Its whole history" }, { span: 30, label: "The last 30 days" }, { span: 90, label: "The last 90 days" }];
/** The one-time run on the web (any length up to HIGH_ONCE_MAX_DAYS through the API). */
export const HIGH_ONCE_DAYS = 30;
export const HIGH_PATTERNS = {
  every: { label: "Every time it sets a record close", line: "The coin burns its share on every day the reference's daily close beats the record, and each new record raises it." },
  once: { label: "Once, on the next record close", line: `The coin burns its share once, on the first day the reference's daily close beats the record. If no day does within ${HIGH_ONCE_DAYS} days, the coin ends without a burn.` },
} as const;
/** "Winner takes the burn", greyed: a record coin is a single coin (rules.ts validateRule refuses a pair). */
export const HIGH_SINGLE_REASON = "A record close is one coin measured against its own record, so there is no second coin to take the burn.";
export const HIGH_RUN_NOTE = `On the web a one-time record coin runs for ${HIGH_ONCE_DAYS} days. Through the API it can run up to ${HIGH_ONCE_MAX_DAYS} days.`;
export const HIGH_PYTH_ONLY = "A record close reads a Pyth feed. This coin has none, so pick another.";
export const HIGH_NOT_READ_HERE = "This site cannot read the daily closes a record needs right now, so a record-close coin is not offered here.";
export const HIGH_READING = "Reading its daily closes. A whole history can take a minute.";
/** The baseline was read for an earlier UTC day: derby/admission.ts refuses it, so the tile reads again (WIRING-SOURCES4). */
export const HIGH_NEW_DAY = "A new UTC day started, so the record was read again for a launch today.";

export const highSpanOf = (x: unknown): HighSpan | null => (x === "all" ? "all" : x === 30 || x === "30" ? 30 : x === 90 || x === "90" ? 90 : null);
/** Why a body's `u` cannot be read for a record (null: it can): a derby underlying with a Pyth feed and a cross-read. */
export function highUnderlyingProblem(u: unknown): string | null {
  const x = u && typeof u === "object" ? (u as Partial<DerbyUnderlying>) : null;
  if (!x || typeof x.symbol !== "string" || !/^[A-Z0-9]{1,12}$/.test(x.symbol)) return "Send the reference as a derby underlying (u), as /derby/search returns it.";
  if (typeof x.pyth !== "string" || !/^(0x)?[0-9a-f]{64}$/i.test(x.pyth)) return HIGH_PYTH_ONLY;
  if (typeof x.cross !== "string" || !x.cross) return "The reference needs its cross-read, as /derby/search returns it.";
  return null;
}

const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
/** The block a record-close coin locks: the season starts on the launch day (UTC); a recurring coin has no end, a one-time coin a run. */
export function highBlock(o: { u: DerbyUnderlying; span: HighSpan; once: boolean; baseline: HighBaseline; nowMs: number }): HighSpec {
  return { selector: "high", u: o.u, span: o.span, once: o.once, season: { start: isoDay(o.nowMs), days: o.once ? HIGH_ONCE_DAYS : null }, baseline: o.baseline };
}
/** What the series hash covers (derbySeriesId hashes canonical(block)). */
export const highHashInput = (b: HighSpec): string => canonical(b);
/** The share row and its default for a pattern: recurring 1–25 % (2 %), once 100 % or 50 % (100 %). */
export const highShares = (once: boolean): { options: readonly number[]; fallback: number } => (once ? { options: SHARE_PRESETS.oneShot, fallback: DEFAULT_SHARE.oneShot } : { options: SHARE_PRESETS.recurring, fallback: DEFAULT_SHARE.recurring });
/** The rule (rules.ts validateRule: a scalar, 1 for a record day, never paired, never inverted). */
export function highRule(b: HighSpec, seriesHash: string, fraction: number): BurnRule {
  return { schema: "burnticker.rules/v1", oracle: "derby", series: derbySeriesId(b, () => seriesHash), market: null, filter: {}, kind: "scalar", binary: null, scalar: { unit: 1, perUnit: { fractionOfPool: Number(fraction.toFixed(4)) }, baseline: 0, direction: "up" }, pair: null, onVoid: "skip", floorUsd: "1", reserveSol: "0.02", vault: null, derby: b, onEnd: { windDownDays: 28, sweepThresholdLamports: 50_000_000, endSink: true } } as unknown as BurnRule;
}
/** The two greyed patterns and why (step 3's "Other patterns"). */
export function highGreyed(r: BurnRule | null): { id: "fade" | "winner"; label: string; reason: string }[] {
  return [
    { id: "fade", label: "When it does not happen", reason: (r ? inverseRefusal(r) : null) ?? "Burn Derby rules cannot be inverted." },
    { id: "winner", label: "Winner takes the burn", reason: HIGH_SINGLE_REASON },
  ];
}
