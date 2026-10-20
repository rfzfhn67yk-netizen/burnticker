// WEBSITE-20 (2026-10-12): the FIX items of the guided launch (51–58, 60), passes A and B, and the page items of audits 3 and 6. Pure
// pieces are tested directly; page wiring is pinned by its source; every new sentence passes the copy lint and says no "will".
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { ruleOneLiner } from "@/lib/burnticker/coinCard";
import { tileHashInput, tileRule } from "@/lib/burnticker/derby/tile";
import { rulesSha256 } from "@/lib/burnKeeper/rules";
import type { BurnRule } from "@/lib/burnticker/rules";
import { INDEPENDENT_PAIR_LINE, TEMPLATES, pairLineFor, settingsLine } from "@/lib/burnticker/templates";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";

const cfg = loadCopyLintConfig();
const clean = (t: string) => { const r = lintCopy(t, cfg); assert.ok(r.ok, `${r.hits.map((h) => `${h.phrase} (${h.rule})`).join(", ")}\n${t}`); assert.doesNotMatch(t, /\bwill\b/i, t); };
const read = (f: string) => fs.readFileSync(f, "utf8");

describe("item 54: the flippening's cards name the event in words, both sides at both budgets", () => {
  const u = { symbol: "SOL", pyth: "a".repeat(64), pool: null, cross: "redstone:SOL", mint: "So11111111111111111111111111111111111111112" } as never, v = { symbol: "ETH", pyth: "b".repeat(64), pool: null, cross: "redstone:ETH", mint: "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs" } as never;
  for (const fraction of [1, 0.5]) {
    test(`at ${fraction * 100} %`, () => {
      const choice = { a: u, b: v, window: "daily" as const, seasonDays: 30, flip: true, fraction, now: Date.parse("2026-10-12T00:00:00Z") };
      const m = tileRule(choice, rulesSha256(tileHashInput(choice)), { a: "SOLVETH", b: "ETHVSOL" });
      assert.deepEqual(m.problems, []);
      const a = m.rule!, b = { ...a, binary: { onYes: null, onNo: a.binary!.onYes } } as BurnRule;
      const la = ruleOneLiner(a), lb = ruleOneLiner(b);
      for (const l of [la, lb]) { assert.doesNotMatch(l, /coinvs:|mcap-flip|[0-9a-f]{10}/, l); clean(l); }
      assert.match(la, /SOL's market cap passes ETH's/); assert.match(lb, /SOL's market cap never passes ETH's/);
      if (fraction === 1) { assert.match(la, /^burns everything if /); assert.match(la, /after the run ends/); }
    });
  }
});

describe("item 55: Coin vs Coin keeps a share per mode", () => {
  test("the tile stores the daily and the flippening share apart; switching never resets either", () => {
    const tile = read("src/app/burnticker/launch/CoinVsCoinTile.tsx");
    assert.match(tile, /useState<\{ daily: number; flip: number \}>/);
    assert.doesNotMatch(tile, /setFraction\(flip \? DEFAULT_SHARE\.oneShot : DEFAULT_SHARE\.recurring\)/);
  });
});

describe("items 51, 57 and 60: the templates gallery", () => {
  test("pair lines follow the real pairing; each card says what it lets you change and where its link lands", () => {
    assert.equal(TEMPLATES.find((t) => t.id === "election-pair")!.pairLine, pairLineFor("race"), "owner 2026-10-13: the election pair is a linked pair");
    void INDEPENDENT_PAIR_LINE;
    for (const t of TEMPLATES) { clean(settingsLine(t)); assert.ok(t.cta && !/Start from this/.test(t.cta), t.id); clean(t.cta); }
    assert.match(settingsLine(TEMPLATES.find((t) => t.id === "flippening")!), /Fixed on the web/);
    const g = read("src/app/burnticker/templates/page.tsx");
    assert.doesNotMatch(g, /Every dial stays editable/);
    assert.match(g, /\{t\.cta\} →/);
  });
});

