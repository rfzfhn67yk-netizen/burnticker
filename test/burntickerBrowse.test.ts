// BROWSE LIKE KALSHI (2026-10-10, the owner: "make it navigate like Kalshi navigates"): Kalshi's category → tag tree, one category's
// series (most traded first, tag/text filters, the kind guess, the example mapping), the upcoming-event summary with the strike-ladder
// check, the Polymarket tag a category maps to, and GET /api/burnticker/v1/kalshi/categories against its OpenAPI schema. Frozen
// fixtures fetched 2026-10-10 (config/burnticker/fixtures/kalshi/categories/, KXHIGHDEN.events.open.json, polymarket/events.tag.science.json).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { kalshiEnabled } from "@/lib/burnticker/venues";
import { loadCategories } from "@/lib/burnticker/browse";
import { KalshiClient, fixtureFetch, seriesByCategoryUrl, seriesListUrl, tagsByCategoriesUrl, eventsUrl } from "@/lib/burnticker/oracle/kalshi";
import { categoryPage, isLadder, kindHintFor, parseBrowseSeriesList, parseTagsByCategories, POLYMARKET_TAG_FOR, seriesExample, summariseEvents } from "@/lib/burnticker/oracle/browse";
import { parseEventsBody } from "@/lib/burnticker/oracle/events";
import { eventsByTagUrl } from "@/lib/burnticker/oracle/polymarket";
import { buildOpenApi, endpoint } from "@/lib/burnticker/api/spec";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import { BRONCOS, fx, NOW } from "./burntickerHelpers.ts";
import { API, CREATOR, KALSHI_TABLE, POST_HEADERS, callRoute, makeWorld, validateSchema } from "./burntickerApiHelpers.ts";
import { GAMMA_TABLE } from "./burntickerPolyHelpers.ts";

const TAGS = fx("kalshi/categories/tags_by_categories.json");
const CLIMATE = fx("kalshi/categories/series.climate-and-weather.json");
const ECON = fx("kalshi/categories/series.economics.json");
const COMMOD = fx("kalshi/categories/series.commodities.json");
const DEN_EVENTS = fx("kalshi/KXHIGHDEN.events.open.json");
const TABLE: Record<string, unknown> = {
  [tagsByCategoriesUrl()]: TAGS, [seriesByCategoryUrl("Climate and Weather")]: CLIMATE, [seriesByCategoryUrl("Economics")]: ECON, [seriesByCategoryUrl("Commodities")]: COMMOD,
  [eventsUrl("KXHIGHDEN", "open")]: DEN_EVENTS,
};
const client = () => new KalshiClient({ fetchImpl: fixtureFetch(TABLE), now: () => NOW, minIntervalMs: 0 });

describe("Kalshi's category tree", () => {
  test("categories come back in the order the API reports them, each with its tags (null → [])", () => {
    const cats = parseTagsByCategories(TAGS);
    assert.deepEqual(cats.map((c) => c.category), ["Business", "Climate and Weather", "Commodities", "Companies", "Crypto", "Economics", "Elections", "Entertainment", "Financials", "Mentions", "Politics", "Science and Technology", "Social", "Sports"]);
    assert.deepEqual(cats[0].tags, [], "Business has null tags");
    assert.ok(cats.find((c) => c.category === "Climate and Weather")!.tags.includes("Daily temperature"));
    assert.deepEqual(parseTagsByCategories(null), []); assert.deepEqual(parseTagsByCategories({}), []);
  });

  test("client.categories(): series counts per category; a category whose list fails reads null, never a guess", async () => {
    const cats = await client().categories();
    const by = Object.fromEntries(cats.map((c) => [c.category, c.seriesCount]));
    assert.equal(by["Climate and Weather"], 422); assert.equal(by.Economics, 860); assert.equal(by.Commodities, 132);
    assert.equal(by.Sports, null, "no fixture for Sports in this table → null");
    const noCounts = await client().categories({ counts: false });
    assert.ok(noCounts.every((c) => c.seriesCount === null));
  });
});

