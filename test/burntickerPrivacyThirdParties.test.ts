// Prelaunch audit 2026-10-18 A-27: the privacy page named GeckoTerminal, the Solana network and the wallet, and said "The web server
// keeps no log of visitors' addresses", true of this site's own server but not of the Cloudflare proxy in front of it. Every page also
// loaded Cloudflare's Web Analytics script and Google Fonts (through the wallet adapter's stylesheet), and coin images come from the
// Arweave gateway. The page now names all three, and the app's wallet list no longer pulls a Google font.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { PRIVACY_ORIGIN_LOG_SENTENCE, PRIVACY_SECTIONS, PRIVACY_THIRD_PARTY_PARAGRAPHS } from "@/lib/burnticker/legalCopy";
import { lintCopy } from "@/lib/launch/copyLint";

const all = PRIVACY_SECTIONS.flatMap((s) => s.paragraphs).join("\n");

describe("A-27: the privacy page names every outside service the browser talks to", () => {
  test("Cloudflare (proxy and Web Analytics), the Arweave gateway and Google Fonts are named, with their hosts", () => {
    for (const host of ["Cloudflare", "Web Analytics", "static.cloudflareinsights.com", "gateway.irys.xyz", "arweave.net", "Google Fonts", "fonts.googleapis.com", "fonts.gstatic.com"]) assert.ok(all.includes(host), host);
  });
  test("the no-log sentence is about this site's own server and points at Cloudflare's records", () => {
    assert.doesNotMatch(all, /^The web server keeps no log of visitors' addresses\./m, "before: an unqualified claim the proxy makes untrue");
    assert.match(PRIVACY_ORIGIN_LOG_SENTENCE, /^This site's own web server keeps no log/);
    assert.match(PRIVACY_ORIGIN_LOG_SENTENCE, /Cloudflare/);
    // review item 7: it points at the section by name (the next section is "When you create a coin", not the Cloudflare one)
    assert.match(PRIVACY_ORIGIN_LOG_SENTENCE, /as the section "Other services your browser talks to" says\./);
    assert.equal(PRIVACY_SECTIONS.find((s) => s.id === "others")?.heading, "Other services your browser talks to");
    assert.ok(PRIVACY_SECTIONS.find((s) => s.id === "server")!.paragraphs.includes(PRIVACY_ORIGIN_LOG_SENTENCE));
  });
  test("every new sentence passes the copy lint (no will, buy, price, payout, dates or arrows)", () => {
    for (const p of [PRIVACY_ORIGIN_LOG_SENTENCE, ...PRIVACY_THIRD_PARTY_PARAGRAPHS]) {
      assert.deepEqual(lintCopy(p).hits, [], p);
      assert.doesNotMatch(p, /\bwill\b|\bbuy|\bprice|payout|→|\b20\d\d\b/i, p);
    }
  });
  test("the wallet list's stylesheet is the package's file without its Google Fonts import", () => {
    const pkg = fs.readFileSync("node_modules/@solana/wallet-adapter-react-ui/styles.css", "utf8").split("\n");
    assert.match(pkg[0], /^@import url\('https:\/\/fonts\.googleapis\.com/);
    const ours = fs.readFileSync("src/app/burnticker/_components/walletAdapter.css", "utf8");
    assert.doesNotMatch(ours.replace(/^\/\*[^]*?\*\//, ""), /@import|googleapis|gstatic/);
    assert.ok(ours.endsWith(pkg.slice(1).join("\n")), "the rest of the file is unchanged");
    for (const f of ["src/app/burnticker/_components/ShellWalletProviders.tsx", "src/app/burnticker/launch/WalletProviders.tsx"]) {
      const src = fs.readFileSync(f, "utf8");
      assert.doesNotMatch(src, /wallet-adapter-react-ui\/styles\.css/, f);
      assert.match(src, /walletAdapter\.css"/, f);
    }
  });
});
