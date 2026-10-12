import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "../_components/EmptyState";
import { SeasonsTabs } from "../_components/SeasonsTabs";
import { platform } from "@/lib/burnticker/server";
import { leagueIndex, type LeagueIndex } from "@/lib/burnticker/leagues";
import { leagueData } from "@/lib/burnticker/leaguesServe";

export const dynamic = "force-dynamic";

const DESCRIPTION = "Burnticker covers leagues in baseball, basketball, football, hockey and soccer. Each league has one page per season, with its team coins, their receipts and the games they settled. Leagues are never ranked against each other.";
export const metadata: Metadata = {
  title: "Leagues", description: DESCRIPTION, alternates: { canonical: "/burnticker/leagues" },
  openGraph: { type: "website", siteName: "Burnticker", title: "Burnticker seasons by league", description: DESCRIPTION, url: "/burnticker/leagues", images: [{ url: "/burnticker/brand/og.png", width: 1200, height: 630, alt: "Burnticker — a thermal receipt with the burned amount scorched out of it" }] },
};

/**
 * THE LEAGUES INDEX (growth batch 2026-10-10; src/lib/burnticker/leagues.ts): every covered league grouped by sport, sports and leagues
 * alphabetical, each linking its current season and any season that has coins. A count per league, never an ordering across leagues.
 */
export default function LeaguesPage() {
  let ix: LeagueIndex | null = null, err: string | null = null;
  try { ix = leagueIndex(leagueData(platform()).coins, Date.now()); } catch (e) { err = e instanceof Error ? e.message : String(e); ix = leagueIndex([], Date.now()); }
  // site audit #9 / BT-10 (2026-10-11): before any league has a coin, one plain banner and a compact list (each sport, its leagues inline)
  // instead of 25 empty cards; once a league has a coin, the cards come back with their counts
  const empty = !err && ix.sports.every((sp) => sp.leagues.every((l) => l.coinsThisSeason === 0));
  return (
    <main className="mx-auto max-w-5xl px-4 py-6 space-y-6 text-sm">
      <header className="space-y-2">
        <SeasonsTabs current="/burnticker/leagues" />
        <h1 className="text-2xl font-semibold">Seasons <span className="text-neutral-500 text-base font-normal">by league</span></h1>
        <p className="text-neutral-400 max-w-3xl">Burnticker covers {ix.totals.leagues} leagues, with one page for each season. Each page ranks that league&apos;s team coins by their receipts, then by the share of supply burned. Leagues are listed by sport and never ranked against each other. To see every league&apos;s scoreboard on one page, with rivalries and the Burn Derby, open <Link className="underline" href="/burnticker/rivalries">Scoreboards</Link>.</p>
      </header>
      {empty && (
        <div className="rounded-lg border border-neutral-700 bg-neutral-900 p-4" role="note" data-prelaunch-banner>
          <p className="font-medium text-neutral-100">No team coin has launched yet.</p>
          <p className="mt-1 text-neutral-300">Every league page is empty for now. A page fills in from its coins&apos; own receipts, not from a list of games. You can still open any league to see its teams. No wallet is needed to read anything here.</p>
          <details className="mt-2 text-xs" data-demo-scoreboard>
            <summary className="cursor-pointer text-neutral-300">See what a league page looks like</summary>
            <p className="mt-2 font-mono text-[11px] uppercase tracking-widest text-amber-300">Example only. These coins and counts are not live data.</p>
            <table className="mt-1 w-full max-w-md text-xs"><thead className="text-left text-neutral-400"><tr><th className="p-1">#</th><th className="p-1">coin</th><th className="p-1 text-right">receipts</th><th className="p-1 text-right">supply burned</th></tr></thead>
              <tbody>{([["1", "$OILERS", "2", "0.98%"], ["2", "$BRUINS", "1", "0.51%"], ["3", "$FLAMES", "1", "0.49%"]] as const).map((r) => <tr key={r[1]} className="border-t border-neutral-800"><td className="p-1">{r[0]}</td><td className="p-1 font-mono">{r[1]}</td><td className="p-1 text-right">{r[2]}</td><td className="p-1 text-right">{r[3]}</td></tr>)}</tbody></table>
            <p className="mt-1 text-neutral-500">This is how an NHL page reads once three team coins have receipts. Coins are ranked by receipts, then by the share of supply burned. A champion is named only when the season ends.</p>
          </details>
        </div>
      )}
      {err && <EmptyState kind="unavailable" body="The coin registry could not be read just now, so every league shows no coins." details={err} />}
      {empty ? (
        <dl className="space-y-3" data-leagues-compact>{ix.sports.map((s) => (
          <div key={s.id} className="sm:flex sm:gap-4">
            <dt className="font-medium text-neutral-100 sm:w-28 sm:shrink-0">{s.label}</dt>
            <dd className="mt-1 sm:mt-0 flex flex-wrap gap-x-3 gap-y-1">{s.leagues.map((l) => <Link key={l.id} className="underline" href={l.current.href}>{l.label} {l.current.label}</Link>)}</dd>
          </div>
        ))}</dl>
      ) : ix.sports.map((s) => (
        <section key={s.id} className="space-y-2" aria-label={s.label}>
          <h2 className="text-lg font-medium">{s.label}</h2>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{s.leagues.map((l) => (
            <li key={l.id} className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
              <div className="flex items-baseline justify-between gap-2"><Link className="font-medium underline" href={l.current.href}>{l.label} {l.current.label}</Link><span className="text-xs text-neutral-500">{l.coinsThisSeason} team coin{l.coinsThisSeason === 1 ? "" : "s"}</span></div>
              {l.seasons.length > 1 && <p className="mt-1 text-xs text-neutral-500">{l.seasons.filter((x) => x.year !== l.current.year).map((x, k) => <span key={x.slug}>{k ? " · " : ""}<Link className="underline" href={x.href}>{x.label}</Link></span>)}</p>}
            </li>
          ))}</ul>
        </section>
      ))}
    </main>
  );
}
