import { describe, test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Keypair, PublicKey } from "@solana/web3.js";
import { PAIR_CURVE_IDL } from "../src/lib/pairCurve/idl.ts";
import { BURN_RECEIPTS_IDL } from "../src/lib/burnReceipts/idl.ts";
import { accountDiscriminator, encodeType } from "../src/lib/burnReceipts/idlCoder.ts";
import { CPMM_PROGRAM_ID, LOCK_CPMM_PROGRAM_ID, NATIVE_MINT, PAIR_CURVE_PROGRAM_ID, POOL_POLICY_PAIR_CURVE, TOKEN_PROGRAM_ID } from "../src/lib/burnReceipts/constants.ts";
import { configPda, feeKeysPda, feePda, lockedLiquidityPda, lpLockVault } from "../src/lib/burnReceipts/pda.ts";
import { ata, CPMM_CREATE_POOL_FEE_RECEIVER, decodePair, feeNftMintPda, pairPda, poolPda, sidePoolAccounts, STATUS_GRADUATED, STATUS_GRADUATING, STATUS_OPEN, STATUS_VOIDED, vaultPda, type PairAccount } from "../src/lib/pairCurve/accounts.ts";
import { burnLpIx, LP_LOCK_FALLBACK_SECS, buyIx, lockLpIx, CLAIM_THRESHOLD_LAMPORTS, claimDeveloperFeeIx, closePairIx, createPairMintIxs, graduateIx, initPairIx, pairCurveEventAuthority, planPairCrank, registerSideIx, seedObservationIxs, sellIx, syncNativeIx, voidPairIx } from "../src/lib/pairCurve/client.ts";
import { crankPairCurves, unlockedSides } from "../src/lib/burnKeeper/pairCurveCrank.ts";
import { feeKeyRecordPda } from "../src/lib/burnReceipts/pda.ts";
import { bs58 } from "../src/lib/burnReceipts/accounts.ts";
import { operatorAttester } from "../src/lib/burnReceipts/instructions.ts";
import { ruleParamsFromKeeperRules } from "../src/lib/burnReceipts/math.ts";
import { GENESIS_HASH } from "../src/lib/burnReceipts/constants.ts";

const anchorDisc = (kind: "global" | "account", name: string) => crypto.createHash("sha256").update(`${kind}:${name}`).digest().subarray(0, 8);
const BR = new PublicKey("AuQjoSgq7upmyPBv2itwy2TSZ1VjoVipyy4z9wd7zhMM");
const B = (n: number | string) => BigInt(n);

describe("pairCurve client — IDL and registers", () => {
  test("the committed IDL matches a fresh `anchor build` when one is present", () => {
    const built = path.join(import.meta.dirname, "..", "programs", "burn-receipts", "target", "idl", "pair_curve.json");
    if (!fs.existsSync(built)) return;
    assert.deepEqual(JSON.parse(fs.readFileSync(built, "utf8")), JSON.parse(JSON.stringify(PAIR_CURVE_IDL)), "run: (cd programs/burn-receipts && anchor build && node scripts/sync-idl.mjs)");
  });
  test("the program id is the one burn_receipts hard-codes; discriminators are Anchor's", () => {
    assert.equal(PAIR_CURVE_IDL.address, PAIR_CURVE_PROGRAM_ID.toBase58());
    for (const ix of PAIR_CURVE_IDL.instructions) assert.deepEqual(Buffer.from(ix.discriminator), anchorDisc("global", ix.name), ix.name);
    for (const a of PAIR_CURVE_IDL.accounts) assert.deepEqual(accountDiscriminator(PAIR_CURVE_IDL, a.name), anchorDisc("account", a.name));
    assert.ok(BURN_RECEIPTS_IDL.instructions.some((i) => i.name === "register_pair_pool"));
    assert.equal(POOL_POLICY_PAIR_CURVE, 2);
  });
  test("nine instructions (burn_lp: the 30-day LP-lock fallback, lp-lock blind review L-2), no admin, no withdraw; the generated Powers Register is current and lists no privileged power", () => {
    assert.deepEqual(PAIR_CURVE_IDL.instructions.map((i) => i.name).sort(), ["burn_lp", "buy", "claim_developer_fee", "close_pair", "graduate", "init_pair", "lock_lp", "sell", "void_pair"]);
    const r = spawnSync(process.execPath, [path.join(import.meta.dirname, "..", "programs", "burn-receipts", "scripts", "pair-curve-powers-register.mjs"), "--check"], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    const reg = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "..", "docs", "burn-receipts", "pair-curve-powers-register.json"), "utf8"));
    assert.deepEqual(reg.privileged_powers, []);
    assert.equal(reg.powers_over_funds, "none");
    for (const n of PAIR_CURVE_IDL.instructions.map((i) => i.name)) for (const bad of ["withdraw", "sweep", "admin", "update", "set_", "pause", "mint_to"]) assert.ok(!n.includes(bad), n);
  });
});

