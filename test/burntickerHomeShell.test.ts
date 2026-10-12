// WEBSITE-10 (2026-10-12): the launchpad skeleton the owner's review asked for, on top of the receipts. One card order everywhere, the
// featured cards read from files (never typed), the activity line with real events only, the closed-launches dialog without a date, the
// copy of every new string lint-clean, and the Caddy change left as a proposal for the owner.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { formatHits, lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import { CARD_LABELS, CARD_MEANINGS, CARD_ROWS, NOT_READ, ageText, cardViewFromIndex, groupDigits, initialsOf, longDay, pctOfSupply, shortDay, type CardView } from "@/lib/burnticker/cardView";
import { activityEvents, featuredCoins, homeData, homeStats, homeStatusLine, memoBurn, NO_EVENTS_LINE, UNAVAILABLE, type HomeCoin } from "@/lib/burnticker/home";
import { checkReceiptHref } from "@/lib/burnticker/coinPage";
import os from "node:os";
import path from "node:path";
import { sampleReceipts } from "@/lib/burnticker/trustpack/samples";
import { DEFICIT_SITE } from "@/lib/burnticker/creatorLaunches";
import { EXPLORE_VERIFIED_BURN } from "@/lib/burnticker/currentStatusLinks";
import { FIRST_USE, FOOTER_COPY, HERO, HOW_IT_WORKS, LAUNCH_CLOSED, SEARCH, WALLET } from "@/lib/burnticker/siteNav.mjs";

