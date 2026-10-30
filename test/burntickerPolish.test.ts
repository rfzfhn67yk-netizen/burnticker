// POLISH-1 (2026-10-12; PLATFORM-NEXT-2-BRIEF.md items 1, 5, 7): the terms and privacy pages, the RSS 2.0 and JSON Feed 1.1 feeds and the
// CSV exports. Every fixed sentence passes the copy lint; the feeds are well-formed, honest when empty and carry no price words; the
// CSV routes stream a header row and the coin page's rows.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { formatHits, lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import { ALL_LEGAL_COPY, GOVERNING_LAW_SENTENCE, PRIVACY_SECTIONS, TAKEDOWN_SENTENCE, TERMS_SECTIONS } from "@/lib/burnticker/legalCopy";
import { OPERATOR_LINE } from "@/lib/burnticker/trustpack/copy";
import { FOOTER_COPY } from "@/lib/burnticker/siteNav.mjs";
import { STATIC_PAGES } from "@/lib/burnticker/sitemap";
import { FEED_COPY, JSON_FEED_TYPE, RSS_TYPE, coinFeed, feedResponse, nextResultsFeed, parseFeedFile, receiptsFeed, renderJsonFeed, renderRss, type FeedDoc } from "@/lib/burnticker/feeds";
import type { ActivityEvent } from "@/lib/burnticker/activity";
import type { UpcomingRow } from "@/lib/burnticker/upcoming";
import { BURNS_HEADER, READINGS_HEADER, burnRowsFromKeeper, csvCell, csvLine, readingRowsFromKeeper } from "@/lib/burnticker/csvExport";
import { coinCsv } from "@/lib/burnticker/csvServe";
import { setPlatformForTests } from "@/lib/burnticker/server";
import { makeWorld, type World } from "./burntickerApiHelpers.ts";
import { GET as feedGET } from "../src/app/api/burnticker/feeds/[feed]/route.ts";
import { GET as coinFeedGET } from "../src/app/api/burnticker/feeds/coin/[file]/route.ts";
import { GET as burnsCsvGET } from "../src/app/api/burnticker/coins/[ticker]/burns.csv/route.ts";
import { GET as readingsCsvGET } from "../src/app/api/burnticker/coins/[ticker]/readings.csv/route.ts";

const ROOT = path.join(import.meta.dirname, "..");
const cfg = loadCopyLintConfig();
const clean = (t: string, what: string) => { const r = lintCopy(t, cfg); assert.ok(r.ok, `${what}: ${t}\n${formatHits(r)}`); };
const NOW = Date.parse("2026-10-20T22:00:00Z");
const ORIGIN = "https://burnticker.com";