describe("one category's page", () => {
  const all = parseBrowseSeriesList(CLIMATE);

  test("parse: every series with volume, tags, the kind guess and its example; most traded first", () => {
    assert.equal(all.length, 422);
    const p = categoryPage("Climate and Weather", all, { limit: 5 });
    assert.equal(p.total, 422); assert.equal(p.series.length, 5);
    assert.deepEqual(p.series.slice(0, 3).map((s) => s.ticker), ["KXHIGHLAX", "KXHIGHNY", "KXHIGHCHI"]);
    assert.ok(p.series.every((s, i, a) => i === 0 || a[i - 1].volume >= s.volume));
    const den = all.find((s) => s.ticker === "KXHIGHDEN")!;
    assert.equal(den.kindHint, "scalar"); assert.equal(den.example, "burns per step above the last settled number");
    assert.equal(den.settlementSource?.name.length ? true : false, true);
  });

  test("tag and text filters; tags keep Kalshi's order and carry counts", () => {
    const tagged = categoryPage("Climate and Weather", all, { tag: "Daily temperature", limit: 100, tagOrder: parseTagsByCategories(TAGS)[1].tags });
    assert.ok(tagged.total > 20 && tagged.series.every((s) => s.tags.includes("Daily temperature")));
    assert.equal(tagged.tags[0].tag, "Daily temperature", "Kalshi's first tag first");
    assert.ok(tagged.tags.every((t) => t.count > 0));
    const q = categoryPage("Climate and Weather", all, { q: "denver" });
    assert.ok(q.series.some((s) => s.ticker === "KXHIGHDEN"));
    assert.ok(q.series.every((s) => /denver/i.test(`${s.ticker} ${s.title} ${s.tags.join(" ")}`)));
    const page2 = categoryPage("Climate and Weather", all, { limit: 10, offset: 10 });
    assert.equal(page2.series[0].ticker, categoryPage("Climate and Weather", all, { limit: 20 }).series[10].ticker);
  });

  test("the kind guess: numbers read as scalar, questions as yes/no; the examples (our words, never the venue's title) pass the copy lint", () => {
    assert.equal(kindHintFor("Highest temperature in NYC"), "scalar");
    assert.equal(kindHintFor("Inflation"), "scalar");
    assert.equal(kindHintFor("Fed meeting"), "binary");
    assert.equal(kindHintFor("Will it snow in Denver?"), "binary");
    const cfg = loadCopyLintConfig();
    for (const s of [...all.slice(0, 40), ...parseBrowseSeriesList(ECON).slice(0, 40)]) {
      const r = lintCopy(s.example, cfg);
      assert.ok(r.ok, `${s.ticker}: "${s.example}" → ${JSON.stringify(r.hits)}`);
    }
    assert.equal(seriesExample("binary"), "burns when one of its markets settles YES");
  });

  test("events: a strike ladder makes a series scalar; the next event is the soonest to close", () => {
    const evs = parseEventsBody(DEN_EVENTS).events;
    assert.equal(evs.length, 2);
    assert.ok(evs[0].markets.every((m) => typeof m.strikeType === "string"), "strike types parsed");
    assert.equal(isLadder(evs[0].markets), true);
    assert.equal(isLadder([{ strikeType: null }, { strikeType: null }]), false);
    const sum = summariseEvents(evs, NOW);
    assert.equal(sum.open, 2); assert.equal(sum.ladder, true); assert.equal(sum.next?.eventTicker, "KXHIGHDEN-26OCT10");
  });

  test("client.seriesByCategory(): withEvents reads the upcoming events of the first n series (cached) and the markets decide the kind", async () => {
    const c = client();
    const p = await c.seriesByCategory("Climate and Weather", { q: "Highest temperature in Denver", withEvents: 1, limit: 3 });
    const den = p.series.find((s) => s.ticker === "KXHIGHDEN")!;
    assert.ok(den.events, "the first series got its event summary");
    assert.equal(den.events!.ladder, true); assert.equal(den.kindHint, "scalar"); assert.equal(den.events!.open, 2);
    const again = c.requests.length;
    await c.seriesByCategory("Climate and Weather", { q: "Highest temperature in Denver", withEvents: 1, limit: 3 });
    assert.equal(c.requests.length, again, "series list and events are cached");
  });

  test("Polymarket: the categories that map to a top-level tag", () => {
    assert.equal(POLYMARKET_TAG_FOR.Politics?.slug, "politics"); assert.equal(POLYMARKET_TAG_FOR.Elections?.slug, "politics");
    assert.equal(POLYMARKET_TAG_FOR.Entertainment?.slug, "pop-culture"); assert.equal(POLYMARKET_TAG_FOR.Economics?.slug, "business");
    assert.equal(POLYMARKET_TAG_FOR["Science and Technology"]?.slug, "science"); assert.equal(POLYMARKET_TAG_FOR.Crypto?.slug, "crypto");
    for (const c of parseTagsByCategories(TAGS)) assert.ok(c.category in POLYMARKET_TAG_FOR, `${c.category} has a mapping entry (a tag or null)`);
  });
});

