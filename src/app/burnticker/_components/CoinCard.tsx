"use client";

import { useState } from "react";
import Link from "next/link";

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
  /** Why the curve shows "—" (hover text). */
  curveNote?: string;
}

const VENUE: Record<string, string> = { kalshi: "Kalshi", polymarket: "Polymarket", catalogue: "Feed" };

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

export function CoinThumb({ src, ticker, size = 88 }: { src: string | null; ticker: string; size?: number }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken || !/^https:\/\//.test(src)) return <ReceiptThumb ticker={ticker} size={size} />;
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
  const label = c.phase === "graduated" ? "graduated · trades on Raydium" : c.phase === "migrating" ? "curve complete · migrating" : pct === null ? "bonding curve —" : `bonding curve ${pct.toFixed(pct < 10 ? 1 : 0)}%`;
  const detail = c.phase === "graduated" ? null : c.raised !== null && c.threshold !== null ? `${roundStr(c.raised)} / ${roundStr(c.threshold)} ${c.quote ?? "SOL"}` : null;
  return (
    <div title={pct === null && c.phase !== "graduated" ? (c.curveNote || "curve progress is not read on this host") : undefined}>
      <div className={`flex items-baseline justify-between gap-2 ${compact ? "text-[11px]" : "text-xs"} text-neutral-400`}>
        <span className="font-mono uppercase tracking-wide">{label}</span>{detail && <span className="tabular-nums">{detail}</span>}
      </div>
      <div className="bt-curve mt-1" role="progressbar" aria-label="bonding curve progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined}>
        <div className={`bt-curve-fill${c.phase === "graduated" ? " is-done" : ""}`} style={{ width: `${c.phase === "graduated" ? 100 : pct ?? 0}%` }} />
      </div>
    </div>
  );
}

export function CoinCard({ c, href, now }: { c: CoinCardData; href: string | null; now?: number }) {
  const t = now ?? Date.now();
  const body = (
    <article className="bt-coin-card">
      <div className="flex gap-3">
        <CoinThumb src={c.imageUrl} ticker={c.ticker} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <VenueChip oracle={c.oracle} />
            {c.phase === "graduated" && <span className="bt-chip bt-chip-grad">graduated</span>}
            {c.status === "draft" && <span className="bt-chip bt-chip-draft" title="registered, not launched: nothing trades yet">draft</span>}
            {c.pairId && <span className="bt-chip">pair</span>}
            <span className="ml-auto text-[11px] text-neutral-500" title={c.launchedAt ?? "not launched"}>{c.launchedAt ? ago(c.launchedAt, t) : "not launched"}</span>
          </div>
          <h3 className="mt-1 truncate text-base font-semibold leading-tight">{c.name || "Coin name"} <span className="font-mono text-sm text-neutral-400">${c.ticker || "TICKER"}</span></h3>
          <p className="mt-0.5 line-clamp-2 text-sm text-neutral-300">{c.oneLiner}</p>
        </div>
      </div>
      <div className="mt-3"><CurveBar c={c} compact /></div>
      <dl className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
        <div><dt className="text-neutral-500">burns</dt><dd className="font-mono tabular-nums text-neutral-200">{c.burns}</dd></div>
        <div><dt className="text-neutral-500">last burn</dt><dd className="font-mono text-neutral-200">{ago(c.lastBurnAt, t)}</dd></div>
        <div><dt className="text-neutral-500">next result</dt><dd className="font-mono text-neutral-200" title={c.nextAt ?? "no scheduled result known"}>{until(c.nextAt, t)}</dd></div>
      </dl>
    </article>
  );
  return href ? <Link href={href} className="block rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--bt-stamp,#9b84e6)]">{body}</Link> : body;
}
