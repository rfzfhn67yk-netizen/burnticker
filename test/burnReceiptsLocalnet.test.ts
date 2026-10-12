import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { BURN_RECEIPTS_LOCALNET_PROGRAM_ID as PID, CPMM_PROGRAM_ID, LAUNCHLAB_PROGRAM_ID, LOCALNET_GENESIS_TAG, LOCK_CPMM_AUTHORITY, NATIVE_MINT, TOKEN_PROGRAM_ID } from "../src/lib/burnReceipts/constants.ts";
import { configPda, feePda, associatedTokenAddress, cpmmAuthority, launchlabPoolPda, vaultAddress } from "../src/lib/burnReceipts/pda.ts";
import { createAtaIdempotentIx, operatorAttester, initializePlatformIx, initializeTokenIx } from "../src/lib/burnReceipts/instructions.ts";
import { confirmByPolling, crankAll, crankNext, type ProgramContext, registerPool, submitAttestedReading } from "../src/lib/burnReceipts/crank.ts";
import { fetchReading, fetchTokenConfig } from "../src/lib/burnReceipts/accounts.ts";
import { memoFromChain } from "../src/lib/burnReceipts/memo.ts";
import type { RuleParams } from "../src/lib/burnReceipts/math.ts";
import { openLedger } from "../src/lib/burnKeeper/ledger.ts";
import { ingest, type KeeperCtx } from "../src/lib/burnKeeper/cycle.ts";
import { executeProgramPending, WAIT_RETRY_MS } from "../src/lib/burnKeeper/programChain.ts";
import { solanaProgramPort } from "../src/lib/burnKeeper/programAdapter.ts";
import { decideCosign, memoryJournal, type SignerDeps } from "../src/lib/burnticker/attesters/cosignSigner.ts";
import type { CosignRequest } from "../src/lib/burnticker/attesters/cosign.ts";
import { buildBurnsJson, buildStatus } from "../src/lib/burnKeeper/statusPage.ts";
import { rulesFromText, usdToCents, type LoadedRules } from "../src/lib/burnKeeper/rules.ts";
import type { DebtReading } from "../src/lib/burnKeeper/feeds/treasury.ts";

/**
 * END-TO-END ON A LOCAL VALIDATOR, through the TypeScript client only (the keeper's path): a fresh solana-test-validator loads
 * burn_receipts and the real Raydium CPMM (built from source), then init → attested readings → crank, in vault and buyback mode.
 *
 * Opt-in (it starts a validator): BURN_RECEIPTS_LOCALNET=1 npm test -- test/burnReceiptsLocalnet.test.ts
 * Needs: solana-test-validator on PATH (or ~/.local/share/solana/install/active_release/bin), `anchor build` output, and
 * programs/burn-receipts/fixtures/raydium_cp_swap.so (scripts/build-cpmm-fixture.sh). Nothing leaves 127.0.0.1.
 */

const RUN = process.env.BURN_RECEIPTS_LOCALNET === "1";
const ROOT = path.join(import.meta.dirname, "..", "programs", "burn-receipts");
// Review-3 I-1: the validator runs the `--features localnet` build (its signed messages bind the localnet tag, never mainnet's genesis;
// the client refuses to sign mainnet-bound messages off mainnet). Built by `anchor test` (scripts/test.sh) or:
//   cargo-build-sbf --manifest-path programs/burn-receipts/programs/burn_receipts/Cargo.toml --features localnet --sbf-out-dir programs/burn-receipts/target/deploy-localnet
const SO = path.join(ROOT, "target", "deploy-localnet", "burn_receipts.so");
// Re-check R3-6: only scripts/test.sh (`anchor test` in programs/burn-receipts) produces target/deploy-localnet — say so when skipping.
const BUILD_FIRST = "run `anchor test` (programs/burn-receipts/scripts/test.sh) first: it builds target/deploy-localnet/burn_receipts.so";
const SKIP: string | false = !RUN
  ? `set BURN_RECEIPTS_LOCALNET=1 to run (starts solana-test-validator); ${BUILD_FIRST}`
  : !fs.existsSync(SO)
    ? `target/deploy-localnet/burn_receipts.so is missing; ${BUILD_FIRST}`
    : false;
const CPMM_SO = path.join(ROOT, "fixtures", "raydium_cp_swap.so");
const CPMM = CPMM_PROGRAM_ID.localnet;
const B = BigInt;
const UNIT = B(100_000_000_000);
const TOKEN = B(1_000_000);
const TREASURY_URL = "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/debt_to_penny?sort=-record_date&page[size]=1";

// --- minimal SPL Token instructions (no @solana/spl-token dependency) ---------------------------------------------------------
const MINT_LEN = 82;
const ixInitMint2 = (mint: PublicKey, authority: PublicKey, decimals: number) =>
  new TransactionInstruction({ programId: TOKEN_PROGRAM_ID, keys: [{ pubkey: mint, isSigner: false, isWritable: true }], data: Buffer.concat([Buffer.from([20, decimals]), authority.toBuffer(), Buffer.from([0])]) });
const u64le = (v: bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(v); return b; };
const ixMintTo = (mint: PublicKey, to: PublicKey, authority: PublicKey, amount: bigint) =>
  new TransactionInstruction({ programId: TOKEN_PROGRAM_ID, keys: [{ pubkey: mint, isSigner: false, isWritable: true }, { pubkey: to, isSigner: false, isWritable: true }, { pubkey: authority, isSigner: true, isWritable: false }], data: Buffer.concat([Buffer.from([7]), u64le(amount)]) });
/** SetAuthority(MintTokens → none): the program only burns fixed-supply mints (review L-3). */
const ixRevokeMint = (mint: PublicKey, authority: PublicKey) =>
  new TransactionInstruction({ programId: TOKEN_PROGRAM_ID, keys: [{ pubkey: mint, isSigner: false, isWritable: true }, { pubkey: authority, isSigner: true, isWritable: false }], data: Buffer.from([6, 0, 0]) });
const ixSyncNative = (acc: PublicKey) => new TransactionInstruction({ programId: TOKEN_PROGRAM_ID, keys: [{ pubkey: acc, isSigner: false, isWritable: true }], data: Buffer.from([17]) });

