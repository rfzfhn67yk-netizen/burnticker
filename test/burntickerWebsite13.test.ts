// WEBSITE-13 (2026-10-12): the three-audit pass on the shell, home, cards, coin pages and the $DEFICIT site (launch folder
// WEBSITE-12-13-BRIEF.md, "website-13 scope"). The evidence defects (Codex F3/F4) and the card rows are pinned in
// test/burntickerHomeShell.test.ts; this file pins the grid's states (ChatGPT audit 6 A5), the site-wide wallet (owner decision on Claude
// site audit 2 item 6, and the owner's "make sure we can connect wallets"), and the $DEFICIT site's facts (A7).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { formatHits, lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import { GRID_TABS, STALE_AFTER_MS, curveCoverage, gridState, tabCoins } from "@/lib/burnticker/coinsGrid";
import { ME_HREF, STATIC_CONNECT_HREF, WALLET_COPY, isAddress, meState, meWallet, shortAddress, walletEndpoint, wantsConnect } from "@/lib/burnticker/walletShell";
import { WALLET } from "@/lib/burnticker/siteNav.mjs";
import { parseRules, usdToCents } from "@/lib/burnKeeper/rules";
import { advance, planReading, type LastReading } from "@/lib/burnKeeper/plan";
import { parseBuybackMemo } from "@/lib/burnReceipts/memo";
import { curveProgressSentence, dataStateSentence } from "@/lib/burnticker/readiness";
import { SITE_SENTENCE, WALLET_NOTE, siteLaunchState, siteLaunchStateFromCatalogue } from "@/lib/burnticker/launchAvailability";
import { LAUNCH_CLOSED } from "@/lib/burnticker/siteNav.mjs";
import { prerequisiteLineFor } from "@/lib/burnticker/launchReview";
import { metaDescription } from "@/lib/burnticker/siteMeta";
import { homeData } from "@/lib/burnticker/home";

const read = (f: string) => fs.readFileSync(f, "utf8");
const cfg = loadCopyLintConfig();
const clean = (t: string, what: string) => { const r = lintCopy(t, cfg); assert.ok(r.ok, `${what}:\n${formatHits(r)}`); };
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[\s;{}])\/\/.*$/gm, "$1").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

const coin = (o: Partial<{ ticker: string; phase: "curve" | "migrating" | "graduated" | null; progressPct: number | null; nextCheckAt: string | null; nextCloseTime: string | null; launchedAt: string | null; status: string }>) =>
  ({ ticker: "X", phase: "curve" as const, progressPct: null, nextCheckAt: null, nextCloseTime: null, launchedAt: "2026-10-01T00:00:00Z", status: "live", ...o });
const NOW = Date.parse("2026-10-12T20:00:00Z");

