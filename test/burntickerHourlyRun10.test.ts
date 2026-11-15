// HOURLY AUDIT 2026-10-19 22:10 DENVER, RUN 10 (docs/burnticker/audits/continuous/2026-10-19-2210-Denver.md; bugs.md HB-98 reopened,
// HB-118 to HB-124; suggestion HS-51). HB-117 and HS-52 belong to another batch. One pure test or source check per fix, plus the copy
// lint on every new public sentence.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { lintCopy, loadCopyLintConfig, formatHits } from "@/lib/launch/copyLint";
import { agoWords, checkLine, checkedLine, OVERDUE_GRACE_MS } from "@/lib/burnticker/creatorBenefits";
import { creatorNextFields } from "@/lib/burnticker/creatorServe";
import { NEXT_GAME_NOTES, NEXT_GAME_SOON_MS, nextGameNote } from "@/lib/burnticker/sources/native";
import { NO_TITLE_MARKET_LINE, nextSeasonButtonLabel, seasonOverRefusal } from "@/lib/burnticker/seasonOver";
import { teamSeries } from "@/lib/burnticker/sources/espn";
import { counterpartyOf, COUNTERPARTY_RULE } from "@/lib/burnticker/trustpack/ledger";
import { LEDGER_CACHE_SEC, ledgerCacheControl } from "@/lib/burnticker/trustpack/api";
import { ATTESTER_REHEARSAL_LABEL, attesterRows } from "@/lib/burnticker/trust";
import { denverDay, leagueSeasonPage, ONE_GAME_OUTCOME } from "@/lib/burnticker/leagues";
import { gameSeries } from "@/lib/burnticker/sources/espn";
import type { BurnRule } from "@/lib/burnticker/rules";

