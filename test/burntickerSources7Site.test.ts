// sources-7 (QA walkthrough 11, 2026-10-13, items M5, M12, M13 and L8): the Not Burnticker list never flags a token older than the coin
// it supposedly imitates and says "the word Deficit" plainly; an unknown coin page is a real 404 (the $DEFICIT pre-launch page, disclosed
// rehearsal coins and an unreadable registry excepted); "bitcoin record close" finds the record-close launch type and "national debt" no
// longer lists storms and wildfires; the checkers refuse a malformed signature or address in one plain sentence, before any RPC call.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { API, callRoute, makeWorld } from "./burntickerApiHelpers.ts";
import { lintCopy, loadCopyLintConfig, formatHits } from "@/lib/launch/copyLint";
import { cloneRows, cloneStore, evidenceLines, lastScanSentence, PLATFORM_TERM_SINCE, scanClones, termSinceFor, type CloneObservation } from "@/lib/burnticker/ops/cloneWatch";
import { coinPageFound, coinPageTitle, type CoinLookup } from "@/lib/burnticker/coinLookup";
import { universalSearch } from "@/lib/burnticker/search";
import { recordCloseIntent } from "@/lib/burnticker/recordCloseSearch";
import { catalogueSources } from "@/lib/burnticker/api/handlers";
import { checkReceiptTx, classifySignatureInput } from "@/lib/burnticker/trustpack/receiptCheck";
import { v1CheckReceipt } from "@/lib/burnticker/trustpack/api";
import { isSolanaAddress, verifyMint } from "@/lib/burnticker/verifyMint";

const cfg = loadCopyLintConfig();
const plain = (t: string, what = "copy") => { const r = lintCopy(t, cfg); assert.ok(r.ok, `${what}: "${t}"\n${formatHits(r)}`); };
const NOW = Date.parse("2026-10-13T12:00:00Z");
const MINT = "So11111111111111111111111111111111111111112";

// ---- M12: Not Burnticker ----------------------------------------------------------------------------------------------------------

const DDP: CloneObservation = { mint: "DDPmint1111111111111111111111111111111111111", at: Date.parse("2026-10-11T10:00:00Z"), symbol: "DDP", name: "Debt Deficit and Porky", pool: "PoolDDP", dex: "raydium", url: null, poolCreatedAt: Date.parse("2026-08-07T15:00:00Z"), liquidityUsd: 900, matched: { term: "DEFICIT", how: "name contains it" }, registered: false, bundle: null };
const COPY: CloneObservation = { ...DDP, mint: "Copy111111111111111111111111111111111111111", symbol: "DEF1CIT", name: "Deficit", pool: "PoolC", poolCreatedAt: Date.parse("2026-10-12T09:00:00Z"), matched: { term: "DEFICIT", how: "ticker reads as the same letters" } };