function findBin(name: string): string {
  const local = path.join(os.homedir(), ".local", "share", "solana", "install", "active_release", "bin", name);
  return fs.existsSync(local) ? local : name;
}

let validator: ChildProcess | null = null;
let connection: Connection;
let payer: Keypair;
let ledger = "";
/** The program's upgrade authority on this validator — a throwaway TEST key generated per run. */
const upgradeAuthority = Keypair.generate();
/** The buyback tests' mints are deterministic, so LaunchLab's side of their migrations can be preloaded into the validator (review-2 F5). */
const BUYBACK_MINTS = [11, 13, 14].map((b) => Keypair.fromSeed(new Uint8Array(32).fill(b)));
const LL_PLATFORM = Keypair.fromSeed(new Uint8Array(32).fill(12)).publicKey;
const AMM0 = PublicKey.findProgramAddressSync([Buffer.from("amm_config"), Buffer.from([0, 0])], CPMM_PROGRAM_ID.localnet)[0];

/** LaunchLab's pool (["pool", mint, WSOL]: creator = fee PDA, platform, migrate type CPMM) and platform (cpConfigId = AmmConfig 0),
 * SDK layouts (programs/burn-receipts/fixtures/launchlab-accounts-sdk.json pins the offsets). LaunchLab's program itself is not
 * loaded: register_pool only reads these accounts. */
function launchlabAccountFiles(dir: string): string[] {
  const ll = LAUNCHLAB_PROGRAM_ID.localnet;
  const platformData = Buffer.alloc(944);
  AMM0.toBuffer().copy(platformData, 688);
  // LP lock/burn scales (platform, creator, burn; 10⁻⁶) — initialize_token pins them (review-3 M-3); platformCpCreator @800 stays unset.
  [500_000, 400_000, 100_000].forEach((v, i) => platformData.writeBigUInt64LE(BigInt(v), 80 + 8 * i));
  const accounts: [PublicKey, Buffer][] = [[LL_PLATFORM, platformData]];
  for (const m of BUYBACK_MINTS) {
    const poolData = Buffer.alloc(429);
    poolData[20] = 1;
    LL_PLATFORM.toBuffer().copy(poolData, 173);
    m.publicKey.toBuffer().copy(poolData, 205);
    NATIVE_MINT.toBuffer().copy(poolData, 237);
    feePda(PID, m.publicKey).toBuffer().copy(poolData, 333);
    accounts.push([launchlabPoolPda(ll, m.publicKey), poolData]);
  }
  const out: string[] = [];
  for (const [key, data] of accounts) {
    const f = path.join(dir, `launchlab-${key.toBase58()}-${process.pid}.json`);
    fs.writeFileSync(f, JSON.stringify({ pubkey: key.toBase58(), account: { lamports: 10_000_000, data: [data.toString("base64"), "base64"], owner: ll.toBase58(), executable: false, rentEpoch: 0, space: data.length } }));
    out.push("--account", key.toBase58(), f);
  }
  return out;
}

// Polling confirmation only: no websocket is ever opened, so nothing keeps the process alive after the validator stops.
async function send(ixs: TransactionInstruction[], signers: Keypair[]): Promise<string> {
  const tx = new Transaction().add(...ixs);
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = signers[0].publicKey;
  tx.sign(...signers);
  const sig = await connection.sendRawTransaction(tx.serialize());
  const err = await confirmByPolling(connection, sig, lastValidBlockHeight, 200);
  if (err) throw new Error(`transaction failed: ${JSON.stringify(err)}`);
  return sig;
}
async function airdrop(to: PublicKey, sol: number) {
  const { lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const sig = await connection.requestAirdrop(to, sol * LAMPORTS_PER_SOL);
  await confirmByPolling(connection, sig, lastValidBlockHeight + 300, 200);
}
async function createMint(mint: Keypair, authority: PublicKey) {
  const rent = await connection.getMinimumBalanceForRentExemption(MINT_LEN);
  await send([SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: mint.publicKey, lamports: rent, space: MINT_LEN, programId: TOKEN_PROGRAM_ID }), ixInitMint2(mint.publicKey, authority, 6)], [payer, mint]);
}
async function ata(owner: PublicKey, mint: PublicKey): Promise<PublicKey> {
  const a = associatedTokenAddress(owner, mint);
  await send([createAtaIdempotentIx({ payer: payer.publicKey, owner, mint, ata: a })], [payer]);
  return a;
}
async function tokenAmount(acc: PublicKey): Promise<bigint> {
  return B((await connection.getTokenAccountBalance(acc, "confirmed")).value.amount);
}
async function supply(mint: PublicKey): Promise<bigint> {
  return B((await connection.getTokenSupply(mint, "confirmed")).value.amount);
}

function rule(over: Partial<RuleParams>): RuleParams {
  return {
    mode: 0, carry_rule: 0, pool_policy: 0, value_decimals: 2, unit_value: UNIT, max_abs_delta: B("200000000000000"), fraction_per_unit_bps: 500, slippage_bps: 300,
    max_twap_deviation_bps: 300, twap_window_secs: 600, floor_lamports: B(1_000_000), reserve_lamports: B(20_000_000), tokens_per_unit: B(0), vault_allocation: B(0), ...over,
  };
}

async function initToken(mint: Keypair, attester: Keypair | Keypair[], r: RuleParams, rulesSha256: Uint8Array = new Uint8Array(32).fill(0xab), quorum = 1) {
  const attesters = (Array.isArray(attester) ? attester : [attester]).map((k) => operatorAttester(k.publicKey));
  // Buyback + policy 0 pins the (preloaded) LaunchLab platform at init (review-3 M-3).
  const launchlabPlatform = r.mode === 0 && r.pool_policy === 0 ? LL_PLATFORM : undefined;
  await send([initializeTokenIx({ programId: PID, payer: payer.publicKey, creator: payer.publicKey, mint: mint.publicKey, launchlabPlatform, args: {
    feed_id: "treasury.debt_to_penny", memo_prefix: "DEBT", memo_source: "fiscaldata.treasury.gov debt_to_penny", rules_sha256: rulesSha256, rule: r,
    attesters, quorum, fixed_pool: PublicKey.default, admin: payer.publicKey,
  } })], [payer, mint]);
}