describe("the grid's states (ChatGPT audit 6 A5): unavailable is never empty", () => {
  const base = { tab: "graduating" as const, loading: false, error: null, query: "", generatedAt: "2026-10-12T19:59:30Z", now: NOW };
  test("loading, error, unavailable, empty and results are distinct, with distinct sentences", () => {
    assert.deepEqual(gridState({ ...base, loading: true, all: [], shown: 0 }), { kind: "loading" });
    const err = gridState({ ...base, error: "HTTP 502", all: [], shown: 0 });
    // website-12's sentences (readiness.ts), one per state
    assert.equal(err.kind, "error"); assert.equal((err as { body: string }).body, dataStateSentence("error", "the coin list"));
    // A5: nothing read is "Curve progress is unavailable", not "no coin is past half"
    const un = gridState({ ...base, all: [coin({}), coin({ ticker: "Y" })], shown: 0 });
    assert.equal(un.kind, "unavailable"); assert.equal((un as { body: string }).body, curveProgressSentence("unavailable")); assert.match((un as { body: string }).body, /^Curve progress is unavailable/);
    assert.doesNotMatch((un as { body: string }).body, /No coin is past half/);
    const none = gridState({ ...base, all: [coin({ progressPct: 20 })], shown: 0 });
    assert.deepEqual(none, { kind: "empty", body: curveProgressSentence("empty"), notLaunched: false });
    const partial = gridState({ ...base, all: [coin({ progressPct: 20 }), coin({ ticker: "Y" })], shown: 0 });
    assert.match((partial as { body: string }).body, /1 coin's curve was not read and is left out\./);
    assert.deepEqual(gridState({ ...base, tab: "new", all: [], shown: 0 }), { kind: "empty", body: "No coin anyone can trade is launched on this site yet.", notLaunched: true });
    assert.deepEqual(gridState({ ...base, tab: "new", all: [coin({})], shown: 0, query: "zz" }), { kind: "empty", body: 'No coin matches "zz".', notLaunched: false });
    assert.deepEqual(gridState({ ...base, tab: "new", all: [coin({})], shown: 1 }), { kind: "results", note: null });
  });
  test("stale: an index read more than five minutes before now says when it was read", () => {
    const old = new Date(NOW - STALE_AFTER_MS - 60_000).toISOString();
    const r = gridState({ ...base, tab: "new", all: [coin({})], shown: 1, generatedAt: old });
    assert.deepEqual(r, { kind: "results", note: dataStateSentence("stale", "the coin list", { readAt: old }) }); assert.match(r.kind === "results" ? r.note! : "", /may be out of date/);
  });
  test("each tab's results follow its stated rule; About to graduate never ranks an unread curve as zero", () => {
    const list = [coin({ ticker: "A", progressPct: 80 }), coin({ ticker: "B", progressPct: null }), coin({ ticker: "C", progressPct: 50 }), coin({ ticker: "D", phase: "graduated", progressPct: 100 }), coin({ ticker: "E", nextCheckAt: "2026-10-13T00:00:00Z" })];
    assert.deepEqual(tabCoins("graduating", list).map((c) => c.ticker), ["A", "C"]);
    assert.deepEqual(tabCoins("graduated", list).map((c) => c.ticker), ["D"]);
    assert.deepEqual(tabCoins("next", list).map((c) => c.ticker), ["E"]);
    assert.deepEqual(curveCoverage(list), { read: 2, unread: 2 });
    assert.deepEqual(GRID_TABS.map((t) => t.id), ["new", "next", "graduating", "graduated", "pairs", "following"], "website-14 adds the browser-local Following tab");
    for (const t of GRID_TABS) clean(t.rule, t.id);
  });
  test("the coins page: list first, no hero, the PAIRS0 label fixed, one search box per screen", () => {
    const p = read("src/app/burnticker/CoinsIndex.tsx");
    assert.doesNotMatch(code(p), /HERO|HOW_IT_WORKS|bt-hero|bt-how/, "the hero and the three steps live on / only (Claude site audit 2 item 5)");
    assert.ok(p.indexOf('<h1 id="bt-coins-h"') < p.indexOf('className={`bt-tabs '), "it starts at the Coins heading");
    assert.match(p, /\{t\.label\}\{t\.id === "pairs" && ix \? <> <span className="bt-tab-count" aria-label=/, "a space and a badge between Pairs and its count");
    assert.match(read("config/public-repo/overlay/src/app/globals.css"), /@media \(min-width: 640px\) \{ \.bt-grid-search \{ display: none; \} \}/);
    assert.match(p, /data-grid-state=\{state\.kind\}/);
  });
});

describe("the site-wide wallet (owner decision, Claude site audit 2 item 6; 'make sure we can connect wallets')", () => {
  const layout = read("config/public-repo/overlay/src/app/layout.tsx");
  test("one provider, mounted once in the shell, around the header, every page, the footer and the tab bar", () => {
    assert.equal([...layout.matchAll(/<ShellWalletProviders /g)].length, 1);
    const inner = layout.slice(layout.indexOf("<ShellWalletProviders "), layout.indexOf("</ShellWalletProviders>"));
    for (const c of ["<SiteHeader />", "{children}", "<FooterSwitch ", "<TabBar />"]) assert.ok(inner.includes(c), c);
    const prov = read("src/app/burnticker/_components/ShellWalletProviders.tsx");
    assert.match(prov, /<WalletProvider wallets=\{wallets\} autoConnect=\{true\}>/, "auto-reconnect on (owner, 2026-10-12)");
    assert.match(prov, /new PhantomWalletAdapter\(\), new SolflareWalletAdapter\(\)/, "Phantom and Solflare by name; Backpack and every other Wallet Standard wallet are detected");
    // no second provider anywhere in the app outside the launch wizard's own layout (website-12's file; see the todo below)
    const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(d, e.name)] : []);
    const mounts = walk("src/app/burnticker").filter((f) => !f.startsWith(path.join("src/app/burnticker/launch")) && /<ConnectionProvider|<WalletProvider /.test(code(read(f))));
    assert.deepEqual(mounts, ["src/app/burnticker/_components/ShellWalletProviders.tsx"]);
    assert.doesNotMatch(code(read("src/app/burnticker/me/layout.tsx")), /Provider/, "Your coins reads the shell's connection");
  });
  test("merged (2026-10-12): src/app/burnticker/launch/layout.tsx no longer wraps WalletProviders, so the launch wizard's SignCard reads the shell's one provider", () => {
    const layout = fs.readFileSync(path.join(process.cwd(), "src/app/burnticker/launch/layout.tsx"), "utf8");
    assert.ok(!layout.includes('from "./WalletProviders"') && !layout.includes("<WalletProviders>"), "no second provider in the launch layout");
  });
  test("the header's button: real, never disabled, independent of the launch state, on every app page and in the phone menu", () => {
    const h = read("src/app/burnticker/_components/SiteHeader.tsx"), b = read("src/app/burnticker/_components/WalletButton.tsx");
    assert.match(h, /<WalletButton \/>/); assert.match(h, /<WalletButton variant="menu" \/>/);
    assert.ok(h.indexOf("data-launch-button") < h.indexOf("<WalletButton />"), "to the right of Launch a coin");
    assert.doesNotMatch(code(b), /\bdisabled\b|launchOpen|useLaunchAvailability|closed/i);
    assert.match(b, /return \(\) => \{ opener\.current = [^;]*; select\(null\); setAsked\(true\); setVisible\(true\); \};/); assert.match(b, /onClick=\{openList\}/, "disconnected: it clears an old pick and opens the adapter's wallet list");
    assert.match(b, /if \(!asked \|\| visible\) return;\s*setAsked\(false\);\s*if \(wallet && !connected && !connecting\) void connect\(\)/, "a wallet picked from the list connects once (the provider does not auto-connect)");
    assert.match(b, /\{shortAddress\(addr\)\}/); assert.match(b, /data-wallet-disconnect>\{WALLET_COPY\.disconnect\}/);
    assert.match(b, /e\.key === "Escape"[\s\S]*btn\.current\?\.focus\(\)/, "keyboard: Escape closes the menu and returns focus");
    assert.match(b, /<Link role="menuitem" href=\{ME_HREF\}/);
    // the layout mounts the header once for every route (/burnticker and every /burnticker/* page); the static pages print a link
    assert.equal([...layout.matchAll(/<SiteHeader \/>/g)].length, 1);
    assert.equal(STATIC_CONNECT_HREF, WALLET.href); assert.equal(ME_HREF, "/burnticker/me");
  });
  test("Your coins: disconnected shows the connect prompt; a connected wallet lists its coins; a pasted address is a lookup", () => {
    const W = "AJJ4XxCUYr8zzMWm8FYg3xh638LYAAApdNqWBqCK4oqj";
    const none = { connected: false, connecting: false, publicKey: null, pasted: "", busy: false, error: null, data: null };
    assert.deepEqual(meState(none), { kind: "prompt" });
    assert.deepEqual(meState({ ...none, connecting: true }), { kind: "connecting" });
    assert.deepEqual(meState({ ...none, connected: true, publicKey: W, busy: true }), { kind: "loading", wallet: W, source: "connected" });
    assert.deepEqual(meState({ ...none, connected: true, publicKey: W, data: { wallet: W, coins: [{}, {}], pairs: [] } }), { kind: "list", wallet: W, source: "connected", coins: 2, pairs: 0 });
    assert.deepEqual(meState({ ...none, connected: true, publicKey: W, data: { wallet: W, coins: [], pairs: [] } }), { kind: "empty", wallet: W, source: "connected" });
    assert.deepEqual(meState({ ...none, connected: true, publicKey: W, error: "HTTP 500" }), { kind: "error", wallet: W, source: "connected", message: "HTTP 500" });
    assert.deepEqual(meState({ ...none, connected: true, publicKey: W, data: { wallet: "Other1111111111111111111111111111111", coins: [{}], pairs: [] } }).kind, "loading", "another wallet's answer is never shown");
    assert.deepEqual(meWallet({ connected: false, publicKey: null, pasted: ` ${W} ` }), { wallet: W, source: "pasted" });
    assert.equal(meWallet({ connected: false, publicKey: null, pasted: "not-an-address" }), null);
    assert.ok(isAddress(W)); assert.equal(shortAddress(W), "AJJ4…4oqj");
    const page = read("src/app/burnticker/me/page.tsx");
    assert.match(page, /st\.kind === "prompt" \|\| st\.kind === "connecting"\s*\? <div className=\{card \+ " space-y-2"\} data-me-state=\{st\.kind\}><p className="text-neutral-300">\{WALLET_COPY\.prompt\}<\/p><WalletButton variant="menu" \/>/);
    assert.match(page, /wantsConnect\(window\.location\.search\) && !wallet\.connected\) openList\(\)/, "the static pages' deep link opens the wallet list");
    assert.ok(wantsConnect("?connect=1") && wantsConnect("?a=b&connect=1") && !wantsConnect("?connect=10"));
  });
  test("the adapter's RPC: the host's own network, or the configured public browser RPC", () => {
    assert.equal(walletEndpoint("mainnet"), "https://api.mainnet-beta.solana.com");
    assert.equal(walletEndpoint("devnet"), "https://api.devnet.solana.com");
    assert.equal(walletEndpoint("mainnet", { NEXT_PUBLIC_BURNTICKER_RPC_URL: " https://rpc.example/x " }), "https://rpc.example/x");
  });
  test("every wallet sentence is plain and lint-clean, and none mentions the launch state", () => {
    for (const t of Object.values(WALLET_COPY)) { clean(t, t); assert.doesNotMatch(t, /launches are (open|closed)/i); }
    clean(WALLET.note, "note"); clean(WALLET.menuNote, "menu note");
  });
});

