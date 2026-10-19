// WEBSITE-21 (2026-10-12): the launch page's side of WIRING-RIVALRY-SERIES (the owner: "sixers vs celtics as a pair ... burn schedule
// based on their head-to-head games ... leftover burns the season series winner ... should extrapolate to other sports"), WIRING-POLISH
// (the categories row's scroll hint, the sticky bar above the tab bar) and the cheap audit 7 items (15: no "Remove the image" after a
// rejected image; 16: choice cards as radios, Skip to content). Pure pieces are tested directly; page wiring is pinned by its source;
// every new sentence passes the copy lint, says no "will" and never names ESPN.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildLaunchReview } from "@/lib/burnticker/launchReview";
import { describeRule, endText, MEETINGS_END_RESULT, windowBadge } from "@/lib/burnticker/describe";
import type { BurnRule } from "@/lib/burnticker/rules";
import { LEAGUES, teamsOf, type LeagueId } from "@/lib/burnticker/sources/espn";
import {
  IMAGE_CANCEL_LABEL, IMAGE_FAILED, IMAGE_KEEP_GENERATED_LABEL, IMAGE_PENDING, MEETINGS_DEADLINE_LINE, MEETINGS_END_LABEL, MEETINGS_END_LINE, MEETINGS_LIST_LABEL,
  MEETINGS_NONE_LINE, MEETINGS_PAIR_PAGE_LINE, MEETINGS_WINNER_LINE, PATTERN_REASON, RIVALRY_SERIES_LABEL, RIVALRY_SERIES_LINE, endSentences, isMeetingsSelector,
  meetingsListRows, meetingsPairNames, meetingsPairRules, meetingsPairSentence, patternOptions, patternWords, type MeetingRow,
} from "@/lib/burnticker/guidedLaunch";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";

const cfg = loadCopyLintConfig();
const plain = (t: string, where = t) => {
  assert.deepEqual(lintCopy(t, cfg).hits.map((h) => `${h.phrase} (${h.rule})`), [], `${where}: ${t}`);
  assert.doesNotMatch(t, /\bwill\b|\bbuy|\bprice\b|coming soon|\bESPN\b/i, `${where}: ${t}`);
  assert.doesNotMatch(t, /\b20\d\d-\d\d-\d\d\b/, `${where} carries a date: ${t}`);
};
const read = (f: string) => fs.readFileSync(f, "utf8");
const page = read("src/app/burnticker/launch/page.tsx"), steps = read("src/app/burnticker/launch/GuidedSteps.tsx"), card = read("src/app/burnticker/launch/ReviewCard.tsx");
const ENV = { BURNTICKER_CLUSTER: "devnet", BURNTICKER_CREATOR_LAUNCHES_ENABLED: "1" } as Record<string, string>;
const NOW = Date.parse("2026-01-15T12:00:00Z");
const PHI = { abbr: "PHI", nickname: "76ers", name: "Philadelphia 76ers" }, BOS = { abbr: "BOS", nickname: "Celtics", name: "Boston Celtics" };
/** The rule the page builds after "Every game between them this season", as the review and the bundle describe it (pair clause on). */
const paired = (r: BurnRule, side: "A" | "B"): BurnRule => ({ ...r, pair: { pairId: "review-pair", side, counterpartMint: null, winnerTakesBurn: true } } as BurnRule);

