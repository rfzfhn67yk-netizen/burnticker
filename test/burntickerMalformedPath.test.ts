// Prelaunch audit 2026-10-16 F-15: /burnticker/t/%E0 and eight other malformed addresses answered a raw 500 (Next threw URIError decoding
// the dynamic segment before our handlers ran). The proxy answers 404 for any path whose percent-escapes do not decode.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { malformedPath } from "@/lib/burnticker/malformedPath";
import { config, proxy } from "../src/proxy.ts";

const ROOT = path.join(import.meta.dirname, "..");
const LISTED = ["/burnticker/t/%E0", "/burnticker/creator/%E0", "/burnticker/p/%E0", "/burnticker/derby/%E0", "/burnticker/embed/%E0", "/burnticker/leagues/nfl/%E0", "/api/burnticker/v1/tokens/%E0", "/api/burnticker/v1/creators/%E0", "/api/burnticker/v1/coins/%E0/calendar"];

test("every listed malformed address answers 404 (JSON under /api/, plain text for pages)", async () => {
  for (const p of LISTED) {
    assert.equal(malformedPath(p), true, p);
    const r = proxy(new NextRequest(`https://burnticker.test${p}`));
    assert.equal(r.status, 404, p);
    if (p.startsWith("/api/")) assert.equal((await r.json()).code, "malformed-path", p);
    else assert.match(r.headers.get("content-type") ?? "", /text\/plain/, p);
  }
});

test("well-formed addresses pass through untouched, escapes included", () => {
  for (const p of ["/burnticker/t/DEFICIT", "/burnticker/t/%24RAYS", "/burnticker/creator/%25E0", "/api/burnticker/v1/tokens/AJJ4XxCUYr8zzMWm8FYg3xh638LYAAApdNqWBqCK4oqj", "/burnticker/leagues/nfl/2026"]) {
    assert.equal(malformedPath(p), false, p);
    const r = proxy(new NextRequest(`https://burnticker.test${p}`));
    assert.equal(r.headers.get("x-middleware-next"), "1", p);
  }
});

test("the proxy only sees paths with a %: its matcher, and it reads no body", () => {
  const re = new RegExp(`^${config.matcher[0].replace("/:path(.*%.*)", "/(.*%.*)")}$`);
  assert.ok(re.test("/burnticker/t/%E0")); assert.ok(!re.test("/burnticker/t/DEFICIT")); assert.ok(!re.test("/api/burnticker/v1/media"));
  const src = fs.readFileSync(path.join(ROOT, "src/proxy.ts"), "utf8");
  assert.doesNotMatch(src, /request\.(json|text|formData|arrayBuffer|body)\b/);
});
