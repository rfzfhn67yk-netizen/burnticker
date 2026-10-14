// WEBSITE BRIEF 2026-10-11 (launch folder CHATGPT-WEBSITE-SUGGESTIONS-2026-10-11.md) — the parts landed so far:
// §1 the launch page resolves the creator-launch gate before any control renders (loading → skeleton, closed, open, unavailable), and
// §1/§7 one vocabulary for the four empty states (not launched / no activity / loading / data unavailable).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { LAUNCH_GATE_LOADING, closedNetworkLine, launchGateFromCatalogue, wizardMayRender } from "@/lib/burnticker/launchGateState";
import { EMPTY_STATE_COPY, emptyHeading, emptyKindFor } from "@/lib/burnticker/emptyState";
import { EXPLORE_VERIFIED_BURN, SEASONS_HREF } from "@/lib/burnticker/currentStatusLinks";
import { formatHits, lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import { buildCurrentStatus, readChainFacts, UPGRADEABLE_LOADER, type ChainFacts, mainnetDeployment } from "@/lib/burnticker/currentStatus";
import { upgradeAuthorityText } from "@/lib/burnticker/currentStatusText";

const cfg = loadCopyLintConfig();
const clean = (t: string, what: string) => { const r = lintCopy(t, cfg); assert.ok(r.ok, `${what}:\n${formatHits(r)}`); };

describe("launch gate (website brief §1: no wizard flash before the gate resolves)", () => {
  test("loading until the catalogue answers; only an explicit launches.creators: true opens the wizard", () => {
    assert.deepEqual(LAUNCH_GATE_LOADING, { kind: "loading" });
    assert.equal(wizardMayRender(LAUNCH_GATE_LOADING), false);
    assert.deepEqual(launchGateFromCatalogue({ launches: { creators: false }, cluster: "devnet" }), { kind: "closed", cluster: "devnet" });
    assert.deepEqual(launchGateFromCatalogue({ cluster: "devnet" }), { kind: "closed", cluster: "devnet" }, "a catalogue without the field is closed");
    assert.deepEqual(launchGateFromCatalogue({ launches: { creators: "true" } }), { kind: "closed", cluster: null }, "only the boolean true opens");
    const open = launchGateFromCatalogue({ launches: { creators: true }, cluster: "mainnet" });
    assert.deepEqual(open, { kind: "open", cluster: "mainnet" }); assert.equal(wizardMayRender(open), true);
    for (const s of [launchGateFromCatalogue({ launches: { creators: false } }), launchGateFromCatalogue(null, "catalogue HTTP 502"), launchGateFromCatalogue("nope")]) assert.equal(wizardMayRender(s), false, JSON.stringify(s));
    assert.deepEqual(launchGateFromCatalogue(null, "catalogue HTTP 502"), { kind: "unavailable", detail: "catalogue HTTP 502" });
    assert.equal(closedNetworkLine("devnet"), "This site is showing devnet."); assert.equal(closedNetworkLine(null), "");
  });
  test("the launch page returns the gate component before the wizard, and starts in the loading state", () => {
    const page = fs.readFileSync("src/app/burnticker/launch/page.tsx", "utf8");
    assert.match(page, /useState<LaunchGateState>\(LAUNCH_GATE_LOADING\)/);
    assert.match(page, /if \(!wizardMayRender\(gate\)\) return <LaunchGate /);
    assert.ok(page.indexOf("if (!wizardMayRender(gate))") < page.indexOf('data-free-text'), "the gate returns before the first wizard control");
    assert.doesNotMatch(page, /launchesOpen/, "no tri-state boolean that renders the wizard while null");
    const gate = fs.readFileSync("src/app/burnticker/launch/LaunchGate.tsx", "utf8");
    for (const k of ["loading", "unavailable", "closed"]) assert.match(gate, new RegExp(`data-launch-gate="${k}"`));
    assert.doesNotMatch(gate, /WalletMultiButton|data-decision/, "no launch control on any gate state");
    assert.match(gate, /EXPLORE_VERIFIED_BURN\.href/, "the closed page's primary action explores a verified burn");
  });
  test("the pre-launch action and the Seasons destination", () => {
    assert.equal(EXPLORE_VERIFIED_BURN.label, "Inspect the devnet receipt");
    assert.match(EXPLORE_VERIFIED_BURN.href, /^\/burnticker\/check\?demo=1#verify$/);
    assert.ok(fs.existsSync("src/app/burnticker/check/CheckClient.tsx"));
    assert.equal(SEASONS_HREF, "/burnticker/leagues");
    clean(`${EXPLORE_VERIFIED_BURN.label}. ${EXPLORE_VERIFIED_BURN.blurb}`, "explore action");
  });
});

describe("the four empty states (website brief §1/§7)", () => {
  test("four distinct kinds with distinct headings, lint-clean words", () => {
    const kinds = Object.keys(EMPTY_STATE_COPY);
    assert.deepEqual(kinds.sort(), ["loading", "no-activity", "not-launched", "unavailable"]);
    assert.equal(new Set(kinds.map((k) => emptyHeading(k as keyof typeof EMPTY_STATE_COPY))).size, 4);
    for (const c of Object.values(EMPTY_STATE_COPY)) { clean(`${c.heading}. ${c.body}`, c.kind); assert.doesNotMatch(c.body, /coming soon|\bsoon\b/i); }
  });
  test("emptyKindFor: an error is unavailable, no answer is loading, a missing launch is not-launched, an empty answer is no-activity", () => {
    assert.equal(emptyKindFor({ loading: true, error: "HTTP 500", empty: true }), "unavailable");
    assert.equal(emptyKindFor({ loading: true, error: null, empty: true }), "loading");
    assert.equal(emptyKindFor({ loading: false, error: null, empty: true, launched: false }), "not-launched");
    assert.equal(emptyKindFor({ loading: false, error: null, empty: true }), "no-activity");
    assert.equal(emptyKindFor({ loading: false, error: null, empty: false }), null);
  });
  test("the component renders the kind's heading, a skeleton only while loading, and diagnostics behind a disclosure", () => {
    const src = fs.readFileSync("src/app/burnticker/_components/EmptyState.tsx", "utf8");
    assert.match(src, /data-empty-state=\{kind\}/);
    assert.match(src, /kind === "loading" \?[\s\S]*motion-safe:animate-pulse/, "the skeleton respects reduced motion");
    assert.match(src, /<details[^>]*><summary[^>]*>Details<\/summary>/);
  });
});

describe("$DEFICIT before launch (website brief §1)", () => {
  test("the pre-launch data comes from the locked rules file and current-status.json: 2 % per $1B, its sha256, the 2026-10-13 launch date, the served site canonical", async () => {
    const { deficitPrelaunch } = await import("@/lib/burnticker/deficitPrelaunch");
    const d = deficitPrelaunch();
    assert.equal(d.dial.percent, "2%"); assert.equal(d.dial.unitLabel, "$1B");
    assert.equal(d.rulesSha256, "8e3e8b66748a7630b9fe0e9793583434a076f2a03e335cad3d4c965758a15be9", "the mainnet rule the owner picked on 2026-10-10");
    assert.equal(d.canonical, "https://deficit.burnticker.com/"); assert.equal(d.launch.date, "2026-10-13");
    assert.equal(d.rehearsal.demo.checkHref, EXPLORE_VERIFIED_BURN.href);
    clean(`${d.oneSentence} ${d.launch.note} ${d.rehearsal.note} ${d.rehearsal.demo.summary}`, "pre-launch copy");
  });
  test("the featured receipt is a real executed devnet burn from the rehearsal evidence, and its summary's numbers are that receipt's", async () => {
    const { deficitPrelaunch } = await import("@/lib/burnticker/deficitPrelaunch");
    const { sampleReceipts } = await import("@/lib/burnticker/trustpack/samples");
    const d = deficitPrelaunch();
    const ev = (JSON.parse(fs.readFileSync("docs/burnkeeper/evidence/devnet-2026-10-10/burns.json", "utf8")) as { signature: string; status: string; recordDate: string; units: number; got: string; spent: string; pool: string }[]).find((r) => r.signature === d.rehearsal.demo.signature)!;
    assert.ok(ev, "in the evidence file"); assert.equal(ev.status, "confirmed"); assert.equal(ev.recordDate, "2026-10-06");
    assert.equal(sampleReceipts().receipts[0].signature, d.rehearsal.demo.signature, "the check page's default sample is the featured receipt");
    const s = d.rehearsal.demo.summary;
    assert.ok(s.includes(`${ev.units} units`) && s.includes("4,010,874.87") && s.includes("0.0201 SOL") && s.includes("0.506 SOL"), s);
  });
  test("the coin page renders the pre-launch page for an unregistered $DEFICIT; the API route serves it", () => {
    const coin = fs.readFileSync("src/app/burnticker/t/[ticker]/page.tsx", "utf8");
    assert.match(coin, /if \(t === "DEFICIT"\) return <DeficitPrelaunch fallbackSite=\{DEFICIT_SITE\} \/>/);
    const pre = fs.readFileSync("src/app/burnticker/t/[ticker]/DeficitPrelaunch.tsx", "utf8");
    assert.match(pre, /<link rel="canonical" href=\{d\?\.canonical \?\? fallbackSite\} \/>/);
    assert.match(pre, /fetch\("\/api\/burnticker\/deficit-prelaunch"\)/); assert.ok(fs.existsSync("src/app/api/burnticker/deficit-prelaunch/route.ts"));
    assert.match(pre, /Holders&apos; balances are never touched/);
  });
  test("deficit.burnticker.com: every Trade control says 'not available until launch' with no href until LINKS.trade is set; missing data reads 'Not launched' / 'Data unavailable'", () => {
    const html = fs.readFileSync("site/deficit/index.html", "utf8");
    const trade = [...html.matchAll(/<a [^>]*id="trade(?:Top|Hero|Foot)"[^>]*>[^<]*<\/a>/g)].map((m) => m[0]);
    assert.equal(trade.length, 3);
    for (const a of trade) { assert.doesNotMatch(a, /href=/, a); assert.match(a, /aria-disabled="true"/); assert.match(a, /not available/); }
    assert.match(html, /var LINKS = \{ trade: "" \}/);
    assert.doesNotMatch(html, /awaiting the keeper's status\.json|No receipts loaded/);
    assert.match(html, new RegExp(`"${EMPTY_STATE_COPY["not-launched"].heading}\\. \\$DEFICIT has not launched yet`));
    assert.match(html, new RegExp(`"${EMPTY_STATE_COPY.unavailable.heading}\\. The live figures did not load`));
  });
  test("the shared EmptyState replaces the ad-hoc loading / error lines on the coins, pair, coin, trust, operator, check and leagues pages", () => {
    for (const f of ["src/app/burnticker/CoinsIndex.tsx", "src/app/burnticker/p/[pairId]/page.tsx", "src/app/burnticker/t/[ticker]/page.tsx", "src/app/burnticker/trust/page.tsx", "src/app/burnticker/operator/page.tsx", "src/app/burnticker/check/CheckClient.tsx", "src/app/burnticker/leagues/page.tsx"]) {
      const s = fs.readFileSync(f, "utf8");
      assert.match(s, /<EmptyState kind=/, f);
      assert.doesNotMatch(s, />Loading…</, `${f}: no bare "Loading…"`);
      assert.doesNotMatch(s, /className="p-6 text-red-400">\{err\}/, `${f}: no raw error line`);
    }
  });
});

describe("one current-status source (website brief §4)", () => {
  const ms = (threshold: number, tl: number, members: number): Uint8Array => { const d = new Uint8Array(100 + 33 * members); const v = new DataView(d.buffer); v.setUint16(72, threshold, true); v.setUint32(74, tl, true); d[94] = 0; v.setUint32(96, members, true); return d; };
  const b64 = (d: Uint8Array) => Buffer.from(d).toString("base64");
  test("the Squads v4 multisig decoder reads threshold, time lock and members (the layout checked against both live vaults on 2026-10-11)", async () => {
    const { decodeSquadsMultisig, programDataOf, upgradeAuthorityOf, fmtSecs } = await import("@/lib/burnticker/currentStatus");
    assert.deepEqual(decodeSquadsMultisig(ms(2, 0, 3)), { threshold: 2, timeLockSecs: 0, members: 3 });
    assert.deepEqual(decodeSquadsMultisig(ms(2, 172800, 3)), { threshold: 2, timeLockSecs: 172800, members: 3 });
    assert.equal(decodeSquadsMultisig(new Uint8Array(20)), null);
    const prog = new Uint8Array(36); prog[0] = 2; prog.fill(7, 4); assert.ok(programDataOf(prog));
    const pd = new Uint8Array(45); pd[0] = 3; pd[12] = 1; pd.fill(9, 13); assert.ok(upgradeAuthorityOf(pd)); pd[12] = 0; assert.equal(upgradeAuthorityOf(pd), null);
    assert.equal(fmtSecs(0), "0 (none)"); assert.equal(fmtSecs(172800), "48 h"); assert.equal(fmtSecs(60), "1 min");
  });
  test("readChainFacts over an injected RPC; a failing RPC reports an error and no guessed value", async () => {
    const { readChainFacts, SQUADS_PROGRAM } = await import("@/lib/burnticker/currentStatus");
    const rpc = { call: async <T,>(_m: string, p: unknown[]) => ({ value: (p[0] as string[]).map((k) => (k === "MS" ? { owner: SQUADS_PROGRAM, data: [b64(ms(2, 0, 3)), "base64"] } : null)) }) as unknown as T };
    const f = await readChainFacts("mainnet", rpc, "MS", ["PROG"], 0);
    assert.deepEqual(f.squads, { threshold: 2, timeLockSecs: 0, members: 3 }); assert.deepEqual(f.programs.PROG, { deployed: false, upgradeAuthority: null, authorityRead: "unavailable" }); assert.equal(f.error, null);
    const bad = await readChainFacts("mainnet", { call: async () => { throw new Error("429"); } }, "MS", ["PROG"], 0);
    assert.equal(bad.squads, null); assert.match(bad.error!, /429/);
  });
  test("the mainnet time lock: 0 now ON PURPOSE with 48 h planned; the open requirement closes only when the chain shows 48 h; an unreadable chain says so", async () => {
    const { buildCurrentStatus } = await import("@/lib/burnticker/currentStatus");
    const facts = (tl: number | null) => ({ mainnet: { cluster: "mainnet" as const, readAt: "2026-10-11T20:00:00.000Z", error: tl === null ? "down" : null, squads: tl === null ? null : { threshold: 2, timeLockSecs: tl, members: 3 }, programs: {} } });
    const now0 = buildCurrentStatus({ env: {}, chain: facts(0), now: 0 });
    const main = now0.upgradeAuthority.find((u) => u.cluster === "mainnet")!;
    assert.equal(main.timeLockSecs, 0); assert.equal(main.timeLockSource, "chain"); assert.equal(main.plannedTimeLockSecs, 172800);
    assert.equal(main.line, "The mainnet Squads time lock is 0 (none) today, read from chain. The plan is 48 h from a week or more after the soft launch.");
    assert.match(main.why, /owner decided on 2026-10-11/i);
    assert.equal(now0.releaseRequirements.find((r) => r.id === "time-lock")!.status, "open");
    assert.equal(buildCurrentStatus({ env: {}, chain: facts(172800), now: 0 }).releaseRequirements.find((r) => r.id === "time-lock")!.status, "done");
    const down = buildCurrentStatus({ env: {}, chain: facts(null), now: 0 }).upgradeAuthority.find((u) => u.cluster === "mainnet")!;
    assert.equal(down.timeLockSecs, null); assert.equal(down.timeLockSource, "unavailable"); assert.match(down.line, /could not be read from chain/);
  });
  test("design, deployed and historical are separate; mainnet programs read 'deployed on mainnet' (2026-10-11 record); host wiring is its own line; every summary line is lint-clean", async () => {
    const { buildCurrentStatus } = await import("@/lib/burnticker/currentStatus");
    const s = buildCurrentStatus({ env: { BURNTICKER_CLUSTER: "devnet" }, chain: {}, now: 0 });
    for (const p of s.programs) { assert.equal(p.mainnet.deployed, true); assert.equal(p.mainnet.line, "It is deployed on mainnet."); assert.equal(p.devnet.deployed, true); }
    assert.equal(s.networks.find((n) => n.cluster === "mainnet")!.deployment, "deployed");
    assert.equal(s.host.line, `This site is showing devnet. No program is connected on this site. ${(await import("@/lib/burnticker/launchAvailability")).siteLaunchState({ BURNTICKER_CLUSTER: "devnet" }).sentence}`);   // website-12: the one record's sentence
    assert.ok(s.design.length && s.historical.length && s.historical.every((h) => fs.existsSync(h.path.replace(/\/$/, ""))), "history links point at files that exist");
    assert.ok(s.reviews.every((r) => r.findings.every((f) => f.fix && f.recheck && f.deployed)), "every finding has fix, re-check and deployed statuses");
    assert.ok(s.settlement.some((x) => /GFDEBTN/.test(x.check) && /quarter/.test(x.check)), "the FRED comparison is stated as quarterly");
    assert.ok(s.settlement.every((x) => !/ESPN/.test(x.primary)), "no ESPN reads");
    for (const l of s.lines) clean(l, "status line");
    clean(`${s.attesters.line} ${s.phase.line}`, "attesters/phase");
  });
  test("no surface states 48 h as the mainnet time lock in effect; every page renders the one source", () => {
    const op = JSON.parse(fs.readFileSync("config/burnticker/operator.json", "utf8")) as { clusters: { mainnet: { squads: { timeLock: string } } } };
    assert.match(op.clusters.mainnet.squads.timeLock, /^0 now .*48 h planned/);
    for (const f of ["config/burnticker/transparency.json", "src/lib/burnticker/trustpack/checklist.ts", "docs/burn-receipts/powers-register.json", "docs/burnticker/CHECK-THIS-YOURSELF.md"]) assert.doesNotMatch(fs.readFileSync(f, "utf8"), /mainnet: 48 h\)|vault with a 48 h time lock|upgrade authority \(48 h time lock\)/, f);
    // website-15 item 17: the full block on Trust; the operator page prints its first line and a link (the same one source)
    assert.match(fs.readFileSync("src/app/burnticker/trust/page.tsx", "utf8"), /<CurrentStatusSummary card=\{card\} \/>/);
    assert.match(fs.readFileSync("src/app/burnticker/operator/page.tsx", "utf8"), /<CurrentStatusSummary card=\{card\} compact \/>/);
    assert.match(fs.readFileSync("src/app/burnticker/_components/CurrentStatusSummary.tsx", "utf8"), /useJsonRead<CurrentStatus>\("\/api\/burnticker\/v1\/current-status"\)/);
    for (const f of ["site/burnticker/status/index.html"]) { const h = fs.readFileSync(f, "utf8"); assert.match(h, /data-current-status/, f); assert.match(h, /"\/api\/burnticker\/v1\/current-status"/, f); assert.match(h, /s\.lines\.forEach/, f); }
    // website-13: the home prints one status line, which the home API builds from the same source (currentStatusLive)
    assert.match(fs.readFileSync("site/burnticker/index.html", "utf8"), /data-status-line/); assert.match(fs.readFileSync("src/app/api/burnticker/home/route.ts", "utf8"), /currentStatusLive\(\)/);
    assert.ok(fs.existsSync("src/app/api/burnticker/v1/current-status/route.ts"));
  });
});

describe("verification words and the featured receipt (website brief §3/§5)", () => {
  const ids = ["tx", "program", "memo", "reading", "config", "rules", "source", "units", "spend", "burn"] as const;
  const all = (over: Partial<Record<(typeof ids)[number], { ok: boolean | null; detail: string }>> = {}) => ids.map((id) => ({ id, label: id, ok: true as boolean | null, detail: "fine", ...(over[id] ?? {}) }));
  test("verdicts: verified only when every check passed; skipped checks make 'partly verified'; a silent dependency is 'could not check', never invalid; a contradiction fails", async () => {
    const { verdictOf, checkStatus } = await import("@/lib/burnticker/verificationStatus");
    assert.equal(verdictOf(all()).verdict, "verified");
    const partly = verdictOf(all({ rules: { ok: null, detail: "no rules file given; the on-chain hash is …" }, source: { ok: null, detail: "feed x: this page re-fetches the Treasury feed only" } }));
    assert.equal(partly.verdict, "partly verified"); assert.equal(partly.counts["not checked"], 2); assert.match(partly.line, /2 were not checked/);
    const down = verdictOf([{ id: "tx", label: "tx", ok: null, detail: "the RPC did not answer: fetch failed" }]);
    assert.equal(down.verdict, "could not check"); assert.match(down.line, /not evidence that the receipt is invalid/); assert.equal(down.counts.unavailable, 1);
    const src = verdictOf(all({ source: { ok: null, detail: "the source could not be fetched from here: Treasury HTTP 503" } }));
    assert.equal(src.verdict, "partly verified"); assert.equal(src.counts.unavailable, 1);
    assert.equal(verdictOf(all({ burn: { ok: false, detail: "burned less" } })).verdict, "failed");
    assert.equal(verdictOf([]).verdict, "could not check", "zero checks are never verified");
    assert.equal(checkStatus({ ok: null, detail: "the Treasury API did not return both dates" }), "unavailable");
    assert.equal(checkStatus({ ok: null, detail: "the Reading's source_url_hash = sha256 of the Treasury URL for that date; the source was not fetched here" }), "not checked");
    const layers = verdictOf(all()).layers.map((l) => [l.layer, l.checks.map((c) => c.id)]);
    assert.deepEqual(layers, [["source", ["source"]], ["attestation", ["reading", "config"]], ["execution", ["tx", "program", "memo", "rules", "units", "spend", "burn"]]]);
    for (const l of verdictOf(all()).layers) clean(`${l.title}. ${l.what}`, l.layer);
  });
  test("receipt rows on coin and pair pages: passed / failed / not checked / unavailable, never a bare tick", async () => {
    const { receiptRowStatus } = await import("@/lib/burnticker/verificationStatus");
    assert.equal(receiptRowStatus({ status: "confirmed", verify: { verified: true, checks: [] } }).status, "passed");
    assert.equal(receiptRowStatus({ status: "confirmed", verify: { verified: false, checks: ["memo spent ≠ recorded spend"] } }).status, "failed");
    assert.equal(receiptRowStatus({ status: "planned", verify: { verified: false, checks: [] } }).status, "not checked");
    assert.equal(receiptRowStatus({ status: "confirmed" }).status, "unavailable");
  });
  test("/burnticker/check?demo=1 pre-selects the featured receipt and runs the check; the samples API names it", async () => {
    const { sampleReceipts } = await import("@/lib/burnticker/trustpack/samples");
    const { deficitPrelaunch } = await import("@/lib/burnticker/deficitPrelaunch");
    assert.equal(sampleReceipts().featured, deficitPrelaunch().rehearsal.demo.signature);
    const v = fs.readFileSync("src/app/burnticker/check/ReceiptVerifier.tsx", "utf8");
    assert.match(v, /get\("demo"\) === "1"/); assert.match(v, /j\.featured/); assert.match(v, /void run\(\)/);
    assert.match(v, /verdictOf\(res\.checks\)/); assert.doesNotMatch(v, /res\.verified \?/, "the old single tick is gone");
    assert.match(v, /<details className="mt-2"><summary[^>]*>Every check, the memo and the accounts<\/summary>/, "details behind a disclosure");
  });
  test("the real receipt: the about page tells it in the status file's own words (read, never typed); the home and its devnet card link the verify action", async () => {
    const html = fs.readFileSync("site/burnticker/index.html", "utf8");
    const about = fs.readFileSync("src/app/burnticker/about/page.tsx", "utf8");
    // website-10 (2026-10-12): the explainer, the receipt story included, moved to /burnticker/about; the summary is read from
    // current-status.json through deficitPrelaunch() at request time, so it cannot drift from the file
    assert.match(about, /<p className="text-neutral-200">\{d\.rehearsal\.demo\.summary\}<\/p>/);
    assert.match(about, /This is a real burn from the devnet rehearsal on \{longDay\(d\.rehearsal\.demo\.recordDate\)\}\./);
    assert.match(about, /href=\{EXPLORE_VERIFIED_BURN\.href\}>\{EXPLORE_VERIFIED_BURN\.label\}/);
    assert.match(html, /href="\/burnticker\/check\?demo=1#verify">Inspect the devnet receipt</);
    const { featuredCoins } = await import("@/lib/burnticker/home");
    // Codex review 5 F3/F4 (website-13): the devnet card's Check receipt opens its newest confirmed burn by signature, not the shared demo
    assert.match(featuredCoins().find((c) => c.id === "deficit-devnet")!.receipt!.href, /^\/burnticker\/check\?sig=\w+&cluster=devnet#verify$/);
    const demo = (JSON.parse(fs.readFileSync("config/burnticker/current-status.json", "utf8")) as { demo: { summary: string } }).demo;
    clean(demo.summary, "featured receipt");
  });
});

describe("layout, navigation and sharing metadata (website brief §8)", () => {
  const home = fs.readFileSync("site/burnticker/index.html", "utf8");
  test("site audit #7/#16: no ticker tape and no guardrail strip on the homepage (the two widest elements at 320 px); text wraps", () => {
    assert.doesNotMatch(home, /class="tape"|class="reel"|<ul class="guard"/);
    assert.match(home, /\.hero h1\{[^}]*overflow-wrap:anywhere/);
    assert.match(home, /\.card\{[^}]*min-width:0/);
    // the activity line under the header scrolls inside itself and never widens the page
    assert.match(home, /\.sh-ticker\{[^}]*overflow-x:auto;white-space:nowrap/);
  });
  test("Seasons goes to /burnticker/leagues on every surface", async () => {
    for (const m of home.matchAll(/<a [^>]*href="([^"]+)"[^>]*>Seasons<\/a>/g)) assert.equal(m[1], SEASONS_HREF);
    const { SITE_NAV, SITE_TABS } = await import("@/lib/burnticker/siteNav.mjs");
    assert.equal(SITE_NAV.find((l) => l.label === "Seasons")?.href, SEASONS_HREF); assert.equal(SITE_TABS.find((t) => t.label === "Seasons")?.href, SEASONS_HREF);
    assert.doesNotMatch(fs.readFileSync("src/app/burnticker/leagues/page.tsx", "utf8"), />Seasons<\/Link>/);
  });
  test("absolute sharing images, canonical URLs and titles on the static home, the whitepaper and the $DEFICIT site", () => {
    const meta = (h: string, prop: string) => new RegExp(`<meta (?:property|name)="${prop}" content="([^"]+)"`).exec(h)?.[1];
    for (const [f, canon] of [["site/burnticker/index.html", "https://burnticker.com/"], ["site/burnticker/whitepaper.html", "https://burnticker.com/whitepaper.html"], ["site/deficit/index.html", "https://deficit.burnticker.com/"]] as const) {
      const h = fs.readFileSync(f, "utf8");
      assert.match(h, new RegExp(`<link rel="canonical" href="${canon.replace(/\./g, "\\.")}">`), f);
      assert.match(meta(h, "og:image") ?? "", /^https:\/\//, `${f} og:image absolute`);
      assert.match(meta(h, "twitter:image") ?? "", /^https:\/\//, `${f} twitter:image absolute`);
      assert.match(h, /<title>[^<]{8,}<\/title>/, f);
    }
  });
  test("client app pages get a title, description and canonical from a server layout (check, trust, operator, launch)", () => {
    for (const d of ["check", "trust", "operator", "launch"]) {
      const l = fs.readFileSync(`src/app/burnticker/${d}/layout.tsx`, "utf8");
      assert.doesNotMatch(l, /^"use client"/, d); assert.match(l, new RegExp(`canonical: "/burnticker/${d}"`));
      // website-12: the launch page's description reads the one launch-state record at request time (generateMetadata), the others are static
      assert.match(l, d === "launch" ? /export async function generateMetadata\(\): Promise<Metadata> \{\n  const description = `\$\{siteLaunchState\(process[.]env\)\.meta\.description\}/ : /export const metadata: Metadata/, d);
    }
    assert.match(fs.readFileSync("src/app/burnticker/launch/WalletProviders.tsx", "utf8"), /^"use client"/);
  });
});

describe("burn arithmetic (website brief §6)", () => {
  test("simulateCrank reproduces the real 2026-10-06 devnet receipt: 23 units, rule spend 104,345,230, 2 % reserve cap → spent 20,132,384, carried 84,212,846", async () => {
    const { simulateCrank, DEFAULT_CAP_LAMPORTS } = await import("@/lib/burnticker/burnMath");
    const ev = (JSON.parse(fs.readFileSync("docs/burnkeeper/evidence/devnet-2026-10-10/burns.json", "utf8")) as { recordDate: string; prev: string; now: string; units: number; memo: string; partial: string }[]).find((r) => r.recordDate === "2026-10-06")!;
    const cents = (x: string) => BigInt(x.replace(".", ""));
    const pool = BigInt(/\|pool=(\d+)\|/.exec(ev.memo)![1]), spent = BigInt(/\|spent=(\d+)\|/.exec(ev.memo)![1]);
    const o = simulateCrank({ prev: cents(ev.prev), now: cents(ev.now), carryIn: BigInt(0), unit: BigInt(100_000_000_000), carry: "consecutive", fractionBps: 100, poolLamports: pool, capLamports: DEFAULT_CAP_LAMPORTS, carriedInLamports: BigInt(0), floorLamports: BigInt(5_000_000), reserveSolLamports: BigInt(1_006_619_200) });
    assert.equal(o.units, BigInt(ev.units)); assert.equal(o.ruleSpend, BigInt(104_345_230)); assert.equal(o.spend, spent); assert.equal(o.carriedOut, BigInt(84_212_846));
    assert.ok(o.naiveSpend > o.ruleSpend, "compounding spends less than units × f"); assert.equal(o.estimatedTokensRaw, null, "no token amount without stated reserves");
    assert.match(ev.partial, /0\.084212846 SOL carried/);
  });
  test("cap, floor, carry and the reserve-based estimate", async () => {
    const { simulateCrank, LAMPORTS } = await import("@/lib/burnticker/burnMath");
    const base = { prev: BigInt(0), now: BigInt(300_000_000_000), carryIn: BigInt(0), unit: BigInt(100_000_000_000), carry: "consecutive" as const, fractionBps: 200, carriedInLamports: BigInt(0), floorLamports: LAMPORTS / BigInt(200), reserveSolLamports: BigInt(100) * LAMPORTS };
    const capped = simulateCrank({ ...base, poolLamports: BigInt(40) * LAMPORTS, capLamports: BigInt(25) * LAMPORTS });
    assert.equal(capped.budget, BigInt(25) * LAMPORTS); assert.equal(capped.capBound, true);
    const tiny = simulateCrank({ ...base, poolLamports: BigInt(10_000_000), capLamports: null });
    assert.equal(tiny.belowFloor, true); assert.equal(tiny.spend, BigInt(0));
    const carry = simulateCrank({ ...base, now: BigInt(250_000_000_000), poolLamports: LAMPORTS, capLamports: null });
    assert.equal(carry.units, BigInt(2)); assert.equal(carry.carryOut, BigInt(50_000_000_000));
    const est = simulateCrank({ ...base, poolLamports: LAMPORTS, capLamports: null, assumedReserveTokenRaw: BigInt(1_000_000_000_000) });
    assert.ok(est.estimatedTokensRaw !== null && est.estimatedTokensRaw > BigInt(0));
  });
  test("the calculator is on the check page and the $DEFICIT pre-launch page, labels hypothetical inputs and estimates, and keeps 'holders' balances are never touched' beside it", () => {
    const c = fs.readFileSync("src/app/burnticker/_components/BurnMath.tsx", "utf8");
    assert.match(c, /simulateCrank\(/); assert.match(c, /Hypothetical inputs/); assert.match(c, /not a quote/); assert.match(c, /Holders&apos; balances are never touched/);
    clean(c.slice(c.lastIndexOf("return (") + 8).replace(/e\.target\.value/g, "").replace(/\{[^{}]*\}/g, " ").replace(/<[^>]+>/g, " "), "calculator words");
    assert.match(fs.readFileSync("src/app/burnticker/check/CheckClient.tsx", "utf8"), /<BurnMath \/>/);
    assert.match(fs.readFileSync("src/app/burnticker/t/[ticker]/DeficitPrelaunch.tsx", "utf8"), /<BurnMath \/>/);
  });
});

describe("pair funds flow, by rule version (website brief §2)", () => {
  test("winner takes the burn: the shared one-liner, fees → pools → winner's burn, and every §5.5 outcome (draw, missing result, forward time-out, dead winner); nobody paid", async () => {
    const { pairFundsFlow, pairRuleVersion } = await import("@/lib/burnticker/pairFundsFlow");
    const { PAIR_BURN_SENTENCE } = await import("@/lib/burnticker/describe");
    assert.equal(pairRuleVersion(true), "winner-takes-the-burn"); assert.equal(pairRuleVersion(false), "separate-pools");
    const f = pairFundsFlow("winner-takes-the-burn", { a: "ELSAYED", b: "ROGERS" });
    assert.equal(f.oneLiner, PAIR_BURN_SENTENCE);
    const all = JSON.stringify(f);
    for (const re of [/draw/i, /72 hours after a reading/, /forward does not land within 72 hours/, /no live trading pool/, /20% of the locked pool's liquidity fees/, /never touched/, /Nothing is paid to holders/]) assert.match(all, re);
    assert.doesNotMatch(all, /Nobody is paid/, "the operator is paid fees; the sentence is about holders (UX report 3 item 6)");
    const old = pairFundsFlow("separate-pools");
    assert.match(old.versionLabel, /before 2026-10-11; none on mainnet/); assert.match(old.oneLiner, /neither pool pays the other/);
    for (const x of [f, old]) clean([x.versionLabel, x.oneLiner, ...x.steps.map((s) => `${s.title}. ${s.text}`), ...x.outcomes.map((o) => `${o.when}: ${o.then}`), x.never].join("\n"), x.version);
  });
  test("shown before a registered pair launches and on the pair page, version from the locked rules", () => {
    assert.match(fs.readFileSync("src/app/burnticker/launch/page.tsx", "utf8"), /\{pairOn && !ruleB && <PairFundsFlow version="winner-takes-the-burn"/);
    assert.match(fs.readFileSync("src/app/burnticker/p/[pairId]/page.tsx", "utf8"), /<PairFundsFlow version=\{pairRuleVersion\(!!t\.winnerTakesBurn\)\}/);
  });
});

describe("the homepage around five questions, and an honest leagues directory (website brief §7)", () => {
  const home = fs.readFileSync("site/burnticker/index.html", "utf8");
  test("order (list first since 2026-10-12): hero → How it works → the coin grid → Follow the season → a short current status → the footer receipt; safeguards and implementation details stay on Trust", () => {
    const at = (m: string) => { const i = home.indexOf(m); assert.ok(i >= 0, m); return i; };
    const order = ['<section class="hero', '<ol class="how">', 'id="coins"', "data-featured", 'id="seasons"', 'id="status"', '<footer class="sh-footer"'].map(at);
    assert.deepEqual([...order].sort((a, b) => a - b), order);
    for (const gone of ["Safeguards and limitations", "data-current-limits", 'class="wrap impl"', 'id="layers"', 'id="feeds"', 'id="economics"', 'id="products"']) assert.ok(!home.includes(gone), gone);
    // website-13 (Claude site audit 2 item 9): the status is one line; its Trust link is added with it (the full record stays on Trust)
    const status = home.slice(at('id="status"'), at("</main>"));
    assert.match(status, /data-status-line/); assert.match(home, /a\.href = "\/burnticker\/trust"/);
    // review item 18: the status line shows a grey bar while it loads, not "Loading" or "Reading the current status"
    assert.doesNotMatch(home, /Reading the current status/);
    assert.match(home, /<p class="status-line" data-status-line aria-live="polite"><span class="stat-skel wide" aria-hidden="true"><\/span><\/p>/);
  });
  test("the leagues directory: honest availability and a clearly labelled example, no launch invitation", () => {
    const p = fs.readFileSync("src/app/burnticker/leagues/page.tsx", "utf8");
    // site audit #9 (2026-10-11): one plain banner, then a compact sport → leagues list while no league has a coin
    assert.match(p, /data-prelaunch-banner>\s*<p className="font-medium text-neutral-100">No team coin has launched yet\.<\/p>/);
    assert.match(p, /\{empty \? \(\s*<dl className="space-y-3" data-leagues-compact>/);
    assert.match(p, /Example only\. These coins and counts are not live data\./);
    assert.doesNotMatch(p, /launch one|Launch the first/i);
  });
});

// F1 regression (code review 3; UX report 3 item 1): only a decoded None says no upgrade authority; a failed, partial or malformed read
// says unavailable; a failed mainnet lookup leaves the deployment unknown.
const b64f = (d: Uint8Array) => Buffer.from(d).toString("base64");
const PROG = "PROG", PD = "PD";
/** a Program account (type 2) pointing at a ProgramData address of 32 bytes of 7s (its base58 is what the second read asks for) */
const programAcct = () => { const d = new Uint8Array(36); d[0] = 2; d.fill(7, 4); return { owner: UPGRADEABLE_LOADER, data: [b64f(d), "base64"] }; };
const programData = (auth: "none" | "set") => { const d = new Uint8Array(45); d[0] = 3; d[12] = auth === "set" ? 1 : 0; if (auth === "set") d.fill(9, 13); return { owner: UPGRADEABLE_LOADER, data: [b64f(d), "base64"] }; };
/** an RPC whose first getMultipleAccounts answers the Program account and whose second answers `second` (or throws) */
const rpcWith = (second: unknown | Error) => {
  let n = 0;
  return { call: async <T,>(_m: string, p: unknown[]) => { n += 1; if (n === 1) return { value: (p[0] as string[]).map((k) => (k === PROG ? programAcct() : null)) } as unknown as T; if (second instanceof Error) throw second; return second as T; } };
};

describe("F1 (ChatGPT code review 3, 2026-10-11): unknown is never 'none' or 'not deployed'", () => {
  test("decoded None → no upgrade authority (chain); decoded Some → the key", async () => {
    const none = await readChainFacts("devnet", rpcWith({ value: [programData("none")] }), null, [PROG], 0);
    assert.deepEqual(none.programs[PROG], { deployed: true, upgradeAuthority: null, authorityRead: "decoded" });
    const set = await readChainFacts("devnet", rpcWith({ value: [programData("set")] }), null, [PROG], 0);
    assert.equal(set.programs[PROG].authorityRead, "decoded"); assert.ok(set.programs[PROG].upgradeAuthority);
  });
  const unavailable: [string, unknown | Error][] = [
    ["the ProgramData read throws (partial: the Program account read succeeded)", new Error("HTTP 429")],
    ["the ProgramData account is missing", { value: [null] }],
    ["the response has no value array", {}],
    ["the ProgramData account has a foreign owner", { value: [{ ...programData("none"), owner: "11111111111111111111111111111111" }] }],
    ["the ProgramData bytes are the wrong account type", { value: [{ owner: UPGRADEABLE_LOADER, data: [b64f(new Uint8Array(45)), "base64"] }] }],
    ["the ProgramData bytes are truncated", { value: [{ owner: UPGRADEABLE_LOADER, data: [b64f(Uint8Array.of(3, 0, 0)), "base64"] }] }],
    ["the option tag is neither 0 nor 1", { value: [{ owner: UPGRADEABLE_LOADER, data: [b64f((() => { const d = new Uint8Array(45); d[0] = 3; d[12] = 2; return d; })()), "base64"] }] }],
    ["the authority flag says Some but the key is cut off", { value: [{ owner: UPGRADEABLE_LOADER, data: [b64f((() => { const d = new Uint8Array(20); d[0] = 3; d[12] = 1; return d; })()), "base64"] }] }],
  ];
  for (const [what, second] of unavailable) {
    test(`${what} → unavailable, never "no upgrade authority"`, async () => {
      const f = await readChainFacts("devnet", rpcWith(second), null, [PROG], 0);
      assert.equal(f.programs[PROG].deployed, true);
      assert.equal(f.programs[PROG].authorityRead, "unavailable");
      const s = buildCurrentStatus({ env: {}, chain: { devnet: f }, now: 0 });
      // the real program ids are in verified-build.json; wire the fake read onto each so the joined object exercises the path
      const facts: ChainFacts = { ...f, programs: Object.fromEntries(s.programs.map((p) => [p.programId, f.programs[PROG]])) };
      for (const p of buildCurrentStatus({ env: {}, chain: { devnet: facts }, now: 0 }).programs) {
        assert.equal(p.devnet.authoritySource, "unavailable"); assert.equal(p.devnet.upgradeAuthority, null);
        const t = upgradeAuthorityText(p.devnet);
        assert.match(t, /unavailable/); assert.doesNotMatch(t, /no upgrade authority|immutable|none/i);
      }
    });
  }
  test("the joined object: decoded None says immutable; no live read uses the verified-build record, labelled as a record", async () => {
    const base = buildCurrentStatus({ env: {}, chain: {}, now: 0 });
    for (const p of base.programs) { assert.equal(p.devnet.authoritySource, "verified-build"); assert.match(upgradeAuthorityText(p.devnet), /as recorded in verified-build\.json/); }
    const none = await readChainFacts("devnet", rpcWith({ value: [programData("none")] }), null, [PROG], 0);
    const facts: ChainFacts = { ...none, programs: Object.fromEntries(base.programs.map((p) => [p.programId, none.programs[PROG]])) };
    for (const p of buildCurrentStatus({ env: {}, chain: { devnet: facts }, now: 0 }).programs) { assert.equal(p.devnet.authoritySource, "chain"); assert.equal(upgradeAuthorityText(p.devnet), "There is no upgrade authority, so the program is immutable. This was read from chain."); }
    assert.equal(upgradeAuthorityText({ upgradeAuthority: null, authoritySource: "verified-build" }), "The upgrade authority is not recorded.");
  });
  test("renderers use the one wording function, never a bare `?? \"none\"`", () => {
    const r = fs.readFileSync("src/app/burnticker/_components/CurrentStatusSummary.tsx", "utf8");
    assert.match(r, /upgradeAuthorityText\(p\.devnet\)/); assert.doesNotMatch(r, /upgradeAuthority \?\? "none"/);
    const serverModule = ["@", "lib", "burnticker", "currentStatus"].join("/"); // spelled out so the publish import scan does not read a regex as an import
    assert.ok(!r.split("\n").some((l) => l.startsWith("import {") && l.includes(`"${serverModule}"`)), "the client renderer imports only types from the server module (it reads files)");
  });
  test("a failed mainnet lookup with a recorded deploy falls back to the dated verified-build record (never 'unknown' when recorded, never 'not deployed'); an unrecorded program reads 'unknown'", async () => {
    const base = buildCurrentStatus({ env: {}, chain: {}, now: 0 });
    const failed = await readChainFacts("mainnet", { call: async () => { throw new Error("503"); } }, null, base.programs.map((p) => p.programId), 0);
    const s = buildCurrentStatus({ env: {}, chain: { mainnet: failed }, now: 0 });
    // both programs were deployed on 2026-10-11 and verified-build.json records it: a failed read shows the record, attributed to it
    for (const p of s.programs) { assert.equal(p.mainnet.deployed, true); assert.equal(p.mainnet.source, "verified-build"); assert.doesNotMatch(p.mainnet.line, /not deployed|unknown/); }
    assert.ok(s.lines.every((l) => !/not deployed on mainnet/.test(l)), "no summary line says not deployed");
    // the pure state function: no record + failed read = unknown; no record + empty read = not deployed; a live read wins over the record
    assert.deepEqual(mainnetDeployment(false, failed, base.programs[0].programId), { deployed: null, source: "unavailable", line: "Its mainnet deployment is unknown because the chain read failed." });
    const emptyRpc = { call: async <T,>(_m: string, p: unknown[]) => ({ value: (p[0] as string[]).map(() => null) }) as unknown as T };
    const ok = await readChainFacts("mainnet", emptyRpc, null, base.programs.map((p) => p.programId), 0);
    assert.deepEqual(mainnetDeployment(false, ok, base.programs[0].programId), { deployed: false, source: "chain", line: "It is not deployed on mainnet yet." });
  });
  test("a devnet read that failed before the Program accounts is unavailable too, with the dated verified-build record beside it", async () => {
    const base = buildCurrentStatus({ env: {}, chain: {}, now: 0 });
    const failed = await readChainFacts("devnet", { call: async () => { throw new Error("429"); } }, null, base.programs.map((p) => p.programId), 0);
    for (const p of buildCurrentStatus({ env: {}, chain: { devnet: failed }, now: 0 }).programs) {
      assert.equal(p.devnet.authoritySource, "unavailable");
      assert.match(upgradeAuthorityText(p.devnet), /^The upgrade authority is unavailable because the chain read failed\. The last value recorded in verified-build\.json \(2026-10-12\) is \w+/);
    }
  });
});
