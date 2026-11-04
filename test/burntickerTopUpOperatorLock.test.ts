// Reviewer finding A (publishes 100-102): the operator's --apply ran its pass without re-taking its lock, so a slow pass (up to four steps,
// each polled to blockhash expiry) could outlive the lock, and a keeper then took it and sent to the same target. The pass now re-takes
// the lock before every step, as the keeper does, and the lock and PAUSE files resolve from one root for both.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CLI_LOCK_TTL_MS, KEEPER_LOCK_TTL_MS, KEEPER_PAUSE_FILE, TOP_UP_LOCK_FILE, takeTopUpLock, topUpPaths } from "@/lib/burnticker/ops/topUp";

describe("finding A: one sender while the operator's pass is slow", () => {
  test("a pass of four slow steps that re-takes its lock before each one is never overtaken by the keeper", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bt-lock-"));
    const file = path.join(dir, "lock");
    let now = Date.parse("2026-10-20T18:00:00Z");
    assert.equal(takeTopUpLock(file, "cli", now, CLI_LOCK_TTL_MS, 4242).ok, true);
    const refresh = () => takeTopUpLock(file, "cli", now, CLI_LOCK_TTL_MS, 4242).ok;
    for (let step = 0; step < 4; step++) {
      assert.equal(refresh(), true, `step ${step}: the pass still holds its lock`);
      now += 4 * 60_000;   // one slow step: a transfer polled to its blockhash's expiry, or a slow Irys funding
      assert.equal(takeTopUpLock(file, "keeper", now, KEEPER_LOCK_TTL_MS).ok, false, `after step ${step}: the keeper is refused`);
    }
    // without the refreshes, the same 16 minutes outlive the lock and the keeper takes it (the bug)
    const file2 = path.join(dir, "lock2");
    const t0 = now;
    takeTopUpLock(file2, "cli", t0, CLI_LOCK_TTL_MS, 4242);
    assert.equal(takeTopUpLock(file2, "keeper", t0 + 16 * 60_000, KEEPER_LOCK_TTL_MS).ok, true);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  test("the lock and PAUSE files resolve from the same root for the keeper and the operator's tool", () => {
    const root = "/srv/burnticker";
    assert.deepEqual(topUpPaths(root), { lock: path.join(root, TOP_UP_LOCK_FILE), pause: path.join(root, KEEPER_PAUSE_FILE) });
    assert.equal(topUpPaths().lock, path.resolve(process.cwd(), TOP_UP_LOCK_FILE));
    const ops = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "lib", "burnticker", "ops", "keeperOps.ts"), "utf8");
    assert.match(ops, /topUpPaths\(o\.root \?\? process\.cwd\(\)\)\.lock/);
    const keeper = fs.readFileSync(path.join(import.meta.dirname, "..", "scripts", "burnticker-keeper.mts"), "utf8");
    assert.match(keeper, /const PAUSE = path\.join\("data", "PAUSE-burnticker"\)/, "the keeper reads PAUSE from its working directory, the same root");
  });
});
