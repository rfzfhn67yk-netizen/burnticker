// HOTFIX on publish 18 (2026-10-12): the owner's "easier to follow" pass, the 25 % recurring cap, "Launch a coin" back to step 1, four
// review items (13, 17, 19, 43) and ChatGPT launch-intent audit 5 items 3, 4, 5, 11, 12, 14 to 20. Pure pieces are run; page wiring is
// pinned by its source (the suite has no browser), and the copy is linted.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DEFAULT_ON_END, lockRule, type BurnRule } from "@/lib/burnticker/rules";
import { firstPartyRule } from "@/lib/burnticker/wizard";
import { teamSeries } from "@/lib/burnticker/sources/espn";
import { nwsSeries } from "@/lib/burnticker/sources/nws";
import { describeRule } from "@/lib/burnticker/describe";
import { dialsFor, applyDial } from "@/lib/burnticker/dials";
import { DEFAULT_SHARE, MAIN_RECURRING, SHARE_PRESETS, SLICED_ABOVE, presetProblem } from "@/lib/burnticker/launchPresets";
import { counterRule } from "@/lib/burnticker/program";
import { buildLaunchReview } from "@/lib/burnticker/launchReview";
import { FOLLOW_CHOICES, GUIDED_STEPS, IMAGE_NOT_KEPT, MARKET_NO_SENTENCE, endSentences, oneShotSentences, patternOptions } from "@/lib/burnticker/guidedLaunch";
import { teamAdvancedDefaults } from "@/lib/burnticker/creatorCopy";
import { createLatest, applyLatest } from "@/lib/burnticker/latestOnly";
import { announceLaunchStart, LAUNCH_START_EVENT } from "@/lib/burnticker/launchStart";
import { CREATOR_LAUNCHES_FLAG } from "@/lib/burnticker/creatorLaunches";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";

const read = (f: string) => fs.readFileSync(f, "utf8");
const page = read("src/app/burnticker/launch/page.tsx"), steps = read("src/app/burnticker/launch/GuidedSteps.tsx"), card = read("src/app/burnticker/launch/ReviewCard.tsx"), fields = read("src/app/burnticker/launch/ProfileFields.tsx"), tile = read("src/app/burnticker/launch/CoinVsCoinTile.tsx");
const cfg = loadCopyLintConfig();
const clean = (t: string) => { const r = lintCopy(t, cfg); assert.ok(r.ok, `${r.hits.map((h) => h.phrase).join(", ")}: ${t}`); };
const env = { BURNTICKER_CLUSTER: "mainnet", [CREATOR_LAUNCHES_FLAG]: "1" };
const season = (f = 0.02) => ({ ...firstPartyRule(teamSeries("mlb", "LAD", "win", { kind: "season", year: 2026 }), f), onEnd: { ...DEFAULT_ON_END } }) as BurnRule;
const poly = (side: "yes" | "no" = "yes"): BurnRule => ({ schema: "burnticker.rules/v1", oracle: "polymarket", series: null, market: "0x" + "ab".repeat(32), filter: {}, kind: "binary", binary: side === "yes" ? { onYes: { fractionOfPool: 1 }, onNo: null } : { onYes: null, onNo: { fractionOfPool: 1 } }, scalar: null, onVoid: "skip", floorUsd: "1", reserveSol: "0.02", vault: null, onEnd: { ...DEFAULT_ON_END } } as BurnRule);

