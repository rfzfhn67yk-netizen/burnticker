// GRIND A MINT KEYPAIR WHOSE ADDRESS ENDS IN burn OR BURN (owner, 2026-10-14) — for the operator's CLI launches
// (scripts/burnkeeper-launch.mts --mint-keypair, scripts/burnreceipts-admin.mts initialize-token --mint). THIS FILE PRINTS NO KEY: it
// writes the keypair as a solana-keygen JSON file (mode 600, never over an existing file) and prints the public key only.
//
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/burnticker-grind-mint.mts --out <path> [--workers N] [--engine auto|js]
//
// The same search the launch page runs in the browser (src/lib/burnticker/vanityMint.ts runGrindWorker), on worker threads with Node's
// native Ed25519. About 5.7 million keys per hit; on a 10-core Apple M5 about 190,000 keys a second, so about 30 seconds on average.
// The equivalent with the Solana CLI: solana-keygen grind --ends-with burn:1 --ends-with BURN:1 (it writes <address>.json in the
// current directory; move it outside the repository and chmod 600).
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { webcrypto } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = new URL(import.meta.url);

if (isMainThread) {
  const args = process.argv.slice(2);
  const opt = (n: string): string | undefined => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3); };
  const die = (s: string): never => { console.error(`refusing: ${s}`); process.exit(2); };
  if (args.includes("--help") || !args.length) { console.error(fs.readFileSync(here, "utf8").split("\n").filter((l) => l.startsWith("//")).map((l) => l.slice(3)).join("\n")); process.exit(0); }
  const out = opt("out") ?? die("--out <path> is required (outside the repository)");
  const abs = path.resolve(out);
  if (fs.existsSync(abs)) die(`${out} exists; a key file is never overwritten`);
  const repo = path.resolve(path.dirname(new URL(here).pathname), "..");
  if (abs.startsWith(repo + path.sep)) die(`${out} is inside the repository; write key files outside it`);
  const engine = opt("engine") === "js" ? "js" : "auto";
  const n = Math.max(1, Math.min(64, Number(opt("workers") ?? Math.max(1, os.availableParallelism() - 1)) || 1));
  // Node runs WebCrypto jobs on the libuv pool: give it one thread per worker
  if (!process.env.UV_THREADPOOL_SIZE) process.env.UV_THREADPOOL_SIZE = String(Math.min(128, n + 1));
  const t0 = Date.now();
  const tries = new Array<number>(n).fill(0);
  const workers: Worker[] = [];
  let done = false;
  const total = () => tries.reduce((a, b) => a + b, 0);
  const tick = setInterval(() => { process.stderr.write(`\rtried ${total().toLocaleString("en-US")} keys in ${Math.round((Date.now() - t0) / 1000)} s on ${n} workers`); }, 500);
  const finish = (code: number) => { done = true; clearInterval(tick); for (const w of workers) void w.terminate(); process.stderr.write("\n"); process.exit(code); };
  for (let i = 0; i < n; i++) {
    const w = new Worker(here, { workerData: { engine }, env: process.env, execArgv: process.execArgv });
    w.on("message", async (m: { type: string; tries?: number; publicKey?: string; secretKey?: Uint8Array; message?: string }) => {
      if (done) return;
      if (m.type === "progress") tries[i] = m.tries ?? tries[i];
      else if (m.type === "error") { console.error(`\nworker ${i}: ${m.message}`); }
      else if (m.type === "found") {
        done = true;
        const { groundMintProblem } = await import("../src/lib/burnticker/vanityMint.ts");
        const key = { publicKey: m.publicKey!, secretKey: new Uint8Array(m.secretKey!) };
        const problem = groundMintProblem(key);
        if (problem) { console.error(`\nthe found key failed its check: ${problem}`); finish(1); }
        fs.writeFileSync(abs, JSON.stringify(Array.from(key.secretKey)), { mode: 0o600, flag: "wx" });
        tries[i] = Math.max(tries[i], m.tries ?? 0);
        console.error(`\nfound after ${total().toLocaleString("en-US")} keys in ${Math.round((Date.now() - t0) / 1000)} s; written to ${out} (mode 600)`);
        console.log(key.publicKey);
        finish(0);
      }
    });
    w.on("error", (e) => { console.error(`\nworker ${i} stopped: ${String(e.message ?? e)}`); });
    workers.push(w);
  }
} else {
  const { runGrindWorker } = await import("../src/lib/burnticker/vanityMint.ts");
  const scope = { onmessage: null as null | ((e: { data: unknown }) => void), postMessage: (m: unknown) => parentPort!.postMessage(m) };
  runGrindWorker(scope as never, {
    subtle: webcrypto.subtle as never,
    randomBytes: (k: number) => webcrypto.getRandomValues(new Uint8Array(k)),
    now: () => performance.now(),
    pause: () => new Promise((r) => setTimeout(r, 0)),
  });
  scope.onmessage!({ data: { type: "start", suffixes: ["burn", "BURN"], engine: workerData.engine } });
}
