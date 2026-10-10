import type { SeriesSummary } from "@/lib/burnticker/oracle/types";

/**
 * KALSHI EVENT + MARKET SEARCH (2026-10-10; the owner searched "eagles" to pair Eagles vs Jaguars and got nothing — series titles say
 * "Professional Football Game", the game lives one level down). Kalshi's hierarchy is series → EVENT → markets:
 *
 *   GET /events?series_ticker=KXNFLGAME&status=open&with_nested_markets=true
 *     event  KXNFLGAME-26OCT11PHIJAC  "PHI Eagles vs JAC Jaguars"  (sub_title "PHI vs JAC (Oct 11)")
 *     market KXNFLGAME-26OCT11PHIJAC-PHI  yes_sub_title "Philadelphia"   — YES if Philadelphia wins
 *     market KXNFLGAME-26OCT11PHIJAC-JAC  yes_sub_title "Jacksonville"   — note Kalshi's JAC, not JAX
 *
 * Pure here: parsing the events body, the team-alias table (city, nickname, abbreviation — Kalshi's spelling first, common
 * alternatives after), matching a query against event title, event ticker, sub-title, market yes_sub_title and market suffix (with
 * alias expansion), the two sides of a game, and the matchup leagues derived from the Sports series list. The client
 * (KalshiClient.searchEvents in kalshi.ts) does the fetching and the 10-minute per-series cache. No prices are carried: a hit lists
 * markets by ticker and label only.
 */

export interface KalshiEventMarket { ticker: string; suffix: string; label: string; status: string; result: string; closeTime: string | null; expectedAt: string | null }
export interface KalshiEvent {
  eventTicker: string; seriesTicker: string; title: string; subTitle: string | null; category: string | null; competition: string | null;
  /** When the result is expected (the markets' expected_expiration_time / occurrence_datetime; for a game, roughly its end). */
  expectedAt: string | null; closeTime: string | null; markets: KalshiEventMarket[];
}

const s = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
export const suffixOf = (marketTicker: string): string => marketTicker.split("-").pop() ?? marketTicker;

export function parseEvent(raw: unknown): KalshiEvent | null {
  const e = raw as Record<string, unknown> | null;
  if (!e || typeof e.event_ticker !== "string") return null;
  const markets = (Array.isArray(e.markets) ? e.markets : []).map((m: Record<string, unknown>) => (typeof m?.ticker === "string" ? {
    ticker: m.ticker, suffix: suffixOf(m.ticker), label: String(m.yes_sub_title ?? m.subtitle ?? ""), status: String(m.status ?? ""), result: String(m.result ?? ""),
    closeTime: s(m.close_time), expectedAt: s(m.expected_expiration_time) ?? s(m.occurrence_datetime),
  } : null)).filter((m): m is KalshiEventMarket => m !== null);
  const pm = e.product_metadata as Record<string, unknown> | undefined;
  const times = (k: "expectedAt" | "closeTime") => markets.map((m) => m[k]).filter((x): x is string => !!x).sort()[0] ?? null;
  return { eventTicker: e.event_ticker, seriesTicker: String(e.series_ticker ?? e.event_ticker.split("-")[0]), title: String(e.title ?? e.event_ticker), subTitle: s(e.sub_title), category: s(e.category), competition: s(pm?.competition), expectedAt: times("expectedAt"), closeTime: times("closeTime"), markets };
}

export function parseEventsBody(body: unknown): { events: KalshiEvent[]; cursor: string | null } {
  const b = body as { events?: unknown; cursor?: unknown } | null;
  if (!b || !Array.isArray(b.events)) return { events: [], cursor: null };
  return { events: b.events.map(parseEvent).filter((x): x is KalshiEvent => x !== null), cursor: typeof b.cursor === "string" && b.cursor ? b.cursor : null };
}

// ---- the team-alias table ------------------------------------------------------------------------------------------------------

export interface TeamAlias { league: string; series: string; abbr: string; city: string; nickname: string; alt: string[] }

