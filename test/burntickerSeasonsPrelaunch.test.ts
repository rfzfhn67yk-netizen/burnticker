// SEASONS BEFORE LAUNCH (site audit #9, BT-10, 2026-10-11): one banner and a compact list instead of 25 empty cards; league pages lead
// with their teams; no "launch a coin for this team" link (and no Derby create link) while creator launches are closed.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (f: string) => fs.readFileSync(f, "utf8");
const league = read("src/app/burnticker/leagues/[league]/[season]/page.tsx");

test("the leagues index: one banner and the compact list while empty; the cards only once a league has a coin", () => {
  const p = read("src/app/burnticker/leagues/page.tsx");
  assert.match(p, /const empty = !err && ix\.sports\.every\(\(sp\) => sp\.leagues\.every\(\(l\) => l\.coinsThisSeason === 0\)\);/);
  assert.equal((p.match(/data-prelaunch-banner/g) ?? []).length, 1, "one banner");
  assert.doesNotMatch(p, /kind="not-launched"/, "no dotted NOT LAUNCHED box");
  assert.match(p, /data-demo-scoreboard[\s\S]*Example only\. These coins and counts are not live data\./);
  assert.ok(p.indexOf("data-leagues-compact") < p.indexOf("ix.sports.map((s) => (\n        <section"), "compact list first, cards in the populated branch");
});

test("league pages lead with Teams; empty scoreboard and settled games collapse into one line", () => {
  assert.ok(league.indexOf('aria-label="teams"') < league.indexOf('aria-label="scoreboard"'), "Teams before Scoreboard");
  assert.ok(league.indexOf('aria-label="teams"') < league.indexOf('aria-label="settled games"'));
  assert.match(league, /p\.boards\.length === 0 && p\.games\.rows\.length === 0 && p\.champions\.length === 0 \? \(\s*<p[^>]*data-league-empty>/);
});

test("no launch invitation while closed: every team launch link and the Derby create link sit behind launch.open", () => {
  const links = [...league.matchAll(/launch a coin for this team/g)].length;
  // website-20 item 119: a closed host shows nothing; a preview host shows "preview a coin for this team" (the wizard runs, nothing is sent)
  assert.equal(links, [...league.matchAll(/\{\(launch\.open \|\| launchPreview\) && <Link[^>]*href=\{t\.launchHref\}>\{launch\.open \? "launch a coin for this team" : "preview a coin for this team"\}<\/Link>\}/g)].length);
  assert.match(league, /const launchPreview = !launch\.open && siteLaunchState\([a-z.]+\)\.wizard;/);
  assert.ok(links >= 1);
  const derby = read("src/app/burnticker/derby/page.tsx");
  assert.match(derby, /\{launchOpen\s*\n?\s*\? <Link[^>]*href=\{`\/burnticker\/launch\?derby=1/);
  assert.match(derby, /\{launchOpen \? <Link className="underline" href=\{`\/burnticker\/launch\?derby=1/);
});
