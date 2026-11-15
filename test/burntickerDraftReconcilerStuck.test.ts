// Block G review M1 (2026-10-16): a draft whose oldest transaction the verifier cannot judge yet (a pair not set up, RPC lag) was retried
// every sweep with no backoff, and an abandoned pair side answered 409 forever, so ten of them ate the sweep's ten verifications and a
// newer draft was never checked. Now an unconsumed head backs off, a 409 after the window (plus the settle time) is final, and drafts
// whose window is still open are verified first.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey } from "@solana/web3.js";
import { openRegistry, DRAFT_GRACE_MS, DRAFT_TTL_MS, type Registry, type TokenRow } from "@/lib/burnticker/registry";
import { lockRule } from "@/lib/burnticker/rules";
import type { LaunchCheck, LaunchExpectation, LaunchVerifier } from "@/lib/burnticker/launchVerify";
import { configPda, feePda } from "@/lib/burnReceipts/pda";
import { reconcileDrafts, BACKOFF_MIN_MS, RECONCILE_INTERVAL_MS, SCAN_STATUS_PREFIX, type DraftChainReader } from "@/lib/burnticker/draftReconciler";
import { CREATOR } from "./burntickerApiHelpers.ts";
import { BRONCOS } from "./burntickerHelpers.ts";

const T0 = Date.parse("2026-10-14T12:00:00Z");
const PROGRAM = Keypair.generate().publicKey.toBase58();
const secs = (ms: number) => Math.floor(ms / 1000);
let n = 0;
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const mkSig = () => { let k = ++n, o = ""; do { o = B58[k % 58] + o; k = Math.floor(k / 58); } while (k > 0); return (o.padStart(8, "1") + "Q".repeat(88)).slice(0, 88); };   // fixed width: no two counters share a prefix
const draft = (reg: Registry, ticker: string, at: number): TokenRow => reg.register({ mint: Keypair.generate().publicKey.toBase58(), ticker, name: `${ticker} coin`, creator: CREATOR, description: "", imageUrl: null, links: [], rulesText: lockRule(BRONCOS).text, feePda: "F", vault: null, tokenConfig: null, poolId: "Pool111111111111111111111111111111111111111", launchTx: null, cluster: "devnet", platformId: "Plat111111111111111111111111111111111111111", baselineAt: new Date(at).toISOString(), status: "draft" }, at);
type Tx = { signature: string; blockTime: number; err: null; accounts: string[] };
function fakeChain(txs: Tx[], cfgMints: Set<string>): DraftChainReader {
  return {
    async getMultipleAccountsInfo(keys: PublicKey[]) { return keys.map((k) => ([...cfgMints].some((m) => configPda(new PublicKey(PROGRAM), new PublicKey(m)).equals(k)) ? { owner: new PublicKey(PROGRAM), data: new Uint8Array(8) } : null)); },
    async getSignaturesForAddress(a: PublicKey, o: { limit: number; before?: string; until?: string }) {
      let rows = txs.filter((t) => t.accounts.includes(a.toBase58()));
      if (o.before) rows = rows.slice(rows.findIndex((r) => r.signature === o.before) + 1);
      if (o.until) { const u = rows.findIndex((r) => r.signature === o.until); if (u >= 0) rows = rows.slice(0, u); }
      return rows.slice(0, o.limit).map((r) => ({ signature: r.signature, err: r.err, blockTime: r.blockTime }));
    },
  };
}
const fee = (m: string) => feePda(new PublicKey(PROGRAM), new PublicKey(m)).toBase58();
const run = (reg: Registry, reader: DraftChainReader, verifier: LaunchVerifier, now: number) => reconcileDrafts({ registry: reg, reader, verifier, burnProgramId: PROGRAM, now: () => now, log: () => {}, dryRun: false, env: {} });

