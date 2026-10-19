// HB-4, HB-5, HB-7, HB-8, HB-10, HB-12, PROD-01 and PROD-03 (continuous audit 2026-10-19; docs/burnticker/audits/continuous/bugs.md and
// the 1913Z and 1949Z reports). Pure helpers first, then the review and the bundle route, then source checks on the launch page.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildLaunchReview } from "@/lib/burnticker/launchReview";
import { prepareLaunch } from "@/lib/burnticker/api/handlers";
import { BURN_REAL_WAITING, catalogueLaunches, siteLaunchState, siteLaunchStateFromCatalogue } from "@/lib/burnticker/launchAvailability";
import { REAL_BURN_DROPPED_NOTICE, REAL_BURN_FAMILY_REFUSAL, dropIneligibleBurnTarget, ownReferenceMints, realBurnAllowed, realBurnFamily, realBurnFamilyProblem, realBurnNotOwnCoin } from "@/lib/burnticker/burnRealEligibility";
import { ownRealPicks, realPickFor } from "@/app/burnticker/launch/burnReal";
import { endSinkOf, lockRule } from "@/lib/burnticker/rules";
import { gamePairRule, meetingsPairRules } from "@/lib/burnticker/guidedLaunch";
import { BURN_REAL_WAITING as WAITING } from "@/lib/burnticker/launchAvailability";
import { BONK as BONK_U, WIF as WIF_U, WIF_FEED, WIF_MINT, coinvsRule } from "./burntickerDerbyHelpers.ts";
import type { CoinVsSpec } from "@/lib/burnticker/derby/spec";
import { changeRuleEdgeIds, isMovingBaselineChangeRule } from "@/lib/burnticker/changeRule";
import { endChoicesFor, perCoinEndLines } from "@/lib/burnticker/pairEnds";
import { HAZARD_KINDS, HAZARD_ONCE_HALF_SENTENCE, HAZARD_PATTERNS, hazardOnceSentence, hazardPatternOptions } from "@/lib/burnticker/hazards";
import { FOLLOW_CHOICES, PATTERN_REASON, endChoiceModel, endSentences, seasonPairRules, withEndChoice } from "@/lib/burnticker/guidedLaunch";
import { sharePresetsForRule } from "@/lib/burnticker/launchPresets";
import { firstPartyRule } from "@/lib/burnticker/wizard";
import { applyDial, ON_END_DEFAULT } from "@/lib/burnticker/dials";
import { edgeCase } from "@/lib/burnticker/ruleEdgeCases";
import { RESERVED_TICKER_REFUSAL } from "@/lib/burnticker/reservedNames";
import { RESERVED_TICKER_LINE } from "@/app/burnticker/launch/pageCopy";
import { lintCopy, loadCopyLintConfig, formatHits } from "@/lib/launch/copyLint";
import type { BurnRule } from "@/lib/burnticker/rules";
import { BRONCOS, DEBT_RULE } from "./burntickerHelpers.ts";
import { CREATOR, makeWorld } from "./burntickerApiHelpers.ts";

