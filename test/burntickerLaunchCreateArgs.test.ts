// B-1 (third audit 2026-10-19; the fifth pass's LA-2): the confirm step never read the LaunchLab initialize_v2 ARGUMENTS, so a creator who
// edited the unsigned create went live with another on-chain name, symbol, metadata address, supply, decimals or raise than the site
// built. Now the bundle's own create is stored with the draft's expectation at prepare and every argument is compared at confirm; a
// draft prepared before that is compared with what the draft row and the bundle recipe fix. Every fixture is the Raydium SDK's encoding.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import BN from "bn.js";
import { Keypair, PublicKey, type TransactionInstruction } from "@solana/web3.js";
import { initializeV2 } from "@raydium-io/raydium-sdk-v2";
import { TOKEN_PROGRAM_ID } from "@/lib/burnKeeper/solana";
import { BURN_RECEIPTS_IDL } from "@/lib/burnReceipts/idl";
import { accountDiscriminator, decodeType, encodeType } from "@/lib/burnReceipts/idlCoder";
import { configPda, feePda } from "@/lib/burnReceipts/pda";
import { LAUNCHLAB_PROGRAM } from "@/lib/burnKeeper/launchlab";
import { counterRule, expectedFromCounter, type ExpectedLaunchCreate, type ExpectedTokenConfig } from "@/lib/burnticker/program";
import { lockRule } from "@/lib/burnticker/rules";
import { openRegistry } from "@/lib/burnticker/registry";
import { connectionLaunchVerifier, type LaunchExpectation, type TxReader } from "@/lib/burnticker/launchVerify";
import { decodeInitializeV2, expectedCreateFromBundle } from "@/lib/burnticker/launchCreateArgs";
import { expectedConfigKey, fallbackExpectedCreate, loadExpectedConfig } from "@/lib/burnticker/admission";
import { SdkLaunchLab } from "@/lib/burnticker/launchBundle";
import { markLaunched, prepareLaunch } from "@/lib/burnticker/api/handlers";
import { limiter } from "@/lib/burnticker/api/http";
import { lintCopy } from "@/lib/launch/copyLint";
import { HONEST_CREATE, WSOL, applyExpected, type CreateArgs } from "./burntickerAdmissionHelpers.ts";
import { CREATOR, makeWorld } from "./burntickerApiHelpers.ts";
import { BRONCOS, NOW } from "./burntickerHelpers.ts";

const RULE = { ...BRONCOS, pair: null };
const LOCKED = lockRule(RULE);
const PROGRAM = Keypair.generate().publicKey, LL = LAUNCHLAB_PROGRAM.devnet, PLATFORM = Keypair.generate().publicKey, CONFIG = Keypair.generate().publicKey, POOL = Keypair.generate().publicKey;
const r = () => Keypair.generate().publicKey;
const CFG_EXP: ExpectedTokenConfig = expectedFromCounter(counterRule(LOCKED.rule, HONEST_CREATE.symbol, "kalshi:KXNFLGAME", { floorLamports: BigInt(6_666_667) }), {
  rulesSha256: LOCKED.sha256, attesters: [r().toBase58()], quorum: 1, admin: r().toBase58(), llPlatform: PLATFORM.toBase58(), endSink: null, pairVoidBy: 0, burnTargetKind: 0,
});

function cfgData(mint: string, creator: string): Buffer {
  const t = { defined: { name: "TokenConfig" } };
  const v = decodeType(BURN_RECEIPTS_IDL, t, Buffer.alloc(16_384)).value as Record<string, unknown>;
  v.version = 1; v.mint = new PublicKey(mint); v.creator = new PublicKey(creator); v.rules_sha256 = Buffer.from(CFG_EXP.rulesSha256, "hex"); v.registration_policy = 0;
  applyExpected(v, CFG_EXP);
  return Buffer.concat([accountDiscriminator(BURN_RECEIPTS_IDL, "TokenConfig"), encodeType(BURN_RECEIPTS_IDL, t, v)]);
}

