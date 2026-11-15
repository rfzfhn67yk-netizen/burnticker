// A COIN'S THREE DATES FROM THE CHAIN (indexer-1, 2026-10-12; PLATFORM-NEXT-2 item 4). A fake RPC replays real transactions captured
// read-only (config/burnticker/fixtures/lifecycle): the devnet LaunchLab lock-rehearsal coin of docs/burnkeeper/evidence/
// devnet-lock-2026-10-10 (create, Raydium's MigrateToCpswap, the burn program's RegisterPool), the mainnet $REHEARSAL create of
// docs/burnkeeper/evidence/mainnet-rehearsal-2026-10-11, and a graduated mainnet LaunchLab pool whose newest signatures start with
// failed buys after the migration. Every failure is "unavailable" with its reason; "none" only where the chain (or the caller's phase)
// shows the step has not happened.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { classifyTx, clearLifecycleCache, fetchTx, instructionsFromLogs, LIFECYCLE_CACHE_MS, LIFECYCLE_LIMITS, readLifecycleDates, txView, type LifecycleInput } from "@/lib/burnticker/lifecycleDates";
import type { Rpc } from "@/lib/burnticker/trustpack/receiptCheck";
import { fx } from "./burntickerHelpers.ts";

type Sig = { signature: string; err: unknown; slot: number; blockTime: number };
type Tx = { version: number | "legacy" | null; slot: number; blockTime: number; meta: { err: unknown; logMessages: string[] }; transaction: { signatures: string[]; message: { accountKeys: string[] } } };
const DEV = fx("lifecycle/lockcoin.devnet.json") as { mint: string; curvePool: string; launchTx: string; migrateTx: string; registerTx: string; getSignaturesForAddress: Sig[]; getTransaction: Record<string, Tx> };
const MAIN = fx("lifecycle/mainnet.json") as { graduated: { mint: string; curvePool: string; migrateTx: string; getSignaturesForAddress: Sig[] }; rehearsal: { mint: string; curvePool: string; launchTx: string }; getTransaction: Record<string, Tx> };
const NOW = Date.parse("2026-10-12T19:00:00Z");
const [DEV_CREATE, DEV_MIGRATE, DEV_REGISTER] = [DEV.launchTx, DEV.migrateTx, DEV.registerTx];
const MAIN_MIGRATE = MAIN.graduated.migrateTx;

/** Serves signatures (paged by `before`/`limit`) and transactions; a transaction newer than the asked-for version answers like the real RPC. */
function fakeRpc(sigs: Sig[], txs: Record<string, Tx>, over: Partial<Record<string, (p: unknown[]) => unknown>> = {}): Rpc & { log: string[] } {
  const log: string[] = [];
  return {
    log,
    async call<T>(method: string, params: unknown[]): Promise<T> {
      log.push(method);
      const fn = over[method];
      if (fn) return fn(params) as T;
      if (method === "getSignaturesForAddress") {
        const o = params[1] as { limit: number; before?: string };
        const from = o.before ? sigs.findIndex((s) => s.signature === o.before) + 1 : 0;
        return sigs.slice(from, from + o.limit) as T;
      }
      if (method === "getTransaction") {
        const t = txs[params[0] as string];
        if (!t) return null as T;
        const want = (params[1] as { maxSupportedTransactionVersion: number }).maxSupportedTransactionVersion;
        if (typeof t.version === "number" && t.version > want) throw new Error(`getTransaction: Transaction version (${t.version}) is not supported by the requesting client. Please try the request again with the following configuration parameter: "maxSupportedTransactionVersion": ${t.version}`);
        return t as T;
      }
      throw new Error(`unexpected ${method}`);
    },
  };
}
const devInput = (o: Partial<LifecycleInput> = {}): LifecycleInput => ({ network: "devnet", mint: DEV.mint, launchTx: DEV.launchTx, curvePool: DEV.curvePool, ...o });
const iso = (t: number) => new Date(t * 1000).toISOString();

