// BURN KEEPER — THE LAUNCH PATH (2026-10-09): the keeper's hand-encoded LaunchLab instructions against the SDK's own builders byte for
// byte, the launch plan (vault math, the program's bounds, derived addresses, the first-buy quote), the fee split in bps per SOL, the
// platform-config dials and their caps, and the mainnet guard. No network.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";
import BN from "bn.js";
import { getCpmmPdaAmmConfigId } from "@raydium-io/raydium-sdk-v2";
import { claimCreatorFee as sdkClaimCreatorFee, claimVestedToken as sdkClaimVestedToken, getPdaCreatorFeeVaultAuth, getPdaCreatorVault, getPdaLaunchpadAuth, getPdaLaunchpadVaultId, getPdaVestId, getATAAddress, LaunchpadConfig, PlatformConfig, CpmmConfigInfoLayout, DEVNET_PROGRAM_ID, LAUNCHPAD_PROGRAM } from "@raydium-io/raydium-sdk-v2";
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, associatedTokenAddress, closeAccountIx, syncNativeIx } from "@/lib/burnKeeper/solana";
import { claimCreatorFeeIxs, claimVestedTokenIx, CPMM_PROGRAM_ID, LAUNCHLAB_PROGRAM, launchLabCreatorFeeVault, launchLabVault, WSOL_MINT } from "@/lib/burnKeeper/launchlab";
import { burnPoolFor } from "@/lib/burnKeeper/burnPool";
import { CPMM_DEVNET_TIER_0, CPMM_MAINNET_TIER_0, CPMM_MAINNET_TIER_9, CPMM_MAINNET_TIER_14, CPMM_PLATFORM_TIERS, CPMM_TIER, KNOWN_TIERS, tierForPin, type CpmmTier } from "@/lib/burnticker/cpmmTier";
import { BURN_POOL_POST_GRADUATION_BPS, CREATOR_FEE_TO_BURN_POOL_BPS, POST_GRADUATION_FEES, postGraduationBpsFor } from "@/lib/burnticker/fees";
import { buildCreateTx, buildPlatformTx, buildVestingTx, CPMM_PROGRAM, decodeAmmConfig, decodeGlobalConfig, decodePlatform, DEFAULT_PLATFORM, feeSplit, LAUNCHLAB_PROGRAM_SDK, launchRefusal, lpLockProblems, LP_LOCK_PLATFORM_SCALE_PPM, planLaunch, platformProblems, platformSiteRefusal, PLATFORM_SITE_UNSET, platformViewOf, ppmLamportsPerSol, ppmToBps, STANDARD_TOTAL_SELL_RAW, totalSellForLock, type AmmConfigView, type GlobalConfigView, type LaunchInput, type PlatformInput, type PlatformView } from "@/lib/burnKeeper/launch";

const same = (a: TransactionInstruction, b: TransactionInstruction) => {
  assert.equal(a.programId.toBase58(), b.programId.toBase58(), "program");
  assert.equal(Buffer.from(a.data).toString("hex"), Buffer.from(b.data).toString("hex"), "data bytes");
  assert.deepEqual(a.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable]), b.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable]), "accounts (order, signer, writable)");
};

describe("the keeper's hand-encoded LaunchLab instructions == the SDK's builders (0.2.74-alpha, pinned)", () => {
  const keeper = new PublicKey("Hcs3wmkaakwzzNFiXAgg1ECZHjeNy2yN5BbKKnMqfYFq"), mint = new PublicKey("AzJj4RcektGeKvGUM7hZ48sBHbqxQMWYELvtrnZfDTVk"), pool = new PublicKey("47ogzQY5ojEEtczR16hou2hQVpbJ1NE41nJMndCQ7jsP");
  for (const [label, program] of [["mainnet", LAUNCHLAB_PROGRAM.mainnet], ["devnet", LAUNCHLAB_PROGRAM.devnet]] as const) {
    test(`claim_vested_token on ${label}: identical bytes and accounts`, () => {
      const vault = associatedTokenAddress(keeper, mint);
      const ours = claimVestedTokenIx({ programId: program, beneficiary: keeper, poolId: pool, mintA: mint, beneficiaryTokenAccount: vault });
      const sdk = sdkClaimVestedToken(program, keeper, getPdaLaunchpadAuth(program).publicKey, pool, getPdaVestId(program, pool, keeper).publicKey, vault, getPdaLaunchpadVaultId(program, pool, mint).publicKey, mint, TOKEN_PROGRAM_ID);
      same(ours, sdk);
      assert.ok(launchLabVault(program, pool, mint).equals(getPdaLaunchpadVaultId(program, pool, mint).publicKey), "the pool_vault seed the keeper took from the CLMM module is LaunchLab's");
    });
    test(`claim_creator_fee on ${label}: identical bytes and accounts; WSOL ATA create and close around it`, () => {
      const [create, claim, close] = claimCreatorFeeIxs(program, keeper);
      const ata = getATAAddress(keeper, WSOL_MINT, TOKEN_PROGRAM_ID).publicKey;
      same(claim, sdkClaimCreatorFee(program, keeper, getPdaCreatorFeeVaultAuth(program).publicKey, getPdaCreatorVault(program, keeper, WSOL_MINT).publicKey, ata, WSOL_MINT, TOKEN_PROGRAM_ID));
      assert.ok(launchLabCreatorFeeVault(program, keeper, WSOL_MINT).equals(getPdaCreatorVault(program, keeper, WSOL_MINT).publicKey));
      assert.deepEqual([...create.data], [1]); assert.ok(create.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)); assert.ok(create.keys[1].pubkey.equals(ata));
      same(close, closeAccountIx(ata, keeper, keeper));
    });
  }
  test("program ids agree with the SDK's tables (LaunchLab and CPMM, both clusters)", () => {
    assert.ok(LAUNCHLAB_PROGRAM.mainnet.equals(LAUNCHPAD_PROGRAM) && LAUNCHLAB_PROGRAM.devnet.equals(DEVNET_PROGRAM_ID.LAUNCHPAD_PROGRAM));
    assert.ok(LAUNCHLAB_PROGRAM_SDK.mainnet.equals(LAUNCHLAB_PROGRAM.mainnet) && LAUNCHLAB_PROGRAM_SDK.devnet.equals(LAUNCHLAB_PROGRAM.devnet));
    assert.ok(CPMM_PROGRAM.mainnet.equals(CPMM_PROGRAM_ID.mainnet) && CPMM_PROGRAM.devnet.equals(CPMM_PROGRAM_ID.devnet));
    assert.equal(CPMM_PROGRAM_ID.mainnet.toBase58(), "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C");
    assert.deepEqual([...syncNativeIx(keeper).data], [17]);
  });
});

