// HOURLY AUDIT 2026-10-20 01:10 DENVER, RUN 13 (docs/burnticker/audits/continuous/2026-10-20-0110-Denver.md; bugs.md HB-144, HB-146 to
// HB-152; suggestions HS-2, HS-55, HS-56). HB-145 (the stall) belongs to the deploy and web-process work; HS-56 waits for per-day climate
// data the repo does not hold. One pure test or source check per fix, plus the copy lint on every new public sentence.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { lintCopy, loadCopyLintConfig, formatHits } from "@/lib/launch/copyLint";
import { GATE_BUDGET_MS, coinPageServedSafely, type CoinPageGateModule } from "@/lib/burnticker/coinPagePath";
import { GATE_BUSY_TIMEOUT_MS, GATE_REGISTRY_FILE, clearCoinPageGate, coinSegmentServedAsync, readKnownCoins, type KnownCoins } from "@/lib/burnticker/coinPageGate";
import { REGISTRY_FILE } from "@/lib/burnticker/registry";
import { statementOf, subjectIsPlural } from "@/lib/burnticker/eventIdentity";
import { RARE_SAMPLE_MIN_DAYS, rareFadeLine } from "@/lib/burnticker/hazardSeason";
import { firstPartyRule } from "@/lib/burnticker/wizard";
import { applyDial } from "@/lib/burnticker/dials";
import { TEMPLATES } from "@/lib/burnticker/templates";
import { templateCardState, type TemplateSite } from "@/lib/burnticker/templateCard";
import { NOT_OFFERED } from "@/lib/burnticker/exampleTickets";
import { lockRule, validateRule, DEFAULT_ON_END, type BurnRule } from "@/lib/burnticker/rules";
import { CATALOGUE_ONE_SHOT_RE, FIRST_SNOW_PREFIX, KEEPER_ONE_SHOT_RE, ONE_SHOT_SERIES_PREFIXES, isOneShotSeries } from "@/lib/burnticker/inverse";
import { dialsFor, isOneShotRule } from "@/lib/burnticker/dials";
import { sharePresetsForRule } from "@/lib/burnticker/launchPresets";
import { budgetCopy, namesChangeOf, namesRemadeLine } from "@/lib/burnticker/guidedLaunch";
import { oneShotFull } from "@/lib/burnticker/nextResult";
import { describeRule, windowKindOf } from "@/lib/burnticker/describe";
import { detectRuleEnd } from "@/lib/burnticker/multiKeeper";
import { nwsSeries } from "@/lib/burnticker/sources/nws";
import { nativeRule } from "@/lib/burnticker/sources/native";
import { ruleRefusals } from "@/lib/burnticker/launchPreflight";
import { SIM_NO_READING_LABEL, simulateResults } from "@/lib/burnticker/simulator";
import { polyRule } from "@/lib/burnticker/search";
import { heavySpendLine } from "@/lib/burnticker/drain";
import { reviewProjection } from "@/lib/burnticker/projection";
import { NAME_STEP_CHECKING_BUTTON, tickerCheckingLine } from "../src/app/burnticker/launch/fieldChecks.ts";

