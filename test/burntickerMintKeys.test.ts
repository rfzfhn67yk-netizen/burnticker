// TICKERS ARE NOT UNIQUE (owner decision 2026-10-12). Two live coins may share a ticker; every lookup and link resolves by MINT
// (src/lib/burnticker/coinKey.ts, coinLookup.ts). A ticker one coin holds keeps working; a ticker several coins share answers with the
// list of coins (the page's chooser, a 300 from the APIs, a plain refusal naming the mints from the CSV and image routes).
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import { API, CREATOR, POST_HEADERS, callRoute, makeWorld, type World } from "./burntickerApiHelpers.ts";
import { DENVER_HIGH } from "./burntickerHelpers.ts";
import { lockRule } from "@/lib/burnticker/rules";
import { openRegistry } from "@/lib/burnticker/registry";
import { CHOOSER_COPY, byCoin, chooserRows, coinKey, coinPageHref, isMintKey, sharedTickers, siteKeysOf } from "@/lib/burnticker/coinKey";
import { lookupCoin, registryCoinKey, sharedTickerBody, sharedTickerSentence } from "@/lib/burnticker/coinLookup";
import { cardViewFromIndex, type IndexCoin } from "@/lib/burnticker/cardView";
import { clearBadgeMemo } from "@/lib/burnticker/badgeServe";
import { coinCsv } from "@/lib/burnticker/csvServe";
import { csvHref, feedHref } from "@/lib/burnticker/exportLinks";
import { coinImage } from "@/lib/burnticker/coinArtServe";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";

type Handler = (req: Request, ctx: { params: Promise<{ ticker: string }> }) => Promise<Response>;
const pageApi = async (key: string): Promise<Response> => {
  const { GET } = await import("../src/app/api/burnticker/tokens/[ticker]/route.ts") as { GET: Handler };
  return GET(new Request(`http://bt.test/api/burnticker/tokens/${encodeURIComponent(key)}`), { params: Promise.resolve({ ticker: key }) });
};

