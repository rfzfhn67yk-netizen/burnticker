// CHATGPT LAUNCH AUDIT 5 (2026-10-11), L01–L13 + site audit #4 / #10 / #18: the regressions for the launch flow.
//   L01/L10  one typed draft: every discovery card, every template and every entry path keeps its share from the card to the request,
//            the locked rule and initialize_token's fraction_per_unit_bps (the weather card said 1 %, the review showed 2 %)
//   L02      the availability model (closed / preview / open, per type, per source) and its server enforcement; the review payload
//   L04      "Detroit high above 90" is strictly above; "Lakers win tonight" leads with that game or labels the rest as alternatives
//   L05      sports provenance is generated from the resolver (no ESPN), schedule problems are plain words with the detail apart
//   L07      field checks in words; L11 category mapping; L12 names from the event's subject; L13 the Derby explainer
import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { universalSearch, queryDay, readWeatherThreshold, type Suggestion } from "@/lib/burnticker/search";
import { catalogueSources } from "@/lib/burnticker/api/handlers";
import { lockRule, type BurnRule } from "@/lib/burnticker/rules";
import { counterRule } from "@/lib/burnticker/program";
import { DEFAULT_SHARE, SHARE_PRESETS, pctLabel, presetProblem, presetRowLabel, shareOf, shareShapeOf, snapToPreset } from "@/lib/burnticker/launchPresets";
import { composeRule, fieldsFromRule, launchBody, DRAFT_DEFAULTS, type DraftPick } from "@/lib/burnticker/launchDraft";
import { TEMPLATES, TEMPLATE_START, WEATHER_TEMPLATE, weatherTemplateDraft, weatherTemplateRule } from "@/lib/burnticker/templates";
import { firstPartyRule } from "@/lib/burnticker/wizard";
import { nwsSeries } from "@/lib/burnticker/sources/nws";
import { describeRule } from "@/lib/burnticker/describe";
import { availabilityFromCatalogue, availabilityFromEnv, catalogueLaunches, globalRefusal, launchModeFromEnv, launchTypeOf, typeRefusal, CREATOR_LAUNCHES_PREVIEW_FLAG, PREVIEW_BANNER } from "@/lib/burnticker/launchAvailability";
import { launchGateFromCatalogue, wizardMayRender, wizardMaySign } from "@/lib/burnticker/launchGateState";
import { buildLaunchReview, rentLamports, TOKEN_CONFIG_BYTES, WIND_DOWN_LINE } from "@/lib/burnticker/launchReview";
import { nameProblem, tickerNormalised, tickerProblem, wxThresholdProblem } from "@/lib/burnticker/launchFields";
import { scheduleProblem, sportsProvenanceLine, SPORTS_PROVENANCE } from "@/lib/burnticker/sources/provenance";
import { eventIdentity } from "@/lib/burnticker/eventIdentity";
import { derbyExplainer } from "@/lib/burnticker/launchDerby";
import { categoryCards, loadCategories } from "@/lib/burnticker/browse";
import { loadCatalogue, reloadCatalogue } from "@/lib/burnticker/catalogueClient";
import { CREATOR_LAUNCHES_FLAG } from "@/lib/burnticker/creatorLaunches";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import type { EspnClient, Game } from "@/lib/burnticker/sources/espn";
import type { FeedLike } from "@/lib/burnticker/search";
import { CREATOR, API, POST_HEADERS, callRoute, makeWorld } from "./burntickerApiHelpers.ts";
import { ESPN_NOW, espnFixtureClient, exactFetch } from "./burntickerFirstPartyHelpers.ts";
import { fx } from "./burntickerHelpers.ts";

const ROOT = path.join(import.meta.dirname, "..");
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
const cfg = loadCopyLintConfig();
const lintOk = (t: string, label: string) => { const r = lintCopy(t, cfg); assert.ok(r.ok, `${label}: ${r.hits.map((h) => `${h.phrase} (${h.rule})`).join(", ")} in “${t}”`); };

const MI = fx("polymarket/event.michigan-senate.json") as { url: string; body: unknown[] };
const IDX = fx("polymarket/midterms.index.json") as { pages: { url: string; body: unknown[] }[] };
const POLY: Record<string, unknown> = { [MI.url]: MI.body, ...Object.fromEntries(IDX.pages.map((p) => [p.url, p.body])) };
const polyGet = async (u: string) => { const r = await exactFetch(POLY)(u); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); };
const deps = (over: Record<string, unknown> = {}) => ({ venues: { kalshi: false, polymarket: true, feeds: true }, feeds: catalogueSources(ESPN_NOW).sources as unknown as FeedLike[], espn: espnFixtureClient(), polyGet, refuse: () => [], kalshiSearch: null, derbyHref: null, nowMs: ESPN_NOW, ...over });