/** The CPMM fixture's compiled-in TEST admin. */
const cpmmAdmin = Keypair.fromSeed(new Uint8Array(32).fill(42));
let ammConfigReady = false;

/**
 * A real Raydium CPMM pool (85 SOL + 800M tokens) whose pool_creator is the FEE PDA — what LaunchLab's migration produces when the
 * launch creator is the fee PDA. Creates AmmConfig 0 once per validator, then a permission for `launcher`, then the pool.
 */
async function createFeePdaPool(mint: Keypair, fee: PublicKey, launcher: Keypair, admin = cpmmAdmin): Promise<PublicKey> {
  // AmmConfig 0 (0.25 % trade fee, 0.1 % creator fee) and a permission for the launcher — what Raydium's admin does for LaunchLab.
  const disc = (hex: string) => Buffer.from(hex, "hex");
  const amm = AMM0;
  const cfgData = Buffer.concat([disc("8934edd4d7756c68"), Buffer.from([0, 0]), u64le(B(2500)), u64le(B(120000)), u64le(B(40000)), u64le(B(0)), u64le(B(1000))]);
  if (!ammConfigReady) {
    await airdrop(admin.publicKey, 10);
    await send([new TransactionInstruction({ programId: CPMM, keys: [{ pubkey: admin.publicKey, isSigner: true, isWritable: true }, { pubkey: amm, isSigner: false, isWritable: true }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }], data: cfgData })], [payer, admin]);
    ammConfigReady = true;
  }
  const permission = PublicKey.findProgramAddressSync([Buffer.from("permission"), launcher.publicKey.toBuffer()], CPMM)[0];
  await send([new TransactionInstruction({ programId: CPMM, keys: [{ pubkey: admin.publicKey, isSigner: true, isWritable: true }, { pubkey: launcher.publicKey, isSigner: false, isWritable: false }, { pubkey: permission, isSigner: false, isWritable: true }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }], data: disc("878802d889a9b5ca") })], [payer, admin]);

  // The launcher's liquidity: 85 SOL (wrapped) + 800M tokens.
  const lTok = associatedTokenAddress(launcher.publicKey, mint.publicKey);
  const lWsol = associatedTokenAddress(launcher.publicKey, NATIVE_MINT);
  await send([createAtaIdempotentIx({ payer: payer.publicKey, owner: launcher.publicKey, mint: mint.publicKey, ata: lTok }), createAtaIdempotentIx({ payer: payer.publicKey, owner: launcher.publicKey, mint: NATIVE_MINT, ata: lWsol }), ixMintTo(mint.publicKey, lTok, payer.publicKey, B(800_000_000) * TOKEN)], [payer]);
  await send([SystemProgram.transfer({ fromPubkey: launcher.publicKey, toPubkey: lWsol, lamports: 85 * LAMPORTS_PER_SOL }), ixSyncNative(lWsol)], [launcher]);
  const wsol0 = Buffer.compare(NATIVE_MINT.toBuffer(), mint.publicKey.toBuffer()) < 0;
  const [t0, t1] = wsol0 ? [NATIVE_MINT, mint.publicKey] : [mint.publicKey, NATIVE_MINT];
  const [a0, a1] = wsol0 ? [B(85) * B(LAMPORTS_PER_SOL), B(800_000_000) * TOKEN] : [B(800_000_000) * TOKEN, B(85) * B(LAMPORTS_PER_SOL)];
  const [s0, s1] = wsol0 ? [lWsol, lTok] : [lTok, lWsol];
  const pda = (...seeds: Buffer[]) => PublicKey.findProgramAddressSync(seeds, CPMM)[0];
  const pool = pda(Buffer.from("pool"), amm.toBuffer(), t0.toBuffer(), t1.toBuffer());
  const lp = pda(Buffer.from("pool_lp_mint"), pool.toBuffer());
  const k = (pubkey: PublicKey, isWritable = false, isSigner = false) => ({ pubkey, isWritable, isSigner });
  await send([new TransactionInstruction({ programId: CPMM, data: Buffer.concat([disc("3f37fe4131b25979"), u64le(a0), u64le(a1), u64le(B(0)), Buffer.from([0])]), keys: [
    k(launcher.publicKey, true, true), k(fee), k(amm), k(cpmmAuthority(CPMM)), k(pool, true), k(t0), k(t1), k(lp, true), k(s0, true), k(s1, true),
    k(associatedTokenAddress(launcher.publicKey, lp), true), k(pda(Buffer.from("pool_vault"), pool.toBuffer(), t0.toBuffer()), true), k(pda(Buffer.from("pool_vault"), pool.toBuffer(), t1.toBuffer()), true),
    k(new PublicKey("DNXgeM9EiiaAbaWvwjHj9fQQLAX5ZsfHyvmYUNRAdNC8"), true), k(pda(Buffer.from("observation"), pool.toBuffer()), true), k(permission),
    k(TOKEN_PROGRAM_ID), k(TOKEN_PROGRAM_ID), k(TOKEN_PROGRAM_ID), k(new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL")), k(SystemProgram.programId),
  ] })], [launcher]);

  // LaunchLab's migration locks the LP (Burn & Earn): move all of it to Raydium's LP-lock account (review-2 F5: register_pool needs
  // ≥ 90 % of the LP burned or locked).
  const lpLock = await ata(LOCK_CPMM_AUTHORITY.localnet, lp);
  const lpSrc = associatedTokenAddress(launcher.publicKey, lp);
  const lpAmount = await tokenAmount(lpSrc);
  await send([new TransactionInstruction({ programId: TOKEN_PROGRAM_ID, keys: [{ pubkey: lpSrc, isSigner: false, isWritable: true }, { pubkey: lpLock, isSigner: false, isWritable: true }, { pubkey: launcher.publicKey, isSigner: true, isWritable: false }], data: Buffer.concat([Buffer.from([3]), u64le(lpAmount)]) })], [launcher]);
  return pool;
}