const BONK = { mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", pool: "HVNwzt7Pxfu76KHCMQPTLuTCLTm6WnQ1esLv4eizseSv", symbol: "BONK", feedId: "72b021217ca3fe68922a19aaf990109cb9d84e9ad004b4d2025ad6f529314419" };
const MAINNET = { BURNTICKER_CLUSTER: "mainnet", BURNTICKER_CREATOR_LAUNCHES_ENABLED: "1" };
const R5 = { ...MAINNET, BURNTICKER_INITIALIZE_TOKEN_LAYOUT: "r5" };
const ON = { ...R5, BURNTICKER_BURN_REAL_ENABLED: "1" };
const DEVNET_R5 = { BURNTICKER_CLUSTER: "devnet", BURNTICKER_CREATOR_LAUNCHES_ENABLED: "1", BURNTICKER_INITIALIZE_TOKEN_LAYOUT: "r5" };
const NOW = Date.parse("2026-08-01T12:00:00Z");   // inside the Atlantic hurricane season, so every hazard's one-shot exists
const debt = (): BurnRule => ({ ...DEBT_RULE }) as unknown as BurnRule;
// a Coin comparison pair: side A is measured on WIF, side B on BONK; each may burn only its own pitted coin
const SPEC: CoinVsSpec = { selector: "coinvs", a: WIF_U, b: BONK_U, window: "daily", measure: "pct", season: { start: new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10), days: 7 }, flip: false };
const WIF_T = { mint: WIF_MINT, pool: BONK.pool, symbol: "WIF", feedId: WIF_FEED };
const cvc = (): BurnRule => coinvsRule(SPEC);
const rule = (series: string, f = 0.02): BurnRule => ({ ...firstPartyRule(series, f), onEnd: { ...ON_END_DEFAULT } }) as BurnRule;
const quakeNext = (f = 1): BurnRule => ({ ...applyDial(firstPartyRule("usgs.quakenext:7", 0.02), "fraction", f), onEnd: { ...ON_END_DEFAULT } }) as BurnRule;
const HAZARD_SERIES = HAZARD_KINDS.flatMap((k) => [k.every, k.once(2026)]);
const page = readFileSync("src/app/burnticker/launch/page.tsx", "utf8");
const tile = readFileSync("src/app/burnticker/launch/CoinVsCoinTile.tsx", "utf8");
const cfg = loadCopyLintConfig();
const clean = (t: string) => { const r = lintCopy(t, cfg); assert.ok(r.ok, `${t}\n${formatHits(r)}`); };
const review = (body: Record<string, unknown>, env: Record<string, string>) => {
  const r = buildLaunchReview({ ticker: "TESTX", name: "Test X", ...body } as never, { env, reserved: new Set(), now: NOW });
  assert.ok("review" in r, "problems" in r ? r.problems.join(" | ") : "");
  return r.review;
};