describe("reading the dates", () => {
  test("devnet lock-rehearsal coin: create, graduation and registration, each with its signature, slot and block time", async () => {
    clearLifecycleCache();
    const rpc = fakeRpc(DEV.getSignaturesForAddress, DEV.getTransaction);
    const d = await readLifecycleDates(rpc, devInput(), NOW);
    assert.deepEqual(d.created, { state: "read", at: iso(1791691273), blockTime: 1791691273, slot: 509774647, signature: DEV_CREATE });
    assert.deepEqual(d.graduated, { state: "read", at: iso(1791691301), blockTime: 1791691301, slot: 509774767, signature: DEV_MIGRATE });
    assert.deepEqual(d.registered, { state: "read", at: iso(1791691336), blockTime: 1791691336, slot: 509774915, signature: DEV_REGISTER });
    assert.equal(d.created.state === "read" && d.created.at, "2026-10-11T04:01:13.000Z", "22:01 Denver on 10-10, as the evidence log says");
    assert.deepEqual(rpc.log, ["getTransaction", "getSignaturesForAddress", "getTransaction", "getTransaction"], "the walk stops at the migration");
  });

  test("mainnet: the $REHEARSAL create; still on its curve, so the later dates are 'none' and no history is walked", async () => {
    clearLifecycleCache();
    const rpc = fakeRpc([], MAIN.getTransaction);
    const d = await readLifecycleDates(rpc, { network: "mainnet", mint: MAIN.rehearsal.mint, launchTx: MAIN.rehearsal.launchTx, curvePool: MAIN.rehearsal.curvePool, phase: "curve" }, NOW);
    assert.deepEqual(d.created, { state: "read", at: "2026-10-11T23:04:58.000Z", blockTime: 1791759898, slot: 455825866, signature: MAIN.rehearsal.launchTx });
    assert.equal(d.graduated.state, "none"); assert.equal(d.registered.state, "none");
    assert.deepEqual(rpc.log, ["getTransaction"]);
  });

  test("mainnet graduated pool: failed buys after the migration are skipped unfetched; no RegisterPool since → 'none'", async () => {
    clearLifecycleCache();
    const g = MAIN.graduated;
    const rpc = fakeRpc(g.getSignaturesForAddress, MAIN.getTransaction);
    const d = await readLifecycleDates(rpc, { network: "mainnet", mint: g.mint, launchTx: null, curvePool: g.curvePool }, NOW);
    assert.deepEqual(d.graduated, { state: "read", at: iso(1791642704), blockTime: 1791642704, slot: 455289552, signature: MAIN_MIGRATE });
    assert.deepEqual(d.registered, { state: "none", reason: "The chain shows no pool registration for this coin since it graduated." });
    assert.deepEqual(d.created, { state: "unavailable", reason: "The registry has no create transaction for this coin." });
    assert.equal(g.getSignaturesForAddress.findIndex((s) => s.signature === MAIN_MIGRATE), 3, "three failed transactions sit above it");
    assert.deepEqual(rpc.log, ["getSignaturesForAddress", "getTransaction"]);
    clearLifecycleCache();
    const told = await readLifecycleDates(fakeRpc(g.getSignaturesForAddress, MAIN.getTransaction), { network: "mainnet", mint: g.mint, launchTx: null, curvePool: g.curvePool, poolRegistered: true }, NOW);
    assert.equal(told.registered.state, "unavailable", "the program says registered but no transaction was found: not 'none'");
  });

  test("a newer transaction version: asks again with the version the RPC names", async () => {
    const v1 = { ...DEV.getTransaction[DEV_CREATE], version: 1 };
    const rpc = fakeRpc([], { [DEV_CREATE]: v1 });
    const t = await fetchTx(rpc, DEV_CREATE);
    assert.equal(t?.blockTime, 1791691273); assert.equal(rpc.log.length, 2);
  });
});

