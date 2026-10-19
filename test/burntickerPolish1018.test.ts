// PRELAUNCH AUDIT 2026-10-18, OPTIONAL POLISH ("Visual and usability assessment"): the rule in brief with the locked statement under
// "Read the full rule"; dates in user prose in a human form that names UTC; a stable launch label on the home with a status line; coin
// links after a launch and on Your coins by mint; automated accessibility checks over the main static pages and the Next page shells.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { CHART_PLACEHOLDER, READ_FULL_RULE, RULE_VOID_SENTENCE, chartUrlForTheme, ruleBrief, voidSentence } from "@/lib/burnticker/coinPage";
import { lockRule } from "@/lib/burnticker/rules";
import { derbyStatement, type DerbySpec } from "@/lib/burnticker/derby/spec";
import { BONK, WIF } from "./burntickerDerbyHelpers.ts";
import { formatHits, lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import { BRONCOS, DEBT_RULE, ONE_SHOT } from "./burntickerHelpers.ts";
import { utcDateTime, utcDay } from "@/lib/burnticker/utcWords";
import { nextTimeRow, OVERDUE_CHECK_NOTE, PUBLISHER_DECIDES, selectorTitle } from "@/lib/burnticker/coinSourceLine";
import { espnSeriesTitle, parseEspnSeries } from "@/lib/burnticker/sources/espn";
import { receiptStatusWords, RECEIPT_STATUS_WORDS } from "@/lib/burnticker/coinPage";
import { creatorNextLine, DECIDED_BURNED, DECIDED_VOID, DECIDED_WAITING } from "@/lib/burnticker/creatorBenefits";
import { NO_WIN_YET, READ_NOTHING_COUNTED, isWinCoin, settlementOf, upcomingFromStatus } from "@/lib/burnticker/upcoming";
import { coinHref } from "@/lib/burnticker/launchRecovery";
import { coinCanonicalHref } from "@/lib/burnticker/coinKey";

const ROOT = path.join(import.meta.dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const cfg = loadCopyLintConfig(ROOT);
const clean = (t: string, what: string) => { const r = lintCopy(t, cfg); assert.ok(r.ok, `${what}: ${t}\n${formatHits(r)}`); };
const COIN = "src/app/burnticker/t/[ticker]/page.tsx", PAIR = "src/app/burnticker/p/[pairId]/page.tsx";

describe("item 1: the rule in brief, the locked statement under Read the full rule", () => {
  test("two short sentences for every rule shape, lint-clean, never the statement itself", () => {
    const briefs = [DEBT_RULE, BRONCOS, ONE_SHOT].map((r) => ruleBrief(lockRule(r).text));
    briefs.push(ruleBrief(read("config/burnkeeper/rehearsal.rules.json")), ruleBrief("not json"));
    for (const b of briefs) {
      assert.equal(b.split(/(?<=\.)\s/).length, 2, b);
      assert.match(b, /A voided result (burns nothing|ends the rule)/, b);
      assert.ok(b.length < 200, b);
      clean(b, "rule brief");
    }
    assert.match(ruleBrief(lockRule(ONE_SHOT).text), /^A settled (YES|NO)( or NO)? result burns some of this coin/);
    clean(READ_FULL_RULE, "the disclosure label");
  });
  test("a voided result: nothing with no end clause; with one, the wind-down the statement names", () => {
    const base = JSON.parse(lockRule(ONE_SHOT).text);
    assert.equal(voidSentence({ ...base, onEnd: undefined }), RULE_VOID_SENTENCE);
    const oneShot = voidSentence({ ...base, market: base.market ?? "KX-1", onEnd: { windDownDays: 28, sweepThresholdLamports: 1 } });
    assert.equal(oneShot, "A voided result ends the rule, and what is left burns down over four weeks.");
    const series = voidSentence({ ...base, market: null, pair: null, onEnd: { windDownDays: 28, sweepThresholdLamports: 1 } });
    assert.equal(series, "A voided result burns nothing, and if the rule ends void, what is left burns down over four weeks.");
    assert.equal(voidSentence({ ...base, market: null, pair: null, onEnd: { windDownDays: 10, sweepThresholdLamports: 1 } }).endsWith("over 10 days."), true);
    for (const t of [oneShot, series]) clean(t, "void sentence");
    // the statement says the same wind-down for the same rule
    const locked = lockRule({ ...ONE_SHOT });
    if (locked.rule.onEnd) assert.match(ruleBrief(locked.text), /burns down over/);
  });
  test("a coin with a pinned burn target says it swaps SOL for that token and burns it; a coin without one burns itself", () => {
    const plain = lockRule(ONE_SHOT).text;
    const withTarget = JSON.stringify({ ...JSON.parse(plain), burnTarget: { mint: "So11111111111111111111111111111111111111112", pool: "P", symbol: "BONK" } });
    assert.match(ruleBrief(withTarget), /swaps SOL for BONK and burns it\b/); assert.doesNotMatch(ruleBrief(withTarget), /this coin/);
    assert.match(ruleBrief(plain), /burns some of this coin/); assert.doesNotMatch(ruleBrief(plain), /swaps SOL/);
    clean(ruleBrief(withTarget), "burn-target brief");
  });
  test("a Burn Derby rule is summed up by its kind, and each summary agrees with its statement", () => {
    const season = { start: "2026-10-20", days: 30 };
    const brief = (derby: DerbySpec, side: "A" | "B" | null, scalar: { unit: number; direction: string } | null = null) => ruleBrief(JSON.stringify({ schema: "burnticker.rules/v1", oracle: "derby", derby, kind: scalar ? "scalar" : "binary", scalar, pair: side ? { pairId: "p1", side } : null }));
    const flip: DerbySpec = { selector: "coinvs", a: WIF, b: BONK, window: "daily", measure: "mcap", season, flip: true };
    const race: DerbySpec = { ...flip, measure: "pct", flip: false };
    const price: DerbySpec = { selector: "price", u: WIF, window: "daily", season };
    const highOnce = { selector: "high", u: WIF, span: "all", once: true, season, baseline: { kind: "all-time", value: "1", through: "2026-10-19" } } as unknown as DerbySpec;
    const highEach = { ...(highOnce as object), once: false } as unknown as DerbySpec;
    const cases: [string, string, RegExp, RegExp][] = [
      [brief(flip, "A"), derbyStatement(flip, "A", "p1"), /^This coin burns some of itself once, on the first window WIF passes BONK/, /burns once on the first window WIF passes BONK/],
      [brief(flip, "B"), derbyStatement(flip, "B", "p1"), /once, if the season ends without WIF passing BONK/, /burns once if the season ends without WIF passing BONK/],
      [brief(race, "B"), derbyStatement(race, "B", "p1"), /^Each window BONK wins burns some of this coin/, /burns on a window BONK wins/],
      [brief(price, "A", { unit: 5, direction: "up" }), derbyStatement(price, "A", "p1", { unit: 5, direction: "up" }), /Each full 5 percentage points of rise in WIF/, /Every full 5 percentage points of rise is one unit/],
      [brief(highOnce, null), derbyStatement(highOnce, null, null), /The first day WIF closes at a record burns some of this coin, once/, /settles the rule once/],
      [brief(highEach, null), derbyStatement(highEach, null, null), /^Each day WIF closes at a record/, /is one unit/],
    ];
    for (const [b] of cases) assert.doesNotMatch(b, /this coin burns some of this coin/i);
    for (const [b, st, bre, sre] of cases) { assert.match(b, bre, b); assert.match(st, sre, st.slice(0, 200)); assert.doesNotMatch(b, /\bwins? (the|a) window this coin|won\b/, b); clean(b, "derby brief"); }
    assert.doesNotMatch(cases[3][0], /\bwins?\b|\bwon\b/, "a single asset wins nothing");
  });
  test("the coin page and the pair page keep the full statement verbatim inside a native details element", () => {
    for (const f of [COIN, PAIR]) {
      const src = read(f);
      const m = /<details className="bt-rule-full[^"]*" data-rule-full><summary[^>]*>\{READ_FULL_RULE\}<\/summary><p [^>]*data-rule-statement>\{s\.(status\.)?rules\.statement\}<\/p><\/details>/.exec(src);
      assert.ok(m, `${f}: the statement sits in the disclosure`);
      assert.doesNotMatch(m[0], /\bopen\b|onClick|onToggle/, "no script and no forced state: the browser's own disclosure");
      assert.match(src, /data-rule-brief>\{ruleBrief\(/);
      assert.equal((src.match(/rules\.statement\}/g) ?? []).length, 1, `${f}: the statement is printed once, in the disclosure`);
    }
  });
});

describe("item 2: dates in user prose name UTC in a human form", () => {
  test("utcDateTime and utcDay: day month year, a 24-hour clock and the word UTC; bad input comes back as it was", () => {
    assert.equal(utcDateTime("2026-10-16T13:38:42.123Z"), "16 October 2026, 13:38 UTC");
    assert.equal(utcDateTime(Date.UTC(2026, 0, 2, 3, 4)), "2 January 2026, 03:04 UTC");
    assert.equal(utcDateTime("2026-10-16T23:30:00-06:00"), "17 October 2026, 05:30 UTC", "an offset is read and said in UTC");
    assert.equal(utcDateTime("2026-10-16"), "16 October 2026", "a bare day has no clock");
    assert.equal(utcDay("2026-10-16T00:10:00Z"), "16 October 2026");
    assert.equal(utcDay("2026-10-16"), "16 October 2026");
    assert.equal(utcDay(new Date(Date.UTC(2026, 11, 31, 23, 59))), "31 December 2026");
    for (const v of [null, undefined, ""]) { assert.equal(utcDay(v), ""); assert.equal(utcDateTime(v), ""); }
    assert.equal(utcDateTime("not a date"), "not a date");
    clean(`This site read the pool on ${utcDateTime("2026-10-16T13:38:00Z")}.`, "the pool line");
  });
  test("the static status page writes the same words with its own copy of the function", () => {
    const html = read("site/burnticker/status/index.html");
    const src = /function btUtc\(v, withTime\) \{[\s\S]*?\n  \}/.exec(html);
    assert.ok(src, "the helper is on the page");
    const btUtc = new Function(`${src[0]}; return btUtc;`)() as (v: unknown, t?: boolean) => string;
    for (const v of ["2026-10-16T13:38:42Z", "2026-01-02", "2026-12-31T23:59:59.999Z"]) { assert.equal(btUtc(v, true), utcDateTime(v), v); assert.equal(btUtc(v), utcDay(v), v); }
    assert.equal(btUtc("nope", true), "nope");
    assert.doesNotMatch(html, /slice\(0, 1[06]\)/, "no sliced ISO date left in the page's sentences");
  });
  test("no touched page or copy builder prints a sliced ISO time or a Z suffix in a sentence", () => {
    const files = [COIN, PAIR, "src/lib/burnticker/tokenPage.ts", "src/lib/burnticker/leaderboard.ts", "src/lib/burnticker/coinPage.ts", "src/lib/burnticker/coinSourceLine.ts",
      "src/lib/burnticker/upcoming.ts", "src/lib/burnticker/embed.ts", "src/lib/burnticker/coverage/preflight.ts", "src/app/burnticker/_components/CurrentStatusSummary.tsx",
      "src/app/burnticker/not-burnticker/page.tsx", "src/app/burnticker/bounty/BountyWallet.tsx", "src/app/burnticker/rivalries/page.tsx", "src/app/burnticker/about/page.tsx",
      "src/app/burnticker/trust/OpsSection.tsx", "src/app/burnticker/fees/ledger/page.tsx"];
    for (const f of files) {
      const src = read(f);
      assert.doesNotMatch(src, /\)\}?Z[\s:,.<`]/, `${f}: a Z suffix after a sliced date`);
      assert.doesNotMatch(src, /slice\(0, 16\)\.replace\("T", " "\)\)?\}? UTC/, `${f}: a sliced ISO time before UTC`);
      assert.doesNotMatch(src, /slice\(11, 16\)\}? UTC/, `${f}: a bare clock without its day`);
    }
    // the coin page's burn log keeps the machine form in the time element's attribute
    assert.match(read(COIN), /<time className="font-mono text-xs" dateTime=\{b\.settledAt\}>\{utcDateTime\(b\.settledAt\)\}<\/time>/);
    const row = nextTimeRow("2026-10-16T13:38:00Z", null, Date.parse("2026-10-16T00:00:00Z"));
    assert.equal(row.value, "16 October 2026, 13:38 UTC");
  });
  test("receipt titles stay in their parsed form: settledTitle.ts is untouched by the formatter", () => {
    assert.doesNotMatch(read("src/lib/burnticker/settledTitle.ts"), /utcWords/);
  });
});

describe("item 4: links after a launch and the creator summary on Your coins go by mint", () => {
  const MINT = "FwXiFscFSYXzvPVzV4rCw4UBcGDhT53xHDpsL3pVpzkp";
  test("the recovery link is the coin's canonical mint page", () => {
    assert.equal(coinHref(MINT), coinCanonicalHref(MINT));
    assert.equal(coinHref(MINT), `/burnticker/t/${MINT}`);
  });
  test("the success card opens each coin by its mint, and every caller passes the canonical builder", () => {
    assert.match(read("src/app/burnticker/launch/SignCard.tsx"), /href=\{coinHref\(c\.mint\)\}>Open \$\{c\.ticker\}<\/a>/);
    for (const f of ["src/app/burnticker/launch/page.tsx", "src/app/burnticker/launch/CoinVsCoinTile.tsx"]) {
      const src = read(f);
      assert.doesNotMatch(src, /coinHref=\{\(t\) => `\/burnticker\/t\/\$\{t\}`\}/, f);
      assert.match(src, /coinHref=\{coinCanonicalHref\}/, f);
    }
    assert.match(read("src/app/burnticker/launch/LaunchRecovery.tsx"), /f\.coins\.map\(\(c\) => <a key=\{c\.mint\}/);
  });
  test("the creator summary carries the mint; Your coins and the coin page match on it, and Your coins links the mint page", () => {
    assert.match(read("src/app/burnticker/creator/[wallet]/summary/route.ts"), /ticker: c\.ticker, mint: c\.mint,/);
    // audit 7: the registry-only projection carries the mint (creatorServe.ts baseOf)
    assert.match(read("src/lib/burnticker/creatorServe.ts"), /name: t\.name, mint: t\.mint,/);
    const me = read("src/app/burnticker/me/page.tsx");
    assert.match(me, /find\(\(x\) => x\.mint === mint\)/); assert.match(me, /rankOf\(c\.mint\)/); assert.doesNotMatch(me, /rankOf\(c\.ticker\)/);
    assert.match(me, /href=\{coinCanonicalHref\(c\.mint\)\}>\$\{c\.ticker\}<\/Link>/);
    assert.match(read(COIN), /find\(\(x\) => x\.mint === mint\)\?\.rank/);
  });
});

describe("A-36: the pool chart follows the theme and says what it is waiting for", () => {
  const url = "https://www.geckoterminal.com/solana/pools/P?embed=1&info=0&swaps=0&grayscale=0&light_chart=0";
  test("light_chart=1 on paper, 0 on the dark counter; a URL without the flag gains it", () => {
    assert.match(chartUrlForTheme(url, "light"), /&light_chart=1$/); assert.equal(chartUrlForTheme(url, "dark"), url);
    assert.equal(chartUrlForTheme("https://x.test/p?embed=1", "light"), "https://x.test/p?embed=1&light_chart=1");
    clean(CHART_PLACEHOLDER, "chart placeholder");
  });
  test("both pages draw the chart through PoolChart, which watches the theme and puts the sentence under the lazy frame", () => {
    for (const f of [COIN, PAIR]) { assert.match(read(f), /<PoolChart /); assert.doesNotMatch(read(f), /<iframe /); }
    const c = read("src/app/burnticker/_components/PoolChart.tsx");
    assert.match(c, /MutationObserver[\s\S]*attributeFilter: \["data-theme"\]/);
    assert.match(c, /data-chart-placeholder>\{CHART_PLACEHOLDER\}<\/p>\s*<iframe [^>]*loading="lazy"/);
  });
});

describe("the trust page's tables scroll sideways inside their cards on a phone", () => {
  test("every table on the trust page sits directly in a focusable, named, sideways-scrolling wrapper that the site's focus ring covers", () => {
    let n = 0;
    for (const f of ["src/app/burnticker/trust/page.tsx", "src/app/burnticker/trust/CoverageSection.tsx"]) {
      const src = read(f);
      for (const m of src.matchAll(/<table\b/g)) {
        n++;
        const before = src.slice(Math.max(0, m.index! - 260), m.index);
        const wrap = /<div [^<]*$/.exec(before)?.[0] ?? "";
        assert.match(wrap, /className="bt-table-wrap[^"]*\bmax-w-full\b[^"]*\boverflow-x-auto\b/, `${f}: ${wrap}`);
        assert.match(wrap, /tabIndex=\{0\} role="region" data-scroll-table aria-label=/, `${f}: keyboard users can scroll it`);
      }
    }
    assert.ok(n >= 7, `the trust page's tables (${n})`);
    assert.match(read("config/public-repo/overlay/src/app/globals.css"), /:where\([^)]*\[tabindex\][^)]*\):focus-visible \{ outline: 2px solid/);
    assert.match(read("config/public-repo/overlay/src/app/globals.css"), /\.bt-table-wrap \{ overflow-x: auto; \}/);
  });
});

describe("A-26: times say what they are; decided coins say so; a past time is never next", () => {
  const now = Date.parse("2026-10-18T20:00:00Z");
  test("the coin page's next-time row: a past check is overdue, a past close is a close, the future stays next", () => {
    // the overdue logic and its words are the F02 fix's (coinSourceLine.ts OVERDUE_CHECK_NOTE); this pins the human date in it
    assert.deepEqual(nextTimeRow(null, "2026-10-18T19:00:00Z", now), { label: "Source check overdue", value: "18 October 2026, 19:00 UTC", note: OVERDUE_CHECK_NOTE });
    assert.equal(nextTimeRow("2026-10-18T19:00:00Z", null, now).label, "Scheduled market close, passed");
    assert.equal(nextTimeRow(null, "2026-10-18T21:00:00Z", now).label, "Next source check");
    for (const r of [nextTimeRow(null, "2026-10-18T19:00:00Z", now), nextTimeRow("2026-10-18T19:00:00Z", null, now)]) clean(`${r.label}. ${r.note}`, "next-time row");
  });
  test("the creator page: a one-shot is decided only by a settled result receipt; dates are UTC days and overdue is said in words", () => {
    const one = (receipts: { status: string; kind?: string; settledAt?: string }[], graduated = false, nextAt: string | null = null) => creatorNextLine({ oneShot: true, receipts, graduated, nextAt }, now);
    assert.equal(one([{ status: "planned", kind: "event", settledAt: "2026-10-16T01:00:00Z" }]), DECIDED_WAITING);
    assert.equal(one([{ status: "confirmed", kind: "event", settledAt: "2026-10-16T01:00:00Z" }], true), DECIDED_BURNED);
    // an end receipt after the result does not hide it; a skipped or failed result decides nothing; audit 7 F08: a voided one-shot says so
    assert.equal(one([{ status: "confirmed", kind: "event", settledAt: "2026-10-16T01:00:00Z" }, { status: "skipped", kind: "winddown", settledAt: "2026-10-17T01:00:00Z" }], true), DECIDED_BURNED);
    for (const st of ["skipped", "nothing", "exhausted"]) assert.equal(one([{ status: st, kind: "event", settledAt: "2026-10-16T01:00:00Z" }], false, "2026-10-19T19:00:00Z"), "19 October 2026", st);
    for (const st of ["void", "voided"]) assert.equal(one([{ status: st, kind: "event", settledAt: "2026-10-16T01:00:00Z" }], false, "2026-10-19T19:00:00Z"), DECIDED_VOID, st);
    assert.equal(creatorNextLine({ oneShot: false, receipts: [], graduated: false, nextAt: "2026-10-18T19:00:00Z" }, now), "Was due on 18 October 2026 and is overdue");
    assert.equal(creatorNextLine({ oneShot: false, receipts: [], graduated: false, nextAt: "2026-10-19T19:00:00Z" }, now), "19 October 2026");
    assert.equal(creatorNextLine({ oneShot: false, receipts: [], graduated: false, nextAt: null }, now), "None scheduled");
    assert.doesNotMatch(creatorNextLine({ oneShot: false, receipts: [], graduated: false, nextAt: "2026-10-18T19:00:00Z" }, now), /[()]/);
    assert.match(read("src/app/burnticker/creator/[wallet]/page.tsx"), /<dd data-next-line>\{c\.nextLine\}<\/dd>/);
    for (const t of [DECIDED_WAITING, DECIDED_BURNED, "Was due on 18 October 2026 and is overdue"]) clean(t, "creator next line");
  });
  test("the upcoming page: a win coin whose source was read with no row says the team has not won a game it counts", () => {
    assert.ok(isWinCoin("catalogue:espn.team:nfl-PHI.21-win-s2026")); assert.ok(!isWinCoin("kalshi:KXMLBGAME:binary"));
    assert.equal(settlementOf([], "mainnet", { sourceRead: true, winCoin: true }).text, NO_WIN_YET);
    assert.equal(settlementOf([], "mainnet", { sourceRead: true }).text, READ_NOTHING_COUNTED);
    assert.equal(settlementOf([], "mainnet").text, "No result has been read for this coin yet.");
    const row = upcomingFromStatus({ ticker: "PHINFLWIN", name: "Eagles", cluster: "mainnet", status: "live", oracle: "catalogue", selectorKey: "catalogue:espn.team:nfl-PHI.21-win-s2026", seriesTitle: null, next: { nextCheckAt: null, nextMarket: null, nextCloseTime: null }, feed: { lastFetchAt: "2026-10-18T19:00:00Z", readings: 0 } }, [])!;
    assert.equal(row.statusText, NO_WIN_YET);
    for (const t of [NO_WIN_YET, READ_NOTHING_COUNTED]) clean(t, "upcoming");
  });
});

describe("A-30: copy in words, not keys, ids, raw statuses or arrows", () => {
  test("a one-game title has no event id; a selector key reads as its series title; an unknown key prints nothing", () => {
    const g = parseEspnSeries("espn.game:nfl-401772900-SEA-win");
    if (g) { const t = espnSeriesTitle(g); assert.doesNotMatch(t, /ESPN game|\d{6,}/); assert.match(t, /, one game$/); clean(t, "one-game title"); }
    assert.equal(selectorTitle("kalshi:KXMLBGAME:binary"), null);
    assert.match(read("src/app/burnticker/rivalries/page.tsx"), /selectorTitle\(r\.selectorKey\) && <span [^>]*data-pair-title>/);
    assert.doesNotMatch(read("src/app/burnticker/rivalries/page.tsx"), />\{r\.selectorKey\}</);
    assert.doesNotMatch(read("src/lib/burnticker/describe.ts"), /" that game"/);
  });
  test("the burn log names a receipt's status in words", () => {
    assert.equal(receiptStatusWords("pending-pair"), "Waiting until both coins of the pair have a registered pool");
    assert.equal(receiptStatusWords("some-new-state"), "some new state");
    for (const t of Object.values(RECEIPT_STATUS_WORDS)) clean(t, "receipt status");
    assert.match(read(COIN), /\{receiptStatusWords\(b\.status\)\}/);
  });
  test("review leftovers: status words in the verify summaries, no arrows on the pair page, no em dash in a selector's title", () => {
    assert.match(read(COIN), /: receiptStatusWords\(b\.status\)\} \(\{receiptRowStatus\(b\)\.label\}\)<\/summary>/);
    assert.match(read("src/lib/burnticker/tokenPage.ts"), /esc\(receiptStatusWords\(b\.status\)\)/);
    assert.doesNotMatch(read(PAIR), /← Burnticker|\{trade\.label\} ↗/);
    assert.doesNotMatch(read(COIN), /← Coins/);
    // the always-present error regions take no room while empty (a space-y stack shows no gap)
    for (const f of ["src/app/burnticker/launch/page.tsx", "src/app/burnticker/launch/CoinVsCoinTile.tsx", "src/app/burnticker/launch/ReviewCard.tsx", "src/app/burnticker/verify/page.tsx"])
      for (const m of read(f).matchAll(/<(p|span) className="([^"]*text-red-400[^"]*)" aria-live="polite">/g)) assert.match(m[2], /\bempty:hidden\b/, `${f}: ${m[2]}`);
    const meet = parseEspnSeries("espn.team:nfl-PIT.23-win-m2026.BAL.33");
    if (meet) { const t = selectorTitle("catalogue:espn.team:nfl-PIT.23-win-m2026.BAL.33")!; assert.ok(t, "a meetings title"); assert.doesNotMatch(t, /—/); }
  });
  test("no arrow inside the link and button text the audit listed", () => {
    for (const [f, re] of [[COIN, /Launch one like this →|see this game on ESPN →<\/a>/], [PAIR, /Launch a pair like this →/], ["src/app/burnticker/not-burnticker/page.tsx", /verify this mint →/], ["src/app/burnticker/verify/page.tsx", /coin page →/], ["src/app/burnticker/launch/page.tsx", /→<\/button>|→<\/Link>|→"\}|→`\}/]] as const) assert.doesNotMatch(read(f), re, f);
  });
});
