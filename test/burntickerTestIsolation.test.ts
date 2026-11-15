// NO TEST WRITES THE CHECKOUT'S OWN ./data (2026-10-18 prelaunch audit A-13). test/burntickerCreatorLaunches.test.ts posts to the launch
// route, which reaches platform() and records "launches closed" in the registry; before test/test-isolation.mjs that registry was
// ./data/burnticker.db of whatever checkout ran the suite, and on the host that file is the live registry. These tests run that file in a
// child process from a scratch checkout directory and check nothing appears under its ./data, and pin the two locks: the per-process
// paths the hook sets, and the registry / mint bank refusing the default file while a test runs.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { refuseDefaultDataFileUnderTest } from "@/lib/burnticker/testGuard";
import { openRegistry, REGISTRY_FILE } from "@/lib/burnticker/registry";
import { MINT_BANK_DEFAULT_PATH } from "@/lib/burnticker/mintBank";

const ROOT = path.resolve(import.meta.dirname, "..");
const NODE_ARGS = ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--import", "./test/alias-hook.mjs"];
const PATH_VARS = ["MCT_DB_PATH", "BURNTICKER_DB", "BURNTICKER_MINT_BANK_PATH", "BURNTICKER_PUBLISH_DIR", "BURNTICKER_SYNTH_DB", "BURNKEEPER_DB", "BURNKEEPER_PUBLISH_DIR"];

/** A scratch "checkout": the repository's code reached through symlinks, its own empty working directory (where ./data would land). */
function scratchCheckout(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bt-isolation-"));
  for (const name of ["src", "test", "config", "docs", "public", "scripts", "node_modules", "package.json", "tsconfig.json"]) {
    if (fs.existsSync(path.join(ROOT, name))) fs.symlinkSync(path.join(ROOT, name), path.join(dir, name));
  }
  return dir;
}
/** The parent's environment without this worker's test context and paths: the child starts like a fresh `node --test` from a shell. */
function cleanEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra };
  for (const k of [...PATH_VARS, "NODE_TEST_CONTEXT", "BURNTICKER_TEST_ISOLATION", "NODE_OPTIONS"]) if (!(k in extra)) delete env[k];
  return env;
}

