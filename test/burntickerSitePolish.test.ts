// SITE POLISH (ChatGPT audit 6 items 21 to 25, 2026-10-12): the site-wide P3 items. The header and tab bar are opaque and the page ends
// above the bar; the home counts its featured cards from data and never says "no coin" under listed coins; the step lines show in full;
// empty card fields say what they mean; one age function; one $DEFICIT image; "Next: graduation"; a curve market cap says it is
// curve-implied; sideways rows fade the edge with more; the host notes become visitor sentences. Every new sentence passes the copy lint.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { formatHits, lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import { cardAge } from "@/lib/burnticker/cardAge.mjs";
import { EMPTY_LABEL, ageText, cardViewFromIndex, emptyLabel, emptyLabels, featuredLine, mcapText, type CardView } from "@/lib/burnticker/cardView";
import { homeData } from "@/lib/burnticker/home";
import { UPCOMING_EMPTY, UPCOMING_NONE_REGISTERED_LISTED, upcomingNotice, upcomingSet } from "@/lib/burnticker/upcoming";
import { PROGRESS_NEXT, PROGRESS_STEPS, progressNow } from "@/lib/burnticker/progress";
import { hostGaps } from "@/lib/burnticker/hostGaps";
import { DOC_PAGES } from "@/lib/burnticker/sitemap";
import { WATCH_FORGET, WATCH_NOTE, coinWatchKey, dropLegacy, parseWatchlist, resolveLegacy, toggleWatch, watchAmbiguous } from "@/lib/burnticker/watchlist";
import { cardAgeScript } from "../scripts/burnticker-site-nav.mts";
import { APP_CSP_DIRECTIVES, CSP_REPORT_PATH, appCsp, cspHeaderRules, reportDirective } from "@/lib/burnticker/csp";

