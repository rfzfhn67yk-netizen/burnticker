// HOURLY AUDIT 2026-10-19 19:10 DENVER, RUN 7 (docs/burnticker/audits/continuous/2026-10-19-1910-Denver.md; bugs.md HB-72 consistency,
// HB-80 / HS-27 residues, HB-68 residue, HB-91, HB-92 to HB-99; suggestions HS-39 to HS-41). One pure test or source check per fix, plus
// the copy lint on every new public sentence.
import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { lintCopy, loadCopyLintConfig, formatHits } from "@/lib/launch/copyLint";
import { meetingsRefusal, meetingsVerdict, meetingsVerdictFor } from "@/lib/burnticker/meetingsLeft";
import { MEETINGS_NONE_LEFT_LINE, MEETINGS_NONE_LINE, coinVsCardWords, meetingsNoneLeftWarning, pairUpfrontLines, seriesOptionState, upfrontLines, FLIP_CARD_LABEL, RACE_CARD_LABEL, PAIR_CURVE_UPFRONT_FALLBACK } from "@/lib/burnticker/guidedLaunch";
import { meetingsSeries, seasonLabel, seasonYearAt, type Game, type LeagueId } from "@/lib/burnticker/sources/espn";
import { RECEIPT_STILL_CHECKING, resetReceiptCache, v1CheckReceipt } from "@/lib/burnticker/trustpack/api";
import { sampleReceipts } from "@/lib/burnticker/trustpack/samples";
import type { Rpc } from "@/lib/burnticker/trustpack/receiptCheck";
import { walletPromptCount, walletPromptsLine } from "@/lib/burnticker/walletProof";
import { signsLine } from "@/lib/burnticker/mintAddressCopy";
import { hazardSeasonOf, offSeasonBacktestLine, offSeasonLine, outsideSeason } from "@/lib/burnticker/hazardSeason";
import { firstPartyRule } from "@/lib/burnticker/wizard";
import type { BurnRule } from "@/lib/burnticker/rules";
import { popstateFollows, stepAddress, stepHistoryAction, triggerEditPhase } from "@/lib/burnticker/stepHistory";
import { wxThresholdProblem } from "@/lib/burnticker/launchFields";
import { WX_HIGH_MAX_F, WX_HIGH_MIN_F, WX_HIGH_RANGE_LINE } from "@/lib/burnticker/wxBounds";
import { HIGH_RANGE } from "@/lib/burnticker/weatherIntent";
import { highRecords, weatherFrequency } from "@/lib/burnticker/sources/nwsClimate";
import { healthLine, isWaitingReading } from "@/lib/burnticker/queuedReading";
import { checkLine, dayLine, DUE_NOW, OVERDUE_GRACE_MS, CREATOR_PAGE } from "@/lib/burnticker/creatorBenefits";
import { creatorNextFields } from "@/lib/burnticker/creatorServe";
import { decidedCardLine, lastBurnLine, pairDecidedLine } from "@/lib/burnticker/badge";
import { SETTLEMENT_LABEL, upcomingFromStatus } from "@/lib/burnticker/upcoming";
import { PAIR_NO_BURN_YET, pairDecidedRowLine, type CoinListing } from "@/lib/burnticker/coinsList";
import { RAISE_PRESETS_SOL, DEFAULT_SHARE } from "@/lib/burnticker/launchPresets";
import { derbySentence, FLIP_REST_LINE } from "@/lib/burnticker/derby/spec";

