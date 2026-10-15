// THE FULL-SEASON SETTLEMENT REHEARSAL (owner, 2026-10-13: "how can we be sure the rest of the season and the playoffs settle before
// we launch?"). Replays a team's whole real past season, regular season and playoffs, through the keeper's own settlement path: the
// schedule from gamesFor (EspnClient.season: MLB StatsAPI, the NHL feed, TheSportsDB for every other league), then settleGame
// (gameSettle.ts) for every completed game with the real readers: the Polymarket game market (the league by start time, by end date, then
// the text search) and its payout vector on Polygon (readChain), TheSportsDB through tsdbFinalByDay, and the league's official feed.
// Then the keeper's own sportsSettled / meetingsSettled over the same (cached) reads, and the window's end and champion read.
// Reads only; sends nothing, signs nothing. Needs BURNTICKER_THESPORTSDB_KEY (only on the box).
//
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/alias-hook.mjs scripts/burnticker-season-rehearsal.mts \
//     --league nfl --team KC --year 2025 [--window season|post] [--opp LV] [--out file.json] [--now 2026-10-13T00:00:00Z]
//   … scripts/burnticker-season-rehearsal.mts --render a.json b.json …     (markdown tables from saved runs, no network)
//
// One line per game: date, matchup, the schedule's final, the verdict (settled / held / awaiting), the operators, the winner, and which
// Polymarket lookup found the market. Exits 1 when any completed game is held (and on a run whose schedule could not be read).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CHAMPION_KNOWN, LEAGUES, isLeague, outcomeOf, teamByAbbr, teamIdOf, type EspnSeries, type Game, type LeagueId, type Window } from "@/lib/burnticker/sources/espn";
import type { GameVerdict } from "@/lib/burnticker/sources/gameSettle";

// ---- pure parts (test/burntickerSeasonRehearsal.test.ts) ----------------------------------------------------------------------

export interface RehearsalArgs { league: LeagueId; team: string; year: number; window: "season" | "post"; opp: string | null; out: string | null; nowMs: number }
export function parseArgs(argv: readonly string[], nowMs = Date.now()): RehearsalArgs | { error: string } {
  const val = (k: string): string | null => { const i = argv.indexOf(k); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null; };
  const league = (val("--league") ?? "").toLowerCase(), team = (val("--team") ?? "").toUpperCase(), year = Number(val("--year"));
  if (!isLeague(league)) return { error: `--league must be one of ${Object.keys(LEAGUES).join(", ")}` };
  if (!team) return { error: "--team is required (the abbreviation, e.g. KC)" };
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return { error: "--year is required (the league's season year naming, e.g. 2025)" };
  const w = (val("--window") ?? "season").toLowerCase();
  if (w !== "season" && w !== "post") return { error: "--window must be season or post" };
  const now = val("--now");
  return { league, team, year, window: w, opp: val("--opp")?.toUpperCase() ?? null, out: val("--out"), nowMs: now ? Date.parse(now) : nowMs };
}

/** The series a coin on the team's wins for the window would carry (a rivalry series with --opp). */
export function seriesFor(a: Pick<RehearsalArgs, "league" | "team" | "year" | "window" | "opp">): Extract<EspnSeries, { kind: "team" }> {
  const teamId = teamIdOf(a.league, a.team);
  const oppId = a.opp ? teamIdOf(a.league, a.opp) ?? "" : "";
  const window: Window = a.opp ? { kind: "meetings", year: a.year, opp: a.opp, oppId } : { kind: a.window, year: a.year };
  return { kind: "team", league: a.league, abbr: a.team, teamId, outcome: "win", window };
}

