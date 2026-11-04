// SIXTH-PASS AUDIT, THE REMAINING OPS AND COPY ITEMS (2026-10-19; docs/burnticker/audits/continuous/bugs.md HB-69, HB-70 and
// suggestions HS-20, HS-24, HS-25). One check per item: source checks where the fix is wiring, pure helpers where it is words, the
// gate's glob coverage over every burnticker test, and the copy lint on every new public sentence. Files that live only in the
// monorepo are read through `mono()`, which skips when they are absent (the public tree).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { lintCopy, loadCopyLintConfig, formatHits } from "@/lib/launch/copyLint";
import { SECOND_SIGNER_LINE } from "@/lib/burnticker/fees";
import { operatorAloneUpgradeLine } from "@/lib/burnticker/currentStatusText";
import { registerPowersFromShipped } from "@/lib/burnticker/trust";
import { loadOperator, signedMessageView } from "@/lib/burnticker/trustpack/operator";
import { statementTemplate } from "@/lib/burnticker/trustpack/statement";
import { settingsLine } from "@/lib/burnticker/templates";
import { lookalikeRefusalsByField } from "@/lib/burnticker/lookalike";
import { IMAGE_HELP } from "@/lib/burnticker/creatorProfile";
import { buildLaunchReview } from "@/lib/burnticker/launchReview";
import { REAL_BURN_FAMILY_REFUSAL } from "@/lib/burnticker/burnRealEligibility";
import { firstPartyRule } from "@/lib/burnticker/wizard";
import { ON_END_DEFAULT } from "@/lib/burnticker/dials";
import type { BurnRule } from "@/lib/burnticker/rules";
import { pairForwardNote, pendingPairNoteForDisplay } from "@/lib/burnticker/pairReceiptNote";
import { DEFICIT_PAGE_TITLE, deficitPreview } from "@/lib/burnticker/sharePreview";
import { safeErrorText } from "@/lib/burnticker/api/errorText";
import { CONTACT_LINES, API_NOT_FOUND } from "@/lib/burnticker/contactCopy";
import { sitemapEntries } from "@/lib/burnticker/sitemap";
import { burnPoolNote } from "@/lib/burnticker/burnPoolWords";
import { INDEX_SERVE_MAX_AGE_MS, STALE_AFTER_MS, indexMemoTooOld } from "@/lib/burnticker/coinsGrid";
import { REREAD_MS } from "@/lib/burnticker/rereadCache";
import { outcomeLabelsNote } from "@/lib/burnticker/marketLabels";
import { dayText, visitorTime } from "@/lib/burnticker/visitorTime";
import { dataStateSentence } from "@/lib/burnticker/readiness";