// league|Kalshi abbreviation|city (Kalshi's yes_sub_title where it differs from common use, the common form in alt)|nickname|alt abbreviations and names
const TEAMS = `
NFL|ARI|Arizona|Cardinals|
NFL|ATL|Atlanta|Falcons|
NFL|BAL|Baltimore|Ravens|
NFL|BUF|Buffalo|Bills|
NFL|CAR|Carolina|Panthers|
NFL|CHI|Chicago|Bears|
NFL|CIN|Cincinnati|Bengals|
NFL|CLE|Cleveland|Browns|
NFL|DAL|Dallas|Cowboys|
NFL|DEN|Denver|Broncos|
NFL|DET|Detroit|Lions|
NFL|GB|Green Bay|Packers|GNB
NFL|HOU|Houston|Texans|
NFL|IND|Indianapolis|Colts|
NFL|JAC|Jacksonville|Jaguars|JAX,jags
NFL|KC|Kansas City|Chiefs|KAN
NFL|LV|Las Vegas|Raiders|LVR,OAK
NFL|LAC|Los Angeles C|Chargers|Los Angeles Chargers
NFL|LAR|Los Angeles R|Rams|LA,Los Angeles Rams
NFL|MIA|Miami|Dolphins|
NFL|MIN|Minnesota|Vikings|
NFL|NE|New England|Patriots|NWE,pats
NFL|NO|New Orleans|Saints|NOLA,NOR
NFL|NYG|New York G|Giants|New York Giants
NFL|NYJ|New York J|Jets|New York Jets
NFL|PHI|Philadelphia|Eagles|philly
NFL|PIT|Pittsburgh|Steelers|
NFL|SF|San Francisco|49ers|SFO,niners
NFL|SEA|Seattle|Seahawks|
NFL|TB|Tampa Bay|Buccaneers|TAM,bucs
NFL|TEN|Tennessee|Titans|
NFL|WAS|Washington|Commanders|WSH
NBA|ATL|Atlanta|Hawks|
NBA|BOS|Boston|Celtics|
NBA|BKN|Brooklyn|Nets|BRK
NBA|CHA|Charlotte|Hornets|CHO
NBA|CHI|Chicago|Bulls|
NBA|CLE|Cleveland|Cavaliers|cavs
NBA|DAL|Dallas|Mavericks|mavs
NBA|DEN|Denver|Nuggets|
NBA|DET|Detroit|Pistons|
NBA|GSW|Golden State|Warriors|GS
NBA|HOU|Houston|Rockets|
NBA|IND|Indiana|Pacers|
NBA|LAC|Los Angeles C|Clippers|Los Angeles Clippers
NBA|LAL|Los Angeles L|Lakers|Los Angeles Lakers
NBA|MEM|Memphis|Grizzlies|
NBA|MIA|Miami|Heat|
NBA|MIL|Milwaukee|Bucks|
NBA|MIN|Minnesota|Timberwolves|wolves
NBA|NOP|New Orleans|Pelicans|NO
NBA|NYK|New York|Knicks|NY
NBA|OKC|Oklahoma City|Thunder|
NBA|ORL|Orlando|Magic|
NBA|PHI|Philadelphia|76ers|sixers
NBA|PHX|Phoenix|Suns|PHO
NBA|POR|Portland|Trail Blazers|blazers
NBA|SAC|Sacramento|Kings|
NBA|SAS|San Antonio|Spurs|SA
NBA|TOR|Toronto|Raptors|
NBA|UTA|Utah|Jazz|UTAH
NBA|WAS|Washington|Wizards|WSH
NHL|ANA|Anaheim|Ducks|
NHL|BOS|Boston|Bruins|
NHL|BUF|Buffalo|Sabres|
NHL|CGY|Calgary|Flames|
NHL|CAR|Carolina|Hurricanes|canes
NHL|CHI|Chicago|Blackhawks|
NHL|COL|Colorado|Avalanche|avs
NHL|CBJ|Columbus|Blue Jackets|
NHL|DAL|Dallas|Stars|
NHL|DET|Detroit|Red Wings|
NHL|EDM|Edmonton|Oilers|
NHL|FLA|Florida|Panthers|
NHL|LA|Los Angeles|Kings|LAK
NHL|MIN|Minnesota|Wild|
NHL|MTL|Montreal|Canadiens|habs
NHL|NSH|Nashville|Predators|preds
NHL|NJ|New Jersey|Devils|NJD
NHL|NYI|New York I|Islanders|New York Islanders
NHL|NYR|New York R|Rangers|New York Rangers
NHL|OTT|Ottawa|Senators|sens
NHL|PHI|Philadelphia|Flyers|
NHL|PIT|Pittsburgh|Penguins|pens
NHL|SJ|San Jose|Sharks|SJS
NHL|SEA|Seattle|Kraken|
NHL|STL|St. Louis|Blues|
NHL|TB|Tampa Bay|Lightning|TBL,bolts
NHL|TOR|Toronto|Maple Leafs|leafs
NHL|UTA|Utah|Mammoth|
NHL|VAN|Vancouver|Canucks|
NHL|VGK|Vegas|Golden Knights|VEG
NHL|WSH|Washington|Capitals|caps
NHL|WPG|Winnipeg|Jets|
MLB|ARI|Arizona|Diamondbacks|AZ,dbacks
MLB|ATH|Athletics|Athletics|OAK,A's
MLB|ATL|Atlanta|Braves|
MLB|BAL|Baltimore|Orioles|
MLB|BOS|Boston|Red Sox|
MLB|CHC|Chicago C|Cubs|Chicago Cubs
MLB|CWS|Chicago WS|White Sox|CHW,Chicago White Sox
MLB|CIN|Cincinnati|Reds|
MLB|CLE|Cleveland|Guardians|
MLB|COL|Colorado|Rockies|
MLB|DET|Detroit|Tigers|
MLB|HOU|Houston|Astros|
MLB|KC|Kansas City|Royals|KCR
MLB|LAA|Los Angeles A|Angels|Los Angeles Angels
MLB|LAD|Los Angeles D|Dodgers|Los Angeles Dodgers
MLB|MIA|Miami|Marlins|
MLB|MIL|Milwaukee|Brewers|
MLB|MIN|Minnesota|Twins|
MLB|NYM|New York M|Mets|New York Mets
MLB|NYY|New York Y|Yankees|New York Yankees
MLB|PHI|Philadelphia|Phillies|
MLB|PIT|Pittsburgh|Pirates|
MLB|SD|San Diego|Padres|SDP
MLB|SF|San Francisco|Giants|SFG
MLB|SEA|Seattle|Mariners|
MLB|STL|St. Louis|Cardinals|
MLB|TB|Tampa Bay|Rays|TBR
MLB|TEX|Texas|Rangers|
MLB|TOR|Toronto|Blue Jays|
MLB|WSH|Washington|Nationals|WSN,nats
`;
const LEAGUE_SERIES: Record<string, string> = { NFL: "KXNFLGAME", NBA: "KXNBAGAME", NHL: "KXNHLGAME", MLB: "KXMLBGAME" };

