// LIVE WALKTHROUGH 13 (2026-10-14, publish 49): what a stranger's walk of burnticker.com and deficit.burnticker.com found, fixed in the
// site and pinned here. The report is mct-runner-study/launch-debt-egg-2026-10-09/WALKTHROUGH-13-2026-10-14.md.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { lintCopy } from "@/lib/launch/copyLint";
import { deficitMintTarget } from "@/lib/burnticker/coinLookup";
import { coinSourceNote, seriesOfSelector, sourcePublisher, SOURCE_DETAILS_UNAVAILABLE } from "@/lib/burnticker/coinSourceLine";
import { upcomingFromStatus } from "@/lib/burnticker/upcoming";
import { cardViewFromIndex, NEXT_WHEN_PUBLISHED, nextCheckWhy } from "@/lib/burnticker/cardView";
import { CHAMPION_SERIES_RE, lockRule, DEFAULT_ON_END, ruleStatement, type BurnRule } from "@/lib/burnticker/rules";
import { firstPartyRule } from "@/lib/burnticker/wizard";
import { championSeries, teamSeries } from "@/lib/burnticker/sources/espn";
import { CHAMPION_EXPLAINER_LINE, endExplainer } from "@/lib/burnticker/describe";
import { upfrontLines } from "@/lib/burnticker/guidedLaunch";
import { ADMISSION_RULES, GUARDRAIL_DETAIL, REHEARSAL_BUY_EXCEPTION, SAFEGUARDS, WHO_GETS_WHAT } from "@/lib/burnticker/safeguards";
import { USE_OF_FEES } from "@/lib/burnticker/fees";
import { MINT_ADDRESS_NOTE } from "@/lib/burnticker/mintAddressCopy";
import { FIRST_BURN_AFTER_GRADUATION } from "@/lib/burnticker/coinPage";
import { candidateMappingLine } from "@/lib/burnticker/elections";
import { SWAP_NOTICE } from "@/lib/burnticker/swap/copy";

const read = (f: string) => fs.readFileSync(f, "utf8");
const clean = (s: string, what: string) => { const r = lintCopy(s); assert.ok(r.ok, `${what}: ${s}\n${JSON.stringify(r.hits)}`); };
const lock = (r: unknown) => lockRule({ ...(r as object), onEnd: { ...DEFAULT_ON_END } });
const DEFICIT_MINT = "AJJ4XxCUYr8zzMWm8FYg3xh638LYAAApdNqWBqCK4oqj";