const saved = { [CREATOR_LAUNCHES_FLAG]: process.env[CREATOR_LAUNCHES_FLAG], [CREATOR_LAUNCHES_PREVIEW_FLAG]: process.env[CREATOR_LAUNCHES_PREVIEW_FLAG] };
afterEach(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });

/** The page's path from a card to the request body and the program's rule (launchDraft.ts — the same functions the page calls). */
function walk(c: Pick<Suggestion, "rule" | "pick" | "source">): { composed: BurnRule; bps: number } {
  const pick: DraftPick = { ...c.pick!, series: c.rule!.series ?? c.pick!.series, source: c.source ? { unit: c.source.unit, baseline: c.source.baseline, direction: c.source.direction } : null };
  const composed = composeRule(pick, fieldsFromRule(c.rule!, DRAFT_DEFAULTS))!;
  const body = launchBody({ creator: CREATOR, ticker: "TEST", name: "Test", description: "", descCtx: {}, note: "", rule: composed });
  const locked = lockRule(body.rule);
  return { composed, bps: counterRule(locked.rule, "TEST", "sel", { floorLamports: BigInt(1) }).rule.fraction_per_unit_bps };
}
function assertCardChain(c: Suggestion) {
  if (!c.rule || !c.pick) return;
  const f = shareOf(c.rule)!;
  assert.equal(presetProblem(c.rule), null, `${c.id}: the card's share ${f} is on its preset row`);
  const pct = /Burns (\d+(?:\.\d+)?)%/.exec(c.title)?.[1];
  if (pct) assert.equal(`${pct}%`, pctLabel(f), `${c.id}: the title names the rule's share`);
  if (c.text) assert.ok(c.text.ruleBlock.includes(pctLabel(f)), `${c.id}: the coin text names ${pctLabel(f)}`);
  const w = walk(c);
  assert.equal(shareOf(w.composed), f, `${c.id}: the review / request keeps the card's share`);
  assert.equal(w.bps, Math.round(f * 10_000), `${c.id}: initialize_token receives the card's share`);
}