export const TEAM_ALIASES: TeamAlias[] = TEAMS.trim().split("\n").map((l) => {
  const [league, abbr, city, nickname, alt] = l.split("|");
  return { league, series: LEAGUE_SERIES[league], abbr, city, nickname, alt: alt ? alt.split(",").map((x) => x.trim()).filter(Boolean) : [] };
});

const norm = (x: string): string => x.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim();

/** Teams a query names: a nickname, a city, Kalshi's abbreviation or a common alternative (whole words; "eagles", "jax", "philadelphia"). */
export function aliasLookup(q: string, aliases: readonly TeamAlias[] = TEAM_ALIASES): TeamAlias[] {
  const n = ` ${norm(q)} `;
  if (n.trim() === "") return [];
  return aliases.filter((a) => [a.nickname, a.city, a.abbr, ...a.alt].some((k) => { const kk = norm(k); return kk.length >= 2 && n.includes(` ${kk} `); }));
}

// ---- matching -------------------------------------------------------------------------------------------------------------------

export interface EventHit extends KalshiEvent {
  score: number;
  /** The market suffixes (sides) the query named, e.g. ["PHI"] for "eagles" on KXNFLGAME-26OCT11PHIJAC; [] when the query matched the event as a whole. */
  matchedSides: string[];
  /** Why it matched: the words and where they were found. */
  matched: string[];
}

