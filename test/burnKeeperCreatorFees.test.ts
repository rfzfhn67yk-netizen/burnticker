// BURN KEEPER — CREATOR FEES INTO THE BURN POOL (2026-10-09, after the blind review's H-2): the creator is the burn program's fee PDA.
// planGraduatedCreatorFeeClaim over synthetic LaunchLab / platform / CPMM accounts encoded with the SDK's own layouts: the claim is
// Raydium's collect_creator_fee_permissionless (the keeper pays, the fee PDA is the creator, the destinations are the fee PDA's ATAs)
// byte for byte against the SDK builder; the skips name their reason. Plus the program's claim_launchlab_creator_fee builder: a FAKE
// until the IDL carries the instruction, the IDL's own bytes once it does.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { CpmmPoolInfoLayout, LaunchpadPool, PlatformConfig, getCpmmPdaPoolId, getPdaPoolAuthority, getPdaVault, collectCreatorFeePermissionlessInInstruction, getPdaCreatorVault, getPdaCreatorFeeVaultAuth } from "@raydium-io/raydium-sdk-v2";
import { planGraduatedCreatorFeeClaim, type AccountReader } from "@/lib/burnKeeper/creatorFees";
import { burnPoolFor, burnProgramIdFromEnv, CLAIM_LAUNCHLAB_CREATOR_FEE, claimLaunchlabCreatorFeeDiscriminator, claimLaunchlabCreatorFeeIx, isLocalnetProgramId } from "@/lib/burnKeeper/burnPool";
import { CPMM_PROGRAM_ID, LAUNCHLAB_PROGRAM, launchLabPoolId, WSOL_MINT } from "@/lib/burnKeeper/launchlab";
import { associatedTokenAddress, TOKEN_PROGRAM_ID } from "@/lib/burnKeeper/solana";
import { BURN_RECEIPTS_LOCALNET_PROGRAM_ID, BURN_RECEIPTS_TEST_PROGRAM_ID, feePda, feeWsolAddress, feeTokenAddress } from "@/lib/burnReceipts";
import { BURN_RECEIPTS_IDL } from "@/lib/burnReceipts/idl";
import type { AnchorIdl } from "@/lib/burnReceipts/idlTypes";

const LL = LAUNCHLAB_PROGRAM.mainnet, CP = CPMM_PROGRAM_ID.mainnet;
const BURN = Keypair.generate().publicKey;   // a burn_receipts deployment id
const keeper = Keypair.generate().publicKey, mint = Keypair.generate().publicKey, platformId = Keypair.generate().publicKey, ammConfig = Keypair.generate().publicKey;
const pool = burnPoolFor(BURN, mint);
const FEE = pool.feePda;
const llPool = launchLabPoolId(LL, mint, WSOL_MINT);
const [t0, t1] = Buffer.compare(mint.toBuffer(), WSOL_MINT.toBuffer()) < 0 ? [mint, WSOL_MINT] : [WSOL_MINT, mint];
const cpPool = getCpmmPdaPoolId(CP, ammConfig, t0, t1).publicKey;

