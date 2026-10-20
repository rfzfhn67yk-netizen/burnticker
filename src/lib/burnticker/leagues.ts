import { SEASON_OVER_LINK_LINE } from "@/lib/burnticker/seasonOver";
import { LEAGUES, SPORTS, isLeague, parseEspnSeries, seasonLabel, seasonYearAt, teamByAbbr, teamsOf, type LeagueId, type Sport } from "@/lib/burnticker/sources/espn";
import { espnGameUrl } from "@/lib/burnticker/sources/gameSettle";
import { settledParts, settledSentence } from "@/lib/burnticker/settledTitle";
import { dateRange, seasonBoards, type SeasonBoard, type SeasonCoinInput } from "@/lib/burnticker/seasons";
import { safeParam } from "@/lib/burnticker/safeParam";

/**
 * LEAGUE AND SEASON PAGES (growth batch, owner-approved 2026-10-10; SEO). /burnticker/leagues lists every league Burnticker covers,
 * grouped by sport (sports and leagues alphabetical — no league first, never an ordering by receipts across leagues). Each league has
 * one page per season, /burnticker/leagues/<league>/<season> ("nhl/2026-27", "mlb/2026"), with:
 *
 *   · the scoreboard cards for that league and season (season, postseason and head-to-head series cards, each kept with its year) — seasons.ts `seasonBoards`, imported, not re-implemented: ranked inside the
 *     card only, "most receipts so far" during the season, "champion" only once the season ended for every coin on the card;
 *   · the team list with a "launch a coin for this team" link (the wizard's describe-the-event box, prefilled);
 *   · the games our coins settled in the last seven days, each with its settlement source line exactly as the reading recorded it
 *     ("settled on the game's on-chain payout · confirmed by NHL's official scores") and the plain "see on ESPN →" link (never fetched);
 *   · title / description / OpenGraph, and JSON-LD: a BreadcrumbList, and a SportsEvent per settled game (only what the reading
 *     recorded: the two teams, the date, the final score — no venue, no time, no offers).
 *
 * Pure: leaguesServe.ts feeds it the registry's coins and readings.
 */

export const LEAGUES_PATH = "/burnticker/leagues";

/** "2026-27" for a league whose season spans two years, "2026" otherwise — the URL form of seasonLabel (hyphen, not en dash). */
export const seasonSlug = (league: LeagueId, year: number): string => seasonLabel(league, year).replace("–", "-");
/** The ESPN season year a slug names, or null when the slug is not this league's form. */
export function parseSeasonSlug(league: LeagueId, slug: string): number | null {
  const span = LEAGUES[league].span;
  if (span === "single") { const m = /^(\d{4})$/.exec(slug); return m ? Number(m[1]) : null; }
  const m = /^(\d{4})-(\d{2})$/.exec(slug);
  if (!m) return null;
  const a = Number(m[1]), b = Number(m[2]);
  if ((a + 1) % 100 !== b) return null;
  return span === "later" ? a + 1 : a;
}
export const leaguePath = (league: LeagueId, year: number): string => `${LEAGUES_PATH}/${encodeURIComponent(league)}/${seasonSlug(league, year)}`;
/** website-20 item 119: the launch page opens on this league with this team picked (the guided team path, step 2). */
export const launchHref = (teamName: string, league?: string, abbr?: string, o: { seasonOver?: boolean } = {}): string => (league && abbr ? `/burnticker/launch?league=${encodeURIComponent(league)}&team=${encodeURIComponent(abbr)}${o.seasonOver ? "&season=over" : ""}` : `/burnticker/launch?q=${encodeURIComponent(teamName)}`);

/**
 * A team coin's league and season year, or null (not a team coin, or a perpetual / next-N / legacy window). Third prelaunch audit F07: a
 * head-to-head series (window `meetings`) belongs to its own season year, like a season or postseason coin (before: null, so the league
 * page listed it on the year-less card of every current season and counted it nowhere).
 */
export function coinSeason(c: Pick<SeasonCoinInput, "rule">): { league: LeagueId; year: number; window: "season" | "post" | "meetings" } | null {
  const e = c.rule.oracle === "catalogue" && c.rule.series ? parseEspnSeries(c.rule.series) : null;
  if (!e || e.kind !== "team" || (e.window.kind !== "season" && e.window.kind !== "post" && e.window.kind !== "meetings")) return null;
  return { league: e.league, year: e.window.year, window: e.window.kind };
}
/**
 * F07: which season page shows a year-less team coin. A next-N window shows on the season its first counted day falls in; a perpetual or
 * legacy window on the current season only.
 */
