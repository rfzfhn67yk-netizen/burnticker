// THE POST QUEUE (go-to-market pack, 2026-10-10): every format from the fixtures passes the copy lint and the X limits; a banned word in
// the data is refused, never queued; the queue file is append-only; nothing in the generator can post (no network, no X API).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { lintCopy, loadCopyLintConfig, xLength } from "@/lib/launch/copyLint";
import {
  EXPLAINER_TOPICS, POST_FORMATS, PostRefused, QUEUE_SCHEMA, TEASER_TOPICS, THREAD_MAX, appendQueue, asThread, checkDraft, coinLaunchThread, deficitLaunchThread,
  deficitReceiptDraft, draftId, explainerDraft, pairScoreboardDraft, platformLaunchThread, readLeagues, readQueue, receiptDraft, reviewLine, scoreboardDraft, scoreboardDrafts,
  seasonCardDraft, teaserDraft, type Draft,
} from "@/lib/launch/postQueue";
import * as F from "./postQueueFixtures.ts";

const cfg = loadCopyLintConfig();
const NOW = Date.parse("2026-10-10T20:00:00Z");
const site = F.FIXTURE_SITE;
const facts = F.committedFacts();
const sample = F.deficitSample();
const deficitBurns = sample.burns.map((b) => ({ ...b, txUrl: `https://solscan.io/tx/SAMPLE-${b.recordDate}` }));
const lastConfirmed = deficitBurns.filter((b) => b.status === "confirmed").at(-1)!;

/** One draft per format and topic, the way `scripts/burnticker-posts.mts all --fixtures` builds them. */
function everyDraft(): Draft[] {
  return [
    receiptDraft(F.RAYS_STATUS, F.RAYS_RECEIPTS, F.RAYS_RECEIPTS[4], site),
    deficitReceiptDraft(sample.status, deficitBurns, lastConfirmed, F.FIXTURE_DEFICIT_SITE),
    ...scoreboardDrafts({ index: F.SEASON_INDEX, receiptsByTicker: F.SEASON_RECEIPTS, day: F.FIXTURE_DAY, site }),
    pairScoreboardDraft(F.PAIR_TALLY, site),
    seasonCardDraft(F.RAYS_STATUS, site), seasonCardDraft(F.ONESHOT_STATUS, site),
    ...EXPLAINER_TOPICS.map((t) => explainerDraft(t, site)),
    deficitLaunchThread(facts.deficit, F.FIXTURE_DEFICIT_SITE, "https://solscan.io/tx/LAUNCH"), platformLaunchThread(facts.reviews, site), coinLaunchThread(F.RAYS_STATUS, site),
    ...TEASER_TOPICS.map((t) => teaserDraft(t, { site, reviews: facts.reviews, deficit: facts.deficit, coverage: facts.coverage, devnet: facts.devnet })),
  ];
}
const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "postq-")), "post-queue.jsonl");