describe("the owner: easier to follow", () => {
  test("a progress strip of five short labels, answered ones showing the choice and going back on a tap", () => {
    assert.deepEqual(GUIDED_STEPS.map((s) => s.short), ["Follows", "Which", "Burns", "Name", "Review"]);
    assert.match(steps, /const text = done && a \? `\$\{st\.short\}: \$\{a\}` : st\.short;/);
    assert.match(steps, /onClick=\{\(\) => onJump\(st\.id\)\}/); assert.match(steps, /aria-current=\{cur \? "step" : undefined\}/);
    assert.match(page, /follow: guide\.follow === "disaster" \? HAZARD_FOLLOW\.label\.toLowerCase\(\) : FOLLOW_CHOICES\.find\(\(c\) => c\.id === guide\.follow\)\?\.label\.toLowerCase\(\)/);
  });
  test("step 1's cards are a title and one line (the examples behind one disclosure); every choice is a named button with a focus ring", () => {
    for (const c of FOLLOW_CHOICES) { assert.ok(c.line.length <= 46, c.line); clean(c.line); }
    assert.match(steps, /data-follow-choice=\{c\.id\} aria-label=\{c\.label\}/);
    assert.match(steps, /focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400/);
    assert.match(steps, /<summary className="cursor-pointer">Examples<\/summary>/);
    // a read-page style query by name finds each choice: the accessible name is the title
    const names = [...steps.matchAll(/aria-label=\{(c|o)\.label\}/g)].length;
    assert.ok(names >= 2, "step 1 and step 3 choices are named");
    for (const n of ["Team", "Event outcome", "Published data", "Coin comparison", "Rivalry"]) assert.ok(FOLLOW_CHOICES.some((c) => c.label === n), n);
    assert.match(page, /aria-label=\{t\.name\} aria-pressed=\{team\?\.abbr === t\.abbr\}/, "step 2's team buttons are named");
  });
  test("the step's one action stays in view above the tab bar; the ticker strip is off on the launch page", () => {
    assert.match(steps, /sticky bottom-\[calc\(72px\+env\(safe-area-inset-bottom\)\)\]/, "64 px tab bar plus 8 px");
    assert.match(page, /const nextBtn = \(label: string, to: GuidedPhase\) => <StickyAction>/);
    assert.match(read("src/app/burnticker/_components/SiteHeader.tsx"), /\{pathname\?\.startsWith\("\/burnticker\/launch"\) \? null : <ActivityTicker \/>\}/);
  });
  test("'Launch a coin' while on the page goes back to step 1 and keeps the draft (the draft line offers Resume)", () => {
    const events: string[] = [];
    const w = { location: { pathname: "/burnticker/launch" }, dispatchEvent: (e: Event) => { events.push(e.type); return true; } };
    assert.equal(announceLaunchStart("/burnticker/launch", w), true); assert.deepEqual(events, [LAUNCH_START_EVENT]);
    assert.equal(announceLaunchStart("/burnticker/launch", { ...w, location: { pathname: "/burnticker" } }), false, "from another page the link navigates as usual (the page opens at step 1)");
    assert.match(page, /window\.addEventListener\(LAUNCH_START_EVENT, h\)/);
    assert.match(page, /setGuide\(\{ follow: null, phase: "follow", pairKind: null \}\); setStep\("choose"\);/);
    assert.match(read("src/app/burnticker/_components/TabBar.tsx"), /onClick=\{\(\) => announceLaunchStart\(t\.href\)\}/);
    assert.match(read("src/app/burnticker/_components/SiteHeader.tsx"), /data-launch-button onClick=\{\(\) => announceLaunchStart\("\/burnticker\/launch"\)\}/);
  });
});

