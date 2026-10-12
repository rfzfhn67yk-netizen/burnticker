import type { Metadata } from "next";
import CheckClient from "./CheckClient";
import { previewMetadata, receiptSharePreview } from "@/lib/burnticker/sharePreviewServe";

export const dynamic = "force-dynamic";

/**
 * /burnticker/check. The page itself is ./CheckClient.tsx (the checklist and the in-browser verifier). Since website-14 (product idea 9)
 * a receipt link (?sig=…&cluster=…) gets its own preview: the coin, the result, the network and the burn amount checked against its
 * rule (sharePreview.ts); any other link keeps the layout's default preview.
 */
export async function generateMetadata({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }): Promise<Metadata> {
  const q = await searchParams;
  const sig = typeof q.sig === "string" ? q.sig : null, cluster = q.cluster === "devnet" ? "devnet" : "mainnet";
  if (!sig) return {};
  const p = await receiptSharePreview(sig, cluster);
  return p ? previewMetadata(p, `/burnticker/check?sig=${encodeURIComponent(sig)}&cluster=${cluster}`) : {};
}

export default function Page() {
  return <CheckClient />;
}
