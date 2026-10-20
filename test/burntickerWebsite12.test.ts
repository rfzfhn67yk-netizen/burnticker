// website-12 (2026-10-12): the three-audit pass on the launch flow and the pages that explain money. Each block names its audit item.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { universalSearch, readWeatherThreshold, leastReportable, type Suggestion, type FeedLike } from "@/lib/burnticker/search";
import { catalogueSources } from "@/lib/burnticker/api/handlers";
import { lockRule } from "@/lib/burnticker/rules";
import { composeRule, fieldsFromRule, launchBody, DRAFT_DEFAULTS, type DraftPick } from "@/lib/burnticker/launchDraft";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import { ESPN_NOW, espnFixtureClient } from "./burntickerFirstPartyHelpers.ts";
import { CREATOR } from "./burntickerApiHelpers.ts";

const ROOT = path.join(import.meta.dirname, "..");
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
const cfg = loadCopyLintConfig();
export const lintOk = (t: string, label: string) => { const r = lintCopy(t, cfg); assert.ok(r.ok, `${label}: ${r.hits.map((h) => `${h.phrase} (${h.rule})`).join(", ")} in “${t}”`); };
const deps = { venues: { kalshi: false, polymarket: true, feeds: true }, feeds: catalogueSources(ESPN_NOW).sources as unknown as FeedLike[], espn: espnFixtureClient(), polyGet: null, refuse: () => [], kalshiSearch: null, derbyHref: null, nowMs: ESPN_NOW };
/** search → draft fields → composeRule → launchBody → lockRule: the series the program would lock. */
function lockedSeries(c: Suggestion): string {
  const pick: DraftPick = { ...c.pick!, series: c.rule!.series ?? c.pick!.series, source: c.source ? { unit: c.source.unit, baseline: c.source.baseline, direction: c.source.direction } : null };
  const composed = composeRule(pick, fieldsFromRule(c.rule!, DRAFT_DEFAULTS))!;
  return lockRule(launchBody({ creator: CREATOR, ticker: "TEST", name: "Test", description: "", descCtx: {}, note: "", rule: composed }).rule).rule.series!;
}

describe("Codex F2: the weather threshold lattice (search.ts readWeatherThreshold)", () => {
  test("the least reportable reading: strictly above x is floor(x) + 1 whole degrees; at least x is ceil(x); rain in integer hundredths", () => {
    assert.equal(leastReportable(90.5, 1, true), 91);
    assert.equal(leastReportable(90, 1, true), 91);
    assert.equal(leastReportable(90.2, 1, false), 91);
    assert.equal(leastReportable(90, 1, false), 90);
    assert.equal(leastReportable(0.5, 100, true), 0.51);
    assert.equal(leastReportable(0.505, 100, true), 0.51);
    assert.equal(leastReportable(0.29, 100, true), 0.3);
    assert.equal(leastReportable(0.291, 100, false), 0.3);
    assert.equal(leastReportable(0.29, 100, false), 0.29);
  });
  test("'Detroit high above 90.5' is 91 °F, not 92 (the reproduction); 'above 90' stays 91; 'at least 90.5' is 91", () => {
    assert.equal(readWeatherThreshold("Detroit high above 90.5", "high").threshold, 91);
    assert.equal(readWeatherThreshold("Detroit high above 90", "high").threshold, 91);
    assert.equal(readWeatherThreshold("Detroit high at least 90.5", "high").threshold, 91);
    assert.equal(readWeatherThreshold("Detroit high reaches 90", "high").threshold, 90);
    assert.equal(readWeatherThreshold("Denver rain over 0.505", "rain").threshold, 0.51);
    assert.equal(readWeatherThreshold("Denver rain over 0.29", "rain").threshold, 0.3);
  });
  test("search → draft → compose → lockRule locks the same threshold the card states", async () => {
    for (const [q, want] of [["Detroit high above 90.5", "nws.high:DTW-91"], ["Detroit high above 90", "nws.high:DTW-91"], ["Detroit high at least 90.5", "nws.high:DTW-91"], ["Detroit high reaches 90", "nws.high:DTW-90"]] as const) {
      const r = await universalSearch(q, deps);
      const c = r.cards.find((x) => x.venue === "nws");
      assert.ok(c, q);
      assert.equal(c.rule?.series, want, q);
      assert.equal(lockedSeries(c), want, `${q}: the locked rule`);
      assert.match(c.title, new RegExp(`${want.split("-").pop()} °F or hotter`), q);
    }
  });
});

