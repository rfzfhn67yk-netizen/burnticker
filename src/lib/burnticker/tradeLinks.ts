/**
 * WHERE TO TRADE A COIN (owner, 2026-10-14: "make sure it's easy for people to find and purchase tokens that are launched"). The one
 * builder every surface reads: the coin page header, the coin cards, the launch success screen, "Your coins", the keeper's static
 * tokens.html and the $DEFICIT site (which carries a hand copy of the same URL forms, pinned by test/burntickerTradeLinks.test.ts).
 * market.ts tradeLinks (the coin page's status.json block) is built from this file too. Client-safe: no file reads, no imports.
 *
 * The URL forms, checked against the live sites on 2026-10-14 (read-only fetches):
 *   - on the LaunchLab curve: https://raydium.io/launchpad/token/?mint=<mint>. Raydium's /launchpad/token page reads `mint` from the
 *     query (its page chunk destructures {mint} from router.query), and Raydium's launchpad API lists both J45hvg6F…fin8 ($PHINFLWIN,
 *     pool Ce2EEG…) and AJJ4XxCU…oqj ($DEFICIT, pool 9t2bzy…) as LaunchLab coins.
 *   - after graduation: https://raydium.io/swap/?inputMint=sol&outputMint=<mint> (the swap page reads inputMint and outputMint from the
 *     address; Raydium routes to the coin's CPMM pool) and https://jup.ag/swap/SOL-<mint>.
 *   - always, once launched on mainnet: https://dexscreener.com/solana/<mint> and https://solscan.io/token/<mint>.
 * A devnet coin gets the explorer only (Solscan with ?cluster=devnet): Raydium, Jupiter and DexScreener do not serve devnet.
 * A draft or expired coin gets nothing to trade; its mint is not on chain yet.
 */

export type TradePhase = "curve" | "migrating" | "graduated" | null;
export type CoinLinkId = "launchlab" | "raydium" | "jupiter" | "dexscreener" | "solscan";
export interface CoinLink {
  id: CoinLinkId; label: string;
  /** the venue's own address (what the counted redirect answers with) */
  url: string;
  /** what the site links: for a trade link, the counted redirect on this site (GO_PATH), which answers 302 to `url`; else `url` */
  href?: string;
}
export interface CoinLinks {
  /** places to trade the coin, the first one the primary button ("Trade on Raydium"); empty when there is nowhere to trade */
  trade: CoinLink[];
  /** places to look the coin up (chart, explorer) */
  info: CoinLink[];
  /** the primary trade link, or null */
  primary: CoinLink | null;
  /** why there is nothing to trade (draft, devnet), or null */
  note: string | null;
}

/** Every label a link can carry. Plain words; test/burntickerTradeLinks.test.ts lints each one with the copy lint. */
export const LINK_LABELS = {
  raydium: "Trade on Raydium",
  jupiter: "Swap on Jupiter",
  dexscreener: "Chart on DexScreener",
  solscan: "Mint on Solscan",
  copy: "Copy address",
} as const;

export const NOT_LAUNCHED_NOTE = "This coin is not launched. There is nothing to trade until the launch transaction lands.";
export const devnetNote = (cluster: string): string => `This is a ${cluster} coin. Raydium's and Jupiter's swap pages only serve mainnet.`;

export const launchLabUrl = (mint: string): string => `https://raydium.io/launchpad/token/?mint=${encodeURIComponent(mint)}`;
export const raydiumSwapUrl = (mint: string): string => `https://raydium.io/swap/?inputMint=sol&outputMint=${encodeURIComponent(mint)}`;
export const jupiterUrl = (mint: string): string => `https://jup.ag/swap/SOL-${encodeURIComponent(mint)}`;
export const dexScreenerUrl = (mint: string): string => `https://dexscreener.com/solana/${encodeURIComponent(mint)}`;
export const solscanTokenUrl = (mint: string, cluster = "mainnet"): string => `https://solscan.io/token/${encodeURIComponent(mint)}${cluster === "mainnet" ? "" : `?cluster=${encodeURIComponent(cluster)}`}`;

/**
 * COUNTED TRADE LINKS (campaign readiness 2026-10-19). A trade link on this site goes through /burnticker/go/<venue>?mint=<mint>, which
 * counts the click for the coin and the day (no cookie, no address, nothing about the visitor; tradeClicks.ts) and answers 302 to the
 * exact address below. The redirect builds that address itself from the mint and the venue, so it can never send anyone elsewhere.
 */