test("ten abandoned pair sides (409 forever, windows closed) ahead of a new draft: the new one goes live within two sweeps, and the abandoned ones finish", async () => {
  const reg = openRegistry(":memory:");
  const abandoned = Array.from({ length: 10 }, (_, i) => draft(reg, `GONE${i}`, T0 + i * 1_000));
  const fresh = draft(reg, "FRESH", T0 + 30 * 3_600_000);
  const txs: Tx[] = [];
  const stale = new Set<string>();
  for (const t of abandoned) for (let k = 0; k < 2; k++) { const s = { signature: mkSig(), blockTime: secs(T0 + 60_000 + k * 1_000), err: null, accounts: [fee(t.mint)] }; txs.push(s); stale.add(s.signature); }
  const create = { signature: mkSig(), blockTime: secs(T0 + 30 * 3_600_000 + 60_000), err: null as null, accounts: [fee(fresh.mint)] };
  txs.push(create);
  txs.sort((x, y) => y.blockTime - x.blockTime);
  const reader = fakeChain(txs, new Set([...abandoned, fresh].map((t) => t.mint)));
  const verifier: LaunchVerifier = { async verify(s: string, e: LaunchExpectation): Promise<LaunchCheck> { return s === create.signature && e.mint === fresh.mint ? { ok: true, blockTimeMs: create.blockTime * 1000 } : stale.has(s) ? { ok: false, status: 409, reason: "the pair is not set up on chain yet" } : { ok: false, status: 422, reason: "no" }; } };
  let now = T0 + 31 * 3_600_000, live = false;
  for (let k = 0; k < 2 && !live; k++) { const r = await run(reg, reader, verifier, now); live = r.takenLive.some((x) => x.mint === fresh.mint); now += RECONCILE_INTERVAL_MS + 1; }
  assert.ok(live, "the new draft went live within two sweeps");
  for (let k = 0; k < 4; k++) { await run(reg, reader, verifier, now); now += RECONCILE_INTERVAL_MS + 1; }
  for (const t of abandoned) assert.equal(JSON.parse(reg.getStatus(SCAN_STATUS_PREFIX + t.mint)!).done, true, `${t.ticker} finished`);
  assert.ok(now > T0 + DRAFT_TTL_MS + DRAFT_GRACE_MS);
});

test("inside its window, a head the verifier cannot judge yet (409, RPC lag) backs off instead of being retried every sweep", async () => {
  const reg = openRegistry(":memory:");
  const t = draft(reg, "WAIT", T0);
  const s = { signature: mkSig(), blockTime: secs(T0 + 60_000), err: null as null, accounts: [fee(t.mint)] };
  const reader = fakeChain([s], new Set([t.mint]));
  let calls = 0;
  const verifier: LaunchVerifier = { async verify(): Promise<LaunchCheck> { calls++; return { ok: false, status: 502, reason: "rpc" }; } };
  const now = T0 + 3_600_000;
  await run(reg, reader, verifier, now);
  const st = JSON.parse(reg.getStatus(SCAN_STATUS_PREFIX + t.mint)!);
  assert.ok(st.nextAt > now, "backed off");
  await run(reg, reader, verifier, now + RECONCILE_INTERVAL_MS + 1);
  await run(reg, reader, verifier, now + 2 * (RECONCILE_INTERVAL_MS + 1));
  assert.equal(calls, 2, "three sweeps, two tries: the backoff doubles");
});

