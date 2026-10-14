import type { Latest } from "@/lib/burnticker/latestOnly";
import { defaultName, defaultTicker, fightName, fightTickers } from "@/lib/burnticker/derby/tile";
import { pairNames, pairTickers } from "@/lib/burnticker/guidedLaunch";

/**
 * THE COIN VS COIN PICKER'S RULES (launch audit 241–248, 2026-10-12). CoinVsCoinTile.tsx's CoinPicker searches
 * GET /api/burnticker/v1/derby/search; this module decides which answers it shows, what it says about them, and when a deep link
 * (?derby=1&a=WIF&b=SHIB) may pick a coin by itself. Client-safe, plain functions.
 *
 *   241  the other side's coin is excluded by ASSET (its mint or its Pyth feed), never by symbol: two different coins may share a ticker,
 *        and the same coin can come back from Pyth and from Jupiter
 *   242  a deep link's value is bounded to a ticker's 12 characters, except a full Solana mint, which is kept whole
 *   243  a deep link picks a coin by itself only when exactly one launchable asset answers to it
 *   244  a query under 2 characters cancels any search still in flight, so its late answer is never shown
 *   245/246  the line under the box says what to do: type more, nothing matched, or the only match is the other coin
 *   248  each generated name and ticker is tracked on its own: editing one never freezes the other three
 */

export interface PickerHit {
  symbol: string;
  source: string;
  feed: string | null;
  mint: string | null;
  underlying: { symbol?: string; pyth: string | null; mint: string | null; pool?: string | null } | null;
}

/** Every id that names the asset behind a hit: its Solana mint, its Pyth feed, else its pool. Never the symbol. */
export function assetIds(h: PickerHit): string[] {
  const out = new Set<string>();
  for (const m of [h.mint, h.underlying?.mint]) if (m) out.add(`mint:${m}`);
  for (const f of [h.feed, h.underlying?.pyth]) if (f) out.add(`pyth:${f.toLowerCase().replace(/^0x/, "")}`);
  if (!out.size && h.underlying?.pool) out.add(`pool:${h.underlying.pool}`);
  return [...out];
}
export function sameAsset(a: PickerHit, b: PickerHit): boolean {
  const ids = new Set(assetIds(a));
  return assetIds(b).some((x) => ids.has(x));
}
/** The answers to show: every hit except the other side's asset. */
export const visibleHits = <H extends PickerHit>(hits: readonly H[], exclude: PickerHit | null): H[] => (exclude ? hits.filter((h) => !sameAsset(h, exclude)) : [...hits]);

const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
/** A deep link's a / b value as the search box takes it. */
export function deepLinkQuery(raw: string | null | undefined): string {
  const s = (raw ?? "").trim();
  return MINT.test(s) ? s : s.slice(0, 12);
}

/** The distinct assets among `hits` (the first hit stands for each). */
const distinct = <H extends PickerHit>(hits: readonly H[]): H[] => hits.reduce<H[]>((acc, h) => (acc.some((x) => sameAsset(x, h)) ? acc : [...acc, h]), []);
/**
 * The hit a deep link may pick by itself: a launchable hit whose mint is the link's value, or whose symbol is, and only when exactly one
 * asset answers. `ambiguous` lists the assets when more than one does, so the picker can say to choose.
 */
export function deepLinkPick<H extends PickerHit>(hits: readonly H[], initial: string, exclude: PickerHit | null): { pick: H | null; ambiguous: H[] } {
  const q = initial.trim();
  if (!q) return { pick: null, ambiguous: [] };
  const usable = visibleHits(hits, exclude).filter((h) => !!h.underlying);
  const byMint = distinct(usable.filter((h) => assetIds(h).includes(`mint:${q}`)));
  if (byMint.length === 1) return { pick: byMint[0], ambiguous: [] };
  const bySymbol = distinct(usable.filter((h) => h.symbol.toUpperCase() === q.toUpperCase()));
  if (bySymbol.length === 1) return { pick: bySymbol[0], ambiguous: [] };
  return { pick: null, ambiguous: bySymbol.length > 1 ? bySymbol : byMint };
}

export const MIN_QUERY = 2;
export const QUERY_HINT = "Enter at least 2 characters to search.";
/**
 * One step of the search box: a query of at least MIN_QUERY characters gets a fresh token (older answers become stale); a shorter one
 * cancels whatever is in flight and asks for nothing.
 */
export function searchToken(latest: Latest, q: string): number | null {
  if (q.trim().length < MIN_QUERY) { latest.cancel(); return null; }
  return latest.next();
}

/** The line under the search box, or null. */
export function pickerNote(o: { query: string; searched: boolean; busy: boolean; error: string | null; hits: readonly PickerHit[]; exclude: PickerHit | null; ambiguous?: readonly PickerHit[] }): string | null {
  const q = o.query.trim();
  if (q.length > 0 && q.length < MIN_QUERY) return QUERY_HINT;
  if (!o.searched || o.busy || o.error) return null;
  if (o.ambiguous && o.ambiguous.length > 1) return `More than one coin uses the ticker ${o.ambiguous[0].symbol}. Pick the one you mean below.`;
  if (!o.hits.length) return "No coin matches that search. Try a ticker, a name or a mint.";
  if (!visibleHits(o.hits, o.exclude).length && o.exclude) return `The only match is ${o.exclude.symbol}, which is already the other coin. Search for a different coin.`;
  return null;
}

// ---- the generated names (launch audit 248) ---------------------------------------------------------------------------------------

export interface PairNameFields { a: string; b: string; ta: string; tb: string }
export type EditedFields = Record<keyof PairNameFields, boolean>;
export const NONE_EDITED: EditedFields = { a: false, b: false, ta: false, tb: false };
/** A stored draft's `edited` (a single boolean before launch audit 248: true meant every field was the creator's) as per-field flags. */
export function editedFrom(v: unknown): EditedFields {
  if (v === true) return { a: true, b: true, ta: true, tb: true };
  const o = (v && typeof v === "object" ? v : {}) as Partial<EditedFields>;
  return { a: o.a === true, b: o.b === true, ta: o.ta === true, tb: o.tb === true };
}
/**
 * The names and tickers after a pick: every field the creator has not typed in follows the picked coins (both picked: the matchup's
 * "WIFVBONK" and "WIF vs BONK, WIF side"; one picked: "TEAMWIF" and "Team WIF"); a typed field is left alone.
 */
export function generatedNames(a: { symbol: string } | null, b: { symbol: string } | null, cur: PairNameFields, edited: EditedFields, o: { flip?: boolean } = {}): PairNameFields {
  const gen: Partial<PairNameFields> = {};
  // cheap-features item 15: a daily race's sides carry the fight ($WIFWINS / $BONKWINS); the flippening keeps $SOLVETH / $ETHVSOL
  if (a && b && !o.flip) { const t = fightTickers(a.symbol, b.symbol); Object.assign(gen, { a: fightName(a.symbol), b: fightName(b.symbol), ta: t.a, tb: t.b }); }
  else if (a && b) { const t = pairTickers(a.symbol, b.symbol), n = pairNames(a.symbol, b.symbol); Object.assign(gen, { a: n.a, b: n.b, ta: t.a, tb: t.b }); }
  else { if (a) Object.assign(gen, { a: defaultName(a.symbol), ta: defaultTicker(a.symbol) }); if (b) Object.assign(gen, { b: defaultName(b.symbol), tb: defaultTicker(b.symbol) }); }
  const out = { ...cur };
  for (const k of ["a", "b", "ta", "tb"] as const) if (!edited[k] && gen[k] !== undefined) out[k] = gen[k]!;
  return out;
}
