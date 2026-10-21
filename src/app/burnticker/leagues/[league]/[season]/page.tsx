import { siteLaunchState } from "@/lib/burnticker/launchAvailability";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { platform } from "@/lib/burnticker/server";
import { publicOrigin } from "@/lib/burnticker/coinArt";
import { dateRange } from "@/lib/burnticker/seasons";
import { LEAGUES_PATH, leagueSeasonPage, resolveLeagueSeason, type LeagueSeasonPage } from "@/lib/burnticker/leagues";
import { leagueDataForPages } from "@/lib/burnticker/leaguesServe";
import { launchAvailability } from "@/lib/burnticker/creatorLaunches";
import { NO_WALLET_LINE } from "@/lib/burnticker/glossary";
import { coinPageHref, sharedTickers } from "@/lib/burnticker/coinKey";
import { seasonStatus, type SeasonSchedule } from "@/lib/burnticker/seasonOver";
import { seasonYearAt, teamsOf, type LeagueId } from "@/lib/burnticker/sources/espn";
import { boundedMemo } from "@/lib/burnticker/boundedMemo";

export const dynamic = "force-dynamic";

/**
 * ONE LEAGUE, ONE SEASON (growth batch 2026-10-10; src/lib/burnticker/leagues.ts): the league's scoreboard cards (seasons.ts, the
 * Seasons page's own logic), its teams first (with a launch link each only while creator launches are open), the games our coins settled in the last seven days with their
 * settlement source line and the plain ESPN link, JSON-LD. Server-rendered from a 60 s registry memo (leaguesServe.ts).
 */
type Params = { params: Promise<{ league: string; season: string }> };

/**
 * website-25 (WIRING-SOURCES7 H6): the teams whose season is over, from one bounded schedule read (seasonOver.ts seasonStatus, the same
 * read /v1/sports/teams makes), for the current season only. Null when the schedule cannot be read, so nothing is greyed on a guess.
 */
// continuous audit HB-31 / HB-35: the schedule read is remembered per league for ten minutes and a cold page waits at most 1.5 s for it
// (it was read afresh, up to 3 s, on every render); the read finishes in the background for the next visitor
const overMemo = boundedMemo<Set<string>>({ freshMs: 10 * 60_000, coldWaitMs: 1_500 });
async function seasonOverTeams(league: LeagueId, year: number): Promise<Set<string> | null> {
  if (year !== seasonYearAt(league, Date.now())) return null;
  let sched: SeasonSchedule | null | undefined = null;
  try { sched = platform().seasonSchedule; } catch { return null; }
  if (!sched) return null;
  const read = sched;
  return overMemo.get(`${league}:${year}`, async () => {
    const games = await read(league, 8);
    return new Set(teamsOf(league).map((t) => t.abbr).filter((a) => seasonStatus(a, games, true).status === "over"));
  });
}

function load(league: string, season: string, seasonOver: ReadonlySet<string> | null = null): { page: LeagueSeasonPage | null; err: string | null; shared?: Set<string> } {
  const r = resolveLeagueSeason(league, season);
  if (!r) return { page: null, err: null };
  const origin = publicOrigin();
  const og = `${origin}${LEAGUES_PATH}/${encodeURIComponent(r.league)}/${encodeURIComponent(season)}/og`;
  try {
    // HB-35: the ten-minute table (leaguesServe.ts leagueDataForPages)
    const d = leagueDataForPages(platform());
    return { page: leagueSeasonPage({ league: r.league, year: r.year, coins: d.coins, readings: d.readings, nowMs: Date.now(), origin, ogImage: og, seasonOver }), err: null, shared: sharedTickers(d.tickers) };
  } catch (e) {
    return { page: leagueSeasonPage({ league: r.league, year: r.year, coins: [], readings: [], nowMs: Date.now(), origin, ogImage: og }), err: e instanceof Error ? e.message : String(e) };
  }
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { league, season } = await params;
  const { page } = load(league, season);
  if (!page) return { title: "League not found", robots: { index: false } };
  const og = `${page.path}/og`;
  return {
    title: page.title, description: page.description, alternates: { canonical: page.path },
    openGraph: { type: "website", siteName: "Burnticker", title: page.title, description: page.description, url: page.path, images: [{ url: og, width: 1200, height: 630, alt: `${page.leagueLabel} ${page.seasonLabel} on Burnticker — a receipt slip` }] },
    twitter: { card: "summary_large_image", title: page.title, description: page.description, images: [og] },
  };
}

