// Prelaunch audit 2026-10-16 F-24: bare field reads next to the H7 guards (s.burned.count, s.trust.registerUrl, f.legs.map,
// m.holders.top10.map, latest.settledAt.slice on the coin page; the supply line on the pair page) blanked the page when an older status
// file lacked the field. They go through the safeFormat helpers now.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { counted, grouped, headOf, listOf } from "@/lib/burnticker/safeFormat";

const ROOT = path.join(import.meta.dirname, "..");

test("the helpers answer a dash or an empty list for a missing field", () => {
  assert.equal(grouped("1234567.5"), "1,234,567.5"); assert.equal(grouped(undefined), "—"); assert.equal(grouped("abc"), "—"); assert.equal(grouped(1000), "1,000");
  assert.equal(counted(1, "burn"), "1 burn"); assert.equal(counted(3, "burn"), "3 burns"); assert.equal(counted(undefined, "burn"), "— burns");
  assert.deepEqual(listOf(undefined), []); assert.deepEqual(listOf([1]), [1]);
  assert.equal(headOf("2026-10-16T12:00:00Z", 10), "2026-10-16"); assert.equal(headOf(null, 10), "—");
});

test("the coin and pair pages no longer read those fields bare", () => {
  const coin = fs.readFileSync(path.join(ROOT, "src/app/burnticker/t/[ticker]/page.tsx"), "utf8");
  for (const re of [/s\.burned\.count/, /s\.burned\.total/, /s\.trust\.registerUrl/, /s\.trust\.operator\.placeholder/, /\bf\.legs\.map/, /m\.holders\.top10\.map/, /latest\.settledAt\.slice/, /s\.trust\.teamAllocationPct/]) assert.doesNotMatch(coin, re, String(re));
  const pair = fs.readFileSync(path.join(ROOT, "src/app/burnticker/p/[pairId]/page.tsx"), "utf8");
  assert.doesNotMatch(pair, /const fmt = \(s: string\) => \{ const \[w, f\] = s\.split/);
  assert.doesNotMatch(pair, /status\.supply\.initial/);
});
