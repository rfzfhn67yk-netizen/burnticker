// SOCCER SCHEDULES (2026-10-11, pre-launch: "the live API's soccer schedule read returns HTTP 400 for the Premier League"). Cause:
// TheSportsDB v2 answers HTTP 400 "Invalid Premium API key" to a key that is not premium, so every league read through TheSportsDB
// failed. Fix: a key v2 refuses is read through v1 (key in the path, never logged), the season's results + the league's last results +
// its next fixtures merged. One frozen v1 fixture per soccer league we list (config/burnticker/fixtures/sports/tsdb/<league>.json).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { EspnClient, LEAGUES, TSDB_LEAGUE, redactKey, teamsOf, tsdbScheduleUrl, tsdbV1Urls, type LeagueId } from "@/lib/burnticker/sources/espn";

const DIR = path.join(import.meta.dirname, "..", "config", "burnticker", "fixtures", "sports", "tsdb");
const KEY = "free-key-not-premium";
const NOW = Date.UTC(2026, 9, 11, 12);
const SOCCER = (Object.keys(TSDB_LEAGUE) as LeagueId[]).filter((l) => LEAGUES[l]?.sport === "soccer");
const fixture = (l: LeagueId) => JSON.parse(fs.readFileSync(path.join(DIR, `${l}.json`), "utf8")) as { tsdbLeague: string; season: string; bodies: { season: unknown; past: unknown; next: unknown } };
const res = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

/** The live host's situation: v2 refuses the key; v1 answers from the frozen bodies. */
function liveLike(l: LeagueId, seen: { url: string; headers: Record<string, string> }[]) {
  const f = fixture(l);
  return async (url: string, init?: { headers?: Record<string, string> }) => {
    seen.push({ url, headers: init?.headers ?? {} });
    if (url.includes("/api/v2/")) return res(400, { Message: "Invalid Premium API key: Signup here: https://www.thesportsdb.com/pricing" });
    if (url.includes(`eventsseason.php?id=${f.tsdbLeague}&s=${f.season}`)) return res(200, f.bodies.season);
    if (url.includes(`eventspastleague.php?id=${f.tsdbLeague}`)) return res(200, f.bodies.past);
    if (url.includes(`eventsnextleague.php?id=${f.tsdbLeague}`)) return res(200, f.bodies.next);
    return res(404, {});
  };
}

describe("soccer schedules through TheSportsDB", () => {
  test("every soccer league we list has a frozen fixture", () => {
    assert.ok(SOCCER.length >= 15, SOCCER.join(","));
    for (const l of SOCCER) assert.ok(fs.existsSync(path.join(DIR, `${l}.json`)), `${l}: no fixture`);
  });

  for (const l of SOCCER) test(`${LEAGUES[l].label} (${l}): v2 refuses the key → v1 serves the schedule; teams resolve; the key never shows`, async () => {
    const seen: { url: string; headers: Record<string, string> }[] = [];
    const c = new EspnClient({ fetchImpl: liveLike(l, seen) as never, now: () => NOW, minIntervalMs: 0, tsdbKey: KEY });
    const next = await c.upcoming(l, 30);
    const f = fixture(l);
    const expectNext = ((f.bodies.next as { events: unknown[] }).events ?? []).length;
    assert.ok(next.length >= Math.min(1, expectNext), `${l}: upcoming ${next.length}`);
    for (const g of next) {
      const abbrs = new Set(teamsOf(l).map((t) => t.abbr));
      assert.ok(abbrs.has(g.home.abbr) || abbrs.has(g.away.abbr), `${l}: ${g.away.name} at ${g.home.name} names none of our teams`);
    }
    assert.equal(seen[0].url, tsdbScheduleUrl(l, Number(f.season.slice(0, 4)) + (LEAGUES[l].span === "later" ? 1 : 0)), "v2 first, with the key in the header");
    assert.equal(seen[0].headers["X-API-KEY"], KEY);
    assert.ok(seen.slice(1).every((x) => x.url.includes("/api/v1/json/")), "then v1 only");
    assert.ok(c.requests.every((u) => !u.includes(KEY)), "no key in the request log");
  });

  test("a premium key stays on v2 (no v1 call); a non-auth failure is not mistaken for a refused key", async () => {
    const seen: string[] = [];
    const premium = new EspnClient({ fetchImpl: (async (u: string) => { seen.push(u); return res(200, { schedule: [{ idEvent: "1", strHomeTeam: "Arsenal", strAwayTeam: "Chelsea", strTimestamp: "2026-10-18T14:00:00", strStatus: "Not Started" }] }); }) as never, now: () => NOW, minIntervalMs: 0, tsdbKey: "premium" });
    const g = await premium.upcoming("eng.1", 30);
    assert.equal(g.length, 1); assert.ok(seen.every((u) => u.includes("/api/v2/")));
    const down = new EspnClient({ fetchImpl: (async () => res(503, {})) as never, now: () => NOW, minIntervalMs: 0, tsdbKey: KEY });
    await assert.rejects(down.upcoming("eng.1", 30), /HTTP 503/);
    assert.equal(down.tsdbV1, false);
  });

  test("the v1 URLs carry the key only in the path, and the redaction hides it", () => {
    const urls = tsdbV1Urls("s3cr3t", "eng.1", 2026);
    assert.equal(urls.length, 3);
    for (const u of urls) { assert.match(u, /\/api\/v1\/json\/s3cr3t\//); assert.ok(!redactKey(u).includes("s3cr3t")); }
  });
});
