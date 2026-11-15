// THE SWAP PANEL'S DEVNET PROOF (swap-1, 2026-10-14). Runs the coin page's swap panel code (src/lib/burnticker/swap/*: the same
// readMarket → quoteSwap → buildSwap → simulateSignSend the browser runs) against real devnet pools with a THROWAWAY keypair made here
// and funded by the devnet faucet, then reads each confirmed transaction back and compares the fill with the quote and the minimum out.
// DEVNET ONLY: it reads the RPC's genesis hash and refuses anything else. No operator key is read; the throwaway key is printed nowhere.
//
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/alias-hook.mjs scripts/burnticker-swap-proof.mts \
//     [--curve-mint <mint on a trading LaunchLab curve>] [--cpmm-mint <mint> --cpmm-pool <registered CPMM pool>] [--sol 0.05] [--rpc <devnet url>]
//     [--payer-file <throwaway keypair json, written by --save-payer on a first run, so a second run needs no faucet>]
//
// Without flags: the curve is a devnet LaunchLab pool still trading (9ZrDLizB…), the CPMM pool is the devnet rehearsal coin's
// registered pool (4QnwyiBM… / 5RoGVSCT…).

import fs from "node:fs";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, type VersionedTransaction } from "@solana/web3.js";
import { readBalances, readMarket, simulateSignSend, explorerTxUrl, GENESIS_HASH } from "@/lib/burnticker/swap/chain";
import { buildSwap, coinRefusal, marketRefusal, quoteSwap, type Side } from "@/lib/burnticker/swap/plan";
import { formatAmount, parseAmount } from "@/lib/burnticker/swap/math";

const args = process.argv.slice(2);
const opt = (n: string): string | undefined => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : undefined; };
const die = (s: string): never => { console.error(`refusing: ${s}`); process.exit(2); };
const conn = new Connection(opt("rpc") ?? "https://api.devnet.solana.com", "confirmed");
if ((await conn.getGenesisHash()) !== GENESIS_HASH.devnet) die("the RPC is not devnet; this proof is devnet-only");

const curveMint = new PublicKey(opt("curve-mint") ?? "9ZrDLizBrjH4eAWHuKfqjgPxeWHcfdsAqNm3PExJtp8b");
const cpmmMint = new PublicKey(opt("cpmm-mint") ?? "4QnwyiBMm2Caz5tJr9hNGzT2wqZcMipZjFHiSBu7AM4F");
const cpmmPool = new PublicKey(opt("cpmm-pool") ?? "5RoGVSCTBmcTSXdUgoktteBAi5sXTrax7QiJ6rh8hNyR");
const solIn = parseAmount(opt("sol") ?? "0.05", 9) ?? die("--sol must be a plain number");
const SLIPPAGE_BPS = 200;

// the throwaway payer: made here (or re-read from a throwaway file this script wrote), funded by the faucet
const payerFile = opt("payer-file");
const payer = payerFile && fs.existsSync(payerFile) ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(payerFile, "utf8")) as number[])) : Keypair.generate();
if (payerFile && !fs.existsSync(payerFile) && args.includes("--save-payer")) fs.writeFileSync(payerFile, JSON.stringify([...payer.secretKey]), { mode: 0o600 });
console.log(`throwaway payer ${payer.publicKey.toBase58()} (devnet)`);
if ((await conn.getBalance(payer.publicKey)) < 0.3 * LAMPORTS_PER_SOL) {
  for (let i = 0; i < 5; i++) {
    try { const sig = await conn.requestAirdrop(payer.publicKey, LAMPORTS_PER_SOL); const bh = await conn.getLatestBlockhash(); await conn.confirmTransaction({ signature: sig, ...bh }, "confirmed"); break; }
    catch (e) { console.log(`faucet: ${(e as Error).message.slice(0, 100)}; retrying`); await new Promise((r) => setTimeout(r, 4000 * (i + 1))); }
  }
}
const funded = await conn.getBalance(payer.publicKey);
if (funded < 0.2 * LAMPORTS_PER_SOL) die(`the faucet did not fund the throwaway payer (${funded} lamports); run again later or with --payer-file`);
console.log(`funded: ${formatAmount(BigInt(funded), 9)} SOL`);

const sign = async (tx: VersionedTransaction) => { tx.sign([payer]); return tx; };

/** The fill as the chain recorded it: tokens from the token balances, SOL from the payer's lamports plus the network fee. */
async function fillOf(signature: string, mint: PublicKey, side: Side): Promise<bigint> {
  for (let i = 0; i < 10; i++) {
    const tx = await conn.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    if (tx?.meta) {
      if (side === "sol-in") {
        const amt = (l: typeof tx.meta.postTokenBalances) => BigInt((l ?? []).find((b) => b.owner === payer.publicKey.toBase58() && b.mint === mint.toBase58())?.uiTokenAmount.amount ?? "0");
        return amt(tx.meta.postTokenBalances) - amt(tx.meta.preTokenBalances);
      }
      return BigInt(tx.meta.postBalances[0] - tx.meta.preBalances[0] + tx.meta.fee);
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`transaction ${signature} not readable`);
}

const results: Record<string, unknown>[] = [];
async function swap(label: string, mint: PublicKey, pool: PublicKey | null, side: Side, amount: bigint) {
  const no = coinRefusal({ mint: mint.toBase58(), status: "live", cluster: "devnet", hostCluster: "devnet", testMints: [] });
  if (no) die(no);
  const market = await readMarket(conn, "devnet", mint, pool);
  const m = marketRefusal(market, mint, Math.floor(Date.now() / 1000));
  if (m) die(`${label}: ${m}`);
  const q = quoteSwap(market, side, amount);
  const { ixs, minOut: min } = buildSwap(market, { owner: payer.publicKey, mint, side, amount, quotedOut: q.amountOut, slippageBps: SLIPPAGE_BPS });
  const res = await simulateSignSend(conn, payer.publicKey, ixs, sign, (s) => process.stdout.write(`${label}: ${s}\n`));
  if (res.status !== "confirmed") die(`${label}: ${res.status} ${res.error ?? ""} ${res.signature}`);
  const fill = await fillOf(res.signature, mint, side);
  const diffBps = q.amountOut === BigInt(0) ? 0 : Number(((fill - q.amountOut) * BigInt(1_000_000)) / q.amountOut) / 100;
  const row = { label, venue: market.kind, side, amountIn: amount.toString(), quotedOut: q.amountOut.toString(), minOut: min.toString(), filled: fill.toString(), fillVsQuoteBps: diffBps, withinSlippage: fill >= min, signature: res.signature, explorer: explorerTxUrl("devnet", res.signature) };
  results.push(row);
  console.log(JSON.stringify(row));
  if (fill < min) die(`${label}: filled below the minimum out`);
  return fill;
}

// 1. the LaunchLab curve: SOL in, then every token back
const got = await swap("curve SOL→tokens", curveMint, null, "sol-in", solIn);
await swap("curve tokens→SOL", curveMint, null, "tokens-in", got);
// 2. the registered CPMM pool: SOL in, then every token back
const got2 = await swap("cpmm SOL→tokens", cpmmMint, cpmmPool, "sol-in", solIn);
await swap("cpmm tokens→SOL", cpmmMint, cpmmPool, "tokens-in", got2);

const after = await readBalances(conn, payer.publicKey, cpmmMint);
console.log(JSON.stringify({ proof: "swap panel builders, devnet", slippageBps: SLIPPAGE_BPS, payerEndSol: formatAmount(after.lamports, 9), results }, null, 2));
