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
import { connectionLaunchVerifier, launchVenueOf, type LaunchCheck, type LaunchVerifier } from "@/lib/burnticker/launchVerify";
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

// Prelaunch audit 2026-10-18 F05: the REAL verifier answered every FAILED transaction with a plain 422 before it looked at the signers,
// without `foreign`, so 60 strangers' failed transactions from five clients filled the per-mint ceiling and the creator's confirm got 429.
// These tests drive connectionLaunchVerifier itself over a fake chain reader, so the early return cannot hide behind an injected answer.
const k58 = (s: string) => ({ toBase58: () => s });
const PROGRAM_F05 = Keypair.generate().publicKey.toBase58();
/** A transaction the chain holds, signed by `signers`: failed (err set), or with no metadata at all. */
const chainTx = (signers: string[], o: { noMeta?: boolean } = {}) => ({
  blockTime: (T0 + 60_000) / 1000,
  meta: o.noMeta ? null : { err: { InstructionError: [0, { Custom: 1 }] } as unknown },
  transaction: { message: { header: { numRequiredSignatures: signers.length }, staticAccountKeys: [...signers, PROGRAM_F05].map(k58), compiledInstructions: [] } },
});
type ChainTx = ReturnType<typeof chainTx>;
function realVerifierOver(txs: Map<string, ChainTx>, calls = { tx: 0 }): LaunchVerifier {
  return connectionLaunchVerifier({
    async getTransaction(s) { calls.tx++; return txs.get(s) ?? null; },
    async getAccountInfo() { return null; },
    async getSignatureStatuses(sigs) { return { value: sigs.map((s) => (txs.has(s) ? { confirmationStatus: "confirmed" } : null)) }; },
  }, { burnProgramId: PROGRAM_F05, launchLabProgramId: null, pairCurveProgramId: null });
}
const expectOf = (t: TokenRow) => ({ mint: t.mint, creator: t.creator, draftCreatedAtMs: t.createdAt, rulesSha: t.rulesSha, venue: launchVenueOf(t, null) });

test("F05: the real verifier classes signers before it judges failure: a stranger's failed transaction is foreign, the coin's own is not", async () => {
  const reg = openRegistry(":memory:");
  const t = draft(reg, "SIGNERS");
  const stranger = Keypair.generate().publicKey.toBase58();
  const txs = new Map<string, ChainTx>([
    ["failedForeign", chainTx([stranger])],
    ["failedForeignNoMeta", chainTx([stranger], { noMeta: true })],
    ["failedMintOnly", chainTx([t.mint, stranger])],
    ["failedOwn", chainTx([t.creator, t.mint])],
    ["failedOwnNoMeta", chainTx([t.creator, t.mint], { noMeta: true })],
  ]);
  const v = realVerifierOver(txs);
  const answer = async (s: string) => (await v.verify(s, expectOf(t))) as { ok: boolean; status?: number; foreign?: boolean; belongsToExpectedSigners?: boolean };
  for (const s of ["failedForeign", "failedForeignNoMeta", "failedMintOnly"]) {
    const r = await answer(s);
    assert.equal(r.ok, false); assert.equal(r.status, 422);
    assert.equal(r.belongsToExpectedSigners, false, s); assert.equal(r.foreign, true, s);
  }
  for (const s of ["failedOwn", "failedOwnNoMeta"]) {
    const r = await answer(s);
    assert.equal(r.ok, false); assert.equal(r.status, 422);
    assert.equal(r.belongsToExpectedSigners, true, s); assert.equal(r.foreign, undefined, s);
  }
  assert.equal((await answer("absent")).belongsToExpectedSigners, undefined, "a transaction the chain does not hold is not classed either way");
});

