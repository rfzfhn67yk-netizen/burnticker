// AUDIT F01 (2026-10-19), admission integrity: a creator who edits the unsigned launch transaction (fraction 10,000 bps instead of 200,
// another reserve, their own attester or admin) must not be admitted live under the advertised rule. The confirm step compares every
// value initialize_token was built with against the TokenConfig on chain; the keeper compares what its view carries before signing.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey } from "@solana/web3.js";
import { BURN_RECEIPTS_IDL } from "@/lib/burnReceipts/idl";
import { accountDiscriminator, decodeType, encodeType } from "@/lib/burnReceipts/idlCoder";
import { decodeTokenConfig } from "@/lib/burnReceipts/accounts";
import { configPda, feePda } from "@/lib/burnReceipts/pda";
import { LAUNCHLAB_PROGRAM } from "@/lib/burnKeeper/launchlab";
import type { ProgramConfigView } from "@/lib/burnKeeper/programPort";
import { counterRule, expectedFromCounter, type ExpectedTokenConfig } from "@/lib/burnticker/program";
import { lockRule } from "@/lib/burnticker/rules";
import { openRegistry } from "@/lib/burnticker/registry";
import { connectionLaunchVerifier, type LaunchExpectation, type TxReader } from "@/lib/burnticker/launchVerify";
import { configMismatch, expectedConfigFor, expectedConfigKey, fallbackExpectedConfig, loadExpectedConfig, mergeExpected, viewMismatch } from "@/lib/burnticker/admission";
import { markLaunched, prepareLaunch } from "@/lib/burnticker/api/handlers";
import { limiter } from "@/lib/burnticker/api/http";
import { lintCopy } from "@/lib/launch/copyLint";
import { ATTESTER, CREATOR, makeWorld } from "./burntickerApiHelpers.ts";
import { WSOL, applyExpected, createData } from "./burntickerAdmissionHelpers.ts";
import { BRONCOS, NOW } from "./burntickerHelpers.ts";

const RULE = { ...BRONCOS, pair: null };
const LOCKED = lockRule(RULE);
const TICKER = "HONEST";
const PROGRAM = Keypair.generate().publicKey;
const LL = LAUNCHLAB_PROGRAM.devnet;
const PLATFORM = Keypair.generate().publicKey;
const ADMIN = Keypair.generate().publicKey.toBase58();
const ATT = [Keypair.generate().publicKey.toBase58()];
const FLOOR = BigInt(6_666_667);

/** What the host encoded for this coin (programClient.ts does exactly this). */
const honest = (): ExpectedTokenConfig => expectedFromCounter(counterRule(LOCKED.rule, TICKER, "kalshi:KXNFLGAME", { floorLamports: FLOOR }), {
  rulesSha256: LOCKED.sha256, attesters: ATT, quorum: 1, admin: ADMIN, llPlatform: PLATFORM.toBase58(), endSink: null, pairVoidBy: 0, burnTargetKind: 0,
});

/** The TokenConfig as the chain holds it (the program's IDL encoding), with `edit` applied after the honest values. */
function tokenConfigData(mint: string, creator: string, exp: ExpectedTokenConfig, edit: (v: Record<string, unknown>) => void = () => {}): Buffer {
  const t = { defined: { name: "TokenConfig" } };
  const v = decodeType(BURN_RECEIPTS_IDL, t, Buffer.alloc(16_384)).value as Record<string, unknown>;
  v.version = 1; v.mint = new PublicKey(mint); v.creator = new PublicKey(creator); v.rules_sha256 = Buffer.from(exp.rulesSha256, "hex"); v.registration_policy = 0;
  applyExpected(v, exp);
  edit(v);
  return Buffer.concat([accountDiscriminator(BURN_RECEIPTS_IDL, "TokenConfig"), encodeType(BURN_RECEIPTS_IDL, t, v)]);
}

const INIT = BURN_RECEIPTS_IDL.instructions.find((i) => i.name === "initialize_token")!;
const slotOf = (n: string) => INIT.accounts.findIndex((a) => a.name === n);