describe("website-21: every sentence a creator sees on the rivalry-series path", () => {
  test("the option, the list, the burn, the end, the deadline, the pair page and the image lines pass the copy lint", () => {
    for (const s of [RIVALRY_SERIES_LABEL, RIVALRY_SERIES_LINE, MEETINGS_LIST_LABEL, MEETINGS_NONE_LINE, MEETINGS_WINNER_LINE, MEETINGS_END_LABEL, MEETINGS_END_LINE, MEETINGS_DEADLINE_LINE,
      MEETINGS_PAIR_PAGE_LINE, PATTERN_REASON.meetingsOnly, PATTERN_REASON.teamsSeparate, IMAGE_PENDING, IMAGE_FAILED, IMAGE_CANCEL_LABEL, IMAGE_KEEP_GENERATED_LABEL]) plain(s);
    assert.equal(RIVALRY_SERIES_LABEL, "Every game between them this season");
    assert.match(MEETINGS_DEADLINE_LINE, /30 days from launch/); assert.match(MEETINGS_DEADLINE_LINE, /both|Both coins/);
    assert.equal(MEETINGS_PAIR_PAGE_LINE, "Each coin reads its own team's games against the other team. Each game burns the coin of the team that won it.");
  });
  test("the step-3 and review sentence names both coins' rules and what each game moves, at the chosen share", () => {
    const r = meetingsPairRules("nba", "PHI", "BOS", 2026);
    const a = describeRule(paired(r.a, "A"), { ticker: "PHIVBOS" }), b = describeRule(paired(r.b, "B"), { ticker: "BOSVPHI" });
    const s = meetingsPairSentence({ a: "PHIVBOS", b: "BOSVPHI", oneA: a.oneLiner, oneB: b.oneLiner, share: "2%" });
    plain(s, "the pair sentence");
    assert.match(s, /^\$PHIVBOS burns when the 76ers beat the Celtics, and \$BOSVPHI burns when the Celtics beat the 76ers\. /);
    assert.match(s, /spends 2% of its own burn pool, and the other coin sends 2% of its pool to the winning coin's burn\.$/);
    assert.equal(windowBadge(r.a), "2025–26 SEASON SERIES");
    plain(a.paragraph, "side A's description"); plain(b.paragraph, "side B's description");
  });
});

describe("website-21: step 2, the third rivalry option and its meetings list", () => {
  test("the list is soonest first, from the first team's side, with playoff games and finished games marked", () => {
    const ms: MeetingRow[] = [
      { eventId: "3", startsAt: "2026-05-02T23:00:00Z", playoff: true, home: "BOS", away: "PHI", status: "scheduled", result: "pending" },
      { eventId: "1", startsAt: "2025-10-24T23:00:00Z", playoff: false, home: "PHI", away: "BOS", status: "final", result: "win" },
      { eventId: "2", startsAt: "2026-01-09T00:30:00Z", playoff: false, home: "BOS", away: "PHI", status: "final", result: "loss" },
      { eventId: "4", startsAt: "2026-02-01T00:30:00Z", playoff: false, home: "PHI", away: "BOS", status: "postponed or cancelled", result: "void" },
    ];
    const rows = meetingsListRows(ms, "PHI", "BOS");
    assert.deepEqual(rows.map((x) => x.key), ["1", "2", "4", "3"]);
    assert.deepEqual(rows.map((x) => x.where), ["vs BOS", "at BOS", "vs BOS", "at BOS"]);
    assert.deepEqual(rows.map((x) => x.state), ["PHI won", "BOS won", "postponed or cancelled", null]);
    assert.deepEqual(rows.map((x) => x.playoff), [false, false, false, true]);
  });
  test("the page reads GET /v1/sports/rivalry for the two teams picked and offers the option only when the schedule lists a game", () => {
    assert.match(page, /\$\{V1\}\/sports\/rivalry\?league=\$\{encodeURIComponent\(leagueSeries\)\}&a=\$\{encodeURIComponent\(rivalA\.abbr\)\}&b=\$\{encodeURIComponent\(rivalB\.abbr\)\}/);
    assert.match(page, /\{RIVALRY_SERIES_LABEL\}/); assert.match(page, /\{RIVALRY_SERIES_LINE\}/); assert.match(page, /\{MEETINGS_LIST_LABEL\}/);
    // not offered: greyed with the server's offeredLine (MEETINGS_NONE_LINE); a failed read says the schedule could not be read, with Retry
    assert.match(page, /rv!\.offered \? null : \(rv!\.offeredLine \?\? NO_LISTED_MEETING_LINE\)/);
    assert.match(page, /failed \? \(rv!\.scheduleNote \?\? SCHEDULE_UNAVAILABLE_LINE\)/);
    assert.match(page, /setRivalryRetry\(\(n\) => n \+ 1\)/);
    assert.match(page, /data-playoff>playoffs</);
    assert.match(page, /onClick=\{\(\) => chooseRivals\(rivalA, rivalB, "meetings"\)\}/);
  });
  test("for every league the pickers carry, two teams give a pair of mirror series, named and ticked for the matchup", () => {
    for (const lg of Object.keys(LEAGUES) as LeagueId[]) {
      const ts = teamsOf(lg); assert.ok(ts.length >= 2, lg);
      const r = meetingsPairRules(lg, ts[0].abbr, ts[1].abbr, 2026);
      assert.ok(isMeetingsSelector(r.a.series) && isMeetingsSelector(r.b.series), lg);
      assert.notEqual(r.a.series, r.b.series, lg);
      assert.deepEqual([r.a.onEnd?.endSink, r.b.onEnd?.endSink], [true, true], lg);
      const n = meetingsPairNames(ts[0], ts[1]);
      assert.match(n.a.ticker, /^[A-Z0-9]{2,10}$/, lg); assert.notEqual(n.a.ticker, n.b.ticker, lg);
      const end = endSentences(paired(r.a, "A"));
      assert.equal(end.kind, "pair-winner", lg); assert.equal(end.sentences[0], MEETINGS_END_RESULT.split(/(?<=\.)\s+(?=[A-Z$])/)[0], lg);
    }
    assert.deepEqual(meetingsPairNames(PHI, BOS), { a: { name: "76ers vs Celtics, 76ers side", ticker: "PHIVBOS" }, b: { name: "Celtics vs 76ers, Celtics side", ticker: "BOSVPHI" } });
    assert.equal(isMeetingsSelector("KXNBAGAME"), false); assert.equal(isMeetingsSelector(null), false);
  });
  test("picking it builds the pair from the page's own rules, names it $PHIVBOS / $BOSVPHI and keeps the schedule's season year", () => {
    assert.match(page, /if \(pairMode === "meetings"\) \{ try \{ return meetingsPairRules\(leagueSeries as LeagueId, sideA\.abbr, sideB\.abbr, meetingsYear \?\?/);
    assert.match(page, /const n = meetingsPairNames\(a, b\);/);
    assert.match(page, /setMeetingsYear\(rivalry\?\.key === `\$\{leagueSeries\}:\$\{a\.abbr\}:\$\{b\.abbr\}` \? rivalry\.year : null\)/);
    assert.match(page, /swap, pairMode, meetingsYear, pick,/, "the draft keeps the season year");
  });
});

describe("website-21: step 3, Winner takes the burn only", () => {
  test("patternOptions and patternWords for the three scopes", () => {
    const r = meetingsPairRules("nba", "PHI", "BOS", 2026).a;
    const po = patternOptions({ follow: "rivalry", pairKind: "teams", rule: r, rivalryScope: "meetings" });
    assert.equal(po.preselected, "winner");
    assert.deepEqual(po.options.filter((o) => o.available).map((o) => o.id), ["winner"]);
    for (const o of po.options.filter((x) => !x.available)) assert.equal(o.reason, PATTERN_REASON.meetingsOnly);
    assert.equal(patternWords("winner", { follow: "rivalry", pairKind: "teams", rivalryScope: "meetings" }).sentence, MEETINGS_WINNER_LINE);
    // 2026-10-13: one game is a linked pair too (winner only); every loss this season stays two separate coins
    const season = patternOptions({ follow: "rivalry", pairKind: "teams", rule: r, rivalryScope: "season" }).options.find((o) => o.id === "winner")!;
    assert.equal(season.available, false); assert.equal(season.reason, PATTERN_REASON.teamsSeparate);
    const one = patternOptions({ follow: "rivalry", pairKind: "teams", rule: r, rivalryScope: "game" });
    assert.equal(one.preselected, "winner"); assert.deepEqual(one.options.filter((o) => o.available).map((o) => o.id), ["winner"]);
  });
  test("the page passes the scope, selects the winner, ignores other taps and keeps the recurring shares", () => {
    assert.match(page, /const rivalryScope = pairKindNow === "teams" \? \(meetingsOn \? "meetings" as const : pairMode === "game" \? "game" as const : "season" as const\) : null;/);
    assert.match(page, /meeting: rivalSeason \? !!rivalGame : null, rivalryScope \}\)/);
    assert.match(page, /pairKind: pairKindNow, rivalryScope, gameLabel \}\) \}\)\);/);
    assert.match(page, /guide\.follow === "rivalry" \? \(meetingsOn \|\| settledPick \? "winner" :/);
    assert.match(page, /if \(meetingsOn \|\| settledPick\) return;/);
    assert.match(page, /meetingsOn \? PATTERNS\.winner\.label\.toLowerCase\(\)/, "the progress strip says the pattern");
  });
});

