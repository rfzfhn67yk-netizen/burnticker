// SOURCES-7 (QA walkthrough 11 H2 and H3): the series pair's generated paragraph leaves room for the creator's own 280 characters for
// every league's longest team names, the Name step reports the room, and the linked pair's money path states the same fee split as the
// review's fee table (one source: fees.ts postGraduationFeesFor), never the pair curve's split and never a "creator fee".
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { buildLaunchReview } from "@/lib/burnticker/launchReview";
import { meetingsPairRules, profileFieldProblems } from "@/lib/burnticker/guidedLaunch";
import { describeRule, meetingsTicker, PAIR_DESCRIPTION_SENTENCE } from "@/lib/burnticker/describe";
import { LEAGUES, teamsOf, type LeagueId } from "@/lib/burnticker/sources/espn";
import { DESCRIPTION_LIMIT } from "@/lib/burnticker/launchBundle";
import { CREATOR_TEXT_SEPARATOR, DESCRIPTION_MAX, descriptionRoom } from "@/lib/burnticker/creatorProfile";
import { meetingsFundsFlow, settledPairFundsFlow, pairFundsFlow } from "@/lib/burnticker/pairFundsFlow";
import { postGraduationFeesFor } from "@/lib/burnticker/fees";
import { postGraduationShareLine, sharesForCluster } from "@/lib/burnticker/feeShareLine";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";

const cfgLint = loadCopyLintConfig();
const lint = (t: string) => { const r = lintCopy(t, cfgLint); assert.ok(r.ok, `${r.hits.map((h) => `${h.phrase} (${h.rule})`).join(", ")}\n${t}`); };
const ENV = { BURNTICKER_CLUSTER: "devnet", BURNTICKER_CREATOR_LAUNCHES_ENABLED: "1" } as Record<string, string>;
const MAIN = { BURNTICKER_CLUSTER: "mainnet", BURNTICKER_CREATOR_LAUNCHES_ENABLED: "1" } as Record<string, string>;
const RNOW = Date.parse("2026-10-13T12:00:00Z");
const arsTot = () => { const r = meetingsPairRules("eng.1", "ARS", "TOT", 2026); return { rule: r.a, ticker: "ARSVTOT", name: "Arsenal vs Tottenham Hotspur", pair: { ticker: "TOTVARS", name: "Tottenham Hotspur vs Arsenal" } }; };
const asPair = (rule: unknown) => ({ ...(rule as object), pair: { pairId: "x", side: "A", counterpartMint: null, winnerTakesBurn: true } }) as never;