/**
 * Every event that matches EVERY word of the query (after alias expansion: "eagles" also tries PHI / Philadelphia on NFL events, "jax"
 * also tries JAC / Jacksonville / Jaguars), against title, event ticker, sub-title, market labels and market suffixes. Ranked by how
 * many words hit an exact side (a market), then by the earliest expected result.
 */
export function matchEvents(events: readonly KalshiEvent[], q: string, aliases: readonly TeamAlias[] = TEAM_ALIASES): EventHit[] {
  const words = norm(q).split(" ").filter((w) => w.length >= 2);
  if (!words.length) return [];
  const teamHits = aliasLookup(q, aliases);
  const out: EventHit[] = [];
  for (const e of events) {
    const head = ` ${norm([e.title, e.subTitle ?? "", e.eventTicker.replace(/-/g, " ")].join(" "))} `;
    const sides = e.markets.map((m) => ({ suffix: m.suffix, text: ` ${norm(`${m.label} ${m.suffix}`)} ` }));
    let score = 0; const matchedSides = new Set<string>(); const matched: string[] = []; let all = true;
    for (const w of words) {
      // A word may be (part of) a team name: try the alias rows for this event's series that contain the word.
      const teams = teamHits.filter((t) => t.series === e.seriesTicker && [t.nickname, t.city, t.abbr, ...t.alt].some((k) => norm(k).split(" ").includes(w) || norm(k) === w));
      const side = sides.find((sd) => sd.text.includes(` ${w} `) || teams.some((t) => sd.suffix === t.abbr));
      const inHead = head.includes(` ${w} `) || head.includes(` ${w}`) || teams.some((t) => head.includes(` ${norm(t.nickname)} `) || head.includes(` ${t.abbr.toLowerCase()} `));
      if (side) { matchedSides.add(side.suffix); score += 3; matched.push(`${w} → ${side.suffix}`); }
      else if (inHead) { score += 1; matched.push(`${w} → event`); }
      else { all = false; break; }
    }
    if (all) out.push({ ...e, score, matchedSides: [...matchedSides], matched });
  }
  return out.sort((a, b) => b.score - a.score || (a.expectedAt ?? "9").localeCompare(b.expectedAt ?? "9") || a.eventTicker.localeCompare(b.eventTicker));
}

// ---- a game's two sides ---------------------------------------------------------------------------------------------------------

export interface GameSide { abbr: string; marketTicker: string; label: string; nickname: string | null; name: string; ticker: string }

/**
 * The two teams of a head-to-head game event (a third "TIE" market — soccer — is reported separately). Names come from the title
 * ("PHI Eagles vs JAC Jaguars" → Eagles / Jaguars, matched to the markets by abbreviation) and the market labels (Philadelphia /
 * Jacksonville), with the alias table filling nicknames the title leaves out ("Los Angeles C vs Toronto" on NBA). Suggested coin
 * tickers are the nickname in capitals (2–10 of A–Z/0–9). Null when the event is not a two-team game.
 */
export function gameSides(e: KalshiEvent, aliases: readonly TeamAlias[] = TEAM_ALIASES): { a: GameSide; b: GameSide; tie: KalshiEventMarket | null } | null {
  // Sides in the order the title lists them ("PHI Eagles vs JAC Jaguars" → PHI first), whatever order the API returned the markets in.
  const at = (m: KalshiEventMarket) => { const t = ` ${e.title.toUpperCase()} `; const i = t.indexOf(` ${m.suffix} `); const j = t.indexOf(` ${m.label.toUpperCase()}`); return i >= 0 ? i : j >= 0 ? j : 9999; };
  const teams = e.markets.filter((m) => m.suffix !== "TIE").sort((x, y) => at(x) - at(y) || x.suffix.localeCompare(y.suffix));
  if (teams.length !== 2) return null;
  const tie = e.markets.find((m) => m.suffix === "TIE") ?? null;
  const parts = e.title.replace(/^Game \d+:\s*/i, "").split(/\s+vs\.?\s+|\s+at\s+|\s+@\s+/i);
  const side = (m: KalshiEventMarket): GameSide => {
    const fromTitle = parts.map((p) => p.trim()).find((p) => p.split(" ")[0] === m.suffix);
    const alias = aliases.find((a) => a.series === e.seriesTicker && a.abbr === m.suffix);
    const nickname = (fromTitle ? fromTitle.split(" ").slice(1).join(" ") : "") || alias?.nickname || null;
    const city = m.label.replace(/\s+[A-Z]{1,2}$/, "");   // "Los Angeles C" → "Los Angeles", "Chicago WS" → "Chicago"
    const name = nickname && !norm(city).includes(norm(nickname)) ? `${city} ${nickname}` : m.label;
    const raw = (nickname ?? m.label).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
    return { abbr: m.suffix, marketTicker: m.ticker, label: m.label, nickname, name: name.slice(0, 32), ticker: raw.length >= 2 ? raw : m.suffix };
  };
  return { a: side(teams[0]), b: side(teams[1]), tie };
}