describe("HB-12 + PROD-01: the real-token burn contract (burnRealEligibility.ts)", () => {
  test("only a Coin comparison coin may burn another token; natural disasters, teams, markets, published data and other pairs may not", () => {
    for (const s of HAZARD_SERIES) { assert.equal(realBurnFamily(rule(s)), "natural-disaster", s); assert.equal(realBurnAllowed(rule(s)), false, s); }
    assert.equal(HAZARD_SERIES.length, 10, "earthquake, hurricane, tornado, wildfire and volcano, both patterns");
    assert.equal(realBurnFamily(BRONCOS as unknown as BurnRule), "event-outcome");
    assert.equal(realBurnFamily(rule("espn.team:nfl-DEN-loss")), "team");
    assert.equal(realBurnFamily({ ...debt(), pair: { pairId: "p", side: "A", counterpartMint: null } } as BurnRule), "pair");
    assert.equal(realBurnFamily({ ...debt(), vault: { share: 0.1, vestDays: 365, cliffDays: 0 } } as BurnRule), "vault");
    assert.equal(realBurnFamily(cvc()), "coin-comparison");
    assert.equal(realBurnFamily({ ...debt(), oracle: "derby" } as BurnRule), "other-derby", "a derby coin that is not Coin vs Coin");
    assert.equal(realBurnFamily(debt()), "published-data");
    // owner 2026-10-19: only a Coin comparison coin may burn another token; published data no longer may
    assert.equal(realBurnAllowed(debt()), false);
    assert.equal(realBurnAllowed(cvc()), true);
    assert.equal(realBurnAllowed(null), false);
    assert.equal(realBurnFamilyProblem(rule("usgs.quakes:6"), BONK), REAL_BURN_FAMILY_REFUSAL);
    assert.equal(realBurnFamilyProblem(rule("usgs.quakes:6"), null), null, "nothing named, nothing refused");
    assert.equal(realBurnFamilyProblem(debt(), BONK), REAL_BURN_FAMILY_REFUSAL);
    clean(realBurnNotOwnCoin("WIF")); clean(WAITING);
    assert.doesNotMatch(WAITING, /WIF|BONK/, "the waiting line names no fixed token");
    clean(REAL_BURN_FAMILY_REFUSAL); clean(REAL_BURN_DROPPED_NOTICE);
  });
  test("flag on: the review refuses a token on every hazard (both patterns) and on the debt; flag off: refused everywhere", () => {
    for (const s of HAZARD_SERIES) {
      const r0 = rule(s, s.includes("next") || /tornadoday|firesize|volcanowarning/.test(s) ? 1 : 0.02);
      const rv = review({ rule: { ...r0, burnTarget: BONK } }, ON);
      assert.ok(rv.problems.includes(REAL_BURN_FAMILY_REFUSAL), `${s}: ${rv.problems.join(" | ")}`);
      assert.equal(rv.signable, false, s);
    }
    assert.deepEqual(review({ rule: { ...debt(), burnTarget: BONK } }, ON).problems, [REAL_BURN_FAMILY_REFUSAL]);
    const off = review({ rule: { ...debt(), burnTarget: BONK } }, R5);
    assert.ok(off.problems.includes(BURN_REAL_WAITING)); assert.equal(off.signable, false);
    assert.equal(siteLaunchState(R5).burnReal.available, false, "flag off: the page offers the choice nowhere");
    assert.equal(siteLaunchState(ON).burnReal.available, true);
  });
  test("the bundle route refuses a token on an earthquake coin with burn-real-family while the flag is on", async (t) => {
    const was = process.env.BURNTICKER_BURN_REAL_ENABLED; process.env.BURNTICKER_BURN_REAL_ENABLED = "1";
    t.after(() => { if (was === undefined) delete process.env.BURNTICKER_BURN_REAL_ENABLED; else process.env.BURNTICKER_BURN_REAL_ENABLED = was; });
    const w = await makeWorld();
    const body = { creator: CREATOR, ticker: "QUAKEX", name: "Quake X", rule: { ...quakeNext(1), burnTarget: BONK }, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true } };
    const r = await prepareLaunch(w.p, body, { register: false }) as { error?: { status: number; body: { error: string; code: string } } };
    assert.equal(r.error?.status, 400); assert.equal(r.error?.body.code, "burn-real-family"); assert.equal(r.error?.body.error, REAL_BURN_FAMILY_REFUSAL);
  });
  test("a stale draft: a token saved on an earthquake or debt rule is dropped on resume with one notice; a Coin comparison side's own coin is kept; no draft is untouched", () => {
    const saved = { flow: "single", draft: { key: "k", a: { ...quakeNext(1), burnTarget: BONK }, b: null } };
    const { draft, notice } = dropIneligibleBurnTarget(saved);
    assert.equal(notice, REAL_BURN_DROPPED_NOTICE);
    assert.equal((draft.draft as { a: { burnTarget?: unknown } }).a.burnTarget, undefined);
    assert.equal(draft.flow, "single");
    const keep = { draft: { key: "k", a: { ...cvc(), burnTarget: WIF_T }, b: null } };
    assert.deepEqual(dropIneligibleBurnTarget(keep), { draft: keep, notice: null }, "a Coin comparison side's own coin is kept");
    const pub = dropIneligibleBurnTarget({ draft: { key: "k", a: { ...debt(), burnTarget: BONK }, b: null } });
    assert.equal(pub.notice, REAL_BURN_DROPPED_NOTICE, "published data may not keep one either");
    const none = { flow: "single" };
    assert.deepEqual(dropIneligibleBurnTarget(none), { draft: none, notice: null });
  });
  test("the page: the picker and the 'not offered yet' line follow the contract; resume normalises; a Coin comparison pair says nothing with the flag off", () => {
    assert.match(page, /const realOneOffered = site\.burnReal\.available && !pairOn && !!rule0 && !rule0\.vault && realBurnAllowed\(rule0\) && realOnePicks\.length > 0;/);
    assert.match(page, /const realOnePicks = useMemo\(\(\) => ownRealPicks\(rule0\), \[rule0\]\);/);
    assert.doesNotMatch(page, /SINGLE_REAL_PICKS/);
    assert.match(page, /: site\.burnReal\.line && rule0\?\.burnTarget && realBurnAllowed\(rule0\) \? <details/);
    assert.match(page, /dropIneligibleBurnTarget\(d0\); restoreFrom\(d\);/);
    assert.match(tile, /const realChoices = !a \|\| !b \|\| !realOn \? null : \(/);
    assert.doesNotMatch(tile, /data-burn-real-waiting/);
  });
});

