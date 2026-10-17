import { groupDigits, pctOfSupply, shortDay } from "@/lib/burnticker/cardView";

/**
 * SHARE PREVIEWS (website-14, ChatGPT product idea 9). What a coin link and a receipt link show when pasted into X, a chat or a feed:
 * the coin, the event its rule reads, the network, and the burn amount that was checked against its rule, in cardView's own words
 * ("1,234.5 $RAYS, 0.12% of supply"). It never reads as a claim about the market: only what the rule did to supply, and whether the
 * receipt's arithmetic was checked. Pure; sharePreviewServe.ts reads the registry, the evidence and the keeper's files.
 */
export interface SharePreview { title: string; description: string; imageUrl: string; imageAlt: string }
export const DEFAULT_OG = { url: "https://burnticker.com/brand/og.png", alt: "Burnticker: a thermal receipt with the burned amount scorched out of it" } as const;

const net = (cluster: string) => (cluster === "mainnet" ? "Solana mainnet" : cluster === "devnet" ? "Solana devnet, a practice network where tokens have no money value" : cluster);
const sentence = (s: string) => { const t = s.trim().replace(/^./, (c) => c.toUpperCase()); return /[.!?]$/.test(t) ? t : `${t}.`; };

export interface CoinFacts { ticker: string; name: string; rule: string; cluster: string; verifiedBurned: string; verifiedCount: number; pctOfSupply: number | null; badgeUrl: string | null }
export function coinPreview(c: CoinFacts): SharePreview {
  const burned = c.verifiedCount > 0
    ? `${groupDigits(c.verifiedBurned)} $${c.ticker}${c.pctOfSupply === null ? "" : `, ${pctOfSupply(c.pctOfSupply)}`}, burned on ${c.verifiedCount} receipt${c.verifiedCount === 1 ? "" : "s"} checked against its rule.`
    : "No burn has been checked against its rule yet.";
  return {
    title: `${c.name} $${c.ticker}`,
    description: `${sentence(c.rule)} On ${net(c.cluster)}. ${burned}`,
    imageUrl: c.badgeUrl ?? DEFAULT_OG.url, imageAlt: c.badgeUrl ? `The receipt card for $${c.ticker}` : DEFAULT_OG.alt,
  };
}

export interface ReceiptFacts { ticker: string; cluster: string; settledAt: string; event: string | null; units: number; burned: string | null; verified: boolean; status: string; badgeUrl: string | null }
export function receiptPreview(r: ReceiptFacts): SharePreview {
  const day = shortDay(r.settledAt) ?? r.settledAt.slice(0, 10);
  const what = r.status === "confirmed" && r.burned ? `${groupDigits(r.burned)} $${r.ticker} burned from ${r.units === 1 ? "one unit" : `${r.units} units`}.` : `Its status is ${r.status}, so nothing burned on it.`;
  return {
    title: `A $${r.ticker} burn receipt`,
    description: `The result of ${day}${r.event ? ` (${r.event})` : ""} on ${net(r.cluster)}. ${what} ${r.verified ? "Its rule arithmetic and memo were checked, and they match." : "This site has not checked its arithmetic yet. The page checks it again in your browser."}`,
    imageUrl: r.badgeUrl ?? DEFAULT_OG.url, imageAlt: r.badgeUrl ? `The receipt card for $${r.ticker}` : DEFAULT_OG.alt,
  };
}
