// WEBSITE-15 (2026-10-12; WEBSITE-15-BRIEF.md, nineteen items): the fixes-only pass after Claude site audit 3 and ChatGPT code review 6
// of public 4f01c46. This suite pins the new truth item by item. Every new sentence passes the copy lint.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { formatHits, lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import { deficitQueueCore } from "@/lib/burnticker/deficitQueueCore.mjs";
import { deficitQueue, readKeeperFiles } from "@/lib/burnticker/deficitQueue";
import { featuredCoins, homeData } from "@/lib/burnticker/home";
import { readinessOf } from "@/lib/burnticker/readiness";
import {
  SETTLEMENT_LABEL, UPCOMING_EMPTY, UPCOMING_NONE_ACTIVE, UPCOMING_UNAVAILABLE, upcomingFromKeeper, upcomingNotice, upcomingSet, type UpcomingRow,
} from "@/lib/burnticker/upcoming";

const cfg = loadCopyLintConfig();
const clean = (t: string, what: string) => { const r = lintCopy(t, cfg); assert.ok(r.ok, `${what}:\n${formatHits(r)}`); };
const read = (f: string) => fs.readFileSync(f, "utf8");
const NOW = Date.parse("2026-10-20T22:00:00Z");

const keeperStatus = () => ({
  schema: "burnkeeper.status/v1", ticker: "DEFICIT", cluster: "mainnet", generatedAt: "2026-10-20T21:50:00Z",
  feed: { lastRecordDate: "2026-10-19", lastAmount: "38512345678901.23", nextPollAt: "2026-10-20T20:30:00Z", baseline: { recordDate: "2026-10-14", amount: "38490000000000.00" } },
  buyback: { fractionPerUnit: "0.02" },
  burned: { total: "0", pctOfSupply: 0, count: 0 },
  curve: { phase: "curve", raised: "31.5", threshold: "85", quote: "SOL", progressPct: 37.06, poolId: "Pool1", readAt: "2026-10-20T21:50:00Z" },
  readiness: readinessOf({ launched: true, phase: "curve", raisedSol: 31.5, graduationSol: 85, poolVerified: false, latest: null }),
  program: { queue: { lastOnChain: "2026-10-16" }, pool: { registered: false, address: null } },
});
const queued = [
  { recordDate: "2026-10-15", status: "planned", units: 12, waitReason: "waiting for the CPMM pool", signature: null, skippedReason: null },
  { recordDate: "2026-10-16", status: "planned", units: 3, waitReason: "waiting for the CPMM pool", signature: null, skippedReason: null },
];
const SCHED = { feedName: "U.S. Treasury, Debt to the Penny", feedUrl: null, polls: ["16:30"], timeZone: "America/New_York" };

function scratchRoot(status: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bt-web15-"));
  for (const rel of ["config/burnticker/current-status.json", "config/burnticker/transparency.json", "config/burnkeeper/deficit.rules.json", "config/burnkeeper/rehearsal.rules.json", "config/burnkeeper/deficit.devnet.rules.json"]) { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.copyFileSync(rel, path.join(root, rel)); }
  const st = JSON.parse(read("config/burnticker/current-status.json")) as { demo: { evidence: string } };
  fs.mkdirSync(path.dirname(path.join(root, st.demo.evidence)), { recursive: true }); fs.copyFileSync(st.demo.evidence, path.join(root, st.demo.evidence));
  const own = JSON.parse(read("config/own-tokens.json")) as { tokens: { symbol: string; status: string }[] };
  own.tokens.find((t) => t.symbol === "DEFICIT")!.status = status;
  fs.writeFileSync(path.join(root, "config/own-tokens.json"), JSON.stringify(own));
  return root;
}