describe("GET /api/burnticker/v1/kalshi/categories", () => {
  const DOC = buildOpenApi() as unknown as Record<string, unknown>;
  const schemaFor = (status: number) => ((DOC.paths as Record<string, Record<string, { responses: Record<string, { content: { "application/json": { schema: Record<string, unknown> } } }> }>>)[endpoint("browseKalshiCategories").path].get.responses[String(status)].content["application/json"].schema);
  const get = async (q: string, expect = 200) => {
    const r = await callRoute(`${API}/kalshi/categories${q}`); const body = await r.json() as Record<string, unknown>;
    assert.equal(r.status, expect, `${q}: ${JSON.stringify(body).slice(0, 200)}`);
    assert.deepEqual(validateSchema(schemaFor(expect), body, DOC), [], `${q} matches its schema`);
    return body;
  };

  test("no category → the tree with counts and the Polymarket tag; a category → its series with refusals, events and the Polymarket group", async () => {
    // fixtureFetch matches by URL prefix, first key wins: the world's plain /series?category=Climate… key would shadow the
    // include_volume URL, so it is moved behind this table's keys.
    const plain = seriesListUrl("Climate and Weather"), saved = KALSHI_TABLE[plain];
    delete KALSHI_TABLE[plain];
    Object.assign(KALSHI_TABLE, TABLE);
    KALSHI_TABLE[plain] = saved;
    Object.assign(GAMMA_TABLE, { [eventsByTagUrl("science", 8)]: fx("polymarket/events.tag.science.json") });
    await makeWorld();
    const tree = await get("") as { categories: { category: string; seriesCount: number | null; polymarket: { slug: string } | null }[] };
    assert.equal(tree.categories.length, 14);
    assert.equal(tree.categories.find((c) => c.category === "Climate and Weather")!.seriesCount, 422);
    assert.equal(tree.categories.find((c) => c.category === "Climate and Weather")!.polymarket?.slug, "science");

    const page = await get(`?category=${encodeURIComponent("Climate and Weather")}&limit=6&events=0`) as { total: number; series: { ticker: string; refused: string[]; events: unknown }[]; tags: { tag: string }[]; polymarket: { tag: { slug: string }; events: { title: string }[]; error: string | null } };
    assert.equal(page.total, 422); assert.equal(page.series.length, 6); assert.equal(page.series[0].ticker, "KXHIGHLAX");
    assert.ok(page.series.every((s) => s.events === null), "events=0 reads no events");
    assert.equal(page.polymarket.tag.slug, "science"); assert.equal(page.polymarket.error, null); assert.ok(page.polymarket.events.length > 0);

    const hurricanes = await get(`?category=${encodeURIComponent("Climate and Weather")}&q=hurricane&polymarket=0`) as { series: { title: string; refused: string[] }[]; polymarket: unknown };
    assert.ok(hurricanes.series.some((s) => s.refused.length > 0), "disaster series carry the refuse-list verdict");
    assert.equal(hurricanes.polymarket, null);

    const den = await get(`?category=${encodeURIComponent("Climate and Weather")}&q=${encodeURIComponent("Highest temperature in Denver")}&events=1&polymarket=0`) as { series: { ticker: string; kindHint: string; events: { ladder: boolean } | null }[] };
    assert.equal(den.series[0].ticker, "KXHIGHDEN"); assert.equal(den.series[0].kindHint, "scalar"); assert.equal(den.series[0].events?.ladder, true);

    await get(`?category=Nonsense`, 404);
  });
});

