import type { Metadata } from "next";
import Link from "next/link";
import { platform } from "@/lib/burnticker/server";
import { DECIMALS, TOTAL_SUPPLY } from "@/lib/burnticker/rules";
import { coinsBurnedOn, dateRange, seasonBoards, type SeasonBoard, type SeasonCoinInput } from "@/lib/burnticker/seasons";
import { derbyStore } from "@/lib/burnticker/derby/store";
import { launchAvailability } from "@/lib/burnticker/creatorLaunches";
import { NO_WALLET_LINE } from "@/lib/burnticker/glossary";
import { EmptyState } from "../_components/EmptyState";
import { EXPLORE_VERIFIED_BURN } from "@/lib/burnticker/currentStatusLinks";
import { SeasonsTabs } from "../_components/SeasonsTabs";
import { coinPageHref, sharedTickers } from "@/lib/burnticker/coinKey";
import { pairLifecycleLine, publicPairs } from "@/lib/burnticker/publicPairs";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Scoreboards", description: "Burnticker keeps one scoreboard for each league and season, ranked by receipts. Rivalry pairs and Burn Derby brackets are listed below the scoreboards.", alternates: { canonical: "/burnticker/rivalries" } }; // audit 7 item 27: a canonical URL

/**
 * SCOREBOARDS (route /burnticker/rivalries; under the nav's "Seasons"; audit 4 BT-22: the nav label names /burnticker/leagues, whose
 * heading is "Seasons", so this page is "Scoreboards" everywhere). One scoreboard card per league and season (src/lib/burnticker/seasons.ts):
 * each ranks only that league's team coins of that window, by receipts, then by the share of supply burned. Across leagues: a count
 * only. Rivalry pairs and Burn Derby brackets follow as their own sections.
 */