/** A synthetic Pair encoded with the IDL (round-trip check + planner input). */
function pairFixture(over: Partial<PairAccount> = {}): { address: PublicKey; pair: PairAccount } {
  const [ma, mb] = [Keypair.generate().publicKey, Keypair.generate().publicKey];
  const address = pairPda(ma, mb);
  const vault = vaultPda(address);
  const pair: PairAccount = {
    version: 1, bump: 255, vault_bump: 254, status: STATUS_OPEN, mints: [ma, mb], pools: [PublicKey.default, PublicKey.default], lp_supply_at_creation: [B(0), B(0)], lp_locked: [B(0), B(0)],
    cp_config: Keypair.generate().publicKey, vault, creator: Keypair.generate().publicKey, dev_wallet: Keypair.generate().publicKey, ll_platform: Keypair.generate().publicKey,
    fee_vaults: [feePda(BR, ma), feePda(BR, mb)], token_vaults: [ata(vault, ma), ata(vault, mb)], vault_wsol: ata(vault, NATIVE_MINT), pool_bumps: Uint8Array.from([253, 252]),
    pair_id: new Uint8Array(32).fill(7), rules_sha256_a: new Uint8Array(32).fill(1), rules_sha256_b: new Uint8Array(32).fill(2),
    virtual_sol_lamports: B(30_000_000_000), virtual_token_amount: B("1073000000000000"), curve_supply: B("793100000000000"), reserve_supply: B("206900000000000"), target_raise_lamports: B(85_000_000_000),
    min_side_share_bps: 2_500, deadline: B(2_000_000_000), created_at: B(1_900_000_000),
    sold: [B(0), B(0)], sol: [B(0), B(0)], volume_lamports: [B(0), B(0)], burn_fees_lamports: [B(0), B(0)], dev_fees_lamports: [B(0), B(0)], trades: [0, 0],
    graduated_at: B(0), voided_at: B(0), pool_sol: [B(0), B(0)], pool_tokens: [B(0), B(0)], tokens_burned: [B(0), B(0)], graduation_started_at: B(0), raise_at_graduation: [B(0), B(0)],
    burn_escrow: [B(0), B(0)], dev_accrued: B(0), redeem_pool: [B(0), B(0)], redeem_supply: [B(0), B(0)], refunding: [false, false],
    ...over,
  };
  return { address, pair };
}

