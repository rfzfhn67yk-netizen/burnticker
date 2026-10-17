// THE pair_curve ADMIN CLI (2026-10-10) — the pair program's instructions from the command line, DRY-RUN BY DEFAULT, DEVNET /
// LOCALNET ONLY: it refuses to SEND on mainnet (the owner deploys and launches there). THIS FILE PRINTS NO KEY. Instructions come from
// the TypeScript client (src/lib/pairCurve — account order and flags from the IDL); every send is simulated first.
//
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/alias-hook.mjs scripts/paircurve-admin.mts <command> [flags]
//
// Commands:
//   init-pair   --mint-a <keypath> --mint-b <keypath> --creator <keypath> --admin <pubkey> --attester <pubkey> --launchlab-platform <pubkey>
//               --rules-a <file> --rules-b <file> --pair-id <string> [--cp-config <pubkey>] [--virtual-sol 30] [--target-sol 85]
//               [--share-bps 2500] [--deadline-secs 86400 | --deadline <ISO>] [--floor-lamports 1000000] [--twap-window 600]
//               [--twap-deviation-bps 300] [--pre-create-vault-ata] [--end-sink-a <kind>[:<mint>]:<min lamports>] [--end-sink-b …]
//               (LAUNCHPAD-PATH §45: kind flagship | mint | pair-winner — e.g. `flagship:50000000`, `pair-winner:<partner>:50000000`;
//               `pair-winner` alone names the other mint of the pair)
//               (--pre-create-vault-ata: REHEARSAL ONLY — tx 2 also creates the vault's token account for mint A from the payer before
//               init_pair, the blind-review-2 H-3 grief; init_pair must accept it.)
//               Three transactions: (1) mint A (6 decimals, no freeze authority, mint authority = the pair's SOL vault) + its
//               burn_receipts initialize_token with registration policy 2; (2) the same for B; (3) init_pair + burn_receipts.link_pair
//               (re-check P3-1). A dry run simulates (1).
//   buy         --pair <pubkey> --side A|B --sol <amount> [--min-tokens <raw>]       (quotes with src/lib/pairCurve/pricing.ts first)
//   sell        --pair <pubkey> --side A|B --amount all|<pct>%|<raw> [--min-lamports <n>] [--no-auto-void]
//               (Voided / refunding side: pro-rata redemption, no fee; an Open pair past its deadline is voided in the same transaction)
//   crank       --pair <pubkey>        what the keeper does, one transaction per action: graduate, register, void, seed, claim
//   graduate    --pair <pubkey> --side A|B [--with-register]      (registration is a separate transaction by default)
//   claim       --pair <pubkey>                                    (claim_developer_fee: the accrued 25 bps → the developer wallet)
//   register    --pair <pubkey> --side A|B                                         (burn_receipts.register_pair_pool)
//   lock        --pair <pubkey> --side A|B      (lock_lp: the side's LP into Raydium's CPMM lock forever, Fee Key → FEE_KEYS)
//   fee-key     --pair <pubkey> --side A|B      (burn_receipts.register_fee_key for the side's lock position)
//   burn-lp     --pair <pubkey> --side A|B      (burn_lp: 30-day fallback when lock_lp cannot run — burns the side's LP, no LP fees)
//   claim-lock-fees --pair <pubkey> --side A|B  (burn_receipts.claim_lock_fees: 80 % burn pool / 20 % treasury)
//   void        --pair <pubkey>
//   close       --pair <pubkey>
//   status      --pair <pubkey>        READ-ONLY: the Pair decoded, its phase, the vault and burn-pool balances, supplies, pools
//
// Common flags:
//   --cluster devnet|localnet   required; checked against the RPC's genesis hash (--rpc <url> overrides the default endpoint)
//   --burn-receipts <pubkey>    the burn_receipts id (default env BURNTICKER_PROGRAM_ID, else the IDL's address)
//   --payer <keypath>           pays fees (and rent at init-pair); signs trades as the trader
//   --dry-run (default) | --send
//
// Output: one JSON document on stdout (instructions, simulation or signatures, compute units, the pair afterwards). Progress → stderr.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { Connection, Keypair, PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { BURN_RECEIPTS_IDL } from "../src/lib/burnReceipts/idl.ts";
import { ASSOCIATED_TOKEN_PROGRAM_ID, type Cluster, GENESIS_HASH, OPERATOR_TREASURY, POOL_POLICY_PAIR_CURVE, TOKEN_PROGRAM_ID } from "../src/lib/burnReceipts/constants.ts";
import { claimLockFeesIx, initializeTokenIx, initializeTokenLayoutFromEnv, operatorAttester } from "../src/lib/burnReceipts/instructions.ts";
import { END_SINK_FLAGSHIP, END_SINK_MINT, END_SINK_PAIR_WINNER } from "../src/lib/burnReceipts/endSink.ts";
import { linkPairIx } from "../src/lib/burnReceipts/pairs.ts";
import { configPda, feePda } from "../src/lib/burnReceipts/pda.ts";
import { decodeTokenConfig } from "../src/lib/burnReceipts/accounts.ts";
import { ruleParamsFromKeeperRules } from "../src/lib/burnReceipts/math.ts";
import { redactRpcUrl } from "../src/lib/burnReceipts/crank.ts";
import { loadRules } from "../src/lib/burnKeeper/rules.ts";
import { ata, curveOf, feeNftMintPda, fetchPair, pairPda, sidePoolAccounts, STATUS_NAMES, vaultPda } from "../src/lib/pairCurve/accounts.ts";
import { buyIx, claimDeveloperFeeIx, burnLpIx, lockLpIx, registerSideFeeKeyIx, syncVaultWsolIxs, closePairIx, crankPair, createPairMintIxs, graduateIx, initPairIx, registerSideIx, sellIx, simulateAndSend, voidPairIx, type PairCurveContext, type SendResult } from "../src/lib/pairCurve/client.ts";
import { initParamProblems, pairPhase, quoteBuy, quoteRedeem, quoteSell, sideCosts, DEFAULT_CURVE_SUPPLY, DEFAULT_VIRTUAL_TOKEN_AMOUNT } from "../src/lib/pairCurve/pricing.ts";