describe("audit 7 item 8: pair names never stop mid-word", () => {
  test("a long pair falls back to the short form, whole words, at most 32 bytes", async () => {
    const { pairNames } = await import("@/lib/burnticker/guidedLaunch");
    assert.deepEqual(pairNames("Guardians", "Rays"), { a: "Guardians vs Rays", b: "Rays vs Guardians" });
    assert.deepEqual(pairNames("WIF", "BONK"), { a: "WIF vs BONK, WIF side", b: "BONK vs WIF, BONK side" });
    const long = pairNames("Timberwolves", "Trail Blazers Portland");
    for (const n of [long.a, long.b]) { assert.ok(new TextEncoder().encode(n).length <= 32, n); assert.doesNotMatch(n, /\s$/); }
    // QA pass 9 #15 (sources-6): a cut team name is not a name ("Leeds United vs Manchester"); with no short code the side keeps its own whole name
    assert.equal(long.a, "Timberwolves");
    assert.equal(pairNames("Timberwolves", "Trail Blazers Portland", { a: "MIN", b: "POR" }).a, "Timberwolves vs POR");
  });
});

describe("review 8 F3 / audit 7 item 10: the election pair says the same thing everywhere", () => {
  // owner 2026-10-13: two candidates in one race are ONE linked pair (the only form); the step-2 picker's words are the launch page's
  // (WIRING-SETTLED-PAIRS.md), so this checks the library's copy: the template, the burn step, the facts and the review sentence agree
  test("the template, the burn step, the facts and the review: one linked pair, the winner's coin takes the loser's pool", async () => {
    const { PATTERN_REASON, candidateFacts } = await import("@/lib/burnticker/guidedLaunch");
    const { CANDIDATES_PAIR_SENTENCE } = await import("@/lib/burnticker/describe");
    const t = TEMPLATES.find((x) => x.id === "election-pair")!;
    const f = candidateFacts({ a: "ELSA", b: "ROGE", candA: "El-Sayed", candB: "Rogers" });
    assert.equal(t.pairLine, CANDIDATES_PAIR_SENTENCE);
    for (const s of [t.example, t.pairLine!, f.pays, f.moves]) assert.match(s, /pool/, s);
    assert.match(t.example, /two markets, one race/i); assert.match(settingsLine(t), /burns once/);
    assert.match(PATTERN_REASON.candidatesLinked, /linked pair/); assert.match(f.moves, /\$DEFICIT's burn/);
    assert.match(read("src/app/burnticker/launch/page.tsx"), /durations=\{pairOn && !elPick && !meetingsOn \?/, "item 52: no 'this season' on an election pair (website-21: nor on a rivalry series pair)");
  });
});

describe("the FIX sentences and the new copy, each lint-clean", () => {
  test("items 53, 56 and 58; the five facts; what to know first; the rivalry panel; the lookup", async () => {
    const g = await import("@/lib/burnticker/guidedLaunch");
    const { firstPartyRule } = await import("@/lib/burnticker/wizard");
    const { nwsSeries } = await import("@/lib/burnticker/sources/nws");
    const { DEFAULT_ON_END } = await import("@/lib/burnticker/rules");
    // 58: a coin with no end says what it does, and shows no end as "this coin's end"
    const wx = { ...firstPartyRule(nwsSeries("high", "DTW", 90), 0.02), onEnd: { ...DEFAULT_ON_END } } as BurnRule;
    const end = g.endSentences(wx);
    // WIRING-PARITY audit 6 #3: the sentence is describe.ts endText's; no end is offered as this coin's end
    assert.deepEqual(end.sentences, ["This coin has no end date and does not retire."]); assert.deepEqual(end.options, []);
    assert.doesNotMatch(g.PERPETUAL_END_LINE, /DEFICIT|no end date, so it never/);
    // 56
    assert.match(g.PATTERN_REASON.derbyFade, /^On a valid, non-tied result/); assert.doesNotMatch(g.PATTERN_REASON.derbyFade, /no day where nothing happens/);
    // 53
    const auth = g.electionAuthorityLines("the Michigan Secretary of State's certified results");
    assert.equal(auth.length, 3); assert.match(auth[0], /Polymarket's own rules name who calls the race/); assert.match(auth[1], /^The Michigan Secretary of State's certified results is the official count/); assert.match(auth[2], /dispute window, about 2 hours/);
    const all = [...auth, g.PERPETUAL_END_LINE, g.PATTERN_REASON.derbyFade, ...g.upfrontLines(["40", "60", "85"]), g.NOTE_LABEL, g.NOTE_HELP, g.NOTE_VS_DESCRIPTION, g.RIVALRY_GAME_LINE, g.RIVALRY_SEASON_LINE, g.RIVALRY_SCOPE_LINE, g.SCHEDULE_UNAVAILABLE_LINE, g.NO_LISTED_MEETING_LINE, g.RIVAL_SAME_TEAM, g.scheduleCoverageLine(0), g.scheduleCoverageLine(1), g.scheduleCoverageLine(3), g.shareExample(0.02), g.derbyShareLine(0.02, 1), g.costLine("0.0569", 1), g.costLine(null, 2), g.whichCoinLine("LAD", null), g.whichCoinLine("A", "B"), g.walletAddressProblem("not-a-wallet")!, g.walletAddressProblem("")!, g.DRAFT_ROUTE_LINE, g.LOOKUP_LABEL];
    for (const s of all) clean(s);
    for (const s of g.upfrontLines(["40", "60", "85"])) assert.doesNotMatch(s, /\b20\d\d\b/, "no dates");
    // the cap line agrees with the program's constants (capInForce.ts)
    const { DEFAULT_BURN_POOL_CAP_LAMPORTS, CAP_TIMELOCK_SECS } = await import("@/lib/burnReceipts/constants");
    assert.equal(BigInt(g.PRE_AUDIT_CAP_SOL_TEXT) * BigInt(1_000_000_000), BigInt(DEFAULT_BURN_POOL_CAP_LAMPORTS)); assert.equal(CAP_TIMELOCK_SECS, 48 * 3600);
    assert.equal(g.NOTE_VS_DESCRIPTION.includes("280"), true); const { DESCRIPTION_MAX } = await import("@/lib/burnticker/creatorProfile"); assert.equal(DESCRIPTION_MAX, 280);
  });
  test("item 103: the lookup checks the address and says what it expects", async () => {
    const g = await import("@/lib/burnticker/guidedLaunch");
    assert.equal(g.walletAddressProblem("So11111111111111111111111111111111111111112"), null);
    assert.match(g.walletAddressProblem("not-a-wallet")!, /not a wallet address/);
    const me = read("src/app/burnticker/me/page.tsx");
    assert.match(me, /onSubmit=\{\(e\) => \{ e\.preventDefault\(\); lookUp\(\); \}\}/); assert.match(me, /onBlur=/); assert.match(me, /aria-describedby="me-wallet-status"/); assert.match(me, /<label htmlFor="me-wallet"/);
  });
  test("item 102: the note has a label tied to it and its help text", () => {
    const card = read("src/app/burnticker/launch/ReviewCard.tsx");
    assert.match(card, /<label htmlFor=\{noteId\}[^>]*>\{NOTE_LABEL\}<\/label>/); assert.match(card, /<textarea id=\{noteId\}[^>]*aria-describedby=\{`\$\{noteId\}-help`\}/);
  });
  test("item 119: a league page's team link opens the team path on that league with the team picked", async () => {
    const { launchHref } = await import("@/lib/burnticker/leagues");
    assert.equal(launchHref("Los Angeles Dodgers", "mlb", "LAD"), "/burnticker/launch?league=mlb&team=LAD");
    assert.match(read("src/app/burnticker/launch/page.tsx"), /if \(q0\.get\("league"\)\) \{ setGuide\(\{ follow: "team", phase: "which", pairKind: null \}\);/);
  });
  test("item 120 (verify): Launch one like this copies the rule's shape only, never links, a note, art or a wallet", () => {
    const page = read("src/app/burnticker/launch/page.tsx");
    const like = page.slice(page.indexOf("} else if (like) {"), page.indexOf("// intent audit 5 item 17"));
    assert.ok(like.length > 100);
    assert.doesNotMatch(like, /setProfile|setNote|setLink|setXUrl|setTg|setImageUrl|setDescription|setPasted|setName\(|setTicker\(/);
    assert.match(like, /setPendingDials\(\{ fraction: d\.fraction, side: [^}]*inverse: !!d\.inverse\?\.on \}\)/);
  });
  test("items 151, 153, 154, 155, 156: the rivalry panel and the share row (source pins)", () => {
    const page = read("src/app/burnticker/launch/page.tsx"), steps = read("src/app/burnticker/launch/GuidedSteps.tsx"), card = read("src/app/burnticker/launch/ReviewCard.tsx");
    assert.match(page, /const other = \(t: Team \| null\) => !!t && !!t\.league && !!leagueSeries && t\.league !== leagueSeries;/);
    assert.match(page, /schedFailed \? <span[^>]*data-schedule-unavailable>\{rvNow\?\.scheduleNote \?\? SCHEDULE_UNAVAILABLE_LINE\} <button[^>]*onClick=\{\(\) => setRivalryRetry\(\(n\) => n \+ 1\)\}>Retry<\/button>/);
    assert.match(page, /\}, \[flow, leagueSeries, gameQ, gamesRetry\]\);/);
    assert.match(page, /if \(rivalB\?\.abbr === t\.abbr\) \{ setRivalB\(null\); setRivalNote\(RIVAL_SAME_TEAM\); \}/);
    assert.match(page, /onClick=\{\(\) => chooseRivals\(rivalA, rivalB, "game", m\)\}/);
    assert.match(card, /const showMore = moreShares;/); assert.match(steps, /onClick=\{\(\) => setMore\(!more\)\}/);
  });
});

describe("item 253 on the launch page: a prepare answer for an older draft sets no plan and never reaches the wallet", () => {
  test("a delayed answer after an edit is stale; the page applies plans only through prepareIfCurrent, and the sign card names the tickers sent", async () => {
    const { prepareIfCurrent } = await import("@/lib/burnticker/preparedLaunch");
    let rev = "r1"; let applied = false;
    const slow = prepareIfCurrent("r1", () => rev, async () => { await new Promise((r) => setTimeout(r, 20)); return () => { applied = true; }; });
    rev = "r2";   // the creator edits the ticker while the request is in flight
    const out = await slow;
    assert.ok("stale" in out); assert.equal(applied, false);
    const page = read("src/app/burnticker/launch/page.tsx");
    const body = page.slice(page.indexOf("const launch = useCallback"), page.indexOf("// ---- navigation"));
    // 2026-10-14 night: the prepare runs inside withMintSource (the server's mint key first, the browser search on mint-bank-empty);
    // LA6-4 (2026-10-19): through withKeptMint, which uses a key kept in this tab first and otherwise is withMintSource
    assert.match(body, /const out = await prepareIfCurrent\(sentRev, \(\) => curDraft\.current, \(\) => withKeptMint\(keptMint, \{[^}]*\}, async \(keys: GroundMint\[\] \| null\): Promise<\(\) => void> => \{/);
    assert.match(body, /if \("stale" in out\) \{ setLaunchErr\(STALE_PREPARE_SENTENCE\); return; \}\s*out\.ok\(\); setSignTickers\(sent\);\s*setStep\("launch"\);/);
    assert.doesNotMatch(body.slice(body.indexOf("prepareIfCurrent")), /^\s*setBundle\(\(await post/m, "no state is set inside the request itself");
    assert.match(page, /title=\{two \? `Launch \$\$\{st\.a\} and \$\$\{st\.b\}` : `Launch \$\$\{st\.a\}`\}/);
    assert.match(page, /profileRevision\(profile\), pairOn \? profileRevision\(profileB\) : ""\], reviewIdentity\(creator, sentProof\)\);/);   // audit 7 F03: and who asks
  });
});

describe("WIRING-PARITY audit 7 #3: a refused link blocks Launch", () => {
  test("the page joins creatorLinks' problems to the profile's, and sends the links to the review", () => {
    const page = read("src/app/burnticker/launch/page.tsx");
    // website-22 (QA 9 item 11): ProfileFields' profileFieldProblems runs creatorProfile.ts linkProblem per field (the server's own check),
    // and the name step and the review list the same blockers, each with the field it belongs to
    const fields = read("src/lib/burnticker/guidedLaunch.ts");
    assert.match(fields, /for \(const \[k, label\] of LINK_FIELDS\) \{ const lp = linkFieldProblem\(label, v\[k\]\); if \(lp\) out\.push\(\{ field: k, text: lp \}\); \}/);
    assert.match(fields, /export const linkFieldProblem = \(label: string, raw: string\): string \| null => \(raw\.trim\(\) \? linkProblem\(label, raw\.trim\(\)\) : null\);/);
    // website-25: through fieldChecks.ts profileIssues (profileFieldProblems plus the description's wording rules)
    assert.match(page, /issuesA = profileIssues\(profile, genA\)/); assert.match(page, /\.\.\.issuesA\.map\(\(x\) => \(\{ text: `\$\{sideTag\("a"\)\}\$\{x\.text\}`/);
    assert.match(page, /profileProblems=\{nameBlockers\}/);   // prelaunch audit 2026-10-18: the name step's list without the ticker problem said under the field assert.match(page, /profileProblems=\{allBlockers\}/);
    assert.match(page, /links: creatorLinks\(\{ x: profile\.x, telegram: profile\.telegram, website: profile\.website \}\)\.links/);
  });
});
