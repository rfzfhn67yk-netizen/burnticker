// HOST UNIT HYGIENE (2026-10-18 prelaunch audit A-32): every oneshot Burnticker unit has a start timeout.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = path.resolve(import.meta.dirname, "..");
const UNITS = path.join(ROOT, "deploy/systemd");
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");

describe("host unit hygiene (A-32)", () => {
  test("the every-minute publish unit ends a stuck pass after two minutes", () => {
    assert.match(read("deploy/systemd/mct-burnticker-publish.service"), /^TimeoutStartSec=120$/m);
  });

  test("every Burnticker oneshot unit has a TimeoutStartSec (a oneshot has none by default)", () => {
    const missing = fs.readdirSync(UNITS).filter((f) => /^mct-burn(ticker|keeper).*\.service$/.test(f))
      .filter((f) => /^Type=oneshot$/m.test(fs.readFileSync(path.join(UNITS, f), "utf8")) && !/^TimeoutStartSec=\d+$/m.test(fs.readFileSync(path.join(UNITS, f), "utf8")));
    assert.deepEqual(missing, []);
  });

  test("logs/*.log rotate daily, 14 kept, compressed, copytruncate (the units append through systemd and cannot reopen)", () => {
    const conf = read("deploy/logrotate/burnticker");
    const block = /^@REPO@\/logs\/\*\.log \{\n([\s\S]*?)\n\}$/m.exec(conf);
    assert.ok(block, "one block for @REPO@/logs/*.log");
    const lines = block![1].split("\n").map((l) => l.trim()).filter(Boolean);
    for (const d of ["su @USER@ @GROUP@", "daily", "rotate 14", "compress", "missingok", "notifempty", "copytruncate"]) assert.ok(lines.includes(d), d);
    for (const u of fs.readdirSync(UNITS).filter((f) => /^mct-burn(ticker|keeper).*\.service$/.test(f))) {
      for (const m of fs.readFileSync(path.join(UNITS, u), "utf8").matchAll(/^Standard(?:Output|Error)=append:%h\/meme-coin-trader\/(.*)$/gm)) assert.match(m[1], /^logs\/[^/]+\.log$/, `${u} logs outside logs/*.log: ${m[1]}`);
    }
  });

  test("a user-level daily timer runs logrotate with the user's own state file; the installer renders the config and enables the timer", () => {
    const svc = read("deploy/systemd/mct-burnticker-logrotate.service");
    assert.match(svc, /^Type=oneshot$/m);
    assert.match(svc, /^ExecStart=\/usr\/sbin\/logrotate --state %h\/\.local\/state\/burnticker-logrotate\.status %h\/\.config\/burnticker\/logrotate\.conf$/m);
    assert.match(svc, /^TimeoutStartSec=\d+$/m);
    const timer = read("deploy/systemd/mct-burnticker-logrotate.timer");
    assert.match(timer, /^OnCalendar=\*-\*-\* 03:40:00 UTC$/m); assert.match(timer, /^Persistent=true$/m); assert.match(timer, /^Unit=mct-burnticker-logrotate\.service$/m);
    const sh = read("scripts/ops/install-burnticker-units.sh");
    assert.match(sh, /^UNITS=".*\bmct-burnticker-logrotate\.service mct-burnticker-logrotate\.timer\b.*"$/m);
    assert.match(sh, /^TIMERS=".*\bmct-burnticker-logrotate\.timer\b.*"$/m);
    // rendered as plain text (no sed), validated with logrotate -d before it replaces anything, and no logrotate binary is a STOP
    // L-5 (2026-10-19): the deploy installs from a release directory and names the release link (BT_UNITS_ROOT); by hand, this directory
    assert.match(sh, /node scripts\/ops\/render-logrotate\.mjs deploy\/logrotate\/burnticker "\$\{BT_UNITS_ROOT:-\$\(pwd\)\}" "\$\(id -un\)" "\$\(id -gn\)" > "\$LR_NEW"/);
    assert.doesNotMatch(sh, /sed "s\|@REPO@/);
    assert.match(sh, /if ! \/usr\/sbin\/logrotate -d --state "\$LR_STATE" "\$LR_NEW"/);
    assert.ok(sh.indexOf("logrotate -d --state") < sh.indexOf('act cp "$LR_NEW" "$LR_DEST"'), "validated before it is installed");
    const stop = sh.indexOf('if [ ! -x /usr/sbin/logrotate ]; then say "STOP: /usr/sbin/logrotate is not installed');
    assert.ok(stop > 0 && stop < sh.indexOf("for u in $UNITS; do"), "no logrotate: exit 1 before any change");
    assert.match(sh.slice(stop, sh.indexOf("\n", stop)), /exit 1; fi$/);
    assert.doesNotMatch(sh, /logrotate: ABSENT/);
    assert.match(sh, /LR_DEST="\$HOME\/\.config\/burnticker\/logrotate\.conf"/);
    assert.match(sh, /\[ -d "\$HOME\/\.local\/state" \] \|\| act mkdir -p "\$HOME\/\.local\/state"/);
    const allow = read("config/public-repo.allowlist");
    assert.match(allow, /^deploy\/logrotate\/burnticker$/m, "the host runs the public tree: the template is published");
    assert.match(allow, /^scripts\/ops\/render-logrotate\.mjs$/m);
  });

  test("the entrypoints only ever APPEND to logs/ (a truncating `>` opened before a copytruncate keeps its offset and leaves a hole of NUL bytes)", () => {
    const bad: string[] = [];
    for (const f of fs.readdirSync(path.join(ROOT, "scripts/service")).filter((n) => /^run-burn.*\.sh$/.test(n))) {
      read(`scripts/service/${f}`).split("\n").forEach((line, i) => { if (/(^|[^>&0-9])>\s*"?logs\//.test(line)) bad.push(`${f}:${i + 1}: ${line.trim().slice(0, 120)}`); });
    }
    assert.deepEqual(bad, []);
    assert.match(read("scripts/service/run-burnticker-synth.sh"), />> "logs\/burnticker-synth-web-\$1\.log" 2>&1 &/);
  });

  test("the renderer writes a path holding &, | and \\ as it is (the sed-ampersand class of bug), and refuses what logrotate would misread", () => {
    const tpl = read("deploy/logrotate/burnticker");
    const odd = "/srv/a&b|c\\d/meme-coin-trader";
    const r = spawnSync(process.execPath, [path.join(ROOT, "scripts/ops/render-logrotate.mjs"), path.join(ROOT, "deploy/logrotate/burnticker"), odd, "mct", "mct"], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.stdout.includes(`${odd}/logs/*.log {\n    su mct mct\n`), r.stdout.slice(-300));
    assert.equal(r.stdout.includes("@"), false, "every placeholder filled");
    assert.equal(r.stdout.split(odd).length - 1, 1, "the path appears once, verbatim");
    assert.equal(r.stdout.replace(odd, "@REPO@").replace("su mct mct", "su @USER@ @GROUP@"), tpl, "nothing else changed");
    for (const [repo, user] of [["relative/dir", "mct"], ["/has space/x", "mct"], ["/ok", "bad user"], ["/ok", "x;rm"]]) {
      const bad = spawnSync(process.execPath, [path.join(ROOT, "scripts/ops/render-logrotate.mjs"), path.join(ROOT, "deploy/logrotate/burnticker"), repo, user, "mct"], { encoding: "utf8" });
      assert.equal(bad.status, 2, `${repo} ${user}`); assert.equal(bad.stdout, "");
    }
  });

  test("log timestamps are in one zone: UTC, written with a Z (the units run with TZ=America/Denver, so a bare `date` was local)", () => {
    // burnticker-daycheck.sh is an on-screen summary for the owner in Denver time (it names the zone), not a log; the rollback script
    // is maintained with the swap (a separate change)
    const files = [
      ...fs.readdirSync(path.join(ROOT, "scripts/service")).filter((f) => /^run-burn.*\.sh$/.test(f)).map((f) => `scripts/service/${f}`),
      ...["deploy-sites.sh", "probe-burnticker.sh", "reproducible-build-host.sh", "deploy-burnticker-host.sh", "request-keeper-restart.sh", "keeper-status-check.sh"].map((f) => `scripts/ops/${f}`),
    ].filter((f) => fs.existsSync(path.join(ROOT, f)));
    assert.ok(files.length >= 10, String(files.length));
    const bad: string[] = [];
    for (const f of files) read(f).split("\n").forEach((line, i) => {
      for (const m of line.matchAll(/\bdate\b([^)`;|]*?)(['"]?\+[^'"\s)]*(%H:|%T)[^'"\s)]*['"]?)/g)) if (!/(^|\s)-u\b/.test(m[1]) || !/Z['"]?$/.test(m[2])) bad.push(`${f}:${i + 1}: ${line.trim().slice(0, 120)}`);
    });
    assert.deepEqual(bad, []);
    assert.match(read("scripts/burnticker-mint-bank.mts"), /const stamp = \(\) => `\$\{new Date\(\)\.toISOString\(\)\.replace\("T", " "\)\.slice\(0, 19\)\}Z`;/);
    for (const f of ["scripts/burnticker-keeper.mts", "scripts/burn-keeper.mts"]) assert.match(read(f), /toISOString\(\)\.replace\("T", " "\)\.slice\(0, 19\)\}Z\]/, f);
  });
});
