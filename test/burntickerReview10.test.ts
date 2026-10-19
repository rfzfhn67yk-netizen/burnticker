// Private review 10 (2026-10-14): F4 (the $DEFICIT page's empty-receipts, trade and footer lines follow the loaded lifecycle) and the
// stale-copy list (seed, metadata uploads, creator launches, the fee ledger line, the checker's power sentences, the coin page's next
// time and source line, the Following note, the no-end-date line). F2 has its own file (burntickerElectionPairLabels.test.ts).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { lintCopy, loadCopyLintConfig, formatHits } from "@/lib/launch/copyLint";
import { recordedSeed, seedDisclosure } from "@/lib/burnKeeper/seedRecord";
import { CHECK_COPY, POWERS_SCOPE } from "@/lib/burnticker/trustpack/copy";
import { coinSourceNote, nextTimeRow, PUBLISHER_DECIDES, SOURCE_DETAILS_UNAVAILABLE } from "@/lib/burnticker/coinSourceLine";
import { WATCH_NOTE, WATCH_EMPTY } from "@/lib/burnticker/watchlist";
import { GRID_TABS } from "@/lib/burnticker/coinsGrid";
import { endExplainer, PERPETUAL_RULE_LINE } from "@/lib/burnticker/describe";
import { teamSeries } from "@/lib/burnticker/sources/espn";

