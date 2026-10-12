"use client";

import { useState } from "react";
import Link from "next/link";
import { cardViewFromIndex, type CardView } from "@/lib/burnticker/cardView";

/**
 * THE COIN CARD (2026-10-10, launchpad conventions — docs/burnticker/ui-conventions.md). Where pump.fun / bonk.fun / Pons put image,
 * name, ticker, market cap and a bonding-curve bar, Burnticker puts image, name, $TICKER, the rule's one-liner ("burns when the
 * Eagles lose"), the curve as SOL raised of the graduation threshold (no market cap: a price in disguise — the copy lint refuses it),
 * the burns tally with the last burn's age, the next result, and the venue chip. Every number not read reads "—" with a reason on hover.
 * Also used as the wizard's live preview (href null). No state but a broken-image fallback.
 */

export interface CoinCardData {
  ticker: string; name: string; imageUrl: string | null; oneLiner: string; oracle: string; status: string;
  phase: "curve" | "migrating" | "graduated" | null; progressPct: number | null; raised: string | null; threshold: string | null; quote: string | null;
  burns: number; lastBurnAt: string | null; nextAt: string | null; launchedAt: string | null; pairId?: string | null;
  /** the total burned, a decimal string of tokens (the coins index's `burned`) */
  burned?: string;
  /** The window badge (describe.ts windowBadge): "2026 SEASON", "PERPETUAL", "ONE-SHOT · Oct 31, 2026". */
  badge?: string | null;
  /** Why the curve shows "—" (hover text). */
  curveNote?: string;
}

// brief rule 8 (2026-10-12): the venue is named in plain words and Kalshi is never named; the class name stays for the chip colour
const VENUE: Record<string, string> = { kalshi: "Prediction market", polymarket: "Polymarket", catalogue: "Feed" };

/** "3m ago" / "2d ago" from an ISO time; "—" without one. */
export function ago(iso: string | null, now = Date.now()): string {
  if (!iso) return "—";
  const ms = now - Date.parse(iso);
  if (!Number.isFinite(ms)) return "—";
  if (ms < 0) return "just now";
  const m = Math.floor(ms / 60_000), h = Math.floor(m / 60), d = Math.floor(h / 24);
  return d >= 1 ? `${d}d ago` : h >= 1 ? `${h}h ago` : m >= 1 ? `${m}m ago` : "just now";
}

/** "in 2d 4h" / "in 35m" until an ISO time; "due" once passed; "—" without one. */
export function until(iso: string | null, now = Date.now()): string {
  if (!iso) return "—";
  const ms = Date.parse(iso) - now;
  if (!Number.isFinite(ms)) return "—";
  if (ms <= 0) return "due";
  const m = Math.floor(ms / 60_000), h = Math.floor(m / 60), d = Math.floor(h / 24);
  return d >= 1 ? `in ${d}d ${h % 24}h` : h >= 1 ? `in ${h}h ${m % 60}m` : `in ${Math.max(1, m)}m`;
}

export const roundStr = (s: string | null, dp = 2): string => { if (s === null) return "—"; const n = Number(s); return Number.isFinite(n) ? (Math.round(n * 10 ** dp) / 10 ** dp).toString() : s; };

/** A receipt-paper placeholder with the ticker printed on it, for coins without an image (or whose image fails to load). */
export function ReceiptThumb({ ticker, size = 88 }: { ticker: string; size?: number }) {
  return (
    <div aria-hidden="true" className="bt-thumb-receipt shrink-0" style={{ width: size, height: size }}>
      <span className="bt-thumb-top">BURNTICKER</span>
      <span className="bt-thumb-ticker" style={{ fontSize: Math.max(11, Math.round(size / (ticker.length > 6 ? 7 : 5))) }}>${ticker || "TICKER"}</span>
      <span className="bt-thumb-rule" />
      <span className="bt-thumb-top">NO IMAGE</span>
    </div>
  );
}

export function CoinThumb({ src, ticker, size = 88, generated = false }: { src: string | null; ticker: string; size?: number; generated?: boolean }) {
  const [broken, setBroken] = useState(false);
  // no image of its own: the coin's generated image (coinArt.ts, GET /burnticker/img/<TICKER>.png) when it is registered; else the receipt
  const url = src && /^https:\/\//.test(src) ? src : generated && /^[A-Z0-9]{2,10}$/.test(ticker) ? `/burnticker/img/${ticker}.svg` : src && /^\/burnticker\/img\//.test(src) ? src : null;
  if (!url || broken) return <ReceiptThumb ticker={ticker} size={size} />;
  src = url;
  // eslint-disable-next-line @next/next/no-img-element -- creator images are arbitrary https URLs; no optimiser, no referrer
  return <img src={src} alt="" width={size} height={size} loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} className="shrink-0 rounded-md object-cover bg-neutral-900" style={{ width: size, height: size }} />;
}