describe("burn_receipts on a local validator (TypeScript client end to end)", { skip: SKIP }, () => {
  before(async () => {
    for (const f of [SO, CPMM_SO]) if (!fs.existsSync(f)) throw new Error(`missing ${f} (anchor test builds both — scripts/test.sh)`);
    ledger = fs.mkdtempSync(path.join(os.tmpdir(), "burn-receipts-ledger-"));
    // The create-pool-fee receiver CPMM insists on (a WSOL token account at Raydium's hard-coded address; the fee is 0).
    const feeAcc = Buffer.alloc(165);
    NATIVE_MINT.toBuffer().copy(feeAcc, 0);
    Keypair.generate().publicKey.toBuffer().copy(feeAcc, 32);
    feeAcc[108] = 1; // state = Initialized
    feeAcc.writeUInt32LE(1, 109); // is_native: Some
    feeAcc.writeBigUInt64LE(B(2_039_280), 113);
    const feeJson = path.join(ledger, "..", `cpmm-fee-receiver-${process.pid}.json`);
    fs.writeFileSync(feeJson, JSON.stringify({ pubkey: "DNXgeM9EiiaAbaWvwjHj9fQQLAX5ZsfHyvmYUNRAdNC8", account: { lamports: 2_039_280, data: [feeAcc.toString("base64"), "base64"], owner: TOKEN_PROGRAM_ID.toBase58(), executable: false, rentEpoch: 0, space: 165 } }));
    const port = 18_000 + Math.floor(Math.random() * 2_000) * 4;
    validator = spawn(findBin("solana-test-validator"), [
      "--reset", "--quiet", "--ledger", ledger, "--bind-address", "127.0.0.1", "--rpc-port", String(port), "--faucet-port", String(port + 2), "--gossip-port", String(port + 3),
      "--dynamic-port-range", `${port + 10}-${port + 40}`,
      "--upgradeable-program", PID.toBase58(), SO, upgradeAuthority.publicKey.toBase58(), "--bpf-program", CPMM.toBase58(), CPMM_SO, "--account", "DNXgeM9EiiaAbaWvwjHj9fQQLAX5ZsfHyvmYUNRAdNC8", feeJson,
      ...launchlabAccountFiles(path.join(ledger, "..")),
    ], { stdio: "ignore" });
    connection = new Connection(`http://127.0.0.1:${port}`, { commitment: "confirmed" });
    const t0 = Date.now();
    for (;;) {
      try { await connection.getSlot(); break; } catch { /* starting */ }
      if (Date.now() - t0 > 90_000) throw new Error("validator did not start");
      await new Promise((r) => setTimeout(r, 500));
    }
    payer = Keypair.generate();
    await airdrop(payer.publicKey, 500);
  });
  after(() => {
    validator?.kill("SIGINT");
    if (ledger) fs.rmSync(ledger, { recursive: true, force: true });
  });

  test("vault mode: init before the mint exists → attested readings → crankAll burns, carries the shortfall, writes memo v1", async () => {
    const mint = Keypair.generate(), attester = Keypair.generate();
    const ctx: ProgramContext = { connection, programId: PID, mint: mint.publicKey, cluster: "localnet" };
    await initToken(mint, attester, rule({ mode: 1, fraction_per_unit_bps: 0, slippage_bps: 0, max_twap_deviation_bps: 0, twap_window_secs: 0, floor_lamports: B(0), reserve_lamports: B(0), tokens_per_unit: B(100_000) * TOKEN }));
    await createMint(mint, payer.publicKey);
    const vault = await ata(configPda(PID, mint.publicKey), mint.publicKey);
    assert.ok(vault.equals(vaultAddress(PID, mint.publicKey)));
    await send([ixMintTo(mint.publicKey, vault, payer.publicKey, B(1_500_000) * TOKEN), ixRevokeMint(mint.publicKey, payer.publicKey)], [payer]);
    const att = [{ publicKey: attester.publicKey, secretKey: attester.secretKey }];
    const V1 = B("4027300000000000");
    assert.equal((await submitAttestedReading(ctx, { payer, recordDate: 20260901, value: V1, attesters: att, sourceUrl: TREASURY_URL })).status, "submitted");
    assert.equal((await submitAttestedReading(ctx, { payer, recordDate: 20260902, value: V1 + B(21) * UNIT, attesters: att, sourceUrl: TREASURY_URL })).status, "submitted");
    // A reading signed by a stranger is refused (the simulation names the error).
    const bad = await submitAttestedReading(ctx, { payer, recordDate: 20260903, value: V1 + B(22) * UNIT, attesters: [{ publicKey: payer.publicKey, secretKey: payer.secretKey }], sourceUrl: TREASURY_URL });
    assert.deepEqual([bad.status, bad.error], ["refused", "QuorumNotMet"]);

    const supply0 = await supply(mint.publicKey);
    const res = await crankAll(ctx, payer);
    assert.equal(res[0].status, "processed");
    if (res[0].status !== "processed") return;
    assert.equal(res[0].outcome, "short");
    assert.match(res[0].memo ?? "", /\|units=21\|burn=1500000\|short=600000\|rules=sha256:abababababab\|v1$/);
    assert.equal(res[1].status, "idle");
    assert.equal(await supply(mint.publicKey), supply0 - B(1_500_000) * TOKEN);
    const cfg = (await fetchTokenConfig(connection, PID, mint.publicKey))!.config;
    const reading = (await fetchReading(connection, PID, configPda(PID, mint.publicKey), 20260902))!;
    assert.equal(memoFromChain(cfg, reading, 6), res[0].memo, "the memo is reproducible from the accounts");
    assert.equal(cfg.shortfall, B(600_000) * TOKEN);
    assert.equal(cfg.cluster_genesis.toBase58(), LOCALNET_GENESIS_TAG, "the localnet build binds its own tag (review-3 I-1)");
  });

  test("buyback mode: LaunchLab-shaped migration (CPMM pool, creator = fee PDA, LP locked) → register → crank defers until the pool has TWAP history", async () => {
    const mint = BUYBACK_MINTS[0], attester = Keypair.generate(), launcher = Keypair.generate();
    const ctx: ProgramContext = { connection, programId: PID, mint: mint.publicKey, cluster: "localnet" };
    await airdrop(launcher.publicKey, 200);
    // The platform config (burn-pool cap 25 SOL, sunset in 30 days), created by the upgrade authority.
    await airdrop(upgradeAuthority.publicKey, 1);
    await send([initializePlatformIx({ programId: PID, payer: payer.publicKey, upgradeAuthority: upgradeAuthority.publicKey, authority: payer.publicKey, burnPoolCapLamports: B(25_000_000_000), capSunsetTs: B(Math.floor(Date.now() / 1000) + 30 * 86_400) })], [payer, upgradeAuthority]);
    await initToken(mint, attester, rule({}));
    await createMint(mint, payer.publicKey);
    const fee = feePda(PID, mint.publicKey);

    const pool = await createFeePdaPool(mint, fee, launcher);

    // Creator-fee tokens for the fee PDA, then the mint becomes fixed-supply (register_pool requires it).
    const feeTok = await ata(fee, mint.publicKey);
    await send([ixMintTo(mint.publicKey, feeTok, payer.publicKey, B(1_000) * TOKEN), ixRevokeMint(mint.publicKey, payer.publicKey)], [payer]);
    // Before registration the burn day waits; registration is permissionless and only takes the fee-PDA pool.
    const att = [{ publicKey: attester.publicKey, secretKey: attester.secretKey }];
    const V1 = B("4027300000000000");
    await submitAttestedReading(ctx, { payer, recordDate: 20260901, value: V1, attesters: att, sourceUrl: TREASURY_URL });
    await submitAttestedReading(ctx, { payer, recordDate: 20260902, value: V1 + B(21) * UNIT, attesters: att, sourceUrl: TREASURY_URL });
    assert.equal((await crankNext(ctx, payer)).status, "waiting-for-pool");
    assert.equal((await registerPool(ctx, payer, pool)).ok, true);

    // Creator fees arrive in the fee PDA (SOL).
    await send([SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: fee, lamports: 10 * LAMPORTS_PER_SOL })], [payer]);
    await new Promise((r) => setTimeout(r, 2_500)); // the pool opens one second after creation

    // The TWAP guard is mandatory (review H-1): a brand-new pool has no 600 s of oracle history, so the burn day is DEFERRED —
    // retried later, never lost, and no SOL moves. (The full swap-and-burn path, with history, is covered in the LiteSVM suite.)
    const feeBefore = B(await connection.getBalance(fee, "confirmed"));
    const res = await crankAll(ctx, payer);
    assert.equal(res[0].status, "deferred", JSON.stringify(res[0], (_, v) => (typeof v === "bigint" ? v.toString() : v)));
    if (res[0].status !== "deferred") return;
    assert.equal(res[0].reason, "TwapUnavailable");
    assert.equal(B(await connection.getBalance(fee, "confirmed")), feeBefore);
    const reading = (await fetchReading(connection, PID, configPda(PID, mint.publicKey), 20260902))!;
    assert.equal(reading.processed, false);
  });
  // ---- THE KEEPER'S PROGRAM PATH (src/lib/burnKeeper/programChain.ts over programAdapter.ts) ----------------------------------------
  // Quorum 1 (the production setting today) and quorum 2 with two LOCAL keys (shared-message Ed25519, legacy transaction ≤ 1,232 B).
  const RULES_TEXT = fs.readFileSync(path.join(import.meta.dirname, "..", "config", "burnkeeper", "deficit.rules.json"), "utf8");
  const R = (d: string, a: string): DebtReading => ({ recordDate: d, amount: a, cents: usdToCents(a) });
  const keeperCtx = (loaded: LoadedRules, offsetMs = { v: 0 }): KeeperCtx => ({ ledger: openLedger(":memory:"), loaded, log: (l) => lines.push(l), now: () => Date.now() + offsetMs.v, dryRun: false });
  const lines: string[] = [];

  test("KEEPER, vault mode: executeProgramPending attests the readings with the keeper key, cranks crank_vault, and records the program's facts", async () => {
    const loaded = rulesFromText(RULES_TEXT.replace('"mode": "buyback"', '"mode": "vault"').replace('"source": "fee-pool-buyback"', '"source": "vault-only"').replace('"version": "v2"', '"version": "v1"'));
    const mint = Keypair.generate(), keeper = Keypair.generate();
    await airdrop(keeper.publicKey, 5);
    await initToken(mint, keeper, rule({ mode: 1, fraction_per_unit_bps: 0, slippage_bps: 0, max_twap_deviation_bps: 0, twap_window_secs: 0, floor_lamports: B(0), reserve_lamports: B(0), tokens_per_unit: B(100_000) * TOKEN, vault_allocation: B(250_000_000) * TOKEN }), Buffer.from(loaded.sha256, "hex"));
    await createMint(mint, payer.publicKey);
    const vault = await ata(configPda(PID, mint.publicKey), mint.publicKey);
    await send([ixMintTo(mint.publicKey, vault, payer.publicKey, B(1_500_000) * TOKEN), ixRevokeMint(mint.publicKey, payer.publicKey)], [payer]);
    const ctx = keeperCtx(loaded);
    ingest(ctx, { readings: [R("2026-09-01", "40273000000000.00"), R("2026-09-02", "40294000000000.00")], refusals: [] });   // +$21B → 21 units
    const port = solanaProgramPort({ connection, programId: PID, mint: mint.publicKey, cluster: "localnet", payer: keeper, attesters: [keeper] });
    const supply0 = await supply(mint.publicKey);
    const rep = await executeProgramPending(ctx, port);
    assert.deepEqual(rep.readings.map((r) => [r.recordDate, r.outcome, r.units]), [["2026-09-01", "submitted", 0], ["2026-09-02", "submitted", 21]]);
    assert.equal(rep.cranks[0].outcome, "confirmed", JSON.stringify(rep.cranks, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
    const b = ctx.ledger.burn("DEBT", "treasury.debt_to_penny", "2026-09-02")!;
    assert.equal(b.execution, "program"); assert.equal(b.chainOutcome, "short"); assert.equal(b.chainUnits, 21);
    assert.equal(b.burnRaw, B(1_500_000) * TOKEN); assert.equal(b.shortOutRaw, B(600_000) * TOKEN); assert.equal(b.owedRaw, B(2_100_000) * TOKEN);
    assert.match(b.memo ?? "", /^DEBT\|2026-09-02\|.*\|units=21\|burn=1500000\|short=600000\|rules=sha256:[0-9a-f]{12}\|v1$/);
    const cfg = (await fetchTokenConfig(connection, PID, mint.publicKey))!.config;
    assert.equal(memoFromChain(cfg, (await fetchReading(connection, PID, configPda(PID, mint.publicKey), 20260902))!, 6), b.memo, "the ledger's memo is the program's");
    assert.equal(await supply(mint.publicKey), supply0 - B(1_500_000) * TOKEN);
    assert.deepEqual(ctx.ledger.signatures("DEBT", "treasury.debt_to_penny", "2026-09-02").map((x) => [x.kind, x.status]), [["reading", "confirmed"], ["crank", "confirmed"]]);
    const input = { loaded, readings: ctx.ledger.readings("DEBT", "treasury.debt_to_penny"), burns: ctx.ledger.burns("DEBT", "treasury.debt_to_penny"), now: Date.now(), nextPollAt: null, lastPoll: null, lastError: null,
      chain: { cluster: "localnet", mint: mint.publicKey.toBase58(), vault: null, keeper: keeper.publicKey.toBase58(), supplyRaw: null, vaultRaw: null },
      program: { programId: port.programId, configAddress: port.configAddress, feePda: port.feePda, config: rep.config, feePdaLamports: null, programReadings: ctx.ledger.programReadings("DEBT", "treasury.debt_to_penny"), keeperAttesterKeys: port.attesterKeys() } };
    const burns = buildBurnsJson(input);
    assert.equal(burns[0].verify.verified, true, burns[0].verify.checks.join("; "));
    const st = buildStatus(input, burns);
    assert.equal(st.program!.attestation.lastReading!.recordDate, "2026-09-02"); assert.equal(st.program!.attestation.quorumMet, true);
    // A second cycle sends nothing.
    const again = await executeProgramPending(ctx, port);
    assert.deepEqual([again.readings.length, again.cranks.length], [0, 0]);
  });

  test("KEEPER, buyback: no pool → waits; register_pool → claims best-effort, check_pool_health, then the crank DEFERS (TwapUnavailable) and the ledger records a wait, not an error", async () => {
    const loaded = rulesFromText(RULES_TEXT);
    const mint = BUYBACK_MINTS[1], keeper = Keypair.generate(), launcher = Keypair.generate();
    await airdrop(keeper.publicKey, 5);
    await airdrop(launcher.publicKey, 200);
    await initToken(mint, keeper, rule({ fraction_per_unit_bps: 100 }), Buffer.from(loaded.sha256, "hex"));
    await createMint(mint, payer.publicKey);
    const fee = feePda(PID, mint.publicKey);
    const pool = await createFeePdaPool(mint, fee, launcher);
    await send([ixRevokeMint(mint.publicKey, payer.publicKey)], [payer]);
    await send([SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: fee, lamports: 10 * LAMPORTS_PER_SOL })], [payer]);
    const offset = { v: 0 };
    const ctx = keeperCtx(loaded, offset);
    ingest(ctx, { readings: [R("2026-09-01", "40273000000000.00"), R("2026-09-02", "40294000000000.00")], refusals: [] });
    const port = solanaProgramPort({ connection, programId: PID, mint: mint.publicKey, cluster: "localnet", payer: keeper, attesters: [keeper] });
    const r1 = await executeProgramPending(ctx, port);
    assert.deepEqual(r1.readings.map((r) => r.outcome), ["submitted", "submitted"]);
    assert.equal(r1.cranks[0].outcome, "waiting");
    let b = ctx.ledger.burn("DEBT", "treasury.debt_to_penny", "2026-09-02")!;
    assert.match(b.waitReason ?? "", /waiting for the CPMM pool/); assert.equal(b.lastError, null); assert.equal(b.attempts, 0);
    assert.ok(r1.claims.some((c) => /curve: no LaunchLab creator-fee vault/.test(c)), r1.claims.join(" | "));
    assert.equal((await registerPool({ connection, programId: PID, mint: mint.publicKey, cluster: "localnet" }, keeper, pool)).ok, true);
    await new Promise((r) => setTimeout(r, 2_500)); // the pool opens one second after creation
    offset.v = WAIT_RETRY_MS + 1_000;
    const feeBefore = B(await connection.getBalance(fee, "confirmed"));
    const r2 = await executeProgramPending(ctx, port);
    assert.match(r2.health ?? "", /check_pool_health: pool tradeable/);
    assert.equal(r2.cranks[0].outcome, "waiting", JSON.stringify(r2.cranks));
    b = ctx.ledger.burn("DEBT", "treasury.debt_to_penny", "2026-09-02")!;
    assert.match(b.waitReason ?? "", /^TwapUnavailable: waiting for TWAP history/);
    assert.equal(b.status, "planned"); assert.equal(b.lastError, null); assert.equal(b.attempts, 0, "a wait is not an attempt");
    assert.equal(B(await connection.getBalance(fee, "confirmed")), feeBefore, "no SOL moved");
    assert.equal((await fetchReading(connection, PID, configPda(PID, mint.publicKey), 20260902))!.processed, false);
    assert.equal(ctx.ledger.signatures("DEBT", "treasury.debt_to_penny", "2026-09-02", "crank").length, 0, "a refused simulation writes no signature");
    const st = buildStatus({ loaded, readings: ctx.ledger.readings("DEBT", "treasury.debt_to_penny"), burns: ctx.ledger.burns("DEBT", "treasury.debt_to_penny"), now: Date.now(), nextPollAt: null, lastPoll: null, lastError: null,
      chain: { cluster: "localnet", mint: null, vault: null, keeper: null, supplyRaw: null, vaultRaw: null },
      program: { programId: port.programId, configAddress: port.configAddress, feePda: port.feePda, config: r2.config, feePdaLamports: feeBefore, programReadings: ctx.ledger.programReadings("DEBT", "treasury.debt_to_penny"), keeperAttesterKeys: port.attesterKeys(), lastHealth: r2.health } });
    assert.equal(st.program!.queue.waits[0].recordDate, "2026-09-02"); assert.equal(st.program!.pool.registered, true); assert.equal(st.health.waiting, 1);
  });

  test("KEEPER, quorum 2 with two local keys: shared-message readings fit a legacy transaction, the program counts both keys, the crank burns", async () => {
    const loaded = rulesFromText(RULES_TEXT.replace('"mode": "buyback"', '"mode": "vault"').replace('"source": "fee-pool-buyback"', '"source": "vault-only"').replace('"version": "v2"', '"version": "v1"'));
    const mint = Keypair.generate(), k1 = Keypair.generate(), k2 = Keypair.generate();
    await airdrop(k1.publicKey, 5);
    await initToken(mint, [k1, k2], rule({ mode: 1, fraction_per_unit_bps: 0, slippage_bps: 0, max_twap_deviation_bps: 0, twap_window_secs: 0, floor_lamports: B(0), reserve_lamports: B(0), tokens_per_unit: B(100_000) * TOKEN, vault_allocation: B(0) }), Buffer.from(loaded.sha256, "hex"), 2);
    await createMint(mint, payer.publicKey);
    const vault = await ata(configPda(PID, mint.publicKey), mint.publicKey);
    await send([ixMintTo(mint.publicKey, vault, payer.publicKey, B(5_000_000) * TOKEN), ixRevokeMint(mint.publicKey, payer.publicKey)], [payer]);
    const ctx = keeperCtx(loaded);
    ingest(ctx, { readings: [R("2026-09-01", "40273000000000.00"), R("2026-09-02", "40294000000000.00")], refusals: [] });
    // One key alone is short of the quorum: the keeper says so and sends nothing.
    const lone = solanaProgramPort({ connection, programId: PID, mint: mint.publicKey, cluster: "localnet", payer: k1, attesters: [k1] });
    const r0 = await executeProgramPending(ctx, lone);
    assert.deepEqual(r0.readings.map((r) => r.outcome), ["quorum-short"]);
    // Both keys in this process (opt-in multi-attester signing): accepted, both bits set.
    const port = solanaProgramPort({ connection, programId: PID, mint: mint.publicKey, cluster: "localnet", payer: k1, attesters: [k1, k2], maxLocalAttesters: 2 });
    const built = await port.buildReading({ recordDate: 20260901, prevDate: 0, value: usdToCents("40273000000000.00"), sourceUrl: "https://example.invalid/size-probe", feedId: "treasury.debt_to_penny", valueDecimals: 2 });
    assert.ok(built.raw.length <= 1_232, `${built.raw.length} B`);
    const offset = { v: 0 };
    const ctx2 = keeperCtx(loaded, offset);
    ingest(ctx2, { readings: [R("2026-09-01", "40273000000000.00"), R("2026-09-02", "40294000000000.00")], refusals: [] });
    const rep = await executeProgramPending(ctx2, port);
    assert.deepEqual(rep.readings.map((r) => [r.recordDate, r.outcome, r.units]), [["2026-09-01", "submitted", 0], ["2026-09-02", "submitted", 21]], JSON.stringify(rep.readings));
    assert.equal(rep.cranks[0].outcome, "confirmed", JSON.stringify(rep.cranks, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
    const rd = (await fetchReading(connection, PID, configPda(PID, mint.publicKey), 20260902))!;
    assert.equal(rd.signers_mask, 0b11, "both local keys counted");
    assert.equal(rd.burned, B(2_100_000) * TOKEN);
  });

  // signer-2 (2026-10-12): the keeper holds ONE key; the second key lives with the second signer, which recomputes each reading (here
  // from the same two Treasury rows) and co-signs only on agreement — the keeper carries its signature in the one Ed25519 instruction.
  test("KEEPER + SECOND SIGNER, quorum 2: the co-signed readings land with both bits set; a disagreement holds the day and sends nothing", async () => {
    const loaded = rulesFromText(RULES_TEXT.replace('"mode": "buyback"', '"mode": "vault"').replace('"source": "fee-pool-buyback"', '"source": "vault-only"').replace('"version": "v2"', '"version": "v1"'));
    const mint = Keypair.generate(), k1 = Keypair.generate(), k2 = Keypair.generate();
    await airdrop(k1.publicKey, 5);
    await initToken(mint, [k1, k2], rule({ mode: 1, fraction_per_unit_bps: 0, slippage_bps: 0, max_twap_deviation_bps: 0, twap_window_secs: 0, floor_lamports: B(0), reserve_lamports: B(0), tokens_per_unit: B(100_000) * TOKEN, vault_allocation: B(0) }), Buffer.from(loaded.sha256, "hex"), 2);
    await createMint(mint, payer.publicKey);
    const vault = await ata(configPda(PID, mint.publicKey), mint.publicKey);
    await send([ixMintTo(mint.publicKey, vault, payer.publicKey, B(5_000_000) * TOKEN), ixRevokeMint(mint.publicKey, payer.publicKey)], [payer]);
    const rows = [R("2026-09-01", "40273000000000.00"), R("2026-09-02", "40294000000000.00"), R("2026-09-03", "40300000000000.00")];
    let signerRows = rows;
    const signer: SignerDeps = {
      programId: PID.toBase58(), genesis: LOCALNET_GENESIS_TAG, secretKey: k2.secretKey,
      coin: async (m) => (m === mint.publicKey.toBase58() ? { mint: m, ticker: loaded.rules.ticker, kind: "debt", rulesText: loaded.text, baselineAt: "2026-09-02T20:00:00Z" } : null),
      readings: async () => [], debtRows: async (from) => signerRows.filter((r) => r.recordDate >= from), journal: memoryJournal(), now: () => Date.now(), log: () => {},
      chain: async (m) => { const r = await fetchTokenConfig(connection, PID, new PublicKey(m)); if (!r) return null; const c = r.config; return { genesis: c.cluster_genesis.toBase58(), programId: PID.toBase58(), rulesSha256: Buffer.from(c.rules_sha256).toString("hex"), feedId: c.feedId, valueDecimals: c.rule.value_decimals, hasBaseline: c.has_baseline, lastRecordDate: c.last_record_date, attesters: c.activeAttesters.map((a) => a.key.toBase58()) }; },
    };
    const ctx = { ...keeperCtx(loaded), cosigner: { cosign: (req: CosignRequest) => decideCosign(signer, JSON.parse(JSON.stringify(req))) } };
    ingest(ctx, { readings: rows.slice(0, 2), refusals: [] });
    const port = solanaProgramPort({ connection, programId: PID, mint: mint.publicKey, cluster: "localnet", payer: k1, attesters: [k1] });
    const rep = await executeProgramPending(ctx, port);
    assert.deepEqual(rep.readings.map((r) => [r.recordDate, r.outcome, r.units]), [["2026-09-01", "submitted", 0], ["2026-09-02", "submitted", 21]], JSON.stringify(rep.readings));
    const rd = (await fetchReading(connection, PID, configPda(PID, mint.publicKey), 20260902))!;
    assert.equal(rd.signers_mask, 0b11, "the keeper's key and the second signer's key both counted");
    // The signer sees another amount for 09-03: held, nothing sent, the chain still ends at 09-02.
    signerRows = [...rows.slice(0, 2), R("2026-09-03", "40300000000000.01")];
    ingest(ctx, { readings: rows.slice(2), refusals: [] });
    const rep2 = await executeProgramPending(ctx, port);
    assert.ok(rep2.readings.some((r) => r.recordDate === "2026-09-03" && r.outcome === "held"), JSON.stringify(rep2.readings));
    assert.equal((await fetchTokenConfig(connection, PID, mint.publicKey))!.config.last_record_date, 20260902);
    assert.equal(await fetchReading(connection, PID, configPda(PID, mint.publicKey), 20260903), null);
  });

  test("ADMIN CLI (scripts/burnreceipts-admin.mts): initialize-token dry run decodes the instruction, prints the pinned rules sha and the resulting TokenConfig; --send with test key files creates it; verify-platform-pins passes and redacts the RPC", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "burn-receipts-cli-"));
    const keyFile = (name: string, k: Keypair) => { const p = path.join(dir, `${name}.json`); fs.writeFileSync(p, JSON.stringify(Array.from(k.secretKey)), { mode: 0o600 }); return p; };
    const mint = BUYBACK_MINTS[2], creator = Keypair.generate(), cliPayer = Keypair.generate(), attester = Keypair.generate();
    await airdrop(cliPayer.publicKey, 2);
    const cli = (extra: string[]) => spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--import", "./test/alias-hook.mjs", "scripts/burnreceipts-admin.mts", "initialize-token",
      "--cluster", "localnet", "--rpc", connection.rpcEndpoint, "--program", PID.toBase58(), "--admin", payer.publicKey.toBase58(), "--attester", attester.publicKey.toBase58(),
      "--launchlab-platform", LL_PLATFORM.toBase58(), "--rules", "config/burnkeeper/deficit.rules.json", ...extra], { cwd: path.join(import.meta.dirname, ".."), encoding: "utf8" });
    const dry = cli(["--payer", cliPayer.publicKey.toBase58(), "--mint", mint.publicKey.toBase58(), "--creator", creator.publicKey.toBase58()]);
    assert.equal(dry.status, 0, dry.stderr + dry.stdout);
    const out = JSON.parse(dry.stdout);
    const sha = rulesFromText(RULES_TEXT).sha256;
    assert.equal(out.dryRun, true); assert.equal(out.rulesSha256, sha); assert.match(dry.stderr, new RegExp(`sha256 ${sha}`));
    assert.equal(out.instructions[0].instruction, "initialize_token");
    assert.equal(out.simulation.err, null, out.simulation.logs.join("\n"));
    const cfgAfter = out.resultingAccounts.find((a: { kind: string }) => a.kind === "TokenConfig").state;
    assert.equal(cfgAfter.rules_sha256, sha); assert.equal(cfgAfter.ll_platform, LL_PLATFORM.toBase58()); assert.equal(cfgAfter.cluster_genesis, LOCALNET_GENESIS_TAG);
    assert.equal(await connection.getAccountInfo(configPda(PID, mint.publicKey)), null, "a dry run sends nothing");
    // --send refuses pubkeys; with key files it lands.
    assert.notEqual(cli(["--payer", cliPayer.publicKey.toBase58(), "--mint", mint.publicKey.toBase58(), "--creator", creator.publicKey.toBase58(), "--send"]).status, 0);
    const sent = cli(["--payer", keyFile("payer", cliPayer), "--mint", keyFile("mint", mint), "--creator", keyFile("creator", creator), "--send"]);
    assert.equal(sent.status, 0, sent.stderr + sent.stdout);
    assert.equal(JSON.parse(sent.stdout).sent.err, null);
    const cfg = (await fetchTokenConfig(connection, PID, mint.publicKey))!.config;
    assert.equal(Buffer.from(cfg.rules_sha256).toString("hex"), sha);
    // Re-check R3-3: the read-only launch gate passes against the platform the config pinned; R3-5: the RPC's query never prints.
    const pins = spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--import", "./test/alias-hook.mjs", "scripts/burnreceipts-admin.mts", "verify-platform-pins",
      "--cluster", "localnet", "--rpc", `${connection.rpcEndpoint}/?api-key=SECRET-TEST-KEY`, "--program", PID.toBase58(), "--mint", mint.publicKey.toBase58()], { cwd: path.join(import.meta.dirname, ".."), encoding: "utf8" });
    assert.equal(pins.status, 0, pins.stderr + pins.stdout);
    const pinsOut = JSON.parse(pins.stdout);
    assert.equal(pinsOut.ok, true); assert.deepEqual(pinsOut.mismatches, []); assert.equal(pinsOut.current.cpConfig, pinsOut.pinned.cpConfig);
    assert.equal(pinsOut.rpc, new URL(connection.rpcEndpoint).origin);
    assert.doesNotMatch(pins.stdout + pins.stderr, /SECRET-TEST-KEY/);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