describe("owner 2026-10-19: a Coin comparison coin burns only the coin it is measured against, whatever the two coins are", () => {
  test("the reference mints follow the pitted coins, not a fixed list (any two coins with a Solana mint)", () => {
    assert.deepEqual(ownReferenceMints(cvc(), "A"), { symbol: "WIF", mints: [WIF_MINT] });
    assert.deepEqual(ownReferenceMints(cvc(), "B"), { symbol: "BONK", mints: [BONK.mint] });
    const MEW = { symbol: "MEW", pyth: "a".repeat(64), mint: "MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5", pool: null, cross: "jup:MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5" };
    const POP = { symbol: "POPCAT", pyth: "b".repeat(64), mint: "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr", pool: null, cross: "jup:7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr" };
    const other = { ...cvc(), derby: { ...SPEC, a: MEW, b: POP } } as BurnRule;
    assert.deepEqual(ownReferenceMints(other, "A"), { symbol: "MEW", mints: [MEW.mint] });
    assert.equal(realBurnFamilyProblem(other, { ...WIF_T, mint: MEW.mint, symbol: "MEW" }, "A"), null);
    assert.equal(realBurnFamilyProblem(other, { ...WIF_T, mint: POP.mint, symbol: "POPCAT" }, "B"), null);
    assert.equal(realBurnFamilyProblem(other, WIF_T, "A"), realBurnNotOwnCoin("MEW"), "WIF is not in this comparison");
    assert.equal(realBurnFamilyProblem(other, { ...WIF_T, mint: POP.mint }, "A"), realBurnNotOwnCoin("MEW"), "side A may not burn side B's coin");
    assert.deepEqual(ownRealPicks(other, "A").map((x) => x.symbol), ["MEW"]);
    assert.deepEqual(ownRealPicks(other, "B").map((x) => x.symbol), ["POPCAT"]);
    assert.deepEqual(ownRealPicks(debt()), [], "no menu for any other coin");
  });
  test("the review: each side burning its own pitted coin raises no burn problem; any other mint is refused for that side", () => {
    const ok = review({ rule: { ...cvc(), burnTarget: WIF_T }, ticker: "TEAMWIF", name: "Team WIF", pair: { ticker: "TEAMBONK", name: "Team BONK", burnTarget: BONK } }, ON);
    const burnish = (ps: string[]) => ps.filter((x) => /measured against|burns its own token|burnTarget/.test(x));
    assert.deepEqual(burnish(ok.problems), [], ok.problems.join(" | "));
    const wrongA = review({ rule: { ...cvc(), burnTarget: BONK }, ticker: "TEAMWIF", name: "Team WIF", pair: { ticker: "TEAMBONK", name: "Team BONK" } }, ON);
    assert.ok(wrongA.problems.includes(realBurnNotOwnCoin("WIF")), wrongA.problems.join(" | "));
    const wrongB = review({ rule: cvc(), ticker: "TEAMWIF", name: "Team WIF", pair: { ticker: "TEAMBONK", name: "Team BONK", burnTarget: WIF_T } }, ON);
    assert.ok(wrongB.problems.includes(`Coin B. ${realBurnNotOwnCoin("BONK")}`), wrongB.problems.join(" | "));
  });
  test("the bundle route refuses a Coin comparison side that names a token other than its own pitted coin (side A and side B)", async (t) => {
    const was = process.env.BURNTICKER_BURN_REAL_ENABLED; process.env.BURNTICKER_BURN_REAL_ENABLED = "1";
    t.after(() => { if (was === undefined) delete process.env.BURNTICKER_BURN_REAL_ENABLED; else process.env.BURNTICKER_BURN_REAL_ENABLED = was; });
    const w = await makeWorld();
    const base = { creator: CREATOR, ticker: "TEAMWIF", name: "Team WIF", firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true } };
    type Out = { error?: { status: number; body: { error: string; code: string } } };
    const a = await prepareLaunch(w.p, { ...base, rule: { ...cvc(), burnTarget: BONK }, pair: { ticker: "TEAMBONK", name: "Team BONK", description: "", imageUrl: null, links: [] } }, { register: false }) as Out;
    assert.equal(a.error?.status, 400); assert.equal(a.error?.body.code, "burn-real-family"); assert.equal(a.error?.body.error, realBurnNotOwnCoin("WIF"));
    const b = await prepareLaunch(w.p, { ...base, ticker: "TEAMWIG", rule: cvc(), pair: { ticker: "TEAMBONQ", name: "Team BONQ", description: "", imageUrl: null, links: [], burnTarget: WIF_T } }, { register: false }) as Out;
    assert.equal(b.error?.status, 400, JSON.stringify(b.error?.body).slice(0, 300)); assert.equal(b.error?.body.code, "burn-real-family"); assert.equal(b.error?.body.error, `Side B: ${realBurnNotOwnCoin("BONK")}`);
  });
});

