import { absDec, cmpDec, pctChange, subDec } from "@/lib/burnticker/derby/measure";
import { DERBY_DISAGREEMENT_PP, type DerbyUnderlying } from "@/lib/burnticker/derby/spec";
import { fitName } from "@/lib/burnticker/launchFields";

/**
 * RECORD DAILY CLOSES (sources-4, 2026-10-12; the owner: "scheduled burns every time an existing coin hits a new all-time high, or stuff
 * like that"). A Burn Derby selector, `selector: "high"`, on ONE reference coin's Pyth feed, read the derby way: the value at each 00:00 UTC
 * boundary (Pyth's signed update or its Solana account snapshot) cross-checked by an independent operator (Jupiter, DexScreener or
 * RedStone) within 15 minutes of the boundary; a disagreement above 2 points, or a missing read, WITHHOLDS the day.
 *
 *   THE DAILY CLOSE of UTC day D is the reference's value at the 00:00 UTC boundary that ends D (00:00 on D + 1). Never intraday: a higher
 *   value during the day counts for nothing; only the close is compared.
 *   span "all"   a record close: day D's close is above every earlier close of the feed. The earlier closes are the BASELINE (read at
 *                review from Pyth's signed updates, one per boundary, and locked into the rule: the highest close since the history began,
 *                the day it was reached, and the last close before launch) plus every close the keeper has decided since.
 *   span 30 / 90 a record close over a window: day D's close is above each of the previous 30 (or 90) daily closes. The baseline locks the
 *                N closes before launch, oldest first.
 *   once false   RECURRING: one unit for every day whose close is a record (reading 1), none for the others (reading 0).
 *   once true    ONE-SHOT: the whole share once, on the first record day; days that are not records give no reading at all. With no record
 *                by the end of its run (`season.days`), one closing reading of 0 ends the coin with nothing burned.
 *   A WITHHELD day has no reading and no burn, and its close is not part of the record: the record is built only from closes that were
 *   read and agreed.
 *   ALREADY AT ITS HIGH at launch (the last close before launch is the record) → refused, never a day-one burn.
 *
 * Pure and browser-safe (the review card renders the baseline, the current high and the distance from here).
 */

export type HighSpan = "all" | 30 | 90;
export const HIGH_SPANS: readonly HighSpan[] = ["all", 30, 90];
/** The longest run a one-shot record coin may wait (and the longest any history read goes back for a 30/90-day window). */
export const HIGH_ONCE_MAX_DAYS = 366;
/** How far back the review reads Pyth for a record baseline before it stops (5 years of 00:00 UTC boundaries). */
export const HIGH_HISTORY_MAX_DAYS = 1826;

/** span "all": the highest close since `since` (the first close read), the day it was reached, and the last close (on `through`). */
export interface HighBaselineAll { kind: "all"; since: string; through: string; high: string; highOn: string; last: string; feedBegan: boolean }
/** span 30 / 90: the N closes ending on `through`, oldest first. */
export interface HighBaselineWindow { kind: "window"; through: string; closes: string[] }
export type HighBaseline = HighBaselineAll | HighBaselineWindow;

