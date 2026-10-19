// THE REGISTRY'S SCHEMA VERSION (2026-10-18 prelaunch audit A-32): one append-only row per version, written on open once that version's
// changes are in the file, with a note on what it changed.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openRegistry, REGISTRY_MIGRATIONS, REGISTRY_SCHEMA_VERSION } from "@/lib/burnticker/registry";

test("a new registry records version 1 with its migration note; reopening adds nothing; the rows cannot be changed or deleted", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bt-schema-"));
  try {
    const file = path.join(dir, "r.db");
    const r = openRegistry(file);
    assert.equal(REGISTRY_SCHEMA_VERSION, 1);
    const v = r.schemaVersion();
    assert.equal(v?.version, 1); assert.match(v!.note, /^2026-10-18: schema versions start\./); assert.ok(v!.appliedAt > 0);
    const at = v!.appliedAt;
    r.db.close();
    const again = openRegistry(file);
    assert.deepEqual(again.schemaVersion(), { version: 1, appliedAt: at, note: REGISTRY_MIGRATIONS[0].note }, "the first open's row stands");
    assert.equal((again.db.prepare("SELECT COUNT(*) n FROM schema_version").get() as { n: number }).n, 1);
    assert.throws(() => again.db.exec("UPDATE schema_version SET note = 'x'"), /schema_version: append-only/);
    assert.throws(() => again.db.exec("DELETE FROM schema_version"), /schema_version: append-only/);
    again.db.close();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("a registry made before versions existed (no schema_version table) is at version 1 once opened", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bt-schema-old-"));
  try {
    const file = path.join(dir, "old.db");
    const r = openRegistry(file); r.db.exec("DROP TRIGGER schema_version_no_delete; DROP TRIGGER schema_version_no_update; DROP TABLE schema_version"); r.db.close();
    const raw = new DatabaseSync(file); assert.equal(raw.prepare("SELECT 1 FROM sqlite_master WHERE name='schema_version'").get(), undefined); raw.close();
    assert.equal(openRegistry(file).schemaVersion()?.version, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("versions are consecutive from 1 and every one has a dated note", () => {
  REGISTRY_MIGRATIONS.forEach((m, i) => { assert.equal(m.version, i + 1); assert.match(m.note, /^\d{4}-\d{2}-\d{2}: \S/); });
});
