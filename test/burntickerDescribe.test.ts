// THE AUTO-GENERATED COIN TEXT, THE WINDOW SENTENCE AND THE RULE DIALS (2026-10-10). Every fixture rule's paragraph lints clean, fits
// the launch limit and carries exactly one window sentence of its own kind; the search-card path and the Team coin path expose the same
// dials; each dial is a pure rewrite of the rule; suggested tickers are unique against the registry and the refuse list.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { championEndSentences, championPathRule, describeEndSink, describeRule, windowBadge, windowKindOf, WINDOW_SENTENCE, DESCRIPTION_MAX, PERPETUAL_SENTENCE, type DescribeCtx, type WindowKind } from "@/lib/burnticker/describe";
import { applyDial, dialsFor, leagueSetFor, ON_END_DEFAULT } from "@/lib/burnticker/dials";
import { nativeRule } from "@/lib/burnticker/sources/native";
import { teamSeries, gameSeries, type LeagueId, type Window } from "@/lib/burnticker/sources/espn";
import { nwsSeries } from "@/lib/burnticker/sources/nws";
import { polyRule, uniqueTicker, dedupeTickers, universalSearch, type Suggestion } from "@/lib/burnticker/search";
import { firstPartyRule } from "@/lib/burnticker/wizard";
import { BURNTICKER_RULES_SCHEMA, DEFAULT_ON_END, WIND_DOWN_ON_END, endSinkOf, validateRule, type BurnRule } from "@/lib/burnticker/rules";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import { catalogueSources } from "@/lib/burnticker/api/handlers";
import { ESPN_NOW, espnFixtureClient, exactFetch, CHAMPIONSHIPS } from "./burntickerFirstPartyHelpers.ts";

const S = (n: number) => ({ kind: "season", year: n }) as Window;
const team = (lg: LeagueId, abbr: string, o: "win" | "loss" | "draw", w: Window, f = 0.02) => nativeRule(teamSeries(lg, abbr, o, w), { fractionOfPool: f });
const feed = (series: string, unit: number) => ({ schema: BURNTICKER_RULES_SCHEMA, oracle: "catalogue", series, market: null, filter: {}, kind: "scalar", scalar: { unit, perUnit: { fractionOfPool: 0.02 }, baseline: "previousSettlement", direction: "up" }, binary: null, onVoid: "skip", floorUsd: "1", reserveSol: "0.02", vault: null }) as BurnRule;
const WS = "0x4d9567b9fa71a94b6e43ddb62ea6104cbb01926813938d241cce336bd72a8ba5";

