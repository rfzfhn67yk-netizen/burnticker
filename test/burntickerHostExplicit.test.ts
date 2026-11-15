// OP7-9 (seventh pre-launch audit; OP6-7, OP-5): the deploy and rollback scripts defaulted to root@mct-burnticker, a name this Mac did not
// know, and two scripts kept the host's private address in the repository. Every host script now takes BURNTICKER_HOST, else the
// operator's untracked burnticker-host file, and refuses with a clear sentence when neither is set.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = path.join(import.meta.dirname, "..");
const SCRIPTS = ["scripts/ops/rollback-burnticker.sh", "scripts/ops/deploy-burnticker-host.sh", "scripts/ops/loadtest.sh", "scripts/ops/burnticker-daycheck.sh", "scripts/ops/publish-and-deploy.sh", "scripts/ops/mac/box-backup-pull.sh"];

describe("OP7-9: the host is explicit", () => {
  test("no script keeps an address or a default host", () => {
    for (const f of SCRIPTS) {
      if (!fs.existsSync(path.join(ROOT, f))) continue;   // the public tree has only some of them
      const s = fs.readFileSync(path.join(ROOT, f), "utf8");
      assert.doesNotMatch(s, /\b100\.\d+\.\d+\.\d+\b/, `${f}: no address`);
      assert.doesNotMatch(s, /BURNTICKER_HOST:-root@/, `${f}: no default host`);
      assert.match(s, /refused: the Burnticker host is not set/, `${f}: the refusal`);
    }
  });
  test("with neither the env nor the file, the rollback refuses before it reaches anything; the file alone is enough", (t) => {
    if (!fs.existsSync(path.join(ROOT, "scripts/ops/rollback-burnticker.sh"))) return t.skip("the rollback script is monorepo-private (public-gate lesson: a private script is skipped, never run)");
    const cfg = fs.mkdtempSync(path.join(os.tmpdir(), "bt-host-"));
    const env = { PATH: process.env.PATH ?? "", HOME: cfg, XDG_CONFIG_HOME: cfg } as unknown as NodeJS.ProcessEnv;
    const r = spawnSync("sh", [path.join(ROOT, "scripts/ops/rollback-burnticker.sh"), "--previous-release", "--dry-run"], { env, encoding: "utf8", cwd: ROOT });
    assert.equal(r.status, 2); assert.match(r.stderr, /refused: the Burnticker host is not set\. Export BURNTICKER_HOST=root@<host>, or write it on the first line of /);
    // the file names a host: the script gets past the check (a fake ssh that only says what it was asked to reach, then fails)
    fs.mkdirSync(path.join(cfg, "meme-coin-trader"), { recursive: true });
    fs.writeFileSync(path.join(cfg, "meme-coin-trader", "burnticker-host"), "root@example-host\n");
    const fake = path.join(cfg, "fake-ssh"); fs.writeFileSync(fake, "#!/bin/sh\necho \"reached $1\" >&2\nexit 7\n"); fs.chmodSync(fake, 0o755);
    const r2 = spawnSync("sh", [path.join(ROOT, "scripts/ops/rollback-burnticker.sh"), "--previous-release", "--dry-run"], { env: { ...env, BURNTICKER_SSH: fake } as NodeJS.ProcessEnv, encoding: "utf8", cwd: ROOT });
    assert.doesNotMatch(r2.stderr, /host is not set/);
    assert.match(r2.stdout + r2.stderr, /root@example-host/);
    fs.rmSync(cfg, { recursive: true, force: true });
  });
});
