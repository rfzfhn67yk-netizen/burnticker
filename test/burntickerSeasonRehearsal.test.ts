// THE FULL-SEASON SETTLEMENT REHEARSAL (scripts/burnticker-season-rehearsal.mts, 2026-10-13): its pure parts on fakes. The live run
// replays a past season through settleGame on the box; these pin the argument parsing, the series it builds, the per-game row, the
// summary, the exit code, the league verdict and the champion read.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseArgs, seriesFor, lookupLine, rowOf, formatRow, summarise, exitCodeOf, verdictOf, championRead, renderMarkdown, type GameRow, type RunRecord } from "../scripts/burnticker-season-rehearsal.mts";
import type { Game, GameSide } from "@/lib/burnticker/sources/espn";

const side = (abbr: string, homeAway: "home" | "away", score: number | null, id = ""): GameSide => ({ abbr, id, name: abbr, nickname: abbr, score, homeAway, record: null });
const game = (o: Partial<Game> & { h: string; a: string; hs: number | null; as: number | null; league?: Game["league"] }): Game => ({
  eventId: o.eventId ?? "1", league: o.league ?? "nfl", seasonType: o.seasonType ?? 2, seasonYear: 2025, startsAt: o.startsAt ?? "2025-09-14T20:25:00Z", date: (o.startsAt ?? "2025-09-14").slice(0, 10),
  name: `${o.a} at ${o.h}`, completed: o.completed ?? true, state: o.state ?? "post", detail: o.detail ?? "FT", home: side(o.h, "home", o.hs, o.h === "KC" ? "12" : ""), away: side(o.a, "away", o.as, o.a === "KC" ? "12" : ""),
});

describe("parseArgs and seriesFor", () => {
  test("a season run: league, team, year, default window", () => {
    const a = parseArgs(["--league", "nfl", "--team", "kc", "--year", "2025"], 1);
    assert.ok(!("error" in a));
    assert.equal(a.team, "KC"); assert.equal(a.window, "season"); assert.equal(a.opp, null); assert.equal(a.nowMs, 1);
    const s = seriesFor(a);
    assert.deepEqual(s.window, { kind: "season", year: 2025 }); assert.equal(s.teamId, "12"); assert.equal(s.outcome, "win");
  });
  test("postseason and rivalry windows", () => {
    const p = parseArgs(["--league", "nfl", "--team", "KC", "--year", "2025", "--window", "post"]);
    assert.ok(!("error" in p)); assert.deepEqual(seriesFor(p).window, { kind: "post", year: 2025 });
    const m = parseArgs(["--league", "nfl", "--team", "KC", "--year", "2025", "--opp", "lv"]);
    assert.ok(!("error" in m)); const w = seriesFor(m).window;
    assert.equal(w.kind, "meetings"); assert.equal(w.kind === "meetings" && w.opp, "LV"); assert.ok(w.kind === "meetings" && /^\d+$/.test(w.oppId));
  });
  test("refuses a bad league, a missing team, a bad year or window", () => {
    assert.ok("error" in parseArgs(["--league", "xfl", "--team", "KC", "--year", "2025"]));
    assert.ok("error" in parseArgs(["--league", "nfl", "--year", "2025"]));
    assert.ok("error" in parseArgs(["--league", "nfl", "--team", "KC"]));
    assert.ok("error" in parseArgs(["--league", "nfl", "--team", "KC", "--year", "2025", "--window", "next"]));
  });
});

describe("rowOf", () => {
  test("a settled game: winner abbreviation, operators, no mismatch", () => {
    const g = game({ h: "KC", a: "PHI", hs: 17, as: 20 });
    const r = rowOf(g, { kind: "settled", winner: "away", final: { home: 17, away: 20 }, settledOn: "on-chain payout", confirmedBy: "a licensed final score", ops: ["on-chain payout", "TheSportsDB"], detail: "", url: "" }, "start window", "Eagles vs. Chiefs");
    assert.equal(r.kind, "settled"); assert.equal(r.winner, "PHI"); assert.equal(r.final, "20–17"); assert.equal(r.sched, "20–17"); assert.equal(r.mismatch, false); assert.equal(r.matchup, "PHI @ KC");
    assert.match(formatRow(r), /settled .*on-chain payout\+TheSportsDB .*market:start window .*winner PHI/);
  });
  test("the schedule naming the other winner is a mismatch; a shoot-out level on goals is not", () => {
    const g = game({ h: "KC", a: "PHI", hs: 17, as: 20 });
    assert.equal(rowOf(g, { kind: "settled", winner: "home", final: null, settledOn: "on-chain payout", confirmedBy: "", ops: ["on-chain payout", "TheSportsDB"], detail: "", url: "" }, "start window", null).mismatch, true);
    const level = game({ h: "ARS", a: "RMA", hs: 1, as: 1, league: "uefa.champions" });
    const p = rowOf(level, { kind: "settled", winner: "home", final: { home: 1, away: 1 }, settledOn: "TheSportsDB", confirmedBy: "", ops: ["TheSportsDB", "apisports.games"], detail: "", url: "" }, "none", null);
    assert.equal(p.pens, true); assert.equal(p.mismatch, false); assert.equal(p.winner, "ARS");
  });
  test("a draw, a held game, a postponed and an unplayed listing", () => {
    const d = rowOf(game({ h: "ARS", a: "CHE", hs: 2, as: 2, league: "eng.1" }), { kind: "settled", winner: "tie", final: { home: 2, away: 2 }, settledOn: "TheSportsDB", confirmedBy: "", ops: ["on-chain payout", "TheSportsDB"], detail: "", url: "" }, "text search", null);
    assert.equal(d.draw, true); assert.equal(d.winner, "draw");
    const h = rowOf(game({ h: "KC", a: "LAC", hs: 27, as: 21 }), { kind: "held", why: "only one operator can read this game (TheSportsDB)" }, "none", null);
    assert.equal(h.kind, "held"); assert.match(h.why!, /only one operator/);
    assert.equal(rowOf(game({ h: "TB", a: "NYY", hs: null, as: null, completed: false, state: "post", detail: "Postponed" }), null, null, null).kind, "postponed");
    assert.equal(rowOf(game({ h: "TB", a: "NYY", hs: null, as: null, completed: false, state: "pre", detail: "Scheduled" }), null, null, null).kind, "unplayed");
  });
});

