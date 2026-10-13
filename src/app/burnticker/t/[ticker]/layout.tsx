import { feedHref } from "@/lib/burnticker/feeds";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { coinSharePreview, previewMetadata } from "@/lib/burnticker/sharePreviewServe";
import { platform } from "@/lib/burnticker/server";
import { coinPageFound, coinPageTitle, lookupCoin, registryCoinKey, type CoinLookup } from "@/lib/burnticker/coinLookup";
import { coinCanonicalHref } from "@/lib/burnticker/coinKey";
import { loadTransparency } from "@/lib/burnticker/trust";

export const dynamic = "force-dynamic";

/**
 * A coin link's preview (website-14, product idea 9): the coin, the event its rule reads, the network and the burn amount checked against
 * its rule (sharePreview.ts), with the coin's receipt card as the image. A ticker this site has not registered keeps the default preview.
 * The segment is a mint or a ticker (owner 2026-10-12: tickers are not unique). The canonical address is always the coin's mint page;
 * a ticker several coins share is a chooser page and keeps the default preview. QA 11 M13: every coin page has its own title.
 */
export async function generateMetadata({ params }: { params: Promise<{ ticker: string }> }): Promise<Metadata> {
  const { ticker } = await params;
  let mint: string | null = null, key = ticker.toUpperCase(), l: CoinLookup | null = null;
  try {
    const p = platform();
    l = lookupCoin(p.registry, ticker);
    if (l.kind === "many") return { title: `$${l.ticker} on Burnticker`, description: `Several coins use the ticker $${l.ticker}. Pick one by its mint address.` };
    if (l.kind === "one") { mint = l.token.mint; key = registryCoinKey(p.registry, l.token); }
  } catch { /* the registry could not be read: the ticker as written */ }
  const p = await coinSharePreview(mint ?? ticker.toUpperCase());
  const canonical = mint ? coinCanonicalHref(mint) : `/burnticker/t/${encodeURIComponent(ticker.toUpperCase())}`;
  return p ? { ...previewMetadata(p, canonical), alternates: { canonical, types: { "application/rss+xml": feedHref({ coin: key }, "rss"), "application/feed+json": feedHref({ coin: key }, "json") } } } : { title: coinPageTitle(ticker, l) };
}

/** The pages that exist without a registry row besides $DEFICIT's: disclosed rehearsal coins. Null when the list cannot be read. */
function servedPages(): { tickers: string[]; mints: string[] } | null {
  try { const r = loadTransparency().rehearsals; return { tickers: r.map((x) => x.symbol), mints: r.flatMap((x) => (x.mint ? [x.mint] : [])) }; } catch { return null; }
}

/**
 * QA walkthrough 11 M13 (2026-10-13): a ticker or mint this site does not know is a real 404 (coinLookup.ts coinPageFound decides;
 * $DEFICIT's pre-launch page, rehearsal coins and an unreadable registry keep the page). notFound() is called outside any try.
 */
export default async function Layout({ children, params }: { children: ReactNode; params: Promise<{ ticker: string }> }) {
  const { ticker } = await params;
  const found = coinPageFound(ticker, (k) => lookupCoin(platform().registry, k), servedPages());
  if (!found) notFound();
  return children;
}
