import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "../_components/EmptyState";
import { platform } from "@/lib/burnticker/server";
import { leagueIndex, type LeagueIndex } from "@/lib/burnticker/leagues";
import { leagueData } from "@/lib/burnticker/leaguesServe";

export const dynamic = "force-dynamic";

const DESCRIPTION = "Every league Burnticker covers — baseball, basketball, football, hockey, soccer — with one page per season: the team coins, their receipts and the games they settled. Leagues are never ranked against each other.";
export const metadata: Metadata = {
  title: "Seasons by league", description: DESCRIPTION, alternates: { canonical: "/burnticker/leagues" },
  openGraph: { type: "website", siteName: "Burnticker", title: "Burnticker seasons by league", description: DESCRIPTION, url: "/burnticker/leagues", images: [{ url: "/burnticker/brand/og.png", width: 1200, height: 630, alt: "Burnticker — a thermal receipt with the burned amount scorched out of it" }] },
};

/**
 * THE LEAGUES INDEX (growth batch 2026-10-10; src/lib/burnticker/leagues.ts): every covered league grouped by sport, sports and leagues
 * alphabetical, each linking its current season and any season that has coins. A count per league, never an ordering across leagues.
 */
export default function LeaguesPage() {
  let ix: LeagueIndex | null = null, err: string | null = null;
  try { ix = leagueIndex(leagueData(platform()).coins, Date.now()); } catch (e) { err = e instanceof Error ? e.message : String(e); ix = leagueIndex([], Date.now()); }
  return (
    <main className="mx-auto max-w-5xl px-4 py-6 space-y-6 text-sm">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Seasons <span className="text-neutral-500 text-base font-normal">by league</span></h1>
        <p className="text-neutral-400 max-w-3xl">{ix.totals.leagues} leagues, one page per season. Each page ranks that league&apos;s team coins by receipts, then by the share of supply burned. Leagues are listed by sport, alphabetically — never ranked against each other. Every league&apos;s scoreboard on one page, with rivalries and the Burn Derby: <Link className="underline" href="/burnticker/rivalries">Scoreboards</Link>.</p>
      </header>
      {!err && ix.sports.every((sp) => sp.leagues.every((l) => l.coinsThisSeason === 0)) && (
        <EmptyState kind="not-launched" body="No team coin is launched on this host yet, so every league page is empty for now. Each page fills from the coins' own receipts, never from a list of games.">
          <div className="mt-3" data-demo-scoreboard>
            <p className="font-mono text-[11px] uppercase tracking-widest text-amber-300">Example data · illustrative coins and counts, not live</p>
            <table className="mt-1 w-full max-w-md text-xs"><thead className="text-left text-neutral-400"><tr><th className="p-1">#</th><th className="p-1">coin</th><th className="p-1 text-right">receipts</th><th className="p-1 text-right">supply burned</th></tr></thead>
              <tbody>{([["1", "$OILERS", "2", "0.98%"], ["2", "$BRUINS", "1", "0.51%"], ["3", "$FLAMES", "1", "0.49%"]] as const).map((r) => <tr key={r[1]} className="border-t border-neutral-800"><td className="p-1">{r[0]}</td><td className="p-1 font-mono">{r[1]}</td><td className="p-1 text-right">{r[2]}</td><td className="p-1 text-right">{r[3]}</td></tr>)}</tbody></table>
            <p className="mt-1 text-neutral-500">How an NHL page reads once three team coins have receipts: ranked by receipts, then by the share of supply burned; a champion is named only when the season ends. No wallet is needed to read it.</p>
          </div>
        </EmptyState>
      )}
      {err && <EmptyState kind="unavailable" body="The coin registry could not be read just now, so every league shows no coins." details={err} />}
      {ix.sports.map((s) => (
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
      <p className="text-neutral-500 text-xs">Memecoins. Each rule says what its supply does, not what price does. Not affiliated with any team, league, candidate, agency or market.</p>
    </main>
  );
}
