// Owner's UX walkthrough 2026-10-18: /brand/og.png was 603 KB, sent no-store, and was the og:image of eight pages. The share image is
// now the same design as a JPEG of about 110 KB under a hashed name, served by the app with a one-year immutable Cache-Control.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { OG_IMAGE, OG_IMAGE_CACHE, OG_IMAGE_FILE, OG_IMAGE_PATH, ogImageHeaderRule } from "@/lib/burnticker/pageMeta";

const FILE = `config/public-repo/overlay/public/burnticker/brand/${OG_IMAGE_FILE}`;

describe("the share image: small, long-cached, used by every page that names one", () => {
  test("at most 150 KB, a 1200 x 630 JPEG, and its name carries its own hash", () => {
    const b = fs.readFileSync(FILE);
    assert.ok(b.length <= 150 * 1024, `${b.length} bytes (before: 603,362)`);
    assert.deepEqual([...b.subarray(0, 3)], [0xff, 0xd8, 0xff], "a JPEG");
    // the SOF0/SOF2 frame header holds height then width
    let i = 2, size: [number, number] | null = null;
    while (i < b.length && !size) { const m = b[i + 1], len = b.readUInt16BE(i + 2); if (m === 0xc0 || m === 0xc2) size = [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)]; i += 2 + len; }
    assert.deepEqual(size, [1200, 630]);
    assert.equal(OG_IMAGE_FILE, `og-${createHash("sha256").update(b).digest("hex").slice(0, 10)}.jpg`);
    assert.deepEqual([OG_IMAGE.width, OG_IMAGE.height], [1200, 630]);
  });
  test("the app sends it with a one-year immutable Cache-Control, after the page rule so it wins", () => {
    assert.equal(OG_IMAGE_CACHE, "public, max-age=31536000, immutable");
    assert.deepEqual(ogImageHeaderRule(), { source: OG_IMAGE_PATH, headers: [{ key: "Cache-Control", value: OG_IMAGE_CACHE }] });
    assert.match(fs.readFileSync("config/public-repo/overlay/next.config.ts", "utf8"), /\.\.\.pageCacheHeaderRules\(\), ogImageHeaderRule\(\)\]/);
  });
  test("no page, layout, static page or the whitepaper renderer names the 603 KB og.png any more", () => {
    const files = ["config/public-repo/overlay/src/app/layout.tsx", "src/lib/burnticker/sharePreview.ts", "src/app/burnticker/launch/layout.tsx", "src/app/burnticker/about/page.tsx", "src/app/burnticker/leagues/page.tsx", "src/app/burnticker/check/layout.tsx", "src/app/burnticker/trust/layout.tsx", "src/app/burnticker/operator/layout.tsx", "site/burnticker/index.html", "site/burnticker/whitepaper.html", "site/burnticker/whitepaper-2026-10-10.html", "scripts/whitepaper-html.mjs"];
    for (const f of files) {
      const s = fs.readFileSync(f, "utf8");
      assert.doesNotMatch(s, /brand\/og\.png/, f);
      assert.ok(s.includes(OG_IMAGE.url), `${f} names ${OG_IMAGE.url}`);
    }
  });
});
