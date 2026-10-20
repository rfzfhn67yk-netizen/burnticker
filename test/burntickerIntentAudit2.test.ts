// THE INTENT AUDITS 2–4 (2026-10-12), the parts in the shared libraries: past one-time events ("already decided") at the listing, the
// review and the preflight; the first-snow coin ends with its season; parsed temperatures never fall back to an example value; the
// championship year and polarity are part of the intent; parameterized sources keep their subject in the coin text; source links carry
// their parameters and resolved dates.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { ALREADY_DECIDED_SENTENCE, gameEligibility, ll2LaunchInfo, oneShotEligibility } from "@/lib/burnticker/oneShotEligibility";
import { catalogue, feedById, loadFixture, verifyUrl } from "@/lib/burnticker/catalogue";
import { catalogueSources, runBacktest, sampleEligibility } from "@/lib/burnticker/api/handlers";
import { preflightSelector } from "@/lib/burnticker/coverage/preflight";
import { detectRuleEnd, planToken } from "@/lib/burnticker/multiKeeper";
import { isFirstSnowSeries, nwsSeries, snowSeasonEnd, snowSeasonVoidFromMs } from "@/lib/burnticker/sources/nws";
import { nativeRule, setNativeClients } from "@/lib/burnticker/sources/native";
import { gameSeries } from "@/lib/burnticker/sources/espn";
import { lockRule, validateRule, DEFAULT_ON_END, type BurnRule } from "@/lib/burnticker/rules";
import { parseWeatherIntent, planWeather } from "@/lib/burnticker/weatherIntent";
import { universalSearch, readTeamIntent } from "@/lib/burnticker/search";
import { capName, describeRule, negatePhrase, paramSubject, DESCRIPTION_MAX } from "@/lib/burnticker/describe";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import type { FetchLike } from "@/lib/burnticker/oracle/types";
import { CHAMPIONSHIPS, ESPN_NOW, espnFixtureClient, exactFetch, fakeGameDeps } from "./burntickerFirstPartyHelpers.ts";

const cfg = loadCopyLintConfig();
const lint = (t: string) => { const r = lintCopy(t, cfg); assert.ok(r.ok, `${r.hits.map((h) => `${h.phrase} (${h.rule})`).join(", ")}\n${t}`); };
const NOW = Date.parse("2026-10-12T20:00:00Z");
const STARSHIP = "ll2.launch:7d1afb26-6f9c-429b-9ccf-29012fd1e519";
const UPCOMING_ID = "0b1c2d3e-4f50-4617-8293-a4b5c6d7e8f9";
const upcomingBody = { id: UPCOMING_ID, name: "Falcon 9 Block 5 | Example Mission", net: "2026-11-02T03:15:00Z", status: { id: 1, name: "Go for Launch", abbrev: "Go" }, launch_service_provider: { id: 121, name: "SpaceX" } };
const jsonFetch = (body: unknown): FetchLike => (async () => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) })) as unknown as FetchLike;
const catRule = (series: string): BurnRule => { const f = feedById(series)!; return validateRule({ schema: "burnticker.rules/v1", oracle: "catalogue", series, market: null, filter: {}, kind: "scalar", scalar: { unit: f.unit!.size, perUnit: { fractionOfPool: 0.02 }, baseline: f.baseline!, direction: f.direction! }, binary: null, onVoid: "skip", floorUsd: "1", reserveSol: "0.02", vault: null }); };

