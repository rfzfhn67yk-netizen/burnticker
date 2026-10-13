"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { HostDiagnostics } from "./_components/HostDiagnostics";
import Link from "next/link";
import { EmptyState } from "./_components/EmptyState";
import { ViewCard, SkeletonGrid, ago } from "./_components/CoinCard";
import { useLaunchAvailability } from "./_components/useLaunchAvailability";
import { useHome } from "./_components/useHome";
import { useWatchlist } from "./_components/useWatchlist";
import { useScrollEdges } from "./_components/useScrollEdges";
import { WATCH_FORGET, WATCH_NOTE, coinWatchKey, watchAmbiguous, type ListedCoin } from "@/lib/burnticker/watchlist";
import { SEASONS_LINKS } from "./_components/nav";
import { auditBadgeView } from "@/lib/burnticker/auditBadge";
import { SEARCH } from "@/lib/burnticker/siteNav.mjs";
import { CARD_MEANINGS, cardViewFromIndex, featuredLine, type CardView, type IndexCoin } from "@/lib/burnticker/cardView";
import { GRID_TABS, gridState, tabCoins, type GridTab } from "@/lib/burnticker/coinsGrid";
import { FEATURED_RULES_LINE } from "@/lib/burnticker/featuredSlots";
import { sharedTickers } from "@/lib/burnticker/coinKey";

/**
 * THE COINS PAGE (/burnticker; list-first since 2026-10-12: Claude site audit 2 item 5, ChatGPT audit 6 A5 and A10, Codex review 5
 * trader-2). It starts at the Coins heading, the filter tabs and (on phones) the search box; the hero and "How it works" live on the home
 * page (/) only. Two visibly separate groups: the coins anyone can trade, filtered by the tabs (coinsGrid.ts holds each tab's rule and
 * its loading, empty, unavailable, stale and error sentences), then "Featured coin and test receipts" ($DEFICIT, the disclosed
 * rehearsal coin and the devnet rehearsal, home.ts), which the tabs never filter. Every card prints the one field order (cardView.ts).
 * While the reads are out the grid shows skeleton cards, never placeholder text. One search box per screen: the header's on wider
 * screens, this page's on phones.
 */
interface IndexToken extends IndexCoin { oracle: string; selectorKey: string; seriesTitle: string | null; mode: string; pctOfSupply: number; raised: string | null; threshold: string | null; quote: string | null }
interface PairSide { ticker: string; name: string; burns: number; burned: string; supply: string; lastBurnAt: string | null }
interface Index { generatedAt?: string; tokens: IndexToken[]; pairs: { pairId: string; selectorKey: string; seriesTitle: string | null; a: PairSide; b: PairSide }[]; totals: { tokens: number; live: number; burns: number; burnedTokens: string; pairs: number }; audit: { ok: boolean; ranAt: string; receipts: number; mismatches: number; chainChecked: boolean } | null; cluster: string; stubs: string[] }
export interface SeasonsPreview { leagues: number; teamCoins: number; sports: { id: string; label: string; leagues: { id: string; label: string; href: string; coins: number }[] }[] }

const fmt = (s: string) => s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const readQuery = () => { try { return new URLSearchParams(window.location.search).get("q") ?? ""; } catch { return ""; } };