describe("every format from the fixtures", () => {
  const drafts = everyDraft();
  test("covers all six formats", () => assert.deepEqual([...new Set(drafts.map((d) => d.format))].sort(), [...POST_FORMATS].sort()));
  for (const d of drafts) {
    test(`${d.format} · ${d.subject}: lint-clean, ≤ 280 X-characters per post, ≤ ${THREAD_MAX} posts, no placeholder`, () => {
      const e = checkDraft(d, { source: "fixtures", now: NOW, cfg });
      assert.ok(e.posts.length >= 1 && e.posts.length <= THREAD_MAX);
      for (const p of e.posts) { assert.equal(lintCopy(p, cfg).ok, true, p); assert.ok(xLength(p, cfg.linkCountsAs) <= cfg.maxChars, `${xLength(p)}: ${p}`); assert.doesNotMatch(p, /\{[A-Z_]{2,}/); }
    });
  }
  test("the hard copy rules hold across every post: never Kalshi, never 'audit' as a claim, no league list led by the NFL", () => {
    const all = drafts.flatMap((d) => d.posts).join("\n\n");
    assert.doesNotMatch(all, /kalshi/i);
    assert.doesNotMatch(all.replace(/not audited by a security firm/gi, ""), /\baudit(ed)?\b/i);
    for (const m of all.matchAll(/team coins across ([^(]+)\(/g)) assert.doesNotMatch(m[1], /^NFL/);
    assert.notEqual(readLeagues()[0].league, "nfl");
  });
  test("the platform thread names the operator, says 'not audited', and its review line comes from transparency.json", () => {
    const t = platformLaunchThread(facts.reviews, site).posts.join("\n");
    assert.match(t, /one independent operator/); assert.doesNotMatch(t, /Shane|Cassidy|Colorado/); assert.match(t, /Not audited by a security firm/); assert.ok(t.includes(reviewLine(facts.reviews)));
    assert.match(reviewLine({ blindDone: 3, chatgptDone: false, bountyPublished: false, firmAudit: false }), /^three blind AI reviews published in full, the adversarial ChatGPT review pending, the public bounty not published$/);
    assert.match(reviewLine({ blindDone: 3, chatgptDone: true, bountyPublished: true, firmAudit: false }), /an adversarial ChatGPT review published, a public bounty$/);
  });
  test("the devnet teaser reads its numbers and transaction from the rehearsal's evidence file", () => {
    const t = teaserDraft("devnet-receipt", { site, devnet: facts.devnet }).posts[0];
    assert.match(t, /Devnet rehearsal, 2026-10-06: [\s\S]* 23 units\. [\s\S]* spent 0\.0201 SOL [\s\S]* 4,010,874 test \$DEFICIT/);
    assert.match(t, /explorer\.solana\.com\/tx\/[1-9A-HJ-NP-Za-km-z]{86,88}\?cluster=devnet/);
  });
  test("the $DEFICIT thread and teaser take the fraction and hash from the rule file (2% · 0.98 · 8e3e8b66748a)", () => {
    const t = [...deficitLaunchThread(facts.deficit, F.FIXTURE_DEFICIT_SITE).posts, ...teaserDraft("the-rule", { site, deficit: facts.deficit }).posts].join("\n");
    assert.match(t, /2% of its burn pool/); assert.match(t, /0\.98\^units/); assert.match(t, /sha256:8e3e8b66748a/);
  });
  test("the scoreboard (the copy agent's scoreboardText): one post per league, live team coins only, then the cross-league count — never a ranking across leagues", () => {
    const d = scoreboardDrafts({ index: F.SEASON_INDEX, receiptsByTicker: F.SEASON_RECEIPTS, day: F.FIXTURE_DAY, site, top: 5 });
    assert.deepEqual(d.map((x) => x.subject), ["NHL season 2026-10-09", "MLB season 2026-10-09", "NBA season 2026-10-09", "NFL season 2026-10-09", "all leagues 2026-10-09"]);
    const mlb = d[1].posts[0];
    assert.match(mlb, /^MLB 2026 postseason · Oct 9 · 2 team coins · 1 burned yesterday\n1\. \$RAYS 5 receipts, 2\.41% burned · most receipts so far\n2\. \$MARINERS 0 receipts/);
    for (const x of d) { assert.equal(x.posts.length, 1); assert.doesNotMatch(x.posts[0], /\$DEFICIT|\$COYOTES|champion/); assert.ok(xLength(x.posts[0]) <= 280); }
    assert.doesNotMatch(d[0].posts[0], /\$RAYS|\$LAKERS|\$EAGLES/, "the NHL post shows NHL coins only");
    assert.equal(d[4].posts[0], "Yesterday (Oct 9) across all leagues: 2 team coins burned.");
    assert.equal(scoreboardDraft({ index: F.SEASON_INDEX, receiptsByTicker: F.SEASON_RECEIPTS, day: F.FIXTURE_DAY, site, league: "NHL" }).posts.length, 1);
  });
});

describe("refusals", () => {
  const refusal = (d: Draft) => { try { checkDraft(d, { source: "test", now: NOW, cfg }); } catch (e) { if (e instanceof PostRefused) return e; throw e; } assert.fail(`not refused: ${d.posts.join(" / ")}`); };
  test("a banned word in fixture data is refused with its rule, and never reaches the queue", () => {
    const bad = F.receipt({ title: "TB 9 @ NYY 1 — Rays to the moon, 100x" });
    const e = refusal(receiptDraft(F.RAYS_STATUS, [...F.RAYS_RECEIPTS.slice(0, 4), bad], bad, site));
    assert.equal(e.reason, "lint"); assert.deepEqual([...new Set(e.hits.map((h) => h.rule))].sort(), ["moon", "multiplier", "to-the"]);
    const card = refusal(seasonCardDraft({ ...F.RAYS_STATUS, profile: { ...F.RAYS_STATUS.profile, oneLiner: "Guaranteed burns every Rays loss — buy now" } }, site));
    assert.deepEqual(card.hits.map((h) => h.rule).sort(), ["buy-now", "guarantee"]);
    const file = tmp();
    const ok: ReturnType<typeof checkDraft>[] = [];
    for (const d of [receiptDraft(F.RAYS_STATUS, F.RAYS_RECEIPTS, F.RAYS_RECEIPTS[4], site), receiptDraft(F.RAYS_STATUS, [bad], bad, site)]) { try { ok.push(checkDraft(d, { source: "test", now: NOW, cfg })); } catch { /* refused */ } }
    appendQueue(file, ok);
    assert.equal(readQueue(file).length, 1); assert.doesNotMatch(fs.readFileSync(file, "utf8"), /moon/);
  });
  test("over 280 X-characters, an unfilled placeholder, an empty post and a thread over the cap are refused", () => {
    const base = { format: "explainer", account: "@BurnTicker", subject: "t" } as const;
    assert.equal(refusal({ ...base, posts: ["word ".repeat(60)] }).reason, "length");
    assert.equal(refusal({ ...base, posts: ["Receipt: {TX}"] }).reason, "placeholder");
    assert.equal(refusal({ ...base, posts: ["fine", " "] }).reason, "empty");
    assert.equal(refusal({ ...base, posts: Array.from({ length: THREAD_MAX + 1 }, (_, i) => `post ${i}`) }).reason, "thread");
    assert.ok(checkDraft({ ...base, posts: [`${"x".repeat(240)} https://example.com/${"y".repeat(200)}`] }, { source: "t", now: NOW, cfg }), "a long link counts 23");
  });
  test("a receipt post exists only for a confirmed burn", () => {
    assert.throws(() => receiptDraft(F.RAYS_STATUS, F.RAYS_RECEIPTS, F.RAYS_RECEIPTS[5], site), /skipped, not a confirmed burn/);
  });
  test("a $DEFICIT burn day without a transaction is refused (the template's {TX})", () => {
    const row = sample.burns.filter((b) => b.status === "confirmed").at(-1)!;
    assert.equal(refusal(deficitReceiptDraft(sample.status, sample.burns, row, F.FIXTURE_DEFICIT_SITE)).reason, "placeholder");
  });
  test("asThread packs whole lines into ≤ 280-character posts", () => {
    const lines = Array.from({ length: 9 }, (_, i) => `line ${i} ${"z".repeat(60)}`);
    const t = asThread(lines.join("\n"));
    assert.ok(t.length > 1); for (const p of t) assert.ok(xLength(p) <= 280);
    assert.deepEqual(t.join("\n").split("\n"), lines);
  });
});

describe("the queue is append-only", () => {
  const entries = () => everyDraft().map((d) => checkDraft(d, { source: "fixtures", now: NOW, cfg }));
  test("a second run appends only new posts and leaves every earlier byte in place", () => {
    const file = tmp(); const [a, b, c] = entries();
    assert.equal(appendQueue(file, [a, b]).appended.length, 2);
    const before = fs.readFileSync(file);
    const r = appendQueue(file, [b, c]);
    assert.deepEqual(r.appended.map((e) => e.id), [c.id]); assert.deepEqual(r.skipped.map((e) => e.id), [b.id]);
    const after = fs.readFileSync(file);
    assert.ok(after.subarray(0, before.length).equals(before), "earlier entries unchanged");
    assert.deepEqual(readQueue(file).map((e) => e.id), [a.id, b.id, c.id]);
    for (const e of readQueue(file)) { assert.equal(e.schema, QUEUE_SCHEMA); assert.equal(e.status, "awaiting-owner"); }
  });
  test("ids are content ids; a damaged queue is refused, not rewritten", () => {
    const [a] = entries();
    assert.equal(a.id, draftId(a)); assert.notEqual(draftId({ ...a, posts: [`${a.posts[0]}.`] }), a.id);
    const file = tmp(); fs.writeFileSync(file, `${JSON.stringify(a)}\nnot json\n`);
    const before = fs.readFileSync(file);
    assert.throws(() => appendQueue(file, entries().slice(1, 2)), /not JSON — the queue is append-only/);
    assert.ok(fs.readFileSync(file).equals(before));
  });
  test("the script: --fixtures queues every format once, a re-run adds nothing, --dry-run writes nothing", () => {
    const file = tmp();
    const run = (...extra: string[]) => spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--import", "./test/alias-hook.mjs", "scripts/burnticker-posts.mts", "all", "--fixtures", `--queue=${file}`, "--now=2026-10-10T20:00:00Z", ...extra], { encoding: "utf8" });
    const first = run(); assert.equal(first.status, 0, first.stderr);
    const n = readQueue(file).length; assert.ok(n >= 18, `${n} queued`);
    assert.deepEqual(new Set(readQueue(file).map((e) => e.format)), new Set(POST_FORMATS));
    const second = run(); assert.equal(second.status, 0, second.stderr); assert.match(second.stderr, /0 appended/); assert.equal(readQueue(file).length, n);
    const dryFile = tmp(); const dry = spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--import", "./test/alias-hook.mjs", "scripts/burnticker-posts.mts", "teaser", "--dry-run", `--queue=${dryFile}`], { encoding: "utf8" });
    assert.equal(dry.status, 0, dry.stderr); assert.equal(fs.existsSync(dryFile), false); assert.match(dry.stdout, /devnet-receipt/);
  });
  test("nothing in the generator can post: no network call, no X API", () => {
    for (const f of ["src/lib/launch/postQueue.ts", "scripts/burnticker-posts.mts"]) {
      const src = fs.readFileSync(f, "utf8");
      assert.doesNotMatch(src, /\bfetch\(|https?\.request|api\.(x|twitter)\.com|oauth/i, f);
      assert.doesNotMatch(src, /[1-9A-HJ-NP-Za-km-z]{86,88}/, `${f}: a transaction signature typed into source (the public-repo leak scan refuses it)`);
    }
  });
});