/** A small XML well-formedness check: every tag closes in order, one root, no stray ampersand. */
function wellFormed(x: string): string | null {
  const body = x.replace(/^<\?xml[^>]*\?>\s*/, "");
  if (/&(?!(amp|lt|gt|quot|apos|#\d+);)/.test(body)) return "stray ampersand";
  const stack: string[] = [];
  for (const m of body.matchAll(/<(\/?)([A-Za-z][\w:.-]*)([^>]*?)(\/?)>/g)) {
    const [, close, name, , self] = m;
    if (self) continue;
    if (close) { if (stack.pop() !== name) return `unbalanced </${name}>`; } else stack.push(name);
  }
  return stack.length ? `unclosed <${stack.join("><")}>` : null;
}

const EVENTS: ActivityEvent[] = [
  { kind: "burn", at: "2026-10-16T21:00:00Z", network: "mainnet", ticker: "DEFICIT", signature: "SigBurnOne", href: "/burnticker/check?sig=SigBurnOne&cluster=mainnet#verify", text: "$DEFICIT burned 1,234 tokens for the reading of Oct 15, from 12 units." },
  { kind: "reading", at: "2026-10-16", network: "mainnet", ticker: "DEFICIT", signature: "SigReadOne", href: "https://explorer.solana.com/tx/SigReadOne", text: "$DEFICIT's reading for Oct 16 was signed on chain. The debt was $38.505 trillion, which counted 3 units." },
  { kind: "pool", at: null, network: "mainnet", ticker: "DEFICIT", href: "https://explorer.solana.com/address/Pool", text: "$DEFICIT's Raydium pool is registered with the burn program. This site does not read the date." },
  { kind: "burn", at: "2026-10-06", network: "devnet", ticker: "REHEARSE", signature: "SigDevnet", href: "/burnticker/check?sig=SigDevnet&cluster=devnet#verify", text: "On Oct 6, the devnet rehearsal coin $REHEARSE burned 5 tokens." },
];
const ROW: UpcomingRow = { ticker: "DEFICIT", name: "Deficit", href: "https://deficit.burnticker.com/", network: "mainnet", event: "The next business day's U.S. national debt figure", source: "Debt to the Penny", sourceUrl: null,
  schedule: "The Treasury publishes each business day's figure on its own schedule. The keeper checks for it at 16:30 and 18:30 New York time.", nextAt: null, status: "attested", statusText: "The reading for Oct 16 is signed and waits for its burn run.", receiptHref: null };

// ---------------------------------------------------------------------------------------------------------------------------------
describe("item 1: the terms and privacy pages", () => {
  test("every sentence passes the copy lint", () => { for (const t of ALL_LEGAL_COPY) clean(t, "legal copy"); });
  test("the operator line verbatim, the not-advice sentence, the affiliation line and the chain line are imported, never retyped", () => {
    const terms = TERMS_SECTIONS.flatMap((s) => s.paragraphs), privacy = PRIVACY_SECTIONS.flatMap((s) => s.paragraphs);
    assert.ok(terms.includes(OPERATOR_LINE) && privacy.includes(OPERATOR_LINE));
    assert.ok(terms.includes(FOOTER_COPY.notAdvice) && terms.includes(FOOTER_COPY.affiliation));
    assert.ok(terms.some((p) => p.endsWith(FOOTER_COPY.chain)));
  });
  test("the brief's sections, in plain sentences", () => {
    const ids = TERMS_SECTIONS.map((s) => s.id);
    for (const id of ["what-it-is", "creators", "takedown", "no-accounts", "stores", "no-advice", "operator"]) assert.ok(ids.includes(id), id);
    const all = ALL_LEGAL_COPY.join(" ");
    // sixth pass B-16 (2026-10-19): the disclosed test purchase is named beside "never trades"
    assert.match(all, /the platform never trades\. (?:The \$SEAWIN test was made [^.]+\.|The operator has not yet written down why that test was made\.) (?:The \$GASCAT seed was made [^.]+\.|The operator has not yet written down why that seed was made\.) The platform never takes an order and never pays anything/);
    assert.match(all, /confirms that they have the right to use it/);
    assert.match(all, /marks are used at the creator's own risk/);
    assert.match(TAKEDOWN_SENTENCE, /contact@burnticker\.com/); assert.match(TAKEDOWN_SENTENCE, /Arweave.*permanent/);
    assert.match(all, /There are no accounts on Burnticker/);
    assert.match(all, /holds no accounts and no tokens for anyone/);
    assert.match(all, /no warranty of any kind/);
    assert.equal(GOVERNING_LAW_SENTENCE, "The law that governs these terms has not been decided yet. This page says so plainly instead of guessing.");
    assert.doesNotMatch(all, /TODO|\bwill\b|cookie banner|waitlist|sign up for|newsletter/i);
    assert.doesNotMatch(all, /\b20\d\d-\d\d-\d\d\b|\bOct(ober)? \d/, "no dates");
  });
  test("the routes render the copy module, and the sitemap lists both pages", () => {
    for (const [f, mod] of [["src/app/burnticker/terms/page.tsx", "TERMS_SECTIONS"], ["src/app/burnticker/privacy/page.tsx", "PRIVACY_SECTIONS"]]) {
      const src = fs.readFileSync(path.join(ROOT, f), "utf8");
      assert.match(src, new RegExp(mod)); assert.match(src, /alternates: \{ canonical: "\/burnticker\/(terms|privacy)" \}/);
    }
    for (const p of ["/burnticker/terms", "/burnticker/privacy"]) assert.ok(STATIC_PAGES.some((s) => s.path === p), p);
  });
  test("what the privacy page says the browser keeps matches the code's storage keys", () => {
    const priv = PRIVACY_SECTIONS.find((s) => s.id === "browser")!.paragraphs.join(" ");
    assert.match(fs.readFileSync(path.join(ROOT, "src/app/burnticker/_components/theme.ts"), "utf8"), /localStorage/); assert.match(priv, /theme/);
    assert.match(fs.readFileSync(path.join(ROOT, "src/lib/burnticker/watchlist.ts"), "utf8"), /localStorage/); assert.match(priv, /watchlist/);
    assert.match(fs.readFileSync(path.join(ROOT, "src/app/burnticker/_components/ShellWalletProviders.tsx"), "utf8"), /autoConnect=\{true\}/); assert.match(priv, /remembers which wallet you chose/);
    // OP7-10: the access log keeps no visitor address, so the privacy page's sentence holds
    assert.match(fs.readFileSync(path.join(ROOT, "deploy/caddy/Caddyfile"), "utf8"), /keeps an access log WITHOUT visitors' addresses/);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe("item 5: RSS 2.0 and JSON Feed 1.1", () => {
  const docs = (): FeedDoc[] => [receiptsFeed(EVENTS, ORIGIN, NOW), coinFeed("DEFICIT", EVENTS, ORIGIN, NOW), nextResultsFeed([ROW], ORIGIN, NOW), receiptsFeed([], ORIGIN, NOW), coinFeed("NEWCOIN", [], ORIGIN, NOW), nextResultsFeed([], ORIGIN, NOW)];
  test("valid RSS 2.0: one channel with title, link and description; every item has a title, link, description and a guid", () => {
    for (const d of docs()) {
      const x = renderRss(d);
      assert.equal(wellFormed(x), null, `${d.id}: ${wellFormed(x)}`);
      assert.match(x, /^<\?xml version="1.0" encoding="UTF-8"\?>\n<rss version="2.0" xmlns:atom="http:\/\/www.w3.org\/2005\/Atom">/);
      assert.equal((x.match(/<channel>/g) ?? []).length, 1);
      for (const tag of ["title", "link", "description", "lastBuildDate"]) assert.match(x, new RegExp(`<channel>[\\s\\S]*<${tag}>`), tag);
      assert.match(x, /<atom:link href="https:\/\/burnticker\.com\/api\/burnticker\/feeds\/[^"]+\.rss" rel="self" type="application\/rss\+xml"\/>/);
      const items = x.match(/<item>[\s\S]*?<\/item>/g) ?? [];
      assert.equal(items.length, d.items.length);
      for (const it of items) for (const tag of ["title", "link", "description", "guid"]) assert.match(it, new RegExp(`<${tag}[ >]`), `${d.id} item ${tag}`);
      for (const m of x.matchAll(/<pubDate>([^<]+)<\/pubDate>/g)) assert.match(m[1], /^[A-Z][a-z]{2}, \d\d [A-Z][a-z]{2} \d{4} \d\d:\d\d:\d\d GMT$/, "RFC 822 dates");
    }
  });
  test("valid JSON Feed 1.1: version, title, feed_url, items with id and content_text, dates in RFC 3339", () => {
    for (const d of docs()) {
      const j = renderJsonFeed(d);
      assert.equal(j.version, "https://jsonfeed.org/version/1.1");
      assert.ok(j.title && j.home_page_url.startsWith(ORIGIN) && j.feed_url.endsWith(".json"));
      assert.ok(Array.isArray(j.items));
      const ids = new Set<string>();
      for (const i of j.items) { assert.ok(typeof i.id === "string" && i.id && !ids.has(i.id)); ids.add(i.id); assert.ok(i.content_text); assert.ok(i.url.startsWith("https://")); if (i.date_published) assert.ok(!Number.isNaN(Date.parse(i.date_published))); }
    }
  });
  test("the receipts feed holds burns only, newest first, with absolute receipt links; devnet and undated rows say so", () => {
    const d = receiptsFeed(EVENTS, ORIGIN, NOW);
    assert.deepEqual(d.items.map((i) => i.id), ["burn:SigBurnOne", "burn:SigDevnet"]);
    assert.equal(d.items[0].url, `${ORIGIN}/burnticker/check?sig=SigBurnOne&cluster=mainnet#verify`);
    assert.match(d.items[1].text, /devnet, a practice network/);
    const c = coinFeed("deficit", EVENTS, ORIGIN, NOW);
    assert.equal(c.items.length, 3); assert.match(c.items[2].text, /does not read the date/); assert.equal(c.items[2].date, null);
  });
  test("empty states are honest sentences, not placeholder items", () => {
    assert.equal(receiptsFeed([], ORIGIN, NOW).emptyText, FEED_COPY.receiptsEmpty);
    assert.match(renderRss(receiptsFeed([], ORIGIN, NOW)), /No burn has been recorded on this site yet/);
    assert.equal(renderJsonFeed(nextResultsFeed([], ORIGIN, NOW))._burnticker.empty, FEED_COPY.nextEmpty);
    assert.match(renderJsonFeed(coinFeed("NEWCOIN", [], ORIGIN, NOW)).description, /Nothing has happened on chain for \$NEWCOIN yet/);
  });
  test("no price words: every fixed sentence and every rendered item passes the copy lint", () => {
    for (const v of Object.values(FEED_COPY)) clean(typeof v === "function" ? v("DEFICIT") : v, "FEED_COPY");
    for (const d of docs()) { clean(d.title, d.id); clean(d.description, d.id); for (const i of d.items) { clean(i.title, d.id); clean(i.text, d.id); } }
  });
  test("next results: one item per coin; its id changes when the coin's state changes", () => {
    const a = nextResultsFeed([ROW], ORIGIN, NOW).items[0], b = nextResultsFeed([{ ...ROW, status: "burned", statusText: "The reading for Oct 16 burned.", receiptHref: "/burnticker/check?sig=X&cluster=mainnet#verify" }], ORIGIN, NOW).items[0];
    assert.notEqual(a.id, b.id); assert.equal(a.title, "Next result for $DEFICIT"); assert.equal(b.url, `${ORIGIN}/burnticker/check?sig=X&cluster=mainnet#verify`); assert.equal(a.date, null, "no dates promised");
  });
  test("file names: .rss and .json only", () => {
    assert.deepEqual(parseFeedFile("receipts.rss"), { name: "receipts", fmt: "rss" });
    assert.deepEqual(parseFeedFile("next-results.json"), { name: "next-results", fmt: "json" });
    for (const bad of ["receipts", "receipts.xml", "../x.rss", ".rss"]) assert.equal(parseFeedFile(bad), null, bad);
  });
  test("content types, caching and the ETag: a conditional GET answers 304", async () => {
    const d = receiptsFeed(EVENTS, ORIGIN, NOW);
    const r = feedResponse(new Request("http://x/"), d, "rss");
    assert.equal(r.headers.get("content-type"), RSS_TYPE);
    assert.match(r.headers.get("cache-control")!, /^public, max-age=300, stale-while-revalidate=600$/);
    const etag = r.headers.get("etag")!;
    assert.equal(feedResponse(new Request("http://x/", { headers: { "if-none-match": etag } }), receiptsFeed(EVENTS, ORIGIN, NOW + 60_000), "rss").status, 304, "the build time alone does not change the tag");
    assert.equal(feedResponse(new Request("http://x/"), d, "json").headers.get("content-type"), JSON_FEED_TYPE);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe("the feed and CSV routes on the fake platform", () => {
  let w: World;
  before(async () => { w = await makeWorld(); });
  after(() => setPlatformForTests(null));
  const ctx = <K extends string>(k: K, v: string) => ({ params: Promise.resolve({ [k]: v } as Record<K, string>) });

  test("receipts.rss, next-results.json and coin/BRONCO.json answer 200 with their types; unknown feeds and coins 404", async () => {
    const r = await feedGET(new Request("http://bt.test/api/burnticker/feeds/receipts.rss"), ctx("feed", "receipts.rss"));
    assert.equal(r.status, 200); assert.equal(r.headers.get("content-type"), RSS_TYPE);
    const x = await r.text(); assert.equal(wellFormed(x), null);
    const n = await feedGET(new Request("http://bt.test/x"), ctx("feed", "next-results.json"));
    assert.equal(n.status, 200); const nj = await n.json() as { items: { title: string }[] }; assert.ok(nj.items.some((i) => i.title === "Next result for $BRONCO"));
    const c = await coinFeedGET(new Request("http://bt.test/x"), ctx("file", "BRONCO.json"));
    assert.equal(c.status, 200); const cj = await c.json() as { title: string; items: { id: string }[] }; assert.equal(cj.title, "$BRONCO on Burnticker");
    assert.equal((await coinFeedGET(new Request("http://bt.test/x"), ctx("file", "NOPE.json"))).status, 404);
    assert.equal((await feedGET(new Request("http://bt.test/x"), ctx("feed", "other.rss"))).status, 404);
    assert.equal((await coinFeedGET(new Request("http://bt.test/x"), ctx("file", "DEFICIT.rss"))).status, 200, "$DEFICIT has a feed before it is registered (empty until its keeper publishes)");
  });

  test("burns.csv: the header row, one row per receipt, text/csv as an attachment, streamed", async () => {
    const r = await burnsCsvGET(new Request("http://bt.test/x"), ctx("ticker", "bronco"));
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("content-type"), "text/csv; charset=utf-8; header=present");
    assert.equal(r.headers.get("content-disposition"), `attachment; filename="BRONCO-burns.csv"`);
    assert.ok(r.body instanceof ReadableStream);
    const lines = (await r.text()).split("\r\n").filter(Boolean);
    assert.equal(lines[0], BURNS_HEADER.join(","));
    assert.equal(lines.length - 1, w.registry.receipts(w.bronco.mint).length);
    for (const l of lines.slice(1)) assert.match(l, /,(true|false|),[a-z-]+$/, "verified then status");
  });

  test("readings.csv: one row per reading the coin counts", async () => {
    const r = await readingsCsvGET(new Request("http://bt.test/x"), ctx("ticker", "DEFICIT2"));
    assert.equal(r.status, 200);
    const lines = (await r.text()).split("\r\n").filter(Boolean);
    assert.equal(lines[0], READINGS_HEADER.join(","));
    assert.ok(lines.length > 1);
    assert.equal((await readingsCsvGET(new Request("http://bt.test/x"), ctx("ticker", "NOPE"))).status, 404);
  });

  test("$DEFICIT before registration reads its keeper's files; an unpublished keeper is the header alone; an unreadable one is 503", async () => {
    const status = { schema: "burnkeeper.status/v1", program: { attestation: { readings: [{ recordDate: "2026-10-16", value: "38505000000000.00", units: 3, signature: "SigReadingOne" }, { recordDate: "2026-10-15", value: "38502000000000.00", units: 12, signature: "SigReadingTwo" }] } } };
    const burns = [{ recordDate: "2026-10-15", now: "38502000000000.00", units: 12, status: "confirmed", signature: "SigB", spent: "0.25", got: "1234", burned: "1234", memo: "DEFICIT|burn|x" }];
    const ok = await coinCsv(w.p, "DEFICIT", "burns", () => ({ status, burns, error: null }));
    assert.equal(await ok.text(), `${BURNS_HEADER.join(",")}\r\n2026-10-15,38502000000000.00,12,SigB,0.25,1234,1234,DEFICIT|burn|x,,confirmed\r\n`);
    const rd = await coinCsv(w.p, "DEFICIT", "readings", () => ({ status, burns, error: null }));
    assert.deepEqual((await rd.text()).split("\r\n").slice(1, 3).map((l) => l.split(",")[0]), ["2026-10-15", "2026-10-16"], "oldest first");
    const none = await coinCsv(w.p, "DEFICIT", "burns", () => ({ status: null, burns: null, error: "The keeper has not published a status file on this host." }));
    assert.equal(await none.text(), `${BURNS_HEADER.join(",")}\r\n`);
    assert.equal((await coinCsv(w.p, "DEFICIT", "burns", () => ({ status: null, burns: null, error: "The keeper's status file could not be read." }))).status, 503);
  });
});

describe("item 7: CSV cells", () => {
  test("RFC 4180 quoting, numbers untouched, formulas defused", () => {
    assert.equal(csvCell(null), ""); assert.equal(csvCell(12), "12"); assert.equal(csvCell(true), "true");
    assert.equal(csvCell('say "hi", ok'), '"say ""hi"", ok"');
    assert.equal(csvCell("line\nbreak"), '"line\nbreak"');
    assert.equal(csvCell("-12.5"), "-12.5"); assert.equal(csvCell("=HYPERLINK(1)"), "'=HYPERLINK(1)"); assert.equal(csvCell("@cmd"), "'@cmd");
    assert.equal(csvLine(["a", 1, null]), "a,1,\r\n");
  });
  test("keeper rows ignore malformed entries and unknown shapes", () => {
    assert.deepEqual(burnRowsFromKeeper({ burns: [{ nope: 1 }] }), []);
    assert.deepEqual(readingRowsFromKeeper({ schema: "other" }, null), []);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Item 10: the rollback drill. The script is never run by a test (it ships to the host); these checks read it. It is not in the public
// tree (it drives deploy-burnticker-host.sh, which is not either), so the script checks skip there.
describe("item 10: the rollback script and its runbook", () => {
  const SCRIPT = path.join(ROOT, "scripts/ops/rollback-burnticker.sh");
  const has = fs.existsSync(SCRIPT);
  test("it ships through the two existing deploy scripts and the probe, and says what is live", { skip: !has }, () => {
    const s = fs.readFileSync(SCRIPT, "utf8");
    assert.match(s, /BURNTICKER_SRC="\$PUB" sh scripts\/ops\/deploy-burnticker-host\.sh \$BUILD_FLAGS/);
    assert.match(s, /sh scripts\/ops\/deploy-sites\.sh'"/);
    assert.match(s, /sh scripts\/ops\/probe-burnticker\.sh/);
    assert.match(s, /echo "Live now"/);
    assert.doesNotMatch(s, /restart mct-burnticker-keeper|--restart-keepers"?\s*$/m, "the keepers are not restarted");
  });
  test("it refuses before changing anything, and a dry run stops before the checkout", { skip: !has }, () => {
    const s = fs.readFileSync(SCRIPT, "utf8");
    const at = (re: RegExp) => s.search(re);
    for (const re of [/not a git checkout/, /uncommitted changes/, /merge-base --is-ancestor/, /is what .* already has checked out/]) assert.ok(at(re) > 0 && at(re) < at(/G checkout --quiet --detach/), String(re));
    assert.ok(at(/if \[ "\$DRY" = 1 \]; then .*exit 0; fi/) < at(/G checkout --quiet --detach/));
    assert.ok(at(/\[ "\$answer" = "\$SHORT" \]/) < at(/G checkout --quiet --detach/), "typed confirmation first");
  });
  test("ROLLBACK.md stages the drill command and names no private path", () => {
    const md = fs.readFileSync(path.join(ROOT, "docs/burnticker/ROLLBACK.md"), "utf8");
    assert.match(md, /sh scripts\/ops\/rollback-burnticker\.sh [0-9a-f]{7} --dry-run/);
    assert.match(md, /Rolling forward again/);
    // the private words are spelled in pieces so this file passes the public tree's own leak scan
    assert.doesNotMatch(md, new RegExp(["/Us" + "ers/", "/ho" + "me/[a-z]", "/ro" + "ot/", "tail" + "scale", "[.]e" + "nv\\b"].join("|"), "i"));
  });
});