describe("the suite never writes the checkout's ./data (audit A-13)", () => {
  test("the creator-launches test, run in a child from a scratch checkout, passes and leaves no data/burnticker.db (nor any ./data)", () => {
    const dir = scratchCheckout();
    try {
      const r = spawnSync(process.execPath, [...NODE_ARGS, "--test", "--test-reporter=dot", "test/burntickerCreatorLaunches.test.ts"], { cwd: dir, env: cleanEnv(), encoding: "utf8", timeout: 120_000 });
      assert.equal(r.status, 0, `the child run failed:\n${(r.stdout + r.stderr).slice(-2000)}`);
      assert.equal(fs.existsSync(path.join(dir, "data", "burnticker.db")), false, "data/burnticker.db appeared in the scratch checkout");
      assert.equal(fs.existsSync(path.join(dir, "data")), false, `./data appeared in the scratch checkout: ${fs.existsSync(path.join(dir, "data")) ? fs.readdirSync(path.join(dir, "data")).join(", ") : ""}`);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test("a test worker gets every database and publish path inside its own temporary directory; a production runner keeps its own", () => {
    const probe = `process.stdout.write(JSON.stringify(Object.fromEntries(${JSON.stringify([...PATH_VARS, "BURNTICKER_TEST_ISOLATION"])}.map((k) => [k, process.env[k] ?? null]))))`;
    // as a worker: NODE_TEST_CONTEXT set, and a checkout path inherited from the shell (as on the host) is replaced
    const asWorker = spawnSync(process.execPath, [...NODE_ARGS, "-e", probe], { cwd: ROOT, env: cleanEnv({ NODE_TEST_CONTEXT: "child-v8", BURNTICKER_DB: "data/burnticker.db" }), encoding: "utf8" });
    assert.equal(asWorker.status, 0, asWorker.stderr);
    const w = JSON.parse(asWorker.stdout) as Record<string, string | null>;
    const tmp = [os.tmpdir(), fs.realpathSync(os.tmpdir())];
    assert.ok(w.BURNTICKER_TEST_ISOLATION && tmp.some((t) => w.BURNTICKER_TEST_ISOLATION!.startsWith(t)), String(w.BURNTICKER_TEST_ISOLATION));
    for (const k of PATH_VARS) assert.ok(w[k]?.startsWith(w.BURNTICKER_TEST_ISOLATION! + path.sep), `${k} = ${w[k]}`);
    // a scratch path a test chose for its own child (inside the tmpdir) is kept
    const chosen = path.join(os.tmpdir(), "bt-isolation-chosen", "r.db");
    const kept = spawnSync(process.execPath, [...NODE_ARGS, "-e", probe], { cwd: ROOT, env: cleanEnv({ NODE_TEST_CONTEXT: "child-v8", BURNTICKER_DB: chosen }), encoding: "utf8" });
    assert.equal((JSON.parse(kept.stdout) as Record<string, string>).BURNTICKER_DB, chosen);
    // a production runner (the keeper and the web load the same hook for path aliases): nothing is redirected, no marker
    const asRunner = spawnSync(process.execPath, [...NODE_ARGS, "-e", probe], { cwd: ROOT, env: cleanEnv({ BURNTICKER_DB: "data/burnticker.db" }), encoding: "utf8" });
    const p = JSON.parse(asRunner.stdout) as Record<string, string | null>;
    assert.equal(p.BURNTICKER_DB, "data/burnticker.db"); assert.equal(p.BURNTICKER_TEST_ISOLATION, null); assert.equal(p.MCT_DB_PATH, null);
  });

  test("under a test the registry and the mint bank refuse the checkout's default ./data file; any other path, :memory: and a non-test process pass", () => {
    assert.throws(() => openRegistry(REGISTRY_FILE), /registry: a test may not open .*data\/burnticker\.db/);
    assert.throws(() => openRegistry(path.resolve(REGISTRY_FILE)), /a test may not open/);
    assert.equal(fs.existsSync(path.resolve(REGISTRY_FILE)), false, "the refusal comes before anything is created");
    const marker = { BURNTICKER_TEST_ISOLATION: "/tmp/x" };
    assert.throws(() => refuseDefaultDataFileUnderTest(MINT_BANK_DEFAULT_PATH, MINT_BANK_DEFAULT_PATH, "mint bank", marker), /mint bank: a test may not open/);
    refuseDefaultDataFileUnderTest(":memory:", REGISTRY_FILE, "registry", marker);
    refuseDefaultDataFileUnderTest(path.join(os.tmpdir(), "r.db"), REGISTRY_FILE, "registry", marker);
    refuseDefaultDataFileUnderTest(REGISTRY_FILE, REGISTRY_FILE, "registry", {});   // the host's keeper and web: no marker, no refusal
    assert.match(process.env.BURNTICKER_DB ?? "", new RegExp(`^${(process.env.BURNTICKER_TEST_ISOLATION ?? "\0").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  });

  test("no test file writes into the checkout's ./data by a literal path", () => {
    // a write call (writeFileSync, appendFileSync, mkdirSync, openRegistry, new DatabaseSync, MintBank) whose first argument is a literal
    // ./data path, or path.join("data", ...) / path.join(ROOT, "data", ...) handed to one; tmp roots (os.tmpdir, mkdtemp) are fine
    // reviewed 2026-10-18, not writes into the checkout: deadTape asserts on a runner's source text; strategyFingerprint's child
    // process.chdir()s into its own mkdtemp directory before it opens data/trades.db
    const reviewed = new Set(["deadTape.test.ts:new DatabaseSync(path.join(\"data\", \"hyperliquid.db\")", "strategyFingerprint.test.ts:new DatabaseSync('data/trades.db')"]);
    const offenders: string[] = [];
    const write = /\b(writeFileSync|appendFileSync|mkdirSync|openRegistry|new DatabaseSync|new MintBank|copyFileSync|renameSync)\(\s*(["'`]\.?\/?data\/|path\.(join|resolve)\(\s*(["'`]data["'`]|ROOT,\s*["'`]data["'`]|process\.cwd\(\),\s*["'`]data["'`]))/;
    for (const f of fs.readdirSync(path.join(ROOT, "test")).filter((n) => /\.test\.ts$/.test(n) && n !== path.basename(import.meta.filename))) {
      fs.readFileSync(path.join(ROOT, "test", f), "utf8").split("\n").forEach((line, i) => { if (write.test(line) && ![...reviewed].some((r) => r.startsWith(`${f}:`) && line.includes(r.slice(f.length + 1)))) offenders.push(`${f}:${i + 1}: ${line.trim().slice(0, 160)}`); });
    }
    assert.deepEqual(offenders, []);
  });
});
