// HOURLY AUDIT 2026-10-20 02:10 DENVER, RUN 14 (docs/burnticker/audits/continuous/2026-10-20-0210-Denver.md; bugs.md HB-153 to HB-155
// and the widenings of HB-146, HB-41, HB-39, HB-111 and HB-142; suggestions HS-57, HS-58 and HS-41 widened). HB-145 (the stall) belongs
// to the web-process work. One pure test or source check per fix, plus the copy lint on every new public sentence. No network.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { lintCopy, loadCopyLintConfig, formatHits } from "@/lib/launch/copyLint";
import { TSDB_POST_ROUND_RE, tsdbGames, tsdbPostByCount, type Game } from "@/lib/burnticker/sources/espn";
import { SEASON_OVER_LINE, seasonOverFor, seasonStatus } from "@/lib/burnticker/seasonOver";
import { operatorEntitySentence, PLACEHOLDER_SENTENCES } from "@/lib/burnticker/trustpack/copy";
import { V1_TRUST_CACHE_SEC, V1_TRUST_MAX_STALE_MS, makeV1TrustSwr, v1TrustHeaders } from "@/lib/burnticker/trustServe";
import { simulateResults } from "@/lib/burnticker/simulator";
import { firstPartyRule } from "@/lib/burnticker/wizard";
import { polyRule } from "@/lib/burnticker/search";
import { SAMPLE_BEHIND_DAYS, oneShotBacktestLines, reviewProjection, sampleAgeLine } from "@/lib/burnticker/projection";
import { contentWords, keepHit, noFullMatchLine, noMatchLine, outcomeButtonLabel, searchMatch } from "@/lib/burnticker/searchMatch";
import { badgeFromText, describeRule, isMarketCoin, windowBadge } from "@/lib/burnticker/describe";
import { badgeDay } from "@/lib/burnticker/coinStatus";
import { MINT_KEY_DISCLOSURE, MINT_REVIEW_NOTE } from "@/lib/burnticker/mintAddressCopy";
import { PAIR_VS, pairBurnScore } from "@/lib/burnticker/coinsList";
import type { BurnRule } from "@/lib/burnticker/rules";