export default function SeasonsPage() {
  let boards: SeasonBoard[] = [], yesterday = 0, pairs: { pairId: string; a: string; b: string; selectorKey: string; createdAt: number; note: string | null }[] = [], brackets: { id: string; title: string; createdAt: number }[] = [];
  let shared = new Set<string>();
  let err: string | null = null;
  const launch = launchAvailability(process.env);
  const yday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  try {
    const p = platform();
    const supplyRaw = BigInt(TOTAL_SUPPLY) * BigInt(10) ** BigInt(DECIMALS);
    const coins: SeasonCoinInput[] = [...p.registry.tokens("live"), ...p.registry.tokens("retired")].map((t) => {
      const burns = p.registry.receipts(t.mint).filter((b) => b.status === "confirmed" && (b.burnRaw ?? BigInt(0)) > BigInt(0)).map((b) => ({ settledAt: b.settledAt }));
      return { ticker: t.ticker, mint: t.mint, rule: p.registry.lockedRule(t).rule, burns, burnedPct: Number((p.registry.totalBurnedRaw(t.mint) * BigInt(1_000_000)) / supplyRaw) / 10_000, ended: p.registry.ruleEnd(t.mint) !== null };
    });
    boards = seasonBoards(coins);
    shared = sharedTickers(coins);   // tickers are not unique (owner 2026-10-12): a shared ticker links by mint
    yesterday = coinsBurnedOn(coins, yday);
    // third prelaunch audit F09: a pair that never launched is not listed; one launched side is said (publicPairs.ts)
    pairs = publicPairs(p.registry).map((pr) => ({ pairId: pr.pairId, a: pr.tickerA, b: pr.tickerB, selectorKey: pr.selectorKey, createdAt: pr.createdAt, note: pairLifecycleLine(pr) }));
    try { brackets = derbyStore(p.registry.db).tournaments().map((r) => { let title = r.id; try { title = (JSON.parse(r.json) as { title?: string }).title ?? r.id; } catch { /* keep the id */ } return { id: r.id, title, createdAt: r.createdAt }; }); } catch { brackets = []; }
  } catch (e) { err = e instanceof Error ? e.message : String(e); }
  const card = "rounded-lg border border-neutral-800 bg-neutral-900 p-3";
  // UX report 3 item 3: no scoreboard, no pair and no bracket → one explanation and one evidence link, not three empty sections
  const empty = !err && boards.length === 0 && pairs.length === 0 && brackets.length === 0;
  return (
    <main className="mx-auto max-w-5xl px-4 py-6 space-y-8">
      <header className="space-y-1">
        <SeasonsTabs current="/burnticker/rivalries" />
        <h1 className="text-2xl font-semibold">Scoreboards</h1>
        <p className="text-neutral-400 text-sm max-w-3xl">One scoreboard per league and season. Each card ranks only that league&apos;s team coins, by receipts, then by the share of supply burned. Leagues are never ranked against each other. Each league and season also has its own page, listed under <Link className="underline" href="/burnticker/leagues">Leagues</Link>.</p>
        {!err && !empty && <p className="text-sm text-neutral-300" aria-label="across all leagues">Yesterday ({yday}), {yesterday} coin{yesterday === 1 ? "" : "s"} burned across all leagues.</p>}
      </header>
      {err && <EmptyState kind="unavailable" body="The coin registry could not be read just now, so the scoreboards, rivalries and brackets are not shown." details={err} />}
      {empty && (
        <EmptyState kind="not-launched" body={<>No team coin, rivalry pair or Burn Derby bracket is registered on this site yet, so there is no scoreboard to show. Each fills from the coins&apos; own receipts. {launch.open ? null : launch.closedLine} {NO_WALLET_LINE}</>}>
          <p className="mt-3" data-empty-evidence><Link className="underline" href={EXPLORE_VERIFIED_BURN.href}>{EXPLORE_VERIFIED_BURN.label}</Link> <span className="text-xs text-neutral-500">— {EXPLORE_VERIFIED_BURN.blurb}</span></p>
          <p className="mt-1 text-xs text-neutral-500">An example scoreboard, clearly labelled, is on <Link className="underline" href="/burnticker/leagues">Leagues</Link>.</p>
        </EmptyState>
      )}

      {!empty && !err && <>
      <section className="space-y-3" aria-label="season scoreboards">
        {!err && boards.length === 0 && <p className="text-sm text-neutral-400 border border-neutral-800 rounded p-4">No team coins yet.{launch.open ? <> A team coin is launched from the <Link className="underline" href="/burnticker/launch">wizard</Link> in any league: baseball, basketball, hockey, soccer, football, college.</> : ` ${launch.closedLine}`} {NO_WALLET_LINE}</p>}
        <div className="grid gap-3 md:grid-cols-2">{boards.map((b) => (
          <article key={b.key} className={card} aria-label={b.label}>
            <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="font-medium">{b.label}</h2><span className="text-xs text-neutral-500">{dateRange(b.from, b.to)}{b.ended ? " · season over" : ""}</span></div>
            {b.leader && <p className="mt-1 text-xs"><span className="bt-chip bt-chip-window">{b.leader.title}</span> <span className="font-mono">${b.leader.ticker}</span></p>}
            <table className="mt-2 w-full text-xs"><thead className="text-left text-neutral-500"><tr><th className="py-1">#</th><th>Coin</th><th>Burns on</th><th className="text-right">Receipts</th><th className="text-right">Supply burned</th></tr></thead>
              <tbody>{b.rows.map((r) => <tr key={r.mint} className="border-t border-neutral-800"><td className="py-1">{r.rank}</td><td><Link className="font-mono underline" href={coinPageHref(r, shared)}>${r.ticker}</Link></td><td>{r.outcome === "win" ? "a win" : r.outcome === "draw" ? "a draw" : "a loss"}</td><td className="text-right tabular-nums">{r.receipts}</td><td className="text-right tabular-nums">{r.burnedPct.toFixed(2)}%</td></tr>)}</tbody></table>
          </article>
        ))}</div>
      </section>

      <section className="space-y-2" aria-label="rivalries">
        <h2 className="text-lg font-medium">Rivalries</h2>
        <p className="text-neutral-400 text-sm max-w-3xl">A rivalry pairs two coins on one settled event. Each coin burns on its own side&apos;s result, under its own locked rule. The receipts are the scoreboard.</p>
        {!err && pairs.length === 0 && <p className="text-sm text-neutral-400 border border-neutral-800 rounded p-4">No rivalry pairs yet.</p>}
        {pairs.length > 0 && <ul className="divide-y divide-neutral-800 border border-neutral-800 rounded">{pairs.map((r) => (
          <li key={r.pairId} className="p-3 flex flex-wrap items-baseline gap-x-4 gap-y-1"><Link className="font-mono underline" href={`/burnticker/p/${encodeURIComponent(r.pairId)}`}>${r.a} vs ${r.b}</Link><span className="font-mono text-xs text-neutral-500">{r.selectorKey}</span><span className="text-xs text-neutral-500">since {new Date(r.createdAt).toISOString().slice(0, 10)}</span>{r.note && <span className="text-xs text-amber-300" data-pair-lifecycle>{r.note}</span>}</li>
        ))}</ul>}
      </section>

      <section className="space-y-2" aria-label="derby brackets">
        <h2 className="text-lg font-medium">Burn Derby brackets</h2>
        {!err && brackets.length === 0 && <p className="text-sm text-neutral-400 border border-neutral-800 rounded p-4">No brackets yet.</p>}
        {brackets.length > 0 && <ul className="divide-y divide-neutral-800 border border-neutral-800 rounded">{brackets.map((t) => (
          <li key={t.id} className="p-3 flex flex-wrap items-baseline gap-x-4"><Link className="underline" href={`/burnticker/derby/${encodeURIComponent(t.id)}`}>{t.title}</Link><span className="text-xs text-neutral-500">since {new Date(t.createdAt).toISOString().slice(0, 10)}</span></li>
        ))}</ul>}
      </section>
      </>}
    </main>
  );
}
