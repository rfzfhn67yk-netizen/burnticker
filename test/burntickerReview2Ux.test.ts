// REVIEW 2 §2/§3 (ChatGPT/Codex, 2026-10-11) — the live-site cuts: one launch-availability state (no launch CTA while creator launches
// are closed), one served $DEFICIT destination, no green badge over zero receipts, the trust page's contradictions (host wiring vs chain
// deployment vs compiled value; no scheduled second attester; the shipped Powers Register recognised; systemd units "supplied, installation
// not verified"; the one-shot end is the onEnd schedule), the fee ledger's provenance, the status page's unknown state, the operator page's
// signing steps moved to the runbook, and the league pages' team names.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { auditBadgeView, NO_RECEIPTS_TO_CHECK } from "@/lib/burnticker/auditBadge";
import { buildPlatformIndex, renderPlatformIndexHtml } from "@/lib/burnticker/tokenPage";
import { closedHostLine, DEFICIT_SITE, deficitHref, launchAvailability, launchAvailabilityFromCatalogue, LAUNCH_AVAILABILITY_UNKNOWN } from "@/lib/burnticker/creatorLaunches";
import { NAV } from "../src/app/burnticker/_components/nav.ts";
import { loadPowersRegister, programFacts } from "@/lib/burnticker/trust";
import { attesterStatusLine } from "@/lib/burnticker/fees";
import { LEDGER_COPY } from "@/lib/burnticker/trustpack/copy";
import { teamsOf, type LeagueId } from "@/lib/burnticker/sources/espn";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import { GLOSSARY, NO_WALLET_LINE, termLine, type TermId } from "@/lib/burnticker/glossary";