/** Which Polymarket lookup found the game's market: the league's events by start time, by end date, the text search; none; or an error. */
export type Lookup = "start window" | "end window" | "text search" | "none" | "error";
export const LOOKUPS: readonly Lookup[] = ["start window", "end window", "text search", "none", "error"];
export const lookupLine = (s: Pick<Summary, "lookups">): string => `found by start time ${s.lookups["start window"] ?? 0}, by end date ${s.lookups["end window"] ?? 0}, by the text search ${s.lookups["text search"] ?? 0}, no market ${s.lookups.none ?? 0}, lookup error ${s.lookups.error ?? 0}`;
export interface GameRow {
  date: string; startsAt: string; eventId: string; matchup: string; post: boolean;
  /** the schedule's own final ("away–home"), null when it has no scores */
  sched: string | null; schedWinner: "home" | "away" | "tie" | null;
  kind: "settled" | "held" | "awaiting" | "postponed" | "unplayed";
  ops: string[]; winner: string | null; why: string | null; final: string | null;
  lookup: Lookup | null; market: string | null; draw: boolean; pens: boolean; mismatch: boolean;
}
const winnerOf = (h: number, a: number): "home" | "away" | "tie" => (h > a ? "home" : h < a ? "away" : "tie");
export const POSTPONED = /postpon|cancel|suspend/i;

/** One game's row from the schedule listing and (for a completed game) the verdict. `v` null: not settled (postponed / unplayed). */
export function rowOf(g: Game, v: GameVerdict | null, lookup: Lookup | null, market: string | null): GameRow {
  const hs = g.home.score, as = g.away.score;
  const sched = hs !== null && as !== null ? `${as}–${hs}` : null;
  const schedWinner = hs !== null && as !== null ? winnerOf(hs, as) : null;
  const base = { date: g.date, startsAt: g.startsAt, eventId: g.eventId, matchup: `${g.away.abbr} @ ${g.home.abbr}`, post: g.seasonType === 3, sched, schedWinner, lookup, market };
  if (!v) {
    const kind = POSTPONED.test(g.detail) || g.state === "post" ? "postponed" : "unplayed";
    return { ...base, kind, ops: [], winner: null, why: g.detail || null, final: null, draw: false, pens: false, mismatch: false };
  }
  if (v.kind !== "settled") return { ...base, kind: v.kind, ops: [], winner: null, why: v.why, final: null, draw: false, pens: false, mismatch: false };
  const winner = v.winner === "tie" ? "draw" : v.winner === "home" ? g.home.abbr : g.away.abbr;
  const final = v.final ? `${v.final.away}–${v.final.home}` : null;
  const pens = v.winner !== "tie" && !!v.final && v.final.home === v.final.away;
  // the schedule's own winner against the settled one (a shoot-out level on goals is not a mismatch)
  const mismatch = schedWinner !== null && !pens && schedWinner !== v.winner;
  return { ...base, kind: "settled", ops: v.ops, winner, why: null, final, draw: v.winner === "tie", pens, mismatch };
}

export function formatRow(r: GameRow): string {
  const ops = r.ops.length ? r.ops.join("+") : "-";
  const tail = r.kind === "settled" ? `winner ${r.winner}${r.final ? ` (${r.final})` : ""}${r.pens ? " on penalties" : ""}${r.mismatch ? "  !! schedule says otherwise" : ""}` : r.why ?? "";
  return `${r.date}  ${r.post ? "P" : "R"}  ${r.matchup.padEnd(14)}  sched ${(r.sched ?? "-").padEnd(7)}  ${r.kind.padEnd(9)}  ${ops.padEnd(34)}  market:${(r.lookup ?? "-").padEnd(13)}  ${tail}`;
}

