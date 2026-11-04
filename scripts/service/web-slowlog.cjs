/* eslint-disable @typescript-eslint/no-require-imports -- a CommonJS preload (node --require), loaded before Next */
"use strict";
/**
 * THE WEB'S SLOW-REQUEST LOG (HB-145, 2026-10-20). Preloaded into `next start` by run-burnticker-web.sh (NODE_OPTIONS=--require).
 *
 * WHY. At 01:13 Denver on 2026-10-20, 21 minutes after a restart on a quiet host, the app stopped answering for more than 20 s (two launch
 * reviews got Caddy's "catching up" 503, /burnticker/leagues/cfb/2026 answered 503 after 20.78 s, the home took 15.75 s) and nothing on the
 * host could place it: no access log, only the memo build times. This writes down every slow moment so the next stall can be placed.
 *
 * WHAT IT WRITES, to stdout (the web log) and as one JSON line to logs/burnticker-web-slow.log (rotated with the other logs; the keeper
 * counts the last hour into ops.json: ops/unitHealth.ts readSlowRequests):
 *   - every request that took longer than BT_WEB_SLOW_MS (default 2000 ms) from the moment Node handed it to the server to its last byte:
 *       slow: GET /api/burnticker/home 3456 ms HTTP 200 (memo home=cold)
 *     with the route (the path, never the query string), the method, the duration, the status, and the memo the answer says it came from
 *     (the routes' x-home-memo, x-index-memo, x-coin-memo, x-pair-memo and x-sitemap-memo headers: "cold", "stale" or "version" mean the
 *     request waited on a build);
 *   - every time the event loop itself was held for longer than BT_WEB_LOOP_STALL_MS (default 1000 ms), measured by a 250 ms timer that
 *     fired late: a held loop delays every request, including the ones Node has not handed over yet, so this is the line that places a
 *     stall the per-request times cannot see:
 *       loop: the event loop was held for 3.2 s (4 requests in flight)
 * Nothing about the visitor (no address, no header, no query string) is written. BT_WEB_SLOWLOG=0 turns it off.
 */
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const SLOW_MS = Math.max(1, Number(process.env.BT_WEB_SLOW_MS ?? 2000) || 2000);
const STALL_MS = Math.max(100, Number(process.env.BT_WEB_LOOP_STALL_MS ?? 1000) || 1000);
const TICK_MS = 250;
const FILE = process.env.BT_WEB_SLOW_FILE || path.join("logs", "burnticker-web-slow.log");
const MEMO_HEADERS = { "x-home-memo": "home", "x-index-memo": "tokens", "x-coin-memo": "coin", "x-pair-memo": "pair", "x-sitemap-memo": "sitemap" };
const OFF = /^(0|false|no|off)$/i.test(String(process.env.BT_WEB_SLOWLOG ?? ""));

function stamp(now = Date.now()) { return new Date(now).toISOString().replace("T", " ").slice(0, 19) + "Z"; }
function write(line, record, o = {}) {
  const out = o.out ?? ((s) => { try { process.stdout.write(s); } catch { /* stdout gone */ } });
  out(`[${stamp(record.at)}] ${line}\n`);
  const file = o.file ?? FILE;
  try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.appendFileSync(file, JSON.stringify(record) + "\n"); } catch { /* a log that cannot be written never stops a request */ }
}

/** The memo an answer names from its headers ({ "x-home-memo": "cold" } -> "home=cold"), or null. */
function memoOf(headers) {
  const parts = [];
  for (const [h, name] of Object.entries(MEMO_HEADERS)) {
    const v = headers[h];
    if (v !== undefined && v !== null && v !== "") parts.push(`${name}=${Array.isArray(v) ? v[0] : v}`);
  }
  return parts.length ? parts.join(" ") : null;
}
/** The request's path without its query string, at most 200 characters. */
function routeOf(url) { return String(url ?? "").split("?")[0].split("#")[0].slice(0, 200) || "/"; }

/** The slow line and record for one finished request, or null when it was fast. Pure, for the tests. */
function slowRecord(o) {
  if (o.ms <= (o.slowMs ?? SLOW_MS)) return null;
  const memo = memoOf(o.headers ?? {});
  const route = routeOf(o.url);
  return { line: `slow: ${o.method} ${route} ${o.ms} ms HTTP ${o.status}${memo ? ` (memo ${memo})` : ""}`, record: { kind: "request", at: o.at, method: o.method, route, ms: o.ms, status: o.status, memo } };
}

let inFlight = 0;
function track(server, o = {}) {
  server.on("request", (req, res) => {
    const t0 = Date.now();
    inFlight++;
    // the headers as written: Next may pass them to writeHead directly, where getHeader cannot see them
    const seen = {};
    const origWriteHead = res.writeHead;
    res.writeHead = function writeHead(status, ...rest) {
      const h = rest.find((x) => x && typeof x === "object" && !Array.isArray(x));
      if (h) for (const [k, v] of Object.entries(h)) seen[k.toLowerCase()] = v;
      return origWriteHead.call(this, status, ...rest);
    };
    let done = false;
    const end = () => {
      if (done) return;
      done = true;
      inFlight--;
      const ms = Date.now() - t0;
      const headers = {};
      for (const h of Object.keys(MEMO_HEADERS)) { const v = seen[h] ?? res.getHeader(h); if (v !== undefined) headers[h] = v; }
      const s = slowRecord({ ms, method: req.method, url: req.url, status: res.statusCode, headers, at: Date.now(), slowMs: o.slowMs });
      if (s) write(s.line, s.record, o);
    };
    res.on("finish", end);
    res.on("close", end);
  });
}

/** The loop watch: a timer every TICK_MS; one that fires more than `stallMs` late means the loop was held that long. */
function watchLoop(o = {}) {
  const tick = o.tickMs ?? TICK_MS, stall = o.stallMs ?? STALL_MS, now = o.now ?? Date.now;
  let last = now();
  const t = setInterval(() => {
    const at = now(), late = at - last - tick;
    last = at;
    if (late > stall) write(`loop: the event loop was held for ${(late / 1000).toFixed(1)} s (${inFlight} request${inFlight === 1 ? "" : "s"} in flight)`, { kind: "loop", at, ms: late, inFlight }, o);
  }, tick);
  t.unref();
  return () => clearInterval(t);
}

if (!OFF) {
  const tracked = new WeakSet();
  const origListen = http.Server.prototype.listen;
  http.Server.prototype.listen = function listen(...args) {
    if (!tracked.has(this)) { tracked.add(this); track(this); }
    return origListen.apply(this, args);
  };
  watchLoop();
}

module.exports = { slowRecord, memoOf, routeOf, track, watchLoop, SLOW_MS, STALL_MS, FILE };
