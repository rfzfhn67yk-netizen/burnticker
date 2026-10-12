// WEBSITE AUDIT 4 (2026-10-11), BT-11/BT-12/BT-14/BT-18: evidence paths are links pinned to a public commit, the whitepaper says it is
// historical before anything else, the top-level summary says who can authorise an upgrade and with how much notice, and categorical
// claims carry their scope beside them.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PUBLIC_REPO_COMMIT, PUBLIC_REPO_URL, repoUrl, splitRepoPaths } from "@/lib/burnticker/currentStatusLinks";
import { buildCurrentStatus, type ChainFacts } from "@/lib/burnticker/currentStatus";
import { USE_OF_FEES } from "@/lib/burnticker/fees";
import { CHECK_COPY } from "@/lib/burnticker/trustpack/copy";

const ROOT = path.join(import.meta.dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

test("BT-14: repository paths become links pinned to a 40-hex public commit (folders open the tree view)", () => {
  assert.match(PUBLIC_REPO_COMMIT, /^[0-9a-f]{40}$/);
  assert.equal(repoUrl("docs/burnticker/decisions.md"), `${PUBLIC_REPO_URL}/blob/${PUBLIC_REPO_COMMIT}/docs/burnticker/decisions.md`);
  assert.equal(repoUrl("docs/burnticker/reviews/"), `${PUBLIC_REPO_URL}/tree/${PUBLIC_REPO_COMMIT}/docs/burnticker/reviews`);
  const parts = splitRepoPaths("Records: docs/burnkeeper/devnet-run.md and config/burnticker/transparency.json → limitations.");
  assert.deepEqual(parts.filter((p) => p.path).map((p) => p.path), ["docs/burnkeeper/devnet-run.md", "config/burnticker/transparency.json"]);
  assert.equal(parts.map((p) => p.text).join(""), "Records: docs/burnkeeper/devnet-run.md and config/burnticker/transparency.json → limitations.");
  for (const f of ["src/app/burnticker/_components/CurrentStatusSummary.tsx", "src/app/burnticker/check/page.tsx", "src/app/burnticker/operator/page.tsx", "src/app/burnticker/trust/page.tsx"]) assert.match(read(f), /<RepoText /, f);
  assert.doesNotMatch(read("src/app/burnticker/_components/CurrentStatusSummary.tsx"), /\(<code>\{h\.path\}<\/code>\)/, "history paths are links, not plain text");
});

test("BT-11: the whitepaper opens with a historical-version notice that links the live status", () => {
  const html = read("site/burnticker/whitepaper.html");
  const notice = html.indexOf('<aside class="notice" role="note">'), firstSection = html.indexOf("<section");
  assert.ok(notice > 0 && (firstSection < 0 || notice < firstSection), "the notice comes before the first section");
  assert.match(html, /Historical version — not the current status/); assert.match(html, /href="https:\/\/burnticker\.com\/burnticker\/trust"/);
});

test("BT-12: the summary line names key control and notice (owner holds two of three keys; time lock 0 = no advance notice)", () => {
  const facts: ChainFacts = { cluster: "mainnet", readAt: "2026-10-11T23:00:00Z", error: null, squads: { threshold: 2, timeLockSecs: 0, members: 3 }, programs: {} };
  const s = buildCurrentStatus({ root: ROOT, env: {}, chain: { mainnet: facts }, now: Date.parse("2026-10-11T23:00:00Z") });
  const up = s.lines.find((l) => l.startsWith("The 2-of-3 Squads vault holds the upgrade authority."))!;
  assert.match(up, /The owner holds members A and B, which are two of the three keys, so the owner alone meets the 2-of-3 threshold/);
  assert.match(up, /executes at once, with no advance notice/);
  assert.equal(s.releaseRequirements.find((r) => r.id === "mainnet-deploy")?.status, "done", "BT-02: the deployment gate follows the deployment state");
});

test("BT-18: categorical claims carry their actor and scope", () => {
  assert.match(USE_OF_FEES, /operator and its wallets never trade any coin/); assert.match(USE_OF_FEES, /program-run burn-pool purchases/);
  assert.doesNotMatch(USE_OF_FEES, /The platform never buys back any coin/);
  assert.match(CHECK_COPY.powersIntro, /current instruction permissions/); assert.match(CHECK_COPY.powersIntro, /Upgrade authority is a separate power/);
  assert.match(read("site/burnticker/index.html"), /The second publisher, FRED, reports this debt only once a quarter\. It can confirm the quarter ends but not each daily reading\./);
});