/** Every fixture rule the cards and the dials can produce, with the context the card gives its template, and its window kind. */
const FIXTURES: { label: string; rule: BurnRule; ctx: Omit<DescribeCtx, "ticker">; kind: WindowKind }[] = [
  { label: "Rays win · this season", rule: team("mlb", "TB", "win", S(2026)), ctx: {}, kind: "season" },
  { label: "Rays win · postseason", rule: team("mlb", "TB", "win", { kind: "post", year: 2026 }), ctx: {}, kind: "post" },
  { label: "Rays win · next 5", rule: team("mlb", "TB", "win", { kind: "next", n: 5, from: "20261010" }), ctx: {}, kind: "next" },
  { label: "Rays win · perpetual", rule: team("mlb", "TB", "win", { kind: "perpetual" }), ctx: {}, kind: "perpetual" },
  { label: "Lakers win · 2026–27", rule: team("nba", "LAL", "win", S(2027)), ctx: {}, kind: "season" },
  { label: "Oilers lose · 2026–27", rule: team("nhl", "EDM", "loss", S(2027)), ctx: {}, kind: "season" },
  { label: "Arsenal win · 2026–27", rule: team("eng.1", "ARS", "win", S(2026)), ctx: {}, kind: "season" },
  { label: "Arsenal draw · perpetual", rule: team("eng.1", "ARS", "draw", { kind: "perpetual" }), ctx: {}, kind: "perpetual" },
  { label: "Inter Miami win · 2026", rule: team("usa.1", "MIA", "win", S(2026)), ctx: {}, kind: "season" },
  { label: "Georgia win · 2026", rule: team("cfb", "UGA", "win", S(2026)), ctx: {}, kind: "season" },
  { label: "Liberty win · 2026", rule: team("wnba", "NY", "win", S(2026)), ctx: {}, kind: "season" },
  { label: "Eagles win · this season", rule: team("nfl", "PHI", "win", S(2026)), ctx: {}, kind: "season" },
  { label: "Eagles lose · first form (legacy)", rule: nativeRule(teamSeries("nfl", "PHI", "loss")), ctx: {}, kind: "season" },
  { label: "one game (Eagles at JAX)", rule: nativeRule(gameSeries("nfl", "401872981", "PHI", "loss"), { fractionOfPool: 0.1 }), ctx: { game: { opponent: "Jaguars", home: false, startsAt: "2026-10-11T13:30:00Z" } }, kind: "one-shot" },
  { label: "Detroit high ≥ 90", rule: nativeRule(nwsSeries("high", "DTW", 90), { fractionOfPool: 0.01 }), ctx: {}, kind: "perpetual" },
  { label: "Seattle rain ≥ 0.5", rule: nativeRule(nwsSeries("rain", "SEA", 0.5), { fractionOfPool: 0.01 }), ctx: {}, kind: "perpetual" },
  { label: "Denver first snow", rule: nativeRule(nwsSeries("snow", "DEN"), { fractionOfPool: 0.01 }), ctx: {}, kind: "one-shot" },
  { label: "US debt per $1B", rule: feed("treasury.debt", 1e9), ctx: { feed: { title: "U.S. national debt (Debt to the Penny)", sourceName: "U.S. Treasury Fiscal Data", unitLabel: "$1B added" }, suggest: { name: "Debt Clock", ticker: "DEBT" } }, kind: "perpetual" },
  { label: "CPI per point", rule: feed("fred.CPIAUCSL", 1), ctx: { feed: { title: "Consumer Price Index (CPI-U)", sourceName: "FRED (St. Louis Fed)", unitLabel: "1 index point" }, suggest: { name: "CPI Mover", ticker: "CPI" } }, kind: "perpetual" },
  { label: "Rays win the World Series", rule: polyRule(WS, 0.1), ctx: { eventPhrase: "the Rays win the 2026 World Series", crossRead: "MLB's official results", endsAt: "2026-10-31T23:55:00Z", suggest: { name: "Rays World Series", ticker: "RAYSWS" } }, kind: "one-shot" },
  { label: "El-Sayed wins Michigan Senate", rule: polyRule("0xbfeb6d4cf3" + "0".repeat(54)), ctx: { eventPhrase: "Abdul El-Sayed (D) wins the Michigan Senate race", crossRead: "the Michigan certified result", endsAt: "2026-11-04" }, kind: "one-shot" },
  { label: "league mode (Rays, MLB 2026)", rule: applyDial(team("mlb", "TB", "win", S(2026)), "league", "on"), ctx: {}, kind: "season" },
  // END SINKS (LAUNCHPAD-PATH §45): every new launch carries onEnd.endSink (rules.ts DEFAULT_ON_END)
  { label: "end sink · Rays win · this season", rule: { ...team("mlb", "TB", "win", S(2026)), onEnd: { ...DEFAULT_ON_END } }, ctx: {}, kind: "season" },
  // website-18: the champion path with the longest MLB / NBA / NHL nicknames (the paragraph stays inside the launch limit)
  { label: "champion path · Golden Knights · 2026–27", rule: { ...team("nhl", "VGK", "win", S(2027)), onEnd: { ...DEFAULT_ON_END } }, ctx: {}, kind: "season" },
  { label: "champion path · Trail Blazers · 2026–27", rule: { ...team("nba", "POR", "win", S(2027), 0.1), onEnd: { ...DEFAULT_ON_END } }, ctx: {}, kind: "season" },
  { label: "champion path · Diamondbacks · 2026", rule: { ...team("mlb", "ARI", "win", S(2026), 0.05), onEnd: { ...DEFAULT_ON_END } }, ctx: {}, kind: "season" },
  { label: "end sink · Rays win · postseason", rule: { ...team("mlb", "TB", "win", { kind: "post", year: 2026 }), onEnd: { ...DEFAULT_ON_END } }, ctx: {}, kind: "post" },
  { label: "end sink · Rays win · next 5", rule: { ...team("mlb", "TB", "win", { kind: "next", n: 5, from: "20261010" }), onEnd: { ...DEFAULT_ON_END } }, ctx: {}, kind: "next" },
  { label: "end sink · Rays win · perpetual", rule: { ...team("mlb", "TB", "win", { kind: "perpetual" }), onEnd: { ...DEFAULT_ON_END } }, ctx: {}, kind: "perpetual" },
  { label: "end sink · Rays win the World Series", rule: { ...polyRule(WS, 0.1), onEnd: { ...DEFAULT_ON_END } }, ctx: { eventPhrase: "the Rays win the 2026 World Series", crossRead: "MLB's official results", endsAt: "2026-10-31T23:55:00Z", suggest: { name: "Rays World Series", ticker: "RAYSWS" } }, kind: "one-shot" },
];

