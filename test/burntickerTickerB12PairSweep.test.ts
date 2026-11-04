// B-12 (sixth-pass audit, WZ6-1; port of the auditor's audit6WizardTickers sweep): a two-team pair's generated tickers are checked
// against the tickers already in use, and a refused one replaced, BEFORE the Name step shows them, in every league the catalogue offers.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { tickerChecks, type TickerRow } from "@/lib/burnticker/tickerCheck";
import { autoTickerSwaps, freePairTickers, guardRefuses, pairTickerCandidates, pairTickerSwapLine, tickerRefused, type TickerGuard } from "@/lib/burnticker/tickerSwap";
import type { LookalikeExisting } from "@/lib/burnticker/lookalike";
import { meetingsPairNames, pairTickers } from "@/lib/burnticker/guidedLaunch";
import { LEAGUES, teamsOf, type LeagueId } from "@/lib/burnticker/sources/espn";
import { isReserved, loadReserved } from "@/lib/burnticker/reservedNames";
import { winPairNames } from "@/app/burnticker/launch/pageCopy";
import { lintCopy, loadCopyLintConfig, formatHits } from "@/lib/launch/copyLint";

// The live ticker set: the production registry's launched coins (sixth-pass brief) plus the platform's own coins.
const LIVE = ["PHINFLWIN", "CLARITY", "PITWIN", "BALWIN", "SEAWIN", "DENWIN", "TWOCUTS", "NEXTM6", "DEFICIT", "REHEARSAL"];
const OTHER = "OtherCreator1111111111111111111111111111111";
const rows = (t: string): TickerRow[] => LIVE.filter((x) => x === t.toUpperCase()).map((x) => ({ mint: `${x}mint`, name: `${x} coin`, ticker: x, rulesJson: "{}", status: "live", creator: OTHER }));
const existing: LookalikeExisting[] = LIVE.map((t) => ({ ticker: t, name: `${t} coin`, status: "live", creator: OTHER }));
const reserved = loadReserved();
const deps = { inUse: rows, reserved, existing };
const guard: TickerGuard = { existing, reserved: (t) => isReserved(t, reserved) };

type Team = ReturnType<typeof teamsOf>[number];
/** The review's check of a pair as the server runs it (generated = the server's matchup tickers). */
const check = (x: Team, y: Team, a: string, b: string) => {
  const server = pairTickers(x.code ?? x.abbr, y.code ?? y.abbr);
  return tickerChecks([{ side: "A", ticker: a, generated: server.a, team: true }, { side: "B", ticker: b, generated: server.b, team: true }], deps);
};
/** Whether the review's check refuses a ticker (its refusal reads the ticker alone; the other side only shapes the suggestions), memoised. */
const memo = new Map<string, boolean>();
const refusedByReview = (t: string): boolean => {
  let r = memo.get(t);
  if (r === undefined) { r = tickerRefused(tickerChecks([{ side: "A", ticker: t, team: true }], deps)[0]); memo.set(t, r); }
  return r;
};
/** The generator the page used before B-12 (`<CODE>WIN`), to count what the creator met. */
const oldWin = (t: Team) => `${(t.code ?? t.abbr).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5)}WIN`.slice(0, 10);

const LEAGUE_IDS = Object.keys(LEAGUES) as LeagueId[];
const AUDIT_SCOPE: LeagueId[] = ["nfl", "nba", "nhl", "mlb"];

