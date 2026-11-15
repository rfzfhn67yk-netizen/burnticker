// THE BURN KEEPER ON DEVNET, END TO END (2026-10-09) — real (devnet) burns with real memos, so the owner can see the mechanism work
// before anything exists on mainnet. DEVNET ONLY: the script reads the RPC's genesis hash and refuses any other cluster.
//
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/alias-hook.mjs scripts/burnkeeper-devnet-demo.mts --run
//   (… --run --mode=vault for the alternative vesting-vault mechanic; BURNKEEPER_DEVNET_RPC_URL overrides api.devnet.solana.com)
//
// What it does:
//   1. generates TWO THROWAWAY keypairs in memory — a payer/creator and a keeper — never written anywhere (and never under
//      ~/.config/meme-coin-trader); they die with the process
//   2. airdrops devnet SOL to the payer (if the public faucet refuses, it prints the address and waits up to 5 minutes for you to
//      fund it at https://faucet.solana.com)
//   3. creates a test SPL mint (6 decimals, 1,000,000,000 supply) and revokes the mint authority (fixed supply), then by mode:
//        buyback (the PRIMARY mechanic, default): the whole supply sits with the payer, standing in for the public pool's inventory;
//          the keeper's wallet — the FEE POOL — gets 0.1 SOL (standing in for claimed creator fees)
//        vault (the alternative): 500,000,000 into the keeper's vault, 500,000,000 to the payer
//   4. runs the keeper's own cycle (src/lib/burnKeeper/cycle.ts + solanaChain.ts — the production code) for three REPLAYED Treasury
//      days, 2026-10-06 → 10-08, from the frozen fixture with 2026-10-05 as the baseline
//        buyback: spend = pool × (1 − 0.95^units) → the SWAP LEG IS A STUB, clearly labelled: a fresh devnet mint has no pool to
//          trade against, so the "swap" is a real devnet transaction in which the keeper pays the SOL to the payer and the payer
//          sends tokens back at a FIXED DEVNET PRICE (10,000,000 tokens per SOL; SOL valued at a fixed $150 for the $1 floor), with
//          a "STUB SWAP" memo. Everything after it is real and unchanged: the delivered amount is read from that transaction's meta,
//          then the keeper's REAL BurnChecked of every token it holds + the REAL v2 memo. On mainnet the swap is the live router
//          (Jupiter, validated: SOL in, the configured mint out, the keeper the only signer).
//        vault: one BurnChecked + v1 memo per day from the vault
//   5. prints the explorer links (stub swaps and burns), the memos and the resulting supply; publishes the status site to a temp dir
//
// Without --run it prints this help and exits. Nothing here touches mainnet, reads a real key, or moves real funds.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Connection, Keypair, LAMPORTS_PER_SOL, SystemProgram, Transaction, TransactionMessage, VersionedTransaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { rawToTokens, rulesFromText, tokensToRaw, type LoadedRules } from "../src/lib/burnKeeper/rules.ts";
import { validateDebtResponse } from "../src/lib/burnKeeper/feeds/treasury.ts";
import { openLedger } from "../src/lib/burnKeeper/ledger.ts";
import { executePending, ingest, type BuybackPort } from "../src/lib/burnKeeper/cycle.ts";
import { associatedTokenAddress, base58Encode, clusterOfGenesis, createAtaIdempotentIx, explorerUrl, initializeMint2Ix, MINT_SIZE, memoIx, mintToIx, revokeMintAuthorityIx, TOKEN_PROGRAM_ID, transferCheckedIx } from "../src/lib/burnKeeper/solana.ts";
import { solanaChain } from "../src/lib/burnKeeper/solanaChain.ts";
import { buildBurnsJson, buildStatus, publishSite, renderIndexHtml, toJson } from "../src/lib/burnKeeper/statusPage.ts";

const HELP = "usage: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/alias-hook.mjs scripts/burnkeeper-devnet-demo.mts --run [--mode=buyback|vault]";
if (!process.argv.includes("--run")) { console.log(HELP); console.log("(devnet only; throwaway keys in memory; see the header of this file)"); process.exit(0); }

const log = (s: string) => console.log(s);
const rpc = process.env.BURNKEEPER_DEVNET_RPC_URL?.trim() || "https://api.devnet.solana.com";
const connection = new Connection(rpc, "confirmed");
const genesis = await connection.getGenesisHash();
if (clusterOfGenesis(genesis) !== "devnet") { console.error(`refusing: ${rpc} is ${clusterOfGenesis(genesis)}, not devnet`); process.exit(2); }

