// 2026-10-16 prelaunch audit F-32: a `playwright-core install chromium` started from an interactive root ssh hung for 15 hours holding
// ~mct/.cache/ms-playwright/__dirlock, and every nightly synthetic run behind it waited on the lock. The synthetic creator's service
// script now removes a __dirlock older than an hour when no installer process is alive (scripts/service/playwright-dirlock.sh), and the
// documented install step runs under a time limit.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SCRIPT = path.resolve("scripts/service/playwright-dirlock.sh");
function setup(ageMin: number) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bt-pw-"));
  const lock = path.join(dir, "__dirlock");
  fs.mkdirSync(lock);
  const t = new Date(Date.now() - ageMin * 60_000);
  fs.utimesSync(lock, t, t);
  return { dir, lock };
}
const run = (dir: string, installerAlive: boolean) => spawnSync("sh", [SCRIPT, dir], { encoding: "utf8", env: { PATH: process.env.PATH ?? "/usr/bin:/bin", PLAYWRIGHT_LOCK_PGREP: installerAlive ? "true" : "false" } as unknown as NodeJS.ProcessEnv });

describe("a stale Playwright install lock (F-32)", () => {
  test("older than an hour with no installer alive: removed, and said", () => {
    const { dir, lock } = setup(90);
    const r = run(dir, false);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!fs.existsSync(lock));
    assert.match(r.stdout, /removed a stale Playwright install lock/);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  test("an installer still alive, or a fresh lock: left alone", () => {
    const a = setup(90);
    assert.equal(run(a.dir, true).status, 0);
    assert.ok(fs.existsSync(a.lock), "a live installer's lock was removed");
    const b = setup(10);
    assert.equal(run(b.dir, false).status, 0);
    assert.ok(fs.existsSync(b.lock), "a ten-minute-old lock was removed");
    for (const x of [a, b]) fs.rmSync(x.dir, { recursive: true, force: true });
  });
  test("the synthetic creator's script clears it before a run, and the install steps run under a time limit", () => {
    assert.match(fs.readFileSync("scripts/service/run-burnticker-synth.sh", "utf8"), /playwright-dirlock\.sh/);
    const doc = fs.readFileSync("docs/burnticker/SYNTHETIC-CREATOR.md", "utf8");
    assert.match(doc, /timeout \d+ npx playwright-core install/);
    assert.doesNotMatch(doc.replace(/timeout \d+ npx playwright-core install/g, ""), /npx playwright-core install/);
  });
});
