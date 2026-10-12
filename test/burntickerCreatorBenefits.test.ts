// WEBSITE-17 (2026-10-12; CREATOR-BENEFITS-BRIEF.md): non-cash creator benefits. The rank line, the stated featured-placement rules,
// the creator-page and analytics words, the benefits list and the example tickets. Every sentence passes the copy lint; every example
// ticket names a real source id and never claims to launch what the wizard cannot build today.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { formatHits, lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import { ordinal, rankLines, receiptsThisWeek, weeklySummary, WEEK_MEANING } from "@/lib/burnticker/coinRank";
import { FEATURED_LABELS, FEATURED_RULES_LINE, featuredSlots, type FeaturedInput } from "@/lib/burnticker/featuredSlots";
import { ANALYTICS_COPY, CREATOR_BENEFITS, CREATOR_BENEFITS_TITLE, CREATOR_PAGE, SHARE_COPY, createdBy, creatorHref } from "@/lib/burnticker/creatorBenefits";
import { EXAMPLE_TAG, EXAMPLE_TICKETS, EXAMPLES_AFFILIATION, EXAMPLES_AND_BENEFITS_LABEL, EXAMPLES_INTRO, NOT_OFFERED, exampleStrings } from "@/lib/burnticker/exampleTickets";
import { RANK_MEANING, cardViewFromIndex, type IndexCoin } from "@/lib/burnticker/cardView";
import { loadSourceEntries } from "@/lib/burnticker/catalogue";
import { LIVE_ORACLES, type BurnRule } from "@/lib/burnticker/rules";
import { TEMPLATE_START } from "@/lib/burnticker/templates";
import type { SeasonCoinInput } from "@/lib/burnticker/seasons";
import { nativeRule } from "@/lib/burnticker/sources/native";
import { teamSeries, type LeagueId, type Window } from "@/lib/burnticker/sources/espn";

const cfg = loadCopyLintConfig();
const clean = (t: string, what: string) => { const r = lintCopy(t, cfg); assert.ok(r.ok, `${what}:\n${formatHits(r)}`); };
const NOW = Date.parse("2026-10-20T12:00:00Z");
const day = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

const team = (ticker: string, lg: LeagueId, abbr: string, w: Window, burns: number): SeasonCoinInput => ({ ticker, mint: `M${ticker}`, rule: nativeRule(teamSeries(lg, abbr, "win", w)), burns: Array.from({ length: burns }, (_, i) => ({ settledAt: day(i + 1) })), burnedPct: burns / 10, ended: false });
const other = (ticker: string, burns: number): SeasonCoinInput => ({ ticker, mint: `M${ticker}`, rule: { oracle: "polymarket", series: null } as unknown as BurnRule, burns: Array.from({ length: burns }, (_, i) => ({ settledAt: day(i * 3 + 1) })), burnedPct: 0, ended: false });

