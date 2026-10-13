// sources-6 (QA pass 9, 2026-10-13): the catalogue and picker items #25, #30, #31, #32, #33, #34 and audit 10 #22 ("cross-read jup").
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import { categoryCards, eventFitsCategory, formatReading, sampleReadingLabel } from "@/lib/burnticker/browse";
import { loadRefuseList, refusalMessage, refusalsFor } from "@/lib/burnticker/oracle/refuse";
import { STATIONS, stationOptionLabel } from "@/lib/burnticker/sources/nws";
import { crossReadSentence, withHitLabel } from "@/lib/burnticker/derby/search";

const cfg = loadCopyLintConfig();
const plain = (t: string) => { const r = lintCopy(t, cfg); assert.ok(r.ok, `${r.hits.map((h) => `${h.phrase} (${h.rule})`).join(", ")}: ${t}`); };

describe("QA pass 9 #30: Polymarket events are filed by their own words", () => {
  test("the Fed under Economics, the lab leak under Companies, Hormuz under World", () => {
    assert.equal(eventFitsCategory("companies", "Fed decision in December?"), false);
    assert.equal(eventFitsCategory("economics", "Fed decision in December?"), true);
    assert.equal(eventFitsCategory("health", "Anthropic lab leak by 2027?"), false);
    assert.equal(eventFitsCategory("companies", "Anthropic lab leak by 2027?"), true);
    assert.equal(eventFitsCategory("economics", "Iran closes the Strait of Hormuz by December 31?"), false);
    assert.equal(eventFitsCategory("world", "Iran closes the Strait of Hormuz by December 31?"), true);
    assert.equal(eventFitsCategory("economics", "US tariffs on China above 50%?"), true, "a title naming two homes stays in either");
    assert.equal(eventFitsCategory("health", "Measles cases above 2,000 in 2026?"), true);
    assert.equal(eventFitsCategory("culture", "Fed decision in December?"), true, "categories without home words keep their own title patterns");
    const c = { id: "companies", label: "Companies", blurb: "", feeds: [], polymarket: ["business"], kalshi: [], native: [] };
    const ev = (slug: string, title: string) => ({ slug, title, url: `https://polymarket.com/event/${slug}`, endDate: null, markets: [], marketCount: 2, refused: [] });
    const cards = categoryCards(c, { feeds: [], polymarket: [ev("fed", "Fed decision in December?"), ev("ipo", "OpenAI IPO by 2027?")] as never, kalshi: [] });
    assert.deepEqual(cards.map((x) => x.id), ["polymarket:ipo"]);
  });
});

describe("QA pass 9 #31: wars, invasions and deaths are refused at admission in one plain sentence, behind a flag that is on by default", () => {
  test("the conflict pattern refuses; the flag turns it off; ordinary uses of the words pass", () => {
    const list = loadRefuseList();
    const SENT = "Burnticker does not launch coins on wars, invasions or deaths.";
    for (const t of ["Will the US go to war with Venezuela in 2026?", "Russia x Ukraine ceasefire by December?", "Will China invade Taiwan in 2026?", "US military action against Iran by October 31?", "Will Israel annex the West Bank?"]) {
      const r = refusalsFor(list, { titles: [t] }, {});
      assert.ok(r.length, t);
      assert.equal(refusalMessage(r), SENT, t);
    }
    plain(SENT);
    assert.equal(refusalMessage(refusalsFor(list, { titles: ["How many people will die in the hurricane?"] }, {})), SENT, "a death market says the same sentence");
    for (const t of ["Star Wars box office above $500M?", "Will the trade war end in 2026?", "Golden State Warriors win the NBA title?", "Price war between Uber and Lyft?", "Fed decision in December?"]) assert.deepEqual(refusalsFor(list, { titles: [t] }, {}), [], t);
    assert.deepEqual(refusalsFor(list, { titles: ["Russia x Ukraine ceasefire by December?"] }, { BURNTICKER_REFUSE_CONFLICT: "off" }), [], "the owner can turn the conflict pattern off");
    assert.ok(refusalsFor(list, { titles: ["Will China invade Taiwan in 2026?"] }, { BURNTICKER_REFUSE_CONFLICT: "off" }).length, "the older violence pattern still refuses an invasion");
    assert.equal(refusalMessage([{ reason: "markets about terror" }]), "This launch is refused: markets about terror");
  });
});

describe("QA pass 9 #33, #34, #25, #32: catalogue and picker details", () => {
  test("#33 a one-time source already resolved is not listed in Browse", () => {
    const c = { id: "science", label: "Science", blurb: "", feeds: ["ll2.launch", "noaa.flares"], polymarket: [], kalshi: [], native: [] };
    const f = (id: string, resolved: boolean) => ({ id, tier: 4, tierLabel: "", title: id, sourceName: "x", sourceUrl: "https://x", cadence: "daily", unit: { label: "1 launch" }, launchable: { ok: !resolved, why: resolved ? "already decided" : null }, flags: [], lastReading: null, resolved });
    const cards = categoryCards(c, { feeds: [f("ll2.launch:abc", true), f("noaa.flares", false)], polymarket: [], kalshi: [] });
    assert.deepEqual(cards.map((x) => x.id), ["feed:noaa.flares"]);
  });
  test("#34 a station option says its code once", () => {
    for (const s of STATIONS) { const l = stationOptionLabel(s); assert.equal(l.split(s.code).length - 1, 1, l); }
    assert.equal(stationOptionLabel(STATIONS.find((s) => s.code === "LAX")!), "Los Angeles (International), LAX");
  });
  test("#25 large numbers are formatted: $40.31T, FRED's millions as dollars", () => {
    assert.equal(formatReading("40310000000000", "USD"), "$40.31T");
    assert.equal(formatReading("38500000", "USD millions"), "$38.50T");
    assert.equal(formatReading("1250000000", "USD"), "$1.25B");
    assert.equal(formatReading("4.08", "USD per dozen"), "$4.08 per dozen");
    assert.equal(formatReading("4.3", "percent"), "4.3%");
    assert.equal(formatReading("1234567", "views"), "1,234,567 views");
    assert.equal(formatReading("n/a", "USD"), "n/a");
    assert.equal(sampleReadingLabel({ id: "2026-10-10", value: "40310000000000" }, "2026-10-10", "USD"), "Sample reading 2026-10-10: $40.31T, observed 2026-10-10");
  });
  test("#32 a coin search result carries its short mint, liquidity and verified mark; audit 10 #22 the second source is a sentence", () => {
    const mint = "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm";
    const h = withHitLabel({ symbol: "WIF", name: "dogwifhat", source: "jupiter", assetType: "Crypto", feed: null, mint, liquidityUsd: 12_340_000, verified: true, underlying: { symbol: "WIF", pyth: null, mint, pool: "pool", cross: `jup:${mint}` }, why: null });
    assert.equal(h.label, "WIF · EKpQ…zcjm · $12.3M liquidity · verified");
    assert.equal(h.crossLine, "Jupiter's quote for WIF (mint EKpQ…zcjm) is read as the second source, from a different operator.");
    assert.equal(crossReadSentence("redstone:SHIB", "SHIB"), "RedStone's signed value for SHIB is read as the second source, from a different operator.");
    for (const t of [h.crossLine!, crossReadSentence("dexscreener:ethereum:0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce", "SHIB")!]) plain(t);
  });
});