// Raydium's live configs as read on 2026-10-09 (scripts/_probe2 — mainnet SOL config 6s1xP3…, platform 4Bu96…, CPMM AmmConfig index 0 D4FPEru…).
export const MAINNET_GLOBAL: GlobalConfigView = { curveType: 0, index: 0, migrateFee: BigInt(0), tradeFeeRate: BigInt(2500), maxShareFeeRate: BigInt(10000), minSupplyA: BigInt(10_000_000), maxLockRate: BigInt(800_000), minSellRateA: BigInt(200_000), minMigrateRateA: BigInt(150_000), minFundRaisingB: BigInt(24_000_000_000), mintB: WSOL_MINT };
export const RAYDIUM_PLATFORM: PlatformView = { feeRate: BigInt(7500), creatorFeeRate: BigInt(500), platformScale: BigInt(0), creatorScale: BigInt(100_000), burnScale: BigInt(900_000), cpConfigId: new PublicKey(CPMM_MAINNET_TIER_0.id), platformCpCreator: PublicKey.default, platformClaimFeeWallet: new PublicKey("rayfqP1sEWfE1SJTSa5Z1szTW1hYpLWoBNwwPGRoJgV"), platformLockNftWallet: new PublicKey("RaysvGD275FiXmL6AhWo3ZPhR9GnpMRsRLUvHYKaY4P"), platformVestingScale: BigInt(0), restrictCurveParam: 0, name: "Raydium" };
export const AMM0: AmmConfigView = { index: 0, tradeFeeRate: BigInt(2500), protocolFeeRate: BigInt(120_000), fundFeeRate: BigInt(40_000), creatorFeeRate: BigInt(500), creatorFeeShareRate: BigInt(50_000), createPoolFee: BigInt(150_000_000) };
// Our platform's tier (owner decision 2026-10-12): mainnet AmmConfig index 9, from the one record (cpmmTier.ts).
const ammOf = (t: CpmmTier): AmmConfigView => ({ index: t.index, tradeFeeRate: BigInt(t.tradeFeeRate), protocolFeeRate: BigInt(t.protocolFeeRate), fundFeeRate: BigInt(t.fundFeeRate), creatorFeeRate: BigInt(t.creatorFeeRate), creatorFeeShareRate: BigInt(t.creatorFeeShareRate), createPoolFee: BigInt(150_000_000) });
export const AMM9: AmmConfigView = ammOf(CPMM_MAINNET_TIER_9);
// Owner decision 2026-10-19: new coins graduate into mainnet AmmConfig index 14 (read from mainnet that day: research/tmp/read-tier14.mts).
export const AMM14: AmmConfigView = ammOf(CPMM_MAINNET_TIER_14);
const DEVNET_GLOBAL: GlobalConfigView = { ...MAINNET_GLOBAL, maxLockRate: BigInt(999_999), minSellRateA: BigInt(1), minMigrateRateA: BigInt(1), minFundRaisingB: BigInt(1) };

// The creator is the burn program's fee PDA for the mint (review H-2); `keeper` below IS that PDA (named for the older tests' prose).
const payer = Keypair.generate().publicKey, mint = Keypair.generate().publicKey, BURN_PROGRAM = Keypair.generate().publicKey;
const keeper = burnPoolFor(BURN_PROGRAM, mint).feePda;
const input = (over: Partial<LaunchInput> = {}): LaunchInput => ({
  cluster: "mainnet", programId: LAUNCHLAB_PROGRAM.mainnet, platformId: DEFAULT_PLATFORM.mainnet, configId: new PublicKey("6s1xP3hpbAfFoNtUNF8mfHsjr2Bd97JxFJRWLbL6aHuX"), global: MAINNET_GLOBAL, platform: RAYDIUM_PLATFORM,
  payer, creator: keeper, mint, name: "DEFICIT", symbol: "DEFICIT", uri: "https://example.invalid/deficit.json", decimals: 6, supplyTokens: BigInt(1_000_000_000), raiseLamports: BigInt(85_000_000_000),
  lockedPercent: 0, cliffSeconds: BigInt(0), unlockSeconds: BigInt(0), firstBuyLamports: BigInt(0), slippageBps: 300, creatorFeeOn: "quote-only", ...over,
});

