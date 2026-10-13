// WEBSITE-21, WIRING-SOURCES4: "A coin's record close" in the Coin vs Coin tile (derby/highTile.ts, CoinVsCoinTile.tsx RecordClose) and
// the review's baseline read (POST /v1/derby/high → derby/adapter.ts highBaseline). The tile's rule is exactly the rule the library
// tests lock (test/burntickerSources4.test.ts ruleOf); the server answers the baseline, its refusal or the review's current-high line;
// every new sentence passes the copy lint and never says the words the lint refuses ("all-time high", "ATH", "price").
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { lockRule, validateRule, isOneShot } from "@/lib/burnticker/rules";
import { rulesSha256 } from "@/lib/burnKeeper/rules";
import { openRegistry } from "@/lib/burnticker/registry";
import { DerbyAdapter, type HermesLike } from "@/lib/burnticker/derby/adapter";
import { derbyAdmission } from "@/lib/burnticker/derby/admission";
import { derbySeriesId } from "@/lib/burnticker/derby/spec";
import { highReview, HIGH_ALREADY_SENTENCE, type HighSpec } from "@/lib/burnticker/derby/high";
import {
  HIGH_CHOICE_LABEL, HIGH_CHOICE_LINE, HIGH_NEW_DAY, HIGH_NOT_READ_HERE, HIGH_ONCE_DAYS, HIGH_PATTERNS, HIGH_PICKER_LABEL, HIGH_PYTH_ONLY, HIGH_READING, HIGH_RUN_NOTE,
  HIGH_SINGLE_REASON, HIGH_SPAN_CHOICES, HIGH_SPAN_LABEL, PAIR_CHOICE_LABEL, PAIR_CHOICE_LINE, highBlock, highGreyed, highHashInput, highRule, highShares, highSpanOf, highUnderlyingProblem,
} from "@/lib/burnticker/derby/highTile";
import { v1DerbyHighBaseline } from "@/lib/burnticker/api/derby";
import { buildLaunchReview } from "@/lib/burnticker/launchReview";
import { describeRule } from "@/lib/burnticker/describe";
import type { Platform } from "@/lib/burnticker/server";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import { B, WIF, WIF_FEED, fixtureFetch } from "./burntickerDerbyHelpers.ts";

const cfg = loadCopyLintConfig();
const plain = (t: string) => {
  assert.deepEqual(lintCopy(t, cfg).hits.map((h) => `${h.phrase} (${h.rule})`), [], t);
  assert.doesNotMatch(t, /\bwill\b|\bbuy|\bprice\b|all-time high|\bATH\b|coming soon/i, t);
};
const read = (f: string) => fs.readFileSync(f, "utf8");
const ALL_BASE = { kind: "all", since: "2024-01-01", through: "2026-10-03", high: "4.5", highOn: "2024-03-30", last: "1", feedBegan: true } as const;
const NOW = Date.parse("2026-10-04T15:00:00Z");

describe("website-21 SOURCES4: the words", () => {
  test("every label and line passes the copy lint", () => {
    for (const s of [HIGH_CHOICE_LABEL, HIGH_CHOICE_LINE, PAIR_CHOICE_LABEL, PAIR_CHOICE_LINE, HIGH_PICKER_LABEL, HIGH_SPAN_LABEL, ...HIGH_SPAN_CHOICES.map((c) => c.label), HIGH_PATTERNS.every.label, HIGH_PATTERNS.every.line, HIGH_PATTERNS.once.label, HIGH_PATTERNS.once.line,
      HIGH_SINGLE_REASON, HIGH_RUN_NOTE, HIGH_PYTH_ONLY, HIGH_NOT_READ_HERE, HIGH_READING, HIGH_NEW_DAY]) plain(s);
    assert.equal(HIGH_CHOICE_LABEL, "A coin's record close"); assert.equal(HIGH_CHOICE_LINE, "Burn when a coin's daily close beats its record.");
    assert.deepEqual(HIGH_SPAN_CHOICES.map((c) => [c.span, c.label]), [["all", "Its whole history"], [30, "The last 30 days"], [90, "The last 90 days"]]);
    assert.equal(HIGH_PATTERNS.every.label, "Every time it sets a record close"); assert.equal(HIGH_PATTERNS.once.label, "Once, on the next record close");
  });
});