describe("audit 7 item 4: a report-only Content-Security-Policy on the app's HTML", () => {
  test("the header is sent on / and /burnticker/launch, never on the embeds, with the required directives", async () => {
    // the public tree's next.config.ts returns exactly these rules (the config file itself is loaded by Next, not by this test runner)
    const conf = read("config/public-repo/overlay/next.config.ts");
    assert.ok(conf.includes("cspHeaderRules } from \"@/lib/burnticker/csp\";")); assert.match(conf, /async headers\(\) \{\n    return cspHeaderRules\(/);
    const rules = cspHeaderRules(null);
    const toRe = (s: string) => new RegExp(`^${s.replace(/:path\((.*)\)$/, "($1)")}$`);
    const sent = (p: string) => rules.filter((r) => toRe(r.source).test(p)).flatMap((r) => r.headers);
    for (const p of ["/", "/burnticker/launch", "/burnticker", "/burnticker/t/DEFICIT"]) {
      const h = sent(p).find((x) => x.key === "Content-Security-Policy-Report-Only"); assert.ok(h, p);
      for (const d of ["default-src 'self'", "frame-ancestors 'none'", "img-src 'self' data: blob: https:", "style-src 'self' 'unsafe-inline'", `report-uri ${CSP_REPORT_PATH}`, "report-to csp"]) assert.ok(h!.value.includes(d), `${p}: ${d}`);
      assert.match(h!.value, /script-src 'self' 'unsafe-inline' https:\/\/static\.cloudflareinsights\.com/); assert.match(h!.value, /connect-src 'self' [^;]*https:\/\/api\.mainnet-beta\.solana\.com[^;]*https:\/\/cloudflareinsights\.com/);
    }
    for (const p of ["/burnticker/embed/DEFICIT", "/burnticker/embed"]) assert.equal(sent(p).length, 0, p);
    assert.doesNotMatch(appCsp(), /fonts\.googleapis/, "no Google Fonts: the app self-hosts its two families");
    assert.ok(appCsp("https://rpc.example.org").includes("https://rpc.example.org")); assert.ok(!appCsp("javascript:alert(1)").includes("javascript"));
    assert.ok(APP_CSP_DIRECTIVES.length >= 12);
  });
  test("the report endpoint counts by directive and keeps nothing else", async () => {
    assert.equal(reportDirective({ "csp-report": { "effective-directive": "script-src-elem", "blocked-uri": "https://evil.example/x.js", "document-uri": "https://burnticker.com/" } }), "script-src-elem");
    assert.equal(reportDirective([{ type: "csp-violation", body: { effectiveDirective: "connect-src", blockedURL: "https://x" } }]), "connect-src");
    assert.equal(reportDirective("nonsense"), "unknown");
    const { POST } = await import("../src/app/api/burnticker/csp-report/route.ts");
    const r = await POST(new Request("http://x/api/burnticker/csp-report", { method: "POST", body: JSON.stringify({ "csp-report": { "effective-directive": "img-src" } }) }));
    assert.equal(r.status, 200); assert.deepEqual(await r.json(), { counted: "img-src" });
    const big = await POST(new Request("http://x/api/burnticker/csp-report", { method: "POST", body: "x".repeat(20_000) }));
    assert.equal(big.status, 413);
    const route = read("src/app/api/burnticker/csp-report/route.ts").replace(/^\/\/.*$/gm, "");
    assert.doesNotMatch(route, /blocked|document-uri|x-forwarded-for|remoteAddress/i, "no URL or address is read into storage or logs");
    assert.ok(fs.existsSync(path.join(ROOT, "docs/burnticker/CSP.md")));
  });
});

const ROOT = path.join(import.meta.dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const cfg = loadCopyLintConfig();
const clean = (t: string, what: string) => { const r = lintCopy(t, cfg); assert.ok(r.ok, `${what}:\n${formatHits(r)}`); assert.doesNotMatch(t, /\bwill\b/i, what); };
const NOW = Date.parse("2026-10-13T00:40:00Z");

describe("item 21: an opaque header and tab bar, and the page ends above the bar", () => {
  test("app and static shell: no see-through background, padding = bar + safe area", () => {
    const css = read("config/public-repo/overlay/src/app/globals.css"), nav = read("src/lib/burnticker/siteNav.mjs"), home = read("site/burnticker/index.html");
    const rule = (src: string, sel: RegExp) => (sel.exec(src) ?? [""])[0];
    for (const [src, header, bar] of [[css, /\.bt-header \{[^}]*\}/, /\.bt-tabbar \{ display: grid[^}]*\}/], [nav, /\.sh-header\{[^}]*\}/, /\.sh-tabbar\{display:grid[^}]*\}/], [home, /\.sh-header\{[^}]*\}/, /\.sh-tabbar\{display:grid[^}]*\}/]] as const) {
      for (const r of [rule(src, header), rule(src, bar)]) { assert.ok(r, String(header)); assert.doesNotMatch(r, /color-mix\([^)]*transparent\)|rgba\(/, r); assert.match(r, /background: ?var\(--(bt|sh)-bg\)/, r); }
    }
    assert.match(css, /body\.bt-body \{ padding-bottom: calc\(var\(--bt-tabbar-h\) \+ env\(safe-area-inset-bottom\) \+ 12px\); \}/);
    assert.match(css, /--bt-tabbar-h: 62px;/);
    assert.match(nav, /body\{padding-bottom:calc\(62px \+ env\(safe-area-inset-bottom\) \+ 12px\)\}/);
    assert.match(css, /\.bt-tabbar-item \{[^}]*font: 700 12px/); assert.match(nav, /\.sh-tabbar a\{[^}]*font:700 12px/);
  });
});