const read = (f: string) => fs.readFileSync(f, "utf8");
const cfg = loadCopyLintConfig();
const clean = (t: string, what: string) => { const r = lintCopy(t, cfg); assert.ok(r.ok, `${what}:\n${formatHits(r)}`); };
/** The data-row keys in source order, de-duplicated. */
/** A scratch copy of the files featuredCoins reads, with $DEFICIT marked `status` in own-tokens.json (Codex review 5 F4's reproduction). */
function scratchRoot(status: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bt-home-"));
  for (const rel of ["config/burnticker/current-status.json", "config/burnticker/transparency.json", "config/burnkeeper/deficit.rules.json", "config/burnkeeper/rehearsal.rules.json", "config/burnkeeper/deficit.devnet.rules.json"]) { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.copyFileSync(rel, path.join(root, rel)); }
  const st = JSON.parse(read("config/burnticker/current-status.json")) as { demo: { evidence: string } };
  fs.mkdirSync(path.dirname(path.join(root, st.demo.evidence)), { recursive: true }); fs.copyFileSync(st.demo.evidence, path.join(root, st.demo.evidence));
  const own = JSON.parse(read("config/own-tokens.json")) as { tokens: { symbol: string; status: string }[] };
  own.tokens.find((t) => t.symbol === "DEFICIT")!.status = status;
  fs.mkdirSync(path.join(root, "config"), { recursive: true }); fs.writeFileSync(path.join(root, "config/own-tokens.json"), JSON.stringify(own));
  return root;
}
const rowOrder = (src: string) => [...new Set([...src.matchAll(/data-row(?:=|", )"?([A-Za-z]+)"/g)].map((m) => m[1]))];

describe("one card order (review item 5, brief rule 10; website-13: Claude site audit 2 item 7, ChatGPT audit 6 A10)", () => {
  test("the app's card and the static home's renderer print every row, in CARD_ROWS order, including market cap, holders and age", () => {
    assert.deepEqual([...CARD_ROWS], ["image", "name", "ticker", "badge", "progress", "rule", "nextSettle", "curve", "mcap", "holders", "age", "burned", "receipt"]);
    const card = read("src/app/burnticker/_components/CoinCard.tsx");
    const view = card.slice(card.indexOf("export function ViewCard"), card.indexOf("export function SkeletonCard"));
    assert.deepEqual(rowOrder(view), [...CARD_ROWS]);
    // never hide a row: no row of the card is behind a condition
    assert.doesNotMatch(view, /\{v\.(nextSettle|curve|mcap|holders|burned) &&/);
    const home = read("site/burnticker/index.html");
    const js = home.slice(home.indexOf("THE COIN GRID"), home.indexOf("THE PLATFORM STRIP"));
    assert.deepEqual(rowOrder(js.replace(/row\(dl, "(\w+)"/g, 'data-row="$1"').replace(/setAttribute\("data-row", "(\w+)"\)/g, 'data-row="$1"')), [...CARD_ROWS]);
    for (const [k, l] of Object.entries(CARD_LABELS)) assert.ok(js.includes(`${k}: "${l}"`), `the static page labels ${k} as the app does`);
  });
  test("a registered coin: raised of the raise read from the curve, the market cap read from the curve, a dash with a reason for the rest", () => {
    const base = { ticker: "RAYS", name: "Rays", mint: "M", oneLiner: "burns when the Rays lose", status: "live", imageUrl: null, burned: "1234.5", burns: 2, nextCheckAt: "2026-10-20T00:00:00Z", nextCloseTime: null, lastBurnAt: "2026-10-10T00:00:00Z", launchedAt: "2026-10-01T00:00:00Z", pairId: null, phase: "curve" as const, progressPct: 42, raised: "35.7", threshold: "85", quote: "SOL", pctOfSupply: 0.12, marketCap: "61.25", holders: null };
    const v = cardViewFromIndex(base, "85");
    assert.equal(v.rule, "Burns when the Rays lose"); assert.deepEqual(v.nextSettle, { text: "Oct 20", why: null });
    assert.deepEqual(v.curve, { raised: "35.7", of: "85 SOL", pct: 42, done: false, why: null });
    assert.deepEqual(v.mcap, { text: "61.25 SOL", why: CARD_MEANINGS.mcap });
    assert.deepEqual(v.holders, { text: null, why: NOT_READ.holders }, "no indexer, no number");
    assert.equal(v.burned.text, "1,234.5 $RAYS, 0.12% of supply"); assert.equal(v.group, "public");
    assert.deepEqual(v.receipt, { href: "/burnticker/t/RAYS#receipts" });
    // not read: a dash of the configured raise, never a typed 85 and never an invented zero
    const unread = cardViewFromIndex({ ...base, progressPct: null, raised: null, threshold: null, marketCap: null }, "90");
    assert.deepEqual(unread.curve, { raised: null, of: "90 SOL", pct: null, done: false, why: NOT_READ.curveNotRead });
    assert.deepEqual(unread.mcap, { text: null, why: NOT_READ.mcapNotRead });
    const g = cardViewFromIndex({ ...base, burns: 0, burned: "0", nextCheckAt: null, phase: "graduated", marketCap: null }, "85");
    assert.equal(g.nextSettle.text, null); assert.equal(g.receipt, null); assert.equal(g.receiptWhy, "This coin has no receipt yet.");
    assert.equal(g.curve.done, true); assert.equal(g.mcap.why, NOT_READ.mcapPool); assert.deepEqual(g.tags.map((t) => t.label), ["Trading pool"]);
    assert.equal(groupDigits("4010874.872446"), "4,010,874.87"); assert.equal(shortDay("2026-10-06"), "Oct 6"); assert.equal(longDay("2026-10-11"), "Oct 11, 2026");
    assert.equal(pctOfSupply(0.797), "0.8% of supply"); assert.equal(pctOfSupply(0.004), "under 0.01% of supply"); assert.equal(pctOfSupply(0), "0% of supply");
    assert.equal(ageText("2026-10-10T00:00:00Z", Date.parse("2026-10-12T01:00:00Z")), "2 days"); assert.equal(ageText(null, 0), null);
  });
  test("no NO IMAGE: a coin without an image gets a receipt-style identity with its initials", () => {
    const card = read("src/app/burnticker/_components/CoinCard.tsx"), home = read("site/burnticker/index.html");
    for (const src of [card, home]) assert.doesNotMatch(src.replace(/^\s*(\/\/|\*|\/\*).*$/gm, ""), /NO IMAGE/);
    assert.match(card, /\{initialsOf\(ticker \|\| "TICKER"\)\}/); assert.equal(initialsOf("DEFICIT"), "DE"); assert.equal(initialsOf("$x9"), "X9");
  });
});

describe("the featured cards (review items 12 and 13; Codex review 5 F4)", () => {
  const f = featuredCoins();
  test("fixed order: $DEFICIT featured, $REHEARSAL tagged as the mainnet rehearsal, the devnet coin tagged devnet; all in the test group", () => {
    assert.deepEqual(f.map((c) => [c.id, c.ticker, c.tags[0].tone, c.group]), [["deficit", "DEFICIT", "featured", "test"], ["rehearsal", "REHEARSAL", "rehearsal", "test"], ["deficit-devnet", "DEFICIT", "devnet", "test"]]);
  });
  test("$DEFICIT before the create: rules locked, not created, its reserved mint shown as an address only, no receipt, its own site as the link", () => {
    const own = JSON.parse(read("config/own-tokens.json")) as { tokens: { symbol: string; address: string; status: string }[] };
    const d = own.tokens.find((t) => t.symbol === "DEFICIT")!;
    assert.equal(d.status, "planned");
    assert.match(f[0].note!, /rules are locked, and the coin is not created yet/);
    assert.deepEqual(f[0].mint, { address: "AJJ4XxCUYr8zzMWm8FYg3xh638LYAAApdNqWBqCK4oqj", label: "Reserved mint address (coin not created yet)" });
    assert.equal(f[0].receipt, null); assert.equal(f[0].burned.text, null, "before the create: a dash with a reason, not a claim"); assert.equal(f[0].href, DEFICIT_SITE);
    // website-14 (§75): no curve before the create, so no raise either: never a typed 85
    assert.deepEqual([f[0].curve.raised, f[0].curve.of], [null, null]); assert.doesNotMatch(JSON.stringify(f[0].curve), /85/);
    assert.doesNotMatch(JSON.stringify(f[0]), /solscan|explorer|raydium/i, "no mint link before the coin exists");
  });
  test("F4: after the create, the card merges the registry's state: burns, share of supply, curve, and its newest receipt's own check", () => {
    const root = scratchRoot("launched");
    const live: HomeCoin = { ticker: "DEFICIT", mint: "AJJ4XxCUYr8zzMWm8FYg3xh638LYAAApdNqWBqCK4oqj", burns: 1, burned: "123456.5", pctOfSupply: 0.0123, lastBurnAt: "2026-10-16T21:00:00Z", launchedAt: "2026-10-14T23:00:00Z", phase: "graduated", progressPct: 100, raised: "85", threshold: "85", quote: "SOL", marketCap: null, holders: null, cluster: "mainnet", latestSignature: "5SigOfTheFirstBurn", readOk: true };
    const c = featuredCoins(root, null, [live])[0];
    assert.equal(c.burned.text, "123,456.5 $DEFICIT, 0.01% of supply"); assert.match(c.burned.why!, /1 burn so far/);
    assert.deepEqual(c.receipt, { href: "/burnticker/check?sig=5SigOfTheFirstBurn&cluster=mainnet#verify" });
    assert.equal(c.curve.done, true); assert.equal(c.href, "/burnticker/t/DEFICIT"); assert.equal(c.mint!.label, "Mint address");
    assert.equal(c.createdAt, "2026-10-14T23:00:00Z"); assert.doesNotMatch(JSON.stringify(c), /Nothing burned yet/);
  });
  test("F4: after the create, an unreadable state says Unavailable, never nothing burned", () => {
    const root = scratchRoot("launched");
    for (const [coins, why] of [[null, /could not read the coin registry/], [[], /not registered on this site yet/], [[{ ticker: "DEFICIT", burns: 0, lastBurnAt: null, readOk: false }], /could not read \$DEFICIT's page/]] as const) {
      const c = featuredCoins(root, null, coins as HomeCoin[] | null)[0];
      assert.equal(c.burned.text, UNAVAILABLE); assert.match(c.burned.why!, why); assert.equal(c.receipt, null); assert.equal(c.curve.raised, null);
      assert.doesNotMatch(JSON.stringify(c), /Nothing burned yet|"0 \$DEFICIT/);
    }
  });
  test("$REHEARSAL: the one rehearsal sentence (website-15 item 9); the devnet coin's total and receipt from its confirmed evidence", () => {
    assert.equal(f[1].note, "A test coin the operator made on Oct 11 to check fees and signing. It is listed so you can see it exists, not so you trade it.");
    assert.doesNotMatch(f[1].note!, /not for trading/); assert.equal(f[1].receipt, null); assert.equal(f[1].href, "/burnticker/trust#rehearsals");
    assert.equal(f[1].burned.text, null, "not read here: a dash with the operator's dated record as the reason");
    assert.match(read("src/app/burnticker/trust/page.tsx"), /id="rehearsals">Rehearsal coins</);
    const s = sampleReceipts();
    const confirmed = s.receipts.filter((r) => r.ticker === "DEFICIT" && r.status === "confirmed").sort((a, b) => b.recordDate.localeCompare(a.recordDate));
    const total = confirmed.reduce((a, r) => a + memoBurn(r.memo)!, 0);
    assert.equal(f[2].burned.text, `${groupDigits(total)} $DEFICIT, ${pctOfSupply((total / 1e9) * 100)}`);
    assert.deepEqual(f[2].receipt, { href: checkReceiptHref(confirmed[0].signature, "devnet")! }, "the newest confirmed devnet burn's own receipt");
    assert.notEqual(f[2].receipt!.href, EXPLORE_VERIFIED_BURN.href); assert.match(f[2].note!, /no money value/);
  });
});

describe("the activity line (review item 4, brief rule 3; Codex review 5 F3): real events only, each with its own receipt", () => {
  test("confirmed burns only, mainnet first, the devnet ones marked devnet; skipped rows never appear", () => {
    const s = sampleReceipts();
    const ev = activityEvents([{ ticker: "RAYS", burns: 3, lastBurnAt: "2026-10-11T02:00:00Z", latestSignature: "RaysSig", cluster: "mainnet" }, { ticker: "NONE", burns: 0, lastBurnAt: null }], s, 50);
    assert.equal(ev[0].network, "mainnet"); assert.equal(ev[0].text, "$RAYS burned on Oct 11. It has burned 3 times.");
    assert.equal(ev[0].href, "/burnticker/check?sig=RaysSig&cluster=mainnet#verify");
    assert.ok(!ev.some((e) => /NONE/.test(e.text)));
    const devnet = ev.filter((e) => e.network === "devnet");
    assert.equal(devnet.length, s.receipts.filter((r) => r.status === "confirmed").length, "one line per confirmed receipt, none for skipped rows");
    for (const e of ev) clean(e.text, e.text);
  });
  test("F3: two distinct burns preselect their own signatures and network, never the featured demo receipt", () => {
    const s = sampleReceipts();
    const ev = activityEvents([], s, 50);
    const confirmed = s.receipts.filter((r) => r.status === "confirmed");
    assert.ok(confirmed.length >= 2);
    for (const r of confirmed) assert.ok(ev.some((e) => e.href === `/burnticker/check?sig=${encodeURIComponent(r.signature)}&cluster=devnet#verify`), `${r.ticker} ${r.recordDate} links its own receipt`);
    assert.equal(new Set(ev.map((e) => e.href)).size, ev.length, "no two events share a receipt link");
    assert.ok(!ev.some((e) => e.href === EXPLORE_VERIFIED_BURN.href), "never ?demo=1");
    assert.doesNotMatch(read("src/lib/burnticker/home.ts").replace(/^\s*(\/\/|\*|\/\*).*$/gm, ""), /EXPLORE_VERIFIED_BURN/);
  });
  test("with nothing to show it says so in one line; the components never fall back to sample rows", () => {
    assert.deepEqual(activityEvents([], null), []);
    assert.equal(homeData([], "/nonexistent-root").events.length, 0);
    assert.equal(homeData([], "/nonexistent-root").noEvents, NO_EVENTS_LINE);
    for (const f of ["src/app/burnticker/_components/ActivityTicker.tsx", "src/lib/burnticker/siteNav.mjs"]) {
      const src = read(f), code = src.replace(/^\s*(\/\/|\*|\/\*).*$/gm, "");
      assert.match(src, /noEvents/, `${f} prints the API's one line`); assert.doesNotMatch(code, /sample|mock|placeholder row/i, f);
    }
    const route = read("src/app/api/burnticker/home/route.ts");
    assert.match(route, /homeData\(coins, process\.cwd\(\), now, index, status, siteLaunchState\(process[.]env, now\), keeper, next, rehearsalCurve, p\.cluster\)/);
    assert.match(route, /readOk: false/, "a coin whose page fails is marked unreadable, not dropped");
    assert.match(route, /catch \(e\) \{ console\.error\("\[burnticker\/home\] the coin registry could not be read:", e\); coins = null; registered = null; \}/, "an unreadable registry is null, never an empty list");
  });
});

describe("the platform strip and the one-line status (Claude site audit 2 items 8 and 9)", () => {
  test("numbers from the index and the public audit: 0 is a number; no index is unavailable", () => {
    assert.deepEqual(homeStats({ burns: 0, burnedTokens: "0" }, { ok: true, receipts: 0, mismatches: 0, chainChecked: false }), { burnedTokens: "0", burns: 0, receiptsVerified: 0, receiptsWhy: "The public audit checked the published receipts against their rules. It did not read the chain on this run." });
    assert.equal(homeStats({ burns: 3, burnedTokens: "10" }, { ok: false, receipts: 5, mismatches: 2 })!.receiptsVerified, 3);
    assert.equal(homeStats({ burns: 0, burnedTokens: "0" }, null)!.receiptsVerified, null);
    assert.equal(homeStats(null, null), null);
    const home = read("site/burnticker/index.html");
    assert.ok(home.indexOf("data-stats") < home.indexOf('<h1 id="hero-h">'), "under the activity line, above the hero");
    assert.doesNotMatch(home.slice(home.indexOf("THE PLATFORM STRIP")), /nothing yet/i);
  });
  test("the status line reads the current-status record in sentences: phase, mainnet date, signer count, time lock; the Trust page has the rest", () => {
    const line = homeStatusLine({ phase: { label: "pre-launch (mainnet programs deployed)" }, networks: [{ cluster: "mainnet", deployment: "deployed", since: "2026-10-11" }], attesters: { quorum: 1, active: [{}] }, upgradeAuthority: [{ cluster: "mainnet", timeLockSecs: 0 }] });
    assert.equal(line, "Burnticker is in pre-launch. Its programs have been on mainnet since Oct 11, 2026. One key signs every reading. Upgrades have no time lock yet.");
    assert.equal(homeStatusLine({ upgradeAuthority: [{ cluster: "mainnet", timeLockSecs: 172800 }] }), "Upgrades wait 48 hours under a time lock.");
    assert.equal(homeStatusLine(null), null);
    // the committed file (no chain read): what it says, nothing it does not
    const fromFile = homeData([], process.cwd()).statusLine!;
    // legitimacy pass: the dated counts follow (the reviews published and the releases since Oct 10, read from the files)
    assert.match(fromFile, /^Burnticker is in pre-launch\. Its programs have been on mainnet since Oct 11, 2026\. One key signs every reading\. \d+ reviews are published, and there have been \d+ releases since Oct 10\.$/);
    clean(line!, "status line"); clean(fromFile, "status line from the file");
    const home = read("site/burnticker/index.html");
    assert.match(home, /data-status-line/); assert.doesNotMatch(home, /data-current-status|<h2 id="status-h">Current status/);
  });
});

describe("words (memory: plain English; config/launch/copy-lint.json)", () => {
  test("every new shell string passes the copy lint", () => {
    const all = [HERO.title, HERO.sub, ...HOW_IT_WORKS.flatMap((h) => [h.title, h.text]), ...Object.values(FOOTER_COPY), ...Object.values(LAUNCH_CLOSED), WALLET.label, WALLET.note, WALLET.menuNote, SEARCH.label, NO_EVENTS_LINE, ...FIRST_USE.flatMap((t) => [t.term, t.meaning]), ...Object.values(CARD_MEANINGS), ...Object.values(NOT_READ)];
    const cells = (c: CardView) => [c.nextSettle, c.mcap, c.holders, c.burned].flatMap((x) => [x.text ?? "", x.why ?? ""]).concat([c.curve.why ?? "", c.createdWhy ?? "", c.receiptWhy ?? ""]);
    for (const f of featuredCoins()) all.push(f.name, f.note ?? "", f.rule, ...cells(f), ...f.tags.map((t) => t.label), f.mint?.label ?? "");
    for (const t of all.filter(Boolean)) clean(t, t);
  });
  test("the market cap is a data label with a bare number (owner decision 2026-10-12); prose still never says it", () => {
    // the one label, the one meaning; neither is prose the lint passes, and every other copy surface stays clean of it
    assert.equal(CARD_LABELS.mcap, "Market cap");
    for (const f of ["src/lib/burnticker/siteNav.mjs", "src/app/burnticker/_components/LaunchClosedModal.tsx", "src/app/burnticker/_components/SiteHeader.tsx", "src/app/burnticker/CoinsIndex.tsx"]) assert.doesNotMatch(read(f).replace(/^\s*(\/\/|\*|\/\*).*$/gm, ""), /market cap|mcap|fdv/i, f);
    const home = read("site/burnticker/index.html").replace(/<!--[\s\S]*?-->/g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.deepEqual([...home.matchAll(/market cap/gi)].length, 1, "the static page names it once, as the row label");
    assert.ok(Object.values(CARD_MEANINGS).every((m) => !/\b(up|down|rise|fall|gain|loss|cheap|forecast)\b/i.test(m)), "no commentary");
  });
  test("brief rule 1: no date, countdown, waitlist or email field in the shell; brief rule 8: no price, no Kalshi", () => {
    for (const f of ["src/lib/burnticker/siteNav.mjs", "src/app/burnticker/_components/LaunchClosedModal.tsx", "src/app/burnticker/_components/SiteHeader.tsx", "src/app/burnticker/CoinsIndex.tsx", "site/burnticker/index.html"]) {
      const code = read(f).replace(/^\s*(\/\/|\*|\/\*).*$/gm, "").replace(/<!--[\s\S]*?-->/g, "");
      assert.doesNotMatch(code, /type="email"|waitlist|countdown|coming soon/i, f);
      assert.doesNotMatch(code, /kalshi|\bfdv\b/i, f);
    }
  });
});

describe("the Caddy change is a proposal (brief rule 7)", () => {
  test("deploy/caddy/home-to-app.proposed.caddy proxies `/` to the app's home with the static page as the fallback; the live Caddyfile is untouched", () => {
    const p = read("deploy/caddy/home-to-app.proposed.caddy");
    assert.match(p, /^# PROPOSED — NOT IMPORTED BY deploy\/caddy\/Caddyfile/);
    assert.match(p, /@home path \/ \/index\.html\nhandle @home \{[\s\S]*rewrite \* \/burnticker[\s\S]*reverse_proxy \{\$MCT_APP_UPSTREAM:127\.0\.0\.1:3000\}/);
    assert.match(p, /handle_response @upstream_5xx \{[\s\S]*rewrite \* \/index\.html/);
    assert.doesNotMatch(p.replace(/^\s*#.*$/gm, ""), /header_up Host/);
    assert.doesNotMatch(read("deploy/caddy/Caddyfile"), /@home|home-to-app/);
  });
});

describe("shell items from the website-11 merge (coordinator, 2026-10-12)", () => {
  test("the venue chip never names Kalshi; a pair page lights Coins; every /burnticker route gets a footer with the not-advice and operator lines", async () => {
    const card = read("src/app/burnticker/_components/CoinCard.tsx");
    assert.match(card, /kalshi: "Prediction market"/); assert.doesNotMatch(card.replace(/^\s*(\/\/|\*|\/\*).*$/gm, ""), /"Kalshi"/);
    const { activeNav, footerVariant } = await import("@/app/burnticker/_components/nav");
    assert.equal(activeNav("/burnticker/p/den-kc"), "/burnticker"); assert.equal(activeNav("/burnticker/t/DEFICIT"), "/burnticker");
    for (const p of ["/burnticker/t/DEFICIT", "/burnticker/p/x"]) assert.equal(footerVariant(p), "full", p);
    const footer = read("src/app/burnticker/_components/SiteFooter.tsx");
    for (const fn of ["export function SiteFooter()", "export function CompactFooter()"]) {
      const body = footer.slice(footer.indexOf(fn), footer.indexOf("\n}\n", footer.indexOf(fn)));
      assert.match(body, /\{OPERATOR_LINE\}/, fn); assert.match(body, /NOT ADVICE|Not advice\./, fn);
    }
    assert.match(read("config/public-repo/overlay/src/app/layout.tsx"), /<FooterSwitch full=\{<SiteFooter \/>\} compact=\{<CompactFooter \/>\} \/>/);
    const css = read("config/public-repo/overlay/src/app/globals.css");
    for (const c of [".bt-tabs", ".bt-tab ", ".bt-launch-btn", ".bt-curve", ".bt-tape"]) assert.ok(css.includes(c), c);
  });
});
