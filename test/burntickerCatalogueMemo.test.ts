// owner, 2026-10-12: the launch page took over a second to load because /api/burnticker/catalogue rebuilt every source card per request.
// catalogueSources is memoised per minute and per includeConfig; the second call in a minute is the same object, a new minute rebuilds.
import { test } from "node:test";
import assert from "node:assert/strict";
import { catalogueSources, forgetCatalogueMemo } from "@/lib/burnticker/api/handlers";

test("catalogueSources answers from the memo within a minute and rebuilds on a new minute or a different includeConfig", () => {
  forgetCatalogueMemo();
  const t0 = Date.UTC(2026, 9, 12, 12, 0, 5);
  const a = catalogueSources(t0), b = catalogueSources(t0 + 20_000);
  assert.equal(a, b, "same minute, same object");
  const c = catalogueSources(t0 + 61_000);
  assert.notEqual(a, c, "a new minute rebuilds");
  assert.deepEqual(a.tiers, c.tiers);
  const d = catalogueSources(t0, { includeConfig: true });
  assert.notEqual(a, d, "includeConfig is part of the key");
  const t1 = performance.now(); catalogueSources(t0 + 30_000); const warm = performance.now() - t1;
  assert.ok(warm < 20, `a memo hit takes under 20 ms (took ${warm.toFixed(1)} ms)`);
  forgetCatalogueMemo();
});