describe("PROD-04: the selected pitted coin's mint is its identity; a symbol never substitutes another mint", () => {
  // the external audit's fixture (2026-10-19T2049Z reference-identity): a coin labelled WIF or BONK with its own, different mint and feed
  const MEW_MINT = "MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5";
  const selected = { ...WIF_U, mint: MEW_MINT, pyth: "a".repeat(64), cross: `jup:${MEW_MINT}` };
  const specWith = (a: typeof WIF_U, b: typeof WIF_U): CoinVsSpec => ({ ...SPEC, a, b });
  test("the picker keeps the selected mint and feed whatever the symbol says (WIF, BONK, an unfamiliar one)", () => {
    for (const known of [WIF_U, BONK_U]) {
      const u = { ...known, mint: MEW_MINT, pyth: "a".repeat(64), cross: `jup:${MEW_MINT}` };
      const p = realPickFor(u)!;
      assert.equal(p.mint, MEW_MINT, known.symbol); assert.equal(p.feedId, "a".repeat(64), known.symbol);
    }
    assert.equal(realPickFor({ ...selected, symbol: "AUDITCOIN" })!.mint, MEW_MINT);
    assert.equal(realPickFor(WIF_U)!.mint, WIF_MINT, "the real WIF keeps its own mint");
  });
  test("the guard: both sides, WIF and BONK labels: the canonical mint is refused, the selected one accepted, by review and route", async (t) => {
    for (const known of [WIF_U, BONK_U]) for (const side of ["A", "B"] as const) {
      const other = { ...known, mint: MEW_MINT, pyth: "a".repeat(64), cross: `jup:${MEW_MINT}` };
      const r = coinvsRule(specWith(side === "A" ? other : { ...WIF_U, symbol: "OTHER" }, side === "B" ? other : { ...BONK_U, symbol: "OTHER" }));
      assert.equal(realBurnFamilyProblem(r, { mint: known.mint }, side), realBurnNotOwnCoin(known.symbol), `${known.symbol} ${side}`);
      assert.equal(realBurnFamilyProblem(r, { mint: MEW_MINT }, side), null, `${known.symbol} ${side}`);
      assert.deepEqual(ownReferenceMints(r, side), { symbol: known.symbol, mints: [MEW_MINT] });
      // restored drafts keep only the selected mint
      const saved = { draft: { key: "audit", a: side === "A" ? { ...r, burnTarget: { mint: known.mint } } : null, b: side === "B" ? { ...r, burnTarget: { mint: known.mint } } : null } };
      const cleaned = dropIneligibleBurnTarget(saved).draft.draft as Record<string, { burnTarget?: unknown } | null>;
      assert.equal(cleaned[side.toLowerCase()]!.burnTarget, undefined, `${known.symbol} ${side} draft`);
      const kept = { draft: { key: "audit", a: side === "A" ? { ...r, burnTarget: { mint: MEW_MINT } } : null, b: side === "B" ? { ...r, burnTarget: { mint: MEW_MINT } } : null } };
      assert.equal(dropIneligibleBurnTarget(kept).notice, null);
    }
    const rule = coinvsRule(specWith(selected, BONK_U));
    const canon = { ...WIF_T }, own = { ...WIF_T, mint: MEW_MINT, feedId: "a".repeat(64) };
    const body = (bt: unknown) => ({ rule: { ...rule, burnTarget: bt }, ticker: "TEAMWIF", name: "Team WIF", pair: { ticker: "TEAMBONK", name: "Team BONK" } });
    assert.ok(review(body(canon), ON).problems.includes(realBurnNotOwnCoin("WIF")));
    assert.ok(!review(body(own), ON).problems.some((x) => /measured against|burns its own token/.test(x)));
    const was = process.env.BURNTICKER_BURN_REAL_ENABLED; process.env.BURNTICKER_BURN_REAL_ENABLED = "1";
    t.after(() => { if (was === undefined) delete process.env.BURNTICKER_BURN_REAL_ENABLED; else process.env.BURNTICKER_BURN_REAL_ENABLED = was; });
    const w = await makeWorld();
    const r1 = await prepareLaunch(w.p, { creator: CREATOR, ticker: "TEAMWIF", name: "Team WIF", firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true }, rule: { ...rule, burnTarget: canon }, pair: { ticker: "TEAMBONK", name: "Team BONK", description: "", imageUrl: null, links: [] } }, { register: false }) as { error?: { status: number; body: { error: string; code: string } } };
    assert.equal(r1.error?.status, 400); assert.equal(r1.error?.body.code, "burn-real-family"); assert.equal(r1.error?.body.error, realBurnNotOwnCoin("WIF"));
    const r2 = await prepareLaunch(w.p, { creator: CREATOR, ticker: "TEAMWIH", name: "Team WIH", firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true }, rule: { ...rule, burnTarget: own }, pair: { ticker: "TEAMBONH", name: "Team BONH", description: "", imageUrl: null, links: [] } }, { register: false }) as { error?: { body: { code: string } } };
    assert.notEqual(r2.error?.body.code, "burn-real-family", "the selected mint passes the guard");
  });
});

