// L-5 (audit 2026-10-19): the web unit ignored SIGTERM for its whole 90 s stop timeout, because `next start` awaits server.close(), which
// waits for every request in flight and for keep-alive sockets. scripts/service/web-graceful.cjs (preloaded by run-burnticker-web.sh)
// bounds that: it stops accepting, closes idle keep-alive sockets at once, closes the rest after a short drain, and exits. Rehearsed on a
// plain Node server that shuts down the way Next's cleanup does (server.close, then exit 143).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import net from "node:net";
import { spawn } from "node:child_process";

const ROOT = path.join(import.meta.dirname, "..");
const PRELOAD = path.join(ROOT, "scripts", "service", "web-graceful.cjs");

/** A server like `next start`: on SIGTERM it awaits server.close() and exits 143. /slow never answers by itself. */
const SERVER = `
const http = require("node:http");
const s = http.createServer((req, res) => {
  if (req.url === "/slow") return;                      // an upstream read with no deadline
  res.end("ok");
});
s.keepAliveTimeout = 60_000;
s.listen(0, "127.0.0.1", () => process.stdout.write("PORT " + s.address().port + "\\n"));
process.on("SIGTERM", () => { s.close(() => process.exit(143)); });
`;

function start(env: Record<string, string>, preload = true) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bt-graceful-"));
  const file = path.join(dir, "server.cjs");
  fs.writeFileSync(file, SERVER);
  const c = spawn(process.execPath, [...(preload ? ["--require", PRELOAD] : []), file], { env: { PATH: process.env.PATH ?? "", ...env } as unknown as NodeJS.ProcessEnv });
  let out = "";
  const port = new Promise<number>((resolve) => c.stdout.on("data", (b) => { out += b; const m = out.match(/PORT (\d+)/); if (m) resolve(Number(m[1])); }));
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => c.on("exit", (code, signal) => resolve({ code, signal })));
  return { c, port, exited, out: () => out };
}

/** A kept-alive idle connection (one request answered, socket left open) and one request in flight that never finishes. */
async function holdConnections(port: number) {
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
  await new Promise<void>((r) => http.get({ host: "127.0.0.1", port, path: "/", agent }, (res) => { res.resume(); res.on("end", () => r()); }));
  const slow = net.connect(port, "127.0.0.1");
  slow.on("error", () => {});
  await new Promise<void>((r) => slow.on("connect", () => r()));
  slow.write("GET /slow HTTP/1.1\r\nHost: x\r\nConnection: keep-alive\r\n\r\n");
  await new Promise((r) => setTimeout(r, 100));
  return { agent, slow };
}

