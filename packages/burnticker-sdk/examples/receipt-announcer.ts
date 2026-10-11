/**
 * EXAMPLE — a Telegram-style receipt announcer that reads ONLY public data. It watches every live coin's receipts through the public
 * API, re-verifies each new burn on this machine (the settled result re-read from Kalshi / the feed, the rule re-applied, the memo read
 * from chain when RPC_URL is set) and prints one announcement per receipt. Swap `announce` for your chat's send call.
 *
 *   BURNTICKER_API=https://<host>/api/burnticker/v1  [RPC_URL=…]  node examples/receipt-announcer.ts
 */
import { Connection } from "@solana/web3.js";
import { Burnticker, type BurntickerEvent } from "../src/index.ts";

const announce = (text: string): void => { console.log(text); };   // e.g. POST https://api.telegram.org/bot<token>/sendMessage

async function main(): Promise<void> {
  const connection = process.env.RPC_URL ? new Connection(process.env.RPC_URL, "confirmed") : undefined;
  const bt = new Burnticker({ apiBase: process.env.BURNTICKER_API ?? "https://burnticker.com/api/burnticker/v1", connection });
  const { tokens } = await bt.tokens({ status: "live" });
  for (const t of tokens) {
    const rulesText = (await bt.token(t.ticker)).rulesText;
    // No programId given, so subscribe() polls the public API's receipts (with programId + connection it decodes program events).
    bt.subscribe(t.mint, (e: BurntickerEvent) => {
      if (e.kind !== "receipt" || e.receipt.status !== "confirmed") return;
      void bt.verifyReceipt(e.receipt, { ticker: t.ticker, rulesText }).then((v) => {
        const r = e.receipt;
        announce(`BURN $${t.ticker} burned ${r.burned} — ${r.market} settled ${r.result ?? r.value} (${r.settledAt.slice(0, 10)})\n${v.verified ? "verified from source + rule" : `NOT verified: ${v.checks.filter((c) => c.ok === false).map((c) => c.detail).join("; ")}`}${r.txUrl ? `\n${r.txUrl}` : ""}`);
      });
    }, { ticker: t.ticker, pollMs: 60_000 });
  }
  console.log(`watching ${tokens.length} coin(s)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
