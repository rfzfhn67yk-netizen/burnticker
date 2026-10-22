// SIXTH-PASS PRELAUNCH AUDIT (2026-10-19): B-10 (HB-51, HB-52), B-14 (HB-54), B-16 (HB-56 to HB-60) and HB-67.
// B-10: "Your coins" and the creator page read every coin at once through one bounded memo (coinPageMemo.ts); a coin still being read
// is "Still loading this coin", never "could not be read", and a rule is a sentence, never a Polymarket condition id.
// B-14: the static home says "Featured coin" and that its figures count mainnet burns.
// B-16: the lock before graduation, both fee tiers with the live one first, which sources settle alone, the disclosed test purchase
// beside "never trades", and the held-swap records on the privacy page. HB-67: no "the The" in a feed's one-liner.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { CREATOR, makeWorld } from "./burntickerApiHelpers.ts";
import { tokenPageData } from "@/lib/burnticker/server";
import { lintCopy } from "@/lib/launch/copyLint";
import { HEX_ID_RE, eventFromStatement, ruleOneLiner, ruleOneLinerFor } from "@/lib/burnticker/coinCard";
import { boundedMemo } from "@/lib/burnticker/boundedMemo";
import { COIN_PAGE_COLD_WAIT_MS, limiter, rememberedCoinPage, type CoinPageReader } from "@/lib/burnticker/coinPageMemo";
import { v1Creator } from "@/lib/burnticker/api/product";
import { CREATOR_PAGE } from "@/lib/burnticker/creatorBenefits";
import { LP_ADMIN_KEY_LINE, LP_BEFORE_GRADUATION_LINE, LP_BEFORE_GRADUATION_TRUST, lpLockLine } from "@/lib/burnticker/lpLockCopy";
import { buildLpLockJson } from "@/lib/burnticker/lockFees";
import { feeFlowLine } from "@/lib/burnticker/tokenPage";
import { POST_GRADUATION_FEES } from "@/lib/burnticker/fees";
import { BOTH_TIERS_LINE, TIER_14_CUTOVER_WORDS } from "@/lib/burnticker/feeShareLine";
import { GAME_CONFIRM_GAP_MINUTES, SETTLEMENT_SOURCES_SENTENCE } from "@/lib/burnticker/singleSource";
import { GAME_CONFIRM_GAP_MS } from "@/lib/burnticker/sources/gameSettle";
import { ADMISSION_RULES, GUARDRAIL_DETAIL } from "@/lib/burnticker/safeguards";
import { NEVER_TRADES_SENTENCE, PRIVACY_HELD_SWAP_BROWSER, PRIVACY_HELD_SWAP_SERVER, PRIVACY_SECTIONS, TERMS_SECTIONS } from "@/lib/burnticker/legalCopy";
import { PRESS_COPY } from "@/lib/burnticker/historyCopy";
import { RECORD_TTL_MS } from "@/lib/burnticker/swap/pendingServer";
import type { BurnRule } from "@/lib/burnticker/rules";

const read = (p: string) => fs.readFileSync(p, "utf8");
const clean = (t: string) => { const r = lintCopy(t); assert.equal(r.ok, true, `${t}\n  hits: ${r.hits.map((h) => h.phrase).join(", ")}`); };
const FIXTURE = JSON.parse(read("test/fixtures/burnticker/registry-rules-2026-10-19.json")) as { coins: { ticker: string; name: string; statement: string; rule: BurnRule }[] };