describe("what is unavailable, and why", () => {
  const read = (o: Partial<LifecycleInput>, over: Parameters<typeof fakeRpc>[2] = {}, sigs = DEV.getSignaturesForAddress, txs = DEV.getTransaction) => { clearLifecycleCache(); return readLifecycleDates(fakeRpc(sigs, txs, over), devInput(o), NOW); };
  const why = (d: { state: string; reason?: string }) => `${d.state}: ${"reason" in d ? d.reason : ""}`;
  test("the create transaction", async () => {
    assert.match(why((await read({ launchTx: null })).created), /^unavailable: The registry has no create transaction/);
    assert.match(why((await read({ launchTx: DEV_REGISTER })).created), /^unavailable: The registry's create transaction does not create this coin/);
    assert.match(why((await read({ launchTx: "1".repeat(88) })).created), /^unavailable: The RPC has no record/);
    assert.match(why((await read({}, { getTransaction: () => ({ slot: 1 }) })).created), /^unavailable: The create transaction could not be read/);
    const failed = { ...DEV.getTransaction[DEV_CREATE], meta: { ...DEV.getTransaction[DEV_CREATE].meta, err: { InstructionError: [1, { Custom: 1 }] } } };
    assert.match(why((await read({}, {}, DEV.getSignaturesForAddress, { ...DEV.getTransaction, [DEV_CREATE]: failed })).created), /failed on chain/);
    assert.match(why((await read({ mint: MAIN.graduated.mint })).created), /does not create this coin/);
    const noTime = { ...DEV.getTransaction[DEV_CREATE], blockTime: null };
    assert.match(why((await read({}, {}, DEV.getSignaturesForAddress, { ...DEV.getTransaction, [DEV_CREATE]: noTime as unknown as Tx })).created), /without a block time/);
  });
  test("the walk", async () => {
    let d = await read({}, { getSignaturesForAddress: () => { throw new Error("getSignaturesForAddress: the RPC answered HTTP 429"); } });
    assert.match(why(d.graduated), /could not be read \(rate-limited by the RPC\)/); assert.equal(d.registered.state, "unavailable");
    d = await read({}, { getSignaturesForAddress: () => ({ value: [] }) });
    assert.match(why(d.graduated), /not a list/);
    d = await read({ curvePool: null });
    assert.match(why(d.graduated), /no curve pool on record/);
    // a transaction the RPC cannot return between the newest and the migration: registration cannot be called "none"
    const sigs = [{ signature: "4".repeat(88), err: null, slot: 1, blockTime: 1 }, ...DEV.getSignaturesForAddress.filter((s) => s.signature !== DEV_REGISTER)];
    d = await read({}, {}, sigs);
    assert.equal(d.graduated.state, "read"); assert.match(why(d.registered), /^unavailable: One transaction on the curve pool could not be read/);
  });
  test("a short history with no migration: 'none' unless the caller read the phase as graduated", async () => {
    const preGrad = DEV.getSignaturesForAddress.filter((s) => s.signature !== DEV_MIGRATE && s.signature !== DEV_REGISTER);
    // the two curve buys were not captured; they stand in as copies of the create transaction (neither a migration nor a registration)
    const txs = { ...DEV.getTransaction, ...Object.fromEntries(preGrad.map((s) => [s.signature, DEV.getTransaction[DEV_CREATE]])) };
    assert.equal((await read({}, {}, preGrad)).registered.state, "unavailable", "uncaptured transactions are gaps, so not 'none'");
    let d = await read({}, {}, preGrad, txs);
    assert.equal(d.graduated.state, "none"); assert.equal(d.registered.state, "none");
    d = await read({ phase: "graduated" }, {}, preGrad, txs);
    assert.match(why(d.graduated), /^unavailable: The curve pool's history holds no migration/);
  });
  test("limits: a busy pool stops the search instead of guessing", async () => {
    const other = DEV.getTransaction[DEV_CREATE];
    const many = Array.from({ length: LIFECYCLE_LIMITS.maxTransactions + 5 }, (_, k) => ({ signature: `${k}`.padStart(88, "5"), err: null, slot: 1, blockTime: 1 }));
    const d = await read({}, {}, many, Object.fromEntries(many.map((s) => [s.signature, other])));
    assert.match(why(d.graduated), /stops searching/); assert.equal(d.registered.state, "unavailable");
    const failedOnly = Array.from({ length: LIFECYCLE_LIMITS.maxSignatures + 50 }, (_, k) => ({ signature: `${k}`.padStart(88, "6"), err: { x: 1 }, slot: 1, blockTime: 1 }));
    const f = await read({}, {}, failedOnly);
    assert.match(why(f.graduated), /stops searching/);
  });
});

describe("cache", () => {
  test("a fully read set is kept a day; a failed read one minute", async () => {
    clearLifecycleCache();
    const rpc = fakeRpc(DEV.getSignaturesForAddress, DEV.getTransaction);
    await readLifecycleDates(rpc, devInput(), NOW);
    await readLifecycleDates(rpc, devInput(), NOW + LIFECYCLE_CACHE_MS.complete - 1);
    assert.equal(rpc.log.length, 4);
    clearLifecycleCache();
    const bad = fakeRpc([], {});
    await readLifecycleDates(bad, devInput(), NOW);
    const n = bad.log.length;
    await readLifecycleDates(bad, devInput(), NOW + LIFECYCLE_CACHE_MS.failed + 1);
    assert.equal(bad.log.length, 2 * n);
  });
});

describe("the log reader", () => {
  test("instructions are credited to the program running at that depth (CPI included)", () => {
    const t = MAIN.getTransaction[MAIN_MIGRATE];
    const ix = instructionsFromLogs(t.meta.logMessages);
    assert.deepEqual(ix.find((x) => x.name === "MigrateToCpswap"), { program: "LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj", name: "MigrateToCpswap", depth: 1 });
    assert.equal(ix.find((x) => x.name === "InitializeWithPermission")?.program, "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C");
    const fake = ["Program 11111111111111111111111111111111 invoke [1]", "Program log: Instruction: RegisterPool", "Program 11111111111111111111111111111111 success"];
    const v = txView({ slot: 1, blockTime: 1, meta: { err: null, logMessages: fake }, transaction: { message: { accountKeys: [DEV.mint] } } })!;
    assert.equal(classifyTx(v, { mint: DEV.mint, curvePool: DEV.curvePool, launchLab: "DRay6fNdQ5J82H7xV6uq2aV3mNrUZ1J4PgSKsWgptcm6", burnProgram: "AuQjoSgq7upmyPBv2itwy2TSZ1VjoVipyy4z9wd7zhMM" }), "other", "a log line from another program is not the burn program's RegisterPool");
  });
});

describe("plain copy", () => {
  test("every reason sentence in the holders and lifecycle modules passes the copy lint", async () => {
    const { lintCopy, loadCopyLintConfig } = await import("@/lib/launch/copyLint");
    const fs = await import("node:fs");
    const cfg = loadCopyLintConfig();
    const sentences = ["src/lib/burnticker/lifecycleDates.ts", "src/lib/burnticker/holders.ts"].flatMap((f) => [...fs.readFileSync(f, "utf8").matchAll(/["`]((?:The|This|A |One|No )[^"`]*\.)["`]/g)].map((m) => m[1]));
    assert.ok(sentences.length >= 20, `found ${sentences.length}`);
    for (const t of sentences) { assert.ok(lintCopy(t, cfg).ok, t); assert.doesNotMatch(t, /—|->|→|\//, t); }
  });
});
