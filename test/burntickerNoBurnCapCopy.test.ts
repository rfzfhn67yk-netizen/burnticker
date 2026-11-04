// NO BURN CAP IN THE SERVED COPY (owner decision 2026-10-25, reaffirmed twice). The burn_receipts program no longer has a burn-pool cap
// (the 25 SOL pre-audit cap, raise-only behind a 48-hour timelock) or a per-run bound (one crank spent at most 2% of the pool's WSOL
// reserve, the rest spread over six-hour windows of smaller pieces); the platform authority holds no cap-raise power. This test collects
// the copy the site serves: every exported string of the copy modules, the outputs of their builders for a spread of rules, the text of
// transparency.json and current-status.json, and the source of the src/app/burnticker pages, and fails on any mention of a cap that no
// longer exists. It also pins the new sentence where the launch review and the transparency page describe the burn. No network.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import * as rules from "@/lib/burnticker/rules";
import * as launchReview from "@/lib/burnticker/launchReview";
import * as guidedLaunch from "@/lib/burnticker/guidedLaunch";
import * as tokenPage from "@/lib/burnticker/tokenPage";
import * as spreadCopy from "@/lib/burnticker/spreadCopy";
import * as raisePresets from "@/lib/burnticker/raisePresets";
import * as safeguards from "@/lib/burnticker/safeguards";
import * as simulator from "@/lib/burnticker/simulator";
import * as verify from "@/lib/burnticker/verify";
import * as burnWalkthrough from "@/lib/burnticker/burnWalkthrough";
import * as trust from "@/lib/burnticker/trust";
import * as powerPlain from "@/lib/burnticker/powerPlain";
import * as ruleEdgeCases from "@/lib/burnticker/ruleEdgeCases";
import * as describeMod from "@/lib/burnticker/describe";
import { firstPartyRule } from "@/lib/burnticker/wizard";
import { nwsSeries } from "@/lib/burnticker/sources/nws";
import { DEFAULT_ON_END, lockRule, type BurnRule } from "@/lib/burnticker/rules";
import { CREATOR_LAUNCHES_FLAG } from "@/lib/burnticker/creatorLaunches";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const strings = (o: unknown, seen = new Set<unknown>()): string[] => {
  if (typeof o === "string") return [o];
  if (!o || typeof o !== "object" || seen.has(o)) return [];
  seen.add(o);
  return (Array.isArray(o) ? o : Object.values(o)).flatMap((v) => strings(v, seen));
};
const walk = (d: string): string[] => fs.readdirSync(path.join(ROOT, d), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : /\.(tsx?|mjs)$/.test(e.name) ? [`${d}/${e.name}`] : []));
/** Source without comments (a block comment, or // after whitespace or punctuation; a URL's "://" survives). */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[\s;{}(,])\/\/.*$/gm, "$1");

