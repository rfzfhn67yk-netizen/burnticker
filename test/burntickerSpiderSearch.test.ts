// THE OWNER'S $SPIDER CASE (2026-10-10): "a coin $SPIDER that burns once if Spider-Man wins Best Picture". He typed "spider" and ended up
// on the Advanced Any-market selector with a regex field. The old search read only the FIRST market of each Polymarket event, and
// Gamma's own search returns nothing for "spider-man best picture". Fixture: Gamma public-search frozen 2026-10-10 (slimmed; no prices).
// What the fixture shows, and these tests pin: "Oscars 2027: Best Picture Winner" lists 23 named films and Spider-Man: Brand New Day is
// NOT one of them; the nearest Spider-Man Oscars market is Best Visual Effects.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { universalSearch, dedupeTickers, raceCards, type Suggestion } from "@/lib/burnticker/search";
import { raceFromEvent } from "@/lib/burnticker/elections";
import { parseGammaEvent } from "@/lib/burnticker/oracle/polymarket";
import { outcomeTicker, plainQuestion, searchQueries, splitQuery } from "@/lib/burnticker/polySearch";
import { nameMatch } from "@/lib/burnticker/textMatch";
import { catalogueSources } from "@/lib/burnticker/api/handlers";
import { MARKET_DATA_KEY } from "@/lib/burnticker/venues";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import type { FeedLike } from "@/lib/burnticker/search";
import { fx } from "./burntickerHelpers.ts";
import { ESPN_NOW } from "./burntickerFirstPartyHelpers.ts";

const FX = fx("polymarket/search.oscars.json") as { pages: { url: string; body: unknown }[] };
const TABLE = new Map(FX.pages.map((p) => [p.url, p.body]));
const asked: string[] = [];
// Gamma searches come from the frozen table; the elections index answers with the live GA-05 race (its candidate John OSCAR Salvesen
// is what "oscars" matched on the live host, 2026-10-10) on its first page and nothing after
const GA05 = (fx("polymarket/race.ga-05.json") as { event: unknown }).event;
const polyGet = async (u: string) => { asked.push(u); if (TABLE.has(u)) return TABLE.get(u); if (u.includes("public-search")) throw new Error(`no fixture for ${u}`); return /tag_slug=midterms/.test(u) && /offset=0\b/.test(u) ? [GA05] : []; };
const deps = { venues: { kalshi: false, polymarket: true, feeds: true }, feeds: catalogueSources(ESPN_NOW).sources as unknown as FeedLike[], espn: null, polyGet, refuse: () => [], kalshiSearch: null, derbyHref: null, nowMs: ESPN_NOW };
const search = (q: string) => universalSearch(q, deps);
const BP_WINNER = "polyevent:oscars-2027-best-picture-winner-20260727173620857";
const VFX_TITLE = "Burns 10% once, if Spider-Man: Brand New Day wins Best Visual Effects at the 99th Academy Awards resolves YES";

const noMarketData = (v: unknown, at = "$"): string[] => {
  if (Array.isArray(v)) return v.flatMap((x, i) => noMarketData(x, `${at}[${i}]`));
  if (v && typeof v === "object") return Object.entries(v).flatMap(([k, x]) => [...(MARKET_DATA_KEY.test(k) ? [`${at}.${k}`] : []), ...noMarketData(x, `${at}.${k}`)]);
  return [];
};
// our sentences are linted; the outcome names are the market's own (a film called "Saturn Return" is not a promise of returns)
// (the subtitle carries the event's own title, also theirs)
const ownText = (c: Suggestion): string[] => [c.title, c.note ?? ""];
const allText = (c: Suggestion): string[] => [...ownText(c), c.subtitle, ...(c.picker?.outcomes.map((o) => o.label) ?? [])];