describe("M12: a token older than the coin it is said to imitate is never a lookalike", () => {
  test("$DDP, whose pool was created on 2026-08-07, is dropped; a copy made after $DEFICIT existed stays", () => {
    const rows = cloneRows([DDP, COPY]);
    assert.deepEqual(rows.map((r) => r.symbol), ["DEF1CIT"]);
    assert.ok(Date.parse(PLATFORM_TERM_SINCE.DEFICIT) > DDP.poolCreatedAt!);
  });
  test("a launched ticker is dated by its own coin in the registry; a token with no pool time is kept", () => {
    const since = termSinceFor([{ ticker: "BRONCO", createdAt: Date.parse("2026-10-11T00:00:00Z"), status: "live" }, { ticker: "BRONCO", createdAt: Date.parse("2026-10-12T00:00:00Z"), status: "live" }, { ticker: "OLDDRAFT", createdAt: 1, status: "draft" }]);
    assert.equal(since.BRONCO, Date.parse("2026-10-11T00:00:00Z")); assert.equal(since.OLDDRAFT, undefined);
    const older = { ...COPY, mint: "B1", symbol: "BRONC0", matched: { term: "BRONCO", how: "ticker reads as the same letters" }, poolCreatedAt: Date.parse("2026-10-01T00:00:00Z") };
    const newer = { ...older, mint: "B2", poolCreatedAt: Date.parse("2026-10-12T06:00:00Z") };
    const unknown = { ...older, mint: "B3", poolCreatedAt: null };
    assert.deepEqual(cloneRows([older, newer, unknown], new Set(), since).map((r) => r.mint).sort(), ["B2", "B3"]);
  });
  test("the scan itself skips a pool created before the term existed", async () => {
    const body = { pairs: [{ chainId: "solana", dexId: "raydium", pairAddress: "PoolDDP", baseToken: { address: DDP.mint, symbol: "DDP", name: "Debt Deficit and Porky" }, liquidity: { usd: 900 }, pairCreatedAt: DDP.poolCreatedAt }, { chainId: "solana", dexId: "raydium", pairAddress: "PoolC", baseToken: { address: COPY.mint, symbol: "DEF1CIT", name: "Deficit" }, liquidity: { usd: 900 }, pairCreatedAt: COPY.poolCreatedAt }] };
    const s = await scanClones({ terms: ["DEFICIT"], ownMints: new Set(), now: () => NOW, fetchImpl: (async () => ({ ok: true, status: 200, json: async () => body })) as never });
    assert.deepEqual(s.observations.map((o) => o.mint), [COPY.mint]);
  });
  test("a name match says the word plainly, never that the name contains $DEFICIT", () => {
    const base = { mint: "M", chain: "solana" as const, symbol: "ZZZ", name: "The Deficit Coin", pool: null, dex: null, url: null, firstSeenAt: "2026-10-12T00:00:00.000Z", lastSeenAt: "2026-10-12T00:00:00.000Z", poolCreatedAt: null, registered: false, bundle: null, lp: { state: "unknown" as const, pulledAt: null } };
    const d = evidenceLines({ ...base, matched: { term: "DEFICIT", how: "name contains it" } });
    assert.equal(d[1], "The name of $ZZZ contains the word Deficit.");
    assert.doesNotMatch(d.join(" "), /contains \$DEFICIT/);
    const b = evidenceLines({ ...base, name: "Burn Ticker", matched: { term: "BURNTICKER", how: "name contains it" } });
    assert.equal(b[1], "The name of $ZZZ contains the word Burnticker.");
    for (const l of [...d, ...b]) plain(l, "evidence");
  });
  test("the list is sorted by first seen, newest first", () => {
    const a = { ...COPY, mint: "A1", at: Date.parse("2026-10-12T10:00:00Z") };
    const b = { ...COPY, mint: "B1", at: Date.parse("2026-10-13T10:00:00Z") };
    const aLater = { ...a, at: Date.parse("2026-10-13T11:00:00Z") };   // seen again later: first seen is unchanged
    assert.deepEqual(cloneRows([a, b, aLater]).map((r) => r.mint), ["B1", "A1"]);
  });
  test("the last scan line never says it saw 0 of the listed tokens", () => {
    const at = "2026-10-13T11:45:00.000Z";
    const none = lastScanSentence(6, { at, hits: 0, errors: [] });
    assert.doesNotMatch(none, /saw 0|0 of them/);
    assert.match(none, /11:45 UTC/);
    const some = lastScanSentence(6, { at, hits: 4, errors: ["search X: HTTP 429"] });
    assert.match(some, /found 4 of the listed tokens/); assert.match(some, /1 search error/);
    assert.equal(lastScanSentence(0, null), "No scan has run on this site yet.");
    for (const l of [none, some, lastScanSentence(1, { at, hits: 1, errors: [] }), lastScanSentence(0, { at, hits: 0, errors: [] })]) plain(l, "scan line");
  });
  test("GET /clones leaves out the older token", async () => {
    const w = await makeWorld();
    const store = cloneStore(w.registry.db);
    store.observe(DDP); store.observe({ ...COPY, at: NOW });
    const j = await (await callRoute(`${API}/clones`)).json() as { clones: { mint: string }[] };
    assert.ok(!j.clones.some((c) => c.mint === DDP.mint));
    assert.ok(j.clones.some((c) => c.mint === COPY.mint));
  });
});