describe("item 22: the home counts from data and never says no coin under listed coins", () => {
  const tag = (label: string, tone: CardView["tags"][number]["tone"]) => ({ label, tone });
  test("featuredLine counts the cards served", () => {
    const deficit = { id: "deficit", tags: [tag("Featured", "featured")] }, rehearsal = { id: "rehearsal", tags: [tag("Mainnet rehearsal", "rehearsal")] }, devnet = { id: "deficit-devnet", tags: [tag("Devnet", "devnet")] };
    assert.equal(featuredLine([deficit, rehearsal]), "These are $DEFICIT, the operator's first coin, and one disclosed test coin.");
    assert.equal(featuredLine([deficit, rehearsal, devnet]), "These are $DEFICIT, the operator's first coin, and two disclosed test coins. The devnet card is a practice run on a test network where tokens have no money value.");
    assert.equal(featuredLine([deficit]), "This is $DEFICIT, the operator's first coin.");
    assert.equal(featuredLine([]), null);
    for (const t of [featuredLine([deficit, rehearsal]), featuredLine([deficit, rehearsal, devnet]), featuredLine([deficit])]) clean(t!, "featuredLine");
  });
  test("homeData: the sentence and the next-results notice follow the host's own cards (mainnet hides the devnet card)", () => {
    const main = homeData([], ROOT, NOW, null, null, null, null, null, null, "mainnet");
    assert.equal(main.featured.length, main.featured.filter((v) => !v.tags.some((t) => t.tone === "devnet")).length);
    const tests = main.featured.filter((v) => v.id !== "deficit").length;
    assert.match(main.featuredLine!, new RegExp(`and ${["no", "one", "two", "three"][tests]} disclosed test coin`));
    assert.equal(main.nextNotice, UPCOMING_NONE_REGISTERED_LISTED, "coins are listed, so never the empty-page sentence");
    for (const v of main.featured) assert.ok(v.empty && v.empty.mcap, v.id);
  });
  test("upcomingNotice: the empty sentence only when the page lists nothing", () => {
    const empty = upcomingSet([], [], 0);
    assert.equal(upcomingNotice(empty), UPCOMING_EMPTY); assert.equal(upcomingNotice(empty, 0), UPCOMING_EMPTY);
    assert.equal(upcomingNotice(empty, 2), UPCOMING_NONE_REGISTERED_LISTED);
    assert.doesNotMatch(UPCOMING_NONE_REGISTERED_LISTED, /^No coin is registered/); clean(UPCOMING_NONE_REGISTERED_LISTED, "listed notice");
  });
  test("the static home prints the API's sentences, the whole step line and room before the featured cards", () => {
    const h = read("site/burnticker/index.html");
    assert.doesNotMatch(h, /two disclosed test coins/); assert.match(h, /<p class="small muted" data-featured-line><\/p>/); assert.match(h, /j\.featuredLine/);
    assert.match(h, /"nextNotice" in j \? j\.nextNotice/);
    const line = /\.how-line\{[^}]*\}/g; const rules = h.match(line) ?? [];
    assert.ok(rules.length >= 2); for (const r of rules) assert.doesNotMatch(r, /line-clamp|text-overflow|overflow:hidden/, r);
    assert.match(h, /\.how-wrap\+section\{margin-top:18px\}/);
    assert.match(read("src/app/burnticker/CoinsIndex.tsx"), /featuredLine\(home\.data\.featured\)/);
  });
});

