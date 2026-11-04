// 2026-10-16 prelaunch audit F-7: no backup existed anywhere (the runbook described one; no timer was installed). These run the real
// backup script (scripts/service/run-burnticker-backup.sh) against fixture databases in a temporary root: the online backup, quick_check,
// rotation to 14, the off-box copy (a local directory stands in for the destination), the skip line when no destination is named, the
// refusal of env and key files, a failing run's status file, and a timed restore drill.
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SCRIPT = path.resolve("scripts/service/run-burnticker-backup.sh");
const hasSqlite = spawnSync("sqlite3", ["-version"]).status === 0;
const sql = (db: string, q: string) => execFileSync("sqlite3", [db, q], { encoding: "utf8" }).trim();
function run(root: string, args: string[] = [], env: Record<string, string> = {}) {
  const r = spawnSync("sh", [SCRIPT, ...args], { encoding: "utf8", env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: root, BURNTICKER_BACKUP_ROOT: root, ...env } as unknown as NodeJS.ProcessEnv });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}
const status = (root: string) => JSON.parse(fs.readFileSync(path.join(root, "data/backups/last-backup.json"), "utf8")) as { ok: boolean; files: string[]; offBox: string; error: string | null };

describe("the database backup (F-7)", { skip: !hasSqlite && "sqlite3 is not installed here" }, () => {
  let root = "";
  before(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "bt-backup-"));
    fs.mkdirSync(path.join(root, "data"));
    sql(path.join(root, "data/burnticker.db"), "PRAGMA journal_mode=WAL; CREATE TABLE receipts (id INTEGER PRIMARY KEY, tx TEXT); INSERT INTO receipts (tx) VALUES ('a'),('b'),('c');");
    sql(path.join(root, "data/burnkeeper.db"), "CREATE TABLE burns (id INTEGER PRIMARY KEY); INSERT INTO burns DEFAULT VALUES;");
    sql(path.join(root, "data/burnticker-mintbank.db"), "CREATE TABLE keys (pub TEXT); INSERT INTO keys VALUES ('k');");
    fs.writeFileSync(path.join(root, ".env.local"), "BURNTICKER_MINT_BANK_KEY=do-not-copy\nOTHER=1\n");
  });
  after(() => fs.rmSync(root, { recursive: true, force: true }));

  test("a run backs up the three databases, checks each copy, and says the off-box copy is skipped when no destination is named", () => {
    const r = run(root);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /off-box copy SKIPPED: BURNTICKER_BACKUP_DEST is not set/);
    const s = status(root);
    assert.equal(s.ok, true); assert.equal(s.offBox, "skipped"); assert.equal(s.files.length, 3);
    for (const f of s.files) {
      assert.equal(sql(path.join(root, f), "PRAGMA quick_check;"), "ok");
      assert.equal(fs.statSync(path.join(root, f)).mode & 0o077, 0, `${f} is readable by others`);
    }
    const reg = s.files.find((f) => /\/burnticker-\d/.test(f))!;
    assert.equal(sql(path.join(root, reg), "SELECT count(*) FROM receipts;"), "3");
    assert.ok(!fs.readdirSync(path.join(root, "data/backups")).some((f) => /env|key/i.test(f)), "no env or key file in the backups");
  });

  test("rotation keeps the newest 14 of each database", () => {
    for (let i = 0; i < 16; i++) assert.equal(run(root).code, 0);
    const files = fs.readdirSync(path.join(root, "data/backups"));
    assert.equal(files.filter((f) => /^burnticker-\d.*\.db$/.test(f)).length, 14);
    assert.equal(files.filter((f) => /^burnkeeper-\d.*\.db$/.test(f)).length, 14);
    assert.equal(files.filter((f) => /^burnticker-mintbank-\d.*\.db$/.test(f)).length, 14);
  });

  test("with a destination: this run's files are copied off the box, never the mint key bank", () => {
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), "bt-backup-dest-"));
    try {
      const r = run(root, [], { BURNTICKER_BACKUP_DEST: dest });
      assert.equal(r.code, 0, r.out);
      assert.equal(status(root).offBox, "copied");
      const copied = fs.readdirSync(dest);
      assert.equal(copied.length, 2, copied.join(" "));
      assert.ok(copied.some((f) => f.startsWith("burnticker-2")) && copied.some((f) => f.startsWith("burnkeeper-")));
      assert.ok(!copied.some((f) => f.includes("mintbank")));
    } finally { fs.rmSync(dest, { recursive: true, force: true }); }
  });

  // SECOND 2026-10-18 AUDIT A-15: each backup of a WAL database left -wal and -shm files beside it (macOS) that rotation never removed,
  // and the destination kept every copy forever. Now no sidecar is left, rotation removes any it finds, and the destination keeps 30 days.
  test("A-15: no -wal or -shm beside a backup; rotation removes old sidecars; the destination keeps 30 days of this script's copies", () => {
    const bk = path.join(root, "data/backups");
    // a sidecar left by an earlier run beside a backup that rotation removes, and one beside a backup already gone
    const orphan = path.join(bk, "burnticker-20200101T000000Z-000.db");
    fs.writeFileSync(orphan, "old"); fs.writeFileSync(`${orphan}-wal`, "x"); fs.writeFileSync(`${orphan}-shm`, "x");
    fs.writeFileSync(path.join(bk, "burnkeeper-20200101T000000Z-000.db-shm"), "x");
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), "bt-backup-dest-"));
    const day = 86_400;
    const old = path.join(dest, "burnticker-20250101T000000Z-000.db"), recent = path.join(dest, "burnticker-20260101T000000Z-000.db"), other = path.join(dest, "notes.txt");
    for (const f of [old, recent, other]) fs.writeFileSync(f, "x");
    const now = Date.now() / 1000;
    fs.utimesSync(old, now - 40 * day, now - 40 * day); fs.utimesSync(other, now - 40 * day, now - 40 * day); fs.utimesSync(recent, now - 10 * day, now - 10 * day);
    try {
      const r = run(root, [], { BURNTICKER_BACKUP_DEST: dest });
      assert.equal(r.code, 0, r.out);
      const left = fs.readdirSync(bk);
      assert.deepEqual(left.filter((f) => /-(wal|shm|journal)$/.test(f)), [], left.join(" "));
      assert.ok(!fs.existsSync(orphan), "the oldest backup was rotated out");
      const there = fs.readdirSync(dest);
      assert.ok(!there.includes(path.basename(old)), "a copy older than 30 days is removed at the destination");
      assert.ok(there.includes(path.basename(recent)), "a copy inside 30 days stays");
      assert.ok(there.includes("notes.txt"), "a file this script did not name is never touched");
      assert.match(r.out, /off-box copies older than 30 days removed/);
      for (const f of status(root).files) assert.equal(sql(path.join(root, f), "PRAGMA journal_mode;"), "delete");
    } finally { fs.rmSync(dest, { recursive: true, force: true }); }
  });

  // review of A-15 (2026-10-18): `find '~/x'` on the remote never expands the ~, so a home-relative destination failed every prune;
  // and the rclone prune must not descend into folders. Fake scp / ssh / rclone record what they were asked to run.
  test("review: a ~/ destination is pruned relative to the remote home; the rclone prune stays at the top level", () => {
    const bin = fs.mkdtempSync(path.join(os.tmpdir(), "bt-backup-bin-"));
    const rec = path.join(bin, "calls.log");
    for (const tool of ["scp", "ssh", "rclone"]) {
      fs.writeFileSync(path.join(bin, tool), `#!/bin/sh\nprintf '%s\\n' "${tool} $*" >> '${rec}'\nexit 0\n`, { mode: 0o755 });
    }
    const PATHX = `${bin}:${process.env.PATH ?? "/usr/bin:/bin"}`;
    try {
      for (const [dest, want] of [["mct@backup-box:~/bt-backups", "'bt-backups'"], ["mct@backup-box:~", "'.'"], ["mct@backup-box:/srv/bt", "'/srv/bt'"]] as const) {
        fs.rmSync(rec, { force: true });
        const r = run(root, [], { PATH: PATHX, BURNTICKER_BACKUP_DEST: dest });
        assert.equal(r.code, 0, r.out);
        const calls = fs.readFileSync(rec, "utf8");
        const ssh = calls.split("\n").find((l) => l.startsWith("ssh "))!;
        assert.ok(ssh, calls);
        assert.match(ssh, new RegExp(`find ${want.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")} -maxdepth 1 -type f -name `), ssh);
        assert.doesNotMatch(ssh, /'~/, "never a quoted ~");
        assert.match(r.out, /off-box copies older than 30 days removed/);
      }
      fs.rmSync(rec, { force: true });
      const r = run(root, [], { PATH: PATHX, BURNTICKER_BACKUP_DEST: "rclone:remote:bt" });
      assert.equal(r.code, 0, r.out);
      assert.match(fs.readFileSync(rec, "utf8"), /^rclone delete --min-age 30d --max-depth 1 --include \S+ remote:bt$/m);
    } finally { fs.rmSync(bin, { recursive: true, force: true }); }
  });

  test("the destination may be named on its one line of .env.local; no other line is used", () => {
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), "bt-backup-dest-"));
    const env = path.join(root, ".env.local");
    const before = fs.readFileSync(env, "utf8");
    try {
      fs.writeFileSync(env, `${before}BURNTICKER_BACKUP_DEST=${dest}\n`);
      const r = run(root);
      assert.equal(r.code, 0, r.out);
      assert.equal(fs.readdirSync(dest).length, 2);
      assert.doesNotMatch(r.out, /do-not-copy/);
    } finally { fs.writeFileSync(env, before); fs.rmSync(dest, { recursive: true, force: true }); }
  });

  test("an env or key file in the list is refused; a broken database fails the run and says why", () => {
    const r = run(root, [], { BURNTICKER_BACKUP_DBS: "data/burnticker.db .env.local" });
    assert.equal(r.code, 1);
    assert.match(status(root).error ?? "", /env or key file/);
    fs.writeFileSync(path.join(root, "data/broken.db"), "this is not a database at all, just text that is long enough to have a page".repeat(80));
    const b = run(root, [], { BURNTICKER_BACKUP_DBS: "data/broken.db", BURNTICKER_BACKUP_REQUIRED: "data/broken.db" });
    assert.equal(b.code, 1, b.out);
    const s = status(root);
    assert.equal(s.ok, false); assert.ok(s.error);
  });

  test("the restore drill: a backup restores into a new file in seconds, checked, and never over an existing file", () => {
    assert.equal(run(root).code, 0);
    const file = status(root).files.find((f) => /\/burnticker-\d/.test(f))!;
    const to = path.join(root, "restore/burnticker.db");
    const t0 = Date.now();
    const r = run(root, ["--restore", file, "--to", to]);
    const ms = Date.now() - t0;
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /restored .* in \d+ s \(quick_check ok\)/);
    assert.ok(ms < 10_000, `the restore took ${ms} ms`);
    assert.equal(sql(to, "SELECT group_concat(tx) FROM receipts;"), "a,b,c");
    const again = run(root, ["--restore", file, "--to", to]);
    assert.equal(again.code, 2);
    assert.match(again.out, /exists\. Stop the unit/);
    assert.equal(run(root, ["--restore", path.join(root, ".env.local"), "--to", path.join(root, "x.db")]).code, 2);
  });

  test("hardening (F-7 review): a busy-wait timeout on every sqlite3 call, the reason in the log, no option-like destination, no restore over a leftover -wal or -journal", () => {
    const src = fs.readFileSync(SCRIPT, "utf8");
    const calls = src.split("\n").filter((l) => /\bsqlite3 /.test(l) && !/^\s*#/.test(l) && !/command -v sqlite3/.test(l));
    assert.ok(calls.length >= 4 && calls.every((l) => l.includes('-cmd ".timeout 10000"')), calls.filter((l) => !l.includes(".timeout")).join("\n"));
    assert.doesNotMatch(src, /\.backup '\$out'" 2>\/dev\/null/);
    // a database that cannot be read: the first line of sqlite3's own error is in the log
    fs.writeFileSync(path.join(root, "data/broken2.db"), "not a database".repeat(400));
    const b = run(root, [], { BURNTICKER_BACKUP_DBS: "data/broken2.db", BURNTICKER_BACKUP_REQUIRED: "data/broken2.db" });
    assert.equal(b.code, 1);
    assert.match(b.out, /backup FAILED: .*(not a database|file is not|malformed)/i);
    // a destination that starts with "-" is refused before scp sees it
    const d = run(root, [], { BURNTICKER_BACKUP_DEST: "-oProxyCommand=x" });
    assert.equal(d.code, 1); assert.match(d.out, /refused the destination/); assert.equal(status(root).offBox, "refused");
    // F-7 re-review: trimmed first, and the same after rclone:, and a set-but-blank value is refused rather than skipped
    for (const bad of ["  -oProxyCommand=x", "rclone:-x", "rclone:", "   "]) {
      const r = run(root, [], { BURNTICKER_BACKUP_DEST: bad });
      assert.equal(r.code, 1, `${JSON.stringify(bad)}: ${r.out}`); assert.equal(status(root).offBox, "refused", JSON.stringify(bad));
    }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bt-backup-trim-"));
    try { const r = run(root, [], { BURNTICKER_BACKUP_DEST: `  ${dir}  ` }); assert.equal(r.code, 0, r.out); assert.equal(status(root).offBox, "copied"); }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
    // restore over a leftover journal of an old file is refused
    assert.equal(run(root).code, 0);
    const file = status(root).files.find((f) => /\/burnticker-\d/.test(f))!;
    for (const suffix of ["-wal", "-journal"]) {
      const to = path.join(root, `restore-${suffix}/burnticker.db`);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.writeFileSync(`${to}${suffix}`, "left over");
      const r = run(root, ["--restore", file, "--to", to]);
      assert.equal(r.code, 2, r.out); assert.match(r.out, new RegExp(`${suffix} exists`));
      assert.ok(!fs.existsSync(to));
    }
    const rb = fs.readFileSync("docs/burnticker/runbook.md", "utf8");
    assert.doesNotMatch(rb, /rm -f data\/burnticker\.db-wal/);
    assert.ok(rb.includes("mv data/burnticker.db-$x data/burnticker.db-$x.before-restore"), "the runbook moves -wal/-shm aside");
  });

  test("the units are in the repo and installed with the rest", () => {
    const svc = fs.readFileSync("deploy/systemd/mct-burnticker-backup.service", "utf8"), tmr = fs.readFileSync("deploy/systemd/mct-burnticker-backup.timer", "utf8");
    assert.match(svc, /ExecStart=\/bin\/sh %h\/meme-coin-trader\/scripts\/service\/run-burnticker-backup\.sh/);
    assert.doesNotMatch(svc, /EnvironmentFile/);
    assert.match(tmr, /OnCalendar=\*-\*-\* 00\/6:17:00 UTC/);
    const inst = fs.readFileSync("scripts/ops/install-burnticker-units.sh", "utf8");
    assert.match(inst, /^UNITS="[^"]*mct-burnticker-backup\.service mct-burnticker-backup\.timer/m);
    assert.match(inst, /^TIMERS=".*mct-burnticker-backup\.timer/m);
  });
});
