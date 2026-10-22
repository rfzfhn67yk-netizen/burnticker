// THE LEAK SCAN'S CREDENTIAL AND HOME-DIRECTORY SHAPES (2026-10-18 prelaunch audit A-32). The scan had no generic credential shapes and
// missed the dashed "-Users-<name>" form tools make of a path, and the operator's account name sat in 40 committed devnet evidence files.
// Samples are built at run time so this file holds none of them.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const patterns = fs.readFileSync(path.join(ROOT, "config/public-repo.denypatterns"), "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"))
  .map((l) => { const m = /^\/(.*)\/([a-z]*)(?:\s+allow:\s*(.*))?$/.exec(l); assert.ok(m, l); return new RegExp(m![1], m![2]); });
const caught = (s: string) => patterns.some((re) => re.test(s));
const HOME_FORMS = [/\/Users\/(?!<home>)[A-Za-z0-9._-]+/, /(?<![A-Za-z])-Users-[A-Za-z0-9._]+(?=[-/]|$)/];

/** Every file of the tree under `dir`, skipping installs, builds and git. */
function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if ([".git", "node_modules", ".next", ".next-burnticker", "handoff", "data", "logs"].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (e.isFile()) out.push(p);
  }
  return out;
}

describe("leak scan shapes (A-32)", () => {
  test("credential shapes and both home-directory forms are caught; a scrubbed <home> path and a bare git commit are not", () => {
    const who = "some" + "one";
    for (const s of [
      `/Users/${who}/Projects/x`, `ledger /private/tmp/claude-501/-Users-${who}/abc/scratchpad`, `cd /Users/${who}`, `projects/-Users-${who}`, `x -Users-${who}-Projects-y`,
      "-----" + "BEGIN OPENSSH PRIVATE KEY-----", "AKIA" + "ABCDEFGHIJKLMNOP", "ghp_" + "a".repeat(36), "xoxb-" + "1234567890-abc",
      "AIza" + "B".repeat(35), "sk_live_" + "c".repeat(24), "sk-ant-" + "d".repeat(40), "Authorization: Bearer " + "e1".repeat(12),
      `api_key = "${"f0".repeat(20)}"`, `"secret": "${"0a".repeat(20)}"`,
    ]) assert.ok(caught(s), `not caught: ${s.slice(0, 40)}`);
    for (const s of ["ledger /private/tmp/claude-501/<home>/abc/scratchpad", `PUBLIC_REPO_COMMIT = "${"9f".repeat(20)}"`, "authorization: `Bearer ${token}`", "Bearer test-token", "see the Power-Users-Guide", "Power-Users-Group/notes"])
      assert.equal(caught(s), false, `caught by mistake: ${s}`);
  });

  test("no published file names a home directory (the 40 devnet evidence files were scrubbed to <home>)", () => {
    const evidence = path.join(ROOT, "docs/burnkeeper/evidence");
    for (const f of walk(evidence)) {
      const s = fs.readFileSync(f, "utf8");
      for (const re of HOME_FORMS) assert.doesNotMatch(s, re, path.relative(ROOT, f));
      // and the account name of whoever runs this, when it is not a generic service user
      const me = os.userInfo().username;
      if (me.length >= 6 && /^\/(Users|home)\//.test(os.homedir())) assert.equal(s.includes(me), false, `${path.relative(ROOT, f)} names this machine's account`);
    }
    if (fs.existsSync(path.join(ROOT, "scripts/ops/publish-and-deploy.sh"))) {
      // the private monorepo: the publish check scans exactly the published set (allowlist + overlay) with these patterns
      const r = spawnSync("sh", ["scripts/ops/publish-public-repo.sh", "--check"], { cwd: ROOT, encoding: "utf8", env: { ...process.env, NODE_OPTIONS: "" } });
      assert.match(r.stdout, /leak scan: no pattern matched/, r.stdout.split("\n").filter((l) => /LEAK|\/Users|-Users-/.test(l)).slice(0, 8).join("\n"));
    } else {
      // the public tree: every file in it is published
      const hits = walk(ROOT).filter((f) => !/\.(png|jpe?g|gif|ico|woff2?|ttf|so|wasm)$/i.test(f) && !f.endsWith("public-repo.denypatterns"))
        .filter((f) => HOME_FORMS.some((re) => re.test(fs.readFileSync(f, "utf8"))));
      assert.deepEqual(hits.map((f) => path.relative(ROOT, f)), []);
    }
  });

  test("the scan's built-in shapes cannot be switched off by editing the patterns file", () => {
    const lib = fs.readFileSync(path.join(ROOT, "scripts/ops/public-repo-lib.mjs"), "utf8");
    assert.match(lib, /export const BUILTIN_DENY = \[/);
    assert.match(lib, /for \(const re of BUILTIN_DENY\) out\.push\(\{ source: `\$\{re\.source\} \(built in\)`, re, allow: new Set\(\) \}\);/);
  });
});
