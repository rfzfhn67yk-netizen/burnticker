/**
 * EXAMPLE — a crank bot. burn_receipts' crank is PERMISSIONLESS: the program computes every amount from the published rule and the
 * burn pool's balance, swaps on the token's own pool and burns everything bought. The cranker chooses nothing and EARNS NOTHING — it
 * pays a transaction fee to keep burns timely if the operator's keeper is slow or gone. Run it for coins you care about.
 *
 *   BURNTICKER_API=https://<host>/api/burnticker/v1  RPC_URL=…  PROGRAM_ID=<deployed burn_receipts id>  CRANKER=~/cranker.json \
 *     node examples/crank-bot.ts
 */
import fs from "node:fs";
import { Connection, Keypair } from "@solana/web3.js";
import { Burnticker, DEFERRABLE_ERRORS } from "../src/index.ts";

async function crankEverything(bt: Burnticker, connection: Connection, cranker: Keypair): Promise<void> {
  const { tokens } = await bt.tokens({ status: "live" });
  for (const t of tokens) {
    for (let i = 0; i < 30; i++) {   // readings are processed strictly in order: crank until idle
      const plan = await bt.crank(t.mint, cranker.publicKey);
      if (plan.status !== "ready") { if (plan.status === "waiting-for-pool") console.log(`$${t.ticker}: ${plan.note}`); break; }
      plan.transaction.sign(cranker);
      const sim = await connection.simulateTransaction(plan.transaction);
      const err = sim.value.logs?.map((l) => /Error Code: (\w+)/.exec(l)?.[1]).find(Boolean) ?? null;
      if (sim.value.err) { console.log(`$${t.ticker} ${plan.recordDate}: ${err && DEFERRABLE_ERRORS.has(err) ? `deferred (${err}) — retry later` : `refused: ${err ?? JSON.stringify(sim.value.err)}`}`); break; }
      const sig = await connection.sendRawTransaction(plan.transaction.serialize());
      await connection.confirmTransaction(sig, "confirmed");
      console.log(`$${t.ticker} ${plan.kind} ${plan.recordDate}: ${sig}`);
    }
  }
}

async function main(): Promise<void> {
  const connection = new Connection(process.env.RPC_URL ?? "https://api.devnet.solana.com", "confirmed");
  const cranker = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(process.env.CRANKER ?? "cranker.json", "utf8")) as number[]));
  const bt = new Burnticker({ apiBase: process.env.BURNTICKER_API ?? "https://burnticker.com/api/burnticker/v1", connection, programId: process.env.PROGRAM_ID, cluster: "devnet" });
  for (;;) {
    await crankEverything(bt, connection, cranker).catch((e: Error) => console.error(e.message));
    await new Promise((r) => setTimeout(r, 5 * 60_000));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
