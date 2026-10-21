// HB-61 (continuous audit; still open after the seventh pass: "schema guard in source and a host marker; not exercised"): the guard had
// unit tests on hand-written version files only. This runs the real path a rollback takes: a registry opened by this checkout's code,
// then migrated one version past it by a "newer build" (a bumped schema_version row), so the registry itself writes
// data/schema-version.json; then swap-web-build.sh in release mode is asked to switch the release link to a release whose source is this
// checkout's registry.ts. The switch is refused before anything moves, and the link still points at the serving release.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { openRegistry, REGISTRY_SCHEMA_VERSION, SCHEMA_VERSION_FILE_NAME } from "@/lib/burnticker/registry";

const ROOT = path.join(import.meta.dirname, "..");
const SWAP = path.join(ROOT, "scripts", "ops", "swap-web-build.sh");
const HAVE = fs.existsSync(SWAP);
const put = (f: string, body: string) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, body); };

describe("HB-61: the schema guard against a bumped registry, end to end in release mode", { skip: !HAVE && "monorepo-private script" }, () => {
  test("a rollback to code that knows the current schema is refused once a newer build migrated the file one version up", () => {
    const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "bt-schema-")));
    const shared = path.join(home, "shared"), serving = path.join(home, "releases", "new"), older = path.join(home, "releases", "old"), link = path.join(home, "current");
    // the serving release (the newer build) and the older release a rollback would switch to; both see the shared data directory
    for (const r of [serving, older]) { put(path.join(r, ".next", "BUILD_ID"), path.basename(r)); fs.symlinkSync(path.join(shared, "data"), path.join(r, "data")); }
    put(path.join(older, "src", "lib", "burnticker", "registry.ts"), fs.readFileSync(path.join(ROOT, "src", "lib", "burnticker", "registry.ts"), "utf8"));
    fs.symlinkSync(serving, link);
    // the registry: opened by this checkout's code (schema REGISTRY_SCHEMA_VERSION), then the newer build migrates it one version up
    fs.mkdirSync(path.join(shared, "data"), { recursive: true });
    const db = path.join(shared, "data", "burnticker.db");
    const reg = openRegistry(db);
    reg.db.prepare("INSERT INTO schema_version (version, applied_at, note) VALUES (?,?,?)").run(REGISTRY_SCHEMA_VERSION + 1, Date.now(), "2026-10-21: the newer build's migration");
    reg.close();
    openRegistry(db).close();   // any open writes the file's version beside it
    const marker = JSON.parse(fs.readFileSync(path.join(shared, "data", SCHEMA_VERSION_FILE_NAME), "utf8")) as { version: number };
    assert.equal(marker.version, REGISTRY_SCHEMA_VERSION + 1, "the bumped fixture: the registry wrote the newer version");
    const r = spawnSync("sh", [SWAP], { cwd: os.tmpdir(), encoding: "utf8", env: { PATH: process.env.PATH ?? "/usr/bin:/bin", BT_RELEASE: older, BT_CURRENT: link, BT_WEB_RESTART: "exit 9", BT_WEB_UNIT_ID: "true", BT_WEB_URL: "http://127.0.0.1:9" } as unknown as NodeJS.ProcessEnv });
    const out = `${r.stdout}${r.stderr}`;
    assert.equal(r.status, 1, out);
    assert.match(out, new RegExp(`SWAP REFUSED BY THE SCHEMA CHECK: the registry file is at schema version ${REGISTRY_SCHEMA_VERSION + 1}`));
    assert.match(out, new RegExp(`only knows up to version ${REGISTRY_SCHEMA_VERSION}\\b`));
    assert.equal(fs.readlinkSync(link), serving, "the link still points at the serving release");
    assert.doesNotMatch(out, /SWAP STARTED/);
    // and the same switch goes ahead past the guard when the file is at the version the older code knows (no bump)
    put(path.join(shared, "data", SCHEMA_VERSION_FILE_NAME), JSON.stringify({ version: REGISTRY_SCHEMA_VERSION }) + "\n");
    const ok = spawnSync("sh", [SWAP], { cwd: os.tmpdir(), encoding: "utf8", env: { PATH: process.env.PATH ?? "/usr/bin:/bin", BT_RELEASE: older, BT_CURRENT: link, BT_WEB_RESTART: "exit 9", BT_WEB_UNIT_ID: "true", BT_WEB_URL: "http://127.0.0.1:9", BT_WEB_DEADLINE: "1", BT_WEB_ROLLBACK_DEADLINE: "1" } as unknown as NodeJS.ProcessEnv });
    assert.match(`${ok.stdout}${ok.stderr}`, new RegExp(`schema check: release old knows registry schema ${REGISTRY_SCHEMA_VERSION}; the file is at ${REGISTRY_SCHEMA_VERSION}`));
    fs.rmSync(home, { recursive: true, force: true });
  });
});