describe("B-12: rivalry pair tickers are checked and replaced before the Name step", () => {
  test("Nuggets vs Lakers: two free tickers that differ from each other and from every held one", () => {
    const nba = teamsOf("nba"), den = nba.find((t) => t.abbr === "DEN")!, lal = nba.find((t) => t.abbr === "LAL")!;
    // without a guard the tickers are the server's matchup tickers, the same as meetingsPairNames
    const plain = winPairNames(den, lal);
    assert.equal(plain.a.ticker, meetingsPairNames(den, lal).a.ticker);
    assert.equal(plain.b.ticker, meetingsPairNames(den, lal).b.ticker);
    assert.equal(plain.a.name, "Nuggets over Lakers");
    const g = winPairNames(den, lal, guard);
    assert.notEqual(g.a.ticker, g.b.ticker);
    for (const t of [g.a.ticker, g.b.ticker]) { assert.ok(!LIVE.includes(t), `$${t} is held`); assert.ok(!guardRefuses(t, guard), `$${t} is refused`); }
    for (const c of check(den, lal, g.a.ticker, g.b.ticker)) assert.ok(!tickerRefused(c), JSON.stringify(c));
    // the old generator's two tickers were both refused (DENWIN held, LALWIN one letter from BALWIN)
    assert.ok(check(den, lal, "DENWIN", "LALWIN").every(tickerRefused));
  });

  test("a held matchup ticker is replaced by the first free candidate, never the other side's, and says so", () => {
    const nhl = teamsOf("nhl"), pit = nhl.find((t) => (t.code ?? t.abbr) === "PIT")!, van = nhl.find((t) => (t.code ?? t.abbr) === "VAN")!;
    const main = pairTickers("PIT", "VAN").a;
    assert.ok(guardRefuses(main, guard), "PITVVAN reads as one letter from PITWIN");
    const r = freePairTickers(pit, van, guard);
    assert.equal(r.swapped.a, true);
    assert.equal(r.a, pairTickerCandidates(pit, van).find((t) => !guardRefuses(t, guard)));
    assert.notEqual(r.a, r.b);
    const held: TickerGuard = { existing: [...existing, { ticker: "DENVLAL", name: "x", status: "live", creator: OTHER }] };
    const nba = teamsOf("nba"), den = nba.find((t) => t.abbr === "DEN")!, lal = nba.find((t) => t.abbr === "LAL")!;
    assert.notEqual(freePairTickers(den, lal, held).a, "DENVLAL");
    const line = pairTickerSwapLine(main, r.a);
    const lint = lintCopy(line, loadCopyLintConfig());
    assert.ok(lint.ok, `${line}\n${formatHits(lint)}`);
  });

  test("a ticker the creator typed is never replaced", () => {
    const checks = tickerChecks([{ side: "A", ticker: "DENWIN", generated: "DENVLAL", team: true }, { side: "B", ticker: "LALWIN", generated: "LALVDEN", team: true }], deps);
    assert.deepEqual(autoTickerSwaps(checks, { a: "DENWIN", b: "LALWIN" }, false), {});
  });

  test("every league's team pairs: 0 refused sides after the swap (the auditor's sweep, widened to every league)", () => {
    let pairs = 0, beforeAudit = 0, pairsAudit = 0, beforeAll = 0, refusedAfter = 0, swapped = 0;
    const bad: string[] = [];
    for (const lg of LEAGUE_IDS) {
      const teams = teamsOf(lg);
      // a ticker depends only on the two codes; check each distinct code pair once
      const seen = new Set<string>();
      for (const x of teams) for (const y of teams) {
        const cx = x.code ?? x.abbr, cy = y.code ?? y.abbr;
        if (cx === cy || seen.has(`${cx}|${cy}`)) continue;
        seen.add(`${cx}|${cy}`);
        pairs++;
        // before: side A on the old <CODE>WIN generator (the auditor's count)
        if (refusedByReview(oldWin(x))) { beforeAll++; if (AUDIT_SCOPE.includes(lg)) beforeAudit++; }
        if (AUDIT_SCOPE.includes(lg)) pairsAudit++;
        // after: the generator the Name step now fills in, checked by the review's own check
        const g = winPairNames(x, y, guard);
        if (g.swapped.a || g.swapped.b) swapped++;
        if (g.a.ticker === g.b.ticker) bad.push(`${lg} ${cx} vs ${cy}: both sides $${g.a.ticker}`);
        for (const t of [g.a.ticker, g.b.ticker]) if (refusedByReview(t)) { refusedAfter++; if (bad.length < 20) bad.push(`${lg} ${cx} vs ${cy}: $${t}`); }
      }
    }
    console.log(`B-12 sweep: ${pairs} ordered pairs in ${LEAGUE_IDS.length} leagues; before ${beforeAudit} of ${pairsAudit} (NFL/NBA/NHL/MLB), ${beforeAll} of ${pairs} (all) refused on coin A; after ${refusedAfter} refused sides; ${swapped} pairs swapped before the Name step`);
    assert.ok(beforeAudit > 0, "the fixture reproduces the audit's refusals");
    assert.equal(refusedAfter, 0, bad.join("\n"));
    assert.deepEqual(bad, []);
    assert.ok(swapped > 0, "the fixture exercises the swap");
  });
});
