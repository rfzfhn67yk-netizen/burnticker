// Seventh prelaunch pass (2026-10-20), B-20 and B-21 copy and display fixes: HB-170 (a same-window copycat of a team coin), HB-171
// (party-control cards), HB-173 ("No trades yet" on traded curves), HB-174 and HB-179 ("locked forever" before graduation), HB-175
// (the 2026-10-20 incident entry). Pure, no network.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { lookalikeHits } from "@/lib/burnticker/lookalike";
import { teamWordName } from "@/lib/burnticker/tickerSwap";
import { polyRule, raceCards } from "@/lib/burnticker/search";
import { controlIdentity } from "@/lib/burnticker/elections";
import { NO_TRADES, NO_TRADES_WHY, mcapCell } from "@/lib/burnticker/cardView";
import { describeRule } from "@/lib/burnticker/describe";
import { FEE_FLOW_LINE } from "@/lib/burnticker/tokenPage";
import { teamCoinSentence } from "@/lib/burnticker/wizard";
import { readIncidentLog } from "@/lib/burnticker/history";
import { formatHits, lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";

const cfg = loadCopyLintConfig();
const clean = (t: string) => { const r = lintCopy(t, cfg); assert.ok(r.ok, `${t}\n${formatHits(r)}`); };

describe("HB-170: a copycat on the same team window", () => {
  const rule = { oracle: "catalogue", series: "espn.team:nfl-PHI.21-win-s2026" } as never;
  const live = [{ ticker: "PHINFLWIN", name: "Eagles 2026 Wins", status: "live", creator: "X", rule }] as never;
  test("the same rule with the same name is refused by name, even with a different ticker", () => {
    const hits = lookalikeHits({ ticker: "PHINFLFANS", name: "Eagles 2026 Wins", rule, creator: "Y" }, live);
    assert.ok(hits.some((h) => h.field === "name"), JSON.stringify(hits));
  });
  test("another window of the same team is still exempt", () => {
    const a = { oracle: "catalogue", series: "espn.team:nfl-PHI.21-win-s2026" } as never, b = { oracle: "catalogue", series: "espn.team:nfl-PHI.21-win-p2026" } as never;
    const season = [{ ticker: "PHIWIN26", name: "Eagles 2026 Wins", status: "live", creator: "X", rule: a }] as never;
    // HB-188 (eighth pass LA8-3): the ticker stays exempt on another window; the identical name does not
    assert.deepEqual(lookalikeHits({ ticker: "PHIWINPO", name: "Eagles 2026 Wins", rule: b, creator: "Y" }, season).map((h) => h.field), ["name"]);
    assert.deepEqual(lookalikeHits({ ticker: "PHIWINPO", name: "Eagles 2026 Postseason Wins", rule: b, creator: "Y" }, season), []);
    assert.ok(lookalikeHits({ ticker: "PHIWINPO", name: "Eagles 2026 Wins", rule: a, creator: "Y" }, season).some((h) => h.field === "name"));
  });
  test("the generated name moves with a team-word ticker, and that name passes", () => {
    const name = teamWordName("Eagles 2026 Wins", "PHINFLWIN", "PHINFLFANS");
    assert.equal(name, "Eagles Fans 2026 Wins");
    assert.deepEqual(lookalikeHits({ ticker: "PHINFLFANS", name: name!, rule, creator: "Y" }, live).filter((h) => h.field === "name"), []);
    assert.equal(teamWordName("Broncos Win", "DENWIN", "DENCLUB"), "Broncos Club Win");
    assert.equal(teamWordName("Broncos Win", "DENWIN", "DENWIN2"), null);
  });
});

describe("HB-171: party-control cards read naturally", () => {
  const mk = (title: string, label: string, q: string, id: string) => ({ slug: id, title, url: "u", type: "control", state: null, stateName: null, district: null, settlesOn: "2026-11-04", description: "Resolves to the party.", outcomes: [{ conditionId: id, label, question: q, yes: "Yes", no: "No", partyMarket: true }], hiddenPlaceholders: 7, sos: { name: "n", url: "https://example.org", check: "c" }, settlement: "s", refused: [] });
  const senate = mk("Which party will win the Senate in 2026?", "Democratic Party", "Will the Democratic Party win the Senate in 2026?", "0xa");
  const house = mk("Which party will win the House in 2026?", "Republican Party", "Will the Republican Party win the House in 2026?", "0xb");
  test("title, name, ticker and first sentence", () => {
    const [c] = raceCards([senate] as never, "senate");
    assert.equal(c.title, "The Democratic Party wins control of the Senate, which settles on 2026-11-04.");
    assert.equal(c.suggestedName, "Democrats win the Senate");
    assert.equal(c.suggestedTicker, "DEMSENATE");
    assert.equal(c.subtitle, "Which party will win the Senate in 2026? 7 placeholder markets with no name are hidden.");
    assert.ok(c.text!.paragraph.startsWith("$DEMSENATE burns if the Democratic Party wins control of the Senate in the 2026 election."), c.text!.paragraph);
    assert.doesNotMatch(JSON.stringify(c), /Which party will win the Senate in 2026\? race|Party Wins/);
    const [h] = raceCards([house] as never, "house");
    assert.equal(h.suggestedTicker, "REPHOUSE");
    assert.equal(h.suggestedName, "Republicans win the House");
  });
  test("other races are unchanged", () => {
    assert.equal(controlIdentity({ type: "senate", title: "Michigan Senate Election Winner", settlesOn: null }, { label: "Abdul El-Sayed (D)", question: "q" }), null);
  });
});

describe("HB-173: a curve with nothing raised", () => {
  test("never claims nobody traded", () => {
    const cell = mcapCell({ cap: "28", quote: "SOL", phase: "curve", raised: "0.000000001" });
    assert.equal(cell.text, "Nothing net raised yet");
    assert.doesNotMatch(`${NO_TRADES} ${NO_TRADES_WHY}`, /no trades|nobody has traded/i);
    for (const t of [NO_TRADES, NO_TRADES_WHY]) clean(t);
  });
});

describe("HB-174 / HB-179: the lock is described as happening at graduation", () => {
  test("generated descriptions, the review and the coin page line", () => {
    const t = describeRule(polyRule("0xabc"), { ticker: "TEST", eventPhrase: "the Broncos win the Super Bowl" });
    assert.match(t.ruleBlock, /The creator earns nothing\. Liquidity locks forever at graduation, and its fees fund the burn\.$/);
    assert.doesNotMatch(t.ruleBlock, /The liquidity pool is locked forever/);
    for (const s of [FEE_FLOW_LINE, t.ruleBlock]) { assert.match(s, /graduation/); clean(s); }
    assert.match(FEE_FLOW_LINE, /After graduation, the pool's liquidity is locked forever\./);
    assert.match(teamCoinSentence("Eagles", "EAGLES", "win"), /After graduation, the pool's liquidity is locked forever/);
    const card = fs.readFileSync(path.join(process.cwd(), "src", "app", "burnticker", "launch", "ReviewCard.tsx"), "utf8");
    assert.match(card, /export const LP_LINE = `After graduation, the pool's liquidity is locked forever\./);
    assert.match(card, /export const PAIR_LP_LINE = `After graduation, each pool's liquidity is locked forever\./);
  });
  test("$REHEARSAL no longer says its LP is locked", () => {
    const tj = fs.readFileSync(path.join(process.cwd(), "config", "burnticker", "transparency.json"), "utf8");
    assert.doesNotMatch(tj, /Its LP is locked forever/);
    assert.match(tj, /Its liquidity is locked forever only if its curve fills and it moves to a Raydium pool\. The curve has not filled, so there is no pool and no lock yet\./);
  });
});

describe("HB-175: the incident log has a 2026-10-20 entry", () => {
  test("rendered by the incidents page", () => {
    const log = readIncidentLog();
    const e = log.entries.find((x) => x.heading.startsWith("2026-10-20"));
    assert.ok(e, log.entries.map((x) => x.heading).join(" | "));
    assert.match(e!.body, /05:13/);
    assert.match(e!.body, /05:18/);
    assert.match(e!.body, /publish 104/);
  });
});