describe("the launch plan", () => {
  test("buyback mode: 1B supply, 6 decimals, LaunchLab's standard 793.1M curve and 85 SOL raise; no problems; addresses derived", () => {
    const p = planLaunch(input());
    assert.deepEqual(p.problems, []);
    assert.equal(p.supplyRaw, BigInt("1000000000000000"));
    assert.equal(p.totalSellRaw, STANDARD_TOTAL_SELL_RAW);
    assert.equal(p.totalLockedRaw, BigInt(0));
    assert.equal(p.migrateReserveRaw, BigInt("206900000000000"), "the rest of the supply seeds the CPMM pool");
    assert.ok(p.creatorFeeVault.equals(getPdaCreatorVault(LAUNCHLAB_PROGRAM.mainnet, keeper, WSOL_MINT).publicKey), "the creator-fee vault is the FEE PDA's (creator = the burn pool)");
    assert.equal(PublicKey.isOnCurve(keeper.toBytes()), false, "the creator is a PDA — recorded, never a signer");
    assert.ok(p.cpmm.expectedPoolCreator.equals(keeper), "Raydium's platform leaves platformCpCreator default → the CPMM pool creator is the launch creator = the fee PDA (what register_pool requires)");
    assert.ok(p.cpmm.ammConfig.equals(RAYDIUM_PLATFORM.cpConfigId));
    assert.ok(Buffer.compare(p.cpmm.token0.toBuffer(), p.cpmm.token1.toBuffer()) < 0, "CPMM mints in byte order");
    assert.equal(p.vestingRecord, null);
  });
  test("launch-intent audit 5 item 2: the metadata limits are UTF-8 bytes (32 for the name, 10 for the symbol); 32 bytes pass", () => {
    assert.ok(planLaunch(input({ name: "🌙".repeat(12) })).problems.includes("name must be at most 32 bytes of UTF-8 (token metadata)"));
    assert.deepEqual(planLaunch(input({ name: "é".repeat(16) })).problems, []);
    assert.ok(planLaunch(input({ symbol: "ÉÉÉÉÉÉ" })).problems.includes("symbol must be at most 10 bytes of UTF-8 (token metadata)"));
  });
  test("vault mode (25% locked on mainnet): totalSellA lowered to 60% so the 15% migration reserve holds; 20% and 30% also fit; 70% does not", () => {
    const p = planLaunch(input({ lockedPercent: 25, unlockSeconds: BigInt(365 * 86400) }));
    assert.deepEqual(p.problems, []);
    assert.equal(p.totalLockedRaw, BigInt("250000000000000"));
    assert.equal(p.totalSellRaw, BigInt("600000000000000"));
    assert.equal(p.migrateReserveRaw, BigInt("150000000000000"));
    assert.ok(p.vestingRecord!.equals(getPdaVestId(LAUNCHLAB_PROGRAM.mainnet, p.poolId, keeper).publicKey));
    for (const pct of [20, 30]) assert.deepEqual(planLaunch(input({ lockedPercent: pct, unlockSeconds: BigInt(86400) })).problems, [], `${pct}%`);
    const bad = planLaunch(input({ lockedPercent: 70, unlockSeconds: BigInt(86400) }));
    assert.ok(bad.problems.some((x) => /minSellRate/.test(x)), bad.problems.join("; "));
    assert.equal(totalSellForLock(BigInt(1_000_000), BigInt(0), BigInt(150_000)), BigInt(850_000), "a small supply with nothing locked: 85% on the curve");
  });
  test("the program's other bounds: decimals ≠ 6, a raise under the minimum, cliff without a lock, a lock with no schedule", () => {
    assert.match(planLaunch(input({ decimals: 9 })).problems.join(";"), /decimals must be 6/);
    assert.match(planLaunch(input({ raiseLamports: BigInt(1_000_000_000) })).problems.join(";"), /raise .* < config minimum/);
    assert.match(planLaunch(input({ cliffSeconds: BigInt(10) })).problems.join(";"), /nothing locked/);
    assert.match(planLaunch(input({ lockedPercent: 20 })).problems.join(";"), /needs a cliff or an unlock period/);
    assert.deepEqual(planLaunch(input({ cluster: "devnet", programId: LAUNCHLAB_PROGRAM.devnet, platformId: DEFAULT_PLATFORM.devnet, global: DEVNET_GLOBAL, raiseLamports: BigInt(1_000_000_000) })).problems, [], "devnet's loose config accepts a 1 SOL raise");
  });
  test("the first buy is quoted on the fresh curve through the SDK's Curve, fees split protocol/platform/creator, min out at the slippage", () => {
    const p = planLaunch(input({ firstBuyLamports: BigInt(1_000_000_000) }));
    assert.deepEqual(p.problems, []);
    const fb = p.firstBuy!;
    assert.equal(fb.lamports, BigInt(1_000_000_000));
    assert.ok(fb.quotedTokensRaw > BigInt(0) && fb.quotedTokensRaw < p.totalSellRaw);
    assert.equal(fb.minTokensRaw, (fb.quotedTokensRaw * BigInt(9700)) / BigInt(10000));
    // 1 SOL at 25 + 75 + 5 bps: fee = ceil(1e9 × 10500 / 1e6) = 10,500,000 lamports split pro rata
    assert.equal(fb.fee.protocol + fb.fee.platform + fb.fee.creator, BigInt(10_500_000));
    assert.equal(fb.fee.creator, BigInt(500_000), "5 bps of 1 SOL → the keeper's creator vault");
    assert.equal(fb.fee.platform, BigInt(7_500_000));
  });
  test("the create transaction: initialize_v2 from the SDK builder with creator = keeper NOT a signer, payer + mint the signers; cpmmCreatorFeeOn OnlyTokenB; the first buy wrapped and unwrapped", () => {
    const i = input({ firstBuyLamports: BigInt(500_000_000) }), p = planLaunch(i);
    const tx = buildCreateTx(i, p);
    assert.deepEqual(tx.signers, ["payer", "mint keypair"]);
    const init = tx.instructions[0];
    assert.equal(init.name, "LaunchLab initialize_v2");
    assert.equal(init.accounts.length, 18);
    assert.deepEqual(init.accounts[0], { role: "payer", pubkey: payer.toBase58(), signer: true, writable: true });
    assert.deepEqual(init.accounts[1], { role: "creator (recorded, not a signer)", pubkey: keeper.toBase58(), signer: false, writable: false });
    assert.deepEqual(init.accounts[6].pubkey, mint.toBase58()); assert.equal(init.accounts[6].signer, true);
    assert.equal(init.dataHex.slice(0, 16), "4399af27da102620", "initializeV2 discriminator");
    assert.equal(init.args.migrateType, "cpmm"); assert.equal(init.args.decimals, 6); assert.match(String(init.args.cpmmCreatorFeeOn), /OnlyTokenB/);
    // the last 25 bytes of the data: totalLockedAmount u64, cliff u64, unlock u64, cpmmCreatorFeeOn u8
    const data = Buffer.from(init.dataHex, "hex");
    assert.equal(data.readBigUInt64LE(data.length - 25), BigInt(0)); assert.equal(data[data.length - 1], 0);
    // migrateType byte sits just before those 25: 1 = cpmm
    assert.equal(data[data.length - 26], 1);
    assert.deepEqual(tx.instructions.map((x) => x.name), ["LaunchLab initialize_v2", "create payer WSOL account (idempotent)", "wrap SOL: transfer", "wrap SOL: sync_native", "create payer token account (idempotent)", "LaunchLab buy_exact_in (the first buy)", "unwrap: close WSOL account"]);
    const buy = tx.instructions[5];
    assert.equal(buy.accounts[16].pubkey, p.platformFeeVault.toBase58()); assert.equal(buy.accounts[17].pubkey, p.creatorFeeVault.toBase58());
    assert.equal(buy.dataHex.slice(0, 16), "faea0d7bd59c13ec", "buyExactIn discriminator");
    const noBuy = buildCreateTx(input(), planLaunch(input()));
    assert.equal(noBuy.instructions.length, 1);
    assert.equal(buildVestingTx(input(), planLaunch(input()), keeper), null, "buyback mode: no vesting transaction");
  });
  test("vault mode's second transaction: create_vesting_account for the WHOLE locked amount to the keeper, signed by the creator", () => {
    const i = input({ lockedPercent: 25, unlockSeconds: BigInt(365 * 86400) }), p = planLaunch(i);
    const tx = buildVestingTx(i, p, keeper)!;
    assert.deepEqual(tx.signers, ["creator"]);
    const ix = tx.instructions[0];
    assert.equal(ix.dataHex.slice(0, 16), "81b2020dd9ace6da", "createVestingAccount discriminator");
    assert.equal(Buffer.from(ix.dataHex, "hex").readBigUInt64LE(8), p.totalLockedRaw);
    assert.equal(ix.accounts[1].pubkey, keeper.toBase58());
  });
});

