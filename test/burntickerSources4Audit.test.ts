// The launch audit's SOURCES items 201–218 (ChatGPT, 2026-10-12; sources-4). FIX items carry a test of the fix; VERIFY items carry a
// test that passes on the code as it is, or one that pins a defect it exposed (named DEFECT, so whoever fixes it flips the assertion).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { feedById, fixtureReadings } from "@/lib/burnticker/catalogue";
import { httpSource, parseBody } from "@/lib/burnticker/sources/attestedHttp";
import { validateRule, type BurnRule } from "@/lib/burnticker/rules";
import { unitStep } from "@/lib/burnticker/units";
import { changePhrase, describeRule, paramSubject, SERIES_NOTES } from "@/lib/burnticker/describe";
import { feedCard, polymarketCard, resolveBlankTitle, sampleReadingLabel, unitExample, OUTCOME_REQUIRED_WHY, type FeedCardInput } from "@/lib/burnticker/browse";
import { paramExampleNote, paramName, sourceSubjectLabel, PARAM_NAMES } from "@/lib/burnticker/paramNames";
import { edgeCase } from "@/lib/burnticker/ruleEdgeCases";
import { openRegistry, RevisedReadingError } from "@/lib/burnticker/registry";
import { preflightSelector } from "@/lib/burnticker/coverage/preflight";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import type { PolyEventHit } from "@/lib/burnticker/oracle/polymarket";
import type { FetchLike } from "@/lib/burnticker/oracle/types";

const ROOT = path.join(import.meta.dirname, "..");
const cfgLint = loadCopyLintConfig();
const lint = (t: string) => { const r = lintCopy(t, cfgLint); assert.ok(r.ok, `${r.hits.map((h) => `${h.phrase} (${h.rule})`).join(", ")}\n${t}`); };
const rule = (series: string, unit: number, baseline: "previousSettlement" | number, direction: "up" | "down" | "abs", extra: Partial<BurnRule> = {}): BurnRule => validateRule({ schema: "burnticker.rules/v1", oracle: "catalogue", series, market: null, filter: {}, kind: "scalar", binary: null, scalar: { unit, perUnit: { fractionOfPool: 0.02 }, baseline, direction }, pair: null, onVoid: "skip", floorUsd: "1", reserveSol: "0.02", vault: null, ...extra });
const text = (series: string) => { const f = feedById(series)!; return describeRule(rule(series, f.unit!.size, f.baseline!, f.direction!), { ticker: "T", feed: { title: f.title, sourceName: f.sourceName, unitLabel: f.unit!.label } }); };
const NOW = Date.parse("2026-10-13T00:12:00Z");

describe("201 (FIX): a rule measured against the previous reading says increase, never total", () => {
  test("every launchable previous-reading source says a change over the previous reading; fixed-baseline sources keep their wording", () => {
    for (const id of ["steam.players:730", "github.stars:anza-xyz/agave", "defillama.tvl:raydium", "treasury.debt", "fred.GFDEBTN", "bls.eggs", "bitcoin.blockHeight", "solana.blockHeight.rpc", "openfda.approvals"]) {
      const t = text(id);
      assert.match(t.oneLiner, /^burns for each full (increase|change) of /, `${id}: ${t.oneLiner}`);
      assert.match(t.paragraph, /over the previous (snapshot|reading)|since the previous reading/, id);
      assert.doesNotMatch(t.oneLiner, /for every/, id);
      if (id !== "bls.eggs") lint(t.paragraph);   // the egg feed's own title names a price (an existing title, not this wording)
    }
    assert.equal(text("steam.players:730").oneLiner, "burns for each full increase of 100k players in the concurrent player count of Counter-Strike 2 (Steam app 730) over the previous snapshot");
    assert.equal(text("bls.eggs").oneLiner, "burns for each full change of $0.01 in the U.S. egg price, up or down, since the previous reading");
    assert.equal(changePhrase(rule("usgs.quakes:6", 1, 0, "up"), "1 earthquake", "x", false), null, "a per-day count keeps \"for every\"");
    assert.match(text("wiki.views:Bitcoin").oneLiner, /^burns for every 1M views/);
    // the Browse card's example says the same
    assert.equal(unitExample({ label: "100k players" }, { baseline: "previousSettlement", direction: "up", snapshot: true }), "burns for each full increase of 100k players over the previous snapshot");
    assert.equal(unitExample({ label: "1 executive order" }, { baseline: 0, direction: "up" }), "burns for every executive order");
  });
});

