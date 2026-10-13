// THE RECEIPTS-FIRST COPY (owner-approved 2026-10-10 night): "Coins that burn on real-world results — with receipts." / "Launch one.
// Follow the season." The receipt is the product; a season is a scoreboard of burns; nothing is ever won — things are only burned.
// This suite holds every surface the re-cut touched to that line: the landing page (two doors above the fold, the guardrail strip,
// leagues rotated, no Kalshi, the copy lint on every visible word), the X profile and thread templates, the two @BurnTicker formats
// (receipt + scoreboard: exact text on a sample, the doc's filled examples equal to the output, 280 characters), the public README
// opening and the whitepaper's title line.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { OPERATOR_SHARE_LINE } from "@/lib/burnticker/feeShareLine";
import fs from "node:fs";
import { door2Html, withDoor2 } from "@/lib/burnticker/landingDoors";
import { leagueIndex } from "@/lib/burnticker/leagues";
import { NAV } from "../src/app/burnticker/_components/nav.ts";
import path from "node:path";
import { formatHits, lintCopy, loadCopyLintConfig, xLength } from "@/lib/launch/copyLint";
import { allLeaguesLine, fmtDay, fmtRange, receiptPostText, scoreboardLeagues, scoreboardText, seasonLabel, teamLeagueOf, SCOREBOARD_FOOTER, SCOREBOARD_FOOTER_FINAL, SHORT_DISCLAIMER } from "@/lib/launch/dailyPost";
import { COPY_SITE, RAYS_RECEIPTS, RAYS_STATUS, SEASON_DIR, SEASON_INDEX, SEASON_RECEIPTS, rc } from "./burntickerCopyFixture.ts";

