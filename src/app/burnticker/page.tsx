"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CoinCard, ago, type CoinCardData } from "./_components/CoinCard";
import { useLaunchAvailability } from "./_components/useLaunchAvailability";
import { auditBadgeView } from "@/lib/burnticker/auditBadge";
import { GLOSSARY, NO_WALLET_LINE } from "@/lib/burnticker/glossary";
import { Term } from "./_components/Term";

/**
 * THE COINS PAGE (2026-10-10, launchpad conventions — docs/burnticker/ui-conventions.md): a grid of coin cards like pump.fun / bonk.fun /
 * Pons — image, name/$TICKER, the rule's one-liner, the bonding curve as SOL raised of the graduation threshold, burns + last burn, the
 * next result, the venue chip — with the tabs a launchpad user expects (New · Next to settle · About to graduate · Graduated · Pairs),
 * a search box, and "Launch a coin" where pump.fun puts "create coin". No market caps, no trending, no movers: the cards report what the
 * rule did and when the next result lands. The platform tiles (burns, audit) sit under the grid.
 */
interface IndexToken { ticker: string; name: string; mint: string; oracle: string; selectorKey: string; seriesTitle: string | null; mode: string; status: string; launchedAt: string | null; burned: string; burns: number; pctOfSupply: number; nextCheckAt: string | null; nextCloseTime: string | null; pairId: string | null; imageUrl: string | null; oneLiner: string; badge?: string | null; lastBurnAt: string | null; phase: CoinCardData["phase"]; progressPct: number | null; raised: string | null; threshold: string | null; quote: string | null }
interface PairSide { ticker: string; name: string; burns: number; burned: string; supply: string; lastBurnAt: string | null }
interface Index { tokens: IndexToken[]; pairs: { pairId: string; selectorKey: string; seriesTitle: string | null; a: PairSide; b: PairSide }[]; totals: { tokens: number; live: number; burns: number; burnedTokens: string; pairs: number }; audit: { ok: boolean; ranAt: string; receipts: number; mismatches: number; chainChecked: boolean } | null; cluster: string; stubs: string[] }

type Tab = "new" | "next" | "graduating" | "graduated" | "pairs";
const TABS: { id: Tab; label: string; hint: string }[] = [
  { id: "new", label: "New", hint: "newest launches first" },
  { id: "next", label: "Next to settle", hint: "soonest result first" },
  { id: "graduating", label: "About to graduate", hint: "past half of the bonding curve" },
  { id: "graduated", label: "Moved to trading pool", hint: GLOSSARY.graduation.short },
  { id: "pairs", label: "Pairs", hint: "two coins, one matchup" },
];
const fmt = (s: string) => s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const nextOf = (t: IndexToken) => t.nextCloseTime ?? t.nextCheckAt;

