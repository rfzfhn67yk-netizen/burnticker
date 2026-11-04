// PRELAUNCH AUDIT 2026-10-18 A-11, on the launch's signing path.
//   A-11: a create that lands after the owner closes creator launches is refused everywhere and nobody was told. The signing card now
//   reads the launch gate before each new step (and again when the wallet returns it) and stops with a plain sentence; a create that
//   lands after the closure anyway raises ONE bt-launch-after-closure alert per coin, with the revive command, from the confirm route and
//   from the keeper's reconciler.
//   Also (review of block J): starting a new plan from an abandoned one keeps the record of a landed but unrecorded coin.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { Keypair, PublicKey, VersionedTransaction } from "@solana/web3.js";
import { bytesToBase58, confirmPlan, failureSentence, launchesClosedSentence, launchGateUnreadSentence, launchlabPlan, loadPlanRecord, memoryPlanStorage, signAndSendPlan, withPlanDeadline, type LaunchlabBundleLike } from "@/lib/burnticker/signPlan";
import { AFTER_CLOSURE_GRACE_MS, admitAfterClosure } from "@/lib/burnticker/launchGateAdmission";
import { ADMITTED_AFTER_CLOSURE_ALERT_KIND } from "@/lib/burnticker/draftReconciler";
import { LAUNCH_BODY_FIELDS } from "@/lib/burnticker/api/launchBody";
import { launchGateFromCatalogue, signGateOf } from "@/lib/burnticker/launchGateState";
import { openRegistry } from "@/lib/burnticker/registry";
import { lockRule } from "@/lib/burnticker/rules";
import { configPda, feePda } from "@/lib/burnReceipts/pda";
import { AFTER_CLOSURE_ALERT_KIND, RECONCILE_INTERVAL_MS, REVIVE_SCRIPT, SCAN_STATUS_PREFIX, reconcileDrafts } from "@/lib/burnticker/draftReconciler";
import { markLaunched, resetConfirmGuards } from "@/lib/burnticker/api/handlers";
import { PUSH_KIND_OF_ALERT, PUSH_LEAD, PUSH_TITLE } from "@/lib/burnticker/push";
import { lintCopy, loadCopyLintConfig, formatHits } from "@/lib/launch/copyLint";
import { BRONCOS } from "./burntickerHelpers.ts";

const cfg = loadCopyLintConfig();
const clean = (s: string) => { const r = lintCopy(s, cfg); assert.ok(r.ok, `${s}\n${formatHits(r)}`); assert.doesNotMatch(s, /→|\bbuy|\bprice\b|\bwill\b|coming soon|payout/i); };
const T0 = Date.parse("2026-10-18T12:00:00Z");
const BH = "GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi";
const creatorKp = Keypair.generate(), CREATOR = creatorKp.publicKey.toBase58();
// bytesToBase58 keeps leading zero bytes (a key whose first byte is 0 would otherwise lose it, about 1 run in 256)
const secret58 = (kp: Keypair) => bytesToBase58(kp.secretKey);
const ix = (signer: string, lamports = 1) => ({ programId: "11111111111111111111111111111111", label: "test", dataBase64: Buffer.from([2, 0, 0, 0, lamports, 0, 0, 0, 0, 0, 0, 0]).toString("base64"), keys: [{ pubkey: CREATOR, isSigner: true, isWritable: true }, { pubkey: signer, isSigner: true, isWritable: true }] });
const bundle = (ticker: string): LaunchlabBundleLike => {
  const mint = Keypair.generate();
  return { mint: mint.publicKey.toBase58(), ticker, ready: true, pending: [], mintSecretKey: secret58(mint), transactions: [{ label: "lock the rule", signers: ["creator", "mint"], instructions: [ix(mint.publicKey.toBase58())] }, { label: "create", signers: ["creator", "mint"], instructions: [ix(mint.publicKey.toBase58(), 2)] }] };
};
function deps(gate: () => "open" | "closed" | "unknown") {
  const log: string[] = [], sent: string[] = [];
  return {
    log, sent, now: () => T0,
    launchGate: async () => { const g = gate(); log.push(`gate ${g}`); return g; },
    latestBlockhash: async () => ({ blockhash: BH, lastValidBlockHeight: 100 }),
    simulate: async () => null,
    signTransaction: async (tx: VersionedTransaction) => { log.push("wallet asked"); tx.sign([creatorKp]); return tx; },
    lookupTable: async () => null,
    sendRaw: async (raw: Uint8Array) => { const s = bytesToBase58(VersionedTransaction.deserialize(raw).signatures[0]); sent.push(s); log.push(`send ${sent.length}`); return s; },
    confirm: async () => ({ err: null }),
    getBlockHeight: async () => 50,
    getSignatureStatus: async () => null,
    storage: memoryPlanStorage(),
  };
}