import { catalogueLaunches, siteLaunchState, siteLaunchStateFromCatalogue, hostedSigningFor, SITE_LAUNCH_STATE_LOADING, SITE_SENTENCE, SITE_HEADLINE, SIGNING_UNAVAILABLE, PAIRS_UNAVAILABLE_LINE, PAIRS_BLOCKER, HOSTED_LAUNCHLAB_ADAPTER, HOSTED_BUILDER_ALLOWS_MAINNET, STALE_AFTER_MS, WALLET_NOTE, CREATOR_LAUNCHES_PREVIEW_FLAG, PREVIEW_BANNER, type SiteLaunchState } from "@/lib/burnticker/launchAvailability";
import { CREATOR_LAUNCHES_FLAG, CREATOR_LAUNCHES_CLOSED } from "@/lib/burnticker/creatorLaunches";
import { LOOKUP_TABLES } from "@/lib/burnticker/networks";

const MAIN = { BURNTICKER_CLUSTER: "mainnet", BURNTICKER_THESPORTSDB_KEY: "k" };
const viaCatalogue = (env: Record<string, string>, now = Date.now()) => siteLaunchStateFromCatalogue({ cluster: env.BURNTICKER_CLUSTER ?? "devnet", launches: catalogueLaunches(env, now) }, { now });
const noContradiction = (s: SiteLaunchState, label: string) => {
  for (const t of [s.sentence, s.signingSentence ?? "", s.walletNote, s.meta.description, s.pairs.line ?? "", s.pairs.detail ?? ""]) if (t) lintOk(t, label);
  assert.ok(!(/\bopen\b/i.test(s.sentence) && /\bclosed\b/i.test(s.sentence)), `${label}: one sentence says one thing`);
  assert.ok(s.meta.description.startsWith(SITE_HEADLINE), label);
  if (!s.canSign) assert.ok(s.signingSentence, `${label}: a launch button that cannot sign says why`);
};