describe("walkthrough 13: $DEFICIT by its mint", () => {
  test("its mint opens /burnticker/t/DEFICIT (it answered 404); other mints and a registered $DEFICIT are left to the registry", () => {
    assert.equal(deficitMintTarget(DEFICIT_MINT, DEFICIT_MINT, false), "/burnticker/t/DEFICIT");
    assert.equal(deficitMintTarget(encodeURIComponent(DEFICIT_MINT), DEFICIT_MINT, false), "/burnticker/t/DEFICIT");
    assert.equal(deficitMintTarget(DEFICIT_MINT, DEFICIT_MINT, true), null, "once the registry knows it, its own page answers");
    assert.equal(deficitMintTarget("J45hvg6FYGzDMj3iYS3BJPU2pwqfoZhA7B8isnW4fin8", DEFICIT_MINT, false), null);
    assert.equal(deficitMintTarget(DEFICIT_MINT, null, false), null);
    const layout = read("src/app/burnticker/t/[ticker]/layout.tsx");
    assert.match(layout, /const target = deficitMintTarget\(ticker, deficitMint\(\), known\);\n  if \(target\) redirect\(target\);/);
    assert.match(layout, /"config", "own-tokens\.json"/);
    assert.equal(JSON.parse(read("config/own-tokens.json")).tokens.find((t: { symbol: string }) => t.symbol === "DEFICIT").address, DEFICIT_MINT);
  });
  test("the $DEFICIT page states its create date, and the rehearsal maths says the mainnet rule is locked", () => {
    assert.match(read("src/app/burnticker/t/[ticker]/DeficitPrelaunch.tsx"), /<dd>\{d\.launch\.date \?\? \(d\.keeper \? "created, date not recorded" : "not announced"\)\}<\/dd>/);
    assert.doesNotMatch(read("src/app/burnticker/t/[ticker]/DeficitPrelaunch.tsx"), /date not in the keeper's files/);
    assert.match(read("src/app/burnticker/_components/BurnMath.tsx"), /the rule locked for \$DEFICIT on mainnet is 2%/);
    assert.match(read("src/app/burnticker/about/page.tsx"), /Its rules were locked on chain before it was created on mainnet on \$\{utcDay\(d\.launch\.date\)\}/);
  });
  test("the featured $DEFICIT card reads its market cap from the keeper's curve and its age from the status file", () => {
    const home = read("src/lib/burnticker/home.ts");
    // coin card status 2026-10-18: the keeper's curve goes through the same rule as every card (cardView.ts mcapCell)
    assert.match(home, /: kc \? mcapCell\(\{ cap: kc\.marketCap, quote: kc\.quote, phase: kc\.phase, raised: kc\.raised \}\)/);
    assert.match(home, /createdAt: readable \? live!\.launchedAt \?\? null : created \? d\.launch\.date \?\? null : null,/);
    assert.equal(JSON.parse(read("config/burnticker/current-status.json")).deficit.launch.date, "2026-10-13");
  });
});

describe("walkthrough 13: the source and the next result", () => {
  const PHI = "catalogue:espn.team:nfl-PHI.21-win-s2026";
  test("a selector key with the oracle in front still names the sports source (the $PHINFLWIN page said it was unavailable)", () => {
    assert.equal(seriesOfSelector(PHI), "espn.team:nfl-PHI.21-win-s2026");
    assert.equal(seriesOfSelector("treasury.debt"), "treasury.debt");
    assert.notEqual(coinSourceNote("catalogue", PHI), SOURCE_DETAILS_UNAVAILABLE);
    assert.match(coinSourceNote("catalogue", PHI), /^Each game settles on/);
    assert.equal(coinSourceNote("catalogue", "catalogue:something.unknown"), SOURCE_DETAILS_UNAVAILABLE);
  });
  test("the next-results list names the publisher and says the check time once", () => {
    const s = { ticker: "PHINFLWIN", name: "Eagles 2026 Wins", cluster: "mainnet", status: "live", oracle: "catalogue", selectorKey: PHI, seriesTitle: "Philadelphia Eagles wins", next: { nextCheckAt: "2026-10-14T14:04:52.948Z", nextMarket: null, nextCloseTime: null } };
    const row = upcomingFromStatus(s, [])!;
    assert.match(row.source, /TheSportsDB's licensed final score/); assert.doesNotMatch(row.source, /own published data/);
    assert.doesNotMatch(row.schedule, /UTC/, "the list prints the check in Denver time");
    assert.equal(sourcePublisher("catalogue", "catalogue:treasury.debt"), "U.S. Treasury, Debt to the Penny");
    assert.match(read("src/app/burnticker/upcoming/NextResults.tsx"), /In Denver time, the close is \$\{denver\(r\.nextAt\)\}/);
    for (const x of [row.source, row.schedule]) clean(x, "upcoming");
  });
  test("a card whose next time is only the keeper's check says the publisher decides (it printed the check day as the result)", () => {
    const base = { ticker: "PHINFLWIN", name: "Eagles", mint: "M", oneLiner: "burns when the Eagles win", status: "live", imageUrl: null, burned: "0", burns: 0, nextCheckAt: "2026-10-14T14:04:52.948Z", nextCloseTime: null, lastBurnAt: null, launchedAt: "2026-10-14T02:58:28.000Z", pairId: null, phase: "curve" as const, progressPct: 0, raised: "0", threshold: "85", quote: "SOL", pctOfSupply: 0, marketCap: "27.96", holders: 1 };
    assert.deepEqual(cardViewFromIndex(base, "85").nextSettle, { text: NEXT_WHEN_PUBLISHED, why: nextCheckWhy("Oct 14") });
    assert.deepEqual(cardViewFromIndex({ ...base, nextCloseTime: "2026-10-21T03:00:00Z" }, "85").nextSettle, { text: "Oct 21", why: null });
    clean(nextCheckWhy("Oct 14"), "card");
  });
});

describe("walkthrough 13: the end of a team's season coin", () => {
  const season = lock(firstPartyRule(teamSeries("nfl", "PHI", "win", { kind: "season", year: 2026 }), 0.05)).rule as BurnRule;
  test("the rule statement says the champion path the keeper runs (it sent every result end to $DEFICIT)", () => {
    const st = ruleStatement(season);
    assert.match(st, /When the season ends and the team won the championship .*burns down on this coin.*When the rule ends with any other result, whatever is left in the burn pool moves to \$DEFICIT's burn pool/);
    const fade = { ...season, inverse: true } as BurnRule;
    assert.doesNotMatch(ruleStatement(fade), /won the championship/, "the fade side has no champion path");
    const loss = lock(firstPartyRule(teamSeries("nfl", "PHI", "loss", { kind: "season", year: 2026 }), 0.05)).rule as BurnRule;
    assert.doesNotMatch(ruleStatement(loss), /won the championship/);
  });
  test("the statement's series test agrees with espn.ts championSeries", () => {
    const ids = [teamSeries("nfl", "PHI", "win", { kind: "season", year: 2026 }), teamSeries("mlb", "LAD", "win", { kind: "season", year: 2026 }), teamSeries("nba", "LAL", "win", { kind: "season", year: 2027 }), teamSeries("nhl", "COL", "win", { kind: "season", year: 2026 }), teamSeries("nfl", "PHI", "loss", { kind: "season", year: 2026 })];
    for (const id of ids) assert.equal(CHAMPION_SERIES_RE.test(id), championSeries(id) !== null, id);
    assert.equal(CHAMPION_SERIES_RE.test("espn.team:nfl-PHI.21-win-s2026"), true);
  });
  test("the general end explainer and the before-you-start list say the exception", () => {
    assert.ok(endExplainer()[0].endsWith(CHAMPION_EXPLAINER_LINE)); assert.equal(endExplainer().length, 4);
    assert.ok(upfrontLines(["40", "60", "85"]).some((l) => l.includes(CHAMPION_EXPLAINER_LINE)));
    clean(CHAMPION_EXPLAINER_LINE, "champion line");
  });
});

describe("walkthrough 13: disclosures that said more than the code does", () => {
  test("the operator's one disclosed purchase ($REHEARSAL, 0.1 SOL) is named wherever 'never trades' is said", () => {
    // hourly run 6 HB-59: the next guardrail prints the exception, and "no team buy" no longer says it a second time
    assert.doesNotMatch(GUARDRAIL_DETAIL["no team buy"].text, /REHEARSAL/);
    assert.ok(GUARDRAIL_DETAIL["the platform buys no coin except one test coin"].text.includes(REHEARSAL_BUY_EXCEPTION));
    assert.ok(WHO_GETS_WHAT.find((w) => w.who === "Burnticker")!.text.includes(REHEARSAL_BUY_EXCEPTION));
    assert.match(USE_OF_FEES, /apart from the disclosed tests and seeds on the test-coins page/);   // ninth pass B-26 / HS-95; seeds since the $GASCAT seed (2026-10-28)
    assert.match(read("config/burnticker/transparency.json"), /The operator bought 0\.1 SOL of it at creation/);
  });
  test("'no withdraw' names where a pool can go, and natural-hazard readings are not called refused", () => {
    const nw = SAFEGUARDS.find((s) => s.id === "no-withdraw")!.text;
    assert.doesNotMatch(nw, /The only way out is a burn/); assert.match(nw, /No instruction pays it out to a person/); assert.match(nw, /when the rule ends, to move to the burn its rule named/);
    assert.doesNotMatch(ADMISSION_RULES, /Disasters are refused/); assert.match(ADMISSION_RULES, /casualty counts are refused/);
  });
  test("the current-status lines: a whole sentence for $REHEARSAL, and the second signer is no longer a launch gate", () => {
    const cs = read("config/burnticker/current-status.json");
    assert.doesNotMatch(cs, /\$REHEARSAL, a test coin the operator made/);
    assert.doesNotMatch(cs, /before strangers can launch/);
    assert.doesNotMatch(read("config/burnticker/transparency.json"), /required before strangers can launch/);
    const phase = JSON.parse(cs).phase.line as string; clean(phase, "phase line");
  });
  test("every coin's address ends in burn, prepared ahead of time (mandatory since 2026-10-14 night); the swap goes to the curve or the pool", () => {
    assert.match(MINT_ADDRESS_NOTE, /^Every coin made here gets an address that ends in burn\. The address is prepared ahead of time on this site, handed to the creator at launch and used once\./); assert.doesNotMatch(MINT_ADDRESS_NOTE, /October|2026|normal Solana address|unless its creator chose/);
    assert.match(SWAP_NOTICE, /the coin's own Raydium curve or pool/);
    assert.doesNotMatch(read("src/app/burnticker/t/[ticker]/page.tsx"), /goes straight to the coin's Raydium pool/);
    const legal = read("src/lib/burnticker/legalCopy.ts");
    assert.doesNotMatch(legal, /never pays anything to anyone/); assert.match(legal, /swap panel builds a swap that your own wallet signs/);
  });
  test("a party-control coin is not told it follows a nominee; a national race names each state's office", () => {
    const line = candidateMappingLine({ type: "control", stateName: null, district: null, state: null }, { label: "Democratic Party", question: "Will the Democratic Party control the Senate after the 2026 Midterm elections?", partyMarket: true }, "DEMVREP");
    assert.doesNotMatch(line, /nominee|named for/); assert.match(line, /^\$DEMVREP settles on the Democratic Party's market/); clean(line.replace(/“[^”]*”/, "the market"), "party line (the venue's own question aside)");
    assert.match(read("src/lib/burnticker/elections.ts"), /"each state's certified results from its election office"/);
    assert.match(read("src/app/burnticker/launch/page.tsx"), /if \(flow === "pair" && elPick\) return electionPairIdentity\(elPick\.a\.label, elPick\.b\.label, elPick\.race\.title\)\.tickers\.a;/);
  });
  test("the $DEFICIT site: the countdown is a feed check, and the fee pool paragraph names the upgrade path", () => {
    const d = read("site/deficit/index.html");
    assert.doesNotMatch(d, /Next possible burn/); assert.match(d, /id="nextLabel">Next feed check</);
    assert.match(d, /Nothing can burn yet: the curve has to graduate and its pool has to be registered first\./);
    assert.doesNotMatch(d, /has no instruction that withdraws from it/); assert.match(d, /No instruction pays it out to a person or to the operator/);
  });
});

describe("walkthrough 13: crowding and phone width", () => {
  test("the status page grid and every phone tab bar shrink below their content (the status page was 606 px wide, $DEFICIT 419)", () => {
    assert.match(read("site/burnticker/status/index.html"), /\.grid\{display:grid;grid-template-columns:minmax\(0,1fr\);[^}]*\}\n\.grid>\*\{min-width:0\}/);
    for (const f of ["site/burnticker/index.html", "site/burnticker/status/index.html", "site/burnticker/fallback/index.html", "site/deficit/index.html", "site/burnticker/whitepaper.html"]) assert.match(read(f), /\.sh-tabbar\{display:grid;grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/, f);
  });
  test("the coin page says the graduation line once in full; templates do not repeat the pair line", () => {
    const page = read("src/app/burnticker/t/[ticker]/page.tsx");
    assert.match(page, /preBurn \? FIRST_BURN_AFTER_GRADUATION :/); clean(FIRST_BURN_AFTER_GRADUATION, "last receipt");
    assert.match(read("src/app/burnticker/templates/page.tsx"), /filter\(\(s\) => !t\.pairLine!\.includes\(s\)\)/);
  });
});