const ROOT = path.join(import.meta.dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const lint = (t: string) => lintCopy(t, loadCopyLintConfig()).hits.map((h) => `${h.phrase}:${h.rule}`);
const transparency = JSON.parse(read("config/burnticker/transparency.json")) as { limitations: { id: string; status: string; text: string }[] };
const lim = (id: string) => transparency.limitations.find((l) => l.id === id)!;

describe("review 2 — one launch-availability state", () => {
  test("from the catalogue: only an explicit launches.creators true opens; unknown or unreadable is closed; the closed line names the cluster", () => {
    assert.equal(launchAvailabilityFromCatalogue({ launches: { creators: true }, cluster: "devnet" }).open, true);
    for (const j of [null, {}, { launches: {} }, { launches: { creators: "true" } }, { launches: { creators: false } }]) assert.equal(launchAvailabilityFromCatalogue(j).open, false, JSON.stringify(j));
    assert.equal(LAUNCH_AVAILABILITY_UNKNOWN.open, false);
    assert.equal(closedHostLine("devnet"), "Creator launches are closed. This host currently shows devnet information.");
    assert.equal(launchAvailability({}).open, false, "default off");
    assert.equal(launchAvailability({ BURNTICKER_CREATOR_LAUNCHES_ENABLED: "1" }).open, true);
    assert.deepEqual(lint(closedHostLine("devnet")), []);
  });

  test("every launch CTA on the app's pages renders only while launches are open", () => {
    const cases: [string, RegExp[]][] = [
      ["src/app/burnticker/page.tsx", [/\{launch\.open && <Link href="\/burnticker\/launch" className="bt-launch-btn">Launch a coin<\/Link>\}/, /\{launch\.open && <div className="mt-3"><Link href="\/burnticker\/launch" className="underline">Launch the first one →<\/Link><\/div>\}/, /\{launch\.open && <> <Link className="underline" href="\/burnticker\/launch\?pair=1">/]],
      ["src/app/burnticker/leagues/[league]/[season]/page.tsx", [/\{launch\.open && <Link className="text-xs underline" href=\{t\.launchHref\}>/, /\{launch\.open && <Link className="underline" href=\{t\.launchHref\}>/, /No team-coin receipts for this season yet\. This page tracks processed coin receipts, not every game\.\{launch\.open \? " Pick a team below to launch one\." : ""\}/]],
      ["src/app/burnticker/templates/page.tsx", [/\{launch\.open && <Link className="mt-auto pt-3 text-sm font-medium text-amber-300 underline" href=\{t\.href\}>Start from this →<\/Link>\}/]],
      ["src/app/burnticker/t/[ticker]/page.tsx", [/\{launch\.open && <p><Link [^>]*href=\{likeHref\(s\.ticker\)\}>Launch one like this →/]],
      ["src/app/burnticker/p/[pairId]/page.tsx", [/\{launch\.open && <p className="mt-1"><Link [^>]*href=\{likeHref\(A\)\}>Launch a pair like this →/]],
      ["src/app/burnticker/rivalries/page.tsx", [/\{launch\.open \? <> A team coin is launched from the <Link/]],
    ];
    for (const [file, res] of cases) { const src = read(file); for (const re of res) assert.match(src, re, `${file}: ${re}`); }
    // no ungated "Pick a team below to launch one." / "Launch the first one" anywhere in the app
    for (const file of ["src/app/burnticker/page.tsx", "src/app/burnticker/leagues/[league]/[season]/page.tsx"]) assert.doesNotMatch(read(file), /yet\. Pick a team below to launch one\.<\/p>/);
  });
});

describe("review 2 — one served $DEFICIT destination", () => {
  test("the nav, the launch page's closed state and the coin page's not-registered state all use DEFICIT_SITE; no app link goes to /burnticker/t/DEFICIT", () => {
    assert.equal(DEFICIT_SITE, "https://deficit.burnticker.com/");
    assert.equal(deficitHref(false), DEFICIT_SITE); assert.equal(deficitHref(true), "/burnticker/t/DEFICIT");
    assert.equal(NAV.find((n) => n.label === "$DEFICIT")?.href, DEFICIT_SITE);
    assert.match(read("src/app/burnticker/launch/page.tsx"), /<a className="underline" href=\{DEFICIT_SITE\}>\$DEFICIT<\/a>/);
    const coin = read("src/app/burnticker/t/[ticker]/page.tsx");
    assert.match(coin, /\/no token\/i\.test\(err\) \? <NotRegistered ticker=\{ticker\} \/>/);
    assert.match(coin, /t === "DEFICIT" \? <p><a className="underline" href=\{DEFICIT_SITE\}>The \$DEFICIT page<\/a> is served on its own site until the coin is registered here/);
    for (const f of ["src/app/burnticker/launch/page.tsx", "src/app/burnticker/page.tsx", "src/app/burnticker/_components/nav.ts"]) assert.doesNotMatch(read(f), /href="\/burnticker\/t\/DEFICIT"/, f);
  });
});

describe("review 2 — no trust badge over an empty audit", () => {
  test("zero receipts reads 'No receipts available to check on this host' (neutral), on the coins page and the static index; a real run keeps its result", () => {
    const empty = auditBadgeView({ ok: true, receipts: 0, mismatches: 0, chainChecked: false });
    assert.deepEqual([empty.text, empty.tone], [NO_RECEIPTS_TO_CHECK, "muted"]);
    assert.equal(auditBadgeView({ ok: true, receipts: 4, mismatches: 0, chainChecked: true }).tone, "ok");
    assert.equal(auditBadgeView({ ok: false, receipts: 4, mismatches: 1, chainChecked: true }).text, "1 mismatch(es)");
    assert.equal(auditBadgeView(null).text, "not run yet");
    const html = renderPlatformIndexHtml(buildPlatformIndex([], Date.parse("2026-10-11T00:00:00Z"), { ok: true, ranAt: "2026-10-11T00:00:00Z", receipts: 0, mismatches: 0, chainChecked: false }));
    assert.match(html, /No receipts available to check on this host/);
    assert.doesNotMatch(html, /all receipts recompute/);
    assert.match(read("src/app/burnticker/page.tsx"), /\["Public audit", audit\.text\]/);
  });
});

describe("review 2 — trust page: current facts, no contradictions", () => {
  test("the shipped Powers Register is recognised (no 'placeholder until … ships'): the privileged instructions and the upgrade authority", () => {
    const reg = loadPowersRegister({}, ROOT);
    assert.equal(reg.placeholder, false);
    const ids = reg.powers.map((p) => p.id);
    for (const id of ["propose_attesters", "renounce_admin", "set_registration_policy", "program-upgrade-authority"]) assert.ok(ids.includes(id), id);
    assert.equal(reg.powers.filter((p) => p.source.includes("instructions.")).length, 10, "the register's ten privileged instructions");
    assert.doesNotMatch(read("src/app/burnticker/trust/page.tsx"), /placeholder until/);
  });
  test("program: this host's wiring, the chain deployment and the compiled value are three separate labels", () => {
    const p = programFacts({}, ROOT);
    assert.match(p.hostWiring, /^this host is not wired to a burn_receipts program/);
    const br = p.chain.find((c) => c.library === "burn_receipts")!;
    assert.match(br.devnet, /^deployed/); assert.equal(br.mainnet, "not deployed");
    assert.match(p.compiled, /^burn_receipts AuQjoSgq7upmyPBv2itwy2TSZ1VjoVipyy4z9wd7zhMM/);
    assert.ok(!p.verify.some((v) => /not deployed yet/.test(v)), "no 'not deployed' line on a host that is merely not wired");
    const page = read("src/app/burnticker/trust/page.tsx");
    assert.doesNotMatch(page, /"not deployed"\}/);
    for (const s of ["This host:", "On chain —", "Compiled value:"]) assert.ok(page.includes(s), s);
  });
  test("attesters: the present fact, no scheduled second attester; systemd: supplied, installation not verified; one-shot: the onEnd schedule", () => {
    const a = attesterStatusLine(Date.parse("2026-10-07T00:00:00Z")).line;
    assert.equal(a, "One operator attester is configured; no independent second attester is live. Quorum 1.");
    assert.doesNotMatch(a, /Switchboard|scheduled/);
    assert.doesNotMatch(lim("switchboard-down").text, /schedule/);
    assert.equal(lim("no-systemd-unit").status, "units supplied; installation on this host not verified");
    assert.match(lim("no-systemd-unit").text, /mct-burnticker-keeper\.service/);
    for (const u of ["mct-burnticker-keeper.service", "mct-burnticker-audit.timer"]) assert.ok(fs.existsSync(path.join(ROOT, "deploy/systemd", u)), u);
    assert.doesNotMatch(lim("one-shot").text, /supply is fixed/);
    assert.match(lim("one-shot").text, /onEnd schedule/);
    for (const id of ["switchboard-down", "no-systemd-unit", "one-shot"]) assert.deepEqual(lint(lim(id).text), [], id);
  });
  test("fee ledger: no universal provenance claim; each block names its source", () => {
    assert.doesNotMatch(LEDGER_COPY.intro, /Nothing on this page comes from our own records/);
    assert.match(LEDGER_COPY.intro, /Each block names where its data comes from/);
    assert.match(LEDGER_COPY.incomeTitle, /from chain/); assert.match(LEDGER_COPY.entriesTitle, /from chain/);
    assert.match(LEDGER_COPY.expensesSource, /operator-entered/);
    assert.match(read("src/app/burnticker/fees/ledger/page.tsx"), /\{LEDGER_COPY\.expensesSource\}/);
  });
  test("status and fallback pages: an unreadable status file stays unknown — no 'unaffected'", () => {
    const st = read("site/burnticker/status/index.html");
    assert.match(st, /status\.json could not be read \(" \+ e\.message \+ "\)\. Current automation status is unavailable\."/);
    assert.doesNotMatch(st, /unaffected/);
    assert.doesNotMatch(read("site/burnticker/fallback/index.html"), /unaffected/);
  });
  test("operator page: the 'not signed yet' fact stays; the signing steps live in the runbook", () => {
    const op = JSON.parse(read("config/burnticker/operator.json")) as { signedMessage: { how: string } };
    assert.doesNotMatch(op.signedMessage.how, /sign-offchain-message|signMessage|Phantom/);
    assert.match(op.signedMessage.how, /docs\/burnticker\/runbook\.md/);
    assert.match(read("docs/burnticker/runbook.md"), /## Signing the operator statement[\s\S]*solana sign-offchain-message/);
  });
});

describe("review 2 — team names on the league pages", () => {
  test("no 'Chicago C Cubs' / 'Athletics Athletics': the disambiguating letter is dropped and a city equal to the nickname is not repeated", () => {
    const names = (["mlb", "nba", "nfl", "nhl"] as LeagueId[]).flatMap((l) => teamsOf(l).map((t) => t.name));
    for (const n of names) {
      assert.doesNotMatch(n, /\s[A-Z]{1,2}\s/, n);
      const w = n.split(" ");
      assert.ok(!(w.length === 2 && w[0] === w[1]), n);
    }
    for (const n of ["Athletics", "Chicago Cubs", "Chicago White Sox", "Los Angeles Angels", "Los Angeles Dodgers", "New York Mets", "New York Yankees"]) assert.ok(names.includes(n), n);
  });
});

describe("review 2 — the glossary at first use", () => {
  test("one short plain sentence per term, lint-clean; a one-line note, not a paragraph", () => {
    const ids = Object.keys(GLOSSARY) as TermId[];
    assert.deepEqual(ids.sort(), ["attester", "burn", "burnPool", "feeKey", "graduation", "keeper", "lockedLp", "receipt", "windDown"]);
    for (const id of ids) {
      const s = GLOSSARY[id].short;
      assert.deepEqual(lint(s), [], id);
      assert.ok(s.length <= 170 && (s.match(/\. /g) ?? []).length === 0, `${id}: one sentence, short (${s.length})`);
    }
    assert.equal(GLOSSARY.graduation.term, "moved to trading pool"); assert.equal(GLOSSARY.keeper.term, "automation");
    assert.deepEqual(lint(NO_WALLET_LINE), []);
  });
  test("placed where the terms first appear: the landing hero, the coins page, the trust page header, both pair pages; the no-wallet line beside every scoreboard", () => {
    const home = read("site/burnticker/index.html");
    const dl = /<dl class="terms"[^>]*data-glossary>([\s\S]*?)<\/dl>/.exec(home)![1];
    for (const id of ["burn", "receipt", "burnPool", "attester", "lockedLp", "keeper"] as TermId[]) assert.ok(dl.includes(`<dt>${GLOSSARY[id].term}</dt> <dd>— ${GLOSSARY[id].short}</dd>`), id);
    assert.ok(dl.includes(NO_WALLET_LINE));
    assert.ok(home.indexOf("data-glossary") < home.indexOf('<div class="tape"'), "in the hero, before the tape");
    const coins = read("src/app/burnticker/page.tsx");
    assert.match(coins, /<Term id="burn">burns<\/Term>/); assert.match(coins, /<Term id="receipt" \/>/);
    assert.match(coins, /label: "Moved to trading pool", hint: GLOSSARY\.graduation\.short/);
    assert.match(read("src/app/burnticker/trust/page.tsx"), /<TermNote ids=\{\["burnPool", "attester", "lockedLp", "feeKey", "keeper", "windDown"\]\} \/>/);
    const pair = read("src/app/burnticker/p/[pairId]/page.tsx");
    assert.match(pair, /<TermNote ids=\{\["receipt", "burnPool"\]\} \/>/); assert.match(pair, /\{NO_WALLET_LINE\}/);
    assert.match(read("src/lib/burnticker/tokenPage.ts"), /\$\{esc\(NO_WALLET_LINE\)\} \$\{esc\(termLine\(\["receipt", "burnPool"\]\)\)\}/);
    assert.ok(termLine(["receipt"]).startsWith("receipt — "));
    for (const f of ["src/app/burnticker/derby/page.tsx", "src/app/burnticker/leagues/[league]/[season]/page.tsx", "src/app/burnticker/rivalries/page.tsx", "src/app/burnticker/page.tsx"]) assert.match(read(f), /\{NO_WALLET_LINE\}/, f);
  });
});