const args = process.argv.slice(2);
const COMMANDS = ["init-pair", "buy", "sell", "crank", "graduate", "lock", "register", "fee-key", "burn-lp", "claim-lock-fees", "void", "close", "claim", "status"] as const;
type Command = (typeof COMMANDS)[number];
const CMD = (COMMANDS as readonly string[]).includes(args[0]) ? (args[0] as Command) : null;
const flag = (n: string) => args.includes(`--${n}`);
const opt = (n: string): string | undefined => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : undefined; };
const say = (s: string) => console.error(s);
const die = (s: string, code = 2): never => { console.error(`refusing: ${s}`); process.exit(code); };
if (!CMD) { say(fs.readFileSync(new URL(import.meta.url)).toString().split("\n").filter((l) => l.startsWith("//")).map((l) => l.slice(3)).join("\n")); process.exit(args[0] ? 2 : 0); }

const CLUSTER = opt("cluster");
if (CLUSTER === "mainnet") die("this CLI never sends on mainnet — the owner deploys and launches there (docs/burnticker/runbook.md \"Pair program gates\")");
if (CLUSTER !== "devnet" && CLUSTER !== "localnet") die("--cluster devnet|localnet is required");
const cluster = CLUSTER as Cluster;
const SEND = flag("send");
const rpc = opt("rpc")?.trim() || (cluster === "devnet" ? "https://api.devnet.solana.com" : "http://127.0.0.1:8899");
const connection = new Connection(rpc, "confirmed");
const rpcShown = redactRpcUrl(rpc);
{
  const g = await connection.getGenesisHash();
  if (g === GENESIS_HASH.mainnet) die(`the RPC ${rpcShown} is MAINNET`);
  if (cluster === "devnet" && g !== GENESIS_HASH.devnet) die(`the RPC ${rpcShown} is not devnet (genesis ${g})`);
}
const pk = (v: string | undefined, what: string): PublicKey => { if (!v) return die(`${what} is required`); try { return new PublicKey(v.trim()); } catch { return die(`${what}: ${v} is not a pubkey`); } };
const burnReceipts = pk(opt("burn-receipts") ?? process.env.BURNTICKER_PROGRAM_ID ?? BURN_RECEIPTS_IDL.address, "--burn-receipts");
const ctx: PairCurveContext = { connection, cluster, burnReceiptsProgramId: burnReceipts, computeUnits: 600_000 };

