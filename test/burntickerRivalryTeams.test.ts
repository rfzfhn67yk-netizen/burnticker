// HOTFIX (owner, live walkthrough of publish 18, 2026-10-12): "trying to set up a rivalry pair but the only options were games, not 2
// teams." A rivalry pair is a league, any two of its teams (the second list leaves out the first), then one game or the season.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DEFAULT_ON_END, type BurnRule } from "@/lib/burnticker/rules";
import { teamSeries } from "@/lib/burnticker/sources/espn";
import { describeRule } from "@/lib/burnticker/describe";
import { PATTERN_REASON, meetingOf, otherTeams, pairNames, pairTickers, patternOptions, seasonPairRules } from "@/lib/burnticker/guidedLaunch";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";

const page = fs.readFileSync("src/app/burnticker/launch/page.tsx", "utf8");
const cfg = loadCopyLintConfig();

describe("a rivalry pair of two teams", () => {
  test("two teams with no listed game build the season pair; the second list leaves out the first; the matchup names both sides", () => {
    assert.deepEqual(otherTeams([{ abbr: "LAD" }, { abbr: "MIL" }, { abbr: "NYY" }], "LAD").map((t) => t.abbr), ["MIL", "NYY"]);
    const games = [{ expectedAt: "2026-10-14T00:00:00Z", pair: { a: { abbr: "NYY" }, b: { abbr: "BOS" } } }];
    assert.equal(meetingOf(games, "LAD", "MIL"), null, "no listed meeting");
    assert.equal(meetingOf([...games, { expectedAt: "2026-10-15T00:00:00Z", pair: { a: { abbr: "MIL" }, b: { abbr: "LAD" } } }], "LAD", "MIL")?.expectedAt, "2026-10-15T00:00:00Z", "either side at home");
    const r = seasonPairRules("mlb", "LAD", "MIL", 2026);
    assert.equal(r.a.series, teamSeries("mlb", "LAD", "loss", { kind: "season", year: 2026 }));
    assert.equal(r.b.series, teamSeries("mlb", "MIL", "loss", { kind: "season", year: 2026 }));
    const a = { ...r.a, onEnd: { ...DEFAULT_ON_END } } as BurnRule;
    assert.match(describeRule(a, { ticker: "LADVMIL" }).windowSentence, /2026 Dodgers season only, including the playoffs/);
    assert.deepEqual(pairTickers("LAD", "MIL"), { a: "LADVMIL", b: "MILVLAD" });
    assert.deepEqual(pairNames("Dodgers", "Brewers"), { a: "Dodgers vs Brewers, Dodgers side", b: "Brewers vs Dodgers, Brewers side" });
    const o = patternOptions({ follow: "rivalry", rule: a, pairKind: "teams", meeting: false });
    assert.equal(o.preselected, "every"); assert.equal(o.options.find((x) => x.id === "once")!.reason, PATTERN_REASON.noMeeting);
    assert.ok(lintCopy(PATTERN_REASON.noMeeting, cfg).ok);
  });

  test("the page: two team lists, then One game or This season; the game-first Matchup stays on the free-text path", () => {
    assert.match(page, /\{rivalA && \(rivalB \? picked\(rivalB, "Second team", \(\) => setRivalB\(null\)\) : list\(rivalA\.abbr, setRivalB, "Second team"\)\)\}/);
    assert.match(page, /onClick=\{\(\) => chooseRivals\(rivalA, rivalB, "season"\)\}/);
    assert.match(page, /if \(!\(mode === "game" && meet\)\) \{ setPairMode\("season"\); renameForSeason\(a, b\); \}/, "website-20 audit 7 item 9: the season coins are renamed for what they count");
    assert.match(page, /\{flow === "pair" && step === "pick" && guide\.follow !== "rivalry" && \(/);
    assert.match(page, /chooseGame\(mode === "game" && meet \? meet : seasonHit\);/, "the review names both sides by the matchup tickers (chooseGame sets pairTickers)");
    assert.match(page, /const tk = freePairTickers\(\{ abbr: g\.pair\.a\.abbr, code: g\.pair\.a\.code \}, \{ abbr: g\.pair\.b\.abbr, code: g\.pair\.b\.code \}, tickerGuard\)/);
  });
});