describe("item 1: unknown is never zero (code review 6, P2 1)", () => {
  const bad: [string, unknown][] = [["missing", null], ["malformed", undefined], ["wrong shape (object)", { rows: [] }], ["wrong shape (string)", "[]"], ["wrong shape (rows)", [1, 2]], ["wrong shape (row without status)", [{ recordDate: "2026-10-15", units: 3 }]]];
  test("the core: missing, malformed and wrong-shape burns are unavailable; a valid empty list may say zero; a valid list counts", () => {
    for (const [what, b] of bad) {
      const q = deficitQueueCore(keeperStatus(), b, NOW);
      assert.equal(q.state, "unavailable", what); assert.equal(q.card, null, what); assert.equal(q.units, 0, what);
      assert.match(q.headline, /^The queue is unavailable, because the keeper's list of readings and burns did not load\.$/, what);
      assert.doesNotMatch(q.headline + q.lines.join(" "), /No units are queued|nothing is due/, what);
      clean(q.headline, what);
    }
    const empty = deficitQueueCore(keeperStatus(), [], NOW);
    assert.equal(empty.state, "queued"); assert.match(empty.headline, /No units are queued\./);
    assert.equal(deficitQueueCore(keeperStatus(), { burns: [] }, NOW).state, "queued", "the { burns: [] } shape is valid");
    const q = deficitQueueCore(keeperStatus(), queued, NOW);
    assert.equal(q.state, "queued"); assert.equal(q.units, 15); assert.equal(q.card, "0 $DEFICIT, 15 units queued");
  });
  test("the static $DEFICIT core is the same function: the same answers for all five cases", () => {
    const site = read("site/deficit/index.html");
    const src = /window\.deficitQueueCore = (function deficitQueueCore[\s\S]*?\n\});\n<\/script>/.exec(site)![1];
    const fn = new Function(`return (${src});`)() as typeof deficitQueueCore;
    for (const b of [null, undefined, { rows: [] }, [1], [], queued]) assert.deepEqual(fn(keeperStatus(), b, NOW), deficitQueueCore(keeperStatus(), b, NOW));
  });
  test("the static page: an unread or wrong-shape burns.json shows Data unavailable and renders no receipt list or count", () => {
    const site = read("site/deficit/index.html");
    assert.doesNotMatch(site, /getJson\("burns\.json"\)\.catch\(function \(\) \{ return \[\]; \}\)/, "a failed read is no longer an empty list");
    assert.match(site, /return \{ unreadable: String\(e && e\.message \|\| e\) \};/);
    assert.match(site, /renderQueue\(status, null\); draw\(\);\n\s+offline\("Data unavailable\. The keeper's list of readings and burns did not load just now, so no receipt or count is shown\. Try again later\."/);
    clean("Data unavailable. The keeper's list of readings and burns did not load just now, so no receipt or count is shown. Try again later.", "static notice");
  });
  test("the app's file read: a missing or unparsable burns.json comes back null with a reason, and the queue says unavailable", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bt-keeper15-"));
    fs.writeFileSync(path.join(dir, "status.json"), JSON.stringify(keeperStatus()));
    const missing = readKeeperFiles({ BURNKEEPER_PUBLISH_DIR: dir }, "/");
    assert.equal(missing.burns, null); assert.match(missing.burnsError!, /has not published a burn list/); assert.equal(deficitQueue(missing, NOW).state, "unavailable");
    fs.writeFileSync(path.join(dir, "burns.json"), "{not json");
    const broken = readKeeperFiles({ BURNKEEPER_PUBLISH_DIR: dir }, "/");
    assert.equal(broken.burns, null); assert.match(broken.burnsError!, /could not be read/); assert.equal(deficitQueue(broken, NOW).state, "unavailable");
    fs.writeFileSync(path.join(dir, "burns.json"), "[]");
    const empty = readKeeperFiles({ BURNKEEPER_PUBLISH_DIR: dir }, "/");
    assert.deepEqual(empty.burns, []); assert.equal(empty.burnsError, null); assert.equal(deficitQueue(empty, NOW).state, "queued");
  });
  test("the featured card and the Next results row say unavailable, never zero or nothing due", () => {
    const root = scratchRoot("launched");
    for (const [what, b] of bad) {
      const f = featuredCoins(root, null, [], { status: keeperStatus(), burns: b, error: null }, NOW)[0];
      assert.equal(f.burned.text, "Unavailable", what); assert.match(f.burned.why!, /did not load/, what);
      const row = upcomingFromKeeper(keeperStatus(), b, SCHED)!;
      assert.equal(row.status, "unavailable", what); assert.equal(SETTLEMENT_LABEL[row.status], "Unavailable");
      assert.doesNotMatch(row.statusText, /counted no unit|nothing is due/, what); clean(row.statusText, what);
    }
    const ok = featuredCoins(root, null, [], { status: keeperStatus(), burns: queued, error: null }, NOW)[0];
    assert.equal(ok.burned.text, "0 $DEFICIT, 15 units queued");
    assert.equal(upcomingFromKeeper(keeperStatus(), [], SCHED)!.status, "waiting", "a valid empty history may say nothing is due");
  });
});