export function VenueChip({ oracle }: { oracle: string }) {
  const label = VENUE[oracle] ?? oracle;
  return <span className={`bt-chip bt-chip-${oracle}`}>{label}</span>;
}

/** The bonding-curve bar: SOL raised of the threshold; graduated → full with the badge; not read → an empty bar and "—". */
export function CurveBar({ c, compact = false }: { c: Pick<CoinCardData, "phase" | "progressPct" | "raised" | "threshold" | "quote" | "curveNote">; compact?: boolean }) {
  const pct = c.progressPct === null ? null : Math.max(0, Math.min(100, c.progressPct));
  const label = c.phase === "graduated" ? "graduated, trades on Raydium" : c.phase === "migrating" ? "curve complete, moving to Raydium" : pct === null ? "bonding curve not read" : `bonding curve ${pct.toFixed(pct < 10 ? 1 : 0)}%`;
  const detail = c.phase === "graduated" ? null : c.raised !== null && c.threshold !== null ? `${roundStr(c.raised)} / ${roundStr(c.threshold)} ${c.quote ?? "SOL"}` : null;
  return (
    <div title={pct === null && c.phase !== "graduated" ? (c.curveNote || "This site has not read the curve's progress.") : undefined}>
      <div className={`flex items-baseline justify-between gap-2 ${compact ? "text-[11px]" : "text-xs"} text-neutral-400`}>
        <span className="font-mono uppercase tracking-wide">{label}</span>{detail && <span className="tabular-nums">{detail}</span>}
      </div>
      <div className="bt-curve mt-1" role="progressbar" aria-label="bonding curve progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined}>
        <div className={`bt-curve-fill${c.phase === "graduated" ? " is-done" : ""}`} style={{ width: `${c.phase === "graduated" ? 100 : pct ?? 0}%` }} />
      </div>
    </div>
  );
}

/** The rule's one-liner as a sentence ("burns when the Eagles lose" → "Burns when the Eagles lose."). */
const asSentence = (s: string) => { const t = s.trim().replace(/^./, (c) => c.toUpperCase()); return /[.!?]$/.test(t) ? t : `${t}.`; };

/**
 * THE CARD, ONE FIELD ORDER (website-10, 2026-10-12; the owner's review item 5, brief rule 10): image, name, $TICKER, the rule in one
 * line, the next result (only when the rule has one), the total burned, the bonding curve (or the trading pool), then "Check receipt".
 * The order is src/lib/burnticker/cardView.ts CARD_ROWS; the static home page prints the same rows from the same JSON. The name and the
 * image link the coin's page; "Check receipt" is its own link, shown disabled with "No receipt yet" until the coin has a receipt.
 */