describe("B-10 / HB-52: the describer never prints a raw id", () => {
  test("every rule in the registry fixture, with and without its venue title and statement, reads as a sentence", () => {
    assert.ok(FIXTURE.coins.length >= 10 && FIXTURE.coins.some((c) => c.rule.oracle === "polymarket") && FIXTURE.coins.some((c) => c.rule.oracle === "catalogue"));
    for (const c of FIXTURE.coins) {
      for (const line of [ruleOneLinerFor(c.rule, null, c.statement, c.ticker), ruleOneLinerFor(c.rule, null, null, c.ticker), ruleOneLiner(c.rule, null)]) {
        assert.doesNotMatch(line, HEX_ID_RE, `${c.ticker}: ${line}`);
        assert.doesNotMatch(line, /\b0x[0-9a-f]{6,}/i, `${c.ticker}: ${line}`);
      }
    }
  });
  test("$TWOCUTS: the event comes from its stored statement; without one the line names its Polymarket market", () => {
    const tc = FIXTURE.coins.find((c) => c.ticker === "TWOCUTS")!;
    assert.equal(eventFromStatement(tc.statement, "TWOCUTS"), "2 Fed rate cuts happen in 2026");
    assert.match(ruleOneLinerFor(tc.rule, null, tc.statement, "TWOCUTS"), /^burns everything if 2 Fed rate cuts happen in 2026\. If not, /);
    assert.match(ruleOneLiner(tc.rule, null), /^burns everything if its Polymarket market settles YES\. /);
    // a venue title still wins when the live read has it
    assert.match(ruleOneLinerFor(tc.rule, "Will the Fed cut twice in 2026?", tc.statement, "TWOCUTS"), /"Will the Fed cut twice in 2026\?" settles YES/);
  });
  test("every other rule kind, by id only, never prints the id", () => {
    const hex = `0x${"ab".repeat(32)}`;
    const kinds: BurnRule[] = [
      { oracle: "polymarket", kind: "binary", market: hex, series: null, binary: { onYes: { fractionOfPool: 0.1 }, onNo: null } } as unknown as BurnRule,
      { oracle: "polymarket", kind: "binary", market: hex, series: null, binary: { onYes: { fractionOfPool: 0.1 }, onNo: { fractionOfPool: 0.1 } } } as unknown as BurnRule,
      { oracle: "polymarket", kind: "binary", market: null, series: hex, binary: { onYes: null, onNo: { fractionOfPool: 1 } }, onEnd: { windDownDays: 28 } } as unknown as BurnRule,
      { oracle: "polymarket", kind: "scalar", market: hex, series: null, scalar: { unit: 1, direction: "up", baseline: 0, perUnit: { fractionOfPool: 0.1 } } } as unknown as BurnRule,
      { oracle: "kalshi", kind: "binary", market: hex, series: null, binary: { onYes: { fractionOfPool: 0.1 }, onNo: null } } as unknown as BurnRule,
    ];
    for (const r of kinds) { const l = ruleOneLinerFor(r, null, null, "COIN"); assert.doesNotMatch(l, HEX_ID_RE, l); }
  });
});

describe("HB-67: no doubled article", () => {
  test("$NEXTM6 reads 'burns on the next reviewed …', never 'the The'", () => {
    const m6 = FIXTURE.coins.find((c) => c.ticker === "NEXTM6")!;
    const line = ruleOneLiner(m6.rule, "The next reviewed magnitude 6 or more anywhere in the world (USGS)");
    // hourly run 6 HB-67: the line names the earthquake (it no longer burns "on a feed")
    assert.equal(line, "burns once, on the next reviewed earthquake of magnitude 6 or more anywhere in the world (USGS)");
    assert.doesNotMatch(line, /\bthe the\b/i);
    assert.equal(ruleOneLiner(m6.rule, "Daily debt"), "burns on the Daily debt feed");
  });
});

