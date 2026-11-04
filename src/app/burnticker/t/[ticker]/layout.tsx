import { feedHref } from "@/lib/burnticker/feeds";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound, redirect } from "next/navigation";
import fs from "node:fs";
import path from "node:path";
import { coinSharePreview, previewMetadata } from "@/lib/burnticker/sharePreviewServe";
import { DEFICIT_PAGE_TITLE, deficitPreview } from "@/lib/burnticker/sharePreview";
import { platform } from "@/lib/burnticker/server";
import { coinPageFound, coinPageTitle, deficitMintTarget, lookupCoin, registryCoinKey, type CoinLookup } from "@/lib/burnticker/coinLookup";
import { coinCanonicalHref } from "@/lib/burnticker/coinKey";
import { loadTransparency } from "@/lib/burnticker/trust";
import { metadata as NOT_FOUND_METADATA } from "../../not-found";

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
    if (l.kind === "many") return { title: { absolute: `$${l.ticker} on Burnticker` }, description: `Several coins use the ticker $${l.ticker}. Pick one by its mint address.` };
    if (l.kind === "one") { mint = l.token.mint; key = registryCoinKey(p.registry, l.token); }
  } catch { /* the registry could not be read: the ticker as written */ }
  // prelaunch audit 2026-10-18 A-24: a page that answers 404 keeps the 404's own title (it used to flip to "$NOPE on Burnticker" after
  // hydration, from the coin title below)
  if (l?.kind === "none" && !coinPageFound(ticker, () => l!, servedPages())) return NOT_FOUND_METADATA;
  const p = await coinSharePreview(mint ?? ticker.toUpperCase());
  const canonical = mint ? coinCanonicalHref(mint) : `/burnticker/t/${encodeURIComponent(ticker.toUpperCase())}`;
  const alternates = (c: string) => ({ canonical: c, types: { "application/rss+xml": feedHref({ coin: key }, "rss"), "application/feed+json": feedHref({ coin: key }, "json") } });
  // AP6-8: $DEFICIT (no registry row) gets its own preview, its own og:url and a title that is not doubled by the site's title template
  if (!p && key === "DEFICIT") { const c = "/burnticker/t/DEFICIT"; return { ...previewMetadata(deficitPreview(), c), title: { absolute: DEFICIT_PAGE_TITLE }, alternates: alternates(c) }; }
  // campaign readiness item 7: the canonical address is the mint page (never a utm_* or ref parameter), with or without a share preview
  // coinPageTitle already ends "on Burnticker", so it is absolute (the template would add "· Burnticker" again)
  return p ? { ...previewMetadata(p, canonical), alternates: alternates(canonical) } : { title: { absolute: coinPageTitle(ticker, l) }, ...(mint ? { alternates: { canonical } } : {}) };
}

/** The pages that exist without a registry row besides $DEFICIT's: disclosed rehearsal coins. Null when the list cannot be read. */
function servedPages(): { tickers: string[]; mints: string[] } | null {
  try { const r = loadTransparency().rehearsals; return { tickers: r.map((x) => x.symbol), mints: r.flatMap((x) => (x.mint ? [x.mint] : [])) }; } catch { return null; }
}

/**
 * QA walkthrough 11 M13 (2026-10-13): a ticker or mint this site does not know is a real 404 (coinLookup.ts coinPageFound decides;
 * $DEFICIT's pre-launch page, rehearsal coins and an unreadable registry keep the page). notFound() is called outside any try.
 */
/** $DEFICIT's created mint from config/own-tokens.json; null when unreadable or not created yet. */
function deficitMint(): string | null {
  try {
    const own = JSON.parse(fs.readFileSync(path.join(process.cwd(), "config", "own-tokens.json"), "utf8")) as { tokens: { symbol: string; address: string | null; status: string }[] };
    const d = own.tokens.find((t) => t.symbol === "DEFICIT");
    return d && d.status === "launched" ? d.address : null;
  } catch { return null; }
}

export default async function Layout({ children, params }: { children: ReactNode; params: Promise<{ ticker: string }> }) {
  const { ticker } = await params;
  // walkthrough 13: $DEFICIT by its mint opens its page (served from its keeper's files, not a registry row); redirect() is outside any try
  let known = false;
  try { known = lookupCoin(platform().registry, ticker).kind !== "none"; } catch { known = false; }
  const target = deficitMintTarget(ticker, deficitMint(), known);
  if (target) redirect(target);
  const found = coinPageFound(ticker, (k) => lookupCoin(platform().registry, k), servedPages());
  if (!found) notFound();
  return children;
}