describe("L01 / L10 — one typed draft from every card and template to the program", () => {
  test("the presets are one definition: recurring 1, 2, 5, 10 or 25 % (default 2), one-shot 100 or 50 % (default 100; owner 2026-10-12)", () => {
    assert.deepEqual(SHARE_PRESETS, { recurring: [0.01, 0.02, 0.05, 0.1, 0.25], oneShot: [1, 0.5] });
    assert.deepEqual(DEFAULT_SHARE, { recurring: 0.02, oneShot: 1 });
    assert.equal(presetRowLabel("recurring"), "1, 2, 5, 10 or 25%");
    assert.deepEqual(snapToPreset(0.03, "recurring"), { value: 0.02, changed: true }, "a 3 % share is moved, and the move is reported");
    assert.match(presetProblem(firstPartyRule(nwsSeries("high", "DTW", 90), 0.03))!, /burns 3% each time/);
  });

  test("the weather card (the audit's case): 'Detroit high above 90' burns 2 %, and the review, request and program all say 2 %", async () => {
    const r = await universalSearch("Detroit high above 90", deps());
    const c = r.cards[0];
    assert.equal(shareOf(c.rule!), 0.02); assert.match(c.title, /^Burns 2% /);
    assertCardChain(c);
  });

  test("every card of every entry query keeps its share to the program (teams, championships, weather, feeds, elections, markets)", async () => {
    let n = 0;
    for (const q of ["Rays win", "Rays win the World Series", "Rays lose", "Detroit high above 90", "Denver rain", "Boston snow", "US debt rises $1B", "rocket launches", "El-Sayed wins Michigan Senate", "CPI inflation"]) {
      const r = await universalSearch(q, deps());
      for (const c of r.cards) { assertCardChain(c); if (c.rule) n++; for (const w of c.windows ?? []) assertCardChain({ ...c, rule: w.rule, title: w.title, text: w.text }); }
    }
    assert.ok(n >= 10, `${n} rule cards walked`);
  });

  test("the weather station flow and the matchup and team paths build their rules on a preset (the page source)", () => {
    const page = read("src/app/burnticker/launch/page.tsx");
    assert.doesNotMatch(page, /firstPartyRule\(series, 0\.01\)/, "the station flow no longer builds a 1 % rule");
    assert.match(page, /firstPartyRule\(series, DEFAULT_SHARE\.recurring\)/);
    assert.match(page, /composeRule\(pick, \{/, "the reviewed rule is composeRule's (launchDraft.ts)");
    assert.match(page, /launchBody\(\{ creator, ticker, name/, "the single-coin request body is launchBody's");
    for (const [rule, label] of [[firstPartyRule("espn.game:mlb-401999999-TB-loss", 0.02), "matchup game"], [firstPartyRule("espn.team:mlb-TB.30-win-s2026", 0.02), "team season"]] as const) assert.equal(presetProblem(rule), null, label);
  });

  test("every template: the example names the template's share, the share is its row's default, and its start exists", () => {
    assert.equal(TEMPLATES.length, 12);
    for (const t of TEMPLATES) {
      assert.ok(TEMPLATE_START[t.id], `${t.id} has a start`);
      assert.ok([...SHARE_PRESETS.recurring, ...SHARE_PRESETS.oneShot].includes(t.share as never), `${t.id}: a preset share`);
      const named = [...t.example.matchAll(/(\d+(?:\.\d+)?)%/g)].map((m) => Number(m[1]) / 100);
      if (named.length) assert.equal(named[0], t.share, `${t.id}: the example's first share is the template's`);
      assert.doesNotMatch(t.example, /\b1%/, `${t.id}: no template offers 1 %`);
      lintOk(t.example, t.id);
      if (t.lands === "choices") assert.ok(t.choices && t.choices.length > 5, `${t.id}: says what is left to choose`);
    }
    assert.deepEqual(TEMPLATES.filter((t) => t.lands === "review").map((t) => t.id), ["weather"], "only the weather template opens the review card ready");
    assert.ok(TEMPLATES.find((t) => t.id === "bracket")!.operatorOnly, "the bracket says only the operator sets it up");
  });

  test("the weather template opens exactly its example: Detroit, 90 °F, 2 %, $DTWHOT — the example is generated from that rule", () => {
    const d = weatherTemplateDraft(), t = TEMPLATES.find((x) => x.id === "weather")!;
    assert.deepEqual(TEMPLATE_START.weather, { draft: "weather" });
    assert.equal(d.rule.series, "nws.high:DTW-90"); assert.equal(shareOf(d.rule), WEATHER_TEMPLATE.share); assert.equal(d.ticker, "DTWHOT");
    assert.ok(t.example.includes("Detroit") && t.example.includes("90 °F") && t.example.includes("2%"), t.example);
    assert.equal(t.example, describeRule(weatherTemplateRule(), { ticker: "DTWHOT" }).ruleBlock.split(/(?<=\.)\s/)[0]);
    assertCardChain({ id: "tpl:weather", title: t.example, rule: d.rule, pick: { oracle: "catalogue", series: d.rule.series, market: null, title: d.title }, source: { unit: { size: 1, label: "1 qualifying day", definition: "" }, baseline: 0, direction: "up" }, text: describeRule(d.rule, { ticker: "DTWHOT" }) } as unknown as Suggestion);
    assert.match(read("src/app/burnticker/launch/page.tsx"), /st\.draft === "weather"/);
  });
});

describe("L02 — availability: closed, preview and open, per type, per source, enforced on the server", () => {
  test("the mode from the flags: ENABLED wins; PREVIEW alone is preview; neither is closed", () => {
    assert.equal(launchModeFromEnv({}), "closed");
    assert.equal(launchModeFromEnv({ [CREATOR_LAUNCHES_PREVIEW_FLAG]: "1" }), "preview");
    assert.equal(launchModeFromEnv({ [CREATOR_LAUNCHES_PREVIEW_FLAG]: "1", [CREATOR_LAUNCHES_FLAG]: "1" }), "open");
    assert.equal(PREVIEW_BANNER, "This is a preview. Creator launches are closed, so nothing here builds or sends a transaction.");
    lintOk(PREVIEW_BANNER, "banner");
  });

  test("per type: on mainnet without TheSportsDB's key sports are unavailable; pairs need the pair curve; devnet takes both", () => {
    const main = availabilityFromEnv({}, "mainnet");
    assert.equal(main.types.team.available, false); assert.equal(main.types.matchup.available, false); assert.equal(main.types.derby.available, false); assert.equal(main.types.pairs.available, false);
    assert.equal(main.types.weather.available, true); assert.equal(main.types.feeds.available, true); assert.equal(main.types.markets.available, true);
    for (const t of Object.values(main.types)) if (t.reason) lintOk(t.reason, t.type);
    const keyed = availabilityFromEnv({ BURNTICKER_THESPORTSDB_KEY: "k", BURNTICKER_PAIR_CURVE_ENABLED: "1" }, "mainnet");
    assert.equal(keyed.types.team.available, true); assert.equal(keyed.types.pairs.available, true);
    assert.equal(availabilityFromEnv({}, "devnet").types.team.available, true);
    assert.equal(launchTypeOf({ oracle: "catalogue", series: "espn.team:mlb-TB.30-win-s2026", market: null }), "team");
    assert.equal(launchTypeOf({ oracle: "catalogue", series: "espn.game:mlb-401-TB-loss", market: null }), "matchup");
    assert.equal(launchTypeOf({ oracle: "catalogue", series: "nws.high:DTW-90", market: null }), "weather");
    assert.equal(launchTypeOf({ oracle: "polymarket", series: null, market: "0x1" }, { pair: true }), "pairs");
  });

  test("the server refuses: a closed host (creator-launches-closed), a preview host (launches-closed, preview: true), an unavailable type", () => {
    assert.equal(globalRefusal({})!.body.code, "creator-launches-closed");
    assert.deepEqual([globalRefusal({ [CREATOR_LAUNCHES_PREVIEW_FLAG]: "1" })!.body.code, globalRefusal({ [CREATOR_LAUNCHES_PREVIEW_FLAG]: "1" })!.body.preview], ["launches-closed", true]);
    assert.equal(globalRefusal({ [CREATOR_LAUNCHES_FLAG]: "1" }), null);
    const sports = { rule: firstPartyRule("espn.team:mlb-TB.30-win-s2026", 0.02) };
    assert.equal(typeRefusal(sports, {}, "mainnet")!.body.code, "launch-type-unavailable");
    assert.equal(typeRefusal(sports, { BURNTICKER_THESPORTSDB_KEY: "k" }, "mainnet"), null);
    assert.equal(typeRefusal({ rule: firstPartyRule(nwsSeries("high", "DTW", 90), 0.02) }, {}, "mainnet"), null);
  });

  test("preview on the routes: bundle, confirm and the wizard's launch route answer 403 launches-closed (preview: true); the review answers", async () => {
    await makeWorld();
    delete process.env[CREATOR_LAUNCHES_FLAG]; process.env[CREATOR_LAUNCHES_PREVIEW_FLAG] = "1";
    for (const p of ["launch/bundle", "launch/confirm"]) {
      const r = await callRoute(`${API}/${p}`, { method: "POST", headers: POST_HEADERS, body: JSON.stringify({ ticker: "X" }) });
      assert.equal(r.status, 403, p); const j = await r.json() as { code: string; preview: boolean }; assert.deepEqual([j.code, j.preview], ["launches-closed", true], p);
    }
    const app = await import("../src/app/api/burnticker/launch/route.ts");
    const ra = await app.POST(new Request("http://bt.test/api/burnticker/launch", { method: "POST", headers: { ...POST_HEADERS, host: "bt.test" }, body: "{}" }));
    assert.equal(ra.status, 403); assert.equal((await ra.json() as { code: string }).code, "launches-closed");
    const rule = firstPartyRule(nwsSeries("high", "DTW", 90), 0.02);
    const rv = await callRoute(`${API}/launch/review`, { method: "POST", headers: POST_HEADERS, body: JSON.stringify({ rule, ticker: "DTWHOT", name: "Detroit Heat" }) });
    assert.equal(rv.status, 200, await rv.clone().text());
    const j = await rv.json() as { mode: string; signable: boolean; rule: { sha256: string; share: string }; transactions: { count: number } };
    assert.equal(j.mode, "preview"); assert.equal(j.signable, false, "preview never signs"); assert.equal(j.rule.share, "2%"); assert.equal(j.transactions.count, 1);
    delete process.env[CREATOR_LAUNCHES_PREVIEW_FLAG];
    const closed = await callRoute(`${API}/launch/review`, { method: "POST", headers: POST_HEADERS, body: JSON.stringify({ rule, ticker: "DTWHOT", name: "Detroit Heat" }) });
    assert.equal(closed.status, 403, "a closed host gives no review");
  });

  test("the catalogue carries the model; the page gate renders the wizard in preview but never signs", () => {
    const l = catalogueLaunches({ [CREATOR_LAUNCHES_PREVIEW_FLAG]: "1", BURNTICKER_CLUSTER: "mainnet" });
    assert.deepEqual([l.creators, l.mode], [false, "preview"]); assert.equal(l.types.team.available, false);
    const g = launchGateFromCatalogue({ cluster: "mainnet", launches: l });
    assert.equal(g.kind, "preview"); assert.equal(wizardMayRender(g), true); assert.equal(wizardMaySign(g), false);
    assert.equal(availabilityFromCatalogue({ cluster: "mainnet", launches: l }).types.team.available, false);
    assert.equal(availabilityFromCatalogue(null).mode, "closed", "unreadable is closed");
    const page = read("src/app/burnticker/launch/page.tsx");
    assert.match(page, /data-preview-banner/); assert.match(page, /blocked=\{walletBlocked\(/, "the review card's wallet button carries the reason");
    assert.match(read("src/app/burnticker/launch/ReviewCard.tsx"), /disabled=\{!p\.ready \|\| p\.busy \|\| p\.problems\.length > 0 \|\| !!p\.blocked/);
  });

  test("the review payload: network, rule hash, the share, transactions and signers, estimated SOL, prerequisites, scoped authority", () => {
    const rule = firstPartyRule(nwsSeries("high", "DTW", 90), 0.02);
    const r = buildLaunchReview({ rule, ticker: "DTWHOT", name: "Detroit Heat" }, { env: { BURNTICKER_CLUSTER: "mainnet", [CREATOR_LAUNCHES_FLAG]: "1" } });
    assert.ok("review" in r); const v = r.review;
    assert.equal(v.network, "mainnet"); assert.equal(v.signable, true); assert.equal(v.rule.sha256, lockRule({ ...rule, onEnd: { windDownDays: 28, sweepThresholdLamports: 50_000_000, endSink: true } }).sha256, "§45: a rule sent without onEnd gets the end sink");
    assert.equal(v.transactions.count, 1); assert.deepEqual(v.transactions.steps[0].signers, ["your wallet", "a new key made for this coin"]);
    assert.ok(Number(v.costs.totalSol) > 0.05 && Number(v.costs.totalSol) < 0.07, v.costs.totalSol);
    assert.equal(rentLamports(TOKEN_CONFIG_BYTES), 6_897_360);
    assert.match(v.authority, /can still be upgraded/); assert.doesNotMatch(v.authority, /no one can change/i);
    assert.equal(v.rule.endsLine, "This coin has no end date and does not retire.", "a perpetual rule says so and nothing else");
    const once = buildLaunchReview({ rule: firstPartyRule("espn.game:mlb-401999999-TB-loss", 0.1), ticker: "TBGAME", name: "Rays Game" }, { env: {} });
    assert.ok("review" in once); assert.match(once.review.rule.endsLine, /goes to \$DEFICIT's burn\. Then the coin retires\. If the result is voided or the season is cancelled, whatever is left burns down on this coin over four weeks instead\./);
    assert.equal(v.costs.lines.find((l) => l.kind === "fee")!.sol, "0.00001", "small amounts keep their digits");
    assert.doesNotMatch(WIND_DOWN_LINE, /DEFICIT|sink|winner/i, "only the deployed self-burn wind-down");
    assert.match(v.operator, /contact@burnticker\.com/);
    for (const t of [v.authority, WIND_DOWN_LINE, v.transactions.note, v.costs.note, ...v.prerequisites, ...v.costs.lines.map((l) => l.label), v.rule.presets]) lintOk(t, "review");
    const bad = buildLaunchReview({ rule: firstPartyRule(nwsSeries("high", "DTW", 90), 0.01), ticker: "A B", name: "" }, { env: {} });
    assert.ok("review" in bad); assert.equal(bad.review.signable, false); assert.ok(bad.review.problems.length >= 2, bad.review.problems.join(" | "));
  });
});

describe("L04 — the interpreted event", () => {
  test("'above' is strictly above; 'reaches' / 'at least' keep the number; rain in hundredths", () => {
    assert.deepEqual(readWeatherThreshold("Detroit high above 90", "high"), { metric: "high", threshold: 91, strict: true, wrote: "above 90" });
    assert.equal(readWeatherThreshold("Detroit high reaches 90", "high").threshold, 90);
    assert.equal(readWeatherThreshold("Detroit high at least 90", "high").threshold, 90);
    assert.equal(readWeatherThreshold("Detroit high 90+", "high").threshold, 90);
    assert.equal(readWeatherThreshold("Denver rain over 0.5", "rain").threshold, 0.51);
  });

  test("'Lakers win tonight': the game tonight leads as a one-game card; the season and title cards are labelled alternatives", async () => {
    const now = Date.parse("2026-10-22T18:00:00Z");
    const side = (abbr: string, name: string, nickname: string, homeAway: "home" | "away") => ({ abbr, name, nickname, score: null, homeAway, record: null });
    const game: Game = { eventId: "401800001", league: "nba", startsAt: "2026-10-23T02:00:00Z", date: "2026-10-22", name: "Boston Celtics at Los Angeles Lakers", completed: false, state: "pre", detail: "", home: side("LAL", "Los Angeles Lakers", "Lakers", "home"), away: side("BOS", "Boston Celtics", "Celtics", "away") };
    const espn = { season: async () => [game] } as unknown as EspnClient;
    const r = await universalSearch("Lakers win tonight", deps({ espn, nowMs: now, polyGet: null }));
    assert.equal(r.cards[0].shape, "one-shot"); assert.equal(r.cards[0].rule?.series, "espn.game:nba-401800001-LAL-win");
    assert.ok(!r.cards[0].alternative); assert.ok(r.cards.slice(1).every((c) => c.alternative), "every other card is an alternative");
    assert.match(r.cards[0].interpreted ?? "", /Denver time/); assertCardChain(r.cards[0]);
    const none = await universalSearch("Lakers win tonight", deps({ espn: { season: async () => [] } as unknown as EspnClient, nowMs: now, polyGet: null }));
    assert.ok(none.cards.every((c) => c.alternative)); assert.match(none.cards[0].note ?? "", /No Lakers game is listed for today/);
    assert.equal(queryDay("Oilers lose tomorrow"), "tomorrow"); assert.equal(queryDay("Rays win"), null);
  });
});

describe("L05 — provenance from the resolver; schedule problems are display problems", () => {
  test("no ESPN in the provenance lines, the Browse sports card, or the launch page's rendered text", () => {
    for (const t of [sportsProvenanceLine(), SPORTS_PROVENANCE.settlement, SPORTS_PROVENANCE.confirmation, SPORTS_PROVENANCE.schedule]) { assert.doesNotMatch(t, /ESPN scoreboard|from ESPN/); }
    assert.match(sportsProvenanceLine(), /ESPN is not a source for any result/); assert.match(sportsProvenanceLine(), /on-chain payout/); assert.match(sportsProvenanceLine(), /TheSportsDB/);
    const sports = categoryCards(loadCategories().find((c) => c.id === "sports")!, { feeds: [], polymarket: [], kalshi: [] });
    for (const c of sports) { assert.doesNotMatch(`${c.venueLabel} ${c.sourceName} ${c.sourceUrl ?? ""} ${c.flags.join(" ")}`, /espn/i, c.id); }
    const page = read("src/app/burnticker/launch/page.tsx").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
    assert.doesNotMatch(page, /ESPN scoreboard/);
  });

  test("a schedule that cannot be read: a plain sentence that says settlement is unaffected; the technical detail apart", () => {
    const u = scheduleProblem("nba", "unreadable", "HTTP 403");
    assert.match(u.line, /settlement does not use this read/i); assert.doesNotMatch(u.line, /403|HTTP|BURNTICKER_/); assert.equal(u.detail, "HTTP 403");
    const k = scheduleProblem("nfl", "needs-licence");
    assert.doesNotMatch(k.line, /BURNTICKER_/); lintOk(u.line, "schedule"); lintOk(k.line, "licence");
  });

  test("warnings travel into the review; election settlement sentences carry no raw URL", async () => {
    const page = read("src/app/burnticker/launch/page.tsx");
    assert.match(page, /setSrcWarnings\(c\.note \? \[c\.note\] : \[\]\)/); assert.match(page, /warnings=\{\[\.\.\.srcWarnings, /, "website-20 (WIRING-PARITY audit 6 #8): the review's own warnings join the source's");
    const r = await universalSearch("El-Sayed wins Michigan Senate", deps());
    assert.doesNotMatch(r.cards[0].settlement, /https?:\/\//);
  });
});

describe("L07 — fields say what is wrong, next to the field", () => {
  test("threshold, name and ticker checks, and the visible ticker normalisation", () => {
    assert.match(wxThresholdProblem("high", "abc")!, /not a temperature/); assert.equal(wxThresholdProblem("high", "90"), null);
    assert.match(wxThresholdProblem("high", "90.5")!, /whole number/); assert.match(wxThresholdProblem("rain", "0.555")!, /two decimals/); assert.equal(wxThresholdProblem("rain", "0.29"), null);
    assert.match(nameProblem(""), /Enter a name/); assert.equal(nameProblem("Detroit Heat"), "");
    assert.match(tickerProblem("A"), /2 to 10/); assert.deepEqual(tickerNormalised("A B!?"), { value: "AB", note: "Tickers use only the letters A to Z and the digits 0 to 9, so spaces, “!”, “?” were removed. “A B!?” became “AB”." });
    // website-20 (audit 6 item 5): a cut at 10 characters is said, never silent
    assert.deepEqual(tickerNormalised("ABCDEFGHIJKLMN"), { value: "ABCDEFGHIJ", note: "A ticker has at most 10 characters, so “ABCDEFGHIJKLMN” was cut to “ABCDEFGHIJ”." });
    assert.equal(tickerNormalised("dtwhot").note, null, "a case change alone is not reported");
    const card = read("src/app/burnticker/launch/ReviewCard.tsx");
    assert.match(card, /aria-invalid=\{!!nErr\}/); assert.match(card, /aria-describedby=\{nErr \? `\$\{nId\}-err` : undefined\}/);
    assert.match(card, /disabled=\{editing && fieldProblems\.length > 0\}/, "done cannot hide a field with a problem");
    assert.match(read("src/app/burnticker/launch/page.tsx"), /disabled=\{!!thrErr\}/, "Use this rule is disabled with its reason");
  });
});

describe("L08 — accessibility in the review card and the wallet dialog", () => {
  test("labels per control, Coin A / B, two radiogroups, the wallet close button named, focus returned", () => {
    const card = read("src/app/burnticker/launch/ReviewCard.tsx");
    assert.match(card, /<label htmlFor=\{nId\}>\{who\}Name<\/label>/); assert.match(card, /Coin \$\{i === 0 \? "A" : "B"\}/);
    assert.match(card, /role="radiogroup" aria-label=\{p\.budget\?\.label \?\? BUDGET_LABEL\}/); assert.match(card, /export const BUDGET_LABEL = "Share of the burn pool per result";/);   // website-12 (A4): the dial is a share of the burn budget assert.match(card, /role="radiogroup" aria-label="How long the coins run"/);
    assert.match(read("src/app/burnticker/launch/WalletProviders.tsx"), /aria-label", "Close the wallet list"/);
    assert.match(card, /launchBtn\.current\?\.focus\(\)/);
  });
});

describe("L09 — the review fits 320 px", () => {
  test("grid and flex children shrink (min-w-0), long text wraps, the canonical JSON scrolls inside its box", () => {
    const card = read("src/app/burnticker/launch/ReviewCard.tsx"), sum = read("src/app/burnticker/launch/PreWalletSummary.tsx");
    assert.match(card, /min-w-0 max-w-full overflow-hidden rounded-xl/); assert.match(card, /bt-preview-frame min-w-0 max-w-full overflow-hidden/);
    assert.match(sum, /max-w-full overflow-auto whitespace-pre-wrap break-all/);
  });
});

describe("L11 — category mapping and stale results", () => {
  // sources-3 (2026-10-12): the weather tile is gone; the weather Polymarket tags now feed Natural disasters, which keeps disaster events only
  test("natural disasters keep disaster events only; the previous category's cards clear on a switch; nested loads end", () => {
    const wx = loadCategories().find((c) => c.id === "disasters")!;
    const ev = (title: string) => ({ slug: title.toLowerCase().replace(/\W+/g, "-"), title, url: "https://polymarket.com/event/x", endDate: null, closed: false, markets: [], marketCount: 1, refused: [] });
    const cards = categoryCards(wx, { feeds: [], polymarket: [ev("Largest IPO in 2026?"), ev("Human moon landing by 2027?"), ev("New pandemic declared?"), ev("Hottest year on record?"), ev("How many named storms in 2026?")] as never, kalshi: [] });
    assert.deepEqual(cards.filter((c) => c.venue === "polymarket").map((c) => c.title), ["How many named storms in 2026?"]);
    const page = read("src/app/burnticker/launch/page.tsx");
    assert.match(page, /if \(browseCat\.current !== cat\) \{ browseCat\.current = cat; setCards\(null\)/); assert.match(page, /seq !== browseSeq\.current/);
    assert.match(page, /AbortSignal\.timeout\(15_000\)/); assert.match(page, /drill !== null && drill === c\.pick\.series/, "a feed card (series null) never shows a stuck 'Loading events'"); assert.doesNotMatch(read("config/burnticker/refuse.json"), /LAUNCHPAD-PATH/);
  });
});

describe("L12 — names and tickers from the event's subject and outcome", () => {
  const cases: [string, string, string, string][] = [
    ["Will LeBron James retire before next NBA season?", "LeBron James Retires", "JAMESOUT", "LeBron James retires before next NBA season"],
    ["Abdul El-Sayed (D) wins the Michigan Senate race", "El-Sayed Wins", "ELSAYED", "Abdul El-Sayed (D) wins the Michigan Senate race"],
    ["Will Donald Trump win the 2028 presidential election?", "Trump Wins", "TRUMP", "Donald Trump wins the 2028 presidential election"],
    ["Will the Lakers win the 2027 NBA Championship?", "Lakers Win", "LAKERS", "the Lakers win the 2027 NBA Championship"],
    ["Will NYC hit 100°F in July?", "NYC Hits 100°F", "NYCHIT", "NYC hits 100°F in July"],
    ["Will Bitcoin reach $150,000 by December 31?", "Bitcoin Reaches $150,000", "BTCHIT", "Bitcoin reaches $150,000 by December 31"],
    ["Will the Federal Reserve cut interest rates by at least 50 basis points at the December 2026 FOMC meeting?", "Federal Reserve Cuts", "FEDCUT", "the Federal Reserve cuts interest rates by at least 50 basis points at the December 2026 FOMC meeting"],
  ];
  for (const [q, name, ticker, phrase] of cases) test(q, () => {
    const id = eventIdentity(q);
    assert.deepEqual([id.name, id.ticker, id.phrase, id.confident], [name, ticker, phrase, true]);
    assert.ok(id.name.length <= 32 && /^[A-Z0-9]{2,10}$/.test(id.ticker));
  });
  test("an uncertain question is flagged, so the page asks for a name", () => {
    assert.equal(eventIdentity("Will there be a recession in 2027?").confident, false);
    assert.equal(eventIdentity("Recession 2027").confident, false);
    assert.match(read("src/app/burnticker/launch/page.tsx"), /namePrompt=\{!pairOn && text\?\.name === "Event Coin"/);
  });
});

describe("L13 — Coin vs Coin says what it creates", () => {
  test("reference feeds versus new coins, the start and end in UTC and Denver, ties, missing and disputed readings", () => {
    const u = (symbol: string) => ({ symbol, pyth: "a".repeat(64), mint: null, pool: null, cross: "redstone:X", assetType: "crypto" });
    const x = derbyExplainer({ selector: "coinvs", a: u("WIF"), b: u("SHIB"), window: "daily", measure: "pct", season: { start: "2026-10-12", days: 30 }, flip: false } as never, { a: "TEAMWIF", b: "TEAMSHIB" });
    assert.match(x.references, /reference feeds/); assert.match(x.created, /two new coins, \$TEAMWIF and \$TEAMSHIB/);
    assert.match(x.start, /Oct 12, 2026, 12:00 AM UTC/); assert.match(x.start, /MDT/); assert.match(x.end, /Nov 11, 2026, 12:00 AM UTC/);
    assert.match(x.tie, /tie is a void/); assert.match(x.missing, /withholds that window/);
    for (const t of Object.values(x)) lintOk(t, "derby");
    assert.match(read("src/app/burnticker/launch/CoinVsCoinTile.tsx"), /data-derby-facts/);
  });
});

describe("site audit #10 / #18", () => {
  test("Enter moves to the first result; the search has a visible hint", () => {
    const page = read("src/app/burnticker/launch/page.tsx");
    assert.match(page, /if \(e\.key === "Enter"\) \{ e\.preventDefault\(\);/); assert.match(page, /data-first-result=\{ci === firstActionable/); assert.doesNotMatch(page, /search-hint|Results appear as you type/, "website-15 item 5: Enter jumps silently; no sentence describes the box");
  });
  test("one catalogue read per page load, shared by the page and the header", async () => {
    reloadCatalogue();
    let calls = 0;
    const f = (async () => { calls++; return new Response(JSON.stringify({ launches: { creators: false } }), { status: 200 }); }) as unknown as typeof fetch;
    await Promise.all([loadCatalogue(f), loadCatalogue(f), loadCatalogue(f), loadCatalogue(f), loadCatalogue(f)]);
    assert.equal(calls, 1); reloadCatalogue();
    assert.match(read("src/app/burnticker/_components/useLaunchAvailability.ts"), /loadCatalogue\(\)/); assert.match(read("src/app/burnticker/launch/page.tsx"), /loadCatalogue\(\)\.then/);
    assert.doesNotMatch(read("src/app/burnticker/launch/page.tsx"), /fetch\("\/api\/burnticker\/catalogue"\)/);
  });
});

describe("L03 — Back returns to the screen the review was entered from", () => {
  test("every entry path records its origin; Back restores flow, step, query, category and scroll; the label names the path", () => {
    const page = read("src/app/burnticker/launch/page.tsx");
    for (const k of ["search", "exact", "browse", "team", "matchup"]) assert.match(page, new RegExp(`markOrigin\\("${k}"\\)`), k);
    assert.match(page, /kind: "template"/, "the weather template records its origin");
    assert.match(page, /if \(step === "review" && origin\) \{[\s\S]*?setUq\(o\.uq\); setQ2\(o\.q2\); setCat\(o\.cat\); setBq\(o\.bq\);[\s\S]*?restoreScroll\.current = o\.scrollY;/);
    assert.match(page, /set\("uq", setUq\); set\("origin", setOrigin\);/, "the query and the origin survive a reload");
    assert.match(page, /origin\.kind === "browse" \? `Browse · /, "a Browse entry is labelled Browse, never 'From the search'");
  });
});

describe("copy: everything this pass shows passes the copy lint", () => {
  test("availability reasons, share notices, field messages, provenance", () => {
    for (const t of [...Object.values(availabilityFromEnv({}, "mainnet").types).map((t) => t.reason ?? ""), presetProblem(firstPartyRule(nwsSeries("high", "DTW", 90), 0.03))!, nameProblem(""), tickerProblem(""), wxThresholdProblem("high", "abc")!, sportsProvenanceLine(), shareShapeOf(firstPartyRule(nwsSeries("high", "DTW", 90), 0.02))].filter(Boolean)) lintOk(t, "copy");
  });
});