async function keyfile(name: string): Promise<Keypair> {
  const v = opt(name) ?? die(`--${name} <keypath> is required`);
  if (!fs.existsSync(v)) die(`--${name}: ${v} does not exist`);
  if (["signer.enc.json", "signer.json"].includes(path.basename(v))) die(`--${name}: ${v} is the treasury's key file`);
  const { loadKeypair } = await import("../src/lib/burnKeeper/keyfile.ts");
  return loadKeypair({ keyPath: v });
}
const jsonSafe = (v: unknown): unknown => JSON.parse(JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x instanceof PublicKey ? x.toBase58() : x instanceof Uint8Array ? Buffer.from(x).toString("hex") : x?.type === "Buffer" && Array.isArray(x.data) ? Buffer.from(x.data).toString("hex") : x)));
const print = (o: Record<string, unknown>, code = 0): never => { console.log(JSON.stringify(jsonSafe({ command: CMD, cluster, rpc: rpcShown, dryRun: !SEND, ...o }), null, 2)); process.exit(code); };
const short = (r: SendResult) => ({ ok: r.ok, signature: r.signature ?? null, error: r.error ?? null, unitsConsumed: r.units ?? null, txBytes: r.size ?? null, logs: r.ok ? undefined : r.logs.slice(-12) });
const sideOf = (): 0 | 1 => { const s = (opt("side") ?? die("--side A|B is required")).toUpperCase(); return s === "A" ? 0 : s === "B" ? 1 : die("--side A|B"); };

async function statusOf(pair: PublicKey): Promise<Record<string, unknown>> {
  const p = await fetchPair(connection, pair);
  if (!p) return { pair: pair.toBase58(), exists: false };
  const now = Math.floor(Date.now() / 1000);
  const bal = async (k: PublicKey) => connection.getBalance(k, "confirmed");
  const supply = async (m: PublicKey) => { try { return (await connection.getTokenSupply(m, "confirmed")).value.amount; } catch { return null; } };
  const cfg = async (m: PublicKey) => { const a = await connection.getAccountInfo(configPda(burnReceipts, m), "confirmed"); if (!a) return null; const c = decodeTokenConfig(a.data); return { registrationPolicy: c.registration_policy, cpmmPool: c.cpmm_pool.toBase58(), poolVerified: c.pool_verified, burns: c.burns, totalBurned: c.total_burned }; };
  return {
    pair: pair.toBase58(), exists: true, status: STATUS_NAMES[p.status], phase: pairPhase({ status: p.status, solA: p.sol[0], solB: p.sol[1], target: p.target_raise_lamports, shareBps: p.min_side_share_bps, deadline: Number(p.deadline) }, now),
    deadline: new Date(Number(p.deadline) * 1000).toISOString(), vault: p.vault.toBase58(), vaultLamports: await bal(p.vault), devWallet: p.dev_wallet.toBase58(), devAccrued: p.dev_accrued, devWalletLamports: await bal(p.dev_wallet),
    sides: await Promise.all([0, 1].map(async (s) => ({ side: s === 0 ? "A" : "B", mint: p.mints[s].toBase58(), supplyRaw: await supply(p.mints[s]), sold: p.sold[s], sol: p.sol[s], burnPool: p.fee_vaults[s].toBase58(), burnPoolLamports: await bal(p.fee_vaults[s]),
      burnFees: p.burn_fees_lamports[s], devFees: p.dev_fees_lamports[s], burnEscrow: p.burn_escrow[s], refunding: p.refunding[s], redeemPool: p.redeem_pool[s], redeemSupply: p.redeem_supply[s], trades: p.trades[s], pool: p.pools[s].toBase58(), poolSol: p.pool_sol[s], poolTokens: p.pool_tokens[s], lpSupplyAtCreation: p.lp_supply_at_creation[s], lpLocked: p.lp_locked[s], tokensBurned: p.tokens_burned[s], tokenConfig: await cfg(p.mints[s]) }))),
    params: { virtualSol: p.virtual_sol_lamports, virtualToken: p.virtual_token_amount, curveSupply: p.curve_supply, reserve: p.reserve_supply, targetRaise: p.target_raise_lamports, minSideShareBps: p.min_side_share_bps },
  };
}