function otherSeasonYear(c: Pick<SeasonCoinInput, "rule">, nowMs: number): number | null {
  const e = c.rule.oracle === "catalogue" && c.rule.series ? parseEspnSeries(c.rule.series) : null;
  if (!e || e.kind !== "team") return null;
  if (e.window.kind === "next") { const f = e.window.from; return seasonYearAt(e.league, Date.parse(`${f.slice(0, 4)}-${f.slice(4, 6)}-${f.slice(6)}T12:00:00Z`)); }
  return seasonYearAt(e.league, nowMs);
}
/** HB-124 (hourly run 10): an instant's calendar day in Denver, YYYY-MM-DD (a bare date stays as it is). */
export function denverDay(iso: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Intl.DateTimeFormat("en-CA", { timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t)) : iso.slice(0, 10);
}
/** HB-124: the outcome word a one-game pair coin shows under its team on the league page. */
export const ONE_GAME_OUTCOME = "one-game pair";
const coinLeague = (c: Pick<SeasonCoinInput, "rule">): LeagueId | null => {
  const e = c.rule.oracle === "catalogue" && c.rule.series ? parseEspnSeries(c.rule.series) : null;
  return e ? e.league : null;
};

// ---- the index -------------------------------------------------------------------------------------------------------------

export interface LeagueIndexRow { id: LeagueId; label: string; sport: Sport; current: { year: number; slug: string; label: string; href: string }; seasons: { year: number; slug: string; label: string; href: string; coins: number }[]; coinsThisSeason: number }
export interface LeagueIndex { sports: { id: Sport; label: string; leagues: LeagueIndexRow[] }[]; totals: { leagues: number; teamCoins: number } }

export function leagueIndex(coins: readonly SeasonCoinInput[], nowMs: number): LeagueIndex {
  const bySeason = new Map<string, number>();
  for (const c of coins) { const s = coinSeason(c); if (s) bySeason.set(`${s.league}:${s.year}`, (bySeason.get(`${s.league}:${s.year}`) ?? 0) + 1); }
  const rows: LeagueIndexRow[] = (Object.keys(LEAGUES) as LeagueId[]).map((id) => {
    const L = LEAGUES[id], year = seasonYearAt(id, nowMs);
    const years = new Set<number>([year]);
    for (const k of bySeason.keys()) if (k.startsWith(`${id}:`)) years.add(Number(k.slice(id.length + 1)));
    const seasons = [...years].sort((a, b) => b - a).map((y) => ({ year: y, slug: seasonSlug(id, y), label: seasonLabel(id, y), href: leaguePath(id, y), coins: bySeason.get(`${id}:${y}`) ?? 0 }));
    return { id, label: L.label, sport: L.sport, current: { year, slug: seasonSlug(id, year), label: seasonLabel(id, year), href: leaguePath(id, year) }, seasons, coinsThisSeason: bySeason.get(`${id}:${year}`) ?? 0 };
  });
  const sports = SPORTS.map((s) => ({ id: s.id, label: s.label, leagues: rows.filter((r) => r.sport === s.id).sort((a, b) => a.label.localeCompare(b.label)) })).filter((s) => s.leagues.length);
  return { sports, totals: { leagues: rows.length, teamCoins: [...bySeason.values()].reduce((a, b) => a + b, 0) } };
}

// ---- settled games from the readings -----------------------------------------------------------------------------------------

/** A reading of a team coin's selector, as the registry stores it (title = gameSettle.ts's line per game, joined by " · "). */
export interface GameReading { selectorKey: string; at: string; title: string | null }
export interface SettledGame {
  date: string; league: LeagueId;
  away: { abbr: string; name: string; score: number | null }; home: { abbr: string; name: string; score: number | null };
  /** "settled on the game's on-chain payout · confirmed by NHL's official scores" — as the reading recorded it. */
  source: string;
  /** The day's public ESPN scoreboard (a plain human link; never fetched). */
  espnUrl: string;
}