describe("A-11: the sign card checks the launch gate before each step", () => {
  test("launches closed after the lock: the create is never built or sent, and the sentence says why", async () => {
    let closed = false;
    const d = deps(() => (closed ? "closed" : "open"));
    const plan = withPlanDeadline(launchlabPlan([bundle("GATE")]), T0);
    const r = await signAndSendPlan(plan, CREATOR, { ...d, confirm: async () => { closed = true; return { err: null }; } });
    assert.equal(r.signatures.length, 1, "the lock was sent and confirmed");
    assert.equal(r.failedAt, 1); assert.equal(r.state, "not-sent"); assert.equal(r.closed, true);
    assert.equal(d.log.filter((x) => x === "wallet asked").length, 1, "the wallet is never asked for the create");
    assert.equal(r.error, launchesClosedSentence(1, 2));
    const s = failureSentence(r, 2);
    assert.doesNotMatch(s, /Pressing the button again continues/);
    clean(s);
  });
  test("launches closed while the wallet held the step: nothing is sent", async () => {
    let asked = false;
    const d = deps(() => (asked ? "closed" : "open"));
    const plan = withPlanDeadline(launchlabPlan([bundle("HELD")]), T0);
    const r = await signAndSendPlan(plan, CREATOR, { ...d, signTransaction: async (tx: VersionedTransaction) => { asked = true; tx.sign([creatorKp]); return tx; } });
    assert.equal(r.signatures.length, 0); assert.equal(d.sent.length, 0); assert.equal(r.closed, true);
  });
  test("continuous audit SEC-03: a gate that cannot be read STOPS the step (it used to go on); the catalogue maps to the gate", async () => {
    const d = deps(() => "unknown");
    const r = await signAndSendPlan(withPlanDeadline(launchlabPlan([bundle("UNKN")]), T0), CREATOR, d);
    assert.equal(r.signatures.length, 0); assert.equal(d.sent.length, 0); assert.equal(r.gateUnread, true);
    assert.equal(d.log.filter((x) => x === "wallet asked").length, 0, "the wallet is never asked");
    assert.equal(r.error, launchGateUnreadSentence(0, 2));
    clean(failureSentence(r, 2));
    assert.equal(signGateOf(launchGateFromCatalogue({ launches: { creators: true } })), "open");
    assert.equal(signGateOf(launchGateFromCatalogue({ launches: { creators: false } })), "closed");
    assert.equal(signGateOf(launchGateFromCatalogue({ launches: { creators: false, mode: "preview" } })), "closed");
    assert.equal(signGateOf(launchGateFromCatalogue(null, "fetch failed")), "unknown");
    assert.match(fs.readFileSync("src/app/burnticker/launch/SignCard.tsx", "utf8"), /launchGate: \(\) => fetch\("\/api\/burnticker\/catalogue", \{ cache: "no-store" \}\)/);
  });
});