if (CMD === "status") print(await statusOf(pk(opt("pair"), "--pair")));

const payer = await keyfile("payer");
if (CMD === "init-pair") {
  const [mintA, mintB, creator] = [await keyfile("mint-a"), await keyfile("mint-b"), await keyfile("creator")];
  const admin = pk(opt("admin"), "--admin"), attester = pk(opt("attester"), "--attester"), platform = pk(opt("launchlab-platform"), "--launchlab-platform");
  const pair = pairPda(mintA.publicKey, mintB.publicKey), vault = vaultPda(pair);
  // The cpConfigId the platform names (what initialize_token will pin).
  const platAcc = await connection.getAccountInfo(platform, "confirmed") ?? die(`no LaunchLab platform at ${platform.toBase58()}`);
  const cpConfig = opt("cp-config") ? pk(opt("cp-config"), "--cp-config") : new PublicKey(platAcc.data.subarray(688, 720));
  const amm = await connection.getAccountInfo(cpConfig, "confirmed") ?? die(`no AmmConfig at ${cpConfig.toBase58()}`);
  const createPoolFee = amm.data.readBigUInt64LE(36);
  const now = Math.floor(Date.now() / 1000);
  const deadline = opt("deadline") ? Math.floor(Date.parse(opt("deadline")!) / 1000) : now + Number(opt("deadline-secs") ?? 86_400);
  const sol = (s: string) => BigInt(Math.round(Number(s) * 1e9));
  const params = { virtualSolLamports: sol(opt("virtual-sol") ?? "30"), virtualTokenAmount: DEFAULT_VIRTUAL_TOKEN_AMOUNT, curveSupply: DEFAULT_CURVE_SUPPLY, targetRaiseLamports: sol(opt("target-sol") ?? "85"), minSideShareBps: Number(opt("share-bps") ?? 2500), deadline };
  // The cluster's real rent (the program reads the Rent sysvar; 5,080 lamports/byte on devnet and mainnet in 2026-10).
  const rents = new Map<number, bigint>();
  for (const size of [82, 165, 637, 4_075]) rents.set(size, BigInt(await connection.getMinimumBalanceForRentExemption(size)));
  const rentOf = (size: number): bigint => rents.get(size) ?? die(`no rent for ${size}`);
  const problems = initParamProblems(params, now, createPoolFee, rentOf);
  if (problems.length) die(`parameters: ${problems.join("; ")}`);
  const rent = await connection.getMinimumBalanceForRentExemption(82);
  // LAUNCHPAD-PATH §45: an optional end sink per side ("flagship:<min>", "mint:<mint>:<min>", "pair-winner[:<mint>]:<min>").
  const endSinkOf = (flagName: string, other: PublicKey): { kind: number; sinkMint?: PublicKey; minForwardLamports: bigint } | undefined => {
    const v = opt(flagName);
    if (!v) return undefined;
    const parts = v.split(":");
    const min = BigInt(parts[parts.length - 1]);
    if (parts[0] === "flagship" && parts.length === 2) return { kind: END_SINK_FLAGSHIP, minForwardLamports: min };
    if (parts[0] === "mint" && parts.length === 3) return { kind: END_SINK_MINT, sinkMint: pk(parts[1], `--${flagName}`), minForwardLamports: min };
    if (parts[0] === "pair-winner" && (parts.length === 2 || parts.length === 3)) return { kind: END_SINK_PAIR_WINNER, sinkMint: parts.length === 3 ? pk(parts[1], `--${flagName}`) : other, minForwardLamports: min };
    return die(`--${flagName}: flagship:<min> | mint:<mint>:<min> | pair-winner[:<mint>]:<min>`);
  };
  const tokenIx = (mint: PublicKey, file: string, endSink?: { kind: number; sinkMint?: PublicKey; minForwardLamports: bigint }): { ix: TransactionInstruction; sha: string } => {
    const loaded = loadRules(file);
    if (loaded.rules.mint && loaded.rules.mint !== mint.toBase58()) die(`${file} names mint ${loaded.rules.mint}, not ${mint.toBase58()}`);
    const rule = ruleParamsFromKeeperRules(loaded.rules, { floorLamports: BigInt(opt("floor-lamports") ?? 1_000_000), maxTwapDeviationBps: Number(opt("twap-deviation-bps") ?? 300), twapWindowSecs: Number(opt("twap-window") ?? 600) });
    rule.pool_policy = POOL_POLICY_PAIR_CURVE;
    const ix = initializeTokenIx({ programId: burnReceipts, payer: payer.publicKey, creator: creator.publicKey, mint, launchlabPlatform: platform, args: { feed_id: loaded.rules.feed.id, memo_prefix: loaded.rules.memo.prefix, memo_source: loaded.rules.feed.memoSource, rules_sha256: Buffer.from(loaded.sha256, "hex"), rule, attesters: [operatorAttester(attester)], quorum: 1, fixed_pool: PublicKey.default, admin }, layout: endSink || opt("program-round") === "4" ? "r4" : opt("program-round") === "3" ? "r3" : initializeTokenLayoutFromEnv(), ...(endSink ? { endSink } : {}) });
    return { ix, sha: loaded.sha256 };
  };
  const a = tokenIx(mintA.publicKey, opt("rules-a") ?? die("--rules-a <file> is required"), endSinkOf("end-sink-a", mintB.publicKey));
  const b = tokenIx(mintB.publicKey, opt("rules-b") ?? die("--rules-b <file> is required"), endSinkOf("end-sink-b", mintA.publicKey));
  const pairId = opt("pair-id") ?? die("--pair-id <string> is required");
  const initPair = initPairIx({ payer: payer.publicKey, creator: creator.publicKey, mintA: mintA.publicKey, mintB: mintB.publicKey, launchlabPlatform: platform, ammConfig: cpConfig, burnReceiptsProgramId: burnReceipts,
    args: { pair_id: Uint8Array.from(crypto.createHash("sha256").update(pairId, "utf8").digest()), virtual_sol_lamports: params.virtualSolLamports, virtual_token_amount: params.virtualTokenAmount, curve_supply: params.curveSupply, target_raise_lamports: params.targetRaiseLamports, min_side_share_bps: params.minSideShareBps, deadline: BigInt(deadline) } });
  const tx1 = [...createPairMintIxs({ payer: payer.publicKey, mint: mintA.publicKey, vault, rentLamports: rent }), a.ix];
  const tx2 = [...createPairMintIxs({ payer: payer.publicKey, mint: mintB.publicKey, vault, rentLamports: rent }), b.ix];
  if (flag("pre-create-vault-ata")) tx2.push(new TransactionInstruction({ programId: ASSOCIATED_TOKEN_PROGRAM_ID, data: Buffer.from([1]), keys: [
    { pubkey: payer.publicKey, isSigner: true, isWritable: true }, { pubkey: ata(vault, mintA.publicKey), isSigner: false, isWritable: true }, { pubkey: vault, isSigner: false, isWritable: false },
    { pubkey: mintA.publicKey, isSigner: false, isWritable: false }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false } ] }));
  const plan = { pair: pair.toBase58(), vault: vault.toBase58(), mints: { a: mintA.publicKey.toBase58(), b: mintB.publicKey.toBase58() }, rulesSha256: { a: a.sha, b: b.sha }, pairId, cpConfig: cpConfig.toBase58(), createPoolFee, sideCosts: sideCosts(createPoolFee, rentOf), params, burnPools: { a: feePda(burnReceipts, mintA.publicKey).toBase58(), b: feePda(burnReceipts, mintB.publicKey).toBase58() } };
  const steps: Record<string, unknown> = {};
  const r1 = await simulateAndSend(ctx, tx1, [payer, creator, mintA], { dryRun: !SEND });
  steps.mintAndConfigA = short(r1);
  if (!r1.ok || !SEND) print({ plan, steps }, r1.ok ? 0 : 1);
  const r2 = await simulateAndSend(ctx, tx2, [payer, creator, mintB]);
  steps.mintAndConfigB = short(r2);
  if (!r2.ok) print({ plan, steps }, 1);
  // re-check P3-1: link_pair in the same transaction as init_pair (the Pair exists inside it), so the pair is never left unlinked
  const r3 = await simulateAndSend(ctx, [initPair, linkPairIx({ programId: burnReceipts, payer: payer.publicKey, pair, mintA: mintA.publicKey, mintB: mintB.publicKey })], [payer, creator]);
  steps.initPair = short(r3);
  print({ plan, steps, after: r3.ok ? await statusOf(pair) : null }, r3.ok ? 0 : 1);
}