describe("intent audit 2 item 2 (list item 13): a one-time event that already has its result is not offered", () => {
  test("the listing: the resolved Starship flight is not launchable, with the shared sentence, its mission, provider, time, status, link and id", () => {
    const s = catalogueSources(NOW).sources.find((x) => x.id === STARSHIP) as Record<string, unknown> & { launchable: { ok: boolean; why: string }; subject: { name: string } };
    assert.equal(s.launchable.ok, false);
    assert.ok(s.launchable.why.startsWith(ALREADY_DECIDED_SENTENCE), s.launchable.why);
    assert.match(s.launchable.why, /Starship \| Starlink Group 31-1 \(Starship Flight 14\), by SpaceX\. Status: Launch Successful\. Launch time Sep 28, 2026, 12:48 PM UTC \(Sep 28, 6:48 AM Denver time\)\. Launch Library 2 id 7d1afb26-6f9c-429b-9ccf-29012fd1e519\./);
    assert.equal(s.title, "Starship | Starlink Group 31-1 (Starship Flight 14) succeeds (Launch Library 2)");
    assert.equal(s.sourceUrl, "https://ll.thespacedevs.com/2.3.0/launches/7d1afb26-6f9c-429b-9ccf-29012fd1e519/");
    lint(s.launchable.why);
  });

  test("the review (back-test refusals) and the creation preflight refuse it with the same sentence; the eligibility check does not wait for the launch gate", async () => {
    const bt = await runBacktest({} as never, { rule: catRule(STARSHIP) }, NOW);
    const body = bt.body as { refusals: { reason: string }[] };
    assert.equal(bt.status, 200); assert.ok(body.refusals[0].reason.startsWith(ALREADY_DECIDED_SENTENCE));
    assert.equal(sampleEligibility(feedById(STARSHIP)!, NOW).decided, true);
    const pf = await preflightSelector(catRule(STARSHIP), { fetchImpl: jsonFetch(loadFixture(feedById(STARSHIP)!).body), now: NOW });
    assert.equal(pf.refusal?.code, "already-decided"); assert.equal(pf.refusal?.status, 400);
    assert.ok(pf.refusal!.reason.startsWith(ALREADY_DECIDED_SENTENCE));
  });

  test("an upcoming launch is open: it shows its status and time, and 'no reading yet' is not a refusal for a one-time event", async () => {
    const id = `ll2.launch:${UPCOMING_ID}`;
    const e = oneShotEligibility(id, feedById(id)!.config, upcomingBody, NOW);
    assert.equal(e.decided, false); assert.equal(e.subject?.status, "Go for Launch"); assert.equal(e.subject?.net, "2026-11-02T03:15:00Z");
    assert.equal(ll2LaunchInfo(upcomingBody)?.final, false);
    const pf = await preflightSelector(catRule(id), { fetchImpl: jsonFetch(upcomingBody), now: NOW });
    assert.notEqual(pf.refusal?.code, "already-decided"); assert.notEqual(pf.refusal?.code, "no-readings");
    // the saved sample is of another launch: it says nothing about this one
    assert.equal(sampleEligibility(feedById(id)!, NOW).decided, false);
  });

  test("a GitHub star milestone already passed shares the sentence; one still ahead is open", () => {
    const body = { full_name: "anza-xyz/agave", stargazers_count: 1944 };
    const passed = oneShotEligibility("github.milestone:anza-xyz/agave.1000", feedById("github.milestone:anza-xyz/agave.1000")!.config, body, NOW);
    assert.equal(passed.decided, true);
    assert.equal(passed.reason, `${ALREADY_DECIDED_SENTENCE} The repository already has 1,944 stars, so a milestone of 1,000 has already passed.`);
    assert.equal(oneShotEligibility("github.milestone:anza-xyz/agave.2000", feedById("github.milestone:anza-xyz/agave.2000")!.config, body, NOW).decided, false);
    lint(passed.reason!);
  });

  test("the coin text never says a bare 'this launch': with no name known it names the immutable id", () => {
    const t = describeRule(catRule(`ll2.launch:${UPCOMING_ID}`), { ticker: "LAUNCHOK" });
    assert.match(t.paragraph, new RegExp(`the launch with Launch Library 2 id ${UPCOMING_ID}`));
    assert.doesNotMatch(t.paragraph, /this launch/);
  });
});