/** The selector filter for "every <team> game": the team's OWN leg ("-PHI"); a bare "PHI" also matches the opponent's leg of PHI games. */
export const ownLegFilter = (abbr: string): string => `-${abbr}`;

/** Other abbreviations in the same series that would also match `-ABBR` as a ticker substring (e.g. "-LA" vs "-LAC") — the wizard warns. */
export function legFilterCollisions(abbr: string, series: string, aliases: readonly TeamAlias[] = TEAM_ALIASES): string[] {
  return aliases.filter((a) => a.series === series && a.abbr !== abbr && a.abbr.startsWith(abbr)).map((a) => a.abbr);
}

// ---- the matchup leagues ---------------------------------------------------------------------------------------------------------

export interface MatchupLeague { id: string; label: string; series: { ticker: string; title: string }[] }

/** The wizard's league chooser, in order; each lists the game series it covers when the Sports series list has them. */
const LEAGUE_PICKS: { id: string; label: string; tickers: string[]; names?: Record<string, string> }[] = [
  { id: "nfl", label: "NFL", tickers: ["KXNFLGAME"] },
  { id: "nba", label: "NBA", tickers: ["KXNBAGAME"] },
  { id: "mlb", label: "MLB", tickers: ["KXMLBGAME"] },
  { id: "nhl", label: "NHL", tickers: ["KXNHLGAME"] },
  { id: "ncaa", label: "NCAA", tickers: ["KXNCAAFGAME", "KXNCAAMBGAME", "KXNCAAWBGAME"], names: { KXNCAAFGAME: "Football", KXNCAAMBGAME: "Men's basketball", KXNCAAWBGAME: "Women's basketball" } },
  { id: "soccer", label: "Soccer", tickers: ["KXEPLGAME", "KXMLSGAME", "KXUCLGAME", "KXLALIGAGAME", "KXSERIEAGAME", "KXBUNDESLIGAGAME", "KXLIGUE1GAME", "KXLIGAMXGAME", "KXNWSLGAME", "KXUELGAME", "KXWCGAME"] },
];

/** Head-to-head game series ("…GAME" tickers in Sports) grouped into the chooser's leagues; only series the list actually carries. */
export function matchupLeagues(sports: readonly SeriesSummary[]): MatchupLeague[] {
  const game = new Map(sports.filter((x) => /GAME$/.test(x.ticker)).map((x) => [x.ticker, x]));
  return LEAGUE_PICKS.map((l) => ({ id: l.id, label: l.label, series: l.tickers.filter((t) => game.has(t)).map((t) => ({ ticker: t, title: l.names?.[t] ?? game.get(t)!.title.replace(/ Game$/, "") })) })).filter((l) => l.series.length > 0);
}
export const MATCHUP_SERIES: string[] = LEAGUE_PICKS.flatMap((l) => l.tickers);

// ---- the team picker (team coins) ----------------------------------------------------------------------------------------------