const pairKey = pk(opt("pair"), "--pair");
const p = (await fetchPair(connection, pairKey)) ?? die(`no Pair at ${pairKey.toBase58()}`);
const send = async (ixs: TransactionInstruction[], extra: Record<string, unknown> = {}): Promise<never> => {
  const r = await simulateAndSend(ctx, ixs, [payer], { dryRun: !SEND });
  return print({ pair: pairKey.toBase58(), ...extra, result: short(r), after: SEND && r.ok ? await statusOf(pairKey) : undefined }, r.ok ? 0 : 1);
};
if (CMD === "buy") {
  const side = sideOf();
  const maxIn = BigInt(Math.round(Number(opt("sol") ?? die("--sol <amount> is required")) * 1e9));
  const q = quoteBuy(curveOf(p), p.sold[side], maxIn);
  const minOut = opt("min-tokens") ? BigInt(opt("min-tokens")!) : q.tokensOut;
  await send([buyIx({ buyer: payer.publicKey, pairAddress: pairKey, pair: p, side, maxLamportsIn: maxIn, minTokensOut: minOut })], { side: side === 0 ? "A" : "B", quote: q });
}
if (CMD === "sell") {
  const side = sideOf();
  const held = BigInt((await connection.getTokenAccountBalance(ata(payer.publicKey, p.mints[side]), "confirmed")).value.amount);
  const a = opt("amount") ?? "all";
  const amt = a === "all" ? held : /^\d+(\.\d+)?%$/.test(a) ? (held * BigInt(Math.round(Number(a.slice(0, -1)) * 100))) / BigInt(10_000) : BigInt(a);
  // An Open pair at/after its deadline can only void: the program refuses curve sells there (re-check RC-1), so the CLI voids first in
  // the same transaction and quotes the redemption the void will snapshot. --no-auto-void sends the bare sell (rehearsal: shows the refusal).
  const expiredOpen = p.status === 0 && Math.floor(Date.now() / 1000) >= Number(p.deadline) && !flag("no-auto-void");
  const redeeming = p.status === 2 || p.refunding[side] || expiredOpen;
  const pool = expiredOpen ? p.sol[side] + p.burn_escrow[side] : p.redeem_pool[side];
  const supply = expiredOpen ? p.sold[side] : p.redeem_supply[side];
  const left = expiredOpen ? pool : p.sol[side];
  const q = redeeming ? { redemption: true, voidsFirst: expiredOpen, net: quoteRedeem(pool, supply, p.sold[side], left, amt) } : quoteSell(curveOf(p), p.sold[side], amt);
  const ixs = expiredOpen ? [voidPairIx({ caller: payer.publicKey, pairAddress: pairKey, pair: p })] : [];
  ixs.push(sellIx({ seller: payer.publicKey, pairAddress: pairKey, pair: p, side, amount: amt, minLamportsOut: opt("min-lamports") ? BigInt(opt("min-lamports")!) : q.net }));
  await send(ixs, { side: side === 0 ? "A" : "B", amount: amt, quote: q });
}
if (CMD === "graduate") {
  const side = sideOf();
  const ixs = [...(await syncVaultWsolIxs(connection, p)), graduateIx({ cranker: payer.publicKey, pairAddress: pairKey, pair: p, side, cluster })];
  if (flag("with-register")) ixs.push(registerSideIx({ registrar: payer.publicKey, pairAddress: pairKey, pair: p, side, cluster, burnReceiptsProgramId: burnReceipts }));
  await send(ixs, { side: side === 0 ? "A" : "B", pool: sidePoolAccounts(cluster, pairKey, side, p.mints[side]).pool });
}
if (CMD === "register") { const side = sideOf(); await send([registerSideIx({ registrar: payer.publicKey, pairAddress: pairKey, pair: p, side, cluster, burnReceiptsProgramId: burnReceipts })], { side: side === 0 ? "A" : "B" }); }
if (CMD === "lock") { const side = sideOf(); await send([lockLpIx({ cranker: payer.publicKey, pairAddress: pairKey, pair: p, side, cluster, burnReceiptsProgramId: burnReceipts })], { side: side === 0 ? "A" : "B", feeNftMint: feeNftMintPda(pairKey, side).toBase58() }); }
if (CMD === "burn-lp") { const side = sideOf(); await send([burnLpIx({ cranker: payer.publicKey, pairAddress: pairKey, pair: p, side, cluster })], { side: side === 0 ? "A" : "B" }); }
if (CMD === "fee-key") { const side = sideOf(); await send([registerSideFeeKeyIx({ payer: payer.publicKey, pairAddress: pairKey, pair: p, side, cluster, burnReceiptsProgramId: burnReceipts })], { side: side === 0 ? "A" : "B" }); }
if (CMD === "claim-lock-fees") {
  const side = sideOf();
  const s = sidePoolAccounts(cluster, pairKey, side, p.mints[side]);
  await send([claimLockFeesIx({ programId: burnReceipts, cranker: payer.publicKey, mint: p.mints[side], feeNftMint: feeNftMintPda(pairKey, side), pool: { pool: s.pool, lpMint: s.lpMint, token0Vault: s.poolVault0, token1Vault: s.poolVault1 }, cluster })], { side: side === 0 ? "A" : "B", treasury: OPERATOR_TREASURY[cluster].toBase58() });
}
if (CMD === "void") await send([voidPairIx({ caller: payer.publicKey, pairAddress: pairKey, pair: p })]);
if (CMD === "claim") await send([claimDeveloperFeeIx({ caller: payer.publicKey, pairAddress: pairKey, pair: p })]);
if (CMD === "close") await send([closePairIx({ caller: payer.publicKey, pairAddress: pairKey, pair: p })]);
if (CMD === "crank") {
  const steps = await crankPair(ctx, payer, pairKey, { dryRun: !SEND, log: say });
  print({ pair: pairKey.toBase58(), steps: steps.map((s) => ({ action: s.action, result: s.result ? short(s.result) : null })), after: SEND ? await statusOf(pairKey) : undefined }, steps.every((s) => !s.result || s.result.ok) ? 0 : 1);
}
