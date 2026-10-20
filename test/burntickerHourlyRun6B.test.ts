// HOURLY AUDIT 2026-10-19 18:10 DENVER, RUN 6, ADDENDUM (docs/burnticker/audits/continuous/bugs.md HB-90, HB-91, HB-25, HB-29 follow-up,
// HB-46, HB-47, HB-56, HB-59, HB-64, HB-67). One pure test or source check per fix, plus the copy lint on every new public sentence.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { lintCopy, loadCopyLintConfig, formatHits } from "@/lib/launch/copyLint";
import { deficitQueueCore } from "@/lib/burnticker/deficitQueueCore.mjs";
import { deficitQueue, readKeeperFiles } from "@/lib/burnticker/deficitQueue";
import { feeSplitSentence } from "@/lib/burnticker/fees";
import { LP_POLICY_LINE, LP_POLICY_LINE_BEFORE_GRADUATION, LP_POLICY_BADGE_BEFORE_GRADUATION, lpPolicyLineFor } from "@/lib/burnticker/lockFees";
import { timeLockPlanSentence } from "@/lib/burnticker/currentStatusText";
import { timeLockLine } from "@/lib/burnticker/currentStatus";
import { POWERS_REGISTER_WORDS, REFUSE_LIST_WORDS, TRANSPARENCY_FILE_WORDS, buildTransparency, mainnetTimeLockPlan, registerPowersFromShipped, teamWallets } from "@/lib/burnticker/trust";
import { GUARDRAIL_DETAIL } from "@/lib/burnticker/safeguards";
import { queuedBurnUnits } from "@/lib/burnticker/api/product";
import { pairCardLines, pairDecidedLine, renderPairBadgeSvg, type PairBadgeJson, type BadgeSide } from "@/lib/burnticker/badge";
import { ruleOneLiner } from "@/lib/burnticker/coinCard";
import { FEED_DOWN_FAILURES, FEED_RECOVERED_KIND, noteFeedRecoveries, outageDuration, type FeedHealth } from "@/lib/burnticker/ops/feedHealth";
import { PUSH_KIND_OF_ALERT } from "@/lib/burnticker/push";
import { CREATOR_PAGE } from "@/lib/burnticker/creatorBenefits";

const cfg = loadCopyLintConfig();
const clean = (s: string) => { const r = lintCopy(s, cfg); assert.ok(r.ok, `${s}\n${formatHits(r)}`); };
const read = (p: string) => fs.readFileSync(p, "utf8");
const NOW = Date.parse("2026-10-20T00:40:00Z");

/** A launched keeper status.json before graduation: Oct 9 baseline, latest reading Oct 16. */
const status = (o: { generatedAt?: string } = {}) => ({
  schema: "burnkeeper.status/v1", ticker: "DEFICIT", cluster: "mainnet", generatedAt: o.generatedAt ?? "2026-10-20T00:20:11Z",
  feed: { lastRecordDate: "2026-10-16", lastAmount: "38490030000000.00", baseline: { recordDate: "2026-10-09", amount: "38404000000000.00" } },
  buyback: { fractionPerUnit: "0.02" },
  curve: { threshold: "85" },
  program: { queue: { lastOnChain: "2026-10-16" }, pool: { registered: false, address: null } },
});
const burns = [
  { recordDate: "2026-10-13", status: "planned", units: 42 },
  { recordDate: "2026-10-15", status: "planned", units: 59 },
];