describe("ChatGPT A1 / Claude 1: one typed launch-state record (siteLaunchState), six states", () => {
  test("1. preview open, public creation closed: the wizard renders, nothing signs, the sentence is the preview banner", () => {
    for (const s of [siteLaunchState({ ...MAIN, [CREATOR_LAUNCHES_PREVIEW_FLAG]: "1" }), viaCatalogue({ ...MAIN, [CREATOR_LAUNCHES_PREVIEW_FLAG]: "1" })]) {
      assert.deepEqual([s.read, s.mode, s.wizard, s.canSign, s.sentence], ["ready", "preview", true, false, PREVIEW_BANNER]);
      noContradiction(s, "preview");
    }
  });
  test("2. public creation open: today the hosted signing cannot complete, so the button stays off and says so; with signing wired, it can sign", () => {
    for (const s of [siteLaunchState({ ...MAIN, [CREATOR_LAUNCHES_FLAG]: "1" }), viaCatalogue({ ...MAIN, [CREATOR_LAUNCHES_FLAG]: "1" })]) {
      assert.deepEqual([s.mode, s.wizard, s.canSign, s.sentence, s.signingSentence], ["open", true, false, SITE_SENTENCE.reviewOnly, SIGNING_UNAVAILABLE]);
      // the blockers are the host's live wiring (launch-10): on this bare mainnet fixture the owner's allowance is among them (the mainnet lookup table is pinned in networks.ts since 2026-10-13, so it is no longer a blocker)
      assert.ok(s.hostedSigning.blockers.length >= 1 && s.hostedSigning.blockers.some((b) => /mainnet yet/.test(b)) && !s.hostedSigning.blockers.some((b) => /lookup table/.test(b)), s.hostedSigning.blockers.join(" | "));
      noContradiction(s, "open, review only");
    }
    const wired = siteLaunchStateFromCatalogue({ cluster: "mainnet", launches: { ...catalogueLaunches({ ...MAIN, [CREATOR_LAUNCHES_FLAG]: "1" }), hostedSigning: { complete: true, blockers: [] } } });
    assert.deepEqual([wired.canSign, wired.sentence, wired.signingSentence], [true, SITE_SENTENCE.open, null]);
    noContradiction(wired, "open, signable");
    const closed = siteLaunchState(MAIN);
    assert.deepEqual([closed.mode, closed.wizard, closed.canSign, closed.sentence], ["closed", false, false, CREATOR_LAUNCHES_CLOSED]);
    noContradiction(closed, "closed");
  });
  test("3. pairs disabled: one line beside every pair option, the blocker in its details; Coin vs Coin and registered pairs are unavailable", () => {
    const s = siteLaunchState({ ...MAIN, [CREATOR_LAUNCHES_FLAG]: "1" });
    assert.deepEqual([s.pairs.available, s.pairs.line, s.pairs.detail], [false, PAIRS_UNAVAILABLE_LINE, PAIRS_BLOCKER]);
    assert.equal(s.types.derby.available, false); assert.equal(s.types.pairs.available, false);
    const on = siteLaunchState({ ...MAIN, [CREATOR_LAUNCHES_FLAG]: "1", BURNTICKER_PAIR_CURVE_ENABLED: "1" });
    assert.deepEqual([on.pairs.available, on.pairs.line], [true, null]);
    noContradiction(s, "pairs off");
  });
  test("4. a missing source: sports without the licence key and markets with discovery off are unavailable with a reason", () => {
    const s = siteLaunchState({ BURNTICKER_CLUSTER: "mainnet", [CREATOR_LAUNCHES_FLAG]: "1", BURNTICKER_POLYMARKET_DISCOVERY_ENABLED: "0" });
    assert.equal(s.types.team.available, false); assert.ok(s.types.team.reason);
    assert.equal(s.types.markets.available, false); assert.ok(s.types.markets.reason);
    assert.equal(s.types.weather.available, true);
    noContradiction(s, "missing source");
  });
  test("5. unavailable status (the catalogue failed or was not JSON) and loading: no launch controls, the sentence says why", () => {
    for (const s of [siteLaunchStateFromCatalogue(null, { failure: "HTTP 502" }), siteLaunchStateFromCatalogue("not json")]) {
      assert.deepEqual([s.read, s.mode, s.wizard, s.canSign, s.sentence], ["unavailable", "closed", false, false, SITE_SENTENCE.unavailable]);
      noContradiction(s, "unavailable");
    }
    assert.deepEqual([SITE_LAUNCH_STATE_LOADING.read, SITE_LAUNCH_STATE_LOADING.wizard, SITE_LAUNCH_STATE_LOADING.sentence], ["loading", false, SITE_SENTENCE.loading]);
  });
  test("6. stale status: a reading older than STALE_AFTER_MS turns every control off until the page reads it again", () => {
    const at = Date.parse("2026-10-12T18:00:00Z");
    const body = { cluster: "mainnet", launches: catalogueLaunches({ ...MAIN, [CREATOR_LAUNCHES_FLAG]: "1" }, at) };
    assert.equal(siteLaunchStateFromCatalogue(body, { now: at + STALE_AFTER_MS - 1 }).read, "ready");
    const s = siteLaunchStateFromCatalogue(body, { now: at + STALE_AFTER_MS + 1 });
    assert.deepEqual([s.read, s.wizard, s.canSign, s.sentence], ["stale", false, false, SITE_SENTENCE.stale]);
    noContradiction(s, "stale");
    // an older catalogue without the new fields cannot sign (fail closed)
    const old = siteLaunchStateFromCatalogue({ cluster: "mainnet", launches: { creators: true, mode: "open" } });
    assert.equal(old.canSign, false); assert.equal(old.hostedSigning.complete, false);
  });
  test("A11: the wallet line is about connecting only, and it gates Your coins", () => {
    assert.match(WALLET_NOTE, /Your coins/); assert.match(WALLET_NOTE, /Nothing is signed when you connect/); lintOk(WALLET_NOTE, "wallet note");
  });
});