describe("A-11: a create after the closure is told to the owner once, with the revive command", () => {
  const PROGRAM = Keypair.generate().publicKey.toBase58();
  // deno-lint-ignore no-explicit-any
  type Any = any;
  const draft = (reg: Any) => reg.register({ mint: Keypair.generate().publicKey.toBase58(), ticker: "CLOSED", name: "Closed coin", creator: CREATOR, description: "", imageUrl: null, links: [], rulesText: lockRule(BRONCOS).text, feePda: "F", vault: null, tokenConfig: null, poolId: null, launchTx: null, cluster: "devnet", platformId: null, baselineAt: new Date(T0).toISOString(), status: "draft" }, T0);
  test("the keeper's reconciler: one alert in thirty sweeps, naming the mint and the command", async () => {
    const reg = openRegistry(":memory:");
    const t = draft(reg);
    const closedAt = T0 + 300_000, createAt = closedAt + 30_000;
    const fee = feePda(new PublicKey(PROGRAM), new PublicKey(t.mint)).toBase58();
    const create = { signature: `C${"Q".repeat(87)}`, blockTime: Math.floor(createAt / 1000), err: null };
    const reader = {
      async getMultipleAccountsInfo(keys: PublicKey[]) { return keys.map((k) => (configPda(new PublicKey(PROGRAM), new PublicKey(t.mint)).equals(k) ? { owner: new PublicKey(PROGRAM), data: new Uint8Array(8) } : null)); },
      async getSignaturesForAddress(a: PublicKey) { return a.toBase58() === fee ? [create] : []; },
    };
    const verifier = { async verify(s: string) { return s === create.signature ? { ok: true as const, blockTimeMs: createAt } : { ok: false as const, status: 422 as const, reason: "no" }; } };
    let now = closedAt + 3_600_000;
    for (let k = 0; k < 30; k++) { await reconcileDrafts({ registry: reg, reader: reader as Any, verifier: verifier as Any, burnProgramId: PROGRAM, now: () => now, log: () => {}, dryRun: false, env: { BURNTICKER_CREATOR_LAUNCHES_CLOSED_AT: new Date(closedAt).toISOString() } }); const st = JSON.parse(reg.getStatus(SCAN_STATUS_PREFIX + t.mint) ?? "{}"); now = Math.max(now + RECONCILE_INTERVAL_MS + 1, (st.nextAt ?? 0) + 1); }
    const mine = reg.alertsSince(0).filter((a) => a.kind === AFTER_CLOSURE_ALERT_KIND);
    assert.equal(mine.length, 1);
    assert.ok(mine[0].text.includes(t.mint) && mine[0].text.includes(create.signature) && mine[0].text.includes(REVIVE_SCRIPT));
    assert.equal(reg.token(t.mint)!.status, "draft", "still not taken live: that is the operator's call");
  });
  test("the confirm route: the 403 also records the alert, once", async () => {
    resetConfirmGuards();
    const reg = openRegistry(":memory:");
    const t = draft(reg);
    const sig = `D${"Q".repeat(87)}`;
    const verifier = { async seen() { return true; }, async verify() { return { ok: true as const, blockTimeMs: T0 + 120_000 }; } };
    const p = { registry: reg, launchVerifier: verifier } as Any;
    const keys = ["BURNTICKER_CREATOR_LAUNCHES_CLOSED_AT", "BURNTICKER_CREATOR_LAUNCHES_ENABLED"] as const;
    const prev = keys.map((k) => process.env[k]);
    process.env.BURNTICKER_CREATOR_LAUNCHES_CLOSED_AT = new Date(T0 + 60_000).toISOString();
    process.env.BURNTICKER_CREATOR_LAUNCHES_ENABLED = "0";
    try {
      for (let k = 0; k < 2; k++) { const r = await markLaunched(p, t.mint, sig, T0 + 200_000 + k * 400_000, `c${k}`); assert.equal(r.status, 403); assert.equal((r.body as { code: string }).code, "launch-after-closure"); }
    } finally { keys.forEach((k, i) => { if (prev[i] === undefined) delete process.env[k]; else process.env[k] = prev[i]; }); }
    assert.equal(reg.alertsSince(0).filter((a) => a.kind === AFTER_CLOSURE_ALERT_KIND).length, 1);
  });
  test("the push maps it, in plain words", () => {
    assert.equal(PUSH_KIND_OF_ALERT[AFTER_CLOSURE_ALERT_KIND], "launch-after-closure");
    clean(PUSH_TITLE["launch-after-closure"]); clean(PUSH_LEAD["launch-after-closure"]);
  });
});

