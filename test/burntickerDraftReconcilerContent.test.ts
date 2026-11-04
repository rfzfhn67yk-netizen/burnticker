// Prelaunch audit 2026-10-16 F-2 / F-3: the draft reconciler scanned the MINT's history newest first with 10 verifications a sweep, so a
// coin with 1,000 swaps after its create took ~8 h to go live and a quiet second draft waited behind it; a create after the window was
// finished with one log line and no alert. The create is now found by CONTENT: the reconciler reads the history of the coin's fee PDA
// (the burn pool, in every create the verifier accepts and in no swap), oldest first, with per-draft shares of the sweep budget.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey } from "@solana/web3.js";
import { openRegistry, DRAFT_GRACE_MS, DRAFT_TTL_MS, type Registry, type TokenRow } from "@/lib/burnticker/registry";
import { lockRule } from "@/lib/burnticker/rules";
import type { LaunchExpectation, LaunchVerifier } from "@/lib/burnticker/launchVerify";
import { configPda, feePda } from "@/lib/burnReceipts/pda";
import { reconcileDrafts, LATE_ALERT_KIND, REVIVE_SCRIPT, SCAN_STATUS_PREFIX, VERIFY_PER_SWEEP, type DraftChainReader } from "@/lib/burnticker/draftReconciler";
import { CREATOR } from "./burntickerApiHelpers.ts";
import { BRONCOS } from "./burntickerHelpers.ts";

const T0 = Date.parse("2026-10-14T12:00:00Z");
const PROGRAM = Keypair.generate().publicKey.toBase58();
const POOL = "Pool111111111111111111111111111111111111111";
const secs = (ms: number) => Math.floor(ms / 1000);
let n = 0;
/** distinct 88-character base58 signatures */
const mkSig = () => { n++; return (n.toString(36).replace(/0/g, "z").replace(/l/g, "m") + "S".repeat(88)).slice(0, 88); };
const draft = (reg: Registry, ticker: string, at: number): TokenRow => reg.register({ mint: Keypair.generate().publicKey.toBase58(), ticker, name: `${ticker} coin`, creator: CREATOR, description: "", imageUrl: null, links: [], rulesText: lockRule(BRONCOS).text, feePda: "F", vault: null, tokenConfig: null, poolId: POOL, launchTx: null, cluster: "devnet", platformId: "Plat111111111111111111111111111111111111111", baselineAt: new Date(at).toISOString(), status: "draft" }, at);