export function ViewCard({ v, headingLevel = 3 }: { v: CardView; headingLevel?: 2 | 3 }) {
  const H = headingLevel === 2 ? "h2" : "h3";
  const pct = v.curve.pct === null ? null : Math.max(0, Math.min(100, v.curve.pct));
  return (
    <article className={`bt-coin-card${v.tags.some((t) => t.tone === "featured") ? " is-featured" : ""}`} data-card={v.id}>
      <div className="flex gap-3">
        <div data-row="image">{v.href ? <Link href={v.href} tabIndex={-1} aria-hidden="true"><CoinThumb src={v.imageUrl} ticker={v.ticker} size={64} /></Link> : <CoinThumb src={v.imageUrl} ticker={v.ticker} size={64} />}</div>
        <div className="min-w-0 flex-1">
          {v.tags.length > 0 && <div className="flex flex-wrap gap-1.5">{v.tags.map((t) => <span key={t.label} className={`bt-chip bt-tag-${t.tone}`}>{t.label}</span>)}</div>}
          <H className="mt-1 text-base font-semibold leading-tight">
            {v.href
              ? <Link className="bt-card-link" href={v.href}><span className="bt-card-name" data-row="name">{v.name}</span> <span className="bt-card-ticker" data-row="ticker">${v.ticker}</span></Link>
              : <><span className="bt-card-name" data-row="name">{v.name}</span> <span className="bt-card-ticker" data-row="ticker">${v.ticker}</span></>}
          </H>
          {v.note && <p className="mt-1 text-xs text-neutral-400">{v.note}</p>}
        </div>
      </div>
      <dl className="bt-card-rows">
        <div data-row="rule"><dt>Rule</dt><dd>{v.rule}</dd></div>
        {v.nextSettle && <div data-row="nextSettle"><dt>Next result</dt><dd>{v.nextSettle}</dd></div>}
        <div data-row="burned"><dt>Burned</dt><dd>{v.burned}</dd></div>
        <div data-row="curve"><dt>{v.curve.done ? "Pool" : "Curve"}</dt><dd>
          <span>{v.curve.label}</span>
          <span className="bt-curve mt-1 block" role="progressbar" aria-label="bonding curve progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined}><span className={`bt-curve-fill block${v.curve.done ? " is-done" : ""}`} style={{ width: `${pct ?? 0}%` }} /></span>
        </dd></div>
      </dl>
      <div className="bt-card-foot" data-row="receipt">
        {v.receipt ? <Link className="bt-ghost-btn" href={v.receipt.href}>Check receipt</Link> : <><span className="bt-ghost-btn is-disabled" aria-disabled="true">Check receipt</span><span className="text-xs text-neutral-500">No receipt yet.</span></>}
      </div>
      {v.mint && <p className="mt-2 text-[11px] text-neutral-500">{v.mint.label}: <code className="break-all">{v.mint.address}</code></p>}
    </article>
  );
}

/** A loading card with the same footprint (review item 18): grey bars where the rows go, never words standing in for data. */
export function SkeletonCard() {
  return (
    <div className="bt-coin-card bt-skel-card" aria-hidden="true">
      <div className="flex gap-3"><div className="bt-skel" style={{ width: 64, height: 64 }} /><div className="flex-1 space-y-2 pt-1"><div className="bt-skel h-3 w-1/3" /><div className="bt-skel h-4 w-2/3" /></div></div>
      <div className="mt-4 space-y-2"><div className="bt-skel h-3 w-full" /><div className="bt-skel h-3 w-5/6" /><div className="bt-skel h-3 w-1/2" /><div className="bt-skel h-2 w-full" /></div>
      <div className="mt-4 bt-skel h-8 w-32" />
    </div>
  );
}

/** A grid of skeleton cards, with one line for screen readers. */
export function SkeletonGrid({ n = 3, label = "Loading the coins." }: { n?: number; label?: string }) {
  return <div role="status" aria-live="polite" aria-busy="true"><span className="sr-only">{label}</span><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: n }, (_, i) => <SkeletonCard key={i} />)}</div></div>;
}

/**
 * The legacy entry point: the coins index's row data, or (with `prelaunch`, the launch review card) a coin that does not exist yet, which
 * shows only what the rule fixes: the art, name, $TICKER, the rule in one line and the window badge (the owner's paste, 2026-10-10:
 * "NO IMAGE · draft · not launched · burns 0" read as a broken coin before launch).
 */
export function CoinCard({ c, href, prelaunch = false }: { c: CoinCardData; href: string | null; now?: number; prelaunch?: boolean }) {
  if (prelaunch) {
    return (
      <article className="bt-coin-card">
        <div className="flex gap-3">
          <CoinThumb src={c.imageUrl} ticker={c.ticker} size={64} generated={!!href} />
          <div className="min-w-0 flex-1">
            {c.badge && <div className="flex flex-wrap gap-1.5"><span className="bt-chip bt-chip-window" title="The coin's window, fixed in its rule">{c.badge}</span></div>}
            <h3 className="mt-1 truncate text-base font-semibold leading-tight">{c.name || "Coin name"} <span className="font-mono text-sm text-neutral-400">${c.ticker || "TICKER"}</span></h3>
          </div>
        </div>
        <dl className="bt-card-rows"><div data-row="rule"><dt>Rule</dt><dd>{asSentence(c.oneLiner)}</dd></div></dl>
      </article>
    );
  }
  return <ViewCard v={cardViewFromIndex({ ticker: c.ticker, name: c.name, mint: c.ticker, oneLiner: c.oneLiner, status: c.status, imageUrl: c.imageUrl, burned: c.burned ?? "0", burns: c.burns, nextCheckAt: c.nextAt, nextCloseTime: null, lastBurnAt: c.lastBurnAt, launchedAt: c.launchedAt, pairId: c.pairId ?? null, badge: c.badge ?? null, phase: c.phase, progressPct: c.progressPct })} />;
}
