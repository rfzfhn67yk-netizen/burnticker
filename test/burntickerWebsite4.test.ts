// UX REPORT 3 (ChatGPT live review, 2026-10-11; launch folder CHATGPT-UX-REPORT-3-2026-10-11.md) — the website-4 pass. Item 1 (F1) has
// its own file (test/burntickerF1Authority.test.ts); the rest are pinned here, one describe per item.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { formatHits, lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import { EXPLORE_VERIFIED_BURN } from "@/lib/burnticker/currentStatusLinks";

const cfg = loadCopyLintConfig();
const clean = (t: string, what: string) => { const r = lintCopy(t, cfg); assert.ok(r.ok, `${what}:\n${formatHits(r)}`); };
const read = (f: string) => fs.readFileSync(f, "utf8");

describe("item 2: a short homepage — status, then the real receipt, then the rest", () => {
  const home = read("site/burnticker/index.html");
  const hero = home.slice(home.indexOf('<section class="hero'), home.indexOf('<div class="tape"'));
  test("no orphan door number; the primary action is 'Inspect the devnet receipt' on every surface", () => {
    assert.doesNotMatch(home, /door [0-9] ·/i);
    assert.equal(EXPLORE_VERIFIED_BURN.label, "Inspect the devnet receipt");
    assert.doesNotMatch(home, /Explore a verified burn/);
    assert.equal([...home.matchAll(/href="\/burnticker\/check\?demo=1#verify">Inspect the devnet receipt</g)].length, 2, "hero and 'what you can do now'");
  });
  test("in the hero: the closed-launch status line, then the receipt action, then the guardrails behind a disclosure, then the doors", () => {
    const at = (m: string) => { const i = hero.indexOf(m); assert.ok(i >= 0, m); return i; };
    const order = ["data-launches-closed", "data-demo-receipt", "Inspect the devnet receipt", 'class="guardsum"', '<details class="guards">', '<div class="doors">'].map(at);
    assert.deepEqual([...order].sort((a, b) => a - b), order);
    const details = hero.slice(at('<details class="guards">'), hero.indexOf("</details>", at('<details class="guards">')));
    assert.match(details, /<ul class="guard"/, "the eleven guardrails sit inside the disclosure");
    const sum = /<p class="guardsum">([^<]+)<\/p>/.exec(hero)![1];
    assert.equal((sum.match(/\. |\.$/g) ?? []).length, 2, "two sentences");
    assert.match(sum, /One operator signs every reading/); assert.match(sum, /not a firm audit/);
    clean(sum, "guardrail summary");
    assert.match(hero, /This site currently shows devnet rehearsal evidence/); assert.match(hero, /no wallet is needed/i);
  });
});