describe("202 (FIX): a saved sample is labelled as one, with its date", () => {
  test("the Browse card says Sample reading and the observation day, never last or latest reading", () => {
    const f: FeedCardInput = { id: "steam.players:730", tier: 4, tierLabel: "x", title: "Steam", sourceName: "Steam", sourceUrl: "https://x", cadence: "continuous; snapshot daily", unit: { label: "100k players" }, launchable: { ok: true, why: null }, flags: [], lastReading: { id: "2026-10-10", value: "1500000" }, fixtureFetchedAt: "2026-10-10T02:50:00Z", baseline: "previousSettlement", direction: "up", param: "730" };
    const c = feedCard(f);
    assert.equal(c.next!.label, "Sample from the catalogue: reading 2026-10-10, 1,500,000, saved 2026-10-10");
    assert.doesNotMatch(c.next!.label, /latest|last reading/i);
    assert.equal(sampleReadingLabel({ id: "2026-10", value: null }, null), "Sample from the catalogue: reading 2026-10");
  });
});

describe("203 (VERIFY, passes): a rise under one unit triggers neither side", () => {
  test("up, down and the fade side all burn nothing for a sub-unit rise; the copy says so", () => {
    const ev = { id: "d2", at: "2026-10-02", result: null, value: "100.5", title: null, sourceUrl: "https://x" };
    const prev = { value: "100", carryOut: "0" };
    for (const r of [rule("treasury.debt", 1, "previousSettlement", "up"), rule("treasury.debt", 1, "previousSettlement", "down"), rule("treasury.debt", 1, "previousSettlement", "up", { inverse: true } as Partial<BurnRule>)]) assert.equal(unitStep(r, ev, prev).units, 0);
    assert.match(edgeCase(203)!, /burns nothing on the rising side/); lint(edgeCase(203)!);
  });
});