const cfg = loadCopyLintConfig();
const clean = (t: string, what: string) => { const r = lintCopy(t, cfg); assert.ok(r.ok, `${what}:\n${formatHits(r)}`); };
const SENTENCE = "Coins that burn on real-world results — with receipts.";
const SUBLINE = "Launch one. Follow the season.";
const GUARDRAILS = ["settled on primary sources", "signed readings (one operator attester; no independent second attester is live)", "program-run burns", "receipts anyone can recompute", "open source", "three blind AI reviews, not a firm audit", "creators earn nothing", "no team buy", "the platform never buys any coin", "LP locked forever, its fees fund the burn", "rules locked at launch"];
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
  test("the hero is one line and one subline (the owner's review item 7, 2026-10-12); the title and descriptions carry it", async () => {
    const { HERO } = await import("@/lib/burnticker/siteNav.mjs");
    const h1 = /<h1 id="hero-h">([\s\S]*?)<\/h1>/.exec(html)![1].replace(/<[^>]+>/g, "");
    assert.equal(h1, HERO.title); assert.equal(HERO.title, "Memecoins that burn on real-world results.");
    assert.match(html, new RegExp(`<p class="sub">${HERO.sub.replace(/\./g, "\\.")}</p>`)); assert.equal(HERO.sub, "Every burn leaves a receipt.", "website-15 item 18");
    // audit 4 BT-21; website-13 (Claude site audit 2 item 1): the static previews carry the current headline. A static file cannot know
    // the host's launch state, so it names none (the app's previews read launchAvailability.ts at request time)
    assert.match(html, /<meta name="description" content="Memecoins that burn on real-world results\. Every burn leaves a receipt\. /);
    for (const m of html.matchAll(/<(?:meta [^>]*content="([^"]*)"|title>([^<]*)<)/g)) assert.doesNotMatch(m[1] ?? m[2] ?? "", /creator launches are|pre-launch|devnet/i, "a static preview never states the launch state or the network");
    assert.doesNotMatch(/<meta (?:name|property)="(?:description|og:description|twitter:description)" content="([^"]*)"/g.exec(html)?.[0] ?? "", /Launch one/);
  });
  test("door 2 is generated from the leagues index: every league, never NFL-first, soccer included, no drift", () => {
    assert.equal(html, withDoor2(html), "site/burnticker/index.html door 2 differs from the leagues index: run scripts/burnticker-door2.mts");
    const block = door2Html();
    assert.doesNotMatch(block, /MLB, NBA, NHL, NFL|NFL 2026/, "no hand-written league list");
    assert.match(block, /soccer/); assert.match(block, new RegExp(`The ${leagueIndex([], Date.now()).totals.leagues} leagues cover`));
    assert.ok(!/^[^.]*\bNFL\b/.test(block.split('<p class="ex">')[1] ?? ""), "the sports line does not open on the NFL");
  });

  // website-10 (2026-10-12, the owner's review items 1, 8, 12, 15): hero, How it works, the coin grid (featured cards from the API), Follow
  // the season, a short current status. The Launch / Seasons / $DEFICIT product cards are gone: $DEFICIT is the first featured card, the
  // launch explanation moved to /burnticker/about, Seasons is the preview strip.
  test("list first: hero, How it works, the coin grid read from the home API, Follow the season, the short status; each link goes to a page that exists", () => {
    const at = (m: string) => { const i = html.indexOf(m); assert.ok(i >= 0, m); return i; };
    const order = ['<h1 id="hero-h">', '<ol class="how">', 'id="coins"', 'data-featured', 'id="seasons"', 'id="status"'].map(at);
    assert.deepEqual([...order].sort((x, y) => x - y), order);
    assert.match(html, /fetch\("\/api\/burnticker\/home", \{ cache: "no-store" \}\)/, "the cards come from the API, never typed into the page");
    assert.doesNotMatch(html, /<article class="card/, "no card is hand-written");
    assert.match(html, /<a class="go" href="\/burnticker\/leagues">Leagues<\/a>/);
    for (const f of ["src/app/burnticker/launch/page.tsx", "src/app/burnticker/leagues/page.tsx", "src/app/burnticker/about/page.tsx"]) assert.ok(fs.existsSync(f), f);
    assert.equal(NAV.find((n) => n.label === "Seasons")?.href, "/burnticker/leagues", "the Seasons strip and the nav land on the same page");
    assert.match(html, /\.grid\{display:grid;grid-template-columns:1fr;/, "one column on a phone");
  });
  test("review 2 §2 and brief rule 1: the launch button opens the closed-launches dialog unless the host's catalogue says open (fail closed); no date, no waitlist", async () => {
    const { LAUNCH_CLOSED, LAUNCH_LABELS } = await import("@/lib/burnticker/siteNav.mjs");
    assert.match(html, /<a class="sh-launch" href="\/burnticker\/launch" data-launch-button>Launch a coin<\/a>/);
    assert.equal(LAUNCH_LABELS.button, "Launch a coin");
    // website-13: the site launch record (website-12's SiteLaunchState) through the home API decides; unreadable = the dialog
    assert.match(html, /fetch\("\/api\/burnticker" \+ "\/home", \{ cache: "no-store" \}\)[\s\S]*open = !!\(l && l\.wizard === true\)/);
    assert.match(html, /if \(open\) return; e\.preventDefault\(\); dlg\.showModal\(\);/);
    assert.ok(html.includes(`<p data-launch-sentence>${LAUNCH_CLOSED.body}</p>`)); assert.match(LAUNCH_CLOSED.body, /^Checking whether creator launches are open/, "the record's loading sentence until the read lands");
    assert.doesNotMatch(html, /type="email"|waitlist|countdown/i);
    // the nav says "Launch" in every state; the old "Launch · closed" label is gone
    assert.doesNotMatch(html, /Launch · closed/);
  });
  test("the eleven guardrails, in order, moved to the trust page (site audit #7); the homepage carries none of them", async () => {
    const { GUARDRAILS: G } = await import("@/lib/burnticker/safeguards");
    assert.deepEqual([...G], GUARDRAILS);
    assert.doesNotMatch(html, /<ul class="guard"|The eleven guardrails/);
    assert.match(fs.readFileSync("src/app/burnticker/trust/SafeguardsSection.tsx", "utf8"), /GUARDRAILS\.map/);
    assert.match(fs.readFileSync("src/app/burnticker/trust/page.tsx", "utf8"), /<SafeguardsSection card=\{card\} \/>/);
  });
  test("every league, no league first: no list of leagues starts with the NFL; no ESPN source", () => {
    for (const l of leagueLists(text)) assert.notEqual(l[0], "NFL", l.join(" "));
    // website brief §4: no ESPN reads
    assert.doesNotMatch(html.replace(/No ESPN reads\./g, ""), /ESPN/, "no ESPN source on the landing page");
  });
  test("sources: Kalshi is never named; Polymarket only as the on-chain payout; prediction markets are for discovery", async () => {
    assert.doesNotMatch(html, /kalshi|KX[A-Z]{3,}/i);
    assert.doesNotMatch(text, /Polymarket payout|POLYGON PAYOUT/);
    // the source admission rules moved to the trust page with the safeguards (site audit #7)
    const { ADMISSION_RULES } = await import("@/lib/burnticker/safeguards");
    assert.match(ADMISSION_RULES, /on-chain payout of an adjudicated Polymarket market/);
    assert.match(ADMISSION_RULES, /Prediction markets are for discovery/);
    assert.doesNotMatch(ADMISSION_RULES, /kalshi/i);
  });
  test("nothing is invented: Derby appears only once its page exists; no 'coming soon'; the champion is a stat", () => {
    if (!fs.existsSync(path.join("src", "app", "burnticker", "derby", "page.tsx"))) assert.doesNotMatch(text, /derby/i);
    else assert.match(html, /href="\/burnticker\/derby"/, "the Derby index exists on main: Seasons links it");
    assert.doesNotMatch(text, /coming soon/i);
    // ChatGPT audit 6 A11: "Season titles are for the scoreboard only. There are no prizes."
    assert.match(text, /When a league's season ends, the coin with the most receipts is named its champion\. Season titles are for the scoreboard only\. There are no prizes\./);
    assert.match(text, /Nothing is ever won\. Things are only burned\./, "the footer receipt carries it (brief rule 5)");
  });
  test("Seasons: no illustrative scoreboards on the homepage any more (site audit #7); the leagues page keeps its labelled example", () => {
    assert.doesNotMatch(html, /<div class="board">|class="tape"|Illustrative example/);
    const l = fs.readFileSync("src/app/burnticker/leagues/page.tsx", "utf8");
    assert.match(l, /Example only\. These coins and counts are not live data\./);
  });
  test("the cold read's edits (docs/launch/gtm/COLD-READ.md): the one-line definition stays; the safeguards it asked for moved to the trust page", async () => {
    // UX report 3 item 10: the definition's words are unchanged; since 2026-10-12 they open the about page (the explainer moved there)
    const about = fs.readFileSync("src/app/burnticker/about/page.tsx", "utf8");
    assert.ok(about.includes("Burnticker is a launchpad for Solana memecoins. Each coin has one locked rule. When the rule&apos;s result settles, the coin&apos;s own trading fees buy it back on its own pool, and a program burns what they bought. The transaction is the receipt."));
    const { SAFEGUARDS, WHO_GETS_WHAT } = await import("@/lib/burnticker/safeguards");
    const sg = SAFEGUARDS.map((x) => x.text).join(" "), wg = WHO_GETS_WHAT.map((x) => x.text).join(" ");
    assert.match(sg, /a short list of up to three approved accounts can be required instead, for at most 90 days/);
    assert.match(sg, /If the operator stops, readings stop and burns stop\. Holders keep their coins/);
    assert.ok(wg.includes(`After a coin moves to its trading pool, the liquidity is locked forever. ${OPERATOR_SHARE_LINE}`), "the operator's share is led by the whole swap (fees copy, 2026-10-12)");
    for (const t of [sg, wg]) clean(t, "safeguards");
    for (const gone of [/anyone can crank/i, /if we disappear/i, /keep working/i, /set to none after review/i, /not built yet/i, /within 14 days/i, /nothing to trust/i, /<li>reviewed<\/li>/]) { assert.doesNotMatch(html, gone, String(gone)); assert.doesNotMatch(sg + wg, gone, String(gone)); }
  });
  test("mobile-safe and linked: viewport meta, no horizontal scroll, the whitepaper linked", () => {
    assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
    assert.match(html, /body\{[^}]*overflow-x:hidden/);
    assert.match(html, /href="\/whitepaper\.html"/, "the Learn menu and the footer link the whitepaper");
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
  test("the app shell: footer line, the public layout's Open Graph title and description, the Seasons label", async () => {
    assert.match(fs.readFileSync("src/app/burnticker/_components/SiteFooter.tsx", "utf8"), /COINS THAT BURN ON REAL-WORLD RESULTS · WITH RECEIPTS/);
    const layout = fs.readFileSync("config/public-repo/overlay/src/app/layout.tsx", "utf8");
    // audit 4 BT-21, made phase-aware 2026-10-11; website-13 (Claude site audit 2 item 1): the previews carry the current headline and
    // the launch state in launchAvailability.ts's own words, read at request time. The layout types neither "open" nor "closed".
    // spelled as two strings so the publish script's import scanner does not read this assertion as an import
    assert.ok(layout.includes("import { META_TITLE as TITLE, metaDescription } " + 'from "@/lib/burnticker/siteMeta";'), "layout imports the shared meta helpers");
    assert.match(layout, /const description = metaDescription\(process[.]env\);/);
    assert.doesNotMatch(layout.replace(/^\s*(\/\/|\*|\/\*).*$/gm, ""), /launches are (open|closed)|DESCRIPTION_(OPEN|CLOSED)/i);
    const { META_TITLE, metaDescription } = await import("@/lib/burnticker/siteMeta");
    const { CREATOR_LAUNCHES_CLOSED } = await import("@/lib/burnticker/creatorLaunches");
    const { PREVIEW_BANNER, siteLaunchState } = await import("@/lib/burnticker/launchAvailability");
    assert.equal(META_TITLE, "Burnticker: Memecoins that burn on real-world results");
    const closed = metaDescription({}), preview = metaDescription({ BURNTICKER_CREATOR_LAUNCHES_PREVIEW: "1" }), open = metaDescription({ BURNTICKER_CREATOR_LAUNCHES_ENABLED: "1" });
    for (const d of [closed, preview, open]) assert.match(d, /^Memecoins that burn on real-world results\. Every burn leaves a receipt\. /);
    assert.ok(closed.endsWith(CREATOR_LAUNCHES_CLOSED), closed); assert.doesNotMatch(closed, /Launch one|launch a/i);
    assert.ok(preview.endsWith(PREVIEW_BANNER), preview);
    assert.ok(open.endsWith(siteLaunchState({ BURNTICKER_CREATOR_LAUNCHES_ENABLED: "1" }).sentence), open);
    assert.doesNotMatch(layout, /burns on the news/i);
    clean(closed, "OG description (closed)"); clean(preview, "OG description (preview)"); clean(open, "OG description (open)");
  });
});
