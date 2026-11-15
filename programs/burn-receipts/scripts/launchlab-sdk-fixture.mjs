#!/usr/bin/env node
// Writes fixtures/launchlab-accounts-sdk.json too (review-2 F5): a LaunchLab LaunchpadPool and PlatformConfig ENCODED BY THE SDK's
// own layouts (src/raydium/launchpad/layout.ts) plus the SDK's offsetOf() for every field the program reads, so tests/launchlab.rs
// pins the program's byte offsets (constants.rs LL_*) to the SDK.
// Writes fixtures/launchlab-claim-sdk.json: the LaunchLab `claim_creator_fee` instruction exactly as Raydium's own SDK builds it
// (@raydium-io/raydium-sdk-v2, src/raydium/launchpad/instrument.ts claimCreatorFee + pda.ts) for the fee PDA of the deterministic
// test mint used by tests/launchlab.rs (ed25519 seed = 32 × 0x09). The LiteSVM test compares the program's on-chain CPI to this
// byte for byte (program id, account order, signer/writable flags, data). Re-run after the program id changes:
//   node programs/burn-receipts/scripts/launchlab-sdk-fixture.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);
const repo = path.resolve(here, "..", "..", "..");
const require = createRequire(path.join(repo, "package.json"));
const web3 = require("@solana/web3.js");
const sdk = require("@raydium-io/raydium-sdk-v2");
const sdkVersion = require("@raydium-io/raydium-sdk-v2/package.json").version;

const idlText = fs.readFileSync(path.join(repo, "src", "lib", "burnReceipts", "idl.ts"), "utf8");
const programId = new web3.PublicKey(JSON.parse(idlText.slice(idlText.indexOf("= {") + 2, idlText.lastIndexOf("};") + 1)).address);
const mint = web3.Keypair.fromSeed(new Uint8Array(32).fill(9)).publicKey;
const feePda = web3.PublicKey.findProgramAddressSync([Buffer.from("fee"), mint.toBuffer()], programId)[0];
const WSOL = new web3.PublicKey("So11111111111111111111111111111111111111112");
const TOKEN = new web3.PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ATA = new web3.PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const recipient = web3.PublicKey.findProgramAddressSync([feePda.toBuffer(), TOKEN.toBuffer(), WSOL.toBuffer()], ATA)[0];
const launchlab = sdk.LAUNCHPAD_PROGRAM;
const auth = sdk.getPdaCreatorFeeVaultAuth(launchlab).publicKey;
const vault = sdk.getPdaCreatorVault(launchlab, feePda, WSOL).publicKey;
const ix = sdk.claimCreatorFee(launchlab, feePda, auth, vault, recipient, WSOL, TOKEN);
const out = {
  source: `@raydium-io/raydium-sdk-v2 ${sdkVersion} claimCreatorFee (src/raydium/launchpad/instrument.ts)`,
  burnReceiptsProgramId: programId.toBase58(),
  mint: mint.toBase58(),
  feePda: feePda.toBase58(),
  programId: ix.programId.toBase58(),
  keys: ix.keys.map((k) => ({ pubkey: k.pubkey.toBase58(), isSigner: k.isSigner, isWritable: k.isWritable })),
  dataHex: Buffer.from(ix.data).toString("hex"),
};
const dst = path.join(here, "..", "fixtures", "launchlab-claim-sdk.json");
fs.mkdirSync(path.dirname(dst), { recursive: true });
fs.writeFileSync(dst, JSON.stringify(out, null, 2) + "\n");
console.log(`wrote ${path.relative(repo, dst)}`);

// ---- LaunchLab accounts, encoded by the SDK layouts ----
const BN = require("bn.js");
const platformId = web3.Keypair.fromSeed(new Uint8Array(32).fill(7)).publicKey;
const cpConfigId = web3.Keypair.fromSeed(new Uint8Array(32).fill(6)).publicKey;
const zeroKey = web3.PublicKey.default;
const n = (v) => new BN(v);
const vesting = { totalLockedAmount: n(0), cliffPeriod: n(0), unlockPeriod: n(0), startTime: n(0), totalAllocatedShare: n(0) };
const poolBuf = Buffer.alloc(sdk.LaunchpadPool.span);
sdk.LaunchpadPool.encode({
  epoch: n(1), bump: 255, status: 2, mintDecimalsA: 6, mintDecimalsB: 9, migrateType: 1,
  supply: n("1000000000000000"), totalSellA: n("793100000000000"), virtualA: n(1), virtualB: n(1), realA: n(1), realB: n(1),
  totalFundRaisingB: n("85000000000"), protocolFee: n(0), platformFee: n(0), migrateFee: n(0), vestingSchedule: vesting,
  configId: zeroKey, platformId, mintA: mint, mintB: WSOL, vaultA: zeroKey, vaultB: zeroKey, creator: feePda,
  mintProgramFlag: 0, cpmmCreatorFeeOn: 1, platformVestingShare: n(0),
}, poolBuf);
const platBuf = Buffer.alloc(sdk.PlatformConfig.span);
sdk.PlatformConfig.encode({
  epoch: n(1), platformClaimFeeWallet: zeroKey, platformLockNftWallet: zeroKey, platformScale: n(500000), creatorScale: n(400000), burnScale: n(100000),
  feeRate: n(0), name: Array(64).fill(0), web: Array(256).fill(0), img: Array(256).fill(0), cpConfigId, creatorFeeRate: n(0),
  transferFeeExtensionAuth: zeroKey, platformVestingWallet: zeroKey, platformVestingScale: n(0), platformCpCreator: zeroKey,
  restrictGlobalConfig: 0, restrictCurveParam: 0, curveRuleManager: zeroKey,
}, platBuf);
const accounts = {
  source: `@raydium-io/raydium-sdk-v2 ${sdkVersion} LaunchpadPool / PlatformConfig (src/raydium/launchpad/layout.ts)`,
  mint: mint.toBase58(), feePda: feePda.toBase58(), platformId: platformId.toBase58(), cpConfigId: cpConfigId.toBase58(),
  launchpadPoolPda: sdk.getPdaLaunchpadPoolId(launchlab, mint, WSOL).publicKey.toBase58(),
  pool: { span: sdk.LaunchpadPool.span, migrateType: 1, offsets: Object.fromEntries(["migrateType", "platformId", "mintA", "mintB", "creator"].map((k) => [k, sdk.LaunchpadPool.offsetOf(k)])), dataHex: poolBuf.toString("hex") },
  platform: { span: sdk.PlatformConfig.span, offsets: { cpConfigId: sdk.PlatformConfig.offsetOf("cpConfigId") }, dataHex: platBuf.toString("hex") },
};
const dst2 = path.join(here, "..", "fixtures", "launchlab-accounts-sdk.json");
fs.writeFileSync(dst2, JSON.stringify(accounts, null, 2) + "\n");
console.log(`wrote ${path.relative(repo, dst2)}`);