describe("204, 207, 209, 210, 211 (FIX): what a reading is, in the coin's words", () => {
  test("Steam a snapshot not a peak; Wikipedia all platforms and agents; TVL a dollar value; blocks exact, a day approximate; blocks not slots", () => {
    assert.match(text("steam.players:730").paragraph, /a snapshot of the concurrent player count at the moment the keeper reads it, not the day's peak/);
    assert.match(text("wiki.views:Bitcoin").paragraph, /every platform and every kind of visitor, automated ones included/);
    assert.match(text("defillama.tvl:raydium").paragraph, /dollar value of the deposits, so it also moves when the deposits' value moves/);
    assert.match(text("bitcoin.blockHeight").paragraph, /The block count is exact; 144 blocks take about a day, not exactly a day\./);
    assert.match(text("solana.blockHeight.rpc").paragraph, /counts blocks, not slots/);
    for (const s of Object.values(SERIES_NOTES)) lint(s);
  });
});

describe("205, 206, 214 (FIX): parameters keep a name read from the publisher, and the example says it is one", () => {
  test("names only from the publisher; an unread id stays an id; the subject label; the example note", () => {
    assert.equal(paramName("steam.players:730"), "Counter-Strike 2"); assert.equal(paramName("steam.players:570"), null, "never guessed");
    for (const n of Object.values(PARAM_NAMES)) { assert.match(n.readFrom, /^https:\/\//); assert.match(n.readAt, /^2026-10-1\d$/); }
    const edgar = JSON.parse(fs.readFileSync(path.join(ROOT, "config/burnticker/fixtures/http/edgar.json"), "utf8")) as { body: { hits: { hits: { _source: { display_names: string[] } }[] } } };
    assert.ok(edgar.body.hits.hits[0]._source.display_names[0].startsWith(`${PARAM_NAMES["edgar.8k:0000320193"].name} `), "the name is the SEC's own");
    assert.equal(sourceSubjectLabel("steam.players:730"), "Steam · Counter-Strike 2");
    assert.equal(sourceSubjectLabel("steam.players:570"), "Steam · app 570");
    assert.equal(sourceSubjectLabel("edgar.8k:0000320193"), "SEC filings · Apple Inc.");
    assert.equal(sourceSubjectLabel("treasury.debt"), null);
    assert.match(paramSubject("edgar.8k:0000320193")!.what, /Apple Inc\. \(SEC filer CIK 0000320193\)/);
    const note = paramExampleNote("steam.players:730", "730")!;
    assert.match(note, /^Shown with one example, Counter-Strike 2\. Its sample is the only one read for this card\./); lint(note);
    assert.equal(paramExampleNote("treasury.debt", null), null);
  });
});

describe("208 (VERIFY, DEFECT): Ethereum's trailing-24-hour burn is not a UTC day", () => {
  test("DEFECT: the reading is dated by the poll's UTC day but sums the 24 hours before the poll; the source cannot settle a coin today", async () => {
    const f = feedById("ethereum.baseFeeBurn")!;
    const fx = JSON.parse(fs.readFileSync(path.join(ROOT, "config/burnticker/fixtures/http/eth_burn.json"), "utf8")) as { body: { d1: { sum: { eth: number }; timestamp: string } } };
    const r = parseBody(f.config, fx.body, Date.parse(fx.body.d1.timestamp)).readings;
    assert.deepEqual(r.map((x) => [x.id, Number(x.value).toFixed(6)]), [["2026-10-10", fx.body.d1.sum.eth.toFixed(6)]], "dated 2026-10-10, but the sum runs from 2026-10-09 02:45 to 2026-10-10 02:45 UTC");
    const pf = await preflightSelector(rule("ethereum.baseFeeBurn", 100, 0, "up"), { now: NOW });
    assert.equal(pf.refusal?.code, "not-primary", "an aggregator, refused at the gate");
  });
});

describe("213 (FIX): an event title with a blank", () => {
  const ev = (n: number): PolyEventHit => ({ slug: "btc-above", title: "Bitcoin above ___ on October 13?", url: "https://polymarket.com/event/btc-above", endDate: "2026-10-13T16:00:00Z", closed: false, tags: [], markets: Array.from({ length: n }, (_, i) => ({ conditionId: `0x${String(i).padStart(64, "0")}`, question: `Bitcoin above ${80 + i * 2},000 on October 13?`, yes: "Yes", no: "No", endDate: null, closed: false, sportsMarketType: null, selector: { oracle: "polymarket", series: null, market: `0x${String(i).padStart(64, "0")}` }, outcome: `${80 + i * 2},000` })) as unknown as PolyEventHit["markets"], marketCount: n, selector: { oracle: "polymarket", series: "event:btc-above", market: null }, refused: [] });
  test("one market: its own question; several: the blank stays a choice and the whole event is not one pick", () => {
    assert.deepEqual(resolveBlankTitle(ev(1)), { title: "Bitcoin above 80,000 on October 13?", outcomeRequired: false });
    const c = polymarketCard(ev(3));
    assert.equal(c.title, "Bitcoin above … on October 13? (choose one of 3 markets)");
    assert.deepEqual(c.launchable, { ok: false, why: OUTCOME_REQUIRED_WHY });
    assert.equal(c.outcomes!.length, 3); assert.doesNotMatch(c.title, /___/);
    assert.equal(polymarketCard({ ...ev(3), title: "Bitcoin in October" }).launchable.ok, true, "a title with no blank is unchanged");
  });
});

describe("215 (VERIFY, passes): a bad parameter is refused, never replaced by the card's example", () => {
  test("an invalid or missing parameter resolves to no feed (the launch answers \"unknown feed\")", () => {
    for (const id of ["steam.players:abc", "steam.players", "wiki.views:Bit coin", "defillama.tvl:RAYDIUM", "edgar.8k:12345678901", "treasury.debt:1"]) assert.equal(feedById(id), null, id);
    assert.equal(feedById("steam.players:570")!.param, "570");
  });
});

describe("216 (VERIFY, DEFECT): a snapshot read twice in one UTC day", () => {
  test("DEFECT: the second read of the day with a new figure is a revision, so the source is held (the first read stands)", async () => {
    const counts = [1_500_000, 1_620_000];
    let n = 0;
    const fetchImpl: FetchLike = async () => ({ ok: true, status: 200, json: async () => ({ response: { player_count: counts[n++], result: 1 } }) });
    const reg = openRegistry(":memory:");
    const read = async (at: string) => { const s = httpSource(feedById("steam.players:730")!.config, { fetchImpl, now: () => Date.parse(at) }); return (await s.settledSince(rule("steam.players:730", 100000, "previousSettlement", "up"), null)).events; };
    const first = await read("2026-10-12T06:00:00Z");
    assert.equal(reg.putReadings("catalogue", "catalogue:steam.players:730", first, { settlementSourceUrl: null, attestedBy: [] }), 1);
    const second = await read("2026-10-12T12:00:00Z");
    assert.equal(second[0].id, first[0].id, "the same UTC day");
    assert.throws(() => reg.putReadings("catalogue", "catalogue:steam.players:730", second, { settlementSourceUrl: null, attestedBy: [] }), RevisedReadingError);
    assert.match(edgeCase(216)!, /the first read of the day is the one recorded/); lint(edgeCase(216)!);
  });
});

describe("217 (VERIFY): finality of block-height reads", () => {
  test("Solana over HTTP asks getBlockHeight with no commitment, which Solana answers at finalized; Bitcoin reads the tip, and the coin text says so", () => {
    const c = feedById("solana.blockHeight.rpc")!.config;
    assert.equal(JSON.parse(c.request.body!).params, undefined, "no commitment given: the RPC default, finalized");
    assert.match(SERIES_NOTES["solana.blockHeight.rpc"], /read at the finalized level/);
    assert.match(SERIES_NOTES["bitcoin.blockHeight"], /the chain's tip when it is read/);
    assert.equal(feedById("bitcoin.blockHeight")!.config.request.url, "https://mempool.space/api/blocks/tip/height");
  });
});

describe("218 (FIX): a source that stops for good", () => {
  test("the sentence says what happens today, plainly", () => {
    assert.match(edgeCase(218)!, /reads nothing more from it and burns nothing for it/); lint(edgeCase(218)!);
    void fixtureReadings;
  });
});
