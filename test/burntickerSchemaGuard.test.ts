// HB-61 (sixth pre-launch audit 2026-10-19, OP6-3): publish 92 migrated the registry to schema 3, its smoke failed falsely, and the deploy
// swapped back to publish 91 (schema 2 code), which refused every launch for 20 minutes. The registry now writes the version its file is
// at to data/schema-version.json, and the swap (scripts/ops/swap-web-build.sh) refuses to switch to a build that knows a lower one, in
// both directions: a rollback's switch and the automatic swap back after a failed smoke. The scripts are monorepo-private.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { openRegistry, REGISTRY_SCHEMA_VERSION, SCHEMA_VERSION_FILE_NAME } from "@/lib/burnticker/registry";

const SCRIPT = "scripts/ops/swap-web-build.sh";
const HAVE = fs.existsSync(SCRIPT);
const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));

/** Runs the script's own guard functions (between its schema-guard markers) on `args`. */
function guard(args: string[]): { code: number; out: string } {
  const src = fs.readFileSync(SCRIPT, "utf8");
  const body = src.slice(src.indexOf("# schema-guard begin"), src.indexOf("# schema-guard end"));
  const f = path.join(tmp("bt-guard-"), "guard.sh");
  fs.writeFileSync(f, `${body}\nschema_guard "$@"\n`);
  const r = spawnSync("sh", [f, ...args], { encoding: "utf8" });
  return { code: r.status ?? -1, out: `${r.stdout}${r.stderr}` };
}
/** A data dir whose schema-version.json says `v`; a source tree knowing `known`; a compiled build knowing `known`. */
const dataAt = (v: number) => { const d = tmp("bt-data-"); fs.writeFileSync(path.join(d, SCHEMA_VERSION_FILE_NAME), JSON.stringify({ version: v, writtenAt: "x", codeKnows: v }) + "\n"); return d; };
const sourceKnowing = (known: number) => { const d = tmp("bt-src-"); fs.mkdirSync(path.join(d, "src/lib/burnticker"), { recursive: true }); fs.writeFileSync(path.join(d, "src/lib/burnticker/registry.ts"), Array.from({ length: known }, (_, i) => `  { version: ${i + 1}, note: "2026-10-1${i}: x" },`).join("\n")); return d; };
const buildKnowing = (known: number) => { const d = tmp("bt-build-"); fs.mkdirSync(path.join(d, "server/chunks"), { recursive: true }); fs.writeFileSync(path.join(d, "server/chunks/1.js"), Array.from({ length: known }, (_, i) => `{version:${i + 1},note:"2026-10-1${i}: x"}`).join(",")); return d; };

