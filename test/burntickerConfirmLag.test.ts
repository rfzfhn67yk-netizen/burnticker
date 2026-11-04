// Second prelaunch audit 2026-10-18 A-20: the confirm kept a 60-second "not found" memory per (mint, signature) while the signing card
// retries a 404 five times, 4 seconds apart. With the server's RPC 20 seconds behind the browser, every retry was answered from memory
// and the card gave up on a launch that had landed ("Wait a minute and press the button again"). The client that first sent the
// signature may now have the chain read again every few seconds; anyone else still gets the minute's memory.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Keypair } from "@solana/web3.js";
import { markLaunched, resetConfirmGuards, MISSING_RECHECK_MS } from "@/lib/burnticker/api/handlers";
import { confirmPlan, type SignPlan } from "@/lib/burnticker/signPlan";
import { launchedErrorMessage } from "@/lib/burnticker/pairLaunchClient";
import { openRegistry, type Registry } from "@/lib/burnticker/registry";
import { lockRule } from "@/lib/burnticker/rules";
import type { Platform } from "@/lib/burnticker/server";
import type { LaunchCheck, LaunchVerifier } from "@/lib/burnticker/launchVerify";
import { CREATOR } from "./burntickerApiHelpers.ts";
import { BRONCOS } from "./burntickerHelpers.ts";

const T0 = Date.parse("2026-10-18T12:00:00Z");
const SIG = "4".repeat(88);
beforeEach(() => resetConfirmGuards());
const draft = (reg: Registry) => reg.register({ mint: Keypair.generate().publicKey.toBase58(), ticker: "LAGGED", name: "Lagged coin", creator: CREATOR, description: "", imageUrl: null, links: [], rulesText: lockRule(BRONCOS).text, feePda: "F", vault: null, tokenConfig: null, poolId: "Pool111111111111111111111111111111111111111", launchTx: null, cluster: "devnet", platformId: "Plat111111111111111111111111111111111111111", baselineAt: new Date(T0).toISOString(), status: "draft" }, T0);
/** The server's RPC shows the landed transaction only from `visibleAt` (it lags the browser). */
const laggingChain = (clock: { t: number }, visibleAt: number, reads = { n: 0 }): LaunchVerifier => ({
  async seen(s) { reads.n++; return s === SIG && clock.t >= visibleAt; },
  async verify(s): Promise<LaunchCheck> { reads.n++; return s === SIG && clock.t >= visibleAt ? { ok: true, blockTimeMs: T0 + 1_000 } : { ok: false, status: 404, reason: "not found yet" }; },
});

test("A-20: the server's RPC 20 s behind the browser: the card's own retries record the launch, with no second press", async () => {
  const reg = openRegistry(":memory:");
  const t = draft(reg);
  const clock = { t: T0 + 5_000 };
  const p = { registry: reg, launchVerifier: laggingChain(clock, clock.t + 20_000) } as unknown as Platform;
  const fetchFn = async (_u: string, init: { body: string }) => {
    const b = JSON.parse(init.body) as { mint: string; launchTx: string };
    const a = await markLaunched(p, b.mint, b.launchTx, clock.t, "creator-tab");
    return { ok: a.status === 200, status: a.status, headers: { get: () => null }, json: async () => a.body };
  };
  const plan = { confirms: [{ mint: t.mint, ticker: "LAGGED", step: 0 }] } as unknown as SignPlan;
  // the card's defaults: 5 retries, 4 s apart
  const c = await confirmPlan(fetchFn, plan, [SIG], launchedErrorMessage, { sleep: async (ms) => { clock.t += ms; } });
  assert.equal(c.error, null, String(c.error));
  assert.deepEqual(c.confirmed, [t.mint]);
  assert.equal(reg.token(t.mint)!.status, "live");
});

test("A-20: another client still gets the minute's memory (no chain read), and the first sender is held to one read every few seconds", async () => {
  const reg = openRegistry(":memory:");
  const t = draft(reg);
  const clock = { t: T0 + 5_000 }, reads = { n: 0 };
  const p = { registry: reg, launchVerifier: laggingChain(clock, Number.MAX_SAFE_INTEGER, reads) } as unknown as Platform;
  assert.equal((await markLaunched(p, t.mint, SIG, clock.t, "first")).status, 404);
  const afterFirst = reads.n;
  assert.equal((await markLaunched(p, t.mint, SIG, clock.t + 10_000, "stranger")).status, 404);
  assert.equal(reads.n, afterFirst, "a stranger is answered from memory");
  assert.equal((await markLaunched(p, t.mint, SIG, clock.t + MISSING_RECHECK_MS - 1, "first")).status, 404);
  assert.equal(reads.n, afterFirst, "the first sender inside the re-check gap is answered from memory too");
  assert.equal((await markLaunched(p, t.mint, SIG, clock.t + MISSING_RECHECK_MS, "first")).status, 404);
  assert.ok(reads.n > afterFirst, "after the gap the first sender's retry reaches the chain");
});

test("A-20: the reload recovery's launch record asks again after a 429, like the signing card's", () => {
  const src = fs.readFileSync(path.join(import.meta.dirname, "..", "src/app/burnticker/launch/LaunchRecovery.tsx"), "utf8");
  assert.match(src, /const recoveryFetch = retry429\(/);
  assert.match(src, /recoverStoredLaunch\(storage, s, chainReadDeps\(connection\), recoveryFetch,/);
});
