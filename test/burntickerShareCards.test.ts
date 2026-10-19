// Owner's UX walkthrough 2026-10-18: 21 pages inherited the root layout's share card (og:url /burnticker, the site's generic title and
// description), because a page with no openGraph block of its own inherits its parent's whole. Each page now builds its own from its
// title, description and canonical address (pageMeta.ts withShareCard).
//
// The rendered-HTML checks at the bottom run against a built app when BT_RENDER_BASE is set (for example http://127.0.0.1:3000):
//   BT_RENDER_BASE=http://127.0.0.1:3000 node --import ./test/alias-hook.mjs --test test/burntickerShareCards.test.ts
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { OG_IMAGE, withShareCard } from "@/lib/burnticker/pageMeta";
import { lintCopy } from "@/lib/launch/copyLint";

const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : /^(page|layout)\.tsx$/.test(e.name) ? [path.join(d, e.name)] : []));

describe("every page shares as itself", () => {
  test("withShareCard: og:url is the page's canonical address; title and description are its own; the small image", () => {
    const m = withShareCard({ title: "Privacy", description: "What the site keeps.", alternates: { canonical: "/burnticker/privacy" } });
    const og = m.openGraph as { url?: string; title?: string; description?: string; images?: { url: string }[] };
    assert.deepEqual([og.url, og.title, og.description, og.images?.[0].url], ["/burnticker/privacy", "Privacy · Burnticker", "What the site keeps.", OG_IMAGE.url]);
    const tw = m.twitter as { title?: string; description?: string; images?: string[] };
    assert.deepEqual([tw.title, tw.description, tw.images?.[0]], ["Privacy · Burnticker", "What the site keeps.", OG_IMAGE.url]);
    assert.equal((withShareCard({ title: "Burnticker · Trust" }).openGraph as { title?: string }).title, "Burnticker · Trust", "a title that names the site is kept as written");
  });
  test("no page or layout with its own title leaves its share card to the root (before: 21 shared as /burnticker)", () => {
    const own = /withShareCard\(|openGraph:|previewMetadata\(/;
    const bare: string[] = [];
    for (const f of walk("src/app/burnticker")) {
      const s = fs.readFileSync(f, "utf8");
      if (!/export const metadata|export async function generateMetadata/.test(s)) continue;
      if (f === path.join("src/app/burnticker/page.tsx")) continue;   // the home is the root's own card
      if (!own.test(s)) bare.push(f);
    }
    assert.deepEqual(bare, []);
  });
  test("every page with its own share card names a canonical address and a description", () => {
    for (const f of walk("src/app/burnticker")) {
      const s = fs.readFileSync(f, "utf8");
      if (!/withShareCard\(\{/.test(s)) continue;
      assert.match(s, /canonical:/, f);
      assert.match(s, /description:/, f);
    }
  });
  test("the descriptions written for this change pass the copy lint", () => {
    const fresh = [
      /description: "(Connect a wallet to see the coins it created[^"]*)"/.exec(fs.readFileSync("src/app/burnticker/me/layout.tsx", "utf8"))?.[1],
      /description: "(The operator's page for claiming[^"]*)"/.exec(fs.readFileSync("src/app/burnticker/operator/claim-fees/page.tsx", "utf8"))?.[1],
    ];
    for (const d of fresh) {
      assert.ok(d);
      assert.deepEqual(lintCopy(d!).hits, [], d);
      assert.doesNotMatch(d!, /\bwill\b|\bbuy|\bprice|payout|→/i, d);
      if (/wallet/.test(d!)) assert.match(d!, /This site's server does not keep it\.$/, "review item 7: the server is what does not keep it");
    }
  });
});

const BASE = process.env.BT_RENDER_BASE?.replace(/\/$/, "");
describe("rendered HTML of three pages (needs a running app: BT_RENDER_BASE)", { skip: !BASE }, () => {
  const meta = (html: string, prop: string) => new RegExp(`<meta (?:property|name)="${prop}" content="([^"]*)"`).exec(html)?.[1] ?? null;
  for (const [p, title] of [["/burnticker/privacy", "Privacy · Burnticker"], ["/burnticker/terms", "Terms of use · Burnticker"], ["/burnticker/leaderboard", null]] as const) {
    test(`${p}: its own og:url, og:title, og:description, canonical and the small image`, async () => {
      const html = await (await fetch(`${BASE}${p}`)).text();
      assert.equal(meta(html, "og:url"), `https://burnticker.com${p}`);
      if (title) assert.equal(meta(html, "og:title"), title);
      assert.ok(meta(html, "og:description"), "a description of its own");
      assert.equal(meta(html, "og:description"), meta(html, "description"));
      assert.match(html, new RegExp(`<link rel="canonical" href="https://burnticker.com${p}"`));
      assert.equal(meta(html, "og:image"), OG_IMAGE.url);
    });
  }
  test("a pair page that is not public answers 404 with the 404 title", async () => {
    const r = await fetch(`${BASE}/burnticker/p/no-such-pair`);
    assert.equal(r.status, 404);
  });
});
