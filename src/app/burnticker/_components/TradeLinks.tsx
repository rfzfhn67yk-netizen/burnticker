"use client";

import { allLinks, coinLinks, LINK_LABELS, type CoinLinks, type TradePhase } from "@/lib/burnticker/tradeLinks";
import { CopyButton } from "./CopyButton";
import { useLaunchAvailability } from "./useLaunchAvailability";

/**
 * WHERE TO TRADE, ON EVERY SURFACE (owner, 2026-10-14: "make sure it's easy for people to find and purchase tokens that are launched").
 * The links come from the one builder (src/lib/burnticker/tradeLinks.ts). Burnticker never takes an order: each link opens Raydium,
 * Jupiter, DexScreener or Solscan in a new tab.
 *
 *   TradeButtons    the primary "Trade on Raydium" button, then the other links small, then (optional) a copy-address button
 *   LaunchedTrade   the launch success screen's block: for each coin just launched, its trade link and a copy-address button. It is
 *                   mounted by the sign card (launch/SignCard.tsx) inside its "Your coin is live and recorded" block.
 */

export function TradeButtons({ links, mint, compact = false, ticker, primaryOnly = false }: { links: CoinLinks | null | undefined; mint?: string | null; compact?: boolean; ticker?: string; primaryOnly?: boolean }) {
  if (!links) return null;
  // primaryOnly: the coin page header (walkthrough 13): the one primary button; the full set sits once, under the swap panel
  const rest = primaryOnly ? [] : allLinks(links).filter((l) => l !== links.primary);
  if (!links.primary && !rest.length) return links.note && !compact ? <p className="text-xs text-neutral-500" data-trade-note>{links.note}</p> : null;
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 ${compact ? "text-xs" : "text-sm"}`} data-trade-links>
      {links.primary && <a className={compact ? "bt-launch-btn px-3 py-1 text-xs" : "bt-launch-btn"} href={links.primary.url} rel="noopener" target="_blank" data-trade-link aria-label={ticker ? `${links.primary.label}: $${ticker}, opens Raydium` : undefined}>{links.primary.label} ↗</a>}
      {rest.map((l) => <a key={l.id + l.url} className="underline text-neutral-300" href={l.url} rel="noopener" target="_blank" data-link={l.id}>{l.label}</a>)}
      {mint && <CopyButton text={mint} label={LINK_LABELS.copy} what={ticker ? `$${ticker}'s mint address` : "the mint address"} />}
    </div>
  );
}

/** The success screen's trade block for the coins a launch just recorded (on the curve: Raydium's launchpad page for each mint). */
export function LaunchedTrade({ coins, cluster }: { coins: readonly { mint: string; ticker: string }[]; cluster?: string | null }) {
  const launch = useLaunchAvailability();
  const net = cluster ?? launch.cluster ?? "mainnet";
  if (!coins.length) return null;
  return (
    <div className="space-y-2" data-launched-trade>
      {coins.map((c) => {
        const l = coinLinks({ cluster: net, mint: c.mint, phase: "curve" as TradePhase, status: "live" });
        return (
          <div key={c.mint} className="space-y-1">
            {coins.length > 1 && <p className="text-xs text-neutral-400">${c.ticker}</p>}
            <TradeButtons links={l} mint={c.mint} ticker={c.ticker} />
            <p className="text-[11px] text-neutral-500 break-all">Mint address: <code>{c.mint}</code></p>
          </div>
        );
      })}
    </div>
  );
}
