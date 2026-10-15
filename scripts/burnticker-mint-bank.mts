// THE MINT KEY BANK SERVICE (owner, 2026-10-14 night: "the BURN vanity address is mandatory. Save them like pump.fun does so they launch
// instantly."). Grinds Ed25519 mint keypairs whose address ends in burn or BURN on worker threads (every core but one; the same search the
// launch page runs, src/lib/burnticker/vanityMint.ts runGrindWorker, on Node's native Ed25519) and keeps them sealed in the bank
// (src/lib/burnticker/mintBank.ts). The launch route takes one per coin. THIS FILE PRINTS NO KEY: only public keys, counts and rates.
//
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/alias-hook.mjs scripts/burnticker-mint-bank.mts            the service (unit mct-burnticker-mintbank)
//   … scripts/burnticker-mint-bank.mts --once --fill N     grind N more keys into the bank, then exit (a manual top-up)
//   … scripts/burnticker-mint-bank.mts --status            print the bank's counts and exit
//   … scripts/burnticker-mint-bank.mts --bench [SECONDS]   grind into nothing for SECONDS (default 20) and print the rate; no bank is opened
//
// Environment (names only; values are never printed):
//   BURNTICKER_MINT_BANK_KEY    32 bytes, base64: seals every secret (AES-256-GCM). Unset: the service refuses to start. No plaintext ever.
//   BURNTICKER_MINT_BANK_PATH   the bank file, default data/burnticker-mintbank.db (mode 0600, never copied off the host)
//   BURNTICKER_MINT_BANK_SIZE   keys to keep ready, default 300
//   BURNTICKER_MINT_BANK_LOW    refill when fewer than this are ready, default 100 (a push alert after an hour below it)
//   BURNTICKER_MINT_BANK_WORKERS grinding threads, default every core but one
//   BURNTICKER_DB               the registry (taken keys whose mint is live are marked created; the low alert is recorded there)
//
// Each cycle (one a minute while full, continuous while filling): taken keys whose mint the registry shows launched are marked created
// (their sealed secret is wiped), keys taken more than 24 hours ago and never created are deleted, the low mark is checked.
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { webcrypto } from "node:crypto";
import os from "node:os";

const here = new URL(import.meta.url);