describe("item 2: Next results never hides a failure (code review 6, P2 2)", () => {
  const row = (t: string): UpcomingRow => ({ ticker: t, name: t, href: `/burnticker/t/${t}`, network: "mainnet", event: "e", source: "s", sourceUrl: null, schedule: "x", nextAt: null, status: "waiting", statusText: "y", receiptHref: null });
  test("empty registry, all inactive, full failure, partial, unread registry: five different answers", () => {
    const empty = upcomingSet([], [], 0);
    assert.equal(empty.state, "ready"); assert.equal(upcomingNotice(empty), UPCOMING_EMPTY);
    const retired = upcomingSet([], [], 3);
    assert.equal(retired.state, "ready"); assert.equal(upcomingNotice(retired), UPCOMING_NONE_ACTIVE); assert.match(UPCOMING_NONE_ACTIVE, /^No pending results\./);
    const allFail = upcomingSet([], [{ ticker: "RAYS", reason: "r" }, { ticker: "CUBS", reason: "r" }], 2);
    assert.equal(allFail.state, "unavailable"); assert.equal(upcomingNotice(allFail), "The next results are unavailable, because this site could not read $RAYS and $CUBS just now.");
    const partial = upcomingSet([row("RAYS")], [{ ticker: "CUBS", reason: "r" }], 2);
    assert.equal(partial.state, "partial"); assert.deepEqual(partial.rows.map((r) => r.ticker), ["RAYS"]);
    assert.equal(upcomingNotice(partial), "Some next results are missing, because this site could not read $CUBS just now.");
    const unread = upcomingSet([], [], null);
    assert.equal(unread.state, "unavailable"); assert.equal(upcomingNotice(unread), UPCOMING_UNAVAILABLE);
    assert.equal(upcomingNotice(upcomingSet([row("RAYS")], [], 1)), null);
    for (const t of [UPCOMING_EMPTY, UPCOMING_NONE_ACTIVE, UPCOMING_UNAVAILABLE, upcomingNotice(allFail)!, upcomingNotice(partial)!]) clean(t, t);
  });
  test("homeData carries the set: an unread registry (null) is unavailable, an empty one is ready and empty", () => {
    assert.equal(homeData(null, "/nonexistent-root").upcoming.state, "unavailable");
    assert.deepEqual(homeData([], "/nonexistent-root").upcoming, { state: "ready", rows: [], omitted: [], registered: 0 });
  });
  test("the route names failed coins and an unread registry; the page and the static strip print the same sentences", () => {
    const route = read("src/app/api/burnticker/home/route.ts");
    assert.match(route, /omitted\.push\(\{ ticker: t\.ticker, reason: "This site could not read the coin's page\." \}\)/);
    assert.match(route, /coins = null; registered = null;/); assert.match(route, /const next = upcomingSet\(upcoming, omitted, registered\);/);
    assert.match(route, /console\.error\(`\[burnticker\/home\] \$\{t\.ticker\}/, "the real error is logged server-side");
    const pg = read("src/app/burnticker/upcoming/NextResults.tsx");
    assert.match(pg, /upcomingNotice\(set\)/); assert.match(pg, /data-upcoming-partial/); assert.doesNotMatch(pg, /UPCOMING_EMPTY/);
    const home = read("site/burnticker/index.html");
    for (const t of [UPCOMING_EMPTY, UPCOMING_NONE_ACTIVE, UPCOMING_UNAVAILABLE, "Some next results are missing, because this site could not read "]) assert.ok(home.includes(t), t);
    assert.doesNotMatch(home, /Array\.isArray\(j\.upcoming\)/, "the static strip reads the set, not a bare list");
  });
});

describe("item 3: hydration error #418 on every page (Claude site audit 3 item 1)", () => {
  test("cause: the CDN rewrites a contiguous email address in server HTML; every printed operator line keeps its @ in its own element", async () => {
    const { mailSafeParts } = await import("@/lib/burnticker/mailSafe");
    assert.deepEqual(mailSafeParts("Operated by one operator, contact: contact@burnticker.com. Thanks"), [
      { text: "Operated by one operator, contact: ", email: false }, { text: "contact@burnticker.com", email: true }, { text: ". Thanks", email: false },
    ]);
    assert.deepEqual(mailSafeParts("no address"), [{ text: "no address", email: false }]);
    const comp = read("src/app/burnticker/_components/MailSafe.tsx");
    assert.match(comp, /\{local\}<span>@<\/span>\{domain\}/);
    const footer = read("src/app/burnticker/_components/SiteFooter.tsx");
    assert.equal((footer.match(/<MailSafe text=\{OPERATOR_LINE\} \/>/g) ?? []).length, 2, "the slip footer and the one-line footer");
    // no component under src/app prints the operator line or a literal address as bare text
    const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith(".tsx") ? [path.join(d, e.name)] : []);
    for (const f of walk("src/app")) {
      const code = read(f).replace(/^\s*(\/\/|\*|\/\*).*$/gm, "");
      assert.doesNotMatch(code, />\{(OPERATOR_LINE|t\?\.operatorLine[^}]*|x\.whoRunsThis\.operatorLine)\}/, f);
      assert.doesNotMatch(code.replace(/href=\{?[`"][^`"]*[`"]\}?/g, "").replace(/"[^"\n]*@[^"\n]*"|`[^`\n]*@[^`\n]*`/g, ""), />[^<{]*[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}[^<]*</, `${f} prints a literal address as bare text`);
    }
  });
});

describe("item 4: the back-test fails gracefully (Claude site audit 3 item 2)", () => {
  test("the review shows Backtest unavailable with the reason behind Details; the route and the handler log the real error", async () => {
    const { BACKTEST_UNAVAILABLE } = await import("@/lib/burnticker/oracle/backtest");
    assert.equal(BACKTEST_UNAVAILABLE, "Backtest unavailable."); clean(BACKTEST_UNAVAILABLE, "backtest");
    const pg = read("src/app/burnticker/launch/page.tsx");
    assert.match(pg, /\{btErr && btFor === btKey && !rv\?\.projection && <div[^>]*data-backtest-unavailable><p>\{btErr\.includes\(BACKTEST_SLOW\) \? BACKTEST_SLOW : BACKTEST_UNAVAILABLE\}<\/p><details/, "website-20: shown only when the review has no projection (WIRING-PARITY audit 6 #11)");
    assert.match(pg, /await r\.json\(\)\.catch\(\(\) =>/, "a non-JSON 502 page is still an error, not a crash");
    const route = read("src/app/api/burnticker/oracle/backtest/route.ts");
    assert.match(route, /console\.error\("\[burnticker\/backtest\] the back-test route failed:", e\)/);
    assert.match(read("src/lib/burnticker/api/handlers.ts"), /console\.error\("\[burnticker\/backtest\] the back-test failed:", e\);\n\s+return fail\(502/);
  });
});

describe("item 5: one search (Claude site audit 3 items 3 and 7)", () => {
  test("a query that matches only a featured coin says so; no match anywhere names the query", async () => {
    const { gridState, searchMissSentence } = await import("@/lib/burnticker/coinsGrid");
    const base = { tab: "new" as const, loading: false, error: null, all: [{ ticker: "RAYS", phase: null, progressPct: null, nextCheckAt: null, nextCloseTime: null, launchedAt: null, status: "live" }], shown: 0, query: "rehearsal", generatedAt: null, now: NOW };
    assert.deepEqual(gridState({ ...base, featuredMatches: 1 }), { kind: "empty", body: "No tradeable coin matches. 1 featured coin does.", notLaunched: false });
    assert.equal(searchMissSentence("x", 2), "No tradeable coin matches. 2 featured coins do.");
    assert.equal(gridState({ ...base, featuredMatches: 0 }).kind === "empty" && (gridState({ ...base, featuredMatches: 0 }) as { body: string }).body, 'No coin matches "rehearsal".');
    for (const t of [searchMissSentence("x", 1), searchMissSentence("x", 2), searchMissSentence("x", 0)]) clean(t, t);
  });
  test("the header box and the page box are one state with one placeholder; the page passes its featured matches to the grid", () => {
    const idx = read("src/app/burnticker/CoinsIndex.tsx"), head = read("src/app/burnticker/_components/SiteHeader.tsx");
    assert.match(idx, /placeholder=\{SEARCH\.placeholder\} aria-label=\{SEARCH\.label\}/); assert.match(head, /placeholder=\{SEARCH\.placeholder\}/);
    assert.match(idx, /window\.dispatchEvent\(new CustomEvent\("bt-search-sync", \{ detail: v \}\)\)/); assert.match(head, /window\.addEventListener\("bt-search-sync", onSync\)/);
    assert.match(head, /window\.dispatchEvent\(new CustomEvent\("bt-search-input", \{ detail: v \}\)\)/); assert.match(idx, /window\.addEventListener\("bt-search-input", onInput\)/);
    assert.match(idx, /featuredMatches: s \? featured\.length : 0/);
  });
});

describe("item 6: progress and readiness, one model (Claude site audit 3 item 4a; ChatGPT repair 2)", () => {
  test("not created is step 0 with nothing lit; later headings name the next unmet milestone; the readiness panel uses the same six steps", async () => {
    const { progressOf, progressNow, progressSummary, PROGRESS_STEPS } = await import("@/lib/burnticker/progress");
    const pre = progressOf(readinessOf({ launched: false, phase: null, raisedSol: null, poolVerified: null, latest: null }));
    assert.equal(pre.done, 0); assert.equal(pre.now, "Not created"); assert.ok(pre.steps.every((s) => s.state === "todo"), "no step lit before the coin exists");
    assert.equal(progressSummary(pre), "Step 0 of 6. The coin is not created yet.");
    const curve = progressOf(readinessOf({ launched: true, phase: "curve", raisedSol: 1, graduationSol: 85, poolVerified: false, latest: null }));
    assert.equal(curve.now, "Next: graduation"); assert.deepEqual(curve.steps.map((s) => s.state), ["done", "done", "current", "todo", "todo", "todo"]);
    assert.equal(progressNow(6), "Burned"); assert.equal(progressNow(3), "Next: pool registration");
    for (let d = 0; d <= PROGRESS_STEPS.length; d++) assert.doesNotMatch(progressNow(d), /^Now:/);
    const panel = read("src/app/burnticker/_components/ReadinessPanel.tsx"), strip = read("src/app/burnticker/_components/ProgressStrip.tsx"), home = read("site/burnticker/index.html");
    assert.match(panel, /const p = progressOf\(r\);/); assert.match(panel, /step \{p\.done\} of \{PROGRESS_STEPS\.length\}/); assert.doesNotMatch(panel, /READINESS_ORDER/);
    assert.match(strip, /<span className="bt-progress-now">\{p\.now\}<\/span>/); assert.doesNotMatch(strip + home, /"Now: "|`Now: /);
    assert.match(home, /el\("span", "prog-now", v\.progress\.now \|\| ""\)/);
    for (const t of [pre.now, curve.now, progressSummary(pre), progressSummary(curve)]) clean(t, t);
  });
  test("the devnet card marks curve and graduation not applicable and keeps its real devnet burn", () => {
    const dv = featuredCoins(scratchRoot("planned"), null, [], null, NOW).find((v) => v.id === "deficit-devnet")!;
    assert.deepEqual(dv.progress!.steps.map((s) => s.state), ["done", "na", "na", "done", "done", "done"]);
    assert.equal(dv.progress!.now, "Burned"); assert.equal(dv.curve.na, true); assert.equal(dv.curve.pct, null);
    assert.match(dv.burned.text!, /\$DEFICIT/); assert.ok(dv.receipt);
    const deficit = featuredCoins(scratchRoot("planned"), null, [], null, NOW)[0];
    assert.equal(deficit.progress!.now, "Not created"); assert.ok(deficit.progress!.steps.every((s) => s.state === "todo"));
  });
});

describe("item 6 (static $DEFICIT site): the readiness line counts the same six steps", () => {
  test("its step table equals progress.ts PROGRESS_DONE; nothing says of 7", async () => {
    const { PROGRESS_DONE } = await import("@/lib/burnticker/progress");
    const site = read("site/deficit/index.html");
    const m = /var READY_DONE = (\{[^}]+\});/.exec(site)!;
    assert.deepEqual(new Function(`return (${m[1]});`)(), PROGRESS_DONE);
    assert.doesNotMatch(site, /of 7/); assert.match(site, /id="readyStep">Step 0 of 6 toward a first burn</);
  });
});