/** The SDK's initialize_v2 for this mint and creator, honest unless `over` / `acct` change something. */
function createIx(mint: PublicKey, creator: PublicKey, over: Partial<CreateArgs> = {}, acct: { config?: PublicKey; pool?: PublicKey; quote?: PublicKey } = {}): TransactionInstruction {
  const a = { ...HONEST_CREATE, ...over };
  const curve = a.curve === "ConstantCurve" ? { type: "ConstantCurve" as const, totalSellA: new BN(a.totalSellA), migrateType: a.migrate, supply: new BN(a.supply), totalFundRaisingB: new BN(a.raise) } : { type: "FixedCurve" as const, migrateType: a.migrate, supply: new BN(a.supply), totalFundRaisingB: new BN(a.raise) };
  return initializeV2(LL, creator, feePda(PROGRAM, mint), acct.config ?? CONFIG, PLATFORM, r(), acct.pool ?? POOL, mint, acct.quote ?? new PublicKey(WSOL), r(), r(), r(), TOKEN_PROGRAM_ID,
    a.decimals, a.name, a.symbol, a.uri, curve, new BN(a.locked), new BN(a.cliff), new BN(a.unlock), a.feeOn as never);
}
const serialized = (ix: TransactionInstruction) => ({ programId: ix.programId.toBase58(), label: "LaunchLab: initialize_v2", keys: ix.keys.map((k) => ({ pubkey: k.pubkey.toBase58(), isSigner: k.isSigner, isWritable: k.isWritable })), dataBase64: Buffer.from(ix.data).toString("base64") });

/** A landed transaction: initialize_token (its slots) and the given create, signed by the creator and the mint. */
function landed(mint: PublicKey, creator: PublicKey, ll: TransactionInstruction) {
  const INIT = BURN_RECEIPTS_IDL.instructions.find((i) => i.name === "initialize_token")!;
  const keys: string[] = [];
  const at = (k: PublicKey | string) => { const s = typeof k === "string" ? k : k.toBase58(); let i = keys.indexOf(s); if (i < 0) { keys.push(s); i = keys.length - 1; } return i; };
  at(creator); at(mint);
  const filler = at(r());
  const initAccounts = INIT.accounts.map(() => filler);
  initAccounts[INIT.accounts.findIndex((x) => x.name === "creator")] = at(creator); initAccounts[INIT.accounts.findIndex((x) => x.name === "mint")] = at(mint);
  const llAccounts = ll.keys.map((k) => at(k.pubkey));
  return { blockTime: NOW / 1000, meta: { err: null, loadedAddresses: { writable: [], readonly: [] } },
    transaction: { message: { header: { numRequiredSignatures: 2 }, get staticAccountKeys() { return keys.map((k) => new PublicKey(k)); }, compiledInstructions: [
      { programIdIndex: at(PROGRAM), accountKeyIndexes: initAccounts, data: new Uint8Array(INIT.discriminator) },
      { programIdIndex: at(LL), accountKeyIndexes: llAccounts, data: new Uint8Array(ll.data) },
    ] } } };
}

/** One coin: its mint, creator, the stored create (what prepare records from the honest bundle) and a verifier over `ll` (the landed create). */
function coin() {
  const mint = Keypair.generate().publicKey, creator = Keypair.generate().publicKey;
  const stored = expectedCreateFromBundle([{ instructions: [serialized(createIx(mint, creator))] }], mint.toBase58());
  assert.ok(stored, "the bundle's own create decodes");
  const verifierFor = (ll: TransactionInstruction) => {
    const cfg = { owner: PROGRAM, data: cfgData(mint.toBase58(), creator.toBase58()) };
    const reader: TxReader = { getTransaction: async () => landed(mint, creator, ll) as never, getAccountInfo: async (k: PublicKey) => (k.equals(configPda(PROGRAM, mint)) ? cfg : null) };
    return connectionLaunchVerifier(reader, { burnProgramId: PROGRAM.toBase58(), launchLabProgramId: LL.toBase58() });
  };
  const expectWith = (launchCreate: ExpectedLaunchCreate | null | undefined): LaunchExpectation => ({ mint: mint.toBase58(), creator: creator.toBase58(), draftCreatedAtMs: NOW - 60_000, rulesSha: LOCKED.sha256, venue: { kind: "launchlab", platformId: PLATFORM.toBase58() }, config: { ...CFG_EXP, ...(launchCreate === undefined ? {} : { launchCreate }) } });
  return { mint, creator, stored: stored!, verifierFor, expectWith };
}