describe("continuous audit 2026-10-19 SEC-03: every closure moment has one outcome", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- registry and platform stubs, as in the block above
  type Any = any;
  const draft = (reg: Any, ticker: string) => reg.register({ mint: Keypair.generate().publicKey.toBase58(), ticker, name: `${ticker} coin`, creator: CREATOR, description: "", imageUrl: null, links: [], rulesText: lockRule(BRONCOS).text, feePda: "F", vault: null, tokenConfig: null, poolId: null, launchTx: null, cluster: "devnet", platformId: null, baselineAt: new Date(T0).toISOString(), status: "draft" }, T0);
  const ENV = ["BURNTICKER_CREATOR_LAUNCHES_CLOSED_AT", "BURNTICKER_CREATOR_LAUNCHES_ENABLED"] as const;
  /** markLaunched with launches closed at `closedAt`, a create that landed at `blockAt`, and the confirm's gate record */
  async function confirmAt(o: { closedAt: number; blockAt: number; gate: unknown; ticker: string }) {
    resetConfirmGuards();
    const reg = openRegistry(":memory:"), t = draft(reg, o.ticker), sig = `${o.ticker[0]}${"R".repeat(87)}`;
    const p = { registry: reg, launchVerifier: { async seen() { return true; }, async verify() { return { ok: true as const, blockTimeMs: o.blockAt }; } } } as Any;
    const prev = ENV.map((k) => process.env[k]);
    process.env.BURNTICKER_CREATOR_LAUNCHES_CLOSED_AT = new Date(o.closedAt).toISOString(); process.env.BURNTICKER_CREATOR_LAUNCHES_ENABLED = "0";
    try { const r = await markLaunched(p, t.mint, sig, o.blockAt + 5_000, "c", o.gate); return { r, reg, t }; }
    finally { ENV.forEach((k, i) => { if (prev[i] === undefined) delete process.env[k]; else process.env[k] = prev[i]; }); }
  }
  const alerts = (reg: Any, kind: string) => reg.alertsSince(0).filter((a: { kind: string }) => a.kind === kind).length;

  test("closed before signing: the first check stops the plan, nothing is signed or sent, no gate is recorded", async () => {
    const d = deps(() => "closed");
    const plan = withPlanDeadline(launchlabPlan([bundle("BEFORE")]), T0);
    const r = await signAndSendPlan(plan, CREATOR, d);
    assert.equal(r.closed, true); assert.equal(d.sent.length, 0); assert.equal(d.log.filter((x) => x === "wallet asked").length, 0);
    assert.equal(r.gate, undefined); assert.equal(loadPlanRecord(d.storage, plan)?.gate, undefined);
  });
  test("closed while the wallet is open: the check after the wallet stops it, nothing is sent", async () => {
    let asked = false;
    const d = deps(() => (asked ? "closed" : "open"));
    const r = await signAndSendPlan(withPlanDeadline(launchlabPlan([bundle("WALLET")]), T0), CREATOR, { ...d, signTransaction: async (tx: VersionedTransaction) => { asked = true; tx.sign([creatorKp]); return tx; } });
    assert.equal(r.closed, true); assert.equal(d.sent.length, 0);
  });
  test("closed between the final check and the broadcast: the plan record carries the open read, the confirm sends it, the server admits it and tells the operator once", async () => {
    const d = deps(() => "open");
    const plan = withPlanDeadline(launchlabPlan([bundle("RACE")]), T0);
    const r = await signAndSendPlan(plan, CREATOR, { ...d, now: () => T0 + 30_000 });
    assert.equal(r.error, null); assert.deepEqual(r.gate, { state: "open", at: T0 + 30_000 });
    assert.deepEqual(loadPlanRecord(d.storage, plan)?.gate, { state: "open", at: T0 + 30_000 }, "written to the plan record before the send");
    // the confirm posts the gate with the mint and signature
    const bodies: Record<string, unknown>[] = [];
    await confirmPlan(async (_u, init) => { bodies.push(JSON.parse(init.body)); return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({}) }; }, plan, r.signatures, () => "x", { gate: r.gate });
    assert.deepEqual(bodies[0].gate, { state: "open", at: T0 + 30_000 });
    assert.ok(LAUNCH_BODY_FIELDS.includes("gate"), "the launch route keeps the field");
    // the server: closed at T0+60 s, the create landed at T0+90 s
    const { r: res, reg, t } = await confirmAt({ closedAt: T0 + 60_000, blockAt: T0 + 90_000, gate: bodies[0].gate, ticker: "RACE" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(reg.token(t.mint)!.status, "live");
    assert.equal(alerts(reg, ADMITTED_AFTER_CLOSURE_ALERT_KIND), 1); assert.equal(alerts(reg, AFTER_CLOSURE_ALERT_KIND), 0);
    assert.equal(PUSH_KIND_OF_ALERT[ADMITTED_AFTER_CLOSURE_ALERT_KIND], "launch-admitted-after-closure");
    clean(PUSH_TITLE["launch-admitted-after-closure"]); clean(PUSH_LEAD["launch-admitted-after-closure"]);
  });
  test("closed after the create landed, before the confirm: admitted on its block time, with or without a gate record, no alert", async () => {
    for (const gate of [null, { state: "open", at: T0 + 10_000 }]) {
      const { r, reg } = await confirmAt({ closedAt: T0 + 60_000, blockAt: T0 + 50_000, gate, ticker: gate ? "AFTERG" : "AFTERN" });
      assert.equal(r.status, 200);
      assert.equal(alerts(reg, ADMITTED_AFTER_CLOSURE_ALERT_KIND) + alerts(reg, AFTER_CLOSURE_ALERT_KIND), 0);
    }
  });
  test("a create after the closure with no gate record stays refused, with the existing operator alert", async () => {
    const { r, reg, t } = await confirmAt({ closedAt: T0 + 60_000, blockAt: T0 + 90_000, gate: null, ticker: "NOGATE" });
    assert.equal(r.status, 403); assert.equal((r.body as { code: string }).code, "launch-after-closure");
    assert.equal(alerts(reg, AFTER_CLOSURE_ALERT_KIND), 1); assert.equal(reg.token(t.mint)!.status, "draft");
  });
  test("the completion rule is bounded: a gate read after the closure, before the draft, a create past the grace, or a draft made after the closure is refused", () => {
    const base = { closedAt: T0 + 60_000, blockTimeMs: T0 + 90_000, draftCreatedAt: T0, gate: { state: "open", at: T0 + 30_000 } };
    assert.deepEqual(admitAfterClosure(base), { admit: true, reason: "open-gate-record" });
    assert.equal(admitAfterClosure({ ...base, gate: { state: "open", at: T0 + 60_000 + 3 * 60_000 } }).admit, false);
    assert.equal(admitAfterClosure({ ...base, gate: { state: "open", at: T0 - 10 * 60_000 } }).admit, false);
    assert.equal(admitAfterClosure({ ...base, blockTimeMs: T0 + 60_000 + AFTER_CLOSURE_GRACE_MS + 1 }).admit, false);
    assert.equal(admitAfterClosure({ ...base, draftCreatedAt: T0 + 70_000, gate: { state: "open", at: T0 + 70_000 } }).admit, false);
    assert.equal(admitAfterClosure({ ...base, gate: { state: "closed", at: T0 } }).admit, false);
    assert.equal(admitAfterClosure({ ...base, gate: "open" }).admit, false);
    assert.deepEqual(admitAfterClosure({ ...base, closedAt: null }), { admit: true, reason: "before-closure" });
  });
  test("a catalogue error, a 429 or a thrown read is an unreadable gate: the step halts and the wallet is never asked", async () => {
    const catalogueGate = (res: { ok: boolean; status: number; body?: unknown }) => () => Promise.resolve(res).then((x) => (x.ok ? x.body : Promise.reject(new Error(`HTTP ${x.status}`)))).then((j) => signGateOf(launchGateFromCatalogue(j)), () => "unknown" as const);
    for (const gate of [catalogueGate({ ok: false, status: 429 }), catalogueGate({ ok: false, status: 503 }), catalogueGate({ ok: true, status: 200, body: "not json" }), async (): Promise<"open"> => { throw new Error("network"); }]) {
      const d = deps(() => "open");
      const r = await signAndSendPlan(withPlanDeadline(launchlabPlan([bundle("RATE")]), T0), CREATOR, { ...d, launchGate: gate });
      assert.equal(r.gateUnread, true); assert.equal(d.sent.length, 0); assert.equal(d.log.filter((x) => x === "wallet asked").length, 0);
    }
  });
});

describe("review of block J: Start a new plan keeps a landed but unrecorded coin", () => {
  test("the abandoned-plan branch archives the record only when no coin is waiting to be recorded (planHasUnrecordedCoin)", async () => {
    const { planHasUnrecordedCoin } = await import("@/lib/burnticker/signPlan");
    const plan = launchlabPlan([bundle("KEEP")]);
    assert.equal(planHasUnrecordedCoin(plan, ["s1", "s2"], []), true, "the create is confirmed, the record is not");
    assert.equal(planHasUnrecordedCoin(plan, ["s1", "s2"], [plan.confirms[0].mint]), false);
    assert.match(fs.readFileSync("src/app/burnticker/launch/SignCard.tsx", "utf8"), /const startNewPlan = \(\) => \{ if \(!planHasUnrecordedCoin\(plan, done, confirmed\)\) archivePlanRecord\(/);
  });
});
