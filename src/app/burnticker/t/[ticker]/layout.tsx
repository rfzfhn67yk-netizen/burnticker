import type { Metadata } from "next";
import type { ReactNode } from "react";
import { coinSharePreview, previewMetadata } from "@/lib/burnticker/sharePreviewServe";

export const dynamic = "force-dynamic";

/**
 * A coin link's preview (website-14, product idea 9): the coin, the event its rule reads, the network and the burn amount checked against
 * its rule (sharePreview.ts), with the coin's receipt card as the image. A ticker this site has not registered keeps the default preview.
 */
export async function generateMetadata({ params }: { params: Promise<{ ticker: string }> }): Promise<Metadata> {
  const { ticker } = await params;
  const p = await coinSharePreview(ticker.toUpperCase());
  return p ? { ...previewMetadata(p, `/burnticker/t/${encodeURIComponent(ticker.toUpperCase())}`), alternates: { canonical: `/burnticker/t/${encodeURIComponent(ticker.toUpperCase())}` } } : {};
}

export default function Layout({ children }: { children: ReactNode }) { return children; }