export default function BurntickerIndex({ seasons }: { seasons: SeasonsPreview | null }) {
  const [ix, setIx] = useState<Index | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<GridTab>("new");
  const [q, setQ] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const home = useHome();
  const searchBox = useRef<HTMLInputElement>(null);
  // ChatGPT audit 6 item 24: the filter row scrolls sideways on narrow screens; the edge that still has more fades
  const tabsHint = useScrollEdges<HTMLDivElement>([ix]);
  useEffect(() => { fetch("/api/burnticker/tokens").then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? r.statusText); setIx(j); }).catch((e) => setErr(String(e.message ?? e))); }, []);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);
  useEffect(() => { try { const s = sessionStorage.getItem("bt-coins-tab") as GridTab | null; if (s && GRID_TABS.some((x) => x.id === s)) setTab(s); } catch { /* private window */ } }, []);
  // the header search (?q= on arrival, or an in-place search event) and the phone tab bar's Search (#search focuses the box)
  useEffect(() => {
    setQ(readQuery());
    // website-15 item 5: the header box and this box are one search; the header sends "bt-search" (Enter) and "bt-search-input" (typing)
    const onSearch = (e: Event) => { setQ(String((e as CustomEvent<string>).detail ?? "")); setTab("new"); };
    const onInput = (e: Event) => setQ(String((e as CustomEvent<string>).detail ?? ""));
    const onHash = () => { if (window.location.hash !== "#search") return; const box = searchBox.current && searchBox.current.offsetParent !== null ? searchBox.current : document.getElementById("bt-header-q"); box?.focus(); box?.scrollIntoView({ block: "center" }); };
    onHash();
    window.addEventListener("bt-search", onSearch); window.addEventListener("bt-search-input", onInput); window.addEventListener("hashchange", onHash);
    return () => { window.removeEventListener("bt-search", onSearch); window.removeEventListener("bt-search-input", onInput); window.removeEventListener("hashchange", onHash); };
  }, []);
  // typing here updates the header box and the address (?q=), so a reload or a shared link keeps the same search
  const typeQuery = (v: string) => {
    setQ(v);
    try { const u = new URL(window.location.href); if (v.trim()) u.searchParams.set("q", v); else u.searchParams.delete("q"); window.history.replaceState(null, "", u.pathname + u.search + u.hash); } catch { /* ignore */ }
    window.dispatchEvent(new CustomEvent("bt-search-sync", { detail: v }));
  };
  const pick = (t: GridTab) => { setTab(t); try { sessionStorage.setItem("bt-coins-tab", t); } catch { /* ignore */ } };

  const s = q.trim().toLowerCase();
  const featured: CardView[] = useMemo(() => (home.data?.featured ?? []).filter((v) => !s || `${v.ticker} ${v.name} ${v.rule} ${v.mint?.address ?? ""}`.toLowerCase().includes(s)), [home.data, s]);
  const listable = useMemo(() => (ix?.tokens ?? []).filter((t) => t.status !== "expired"), [ix]);
  // private review 8 F1: follows are by network and mint; old ticker follows resolve against the listed coins only when one coin matches
  const listedCoins: ListedCoin[] | null = useMemo(() => (ix ? listable.map((t) => ({ ticker: t.ticker, network: ix.cluster, mint: t.mint })) : null), [ix, listable]);
  const watch = useWatchlist(listedCoins);
  // tickers are not unique (owner 2026-10-12): a coin whose ticker another coin shares links by its mint
  const sharedSet = useMemo(() => sharedTickers(listable), [listable]);
  const coins = useMemo(() => tabCoins(tab, listable.filter((t) => !s || `${t.ticker} ${t.name} ${t.oneLiner} ${t.seriesTitle ?? ""} ${t.mint}`.toLowerCase().includes(s)), (t) => { const k = coinWatchKey(ix?.cluster, t.mint); return !!k && watch.list.coins.includes(k); }), [listable, tab, s, watch.list.coins, ix?.cluster]);
  const pairs = useMemo(() => (ix?.pairs ?? []).filter((p) => !s || `${p.a.ticker} ${p.b.ticker} ${p.a.name} ${p.b.name} ${p.seriesTitle ?? ""}`.toLowerCase().includes(s)), [ix, s]);
  const audit = auditBadgeView(ix?.audit ?? null);
  const launch = useLaunchAvailability();
  // website-17 wiring item 3: the earned slots lead the public grid in rule order, each tagged with its rule's label; the rest keep their order
  const slots = home.data?.featuredSlots ?? [];
  const cards: CardView[] = coins.map((t) => cardViewFromIndex(t, null, ix?.cluster ?? "mainnet", sharedSet)).map((v) => { const sl = slots.find((x) => x.ticker === v.ticker); return sl && v.group === "public" ? { ...v, tags: [{ label: sl.label, tone: "featured" as const }, ...v.tags] } : v; })
    .sort((a, b) => { const r = (v: CardView) => { const k = v.group === "public" ? slots.findIndex((x) => x.ticker === v.ticker) : -1; return k < 0 ? slots.length : k; }; return r(a) - r(b); });
  const state = gridState({ tab, loading: !ix, error: err, all: tab === "pairs" ? (ix?.pairs ?? []).map((p) => ({ ticker: p.a.ticker, phase: null, progressPct: null, nextCheckAt: null, nextCloseTime: null, launchedAt: null, status: "live" })) : listable, shown: tab === "pairs" ? pairs.length : cards.length, query: q, generatedAt: ix?.generatedAt ?? null, now, featuredMatches: s ? featured.length : 0 });
  const rule = GRID_TABS.find((t) => t.id === tab)!.rule;

  return (
    <main className="mx-auto max-w-6xl px-4 py-5 space-y-6">
      <section className="space-y-3" aria-labelledby="bt-coins-h">
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <h1 id="bt-coins-h" className="text-xl font-semibold">Coins</h1>
          <div ref={tabsHint.ref} onScroll={tabsHint.onScroll} className={`bt-tabs ${tabsHint.className}`} role="tablist" aria-label="Filter coins">
            {GRID_TABS.map((t) => <button key={t.id} role="tab" aria-selected={tab === t.id} aria-controls="bt-coins-panel" title={t.rule} className={`bt-tab${tab === t.id ? " is-active" : ""}`} onClick={() => pick(t.id)}>{t.label}{t.id === "pairs" && ix ? <> <span className="bt-tab-count" aria-label={`${ix.pairs.length} pair${ix.pairs.length === 1 ? "" : "s"}`}>{ix.pairs.length}</span></> : null}</button>)}
          </div>
          {/* one search per screen: the header carries it from 640 px up; on phones this box is the search (the tab bar's Search focuses it) */}
          <input id="search" ref={searchBox} type="search" value={q} onChange={(e) => typeQuery(e.target.value)} placeholder={SEARCH.placeholder} aria-label={SEARCH.label} className="bt-grid-search md:ml-auto w-full md:w-72 rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm" />
        </div>
        <p className="text-xs text-neutral-500" id="bt-tab-rule">{rule}{tab === "following" ? ` ${WATCH_NOTE}` : ""}{tab !== "pairs" ? " Each coin's curve completes at the raise its creator chose, and the card reads it from the coin's own pool." : ""}</p>

        <div id="bt-coins-panel" role="tabpanel" aria-describedby="bt-tab-rule" data-grid-state={state.kind}>
          {tab === "following" && watch.ambiguous.filter((a) => a.kind === "coins").map((a) => (
            <div key={a.ticker} className="mb-3 rounded-md border border-amber-700/60 p-3 text-xs" role="status" data-watch-ambiguous={a.ticker}>
              <p>{watchAmbiguous(a.ticker, a.candidates.length)}</p>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">{listable.filter((t) => t.ticker.toUpperCase() === a.ticker).map((t) => <ViewCard key={t.mint} v={cardViewFromIndex(t, null, ix?.cluster ?? "mainnet", sharedSet)} now={now} />)}</div>
              <button type="button" className="bt-watch mt-2" onClick={() => watch.forget("coins", a.ticker)}>{WATCH_FORGET}</button>
            </div>
          ))}
          {state.kind === "loading" && <SkeletonGrid n={3} label={tab === "pairs" ? "Loading the pairs." : "Loading the coins."} />}
          {state.kind === "error" && <EmptyState kind="unavailable" body={state.body} details={state.details} />}
          {state.kind === "unavailable" && <EmptyState kind="unavailable" body={state.body} />}
          {state.kind === "empty" && <EmptyState compact kind={state.notLaunched ? "not-launched" : "no-activity"} body={state.body}>{state.notLaunched && launch.open && <div className="mt-2"><Link href={tab === "pairs" ? "/burnticker/launch?pair=1" : "/burnticker/launch"} className="underline">{tab === "pairs" ? "Launch a pair" : "Launch the first one"}</Link></div>}</EmptyState>}
          {state.kind === "results" && <>
            {state.note && <p className="mb-2 text-xs text-amber-300" role="status">{state.note}</p>}
            {tab !== "pairs" && <p className="mb-2 text-xs text-neutral-400" data-featured-rules>{FEATURED_RULES_LINE}</p>}
            {tab !== "pairs" ? (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{cards.map((v) => <ViewCard key={v.id} v={v} now={now} />)}</div>
            ) : (
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
            )}
          </>}
          {tab === "graduating" && state.kind === "results" && ix?.generatedAt && <p className="mt-2 text-xs text-neutral-500">Curves read at {ix.generatedAt.slice(11, 16)} UTC.</p>}
        </div>
      </section>

      {/* A10: demos and rehearsals are a separate group from the coins anyone can trade; the tabs never filter it */}
      <section className="space-y-3" aria-labelledby="bt-featured-h" data-group="test">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="bt-featured-h" className="text-lg font-semibold">Featured coin and test receipts</h2>
          <details className="text-xs text-neutral-400"><summary className="cursor-pointer">What the card rows mean</summary>
            <ul className="mt-1 max-w-xl list-disc space-y-1 pl-4">{Object.values(CARD_MEANINGS).map((m) => <li key={m}>{m}</li>)}</ul>
          </details>
        </div>
        {/* ChatGPT audit 6 item 22: the sentence counts the cards this host serves (cardView.ts featuredLine), never a fixed "two" */}
        {home.data && featuredLine(home.data.featured) && <p className="text-xs text-neutral-500" data-featured-line>{featuredLine(home.data.featured)}</p>}
        {home.error ? <EmptyState compact kind="unavailable" body="The featured coins could not be read just now." details={home.error} />
          : !home.data ? <SkeletonGrid n={3} label="Loading the featured coins." />
          : featured.length === 0 ? <EmptyState compact kind="no-activity" body={s ? `No featured coin matches "${q.trim()}".` : "No featured coin is listed."} />
          : <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{featured.map((v) => <ViewCard key={v.id} v={v} now={now} />)}</div>}
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