const cfg = loadCopyLintConfig();
const clean = (s: string) => { const r = lintCopy(s, cfg); assert.ok(r.ok, `${s}\n${formatHits(r)}`); };
const plain = (s: string) => { clean(s); assert.doesNotMatch(s, /\bwill\b|\bbuy\b|\bprice\b|coming soon|\bpayouts?\b|\btarget\b|\bguarantee|→|\b20\d\d-\d\d-\d\d\b|\w\/\w+\//i, s); };
const read = (p: string) => fs.readFileSync(p, "utf8");
const page = read("src/app/burnticker/launch/page.tsx");
const MIN = 60_000;

describe("HB-98 reopened: the creator page's next source check, from the actual check time", () => {
  const now = Date.parse("2026-10-20T04:13:00Z");   // 22:13 Denver
  const ran = Date.parse("2026-10-20T03:53:00Z");   // the check ran at 21:53
  test("a check that ran 20 minutes ago is never overdue, whatever the older body says", () => {
    assert.equal(checkLine("2026-10-20T04:53:00Z", now, ran), "Checked 20 minutes ago, next due at Oct 19, 2026, 10:53 PM MDT");
    // the body still names the due time before that check (21:52): the check that ran after it answers it
    assert.equal(checkLine("2026-10-20T03:52:00Z", now, ran), "Checked 20 minutes ago, next check due now");
    assert.doesNotMatch(checkLine("2026-10-20T03:52:00Z", now, ran), /overdue/);
    // overdue only when the grace has passed since the due time and no check ran after it
    assert.match(checkedLine(ran, "2026-10-20T03:55:00Z", now), /; the check due at .* is overdue$/);
    assert.equal(checkedLine(ran, "2026-10-20T04:05:00Z", now), "Checked 20 minutes ago, next check due now", "inside the grace");
    assert.ok(now - Date.parse("2026-10-20T04:05:00Z") < OVERDUE_GRACE_MS);
    assert.equal(agoWords(30_000), "less than a minute ago"); assert.equal(agoWords(MIN), "1 minute ago"); assert.equal(agoWords(150 * MIN), "2 hours ago");
    for (const s of [checkLine("2026-10-20T04:53:00Z", now, ran), checkLine("2026-10-20T03:52:00Z", now, ran)]) clean(s);
  });
  test("the creator view reads the keeper's live record, and a later next read replaces the body's", () => {
    const s = { rules: { oneShot: false }, next: { result: "recurring", nextResultAt: null, nextSourceCheckAt: "2026-10-20T03:52:00Z" } } as never;
    const f = creatorNextFields(s, [], now, { lastFetchAt: ran, nextFetchAt: Date.parse("2026-10-20T04:53:00Z") });
    assert.equal(f.nextCheckAt, "2026-10-20T04:53:00.000Z");
    assert.equal(f.nextCheckLine, "Checked 20 minutes ago, next due at Oct 19, 2026, 10:53 PM MDT");
    const old = creatorNextFields(s, [], now);
    assert.match(old.nextCheckLine ?? "", /is overdue/, "without the live record the old wording stands");
    assert.match(read("src/lib/burnticker/creatorServe.ts"), /\.\.\.creatorNextFields\(s, d\.receipts, c\.now, liveFeed\(c, t\)\)/);
  });
});

describe("HB-118: the next-game note on a team review", () => {
  test("no basketball words, and no 'not listed yet' for a game more than two weeks away", () => {
    for (const s of [NEXT_GAME_NOTES.hold, NEXT_GAME_NOTES.official("MLB's official feed"), NEXT_GAME_NOTES.laterHold, NEXT_GAME_NOTES.laterOfficial("MLB's official feed")]) { assert.doesNotMatch(s, /tip-off/); plain(s); }
    const d = { tsdbKey: "k", apiSportsKey: null } as never;
    assert.equal(nextGameNote("mlb", d, { soon: true }), NEXT_GAME_NOTES.official("MLB's official feed"));
    assert.equal(nextGameNote("mlb", d, { soon: false }), NEXT_GAME_NOTES.laterOfficial("MLB's official feed"));
    assert.doesNotMatch(nextGameNote("mlb", d, { soon: false }), /has not listed the next game yet/);
    assert.equal(NEXT_GAME_SOON_MS, 14 * 86_400_000);
    assert.match(read("src/lib/burnticker/sources/native.ts"), /nextGameNote\(s\.league, d, \{ soon: Date\.parse\(next\.startsAt\) - nowMs <= NEXT_GAME_SOON_MS \}\)/);
  });
});

describe("HB-119: a season-over team sees the next season up front", () => {
  test("the offer is computed on the page before Next; the title-market button only when a market exists", () => {
    const rule = { oracle: "catalogue", series: teamSeries("mlb", "COL", "win", { kind: "season", year: 2026 }) } as BurnRule;
    const r = seasonOverRefusal(rule, Date.parse("2026-10-20T04:00:00Z"));
    assert.ok(r && /2027/.test(r.next.label) && /s2027/.test(r.next.series), JSON.stringify(r));
    assert.equal(nextSeasonButtonLabel("Rockies", "2027"), "Follow the Rockies in the 2027 season instead");
    plain(nextSeasonButtonLabel("Rockies", "2027")); plain(NO_TITLE_MARKET_LINE);
    assert.match(page, /const soNext = so\?\.next \?\? \(teamOver \? seasonOverRefusal\(rule\)\?\.next \?\? null : null\);/);
    assert.match(page, /\{titleCard\?\.state === "found" \? <button [^>]*onClick=\{\(\) => pickPattern\("once"\)\}>Follow next season&apos;s title market instead<\/button>/);
    assert.match(page, /: titleCard\?\.state === "none" \? <span className="text-neutral-400" data-no-title-market>\{NO_TITLE_MARKET_LINE\}<\/span> : null\}/);
  });
});

describe("HB-120: Resume keeps the chosen next season", () => {
  test("the season swap is saved in the draft and restored", () => {
    assert.match(page, /const snapshot = JSON\.stringify\(\{ guide,[^\n]*leagueSeries, team, winLose, seasonSwap, game,/);
    assert.match(page, /set\("winLose", setWinLose\); set\("seasonSwap", setSeasonSwap\);/);
  });
});

describe("HB-121: 'next big' is refused only as the next big thing", () => {
  test("event names pass; hype phrases still fail", () => {
    for (const s of ["Next Big Quake", "next big storm", "The Next Big Eruption"]) assert.ok(lintCopy(s, cfg, { scope: "creator" }).ok, s);
    for (const s of ["the next big thing", "the next big coin", "next big memecoin", "next pepe"]) assert.ok(!lintCopy(s, cfg, { scope: "creator" }).ok, s);
  });
});

describe("HB-122: one counterparty rule, and ledger headers that count down from the body's age", () => {
  test("the largest opposite mover, shared by the ledger and /v1/trust", () => {
    const keys = ["W", "A", "B", "C"];
    // W receives 1.77 SOL: A pays 0.1, B pays 1.67 plus the fee, C does not move
    assert.equal(counterpartyOf(keys, [0, 100, 2000, 5], [177, 90, 1833, 5], 0), "B");
    assert.equal(counterpartyOf(keys, [5000, 0, 0, 0], [0, 0, 0, 0], 0), null, "a fee-only transaction has none");
    assert.match(read("src/lib/burnticker/trust.ts"), /counterparty: counterpartyOf\(keys, tx\.meta\.preBalances, tx\.meta\.postBalances, ix\)/);
    assert.match(read("src/lib/burnticker/trustpack/ledger.ts"), /const cp = counterpartyOf\(keys, tx\.meta\.preBalances, tx\.meta\.postBalances, i\);/);
    plain(`The counterparty is ${COUNTERPARTY_RULE}.`);
  });
  test("a body 57 minutes old is never sent as fresh", () => {
    const now = Date.parse("2026-10-20T04:17:00Z");
    assert.equal(ledgerCacheControl("2026-10-20T03:20:16Z", now), "no-store");
    assert.equal(ledgerCacheControl("2026-10-20T04:15:00Z", now), `public, max-age=${LEDGER_CACHE_SEC - 120}, s-maxage=${LEDGER_CACHE_SEC - 120}`);
    assert.equal(ledgerCacheControl(undefined, now), "no-store");
  });
});

describe("HB-123: the attester list, one row per launched coin with its mint", () => {
  test("drafts are left out, rehearsals labelled, every row has a mint", () => {
    const tokens = [
      { mint: "M1", ticker: "CLARITY", status: "live" }, { mint: "M2", ticker: "CLARITY", status: "draft" }, { mint: "M3", ticker: "CLARITY", status: "expired" },
      { mint: "M4", ticker: "PROBEPHI", status: "live" }, { mint: "M5", ticker: "PITWIN", status: "retired" },
    ];
    const reg = { tokens: () => tokens, attesters: () => [{ active: true, role: "operator" }], testTokens: () => [{ mint: "M4" }], syntheticTokens: () => [] };
    const rows = attesterRows(reg);
    assert.deepEqual(rows.map((r) => r.mint), ["M1", "M4", "M5"]);
    assert.equal(rows.find((r) => r.mint === "M4")!.label, ATTESTER_REHEARSAL_LABEL);
    assert.equal(rows.find((r) => r.mint === "M1")!.label, null);
    plain(ATTESTER_REHEARSAL_LABEL);
    for (const f of ["src/lib/burnticker/api/v1.ts", "src/app/api/burnticker/trust/route.ts"]) assert.match(read(f), /const attesters = attesterRows\(p\.registry\);/);
  });
});

describe("HB-124: the league page counts one-game pair coins and dates games in Denver", () => {
  test("$DENWIN and $SEAWIN put their teams under the teams with coins; the game is on its Denver day", () => {
    const rule = (series: string) => ({ schema: "burnticker.rules/v1", oracle: "catalogue", series, market: null, filter: {}, kind: "scalar", pair: { pairId: "seawin-vs-denwin", side: "A", winnerTakesBurn: true } }) as unknown as BurnRule;   // HB-131: pair sides
    const coin = (ticker: string, abbr: string) => ({ ticker, mint: ticker, rule: rule(gameSeries("nfl", "401772", abbr, "win")), burns: [], burnedPct: 0, ended: false });
    const now = Date.parse("2026-10-20T03:00:00Z");   // 19 October, 9 PM Denver
    const p = leagueSeasonPage({ league: "nfl", year: 2026, coins: [coin("DENWIN", "DEN"), coin("SEAWIN", "SEA")], readings: [], nowMs: now, origin: "https://x", ogImage: "https://x/og" });
    const den = p.teams.find((t) => t.abbr === "DEN")!, sea = p.teams.find((t) => t.abbr === "SEA")!;
    assert.deepEqual(den.coins, [{ ticker: "DENWIN", outcome: ONE_GAME_OUTCOME }]);
    assert.equal(sea.coins.length, 1);
    assert.equal(p.games.to, "2026-10-19", "the range never ends after today in Denver");
    assert.equal(denverDay("2026-10-16T00:20:00Z"), "2026-10-15", "a Thursday night game is the 15th in Denver");
    assert.equal(denverDay("2026-10-15"), "2026-10-15");
  });
});

describe("HS-51: the wizard's last card scrolls clear of the sticky Next bar on a phone", () => {
  test("under 900 px the bottom padding adds the tab bar and 16 px to the bar's height", () => {
    assert.match(page, /pb-\[calc\(var\(--bt-sticky-h,0px\)\+var\(--bt-tabbar-h,62px\)\+env\(safe-area-inset-bottom\)\+26px\)\] min-\[900px\]:pb-\[calc\(var\(--bt-sticky-h,0px\)\+1\.5rem\)\]/);
  });
});
