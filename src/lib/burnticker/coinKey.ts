/**
 * COIN KEYS (owner decision 2026-10-12: tickers are NOT unique). Every lookup and every link resolves a coin by its MINT; a ticker is a
 * friendly alias that keeps working while one coin holds it. Pure (no I/O), safe in client components.
 *
 * THE KEYING RULE
 *   Web links (/burnticker/t/<key>, badges, CSV, embeds, feeds): the key is the ticker while no other non-expired coin shares it, and
 *   the mint once the ticker is shared. Every endpoint also takes the mint, always. A ticker that several coins share answers with the
 *   list of coins (the page shows a chooser, the APIs a 300 with the candidates) instead of picking one.
 *   The coin page's canonical URL is always the mint URL, the one address that never turns into a chooser.
 *   Static per-coin publishing (the keeper's site dir t/<key>/), keyed by mint (prelaunch audit 2026-10-18 A-2): every coin publishes
 *   at t/<MINT>. The "owner" of a ticker also keeps t/<TICKER> (so every path published before tickers were shared stays put); the owner
 *   is the earliest LAUNCHED coin holding the ticker (by launch time, then registration order). A draft never owns a ticker directory.
 * Tickers are 2 to 12 letters and digits, and mints are 32 to 44 base58 characters, so the two key spaces never overlap.
 */

const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** A base58 mint address (32 to 44 characters), as opposed to a ticker. */
export const isMintKey = (s: string): boolean => MINT_RE.test(s);

export interface KeyedCoin { ticker: string; mint: string; status?: string }

/** Tickers held by more than one non-expired coin in a list (upper case). */
export function sharedTickers(coins: readonly { ticker: string; status?: string }[]): Set<string> {
  const n = new Map<string, number>();
  for (const c of coins) if (c.status !== "expired") n.set(c.ticker.toUpperCase(), (n.get(c.ticker.toUpperCase()) ?? 0) + 1);
  return new Set([...n].filter(([, k]) => k > 1).map(([t]) => t));
}

/** Whether `shared` (a flag, or the set from sharedTickers) says this coin's ticker is shared. */
const isShared = (c: KeyedCoin, shared: boolean | ReadonlySet<string>): boolean => (typeof shared === "boolean" ? shared : shared.has(c.ticker.toUpperCase()));

/** The coin's web key: its ticker while it alone holds it, its mint once the ticker is shared. */
export const coinKey = (c: KeyedCoin, shared: boolean | ReadonlySet<string> = false): string => (isShared(c, shared) ? c.mint : c.ticker);

/** The coin page: /burnticker/t/<key>. */
export const coinPageHref = (c: KeyedCoin, shared: boolean | ReadonlySet<string> = false): string => `/burnticker/t/${encodeURIComponent(coinKey(c, shared))}`;

/** The coin page's canonical address: always the mint. */
export const coinCanonicalHref = (mint: string): string => `/burnticker/t/${encodeURIComponent(mint)}`;

/** "AbCd…WxYz": a mint or wallet shortened for a list. */
export const shortKey = (a: string): string => (a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a);

export interface SiteCoin { ticker: string; mint: string; status: string; launchedAt?: string | null; createdAt?: number | null }

/**
 * The keeper's static site directories for every coin, keyed by mint (see THE KEYING RULE above). Input order is registration order
 * (registry.tokens() is ordered by created_at), used as the tiebreak. The first entry of each list is the coin's primary directory.
 */
export function siteKeysOf(coins: readonly SiteCoin[]): Map<string, string[]> {
  const byTicker = new Map<string, { c: SiteCoin; i: number }[]>();
  coins.forEach((c, i) => { const k = c.ticker.toUpperCase(); byTicker.set(k, [...(byTicker.get(k) ?? []), { c, i }]); });
  const out = new Map<string, string[]>();
  for (const list of byTicker.values()) {
    const held = list.filter((x) => x.c.status !== "expired");
    const launched = held.filter((x) => x.c.status !== "draft");
    const order = (a: { c: SiteCoin; i: number }, b: { c: SiteCoin; i: number }) => (a.c.launchedAt ?? "").localeCompare(b.c.launchedAt ?? "") || a.i - b.i;
    // prelaunch audit 2026-10-18 A-2: only a LAUNCHED coin ever owns t/<TICKER> (a draft never takes it), and every coin is also
    // published at t/<MINT>, the directory that never changes hands
    const owner = launched.length ? [...launched].sort(order)[0] : null;
    for (const { c } of list) out.set(c.mint, owner && c === owner.c ? [c.ticker, c.mint] : [c.mint]);
  }
  return out;
}

/** A per-coin map (receipts by coin) read by mint first, then by ticker (maps written before tickers were shared are keyed by ticker). */
export function byCoin<T>(map: Readonly<Record<string, T>>, c: KeyedCoin): T | undefined {
  return Object.prototype.hasOwnProperty.call(map, c.mint) ? map[c.mint] : map[c.ticker];
}

/** One coin on a shared ticker, as the chooser and the 300 answers list it. */
export interface CoinCandidate { mint: string; ticker: string; name: string; creator: string; status: string; rule: string; href: string; api: string }

/** The chooser page's rows (the coin page route renders these for a shared ticker). */
export interface ChooserRow { href: string; name: string; ticker: string; mint: string; mintShort: string; creatorShort: string; rule: string }
export function chooserRows(candidates: readonly CoinCandidate[]): ChooserRow[] {
  return candidates.map((c) => ({ href: c.href, name: c.name, ticker: c.ticker, mint: c.mint, mintShort: shortKey(c.mint), creatorShort: shortKey(c.creator), rule: c.rule }));
}

/** The chooser page's words. */
export const CHOOSER_COPY = {
  intro: (ticker: string) => `Several coins use the ticker $${ticker}. Each one is listed below with its mint address and its creator. Pick one to open its page.`,
  mint: "Mint",
  creator: "Created by",
};
