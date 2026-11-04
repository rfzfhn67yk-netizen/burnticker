// N5 (ChatGPT/Codex review 2026-10-10): the public-tree export must not follow symlinks. An allowlisted path that is a symlink —
// or sits under a symlinked directory — would otherwise publish the TARGET's bytes (and a .png name skips the text leak scan).
// These tests build a throwaway git repo + overlay and run scripts/ops/public-repo-lib.mjs against it with --root, so the real
// monorepo is never read. The exporter must REFUSE (exit 1, the offending path named, nothing written), not silently skip.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, execFileSync } from "node:child_process";

const LIB = path.resolve(import.meta.dirname, "..", "scripts", "ops", "public-repo-lib.mjs");
const PRIVATE_TEXT = "PRIVATE-CONTENT-MUST-NOT-PUBLISH";

function gitIn(dir: string, ...a: string[]) {
  return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.symlinks=true", ...a], { cwd: dir, encoding: "utf8" });
}

/** A minimal publishable repo: allowlist `site/burnticker`, an empty deny list, an overlay with one README, and a private file. */
function makeRepo(): { root: string; outside: string; cleanup: () => void } {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "bt-public-symlink-"));
  const root = path.join(base, "repo");
  const outside = path.join(base, "outside");
  fs.mkdirSync(path.join(root, "config", "public-repo", "overlay"), { recursive: true });
  fs.mkdirSync(path.join(root, "site", "burnticker"), { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "t", private: true }));
  fs.writeFileSync(path.join(root, "config", "public-repo.allowlist"), "site/burnticker\n");
  fs.writeFileSync(path.join(root, "config", "public-repo.denypatterns"), "# none\n");
  fs.writeFileSync(path.join(root, "config", "public-repo", "overlay", "README.md"), "public readme\n");
  fs.writeFileSync(path.join(root, "site", "burnticker", "index.html"), "<p>public</p>\n");
  fs.writeFileSync(path.join(root, "secret.txt"), `${PRIVATE_TEXT}\n`);
  fs.writeFileSync(path.join(outside, "a.txt"), `${PRIVATE_TEXT}\n`);
  gitIn(root, "init", "-q");
  return { root, outside, cleanup: () => fs.rmSync(base, { recursive: true, force: true }) };
}

function commitAll(root: string) {
  gitIn(root, "add", "-A");
  gitIn(root, "commit", "-q", "-m", "fixture");
}

function run(root: string, ...a: string[]) {
  const r = spawnSync(process.execPath, [LIB, ...a, "--root", root], { encoding: "utf8", env: { ...process.env, NODE_OPTIONS: "" } });
  return { status: r.status, out: `${r.stdout}${r.stderr}`, last: `${r.stdout}`.trim().split("\n").at(-1) ?? "" };
}

test("public repo export: a clean fixture passes the check and publishes regular files only", () => {
  const { root, cleanup } = makeRepo();
  try {
    commitAll(root);
    const c = run(root, "check");
    assert.equal(c.status, 0, c.out);
    assert.equal(c.last, "CHECK PASSED");
    const out = path.join(root, "..", "out");
    const p = run(root, "publish", "--out", out, "--no-lockfile");
    assert.equal(p.status, 0, p.out);
    assert.equal(fs.readFileSync(path.join(out, "site", "burnticker", "index.html"), "utf8"), "<p>public</p>\n");
    assert.equal(fs.readFileSync(path.join(out, "README.md"), "utf8"), "public readme\n");
    assert.match(p.out, /staged output: \d+ regular files, no symlink/);
  } finally { cleanup(); }
});

test("public repo export: a tracked allowlisted symlink (site/burnticker/private.png -> ../../secret.txt) is refused by check and publish", () => {
  const { root, cleanup } = makeRepo();
  try {
    fs.symlinkSync("../../secret.txt", path.join(root, "site", "burnticker", "private.png"));
    commitAll(root);
    assert.match(gitIn(root, "ls-files", "-s", "site/burnticker/private.png"), /^120000 /, "fixture must track a symlink");
    const c = run(root, "check");
    assert.equal(c.status, 1, c.out);
    assert.match(c.out, /site\/burnticker\/private\.png/);
    assert.match(c.out, /symlink/i);
    assert.match(c.last, /^CHECK FAILED: /);
    assert.ok(!c.out.includes(PRIVATE_TEXT), "the target's content must never be read into the report");
    const out = path.join(root, "..", "out");
    const p = run(root, "publish", "--out", out, "--no-lockfile");
    assert.equal(p.status, 1, p.out);
    assert.ok(!fs.existsSync(path.join(out, "site", "burnticker", "private.png")), "nothing may be written");
  } finally { cleanup(); }
});

test("public repo export: a tracked file under a directory later replaced by a symlink (ancestor symlink) is refused", () => {
  const { root, outside, cleanup } = makeRepo();
  try {
    fs.mkdirSync(path.join(root, "site", "burnticker", "real"));
    fs.writeFileSync(path.join(root, "site", "burnticker", "real", "a.txt"), "public a\n");
    commitAll(root);
    // the index still lists site/burnticker/real/a.txt; the working tree now routes it through a symlinked directory
    fs.rmSync(path.join(root, "site", "burnticker", "real"), { recursive: true });
    fs.symlinkSync(outside, path.join(root, "site", "burnticker", "real"));
    const c = run(root, "check");
    assert.equal(c.status, 1, c.out);
    assert.match(c.out, /site\/burnticker\/real/);
    assert.match(c.out, /symlink/i);
    assert.ok(!c.out.includes(PRIVATE_TEXT));
  } finally { cleanup(); }
});

test("public repo export: a dangling tracked symlink is refused, not silently skipped", () => {
  const { root, cleanup } = makeRepo();
  try {
    fs.symlinkSync("../../does-not-exist.txt", path.join(root, "site", "burnticker", "gone.png"));
    commitAll(root);
    const c = run(root, "check");
    assert.equal(c.status, 1, c.out);
    assert.match(c.out, /site\/burnticker\/gone\.png/);
  } finally { cleanup(); }
});

test("public repo export: an overlay symlink file and an overlay symlinked directory are refused", () => {
  const { root, outside, cleanup } = makeRepo();
  try {
    commitAll(root);
    const overlay = path.join(root, "config", "public-repo", "overlay");
    fs.symlinkSync(path.join(root, "secret.txt"), path.join(overlay, "logo.png"));
    let c = run(root, "check");
    assert.equal(c.status, 1, c.out);
    assert.match(c.out, /logo\.png/);
    assert.match(c.out, /symlink/i);
    fs.rmSync(path.join(overlay, "logo.png"));
    fs.symlinkSync(outside, path.join(overlay, "sub"));
    c = run(root, "check");
    assert.equal(c.status, 1, c.out);
    assert.match(c.out, /overlay.*sub|sub.*symlink/);
    assert.ok(!c.out.includes(PRIVATE_TEXT));
  } finally { cleanup(); }
});

test("public repo export: a symlinked overlay root is refused", () => {
  const { root, outside, cleanup } = makeRepo();
  try {
    commitAll(root);
    const overlay = path.join(root, "config", "public-repo", "overlay");
    fs.rmSync(overlay, { recursive: true });
    fs.symlinkSync(outside, overlay);
    const c = run(root, "check");
    assert.equal(c.status, 1, c.out);
    assert.match(c.out, /overlay/);
    assert.match(c.out, /symlink/i);
  } finally { cleanup(); }
});