/** Month (1–12) and day each league's season starts, for "record so far this season"; a date before it in the year → last year's start. */
const SEASON_START: Record<string, [number, number]> = { KXNFLGAME: [9, 1], KXNCAAFGAME: [8, 20], KXNBAGAME: [10, 1], KXNHLGAME: [10, 1], KXNCAAMBGAME: [11, 1], KXNCAAWBGAME: [11, 1], KXMLBGAME: [3, 15] };
export function seasonStart(series: string, nowMs: number): string {
  const [m, d] = SEASON_START[series] ?? [7, 1];
  const now = new Date(nowMs), y = now.getUTCFullYear();
  const start = Date.UTC(y, m - 1, d);
  return new Date(nowMs >= start ? start : Date.UTC(y - 1, m - 1, d)).toISOString();
}

/** The settled-market fields the record needs (KalshiMarket from kalshi.ts satisfies it). */
export interface SettledLeg { ticker: string; eventTicker: string; result: string; status: string; settlementTs: string | null; label?: string | null }

export interface TeamRow {
  abbr: string; city: string; nickname: string | null; name: string; ticker: string; league: string | null;
  /** The team's own leg filter for "every game" ("-PHI") and any other abbreviation it would also match. */
  filter: string; collisions: string[];
  next: { eventTicker: string; marketTicker: string; title: string; expectedAt: string | null; opponent: string | null } | null;
  record: { w: number; l: number; d: number; since: string };
}

/**
 * Every team of a game series, from its open events (names, the next game) and its settled markets since the season started (the
 * record: a team's own leg settled YES = a win, NO = a loss, and a YES on the event's TIE market = a draw). The alias table fills
 * names the events leave out. Sorted by city.
 */
export function buildTeams(series: string, open: readonly KalshiEvent[], settled: readonly SettledLeg[], nowMs: number, aliases: readonly TeamAlias[] = TEAM_ALIASES): { series: string; since: string; teams: TeamRow[] } {
  const since = seasonStart(series, nowMs);
  const rows = new Map<string, TeamRow>();
  const base = (abbr: string, label: string | null, nick: string | null): TeamRow => {
    const a = aliases.find((x) => x.series === series && x.abbr === abbr);
    const city = (label ?? a?.city ?? abbr).replace(/\s+[A-Z]{1,2}$/, "");
    const nickname = nick ?? a?.nickname ?? null;
    const name = nickname && !norm(city).includes(norm(nickname)) ? `${city} ${nickname}` : (label ?? a?.city ?? abbr);
    const raw = (nickname ?? city).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
    return { abbr, city, nickname, name: name.slice(0, 32), ticker: raw.length >= 2 ? raw : abbr, league: a?.league ?? null, filter: ownLegFilter(abbr), collisions: legFilterCollisions(abbr, series, aliases), next: null, record: { w: 0, l: 0, d: 0, since } };
  };
  for (const e of [...open].sort((x, y) => (x.expectedAt ?? "9").localeCompare(y.expectedAt ?? "9"))) {
    const g = gameSides(e, aliases);
    if (!g) continue;
    for (const [me, them] of [[g.a, g.b], [g.b, g.a]] as const) {
      const r = rows.get(me.abbr) ?? base(me.abbr, me.label, me.nickname);
      if (!r.next) r.next = { eventTicker: e.eventTicker, marketTicker: me.marketTicker, title: e.title, expectedAt: e.expectedAt, opponent: them.name };
      rows.set(me.abbr, r);
    }
  }
  const byEvent = new Map<string, SettledLeg[]>();
  for (const m of settled) if ((m.settlementTs ?? "") >= since && (m.result === "yes" || m.result === "no")) byEvent.set(m.eventTicker, [...(byEvent.get(m.eventTicker) ?? []), m]);
  for (const legs of byEvent.values()) {
    const tie = legs.find((m) => suffixOf(m.ticker) === "TIE" && m.result === "yes");
    for (const m of legs) {
      const abbr = suffixOf(m.ticker);
      if (abbr === "TIE") continue;
      const r = rows.get(abbr) ?? base(abbr, m.label ?? null, null);
      if (tie) r.record.d++; else if (m.result === "yes") r.record.w++; else r.record.l++;
      rows.set(abbr, r);
    }
  }
  return { series, since, teams: [...rows.values()].sort((a, b) => a.name.localeCompare(b.name)) };
}