test("review M2: 1,500 dust transfers to the fee PDA before the create never cut it; the draft still goes live (history walked oldest first by cursor)", async () => {
  const reg = openRegistry(":memory:");
  const t = draft(reg, "DUSTED", T0);
  const txs: Tx[] = Array.from({ length: 1_500 }, (_, k) => ({ signature: mkSig(), blockTime: secs(T0 + 60_000 + k * 10_000), err: null, accounts: [fee(t.mint)] }));
  const create = { signature: mkSig(), blockTime: secs(T0 + 60_000 + 1_500 * 10_000 + 5_000), err: null as null, accounts: [fee(t.mint), t.mint] };
  txs.push(create);
  txs.sort((x, y) => y.blockTime - x.blockTime);
  const reader = fakeChain(txs, new Set([t.mint]));
  const seen = new Set<string>();
  let dup = 0;
  const verifier: LaunchVerifier = { async verify(s: string): Promise<LaunchCheck> { if (seen.has(s)) dup++; seen.add(s); return s === create.signature ? { ok: true, blockTimeMs: create.blockTime * 1000 } : { ok: false, status: 422, reason: "not this coin's launch" }; } };
  let now = create.blockTime * 1000 + 60_000, live = false;
  for (let k = 0; k < 200 && !live; k++) { live = (await run(reg, reader, verifier, now)).takenLive.length > 0; now += RECONCILE_INTERVAL_MS + 1; }
  assert.ok(live, `the create was reached (seen ${seen.size}, state ${reg.getStatus(SCAN_STATUS_PREFIX + t.mint)})`);
  assert.equal(dup, 0, "no transaction is verified twice");
  assert.ok((reg.getStatus(SCAN_STATUS_PREFIX + t.mint) ?? "").length < 2_000, "the saved state holds cursors, not the history");
});

test("re-review blocker: 1,500 transactions before the create and 50 new ones every sweep: the walk is pinned, the create is still reached and the walk ends", async () => {
  const reg = openRegistry(":memory:");
  const t = draft(reg, "MOVING", T0);
  const f = fee(t.mint);
  const txs: Tx[] = [];
  let bt = T0 + 60_000;
  for (let k = 0; k < 1_500; k++) txs.push({ signature: mkSig(), blockTime: secs(bt += 1_000), err: null, accounts: [f] });
  const create = { signature: mkSig(), blockTime: secs(bt += 1_000), err: null as null, accounts: [f] };
  txs.push(create);
  const reader: DraftChainReader = {
    async getMultipleAccountsInfo(keys: PublicKey[]) { return keys.map((k) => (configPda(new PublicKey(PROGRAM), new PublicKey(t.mint)).equals(k) ? { owner: new PublicKey(PROGRAM), data: new Uint8Array(8) } : null)); },
    async getSignaturesForAddress(_a: PublicKey, o: { limit: number; before?: string; until?: string }) {
      let rows = [...txs].sort((x, y) => y.blockTime - x.blockTime);
      if (o.before) rows = rows.slice(rows.findIndex((r) => r.signature === o.before) + 1);
      if (o.until) { const u = rows.findIndex((r) => r.signature === o.until); if (u >= 0) rows = rows.slice(0, u); }
      return rows.slice(0, o.limit).map((r) => ({ signature: r.signature, err: r.err, blockTime: r.blockTime }));
    },
  };
  const seen = new Map<string, number>();
  const verifier: LaunchVerifier = { async verify(s: string): Promise<LaunchCheck> { seen.set(s, (seen.get(s) ?? 0) + 1); return s === create.signature ? { ok: true, blockTimeMs: create.blockTime * 1000 } : { ok: false, status: 422, reason: "no" }; } };
  let now = bt + 60_000, live = false;
  for (let k = 0; k < 220 && !live; k++) {
    live = (await run(reg, reader, verifier, now)).takenLive.length > 0;
    for (let g = 0; g < 50; g++) txs.push({ signature: mkSig(), blockTime: secs(now + g * 10), err: null, accounts: [f] });
    now += RECONCILE_INTERVAL_MS + 1;
  }
  assert.ok(live, `the create was reached (verified ${seen.size})`);
  assert.equal([...seen.values()].filter((v) => v > 1).length, 0, "no transaction verified twice");
});