const cfg = loadCopyLintConfig();
const clean = (t: string) => { const r = lintCopy(t, cfg); assert.ok(r.ok, `${t}\n${formatHits(r)}`); };
const read = (p: string) => fs.readFileSync(p, "utf8");
/** A file that exists only in the monorepo: its text, or null (the caller skips) where it is absent. */
const mono = (p: string): string | null => (fs.existsSync(p) ? read(p) : null);
/** TS7-2: a test file that reaches burnticker or launch code (by import or by naming a burnticker ops script). */
const touchesBurnticker = (src: string): boolean => /@\/lib\/burnticker|@\/app\/burnticker|@\/app\/api\/burnticker|@\/lib\/launch\/|src\/lib\/launch|scripts\/ops\/[^"' ]*burnticker/.test(src);
const BONK = { mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", pool: "HVNwzt7Pxfu76KHCMQPTLuTCLTm6WnQ1esLv4eizseSv", symbol: "BONK", feedId: "72b021217ca3fe68922a19aaf990109cb9d84e9ad004b4d2025ad6f529314419" };
const R5 = { BURNTICKER_CLUSTER: "mainnet", BURNTICKER_CREATOR_LAUNCHES_ENABLED: "1", BURNTICKER_INITIALIZE_TOKEN_LAYOUT: "r5" };

describe("HB-69 / HS-20: the second signer, the vault and the time lock, said as they are", () => {
  test("the keeper log line says the signer is advisory at quorum 1 and does not check pair coins (both keepers)", (t) => {
    const want = "(advisory at quorum 1: a disagreement holds the reading; if the signer cannot check or cannot be reached, the reading is sent on this key alone; pair coins are not checked)";
    for (const f of ["scripts/burnticker-keeper.mts", "scripts/burn-keeper.mts"]) {
      const s = mono(f); if (s === null) { t.diagnostic(`${f} absent`); continue; }
      assert.ok(s.includes(want), f); assert.doesNotMatch(s, /each reading is co-signed there or held/, f);
    }
    assert.doesNotMatch(read("src/lib/burnKeeper/cycle.ts"), /co-signed there before submit_reading, or held/);
  });
  test("the keeper unit no longer describes a FakeBurnProgram", (t) => {
    const s = mono("deploy/systemd/mct-burnticker-keeper.service"); if (s === null) return t.skip("unit absent");
    assert.match(s, /^Description=Burnticker multi-token keeper \(mainnet: signs readings with the platform keeper key, cranks burns, claims fees\)$/m);
    assert.doesNotMatch(s, /FakeBurnProgram/);
  });
  test("/v1/trust reads the time lock the same way the trust route does", () => {
    const v1 = read("src/lib/burnticker/api/v1.ts"), route = read("src/app/api/burnticker/trust/route.ts");
    const read1 = 'currentStatusLive().then((s) => s.upgradeAuthority.find((u) => u.cluster === "mainnet")?.timeLockSecs ?? null).catch(() => null)';
    assert.ok(v1.includes(read1) && route.includes(read1));
    assert.match(v1, /buildTrustPage\(\{[^}]*upgradeTimeLockSecs[^}]*skipFeeLedger: true \}\)/);
    assert.match(v1, /secondSigner: page\.secondSigner/);
  });
  test("the trust page's words: the second signer line and, at time lock 0, the operator-alone line in the upgrade row", () => {
    clean(SECOND_SIGNER_LINE);
    assert.match(SECOND_SIGNER_LINE, /advisory/); assert.match(SECOND_SIGNER_LINE, /does not check pair coins/); assert.match(SECOND_SIGNER_LINE, /cannot be reached/);
    const line = operatorAloneUpgradeLine(0)!;
    clean(line); assert.equal(line, "Two of the three Squads keys are the operator's, and the time lock is 0, so the operator alone can upgrade both programs at once today.");
    assert.equal(operatorAloneUpgradeLine(null), null); assert.equal(operatorAloneUpgradeLine(172_800), null);
    const rows = registerPowersFromShipped({ schema: "burn-receipts.powers-register/v1", instructions: [], upgrade_authority: { power: "upgrade" } } as never, 0) ?? [];
    assert.ok(rows.find((r) => r.id === "program-upgrade-authority")?.canDo.includes(line));
    assert.match(read("src/app/burnticker/trust/page.tsx"), /\{t\.secondSigner\}/);
  });
  test("the operator statement: the text is pinned; a dated clarification sits beside it and is shown", () => {
    const op = loadOperator();
    // publish 112 (2026-10-21): the text now names both disclosed tests ($REHEARSAL and the $SEAWIN test purchase and sale), so it is a
    // template again until the owner re-signs it; change this pin only together with the text
    const tpl = statementTemplate(op.signedMessage);
    assert.ok("template" in tpl, "the statement has a template");
    assert.equal(crypto.createHash("sha256").update(tpl.template).digest("hex"), "1066ddd68b7843847402ee8cd821cf724c1a13d059447dc8fa76269ed8d1ba06", "the statement text must not change unnoticed");
    const v = signedMessageView(op);
    assert.equal(v.clarification?.date, "2026-10-19");
    clean(v.clarification!.text); assert.match(v.clarification!.text, /not part of it/); assert.match(v.clarification!.text, /does not check pair coins/);
    assert.match(read("src/app/burnticker/operator/page.tsx"), /data-statement-clarification/);
  });
});