describe("item 3: zero data → one explanation and one evidence link; populated states keep their navigation", () => {
  test("the coins page hides the tabs, search and zero totals when the host has no coin and no pair", () => {
    const p = read("src/app/burnticker/page.tsx");
    assert.match(p, /const empty = !!ix && ix\.tokens\.length === 0 && ix\.pairs\.length === 0;/);
    assert.match(p, /\{!empty && <div className="flex flex-col gap-3 md:flex-row md:items-center">\s*<div className="bt-tabs"/, "tabs and search only with records");
    assert.match(p, /\{ix && !empty && tab !== "pairs"/); assert.match(p, /\{ix && !empty && tab === "pairs"/); assert.match(p, /\{ix && !empty && \(\s*<section className="grid grid-cols-2/);
    const box = p.slice(p.indexOf("{empty && ("), p.indexOf("{ix && !empty && tab !== \"pairs\""));
    assert.match(box, /No coin is registered on this host yet/); assert.match(box, /whether the programs are deployed is separate/);
    assert.equal([...box.matchAll(/EXPLORE_VERIFIED_BURN\.href/g)].length, 1, "one evidence link");
    assert.match(p, /\{NO_WALLET_LINE\}/, "the no-wallet line stays");
  });
  test("Seasons collapses three empty sections into one; the leagues directory keeps its labelled example before the league links", () => {
    const r = read("src/app/burnticker/rivalries/page.tsx");
    assert.match(r, /const empty = !err && boards\.length === 0 && pairs\.length === 0 && brackets\.length === 0;/);
    assert.match(r, /\{!empty && !err && <>/); assert.match(r, /data-empty-evidence><Link className="underline" href=\{EXPLORE_VERIFIED_BURN\.href\}/);
    assert.match(r, /<EmptyState kind="unavailable"/); assert.doesNotMatch(r, /text-red-400/);
    const l = read("src/app/burnticker/leagues/page.tsx");
    assert.ok(l.indexOf("data-demo-scoreboard") < l.indexOf("ix.sports.map("), "explanation and example before the 25 league links");
  });
});

describe("items 4 and 8: host diagnostics behind a disclosure; missing automation evidence says unavailable", () => {
  test("no page prints the raw 'On this host:' notes inline; each uses the HostDiagnostics disclosure", () => {
    for (const f of ["src/app/burnticker/page.tsx", "src/app/burnticker/trust/page.tsx", "src/app/burnticker/t/[ticker]/page.tsx", "src/app/burnticker/p/[pairId]/page.tsx"]) {
      const s = read(f); assert.doesNotMatch(s, /On this host: \$\{|On this host: \{/, f); assert.match(s, /<HostDiagnostics stubs=\{/, f);
    }
    const c = read("src/app/burnticker/_components/HostDiagnostics.tsx");
    assert.match(c, /<details[^>]*data-host-diagnostics>/); assert.match(c, /operator details<\/summary>/);
    const server = read("src/lib/burnticker/server.ts");
    assert.doesNotMatch(server, /"burn_receipts program: not deployed/, "a host without a program id does not claim the program is not deployed");
    assert.match(server, /no program id wired on this host/);
  });
  test("status page: a failed status.json fills every group it feeds with 'unavailable'; the config summary says what it does not show", async () => {
    const html = read("site/burnticker/status/index.html");
    assert.match(html, /data-config-scope>This summary is the deployment and configuration record\. It is separate from the automation data below and does not show whether burns are being processed now\./);
    assert.match(html, /\.catch\(function \(e\) \{ window\.renderUnavailable\(/);
    // run the page script against a minimal DOM and a failing fetch: every group says unavailable, nothing reads "none"
    const ids = ["loadnote", "slip-sub", "slip-rows", "feeds", "feeds-note", "alerts", "ends", "snapshot", "programs", "keepers", "slip"];
    type Node = { id?: string; textContent: string; className: string; children: Node[]; attrs: Record<string, string>; appendChild(n: Node): Node; setAttribute(k: string, v: string): void; querySelector(s: string): Node | null; remove(): void; classList: { add(): void } };
    const mk = (id?: string): Node => { const n: Node = { id, textContent: "", className: "", children: [], attrs: {}, appendChild(c) { n.children.push(c); n.textContent += c.textContent; return c; }, setAttribute(k, v) { n.attrs[k] = v; }, querySelector: () => tbody(n), remove() {}, classList: { add() {} } }; return n; };
    const bodies = new Map<Node, Node>(); const tbody = (n: Node) => { if (!bodies.has(n)) bodies.set(n, mk()); return bodies.get(n)!; };
    const els = Object.fromEntries(ids.map((i) => [i, mk(i)]));
    const doc = { getElementById: (i: string) => els[i], createElement: () => mk(), createTextNode: (t: string) => ({ ...mk(), textContent: t }), currentScript: null, documentElement: mk(), querySelector: () => null };
    const script = /<script>\n\(function \(\) \{\n  \/\/ THE ONE CURRENT-STATUS[\s\S]*?\}\)\(\);\n(\(function \(\) \{\n  "use strict";[\s\S]*?\}\)\(\);)\n<\/script>/.exec(html)![1];
    let rejected: Promise<unknown> | null = null;
    const win: Record<string, unknown> = {};
    const fetchFail = () => (rejected = Promise.resolve({ ok: false, status: 404 }));
    new Function("window", "document", "fetch", script)(win, doc, fetchFail);
    await rejected; await new Promise((r) => setTimeout(r, 0));
    assert.match(els.loadnote.textContent, /Current automation data could not be read \(status\.json: HTTP 404\)\. The current-status summary is separate and does not establish whether burns are being processed now\./);
    for (const g of ["alerts", "ends", "snapshot", "keepers"]) assert.match(els[g].textContent, /^unavailable/, g);
    for (const g of ["feeds", "programs"]) assert.match(tbody(els[g]).textContent, /^unavailable/, g);
    assert.doesNotMatch(Object.values(els).map((e) => e.textContent).join(" "), /\bnone\b|all ok|no live coins/);
    assert.equal(doc.documentElement.attrs["data-status-feed"], "unavailable");
    clean(els.loadnote.textContent.replace(/\(status\.json: HTTP 404\)/, ""), "unknown-state copy");
  });
});

describe("item 5: one current summary on Trust/Operator; configured wallets are not called missing; bounty funding and balance apart", () => {
  test("operator.json: no 'created on launch week' prose beside configured mainnet addresses; the statement reads 'address configured; statement not signed'", async () => {
    const op = JSON.parse(read("config/burnticker/operator.json")) as { note: string; clusters: { mainnet: { status: string; wallets: { role: string; pubkey: string }[] } }; signedMessage: { status: string } };
    assert.doesNotMatch(`${op.note} ${op.clusters.mainnet.status}`, /launch week|created by the owner on|does not exist|until the owner creates/i);
    assert.match(op.clusters.mainnet.status, /^programs not deployed on mainnet yet; .*configured \(owner, 2026-10-11\) except the keeper and deployer keys$/);
    assert.ok(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(op.clusters.mainnet.wallets.find((w) => w.role === "dev-fee")!.pubkey), "the signer address is configured");
    assert.match(op.signedMessage.status, /^TODO_/, "the statement is NOT signed yet");
    const { OPERATOR_COPY, OPERATOR_LINE } = await import("@/lib/burnticker/trustpack/copy");
    assert.match(OPERATOR_COPY.signedPending, /^Address configured; statement not signed\./); assert.doesNotMatch(`${OPERATOR_COPY.signedPending} ${OPERATOR_COPY.walletsIntro}`, /does not exist|until they exist/);
    assert.equal(OPERATOR_LINE, "Operated by one independent operator (United States) — contact: contact@burnticker.com");
    const { OPERATOR_LINE: fromFees } = await import("@/lib/burnticker/fees"); assert.equal(fromFees, OPERATOR_LINE);
    assert.match(read("src/lib/burnticker/trustpack/operator.ts"), /address configured; statement not signed/);
    assert.match(read("src/app/burnticker/operator/page.tsx"), /data-operator-line>\{OPERATOR_LINE\}/);
  });
  test("bounty: recorded funding (5 SOL, 2026-10-11, transaction not recorded here) and the live balance are separate lines", async () => {
    const t = JSON.parse(read("config/burnticker/transparency.json")) as { howBuilt: { bounty: { recordedFunding: { sol: number; date: string; transaction: string | null } } } };
    assert.deepEqual({ ...t.howBuilt.bounty.recordedFunding, source: undefined }, { sol: 5, date: "2026-10-11", transaction: null, source: undefined });
    const { v1Bounty } = await import("@/lib/burnticker/trustpack/api");
    for (const rpc of [{ call: async () => { throw new Error("503"); } }, { call: async <T,>() => ({ value: 0 }) as unknown as T }]) {
      const r = await v1Bounty({ rpc }); const b = r.body as { recordedFunding: { sol: number; transaction: string | null }; balanceLamports: string | null };
      assert.equal(b.recordedFunding.sol, 5); assert.equal(b.recordedFunding.transaction, null, "no invented signature");
    }
    const ui = read("src/app/burnticker/trust/TrustPackSection.tsx");
    assert.match(ui, /recorded funding: \{b\.recordedFunding/); assert.match(ui, /funding transaction: \{b\.recordedFunding\?\.transaction \?[\s\S]*?: "not recorded here"\}/); assert.match(ui, /live balance: \{b\.balanceLamports !== null/);
    assert.doesNotMatch(ui, /\(live, mainnet\)\` : `unavailable[^`]*`\} · \{b\.status\}/, "the old one-line 'balance … · funded' is gone");
  });
  test("Trust: the current summary carries control and money once; the long disclosures sit behind one evidence disclosure; no 'nobody is paid'", async () => {
    const { buildCurrentStatus } = await import("@/lib/burnticker/currentStatus");
    const money = buildCurrentStatus({ env: {}, chain: {}, now: 0 }).lines.find((l) => l.startsWith("Money:"))!;
    assert.match(money, /25 bps of curve volume and 20% of post-graduation LP SOL fees; the other 80% of those SOL fees and the token side go to each coin's burn pool/);
    clean(money, "money line");
    const page = read("src/app/burnticker/trust/page.tsx");
    const at = (m: string) => { const i = page.indexOf(m); assert.ok(i >= 0, m); return i; };
    assert.ok(at("<CurrentStatusSummary card={card} />") < at("<TrustPackSection card={card} />") && at("<TrustPackSection card={card} />") < at("data-trust-evidence"));
    const ev = page.slice(at("data-trust-evidence"), page.indexOf("</details>\n      <HostDiagnostics"));
    for (const h of ["Standing facts", "Powers Register", "Developer fee wallet and ledger", "Who runs this", "How this was built", "Every wallet"]) assert.ok(ev.includes(h), h);
    assert.doesNotMatch(page, /BURNTICKER_FEE_WALLET unset/);
    assert.match(read("src/lib/burnticker/trust.ts"), /paid to the operator treasury \(the developer fee wallet, not the Squads vault, which holds no fee stream\)/);
  });
});

describe("item 6: one signer vs two publishers; the rule's winner is not the team's", () => {
  test("no public surface calls a second data source an independent operator or signer", () => {
    for (const f of ["src/app/burnticker/leagues/[league]/[season]/page.tsx", "src/app/burnticker/derby/page.tsx", "src/app/burnticker/derby/[tournamentId]/page.tsx", "src/app/burnticker/p/[pairId]/page.tsx", "src/lib/burnticker/api/derby.ts", "src/lib/burnticker/coverage/leagues.ts", "src/lib/burnticker/sources/native.ts"]) {
      assert.doesNotMatch(read(f), /(second|an|two) independent operators?\b(?! \(United States\))/i, f);
    }
    assert.match(read("src/app/burnticker/leagues/[league]/[season]/page.tsx"), /A game counts once a second publisher reports the same final\. That is a second-source check, not a second signer: one operator attester signs every reading \(quorum 1\)\./);
  });
  test("the pair sentence names the coin whose rule fires, says nothing is paid to holders, and never 'nobody is paid'", async () => {
    const { PAIR_BURN_SENTENCE, pairResultSentence } = await import("@/lib/burnticker/describe");
    assert.match(PAIR_BURN_SENTENCE, /the coin whose rule fires, not the team that won/); assert.match(PAIR_BURN_SENTENCE, /Nothing is paid to holders\.$/);
    clean(PAIR_BURN_SENTENCE, "pair sentence");
    const rule = (onYes: boolean) => ({ kind: "binary" as const, binary: onYes ? { onYes: { fractionOfPool: 0.02 } } : { onNo: { fractionOfPool: 0.02 } } }) as never;
    const s = pairResultSentence({ ticker: "A", rule: rule(true) }, { ticker: "B", rule: rule(false) }, "yes");
    assert.match(s, /^This result fires \$A's rule/); assert.doesNotMatch(s, /\bwinner\b/i); clean(s, "named pair sentence");
    for (const f of ["src/lib/burnticker/pairFundsFlow.ts", "src/lib/burnticker/fieldHelp.ts", "src/lib/burnticker/api/spec.ts", "docs/burnticker/WHITEPAPER.md", "docs/burnticker/api.md", "site/burnticker/index.html", "site/burnticker/whitepaper.html"]) assert.doesNotMatch(read(f), /nobody is paid/i, f);
    assert.match(read("site/burnticker/index.html"), /season ends is the coin with the most receipts its champion: a stat on a scoreboard/, "a champion stays a statistic");
  });
});

describe("item 7: the verifier shows the example's outcome first; controls under 'Check another receipt'; the anchor clears the header", () => {
  test("order inside the verifier: verdict and three layers → signer caveat → the controls disclosure (closed for ?demo=1)", () => {
    const v = read("src/app/burnticker/check/ReceiptVerifier.tsx");
    const at = (m: string) => { const i = v.indexOf(m); assert.ok(i >= 0, m); return i; };
    const order = ['id="verify"', "data-verdict={v.verdict}", "data-layer={l.layer}", "data-signer-caveat", "data-check-another", "RPC endpoint (any devnet RPC you trust)"].map(at);
    assert.deepEqual([...order].sort((a, b) => a - b), order);
    assert.match(v, /className=\{`\$\{card\} scroll-mt-24`\} id="verify"/); assert.match(v, /open=\{!wantDemo\}/);
    assert.match(v, /data-verdict="checking"><EmptyState compact kind="loading"/, "a loading state, never an empty slot that reads as a result");
    assert.match(v, /This is not evidence that the receipt is invalid/, "an unavailable check stays distinct from a failed one");
  });
  test("the check page puts the verifier first for ?demo=1 (the checklist loading above cannot push the anchor away)", async () => {
    const p = read("src/app/burnticker/check/page.tsx");
    assert.match(p, /\{verifierAt === "top" && <ReceiptVerifier card=\{card\} \/>\}\s*\{err && /); assert.match(p, /\{verifierAt === "bottom" && <ReceiptVerifier card=\{card\} \/>\}/);
    const { CHECK_COPY } = await import("@/lib/burnticker/trustpack/copy");
    assert.doesNotMatch(CHECK_COPY.intro, /at the bottom/);
    for (const k of ["verifierDemoIntro", "verifierCaveat", "checkAnotherTitle"] as const) clean(CHECK_COPY[k], k);
    assert.match(CHECK_COPY.verifierCaveat, /A signature establishes who signed a reading, not that the value is true/);
  });
});

describe("item 8: the external $DEFICIT site collapses its empty sections before launch and links the rehearsal proof", () => {
  const html = read("site/deficit/index.html");
  test("pre-launch by default: Live, Today, Receipts and the curve hidden; one summary with the devnet receipt; 1% rehearsal vs 2% proposed", () => {
    assert.match(html, /<html lang="en" class="prelaunch">/);
    assert.match(html, /\.prelaunch #live,\.prelaunch #today,\.prelaunch #receipts,\.prelaunch #chart/);
    const box = html.slice(html.indexOf('id="prelaunch"'), html.indexOf('<section class="wrap" id="live">'));
    assert.match(box, /href="https:\/\/burnticker\.com\/burnticker\/check\?demo=1#verify">Inspect the devnet receipt</);
    assert.match(box, /1% of the burn pool per \$1B; the proposed mainnet rule above is 2% per \$1B/); assert.match(box, /No launch date is announced/);
    assert.doesNotMatch(box, /buy|trade now/i);
    clean(box.replace(/<[^>]+>/g, " "), "deficit pre-launch summary");
    assert.match(html, /status = s; renderStatus\(s\); document\.documentElement\.classList\.remove\("prelaunch"\);/, "only a readable status.json expands the sections");
  });
  test("no 'Launched on Burnticker' while not launched", () => { assert.doesNotMatch(html, /Launched on Burnticker/); });
});

describe("report body: an unavailable program check never classifies a token definitively", () => {
  test("the Not-Burnticker list says registration is unknown when the program is not read", async () => {
    const { evidenceLines } = await import("@/lib/burnticker/ops/cloneWatch");
    const lines = evidenceLines({ registered: null, symbol: "X", matched: { how: "ticker match", term: "DEFICIT" }, lp: { state: "present" } } as never);
    assert.match(lines[0], /registration is unknown/); assert.doesNotMatch(lines[0], /^not a Burnticker coin/);
  });
});

describe("item 10: context help at first use instead of a front-loaded glossary", () => {
  test("the landing hero has no six-term list; burn, receipt, reading signer, burn budget and automation are explained where they first appear", async () => {
    const home = read("site/burnticker/index.html");
    assert.doesNotMatch(home, /data-glossary|<dl class="terms"/);
    const { GLOSSARY } = await import("@/lib/burnticker/glossary");
    const abbr = (text: string) => new RegExp(`<abbr class="term" title="[^"]+">${text}</abbr>`);
    for (const t of ["burns", "receipt", "reading signer", "burn budget", "automation"]) assert.match(home, abbr(t), t);
    assert.equal(GLOSSARY.attester.term, "reading signer (attester)");
    assert.match(GLOSSARY.burnPool.short, /^One coin's burn budget in SOL/); assert.doesNotMatch(GLOSSARY.burnPool.short, /winner|losing/);
    clean(GLOSSARY.burnPool.short, "burn pool");
    assert.match(read("src/app/burnticker/trust/page.tsx"), /data-trust-evidence[\s\S]*<TermNote /, "the trust page's word list sits beside its evidence, not in the header");
  });
});