describe("GET /api/burnticker/v1/browse — venue-agnostic, Kalshi behind BURNTICKER_KALSHI_ENABLED", () => {
  const DOC = buildOpenApi() as unknown as Record<string, unknown>;
  const schemaOf = (op: string, status: number) => { const ep = endpoint(op); return (DOC.paths as Record<string, Record<string, { responses: Record<string, { content: { "application/json": { schema: Record<string, unknown> } } }> }>>)[ep.path][ep.method.toLowerCase()].responses[String(status)].content["application/json"].schema; };
  const call = async (path: string, op: string, expect = 200, init: { method?: string; body?: unknown } = {}) => {
    const r = await callRoute(`${API}${path}`, { method: init.method, headers: init.method === "POST" ? POST_HEADERS : undefined, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
    const body = await r.json() as Record<string, unknown>;
    assert.equal(r.status, expect, `${path}: ${JSON.stringify(body).slice(0, 200)}`);
    assert.deepEqual(validateSchema(schemaOf(op, expect), body, DOC), [], `${path} matches its schema`);
    return body;
  };
  const setup = async () => {
    const plain = seriesListUrl("Climate and Weather"), saved = KALSHI_TABLE[plain];
    delete KALSHI_TABLE[plain]; Object.assign(KALSHI_TABLE, TABLE); KALSHI_TABLE[plain] = saved;
    return makeWorld();
  };

  test("the flag: default on; 0 / false / off / no turn it off", () => {
    assert.equal(kalshiEnabled({}), true); assert.equal(kalshiEnabled({ BURNTICKER_KALSHI_ENABLED: "1" }), true);
    for (const v of ["0", "false", "OFF", " no "]) assert.equal(kalshiEnabled({ BURNTICKER_KALSHI_ENABLED: v }), false, v);
  });

  test("the taxonomy file: eleven categories, every feed id it names exists in sources.json or the on-chain facts", () => {
    const cats = loadCategories();
    assert.deepEqual(cats.map((c) => c.id), ["sports", "politics", "economics", "financials", "weather", "science", "culture", "crypto", "companies", "health", "world"]);
    const ids = new Set([...(JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "../config/burnticker/sources.json"), "utf8")) as { sources: { id: string }[] }).sources.map((s) => s.id), "solana.blockHeight", "solana.slot"]);
    for (const c of cats) for (const f of c.feeds) assert.ok(ids.has(f), `${c.id}: feed ${f} exists`);
    assert.ok(!cats.some((c) => c.feeds.includes("usgs.quakes6")), "the disaster-adjacent feed stays unmapped");
    const cfg = loadCopyLintConfig();
    for (const c of cats) assert.ok(lintCopy(`${c.label}: ${c.blurb}`, cfg).ok, `${c.id} blurb passes the copy lint`);
  });

  test("categories with what each venue contributes; a category's cards put first-party feeds first, then Polymarket, then Kalshi", async () => {
    await setup();
    const list = await call("/browse", "browse") as { categories: { id: string; feeds: number; kalshi: string[]; polymarket: string[] }[]; venues: { kalshi: boolean } };
    assert.equal(list.categories.length, 11); assert.equal(list.venues.kalshi, true);
    const econ = list.categories.find((c) => c.id === "economics")!;
    assert.ok(econ.feeds >= 5, "Treasury, FRED and BLS feeds are first-class"); assert.deepEqual(econ.kalshi, ["Economics"]);
    const page = await call("/browse?category=economics", "browse") as { cards: { venue: string; id: string; example: string; pick: { oracle: string; series: string | null } }[]; errors: string[]; counts: { feeds: number; kalshi: number } };
    const firstNonFeed = page.cards.findIndex((c) => c.venue !== "feed");
    assert.ok(page.counts.feeds > 0 && firstNonFeed === page.counts.feeds, "feeds come first");
    assert.equal(page.cards[0].id, "feed:treasury.debt", "in the taxonomy's order");
    assert.equal(page.cards[0].pick.oracle, "catalogue"); assert.equal(page.cards[0].example, "burns per $1B added");
    assert.ok(page.counts.kalshi > 0 && page.cards.some((c) => c.id === "kalshi:KXFEDDECISION"));
    assert.ok(page.errors.some((e) => /^Polymarket economy/.test(e)), "a venue without data is named, the page still renders");
    const cfg = loadCopyLintConfig();
    for (const c of page.cards) assert.ok(lintCopy(c.example, cfg).ok, `${c.id}: "${c.example}"`);
    await call("/browse?category=nope", "browse", 404);
  });

  test("Kalshi off: Browse reads the same without it; every Kalshi route, Kalshi back-test and Kalshi launch answers 503 venue unavailable", async () => {
    const w = await setup();
    w.p.kalshiEnabled = false;
    const list = await call("/browse", "browse") as { categories: { kalshi: string[] }[]; venues: { kalshi: boolean } };
    assert.equal(list.venues.kalshi, false); assert.ok(list.categories.every((c) => c.kalshi.length === 0));
    const page = await call("/browse?category=economics", "browse") as { cards: { venue: string }[]; note: string };
    assert.ok(page.cards.length > 0 && page.cards.every((c) => c.venue !== "kalshi")); assert.match(page.note, /not enabled/);
    await call("/kalshi/search?q=eagles", "searchKalshi", 503);
    await call("/kalshi/events", "searchKalshiEvents", 503);
    await call("/kalshi/teams?series=KXNFLGAME", "listKalshiTeams", 503);
    await call("/kalshi/categories", "browseKalshiCategories", 503);
    await call("/kalshi/backtest", "backtestKalshi", 503, { method: "POST", body: { rule: BRONCOS } });
    const launch = await call("/launch/bundle", "buildLaunchBundle", 503, { method: "POST", body: { creator: CREATOR, ticker: "OFFK", name: "Off K", description: "", imageUrl: null, links: [], rule: BRONCOS, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true }, register: false, mint: "MintTest11111111111111111111111111111111111" } }) as { error: string };
    assert.match(launch.error, /venue unavailable/);
    w.p.kalshiEnabled = true;
  });
});