describe("the fee split (bps per 1 SOL of volume)", () => {
  test("ppm → bps and lamports: 2500 ppm = 25 bps = 2,500,000 lamports (0.0025 SOL) per SOL; 500 ppm = 5 bps", () => {
    assert.equal(ppmToBps(BigInt(2500)), 25); assert.equal(ppmLamportsPerSol(BigInt(2500)), "2500000"); assert.equal(ppmToBps(BigInt(500)), 5);
  });
  test("under Raydium's default platform: curve 25 Raydium + 75 Raydium-platform + 5 burn pool = 105 bps; after graduation burn pool 4.75 bps, Raydium's Fee Key 2.1 bps, 18.9 bps of LP fees unclaimable", () => {
    const s = feeSplit({ global: MAINNET_GLOBAL, platform: RAYDIUM_PLATFORM, amm: AMM0, creatorIsBurnPool: true });
    assert.equal(s.preGraduation.totalBps, 105);
    assert.deepEqual(s.preGraduation.legs.map((l) => l.bps), [25, 75, 5]);
    assert.match(s.preGraduation.legs[2].to, /burn pool/);
    assert.equal(s.postGraduation.totalBps, 30);
    const post = s.postGraduation.legs.map((l) => l.bps);
    assert.equal(post[0], 2.1, "10% of the LP share (84% of 25 bps) to Raydium's platform Fee Key");
    assert.equal(post[1], 18.9, "burned LP's share: nobody");
    assert.equal(post[2], 4, "12% + 4% of the 25 bps trade fee → Raydium");
    assert.equal(s.postGraduation.legs[3].bps, 4.75, "5 bps creator fee less the 5% protocol share");
    assert.match(s.postGraduation.legs[3].to, /burn pool/);
    assert.equal(s.postGraduation.legs[4].bps, 0.25);
  });
  test("when the creator is not the keeper, or the platform redirects platformCpCreator, the legs say so", () => {
    const s = feeSplit({ global: MAINNET_GLOBAL, platform: RAYDIUM_PLATFORM, amm: AMM0, creatorIsBurnPool: false });
    assert.match(s.preGraduation.legs[2].to, /NOT the burn pool/); assert.match(s.postGraduation.legs[3].to, /NOT the burn pool/);
    const other = Keypair.generate().publicKey;
    const r = feeSplit({ global: MAINNET_GLOBAL, platform: { ...RAYDIUM_PLATFORM, platformCpCreator: other }, amm: AMM0, creatorIsBurnPool: true });
    assert.match(r.postGraduation.legs[3].to, new RegExp(other.toBase58()));
  });
});