// one game's span in a title: the score, then everything up to its ESPN link (the settled part is parsed by settledTitle.ts, so a title
// with no confirmer, or one ending "· burned when two sources had confirmed it", "· burned when one source had confirmed the final twice" or the old "· burned 12 hours after the final was first read", still reads; review of b3249737 item 5)
const GAME_RE = /([A-Z0-9]{2,6})(?: (\d+))? @ ([A-Z0-9]{2,6})(?: (\d+))? final \([^)]*\) · (settled on [^]*?) · see this game on ESPN → (https:\/\/www\.espn\.com\/\S+)/g;

/** The games one reading's title records (one per game that day). */
export function gamesFromTitle(league: LeagueId, date: string, title: string): SettledGame[] {
  const out: SettledGame[] = [];
  for (const m of title.matchAll(GAME_RE)) {
    const [, aw, as, hm, hs, settled, url] = m;
    const part = settledParts(settled)[0];
    const side = (abbr: string, score: string | undefined) => ({ abbr, name: teamByAbbr(league, abbr)?.name ?? abbr, score: score === undefined ? null : Number(score) });
    out.push({ date, league, away: side(aw, as), home: side(hm, hs), source: part ? settledSentence(part) : settled, espnUrl: /^https:\/\/www\.espn\.com\//.test(url) ? url : espnGameUrl(league, date) });
  }
  return out;
}

/**
 * Every distinct game the league's team coins settled between `from` and `to` (inclusive dates), newest first. Two coins on the same
 * game (both teams, or a win and a loss coin) record the same game: it is listed once.
 */
export function settledGames(league: LeagueId, readings: readonly GameReading[], from: string, to: string): SettledGame[] {
  const seen = new Map<string, SettledGame>();
  for (const r of readings) {
    const date = denverDay(r.at);   // HB-124: the game's Denver calendar day, as the token pages say it (an evening game is not the next UTC day)
    if (!r.title || date < from || date > to) continue;
    const key = r.selectorKey.replace(/^catalogue:/, "");
    const e = /^espn\.(team|game):/.test(key) ? parseEspnSeries(key) : null;
    if (e && e.league !== league) continue;
    for (const g of gamesFromTitle(league, date, r.title)) {
      const k = `${g.date}:${g.away.abbr}@${g.home.abbr}`;
      if (!seen.has(k)) seen.set(k, g);
    }
  }
  return [...seen.values()].sort((a, b) => b.date.localeCompare(a.date) || a.away.abbr.localeCompare(b.away.abbr));
}

// ---- one league season -------------------------------------------------------------------------------------------------------

export interface LeagueTeamRow { abbr: string; name: string; coins: { ticker: string; outcome: string }[]; launchHref: string; /** sources-7 H6: the team's season is over (the page read the schedule); its link carries `season=over` */ seasonOver: boolean; warning: string | null }
export interface LeagueSeasonPage {
  league: LeagueId; leagueLabel: string; sport: Sport; year: number; slug: string; seasonLabel: string; path: string;
  current: boolean;
  title: string; description: string;
  /** seasons.ts boards for this league and season (season, postseason and head-to-head series cards; the year-less card holds the perpetual coins on the current season and each next-N coin on the season it starts in). */
  boards: SeasonBoard[];
  /** The champion line, only once a season card ended (seasons.ts decides). */
  champions: { board: string; ticker: string }[];
  teams: LeagueTeamRow[];
  games: { from: string; to: string; range: string; rows: SettledGame[] };
  otherSeasons: { slug: string; label: string; href: string }[];
  jsonLd: Record<string, unknown>[];
}

export interface LeagueSeasonInput { league: LeagueId; year: number; coins: readonly SeasonCoinInput[]; readings: readonly GameReading[]; nowMs: number; origin: string; ogImage: string; /** sources-7 H6: the teams whose season is over (seasonOver.ts seasonStatus over the league's schedule); absent = not read */ seasonOver?: ReadonlySet<string> | null }

export function leagueSeasonPage(i: LeagueSeasonInput): LeagueSeasonPage {
  const L = LEAGUES[i.league], label = seasonLabel(i.league, i.year), slug = seasonSlug(i.league, i.year), path = leaguePath(i.league, i.year);
  const current = seasonYearAt(i.league, i.nowMs) === i.year;
  const inSeason = i.coins.filter((c) => { const s = coinSeason(c); return s !== null && s.league === i.league && s.year === i.year; });
  const other = i.coins.filter((c) => coinSeason(c) === null && coinLeague(c) === i.league && c.rule.series && /^espn\.team:/.test(c.rule.series) && otherSeasonYear(c, i.nowMs) === i.year);
  const boards = seasonBoards([...inSeason, ...other]);
  const champions = boards.filter((b) => b.leader?.title === "champion").map((b) => ({ board: b.label, ticker: b.leader!.ticker }));
  const coinsByTeam = new Map<string, { ticker: string; outcome: string }[]>();
  for (const c of [...inSeason, ...other]) {
    const e = parseEspnSeries(c.rule.series!);
    if (!e || e.kind !== "team") continue;
    coinsByTeam.set(e.abbr, [...(coinsByTeam.get(e.abbr) ?? []), { ticker: c.ticker, outcome: e.outcome }]);
  }
  // HB-124 (hourly run 10): a one-game coin (a one-game pair side, $DENWIN and $SEAWIN) is a coin of its team on the current season's
  // page, so that team is never listed under "no coin this season"
  if (current) for (const c of i.coins) {
    const e = c.rule.oracle === "catalogue" && c.rule.series && /^espn\.game:/.test(c.rule.series) ? parseEspnSeries(c.rule.series) : null;
    if (!e || e.kind !== "game" || e.league !== i.league) continue;
    coinsByTeam.set(e.abbr, [...(coinsByTeam.get(e.abbr) ?? []), { ticker: c.ticker, outcome: ONE_GAME_OUTCOME }]);
  }
  const teams = teamsOf(i.league).map((t) => { const over = !!i.seasonOver?.has(t.abbr); return { abbr: t.abbr, name: t.name, coins: coinsByTeam.get(t.abbr) ?? [], launchHref: launchHref(t.name, i.league, t.abbr, { seasonOver: over }), seasonOver: over, warning: over ? SEASON_OVER_LINK_LINE : null }; })
    .sort((a, b) => (a.seasonOver ? 1 : 0) - (b.seasonOver ? 1 : 0) || (b.coins.length > 0 ? 1 : 0) - (a.coins.length > 0 ? 1 : 0) || a.name.localeCompare(b.name));
  const to = denverDay(new Date(i.nowMs).toISOString()), from = denverDay(new Date(i.nowMs - 6 * 86_400_000).toISOString());   // HB-124: never a day after today in Denver
  const rows = settledGames(i.league, i.readings, from, to);
  const n = inSeason.length;
  const title = `${L.label} ${label} — team coins and receipts`;
  const description = `Burnticker has ${n} team coin${n === 1 ? "" : "s"} for the ${L.label} ${label} season. Each one burns supply on its team's results, with a receipt for each game. The scoreboard ranks coins inside this league only. These are memecoins, and each rule is about supply, never price.`;
  const abs = (p: string) => `${i.origin.replace(/\/$/, "")}${p}`;
  const jsonLd: Record<string, unknown>[] = [
    { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
      { "@type": "ListItem", position: 1, name: "Burnticker", item: abs("/burnticker") },
      { "@type": "ListItem", position: 2, name: "Leagues", item: abs(LEAGUES_PATH) },
      { "@type": "ListItem", position: 3, name: `${L.label} ${label}`, item: abs(path) },
    ] },
    ...rows.map((g) => ({
      "@context": "https://schema.org", "@type": "SportsEvent", name: `${g.away.name} at ${g.home.name}`, startDate: g.date, sport: SPORTS.find((s) => s.id === L.sport)!.label,
      awayTeam: { "@type": "SportsTeam", name: g.away.name }, homeTeam: { "@type": "SportsTeam", name: g.home.name },
      ...(g.away.score !== null && g.home.score !== null ? { description: `Final score: ${g.away.name} ${g.away.score}, ${g.home.name} ${g.home.score}. ${g.source}` } : { description: g.source }),
      superEvent: { "@type": "SportsEvent", name: `${L.label} ${label}` },
    })),
  ];
  const years = [i.year - 1, i.year + 1].filter((y) => y <= seasonYearAt(i.league, i.nowMs));
  return {
    league: i.league, leagueLabel: L.label, sport: L.sport, year: i.year, slug, seasonLabel: label, path, current, title, description, boards, champions, teams,
    games: { from, to, range: dateRange(from, to), rows }, otherSeasons: years.map((y) => ({ slug: seasonSlug(i.league, y), label: seasonLabel(i.league, y), href: leaguePath(i.league, y) })), jsonLd,
  };
}

/** Resolves a /leagues/<league>/<season> request: the league id and the ESPN year, or null (→ 404). */
export function resolveLeagueSeason(league: string, season: string): { league: LeagueId; year: number } | null {
  const l = safeParam(league).toLowerCase();
  if (!isLeague(l)) return null;
  const y = parseSeasonSlug(l, safeParam(season));
  return y !== null && y >= 2000 && y <= 2100 ? { league: l, year: y } : null;
}

/** Every visible string of a league page (headings, labels, lines, the JSON-LD names and descriptions), for the copy lint. */
export function leaguePageStrings(p: LeagueSeasonPage): string[] {
  return [
    p.title, p.description, `${p.leagueLabel} ${p.seasonLabel}`, ...p.boards.flatMap((b) => [b.label, dateRange(b.from, b.to), b.leader ? `${b.leader.title} $${b.leader.ticker}` : ""]),
    ...p.champions.map((c) => `$${c.ticker} had the most receipts on the ${c.board} board when the season ended. This is a stat, and nobody receives anything for it.`),
    ...p.teams.slice(0, 60).map((t) => `${t.name}: launch a coin for this team`), `Games settled in the last seven days (${p.games.range})`,
    ...p.games.rows.flatMap((g) => [`${g.away.name} ${g.away.score ?? ""} at ${g.home.name} ${g.home.score ?? ""}`, g.source, "See it on ESPN"]),
    ...p.jsonLd.flatMap((j) => [String(j.name ?? ""), String(j.description ?? "")]),
  ].filter(Boolean);
}

// ---- the OpenGraph card ------------------------------------------------------------------------------------------------------

const escXml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

/** The league page's OpenGraph image (1200 × 630): a receipt slip on the dark counter with the league, the season and two counts. */
export function leagueOgSvg(o: { league: string; season: string; coins: number; receipts: number }): string {
  const mono = "Courier Prime, Courier New, monospace";
  const head = `${o.league} ${o.season.replace("-", "–")}`;
  const size = head.length <= 14 ? 96 : head.length <= 22 ? 72 : 54;
  const n = 30, step = 760 / n;
  const teeth = Array.from({ length: n }, (_, k) => { const x = 980 - k * step; return `${(x - step / 2).toFixed(1)},582 ${(x - step).toFixed(1)},568`; }).join(" ");
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">`,
    `<rect width="1200" height="630" fill="#12100e"/><rect y="0" width="1200" height="14" fill="#5b3fa3"/><rect y="616" width="1200" height="14" fill="#c8873a"/>`,
    `<g transform="rotate(-1.2 600 315)"><path d="M220,56 L980,56 L980,568 L${teeth} Z" fill="#f2eee4"/>`,
    `<g font-family="${mono}" fill="#1b1916">`,
    `<text x="260" y="118" font-size="30" font-weight="700" letter-spacing="8">BURNTICKER · SEASONS</text>`,
    `<line x1="260" y1="146" x2="940" y2="146" stroke="#1b1916" stroke-width="3" stroke-dasharray="12 9"/>`,
    `<text x="600" y="${270 + size / 3}" text-anchor="middle" font-size="${size}" font-weight="700">${escXml(head)}</text>`,
    `<line x1="260" y1="360" x2="940" y2="360" stroke="#1b1916" stroke-width="3" stroke-dasharray="12 9"/>`,
    `<text x="260" y="420" font-size="34">team coins this season</text><text x="940" y="420" text-anchor="end" font-size="34" font-weight="700">${o.coins}</text>`,
    `<text x="260" y="472" font-size="34">receipts</text><text x="940" y="472" text-anchor="end" font-size="34" font-weight="700">${o.receipts}</text>`,
    `<text x="260" y="530" font-size="22" fill="#5a5248">ranked inside the league only · supply, not price</text>`,
    `</g></g></svg>`,
  ].join("");
}