const cfg = loadCopyLintConfig();
const clean = (s: string) => { const r = lintCopy(s, cfg); assert.ok(r.ok, `${s}\n${formatHits(r)}`); };
const plain = (s: string) => { clean(s); assert.doesNotMatch(s, /\bwill\b|\bbuy\b|\bprice\b|coming soon|\bpayouts?\b|\btarget\b|\bguarantee|→|\b20\d\d-\d\d-\d\d\b|\w\/\w+\//i, s); };
const read = (p: string) => fs.readFileSync(p, "utf8");
const feedRule = (series: string, f = 0.02) => applyDial(firstPartyRule(series, 0.02), "fraction", f) as BurnRule;

describe("HB-152: the proxy's coin-page gate reads the registry read-only, keeps the set a minute and fails open", () => {
  const known: KnownCoins = { mints: new Set(["M".padEnd(32, "1")]), launchedTickers: new Set(["DENWIN"]) };
  test("a read error fails open; a known coin and an unknown one are told apart", async () => {
    clearCoinPageGate();
    assert.equal(await coinSegmentServedAsync("NOPE", { read: async () => { throw new Error("SQLITE_BUSY"); } }), true, "a throw serves the page");
    clearCoinPageGate();
    assert.equal(await coinSegmentServedAsync("NOPE", { read: async () => null }), true, "a registry that cannot be read serves the page");
    clearCoinPageGate();
    assert.equal(await coinSegmentServedAsync("denwin", { read: async () => known }), true);
    assert.equal(await coinSegmentServedAsync("NOPE", { read: async () => known }), false);
  });
  test("a failed module import, a throwing gate and a slow gate all let the request through", async () => {
    assert.equal(await coinPageServedSafely("NOPE", { load: () => Promise.reject(new Error("Cannot find module 'node:sqlite'")) }), true);
    assert.equal(await coinPageServedSafely("NOPE", { load: () => { throw new Error("bundling"); } }), true);
    assert.equal(await coinPageServedSafely("NOPE", { load: async () => ({ coinSegmentServedAsync: async () => { throw new Error("db"); } }) }), true);
    const slow: CoinPageGateModule = { coinSegmentServedAsync: () => new Promise((r) => setTimeout(() => r(false), 2_000)) };
    const t0 = Date.now();
    assert.equal(await coinPageServedSafely("NOPE", { load: async () => slow, budgetMs: 50 }), true);
    assert.ok(Date.now() - t0 < 500, "the budget ends the wait");
    assert.equal(await coinPageServedSafely("NOPE", { load: async () => ({ coinSegmentServedAsync: async () => false }) }), false, "a prompt no is a 404");
    assert.ok(GATE_BUDGET_MS <= 300 && GATE_BUSY_TIMEOUT_MS <= 250);
  });
  test("the known-coin set is read once and reused inside 60 s; a miss re-reads only a set older than a few seconds", async () => {
    clearCoinPageGate();
    let reads = 0;
    const read = async () => { reads++; return known; };
    const t = 1_000_000;
    for (const [seg, dt] of [["DENWIN", 0], ["DENWIN", 10_000], ["DENWIN", 59_000]] as const) assert.equal(await coinSegmentServedAsync(seg, { read, now: t + dt }), true);
    assert.equal(reads, 1, "one read serves every request inside the minute");
    assert.equal(await coinSegmentServedAsync("NOPE", { read, now: t + 2_000 }), false);
    assert.equal(reads, 1, "a miss on a set two seconds old does not read again");
    assert.equal(await coinSegmentServedAsync("NOPE", { read, now: t + 30_000 }), false);
    assert.equal(reads, 2, "a miss on an older set reads once more before the 404 (a coin launched a moment ago is never refused)");
    assert.equal(await coinSegmentServedAsync("DENWIN", { read, now: t + 95_000 }), true);
    assert.equal(reads, 3, "after a minute the set is read again");
  });
  test("readKnownCoins opens the file read-only, never creates it, and counts launched tickers only", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bt-gate-"));
    try {
      const missing = path.join(dir, "none.db");
      assert.equal(await readKnownCoins(missing), null);
      assert.ok(!fs.existsSync(missing), "a missing registry is never created by the gate");
      const file = path.join(dir, "reg.db");
      const db = new DatabaseSync(file);
      db.exec("CREATE TABLE tokens (mint TEXT PRIMARY KEY, ticker TEXT, status TEXT)");
      const ins = db.prepare("INSERT INTO tokens VALUES (?,?,?)");
      ins.run("A".padEnd(32, "1"), "DENWIN", "live"); ins.run("B".padEnd(32, "1"), "DRAFTY", "draft"); ins.run("C".padEnd(32, "1"), "OLDONE", "expired");
      db.close();
      const k = (await readKnownCoins(file))!;
      assert.deepEqual([...k.launchedTickers], ["DENWIN"]);
      assert.equal(k.mints.size, 3, "a draft is reachable by its mint, as the layout does");
      assert.equal(await readKnownCoins(path.join(dir, "not-a-db.txt")), null);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  test("the proxy path never loads the writable registry module; the gate's file is the registry's", () => {
    const gate = read("src/lib/burnticker/coinPageGate.ts"), pathMod = read("src/lib/burnticker/coinPagePath.ts"), proxy = read("src/proxy.ts");
    for (const src of [gate, pathMod, proxy]) { assert.doesNotMatch(src, /openRegistry|from "@\/lib\/burnticker\/registry"/); }
    assert.match(gate, /new DatabaseSync\(file, \{ readOnly: true \}\)/);
    assert.match(gate, /await import\("node:sqlite"\)/);
    assert.doesNotMatch(proxy, /coinPageGate/, "the proxy imports only the light module; the gate is a dynamic import inside a try/catch");
    assert.match(pathMod, /import\("@\/lib\/burnticker\/coinPageGate"\)/);
    assert.equal(GATE_REGISTRY_FILE, REGISTRY_FILE);
  });
});

describe("HB-149: a plural subject keeps its plural verb", () => {
  test("the entry's cases and the four the fix names", () => {
    const cases: [string, string][] = [
      ["Will Democrats control the House after 2026?", "Democrats control the House after 2026"],
      ["Will Republicans keep the Senate?", "Republicans keep the Senate"],
      ["Will the Republicans keep the Senate?", "the Republicans keep the Senate"],
      ["Will the Democratic Party control the Senate after the 2026 Midterm elections?", "the Democratic Party controls the Senate after the 2026 Midterm elections"],
      ["Will the Senate pass the bill?", "the Senate passes the bill"],
      ["Will Biden sign the bill?", "Biden signs the bill"],
      ["Will the Lakers win the title?", "the Lakers win the title"],
      ["Will Mavericks win?", "Mavericks win"],
      ["Will the Dallas Mavericks win?", "the Dallas Mavericks win"],
      ["Will Texas secede?", "Texas secedes"],
      ["Will Kansas pass the law?", "Kansas passes the law"],
      ["Will Congress pass the budget?", "Congress passes the budget"],
      ["Will the United States acquire Greenland in 2026?", "the United States acquires Greenland in 2026"],
      ["Will Bernie Sanders endorse a candidate?", "Bernie Sanders endorses a candidate"],
      ["Will Harris win?", "Harris wins"],
      ["Will the Avalanche win the Cup?", "the Avalanche win the Cup"],
      ["Will the US carry out strikes?", "the US carries out strikes"],
    ];
    for (const [q, want] of cases) assert.equal(statementOf(q), want, q);
  });
  test("a party or team group from the market counts a name ending in s as plural; a party name stays one party", () => {
    assert.equal(subjectIsPlural("Kansas City Chiefs"), true, "the head is a team nickname");
    assert.equal(subjectIsPlural("Golden Knights", { group: "team" }), true);
    assert.equal(subjectIsPlural("Democratic Party", { group: "party" }), false);
    assert.equal(statementOf("Will Social Democrats keep power?", { group: "party" }), "Social Democrats keep power");
  });
});

describe("HB-150: one quiet week never calls a state rare for tornadoes", () => {
  const tx = { ...feedRule("spc.tornadoes:TX"), inverse: true } as BurnRule;
  test("Texas with a quiet seven-day sample: no warning; Alaska always; a quiet month or longer outside the list does warn", () => {
    assert.equal(rareFadeLine(tx, { from: "2026-10-05", to: "2026-10-11", triggers: 7 }), null);
    assert.equal(rareFadeLine(tx, { from: "2026-09-12", to: "2026-10-11", triggers: 29 }), null, "a day with a report is not 'none'");
    assert.ok(RARE_SAMPLE_MIN_DAYS >= 30);
    const month = rareFadeLine(tx, { from: "2026-09-12", to: "2026-10-11", triggers: 30 })!;
    assert.match(month, /^Tornado reports in Texas are rare \(none in the saved sample\)/); plain(month);
    assert.match(rareFadeLine({ ...feedRule("spc.tornadoes:AK"), inverse: true } as BurnRule, { from: "2026-10-05", to: "2026-10-11", triggers: 3 }) ?? "", /^Tornado reports in Alaska are rare,/);
  });
});

describe("HB-151: a card that cannot launch has no link, so it never asks to replace a draft", () => {
  const open: TemplateSite = { wizard: true, pairs: { available: true, line: null, detail: null }, types: new Proxy({}, { get: () => ({ available: true, label: "x", reason: null }) }) as TemplateSite["types"] };
  test("every template: a refused source means 'Not offered yet.' and no href; an offered one keeps its href", () => {
    for (const t of TEMPLATES) {
      const refused = templateCardState({ ...t, source: t.source ?? "x.y" }, open, () => "Coins cannot launch on this source yet.");
      assert.equal(refused.unavailable, NOT_OFFERED, t.id); assert.equal(refused.href, null, `${t.id}: no link on a card that is not offered`);
      const offered = templateCardState(t, open, () => null);
      assert.equal(offered.href, t.href, t.id); assert.equal(offered.unavailable, null, t.id);
      assert.equal(templateCardState(t, { ...open, wizard: false }, () => null).href, null, `${t.id}: no link while the wizard is closed`);
    }
    const rocket = TEMPLATES.find((x) => x.id === "launch-count")!;
    assert.equal(templateCardState(rocket, open, (s) => (s === "ll2.launches" ? "Coins cannot launch on this source yet." : null)).href, null);
  });
});

describe("HB-147: the first snow is a one-shot everywhere: one list, the one-shot shares, the whole pool on the first snow", () => {
  const snow = firstPartyRule("nws.snow:DEN", 0.02);
  test("one source of truth: the list has the first snow; the keeper's generic branch is the same list less the first snow", () => {
    assert.ok(isOneShotSeries("nws.snow:DEN") && CATALOGUE_ONE_SHOT_RE.test("nws.snow:DEN"));
    assert.ok(!KEEPER_ONE_SHOT_RE.test("nws.snow:DEN"), "the keeper ends the first snow in its own branch (its 0 days are not the result)");
    for (const p of ONE_SHOT_SERIES_PREFIXES) if (p !== FIRST_SNOW_PREFIX) assert.ok(KEEPER_ONE_SHOT_RE.test(`${p}:x`), p);
    assert.ok(!isOneShotSeries("nws.high:DEN-90") && !isOneShotSeries(null));
    assert.ok(isOneShotRule(snow)); assert.equal(windowKindOf(snow), "one-shot");
    for (const f of ["src/lib/burnticker/dials.ts", "src/lib/burnticker/describe.ts", "src/lib/burnticker/rules.ts"]) assert.match(read(f), /isOneShotSeries\(/, f);
  });
  test("the burn step offers the one-shot shares, and 100% says the whole pool burns once", () => {
    assert.equal(dialsFor(snow).bounds.max, 1);
    assert.deepEqual([...sharePresetsForRule(snow)], [1]);
    assert.deepEqual([...sharePresetsForRule(snow, { dispersal: true })], [1, 0.5]);
    const full = applyDial(snow, "fraction", 1) as BurnRule;
    assert.equal(((validateRule(full) as BurnRule).scalar?.perUnit as { fractionOfPool?: number }).fractionOfPool, 1, "a 100% first snow is a valid rule");
    const line = budgetCopy(full, 1, null).line;
    assert.match(line, /^This coin burns its whole pool once, when the result is in\./); plain(line);
    assert.ok(oneShotFull(full), "the end words say what reaches the pool after the one burn");
    assert.match(describeRule(full, { ticker: "DENSNOW" } as never).paragraph, /first measurable snow of the season, the burn pool spends 100% buying \$DENSNOW/);
    assert.match(read("src/app/burnticker/launch/page.tsx"), /applyRule\(firstPartyRule\(series, isOneShotSeries\(series\) \? DEFAULT_SHARE\.oneShot : DEFAULT_SHARE\.recurring\)/, "Use this rule opens at 100%");
  });
  test("the keeper drains a 100% first snow after its first snow; a share under 100% still winds down; 0 days never end it (HB-164: no hold)", () => {
    const tok = { mint: "SNOWMINT", ticker: "DENSNOW", selectorKey: "catalogue:nws.snow:DEN", baselineAt: "2026-10-12T20:00:00.000Z", status: "live" } as never;
    const receipt = (eventId: string, units: number, f: number) => ({ mint: "SNOWMINT", eventId, settledAt: eventId, result: null, value: String(units), units, mapping: units ? { fractionOfPool: f } : null, kind: units ? "up" : "flat", note: "", status: units ? "planned" : "zero" });
    const deps = (receipts: unknown[], now: number) => ({ registry: { ruleEnd: () => null, receipts: () => receipts }, dryRun: true, now: () => now, log: () => undefined }) as never;
    const full = lockRule({ ...nativeRule(nwsSeries("snow", "DEN"), { fractionOfPool: 1 }), onEnd: DEFAULT_ON_END });
    assert.equal(detectRuleEnd(deps([receipt("2026-10-20", 0, 1)], Date.parse("2026-12-01")), tok, full, null), null);
    const end = detectRuleEnd(deps([receipt("2026-10-20", 0, 1), receipt("2026-11-03", 1, 1)], Date.parse("2026-11-05")), tok, full, null);
    assert.equal(end?.mode, "drain"); assert.equal(end?.reason, "the first snow of the season fell (2026-11-03) at 100 % of the pool");
    const half = lockRule({ ...nativeRule(nwsSeries("snow", "DEN"), { fractionOfPool: 0.5 }), onEnd: DEFAULT_ON_END });
    assert.equal(detectRuleEnd(deps([receipt("2026-11-03", 1, 0.5)], Date.parse("2026-11-05")), tok, half, null)?.mode, "winddown");
    // HB-164 (hourly run 15): a first snow under 100% is not held before its end sink; it keeps the publish-102 end
    // (test/burntickerHourlyRun15.test.ts drives the keeper)
    assert.doesNotMatch(read("src/lib/burnticker/multiKeeper.ts"), /!\(isOneShot\(rule\) \|\| snow\)/);
  });
  test("a first snow under 100% with an end sink needs burn dispersal, like every other one-shot", () => {
    const half = lockRule({ ...nativeRule(nwsSeries("snow", "DEN"), { fractionOfPool: 0.5 }), onEnd: DEFAULT_ON_END });
    assert.ok(ruleRefusals(half, { dispersal: false }).some((x) => x.code === "one-shot-share-needs-dispersal"));
    const full = lockRule({ ...nativeRule(nwsSeries("snow", "DEN"), { fractionOfPool: 1 }), onEnd: DEFAULT_ON_END });
    assert.ok(!ruleRefusals(full, { dispersal: false }).some((x) => x.code === "one-shot-share-needs-dispersal"));
  });
});

describe("HB-148: the weather template's Change which opens the Published data browser, never the market search", () => {
  test("the template sets the browse origin, the Science category and the station picker; Which goes back to browse for published data", () => {
    const page = read("src/app/burnticker/launch/page.tsx");
    assert.match(page, /setOrigin\(\{ kind: "template", flow: "browse", step: "pick", uq: "", q2: "", cat: "science"/);
    assert.match(page, /setCat\("science"\); setWx\(\{ metric: WEATHER_TEMPLATE\.metric, station: WEATHER_TEMPLATE\.station, threshold: String\(WEATHER_TEMPLATE\.threshold\) \}\);/);
    assert.match(page, /else if \(guide\.follow === "number"\) \{ setFlow\("browse"\); setStep\("pick"\); if \(origin\?\.cat\) setCat\(origin\.cat\); \}/);
    assert.doesNotMatch(page, /kind: "template", flow: "team", step: "choose", uq: "", q2: "", cat: "science"/);
  });
});

describe("HB-144: the Name step's notice names a Which change as one", () => {
  test("two teams to two candidates is a change of which; a team's title market is still a change of how it burns", () => {
    const teams = "pair|rivalry|catalogue|espn.game:nba-x|DEN|DEN|LAL|teams|";
    const cands = "browse|rivalry|polymarket|0xabc|DEN|DEN|LAL|candidates|c1+c2";
    assert.equal(namesChangeOf(teams, cands), "which");
    assert.equal(namesChangeOf("browse|rivalry|polymarket|0xabc||||candidates|c1+c2", "browse|rivalry|polymarket|0xdef||||candidates|c3+c4"), "which");
    assert.equal(namesChangeOf("team|team|catalogue|espn.team:x|BUF||||", "single|team|polymarket|0xabc|BUF||||"), "burns");
    const line = namesRemadeLine(2, namesChangeOf(teams, cands));
    assert.doesNotMatch(line, /how the coins burn/); plain(line);
    assert.match(read("src/app/burnticker/launch/page.tsx"), /guide\.pairKind \?\? "", elPick \? `\$\{elPick\.a\.conditionId\}\+\$\{elPick\.b\.conditionId\}` : ""\]\.join\("\|"\)/);
  });
});

describe("HB-146: a published number's result table says 'No reading is published' once", () => {
  test("one no-reading row for a feed rule; every other family keeps its rows; no two titles differ only by reading/result", () => {
    const debt = feedRule("treasury.debt");
    const rows = simulateResults(debt).rows;
    assert.equal(rows.filter((r) => /^No (reading|result) is published$/.test(r.label)).length, 1);
    assert.ok(rows.some((r) => r.label === SIM_NO_READING_LABEL));
    for (const rule of [debt, feedRule("nws.high:DEN-90"), firstPartyRule("nws.snow:DEN", 1), polyRule("0xabc")]) {
      const labels = simulateResults(rule).rows.map((r) => r.label.replace(/\b(reading|result)\b/, "X"));
      assert.equal(new Set(labels).size, labels.length, JSON.stringify(labels));
    }
  });
});

describe("HS-2: a back-test that spends more than half the pool is said above the share chips, and the block opens", () => {
  const p = { available: true, weeks: 6, rows: [{ share: 0.01, units: 443, spentPct: 99 }, { share: 0.02, units: 443, spentPct: 99.99 }, { share: 0.05, units: 443, spentPct: 100 }] };
  test("the line, with the numbers computed", () => {
    const line = heavySpendLine(p, 0.02)!;
    assert.equal(line, "At 2% each, this rule would have spent 99.9% of the pool over the last six weeks (443 burns). 1% spends 99%. Even the smallest share spends more than half of the pool on these readings.");
    plain(line);
    assert.equal(heavySpendLine(p, 0.01), "At 1% each, this rule would have spent 99% of the pool over the last six weeks (443 burns).");
    assert.equal(heavySpendLine({ ...p, rows: [{ share: 0.02, units: 3, spentPct: 5.9 }] }, 0.02), null, "half or less says nothing");
    assert.equal(heavySpendLine(p, 1), null); assert.equal(heavySpendLine({ ...p, available: false }, 0.02), null); assert.equal(heavySpendLine(null, 0.02), null);
  });
  test("the debt coin's own saved sample at 2% trips it; the page puts it above the chips and opens the review block", () => {
    const pr = reviewProjection(feedRule("treasury.debt"));
    if (pr.available) assert.match(heavySpendLine(pr, 0.02) ?? "", /^At 2% each, this rule would have spent 9\d(\.\d)?% of the pool over the last/);
    const steps = read("src/app/burnticker/launch/GuidedSteps.tsx");
    assert.ok(steps.indexOf("data-heavy-spend") < steps.indexOf('aria-label={pairLabel ? "Share of each coin'), "the line sits above the share chips");
    const page = read("src/app/burnticker/launch/page.tsx");
    assert.match(page, /data-projection open=\{heavySpendLine\(rv\.projection, shareValue\) !== null \|\| undefined\}/);
    assert.match(page, /heavy=\{heavy\}/);
  });
});

describe("HS-55: the Name step says the ticker is being checked, and Review waits", () => {
  test("the line and the button words", () => {
    const line = tickerCheckingLine("denw1n");
    assert.equal(line, "Checking $DENW1N against the live coins…"); plain(line);
    assert.equal(NAME_STEP_CHECKING_BUTTON, "Checking…");
    const page = read("src/app/burnticker/launch/page.tsx");
    assert.match(page, /\{nameChecking \? NAME_STEP_CHECKING_BUTTON : "Review"\}<\/button>/);
    assert.match(page, /tickerChecking=\{nameChecking\}/);
    assert.match(read("src/app/burnticker/launch/ReviewCard.tsx"), /\{p\.tickerChecking && !tErr && c\.ticker\.trim\(\) && <p [^>]*data-ticker-checking=\{c\.key\}>\{tickerCheckingLine\(c\.ticker\.trim\(\)\)\}<\/p>\}/);
  });
});
