// THE LAUNCH-INTENT AUDIT 5 (ChatGPT, 2026-10-12), the library items: 1 invisible-only names, 2 the 32-byte metadata name limit, 6 a second
// condition, 7 a count of wins, 8 the regular season only, 9 a women's team, 10 on-chain facts labelled as markets, 13 "https://?" as a link.
// Each case failed before the fix (recorded in the hand-off report) and passes after it.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { nameProblem, utf8Bytes, visibleText, NAME_MAX_BYTES } from "@/lib/burnticker/launchFields";
import { launchProblems, type LaunchInput } from "@/lib/burnticker/launchBundle";
import { creatorLinks, isWebLink } from "@/lib/burnticker/creatorProfile";
import { buildLaunchReview } from "@/lib/burnticker/launchReview";
import { catalogueSources } from "@/lib/burnticker/api/handlers";
import { sourceTypeLabel, TIER_LABEL } from "@/lib/burnticker/sources/types";
import { onchainSource } from "@/lib/burnticker/sources/onchain";
import { universalSearch } from "@/lib/burnticker/search";
import { clausesOf, compoundSentence, milestoneOf, milestoneSentence, regularSeasonOnly, REGULAR_SEASON_SENTENCE, womenSentence } from "@/lib/burnticker/teamQuery";
import { findTeams } from "@/lib/burnticker/sources/espn";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import { espnFixtureClient, ESPN_NOW } from "./burntickerFirstPartyHelpers.ts";

const cfg = loadCopyLintConfig();
const lint = (t: string) => { const r = lintCopy(t, cfg); assert.ok(r.ok, `${r.hits.map((h) => `${h.phrase} (${h.rule})`).join(", ")}\n${t}`); };
const plain = (t: string) => { lint(t); assert.doesNotMatch(t, /\bwill\b/i, t); assert.doesNotMatch(t, /\b20\d{2}-\d{2}-\d{2}\b/, t); };
const input = (o: Partial<LaunchInput> = {}): LaunchInput => ({ creator: "11111111111111111111111111111111", ticker: "ROCKET", name: "Rocket", description: "", imageUrl: null, links: [], rule: {}, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true }, cluster: "devnet", ...o } as LaunchInput);
const nameIssues = (name: string) => launchProblems(input({ name })).filter((p) => /name/i.test(p));
const linkIssues = (url: string) => launchProblems(input({ links: [{ label: "Website", url }] })).filter((p) => /link/i.test(p));

describe("items 1 and 2: a name needs visible characters and fits 32 bytes of UTF-8", () => {
  const ZW2 = "​​";
  test("two zero-width spaces (and other invisible-only names) are refused on the page, the review and the bundle", () => {
    const s = "The name has no visible characters. Use letters, digits or symbols a person can see.";
    for (const n of [ZW2, "‍⁠", "﻿‎‏", "ㅤㅤ", "⠀⠀", " ​ ‌ "]) {
      assert.equal(nameProblem(n), s, JSON.stringify(n));
      assert.deepEqual(nameIssues(n), [s], JSON.stringify(n));
    }
    // ChatGPT audit 6 item 9: a zero-width character beside visible ones is refused as an invisible character
    assert.equal(nameProblem("A​"), "The name has a line break, tab, invisible or text-direction character. Use plain letters, digits, spaces and punctuation.");
    assert.equal(nameProblem("A"), "The name needs at least 2 visible characters.");
    plain(s);
  });
  test("legitimate Unicode passes: accents, CJK, Cyrillic, emoji with joiners", () => {
    for (const n of ["Café Olé", "Zoë Müller", "火箭", "東京タワー", "Ракета", "🚀 Moon", "👩‍🚀 Crew", "Señor Ñandú"]) {
      assert.equal(nameProblem(n), "", n); assert.deepEqual(nameIssues(n), [], n);
    }
    assert.equal(visibleText("👩‍🚀"), "👩🚀");
  });
  test("the byte boundary: 32 bytes pass, 33 are refused with the count, and nothing is truncated", () => {
    const at = "é".repeat(16), over = `${"é".repeat(16)}a`, rockets = "🚀".repeat(12);
    assert.equal(utf8Bytes(at), NAME_MAX_BYTES); assert.equal(at.length, 16);
    assert.equal(nameProblem(at), ""); assert.deepEqual(nameIssues(at), []);
    assert.equal(nameProblem("a".repeat(32)), ""); assert.match(nameProblem("a".repeat(33)), /^The name takes 33 bytes/);
    assert.equal(nameProblem(over), "The name takes 33 bytes, and a coin's name can take at most 32. Letters A to Z and digits take 1 byte each, while accented letters, other scripts and emoji take 2 to 4.");
    assert.equal(rockets.length, 24); assert.match(nameProblem(rockets), /^The name takes 48 bytes/); assert.match(nameIssues(rockets)[0], /48 bytes/);
    assert.equal(nameProblem("火".repeat(10)), ""); assert.match(nameProblem("火".repeat(11)), /33 bytes/);
    // the measure is of the trimmed name, which is what the bundle and the metadata pin carry
    assert.equal(nameProblem(`  ${at}  `), "");
    plain(nameProblem(over));
  });
  test("the read-only review refuses the same names with the same sentences", () => {
    const rule = { schema: "burnticker.rules/v1", oracle: "catalogue", series: "treasury.debt", market: null, filter: {}, kind: "scalar", scalar: { unit: 1_000_000_000, perUnit: { fractionOfPool: 0.02 }, baseline: "previousSettlement", direction: "up" }, binary: null, onVoid: "skip", floorUsd: "1", reserveSol: "0.02", vault: null };
    const probs = (name: string) => { const r = buildLaunchReview({ rule, ticker: "DEBT", name }, { env: {}, reserved: new Set() }); return ("review" in r ? r.review.problems : r.problems).filter((p) => /name/i.test(p)); };
    assert.deepEqual(probs(ZW2), [nameProblem(ZW2)]);
    assert.deepEqual(probs("火".repeat(11)), [nameProblem("火".repeat(11))]);
    assert.deepEqual(probs("火箭"), []);
  });
  // the LaunchLab plan's own byte check (burnKeeper/launch.ts planLaunch) is tested in test/burnKeeperLaunch.test.ts
});