/** The canonical no-cap sentences and negations: allowed, removed before the scan. */
const ALLOWED = [
  spreadCopy.BURN_RUNS_SENTENCE, spreadCopy.NO_BURN_CAP_SENTENCE, spreadCopy.NO_CAP_TRANSPARENCY_SENTENCE, spreadCopy.PLATFORM_AUTHORITY_NO_CAP_SENTENCE,
  /no (burn-pool|platform) cap/gi, /both burn caps/gi, /no cap on the size of a burn/gi, /no longer holds a cap-raise power/gi, /refuses every cap raise/gi,
  /\bno cap\b/gi,
];
const strip = (s: string) => ALLOWED.reduce<string>((t, a) => (typeof a === "string" ? t.split(a).join(" ") : t.replace(a, " ")), s);
const FORBIDDEN: [string, RegExp][] = [
  ["a burn-pool cap", /burn[- ]pool cap/i],
  ["a pool cap", /\bpool cap\b/i],
  ["a 25 SOL cap", /25 SOL (cap|default|per burn)|cap (is|of) 25 SOL|at most 25 SOL/i],
  ["a 2% per-run bound", /\b2 ?% of the (trading pool|pool's|SOL|reserve)|at most 2 ?%|2 ?% reserve cap|2 ?%-of-reserve/i],
  ["the Capped state", /\bCapped\b/],
  ["a cap raise", /cap[- ]raise|raise the cap|cap rises|the cap ends|pre-audit/i],
  ["six-hour windows of pieces", /six-hour|smaller pieces|random times|in slices/i],
];
const scan = (where: string, texts: readonly string[]): string[] => texts.flatMap((t) => { const s = strip(t); return FORBIDDEN.filter(([, re]) => re.test(s)).map(([what]) => `${where}: ${what}: ${t.slice(0, 160)}`); });

const env = { BURNTICKER_CLUSTER: "mainnet", [CREATOR_LAUNCHES_FLAG]: "1", BURNTICKER_DISPERSAL: "1" };
const recurring = (f: number) => ({ ...firstPartyRule(nwsSeries("high", "DEN", 90), f), onEnd: { ...DEFAULT_ON_END } } as BurnRule);
const poly = (f: number): BurnRule => ({ schema: "burnticker.rules/v1", oracle: "polymarket", series: null, market: "0x" + "ab".repeat(32), filter: {}, kind: "binary", binary: { onYes: { fractionOfPool: f }, onNo: null }, scalar: null, onVoid: "skip", floorUsd: "1", reserveSol: "0.02", vault: null, onEnd: { ...DEFAULT_ON_END } } as unknown as BurnRule);

describe("no burn cap in the served copy (owner decision 2026-10-25)", () => {
  test("the scanner catches every old sentence and lets the new ones through", () => {
    const OLD = [
      "When a reading settles, the burn runs right away. One burn spends at most 2% of the trading pool's SOL.",
      "The default burn-pool cap is 25 SOL. The platform authority can raise the cap after a public 48-hour wait.",
      "Capped: each burn pool spends from at most the burn-pool cap, and anything above it waits until the cap rises or ends.",
      "The rest is burned in smaller pieces at random times over a six-hour window, at least 20 minutes apart.",
      "Whichever raise you choose, one burn run spends at most 2% of the pool's SOL.",
      "The second is the platform authority, which can only raise the pre-audit burn-pool cap, behind a 48 h time lock.",
    ];
    for (const o of OLD) assert.ok(scan("old", [o]).length > 0, o);
    assert.deepEqual(scan("new", [spreadCopy.BURN_RUNS_SENTENCE, spreadCopy.NO_BURN_CAP_SENTENCE, spreadCopy.NO_CAP_TRANSPARENCY_SENTENCE, spreadCopy.PLATFORM_AUTHORITY_NO_CAP_SENTENCE, spreadCopy.SPREAD_DEFICIT_LINE]), []);
    assert.ok(strings({ rules, launchReview, guidedLaunch, tokenPage, spreadCopy }).length > 200, "the collection is not empty");
  });

  test("the exported copy of every copy module", () => {
    const mods: Record<string, unknown> = { rules, launchReview, guidedLaunch, tokenPage, spreadCopy, raisePresets, safeguards, simulator, verify, burnWalkthrough, trust, powerPlain, ruleEdgeCases, describe: describeMod };
    const hits = Object.entries(mods).flatMap(([name, m]) => scan(name, strings(m)));
    assert.deepEqual(hits, []);
  });

  test("the builders' outputs: the budget row, one-shot sentences, the whole-pool line, what to know first, the simulator, the rule text", () => {
    const texts: string[] = [];
    for (const f of [0.02, 0.1, 0.25]) {
      const r = recurring(f);
      texts.push(...strings(guidedLaunch.budgetCopy(r, f, "1 day")), ...strings(describeMod.describeRule(r, { ticker: "DENHOT" })), ...strings(simulator.simulateResults(lockRule(r).rule, { poolSol: "100", tradingPoolSol: "10", ticker: "DENHOT" })));
    }
    for (const f of [1, 0.5]) {
      texts.push(...strings(guidedLaunch.budgetCopy(poly(f), f, null, { raiseSol: "85" })), ...guidedLaunch.oneShotSentences({ share: f, happened: "it happened", subject: "it" }), ...strings(describeMod.describeRule(poly(f), { ticker: "ONCE" })));
      const v = launchReview.buildLaunchReview({ rule: poly(f), ticker: "TESTCOIN", name: "Test Coin" }, { env, reserved: new Set() });
      texts.push(...strings(v));
    }
    texts.push(guidedLaunch.wholePoolSliceLine("85"), guidedLaunch.wholePoolSliceLine("24"), ...guidedLaunch.upfrontLines(["24", "40", "60", "85"]), ...launchReview.PREREQUISITE_STATES);
    assert.deepEqual(scan("builders", texts), []);
  });

  test("transparency.json and current-status.json, as text", () => {
    for (const f of ["config/burnticker/transparency.json", "config/burnticker/current-status.json"]) assert.deepEqual(scan(f, strings(JSON.parse(read(f)))), []);
  });

  test("the src/app/burnticker pages (code, comments left out)", () => {
    const hits = walk("src/app/burnticker").flatMap((f) => scan(f, code(read(f)).split("\n")));
    assert.deepEqual(hits, []);
  });

  test("the new truth is said where the launch review and the transparency page describe the burn", () => {
    assert.equal(spreadCopy.SPREAD_REVIEW_LINE, "When a reading settles, the burn runs right away and spends the rule's full share of the burn pool in one run.");
    assert.match(read("src/app/burnticker/launch/page.tsx"), /^\s+notes\.push\(SPREAD_REVIEW_LINE\);/m, "the launch page's review notes, on every host");
    const v = launchReview.buildLaunchReview({ rule: recurring(0.02), ticker: "DENHOT", name: "Denver Heat" }, { env, reserved: new Set() });
    assert.ok("review" in v);
    if ("review" in v) assert.ok(v.review.prerequisites.includes(`${spreadCopy.BURN_RUNS_SENTENCE} ${spreadCopy.NO_BURN_CAP_SENTENCE}`), "the server review's prerequisites");
    const t = JSON.parse(read("config/burnticker/transparency.json")) as { limitations: { id: string; text: string }[]; wallets: { role: string; description: string }[] };
    assert.ok(t.limitations.find((l) => l.id === "no-burn-cap")!.text.startsWith(spreadCopy.NO_CAP_TRANSPARENCY_SENTENCE));
    assert.ok(t.wallets.find((w) => w.role === "squads-vault")!.description.includes(spreadCopy.PLATFORM_AUTHORITY_NO_CAP_SENTENCE));
    assert.match(read("src/app/burnticker/trust/page.tsx"), /\{NO_BURN_CAP_SENTENCE\} \{NO_CAP_TRANSPARENCY_SENTENCE\}/);
    assert.ok(trust.buildTrustPage.length >= 1);
  });
});
