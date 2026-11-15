#!/usr/bin/env node
// LAUNCH-DAY LOAD TEST (owner-approved 2026-10-10 night, trust-ops item 7). Keyless, dependency-free (Node's fetch; no k6/autocannon
// download). An OPEN-LOOP generator: requests are started on a fixed schedule per stage whatever the server's latency, so a slow box
// shows up as latency and errors instead of quietly lowering the rate. Run it FROM THE MAC against the box, politely (the box is a
// 2 vCPU / 4 GB VPS) — scripts/ops/loadtest.sh wraps it with the box's RAM/CPU sampled over ssh.
//
//   node scripts/ops/loadtest.mjs [--base https://burnticker.com] [--stages 10x20,25x30,50x30] [--ticker DEFICIT] [--json] [--write docs/burnticker/LOADTEST.md]
//
//   --stages      comma list of <rps>x<seconds>; the default warms up at 10, then 25, then the 50 RPS pass bar
//   --verifier-rps the receipt verifier's own fixed rate (default 0.25: it re-reads devnet and the Treasury on every call — be polite)
//   --bar         pass bar "rps=50,p95=800,5xx=0" (the last stage must meet it)
//   --ssh <user@host>  sample the box's RAM / CPU every 8 s during the run (free -m, /proc/loadavg, top -bn1), read-only
//   --ssh-cmd "<ssh …>" the ssh command (default "ssh -o BatchMode=yes -o ConnectTimeout=8"; add -i <key>)
//
// The mix (weights) is the launch-day path: landing page, a coin page, the coin's API document, the token list, search (a heavy-bucket
// route: a fixed query, so the app's caches absorb it), a static page Caddy serves (the whitepaper). 429s are the API's per-client limiter answering (all
// test traffic comes from one IP) and are counted apart from errors; 5xx and timeouts are errors.
import fs from "node:fs";
import { execFile } from "node:child_process";

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : d; };
const flag = (n) => args.includes(`--${n}`);
const BASE = opt("base", "https://burnticker.com").replace(/\/$/, "");
const STAGES = opt("stages", "10x20,25x30,50x30").split(",").map((s) => { const [r, d] = s.split("x").map(Number); if (!(r > 0 && d > 0) || r > 200) throw new Error(`bad stage ${s} (rps 1–200)`); return { rps: r, seconds: d }; });
const VERIFIER_RPS = Number(opt("verifier-rps", "0.25"));
const BAR = Object.fromEntries(opt("bar", "rps=50,p95=800,5xx=0").split(",").map((kv) => kv.split("=")).map(([k, v]) => [k, Number(v)]));
const TIMEOUT_MS = 10_000;
const UA = "burnticker-loadtest/1 (operator; launch-day rehearsal)";

async function getJson(path) { try { const r = await fetch(`${BASE}${path}`, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(TIMEOUT_MS) }); return r.ok ? await r.json() : null; } catch { return null; } }

const list = await getJson("/api/burnticker/v1/tokens?limit=5");
const ticker = opt("ticker", list?.tokens?.[0]?.ticker ?? "DEFICIT");
const receipts = await getJson("/api/burnticker/v1/check/receipts");
const sig = receipts?.receipts?.[0]?.signature ?? null;
const MIX = [
  { id: "landing", path: "/", w: 20 },
  { id: "coin-page", path: `/burnticker/t/${ticker}`, w: 25 },
  { id: "v1-token", path: `/api/burnticker/v1/tokens/${ticker}`, w: 20 },
  { id: "v1-tokens", path: "/api/burnticker/v1/tokens", w: 10 },
  { id: "v1-search", path: "/api/burnticker/v1/search?q=broncos", w: 15 },
  { id: "static-page", path: "/whitepaper.html", w: 10 },
];
const totalW = MIX.reduce((a, m) => a + m.w, 0);
const pick = (i) => { let x = (i * 7919) % totalW; for (const m of MIX) { if (x < m.w) return m; x -= m.w; } return MIX[0]; };