if (isMainThread) {
  const args = process.argv.slice(2);
  const opt = (n: string): string | undefined => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : undefined; };
  const stamp = () => new Date().toLocaleString("sv-SE", { timeZone: "America/Denver" });
  const log = (s: string) => console.log(`[${stamp()}] ${s}`);
  const { MintBank, MintBankRefusal, bankHousekeeping, mintBankSettings, MINT_BANK_NO_KEY } = await import("../src/lib/burnticker/mintBank.ts");
  const { groundMintProblem } = await import("../src/lib/burnticker/vanityMint.ts");
  const settings = mintBankSettings(process.env);
  const nWorkers = Math.max(1, Math.min(64, Number(process.env.BURNTICKER_MINT_BANK_WORKERS) || Math.max(1, os.availableParallelism() - 1)));
  if (!process.env.UV_THREADPOOL_SIZE) process.env.UV_THREADPOOL_SIZE = String(Math.min(128, nWorkers + 1));

  /**
   * The grinding threads, made once and paused between fills (a worker is never terminated while a key job is in flight: Node aborts on
   * that). `onKey` gets every found key that passes its check; `pause()` resolves once every worker has finished its batch.
   */
  let onKey: (k: { publicKey: string; secretKey: Uint8Array }) => void = () => {};
  let pool: { tries: () => number; resume: () => void; pause: () => Promise<void> } | null = null;
  const workers = () => {
    if (pool) return pool;
    const tries = new Array<number>(nWorkers).fill(0), base = new Array<number>(nWorkers).fill(0);
    const ws: Worker[] = [], idle: (() => void)[] = [];
    let running = false;
    for (let i = 0; i < nWorkers; i++) {
      const w = new Worker(here, { workerData: { engine: "auto" }, env: process.env, execArgv: process.execArgv });
      w.on("message", (m: { type: string; tries?: number; publicKey?: string; secretKey?: Uint8Array; message?: string; stopped?: boolean }) => {
        if (m.type === "progress") tries[i] = base[i] + (m.tries ?? 0);
        else if (m.type === "stopped") { const f = idle[i]; if (f) { delete idle[i]; f(); } }
        else if (m.type === "error") log(`worker ${i}: ${m.message}`);
        else if (m.type === "found" && running) {
          const k = { publicKey: m.publicKey!, secretKey: new Uint8Array(m.secretKey!) };
          if (!groundMintProblem(k)) onKey(k);
        }
      });
      w.on("error", (e) => log(`worker ${i} stopped: ${String((e as Error).message ?? e)}`));
      w.unref();
      ws.push(w);
    }
    pool = {
      tries: () => tries.reduce((a, b) => a + b, 0),
      resume: () => { if (running) return; running = true; ws.forEach((w, i) => { base[i] = tries[i]; w.postMessage({ type: "start" }); }); },
      pause: async () => {
        if (!running) return;
        running = false;
        await Promise.all(ws.map((w, i) => new Promise<void>((r) => { const t = setTimeout(r, 5000); idle[i] = () => { clearTimeout(t); r(); }; w.postMessage({ type: "stop" }); })));
      },
    };
    return pool;
  };

  if (args.includes("--bench")) {
    const secs = Math.max(5, Number(opt("bench")) || 20);
    let found = 0;
    onKey = () => { found++; };
    const g = workers(); g.resume();
    const t0 = Date.now();
    await new Promise((r) => setTimeout(r, secs * 1000));
    await g.pause();
    const n = g.tries(), s = (Date.now() - t0) / 1000;
    console.log(`${nWorkers} workers: ${Math.round(n / s).toLocaleString("en-US")} keys a second (${n.toLocaleString("en-US")} in ${s.toFixed(1)} s), ${found} hits; about ${(5_658_000 / (n / s)).toFixed(1)} s per address`);
    process.exit(0);
  }

  if (!settings.key?.trim()) { console.error(`refusing: ${MINT_BANK_NO_KEY}`); process.exit(2); }
  let bank: InstanceType<typeof MintBank>;
  try { bank = new MintBank(settings.path, { key: settings.key, create: true }); }
  catch (e) { console.error(`refusing: ${e instanceof MintBankRefusal ? e.message : String((e as Error).message ?? e)}`); process.exit(2); }

  if (args.includes("--status")) {
    const s = bank.status();
    console.log(JSON.stringify({ path: settings.path, ready: s.ready, taken: s.taken, created: s.created, size: settings.size, low: settings.low, belowLowSince: s.lowSince ? new Date(s.lowSince).toISOString() : null, oldestReady: s.oldestReadyAt ? new Date(s.oldestReadyAt).toISOString() : null }));
    bank.close(); process.exit(0);
  }

  const { openRegistry, REGISTRY_FILE } = await import("../src/lib/burnticker/registry.ts");
  const registry = (() => { try { return openRegistry(process.env.BURNTICKER_DB || REGISTRY_FILE); } catch (e) { log(`registry not readable (${(e as Error).message.slice(0, 120)}); taken keys are only marked created by the launch route`); return null; } })();
  const isLive = (pub: string) => { const t = registry?.token(pub); return !!t && (!!t.launchTx || t.status === "live"); };

  /** Grind until `want` keys are inserted (or `stopWhen()`), logging the rate every 30 s. */
  const grind = async (want: number, label: string, stopWhen: () => boolean = () => false) => {
    let added = 0;
    const t0 = Date.now();
    let done: () => void = () => {};
    const finished = new Promise<void>((r) => { done = r; });
    onKey = (k) => { if (added >= want) return; try { if (bank.insert(k)) { added++; if (added >= want) done(); } } catch (e) { log(`a key was not banked: ${(e as Error).message.slice(0, 120)}`); } };
    const g = workers(), tries0 = g.tries();
    g.resume();
    const tick = setInterval(() => { const s = (Date.now() - t0) / 1000; log(`${label}: ${added}/${want} banked, ${Math.round((g.tries() - tries0) / s).toLocaleString("en-US")} keys a second on ${nWorkers} workers, ${bank.status().ready} ready`); if (stopWhen()) done(); }, 30_000);
    await finished;
    clearInterval(tick);
    await g.pause();
    onKey = () => {};
    log(`${label}: ${added} banked in ${Math.round((Date.now() - t0) / 1000)} s; ${bank.status().ready} ready`);
    return added;
  };

  if (args.includes("--once")) {
    const n = Math.max(0, Math.min(10_000, Number(opt("fill")) || 0));
    if (!n) { console.error("refusing: --once needs --fill N (how many keys to add)"); process.exit(2); }
    await grind(n, "top-up");
    bank.close(); process.exit(0);
  }

  let stopping = false;
  process.on("SIGTERM", () => { stopping = true; log("stopping"); });
  process.on("SIGINT", () => { stopping = true; });
  log(`mint key bank: ${settings.path}, size ${settings.size}, low ${settings.low}, ${nWorkers} workers; ${bank.status().ready} ready`);
  let filling = false;
  while (!stopping) {
    const h = bankHousekeeping(bank, { size: settings.size, low: settings.low, now: Date.now(), isLive, filling });
    if (h.created || h.swept) log(`${h.created} taken key(s) seen launched, ${h.swept} taken key(s) past 24 hours deleted`);
    if (h.alert && registry) { if (registry.recordAlert({ kind: h.alert.kind, key: h.alert.key, text: h.alert.text, meta: null })) log(`[alert] ${h.alert.kind}: ${h.alert.text.slice(0, 160)}`); }
    filling = h.filling;
    if (h.need > 0) {
      // fill in chunks of at most 25 so housekeeping and the low check keep running while a long fill goes on
      await grind(Math.min(25, h.need), "refill", () => stopping);
      continue;
    }
    for (let i = 0; i < 60 && !stopping; i++) await new Promise((r) => setTimeout(r, 1000));
  }
  bank.close();
  process.exit(0);
} else {
  const { runGrindWorker } = await import("../src/lib/burnticker/vanityMint.ts");
  // the loop posts a last progress line when a stop has taken effect (its batch finished): that is when the main thread may move on
  let stopAsked = false;
  const scope = { onmessage: null as null | ((e: { data: unknown }) => void), postMessage: (m: { type: string }) => { parentPort!.postMessage(m); if (stopAsked && m.type === "progress") { stopAsked = false; parentPort!.postMessage({ type: "stopped" }); } } };
  runGrindWorker(scope as never, {
    subtle: webcrypto.subtle as never,
    randomBytes: (k: number) => webcrypto.getRandomValues(new Uint8Array(k)),
    now: () => performance.now(),
    pause: () => new Promise((r) => setTimeout(r, 0)),
    progressMs: 500,
  });
  parentPort!.on("message", (m: { type: string }) => {
    if (m.type === "stop") stopAsked = true;
    scope.onmessage?.({ data: m.type === "start" ? { type: "start", suffixes: ["burn", "BURN"], engine: workerData.engine } : m });
  });
}
