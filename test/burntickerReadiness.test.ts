// READINESS (website follow-up 2026-10-11): one derivation of where a coin stands on the way to its burns — $DEFICIT cannot burn before
// graduation (crank_buyback requires TokenConfig.pool_verified; the LaunchLab curve graduates at 85 SOL raised; a seed gift does not
// count). Every state, the adapters, and the pages that show it.
import { PROGRESS_STEPS } from "@/lib/burnticker/progress";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { GRADUATION_SOL, READINESS_ORDER, readinessFromStatus, readinessOf, type ReadinessInput } from "@/lib/burnticker/readiness";
import { formatHits, lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";

const cfg = loadCopyLintConfig();
const clean = (t: string, what: string) => { const r = lintCopy(t, cfg); assert.ok(r.ok, `${what}:\n${formatHits(r)}`); };
const base: ReadinessInput = { launched: true, phase: "curve", raisedSol: 12.3456, graduationSol: 85, poolVerified: false, latest: null };

describe("readinessOf: one state per situation", () => {
  test("the facts it rests on: the coin's own raise in the launch bundle (default 85 SOL), pool_verified required by crank_buyback", () => {
    assert.equal(GRADUATION_SOL, 85);
    // website-14 (§75): the builder's raise is the coin's own preset (40 / 60 / 85), default LaunchLab's standard; the review reads the same function
    const lb = fs.readFileSync("src/lib/burnticker/launchBundle.ts", "utf8");
    assert.match(lb, /export const LAUNCHLAB_RAISE_LAMPORTS: bigint = STANDARD_RAISE_LAMPORTS;/); assert.match(lb, /totalFundRaisingB: raiseLamportsOf\(input\.raiseSol\),/);
    assert.match(fs.readFileSync("programs/burn-receipts/programs/burn_receipts/src/instructions/crank_buyback.rs", "utf8"), /require!\(c\.pool_verified, BurnError::PoolNotVerified\)/);
  });
  test("each of the seven states, in order", () => {
    const cases: [ReadinessInput, string, RegExp][] = [
      [{ ...base, launched: false }, "not-launched", /prepared but never signed, so nothing is on chain/],
      [base, "on-curve", /12\.35 of 85 SOL raised.*nothing can burn before the curve graduates.*seed gift/],
      [{ ...base, raisedSol: null, phase: null }, "on-curve", /could not read the curve, so the SOL raised is not shown/],
      // website-14 (§75): a raise this site did not read is never printed as a typed 85
      [{ ...base, graduationSol: undefined }, "on-curve", /^(?![\s\S]*85)[\s\S]*12\.35 SOL raised so far\. This site could not read the raise that completes the curve\./],
      [{ ...base, graduationSol: 40, phase: "graduated" }, "awaiting-registration", /The curve reached 40 SOL/],
      [{ ...base, phase: "graduated" }, "awaiting-registration", /register_pool/],
      [{ ...base, phase: "graduated", poolVerified: null }, "awaiting-registration", /could not read the program/],
      [{ ...base, poolVerified: true }, "awaiting-event", /No reading has been published since the pool was verified/],
      [{ ...base, poolVerified: true, latest: { status: "nothing", units: 0, skippedReason: null, waitReason: null, readingDate: "2026-10-20" } }, "awaiting-event", /counted no units/],
      [{ ...base, poolVerified: true, latest: { status: "skipped", units: 2, skippedReason: "the program's spend was under its floor (5000000 lamports) — nothing bought", waitReason: null } }, "below-floor", /spend floor/],
      [{ ...base, poolVerified: true, latest: { status: "planned", units: 3, skippedReason: null, waitReason: "TwapDeviation: the spot pool moved more than 3% from its TWAP; retrying", } }, "deferred", /TwapDeviation/],
      [{ ...base, poolVerified: true, latest: { status: "confirmed", units: 3, skippedReason: null, waitReason: null, verified: true, checks: [], burned: "1000" } }, "burned", /Burned and verified|recompute/],
      [{ ...base, poolVerified: true, latest: { status: "confirmed", units: 3, skippedReason: null, waitReason: null, verified: false, checks: ["memo spent ≠ recorded spend"] } }, "burned", /does not match: memo spent/],
    ];
    for (const [inp, state, re] of cases) {
      const r = readinessOf(inp);
      assert.equal(r.state, state, JSON.stringify(inp)); assert.match(`${r.label} ${r.detail}`, re, state);
      assert.equal(r.step, READINESS_ORDER.indexOf(r.state) + 1);
      assert.doesNotMatch(r.detail, /^\s*0\s*$/); clean(`${r.label}. ${r.detail}`, state);
    }
    assert.equal(readinessOf(cases[11][0]).ok, true); assert.equal(readinessOf(cases[12][0]).ok, false);
    assert.equal(readinessOf({ ...base, poolVerified: true, latest: { status: "confirmed", units: 1, skippedReason: null, waitReason: null } }).label, "Burned, not yet rechecked", "never a bare tick");
    assert.equal(readinessOf({ ...base, poolVerified: null, latest: { status: "confirmed", units: 1, skippedReason: null, waitReason: null, verified: true, checks: [] } }).state, "burned", "a confirmed burn implies a verified pool");
  });
  test("readinessFromStatus reads the app's status.json: a draft is not launched; curve raised/threshold; the program's pool flag; the newest receipt", () => {
    assert.equal(readinessFromStatus({ status: "draft" }, []).state, "not-launched");
    const live = { status: "live", market: { phase: "curve" as const, curve: { raised: "40.5", threshold: "85" } }, program: { initialized: true, pool: { registered: false } } };
    assert.match(readinessFromStatus(live, []).detail, /40\.5 of 85 SOL raised/);
    const reg = { ...live, market: { phase: "graduated" as const, curve: null }, program: { initialized: true, pool: { registered: true } } };
    const rs = [{ status: "confirmed", units: 2, skippedReason: null, waitReason: null, settledAt: "2026-10-20T00:00:00Z", verify: { verified: true, checks: [] } }, { status: "planned", units: 4, skippedReason: null, waitReason: "pool not tradable", settledAt: "2026-10-21T00:00:00Z" }];
    assert.equal(readinessFromStatus(reg, rs).state, "deferred");
  });
});

describe("where the state is shown", () => {
  test("the coin page, the $DEFICIT pre-launch page, the keeper's status.json and the static $DEFICIT site", () => {
    const coin = fs.readFileSync("src/app/burnticker/t/[ticker]/page.tsx", "utf8");
    assert.match(coin, /const ready = readinessFromStatus\(/); assert.match(coin, /<ReadinessPanel r=\{ready\} /);
    assert.match(coin, /const preBurn = ready\.state === "on-curve" \|\| ready\.state === "awaiting-registration"/, "the coin page's 'burns begin after graduation' line follows the readiness state");
    const pre = fs.readFileSync("src/app/burnticker/t/[ticker]/DeficitPrelaunch.tsx", "utf8");
    // website-14: the keeper's own readiness (from its curve read) once its files are read; not launched otherwise
    assert.match(pre, /const r = d\.keeper\?\.readiness \?\? readinessOf\(\{ launched: false/); assert.match(pre, /<ReadinessPanel r=\{r\} /); assert.match(pre, /Nothing burns until the curve fills and the debt rises/);
    assert.match(fs.readFileSync("src/lib/burnKeeper/statusPage.ts", "utf8"), /readiness: \(\(\) => \{[\s\S]*readinessOf\(/);
    const site = fs.readFileSync("site/deficit/index.html", "utf8");
    assert.match(site, /id="readiness" data-readiness="not-launched"/); assert.match(site, /s\.readiness && s\.readiness\.label/);
    // website-15 item 6: the static count is the progress strip's six steps (progress.ts), the same numbering as the app
    assert.match(site, new RegExp(`" of ${PROGRESS_STEPS.length} toward a first burn`), "the static step count equals the progress strip's steps");
    assert.match(site, /Nothing burns until the curve fills and the debt rises/);
  });
});

describe("docs/burnticker/FIRST-BURN-PATH.md", () => {
  const doc = fs.readFileSync("docs/burnticker/FIRST-BURN-PATH.md", "utf8");
  test("ten steps from mint to receipt, each with the check that enforces it and the page that shows it", () => {
    const rows = doc.split("\n").filter((l) => /^\| \d+ \|/.test(l));
    assert.equal(rows.length, 10);
    for (const r of rows) assert.equal(r.split("|").length - 2, 4, r.slice(0, 40));
    for (const must of ["initialize_token", "85 SOL", "totalFundRaisingB", "register_fee_key", "register_pool", "PoolNotVerified", "QuorumNotMet", "spend floor", "TwapDeviation", "/burnticker/check"]) assert.ok(doc.includes(must), must);
    assert.match(doc, /\*\*Nothing burns until the curve fills and the debt rises\.\*\*/);
    assert.match(doc, /seed gift[^.]*does not count toward the curve's graduation/);
  });
  test("lint-clean prose; linked from the current-status source, the readiness panel and the static $DEFICIT site", async () => {
    clean(doc.replace(/`[^`]*`/g, " "), "FIRST-BURN-PATH.md");
    const { buildCurrentStatus } = await import("@/lib/burnticker/currentStatus");
    const s = buildCurrentStatus({ env: {}, chain: {}, now: 0 });
    assert.equal(s.firstBurnPath.doc, "docs/burnticker/FIRST-BURN-PATH.md"); assert.ok(s.lines.includes(s.firstBurnPath.line)); clean(s.firstBurnPath.line, "status line");
    const { FIRST_BURN_PATH_URL } = await import("@/lib/burnticker/currentStatusLinks");
    assert.ok(FIRST_BURN_PATH_URL.endsWith("/docs/burnticker/FIRST-BURN-PATH.md"));
    assert.ok(fs.readFileSync("site/deficit/index.html", "utf8").includes("docs/burnticker/FIRST-BURN-PATH.md"));
  });
});

describe("the launch-day post queue says nothing burns on launch day", () => {
  const LAUNCH_DAY_BURN = /\b(burns?|burned|burning)\b[^.\n·]{0,40}\b(today|tonight|on launch day|at launch|this evening)\b|first burn (today|tonight|at launch|on launch day)|launch(es)? and burns?/i;
  test("both launch threads carry the line; no launch thread or teaser implies a launch-day burn", async () => {
    const F = await import("./postQueueFixtures.ts");
    const pq = await import("@/lib/launch/postQueue");
    const facts = F.committedFacts();
    const d = pq.deficitLaunchThread(facts.deficit, F.FIXTURE_DEFICIT_SITE, "https://solscan.io/tx/LAUNCH").posts.join("\n");
    const p = pq.platformLaunchThread(facts.reviews, "https://burnticker.com").posts.join("\n");
    assert.equal(pq.NOTHING_BURNS_LINE, "Nothing burns until the curve fills and the debt rises");
    for (const t of [d, p]) { assert.ok(t.includes(pq.NOTHING_BURNS_LINE), t.slice(0, 60)); assert.doesNotMatch(t, LAUNCH_DAY_BURN); }
    assert.match(d, /graduates at 85 SOL raised/);
    for (const topic of pq.TEASER_TOPICS) { try { const t = pq.teaserDraft(topic, { site: "https://burnticker.com", reviews: facts.reviews, deficit: facts.deficit, devnet: facts.devnet, coverage: { settleable: 1, adjudicatedOnly: 1, uncovered: 1 } }).posts.join("\n"); assert.doesNotMatch(t, LAUNCH_DAY_BURN, topic); } catch (e) { if (!/needs/.test(String(e))) throw e; } }
  });
  test("docs/launch/x-threads.md: the $DEFICIT launch thread and the announcement thread say it; the worked day is labelled a replay", () => {
    const doc = fs.readFileSync("docs/launch/x-threads.md", "utf8");
    const s1 = doc.slice(doc.indexOf("## 1. $DEFICIT launch thread"), doc.indexOf("## 2. Burnticker announcement thread"));
    const s2 = doc.slice(doc.indexOf("## 2. Burnticker announcement thread"), doc.indexOf("## 2b."));
    for (const s of [s1, s2]) { assert.match(s, /Nothing burns until the curve fills and the debt rises/); assert.doesNotMatch(s, LAUNCH_DAY_BURN); }
    assert.match(s1, /a replayed day, before launch/); assert.match(s1, /graduates at 85 SOL raised/);
    assert.doesNotMatch(s1, /keeper's fee pool/, "the burn pool is the program's fee PDA, not the keeper's");
  });
});
