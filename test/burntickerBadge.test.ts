// THE EMBEDDABLE RECEIPT BADGE (growth batch 2026-10-10; src/lib/burnticker/badge.ts, badgeServe.ts, embed.ts): the SVG renders for the
// fixture coins and a pair; every word on the card, in the payload and on the embed page passes the copy lint; no payload carries a
// price, market cap, odds, implied chance or volume; the routes answer svg / png / json with a 60 s cache, 404 for drafts and unknowns;
// the embed page is frame-safe (CSP frame-ancestors *, hashes for its one style and one script) and sets no cookie.
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { API, callRoute, makeWorld, validateSchema, type World } from "./burntickerApiHelpers.ts";
import { buildOpenApi, endpoint, API_VERSION } from "@/lib/burnticker/api/spec";
import { lintCopy, loadCopyLintConfig, formatHits } from "@/lib/launch/copyLint";
import { BADGE_H, badgePayloadProblems, badgeStrings, clip, coinBadge, coinCardLines, pairCardLines, renderCoinBadgeSvg, seasonScope, svgText, type BadgeJson, type CoinBadgeJson, type PairBadgeJson } from "@/lib/burnticker/badge";
import { EMBED_CSP, EMBED_SCRIPT, EMBED_STYLE, embedText, nextLine, renderEmbedHtml } from "@/lib/burnticker/embed";
import { clearBadgeMemo, parseBadgeFile } from "@/lib/burnticker/badgeServe";
import { nativeRule } from "@/lib/burnticker/sources/native";
import { teamSeries } from "@/lib/burnticker/sources/espn";
import { NOW } from "./burntickerHelpers.ts";

const DOC = buildOpenApi() as unknown as Record<string, unknown> & { paths: Record<string, Record<string, { responses: Record<string, { content: Record<string, { schema: Record<string, unknown> }> }> }>> };
const cfg = loadCopyLintConfig();
const lintAll = (texts: string[], what: string) => { for (const t of texts) { const r = lintCopy(t, cfg); assert.ok(r.ok, `${what}: "${t}"\n${formatHits(r)}`); } };

let w: World;
before(async () => {
  w = await makeWorld();
  clearBadgeMemo();
  // the badge reads a pair row and both sides' pages; the pairing rules (registerPair) are not what is under test here
  w.registry.db.prepare("INSERT INTO pairs (pair_id, mint_a, mint_b, selector_key, created_at) VALUES (?,?,?,?,?)").run("bronco-vs-deficit2", w.bronco.mint, w.deficit.mint, w.bronco.selectorKey, NOW);
});

const get = async (path: string) => callRoute(`${API}${path}`);