const results = [];   // { stage, route, status, ms, cf }
let inflight = 0, maxInflight = 0;
async function hit(stage, route, path) {
  const t0 = performance.now(); inflight++; maxInflight = Math.max(maxInflight, inflight);
  let status = 0, cf = null;
  try {
    const r = await fetch(`${BASE}${path}`, { headers: { "user-agent": UA, "cache-control": "no-cache" }, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "manual" });
    status = r.status; cf = r.headers.get("cf-cache-status");
    await r.arrayBuffer();
  } catch (e) { status = /timeout|abort/i.test(String(e?.name ?? e)) ? -1 : -2; }
  inflight--;
  results.push({ stage, route, status, ms: performance.now() - t0, cf });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// The box's resources over ssh, every 8 s while the run lasts (read-only commands).
const SSH_HOST = opt("ssh", null), SSH_CMD = opt("ssh-cmd", "ssh -o BatchMode=yes -o ConnectTimeout=8").split(" ").filter(Boolean);
const samples = [];
const REMOTE = "free -m | awk '/^Mem:/{print $2, $3, $7}'; cut -d' ' -f1 /proc/loadavg; top -bn1 -o %CPU | awk '/Cpu\\(s\\)/{for(i=1;i<=NF;i++) if($i ~ /^id/) print $(i-1)} /^ *PID/{while ((getline) > 0) if ($NF != \"top\") { print $NF\" \"$9\"%\"; exit }}'";
function sampleOnce() {
  return new Promise((resolve) => {
    execFile(SSH_CMD[0], [...SSH_CMD.slice(1), SSH_HOST, REMOTE], { timeout: 7000 }, (err, out) => {
      if (!err) { const l = out.trim().split("\n"); const [t, u, a] = (l[0] ?? "").split(/\s+/); samples.push({ at: new Date().toISOString().slice(11, 19), memTotal: Number(t), memUsed: Number(u), memAvail: Number(a), load1: l[1] ?? "?", idle: (l[2] ?? "?").replace(",", "."), top: l[3] ?? "?" }); }
      resolve();
    });
  });
}
let sampling = !!SSH_HOST;
const sampler = (async () => { while (sampling) { await sampleOnce(); await sleep(8000); } })();
const startedAt = new Date();
const pending = [];
let n = 0;
for (let si = 0; si < STAGES.length; si++) {
  const { rps, seconds } = STAGES[si];
  const t0 = performance.now(), count = Math.round(rps * seconds), gap = 1000 / rps;
  const vCount = sig ? Math.floor(VERIFIER_RPS * seconds) : 0;
  for (let k = 0; k < vCount; k++) pending.push(sleep((k + 0.5) * (seconds * 1000 / Math.max(1, vCount))).then(() => hit(si, "v1-verifier", `/api/burnticker/v1/check/receipts/${sig}`)));
  for (let k = 0; k < count; k++) {
    const due = t0 + k * gap, wait = due - performance.now();
    if (wait > 0) await sleep(wait);
    const m = pick(n++);
    pending.push(hit(si, m.id, m.path));
  }
  process.stderr.write(`stage ${si + 1}/${STAGES.length}: ${rps} rps × ${seconds} s scheduled (${count} requests${vCount ? ` + ${vCount} verifier` : ""}); in flight ${inflight}\n`);
}
await Promise.all(pending);
const endedAt = new Date();
sampling = false; if (SSH_HOST) { await sampleOnce(); } await sampler;

const q = (xs, p) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };
const summarize = (rows) => {
  const ok = rows.filter((r) => r.status >= 200 && r.status < 400), lat = rows.filter((r) => r.status > 0 && r.status !== 429).map((r) => r.ms);
  const codes = {}; for (const r of rows) codes[r.status] = (codes[r.status] ?? 0) + 1;
  return { requests: rows.length, ok: ok.length, s4xx: rows.filter((r) => r.status >= 400 && r.status < 500 && r.status !== 429).length, s429: rows.filter((r) => r.status === 429).length, s5xx: rows.filter((r) => r.status >= 500).length, timeouts: rows.filter((r) => r.status === -1).length, neterr: rows.filter((r) => r.status === -2).length, p50: q(lat, 50), p95: q(lat, 95), p99: q(lat, 99), max: lat.length ? Math.max(...lat) : null, codes };
};
const stages = STAGES.map((s, i) => ({ ...s, ...summarize(results.filter((r) => r.stage === i)) }));
const routes = [...new Set(results.map((r) => r.route))].map((id) => ({ route: id, path: [...MIX, { id: "v1-verifier", path: `/api/burnticker/v1/check/receipts/${sig ? `${sig.slice(0, 8)}…` : "-"}` }].find((m) => m.id === id)?.path, ...summarize(results.filter((r) => r.route === id && r.stage === STAGES.length - 1)) }));
const last = stages[stages.length - 1];
const errRate = last.requests ? (last.s5xx + last.timeouts + last.neterr) / last.requests : 0;
const pass = last.rps >= (BAR.rps ?? 0) && (last.p95 ?? Infinity) < (BAR.p95 ?? Infinity) && last.s5xx + last.timeouts <= (BAR["5xx"] ?? 0);
const report = { base: BASE, ticker, startedAt: startedAt.toISOString(), endedAt: endedAt.toISOString(), stages, routes, maxInflight, errRate, bar: BAR, pass, samples };