describe("the hosted-signing facts are read from the source they describe (code review 5, 'What actually protects')", () => {
  test("launch-10 (2026-10-12): server.ts selects the LaunchLab client from env; prepareLaunch passes allowMainnet; signing is a live host question", () => {
    const server = read("src/lib/burnticker/server.ts"), handlers = read("src/lib/burnticker/api/handlers.ts");
    assert.equal(/const launchLab = new FakeLaunchLab\(/.test(server), HOSTED_LAUNCHLAB_ADAPTER === "stand-in", "the unconditional stand-in is gone when the adapter is 'real'");
    assert.ok(/launchLabFromEnv/.test(server), "server.ts picks the client from env");
    const prep = handlers.slice(handlers.indexOf("export async function prepareLaunch"), handlers.indexOf("\nexport ", handlers.indexOf("export async function prepareLaunch") + 10));
    assert.equal(/allowMainnet/.test(prep), HOSTED_BUILDER_ALLOWS_MAINNET, "HOSTED_BUILDER_ALLOWS_MAINNET matches prepareLaunch");
    // with nothing wired in env, signing cannot complete on either network and the lookup-table blocker names the network
    const bare = { BURNTICKER_CLUSTER: "mainnet" } as Record<string, string>;
    assert.equal(hostedSigningFor("mainnet", bare).complete, false);
    assert.equal(hostedSigningFor("mainnet", bare).blockers.some((b) => /lookup table/.test(b)), !LOOKUP_TABLES.mainnet.address);
    assert.ok(hostedSigningFor("mainnet", bare).blockers.some((b) => /mainnet yet/.test(b)), "mainnet is refused without the owner's allowance");
    for (const b of [...hostedSigningFor("mainnet").blockers, ...hostedSigningFor("devnet").blockers]) lintOk(b, "blocker");
  });
});

import { buildLaunchReview, PAIR_CURVE_FEES, prerequisiteLineFor, budgetLine } from "@/lib/burnticker/launchReview";
import { FakeBurnProgram } from "@/lib/burnticker/program";
import { buildPairBundles, FakeLaunchLab, LAUNCHLAB_RAISE_LAMPORTS } from "@/lib/burnticker/launchBundle";
import { buildPairCurveLaunch } from "@/lib/burnticker/pairCurveLaunch";
import { feeSplit } from "@/lib/pairCurve/pricing";
import { BRONCOS } from "./burntickerHelpers.ts";

describe("Codex F1: the pre-wallet review comes from the venue the bundle route builds (review versus builder)", () => {
  const RULE = { ...BRONCOS, binary: { onYes: null, onNo: { fractionOfPool: 0.02 } }, pair: null };
  const PC_ENV = { BURNTICKER_CLUSTER: "devnet", [CREATOR_LAUNCHES_FLAG]: "1", BURNTICKER_PAIR_CURVE_ENABLED: "1" };
  test("a registered pair on the pair curve: three transactions with the builder's signers, 25 and 75 bps on the curve, the pair's prerequisites", async () => {
    const r = buildLaunchReview({ rule: RULE, ticker: "BRONCOS", name: "Broncos", pair: { ticker: "CHIEFS", name: "Chiefs" } }, { env: PC_ENV });
    assert.ok("review" in r); const v = r.review;
    const program = new FakeBurnProgram("devnet");
    const pr = await buildPairBundles({ a: { creator: CREATOR, ticker: "BRONCOS", name: "Broncos", description: "x", imageUrl: null, links: [], rule: RULE, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true }, cluster: "devnet" as const }, b: { ticker: "CHIEFS", name: "Chiefs", description: "y", imageUrl: null, links: [] } }, { program, launchLab: new FakeLaunchLab(), devFeeWallet: null, attesters: ["KeeperDataKey1111111111111111111111111111111"], quorum: 1, metadataUri: (m) => `https://x/${m}.json` });
    const built = await buildPairCurveLaunch(pr, CREATOR, { cluster: "devnet", burnReceiptsProgramId: program.programId, now: 1_800_000_000 });
    assert.equal(v.venue, "pair-curve");
    assert.equal(v.transactions.count, built.transactions.length, "the review counts the builder's transactions");
    const signerWords = (s: string) => (s === "creator" ? "your wallet" : "a new key made for this coin");
    assert.deepEqual(v.transactions.steps.map((s) => s.signers), built.transactions.map((t) => t.signers.map(signerWords)), "each step's signers are the builder's");
    const split = feeSplit(BigInt(1_000_000_000));   // 1 SOL on the curve, the program's own arithmetic
    const curve = v.feesPerSol.find((f) => f.phase === "curve")!;
    assert.equal(Number(curve.totalSol) * 1e9, Number(split.fee));
    assert.deepEqual(curve.legs.map((l) => Number(l.sol) * 1e9), [Number(split.dev), Number(split.burn)], "25 bps to the developer, 75 bps to the burn pool");
    assert.equal(PAIR_CURVE_FEES.curve.legs[0].bps, 25); assert.equal(PAIR_CURVE_FEES.curve.legs[1].bps, 75);
    assert.equal(v.prerequisiteLine, prerequisiteLineFor("pair-curve")); assert.match(v.prerequisiteLine, /shared curve must raise 85 SOL/);
    assert.equal(built.params.targetRaiseLamports, "85000000000");
    assert.ok(v.recovery.some((x) => /reject a later request/.test(x)) && v.recovery.some((x) => /finish every step/.test(x)));
    for (const t of [...v.recovery, v.prerequisiteLine, v.costs.note, ...v.costs.lines.map((l) => l.label), ...v.transactions.steps.map((s) => s.label)]) lintOk(t, "pair-curve review");
  });
  test("the same pair with the pair curve off is four LaunchLab transactions (each coin locks its rule, then is created), and a mainnet host refuses it as unavailable; a single coin is two (2026-10-15)", () => {
    const off = buildLaunchReview({ rule: RULE, ticker: "BRONCOS", name: "Broncos", pair: { ticker: "CHIEFS", name: "Chiefs" } }, { env: { BURNTICKER_CLUSTER: "devnet", [CREATOR_LAUNCHES_FLAG]: "1" } });
    assert.ok("review" in off); assert.deepEqual([off.review.venue, off.review.transactions.count], ["launchlab", 4]);   // 2026-10-14, Phantom review ticket 438485
    const main = buildLaunchReview({ rule: RULE, ticker: "BRONCOS", name: "Broncos", companion: { ticker: "CHIEFS", name: "Chiefs" } }, { env: { BURNTICKER_CLUSTER: "mainnet", BURNTICKER_THESPORTSDB_KEY: "k", [CREATOR_LAUNCHES_FLAG]: "1" } });
    assert.ok("review" in main); assert.equal(main.review.typeAvailable, false, "a two-coin Matchup is a pair path"); assert.match(main.review.typeReason!, /^Paired launches are not available yet\./);
    assert.equal(main.review.signable, false); assert.equal(main.review.signing, main.review.typeReason);
    const one = buildLaunchReview({ rule: RULE, ticker: "BRONCOS", name: "Broncos" }, { env: { BURNTICKER_CLUSTER: "mainnet", BURNTICKER_THESPORTSDB_KEY: "k", [CREATOR_LAUNCHES_FLAG]: "1" } });
    assert.ok("review" in one); assert.equal(one.review.transactions.count, 2); assert.equal(one.review.recovery.length, 4); assert.match(one.review.recovery[0], /asks 3 times in all/);   /* hourly run 7, HB-92: the proof counted */
    // website-14 (§75): no raise named = the default preset, LaunchLab's standard 85 SOL; the line names the coin's own raise
    assert.equal(one.review.prerequisiteLine, prerequisiteLineFor("launchlab", "85")); assert.match(one.review.prerequisiteLine, new RegExp(`raise ${Number(LAUNCHLAB_RAISE_LAMPORTS) / 1e9} SOL`));
    assert.equal(one.review.signing, SIGNING_UNAVAILABLE, "today no launch can be signed here, and the review says so");
    assert.equal(one.review.budget, budgetLine("2%")); assert.match(one.review.budget, /burn budget/); assert.match(one.review.budget, /number of tokens burned varies/);
  });
  test("A9: governance beside the review comes from the status record and the time lock read from chain", () => {
    const g = (tl: number | null) => { const r = buildLaunchReview({ rule: RULE, ticker: "BRONCOS", name: "Broncos" }, { env: { BURNTICKER_CLUSTER: "mainnet", [CREATOR_LAUNCHES_FLAG]: "1" }, timeLockSecs: tl }); assert.ok("review" in r); return r.review.governance; };
    assert.deepEqual(g(0), ["One signer, run by the operator, signs every reading.", "The operator controls two of the three upgrade keys, so it can approve a program upgrade alone.", "An approved upgrade has no waiting period today, so it can run at once."]);
    assert.match(g(172_800)[2], /waits 48 h/);
    assert.match(g(null)[2], /could not be read just now/);
    for (const x of [...g(0), ...g(null)]) lintOk(x, "governance");
  });
});

