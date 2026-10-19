// I-14 (audit 2026-10-19, second pass): the admission check must compare the EndSink ["end_sink", mint] and BurnTarget ["burn_target", mint]
// accounts too, not only the TokenConfig. A creator who edits the end-sink or target arguments of the first transaction is refused at
// confirm (422) and held by the keeper before any forward or target crank. Accounts are IDL-encoded, as the chain holds them.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey } from "@solana/web3.js";
import { BURN_RECEIPTS_IDL } from "@/lib/burnReceipts/idl";
import { accountDiscriminator, decodeType, encodeType } from "@/lib/burnReceipts/idlCoder";
import { configPda, endSinkPda, feePda } from "@/lib/burnReceipts/pda";
import { burnTargetPda } from "@/lib/burnReceipts/burnTarget";
import { END_SINK_FLAGSHIP, END_SINK_MINT, END_SINK_PAIR_WINNER, FLAGSHIP_MINT } from "@/lib/burnReceipts/endSink";
import { LAUNCHLAB_PROGRAM } from "@/lib/burnKeeper/launchlab";
import { counterRule, expectedFromCounter, type ExpectedTokenConfig } from "@/lib/burnticker/program";
import { lockRule } from "@/lib/burnticker/rules";
import { LAUNCHLAB_INITIALIZE_V2, connectionLaunchVerifier, type LaunchExpectation, type TxReader } from "@/lib/burnticker/launchVerify";
import { admissionAccountsMismatch, burnTargetHold, burnTargetMismatch, endSinkMismatch, readAdmissionAccounts } from "@/lib/burnticker/admissionAccounts";
import { endSinkHold } from "@/lib/burnticker/endSinkKeeper";
import { expectedConfigKey } from "@/lib/burnticker/admission";
import { lintCopy } from "@/lib/launch/copyLint";
import { encodeAccount } from "./burntickerApiHelpers.ts";
import { applyExpected } from "./burntickerAdmissionHelpers.ts";
import { BRONCOS, NOW } from "./burntickerHelpers.ts";

const RULE = { ...BRONCOS, pair: null };
const LOCKED = lockRule(RULE);
const TICKER = "HONEST";
const PROGRAM = Keypair.generate().publicKey;
const LL = LAUNCHLAB_PROGRAM.devnet;
const PLATFORM = Keypair.generate().publicKey;
const ADMIN = Keypair.generate().publicKey.toBase58();
const ATT = [Keypair.generate().publicKey.toBase58()];
const FLAGSHIP = FLAGSHIP_MINT.devnet.toBase58();
const PARTNER = Keypair.generate().publicKey.toBase58();
const ATTACKER_COIN = Keypair.generate().publicKey.toBase58();
const MIN = "50000000";
const TARGET = { mint: Keypair.generate().publicKey.toBase58(), pool: Keypair.generate().publicKey.toBase58(), feedId: "ab".repeat(32) };
const ONCHAIN = { targetMint: TARGET.mint, pool: TARGET.pool, feedId: TARGET.feedId };

type Sink = ExpectedTokenConfig["endSink"];
const expected = (endSink: Sink, burnTarget: ExpectedTokenConfig["burnTarget"] = null): ExpectedTokenConfig => expectedFromCounter(counterRule(LOCKED.rule, TICKER, "kalshi:KXNFLGAME", { floorLamports: BigInt(6_666_667) }), {
  rulesSha256: LOCKED.sha256, attesters: ATT, quorum: 1, admin: ADMIN, llPlatform: PLATFORM.toBase58(), endSink, pairVoidBy: 0, burnTargetKind: burnTarget ? 1 : 0, burnTarget,
});
const FLAGSHIP_SINK: Sink = { kind: END_SINK_FLAGSHIP, mint: null, minLamports: MIN };
const PAIR_SINK: Sink = { kind: END_SINK_PAIR_WINNER, mint: PARTNER, minLamports: MIN };

/** What the chain holds for an expectation: [kind, sink mint, min] or null for no EndSink. */
type SinkOnChain = { kind: number; sinkMint: string; min: string } | null;
const sinkOf = (s: Sink): SinkOnChain => (s ? { kind: s.kind, sinkMint: s.mint ?? (s.kind === END_SINK_FLAGSHIP ? FLAGSHIP : PARTNER), min: s.minLamports } : null);
type TargetOnChain = { targetMint: string; pool: string; feedId: string; repins?: number; mint?: string } | null;