const cfg = loadCopyLintConfig();
const clean = (s: string) => { const r = lintCopy(s, cfg); assert.ok(r.ok, `${s}\n${formatHits(r)}`); };
const plain = (s: string) => { clean(s); assert.doesNotMatch(s, /\bwill\b|\bbuy\b|\bprice\b|coming soon|\bpayouts?\b|\btarget\b|\bguarantee|→|\b20\d\d-\d\d-\d\d\b|\w\/\w+\//i, s); };
const read = (p: string) => fs.readFileSync(p, "utf8");
const page = read("src/app/burnticker/launch/page.tsx");

// ---- HB-72 consistency ----------------------------------------------------------------------------------------------------------------

const NOW = Date.parse("2026-10-19T20:00:00Z");
const NFL_YEAR = seasonYearAt("nfl", NOW);
const side = (abbr: string, homeAway: "home" | "away", score: number | null) => ({ abbr, name: abbr, nickname: abbr, score, homeAway, record: null });
let ev = 1000;
function game(o: { league?: LeagueId; home: string; away: string; at: string; final?: [number, number] | null; seasonType?: 2 | 3 }): Game {
  const done = !!o.final;
  return { eventId: String(ev++), league: o.league ?? "nfl", seasonType: o.seasonType ?? 2, seasonYear: NFL_YEAR, startsAt: o.at, date: o.at.slice(0, 10), name: `${o.away} at ${o.home}`, completed: done, state: done ? "post" : "pre", detail: done ? "Final" : "Scheduled", home: side(o.home, "home", done ? o.final![0] : null), away: side(o.away, "away", done ? o.final![1] : null) };
}
const playedDenSea = game({ home: "DEN", away: "SEA", at: "2026-10-15T00:15:00Z", final: [24, 17] });
const regularLeft = [game({ home: "DEN", away: "KC", at: "2026-10-26T20:25:00Z" }), game({ home: "SEA", away: "LAR", at: "2026-10-26T20:05:00Z" })];
const playoffsOnly = (alive: string[]) => alive.map((a, i) => game({ home: a, away: "BUF", at: `2027-01-1${i}T21:00:00Z`, seasonType: 3 }));

describe("HB-72 consistency: one rule for the page, the review and the prepare", () => {
  for (const [a, b] of [["DEN", "SEA"], ["SEA", "DEN"]] as const) {
    test(`${a} vs ${b}: no meeting left, playoffs still possible: offered with the playoff warning`, () => {
      const v = meetingsVerdict({ league: "nfl", abbr: a, opp: b, year: NFL_YEAR, season: [playedDenSea, ...regularLeft], upcoming: regularLeft, now: NOW });
      assert.equal(v.state, "playoffs");
      assert.equal(v.state === "playoffs" && v.warning, meetingsNoneLeftWarning(seasonLabel("nfl", NFL_YEAR), true));
      assert.match(v.state === "playoffs" ? v.warning : "", /burns only if they meet in the playoffs/);
      assert.equal(meetingsRefusal(v), null, "the prepare does not refuse it");
    });
    test(`${a} vs ${b}: no meeting left and one team's season over: greyed and refused with the same line`, () => {
      const other = a === "DEN" ? "SEA" : "DEN";
      // the league lists only playoff games, and team `a` (or `b`) has none of them
      for (const alive of [[other, "KC"], [a, "KC"]]) {
        const v = meetingsVerdict({ league: "nfl", abbr: a, opp: b, year: NFL_YEAR, season: [playedDenSea], upcoming: playoffsOnly(alive), now: NOW });
        assert.deepEqual(v, { state: "none", line: MEETINGS_NONE_LEFT_LINE });
        assert.deepEqual(meetingsRefusal(v), { status: 409, code: "meetings-none-left", message: MEETINGS_NONE_LEFT_LINE });
      }
      // both alive in the playoffs: still possible
      assert.equal(meetingsVerdict({ league: "nfl", abbr: a, opp: b, year: NFL_YEAR, season: [playedDenSea], upcoming: playoffsOnly([a, b]), now: NOW }).state, "playoffs");
    });
  }
  test("an unknown schedule says nothing and refuses nothing", () => {
    const v = meetingsVerdict({ league: "nfl", abbr: "DEN", opp: "SEA", year: NFL_YEAR, season: null, upcoming: null, now: NOW });
    assert.deepEqual(v, { state: "unknown" });
    assert.equal(meetingsRefusal(v), null);
  });
  test("a future game between them: offered, nothing said (the control)", () => {
    const future = game({ home: "SEA", away: "DEN", at: "2026-12-20T21:25:00Z" });
    for (const [a, b] of [["DEN", "SEA"], ["SEA", "DEN"]]) assert.deepEqual(meetingsVerdict({ league: "nfl", abbr: a, opp: b, year: NFL_YEAR, season: [playedDenSea, future], upcoming: null, now: NOW }), { state: "open" });
  });
  test("the fallback when the league read is missing: offered with the warning while the regular season runs, refused after", () => {
    assert.equal(meetingsVerdict({ league: "nfl", abbr: "DEN", opp: "SEA", year: NFL_YEAR, season: [playedDenSea, regularLeft[0]], upcoming: null, now: NOW }).state, "playoffs");
    assert.deepEqual(meetingsVerdict({ league: "nfl", abbr: "DEN", opp: "SEA", year: NFL_YEAR, season: [playedDenSea], upcoming: null, now: NOW }), { state: "none", line: MEETINGS_NONE_LEFT_LINE });
  });
  test("no game between them at all, an earlier season, a league with no playoffs: refused", () => {
    assert.deepEqual(meetingsVerdict({ league: "nfl", abbr: "DEN", opp: "SEA", year: NFL_YEAR, season: regularLeft, upcoming: regularLeft, now: NOW }), { state: "none", line: MEETINGS_NONE_LINE });
    assert.equal(meetingsVerdict({ league: "nfl", abbr: "DEN", opp: "SEA", year: NFL_YEAR - 1, season: [playedDenSea], upcoming: regularLeft, now: NOW }).state, "none");
    const epl = [game({ league: "eng.1", home: "ARS", away: "CHE", at: "2026-09-20T14:00:00Z", final: [1, 0] }), game({ league: "eng.1", home: "ARS", away: "LIV", at: "2026-11-01T15:00:00Z" })];
    assert.equal(meetingsVerdict({ league: "eng.1", abbr: "ARS", opp: "CHE", year: seasonYearAt("eng.1", NOW), season: epl, upcoming: epl, now: NOW }).state, "none");
  });
  test("a later season is not judged (its games are not listed yet)", () => {
    assert.deepEqual(meetingsVerdict({ league: "nfl", abbr: "DEN", opp: "SEA", year: NFL_YEAR + 1, season: [], upcoming: [], now: NOW }), { state: "unknown" });
  });
  test("meetingsVerdictFor reads the rule's series through the two ports (and ignores any other rule)", async () => {
    const rule = { oracle: "catalogue", series: meetingsSeries("nfl", "DEN", "SEA", NFL_YEAR) };
    const seen: string[] = [];
    const v = await meetingsVerdictFor(rule, { season: async (lg, abbr, year) => { seen.push(`${lg}:${abbr}:${year}`); return [playedDenSea]; }, schedule: async () => playoffsOnly(["KC", "BUF"]) }, { now: NOW });
    assert.deepEqual(seen, [`nfl:DEN:${NFL_YEAR}`]);
    assert.deepEqual(v, { state: "none", line: MEETINGS_NONE_LEFT_LINE });
    assert.equal(await meetingsVerdictFor({ oracle: "catalogue", series: "nws.high:DTW-90" }, { season: async () => [], schedule: async () => [] }), null);
    const slow = await meetingsVerdictFor(rule, { season: () => new Promise<Game[]>(() => {}), schedule: null }, { now: NOW, timeoutMs: 20 });
    assert.deepEqual(slow, { state: "unknown" }, "a read that does not answer refuses nothing");
  });
  test("the page's option state: greyed with the line, offered with the warning, offered plain", () => {
    const played = [{ result: "win" }];
    assert.deepEqual(seriesOptionState({ offered: false, offeredLine: MEETINGS_NONE_LEFT_LINE, meetings: played }), { offered: false, why: MEETINGS_NONE_LEFT_LINE, warning: null });
    const w = meetingsNoneLeftWarning("2026", true);
    assert.deepEqual(seriesOptionState({ offered: true, offeredLine: null, meetings: played, warning: w }), { offered: true, why: null, warning: w });
    assert.deepEqual(seriesOptionState({ offered: true, offeredLine: null, meetings: [{ result: "pending" }] }), { offered: true, why: null, warning: null });
    plain(MEETINGS_NONE_LEFT_LINE); plain(w);
  });
  test("the wiring: the rivalry read, the review route and the prepare share meetingsLeft.ts", () => {
    const h = read("src/lib/burnticker/api/handlers.ts"), route = read("src/app/api/burnticker/v1/launch/review/route.ts"), lr = read("src/lib/burnticker/launchReview.ts");
    assert.match(h, /const verdict = meetingsVerdict\(\{ league, abbr: ta\.abbr, opp: tb\.abbr, year, season: games, upcoming, now: nowMs \}\)/);
    assert.match(h, /warning: verdict\.state === "playoffs" \? verdict\.warning : null/);
    assert.match(h, /const mr = meetingsRefusal\(await meetingsVerdictFor\(locked\.rule, \{ season: p\.teamSeason, schedule: p\.seasonSchedule \}\)\); if \(mr\) return \{ error: fail\(mr\.status, mr\.message/);
    assert.match(route, /meetingsVerdictFor\(rule, \{ season: \(league, abbr, year\) => espnClient\(\)\.season\(league, abbr, year\), schedule: platform\(\)\.seasonSchedule \}\)/);
    assert.match(route, /sourceNote, meetingsNote, meetingsRefusal \}\);/);
    assert.match(lr, /if \(o\.meetingsRefusal && !o\.seasonOver\) problems\.push\(o\.meetingsRefusal\);/);
    assert.match(page, /const playoffWarning = optionState\?\.warning \?\? null;/);
    assert.match(page, /data-playoffs-only>\{playoffWarning\}/);
  });
});

// ---- HB-97 --------------------------------------------------------------------------------------------------------------------------

describe("HB-97: a receipt check is kept per signature, and a slow check answers at once", () => {
  afterEach(() => resetReceiptCache());
  const sig = sampleReceipts().receipts[0]?.signature;
  const nullTxRpc = (counter: { n: number }, delayMs = 0): Rpc => ({ call: async <T,>() => { counter.n++; if (delayMs) await new Promise((r) => setTimeout(r, delayMs)); return null as T; } });
  test("a finished verdict is kept: the second check reads nothing", async () => {
    assert.ok(sig, "a sample receipt is listed");
    const c = { n: 0 };
    const a = await v1CheckReceipt(sig!, { rpc: nullTxRpc(c), fetchSource: null, cacheFile: null });
    assert.equal(a.status, 200);
    const b = await v1CheckReceipt(sig!, { rpc: nullTxRpc(c), fetchSource: null, cacheFile: null });
    assert.equal(b.status, 200);
    assert.equal(c.n, 1, "one RPC read for two checks");
    assert.equal((b.body as { served: string }).served, "kept verdict");
  });
  test("a check slower than the deadline answers 202 still checking, then the kept verdict", async () => {
    const c = { n: 0 };
    const t0 = Date.now();
    const slow = await v1CheckReceipt(sig!, { rpc: nullTxRpc(c, 150), fetchSource: null, cacheFile: null, deadlineMs: 20 });
    assert.ok(Date.now() - t0 < 140, "answered before the read finished");
    assert.equal(slow.status, 202);
    assert.equal((slow.body as { error: string }).error, RECEIPT_STILL_CHECKING);
    assert.equal(slow.headers?.["retry-after"], "5");
    await new Promise((r) => setTimeout(r, 200));
    const again = await v1CheckReceipt(sig!, { rpc: nullTxRpc(c, 150), fetchSource: null, cacheFile: null, deadlineMs: 20 });
    assert.equal(again.status, 200);
    assert.equal(c.n, 1);
    plain(RECEIPT_STILL_CHECKING);
  });
  test("a check whose RPC did not answer is not kept", async () => {
    const c = { n: 0 };
    const failing: Rpc = { call: async () => { c.n++; throw new Error("HTTP 429"); } };
    await v1CheckReceipt(sig!, { rpc: failing, fetchSource: null, cacheFile: null });
    await v1CheckReceipt(sig!, { rpc: failing, fetchSource: null, cacheFile: null });
    assert.equal(c.n, 2);
  });
  test("the kept verdicts survive a restart through the cache file", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bt-receipts-"));
    const file = path.join(dir, "checks.json");
    const c = { n: 0 };
    await v1CheckReceipt(sig!, { rpc: nullTxRpc(c), fetchSource: null, cacheFile: file });
    assert.ok(fs.existsSync(file));
    resetReceiptCache();
    const b = await v1CheckReceipt(sig!, { rpc: nullTxRpc(c), fetchSource: null, cacheFile: file });
    assert.equal(c.n, 1);
    assert.equal((b.body as { served: string }).served, "kept verdict");
    fs.rmSync(dir, { recursive: true, force: true });
  });
  test("the sample receipts are checked once when the web server builds its platform", () => {
    assert.match(read("src/lib/burnticker/server.ts"), /env\.NODE_ENV === "production" && env\.BURNTICKER_WARM_RECEIPTS !== "0"\) setTimeout\(\(\) => \{ void import\("@\/lib\/burnticker\/trustpack\/api"\)\.then\(\(m\) => m\.warmSampleReceipts\(\)\)/);
  });
});

// ---- HB-92 --------------------------------------------------------------------------------------------------------------------------

describe("HB-92: one wallet prompt count on the review", () => {
  test("the disclosure's line and the button's line come from walletPromptCount", () => {
    for (const [tx, proof] of [[2, true], [3, true], [2, false], [3, false]] as const) {
      const n = walletPromptCount({ transactions: tx, proof });
      const line = walletPromptsLine(tx, proof);
      assert.match(line, new RegExp(`asks ${n} `), line);
      assert.match(signsLine(n, { proof }), new RegExp(`asks ${n} times`));
      plain(line);
    }
    assert.match(walletPromptsLine(2, true), /asks 3 times in all/);
    assert.match(walletPromptsLine(3, true), /asks 4 times in all/, "the pair-curve review: 3 transactions and the proof");
  });
  test("the server's recovery line and the page's summary use it", () => {
    assert.match(read("src/lib/burnticker/launchReview.ts"), /walletPromptsLine\(n, true\),/);
    const s = read("src/app/burnticker/launch/PreWalletSummary.tsx");
    assert.match(s, /\[walletPromptsLine\(count, proof\), \.\.\.review\.recovery\.slice\(1\)\]/);
    assert.match(page, /proof=\{proofAsked\} \/>\}/);
    assert.match(read("src/app/burnticker/launch/CoinVsCoinTile.tsx"), /proof=\{!wallet\.connected \|\| !!wallet\.signMessage\} \/>\}/);
  });
});