describe("website-21 SOURCES4: the rule the tile builds", () => {
  for (const span of ["all", 30, 90] as const) for (const once of [false, true]) {
    test(`span ${span}, ${once ? "once" : "every record close"}: the same rule the library locks, admitted today, refused tomorrow`, async () => {
      const baseline = span === "all" ? ALL_BASE : { kind: "window" as const, through: "2026-10-03", closes: Array.from({ length: span }, (_, i) => (i === 3 ? "2.5" : "2")) };
      const block = highBlock({ u: WIF, span, once, baseline, nowMs: NOW });
      assert.deepEqual(block.season, { start: "2026-10-04", days: once ? HIGH_ONCE_DAYS : null });
      const sh = highShares(once);
      const r = highRule(block, rulesSha256(highHashInput(block)), sh.fallback);
      assert.equal(r.series, derbySeriesId(block as HighSpec, rulesSha256));
      validateRule(r); const locked = lockRule(r).rule;
      assert.equal(isOneShot(locked), once);
      assert.equal(sh.fallback, once ? 1 : 0.02);
      assert.deepEqual(await derbyAdmission(locked, { registry: openRegistry(":memory:"), fetchImpl: fixtureFetch(), now: NOW }), []);
      assert.match((await derbyAdmission(locked, { registry: openRegistry(":memory:"), fetchImpl: fixtureFetch(), now: NOW + 86_400_000 })).map((x) => x.reason).join(";"), /read for a launch on 2026-10-04/);
      const t = describeRule(locked, { ticker: "WIFREC" });
      for (const s of [t.lead, t.oneLiner, t.paragraph]) { assert.deepEqual(lintCopy(s, cfg).hits, [], s); assert.doesNotMatch(s, /\bwill\b|all-time high|\bATH\b/i, s); }
      plain(highReview({ span, baseline }).line);
    });
  }
  test("When it does not happen and Winner takes the burn are greyed, each with its reason", () => {
    const r = highRule(highBlock({ u: WIF, span: "all", once: false, baseline: ALL_BASE, nowMs: NOW }), "a".repeat(64), 0.02);
    const g = highGreyed(r);
    assert.deepEqual(g.map((x) => x.id), ["fade", "winner"]);
    assert.equal(g[0].reason, "Burn Derby rules cannot be inverted."); assert.equal(g[1].reason, HIGH_SINGLE_REASON);
    assert.throws(() => validateRule({ ...r, pair: { pairId: "x", side: "A", counterpartMint: null } }), /single coin/);
  });
  test("the body checks: a span, a Pyth feed", () => {
    assert.equal(highSpanOf("all"), "all"); assert.equal(highSpanOf("30"), 30); assert.equal(highSpanOf(90), 90); assert.equal(highSpanOf(7), null);
    assert.equal(highUnderlyingProblem(WIF), null);
    assert.equal(highUnderlyingProblem({ ...WIF, pyth: null }), HIGH_PYTH_ONLY);
    assert.ok(highUnderlyingProblem(null));
  });
});