function tokenConfigData(mint: string, creator: string, exp: ExpectedTokenConfig): Buffer {
  const t = { defined: { name: "TokenConfig" } };
  const v = decodeType(BURN_RECEIPTS_IDL, t, Buffer.alloc(16_384)).value as Record<string, unknown>;
  v.version = 1; v.mint = new PublicKey(mint); v.creator = new PublicKey(creator); v.rules_sha256 = Buffer.from(exp.rulesSha256, "hex"); v.registration_policy = 0;
  applyExpected(v, exp);
  return Buffer.concat([accountDiscriminator(BURN_RECEIPTS_IDL, "TokenConfig"), encodeType(BURN_RECEIPTS_IDL, t, v)]);
}
const endSinkData = (mint: string, s: NonNullable<SinkOnChain>): Buffer => encodeAccount("EndSink", (v) => { v.version = 1; v.mint = new PublicKey(mint); v.sink_kind = s.kind; v.sink_mint = new PublicKey(s.sinkMint); v.min_forward_lamports = BigInt(s.min); v.created_at = BigInt(1); });
const burnTargetData = (mint: string, b: NonNullable<TargetOnChain>): Buffer => encodeAccount("BurnTarget", (v) => { v.version = 1; v.mint = new PublicKey(b.mint ?? mint); v.target_mint = new PublicKey(b.targetMint); v.pool = new PublicKey(b.pool); v.target_feed_id = Buffer.from(b.feedId, "hex"); v.pinned_at = BigInt(1); v.repins = b.repins ?? 0; });

const INIT = BURN_RECEIPTS_IDL.instructions.find((i) => i.name === "initialize_token")!;
const slotOf = (n: string) => INIT.accounts.findIndex((a) => a.name === n);
function launchTx(mint: string, creator: string) {
  const burnPool = feePda(PROGRAM, new PublicKey(mint)).toBase58();
  const keys = [creator, mint, PROGRAM.toBase58(), LL.toBase58(), burnPool, PLATFORM.toBase58(), Keypair.generate().publicKey.toBase58()];
  const at = (k: string) => keys.indexOf(k), filler = keys.length - 1;
  const initAccounts = INIT.accounts.map(() => filler);
  initAccounts[slotOf("creator")] = at(creator); initAccounts[slotOf("mint")] = at(mint);
  const llAccounts = [at(creator), at(burnPool), filler, at(PLATFORM.toBase58()), filler, filler, at(mint)];
  return {
    blockTime: NOW / 1000, meta: { err: null, loadedAddresses: { writable: [], readonly: [] } },
    transaction: { message: { header: { numRequiredSignatures: 2 }, staticAccountKeys: keys.map((k) => new PublicKey(k)), compiledInstructions: [
      { programIdIndex: at(PROGRAM.toBase58()), accountKeyIndexes: initAccounts, data: new Uint8Array(INIT.discriminator) },
      { programIdIndex: at(LL.toBase58()), accountKeyIndexes: llAccounts, data: new Uint8Array(LAUNCHLAB_INITIALIZE_V2) },
    ] } },
  };
}

/** A landed launch whose TokenConfig matches `exp`, with the EndSink and BurnTarget the chain holds given separately. */
function world(exp: ExpectedTokenConfig, sink: SinkOnChain, target: TargetOnChain = null) {
  const mint = Keypair.generate().publicKey.toBase58(), creator = Keypair.generate().publicKey.toBase58();
  const m = new PublicKey(mint);
  const accounts = new Map<string, { owner: PublicKey; data: Buffer }>([[configPda(PROGRAM, m).toBase58(), { owner: PROGRAM, data: tokenConfigData(mint, creator, exp) }]]);
  if (sink) accounts.set(endSinkPda(PROGRAM, m).toBase58(), { owner: PROGRAM, data: endSinkData(mint, sink) });
  if (target) accounts.set(burnTargetPda(PROGRAM, m).toBase58(), { owner: PROGRAM, data: burnTargetData(mint, target) });
  const reader: TxReader = { getTransaction: async () => launchTx(mint, creator) as never, getAccountInfo: async (k: PublicKey) => accounts.get(k.toBase58()) ?? null };
  const verifier = connectionLaunchVerifier(reader, { burnProgramId: PROGRAM.toBase58(), launchLabProgramId: LL.toBase58() });
  const expect: LaunchExpectation = { mint, creator, draftCreatedAtMs: NOW - 60_000, rulesSha: LOCKED.sha256, venue: { kind: "launchlab", platformId: PLATFORM.toBase58() }, config: exp };
  return { verifier, expect, reader, mint };
}

