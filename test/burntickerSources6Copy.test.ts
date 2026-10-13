// sources-6 (QA pass 9 and audit 10, 2026-10-13): the library's copy and catalogue items. Each describe names its item.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import { derbySentence, derbyStatement, type CoinVsSpec } from "@/lib/burnticker/derby/spec";
import { derbyExplainer } from "@/lib/burnticker/launchDerby";
import { TEMPLATES } from "@/lib/burnticker/templates";
import { candidateMappingLine, classifyRace, ELECTION_TAGS, electionsIndexUrl, loadRaces, MAX_INDEX_PAGES } from "@/lib/burnticker/elections";
import { BONK, SHIB, WIF } from "./burntickerDerbyHelpers.ts";

const ROOT = path.join(import.meta.dirname, "..");
const cfg = loadCopyLintConfig();
const plain = (t: string) => { const r = lintCopy(t, cfg); assert.ok(r.ok, `${r.hits.map((h) => `${h.phrase} (${h.rule})`).join(", ")}: ${t}`); };
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");

describe("the owner, 2026-10-13: every Coin vs Coin sentence names the new coin that burns; the reference coins are only read", () => {
  const daily: CoinVsSpec = { selector: "coinvs", a: WIF, b: BONK, window: "daily", measure: "pct", season: { start: "2026-10-14", days: 30 }, flip: false };
  const mcap: CoinVsSpec = { ...daily, b: SHIB, measure: "mcap" };
  const flip: CoinVsSpec = { ...daily, measure: "mcap", flip: true };
  test("the review sentence, the statement, the explainer and the templates", () => {
    const s = derbySentence(daily, "TEAMWIF", "TEAMBONK", 0.02);
    assert.equal(s, "$TEAMWIF burns 2% every day WIF out-gains BONK (Pyth, 00:00 UTC), and $TEAMBONK's share for that day goes to $TEAMWIF's burn. On a day BONK out-gains WIF, $TEAMBONK burns and takes $TEAMWIF's share. WIF and BONK are only read, never traded or burned. Runs for 30 days, then winds down.");
    const texts = [
      s, derbySentence(mcap, "TEAMWIF", "TEAMSHIB", 0.02), derbySentence(flip, "WIFVBONK", "BONKVWIF", 0.5), derbySentence(daily, "TEAMWIF", null, 0.02),
      derbyStatement(daily, "A", "pair-1"), derbyStatement(daily, "B", "pair-1"), derbyStatement(flip, "A", "pair-2"), derbyStatement(flip, "B", "pair-2"),
      ...Object.values(derbyExplainer(daily, { a: "TEAMWIF", b: "TEAMBONK" })), ...Object.values(derbyExplainer(flip, { a: "WIFVBONK", b: "BONKVWIF" })),
      ...TEMPLATES.filter((t) => t.type === "derby").map((t) => t.example),
    ];
    for (const t of texts) {
      assert.doesNotMatch(t, /\b(the )?winner'?s coin\b|\bthe winning coin\b/i, t);
      plain(t);
    }
    for (const t of [texts[0], texts[1], texts[2], texts[4], texts[5], texts[6], texts[7]]) assert.match(t, /are only read, never traded or burned\./, t);
    assert.match(derbyStatement(daily, "B", "pair-1"), /This coin burns on a window BONK wins\. On a window WIF wins, the other new coin burns, and this coin's share for that window goes to the other new coin's burn\./);
    for (const id of ["coin-vs-coin", "bracket", "flippening"]) assert.match(TEMPLATES.find((t) => t.id === id)!.example, /only read, never traded or burned/, id);
    for (const f of ["src/lib/burnticker/derby/spec.ts", "src/lib/burnticker/derby/page.ts", "src/lib/burnticker/launchDerby.ts", "src/lib/burnticker/templates.ts"]) assert.doesNotMatch(read(f).replace(/^\s*(\/\/|\*).*$/gm, "").replace(/^.*id: "election-pair".*$/m, ""), /the winner's coin burns/, f);   // owner 2026-10-13: the election pair's own sentence says "the winner's coin" (a candidate wins)
  });
  test("audit 10 #4: the flippening's tie, missing-reading, cross-read and end paragraphs follow the size comparison, not a daily return", () => {
    const x = derbyExplainer(flip, { a: "WIFVBONK", b: "BONKVWIF" });
    assert.match(x.tie, /sizes are exactly equal.*has not passed.*next window is read/);
    assert.match(x.missing, /comparison of the two sizes/);
    assert.match(x.end, /\$BONKVWIF burns once at the end of the run/);
    assert.doesNotMatch(`${x.tie} ${x.missing} ${x.window}`, /percentage|margin between the two changes|void/);
    const d = derbyExplainer(daily, { a: "TEAMWIF", b: "TEAMBONK" });
    assert.match(d.tie, /An exact tie is a void/); assert.match(d.missing, /margin between the two changes/);
    assert.match(derbyExplainer(mcap, { a: "A1", b: "B1" }).window, /grew more in size/);
  });
});

describe("QA pass 9 #26: the election index keeps every race (Alaska and California governors, the 435th House seat)", () => {
  test("titles with trailing spaces and a district listed only by individual classify", () => {
    assert.deepEqual(classifyRace("Alaska Governor Election Winner  "), { type: "governor", state: "AK", district: null });
    assert.deepEqual(classifyRace("Nebraska Senate Election Winner  "), { type: "senate", state: "NE", district: null });
    assert.deepEqual(classifyRace("CA-40 House Election Winner (Individual)"), { type: "house", state: "CA", district: "40", individual: true });
    assert.deepEqual(classifyRace("CA-04 House Election Winner (by individual)"), { type: "house", state: "CA", district: "04", individual: true });
  });
  test("the saved index: 435 House races, both Alaska races; the per-office tags add the California governor; a short page does not end the read", async () => {
    const IDX = JSON.parse(read("config/burnticker/fixtures/polymarket/midterms.index.json")) as { pages: { url: string; body: unknown[] }[] };
    const ca = { id: "9001", slug: "california-governor-election-2026", title: "California Governor Election Winner", closed: false, active: true, endDate: "2026-11-03T12:00:00Z", description: "Resolves to the winner.", markets: [{ id: "1", conditionId: `0x${"c".repeat(64)}`, question: "Will Xavier Becerra win the California Governor race?", groupItemTitle: "Xavier Becerra (D)", outcomes: "[\"Yes\", \"No\"]", active: true, closed: false }] };
    const get = async (u: string) => { const p = IDX.pages.find((x) => x.url === u); if (p) return p.body; if (u === electionsIndexUrl(0, "governor-midterms")) return [ca]; if (/tag_slug=(governor|senate)-midterms/.test(u)) return []; throw new Error(`HTTP 404 ${u}`); };
    const races = await loadRaces(get);
    const n = (t: string) => new Set(races.filter((r) => r.type === t).map((r) => `${r.state}-${r.district}`)).size;
    assert.equal(n("house"), 435);
    assert.ok(races.some((r) => r.type === "governor" && r.state === "AK"));
    assert.ok(races.some((r) => r.type === "senate" && r.state === "NE"));
    assert.ok(races.some((r) => r.type === "governor" && r.state === "CA"), "the governor-midterms tag adds California");
    assert.equal(races.find((r) => r.state === "AK" && r.type === "governor")!.title, "Alaska Governor Election Winner");
    const ca04 = races.filter((r) => r.type === "house" && r.state === "CA" && r.district === "04");
    assert.equal(ca04.length, 1, "a district with a party listing keeps it, not the individual listing as well");
    assert.ok(MAX_INDEX_PAGES * 100 >= 1215 + 100, "room for the 1,215 open events the main tag listed on 2026-10-13");
    assert.deepEqual([...ELECTION_TAGS], ["midterms", "governor-midterms", "senate-midterms"]);
  });
  test("audit 10 #5: a candidate's coin names the candidate and the market it settles on, with what a replacement does", () => {
    const r = { type: "senate" as const, stateName: "Michigan", district: null, state: "MI" };
    const party = candidateMappingLine(r, { label: "Mike Rogers (R)", question: "Will the Republicans win the Michigan Senate race?", partyMarket: true }, "ROGERS");
    assert.equal(party, "$ROGERS is named for Mike Rogers, but it settles on the Republican Party's market for the Michigan Senate race (“Will the Republicans win the Michigan Senate race?”). If the party replaces Mike Rogers as its nominee, the coin follows the new nominee.");
    const own = candidateMappingLine(r, { label: "Abdul El-Sayed (D)", question: "Will Abdul El-Sayed win the Michigan Senate race?", partyMarket: false });
    assert.match(own, /^This coin settles on Abdul El-Sayed's own market .* If Abdul El-Sayed does not win, withdraws or is replaced, that market settles NO and the coin burns nothing\.$/);
    for (const t of [party.replace(/“[^”]*”/, "“…”"), own.replace(/“[^”]*”/, "“…”")]) plain(t);
  });
});