/**
 * A landed launch (lock + create in one message, as before the split): burn_receipts initialize_token for this mint and creator, and
 * LaunchLab initialize_v2 under the platform with the burn pool as LaunchLab's creator. initialize_token's body is only its
 * discriminator (the verifier reads its account slots); the create carries real arguments (B-1: the verifier decodes them).
 */
const POOL = Keypair.generate().publicKey.toBase58();
function launchTx(mint: string, creator: string, llData: Uint8Array = createData()) {
  const burnPool = feePda(PROGRAM, new PublicKey(mint)).toBase58();
  const keys = [creator, mint, PROGRAM.toBase58(), LL.toBase58(), burnPool, PLATFORM.toBase58(), POOL, WSOL, Keypair.generate().publicKey.toBase58()];
  const at = (k: string) => keys.indexOf(k), filler = keys.length - 1;
  const initAccounts = INIT.accounts.map(() => filler);
  initAccounts[slotOf("creator")] = at(creator); initAccounts[slotOf("mint")] = at(mint);
  // B-1: the create's real arguments (the SDK's encoding) and its pool (5) and quote mint (7) accounts
  const llAccounts = [at(creator), at(burnPool), filler, at(PLATFORM.toBase58()), filler, at(POOL), at(mint), at(WSOL)];
  const pk = (k: string) => new PublicKey(k);
  return {
    blockTime: NOW / 1000, meta: { err: null, loadedAddresses: { writable: [], readonly: [] } },
    transaction: { message: { header: { numRequiredSignatures: 2 }, staticAccountKeys: keys.map(pk), compiledInstructions: [
      { programIdIndex: at(PROGRAM.toBase58()), accountKeyIndexes: initAccounts, data: new Uint8Array(INIT.discriminator) },
      { programIdIndex: at(LL.toBase58()), accountKeyIndexes: llAccounts, data: llData },
    ] } },
  };
}

function setup(edit?: (v: Record<string, unknown>) => void, exp: ExpectedTokenConfig = honest(), chainExp: ExpectedTokenConfig = honest()) {
  const mint = Keypair.generate().publicKey.toBase58(), creator = Keypair.generate().publicKey.toBase58();
  const cfg = { owner: PROGRAM, data: tokenConfigData(mint, creator, chainExp, edit) };
  const reader: TxReader = { getTransaction: async () => launchTx(mint, creator) as never, getAccountInfo: async (k: PublicKey) => (k.equals(configPda(PROGRAM, new PublicKey(mint))) ? cfg : null) };
  const verifier = connectionLaunchVerifier(reader, { burnProgramId: PROGRAM.toBase58(), launchLabProgramId: LL.toBase58() });
  const expect: LaunchExpectation = { mint, creator, draftCreatedAtMs: NOW - 60_000, rulesSha: LOCKED.sha256, venue: { kind: "launchlab", platformId: PLATFORM.toBase58() }, config: exp };
  return { verifier, expect, cfg };
}

const rule = (v: Record<string, unknown>) => v.rule as Record<string, unknown>;

