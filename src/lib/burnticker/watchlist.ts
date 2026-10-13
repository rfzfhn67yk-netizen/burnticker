/**
 * THE LOCAL WATCHLIST (website-14, ChatGPT product idea 7). A visitor can follow coins and next results without a wallet or an account:
 * the list lives in this browser's localStorage under one key and is never sent anywhere (no request carries it, no server stores it).
 * Every read and write is wrapped in try/catch, so a private window, blocked storage or a preview simply shows an empty list. The wallet
 * stays needed only for Your coins. The static home page reads the same key with the same shape (site/burnticker/index.html).
 *
 * KEYED BY NETWORK AND MINT (private review 8 F1, 2026-10-12). Tickers are not unique (owner 2026-10-12), so a follow keyed on "LAD"
 * followed and unfollowed two different coins together, and a later coin launched on the same ticker joined an old follow. A follow is
 * now "<network>:<mint>" with the mint's case kept ("mainnet:FwXiFs…"). Entries saved before this change were tickers; they stay in
 * `legacy` until they can be resolved:
 *   · exactly one listed coin on that ticker  the entry becomes that coin's key (resolveLegacy)
 *   · two or more                              it stays, and the page lists it for the visitor to pick or drop; never guessed
 *   · none listed yet                          it stays as it is
 * A coin launched later on the same ticker never joins a follow, because a follow names one mint.
 */
export const WATCH_KEY = "bt-watch-v1";
export const WATCH_EVENT = "bt-watch";
export interface Watchlist {
  /** followed coins, as coin keys (coinWatchKey) */
  coins: string[];
  /** followed next results, as coin keys */
  results: string[];
  /** tickers saved before follows were keyed by mint, not resolved yet */
  legacy: { coins: string[]; results: string[] };
}
export type WatchKind = "coins" | "results";
const empty = (): Watchlist => ({ coins: [], results: [], legacy: { coins: [], results: [] } });

const NETWORKS = ["mainnet", "devnet"] as const;
const KEY_RE = /^(mainnet|devnet):[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const TICKER_RE = /^[A-Z0-9]{2,12}$/;
/** A coin's follow key: its network and its mint, the mint's case kept. Null when the mint is not a base58 address. */
export function coinWatchKey(network: string | null | undefined, mint: string | null | undefined): string | null {
  const n = network === "devnet" ? "devnet" : "mainnet";
  const k = `${n}:${mint ?? ""}`;
  return KEY_RE.test(k) ? k : null;
}
export const isWatchKey = (s: string): boolean => KEY_RE.test(s);

const uniq = (xs: string[]): string[] => [...new Set(xs)].slice(0, 200);
const strings = (xs: unknown): string[] => (Array.isArray(xs) ? xs.filter((x): x is string => typeof x === "string") : []);
/** Splits one stored list into keys and legacy tickers (uppercased); anything else is dropped. */
function split(xs: unknown): { keys: string[]; tickers: string[] } {
  const s = strings(xs);
  return { keys: uniq(s.filter(isWatchKey)), tickers: uniq(s.map((x) => x.toUpperCase()).filter((x) => TICKER_RE.test(x) && !x.includes(":"))) };
}

/** Parses a stored value, old (tickers) or new (keys plus legacy); anything malformed is an empty list. Pure. */
export function parseWatchlist(raw: string | null): Watchlist {
  if (!raw) return empty();
  try {
    const j = JSON.parse(raw) as { coins?: unknown; results?: unknown; legacy?: { coins?: unknown; results?: unknown } };
    const c = split(j.coins), r = split(j.results);
    const lc = split(j.legacy?.coins).tickers, lr = split(j.legacy?.results).tickers;
    return { coins: c.keys, results: r.keys, legacy: { coins: uniq([...lc, ...c.tickers]), results: uniq([...lr, ...r.tickers]) } };
  } catch { return empty(); }
}
/** Adds or removes one coin key (case kept). A value that is not a coin key changes nothing. Pure. */
export function toggleWatch(w: Watchlist, kind: WatchKind, key: string): Watchlist {
  if (!isWatchKey(key)) return w;
  const has = w[kind].includes(key);
  return { ...w, [kind]: has ? w[kind].filter((x) => x !== key) : [...w[kind], key] };
}
/** Drops one legacy ticker the visitor chose to forget. Pure. */
export function dropLegacy(w: Watchlist, kind: WatchKind, ticker: string): Watchlist {
  return { ...w, legacy: { ...w.legacy, [kind]: w.legacy[kind].filter((t) => t !== ticker.toUpperCase()) } };
}

export interface ListedCoin { ticker: string; network: string; mint: string }
export interface AmbiguousFollow { kind: WatchKind; ticker: string; candidates: string[] }
/**
 * Resolves legacy tickers against the coins a page lists: one match becomes that coin's key; two or more stay and come back in
 * `ambiguous` for the visitor to settle; none stay. `changed` says whether the list needs writing. Pure.
 */
export function resolveLegacy(w: Watchlist, listed: readonly ListedCoin[]): { list: Watchlist; changed: boolean; ambiguous: AmbiguousFollow[] } {
  const out: Watchlist = { coins: [...w.coins], results: [...w.results], legacy: { coins: [], results: [] } };
  const ambiguous: AmbiguousFollow[] = [];
  let changed = false;
  for (const kind of ["coins", "results"] as const) {
    for (const t of w.legacy[kind]) {
      const keys = uniq(listed.filter((c) => c.ticker.toUpperCase() === t).map((c) => coinWatchKey(c.network, c.mint)).filter((k): k is string => !!k));
      if (keys.length === 1) { if (!out[kind].includes(keys[0])) out[kind].push(keys[0]); changed = true; }
      else { out.legacy[kind].push(t); if (keys.length > 1) ambiguous.push({ kind, ticker: t, candidates: keys }); }
    }
  }
  return { list: out, changed, ambiguous };
}

export function readWatchlist(): Watchlist {
  try { return parseWatchlist(window.localStorage.getItem(WATCH_KEY)); } catch { return empty(); }
}
export function writeWatchlist(w: Watchlist): boolean {
  try { window.localStorage.setItem(WATCH_KEY, JSON.stringify(w)); window.dispatchEvent(new CustomEvent(WATCH_EVENT)); return true; } catch { return false; }
}
export { NETWORKS as WATCH_NETWORKS };

/** What the page says about the list, once, where it is shown. */
export const WATCH_NOTE = "Your followed coins are saved only in this browser. No wallet or account is needed.";
export const WATCH_EMPTY = "You do not follow any coin yet. Press Follow on a coin card, and it shows up here in this browser.";
/** A follow saved by ticker before two coins could share one, now matching several coins: the visitor picks, the page never guesses. */
export const watchAmbiguous = (ticker: string, n: number): string => `You followed $${ticker} before two coins could share a ticker. ${n === 2 ? "Two" : String(n)} coins use $${ticker} now, so follow the one you mean below, or forget the old follow.`;
export const WATCH_FORGET = "Forget the old follow";