describe("item 7: missing-value reasons (Claude site audit 3 items 4b, 4c, 15; ChatGPT repair 3)", () => {
  test("the dash is a button described by its reason, opened by tap or focus; no reason is printed inline with a leading period", () => {
    const why = read("src/app/burnticker/_components/Why.tsx"), card = read("src/app/burnticker/_components/CoinCard.tsx"), home = read("site/burnticker/index.html");
    assert.match(why, /<button type="button" className="bt-why-btn" aria-describedby=\{id\} aria-expanded=\{open\}/); assert.match(why, /role="tooltip"/); assert.match(why, /useId\(\)/);
    assert.match(card, /return <Why label=\{emptyLabel\(v, c\.why\)\} why=\{c\.why \?\? "This site has no reading for this field\."\} \/>;/);
    for (const src of [card, home]) assert.doesNotMatch(src, /sr-only">\. \{|"sh-sr", "\. " \+|r\.textContent = "\. " \+ why/, "no inline reason with a period prefix");
    assert.match(home, /window\.btWhy = function \(label, why, name\)/); assert.match(home, /b\.setAttribute\("aria-describedby", id\)/);
    assert.match(home, /if \(c\.text === null\) return window\.btWhy\(label \|\| "No data yet"/); // site polish: the empty label, not a dash
    const css = read("config/public-repo/overlay/src/app/globals.css");
    assert.match(css, /\.bt-why-tip\.is-open, \.bt-why-btn:focus-visible \+ \.bt-why-tip \{ display: block; \}/);
  });
  test("no sentence describes the interface to itself", () => {
    const home = read("site/burnticker/index.html");
    assert.doesNotMatch(home, /pointing at it shows why|A row this site has not read shows a dash/);
    clean("This site has no reading for this field.", "why default");
  });
});

describe("item 8: feed and source diagnostics out of the UI (Claude site audit 3 item 6; ChatGPT repair 4)", () => {
  test("a schedule not read: the card says Next game: not available, once; no banner; no warning carried into the review; logged", async () => {
    const { NEXT_GAME_UNAVAILABLE } = await import("@/lib/burnticker/sources/provenance");
    assert.equal(NEXT_GAME_UNAVAILABLE, "Next game: not available."); clean(NEXT_GAME_UNAVAILABLE, "next game");
    const pg = read("src/app/burnticker/launch/page.tsx");
    assert.doesNotMatch(pg, /\{scheduleNote && <p/, "no schedule banner on the picker"); assert.doesNotMatch(pg, /Technical detail:/);
    assert.doesNotMatch(pg, /setSrcWarnings\(scheduleNote/, "the schedule never becomes a review warning");
    assert.match(pg, /: scheduleNote \? NEXT_GAME_UNAVAILABLE : null\]\)/, "website-22 (QA 9 item 6): joined by teamLine, so no dangling dot"); assert.match(pg, /\{c\.scheduleUnavailable && <p[^>]*>\{NEXT_GAME_UNAVAILABLE\}<\/p>\}/);
    const h = read("src/lib/burnticker/api/handlers.ts");
    assert.equal((h.match(/console\.error\(`\[burnticker\/sports\] \$\{league\} schedule could not be read:`, e\)/g) ?? []).length, 2);
    assert.doesNotMatch(read("src/lib/burnticker/search.ts"), /rec\.note = scheduleNote/);
  });
  test("a source not configured: one plain line, the key name and schema refusals behind Details, never as a refuse-list sentence", async () => {
    const { sourceUnavailableLine, SOURCE_NOT_CONFIGURED, SOURCE_NOT_AVAILABLE } = await import("@/lib/burnticker/sources/provenance");
    const { feedCard } = await import("@/lib/burnticker/browse");
    assert.equal(sourceUnavailableLine("needs a key: EIA_API_KEY (free registration; the keyless call returned API_KEY_MISSING — that response is the fixture)"), "Unavailable: this data source is not configured on this site.");
    assert.equal(sourceUnavailableLine("not launchable"), SOURCE_NOT_AVAILABLE);
    for (const t of [SOURCE_NOT_CONFIGURED, SOURCE_NOT_AVAILABLE]) clean(t, t);
    const c = feedCard({ id: "eia.gas", tier: 3, tierLabel: "x", title: "Gas", sourceName: "EIA", sourceUrl: "", cadence: "weekly", unit: null, launchable: { ok: false, why: "needs a key: EIA_API_KEY" }, flags: [], lastReading: null, refusals: ["schema: no rows at response.data[*]"] });
    assert.deepEqual(c.refused, [], "a parse refusal is not the refuse list"); assert.deepEqual(c.diagnostics, ["schema: no rows at response.data[*]"]);
    const pg = read("src/app/burnticker/launch/page.tsx");
    assert.match(pg, /data-source-unavailable>\{.*sourceUnavailableLine\(c\.launchable\.why\)\}/); assert.doesNotMatch(pg, /not launchable\{c\.launchable\.why/);
  });
});

describe("item 9: $REHEARSAL in one sentence, and its pool read like any coin's (Claude site audit 3)", () => {
  test("one sentence on the card, the coin page, Trust (transparency.json) and current-status.json; the old lines are gone", async () => {
    const { REHEARSAL_SENTENCE } = await import("@/lib/burnticker/rehearsalCopy");
    assert.equal(REHEARSAL_SENTENCE, "A test coin the operator made on Oct 11 to check fees and signing. It is listed so you can see it exists, not so you trade it.");
    clean(REHEARSAL_SENTENCE, "rehearsal");
    const card = featuredCoins(scratchRoot("planned"), null, [], null, NOW).find((v) => v.id === "rehearsal")!;
    assert.equal(card.note, REHEARSAL_SENTENCE);
    assert.ok(read("config/burnticker/transparency.json").includes(`"text": "${REHEARSAL_SENTENCE} It was created`));
    assert.ok(read("config/burnticker/current-status.json").includes(`$REHEARSAL is a test coin the operator made on Oct 11 to check fees and signing. It is kept off the coin list and shown on the Test coins page`)); // walkthrough 13: a full sentence, and where it is listed
    assert.match(read("src/app/burnticker/t/[ticker]/page.tsx"), /<p data-rehearsal-sentence>\{REHEARSAL_SENTENCE\}<\/p>/);
    const everywhere = [read("src/lib/burnticker/home.ts"), read("src/app/burnticker/t/[ticker]/page.tsx"), read("config/burnticker/transparency.json"), read("config/burnticker/current-status.json")].join("\n");
    assert.doesNotMatch(everywhere, /It can only burn if outside buyers fill its curve|because it is not listed with the coins|throwaway coin, disclosed as one/);
  });
  test("its pool read fills progress, curve and market cap; unread is a plain dash with a plain reason", async () => {
    const { rehearsalCreate } = await import("@/lib/burnticker/home");
    const rh = rehearsalCreate()!;
    assert.equal(rh.poolId, "AAT9VJAhAJv7o5mZtm3EYLhSdcsxPZB7eTYbjd9phRgG"); assert.equal(rh.date, "2026-10-11");
    const read1 = featuredCoins(scratchRoot("planned"), null, [], null, NOW, { phase: "curve", raised: "1.25", threshold: "85", quote: "SOL", progressPct: 1.47, marketCap: "30.5" }).find((v) => v.id === "rehearsal")!;
    assert.deepEqual([read1.curve.raised, read1.curve.of], ["1.25", "85 SOL"]); assert.equal(read1.progress!.now, "Next: graduation"); assert.equal(read1.mcap.text, "30.5 SOL (curve-implied)");
    const unread = featuredCoins(scratchRoot("planned"), null, [], null, NOW, null).find((v) => v.id === "rehearsal")!;
    assert.equal(unread.curve.raised, null); assert.equal(unread.mcap.text, null); assert.equal(unread.progress, null);
    assert.equal(unread.curve.why, "This site could not read $REHEARSAL's pool just now."); clean(unread.curve.why!, "unread");
    assert.match(read("src/app/api/burnticker/home/route.ts"), /readKeeperCurve\(p\.market, \{ cluster: "mainnet", mint: rh\.mint, poolId: rh\.poolId \}, now\)/);
  });
});

describe("item 10: US spelling in what a visitor reads (Claude site audit 3)", () => {
  test("skeptic, organization, license (noun), colors, favor: the checklist, Trust, the whitepaper, the launcher's help", () => {
    const visible = [read("docs/burnticker/CHECK-THIS-YOURSELF.md"), read("site/burnticker/whitepaper.html"), read("src/lib/burnticker/trustpack/copy.ts"), read("src/lib/burnticker/fieldHelp.ts"), read("config/burnticker/transparency.json"), read("config/burnticker/current-status.json").replace(/"id": "sports-licence"/, "")].join("\n");
    assert.doesNotMatch(visible, /\bsceptic|\borganisation|\blicence\b|\bcolours\b|\bin favour\b/i);
    assert.match(read("docs/burnticker/CHECK-THIS-YOURSELF.md"), /This is a skeptic's checklist/);
    assert.equal(read("docs/burnticker/WHITEPAPER-2026-10-10.md").includes("favour"), true, "the frozen archive is not rewritten");
  });
});

describe("item 11: Powers Register without internal review ids in its cells (Claude site audit 3 item 8)", () => {
  test("labels and review ids move to the note column; the sentences stay; the register files are untouched", async () => {
    const { splitReviewRefs } = await import("@/lib/burnticker/trustpack/checklist");
    assert.deepEqual(splitReviewRefs("Return it (clear the list). Re-check R3-4: the platform authority may do it."), { text: "Return it (clear the list). The platform authority may do it.", note: "Review references: R3-4." });
    assert.deepEqual(splitReviewRefs("VETO: clear a pending proposal (re-check R3-2 — the cheap veto by the parties)."), { text: "Clear a pending proposal (the cheap veto by the parties).", note: "Veto. Review references: R3-2." });
    assert.equal(splitReviewRefs("STRANDING RECOVERY: propose a switch AND (re-check R3-2) have 90 %.").text, "Propose a switch AND have 90 %.");
    const doc = read("docs/burnticker/CHECK-THIS-YOURSELF.md");
    const section2 = doc.slice(doc.indexOf("## 2. Who can do what"), doc.indexOf("## 3."));
    assert.doesNotMatch(section2, /Re-check R|re-check R|STRANDING RECOVERY:|VETO:/);
    assert.match(read("src/app/burnticker/check/CheckClient.tsx"), /<th className="p-2">Note<\/th>/);
    assert.match(read("docs/burn-receipts/powers-register.json"), /Re-check R3-4/, "the generated register keeps its own words");
  });
});

describe("item 12: the launch review, short by default (Claude site audit 3 item 9; ChatGPT repairs 1 and 6)", () => {
  test("by default: card, rule sentence, budget, raise, cost line, button; the rest collapsed below the button, the wind-down once", () => {
    const rc = read("src/app/burnticker/launch/ReviewCard.tsx"), pw = read("src/app/burnticker/launch/PreWalletSummary.tsx"), pg = read("src/app/burnticker/launch/page.tsx");
    const order = ["data-summary>", "role=\"radiogroup\" aria-label={p.budget?.label ?? BUDGET_LABEL}", "aria-label={RAISE_LABEL}", "data-cost-line", "data-decision=\"launch\"", "data-review-more", "What the end of the rule means", "{p.summary}", "What you confirm by launching"].map((k) => rc.indexOf(k));
    assert.ok(order.every((x) => x > 0), JSON.stringify(order)); assert.deepEqual([...order].sort((a, b) => a - b), order);
    assert.match(pw, /<details className="min-w-0 rounded-lg[^"]*" aria-label="Before you connect a wallet" data-prewallet>/); assert.match(pw, /<summary className="cursor-pointer text-neutral-300">Who controls what today<\/summary>/);
    assert.doesNotMatch(pw, /endsLine/, "the end of the rule is said once, in its own block");
    assert.equal((rc.match(/<RetirementFacts/g) ?? []).length, 1);
    assert.doesNotMatch(pg, /data-vault-hidden|VAULT_HIDDEN_SENTENCE/, "the vault dev note is deleted");
    assert.match(pg, /cost=\{shownReview\.review && reviewCurrent \? `The estimated cost is about \$\{shownReview\.review\.costs\.totalSol\} SOL\.` : null\}/);
  });
  test("the preview notice sticks at the shared header's measured height, not a fixed top-14", () => {
    const pg = read("src/app/burnticker/launch/page.tsx"), head = read("src/app/burnticker/_components/SiteHeader.tsx");
    assert.doesNotMatch(pg, /sticky top-14/); assert.match(pg, /style=\{\{ top: "var\(--bt-header-h, 3\.5rem\)" \}\} role="status" data-preview-banner/);
    assert.match(head, /document\.documentElement\.style\.setProperty\("--bt-header-h", `\$\{Math\.ceil\(h\.getBoundingClientRect\(\)\.height\)\}px`\)/); assert.match(head, /new ResizeObserver\(set\)/);
  });
});

describe("item 14: the home's three steps on phones (Claude site audit 3 item 11)", () => {
  test("each step is a disclosure with a chevron and one line of body at 768 px and under; wide screens keep all three open", () => {
    const home = read("site/burnticker/index.html");
    const steps = /<ol class="how">([\s\S]*?)<\/ol>/.exec(home)![1];
    assert.equal((steps.match(/<details class="how-d" open><summary>/g) ?? []).length, 3);
    assert.equal((steps.match(/<span class="how-chev" aria-hidden="true"><\/span><span class="how-line" aria-hidden="true">[^<]+<\/span>/g) ?? []).length, 3);
    assert.match(home, /@media \(max-width:768px\)\{[\s\S]*?\.how-chev\{display:inline-block/); assert.doesNotMatch(home, /\.how-x\{display:none\}/);
    assert.match(home, /var narrow = window\.matchMedia\("\(max-width: 768px\)"\);/);
    for (const m of steps.matchAll(/<span class="how-line" aria-hidden="true">([^<]+)<\/span>/g)) clean(m[1], m[1]);
  });
});

describe("item 15: the stat strip and the activity line (Claude site audit 3 item 12)", () => {
  test("the strip carries the devnet practice burns, marked devnet in the page, while mainnet has none", async () => {
    const { withDevnet, homeStats } = await import("@/lib/burnticker/home");
    const { sampleReceipts } = await import("@/lib/burnticker/trustpack/samples");
    const s = withDevnet(homeStats({ burns: 0, burnedTokens: "0" }, null), sampleReceipts(process.cwd()))!;
    assert.ok(s.devnet && s.devnet.burns >= 1 && Number(s.devnet.burnedTokens) > 0, JSON.stringify(s.devnet));
    assert.equal(withDevnet(null, null), null);
    const home = read("site/burnticker/index.html");
    assert.match(home, /put\("burned", group\(s\.devnet\.burnedTokens\) \+ " \(devnet\)"\); put\("burns", group\(s\.devnet\.burns\) \+ " \(devnet\)"\)/);
    assert.doesNotMatch(home, /The devnet practice burns in the line above are not counted/);
  });
  test("mainnet rows from real records lead the line: $REHEARSAL created (its create signature) and, since 2026-10-13, $DEFICIT created (its create signature); no reserved row any more", async () => {
    const { mainnetRecordEvents, homeData } = await import("@/lib/burnticker/home");
    const { EVENT_LABEL } = await import("@/lib/burnticker/activity");
    const ev = mainnetRecordEvents();
    const created = ev.find((e) => e.kind === "created" && e.ticker === "REHEARSAL")!, deficit = ev.find((e) => e.kind === "created" && e.ticker === "DEFICIT")!;
    assert.equal(created.text, "$REHEARSAL created on mainnet, Oct 11"); assert.equal(created.network, "mainnet"); assert.match(created.href, /^https:\/\/explorer\.solana\.com\/tx\/3fJdoqa2/);
    assert.equal(deficit.text, "$DEFICIT created on mainnet, Oct 13"); assert.equal(deficit.at, "2026-10-13"); assert.match(deficit.href, /^https:\/\/explorer\.solana\.com\/tx\/2YyZVB96/);
    assert.ok(!ev.some((e) => e.kind === "reserved"), "the coin is created, so no reserved row");
    assert.equal(EVENT_LABEL.created, "Created"); assert.equal(EVENT_LABEL.reserved, "Mint reserved");
    // owner 2026-10-14: $REHEARSAL is a test coin (testCoins.ts), so its row stays in the records but leaves the home's line
    const line = homeData([], process.cwd()).events;
    assert.equal(line[0].kind, "created", "mainnet first"); assert.equal(line[0].ticker, "DEFICIT");
    assert.ok(!line.some((e) => e.ticker === "REHEARSAL"));
    const launched = scratchRoot("launched");
    assert.ok(!mainnetRecordEvents(launched).some((e) => e.kind === "reserved"), "no reserved row once the coin is created");
  });
});

describe("item 16: 'Who runs this' in the menu and the footer (Claude site audit 3 item 13)", () => {
  test("the label changes everywhere; the address stays /burnticker/operator", async () => {
    const { LEARN_NAV: LEARN } = await import("@/lib/burnticker/siteNav.mjs");
    const item = (LEARN as { label: string; href: string }[]).find((n) => n.href === "/burnticker/operator")!;
    assert.equal(item.label, "Who runs this");
    for (const f of ["site/burnticker/index.html", "site/deficit/index.html", "site/burnticker/whitepaper.html"]) { const h = read(f); assert.ok(h.includes(">Who runs this<"), f); assert.doesNotMatch(h, />Operator</, f); }
    assert.ok(read("src/lib/burnticker/sitemap.ts").includes('"/burnticker/operator"'));
  });
});

describe("item 17: the status block once (Claude site audit 3 item 14)", () => {
  test("Trust renders the full block; the operator page a one-line summary and a link to it", () => {
    const c = read("src/app/burnticker/_components/CurrentStatusSummary.tsx");
    assert.match(c, /if \(compact\) return \([\s\S]*?\{s\.lines\[0\] \?\? s\.host\.line\} <a className="underline" href="\/burnticker\/trust#current-status">The full current status is on the Trust page\.<\/a>/);
    assert.match(c, /id="current-status" data-current-status/);
    assert.equal((read("src/app/burnticker/operator/page.tsx").match(/<CurrentStatusSummary card=\{card\} compact \/>/g) ?? []).length, 1);
    clean("The full current status is on the Trust page.", "link");
  });
});

describe("item 18: copy edits (ChatGPT code review 6)", () => {
  test("the exact sentences, each lint-clean, in place", async () => {
    const { HERO } = await import("@/lib/burnticker/siteNav.mjs");
    const { WALLET_COPY } = await import("@/lib/burnticker/walletShell");
    assert.equal(HERO.sub, "Every burn leaves a receipt.");
    const tag = "Say it like DeFi-cit. Trading fees buy back and burn $DEFICIT when the Treasury reports a qualifying rise in debt.";
    const def = read("site/deficit/index.html");
    assert.ok(def.includes(`<p class="defi" id="defiLine">${tag}</p>`)); assert.doesNotMatch(def, /only income the mechanism has|decentralized finance pointed at/);
    assert.ok(def.includes("Eligible trading fees fund the coin's burn pool."));
    assert.ok(featuredCoins(scratchRoot("planned"), null, [], null, NOW)[0].note!.includes(tag));
    assert.match(read("src/app/burnticker/upcoming/NextResults.tsx"), /Publication times come from the source and may change\./);
    assert.equal(WALLET_COPY.prompt, "View a wallet's created coins without signing a transaction.");
    assert.match(read("src/lib/burnticker/templates.ts"), /cta: "Choose a team"/); // website-20 item 60: the link says where it lands assert.doesNotMatch(read("src/app/burnticker/templates/page.tsx"), /opacity-60/);
    const fs2 = read("src/app/burnticker/_components/FooterSwitch.tsx");
    assert.match(fs2, /<summary>Show the full receipt<\/summary>\{full\}/);
    const { footerVariant } = await import("@/app/burnticker/_components/nav");
    assert.equal(footerVariant("/burnticker/me"), "short"); assert.equal(footerVariant("/burnticker"), "full");
    for (const t of [HERO.sub, tag, WALLET_COPY.prompt, "Choose a league and team on the next screen.", "Publication times come from the source and may change.", "Show the full receipt"]) clean(t, t);
  });
});

describe("item 19: the docs table and code on phones (ChatGPT repair 5)", () => {
  test("a minimum table width, a readable What it does column, and a scroll cue on the table and the code block", () => {
    const d = read("src/app/burnticker/docs/page.tsx"), css = read("config/public-repo/overlay/src/app/globals.css");
    assert.match(d, /<table className="w-full min-w-\[46rem\] text-sm">/); assert.match(d, /<th className="p-2 min-w-\[16rem\]">What it does<\/th>/);
    assert.equal((d.match(/className="bt-hscroll /g) ?? []).length, 2);
    assert.match(css, /\.bt-hscroll \{[\s\S]*?no-repeat local[\s\S]*?no-repeat scroll/);
  });
});

describe("item 7 (phones): the reason opens inside the card", () => {
  test("at 640 px and under the reason is in the flow under the dash, app and static home", () => {
    assert.match(read("config/public-repo/overlay/src/app/globals.css"), /@media \(max-width: 640px\) \{ \.bt-why \{ display: inline; \} \.bt-why-tip \{ position: static;/);
    assert.match(read("site/burnticker/index.html"), /@media \(max-width:640px\)\{\.why\{display:inline\}\.why-tip\{position:static;/);
  });
});
