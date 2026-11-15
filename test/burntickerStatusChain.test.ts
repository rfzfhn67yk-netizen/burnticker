// OPS-2 (2026-10-12): status.burnticker.com answered "status.json: HTTP 404". The chain is keeper → data/burnticker-site/status/status.json
// → mct-burnticker-publish.timer (deploy-sites.sh --publish-only) → /var/www/burnticker/status/ → Caddy. These tests run the real scripts
// in a throwaway tree (no local environment file there, nothing on any host): a failing copy now fails the publish unit instead of hiding behind
// `| sed`, the keeper-status check says when the keeper stops writing, and the probe prints the monitors' checks.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { execFile } from "node:child_process";
import type { AddressInfo } from "node:net";

const ROOT = path.join(import.meta.dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
function run(cmd: string, args: string[], opts: { cwd?: string; env?: Record<string, string> } = {}): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd: opts.cwd, env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: os.tmpdir(), NODE_ENV: "test" as const, ...(opts.env ?? {}) }, timeout: 60_000 }, (err: Error | null, stdout: string, stderr: string) => {
      resolve({ code: err ? ((err as { code?: number }).code ?? 1) : 0, out: `${stdout}${stderr}` });
    });
  });
}

describe("deploy-sites.sh (the publish timer) in a throwaway tree", () => {
  let dir = "";
  const env = () => ({ DEFICIT_WWW: path.join(dir, "www/deficit"), BURNTICKER_WWW: path.join(dir, "www/burnticker") });
  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "bt-sites-"));
    for (const d of ["repo/scripts/ops", "repo/site/burnticker/status", "repo/site/burnticker/fallback", "repo/data/burnticker-site/status", "www/burnticker", "www/deficit"]) fs.mkdirSync(path.join(dir, d), { recursive: true });
    for (const f of ["scripts/ops/deploy-sites.sh", "scripts/ops/keeper-status-check.sh", "scripts/load-env.sh"]) fs.copyFileSync(path.join(ROOT, f), path.join(dir, "repo", f));
    fs.writeFileSync(path.join(dir, "repo/site/burnticker/status/index.html"), "page");
    fs.writeFileSync(path.join(dir, "repo/site/burnticker/fallback/index.html"), "fallback");
  });
  after(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  test("no keeper file yet: the page ships, the log says once why status.json is missing", async () => {
    const r = await run("sh", ["scripts/ops/deploy-sites.sh", "--publish-only"], { cwd: path.join(dir, "repo"), env: env() });
    assert.equal(r.code, 0, r.out);
    assert.ok(fs.existsSync(path.join(dir, "www/burnticker/status/index.html")));
    assert.match(r.out, /keeper status: .*status\/status\.json does not exist\. The keeper has not written its status file/);
    const again = await run("sh", ["scripts/ops/deploy-sites.sh", "--publish-only"], { cwd: path.join(dir, "repo"), env: env() });
    assert.doesNotMatch(again.out, /keeper status/, "said once, not every minute");
  });
  test("the keeper writes it: it lands beside the page, and the log says it is back", async () => {
    fs.writeFileSync(path.join(dir, "repo/data/burnticker-site/status/status.json"), '{"schema":"burnticker.ops-status/v1"}\n');
    const r = await run("sh", ["scripts/ops/deploy-sites.sh", "--publish-only"], { cwd: path.join(dir, "repo"), env: env() });
    assert.equal(r.code, 0, r.out);
    assert.equal(fs.readFileSync(path.join(dir, "www/burnticker/status/status.json"), "utf8"), '{"schema":"burnticker.ops-status/v1"}\n');
    assert.match(r.out, /is fresh again/);
  });
  test("a copy that fails now fails the unit (exit code) and prints rsync's own error", async () => {
    fs.rmSync(path.join(dir, "www/burnticker/status/status.json"));
    fs.mkdirSync(path.join(dir, "www/burnticker/status/status.json/blocker"), { recursive: true });
    fs.writeFileSync(path.join(dir, "repo/data/burnticker-site/status/status.json"), '{"schema":"burnticker.ops-status/v1","n":2}\n');
    const r = await run("sh", ["scripts/ops/deploy-sites.sh", "--publish-only"], { cwd: path.join(dir, "repo"), env: env() });
    assert.notEqual(r.code, 0, r.out);
    assert.match(r.out, /burnticker publish: rsync FAILED \(exit \d+\)/);
    fs.rmSync(path.join(dir, "www/burnticker/status/status.json"), { recursive: true, force: true });
  });
  test("the script refuses to run as root, and the structure the older tests pin is intact", () => {
    const sh = read("scripts/ops/deploy-sites.sh");
    assert.match(sh, /if \[ "\$\(id -u\)" = 0 \] && \[ "\$\{DEPLOY_SITES_AS_ROOT:-0\}" != 1 \]; then/);
    assert.doesNotMatch(sh, /add "\$\(\$RS /, "no rsync output piped through sed without its exit code");
    assert.match(sh, /exit \$RC\n$/);
    assert.ok(read("config/public-repo.allowlist").split("\n").includes("scripts/ops/keeper-status-check.sh"), "the host runs the public tree");
    assert.ok(read("config/public-repo.allowlist").split("\n").includes("scripts/ops/probe-burnticker.sh"));
  });
});

