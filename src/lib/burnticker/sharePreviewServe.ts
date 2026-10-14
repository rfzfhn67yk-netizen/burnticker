import fs from "node:fs";
import path from "node:path";
import type { Metadata } from "next";
import { platform, tokenPageData } from "@/lib/burnticker/server";
import { sampleReceipts } from "@/lib/burnticker/trustpack/samples";
import { memoBurn } from "@/lib/burnticker/home";
import { coinPreview, receiptPreview, DEFAULT_OG, type SharePreview } from "@/lib/burnticker/sharePreview";
import { lookupCoin, registryCoinKey } from "@/lib/burnticker/coinLookup";
import { receiptCardPath } from "@/lib/burnticker/receiptCardServe";

/**
 * The share previews' data (website-14, product idea 9): a registered coin's status and receipts (the verified ones only count toward
 * the amount), a receipt by its signature (a registered coin's, or the devnet rehearsal's evidence). Null when nothing is found, so the
 * page keeps its default preview. Server only.
 */
const ORIGIN = "https://burnticker.com";
/** `key` is a mint or a ticker; a ticker several coins share keeps the default preview (owner 2026-10-12: tickers are not unique). */
export async function coinSharePreview(key: string, now = Date.now()): Promise<SharePreview | null> {
  try {
    const p = platform();
    const l = lookupCoin(p.registry, key);
    const t = l.kind === "one" ? l.token : null;
    if (!t || t.status === "expired") return null;
    const d = await tokenPageData(p, t, now);
    const ok = d.receipts.filter((r) => r.status === "confirmed" && r.verify.verified);
    const total = ok.reduce((a, r) => a + Number(r.burned ?? 0), 0);
    const supply = Number(d.status.supply.initial);
    return coinPreview({ ticker: d.status.ticker, name: d.status.name, rule: d.status.profile?.oneLiner ?? d.status.seriesTitle ?? d.status.selectorKey, cluster: d.status.cluster, verifiedBurned: String(total), verifiedCount: ok.length, pctOfSupply: supply > 0 ? (total / supply) * 100 : null, badgeUrl: d.status.status === "draft" ? null : `${ORIGIN}${receiptCardPath(t.mint)}` });
  } catch { return null; }
}

export async function receiptSharePreview(signature: string, cluster: string, now = Date.now()): Promise<SharePreview | null> {
  if (!/^[1-9A-HJ-NP-Za-km-z]{60,100}$/.test(signature)) return null;
  try {
    const p = platform();
    for (const t of p.registry.tokens()) {
      if (!p.registry.receipts(t.mint).some((r) => r.signature === signature)) continue;
      const d = await tokenPageData(p, t, now);
      const r = d.receipts.find((x) => x.signature === signature);
      if (!r) return null;
      return receiptPreview({ ticker: d.status.ticker, cluster: d.status.cluster, settledAt: r.settledAt, event: r.title ?? r.market, units: r.units, burned: r.burned, verified: r.verify.verified, status: r.status, badgeUrl: `${ORIGIN}/api/burnticker/v1/badge/${encodeURIComponent(registryCoinKey(p.registry, t))}.png` });
    }
  } catch { /* the devnet evidence below */ }
  try {
    const s = sampleReceipts();
    const r = s.receipts.find((x) => x.signature === signature);
    if (!r || cluster !== "devnet") return null;
    const burned = memoBurn(r.memo);
    // the evidence row's own verify block: the keeper's recomputation of the rule and the memo when the row was written
    let verified = false;
    try { const rows = JSON.parse(fs.readFileSync(path.join(process.cwd(), r.evidence), "utf8")) as { signature: string | null; verify?: { verified?: boolean } }[]; verified = rows.find((x) => x.signature === signature)?.verify?.verified === true; } catch { verified = false; }
    return receiptPreview({ ticker: r.ticker, cluster: "devnet", settledAt: r.recordDate, event: "the U.S. national debt reading", units: r.units, burned: burned === null ? null : String(burned), verified, status: r.status, badgeUrl: null });
  } catch { return null; }
}

/** A preview as Next metadata: the page title, the description, Open Graph and the X card. */
export function previewMetadata(p: SharePreview, path: string): Metadata {
  return {
    title: p.title, description: p.description,
    openGraph: { type: "website", siteName: "Burnticker", title: p.title, description: p.description, url: path, images: [{ url: p.imageUrl, alt: p.imageAlt, ...(p.imageUrl === DEFAULT_OG.url || p.imageUrl.includes("/burnticker/img/receipt/") ? { width: 1200, height: 630 } : {}) }] },
    twitter: { card: "summary_large_image", title: p.title, description: p.description, images: [p.imageUrl] },
  };
}
