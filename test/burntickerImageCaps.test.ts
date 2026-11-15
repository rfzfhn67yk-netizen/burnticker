// 2026-10-15 prelaunch audit M3: the image preview and the launch routes parsed any body size, and sharp decoded any pixel count a 2 MB
// file declared, on the one Node process; the preview had no limiter.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { badgeCreatorImage, checkCreatorImage } from "@/lib/burnticker/creatorBadge";
import { makeWorld } from "./burntickerApiHelpers.ts";

const req = (url: string, body: string, ip: string) => new Request(url, { method: "POST", headers: { "content-type": "application/json", "sec-fetch-site": "same-origin", "x-forwarded-for": ip }, body });

describe("image and body caps (M3)", () => {
  test("an image that declares more than 24 megapixels is refused before it is decoded", async () => {
    const png = new Uint8Array(await sharp({ create: { width: 6000, height: 5000, channels: 3, background: "#ff0000" } }).png().toBuffer());
    assert.ok(png.length < 2 * 1024 * 1024, "a small file");
    const c = await checkCreatorImage(png);
    assert.ok("error" in c && /pixels/.test(c.error), JSON.stringify(c));
    const b = await badgeCreatorImage(png, "image/png");
    assert.ok("error" in b && /pixels/.test(b.error), JSON.stringify(b));
  });

  test("the image preview refuses an oversized body with 413 and a client past the heavy bucket with 429", async () => {
    await makeWorld();
    const { POST } = await import("@/app/api/burnticker/launch/image-preview/route");
    const big = await POST(req("https://burnticker.com/api/burnticker/launch/image-preview", JSON.stringify({ image: { contentType: "image/png", base64: "A".repeat(3_100_000) } }), "198.51.100.31"));
    assert.equal(big.status, 413);
    const statuses: number[] = [];
    for (let i = 0; i < 25; i++) statuses.push((await POST(req("https://burnticker.com/api/burnticker/launch/image-preview", "{}", "198.51.100.32"))).status);
    assert.ok(statuses.includes(429));
  });

  test("the launch route refuses a body past the cap before parsing it", async () => {
    await makeWorld();
    const prev = process.env.BURNTICKER_CREATOR_LAUNCHES_ENABLED;
    process.env.BURNTICKER_CREATOR_LAUNCHES_ENABLED = "1";
    try {
      const { POST } = await import("@/app/api/burnticker/launch/route");
      const r = await POST(req("https://burnticker.com/api/burnticker/launch", JSON.stringify({ pad: "x".repeat(7_000_000) }), "198.51.100.33"));
      assert.equal(r.status, 413);
    } finally { if (prev === undefined) delete process.env.BURNTICKER_CREATOR_LAUNCHES_ENABLED; else process.env.BURNTICKER_CREATOR_LAUNCHES_ENABLED = prev; }
  });

  test("the public API refuses a declared oversized POST with 413", async () => {
    const { readTextCapped, declaredTooLarge } = await import("@/lib/burnticker/api/http");
    const r = new Request("https://burnticker.com/x", { method: "POST", headers: { "content-length": "9000000" }, body: "{}" });
    assert.equal(declaredTooLarge(r), true);
    const chunked = new Request("https://burnticker.com/x", { method: "POST", body: new ReadableStream({ start(c) { for (let i = 0; i < 8; i++) c.enqueue(new Uint8Array(1_000_000)); c.close(); } }), duplex: "half" } as RequestInit);
    assert.equal(await readTextCapped(chunked), null, "a chunked body is cut off while it streams in");
  });
});
