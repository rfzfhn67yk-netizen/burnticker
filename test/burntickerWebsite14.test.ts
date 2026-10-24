// WEBSITE-14 (2026-10-12; WEBSITE-14-BRIEF.md, the twelve items): the product pass after the audits. This suite pins the new truth:
// the queued-units counter from the $DEFICIT keeper's own files (one function for the app and the static site), the activity rows by
// kind, next results, the six-step progress view of readiness.ts, the devnet walkthrough, two paths on arrival, the duplicate-rule
// check, the browser-local watchlist, the retirement facts in one module, share previews, the 40 / 60 / 85 SOL graduation preset
// (server-enforced, passed to LaunchLab, never a typed 85 on a coin's own surfaces) and the creator onboarding copy. Every sentence
// passes the copy lint.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { formatHits, lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import { deficitQueueCore } from "@/lib/burnticker/deficitQueueCore.mjs";
import { deficitQueue, keeperPublishDir, readKeeperFiles } from "@/lib/burnticker/deficitQueue";
import { deficitQueueScript } from "../scripts/burnticker-site-nav.mts";
import { EVENT_LABEL, eventsFromKeeper, eventsFromStatus, sortEvents } from "@/lib/burnticker/activity";
import { EVENT_LABELS, TWO_PATHS, WALKTHROUGH_LINK } from "@/lib/burnticker/siteNav.mjs";
import { SETTLEMENT_LABEL, UPCOMING_EMPTY, settlementOf, upcomingFromKeeper, upcomingFromStatus } from "@/lib/burnticker/upcoming";
import { PROGRESS_STEPS, progressOf } from "@/lib/burnticker/progress";
import { readinessOf, READINESS_ORDER, type ReadinessInput } from "@/lib/burnticker/readiness";
import { burnWalkthrough } from "@/lib/burnticker/burnWalkthrough";
import { parseWatchlist, toggleWatch, WATCH_EMPTY, WATCH_KEY, WATCH_NOTE } from "@/lib/burnticker/watchlist";
import { LEFTOVER_SEE_END, NO_END_LINE, RETIREMENT_FACTS, RETIREMENT_HEADING, retirementFacts } from "@/lib/burnticker/retirementCopy";
import { NO_FEE_REVENUE_LINE, WHY_CREATE, onboardingSentences } from "@/lib/burnticker/creatorCopy";
import { coinPreview, receiptPreview } from "@/lib/burnticker/sharePreview";
import { DUPLICATE_LINES } from "@/lib/burnticker/duplicateRule";
import { existingCoinsFor } from "@/lib/burnticker/duplicateRuleMatch";
import { DEFAULT_RAISE_SOL, RAISE_PRESETS_SOL, RAISE_PRESET_SHARED, RAISE_PRESET_TEXT } from "@/lib/burnticker/raisePresets";
import { LAUNCHLAB_RAISE_LAMPORTS, raiseLamportsOf, raiseProblem, launchProblems } from "@/lib/burnticker/launchBundle";
import { buildLaunchReview, launchLabCostSol, prerequisiteLineFor } from "@/lib/burnticker/launchReview";
import { featuredCoins, activityEvents, homeData, NO_EVENTS_LINE } from "@/lib/burnticker/home";
import { CARD_MEANINGS, curveLine } from "@/lib/burnticker/cardView";
import { GRID_TABS, tabCoins, gridState } from "@/lib/burnticker/coinsGrid";
import { CREATOR_LAUNCHES_FLAG } from "@/lib/burnticker/creatorLaunches";
import { makeWorld, CREATOR } from "./burntickerApiHelpers.ts";
import { prepareLaunch } from "@/lib/burnticker/api/handlers";
import { lockRule, DEFAULT_ON_END } from "@/lib/burnticker/rules";

const cfg = loadCopyLintConfig();
const clean = (t: string, what: string) => { const r = lintCopy(t, cfg); assert.ok(r.ok, `${what}:\n${formatHits(r)}`); };
const read = (f: string) => fs.readFileSync(f, "utf8");
const NOW = Date.parse("2026-10-20T22:00:00Z");

/** A live keeper status.json (statusPage.ts StatusJson, the fields the counter reads) before graduation. */
const keeperStatus = (o: { lastOnChain?: string | null; registered?: boolean; generatedAt?: string; lastRecordDate?: string | null; baseline?: boolean } = {}) => ({
  schema: "burnkeeper.status/v1", ticker: "DEFICIT", cluster: "mainnet", generatedAt: o.generatedAt ?? "2026-10-20T21:50:00Z",
  feed: { lastRecordDate: o.lastRecordDate === undefined ? "2026-10-19" : o.lastRecordDate, lastAmount: "38512345678901.23", nextPollAt: "2026-10-20T20:30:00Z", ...(o.baseline === false ? {} : { baseline: { recordDate: "2026-10-14", amount: "38490000000000.00" } }) },
  buyback: { fractionPerUnit: "0.02" },
  burned: { total: "0", pctOfSupply: 0, count: 0 },
  curve: { phase: "curve", raised: "31.5", threshold: "85", quote: "SOL", progressPct: 37.06, poolId: "Pool1", readAt: "2026-10-20T21:50:00Z" },
  readiness: readinessOf({ launched: true, phase: "curve", raisedSol: 31.5, graduationSol: 85, poolVerified: false, latest: null }),
  program: {
    queue: { lastOnChain: o.lastOnChain === undefined ? "2026-10-16" : o.lastOnChain },
    pool: { registered: !!o.registered, address: o.registered ? "CpmmPool11111111111111111111111111111111111" : null },
    attestation: { lastReading: { recordDate: "2026-10-16", value: "38505000000000.00", units: 3, signature: "SigReadingOne", txUrl: null }, readings: [
      { recordDate: "2026-10-16", value: "38505000000000.00", units: 3, signature: "SigReadingOne", txUrl: null },
      { recordDate: "2026-10-15", value: "38502000000000.00", units: 12, signature: "SigReadingTwo", txUrl: null },
    ] },
  },
});
const keeperBurns = [
  { recordDate: "2026-10-15", status: "planned", units: 12, waitReason: "waiting for the CPMM pool", signature: null, skippedReason: null },
  { recordDate: "2026-10-16", status: "planned", units: 3, waitReason: "waiting for the CPMM pool", signature: null, skippedReason: null },
  { recordDate: "2026-10-19", status: "planned", units: 2, waitReason: null, signature: null, skippedReason: null },
];