describe("the owner: recurring rules up to 25 %", () => {
  test("five presets, 2 % the default, 1, 2 and 5 on the row with 10 and 25 behind More", () => {
    assert.deepEqual(SHARE_PRESETS.recurring, [0.01, 0.02, 0.05, 0.1, 0.25]); assert.equal(DEFAULT_SHARE.recurring, 0.02);
    assert.deepEqual([...MAIN_RECURRING], [0.01, 0.02, 0.05]);
    assert.equal(dialsFor(season()).bounds.max, 0.25);
    assert.match(card, /data-share-more>\{showMore \? "Less" : "More"\}<\/button>/);
  });
  test("above 5 % the rule says the burn lands in slices; the review accepts 10 and 25 % and the pinned fraction is 1000 and 2500 bps", () => {
    assert.equal(SLICED_ABOVE, 0.05);
    const ten = describeRule(firstPartyRule(nwsSeries("high", "DEN", 90), 0.1), { ticker: "DENHOT" });
    assert.match(ten.lead, /in slices sized to the pool's liquidity/); clean(ten.paragraph);
    assert.doesNotMatch(describeRule(firstPartyRule(nwsSeries("high", "DEN", 90), 0.05), { ticker: "DENHOT" }).lead, /slices/);
    assert.match(describeRule(season(0.25), { ticker: "LAD" }).ruleBlock, /Each burn buys \$LAD on Raydium in slices sized to the pool's liquidity\./);
    for (const [f, bps] of [[0.1, 1000], [0.25, 2500]] as const) {
      const r = { ...firstPartyRule(nwsSeries("high", "DEN", 90), f), onEnd: { ...DEFAULT_ON_END } } as BurnRule;
      assert.equal(presetProblem(r), null);
      const v = buildLaunchReview({ rule: r, ticker: "DENHOT", name: "Denver Heat" }, { env, reserved: new Set() });
      assert.ok("review" in v); assert.equal(v.review.problems.length, 0, v.review.problems.join(" | "));
      assert.equal(counterRule(lockRule(r).rule, "DENHOT", "nws.high:DEN-90", { floorLamports: BigInt(0) }).rule.fraction_per_unit_bps, bps);
    }
    assert.match(page, /shareValue > SLICED_ABOVE && !\/in slices sized\/\.test\(sentence0\)/);
  });
});

describe("review items 13, 17, 19 and 43", () => {
  test("13: a one-time market's 'does not happen' is once, on a NO payout, in the option, the preview and the pinned rule", () => {
    const o = patternOptions({ follow: "market", rule: poly() }).options.find((x) => x.id === "fade")!;
    assert.equal(o.sentence, MARKET_NO_SENTENCE); assert.doesNotMatch(o.sentence, /each day|reading/); clean(MARKET_NO_SENTENCE);
    const t = describeRule(poly("no"), { ticker: "LADNO", eventPhrase: "the Dodgers win the 2026 World Series" });
    // the pinned NO rule (describe.ts, intent audit round 2): once, on a NO payout; a void never counts as a NO
    assert.match(t.oneLiner, /^burns if the Polymarket market settles NO, meaning the Dodgers did NOT win the 2026 World Series$/);
    assert.match(t.ruleBlock, /once, with a receipt on chain/); assert.match(t.ruleBlock, /voided or cancelled market never cou/);
    assert.deepEqual(oneShotSentences({ share: 1, happened: "the Dodgers did not win the World Series", subject: "they", no: true }).slice(-1), ["If they do, the rest goes to $DEFICIT's burn. A voided market is not a NO."]);
  });
  test("17: the champion path's end shows the champion, not-champion and void branches from the rule", () => {
    const e = endSentences(season(), { team: "the Dodgers" });
    const opt = e.options.find((o) => o.kind === "flagship")!;
    assert.match(opt.label, /If the Dodgers win the championship, the rest of the pool burns here\. If they do not, the rest goes to \$DEFICIT's burn\. If the result is voided/);
  });
  test("19: an exact market starts at 100 %, and a share that is not a one-shot preset goes to 100 %, never the nearest", () => {
    assert.match(page, /setKind\("binary"\); setBurnOn\("yes"\); setOnYes\(DEFAULT_SHARE\.oneShot\);/);
    assert.match(page, /const sn = oneShotRule \? \{ value: DEFAULT_SHARE\.oneShot, changed: true \} : snapToPreset\(curDials\.fraction, "recurring"\);/);
  });
  test("43: Advanced reads the current description and links", () => {
    const none = teamAdvancedDefaults({ sharePct: "2%", raiseSol: "85", minForwardSol: "0.05" });
    assert.match(none[4], /There is no extra description and there are no links\./);
    const some = teamAdvancedDefaults({ sharePct: "2%", raiseSol: "85", minForwardSol: "0.05", profile: { image: true, description: true, links: 2 } });
    assert.equal(some[4], "The image is the one you added above. Your description follows the rule sentence, and 2 links are shown on the coin's page.");
    assert.match(teamAdvancedDefaults({ sharePct: "2%", raiseSol: "85", minForwardSol: "0.05", profile: { image: false, description: false, links: 1 } })[4], /One link is shown on the coin's page\./);
    for (const x of [...none, ...some]) clean(x);
  });
});

describe("launch-intent audit 5", () => {
  test("3: a long name never hides the ticker (only the name truncates)", () => {
    assert.match(read("src/app/burnticker/_components/CoinCard.tsx"), /<span className="min-w-0 truncate">\{c\.name \|\| "Coin name"\}<\/span> <span className="shrink-0 font-mono text-sm text-neutral-400">\$\{c\.ticker \|\| "TICKER"\}<\/span>/);
  });
  test("4: a game's start is labelled as its start, not its result", () => {
    assert.match(page, /starts \$\{denver\(t\.next\.expectedAt\)\}/); assert.match(page, /starts \{denver\(g\.expectedAt\)\}, result after the final/);
    assert.doesNotMatch(page, /result ~\$\{denver\(t\.next\.expectedAt\)\}/);
  });
  test("5: chosen leagues, categories and race types say so to assistive technology", () => {
    assert.match(page, /aria-pressed=\{leagueSeries === l\.id\}/); assert.match(page, /role="tab" aria-selected=\{cat === c\.id\}/); assert.match(page, /aria-pressed=\{etype === t\.id\}/);
  });
  test("11, 12, 18: the draft keeps the profile's words and links, the raise, the election pair and the rivalry teams; an image is said to be gone", () => {
    assert.match(page, /const snapshot = JSON\.stringify\(\{ guide, raiseSol, elPick, rivalA, rivalB, rivalGame, rivalSeason, profileText: \{ description: profile\.description, x: profile\.x, telegram: profile\.telegram, website: profile\.website, hadImage: !!profile\.image \}/);
    assert.match(page, /set\("raiseSol", \(v: string\) => \{ if \(isRaisePreset\(v\)\) setRaiseSol\(v\); \}\);/);
    assert.match(page, /set\("elPick", setElPick\);/);
    // the round trip the restore runs: what the snapshot stores is what it applies
    const draft = JSON.parse(JSON.stringify({ raiseSol: "40", profileText: { description: "Go Dodgers.", x: "https://x.com/a", telegram: "", website: "", hadImage: true } }));
    assert.equal(draft.raiseSol, "40"); assert.equal(draft.profileText.description, "Go Dodgers."); assert.equal(draft.profileText.hadImage, true);
    assert.equal(IMAGE_NOT_KEPT, "A saved draft does not keep an image. Add it again if you want one."); clean(IMAGE_NOT_KEPT);
  });
  test("14 and 16: only the newest answer applies, whatever order the answers arrive in; a removal makes every answer stale", async () => {
    const l = createLatest(), got: string[] = [];
    let release: Record<string, () => void> = {};
    const slow = (v: string) => () => new Promise<string>((res) => { release[v] = () => res(v); });
    const p1 = applyLatest(l, slow("first"), (v) => got.push(v)), p2 = applyLatest(l, slow("second"), (v) => got.push(v));
    release.second(); release.first();
    assert.deepEqual(await Promise.all([p1, p2]), [false, true]); assert.deepEqual(got, ["second"], "the late answer to the older question is dropped");
    release = {};
    const p3 = applyLatest(l, slow("third"), (v) => got.push(v)); l.cancel(); release.third();
    assert.equal(await p3, false); assert.deepEqual(got, ["second"], "a removed image never comes back");
    assert.match(fields, /const set = \(p: Partial<ProfileValue>\) => onChange\(\(prev\) => \(\{ \.\.\.prev, \.\.\.p \}\)\);/);
    // launch audit 219–225: the pick moved to profileImagePick.ts pickImage, which applies an answer only while its token is current
    assert.match(fields, /void pickImage<ProfileValue>\(f, \{\s*latest, update: \(fn\) => onChange\(fn\)/);
    assert.match(read("src/lib/burnticker/profileImagePick.ts"), /if \(!current\(\)\) return "stale";\n  if \("refused" in answer\)/);
    for (const re of [/\.then\(\(j\) => \{ if \(!live\) throw new Error\("stale"\); return j; \}\)\.then\(\(j\) => \(setScheduleNote/, /getJson<ElPair>\([^)]*\)\.then\(\(j\) => \{ if \(live\) setEpair\(j\); \}\)/, /\.then\(\(j\) => \{ if \(live\) setFound\(/, /return \(\) => \{ live = false; clearTimeout\(t\); \};/]) assert.match(page, re);
  });
  test("15: an image still being prepared, or one that failed, blocks the launch until it is resolved", async () => {
    const { imageStateProblem, IMAGE_PENDING, IMAGE_FAILED } = await import("@/lib/burnticker/guidedLaunch");
    assert.equal(imageStateProblem("pending"), IMAGE_PENDING); assert.equal(imageStateProblem("failed"), IMAGE_FAILED); assert.equal(imageStateProblem(null), null);
    assert.match(fields, /const isp = imageStateProblem\(v\.imageState \?\? null\); if \(isp\) out\.push\(isp\);/, "profileProblems lists it, and the review lists profileProblems beside the button");
    clean(IMAGE_PENDING); clean(IMAGE_FAILED);
  });
  test("17: a deep link's parameters are read once and dropped, so a reload offers Resume", () => {
    assert.match(page, /if \(linked\) \{ try \{ window\.history\.replaceState\(window\.history\.state, "", window\.location\.pathname\); \}/);
  });
  test("19: the Coin vs Coin draft is versioned, kept across a refresh and Back, and cleared by Start over", () => {
    assert.match(tile, /export const CVC_STORE = "burnticker\.launch\.cvc\.v1";/);
    assert.match(tile, /const d: CvcDraft = \{ v: 1, a, b, names, fraction, shares, flip, raiseSol, edited, profA: words\(profA\), profB: words\(profB\), images: \{ a: !!profA\.image, b: !!profB\.image \} \};/);
    assert.match(tile, /if \(!d \|\| d\.v !== 1\) return;/);
    assert.match(page, /sessionStorage\.removeItem\(STORE\); sessionStorage\.removeItem\(CVC_STORE\);/);
  });
  test("20: one Start over confirmation for every path", () => {
    assert.match(page, /\{confirmOver && <p className="[^"]*" role="alert" data-start-over-confirm>/);
    assert.match(page, /onStartOver=\{\(\) => startOver\(\)\} confirm=\{null\}/);
    assert.match(page, /onClick=\{\(\) => startOver\(\)\}>start over<\/button>/, "the free-text path's button uses the same confirmation");
  });
});

// owner, 2026-10-12 evening: "whenever i type 2 letters when naming a coin it accepts those 2 letters as the name and moves on".
// The review editor opened only while a field problem or the name prompt applied, so the second letter (which satisfies the
// 2-visible-character rule) closed the fields mid-typing. Now the editor latches open and only "done" closes it.
test("review editor: once open it stays open until the creator presses done (no close on the second typed letter)", () => {
  const src = fs.readFileSync("src/app/burnticker/launch/ReviewCard.tsx", "utf8");
  assert.match(src, /const forcedOpen = fieldProblems\.length > 0 \|\| \(!!p\.namePrompt && !p\.coins\.some/);
  assert.match(src, /useEffect\(\(\) => \{ if \(forcedOpen\) setEditState\(true\); \}, \[forcedOpen\]\);/);
  assert.match(src, /const editing = editState \|\| forcedOpen;/);
  assert.doesNotMatch(src, /editState \|\| fieldProblems\.length > 0 \|\| \(!!p\.namePrompt && !editState/, "the old self-closing predicate is gone");
  // the only way the editor closes is the done button toggling editState
  assert.match(src, /onClick=\{\(\) => setEditState\(!editState\)\}/);
});

// owner, 2026-10-12 evening: a half-made coin named "Ea" kept its name on the next coin ("the name was locked on Ea"). A typed name
// or ticker now belongs to the subject it was typed for (editedFor); picking a different thing to follow regenerates both.
test("a typed name belongs to its subject: a new team / market / pair regenerates name and ticker", () => {
  const page = fs.readFileSync("src/app/burnticker/launch/page.tsx", "utf8");
  assert.match(page, /const \[editedFor, setEditedFor\] = useState<string \| null>\(null\);/);
  assert.match(page, /const subjectKey = \[flow, guide\.follow \?\? "", rule\?\.oracle \?\? "", rule\?\.market \?\? rule\?\.series \?\? "", team\?\.abbr \?\? "", sideA\?\.abbr \?\? "", sideB\?\.abbr \?\? ""\]\.join\("\|"\);/);
  assert.match(page, /if \(editedFor !== subjectKey\) \{ setNameAuto\(true\); setTickerAuto\(true\); setEditedFor\(null\); \}/);
  // every manual edit records the subject, and the draft keeps it across a reload
  assert.equal((page.match(/setNameAuto\(false\); setEditedFor\(subjectKey\)/g) ?? []).length, 2);
  assert.match(page, /setTickerAuto\(false\); setEditedFor\(subjectKey\)/);
  assert.match(page, /nameAuto, tickerAuto, editedFor, ownImage, note \}\);/);
  assert.match(page, /set\("editedFor", setEditedFor\);/);
  assert.doesNotMatch(page, /It stays when the rule changes/);
});

// owner, 2026-10-12 evening (76ers, 2027 champion): the outcome list put the name at the left and "burn if this one wins" at the far
// right with dead space between. Each row is now one full-width button that lights on hover and focus, so name and action read together.
test("outcome rows: the whole row is one button, lit on hover and focus", () => {
  const page = fs.readFileSync("src/app/burnticker/launch/page.tsx", "utf8");
  assert.match(page, /<li key=\{m\.conditionId\}><button type="button" data-decision="what" disabled=\{m\.closed\} onClick=\{\(\) => pickPoly\(m\)\} className="group flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left hover:bg-neutral-800 hover:text-neutral-100 focus-visible:bg-neutral-800/);
  assert.doesNotMatch(page, /<li key=\{m\.conditionId\} className="flex items-center justify-between gap-2"><span>/);
});