describe("pairCurve client — accounts", () => {
  test("Pair round-trips through the IDL coder, and its first fields sit at the offsets burn_receipts reads", () => {
    const { pair } = pairFixture({ status: STATUS_GRADUATING, lp_supply_at_creation: [B(1234), B(5678)], lp_locked: [B(1134), B(5578)] });
    const data = Buffer.concat([accountDiscriminator(PAIR_CURVE_IDL, "Pair"), encodeType(PAIR_CURVE_IDL, { defined: { name: "Pair" } }, { ...pair, reserved: new Uint8Array(64) })]);
    const back = decodePair(data);
    assert.ok(back.mints[1].equals(pair.mints[1]));
    assert.equal(back.status, STATUS_GRADUATING);
    // burn_receipts src/pair_curve.rs offsets
    assert.equal(data[11], STATUS_GRADUATING);
    assert.ok(new PublicKey(data.subarray(12, 44)).equals(pair.mints[0]));
    assert.ok(new PublicKey(data.subarray(44, 76)).equals(pair.mints[1]));
    assert.equal(data.readBigUInt64LE(140), B(1234));
    assert.equal(data.readBigUInt64LE(164), B(5578));
    assert.ok(new PublicKey(data.subarray(172, 204)).equals(pair.cp_config));
    assert.ok(new PublicKey(data.subarray(204, 236)).equals(pair.vault));
    assert.equal(data.length, 8 + 938, "8 + Pair::INIT_SPACE (tests/lifecycle.rs prints the real size)");
  });
  test("side pool accounts: a pair_curve PDA pool and CPMM's own PDAs for it, per cluster; WSOL ordering", () => {
    const { address, pair } = pairFixture();
    for (const cluster of ["mainnet", "devnet"] as const) {
      const s = sidePoolAccounts(cluster, address, 0, pair.mints[0]);
      assert.ok(s.pool.equals(poolPda(address, 0)));
      const cpmm = CPMM_PROGRAM_ID[cluster];
      assert.ok(s.lpMint.equals(PublicKey.findProgramAddressSync([Buffer.from("pool_lp_mint"), s.pool.toBuffer()], cpmm)[0]));
      assert.ok(s.vaultLp.equals(ata(pair.vault, s.lpMint)));
      assert.equal(s.wsolIsToken0, Buffer.compare(NATIVE_MINT.toBuffer(), pair.mints[0].toBuffer()) < 0);
      assert.ok((s.wsolIsToken0 ? s.token0Mint : s.token1Mint).equals(NATIVE_MINT));
    }
    assert.ok(!poolPda(address, 0).equals(poolPda(address, 1)));
  });
});