describe("HB-90: the $DEFICIT queue headline says what its two numbers are, and the time is the status file's write time", () => {
  test("daily rises since the baseline's own date add up to the units; the debt's change is measured from the same date", () => {
    const q = deficitQueueCore(status(), burns, NOW, "2026-10-20T00:35:02Z");
    assert.equal(q.units, 101);
    assert.equal(q.headline, "Daily rises since Oct 9 add up to 101 queued units ($1B each). The debt is $86.03 billion higher than on Oct 9.");
    assert.ok(q.lines.some((l) => /^The latest reading is the Treasury figure for 2026-10-16\. The keeper last wrote its status file at Oct 19, 6:35 PM Denver time\.$/.test(l)), q.lines.join("\n"));
    assert.doesNotMatch(q.headline + q.lines.join(" "), /since launch|published this/);
    for (const t of [q.headline, ...q.lines]) clean(t);
  });
  test("a write time that is not known drops the line; the static site (no write time passed) keeps the keeper's own stamp", () => {
    const unknown = deficitQueueCore(status(), burns, NOW, null);
    assert.ok(unknown.lines.some((l) => l === "The latest reading is the Treasury figure for 2026-10-16."), unknown.lines.join("\n"));
    assert.ok(!unknown.lines.some((l) => /keeper last wrote/.test(l)));
    const site = deficitQueueCore(status(), burns, NOW);
    assert.ok(site.lines.some((l) => /Oct 19, 6:20 PM Denver time/.test(l)));
    const stale = deficitQueueCore(status(), burns, NOW, Date.parse("2026-10-19T22:00:00Z"));
    assert.equal(stale.stale, true, "staleness follows the write time");
    assert.equal(deficitQueue({ status: status(), burns, error: null }, NOW).lines.some((l) => /keeper last wrote/.test(l)), false, "an in-memory object has no write time");
  });
  test("the app reads the write time from status.json itself", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bt-run6b-"));
    fs.writeFileSync(path.join(dir, "status.json"), JSON.stringify(status())); fs.writeFileSync(path.join(dir, "burns.json"), JSON.stringify(burns));
    const t = new Date("2026-10-20T00:35:02Z");
    fs.utimesSync(path.join(dir, "status.json"), t, t);
    const k = readKeeperFiles({ BURNKEEPER_PUBLISH_DIR: dir }, "/");
    assert.equal(k.writtenAt, "2026-10-20T00:35:02.000Z");
    assert.ok(deficitQueue(k, NOW).lines.some((l) => /6:35 PM Denver time/.test(l)));
  });
  test("the static $DEFICIT site carries the same function", () => {
    assert.ok(read("site/deficit/index.html").includes("\"Daily rises \" + sinceText"), "run scripts/burnticker-site-nav.mts --write");
  });
});

describe("HB-91: the whitepaper's Limitations describe the mainnet facts, and the status block is dated", () => {
  const md = read("docs/burnticker/WHITEPAPER.md");
  const limits = md.slice(md.indexOf("## 11. Limitations and risks"), md.indexOf("## 12."));
  test("no Limitations sentence says the rehearsal is pending or that LaunchLab ran only against a stand-in", () => {
    assert.doesNotMatch(limits, /run only against a stand-in|it is not done/);
    assert.match(limits, /have run on LaunchLab mainnet since 2026-10-11, first with the \$REHEARSAL coin/);
    assert.match(md, /\*\*Status on 2026-10-19\.\*\*/);
    assert.match(md, /\| Mainnet rehearsal coin \| done: \$REHEARSAL/);
    const t = JSON.parse(read("config/burnticker/transparency.json")) as { rehearsals: { symbol: string; date: string; mint: string }[] };
    const r = t.rehearsals.find((x) => x.symbol === "REHEARSAL")!;
    assert.ok(md.includes(r.mint) && md.includes(`on ${r.date} under the real platform settings`), "the row matches the transparency file");
  });
  test("HB-59: the wallet list names the trading-bot wallets with their one disclosed trade", () => {
    assert.match(md, /trading-bot\s+wallets on other machines\. Their only trade in a platform coin is the 0\.1 SOL of \$REHEARSAL/);
  });
});