export default async function LeagueSeasonRoute({ params }: Params) {
  const { league, season } = await params;
  const r0 = resolveLeagueSeason(league, season);
  const over = r0 ? await seasonOverTeams(r0.league, r0.year) : null;
  const { page: p, err, shared = new Set<string>() } = load(league, season, over);
  if (!p) notFound();
  const card = "rounded-lg border border-neutral-800 bg-neutral-900 p-3";
  const withCoins = p.teams.filter((t) => t.coins.length > 0), rest = p.teams.filter((t) => t.coins.length === 0);
  const empty = p.boards.length === 0 && p.games.rows.length === 0 && p.champions.length === 0;
  // review 2 §2: no launch invitation while creator launches are closed (one availability state: creatorLaunches.ts)
  let cluster: string | null = null;
  try { cluster = platform().cluster; } catch { cluster = null; }
  const launch = launchAvailability(process.env, cluster);
  // website-20 item 119: while launches are closed but the preview runs, the team links say Preview
  const launchPreview = !launch.open && siteLaunchState(process.env).wizard;
  return (
    <main className="mx-auto max-w-5xl px-4 py-6 space-y-8 text-sm">
      {p.jsonLd.map((j, k) => <script key={k} type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(j).replace(/</g, "\\u003c") }} />)}
      <nav className="text-xs text-neutral-400" aria-label="breadcrumb"><Link className="underline" href="/burnticker">Burnticker</Link> › <Link className="underline" href={LEAGUES_PATH}>Leagues</Link> › {p.leagueLabel} {p.seasonLabel}</nav>
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{p.leagueLabel} {p.seasonLabel}</h1>
        <p className="text-neutral-400 max-w-3xl">Team coins for the {p.leagueLabel} {p.seasonLabel} season. Each coin burns supply on its own team&apos;s results under a locked rule, with a receipt per game. The scoreboard ranks coins inside this league only.</p>
        {p.otherSeasons.length > 0 && <p className="text-xs text-neutral-500">Other seasons: {p.otherSeasons.map((s, k) => <span key={s.slug}>{k ? " · " : ""}<Link className="underline" href={s.href}>{s.label}</Link></span>)}</p>}
      </header>
      {err && <p className="text-red-400 text-xs">The coin registry could not be read just now. The error was: {err}</p>}

      {empty && <p className="text-neutral-400 border border-dashed border-neutral-800 rounded p-3 text-xs" data-league-empty>No team coin in the {p.leagueLabel} has a receipt this season yet. The scoreboard and the list of settled games fill in from the coins&apos; own receipts. {NO_WALLET_LINE}{launch.open ? "" : ` ${launch.closedLine}`}</p>}
      {/* site audit #9: league pages lead with the Teams list (after the one empty-state line, when there is one) */}
      <section className="space-y-2" aria-label="teams">
        <h2 className="text-lg font-medium">Teams</h2>
        {withCoins.length > 0 && <ul className="grid gap-2 sm:grid-cols-2">{withCoins.map((t) => (
          <li key={t.abbr} className={card + ` flex flex-wrap items-baseline justify-between gap-2${t.seasonOver ? " opacity-70" : ""}`} data-season-over={t.seasonOver ? "" : undefined}><span>{t.name} <span className="text-xs text-neutral-500">{t.coins.map((c) => `$${c.ticker}`).join(" · ")}</span></span>{(launch.open || launchPreview) && <Link className="text-xs underline" href={t.launchHref}>{launch.open ? "launch a coin for this team" : "preview a coin for this team"}</Link>}{t.warning && <span className="basis-full text-xs text-amber-300/80" data-season-warning>{t.warning}</span>}</li>
        ))}</ul>}
        <details open={withCoins.length === 0 && rest.length <= 40} className="text-xs" data-teams><summary className="cursor-pointer text-neutral-400">{withCoins.length ? `${rest.length} ${rest.length === 1 ? "team has" : "teams have"} no coin this season` : `All ${rest.length} teams`}</summary>
          <ul className="mt-2 grid gap-1 sm:grid-cols-2 lg:grid-cols-3">{rest.map((t) => <li key={t.abbr} className={`flex flex-wrap justify-between gap-x-2 border-b border-neutral-800 py-1${t.seasonOver ? " text-neutral-500" : ""}`} data-season-over={t.seasonOver ? "" : undefined}><span>{t.name}</span>{(launch.open || launchPreview) && <Link className="underline" href={t.launchHref}>{launch.open ? "launch a coin for this team" : "preview a coin for this team"}</Link>}{t.warning && <span className="basis-full text-[11px] text-amber-300/80" data-season-warning>{t.warning}</span>}</li>)}</ul>
        </details>
      </section>
      {/* site audit #9 / BT-10 (2026-10-11): before any coin has a receipt, the empty scoreboard and settled-games sections collapse into one
          line; since site-polish-2 (the private review, 2026-10-13) that line sits ABOVE the team list, so a phone reads why the page is
          empty before scrolling a 30-team roster; with receipts the sections render in full below the teams */}
      {empty ? null : <>
      <section className="space-y-3" aria-label="scoreboard">
        <h2 className="text-lg font-medium">Scoreboard</h2>
        <p className="text-xs text-neutral-500">{NO_WALLET_LINE}{launch.open ? "" : ` ${launch.closedLine}`}</p>
        {p.champions.map((c) => <p key={c.board} className="text-xs"><span className="bt-chip bt-chip-window">champion</span> <span className="font-mono">${c.ticker}</span> had the most receipts on the {c.board} board when the season ended. This is a stat, and nobody receives anything for it.</p>)}
        {p.boards.length === 0 ? <p className="text-neutral-400 border border-neutral-800 rounded p-4">No team-coin receipts for this season yet. This page tracks processed coin receipts, not every game.{launch.open ? " Pick a team below to launch one." : ""}</p> : (
          <div className="grid gap-3 md:grid-cols-2">{p.boards.map((b) => (
            <article key={b.key} className={card} aria-label={b.label}>
              <div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="font-medium">{b.label}</h3><span className="text-xs text-neutral-500">{dateRange(b.from, b.to)}{b.ended ? " · season over" : ""}</span></div>
              {b.leader && <p className="mt-1 text-xs"><span className="bt-chip bt-chip-window">{b.leader.title}</span> <span className="font-mono">${b.leader.ticker}</span></p>}
              <table className="mt-2 w-full text-xs"><thead className="text-left text-neutral-500"><tr><th className="py-1">#</th><th>Coin</th><th>Burns on</th><th className="text-right">Receipts</th><th className="text-right">Supply burned</th></tr></thead>
                <tbody>{b.rows.map((r) => <tr key={r.mint} className="border-t border-neutral-800"><td className="py-1">{r.rank}</td><td><Link className="font-mono underline" href={coinPageHref(r, shared)}>${r.ticker}</Link></td><td>{r.outcome === "win" ? "a win" : r.outcome === "draw" ? "a draw" : "a loss"}</td><td className="text-right tabular-nums">{r.receipts}</td><td className="text-right tabular-nums">{r.burnedPct.toFixed(2)}%</td></tr>)}</tbody></table>
            </article>
          ))}</div>
        )}
      </section>

      <section className="space-y-2" aria-label="settled games">
        <h2 className="text-lg font-medium">Games settled in the last seven days <span className="text-neutral-500 text-sm font-normal">({p.games.range})</span></h2>
        <p className="text-xs text-neutral-500">These are the games this league&apos;s coins settled, as each reading recorded them. A game counts once a second publisher reports the same final score and a second check five minutes later agrees. That second source is a check on the data. It is not a second signer: one signer, run by the operator, signs every reading.</p>
        {p.games.rows.length === 0 ? <p className="text-neutral-400 border border-neutral-800 rounded p-4">No games settled for {p.leagueLabel} coins in these dates.</p> : (
          <ul className="divide-y divide-neutral-800 border border-neutral-800 rounded">{p.games.rows.map((g) => (
            <li key={`${g.date}-${g.away.abbr}-${g.home.abbr}`} className="p-3 space-y-1">
              <div className="flex flex-wrap items-baseline justify-between gap-2"><span><span className="font-mono text-xs text-neutral-500">{g.date}</span> {g.away.name} <b className="tabular-nums">{g.away.score ?? ""}</b> at {g.home.name} <b className="tabular-nums">{g.home.score ?? ""}</b></span><a className="text-xs underline" href={g.espnUrl} rel="noopener nofollow" target="_blank">See it on ESPN<span aria-hidden="true"> ↗</span></a></div>
              <div className="text-xs text-neutral-400">{g.source}</div>
            </li>
          ))}</ul>
        )}
      </section>

      </>}
      <p className="text-neutral-500 text-xs">Team names are used only to describe the result a rule reads.</p>
    </main>
  );
}
