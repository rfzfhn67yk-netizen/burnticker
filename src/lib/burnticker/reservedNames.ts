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
export interface ReservedList { schema: "burnticker.reserved-tickers/v1"; reserved: string[]; refusal?: string }

/** Upper-case letters and digits only: the form both sides are compared in. */
export const normaliseName = (s: string): string => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

export function parseReserved(raw: unknown): ReservedList {
  const r = raw as Partial<ReservedList> | null;
  if (!r || r.schema !== "burnticker.reserved-tickers/v1" || !Array.isArray(r.reserved) || r.reserved.some((x) => typeof x !== "string" || !normaliseName(x))) throw new Error(`${RESERVED_FILE}: not a burnticker.reserved-tickers/v1 file`);
  return r as ReservedList;
}

let cache: { file: string; mtimeMs: number; set: Set<string> } | null = null;
/** The reserved names, normalised. Re-read when the file changes, so a line the owner adds applies without a restart. */
export function loadReserved(file = RESERVED_FILE): Set<string> {
  const st = fs.statSync(file);
  if (cache && cache.file === file && cache.mtimeMs === st.mtimeMs) return cache.set;
  const set = new Set(parseReserved(JSON.parse(fs.readFileSync(file, "utf8"))).reserved.map(normaliseName));
  cache = { file, mtimeMs: st.mtimeMs, set };
  return set;
}

/** True when the ticker or name, normalised, is on the reserved list. */
export const isReserved = (value: string, set: ReadonlySet<string> = loadReserved()): boolean => { const n = normaliseName(value); return !!n && set.has(n); };

/** The refusal for a side, or null: the ticker first, then the name. */
export function reservedProblem(side: { ticker: string; name: string }, set: ReadonlySet<string> = loadReserved()): string | null {
  return isReserved(side.ticker, set) || isReserved(side.name, set) ? RESERVED_REFUSAL : null;
}

/**
 * Two free tickers near a taken or reserved one: the same letters with a digit (LAD2, LAD3 …), each checked against the registry and the
 * reserved list by the caller's `free`. Never more than ten characters.
 */
export function tickerSuggestions(ticker: string, free: (t: string) => boolean, n = 2): string[] {
  const base = normaliseName(ticker) || "COIN", out: string[] = [];
  for (let k = 2; k < 100 && out.length < n; k++) {
    const sfx = String(k), t = `${base.slice(0, 10 - sfx.length)}${sfx}`;
    if (!out.includes(t) && free(t)) out.push(t);
  }
  return out;
}