describe("item 2: the rank line, read from the registry rows", () => {
  test("ordinals", () => {
    assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111].map(ordinal), ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "101st", "111th"]);
  });
  test("non-season coins: N receipts, the Kth most on this site; ties said as ties; none says no rank", () => {
    const r = rankLines([other("AAA", 5), other("BBB", 3), other("CCC", 3), other("DDD", 1), other("EEE", 0)]);
    assert.equal(r.get("AAA")!.line, "5 receipts, the most on this site.");
    assert.equal(r.get("BBB")!.line, "3 receipts, tied for the 2nd most on this site.");
    assert.equal(r.get("CCC")!.line, "3 receipts, tied for the 2nd most on this site.");
    assert.equal(r.get("DDD")!.line, "1 receipt, the 4th most on this site.");
    assert.equal(r.get("EEE")!.line, "No receipts yet, so it has no rank on this site.");
    assert.equal(r.get("EEE")!.rank, null);
    for (const v of r.values()) clean(v.line, v.ticker);
  });
  test("a coin in a season is ranked inside its own league and season (seasons.ts), never across leagues", () => {
    const MLB = { kind: "season", year: 2026 } as Window, NHL = { kind: "season", year: 2027 } as Window;
    const coins = [team("RAYS26", "mlb", "TB", MLB, 4), team("YANKEES26", "mlb", "NYY", MLB, 6), team("OILERS27", "nhl", "EDM", NHL, 9), team("RAYS", "mlb", "TB", { kind: "perpetual" }, 2), other("DEBT", 9)];
    const r = rankLines(coins);
    assert.equal(r.get("YANKEES26")!.line, "Ranked 1 of 2 in MLB 2026 by receipts.");
    assert.equal(r.get("RAYS26")!.line, "Ranked 2 of 2 in MLB 2026 by receipts.");
    assert.equal(r.get("OILERS27")!.line, "Ranked 1 of 1 in NHL 2026–27 by receipts.");
    assert.equal(r.get("RAYS26")!.season, "MLB 2026");
    // a team coin with no season window, and a feed coin, are counted against every registered coin by their own receipts
    assert.equal(r.get("RAYS")!.line, "2 receipts, the 5th most on this site.");
    assert.equal(r.get("DEBT")!.line, "9 receipts, tied for the most on this site.");
    for (const v of r.values()) clean(v.line, v.ticker);
  });
  test("receipts this week and the copyable weekly summary", () => {
    assert.equal(receiptsThisWeek([{ settledAt: day(1) }, { settledAt: day(6.9) }, { settledAt: day(7.1) }, { settledAt: "nonsense" }], NOW), 2);
    const r = rankLines([other("AAA", 5), other("BBB", 2)]);
    const s = weeklySummary("BBB", 2, r.get("BBB")!);
    assert.equal(s, "$BBB this week: 2 receipts. 2 receipts, the 2nd most on this site.");
    clean(s, "weekly summary");
    clean(weeklySummary("BBB", 1, null), "weekly summary without a rank");
    clean(WEEK_MEANING, "week meaning");
    clean(RANK_MEANING, "rank meaning");
  });
  test("the card carries the rank line the serving route read, and nothing when none was read", () => {
    const base: IndexCoin = { ticker: "AAA", name: "A", mint: "M", oneLiner: "burns once", status: "live", imageUrl: null, burned: "0", burns: 0, nextCheckAt: null, nextCloseTime: null, lastBurnAt: null, launchedAt: null, pairId: null, phase: null, progressPct: null };
    assert.equal(cardViewFromIndex({ ...base, rank: "5 receipts, the most on this site." }, null).rank, "5 receipts, the most on this site.");
    assert.equal(cardViewFromIndex(base, null).rank, null);
  });
});

describe("item 3: earned featured placement, by written rules only", () => {
  const c = (ticker: string, o: Partial<FeaturedInput> = {}): FeaturedInput => ({ ticker, group: "public", burns: [], createdAt: day(30), poolRegistered: false, ...o });
  test("the three rules in order, one coin each, each slot labelled with its reason", () => {
    const slots = featuredSlots([
      c("WEEKLY", { burns: [{ settledAt: day(1) }, { settledAt: day(2) }, { settledAt: day(3) }], poolRegistered: true }),
      c("LATEST", { burns: [{ settledAt: day(0.1) }], poolRegistered: true }),
      c("NEWPOOL", { createdAt: day(1), poolRegistered: true }),
      c("OLDPOOL", { createdAt: day(20), poolRegistered: true }),
    ], NOW);
    assert.deepEqual(slots.map((s) => [s.label, s.ticker]), [["Most receipts this week", "WEEKLY"], ["Most recent confirmed burn", "LATEST"], ["Newest coin with a registered pool", "NEWPOOL"]]);
  });
  test("no filler: a rule nobody meets leaves its slot out; $DEFICIT, test coins and unread pools never take one", () => {
    const slots = featuredSlots([
      c("DEFICIT", { burns: [{ settledAt: day(1) }], poolRegistered: true }),
      c("REHEARSAL", { group: "test", burns: [{ settledAt: day(1) }], poolRegistered: true }),
      c("UNREAD", { poolRegistered: null, createdAt: day(0.5) }),
      c("OLD", { burns: [{ settledAt: day(9) }] }),
    ], NOW);
    assert.deepEqual(slots.map((s) => [s.rule, s.ticker]), [["latest-burn", "OLD"]]);
    assert.deepEqual(featuredSlots([], NOW), []);
  });
  test("ties: the newer burn first, then the ticker in alphabetical order", () => {
    const slots = featuredSlots([c("BBB", { burns: [{ settledAt: day(2) }] }), c("AAA", { burns: [{ settledAt: day(2) }] }), c("CCC", { burns: [{ settledAt: day(1) }] })], NOW);
    assert.equal(slots[0].ticker, "CCC");
    assert.equal(slots[1].ticker, "AAA");
  });
  test("the labels and the rules sentence are lint-clean and say nobody can pay or pick", () => {
    for (const l of Object.values(FEATURED_LABELS)) clean(l, "label");
    clean(FEATURED_RULES_LINE, "rules line");
    assert.match(FEATURED_RULES_LINE, /Nobody can pay for a place, and nobody picks one by hand\./);
  });
});

