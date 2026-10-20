/* eslint-disable @typescript-eslint/no-require-imports -- a CommonJS preload (node --require), loaded before Next */
"use strict";
/**
 * WARM THE HOME AND COINS MEMOS AT WEB START (HB-138, 2026-10-20). Preloaded into `next start` by run-burnticker-web.sh
 * (NODE_OPTIONS=--require), beside web-graceful.cjs.
 *
 * WHAT HAPPENED. Right after the publish-101 restart the deploy smoke found /burnticker/about, /bounty, /changelog and /derby with no
 * answer in 20 s and printed "STOP ... roll back". At that moment the first visitors had started the two big memo builds (the web log:
 * "[burnticker/home] built in 6460 ms", "[burnticker/tokens] built in 6124 ms"), which hold the one event loop; a minute later all four
 * pages answered in 0.4 s.
 *
 * WHAT THIS DOES. As soon as the web server is listening, it asks the server itself (the loopback address it listens on, never the public
 * origin) for /api/burnticker/home and /api/burnticker/tokens, both at once. Those routes keep one build in flight (refreshHome,
 * refreshIndex), so a visitor who arrives meanwhile joins the build this started instead of starting another, and the memos are warm
 * seconds after the start instead of after the first visitor. It waits at most BT_WEB_WARM_WAIT_MS (default 10000) and logs one line:
 *   [time] warm: home 200 in 6460 ms, tokens 200 in 6124 ms (10 s bound)
 * or, past the bound, "still building after 10 s (the first visitors join that build)". A failed request is logged, never retried, never
 * thrown: the web serves either way. Next opens the port before it is ready to answer, so the requests simply queue until it is. The
 * routes are read-only. BT_WEB_WARM=0 turns it off.
 *
 * Why not before the port opens: `next start` builds its request handler only after it listens, so a memo cannot be built earlier
 * without a second server. Starting the builds in the first moment after the listen is the closest the process allows.
 */
const http = require("node:http");

const WARM_PATHS = ["/api/burnticker/home", "/api/burnticker/tokens"];
const WAIT_MS = Math.max(0, Number(process.env.BT_WEB_WARM_WAIT_MS ?? 10_000) || 0);

function log(line) {
  try { process.stdout.write(`[${new Date().toISOString().replace("T", " ").slice(0, 19)}Z] ${line}\n`); } catch { /* stdout gone */ }
}

/** The loopback URL base for a listening server's address (a wildcard bind is asked on 127.0.0.1); null for a pipe or no address. */
function loopbackBase(addr) {
  if (!addr || typeof addr !== "object" || !addr.port) return null;
  const a = addr.address;
  const host = !a || a === "::" || a === "0.0.0.0" || a === "::ffff:0.0.0.0" ? "127.0.0.1" : a.includes(":") ? `[${a}]` : a;
  return `http://${host}:${addr.port}`;
}

/**
 * Asks each path once, all at once, and resolves after every answer or after `waitMs`, whichever is first; never rejects. The requests
 * left running past the bound are not aborted: their builds carry on in the server, and the first visitors join them.
 * Returns the line it logged and each path's outcome ({ path, status, ms } or { path, error, ms } or { path, pending: true }).
 */
async function warmUp(o) {
  const fetchImpl = o.fetchImpl ?? globalThis.fetch;
  const waitMs = o.waitMs ?? WAIT_MS, paths = o.paths ?? WARM_PATHS, out = o.log ?? log, now = o.now ?? Date.now;
  const t0 = now();
  const results = paths.map((p) => ({ path: p, pending: true }));
  const name = (p) => p.replace(/^\/api\/burnticker\//, "");
  const runs = paths.map((p, i) => Promise.resolve().then(() => fetchImpl(`${o.base}${p}`, { headers: { "x-burnticker-warm": "1" } }))
    .then(async (r) => { try { await r.arrayBuffer(); } catch { /* the body is not needed */ } results[i] = { path: p, status: r.status, ms: now() - t0 }; },
      (e) => { results[i] = { path: p, error: String((e && e.message) || e).slice(0, 160), ms: now() - t0 }; }));
  let timer;
  await Promise.race([Promise.all(runs), new Promise((res) => { timer = setTimeout(res, waitMs); })]);
  clearTimeout(timer);
  const parts = results.map((r) => r.pending ? `${name(r.path)} still building after ${Math.round(waitMs / 1000)} s` : r.error ? `${name(r.path)} failed (${r.error})` : `${name(r.path)} ${r.status} in ${r.ms} ms`);
  const pending = results.some((r) => r.pending);
  const line = `warm: ${parts.join(", ")} (${Math.round(waitMs / 1000)} s bound${pending ? "; the first visitors join that build" : ""})`;
  out(line);
  return { line, results };
}

let started = false;
function onListening(server) {
  if (started || /^(0|false|no|off)$/i.test(String(process.env.BT_WEB_WARM ?? ""))) return;
  const addr = server.address();
  // only the public listener (run-burnticker-web.sh exports PORT): an internal server Next or a library opens on another port is left alone
  if (!addr || typeof addr !== "object" || String(addr.port) !== String(process.env.PORT ?? "")) return;
  const base = loopbackBase(addr);
  if (!base) return;
  started = true;
  log(`warm: building the home and coins memos (${WARM_PATHS.join(", ")}) on ${base}`);
  // after this tick, so Next finishes its own listen callback first
  setImmediate(() => { void warmUp({ base }).catch(() => { /* never thrown */ }); });
}

const origListen = http.Server.prototype.listen;
http.Server.prototype.listen = function listen(...args) {
  this.once("listening", () => onListening(this));
  return origListen.apply(this, args);
};

module.exports = { warmUp, loopbackBase, WARM_PATHS };
