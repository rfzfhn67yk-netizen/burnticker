// DEPLOY-REQUESTED RESTART (2026-10-15; src/lib/burnticker/restartRequest.ts, scripts/ops/request-keeper-restart.sh). The deploy drops
// data/restart-requested.<unit>; the keeper and the mint bank take it at the end of a cycle, log it, and exit 0 for systemd to restart.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { clearStaleRestartRequest, restartRequestPath, takeRestartRequest, writeRestartRequest } from "@/lib/burnticker/restartRequest";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "bt-restart-"));

describe("the restart request", () => {
  test("taken once: the build id is read, the file removed, a second take finds nothing (no restart loop)", () => {
    const root = tmp();
    try {
      assert.equal(takeRestartRequest("keeper", { root }), null);
      writeRestartRequest("keeper", "build-abc123", { root, now: Date.parse("2026-10-15T23:00:00Z") });
      const r = takeRestartRequest("keeper", { root, startedAt: Date.parse("2026-10-15T22:00:00Z") });
      assert.deepEqual({ build: r?.build, at: r?.at }, { build: "build-abc123", at: "2026-10-15T23:00:00.000Z" });
      assert.equal(fs.existsSync(restartRequestPath("keeper", root)), false);
      assert.equal(takeRestartRequest("keeper", { root }), null);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
  test("each unit has its own file: the keeper's request does not restart the mint bank", () => {
    const root = tmp();
    try {
      writeRestartRequest("keeper", "b1", { root });
      assert.equal(takeRestartRequest("mintbank", { root }), null);
      assert.equal(takeRestartRequest("keeper", { root })?.build, "b1");
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
  test("a request already on disk at startup is stale (this process already runs that code): clearStaleRestartRequest removes it", () => {
    const root = tmp();
    try {
      writeRestartRequest("keeper", "b2", { root, now: Date.parse("2026-10-15T20:00:00Z") });
      assert.equal(clearStaleRestartRequest("keeper", { root })?.build, "b2");
      assert.equal(takeRestartRequest("keeper", { root }), null, "never honoured after the first cycle");
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
  test("the deploy's shell script writes both units' requests with the build id", () => {
    const root = tmp();
    try {
      fs.mkdirSync(path.join(root, "scripts", "ops"), { recursive: true });
      fs.copyFileSync("scripts/ops/request-keeper-restart.sh", path.join(root, "scripts", "ops", "request-keeper-restart.sh"));
      const out = execFileSync("sh", [path.join(root, "scripts", "ops", "request-keeper-restart.sh"), "BUILD_XYZ"], { encoding: "utf8" });
      assert.match(out, /restart requested for the keeper and the mint bank \(build BUILD_XYZ\)/);
      for (const u of ["keeper", "mintbank"]) assert.equal(takeRestartRequest(u, { root })?.build, "BUILD_XYZ");
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
  test("wiring: the keeper checks at the end of its loop and exits through the normal stop path; the mint bank between fills; the deploy drops the requests", () => {
    const keeper = fs.readFileSync("scripts/burnticker-keeper.mts", "utf8");
    const tail = keeper.slice(keeper.indexOf("budget.setPhase(\"ops\")"));
    assert.match(tail, /takeRestartRequest\("keeper"[\s\S]*restart requested by deploy \$\{restart\.build\}[\s\S]*break;[\s\S]*t < 60_000 && !stopping/);
    assert.match(keeper, /registry\.close\(\);\nlog\("burnticker keeper stopped"\);/);
    const bank = fs.readFileSync("scripts/burnticker-mint-bank.mts", "utf8");
    assert.match(bank, /takeRestartRequest\("mintbank"[\s\S]*restart requested by deploy/);
    // the deploy script is private (not in the public tree): its wiring is checked only where it exists
    if (fs.existsSync("scripts/ops/deploy-burnticker-host.sh")) {
      const deploy = fs.readFileSync("scripts/ops/deploy-burnticker-host.sh", "utf8");
      assert.match(deploy, /sh scripts\/ops\/request-keeper-restart\.sh/);
      assert.doesNotMatch(deploy, /systemctl --user restart mct-burnticker-keeper/, "the deploy never restarts the keeper mid-crank");
    }
    assert.match(fs.readFileSync("config/public-repo.allowlist", "utf8"), /^scripts\/ops\/request-keeper-restart\.sh$/m);
    for (const unit of ["deploy/systemd/mct-burnticker-keeper.service", "deploy/systemd/mct-burnticker-mintbank.service"]) assert.match(fs.readFileSync(unit, "utf8"), /^Restart=always$/m, `${unit}: exit 0 must bring it back`);
  });
  /** The real keeper over the fake program in a temp directory (nothing is sent, nothing is read from a chain). */
  const runKeeper = (root: string, args: string[]) => {
    const repo = process.cwd();
    const child = spawn(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--import", path.join(repo, "test", "alias-hook.mjs"), path.join(repo, "scripts", "burnticker-keeper.mts"), ...args],
      { cwd: root, env: { PATH: process.env.PATH ?? "", HOME: root, BURNTICKER_DB: path.join(root, "r.db"), BURNTICKER_PUBLISH_DIR: path.join(root, "site") } as unknown as NodeJS.ProcessEnv, stdio: ["ignore", "pipe", "pipe"] });
    const o = { out: "", child, code: null as Promise<number | null> | null };
    child.stdout?.on("data", (d: Buffer) => { o.out += String(d); });
    child.stderr?.on("data", (d: Buffer) => { o.out += String(d); });
    o.code = new Promise<number | null>((r) => { const t = setTimeout(() => { child.kill("SIGKILL"); r(-1); }, 100_000); child.on("exit", (c) => { clearTimeout(t); r(c); }); });
    return o;
  };
  test("the real keeper: a request on disk at startup is removed as stale; one written while it runs is taken after the cycle and exits 0", { timeout: 120_000 }, async () => {
    const root = tmp();
    try {
      writeRestartRequest("keeper", "B-OLD", { root });
      const k = runKeeper(root, []);
      const deadline = Date.now() + 60_000;
      while (!/burnticker keeper starting/.test(k.out) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200));
      assert.match(k.out, /stale restart request \(build B-OLD\) removed/);
      assert.equal(fs.existsSync(restartRequestPath("keeper", root)), false);
      writeRestartRequest("keeper", "B-NEW", { root });
      assert.equal(await k.code, 0, k.out.slice(-1_500));
      assert.match(k.out, /restart requested by deploy B-NEW/);
      assert.doesNotMatch(k.out, /restart requested by deploy B-OLD/);
      assert.ok(k.out.indexOf("restart requested by deploy B-NEW") > k.out.indexOf("[refuse-list]"), "after the cycle's work, not before it");
      assert.match(k.out, /burnticker keeper stopped/);
      assert.equal(fs.existsSync(restartRequestPath("keeper", root)), false);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
  test("a dry run neither takes nor removes a request (the live keeper on the same host still sees it)", { timeout: 120_000 }, async () => {
    const root = tmp();
    try {
      writeRestartRequest("keeper", "B-LIVE", { root });
      const k = runKeeper(root, ["--once", "--dry-run"]);
      assert.equal(await k.code, 0, k.out.slice(-1_500));
      assert.doesNotMatch(k.out, /restart requested|stale restart request/);
      assert.equal(takeRestartRequest("keeper", { root })?.build, "B-LIVE");
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
  test("the deploy's --wait: success once BOTH logs show the request taken and a new start (a keeper waiting at startup counts); exit 3 naming the one that did not", { timeout: 90_000 }, async () => {
    const root = tmp();
    try {
      fs.mkdirSync(path.join(root, "scripts", "ops"), { recursive: true }); fs.mkdirSync(path.join(root, "logs"));
      fs.copyFileSync("scripts/ops/request-keeper-restart.sh", path.join(root, "scripts", "ops", "request-keeper-restart.sh"));
      const klog = path.join(root, "logs", "burnticker-keeper.log"), mlog = path.join(root, "logs", "burnticker-mintbank.log");
      fs.writeFileSync(klog, "[old] burnticker keeper starting\n[old] restart requested by deploy BW\n");   // lines from before the request never count
      fs.writeFileSync(mlog, "[old] mint key bank: x\n");
      const script = path.join(root, "scripts", "ops", "request-keeper-restart.sh");
      const run = (secs: number) => new Promise<{ code: number | null; out: string }>((r) => {
        const c = spawn("sh", [script, "BW", "--wait", String(secs)]); let out = "";
        c.stdout.on("data", (d: Buffer) => { out += String(d); }); c.on("exit", (code) => r({ code, out }));
      });
      const timeout = await run(6);
      assert.equal(timeout.code, 3, timeout.out);
      assert.match(timeout.out, /KEEPER DID NOT RESTART within 6 s: the request is still waiting/);
      assert.match(timeout.out, /MINT BANK DID NOT RESTART within 6 s/);
      // the keeper comes back but waits at startup (a busy budget); the mint bank never logs: exit 3 names only the mint bank
      const partial = run(12);
      await new Promise((r) => setTimeout(r, 1_500));
      fs.appendFileSync(klog, "[x] restart requested by deploy BW: exiting between cycles\n[y]   [api-budget] startup (the genesis read) waits: busy\n");
      const p1 = await partial;
      assert.equal(p1.code, 3, p1.out);
      assert.match(p1.out, /keeper restarted on build BW/);
      assert.doesNotMatch(p1.out, /KEEPER DID NOT RESTART/);
      assert.match(p1.out, /MINT BANK DID NOT RESTART/);
      const ok = run(30);
      await new Promise((r) => setTimeout(r, 1_500));
      fs.appendFileSync(klog, "[x] restart requested by deploy BW: exiting\n[y] burnticker keeper starting — 6 live token(s)\n");
      fs.appendFileSync(mlog, "[x] restart requested by deploy BW: exiting between fills\n[y] mint key bank: data/x, size 50\n");
      const res = await ok;
      assert.equal(res.code, 0, res.out);
      assert.match(res.out, /keeper restarted on build BW after \d+ s/);
      assert.match(res.out, /mint bank restarted on build BW after \d+ s/);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
  test("wiring: the startup wait ends on a new request; --restart-keepers says it no longer restarts the Burnticker keeper", () => {
    const keeper = fs.readFileSync("scripts/burnticker-keeper.mts", "utf8");
    assert.match(keeper, /stop: \(\) => stopping \|\| restartAskedDuringStartup\(\)/);
    assert.match(keeper, /if \(!DRY\) \{ const stale = clearStaleRestartRequest\("keeper"\)/);
    assert.match(keeper, /const restart = DRY \? null : takeRestartRequest\("keeper"/);
    if (fs.existsSync("scripts/ops/deploy-burnticker-host.sh")) {
      const deploy = fs.readFileSync("scripts/ops/deploy-burnticker-host.sh", "utf8");
      assert.match(deploy, /--restart-keepers: restarts mct-burnkeeper \(the \\\$DEFICIT keeper\) only/);
      assert.match(deploy, /request-keeper-restart\.sh --wait 300/);
    }
    assert.match(fs.readFileSync("scripts/burnticker-mint-bank.mts", "utf8"), /clearStaleRestartRequest\("mintbank"\)/);
  });
});