export interface Summary {
  listed: number; completed: number; settled: number; settledTwoOps: number; held: number; awaiting: number; postponed: number; unplayed: number;
  draws: number; pens: number; mismatches: number; byOps: Record<string, number>; lookups: Record<Lookup, number>;
  heldRows: { date: string; matchup: string; why: string }[]; awaitingRows: { date: string; matchup: string; why: string }[];
}
export function summarise(rows: readonly GameRow[]): Summary {
  const s: Summary = { listed: rows.length, completed: 0, settled: 0, settledTwoOps: 0, held: 0, awaiting: 0, postponed: 0, unplayed: 0, draws: 0, pens: 0, mismatches: 0, byOps: {}, lookups: Object.fromEntries(LOOKUPS.map((k) => [k, 0])) as Record<Lookup, number>, heldRows: [], awaitingRows: [] };
  for (const r of rows) {
    if (r.kind === "postponed") { s.postponed++; continue; }
    if (r.kind === "unplayed") { s.unplayed++; continue; }
    s.completed++;
    if (r.lookup) s.lookups[r.lookup]++;
    if (r.kind === "held") { s.held++; s.heldRows.push({ date: r.date, matchup: r.matchup, why: r.why ?? "" }); continue; }
    if (r.kind === "awaiting") { s.awaiting++; s.awaitingRows.push({ date: r.date, matchup: r.matchup, why: r.why ?? "" }); continue; }
    s.settled++;
    if (r.ops.length >= 2) s.settledTwoOps++;
    const k = r.ops.join("+"); s.byOps[k] = (s.byOps[k] ?? 0) + 1;
    if (r.draw) s.draws++;
    if (r.pens) s.pens++;
    if (r.mismatch) s.mismatches++;
  }
  return s;
}
export const exitCodeOf = (s: Summary): number => (s.held > 0 || s.completed === 0 ? 1 : 0);
/** The league verdict: every completed game settled; a few did not (under 10%); or the league does not settle (10% or more, or no games read). */
export function verdictOf(s: Summary): "settles every game" | "settles with gaps" | "does not settle" {
  if (s.completed === 0) return "does not settle";
  const gaps = s.held + s.awaiting;
  return gaps === 0 && s.mismatches === 0 ? "settles every game" : gaps / s.completed < 0.1 ? "settles with gaps" : "does not settle";
}

/**
 * The champion read at the end. championOf answers only for a league in CHAMPION_KNOWN (MLB, NBA, NHL); for any other league this says
 * what the same rule WOULD read from the schedule's last completed game (a regular-season last game: not champion; a postseason game:
 * its result), so the gap is visible: a league whose schedule never marks a postseason game would read every team as "not champion".
 */
export function championRead(s: Extract<EspnSeries, { kind: "team" }>, games: readonly Game[], champion: boolean | null | undefined): string {
  const lastDone = [...games].filter((g) => g.completed).sort((a, b) => a.startsAt.localeCompare(b.startsAt)).pop() ?? null;
  const post = games.filter((g) => g.seasonType === 3).length;
  const would = !lastDone ? null : lastDone.seasonType === 2 ? false : lastDone.seasonType !== 3 ? null : ((o) => (o === "win" ? true : o === "loss" ? false : null))(outcomeOf(lastDone, s.abbr, s.teamId));
  const last = lastDone ? `last completed game ${lastDone.date} ${lastDone.away.abbr} @ ${lastDone.home.abbr} (${lastDone.seasonType === 3 ? "postseason" : lastDone.seasonType === 2 ? "regular season" : "unmarked"}); ${post} game${post === 1 ? "" : "s"} marked postseason` : "no completed game";
  if (CHAMPION_KNOWN.has(s.league)) return `champion: ${champion === undefined ? "not read (it is read only when a whole-season window has ended)" : String(champion)} — ${last}`;
  return `champion: not read (${LEAGUES[s.league].label} is outside CHAMPION_KNOWN, the season coin keeps the plain end); the same rule would read ${would === null ? "null" : String(would)} — ${last}`;
}

export interface RunRecord { args: Omit<RehearsalArgs, "out">; team: string; rows: GameRow[]; summary: Summary; window: { ended: boolean; reason: string; endsAt: string | null; champion: string }; keeper: { days: number; awaiting: number; refusals: string[]; reason: string } | null; requests: { schedule: number; gamma: number; chain: number }; error: string | null; seconds: number }

