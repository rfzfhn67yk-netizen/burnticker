// PRELAUNCH AUDIT 2026-10-18 A-18: 300 dust transfers to a draft's fee PDA (about 0.0015 SOL) held its recovery back 31 sweeps (about
// 2.5 hours) and cost 302 getTransaction verifications, because every transaction naming the fee PDA was verified oldest first, ten a
// sweep. Every lock and create is signed by the coin's new mint, so the reconciler now reads the signers of a page in one batch and drops
// what the mint did not sign without a verification.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey } from "@solana/web3.js";
import { openRegistry } from "@/lib/burnticker/registry";
import { lockRule } from "@/lib/burnticker/rules";
import { feePda } from "@/lib/burnReceipts/pda";
import { configPda } from "@/lib/burnReceipts/pda";
import { RECONCILE_INTERVAL_MS, reconcileDrafts, withSignerReads } from "@/lib/burnticker/draftReconciler";
import { CREATOR } from "./burntickerApiHelpers.ts";
import { BRONCOS } from "./burntickerHelpers.ts";

const T0 = Date.parse("2026-10-14T12:00:00Z");
const PROGRAM = Keypair.generate().publicKey.toBase58();
const secs = (ms: number) => Math.floor(ms / 1000);
let n = 0;
const sig = () => `S${String(++n).padStart(7, "0")}${"Q".repeat(80)}`;   // unique per transaction
type Tx = { signature: string; blockTime: number; err: null; accounts: string[]; signers: string[] };
// deno-lint-ignore no-explicit-any
type Any = any;
const draft = (reg: Any, ticker: string) => reg.register({ mint: Keypair.generate().publicKey.toBase58(), ticker, name: `${ticker} coin`, creator: CREATOR, description: "", imageUrl: null, links: [], rulesText: lockRule(BRONCOS).text, feePda: "F", vault: null, tokenConfig: null, poolId: null, launchTx: null, cluster: "devnet", platformId: null, baselineAt: new Date(T0).toISOString(), status: "draft" }, T0);
const fee = (m: string) => feePda(new PublicKey(PROGRAM), new PublicKey(m)).toBase58();
function chain(txs: Tx[], mint: string, withSigners: boolean, calls: { signerReads: number }) {
  const r = {
    async getMultipleAccountsInfo(keys: PublicKey[]) { return keys.map((k) => (configPda(new PublicKey(PROGRAM), new PublicKey(mint)).equals(k) ? { owner: new PublicKey(PROGRAM), data: new Uint8Array(8) } : null)); },
    async getSignaturesForAddress(a: PublicKey, o: { limit: number; before?: string; until?: string }) {
      let rows = [...txs].sort((x, y) => y.blockTime - x.blockTime || (x.signature < y.signature ? 1 : -1)).filter((t) => t.accounts.includes(a.toBase58()));
      if (o.before) rows = rows.slice(rows.findIndex((x) => x.signature === o.before) + 1);
      if (o.until) { const u = rows.findIndex((x) => x.signature === o.until); if (u >= 0) rows = rows.slice(0, u); }
      return rows.slice(0, o.limit).map((x) => ({ signature: x.signature, err: x.err, blockTime: x.blockTime }));
    },
    // the shape web3.js getTransactions answers (one JSON-RPC batch)
    async getTransactions(sigs: string[]) {
      calls.signerReads++;
      return sigs.map((s) => { const t = txs.find((x) => x.signature === s); return t ? { transaction: { message: { header: { numRequiredSignatures: t.signers.length }, staticAccountKeys: [...t.signers, ...t.accounts].map((k) => ({ toBase58: () => k })) } } } : null; });
    },
  };
  return withSigners ? withSignerReads(r) : r;
}

async function recover(withSigners: boolean) {
  const reg = openRegistry(":memory:");
  const t = draft(reg, "DUSTED");
  const dust: Tx[] = Array.from({ length: 300 }, (_, k) => ({ signature: sig(), blockTime: secs(T0 + 10_000 + k * 100), err: null, accounts: [fee(t.mint), t.mint], signers: [Keypair.generate().publicKey.toBase58()] }));
  const lock: Tx = { signature: sig(), blockTime: secs(T0 + 600_000), err: null, accounts: [fee(t.mint)], signers: [CREATOR, t.mint] };
  const create: Tx = { signature: sig(), blockTime: secs(T0 + 602_000), err: null, accounts: [fee(t.mint)], signers: [CREATOR, t.mint] };
  const calls = { signerReads: 0 }, verified = { n: 0 };
  const reader = chain([...dust, lock, create], t.mint, withSigners, calls);
  const verifier = { async verify(s: string) { verified.n++; return s === create.signature ? { ok: true as const, blockTimeMs: create.blockTime * 1000 } : { ok: false as const, status: 422 as const, reason: "not this coin's launch" }; } };
  let now = T0 + 3_600_000, sweeps = 0, live = false;
  while (!live && sweeps < 100) { live = (await reconcileDrafts({ registry: reg, reader: reader as Any, verifier: verifier as Any, burnProgramId: PROGRAM, now: () => now, log: () => {}, dryRun: false, env: {} })).takenLive.length > 0; now += RECONCILE_INTERVAL_MS + 1; sweeps++; }
  return { live, sweeps, verified: verified.n, signerReads: calls.signerReads };
}

test("A-18: 300 dust transfers to the fee PDA cost no verification; the coin goes live within two sweeps", async () => {
  const r = await recover(true);
  assert.ok(r.live);
  assert.ok(r.sweeps <= 2, `sweeps: ${r.sweeps}`);
  assert.equal(r.verified, 2, "the lock (judged and passed over) and the create");
  assert.ok(r.signerReads <= 4, `batched signer reads: ${r.signerReads}`);
});

test("A-18: a reader without batched signer reads still finds the create (every transaction verified, as before)", async () => {
  const r = await recover(false);
  assert.ok(r.live);
  assert.ok(r.verified > 300);
});
