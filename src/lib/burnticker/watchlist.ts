/**
 * THE LOCAL WATCHLIST (website-14, ChatGPT product idea 7). A visitor can follow coins and next results without a wallet or an account:
 * the list lives in this browser's localStorage under one key and is never sent anywhere (no request carries it, no server stores it).
 * Every read and write is wrapped in try/catch, so a private window, blocked storage or a preview simply shows an empty list. The wallet
 * stays needed only for Your coins. The static home page reads the same key with the same shape (site/burnticker/index.html).
 */
export const WATCH_KEY = "bt-watch-v1";
export const WATCH_EVENT = "bt-watch";
export interface Watchlist { coins: string[]; results: string[] }
export type WatchKind = keyof Watchlist;
const EMPTY: Watchlist = { coins: [], results: [] };
const clean = (xs: unknown): string[] => (Array.isArray(xs) ? [...new Set(xs.filter((x): x is string => typeof x === "string" && /^[A-Z0-9]{2,12}$/.test(x)))].slice(0, 200) : []);

/** Parses a stored value; anything malformed is an empty list. Pure. */
export function parseWatchlist(raw: string | null): Watchlist {
  if (!raw) return { ...EMPTY };
  try { const j = JSON.parse(raw) as Partial<Watchlist>; return { coins: clean(j.coins), results: clean(j.results) }; } catch { return { ...EMPTY }; }
}
/** Adds or removes one ticker. Pure. */
export function toggleWatch(w: Watchlist, kind: WatchKind, ticker: string): Watchlist {
  const t = ticker.toUpperCase();
  const has = w[kind].includes(t);
  return { ...w, [kind]: has ? w[kind].filter((x) => x !== t) : [...w[kind], t] };
}

export function readWatchlist(): Watchlist {
  try { return parseWatchlist(window.localStorage.getItem(WATCH_KEY)); } catch { return { ...EMPTY }; }
}
export function writeWatchlist(w: Watchlist): boolean {
  try { window.localStorage.setItem(WATCH_KEY, JSON.stringify(w)); window.dispatchEvent(new CustomEvent(WATCH_EVENT)); return true; } catch { return false; }
}

/** What the page says about the list, once, where it is shown. */
export const WATCH_NOTE = "Your follows are kept in this browser only. Nothing is sent to this site or anyone else, and no wallet or account is needed.";
export const WATCH_EMPTY = "You do not follow any coin yet. Press Follow on a coin card, and it shows up here in this browser.";