describe("owner 2026-10-19: team and candidate rivalries keep burning each other through the pair, untouched by the contract", () => {
  test("a rivalry names no token, so the contract has nothing to refuse; the series pair reviews with no burn refusal", () => {
    const m = meetingsPairRules("nba", "PHI", "BOS", 2026);
    for (const r of [m.a, m.b, gamePairRule("nba", "0022500001", "PHI")]) assert.equal(realBurnFamilyProblem(r, undefined), null);
    const rv = review({ rule: m.a, ticker: "PHISER", name: "Sixers Series", pair: { ticker: "BOSSER", name: "Celtics Series" } }, ON);
    assert.ok(!rv.problems.some((x) => x === REAL_BURN_FAMILY_REFUSAL || /measured against/.test(x)), rv.problems.join(" | "));
    assert.equal(rv.meetings !== undefined, true, "reviewed as the linked series pair it launches as");
  });
  test("a one-game rivalry builds with the burn flag on: both sides winner takes the burn, each end naming the other (pair-winner)", async (t) => {
    const was = process.env.BURNTICKER_BURN_REAL_ENABLED; process.env.BURNTICKER_BURN_REAL_ENABLED = "1";
    t.after(() => { if (was === undefined) delete process.env.BURNTICKER_BURN_REAL_ENABLED; else process.env.BURNTICKER_BURN_REAL_ENABLED = was; });
    const w = await makeWorld();
    const r = await prepareLaunch(w.p, { creator: CREATOR, ticker: "PHIGX", name: "76ers Game X", description: "", firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true }, rule: gamePairRule("nba", "0022500001", "PHI"), pair: { ticker: "BOSGX", name: "Celtics Game X", opp: "BOS" } }, { register: false });
    assert.ok("pair" in r, JSON.stringify("error" in r ? r.error.body : r).slice(0, 400)); if (!("pair" in r)) return;
    const ra = lockRule(JSON.parse(r.pair.bundles.a.rules.text)).rule, rb = lockRule(JSON.parse(r.pair.bundles.b.rules.text)).rule;
    for (const x of [ra, rb]) { assert.equal(x.pair?.winnerTakesBurn, true); assert.equal(endSinkOf(x), "pair-winner"); assert.equal(x.burnTarget, undefined); }
  });
});

describe("HB-4: change cases only on a rule that measures change", () => {
  test("earthquake counts (and the fade side, $QUIETM6) list neither 85 nor 111; the debt lists both", () => {
    const quake = rule("usgs.quakes:6"), quiet = { ...rule("usgs.quakes:6"), inverse: true } as BurnRule;
    for (const r of [quake, quiet]) { assert.deepEqual(changeRuleEdgeIds(r), [87]); assert.equal(isMovingBaselineChangeRule(r), false); }
    assert.deepEqual(changeRuleEdgeIds(debt()), [85, 111, 87]);
    assert.deepEqual(changeRuleEdgeIds(BRONCOS as unknown as BurnRule), []);
    assert.match(edgeCase(85)!, /measures change/); assert.match(edgeCase(111)!, /An up rule counts rises/);
    assert.match(page, /\.\.\.changeRuleEdgeIds\(rule\),/);
    assert.doesNotMatch(page, /rule\.kind === "scalar" \? \[85, 111, 87\]/);
  });
});

