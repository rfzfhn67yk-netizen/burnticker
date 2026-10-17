// Prelaunch audit 2026-10-16 F-16 / F-3 (confirm side): the per-mint ceiling of 60 signatures an hour counted made-up signatures before
// they were verified, and draft mints are public, so strangers could block a creator's confirm for about an hour. A signature now counts
// toward the per-mint ceiling only once the chain holds it AND it was signed by the coin's mint and creator; the per-client limit stays
// the first gate. A confirm whose create landed after the draft window raises one bt-launch-late alert for the owner.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import { openRegistry, DRAFT_TTL_MS, type Registry, type TokenRow } from "@/lib/burnticker/registry";
import { lockRule } from "@/lib/burnticker/rules";
import { CONFIRM_VERIFY_PER_CLIENT_MINT_HOUR, CONFIRM_VERIFY_PER_MINT_HOUR, markLaunched, resetConfirmGuards } from "@/lib/burnticker/api/handlers";
import type { Platform } from "@/lib/burnticker/server";
import type { LaunchCheck, LaunchVerifier } from "@/lib/burnticker/launchVerify";
import { CREATOR } from "./burntickerApiHelpers.ts";
import { BRONCOS } from "./burntickerHelpers.ts";

const T0 = Date.parse("2026-10-14T12:00:00Z");
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
/** distinct 88-character base58 signatures (k written in base 58, padded) */
const s58 = (k: number) => { let o = ""; do { o = B58[k % 58] + o; k = Math.floor(k / 58); } while (k > 0); return (o + "z".repeat(88)).slice(0, 88); };
const draft = (reg: Registry, ticker: string): TokenRow => reg.register({ mint: Keypair.generate().publicKey.toBase58(), ticker, name: `${ticker} coin`, creator: CREATOR, description: "", imageUrl: null, links: [], rulesText: lockRule(BRONCOS).text, feePda: "F", vault: null, tokenConfig: null, poolId: "Pool111111111111111111111111111111111111111", launchTx: null, cluster: "devnet", platformId: "Plat111111111111111111111111111111111111111", baselineAt: new Date(T0).toISOString(), status: "draft" }, T0);
const platformOf = (registry: Registry, launchVerifier: LaunchVerifier) => ({ registry, launchVerifier }) as unknown as Platform;
beforeEach(() => resetConfirmGuards());

/** The chain: `real` holds the creator's create; `foreign` are real transactions of other people; anything else does not exist. */
function chainVerifier(real: string, landedMs: number, foreign: Set<string>, calls = { tx: 0, status: 0 }): LaunchVerifier {
  return {
    async verify(s): Promise<LaunchCheck> {
      calls.tx++;
      if (s === real) return { ok: true, blockTimeMs: landedMs };
      if (foreign.has(s)) return { ok: false, status: 422, foreign: true, reason: "the transaction was not signed by this coin's mint" };
      return { ok: false, status: 404, reason: "no confirmed transaction with this signature on this cluster (yet)" };
    },
    async seen(s) { calls.status++; return s === real || foreign.has(s); },
  };
}

test("F-16: five hostile clients sending 12 made-up signatures each do not block the creator's confirm", async () => {
  const reg = openRegistry(":memory:");
  const t = draft(reg, "BLOCKED");
  const real = s58(424242), calls = { tx: 0, status: 0 };
  const p = platformOf(reg, chainVerifier(real, T0 + 60_000, new Set(), calls));
  const now = T0 + 120_000;
  let k = 1;
  for (let c = 0; c < 5; c++) for (let i = 0; i < 12; i++) assert.equal((await markLaunched(p, t.mint, s58(k++), now + k, `hostile-${c}`)).status, 404);
  assert.equal(CONFIRM_VERIFY_PER_CLIENT_MINT_HOUR, 12);
  assert.ok(5 * 12 >= CONFIRM_VERIFY_PER_MINT_HOUR, "the attack is sized to the old ceiling");
  const r = await markLaunched(p, t.mint, real, now + 1_000, "creator");
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(reg.token(t.mint)!.status, "live");
  assert.equal(calls.tx, 1, "made-up signatures cost a status lookup, never a transaction read");
});

test("F-16: real transactions of other people (signatures copied from the chain) do not fill the per-mint ceiling either", async () => {
  const reg = openRegistry(":memory:");
  const t = draft(reg, "COPIED");
  const real = s58(777777), foreign = new Set(Array.from({ length: 80 }, (_, i) => s58(10_000 + i)));
  const p = platformOf(reg, chainVerifier(real, T0 + 60_000, foreign));
  const now = T0 + 120_000;
  let c = 0;
  for (const s of foreign) await markLaunched(p, t.mint, s, now + c, `copier-${Math.floor(c++ / 12)}`);
  assert.equal((await markLaunched(p, t.mint, real, now + 1_000, "creator")).status, 200);
});

test("F-16: the per-client limit is still the first gate", async () => {
  const reg = openRegistry(":memory:");
  const t = draft(reg, "CLIENT");
  const p = platformOf(reg, chainVerifier(s58(1), T0 + 60_000, new Set()));
  for (let i = 0; i < CONFIRM_VERIFY_PER_CLIENT_MINT_HOUR; i++) await markLaunched(p, t.mint, s58(100 + i), T0 + 120_000 + i, "spammer");
  assert.equal((await markLaunched(p, t.mint, s58(999), T0 + 130_000, "spammer")).status, 429);
});

test("F-3: a confirm whose create landed after the window answers launch-late and raises one bt-launch-late alert per mint", async () => {
  const reg = openRegistry(":memory:");
  const t = draft(reg, "LATECONF");
  const real = s58(31337), landed = T0 + DRAFT_TTL_MS + 3_600_000;
  const p = platformOf(reg, chainVerifier(real, landed, new Set()));
  const r = await markLaunched(p, t.mint, real, landed + 60_000, "creator");
  assert.equal(r.status, 409); assert.equal((r.body as { code?: string }).code, "launch-late");
  await markLaunched(p, t.mint, real, landed + 2 * 86_400_000, "creator");
  const alerts = reg.alertsSince(0).filter((a) => a.kind === "bt-launch-late");
  assert.equal(alerts.length, 1);
  assert.match(alerts[0].text, /burnticker-draft-revive\.mts/);
});

test("review L1: answers the chain could not give (502, 503, a throw) never take a per-mint slot; a 409 that is not foreign does", async () => {
  const reg = openRegistry(":memory:");
  const t = draft(reg, "FLAKY");
  const real = s58(5150);
  let mode: "502" | "503" | "throw" = "502";
  const p = platformOf(reg, {
    async verify(s): Promise<LaunchCheck> {
      if (s === real) return { ok: true, blockTimeMs: T0 + 60_000 };
      if (mode === "throw") throw new Error("budget hold");
      return { ok: false, status: mode === "502" ? 502 : 503, reason: "the RPC could not answer" };
    },
    async seen() { return true; },
  });
  let k = 1;
  for (const m of ["502", "503", "throw"] as const) { mode = m; for (let i = 0; i < (m === "throw" ? 10 : 30); i++) { try { await markLaunched(p, t.mint, s58(20_000 + k), T0 + 120_000 + k, `c${k}`); } catch { /* the throw */ } k++; } }
  assert.ok(k - 1 >= CONFIRM_VERIFY_PER_MINT_HOUR);
  assert.equal((await markLaunched(p, t.mint, real, T0 + 200_000, "creator")).status, 200);
});