describe("tickers are not unique; coins resolve by mint", () => {
  let w: World, twin: string;
  before(async () => {
    w = await makeWorld();
    clearBadgeMemo();
    // a second $BRONCO through the public launch API (prepareLaunch), then taken live
    twin = Keypair.generate().publicKey.toBase58();
    const r = await callRoute(`${API}/launch/bundle`, { method: "POST", headers: POST_HEADERS, body: JSON.stringify({ creator: CREATOR, mint: twin, ticker: "BRONCO", name: "Bronco heat", rule: DENVER_HIGH, acknowledgements: { ruleLocked: true, noReturns: true } }) });
    assert.equal(r.status, 200, JSON.stringify(await r.clone().json()).slice(0, 300));
    const c = await callRoute(`${API}/launch/confirm`, { method: "POST", headers: POST_HEADERS, body: JSON.stringify({ mint: twin, signature: "7".repeat(88) }) });
    assert.equal(c.status, 200, JSON.stringify(await c.clone().json()).slice(0, 300));
  });

  test("two live coins with the same ticker both register (prepareLaunch and the registry)", () => {
    const held = w.registry.tokensByTicker("BRONCO");
    assert.deepEqual(held.map((t) => t.mint).sort(), [w.bronco.mint, twin].sort());
    assert.ok(held.every((t) => t.status === "live"));
    // the registry on its own: a third coin on the same ticker registers too
    const reg = openRegistry(":memory:");
    const row = (mint: string) => reg.register({ mint, ticker: "SAME", name: "same", creator: CREATOR, description: "", imageUrl: null, links: [], rulesText: lockRule(DENVER_HIGH).text, feePda: "F", vault: null, tokenConfig: null, poolId: null, launchTx: null, cluster: "devnet", platformId: null, baselineAt: "2026-10-12T00:00:00Z", status: "draft" });
    row(Keypair.generate().publicKey.toBase58()); row(Keypair.generate().publicKey.toBase58());
    assert.equal(reg.tokensByTicker("same").length, 2);
    assert.equal(reg.tickerTaken("SAME"), true, "tickerTaken still answers; it no longer refuses");
  });

  test("lookupCoin: a mint is that coin, a shared ticker is the list, a unique ticker is its coin", () => {
    const one = lookupCoin(w.registry, twin);
    assert.equal(one.kind === "one" && one.token.name, "Bronco heat");
    const many = lookupCoin(w.registry, "bronco");
    assert.equal(many.kind, "many");
    assert.equal(many.kind === "many" && many.tokens.length, 2);
    const uniq = lookupCoin(w.registry, w.deficit.ticker);
    assert.equal(uniq.kind === "one" && uniq.token.mint, w.deficit.mint);
    assert.equal(lookupCoin(w.registry, "NOPE").kind, "none");
    assert.equal(registryCoinKey(w.registry, w.bronco), w.bronco.mint);
    assert.equal(registryCoinKey(w.registry, w.deficit), w.deficit.ticker, "a ticker one coin holds stays its key");
  });

  test("the coin page's API: a shared ticker answers 300 with the candidates; a unique ticker and a mint answer the coin", async () => {
    const r = await pageApi("BRONCO");
    assert.equal(r.status, 300);
    const j = await r.json() as ReturnType<typeof sharedTickerBody>;
    assert.equal(j.code, "ticker-shared"); assert.equal(j.ticker, "BRONCO");
    assert.deepEqual(j.candidates.map((c) => c.mint).sort(), [w.bronco.mint, twin].sort());
    for (const c of j.candidates) { assert.equal(c.href, `/burnticker/t/${c.mint}`); assert.equal(c.creator, CREATOR); assert.ok(c.name && c.rule); }
    const u = await pageApi(w.deficit.ticker);
    assert.equal(u.status, 200);
    assert.equal((await u.json() as { status: { mint: string } }).status.mint, w.deficit.mint);
    const m = await pageApi(twin);
    assert.equal(m.status, 200);
    assert.equal((await m.json() as { status: { mint: string; ticker: string } }).status.mint, twin);
    assert.equal((await pageApi("NOPE")).status, 404);
  });

  test("the /t/<ticker> chooser lists both coins by mint, each linked to its mint page", () => {
    const l = lookupCoin(w.registry, "BRONCO");
    assert.equal(l.kind, "many");
    const rows = chooserRows(sharedTickerBody(w.registry, l as Extract<typeof l, { kind: "many" }>).candidates);
    assert.deepEqual(rows.map((r) => r.mint).sort(), [w.bronco.mint, twin].sort());
    for (const r of rows) {
      assert.equal(r.href, `/burnticker/t/${r.mint}`);
      assert.match(r.mintShort, /^\w{4}…\w{4}$/); assert.match(r.creatorShort, /^\w{4}…\w{4}$/);
      assert.ok(r.rule.length > 0);
    }
  });

  test("the v1 tokens API: 300 with the candidates for the shared ticker, the coin for a unique ticker or a mint", async () => {
    const shared = await callRoute(`${API}/tokens/BRONCO`);
    assert.equal(shared.status, 300);
    const body = await shared.json() as { code: string; candidates: { mint: string; name: string; creator: string; href: string }[] };
    assert.equal(body.code, "ticker-shared");
    assert.deepEqual(body.candidates.map((c) => c.mint).sort(), [w.bronco.mint, twin].sort());
    const uniq = await callRoute(`${API}/tokens/${w.deficit.ticker}`);
    assert.equal(uniq.status, 200);
    assert.equal((await uniq.json() as { status: { mint: string } }).status.mint, w.deficit.mint);
    const byMint = await callRoute(`${API}/tokens/${twin}`);
    assert.equal(byMint.status, 200);
    assert.equal((await callRoute(`${API}/tokens/BRONCO/receipts`)).status, 300);
    assert.equal((await callRoute(`${API}/tokens/${w.bronco.mint}/receipts`)).status, 200);
    // the list's links use the mint for a shared ticker and the ticker otherwise
    const list = await (await callRoute(`${API}/tokens`)).json() as { tokens: { mint: string; ticker: string; links: { page: string } }[] };
    for (const t of list.tokens) assert.equal(t.links.page, t.ticker === "BRONCO" ? `/burnticker/t/${t.mint}` : `/burnticker/t/${t.ticker}`);
  });

  test("badge, CSV and coin art take a mint; a shared ticker answers with the mints; their links use the mint", async () => {
    const shared = await callRoute(`${API}/badge/BRONCO.json`);
    assert.equal(shared.status, 300);
    const b = await callRoute(`${API}/badge/${w.bronco.mint}.json`);
    assert.equal(b.status, 200);
    const badge = await b.json() as { pageUrl: string; badgeUrl: { svg: string }; embedUrl: string };
    assert.match(badge.pageUrl, new RegExp(`/burnticker/t/${w.bronco.mint}$`));
    assert.match(badge.badgeUrl.svg, new RegExp(`/badge/${w.bronco.mint}\\.svg$`));
    assert.match(badge.embedUrl, new RegExp(`/burnticker/embed/${w.bronco.mint}$`));
    const one = await (await callRoute(`${API}/badge/${w.deficit.ticker}.json`)).json() as { pageUrl: string };
    assert.match(one.pageUrl, new RegExp(`/burnticker/t/${w.deficit.ticker}$`), "a unique ticker keeps its ticker links");

    const csvShared = await coinCsv(w.p, "BRONCO", "burns");
    assert.equal(csvShared.status, 300);
    const text = await csvShared.text();
    assert.ok(text.includes(w.bronco.mint) && text.includes(twin));
    const csvMint = await coinCsv(w.p, w.bronco.mint, "burns");
    assert.equal(csvMint.status, 200);
    assert.equal(csvHref(w.bronco.mint, "burns"), `/api/burnticker/coins/${w.bronco.mint}/burns.csv`, "a mint keeps its case");
    assert.equal(csvHref("bronco", "readings"), "/api/burnticker/coins/BRONCO/readings.csv");
    assert.equal(feedHref({ coin: twin }, "rss"), `/api/burnticker/feeds/coin/${twin}.rss`);

    const art = await coinImage({ registry: w.registry, file: "BRONCO.svg", query: new URLSearchParams() });
    assert.equal(art.status, 300);
    assert.ok(String(art.body).includes(twin));
    assert.equal((await coinImage({ registry: w.registry, file: `${twin}.svg`, query: new URLSearchParams() })).status, 200);
  });

  test("cardView links by mint when the ticker is shared, by ticker otherwise", () => {
    const coin = (ticker: string, mint: string): IndexCoin => ({ ticker, name: ticker, mint, oneLiner: "burns on a result", status: "live", imageUrl: null, burned: "0", burns: 1, nextCheckAt: null, nextCloseTime: null, lastBurnAt: null, launchedAt: null, pairId: null, phase: null, progressPct: null } as unknown as IndexCoin);
    const a = coin("BRONCO", w.bronco.mint), b = coin("BRONCO", twin), c = coin("DEFICIT2", w.deficit.mint);
    const shared = sharedTickers([a, b, c]);
    assert.deepEqual([...shared], ["BRONCO"]);
    assert.equal(cardViewFromIndex(a, null, "devnet", shared).href, `/burnticker/t/${w.bronco.mint}`);
    assert.equal(cardViewFromIndex(a, null, "devnet", shared).receipt?.href, `/burnticker/t/${w.bronco.mint}#receipts`);
    assert.equal(cardViewFromIndex(c, null, "devnet", shared).href, "/burnticker/t/DEFICIT2");
    assert.equal(cardViewFromIndex(c, null, "devnet").href, "/burnticker/t/DEFICIT2", "no set: the ticker, as before");
  });

  test("static publishing keys: the first launched coin keeps t/<TICKER> and also gets t/<MINT>; a later coin gets t/<MINT>", () => {
    const k = siteKeysOf([
      { ticker: "RAYS", mint: "MintOne1111111111111111111111111111111111", status: "live", launchedAt: "2026-10-01T00:00:00Z" },
      { ticker: "RAYS", mint: "MintTwo1111111111111111111111111111111111", status: "live", launchedAt: "2026-10-05T00:00:00Z" },
      { ticker: "SOLO", mint: "MintSolo111111111111111111111111111111111", status: "live", launchedAt: "2026-10-02T00:00:00Z" },
      { ticker: "SOLO", mint: "MintGone111111111111111111111111111111111", status: "expired", launchedAt: null },
    ]);
    assert.deepEqual(k.get("MintOne1111111111111111111111111111111111"), ["RAYS", "MintOne1111111111111111111111111111111111"]);
    assert.deepEqual(k.get("MintTwo1111111111111111111111111111111111"), ["MintTwo1111111111111111111111111111111111"]);
    assert.deepEqual(k.get("MintSolo111111111111111111111111111111111"), ["SOLO"], "a ticker one coin holds keeps its path");
    assert.deepEqual(k.get("MintGone111111111111111111111111111111111"), ["MintGone111111111111111111111111111111111"]);
    // an older draft that launches after another coin on its ticker does not take the ticker path
    const d = siteKeysOf([
      { ticker: "X", mint: "MintDraftLate11111111111111111111111111111", status: "live", launchedAt: "2026-10-09T00:00:00Z" },
      { ticker: "X", mint: "MintFirstLive1111111111111111111111111111", status: "live", launchedAt: "2026-10-03T00:00:00Z" },
    ]);
    assert.equal(d.get("MintFirstLive1111111111111111111111111111")![0], "X");
    assert.equal(byCoin({ RAYS: 1 }, { ticker: "RAYS", mint: "M" }), 1, "maps keyed by ticker still read");
    assert.equal(byCoin({ RAYS: 1, M: 2 }, { ticker: "RAYS", mint: "M" }), 2, "the mint wins");
  });

  test("keys: a mint and a ticker never collide; coinKey and coinPageHref", () => {
    assert.equal(isMintKey(w.bronco.mint), true); assert.equal(isMintKey("BRONCO"), false); assert.equal(isMintKey("O0Il".repeat(9)), false);
    assert.equal(coinKey({ ticker: "A1", mint: "M" }, false), "A1"); assert.equal(coinKey({ ticker: "A1", mint: "M" }, new Set(["A1"])), "M");
    assert.equal(coinPageHref({ ticker: "A1", mint: "M" }, true), "/burnticker/t/M");
  });

  test("the words a visitor reads are plain and pass the copy lint", () => {
    const cfg = loadCopyLintConfig();
    for (const s of [CHOOSER_COPY.intro("BRONCO"), sharedTickerSentence("BRONCO"), CHOOSER_COPY.mint, CHOOSER_COPY.creator]) {
      const r = lintCopy(s, cfg);
      assert.ok(r.ok, `${s}: ${r.hits.map((h) => h.phrase).join(", ")}`);
      assert.doesNotMatch(s, / → |\bwill\b|\(\d+\)|[^\s/]+ \/ [^\s/]+ \/ [^\s/]+|\d{4}-\d{2}-\d{2}/);
    }
  });
});
