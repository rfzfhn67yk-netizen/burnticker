// CAMPAIGN READINESS (2026-10-19): the fixes that most affect trust and conversion for a visitor arriving from X. One describe per item:
// 1 a true first paint on the $DEFICIT site, 3 queued readings are not receipts, 4 what graduation counts, 5 counted trade links,
// 6 the feed and the calendar beside Follow, 7 campaign parameters, 8 the curve state on the card button.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { formatHits, lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import { deficitFirstPaint, visibleHtml } from "@/lib/burnticker/deficitFirstPaint";
import { burnLogWords, isExecutedBurn, isQueuedReading, QUEUED_READING, queuedReadingsCount } from "@/lib/burnticker/queuedReading";
import { graduationExplainer } from "@/lib/burnticker/graduationLine";
import { coinLinks, curveSwapLabel, goDestination, goHref, jupiterUrl, launchLabUrl, linkHref, LINK_LABELS, raydiumSwapUrl } from "@/lib/burnticker/tradeLinks";
import { countTradeClick, goRedirect, tradeClickCounts } from "@/lib/burnticker/tradeClicks";
import { RateLimiter } from "@/lib/burnticker/api/http";
import { RATE_LIMITS } from "@/lib/burnticker/api/spec";
import { openRegistry, type TokenRow } from "@/lib/burnticker/registry";
import { lockRule } from "@/lib/burnticker/rules";
import { buildOpsJson } from "@/lib/burnticker/checkin";
import { PRIVACY_SECTIONS, PRIVACY_TRADE_CLICK_SENTENCE } from "@/lib/burnticker/legalCopy";
import { calendarIcsHref, NEXT_RESULT_LABELS, NEXT_RESULT_LEAD, nextResultLinks } from "@/lib/burnticker/followFeeds";
import { treasuryCalendar } from "@/lib/burnticker/calendar";
import { hasTrackingParams, isTrackingParam, withoutTrackingParams } from "@/lib/burnticker/trackingParams";
import { cardViewFromIndex, type IndexCoin } from "@/lib/burnticker/cardView";
import { DENVER_HIGH } from "./burntickerHelpers.ts";

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const cfg = loadCopyLintConfig();
const clean = (t: string, what = t) => { const r = lintCopy(t, cfg); assert.ok(r.ok, `${what}:\n${formatHits(r)}`); };
const noArrows = (t: string) => assert.doesNotMatch(t, /[→←↗↘⇒]|->|=>/, t);
const DEFICIT = "AJJ4XxCUYr8zzMWm8FYg3xh638LYAAApdNqWBqCK4oqj";
const EAGLES = "J45hvg6FYGzDMj3iYS3BJPU2pwqfoZhA7B8isnW4fin8";
const NOW = Date.parse("2026-10-20T00:05:00Z");
const TEMPLATE = read("site/deficit/index.html");
const PAGE = TEMPLATE;

/** The keeper's live status.json shape on 2026-10-19 (on its curve, 0 of 85 SOL, a 3 SOL seed), trimmed to what the page reads. */
const onCurveStatus = (o: { threshold?: string; seed?: string; phase?: string; state?: string } = {}) => ({
  schema: "burnkeeper.status/v1", generatedAt: "2026-10-19T23:41:12.085Z", ticker: "DEFICIT", cluster: "mainnet",
  addresses: { mint: DEFICIT }, program: { initialized: true },
  readiness: { state: o.state ?? "on-curve", label: "On the curve, waiting for graduation", detail: `0 of ${o.threshold ?? "85"} SOL raised so far. Trading fees collect in the burn pool, but nothing can burn before the curve graduates and its pool is registered.` },
  curve: { phase: o.phase ?? "curve", raised: "0.00000004", threshold: o.threshold ?? "85", quote: "SOL", progressPct: 0, readAt: "2026-10-19T23:41:12.085Z" },
  feed: { lastRecordDate: "2026-10-16", lastAmount: "40387508795231.67", readings: 5, lastPollAt: "2026-10-19T20:30:00.003Z", nextPollAt: "2026-10-20T00:00:00.000Z" },
  burned: { total: "0", pctOfSupply: 0, count: 0, thisMonth: "0" }, supply: { initial: "1000000000" },
  health: { pending: 2, lastError: null, unverified: 0 },
  buyback: { feePoolSol: "3.000001", funding: { seedSol: o.seed ?? "3" } },
});
const planned = { recordDate: "2026-10-13", prevDate: "2026-10-09", prev: "40301480531899.65", now: "40343879238035.67", delta: "42398706136.02", units: 42, status: "planned", spent: null, got: null, burned: null, signature: null, txUrl: null };
const confirmed = { recordDate: "2026-10-15", prevDate: "2026-10-14", prev: "40329229827541.02", now: "40388317675071.91", delta: "59087847530.89", units: 59, status: "confirmed", spent: "0.0612", got: "1234567", burned: "1234567", signature: "5sigSIGsig5sigSIGsig", txUrl: "https://explorer.solana.com/tx/5sigSIGsig5sigSIGsig" };