import { draftRevision, EMPTY_REVIEW_SLOT, reviewAnswered, reviewFor, reviewMatchesDraft, reviewRequested, REVIEW_UPDATING, type ReviewSlot } from "@/lib/burnticker/launchReviewSync";

describe("ChatGPT A6: the pre-wallet summary is keyed by the draft revision", () => {
  const lakers = draftRevision([{ series: "espn.team:nba-LAL" }, "LAKERS26", "Lakers 26", 0.02]);
  const detroit = draftRevision([{ series: "nws.high:DTW-91" }, "DTWHOT", "Detroit Heat", 0.02]);
  test("a revision changes with the rate, the ticker and the source, and not with key order", () => {
    assert.notEqual(draftRevision([{ series: "nws.high:DTW-91" }, "DTWHOT", "Detroit Heat", 0.05]), detroit, "rate");
    assert.notEqual(draftRevision([{ series: "nws.high:DTW-91" }, "DTWHEAT", "Detroit Heat", 0.02]), detroit, "ticker");
    assert.notEqual(draftRevision([{ series: "nws.high:DEN-91" }, "DTWHOT", "Detroit Heat", 0.02]), detroit, "source");
    assert.equal(draftRevision({ a: 1, b: { c: 2, d: 3 } }), draftRevision({ b: { d: 3, c: 2 }, a: 1 }));
  });
  test("Back then a new search: the old summary is hidden at once, a late answer for it is dropped, and the button waits", () => {
    let slot: ReviewSlot<string> = reviewRequested(EMPTY_REVIEW_SLOT, lakers, 1);
    slot = reviewAnswered(slot, lakers, { rev: lakers, seq: 1, review: "Create LAKERS26" });
    assert.equal(reviewFor(slot, lakers).review, "Create LAKERS26"); assert.equal(reviewMatchesDraft(slot, lakers), true);
    // the draft changes (Back, a new search, the weather card): before any new request, the Lakers summary is not shown
    assert.deepEqual(reviewFor(slot, detroit), { review: null, loading: true, error: null });
    assert.equal(reviewMatchesDraft(slot, detroit), false);
    slot = reviewRequested(slot, detroit, 2);
    // a delayed Lakers answer (seq 1) arrives after the Detroit request: dropped
    slot = reviewAnswered(slot, detroit, { rev: lakers, seq: 1, review: "Create LAKERS26" });
    assert.equal(reviewFor(slot, detroit).review, null); assert.equal(reviewMatchesDraft(slot, detroit), false);
    slot = reviewAnswered(slot, detroit, { rev: detroit, seq: 2, review: "Create DTWHOT" });
    assert.equal(reviewFor(slot, detroit).review, "Create DTWHOT"); assert.equal(reviewMatchesDraft(slot, detroit), true);
  });
  test("out of order within one draft: an older request's answer never replaces the newer one; an answer for a draft that moved on is dropped", () => {
    let slot: ReviewSlot<string> = reviewRequested(EMPTY_REVIEW_SLOT, detroit, 5);
    const at5 = detroit, at6 = draftRevision([{ series: "nws.high:DTW-91" }, "DTWHOT", "Detroit Heat", 0.05]);
    slot = reviewRequested(slot, at6, 6);
    slot = reviewAnswered(slot, at6, { rev: at5, seq: 5, review: "2%" });
    assert.equal(reviewFor(slot, at6).review, null);
    slot = reviewAnswered(slot, at5, { rev: at6, seq: 6, review: "5%" });   // the creator went back to 2% before the 5% answer landed
    assert.equal(reviewMatchesDraft(slot, at5), false);
    lintOk(REVIEW_UPDATING, "updating line");
  });
});