type Tx = { signature: string; blockTime: number; err: unknown; accounts: string[] };
/** A fake chain: transactions NEWEST FIRST with their account lists; getSignaturesForAddress filters by account like the RPC. */
function fakeChain(txs: Tx[], cfgMints: Set<string>) {
  const calls = { sigs: 0, byAddress: new Map<string, number>() };
  const reader: DraftChainReader = {
    async getMultipleAccountsInfo(keys: PublicKey[]) { return keys.map((k) => ([...cfgMints].some((m) => configPda(new PublicKey(PROGRAM), new PublicKey(m)).equals(k)) ? { owner: new PublicKey(PROGRAM), data: new Uint8Array(8) } : null)); },
    async getSignaturesForAddress(a: PublicKey, o: { limit: number; before?: string; until?: string }) {
      calls.sigs++; calls.byAddress.set(a.toBase58(), (calls.byAddress.get(a.toBase58()) ?? 0) + 1);
      let rows = txs.filter((t) => t.accounts.includes(a.toBase58()));
      if (o.before) rows = rows.slice(rows.findIndex((r) => r.signature === o.before) + 1);
      if (o.until) { const u = rows.findIndex((r) => r.signature === o.until); if (u >= 0) rows = rows.slice(0, u); }
      return rows.slice(0, o.limit).map((r) => ({ signature: r.signature, err: r.err, blockTime: r.blockTime }));
    },
  };
  return { reader, calls };
}
function tableVerifier(table: Map<string, { mint: string; blockTimeMs: number }>, calls: string[] = []): LaunchVerifier {
  return { async verify(s: string, e: LaunchExpectation) { calls.push(s); const x = table.get(s); return x && x.mint === e.mint ? { ok: true, blockTimeMs: x.blockTimeMs } : { ok: false, status: 422, reason: "not this coin's launch" }; } };
}
/** A coin's on-chain story: lock (TokenConfig + fee PDA), LaunchLab create (fee PDA as LaunchLab's creator, the pool), then swaps (pool + mint). */
function story(t: TokenRow, at: number, swaps: number) {
  const cfg = configPda(new PublicKey(PROGRAM), new PublicKey(t.mint)).toBase58(), fee = feePda(new PublicKey(PROGRAM), new PublicKey(t.mint)).toBase58();
  const lock: Tx = { signature: mkSig(), blockTime: secs(at), err: null, accounts: [CREATOR, t.mint, cfg, fee] };
  const create: Tx = { signature: mkSig(), blockTime: secs(at + 2_000), err: null, accounts: [CREATOR, fee, t.mint, POOL] };
  const swapTxs: Tx[] = Array.from({ length: swaps }, (_, k) => ({ signature: mkSig(), blockTime: secs(at + 60_000 + k * 1_000), err: null, accounts: [Keypair.generate().publicKey.toBase58(), t.mint, POOL] }));
  return { lock, create, swaps: swapTxs, fee, all: [...swapTxs.reverse(), create, lock] };
}
const run = (reg: Registry, reader: DraftChainReader, verifier: LaunchVerifier, now: number) => reconcileDrafts({ registry: reg, reader, verifier, burnProgramId: PROGRAM, now: () => now, log: () => {}, dryRun: false, env: {} });

describe("F-2 · the reconciler finds a create by content, oldest first, and one busy draft never starves another", () => {
  test("a draft with 1,000 swaps after its create goes live in the FIRST sweep, and a quiet second draft in the same sweep", async () => {
    const reg = openRegistry(":memory:");
    const busy = draft(reg, "BUSY", T0), quiet = draft(reg, "QUIET", T0 + 1_000);
    const b = story(busy, T0 + 60_000, 1_000), q = story(quiet, T0 + 120_000, 0);
    const txs = [...b.all, ...q.all].sort((x, y) => y.blockTime - x.blockTime);
    const { reader } = fakeChain(txs, new Set([busy.mint, quiet.mint]));
    const calls: string[] = [];
    const v = tableVerifier(new Map([[b.create.signature, { mint: busy.mint, blockTimeMs: b.create.blockTime * 1000 }], [q.create.signature, { mint: quiet.mint, blockTimeMs: q.create.blockTime * 1000 }]]), calls);
    const r = await run(reg, reader, v, T0 + 5 * 3_600_000);
    assert.deepEqual(r.takenLive.map((x) => x.ticker).sort(), ["BUSY", "QUIET"]);
    assert.equal(reg.token(busy.mint)!.launchTx, b.create.signature);
    assert.equal(reg.token(quiet.mint)!.launchTx, q.create.signature);
    assert.ok(r.verified <= VERIFY_PER_SWEEP);
    assert.ok(calls.length <= 4, `only the lock and create of each coin are offered (got ${calls.length})`);
  });

  test("hostile padding: 2,500 junk transfers to a coin's fee PDA after its create do not delay it, nor a second draft", async () => {
    const reg = openRegistry(":memory:");
    const padded = draft(reg, "PADDED", T0), other = draft(reg, "OTHER", T0 + 1_000);
    const p = story(padded, T0 + 60_000, 0), o = story(other, T0 + 90_000, 0);
    const junk: Tx[] = Array.from({ length: 2_500 }, (_, k) => ({ signature: mkSig(), blockTime: secs(T0 + 600_000 + k * 1_000), err: null, accounts: [Keypair.generate().publicKey.toBase58(), p.fee] }));
    const txs = [...junk, ...p.all, ...o.all].sort((x, y) => y.blockTime - x.blockTime);
    const { reader } = fakeChain(txs, new Set([padded.mint, other.mint]));
    const v = tableVerifier(new Map([[p.create.signature, { mint: padded.mint, blockTimeMs: p.create.blockTime * 1000 }], [o.create.signature, { mint: other.mint, blockTimeMs: o.create.blockTime * 1000 }]]));
    const r = await run(reg, reader, v, T0 + 10 * 3_600_000);
    assert.deepEqual(r.takenLive.map((x) => x.ticker).sort(), ["OTHER", "PADDED"]);
  });

  test("ten waiting drafts share the verification budget: every one is offered its oldest transaction before any gets a second", async () => {
    const reg = openRegistry(":memory:");
    const ds = Array.from({ length: 10 }, (_, i) => draft(reg, `W${i}`, T0 + i * 1_000));
    // each coin: three junk in-window transactions on its fee PDA, the create is the NEWEST (worst case for oldest first)
    const txs: Tx[] = []; const table = new Map<string, { mint: string; blockTimeMs: number }>();
    for (const [i, t] of ds.entries()) {
      const fee = feePda(new PublicKey(PROGRAM), new PublicKey(t.mint)).toBase58();
      for (let k = 0; k < 3; k++) txs.push({ signature: mkSig(), blockTime: secs(T0 + 60_000 + i * 10_000 + k * 1_000), err: null, accounts: [fee] });
      const c = { signature: mkSig(), blockTime: secs(T0 + 60_000 + i * 10_000 + 5_000), err: null, accounts: [fee, t.mint] };
      txs.push(c); table.set(c.signature, { mint: t.mint, blockTimeMs: c.blockTime * 1000 });
    }
    txs.sort((x, y) => y.blockTime - x.blockTime);
    const { reader } = fakeChain(txs, new Set(ds.map((t) => t.mint)));
    const calls: string[] = [];
    await run(reg, reader, tableVerifier(table, calls), T0 + 3_600_000);
    const owners = calls.map((s) => txs.find((t) => t.signature === s)!.accounts[0]);
    assert.equal(new Set(owners).size, Math.min(10, VERIFY_PER_SWEEP), "the first sweep's verifications go one per draft");
  });
});

