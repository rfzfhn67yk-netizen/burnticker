// website-16 (2026-10-12): THE LEGITIMACY PASS. The owner: "what can we do to make this website look legitimate and not something that was
// baked up in an afternoon?" Plain pages built from the repository's own files (the changelog, the incident log, the bounty, the press kit,
// the verify-it-yourself walk-through, the History page), security.txt, one icon set, the receipt mark in every empty state,
// the type/spacing/motion tokens and measured contrast. Placement (owner): history is available, not on display.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parseChangelog, readReleases, historyCounts, readIncidentLog, verifyReceipt, verifyCommands, RELEASES_SINCE } from "@/lib/burnticker/history";
import { RELEASE_LINES, CHANGELOG_COPY, INCIDENTS_COPY, CAUGHT_EARLY, BOUNTY_COPY, VERIFY_YOURSELF_COPY, HISTORY_COPY, historyCountsLine, SECURITY_CONTACT } from "@/lib/burnticker/historyCopy";
import { LEARN_NAV, SITE_TABS, SITE_ICONS, HERO } from "@/lib/burnticker/siteNav.mjs";
import { STATIC_PAGES } from "@/lib/burnticker/sitemap";
import { PUBLIC_REPO_URL } from "@/lib/burnticker/currentStatusLinks";
import { lintCopy, loadCopyLintConfig, formatHits } from "@/lib/launch/copyLint";

