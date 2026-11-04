// HB-62 (sixth audit 2026-10-19): the backup set and the restore drill. The held-swap records (data/burnticker-swap-pending.db) were in
// no backup; the operator's pull script lived only outside the repository; no restore had ever been run. This file checks that the
// host backup and the pull both carry the held-swap database (the host backup is run on fixtures), that the tracked pull script and
// restore drill equal the installed copies when those are on this machine, that the drill refuses a scratch directory inside the live
// or backup paths, that a drill on fixture backups prints its paragraph and writes the receipt in its fixed shape (secrets step
// skipped), and the copy lint on the new public sentences. The Mac-side scripts are monorepo-only: where they are absent (the public
// tree) those checks return early.
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openRegistry, REGISTRY_SCHEMA_VERSION } from "@/lib/burnticker/registry";
import { lintCopy } from "@/lib/launch/copyLint";

const HOST_BACKUP = path.resolve("scripts/service/run-burnticker-backup.sh");
const MAC_DIR = path.resolve("scripts", "ops", "mac");
const TRACKED_PULL = path.join(MAC_DIR, "box-backup-pull.sh");
const TRACKED_DRILL = path.join(MAC_DIR, "restore-drill.sh");
const INSTALLED_DIR = process.env.BURNTICKER_OFFBOX_PULL_DIR ?? path.join(os.homedir(), "mct-runner-study", "launch-debt-egg-2026-10-09", "ops");
const hasSqlite = spawnSync("sqlite3", ["-version"]).status === 0;
const sql = (db: string, q: string) => execFileSync("sqlite3", [db, q], { encoding: "utf8" }).trim();
const childEnv = (extra: Record<string, string>) => {
  const env: Record<string, string> = { PATH: process.env.PATH ?? "/usr/bin:/bin", ...extra };
  return env as unknown as NodeJS.ProcessEnv;
};