describe("HB-5: the 'Once' card and the share row agree", () => {
  test("without dispersal: 100% only, and the card says only the whole pool; with dispersal: 100 or 50%, and the card says half too", () => {
    const r = quakeNext(1);
    const card = (d: boolean) => hazardPatternOptions(r, NOW, { dispersal: d }).options.find((o) => o.id === "once")!.sentence;
    assert.deepEqual([...sharePresetsForRule(r, { dispersal: false })], [1]);
    assert.equal(card(false), HAZARD_PATTERNS.once.sentence);
    assert.doesNotMatch(card(false), /half/);
    assert.deepEqual([...sharePresetsForRule(r, { dispersal: true })], [1, 0.5]);
    assert.equal(card(true), HAZARD_ONCE_HALF_SENTENCE);
    assert.equal(hazardOnceSentence(true), HAZARD_ONCE_HALF_SENTENCE);
    clean(HAZARD_PATTERNS.once.sentence); clean(HAZARD_ONCE_HALF_SENTENCE);
  });
  test("the catalogue carries the host's dispersal decision to the page (fail closed when absent)", () => {
    assert.equal(siteLaunchStateFromCatalogue({ cluster: "mainnet", launches: catalogueLaunches(R5, Date.now(), { dispersal: true }) }).dispersal.available, true);
    assert.equal(siteLaunchStateFromCatalogue({ cluster: "mainnet", launches: catalogueLaunches(R5, Date.now()) }).dispersal.available, false);
    assert.equal(siteLaunchState(R5).dispersal.available, false);
    assert.match(page, /sharePresetsForRule\(rule, \{ linked: linkedPair, dispersal: site\.dispersal\.available \}\)/);
    assert.match(readFileSync("src/app/api/burnticker/catalogue/route.ts", "utf8"), /catalogueLaunches\(process[.]env, Date\.now\(\), \{ dispersal: dispersalForCatalogue\(\) \}\)/);
  });
});

describe("HB-8, HB-10, HB-7: the step-1 names, the disaster heading, the reserved ticker said once", () => {
  test("HB-8: 'Other patterns, not offered here' names Coin comparison or Rivalry, both real step-1 choices", () => {
    assert.equal(PATTERN_REASON.needsTwo, "Winner takes the burn needs two linked coins. Pick Coin comparison or Rivalry in step 1.");
    for (const l of ["Coin comparison", "Rivalry"]) assert.ok(FOLLOW_CHOICES.some((f) => f.label === l), l);
    clean(PATTERN_REASON.needsTwo);
  });
  test("HB-10: disaster suggestion cards have their own heading", () => {
    assert.match(page, /feeds: "Public data", disasters: "Natural disaster", markets: "Markets"/);
  });
  test("HB-7: the ticker box drops the reserved line when the field already says it", () => {
    assert.equal(RESERVED_TICKER_LINE, RESERVED_TICKER_REFUSAL);
    assert.equal((page.match(/t\.reserved && coinsForName\[t\.side === "A" \? 0 : 1\]\?\.tickerIssue === RESERVED_TICKER_LINE \? \{ \.\.\.t, reserved: false \} : t/g) ?? []).length, 2);
  });
});

