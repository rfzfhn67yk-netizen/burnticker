// sources-2 (2026-10-12): five new publishers, the fade side (inverse rules) and Polymarket's stated source and dispute window. Every
// reading here comes from a real response captured read-only on 2026-10-12 (config/burnticker/fixtures/http/*.json, polymarket/*.json,
// each with its fetchedAt); the $DEFICIT series is the treasury.debt fixture and the team season the Rays' 2025 MLB schedule.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { CatalogueAdapter, feedById, fixtureReadings, loadSourceEntries } from "@/lib/burnticker/catalogue";
import { fetchBody, parseBody, type HttpSourceConfig } from "@/lib/burnticker/sources/attestedHttp";
import { lockRule, isOneShot, validateRule, ruleStatement, type BurnRule } from "@/lib/burnticker/rules";
import { unitSteps } from "@/lib/burnticker/units";
import { describeRule, windowKindOf, WINDOW_SENTENCE, DESCRIPTION_MAX } from "@/lib/burnticker/describe";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import { firstPartyRule } from "@/lib/burnticker/wizard";
import { nativeRule } from "@/lib/burnticker/sources/native";
import { teamSeries, mlbGames } from "@/lib/burnticker/sources/espn";
import { nwsSeries } from "@/lib/burnticker/sources/nws";
import { canInvert, inverseRefusal, INVERSE_CHOICE } from "@/lib/burnticker/inverse";
import { applyDial, dialsFor } from "@/lib/burnticker/dials";
import { milestoneProblem } from "@/lib/burnticker/sources/github";
import { parseUsgsSeries } from "@/lib/burnticker/sources/usgs";
import { parseLl2Series, LL2_PROVIDERS } from "@/lib/burnticker/sources/launchLibrary";
import { finalAfter, statedSource, statedSentences, statedClause, UMA_DEFAULT_LIVENESS_S } from "@/lib/burnticker/sources/polyStated";
import { gammaResult, parseEventsBody, parseMarketsBody, PolymarketClient, polyStated, payoutIsFinal, resolvePolymarket, gammaFixtureFetch, rpcFixtureFetch } from "@/lib/burnticker/oracle/polymarket";
import { loadRefuseList, refusalsFor } from "@/lib/burnticker/oracle/refuse";
import type { FetchLike } from "@/lib/burnticker/oracle/types";
import { DEBT_RULE, fx } from "./burntickerHelpers.ts";
import fs from "node:fs";
import { serverDescribeCtx, statedCtx } from "@/lib/burnticker/coinText";

const NOW = Date.parse("2026-10-12T20:00:00Z");
const cfg = loadCopyLintConfig();
const lint = (t: string) => { const r = lintCopy(t, cfg); assert.ok(r.ok, `${r.hits.map((h) => `${h.phrase} (${h.rule})`).join(", ")}\n${t}`); };
const read = (id: string) => { const f = feedById(id); assert.ok(f, `${id} resolves`); return fixtureReadings(f!, NOW); };
const byId = (id: string) => Object.fromEntries(read(id).readings.map((r) => [r.id, r.value]));
const sum = (id: string) => read(id).readings.reduce((a, r) => a + Number(r.value), 0);
const text = (rule: BurnRule, ctx: Parameters<typeof describeRule>[1] = { ticker: "" }) => describeRule(rule, ctx);
const fail: FetchLike = async () => ({ ok: false, status: 429, json: async () => ({}) });

