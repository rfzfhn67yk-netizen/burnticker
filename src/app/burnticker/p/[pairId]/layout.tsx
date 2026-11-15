import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { platform } from "@/lib/burnticker/server";
import { pairPageFound } from "@/lib/burnticker/publicPairs";
import { pairSeed, type PairSeed } from "@/lib/burnticker/pairPageMeta";
import { withShareCard } from "@/lib/burnticker/pageMeta";
import { receiptCardPath } from "@/lib/burnticker/receiptCardServe";
import { metadata as NOT_FOUND_METADATA } from "../../not-found";
import { PairSeedProvider } from "./PairSeed";

export const dynamic = "force-dynamic";

/** The pair's registry facts, or null when the registry cannot be read (the page then says so itself). */
function seedOf(pairId: string): PairSeed | null {
  try { return pairSeed(platform().registry, pairId); } catch { return null; }
}

/**
 * Owner's UX walkthrough 2026-10-18: a pair page opened titled "Burnticker" with no canonical address. Its title ("$A vs $B"),
 * description, canonical address and share card come from the registry at request time (pairPageMeta.ts); a pair that answers 404
 * keeps the 404's own title.
 */
export async function generateMetadata({ params }: { params: Promise<{ pairId: string }> }): Promise<Metadata> {
  const { pairId } = await params;
  if (!pairPageFound(() => platform().registry, pairId)) return NOT_FOUND_METADATA;
  const s = seedOf(pairId);
  if (!s) return { title: "Rivalry pair" };
  const m = withShareCard({ title: s.title, description: s.description, alternates: { canonical: s.canonical } });
  // OP6-11: the pair's own share image (a launched side's receipt card) instead of the site's generic card
  if (!s.imageMint) return m;
  const image = { url: `https://burnticker.com${receiptCardPath(s.imageMint)}`, width: 1200, height: 630, alt: `A receipt card from the pair ${s.title}` };
  return { ...m, openGraph: { ...m.openGraph, images: [image] }, twitter: { ...m.twitter, images: [image.url] } };
}

/**
 * Prelaunch audit 2026-10-18 A-25: the expired PIT/BAL draft pair answered 200 with "Neither coin of this pair has launched" while the
 * live pair with the same tickers sits under another id. A pair id the registry does not have, or a pair with no launched side, is a
 * real 404 now (publicPairs.ts pairPageFound decides; an unreadable registry keeps the page, as the coin pages do). notFound() is
 * called outside any try. The page gets the pair's registry facts (PairSeed.tsx) so its matchup heading is in the first HTML.
 */
export default async function Layout({ children, params }: { children: ReactNode; params: Promise<{ pairId: string }> }) {
  const { pairId } = await params;
  if (!pairPageFound(() => platform().registry, pairId)) notFound();
  return <PairSeedProvider seed={seedOf(pairId)}>{children}</PairSeedProvider>;
}