describe("pairCurve client — instruction builders follow the IDL", () => {
  const { address, pair } = pairFixture();
  const user = Keypair.generate().publicKey;
  const order = (name: string) => PAIR_CURVE_IDL.instructions.find((i) => i.name === name)!.accounts.map((a) => a.name);
  test("init_pair: configs and fee PDAs under burn_receipts, the vault's ATAs", () => {
    const ix = initPairIx({ payer: user, creator: user, mintA: pair.mints[0], mintB: pair.mints[1], args: { pair_id: pair.pair_id, virtual_sol_lamports: B(1), virtual_token_amount: B(2), curve_supply: B(1), target_raise_lamports: B(3), min_side_share_bps: 2500, deadline: B(4) }, launchlabPlatform: pair.ll_platform, ammConfig: pair.cp_config, burnReceiptsProgramId: BR });
    assert.equal(ix.keys.length, order("init_pair").length);
    const at = (n: string) => ix.keys[order("init_pair").indexOf(n)];
    assert.ok(at("pair").pubkey.equals(address));
    assert.ok(at("config_a").pubkey.equals(configPda(BR, pair.mints[0])));
    assert.ok(at("token_vault_b").pubkey.equals(ata(pair.vault, pair.mints[1])));
    assert.ok(at("creator").isSigner && at("payer").isSigner && !at("mint_a").isSigner);
    assert.ok(at("event_authority").pubkey.equals(pairCurveEventAuthority()));
  });
  test("buy / sell / void / claim / close: fixed accounts from the Pair, trader signs; no trade names a fee recipient", () => {
    const b = buyIx({ buyer: user, pairAddress: address, pair, side: 1, maxLamportsIn: B(10), minTokensOut: B(1) });
    const at = (ix: typeof b, name: string, n: string) => ix.keys[order(name).indexOf(n)];
    assert.equal(b.keys.length, order("buy").length);
    assert.ok(!order("buy").includes("fee_vault") && !order("buy").includes("dev_wallet") && !order("sell").includes("dev_wallet"));
    assert.ok(at(b, "buy", "vault").pubkey.equals(pair.vault) && at(b, "buy", "amm_config").pubkey.equals(pair.cp_config));
    assert.ok(at(b, "buy", "buyer_token").pubkey.equals(ata(user, pair.mints[1])));
    assert.deepEqual([...b.data.subarray(8, 9)], [1]);
    const s = sellIx({ seller: user, pairAddress: address, pair, side: 0, amount: B(5), minLamportsOut: B(0) });
    assert.equal(s.keys.length, order("sell").length);
    assert.ok(at(s, "sell", "token_vault").pubkey.equals(pair.token_vaults[0]) && at(s, "sell", "seller").isSigner && at(s, "sell", "amm_config").pubkey.equals(pair.cp_config));
    const v = voidPairIx({ caller: user, pairAddress: address, pair });
    assert.equal(v.keys.length, order("void_pair").length);
    assert.ok(at(v, "void_pair", "amm_config").pubkey.equals(pair.cp_config));
    const cl = claimDeveloperFeeIx({ caller: user, pairAddress: address, pair });
    assert.equal(cl.keys.length, order("claim_developer_fee").length);
    assert.ok(at(cl, "claim_developer_fee", "dev_wallet").pubkey.equals(pair.dev_wallet) && at(cl, "claim_developer_fee", "dev_wallet").isWritable);
    const c = closePairIx({ caller: user, pairAddress: address, pair });
    assert.equal(c.keys.length, order("close_pair").length);
    assert.ok(at(c, "close_pair", "creator").pubkey.equals(pair.creator) && at(c, "close_pair", "dev_wallet").pubkey.equals(pair.dev_wallet));
  });
  test("graduate is preceded by an SPL SyncNative on the vault's WSOL account (no signer, writable)", () => {
    const ix = syncNativeIx(pair.vault_wsol);
    assert.ok(ix.programId.equals(TOKEN_PROGRAM_ID) && ix.keys[0].pubkey.equals(pair.vault_wsol) && ix.keys[0].isWritable && !ix.keys[0].isSigner);
    assert.deepEqual([...ix.data], [17]);
  });
  test("lock_lp: the Fee Key mint is the pair_curve PDA, its account and the lock state are FEE_KEYS's / the lock program's", () => {
    for (const cluster of ["mainnet", "devnet"] as const) {
      const ix = lockLpIx({ cranker: user, pairAddress: address, pair, side: 1, cluster, burnReceiptsProgramId: BR });
      const at = (n: string) => ix.keys[order("lock_lp").indexOf(n)];
      assert.equal(ix.keys.length, order("lock_lp").length);
      const nft = feeNftMintPda(address, 1);
      assert.ok(at("fee_nft_mint").pubkey.equals(nft) && at("fee_nft_mint").isWritable && !at("fee_nft_mint").isSigner);
      assert.ok(at("fee_keys").pubkey.equals(feeKeysPda(BR)));
      assert.ok(at("fee_nft_account").pubkey.equals(ata(feeKeysPda(BR), nft)));
      assert.ok(at("locked_liquidity").pubkey.equals(lockedLiquidityPda(cluster, nft)));
      assert.ok(at("lock_program").pubkey.equals(LOCK_CPMM_PROGRAM_ID[cluster]) && at("lock_lp_vault").pubkey.equals(lpLockVault(cluster, at("lp_mint").pubkey)));
      assert.ok(at("fee_vault").pubkey.equals(pair.fee_vaults[1]) && at("cranker").isSigner);
    }
  });
  test("seed: a dust CPMM swap_base_input into the side's pool that writes its observation", () => {
    const ixs = seedObservationIxs({ cluster: "devnet", payer: user, pairAddress: address, pair, side: 0 });
    const swap = ixs.find((i) => i.programId.equals(CPMM_PROGRAM_ID.devnet))!;
    assert.ok(swap.keys[3].pubkey.equals(poolPda(address, 0)) && swap.keys[2].pubkey.equals(pair.cp_config));
    assert.equal(swap.data.readBigUInt64LE(8), B(10_000));
    assert.ok(swap.keys[12].isWritable);
  });
  test("graduate: per-cluster CPMM id and fee receiver; register_pair_pool targets the same pool and LP mint", () => {
    for (const cluster of ["mainnet", "devnet"] as const) {
      const g = graduateIx({ cranker: user, pairAddress: address, pair, side: 1, cluster });
      const at = (n: string) => g.keys[order("graduate").indexOf(n)];
      assert.ok(at("cpmm_program").pubkey.equals(CPMM_PROGRAM_ID[cluster]));
      assert.ok(at("create_pool_fee").pubkey.equals(CPMM_CREATE_POOL_FEE_RECEIVER[cluster]));
      assert.ok(at("pool").pubkey.equals(poolPda(address, 1)));
      assert.ok(at("mint").pubkey.equals(pair.mints[1]) && at("fee_vault").pubkey.equals(pair.fee_vaults[1]));
      const r = registerSideIx({ registrar: user, pairAddress: address, pair, side: 1, cluster, burnReceiptsProgramId: BR });
      const rOrder = BURN_RECEIPTS_IDL.instructions.find((i) => i.name === "register_pair_pool")!.accounts.map((a) => a.name);
      assert.ok(r.keys[rOrder.indexOf("pool_state")].pubkey.equals(at("pool").pubkey));
      assert.ok(r.keys[rOrder.indexOf("lp_mint")].pubkey.equals(at("lp_mint").pubkey));
      assert.ok(r.keys[rOrder.indexOf("pair")].pubkey.equals(address));
    }
  });
  test("pair mints: 82-byte SPL mint, 6 decimals, mint authority = the vault, no freeze authority", () => {
    const mint = Keypair.generate().publicKey;
    const [create, init] = createPairMintIxs({ payer: user, mint, vault: pair.vault, rentLamports: 1_461_600 });
    assert.ok(create.keys[1].pubkey.equals(mint) && create.keys[1].isSigner);
    assert.ok(init.programId.equals(TOKEN_PROGRAM_ID));
    assert.equal(init.data[0], 20);
    assert.equal(init.data[1], 6);
    assert.ok(new PublicKey(init.data.subarray(2, 34)).equals(pair.vault));
    assert.equal(init.data[34], 0);
  });
});

