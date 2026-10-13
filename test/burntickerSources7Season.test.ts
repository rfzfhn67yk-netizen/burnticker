// SOURCES-7 (QA walkthrough 11 H6): a team whose season is over is refused for a season rule by the review and by the bundle, with the
// next season and the next title market offered, and the league page's deep link carries the warning. No network: the schedule is a
// fake (the platform's seasonSchedule port).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_ON_END, type BurnRule } from "@/lib/burnticker/rules";
import { firstPartyRule } from "@/lib/burnticker/wizard";
import { gameSeries, seasonYearAt, teamSeries, type Game } from "@/lib/burnticker/sources/espn";
import { seasonOverFor, seasonOverRefusal, seasonStatus, SEASON_OVER_LINK_LINE } from "@/lib/burnticker/seasonOver";
import { buildLaunchReview } from "@/lib/burnticker/launchReview";
import { prepareLaunch } from "@/lib/burnticker/api/handlers";
import { launchHref, leagueSeasonPage } from "@/lib/burnticker/leagues";
import { CREATOR_LAUNCHES_FLAG } from "@/lib/burnticker/creatorLaunches";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import { CREATOR, makeWorld } from "./burntickerApiHelpers.ts";

const cfgLint = loadCopyLintConfig();
const lint = (t: string) => { const r = lintCopy(t, cfgLint); assert.ok(r.ok, `${r.hits.map((h) => `${h.phrase} (${h.rule})`).join(", ")}\n${t}`); };
const season = (abbr: string, outcome: "win" | "loss" = "win", year = 2026, kind: "season" | "post" = "season") => ({ ...firstPartyRule(teamSeries("mlb", abbr, outcome, { kind, year }), 0.02), onEnd: { ...DEFAULT_ON_END } }) as BurnRule;
const SNOW = Date.parse("2026-10-13T12:00:00Z");
/** The bundle reads the clock, so its test uses the season that is current when it runs. */
const CUR = seasonYearAt("mlb", Date.now());
const env = { BURNTICKER_CLUSTER: "mainnet", [CREATOR_LAUNCHES_FLAG]: "1" };
const side = (abbr: string) => ({ abbr, name: abbr, nickname: abbr }) as unknown as Game["home"];
/** The NLCS: every open game is a postseason game, and neither side is Colorado. */
const NLCS: Game[] = [1, 2].map((i) => ({ eventId: `77${i}`, league: "mlb", seasonType: 3, startsAt: `2026-10-1${4 + i}T23:00:00Z`, date: `2026-10-1${4 + i}`, name: "Brewers at Dodgers", completed: false, state: "pre", detail: "", home: side("LAD"), away: side("MIL") }) as Game);

