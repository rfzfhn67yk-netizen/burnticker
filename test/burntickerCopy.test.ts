// THE RECEIPTS-FIRST COPY (owner-approved 2026-10-10 night): "Coins that burn on real-world results — with receipts." / "Launch one.
// Follow the season." The receipt is the product; a season is a scoreboard of burns; nothing is ever won — things are only burned.
// This suite holds every surface the re-cut touched to that line: the landing page (two doors above the fold, the guardrail strip,
// leagues rotated, no Kalshi, the copy lint on every visible word), the X profile and thread templates, the two @BurnTicker formats
// (receipt + scoreboard: exact text on a sample, the doc's filled examples equal to the output, 280 characters), the public README
// opening and the whitepaper's title line.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { formatHits, lintCopy, loadCopyLintConfig, xLength } from "@/lib/launch/copyLint";
import { allLeaguesLine, fmtDay, fmtRange, receiptPostText, scoreboardLeagues, scoreboardText, seasonLabel, teamLeagueOf, SCOREBOARD_FOOTER, SCOREBOARD_FOOTER_FINAL, SHORT_DISCLAIMER } from "@/lib/launch/dailyPost";
import { COPY_SITE, RAYS_RECEIPTS, RAYS_STATUS, SEASON_DIR, SEASON_INDEX, SEASON_RECEIPTS, rc } from "./burntickerCopyFixture.ts";

const cfg = loadCopyLintConfig();
const clean = (t: string, what: string) => { const r = lintCopy(t, cfg); assert.ok(r.ok, `${what}:\n${formatHits(r)}`); };
const SENTENCE = "Coins that burn on real-world results — with receipts.";
const SUBLINE = "Launch one. Follow the season.";
const GUARDRAILS = ["settled on primary sources", "signed readings (one attester at launch; second attester scheduled, not live)", "program-run burns", "receipts anyone can recompute", "open source", "three blind AI reviews, not a firm audit", "creators earn nothing", "no team buy", "the platform never buys any coin", "all LP burned", "rules locked at launch"];
const LEAGUE = "(?:NFL|MLB|NBA|NHL|WNBA|MLS)";

/** The words a visitor reads: meta descriptions + the body without style, script and the inline SVG, tags stripped. */
function visibleText(html: string): string {
  const metas = [...html.matchAll(/<meta[^>]+content="([^"]*)"/g)].map((m) => m[1]);
  const title = /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? "";
  const body = html.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<script[\s\S]*?<\/script>/g, "").replace(/<svg[\s\S]*?<\/svg>/g, "").replace(/<[^>]+>/g, " ");
  return [title, ...metas, body].join("\n").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/[ \t]+/g, " ");
}
/** Every run of league names in a list ("MLB, NBA, NHL and NFL", "MLB · NBA · NHL · NFL"): the first must never be the NFL. */
function leagueLists(text: string): string[][] {
  const re = new RegExp(`\\b${LEAGUE}(?:\\s*(?:,|·|/|and|or)\\s*${LEAGUE})+\\b`, "g");
  return [...text.matchAll(re)].map((m) => m[0].split(/\s*(?:,|·|\/|\band\b|\bor\b)\s*/).filter(Boolean));
}