export interface HighSpec {
  selector: "high";
  u: DerbyUnderlying;
  span: HighSpan;
  once: boolean;
  /** The first counted day is `start` (= baseline.through + 1, the launch day); `days` null = no end (recurring only). */
  season: { start: string; days: number | null };
  baseline: HighBaseline;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DEC_RE = /^\d+(\.\d+)?$/;
const DAY_MS = 86_400_000;
const validDate = (s: unknown): s is string => typeof s === "string" && DATE_RE.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
const posDec = (s: unknown): s is string => typeof s === "string" && DEC_RE.test(s) && cmpDec(s, "0") > 0;
export const addDay = (d: string, n: number): string => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const spanDays = (s: HighSpan): number | null => (s === "all" ? null : s);

/** Problems with a high block's own fields (the underlying is checked by spec.ts). */
export function highSpecProblems(d: Partial<HighSpec>, p: string[]): void {
  if (d.u && typeof d.u === "object" && !d.u.pyth) p.push("derby.u: a record-close rule reads a Pyth feed");
  if (!HIGH_SPANS.includes(d.span as HighSpan)) p.push('derby.span must be "all", 30 or 90');
  if (typeof d.once !== "boolean") p.push("derby.once must be true or false");
  const s = d.season as HighSpec["season"] | undefined;
  if (!s || typeof s !== "object") p.push("derby.season { start, days } required");
  else {
    if (!validDate(s.start)) p.push("derby.season.start must be a YYYY-MM-DD date (00:00 UTC)");
    if (s.days !== null && (!Number.isInteger(s.days) || s.days < 1 || s.days > HIGH_ONCE_MAX_DAYS)) p.push(`derby.season.days must be null (no end) or a whole number 1–${HIGH_ONCE_MAX_DAYS}`);
    if (d.once === true && s.days === null) p.push("derby: a one-shot record coin needs a run length (season.days), so it ends without a burn if no record comes");
    if (d.once === false && s.days !== null) p.push("derby: a recurring record coin has no end date (season.days null)");
    for (const k of Object.keys(s)) if (k !== "start" && k !== "days") p.push(`derby.season.${k} is not a known key`);
  }
  const b = d.baseline as HighBaseline | undefined;
  if (!b || typeof b !== "object") { p.push("derby.baseline is required (the closes before launch, read at review)"); return; }
  if (!validDate(b.through)) p.push("derby.baseline.through must be a YYYY-MM-DD date");
  else if (s && validDate(s.start) && addDay(b.through, 1) !== s.start) p.push("derby: the first counted day (season.start) is the day after the baseline's last close (baseline.through + 1)");
  if (d.span === "all") {
    const a = b as HighBaselineAll;
    if (a.kind !== "all") p.push('derby.baseline.kind must be "all" for span "all"');
    if (!validDate(a.since) || !validDate(a.highOn)) p.push("derby.baseline.since and highOn must be YYYY-MM-DD dates");
    else if (validDate(a.through) && !(a.since <= a.highOn && a.highOn <= a.through)) p.push("derby.baseline: highOn must fall between since and through");
    if (!posDec(a.high) || !posDec(a.last)) p.push("derby.baseline.high and last must be positive decimal strings");
    else if (cmpDec(a.last, a.high) > 0) p.push("derby.baseline: the last close cannot be above the high");
    if (typeof a.feedBegan !== "boolean") p.push("derby.baseline.feedBegan must be true or false");
    for (const k of Object.keys(a)) if (!["kind", "since", "through", "high", "highOn", "last", "feedBegan"].includes(k)) p.push(`derby.baseline.${k} is not a known key`);
  } else if (d.span === 30 || d.span === 90) {
    const w = b as HighBaselineWindow;
    if (w.kind !== "window") p.push('derby.baseline.kind must be "window" for a 30- or 90-day span');
    if (!Array.isArray(w.closes) || w.closes.length !== d.span || !w.closes.every(posDec)) p.push(`derby.baseline.closes must be the ${d.span} closes before launch, oldest first, each a positive decimal string`);
    for (const k of Object.keys(w)) if (!["kind", "through", "closes"].includes(k)) p.push(`derby.baseline.${k} is not a known key`);
  }
}

/** The counted days from `season.start` up to the UTC day containing `nowMs` (and within the run, when it has one). */
export function highDays(spec: Pick<HighSpec, "season">, nowMs: number): string[] {
  const today = new Date(nowMs).toISOString().slice(0, 10), out: string[] = [];
  for (let d = spec.season.start, i = 0; d <= today && (spec.season.days === null || i < spec.season.days); d = addDay(d, 1), i++) out.push(d);
  return out;
}
/** The run's last counted day (null: no end). */
export const highLastDay = (spec: Pick<HighSpec, "season">): string | null => (spec.season.days === null ? null : addDay(spec.season.start, spec.season.days - 1));

/** One close the history read or the keeper decided. */
export interface DayClose { day: string; close: string }

/**
 * The review's baseline from the history read (closes oldest first; the last one must be `through`, the day before launch). Refusals:
 * no close for `through`, a gap inside a 30/90-day window, or a reference already at its high (the already-decided sentence).
 */
export function buildHighBaseline(span: HighSpan, history: readonly DayClose[], through: string, o: { feedBegan: boolean }): { baseline: HighBaseline } | { refusal: { code: "no-readings" | "already-decided"; reason: string } } {
  const xs = [...history].filter((x) => x.day <= through && posDec(x.close)).sort((a, b) => (a.day < b.day ? -1 : 1));
  const last = xs[xs.length - 1];
  if (!last || last.day !== through) return { refusal: { code: "no-readings", reason: `There is no daily close for ${through} (the day before launch), so the rule has no starting point.` } };
  let baseline: HighBaseline;
  if (span === "all") {
    let hi = xs[0];
    for (const x of xs) if (cmpDec(x.close, hi.close) >= 0) hi = x;   // the latest day that reached the high (a tie on `through` is "at its high")
    baseline = { kind: "all", since: xs[0].day, through, high: hi.close, highOn: hi.day, last: last.close, feedBegan: o.feedBegan };
  } else {
    const days = Array.from({ length: span }, (_, i) => addDay(through, i - span + 1));
    const by = new Map(xs.map((x) => [x.day, x.close]));
    const missing = days.filter((d) => !by.has(d));
    if (missing.length) return { refusal: { code: "no-readings", reason: `The ${span} daily closes before launch are not all readable (${missing.length} missing, the first ${missing[0]}), so the ${span}-day record has no complete starting window.` } };
    baseline = { kind: "window", through, closes: days.map((d) => by.get(d)!) };
  }
  const at = atHighOnLaunch(baseline);
  return at ? { refusal: { code: "already-decided", reason: at } } : { baseline };
}

/** The already-decided refusal for a reference whose last close before launch is its record (null: not at its high). */
export const HIGH_ALREADY_SENTENCE = "This reference's last daily close before launch is already its record, so a new coin on it is not offered. A coin on a record must start below the record, so that its first burn is a new one.";
export function atHighOnLaunch(b: HighBaseline): string | null {
  if (b.kind === "all") return b.highOn === b.through ? `${HIGH_ALREADY_SENTENCE} The close on ${b.through} was ${b.last}, the highest since ${b.since}.` : null;
  const last = b.closes[b.closes.length - 1], before = b.closes.slice(0, -1);
  return before.every((c) => cmpDec(last, c) > 0) ? `${HIGH_ALREADY_SENTENCE} The close on ${b.through} was ${last}, above each of the ${before.length} closes before it.` : null;
}

/** The days the baseline covers, as closes (span "all" has only its high and its last close). */
export function baselineCloses(b: HighBaseline): DayClose[] {
  if (b.kind === "window") return b.closes.map((close, i) => ({ day: addDay(b.through, i - b.closes.length + 1), close }));
  return b.highOn === b.through ? [{ day: b.through, close: b.last }] : [{ day: b.highOn, close: b.high }, { day: b.through, close: b.last }];
}

/**
 * The record a close on `day` must beat: the highest of the baseline's closes and the decided closes before `day` (span "all"), or of the
 * closes on the N days before `day` (a 30/90-day span). Withheld days are simply absent. Null when there is nothing to compare with.
 */
export function recordBefore(spec: Pick<HighSpec, "span" | "baseline">, day: string, decided: readonly DayClose[]): { record: string; on: string } | null {
  const n = spanDays(spec.span);
  const from = n === null ? null : addDay(day, -n);
  let best: DayClose | null = null;
  for (const x of [...baselineCloses(spec.baseline), ...decided]) {
    if (x.day >= day || (from !== null && x.day < from)) continue;
    if (!best || cmpDec(x.close, best.close) > 0) best = x;
  }
  return best ? { record: best.close, on: best.day } : null;
}

export type HighDecision =
  | { status: "decided"; record: boolean; close: string; crossClose: string; previous: string; previousOn: string; margin: string; crossMargin: string; disagreement: string; note: string }
  | { status: "withheld"; reason: string; close: string | null; crossClose: string | null };

/**
 * One day: its close against the record before it, with the cross-read's close at the same boundary. The cross-check compares the two
 * reads' distance from the record (percentage points); more than DERBY_DISAGREEMENT_PP apart, or no cross-read, withholds the day.
 */
export function decideHigh(symbol: string, close: string, crossClose: string | null, prev: { record: string; on: string } | null, bound = DERBY_DISAGREEMENT_PP): HighDecision {
  if (!prev) return { status: "withheld", reason: "There is no earlier close to compare with. There is no reading and no burn.", close, crossClose };
  if (crossClose === null) return { status: "withheld", reason: `The cross-read for ${symbol} was not available at the boundary. There is no reading and no burn.`, close, crossClose };
  const margin = pctChange(prev.record, close), crossMargin = pctChange(prev.record, crossClose);
  const disagreement = absDec(subDec(margin, crossMargin));
  if (cmpDec(disagreement, String(bound)) > 0) return { status: "withheld", reason: `The cross-read disagrees by ${disagreement} points on the distance from the record (primary ${margin}%, cross ${crossMargin}%, limit ${bound}). There is no reading and no burn.`, close, crossClose };
  const record = cmpDec(close, prev.record) > 0;
  return { status: "decided", record, close, crossClose, previous: prev.record, previousOn: prev.on, margin, crossMargin, disagreement, note: record ? `${symbol} closed at ${close}, above the record ${prev.record} (${prev.on})` : `${symbol} closed at ${close}, not above the record ${prev.record} (${prev.on})` };
}

/** The review's current high and the distance to it from the last close (percent, 2 decimals; "0.00" at the high). */
export function highReview(spec: Pick<HighSpec, "span" | "baseline">): { high: string; highOn: string; last: string; lastOn: string; distancePct: string; line: string } {
  const b = spec.baseline;
  const xs = baselineCloses(b);
  const last = xs[xs.length - 1];
  const hi = recordBefore(spec, addDay(b.through, 1), []) ?? { record: last.close, on: last.day };
  const distance = (Math.abs(Number(pctChange(hi.record, last.close)))).toFixed(2);
  const scope = b.kind === "all" ? `since ${b.since}` : `over the ${b.closes.length} days to ${b.through}`;
  return { high: hi.record, highOn: hi.on, last: last.close, lastOn: last.day, distancePct: distance, line: `The highest daily close ${scope} is ${hi.record}, on ${hi.on}. The last close, on ${last.day}, is ${last.close}, which is ${distance}% below it.` };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Plain sentences (lint-clean: "daily close" and "record", never the words the copy lint refuses).
// ---------------------------------------------------------------------------------------------------------------------------------

const crossName = (u: DerbyUnderlying): string => (u.cross.startsWith("jup:") ? "Jupiter" : u.cross.startsWith("dexscreener:") ? "DexScreener" : "RedStone");
/** "the highest daily close since the feed began on 2021-08-27" / "since 2021-10-12, the first day read". */
export function baselinePhrase(b: HighBaseline): string {
  if (b.kind === "window") return `the highest of the ${b.closes.length} daily closes from ${addDay(b.through, -b.closes.length + 1)} to ${b.through}`;
  return `the highest daily close since ${b.feedBegan ? `the feed began on ${b.since}` : `${b.since}, the first day read`} (${b.high}, on ${b.highOn})`;
}
const recordPhrase = (s: Pick<HighSpec, "span">): string => (s.span === "all" ? "above every earlier daily close" : `above each of the previous ${s.span} daily closes`);
export const DAILY_CLOSE_SENTENCE = "Only the daily close counts: the value at 00:00 UTC, the end of the day. A higher value during the day counts for nothing.";

/** The coin's text pieces (describe.ts): name, ticker, one-liner and the rule block, given the spend clause. */
export function highText(spec: HighSpec, spends: string): { name: string; ticker: string; oneLiner: string; block: string } {
  const sym = spec.u.symbol, n = spec.span === "all" ? "" : ` ${spec.span}-Day`;
  const src = `The daily close is ${sym}/USD on Pyth, checked against ${crossName(spec.u)} at the same boundary.`;
  const withheld = "A day whose close cannot be read, or whose two reads differ by more than 2 points, is withheld: no burn, and its close is not part of the record.";
  const base = `The record starts as ${baselinePhrase(spec.baseline)}, and each new record raises it.`;
  const tk = (sfx: string) => `${sym.slice(0, 10 - sfx.length)}${sfx}`;
  if (spec.once) {
    const by = spec.season.days ? addDay(spec.season.start, spec.season.days - 1) : null;
    return { name: fitName(`${sym} Next${n} Record Close`), ticker: tk(spec.span === "all" ? "NREC" : `N${spec.span}`), oneLiner: `burns once on the first day ${sym} closes ${recordPhrase(spec)}`,
      block: `On the first UTC day from ${spec.season.start} whose daily close of ${sym} is ${recordPhrase(spec)}, ${spends} once, with a receipt on chain. ${src} ${base} ${DAILY_CLOSE_SENTENCE} ${withheld}${by ? ` If no day through ${by} sets a record, the coin ends without a burn.` : ""}` };
  }
  return { name: fitName(`${sym}${n} Record Close`), ticker: tk(spec.span === "all" ? "REC" : `R${spec.span}`), oneLiner: `burns on every day ${sym} closes ${recordPhrase(spec)}`,
    block: `For every UTC day from ${spec.season.start} whose daily close of ${sym} is ${recordPhrase(spec)}, ${spends}, with a receipt on chain. ${src} ${base} ${DAILY_CLOSE_SENTENCE} ${withheld} A day that closes at or under the record burns nothing.` };
}

/** The rule paragraph for the token page (rules.ts ruleStatement via derbyStatement). */
export function highStatement(spec: HighSpec): string {
  const sym = spec.u.symbol, feed = `${sym}/USD on Pyth (feed ${spec.u.pyth?.slice(0, 12) ?? "?"}…)`;
  const run = spec.season.days ? ` The run is ${spec.season.days} days from ${spec.season.start}.` : ` Counting starts on ${spec.season.start} and has no end date.`;
  const what = spec.once ? `The first UTC day whose daily close is ${recordPhrase(spec)} settles the rule once; days that are not records give no reading, and a run that ends without a record gives one reading of 0.` : `Every UTC day whose daily close is ${recordPhrase(spec)} is one unit; any other day reads 0.`;
  return `Every UTC day, the daily close of ${feed} is read: its value at the 00:00 UTC boundary that ends the day. ${what} The record starts as ${baselinePhrase(spec.baseline)}, locked at launch, and every close read since then counts toward it. ${DAILY_CLOSE_SENTENCE}${run} A cross-read from an independent operator (${crossName(spec.u)}) that disagrees by more than ${DERBY_DISAGREEMENT_PP} points on the distance from the record withholds the day, so there is no reading and no burn, and that day's close is not part of the record.`;
}