const ms = (x) => (x === null ? "—" : `${Math.round(x)}`);
function markdown(r) {
  const out = [];
  out.push(`### Run ${r.startedAt.slice(0, 16).replace("T", " ")} UTC — ${r.pass ? "PASS" : "FAIL"} against ${r.base}`, "");
  out.push(`Bar: last stage at ≥ ${r.bar.rps} RPS mixed, p95 < ${r.bar.p95} ms, ${r.bar["5xx"]} 5xx/timeouts. Coin used: $${r.ticker}. Peak requests in flight: ${r.maxInflight}.`, "");
  out.push("| Stage | RPS × s | Requests | 2xx/3xx | 4xx (not 429) | 429 | 5xx | Timeouts | p50 ms | p95 ms | p99 ms | max ms |", "|---|---|---|---|---|---|---|---|---|---|---|---|");
  r.stages.forEach((s, i) => out.push(`| ${i + 1} | ${s.rps} × ${s.seconds} | ${s.requests} | ${s.ok} | ${s.s4xx} | ${s.s429} | ${s.s5xx} | ${s.timeouts + s.neterr} | ${ms(s.p50)} | ${ms(s.p95)} | ${ms(s.p99)} | ${ms(s.max)} |`));
  out.push("", `Per route, last stage (${r.stages[r.stages.length - 1].rps} RPS):`, "", "| Route | Path | Requests | 2xx/3xx | 4xx | 429 | 5xx | p50 ms | p95 ms |", "|---|---|---|---|---|---|---|---|---|");
  for (const x of r.routes) out.push(`| ${x.route} | \`${x.path}\` | ${x.requests} | ${x.ok} | ${x.s4xx} | ${x.s429} | ${x.s5xx} | ${ms(x.p50)} | ${ms(x.p95)} |`);
  if (r.samples?.length) {
    out.push("", "Box resources during the run (`free -m`, `top -bn1`, over ssh every ~10 s):", "", "| Time (UTC) | RAM used MB / total | available MB | load 1 min | CPU idle % | top process |", "|---|---|---|---|---|---|");
    for (const s of r.samples) out.push(`| ${s.at} | ${s.memUsed} / ${s.memTotal} | ${s.memAvail} | ${s.load1} | ${s.idle} | ${s.top} |`);
  }
  out.push("");
  return out.join("\n");
}
const md = markdown(report);
if (flag("json")) console.log(JSON.stringify(report, null, 2)); else console.log(md);
const w = opt("write");
if (w) { fs.appendFileSync(w, `\n${md}`); process.stderr.write(`appended the run to ${w}\n`); }
process.exit(pass ? 0 : 1);
