// SOURCES-7 (QA walkthrough 11 H9): tickers and names that impersonate. Well-known tickers (stablecoins, top coins) are refused; near
// copies of the platform's reserved names (a digit for a letter, added digits, a cut-off end) are refused; another team's ticker on a team
// coin is refused; campaign phrases ("Vote X", "X for Senate") fall under the no-affiliation rule; the ticker suggester offers tickers
// from the rule, never a reserved name plus a digit; and a reserved ticker is called a ticker.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_ON_END, type BurnRule } from "@/lib/burnticker/rules";
import { firstPartyRule } from "@/lib/burnticker/wizard";
import { teamSeries } from "@/lib/burnticker/sources/espn";
import { buildLaunchReview } from "@/lib/burnticker/launchReview";
import { isReserved, loadMajors, loadReserved, reservedProblem, RESERVED_REFUSAL, RESERVED_TICKER_REFUSAL, MAJOR_REFUSAL } from "@/lib/burnticker/reservedNames";
import { tickerChecks } from "@/lib/burnticker/tickerCheck";
import { otherTeamTickerProblem } from "@/lib/burnticker/launchPreflight";
import { creatorTextProblems } from "@/lib/burnticker/coinText";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";

const cfgLint = loadCopyLintConfig();
const lint = (t: string) => { const r = lintCopy(t, cfgLint); assert.ok(r.ok, `${r.hits.map((h) => `${h.phrase} (${h.rule})`).join(", ")}\n${t}`); };
const env = { BURNTICKER_CLUSTER: "mainnet", BURNTICKER_CREATOR_LAUNCHES_ENABLED: "1" };
const avs = { ...firstPartyRule(teamSeries("nhl", "COL", "win", { kind: "season", year: 2026 }), 0.02), onEnd: { ...DEFAULT_ON_END } } as BurnRule;
const problemsOf = (ticker: string, name: string, rule: BurnRule = avs) => { const r = buildLaunchReview({ rule, ticker, name }, { env }); assert.ok("review" in r); return r.review.problems; };

describe("H9: impersonating tickers and names", () => {
  test("near copies of reserved names are reserved: a digit for a letter, added digits, a cut-off end", () => {
    const set = loadReserved();
    for (const x of ["DEF1CIT", "DEFICIT3", "DEFICIT4", "D3FICIT", "BURNTICKE2", "BURNTICKE", "BURNT1CKER", "REHEARSAL2", "REHEARSA1", "Deficit 2026"]) assert.ok(isReserved(x, set), x);
    // the owner's earlier calls stand: these are not the platform's names
    for (const x of ["LAD", "DEBTUP", "DEFICITS", "Dodgers", "AVSCUP", "Debt Deficit and Porky"]) assert.equal(isReserved(x, set), false, x);
    for (const t of ["DEF1CIT", "BURNTICKE2", "REHEARSAL2"]) assert.ok(problemsOf(t, "Avs Cup").includes(RESERVED_TICKER_REFUSAL), t);
  });

  test("a reserved ticker is called a ticker; a reserved name is called a name", () => {
    assert.equal(reservedProblem({ ticker: "DEFICIT", name: "Avs" }), RESERVED_TICKER_REFUSAL);
    assert.equal(reservedProblem({ ticker: "AVS", name: "Deficit" }), RESERVED_REFUSAL);
    assert.match(RESERVED_TICKER_REFUSAL, /ticker/);
    lint(RESERVED_TICKER_REFUSAL);
  });

  test("well-known tickers: stablecoins and the largest coins are refused as a ticker or a whole name", () => {
    const majors = loadMajors();
    for (const t of ["USDC", "USDT", "PYUSD", "DAI", "USDE", "FDUSD", "XRP", "DOGE", "ADA", "TRX", "LINK", "AVAX", "SHIB", "DOT", "LTC", "PEPE", "TRUMP", "RAY", "PYTH", "JTO"]) assert.ok(majors.has(t), t);
    assert.ok(problemsOf("USDC", "Avs Cup").includes(MAJOR_REFUSAL));
    assert.ok(problemsOf("AVS", "Pepe").includes(MAJOR_REFUSAL));
  });

  test("another team's ticker on a team coin is refused (LAD on an Avalanche coin); the coin's own team code is fine (COL)", () => {
    const p = otherTeamTickerProblem("LAD", avs)!;
    assert.match(p, /\$LAD/);
    assert.match(p, /Dodgers/);
    lint(p);
    assert.ok(problemsOf("LAD", "Avs Cup").includes(p));
    assert.equal(otherTeamTickerProblem("COL", avs), null);
    assert.equal(otherTeamTickerProblem("AVSCUP", avs), null);
    assert.equal(otherTeamTickerProblem("LAD", { ...avs, oracle: "polymarket", series: null, market: "0x" + "1".repeat(64) } as BurnRule), null, "only team coins");
  });

  test("campaign phrases fall under the no-affiliation rule: Vote Talarico, Paxton for Senate, Elect X", () => {
    for (const name of ["Vote Talarico", "Paxton for Senate", "Elect Paxton", "Reelect Smith", "Talarico for Governor"]) {
      const ps = creatorTextProblems({ name, ticker: "AVS", note: "" });
      assert.ok(ps.some((x) => x.category === "no-affiliation"), name);
      assert.ok(problemsOf("AVS", name).length > 0, name);
    }
    for (const name of ["Vote Count", "Senate Seats", "Talarico Wins", "Avs Cup"]) assert.deepEqual(creatorTextProblems({ name, ticker: "AVS", note: "" }).filter((x) => x.category === "no-affiliation"), [], name);
  });

  test("the ticker suggester offers tickers from the rule, never a reserved name plus a digit", () => {
    const reserved = loadReserved();
    const checks = tickerChecks([{ side: "A", ticker: "DEFICIT", generated: "AVS" }, { side: "B", ticker: "BURNTICKER", generated: null }, { side: "B", ticker: "REHEARSAL", generated: "AVSL" }], { inUse: (t) => (t === "AVS" ? [{ mint: "m", name: "Avs", ticker: "AVS", rulesJson: "{}" }] : []), reserved });
    for (const c of checks) {
      assert.equal(c.reserved, true);
      for (const s of c.suggestions) { assert.equal(isReserved(s, reserved), false, s); assert.doesNotMatch(s, /^(DEFICIT|BURNTICK|REHEARSA)/, s); }
    }
    // continuous audit HB-6: the rule's ticker is held by another coin, so it is never extended ($AVSFANS read as that coin's fan club)
    assert.deepEqual(checks[0].suggestions, [], "the rule's ticker is taken: nothing that starts with it");
    assert.deepEqual(checks[1].suggestions, [], "no rule ticker: nothing is suggested");
    assert.deepEqual(checks[2].suggestions, ["AVSL", "AVSL2"], "not a team coin: the rule's ticker and its digit ending, no team words");
    // a ticker only in use (not reserved) is never offered with something added; a team coin gets the team words on another stem
    const inUse = tickerChecks([{ side: "A", ticker: "LAD" }], { inUse: (t) => (t === "LAD" ? [{ mint: "m", name: "Dodgers", ticker: "LAD", rulesJson: "{}" }] : []), reserved });
    assert.deepEqual(inUse[0].suggestions, []);
  });
});
