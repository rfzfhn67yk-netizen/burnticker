"use client";

import { useState } from "react";
import { CARD_LABELS, CARD_MEANINGS, RANK_MEANING, ageText, cardViewFromIndex, curveLine, emptyLabel, initialsOf, type CardCell, type CardView } from "@/lib/burnticker/cardView";
import { ProgressStrip } from "./ProgressStrip";
import { FollowButton } from "./FollowButton";
import { Why } from "./Why";

/**
 * THE COIN CARD (2026-10-10, launchpad conventions — docs/burnticker/ui-conventions.md; the full field set since website-13, 2026-10-12,
 * including the market cap by owner decision). ViewCard prints cardView.ts's fixed rows; the market cap is a bare number read from the
 * curve, with no arrow and no commentary. Every number not read reads "—" with a reason on hover. Also used as the wizard's live preview
 * (href null). No state but a broken-image fallback and the time the card was read.
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

/**
 * A coin without an image of its own (or whose image fails to load) gets a deliberate receipt-style identity instead of "NO IMAGE"
 * (ChatGPT audit 6 A11, Claude site audit 2 item 2f): the wordmark, the coin's initials large, a torn rule and its $TICKER.
 */
export function ReceiptThumb({ ticker, size = 88 }: { ticker: string; size?: number }) {
  return (
    <div aria-hidden="true" className="bt-thumb-receipt shrink-0" style={{ width: size, height: size }} data-thumb="receipt">
      <span className="bt-thumb-top">BURNTICKER</span>
      <span className="bt-thumb-ticker" style={{ fontSize: Math.max(14, Math.round(size / 2.6)) }}>{initialsOf(ticker || "TICKER")}</span>
      <span className="bt-thumb-rule" />
      <span className="bt-thumb-top">${ticker || "TICKER"}</span>
    </div>
  );
}