describe("$DEFICIT site facts (ChatGPT audit 6 A7)", () => {
  const html = read("site/deficit/index.html");
  const text = html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<\/?(b|em|strong|sup|a|code)\b[^>]*>/g, "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ");
  test("(1) the July 4, 2025 debt-limit increase; (2) burns draw on the accumulated budget; (5) the Fed line is only the name's inspiration", () => {
    assert.match(text, /the next business day after the July 4, 2025 debt-limit increase/);
    assert.doesNotMatch(text, /the day after the debt ceiling was raised/);
    assert.match(text, /Burns draw on the accumulated budget\. Trading adds funds; a burn can be delayed or skipped when the spendable amount is too small\./);
    assert.doesNotMatch(text, /a day with no trading has small burns/i);
    const rule = /<p class="rule">([\s\S]*?)<\/p>/.exec(html)![1];
    assert.doesNotMatch(rule, /Fed/, "the factual rule text names no inspiration");
  });
  test("(6) the replay figures recompute from the committed Treasury pull with the keeper's own carry and reset", () => {
    const fxText = read("site/deficit/sample/treasury-fixture.json");
    const fx = JSON.parse(fxText) as { fetchedAt: string; data: { record_date: string; tot_pub_debt_out_amt: string }[] };
    const rules = parseRules(JSON.parse(read("config/burnkeeper/deficit.rules.json")));
    const rows = fx.data.map((r) => ({ recordDate: r.record_date, amount: r.tot_pub_debt_out_amt, cents: usdToCents(r.tot_pub_debt_out_amt) })).sort((a, b) => (a.recordDate < b.recordDate ? -1 : 1));
    const i0 = rows.findIndex((r) => r.recordDate >= "2025-01-01");
    let last: LastReading | null = { recordDate: rows[i0 - 1].recordDate, cents: rows[i0 - 1].cents, carryOutCents: BigInt(0) };
    let days = 0, units = 0, best = { date: "", units: 0 }, burned: string | null = null;
    for (const r of rows.slice(i0)) {
      const s = planReading(rules, last, burned, r);
      assert.notEqual(s.kind, "refuse", `${r.recordDate} would be held`);
      last = advance(last, s);
      if (s.kind === "burn") { days++; units += s.step.units; burned = r.recordDate; if (s.step.units > best.units) best = { date: r.recordDate, units: s.step.units }; }
    }
    assert.deepEqual([days, units, best.date, best.units], [235, 6490, "2025-07-07", 366]);
    assert.equal(crypto.createHash("sha256").update(fxText).digest("hex"), "6338cd8527382f5ea16f7a3945599782147fd7ecbd1d29925562cb89b756fd93", "the pull the page cites");
    assert.match(text, /It would have counted 235 burn days and 6,490 units\. The biggest day was 2025-07-07/);
    assert.match(text, /fetched on 2026-10-09/); assert.match(text, /site\/deficit\/sample\/treasury-fixture\.json/);
  });
  test("(3) the short recipe carries its caveat and links the detailed check; (4) the memo example's swap field is the pool prefix the program writes", () => {
    assert.match(text, /The program also applies an execution cap, the 0\.02 SOL reserve, carried spend, a spend floor and rounding/);
    const memo = /<pre id="memo">([^<]+)<\/pre>/.exec(html)![1].replace(/&lt;/g, "<").replace(/&gt;/g, ">");
    assert.match(memo, /\|swap=<pool12>\|/); assert.doesNotMatch(memo, /sig12/);
    assert.match(text, /swap is the first 12 characters of the Raydium pool address the program bought on, or none when nothing was bought/);
    // the serializer's own shape: a 12-character base58 prefix
    const sample = "DEBT|2026-10-08|src=fiscaldata.treasury.gov debt_to_penny|prev=40284036147367.19|now=40305316210829.72|delta=21280063462.53|units=21|pool=1000000000|spent=659438374|got=123.45|burn=123.45|swap=CPMMoo8L3F4N|rules=sha256:8e3e8b66748a|v2";
    assert.equal(parseBuybackMemo(sample)?.swap, "CPMMoo8L3F4N");
  });
  test("(7) the readiness line sits directly under the title, and the page reads plainly", () => {
    const h1 = html.indexOf("<h1>"), ready = html.indexOf('id="readyLabel"'), rule = html.indexOf('<p class="rule">');
    assert.ok(h1 > 0 && ready > h1 && ready < rule, "under the title, before the rule");
    assert.match(html, /<meta name="description" content="\$DEFICIT is a Solana memecoin whose supply burns when the U\.S\. national debt rises\./);
  });
});