test("F05 (audit repro): 60 strangers' FAILED transactions from five clients through the real verifier leave the creator's confirm at 200", async () => {
  const reg = openRegistry(":memory:");
  const t = draft(reg, "FAILFOREIGN");
  const real = s58(606060), calls = { tx: 0 };
  const txs = new Map<string, ChainTx>();
  for (let i = 0; i < 60; i++) txs.set(s58(40_000 + i), chainTx([Keypair.generate().publicKey.toBase58()]));
  const chain = realVerifierOver(txs, calls);
  let creatorChecks = 0;
  const p = platformOf(reg, {
    seen: async (s) => (s === real ? true : chain.seen!(s)),
    async verify(s, e) { if (s === real) { creatorChecks++; return { ok: true, blockTimeMs: T0 + 60_000 }; } return chain.verify(s, e); },
  });
  const now = T0 + 120_000;
  let c = 0;
  for (const s of txs.keys()) {
    const r = await markLaunched(p, t.mint, s, now + c, `hostile-${Math.floor(c++ / 12)}`);
    assert.equal(r.status, 422, JSON.stringify(r.body));
  }
  assert.equal(c, CONFIRM_VERIFY_PER_MINT_HOUR, "the attack is sized to the per-mint ceiling");
  assert.equal(calls.tx, 60, "every failed foreign transaction was read by the real verifier");
  const r = await markLaunched(p, t.mint, real, now + 1_000, "creator");
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(creatorChecks, 1);
  assert.equal(reg.token(t.mint)!.status, "live");
});

test("review fix: an RPC answer without the transaction's message or header is a retry (502), never a remembered foreign refusal", async () => {
  const reg = openRegistry(":memory:");
  const t = draft(reg, "MALFORMED");
  const bad = new Map<string, unknown>([
    ["noTransaction", { blockTime: 1, meta: { err: null } }],
    ["noMessage", { blockTime: 1, meta: { err: null }, transaction: {} }],
    ["noHeader", { blockTime: 1, meta: { err: null }, transaction: { message: { staticAccountKeys: [] } } }],
    ["noKeys", { blockTime: 1, meta: { err: null }, transaction: { message: { header: { numRequiredSignatures: 1 } } } }],
  ]);
  let reads = 0;
  const v = connectionLaunchVerifier({ async getTransaction(s) { reads++; return (bad.get(s) ?? null) as never; }, async getAccountInfo() { return null; } }, { burnProgramId: PROGRAM_F05 });
  for (const s of bad.keys()) {
    const r = await v.verify(s, expectOf(t)) as { ok: boolean; status?: number; foreign?: boolean; belongsToExpectedSigners?: boolean };
    assert.deepEqual([r.ok, r.status, r.foreign, r.belongsToExpectedSigners], [false, 502, undefined, undefined], s);
  }
  // through markLaunched: answered 502 every time (read again, not from a five-minute memory), and no per-mint slot is taken
  const sig = s58(70_707);
  bad.set(sig, bad.get("noMessage"));
  const p = platformOf(reg, v);
  const before = reads;
  for (let i = 0; i < 3; i++) assert.equal((await markLaunched(p, t.mint, sig, T0 + 120_000 + i, "creator")).status, 502);
  assert.equal(reads - before, 3, "each retry reaches the chain");
});

test("F05: the coin's OWN failed transactions still take per-mint slots (the ceiling still bounds the creator's retries)", async () => {
  const reg = openRegistry(":memory:");
  const t = draft(reg, "OWNFAIL");
  const txs = new Map<string, ChainTx>();
  for (let i = 0; i < CONFIRM_VERIFY_PER_MINT_HOUR; i++) txs.set(s58(50_000 + i), chainTx([t.creator, t.mint]));
  const p = platformOf(reg, realVerifierOver(txs));
  let c = 0;
  for (const s of txs.keys()) assert.equal((await markLaunched(p, t.mint, s, T0 + 120_000 + c, `own-${Math.floor(c++ / 12)}`)).status, 422);
  txs.set(s58(59_999), chainTx([t.creator, t.mint]));
  assert.equal((await markLaunched(p, t.mint, s58(59_999), T0 + 200_000, "fresh-client")).status, 429);
});
