// Prelaunch audit 2026-10-16 F-15: /burnticker/t/%E0 and eight other malformed addresses answered a raw 500 (Next threw URIError decoding
// the dynamic segment before our handlers ran). The proxy answers 404 for any path whose percent-escapes do not decode.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { malformedPath } from "@/lib/burnticker/malformedPath";
import { openRegistry } from "@/lib/burnticker/registry";
import { config, proxy } from "../src/proxy.ts";

const ROOT = path.join(import.meta.dirname, "..");
const LISTED = ["/burnticker/t/%E0", "/burnticker/creator/%E0", "/burnticker/p/%E0", "/burnticker/derby/%E0", "/burnticker/embed/%E0", "/burnticker/leagues/nfl/%E0", "/api/burnticker/v1/tokens/%E0", "/api/burnticker/v1/creators/%E0", "/api/burnticker/v1/coins/%E0/calendar"];

test("every listed malformed address answers 404 (JSON under /api/, plain text for pages)", async () => {
  for (const p of LISTED) {
    assert.equal(malformedPath(p), true, p);
    const r = await proxy(new NextRequest(`https://burnticker.test${p}`));
    assert.equal(r.status, 404, p);
    if (p.startsWith("/api/")) assert.equal((await r.json()).code, "malformed-path", p);
    else assert.match(r.headers.get("content-type") ?? "", /text\/plain/, p);
  }
});

test("well-formed addresses pass through untouched, escapes included", async () => {
  for (const p of ["/burnticker/t/DEFICIT", "/burnticker/creator/%25E0", "/api/burnticker/v1/tokens/AJJ4XxCUYr8zzMWm8FYg3xh638LYAAApdNqWBqCK4oqj", "/burnticker/leagues/nfl/2026"]) {
    assert.equal(malformedPath(p), false, p);
    const r = await proxy(new NextRequest(`https://burnticker.test${p}`));
    assert.equal(r.headers.get("x-middleware-next"), "1", p);
  }
});

test("HB-100 (hourly run 11): a well-formed coin page for a coin this site does not have is never refused as malformed; it goes on to the page (the rewrite is off since publish 103)", async () => {
  assert.equal(malformedPath("/burnticker/t/%24RAYS"), false);
  // HB-152: the gate reads the registry read-only and never creates it, so the test's own (empty) registry is made first
  openRegistry(process.env.BURNTICKER_DB!).db.close();
  // warmed and cleared: a cold import longer than the 300 ms budget serves the page (fails open), and the earlier tests' read of the
  // then-missing registry is forgotten
  (await import("@/lib/burnticker/coinPageGate")).clearCoinPageGate();
  const r = await proxy(new NextRequest("https://burnticker.test/burnticker/t/%24RAYS"));
  // publish 103: the rewrite answered 500 behind Caddy, so it is off (src/proxy.ts UNKNOWN_COIN_REWRITE); the page's layout answers 404
  assert.equal(r.headers.get("x-middleware-rewrite"), null);
  assert.notEqual(r.status, 500);
});

test("the proxy only sees paths with a %: its matcher, and it reads no body", () => {
  const re = new RegExp(`^${config.matcher[0].replace("/:path(.*%.*)", "/(.*%.*)")}$`);
  assert.ok(re.test("/burnticker/t/%E0")); assert.ok(!re.test("/burnticker/t/DEFICIT")); assert.ok(!re.test("/api/burnticker/v1/media"));
  const src = fs.readFileSync(path.join(ROOT, "src/proxy.ts"), "utf8");
  assert.doesNotMatch(src, /request\.(json|text|formData|arrayBuffer|body)\b/);
});
