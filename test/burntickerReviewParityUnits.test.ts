// The pieces behind TEST A (ChatGPT audits 6 and 7, 2026-10-12): safe user regexes, the reserve bounds, major tickers and control
// characters, escaping of hostile names in the badge, the receipt art and the metadata JSON, the per-field link checks, the one team
// ticker, the season status, the one end text, the projection and drain line, the due-date timing, the clone reasons, and the two
// WIRING-MEDIA-RECOVERY server items (221: the plain-image checks; 235: no second side A after a restart).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { regexProblem, safeRegexTest } from "@/lib/burnticker/safeRegex";
import { reserveProblem, ruleRefusals, identityRefusals } from "@/lib/burnticker/launchPreflight";
import { controlCharProblem, nameProblem } from "@/lib/burnticker/launchFields";
import { linkProblem, safeCreatorLink } from "@/lib/burnticker/creatorProfile";
import { renderCoinBadgeSvg, type CoinBadgeJson } from "@/lib/burnticker/badge";
import { renderCoinSvg } from "@/lib/burnticker/coinArt";
import { metadataJson } from "@/lib/burnticker/pin";
import { teamTicker } from "@/lib/burnticker/tickers";
import { seasonStatus, SEASON_OVER_LINE, prepareLaunch, createdSideA } from "@/lib/burnticker/api/handlers";
import { endText, endExplainer } from "@/lib/burnticker/describe";
import { drainLine, spentFraction } from "@/lib/burnticker/drain";
import { reviewProjection } from "@/lib/burnticker/projection";
import { dueTiming, gameDueLabel, ifNecessary } from "@/lib/burnticker/timing";
import { evidenceLines } from "@/lib/burnticker/ops/cloneWatch";
import { checkCreatorImage } from "@/lib/burnticker/creatorBadge";
import { lockRule, DEFAULT_ON_END, shareLimitsText, RULE_BOUNDS, type BurnRule } from "@/lib/burnticker/rules";
import { firstPartyRule } from "@/lib/burnticker/wizard";
import { teamSeries, gameSeries } from "@/lib/burnticker/sources/espn";
import { DEBT_RULE, BRONCOS } from "./burntickerHelpers.ts";
import { CREATOR, makeWorld } from "./burntickerApiHelpers.ts";

const HOSTILE = ["<script>alert(1)</script>", "<img src=x onerror=alert(1)>", `Quote " and ' & amp`];
const lock = (r: unknown) => lockRule({ ...(r as object), onEnd: { ...DEFAULT_ON_END } });

describe("audit 6 item 8: the preflight", () => {
  test("catastrophic regexes are refused; plain ones pass; refused patterns never run", () => {
    for (const bad of ["(a+)+$", "(a|aa)*", "(.*a){12}", "([a-z]+)*x", "(\\w+\\s?)+$", ".*.*.*.*x", "(a)\\1", "(?<=x)y", "x".repeat(121)]) assert.ok(regexProblem(bad), bad);
    for (const ok of ["^Denver", "(Win|Loss)", "^[^:]+ vs\\. [^:]+$", "Broncos?", "\\d{2,4}"]) assert.equal(regexProblem(ok), null, ok);
    const t0 = Date.now();
    assert.equal(safeRegexTest("(a+)+$", "a".repeat(40) + "!"), false);
    assert.ok(Date.now() - t0 < 50, "a refused pattern is not evaluated");
    assert.equal(safeRegexTest("^Denver", "Denver at Kansas City"), true);
  });
  test("reserve bounds, unlaunchable sources, uma, kalshi off, unknown series", () => {
    assert.ok(reserveProblem("0")); assert.ok(reserveProblem("1000")); assert.equal(reserveProblem("0.02"), null);
    assert.ok(ruleRefusals(lock({ ...DEBT_RULE, reserveSol: "0" })).some((x) => x.code === "reserve"));
    assert.ok(ruleRefusals(lock({ ...DEBT_RULE, series: "bea.gdp", scalar: { unit: 0.1, perUnit: { fractionOfPool: 0.02 }, baseline: "previousSettlement", direction: "abs" } })).some((x) => x.code === "source-rule"));
    assert.ok(ruleRefusals(lock({ ...DEBT_RULE, series: "nope.nothing" })).some((x) => x.code === "unknown-source"));
    assert.ok(ruleRefusals(lock({ ...BRONCOS, oracle: "uma" })).some((x) => x.code === "oracle-off"));
    assert.ok(ruleRefusals(lock(BRONCOS), { kalshiEnabled: false }).some((x) => x.code === "venue-off"));
    assert.ok(ruleRefusals(lock({ ...BRONCOS, filter: { titleRegex: "(a+)+$" } })).some((x) => x.code === "unsafe-regex"));
  });
});

