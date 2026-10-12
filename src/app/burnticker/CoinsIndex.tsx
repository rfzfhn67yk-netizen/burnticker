"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { HostDiagnostics } from "./_components/HostDiagnostics";
import Link from "next/link";
import { EmptyState } from "./_components/EmptyState";
import { ViewCard, SkeletonGrid, ago } from "./_components/CoinCard";
import { useLaunchAvailability } from "./_components/useLaunchAvailability";
import { useHome } from "./_components/useHome";
import { SEASONS_LINKS } from "./_components/nav";
import { auditBadgeView } from "@/lib/burnticker/auditBadge";
import { GLOSSARY, NO_WALLET_LINE } from "@/lib/burnticker/glossary";
import { HERO, HOW_IT_WORKS, SEARCH } from "@/lib/burnticker/siteNav.mjs";
import { cardViewFromIndex, type CardView, type IndexCoin } from "@/lib/burnticker/cardView";

/**
 * THE HOME AND COINS PAGE (2026-10-10 launchpad conventions; list-first since 2026-10-12, the owner's review items 1, 5, 7, 8, 12, 13,
 * 15 and 18). What a launchpad visitor expects to land on: a one-line hero with one subline, a three-step "How it works" strip, then the
 * coin grid with its filter tabs and a search box above it, then a "Follow the season" preview. The grid leads with the featured cards
 * (src/lib/burnticker/home.ts: $DEFICIT, the $REHEARSAL rehearsal coin, the devnet rehearsal coin), then every registered coin, all in
 * the one card order (cardView.ts). No market caps, no trending, no movers: the cards report what the rule did and when the next result
 * lands. While the reads are out the grid shows skeleton cards, never placeholder text. The explainer lives at /burnticker/about.
 */
interface IndexToken extends IndexCoin { oracle: string; selectorKey: string; seriesTitle: string | null; mode: string; pctOfSupply: number; raised: string | null; threshold: string | null; quote: string | null }
interface PairSide { ticker: string; name: string; burns: number; burned: string; supply: string; lastBurnAt: string | null }
interface Index { tokens: IndexToken[]; pairs: { pairId: string; selectorKey: string; seriesTitle: string | null; a: PairSide; b: PairSide }[]; totals: { tokens: number; live: number; burns: number; burnedTokens: string; pairs: number }; audit: { ok: boolean; ranAt: string; receipts: number; mismatches: number; chainChecked: boolean } | null; cluster: string; stubs: string[] }
export interface SeasonsPreview { leagues: number; teamCoins: number; sports: { id: string; label: string; leagues: { id: string; label: string; href: string; coins: number }[] }[] }

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
const readQuery = () => { try { return new URLSearchParams(window.location.search).get("q") ?? ""; } catch { return ""; } };