describe("the first snow resolves once (owner intent 2026-10-12; a keeper correction to the promised rule)", () => {
  const rule = lockRule({ ...nativeRule(nwsSeries("snow", "DEN"), { fractionOfPool: 0.02 }), onEnd: DEFAULT_ON_END });
  const tok = { mint: "SNOWMINT", ticker: "DENSNOW", selectorKey: "catalogue:nws.snow:DEN", baselineAt: "2026-10-12T20:00:00.000Z", status: "live" } as never;
  const receipt = (eventId: string, units: number) => ({ mint: "SNOWMINT", eventId, settledAt: eventId, result: null, value: String(units), units, mapping: units ? { fractionOfPool: 0.02 } : null, kind: units ? "up" : "flat", note: "", status: units ? "planned" : "zero" });
  const deps = (receipts: unknown[], now: number) => ({ registry: { ruleEnd: () => null, receipts: () => receipts }, dryRun: true, now: () => now, log: () => undefined }) as never;

  test("the season is the one holding the launch day: July 1 to June 30", () => {
    assert.equal(snowSeasonEnd("2026-10-12T20:00:00.000Z"), "2027-06-30");
    assert.equal(snowSeasonEnd("2027-03-01T00:00:00.000Z"), "2027-06-30");
    assert.equal(snowSeasonEnd("2027-07-01"), "2028-06-30");
    assert.equal(new Date(snowSeasonVoidFromMs("2027-06-30")).toISOString(), "2027-07-03T00:00:00.000Z");
    assert.ok(isFirstSnowSeries("nws.snow:DEN")); assert.ok(!isFirstSnowSeries("nws.high:DEN-90"));
  });

  test("a coin ends after its first snow (days of no snow are not the result); with no snow it ends void after June 30", () => {
    assert.equal(detectRuleEnd(deps([receipt("2026-10-20", 0), receipt("2026-10-21", 0)], Date.parse("2026-12-01")), tok, rule, null), null, "zero days do not end it");
    const end = detectRuleEnd(deps([receipt("2026-10-20", 0), receipt("2026-11-03", 1)], Date.parse("2026-11-05")), tok, rule, null);
    assert.equal(end?.mode, "winddown"); assert.equal(end?.reason, "the first snow of the season fell (2026-11-03)");
    assert.equal(detectRuleEnd(deps([], Date.parse("2027-07-02T23:00:00Z")), tok, rule, null), null, "the June 30 report is still being read");
    const v = detectRuleEnd(deps([], Date.parse("2027-07-03T00:00:00Z")), tok, rule, null);
    assert.match(v?.reason ?? "", /^void: the snow season ended on 2027-06-30 with no first snow after launch$/);
  });

  test("a later season's first snow is never planned for the coin", () => {
    const applied: string[] = [];
    const readings = [{ id: "2026-11-03", at: "2026-11-03", value: "0", result: null, title: "", sourceUrl: "" }, { id: "2027-11-09", at: "2027-11-09", value: "1", result: null, title: "", sourceUrl: "" }];
    const reg = { state: () => ({ mint: "SNOWMINT", lastEventId: null, lastValue: null, carryOut: "0", lastSettledAt: null }), readings: () => readings, receipt: (_m: string, id: string) => (applied.includes(id) ? { status: "planned" } : undefined),
      applyStep: (_m: string, e: { id: string }) => { applied.push(e.id); return true; }, recordAlert: () => false };
    planToken({ registry: reg, now: () => NOW, log: () => undefined } as never, tok, rule);
    assert.deepEqual(applied, ["2026-11-03"]);
  });
});

describe("intent audit 3 items 1 and 2 (list item 2): a temperature is parsed, never replaced by the example value", () => {
  const plan = (q: string) => planWeather(parseWeatherIntent(q)[0]);
  test("negatives in every spelling keep their sign; above -10 is -9 °F or hotter", () => {
    for (const q of ["Detroit high above -10", "Detroit high above −10", "Detroit high above minus 10", "Detroit high above negative 10"]) {
      const p = plan(q); assert.ok(p.ok, q); assert.equal(p.series, "nws.high:DTW--9", q); assert.equal(p.boundary, "-9 °F or hotter", q);
    }
    assert.ok(lockRule(nativeRule("nws.high:DTW--9")).rule.series === "nws.high:DTW--9");
    const below = plan("Detroit high below -10"); assert.ok(below.ok); assert.equal(below.boundary, "-11 °F or colder");
  });
  test("freezing is 32 °F and said so; any other word where a number belongs asks for a number", () => {
    const f = plan("Detroit high above freezing"); assert.ok(f.ok);
    assert.equal(f.series, "nws.high:DTW-33"); assert.equal(f.note, "Freezing is 32 °F, so “above freezing” means 33 °F or hotter.");
    for (const q of ["Detroit high above boiling", "Detroit high above normal", "Detroit high above average", "Denver rain above lots"]) {
      const p = plan(q); assert.ok(!p.ok, q); assert.match(p.refusal, /^I need a number\. “\w+” is not a/, q); assert.equal(p.alternative, null, q);
    }
    // hourly run 7, HB-95: one bound set (wxBounds.ts)
    assert.match((plan("Detroit high above 200") as { refusal: string }).refusal, /from -60 °F to 135 °F/);
  });
  test("the keep cases: above 0 → 1 °F; above 32.5 and at least 32.5 → 33 °F", () => {
    const b = (q: string) => { const p = plan(q); assert.ok(p.ok, q); return p.boundary; };
    assert.equal(b("Detroit high above 0"), "1 °F or hotter"); assert.equal(b("Detroit high above 32.5"), "33 °F or hotter"); assert.equal(b("Detroit high at least 32.5"), "33 °F or hotter");
  });
  test("a query with no number uses an example only as a labelled related rule, and says so", async () => {
    const p = plan("Detroit high"); assert.ok(p.ok); assert.equal(p.example, true); assert.match(p.note ?? "", /uses 90 °F as an example\. It is not the exact rule you asked for/);
    const deps = { venues: { kalshi: false, polymarket: false, feeds: true }, feeds: [], espn: espnFixtureClient(), polyGet: null, refuse: () => [], kalshiSearch: null, derbyHref: null, nowMs: ESPN_NOW };
    for (const q of ["Detroit high above -10", "Detroit high above freezing", "Detroit high above boiling"]) {
      const r = await universalSearch(q, deps);
      assert.equal(r.cards[0].group, "weather", q); assert.ok(!r.cards.some((c) => c.rule?.series === "nws.high:DTW-90" && !c.alternative), `${q}: never the unlabelled example`);
    }
    const ex = await universalSearch("Detroit high", deps); assert.equal(ex.cards[0].alternative, true);
  });
});