describe("audit 6 item 9: impersonation and escaping", () => {
  test("major tickers, control characters", () => {
    for (const t of ["SOL", "USDC", "USDT", "BTC", "ETH", "WSOL", "BONK", "WIF", "JUP"]) assert.ok(identityRefusals({ ticker: t, name: "Fine Name" }).some((x) => x.code === "major-ticker"), t);
    assert.ok(identityRefusals({ ticker: "OKAY", name: "Sol" }).some((x) => x.code === "major-ticker"));
    for (const n of ["Line\nbreak", "Tab\there", "Zero​width", "Bidi‮evil", "Cr\rlf"]) assert.ok(nameProblem(n), JSON.stringify(n));
    assert.equal(nameProblem("👩‍🚀 Crew"), "", "a joiner inside an emoji passes");
    assert.ok(controlCharProblem("desc⁦x", "description"));
  });
  test("hostile names are escaped in the badge SVG, the receipt art and the metadata JSON", () => {
    for (const h of HOSTILE) {
      const badge = renderCoinBadgeSvg({ schema: "burnticker.badge/v1", kind: "coin", generatedAt: "2026-10-12T00:00:00Z", ticker: h, name: h, oneLiner: h, window: h, status: "live", lastBurn: null, receipts: { count: 0, label: h }, rulesSha12: "abc", pageUrl: "https://burnticker.com/x", verifyUrl: "https://burnticker.com/v", nextSettlementAt: null, nextSettlementNote: h, badgeUrl: { svg: "", png: "", json: "" }, embedUrl: "", embed: { iframe: "", markdown: "", html: "" }, disclaimer: h, affiliation: h } as CoinBadgeJson);
      const art = renderCoinSvg({ ticker: h, oneLiner: h, rule: lock(DEBT_RULE).rule, sha256: "a".repeat(64) });
      for (const svg of [badge, art]) { assert.doesNotMatch(svg, /<script|<img|onerror=alert\(1\)>/); assert.doesNotMatch(svg.replace(/&(amp|lt|gt|quot|#39);/g, ""), /&(?!amp;|lt;|gt;|quot;|#39;)[a-z]+ /); }
      const meta = JSON.parse(metadataJson({ ticker: h, name: h, description: h, oneLiner: h, rule: lock(DEBT_RULE).rule, rulesSha256: "a".repeat(64), origin: "https://burnticker.com", links: [{ label: "X", url: "javascript:alert(1)" }, { label: "Website", url: "https://burnticker.com" }] }, "ar://x"));
      assert.equal(meta.name, h, "JSON carries the text as data, unchanged");
      assert.equal(meta.extensions, undefined, "refused links never reach the metadata");
    }
  });
});

describe("audit 7 item 3: link fields", () => {
  test("per field", () => {
    assert.ok(linkProblem("X", "javascript:alert(1)")); assert.ok(linkProblem("X", "data:text/html,x")); assert.ok(linkProblem("X", "http://x.com/a"));
    assert.ok(linkProblem("X", "https://facebook.com/a")); assert.equal(linkProblem("X", "https://x.com/a"), null); assert.equal(linkProblem("X", "https://twitter.com/a"), null);
    assert.ok(linkProblem("Telegram", "https://example.com/a")); assert.equal(linkProblem("Telegram", "https://t.me/a"), null);
    for (const u of ["https://burnticker.com", "https://www.burnticker.com/x", "https://burntlcker.com", "https://burnt1cker.io", "https://bumticker.net", "https://def1cit.xyz", "https://xn--brnticker-x.com", "notaurl"]) assert.ok(linkProblem("Website", u), u);
    for (const u of ["https://example.com", "https://github.com/anza-xyz", "https://benefit.org", "https://deficits.substack.com"]) assert.equal(linkProblem("Website", u) === null, !/deficit/.test(u), u);
    assert.equal(safeCreatorLink({ label: "X", url: "javascript:alert(1)" }), false);
  });
});

describe("audit 6 items 2, 3, 6, 11, 27", () => {
  test("one team ticker: league tags where a code is shared", () => {
    const t = (l: string, a: string) => teamTicker(a, { league: l, window: "season", outcome: "win" });
    assert.equal(t("mlb", "LAD"), "LAD");
    assert.deepEqual(["mlb", "nba", "nfl", "wnba", "usa.1"].map((l) => t(l, "ATL")), ["ATLMLB", "ATLNBA", "ATLNFL", "ATLWNBA", "ATLMLS"]);
    assert.notEqual(t("mlb", "ARI"), t("nfl", "ARI"));
    for (const w of ["season", "post", "next", "perpetual", "title", "game"] as const) for (const inverse of [false, true]) assert.match(teamTicker("ATL", { league: "wnba", window: w, inverse, games: 10 }), /^[A-Z0-9]{2,10}$/);
  });
  test("season status: over only when the league is in its postseason and the team is not in it", () => {
    const g = (a: string, b: string, st: 2 | 3) => ({ eventId: "1", league: "mlb" as const, seasonType: st, startsAt: "2026-10-13T00:00:00Z", date: "2026-10-13", name: "", completed: false, state: "pre", detail: "", home: { abbr: a }, away: { abbr: b } }) as never;
    assert.equal(seasonStatus("LAD", [g("LAD", "NYM", 3)], true).status, "upcoming");
    assert.deepEqual(seasonStatus("ARI", [g("LAD", "NYM", 3)], true), { status: "over", warning: SEASON_OVER_LINE });
    assert.equal(seasonStatus("ARI", [g("LAD", "NYM", 2)], true).status, "none-listed");
    assert.equal(seasonStatus("ARI", [], false).status, "unknown");
  });
  test("one end text: the result end and the void end apart, never 'sends nothing' beside a sink", () => {
    const season = lock(firstPartyRule(teamSeries("mlb", "LAD", "win", { kind: "season", year: 2026 }), 0.02)).rule;
    const fade = { ...season, inverse: true } as BurnRule;
    for (const r of [season, fade]) { const e = endText(r); assert.ok(e.void); assert.doesNotMatch(e.result, /sends nothing/); }
    assert.equal(endText(fade).kind, "flagship"); assert.equal(endText(season).kind, "champion");
    assert.equal(endText(lock(DEBT_RULE).rule).kind, "perpetual");
    const self = lockRule({ ...DEBT_RULE, series: "ll2.launches", scalar: { unit: 1, perUnit: { fractionOfPool: 0.02 }, baseline: 0, direction: "up" }, onEnd: { windDownDays: 28, sweepThresholdLamports: 50_000_000 } }).rule;
    assert.match(endText({ ...self, market: "X" } as BurnRule).result, /sends nothing to another coin/);
    assert.equal(endExplainer().length, 4);
  });
  test("projection and drain from the program's compounding", () => {
    assert.match(drainLine(0.25, "win"), /about 76% of the pool is gone after 5 wins/);
    assert.ok(Math.abs(spentFraction([3], 0.02) - (1 - 0.98 ** 3)) < 1e-6);
    const p = reviewProjection(lock(DEBT_RULE).rule);
    assert.equal(p.available, true); assert.deepEqual(p.rows.map((r) => r.share), [0.01, 0.02, 0.05]); assert.ok(p.rows[2].spentPct >= p.rows[0].spentPct);
    assert.equal(reviewProjection(lock(firstPartyRule(teamSeries("mlb", "LAD", "win", { kind: "season", year: 2026 }), 0.02)).rule).available, false);
    assert.match(shareLimitsText(), new RegExp(`${Math.round(RULE_BOUNDS.fractionOfPool.max * 100)}%`));
  });
  test("due date and timing", () => {
    assert.equal(ifNecessary({ detail: "Game 5 *if necessary" }), true);
    assert.match(gameDueLabel({ eventId: "1", startsAt: "2026-10-13T23:00:00Z", detail: "Game 5 if necessary" }), /Oct 13, 2026 \(if necessary\)/);
    const now = Date.parse("2026-10-10T00:00:00Z");
    assert.ok(dueTiming("2026-10-13T00:00:00Z", now).warning); assert.equal(dueTiming("2026-12-01T00:00:00Z", now).warning, null);
    assert.equal(gameSeries("mlb", "1", "TB", "loss"), "espn.game:mlb-1-TB-loss");
  });
});

describe("audit 7 item 2: clone reasons say the rule", () => {
  test("an exact ticker, a folded one, one letter away", () => {
    const base = { mint: "M", chain: "solana" as const, name: "x", pool: null, dex: null, url: null, firstSeenAt: "", lastSeenAt: "", poolCreatedAt: null, registered: false, bundle: null, lp: { state: "unknown" as const, pulledAt: null } };
    assert.match(evidenceLines({ ...base, symbol: "DEFICIT", matched: { term: "DEFICIT", how: "ticker reads as the same letters" } })[1], /uses the ticker \$DEFICIT exactly/);
    assert.match(evidenceLines({ ...base, symbol: "DEF1CIT", matched: { term: "DEFICIT", how: "ticker reads as the same letters" } })[1], /look-alike characters/);
    assert.match(evidenceLines({ ...base, symbol: "DEFICT", matched: { term: "DEFICIT", how: "ticker one letter away" } })[1], /differs from \$DEFICIT by one letter/);
  });
});

describe("WIRING-MEDIA-RECOVERY items 221 and 235", () => {
  test("221: an 8-pixel image and a non-image are refused on the plain path as on the badge path", async () => {
    const sharp = (await import("sharp")).default;
    const tiny = new Uint8Array(await sharp({ create: { width: 8, height: 8, channels: 3, background: "#f00" } }).png().toBuffer());
    assert.ok("error" in await checkCreatorImage(tiny));
    assert.ok("error" in await checkCreatorImage(new TextEncoder().encode("not an image")));
    const w = await makeWorld(); w.p.customImages = true;
    const body = (badge: boolean) => ({ creator: CREATOR, ticker: "TINYPIC", name: "Tiny Pic", rule: DEBT_RULE, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true }, image: { contentType: "image/png", base64: Buffer.from(tiny).toString("base64") }, imageRights: true, imageBadge: badge });
    for (const badge of [false, true]) { const r = await prepareLaunch(w.p, body(badge), { register: false }); assert.ok("error" in r); assert.match(String((r.error.body as { error: string }).error), /too small/); }
  });
  test("235: a side A already created on chain is named, never created twice", async () => {
    const w = await makeWorld();
    const RULE = { ...BRONCOS, binary: { onYes: null, onNo: { fractionOfPool: 0.02 } }, pair: null };
    const body = { creator: CREATOR, ticker: "MILEHI", name: "Mile High", rule: RULE, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true }, pair: { ticker: "ARROWHD", name: "Arrowhead", description: "", imageUrl: null, links: [] } };
    const first = await prepareLaunch(w.p, body, { register: true }) as { pair?: { tokens: { a: { mint: string } } } };
    assert.ok(first.pair, "the first plan builds");
    const minted = first.pair!.tokens.a.mint;
    w.p.market = { getAccountInfo: async (k: { toBase58(): string }) => (k.toBase58() === minted ? { lamports: 1 } : null) } as never;
    assert.equal(await createdSideA(w.p, { creator: CREATOR, ticker: "MILEHI", name: "Mile High" }), minted);
    const again = await prepareLaunch(w.p, body, { register: true });
    assert.ok("error" in again); assert.equal(again.error.status, 409); assert.equal((again.error.body as { mint: string }).mint, minted);
    assert.match((again.error.body as { error: string }).error, new RegExp(minted));
  });
});