describe("F01 at confirm: the TokenConfig on chain must hold every value the draft encoded", () => {
  test("an honest launch passes", async () => {
    const { verifier, expect } = setup();
    assert.deepEqual(await verifier.verify("s", expect), { ok: true, blockTimeMs: NOW });
  });

  const cases: [string, (v: Record<string, unknown>) => void, RegExp, boolean][] = [
    ["fraction 200 → 10,000 bps", (v) => { rule(v).fraction_per_unit_bps = 10_000; }, /fraction per unit to 10000 bps; this draft locks 200 bps/, true],
    ["reserve", (v) => { rule(v).reserve_lamports = BigInt(1); }, /the reserve to 1 lamports/, true],
    ["feed id", (v) => { v.feed_id = Buffer.concat([Buffer.from("bt.units:OTHER"), Buffer.alloc(18)]); v.feed_id_len = 14; }, /feed id/, false],
    ["admin", (v) => { v.admin = Keypair.generate().publicKey; }, /config authority/, false],
    ["attester key", (v) => { (v.attesters as { kind: number; key: PublicKey }[])[0] = { kind: 0, key: Keypair.generate().publicKey }; }, /attesters/, false],
    ["quorum", (v) => { v.quorum = 2; }, /the quorum to 2; this draft locks 1/, true],
    ["memo prefix", (v) => { v.memo_prefix = Buffer.concat([Buffer.from("FORGED"), Buffer.alloc(6)]); v.memo_prefix_len = 6; }, /memo prefix/, false],
    ["mode", (v) => { rule(v).mode = 1; }, /the mode to 1; this draft locks 0/, true],
    ["floor", (v) => { rule(v).floor_lamports = BigInt(1); }, /the minimum spend to 1 lamports/, true],
    ["tokens per unit", (v) => { rule(v).tokens_per_unit = BigInt(5); }, /tokens per unit to 5/, true],
    ["burn target kind", (v) => { v.burn_target_kind = 1; }, /burned token setting/, true],
    ["pair void day", (v) => { v.pair_void_by = 20991231; }, /pair's void day/, true],
    ["LaunchLab platform", (v) => { v.ll_platform = Keypair.generate().publicKey; }, /LaunchLab platform/, false],
    ["slippage", (v) => { rule(v).slippage_bps = 9999; }, /slippage limit/, true],
  ];
  for (const [name, edit, re, lint] of cases) {
    test(`one field changed — ${name} — is refused (422, names the field, the coin's own signers)`, async () => {
      const { verifier, expect } = setup(edit);
      const r = await verifier.verify("s", expect);
      assert.equal(r.ok, false, name);
      if (r.ok) return;
      assert.equal(r.status, 422);
      assert.match(r.reason, re);
      assert.match(r.reason, /it is not this coin's launch$/);
      assert.equal(r.belongsToExpectedSigners, true, "the coin's mint and creator signed it: it takes the per-mint slot like any other content refusal");
      if (lint) assert.equal(lintCopy(r.reason).hits.length, 0, JSON.stringify(lintCopy(r.reason).hits));
    });
  }

  test("the report's attack: only the fraction edited, the genuine attester and admin kept — refused", async () => {
    const { verifier, expect, cfg } = setup((v) => { rule(v).fraction_per_unit_bps = 10_000; });
    const onChain = decodeTokenConfig(cfg.data);
    assert.deepEqual(onChain.activeAttesters.map((a) => a.key.toBase58()), ATT, "the attester is the keeper's");
    assert.equal(onChain.admin.toBase58(), ADMIN);
    const r = await verifier.verify("s", expect);
    assert.equal(r.ok, false);
    assert.match(JSON.stringify(r), /10000 bps/);
  });

  test("without an expectation the old check stands (rules sha only), so a caller that passes none is unchanged", async () => {
    const { verifier, expect } = setup((v) => { rule(v).fraction_per_unit_bps = 10_000; });
    assert.equal((await verifier.verify("s", { ...expect, config: undefined })).ok, true);
  });

  test("a pinned target the program has since verified (kind 2) still matches a draft that pins a target", () => {
    const exp = { ...honest(), burnTargetKind: 1 };
    const mint = Keypair.generate().publicKey.toBase58(), creator = Keypair.generate().publicKey.toBase58();
    assert.equal(configMismatch(decodeTokenConfig(tokenConfigData(mint, creator, exp, (v) => { v.burn_target_kind = 2; })), exp), null);
    assert.match(String(configMismatch(decodeTokenConfig(tokenConfigData(mint, creator, exp, (v) => { v.burn_target_kind = 0; })), exp)), /burned token setting/);
  });
});

describe("F01 through the host: the expectation is stored at prepare and passed at confirm", () => {
  test("a prepare stores launch.expect.<mint> with the keeper attester and quorum 1; the confirm handler passes it to the verifier", async () => {
    const w = await makeWorld(); limiter.reset();
    const mint = Keypair.generate().publicKey.toBase58();
    const r = await prepareLaunch(w.p, { creator: CREATOR, ticker: "EXPECT", name: "Expect", rule: RULE, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true } }, { register: true, mint });
    assert.ok("ok" in r, JSON.stringify("error" in r ? r.error.body : r).slice(0, 300));
    const raw = w.registry.getStatus(expectedConfigKey(mint));
    assert.ok(raw, "the expectation is stored with the draft");
    const stored = JSON.parse(raw!) as ExpectedTokenConfig;
    assert.deepEqual(stored.attesters, [ATTESTER]);
    assert.equal(stored.quorum, 1);
    assert.equal(stored.rule.fractionPerUnitBps, 200);
    assert.equal(stored.rule.floorLamports, w.program.floorLamports.toString());
    let seen: LaunchExpectation | null = null;
    w.p.launchVerifier = { verify: async (_s, e) => { seen = e; return { ok: true as const, blockTimeMs: Date.now() }; } };
    const c = await markLaunched(w.p, mint, "5".repeat(88), Date.now(), "test");
    assert.equal(c.status, 200, JSON.stringify(c.body));
    assert.ok(seen, "the verifier was asked");
    // B-1: the stored expectation, not a rebuilt one; this world's placeholder LaunchLab client encodes no real create, so its create
    // expectation is the fallback from the draft row
    const { launchCreate, ...passed } = (seen as unknown as LaunchExpectation).config!;
    assert.deepEqual(passed, stored, "the stored expectation, not a rebuilt one");
    assert.equal(launchCreate?.fallback, true); assert.equal(launchCreate?.symbol, "EXPECT");
  });

  test("a retry of the same draft prices the floor again: both floors are accepted, nothing else loosens", async () => {
    const w = await makeWorld(); limiter.reset();
    const mint = Keypair.generate().publicKey.toBase58();
    const body = { creator: CREATOR, ticker: "RETRYF", name: "Retry again", rule: RULE, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true } };
    const once = await prepareLaunch(w.p, body, { register: true, mint });
    assert.ok("ok" in once, JSON.stringify("error" in once ? once.error.body : once).slice(0, 300));
    const first = w.program.floorLamports.toString();
    w.program.floorLamports = BigInt(7_000_000);
    const again = await prepareLaunch(w.p, body, { register: true, mint });
    assert.ok("ok" in again, JSON.stringify("error" in again ? again.error.body : again).slice(0, 300));
    const e = loadExpectedConfig(w.registry, mint)!;
    assert.equal(e.rule.floorLamports, "7000000");
    assert.deepEqual(e.acceptedFloorLamports, [first]);
    // and the merge refuses to keep old floors once anything else differs
    const fresh = { ...e, acceptedFloorLamports: undefined };
    assert.deepEqual(mergeExpected(e, { ...fresh, rule: { ...fresh.rule, floorLamports: "8000000" } }).acceptedFloorLamports, [first, "7000000"], "a third prepare keeps both earlier floors");
    assert.equal(mergeExpected(e, { ...fresh, quorum: 2 }).acceptedFloorLamports, undefined, "once anything but the floor differs, the earlier floors are dropped");
  });
});