describe("B-10 / HB-51: coins read at once from a bounded memo", () => {
  test("boundedMemo: a hung read counts as failed after readMs, and a failed read is retried (and waited for) after nullMs", async () => {
    let clock = 0, calls = 0;
    const m = boundedMemo<number>({ freshMs: 60_000, coldWaitMs: 50, readMs: 30, nullMs: 1_000, now: () => clock });
    assert.equal(await m.get("k", () => { calls++; return new Promise(() => {}); }), null, "the cold wait ends first");
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(await m.get("k", async () => { calls++; return 1; }), null, "the failure is kept until nullMs");
    assert.equal(calls, 1);
    clock = 1_000;
    assert.equal(await m.get("k", async () => { calls++; return 7; }), 7, "retried and waited for");
    assert.equal(await m.get("k", async () => { calls++; return 8; }), 7, "fresh: served from memory");
    assert.equal(calls, 2);
  });
  test("limiter: at most N at once", async () => {
    const gate = limiter(2);
    let on = 0, peak = 0;
    await Promise.all(Array.from({ length: 7 }, () => gate(async () => { on++; peak = Math.max(peak, on); await new Promise((r) => setTimeout(r, 5)); on--; })));
    assert.equal(peak, 2);
  });
  test("GET /v1/creators/{wallet}: slow coin reads run together; the answer comes by the cold wait with each slow coin marked loading, then in full", async () => {
    const w = await makeWorld();
    let started = 0;
    const slow: CoinPageReader = async (p, t, n) => { started++; await new Promise((r) => setTimeout(r, COIN_PAGE_COLD_WAIT_MS + 400)); return tokenPageData(p, t, n); };
    const t0 = Date.now();
    const first = await v1Creator(w.p, CREATOR, Date.now(), slow);
    const took = Date.now() - t0;
    assert.equal(first.status, 200);
    const coins = (first.body as { coins: { ticker: string; loading: boolean; receipts: number; page: string }[] }).coins;
    assert.ok(coins.length >= 2, "every coin is listed");
    assert.ok(took < COIN_PAGE_COLD_WAIT_MS + 1_000, `one cold wait for all the coins, not one per coin (${took} ms)`);
    assert.equal(started, coins.length, "all the reads started at once");
    assert.ok(coins.every((c) => c.loading && c.page.startsWith("/burnticker/t/") && typeof c.receipts === "number"), "registry facts while loading");
    await new Promise((r) => setTimeout(r, 700));
    const again = await v1Creator(w.p, CREATOR, Date.now(), slow);
    const full = (again.body as { coins: { loading: boolean; todayPost: { text: string } }[] }).coins;
    assert.ok(full.every((c) => !c.loading && c.todayPost.text.length > 0), "the next call is served from the memo, in full");
    assert.equal(started, coins.length, "no second read while fresh");
    assert.notEqual(await rememberedCoinPage(w.p, w.registry.tokens().find((t) => t.creator === CREATOR)!, Date.now(), slow), null);
  });
  test("the creator page: a coin still being read says so (lint-clean), and the page has the loading line", () => {
    for (const t of [CREATOR_PAGE.coinLoading, CREATOR_PAGE.loading(1), CREATOR_PAGE.loading(5)]) clean(t);
    assert.equal(CREATOR_PAGE.coinLoading, "Still loading this coin. Refresh in a few seconds.");
    const page = read("src/app/burnticker/creator/[wallet]/page.tsx");
    assert.match(page, /data-creator-loading/); assert.match(page, /CREATOR_PAGE\.loading\(d\.loading\)/);
    const serve = read("src/lib/burnticker/creatorServe.ts");
    assert.match(serve, /rememberedCoinPage\(plat, t, now\)/); assert.match(serve, /ruleOneLinerFor\(/); assert.doesNotMatch(serve, /ruleOneLiner\(/);
    assert.match(read("src/lib/burnticker/tokenPage.ts"), /oneLiner: ruleOneLinerFor\(rule, i\.seriesTitle, t\.description, t\.ticker\)/);
    assert.doesNotMatch(read("src/lib/burnticker/api/product.ts"), /for \(const t of mine\)/, "no coin-by-coin loop");
  });
});

describe("B-14 / HB-54: the static home", () => {
  test("the heading is 'Featured coin' and the note counts mainnet burns; no 'test receipts' and no devnet practice-burn note", () => {
    const home = read("site/burnticker/index.html");
    assert.match(home, /<h2 id="coins-h">Featured coin<\/h2>/);
    assert.match(home, /<p class="stats-note" data-stats-note>These figures count burns on mainnet\.<\/p>/);
    assert.equal((home.match(/test receipts/g) ?? []).length, 0);
    assert.doesNotMatch(home, /count the devnet practice burns/);
  });
});

describe("B-16: honest copy", () => {
  test("(a/b) before graduation no lock percentage is claimed, and the admin key that can change the settings is named", () => {
    for (const t of [LP_BEFORE_GRADUATION_LINE, LP_ADMIN_KEY_LINE, LP_BEFORE_GRADUATION_TRUST]) clean(t);
    assert.equal(LP_BEFORE_GRADUATION_LINE, "When this coin graduates, all of its liquidity is locked forever. Until then, the platform settings that lock it can be changed by the operator's LaunchLab admin key, and the Trust page shows those settings live.");
    const lp = buildLpLockJson({ cluster: "mainnet", state: null, feeKeysPda: null, operatorTreasury: null, claims: [] });
    assert.equal(lp.lockedPct, null); assert.match(lp.note!, /operator's LaunchLab admin key/);
    assert.equal(buildLpLockJson({ cluster: "mainnet", state: { graduated: true, lockedPct: 100 } as never, feeKeysPda: null, operatorTreasury: null, claims: [] }).lockedPct, 100);
    assert.equal(lpLockLine(null), LP_BEFORE_GRADUATION_LINE); assert.equal(lpLockLine(100), "The liquidity is locked forever.");
    assert.match(feeFlowLine(POST_GRADUATION_FEES, null), /When this coin graduates, all of its liquidity is locked forever\./);
    assert.doesNotMatch(feeFlowLine(POST_GRADUATION_FEES, null), /The liquidity is locked forever\./);
    assert.match(read("src/app/burnticker/t/[ticker]/page.tsx"), /lpLockLine\(s\.trust\?\.lpLockedPct \?\? null\)/);
    assert.match(read("src/app/burnticker/trust/page.tsx"), /data-lp-before-graduation>\{LP_BEFORE_GRADUATION_TRUST\}/);
  });
  test("a coin's JSON claims a lock percentage only once its lock is read or its pool is registered, and its fee line agrees", async () => {
    const w = await makeWorld();
    for (const t of w.registry.tokens().filter((x) => x.creator === CREATOR && x.status === "live")) {
      const d = await tokenPageData(w.p, t, Date.now());
      const registered = !!d.status.program?.pool.registered;
      assert.equal(d.status.lp?.lockedPct ?? null, null, "the fake world has not graduated any lock");
      assert.equal(d.status.trust.lpLockedPct, registered ? 100 : null);
      if (d.status.lifecycle) assert.match(d.status.lifecycle.fees, registered ? /The liquidity is locked forever\./ : /When this coin graduates, all of its liquidity is locked forever\./);
    }
  });
  test("(c) both tiers, the one every live coin pays first, on the trust page body, current status and the trust JSON", () => {
    clean(BOTH_TIERS_LINE);
    // eighth pass B-23: one split for every coin, the platform's current tier (HS-71 words)
    assert.match(BOTH_TIERS_LINE, /^After graduation, every coin pays 1\.25% per swap \(Raydium fee tier 14\): about 0\.98% to the burn pool, 0\.13% to the operator and 0\.15% to Raydium\./);
    assert.doesNotMatch(BOTH_TIERS_LINE, /0\.88%|fee tier 9/);
    // hourly run 5, HS-26: the trust page prints the server's fee line (the footer's shape), BOTH_TIERS_LINE when the JSON has none
    assert.match(read("src/app/burnticker/trust/page.tsx"), /\{t\.feeTiersLine \?\? BOTH_TIERS_LINE\}/);
    assert.doesNotMatch(read("src/app/burnticker/trust/page.tsx"), /postGraduationShareLine\(t\.designedFees\.postGraduation\)/);
    assert.match(read("src/lib/burnticker/currentStatus.ts"), /\$\{bothTiersLineNow\(tierPinPendingLive\(vb, mainBurnLive\)\)\}/);   // HS-96: BOTH_TIERS_LINE plus the tier-pin sentence while pending
    assert.ok(Object.values(GUARDRAIL_DETAIL).some((d) => d.text.includes(BOTH_TIERS_LINE)));
  });
  test("(d) which sources settle alone, and the one-source rule for games", () => {
    clean(SETTLEMENT_SOURCES_SENTENCE);
    assert.equal(GAME_CONFIRM_GAP_MINUTES * 60_000, GAME_CONFIRM_GAP_MS);
    assert.equal(SETTLEMENT_SOURCES_SENTENCE, "Each result comes from a primary source. Most rules also need a second, independent publisher to agree, or the on-chain payout of an adjudicated Polymarket market. A few rules use one official source alone, and their rule text says so: the natural-hazard feeds from the U.S. Geological Survey, the National Hurricane Center, the Storm Prediction Center and the National Interagency Fire Center. A game coin settles once its final has been read and a second read five minutes later agrees.");
    assert.ok(ADMISSION_RULES.includes(SETTLEMENT_SOURCES_SENTENCE));
    assert.doesNotMatch(ADMISSION_RULES, /second, independent publisher confirms/);
  });
  test("(e) 'never trades' carries the disclosed test purchase in the terms, the press page and the fee ledger note", () => {
    clean(NEVER_TRADES_SENTENCE);
    assert.match(NEVER_TRADES_SENTENCE, /^Apart from two disclosed tests \(0\.1 SOL of \$REHEARSAL at creation, and a 0\.10 SOL purchase and immediate sale of \$SEAWIN minutes after it was created\), the platform never trades\. (?:The \$SEAWIN test was made |The operator has not yet written down why that test was made\.)/);   // ninth pass B-26 / HS-95
    assert.ok(TERMS_SECTIONS.some((s) => s.paragraphs.some((p) => p.startsWith(NEVER_TRADES_SENTENCE))));
    const press = PRESS_COPY.not.find((x) => /exchange/.test(x))!;
    clean(press);
    assert.match(press, /^Burnticker is not an exchange, and it never takes an order\. Apart from two disclosed tests \(0\.1 SOL of \$REHEARSAL at creation, and a 0\.10 SOL purchase and immediate sale of \$SEAWIN minutes after it was created\), it never trades a coin\. (?:The \$SEAWIN test was made |The operator has not yet written down why that test was made\.)/);
    const ledger = read("config/burnticker/expenses.json");
    assert.match(ledger, /Apart from two disclosed tests \(0\.1 SOL of \$REHEARSAL at creation, and a 0\.10 SOL purchase and immediate sale of \$SEAWIN on 2026-10-15\), the operator never trades a coin launched here\. (?:The \$SEAWIN test was made |The operator has not yet written down why that test was made\.)/);
    assert.doesNotMatch(ledger, /never buys any coin/);
    const team = GUARDRAIL_DETAIL["no team buy"].text;
    assert.doesNotMatch(team, /The one exception is \$REHEARSAL, a disclosed test coin/, "the exception sentence is not printed twice in a row");
  });
  test("(f) the privacy page lists the held-swap records, browser and server", () => {
    for (const t of [PRIVACY_HELD_SWAP_BROWSER, PRIVACY_HELD_SWAP_SERVER]) clean(t);
    assert.equal(RECORD_TTL_MS, 24 * 3_600_000 + 10 * 60_000, "the server's 24 hours and 10 minutes");
    assert.ok(PRIVACY_SECTIONS.find((s) => s.id === "browser")!.paragraphs.includes(PRIVACY_HELD_SWAP_BROWSER));
    assert.ok(PRIVACY_SECTIONS.find((s) => s.id === "server")!.paragraphs.includes(PRIVACY_HELD_SWAP_SERVER));
    for (const f of ["network", "coin", "wallet", "signature", "purchase or sale", "expiry"]) assert.match(PRIVACY_HELD_SWAP_SERVER, new RegExp(f));
  });
});