export default function BurntickerIndex() {
  const [ix, setIx] = useState<Index | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("new");
  const [q, setQ] = useState("");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { fetch("/api/burnticker/tokens").then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? r.statusText); setIx(j); }).catch((e) => setErr(String(e.message ?? e))); }, []);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);
  useEffect(() => { try { const s = sessionStorage.getItem("bt-coins-tab") as Tab | null; if (s && TABS.some((x) => x.id === s)) setTab(s); } catch { /* private window */ } }, []);
  const pick = (t: Tab) => { setTab(t); try { sessionStorage.setItem("bt-coins-tab", t); } catch { /* ignore */ } };

  const coins = useMemo(() => {
    if (!ix) return [];
    const s = q.trim().toLowerCase();
    const hit = (t: IndexToken) => !s || `${t.ticker} ${t.name} ${t.oneLiner} ${t.seriesTitle ?? ""} ${t.mint}`.toLowerCase().includes(s);
    const list = ix.tokens.filter((t) => t.status !== "expired" && hit(t));
    const launched = (t: IndexToken) => (t.launchedAt ? Date.parse(t.launchedAt) : -1);
    if (tab === "new") return [...list].sort((a, b) => launched(b) - launched(a) || a.ticker.localeCompare(b.ticker));
    if (tab === "next") return list.filter((t) => nextOf(t)).sort((a, b) => Date.parse(nextOf(a)!) - Date.parse(nextOf(b)!));
    if (tab === "graduating") return list.filter((t) => t.phase !== "graduated" && (t.progressPct ?? 0) >= 50).sort((a, b) => (b.progressPct ?? 0) - (a.progressPct ?? 0));
    if (tab === "graduated") return list.filter((t) => t.phase === "graduated");
    return [];
  }, [ix, tab, q]);
  const pairs = useMemo(() => (ix?.pairs ?? []).filter((p) => { const s = q.trim().toLowerCase(); return !s || `${p.a.ticker} ${p.b.ticker} ${p.a.name} ${p.b.name} ${p.seriesTitle ?? ""}`.toLowerCase().includes(s); }), [ix, q]);
  const curveRead = !!ix?.tokens.some((t) => t.progressPct !== null || t.phase !== null);
  const audit = auditBadgeView(ix?.audit ?? null);
  const launch = useLaunchAvailability();

  return (
    <main className="mx-auto max-w-6xl px-4 py-5 space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">Coins</h1>
          <p className="text-sm text-neutral-400">Memecoins whose supply <Term id="burn">burns</Term> when a settled, public result says so. Every burn is a <Term id="receipt" />.</p>
        </div>
        {launch.open && <Link href="/burnticker/launch" className="bt-launch-btn">Launch a coin</Link>}
      </header>
      {!launch.open && <p className="text-sm text-neutral-300" data-launches-closed>{launch.closedLine} {NO_WALLET_LINE}</p>}
      {launch.open && <p className="text-xs text-neutral-500">{NO_WALLET_LINE}</p>}

      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="bt-tabs" role="tablist" aria-label="Filter coins">
          {TABS.map((t) => <button key={t.id} role="tab" aria-selected={tab === t.id} title={t.hint} className={`bt-tab${tab === t.id ? " is-active" : ""}`} onClick={() => pick(t.id)}>{t.label}{t.id === "pairs" && ix ? <span className="bt-tab-count">{ix.pairs.length}</span> : null}</button>)}
        </div>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search coins: name, $TICKER, team, mint…" aria-label="Search coins" className="md:ml-auto w-full md:w-72 rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm" />
      </div>

      {err && <p className="text-red-400 text-sm">{err}</p>}
      {!ix && !err && <p className="text-sm text-neutral-500">Loading coins…</p>}

      {ix && tab !== "pairs" && (
        coins.length === 0 ? (
          <div className="rounded-lg border border-dashed border-neutral-700 p-6 text-center text-sm text-neutral-400">
            {q ? <>No coin matches “{q}”.</> : tab === "graduating" ? <>No coin is past half its bonding curve.{!curveRead && " Curve progress is not read on this host, so this list stays empty."}</> : tab === "graduated" ? <>No coin has moved to a trading pool yet.</> : tab === "next" ? <>No scheduled result is known for any coin.</> : <>No coins yet.</>}
            {launch.open && <div className="mt-3"><Link href="/burnticker/launch" className="underline">Launch the first one →</Link></div>}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {coins.map((t) => <CoinCard key={t.mint} now={now} href={`/burnticker/t/${t.ticker}`} c={{ ticker: t.ticker, name: t.name, imageUrl: t.imageUrl, oneLiner: t.oneLiner, oracle: t.oracle, status: t.status, phase: t.phase, progressPct: t.progressPct, raised: t.raised, threshold: t.threshold, quote: t.quote, burns: t.burns, lastBurnAt: t.lastBurnAt, nextAt: nextOf(t), launchedAt: t.launchedAt, pairId: t.pairId, badge: t.badge ?? null }} />)}
          </div>
        )
      )}

      {ix && tab === "pairs" && (
        pairs.length === 0 ? <div className="rounded-lg border border-dashed border-neutral-700 p-6 text-center text-sm text-neutral-400">No rivalry pairs yet.{launch.open && <> <Link className="underline" href="/burnticker/launch?pair=1">Launch a pair →</Link></>}</div> : (
          <div className="grid gap-3 md:grid-cols-2">
            {pairs.map((p) => (
              <Link key={p.pairId} href={`/burnticker/p/${encodeURIComponent(p.pairId)}`} className="bt-coin-card block">
                <div className="text-xs text-neutral-500 truncate">{p.seriesTitle ?? p.selectorKey}</div>
                <div className="mt-1 flex items-center justify-between gap-2 font-mono">
                  <span className="text-lg font-semibold">${p.a.ticker}</span>
                  <span className="text-2xl tabular-nums">{p.a.burns} <span className="text-neutral-500">:</span> {p.b.burns}</span>
                  <span className="text-lg font-semibold">${p.b.ticker}</span>
                </div>
                <div className="mt-1 flex justify-between text-[11px] text-neutral-500"><span>last burn {ago(p.a.lastBurnAt, now)}</span><span>burns</span><span>last burn {ago(p.b.lastBurnAt, now)}</span></div>
              </Link>
            ))}
          </div>
        )
      )}

      {ix && (
        <section className="grid grid-cols-2 gap-3 md:grid-cols-4 pt-2" aria-label="Platform totals">
          {[["Live coins", String(ix.totals.live)], ["Burns", String(ix.totals.burns)], ["Tokens burned", fmt(ix.totals.burnedTokens)], ["Public audit", audit.text]].map(([k, v]) => (
            <div key={k} className="rounded-lg border border-neutral-800 bg-neutral-900 p-3"><div className="text-xs text-neutral-400">{k}</div><div className={`${k === "Public audit" && audit.tone === "muted" ? "text-sm" : "text-lg"} font-semibold ${k === "Public audit" ? (audit.tone === "ok" ? "text-emerald-400" : audit.tone === "bad" ? "text-red-400" : "text-neutral-400") : ""}`}>{v}</div>{k === "Public audit" && audit.sub && <div className="text-xs text-neutral-500">{audit.sub}</div>}</div>
          ))}
        </section>
      )}
      {ix && <p className="text-xs text-neutral-500">{ix.cluster} · {ix.stubs.length ? `On this host: ${ix.stubs.join(" · ")}` : ""} <Link className="underline" href="/burnticker/trust">What the operator can and cannot do</Link></p>}
      <p className="text-xs text-neutral-500">A memecoin. The rule says what the supply does, not what the price does. Nobody is promised anything.</p>
    </main>
  );
}