describe("the owner's three Best Picture queries", () => {
  for (const q of ["spider-man best picture", "spiderman wins best picture"]) {
    test(`"${q}": the Best Picture event card first, its picker of named films, a plain note that Spider-Man is not listed, and the nearest Spider-Man Oscars market`, async () => {
      const r = await search(q);
      assert.equal(r.cards[0].id, BP_WINNER, r.cards.map((c) => c.id).join(", "));
      const top = r.cards[0];
      assert.equal(top.title, "Pick a film: Oscars 2027: Best Picture Winner — your coin burns 10% once if it wins");
      assert.equal(top.picker!.outcomes.length, 23, "the 23 named films; placeholders (Film E … Film Z, Other) are never offered");
      assert.ok(!top.picker!.outcomes.some((o) => /^(Film [A-Z]|Other)$/.test(o.label)));
      assert.ok(top.picker!.outcomes.some((o) => o.label === "Dune: Part Three" && o.ticker === "DUNE"));
      assert.ok(!top.picker!.outcomes.some((o) => /spider/i.test(o.label)), "the fixture: Spider-Man: Brand New Day has no Best Picture market");
      assert.match(top.note!, /is not one of this market's films — pick a listed film, or use the nearest/);
      const vfx = r.cards.find((c) => c.title === VFX_TITLE);
      assert.ok(vfx, "the nearest Spider-Man Oscars market is offered");
      assert.equal(vfx!.suggestedTicker, "SPIDER");
      assert.equal(vfx!.pick?.oracle, "polymarket"); assert.ok(vfx!.pick?.market, "one market, resolves once — never the event's every-market selector");
      assert.equal(vfx!.rule?.binary?.onYes && (vfx!.rule.binary.onYes as { fractionOfPool: number }).fractionOfPool, 0.1);
    });
  }

  test(`"spider man oscar": read as an event phrase, not a person; the Spider-Man Oscars market first, the Best Picture picker next`, async () => {
    assert.equal(splitQuery("spider man oscar").phrase?.label, "the Oscars");
    const r = await search("spider man oscar");
    assert.equal(r.cards[0].title, VFX_TITLE);
    assert.equal(r.cards[0].suggestedTicker, "SPIDER");
    assert.equal(r.cards[1].id, BP_WINNER);
    assert.equal(r.cards[1].title, "Pick one: Oscars 2027: Best Picture Winner — your coin burns 10% once if your pick wins");
  });

  test(`"spider" alone: every market of every hit event is read (Spider-Man is market 20-odd of the box-office events, not market 1)`, async () => {
    const r = await search("spider");
    assert.ok(r.cards.length >= 3, r.cards.map((c) => c.title).join("\n"));
    for (const c of r.cards) { assert.match(c.title, /Spider-Man/); assert.equal(c.suggestedTicker, "SPIDER"); assert.ok(c.pick?.market); }
    assert.ok(r.cards.some((c) => c.subtitle.startsWith("Highest grossing movie in 2026")), "an outcome deep inside a 28-market event");
  });
});

describe("the live miss: \"oscars\" returned a House candidate whose middle name is Oscar", () => {
  test("an award phrase is never a race query, and a race card needs a whole name, not a substring across names", async () => {
    const race = raceFromEvent(parseGammaEvent(GA05)!, () => [])!;
    assert.ok(race.outcomes.some((o) => /Oscar Salvesen/.test(o.label)));
    assert.deepEqual(raceCards([race], "oscars"), [], "\"oscars\" does not name John Oscar Salvesen");
    assert.ok(raceCards([race], "salvesen").length >= 1, "his surname still finds him");
    assert.ok(raceCards([race], "oscar salvesen").length >= 1, "and his names together");
    const r = await search("oscars");
    assert.equal(r.cards[0].id, BP_WINNER);
    assert.ok(!r.cards.some((c) => /Salvesen/.test(c.title)), r.cards.map((c) => c.title).join("\n"));
  });
});

describe("event-only queries open a picker", () => {
  test('"best picture", "oscars", "best director": one event card per event, scored off the title; the flagship first', async () => {
    const bp = await search("best picture");
    assert.equal(bp.cards[0].id, BP_WINNER);
    assert.ok(bp.cards.every((c) => c.picker), "event cards only");
    const osc = await search("oscars");
    assert.equal(osc.cards[0].id, BP_WINNER, "Best Picture leads the Oscars even when Gamma's own answer leaves it out");
    assert.ok(osc.cards.length >= 4 && osc.cards.length <= 6);
    const dir = await search("best director");
    assert.match(dir.cards[0].title, /^Pick a director: Oscars 2027: Best Director Winner/);
  });
});

describe("the pieces", () => {
  test("splitting the query and the Gamma searches it makes (at most four)", () => {
    assert.deepEqual(searchQueries(splitQuery("spider-man best picture")), ["spider-man best picture", "best picture", "spider-man", "spider-man oscars"]);
    assert.deepEqual(searchQueries(splitQuery("oscars")), ["oscars", "best picture"]);
    assert.deepEqual(searchQueries(splitQuery("spider")), ["spider"]);
  });
  test("hyphens, colons and spaces are optional in names: spiderman = Spider-Man = spider man", () => {
    for (const q of ["spiderman", "spider-man", "spider man", "Spider Man:"]) assert.ok(nameMatch(q, ["Spider-Man: Brand New Day"]).all, q);
  });
  test("tickers from the outcome: first distinctive word, uppercased, at most 8 characters; collisions get a number", () => {
    assert.equal(outcomeTicker("Spider-Man: Brand New Day"), "SPIDER");
    assert.equal(outcomeTicker("The Odyssey"), "ODYSSEY");
    assert.equal(outcomeTicker("Dune: Part Three"), "DUNE");
    assert.equal(outcomeTicker("The Adventures of Cliff Booth"), "ADVENTUR");
    const card = { id: "polyevent:x", suggestedTicker: null, text: null, windows: null, matchup: null, picker: { slug: "x", title: "x", noun: "film", outcomes: [{ label: "Spider-Man", conditionId: "a", question: "q", yes: "Yes", no: "No", ticker: "SPIDER" }, { label: "Spider-Verse", conditionId: "b", question: "q", yes: "Yes", no: "No", ticker: "SPIDER" }] } } as unknown as Suggestion;
    const [out] = dedupeTickers([card], (t) => t === "SPIDER");
    assert.deepEqual(out.picker!.outcomes.map((o) => o.ticker), ["SPIDER2", "SPIDER3"]);
  });
  test("question → card sentence: the verb agrees", () => {
    assert.equal(plainQuestion("Will Spider-Man: Brand New Day win Best Picture at the 99th Academy Awards?"), "Spider-Man: Brand New Day wins Best Picture at the 99th Academy Awards");
    assert.equal(plainQuestion("Will Spider-Man: Brand New Day have the best domestic opening weekend in 2026?"), "Spider-Man: Brand New Day has the best domestic opening weekend in 2026");
    assert.equal(plainQuestion("Will Spider-Man: Beyond the Spider-Verse be delayed?"), "Spider-Man: Beyond the Spider-Verse is delayed");
  });
  test("every card these queries produce is copy-lint clean and carries no price, odds, volume, liquidity or percentage chance", async () => {
    const cfg = loadCopyLintConfig();
    for (const q of ["spider-man best picture", "spiderman wins best picture", "spider man oscar", "spider", "best picture", "oscars", "best director"]) {
      const r = await search(q);
      assert.deepEqual(noMarketData(r), [], q);
      for (const c of r.cards) for (const t of ownText(c)) assert.ok(lintCopy(t, cfg).ok, `${q}: ${t}`);
      for (const c of r.cards) for (const t of allText(c)) {
        assert.ok(!/\b\d+(\.\d+)?\s*%/.test(t.replace(/\b10% once\b/g, "")), `${q}: a percentage other than the burn share: ${t}`);
        assert.ok(!/¢|\bodds\b|\bchance\b/i.test(t), `${q}: ${t}`);
      }
    }
    assert.ok(asked.every((u) => TABLE.has(u) || !u.includes("public-search")), "every Gamma search is in the fixture");
  });
});