describe("item 1: the queued-units counter (LAUNCHPAD-PATH §73), from the keeper's own files", () => {
  test("before graduation: the rise since launch, the units on chain, 1 − 0.98^N of the burn pool, the reading date and freshness", () => {
    const q = deficitQueueCore(keeperStatus(), keeperBurns, NOW);
    assert.equal(q.state, "queued"); assert.equal(q.units, 15); assert.equal(q.unsigned, 2, "a reading past the last one on chain is not counted as queued");
    assert.equal(q.riseUsd, "22345678901.23");
    assert.equal(q.sharePct, ((1 - Math.pow(0.98, 15)) * 100).toFixed(2)); assert.equal(q.formula, "1 − 0.98^15");
    // hourly run 6 HB-90: the headline says what the two numbers are, from the baseline's own date
    assert.equal(q.headline, "Daily rises since Oct 14 add up to 15 queued units ($1B each). The debt is $22.35 billion higher than on Oct 14.");
    assert.ok(q.lines.some((l) => l.startsWith(`When the curve fills at 85 SOL and its pool is registered, the queued readings run in order and together spend 1 − 0.98^15 of the burn pool, which is ${q.sharePct}%.`)), "the raise is the one the keeper read from the pool");
    assert.ok(q.lines.some((l) => /One burn run spends at most 2% of the trading pool's SOL/.test(l)));
    assert.ok(q.lines.some((l) => /^2 more units are recorded by the keeper and not yet signed on chain\.$/.test(l)));
    assert.ok(q.lines.some((l) => /^The latest reading is the Treasury figure for 2026-10-19\. The keeper last wrote its status file at Oct 20, 3:50 PM Denver time\.$/.test(l)));
    assert.equal(q.stale, false); assert.equal(q.card, "0 $DEFICIT, 15 units queued");
    for (const t of [q.headline, ...q.lines, q.card!]) clean(t, "queue");
  });
  test("every other state is its own sentence: unavailable, not launched, no reading yet, stale, no baseline, pool open; never a placeholder", () => {
    const un = deficitQueueCore(null, null, NOW);
    assert.equal(un.state, "unavailable"); assert.equal(un.card, null); assert.match(un.headline, /unavailable/);
    assert.equal(deficitQueueCore({ schema: "something/else" }, [], NOW).state, "unavailable");
    const pre = deficitQueueCore(JSON.parse(read("site/deficit/status.json")), JSON.parse(read("site/deficit/burns.json")), NOW);
    assert.equal(pre.state, "not-launched"); assert.match(pre.headline, /not created yet/);
    const none = deficitQueueCore(keeperStatus({ lastRecordDate: null }), [], NOW);
    assert.equal(none.state, "no-reading"); assert.match(none.headline, /first reading is the baseline/);
    const stale = deficitQueueCore(keeperStatus({ generatedAt: "2026-10-20T18:00:00Z" }), keeperBurns, NOW);
    assert.equal(stale.stale, true); assert.ok(stale.lines.some((l) => /more than an hour ago, so it may be out of date/.test(l)));
    const noBase = deficitQueueCore(keeperStatus({ baseline: false }), keeperBurns, NOW);
    assert.equal(noBase.riseUsd, null); assert.equal(noBase.headline, "Daily rises since the first reading add up to 15 queued units ($1B each)."); assert.ok(noBase.lines.includes("The rise since the first reading is not in the keeper's published file yet."));
    const open = deficitQueueCore(keeperStatus({ registered: true }), keeperBurns, NOW);
    assert.equal(open.state, "pool-open"); assert.match(open.headline, /The pool is registered\. 15 units are waiting for a burn run\./); assert.equal(open.card, null);
    const zero = deficitQueueCore(keeperStatus(), [], NOW);
    assert.equal(zero.units, 0); assert.match(zero.headline, /No units are queued\./); assert.equal(zero.card, null);
    for (const q of [un, pre, none, stale, noBase, open, zero]) for (const t of [q.headline, ...q.lines]) clean(t, q.state);
  });
  test("the static $DEFICIT site runs the same function, byte for byte, and wires it to its own status.json and burns.json", () => {
    const site = read("site/deficit/index.html");
    assert.ok(site.includes(deficitQueueScript()), "run scripts/burnticker-site-nav.mts --write");
    const src = /window\.deficitQueueCore = (function deficitQueueCore[\s\S]*?\n\});\n<\/script>/.exec(site)![1];
    const fn = new Function(`return (${src});`)() as typeof deficitQueueCore;
    assert.deepEqual(fn(keeperStatus(), keeperBurns, NOW), deficitQueueCore(keeperStatus(), keeperBurns, NOW));
    assert.match(site, /id="queue" data-queue="loading"/); assert.match(site, /renderQueue\(status, b\)/); assert.match(site, /renderQueue\(s, null\)/);
    assert.doesNotMatch(site.replace(/<!--[\s\S]*?-->/g, ""), /85 SOL/, "the readiness default names no typed raise; the keeper's status names the pool's own");
  });
  test("the app reads the keeper's publish directory (BURNKEEPER_PUBLISH_DIR or data/burnkeeper-site); a missing file is unavailable, never zero", () => {
    assert.equal(keeperPublishDir({}, "/r"), path.resolve("/r", "data/burnkeeper-site")); assert.equal(keeperPublishDir({ BURNKEEPER_PUBLISH_DIR: "x/y" }, "/r"), path.resolve("/r", "x/y"));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bt-keeper-"));
    const missing = readKeeperFiles({ BURNKEEPER_PUBLISH_DIR: dir }, "/");
    assert.equal(missing.status, null); assert.match(missing.error!, /has not published/); assert.equal(deficitQueue(missing, NOW).state, "unavailable");
    fs.writeFileSync(path.join(dir, "status.json"), JSON.stringify(keeperStatus())); fs.writeFileSync(path.join(dir, "burns.json"), JSON.stringify(keeperBurns));
    const got = readKeeperFiles({ BURNKEEPER_PUBLISH_DIR: dir }, "/");
    assert.equal(deficitQueue(got, NOW).units, 15);
  });
  test("the featured card says the queue instead of nothing burned, and its curve, progress and raise come from the keeper's pool read", () => {
    const root = scratchRoot("launched");
    const f = featuredCoins(root, null, [], { status: keeperStatus(), burns: keeperBurns, error: null }, NOW)[0];
    assert.equal(f.burned.text, "0 $DEFICIT, 15 units queued"); assert.equal(f.burned.why, "Daily rises since Oct 14 add up to 15 queued units ($1B each). The debt is $22.35 billion higher than on Oct 14.");
    assert.deepEqual([f.curve.raised, f.curve.of], ["31.5", "85 SOL"]);
    assert.equal(f.progress!.from, "on-curve"); assert.match(f.progress!.next, /^31\.5 of 85 SOL raised; 53\.5 more to graduate\. 15 units are queued for that moment\.$/);
    // unread keeper files after the create: Unavailable (F4), never a queue or a zero
    const u = featuredCoins(root, null, [], null, NOW)[0];
    assert.equal(u.burned.text, "Unavailable"); assert.equal(u.curve.of, null);
  });
  test("the coin page's readiness panel carries the same counter; the $DEFICIT page reads it from the API", () => {
    const coin = read("src/app/burnticker/t/[ticker]/page.tsx"), pre = read("src/app/burnticker/t/[ticker]/DeficitPrelaunch.tsx"), api = read("src/app/api/burnticker/deficit-prelaunch/route.ts");
    assert.match(coin, /\{s\.ticker === "DEFICIT" && home\.data && <QueuePanel q=\{home\.data\.deficitQueue\} \/>\}/);
    assert.match(pre, /\{d\.queue && <QueuePanel q=\{d\.queue\} \/>\}/); assert.match(api, /queue: deficitQueue\(k, now\)/);
    assert.doesNotMatch(pre, /85 SOL/);
  });
});

describe("item 2: readings, graduations and pool registrations as their own labelled rows", () => {
  test("the keeper's rows: each signed reading with its date, value, units and signature; burns only when asked; labels match the static shell", () => {
    const ev = eventsFromKeeper(keeperStatus({ registered: true }), [...keeperBurns, { recordDate: "2026-10-21", status: "confirmed", units: 4, signature: "SigBurnOne", burned: "1234.5" }], { includeBurns: true });
    assert.deepEqual(ev.map((e) => e.kind).sort(), ["burn", "pool", "reading", "reading"]);
    const r = ev.find((e) => e.signature === "SigReadingTwo")!;
    assert.equal(r.text, "$DEFICIT's reading for Oct 15 was signed on chain. The debt was $38.502 trillion, which counted 12 units."); assert.equal(r.href, "https://explorer.solana.com/tx/SigReadingTwo");
    assert.equal(ev.find((e) => e.kind === "burn")!.href, "/burnticker/check?sig=SigBurnOne&cluster=mainnet#verify");
    assert.equal(eventsFromKeeper(keeperStatus(), keeperBurns).filter((e) => e.kind === "burn").length, 0);
    assert.deepEqual(eventsFromKeeper(JSON.parse(read("site/deficit/status.json")), []), [], "the pre-launch file has no rows");
    assert.deepEqual(EVENT_LABELS, EVENT_LABEL);
    for (const e of ev) clean(e.text, e.kind);
  });
  test("a registered coin's rows: burns with their own receipt, its last signed reading, graduation and pool; newest first, mainnet first", () => {
    const ev = eventsFromStatus({ ticker: "RAYS", cluster: "mainnet", market: { phase: "graduated", graduatedPool: "Cpmm" }, program: { lastReading: { date: "2026-10-18", signature: "SigR" }, pool: { registered: true, address: "PoolAddr" } } },
      [{ status: "confirmed", settledAt: "2026-10-18T03:00:00Z", units: 1, value: null, signature: "SigB", readingDate: "2026-10-18", burned: "500" }, { status: "skipped", settledAt: "2026-10-17T03:00:00Z", units: 0, value: null, signature: null }]);
    assert.deepEqual(ev.map((e) => e.kind), ["burn", "reading", "graduation", "pool"]);
    assert.equal(ev[1].text, "$RAYS's reading for Oct 18 was signed on chain. It counted one unit.");
    const sorted = sortEvents([...ev, { kind: "burn", at: "2026-10-19", network: "devnet", ticker: "X", text: "x", href: "/" }]);
    assert.equal(sorted[sorted.length - 1].network, "devnet"); assert.equal(sorted[0].kind, "burn");
    assert.ok(sorted.findIndex((e) => e.at === null) > sorted.findIndex((e) => e.kind === "reading"), "undated rows after dated ones");
    for (const e of ev) clean(e.text, e.kind);
    // the home API: each coin's own rows when it carries them, and the keeper's readings
    const home = activityEvents([{ ticker: "RAYS", burns: 1, lastBurnAt: null, events: ev }], null, 20, { status: keeperStatus(), burns: keeperBurns, error: null });
    assert.ok(home.some((e) => e.ticker === "DEFICIT" && e.kind === "reading")); assert.ok(home.some((e) => e.ticker === "RAYS" && e.kind === "pool"));
    clean(NO_EVENTS_LINE, "no events");
    // indexer-1 wiring: once the chain dates are read, the graduation and pool rows are dated and carry their signatures
    const read = (at: string, signature: string) => ({ state: "read" as const, at, blockTime: 0, slot: 1, signature });
    const dated = eventsFromStatus({ ticker: "RAYS", cluster: "mainnet", market: { phase: "graduated", graduatedPool: "Cpmm", dates: { created: read("2026-10-10T00:00:00Z", "SigC"), graduated: read("2026-10-12T00:00:00Z", "SigG"), registered: read("2026-10-13T00:00:00Z", "SigP"), readAt: "x" } }, program: { lastReading: null, pool: { registered: true, address: "PoolAddr" } } });
    assert.deepEqual(dated.map((e) => [e.kind, e.at, e.signature]), [["graduation", "2026-10-12T00:00:00Z", "SigG"], ["pool", "2026-10-13T00:00:00Z", "SigP"]]);
    for (const e of dated) { assert.doesNotMatch(e.text, /does not read the date/); clean(e.text, e.kind); }
  });
  test("the activity line labels each kind and fades whichever edge still has more (app and static shell; audit 6 item 24)", () => {
    const t = read("src/app/burnticker/_components/ActivityTicker.tsx"), nav = read("src/lib/burnticker/siteNav.mjs"), css = read("config/public-repo/overlay/src/app/globals.css");
    assert.match(t, /EVENT_LABEL\[ev\.kind\]/);
    // found on the phone shots: an absolutely positioned hint inside the strip made the page as wide as the strip (scrollWidth 4360 at 390)
    assert.doesNotMatch(t.slice(t.indexOf("{data && data.events.map")), /className="sr-only"/, "no absolutely positioned text after the rows"); assert.match(t, /className=\{`bt-ticker \$\{hint\.className\}`\}/);
    assert.match(css, /\.bt-scroll-hint\.more-end \{ -webkit-mask-image: linear-gradient\(90deg, #000 calc\(100% - 40px\), transparent\)/);
    assert.match(nav, /\.sh-ticker\.more-end\{-webkit-mask-image:linear-gradient\(90deg,#000 calc\(100% - 40px\),transparent\)/); assert.match(nav, /box\.classList\.toggle\("more-end"/);
  });
});

describe("item 3: next results (/burnticker/upcoming and the home strip)", () => {
  test("a registered coin: the event, the source in words, the source's schedule, and where the latest result stands", () => {
    const row = upcomingFromStatus({ ticker: "RAYS", name: "Rays", cluster: "mainnet", status: "live", oracle: "kalshi", selectorKey: "kalshi:KXMLBGAME:binary", seriesTitle: "Rays games", next: { nextCheckAt: "2026-10-21T02:00:00Z", nextMarket: "KXMLBGAME-26OCT21TBNYY", nextCloseTime: "2026-10-21T03:00:00Z" } }, [{ status: "confirmed", settledAt: "2026-10-19T03:00:00Z", units: 1, signature: "SigB" }])!;
    assert.equal(row.source, "A prediction market's settled result"); assert.doesNotMatch(JSON.stringify(row), /kalshi/i);
    assert.equal(row.schedule, "The market is scheduled to close on 21 October 2026, 03:00 UTC. The result counts once the source settles it, on the source's own timing.");
    assert.equal(row.status, "burned"); assert.equal(row.receiptHref, "/burnticker/check?sig=SigB&cluster=mainnet#verify");
    assert.equal(upcomingFromStatus({ ticker: "D", name: "D", cluster: "mainnet", status: "draft", oracle: "catalogue", selectorKey: "c", seriesTitle: null, next: { nextCheckAt: null, nextMarket: null, nextCloseTime: null } }, []), null);
    for (const [rs, st] of [[[], "waiting"], [[{ status: "planned", settledAt: "x", units: 1, signature: null, execution: "program", readingDate: null }], "published"], [[{ status: "planned", settledAt: "x", units: 1, signature: null, readingDate: "2026-10-01" }], "attested"], [[{ status: "planned", settledAt: "x", units: 1, signature: null, readingDate: "2026-10-01", waitReason: "pool not tradable" }], "deferred"], [[{ status: "pending-pair", settledAt: "x", units: 1, signature: null }], "deferred"]] as const) {
      const s = settlementOf(rs as never, "mainnet"); assert.equal(s.status, st); clean(s.text, st);
    }
    for (const t of [row.schedule, row.statusText, UPCOMING_EMPTY, ...Object.values(SETTLEMENT_LABEL)]) clean(t, t);
  });
  test("$DEFICIT's row from its keeper: the Treasury, the rule file's poll times, and the queued reading on hold", () => {
    const k = upcomingFromKeeper(keeperStatus(), keeperBurns, { feedName: "U.S. Treasury, Debt to the Penny", feedUrl: null, polls: ["16:30", "20:00"], timeZone: "America/New_York" })!;
    assert.equal(k.schedule, "The Treasury publishes each business day's figure on its own schedule. The keeper checks for it at 16:30 and 20:00 New York time.");
    assert.equal(k.status, "published", "the newest reading is past the last one on chain");
    const held = upcomingFromKeeper(keeperStatus({ lastOnChain: "2026-10-19" }), keeperBurns, { feedName: "T", feedUrl: null, polls: ["16:30"], timeZone: "America/New_York" })!;
    assert.equal(held.status, "attested");
    const pool = upcomingFromKeeper(keeperStatus({ lastOnChain: "2026-10-16", lastRecordDate: "2026-10-16" }), keeperBurns.slice(0, 2), { feedName: "T", feedUrl: null, polls: ["16:30"], timeZone: "America/New_York" })!;
    assert.equal(pool.status, "deferred"); assert.match(pool.statusText, /waiting for the CPMM pool/);
    assert.equal(upcomingFromKeeper(JSON.parse(read("site/deficit/status.json")), [], { feedName: "T", feedUrl: null, polls: [], timeZone: "UTC" }), null);
    for (const t of [k.schedule, k.statusText, held.statusText, pool.statusText, k.event]) clean(t, t);
  });
  test("the page's heading is Next results (the lint refuses the word in the address), and it and the home strip read the API", () => {
    const pg = read("src/app/burnticker/upcoming/NextResults.tsx"), home = read("site/burnticker/index.html");
    assert.match(pg, /<h1 className="text-2xl font-semibold">Next results<\/h1>/); assert.match(pg, /data\?\.upcoming/);
    assert.match(home, /<h2 id="next-h">Next results<\/h2>/); assert.match(home, /j\.upcoming/);
    assert.equal(lintCopy("Upcoming results", cfg).ok, false, "why the visible words avoid it");
    // website-15 (code review 6 P2 2): the answer is a set with its own state; an empty readable registry is ready and empty
    assert.deepEqual(homeData([], "/nonexistent-root").upcoming, { state: "ready", rows: [], omitted: [], registered: 0 });
  });
});

describe("item 4: six steps, a view of readiness.ts (no second model)", () => {
  test("each readiness state maps onto the six steps, with the next unmet condition in one plain sentence", () => {
    const base: ReadinessInput = { launched: true, phase: "curve", raisedSol: 40, graduationSol: 60, poolVerified: false, latest: null };
    const cases: [ReadinessInput, number, RegExp][] = [
      [{ ...base, launched: false }, 0, /^Next, the coin has to be created\.$/],
      // website-15 item 6: a coin on its curve has done "Created" and "Trading on curve"; graduation is the next unmet milestone
      [base, 2, /^40 of 60 SOL raised; 20 more to graduate\.$/],
      [{ ...base, phase: "graduated" }, 3, /registered with the burn program and verified/],
      [{ ...base, poolVerified: true }, 4, /at least one unit/],
      [{ ...base, poolVerified: true, latest: { status: "skipped", units: 1, skippedReason: "under the floor", waitReason: null } }, 4, /spend floor/],
      [{ ...base, poolVerified: true, latest: { status: "planned", units: 2, skippedReason: null, waitReason: "TwapDeviation" } }, 5, /burn run has to go through/],
      [{ ...base, poolVerified: true, latest: { status: "confirmed", units: 2, skippedReason: null, waitReason: null } }, 6, /next result that counts/],
    ];
    const seen = new Set<string>();
    for (const [i, done, re] of cases) {
      const r = readinessOf(i), p = progressOf(r, { raiseSol: i.graduationSol, raisedSol: i.raisedSol });
      seen.add(r.state); assert.equal(p.done, done, r.state); assert.match(p.next, re, r.state); clean(p.next, r.state);
      assert.equal(p.steps.length, 6); assert.deepEqual(p.steps.map((s) => s.label), [...PROGRESS_STEPS]);
      p.steps.forEach((s, k) => assert.equal(s.state, k < done ? "done" : k === done && done > 0 ? "current" : "todo"));
    }
    assert.deepEqual([...seen].sort(), [...READINESS_ORDER].sort(), "every readiness state is covered");
    assert.equal(progressOf(readinessOf({ ...base, graduationSol: undefined }), {}).next, "Next, the curve has to reach its raise and graduate.", "no raise read, no number");
  });
  test("cards (app and static home) and coin pages show it in the progress row", () => {
    const card = read("src/app/burnticker/_components/CoinCard.tsx"), home = read("site/burnticker/index.html"), coin = read("src/app/burnticker/t/[ticker]/page.tsx");
    assert.match(card, /<div data-row="progress">/); assert.match(home, /row\(dl, "progress", LABELS\.progress, pg\)/); assert.match(coin, /<ProgressStrip p=\{progressOf\(ready,/);
    clean(CARD_MEANINGS.progress, "progress meaning");
  });
});

describe("item 5: watch how a burn works (the devnet receipt, four steps and the receipt)", () => {
  test("every value comes from the evidence row and its devnet rule file; devnet on every step", () => {
    const w = burnWalkthrough();
    assert.equal(w.network, "devnet"); assert.deepEqual(w.steps.map((s) => s.title), ["The result is published", "The budget is worked out", "Tokens are bought", "The tokens are burned"]);
    const st = JSON.parse(read("config/burnticker/current-status.json")) as { demo: { evidence: string; recordDate: string } };
    const row = (JSON.parse(read(st.demo.evidence)) as { recordDate: string; status: string; signature: string; units: number; memo: string }[]).find((r) => r.recordDate === st.demo.recordDate && r.status === "confirmed")!;
    assert.equal(w.receipt.signature, row.signature); assert.equal(w.receipt.memo, row.memo);
    assert.match(w.steps[0].body.join(" "), new RegExp(`counted ${row.units} units`));
    assert.match(w.steps[1].body.join(" "), /1 − 0\.99\^23 of the pool\. The burn pool held 0\.5056 SOL, so the rule asked for 0\.1043 SOL\. .*This run spent 0\.0201 SOL, and 0\.0842 SOL carried over/);
    assert.match(w.note, /devnet rule spent 1% per unit\. The mainnet \$DEFICIT rule spends 2% per unit\./);
    for (const s of w.steps) for (const b of s.body) clean(b, s.title);
    clean(w.note, "note");
    const page = read("src/app/burnticker/how-a-burn-works/page.tsx");
    assert.match(page, /Step \{s\.n\} of \{w!\.steps\.length\}, on devnet/); assert.match(page, /data-devnet-banner/);
    assert.match(read("src/app/burnticker/about/page.tsx"), /href="\/burnticker\/how-a-burn-works"/); assert.match(read("site/burnticker/index.html"), /<a href="\/burnticker\/how-a-burn-works">Watch how a burn works<\/a>/);
  });
});

describe("item 6: two paths on arrival, and why someone creates a coin", () => {
  test("Explore and Create with one sentence each; Create opens the closed-launches dialog while closed", () => {
    const home = read("site/burnticker/index.html");
    assert.deepEqual(TWO_PATHS.map((p) => p.label), ["Explore coins", "Launch a coin"]);
    assert.match(home, /<a class="path path-create" href="\/burnticker\/launch" data-launch-button data-create-path aria-describedby="create-status">/);
    assert.match(read("src/lib/burnticker/siteNav.mjs"), /btns\.forEach\(function \(btn\) \{ btn\.addEventListener\("click"/, "every launch button opens the dialog");
    for (const p of TWO_PATHS) { clean(p.text, p.label); assert.equal(p.text.split(/(?<=\.)\s/).length, 1, "one sentence each"); }
    clean(WALKTHROUGH_LINK.text, "walkthrough link");
  });
  test("About and the launch page carry the why-create paragraph beside the no-fee-revenue line; no income is implied", () => {
    clean(WHY_CREATE, "why"); clean(NO_FEE_REVENUE_LINE, "no fee");
    assert.doesNotMatch(WHY_CREATE, /earn|income|profit|money|paid/i);
    assert.match(read("src/app/burnticker/about/page.tsx"), /\{WHY_CREATE\}/); assert.match(read("src/app/burnticker/about/page.tsx"), /Creators receive no trading-fee revenue/);
    assert.match(read("src/app/burnticker/_components/CreatorOnboarding.tsx"), /\{WHY_CREATE\}/);
  });
});

describe("item 7: the duplicate-rule check at the choice step", () => {
  test("a rule whose canonical selector is registered names the coins; the identical-rule flag uses the canonical hash; expired drafts never count", async () => {
    const w = await makeWorld();
    const rule = JSON.parse(w.bronco.rulesJson);
    const tokens = w.registry.tokens();
    const hits = existingCoinsFor(rule, tokens);
    assert.ok(hits.some((h) => h.ticker === w.bronco.ticker)); assert.equal(hits[0].href, `/burnticker/t/${w.bronco.ticker}`);
    assert.deepEqual(existingCoinsFor(rule, tokens.map((t) => ({ ...t, status: "expired" }))), []);
    assert.deepEqual(existingCoinsFor({ nonsense: true }, tokens), []);
    // identical when the canonical hash (with the onEnd clause every launch carries) matches the registered coin's
    const sha = lockRule(rule.onEnd === undefined ? { ...rule, onEnd: { ...DEFAULT_ON_END } } : rule).sha256;
    assert.equal(existingCoinsFor(rule, tokens.map((t) => (t.mint === w.bronco.mint ? { ...t, rulesSha: sha } : t))).find((h) => h.mint === w.bronco.mint)!.sameRule, true);
    assert.equal(existingCoinsFor(rule, tokens.map((t) => (t.mint === w.bronco.mint ? { ...t, rulesSha: "0".repeat(64) } : t))).find((h) => h.mint === w.bronco.mint)!.sameRule, false);
    for (const s of [DUPLICATE_LINES.head(1), DUPLICATE_LINES.head(3), DUPLICATE_LINES.separate, DUPLICATE_LINES.ticker, DUPLICATE_LINES.view]) clean(s, s);
    assert.match(DUPLICATE_LINES.ticker, /An identical ticker is not an identical token\. The mint address/);
    assert.match(read("src/lib/burnticker/api/handlers.ts"), /existingCoinsFor\(rule, tokens\)/); assert.match(read("src/app/api/burnticker/v1/launch/review/route.ts"), /existingCoinsFor\(/);
    assert.match(read("src/app/burnticker/launch/page.tsx"), /<DuplicateNotice existing=\{c\.existing\} \/>/);
  });
});

describe("item 8: the local watchlist (browser only, nothing sent)", () => {
  test("parse and toggle are pure; malformed storage is an empty list; one key shared with the static home", () => {
    // since private review 8 F1 a follow is a network-and-mint key; old ticker entries parse into `legacy` (test/burntickerSitePolish.test.ts)
    const none = { coins: [], results: [], legacy: { coins: [], results: [] } };
    assert.deepEqual(parseWatchlist(null), none); assert.deepEqual(parseWatchlist("{bad"), none);
    assert.deepEqual(parseWatchlist(JSON.stringify({ coins: ["RAYS", "RAYS", "<script>", 3], results: ["DEFICIT"] })), { coins: [], results: [], legacy: { coins: ["RAYS"], results: ["DEFICIT"] } });
    const K = "mainnet:FwXiFscFSYXzvPVzV4rCw4UBcGDhT53xHDpsL3pVpzkp";
    const w = toggleWatch(toggleWatch(none, "coins", K), "results", K);
    assert.deepEqual([w.coins, w.results], [[K], [K]]); assert.deepEqual(toggleWatch(w, "coins", K).coins, []);
    assert.ok(read("site/burnticker/index.html").includes(`var KEY = "${WATCH_KEY}",`));
    for (const f of ["src/lib/burnticker/watchlist.ts", "src/app/burnticker/_components/useWatchlist.ts", "src/app/burnticker/_components/FollowButton.tsx"]) assert.doesNotMatch(read(f), /fetch\(|sendBeacon|XMLHttpRequest/, f);
    assert.match(read("src/lib/burnticker/watchlist.ts"), /try \{ return parseWatchlist\(window\.localStorage\.getItem\(WATCH_KEY\)\); \} catch/);
    assert.deepEqual(GRID_TABS.find((t) => t.id === "following")!.label, "Following");
    const list = [{ ticker: "RAYS", phase: null, progressPct: null, nextCheckAt: null, nextCloseTime: null, launchedAt: null, status: "live" }, { ticker: "OILERS", phase: null, progressPct: null, nextCheckAt: null, nextCloseTime: null, launchedAt: null, status: "live" }];
    assert.deepEqual(tabCoins("following", list, (t) => t.ticker === "OILERS").map((t) => t.ticker), ["OILERS"]);
    const st = gridState({ tab: "following", loading: false, error: null, all: list, shown: 0, query: "", generatedAt: null, now: 0 });
    assert.equal(st.kind, "empty"); clean((st as { body: string }).body, "following empty");
    for (const t of [WATCH_NOTE, WATCH_EMPTY, ...GRID_TABS.map((t) => t.rule)]) clean(t, t);
  });
});

describe("item 9: retirement in practical terms (one module; the end sink since the launch wizard audit 2026-10-19 F9)", () => {
  test("five questions answered from the implementation; the leftover answer follows the rule's end; every page reads the one module", () => {
    assert.deepEqual(RETIREMENT_FACTS.map((f) => f.q), ["Can holders still sell?", "Does trading continue?", "Do fees still come in?", "Which burns stop?", "What happens to what is left?"]);
    // launch wizard audit F9: the general answer says the end sink and the void wind-down, never "nothing is sent to another coin"
    assert.match(RETIREMENT_FACTS[4].a, /\$DEFICIT's burn/); assert.match(RETIREMENT_FACTS[4].a, /over 28 days/);
    assert.doesNotMatch(RETIREMENT_FACTS.map((f) => f.a).join(" "), /Nothing is sent to another coin/);
    assert.doesNotMatch(read("src/lib/burnticker/retirementCopy.ts"), /END-SINK SWITCH/);
    for (const f of [...RETIREMENT_FACTS, ...retirementFacts(LEFTOVER_SEE_END)]) { clean(f.q, f.q); clean(f.a, f.q); }
    clean(RETIREMENT_HEADING, "heading"); clean(NO_END_LINE, "no end");
    assert.match(read("src/app/burnticker/t/[ticker]/page.tsx"), /<RetirementFacts className="mt-1" leftover=\{LEFTOVER_SEE_END\} \/>/); assert.match(read("src/app/burnticker/launch/ReviewCard.tsx"), /<RetirementFacts className="mt-1" open leftover=\{LEFTOVER_SEE_END\} \/>/, "website-15 item 12: inside the one collapsed end-of-rule block");
  });
});

describe("item 10: share previews for coin and receipt links", () => {
  test("the coin, the event, the network and the burn amount checked against its rule, in the card's words; no market words", () => {
    const c = coinPreview({ ticker: "RAYS", name: "Rays", rule: "burns when the Rays lose", cluster: "mainnet", verifiedBurned: "1234.5", verifiedCount: 2, pctOfSupply: 0.12, badgeUrl: "https://burnticker.com/api/burnticker/v1/badge/RAYS.png" });
    assert.equal(c.description, "Burns when the Rays lose. On Solana mainnet. 1,234.5 $RAYS, 0.12% of supply, burned on 2 receipts checked against its rule.");
    const r = receiptPreview({ ticker: "DEFICIT", cluster: "devnet", settledAt: "2026-10-06", event: "the U.S. national debt reading", units: 23, burned: "4010874.872446", verified: true, status: "confirmed", badgeUrl: null });
    assert.match(r.description, /^The result of Oct 6 \(the U\.S\. national debt reading\) on Solana devnet, a practice network where tokens have no money value\. 4,010,874\.87 \$DEFICIT burned from 23 units\./);
    const z = coinPreview({ ticker: "NEW", name: "New", rule: "x y z", cluster: "mainnet", verifiedBurned: "0", verifiedCount: 0, pctOfSupply: null, badgeUrl: null });
    for (const p of [c, r, z]) { clean(p.description, p.title); clean(p.title, p.title); }
    assert.match(read("src/app/burnticker/t/[ticker]/layout.tsx"), /generateMetadata/); assert.match(read("src/app/burnticker/check/page.tsx"), /receiptSharePreview\(sig, cluster\)/);
  });
});

describe("item 11: the graduation preset, 40 / 60 / 85 SOL (§75)", () => {
  test("presets and sentences; default 85; mainnet refuses anything else; devnet takes a small raise as the CLI does", () => {
    assert.deepEqual([...RAISE_PRESETS_SOL], ["10", "40", "60", "85"]); assert.equal(DEFAULT_RAISE_SOL, "85");
    assert.equal(raiseLamportsOf(undefined), LAUNCHLAB_RAISE_LAMPORTS); assert.equal(raiseLamportsOf("40"), BigInt(40_000_000_000));
    assert.equal(raiseProblem("40", "mainnet"), null); assert.equal(raiseProblem("50", "mainnet"), "The graduation raise must be 10, 40, 60 or 85 SOL on mainnet.");
    assert.equal(raiseProblem("1", "devnet"), null); assert.match(raiseProblem("100", "devnet")!, /0\.1 to 85/);
    for (const t of [...Object.values(RAISE_PRESET_TEXT), RAISE_PRESET_SHARED]) clean(t, t);
    assert.match(RAISE_PRESET_SHARED, /at most 2% of the pool's SOL/);
    const base = { creator: CREATOR, ticker: "ZQXJ", name: "Zqxj coin", description: "", imageUrl: null, links: [], rule: {}, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true } };
    assert.ok(launchProblems({ ...base, cluster: "mainnet", raiseSol: "70" }).includes("The graduation raise must be 10, 40, 60 or 85 SOL on mainnet."));
  });
  test("the server refuses a non-preset mainnet raise before anything else; the bundle passes the chosen raise to LaunchLab", async () => {
    const w = await makeWorld();
    const rule = JSON.parse(w.bronco.rulesJson);
    const body = { creator: CREATOR, ticker: "ZQXJ", name: "Zqxj coin", description: "", firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true }, rule };
    const main = await prepareLaunch({ ...w.p, cluster: "mainnet" } as typeof w.p, { ...body, raiseSol: "50" }, { register: false });
    assert.ok("error" in main); assert.equal(main.error.status, 400); assert.equal((main.error.body as { code: string }).code, "raise-not-preset");
    const ok40 = await prepareLaunch({ ...w.p, cluster: "mainnet" } as typeof w.p, { ...body, raiseSol: "40" }, { register: false });
    assert.ok("error" in ok40); assert.equal((ok40.error.body as { code: string }).code, "mainnet-launches-off", "a preset passes the raise check and meets the host's mainnet switch");
    for (const [raise, lamports] of [["40", "40000000000"], [undefined, "85000000000"]] as const) {
      const d = await prepareLaunch(w.p, { ...body, ticker: raise ? "ZQXK" : "ZQXL", ...(raise ? { raiseSol: raise } : {}) }, { register: false });
      assert.ok("ok" in d, JSON.stringify((d as { error?: unknown }).error));
      const ix = d.ok.bundle.transactions.flatMap((t) => t.instructions).find((i) => /initializeV2/.test((i as { label?: string }).label ?? ""))!;
      assert.equal(JSON.parse(Buffer.from(ix.dataBase64, "base64").toString("utf8")).totalFundRaisingB, lamports);
    }
  });
  test("the review states the chosen raise and the pool it starts; prerequisite lines name the coin's own raise or the three choices", () => {
    const rule = { schema: "burnticker.rules/v1", oracle: "catalogue", series: "treasury.debt", market: null, filter: {}, kind: "scalar", scalar: { unit: 1_000_000_000, perUnit: { fractionOfPool: 0.02 }, baseline: "previousSettlement", direction: "up" }, binary: null, onVoid: "skip", floorUsd: "1", reserveSol: "0.02", vault: null };
    const env = { BURNTICKER_CLUSTER: "mainnet", [CREATOR_LAUNCHES_FLAG]: "1" };
    const r = buildLaunchReview({ rule, ticker: "DEBTX", name: "Debt X", raiseSol: "60" }, { env });
    assert.ok("review" in r, JSON.stringify(r)); assert.equal(r.review.raise!.sol, "60");
    assert.equal(r.review.raise!.line, "The curve is complete once buyers have put in 60 SOL, and the coin moves to its Raydium pool, which starts with roughly 60 SOL.");
    assert.equal(r.review.prerequisiteLine, prerequisiteLineFor("launchlab", "60")); assert.match(r.review.prerequisiteLine, /must raise 60 SOL/);
    const bad = buildLaunchReview({ rule, ticker: "DEBTX", name: "Debt X", raiseSol: "70" }, { env });
    assert.ok("review" in bad); assert.ok(bad.review.problems.includes("The graduation raise must be 10, 40, 60 or 85 SOL on mainnet.")); assert.equal(bad.review.signable, false);
    const dflt = buildLaunchReview({ rule, ticker: "DEBTX", name: "Debt X" }, { env });
    assert.ok("review" in dflt); assert.equal(dflt.review.raise!.sol, "85"); assert.equal(dflt.review.costs.totalSol, launchLabCostSol("0.02"));
    clean(r.review.raise!.line, "raise line"); clean(prerequisiteLineFor("launchlab"), "prereq");
  });
  test("no coin surface prints a typed 85: cards, coin pages, the coins page, the $DEFICIT pages read the coin's own raise from its pool", () => {
    for (const f of ["src/lib/burnticker/home.ts", "src/lib/burnticker/cardView.ts", "src/app/burnticker/CoinsIndex.tsx", "src/app/burnticker/t/[ticker]/page.tsx", "src/app/burnticker/t/[ticker]/DeficitPrelaunch.tsx"]) {
      const code = read(f).replace(/^\s*(\/\/|\*|\/\*).*$/gm, "");
      assert.doesNotMatch(code, /STANDARD_RAISE_LAMPORTS|LAUNCHLAB_RAISE_LAMPORTS|GRADUATION_SOL|\b85 SOL\b|"85"/, f);
    }
    assert.equal(curveLine({ raised: null, of: null, pct: null, done: false, why: null }), "— raised"); assert.equal(curveLine({ raised: "35.7", of: "85 SOL", pct: 42, done: false, why: null }), "35.7 / 85 SOL raised");
    const card = read("src/app/burnticker/launch/ReviewCard.tsx");
    assert.match(card, /data-optional="preset" className=\{chip\(p\.raise!\.value === x\)\}/, "a preset row, not a dial");
  });
});

describe("item 12: creator onboarding, copy only", () => {
  test("three sentences: what a creator does, what it costs (the review's own estimate), what they get; the no-fee line beside them", () => {
    const s = onboardingSentences(launchLabCostSol());
    assert.equal(s.length, 3); assert.match(s[1], new RegExp(`about ${launchLabCostSol().replace(".", "\\.")} SOL`));
    for (const t of s) clean(t, t);
    const comp = read("src/app/burnticker/_components/CreatorOnboarding.tsx");
    assert.match(comp, /onboardingSentences\(launchLabCostSol\(\)\)/); assert.match(comp, /\{NO_FEE_REVENUE_LINE\}/);
    assert.match(read("src/app/burnticker/templates/page.tsx"), /<CreatorOnboarding \/>/); assert.match(read("src/app/burnticker/launch/page.tsx"), /data-examples-benefits>[\s\S]*<CreatorOnboarding \/>/, "website-18: in the closed disclosure below the wizard");
    assert.match(read("src/app/burnticker/launch/page.tsx"), /\/search\/miss/, "the search-miss telemetry stays");
  });
});

function scratchRoot(status: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bt-w14-"));
  for (const rel of ["config/burnticker/current-status.json", "config/burnticker/transparency.json", "config/burnkeeper/deficit.rules.json", "config/burnkeeper/rehearsal.rules.json", "config/burnkeeper/deficit.devnet.rules.json"]) { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.copyFileSync(rel, path.join(root, rel)); }
  const st = JSON.parse(read("config/burnticker/current-status.json")) as { demo: { evidence: string } };
  fs.mkdirSync(path.dirname(path.join(root, st.demo.evidence)), { recursive: true }); fs.copyFileSync(st.demo.evidence, path.join(root, st.demo.evidence));
  const own = JSON.parse(read("config/own-tokens.json")) as { tokens: { symbol: string; status: string }[] };
  own.tokens.find((t) => t.symbol === "DEFICIT")!.status = status;
  fs.writeFileSync(path.join(root, "config/own-tokens.json"), JSON.stringify(own));
  return root;
}