export function CoinThumb({ src, ticker, size = 88, generated = false }: { src: string | null; ticker: string; size?: number; generated?: boolean }) {
  const [broken, setBroken] = useState(false);
  // no image of its own: the coin's generated image (coinArt.ts, GET /burnticker/img/<TICKER>.png) when it is registered; else the receipt
  // ChatGPT audit 6 item 23: a same-origin image (/burnticker/img/…, /burnticker/brand/…, $DEFICIT's art) is shown as is, so the app and
  // the static home print the one image a card names, never the generated initials instead
  const url = src && /^https:\/\//.test(src) ? src : src && /^\/burnticker\/(img|brand)\/[\w.-]+$/.test(src) ? src : generated && /^[A-Z0-9]{2,10}$/.test(ticker) ? `/burnticker/img/${ticker}.svg` : null;
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
 * One field: its text, or, when it was not read, what that means in words ("Not created yet", "No data yet"; cardView.ts emptyLabel,
 * ChatGPT audit 6 item 23) with its reason behind a tap or focus (website-15 item 7: Why.tsx; never inline, never on hover only).
 */
function Cell({ c, v }: { c: CardCell; v: Pick<CardView, "tags"> }) {
  if (c.text !== null) return <span title={c.why ?? undefined}>{c.text}</span>;
  return <Why label={emptyLabel(v, c.why)} why={c.why ?? "This site has no reading for this field."} />;
}

/**
 * THE CARD, ONE FIELD ORDER (website-13, 2026-10-12; Claude site audit 2 item 7, ChatGPT audit 6 A10): image, name, $TICKER, badge, the
 * rule in one line, the next result, the curve as "X / <raise> SOL raised", market cap, holders, age, burned with its share of supply,
 * then "Check receipt". Every row is always printed; a field not read is "—" with its reason. The order is cardView.ts CARD_ROWS; the
 * static home page prints the same rows from the same JSON. The name and the image link the coin's page; "Check receipt" is its own
 * link to that coin's newest receipt, shown disabled with the reason until there is one.
 */
export function ViewCard({ v, headingLevel = 3, now }: { v: CardView; headingLevel?: 2 | 3; now?: number }) {
  const H = headingLevel === 2 ? "h2" : "h3";
  const pct = v.curve.pct === null ? null : Math.max(0, Math.min(100, v.curve.pct));
  const [t] = useState(() => now ?? Date.now());
  const age = ageText(v.createdAt, t);
  return (
    <article className={`bt-coin-card${v.tags.some((x) => x.tone === "featured") ? " is-featured" : ""}`} data-card={v.id} data-group={v.group}>
      <div className="flex gap-3">
        <div data-row="image">{v.href ? <a href={v.href} tabIndex={-1} aria-hidden="true"><CoinThumb src={v.imageUrl} ticker={v.ticker} size={64} /></a> : <CoinThumb src={v.imageUrl} ticker={v.ticker} size={64} />}</div>
        <div className="min-w-0 flex-1">
          <H className="text-base font-semibold leading-tight">
            {v.href
              ? <a className="bt-card-link" href={v.href}><span className="bt-card-name" data-row="name">{v.name}</span> <span className="bt-card-ticker" data-row="ticker">${v.ticker}</span></a>
              : <><span className="bt-card-name" data-row="name">{v.name}</span> <span className="bt-card-ticker" data-row="ticker">${v.ticker}</span></>}
          </H>
          <div className="mt-1 flex flex-wrap gap-1.5" data-row="badge">{v.tags.map((x) => <span key={x.label} className={`bt-chip bt-tag-${x.tone}`}>{x.label}</span>)}</div>
          {v.note && <p className="mt-1 text-xs text-neutral-400">{v.note}</p>}
        </div>
      </div>
      <dl className="bt-card-rows">
        <div data-row="progress"><dt title={CARD_MEANINGS.progress}>{CARD_LABELS.progress}</dt><dd>{v.progress ? <ProgressStrip p={v.progress} compact /> : <Cell v={v} c={{ text: null, why: v.progressWhy }} />}</dd></div>
        <div data-row="rule"><dt>{CARD_LABELS.rule}</dt><dd>{v.rule}{v.stated && <span className="mt-1 block text-xs text-neutral-400" data-stated>{v.stated}</span>}{v.creatorText && <span className="mt-1 block text-xs text-neutral-300" data-creator-text>{v.creatorText}</span>}{v.links && v.links.length > 0 && <span className="mt-1 flex flex-wrap gap-2 text-xs" data-creator-links>{v.links.map((l) => <a key={l.url} className="underline" href={l.url} rel="nofollow noopener ugc" target="_blank">{l.label}</a>)}</span>}</dd></div>
        <div data-row="nextSettle"><dt>{CARD_LABELS.nextSettle}</dt><dd><Cell v={v} c={v.nextSettle} /></dd></div>
        <div data-row="curve"><dt title={CARD_MEANINGS.curve}>{CARD_LABELS.curve}</dt><dd>
          {/* website-15 item 7: a curve not read is "— raised" with the dash as the reason's button; "not applicable" carries its reason the same way */}
          <span>{v.curve.na ? <Why label="Not applicable" why={v.curve.why} /> : v.curve.raised === null && v.curve.why ? <Why label={emptyLabel(v, v.curve.why)} why={v.curve.why} /> : v.curve.of === null && v.curve.why ? <>{curveLine(v.curve)} <Why why={v.curve.why} label="" name="Why the raise is not shown" /></> : curveLine(v.curve)}</span>
          <span className="bt-curve mt-1 block" role="progressbar" aria-label="Curve progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined} aria-valuetext={pct === null ? "Not read" : `${pct.toFixed(0)}%`}><span className={`bt-curve-fill block${v.curve.done ? " is-done" : ""}`} style={{ width: `${pct ?? 0}%` }} /></span>
        </dd></div>
        <div data-row="mcap"><dt title={CARD_MEANINGS.mcap}>{CARD_LABELS.mcap}</dt><dd><Cell v={v} c={v.mcap} /></dd></div>
        <div data-row="holders"><dt title={CARD_MEANINGS.holders}>{CARD_LABELS.holders}</dt><dd><Cell v={v} c={v.holders} /></dd></div>
        <div data-row="age"><dt>{CARD_LABELS.age}</dt><dd><Cell v={v} c={{ text: age, why: age ? null : v.createdWhy }} /></dd></div>
        <div data-row="burned"><dt title={CARD_MEANINGS.burned}>{CARD_LABELS.burned}</dt><dd><Cell v={v} c={v.burned} />{v.rank && <span className="mt-0.5 block text-xs text-neutral-400" data-rank title={RANK_MEANING}>{v.rank}</span>}</dd></div>
      </dl>
      <div className="bt-card-foot" data-row="receipt">
        {v.receipt ? <a className="bt-ghost-btn" href={v.receipt.href} title={CARD_MEANINGS.receipt}>Check receipt</a> : <><span className="bt-ghost-btn is-disabled" aria-disabled="true" title={v.receiptWhy ?? undefined}>Check receipt</span><span className="text-xs text-neutral-500">{v.receiptWhy}</span></>}
        {(v.group === "public" || v.id === "deficit") && v.watchKey ? <span className="ml-auto"><FollowButton watchKey={v.watchKey} ticker={v.ticker} /></span> : null}
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
            <h3 className="mt-1 flex min-w-0 items-baseline gap-1 text-base font-semibold leading-tight"><span className="min-w-0 truncate">{c.name || "Coin name"}</span> <span className="shrink-0 font-mono text-sm text-neutral-400">${c.ticker || "TICKER"}</span></h3>
          </div>
        </div>
        <dl className="bt-card-rows"><div data-row="rule"><dt>Rule</dt><dd>{asSentence(c.oneLiner)}</dd></div></dl>
      </article>
    );
  }
  return <ViewCard v={cardViewFromIndex({ ticker: c.ticker, name: c.name, mint: c.ticker, oneLiner: c.oneLiner, status: c.status, imageUrl: c.imageUrl, burned: c.burned ?? "0", burns: c.burns, nextCheckAt: c.nextAt, nextCloseTime: null, lastBurnAt: c.lastBurnAt, launchedAt: c.launchedAt, pairId: c.pairId ?? null, badge: c.badge ?? null, phase: c.phase, progressPct: c.progressPct, raised: c.raised, threshold: c.threshold, quote: c.quote }, c.threshold)} />;
}
