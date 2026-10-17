// AUDIT A · C1 (prelaunch audits, 2026-10-15): a coin created on chain but never confirmed by the browser was lost after 24 h. Only the
// browser's `action: "launched"` took a draft live; the lazy sweep expired it at 24 h by sweep time (whatever the create's block time);
// expiry was final by trigger; the recovery notice lived in one tab's sessionStorage and only while launches were open; a pair whose B
// create failed recorded neither coin; confirms were refused while launches were closed and spent the 10-an-hour write bucket.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Keypair, PublicKey } from "@solana/web3.js";
import { openRegistry, DRAFT_GRACE_MS, DRAFT_TTL_MS, type Registry, type TokenRow } from "@/lib/burnticker/registry";
import { lockRule } from "@/lib/burnticker/rules";
import { CONFIRM_VERIFY_PER_CLIENT_MINT_HOUR, CONFIRM_VERIFY_PER_MINT_HOUR, REFUSAL_MEMORY_MS, launchesClosedAt, markLaunched, resetConfirmGuards } from "@/lib/burnticker/api/handlers";
import type { Platform } from "@/lib/burnticker/server";
import type { LaunchExpectation, LaunchVerifier } from "@/lib/burnticker/launchVerify";
import { configPda, feePda } from "@/lib/burnReceipts/pda";
import { reconcileDrafts, reviveDraft, BACKOFF_MIN_MS, RECONCILE_INTERVAL_MS, SCAN_STATUS_PREFIX, VERIFY_PER_SWEEP, type DraftChainReader } from "@/lib/burnticker/draftReconciler";
import { PLAN_STORAGE_PREFIX, legacyTogether, launchlabPlan, memoryPlanStorage, planConfirmations, pairCurvePlan, recoverStoredLaunch, listStoredLaunches, type LaunchlabBundleLike } from "@/lib/burnticker/signPlan";
import { limiter } from "@/lib/burnticker/api/http";
import { storedLaunchAction } from "@/lib/burnticker/launchRecovery";
import { RATE_LIMITS } from "@/lib/burnticker/api/spec";
import { CREATOR_LAUNCHES_FLAG } from "@/lib/burnticker/creatorLaunches";
import { CREATOR_LAUNCHES_CLOSED_AT_FLAG } from "@/lib/burnticker/launchAvailability";
import { API, CREATOR, POST_HEADERS, callRoute, makeWorld } from "./burntickerApiHelpers.ts";
import { BRONCOS } from "./burntickerHelpers.ts";

const ROOT = path.join(import.meta.dirname, "..");
const T0 = Date.parse("2026-10-14T12:00:00Z");
const PROGRAM = Keypair.generate().publicKey.toBase58();
const sig = (c: string) => c.repeat(88);
const draft = (reg: Registry, ticker: string, at: number, status: "draft" = "draft"): TokenRow => {
  const mint = Keypair.generate().publicKey.toBase58();
  return reg.register({ mint, ticker, name: `${ticker} coin`, creator: CREATOR, description: "", imageUrl: null, links: [], rulesText: lockRule(BRONCOS).text, feePda: "F", vault: null, tokenConfig: null, poolId: "Pool111111111111111111111111111111111111111", launchTx: null, cluster: "devnet", platformId: "Plat111111111111111111111111111111111111111", baselineAt: new Date(at).toISOString(), status }, at);
};
/** A verifier over a fixed table: signature → block time; anything else is "not this coin's launch". */
function tableVerifier(table: Map<string, { mint: string; blockTimeMs: number }>, calls: string[] = []): LaunchVerifier {
  return { async verify(s: string, e: LaunchExpectation) { calls.push(s); const x = table.get(s); return x && x.mint === e.mint && x.blockTimeMs + 60_000 >= e.draftCreatedAtMs ? { ok: true, blockTimeMs: x.blockTimeMs } : { ok: false, status: 422, reason: "not this coin's launch" }; } };
}
const platformOf = (registry: Registry, launchVerifier: LaunchVerifier) => ({ registry, launchVerifier }) as unknown as Platform;
beforeEach(() => resetConfirmGuards());