describe("PROD-03: two independent rivalry coins, the same end choices and an end line each", () => {
  const sp = seasonPairRules("nfl", "DEN", "KC", 2026);
  // the page adds the default end to each coin (ON_END_DEFAULT: the rest goes to $DEFICIT), as the review does
  const den = { ...sp.a, onEnd: { ...ON_END_DEFAULT } } as BurnRule, kc = { ...sp.b, onEnd: { ...ON_END_DEFAULT } } as BurnRule;
  const site = { burnSol: true, sinkPicker: false };
  test("endChoicesFor: the same for either side (swapped too); a coin with a pair clause never offers the incinerator", () => {
    assert.deepEqual(endChoicesFor(den, site), endChoicesFor(kc, site));
    assert.deepEqual(endChoicesFor(den, site), { burnSol: true, sinkPicker: false });
    assert.equal(endChoiceModel(den, endChoicesFor(den, site)).options.length, endChoiceModel(kc, endChoicesFor(kc, site)).options.length);
    assert.equal(endChoicesFor({ ...den, pair: { pairId: "p", side: "A", counterpartMint: null } }, site).burnSol, false);
    assert.equal(endChoicesFor(den, { burnSol: false, sinkPicker: false }).burnSol, false);
  });
  test("perCoinEndLines: one line per coin, led by its ticker, for different sinks and swapped sides; one coin unchanged", () => {
    const inc = withEndChoice(kc, { kind: "burn-sol" });
    const sA = endSentences(den).sentences, sB = endSentences(inc).sentences;
    const lines = perCoinEndLines({ ticker: "DENNFLLOSS", sentences: sA }, { ticker: "KCNFLLOSS", sentences: sB });
    assert.equal(lines.length, 2);
    assert.match(lines[0], /^\$DENNFLLOSS: /); assert.match(lines[0], /\$DEFICIT/); assert.doesNotMatch(lines[0], /incinerator/);
    assert.match(lines[1], /^\$KCNFLLOSS: /); assert.match(lines[1], /incinerator/);
    const swapped = perCoinEndLines({ ticker: "KCNFLLOSS", sentences: sB }, { ticker: "DENNFLLOSS", sentences: sA });
    assert.match(swapped[0], /^\$KCNFLLOSS: .*incinerator/); assert.match(swapped[1], /^\$DENNFLLOSS: .*\$DEFICIT/);
    assert.deepEqual(perCoinEndLines({ ticker: "X", sentences: sA }, null), sA);
  });
  test("the review carries each coin's own end, its incinerator rent and step, whichever side picks it; refused for coin B where it is off", () => {
    const incB = withEndChoice(kc, { kind: "burn-sol" }), incA = withEndChoice(den, { kind: "burn-sol" });
    const one = review({ rule: den, ticker: "DENNFLLOSS", name: "Broncos Losses", companion: { ticker: "KCNFLLOSS", name: "Chiefs Losses", rule: incB } }, DEVNET_R5);
    assert.equal(one.end.kind, "flagship"); assert.equal(one.endB?.kind, "incinerator");
    assert.ok(one.costs.lines.some((l) => /pins \$KCNFLLOSS's end to Solana's incinerator/.test(l.label)));
    assert.ok(!one.costs.lines.some((l) => /pins \$DENNFLLOSS's end/.test(l.label)));
    assert.ok(one.transactions.steps.some((s) => /Lock in \$KCNFLLOSS's rule and pin its end to Solana's incinerator/.test(s.label)));
    const two = review({ rule: incA, ticker: "DENNFLLOSS", name: "Broncos Losses", companion: { ticker: "KCNFLLOSS", name: "Chiefs Losses", rule: kc } }, DEVNET_R5);
    assert.equal(two.end.kind, "incinerator"); assert.equal(two.endB?.kind, "flagship");
    assert.ok(two.costs.lines.some((l) => /pins \$DENNFLLOSS's end to Solana's incinerator/.test(l.label)));
    assert.ok(two.transactions.steps.some((s) => /Lock in \$DENNFLLOSS's rule and pin its end to Solana's incinerator/.test(s.label)));
    assert.match(one.endB!.void ?? one.endB!.result, /./, "coin B's void and late-fee words come from its own rule");
    const off = review({ rule: den, ticker: "DENNFLLOSS", name: "Broncos Losses", companion: { ticker: "KCNFLLOSS", name: "Chiefs Losses", rule: incB } }, { ...DEVNET_R5, BURNTICKER_BURN_SOL_ENABLED: "0" });
    assert.ok(off.problems.some((p) => /^Coin B\. .*incinerator/.test(p)), off.problems.join(" | "));
  });
  test("the page: both pickers from endChoicesFor, the end fact one line per coin, the companion carries coin B's own rule", () => {
    assert.match(page, /const choiceA = endPickable && rule \? endChoiceModel\(rule, \{ \.\.\.endChoicesFor\(rule, endSite\), team: teamRef \}\) : null;/);
    assert.match(page, /const choiceB = endPickable && pairOn && ruleB \? endChoiceModel\(ruleB, \{ \.\.\.endChoicesFor\(ruleB, endSite\), team: teamRefB \}\) : null;/);
    assert.match(page, /endLines\.join\(endTextB \? "\\n" : " "\)/);
    assert.match(page, /companion: \{ ticker: tickerB\.toUpperCase\(\), name: nameB, creatorDescription: profileB\.description, rule: ruleB \}/);
    assert.match(page, /const ruleB: BurnRule \| null = useMemo\(\(\) => \(ruleB0 && endPickable \? withEndChoice\(ruleB0, endB\) : ruleB0\)/);
    assert.match(readFileSync("src/app/burnticker/launch/ReviewCard.tsx", "utf8"), /<dd className="whitespace-pre-line /);
  });
});