const esc = (x: string) => x.replace(/\|/g, "\\|");
export function renderMarkdown(runs: readonly RunRecord[]): string {
  const out: string[] = [];
  for (const r of runs) {
    const s = r.summary;
    out.push(`### ${LEAGUES[r.args.league].label}: ${r.team} ${r.args.year}${r.args.opp ? ` vs ${r.args.opp} (rivalry series)` : r.args.window === "post" ? " (postseason only)" : ""}`, "");
    if (r.error) { out.push(`**The run failed:** ${esc(r.error)}`, ""); continue; }
    out.push(`Verdict: **${verdictOf(s)}**. ${s.completed} completed games: ${s.settled} settled by two or more operators, ${s.held} held, ${s.awaiting} awaiting; ${s.postponed} postponed or cancelled listings, ${s.unplayed} listings never played. Draws ${s.draws}, decided on penalties ${s.pens}, schedule-vs-settled mismatches ${s.mismatches}.`, "");
    out.push(`Markets: ${lookupLine(s)}. Operator mix: ${Object.entries(s.byOps).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}.`, "");
    out.push(`Window: ${r.window.ended ? "ended" : "open"} (${esc(r.window.reason)}). ${esc(r.window.champion)}.`, "");
    if (r.keeper) out.push(`Keeper path (sportsSettled over the same reads): ${r.keeper.days} day readings, ${r.keeper.awaiting} awaiting, ${r.keeper.refusals.length} refusals; window: ${esc(r.keeper.reason)}.`, "");
    out.push("| Date | | Matchup | Schedule | Verdict | Operators | Winner | Market | Note |", "|---|---|---|---|---|---|---|---|---|");
    for (const g of r.rows) out.push(`| ${g.date} | ${g.post ? "P" : "R"} | ${g.matchup} | ${g.sched ?? ""} | ${g.kind} | ${g.ops.join(" + ")} | ${g.winner ?? ""}${g.pens ? " (pens)" : ""} | ${g.lookup ?? ""} | ${esc((g.mismatch ? "schedule says otherwise; " : "") + (g.kind === "settled" ? "" : g.why ?? "")).slice(0, 220)} |`);
    out.push("");
  }
  return out.join("\n");
}

// ---- the live run ------------------------------------------------------------------------------------------------------------