describe("item 13: links are parsed, https only, with a real host name", () => {
  test("the four cases on the page and the server", () => {
    const cases: [string, boolean, string | null][] = [
      ["https://?", false, "The Website link is not a full web address. Use one like https://example.com."],
      ["https://x", false, "The Website link is not a full web address. Use one like https://example.com."],
      ["https://x.com", true, null],
      ["http://x.com", false, "The Website link has to start with https:// and have no spaces."],
    ];
    for (const [u, ok, sentence] of cases) {
      assert.equal(isWebLink(u), ok, u);
      assert.deepEqual(creatorLinks({ website: u }).problems, sentence ? [sentence] : [], u);
      assert.equal(linkIssues(u).length, ok ? 0 : 1, u);
      if (sentence) plain(sentence);
    }
  });
  test("more shapes: credentials, a trailing dot, a bare IP, an IDN and a path pass or fail as expected", () => {
    for (const u of ["https://user:pw@x.com", "https://x.", "https://.com", "https://1.2.3.4", "https://localhost/a", "https://x .com"]) assert.equal(isWebLink(u), false, u);
    for (const u of ["https://t.me/burnticker", "https://x.com/a?b=1#c", "https://münchen.de", "https://sub.example.co.uk/path"]) assert.equal(isWebLink(u), true, u);
    assert.equal(launchProblems(input({ imageUrl: "https://?" })).includes("imageUrl must be an https URL or null"), true);
  });
});

describe("item 10: the trust rank is not the source type", () => {
  test("Solana block height and slot stay tier 1 and are labelled on-chain consensus state", () => {
    const oc = catalogueSources(ESPN_NOW).sources.filter((s) => s.kind === "onchain");
    assert.equal(oc.length, 2);
    for (const s of oc) { assert.equal(s.tier, 1); assert.equal(s.tierLabel, "on-chain consensus state"); }
    assert.equal(sourceTypeLabel(onchainSource("solana.slot", null)), "on-chain consensus state");
    assert.equal(sourceTypeLabel({ kind: "market", tier: 1 }), TIER_LABEL[1]);
    assert.equal(sourceTypeLabel({ kind: "attested-http", tier: 4 }), "keeper-read primary API");
  });
});