describe("HB-62: the held-swap database is in the backup set", { skip: !hasSqlite && "sqlite3 is not installed here" }, () => {
  test("the host backup's default list names it, and a run backs it up", () => {
    const src = fs.readFileSync(HOST_BACKUP, "utf8");
    assert.match(src, /^DBS=\$\{BURNTICKER_BACKUP_DBS:-[^\n]*\$\{BURNTICKER_SWAP_PENDING_DB:-data\/burnticker-swap-pending\.db\}\}$/m);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bt-backupset-"));
    try {
      fs.mkdirSync(path.join(root, "data"));
      sql(path.join(root, "data/burnticker.db"), "CREATE TABLE tokens (id INTEGER PRIMARY KEY); INSERT INTO tokens DEFAULT VALUES;");
      sql(path.join(root, "data/burnticker-swap-pending.db"), "PRAGMA journal_mode=WAL; CREATE TABLE held (sig TEXT); INSERT INTO held VALUES ('s');");
      const r = spawnSync("sh", [HOST_BACKUP], { encoding: "utf8", env: childEnv({ HOME: root, BURNTICKER_BACKUP_ROOT: root }) });
      assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
      const made = fs.readdirSync(path.join(root, "data/backups")).filter((f) => /^burnticker-swap-pending-\d{8}T\d{6}Z-\d{3}\.db$/.test(f));
      assert.equal(made.length, 1, "one copy of the held-swap database");
      assert.equal(sql(path.join(root, "data/backups", made[0]), "SELECT COUNT(*) FROM held;"), "1");
      const status = JSON.parse(fs.readFileSync(path.join(root, "data/backups/last-backup.json"), "utf8")) as { ok: boolean; files: string[] };
      assert.ok(status.ok && status.files.some((f) => f.includes("burnticker-swap-pending-")), "named in last-backup.json");
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  test("the pull script copies it, and the kind match cannot take the mint bank's file for the registry's (when present)", () => {
    for (const file of [TRACKED_PULL, path.join(INSTALLED_DIR, "box-backup-pull.sh")]) {
      if (!fs.existsSync(file)) continue;
      const src = fs.readFileSync(file, "utf8");
      assert.match(src, /^for kind in burnticker burnkeeper burnticker-mintbank burnticker-swap-pending; do$/m, file);
      assert.ok(src.includes("ls \"$DEST/files/$kind-\"[0-9]*.db"), `${file}: the [0-9] after the kind`);
      assert.match(src, /THE INSTALLED COPY IS THE ONE THE LAUNCHAGENT RUNS/, `${file}: the header`);
    }
  });
});

describe("HB-62: the tracked Mac scripts equal the installed ones", () => {
  for (const name of ["box-backup-pull.sh", "restore-drill.sh"]) {
    test(`${name} is byte-identical to the installed copy (skipped where either is absent)`, () => {
      const tracked = path.join(MAC_DIR, name), installed = path.join(INSTALLED_DIR, name);
      if (!fs.existsSync(tracked) || !fs.existsSync(installed)) return;
      assert.ok(fs.readFileSync(tracked).equals(fs.readFileSync(installed)), `${name}: the tracked copy and the installed copy differ; copy one over the other`);
    });
  }
});

describe("HB-62: the restore drill", { skip: !hasSqlite && "sqlite3 is not installed here" }, () => {
  let root = "";
  let src = "";
  const drill = (args: string[], extra: Record<string, string> = {}) => {
    const r = spawnSync("sh", [TRACKED_DRILL, ...args], {
      encoding: "utf8",
      env: childEnv({ HOME: root, TMPDIR: path.join(root, "tmp"), BURNTICKER_DRILL_SRC: src, BURNTICKER_DRILL_SECRETS_SRC: path.join(root, "secrets"), BURNTICKER_DRILL_RECEIPT_DIR: path.join(root, "receipt"), BURNTICKER_REPO: process.cwd(), ...extra }),
    });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  };
  before(() => {
    if (!fs.existsSync(TRACKED_DRILL)) return;
    root = fs.mkdtempSync(path.join(os.tmpdir(), "bt-drill-"));
    src = path.join(root, "src");
    fs.mkdirSync(src); fs.mkdirSync(path.join(root, "tmp"));
    // a real registry made by the app's own code, then backed up the way the host does it (an ordinary journal)
    const live = path.join(root, "made", "burnticker.db");
    openRegistry(live).close();
    sql(live, "PRAGMA journal_mode=DELETE;");
    sql(live, `.backup '${path.join(src, "burnticker-20261019T182226Z-000.db")}'`);
    // an older copy of each, which the drill must pass over for the newest
    fs.copyFileSync(path.join(src, "burnticker-20261019T182226Z-000.db"), path.join(src, "burnticker-20261018T182226Z-000.db"));
    sql(path.join(src, "burnkeeper-20261019T182226Z-000.db"), "CREATE TABLE burns (id INTEGER PRIMARY KEY); INSERT INTO burns DEFAULT VALUES; INSERT INTO burns DEFAULT VALUES;");
    sql(path.join(src, "burnticker-mintbank-20261019T182226Z-000.db"), "CREATE TABLE keys (pubkey TEXT); INSERT INTO keys VALUES ('k');");
    sql(path.join(src, "burnticker-swap-pending-20261019T182226Z-000.db"), "CREATE TABLE held (sig TEXT); INSERT INTO held VALUES ('a'), ('b'), ('c');");
  });
  after(() => { if (root) fs.rmSync(root, { recursive: true, force: true }); });

  test("the source refuses the live and backup paths before it creates anything", () => {
    if (!fs.existsSync(TRACKED_DRILL)) return;
    const s = fs.readFileSync(TRACKED_DRILL, "utf8");
    assert.match(s, /for live in "\$REPO\/data" "\$HOME\/BurntickerBackups" "\$ICLOUD" "\$SRC" "\$SECRETS_SRC" "\$RECEIPT_DIR" /);
    assert.ok(s.indexOf("refuse \"inside the live or backup path") < s.indexOf("mkdir -p \"$S\""), "the refusal comes before the first mkdir");
    assert.match(s, /-pass env:BT_DRILL_PASS/, "the passphrase reaches openssl in its environment, not on its command line");
    assert.match(s, /\| tar -tzf - 2>\/dev\/null \| wc -l/, "the decrypted stream is only listed and counted");
    assert.doesNotMatch(s, /tar -x|> *"\$RUN\/secrets|echo "\$BT_DRILL_PASS|printf[^\n]*BT_DRILL_PASS/, "nothing decrypted is written and the passphrase is never printed");
  });

  test("a scratch directory inside the backups, the receipt folder, the checkout's data or above them is refused (exit 2)", () => {
    if (!fs.existsSync(TRACKED_DRILL)) return;
    for (const scratch of [path.join(src, "x"), path.join(root, "receipt", "x"), path.join(process.cwd(), "data", "drill"), path.join(root, "BurntickerBackups", "y"), root]) {
      const r = drill(["--scratch", scratch, "--skip-secrets"]);
      assert.equal(r.code, 2, `${scratch}: ${r.out}`);
      assert.match(r.out, /REFUSED/);
    }
    assert.equal(fs.existsSync(path.join(src, "x")), false, "nothing was created inside the backups");
    assert.equal(fs.existsSync(path.join(root, "receipt", "last-restore-drill.json")), false);
  });

  test("a drill on fixture backups restores, checks, counts, opens the registry, prints one paragraph and writes the receipt", () => {
    if (!fs.existsSync(TRACKED_DRILL)) return;
    const scratch = path.join(root, "scratch");
    const r = drill(["--scratch", scratch, "--skip-secrets"]);
    assert.equal(r.code, 0, r.out);
    const para = r.out.trim().split("\n").filter((l) => l.startsWith("Restore drill "));
    assert.equal(para.length, 1, r.out);
    assert.match(para[0], /^Restore drill \d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ: PASSED\. 4 database backup\(s\) restored into a scratch directory in \d+ s\. quick_check and integrity_check are ok on every restored file\. The registry holds 0 coin\(s\), 0 receipt\(s\) and 0 reading\(s\) at schema version \d+; the app's registry reader opened a copy/);
    assert.match(para[0], /The secrets bundle was not checked on this run\./);
    const receipt = JSON.parse(fs.readFileSync(path.join(root, "receipt", "last-restore-drill.json"), "utf8")) as Record<string, unknown>;
    assert.deepEqual(Object.keys(receipt), ["schema", "restoredAt", "ok", "tookSeconds", "files", "checks", "rows", "schemaVersion", "registryReader", "secrets", "missing"]);
    assert.equal(receipt.schema, "burnticker.restore-drill/v1");
    assert.equal(receipt.ok, true);
    assert.match(String(receipt.restoredAt), /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    const files = receipt.files as { backup: string; restoredAs: string; bytes: number }[];
    assert.deepEqual(files.map((f) => f.restoredAs), ["data/burnkeeper.db", "data/burnticker-mintbank.db", "data/burnticker-swap-pending.db", "data/burnticker.db"]);
    assert.equal(files.find((f) => f.restoredAs === "data/burnticker.db")?.backup, "burnticker-20261019T182226Z-000.db", "the newest copy, not the older one");
    for (const c of Object.values(receipt.checks as Record<string, { quickCheck: string; integrityCheck: string }>)) assert.deepEqual(c, { quickCheck: "ok", integrityCheck: "ok" });
    const rows = receipt.rows as { tokens: number; receipts: number; readings: number; byFile: Record<string, Record<string, number>> };
    assert.deepEqual([rows.tokens, rows.receipts, rows.readings], [0, 0, 0]);
    assert.equal(rows.byFile["data/burnticker-swap-pending.db"].held, 3);
    assert.equal(rows.byFile["data/burnkeeper.db"].burns, 2);
    assert.deepEqual(receipt.schemaVersion, { recorded: REGISTRY_SCHEMA_VERSION, afterOpen: REGISTRY_SCHEMA_VERSION, code: REGISTRY_SCHEMA_VERSION });
    assert.deepEqual(receipt.registryReader, { ok: true, tokens: 0, byStatus: {}, error: null });
    assert.deepEqual(receipt.secrets, { checked: false, decrypts: null, files: null, note: "skipped" });
    assert.deepEqual(receipt.missing, []);
    assert.deepEqual(fs.readdirSync(scratch), [], "the restored files are removed afterwards");
  });

  test("the secrets step decrypts a bundle only to count its files, and a wrong passphrase fails the drill (stand-in keychain)", { skip: spawnSync("openssl", ["version"]).status !== 0 && "openssl is not installed here" }, () => {
    if (!fs.existsSync(TRACKED_DRILL)) return;
    const bin = path.join(root, "bin"), secrets = path.join(root, "secrets"), plain = path.join(root, "plain");
    fs.mkdirSync(bin, { recursive: true }); fs.mkdirSync(secrets, { recursive: true }); fs.mkdirSync(plain, { recursive: true });
    fs.writeFileSync(path.join(plain, "one.txt"), "fixture one\n"); fs.writeFileSync(path.join(plain, "two.txt"), "fixture two\n");
    const bundle = path.join(secrets, "secrets-20261019T182527Z.tar.gz.enc");
    const tgz = execFileSync("tar", ["-czf", "-", "-C", plain, "one.txt", "two.txt"]);
    execFileSync("openssl", ["enc", "-aes-256-cbc", "-pbkdf2", "-iter", "600000", "-salt", "-pass", "env:FIXTURE_PASS", "-out", bundle], { input: tgz, env: { ...process.env, FIXTURE_PASS: "fixture-pass" } });
    const stub = (pass: string) => { fs.writeFileSync(path.join(bin, "security"), `#!/bin/sh\necho ${pass}\n`, { mode: 0o755 }); };
    const before = new Set(fs.readdirSync(root));
    stub("fixture-pass");
    const ok = drill([], { PATH: `${bin}:${process.env.PATH ?? "/usr/bin:/bin"}` });
    assert.equal(ok.code, 0, ok.out);
    assert.match(ok.out, /The newest secrets bundle decrypts with the keychain passphrase and holds 2 file\(s\); nothing from it was written to disk\./);
    assert.doesNotMatch(ok.out, /one\.txt|two\.txt|fixture one|fixture-pass/, "no name, content or passphrase is printed");
    const r1 = JSON.parse(fs.readFileSync(path.join(root, "receipt", "last-restore-drill.json"), "utf8")) as { ok: boolean; secrets: unknown };
    assert.equal(r1.ok, true);
    assert.deepEqual(r1.secrets, { checked: true, decrypts: true, files: 2, note: "secrets-20261019T182527Z.tar.gz.enc" });
    assert.ok(!JSON.stringify(r1).includes("one.txt"), "the receipt names no file inside the bundle");
    stub("wrong-pass");
    const bad = drill([], { PATH: `${bin}:${process.env.PATH ?? "/usr/bin:/bin"}` });
    assert.equal(bad.code, 1, bad.out);
    assert.match(bad.out, /The secrets bundle did NOT decrypt/);
    assert.deepEqual([...fs.readdirSync(root)].filter((f) => !before.has(f)), [], "nothing new beside the fixtures (the default scratch is removed)");
    assert.deepEqual(fs.readdirSync(path.join(root, "tmp")), [], "the temporary scratch directory is gone");
    fs.rmSync(secrets, { recursive: true, force: true });
  });

  test("a damaged backup fails the drill (exit 1) and the receipt says ok false", () => {
    if (!fs.existsSync(TRACKED_DRILL)) return;
    const bad = path.join(src, "burnkeeper-20261020T000000Z-000.db");
    fs.writeFileSync(bad, Buffer.alloc(8192, 7));
    try {
      const r = drill(["--skip-secrets"]);
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /Restore drill .*: FAILED\./);
      const receipt = JSON.parse(fs.readFileSync(path.join(root, "receipt", "last-restore-drill.json"), "utf8")) as { ok: boolean; checks: Record<string, { quickCheck: string }> };
      assert.equal(receipt.ok, false);
      assert.notEqual(receipt.checks["data/burnkeeper.db"]?.quickCheck ?? "missing", "ok");
    } finally { fs.rmSync(bad, { force: true }); }
  });
});

describe("HB-62: the new public sentences", () => {
  test("the runbook's backup section and the owner row pass the copy lint and name no host, path or storage service", () => {
    const runbook = fs.readFileSync(path.join("docs", "burnticker", "runbook.md"), "utf8");
    const todo = fs.readFileSync(path.join("docs", "burnticker", "TODO-OWNER.md"), "utf8");
    const start = runbook.indexOf("### Where the backups are, and a restore from scratch");
    assert.ok(start > 0, "the section exists");
    const section = runbook.slice(start, runbook.indexOf("\n## ", start));
    const row = todo.split("\n").find((l) => l.startsWith("| 33 | **A second copy of the backup passphrase, kept offline**"));
    assert.ok(row, "the owner row exists");
    const prose = (section + "\n" + row).replace(/`[^`]*`/g, " ").replace(/\*\*/g, "");
    for (const s of prose.split(/(?<=[.!?])\s+|\n+/).map((x) => x.trim()).filter((x) => x.length > 20)) {
      const r = lintCopy(s);
      assert.equal(r.ok, true, `${s}: ${r.hits.map((h) => h.phrase).join(", ")}`);
    }
    assert.doesNotMatch(section + row, /icloud|launchagent|mct-runner-study|\b100\.\d+\.\d+\.\d+\b|\/home\/|keychain item "|→|->/i);
    assert.match(section, /restore-drill\.sh/);
    assert.match(section, /TODO-OWNER\.md #33/);
  });
});