import { independentPairFacts, winnerTakesBurnFacts, pairFactLines, PAIR_BURN_SENTENCE } from "@/lib/burnticker/describe";
import { WIND_DOWN_LINE } from "@/lib/burnticker/launchReview";

describe("ChatGPT A2 / Claude 4: every pair entry path is off together, with one line", () => {
  const page = read("src/app/burnticker/launch/page.tsx"), tile = read("src/app/burnticker/launch/CoinVsCoinTile.tsx"), card = read("src/app/burnticker/launch/ReviewCard.tsx");
  test("no top box of unavailable kinds; the Matchup and Coin vs Coin tiles grey out in place with the one line and the blocker in details", () => {
    assert.doesNotMatch(page, /Some kinds of coin cannot be launched/);
    assert.match(page, /const pairsBlocked: string \| null = site\.read === "ready" && !site\.pairs\.available \? site\.pairs\.line : null;/);
    // website-22 (QA 9 item 39): the older tiles are gone; the rivalry step greys out its two-team choice with the same line
    assert.match(page, /teamsBlocked=\{pairsBlocked \?\? typeBlocked\("matchup"\)\}/, "Matchup (two teams)");
    assert.match(page, /unavailable=\{pairsBlocked \?\? typeBlocked\("derby"\)\}/, "Coin vs Coin tile");
    assert.match(tile, /if \(unavailable\) \{ setOpen\(false\); return; \}/, "?derby=1 and the Coin vs Coin templates do not open it");
    assert.match(tile, /if \(!open \|\| unavailable\) return tile;/);
  });
  test("search, exact markets, restored sessions, ?pair=1, the matchup template and direct links all stop at the same line", () => {
    assert.match(page, /\(c\.matchup \|\| c\.venue === "tile" \? pairsBlocked : null\)/, "search: the matchup card and the Coin vs Coin card");
    assert.match(page, /e\.pair && \(pairsBlocked \?/, "exact market: no 'Make a matchup pair'");
    assert.match(page, /if \(site\.read === "ready" && !site\.pairs\.available && flow === "pair" && step !== "choose"\) \{ setFlow\("team"\); setStep\("choose"\);/, "any pair flow (storage, ?pair=1, template, like) returns to the first screen");
    assert.match(page, /walletBlocked\(pairOn \? "matchup" : launchTypeOf\(rule\), pairOn\)/, "the review's button");
  });
  test("A11: connecting and launching are two steps; no 'Open wallet and launch'", () => {
    assert.doesNotMatch(card, /Open wallet and launch/);
    assert.match(card, /: "Connect wallet";/);
    assert.doesNotMatch(card, /pending\.current = true/, "connecting never launches by itself");
  });
});

describe("ChatGPT A3: pair economics in one voice", () => {
  test("winner takes the burn: which outcome, which token burns, whose pool pays, whether SOL moves, with real tickers", () => {
    const f = winnerTakesBurnFacts("CHIEFS", "BRONCOS");
    assert.match(f.trigger, /coin whose rule fires/); assert.match(f.burned, /loser's supply is untouched/);
    assert.match(f.pays, /would have spent if it had won/); assert.match(f.moves, /moves to the winner's burn pool/); assert.match(f.moves, /draw or a void moves nothing/);
    assert.match(f.example, /\$CHIEFS/); assert.match(f.example, /\$BRONCOS's share for that result moves to \$CHIEFS's burn pool/);
    assert.match(PAIR_BURN_SENTENCE, /Winner takes the burn/);
    for (const x of pairFactLines(f)) lintOk(x, "winner takes the burn");
  });
  test("a Matchup of two separate launches: each burns itself from its own pool and nothing moves; the wind-down line no longer contradicts a pair", () => {
    const f = independentPairFacts("LAKERS", "CELTICS", { a: "the Lakers", b: "the Celtics" });
    assert.match(f.moves, /No SOL moves between the two coins/); assert.match(f.example, /if the Lakers lose, \$LAKERS spends/);
    for (const x of pairFactLines(f)) lintOk(x, "independent");
    assert.doesNotMatch(WIND_DOWN_LINE, /Nothing is sent to another coin\./); assert.match(WIND_DOWN_LINE, /wind-down only burns this coin/);
    const page = read("src/app/burnticker/launch/page.tsx");
    // website-19 (intent audit item 3): the two-coin facts are read from the two rules (guidedLaunch.ts matchupFacts), fade side included
    assert.match(page, /ruleB \? \(elPick \? candidateFacts\(.*\) : matchupFacts\(\{/);
    assert.match(page, /pairFacts=\{facts\}/);
    assert.match(read("src/app/burnticker/launch/CoinVsCoinTile.tsx"), /pairFacts=\{winnerTakesBurnFacts\(/);
  });
});

describe("A1 / A4 on About, Templates and the launch meta: every open / closed sentence and every prerequisite reads one source", () => {
  test("About: the launch sentence is the record's; the presets are the real 2 / 5 / 10 and 10 / 50 / 100; the prerequisite line is visible; creators get no trading-fee revenue", () => {
    const about = read("src/app/burnticker/about/page.tsx");
    assert.doesNotMatch(about, /between 1% and 10%|Creators earn nothing|Creator launches are closed until/);
    assert.match(about, /\{launch\.sentence\}/); assert.match(about, /const launch = siteLaunchState\(process[.]env\);/);
    assert.match(about, /SHARE_PRESETS\.recurring\.map\(pctLabel\)/); assert.match(about, /\{prerequisiteLineFor\("launchlab"\)\}/);
    assert.match(about, /Creators receive no trading-fee revenue/);
    assert.doesNotMatch(about, /nobody receives anything for it|NO_WALLET_LINE/, "Claude 3: the disclaimer repeats are gone");
  });
  test("Templates: the record decides the Start links and the pair templates grey out with the one line", () => {
    const t = read("src/app/burnticker/templates/page.tsx");
    assert.match(t, /const site = siteLaunchState\(process[.]env\);/); assert.doesNotMatch(t, /closedLine|launchAvailability\(/);
    // HB-151 (hourly run 13): the card state moved to templateCard.ts (one place decides the reason and the link)
    assert.match(t, /templateCardState\(t, site, /);
    assert.match(read("src/lib/burnticker/templateCard.ts"), /isPairTemplate\(t\) && !site\.pairs\.available \? site\.pairs\.line/);
  });
  test("the launch page's description and preview follow the record (closed, review only, open)", () => {
    // prelaunch audit 2026-10-16 F-12: the description names no launch state (statically built pages bake it in); the page says it live
    const closed = siteLaunchState({ BURNTICKER_CLUSTER: "mainnet" }).meta.description, open = siteLaunchState({ BURNTICKER_CLUSTER: "mainnet", [CREATOR_LAUNCHES_FLAG]: "1" }).meta.description;
    assert.equal(closed, open); assert.doesNotMatch(closed, /not open|cannot be signed/);
    assert.doesNotMatch(read("src/app/burnticker/launch/layout.tsx"), /closed before launch/);
  });
});

import { GUARDRAILS, GUARDRAIL_DETAIL, WHO_GETS_WHAT, SAFEGUARDS } from "@/lib/burnticker/safeguards";

describe("A9 on Trust: each guardrail names its kind and its scope", () => {
  test("every guardrail has a kind and a full sentence; AI reviews are called AI reviews; policies are not shown as enforced", () => {
    for (const g of GUARDRAILS) { const d = GUARDRAIL_DETAIL[g]; assert.ok(d && d.text.length > 20, g); lintOk(d.text, g); }
    assert.equal(GUARDRAIL_DETAIL["the platform buys no coin except one test coin"].kind, "policy");
    assert.match(GUARDRAIL_DETAIL["the platform buys no coin except one test coin"].text, /separate from each coin's program-run buyback/);
    assert.match(GUARDRAIL_DETAIL["three blind AI reviews, not a firm audit"].text, /These are AI reviews\. They are not a professional security audit/);
    assert.match(GUARDRAIL_DETAIL["creators earn nothing"].text, /^Creators receive no trading-fee revenue\./);
    assert.match(GUARDRAIL_DETAIL["rules locked at launch"].text, /current program/); assert.match(GUARDRAIL_DETAIL["rules locked at launch"].text, /can still be upgraded/);
    assert.match(SAFEGUARDS.find((s) => s.id === "holders")!.text, /^No instruction in the current program can/);
    assert.doesNotMatch(WHO_GETS_WHAT.map((w) => w.text).join(" "), /little trading means a small burn/);
    assert.match(read("src/app/burnticker/trust/SafeguardsSection.tsx"), /data-guardrail-kind=\{k\}/);
    assert.doesNotMatch(read("src/app/burnticker/trust/SafeguardsSection.tsx"), /✓ \{g\}/);
  });
});

import { curveProgressSentence, dataStateSentence, DATA_STATES } from "@/lib/burnticker/readiness";

describe("ChatGPT A5: loading, empty, unavailable, stale and error are five different sentences", () => {
  test("curve progress: unavailable never says 'no coin'; every state differs and passes the lint", () => {
    const all = DATA_STATES.map((s) => curveProgressSentence(s, { readAt: "2026-10-12T18:00:00Z" }));
    assert.equal(new Set(all).size, 5);
    assert.match(curveProgressSentence("unavailable"), /^Curve progress is unavailable/); assert.doesNotMatch(curveProgressSentence("unavailable"), /No coin/);
    assert.match(curveProgressSentence("empty"), /^No coin is past half its curve/);
    assert.match(curveProgressSentence("stale", { readAt: "2026-10-12T18:00:00Z" }), /Oct 12, \d{1,2}:00 [AP]M \S+ and may be out of date/);   // HS-25: the visitor's zone, named
    for (const x of [...all, ...DATA_STATES.map((s) => dataStateSentence(s, "the burn history"))]) lintOk(x, "data state");
  });
});

import crypto from "node:crypto";
import { renderWhitepaper, ARCHIVE_MD, ARCHIVE_HTML, ARCHIVE_OPTS, ARCHIVE_SHA256, CURRENT_SPEC, WHITEPAPER_MD, WHITEPAPER_HTML } from "../scripts/whitepaper-html.mjs";

describe("ChatGPT A8: a dated current specification and a frozen October 10 archive", () => {
  test("the current paper is dated and names the public commit it describes; its version notice sits above the contents", () => {
    const md = read(WHITEPAPER_MD), html = read(WHITEPAPER_HTML);
    assert.doesNotMatch(md, /Historical version/);
    assert.match(md, new RegExp(`Current specification, dated ${CURRENT_SPEC.date}`)); assert.ok(md.includes(CURRENT_SPEC.publicCommit));
    assert.equal(CURRENT_SPEC.publicCommit, "af52b4a4ea0b80168a4c2e0f47a32045d1035c91");
    assert.ok(html.indexOf("Current specification, dated") < html.indexOf('aria-label="Contents"'), "the notice comes before the contents on every width");
    assert.match(html, /href="https:\/\/burnticker\.com\/whitepaper-2026-10-10\.html"/);
  });
  test("the archive is the 2026-10-10 draft byte for byte, rendered with an archive banner and its own canonical; the copy lint passes it", () => {
    const a = fs.readFileSync(path.join(ROOT, ARCHIVE_MD));
    assert.equal(crypto.createHash("sha256").update(a).digest("hex"), ARCHIVE_SHA256, "the archive's text is never edited");
    const html = read(ARCHIVE_HTML);
    assert.equal(html, renderWhitepaper(a.toString("utf8"), undefined, ARCHIVE_OPTS));
    assert.match(html, /data-archive><p><strong>Archived copy\.<\/strong>/); assert.match(html, /<link rel="canonical" href="https:\/\/burnticker\.com\/whitepaper-2026-10-10\.html">/);
    assert.ok(html.indexOf("Archived copy.") < html.indexOf('aria-label="Contents"'));
    lintOk(a.toString("utf8"), "archive"); lintOk(ARCHIVE_OPTS.banner.replace(/<[^>]+>/g, ""), "archive banner");
  });
});