describe("HB-61: the deploy refuses to switch to a build that knows a lower registry schema", { skip: !HAVE && "monorepo-private script" }, () => {
  test("the comparison: lower is refused with the fix-forward instruction; equal or higher goes ahead; nothing to compare goes ahead", () => {
    const low = guard([sourceKnowing(2), dataAt(3), "publish 91"]);
    assert.equal(low.code, 1, low.out); assert.match(low.out, /SWAP REFUSED BY THE SCHEMA CHECK/); assert.match(low.out, /schema version 3/); assert.match(low.out, /only knows up to version 2/); assert.match(low.out, /FIX FORWARD/);
    assert.equal(guard([sourceKnowing(3), dataAt(3), "x"]).code, 0);
    assert.equal(guard([sourceKnowing(4), dataAt(3), "x"]).code, 0);
    assert.equal(guard([sourceKnowing(2), tmp("bt-nodata-"), "x"]).code, 0, "no schema-version.json yet");
    assert.equal(guard([tmp("bt-empty-"), dataAt(3), "x"]).code, 0, "code whose schema cannot be told: said plainly, not refused");
    // a compiled build (legacy .next-old / .next-staging) is read from its server files
    assert.equal(guard([buildKnowing(2), dataAt(3), "x"]).code, 1);
    assert.equal(guard([buildKnowing(3), dataAt(3), "x"]).code, 0);
    // this checkout's own registry.ts is read as the version the code knows
    assert.match(guard([".", dataAt(REGISTRY_SCHEMA_VERSION + 1), "x"]).out, new RegExp(`only knows up to version ${REGISTRY_SCHEMA_VERSION}\\b`));
  });

  test("the source: the guard runs before the forward switch and before the automatic swap back", () => {
    const src = fs.readFileSync(SCRIPT, "utf8");
    const forward = src.indexOf('schema_guard "$STAGE" "$DATA_DIR"'), started = src.indexOf('echo "SWAP STARTED');
    assert.ok(forward > 0 && forward < started, "before anything moves");
    assert.ok(src.indexOf('schema_guard "$RELEASE" "$DATA_DIR"') > 0 && src.indexOf('schema_guard "$RELEASE" "$DATA_DIR"') < started);
    const back = src.indexOf('schema_guard "$BACK_TO" "$DATA_DIR"');
    assert.ok(back > src.indexOf("WEB SMOKE FAILED") && back < src.indexOf('switch_link "$PREV"\n  : > "$RELEASE/.failed"') && back < src.indexOf("\nmv .next .next-failed\n"), "before either swap back");
  });

  test("end to end (legacy mode): a staged build knowing schema 2 on a schema-3 registry is refused; nothing moves", () => {
    const dir = tmp("bt-swapguard-");
    fs.mkdirSync(path.join(dir, ".next-staging/server/chunks"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".next-staging/BUILD_ID"), "old91");
    fs.writeFileSync(path.join(dir, ".next-staging/server/chunks/1.js"), '{version:1,note:"2026-10-18: a"},{version:2,note:"2026-10-19: b"}');
    fs.mkdirSync(path.join(dir, ".next")); fs.writeFileSync(path.join(dir, ".next/BUILD_ID"), "new92");
    fs.mkdirSync(path.join(dir, "data")); fs.writeFileSync(path.join(dir, "data", SCHEMA_VERSION_FILE_NAME), '{"version":3}\n');
    const r = spawnSync("sh", [path.resolve(SCRIPT)], { cwd: dir, encoding: "utf8", env: { PATH: process.env.PATH ?? "/usr/bin:/bin", BT_WEB_RESTART: "exit 9", BT_WEB_UNIT_ID: "true" } as unknown as NodeJS.ProcessEnv });
    assert.equal(r.status, 1, r.stdout + r.stderr); assert.match(r.stdout, /SWAP REFUSED BY THE SCHEMA CHECK/);
    assert.equal(fs.readFileSync(path.join(dir, ".next/BUILD_ID"), "utf8"), "new92", "the running build is untouched");
    assert.ok(fs.existsSync(path.join(dir, ".next-staging/BUILD_ID")));
  });
});

describe("HB-61: the registry writes the version its file is at beside it", () => {
  test("data/schema-version.json is written on open (no database open needed to read it), and only rewritten when it changes", () => {
    const dir = tmp("bt-reg-");
    const reg = openRegistry(path.join(dir, "burnticker.db"));
    const f = path.join(dir, SCHEMA_VERSION_FILE_NAME);
    const j = JSON.parse(fs.readFileSync(f, "utf8")) as { version: number; codeKnows: number };
    assert.equal(j.version, REGISTRY_SCHEMA_VERSION); assert.equal(j.codeKnows, REGISTRY_SCHEMA_VERSION);
    assert.equal(reg.schemaVersion()?.version, REGISTRY_SCHEMA_VERSION);
    const before = fs.statSync(f).mtimeMs;
    openRegistry(path.join(dir, "burnticker.db"));
    assert.equal(fs.statSync(f).mtimeMs, before, "same version: not rewritten");
    // an older build opening a file a newer build migrated writes the file's version, the one the deploy must respect
    reg.db.prepare("INSERT INTO schema_version (version, applied_at, note) VALUES (?,?,?)").run(REGISTRY_SCHEMA_VERSION + 1, Date.now(), "a newer build");
    openRegistry(path.join(dir, "burnticker.db"));
    assert.equal((JSON.parse(fs.readFileSync(f, "utf8")) as { version: number }).version, REGISTRY_SCHEMA_VERSION + 1);
  });
});