// ---- HB-93 --------------------------------------------------------------------------------------------------------------------------

describe("HB-93: an inverse hurricane coin's off-season", () => {
  const rule = (series: string, inverse: boolean): BurnRule => ({ ...firstPartyRule(series, 0.02), inverse } as BurnRule);
  test("the eastern Pacific season from the source, and the Unusual cases line", () => {
    const s = hazardSeasonOf("nhc.hurricanes:ep.3")!;
    assert.deepEqual([s.start, s.end, s.startWords, s.endWords], ["05-15", "11-30", "May 15", "November 30"]);
    assert.equal(hazardSeasonOf("nhc.storms:al")!.startWords, "June 1");
    const line = offSeasonLine(rule("nhc.hurricanes:ep.3", true))!;
    assert.equal(line, "Outside the season in the eastern Pacific (May 15 to November 30), no storm is counted, so every day counts as a day without one and this coin burns 2% of its pool every day until the season starts again.");
    plain(line);
    assert.equal(offSeasonLine(rule("nhc.hurricanes:ep.3", false)), null, "Every time it happens has no off-season burns");
    assert.equal(offSeasonLine(rule("spc.tornadoes:US", true)), null, "tornado reports are read all year");
    assert.equal(hazardSeasonOf("nhc.next:al.3.2026"), null, "the one-shot ends with its season");
  });
  test("the back-test says how many burns fell outside the season", () => {
    const r = rule("nhc.hurricanes:ep.3", true);
    assert.equal(outsideSeason(hazardSeasonOf("nhc.hurricanes:ep.3")!, "2026-12-03"), true);
    assert.equal(outsideSeason(hazardSeasonOf("nhc.hurricanes:ep.3")!, "2026-05-15"), false);
    assert.match(offSeasonBacktestLine(r, ["2026-08-01", "2026-12-02", "2027-01-05"])!, /^2 of those burns fell outside the season \(May 15 to November 30\)/);
    const none = offSeasonBacktestLine(r, ["2026-08-01"])!;
    assert.match(none, /^None of those burns/);
    plain(none);
    assert.equal(offSeasonBacktestLine(rule("nhc.hurricanes:ep.3", false), ["2026-12-02"]), null);
  });
  test("the page lists it first among the Unusual cases, and the projection adds the count", () => {
    assert.match(page, /\{ const off = offSeasonLine\(rule\); if \(off\) edgeNotes\.unshift\(off\); \}/);
    assert.match(read("src/lib/burnticker/projection.ts"), /const l = offSeasonBacktestLine\(rule, burnDays\); return l \? \[l\] : \[\];/);
  });
});

