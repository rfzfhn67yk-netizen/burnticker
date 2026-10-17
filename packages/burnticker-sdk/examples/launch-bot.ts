/**
 * EXAMPLE — a launch bot: one command launches a Burnticker coin whose supply burns on every Broncos win (Kalshi KXNFLGAME, Denver's
 * own leg). It back-tests the rule, builds the bundle (the mint keypair is generated HERE; only its public key goes to the API),
 * signs with YOUR wallet, sends through YOUR RPC, and confirms the launch so settlements after this moment count.
 *
 *   BURNTICKER_API=https://<host>/api/burnticker/v1  RPC_URL=https://api.devnet.solana.com  WALLET=~/devnet-wallet.json \
 *     node examples/launch-bot.ts
 *
 * Nothing is sent while the bundle says ready: false (the platform says what is pending). Mainnet needs allowMainnet: true.
 */
import fs from "node:fs";
import { Connection, Keypair } from "@solana/web3.js";
import { Burnticker } from "../src/index.ts";

async function main(): Promise<void> {
  const connection = new Connection(process.env.RPC_URL ?? "https://api.devnet.solana.com", "confirmed");
  const wallet = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(process.env.WALLET ?? "wallet.json", "utf8")) as number[]));
  const bt = new Burnticker({ apiBase: process.env.BURNTICKER_API ?? "https://burnticker.com/api/burnticker/v1", connection });

  const selector = { series: "KXNFLGAME", filter: { tickerIncludes: "-DEN" } };
  const mapping = { kind: "binary" as const, binary: { onYes: { fractionOfPool: 0.02 } } };
  const bt12 = await bt.kalshi.backtest(selector, mapping);
  console.log(`back-test: ${bt12.sentence}\nrule sha256 ${bt12.sha256}`);

  const launch = await bt.buildLaunchBundle({
    wallet: wallet.publicKey, selector, rule: mapping,
    metadata: { ticker: "BRONCO", name: "Bronco Burn", description: "Every Broncos win burns supply." },
    acknowledgements: { ruleLocked: true, noReturns: true },
  });
  console.log(`mint ${launch.mint.toBase58()} · burn pool (LaunchLab creator) ${launch.feePda}\nreceipt format: ${launch.receiptFormat}`);
  if (!launch.ready) { console.log(`not signable yet — pending:\n  ${launch.pending.join("\n  ")}`); return; }

  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  for (const tx of launch.withBlockhash(blockhash)) {   // fresh blockhash; the mint keypair co-signs inside withBlockhash
    tx.partialSign(wallet);
    const sig = await connection.sendRawTransaction(tx.serialize());
    await connection.confirmTransaction(sig, "confirmed");
    console.log(`launched: ${sig}`);
    console.log(await bt.confirmLaunch(launch.mint, sig));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
