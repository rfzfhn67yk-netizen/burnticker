// AUDIT 2026-10-18 A-42, the API residuals: a `null` JSON body made the launch route throw a bare 500; the launch route read and parsed
// up to 6.5 MB before its write limiter ran; params were decoded a second time after Next (/v1/tokens/%2541 answered "no token called
// A"); the preview image took an unbounded rule; the Caddy embed and sitemap handles had no upstream timeout, the embed's fallback
// could not be framed, and every answer named Caddy in a Via header.
import { test, describe, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { limiter } from "@/lib/burnticker/api/http";
import { RATE_LIMITS } from "@/lib/burnticker/api/spec";
import { safeParam } from "@/lib/burnticker/safeParam";
import { lookupCoin } from "@/lib/burnticker/coinLookup";
import { coinImage, PREVIEW_RULE_MAX_CHARS } from "@/lib/burnticker/coinArtServe";
import { config, proxy } from "../src/proxy.ts";
import { API, callRoute, makeWorld, HOST } from "./burntickerApiHelpers.ts";

const ROOT = path.join(import.meta.dirname, "..");
const launchPost = (body: string, ip: string, extra: Record<string, string> = {}) => new Request(`http://${HOST}/api/burnticker/launch`, { method: "POST", headers: { host: HOST, origin: `http://${HOST}`, "content-type": "application/json", "x-forwarded-for": ip, ...extra }, body });

describe("A-42: launch route body handling", () => {
  before(async () => { await makeWorld(); });
  beforeEach(() => limiter.reset());

  test("a JSON body of null, a number or an array answers 400 with a sentence, never a bare 500", async () => {
    const { POST } = await import("../src/app/api/burnticker/launch/route.ts");
    for (const b of ["null", "7", "[]", "\"text\""]) {
      const r = await POST(launchPost(b, "203.0.113.60"));
      assert.equal(r.status, 400, b);
      assert.equal(((await r.json()) as { code: string }).code, "bad-body", b);
    }
  });

  test("a body too large to be a launch record takes its write token before it is read", async () => {
    const { POST } = await import("../src/app/api/burnticker/launch/route.ts");
    for (let i = 0; i < 1000 && limiter.take("203.0.113.61", "write").ok; i++) { /* spend the write bucket */ }
    const big = new TextEncoder().encode(JSON.stringify({ name: "x".repeat(200_000) }));
    let pulled = false;
    const body = new ReadableStream<Uint8Array>({ pull(c) { pulled = true; c.enqueue(big); c.close(); } }, { highWaterMark: 0 });
    const req = new Request(`http://${HOST}/api/burnticker/launch`, { method: "POST", headers: { host: HOST, origin: `http://${HOST}`, "content-type": "application/json", "x-forwarded-for": "203.0.113.61", "content-length": String(big.length) }, body, duplex: "half" } as RequestInit);
    const r = await POST(req);
    assert.equal(r.status, 429);
    assert.equal(pulled, false, "the refused body was never read");
    // a small `launched` record still goes to its own confirm bucket
    assert.equal(limiter.take("203.0.113.61", "confirm").ok, true);
    assert.ok(RATE_LIMITS.write.burst > 0);
  });
});

describe("review of A-42: the launch route's gate does not depend on Content-Length", () => {
  before(async () => { await makeWorld(); });
  beforeEach(() => limiter.reset());
  // a chunked body: no Content-Length; counts how many 16 KB chunks were pulled
  const chunked = (ip: string, chunks: number) => {
    let pulled = 0;
    const piece = new TextEncoder().encode("x".repeat(16 * 1024));
    const body = new ReadableStream<Uint8Array>({
      pull(c) { if (pulled === 0) { pulled++; c.enqueue(new TextEncoder().encode('{"name":"')); return; } if (pulled > chunks) { c.enqueue(new TextEncoder().encode('"}')); c.close(); return; } pulled++; c.enqueue(piece); },
    }, { highWaterMark: 0 });
    const req = new Request(`http://${HOST}/api/burnticker/launch`, { method: "POST", headers: { host: HOST, origin: `http://${HOST}`, "content-type": "application/json", "x-forwarded-for": ip }, body, duplex: "half" } as RequestInit);
    return { req, pulled: () => pulled };
  };

  test("a chunked body past 64 KB takes the write token as it streams, and a spent bucket stops the read there", async () => {
    const { POST } = await import("../src/app/api/burnticker/launch/route.ts");
    for (let i = 0; i < 1000 && limiter.take("203.0.113.62", "write").ok; i++) { /* spend the write bucket */ }
    const c = chunked("203.0.113.62", 300);   // about 4.8 MB if read to the end
    const r = await POST(c.req);
    assert.equal(r.status, 429);
    assert.ok(c.pulled() <= 8, `${c.pulled()} chunks were read`);
  });

  test("on a closed host a large body is refused before any write token is spent", async () => {
    const { POST } = await import("../src/app/api/burnticker/launch/route.ts");
    const was = process.env.BURNTICKER_CREATOR_LAUNCHES_ENABLED;
    process.env.BURNTICKER_CREATOR_LAUNCHES_ENABLED = "0";
    try {
      const c = chunked("203.0.113.63", 300);
      const r = await POST(c.req);
      assert.equal(r.status, 403);
      assert.ok(c.pulled() <= 8, `${c.pulled()} chunks were read`);
      const big = "x".repeat(100_000);
      assert.equal((await POST(launchPost(JSON.stringify({ name: big }), "203.0.113.63", { "content-length": String(big.length + 11) }))).status, 403);
    } finally { if (was === undefined) delete process.env.BURNTICKER_CREATOR_LAUNCHES_ENABLED; else process.env.BURNTICKER_CREATOR_LAUNCHES_ENABLED = was; }
    const fresh = limiter.take("203.0.113.63", "write");
    assert.equal(fresh.remaining, fresh.limit - 1, "no write token was spent");
  });
});

describe("A-42: params are decoded once (by Next), never twice", () => {
  test("safeParam and lookupCoin keep a literal % sequence", () => {
    assert.equal(safeParam("%41"), "%41");
    const asked: string[] = [];
    const reg = { token: (k: string) => { asked.push(k); return null; }, tokenByTicker: (k: string) => { asked.push(k); return null; }, tokensByTicker: (k: string) => { asked.push(k); return []; } };
    assert.equal(lookupCoin(reg as unknown as Parameters<typeof lookupCoin>[0], "%41").kind, "none");
    assert.ok(asked.every((k) => k === "%41"), asked.join(","));
  });

  test("/v1/tokens/%2541 answers about %41, not A", async () => {
    await makeWorld();
    const r = await callRoute(`${API}/tokens/%2541`);
    assert.equal(r.status, 404);
    const j = await r.json() as { error: string };
    assert.match(j.error, /%41/); assert.doesNotMatch(j.error, /called A\b/);
  });

  test("a trailing % and other undecodable escapes answer 404 from the proxy when they reach the app", async () => {
    const re = new RegExp(`^${config.matcher[0].replace("/:path(.*%.*)", "/(.*%.*)")}$`);
    for (const p of ["/burnticker/t/%", "/api/burnticker/v1/tokens/%", "/api/burnticker/v1/tokens/A%2"]) {
      assert.ok(re.test(p), p);
      assert.equal((await proxy(new NextRequest(`https://burnticker.test${p}`))).status, 404, p);
    }
  });
});

describe("A-42: the preview image", () => {
  test("an encoded rule longer than the cap is refused before it is parsed", async () => {
    const reg = { token: () => null, tokenByTicker: () => null, tokensByTicker: () => [], lockedRule: () => { throw new Error("unused"); } };
    const r = await coinImage({ registry: reg as never, file: "preview.svg", query: new URLSearchParams({ r: "A".repeat(PREVIEW_RULE_MAX_CHARS + 1), t: "X" }) });
    assert.equal(r.status, 400); assert.equal(r.body, "The rule in this address is too long to draw.");
  });
});

describe("A-42: Caddy", () => {
  const caddy = fs.readFileSync(path.join(ROOT, "deploy/caddy/Caddyfile"), "utf8");
  const block = (start: string) => { const i = caddy.indexOf(start); assert.ok(i >= 0, start); let depth = 0, j = caddy.indexOf("{", i); const from = j; for (; j < caddy.length; j++) { if (caddy[j] === "{") depth++; else if (caddy[j] === "}" && --depth === 0) break; } return caddy.slice(from, j + 1); };
  test("the embed and sitemap handles give up on a wedged app after 20 s", () => {
    for (const h of ["handle @embed {", "handle /sitemap.xml {"]) assert.match(block(h), /response_header_timeout 20s/, h);
  });
  test("an embed's outage fallback may be framed; every other fallback may not", () => {
    const errs = block("handle_errors {");
    const embedAt = errs.indexOf("@embed_down"), appAt = errs.indexOf("@app_down");
    assert.ok(embedAt >= 0 && embedAt < appAt, "the embed fallback is matched before the page fallback");
    assert.match(block("handle @embed_down {"), /import security_embed/);
    assert.doesNotMatch(block("handle @embed_down {"), /import security\b(?!_)/);
    assert.match(block("(security_embed) {"), /-X-Frame-Options/);
  });
  test("no answer names Caddy in a Via header", () => {
    for (const s of ["(security) {", "(security_embed) {"]) assert.match(block(s), /^\s*-Via\s*$/m, s);
  });
});