describe("item 23: card fields", () => {
  test("one age function: exact times count elapsed time; a day-only record counts calendar days in the viewer's zone", () => {
    assert.equal(cardAge("2026-10-10T00:00:00Z", Date.parse("2026-10-12T01:00:00Z")), "2 days");
    assert.equal(cardAge("2026-10-12T00:30:00Z", Date.parse("2026-10-12T01:00:00Z")), "under an hour");
    assert.equal(cardAge("2026-10-12T00:00:00Z", Date.parse("2026-10-12T05:10:00Z")), "5 hours");
    const local = (y: number, m: number, d: number, h: number) => new Date(y, m - 1, d, h).getTime();
    assert.equal(cardAge("2026-10-11", local(2026, 10, 12, 23)), "1 day"); assert.equal(cardAge("2026-10-11", local(2026, 10, 13, 0)), "2 days");
    assert.equal(cardAge("2026-10-11", local(2026, 10, 11, 20)), "under a day");
    assert.equal(cardAge(null, NOW), null); assert.equal(cardAge("not a date", NOW), null);
    assert.equal(ageText("2026-10-11", NOW), cardAge("2026-10-11", NOW), "the app's ageText is the same function");
    // the static home runs the same source, written in by the site-nav script
    const h = read("site/burnticker/index.html");
    assert.ok(h.includes(cardAgeScript()), "the age-core region is current"); assert.match(h, /window\.btCardAge\(iso, Date\.now\(\)\)/);
    assert.doesNotMatch(h, /T00:00:00Z/, "no second age formula on the static page");
  });
  test("empty fields say what they mean, and the reason control stays", () => {
    const notCreated = { tags: [{ label: "Not created yet", tone: "neutral" as const }] }, live = { tags: [] };
    assert.equal(emptyLabel(notCreated, "The coin is not created yet."), EMPTY_LABEL.notCreated);
    assert.equal(emptyLabel(live, "This site has not read the coin's curve."), EMPTY_LABEL.noData);
    assert.equal(emptyLabel(live, "Devnet tokens have no money value, so this number does not apply."), EMPTY_LABEL.notApplicable);
    assert.equal(emptyLabel(live, "This rule has no scheduled result."), EMPTY_LABEL.noneScheduled);
    const v = cardViewFromIndex({ ticker: "RAYS", name: "Rays", mint: "M1", oneLiner: "burns when the Rays lose", status: "live", imageUrl: null, burned: "0", burns: 0, nextCheckAt: null, nextCloseTime: null, lastBurnAt: null, launchedAt: null, pairId: null, phase: null, progressPct: null }, null);
    assert.deepEqual(Object.values(emptyLabels(v)).filter((x) => x === "—"), []);
    const card = read("src/app/burnticker/_components/CoinCard.tsx");
    assert.match(card, /<Why label=\{emptyLabel\(v, c\.why\)\}/); assert.doesNotMatch(card, /<Why why=\{v\.curve\.why\} name="Not read" \/>/);
    const h = read("site/burnticker/index.html");
    assert.match(h, /window\.btWhy\(label \|\| "No data yet"/); assert.doesNotMatch(h, /btWhy\("\\u2014", v\.curve\.why/);
    for (const t of Object.values(EMPTY_LABEL)) clean(t, "empty label");
  });
  test("a curve market cap is labelled curve-implied; a pool market cap is not", () => {
    assert.equal(mcapText("28", "SOL", "curve"), "28 SOL (curve-implied)");
    assert.equal(mcapText("28", null, null), "28 SOL (curve-implied)");
    assert.equal(mcapText("1234.5", "SOL", "graduated"), "1,234.5 SOL");
    const v = cardViewFromIndex({ ticker: "RAYS", name: "Rays", mint: "M1", oneLiner: "x y z", status: "live", imageUrl: null, burned: "0", burns: 0, nextCheckAt: null, nextCloseTime: null, lastBurnAt: null, launchedAt: "2026-10-11T00:00:00Z", pairId: null, phase: "curve", progressPct: 1, raised: "0.1", threshold: "85", quote: "SOL", marketCap: "28" }, null);
    assert.equal(v.mcap.text, "28 SOL (curve-implied)");
  });
  test("audit 7 item 23: $REHEARSAL's age counts from its create transaction's block time; the next step is an outline, not a lit dot", () => {
    const rh = homeData([], ROOT, NOW, null, null, null, null, null, null, "mainnet").featured.find((v) => v.id === "rehearsal")!;
    assert.equal(rh.createdAt, "2026-10-11T23:04:58Z");
    assert.equal(ageText(rh.createdAt, Date.parse("2026-10-13T00:40:00Z")), "1 day"); assert.equal(ageText(rh.createdAt, Date.parse("2026-10-12T22:00:00Z")), "22 hours");
    // measured on chain (pool AAT9VJ…RgG): status byte 0, 0.099 of 85 SOL, so 2 of 6 steps; the "current" dot must not look filled
    assert.match(read("config/public-repo/overlay/src/app/globals.css"), /\.bt-progress-step\.is-current \.bt-progress-dot \{ background: transparent; box-shadow: inset 0 0 0 2px var\(--bt-scorch\); \}/);
    assert.match(read("site/burnticker/index.html"), /\.prog li\.current\{background:transparent;box-shadow:inset 0 0 0 2px #c8873a\}/);
  });
  test("the progress heading names the next event as a noun", () => {
    assert.equal(progressNow(2), "Next: graduation"); assert.equal(progressNow(3), "Next: pool registration"); assert.equal(progressNow(1), "Next: trading on the curve");
    for (const s of PROGRESS_STEPS) assert.ok(PROGRESS_NEXT[s], s);
    assert.doesNotMatch(read("site/burnticker/index.html"), /Next: graduated/);
  });
  test("one $DEFICIT image: the app shows a same-origin brand image instead of generated initials", () => {
    const card = read("src/app/burnticker/_components/CoinCard.tsx");
    assert.match(card, /\/\^\\\/burnticker\\\/\(img\|brand\)\\\/\[\\w\.-\]\+\$\/\.test\(src\) \? src/);
  });
});

describe("item 24: sideways rows say there is more", () => {
  test("the Coins filters and the activity line use the scroll hint; the static ticker toggles both edges", () => {
    assert.match(read("src/app/burnticker/CoinsIndex.tsx"), /className=\{`bt-tabs \$\{tabsHint\.className\}`\}/);
    assert.match(read("src/app/burnticker/_components/ActivityTicker.tsx"), /useScrollEdges/);
    const css = read("config/public-repo/overlay/src/app/globals.css");
    for (const c of ["more-end", "more-start", "more-start.more-end"]) assert.match(css, new RegExp(`\\.bt-scroll-hint\\.${c.replace(".", "\\.")} \\{ -webkit-mask-image`));
    assert.match(read("src/lib/burnticker/siteNav.mjs"), /classList\.toggle\("more-start"/);
  });
});

describe("audit 7 item 18: no sideways page scroll from 401 to 479 px", () => {
  test("the wordmark hides until the header tools fit beside it (measured: the row overflowed by 3 to 44 px at 414, 430 and 454)", () => {
    assert.match(read("config/public-repo/overlay/src/app/globals.css"), /@media \(max-width: 479px\) \{ \.bt-wordmark \{ display: none; \} \}/);
    assert.match(read("src/lib/burnticker/siteNav.mjs"), /@media \(max-width:479px\)\{\.sh-word\{display:none\}\}/);
    assert.match(read("site/burnticker/index.html"), /@media \(max-width:479px\)\{\.sh-word\{display:none\}\}/);
  });
});

describe("audit 7 item 21: help controls are 44 px hit areas with a visible focus ring", () => {
  test("the field help button keeps its focus ring and a 12 px glyph; the reason controls get the invisible hit layer", () => {
    const fh = read("src/app/burnticker/_components/FieldHelp.tsx");
    assert.doesNotMatch(fh, /outline-none/); assert.match(fh, /className="bt-hit inline-flex h-5 w-5 [^"]*text-\[12px\]/);
    assert.match(read("config/public-repo/overlay/src/app/globals.css"), /\.bt-hit::after, \.bt-why-btn::after \{ content: ""; position: absolute; [^}]*width: max\(100%, 44px\); height: max\(100%, 44px\)/);
    assert.match(read("site/burnticker/index.html"), /\.why-btn::after\{content:"";position:absolute;[^}]*width:max\(100%,44px\);height:max\(100%,44px\)/);
  });
});

describe("item 25: the host notes become visitor sentences", () => {
  test("a fully wired host has no gap; each missing piece says what it means; the raw notes stay on Trust only", () => {
    const wired = ["burn_receipts program Abc: read-only client (this host holds no key; the keeper signs readings and cranks)", "LaunchLab platform Xyz: the real client reads its settings over this host's RPC on every launch and builds the creator's unsigned create"];
    assert.deepEqual(hostGaps(wired), []);
    const bare = ["burn_receipts program: no program id wired on this host (FakeBurnProgram — PDAs are placeholders, nothing is sent); program deployment is on the trust page", "LaunchLab platform config: not named on this host (BURNTICKER_PLATFORM_ID), so the practice client builds placeholder instructions", "LaunchLab curve progress and top holders: no BURNTICKER_RPC_URL on this host (cards show —)", "Polymarket discovery: off on this host (BURNTICKER_POLYMARKET_DISCOVERY_ENABLED=0); settlement reads the on-chain payout regardless", "launch confirmation: no BURNTICKER_RPC_URL on this host, so a launch transaction cannot be read and drafts are not taken live", "mainnet launches: refused on this host (BURNTICKER_ALLOW_MAINNET_LAUNCHES is not set)"];
    const g = hostGaps(bare);
    assert.deepEqual(g.map((x) => x.id), ["curve", "program", "confirm", "mainnet-launch", "polymarket", "launchlab"]);
    for (const x of g) { clean(x.text, x.id); assert.doesNotMatch(x.text, /BURNTICKER_|Fake|stub|host/, x.id); }
    const c = read("src/app/burnticker/_components/HostDiagnostics.tsx");
    assert.doesNotMatch(c, /Some live data is not connected/); assert.match(c, /operator && stubs\.length > 0/);
    assert.match(read("src/app/burnticker/trust/page.tsx"), /<HostDiagnostics stubs=\{t\.stubs\} cluster=\{t\.cluster\} operator \/>/);
    for (const f of ["src/app/burnticker/CoinsIndex.tsx", "src/app/burnticker/t/[ticker]/page.tsx", "src/app/burnticker/p/[pairId]/page.tsx"]) assert.doesNotMatch(read(f), /operator \/>/, f);
  });
});

describe("WIRING-SEMANTICS-2 item 162: the trust page shows the cap in force", () => {
  test("the page prints capSentence(effectiveCap) and the trust schema lists the field", () => {
    const p = read("src/app/burnticker/trust/page.tsx");
    assert.match(p, /<section className=\{card\} data-effective-cap><h2 className="font-medium">The burn-pool cap in force<\/h2><p className="text-xs">\{capSentence\(t\.effectiveCap \?\? null\)\}<\/p>/);
    assert.match(read("src/lib/burnticker/api/spec.ts"), /effectiveCap: \{ description: "The burn-pool cap the program applies today/);
    assert.match(read("src/lib/burnticker/trust.ts"), /effectiveCap: EffectiveCap \| null;/);
  });
});

describe("private review 8 F1: follows are keyed by network and mint, never by ticker", () => {
  const A = "LADaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".slice(0, 44), B = "LADbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb".slice(0, 44), C = "LADcccccccccccccccccccccccccccccccccccccccccc".slice(0, 44);
  const none = () => parseWatchlist(null);
  test("two coins on one ticker are followed separately, and the case of the mint is kept", () => {
    const ka = coinWatchKey("mainnet", A)!, kb = coinWatchKey("mainnet", B)!;
    assert.equal(ka, `mainnet:${A}`); assert.notEqual(ka, kb);
    const w = toggleWatch(none(), "coins", ka);
    assert.deepEqual(w.coins, [ka]); assert.ok(!w.coins.includes(kb), "following one LAD does not follow the other");
    assert.deepEqual(toggleWatch(toggleWatch(w, "coins", kb), "coins", ka).coins, [kb], "unfollowing one leaves the other");
    assert.equal(coinWatchKey("mainnet", "not a mint"), null); assert.deepEqual(toggleWatch(w, "coins", "LAD").coins, [ka], "a ticker is never a follow");
  });
  test("follows survive a reload (round trip through storage text) and stay apart across networks", () => {
    const km = coinWatchKey("mainnet", A)!, kd = coinWatchKey("devnet", A)!;
    assert.notEqual(km, kd);
    const w = toggleWatch(toggleWatch(none(), "coins", km), "results", kd);
    const back = parseWatchlist(JSON.stringify(w));
    assert.deepEqual(back, w); assert.ok(!back.coins.includes(kd));
  });
  test("a later coin launched on the same ticker does not join an existing follow", () => {
    const w = toggleWatch(none(), "coins", coinWatchKey("mainnet", A)!);
    const later = resolveLegacy(w, [{ ticker: "LAD", network: "mainnet", mint: A }, { ticker: "LAD", network: "mainnet", mint: C }]);
    assert.deepEqual(later.list.coins, [`mainnet:${A}`]); assert.equal(later.changed, false);
    const cards = [{ t: "LAD", m: C }].map((x) => cardViewFromIndex({ ticker: x.t, name: "Dodgers", mint: x.m, oneLiner: "x y z", status: "live", imageUrl: null, burned: "0", burns: 0, nextCheckAt: null, nextCloseTime: null, lastBurnAt: null, launchedAt: null, pairId: null, phase: null, progressPct: null }, null));
    assert.ok(!later.list.coins.includes(cards[0].watchKey!));
  });
  test("an old ticker follow resolves only when exactly one listed coin matches; an ambiguous one is kept for the visitor", () => {
    const old = parseWatchlist(JSON.stringify({ coins: ["LAD", "RAYS"], results: ["NOPE"] }));
    assert.deepEqual(old.legacy, { coins: ["LAD", "RAYS"], results: ["NOPE"] });
    const r = resolveLegacy(old, [{ ticker: "RAYS", network: "mainnet", mint: B }, { ticker: "LAD", network: "mainnet", mint: A }, { ticker: "LAD", network: "mainnet", mint: C }]);
    assert.ok(r.changed); assert.deepEqual(r.list.coins, [`mainnet:${B}`], "RAYS has one coin, so it resolves");
    assert.deepEqual(r.list.legacy, { coins: ["LAD"], results: ["NOPE"] }, "LAD matches two coins and NOPE none: both kept, never guessed");
    assert.deepEqual(r.ambiguous, [{ kind: "coins", ticker: "LAD", candidates: [`mainnet:${A}`, `mainnet:${C}`] }]);
    assert.deepEqual(dropLegacy(r.list, "coins", "lad").legacy.coins, []);
    for (const t of [watchAmbiguous("LAD", 2), WATCH_FORGET, WATCH_NOTE]) clean(t, t);
    assert.equal(WATCH_NOTE, "Your followed coins are saved only in this browser. No wallet or account is needed.");
  });
  test("every surface passes the key: the card, the next results, the coins grid and the static home", () => {
    assert.match(read("src/app/burnticker/_components/CoinCard.tsx"), /<FollowButton watchKey=\{v\.watchKey\} ticker=\{v\.ticker\} \/>/);
    assert.match(read("src/app/burnticker/upcoming/NextResults.tsx"), /<FollowButton watchKey=\{keyOf\(r\)!\}/);
    assert.match(read("src/app/burnticker/CoinsIndex.tsx"), /coinWatchKey\(ix\?\.cluster, t\.mint\)/); assert.match(read("src/app/burnticker/CoinsIndex.tsx"), /watchAmbiguous\(a\.ticker/);
    assert.doesNotMatch(read("src/lib/burnticker/coinsGrid.ts"), /followed\.includes\(t\.ticker/);
    const h = read("site/burnticker/index.html");
    assert.match(h, /followButton\(v\.watchKey, v\.ticker\)/); assert.doesNotMatch(h, /String\(t\)\.toUpperCase\(\), i = w\[kind\]/); assert.match(h, /function rowKey\(u\)/);
    const home = homeData([], ROOT, NOW, null, null, null, null, null, null, "mainnet");
    const d = home.featured.find((v) => v.id === "deficit")!; assert.match(d.watchKey ?? "", /^mainnet:[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  });
});

describe("private review 8 editorial items", () => {
  test("ledger, changelog, check intro, lookalike wording, network-scoped totals note, $DEFICIT short first line, header spacing", () => {
    const copy = read("src/lib/burnticker/trustpack/copy.ts");
    assert.match(copy, /placeholder: "not supplied"/); assert.doesNotMatch(read("src/app/burnticker/fees/ledger/page.tsx"), /e\.todo/);
    assert.match(read("src/lib/burnticker/historyCopy.ts"), /This page reads the published changelog file\."/); assert.doesNotMatch(read("src/lib/burnticker/historyCopy.ts"), /so the two cannot disagree/);
    assert.match(copy, /intro: "Check the money flows, operator powers and a real burn receipt against the source records\./);
    assert.match(read("src/app/burnticker/not-burnticker/page.tsx"), /`Uses the same ticker as \$\{m\[2\]\}\.`/);
    assert.match(read("site/burnticker/index.html"), /"These figures count burns on mainnet, and none has happened yet\."/);
    const d = read("site/deficit/index.html");
    assert.match(d, /<p class="rd" id="readyDetail">Burns can begin only after the coin graduates, its pool is registered, and the Treasury reports a qualifying rise in debt\.<\/p>/);
    assert.match(d, /<details class="rd-more"><summary>How the first burn happens<\/summary>/);
    assert.match(read("src/lib/burnticker/siteNav.mjs"), /\.sh-nav\{display:none;align-items:center;gap:6px;margin-left:12px\}/);
  });
});

describe("audit 7 item 27: metadata, sitemap and robots", () => {
  test("ledger and verify have their own titles and canonicals; five pages gained a canonical; the sitemap lists pages only; robots.txt has no internal note", () => {
    assert.match(read("src/app/burnticker/fees/ledger/layout.tsx"), /title: "Fee ledger", description: DESCRIPTION, alternates: \{ canonical: "\/burnticker\/fees\/ledger" \}/);
    assert.match(read("src/app/burnticker/verify/layout.tsx"), /title: "Verify a mint", description: DESCRIPTION, alternates: \{ canonical: "\/burnticker\/verify" \}/);
    for (const [f, p] of [["rivalries", "/burnticker/rivalries"], ["docs", "/burnticker/docs"], ["derby", "/burnticker/derby"], ["templates", "/burnticker/templates"]]) assert.ok(read(`src/app/burnticker/${f}/page.tsx`).includes(`alternates: { canonical: "${p}" }`), f);
    assert.deepEqual(DOC_PAGES, ["/burnticker/docs", "/whitepaper.html", "/burnticker/templates"]);
    assert.equal(read("site/burnticker/robots.txt"), "User-agent: *\nAllow: /\n\nSitemap: https://burnticker.com/sitemap.xml\n");
  });
});