describe("pairCurve client — crank planner", () => {
  const kinds = (a: ReturnType<typeof planPairCrank>) => a.map((x) => [x.kind, "side" in x ? x.side : null]);
  test("open + ready (a trade did not commit it) → graduate then lock_lp per side as separate actions; past deadline → void; thin side → wait", () => {
    const { pair } = pairFixture({ sol: [B(50_000_000_000), B(40_000_000_000)] });
    assert.deepEqual(kinds(planPairCrank(pair, 1_950_000_000, [false, false])), [["graduate", 0], ["lock", 0], ["graduate", 1], ["lock", 1]]);
    assert.equal(planPairCrank(pair, 2_000_000_000, [false, false])[0].kind, "void");
    const { pair: thin } = pairFixture({ sol: [B(80_000_000_000), B(10_000_000_000)] });
    assert.equal(planPairCrank(thin, 1_950_000_000, [false, false])[0].kind, "wait");
  });
  test("graduating → the missing side (graduate + lock_lp), then the existing side's lock, registration, Fee Key record and seed as their own actions", () => {
    const pool = Keypair.generate().publicKey;
    const { pair } = pairFixture({ status: STATUS_GRADUATING, pools: [pool, PublicKey.default], graduation_started_at: B(2_000_000_000), lp_locked: [B(1_000), B(0)] });
    assert.deepEqual(kinds(planPairCrank(pair, 2_000_000_100, [true, false])), [["graduate", 1], ["lock", 1]]);
    assert.deepEqual(kinds(planPairCrank(pair, 2_000_000_100, [false, false], [false, true], [false, true])), [["graduate", 1], ["lock", 1], ["register", 0], ["fee_key", 0], ["seed", 0]]);
    const { pair: unlocked } = pairFixture({ status: STATUS_GRADUATING, pools: [pool, PublicKey.default], graduation_started_at: B(2_000_000_000) });
    assert.deepEqual(kinds(planPairCrank(unlocked, 2_000_000_100, [false, false])), [["graduate", 1], ["lock", 1], ["lock", 0], ["register", 0]], "an unlocked pool is locked before it is registered");
    // 3 days on: still try the graduate, then the stuck-side void (the program refuses it unless Raydium really blocks the side)
    assert.deepEqual(kinds(planPairCrank(pair, 2_000_000_000 + 3 * 86_400, [true, false])), [["graduate", 1], ["lock", 1], ["void", null]]);
    const { pair: refunding } = pairFixture({ status: STATUS_GRADUATING, pools: [pool, PublicKey.default], refunding: [false, true], lp_locked: [B(1), B(0)] });
    assert.deepEqual(kinds(planPairCrank(refunding, 2_100_000_000, [true, false])), [["wait", null]]);
  });
  test("LP-lock round 2: burn_lp is planned only from 30 days after the commit for a side still unlocked; the alert lists every unlocked graduated side", () => {
    const pool = Keypair.generate().publicKey;
    const { address, pair } = pairFixture({ status: STATUS_GRADUATED, pools: [pool, pool], graduation_started_at: B(2_000_000_000), lp_locked: [B(0), B(5)] });
    const early = 2_000_000_000 + LP_LOCK_FALLBACK_SECS - 1, due = 2_000_000_000 + LP_LOCK_FALLBACK_SECS;
    assert.deepEqual(kinds(planPairCrank(pair, early, [true, true])), [["lock", 0]], "not due: lock_lp only");
    assert.deepEqual(kinds(planPairCrank(pair, due, [true, true])), [["lock", 0], ["burn_lp", 0]], "due: lock_lp first, burn_lp as the fallback");
    assert.equal(LP_LOCK_FALLBACK_SECS, 30 * 86_400);
    assert.deepEqual(unlockedSides([{ address, pair }], early).map((u) => [u.side, u.fallbackDue, u.days]), [["A", false, 29]]);
    assert.deepEqual(unlockedSides([{ address, pair }], due).map((u) => [u.side, u.fallbackDue]), [["A", true]]);
    const { pair: locked } = pairFixture({ status: STATUS_GRADUATED, pools: [pool, pool], lp_locked: [B(1), B(1)] });
    assert.deepEqual(unlockedSides([{ address, pair: locked }], due), []);
    const ix = burnLpIx({ cranker: Keypair.generate().publicKey, pairAddress: address, pair, side: 0, cluster: "devnet" });
    assert.equal(ix.keys.filter((k) => k.isSigner).length, 1);
  });
  test("graduated → missing registrations / seeds; voided → wait; a developer accrual over the threshold → claim", () => {
    const pool = Keypair.generate().publicKey;
    const { pair: g } = pairFixture({ status: STATUS_GRADUATED, pools: [pool, pool], lp_locked: [B(1), B(1)] });
    assert.deepEqual(planPairCrank(g, 0, [true, false]).map((a) => a.kind), ["register"]);
    assert.equal(planPairCrank(g, 0, [true, true])[0].kind, "wait");
    const { pair: v } = pairFixture({ status: STATUS_VOIDED });
    assert.equal(planPairCrank(v, 0, [false, false])[0].kind, "wait");
    const { pair: rich } = pairFixture({ status: STATUS_VOIDED, dev_accrued: CLAIM_THRESHOLD_LAMPORTS });
    assert.deepEqual(planPairCrank(rich, 0, [false, false]).map((a) => a.kind), ["claim"]);
  });
});