describe("B-1: the create the bundle encodes is what prepare stores", () => {
  test("expectedCreateFromBundle decodes the SDK's own initialize_v2: every argument and the venue accounts", () => {
    const { stored } = coin();
    assert.deepEqual({ ...stored }, {
      version: 1, decimals: 6, name: HONEST_CREATE.name, symbol: HONEST_CREATE.symbol, uri: HONEST_CREATE.uri, curveIndex: 0, supply: HONEST_CREATE.supply, totalSellA: HONEST_CREATE.totalSellA,
      totalFundRaisingB: HONEST_CREATE.raise, migrateType: 1, totalLockedAmount: "0", cliffPeriod: "0", unlockPeriod: "0", cpmmCreatorFeeOn: 0,
      globalConfig: CONFIG.toBase58(), platform: PLATFORM.toBase58(), poolId: POOL.toBase58(), quoteMint: WSOL,
    });
    assert.deepEqual(JSON.parse(JSON.stringify(stored)), stored, "JSON-safe");
  });
  test("the decoder reads the SDK's layout, and refuses short data or bytes left over", () => {
    const ix = createIx(r(), r(), { name: "Ünïcode name", raise: "40000000000", locked: "250000000000000", cliff: "0", unlock: "31536000" });
    const d = decodeInitializeV2(ix.data);
    assert.equal(d.name, "Ünïcode name"); assert.equal(d.totalFundRaisingB, BigInt(40_000_000_000)); assert.equal(d.totalLockedAmount, BigInt("250000000000000")); assert.equal(d.unlockPeriod, BigInt(31_536_000));
    assert.throws(() => decodeInitializeV2(ix.data.subarray(0, ix.data.length - 1)), /ends early/);
    assert.throws(() => decodeInitializeV2(Buffer.concat([ix.data, Buffer.from([0])])), /left over/);
  });
});

