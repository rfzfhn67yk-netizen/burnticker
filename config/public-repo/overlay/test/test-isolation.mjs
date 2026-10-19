// EVERY TEST PROCESS WRITES ONLY UNDER ITS OWN TEMPORARY DIRECTORY (2026-10-18 prelaunch audit A-13). Imported first by
// test/alias-hook.mjs, so no test file can forget it. In the public repository this file is test/test-isolation.mjs; in the private
// monorepo it is published from config/public-repo/overlay/test/ and the monorepo's hook imports it from there (one copy).
//
// Until this, nothing in the suite set BURNTICKER_DB, and a route test that reached platform() opened ./data/burnticker.db of whatever
// checkout ran it: test/burntickerCreatorLaunches.test.ts wrote a "launches closed" record there through the launch route. On the
// Burnticker host that path IS the live registry (the web and keeper units both point BURNTICKER_DB at it). Every database and
// publish directory a module opens by default is now pointed into this process's own directory, and
// src/lib/burnticker/testGuard.ts makes the registry and the mint bank refuse the default ./data files while this marker is set.
//
// WHO COUNTS AS A TEST PROCESS:
//   · a `node --test` worker (NODE_TEST_CONTEXT is set in the worker, not in the parent that launches the suite: setting paths in the
//     parent would hand every worker the same files);
//   · the single process of `node --test --test-isolation=none`;
//   · a test file run directly (`node --import ./test/alias-hook.mjs test/x.test.ts`).
// The production runners also load the alias hook for path aliases; none of these holds for them, so they are never redirected.
//
// A value already inside the temporary directory is kept: a child a test spawns with its own scratch BURNTICKER_DB (and an inherited
// NODE_TEST_CONTEXT) keeps the path its test chose. Anything else (unset, a relative path, a path in a checkout) is replaced.
//
// THE DIRECTORY IS RANDOMLY NAMED AND REMOVED WHEN THE PROCESS EXITS (2026-10-11: PID-keyed files were reused by later runs).
// It is not created here: each module mkdirs its own file's directory when it first opens it.
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { randomUUID } from "node:crypto";

/** The environment variables that name a database file or a publish directory, with the file or directory name used under the tmpdir. */
export const ISOLATED_PATHS = Object.freeze({
  MCT_DB_PATH: "trades.db",
  BURNTICKER_DB: "burnticker.db",
  BURNTICKER_MINT_BANK_PATH: "burnticker-mintbank.db",
  BURNTICKER_PUBLISH_DIR: "burnticker-site",
  BURNTICKER_SYNTH_DB: "burnticker-synth.db",
  BURNKEEPER_DB: "burnkeeper.db",
  BURNKEEPER_PUBLISH_DIR: "burnkeeper-site",
});
export const ISOLATION_MARKER = "BURNTICKER_TEST_ISOLATION";

const TEST_FILE = /\.test\.[cm]?[jt]sx?$/;
export function isTestProcess(env = process.env, execArgv = process.execArgv, argv = process.argv) {
  if (env.NODE_TEST_CONTEXT) return true;
  const flags = [...execArgv, ...(env.NODE_OPTIONS ?? "").split(/\s+/)];
  if (flags.includes("--test")) return flags.some((a) => /^--([a-z]+-)?test-isolation=none$/.test(a)); // the runner parent: no
  return TEST_FILE.test(argv[1] ?? "");
}

function insideTmp(p) {
  if (!p || !path.isAbsolute(p)) return false;
  const roots = new Set([os.tmpdir()]);
  try { roots.add(fs.realpathSync(os.tmpdir())); } catch { /* the tmpdir itself always exists */ }
  return [...roots].some((r) => p === r || p.startsWith(r + path.sep));
}

if (isTestProcess()) {
  const dir = path.join(os.tmpdir(), `mct-test-${process.pid}-${randomUUID()}`);
  for (const [name, file] of Object.entries(ISOLATED_PATHS)) {
    // MCT_DB_PATH has always been replaced unconditionally in a worker; the rest keep a scratch path a test chose
    if (name !== "MCT_DB_PATH" && insideTmp(process.env[name]?.trim())) continue;
    process.env[name] = path.join(dir, file);
  }
  process.env[ISOLATION_MARKER] = dir;
  process.on("exit", () => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  });
}