// ---- M13: coin pages --------------------------------------------------------------------------------------------------------------

const tok = (ticker: string) => ({ ticker, name: `${ticker} coin`, mint: MINT, status: "live" }) as never;
const reader = (known: Record<string, CoinLookup>) => (key: string): CoinLookup => known[key.toUpperCase()] ?? { kind: "none" };

describe("M13: an unknown coin page is a real 404", () => {
  const read = reader({ BRONCO: { kind: "one", token: tok("BRONCO") }, TWIN: { kind: "many", ticker: "TWIN", tokens: [tok("TWIN"), tok("TWIN")] } });
  test("known tickers and shared tickers show; an unknown ticker or mint does not", () => {
    assert.equal(coinPageFound("BRONCO", read), true);
    assert.equal(coinPageFound("bronco", read), true);
    assert.equal(coinPageFound("TWIN", read), true);
    assert.equal(coinPageFound("NOSUCHCOIN", read), false);
    assert.equal(coinPageFound(MINT, read), false);
    assert.equal(coinPageFound("", read), false);
    assert.equal(coinPageFound("%20", read), false);
  });
  test("$DEFICIT's pre-launch page and a disclosed rehearsal coin keep their pages", () => {
    assert.equal(coinPageFound("DEFICIT", read), true);
    assert.equal(coinPageFound("deficit", read), true);
    assert.equal(coinPageFound("REHEARSAL", read, { tickers: ["Rehearsal"], mints: [] }), true);
    assert.equal(coinPageFound("RehMint1111111111111111111111111111111111111", read, { tickers: [], mints: ["RehMint1111111111111111111111111111111111111"] }), true);
  });
  test("a registry or a rehearsal list that cannot be read never turns into a 404", () => {
    assert.equal(coinPageFound("NOSUCHCOIN", () => { throw new Error("database is locked"); }), true);
    assert.equal(coinPageFound("NOSUCHCOIN", read, null), true);
  });
  test("each coin page has its own title", () => {
    assert.equal(coinPageTitle("bronco", { kind: "one", token: tok("BRONCO") }), "BRONCO coin ($BRONCO) on Burnticker");
    assert.equal(coinPageTitle("deficit", { kind: "none" }), "$DEFICIT on Burnticker");
    assert.equal(coinPageTitle("twin", { kind: "many", ticker: "TWIN", tokens: [] }), "$TWIN on Burnticker");
  });
  test("the layout calls notFound() on that decision, outside any try", () => {
    const src = fs.readFileSync(new URL("../src/app/burnticker/t/[ticker]/layout.tsx", import.meta.url), "utf8");
    assert.match(src, /import \{ notFound(, redirect)? \}/); assert.ok(src.includes("next/navigation"), "the layout imports notFound from the navigation module");
    assert.match(src, /const found = coinPageFound\(/);
    assert.match(src, /if \(!found\) notFound\(\);/);
    assert.doesNotMatch(src.slice(src.indexOf("export default")), /try \{[^}]*notFound/);
  });
});

// ---- M5: free-text search ---------------------------------------------------------------------------------------------------------

describe("M5: search finds the record close and keeps national debt on topic", () => {
  const deps = () => ({ venues: { kalshi: false, polymarket: false, feeds: true }, feeds: catalogueSources(NOW).sources as never, espn: null, polyGet: null, refuse: () => [], kalshiSearch: null, derbyHref: null, nowMs: NOW });
  test("the intent: a record close or an all-time high of a named coin; a city's record high stays weather", () => {
    assert.deepEqual(recordCloseIntent("bitcoin record close"), { coin: "BTC", label: "Bitcoin" });
    assert.deepEqual(recordCloseIntent("BTC all-time high"), { coin: "BTC", label: "Bitcoin" });
    assert.deepEqual(recordCloseIntent("ETH ATH"), { coin: "ETH", label: "Ethereum" });
    assert.deepEqual(recordCloseIntent("record close"), { coin: null, label: null });
    assert.equal(recordCloseIntent("Denver record high"), null);
    assert.equal(recordCloseIntent("national debt"), null);
  });
  for (const q of ["bitcoin record close", "BTC all-time high"]) {
    test(`"${q}" leads with the record-close card, which opens Coin comparison with Bitcoin filled in`, async () => {
      const r = await universalSearch(q, deps());
      assert.equal(r.empty, false);
      const c = r.cards[0];
      assert.match(c.id, /^tile:record-close/);
      assert.equal(c.venue, "tile");
      assert.equal(c.href, "/burnticker/launch?template=coin-vs-coin&kind=record-close&a=BTC");
      for (const t of [c.title, c.subtitle, c.settlement, c.interpreted ?? ""]) if (t) plain(t, "record card");
    });
  }
  test('"Denver record high" is still a weather query', async () => {
    const r = await universalSearch("Denver record high", deps());
    assert.ok(!r.cards.some((c) => c.id.startsWith("tile:record-close")));
  });
  test('"national debt" lists the debt rules, not executive orders, storms, hurricanes or wildfires', async () => {
    const r = await universalSearch("national debt", deps());
    const ids = r.cards.map((c) => c.id);
    assert.equal(ids[0], "feed:treasury.debt");
    for (const bad of ["fedreg", "nhc.", "nifc."]) assert.ok(!ids.some((i) => i.includes(bad)), `${bad} in ${ids.join(", ")}`);
    const fed = r.cards.find((c) => c.id === "feed:fred.GFDEBTN");
    if (fed) assert.equal(fed.alternative, true, "a weaker debt card is labelled as related");
  });
  test("a plain word search with no keyword match still finds a feed by its title", async () => {
    const r = await universalSearch("debt", deps());
    assert.equal(r.cards[0].id, "feed:treasury.debt");
  });
});

// ---- L8: checker inputs -----------------------------------------------------------------------------------------------------------

describe("L8: the checkers refuse malformed input plainly, before any RPC call", () => {
  test("the receipt check: not-a-signature!! is refused in a sentence and the RPC is never called", async () => {
    let calls = 0;
    const rpc = { call: async () => { calls++; throw new Error("must not be called"); } };
    const r = await checkReceiptTx({ signature: "not-a-signature!!", cluster: "devnet", programId: MINT, rpc: rpc as never, rulesText: null, fetchSource: null });
    assert.equal(calls, 0); assert.equal(r.verified, false); assert.equal(r.inputError?.state, "malformed");
    for (const s of ["", "not-a-signature!!", "abc", "1".repeat(88)]) { const c = classifySignatureInput(s); assert.notEqual(c.state, "valid"); assert.match(c.reason!, /^[A-Z].*\.$/); plain(c.reason!, "signature reason"); }
  });
  test("GET /check/receipts/<garbage>: 400 with a plain sentence", async () => {
    const r = await v1CheckReceipt("not-a-signature!!", { rpc: { call: async () => { throw new Error("must not be called"); } } as never, fetchSource: null });
    assert.equal(r.status, 400);
    const body = r.body as { error: string; code: string };
    assert.equal(body.code, "bad-signature"); assert.match(body.error, /^That is not a Solana transaction signature\./); plain(body.error, "api refusal");
  });
  test("verify-mint: an invalid address says so, without a catalogue line", () => {
    for (const bad of ["hello", "not-a-signature!!", "1".repeat(44), "2".repeat(40)]) {
      assert.equal(isSolanaAddress(bad), false, bad);
      const v = verifyMint({ mint: bad, cluster: "mainnet", programId: MINT, program: "unread", coin: null }, NOW);
      assert.equal(v.verdict, "invalid"); assert.equal(v.headline, "That is not a Solana address");
      assert.doesNotMatch(`${v.headline} ${v.summary} ${v.checks.map((c) => c.detail).join(" ")}`, /not listed|catalogue/i);
      for (const t of [v.headline, v.summary, ...v.checks.map((c) => c.detail)]) plain(t, "verify-mint invalid");
    }
    assert.equal(isSolanaAddress(MINT), true);
  });
});