describe("badge routes", () => {
  test("GET /badge/BRONCO.json: a coin card payload matching its schema, linted, with no market-data key", async () => {
    const res = await get("/badge/BRONCO.json");
    assert.equal(res.status, 200);
    const b = await res.json() as CoinBadgeJson;
    const schema = DOC.paths["/badge/{file}"].get.responses["200"].content["application/json"].schema;
    assert.deepEqual(validateSchema(schema, b, DOC), []);
    assert.equal(b.kind, "coin"); assert.equal(b.ticker, "BRONCO"); assert.equal(b.schema, "burnticker.badge/v1");
    assert.ok(b.oneLiner.length > 0);
    assert.match(b.verifyUrl, /\/burnticker\/t\/BRONCO#verify$/);
    assert.match(b.embed.iframe, /^<iframe src="http:\/\/bt\.test\/burnticker\/embed\/BRONCO"/);
    assert.match(b.embed.markdown, /^\[!\[\$BRONCO receipts on Burnticker\]\(http:\/\/bt\.test\/api\/burnticker\/v1\/badge\/BRONCO\.svg\)\]\(http:\/\/bt\.test\/burnticker\/t\/BRONCO\)$/);
    assert.deepEqual(badgePayloadProblems(b), []);
    assert.doesNotMatch(JSON.stringify(b), /impliedChance|"price|marketCap|"odds|volume|liquidity/i);
    lintAll(badgeStrings(b), "BRONCO payload");
    assert.equal(res.headers.get("access-control-allow-origin"), "*");
    assert.match(res.headers.get("cache-control")!, /^public, max-age=60,/);
    assert.equal(res.headers.get("x-burnticker-api"), API_VERSION);
  });

  test("GET /badge/BRONCO.svg and DEFICIT2.svg: an SVG card for each fixture coin, every text node lint-clean, cached 60 s", async () => {
    for (const t of ["BRONCO", "DEFICIT2", w.bronco.mint]) {
      const res = await get(`/badge/${t}.svg`);
      assert.equal(res.status, 200, t);
      assert.match(res.headers.get("content-type")!, /^image\/svg\+xml/);
      assert.match(res.headers.get("cache-control")!, /max-age=60/);
      assert.match(res.headers.get("content-security-policy")!, /default-src 'none'/);
      const svg = await res.text();
      assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="480" height="172"/);
      assert.ok(svg.includes(t === w.bronco.mint ? "$BRONCO" : `$${t}`));
      assert.match(svg, /verify →/); assert.match(svg, /receipts /); assert.match(svg, /(last burn \d{4}-\d\d-\d\d · \d+ units?|no burn yet)/);
      assert.doesNotMatch(svg, /<script|on[a-z]+=|href=/i, "no script, no handler, no link inside the SVG");
      lintAll(svgText(svg), `${t}.svg`);
    }
  });

  test("GET /badge/BRONCO.png: a PNG of the same card", async () => {
    const res = await get("/badge/BRONCO.png");
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "image/png");
    const buf = new Uint8Array(await res.arrayBuffer());
    assert.deepEqual([...buf.slice(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    assert.ok(buf.length > 2000);
  });

  test("pairs: /badge/pairs/<id>.svg|.json — both sides, the burns per side, lint-clean, no market data", async () => {
    const res = await get("/badge/pairs/bronco-vs-deficit2.json");
    assert.equal(res.status, 200);
    const b = await res.json() as PairBadgeJson;
    const schema = DOC.paths["/badge/pairs/{file}"].get.responses["200"].content["application/json"].schema;
    assert.deepEqual(validateSchema(schema, b, DOC), []);
    assert.equal(b.kind, "pair"); assert.equal(b.a.ticker, "BRONCO"); assert.equal(b.b.ticker, "DEFICIT2");
    assert.ok(Number.isInteger(b.score.a) && Number.isInteger(b.score.b));
    assert.deepEqual(badgePayloadProblems(b), []);
    lintAll(badgeStrings(b), "pair payload");
    const svg = await (await get("/badge/pairs/bronco-vs-deficit2.svg")).text();
    assert.match(svg, /\$BRONCO vs \$DEFICIT2/); assert.match(svg, /burns \d+ : \d+/);
    lintAll(svgText(svg), "pair svg");
  });

  test("404s: an unknown coin, a draft, a bad file name, an unknown pair — as JSON errors, never cached", async () => {
    for (const p of ["/badge/NOPE.svg", "/badge/BRONCO.gif", "/badge/..%2Fx.svg", "/badge/pairs/nope.svg"]) {
      const res = await get(p);
      assert.equal(res.status, 404, p);
      assert.equal(res.headers.get("cache-control"), "no-store");
      assert.ok((await res.json() as { error: string }).error);
    }
    assert.equal(parseBadgeFile("BRONCO.svg")?.fmt, "svg"); assert.equal(parseBadgeFile("BRONCO"), null); assert.equal(parseBadgeFile("a b.svg"), null);
  });

  test("the OpenAPI document lists both badge operations with image media types besides JSON", () => {
    for (const op of ["getBadge", "getPairBadge"]) {
      const e = endpoint(op);
      assert.equal(e.cacheSec, 60); assert.equal(e.bucket, "read");
      const content = DOC.paths[e.path].get.responses["200"].content;
      assert.deepEqual(Object.keys(content).sort(), ["application/json", "image/png", "image/svg+xml"]);
    }
  });
});

describe("badge rendering (pure)", () => {
  test("same input → byte-identical SVG; the one-liner is clipped on a word boundary", async () => {
    clearBadgeMemo();
    const b = await (await get("/badge/DEFICIT2.json")).json() as CoinBadgeJson;
    assert.equal(renderCoinBadgeSvg(b), renderCoinBadgeSvg(JSON.parse(JSON.stringify(b))));
    assert.equal(clip("burns when the Edmonton Oilers lose a regular season or playoff game", 40), "burns when the Edmonton Oilers lose a…");
    assert.ok(coinCardLines({ ...b, oneLiner: "x ".repeat(80) }).liner.length <= 50);
  });

  test("season scope: a team coin's own season window; everything else the calendar year", () => {
    const nhl = nativeRule(teamSeries("nhl", "EDM", "loss", { kind: "season", year: 2027 }));
    assert.deepEqual(seasonScope(nhl as never, NOW), { label: "2026–27 season", from: null });
    const post = nativeRule(teamSeries("mlb", "TB", "win", { kind: "post", year: 2026 }));
    assert.equal(seasonScope(post as never, NOW).label, "2026 postseason");
    assert.deepEqual(seasonScope({ oracle: "catalogue", series: "treasury.debt" }, Date.parse("2026-10-10T00:00:00Z")), { label: "in 2026", from: "2026-01-01" });
  });

  test("a payload with any market-data key is refused by the guard (and would never be cached)", () => {
    assert.deepEqual(badgePayloadProblems({ a: { impliedChance: 0.4 }, price: 1 }).length, 2);
    assert.deepEqual(badgePayloadProblems({ next: { marketCapUsd: 1 } }).length, 1);
  });

  test("pair lines and coin lines lint clean for every status a coin can be in", async () => {
    const b = await (await get("/badge/BRONCO.json")).json() as CoinBadgeJson;
    for (const status of ["live", "paused", "retired"] as const) {
      const L = coinCardLines({ ...b, status, lastBurn: null });
      lintAll(Object.values(L).filter((x): x is string => !!x), status);
    }
    const p = await (await get("/badge/pairs/bronco-vs-deficit2.json")).json() as PairBadgeJson;
    lintAll(Object.values(pairCardLines(p)), "pair lines");
  });
});

describe("the embed page", () => {
  const callEmbed = async (path: string) => {
    const pairs = /^\/pairs\/(.+)$/.exec(path);
    const mod = await import(pairs ? "../src/app/burnticker/embed/pairs/[pairId]/route.ts" : "../src/app/burnticker/embed/[ticker]/route.ts") as { GET: (r: Request, c: { params: Promise<Record<string, string>> }) => Promise<Response> };
    return mod.GET(new Request(`http://bt.test/burnticker/embed${path}`, { headers: { host: "bt.test" } }), { params: Promise.resolve((pairs ? { pairId: pairs[1] } : { ticker: path.slice(1) }) as Record<string, string>) });
  };

  test("frame-safe: CSP frame-ancestors *, hashed style + script only, no cookie, cached 60 s, noindex", async () => {
    const res = await callEmbed("/BRONCO");
    assert.equal(res.status, 200);
    const csp = res.headers.get("content-security-policy")!;
    assert.equal(csp, EMBED_CSP);
    assert.match(csp, /frame-ancestors \*/); assert.match(csp, /default-src 'none'/); assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
    const h = (s: string) => `'sha256-${crypto.createHash("sha256").update(s).digest("base64")}'`;
    assert.ok(csp.includes(`script-src ${h(EMBED_SCRIPT)}`)); assert.ok(csp.includes(`style-src ${h(EMBED_STYLE)}`));
    assert.equal(res.headers.get("set-cookie"), null);
    assert.equal(res.headers.get("x-frame-options"), null);
    assert.match(res.headers.get("cache-control")!, /^public, max-age=60/);
    assert.equal(res.headers.get("x-robots-tag"), "noindex");
    const html = await res.text();
    assert.equal((html.match(/<script>/g) ?? []).length, 1, "exactly the one hashed script");
    assert.equal((html.match(/<style>/g) ?? []).length, 1);
    assert.doesNotMatch(html, / style="/, "no inline style attributes (the CSP would block them)");
    assert.ok(html.includes(`<script>${EMBED_SCRIPT}</script>`) && html.includes(`<style>${EMBED_STYLE}</style>`), "the served bytes are the hashed bytes");
    assert.match(html, /\$BRONCO/); assert.match(html, /next settlement/);
    assert.doesNotMatch(html, /document\.cookie|localStorage|fetch\(/);
    lintAll([embedText(html)], "embed page");
  });

  test("the pair embed, and 404s that stay frame-safe and uncached", async () => {
    const ok = await callEmbed("/pairs/bronco-vs-deficit2");
    assert.equal(ok.status, 200);
    lintAll([embedText(await ok.text())], "pair embed");
    for (const p of ["/NOPE", "/pairs/nope"]) {
      const res = await callEmbed(p);
      assert.equal(res.status, 404, p);
      assert.equal(res.headers.get("cache-control"), "no-store");
      assert.match(res.headers.get("content-security-policy")!, /frame-ancestors \*/);
    }
  });

  test("the next-settlement line: a countdown when a time is known, plain words otherwise", () => {
    const now = Date.parse("2026-10-10T12:00:00Z");
    assert.deepEqual(nextLine({ nextSettlementAt: "2026-10-10T15:30:00.000Z", nextSettlementNote: "the keeper's next read of the source" }, now).lead, "in 3h 30m");
    assert.equal(nextLine({ nextSettlementAt: "2026-10-12T12:00:00.000Z", nextSettlementNote: "x" }, now).lead, "in 2d 0h");
    assert.equal(nextLine({ nextSettlementAt: null, nextSettlementNote: "resolves once" }, now).lead, "resolves once");
    assert.equal(nextLine({ nextSettlementAt: null, nextSettlementNote: "no result scheduled" }, now).lead, "no result scheduled");
  });

  test("the card on the embed page is the badge's own SVG (one renderer)", async () => {
    clearBadgeMemo();
    const b = await (await get("/badge/BRONCO.json")).json() as BadgeJson;
    const html = renderEmbedHtml(b, NOW);
    assert.ok(html.includes(renderCoinBadgeSvg(b as CoinBadgeJson)));
    assert.ok(BADGE_H < 230, "the snippet's iframe height fits the card and the line");
  });
});

describe("coin page snippet box", () => {
  test("the coin page mounts the Share block (website-17: ShareBlock carries the same iframe and badge) and the verifier section has the #verify anchor the badge links to", async () => {
    const fs = await import("node:fs");
    const page = fs.readFileSync(new URL("../src/app/burnticker/t/[ticker]/page.tsx", import.meta.url), "utf8");
    assert.match(page, /<ShareBlock ticker=\{s\.ticker\} \/>/); assert.doesNotMatch(page, /<EmbedSnippet kind="coin"/); assert.match(page, /id="verify"/);
    const pair = fs.readFileSync(new URL("../src/app/burnticker/p/[pairId]/page.tsx", import.meta.url), "utf8");
    assert.match(pair, /<EmbedSnippet kind="pair"/);
    const box = fs.readFileSync(new URL("../src/app/burnticker/_components/EmbedSnippet.tsx", import.meta.url), "utf8");
    const words = [...box.matchAll(/>([^<>{}]+)</g)].map((m) => m[1].trim()).filter(Boolean);
    lintAll([...words, "The receipt card shows no market data and refreshes every minute.", "Embed this coin", "Embed this pair"], "snippet box");
  });
  test("coinBadge builds snippets from the origin it is given", async () => {
    const d = await (await get("/badge/BRONCO.json")).json() as CoinBadgeJson;
    assert.ok(d.badgeUrl.png.endsWith("/api/burnticker/v1/badge/BRONCO.png"));
    assert.equal(typeof coinBadge, "function");
  });
});
