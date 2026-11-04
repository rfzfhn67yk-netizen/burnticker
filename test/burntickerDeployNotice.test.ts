// THE UPDATE BANNER (owner, launch night 2026-10-13): while a deploy runs, the app shows one strip at the top and the static fallback
// page says the same, so a visitor who hits a failing page or launch knows the site is being updated, not broken.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DEPLOY_NOTICE_PATH, DEPLOY_NOTICE_TEXT } from "@/lib/burnticker/deployNotice";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";

const read = (p: string) => fs.readFileSync(p, "utf8");
const cfg = loadCopyLintConfig();

describe("the update banner", () => {
  test("the sentence is plain and lint-clean, and names what is not affected", () => {
    const r = lintCopy(DEPLOY_NOTICE_TEXT, cfg);
    assert.ok(r.ok, r.hits.map((h) => h.phrase).join(", "));
    assert.match(DEPLOY_NOTICE_TEXT, /being updated/); assert.match(DEPLOY_NOTICE_TEXT, /not affected/);
    assert.equal(DEPLOY_NOTICE_PATH, "/deploying.json");
  });
  test("the public root layout mounts it above the header", () => {
    const layout = read("config/public-repo/overlay/src/app/layout.tsx");
    assert.ok(layout.indexOf("<DeployNotice />") > 0 && layout.indexOf("<DeployNotice />") < layout.indexOf("<SiteHeader />"));
  });
  test("the deploy script writes the flag on the host before copying and removes it on any exit", (t) => {
    if (!fs.existsSync("scripts/ops/deploy-burnticker-host.sh")) { t.skip("the deploy script is not part of the public tree"); return; }
    const s = read("scripts/ops/deploy-burnticker-host.sh");
    const write = s.indexOf("deploying.json && chmod 644"), copy = s.indexOf("copying the build"), trap = s.indexOf("trap '$SSH \"$HOST\" \"rm -f $WWW/deploying.json\"");
    assert.ok(write > 0 && copy > write, "the flag is written before the build is copied");
    assert.ok(trap > 0 && /EXIT/.test(s.slice(trap, trap + 120)), "removed on EXIT");
  });
  test("the fallback page carries the same message", () => {
    assert.match(read("site/burnticker/fallback/index.html"), /The app is being updated and is back within a minute or two\./);
  });
});