describe("intent audit 3 items 3 and 4 (list items 5 and 6): the championship year and polarity are part of the intent", () => {
  const polyGet = async (u: string) => { const r = await exactFetch(CHAMPIONSHIPS as Record<string, unknown>)(u); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); };
  const deps = { venues: { kalshi: false, polymarket: true, feeds: true }, feeds: [], espn: espnFixtureClient(), polyGet, refuse: () => [], kalshiSearch: null, derbyHref: null, nowMs: ESPN_NOW };
  test("the reader", () => {
    assert.deepEqual(readTeamIntent("Lakers win the 2028 NBA championship"), { year: 2028, negated: false });
    assert.deepEqual(readTeamIntent("Lakers do not win the 2027 NBA championship"), { year: 2027, negated: true });
    for (const q of ["Lakers don't win the title", "Lakers fail to win the championship", "Lakers never win the title"]) assert.equal(readTeamIntent(q).negated, true, q);
    assert.equal(negatePhrase("the Lakers win the 2027 NBA championship"), "the Lakers did NOT win the 2027 NBA championship");
  });
  test("2028 when only 2027 is open: the 2027 card leads, labelled a related rule, and the year it is says so", async () => {
    const r = await universalSearch("Lakers win the 2028 NBA championship", deps);
    const c = r.cards[0];
    assert.equal(c.title, "Burns 100% once, if the Lakers win the 2027 NBA championship"); assert.equal(c.alternative, true);
    assert.equal(c.note, "There is no open NBA championship market for 2028 on Polymarket. This card is the 2027 market, a different year from the one you typed.");
    assert.match(c.pick?.title ?? "", /2027 NBA championship/);
    const exact = await universalSearch("Lakers win the 2027 NBA championship", deps);
    assert.equal(exact.cards[0].alternative ?? false, false); assert.match(exact.cards[0].title, /2027 NBA championship$/);
  });
  test("'do not win': the NO side (binary.onNo), Lakers Fall Short, settles NO, and a void never counts as a NO", async () => {
    const r = await universalSearch("Lakers do not win the 2027 NBA championship", deps);
    const c = r.cards[0];
    assert.deepEqual(c.rule?.binary, { onYes: null, onNo: { fractionOfPool: 1 } });
    assert.equal(c.text?.name, "Lakers Fall Short");
    assert.match(c.text!.paragraph, /burns if the Polymarket market settles NO, meaning the Lakers did NOT win the 2027 NBA championship\./);
    assert.match(c.text!.paragraph, /A voided or cancelled market never counts as a NO, and nothing burns for it\./);
    assert.ok(r.cards.filter((x) => x.rule?.kind === "scalar").every((x) => x.alternative), "a win-counting card is only a related rule");
    lint(c.text!.paragraph); lint(c.title);
  });
});