const refused = async (w: ReturnType<typeof world>, re: RegExp) => {
  const r = await w.verifier.verify("s", w.expect);
  assert.equal(r.ok, false);
  if (r.ok) return r;
  assert.equal(r.status, 422);
  assert.match(r.reason, re);
  assert.match(r.reason, /it is not this coin's launch$/);
  assert.equal(r.belongsToExpectedSigners, true);
  assert.equal(lintCopy(r.reason).hits.length, 0, JSON.stringify(lintCopy(r.reason).hits));
  return r;
};

describe("I-14 at confirm: the EndSink and BurnTarget must be the ones the draft encoded", () => {
  test("honest cases pass: no sink, the flagship sink, the pair-winner sink, a pinned target", async () => {
    for (const [name, exp, sink, target] of [
      ["no sink", expected(null), null, null],
      ["flagship", expected(FLAGSHIP_SINK), sinkOf(FLAGSHIP_SINK), null],
      ["pair winner", expected(PAIR_SINK), sinkOf(PAIR_SINK), null],
      ["target", expected(FLAGSHIP_SINK, TARGET), sinkOf(FLAGSHIP_SINK), { ...ONCHAIN }],
    ] as const) {
      const w = world(exp as ExpectedTokenConfig, sink as SinkOnChain, target as TargetOnChain);
      assert.deepEqual(await w.verifier.verify("s", w.expect), { ok: true, blockTimeMs: NOW }, name);
    }
  });

  test("the attack: the flagship sink edited to the creator's own coin (kind changed to a named coin) is refused", async () => {
    await refused(world(expected(FLAGSHIP_SINK), { kind: END_SINK_MINT, sinkMint: ATTACKER_COIN, min: MIN }), /the end sink on chain is a named coin; this draft sends its leftover pool to the flagship/);
  });

  test("the pair-winner sink with only the mint changed is refused", async () => {
    await refused(world(expected(PAIR_SINK), { kind: END_SINK_PAIR_WINNER, sinkMint: ATTACKER_COIN, min: MIN }), /the end sink on chain names another coin/);
  });

  test("a named-coin sink with only the mint changed is refused", async () => {
    const sink: Sink = { kind: END_SINK_MINT, mint: PARTNER, minLamports: MIN };
    await refused(world(expected(sink), { kind: END_SINK_MINT, sinkMint: ATTACKER_COIN, min: MIN }), /names another coin/);
  });

  test("only the minimum forward changed is refused", async () => {
    await refused(world(expected(FLAGSHIP_SINK), { ...sinkOf(FLAGSHIP_SINK)!, min: "999999999" }), /minimum forward to 999999999 lamports; this draft locks 50000000 lamports/);
  });

  test("a missing EndSink when the draft names one is refused (and not remembered: a lagging RPC can answer that)", async () => {
    const r = await refused(world(expected(FLAGSHIP_SINK), null), /no end sink on chain/);
    assert.equal(r.ok === false && r.missing, true);
  });

  test("an EndSink on chain when the draft names none is refused", async () => {
    await refused(world(expected(null), { kind: END_SINK_MINT, sinkMint: ATTACKER_COIN, min: MIN }), /pins an end sink on chain .* and this draft pins none/);
  });

  test("only the target pool changed is refused", async () => {
    await refused(world(expected(FLAGSHIP_SINK, TARGET), sinkOf(FLAGSHIP_SINK), { ...ONCHAIN, pool: Keypair.generate().publicKey.toBase58() }), /pinned token on chain trades on another pool/);
  });

  test("only the target token changed is refused", async () => {
    await refused(world(expected(FLAGSHIP_SINK, TARGET), sinkOf(FLAGSHIP_SINK), { ...ONCHAIN, targetMint: ATTACKER_COIN }), /pinned token on chain is another token/);
  });

  test("only the target feed changed is refused", async () => {
    await refused(world(expected(FLAGSHIP_SINK, TARGET), sinkOf(FLAGSHIP_SINK), { ...ONCHAIN, feedId: "cd".repeat(32) }), /another Pyth feed/);
  });

  test("a BurnTarget on a coin that burns itself is refused, and a target draft without one is refused", async () => {
    await refused(world(expected(null), null, { ...ONCHAIN }), /pins another token to burn on chain/);
    await refused(world(expected(FLAGSHIP_SINK, TARGET), sinkOf(FLAGSHIP_SINK), null), /pins no token to burn on chain/);
  });

  test("an RPC failure reading the accounts is a retry (502), never a remembered refusal", async () => {
    const w = world(expected(FLAGSHIP_SINK), sinkOf(FLAGSHIP_SINK));
    const r = await admissionAccountsMismatch({ getAccountInfo: async () => { throw new Error("socket hang up"); } }, { programId: PROGRAM.toBase58(), mint: w.mint, exp: w.expect.config! });
    assert.equal(r?.retry, true);
  });

  test("a fallback expectation (rebuilt without the prepare's record) does not compare the unknown end sink", () => {
    const exp = { ...expected(null), fallback: true as const };
    assert.equal(endSinkMismatch({ kind: END_SINK_FLAGSHIP, sinkMint: FLAGSHIP, minForwardLamports: BigInt(MIN) }, exp, { mint: Keypair.generate().publicKey.toBase58() }), null);
  });

  test("readAdmissionAccounts decodes both IDL-encoded accounts", async () => {
    const w = world(expected(FLAGSHIP_SINK, TARGET), sinkOf(FLAGSHIP_SINK), { ...ONCHAIN, repins: 2 });
    const r = await readAdmissionAccounts(w.reader, PROGRAM.toBase58(), w.mint);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.deepEqual(r.endSink, { kind: END_SINK_FLAGSHIP, sinkMint: FLAGSHIP, minForwardLamports: BigInt(MIN) });
    assert.deepEqual(r.burnTarget, { mint: w.mint, targetMint: TARGET.mint, pool: TARGET.pool, feedId: TARGET.feedId, repins: 2 });
  });
});

describe("I-14 in the keeper: hold before any forward or target crank", () => {
  const registry = (exp: ExpectedTokenConfig | null, mint: string, pair: { mintA: string; mintB: string } | null = null) => {
    const alerts: { kind: string; key: string }[] = [];
    return { alerts, reg: {
      getStatus: (k: string) => (exp && k === expectedConfigKey(mint) ? JSON.stringify(exp) : null),
      recordAlert: (a: { kind: string; key: string }) => { alerts.push(a); return { ts: 1, kind: a.kind, key: a.key }; },
      pairOf: () => (pair ? { pairId: "p", ...pair, selectorKey: "x", createdAt: 1 } : null),
    } };
  };
  const deps = (reg: unknown) => ({ registry: reg as never, log: () => {}, now: () => NOW });

  test("end sink: the honest flagship and pair-winner sinks go on; an edited sink holds with one alert", () => {
    const mint = Keypair.generate().publicKey.toBase58();
    const t = { mint, ticker: "X" };
    const ok1 = registry(expected(FLAGSHIP_SINK), mint);
    assert.equal(endSinkHold(deps(ok1.reg), t, { kind: "flagship", sinkMint: FLAGSHIP, minForwardLamports: BigInt(MIN) }, FLAGSHIP), null);
    const ok2 = registry(expected({ kind: END_SINK_PAIR_WINNER, mint: null, minLamports: MIN }), mint, { mintA: mint, mintB: PARTNER });
    assert.equal(endSinkHold(deps(ok2.reg), t, { kind: "pair-winner", sinkMint: PARTNER, minForwardLamports: BigInt(MIN) }, FLAGSHIP), null, "an older record without the partner mint compares against the registry's pair");
    const bad = registry(expected({ kind: END_SINK_PAIR_WINNER, mint: null, minLamports: MIN }), mint, { mintA: mint, mintB: PARTNER });
    const h = endSinkHold(deps(bad.reg), t, { kind: "pair-winner", sinkMint: ATTACKER_COIN, minForwardLamports: BigInt(MIN) }, FLAGSHIP);
    assert.ok(h && h.handled && !h.selfBurn, "held: nothing forwarded, no wind-down");
    assert.deepEqual(bad.alerts.map((a) => a.kind), ["config-mismatch"]);
    const none = registry(null, mint);
    assert.equal(endSinkHold(deps(none.reg), t, { kind: "mint", sinkMint: ATTACKER_COIN, minForwardLamports: BigInt(MIN) }, FLAGSHIP), null, "no stored expectation: unchanged");
  });

  test("burn target: a repinned pool is the vault's change and goes on; another token holds the crank", async () => {
    const mint = Keypair.generate().publicKey.toBase58(), t = { mint, ticker: "X" };
    const r = registry(expected(FLAGSHIP_SINK, TARGET), mint);
    const program = (chain: unknown) => ({ burnTargetOf: async () => chain as never });
    assert.equal(await burnTargetHold({ ...deps(r.reg), registry: r.reg as never, program: program({ mint, ...ONCHAIN, repins: 0 }) }, t), null);
    assert.equal(await burnTargetHold({ ...deps(r.reg), registry: r.reg as never, program: program({ mint, ...ONCHAIN, pool: ATTACKER_COIN, repins: 1 }) }, t), null);
    assert.match((await burnTargetHold({ ...deps(r.reg), registry: r.reg as never, program: program({ mint, ...ONCHAIN, pool: ATTACKER_COIN, repins: 0 }) }, t)) ?? "", /another pool/);
    assert.match((await burnTargetHold({ ...deps(r.reg), registry: r.reg as never, program: program({ mint, ...ONCHAIN, targetMint: ATTACKER_COIN, repins: 0 }) }, t)) ?? "", /another token/);
    assert.equal(r.alerts.length, 2);
    assert.equal(burnTargetMismatch(null, expected(null), { mint }), null);
  });
});