describe("F01 in the keeper: the view is compared before anything is signed", () => {
  const view = (exp: ExpectedTokenConfig, over: Partial<ProgramConfigView> = {}): ProgramConfigView => ({
    programId: PROGRAM.toBase58(), config: "c", feePda: "f", mint: "m", mode: exp.rule.mode === 0 ? "buyback" : "vault", feedId: exp.feedId, memoPrefix: exp.memoPrefix, memoSource: exp.memoSource ?? "",
    valueDecimals: exp.rule.valueDecimals, rulesSha256: exp.rulesSha256, unitValue: BigInt(exp.rule.unitValue), fractionPerUnitBps: exp.rule.fractionPerUnitBps, floorLamports: BigInt(exp.rule.floorLamports ?? "0"),
    reserveLamports: BigInt(exp.rule.reserveLamports), tokensPerUnit: BigInt(exp.rule.tokensPerUnit), attesters: (exp.attesters ?? []).map((key) => ({ key, kind: 0 })), quorum: exp.quorum ?? 1,
    pendingAttesters: [], pendingEta: null, adminRenounced: false, hasBaseline: false, lastRecordDate: 0, lastValue: BigInt(0), carry: BigInt(0), crankCursor: 0, poolRegistered: true, pool: null,
    poolUntradeableSince: null, carriedSpendLamports: BigInt(0), totalBurned: BigInt(0), totalSpentLamports: BigInt(0), shortfall: BigInt(0), readings: 0, burns: 0, burnsTarget: exp.burnTargetKind !== 0, ...over,
  });
  test("an honest view passes; a fraction or a reserve mismatch is flagged", () => {
    const exp = honest();
    assert.equal(viewMismatch(view(exp), exp), null);
    assert.match(String(viewMismatch(view(exp, { fractionPerUnitBps: 10_000 }), exp)), /fraction per unit to 10000 bps/);
    assert.match(String(viewMismatch(view(exp, { reserveLamports: BigInt(1) }), exp)), /reserve to 1 lamports/);
  });
  test("attesters and quorum are compared only before the baseline (governance may change them later)", () => {
    const exp = honest(), other = [{ key: Keypair.generate().publicKey.toBase58(), kind: 0 }];
    assert.match(String(viewMismatch(view(exp, { attesters: other }), exp)), /attesters/);
    assert.match(String(viewMismatch(view(exp, { quorum: 2 }), exp)), /quorum/);
    assert.equal(viewMismatch(view(exp, { attesters: other, quorum: 2, hasBaseline: true, adminRenounced: true }), exp), null, "after apply_attester_change / renounce_admin the coin keeps burning");
    assert.match(String(viewMismatch(view(exp, { fractionPerUnitBps: 1, hasBaseline: true }), exp)), /fraction/, "the rule parameters are compared for ever");
  });
});

