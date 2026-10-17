import fs from "node:fs";
import path from "node:path";

/**
 * RESERVED NAMES (owner, 2026-10-12: "add the reserved list and generate by default with the option to change it"). The platform's own
 * names, the flagship's names and their obvious variants, and the operator's handles, in one config file
 * (config/burnticker/reserved-tickers.json) that the owner can extend with one line. The launch review and the launch route read it at
 * request time for BOTH the ticker and the name of every side, ignoring case, spaces and punctuation ("Burn Ticker", "$burnticker" and
 * "BURNTICKER" are the same). The registry's own taken check (registry.tickerTaken) is left alone: the platform's coins ($DEFICIT,
 * $REHEARSAL) register through the registry themselves, so the reserved list sits beside it, in the creator paths only.
 */

export const RESERVED_FILE = path.join("config", "burnticker", "reserved-tickers.json");
/** The refusal lives in the client-safe copy module (guidedLaunch.ts) so the launch page can match it without reading files. */
export { RESERVED_REFUSAL } from "@/lib/burnticker/guidedLaunch";
import { RESERVED_REFUSAL } from "@/lib/burnticker/guidedLaunch";
export interface ReservedList { schema: "burnticker.reserved-tickers/v1"; reserved: string[]; refusal?: string; /** ChatGPT audit 6 item 9: major coins' tickers */ majors?: string[]; majorsRefusal?: string }

/** Upper-case letters and digits only: the form both sides are compared in. */
export const normaliseName = (s: string): string => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

export function parseReserved(raw: unknown): ReservedList {
  const r = raw as Partial<ReservedList> | null;
  if (!r || r.schema !== "burnticker.reserved-tickers/v1" || !Array.isArray(r.reserved) || r.reserved.some((x) => typeof x !== "string" || !normaliseName(x)) || (r.majors !== undefined && (!Array.isArray(r.majors) || r.majors.some((x) => typeof x !== "string" || !normaliseName(x))))) throw new Error(`${RESERVED_FILE}: not a burnticker.reserved-tickers/v1 file`);
  return r as ReservedList;
}

let cache: { file: string; mtimeMs: number; set: Set<string>; majors: Set<string> } | null = null;
const read = (file: string) => {
  const st = fs.statSync(file);
  if (cache && cache.file === file && cache.mtimeMs === st.mtimeMs) return cache;
  const l = parseReserved(JSON.parse(fs.readFileSync(file, "utf8")));
  cache = { file, mtimeMs: st.mtimeMs, set: new Set(l.reserved.map(normaliseName)), majors: new Set((l.majors ?? []).map(normaliseName)) };
  return cache;
};
/** The reserved names, normalised. Re-read when the file changes, so a line the owner adds applies without a restart. */
export function loadReserved(file = RESERVED_FILE): Set<string> { return read(file).set; }
/** Major coins' tickers (the stablecoins and the largest coins: SOL, USDC, USDT, BTC, ETH …), normalised, from the same file's `majors`. */
export function loadMajors(file = RESERVED_FILE): Set<string> { return read(file).majors; }
/** ChatGPT audit 6 item 9: the refusal for a major coin's ticker, used as a ticker or as the whole name. */
export const MAJOR_REFUSAL = "That is the ticker of a major coin, so a new coin cannot use it. Pick a ticker of your own.";
export function majorProblem(side: { ticker: string; name: string }, set: ReadonlySet<string> = loadMajors()): string | null {
  return isReserved(side.ticker, set) || isReserved(side.name, set) ? MAJOR_REFUSAL : null;
}

/**
 * sources-7 (QA walkthrough 11 H9: DEF1CIT passed, and the site itself suggested $DEFICIT3, $BURNTICKE2 and $REHEARSAL2). The forms a
 * reserved name is compared in: as typed; with digits read as the letters they imitate (0 O, 1 I or L, 3 E, 4 A, 5 S, 7 T, 8 B); with
 * added digits at the end taken off; and a cut-off end (a reserved name of 8 or more letters whose first 7 or more letters are the
 * whole value). "DEFICITS" and "DEBTUP" stay free (the owner's earlier calls): a letter added to a reserved name is a different word.
 */
const FOLD: Record<string, [string, string]> = { "0": ["O", "O"], "1": ["I", "L"], "3": ["E", "E"], "4": ["A", "A"], "5": ["S", "S"], "7": ["T", "T"], "8": ["B", "B"] };
export function reservedForms(value: string): string[] {
  const n = normaliseName(value);
  if (!n) return [];
  const stripped = n.replace(/\d+$/, "");
  const forms = new Set([n, stripped]);
  for (const base of [n, stripped]) for (const k of [0, 1] as const) forms.add(base.replace(/[0134578]/g, (d) => FOLD[d][k]));
  return [...forms].filter((x) => x.length >= 2);
}
/** True when the ticker or name, in any of its reservedForms, is on the reserved list or a cut-off reserved name. */
export const isReserved = (value: string, set: ReadonlySet<string> = loadReserved()): boolean => {
  const forms = reservedForms(value);
  if (forms.some((f) => set.has(f))) return true;
  return forms.some((f) => f.length >= 7 && [...set].some((r) => r.length >= 8 && r !== f && r.startsWith(f) && /^[A-Z]+$/.test(f)));
};

/** sources-7 H9: a reserved ticker is called a ticker (the name keeps RESERVED_REFUSAL). */
export const RESERVED_TICKER_REFUSAL = "That ticker is reserved for the platform. Pick a ticker of your own.";
/** The refusal for a side, or null: the ticker first, then the name. */
export function reservedProblem(side: { ticker: string; name: string }, set: ReadonlySet<string> = loadReserved()): string | null {
  return isReserved(side.ticker, set) ? RESERVED_TICKER_REFUSAL : isReserved(side.name, set) ? RESERVED_REFUSAL : null;
}

/**
 * Two free tickers near a taken one: the same letters with a digit (LAD2, LAD3 …), each checked against the registry and the reserved
 * list by the caller's `free`. Never more than ten characters. Never called on a reserved ticker (tickerCheck.ts suggests from the
 * rule's own ticker then), and never returns a reserved form.
 */
export function tickerSuggestions(ticker: string, free: (t: string) => boolean, n = 2): string[] {
  const base = normaliseName(ticker) || "COIN", out: string[] = [];
  for (let k = 2; k < 100 && out.length < n; k++) {
    const sfx = String(k), t = `${base.slice(0, 10 - sfx.length)}${sfx}`;
    if (!out.includes(t) && !isReserved(t) && free(t)) out.push(t);
  }
  return out;
}