describe("C1 · the browser confirm judges the 24 h window on the create's block time, not on sweep timing", () => {
  test("a launch landed at 23 h 59 m is accepted whether or not a sweep ran first", async () => {
    for (const swept of [false, true]) {
      const reg = openRegistry(":memory:");
      const t = draft(reg, "LATE", T0);
      const landed = T0 + DRAFT_TTL_MS - 60_000;
      if (swept) { assert.equal(reg.expireDrafts(T0 + DRAFT_TTL_MS + 5 * 60_000), 1); assert.equal(reg.token(t.mint)!.status, "expired"); }
      const r = await markLaunched(platformOf(reg, tableVerifier(new Map([[sig("5"), { mint: t.mint, blockTimeMs: landed }]]))), t.mint, sig("5"));
      assert.equal(r.status, 200, `swept=${swept}: ${JSON.stringify(r.body)}`);
      const live = reg.token(t.mint)!;
      assert.equal(live.status, "live"); assert.equal(live.launchTx, sig("5")); assert.equal(live.baselineAt, new Date(landed).toISOString());
    }
  });

  test("an expired draft leaves `expired` only through a recorded on-chain revival (append-only; the trigger still refuses every other exit)", () => {
    const reg = openRegistry(":memory:");
    const t = draft(reg, "OLD", T0);
    reg.expireDrafts(T0 + 2 * DRAFT_TTL_MS);
    assert.throws(() => reg.db.prepare("UPDATE tokens SET status='live', launch_tx=? WHERE mint=?").run(sig("4"), t.mint), /stays expired/);
    assert.throws(() => reg.setTokenStatus(t.mint, "draft"), /stays expired/);
    assert.throws(() => reg.markLaunched(t.mint, sig("4"), null, new Date(T0).toISOString()), /expired/, "the plain draft path still refuses");
    const r = reg.takeLiveFromChain(t.mint, sig("4"), null, T0 + 3_600_000, { source: "operator", note: "test" }, T0 + 2 * DRAFT_TTL_MS);
    assert.equal(r.revived, true); assert.equal(r.withinWindow, true);
    assert.equal(reg.token(t.mint)!.status, "live");
    const rows = reg.draftRevivals();
    assert.equal(rows.length, 1); assert.equal(rows[0].launchTx, sig("4")); assert.equal(rows[0].source, "operator");
    assert.throws(() => reg.db.prepare("UPDATE draft_revivals SET source='x'").run(), /append-only/);
    assert.throws(() => reg.db.prepare("DELETE FROM draft_revivals").run(), /append-only/);
  });

  test("a registry file made before the revival path gets the narrowed trigger in place (the guard stays; only a revival row opens it)", () => {
    const dir = fs.mkdtempSync(path.join((process.env.TMPDIR ?? "/tmp"), "bt-c1-")), file = path.join(dir, "r.db");
    const a = openRegistry(file);
    a.db.exec("DROP TRIGGER tokens_expired_final; CREATE TRIGGER tokens_expired_final BEFORE UPDATE OF status ON tokens WHEN OLD.status = 'expired' AND NEW.status <> 'expired' BEGIN SELECT RAISE(ABORT, 'tokens: an expired draft stays expired (build a fresh bundle)'); END;");
    const t = draft(a, "MIG", T0); a.expireDrafts(T0 + 2 * DRAFT_TTL_MS); a.close();
    const b = openRegistry(file);
    assert.match(String((b.db.prepare("SELECT sql FROM sqlite_master WHERE name='tokens_expired_final'").get() as { sql: string }).sql), /draft_revivals/);
    assert.throws(() => b.setTokenStatus(t.mint, "live"), /stays expired/);
    b.takeLiveFromChain(t.mint, sig("3"), null, T0 + 60_000, { source: "reconciler" }, T0 + 2 * DRAFT_TTL_MS);
    assert.equal(b.token(t.mint)!.status, "live");
    b.close();
  });

  test("review (1): a create AFTER the draft's window is refused by the confirm (draft or expired); only the operator takes it live, with --late, and it is recorded", async () => {
    const reg = openRegistry(":memory:");
    const a = draft(reg, "LATEA", T0), b = draft(reg, "LATEB", T0);
    reg.expireDrafts(T0 + DRAFT_TTL_MS + 1);
    const late = T0 + DRAFT_TTL_MS + DRAFT_GRACE_MS + 60_000;
    const v = tableVerifier(new Map([[sig("5"), { mint: a.mint, blockTimeMs: late }], [sig("6"), { mint: b.mint, blockTimeMs: late }]]));
    const r = await markLaunched(platformOf(reg, v), a.mint, sig("5"));
    assert.equal(r.status, 409); assert.equal((r.body as { code: string }).code, "launch-late");
    assert.equal(reg.token(a.mint)!.status, "expired");
    assert.throws(() => reg.takeLiveFromChain(a.mint, sig("5"), null, late, { source: "reconciler" }), /after its draft's 24-hour window/);
    assert.throws(() => reg.takeLiveFromChain(a.mint, sig("5"), null, late, { source: "confirm", late: true }), /only the operator/, "late is the operator's alone");
    const noLate = await reviveDraft(reg, v, { mint: a.mint, launchTx: sig("5"), note: "creator asked", late: false, apply: true });
    assert.equal(noLate.ok, false); assert.match((noLate as { reason: string }).reason, /--late/);
    const dry = await reviveDraft(reg, v, { mint: a.mint, launchTx: sig("5"), note: "creator asked", late: true, apply: false });
    assert.deepEqual([dry.ok, (dry as { applied: boolean }).applied], [true, false]); assert.equal(reg.token(a.mint)!.status, "expired");
    const done = await reviveDraft(reg, v, { mint: a.mint, launchTx: sig("5"), note: "creator asked", late: true, apply: true });
    assert.equal(done.ok, true); assert.equal(reg.token(a.mint)!.status, "live");
    // a still-draft row whose create was late is recorded too (review 7)
    const reg2 = openRegistry(":memory:"); const c = draft(reg2, "LATEC", T0);
    assert.equal((await reviveDraft(reg2, tableVerifier(new Map([[sig("7"), { mint: c.mint, blockTimeMs: late }]])), { mint: c.mint, launchTx: sig("7"), note: "x", late: true, apply: true })).ok, true);
    assert.deepEqual(reg2.draftRevivals().map((x) => [x.mint, x.withinWindow, x.source]), [[c.mint, false, "operator"]]);
    assert.deepEqual(reg.draftRevivals().map((x) => [x.mint, x.withinWindow]), [[a.mint, false]]);
    // the grace: a create 5 minutes past 24 h is in time
    const ok = await markLaunched(platformOf(reg, v), b.mint, sig("6"));
    assert.equal(ok.status, 409, "b's create is late too");
    const reg3 = openRegistry(":memory:"); const e = draft(reg3, "GRACE", T0);
    assert.equal((await markLaunched(platformOf(reg3, tableVerifier(new Map([[sig("8"), { mint: e.mint, blockTimeMs: T0 + DRAFT_TTL_MS + 5 * 60_000 }]]))), e.mint, sig("8"))).status, 200);
  });

  test("route level: an expired draft whose launch the verifier refuses stays expired (422), and the refusal is answered from memory", async () => {
    const reg = openRegistry(":memory:");
    const t = draft(reg, "NOPE", T0); reg.expireDrafts(T0 + DRAFT_TTL_MS + 1);
    const calls: string[] = [];
    const p = platformOf(reg, tableVerifier(new Map(), calls));
    for (let i = 0; i < 3; i++) { const r = await markLaunched(p, t.mint, sig("4")); assert.equal(r.status, 422); }
    assert.equal(reg.token(t.mint)!.status, "expired"); assert.deepEqual(reg.draftRevivals(), []);
    assert.equal(calls.length, 1, "a refused (mint, signature) is verified once");
  });

  test("re-review (1): the limit counts DISTINCT signatures per (client, mint), with a higher ceiling per mint; a retried signature counts once", async () => {
    const reg = openRegistry(":memory:");
    const t = draft(reg, "SPAM", T0);
    const calls: string[] = [];
    const p = platformOf(reg, { verify: async (s) => { calls.push(s); return { ok: false, status: 404, reason: "not found yet" }; } });
    const now = Date.now();
    const s58 = (k: number) => (k.toString(36).replace(/0/g, "z").replace(/l/g, "m") + "A".repeat(88)).slice(0, 88);
    for (let i = 0; i < 30; i++) assert.equal((await markLaunched(p, t.mint, sig("5"), now + i, "creator")).status, 404, "a creator retrying the same signature after 404s is never locked out");
    for (let i = 0; i < CONFIRM_VERIFY_PER_CLIENT_MINT_HOUR; i++) assert.equal((await markLaunched(p, t.mint, s58(i + 1), now + 100 + i, "spammer")).status, 404);
    assert.equal((await markLaunched(p, t.mint, s58(99), now + 200, "spammer")).status, 429, "the spammer is limited");
    assert.equal((await markLaunched(p, t.mint, sig("6"), now + 201, "creator")).status, 404, "the creator is not");
    // F-16 (2026-10-16): signatures the chain does not hold never fill the per-mint ceiling, whoever sends them
    for (let i = 0; i < CONFIRM_VERIFY_PER_MINT_HOUR; i++) await markLaunched(p, t.mint, s58(1000 + i), now + 300 + i, `c${i}`);
    assert.equal((await markLaunched(p, t.mint, s58(5000), now + 400, "creator")).status, 404, "the creator is still checked");
    // the per-mint ceiling counts transactions on chain signed by this coin's mint and creator (refused for their content)
    const b58 = (k: number) => { const A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"; let o = ""; do { o = A[k % 58] + o; k = Math.floor(k / 58); } while (k > 0); return (o + "x".repeat(88)).slice(0, 88); };
    const onChain = platformOf(reg, { verify: async () => ({ ok: false, status: 422, reason: "the TokenConfig on chain locks another rule" }) });
    for (let i = 0; i < CONFIRM_VERIFY_PER_MINT_HOUR; i++) await markLaunched(onChain, t.mint, b58(2000 + i), now + 500 + i, `d${i}`);
    assert.equal((await markLaunched(onChain, t.mint, b58(6000), now + 600, "creator")).status, 429);
    assert.equal((await markLaunched(onChain, t.mint, b58(6000), now + 3_600_700, "creator")).status, 422, "an hour later it is checked again");
  });

  test("re-review (3): a content refusal is remembered for 5 minutes; an account not found yet (a lagging RPC) is never remembered", async () => {
    const reg = openRegistry(":memory:");
    const t = draft(reg, "LAG", T0);
    let calls = 0, missing = true;
    const p = platformOf(reg, { verify: async () => { calls++; return missing ? { ok: false, status: 422, reason: "no TokenConfig", missing: true } : { ok: false, status: 422, reason: "another creator" }; } });
    const now = Date.now();
    await markLaunched(p, t.mint, sig("5"), now); await markLaunched(p, t.mint, sig("5"), now + 1);
    assert.equal(calls, 2, "not remembered");
    missing = false;
    await markLaunched(p, t.mint, sig("5"), now + 2); await markLaunched(p, t.mint, sig("5"), now + 3);
    assert.equal(calls, 3, "remembered");
    await markLaunched(p, t.mint, sig("5"), now + 3 + REFUSAL_MEMORY_MS);
    assert.equal(calls, 4, "forgotten after 5 minutes");
  });

  test("re-review (2): the closure is recorded or cleared by every request that evaluates the launch switch (bundle, launch page)", async () => {
    const w = await makeWorld(); limiter.reset();
    const was = process.env[CREATOR_LAUNCHES_FLAG];
    try {
      delete process.env[CREATOR_LAUNCHES_FLAG];
      await callRoute(`${API}/launch/bundle`, { method: "POST", headers: { ...POST_HEADERS, "x-forwarded-for": "198.51.100.70" }, body: "{}" });
      assert.ok(Number(w.registry.getStatus("launches.closedAt")) > 0, "the bundle route recorded the closure");
      process.env[CREATOR_LAUNCHES_FLAG] = "1";
      const { POST } = await import("../src/app/api/burnticker/launch/route.ts");
      await POST(new Request("http://bt.test/api/burnticker/launch", { method: "POST", headers: { host: "bt.test", origin: "http://bt.test", "x-forwarded-proto": "https", "content-type": "application/json", "x-forwarded-for": "198.51.100.71" }, body: "{}" }));
      assert.equal(w.registry.getStatus("launches.closedAt"), "", "the launch page route cleared it once open");
      assert.equal(launchesClosedAt(w.p), null);
    } finally { if (was === undefined) delete process.env[CREATOR_LAUNCHES_FLAG]; else process.env[CREATOR_LAUNCHES_FLAG] = was; limiter.reset(); }
  });

  test("review (1): while launches are closed, only a create that landed before the closure is recorded", async () => {
    const was = process.env[CREATOR_LAUNCHES_FLAG], wasAt = process.env[CREATOR_LAUNCHES_CLOSED_AT_FLAG];
    try {
      delete process.env[CREATOR_LAUNCHES_FLAG];
      process.env[CREATOR_LAUNCHES_CLOSED_AT_FLAG] = new Date(T0 + 3_600_000).toISOString();
      const reg = openRegistry(":memory:");
      const a = draft(reg, "BEFORE", T0), b = draft(reg, "AFTER", T0);
      const v = tableVerifier(new Map([[sig("5"), { mint: a.mint, blockTimeMs: T0 + 60_000 }], [sig("6"), { mint: b.mint, blockTimeMs: T0 + 2 * 3_600_000 }]]));
      assert.equal((await markLaunched(platformOf(reg, v), a.mint, sig("5"))).status, 200);
      const r = await markLaunched(platformOf(reg, v), b.mint, sig("6"));
      assert.equal(r.status, 403); assert.equal((r.body as { code: string }).code, "launch-after-closure");
      assert.equal(reg.token(b.mint)!.status, "draft");
      delete process.env[CREATOR_LAUNCHES_CLOSED_AT_FLAG];
      // no flag: the first time the host sees launches closed is the closure (recorded for the keeper too)
      const reg2 = openRegistry(":memory:"); const c = draft(reg2, "FIRST", T0);
      const r2 = await markLaunched(platformOf(reg2, tableVerifier(new Map([[sig("7"), { mint: c.mint, blockTimeMs: T0 + 60_000 }]]))), c.mint, sig("7"), T0 + 3_600_000);
      assert.equal(r2.status, 200); assert.equal(reg2.getStatus("launches.closedAt"), String(T0 + 3_600_000));
    } finally {
      if (was === undefined) delete process.env[CREATOR_LAUNCHES_FLAG]; else process.env[CREATOR_LAUNCHES_FLAG] = was;
      if (wasAt === undefined) delete process.env[CREATOR_LAUNCHES_CLOSED_AT_FLAG]; else process.env[CREATOR_LAUNCHES_CLOSED_AT_FLAG] = wasAt;
    }
  });
});

describe("C1 · the keeper's draft reconciler takes coins created in their window live from the chain (bounded)", () => {
  type Sig = { signature: string; err: unknown; blockTime: number | null };
  /**
   * A chain: TokenConfigs by mint, each coin's history NEWEST FIRST, honouring before/until/limit like the RPC. F-2 (2026-10-16): the
   * reconciler reads the coin's FEE PDA history (in every create, in no swap), so `hist` (keyed by mint) answers for that address.
   */
  function chain(cfgMints: Set<string>, hist: Map<string, Sig[]>, owner = PROGRAM) {
    const calls = { multiple: 0, keys: 0, sigs: 0, opts: [] as { before?: string; until?: string }[] };
    const reader: DraftChainReader = {
      async getMultipleAccountsInfo(keys: PublicKey[]) { calls.multiple++; calls.keys += keys.length; return keys.map((k) => { const m = [...cfgMints].find((x) => configPda(new PublicKey(PROGRAM), new PublicKey(x)).equals(k)); return m ? { owner: new PublicKey(owner), data: new Uint8Array(8) } : null; }); },
      async getSignaturesForAddress(a: PublicKey, o: { limit: number; before?: string; until?: string }) {
        calls.sigs++; calls.opts.push({ before: o.before, until: o.until });
        const m = [...hist.keys()].find((x) => feePda(new PublicKey(PROGRAM), new PublicKey(x)).equals(a));
        let rows = m ? hist.get(m)! : [];
        if (o.before) rows = rows.slice(rows.findIndex((r) => r.signature === o.before) + 1);
        if (o.until) { const u = rows.findIndex((r) => r.signature === o.until); if (u >= 0) rows = rows.slice(0, u); }
        return rows.slice(0, o.limit);
      },
    };
    return { reader, calls };
  }
  const secs = (ms: number) => Math.floor(ms / 1000);
  const run = (reg: Registry, reader: DraftChainReader, verifier: LaunchVerifier, now: number, extra: Record<string, unknown> = {}) => reconcileDrafts({ registry: reg, reader, verifier, burnProgramId: PROGRAM, now: () => now, log: () => {}, dryRun: false, env: {}, ...extra });

  test("a create that landed at 23 h 59 m, swept to expired, the browser never confirmed: taken live with its signature and block time", async () => {
    const reg = openRegistry(":memory:");
    const t = draft(reg, "LOST", T0);
    reg.expireDrafts(T0 + DRAFT_TTL_MS + 1);
    const landed = T0 + DRAFT_TTL_MS - 60_000;
    const { reader } = chain(new Set([t.mint]), new Map([[t.mint, [{ signature: sig("9"), err: null, blockTime: secs(landed + 60_000) }, { signature: sig("8"), err: null, blockTime: secs(landed) }]]]));
    const r = await run(reg, reader, tableVerifier(new Map([[sig("8"), { mint: t.mint, blockTimeMs: landed }]])), landed + 3_600_000);
    assert.deepEqual(r.takenLive.map((x) => x.mint), [t.mint]);
    const live = reg.token(t.mint)!;
    assert.equal(live.status, "live"); assert.equal(live.launchTx, sig("8")); assert.equal(live.baselineAt, new Date(landed).toISOString());
    assert.equal(reg.draftRevivals()[0].withinWindow, true);
    assert.ok(reg.alertsSince(0).some((a) => a.kind === "draft-reconciled"));
  });

  test("review (1), F-3: a create that landed at 25 h is NOT taken live by the reconciler; the draft is finished and the owner is alerted once", async () => {
    const reg = openRegistry(":memory:");
    const t = draft(reg, "LATE25", T0);
    const landed = T0 + 25 * 3_600_000, calls: string[] = [];
    const { reader } = chain(new Set([t.mint]), new Map([[t.mint, [{ signature: sig("8"), err: null, blockTime: secs(landed) }]]]));
    const r = await run(reg, reader, tableVerifier(new Map([[sig("8"), { mint: t.mint, blockTimeMs: landed }]]), calls), landed + 3_600_000);
    assert.deepEqual(r.takenLive, []); assert.deepEqual(calls, [sig("8")], "the late create is verified so the alert names a real create");
    assert.equal(reg.token(t.mint)!.status, "draft");
    assert.deepEqual(r.finished, [t.mint]); assert.deepEqual(r.late.map((x) => x.launchTx), [sig("8")]);
    assert.equal(reg.alertsSince(0).filter((a) => a.kind === "bt-launch-late").length, 1);
  });

  test("never without a TokenConfig, never a failed transaction, never a TokenConfig owned by another program", async () => {
    const reg = openRegistry(":memory:");
    const noCfg = draft(reg, "NOCFG", T0), lockOnly = draft(reg, "LOCKONLY", T0);
    const verifyCalls: string[] = [];
    const { reader, calls } = chain(new Set([lockOnly.mint]), new Map([[noCfg.mint, [{ signature: sig("7"), err: null, blockTime: secs(T0 + 60_000) }]], [lockOnly.mint, [{ signature: sig("6"), err: null, blockTime: secs(T0 + 60_000) }, { signature: sig("2"), err: "failed", blockTime: secs(T0 + 30_000) }]]]));
    const r = await run(reg, reader, tableVerifier(new Map([[sig("7"), { mint: noCfg.mint, blockTimeMs: T0 + 60_000 }]]), verifyCalls), T0 + 3_600_000);
    assert.deepEqual(r.takenLive, []);
    assert.deepEqual(verifyCalls, [sig("6")], "only the lock-only coin's successful in-window transaction is offered");
    assert.equal(calls.sigs, 1); assert.deepEqual(r.onChainNoCreate, [lockOnly.mint]);
    const spoof = openRegistry(":memory:"); const s2 = draft(spoof, "SPOOF", T0);
    const c2 = chain(new Set([s2.mint]), new Map([[s2.mint, [{ signature: sig("5"), err: null, blockTime: secs(T0 + 60_000) }]]]), Keypair.generate().publicKey.toBase58());
    assert.deepEqual((await run(spoof, c2.reader, tableVerifier(new Map([[sig("5"), { mint: s2.mint, blockTimeMs: T0 + 60_000 }]])), T0 + 3_600_000)).takenLive, []);
    assert.equal(c2.calls.sigs, 0);
  });

  test("review (2): a lock-only draft backs off (5 min doubling), resumes with `until`, and is finished once its window has closed; it expires like any draft", async () => {
    const reg = openRegistry(":memory:");
    const t = draft(reg, "BACKOFF", T0);
    const hist = new Map([[t.mint, [{ signature: sig("6"), err: null, blockTime: secs(T0 + 60_000) }]]]);
    const { reader, calls } = chain(new Set([t.mint]), hist);
    const v = tableVerifier(new Map());
    let now = T0 + 3_600_000;
    await run(reg, reader, v, now); assert.equal(calls.sigs, 1);
    const st = JSON.parse(reg.getStatus(SCAN_STATUS_PREFIX + t.mint)!);
    assert.equal(st.nextAt, now + BACKOFF_MIN_MS); assert.equal(st.until, sig("6"));
    now += RECONCILE_INTERVAL_MS + 1; await run(reg, reader, v, now);
    assert.equal(calls.sigs, 2, "after the backoff it is read again");
    assert.equal(calls.opts[1].until, sig("6"), "only signatures newer than the last finished scan");
    assert.equal(JSON.parse(reg.getStatus(SCAN_STATUS_PREFIX + t.mint)!).backoffMs, 2 * BACKOFF_MIN_MS);
    now += RECONCILE_INTERVAL_MS + 1; await run(reg, reader, v, now);
    assert.equal(calls.sigs, 2, "inside the doubled backoff: no read");
    assert.equal(reg.expireDrafts(T0 + DRAFT_TTL_MS + 1), 1, "a TokenConfig no longer exempts a draft from expiry");
    now = T0 + DRAFT_TTL_MS + DRAFT_GRACE_MS + 3_600_000;
    const r = await run(reg, reader, v, now);
    assert.deepEqual(r.finished, [t.mint]);
    const before = { m: calls.multiple, s: calls.sigs };
    await run(reg, reader, v, now + RECONCILE_INTERVAL_MS + 1);
    assert.deepEqual({ m: calls.multiple, s: calls.sigs }, before, "a finished draft is never read again");
  });

  test("review (2, 4), F-2: a create with many later transactions is found by content, oldest first, in the first sweep", async () => {
    const reg = openRegistry(":memory:");
    const t = draft(reg, "BUSY", T0);
    // newest first: 25 successful in-window transactions after the create, then the create, then the lock
    const rows: Sig[] = Array.from({ length: 25 }, (_, k) => ({ signature: "ABCDEFGHJKLMNPQRSTUVWXYZa"[k].repeat(88), err: null, blockTime: secs(T0 + 3_600_000 + (25 - k) * 1000) }));
    rows.push({ signature: sig("8"), err: null, blockTime: secs(T0 + 120_000) }, { signature: sig("7"), err: null, blockTime: secs(T0 + 60_000) });
    const { reader } = chain(new Set([t.mint]), new Map([[t.mint, rows]]));
    const calls: string[] = [];
    const v = tableVerifier(new Map([[sig("8"), { mint: t.mint, blockTimeMs: T0 + 120_000 }]]), calls);
    const r = await run(reg, reader, v, T0 + 2 * 3_600_000);
    assert.deepEqual(r.takenLive.map((x) => x.launchTx), [sig("8")]);
    assert.deepEqual(calls, [sig("7"), sig("8")], "the lock, then the create: nothing newer is offered");
    assert.equal(reg.token(t.mint)!.status, "live");
  });

  test("review (2, 4): verifications are capped per sweep and the queue resumes where it stopped (no transaction verified twice)", async () => {
    const reg = openRegistry(":memory:");
    const t = draft(reg, "PADDED", T0);
    // newest first: the create, then 25 junk transactions sent to the fee PDA BEFORE it (worst case for oldest first)
    const rows: Sig[] = [{ signature: sig("8"), err: null, blockTime: secs(T0 + 3_600_000) }, ...Array.from({ length: 25 }, (_, k) => ({ signature: "ABCDEFGHJKLMNPQRSTUVWXYZa"[k].repeat(88), err: null, blockTime: secs(T0 + 60_000 + (25 - k) * 1000) }))];
    const { reader } = chain(new Set([t.mint]), new Map([[t.mint, rows]]));
    const calls: string[] = [];
    const v = tableVerifier(new Map([[sig("8"), { mint: t.mint, blockTimeMs: T0 + 3_600_000 }]]), calls);
    let now = T0 + 2 * 3_600_000, r = await run(reg, reader, v, now);
    assert.equal(r.verified, VERIFY_PER_SWEEP); assert.deepEqual(r.takenLive, []);
    for (let k = 0; k < 3 && !r.takenLive.length; k++) { now += RECONCILE_INTERVAL_MS + 1; r = await run(reg, reader, v, now); assert.ok(r.verified <= VERIFY_PER_SWEEP); }
    assert.deepEqual(r.takenLive.map((x) => x.launchTx), [sig("8")]);
    assert.equal(new Set(calls).size, calls.length, "no transaction is verified twice");
    assert.equal(reg.token(t.mint)!.status, "live");
  });

  test("today's registry shape (12 drafts + 5 expired, none on chain): one getMultipleAccounts per sweep; finished after their windows close; nothing inside the interval", async () => {
    const reg = openRegistry(":memory:");
    for (let i = 0; i < 17; i++) draft(reg, `D${i}`, T0 + i * 1000);
    reg.expireDrafts(T0 + DRAFT_TTL_MS + 4_001);
    assert.equal(reg.tokens("expired").length, 5); assert.equal(reg.tokens("draft").length, 12);
    const { reader, calls } = chain(new Set(), new Map());
    const now = T0 + 3_600_000;
    const r = await run(reg, reader, tableVerifier(new Map()), now);
    assert.equal(r.checked, 17); assert.equal(calls.multiple, 1); assert.equal(calls.keys, 17); assert.equal(calls.sigs, 0);
    assert.equal((await run(reg, reader, tableVerifier(new Map()), now + 60_000)).skipped, true); assert.equal(calls.multiple, 1);
    const late = T0 + DRAFT_TTL_MS + DRAFT_GRACE_MS + 3_600_000;
    assert.equal((await run(reg, reader, tableVerifier(new Map()), late)).finished.length, 17);
    const after = await run(reg, reader, tableVerifier(new Map()), late + RECONCILE_INTERVAL_MS + 1);
    assert.equal(after.checked, 0); assert.equal(calls.multiple, 2, "finished drafts cost nothing");
  });

  test("review (5): when the browser's confirm wins the race, the reconciler takes nothing and raises no alert", async () => {
    const reg = openRegistry(":memory:");
    const t = draft(reg, "RACE", T0);
    const { reader } = chain(new Set([t.mint]), new Map([[t.mint, [{ signature: sig("8"), err: null, blockTime: secs(T0 + 60_000) }]]]));
    const v: LaunchVerifier = { async verify() { reg.markLaunched(t.mint, sig("8"), null, new Date(T0 + 60_000).toISOString()); return { ok: true, blockTimeMs: T0 + 60_000 }; } };
    const r = await run(reg, reader, v, T0 + 3_600_000);
    assert.deepEqual(r.takenLive, []);
    assert.ok(!reg.alertsSince(0).some((a) => a.kind === "draft-reconciled"));
  });

  test("review (1): while launches are closed, a create after the recorded closure is not taken live", async () => {
    const reg = openRegistry(":memory:");
    const t = draft(reg, "SHUT", T0);
    reg.setStatus("launches.closedAt", String(T0 + 30_000));
    const { reader } = chain(new Set([t.mint]), new Map([[t.mint, [{ signature: sig("8"), err: null, blockTime: secs(T0 + 60_000) }]]]));
    const v = tableVerifier(new Map([[sig("8"), { mint: t.mint, blockTimeMs: T0 + 60_000 }]]));
    const r = await run(reg, reader, v, T0 + 3_600_000);
    assert.deepEqual(r.takenLive, []); assert.equal(reg.token(t.mint)!.status, "draft");
    const st = JSON.parse(reg.getStatus(SCAN_STATUS_PREFIX + t.mint)!);
    assert.notEqual(st.done, true, "re-review (2): a closure backs off, it never finishes the draft"); assert.equal(st.nextAt, T0 + 3_600_000 + BACKOFF_MIN_MS);
    // launches reopen (the closure is cleared): the next sweep after the backoff takes it live
    reg.setStatus("launches.closedAt", "");
    assert.deepEqual((await run(reg, reader, v, T0 + 3_600_000 + BACKOFF_MIN_MS + 1)).takenLive.map((x) => x.mint), [t.mint]);
    // the keeper's own environment is read explicitly
    const reg2 = openRegistry(":memory:"); const u = draft(reg2, "SHUT2", T0);
    const c2 = chain(new Set([u.mint]), new Map([[u.mint, [{ signature: sig("8"), err: null, blockTime: secs(T0 + 60_000) }]]]));
    const r2 = await run(reg2, c2.reader, tableVerifier(new Map([[sig("8"), { mint: u.mint, blockTimeMs: T0 + 60_000 }]])), T0 + 3_600_000, { env: { [CREATOR_LAUNCHES_CLOSED_AT_FLAG]: new Date(T0 + 30_000).toISOString() } });
    assert.deepEqual(r2.takenLive, []);
  });

  test("a dry run reads and reports but writes nothing", async () => {
    const reg = openRegistry(":memory:");
    const t = draft(reg, "DRY", T0);
    const { reader } = chain(new Set([t.mint]), new Map([[t.mint, [{ signature: sig("8"), err: null, blockTime: secs(T0 + 60_000) }]]]));
    const r = await run(reg, reader, tableVerifier(new Map([[sig("8"), { mint: t.mint, blockTimeMs: T0 + 60_000 }]])), T0 + 3_600_000, { dryRun: true });
    assert.deepEqual(r.takenLive.map((x) => x.mint), [t.mint]);
    assert.equal(reg.token(t.mint)!.status, "draft"); assert.equal(reg.getStatus(SCAN_STATUS_PREFIX + t.mint), null);
  });
});

describe("C1 (5) · each coin of a pair is confirmed the moment its own create lands", () => {
  const bundle = (ticker: string): LaunchlabBundleLike => ({ mint: Keypair.generate().publicKey.toBase58(), ticker, ready: true, pending: [], mintSecretKey: null, transactions: [{ label: "lock", signers: ["creator", "mint"], instructions: [] }, { label: "create", signers: ["creator", "mint"], instructions: [] }] });
  test("a LaunchLab pair with A created and B failed confirms A; the pair curve (both or neither) still confirms nothing early", () => {
    const plan = launchlabPlan([bundle("AAA"), bundle("BBB")]);
    assert.deepEqual(planConfirmations(plan, ["s0", "s1"]).map((c) => c.mint), [plan.confirms[0].mint]);
    assert.deepEqual(planConfirmations(plan, ["s0", "s1", "s2", "s3"]).length, 2);
    const pc = pairCurvePlan({ transactions: [{ label: "a", signers: ["creator", "mintA"], instructions: [] }, { label: "b", signers: ["creator", "mintB"], instructions: [] }, { label: "init_pair", signers: ["creator"], instructions: [] }], mints: { a: "MA", b: "MB" }, ready: true, pending: [] } as never, null);
    assert.deepEqual(planConfirmations(pc, ["s0"]), [], "side A alone is not confirmed on the pair curve");
    assert.equal(planConfirmations(pc, ["s0", "s1"]).length, 2);
  });
  test("after a reload, a stored pair record with A confirmed and B abandoned records A", async () => {
    const storage = memoryPlanStorage();
    const A = Keypair.generate().publicKey.toBase58(), B = Keypair.generate().publicKey.toBase58();
    storage.set(`${PLAN_STORAGE_PREFIX}x`, JSON.stringify({ v: 1, mints: [A, B], confirmed: ["l0", "c0"], recorded: [], pending: null, failed: { step: 3, signature: "f3" }, updatedAt: 1, confirms: [{ mint: A, ticker: "AAA", step: 1 }, { mint: B, ticker: "BBB", step: 3 }], steps: 4, paid: [] }));
    const [s] = listStoredLaunches(storage);
    assert.ok(s, "the record is listed");
    const posted: string[] = [];
    const r = await recoverStoredLaunch(storage, s, {} as never, async (_u, init) => { posted.push(JSON.parse(init.body).mint); return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ ok: true }) }; }, () => "x");
    assert.deepEqual(posted, [A]);
    assert.deepEqual(r.rec.recorded, [A]);
    assert.equal(storedLaunchAction(s), "record", "the notice offers to record it, not to start over");
    assert.equal(storedLaunchAction({ ...s, rec: { ...s.rec, together: true } }), "start-new", "a pair-curve set still goes live together");
  });
  test("review (9): a record stored before `together` existed is read as together for a pair-curve shape, not for a LaunchLab pair", () => {
    assert.equal(legacyTogether([{ step: 0 }, { step: 1 }], 3), true, "pair curve: the last step (init_pair) confirms no coin");
    assert.equal(legacyTogether([{ step: 1 }, { step: 3 }], 4), false, "LaunchLab pair: the last step is B's create");
    assert.equal(legacyTogether([{ step: 1 }, { step: 3 }], 5), false, "re-review (5): a LaunchLab pair with an opening buy last is not the pair curve");
    const st2 = memoryPlanStorage();
    st2.set(`${PLAN_STORAGE_PREFIX}v`, JSON.stringify({ v: 1, mints: ["MA", "MB"], confirmed: ["s0"], recorded: [], pending: null, failed: null, updatedAt: 1, confirms: [{ mint: "MA", ticker: "A", step: 0 }, { mint: "MB", ticker: "B", step: 1 }], steps: 3, paid: [], venue: "launchlab" }));
    assert.equal(listStoredLaunches(st2)[0].rec.together, false, "a stored venue decides over the shape");
    assert.equal(legacyTogether([{ step: 0 }], 2), false, "a single coin");
    const storage = memoryPlanStorage();
    storage.set(`${PLAN_STORAGE_PREFIX}old`, JSON.stringify({ v: 1, mints: ["MA", "MB"], confirmed: ["s0"], recorded: [], pending: null, failed: { step: 1, signature: "f1" }, updatedAt: 1, confirms: [{ mint: "MA", ticker: "A", step: 0 }, { mint: "MB", ticker: "B", step: 1 }], steps: 3, paid: [] }));
    const [old] = listStoredLaunches(storage);
    assert.equal(old.rec.together, true); assert.equal(storedLaunchAction(old), "start-new");
  });
  test("the sign card records the coins whose create landed even when a later step stops the run, and says both errors", () => {
    const card = fs.readFileSync(path.join(ROOT, "src/app/burnticker/launch/SignCard.tsx"), "utf8");
    const stop = card.indexOf("if (r.error) {");
    assert.ok(stop > 0);
    const branch = card.slice(stop, card.indexOf("return; }", stop));
    assert.match(branch, /confirmPlan\(/, "the error branch confirms what landed before it stops");
    assert.match(branch, /setErr\(`\$\{failureSentence\(r, n\)\} \$\{c\.error\}`\)/, "a failed record is said beside why the run stopped");
  });
});