describe("intent audit 4 items 19 and 20: parameterized sources keep their subject; links carry their parameters", () => {
  const text = (series: string) => { const f = feedById(series)!; return describeRule(catRule(series), { ticker: "", feed: { title: f.title, sourceName: f.sourceName, unitLabel: f.unit!.label } }); };
  test("Bitcoin on Wikipedia and Steam app 730: the subject, the source and what a reading measures; names cut at a word", () => {
    const w = text("wiki.views:Bitcoin");
    assert.equal(w.name, "Bitcoin Wiki Views");
    // sources-4: audit 207 (the views' scope), 206 (the app's name as Steam gives it), 204 (a snapshot, not the day's peak), 201 (an increase)
    assert.match(w.paragraph, /For every 1M views on the English Wikipedia article “Bitcoin”, .* Each reading is the total views of one UTC day, read once the day is over, counting every platform and every kind of visitor, automated ones included, as Wikimedia's all-access, all-agents figure does\./);
    const s = text("steam.players:730");
    assert.equal(s.name, "Counter-Strike 2 Players");
    assert.match(s.paragraph, /For each full increase of 100k players in the concurrent player count of Counter-Strike 2 \(Steam app 730\) over the previous snapshot, .*Each reading is a snapshot of the concurrent player count at the moment the keeper reads it, not the day's peak, measured against the previous reading\./);
    for (const t of [w, s]) { assert.doesNotMatch(t.paragraph, /an article|an app/); assert.ok(t.paragraph.length <= DESCRIPTION_MAX); lint(t.paragraph); }
    assert.equal(capName("Wikipedia daily views of an article"), "Wikipedia daily views", "35 characters: cut at a word, small words dropped");
    assert.equal(capName("Wikipedia daily views of an article about it"), "Wikipedia daily views", "never \"…of an arti\"");
    assert.equal(capName("Wikipedia daily views of the article Bitcoin", 32), "Wikipedia daily views");
    assert.equal(paramSubject("treasury.debt"), null);
  });
  test("every catalogue source's check link: no unresolved '{', and the selected public parameter present", () => {
    for (const f of catalogue()) {
      const u = verifyUrl(f, NOW);
      assert.doesNotMatch(u, /\{/, `${f.id}: ${u}`);
      assert.doesNotMatch(u, /key=|api_key=|token=/i, `${f.id}: no credential`);
      if (f.param) assert.ok(u.includes(f.param.split(/[/.]/)[0]), `${f.id}: ${u}`);
    }
    assert.equal(verifyUrl(feedById("steam.players:730")!, NOW), "https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=730");
    assert.equal(verifyUrl(feedById("wiki.views:Bitcoin")!, NOW), "https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/all-agents/Bitcoin/daily/20260902/20261011");
  });
});

describe("one game already played is decided (espn.game: a one-game coin and each Matchup side)", () => {
  const FINAL = { eventId: "849838", name: "Tampa Bay Rays at New York Yankees", startsAt: "2026-10-08T00:00:00Z", completed: true, state: "post", detail: "Final" };
  test("the shared sentence and the game's line; an upcoming or postponed game shows its status and start time in UTC and Denver", () => {
    const e = gameEligibility(FINAL);
    assert.equal(e.decided, true);
    assert.equal(e.reason, `${ALREADY_DECIDED_SENTENCE} Tampa Bay Rays at New York Yankees. Status: Final. Start time Oct 8, 2026, 12:00 AM UTC (Oct 7, 6:00 PM Denver time). Game id 849838.`);
    assert.equal(gameEligibility({ ...FINAL, completed: false, state: "pre", detail: "Thu, Oct 8th at 8:00 PM EDT" }).line, "Tampa Bay Rays at New York Yankees. Status: Scheduled. Start time Oct 8, 2026, 12:00 AM UTC (Oct 7, 6:00 PM Denver time). Game id 849838.");
    assert.match(gameEligibility({ ...FINAL, completed: false, state: "post", detail: "Postponed" }).line, /Status: Postponed\./);
    assert.equal(gameEligibility({ ...FINAL, completed: false, state: "post", detail: "Postponed" }).decided, false);
    lint(e.reason!);
  });
  test("the review and the creation preflight refuse a final game with the shared sentence", async () => {
    setNativeClients({ espn: espnFixtureClient(), games: fakeGameDeps() });
    try {
      const rule = nativeRule(gameSeries("mlb", "849838", "TB", "win"), { fractionOfPool: 0.1 });
      const bt = await runBacktest({} as never, { rule }, ESPN_NOW);
      const body = bt.body as { refusals: { reason: string }[]; sentence: string };
      assert.equal(bt.status, 200, JSON.stringify(bt.body).slice(0, 300));
      assert.ok(body.refusals[0]?.reason.startsWith(ALREADY_DECIDED_SENTENCE), JSON.stringify(body.refusals));
      assert.match(body.sentence, /Status: Final\./);
      const pf = await preflightSelector(rule, { now: ESPN_NOW });
      assert.equal(pf.refusal?.code, "already-decided"); assert.equal(pf.refusal?.status, 400);
      assert.ok(pf.refusal!.reason.startsWith(ALREADY_DECIDED_SENTENCE));
    } finally { setNativeClients({ espn: null, games: null }); }
  });
});
