// A DRAFT IS NEVER PUBLISHED (2026-10-13: three launch-probe drafts, never created on chain, reached tokens.html and t/<ticker>/).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
test("the keeper's publish loop skips drafts and expired drafts, and keeps every row for the site keys", () => {
  const s = fs.readFileSync("scripts/burnticker-keeper.mts", "utf8");
  assert.match(s, /const all = registry\.tokens\(\);/);
  assert.match(s, /siteKeysOf\(all\.map/);
  // 2026-10-13 (read cache): the filtered list also feeds the batch read, so it is named before the loop
  assert.match(s, /const published = all\.filter\(\(t\) => t\.status !== "draft" && t\.status !== "expired"\);/);
  assert.match(s, /for \(const t of published\) \{/);
});
