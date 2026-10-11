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
import { CPMM_PROGRAM_ID, NATIVE_MINT, PAIR_CURVE_PROGRAM_ID, POOL_POLICY_PAIR_CURVE, TOKEN_PROGRAM_ID } from "../src/lib/burnReceipts/constants.ts";
import { configPda, feePda } from "../src/lib/burnReceipts/pda.ts";
import { ata, CPMM_CREATE_POOL_FEE_RECEIVER, decodePair, pairPda, poolPda, sidePoolAccounts, STATUS_GRADUATED, STATUS_GRADUATING, STATUS_OPEN, STATUS_VOIDED, vaultPda, type PairAccount } from "../src/lib/pairCurve/accounts.ts";
import { buyIx, CLAIM_THRESHOLD_LAMPORTS, claimDeveloperFeeIx, closePairIx, createPairMintIxs, graduateIx, initPairIx, pairCurveEventAuthority, planPairCrank, registerSideIx, seedObservationIxs, sellIx, voidPairIx } from "../src/lib/pairCurve/client.ts";

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
  test("seven instructions, no admin, no withdraw; the generated Powers Register is current and lists no privileged power", () => {
    assert.deepEqual(PAIR_CURVE_IDL.instructions.map((i) => i.name).sort(), ["buy", "claim_developer_fee", "close_pair", "graduate", "init_pair", "sell", "void_pair"]);
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
    version: 1, bump: 255, vault_bump: 254, status: STATUS_OPEN, mints: [ma, mb], pools: [PublicKey.default, PublicKey.default], lp_supply_at_creation: [B(0), B(0)], lp_burned: [B(0), B(0)],
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
    const { pair } = pairFixture({ status: STATUS_GRADUATING, lp_supply_at_creation: [B(1234), B(5678)], lp_burned: [B(1134), B(5578)] });
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
  test("open + ready (a trade did not commit it) → graduate A, B as separate actions; past deadline → void; thin side → wait", () => {
    const { pair } = pairFixture({ sol: [B(50_000_000_000), B(40_000_000_000)] });
    assert.deepEqual(kinds(planPairCrank(pair, 1_950_000_000, [false, false])), [["graduate", 0], ["graduate", 1]]);
    assert.equal(planPairCrank(pair, 2_000_000_000, [false, false])[0].kind, "void");
    const { pair: thin } = pairFixture({ sol: [B(80_000_000_000), B(10_000_000_000)] });
    assert.equal(planPairCrank(thin, 1_950_000_000, [false, false])[0].kind, "wait");
  });
  test("graduating → the missing side, then the existing side's registration and seed as their own actions", () => {
    const pool = Keypair.generate().publicKey;
    const { pair } = pairFixture({ status: STATUS_GRADUATING, pools: [pool, PublicKey.default], graduation_started_at: B(2_000_000_000) });
    assert.deepEqual(kinds(planPairCrank(pair, 2_000_000_100, [true, false])), [["graduate", 1]]);
    assert.deepEqual(kinds(planPairCrank(pair, 2_000_000_100, [false, false], [false, true])), [["graduate", 1], ["register", 0], ["seed", 0]]);
    // 3 days on: still try the graduate, then the stuck-side void (the program refuses it unless Raydium really blocks the side)
    assert.deepEqual(kinds(planPairCrank(pair, 2_000_000_000 + 3 * 86_400, [true, false])), [["graduate", 1], ["void", null]]);
    const { pair: refunding } = pairFixture({ status: STATUS_GRADUATING, pools: [pool, PublicKey.default], refunding: [false, true] });
    assert.deepEqual(kinds(planPairCrank(refunding, 2_100_000_000, [true, false])), [["wait", null]]);
  });
  test("graduated → missing registrations / seeds; voided → wait; a developer accrual over the threshold → claim", () => {
    const pool = Keypair.generate().publicKey;
    const { pair: g } = pairFixture({ status: STATUS_GRADUATED, pools: [pool, pool] });
    assert.deepEqual(planPairCrank(g, 0, [true, false]).map((a) => a.kind), ["register"]);
    assert.equal(planPairCrank(g, 0, [true, true])[0].kind, "wait");
    const { pair: v } = pairFixture({ status: STATUS_VOIDED });
    assert.equal(planPairCrank(v, 0, [false, false])[0].kind, "wait");
    const { pair: rich } = pairFixture({ status: STATUS_VOIDED, dev_accrued: CLAIM_THRESHOLD_LAMPORTS });
    assert.deepEqual(planPairCrank(rich, 0, [false, false]).map((a) => a.kind), ["claim"]);
  });
});