describe("the generated description", () => {
  const cfg = loadCopyLintConfig();
  for (const f of FIXTURES) test(`${f.label}: lint-clean, ≤ ${DESCRIPTION_MAX}, exactly one ${f.kind} window sentence`, () => {
    const t = describeRule(f.rule, { ticker: "", ...f.ctx });
    const r = lintCopy(t.paragraph, cfg);
    assert.ok(r.ok, `${f.label}: ${r.hits.map((h) => `${h.phrase} (${h.rule})`).join(", ")}\n${t.paragraph}`);
    assert.ok(t.paragraph.length <= DESCRIPTION_MAX, `${t.paragraph.length} chars`);
    assert.equal(windowKindOf(f.rule), f.kind); assert.equal(t.windowKind, f.kind);
    for (const [k, re] of Object.entries(WINDOW_SENTENCE)) {
      const n = (t.paragraph.match(new RegExp(re.source, "g")) ?? []).length;
      assert.equal(n, k === f.kind ? 1 : 0, `${f.label}: ${n} × ${k} window sentence\n${t.paragraph}`);
    }
    assert.ok(t.paragraph.endsWith("The creator earns nothing. The liquidity pool is locked forever, and its fees fund the burn."));
    assert.ok(t.paragraph.startsWith(`$${t.ticker} burns `));
    assert.equal(t.badge, windowBadge(f.rule, f.ctx));
  });

  test("END SINKS (LAUNCHPAD-PATH §45): the season coin, word for word; the pair coin names the winning coin; the copy matches rules.ts", () => {
    // website-18: an MLB / NBA / NHL wins coin takes the champion path (its own test below); the NFL keeps the plain end
    const r = { ...team("nfl", "PHI", "win", S(2026)), onEnd: { ...DEFAULT_ON_END } } as BurnRule;
    const t = describeRule(r, { ticker: "" });
    assert.match(t.paragraph, /This coin covers the 2026 Eagles season only, including the playoffs\. After the Eagles' last game, whatever is left burns \$DEFICIT, and the coin retires\. It does not continue into 2027\. If the result is voided or the season is cancelled, whatever is left burns down on this coin over four weeks instead\. The creator earns nothing\./);
    const pair = { ...r, pair: { pairId: "p1", side: "A", counterpartMint: null, winnerTakesBurn: true } } as BurnRule;
    assert.match(describeRule(pair, { ticker: "" }).paragraph, /whatever is left burns the winning coin, or \$DEFICIT if there isn't one, and the coin retires\./);
    const one = describeRule({ ...polyRule(WS, 0.1), onEnd: { ...DEFAULT_ON_END } } as BurnRule, { ticker: "", eventPhrase: "the Rays win the 2026 World Series", endsAt: "2026-10-31T23:55:00Z" });
    assert.match(one.windowSentence, /^This coin resolves once, on Oct 31, 2026\. Then whatever is left burns \$DEFICIT, and the coin retires\.$/);
    // a perpetual coin never ends with a result, so it gets no void sentence; a vault rule has no burn pool and no sink
    assert.doesNotMatch(describeRule({ ...team("mlb", "TB", "win", { kind: "perpetual" }), onEnd: { ...DEFAULT_ON_END } } as BurnRule, { ticker: "" }).paragraph, /voided or the season is cancelled/);
    for (const x of [r, pair, { ...r, onEnd: { ...WIND_DOWN_ON_END } } as BurnRule, { ...r, scalar: { ...r.scalar!, perUnit: { tokens: 1000 } } } as BurnRule]) assert.equal(describeEndSink(x), endSinkOf(x), "describe.ts mirrors rules.ts endSinkOf");
  });

  test("website-18 the champion path: the Dodgers' coin word for word; only MLB, NBA and NHL wins coins with the $DEFICIT sink take it", () => {
    const r = { ...team("mlb", "LAD", "win", S(2026)), onEnd: { ...DEFAULT_ON_END } } as BurnRule;
    const t = describeRule(r, { ticker: "" });
    assert.equal(t.ticker, "DODGERS26");
    assert.equal(t.paragraph, "$DODGERS26 burns when the Dodgers win. This coin burns 2% of its pool every game the Dodgers win, through the last game of the postseason. Each burn buys $DODGERS26 on Raydium, with a receipt on chain. Each game's result comes from its market's on-chain payout if it has one, or else from a licensed final score. MLB's official feed confirms it. Nothing happens on a loss or a tie. This coin covers the 2026 season only. If the Dodgers win the championship, the rest of the pool burns here. If they do not, the rest goes to $DEFICIT's burn. If the result is voided or the season is cancelled, whatever is left burns down on this coin over four weeks instead. The creator earns nothing. The liquidity pool is locked forever, and its fees fund the burn.");
    assert.equal(t.ruleBlock.split(/(?<=\.)\s/)[0], "This coin burns 2% of its pool every game the Dodgers win, through the last game of the postseason.", "the review card's sentence");
    assert.deepEqual(championEndSentences("the Dodgers"), ["If the Dodgers win the championship, the rest of the pool burns here.", "If they do not, the rest goes to $DEFICIT's burn."]);
    assert.equal(championPathRule(r), true);
    // not the champion path: no end sink (an older rule), the fade side, a losses coin, the postseason window, the NFL, a pair coin
    for (const x of [team("mlb", "LAD", "win", S(2026)), { ...r, inverse: true }, { ...team("mlb", "LAD", "loss", S(2026)), onEnd: { ...DEFAULT_ON_END } }, { ...team("mlb", "LAD", "win", { kind: "post", year: 2026 }), onEnd: { ...DEFAULT_ON_END } }, { ...team("nfl", "PHI", "win", S(2026)), onEnd: { ...DEFAULT_ON_END } }, { ...r, pair: { pairId: "p1", side: "A", counterpartMint: null, winnerTakesBurn: true } }] as BurnRule[]) {
      assert.equal(championPathRule(x), false); assert.doesNotMatch(describeRule(x, { ticker: "" }).paragraph, /championship/);
    }
  });

  test("the Rays' season coin, word for word (the owner's target, with the window sentence and the year in the ticker)", () => {
    const t = describeRule(team("mlb", "TB", "win", S(2026)), { ticker: "" });
    assert.equal(t.ticker, "RAYS26"); assert.equal(t.badge, "2026 SEASON");
    assert.equal(t.paragraph, "$RAYS26 burns when the Rays win. For every Rays win in the 2026 season, the burn pool spends 2% buying $RAYS26 on Raydium and burns it, with a receipt on chain. Each game's result comes from its market's on-chain payout if it has one, or else from a licensed final score. MLB's official feed confirms it. Nothing happens on a loss or a tie. This coin covers the 2026 Rays season only, including the playoffs. After the Rays' last game, it burns down whatever is left over four weeks and then retires. It does not continue into 2027. The creator earns nothing. The liquidity pool is locked forever, and its fees fund the burn.");
    const e = describeRule(team("nfl", "PHI", "win", S(2026)), { ticker: "" });
    assert.equal(e.ticker, "EAGLES26");
    assert.match(e.windowSentence, /^This coin covers the 2026 Eagles season only, including the playoffs\. After the Eagles' last game, it burns down whatever is left over four weeks and then retires\. It does not continue into 2027\.$/);
  });

  test("perpetual: no end, the sentence says it, the ticker drops the year; soccer draws read as draws", () => {
    const p = describeRule(team("mlb", "TB", "win", { kind: "perpetual" }), { ticker: "" });
    assert.equal(p.ticker, "RAYS"); assert.equal(p.badge, "PERPETUAL"); assert.equal(p.windowSentence, PERPETUAL_SENTENCE);
    assert.doesNotMatch(p.paragraph, /retires\b(?!\.)|Ends /);
    const d = describeRule(team("eng.1", "ARS", "draw", S(2026)), { ticker: "" });
    assert.match(d.paragraph, /burns when Arsenal draw/); assert.match(d.paragraph, /Nothing happens on a win or a loss/); assert.equal(d.badge, "2026–27 SEASON");
  });

  test("badges: season, postseason, next N, perpetual, one-shot with its date", () => {
    assert.equal(windowBadge(team("mlb", "TB", "win", { kind: "post", year: 2026 })), "POSTSEASON 2026");
    assert.equal(windowBadge(team("mlb", "TB", "win", { kind: "next", n: 5, from: "20261010" })), "NEXT 5 GAMES");
    assert.equal(windowBadge(polyRule(WS), { endsAt: "2026-10-31T23:55:00Z" }), "ONE-SHOT · Oct 31, 2026");
    assert.equal(windowBadge(feed("treasury.debt", 1e9)), "PERPETUAL");
    assert.equal(windowBadge(team("mlb", "TB", "win", S(2025)), { endsAt: "2025-09-28T19:07:00Z", ended: true }), "2025 SEASON · ENDED Sep 28, 2025");
  });
});

describe("the rule dials", () => {
  const polyGet = async (u: string) => { const r = await exactFetch(CHAMPIONSHIPS as Record<string, unknown>)(u); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); };
  const deps = { venues: { kalshi: false, polymarket: true, feeds: true }, feeds: catalogueSources(ESPN_NOW).sources as never, espn: espnFixtureClient(), polyGet, refuse: () => [], kalshiSearch: null, derbyHref: null, nowMs: ESPN_NOW };
  const ctx = { nowMs: ESPN_NOW, seasonYear: 2026 };

  test("the search-card path exposes the same dial set as the Team coin path (Rays, this season)", async () => {
    const r = await universalSearch("Rays win", deps);
    const card = r.cards.find((c) => c.shape === "recurring")!;
    const viaTeamCoin = firstPartyRule(teamSeries("mlb", "TB", "win", { kind: "season", year: 2026 }), 0.02);   // the Team coin step: /sports/teams series.win, 2 %
    assert.equal(card.rule!.series, viaTeamCoin.series);
    const a = dialsFor(card.rule!, ctx), b = dialsFor(viaTeamCoin, ctx);
    assert.deepEqual(a, b);
    assert.deepEqual(a.ids, ["fraction", "league", "inverse", "side", "window"]);
    assert.deepEqual(a.window!.options.map((o) => o.value), ["season", "post", "next", "perpetual"]);
    assert.equal(a.fraction, 0.02); assert.deepEqual(a.bounds, { min: 0.01, max: 0.1, step: 0.005 });
  });

  test("the one-shot card: fraction 1–100 % (default 100 %, website-19), YES / NO, league mode from the card's set", async () => {
    const r = await universalSearch("Rays win the World Series", deps);
    const card = r.cards.find((c) => c.shape === "one-shot")! as Suggestion;
    const d = dialsFor(card.rule!, { ...ctx, set: card.leagueSet });
    assert.equal(d.fraction, 1); assert.deepEqual(d.bounds, { min: 0.01, max: 1, step: 0.01 }); assert.equal(d.side!.value, "yes");
    assert.deepEqual(d.league, { on: false, id: "champ-mlb-2026", outcome: "TB", forwardBps: 10_000 });
    assert.equal((applyDial(card.rule!, "fraction", 1) as BurnRule).binary!.onYes!.fractionOfPool, 1, "a one-shot may spend the whole pool");
    assert.equal((applyDial(card.rule!, "fraction", 3) as BurnRule).binary!.onYes!.fractionOfPool, 1);
  });

  test("each dial is a pure rewrite of the rule", () => {
    const r = team("mlb", "TB", "win", S(2026));
    assert.deepEqual((applyDial(r, "fraction", 0.5) as BurnRule).scalar!.perUnit, { fractionOfPool: 0.1 }, "recurring clamps at 10 %");
    assert.equal(applyDial(r, "side", "loss", ctx).series, "espn.team:mlb-TB.30-loss-s2026");
    assert.equal(applyDial(r, "side", "draw", ctx).series, r.series, "no draws in baseball");
    assert.equal(applyDial(team("eng.1", "ARS", "win", S(2026)), "side", "draw", ctx).series, "espn.team:eng.1-ARS.359-draw-s2026");
    const perp = applyDial(r, "window", "perpetual", ctx);
    assert.equal(perp.series, "espn.team:mlb-TB.30-win-perpetual");
    assert.equal(applyDial(perp, "window", "season", ctx).series, "espn.team:mlb-TB.30-win-s2026", "the season comes back from the context");
    const next = applyDial(r, "window", "next", ctx);
    assert.equal(next.series, "espn.team:mlb-TB.30-win-n5.20261010");
    assert.equal(applyDial(next, "games", 12, ctx).series, "espn.team:mlb-TB.30-win-n12.20261010");
    assert.equal(applyDial(next, "games", 99, ctx).series, "espn.team:mlb-TB.30-win-n20.20261010");
    assert.equal(applyDial(nativeRule(nwsSeries("high", "DTW", 90)), "threshold", 95).series, "nws.high:DTW-95");
    const lg = applyDial(r, "league", "on", ctx) as BurnRule;
    // §45: league-set end sinks are a later program round, so league mode keeps the wind-down (and turning it off brings the sink back)
    assert.deepEqual(lg.set, { id: "mlb-2026-win", outcome: "TB.30", forwardBps: 10_000 }); assert.deepEqual(lg.onEnd, WIND_DOWN_ON_END);
    assert.doesNotThrow(() => validateRule(lg));
    assert.equal((applyDial(lg, "forward", 2500) as BurnRule).set!.forwardBps, 2500);
    assert.equal((applyDial(lg, "league", "off") as BurnRule).set, undefined);
    assert.deepEqual((applyDial(lg, "league", "off") as BurnRule).onEnd, DEFAULT_ON_END);
    assert.match(describeRule(lg, { ticker: "" }).paragraph, /In league mode, 100% of the leftover goes to the winning coin of set mlb-2026-win if the forwarding instruction is live by season end\. Otherwise it burns down on this coin\./);
    assert.equal(leagueSetFor(applyDial(r, "window", "perpetual", ctx)), null, "a perpetual coin has no season to win");
    assert.equal(leagueSetFor(feed("treasury.debt", 1e9)), null, "a scalar feed has no winner");
    assert.deepEqual(ON_END_DEFAULT, DEFAULT_ON_END, "dials.ts mirrors rules.ts");
  });

  test("validateRule: league mode on a team season passes; on a scalar feed it is refused", () => {
    assert.doesNotThrow(() => validateRule(applyDial(team("mlb", "TB", "win", S(2026)), "league", "on")));
    assert.throws(() => validateRule({ ...feed("treasury.debt", 1e9), onEnd: { ...DEFAULT_ON_END }, set: { id: "debt-set", outcome: "x", forwardBps: 100 } } as BurnRule), /outcome list/);
  });
});

describe("ticker suggestions", () => {
  test("unique against the registry and the refuse list, ≤ 10 characters", () => {
    assert.equal(uniqueTicker("RAYS26", () => false), "RAYS26");
    assert.equal(uniqueTicker("RAYS26", (t) => t === "RAYS26"), "RAYS262");
    assert.equal(uniqueTicker("ARSENAL26", (t) => t === "ARSENAL26"), "ARSENAL262");
    assert.equal(uniqueTicker("INTERMIA26", (t) => t === "INTERMIA26"), "INTERMIA22", "the suffix replaces the tail so it stays 10 characters");
    assert.ok(uniqueTicker("ABCDEFGHIJ", (t) => t === "ABCDEFGHIJ").length <= 10);
    assert.equal(uniqueTicker("SCAM", () => false, (t) => t === "SCAM"), "SCAM2");
  });
  test("cards: a taken ticker gets the next free number and the text names it", () => {
    const text = describeRule(team("mlb", "TB", "win", S(2026)), { ticker: "" });
    const card = { id: "x", suggestedTicker: "RAYS26", text, windows: null, matchup: null } as unknown as Suggestion;
    const [c] = dedupeTickers([card], (t) => t === "RAYS26");
    assert.equal(c.suggestedTicker, "RAYS262");
    assert.ok(c.text!.paragraph.includes("$RAYS262") && !c.text!.paragraph.includes("$RAYS26 "));
  });
});