const committed = fs.readFileSync(path.resolve("config/burnkeeper/deficit.rules.json"), "utf8");
const MODE = (process.argv.find((a) => a.startsWith("--mode="))?.slice(7) ?? "buyback") as "buyback" | "vault";
// The vault mode is the committed file switched to mode "vault" (source and memo version follow) — the rule otherwise identical.
const loaded: LoadedRules = rulesFromText(MODE === "vault" ? committed.replace('"mode": "buyback"', '"mode": "vault"').replace('"source": "fee-pool-buyback"', '"source": "vault-only"').replace('"version": "v2"', '"version": "v1"') : committed);
const DEC = loaded.rules.decimals;
const payer = Keypair.generate(), keeper = Keypair.generate(), mintKp = Keypair.generate();
log(`devnet · mode ${MODE} · payer ${payer.publicKey.toBase58()} · keeper ${keeper.publicKey.toBase58()} (throwaway, in memory only)`);

async function fund(): Promise<void> {
  // The public faucet rate-limits by IP and often refuses 1 SOL while granting less: ask for less, a few times.
  for (const sol of [1, 0.5, 0.2]) {
    try {
      const sig = await connection.requestAirdrop(payer.publicKey, sol * LAMPORTS_PER_SOL);
      const bh = await connection.getLatestBlockhash();
      await connection.confirmTransaction({ signature: sig, ...bh }, "confirmed");
      log(`airdropped ${sol} SOL to the payer: ${explorerUrl("devnet", sig)}`);
      return;
    } catch (e) {
      log(`the faucet refused ${sol} SOL (${(e as Error).message.slice(0, 100)})`);
      await new Promise((r) => setTimeout(r, 3_000));
    }
  }
  log(`fund ${payer.publicKey.toBase58()} with ≥ 0.2 devnet SOL at https://faucet.solana.com — waiting up to 5 minutes…`);
  const until = Date.now() + 5 * 60_000;
  while (Date.now() < until) {
    if ((await connection.getBalance(payer.publicKey, "confirmed")) >= 0.15 * LAMPORTS_PER_SOL) { log("funded."); return; }
    await new Promise((r) => setTimeout(r, 5_000));
  }
  throw new Error("the payer was not funded");
}
await fund();

// Mint (1B supply, authority revoked) and the token accounts.
const keeperAta = associatedTokenAddress(keeper.publicKey, mintKp.publicKey);
const payerAta = associatedTokenAddress(payer.publicKey, mintKp.publicKey);
const rent = await connection.getMinimumBalanceForRentExemption(MINT_SIZE);
const setup = new Transaction().add(
  SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: keeper.publicKey, lamports: (MODE === "buyback" ? 0.1 : 0.02) * LAMPORTS_PER_SOL }),
  SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: mintKp.publicKey, lamports: rent, space: MINT_SIZE, programId: TOKEN_PROGRAM_ID }),
  initializeMint2Ix(mintKp.publicKey, DEC, payer.publicKey),
  createAtaIdempotentIx(payer.publicKey, keeper.publicKey, mintKp.publicKey),
  createAtaIdempotentIx(payer.publicKey, payer.publicKey, mintKp.publicKey),
  ...(MODE === "vault"
    ? [mintToIx(mintKp.publicKey, keeperAta, payer.publicKey, tokensToRaw("500000000", DEC)), mintToIx(mintKp.publicKey, payerAta, payer.publicKey, tokensToRaw("500000000", DEC))]
    : [mintToIx(mintKp.publicKey, payerAta, payer.publicKey, tokensToRaw("1000000000", DEC))]),
  revokeMintAuthorityIx(mintKp.publicKey, payer.publicKey),
);
const setupSig = await sendAndConfirmTransaction(connection, setup, [payer, mintKp], { commitment: "confirmed" });
log(`mint ${mintKp.publicKey.toBase58()} created: 1,000,000,000 supply, mint authority revoked`);
log(MODE === "vault" ? `  500,000,000 in the vault ${keeperAta.toBase58()} (the keeper's own token account)` : `  the whole supply with the payer (standing in for the pool); the keeper's fee pool holds 0.1 SOL`);
log(`  setup tx ${explorerUrl("devnet", setupSig)}`);