describe("C1 (6, 7) · confirms of launches already signed: accepted while launches are closed, outside the write bucket", () => {
  let was: string | undefined, wasAt: string | undefined;
  beforeEach(() => { was = process.env[CREATOR_LAUNCHES_FLAG]; wasAt = process.env[CREATOR_LAUNCHES_CLOSED_AT_FLAG]; });
  afterEach(() => {
    if (was === undefined) delete process.env[CREATOR_LAUNCHES_FLAG]; else process.env[CREATOR_LAUNCHES_FLAG] = was;
    if (wasAt === undefined) delete process.env[CREATOR_LAUNCHES_CLOSED_AT_FLAG]; else process.env[CREATOR_LAUNCHES_CLOSED_AT_FLAG] = wasAt;
    limiter.reset();
  });
  const legacy = async (body: unknown, ip: string) => {
    const { POST } = await import("../src/app/api/burnticker/launch/route.ts");
    return POST(new Request("http://bt.test/api/burnticker/launch", { method: "POST", headers: { host: "bt.test", origin: "http://bt.test", "x-forwarded-proto": "https", "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify(body) }));
  };
  test("closed host: building is refused, confirming a signed launch is taken (page route and /v1)", async () => {
    const w = await makeWorld();
    const a = draft(w.registry, "SIGNEDA", Date.now()), b = draft(w.registry, "SIGNEDB", Date.now());
    delete process.env[CREATOR_LAUNCHES_FLAG];
    process.env[CREATOR_LAUNCHES_CLOSED_AT_FLAG] = new Date(Date.now() + 3_600_000).toISOString();   // these creates landed before the closure
    assert.equal((await legacy({ ticker: "X" }, "198.51.100.60")).status, 403, "building is still closed");
    const r1 = await legacy({ action: "launched", mint: a.mint, launchTx: sig("5") }, "198.51.100.60");
    assert.equal(r1.status, 200, JSON.stringify(await r1.clone().json()));
    const r2 = await callRoute(`${API}/launch/confirm`, { method: "POST", headers: { ...POST_HEADERS, "x-forwarded-for": "198.51.100.61" }, body: JSON.stringify({ mint: b.mint, signature: sig("6") }) });
    assert.equal(r2.status, 200, JSON.stringify(await r2.clone().json()));
    assert.equal(w.registry.token(a.mint)!.status, "live"); assert.equal(w.registry.token(b.mint)!.status, "live");
  });
  test("a client that spent its write bucket on bundles can still confirm (page route and /v1)", async () => {
    const w = await makeWorld(); limiter.reset();
    const ip = "198.51.100.62";
    for (let i = 0; i < RATE_LIMITS.write.burst; i++) await callRoute(`${API}/launch/bundle`, { method: "POST", headers: { ...POST_HEADERS, "x-forwarded-for": ip }, body: "{}" });
    assert.equal((await callRoute(`${API}/launch/bundle`, { method: "POST", headers: { ...POST_HEADERS, "x-forwarded-for": ip }, body: "{}" })).status, 429, "the write bucket is spent");
    const a = draft(w.registry, "BUCKA", Date.now()), b = draft(w.registry, "BUCKB", Date.now());
    const r1 = await callRoute(`${API}/launch/confirm`, { method: "POST", headers: { ...POST_HEADERS, "x-forwarded-for": ip }, body: JSON.stringify({ mint: a.mint, signature: sig("7") }) });
    assert.equal(r1.status, 200, JSON.stringify(await r1.clone().json()));
    const r2 = await legacy({ action: "launched", mint: b.mint, launchTx: sig("8") }, ip);
    assert.equal(r2.status, 200, JSON.stringify(await r2.clone().json()));
  });
  test("review (8): confirmations are rate limited on their own confirm bucket (429 with Retry-After), shared by both routes", async () => {
    await makeWorld(); limiter.reset();
    const ip = "198.51.100.63";
    let last: Response | null = null;
    assert.deepEqual([RATE_LIMITS.confirm.burst, RATE_LIMITS.confirm.refillPerSec * 60], [30, 30]);
    for (let i = 0; i <= RATE_LIMITS.confirm.burst; i++) last = await callRoute(`${API}/launch/confirm`, { method: "POST", headers: { ...POST_HEADERS, "x-forwarded-for": ip }, body: JSON.stringify({ mint: "x", signature: "y" }) });
    assert.equal(last!.status, 429); assert.ok(Number(last!.headers.get("retry-after")) > 0);
    assert.equal((await legacy({ action: "launched", mint: "x", launchTx: "y" }, ip)).status, 429, "the page route shares the confirm bucket");
    assert.equal((await legacy({ action: "launched", mint: "x", launchTx: "y" }, "198.51.100.64")).status, 404, "another client is not affected");
  });
});