describe("1. the $DEFICIT site's first paint says what the keeper says", () => {
  const out = deficitFirstPaint(TEMPLATE, onCurveStatus(), [planned], { now: NOW });
  const vis = visibleHtml(out).replace(/&#39;/g, "'");
  test("on its curve: no 'Not launched', no 'Trading not available', no 'Step 0 of 6' in the served HTML", () => {
    assert.match(TEMPLATE, /Not launched/); // the template still carries the pre-launch default
    for (const bad of [/Not launched/, /Trading not available/, /Step 0 of 6/, /not available until launch/i, /has not launched on this network/]) assert.doesNotMatch(vis, bad, String(bad));
    assert.doesNotMatch(out, /Trading not available/, "not even in the script");
    assert.doesNotMatch(out, /<html lang="en" class="prelaunch">/);
  });
  test("the readiness box: step 2 of 6, the keeper's label and detail, and the time it was read", () => {
    assert.match(vis, /Step 2 of 6 toward a first burn/);
    assert.match(vis, /On the curve, waiting for graduation/);
    assert.match(vis, /0 of 85 SOL raised so far/);
    assert.match(vis, /This page read the coin's state at 2026-10-19 23:41 UTC\./);
    assert.match(out, /id="readiness" data-readiness="on-curve"/);
  });
  test("the trade controls are live, counted links to Raydium's launchpad page for the mint", () => {
    const href = `https://burnticker.com/burnticker/go/raydium?mint=${DEFICIT}`;
    for (const id of ["tradeTop", "tradeHero", "tradeFoot"]) assert.match(out, new RegExp(`<a[^>]*id="${id}" href="${href.replace(/[?.]/g, "\\$&")}" target="_blank" rel="noopener" data-trade-link>`), id);
    assert.match(vis, new RegExp(`The trade link is ${launchLabUrl(DEFICIT).replace(/[?.]/g, "\\$&")}`));
  });
  test("the live strip, the queue and the receipts table come from the files", () => {
    assert.match(vis, /\$40\.388T/); assert.match(vis, /\$40,387,508,795,231\.67 on 2026-10-16/);
    assert.match(out, /id="queue" data-queue="queued"/);
    assert.match(vis, /42 more units are recorded by the keeper/);
  });
  test("a pre-launch or unreadable status leaves the template as it is", () => {
    assert.equal(deficitFirstPaint(TEMPLATE, JSON.parse(read("site/deficit/status.json")), { burns: [] }), TEMPLATE);
    assert.equal(deficitFirstPaint(TEMPLATE, null, null), TEMPLATE);
  });
  test("an unreadable burns.json is unavailable, never zero", () => {
    const v = visibleHtml(deficitFirstPaint(TEMPLATE, onCurveStatus(), null, { now: NOW }));
    assert.match(v, /The receipt history did not load just now/);
    assert.doesNotMatch(v, /No burns yet/);
  });
  test("the script writes the page once and is quiet when nothing changed; deploy-sites.sh runs it on every publish", (t) => {
    // scripts/ops/ is monorepo-private (deploy tooling); the public tree has neither file, so this check runs only where they exist
    if (!fs.existsSync(path.join(ROOT, "scripts/ops/deficit-first-paint.mts")) || !fs.existsSync(path.join(ROOT, "scripts/ops/deploy-sites.sh"))) { t.skip("monorepo-only deploy tooling"); return; }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "deficit-fp-"));
    fs.writeFileSync(path.join(dir, "status.json"), JSON.stringify(onCurveStatus()));
    fs.writeFileSync(path.join(dir, "burns.json"), JSON.stringify([planned]));
    const run = () => spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--import", "./test/alias-hook.mjs", "scripts/ops/deficit-first-paint.mts", "site/deficit/index.html", path.join(dir, "status.json"), path.join(dir, "burns.json"), path.join(dir, "index.html")], { encoding: "utf8" });
    const a = run();
    assert.equal(a.status, 0, a.stderr); assert.match(a.stdout, /rendered from status\.json \(readiness on-curve\)/);
    assert.doesNotMatch(visibleHtml(fs.readFileSync(path.join(dir, "index.html"), "utf8")), /Not launched|Trading not available/);
    const b = run();
    assert.equal(b.status, 0, b.stderr); assert.equal(b.stdout, "");
    const sh = read("scripts/ops/deploy-sites.sh");
    assert.match(sh, /site deficit site\/deficit "\$BK_PUB" "\$DEFICIT_WWW" status\.html\n  deficit_first_paint\n/);
    assert.match(sh, /scripts\/ops\/deficit-first-paint\.mts site\/deficit\/index\.html "\$BK_PUB\/status\.json" "\$BK_PUB\/burns\.json" "\$DEFICIT_WWW\/index\.html"/);
  });
});