describe("F01 fallback: a draft prepared before expectations were stored", () => {
  test("still refuses a wrong fraction and does not refuse on the floor (priced at prepare, not known later)", async () => {
    const fb = fallbackExpectedConfig(LOCKED, TICKER);
    assert.equal(fb.fallback, true);
    assert.equal(fb.rule.floorLamports, null);
    assert.equal(fb.attesters, null); assert.equal(fb.admin, null);
    const otherFloor = setup((v) => { rule(v).floor_lamports = BigInt(123); }, fb);
    assert.equal((await otherFloor.verifier.verify("s", otherFloor.expect)).ok, true, "the floor is not compared");
    const otherAdmin = setup((v) => { v.admin = Keypair.generate().publicKey; }, fb);
    assert.equal((await otherAdmin.verifier.verify("s", otherAdmin.expect)).ok, true, "unknown fields are skipped");
    const wrong = setup((v) => { rule(v).fraction_per_unit_bps = 10_000; }, fb);
    const r = await wrong.verifier.verify("s", wrong.expect);
    assert.equal(r.ok, false); assert.match(JSON.stringify(r), /fraction per unit to 10000 bps; this draft locks 200 bps/);
  });
  test("expectedConfigFor: the stored expectation when present, else the fallback from the registry's locked rule", () => {
    const reg = openRegistry(":memory:");
    const mint = Keypair.generate().publicKey.toBase58();
    const t = reg.register({ mint, ticker: TICKER, name: "Honest", creator: CREATOR, description: "d", imageUrl: null, links: [], rulesText: LOCKED.text, feePda: "f", vault: null, tokenConfig: "c", poolId: "pool", launchTx: null, cluster: "devnet", platformId: null, baselineAt: new Date(NOW).toISOString(), status: "draft" }, NOW);
    const fb = expectedConfigFor(reg, t)!;
    assert.equal(fb.fallback, true);
    assert.equal(fb.rule.fractionPerUnitBps, 200);
    reg.setStatus(expectedConfigKey(mint), JSON.stringify(honest()));
    // B-1: a LaunchLab draft's expectation always carries its create; one stored before the arguments were is given the fallback
    const { launchCreate, ...storedRest } = expectedConfigFor(reg, t)!;
    assert.deepEqual(storedRest, honest());
    assert.equal(launchCreate?.fallback, true); assert.equal(launchCreate?.symbol, TICKER); assert.equal(launchCreate?.name, "Honest");
    reg.setStatus(expectedConfigKey(mint), "not json");
    assert.equal(expectedConfigFor(reg, t)!.fallback, true, "an unreadable expectation falls back, never skips the check");
  });
});

