// HB-138 (2026-10-20): right after a web restart the deploy smoke found four pages with no answer in 20 s while the first visitors' home
// and coins memo builds held the event loop (6.4 s and 6.1 s). scripts/service/web-warm.cjs (preloaded by run-burnticker-web.sh) asks the
// server itself for both memos the moment it listens, waits at most 10 s, and logs one line. Rehearsed on a plain Node server.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";

const ROOT = path.join(import.meta.dirname, "..");
const PRELOAD = path.join(ROOT, "scripts", "service", "web-warm.cjs");
const req = createRequire(import.meta.url);
type Warm = { warmUp: (o: { base: string; fetchImpl?: typeof fetch; waitMs?: number; paths?: string[]; log?: (s: string) => void }) => Promise<{ line: string; results: { path: string; status?: number; error?: string; pending?: boolean }[] }>; loopbackBase: (a: unknown) => string | null; WARM_PATHS: string[] };
const warm = (): Warm => req(PRELOAD) as Warm;

/** A server like `next start` on PORT: the two memo routes answer after `delay` ms, anything else at once. */
const SERVER = (delay: number) => `
const http = require("node:http");
const s = http.createServer((req, res) => {
  if (req.url.startsWith("/api/burnticker/")) { setTimeout(() => res.end("{}"), ${delay}); return; }
  res.end("ok");
});
s.listen(Number(process.env.PORT), "127.0.0.1", () => process.stdout.write("LISTENING\\n"));
setTimeout(() => process.exit(0), ${delay} + 1500);
`;
function run(env: Record<string, string>, delay = 50): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--require", PRELOAD, "-e", SERVER(delay)], { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (b) => { out += b; });
    child.stderr.on("data", (b) => { out += b; });
    child.on("exit", () => resolve(out));
  });
}
const freePort = () => 41_000 + Math.floor(Math.random() * 2_000);

describe("HB-138: the web warms its home and coins memos at start", () => {
  test("on listen it asks itself for both memos, at once, and logs one line with each answer", async () => {
    const out = await run({ PORT: String(freePort()) }, 200);
    assert.match(out, /LISTENING/);
    assert.match(out, /warm: building the home and coins memos \(\/api\/burnticker\/home, \/api\/burnticker\/tokens\) on http:\/\/127\.0\.0\.1:\d+/);
    const m = /warm: home 200 in (\d+) ms, tokens 200 in (\d+) ms \(10 s bound\)/.exec(out);
    assert.ok(m, out);
    assert.ok(Number(m[1]) < 1_000 && Number(m[2]) < 1_000, "both asked at once (about 200 ms each, not 400 one after the other)");
  });

  test("past the bound it stops waiting and says the build goes on; BT_WEB_WARM=0 turns it off; another port is left alone", async () => {
    const slow = await run({ PORT: String(freePort()), BT_WEB_WARM_WAIT_MS: "300" }, 900);
    assert.match(slow, /warm: home still building after 0 s, tokens still building after 0 s \(0 s bound; the first visitors join that build\)/);
    const off = await run({ PORT: String(freePort()), BT_WEB_WARM: "0" });
    assert.match(off, /LISTENING/); assert.doesNotMatch(off, /warm:/);
    // the server listens on PORT; a preload whose PORT names another port (an internal server) does nothing
    const p = freePort();
    const other = await new Promise<string>((resolve) => {
      const child = spawn(process.execPath, ["--require", PRELOAD, "-e", `const s=require("node:http").createServer((q,r)=>r.end());s.listen(${p},"127.0.0.1",()=>{process.stdout.write("LISTENING\\n");setTimeout(()=>process.exit(0),300);});`], { env: { ...process.env, PORT: String(p + 1) }, stdio: ["ignore", "pipe", "pipe"] });
      let out = ""; child.stdout.on("data", (b) => { out += b; }); child.on("exit", () => resolve(out));
    });
    assert.match(other, /LISTENING/); assert.doesNotMatch(other, /warm:/);
  });

  test("warmUp never throws: a failed request is logged, a pending one is said, an answer is timed", async () => {
    const lines: string[] = [];
    const fetchImpl = (async (u: string) => {
      if (u.endsWith("/home")) throw new Error("connect ECONNREFUSED");
      return new Promise<Response>(() => { /* never answers */ });
    }) as unknown as typeof fetch;
    const r = await warm().warmUp({ base: "http://127.0.0.1:1", fetchImpl, waitMs: 1_000, log: (s) => lines.push(s) });
    assert.deepEqual(lines, [r.line]);
    assert.match(r.line, /^warm: home failed \(connect ECONNREFUSED\), tokens still building after 1 s \(1 s bound; the first visitors join that build\)$/);
    const ok = await warm().warmUp({ base: "http://x", fetchImpl: (async () => new Response("{}", { status: 503 })) as unknown as typeof fetch, waitMs: 1_000, log: () => {} });
    assert.match(ok.line, /^warm: home 503 in \d+ ms, tokens 503 in \d+ ms \(1 s bound\)$/);
    assert.deepEqual(warm().WARM_PATHS, ["/api/burnticker/home", "/api/burnticker/tokens"]);
  });

  test("the loopback address: a wildcard bind is asked on 127.0.0.1, an IPv6 address is bracketed, a pipe has none", () => {
    const { loopbackBase } = warm();
    assert.equal(loopbackBase({ address: "127.0.0.1", port: 3000 }), "http://127.0.0.1:3000");
    assert.equal(loopbackBase({ address: "::", port: 3000 }), "http://127.0.0.1:3000");
    assert.equal(loopbackBase({ address: "0.0.0.0", port: 3000 }), "http://127.0.0.1:3000");
    assert.equal(loopbackBase({ address: "::1", port: 3000 }), "http://[::1]:3000");
    assert.equal(loopbackBase("/tmp/next.sock"), null);
  });

  test("run-burnticker-web.sh preloads it beside the graceful drain, and the public tree carries it", () => {
    const run = fs.readFileSync(path.join(ROOT, "scripts", "service", "run-burnticker-web.sh"), "utf8");
    assert.match(run, /WARM="\$\(pwd -P\)\/scripts\/service\/web-warm\.cjs"/);
    assert.match(run, /if \[ -f "\$WARM" \]; then export NODE_OPTIONS="\$\{NODE_OPTIONS:\+\$NODE_OPTIONS \}--require \$WARM"; fi/);
    assert.ok(run.indexOf("web-warm.cjs") < run.indexOf("exec ./node_modules/.bin/next start"), "set before next starts");
    assert.match(fs.readFileSync(path.join(ROOT, "config", "public-repo.allowlist"), "utf8"), /^scripts\/service\/web-warm\.cjs$/m);
  });
});