describe("HB-56: the lock is said by the coin's own state", () => {
  test("before graduation the sentence and the line say the liquidity locks at graduation; after, that it is locked", () => {
    const before = feeSplitSentence("mainnet", null, { graduated: false });
    assert.match(before, /100% of the liquidity locks forever at graduation, and its fees fund the burn\./);
    assert.doesNotMatch(before, /is locked forever/);
    assert.match(feeSplitSentence("mainnet", null, { graduated: true }), /100% of the liquidity is locked forever/);
    assert.match(feeSplitSentence("mainnet", null, { tierUnread: true, graduated: false }), /locks forever at graduation/);
    assert.equal(lpPolicyLineFor(null), LP_POLICY_LINE_BEFORE_GRADUATION);
    assert.equal(lpPolicyLineFor(100), LP_POLICY_LINE);
    for (const t of [before, LP_POLICY_LINE_BEFORE_GRADUATION, LP_POLICY_BADGE_BEFORE_GRADUATION]) clean(t);
  });
  test("the token page passes the coin's lock state to both", () => {
    const src = read("src/lib/burnticker/tokenPage.ts");
    assert.match(src, /feeSplitSentence\(i\.chain\.cluster, i\.chain\.program\?\.config\?\.cpConfig, \{ tierUnread, graduated: lpLockedPct !== null \}\)/);
    assert.match(src, /lp: \{ \.\.\.lp, line: lpPolicyLineFor\(lpLockedPct\) \}/);
  });
});

describe("HB-59: one sentence and one source for the time-lock plan; the $REHEARSAL exception said once", () => {
  const plan = mainnetTimeLockPlan();
  test("the current-status line and the register's upgrade row say the plan in the same words, from current-status.json", () => {
    assert.ok(plan, "config/burnticker/current-status.json squads.mainnet");
    const sentence = timeLockPlanSentence(plan!.plannedSecs, plan!.plannedFrom);
    assert.equal(sentence, "The plan is 48 h from a week or more after the soft launch.");
    assert.ok(timeLockLine("mainnet", 0, plan!.plannedSecs, plan!.plannedFrom).endsWith(sentence));
    assert.ok(timeLockLine("mainnet", null, plan!.plannedSecs, plan!.plannedFrom).endsWith(sentence));
    const rows = registerPowersFromShipped({ schema: "burn-receipts.powers-register/v1", instructions: [], upgrade_authority: { power: "upgrade", holder_at_launch: "48 h planned from around 2026-10-23" } }, 0, plan)!;
    const up = rows.find((r) => r.id === "program-upgrade-authority")!;
    assert.equal(up.timelock, `The Squads 2-of-3 vault. Its time lock is 0 (none) today, read from chain. ${sentence}`);
    assert.doesNotMatch(up.timelock!, /2026-10-23/);
    clean(up.timelock!);
  });
  test("the guardrail before the exception no longer repeats it", () => {
    assert.doesNotMatch(GUARDRAIL_DETAIL["no team buy"].text, /REHEARSAL/);
    assert.match(GUARDRAIL_DETAIL["the platform buys no coin except one test coin"].text, /REHEARSAL/);
    clean(GUARDRAIL_DETAIL["no team buy"].text);
  });
});