// SECOND AUDIT 2026-10-19 I-15: the fallback for a draft prepared before expectations were stored left the attesters, quorum, admin,
// platform, pair void day and memo source uncompared, so a draft prepared on the old build and confirmed later was admitted with an
// attacker-chosen sole attester. It is now filled from what the host itself encodes into every launch (ExpectedHost).
describe("I-15: the fallback is filled from the host's own launch facts", () => {
  const viewOf = (exp: ExpectedTokenConfig, over: Partial<ProgramConfigView> = {}): ProgramConfigView => ({
    programId: PROGRAM.toBase58(), config: "c", feePda: "f", mint: "m", mode: exp.rule.mode === 0 ? "buyback" : "vault", feedId: exp.feedId, memoPrefix: exp.memoPrefix, memoSource: exp.memoSource ?? "",
    valueDecimals: exp.rule.valueDecimals, rulesSha256: exp.rulesSha256, unitValue: BigInt(exp.rule.unitValue), fractionPerUnitBps: exp.rule.fractionPerUnitBps, floorLamports: BigInt(exp.rule.floorLamports ?? "0"),
    reserveLamports: BigInt(exp.rule.reserveLamports), tokensPerUnit: BigInt(exp.rule.tokensPerUnit), attesters: (exp.attesters ?? []).map((key) => ({ key, kind: 0 })), quorum: exp.quorum ?? 1,
    pendingAttesters: [], pendingEta: null, adminRenounced: false, hasBaseline: false, lastRecordDate: 0, lastValue: BigInt(0), carry: BigInt(0), crankCursor: 0, poolRegistered: true, pool: null,
    poolUntradeableSince: null, carriedSpendLamports: BigInt(0), totalBurned: BigInt(0), totalSpentLamports: BigInt(0), shortfall: BigInt(0), readings: 0, burns: 0, burnsTarget: exp.burnTargetKind !== 0, ...over,
  });
  const HOST = { keeperPubkey: ATT[0], admin: ADMIN, llPlatform: PLATFORM.toBase58() };
  const hostFallback = () => fallbackExpectedConfig(LOCKED, TICKER, undefined, { launchLab: true, host: HOST });

  test("every field but the floor is known: the keeper as sole attester with quorum 1, the admin, the platform, the memo source, the pair void day", () => {
    const fb = hostFallback(), h = honest();
    assert.equal(fb.fallback, true);
    assert.deepEqual(fb.attesters, ATT); assert.equal(fb.quorum, 1); assert.equal(fb.admin, ADMIN); assert.equal(fb.llPlatform, PLATFORM.toBase58());
    assert.equal(fb.memoSource, h.memoSource); assert.equal(fb.pairVoidBy, 0);
    assert.equal(fb.rule.floorLamports, null, "the floor stays uncompared (priced in SOL at prepare)");
    // a host with no keeper key encodes no attester, so it expects none (fail closed), and without host facts nothing changes
    assert.deepEqual(fallbackExpectedConfig(LOCKED, TICKER, undefined, { launchLab: true, host: { ...HOST, keeperPubkey: null } }).attesters, []);
    const bare = fallbackExpectedConfig(LOCKED, TICKER);
    assert.equal(bare.attesters, null); assert.equal(bare.admin, null); assert.equal(bare.memoSource, null); assert.equal(bare.pairVoidBy, null);
  });

  test("the honest launch passes (any floor); an attacker's sole attester, quorum, admin, platform or memo source is refused", async () => {
    const fb = hostFallback();
    assert.equal((await (({ verifier, expect }) => verifier.verify("s", expect))(setup(undefined, fb))).ok, true);
    const otherFloor = setup((v) => { rule(v).floor_lamports = BigInt(123); }, fb);
    assert.equal((await otherFloor.verifier.verify("s", otherFloor.expect)).ok, true, "the floor is not compared");
    const attacker = Keypair.generate().publicKey;
    const edits: [string, (v: Record<string, unknown>) => void, RegExp][] = [
      ["sole attester", (v) => { (v.attesters as { kind: number; key: PublicKey }[])[0] = { kind: 0, key: attacker }; }, /attesters/],
      ["quorum", (v) => { v.quorum = 2; }, /quorum/],
      ["admin", (v) => { v.admin = attacker; }, /config authority/],
      ["platform", (v) => { v.ll_platform = attacker; }, /LaunchLab platform/],
      ["memo source", (v) => { v.memo_source = Buffer.concat([Buffer.from("burnticker forged"), Buffer.alloc(47)]); v.memo_source_len = 17; }, /memo source/],
      ["pair void day", (v) => { v.pair_void_by = 20991231; }, /pair's void day/],
    ];
    for (const [name, edit, re] of edits) {
      const s = setup(edit, fb);
      const r = await s.verifier.verify("s", s.expect);
      assert.equal(r.ok, false, name);
      assert.match(JSON.stringify(r), re, name);
    }
  });

  test("the keeper fence compares the attesters before the baseline with the host's fallback too", () => {
    const fb = hostFallback();
    assert.equal(viewMismatch(viewOf(fb), fb), null);
    assert.match(String(viewMismatch(viewOf(fb, { attesters: [{ key: Keypair.generate().publicKey.toBase58(), kind: 0 }] }), fb)), /attesters/);
  });

  test("the confirm route (markLaunched) builds the host facts from the platform: an expectation-less draft with an attacker attester is refused, the honest one goes live", async () => {
    for (const attack of [true, false]) {
      limiter.reset();
      const fb = hostFallback();
      const s = setup(attack ? (v) => { (v.attesters as { kind: number; key: PublicKey }[])[0] = { kind: 0, key: Keypair.generate().publicKey }; } : undefined, fb);
      const reg = openRegistry(":memory:");
      reg.register({ mint: s.expect.mint, ticker: TICKER, name: "Honest", creator: s.expect.creator, description: "d", imageUrl: null, links: [], rulesText: LOCKED.text, feePda: "f", vault: null, tokenConfig: "c", poolId: POOL, launchTx: null, cluster: "devnet", platformId: PLATFORM.toBase58(), baselineAt: new Date(NOW).toISOString(), status: "draft" }, NOW - 60_000);
      assert.equal(loadExpectedConfig(reg, s.expect.mint), null, "a draft prepared before expectations were stored");
      const p = { registry: reg, launchVerifier: s.verifier, keeperPubkey: ATT[0], platformId: PLATFORM.toBase58(), program: { adminKey: ADMIN, launchLabPlatformKey: PLATFORM.toBase58() } } as unknown as Parameters<typeof markLaunched>[0];
      const r = await markLaunched(p, s.expect.mint, "5".repeat(88), NOW + 1000, `i15-${attack}`);
      if (attack) { assert.equal(r.status, 422, JSON.stringify(r.body)); assert.match(JSON.stringify(r.body), /attesters/); assert.equal(reg.token(s.expect.mint)!.status, "draft"); }
      else { assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(reg.token(s.expect.mint)!.status, "live"); }
    }
  });
});
