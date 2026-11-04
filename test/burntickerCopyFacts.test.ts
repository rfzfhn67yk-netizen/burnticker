// Prelaunch audit 2026-10-16 F-13 / F-14 and the M11 copy items: the whitepaper's treasury, deployment and time-lock lines; the hero's
// "expiration date" against perpetual coins; the pairs tab's internal title; "?." sentences; "There are 1 holders."; a rank on a coin
// with no receipts; the operator list's internal labels.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { lockRule } from "@/lib/burnticker/rules";
import { WIND_DOWN_ON_END } from "@/lib/burnticker/rules";
import { oneShotAllLiner } from "@/lib/burnticker/coinCard";
import { rankLines } from "@/lib/burnticker/coinRank";
import { holdersCountSentence, pairCardTitle } from "@/lib/burnticker/coinPage";
import { HERO } from "@/lib/burnticker/siteNav.mjs";
import { loadPowersRegister, operatorPowersSummary } from "@/lib/burnticker/trust";
import { lintCopy } from "@/lib/launch/copyLint";
import type { SeasonCoinInput } from "@/lib/burnticker/seasons";
import { nativeRule } from "@/lib/burnticker/sources/native";
import { teamSeries } from "@/lib/burnticker/sources/espn";

const ROOT = path.join(import.meta.dirname, "..");
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");

test("F-13: the whitepaper names the developer fee wallet as the operator treasury, mainnet as deployed (round 5 since 2026-10-15) and the 0 time lock", () => {
  for (const f of ["docs/burnticker/WHITEPAPER.md", "site/burnticker/whitepaper.html"]) {
    const s = read(f);
    assert.doesNotMatch(s, /operator treasury, which is the Squads vault/, f);
    assert.match(s, /8cwwy895BENMJTueXfQovWD4mvuoJ4kgyR52UMrqSbo5/, f);
    assert.match(s, /round 5 on mainnet since 2026-10-15/, f);
    assert.doesNotMatch(s, /\| 48 h Squads time lock \|/, f);
    assert.match(s, /time lock is (\*\*0\*\*|<strong>0<\/strong>) today and no date is set to raise it to 48 hours/, f);   // ninth pass HS-100
    assert.doesNotMatch(s, /On mainnet the treasury is not compiled in yet/, f);
    assert.doesNotMatch(s, /48-hour lock is planned|48 h planned from/, `${f}: no forward-looking promise (review)`);
  }
});

test("the hero keeps the owner's kicker and title, with no note under them (owner decision 2026-10-18)", () => {
  assert.equal(HERO.kicker, "Memecoins with an expiration date.");
  assert.equal(HERO.title, "Memecoins that burn on real-world results.");
  assert.ok(!("note" in HERO), "no hero note");
  const html = read("site/burnticker/index.html");
  assert.ok(html.includes(`data-hero-kicker>${HERO.kicker}</p>`));
  assert.doesNotMatch(html, /data-hero-note|Some coins never end/);
  for (const t of [HERO.kicker, HERO.title, HERO.sub]) assert.deepEqual(lintCopy(t).hits, []);
});

test("M11: a market question is quoted, never 'in 2026?. If not'", () => {
  const r = lockRule({ schema: "burnticker.rules/v1", oracle: "polymarket", series: null, market: `0x${"ab".repeat(32)}`, filter: {}, kind: "binary", binary: { onYes: { fractionOfPool: 1 }, onNo: null }, scalar: null, onVoid: "skip", floorUsd: "1", reserveSol: "0.02", vault: null, pair: null, onEnd: WIND_DOWN_ON_END }).rule;
  const s = oneShotAllLiner(r, "Will the CLARITY Act be signed into law in 2026?", "2027-01-01")!;
  assert.doesNotMatch(s, /\?\./);
  assert.match(s, /^burns everything if "Will the CLARITY Act be signed into law in 2026\?" settles YES\. If not/);
  assert.equal(oneShotAllLiner(r, "the Eagles win the Super Bowl", "2027-02-14"), "burns everything if the Eagles win the Super Bowl. If not, the pool burns down over four weeks after 2027-02-14");
});

test("M11: one holder is 'There is 1 holder.'", () => {
  assert.equal(holdersCountSentence(1), "There is 1 holder.");
  assert.equal(holdersCountSentence(1200), "There are 1,200 holders.");
  assert.doesNotMatch(read("src/app/burnticker/t/[ticker]/page.tsx"), /There are \$\{m\.holders\.count\} holders/);
});

test("M11: a season coin with no receipts has no rank", () => {
  const coin = (ticker: string, burns: number): SeasonCoinInput => ({ ticker, mint: `M${ticker}`, rule: nativeRule(teamSeries("nfl", ticker === "A" ? "SEA" : "DEN", "win", { kind: "season", year: 2026 } as never)), burns: Array.from({ length: burns }, () => ({ settledAt: "2026-10-01T00:00:00Z" })), burnedPct: 0, ended: false });
  const r = rankLines([coin("A", 0)]);
  assert.equal(r.get("MA")!.rank, null);
  assert.doesNotMatch(r.get("MA")!.line, /Ranked/);
  const r2 = rankLines([coin("A", 0), coin("B", 2)]);
  assert.equal(r2.get("MB")!.line, "Ranked 1 of 2 in NFL 2026 by receipts.");
});

test("F-14: the pairs tab never shows an internal label", () => {
  assert.equal(pairCardTitle("Seattle Seahawks win in ESPN game 2475453", "SEA", "DEN"), "Seattle Seahawks win, one game");
  assert.equal(pairCardTitle(null, "SEA", "DEN"), "$SEA vs $DEN");
  assert.doesNotMatch(read("src/app/burnticker/CoinsIndex.tsx"), /p\.seriesTitle \?\? p\.selectorKey/);
});

test("M11: the operator list on a coin page carries no internal labels", () => {
  const o = operatorPowersSummary(loadPowersRegister({}, ROOT));
  for (const line of [...o.can, ...o.cannot]) {
    assert.doesNotMatch(line, /Round \d+:|[Rr]e-check R\d|LAUNCHPAD-PATH|§\d|migrateCpLockNftScale|updatePlatformConfig|current status above|cheap veto/, line);
  }
  assert.ok(o.can.length > 5);
  // block G review L2: no stray dash after a removed label, every line a full sentence, no lowercase start after a full stop
  for (const line of [...o.can, ...o.cannot].filter((l) => /^[A-Z]/.test(l))) {
    assert.doesNotMatch(line, /\(\s*[—–-]/, line); assert.doesNotMatch(line, /\. [a-z]/, line); assert.match(line, /[.)]$/, line);
  }
});