describe("website-12's site launch record, consumed (coordinator, 2026-10-12)", () => {
  test("the header, the dialog, the wallet note, the home status line and the previews read the record; nothing types open or closed", () => {
    const h = read("src/app/burnticker/_components/SiteHeader.tsx"), m = read("src/app/burnticker/_components/LaunchClosedModal.tsx");
    assert.match(h, /const launch = useSiteLaunchState\(\);\s*const launchOpen = launch\.wizard;/); assert.match(h, /<LaunchClosedModal state=\{launch\}/);
    assert.match(m, /<p data-launch-sentence>\{state\.sentence\}<\/p>/);
    for (const f of ["src/app/burnticker/_components/SiteHeader.tsx", "src/app/burnticker/_components/LaunchClosedModal.tsx", "src/lib/burnticker/siteNav.mjs", "config/public-repo/overlay/src/app/layout.tsx", "src/lib/burnticker/siteMeta.ts", "src/lib/burnticker/home.ts"]) assert.doesNotMatch(code(read(f)).replace(/Whether creator launches are open is unknown right now|Checking whether creator launches are open/g, ""), /launches are (open|closed)/i, f);
    assert.equal(LAUNCH_CLOSED.body, SITE_SENTENCE.loading); assert.equal(LAUNCH_CLOSED.unread, SITE_SENTENCE.unavailable); assert.equal(WALLET.note, WALLET_NOTE);
    for (const env of [{}, { BURNTICKER_CREATOR_LAUNCHES_PREVIEW: "1" }, { BURNTICKER_CREATOR_LAUNCHES_ENABLED: "1", BURNTICKER_CLUSTER: "mainnet" }]) {
      const st = siteLaunchState(env);
      assert.equal(metaDescription(env), st.meta.description);
      const d = homeData([], process.cwd(), Date.now(), null, undefined, st);
      assert.ok(d.statusLine!.endsWith(st.sentence), d.statusLine!); assert.equal(d.launch, st);
    }
    // the static dialog: the record's sentence from the home API, the unavailable sentence when it cannot be read
    const home = read("site/burnticker/index.html");
    assert.match(home, /open = !!\(l && l\.wizard === true\); if \(said\) said\.textContent = l && l\.sentence \? l\.sentence : "Whether creator launches are open is unknown right now, so no launch controls are shown\.";/);
    assert.equal(siteLaunchStateFromCatalogue(null, { failure: "x" }).sentence, SITE_SENTENCE.unavailable);
  });
  test("the home strip's step 2 carries the first-burn prerequisite with the creator's raise choices (website-14, §75: no typed 85)", () => {
    const home = read("site/burnticker/index.html");
    assert.ok(home.includes(`<p class="how-x how-pre" data-prerequisite>${prerequisiteLineFor("launchlab")}</p>`));
    assert.match(prerequisiteLineFor("launchlab"), /the amount its creator chose \(40, 60 or 85 SOL\)/);
    clean(prerequisiteLineFor("launchlab"), "prerequisite");
  });
  test("Claude 2e: the summary's counted lines link to their own lists; Claude 3: the steps say the coin's own trading fees nowhere", () => {
    const c = read("src/app/burnticker/_components/CurrentStatusSummary.tsx");
    assert.match(c, /<details id="cs-findings"/); assert.match(c, /<details id="cs-open"/); assert.match(c, /\{s\.lines\.map\(\(l\) => <SummaryLine key=\{l\} l=\{l\} \/>\)\}/);
    assert.doesNotMatch(read("src/lib/burnticker/siteNav.mjs"), /coin's own trading fees/);
  });
  test("the static deploy copies the whole site/burnticker folder, so the archived whitepaper ships", () => {
    const d = read("scripts/ops/deploy-sites.sh");
    assert.match(d, /site burnticker site\/burnticker "\$BT_PUB" "\$BURNTICKER_WWW" tokens\.html/);
    // ops-2 (2026-10-12) wrapped every rsync in copy_dir so a failed copy fails the script; the brand copy still ships the whole folder minus sample/, README.md and *.mjs
    assert.match(d, /copy_dir "\$label brand" --exclude='sample\/' --exclude='README\.md' --exclude='\*\.mjs' \$KEEP "\$brand\/" "\$www\/"/);
    assert.ok(fs.existsSync("site/burnticker/whitepaper-2026-10-10.html"));
  });
});