describe("H6: a season rule on a team whose season is over", () => {
  test("the refusal names the season, offers the next season's rule and the next title market, in plain words", () => {
    assert.equal(seasonStatus("COL", NLCS, true).status, "over");
    assert.equal(seasonStatus("LAD", NLCS, true).status, "upcoming");
    const r = seasonOverRefusal(season("COL"))!;
    assert.equal(r.code, "season-over");
    assert.match(r.message, /^The Rockies have no games left in the 2026 season/);
    assert.match(r.message, /2027 season/);
    assert.match(r.message, /title/);
    assert.equal(r.next.series, teamSeries("mlb", "COL", "win", { kind: "season", year: 2027 }));
    assert.equal(r.next.year, 2027);
    assert.equal(seasonOverRefusal(season("COL", "loss", 2026, "post"))!.next.series, teamSeries("mlb", "COL", "loss", { kind: "post", year: 2027 }));
    lint(r.message); lint(SEASON_OVER_LINK_LINE);
    // only season and postseason windows: a one-game rule or a perpetual one is never this refusal
    assert.equal(seasonOverRefusal({ ...season("COL"), series: gameSeries("mlb", "776", "COL", "loss") } as BurnRule), null);
    assert.equal(seasonOverRefusal({ ...season("COL"), series: teamSeries("mlb", "COL", "win", { kind: "perpetual" }) } as BurnRule), null);
  });

  test("seasonOverFor reads the schedule once, within its time limit; an unreadable or slow schedule refuses nothing", async () => {
    assert.equal((await seasonOverFor(season("COL"), async () => NLCS, { now: SNOW }))?.code, "season-over");
    assert.equal(await seasonOverFor(season("LAD"), async () => NLCS, { now: SNOW }), null);
    assert.equal(await seasonOverFor(season("COL"), async () => { throw new Error("down"); }, { now: SNOW }), null);
    assert.equal(await seasonOverFor(season("COL"), () => new Promise<Game[]>((res) => setTimeout(() => res(NLCS), 200)), { timeoutMs: 20, now: SNOW }), null);
    assert.equal(await seasonOverFor(season("COL"), null, { now: SNOW }), null);
  });

  test("the review refuses it as a problem (not a warning at the bottom) and carries the next season", () => {
    const r = buildLaunchReview({ rule: season("COL"), ticker: "COL", name: "Rockies 2026 Wins" }, { env, seasonOver: seasonOverRefusal(season("COL")) });
    assert.ok("review" in r);
    assert.ok(r.review.problems.includes(seasonOverRefusal(season("COL"))!.message), r.review.problems.join("\n"));
    assert.equal(r.review.signable, false);
    assert.equal(r.review.seasonOver?.next.series, teamSeries("mlb", "COL", "win", { kind: "season", year: 2027 }));
    assert.equal(r.review.warnings.some((w) => /Season over/.test(w)), false, "said once, as the refusal");
    const ok = buildLaunchReview({ rule: season("LAD"), ticker: "LAD", name: "Dodgers 2026 Wins" }, { env });
    assert.ok("review" in ok && !ok.review.seasonOver);
  });

  test("the bundle refuses it too, from the platform's schedule port (409 season-over), and a live team still builds past that check", async () => {
    const w = await makeWorld();
    w.p.seasonSchedule = async () => NLCS;
    const base = { creator: CREATOR, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true } };
    const a = await prepareLaunch(w.p, { ...base, rule: season("COL", "win", CUR), ticker: "COLW", name: "Rockies Wins" }, { register: false }) as { error?: { status: number; body: { code: string; error: string; next?: { series: string } } } };
    assert.equal(a.error?.status, 409);
    assert.equal(a.error?.body.code, "season-over");
    assert.equal(a.error?.body.next?.series, teamSeries("mlb", "COL", "win", { kind: "season", year: CUR + 1 }));
    const b = await prepareLaunch(w.p, { ...base, rule: season("LAD", "win", CUR), ticker: "LADW", name: "Dodgers Wins" }, { register: false }) as { error?: { body: { code: string } } };
    assert.notEqual(b.error?.body.code, "season-over");
  });

  test("the league page's deep link carries the warning: the row says the season is over and the link opens on the next season", () => {
    assert.equal(launchHref("Colorado Rockies", "mlb", "COL", { seasonOver: true }), "/burnticker/launch?league=mlb&team=COL&season=over");
    assert.equal(launchHref("Colorado Rockies", "mlb", "COL"), "/burnticker/launch?league=mlb&team=COL");
    const page = leagueSeasonPage({ league: "mlb", year: 2026, coins: [], readings: [], nowMs: Date.parse("2026-10-13T12:00:00Z"), origin: "https://burnticker.com", ogImage: "/x.png", seasonOver: new Set(["COL"]) });
    const col = page.teams.find((t) => t.abbr === "COL")!, lad = page.teams.find((t) => t.abbr === "LAD")!;
    assert.equal(col.seasonOver, true); assert.equal(col.warning, SEASON_OVER_LINK_LINE); assert.match(col.launchHref, /season=over$/);
    assert.equal(lad.seasonOver, false); assert.equal(lad.warning, null);
    // live teams first, then the teams whose season is over
    assert.ok(page.teams.findIndex((t) => t.abbr === "LAD") < page.teams.findIndex((t) => t.abbr === "COL"));
  });
});