export default function BurntickerIndex({ seasons }: { seasons: SeasonsPreview | null }) {
  const [ix, setIx] = useState<Index | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("new");
  const [q, setQ] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const home = useHome();
  const searchBox = useRef<HTMLInputElement>(null);
  useEffect(() => { fetch("/api/burnticker/tokens").then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? r.statusText); setIx(j); }).catch((e) => setErr(String(e.message ?? e))); }, []);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);
  useEffect(() => { try { const s = sessionStorage.getItem("bt-coins-tab") as Tab | null; if (s && TABS.some((x) => x.id === s)) setTab(s); } catch { /* private window */ } }, []);
  // the header search (?q= on arrival, or an in-place search event) and the phone tab bar's Search (#search focuses the box)
  useEffect(() => {
    setQ(readQuery());
    const onSearch = (e: Event) => { setQ(String((e as CustomEvent<string>).detail ?? "")); setTab("new"); };
    const onHash = () => { if (window.location.hash === "#search") { searchBox.current?.focus(); searchBox.current?.scrollIntoView({ block: "center" }); } };
    onHash();
    window.addEventListener("bt-search", onSearch); window.addEventListener("hashchange", onHash);
    return () => { window.removeEventListener("bt-search", onSearch); window.removeEventListener("hashchange", onHash); };
  }, []);
  const pick = (t: Tab) => { setTab(t); try { sessionStorage.setItem("bt-coins-tab", t); } catch { /* ignore */ } };

  const s = q.trim().toLowerCase();
  const featured: CardView[] = useMemo(() => (home.data?.featured ?? []).filter((v) => !s || `${v.ticker} ${v.name} ${v.rule} ${v.mint?.address ?? ""}`.toLowerCase().includes(s)), [home.data, s]);
  const coins = useMemo(() => {
    if (!ix) return [];
    const hit = (t: IndexToken) => !s || `${t.ticker} ${t.name} ${t.oneLiner} ${t.seriesTitle ?? ""} ${t.mint}`.toLowerCase().includes(s);
    const list = ix.tokens.filter((t) => t.status !== "expired" && hit(t));
    const launched = (t: IndexToken) => (t.launchedAt ? Date.parse(t.launchedAt) : -1);
    if (tab === "new") return [...list].sort((a, b) => launched(b) - launched(a) || a.ticker.localeCompare(b.ticker));
    if (tab === "next") return list.filter((t) => nextOf(t)).sort((a, b) => Date.parse(nextOf(a)!) - Date.parse(nextOf(b)!));
    if (tab === "graduating") return list.filter((t) => t.phase !== "graduated" && (t.progressPct ?? 0) >= 50).sort((a, b) => (b.progressPct ?? 0) - (a.progressPct ?? 0));
    if (tab === "graduated") return list.filter((t) => t.phase === "graduated");
    return [];
  }, [ix, tab, s]);
  const pairs = useMemo(() => (ix?.pairs ?? []).filter((p) => !s || `${p.a.ticker} ${p.b.ticker} ${p.a.name} ${p.b.name} ${p.seriesTitle ?? ""}`.toLowerCase().includes(s)), [ix, s]);
  const curveRead = !!ix?.tokens.some((t) => t.progressPct !== null || t.phase !== null);
  const audit = auditBadgeView(ix?.audit ?? null);
  const launch = useLaunchAvailability();
  // the grid: the featured cards lead the New tab; the other tabs filter the registered coins only
  const cards: CardView[] = [...(tab === "new" ? featured : []), ...coins.map((t) => cardViewFromIndex(t))];
  const loading = (!ix && !err) || (tab === "new" && !home.data && !home.error);

  return (
    <main className="mx-auto max-w-6xl px-4 py-5 space-y-6">
      <section className="bt-hero" aria-labelledby="bt-hero-h">
        <h1 id="bt-hero-h" className="bt-hero-title">{HERO.title}</h1>
        <p className="bt-hero-sub">{HERO.sub}</p>
      </section>

      <section aria-label="How it works">
        <ol className="bt-how">
          {HOW_IT_WORKS.map((h, i) => <li key={h.title}><span className="bt-how-n" aria-hidden="true">{i + 1}</span><div><p className="bt-how-t">{h.title}</p><p className="bt-how-x">{h.text}</p></div></li>)}
        </ol>
        <p className="mt-2 text-xs text-neutral-500"><Link className="underline" href="/burnticker/about">Read how it works in full</Link></p>
      </section>

      <section className="space-y-3" aria-labelledby="bt-coins-h">
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <h2 id="bt-coins-h" className="text-xl font-semibold">Coins</h2>
          <div className="bt-tabs" role="tablist" aria-label="Filter coins">
            {TABS.map((t) => <button key={t.id} role="tab" aria-selected={tab === t.id} title={t.hint} className={`bt-tab${tab === t.id ? " is-active" : ""}`} onClick={() => pick(t.id)}>{t.label}{t.id === "pairs" && ix ? <span className="bt-tab-count">{ix.pairs.length}</span> : null}</button>)}
          </div>
          <input id="search" ref={searchBox} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={`${SEARCH.placeholder}: name, $TICKER, team or mint`} aria-label={SEARCH.label} className="md:ml-auto w-full md:w-72 rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm" />
        </div>

        <p className="text-xs text-neutral-500">{NO_WALLET_LINE}</p>
        {err && <EmptyState kind="unavailable" body="The coin list could not be read just now." details={err} />}
        {home.error && tab === "new" && <EmptyState compact kind="unavailable" body="The featured coins could not be read just now." details={home.error} />}

        {tab !== "pairs" && (loading ? <SkeletonGrid n={3} /> : cards.length === 0 ? (
          <EmptyState kind={!s && ix && ix.tokens.length === 0 ? "not-launched" : "no-activity"} body={s ? <>No coin matches “{q}”.</> : tab === "graduating" ? <>No coin is past half its bonding curve.{!curveRead && " This site does not read curve progress, so this list stays empty."}</> : tab === "graduated" ? <>No coin has moved to a trading pool yet.</> : tab === "next" ? <>No scheduled result is known for any coin.</> : <>No coin is launched on this site yet.</>}>
            {launch.open && <div className="mt-3"><Link href="/burnticker/launch" className="underline">Launch the first one</Link></div>}
          </EmptyState>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {cards.map((v) => <ViewCard key={v.id} v={v} />)}
          </div>
        ))}

        {ix && tab === "pairs" && (
          pairs.length === 0 ? <EmptyState kind={ix.tokens.length === 0 ? "not-launched" : "no-activity"} body="No rivalry pair is launched on this site yet.">{launch.open && <p className="mt-2"><Link className="underline" href="/burnticker/launch?pair=1">Launch a pair</Link></p>}</EmptyState> : (
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
        {!ix && !err && tab === "pairs" && <SkeletonGrid n={2} label="Loading the pairs." />}
      </section>

      <SeasonsStrip seasons={seasons} />

      {ix && ix.tokens.length > 0 && (
        <section className="grid grid-cols-2 gap-3 md:grid-cols-4 pt-2" aria-label="Platform totals">
          {[["Live coins", String(ix.totals.live)], ["Burns", String(ix.totals.burns)], ["Tokens burned", fmt(ix.totals.burnedTokens)], ["Public audit", audit.text]].map(([k, v]) => (
            <div key={k} className="rounded-lg border border-neutral-800 bg-neutral-900 p-3"><div className="text-xs text-neutral-400">{k}</div><div className={`${k === "Public audit" && audit.tone === "muted" ? "text-sm" : "text-lg"} font-semibold ${k === "Public audit" ? (audit.tone === "ok" ? "text-emerald-400" : audit.tone === "bad" ? "text-red-400" : "text-neutral-400") : ""}`}>{v}</div>{k === "Public audit" && audit.sub && <div className="text-xs text-neutral-500">{audit.sub}</div>}</div>
          ))}
        </section>
      )}
      {ix && <p className="text-xs text-neutral-500">This site is showing {ix.cluster}. <Link className="underline" href="/burnticker/trust">What the operator can and cannot do</Link></p>}
      {ix && <HostDiagnostics stubs={ix.stubs} />}
    </main>
  );
}

/** "Follow the season" (review item 15): every league's current season, by sport, with the Seasons pages. Counts only, no ranking. */
function SeasonsStrip({ seasons }: { seasons: SeasonsPreview | null }) {
  return (
    <section className="bt-seasons" aria-labelledby="bt-seasons-h">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="bt-seasons-h" className="text-xl font-semibold">Follow the season</h2>
        <p className="text-sm">{SEASONS_LINKS.map((l, i) => <span key={l.href}>{i > 0 && " · "}<Link className="underline" href={l.href}>{l.label}</Link></span>)}</p>
      </div>
      {!seasons ? <p className="text-sm text-neutral-400">The leagues could not be read just now.</p> : <>
        <p className="text-sm text-neutral-400">{seasons.teamCoins === 0 ? `No team coin has launched yet, so all ${seasons.leagues} league scoreboards are empty. Each one fills in from its coins' own receipts.` : `${seasons.teamCoins} team coin${seasons.teamCoins === 1 ? " is" : "s are"} on the scoreboards of ${seasons.leagues} leagues. A board ranks a league's team coins by their receipts.`}</p>
        <dl className="mt-3 space-y-2 text-sm">{seasons.sports.map((sp) => (
          <div key={sp.id} className="sm:flex sm:gap-4">
            <dt className="font-medium text-neutral-200 sm:w-28 sm:shrink-0">{sp.label}</dt>
            <dd className="mt-1 sm:mt-0 flex flex-wrap gap-1.5">{sp.leagues.map((l) => <Link key={l.id} className="bt-tab" href={l.href}>{l.label}{l.coins > 0 && <span className="bt-tab-count">{l.coins}</span>}</Link>)}</dd>
          </div>
        ))}</dl>
      </>}
    </section>
  );
}