describe("items 6 to 9: what a team query asks beyond every win", () => {
  const deps = { venues: { kalshi: false, polymarket: false, feeds: true }, feeds: [], espn: espnFixtureClient(), polyGet: null, refuse: () => [], kalshiSearch: null, derbyHref: null, nowMs: ESPN_NOW } as never;
  const quiet = async <T>(f: () => Promise<T>): Promise<T> => { const w = console.warn; console.warn = () => {}; try { return await f(); } finally { console.warn = w; } };
  test("6: 'Lakers win and Celtics lose' follows the Lakers' wins, names the part left out, and every card is a partial alternative", async () => {
    const r = await quiet(() => universalSearch("Lakers win and Celtics lose", deps));
    const s = "A coin follows one condition, so “Celtics lose” is left out. These cards follow only “Lakers win”, so each is a partial alternative.";
    assert.match(r.cards[0].title, /^Burns 2% every time the Lakers win a game/);
    for (const c of r.cards) { assert.equal(c.alternative, true); assert.equal(c.partial, true); assert.ok(c.note?.startsWith(s), c.note ?? ""); assert.doesNotMatch(c.title, /Celtics/); }
    plain(s);
    assert.equal(compoundSentence({ kept: "Lakers win", dropped: ["Celtics lose", "Knicks win"] }), "A coin follows one condition, so “Celtics lose” and “Knicks win” are left out. These cards follow only “Lakers win”, so each is a partial alternative.");
  });
  test("6: one condition stays exact, and a team name that holds '&' is not split", async () => {
    const r = await quiet(() => universalSearch("Lakers win", deps));
    assert.equal(r.cards[0].alternative ?? false, false); assert.equal(r.cards[0].partial ?? false, false);
    const t = findTeams("Brighton & Hove Albion win");
    if (t.some((x) => /&/.test(x.name) || x.alt.some((a) => /&/.test(a)))) assert.equal(clausesOf("Brighton & Hove Albion win", t).length, 1);
  });
  test("7: 'Lakers win 10 games this season' says no count rule exists before the per-win card", async () => {
    const r = await quiet(() => universalSearch("Lakers win 10 games this season", deps));
    const s = "There is no rule that waits for a team to reach a number of wins, such as 10 wins. This card burns on every win instead, so it is an alternative.";
    const rec = r.cards.find((c) => c.shape === "recurring")!;
    assert.equal(rec.alternative, true); assert.ok(rec.note?.startsWith(s), rec.note ?? "");
    assert.ok(r.cards.every((c) => c.alternative));
    assert.equal(milestoneOf("Lakers reach 50 wins"), 50); assert.equal(milestoneOf("Lakers win the next 5 games"), null); assert.equal(milestoneOf("Lakers win the 2027 title"), null);
    assert.equal(milestoneSentence(3, "loss"), "There is no rule that waits for a team to reach a number of losses, such as 3 losses. This card burns on every loss instead, so it is an alternative.");
    plain(s); plain(milestoneSentence(3, "loss"));
  });
  test("8: 'regular season wins only, exclude playoffs' says the cards count playoff games; a league with no playoffs says nothing", async () => {
    const r = await quiet(() => universalSearch("Lakers regular season wins only, exclude playoffs", deps));
    const rec = r.cards.find((c) => c.shape === "recurring")!;
    assert.equal(rec.alternative, true); assert.ok(rec.note?.startsWith(REGULAR_SEASON_SENTENCE), rec.note ?? "");
    assert.equal(REGULAR_SEASON_SENTENCE, "There is no team rule that leaves out the playoffs. This card also counts playoff games, so it is an alternative.");
    assert.doesNotMatch(rec.note ?? "", /left out\./, "the scope phrase is not read as a second condition");
    for (const q of ["Lakers wins, no playoffs", "Lakers wins excluding the postseason", "Lakers regular-season wins"]) assert.equal(regularSeasonOnly(q), true, q);
    const soccer = await quiet(() => universalSearch("Arsenal regular season wins", deps));
    assert.equal(soccer.cards.find((c) => c.shape === "recurring")?.note?.includes(REGULAR_SEASON_SENTENCE) ?? false, false);
    plain(REGULAR_SEASON_SENTENCE);
  });
  test("9: 'Arsenal Women win' says the women's team is not covered instead of passing off the men's team", async () => {
    const r = await quiet(() => universalSearch("Arsenal Women win", deps));
    const s = womenSentence("Arsenal");
    assert.equal(s, "Burnticker does not cover the women's team of Arsenal. These cards are for the men's team, so each is an alternative.");
    for (const c of r.cards) { assert.equal(c.alternative, true); assert.ok(c.note?.startsWith(s), c.note ?? ""); }
    const men = await quiet(() => universalSearch("Arsenal win", deps));
    assert.equal(men.cards[0].alternative ?? false, false);
    plain(s);
  });
});