function llPoolData(o: { creator?: PublicKey; mintA?: PublicKey; status?: number } = {}): Buffer {
  const b = Buffer.alloc(LaunchpadPool.span);
  LaunchpadPool.encode({ epoch: new BN(1), bump: 1, status: o.status ?? 2, mintDecimalsA: 6, mintDecimalsB: 9, migrateType: 1, supply: new BN(0), totalSellA: new BN(0), virtualA: new BN(0), virtualB: new BN(0), realA: new BN(0), realB: new BN(0), totalFundRaisingB: new BN(0), protocolFee: new BN(0), platformFee: new BN(0), migrateFee: new BN(0),
    vestingSchedule: { totalLockedAmount: new BN(0), cliffPeriod: new BN(0), unlockPeriod: new BN(0), startTime: new BN(0), totalAllocatedShare: new BN(0) }, configId: PublicKey.default, platformId, mintA: o.mintA ?? mint, mintB: WSOL_MINT, vaultA: PublicKey.default, vaultB: PublicKey.default, creator: o.creator ?? FEE, mintProgramFlag: 0, cpmmCreatorFeeOn: 0, platformVestingShare: new BN(0) } as never, b);
  return b;
}
function platformData(cpCreator = PublicKey.default): Buffer {
  const b = Buffer.alloc(PlatformConfig.span);
  PlatformConfig.encode({ epoch: new BN(1), platformClaimFeeWallet: PublicKey.default, platformLockNftWallet: PublicKey.default, platformScale: new BN(0), creatorScale: new BN(0), burnScale: new BN(1_000_000), feeRate: new BN(2500), name: new Array(64).fill(0), web: new Array(256).fill(0), img: new Array(256).fill(0), cpConfigId: ammConfig, creatorFeeRate: new BN(5000), transferFeeExtensionAuth: PublicKey.default, platformVestingWallet: PublicKey.default, platformVestingScale: new BN(0), platformCpCreator: cpCreator, restrictGlobalConfig: 0, restrictCurveParam: 0, curveRuleManager: PublicKey.default } as never, b);
  return b;
}
function cpPoolData(o: { creator?: PublicKey; enable?: boolean; fees0?: bigint; fees1?: bigint; programA?: PublicKey } = {}): Buffer {
  const b = Buffer.alloc(CpmmPoolInfoLayout.span);
  CpmmPoolInfoLayout.encode({ configId: ammConfig, poolCreator: o.creator ?? FEE, vaultA: getPdaVault(CP, cpPool, t0).publicKey, vaultB: getPdaVault(CP, cpPool, t1).publicKey, mintLp: PublicKey.default, mintA: t0, mintB: t1, mintProgramA: o.programA ?? TOKEN_PROGRAM_ID, mintProgramB: TOKEN_PROGRAM_ID, observationId: PublicKey.default,
    bump: 1, status: 0, lpDecimals: 9, mintDecimalA: 6, mintDecimalB: 9, lpAmount: new BN(0), protocolFeesMintA: new BN(0), protocolFeesMintB: new BN(0), fundFeesMintA: new BN(0), fundFeesMintB: new BN(0), openTime: new BN(0), epoch: new BN(1), feeOn: 2, enableCreatorFee: o.enable ?? true, creatorFeesMintA: new BN((o.fees0 ?? BigInt(0)).toString()), creatorFeesMintB: new BN((o.fees1 ?? BigInt(0)).toString()) } as never, b);
  return b;
}
const reader = (accounts: Map<string, { data: Uint8Array; owner: PublicKey }>): AccountReader => ({ getAccount: async (k) => accounts.get(k.toBase58()) ?? null });
const solFees = { fees0: t0.equals(mint) ? BigInt(0) : BigInt(777), fees1: t1.equals(mint) ? BigInt(0) : BigInt(777) };
const world = (o: { ll?: Buffer | null; plat?: Buffer; cp?: Buffer | null } = {}) => {
  const m = new Map<string, { data: Uint8Array; owner: PublicKey }>();
  if (o.ll !== null) m.set(llPool.toBase58(), { data: o.ll ?? llPoolData(), owner: LL });
  m.set(platformId.toBase58(), { data: o.plat ?? platformData(), owner: LL });
  if (o.cp !== null) m.set(cpPool.toBase58(), { data: o.cp ?? cpPoolData(solFees), owner: CP });
  return reader(m);
};
const I = { payer: keeper, burnPool: FEE, mint, launchLabProgram: LL, cpmmProgram: CP };