// THE STUB ROUTER (devnet only, clearly labelled): a real devnet transaction trading the keeper's SOL for the payer's tokens at a fixed
// price. The production router (solanaBuyback in solanaChain.ts) replaces exactly this object on mainnet.
const STUB_TOKENS_PER_SOL = tokensToRaw("10000000", DEC);
const STUB_SOL_USD = 150;
function stubRouter(): BuybackPort {
  return {
    feeBalanceLamports: async () => BigInt(await connection.getBalance(keeper.publicKey, "confirmed")),
    solUsd: async () => STUB_SOL_USD,
    async buildSwap(lamports) {
      const tokens = (lamports * STUB_TOKENS_PER_SOL) / BigInt(LAMPORTS_PER_SOL);
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
      const msg = new TransactionMessage({ payerKey: keeper.publicKey, recentBlockhash: blockhash, instructions: [
        SystemProgram.transfer({ fromPubkey: keeper.publicKey, toPubkey: payer.publicKey, lamports: Number(lamports) }),
        transferCheckedIx(payerAta, mintKp.publicKey, keeperAta, payer.publicKey, tokens, DEC),
        memoIx(`STUB SWAP (devnet demo: no pool exists for a fresh mint; mainnet uses the live router) ${lamports} lamports -> ${tokens} raw`, keeper.publicKey),
      ] }).compileToV0Message();
      const tx = new VersionedTransaction(msg);
      tx.sign([keeper, payer]);
      return { signature: base58Encode(tx.signatures[0]), raw: tx.serialize(), blockhash, lastValidBlockHeight, quotedOutRaw: tokens };
    },
    async swapReceivedRaw(signature) {
      const t = await connection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
      if (!t?.meta) return null;
      const owner = keeper.publicKey.toBase58(), mint = mintKp.publicKey.toBase58();
      const sum = (xs: typeof t.meta.postTokenBalances) => (xs ?? []).filter((x) => x.owner === owner && x.mint === mint).reduce((a, x) => a + BigInt(x.uiTokenAmount.amount), BigInt(0));
      return sum(t.meta.postTokenBalances) - sum(t.meta.preTokenBalances);
    },
  };
}

// The keeper's cycle, three replayed Treasury days.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "burnkeeper-devnet-"));
const ledger = openLedger(path.join(dir, "burnkeeper-devnet.db"));
const chain = solanaChain({ connection, keeper, mint: mintKp.publicKey, vault: keeperAta, decimals: DEC, cluster: "devnet", log });
const vr = await chain.checkVault();
if (vr) throw new Error(`token account check: ${vr}`);
ledger.bindIdentity({ cluster: genesis, mint: mintKp.publicKey.toBase58(), vault: keeperAta.toBase58(), keeper: keeper.publicKey.toBase58(), rulesSha256: loaded.sha256 });
const router = MODE === "buyback" ? stubRouter() : undefined;
const fixture = JSON.parse(fs.readFileSync(path.resolve("test/fixtures/treasury-debt-to-penny-2024-12-to-2026-10-08.json"), "utf8"));
const days = validateDebtResponse(fixture).readings.filter((r) => r.recordDate >= "2026-10-05" && r.recordDate <= "2026-10-08");
const ctx = { ledger, loaded, log, now: () => Date.now(), dryRun: false };
ingest(ctx, { readings: days.slice(0, 1), refusals: [] });                 // 2026-10-05: the baseline
for (const day of days.slice(1)) {                                           // one replayed Treasury day at a time, as the keeper sees them
  ingest(ctx, { readings: [day], refusals: [] });
  const out = await executePending(ctx, chain, router);
  for (const o of out) if (o.outcome !== "confirmed") log(`  ${o.recordDate}: ${o.outcome}${"why" in o ? ` — ${o.why}` : ""}`);
}

const burns = ledger.burns("DEBT", "treasury.debt_to_penny");
log(`\nTHE THREE ${MODE === "buyback" ? "BUYBACK DAYS" : "BURNS"}`);
for (const b of burns) {
  log(`  ${b.recordDate}  ${b.units} units  ${rawToTokens(b.burnRaw ?? BigInt(0), DEC)} burned${b.spendLamports !== null ? ` (spent ${rawToTokens(b.spendLamports, 9)} SOL of a ${rawToTokens(b.poolLamports ?? BigInt(0), 9)} SOL pool)` : ""}`);
  if (b.swapSig) log(`    stub swap ${explorerUrl("devnet", b.swapSig)}`);
  log(`    burn      ${b.signature ? explorerUrl("devnet", b.signature) : b.status}\n    memo: ${b.memo}`);
}
const supply = await chain.supplyRaw(), held = await chain.vaultBalanceRaw();
log(`\nsupply now ${rawToTokens(supply, DEC)} (from 1000000000) · keeper token account ${rawToTokens(held, DEC)}${MODE === "vault" ? " (from 500000000)" : " (burns everything it buys)"}`);
const feeLamports = router ? await router.feeBalanceLamports() : null;
const input = { loaded, readings: ledger.readings("DEBT", "treasury.debt_to_penny"), burns, now: Date.now(), nextPollAt: null, lastPoll: null, lastError: null, funding: null,
  chain: { cluster: "devnet", mint: mintKp.publicKey.toBase58(), vault: keeperAta.toBase58(), keeper: keeper.publicKey.toBase58(), supplyRaw: supply, vaultRaw: held, feeLamports } };
const bj = buildBurnsJson(input), st = buildStatus(input, bj);
publishSite(path.join(dir, "site"), { "status.json": toJson(st), "burns.json": toJson(bj), "rules.json": loaded.text, "index.html": renderIndexHtml(st, bj, input.readings) });
log(`status site: ${path.join(dir, "site", "index.html")} · verified ${bj.filter((b) => b.verify.verified).length}/${bj.length}`);
ledger.close();