const ROOT = path.join(import.meta.dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const cfg = loadCopyLintConfig(ROOT);
const clean = (t: string, what: string) => { const r = lintCopy(t, cfg); assert.ok(r.ok, `${what}: ${t}\n${formatHits(r)}`); };
const strings = (o: unknown): string[] => typeof o === "string" ? [o] : Array.isArray(o) ? o.flatMap(strings) : o && typeof o === "object" ? Object.values(o).flatMap(strings) : [];

describe("item 1: the changelog page is built from docs/burnticker/CHANGELOG.md", () => {
  test("every publish entry is a release, oldest first, with one plain line per change", () => {
    const md = read("docs/burnticker/CHANGELOG.md");
    const rel = parseChangelog(md);
    assert.equal(rel.length, (md.match(/^## \d{4}-\d{2}-\d{2} — publish from [0-9a-f]{12}\s*$/gm) ?? []).length);
    assert.equal(rel[0].date, "2026-10-10"); assert.deepEqual(rel[0].lines[0], RELEASE_LINES.first);
    for (let k = 1; k < rel.length; k++) assert.ok(rel[k - 1].date <= rel[k].date, "sorted by date");
    for (const r of rel) { assert.ok(r.lines.length > 0, r.source); for (const l of r.lines) clean(l, `release ${r.source}`); }
    assert.equal(readReleases(ROOT)!.length, rel.length);
  });
  test("the public commit is linked only when the changelog records it, at that commit", () => {
    const rel = parseChangelog(read("docs/burnticker/CHANGELOG.md"));
    const last = rel.find((r) => r.source === "7f8064b0a49a")!;
    assert.equal(last.publicCommit, "1f22d4ac38a218bc9afcf31e0c52628fda8fac9f");
    assert.equal(last.publicUrl, `${PUBLIC_REPO_URL}/tree/1f22d4ac38a218bc9afcf31e0c52628fda8fac9f`);
    assert.equal(rel.find((r) => r.source === "3d952cb3466c")!.publicCommit, null, "not recorded: not linked");
    const own = parseChangelog("## 2026-10-13 — publish from aaaaaaaaaaaa\n\n- monorepo commit: `a`\n- public commit: `bbbbbbb`\n- files published: 3\n");
    assert.equal(own[0].publicCommit, "bbbbbbb", "an entry's own public commit line");
  });
  test("plain lines: program, interface, allowlist, files, same source", () => {
    const base = { date: "2026-10-11", source: "a", publicCommit: null, publicUrl: null, programHash: "1".repeat(64), idlSha: "2".repeat(64), allowlistSha: "3".repeat(64), files: 10 };
    const [, b] = parseChangelog(`## 2026-10-11 — publish from aaaaaaaaaaaa\n- program hash: \`${"1".repeat(64)}\`\n- IDL sha256 (x): \`${"2".repeat(64)}\`\n- allowlist sha256 (y): \`${"3".repeat(64)}\`\n- files published: 10\n\n## 2026-10-12 — publish from bbbbbbbbbbbb\n- program hash: \`${"4".repeat(64)}\`\n- IDL sha256 (x): \`${"5".repeat(64)}\`\n- allowlist sha256 (y): \`${"6".repeat(64)}\`\n- files published: 9\n`);
    assert.deepEqual(b.lines, [RELEASE_LINES.program, RELEASE_LINES.idl, RELEASE_LINES.allowlist, "9 files were published, 1 fewer than the release before."]);
    void base;
  });
  test("the home status line carries the dated counts; the Trust page shows the latest three and the one history link", () => {
    const c = historyCounts(ROOT);
    assert.ok(c.releases! > 0); assert.deepEqual(Object.keys(c), ["releases"], "owner 2026-10-22: no review count");
    assert.equal(historyCountsLine({ releases: 68 }), "There have been 68 releases since Oct 10.");
    assert.equal(historyCountsLine({ releases: 1 }), "There has been 1 release since Oct 10.");
    assert.equal(historyCountsLine({ releases: null }), null);
    clean(historyCountsLine(c)!, "home counts");
    assert.equal(RELEASES_SINCE, "2026-10-10");
    const trust = read("src/app/burnticker/trust/page.tsx");
    assert.equal((trust.match(/href="\/burnticker\/history"/g) ?? []).length, 1, "one History link");
    assert.match(trust, /data-latest-releases/); assert.match(read("src/app/api/burnticker/trust/route.ts"), /readReleases\(\)\?\.slice\(-3\)\.reverse\(\)/);
  });
});

describe("item 2: the incident log page", () => {
  test("honest when empty, with the pre-launch catches as caught-before-it-mattered rows citing their write-up", () => {
    const log = readIncidentLog(ROOT);
    assert.equal(log.present, true);
    assert.equal(log.entries.length, (read("docs/burnticker/incidents/LOG.md").match(/^## /gm) ?? []).length);
    assert.deepEqual(CAUGHT_EARLY.map((c) => c.id), ["keeper-restart-loop", "status-file-404"]);
    for (const c of CAUGHT_EARLY) { assert.ok(fs.existsSync(path.join(ROOT, c.source)), c.source); for (const t of [c.title, c.happened, c.done]) clean(t, c.id); }
    const page = read("src/app/burnticker/incidents/page.tsx");
    assert.match(page, /INCIDENTS_COPY\.none/); assert.match(page, /href="\/status\/"/);
    assert.match(read("site/burnticker/status/index.html"), /href="https:\/\/burnticker\.com\/burnticker\/incidents">Incident log</);
  });
});

describe("item 3: security.txt and the bounty page", () => {
  test("RFC 9116 fields: contact, policy at the bounty page, canonical, expires about one year out", () => {
    const txt = read("site/burnticker/.well-known/security.txt");
    const f = Object.fromEntries(txt.trim().split("\n").map((l) => [l.slice(0, l.indexOf(":")), l.slice(l.indexOf(":") + 1).trim()]));
    assert.equal(f.Contact, `mailto:${SECURITY_CONTACT}`); assert.equal(f.Policy, "https://burnticker.com/burnticker/bounty");
    assert.equal(f.Canonical, "https://burnticker.com/.well-known/security.txt");
    const days = (Date.parse(f.Expires) - Date.parse("2026-10-12T00:00:00Z")) / 86_400_000;
    assert.ok(days > 360 && days <= 366, `Expires ${f.Expires}`);
    assert.match(read("config/public-repo/overlay/SECURITY.md"), new RegExp(SECURITY_CONTACT.replace(".", "\\.")), "SECURITY.md stays the source");
  });
  test("the bounty copy: lint-clean, empty history says so, payments posted in the report's thread", () => {
    for (const s of strings({ ...BOUNTY_COPY, range: BOUNTY_COPY.range(5, 10) })) clean(s, "bounty");
    assert.equal(BOUNTY_COPY.none, "No payouts yet."); assert.match(BOUNTY_COPY.paidRule, /posted in the report's thread/);
    assert.match(read("src/app/burnticker/bounty/BountyWallet.tsx"), /useJsonRead<Bounty>\("\/api\/burnticker\/v1\/bounty"\)/);
  });
});

describe("item 7: the verify-it-yourself walk-through (item 6, the press kit, left the site on 2026-10-22)", () => {
  test("press: no page, no nav entry, no sitemap entry", () => {
    assert.ok(!fs.existsSync(path.join(ROOT, "src/app/burnticker/press")));
    assert.ok(!LEARN_NAV.some((l) => l.href === "/burnticker/press")); assert.ok(!STATIC_PAGES.some((p) => p.path === "/burnticker/press"));
    assert.ok(HERO.title);
  });
  test("verify: the commands and expected outputs come from the featured receipt's evidence row and rules file", () => {
    const v = verifyReceipt(ROOT);
    const st = JSON.parse(read("config/burnticker/current-status.json")) as { demo: { evidence: string; recordDate: string } };
    const row = (JSON.parse(read(st.demo.evidence)) as { recordDate: string; status: string; memo: string; signature: string; units: number; verify: { expected: string } }[]).find((r) => r.recordDate === st.demo.recordDate && r.status === "confirmed")!;
    assert.equal(v.network, "devnet"); assert.equal(v.signature, row.signature); assert.equal(v.memo, row.memo);
    const c = Object.fromEntries(verifyCommands(v).map((x) => [x.id, x]));
    assert.match(c.tx.command, new RegExp(`getTransaction","params":\\["${row.signature}"`)); assert.match(c.tx.command, /api\.devnet\.solana\.com/);
    assert.equal(c.memo.expected, `Program log: Memo (len ${Buffer.byteLength(row.memo)}): "${row.memo}"`);
    assert.equal(c.units.expected, String(row.units));
    assert.equal(c.spend.expected, /rule spend (\d+) lamports/.exec(row.verify.expected)![1], "the arithmetic gives the receipt's own rule spend");
    assert.match(c.treasury.command, /^curl -s 'https:\/\/api\.fiscaldata\.treasury\.gov\//);
    for (const s of strings(VERIFY_YOURSELF_COPY)) clean(s, "verify");
  });
});

describe("item 8 and placement: nav, footer, sitemap; history two clicks deep, never on the home, coins or coin pages", () => {
  test("the Learn menu (and so the footer) lists the five pages; the sitemap lists every new page", () => {
    const learn = LEARN_NAV.map((l) => l.href);
    for (const h of ["/burnticker/changelog", "/burnticker/incidents", "/burnticker/bounty", "/burnticker/verify-yourself"]) { assert.ok(learn.includes(h), h); assert.ok(fs.existsSync(path.join(ROOT, `src/app${h}/page.tsx`)), h); }
    for (const h of ["/burnticker/changelog", "/burnticker/incidents", "/burnticker/bounty", "/burnticker/verify-yourself", "/burnticker/history"]) assert.ok(STATIC_PAGES.some((p) => p.path === h), h);
    assert.ok(!learn.includes("/burnticker/history"), "History sits behind the Trust page's link");
  });
  test("the home, coins and coin pages carry no history block or link", () => {
    for (const f of ["src/app/burnticker/page.tsx", "src/app/burnticker/CoinsIndex.tsx", "src/app/burnticker/t/[ticker]/page.tsx", "src/lib/burnticker/home.ts"])
      assert.doesNotMatch(read(f), /["'`]\/burnticker\/(changelog|incidents|history|press|bounty)\b/, f);
  });
  test("every sentence of the history pages' copy module passes the copy lint", () => {
    for (const s of strings({ CHANGELOG_COPY: { ...CHANGELOG_COPY, sinceLine: CHANGELOG_COPY.sinceLine(68, "Oct 10, 2026") }, INCIDENTS_COPY, HISTORY_COPY })) clean(s, "history copy");
    for (const n of [0, 1, 9]) clean(RELEASE_LINES.files(n, 5), "files line");
  });
});

describe("item 4: one icon set, the receipt mark in every empty state, tokens, motion and contrast", () => {
  test("the tab bar draws inline SVG icons from one set; no glyph characters", () => {
    for (const t of SITE_TABS) { assert.ok((SITE_ICONS as Record<string, string[]>)[t.icon]?.length, t.label); assert.ok(!("glyph" in t)); }
    assert.match(read("src/app/burnticker/_components/TabBar.tsx"), /<Icon name=\{t\.icon\} \/>/);
    assert.match(read("site/burnticker/index.html"), /<svg class="sh-icon" viewBox="0 0 24 24"/);
    assert.doesNotMatch(read("site/burnticker/index.html"), /[▦⌕⇄]/);
  });
  test("the empty state shows the receipt mark beside its heading and one sentence", () => {
    const src = read("src/app/burnticker/_components/EmptyState.tsx");
    assert.match(src, /<ReceiptMark size=\{compact \? 22 : 28\} \/>/);
  });
  test("tokens: one type scale, one spacing scale, one duration, a focus ring, and reduced motion honoured", () => {
    const css = read("config/public-repo/overlay/src/app/globals.css");
    for (const t of ["--bt-fs-xs", "--bt-fs-2xl", "--bt-sp-1", "--bt-sp-6", "--bt-dur", "--bt-focus", "--bt-radius"]) assert.match(css, new RegExp(`${t}:`), t);
    assert.match(css, /:focus-visible \{ outline: 2px solid var\(--bt-focus\)/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\n  \*, \*::before, \*::after \{ animation-duration: \.01ms !important/);
    assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ""), /transition:[^;]*\.\d+s/, "every transition uses --bt-dur");
    assert.match(read("docs/burnticker/ui-conventions.md"), /## Burnticker's own system/);
  });
  test("measured contrast: every text shade the pages use is at least 4.5:1 on the page and the panel, in both themes", () => {
    const css = read("config/public-repo/overlay/src/app/globals.css");
    const block = (sel: RegExp) => { const m = sel.exec(css); assert.ok(m, String(sel)); return Object.fromEntries([...m![1].matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6})/gi)].map((x) => [x[1], x[2]])); };
    const dark = { ...block(/@theme \{([\s\S]*?)\n\}/), ...block(/:root \{([\s\S]*?)\n\}/) };
    const light = { ...dark, ...block(/:root\[data-theme="light"\] \{([\s\S]*?)\n\}/) };
    const lum = (h: string) => { const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
    const ratio = (a: string, b: string) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    for (const [name, t] of [["dark", dark], ["light", light]] as const) for (const bg of ["--bt-bg", "--color-neutral-900", "--bt-counter"]) for (const fg of ["--color-neutral-200", "--color-neutral-300", "--color-neutral-400", "--color-neutral-500", "--bt-ink", "--bt-dim", "--bt-muted", "--bt-stamp"]) {
      const r = ratio(t[fg], t[bg]);
      assert.ok(r >= 4.5, `${name}: ${fg} on ${bg} is ${r.toFixed(2)}:1`);
    }
    assert.doesNotMatch(fs.readdirSync(path.join(ROOT, "src/app/burnticker"), { recursive: true }).filter((f) => String(f).endsWith(".tsx")).map((f) => read(`src/app/burnticker/${f}`)).join("\n"), /text-neutral-(6|7|8|9)00\b(?![^"]*bg-)/, "no text in a shade that fails 4.5:1");
  });
});

describe("How burns are settled (owner, 2026-10-12): every number derived from the code", () => {
  test("the facts come from pollMsFor, the program constants, UMA's window and the $DEFICIT rules file", async () => {
    const { settlementFacts } = await import("@/lib/burnticker/settlement");
    const { settlementSections, SETTLEMENT_LINK, SETTLEMENT_PATH, clockWords } = await import("@/lib/burnticker/settlementCopy");
    const { MIN_TWAP_WINDOW_SECS, MAX_TWAP_WINDOW_SECS } = await import("@/lib/burnReceipts/constants");
    const { UMA_DEFAULT_LIVENESS_S } = await import("@/lib/burnticker/sources/polyStated");
    const f = settlementFacts(ROOT);
    assert.deepEqual([f.marketPollMin, f.feedPollMin], [5, 60]);
    assert.deepEqual([f.guardMinMin, f.guardMaxMin, f.umaHours], [MIN_TWAP_WINDOW_SECS / 60, MAX_TWAP_WINDOW_SECS / 60, UMA_DEFAULT_LIVENESS_S / 3600]);
    assert.equal((f as unknown as Record<string, unknown>).spendCapPct, undefined, "owner decision 2026-10-25: no per-run bound, so no spend cap figure");
    const rules = JSON.parse(read("config/burnkeeper/deficit.rules.json")) as { schedule: { polls: string[]; timeZone: string } };
    assert.deepEqual(f.deficitReads, rules.schedule.polls); assert.equal(clockWords("16:30"), "4:30 p.m."); assert.equal(clockWords("09:05"), "9:05 a.m.");
    const c = settlementSections(f);
    for (const s of [c.intro, ...c.sections.flatMap((x) => [x.heading, ...x.paragraphs])]) clean(s, "settlement");
    assert.doesNotMatch(JSON.stringify(c), /\bwill\b|\bprice/i);
    assert.match(JSON.stringify(c), /about 5 to 25 minutes/);
    const wp = read("docs/burnticker/WHITEPAPER.md"); const sec = wp.slice(wp.indexOf("### 3.5 How burns are settled"), wp.indexOf("## 4. Settlement on chain"));
    for (const n of [`every ${f.marketPollMin} minutes`, `every ${f.feedPollMin} minutes`, `${f.guardMinMin} to ${f.guardMaxMin} minutes`, "spends the rule's full share of the burn pool in one run", `about ${f.umaHours} hours`, "4:30 p.m. and 8:00 p.m."]) assert.ok(sec.includes(n), n);
    assert.ok(sec.includes(`https://burnticker.com${SETTLEMENT_PATH}`)); assert.match(read("site/burnticker/whitepaper.html"), /3\.5 How burns are settled/);
    assert.ok(LEARN_NAV.findIndex((l) => l.href === SETTLEMENT_PATH) === LEARN_NAV.findIndex((l) => l.label === "Docs and API") + 1);
    assert.match(read("src/app/burnticker/t/[ticker]/page.tsx"), /label: nextRow\.label[^\n]*more: SETTLEMENT_LINK \}/); assert.equal(SETTLEMENT_LINK.href, SETTLEMENT_PATH);
  });
});

describe("website-17's wiring, applied by website-16 (WIRING-17.md items 1 to 5)", () => {
  test("coin page: Created by link, the rank line from the creator summary, the Share block instead of the embed box", () => {
    const page = read("src/app/burnticker/t/[ticker]/page.tsx");
    assert.match(page, /href=\{creatorHref\(s\.addresses\.creator\)\} data-created-by>\{createdBy\(shortAddress\(s\.addresses\.creator\)\)\}/);
    assert.match(page, /fetch\(`\/burnticker\/creator\/\$\{encodeURIComponent\(c\)\}\/summary`\)/); assert.match(page, /\{rank && <p [^>]*data-rank title=\{RANK_MEANING\}>\{rank\}<\/p>\}/);
    assert.match(page, /<ShareBlock ticker=\{s\.ticker\} id=\{key\} \/>/);
  });
  test("cards print the rank under Burned (no new row); the tokens and home routes fill it with rankLines", () => {
    assert.match(read("src/app/burnticker/_components/CoinCard.tsx"), /<Cell v=\{v\} c=\{v\.burned\} \/>\{v\.rank && <span [^>]*data-rank title=\{RANK_MEANING\}>\{v\.rank\}<\/span>\}/);
    for (const f of ["src/app/api/burnticker/tokens/route.ts", "src/app/api/burnticker/home/route.ts"]) assert.match(read(f), /rankLines\(leagueData\(p, now\)\.coins\)/, f);
  });
  test("home grid: the earned slots lead the public cards with their labels; the rules line once above the grid", () => {
    assert.match(read("src/app/api/burnticker/home/route.ts"), /featuredSlots: slots/);
    const idx = read("src/app/burnticker/CoinsIndex.tsx");
    assert.match(idx, /tags: \[\{ label: slots\[k\]\.label, tone: "featured" as const \}, \.\.\.v\.tags\]/);   // prelaunch audit 2026-10-18 A-2: matched by mint assert.equal((idx.match(/\{FEATURED_RULES_LINE\}/g) ?? []).length, 1);
  });
  test("launch page: the benefits list and the example tickets after the onboarding block; Coin vs Coin searches every asset", () => {
    const launch = read("src/app/burnticker/launch/page.tsx");
    assert.ok(launch.indexOf("<CreatorOnboarding />") < launch.indexOf("<CreatorBenefitsList />") && launch.indexOf("<CreatorBenefitsList />") < launch.indexOf("<ExampleTickets site="));
    assert.match(read("src/app/burnticker/launch/CoinVsCoinTile.tsx"), /derby\/search\?q=\$\{encodeURIComponent\(s\)\}&assets=all/);
  });
});