describe("the burn pool is the fee PDA", () => {
  test("burnPoolFor derives the program's PDAs (fee, its WSOL and token ATAs, the config); the env reader; the localnet placeholder is recognised", () => {
    assert.ok(pool.feePda.equals(feePda(BURN, mint)) && pool.feeWsol.equals(feeWsolAddress(BURN, mint)) && pool.feeToken.equals(feeTokenAddress(BURN, mint)));
    assert.ok(pool.feePda.equals(PublicKey.findProgramAddressSync([Buffer.from("fee"), mint.toBuffer()], BURN)[0]));
    assert.equal(PublicKey.isOnCurve(pool.feePda.toBytes()), false, "a PDA: nobody holds its key");
    assert.equal(burnProgramIdFromEnv({}), null);
    assert.ok(burnProgramIdFromEnv({ BURNTICKER_PROGRAM_ID: BURN.toBase58() })!.equals(BURN));
    assert.equal(isLocalnetProgramId(BURN_RECEIPTS_TEST_PROGRAM_ID), true); assert.equal(isLocalnetProgramId(BURN), false);
    // after `anchor keys sync` the IDL's address is the REAL id: it must not count as the placeholder (devnet rehearsal 2026-10-10)
    assert.equal(isLocalnetProgramId(BURN_RECEIPTS_LOCALNET_PROGRAM_ID), BURN_RECEIPTS_LOCALNET_PROGRAM_ID.equals(BURN_RECEIPTS_TEST_PROGRAM_ID));
  });
});