describe("H2: the series pair's generated paragraph always leaves room for the creator's text", () => {
  test("Arsenal vs Tottenham Hotspur with an empty description, and with a full 280-character one, has no description problem", () => {
    for (const creatorDescription of ["", "x".repeat(DESCRIPTION_MAX)]) {
      const v = buildLaunchReview({ ...arsTot(), creatorDescription } as never, { env: ENV, now: RNOW });
      assert.ok("review" in v);
      assert.deepEqual(v.review.problems.filter((p) => /description/i.test(p)), [], v.review.problems.join("\n"));
      assert.equal(v.review.coins[0].descriptionRoom, DESCRIPTION_MAX);
      assert.equal(v.review.coins[1].descriptionRoom, DESCRIPTION_MAX);
    }
  });
  test("for every league, the two longest team names build a series pair whose paragraph (each side) leaves the creator's whole 280", () => {
    let checked = 0;
    for (const lg of Object.keys(LEAGUES) as LeagueId[]) {
      let ts; try { ts = teamsOf(lg); } catch { continue; }
      if (ts.length < 2) continue;
      const [a, b] = [...ts].sort((x, y) => y.nickname.length - x.nickname.length).slice(0, 2);
      let r; try { r = meetingsPairRules(lg, a.abbr, b.abbr, 2026); } catch { continue; }
      for (const [rule, t] of [[r.a, meetingsTicker(a.abbr, b.abbr, lg)], [r.b, meetingsTicker(b.abbr, a.abbr, lg)]] as const) {
        const p = describeRule(asPair(rule), { ticker: t }).paragraph;
        assert.ok(p.length + CREATOR_TEXT_SEPARATOR.length + DESCRIPTION_MAX <= DESCRIPTION_LIMIT, `${lg} ${a.nickname} vs ${b.nickname}: ${p.length}\n${p}`);
        lint(p);
        checked++;
      }
    }
    assert.ok(checked >= 40, `${checked} sides checked`);
  });
  test("the series paragraph keeps what a holder needs: who burns, where a lost game's share goes, the draw, the level series and the season end", () => {
    const p = describeRule(asPair(arsTot().rule), { ticker: "ARSVTOT" }).paragraph;
    assert.match(p, /^\$ARSVTOT burns when Arsenal beat Tottenham Hotspur\./);
    assert.match(p, /When Tottenham Hotspur win instead, this coin's share for that game goes to the other coin's burn pool\./);
    assert.match(p, /A draw, or a postponed or cancelled game, counts for neither side\./);
    assert.match(p, /If neither team won more of these games, or the result is voided/);
    assert.match(p, /For each of those wins in the 2026–27 season, 2% of the burn pool is spent on this coin/);
        assert.match(p, /After both teams' last game, whatever is left burns the coin of the team that won more of these games/);
    assert.ok(!p.includes(PAIR_DESCRIPTION_SENTENCE), "the generic pair sentence repeats what the series sentence says");
  });
  test("the Name step reports the room: the creator's text is checked against what the rule's paragraph leaves", () => {
    assert.equal(descriptionRoom("x".repeat(1300)), DESCRIPTION_LIMIT - 1300 - CREATOR_TEXT_SEPARATOR.length);
    assert.equal(descriptionRoom("x".repeat(100)), DESCRIPTION_MAX);
    assert.equal(descriptionRoom("x".repeat(1600)), 0);
    const base = { image: null, rights: false, x: "", telegram: "", website: "" };
    const ps = profileFieldProblems({ ...base, description: "y".repeat(250), generated: "x".repeat(1300) });
    assert.deepEqual(ps.map((x) => x.field), ["description"]);
    assert.match(ps[0].text, /at most 198 characters/);
    lint(ps[0].text);
    assert.deepEqual(profileFieldProblems({ ...base, description: "y".repeat(250), generated: "x".repeat(400) }), []);
  });
});

describe("H3: one fee split on the review, from one source", () => {
  test("the series pair's money path states the same post-graduation split as the review's fee table (devnet and mainnet)", () => {
    for (const env of [ENV, MAIN]) {
      const v = buildLaunchReview(arsTot(), { env, now: RNOW });
      assert.ok("review" in v);
      const line = postGraduationShareLine(postGraduationFeesFor(v.review.network));
      const fees = v.review.meetings!.flow.steps.find((s) => s.title === "Where fees come from")!.text;
      assert.ok(fees.includes(line), `${v.review.network}: ${fees}\nexpected ${line}`);
      assert.doesNotMatch(fees, /creator fee/i, "creators take no fee; the sentence must not call it one");
      lint(fees);
    }
  });
  test("mainnet (new coins, tier 14): about 0.98% to the burn pool and Raydium about 0.15%, never the pair curve's own split, on the series and settled pairs", () => {
    const main = postGraduationShareLine(sharesForCluster("mainnet"));
    assert.match(main, /about 0\.98%.*about 0\.15%/);
    const pairLine = postGraduationShareLine(sharesForCluster("mainnet", { pair: true }));
    for (const f of [meetingsFundsFlow({ a: "A", b: "B" }, { a: "Arsenal", b: "Tottenham Hotspur" }), settledPairFundsFlow("game", { a: "A", b: "B" }, { a: "Arsenal", b: "Tottenham Hotspur" }), settledPairFundsFlow("candidates", { a: "A", b: "B" }, { a: "X", b: "Y" })]) {
      const t = f.steps[0].text;
      assert.ok(t.includes(main), t);
      assert.ok(!t.includes(pairLine), t);
      assert.doesNotMatch(t, /creator fee/);
    }
    // the pair curve's own coins keep the pair curve's split (its pools open with Raydium's creator fee off)
    assert.ok(pairFundsFlow("winner-takes-the-burn").steps[0].text.includes(postGraduationShareLine(sharesForCluster("mainnet", { pair: true }))));
  });
});