const cfg = loadCopyLintConfig();
const clean = (s: string) => { const r = lintCopy(s, cfg); assert.ok(r.ok, `${s}\n${formatHits(r)}`); };
const plain = (s: string) => { clean(s); assert.doesNotMatch(s, /\bwill\b|\bbuy\b|\bprice\b|coming soon|\bpayouts?\b|\btarget\b|\bguarantee|→|\b20\d\d-\d\d-\d\d\b|\w\/\w+\//i, s); };
const read = (p: string) => fs.readFileSync(p, "utf8");
const FIX = path.join(import.meta.dirname, "fixtures", "burnticker");

// ---- HB-153: the WNBA season is over for 13 of 15 teams ----
type TeamRow = { abbr: string; name: string; series: { win: string }; season: { status: string } };
const WNBA = JSON.parse(read(path.join(FIX, "hourly-run14-wnba-teams.json"))) as { league: string; teams: TeamRow[] };
const FINALISTS = new Set(["ATL", "GS"]);
const byAbbr = new Map(WNBA.teams.map((t) => [t.abbr, t]));

/**
 * A synthetic TheSportsDB WNBA season in the shape the licensed schedule sends: every row intRound "0" and no strRound, the 2026 Finals
 * included (read 2026-10-20 on TheSportsDB's public key: the Finals row "Atlanta Dream vs Golden State Valkyries", idEvent 2617452, has
 * intRound "0"). Three round robins (42 games a team), then a playoff bracket of eight, and the Finals with one game still to play.
 */
function wnbaSeason(o: { playoffs: boolean; openFrom?: number } = { playoffs: true }): Record<string, unknown>[] {
  const names = WNBA.teams.map((t) => t.name);
  const slots = [...names, null];   // 15 teams and a bye
  const rows: Record<string, unknown>[] = [];
  let id = 9_100_000, day = Date.parse("2026-05-08T23:00:00Z");
  const row = (home: string, away: string, at: number, done: boolean) => ({ idEvent: String(id++), strEvent: `${home} vs ${away}`, strHomeTeam: home, strAwayTeam: away, strTimestamp: new Date(at).toISOString().slice(0, 19), dateEvent: new Date(at).toISOString().slice(0, 10), strTime: new Date(at).toISOString().slice(11, 19), intRound: "0", strStatus: done ? "FT" : "NS", intHomeScore: done ? "80" : null, intAwayScore: done ? "70" : null, idLeague: "4516", strSeason: "2026" });
  let round = 0;
  for (let cycle = 0; cycle < 3; cycle++) {
    const s = [...slots];
    for (let r = 0; r < s.length - 1; r++) {
      for (let i = 0; i < s.length / 2; i++) { const h = s[i], a = s[s.length - 1 - i]; if (h && a) rows.push(row(h, a, day, o.openFrom === undefined || round < o.openFrom)); }
      s.splice(1, 0, s.pop()!);   // the circle method: the first slot stays, the rest rotate
      day += 86_400_000 * 2; round++;
    }
  }
  if (!o.playoffs) return rows;
  const n = (a: string) => byAbbr.get(a)!.name;
  day = Date.parse("2026-09-20T23:00:00Z");
  for (const [h, a] of [["ATL", "PHX"], ["GS", "MIN"], ["NY", "LV"], ["IND", "SEA"]]) for (let g = 0; g < 2; g++) rows.push(row(n(h), n(a), day + g * 86_400_000, true));
  day = Date.parse("2026-10-01T23:00:00Z");
  for (const [h, a] of [["ATL", "NY"], ["GS", "IND"]]) for (let g = 0; g < 3; g++) rows.push(row(n(h), n(a), day + g * 2 * 86_400_000, true));
  rows.push(row(n("GS"), n("ATL"), Date.parse("2026-10-20T00:00:00Z"), true));
  rows.push({ ...row(n("ATL"), n("GS"), Date.parse("2026-10-22T00:00:00Z"), false), idEvent: "2617452" });
  return rows;
}
const NOW = Date.parse("2026-10-20T08:24:00Z");
const openGames = (games: Game[]) => games.filter((g) => !g.completed && g.date >= "2026-10-20" && g.date <= "2026-10-28");

describe("HB-153: a WNBA team whose 2026 season is over is 'over', and its season coin is refused with the 2027 season offered", () => {
  test("the saved team list is the case: 13 teams none-listed, the two finalists upcoming, none over", () => {
    assert.equal(WNBA.teams.length, 15);
    assert.deepEqual(WNBA.teams.filter((t) => t.season.status === "upcoming").map((t) => t.abbr).sort(), [...FINALISTS].sort());
    assert.equal(WNBA.teams.filter((t) => t.season.status === "none-listed").length, 13);
  });
  test("round 0 everywhere: the Finals games are read as postseason by game count, the regular season is not", () => {
    const games = tsdbGames("wnba", { events: wnbaSeason() }, 2026);
    const finals = games.find((g) => g.eventId === "2617452")!;
    assert.equal(finals.seasonType, 3, "the Finals game still to play");
    assert.equal(games.filter((g) => g.date < "2026-09-01").every((g) => g.seasonType === 2), true, "every regular-season game");
    assert.equal(games.filter((g) => g.date >= "2026-09-01").every((g) => g.seasonType === 3), true, "every playoff game");
  });
  test("/v1/sports/teams's rule: the 13 eliminated teams are over (the season-over line), the finalists upcoming", () => {
    const listed = openGames(tsdbGames("wnba", { events: wnbaSeason() }, 2026));
    assert.equal(listed.length, 1);
    for (const t of WNBA.teams) {
      const s = seasonStatus(t.abbr, listed, true);
      if (FINALISTS.has(t.abbr)) assert.equal(s.status, "upcoming", t.abbr);
      else { assert.equal(s.status, "over", t.abbr); assert.equal(s.warning, SEASON_OVER_LINE); }
    }
  });
  test("the Sky review is answered with the 409 season-over refusal, offering the 2027 season", async () => {
    const games = tsdbGames("wnba", { events: wnbaSeason() }, 2026);
    const sky = byAbbr.get("CHI")!;
    const rule = { oracle: "catalogue", series: sky.series.win } as Pick<BurnRule, "oracle" | "series">;
    const r = await seasonOverFor(rule, async () => openGames(games), { now: NOW });
    assert.ok(r, "refused");
    assert.equal(r!.status, 409); assert.equal(r!.code, "season-over");
    assert.equal(r!.next.year, 2027); assert.equal(r!.next.label, "2027");
    assert.match(r!.next.series, /^espn\.team:wnba-CHI\.19-win-s2027$/);
    assert.match(r!.message, /Sky have no games left in the 2026 season/);
    // a finalist is never refused
    assert.equal(await seasonOverFor({ oracle: "catalogue", series: byAbbr.get("ATL")!.series.win }, async () => openGames(games), { now: NOW }), null);
  });
  test("mid-season (no playoff game listed yet, some games still to play) nothing is postseason and nobody is over", () => {
    const games = tsdbGames("wnba", { events: wnbaSeason({ playoffs: false, openFrom: 40 }) }, 2026);
    assert.equal(games.every((g) => g.seasonType === 2), true);
    const open = games.filter((g) => !g.completed);
    assert.ok(open.length > 0);
    for (const t of WNBA.teams) assert.notEqual(seasonStatus(t.abbr, open, true).status, "over", t.abbr);
  });
  test("a partial listing (the public key's 15 rows) flags nothing; a cancelled leftover never keeps a team in season", () => {
    assert.equal(tsdbPostByCount("wnba", wnbaSeason().slice(0, 15)).size, 0);
    const listed = openGames(tsdbGames("wnba", { events: wnbaSeason() }, 2026));
    const leftover: Game = { ...listed[0], eventId: "x1", seasonType: 2, detail: "Cancelled", home: { ...listed[0].home, abbr: "SEA" }, away: { ...listed[0].away, abbr: "PHX" } };
    assert.equal(seasonStatus("CHI", [...listed, leftover], true).status, "over");
  });
  test("TheSportsDB round names and numbers: both strRound and intRound are read in every non-soccer league", () => {
    const one = (league: Parameters<typeof tsdbGames>[0], extra: Record<string, unknown>, home: string, away: string) => tsdbGames(league, { events: [{ idEvent: "1", strHomeTeam: home, strAwayTeam: away, strTimestamp: "2026-10-22T00:00:00", dateEvent: "2026-10-22", strStatus: "NS", ...extra }] }, 2026)[0];
    for (const name of ["WNBA Finals", "Semifinals", "Play-In Tournament", "Championship", "Playoffs Round 1", "Conference Finals"]) {
      assert.ok(TSDB_POST_ROUND_RE.test(name), name);
      assert.equal(one("wnba", { strRound: name, intRound: "0" }, "Atlanta Dream", "Golden State Valkyries").seasonType, 3, name);
    }
    assert.equal(one("wnba", { intRound: "150" }, "Atlanta Dream", "Golden State Valkyries").seasonType, 3, "the 100–499 playoff band");
    assert.equal(one("wnba", { intRound: "0", strRound: "Regular Season" }, "Atlanta Dream", "Golden State Valkyries").seasonType, 2);
    assert.equal(one("cfb", { intRound: "7" }, "Georgia Bulldogs", "Alabama Crimson Tide").seasonType, 2, "a college week number");
    assert.equal(one("eng.1", { strRound: "Final", intRound: "38" }, "Arsenal", "Chelsea").seasonType, 2, "soccer is excluded by design");
  });
});

// ---- HB-154: "Legal entity. null." ----
describe("HB-154: the operator page says the pending-entity sentence, never the word null", () => {
  const body = JSON.parse(read(path.join(FIX, "hourly-run14-operator.json"))) as { operator: { entity: string | null; entityPending: string } };
  test("the saved API body (entity null) gives its entityPending sentence", () => {
    assert.equal(body.operator.entity, null);
    const s = operatorEntitySentence(body.operator);
    assert.equal(s, body.operator.entityPending);
    assert.doesNotMatch(s, /\bnull\b|undefined|TODO_/);
    plain(s);
  });
  test("a TODO token, an empty field and a missing pending sentence never print a token; a named entity ends with one period", () => {
    assert.equal(operatorEntitySentence({ entity: "TODO_ENTITY", entityPending: "Pending." }), "Pending.");
    assert.equal(operatorEntitySentence({ entity: null }), PLACEHOLDER_SENTENCES.TODO_ENTITY);
    assert.equal(operatorEntitySentence({ entity: "null", entityPending: null }), PLACEHOLDER_SENTENCES.TODO_ENTITY);
    assert.equal(operatorEntitySentence({ entity: "Burnticker LLC" }), "Burnticker LLC.");
    assert.equal(operatorEntitySentence({ entity: "Burnticker LLC." }), "Burnticker LLC.");
  });
  test("the page renders the sentence through the helper", () => {
    const pg = read("src/app/burnticker/operator/page.tsx");
    assert.match(pg, /<b>\{OPERATOR_COPY\.entityTitle\}\.<\/b> \{operatorEntitySentence\(v\.operator\)\}/);
    assert.doesNotMatch(pg, /isTodo\(v\.operator\.entity\)/);
  });
});

// ---- HB-155: /v1/trust body age ----
describe("HB-155: /v1/trust never serves a body older than its headers allow", () => {
  test("the headers count the body's age: the edge keeps what is left of 60 s; past that, no-store with Age", () => {
    assert.equal(V1_TRUST_MAX_STALE_MS, 120_000);
    assert.deepEqual(v1TrustHeaders({ state: "hit", ageMs: 0 }), { "cache-control": "public, max-age=60, s-maxage=60, stale-while-revalidate=60", "x-trust-age-sec": "0", "x-trust-memo": "hit" });
    assert.equal(v1TrustHeaders({ state: "hit", ageMs: 25_400 })["cache-control"], "public, max-age=35, s-maxage=35, stale-while-revalidate=60");
    const old = v1TrustHeaders({ state: "hit", ageMs: 61_000 });
    assert.equal(old["cache-control"], "no-store"); assert.equal(old.age, "61"); assert.equal(old["x-trust-memo"], "stale");
    const st = v1TrustHeaders({ state: "stale", ageMs: 238_000 });
    assert.equal(st["cache-control"], "no-store"); assert.equal(st.age, "238");
  });
  test("20 reads 10 s apart: every body is within max-age + stale-while-revalidate, counting what the edge may add", async () => {
    let t = Date.parse("2026-10-20T08:13:00Z");
    const swr = makeV1TrustSwr({ clock: () => t, coldWaitMs: 5 });
    const build = async () => ({ generatedAt: t });
    for (let i = 0; i < 20; i++) {
      t += 10_000;
      const r = (await swr.get("v1", "1", build))!;
      await new Promise((res) => setImmediate(res));   // let a background refresh land, as the next request would find it
      const age = t - (r.value as { generatedAt: number }).generatedAt;
      const h = v1TrustHeaders(r);
      const edgeMore = h["cache-control"] === "no-store" ? 0 : (Number(/s-maxage=(\d+)/.exec(h["cache-control"])![1]) + V1_TRUST_CACHE_SEC) * 1000;
      assert.ok(age + edgeMore <= 2 * V1_TRUST_CACHE_SEC * 1000, `read ${i}: age ${age} ms, edge may add ${edgeMore} ms`);
    }
  });
  test("a refresh that never lands: past 120 s the old body goes out marked stale, with no-store and its age", async () => {
    let t = 1_000_000_000;
    const swr = makeV1TrustSwr({ clock: () => t, coldWaitMs: 5 });
    await swr.get("v1", "1", async () => ({ generatedAt: t }));
    const hung = () => new Promise<unknown>(() => {});
    t += 238_000;
    const r = (await swr.get("v1", "1", hung))!;
    assert.equal(r.state, "stale");
    const h = v1TrustHeaders(r);
    assert.equal(h["cache-control"], "no-store"); assert.equal(h.age, "238");
  });
  test("the v1 handler reads its own memo and sends those headers", () => {
    const v1 = read("src/lib/burnticker/api/v1.ts");
    // HB-211 (ninth pass): through serveV1Trust, which reads the same memo within a 12 s deadline and sends v1TrustHeaders
    assert.match(v1, /const served = await serveV1Trust\(v1TrustSwr, build, v1TrustLastGood\(p\)\);/);
    assert.match(v1, /headers = served\.headers;/);
    assert.match(v1, /\}\), headers\);\n\}\nconst withHeaders = /);
  });
});