describe("website-21: the review", () => {
  const r = meetingsPairRules("nba", "PHI", "BOS", 2026);
  // exactly the body the page posts for a rivalry series pair (side B in `pair`, never `companion`)
  const body = { rule: r.a, ticker: "PHIVBOS", name: "76ers vs Celtics, 76ers side", note: "", raiseSol: "85", creatorDescription: "", links: [], pair: { ticker: "BOSVPHI", name: "Celtics vs 76ers, Celtics side", creatorDescription: "", links: [] } };
  test("the server answers the meetings block, LaunchLab, the series-winner end, and no problems", () => {
    for (const env of [ENV, { ...ENV, BURNTICKER_PAIR_CURVE_ENABLED: "1" }]) {
      const out = buildLaunchReview(body, { env, now: NOW });
      assert.ok("review" in out, JSON.stringify(out));
      assert.deepEqual(out.review.problems, []);
      assert.equal(out.review.venue, "launchlab");
      assert.equal(out.review.end.result, MEETINGS_END_RESULT);
      assert.ok(out.review.meetings);
      assert.deepEqual(out.review.meetings!.flow.steps.map((s) => s.title), ["Where fees come from", "After each game between them", "At the end of the season"]);
      for (const s of [out.review.meetings!.flow.oneLiner, ...out.review.meetings!.flow.steps.map((x) => x.text), ...out.review.meetings!.flow.outcomes.flatMap((o) => [o.when, o.then]), out.review.meetings!.flow.never]) assert.doesNotMatch(s, /\bwill\b|\bESPN\b/i, s);
      // the client's end, read from the paired rule, says what the server says
      assert.equal(endText(paired(r.a, "A")).result, out.review.end.result);
      assert.equal(out.review.meetings!.descriptionB, describeRule(paired(r.b, "B"), { ticker: "BOSVPHI" }).paragraph, "side B as the page describes it = the review's descriptionB");
    }
  });
  test("the page sends `pair`, renders review.meetings.flow, states the one end and the 30-day deadline, and offers no game/season switch", () => {
    assert.match(page, /\? \{ pair: \{ ticker: tickerB\.toUpperCase\(\), name: nameB, creatorDescription: profileB\.description, links: creatorLinks/);
    assert.match(page, /\{reviewMeetings\?\.flow && <FundsFlowView flow=\{reviewMeetings\.flow\} open \/>\}/);
    assert.match(card, /export function FundsFlowView\(\{ flow, open = false, saidAbove = null \}: \{ flow: FundsFlow; open\?: boolean; saidAbove\?: string \| null \}\)/);
    assert.match(page, /meetingsOn \? <EndSection title=\{MEETINGS_END_LABEL\} sentences=\{\[MEETINGS_END_LINE, MEETINGS_DEADLINE_LINE\]\} options=\{\[\]\} \/>/);
    assert.match(steps, /\{title && <p className="font-medium text-amber-200" data-end-title>\{title\}<\/p>\}/);
    assert.match(page, /const facts = meetingsOn \? null :/, "never winnerTakesBurnFacts or matchupFacts for this option");
    assert.match(page, /durations=\{pairOn && !elPick && !meetingsOn \?/);
    assert.match(page, /const endRule = ruleShown \?\? rule;/);
  });
  test("launch: one LaunchLab pair (never two separate coins, never the pair curve), side B's description from the review", () => {
    assert.match(page, /if \(pairOn && ruleB && !meetingsOn && !settledPick\) \{/);
    assert.match(page, /const descB = meetingsOn \? \(reviewMeetings\?\.descriptionB \?\? finalDescriptionB\) : settledPick \? \(reviewSettled\?\.descriptionB \|\| finalDescriptionB\) : finalDescriptionB;/);
    assert.match(page, /meetingsOn \|\| settledPick \? "launchlab" : pairVenue\);/);
    // the preview and launch gates are the ones every pair uses
    assert.match(page, /blocked=\{walletBlocked\(pairOn \? "matchup" : launchTypeOf\(rule\), pairOn\)\}/);
    assert.match(page, /if \(!rule \|\| !reviewMatchesDraft\(reviewSlot, curRev\.current\)\) return;/);
    assert.match(page, /const out = await prepareIfCurrent\(sentRev, \(\) => curRev\.current,/);
  });
});

describe("website-21: the pair pages say a rivalry series pair reads two series", () => {
  test("tokenPage.ts and /burnticker/p use MEETINGS_PAIR_PAGE_LINE for a meetings selector", () => {
    // 2026-10-13: a settled-event pair (two candidates, one game) has its own sentence between the two
    assert.match(read("src/lib/burnticker/tokenPage.ts"), /\$\{pairKindOf\(a\) === "meetings" \? `\$\{esc\(MEETINGS_PAIR_PAGE_LINE\)\} A draw, a postponed or a cancelled game moves nothing\.` : settledLineOf\(a\.rules\.statement\) \? esc\(settledLineOf\(a\.rules\.statement\)!\) : `Both coins read the same market/);   // third prelaunch audit F10: pairKindOf strips the coin selector's catalogue: prefix, which isMeetingsSelector missed
    assert.match(read("src/app/burnticker/p/[pairId]/page.tsx"), /\{isMeetingsSelector\(d\.pair\.selectorKey\) \? <>\{MEETINGS_PAIR_PAGE_LINE\} A draw, a postponed or a cancelled game moves nothing\.<\/> : settledLineOf\(d\.a\.status\.rules\.statement\) \? <span data-settled-pair-line>\{settledLineOf\(d\.a\.status\.rules\.statement\)\}<\/span> : <>Both coins read the same market/);
    plain(`${MEETINGS_PAIR_PAGE_LINE} A draw, a postponed or a cancelled game moves nothing.`);
    assert.equal(isMeetingsSelector(meetingsPairRules("nba", "PHI", "BOS", 2026).a.series), true);
  });
});

describe("website-21: WIRING-POLISH", () => {
  test("1: the categories row carries the scroll hint", () => {
    assert.match(page, /import \{ useScrollEdges \} [f]rom "\.\.\/_components\/useScrollEdges";/);
    assert.match(page, /const catHint = useScrollEdges<HTMLElement>\(\[cats\.length, flow, step, guide\.pairKind\]\);/);
    assert.match(page, /<nav ref=\{catHint\.ref\} onScroll=\{catHint\.onScroll\} aria-label="Categories" role="tablist" className=\{`bt-tabs md:flex-col md:overflow-visible \$\{catHint\.className\}`\}/);
  });
  test("2: the sticky bar sits the tab bar's height above the bottom, on an opaque ground", () => {
    assert.match(steps, /sticky bottom-\[calc\(var\(--bt-tabbar-h,62px\)\+env\(safe-area-inset-bottom\)\+10px\)\] z-20 -mx-1 rounded-lg bg-neutral-950 px-1/);
    assert.doesNotMatch(steps, /bg-neutral-950\/95 px-1 py-2/);
    assert.match(read("config/public-repo/overlay/src/app/globals.css"), /--bt-tabbar-h: 62px;/);
  });
});

describe("website-21: audit 7 items 15 and 16", () => {
  test("15: a rejected image offers to keep the generated art; an image being prepared offers Cancel; never 'Remove the image'", () => {
    const pf = read("src/app/burnticker/launch/ProfileFields.tsx");
    assert.doesNotMatch(pf, /!value\.image && value\.imageState[^\n]*Remove the image/, "no image on the coin, so nothing to remove");
    assert.match(pf, /\{value\.image && \(\n\s*<>[\s\S]{0,1500}>Remove the image<\/button>/, "only an image that is on the coin can be removed");
    assert.match(pf, /\{value\.imageState === "failed" \? IMAGE_KEEP_GENERATED_LABEL : IMAGE_CANCEL_LABEL\}/);
    assert.doesNotMatch(IMAGE_FAILED, /remove/i);
  });
  test("16: step 1 and the rivalry kind are radio groups with aria-checked; Skip to content lands on the wizard", () => {
    assert.match(steps, /role="radiogroup" aria-label=\{GUIDED_STEPS\[0\]\.question\}/);
    assert.match(steps, /role="radio" aria-checked=\{value === c\.id\} data-decision="what" data-follow-choice/);
    assert.match(steps, /role="radiogroup" aria-label=\{whichHeading\("rivalry"\)\}/);
    assert.match(steps, /role="radio" aria-checked=\{value === k\}/);
    assert.match(page, /<FollowStep search=\{searchBlock\} value=\{guide\.follow \?\? prevFollow\}/); assert.match(page, /<RivalryKindStep value=\{guide\.pairKind\}/);
    // prelaunch audit 2026-10-18 A-29: one skip link per page, the root layout's; the launch layout adds none
    assert.doesNotMatch(read("src/app/burnticker/launch/layout.tsx"), /<a className="bt-skip"/);
    assert.equal((read("config/public-repo/overlay/src/app/layout.tsx").match(/<a className="bt-skip" href="#bt-content">Skip to content<\/a>/g) ?? []).length, 1);
    assert.match(page, /<main id="launch-main" tabIndex=\{-1\}/);
    // the "?" buttons: the shared 44 px hit layer and focus ring (site polish, audit 7 item 21) stay as they are
    assert.match(read("src/app/burnticker/_components/FieldHelp.tsx"), /className="bt-hit inline-flex h-5 w-5 [^"]*focus-visible:border-amber-400/);
  });
});

describe("website-21: the guided review's Ends fact", () => {
  test("a rivalry series pair's Ends fact names the one end, its sentence and the 30-day deadline; the step-2 scope line covers the third option", async () => {
    assert.match(page, /const meetingsEndFact = `\$\{MEETINGS_END_LABEL\}\. \$\{MEETINGS_END_LINE\} \$\{MEETINGS_DEADLINE_LINE\}`;/);
    assert.match(page, /\{ label: FACT_LABELS\.ends, value: meetingsOn \? meetingsEndFact :/);
    plain(`${MEETINGS_END_LABEL}. ${MEETINGS_END_LINE} ${MEETINGS_DEADLINE_LINE}`);
    const { RIVALRY_SCOPE_LINE } = await import("@/lib/burnticker/guidedLaunch");
    const { meetingsWhichCoinLine } = await import("@/lib/burnticker/guidedLaunch");
    const which = meetingsWhichCoinLine({ a: "PHIVBOS", b: "BOSVPHI", teamA: "76ers", teamB: "Celtics" });
    plain(which); assert.equal(which, "$PHIVBOS when the 76ers win a game between them, and $BOSVPHI when the Celtics win one. The winning coin also takes the other coin's share for that game.");
    assert.doesNotMatch(which, /its own pool/, "never the two-separate-coins line");
    assert.match(page, / : meetingsOn \? meetingsWhichCoinLine\(\{ a: ticker \|\| "A", b: tickerB \|\| "B", teamA: A, teamB: B \}\) : whichCoinLine/);
    plain(RIVALRY_SCOPE_LINE); assert.match(RIVALRY_SCOPE_LINE, /^One game and every game between them are linked pairs/); assert.match(RIVALRY_SCOPE_LINE, /Every loss this season makes two separate coins/);
  });
});
