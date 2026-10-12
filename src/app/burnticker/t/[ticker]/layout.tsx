import { feedHref } from "@/lib/burnticker/feeds";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { coinSharePreview, previewMetadata } from "@/lib/burnticker/sharePreviewServe";
import { platform } from "@/lib/burnticker/server";
import { lookupCoin, registryCoinKey } from "@/lib/burnticker/coinLookup";
import { coinCanonicalHref } from "@/lib/burnticker/coinKey";

export const dynamic = "force-dynamic";

/**
 * A coin link's preview (website-14, product idea 9): the coin, the event its rule reads, the network and the burn amount checked against
 * its rule (sharePreview.ts), with the coin's receipt card as the image. A ticker this site has not registered keeps the default preview.
 * The segment is a mint or a ticker (owner 2026-10-12: tickers are not unique). The canonical address is always the coin's mint page;
 * a ticker several coins share is a chooser page and keeps the default preview.
 */
export async function generateMetadata({ params }: { params: Promise<{ ticker: string }> }): Promise<Metadata> {
  const { ticker } = await params;
  let mint: string | null = null, key = ticker.toUpperCase();
  try {
    const p = platform();
    const l = lookupCoin(p.registry, ticker);
    if (l.kind === "many") return { title: `$${l.ticker} on Burnticker`, description: `Several coins use the ticker $${l.ticker}. Pick one by its mint address.` };
    if (l.kind === "one") { mint = l.token.mint; key = registryCoinKey(p.registry, l.token); }
  } catch { /* the registry could not be read: the ticker as written */ }
  const p = await coinSharePreview(mint ?? ticker.toUpperCase());
  const canonical = mint ? coinCanonicalHref(mint) : `/burnticker/t/${encodeURIComponent(ticker.toUpperCase())}`;
  return p ? { ...previewMetadata(p, canonical), alternates: { canonical, types: { "application/rss+xml": feedHref({ coin: key }, "rss"), "application/feed+json": feedHref({ coin: key }, "json") } } } : {};
}

export default function Layout({ children }: { children: ReactNode }) { return children; }
