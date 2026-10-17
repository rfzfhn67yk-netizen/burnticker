// THIRD PRELAUNCH AUDIT F02 (2026-10-16, P1): the deploy's web smoke treated `curl -s` success as "web is up" (curl exits 0 on an HTTP 403
// or 500) and then deleted .next-old, the rollback build. scripts/ops/swap-web-build.sh (run on the host by deploy-burnticker-host.sh) now
// checks the status, the page text and the STAGED build id under one bounded deadline, keeps the previous release, and swaps it back by
// itself on failure. Rehearsed here against an isolated local server whose answer depends on the build in `.next` (its MODE file):
// 200 / 500 / 403 / 404 / the wrong build id / no answer at all.
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import type { AddressInfo } from "node:net";

const SCRIPT = path.join(import.meta.dirname, "..", "scripts", "ops", "swap-web-build.sh");
type Mode = "ok" | "500" | "403" | "404" | "wrong" | "hang" | "no-page" | "legacy";

let server: http.Server, url = "", dir = "";
before(async () => {
  server = http.createServer((req, res) => {
    const read = (f: string) => { try { return fs.readFileSync(path.join(dir, ".next", f), "utf8").trim(); } catch { return ""; } };
    const mode = (read("MODE") || "ok") as Mode, id = read("BUILD_ID");
    if (mode === "hang") return;                                      // never answers (the request times out)
    if (mode === "500" || mode === "403" || mode === "404") { res.writeHead(Number(mode), { "content-type": "text/html" }); res.end(`<h1>${mode}</h1> Burnticker`); return; }
    // the process start time is the last restart (the restart command appends to restarts.log); a build from before startedAt existed omits it
    let startedAt = 1_000;
    try { startedAt = Math.round(fs.statSync(path.join(dir, "restarts.log")).mtimeMs); } catch { /* never restarted: an old process */ }
    if (req.url === "/api/burnticker/build") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(mode === "legacy" ? { build: id || null } : { build: mode === "wrong" ? "some-other-build" : id, startedAt })); return; }
    if (req.url === "/burnticker") { res.writeHead(200, { "content-type": "text/html" }); res.end(mode === "no-page" ? "<html>Welcome to nginx</html>" : "<html><title>Burnticker</title></html>"); return; }
    res.writeHead(404); res.end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => { server.closeAllConnections(); server.close(); });

/** A host repo dir: the running build `old` (mode oldMode) and the staged build `new` (mode newMode). */
function host(o: { oldMode?: Mode | null; newMode: Mode; stagedId?: string | null; oldId?: string | null }) {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "bt-swap-"));
  if (o.oldMode !== null) { fs.mkdirSync(path.join(dir, ".next")); if (o.oldId !== null) fs.writeFileSync(path.join(dir, ".next", "BUILD_ID"), o.oldId ?? "old-build-1"); fs.writeFileSync(path.join(dir, ".next", "MODE"), o.oldMode ?? "ok"); }
  fs.mkdirSync(path.join(dir, ".next-old"));
  fs.writeFileSync(path.join(dir, ".next-old", "BUILD_ID"), "older-build-0");                // the deploy before last
  fs.mkdirSync(path.join(dir, ".next-staging"));
  if (o.stagedId !== null) fs.writeFileSync(path.join(dir, ".next-staging", "BUILD_ID"), o.stagedId ?? "new-build-2");
  fs.writeFileSync(path.join(dir, ".next-staging", "MODE"), o.newMode);
  return dir;
}
const idOf = (d: string, sub: string) => { try { return fs.readFileSync(path.join(d, sub, "BUILD_ID"), "utf8").trim(); } catch { return null; } };
function run(deadline: number, restart?: string, unitId?: string): Promise<{ code: number; out: string; ms: number; restarts: number }> {
  const t0 = Date.now(), log = path.join(dir, "restarts.log");
  return new Promise((resolve) => {
    const c = spawn("sh", [SCRIPT], { cwd: dir, env: { PATH: process.env.PATH ?? "/usr/bin:/bin", BT_WEB_URL: url, BT_WEB_DEADLINE: String(deadline), BT_WEB_ROLLBACK_DEADLINE: "3", BT_WEB_RESTART: restart ?? `echo restart >> ${log}`, BT_WEB_UNIT_ID: unitId ?? `n=$(cat ${log} 2>/dev/null | wc -l | tr -d " "); printf "MainPID=%s\\nActiveEnterTimestampMonotonic=%s\\n" $((n + 100)) $((n * 1000 + 5))` } as unknown as NodeJS.ProcessEnv });
    let out = "";
    c.stdout.on("data", (b) => { out += b; }); c.stderr.on("data", (b) => { out += b; });
    c.on("close", (code) => resolve({ code: code ?? -1, out, ms: Date.now() - t0, restarts: fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n").length : 0 }));
  });
}

describe("F02: swap-web-build.sh smokes the staged build and swaps back on failure", () => {
  test("200 with the staged build id and the Burnticker page: web is up; the previous release stays in .next-old", async () => {
    const d = host({ newMode: "ok" });
    const r = await run(10);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /web is up on build new-build-2 .*previous build old-build-1 is kept in \.next-old/);
    assert.equal(idOf(d, ".next"), "new-build-2");
    assert.equal(idOf(d, ".next-old"), "old-build-1", "the rollback build is NOT deleted on success");
    assert.equal(r.restarts, 1);
  });

  for (const [mode, why] of [
    ["500", /GET \/api\/burnticker\/build answered HTTP 500/],
    ["403", /GET \/api\/burnticker\/build answered HTTP 403/],
    ["404", /GET \/api\/burnticker\/build answered HTTP 404/],
    ["wrong", /serves another build .*some-other-build.*, not new-build-2/],
    ["no-page", /GET \/burnticker answered 200 without the Burnticker page/],
    ["hang", /did not answer \(refused or timed out\)/],
  ] as const) {
    test(`staged build answers ${mode}: the smoke fails within the deadline, swaps the previous build back, restarts and says so`, async () => {
      const d = host({ newMode: mode });
      const r = await run(4);
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /WEB SMOKE FAILED for build new-build-2 within 4 s/);
      assert.match(r.out, why, r.out);
      assert.match(r.out, /SWAPPED BACK: the failed build is in \.next-failed/);
      assert.match(r.out, /ROLLED BACK: the web is up on the previous build old-build-1/);
      assert.equal(idOf(d, ".next"), "old-build-1", "the previous build serves again");
      assert.equal(idOf(d, ".next-failed"), "new-build-2");
      assert.equal(r.restarts, 2, "restarted on the new build, then on the old one");
      assert.ok(r.ms < 4_000 + 60_000, `bounded: ${r.ms} ms`);
      assert.ok(r.ms < 25_000, `the failed smoke stops at its deadline, not after curl's retries: ${r.ms} ms`);
    });
  }

  test("the previous build does not answer either: it says the web is down (exit 1), never 'web is up'", async () => {
    host({ oldMode: "500", newMode: "500" });
    const r = await run(3);
    assert.equal(r.code, 1);
    assert.match(r.out, /ROLLBACK DID NOT ANSWER EITHER/);
    assert.doesNotMatch(r.out, /web is up/);
  });

  test("a unit that did not restart: the old process still answers (even with the new BUILD_ID on disk) → the smoke fails, never 'web is up'", async () => {
    const d = host({ newMode: "ok" });
    const r = await run(3, "true");                                   // the restart command does nothing
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /the web unit's process did not change across the restart/);
    assert.doesNotMatch(r.out, /web is up/);
    assert.equal(idOf(d, ".next-failed"), "new-build-2");
  });

  test("a previous build with no BUILD_ID and no startedAt (older than both) is still accepted on swap back by what it can show", async () => {
    const d = host({ oldMode: "legacy", oldId: null, newMode: "500" });
    const r = await run(3);
    assert.equal(r.code, 1);
    assert.match(r.out, /ROLLED BACK: the web is up on the previous build \(no BUILD_ID\)/, r.out);
    assert.equal(idOf(d, ".next"), null);
    assert.equal(idOf(d, ".next-failed"), "new-build-2");
  });

  test("a rollback target built before the route reported startedAt (any published commit today) passes on the unit's new process", async () => {
    const d = host({ newMode: "legacy" });
    const r = await run(5);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /web is up on build new-build-2/);
    assert.equal(idOf(d, ".next"), "new-build-2");
  });

  test("systemctl's Key=Value lines are read by name: the box's order (timestamp first, MainPID second) passes; MainPID=0 never does", async () => {
    const log = () => path.join(dir, "restarts.log");
    host({ newMode: "ok" });
    const reversed = `n=$(cat ${log()} 2>/dev/null | wc -l | tr -d " "); printf "ActiveEnterTimestampMonotonic=%s\\nMainPID=%s\\n" $((441136143701 + n)) $((840069 + n))`;
    const ok = await run(5, undefined, reversed);
    assert.equal(ok.code, 0, ok.out);
    assert.match(ok.out, /web is up on build new-build-2/);
    host({ newMode: "ok" });
    const noProcess = `n=$(cat ${log()} 2>/dev/null | wc -l | tr -d " "); printf "ActiveEnterTimestampMonotonic=%s\\nMainPID=0\\n" $((441136143701 + n))`;
    const dead = await run(3, undefined, noProcess);
    assert.equal(dead.code, 1, dead.out);
    assert.match(dead.out, /the web unit's process did not change across the restart \(before: pid=0 ts=\d+, now: pid=0 ts=\d+\)/);
  });

  test("no staged BUILD_ID: refused before anything moves", async () => {
    const d = host({ newMode: "ok", stagedId: null });
    const r = await run(3);
    assert.equal(r.code, 1);
    assert.match(r.out, /SWAP REFUSED/);
    assert.equal(idOf(d, ".next"), "old-build-1");
    assert.equal(idOf(d, ".next-old"), "older-build-0");
    assert.equal(r.restarts, 0);
  });

  test("first deploy (no running build) that fails: says there is nothing to swap back to", async () => {
    host({ oldMode: null, newMode: "500" });
    fs.rmSync(path.join(dir, ".next-old"), { recursive: true });
    const r = await run(3);
    assert.equal(r.code, 1);
    assert.match(r.out, /NO PREVIOUS BUILD to swap back to/);
  });

  test("the deploy script runs it, propagates its exit code, and no longer deletes .next-old after a bare curl", (t) => {
    const p = path.join(import.meta.dirname, "..", "scripts", "ops", "deploy-burnticker-host.sh");
    if (!fs.existsSync(p)) { t.skip("the deploy script is not part of the public tree"); return; }
    const s = fs.readFileSync(p, "utf8");
    // review of F02: the script is SENT from this checkout and the host runs that copy (a rollback target may predate the file)
    assert.match(s, /SWAP_REMOTE=\$\(\$SSH "\$HOST" "f=\\\$\(mktemp \/tmp\/burnticker-swap-web-build\.XXXXXXXX\) && cat > \\\$f && chmod 0755 \\\$f && echo \\\$f" < "\$REPO\/scripts\/ops\/swap-web-build\.sh"\)/, "a fresh mktemp name, root-owned 0755");
    assert.doesNotMatch(s, /SWAP_REMOTE="\/tmp\//, "never a fixed /tmp name");
    assert.match(s, /\$SSH "\$HOST" "rm -f \$SWAP_REMOTE"/);
    assert.match(s, / sh \$SWAP_REMOTE /);
    assert.doesNotMatch(s, /sh scripts\/ops\/swap-web-build\.sh/, "never the host tree's copy");
    assert.match(s, /DEPLOY INCOMPLETE \(exit \$RC\): the new web build passed its smoke and is serving/, "a later failed step is not reported as a swap failure");
    const rbFile = path.join(import.meta.dirname, "..", "scripts", "ops", "rollback-burnticker.sh"), pdFile = path.join(import.meta.dirname, "..", "scripts", "ops", "publish-and-deploy.sh");
    // each private script is checked only where it exists (the public tree carries neither)
    if (fs.existsSync(rbFile)) {
    const rb = fs.readFileSync(rbFile, "utf8");
    assert.match(rb, /scripts\/ops\/swap-web-build\.sh; do \[ -f "\$REPO\/\$s" \]/, "the rollback preflight needs the script in this checkout");
    assert.match(rb, /does not send the swap script from this checkout/);
    }
    if (fs.existsSync(pdFile)) {
    const pd = fs.readFileSync(pdFile, "utf8");
    assert.match(pd, /--webpack 2>&1 && echo 0 > \/tmp\/publish-deploy\.rc \|\| echo \$\? > \/tmp\/publish-deploy\.rc; \} \| hide \| tee \/tmp\/publish-deploy\.log \| tail -4/);
    assert.match(pd, /if \[ "\$DEPLOY_RC" != 0 \]; then[\s\S]*STOP: the host deploy failed[\s\S]*exit 1\nfi/);
    assert.ok(pd.indexOf("STOP: the host deploy failed") < pd.indexOf("--- deploy sites"), "the publish stops before anything after the deploy");
    }
    assert.doesNotMatch(s, /rm -rf \.next-old/, "the deploy never deletes the rollback build itself");
    assert.doesNotMatch(s, /if curl -s /, "no bare curl success as the smoke");
    assert.match(s, /RC=\$\(cat "\$RC_FILE"/);
    assert.match(s, /DEPLOY FAILED \(exit \$RC\): the new web build failed its smoke and the host swapped the previous web build back/);
    assert.match(fs.readFileSync(path.join(import.meta.dirname, "..", "config", "public-repo.allowlist"), "utf8"), /^scripts\/ops\/swap-web-build\.sh$/m, "the host has the script (it mirrors the public tree)");
  });
});
