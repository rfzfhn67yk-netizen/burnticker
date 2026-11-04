// PRELAUNCH AUDIT 2026-10-18 A-6: the hourly audit never read the chain while the home said every receipt recomputes; the trust and
// operator pages kept two wallet records; two keeper keys shared one name; the never-buys monitor never ran; two stale statements; the
// changelog printed the private monorepo commit and "the public commit was not recorded"; the check page's register text skipped
// plainPower(); "no key can change it" on an upgradeable program.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { auditBadgeView, NO_BURNS_TO_CHECK } from "@/lib/burnticker/auditBadge";
import { buildTrustPage } from "@/lib/burnticker/trust";
import { parseChangelog, publicRelease } from "@/lib/burnticker/history";
import { publicChangelogMarkdown } from "@/lib/burnticker/changelogPublic";
import { neverBuysMints } from "@/lib/burnticker/trustpack/neverBuys";
import { plainPower, UPGRADE_CAVEAT } from "@/lib/burnticker/powerPlain";
import { PUSH_KIND_OF_ALERT } from "@/lib/burnticker/push";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");

describe("the audit reads the chain and counts only receipts that ran", () => {
  test("the audit script builds the read-only program client (no payer) when the program id and RPC are set", () => {
    const s = read("scripts/burnticker-audit.mts");
    assert.ok(!/programId \? null : null/.test(s), "the never-wired line is gone");
    assert.match(s, /new ProgramBurnClient\(\{.*payer: null, admin: null/);
  });
  test("two receipts waiting on chain are not called verified; completed ones are counted", () => {
    const waiting = auditBadgeView({ ok: true, receipts: 2, executed: 0, mismatches: 0, chainChecked: false });
    assert.equal(waiting.text, NO_BURNS_TO_CHECK);
    assert.equal(waiting.tone, "muted");
    const some = auditBadgeView({ ok: true, receipts: 5, executed: 3, mismatches: 0, chainChecked: true });
    assert.equal(some.text, "All 3 completed receipts recompute");
    assert.match(some.sub ?? "", /2 more are waiting to run/);
    assert.equal(auditBadgeView({ ok: true, receipts: 4, mismatches: 0, chainChecked: true }).text, "All 4 completed receipts recompute", "older documents without the count");
  });
  test("bt-audit-mismatch and bt-never-buys-red are pushed", () => {
    assert.equal(PUSH_KIND_OF_ALERT["bt-audit-mismatch"], "audit-mismatch");
    assert.equal(PUSH_KIND_OF_ALERT["bt-never-buys-red"], "never-buys-red");
  });
});

describe("the never-buys monitor runs in the keeper", () => {
  test("the keeper runs it once a day and publishes never-buys.json", () => {
    const k = read("scripts/burnticker-keeper.mts");
    assert.match(k, /runNeverBuys\(/);
    assert.match(k, /\[NEVER_BUYS_FILE\]: toJson\(r\)/);
  });
  test("it watches every non-draft coin on the cluster, the listed mints and $DEFICIT, once each", () => {
    const m = neverBuysMints([
      { ticker: "DENWIN", mint: "D".repeat(43), status: "live", cluster: "mainnet" },
      { ticker: "DRAFTY", mint: "E".repeat(43), status: "draft", cluster: "mainnet" },
      { ticker: "DEV", mint: "F".repeat(43), status: "live", cluster: "devnet" },
      { ticker: "DEFICIT", mint: "AJJ4XxCUYr8zzMWm8FYg3xh638LYAAApdNqWBqCK4oqj", status: "live", cluster: "mainnet" },
    ], "mainnet", [], [{ symbol: "DEFICIT", mint: "AJJ4XxCUYr8zzMWm8FYg3xh638LYAAApdNqWBqCK4oqj" }]);
    assert.deepEqual(m.map((x) => x.symbol).sort(), ["DEFICIT", "DENWIN"]);
  });
});

describe("the changelog names the public commit and never the monorepo commit", () => {
  const md = read("docs/burnticker/CHANGELOG.md");
  test("most releases now link a public commit (the pins commits name them)", () => {
    const rel = parseChangelog(md);
    const linked = rel.filter((r) => r.publicCommit).length;
    assert.ok(linked >= 80, `${linked} of ${rel.length} releases link a public commit`);
    assert.equal(parseChangelog(md).find((r) => r.source === "133468e10225")?.publicCommit?.length, 40, "the release the audit quoted is linked");
  });
  test("what visitors get carries no monorepo commit", () => {
    const rel = parseChangelog(md);
    const pub = JSON.stringify(rel.map(publicRelease));
    for (const r of rel) assert.ok(!pub.includes(r.source), `release ${r.date} leaks its source`);
    const text = publicChangelogMarkdown(md);
    assert.ok(!/monorepo commit: /.test(text));
    assert.ok(!text.includes("133468e1"), "the commit the audit quoted is gone");
    for (const r of rel) assert.ok(!text.includes(r.source), `${r.source} still in the trust page text`);
    assert.match(text, /^## 2026-10-17 — publish$/m);
  });
  test("the page and the trust API show only the public form; the pins step writes the public commit into the entry", () => {
    const page = read("src/app/burnticker/changelog/page.tsx");
    assert.ok(!/r\.source|CHANGELOG_COPY\.source/.test(page));
    assert.match(read("src/app/api/burnticker/trust/route.ts"), /\.map\(publicRelease\)/);
    // the publish script is private (not in the public tree): the public gate skips this assertion
    if (fs.existsSync(path.join(ROOT, "scripts/ops/publish-and-deploy.sh"))) assert.match(read("scripts/ops/publish-and-deploy.sh"), /printf -- '- public commit: `%s`\\n' "\$NEW" >> docs\/burnticker\/CHANGELOG\.md/);
  });
});

describe("statements that are true today", () => {
  test("no 'once the program is deployed', no 'once it is published', and the upgrade caveat instead of 'no key can change it'", async () => {
    const page = await buildTrustPage({ reader: null, env: { BURNTICKER_CLUSTER: "mainnet" }, root: ROOT, siteDir: path.join(ROOT, "no-such-site"), attesters: [], now: Date.parse("2026-10-18T12:00:00Z"), skipFeeLedger: true });
    const all = JSON.stringify(page.statements) + JSON.stringify(page.transparency.howBuilt);
    assert.ok(!/Once the program is deployed/.test(all));
    assert.ok(!/once it is published/.test(all));
    assert.ok(!/No admin key can change/.test(all));
    assert.ok(page.statements.some((s) => s.includes(UPGRADE_CAVEAT)));
    assert.ok(!/no key can change it/.test(read("src/app/burnticker/trust/page.tsx")));
    assert.ok(page.transparency.updatedAt >= "2026-10-18");
    const cfg = loadCopyLintConfig();
    for (const s of [UPGRADE_CAVEAT, "The burn program enforces this cap on chain.", "A bounty wallet for security reports is funded, and its terms are still a draft; the bounty page shows both."]) assert.ok(lintCopy(s, cfg).ok, s);
  });
  test("register text through plainPower: no arrows, no LaunchLab field name, no review section marks", () => {
    const t = plainPower("Round 5: propose_target_pool → 48 h, any attester can veto → apply_target_pool (migrateCpLockNftScale; Burnticker: 1,000,000) (LAUNCHPAD-PATH §35: x)");
    assert.ok(!/→|migrateCpLockNftScale|LAUNCHPAD-PATH/.test(t), t);
    const doc = read("docs/burnticker/CHECK-THIS-YOURSELF.md");
    const nonPowers = doc.split("\n").filter((l) => /^- \((burn_receipts|pair_curve)\) No /.test(l));
    for (const l of nonPowers) assert.ok(!/→|LAUNCHPAD-PATH/.test(l), l.slice(0, 80));
  });
});