describe("F-3 · a create after the window raises bt-launch-late once per coin, naming the operator script", () => {
  test("a create at 25 h: not taken live, the draft is finished, one bt-launch-late alert with the revive script; never twice", async () => {
    const reg = openRegistry(":memory:");
    const t = draft(reg, "LATE", T0);
    const s = story(t, T0 + 25 * 3_600_000, 3);
    const { reader } = fakeChain(s.all, new Set([t.mint]));
    const v = tableVerifier(new Map([[s.create.signature, { mint: t.mint, blockTimeMs: s.create.blockTime * 1000 }]]));
    const now = T0 + 26 * 3_600_000;
    const r = await run(reg, reader, v, now);
    assert.deepEqual(r.takenLive, []);
    assert.equal(reg.token(t.mint)!.status, "draft");
    assert.deepEqual(r.finished, [t.mint]);
    assert.ok(now > T0 + DRAFT_TTL_MS + DRAFT_GRACE_MS);
    const alerts = reg.alertsSince(0).filter((a) => a.kind === LATE_ALERT_KIND);
    assert.equal(alerts.length, 1);
    assert.equal(LATE_ALERT_KIND, "bt-launch-late");
    assert.ok(alerts[0].text.includes(REVIVE_SCRIPT) && alerts[0].text.includes("--late") && alerts[0].text.includes(s.create.signature), alerts[0].text);
    // a later sweep (the next day: recordAlert dedupes per day only) raises nothing more for this mint
    reg.setStatus(SCAN_STATUS_PREFIX + t.mint, "{}");
    await run(reg, reader, v, now + 2 * 86_400_000);
    assert.equal(reg.alertsSince(0).filter((a) => a.kind === LATE_ALERT_KIND).length, 1, "deduped per mint");
  });
});
