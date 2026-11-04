// Prelaunch audit 2026-10-18 A-28: the coin page's in-browser second check of the pinned metadata fetched the Arweave gateway straight
// from the browser; that fetch failed on every page (net::ERR_SSL_PROTOCOL_ERROR) and the page printed "Your browser could not reach
// the gateway just now…". The browser now reads the same bytes through this site's pin-check route (?raw=1: bounded, kept, rate-limited)
// and hashes them itself.
import { describe, test, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { PIN_HOST_ONLY_LINE, PIN_REREAD_OK_LINE, pinnedFileHref } from "@/lib/burnticker/pinCheckClient";
import { lintCopy } from "@/lib/launch/copyLint";
import { setPlatformForTests } from "@/lib/burnticker/server";

const MINT = "Pin1111111111111111111111111111111111111111";
const URI = "https://gateway.irys.xyz/abc";
const BODY = new TextEncoder().encode(JSON.stringify({ name: "X", description: "locked words" }));

describe("A-28: the second check of the pinned metadata goes through this site", () => {
  after(() => setPlatformForTests(null));
  test("pinnedFileHref: same origin when the mint is known; the gateway only for an older caller with no mint", () => {
    assert.equal(pinnedFileHref({ mint: MINT, metadataUri: URI }), `/api/burnticker/pin-check?mint=${MINT}&raw=1`);
    assert.equal(pinnedFileHref({ metadataUri: URI }), URI);
  });
  test("the fallback line lints and no longer blames the visitor's browser", () => {
    assert.deepEqual(lintCopy(PIN_HOST_ONLY_LINE).hits, []);
    // review item 6: the re-read goes through this server, so the success line says so (it is not an independent read of Arweave)
    assert.deepEqual(lintCopy(PIN_REREAD_OK_LINE).hits, []);
    assert.match(PIN_REREAD_OK_LINE, /again through this site/);
    assert.doesNotMatch(PIN_HOST_ONLY_LINE, /gateway|browser/i);
  });
  test("?raw=1 serves the pinned bytes with their sha256, reads the gateway once for repeated calls, and refuses an oversized file", async () => {
    const meta = new Map([[MINT, { metadataUri: URI, metadataSha256: createHash("sha256").update(BODY).digest("hex"), hosted: false }], ["Big1111111111111111111111111111111111111111", { metadataUri: "https://gateway.irys.xyz/big", metadataSha256: "x", hosted: false }]]);
    const reg = { token: (m: string) => (meta.has(m) ? { mint: m, ticker: "X", description: "locked words", rulesJson: "{}" } : null), tokenMeta: (m: string) => meta.get(m) ?? null, lockedRule: () => ({ rule: {} }) };
    setPlatformForTests({ registry: reg } as never);
    const real = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async (u: string | URL) => {
      calls++;
      if (String(u).endsWith("/big")) return new Response(new Uint8Array(300 * 1024), { headers: { "content-type": "application/json" } });
      return new Response(Buffer.from(BODY), { headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    try {
      const { GET } = await import("../src/app/api/burnticker/pin-check/route.ts");
      const ask = (mint: string) => GET(new Request(`http://bt.test/api/burnticker/pin-check?mint=${mint}&raw=1`, { headers: { "x-forwarded-for": "203.0.113.77" } }));
      const r = await ask(MINT);
      assert.equal(r.status, 200);
      const bytes = new Uint8Array(await r.arrayBuffer());
      assert.equal(createHash("sha256").update(bytes).digest("hex"), meta.get(MINT)!.metadataSha256, "the browser hashes the pin's own bytes");
      assert.equal(r.headers.get("x-pinned-sha256"), meta.get(MINT)!.metadataSha256);
      assert.match(r.headers.get("cache-control") ?? "", /public, max-age=3600/);
      assert.equal(r.headers.get("x-content-type-options"), "nosniff", "review item 6: the pinned bytes are never sniffed as another type");
      await ask(MINT);
      assert.equal(calls, 1, "a pin never changes: the second call is served from the kept copy");
      const big = await ask("Big1111111111111111111111111111111111111111");
      assert.equal(big.status, 502);
      assert.match((await big.json()).detail, /larger than 262144 bytes/);
      // review item 6: the verdict is kept only when it passed; a failed or unread pin is asked again next time
      const verdict = (mint: string) => GET(new Request(`http://bt.test/api/burnticker/pin-check?mint=${mint}`, { headers: { "x-forwarded-for": "203.0.113.78" } }));
      const bad = await verdict("Big1111111111111111111111111111111111111111");
      assert.notEqual((await bad.json()).ok, true);
      assert.equal(bad.headers.get("cache-control"), "no-store", "before: a failed verdict was public for ten minutes");
    } finally { globalThis.fetch = real; }
  });
});