// REVIEW 2 F2 (ChatGPT/Codex, 2026-10-11): the keeper's scan dropped every Graduated pair older than 7 days BEFORE unlockedSides and
// crankPair, so a side whose lock_lp kept refusing vanished from retries and alerts at day 7 and the 30-day burn_lp fallback was never
// reached. These drive the production wrapper (crankPairCurves) against a fake RPC, not only the pure planner.
describe("review 2 F2 — the wrapper keeps an incomplete graduated pair in the scan regardless of age", () => {
  const DAY = 86_400, NOW_S = 2_100_000_000;
  const PC = PAIR_CURVE_PROGRAM_ID;
  const disc = (name: string) => Buffer.from(PAIR_CURVE_IDL.instructions.find((i) => i.name === name)!.discriminator).toString("hex");
  const encodePair = (p: PairAccount) => Buffer.concat([accountDiscriminator(PAIR_CURVE_IDL, "Pair"), encodeType(PAIR_CURVE_IDL, { defined: { name: "Pair" } }, { ...p, reserved: new Uint8Array(64) })]);
  const pad = (s: string, n: number) => { const b = new Uint8Array(n); b.set(Buffer.from(s)); return b; };
  /** A TokenConfig whose pool is verified (registered), for the "complete" pair. */
  function registeredConfig(mint: PublicKey, pool: PublicKey): Buffer {
    const a1 = Keypair.generate().publicKey;
    const rule = ruleParamsFromKeeperRules(
      { mode: "buyback", decimals: 6, vaultAllocation: "1", buyback: { fractionPerUnit: "0.05", reserveSol: "0.02", slippageBps: 300 }, rule: { unitUsd: "1000000000", burnPerUnitTokens: "100000", maxAbsDeltaUsd: "2000000000000", carry: "consecutive-increases", onNonIncrease: "burn-nothing-reset-carry" } },
      { floorLamports: BigInt(1), maxTwapDeviationBps: 1500, twapWindowSecs: 600 },
    );
    const cfg = {
      version: 1, bump: 255, fee_bump: 254, has_baseline: true, mint, creator: a1, admin: PublicKey.default, rule,
      rules_sha256: new Uint8Array(32).fill(7), params_hash: new Uint8Array(32).fill(9),
      feed_id: pad("pair", 32), feed_id_len: 4, memo_prefix: pad("P", 12), memo_prefix_len: 1, memo_source: pad("x", 64), memo_source_len: 1,
      attesters: [operatorAttester(a1), ...Array.from({ length: 4 }, () => operatorAttester(PublicKey.default))], attester_count: 1, quorum: 1,
      pending_attesters: Array.from({ length: 5 }, () => operatorAttester(PublicKey.default)), pending_count: 0, pending_quorum: 0, pending_eta: BigInt(0),
      cpmm_pool: pool, last_record_date: 20261008, last_value: BigInt(1), carry: BigInt(0), crank_cursor: 20261007,
      readings: 1, burns: 0, total_burned: BigInt(0), total_spent_lamports: BigInt(0), shortfall: BigInt(0), created_at: BigInt(1791547200), carried_spend_lamports: BigInt(0), pool_untradeable_since: BigInt(0), pool_untradeable_last_seen: BigInt(0), pool_verified: true, cluster_genesis: new PublicKey(GENESIS_HASH.devnet), registration_policy: 2, ll_platform: a1, ll_cp_config: PublicKey.default, ll_lock_scale_ppm: BigInt(1_000_000), pool_untradeable_candidate_at: BigInt(0), attester_added_at: [BigInt(1791547200), BigInt(0), BigInt(0), BigInt(0), BigInt(0)], pending_policy: 0, pending_policy_pool: PublicKey.default, pending_policy_eta: BigInt(0), pair_state: 2, pair_void_by: 0, pair_after_date: 0, pair_unlinked_at: BigInt(0), reserved: new Uint8Array(6),
    };
    return Buffer.concat([accountDiscriminator(BURN_RECEIPTS_IDL, "TokenConfig"), encodeType(BURN_RECEIPTS_IDL, { defined: { name: "TokenConfig" } }, cfg)]);
  }
  /** A fake RPC serving one Pair (and, when `complete`, both TokenConfigs registered + both Fee Key records). Dry run: simulate only. */
  function world(pair: PairAccount, address: PublicKey, o: { complete?: boolean; lockRefuses?: boolean } = {}) {
    const accounts = new Map<string, Buffer>([[address.toBase58(), encodePair(pair)]]);
    if (o.complete) for (const s of [0, 1] as const) {
      accounts.set(configPda(BR, pair.mints[s]).toBase58(), registeredConfig(pair.mints[s], pair.pools[s]));
      accounts.set(feeKeyRecordPda(BR, pair.mints[s]).toBase58(), Buffer.alloc(64, 1));
    }
    const statusFilter = (filters: { memcmp: { offset: number; bytes: string } }[]) => filters.find((f) => f.memcmp.offset === 11)?.memcmp.bytes;
    const simulated: string[] = [];
    const connection = {
      getGenesisHash: async () => GENESIS_HASH.devnet,
      getProgramAccounts: async (_pid: PublicKey, cfg: { filters: { memcmp: { offset: number; bytes: string } }[] }) => (statusFilter(cfg.filters) === bs58(Uint8Array.from([pair.status])) ? [{ pubkey: address, account: { data: accounts.get(address.toBase58())! } }] : []),
      getAccountInfo: async (k: PublicKey) => { const d = accounts.get(k.toBase58()); return d ? { data: d, owner: PC, lamports: 1, executable: false } : null; },
      getLatestBlockhash: async () => ({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 100 }),
      simulateTransaction: async (tx: { message: { compiledInstructions: { data: Uint8Array }[] } }) => {
        const d8 = Buffer.from(tx.message.compiledInstructions.at(-1)!.data.subarray(0, 8)).toString("hex");
        simulated.push(d8);
        // Raydium's lock refusing (the report's scenario): lock_lp fails in simulation every cycle
        if (o.lockRefuses && d8 === disc("lock_lp")) return { value: { err: { InstructionError: [1, { Custom: 1 }] }, logs: ["Program log: lock refused"], unitsConsumed: 1 } };
        return { value: { err: null, logs: [], unitsConsumed: 1 } };
      },
    };
    return { connection, simulated };
  }
  const graduated = (ageDays: number, over: Partial<PairAccount> = {}) => {
    const pool0 = Keypair.generate().publicKey, pool1 = Keypair.generate().publicKey;
    return pairFixture({ status: STATUS_GRADUATED, pools: [pool0, pool1], graduation_started_at: B(NOW_S - ageDays * DAY), graduated_at: B(NOW_S - ageDays * DAY), lp_locked: [B(0), B(0)], ...over });
  };
  async function crank(pair: PairAccount, address: PublicKey, o: { complete?: boolean; lockRefuses?: boolean } = {}) {
    const w = world(pair, address, o);
    const alerts: { kind: string; meta: Record<string, unknown> }[] = [];
    const r = await crankPairCurves({ ctx: { connection: w.connection as never, cluster: "devnet", burnReceiptsProgramId: BR, programId: PC }, cranker: Keypair.generate(), dryRun: true, log: () => {}, now: () => NOW_S * 1000, alert: (kind, _k, _t, meta) => alerts.push({ kind, meta }) });
    return { r, alerts, simulated: w.simulated };
  }

  test("day 8, both sides unlocked: still scanned, lock_lp retried, the unlocked-side alert raised (burn_lp not yet due)", async () => {
    const { address, pair } = graduated(8);
    const { r, alerts, simulated } = await crank(pair, address);
    assert.equal(r.scanned, 1);
    assert.deepEqual(r.errors, []);
    assert.deepEqual(alerts.filter((a) => a.kind === "pair-side-unlocked").map((a) => a.meta.fallbackDue), [false, false]);
    assert.ok(simulated.includes(disc("lock_lp")), "lock_lp attempted");
    assert.ok(!simulated.includes(disc("burn_lp")), "burn_lp waits for day 30");
  });

  test("day 31, both sides unlocked and Raydium's lock refusing: scanned, alerted as fallback-due, and burn_lp attempted (the planner's fallback reaches the chain)", async () => {
    const { address, pair } = graduated(31);
    const { r, alerts, simulated } = await crank(pair, address, { lockRefuses: true });
    assert.equal(r.scanned, 1);
    assert.deepEqual(alerts.filter((a) => a.kind === "pair-side-unlocked").map((a) => a.meta.fallbackDue), [true, true]);
    assert.ok(simulated.includes(disc("burn_lp")), "burn_lp attempted");
    assert.ok(r.acted.some((x) => x.steps.some((s) => s.action.kind === "burn_lp")));
  });

  test("day 40, LP locked but a side not registered / no Fee Key record: kept in the scan (registration work outstanding)", async () => {
    const { address, pair } = graduated(40, { lp_locked: [B(1), B(1)] });
    const { r } = await crank(pair, address);
    assert.equal(r.scanned, 1);
    assert.ok(r.acted.some((x) => x.steps.some((s) => s.action.kind === "register")), "register_pair_pool attempted");
  });

  test("a fully complete old pair (locked, registered, Fee Keys recorded, nothing to claim) may age out; a recent complete one is still scanned", async () => {
    const { address, pair } = graduated(40, { lp_locked: [B(1), B(1)] });
    assert.equal((await crank(pair, address, { complete: true })).r.scanned, 0);
    const fresh = graduated(2, { lp_locked: [B(1), B(1)] });
    assert.equal((await crank(fresh.pair, fresh.address, { complete: true })).r.scanned, 1);
  });
});