describe("items 1, 4, 5, 6: the creator page, share block, analytics and benefits words", () => {
  const all = [createdBy("Ab12…cd34"), CREATOR_BENEFITS_TITLE, ...CREATOR_BENEFITS, CREATOR_PAGE.title("Ab12…cd34"), CREATOR_PAGE.description, CREATOR_PAGE.intro, CREATOR_PAGE.empty, CREATOR_PAGE.unavailable, CREATOR_PAGE.badWallet, CREATOR_PAGE.creatorText, CREATOR_PAGE.noBurn, CREATOR_PAGE.noNext, ...Object.values(CREATOR_PAGE.labels), ...Object.values(SHARE_COPY), ...Object.values(ANALYTICS_COPY)];
  test("every sentence passes the copy lint", () => { for (const s of all) clean(s, s); assert.equal(creatorHref("Ab12"), "/burnticker/creator/Ab12"); });
  test("nothing reads as a reward, a prize or income; the benefits list has no superlatives", () => {
    for (const s of all) assert.doesNotMatch(s, /\b(reward|prize|earn|income|best|top|greatest|exclusive|bonus)\b/i, s);
    assert.equal(CREATOR_BENEFITS.length, 4);
  });
  test("counts this site does not keep are said plainly, never shown as zero", () => {
    assert.match(ANALYTICS_COPY.viewsNone, /^Not counted\./);
    assert.match(ANALYTICS_COPY.followsNone, /browser/);
  });
  test("the page files read their words from the copy module", () => {
    const page = fs.readFileSync("src/app/burnticker/creator/[wallet]/page.tsx", "utf8");
    assert.match(page, /CREATOR_PAGE\.title\(shortAddress/);
    const me = fs.readFileSync("src/app/burnticker/me/page.tsx", "utf8");
    assert.match(me, /st\.source === "connected"/, "the numbers show for a connected wallet only");
    assert.match(me, /ANALYTICS_COPY\.viewsNone/);
    const tpl = fs.readFileSync("src/app/burnticker/templates/page.tsx", "utf8");
    assert.ok(tpl.indexOf("<CreatorOnboarding") < tpl.indexOf("<CreatorBenefitsList"), "the benefits list follows the no-fee-revenue line");
  });
});

describe("item 7: the example tickets", () => {
  const ids = new Set(loadSourceEntries().map((e) => (e as { id: string }).id));
  const tile = fs.readFileSync("src/app/burnticker/launch/CoinVsCoinTile.tsx", "utf8");
  test("every sentence is lint-clean", () => {
    for (const e of EXAMPLE_TICKETS) for (const s of exampleStrings(e)) clean(s, `${e.ticker}: ${s}`);
    for (const s of [EXAMPLE_TAG, EXAMPLES_INTRO, EXAMPLES_AFFILIATION, EXAMPLES_AND_BENEFITS_LABEL]) clean(s, s);
  });
  test("each names its source: a catalogue id in sources.json, or the Polymarket adapter; no source means not offered", () => {
    for (const e of EXAMPLE_TICKETS) {
      if (e.source?.kind === "catalogue") assert.ok(ids.has(e.source.id), `${e.ticker}: ${e.source.id} is not in sources.json`);
      else if (e.source?.kind === "oracle") assert.ok(LIVE_ORACLES.includes(e.source.id), `${e.ticker}: ${e.source.id} is not a live adapter`);
      else assert.equal(e.opens, null, `${e.ticker} has no source, so it cannot open a wizard path`);
      assert.ok(e.sourceLine.split(" ").length <= 3 && !/[.]/.test(e.sourceLine), `${e.ticker}: the source in two or three words`);
    }
    assert.equal(EXAMPLE_TICKETS.find((e) => e.ticker === "TSLAvAAPL")!.source!.id, "pyth.equity");
    assert.equal(EXAMPLE_TICKETS.find((e) => e.ticker === "SOLvETH")!.source!.id, "pyth.crypto");
    // the post-count tickets settle only on Polymarket's payouts: no Truth Social source exists or is named as one
    for (const e of EXAMPLE_TICKETS) assert.doesNotMatch(e.source?.id ?? "", /truth/i);
  });
  test("never claims to launch what the wizard cannot build: an open link goes to a path that exists and says what it cannot do", () => {
    for (const e of EXAMPLE_TICKETS) {
      assert.ok((e.opens === null) !== (e.notOffered === null), `${e.ticker}: exactly one of opens / notOffered`);
      if (e.notOffered) assert.ok(e.notOffered.startsWith(NOT_OFFERED), e.ticker);
      if (!e.opens) continue;
      for (const href of [e.opens.href, ...(e.opens.also ?? []).map((a) => a.href)]) {
        const u = new URL(href, "https://x");
        assert.equal(u.pathname, "/burnticker/launch");
        if (u.searchParams.get("derby") === "1") { assert.match(tile, /u\.get\("derby"\) === "1"/); assert.ok(u.searchParams.get("a") && u.searchParams.get("b")); }
        else assert.ok(u.searchParams.get("template")! in TEMPLATE_START, `${e.ticker}: ${href}`);
      }
      // the Coin vs Coin screen builds daily windows only, so a weekly ticket that opens it says the weekly version is not offered
      if (e.type === "derby" && /weekly/i.test(e.name)) { assert.match(tile, /const window_ = "daily"/); assert.match(e.opens.line, /weekly version is not offered yet/); }
    }
    // pairs of two different markets and the jobs number have no path today
    for (const t of ["TSLAvAAPL", "JOBS", "POSTS", "WEEKEND"]) assert.equal(EXAMPLE_TICKETS.find((e) => e.ticker === t)!.opens, null, t);
  });
  test("public figures and companies carry the no-affiliation line", () => {
    for (const e of EXAMPLE_TICKETS) if (/Trump|Elon|Tesla|Apple|Truth Social/.test(`${e.name} ${e.rule} ${e.sourceLine}`)) assert.match(e.affiliation ?? "", /^This example is not affiliated with /, e.ticker);
  });
  test("website-18 brief cards: the ticker, the name, one short rule sentence, the source in a few words and the tag; nothing else", () => {
    for (const e of EXAMPLE_TICKETS) {
      assert.ok(e.rule.split(/\s+/).length <= 12, `${e.ticker}: ${e.rule}`);
      assert.equal((e.rule.match(/[.!?](\s|$)/g) ?? []).length, 1, `${e.ticker}: one sentence`);
    }
    const card = fs.readFileSync("src/app/burnticker/templates/ExampleTickets.tsx", "utf8");
    assert.doesNotMatch(card, /ViewCard|e\.notOffered|e\.affiliation|PREREQUISITE|next/, "no next-result line, no prerequisite, no per-card reason or affiliation");
    assert.match(card, /\{EXAMPLE_TAG\}/); assert.match(card, /\{SOURCE_LABEL\}: \{e\.sourceLine\}/); assert.match(card, /\{EXAMPLES_INTRO\} \{EXAMPLES_AFFILIATION\}/);
  });
});