// ---- widenings ----
const feedRule = (series: string, inverse = false) => { const r = firstPartyRule(series, 0.02) as BurnRule; return inverse ? ({ ...r, inverse: true } as BurnRule) : r; };
describe("HB-146 widened: one no-reading row on every catalogue review", () => {
  test("wildfire one-shot and recurring, hurricane fade, earthquakes, tornadoes, the debt: one row, no two titles differ only by reading/result", () => {
    for (const r of [feedRule("nifc.firesize:100000"), feedRule("nifc.acres:100000"), feedRule("nifc.acres:100000", true), feedRule("nhc.hurricanes:EP-3", true), feedRule("usgs.quakenext:6"), feedRule("treasury.debt")]) {
      const labels = simulateResults(r).rows.map((x) => x.label);
      assert.equal(labels.filter((l) => /^No (reading|result) is published$/.test(l)).length, 1, `${r.series} ${JSON.stringify(labels)}`);
      const folded = labels.map((l) => l.replace(/\b(reading|result)\b/, "X"));
      assert.equal(new Set(folded).size, folded.length, `${r.series} ${JSON.stringify(labels)}`);
    }
  });
});

describe("HB-39 residue: a yes/no market's table has no tie row", () => {
  test("Polymarket and Kalshi one-market coins: no tie row; the voided row stays", () => {
    for (const r of [polyRule("0xabc"), { ...polyRule("0xabc"), oracle: "kalshi", market: "KXF1-26-NOR" } as BurnRule]) {
      const rows = simulateResults(r).rows;
      assert.equal(rows.some((x) => x.case === "tie"), false, JSON.stringify(rows.map((x) => x.label)));
      assert.ok(rows.some((x) => x.case === "void"));
      assert.doesNotMatch(rows.map((x) => x.line).join(" "), /has no tie/);
    }
  });
});