describe("keeper-status-check.sh", () => {
  test("stale after the limit; the heartbeat is pinged only while the file is fresh, and its URL is never printed", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bt-ksc-"));
    let pings = 0;
    const srv = http.createServer((_q, s) => { pings++; s.end("OK"); });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/ping-secret-uuid`;
    try {
      fs.mkdirSync(path.join(dir, "pub/status"), { recursive: true });
      const f = path.join(dir, "pub/status/status.json"); fs.writeFileSync(f, "{}");
      const state = path.join(dir, "state");
      const env = { BURNTICKER_STATUS_HEARTBEAT_URL: url, BURNTICKER_STATUS_STALE_SEC: "300" };
      let r = await run("sh", [path.join(ROOT, "scripts/ops/keeper-status-check.sh"), path.join(dir, "pub"), state], { env });
      assert.equal(r.code, 0); assert.equal(r.out, ""); assert.equal(pings, 1);
      const old = Date.now() / 1000 - 900; fs.utimesSync(f, old, old);
      r = await run("sh", [path.join(ROOT, "scripts/ops/keeper-status-check.sh"), path.join(dir, "pub"), state], { env });
      assert.match(r.out, /was last written \d+ s ago \(limit 300 s\)\. The keeper has stopped cycling or stopped publishing/);
      assert.equal(pings, 1, "no ping while stale: the monitor alerts");
      assert.doesNotMatch(r.out, /ping-secret-uuid/);
    } finally { srv.close(); fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("probe-burnticker.sh against a local stand-in for the site", () => {
  let srv: http.Server; let base = ""; let statusCode = 200; let generatedAt = new Date().toISOString();
  before(async () => {
    srv = http.createServer((q, s) => {
      const u = q.url ?? "/";
      const json = (o: unknown, code = 200) => { s.writeHead(code, { "content-type": "application/json", "ratelimit-remaining": "119" }); s.end(JSON.stringify(o, null, 1)); };
      if (u === "/api/burnticker/v1/current-status") return json({ schema: "burnticker.current-status/v1", lines: [] });
      if (u === "/status/status.json" || u === "/st/status.json") return statusCode === 200 ? json({ schema: "burnticker.ops-status/v1", generatedAt }) : json({ error: "not found" }, statusCode);
      if (u === "/df/status.json") return json({ schema: "burnticker.deficit-status/v1" });
      s.writeHead(200, { "content-type": "text/html" }); s.end("<html></html>");
    });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  });
  after(() => { srv.close(); });
  const probe = () => run("sh", [path.join(ROOT, "scripts/ops/probe-burnticker.sh"), "--base", base, "--status-base", `${base}/st`, "--deficit-base", `${base}/df`]);

  test("everything served: exit 0, every check named", async () => {
    statusCode = 200; generatedAt = new Date().toISOString();
    const r = await probe();
    assert.equal(r.code, 0, r.out);
    for (const l of [/PASS  home/, /PASS  api .*burnticker\.current-status\/v1/, /PASS  status\.json .*burnticker\.ops-status\/v1/, /PASS  status\.json +written \d+s ago/, /PASS  deficit json/, /all checks passed/]) assert.match(r.out, l);
    assert.match(r.out, /INFO  the site answers directly, not through Cloudflare/);
  });
  test("status.json 404 (today's symptom) fails, on both hosts", async () => {
    statusCode = 404;
    const r = await probe();
    assert.equal(r.code, 1);
    assert.match(r.out, /FAIL  status\.json .*HTTP 404/); assert.match(r.out, /FAIL  status apex .*HTTP 404/);
  });
  test("a stale status.json fails: the site is up but the keeper stopped", async () => {
    statusCode = 200; generatedAt = new Date(Date.now() - 3_600_000).toISOString();
    const r = await probe();
    assert.equal(r.code, 1);
    assert.match(r.out, /FAIL  status\.json +written \d+s ago .*the keeper has stopped publishing/);
  });
});