describe("the landing page (site/burnticker/index.html)", () => {
  const html = fs.readFileSync("site/burnticker/index.html", "utf8");
  const text = visibleText(html);
  test("every visible word passes the copy lint, including no-prizes", () => clean(text, "landing"));
  test("the hero is the one sentence and the sub-line; the title and descriptions carry it", () => {
    const h1 = /<h1>([\s\S]*?)<\/h1>/.exec(html)![1].replace(/<[^>]+>/g, "");
    assert.equal(h1, SENTENCE);
    assert.match(html, /<p class="sub">Launch one\. Follow the season\.<\/p>/);
    assert.match(html, /<meta name="description" content="Coins that burn on real-world results — with receipts\. Launch one\. Follow the season\./);
  });
  test("two doors above the fold — Launch and Seasons — before the tape, each a link to a page that exists", () => {
    const hero = html.slice(html.indexOf('<section class="hero'), html.indexOf('<div class="tape"'));
    const doors = [...hero.matchAll(/<a class="door[^"]*" href="([^"]+)">[\s\S]*?<h3>([^<]+)<\/h3>/g)].map((m) => [m[2], m[1]]);
    assert.deepEqual(doors, [["Launch", "/burnticker/launch"], ["Seasons", "/burnticker/rivalries"]]);
    assert.ok(fs.existsSync("src/app/burnticker/launch/page.tsx") && fs.existsSync("src/app/burnticker/rivalries/page.tsx"));
    assert.match(html, /\.doors\{display:grid;grid-template-columns:1fr;/, "one column on a phone");
  });
  test("the guardrail strip: the eleven guardrails, in order, inside the hero", () => {
    const strip = /<ul class="guard"[^>]*>([\s\S]*?)<\/ul>/.exec(html)![1];
    assert.deepEqual([...strip.matchAll(/<li>([^<]+)<\/li>/g)].map((m) => m[1]), GUARDRAILS);
    assert.ok(html.indexOf('<ul class="guard"') < html.indexOf('<div class="tape"'));
  });
  test("every league, no league first: no list of leagues starts with the NFL, the tape's first game is not an NFL game, and the examples rotate sports", () => {
    const lists = leagueLists(text);
    assert.ok(lists.length >= 2, "the page names its leagues");
    for (const l of lists) assert.notEqual(l[0], "NFL", l.join(" "));
    const espn = [...html.matchAll(/<i>ESPN\.([A-Z]+)<\/i>/g)].map((m) => m[1]);
    assert.notEqual(espn[0], "NFL"); assert.deepEqual([...new Set(espn)].sort(), ["MLB", "NBA", "NFL", "NHL"]);
    for (const team of ["$RAYS", "$LAKERS", "$OILERS", "$EAGLES"]) assert.ok(text.includes(team), team);
  });
  test("sources: Kalshi is never named; Polymarket only as the on-chain payout; prediction markets are for discovery", () => {
    assert.doesNotMatch(html, /kalshi|KX[A-Z]{3,}/i);
    assert.match(text, /on-chain payout of an adjudicated Polymarket market/);
    assert.match(text, /Prediction markets are for discovery/);
    assert.doesNotMatch(text, /Polymarket payout|POLYGON PAYOUT/);
  });
  test("nothing is invented: Derby appears only once its page exists; no 'coming soon'; the champion is a stat", () => {
    if (!fs.existsSync(path.join("src", "app", "burnticker", "derby", "page.tsx"))) assert.doesNotMatch(text, /derby/i);
    else assert.match(html, /href="\/burnticker\/derby"/, "the Derby index exists on main: Seasons links it");
    assert.doesNotMatch(text, /coming soon/i);
    assert.match(text, /Only when a league's season ends is the coin with the most receipts its champion: a stat on a scoreboard, never a recipient of anything/);
    assert.match(text, /Nothing is ever won here — things are only burned\./);
  });
  test("Seasons: one scoreboard per league and season, dated not numbered by week, no cross-league table, no champion mid-season, an example-data tag", () => {
    const sec = html.slice(html.indexOf('<section class="wrap" id="seasons">'), html.indexOf('<section class="wrap" id="layers">'));
    const boards = [...sec.matchAll(/<div class="board">([\s\S]*?)\n      <\/div>/g)].map((m) => m[1]);
    assert.deepEqual(boards.map((b) => /<p class="bh"><b>([^<]+)<\/b> <span>([^<]+)<\/span>/.exec(b)!.slice(1)), [
      ["NHL 2026–27", "Oct 3 – 9 · 4 team coins"], ["MLB 2026 postseason", "Oct 3 – 9 · 4 team coins"], ["NBA 2026–27", "Oct 3 – 9 · 3 team coins"], ["NFL 2026", "Oct 3 – 9 · 4 team coins"],
    ]);
    for (const b of boards) { assert.doesNotMatch(b, /<th[^>]*>league<\/th>|champion/i, "no league column, no champion during the season"); assert.ok((b.match(/most receipts so far/g) ?? []).length <= 1); }
    const sv = visibleText(sec);
    assert.doesNotMatch(sv, /\bweek \d|across \d+ leagues/i, "dates, not weeks; no cross-league tally line");
    assert.match(sv, /Yesterday \(Oct 9\) across all leagues: 5 team coins burned\./, "the only cross-league line is a count");
    assert.match(sec, /<span class="extag">example data<\/span>/);
    assert.match(sv, /\$OILERS most receipts so far/, "the marker is its own word, never glued to the ticker");
    assert.match(sec, /\$OILERS <span class="mark">most receipts so far<\/span>/);
    clean(sv, "seasons");
  });
  test("the cold read's edits (docs/launch/gtm/COLD-READ.md): the one-line definition, labelled examples, nothing the code does not do", () => {
    assert.match(html, /<p class="def">A Solana memecoin launchpad\. Each coin has one locked rule; when its result settles, the coin's own trading fees buy it back on its own pool and a program burns what they bought\. The transaction is the receipt\.<\/p>/);
    assert.match(text, /example receipt · illustrative numbers, not a live coin/);
    assert.match(text, /a pre-audit list of up to three approved crankers can apply for at most 90 days, until the cap lifts/);
    assert.match(text, /if the operator stops, readings stop and burns stop\. Holders keep their coins/);
    assert.match(text, /all LP is burned, so there is no platform share of LP fees/);
    for (const gone of [/anyone can crank/i, /if we disappear/i, /keep working/i, /set to none after review/i, /not built yet/i, /share of post-graduation LP fees/i, /within 14 days/i, /nothing to trust/i, /<li>reviewed<\/li>/]) assert.doesNotMatch(html, gone, String(gone));
  });
  test("mobile-safe and linked: viewport meta, no horizontal scroll, the whitepaper linked", () => {
    assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
    assert.match(html, /body\{[^}]*overflow-x:hidden/);
    assert.match(html, /href="whitepaper\.html"/);
  });
});

describe("the X profile kit (docs/launch/x-burnticker-profile.md)", () => {
  const doc = fs.readFileSync("docs/launch/x-burnticker-profile.md", "utf8");
  const bio = /\| Bio \(≤160 chars\) \| `([^`]+)`/.exec(doc)![1];
  test("the bio: the sentence and the sub-line, ≤ 160 characters, lint-clean; the shorter bio too", () => {
    assert.ok(bio.startsWith(`${SENTENCE} ${SUBLINE}`), bio);
    assert.ok([...bio].length <= 160, `${[...bio].length} chars`);
    assert.match(doc, new RegExp(`\\| ${[...bio].length} characters\\.`), "the noted count is the real count");
    clean(bio, "bio");
    const short = /Shorter bio[^\n]*\n`([^`]+)`/.exec(doc)![1];
    assert.equal(short, `${SENTENCE} ${SUBLINE}`); clean(short, "short bio");
  });
  test("the handle is @BurnTicker and the pinned post passes the lint, every league named without the NFL first", () => {
    assert.match(doc, /\| Handle \| \*\*@BurnTicker\*\* \|/);
    const pinned = doc.slice(doc.indexOf("## Pinned post"), doc.indexOf("## The two formats")).split("\n").filter((l) => l.startsWith(">")).map((l) => l.replace(/^> ?/, "")).join("\n").trim();
    assert.ok(pinned.startsWith(SENTENCE)); clean(pinned, "pinned");
    for (const l of leagueLists(pinned)) assert.notEqual(l[0], "NFL");
    assert.doesNotMatch(pinned, /kalshi/i);
  });
});

describe("the thread templates (docs/launch/x-threads.md)", () => {
  const doc = fs.readFileSync("docs/launch/x-threads.md", "utf8");
  const posts = (from: string, to: string, n: number) => doc.slice(doc.indexOf(from), doc.indexOf(to)).split(new RegExp(`\\n\\*\\*\\d\\/${n} — [^*]+\\*\\*\\n`)).slice(1).map((p) => p.split("\n").filter((l) => l.startsWith(">")).map((l) => l.replace(/^> ?/, "")).join("\n").trim());
  test("§2 the announcement thread: six posts, the sentence first, the guardrails, each lint-clean", () => {
    const p = posts("## 2. Burnticker announcement thread", "## 2b. Rivalry pair announcement thread", 6);
    assert.equal(p.length, 6);
    assert.equal(p[0], `${SENTENCE}\n\n${SUBLINE} 🧵`);
    for (const g of GUARDRAILS) assert.ok(p[4].toLowerCase().includes(g.toLowerCase()), g);
    for (const x of p) { assert.ok(x.length > 20); clean(x, x.slice(0, 50)); for (const l of leagueLists(x)) assert.notEqual(l[0], "NFL"); }
  });
  test("no Kalshi anywhere in the thread templates", () => assert.doesNotMatch(doc, /kalshi|KXNFL|KXINX/i));
  test("§2c the filled examples are the formats' own output on the sample, and lint-clean", () => {
    const sec = doc.slice(doc.indexOf("## 2c."), doc.indexOf("## 3. Evergreen post templates"));
    const ex = [...sec.matchAll(/```text\n([\s\S]*?)\n```/g)].map((m) => m[1]);
    assert.equal(ex.length, 2);
    assert.equal(ex[0], receiptPostText(RAYS_STATUS, RAYS_RECEIPTS, RAYS_RECEIPTS[4], COPY_SITE));
    assert.equal(ex[1], scoreboardText({ index: SEASON_INDEX, receiptsByTicker: SEASON_RECEIPTS, league: "NHL", day: "2026-10-09" }));
    for (const e of ex) clean(e, e.slice(0, 40));
  });
});

describe("the two @BurnTicker formats (src/lib/launch/dailyPost.ts)", () => {
  test("receipt: one confirmed burn, plain and numeric, ≤ 280 characters, lint-clean", () => {
    const t = receiptPostText(RAYS_STATUS, RAYS_RECEIPTS, RAYS_RECEIPTS[4], COPY_SITE);
    assert.equal(t, [
      "Receipt #5 · $RAYS · 2026-10-09",
      "NYY 5 @ TB 2 · reading 1 (espn-final+mlb)",
      "1 unit → 40,973 $RAYS burned · 0.0041 SOL spent",
      "Supply 975,900,000 (2.41% burned · 5 receipts)",
      "tx https://solscan.io/tx/5QmRays · page https://burnticker.com/t/RAYS/",
      SHORT_DISCLAIMER,
    ].join("\n"));
    assert.ok(xLength(t) <= 280, String(xLength(t))); clean(t, "receipt");
    const yes = receiptPostText({ ...RAYS_STATUS, ticker: "ELSAYED" }, [rc({ result: "yes", value: null, title: "Michigan Senate 2026", method: "polymarket-ctf+sos", units: 1, burned: "5000000" })], rc({ result: "yes", value: null, title: "Michigan Senate 2026", method: "polymarket-ctf+sos", units: 1, burned: "5000000" }), null);
    assert.match(yes, /^Receipt #1 · \$ELSAYED · 2026-10-09\nMichigan Senate 2026 · settled YES \(polymarket-ctf\+sos\)\n1 unit → 5,000,000 \$ELSAYED burned/); assert.match(yes, /page \{SITE_URL\}\/t\/ELSAYED\//); clean(yes, "one-shot receipt");
  });
  test("receipt: a skipped, void or unburned row has no receipt post", () => {
    for (const r of [rc({ status: "skipped", burned: null }), rc({ status: "void", burned: null }), rc({ burned: "0" }), rc({ status: "planned" })]) assert.throws(() => receiptPostText(RAYS_STATUS, RAYS_RECEIPTS, r, COPY_SITE), /not a confirmed burn/);
  });
  test("scoreboard: one league, one season — that league's coins only, ranked by receipts, the leader 'most receipts so far'; ≤ 280; lint-clean", () => {
    const sb = (league: string, extra: Partial<Parameters<typeof scoreboardText>[0]> = {}) => scoreboardText({ index: SEASON_INDEX, receiptsByTicker: SEASON_RECEIPTS, league, day: "2026-10-09", ...extra });
    const nhl = sb("NHL");
    assert.equal(nhl, [
      "NHL 2026–27 · Oct 9 · 4 team coins · 2 burned yesterday",
      "1. $OILERS 2 receipts, 0.98% burned · most receipts so far",
      "2. $BRUINS 1 receipt, 0.51% burned",
      "3. $FLAMES 1 receipt, 0.49% burned",
      SCOREBOARD_FOOTER,
    ].join("\n"));
    assert.equal(sb("mlb").split("\n")[0], "MLB 2026 postseason · Oct 9 · 4 team coins · 2 burned yesterday");
    assert.equal(sb("NBA"), ["NBA 2026–27 · Oct 9 · 3 team coins · 0 burned yesterday", "No receipts this season so far.", SCOREBOARD_FOOTER].join("\n"));
    assert.match(sb("NFL"), /^NFL 2026 · Oct 9 · 4 team coins · 0 burned yesterday\n1\. \$JAGUARS 3 receipts, 1\.46% burned · most receipts so far\n/);
    for (const lg of scoreboardLeagues(SEASON_INDEX)) {
      const x = sb(lg);
      assert.ok(xLength(x) <= 280, `${lg} ${xLength(x)}`); clean(x, lg);
      assert.doesNotMatch(x, /champion|DEFICIT|COYOTES|\bweek\b/i, `${lg}: no champion mid-season, no non-team or retired coin, no weeks`);
      for (const other of scoreboardLeagues(SEASON_INDEX).filter((o) => o !== lg)) for (const t of SEASON_INDEX.tokens.filter((t) => teamLeagueOf(t.selectorKey) === other)) assert.ok(!x.includes(`$${t.ticker} `), `${lg} shows no ${other} coin`);
    }
    assert.deepEqual(scoreboardLeagues(SEASON_INDEX), ["NHL", "MLB", "NBA", "NFL"], "a fixed rotation that never starts with the NFL");
    assert.ok(sb("NHL", { site: COPY_SITE }).endsWith(`${SCOREBOARD_FOOTER} https://burnticker.com/`));
  });
  test("scoreboard: champion only once the season is over (inside its league), ties say so, --season overrides, an empty league; the cross-league line is a count", () => {
    const sb = (extra: Partial<Parameters<typeof scoreboardText>[0]>) => scoreboardText({ index: SEASON_INDEX, receiptsByTicker: SEASON_RECEIPTS, league: "NHL", day: "2027-04-20", ...extra });
    const fin = sb({ seasonOver: true });
    assert.match(fin, /^NHL 2026–27 · Apr 20 · /); assert.match(fin, /\$OILERS 2 receipts, 0\.98% burned · champion\n/); assert.ok(fin.endsWith(SCOREBOARD_FOOTER_FINAL)); clean(fin, "final");
    const tied = { ...SEASON_INDEX, tokens: SEASON_INDEX.tokens.map((t) => (t.ticker === "BRUINS" ? { ...t, burns: 2 } : t)) };
    const tieMid = scoreboardText({ index: tied, receiptsByTicker: SEASON_RECEIPTS, league: "NHL", day: "2026-10-09" });
    assert.equal(tieMid.match(/most receipts so far \(tied\)/g)?.length, 2); clean(tieMid, "tie mid");
    assert.equal(scoreboardText({ index: tied, receiptsByTicker: SEASON_RECEIPTS, league: "NHL", day: "2027-04-20", seasonOver: true }).match(/champion \(tied\)/g)?.length, 2);
    assert.match(sb({ season: "2026–27 regular season", top: 1 }), /^NHL 2026–27 regular season · Apr 20 · 4 team coins · 0 burned yesterday\n1\. \$OILERS[^\n]*\nReceipt counts/);
    assert.match(scoreboardText({ index: SEASON_INDEX, receiptsByTicker: {}, league: "MLS", day: "2026-10-09" }), /^MLS 2026 · Oct 9 · 0 team coins · 0 burned yesterday\nNo MLS team coin is live\./);
    assert.equal(allLeaguesLine(SEASON_INDEX, SEASON_RECEIPTS, "2026-10-09"), "Yesterday (Oct 9) across all leagues: 4 team coins burned.");
    assert.equal(seasonLabel("NHL", "2027-03-01"), "2026–27"); assert.equal(seasonLabel("NFL", "2027-01-15"), "2026"); assert.equal(seasonLabel("MLB", "2026-06-01"), "2026"); assert.equal(seasonLabel("NBA", "2026-10-09"), "2026–27");
    assert.equal(fmtDay("2026-10-09"), "Oct 9"); assert.equal(fmtRange("2026-10-03", "2026-10-09"), "Oct 3 – 9"); assert.equal(fmtRange("2026-09-28", "2026-10-04"), "Sep 28 – Oct 4");
  });
  test("teamLeagueOf reads the league from ESPN team and game selectors only", () => {
    assert.equal(teamLeagueOf("catalogue:espn.team:nhl-EDM-loss"), "NHL"); assert.equal(teamLeagueOf("espn.game:nfl-401772510-JAX-loss"), "NFL");
    assert.equal(teamLeagueOf("catalogue:treasury.debt"), null); assert.equal(teamLeagueOf("polymarket:market:0xabc"), null);
  });
});

describe("the public README opening and the whitepaper title", () => {
  test("config/public-repo/overlay/README.md opens on the sentence, the sub-line and the guardrails, lint-clean up to 'What is where'", () => {
    const md = fs.readFileSync("config/public-repo/overlay/README.md", "utf8");
    const opening = md.slice(0, md.indexOf("## What is where"));
    assert.match(opening, /^# Burnticker\n\n\*\*Coins that burn on real-world results — with receipts\.\*\* Launch one\. Follow the season\.\n/);
    for (const g of GUARDRAILS) assert.ok(opening.toLowerCase().replace(/\s+/g, " ").includes(g.toLowerCase()), g);
    assert.doesNotMatch(opening, /kalshi/i); clean(opening, "README opening");
  });
  test("the whitepaper's title line and abstract carry the sentence (the whole paper is linted in burntickerWhitepaper.test.ts)", () => {
    const md = fs.readFileSync("docs/burnticker/WHITEPAPER.md", "utf8");
    assert.match(md, /^# Burnticker: coins that burn on real-world results, with receipts\n/);
    const abs = md.slice(md.indexOf("## 1. Abstract"), md.indexOf("## 2. "));
    assert.ok(abs.includes(`**${SENTENCE}**`)); assert.match(abs, /nothing is ever\nwon — things are only burned/); clean(abs, "abstract");
    assert.match(fs.readFileSync("docs/burnticker/README.md", "utf8"), /^# Burnticker — coins that burn on real-world results, with receipts\n/);
  });
});

describe("the committed platform fixture and the brand", () => {
  test("test/fixtures/burnticker-season (the draft script's --platform-dir sample) equals the fixture objects", () => {
    const read = (f: string) => JSON.parse(fs.readFileSync(path.join(SEASON_DIR, f), "utf8"));
    assert.deepEqual(read("index.json"), SEASON_INDEX);
    for (const [t, r] of Object.entries(SEASON_RECEIPTS)) assert.deepEqual(read(`t/${t}/receipts.json`), r, t);
    assert.deepEqual(read("t/RAYS/status.json"), RAYS_STATUS);
  });
  test("the B1 header and OG carry the sentence, no Kalshi, and the published PNGs are the concept renders at X's sizes", () => {
    const dims = (f: string) => { const b = fs.readFileSync(f); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
    for (const [html, png, size] of [["header.html", "header.png", [1500, 500]], ["og.html", "og.png", [1200, 630]]] as const) {
      const src = fs.readFileSync(`site/brand-concepts/b1-thermal-receipt/${html}`, "utf8");
      assert.match(src, /coins that burn on real-world results — with receipts\./i, html);
      assert.doesNotMatch(src, /kalshi|KX[A-Z]{3,}/i, html);
      clean(visibleText(src), html);
      assert.deepEqual(dims(`site/burnticker/brand/${png}`), size, png);
      assert.ok(fs.readFileSync(`site/burnticker/brand/${png}`).equals(fs.readFileSync(`site/brand-concepts/b1-thermal-receipt/${png}`)), `${png} is the published copy of the concept render`);
    }
    assert.doesNotMatch(fs.readFileSync("site/burnticker/brand/header.svg", "utf8"), /kalshi/i, "the retired SVG kit too");
  });
  test("the app shell: footer line, the public layout's Open Graph title and description, the Seasons label", () => {
    assert.match(fs.readFileSync("src/app/burnticker/_components/SiteFooter.tsx", "utf8"), /COINS THAT BURN ON REAL-WORLD RESULTS · WITH RECEIPTS/);
    const layout = fs.readFileSync("config/public-repo/overlay/src/app/layout.tsx", "utf8");
    assert.match(layout, /const TITLE = "Burnticker — coins that burn on real-world results, with receipts"/);
    assert.match(layout, /const DESCRIPTION = "Coins that burn on real-world results — with receipts\. Launch one\. Follow the season\./);
    assert.doesNotMatch(layout, /burns on the news/i);
    clean(/const DESCRIPTION = "([^"]+)"/.exec(layout)![1], "OG description");
  });
});