describe("A. five publishers: terms read, real fixtures, the coin text", () => {
  test("every new entry carries its operator, terms page, read date, one-paragraph read and a verdict", () => {
    const entries = loadSourceEntries() as (HttpSourceConfig & { id: string })[];
    const want: Record<string, string> = { "fedreg.eo": "allowed", "ll2.provider": "allowed-with-limits", "ll2.launch": "allowed-with-limits", "usgs.quakes": "allowed", "github.releases": "allowed-with-limits", "github.milestone": "allowed-with-limits", "youtube.milestone": "not-allowed", "congress.lawsSigned": "allowed" };
    for (const [id, verdict] of Object.entries(want)) {
      const e = entries.find((x) => x.id === id)!;
      assert.ok(e, id); assert.ok(e.operator, `${id} operator`);
      assert.equal(e.terms?.verdict, verdict, id); assert.match(e.terms!.url, /^https:\/\//); assert.equal(e.terms!.readAt, "2026-10-12");
      assert.ok(e.terms!.read.length > 200 && !/\n/.test(e.terms!.read), `${id}: one paragraph`);
    }
    assert.equal(feedById("youtube.milestone:UCLA_DiR1FfKNvjuUpBHmylQ/subscribers.15000000")!.launchable.ok, false, "terms forbid it");
    const j = fx("../sources.json") as { notSources?: { id: string; reason: string }[] };
    assert.match(j.notSources!.find((x) => x.id === "scotus.opinions")!.reason, /no API/);
    assert.ok(!entries.some((e) => /truth ?social/i.test(`${e.id} ${e.title} ${(e as { sourceUrl?: string }).sourceUrl ?? ""}`)), "never a Truth Social source");
  });

  test("Federal Register: executive orders by signing date, each day held 14 days (fixture 2026-10-12)", () => {
    const r = read("fedreg.eo");
    assert.equal(r.fetchedAt, "2026-10-12T19:25:00Z"); assert.deepEqual(r.refusals, []);
    const v = byId("fedreg.eo");
    assert.equal(v["2026-08-06"], "2", "EO 14418 and 14419 signed the same day"); assert.equal(v["2026-09-17"], "2"); assert.equal(v["2026-08-04"], "0", "a day with none reads 0");
    assert.equal(v["2026-09-28"], "0"); assert.ok(!("2026-09-29" in v), "09-29 (three orders) is inside the 14-day hold"); assert.ok(!("2026-10-05" in v));
    assert.equal(sum("fedreg.eo"), 15, "19 orders in the capture, 4 still held");
  });

  test("Launch Library 2: SpaceX by day; a named launch reads once, only when final; unknown providers refused", () => {
    const v = byId("ll2.provider:121");
    assert.equal(v["2026-10-10"], "1"); assert.equal(v["2026-09-28"], "1", "Starship Flight 14 counts 1 here (the older ll2.launches feed weights it 5)"); assert.equal(v["2026-10-11"], "0");
    assert.equal(feedById("ll2.provider:99999"), null); assert.equal(parseLl2Series("ll2.provider:121")?.kind, "provider"); assert.equal(LL2_PROVIDERS["121"].name, "SpaceX");
    const launch = feedById("ll2.launch:7d1afb26-6f9c-429b-9ccf-29012fd1e519")!;
    assert.deepEqual(fixtureReadings(launch, NOW).readings.map((x) => [x.id, x.value]), [["2026-09-28", "1"]]);
    const go = fx("http/ll2.launch.crs35.json") as { body: unknown };
    const pending = parseBody(feedById("ll2.launch:bf2c3027-a314-403e-a416-2bfd5d165ad1")!.config, go.body, NOW);
    assert.deepEqual(pending, { readings: [], refusals: [] }, "status Go: no reading yet, never a 0");
    assert.equal(isOneShot(firstPartyRule("ll2.launch:7d1afb26-6f9c-429b-9ccf-29012fd1e519")), true);
  });

  test("USGS: reviewed earthquakes per day at a magnitude, worldwide or a named box; not launchable; clinical fixture", () => {
    assert.deepEqual(parseUsgsSeries("usgs.quakes:6.5/japan"), { magnitude: "6.5", region: "japan" }); assert.equal(parseUsgsSeries("usgs.quakes:6.3"), null); assert.equal(parseUsgsSeries("usgs.quakes:6/mars"), null);
    const jp = feedById("usgs.quakes:6/japan")!;
    assert.match(jp.config.request.url, /minmagnitude=6&starttime=\{from:45\}&endtime=\{today\}&minlatitude=24&maxlatitude=46&minlongitude=122&maxlongitude=146/);
    assert.equal(jp.launchable.ok, false); assert.match(jp.flags.join(" "), /OWNER TO CONFIRM/);
    const v = byId("usgs.quakes:5.5");
    assert.equal(v["2026-10-09"], "5"); assert.equal(v["2026-10-07"], "0"); assert.ok(!("2026-10-11" in v), "a day is read two days after it ends");
    const body = JSON.stringify((fx("http/usgs.m55.json") as { body: unknown }).body);
    assert.doesNotMatch(body, /"(place|felt|alert|tsunami|mmi|cdi)"/, "no place names, felt reports or alert levels are kept");
    const ca = feedById("usgs.quakes:4/california")!;
    const c = parseBody(ca.config, (fx("http/usgs.ca4.json") as { body: unknown }).body, NOW);
    // both M4+ events in the box fell on 09-27, the oldest day of this read; a rolling read drops its oldest event day (read the day before)
    assert.deepEqual(c.refusals, []); assert.equal(c.readings[0].id, "2026-09-28"); assert.equal(c.readings.reduce((a, x) => a + Number(x.value), 0), 0);
  });

  test("GitHub: releases per day (no drafts or pre-releases), a star milestone reads once and only above N, the token header is optional", async () => {
    const v = byId("github.releases:anza-xyz/agave");
    assert.equal(v["2026-09-18"], "1", "v4.3.0 (the alpha the same day is a pre-release)"); assert.equal(v["2026-10-08"], "0", "v4.5.0-alpha.2 is a pre-release"); assert.equal(v["2026-08-28"], "1");
    assert.equal(sum("github.releases:anza-xyz/agave"), 11);
    assert.deepEqual(read("github.milestone:anza-xyz/agave.1900").readings.map((x) => [x.id, x.value]), [["reached-1900", "1"]]);
    assert.deepEqual(read("github.milestone:anza-xyz/agave.2000").readings, [], "1,944 stars: under 2,000, no reading");
    assert.equal(feedById("github.milestone:anza-xyz/agave.12"), null, "milestones start at 100");
    assert.equal(milestoneProblem(1944, 1900)!.includes("already passed"), true); assert.equal(milestoneProblem(1944, 2000), null);
    const guarded = { ...feedById("github.milestone:anza-xyz/agave.1900")!.config }; guarded.select = { ...guarded.select, milestone: { ...guarded.select.milestone!, guard: { path: "stargazers_count", min: 5000, why: "under the bar" } } };
    assert.deepEqual(parseBody(guarded, (fx("http/github.repo.json") as { body: unknown }).body, NOW).readings, [], "a guard refusal is never a reading");
    let seen: Record<string, string> = {};
    const cap: FetchLike = async (_u, init) => { seen = ((init as { headers?: Record<string, string> } | undefined)?.headers ?? {}); return { ok: true, status: 200, json: async () => ({ stargazers_count: 1 }) }; };
    await fetchBody(feedById("github.milestone:anza-xyz/agave.1900")!.config, NOW, cap, 1000, {});
    assert.equal(seen.authorization, undefined);
    await fetchBody(feedById("github.milestone:anza-xyz/agave.1900")!.config, NOW, cap, 1000, { BURNTICKER_GITHUB_TOKEN: "t-test" });
    assert.equal(seen.authorization, "Bearer t-test");
  });

  test("YouTube and Congress: no key means unavailable (a failed fetch, never a reading); the key is substituted only at request time", async () => {
    const yt = feedById("youtube.milestone:UCLA_DiR1FfKNvjuUpBHmylQ/subscribers.15000000")!;
    await assert.rejects(fetchBody(yt.config, NOW, fail, 1000, {}), /unavailable: needs a key \(BURNTICKER_YOUTUBE_API_KEY/);
    let url = "";
    await assert.rejects(fetchBody(yt.config, NOW, async (u) => { url = u; return { ok: false, status: 403, json: async () => ({}) }; }, 1000, { BURNTICKER_YOUTUBE_API_KEY: "k-test" }), /HTTP 403/);
    assert.match(url, /id=UCLA_DiR1FfKNvjuUpBHmylQ&key=k-test$/); assert.doesNotMatch(yt.config.request.url, /k-test/);
    assert.equal(yt.config.select.milestone!.guard!.min, 100_000, "public figures and organisations only");
    await assert.rejects(fetchBody(feedById("congress.lawsSigned")!.config, NOW, fail, 1000, {}), /unavailable: needs a key \(BURNTICKER_CONGRESS_API_KEY/);
  });

  test("the keeper's read: an unreachable publisher throws, so nothing is written (unavailable never becomes a zero)", async () => {
    const a = new CatalogueAdapter({ fetchImpl: fail, now: () => NOW });
    await assert.rejects(a.settledSince(firstPartyRule("fedreg.eo"), null), /HTTP 429/);
    await assert.rejects(a.settledSince(firstPartyRule("github.releases:anza-xyz/agave"), null), /HTTP 429/);
  });

  test("the coin text for every new series and its fade side: lint-clean, inside the limit, one window sentence of its kind", () => {
    const cases: { rule: BurnRule; kind: "perpetual" | "one-shot"; re: RegExp; ctx?: Record<string, unknown> }[] = [
      { rule: firstPartyRule("fedreg.eo"), kind: "perpetual", re: /burns for every executive order the President signs/ },
      { rule: { ...firstPartyRule("fedreg.eo"), inverse: true }, kind: "perpetual", re: /burns on every day the President signs no executive order/ },
      { rule: firstPartyRule("ll2.provider:121"), kind: "perpetual", re: /burns for every successful SpaceX launch/ },
      { rule: { ...firstPartyRule("ll2.provider:147"), inverse: true }, kind: "perpetual", re: /every day Rocket Lab has no successful launch/ },
      { rule: firstPartyRule("ll2.launch:7d1afb26-6f9c-429b-9ccf-29012fd1e519", 0.5), kind: "one-shot", re: /burns if the launch named Starship/, ctx: { subjectName: "Starship Flight 14" } },
      { rule: firstPartyRule("usgs.quakes:6"), kind: "perpetual", re: /every earthquake of magnitude 6 or more anywhere in the world/ },
      { rule: { ...firstPartyRule("usgs.quakes:5.5/california"), inverse: true }, kind: "perpetual", re: /every day with no earthquake of magnitude 5\.5 or more in California/ },
      { rule: firstPartyRule("github.releases:anza-xyz/agave"), kind: "perpetual", re: /burns when the anza-xyz\/agave repository ships a release/ },
      { rule: { ...firstPartyRule("github.releases:anza-xyz/agave"), inverse: true }, kind: "perpetual", re: /publishes no release/ },
      { rule: firstPartyRule("github.milestone:anza-xyz/agave.2000"), kind: "one-shot", re: /passes 2,000 stars/ },
      { rule: firstPartyRule("youtube.milestone:UCLA_DiR1FfKNvjuUpBHmylQ/subscribers.15000000"), kind: "one-shot", re: /passes 15,000,000 subscribers/, ctx: { subjectName: "NASA" } },
    ];
    for (const c of cases) {
      const locked = lockRule(c.rule);
      const t = text(locked.rule, { ticker: "", ...(c.ctx ?? {}) });
      lint(t.paragraph); assert.match(t.paragraph, c.re); assert.ok(t.paragraph.length <= DESCRIPTION_MAX, `${t.paragraph.length}`);
      assert.equal(windowKindOf(locked.rule), c.kind); assert.equal(t.windowKind, c.kind);
      for (const [k, re] of Object.entries(WINDOW_SENTENCE)) assert.equal((t.paragraph.match(new RegExp(re.source, "g")) ?? []).length, k === c.kind ? 1 : 0, `${k}\n${t.paragraph}`);
      assert.doesNotMatch(t.paragraph, /cross-checked against a second publisher/, "no cross-read is claimed where none exists");
    }
  });
});

describe("B. the fade side: inverse rules", () => {
  test("the $DEFICIT series under inverse: every flat or falling business day is one unit, every rising day none, no carry", () => {
    const f = feedById("treasury.debt")!;
    const { readings } = fixtureReadings(f, NOW);
    const plain = unitSteps(validateRule(DEBT_RULE), readings, f.carry);
    const inv = unitSteps(validateRule({ ...DEBT_RULE, inverse: true }), readings, f.carry);
    let flatOrDown = 0;
    for (let i = 0; i < readings.length; i++) {
      if (i === 0) { assert.equal(inv[0].step.units, 0, "the first reading is only the starting point"); continue; }
      const d = BigInt(Math.round(Number(readings[i].value) * 100)) - BigInt(Math.round(Number(readings[i - 1].value) * 100));
      const fired = d <= BigInt(0);
      if (fired) flatOrDown++;
      assert.equal(inv[i].step.units, fired ? 1 : 0, `${readings[i].id} moved ${d} cents`);
      assert.equal(inv[i].step.carryOut, "0");
      if (fired) assert.equal(plain[i].step.units, 0, `${readings[i].id}: never both`);
      if (inv[i].step.units) assert.deepEqual(inv[i].step.mapping, { fractionOfPool: 0.05 });
    }
    assert.ok(flatOrDown >= 1, "the series has flat or falling days");
    assert.equal(inv.reduce((a, s) => a + s.step.units, 0), flatOrDown);
    assert.ok(plain.some((s) => s.step.units > 0), "and rising days burn only under the plain rule");
  });

  test("a team season under inverse (the Rays' 2025 MLB schedule): every game day without a win is one unit", () => {
    const games = mlbGames((fx("sports/mlb.tb.2025.json") as { body: unknown }).body).filter((g) => g.completed && g.seasonType === 2);
    const byDay = new Map<string, { wins: number; games: number }>();
    for (const g of games) {
      const tb = g.home.abbr === "TB" ? g.home : g.away, opp = tb === g.home ? g.away : g.home;
      const d = byDay.get(g.date) ?? { wins: 0, games: 0 }; d.games++; if ((tb.score ?? 0) > (opp.score ?? 0)) d.wins++; byDay.set(g.date, d);
    }
    assert.ok(byDay.size >= 150, `${byDay.size} game days`);
    const events = [...byDay].sort(([a], [b]) => a.localeCompare(b)).map(([date, d]) => ({ id: date, at: date, result: null, value: String(d.wins), title: null, sourceUrl: "https://statsapi.mlb.com/" }));
    const s = teamSeries("mlb", "TB", "win", { kind: "season", year: 2025 });
    const plain = unitSteps(validateRule(nativeRule(s)), events), inv = unitSteps(validateRule({ ...nativeRule(s), inverse: true }), events);
    const winless = [...byDay.values()].filter((d) => d.wins === 0).length, wins = [...byDay.values()].reduce((a, d) => a + d.wins, 0);
    assert.equal(inv.reduce((a, x) => a + x.step.units, 0), winless); assert.equal(plain.reduce((a, x) => a + x.step.units, 0), wins);
    assert.ok(winless > 40 && wins > 40, `${wins} wins, ${winless} winless game days`);
    const t = text(validateRule({ ...nativeRule(s), inverse: true })); lint(t.paragraph);
    assert.match(t.paragraph, /burns on every game day the Rays do not win/); assert.match(t.paragraph, /A day with two games counts once/); assert.equal(t.windowKind, "season");
  });

  test("the hash: inverse is part of the locked text where present, absent everywhere else (existing hashes unchanged)", () => {
    const a = lockRule(DEBT_RULE), b = lockRule({ ...DEBT_RULE, inverse: true });
    assert.notEqual(a.sha256, b.sha256); assert.doesNotMatch(a.text, /inverse/); assert.match(b.text, /"inverse": true/);
    assert.equal(lockRule(JSON.parse(b.text)).sha256, b.sha256, "round-trips");
    assert.equal(lockRule({ ...DEBT_RULE, inverse: undefined }).sha256, a.sha256);
    assert.match(ruleStatement(b.rule), /a reading that does not rise above the previous settlement is one unit/);
  });

  test("refused where the binary choice or the end already covers it: markets, one-shots, pairs, league mode", () => {
    const poly = { schema: "burnticker.rules/v1", oracle: "polymarket", series: null, market: `0x${"a".repeat(64)}`, filter: {}, kind: "binary", binary: { onYes: { fractionOfPool: 0.05 }, onNo: null }, scalar: null, onVoid: "skip", floorUsd: "1", reserveSol: "0.02", vault: null, inverse: true };
    assert.throws(() => validateRule(poly), /inverse: Only a first-party feed rule/);
    for (const s of ["ll2.launch:7d1afb26-6f9c-429b-9ccf-29012fd1e519", "github.milestone:anza-xyz/agave.2000", nwsSeries("snow", "DEN")]) assert.throws(() => validateRule({ ...firstPartyRule(s), inverse: true }), /resolves once cannot be inverted/, s);
    assert.throws(() => validateRule({ ...DEBT_RULE, inverse: false }), /inverse must be true or absent/);
    const league = applyDial(nativeRule(teamSeries("mlb", "TB", "win", { kind: "season", year: 2026 })), "league", "on");
    assert.throws(() => validateRule({ ...league, inverse: true }), /League mode cannot be combined/);
    assert.equal(canInvert(validateRule(DEBT_RULE)), true); assert.equal(inverseRefusal(validateRule(nativeRule(nwsSeries("high", "DTW", 90)))), null);
    assert.deepEqual(INVERSE_CHOICE, { off: "Burn when it happens", on: "Burn on the days it does not happen" });
  });

  test("the review card's plain choice is a dial: a pure rewrite, offered only where allowed, switched off by league mode", () => {
    const debt = validateRule(DEBT_RULE);
    const d = dialsFor(debt);
    assert.ok(d.ids.includes("inverse")); assert.deepEqual(d.inverse, { on: false, options: [{ value: "off", label: "Burn when it happens" }, { value: "on", label: "Burn on the days it does not happen" }] });
    const on = applyDial(debt, "inverse", "on");
    assert.equal(validateRule(on).inverse, true); assert.equal(dialsFor(on).inverse!.on, true);
    assert.equal(lockRule(applyDial(on, "inverse", "off")).sha256, lockRule(debt).sha256, "off restores the plain rule's bytes");
    const team = nativeRule(teamSeries("mlb", "TB", "win", { kind: "season", year: 2026 }));
    const teamInv = applyDial(team, "inverse", "on");
    assert.equal(teamInv.inverse, true);
    const league = applyDial(teamInv, "league", "on");
    assert.equal(league.inverse, undefined, "league mode on switches the fade side off"); validateRule(league);
    assert.equal(applyDial(league, "inverse", "on").set, undefined, "and choosing the fade side switches league mode off"); 
    const poly = validateRule({ schema: "burnticker.rules/v1", oracle: "polymarket", series: null, market: `0x${"b".repeat(64)}`, filter: {}, kind: "binary", binary: { onYes: { fractionOfPool: 0.1 }, onNo: null }, scalar: null, onVoid: "skip", floorUsd: "1", reserveSol: "0.02", vault: null });
    assert.equal(dialsFor(poly).inverse, null); assert.equal(applyDial(poly, "inverse", "on"), poly);
    assert.equal(dialsFor(firstPartyRule("github.milestone:anza-xyz/agave.2000")).inverse, null, "a one-shot has no fade side");
  });

  test("the fade-side sentences: the debt, the weather, any other feed, lint-clean with one perpetual window sentence", () => {
    const feed = { title: "U.S. national debt (Debt to the Penny)", sourceName: "U.S. Treasury Fiscal Data", unitLabel: "$1B added", crossRead: "FRED's GFDEBTN series" };
    const debt = text(validateRule({ ...DEBT_RULE, inverse: true }), { ticker: "", feed });
    lint(debt.paragraph); assert.match(debt.paragraph, /This coin burns on the days the debt stays flat or falls\./); assert.equal(debt.windowKind, "perpetual");
    const cool = text(validateRule({ ...nativeRule(nwsSeries("high", "DTW", 90)), inverse: true })); lint(cool.paragraph); assert.match(cool.paragraph, /89 °F or colder/); assert.match(cool.paragraph, /Nothing happens on a day at 90 °F or hotter, or on a day with no reading/);
    const cpi = text(validateRule({ ...DEBT_RULE, series: "fred.CPIAUCSL", scalar: { unit: 1, perUnit: { fractionOfPool: 0.02 }, baseline: "previousSettlement", direction: "up" }, inverse: true }), { ticker: "", feed: { title: "Consumer Price Index (CPI-U)", sourceName: "FRED (St. Louis Fed)", unitLabel: "1 index point" } });
    lint(cpi.paragraph); assert.match(cpi.paragraph, /every reading of Consumer Price Index that does not rise/);
    for (const p of [debt, cool, cpi]) assert.equal((p.paragraph.match(new RegExp(WINDOW_SENTENCE.perpetual.source, "g")) ?? []).length, 1);
  });
});

describe("C. Polymarket: the stated source, the dispute window, and proposed is not final", () => {
  const SS = fx("polymarket/stated-source.json") as { fetchedAt: string; events: { url: string; body: unknown }[] };
  const ev = (slug: string) => parseEventsBody(SS.events.find((e) => e.url.endsWith(slug))!.body)[0];

  test("three real descriptions (2026-10-12): the Senate 2026, a Truth Social post count, the World Series champion", () => {
    assert.equal(SS.fetchedAt, "2026-10-12T19:28:00Z");
    const senate = ev("which-party-will-win-the-senate-in-2026").markets[0];
    const s1 = polyStated(senate);
    assert.match(s1.resolutionSource.text!, /^official information from relevant state electoral authorities, the United States Congress, and a consensus of credible reporting$/);
    assert.equal(s1.resolutionSource.publisher, null); assert.equal(s1.resolutionSource.crossRead, null); assert.equal(s1.resolutionSource.refused, null);
    assert.deepEqual([s1.finalAfter.seconds, s1.finalAfter.basis, s1.finalAfter.text], [UMA_DEFAULT_LIVENESS_S, "default", "about 2 hours"], "customLiveness 0: the documented default");
    const truth = ev("donald-trump-of-truth-social-posts-october-6-october-13-2026").markets[0];
    const s2 = polyStated(truth);
    assert.match(s2.resolutionSource.text!, /"Post Counter" figure for posts found at https:\/\/xtracker\.polymarket\.com$/);
    assert.equal(s2.resolutionSource.refused, "truth-social"); assert.equal(s2.resolutionSource.publisher, null);
    assert.equal(s2.finalAfter.proposals, 2, "Gamma's history shows two proposals");
    assert.ok(refusalsFor(loadRefuseList(), { titles: [truth.question] }).some((x) => x.id === "truth-social"), "and the market is refused at creation");
    const ws = ev("mlb-world-series-champion-2026").markets.find((m) => /Tampa Bay Rays/.test(m.question))!;
    const s3 = polyStated(ws);
    assert.match(s3.resolutionSource.text!, /^official information from MLB \(https:\/\/www\.mlb\.com\/\); however, a consensus of credible reporting may also be used$/);
    assert.deepEqual(s3.resolutionSource.publisher, { id: "mlb", name: "MLB", sources: ["mlb.statsapi"] });
    assert.deepEqual(s3.resolutionSource.crossRead, { publisher: "mlb", sources: ["mlb.statsapi"], text: "MLB's official feed" }, "the stated publisher has an adapter: the cross-read");
    assert.equal(statedClause("No source sentence here."), null);
    assert.equal(statedSource({ description: null, resolutionSource: null }).text, null);
    assert.deepEqual([finalAfter({ customLiveness: 900 }).basis, finalAfter({ customLiveness: 900 }).text], ["market", "about 15 minutes"]);
  });

  test("describe: the stated-source sentences on a Polymarket coin, lint-clean, both wordings", () => {
    const ws = ev("mlb-world-series-champion-2026").markets.find((m) => /Tampa Bay Rays/.test(m.question))!;
    const st = polyStated(ws);
    const rule = { schema: "burnticker.rules/v1", oracle: "polymarket", series: null, market: ws.conditionId, filter: {}, kind: "binary", binary: { onYes: { fractionOfPool: 0.1 }, onNo: null }, scalar: null, onVoid: "skip", floorUsd: "1", reserveSol: "0.02", vault: null } as BurnRule;
    const t = describeRule(validateRule(rule), { ticker: "", eventPhrase: "the Rays win the 2026 World Series", endsAt: "2026-10-31T23:55:00Z", stated: { phrase: st.resolutionSource.phrase, crossRead: st.resolutionSource.crossRead, finalAfter: st.finalAfter } });
    lint(t.paragraph); assert.ok(t.paragraph.length <= DESCRIPTION_MAX);
    assert.match(t.paragraph, /It settles on Polymarket's on-chain payout\. Polymarket states it resolves this from MLB\. The result becomes final after the dispute window of about 2 hours\. MLB's official feed is read as a cross-check\./);
    const senate = polyStated(ev("which-party-will-win-the-senate-in-2026").markets[0]);
    const s2 = statedSentences(senate.resolutionSource, senate.finalAfter); lint(s2);
    assert.match(s2, /Polymarket states it resolves this from official information from relevant state electoral authorities/);
    const none = statedSentences({ phrase: null, crossRead: null }, finalAfter({})); lint(none);
    assert.match(none, /Polymarket does not state a source for this market\. The result becomes final after the dispute window of about 2 hours\./);
  });

  test("legitimacy pass fix b: the server keeps the stated source in the pinned text, from its own market read, never the request's", () => {
    const ws = ev("mlb-world-series-champion-2026").markets.find((m) => /Tampa Bay Rays/.test(m.question))!;
    const st = polyStated(ws);
    const rule = validateRule({ schema: "burnticker.rules/v1", oracle: "polymarket", series: null, market: ws.conditionId, filter: {}, kind: "binary", binary: { onYes: { fractionOfPool: 0.1 }, onNo: null }, scalar: null, onVoid: "skip", floorUsd: "1", reserveSol: "0.02", vault: null } as BurnRule);
    const clientCtx = { eventPhrase: "the Rays win the 2026 World Series", stated: { phrase: st.resolutionSource.phrase, crossRead: st.resolutionSource.crossRead ? { text: st.resolutionSource.crossRead.text } : null, finalAfter: { text: st.finalAfter.text } } };
    const preview = describeRule(rule, { ticker: "RAYS", ...clientCtx }).paragraph;
    const server = statedCtx({ stated: st });
    assert.deepEqual(server, clientCtx.stated, "the server's read has the launch page's shape");
    const pinned = describeRule(rule, { ticker: "RAYS", ...serverDescribeCtx(rule, clientCtx, { seriesTitle: ws.question, stated: server }) }).paragraph;
    assert.equal(pinned, preview, "the pinned paragraph matches the preview");
    const forged = { ...clientCtx, stated: { phrase: "a source the client made up", crossRead: null, finalAfter: { text: "about 1 minute" } } };
    assert.equal(serverDescribeCtx(rule, forged, { seriesTitle: ws.question }).stated, undefined, "the request's stated is never used");
    assert.deepEqual(serverDescribeCtx(rule, forged, { seriesTitle: ws.question, stated: server }).stated, server);
    assert.equal(serverDescribeCtx({ ...rule, market: null, series: "polymarket:tag:mlb" } as BurnRule, null, { seriesTitle: "MLB", stated: server }).stated, undefined, "a series rule names no one market");
    assert.equal(statedCtx(null), null); assert.equal(statedCtx({}), null);
    const src = (f: string) => fs.readFileSync(f, "utf8");
    assert.match(src("src/lib/burnticker/api/handlers.ts"), /statedText = statedCtx\(info\);[\s\S]*serverDescribeCtx\(locked\.rule, \(body as \{ descCtx\?: unknown \}\)\.descCtx, \{ seriesTitle, feed: feedText, stated: statedText \}\)/);
    assert.match(src("src/app/api/burnticker/v1/launch/review/route.ts"), /platform\(\)\.polymarket\.seriesInfo\(rule\.market\)[\s\S]*buildLaunchReview\(body, \{ timeLockSecs: cachedTimeLockSecs\(cluster\), stated \}\)/);
  });

  test("a proposed-but-not-final payout is never read as settled (real market inside its dispute window, chain payout 0)", async () => {
    const P = fx("polymarket/proposed.market.json") as { fetchedAt: string; gamma: { url: string; body: unknown }; chain: { url: string; contract: string; blockNumber: string; calls: Record<string, string> } };
    const m = parseMarketsBody(P.gamma.body)[0];
    assert.equal(m.umaResolutionStatus, "proposed"); assert.deepEqual(m.umaStatuses, ["proposed"]); assert.equal(m.outcomeFigures[0], "0.9855", "Gamma's figures lean YES");
    assert.equal(gammaResult(m), null, "a proposal is not Gamma's resolved report either");
    const client = new PolymarketClient({ fetchImpl: gammaFixtureFetch({ [P.gamma.url]: P.gamma.body, [P.gamma.url.replace("closed=false", "closed=true")]: [] }), rpcFetch: rpcFixtureFetch(P.chain), rpcUrls: ["https://polygon-rpc.test"], now: () => Date.parse(P.fetchedAt), minIntervalMs: 0 });
    const chain = await client.readChain(m.conditionId);
    assert.equal(chain.resolved, false); assert.equal(chain.payoutDenominator, "0"); assert.equal(payoutIsFinal(chain), false);
    const rule = validateRule({ schema: "burnticker.rules/v1", oracle: "polymarket", series: null, market: m.conditionId, filter: {}, kind: "binary", binary: { onYes: { fractionOfPool: 0.1 }, onNo: null }, scalar: null, onVoid: "skip", floorUsd: "1", reserveSol: "0.02", vault: null });
    const pure = resolvePolymarket(rule, [{ market: { ...m, closed: true }, chain }], { sinceIso: null });
    assert.deepEqual(pure.events, [], "no settled event"); assert.equal(pure.awaitingFinal, 1, "counted as awaiting the final payout");
    const live = await client.settledSince(rule, null);
    assert.deepEqual(live.events, [], "the keeper's own read writes nothing for it");
    assert.equal(polyStated(m).finalAfter.status, "proposed");
  });
});