describe("HB-70: the smaller sixth-pass items", () => {
  test("WZ6-3: the one-shot settings line and the review's preset line name 50% where dispersal runs", () => {
    assert.equal(settingsLine({ shape: "one-shot", id: "x", type: undefined } as never), "It burns once, using the whole pool.");
    const d = settingsLine({ shape: "one-shot", id: "x", type: undefined } as never, { dispersal: true });
    assert.equal(d, "It burns once. You pick 100% or 50% of the pool."); clean(d);
    assert.match(read("src/lib/burnticker/launchReview.ts"), /presetRowLabel\(shareShapeOf\(locked\.rule, \{ dispersal: webDispersalOn\(env, o\.root\) \}\)\)/);
    assert.match(read("src/app/burnticker/templates/page.tsx"), /settingsLine\(t, \{ dispersal \}\)/);
  });
  test("WZ6-10: a reserved BURNTICKER ticker is not refused twice; the name's platform-name hit goes under the name", () => {
    const r = lookalikeRefusalsByField({ ticker: "BURNTICKER", name: "Burnticker coin" }, [], { tickerReserved: true });
    assert.deepEqual(r.map((x) => x.field), ["name"]);
    assert.match(r[0].reason, /The name uses the platform's name/); assert.doesNotMatch(r[0].reason, /The ticker uses/);
    assert.deepEqual(lookalikeRefusalsByField({ ticker: "BURNTICKER", name: "Plain" }, [], { tickerReserved: true }), []);
    assert.match(read("src/lib/burnticker/launchReview.ts"), /x\.code === "lookalike" && tickerReserved/);
  });
  test("WZ6-12: the image help says the 16 pixel minimum and what happens to an animated GIF", () => {
    assert.match(IMAGE_HELP, /at least 16 pixels on each side/); assert.match(IMAGE_HELP, /animated GIF is pinned as its first frame/); clean(IMAGE_HELP);
  });
  test("LA6-3: a refused earthquake-plus-BONK review has one problem, no pin step and no pin rent", () => {
    const rule = { ...firstPartyRule("usgs.quakes:6", 0.02), onEnd: { ...ON_END_DEFAULT }, burnTarget: BONK } as unknown as BurnRule;
    const r = buildLaunchReview({ ticker: "QUAKEX", name: "Quake X", rule } as never, { env: R5, reserved: new Set(), now: Date.parse("2026-08-01T12:00:00Z") });
    assert.ok("review" in r, "problems" in r ? r.problems.join(" | ") : "");
    assert.deepEqual(r.review.problems, [REAL_BURN_FAMILY_REFUSAL]);
    assert.deepEqual(r.review.pins, []);
    assert.ok(!r.review.transactions.steps.some((s) => /BONK/.test(s.label)), "no BONK pin step");
  });
  test("LA6-5: the catalogue's admission list no longer says 'not a disaster'", () => {
    const h = read("src/lib/burnticker/api/handlers.ts");
    assert.doesNotMatch(h, /"not a disaster"/);
    assert.match(h, /a natural disaster only as a count or size from the agency that measures it \(USGS, NHC, SPC, NIFC\), never on deaths, injuries or damage/);
  });
  test("CH6-11: pending-pair notes are conditional, name the void date and drop the counter prefix", () => {
    const lost = pairForwardNote({ role: "lost", what: "game", other: "DENWIN", voidBy: "2026-11-14", pending: true });
    assert.equal(lost, "If both coins have a pool by Nov 14, 2026, this coin's pool for this game moves to $DENWIN's burn pool and burns $DENWIN. If not, the pair is voided and nothing burns for this game.");
    clean(lost);
    const won = pairForwardNote({ role: "won", what: "game", other: "SEAWIN", voidBy: "2026-11-14", pending: true }); clean(won);
    assert.match(won, /^If both coins have a pool by Nov 14, 2026, \$SEAWIN's pool for this game moves to this coin's burn pool/);
    const old = "no change: no burn; carry reset. $DENWIN's team won the game. This coin's pool for the game moves to $DENWIN's burn pool and burns $DENWIN. The winner takes the burn.";
    const shown = pendingPairNoteForDisplay(old, { status: "pending-pair", pairRole: "lost", voidBy: "2026-11-14" })!;
    assert.ok(shown.startsWith("$DENWIN's team won the game. If both coins have a pool by Nov 14, 2026,"), shown);
    assert.equal(pendingPairNoteForDisplay(old, { status: "confirmed", pairRole: "lost", voidBy: "2026-11-14" }), old, "a settled receipt keeps its note");
    assert.match(read("src/lib/burnticker/multiKeeper.ts"), /pairForwardNote\(\{ role: "lost"/);
  });
  test("AP6-8: $DEFICIT has its own preview and an undoubled title; a decided coin's description reads its result", () => {
    const p = deficitPreview(); clean(p.title); clean(p.description);
    assert.equal(DEFICIT_PAGE_TITLE, "$DEFICIT · Burnticker");
    const l = read("src/app/burnticker/t/[ticker]/layout.tsx");
    assert.match(l, /key === "DEFICIT"/); assert.match(l, /title: \{ absolute: coinPageTitle\(ticker, l\) \}/);
    assert.match(read("src/lib/burnticker/sharePreviewServe.ts"), /rule: decidedLine\(d\) \?\?/);
  });
  test("AP6-11 / AP6-12: oracle search is rate limited; error text hides server paths", () => {
    assert.match(read("src/app/api/burnticker/oracle/search/route.ts"), /heavyRefusal\(req\)/);
    const e = safeErrorText(new Error("ENOENT: no such file or directory, open '/srv/app/shared/data/deficit/status.json'"));
    assert.doesNotMatch(e, /\/srv\/app/); assert.match(e, /ENOENT/);
    for (const f of ["src/app/api/burnticker/deficit-prelaunch/route.ts", "src/app/api/burnticker/swap-guard/route.ts"]) { const s = read(f); assert.match(s, /safeErrorText\(e/); assert.doesNotMatch(s, /\(e as Error\)\.message/); }
  });
  test("OP6-8: the log rotation state is seeded so the first run after an install (or a new log) rotates", (t) => {
    const unit = mono("deploy/systemd/mct-burnticker-logrotate.service"); if (unit === null) return t.skip("unit absent");
    assert.match(unit, /^ExecStartPre=\/bin\/sh %h\/meme-coin-trader\/scripts\/service\/seed-logrotate-state\.sh %h\/\.local\/state\/burnticker-logrotate\.status %h\/meme-coin-trader\/logs$/m);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bt-lr-")), logs = path.join(dir, "logs"), state = path.join(dir, "state", "lr.status");
    try {
      fs.mkdirSync(logs); fs.writeFileSync(path.join(logs, "a.log"), "x"); fs.writeFileSync(path.join(logs, "b.log"), "y");
      fs.mkdirSync(path.dirname(state)); fs.writeFileSync(state, `logrotate state -- version 2\n"${path.join(logs, "a.log")}" 2026-10-19-3:0:0\n`);
      const r = spawnSync("/bin/sh", ["scripts/service/seed-logrotate-state.sh", state, logs], { encoding: "utf8" });
      assert.equal(r.status, 0, r.stderr);
      const s = read(state);
      assert.ok(s.includes(`"${path.join(logs, "a.log")}" 2026-10-19-3:0:0`), "a named file is left alone");
      assert.ok(s.includes(`"${path.join(logs, "b.log")}" 2000-1-1-0:0:0`), "a file the state did not name is seeded old");
      spawnSync("/bin/sh", ["scripts/service/seed-logrotate-state.sh", state, logs]);
      assert.equal(read(state).split("b.log").length - 1, 1, "running again adds nothing");
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  test("OP6-11: alert lines, sitemap canonicals, pair share image, contact page, support redirect, JSON API 404", () => {
    assert.doesNotMatch(read("src/lib/burnticker/checkin.ts"), /not sent to Telegram/);
    const MINT = "J45hvYGcYBNmzxb6LG2PNeddAhzVGkBtvyYgdmG2XxUa";
    const locs = sitemapEntries({ origin: "https://burnticker.com", nowMs: Date.parse("2026-10-19T00:00:00Z"), coins: [{ ticker: "DENWIN", mint: MINT, status: "live" }] as never, pairs: [], seasonCoins: [] }).map((e) => e.loc);
    assert.ok(locs.includes(`https://burnticker.com/burnticker/t/${MINT}`)); assert.ok(!locs.includes("https://burnticker.com/burnticker/t/DENWIN"));
    assert.match(read("src/app/burnticker/p/[pairId]/layout.tsx"), /receiptCardPath\(s\.imageMint\)/);
    for (const l of CONTACT_LINES) clean(l);
    assert.match(read("src/app/burnticker/support/page.tsx"), /permanentRedirect\("\/burnticker\/contact"\)/);
    assert.equal(API_NOT_FOUND.code, "not-found"); clean(API_NOT_FOUND.error);
    assert.match(read("src/app/api/burnticker/[...missing]/route.ts"), /status: 404, headers: \{ "content-type": "application\/json/);
  });
  test("LD6-3 / HS-24: the burn pool row says what is spendable and what is waiting to be claimed", () => {
    const none = burnPoolNote({ feePdaSol: "0.02", spendableSol: "0", reserveSol: "0.02" });
    assert.equal(none, "SOL set aside for this coin's burns, all of it the fee reserve. Nothing is spendable until trading fees arrive."); clean(none);
    const some = burnPoolNote({ feePdaSol: "0.27", spendableSol: "0.25", reserveSol: "0.02", unclaimedSol: "0.2335" });
    assert.equal(some, "SOL set aside for this coin's burns. 0.25 SOL is spendable on burns, and 0.02 SOL stays as the fee reserve. 0.23 SOL of trading fees is waiting to be claimed into the burn pool."); clean(some);
    assert.doesNotMatch(read("src/app/burnticker/t/[ticker]/page.tsx"), /kept back for fees/);
  });
  test("LD6-4: the stale window follows the read cadence; the server rebuilds an old index first; plain Yes/No labels are dropped", () => {
    assert.ok(STALE_AFTER_MS >= REREAD_MS + INDEX_SERVE_MAX_AGE_MS + 45_000, "the window covers a reread, the server's keep and the CDN");
    assert.equal(indexMemoTooOld(8 * 60_000), true); assert.equal(indexMemoTooOld(30_000), false);
    // HB-145 (2026-10-20): the timer rebuilds the index behind the requests; a copy still too old is served at once, marked, never waited on
    assert.match(read("src/app/api/burnticker/tokens/route.ts"), /if \(indexMemoTooOld\(age\)\) return NextResponse\.json\(indexMemo\.body, \{ headers: \{ "cache-control": "no-store", "x-index-memo": "stale"/);
    assert.doesNotMatch(read("src/app/api/burnticker/tokens/route.ts"), /if \(indexMemoTooOld\(age\)\) await/);
    assert.equal(outcomeLabelsNote("Yes", "No"), ""); assert.equal(outcomeLabelsNote("Broncos", "Seahawks"), "(YES = Broncos, NO = Seahawks)");
  });
  test("TS7-2: the widened coverage rule finds a burnticker test by what it imports, not by its name", () => {
    assert.equal(touchesBurnticker(`import { x } from "@/lib/burnticker/registry";`), true);
    assert.equal(touchesBurnticker(`import { y } from "@/app/api/burnticker/launch/route";`), true);
    assert.equal(touchesBurnticker(`import { lintCopy } from "@/lib/launch/copyLint";`), true);
    assert.equal(touchesBurnticker(`const s = read("scripts/ops/rollback-burnticker.sh");`), true);
    assert.equal(touchesBurnticker(`import { z } from "@/lib/sameOrigin";`), false);
  });
  test("TS6-4: the publish gate runs every burnticker test file, and the launch and ownerAction tests outside the name globs", (t) => {
    const sh = mono("scripts/ops/publish-and-deploy.sh"); if (sh === null) return t.skip("publish script absent");
    const globs = /^GLOBS="([^"]+)"/m.exec(sh)![1].split(/\s+/);
    const toRe = (g: string) => new RegExp(`^${g.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
    const covered = (f: string) => globs.some((g) => toRe(g).test(`test/${f}`));
    const files = fs.readdirSync("test").filter((f) => f.endsWith(".test.ts"));
    for (const f of files.filter((x) => x.startsWith("burnticker"))) assert.ok(covered(f), `${f} is outside the gate`);
    // TS7-2 (seventh pass): any test that reaches burnticker or launch code, whatever its name, runs in the gate
    for (const f of files.filter((x) => touchesBurnticker(read(`test/${x}`)))) assert.ok(covered(f), `${f} reaches burnticker code but is outside the gate`);
    // the eight files the sixth pass found outside the gate all run now (copyLint joined 2026-10-19 after its three "moon" failures were fixed)
    const EXCLUDED: Record<string, string> = {};
    for (const f of ["ownerAction", "copyLint", "dailyPost", "launchConfirmMessages", "launchPairKinds", "launchPlanAge", "btOpsPrivate", "postQueue"].map((x) => `${x}.test.ts`)) {
      if (!files.includes(f)) continue;
      assert.equal(covered(f), !EXCLUDED[f], `${f}: ${EXCLUDED[f] ?? "should be in the gate"}`);
    }
  });
  test("TS6-6 / TS6-7: the off-box script check skips by name; lint no longer applies the react-hooks rules to .cjs", (t) => {
    const t6 = read("test/burntickerOffboxPull.test.ts");
    assert.match(t6, /t\.skip\("the off-box pull script is not on this host/); assert.doesNotMatch(t6, /if \(!fs\.existsSync\(script\)\) return;/);
    const lint = mono("eslint.config.mjs"); if (lint === null) return t.diagnostic("eslint.config.mjs is monorepo-only");
    assert.match(lint, /files: \["\*\*\/\*\.\{js,jsx,mjs,ts,tsx,mts,cts\}"\],\n\s+rules: \{\n[\s\S]*?"react-hooks\/set-state-in-effect": "warn"/);
  });
});

describe("HS-25: one date helper for times a visitor reads", () => {
  test("client: the visitor's zone, named; server: UTC, named; a bare day stays a day", () => {
    assert.equal(visitorTime("2026-10-19T22:16:00Z", "client", { timeZone: "America/Denver" }), "Oct 19, 4:16 PM MDT");
    assert.equal(visitorTime("2026-10-19T22:16:00Z", "client", { timeZone: "Europe/London" }), "Oct 19, 11:16 PM GMT+1");
    assert.equal(visitorTime("2026-10-19T22:16:00Z", "server"), "Oct 19, 10:16 PM UTC");
    assert.equal(visitorTime("2026-11-14", "server"), "Nov 14, 2026"); assert.equal(dayText("2026-11-14"), "Nov 14, 2026");
    assert.equal(visitorTime(null, "client"), "—"); assert.equal(visitorTime("soon-ish", "client"), "soon-ish");
  });
  test("the coin list's stale line no longer says Denver time for every visitor", () => {
    const s = dataStateSentence("stale", "the coin list", { readAt: "2026-10-19T22:16:00Z" });
    assert.doesNotMatch(s, /Denver/); assert.match(s, /was last read on Oct 19, .* and may be out of date\.$/); clean(s);
  });
});