describe("HB-46: the trust answers use public words; the file names stay on the public-repository links", () => {
  test("the powers register rows", () => {
    const rows = registerPowersFromShipped({ schema: "burn-receipts.powers-register/v1", roles: { admin: "Squads vault" }, instructions: [{ name: "propose_attesters", class: "privileged", signers: [{ role: "admin" }] }], external_powers: [{ power: "LaunchLab admin" }] })!;
    for (const r of rows) {
      assert.ok(r.source.startsWith(POWERS_REGISTER_WORDS), r.source);
      assert.doesNotMatch(r.source, /docs\/|\.json/);
      assert.match(r.sourceUrl!, /^https:\/\/github\.com\/.+\/blob\/[0-9a-f]{40}\/docs\/burn-receipts\/powers-register\.json$/);
    }
  });
  test("the refuse list, the transparency file and the bounty note", () => {
    const team = teamWallets({});
    assert.equal(team.ownTokensFile, REFUSE_LIST_WORDS); assert.match(team.ownTokensUrl, /\/config\/own-tokens\.json$/);
    const tr = buildTransparency(process.cwd(), {});
    assert.equal(tr.file, TRANSPARENCY_FILE_WORDS); assert.match(tr.fileUrl, /\/config\/burnticker\/transparency\.json$/);
    assert.equal(tr.whoRunsThis.refuseListConfig, REFUSE_LIST_WORDS); assert.match(tr.whoRunsThis.refuseListConfigUrl, /\/config\/own-tokens\.json$/);
    const bounty = (tr.howBuilt as unknown as { bounty: { howReportsArePaid: string } }).bounty.howReportsArePaid;
    assert.doesNotMatch(bounty, /config\//);
    const page = read("src/app/burnticker/trust/page.tsx");
    assert.match(page, /href=\{p\.sourceUrl\}/); assert.match(page, /href=\{t\.team\.ownTokensUrl\}/); assert.match(page, /href=\{x\.fileUrl\}/);
  });
});

describe("HB-64: a pair coin that lost queues no unit; the winner's receipt does", () => {
  test("queuedBurnUnits skips the losing side's pending-pair receipt", () => {
    assert.equal(queuedBurnUnits([{ status: "pending-pair", units: 1, pairRole: "lost" }]), 0);
    assert.equal(queuedBurnUnits([{ status: "pending-pair", units: 1, pairRole: "won" }]), 1);
    assert.equal(queuedBurnUnits([{ status: "planned", units: 2 }, { status: "confirmed", units: 5 }, { status: "sending", units: 1, pairRole: null }]), 3);
    const src = read("src/lib/burnticker/api/product.ts");
    assert.equal((src.match(/queuedBurnUnits\(rs\)/g) ?? []).length, 2, "both the loading row and the read row use it");
  });
});

describe("HB-47: the pair badge names both coins and the decided state, never the raw pair id", () => {
  const side = (ticker: string, decided: string | null): BadgeSide => ({ ticker, name: ticker, oneLiner: "burns if its team wins the one game", window: null, status: "live", lastBurn: null, receipts: { count: 0, label: "2026", recorded: 1 }, rulesSha12: ticker === "SEAWIN" ? "aaaaaaaaaaaa" : "bbbbbbbbbbbb", pageUrl: "", verifyUrl: "", decided });
  const pair = (a: BadgeSide, b: BadgeSide): PairBadgeJson => ({ schema: "burnticker.badge/v1", kind: "pair", generatedAt: "", pairId: "seawin-vs-denwin-espn-game-nfl-2475453-s", a, b, score: { a: 0, b: 0 }, nextSettlementAt: null, nextSettlementNote: "result decided", pageUrl: "", verifyUrl: "", badgeUrl: { svg: "", png: "", json: "" }, embedUrl: "", embed: { iframe: "", markdown: "", html: "" }, disclaimer: "", affiliation: "" } as unknown as PairBadgeJson);
  test("decided: winner and loser on the card", () => {
    const b = pair(side("SEAWIN", "Lost on Oct 15. This result cannot make $SEAWIN burn."), side("DENWIN", "Won on Oct 15. Burn runs once both coins graduate (by Oct 30)."));
    const L = pairCardLines(b);
    assert.equal(L.last, "$DENWIN won on Oct 15; $SEAWIN lost");
    assert.equal(L.foot, "rules sha256 aaaaaaaaaaaa and bbbbbbbbbbbb · burnticker");
    const svg = renderPairBadgeSvg(b);
    assert.doesNotMatch(svg, /seawin-vs-denwin|pair seawin/);
    assert.match(svg, /\$DENWIN won on Oct 15; \$SEAWIN lost/);
    for (const t of Object.values(L)) clean(t);
  });
  test("undecided: no decided line", () => {
    assert.equal(pairDecidedLine(side("A", null), side("B", null)), null);
    assert.equal(pairCardLines(pair(side("PITWIN", null), side("BALWIN", null))).last, "no burn yet");
  });
});

describe("HB-67: the next-earthquake one-liner names the earthquake", () => {
  test("plain English, no 'feed', a noun after the magnitude", () => {
    const rule = { oracle: "catalogue", series: "usgs.quakenext:6", kind: "scalar" } as unknown as Parameters<typeof ruleOneLiner>[0];
    const line = ruleOneLiner(rule, "The next reviewed magnitude 6 or more anywhere in the world (USGS)");
    assert.equal(line, "burns once, on the next reviewed earthquake of magnitude 6 or more anywhere in the world (USGS)");
    clean(line);
  });
});

describe("HB-29 follow-up: the end of a source outage is recorded, as information", () => {
  const h = (o: Partial<FeedHealth>): FeedHealth => ({ selectorKey: "catalogue:usgs.quakenext:6", tickers: ["NEXTM6"], state: "ok", why: "", lastOkAt: null, lastFetchAt: null, failures: 0, lastError: null, crossRead: { agreement: null, basis: "" }, staleness: { lastReadingId: null, lastReadingAt: null, ageMs: null, limitMs: null, stale: false }, ...o } as FeedHealth);
  const store = () => { const m = new Map<string, string>(); return { getStatus: (k: string) => m.get(k) ?? null, setStatus: (k: string, v: unknown) => { m.set(k, typeof v === "string" ? v : JSON.stringify(v)); } }; };
  test("down, then answering again: one bt-feed-recovered row with the failure count and the outage length", () => {
    const reg = store();
    const lastOk = Date.parse("2026-10-19T22:09:00Z");
    assert.deepEqual(noteFeedRecoveries(reg, [h({ state: "down", failures: FEED_DOWN_FAILURES, lastOkAt: lastOk, lastFetchAt: lastOk + 3_600_000 })], lastOk + 3_600_000), []);
    assert.deepEqual(noteFeedRecoveries(reg, [h({ state: "down", failures: 5, lastOkAt: lastOk, lastFetchAt: lastOk + 9_000_000 })], lastOk + 9_000_000), []);
    const back = lastOk + 9_060_000;
    const r = noteFeedRecoveries(reg, [h({ state: "ok", failures: 0, lastOkAt: back, lastFetchAt: back })], back);
    assert.equal(r.length, 1);
    assert.equal(r[0].kind, FEED_RECOVERED_KIND);
    assert.deepEqual({ failures: r[0].meta.failures, durationMs: r[0].meta.durationMs }, { failures: 5, durationMs: 9_060_000 });
    assert.equal(r[0].text, "Burnticker source catalogue:usgs.quakenext:6 ($NEXTM6) answers again after 5 failed reads in a row. It was out for 2 h 31 min, from the last clean read before the failures to the first one after them.");
    assert.deepEqual(noteFeedRecoveries(reg, [h({ state: "ok", lastOkAt: back + 60_000 })], back + 60_000), [], "once only");
    clean(r[0].text);
  });
  test("never pushed as an alarm, and wired into the keeper's after-cycle step", () => {
    assert.equal(PUSH_KIND_OF_ALERT[FEED_RECOVERED_KIND], undefined);
    assert.equal(outageDuration(30_000), "under a minute"); assert.equal(outageDuration(45 * 60_000), "45 min"); assert.equal(outageDuration(2 * 3_600_000), "2 h");
    assert.match(read("src/lib/burnticker/ops/keeperOps.ts"), /noteFeedRecoveries\(reg, this\.health, now\)/);
  });
});

describe("HB-25: the creator card labels its count", () => {
  test("the creator card's count is confirmed burns, and says so", () => {
    assert.equal(CREATOR_PAGE.labels.receipts, "Burn receipts");
  });
});