async function main(a: RehearsalArgs): Promise<number> {
  const t0 = Date.now();
  const env = process.env;
  const { EspnClient, gamesFor } = await import("@/lib/burnticker/sources/espn");
  const { envGameDeps, polymarketGameReaders, settleGame, sportsSettled, POSTPONED_RE, memoryHoldStore, holdKeyOf, SINGLE_SOURCE_HOLD_MS } = await import("@/lib/burnticker/sources/gameSettle");
  const { PolymarketClient } = await import("@/lib/burnticker/oracle/polymarket");
  const { refuseTitles } = await import("@/lib/burnticker/server");
  const { windowStatus } = await import("@/lib/burnticker/sources/espn");
  if (!teamByAbbr(a.league, a.team)) { console.error(`no ${a.league} team ${a.team}`); return 2; }
  const s = seriesFor(a);
  // the same readers the keeper builds (server.ts platform()), paced and with long caches so the keeper pass re-reads nothing
  const client = new EspnClient({ minIntervalMs: Number(env.REHEARSAL_SPORTS_MS ?? 900), ttlMs: 24 * 3600_000 });
  const rpcUrls = [...(env.BURNTICKER_POLYGON_RPC_URLS ?? "").split(","), env.BURNTICKER_POLYGON_RPC_URL ?? ""].map((x) => x.trim()).filter((x) => /^https:\/\//.test(x));
  const poly = new PolymarketClient({ refuse: refuseTitles, minIntervalMs: Number(env.REHEARSAL_GAMMA_MS ?? 500), ttlMs: 24 * 3600_000, ...(rpcUrls.length ? { rpcUrls } : {}) });
  // the keeper's readers over the real client, each lookup traced: the readers try the league's events by START time, then by END date,
  // then the text search, and return on the first hit, so the last one called before a hit is the one that found it
  const trace = { last: null as Lookup | null, error: null as string | null };
  const via = <T,>(k: Lookup, p: () => Promise<T>): Promise<T> => { trace.last = k; return p().catch((e: Error) => { trace.error = `${k}: ${e.message}`; throw e; }); };
  const traced = {
    search: (q: string, o?: { status?: "open" | "closed" | "all"; limit?: number }) => via("text search", () => poly.search(q, o)),
    eventsStarting: (slug: string, min: string, max: string) => via("start window", () => poly.eventsStarting(slug, min, max)),
    eventsInWindow: (slug: string, min: string, max: string) => via("end window", () => poly.eventsInWindow(slug, min, max)),
    readChain: (id: string) => poly.readChain(id),
  };
  const readers = polymarketGameReaders(traced);
  let lastLookup: Lookup | null = null, lastMarket: string | null = null;
  // ONE SOURCE (owner 2026-10-14): a game only TheSportsDB can read settles after its final has stood 12 hours. The rehearsal keeps the
  // hold in memory and re-reads such a game once on a clock moved 12 hours on (the reads are cached), so it shows how the keeper settles it.
  const holds = memoryHoldStore(), clock = { t: a.nowMs };
  const deps = {
    ...envGameDeps(env),
    holds, now: () => clock.t,
    payout: readers.payout,
    market: async (g: Game) => {
      trace.last = null; trace.error = null;
      try {
        const m = await readers.market!(g);
        // (the readers set the trace while the await ran; read it unnarrowed)
        const t: { last: Lookup | null; error: string | null } = { ...trace };
        lastLookup = m ? t.last ?? "none" : t.error ? "error" : "none"; lastMarket = m?.question ?? (t.error ? t.error.slice(0, 120) : null);
        return m;
      } catch (e) { lastLookup = "error"; lastMarket = (e as Error).message.slice(0, 120); throw e; }
    },
  };
  if (!deps.tsdbKey) console.error("warning: BURNTICKER_THESPORTSDB_KEY is not set on this host: TheSportsDB reads are off (run this on the box)");
  const label = `${LEAGUES[a.league].label} ${a.team} ${a.year}${a.opp ? ` vs ${a.opp}` : a.window === "post" ? " postseason" : ""}`;
  let games: Game[] = [], season: Game[] = [];
  const record: RunRecord = { args: { league: a.league, team: a.team, year: a.year, window: a.window, opp: a.opp, nowMs: a.nowMs }, team: teamByAbbr(a.league, a.team)!.nickname, rows: [], summary: summarise([]), window: { ended: false, reason: "", endsAt: null, champion: "" }, keeper: null, requests: { schedule: 0, gamma: 0, chain: 0 }, error: null, seconds: 0 };
  try {
    games = await gamesFor(client, s, null);
    season = s.window.kind === "post" ? await client.season(a.league, s.teamId ?? a.team, a.year) : games;
  } catch (e) { record.error = `schedule: ${(e as Error).message}`; }
  console.log(`# ${label}: ${games.length} listed games`);
  for (const g of games) {
    // the keeper's own filter (sportsSettled): only a completed game or one the schedule calls over is settled; postponed is skipped
    if (!g.completed && g.state !== "post") { record.rows.push(rowOf(g, null, null, null)); console.log(formatRow(record.rows.at(-1)!)); continue; }
    if (!g.completed && POSTPONED_RE.test(g.detail)) { record.rows.push(rowOf(g, null, null, null)); console.log(formatRow(record.rows.at(-1)!)); continue; }
    lastLookup = null; lastMarket = null;
    let v: GameVerdict;
    clock.t = a.nowMs;
    try { v = await settleGame(client, g, deps); } catch (e) { v = { kind: "held", why: `settleGame threw: ${(e as Error).message.slice(0, 160)}` }; }
    if (v.kind === "awaiting" && holds.get(holdKeyOf(g))) { clock.t = a.nowMs + SINGLE_SOURCE_HOLD_MS; try { v = await settleGame(client, g, deps); } catch (e) { v = { kind: "held", why: `settleGame threw: ${(e as Error).message.slice(0, 160)}` }; } }
    const row = rowOf(g, v, lastLookup, lastMarket);
    record.rows.push(row); console.log(formatRow(row));
  }
  record.summary = summarise(record.rows);
  if (!record.error) {
    const st = windowStatus(s, season, a.nowMs);
    record.window = { ended: st.ended, reason: st.reason, endsAt: st.endsAt, champion: s.window.kind === "meetings" ? "champion: not applicable (rivalry series)" : championRead(s, season, st.champion) };
    try {
      clock.t = a.nowMs + SINGLE_SOURCE_HOLD_MS;
      const k = await sportsSettled(client, s, null, deps, { nowMs: a.nowMs });
      const ser = k.window?.series as { wins?: number; losses?: number; draws?: number } | null | undefined;
      record.keeper = { days: k.events.length, awaiting: k.awaitingFinal, refusals: k.refusals, reason: `${k.window?.ended ? "ended" : "open"}: ${k.window?.reason ?? ""}${ser ? ` (series ${ser.wins}–${ser.losses}${ser.draws ? `–${ser.draws}` : ""})` : ""}` };
    } catch (e) { record.keeper = { days: 0, awaiting: 0, refusals: [`keeper pass threw: ${(e as Error).message.slice(0, 160)}`], reason: "" }; }
  }
  record.requests = { schedule: client.requests.length, gamma: poly.requests.length, chain: poly.chainReads.length };
  record.seconds = Math.round((Date.now() - t0) / 1000);
  const sm = record.summary;
  console.log(`\n## ${label}`);
  if (record.error) console.log(`run failed: ${record.error}`);
  console.log(`games listed ${sm.listed}; completed ${sm.completed}; settled by two operators ${sm.settledTwoOps}; held ${sm.held}; awaiting ${sm.awaiting}; postponed/cancelled ${sm.postponed}; never played ${sm.unplayed}`);
  console.log(`draws ${sm.draws}; on penalties ${sm.pens}; schedule-vs-settled mismatches ${sm.mismatches}; operators ${JSON.stringify(sm.byOps)}`);
  console.log(`markets: ${lookupLine(sm)}`);
  for (const h of sm.heldRows) console.log(`HELD     ${h.date} ${h.matchup}: ${h.why}`);
  for (const h of sm.awaitingRows) console.log(`AWAITING ${h.date} ${h.matchup}: ${h.why}`);
  console.log(`window: ${record.window.ended ? "ended" : "open"} (${record.window.reason}); ${record.window.champion}`);
  if (record.keeper) console.log(`keeper path: ${record.keeper.days} day readings, ${record.keeper.awaiting} awaiting, refusals ${record.keeper.refusals.length}; window ${record.keeper.reason}`);
  console.log(`verdict: ${verdictOf(sm)}; requests: schedule/TheSportsDB/feeds ${record.requests.schedule}, Gamma ${record.requests.gamma}, Polygon ${record.requests.chain}; ${record.seconds}s`);
  if (a.out) fs.writeFileSync(a.out, JSON.stringify(record, null, 1));
  return record.error ? 1 : exitCodeOf(sm);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  if (argv[0] === "--render") {
    process.stdout.write(renderMarkdown(argv.slice(1).map((f) => JSON.parse(fs.readFileSync(f, "utf8")) as RunRecord)));
  } else {
    const a = parseArgs(argv);
    if ("error" in a) { console.error(a.error); console.error(fs.readFileSync(new URL(import.meta.url), "utf8").split("\n").filter((l) => l.startsWith("//")).map((l) => l.slice(3)).join("\n")); process.exit(2); }
    main(a).then((c) => process.exit(c), (e) => { console.error(e); process.exit(1); });
  }
}