function pagedChain(t: TokenRow, txs: Tx[], o: { emptyOnceBelowCursor?: boolean } = {}) {
  let emptied = false;
  const reader: DraftChainReader = {
    async getMultipleAccountsInfo(keys: PublicKey[]) { return keys.map((k) => (configPda(new PublicKey(PROGRAM), new PublicKey(t.mint)).equals(k) ? { owner: new PublicKey(PROGRAM), data: new Uint8Array(8) } : null)); },
    async getSignaturesForAddress(_a: PublicKey, q: { limit: number; before?: string; until?: string }) {
      if (q.before && o.emptyOnceBelowCursor && !emptied) { emptied = true; return []; }   // a lagging node, once
      let rows = [...txs].sort((x, y) => y.blockTime - x.blockTime);
      if (q.before) rows = rows.slice(rows.findIndex((r) => r.signature === q.before) + 1);
      if (q.until) { const u = rows.findIndex((r) => r.signature === q.until); if (u >= 0) rows = rows.slice(0, u); }
      return rows.slice(0, q.limit).map((r) => ({ signature: r.signature, err: r.err, blockTime: r.blockTime }));
    },
  };
  return reader;
}

test("re-review Low 1: an empty page below a cursor (a lagging node) is asked again before it counts as the bottom; the create is not lost", async () => {
  const reg = openRegistry(":memory:");
  const t = draft(reg, "LAGGY", T0);
  const f = fee(t.mint);
  let bt = T0 + 60_000;
  const create = { signature: mkSig(), blockTime: secs(bt += 1_000), err: null as null, accounts: [f] };
  const txs: Tx[] = [create, ...Array.from({ length: 1_200 }, () => ({ signature: mkSig(), blockTime: secs(bt += 1_000), err: null as null, accounts: [f] }))];
  const reader = pagedChain(t, txs, { emptyOnceBelowCursor: true });
  const verifier: LaunchVerifier = { async verify(s: string): Promise<LaunchCheck> { return s === create.signature ? { ok: true, blockTimeMs: create.blockTime * 1000 } : { ok: false, status: 422, reason: "no" }; } };
  // after the window has closed: a read that wrongly reaches the bottom would finish the draft without its create
  let now = T0 + DRAFT_TTL_MS + DRAFT_GRACE_MS + 3_600_000, live = false, finishedWithout = false;
  for (let k = 0; k < 120 && !live && !finishedWithout; k++) { const r = await run(reg, reader, verifier, now); live = r.takenLive.length > 0; finishedWithout = r.finished.includes(t.mint) && !live; now += RECONCILE_INTERVAL_MS + 1; }
  assert.equal(finishedWithout, false, "not finished on one empty answer");
  assert.ok(live);
});

test("re-review Low 2: a transaction judged resets the backoff, so a draft that waited out RPC trouble starts again from the shortest wait", async () => {
  const reg = openRegistry(":memory:");
  const t = draft(reg, "RESET", T0);
  const f = fee(t.mint);
  let bt = T0 + 60_000;
  const txs: Tx[] = Array.from({ length: 3 }, () => ({ signature: mkSig(), blockTime: secs(bt += 1_000), err: null as null, accounts: [f] }));
  const reader = pagedChain(t, txs);
  let flaky = true;
  const verifier: LaunchVerifier = { async verify(): Promise<LaunchCheck> { return flaky ? { ok: false, status: 502, reason: "rpc" } : { ok: false, status: 422, reason: "no" }; } };
  let now = T0 + 3_600_000;
  const st = () => JSON.parse(reg.getStatus(SCAN_STATUS_PREFIX + t.mint)!);
  await run(reg, reader, verifier, now);
  now = st().nextAt + 1; await run(reg, reader, verifier, now);
  assert.equal(st().backoffMs, 2 * BACKOFF_MIN_MS, "two RPC failures: a doubled wait");
  flaky = false;
  now = st().nextAt + 1; await run(reg, reader, verifier, now);
  assert.equal(st().nextAt - now, BACKOFF_MIN_MS, "after progress, the no-create wait starts from the shortest again");
});