describe("the Burnticker platform config (the owner's dials)", () => {
  const admin = Keypair.generate().publicKey, feeWallet = Keypair.generate().publicKey;
  const P = (over: Partial<PlatformInput> = {}): PlatformInput => ({ programId: LAUNCHLAB_PROGRAM.mainnet, admin, claimFeeWallet: feeWallet, lockNftWallet: feeWallet, vestingWallet: feeWallet, cpConfigId: RAYDIUM_PLATFORM.cpConfigId, feeRatePpm: BigInt(2500), creatorFeeRatePpm: BigInt(5000), platformScalePpm: BigInt(0), name: "Burnticker", web: "https://burnticker.com", img: "https://burnticker.com/i.png", ...over });
  test("25 bps developer slice is exactly expressible (2,500 ppm); the burn-pool slot maxes at 50 bps; the caps refuse more", () => {
    assert.deepEqual(platformProblems(P()), []);
    // --web / --img are written on chain: a send needs both, explicitly, as https URLs; no burnticker.xyz / .example / placeholder default (those old values are refused).
    assert.equal(platformSiteRefusal({ send: false }), null, "a dry run may omit them");
    assert.equal(platformSiteRefusal({ send: true, web: "https://burnticker.com", img: "https://burnticker.com/icon.png" }), null);
    assert.match(platformSiteRefusal({ send: true })!, /--web and --img/);
    assert.match(platformSiteRefusal({ send: true, web: "https://burnticker.com" })!, /--img as an explicit https URL/);
    for (const bad of ["https://burnticker.xyz", "https://burnticker.example/i.png", PLATFORM_SITE_UNSET, "http://burnticker.com", "burnticker.com", ""]) assert.ok(platformSiteRefusal({ send: true, web: bad, img: "https://burnticker.com/icon.png" }), `refused: ${bad || "(empty)"}`);
    assert.match(platformProblems(P({ feeRatePpm: BigInt(50_001) })).join(";"), /500 bps cap/);
    assert.match(platformProblems(P({ creatorFeeRatePpm: BigInt(5_001) })).join(";"), /MAX_CREATOR_FEE_RATE/);
    assert.match(platformProblems(P({ claimFeeWallet: PublicKey.default })).join(";"), /BURNTICKER_FEE_WALLET/);
  });
  test("create_platform_config: the claim wallet is the developer wallet (a pubkey), creatorScale 0, burnScale = 1e6 − platformScale, platformCpCreator left default", () => {
    const { platformId, tx } = buildPlatformTx(P({ platformScalePpm: BigInt(100_000) }));
    assert.ok(platformId.equals(PublicKey.findProgramAddressSync([Buffer.from("platform_config"), admin.toBuffer()], LAUNCHLAB_PROGRAM.mainnet)[0]));
    const ix = tx.instructions[0];
    assert.equal(ix.dataHex.slice(0, 16), "b05ac4affd71dc14", "createPlatformConfig discriminator");
    assert.deepEqual(ix.accounts[0], { role: "platform admin (signer)", pubkey: admin.toBase58(), signer: true, writable: true });
    assert.equal(ix.accounts[1].pubkey, feeWallet.toBase58());
    assert.deepEqual([ix.args.feeRate, ix.args.creatorFeeRate, ix.args.platformScale, ix.args.creatorScale, ix.args.burnScale], ["2500", "5000", "100000", 0, "900000"]);
    const d = Buffer.from(ix.dataHex, "hex");
    assert.equal(d.readBigUInt64LE(8), BigInt(100_000)); assert.equal(d.readBigUInt64LE(16), BigInt(0)); assert.equal(d.readBigUInt64LE(24), BigInt(900_000)); assert.equal(d.readBigUInt64LE(32), BigInt(2500));
  });
  test("the CPMM tier record: tier 0 is the live AMM0 above; every id is the AmmConfig PDA of its index on its cluster's CPMM program", () => {
    assert.deepEqual(ammOf(CPMM_MAINNET_TIER_0), AMM0);
    for (const t of KNOWN_TIERS) assert.equal(getCpmmPdaAmmConfigId(CPMM_PROGRAM[t.cluster], t.index).publicKey.toBase58(), t.id, `${t.cluster} index ${t.index}`);
    assert.deepEqual(KNOWN_TIERS, [CPMM_MAINNET_TIER_0, CPMM_MAINNET_TIER_9, CPMM_MAINNET_TIER_14, CPMM_DEVNET_TIER_0]);
    // tier 14 as read from mainnet on 2026-10-19 (the owner's decision): trade 75 bps, creator 50 bps, protocol 12 %, fund 4 %, creator share 5 %
    assert.deepEqual(CPMM_MAINNET_TIER_14, { cluster: "mainnet", index: 14, id: "52MZUkNsRYzP4gn2mCaLTVtJQy2tpoF79hp5K1HhAxxX", tradeFeeRate: 7_500, protocolFeeRate: 120_000, fundFeeRate: 40_000, creatorFeeRate: 5_000, creatorFeeShareRate: 50_000 });
    assert.equal(CPMM_TIER.mainnet.id, "52MZUkNsRYzP4gn2mCaLTVtJQy2tpoF79hp5K1HhAxxX", "new coins: tier 14");
    assert.equal(CPMM_TIER.localnet, CPMM_TIER.mainnet, "localnet mirrors mainnet");
    assert.deepEqual(CPMM_PLATFORM_TIERS.mainnet.map((t) => t.index), [14], "tier 9 was dropped once the platform named tier 14 (2026-10-19)");
    // a coin's numbers come from the tier IT pinned: tier 9 and tier 0 coins keep theirs; no pin (or an unlisted id) = the new-coin tier
    assert.equal(tierForPin("mainnet", CPMM_MAINNET_TIER_9.id), CPMM_MAINNET_TIER_9);
    assert.equal(tierForPin("mainnet", CPMM_MAINNET_TIER_0.id), CPMM_MAINNET_TIER_0);
    assert.equal(tierForPin("mainnet", null), CPMM_MAINNET_TIER_14);
    assert.equal(tierForPin("mainnet", "11111111111111111111111111111111"), CPMM_MAINNET_TIER_14);
    assert.equal(tierForPin("mainnet", CPMM_DEVNET_TIER_0.id), CPMM_MAINNET_TIER_14, "a devnet id never describes a mainnet coin");
    assert.equal(tierForPin("devnet", CPMM_MAINNET_TIER_9.id), CPMM_DEVNET_TIER_0);
    assert.equal(CPMM_TIER.devnet.id, "5MxLgy9oPdTC3YgkiePHqr3EoCRD9uLVYRQS2ANAs7wy", "devnet keeps the rehearsal's pin (no creator-fee tier like index 9 there)");
  });
  test("under our platform (25 dev + 50 burn + 25 Raydium): 100 bps on the curve; after graduation on tier 9 the burn pool gets 71.25 bps of creator fee and the Fee Key 21 × platformScale", () => {
    const view = platformViewOf(P({ platformScalePpm: BigInt(1_000_000) }));
    const s = feeSplit({ global: MAINNET_GLOBAL, platform: view, amm: AMM9, creatorIsBurnPool: true });
    assert.equal(s.preGraduation.totalBps, 100);
    assert.deepEqual(s.preGraduation.legs.map((l) => l.bps), [25, 25, 50]);
    assert.equal(s.postGraduation.legs[0].bps, 21, "100% of the LP to the platform Fee Key: 84% of 25 bps");
    assert.equal(s.postGraduation.legs[1].bps, 0);
    assert.equal(s.postGraduation.legs[3].bps, postGraduationBpsFor("mainnet", CPMM_MAINNET_TIER_9.id).creatorToBurnPool, "75 bps creator fee less Raydium's 5%");
    const burnAll = feeSplit({ global: MAINNET_GLOBAL, platform: platformViewOf(P()), amm: AMM9, creatorIsBurnPool: true });
    assert.equal(burnAll.postGraduation.legs[0].bps, 0); assert.equal(burnAll.postGraduation.legs[1].bps, 21);
  });
  test("LP LOCKED FOREVER (2026-10-10) on tier 9 (2026-10-12): with the Fee Key at the burn program's fee-keys PDA the locked 21 bps split 16.8 burn pool / 4.2 operator; nothing burned", () => {
    const feeKeys = Keypair.generate().publicKey, treasury = Keypair.generate().publicKey;
    const s = feeSplit({ global: MAINNET_GLOBAL, platform: platformViewOf(P({ platformScalePpm: BigInt(1_000_000), lockNftWallet: feeKeys })), amm: AMM9, creatorIsBurnPool: true, feeKeysPda: feeKeys, operatorTreasury: treasury });
    const post = s.postGraduation.legs;
    assert.deepEqual(post.map((l) => l.bps), [16.8, 0, 4, 71.25, 3.75, 4.2]);
    assert.match(post[0].to, /burn pool \(80 %/); assert.match(post[0].to, new RegExp(feeKeys.toBase58()));
    assert.match(post[5].to, new RegExp(`operator treasury ${treasury.toBase58()}`));
    assert.equal(BigInt(post[0].lamportsPer1Sol) + BigInt(post[5].lamportsPer1Sol), BigInt(2_100_000), "21 bps of 1 SOL, every lamport accounted for");
    assert.equal(s.postGraduation.totalBps, 100, "traders pay 25 bps trade fee + 75 bps creator fee");
    // to the burn pool per swap after graduation: 16.8 (LP fees) + 71.25 (creator fee) = 88.05 bps; operator 4.2; Raydium 4 + 3.75 = 7.75
    assert.equal(Math.round((post[0].bps + post[3].bps) * 100) / 100, 88.05);
    assert.equal(Math.round((post[2].bps + post[4].bps) * 100) / 100, 7.75);
    // the keeper's split over the tier and the designed split (fees.ts) for a coin that pinned tier 9 agree leg for leg
    const b = postGraduationBpsFor("mainnet", CPMM_MAINNET_TIER_9.id);
    assert.deepEqual([post[0].bps, post[5].bps, post[3].bps, post[2].bps + post[4].bps, s.postGraduation.totalBps], [b.lpToBurnPool, b.lpToOperator, b.creatorToBurnPool, b.raydiumTotal, b.tradersPay]);
    assert.deepEqual([b.burnPoolTotal, b.lpToOperator, b.raydiumTotal, b.tradersPay], [88.05, 4.2, 7.75, 100]);
  });
  test("CPMM TIER 14 FOR NEW COINS (owner decision 2026-10-19): traders pay 125 bps; burn pool 50.4 + 47.5 = 97.90, operator 12.6 (20 % of the 63 bps LP share), Raydium 9 + 3 + 2.5 = 14.50", () => {
    const feeKeys = Keypair.generate().publicKey, treasury = Keypair.generate().publicKey;
    const s = feeSplit({ global: MAINNET_GLOBAL, platform: platformViewOf(P({ platformScalePpm: BigInt(1_000_000), lockNftWallet: feeKeys })), amm: AMM14, creatorIsBurnPool: true, feeKeysPda: feeKeys, operatorTreasury: treasury });
    const post = s.postGraduation.legs;
    assert.deepEqual(post.map((l) => l.bps), [50.4, 0, 12, 47.5, 2.5, 12.6]);
    assert.equal(BigInt(post[0].lamportsPer1Sol) + BigInt(post[5].lamportsPer1Sol), BigInt(6_300_000), "63 bps of 1 SOL, every lamport accounted for");
    assert.equal(s.postGraduation.totalBps, 125, "traders pay 75 bps trade fee + 50 bps creator fee");
    assert.equal(Math.round((post[0].bps + post[3].bps) * 100) / 100, 97.9);
    assert.equal(Math.round((post[2].bps + post[4].bps) * 100) / 100, 14.5);
    // the designed split for new coins (no pin) is tier 14 and agrees with the keeper's leg for leg
    const b = postGraduationBpsFor("mainnet");
    assert.deepEqual(b, postGraduationBpsFor("mainnet", CPMM_MAINNET_TIER_14.id));
    assert.deepEqual([post[0].bps, post[5].bps, post[3].bps, post[2].bps + post[4].bps, s.postGraduation.totalBps], [b.lpToBurnPool, b.lpToOperator, b.creatorToBurnPool, b.raydiumTotal, b.tradersPay]);
    assert.deepEqual([b.lpFees, b.lpToBurnPool, b.lpToOperator, b.creatorToBurnPool, b.creatorToRaydium, b.protocol, b.fund], [63, 50.4, 12.6, 47.5, 2.5, 9, 3]);
    assert.deepEqual([b.burnPoolTotal, b.lpToOperator, b.raydiumTotal, b.tradersPay], [BURN_POOL_POST_GRADUATION_BPS, 12.6, 14.5, 125]);
    assert.equal(BURN_POOL_POST_GRADUATION_BPS, 97.9); assert.equal(CREATOR_FEE_TO_BURN_POOL_BPS, 47.5);
    assert.equal(POST_GRADUATION_FEES.totalBps, 125);
    assert.equal(POST_GRADUATION_FEES.legs.reduce((a, l) => a + l.bps * 100, 0) / 100, 125, "the designed legs sum to what traders pay");
    // tier 0 (the earliest coin's pin) still reads its own numbers
    assert.deepEqual((({ burnPoolTotal, lpToOperator, raydiumTotal, tradersPay }) => [burnPoolTotal, lpToOperator, raydiumTotal, tradersPay])(postGraduationBpsFor("mainnet", CPMM_MAINNET_TIER_0.id)), [21.55, 4.2, 4.25, 30]);
  });
  test("lpLockProblems: 100 % to the Fee Key and the lock-NFT wallet at the fee-keys PDA, or the platform is refused", () => {
    const feeKeys = Keypair.generate().publicKey;
    assert.deepEqual(lpLockProblems(P({ platformScalePpm: LP_LOCK_PLATFORM_SCALE_PPM, lockNftWallet: feeKeys }), feeKeys), []);
    assert.match(lpLockProblems(P({ platformScalePpm: BigInt(0), lockNftWallet: feeKeys }), feeKeys).join(";"), /locks 100 %/);
    assert.match(lpLockProblems(P({ platformScalePpm: LP_LOCK_PLATFORM_SCALE_PPM }), feeKeys).join(";"), /not the burn program's fee-keys PDA/);
    const { tx } = buildPlatformTx(P({ platformScalePpm: LP_LOCK_PLATFORM_SCALE_PPM, lockNftWallet: feeKeys }));
    const ix = tx.instructions[0];
    assert.deepEqual([ix.args.platformScale, ix.args.creatorScale, ix.args.burnScale], ["1000000", 0, "0"]);
    assert.equal(ix.accounts[2].pubkey, feeKeys.toBase58());
    assert.match(ix.accounts[2].role, /fee-keys PDA/);
  });
});

describe("decoding the live configs through the SDK layouts", () => {
  test("round trip: encode with the SDK layout, decode with ours", () => {
    const g = Buffer.alloc(LaunchpadConfig.span); LaunchpadConfig.encode({ epoch: new BN(1), curveType: 0, index: 0, migrateFee: new BN(0), tradeFeeRate: new BN(2500), maxShareFeeRate: new BN(10000), minSupplyA: new BN(10_000_000), maxLockRate: new BN(800_000), minSellRateA: new BN(200_000), minMigrateRateA: new BN(150_000), minFundRaisingB: new BN(24_000_000_000), mintB: WSOL_MINT, protocolFeeOwner: PublicKey.default, migrateFeeOwner: PublicKey.default, migrateToAmmWallet: PublicKey.default, migrateToCpmmWallet: PublicKey.default } as never, g);
    assert.deepEqual(decodeGlobalConfig(g), MAINNET_GLOBAL);
    const p = Buffer.alloc(PlatformConfig.span); PlatformConfig.encode({ epoch: new BN(1), platformClaimFeeWallet: RAYDIUM_PLATFORM.platformClaimFeeWallet, platformLockNftWallet: RAYDIUM_PLATFORM.platformLockNftWallet, platformScale: new BN(0), creatorScale: new BN(100_000), burnScale: new BN(900_000), feeRate: new BN(7500), name: [...Buffer.from("Raydium".padEnd(64, "\0"))], web: new Array(256).fill(0), img: new Array(256).fill(0), cpConfigId: RAYDIUM_PLATFORM.cpConfigId, creatorFeeRate: new BN(500), transferFeeExtensionAuth: PublicKey.default, platformVestingWallet: PublicKey.default, platformVestingScale: new BN(0), platformCpCreator: PublicKey.default, restrictGlobalConfig: 0, restrictCurveParam: 0, curveRuleManager: PublicKey.default } as never, p);
    assert.equal(PlatformConfig.span, 944, "the account is a fixed 944 bytes");
    assert.deepEqual(decodePlatform(p), RAYDIUM_PLATFORM);
    const a = Buffer.alloc(CpmmConfigInfoLayout.span); CpmmConfigInfoLayout.encode({ bump: 1, disableCreatePool: false, index: 0, tradeFeeRate: new BN(2500), protocolFeeRate: new BN(120_000), fundFeeRate: new BN(40_000), createPoolFee: new BN(150_000_000), protocolOwner: PublicKey.default, fundOwner: PublicKey.default, creatorFeeRate: new BN(500), creatorFeeShareRate: new BN(50_000) } as never, a);
    assert.deepEqual(decodeAmmConfig(a), AMM0);
  });
});

describe("the mainnet guard", () => {
  test("a dry run may read either cluster; a mainnet SEND needs the flag AND BURNKEEPER_MAINNET=1; the --cluster flag must match the genesis", () => {
    assert.equal(launchRefusal({ cluster: "devnet", flagCluster: "devnet", dryRun: false, iUnderstand: false, env: {} }), null);
    assert.equal(launchRefusal({ cluster: "mainnet", flagCluster: "mainnet", dryRun: true, iUnderstand: false, env: {} }), null, "dry run reads mainnet");
    assert.match(launchRefusal({ cluster: "mainnet", flagCluster: "mainnet", dryRun: false, iUnderstand: false, env: {} })!, /neither is set/);
    assert.match(launchRefusal({ cluster: "mainnet", flagCluster: "mainnet", dryRun: false, iUnderstand: true, env: {} })!, /BURNKEEPER_MAINNET=1 is not set/);
    assert.match(launchRefusal({ cluster: "mainnet", flagCluster: "mainnet", dryRun: false, iUnderstand: false, env: { BURNKEEPER_MAINNET: "1" } })!, /--i-understand-this-spends-real-sol is not given/);
    assert.equal(launchRefusal({ cluster: "mainnet", flagCluster: "mainnet", dryRun: false, iUnderstand: true, env: { BURNKEEPER_MAINNET: "1" } }), null);
    assert.match(launchRefusal({ cluster: "mainnet", flagCluster: "devnet", dryRun: true, iUnderstand: true, env: { BURNKEEPER_MAINNET: "1" } })!, /--cluster devnet but the RPC is mainnet/);
    assert.match(launchRefusal({ cluster: "devnet", flagCluster: "mainnet", dryRun: true, iUnderstand: true, env: {} })!, /--cluster mainnet but the RPC is devnet/);
  });
});

// owner question 2026-10-12 ("are we planning on launching through the platform?"): the launch script's default platform on mainnet is
// Raydium's own, whose fees reach no burn pool. A mainnet --send without --platform or BURNTICKER_PLATFORM_ID is refused in the source.
test("a mainnet --send names the platform on purpose: no --platform and no BURNTICKER_PLATFORM_ID is refused", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync("scripts/burnkeeper-launch.mts", "utf8");
  assert.match(src, /if \(SEND && flagCluster === "mainnet" && !opt\("platform"\) && !process\S{5}BURNTICKER_PLATFORM_ID\) die\("refusing to --send on mainnet without --platform/);
  assert.match(src, /const platformId = pubkeyArg\(opt\("platform"\) \?\? process\S{5}BURNTICKER_PLATFORM_ID, "--platform"\) \?\? DEFAULT_PLATFORM\[flagCluster\];/);
});