export const GO_PATH = "/burnticker/go";
export type GoVenue = "raydium" | "jupiter";
/** The counted link for a trade venue: Raydium's launchpad page on the curve, Raydium's swap after graduation (`swap`), or Jupiter. */
export const goHref = (venue: GoVenue, mint: string, o: { swap?: boolean; origin?: string } = {}): string =>
  `${o.origin ?? ""}${GO_PATH}/${venue}?mint=${encodeURIComponent(mint)}${venue === "raydium" && o.swap ? "&to=swap" : ""}`;
/** Where a counted link goes: the same builder functions as the links themselves; null for a venue this site does not link. */
export function goDestination(venue: string, mint: string, to: string | null): string | null {
  if (venue === "raydium") return to === "swap" ? raydiumSwapUrl(mint) : launchLabUrl(mint);
  if (venue === "jupiter") return jupiterUrl(mint);
  return null;
}
/** A card's button while the coin is on its curve: what it does and how far the curve is ("Swap on the curve (0 of 85 SOL)"). */
export function curveSwapLabel(raised: string | null | undefined, threshold: string | null | undefined, quote = "SOL"): string | null {
  if (raised == null || threshold == null || String(raised).trim() === "" || String(threshold).trim() === "") return null;
  const r = Number(raised), t = Number(threshold);
  if (!Number.isFinite(r) || !Number.isFinite(t) || t <= 0) return null;
  const num = (n: number) => { const x = Math.floor(Math.max(0, n) * 10) / 10; return Number.isInteger(x) ? String(x) : x.toFixed(1); };
  return `Swap on the curve (${num(r)} of ${num(t)} ${quote})`;
}

/**
 * The links for one coin. `status`: the registry status (draft and expired coins have nothing to trade); `phase`: the curve phase when
 * read (null is treated as "on the curve": a launched coin that was not read this cycle still opens Raydium's launchpad page, which
 * itself sends a graduated coin on to its pool).
 */
export function coinLinks(i: { cluster: string; mint: string | null | undefined; phase?: TradePhase; status?: string | null; curve?: { raised: string | null | undefined; threshold: string | null | undefined; quote?: string | null } | null }): CoinLinks {
  const mint = (i.mint ?? "").trim();
  if (!mint || i.status === "draft" || i.status === "expired") return { trade: [], info: [], primary: null, note: NOT_LAUNCHED_NOTE };
  if (i.cluster !== "mainnet") return { trade: [], info: [{ id: "solscan", label: LINK_LABELS.solscan, url: solscanTokenUrl(mint, i.cluster) }], primary: null, note: devnetNote(i.cluster) };
  const jupiter: CoinLink = { id: "jupiter", label: LINK_LABELS.jupiter, url: jupiterUrl(mint), href: goHref("jupiter", mint) };
  // a coin card passes its curve read: on the curve, its button says what it does and how far the curve is (campaign readiness item 8)
  const onCurve = i.phase !== "graduated" && i.phase !== "migrating";
  const curveLabel = onCurve && i.curve ? curveSwapLabel(i.curve.raised, i.curve.threshold, i.curve.quote ?? "SOL") : null;
  const trade: CoinLink[] = i.phase === "graduated"
    ? [{ id: "raydium", label: LINK_LABELS.raydium, url: raydiumSwapUrl(mint), href: goHref("raydium", mint, { swap: true }) }, jupiter]
    : [{ id: "launchlab", label: curveLabel ?? LINK_LABELS.raydium, url: launchLabUrl(mint), href: goHref("raydium", mint) }, jupiter];
  const info: CoinLink[] = [{ id: "dexscreener", label: LINK_LABELS.dexscreener, url: dexScreenerUrl(mint) }, { id: "solscan", label: LINK_LABELS.solscan, url: solscanTokenUrl(mint) }];
  return { trade, info, primary: trade[0], note: null };
}

/** All of a coin's links in display order: trade first, then chart and explorer. */
export const allLinks = (l: CoinLinks): CoinLink[] => [...l.trade, ...l.info];
/** What an anchor points at: the counted redirect for a trade link, the venue's address for the rest. */
export const linkHref = (l: Pick<CoinLink, "url" | "href">): string => l.href ?? l.url;
