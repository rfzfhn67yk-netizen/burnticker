/* eslint-disable @typescript-eslint/no-require-imports -- a CommonJS preload (node --require), loaded before Next */
"use strict";
/**
 * A BOUNDED SHUTDOWN FOR THE BURNTICKER WEB (audit 2026-10-19 L-5). Preloaded into `next start` by run-burnticker-web.sh
 * (NODE_OPTIONS=--require). On a deploy the web unit ignored SIGTERM for the whole 90 s TimeoutStopSec, and Caddy served the static
 * fallback for about 95 s.
 *
 * WHAT HELD THE SHUTDOWN. `next start` handles SIGTERM itself (next/dist/server/lib/start-server.js `cleanup`): it awaits
 * server.close(), then nextServer.close(), then exits 143. In production it never closes connections itself (only the dev server calls
 * closeAllConnections), so server.close() waits for every request still in flight. Several Burnticker routes have no deadline of their
 * own (uncached token and calendar reads, the derby search, pin checks that wait on Arweave, chain reads behind the RPC proxy), and Caddy
 * holds keep-alive connections that Node closes only once idle. Nothing bounded the wait, so systemd waited out the full stop timeout.
 *
 * WHAT THIS DOES, without changing how Next serves: it records every HTTP server the process creates and every socket each one accepts,
 * and on SIGTERM or SIGINT (a listener added before Next's, so both run):
 *   1. stops accepting: server.close() (Next's own cleanup calls it too; that second close's ERR_SERVER_NOT_RUNNING reaches its callback as success, HB-44);
 *   2. closes idle keep-alive connections at once, and marks every response still in flight `Connection: close`, so each socket closes
 *      as soon as its request finishes;
 *   3. after BT_WEB_DRAIN_MS (default 8000 ms) closes every remaining connection, which lets Next's cleanup finish and exit 143;
 *   4. as a backstop, exits 143 itself BT_WEB_EXIT_GRACE_MS (default 3000 ms) later if anything still holds the process.
 * The unit's TimeoutStopSec (15 s) stays above drain + grace, so systemd never has to kill it.
 */
const http = require("node:http");
const DRAIN_MS = Math.max(0, Number(process.env.BT_WEB_DRAIN_MS ?? 8000) || 0);
const GRACE_MS = Math.max(0, Number(process.env.BT_WEB_EXIT_GRACE_MS ?? 3000) || 0);
const servers = new Set();
let stopping = false;

function track(server) {
  if (servers.has(server)) return;
  servers.add(server);
  server.on("request", (req, res) => {
    // a request that arrives while draining on a kept-alive socket still gets an answer, then the socket closes
    if (stopping && !res.headersSent) res.setHeader("Connection", "close");
    res.on("finish", () => { if (stopping) req.socket.end(); });
  });
  server.on("close", () => servers.delete(server));
}

const origListen = http.Server.prototype.listen;
http.Server.prototype.listen = function listen(...args) {
  track(this);
  return origListen.apply(this, args);
};

// HB-44 (continuous audit 2026-10-19): the drain below closes each server first, so Next's own cleanup closes it a second time, and
// Node hands that second close ERR_SERVER_NOT_RUNNING, which Next printed as "Error: Server is not running" after every deploy. A close
// of a server that is already closed is what both callers want, so that one code reaches the callback as success; any other error is
// passed on unchanged.
const origClose = http.Server.prototype.close;
http.Server.prototype.close = function close(cb) {
  if (typeof cb !== "function") return origClose.call(this);
  return origClose.call(this, (err) => cb(err && err.code === "ERR_SERVER_NOT_RUNNING" ? undefined : err));
};

function log(line) {
  try { process.stdout.write(`[${new Date().toISOString().replace("T", " ").slice(0, 19)}Z] ${line}\n`); } catch { /* stdout gone */ }
}

function drain(signal) {
  if (stopping) return;
  stopping = true;
  log(`${signal}: stopping the web server (drain ${DRAIN_MS} ms, then every connection is closed)`);
  // HB-44: one clean line when the process ends, whoever exits it (Next's cleanup or the backstop below)
  process.once("exit", (code) => log(`${signal}: the web server stopped (exit ${code})`));
  for (const s of servers) {
    try { s.close(); } catch { /* already closed */ }
    try { s.closeIdleConnections(); } catch { /* older Node */ }
  }
  setTimeout(() => {
    for (const s of servers) { try { s.closeAllConnections(); } catch { /* older Node */ } }
    setTimeout(() => { log(`${signal}: still running ${GRACE_MS} ms after the drain; exiting`); process.exit(143); }, GRACE_MS).unref();
  }, DRAIN_MS).unref();
}

process.prependListener("SIGTERM", () => drain("SIGTERM"));
process.prependListener("SIGINT", () => drain("SIGINT"));

module.exports = { servers, drain };