describe("B-1 at confirm: every argument of the create that landed is compared with the stored one", () => {
  test("the honest launch passes", async () => {
    const c = coin();
    assert.deepEqual(await c.verifierFor(createIx(c.mint, c.creator)).verify("s", c.expectWith(c.stored)), { ok: true, blockTimeMs: NOW });
  });

  const cases: [string, Partial<CreateArgs>, RegExp][] = [
    ["name", { name: "Burnticker official" }, /carries another name than this draft's/],
    ["symbol", { symbol: "DEFICIT" }, /carries another symbol than this draft's \(HONEST\)/],
    ["metadata address", { uri: "https://mutable.example/meta.json" }, /carries another metadata address/],
    ["decimals", { decimals: 9 }, /sets the decimals to 9; this draft builds 6/],
    ["supply", { supply: "999000000000000000" }, /sets the supply to 999000000000000000 raw units/],
    ["tokens sold on the curve", { totalSellA: "1" }, /sets the tokens sold on the curve to 1 raw units/],
    ["graduation raise", { raise: "1000000000" }, /sets the graduation raise to 1000000000 lamports; this draft builds 85000000000 lamports/],
    ["graduation venue", { migrate: "amm" }, /sets the graduation venue to 0; this draft builds 1/],
    ["locked amount", { locked: "1" }, /sets the locked amount to 1 raw units/],
    ["cliff", { cliff: "86400" }, /sets the cliff to 86400 seconds/],
    ["unlock period", { unlock: "86400" }, /sets the unlock period to 86400 seconds/],
    ["creator fee side", { feeOn: 1 }, /side the creator fee is taken on to 1/],
    ["curve type", { curve: "FixedCurve" }, /sets the curve type to 1; this draft builds 0/],
  ];
  for (const [name, over, re] of cases) {
    test(`one argument changed — ${name} — is refused (422, names it, plain copy)`, async () => {
      const c = coin();
      const v = await c.verifierFor(createIx(c.mint, c.creator, over)).verify("s", c.expectWith(c.stored));
      assert.equal(v.ok, false, name);
      if (v.ok) return;
      assert.equal(v.status, 422);
      assert.match(v.reason, re);
      assert.match(v.reason, /it is not this coin's launch$/);
      assert.equal(v.belongsToExpectedSigners, true, "the coin's own signers: the refusal takes the per-mint slot like any content refusal");
      assert.equal(lintCopy(v.reason).hits.length, 0, JSON.stringify(lintCopy(v.reason).hits));
      assert.doesNotMatch(v.reason, /DEFICIT|mutable\.example|Burnticker official/, "on-chain text is never echoed");
    });
  }
  const accounts: [string, { config?: PublicKey; pool?: PublicKey; quote?: PublicKey }, RegExp][] = [
    ["LaunchLab config", { config: r() }, /names another LaunchLab config/],
    ["curve pool", { pool: r() }, /names another curve pool/],
    ["quote mint", { quote: r() }, /quotes the coin in another token/],
  ];
  for (const [name, acct, re] of accounts) {
    test(`a venue account changed — ${name} — is refused`, async () => {
      const c = coin();
      const v = await c.verifierFor(createIx(c.mint, c.creator, {}, acct)).verify("s", c.expectWith(c.stored));
      assert.equal(v.ok, false); if (v.ok) return;
      assert.equal(v.status, 422); assert.match(v.reason, re);
      assert.equal(lintCopy(v.reason).hits.length, 0, JSON.stringify(lintCopy(v.reason).hits));
    });
  }
  test("arguments that do not decode are refused", async () => {
    const c = coin();
    const ix = createIx(c.mint, c.creator);
    ix.data = ix.data.subarray(0, 40);
    const v = await c.verifierFor(ix).verify("s", c.expectWith(c.stored));
    assert.equal(v.ok, false); assert.match(JSON.stringify(v), /arguments do not decode/);
  });
  test("with no create expectation at all, what every coin shares is still compared (decimals, supply, curve, venue, fee side, quote, raise bounds)", async () => {
    const c = coin();
    assert.equal((await c.verifierFor(createIx(c.mint, c.creator)).verify("s", c.expectWith(undefined))).ok, true, "the honest create passes");
    for (const [over, re] of [[{ decimals: 9 }, /decimals/], [{ supply: "5" }, /supply/], [{ migrate: "amm" as const }, /graduation venue/], [{ raise: "100000000000" }, /outside the 100000000 to 85000000000 lamports/], [{ raise: "1" }, /outside/], [{ feeOn: 1 }, /creator fee/]] as [Partial<CreateArgs>, RegExp][]) {
      const v = await c.verifierFor(createIx(c.mint, c.creator, over)).verify("s", c.expectWith(undefined));
      assert.equal(v.ok, false, JSON.stringify(over)); assert.match(JSON.stringify(v), re);
    }
  });
});

describe("B-1 fallback: a draft prepared before the create's arguments were stored", () => {
  /** A registry draft for the coin (no stored expectation), its token_meta pinned at HONEST_CREATE.uri, confirmed through markLaunched. */
  async function confirm(over: Partial<CreateArgs>, o: { cluster?: string; stored?: boolean } = {}) {
    limiter.reset();
    const c = coin();
    const reg = openRegistry(":memory:");
    reg.register({ mint: c.mint.toBase58(), ticker: HONEST_CREATE.symbol, name: `${HONEST_CREATE.name} `, creator: c.creator.toBase58(), description: "d", imageUrl: null, links: [], rulesText: LOCKED.text, feePda: "f", vault: null, tokenConfig: "c", poolId: POOL.toBase58(), launchTx: null, cluster: o.cluster ?? "devnet", platformId: PLATFORM.toBase58(), baselineAt: new Date(NOW).toISOString(), status: "draft" }, NOW - 60_000);
    reg.putTokenMeta({ mint: c.mint.toBase58(), creatorNote: "", metadataUri: HONEST_CREATE.uri, metadataTx: "tx", metadataSha256: "ab".repeat(32), imageUri: null, imageTx: null, imageSha256: null, hosted: false });
    // a draft prepared after F01 but before B-1: its TokenConfig expectation is stored, its create is not
    if (o.stored) reg.setStatus(expectedConfigKey(c.mint.toBase58()), JSON.stringify(CFG_EXP));
    const p = { registry: reg, launchVerifier: c.verifierFor(createIx(c.mint, c.creator, over)) } as unknown as Parameters<typeof markLaunched>[0];
    const res = await markLaunched(p, c.mint.toBase58(), "5".repeat(88), NOW + 1000, `b1-${Math.random()}`);
    return { res, status: reg.token(c.mint.toBase58())!.status };
  }
  test("the fallback rebuilds name, symbol, URI, supply, the curve split, the lock, the platform and the pool from the row and the recipe", () => {
    const fb = fallbackExpectedCreate({ name: " Honest ", ticker: "HONEST", poolId: POOL.toBase58(), platformId: PLATFORM.toBase58(), cluster: "mainnet" }, LOCKED, { metadataUri: HONEST_CREATE.uri, hosted: false });
    assert.equal(fb.fallback, true);
    assert.equal(fb.name, "Honest"); assert.equal(fb.symbol, "HONEST"); assert.equal(fb.uri, HONEST_CREATE.uri);
    assert.equal(fb.supply, HONEST_CREATE.supply); assert.equal(fb.totalSellA, HONEST_CREATE.totalSellA); assert.equal(fb.totalLockedAmount, "0");
    assert.equal(fb.poolId, POOL.toBase58()); assert.equal(fb.platform, PLATFORM.toBase58());
    assert.equal(fb.totalFundRaisingB, null, "the raise is not on the draft row");
    assert.deepEqual(fb.raise?.presetsLamports, ["24000000000", "40000000000", "60000000000", "85000000000"], "on mainnet only the presets");
    assert.equal(fallbackExpectedCreate({ name: "x", ticker: "X", poolId: null, platformId: null, cluster: "devnet" }, LOCKED, { metadataUri: "https://h", hosted: true }).uri, null, "a hosted devnet file is not compared");
  });
  test("the honest launch goes live (no expectation stored, and with only the TokenConfig's stored)", async () => {
    for (const stored of [false, true]) {
      const { res, status } = await confirm({}, { stored });
      assert.equal(res.status, 200, JSON.stringify(res.body)); assert.equal(status, "live");
    }
  });
  for (const [name, over, re] of [["supply", { supply: "2000000000000000" }, /supply/], ["symbol", { symbol: "DEFICIT" }, /symbol/], ["metadata address", { uri: "https://mutable.example/m.json" }, /metadata address/], ["name", { name: "Other" }, /name/], ["tokens sold", { totalSellA: "500000000000000" }, /tokens sold on the curve/]] as [string, Partial<CreateArgs>, RegExp][]) {
    test(`the fallback refuses a wrong ${name} (422, the draft stays a draft)`, async () => {
      for (const stored of [false, true]) {
        const { res, status } = await confirm(over, { stored });
        assert.equal(res.status, 422, JSON.stringify(res.body)); assert.match(JSON.stringify(res.body), re); assert.equal(status, "draft");
      }
    });
  }
  test("on mainnet the fallback refuses a raise that is not a preset; elsewhere a raise from 0.1 to 85 SOL passes", async () => {
    const main = await confirm({ raise: "1000000000" }, { cluster: "mainnet" });
    assert.equal(main.res.status, 422); assert.match(JSON.stringify(main.res.body), /not one of the raises this site builds on this network/);
    assert.equal((await confirm({ raise: "60000000000" }, { cluster: "mainnet" })).res.status, 200);
    assert.equal((await confirm({ raise: "1000000000" }, { cluster: "devnet" })).res.status, 200);
  });
});

describe("B-1 through the host: prepare stores the real bundle's create with the draft", () => {
  test("a prepare with the SDK's LaunchLab client stores launchCreate (the bundle's name, ticker, metadata address and raise)", async () => {
    const w = await makeWorld(); limiter.reset();
    const DEVNET_GLOBAL = { curveType: 0, index: 0, migrateFee: BigInt(0), tradeFeeRate: BigInt(2500), maxShareFeeRate: BigInt(10000), minSupplyA: BigInt(10_000_000), maxLockRate: BigInt(999_999), minSellRateA: BigInt(1), minMigrateRateA: BigInt(1), minFundRaisingB: BigInt(1), mintB: new PublicKey(WSOL) };
    const PLATFORM_VIEW = { feeRate: BigInt(7500), creatorFeeRate: BigInt(500), platformScale: BigInt(0), creatorScale: BigInt(100_000), burnScale: BigInt(900_000), cpConfigId: r(), platformCpCreator: PublicKey.default, platformClaimFeeWallet: r(), platformLockNftWallet: r(), platformVestingScale: BigInt(0), restrictCurveParam: 0, name: "Burnticker" };
    (w.p as { launchLab: unknown }).launchLab = new SdkLaunchLab({ cluster: "devnet", programId: LL, platformId: PLATFORM, configId: CONFIG, global: DEVNET_GLOBAL, platform: PLATFORM_VIEW });
    const mint = Keypair.generate().publicKey.toBase58();
    const res = await prepareLaunch(w.p, { creator: CREATOR, ticker: "STORED", name: "Stored create", rule: RULE, firstBuySol: "0", raiseSol: "40", acknowledgements: { ruleLocked: true, noReturns: true } }, { register: true, mint });
    assert.ok("ok" in res, JSON.stringify("error" in res ? res.error.body : res).slice(0, 400));
    const lc = loadExpectedConfig(w.registry, mint)?.launchCreate;
    assert.ok(lc, "the create's arguments are stored with the draft's expectation");
    assert.equal(lc!.fallback, undefined);
    assert.equal(lc!.symbol, "STORED"); assert.equal(lc!.name, "Stored create"); assert.equal(lc!.uri, res.ok.bundle.metadataUri);
    assert.equal(lc!.totalFundRaisingB, "40000000000"); assert.equal(lc!.supply, HONEST_CREATE.supply);
    assert.equal(lc!.platform, PLATFORM.toBase58()); assert.equal(lc!.globalConfig, CONFIG.toBase58()); assert.equal(lc!.poolId, res.ok.bundle.addresses.poolId);
  });
});