describe("3. queued readings are not receipts", () => {
  test("the words: a planned or sending row is a queued reading; only a confirmed row is a receipt", () => {
    assert.equal(QUEUED_READING, "Queued reading, no burn yet"); clean(QUEUED_READING);
    for (const s of ["planned", "sending", "swap-sent", "swapped"]) { assert.ok(isQueuedReading(s), s); assert.equal(burnLogWords(s), QUEUED_READING); }
    assert.ok(isExecutedBurn(confirmed)); assert.ok(!isExecutedBurn(planned));
    assert.equal(burnLogWords("skipped"), "nothing was bought");
    assert.equal(queuedReadingsCount(2), "2 queued readings"); assert.equal(queuedReadingsCount(1), "1 queued reading");
  });
  test("the $DEFICIT site's first paint: the planned row says so and is not a receipt; the executed row is", () => {
    const out = deficitFirstPaint(TEMPLATE, onCurveStatus({ state: "awaiting-event" }), [planned, confirmed], { now: NOW });
    const rows = /<tbody id="rows">([\s\S]*?)<\/tbody>/.exec(out)![1];
    const p = /<tr id="r-1"[^>]*>[\s\S]*?<\/tr>/.exec(rows)![0], c = /<tr id="r-2"[^>]*>[\s\S]*?<\/tr>/.exec(rows)![0];
    assert.match(p, /data-queued=""/); assert.match(p, /Queued reading, no burn yet/); assert.doesNotMatch(p, /receipt/i); assert.match(p, /2026-10-13/);
    assert.match(c, /title="receipt"/); assert.match(c, /<b>1,234,567<\/b>/); assert.doesNotMatch(c, /Queued/);
  });
  test("the $DEFICIT site's script: the same rule in the table and the hero caption ('See receipt #2' is gone)", () => {
    const block = /\/\* @queued-begin[^*]*\*\/([\s\S]*?)\/\* @queued-end \*\//.exec(PAGE)?.[1] ?? "";
    const fmtInt = (s: string) => String(s).replace(/\B(?=(\d{3})+(?!\d))/g, ","), esc = (s: string) => s;
    const { heroCaption, isQueued, QUEUED_READING: Q } = new Function("fmtInt", "esc", `${block}; return { heroCaption, isQueued, QUEUED_READING };`)(fmtInt, esc) as { heroCaption: (b: unknown, t: string, n: number) => string; isQueued: (b: unknown) => boolean; QUEUED_READING: string };
    assert.equal(Q, QUEUED_READING);
    assert.ok(isQueued(planned)); assert.ok(!isQueued(confirmed));
    const hp = heroCaption(planned, "DEFICIT", 2), hc = heroCaption(confirmed, "DEFICIT", 2);
    assert.match(hp, /Queued reading, no burn yet\. <a href="#r-2">See the queued reading<\/a>/); assert.doesNotMatch(hp, /receipt/i);
    assert.match(hc, /1,234,567<\/b> \$DEFICIT were bought and burned\. <a href="#r-2">See the receipt<\/a>/);
    assert.doesNotMatch(PAGE, /See receipt #/); assert.doesNotMatch(PAGE, /title=\\"receipt #/);
    assert.match(PAGE, /'<span class="muted">' \+ esc\(queued \? QUEUED_READING : b\.status\) \+ "<\/span>"/);
  });
  test("the coin page's burn log uses the same words, and counts queued readings, not receipts", () => {
    const p = read("src/app/burnticker/t/[ticker]/page.tsx");
    assert.doesNotMatch(p, /receiptStatusWords\(b\.status\)/);
    assert.equal((p.match(/burnLogWords\(b\.status\)/g) ?? []).length, 3);
    assert.match(p, /value: s\.health\.pending === 0 \? "Nothing waiting" : queuedReadingsCount\(s\.health\.pending\)/);
    // hourly run 7, HB-96: the health line is one shared sentence (queuedReading.ts healthLine), the same on the static page
    assert.match(p, /\{healthLine\(s\.health\.pending, s\.health\.unverified\)\}/);
    // "Check receipt" stays on rows with a signature only
    assert.match(p, /const href = checkReceiptHref\(b\.signature, s\.cluster\); return href \?/);
  });
});

describe("4. what graduation counts, from the coin's config and the disclosed seed", () => {
  test("the sentence, and nothing when the raise was not read", () => {
    assert.equal(graduationExplainer("85", "SOL", "3"), "Graduation needs 85 SOL of net swapping into the coin on its curve. Swaps in count, swaps out subtract, and the 3 SOL seed in the burn pool does not count.");
    assert.equal(graduationExplainer("85", "SOL", null), "Graduation needs 85 SOL of net swapping into the coin on its curve. Swaps in count, and swaps out subtract. A gift to the burn pool does not count.");
    assert.equal(graduationExplainer(null, "SOL", "3"), null); assert.equal(graduationExplainer("", "SOL"), null);
    assert.match(graduationExplainer("90", "SOL", 2)!, /needs 90 SOL .* the 2 SOL seed/);
    clean(graduationExplainer("85", "SOL", "3")!); clean(graduationExplainer("85", "SOL", null)!);
  });
  test("the $DEFICIT site's script carries the same sentence", () => {
    const block = /\/\* @graduation-begin[^*]*\*\/([\s\S]*?)\/\* @graduation-end \*\//.exec(PAGE)?.[1] ?? "";
    const graduationLine = new Function(`${block}; return graduationLine;`)() as (t: unknown, q: unknown, s: unknown) => string | null;
    for (const [t, q, s] of [["85", "SOL", "3"], ["85", "SOL", null], ["90.5", "SOL", "2.25"], [null, "SOL", "3"]] as const) assert.equal(graduationLine(t, q, s), graduationExplainer(t, q, s), `${t} ${s}`);
    assert.match(PAGE, /<p class="rd" id="gradLine" hidden><\/p>/);
  });
  test("derived, never typed: the first paint follows the status file's raise and seed", () => {
    assert.match(visibleHtml(deficitFirstPaint(TEMPLATE, onCurveStatus(), [], { now: NOW })), /Graduation needs 85 SOL of net swapping into the coin on its curve\. Swaps in count, swaps out subtract, and the 3 SOL seed in the burn pool does not count\./);
    const v = visibleHtml(deficitFirstPaint(TEMPLATE, onCurveStatus({ threshold: "90", seed: "2" }), [], { now: NOW }));
    assert.match(v, /Graduation needs 90 SOL .* the 2 SOL seed/); assert.doesNotMatch(v, /Graduation needs 85/);
    assert.doesNotMatch(visibleHtml(deficitFirstPaint(TEMPLATE, onCurveStatus({ phase: "graduated", state: "awaiting-registration" }), [], { now: NOW })), /Graduation needs/);
    assert.doesNotMatch(read("src/lib/burnticker/graduationLine.ts"), /\b85\b|"3"/);
  });
  test("the coin page and the $DEFICIT page print it under the graduation bar", () => {
    assert.match(read("src/app/burnticker/t/[ticker]/page.tsx"), /data-graduation-explainer>\{graduationExplainer\(m\?\.curve\?\.threshold \?\? null, m\?\.curve\?\.quote \?\? "SOL"\)\}/);
    assert.match(read("src/app/burnticker/t/[ticker]/DeficitPrelaunch.tsx"), /data-graduation-explainer>\{graduationExplainer\(c\.threshold, "SOL", d\.launch\.seedSol \?\? null\)\}/);
    assert.equal(JSON.parse(read("config/burnticker/current-status.json")).deficit.launch.seedSol, 3);
  });
});

describe("5. counted trade links", () => {
  const registry = () => {
    const reg = openRegistry(":memory:");
    const row = (mint: string, ticker: string, status: TokenRow["status"]) => reg.register({ mint, ticker, name: ticker, creator: "8sJfoY6Xx6o2zZqmX2Vt6NRwzNPr14Ef6qqRd5YLvGbs", description: "", imageUrl: null, links: [], rulesText: lockRule(DENVER_HIGH).text, feePda: "F", vault: null, tokenConfig: null, poolId: null, launchTx: null, cluster: "mainnet", platformId: null, baselineAt: "2026-10-13T00:00:00Z", status });
    row(EAGLES, "PHINFLWIN", "live");
    return reg;
  };
  const deps = (reg: ReturnType<typeof openRegistry>, limiter = new RateLimiter()) => ({
    listed: (m: string) => m === DEFICIT || (!!reg.token(m) && reg.token(m)!.status !== "expired"),
    count: (m: string, v: "raydium" | "jupiter", now: number) => countTradeClick(reg.db, m, v, now), now: NOW, limiter,
  });
  const get = (url: string) => new Request(`https://burnticker.com${url}`, { headers: { "x-real-ip": "203.0.113.9" } });
  test("the builder: each trade link carries the counted address; the venue address is unchanged", () => {
    const c = coinLinks({ cluster: "mainnet", mint: EAGLES, phase: "curve", status: "live" });
    assert.equal(c.primary?.url, launchLabUrl(EAGLES)); assert.equal(c.primary?.href, `/burnticker/go/raydium?mint=${EAGLES}`);
    assert.equal(c.trade[1].href, `/burnticker/go/jupiter?mint=${EAGLES}`);
    assert.equal(coinLinks({ cluster: "mainnet", mint: EAGLES, phase: "graduated", status: "live" }).primary?.href, `/burnticker/go/raydium?mint=${EAGLES}&to=swap`);
    for (const l of c.info) assert.equal(linkHref(l), l.url, "chart and explorer links are not counted");
  });
  test("the route redirects to the same URL the link replaced, with no-store and no cookie", () => {
    const reg = registry();
    for (const [phase, venue] of [["curve", "raydium"], ["graduated", "raydium"], ["curve", "jupiter"]] as const) {
      const link = coinLinks({ cluster: "mainnet", mint: EAGLES, phase, status: "live" }).trade.find((l) => (venue === "jupiter" ? l.id === "jupiter" : l.id !== "jupiter"))!;
      const r = goRedirect(get(link.href!), venue, deps(reg));
      assert.equal(r.status, 302); assert.equal(r.headers.get("location"), link.url, `${phase} ${venue}`);
      assert.equal(r.headers.get("cache-control"), "no-store"); assert.equal(r.headers.get("set-cookie"), null);
    }
    assert.equal(goDestination("raydium", EAGLES, "swap"), raydiumSwapUrl(EAGLES)); assert.equal(goDestination("jupiter", EAGLES, null), jupiterUrl(EAGLES));
    assert.equal(goRedirect(get(goHref("raydium", DEFICIT)), "raydium", deps(reg)).headers.get("location"), launchLabUrl(DEFICIT), "$DEFICIT is listed by its mint");
  });
  test("an unknown mint, a malformed one and an unknown venue are refused and not counted", () => {
    const reg = registry();
    const unknown = "So11111111111111111111111111111111111111112";
    assert.equal(goRedirect(get(`/burnticker/go/raydium?mint=${unknown}`), "raydium", deps(reg)).status, 404);
    assert.equal(goRedirect(get("/burnticker/go/raydium?mint=https://evil.example"), "raydium", deps(reg)).status, 400);
    assert.equal(goRedirect(get(`/burnticker/go/evil?mint=${EAGLES}`), "evil", deps(reg)).status, 404);
    assert.deepEqual(tradeClickCounts(reg.db, NOW), []);
  });
  test("each hit counts once, per coin, venue and day; the counts carry nothing about the visitor", () => {
    const reg = registry();
    goRedirect(get(goHref("raydium", EAGLES)), "raydium", deps(reg));
    goRedirect(get(goHref("raydium", EAGLES)), "raydium", deps(reg));
    goRedirect(get(goHref("jupiter", EAGLES)), "jupiter", deps(reg));
    assert.deepEqual(tradeClickCounts(reg.db, NOW), [{ day: "2026-10-20", mint: EAGLES, venue: "jupiter", clicks: 1 }, { day: "2026-10-20", mint: EAGLES, venue: "raydium", clicks: 2 }]);
    const rows = reg.db.prepare("SELECT key, value FROM status WHERE key LIKE 'trade-clicks:%'").all() as { key: string; value: string }[];
    assert.deepEqual(rows.map((r) => r.key).sort(), [`trade-clicks:2026-10-20:${EAGLES}:jupiter`, `trade-clicks:2026-10-20:${EAGLES}:raydium`]);
    assert.ok(!JSON.stringify(rows).includes("203.0.113.9"));
    assert.deepEqual(tradeClickCounts(reg.db, NOW + 20 * 86_400_000), [], "only the last fourteen days");
  });
  test("rate limited like the other routes", () => {
    const reg = registry();
    const tiny = new RateLimiter({ ...RATE_LIMITS, read: { burst: 1, refillPerSec: 0.001, human: "one" } });
    assert.equal(goRedirect(get(goHref("raydium", EAGLES)), "raydium", deps(reg, tiny)).status, 302);
    const r = goRedirect(get(goHref("raydium", EAGLES)), "raydium", deps(reg, tiny));
    assert.equal(r.status, 429); assert.equal(tradeClickCounts(reg.db, NOW)[0].clicks, 1);
  });
  test("the counts are in ops.json only; the keeper passes them", () => {
    const ops = buildOpsJson({ now: NOW, snapshot: null, delta: null, alerts: null, firstLaunchAt: null, tradeClicks: [{ day: "2026-10-20", mint: EAGLES, venue: "raydium", clicks: 2 }] });
    assert.deepEqual(ops.tradeClicks, [{ day: "2026-10-20", mint: EAGLES, venue: "raydium", clicks: 2 }]);
    assert.match(read("scripts/burnticker-keeper.mts"), /tradeClicks: \(\(\) => \{ try \{ return tradeClickCounts\(registry\.db, now\); \} catch \{ return null; \} \}\)\(\)/);
    assert.match(read("src/app/burnticker/go/[venue]/route.ts"), /countTradeClick\(p\.registry\.db, mint, v, now\)/);
  });
  test("every surface links the counted address: the shared buttons, the swap panel's row, the static home card, the $DEFICIT site", () => {
    const b = read("src/app/burnticker/_components/TradeLinks.tsx");
    assert.match(b, /href=\{linkHref\(links\.primary\)\}/); assert.match(b, /href=\{linkHref\(l\)\}/);
    assert.match(read("src/app/burnticker/t/[ticker]/TradePanel.tsx"), /href=\{l\.href \?\? l\.url\}/);
    assert.match(read("site/burnticker/index.html"), /ln\.href = x\.href \|\| x\.url;/);
    // the $DEFICIT site maps each venue address the builder forms to its counted link; anything else is linked as is
    assert.match(PAGE, /var GO = "https:\/\/burnticker\.com\/burnticker\/go";/);
    const block = /\/\* @counted-begin \*\/([\s\S]*?)\/\* @counted-end \*\//.exec(PAGE)?.[1] ?? "";
    const counted = new Function("GO", `${block}; return counted;`)("https://burnticker.com/burnticker/go") as (u: string) => string;
    const o = { origin: "https://burnticker.com" };
    assert.equal(counted(launchLabUrl(DEFICIT)), goHref("raydium", DEFICIT, o));
    assert.equal(counted(raydiumSwapUrl(DEFICIT)), goHref("raydium", DEFICIT, { ...o, swap: true }));
    assert.equal(counted(jupiterUrl(DEFICIT)), goHref("jupiter", DEFICIT, o));
    assert.equal(counted(`https://dexscreener.com/solana/${DEFICIT}`), `https://dexscreener.com/solana/${DEFICIT}`);
    assert.equal(counted("https://evil.example/?mint=x"), "https://evil.example/?mint=x");
    assert.match(PAGE, /a\.href = counted\(url\);/);
    assert.match(PAGE, /'href="' \+ esc\(counted\(l\.url\)\) \+ '"/);
  });
  test("the privacy page says so in one plain sentence", () => {
    assert.equal(PRIVACY_TRADE_CLICK_SENTENCE, "When you follow a trade link from this site, the site counts that click for the coin and the day. It stores no cookie, no address and nothing about you.");
    clean(PRIVACY_TRADE_CLICK_SENTENCE);
    assert.ok(PRIVACY_SECTIONS.find((s) => s.id === "server")!.paragraphs.includes(PRIVACY_TRADE_CLICK_SENTENCE));
  });
});

describe("6. the feed and the calendar beside Follow", () => {
  test("the words and the two addresses", () => {
    for (const t of [NEXT_RESULT_LEAD, NEXT_RESULT_LABELS.rss, NEXT_RESULT_LABELS.calendar, `${NEXT_RESULT_LEAD} ${NEXT_RESULT_LABELS.rss} · ${NEXT_RESULT_LABELS.calendar}`]) { clean(t); noArrows(t); }
    assert.deepEqual(nextResultLinks("PHINFLWIN", EAGLES), { rss: "/api/burnticker/feeds/coin/PHINFLWIN.rss", ics: `/api/burnticker/v1/coins/${EAGLES}/calendar.ics` });
    assert.equal(calendarIcsHref(DEFICIT), `/api/burnticker/v1/coins/${DEFICIT}/calendar.ics`);
  });
  test("the coin page and the $DEFICIT page put them beside Follow", () => {
    const c = read("src/app/burnticker/_components/FollowFeeds.tsx");
    assert.match(c, /<FollowButton watchKey=\{watchKey\} ticker=\{ticker\} \/>/); assert.match(c, /data-feed-rss/); assert.match(c, /data-feed-ics/); noArrows(c.replace(/=>/g, ""));
    assert.match(read("src/app/burnticker/t/[ticker]/page.tsx"), /<FollowFeeds watchKey=\{coinWatchKey\(s\.cluster, s\.mint\)\} ticker=\{s\.ticker\} \{\.\.\.nextResultLinks\(key, s\.mint\)\} \/>/);
    assert.match(read("src/app/burnticker/t/[ticker]/DeficitPrelaunch.tsx"), /<FollowFeeds watchKey=\{coinWatchKey\("mainnet", d\.mint\)\} ticker="DEFICIT" \{\.\.\.nextResultLinks\(d\.ticker, d\.mint\)\} \/>/);
    const line = /<p class="replay" id="followLine"[^>]*>([\s\S]*?)<\/p>/.exec(PAGE)![1];
    assert.match(line, /Get the next result: <a href="https:\/\/burnticker\.com\/api\/burnticker\/feeds\/coin\/DEFICIT\.rss" data-feed-rss>RSS<\/a> · <a href="https:\/\/burnticker\.com\/api\/burnticker\/v1\/coins\/DEFICIT\/calendar\.ics" data-feed-ics>Calendar<\/a>/);
    noArrows(line.replace(/<[^>]+>/g, ""));
  });
  test("$DEFICIT's calendar answers before the coin is registered here: its Treasury reading days", () => {
    const c = treasuryCalendar({ ticker: "DEFICIT", mint: DEFICIT, page: "/burnticker/t/DEFICIT", ics: calendarIcsHref(DEFICIT), firesOn: "each full $1B rise in the U.S. national debt", now: Date.parse("2026-10-17T12:00:00Z") });
    assert.equal(c.source, "business-days"); assert.equal(c.entries.length, 5); assert.equal(c.entries[0].day, "2026-10-19");
    const f = read("src/lib/burnticker/api/features.ts");
    assert.match(f, /if \(!mint \|\| \(id !== mint && id\.toUpperCase\(\) !== "DEFICIT"\)\) return null;/);
    assert.match(f, /const d = c\.error\.status === 404 \? deficitCalendar\(id, now\) : null;/);
  });
});

describe("7. campaign parameters never change a page", () => {
  test("utm_* and ref are dropped from an address; other parameters stay", () => {
    assert.ok(isTrackingParam("utm_source")); assert.ok(isTrackingParam("UTM_Campaign")); assert.ok(isTrackingParam("ref")); assert.ok(!isTrackingParam("step")); assert.ok(!isTrackingParam("referrer"));
    assert.equal(withoutTrackingParams("/burnticker/launch?utm_source=x&step=name&ref=abc#top"), "/burnticker/launch?step=name#top");
    assert.equal(withoutTrackingParams(`https://burnticker.com/burnticker/t/${EAGLES}?utm_medium=social`), `https://burnticker.com/burnticker/t/${EAGLES}`);
    assert.ok(hasTrackingParams("/burnticker?ref=x")); assert.ok(!hasTrackingParams("/burnticker?template=weather"));
  });
  test("canonical links are paths without parameters, and a registered coin's page always names its mint page", () => {
    const l = read("src/app/burnticker/t/[ticker]/layout.tsx");
    assert.match(l, /: \{ title: \{ absolute: coinPageTitle\(ticker, l\) \}, \.\.\.\(mint \? \{ alternates: \{ canonical \} \} : \{\}\) \};/);   // AP6-8 made the title absolute (merge 911091d8)
    assert.match(read("src/app/burnticker/launch/layout.tsx"), /alternates: \{ canonical: "\/burnticker\/launch" \}/);
    assert.match(read("site/deficit/index.html"), /<link rel="canonical" href="https:\/\/deficit\.burnticker\.com\/">/);
  });
  test("the launch page's draft resume is untouched by utm or ref (only its own entry parameters reopen a link), and the proxy only sees paths with %", () => {
    const p = read("src/app/burnticker/launch/page.tsx");
    const linked = /const linked = ([^;]+);/.exec(p)![1];
    assert.doesNotMatch(linked, /utm|ref"/);
    assert.match(read("src/proxy.ts"), /matcher: \["\/:path\(\.\*%\.\*\)"\]/);
  });
});

describe("8. the card button says where the coin is", () => {
  const coin: IndexCoin = { ticker: "PHINFLWIN", name: "Eagles 2026 Wins", mint: EAGLES, oneLiner: "burns when the Eagles win", status: "live", imageUrl: null, burned: "0", burns: 0, nextCheckAt: null, nextCloseTime: null, lastBurnAt: null, launchedAt: "2026-10-13T00:00:00Z", pairId: null, phase: "curve", progressPct: 0, raised: "0.00000004", threshold: "85", quote: "SOL" };
  test("on its curve: Swap on the curve (0 of 85 SOL); after graduation: Trade on Raydium", () => {
    const on = cardViewFromIndex(coin, null, "mainnet").trade!;
    assert.equal(on.primary?.label, "Swap on the curve (0 of 85 SOL)"); assert.equal(on.primary?.url, launchLabUrl(EAGLES));
    const grad = cardViewFromIndex({ ...coin, phase: "graduated", raised: "85", progressPct: 100 }, null, "mainnet").trade!;
    assert.equal(grad.primary?.label, LINK_LABELS.raydium); assert.equal(grad.primary?.url, raydiumSwapUrl(EAGLES));
    assert.equal(cardViewFromIndex({ ...coin, raised: "35.75" }, null, "mainnet").trade!.primary?.label, "Swap on the curve (35.7 of 85 SOL)");
    assert.equal(cardViewFromIndex({ ...coin, raised: null, threshold: null }, null, "mainnet").trade!.primary?.label, LINK_LABELS.raydium, "an unread curve keeps the plain label");
    clean(curveSwapLabel("0", "85")!); noArrows(curveSwapLabel("0", "85")!);
  });
  test("the coin page header keeps Trade on Raydium (no curve passed)", () => {
    assert.equal(coinLinks({ cluster: "mainnet", mint: EAGLES, phase: "curve", status: "live" }).primary?.label, LINK_LABELS.raydium);
    assert.match(read("src/lib/burnticker/home.ts"), /status: "live", curve: readable \? \{ raised: live!\.raised, threshold: live!\.threshold, quote: live!\.quote \}/);
  });
});