// ---- HB-94 and HS-39 ----------------------------------------------------------------------------------------------------------------

describe("HB-94: the address names the step on screen; HS-39: Edit on a hazard trigger opens the burn step", () => {
  test("a jump back replaces the entry; a step forward adds one; the same step does nothing", () => {
    assert.equal(stepHistoryAction("review", "which"), "replace");
    assert.equal(stepHistoryAction("name", "burn"), "replace");
    assert.equal(stepHistoryAction("which", "burn"), "push");
    assert.equal(stepHistoryAction("which", "which"), "none");
    assert.equal(stepAddress("/burnticker/launch", "follow"), "/burnticker/launch");
    assert.equal(stepAddress("/burnticker/launch", "which"), "/burnticker/launch?step=which");
  });
  test("a Back the page cannot follow is rewritten to the shown step", () => {
    // the run 7 sequence: Edit sent the draft to Which (step is no longer "review"); Back asks for review, then name
    assert.equal(popstateFollows({ asked: "review", follow: "disaster", step: "choose" }), false);
    assert.equal(popstateFollows({ asked: "name", follow: "disaster", step: "choose" }), false);
    assert.equal(popstateFollows({ asked: "follow", follow: "disaster", step: "choose" }), true);
    assert.equal(popstateFollows({ asked: "burn", follow: "team", step: "review" }), true);
    assert.equal(popstateFollows({ asked: "name", follow: "coins", step: "choose" }), true);
    assert.match(page, /if \(!popstateFollows\(\{ asked: p, follow: guide\.follow, step \}\)\) \{ try \{ window\.history\.replaceState\(\{ btStep: urlStep \}, "", stepAddress\(window\.location\.pathname, urlStep\)\)/);
    assert.match(page, /const act = stepHistoryAction\(cur, urlStep\);/);
  });
  test("HS-39: the trigger's Edit opens the burn step for a natural disaster, Which for the rest", () => {
    assert.equal(triggerEditPhase("disaster"), "burn");
    for (const f of ["team", "market", "number", "rivalry", null]) assert.equal(triggerEditPhase(f), "which");
    assert.match(page, /\{ label: FACT_LABELS\.trigger, value: trigger, edit: editTo\(triggerEditPhase\(guide\.follow\)\) \}/);
  });
});

// ---- HB-95 --------------------------------------------------------------------------------------------------------------------------

describe("HB-95: one bound set for the daily high, and a warning past the station's record", () => {
  test("the page field, the API dial and the intent parser share the bounds", () => {
    assert.deepEqual([WX_HIGH_MIN_F, WX_HIGH_MAX_F], [-60, 135]);
    assert.equal(wxThresholdProblem("high", "136"), WX_HIGH_RANGE_LINE);
    assert.equal(wxThresholdProblem("high", "-61"), WX_HIGH_RANGE_LINE);
    assert.equal(wxThresholdProblem("high", "135"), null);
    assert.deepEqual(HIGH_RANGE, { min: WX_HIGH_MIN_F, max: WX_HIGH_MAX_F });
    assert.match(read("src/lib/burnticker/dials.ts"), /step: 1, min: WX_HIGH_MIN_F, max: WX_HIGH_MAX_F \}/);
    plain(WX_HIGH_RANGE_LINE);
  });
  test("Phoenix at 135 °F names the station's highest daily high; a fade threshold below its lowest high names that", () => {
    const f = weatherFrequency("nws.high:PHX-135")!;
    assert.match(f.warning!, /^The highest daily high on record at Phoenix \(Sky Harbor\) from 2016 to 2025 is 1[12]\d °F, so no day in those years would have burned at 135 °F\./);
    plain(f.warning!);
    const rec = highRecords({ highAtLeast: { "-20": 365.2, "40": 365.2, "41": 364, "100": 3, "118": 1, "119": 0, "125": 0 } });
    assert.deepEqual(rec, { highest: 118, lowest: 40 });
    const inv = weatherFrequency("nws.high:PHX--20", true);
    assert.ok(inv === null || inv.warning === null || /lowest daily high on record/.test(inv.warning) || /may not fire/.test(inv.warning));
    // a threshold inside the record keeps the frequency warning (or none)
    assert.doesNotMatch(weatherFrequency("nws.high:PHX-110")?.warning ?? "", /on record/);
  });
});

// ---- HB-96 --------------------------------------------------------------------------------------------------------------------------

describe("HB-96: a reading waiting for both coins to graduate counts as waiting", () => {
  test("the count and the one line on both token pages", () => {
    assert.equal(isWaitingReading("pending-pair"), true);
    assert.equal(isWaitingReading("planned"), true);
    assert.equal(isWaitingReading("confirmed"), false);
    assert.equal(healthLine(1, 0), "One reading is waiting with no burn yet, and no executed burn is unverified.");
    assert.equal(healthLine(0, 2), "No reading is waiting with no burn yet, and 2 executed burns are unverified.");
    for (const x of [healthLine(1, 0), healthLine(3, 1)]) plain(x);
    const tp = read("src/lib/burnticker/tokenPage.ts");
    assert.match(tp, /health: \{ pending: i\.receipts\.filter\(\(b\) => isWaitingReading\(b\.status\)\)\.length,/);
    assert.match(tp, /\$\{esc\(healthLine\(s\.health\.pending, s\.health\.unverified\)\)\}/);
    assert.match(read("src/app/burnticker/t/[ticker]/page.tsx"), /data-health-line>\{healthLine\(s\.health\.pending, s\.health\.unverified\)\}/);
  });
});

// ---- HB-98 --------------------------------------------------------------------------------------------------------------------------

describe("HB-98: a source check is judged as an instant, with a grace", () => {
  const due = "2026-10-20T01:11:00Z";   // 7:11 PM MDT on Oct 19
  test("six minutes after it was due: due now, never overdue; past the grace: overdue; before: the time in Denver", () => {
    assert.equal(checkLine(due, Date.parse(due) + 6 * 60_000), DUE_NOW);
    assert.match(checkLine(due, Date.parse(due) + OVERDUE_GRACE_MS + 60_000), /^Was due at Oct 19, 2026, 7:11 PM MDT and is overdue$/);
    assert.equal(checkLine(due, Date.parse(due) - 60 * 60_000), "About Oct 19, 2026, 7:11 PM MDT");
    assert.equal(dayLine(due, Date.parse(due) + 6 * 60_000), DUE_NOW);
    assert.match(dayLine(due, Date.parse(due) + 60 * 60_000), /is overdue$/);
    assert.equal(checkLine(null, 0), CREATOR_PAGE.noNext);
    plain(DUE_NOW);
  });
  test("the creator view uses it for the next check", () => {
    const f = creatorNextFields({ rules: { oneShot: false }, next: { nextCheckAt: due, nextCloseTime: null, result: "recurring", nextResultAt: null, nextSourceCheckAt: due } } as never, [], Date.parse(due) + 6 * 60_000);
    assert.equal(f.nextCheckLine, DUE_NOW);
    assert.equal(f.nextLabel, CREATOR_PAGE.labels.next);
  });
});

// ---- HB-99 --------------------------------------------------------------------------------------------------------------------------

describe("HB-99: the pair answer never outlives its cache header", () => {
  test("the memo has a maximum age and a build bound; a stale answer says its age and is not cached", () => {
    const r = read("src/app/api/burnticker/pairs/[pairId]/route.ts");
    assert.match(r, /const PAIR_MAX_STALE_MS = 75_000;/);
    assert.match(r, /maxStaleMs: PAIR_MAX_STALE_MS, buildTimeoutMs: SWR_BUILD_TIMEOUT_MS/);
    assert.match(r, /if \(got\.state === "stale" \|\| got\.state === "stale-version"\) return NextResponse\.json\(got\.value, \{ headers: \{ \.\.\.NO_STORE, "x-pair-memo": got\.state, "x-pair-age-sec"/);
  });
});

// ---- HB-80 / HS-27 residues ---------------------------------------------------------------------------------------------------------

describe("HB-80 / HS-27 residues: the badge, the home chip and the creator label", () => {
  const status = (pairRole: "won" | "lost") => ({ ticker: pairRole === "won" ? "DENWIN" : "SEAWIN", rules: { oneShot: true }, next: { result: "decided", nextCheckAt: "2026-10-20T04:09:26Z", nextMarket: null, nextCloseTime: null }, selectorKey: "espn.game:nfl-401", profile: { badge: "ONE-SHOT · Oct 15, 2026" }, pair: { clause: { state: "waiting", voidBy: "2026-11-14" } } });
  const rc = (pairRole: "won" | "lost") => [{ status: "pending-pair", settledAt: "2026-10-16T13:38:00Z", kind: "event", pairRole, units: 1 }];
  test("the SVG coin badge prints the decided line's words", () => {
    assert.equal(decidedCardLine("Won on 15 October 2026. Burn runs once both coins graduate (by 14 November 2026)."), "won on 15 October 2026; burns once both coins graduate");
    assert.equal(decidedCardLine("Lost on 15 October 2026. This result cannot make $SEAWIN burn."), "lost on 15 October 2026; cannot burn on this result");
    assert.equal(decidedCardLine("Won on 15 October 2026. Burn runs on its trading pool."), "won on 15 October 2026; burns on its trading pool");
    assert.equal(decidedCardLine(null), null);
    assert.equal(lastBurnLine({ lastBurn: null, status: "live", decided: "Won on 15 October 2026. Burn runs once both coins graduate." }), "won on 15 October 2026; burns once both coins graduate");
    assert.equal(lastBurnLine({ lastBurn: null, status: "live" }), "no burn yet");
    assert.equal(pairDecidedLine({ ticker: "DENWIN", decided: "Won on 15 October 2026. x" }, { ticker: "SEAWIN", decided: "Lost on 15 October 2026. y" }), "$DENWIN won on 15 October 2026; $SEAWIN lost");
    for (const x of ["won on 15 October 2026; burns once both coins graduate", "lost on 15 October 2026; cannot burn on this result"]) plain(x);
  });
  test("the home row's chip says Decided, with no next time", () => {
    assert.equal(SETTLEMENT_LABEL.decided, "Decided");
    const row = upcomingFromStatus({ ...status("lost"), name: "Seahawks", cluster: "mainnet", status: "live", oracle: "espn", seriesTitle: null } as never, rc("lost") as never, "SEAWIN")!;
    assert.equal(row.status, "decided");
    assert.equal(row.nextAt, null);
    assert.match(row.statusText, /^Lost on 15 October 2026\./);
    assert.doesNotMatch(JSON.stringify(row), /On hold|waits until both coins/);
  });
  test("the creator card's label says Result for a decided coin", () => {
    const f = creatorNextFields({ ...status("lost"), next: { result: "decided", nextResultAt: null, nextSourceCheckAt: null } } as never, rc("lost") as never, Date.parse("2026-10-19T23:00:00Z"));
    assert.equal(f.nextLabel, "Result");
    assert.match(read("src/app/burnticker/creator/[wallet]/page.tsx"), /\{c\.nextLabel \?\? CREATOR_PAGE\.labels\.next\}/);
  });
});

// ---- HB-91 --------------------------------------------------------------------------------------------------------------------------

describe("HB-91: the whitepaper says the bounty is live", () => {
  test("the current status table and section 10 agree with transparency.json", () => {
    const tr = JSON.parse(read("config/burnticker/transparency.json")) as { howBuilt: { bounty: { status: string; recordedFunding: { sol: number } } } };
    assert.match(tr.howBuilt.bounty.status, /^funded/);
    const wp = read("docs/burnticker/WHITEPAPER.md");
    assert.match(wp, new RegExp(`\\| Bug bounty \\| live: the bounty wallet \`HATDNP3MsmsxGcbKKjnoXXPBb46aLaMTdzLG3TfHJv2u\` was funded with ${tr.howBuilt.bounty.recordedFunding.sol} SOL on 2026-10-11`));
    assert.doesNotMatch(wp, /The bounty is not done either/);
    assert.match(wp, /Since 2026-10-11 it is live/);
    if (fs.existsSync("site/burnticker/whitepaper.html")) assert.match(read("site/burnticker/whitepaper.html"), /Since 2026-10-11 it is live/);
  });
});

// ---- HB-68 residue ------------------------------------------------------------------------------------------------------------------

describe("HB-68 residue: What to know before you start on the coin comparison reviews", () => {
  test("a pair-curve pair says its own graduation condition; a linked pair the usual lines", () => {
    const pc = pairUpfrontLines("pair-curve", RAISE_PRESETS_SOL, "Before the first burn, the pair's shared curve must raise 170 SOL.");
    assert.equal(pc[1], "Before the first burn, the pair's shared curve must raise 170 SOL.");
    assert.equal(pc.length, upfrontLines(RAISE_PRESETS_SOL, { pair: true }).length);
    assert.equal(pairUpfrontLines("pair-curve", RAISE_PRESETS_SOL, null)[1], PAIR_CURVE_UPFRONT_FALLBACK);
    assert.deepEqual(pairUpfrontLines("linked", RAISE_PRESETS_SOL), upfrontLines(RAISE_PRESETS_SOL, { pair: true }));
    plain(PAIR_CURVE_UPFRONT_FALLBACK);
    const t = read("src/app/burnticker/launch/CoinVsCoinTile.tsx");
    assert.match(t, /upfront=\{pairUpfrontLines\(reviewVenue, RAISE_PRESETS_SOL, shown\.review\?\.prerequisiteLine \?\? null\)\}/);
    assert.match(t, /upfront=\{upfrontLines\(RAISE_PRESETS_SOL\)\}/);
  });
});

// ---- HS-40 --------------------------------------------------------------------------------------------------------------------------

describe("HS-40: the coin comparison cards are named by cadence", () => {
  test("the two cards, the share from the race's own value, the words of the pair sentence", () => {
    const w = coinVsCardWords(DEFAULT_SHARE.recurring);
    assert.equal(w.once.label, FLIP_CARD_LABEL);
    assert.equal(w.race.label, RACE_CARD_LABEL);
    assert.equal(w.once.sentence, "The first day A passes B, A's coin burns once and takes B's pool; if it never happens, B's coin burns once at the end.");
    assert.equal(w.race.sentence, "Each day the coin whose reference gained more burns 2%, and takes the other coin's 2% for that day.");
    assert.match(coinVsCardWords(0.05, 30).race.sentence, /burns 5%, and takes the other coin's 5% for that day\. Read once a day at 00:00 UTC for 30 days\.$/);
    for (const x of [w.once.label, w.once.sentence, w.race.label, w.race.sentence]) plain(x);
    // the pair sentence says the same: the flippening's winner takes the other coin's pool, the race's winner the other coin's share
    assert.match(FLIP_REST_LINE, /the rest of the other coin's pool[^.]*goes to the winner's burn/);
    const spec = { flip: false, window: "daily", measure: "price", a: { symbol: "WIF", pyth: "x" }, b: { symbol: "BONK", pyth: "y" }, season: { days: 30 } };
    assert.match(derbySentence(spec as never, "WIFWINS", "BONKWINS", 0.02), /\$BONKWINS's share for that day goes to \$WIFWINS's burn/);
    assert.match(read("src/app/burnticker/launch/CoinVsCoinTile.tsx"), /const cards = coinVsCardWords\(shares\.daily, seasonDays\);/);
  });
});

// ---- HS-41 --------------------------------------------------------------------------------------------------------------------------

describe("HS-41: the Pairs tab says no burn yet, and the decided line", () => {
  const listing = (outcome: "won" | "lost"): CoinListing => ({ group: "decided-waiting" as CoinListing["group"], result: { outcome, words: null, settledAt: "2026-10-16", next: outcome === "won" ? "burn-after-graduation" : "no-burn-losing" } as CoinListing["result"], next: null });
  test("the decided pair's line from the two sides' result lines", () => {
    const z = { now: Date.parse("2026-10-19T23:00:00Z") };
    const line = pairDecidedRowLine({ ticker: "DENWIN", listing: listing("won") }, { ticker: "SEAWIN", listing: listing("lost") }, z)!;
    assert.equal(line, "$DENWIN won on Oct 16; $SEAWIN lost. Burn after graduation.");
    assert.equal(pairDecidedRowLine({ ticker: "SEAWIN", listing: listing("lost") }, { ticker: "DENWIN", listing: listing("won") }, z), line, "either order");
    assert.equal(pairDecidedRowLine({ ticker: "A", listing: null }, { ticker: "B", listing: { group: "open", result: null, next: null } as CoinListing }, z), null);
    plain(line); plain(PAIR_NO_BURN_YET);
    const ci = read("src/app/burnticker/CoinsIndex.tsx");
    assert.match(ci, /p\.a\.lastBurnAt \? `last burn \$\{ago\(p\.a\.lastBurnAt, now\)\}` : PAIR_NO_BURN_YET/);
    assert.match(ci, /data-pair-decided>\{d\}/);
  });
});
