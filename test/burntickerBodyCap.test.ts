// HB-172 (seventh prelaunch audit LA7-3, 2026-10-20): the launch review parsed 6.5 MB bodies on the 120-request read bucket. Every v1 POST
// that carries no image now reads at most 256 KB and answers 413 above it; the bundle route (coin images) keeps the 6.5 MB cap with a
// 413 too. In process, in-memory registry (makeWorld), no RPC.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeWorld } from "./burntickerApiHelpers.ts";

process.env.BURNTICKER_CREATOR_LAUNCHES_ENABLED = "1"; process.env.BURNTICKER_PREFLIGHT_STRICT = "0";
await makeWorld();
const { POST: REVIEW } = await import("@/app/api/burnticker/v1/launch/review/route");
const { POST: VALIDATE } = await import("@/app/api/burnticker/v1/rules/validate/route");
const { limiter, readJsonLimited, SMALL_JSON_BODY, MAX_JSON_BODY } = await import("@/lib/burnticker/api/http");
const { firstPartyRule } = await import("@/lib/burnticker/wizard");
const { lintCopy } = await import("@/lib/launch/copyLint");

const H = (ip: string) => ({ "content-type": "application/json", origin: "http://localhost", host: "localhost", "x-forwarded-for": ip });
const rule = firstPartyRule("usgs.quakes:6", 0.02);
const post = (url: string, body: string, ip: string) => new Request(`http://localhost${url}`, { method: "POST", headers: H(ip), body });

test("a 300 KB review answers 413 with a plain sentence, with or without a Content-Length; a normal-sized body is still read", async () => {
  limiter.reset();
  const declared = JSON.stringify({ rule, ticker: "CAPTEST", name: "Cap Test", note: "x".repeat(300_000) });
  const d = await REVIEW(new Request("http://localhost/api/burnticker/v1/launch/review", { method: "POST", headers: { ...H("9.9.9.4"), "content-length": String(Buffer.byteLength(declared)) }, body: declared }));
  assert.equal(d.status, 413);
  // (without a Content-Length, below, the body streams in and is cut at the cap; the review clones the request first, and an awaited
  // cancel of a cloned stream never settled, which held that request open: http.ts no longer awaits it)
  limiter.reset();
  const big = await REVIEW(post("/api/burnticker/v1/launch/review", JSON.stringify({ rule, ticker: "CAPTEST", name: "Cap Test", note: "x".repeat(300_000) }), "9.9.9.1"));
  assert.equal(big.status, 413);
  const j = await big.json() as { error: string; code: string };
  assert.equal(j.code, "body-too-large");
  assert.equal(j.error, "This request is too large. The limit here is 256 KB.");
  assert.deepEqual(lintCopy(j.error).hits, []);
  // a normal-sized body is read and answered as before (the rule check reads no source; a full review would read live feeds)
  const small = await VALIDATE(post("/api/burnticker/v1/rules/validate", JSON.stringify({ rule, note: "y".repeat(200_000) }), "9.9.9.2"));
  assert.equal(small.status, 200, await small.clone().text());
});

test("a chunked body with no Content-Length is cut at the cap while it streams", async () => {
  limiter.reset();
  const chunk = new TextEncoder().encode("x".repeat(64 * 1024));
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({ pull(c) { if (sent++ < 10) c.enqueue(chunk); else c.close(); } });
  const r = await VALIDATE(new Request("http://localhost/api/burnticker/v1/rules/validate", { method: "POST", headers: H("9.9.9.3"), body: stream, duplex: "half" } as RequestInit));
  assert.equal(r.status, 413);
  assert.ok(sent <= 6, `stopped reading early (read ${sent} chunks)`);
});

test("readJsonLimited: under the cap parses, over it is tooLarge, bad JSON is a null body", async () => {
  const rq = (s: string) => new Request("http://localhost/x", { method: "POST", body: s });
  assert.deepEqual(await readJsonLimited(rq('{"a":1}')), { body: { a: 1 } });
  assert.deepEqual(await readJsonLimited(rq("[1]")), { body: null });
  assert.deepEqual(await readJsonLimited(rq("{")), { body: null });
  const over = await readJsonLimited(rq(JSON.stringify({ a: "y".repeat(SMALL_JSON_BODY) })));
  assert.ok("tooLarge" in over && over.tooLarge.status === 413);
  const fine = await readJsonLimited(rq(JSON.stringify({ a: "y".repeat(SMALL_JSON_BODY) })), MAX_JSON_BODY);
  assert.ok("body" in fine && fine.body !== null, "the bundle's cap still takes it");
});

test("every burnticker v1 POST reads its body through the capped reader; only the bundle keeps the image-sized cap", () => {
  const root = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "src", "app", "api", "burnticker", "v1");
  const files: string[] = [];
  const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name === "route.ts") files.push(p); } };
  walk(root);
  const posts = files.filter((f) => /export async function POST\(req: Request\)/.test(fs.readFileSync(f, "utf8")));
  assert.ok(posts.length >= 9, `found ${posts.length} POST routes`);
  for (const f of posts) {
    const src = fs.readFileSync(f, "utf8");
    assert.doesNotMatch(src, /\breadJson\(/, `${path.relative(root, f)} reads an uncapped body`);
    assert.match(src, /readJsonLimited\(req(, MAX_JSON_BODY)?\)/, path.relative(root, f));
    if (/MAX_JSON_BODY/.test(src)) assert.match(f, /launch[\\/]bundle[\\/]route\.ts$/, "only the bundle carries images");
  }
});