describe("claimGraduatedCreatorFees: the plan (collect_creator_fee_permissionless, fee PDA = creator)", () => {
  test("graduated, creator = fee PDA, SOL accrued: ONE instruction, the SDK's permissionless builder byte for byte; the keeper only pays; destinations = the fee PDA's ATAs", async () => {
    const plan = await planGraduatedCreatorFeeClaim(I, world());
    assert.equal(plan.kind, "claim");
    if (plan.kind !== "claim") return;
    assert.ok(plan.poolId.equals(cpPool)); assert.ok(plan.ammConfig.equals(ammConfig));
    assert.deepEqual(plan.accrued, { sol: BigInt(777), token: BigInt(0) });
    assert.equal(plan.instructions.length, 1, "no ATA creates (init_if_needed by the program), no unwrap (the WSOL stays with the fee PDA)");
    const sdk = collectCreatorFeePermissionlessInInstruction(CP, keeper, FEE, getPdaPoolAuthority(CP).publicKey, cpPool, ammConfig, getPdaVault(CP, cpPool, t0).publicKey, getPdaVault(CP, cpPool, t1).publicKey, t0, t1, associatedTokenAddress(FEE, t0), associatedTokenAddress(FEE, t1), TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID);
    const ours = plan.instructions[0];
    assert.equal(Buffer.from(ours.data).toString("hex"), Buffer.from(sdk.data).toString("hex"));
    assert.equal(Buffer.from(ours.data).toString("hex"), "caca2253e27a91e5", "collect_creator_fee_permissionless discriminator, no arguments");
    assert.deepEqual(ours.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable]), sdk.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable]));
    assert.equal(ours.keys.length, 16);
    assert.ok(ours.keys[0].pubkey.equals(keeper) && ours.keys[0].isSigner && ours.keys[0].isWritable, "payer = the keeper");
    assert.ok(ours.keys[1].pubkey.equals(FEE) && !ours.keys[1].isSigner, "creator = the fee PDA, not a signer");
    assert.ok(plan.destinations.wsol.equals(pool.feeWsol) && plan.destinations.token.equals(pool.feeToken), "the program's fee_wsol / fee_tokens accounts");
    assert.ok(!ours.keys.some((k) => k.pubkey.equals(associatedTokenAddress(keeper, WSOL_MINT))), "nothing is addressed to the keeper's own accounts");
  });
  test("token-side fees (creatorFeeOn = BothToken) are collected too — into the fee PDA's token ATA, which the crank burns", async () => {
    const plan = await planGraduatedCreatorFeeClaim(I, world({ cp: cpPoolData({ fees0: BigInt(10), fees1: BigInt(20) }) }));
    assert.equal(plan.kind, "claim");
    if (plan.kind === "claim") assert.deepEqual(plan.accrued, t0.equals(mint) ? { token: BigInt(10), sol: BigInt(20) } : { token: BigInt(20), sol: BigInt(10) });
  });
  test("not graduated: no CPMM pool → skip, nothing to sign", async () => {
    const plan = await planGraduatedCreatorFeeClaim(I, world({ cp: null }));
    assert.equal(plan.kind, "skip"); if (plan.kind === "skip") assert.match(plan.why, /not graduated yet/);
  });
  test("skips with a reason: nothing accrued; creator fee disabled; CPMM pool_creator is someone else; a Token-2022 side", async () => {
    const a = await planGraduatedCreatorFeeClaim(I, world({ cp: cpPoolData() }));
    assert.equal(a.kind, "skip"); if (a.kind === "skip") { assert.match(a.why, /nothing accrued/); assert.ok(a.poolId!.equals(cpPool)); }
    const b = await planGraduatedCreatorFeeClaim(I, world({ cp: cpPoolData({ enable: false, fees1: BigInt(5) }) }));
    assert.equal(b.kind, "skip"); if (b.kind === "skip") assert.match(b.why, /enable_creator_fee = false/);
    const c = await planGraduatedCreatorFeeClaim(I, world({ cp: cpPoolData({ creator: keeper, fees1: BigInt(5) }) }));
    assert.equal(c.kind, "skip"); if (c.kind === "skip") assert.match(c.why, /pool_creator is .*, not the fee PDA/);
    const d = await planGraduatedCreatorFeeClaim(I, world({ cp: cpPoolData({ fees1: BigInt(5), programA: new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb") }) }));
    assert.equal(d.kind, "skip"); if (d.kind === "skip") assert.match(d.why, /Token-2022/);
  });
  test("skips before touching CPMM: the launch creator is the KEEPER (the H-2 mistake), the platform redirects platformCpCreator, another mint's pool, no LaunchLab pool", async () => {
    const a = await planGraduatedCreatorFeeClaim(I, world({ ll: llPoolData({ creator: keeper }) }));
    assert.equal(a.kind, "skip"); if (a.kind === "skip") assert.match(a.why, /launch creator is .*, not the burn pool's fee PDA .*H-2/);
    const other = Keypair.generate().publicKey;
    const b = await planGraduatedCreatorFeeClaim(I, world({ plat: platformData(other) }));
    assert.equal(b.kind, "skip"); if (b.kind === "skip") assert.match(b.why, new RegExp(`platformCpCreator ${other.toBase58()}`));
    const c = await planGraduatedCreatorFeeClaim(I, world({ ll: llPoolData({ mintA: Keypair.generate().publicKey }) }));
    assert.equal(c.kind, "skip"); if (c.kind === "skip") assert.match(c.why, /is for mint/);
    const d = await planGraduatedCreatorFeeClaim(I, world({ ll: null }));
    assert.equal(d.kind, "skip"); if (d.kind === "skip") assert.match(d.why, /not found/);
    const e = await planGraduatedCreatorFeeClaim(I, world({ plat: platformData(FEE) }));
    assert.equal(e.kind, "claim", "platformCpCreator set to the fee PDA itself is fine");
  });
});

describe("the program's claim_launchlab_creator_fee (curve creator fees → the fee PDA's WSOL ATA)", () => {
  test("the committed IDL carries it (2026-10-10): built from the IDL — its discriminator equals Anchor's global:<name>, the fee PDA's WSOL ATA is the only destination, source 'idl'", () => {
    assert.equal(BURN_RECEIPTS_IDL.instructions.some((i) => i.name === CLAIM_LAUNCHLAB_CREATOR_FEE), true, "the program branch landed the instruction; the builder must use the IDL");
    const c = claimLaunchlabCreatorFeeIx({ programId: BURN, payer: keeper, mint, launchLabProgram: LL });
    assert.equal(c.source, "idl");
    assert.ok(c.instruction.programId.equals(BURN));
    assert.equal(Buffer.from(c.instruction.data).toString("hex"), claimLaunchlabCreatorFeeDiscriminator().toString("hex"));
    const by = Object.fromEntries(c.accounts.map((a) => [a.role, a]));
    assert.equal(by.payer.signer, true, "the payer signs (it pays only the transaction fee; the IDL marks it signer-only)");
    assert.equal(by.fee_vault.pubkey, FEE.toBase58());
    assert.equal(by.fee_wsol.pubkey, pool.feeWsol.toBase58(), "the destination is the fee PDA's WSOL ATA — never a wallet");
    assert.equal(by.launchlab_creator_fee_vault.pubkey, getPdaCreatorVault(LL, FEE, WSOL_MINT).publicKey.toBase58(), "LaunchLab's [fee PDA, WSOL] vault");
    assert.equal(by.launchlab_vault_authority.pubkey, getPdaCreatorFeeVaultAuth(LL).publicKey.toBase58());
    assert.equal(by.launchlab_program.pubkey, LL.toBase58());
    assert.ok(!c.accounts.some((a) => a.pubkey === associatedTokenAddress(keeper, WSOL_MINT).toBase58()), "nothing addressed to the keeper");
  });
  test("without the instruction in the IDL (an older IDL): a FAKE with the same discriminator and the expected accounts, source 'fake' (never sent)", () => {
    const older: AnchorIdl = { ...BURN_RECEIPTS_IDL, instructions: BURN_RECEIPTS_IDL.instructions.filter((i) => i.name !== CLAIM_LAUNCHLAB_CREATOR_FEE) } as AnchorIdl;
    const c = claimLaunchlabCreatorFeeIx({ programId: BURN, payer: keeper, mint, launchLabProgram: LL, idl: older });
    assert.equal(c.source, "fake");
    assert.equal(Buffer.from(c.instruction.data).toString("hex"), claimLaunchlabCreatorFeeDiscriminator().toString("hex"));
    const by = Object.fromEntries(c.accounts.map((a) => [a.role, a]));
    assert.equal(by.fee_wsol.pubkey, pool.feeWsol.toBase58());
    assert.equal(by.creator_fee_vault.pubkey, getPdaCreatorVault(LL, FEE, WSOL_MINT).publicKey.toBase58());
  });
  test("a synthetic IDL: built from its discriminator, account order and flags, source 'idl'", () => {
    const idl: AnchorIdl = { ...BURN_RECEIPTS_IDL, instructions: [...BURN_RECEIPTS_IDL.instructions.filter((i) => i.name !== CLAIM_LAUNCHLAB_CREATOR_FEE), {
      name: CLAIM_LAUNCHLAB_CREATOR_FEE, discriminator: [1, 2, 3, 4, 5, 6, 7, 8],
      accounts: [{ name: "payer", signer: true, writable: true }, { name: "config" }, { name: "fee_vault", writable: true }, { name: "fee_wsol", writable: true }, { name: "launchlab_creator_fee_vault", writable: true }, { name: "launchlab_vault_authority" }, { name: "wsol_mint" }, { name: "launchlab_program" }, { name: "token_program" }, { name: "associated_token_program" }, { name: "system_program" }, { name: "event_authority" }, { name: "program" }],
      args: [],
    }] } as AnchorIdl;
    const c = claimLaunchlabCreatorFeeIx({ programId: BURN, payer: keeper, mint, launchLabProgram: LL, idl });
    assert.equal(c.source, "idl");
    assert.deepEqual([...c.instruction.data], [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.equal(c.instruction.keys.length, 13);
    assert.deepEqual(c.instruction.keys.map((k) => [k.isSigner, k.isWritable]).slice(0, 4), [[true, true], [false, false], [false, true], [false, true]]);
    // an IDL that names an account this builder does not know fails loudly instead of guessing
    const odd: AnchorIdl = { ...idl, instructions: idl.instructions.map((i) => (i.name === CLAIM_LAUNCHLAB_CREATOR_FEE ? { ...i, accounts: [...i.accounts, { name: "mystery" }] } : i)) } as AnchorIdl;
    assert.throws(() => claimLaunchlabCreatorFeeIx({ programId: BURN, payer: keeper, mint, launchLabProgram: LL, idl: odd }), /names account "mystery"/);
  });
});