describe("HB-41 widened: the back-test names the catalogue's sample and says how far behind it ends", () => {
  test("the sample's age line, and the keeper's newer stored reading", () => {
    const now = Date.parse("2026-10-20T08:15:00Z");
    assert.equal(sampleAgeLine("2026-10-15", now), null, `within ${SAMPLE_BEHIND_DAYS} days`);
    const l = sampleAgeLine("2026-08-24", now)!;
    assert.equal(l, "The catalogue's sample ends 57 days before today and is not refreshed, so later readings are not counted here.");
    plain(l);
    const s = sampleAgeLine("2026-08-24", now, { at: "2026-10-18T00:00:00Z", fetchedAt: Date.parse("2026-10-18T12:00:00Z") })!;
    assert.match(s, /The newest reading Burnticker has stored from this source is from 18 October 2026\.$/);
    clean(s);
  });
  test("the one-time lines say the catalogue's saved sample, never 'the saved readings'", () => {
    const [line] = oneShotBacktestLines("2026-02-17", "2026-08-24", ["2026-02-17"]);
    assert.match(line, /^In the catalogue's saved sample, with readings from 17 February 2026 to 24 August 2026, one day qualified\./);
    plain(line.replace(/\d+ \w+ 20\d\d/g, "a day"));
  });
  test("the wildfire one-shot review carries the age line, with the stored reading when there is one", () => {
    const now = Date.parse("2026-10-20T08:15:00Z");
    const rule = { ...feedRule("nifc.firesize:100000"), scalar: { ...feedRule("nifc.firesize:100000").scalar!, perUnit: { fractionOfPool: 1 } } } as BurnRule;
    const p = reviewProjection(rule, now);
    assert.ok(p.available, p.reason ?? "");
    assert.ok(p.lines.some((x) => /^The catalogue's sample ends \d+ days before today/.test(x)), JSON.stringify(p.lines));
    assert.ok(!p.lines.some((x) => /saved readings/.test(x)));
    const q = reviewProjection(rule, now, undefined, { storedReading: (k) => (k === "catalogue:nifc.firesize:100000" ? { at: "2026-10-19T00:00:00Z", fetchedAt: now - 3_600_000 } : null) });
    assert.ok(q.lines.some((x) => /stored from this source is from 19 October 2026/.test(x)), JSON.stringify(q.lines));
  });
  test("the review route passes the keeper's newest stored reading", () => {
    const route = read("src/app/api/burnticker/v1/launch/review/route.ts");
    assert.match(route, /const storedReading = \(k: string\) => \{ const x = platform\(\)\.registry\.lastReading\(k\);/);
    assert.match(route, /derbyHistory, storedReading,/);
    assert.match(read("src/lib/burnticker/launchReview.ts"), /reviewProjection\(locked\.rule, now, undefined, \{ derbyHistory: o\.derbyHistory, storedReading: o\.storedReading \}\)/);
  });
});

describe("HB-111 widened: every outcome button of a market search result has a name", () => {
  test("named by its outcome and its action", () => {
    assert.equal(outcomeButtonLabel({ outcome: "Lando Norris", question: "Will Lando Norris be the 2026 F1 Drivers' Champion?" }), "Lando Norris: burn if this resolves YES");
    assert.equal(outcomeButtonLabel({ outcome: "Dune: Part Two", question: "Which film wins Best Picture?" }), "Dune: Part Two: burn if this one wins");
    assert.equal(outcomeButtonLabel({ outcome: null, question: "Will it snow in Denver on Halloween?" }), "Will it snow in Denver on Halloween?: burn on this market");
    assert.equal(outcomeButtonLabel({ outcome: "Max Verstappen", closed: true }), "Max Verstappen: closed");
  });
  test("the page names the outcome rows, the one-market rows and the Kalshi market rows", () => {
    const pg = read("src/app/burnticker/launch/page.tsx");
    assert.match(pg, /data-outcome-button aria-label=\{outcomeButtonLabel\(m\)\} disabled=\{m\.closed\} onClick=\{\(\) => pickPoly\(m\)\}/);
    assert.match(pg, /aria-label=\{outcomeButtonLabel\(\{ \.\.\.m, outcome: null \}\)\}/);
    assert.match(pg, /aria-label=\{`\$\{m\.label\}: burn on this market`\}/);
  });
});

describe("HB-142 widened: an event-outcome coin is dated by its market's close, as 'by' that day", () => {
  test("the badge says BY on a market coin, the badge readers follow, and other one-shots keep their day", () => {
    const f1 = polyRule("0xf1");
    assert.ok(isMarketCoin(f1));
    assert.equal(windowBadge(f1, { endsAt: "2026-12-06T00:00:00Z" }), "ONE-SHOT · BY Dec 5, 2026");
    assert.equal(badgeDay("ONE-SHOT · BY Dec 5, 2026"), "2026-12-05");
    const t = describeRule(f1, { ticker: "NORRIS", eventPhrase: "Lando Norris is the 2026 F1 Drivers' Champion", endsAt: "2026-12-06T00:00:00Z" });
    assert.match(t.paragraph, /This coin resolves once, when the market settles \(it closes by Dec 5, 2026\)\./);
    assert.match(badgeFromText(f1, t.paragraph), /^ONE-SHOT · BY Dec 5, 2026$/);
    assert.equal(windowBadge(feedRule("usgs.quakenext:6"), { endsAt: "2026-12-06T00:00:00Z" }), "ONE-SHOT · Dec 5, 2026");
    assert.equal(isMarketCoin({ oracle: "kalshi", market: null }), false);
  });
});

describe("HS-57: the market search matches on content words and says when nothing matched every word", () => {
  test("stop words never count", () => {
    assert.deepEqual(contentWords("zzqxv nothing here"), ["zzqxv"]);
    assert.deepEqual(contentWords("Who will win the 2024 presidential election?"), ["win", "2024", "presidential", "election"]);
  });
  test("'zzqxv nothing here': the tennis and soccer hits matched on 'here' are dropped and the no-match line is said", () => {
    const hits = [["Cali Open: Smith vs Jones"], ["CS Herediano vs Saprissa", "Herediano"], ["Liga FPD winner", "CS Herediano"]];
    const m = searchMatch("zzqxv nothing here", hits);
    assert.equal(m.any, false); assert.equal(m.dim, false, "HB-165: nothing dims the list (the hits are dropped)");
    assert.equal(m.line, noMatchLine("zzqxv nothing here"));
    assert.equal(hits.filter((h) => keepHit(m.words, h)).length, 0);
  });
  test("'2024 presidential election': the 2027 elections stay under the closest-open line (HB-165: not dimmed, no 'closed' claim)", () => {
    const hits = [["French presidential election 2027"], ["Argentina presidential election 2027"], ["Bulgaria parliamentary election"]];
    const m = searchMatch("2024 presidential election", hits);
    assert.equal(m.full, false); assert.equal(m.dim, false);
    assert.equal(m.line, "No open market matches “2024 presidential election”. Here are the closest open ones:");
    assert.equal(hits.filter((h) => keepHit(m.words, h)).length, 3);
    const ok = searchMatch("presidential election", hits);
    assert.equal(ok.line, null); assert.equal(ok.dim, false);
  });
  test("the copy is plain, and the page shows the line above a dimmed list", () => {
    plain(noFullMatchLine("presidential election")); plain(noMatchLine("snow day"));
    const pg = read("src/app/burnticker/launch/page.tsx");
    // HB-165 (hourly run 15): the list is no longer dimmed; the hits are kept through `kept` (keepHit with the query and the ids)
    assert.match(pg, /\{sm\.line && !none && <p className="text-sm text-amber-200" role="status" data-search-no-full-match>\{sm\.line\}<\/p>\}<div className="space-y-4">/);
    assert.match(pg, /const fEvents = found\.events\.filter\(\(e\) => kept\(kEv\(e\)\)\);/);
    assert.match(pg, /const pm = polyFound && \{ \.\.\.polyFound, events: polyFound\.events\.filter\(\(e\) => kept\(pEv\(e\)\)\)/);
  });
});

describe("HS-58: the review says the address paragraph once, above Connect wallet, in its long form", () => {
  test("the long form, lint clean, and it answers the safety question", () => {
    plain(MINT_REVIEW_NOTE);
    assert.match(MINT_REVIEW_NOTE, /^Every coin made here gets an address that ends in burn\. This site prepares those mint keys ahead of time, keeps them encrypted/);
    assert.match(MINT_REVIEW_NOTE, /deletes it 24 hours later if that launch does not happen/);
    assert.match(MINT_REVIEW_NOTE, /Your wallet still signs the launch\./);
  });
  test("the mint block above the button carries it; the confirm block leaves the disclosure out when the block is there", () => {
    const ms = read("src/app/burnticker/launch/MintSearch.tsx");
    assert.match(ms, /data-mint-note>\{MINT_REVIEW_NOTE\}<\/p>/);
    assert.doesNotMatch(ms, /MINT_ADDRESS_NOTE/);
    const rc = read("src/app/burnticker/launch/ReviewCard.tsx");
    assert.match(rc, /\{!p\.mintSearch && <p className="mt-1 break-words text-neutral-400" data-mint-disclosure>\{MINT_KEY_DISCLOSURE\}<\/p>\}/);
    assert.ok(MINT_KEY_DISCLOSURE.startsWith("Every coin made here gets an address that ends in burn."));
  });
});

describe("HS-41 widened: the Pairs tab's burn count shows only once a side has burned, labelled as burns", () => {
  test("no burn: no score; a burn: the score with its label", () => {
    assert.equal(pairBurnScore(0, 0), null);
    assert.equal(pairBurnScore(null, undefined), null);
    assert.deepEqual(pairBurnScore(2, 0), { text: "2 : 0", label: "Burns so far: 2 to 0" });
    plain("Burns so far: 2 to 0"); assert.equal(PAIR_VS, "vs");
  });
  test("the row draws the score or vs, and the burns label only beside a score", () => {
    const ci = read("src/app/burnticker/CoinsIndex.tsx");
    assert.match(ci, /const sc = pairBurnScore\(p\.a\.burns, p\.b\.burns\); return sc \? <span className="text-2xl tabular-nums" aria-label=\{sc\.label\} data-pair-score>\{sc\.text\}<\/span> : <span className="text-sm text-neutral-500" data-pair-vs>\{PAIR_VS\}<\/span>;/);
    assert.match(ci, /\{pairBurnScore\(p\.a\.burns, p\.b\.burns\) && <span>burns<\/span>\}/);
    assert.doesNotMatch(ci, /\{p\.a\.burns\} <span className="text-neutral-500">:<\/span> \{p\.b\.burns\}/);
  });
});