describe("website-21 SOURCES4: POST /v1/derby/high", () => {
  const hermesWith = (have: Map<number, string>): HermesLike => ({ atBoundary: async (_f, ts) => { const v = have.get(ts * 1000); return v ? { ok: true, point: { feed: WIF_FEED, price: "0", conf: "0", expo: 0, value: v, publishTime: ts, slot: null, updateSha256: "0".repeat(64), updateBase64: "", url: "x" } } : { ok: false, reason: "no update" }; } });
  const platformWith = (have: Map<number, string> | null) => ({ oracles: { derby: have ? new DerbyAdapter({ registry: openRegistry(":memory:"), hermes: hermesWith(have), pools: null, fetchImpl: fixtureFetch(), now: () => B(4) + 3600_000 }) : undefined } }) as unknown as Platform;
  test("the baseline and the review's line; today in UTC", async () => {
    const r = await v1DerbyHighBaseline(platformWith(new Map([[B(1), "2"], [B(2), "3"], [B(3), "2.5"], [B(4), "2.6"]])), { u: WIF, span: "all" }, B(4) + 3600_000);
    assert.equal(r.status, 200);
    const j = r.body as { today: string; baseline: unknown; line: string };
    assert.equal(j.today, "2026-10-04");
    assert.deepEqual(j.baseline, { kind: "all", since: "2026-09-30", through: "2026-10-03", high: "3", highOn: "2026-10-01", last: "2.6", feedBegan: true });
    assert.equal(j.line, "The highest daily close since 2026-09-30 is 3, on 2026-10-01. The last close, on 2026-10-03, is 2.6, which is 13.33% below it.");
    plain(j.line);
  });
  test("a reference at its record is refused with the library's sentence; no adapter, no feed, no span", async () => {
    const top = await v1DerbyHighBaseline(platformWith(new Map([[B(1), "2"], [B(2), "3"], [B(3), "2.5"], [B(4), "3.5"]])), { u: WIF, span: "all" }, B(4) + 3600_000);
    const tr = (top.body as { refusal: { code: string; reason: string } }).refusal; assert.equal(tr.code, "already-decided"); assert.ok(tr.reason.startsWith(HIGH_ALREADY_SENTENCE), tr.reason); plain(tr.reason);
    const none = await v1DerbyHighBaseline(platformWith(null), { u: WIF, span: 30 }, NOW);
    assert.deepEqual((none.body as { refusal: unknown }).refusal, { code: "no-readings", reason: HIGH_NOT_READ_HERE });
    assert.equal((await v1DerbyHighBaseline(platformWith(null), { u: { ...WIF, pyth: null }, span: 30 }, NOW)).status, 400);
    assert.equal((await v1DerbyHighBaseline(platformWith(null), { u: WIF, span: 7 }, NOW)).status, 400);
  });
  test("the route, the spec entry and the docs row", () => {
    assert.match(read("src/app/api/burnticker/v1/derby/high/route.ts"), /export async function POST\(req: Request\) \{\n  return runV1\("derbyHighBaseline", req, async \(\) => v1DerbyHighBaseline\(platform\(\), await readJson\(req\)\)\);/);
    assert.match(read("src/lib/burnticker/api/derbySpec.ts"), /operationId: "derbyHighBaseline", method: "POST" as const, path: "\/derby\/high"/);
    assert.match(read("docs/burnticker/api.md"), /\| POST \| `\/derby\/high` \|/);
  });
  test("the review takes the tile's single coin with no problem from its rule", () => {
    const block = highBlock({ u: WIF, span: "all", once: false, baseline: ALL_BASE, nowMs: NOW });
    const out = buildLaunchReview({ rule: highRule(block, rulesSha256(highHashInput(block)), 0.02), ticker: "WIFREC", name: "WIF Record Close", raiseSol: "85" }, { env: { BURNTICKER_CLUSTER: "devnet", BURNTICKER_CREATOR_LAUNCHES_ENABLED: "1" }, now: NOW });
    assert.ok("review" in out, JSON.stringify(out));
    assert.deepEqual(out.review.problems.filter((p) => /derby|record/i.test(p)), []);
  });
});

describe("website-21 SOURCES4: the tile", () => {
  const tile = read("src/app/burnticker/launch/CoinVsCoinTile.tsx");
  test("two choices in the tile; the record close reads the baseline, shows its refusal and its line, re-reads on a new UTC day", () => {
    assert.match(tile, /role="radiogroup" aria-label="What the coins follow" data-derby-kind/);
    assert.match(tile, /\{k === "pair" \? PAIR_CHOICE_LABEL : HIGH_CHOICE_LABEL\}/);
    assert.match(tile, /<RecordClose blocked=\{blocked\} customImages=\{customImages\} phase=\{phase\} onPhase=\{onPhase\} onAnswers=\{onAnswers\} \/>/);
    assert.match(tile, /fetch\("\/api\/burnticker\/v1\/derby\/high", \{ method: "POST"/);
    assert.match(tile, /data-high-refusal>\{base\.refusal\}<\/p>/);
    assert.match(tile, /notes=\{\[\.\.\.\(base\?\.line \? \[base\.line\] : \[\]\), \.\.\.\(once \? \[HIGH_RUN_NOTE\] : \[\]\)\]\}/);
    assert.match(tile, /if \(base\?\.today && utcDay\(Date\.now\(\)\) !== base\.today\) \{ setNow\(Date\.now\(\)\); setErr\(HIGH_NEW_DAY\); return; \}/);
    assert.match(tile, /const got = await prepareIfCurrent\(sentRev, \(\) => curRev\.current,/);
    assert.match(tile, /blocked=\{blocked \?\? \(reviewCurrent \? null : REVIEW_UPDATING\)\}/);
  });
});