const ROOT = path.join(import.meta.dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const cfg = loadCopyLintConfig();
const clean = (t: string) => { const r = lintCopy(t, cfg); assert.ok(r.ok, `${t}\n${formatHits(r)}`); };

// ---- F4: the $DEFICIT page's lifecycle, evaluated from the page's own script block ----
const page = read("site/deficit/index.html");
type Lc = { state: string; receipts: string | null; launched: boolean };
const block = /\/\* @lifecycle-begin[^*]*\*\/([\s\S]*?)\/\* @lifecycle-end \*\//.exec(page)?.[1] ?? "";
const { deficitLifecycle, LIFECYCLE } = new Function(`${block}; return { deficitLifecycle, LIFECYCLE };`)() as { deficitLifecycle: (s: unknown, l: unknown[] | null) => Lc; LIFECYCLE: Record<string, string> };
const MINT = "AJJ4XxCUYr8zzMWm8FYg3xh638LYAAApdNqWBqCK4oqj";
/** The live status.json shape (keeper burnkeeper.status/v1 on 2026-10-14): cluster "mainnet", program.initialized, readiness on-curve, no burns. */
const live = (readiness: string, extra: Record<string, unknown> = {}) => ({ schema: "burnkeeper.status/v1", ticker: "DEFICIT", cluster: "mainnet", addresses: { mint: MINT }, program: { initialized: true }, readiness: { state: readiness, label: "On its curve", detail: "" }, curve: { phase: "curve" }, ...extra });

describe("F4: the $DEFICIT page follows the loaded lifecycle", () => {
  test("the block is in the page", () => { assert.ok(block.includes("function deficitLifecycle")); });
  test("explicit prelaunch status (prelaunch-v1) keeps the prelaunch wording", () => {
    const pre = JSON.parse(read("site/deficit/status.json"));
    assert.match(pre.schema, /prelaunch-v1/);
    const lc = deficitLifecycle(pre, []);
    assert.equal(lc.state, "prelaunch"); assert.match(lc.receipts!, /^Not launched, so there are no receipts yet/);
  });
  test("production-shaped: launched on its curve with burns [] says no burns yet, trading on its curve", () => {
    const lc = deficitLifecycle(live("on-curve"), []);
    assert.equal(lc.state, "on-curve"); assert.equal(lc.launched, true);
    assert.equal(lc.receipts, "No burns yet. The coin is trading on its curve; burns can begin after graduation and pool registration.");
    assert.doesNotMatch(lc.receipts!, /Not launched/);
  });
  test("graduated with no pool registered; registered with no qualifying result", () => {
    assert.equal(deficitLifecycle(live("awaiting-registration"), []).state, "graduated");
    for (const r of ["awaiting-event", "below-floor", "deferred"]) { const lc = deficitLifecycle(live(r), []); assert.equal(lc.state, "registered", r); assert.match(lc.receipts!, /no Treasury reading has qualified/); }
  });
  test("a first confirmed burn shows the rows, not an empty line", () => {
    const lc = deficitLifecycle(live("burned"), [{ status: "confirmed" }]);
    assert.equal(lc.state, "burned"); assert.equal(lc.receipts, null);
    assert.equal(deficitLifecycle(live("below-floor"), [{ status: "skipped" }]).receipts, null);
  });
  test("a failed history read stays unavailable, never zero", () => {
    const lc = deficitLifecycle(live("on-curve"), null);
    assert.equal(lc.state, "unavailable"); assert.doesNotMatch(lc.receipts!, /No burns yet|Not launched/);
    assert.match(lc.receipts!, /did not load/);
  });
  test("the page wires it: empty list, failed list, and launched trade labels", () => {
    assert.match(page, /renderBurns\(\); if \(!burns\.length\) setEmptyReceipts\(deficitLifecycle\(status, burns\)\.receipts\);/);
    assert.match(page, /setEmptyReceipts\(deficitLifecycle\(status, null\)\.receipts\);/);
    assert.match(page, /if \(deficitLifecycle\(s, \[\]\)\.launched\) \{ launchedTradeLabels\(\);/);
    // F3 (publish 48) kept: "mainnet" is mainnet and the trade buttons are built from the mint
    assert.match(page, /var isMainnet = function \(c\) \{ return c === "mainnet" \|\| c === "mainnet-beta"; \};/);
    assert.match(page, /enableTrade\(tradeLinksFor\(s\.addresses\.mint, phase\)\[0\]\.url\);/);
    // the launched-trade relabel never overwrites a built trade link
    assert.match(page, /if \(a\.hasAttribute\("data-trade-link"\)\) \{ linked = true; return; \}/);
  });
  test("the new lines pass the copy lint", () => { for (const t of Object.values(LIFECYCLE)) clean(t); clean("$DEFICIT has launched, but this page has no trade link for it yet."); });
});

// ---- stale copy ----
describe("stale copy (a): the seed", () => {
  const rec = JSON.parse(read("config/burnticker/current-status.json"));
  test("the launch record carries the seed transaction from the launch evidence", () => {
    const ev = read("docs/burnkeeper/evidence/mainnet-deficit-2026-10-13/launch.json");
    assert.ok(ev.includes(rec.deficit.launch.seedTx));
    const seedStep = (JSON.parse(ev) as { steps: { step: string; signature: string; sol: number }[] }).steps.find((s) => /^seed /.test(s.step))!;
    assert.deepEqual(recordedSeed(rec, MINT), { seedTx: seedStep.signature, seedSol: String(seedStep.sol) });
    assert.equal(recordedSeed(rec, "So11111111111111111111111111111111111111112"), null, "another mint never borrows $DEFICIT's seed");
  });
  test("the keeper: env first, then the record, else nothing published", () => {
    assert.deepEqual(seedDisclosure({ BURNKEEPER_SEED_TX: "abc", BURNKEEPER_SEED_SOL: "2" }, MINT, ROOT), { seedTx: "abc", seedSol: "2" });
    assert.equal(seedDisclosure({}, MINT, ROOT).seedSol, "3");
    assert.deepEqual(seedDisclosure({}, MINT, "/nonexistent"), { seedTx: null, seedSol: null });
    assert.match(read("scripts/burn-keeper.mts"), /\.\.\.seedDisclosure\(process\Wenv, mintS \?\? null,/);
  });
  test("the $DEFICIT page says the operator added the seed, or that details are not published", () => {
    assert.ok(page.includes(`". The operator added " + (s.buyback.funding.seedSol ? esc(s.buyback.funding.seedSol) + " SOL" : "a seed") + '; <a href="`));
    assert.ok(page.includes("view the transaction</a>."));
    assert.ok(page.includes(`". Seed funding details have not been published here."`));
    assert.doesNotMatch(page, /It has no seed deposit/);
  });
});

describe("stale copy (b) to (e): records and the checker", () => {
  test("(b) metadata uploads are in use, from the launch record", () => {
    const t = JSON.parse(read("config/burnticker/transparency.json"));
    const m = JSON.stringify(t);
    assert.doesNotMatch(m, /first upload pending|This has not been used yet/);
    assert.match(m, /gateway\.irys\.xyz\/4dfxjEwmnfLjKaUbdpn2SGffS6jk9r1eKbnqRSxKXk6T/);
    assert.doesNotMatch(read("docs/burnticker/CHECK-THIS-YOURSELF.md"), /first upload pending|This has not been used yet/);
  });
  test("(c) current-status and transparency no longer say creator launches are closed", () => {
    for (const f of ["config/burnticker/current-status.json", "config/burnticker/transparency.json"]) assert.doesNotMatch(read(f), /creator launches are closed/i, f);
    assert.match(read("config/burnticker/current-status.json"), /Creator launches have been open since the evening of 2026-10-13\./);
  });
  test("(d) the $299 line does not claim unpaid", () => {
    const e = JSON.parse(read("config/burnticker/expenses.json")) as { items?: { id: string; note: string }[] } & Record<string, unknown>;
    const s = JSON.stringify(e);
    assert.doesNotMatch(s, /not paid yet/);
    assert.match(s, /Payment status not recorded here\./);
  });
  test("(e) the checker is specific about powers, never absolute", () => {
    assert.equal(POWERS_SCOPE, "These keys cannot withdraw a burn pool to a personal wallet. A finished rule's remainder can be forwarded to its end sink (the winner or $DEFICIT) by the keeper's signed reading; reading signers decide qualifying results; the upgrade authority can replace the program.");
    assert.ok(CHECK_COPY.moneyIntro.endsWith(POWERS_SCOPE)); assert.ok(CHECK_COPY.powersIntro.includes(POWERS_SCOPE));
    const doc = read("docs/burnticker/CHECK-THIS-YOURSELF.md");
    assert.doesNotMatch(doc, /Neither program has|power over funds/); assert.ok(doc.includes(POWERS_SCOPE));
    assert.doesNotMatch(read("src/app/burnticker/check/CheckClient.tsx"), /power over funds/);
    clean(POWERS_SCOPE); clean(CHECK_COPY.moneyIntro); clean(CHECK_COPY.powersIntro);
  });
});

describe("stale copy (f) to (i): the coin page, Following and the no-end line", () => {
  test("(f) the keeper's next check is a source check; a market close says so; the publisher decides", () => {
    const before = Date.parse("2026-10-15T12:00:00Z");
    assert.deepEqual(nextTimeRow(null, "2026-10-15T20:30:00.000Z", before), { label: "Next source check", value: "15 October 2026, 20:30 UTC", note: `Times are in UTC. ${PUBLISHER_DECIDES}` });
    assert.equal(nextTimeRow("2026-10-15T23:00:00Z", "2026-10-15T20:30:00Z", before).label, "Next market close");
    assert.equal(nextTimeRow(null, null).value, "None scheduled");
    assert.equal(PUBLISHER_DECIDES, "The publisher decides when the result is available.");
    const p = read("src/app/burnticker/t/[ticker]/page.tsx");
    assert.match(p, /const nextRow = nextTimeRow\(s\.next\.nextCloseTime, s\.next\.nextCheckAt, tick\);/, "a past check is labelled overdue (audit 2026-10-18 F02)");
    assert.doesNotMatch(p, /The source publishes the result after this/);
  });
  test("(g) a sports coin names its publisher and its confirming source; an unknown one says unavailable", () => {
    const n = coinSourceNote("catalogue", teamSeries("mlb", "LAD", "loss"));
    assert.match(n, /^Each game settles on /); assert.match(n, /Polymarket|TheSportsDB/); assert.match(n, /Where a second source can read the game, it must agree: MLB's official feed\./); assert.match(n, /TheSportsDB alone, once its final score has stood unchanged for 12 hours\./);
    assert.doesNotMatch(n, /source's own published data/);
    assert.equal(coinSourceNote("catalogue", "something.unknown"), SOURCE_DETAILS_UNAVAILABLE);
    assert.equal(SOURCE_DETAILS_UNAVAILABLE, "The source details are unavailable right now.");
    assert.match(coinSourceNote("catalogue", "usgs.quakes:m6"), /U\.S\. Geological Survey/);
    assert.doesNotMatch(read("src/app/burnticker/t/[ticker]/page.tsx"), /Read from \$\{venue\}|the source's own published data/);
    clean(n);
  });
  test("(h) the Following note says it once", () => {
    assert.equal(WATCH_NOTE, "Your follows stay in this browser. No wallet is needed.");
    const following = GRID_TABS.find((t) => t.id === "following")!.rule;
    const shown = `${following} ${WATCH_NOTE}`;
    assert.equal((shown.match(/browser|device/g) ?? []).length, 1, shown);
    assert.doesNotMatch(WATCH_EMPTY, /browser/);
    assert.ok(read("site/burnticker/index.html").includes(`<p class="small muted">${WATCH_NOTE}</p>`));
  });
  test("(i) a rule without an end date keeps running", () => {
    assert.equal(PERPETUAL_RULE_LINE, "A rule without an end date keeps running.");
    assert.equal(endExplainer().at(-1), PERPETUAL_RULE_LINE);
    assert.doesNotMatch(read("src/lib/burnticker/fieldHelp.ts"), /never retires/);
  });
});