const r = (o: Partial<GameRow>): GameRow => ({ date: "2025-09-14", startsAt: "", eventId: "1", matchup: "A @ B", post: false, sched: "1–2", schedWinner: "home", kind: "settled", ops: ["on-chain payout", "TheSportsDB"], winner: "B", why: null, final: "1–2", lookup: "start window", market: null, draw: false, pens: false, mismatch: false, ...o });

describe("summarise, exit code and verdict", () => {
  test("counts every kind; held games exit 1", () => {
    const s = summarise([r({}), r({ kind: "held", ops: [], why: "x", lookup: "none" }), r({ kind: "awaiting", ops: [], why: "y", lookup: "none" }), r({ kind: "postponed", ops: [], lookup: null }), r({ draw: true, lookup: "text search" }), r({ kind: "unplayed", ops: [], lookup: null })]);
    assert.equal(s.listed, 6); assert.equal(s.completed, 4); assert.equal(s.settled, 2); assert.equal(s.settledTwoOps, 2); assert.equal(s.held, 1); assert.equal(s.awaiting, 1); assert.equal(s.postponed, 1); assert.equal(s.unplayed, 1); assert.equal(s.draws, 1);
    assert.deepEqual(s.lookups, { "start window": 1, "end window": 0, "text search": 1, none: 2, error: 0 });
    assert.deepEqual(s.byOps, { "on-chain payout+TheSportsDB": 2 });
    assert.deepEqual(s.heldRows, [{ date: "2025-09-14", matchup: "A @ B", why: "x" }]);
    assert.equal(exitCodeOf(s), 1);
  });
  test("verdicts: every game, gaps under 10%, does not settle; an empty season exits 1", () => {
    assert.equal(verdictOf(summarise([r({}), r({})])), "settles every game");
    assert.equal(exitCodeOf(summarise([r({})])), 0);
    assert.equal(verdictOf(summarise([...Array.from({ length: 19 }, () => r({})), r({ kind: "awaiting", ops: [] })])), "settles with gaps");
    assert.equal(verdictOf(summarise([r({}), r({ kind: "held", ops: [] })])), "does not settle");
    assert.equal(verdictOf(summarise([])), "does not settle"); assert.equal(exitCodeOf(summarise([])), 1);
    assert.equal(verdictOf(summarise([r({ mismatch: true })])), "settles with gaps");
  });
});

describe("championRead", () => {
  test("the WNBA is outside CHAMPION_KNOWN: says what the rule would read", () => {
    const a = parseArgs(["--league", "wnba", "--team", "LV", "--year", "2025"]); assert.ok(!("error" in a));
    const s = seriesFor(a);
    const reg = championRead(s, [game({ h: "PHX", a: "LV", hs: 86, as: 89, startsAt: "2025-09-10T02:00:00Z", league: "wnba" })], undefined);
    assert.match(reg, /outside CHAMPION_KNOWN/); assert.match(reg, /would read false/); assert.match(reg, /0 games marked postseason/);
    const sb = championRead(s, [game({ h: "LV", a: "PHX", hs: 97, as: 86, seasonType: 3, startsAt: "2025-10-11T00:00:00Z", league: "wnba" })], undefined);
    assert.match(sb, /would read true/); assert.match(sb, /1 game marked postseason/);
  });
  test("MLB is in CHAMPION_KNOWN: the window's own champion value", () => {
    const a = parseArgs(["--league", "mlb", "--team", "TB", "--year", "2025"]); assert.ok(!("error" in a));
    assert.match(championRead(seriesFor(a), [game({ h: "TB", a: "NYY", hs: 3, as: 2, league: "mlb" })], false), /^champion: false/);
  });
});

test("renderMarkdown: one section per run with the verdict and a table row per game", () => {
  const rows = [r({}), r({ kind: "held", ops: [], why: "only one | operator", lookup: "none" })];
  const run: RunRecord = { args: { league: "nfl", team: "KC", year: 2025, window: "season", opp: null, nowMs: 0 }, team: "Chiefs", rows, summary: summarise(rows), window: { ended: true, reason: "done", endsAt: null, champion: "champion: not read" }, keeper: { days: 1, awaiting: 0, refusals: ["x"], reason: "ended" }, requests: { schedule: 1, gamma: 1, chain: 1 }, error: null, seconds: 1 };
  const md = renderMarkdown([run]);
  assert.match(md, /### NFL: Chiefs 2025/); assert.match(md, /Verdict: \*\*does not settle\*\*/); assert.match(md, /only one \\\| operator/);
  assert.equal(md.split("\n").filter((l) => l.startsWith("| 2025-09-14")).length, 2);
  assert.match(md, /Markets: found by start time 1, by end date 0, by the text search 0, no market 1, lookup error 0/);
});

test("lookupLine reads a record saved before a lookup kind existed as zero", () => {
  assert.equal(lookupLine({ lookups: { "start window": 2 } as never }), "found by start time 2, by end date 0, by the text search 0, no market 0, lookup error 0");
});