describe("L-5: the web drains on SIGTERM within a bound", () => {
  test("without the preload, a request in flight holds the shutdown (what the deploy saw)", async () => {
    const s = start({}, false);
    const port = await s.port;
    const { agent, slow } = await holdConnections(port);
    s.c.kill("SIGTERM");
    const r = await Promise.race([s.exited, new Promise<"held">((res) => setTimeout(() => res("held"), 1_500))]);
    assert.equal(r, "held", "server.close() waits for the open request");
    s.c.kill("SIGKILL"); slow.destroy(); agent.destroy(); await s.exited;
  });

  test("with the preload: new connections are refused at once, and the process exits after the drain, not after the unit's timeout", async () => {
    const s = start({ BT_WEB_DRAIN_MS: "600", BT_WEB_EXIT_GRACE_MS: "2000" });
    const port = await s.port;
    const { agent, slow } = await holdConnections(port);
    const t0 = Date.now();
    s.c.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 150));
    const refused = await new Promise<boolean>((resolve) => { const k = net.connect(port, "127.0.0.1"); k.on("connect", () => { k.destroy(); resolve(false); }); k.on("error", () => resolve(true)); });
    assert.equal(refused, true, "the listener is closed: Caddy moves to its fallback at once instead of queueing");
    const r = await s.exited;
    const ms = Date.now() - t0;
    assert.equal(r.code, 143, "Next's own cleanup finishes once the connections are closed");
    assert.ok(ms >= 500 && ms < 2_500, `exited after the drain (${ms} ms)`);
    assert.match(s.out(), /SIGTERM: stopping the web server \(drain 600 ms/);
    slow.destroy(); agent.destroy();
  });

  test("an idle server exits at once", async () => {
    const s = start({ BT_WEB_DRAIN_MS: "5000" });
    await s.port;
    const t0 = Date.now();
    s.c.kill("SIGTERM");
    const r = await s.exited;
    assert.equal(r.code, 143);
    assert.ok(Date.now() - t0 < 1_500);
  });

  test("the backstop exits even when nothing else would (a handler that never finishes)", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bt-graceful-"));
    const file = path.join(dir, "stuck.cjs");
    fs.writeFileSync(file, `const s=require("node:http").createServer(()=>{}); s.listen(0,"127.0.0.1",()=>process.stdout.write("PORT\\n")); process.on("SIGTERM",()=>{}); setInterval(()=>{},1000);`);
    const c = spawn(process.execPath, ["--require", PRELOAD, file], { env: { PATH: process.env.PATH ?? "", BT_WEB_DRAIN_MS: "200", BT_WEB_EXIT_GRACE_MS: "300" } as unknown as NodeJS.ProcessEnv });
    await new Promise<void>((r) => c.stdout.on("data", () => r()));
    const t0 = Date.now();
    c.kill("SIGTERM");
    const code = await new Promise<number | null>((r) => c.on("exit", (x) => r(x)));
    assert.equal(code, 143);
    assert.ok(Date.now() - t0 < 2_000);
  });

  // HB-44 (continuous audit 2026-10-19): Next's cleanup closed the server a second time after the drain, and logged
  // "Error: Server is not running ... ERR_SERVER_NOT_RUNNING" on every deploy.
  test("HB-44: the second close (Next's cleanup) is not an error, and the stop prints one clean stopped line", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bt-graceful-"));
    const file = path.join(dir, "next-like.cjs");
    fs.writeFileSync(file, `const s=require("node:http").createServer((q,r)=>r.end("ok")); s.listen(0,"127.0.0.1",()=>process.stdout.write("PORT\\n"));
process.on("SIGTERM",()=>{ s.close((err)=>{ if (err) process.stderr.write("Error: "+err.message+" code: "+err.code+"\\n"); process.exit(143); }); });`);
    const c = spawn(process.execPath, ["--require", PRELOAD, file], { env: { PATH: process.env.PATH ?? "", BT_WEB_DRAIN_MS: "300", BT_WEB_EXIT_GRACE_MS: "2000" } as unknown as NodeJS.ProcessEnv });
    let out = "", err = "";
    c.stderr.on("data", (b) => { err += b; });
    await new Promise<void>((r) => c.stdout.on("data", (b) => { out += b; if (/PORT/.test(out)) r(); }));
    c.kill("SIGTERM");
    const code = await new Promise<number | null>((r) => c.on("exit", (x) => r(x)));
    assert.equal(code, 143);
    assert.doesNotMatch(err + out, /ERR_SERVER_NOT_RUNNING|Error:/, "no error line on a clean stop");
    assert.equal((out.match(/the web server stopped/g) ?? []).length, 1, "one stopped line");
    assert.match(out, /SIGTERM: the web server stopped \(exit 143\)/);
  });

  test("HB-44: the graceful script (source) tolerates ERR_SERVER_NOT_RUNNING and logs one stop line", () => {
    if (!fs.existsSync(PRELOAD)) return;
    const src = fs.readFileSync(PRELOAD, "utf8");
    assert.match(src, /err\.code === "ERR_SERVER_NOT_RUNNING" \? undefined : err/);
    assert.equal((src.match(/the web server stopped/g) ?? []).length, 1);
    assert.match(src, /process\.once\("exit"/);
    const synth = path.join(ROOT, "deploy", "systemd", "mct-burnticker-synth.service");
    if (fs.existsSync(synth)) assert.match(fs.readFileSync(synth, "utf8"), /^Description=.*run nightly by its timer \(mct-burnticker-synth\.timer\), or by hand$/m);
  });

  test("the run script preloads it and the unit's stop timeout is about 15 s, above drain plus grace", () => {
    const run = fs.readFileSync(path.join(ROOT, "scripts", "service", "run-burnticker-web.sh"), "utf8");
    assert.match(run, /GRACEFUL="\$\(pwd -P\)\/scripts\/service\/web-graceful\.cjs"/);
    assert.match(run, /export NODE_OPTIONS="\$\{NODE_OPTIONS:\+\$NODE_OPTIONS \}--require \$GRACEFUL"/);
    const unit = fs.readFileSync(path.join(ROOT, "deploy", "systemd", "mct-burnticker-web.service"), "utf8");
    assert.match(unit, /^TimeoutStopSec=15$/m);
    assert.doesNotMatch(unit, /TimeoutStopSec=90/);
    assert.match(fs.readFileSync(path.join(ROOT, "config", "public-repo.allowlist"), "utf8"), /^scripts\/service\/web-graceful\.cjs$/m, "the host runs the public tree, so the preload is published");
  });
});
