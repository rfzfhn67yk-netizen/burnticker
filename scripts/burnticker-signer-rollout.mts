// THE SECOND-SIGNER ROLLOUT, STAGED FOR THE OWNER (signer-2, 2026-10-12; docs/burnticker/SIGNER-TWO-ROLLOUT.md). Prints, per coin, the
// next step toward [keeper key, second signer key] at quorum 2: when the proposal may be made (the keeper's key must be in the set 7 days),
// the UNSIGNED propose_attesters instruction for the Squads vault, when the 48-hour wait ends, and the permissionless apply instruction.
// It never signs and never sends. With --rpc it only READS each coin's TokenConfig; with --snapshot it reads nothing (a dry run).
//
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/alias-hook.mjs scripts/burnticker-signer-rollout.mts \
//     --signer <second signer pubkey> --program <burn_receipts id> (--rpc <url> | --snapshot <coins.json>) [--coin TICKER=<mint> ...] [--payer <pubkey>] [--now <ISO>]
//
// Default coins: $DEFICIT and $REHEARSAL (mainnet). A paired coin is reported and not planned (see the rollout page).
import fs from "node:fs";
import { Connection, PublicKey } from "@solana/web3.js";
import { fetchTokenConfig } from "../src/lib/burnReceipts/accounts.ts";
import { applyAttesterChangeIx, proposeAttestersIx } from "../src/lib/burnReceipts/instructions.ts";
import { PAIR_STATE_PAIRED } from "../src/lib/burnReceipts/pairs.ts";
import { planCoin, planLines, rolloutIso, type RolloutCoin } from "../src/lib/burnticker/attesters/rollout.ts";

const args = process.argv.slice(2);
const opt = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : undefined; };
const die = (s: string): never => { console.error(`rollout: ${s}`); process.exit(2); };
const signer = opt("signer") ?? die("--signer <the second signer's public key> is required (from its health output)");
new PublicKey(signer);
const programId = new PublicKey(opt("program") ?? process.env.BURNTICKER_PROGRAM_ID?.trim() ?? die("--program <burn_receipts id> is required"));
const DEFAULT_COINS = ["DEFICIT=AJJ4XxCUYr8zzMWm8FYg3xh638LYAAApdNqWBqCK4oqj", "REHEARSAL=FwXiFscFSYXzvPVzV4rCw4UBcGDhT53xHDpsL3pVpzkp"];
const coinArgs = args.flatMap((a, i) => (a === "--coin" && args[i + 1] ? [args[i + 1]] : []));
const wanted = (coinArgs.length ? coinArgs : DEFAULT_COINS).map((s) => { const [ticker, mint] = s.split("="); if (!ticker || !mint) die(`--coin ${s}: expected TICKER=<mint>`); new PublicKey(mint); return { ticker: ticker.replace(/^\$/, ""), mint }; });
const nowSec = Math.floor((opt("now") ? Date.parse(opt("now")!) : Date.now()) / 1000);
if (!Number.isFinite(nowSec)) die("--now must be an ISO time");

let coins: RolloutCoin[];
const snap = opt("snapshot");
if (snap) {
  const all = JSON.parse(fs.readFileSync(snap, "utf8")) as RolloutCoin[];
  coins = wanted.map((w) => all.find((c) => c.mint === w.mint) ?? die(`the snapshot has no coin ${w.mint}`));
} else {
  const rpc = opt("rpc") ?? die("--rpc <url> (read only) or --snapshot <coins.json> is required");
  const conn = new Connection(rpc, "confirmed");
  coins = [];
  for (const w of wanted) {
    const r = await fetchTokenConfig(conn, programId, new PublicKey(w.mint));
    if (!r) die(`no TokenConfig for $${w.ticker} (${w.mint}) under ${programId.toBase58()} on this RPC`);
    const c = r!.config;
    coins.push({
      ticker: w.ticker, mint: w.mint, quorum: c.quorum, adminRenounced: c.adminRenounced, admin: c.admin.toBase58(), paired: c.pair_state === PAIR_STATE_PAIRED,
      attesters: c.activeAttesters.map((a, i) => ({ key: a.key.toBase58(), kind: a.kind, addedAt: Number(c.attester_added_at[i] ?? 0) })),
      pending: c.pending_count > 0 && c.pending_eta > BigInt(0) ? { attesters: c.pending_attesters.slice(0, c.pending_count).map((a) => ({ key: a.key.toBase58(), kind: a.kind })), quorum: c.pending_quorum, etaSec: Number(c.pending_eta) } : null,
    });
  }
}

const ixJson = (ix: { programId: PublicKey; keys: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[]; data: Buffer }) => ({ programId: ix.programId.toBase58(), keys: ix.keys.map((k) => ({ pubkey: k.pubkey.toBase58(), isSigner: k.isSigner, isWritable: k.isWritable })), dataBase64: Buffer.from(ix.data).toString("base64") });
const payer = opt("payer");
const plans = coins.map((c) => {
  const p = planCoin(c, signer, nowSec);
  const s = p.step;
  const propose = s.kind === "wait-seniority" || s.kind === "propose-now"
    ? ixJson(proposeAttestersIx({ programId, admin: new PublicKey(c.admin), mint: new PublicKey(c.mint), attesters: s.proposed.map((a) => ({ key: new PublicKey(a.key), kind: a.kind })), quorum: s.quorum }))
    : null;
  const apply = s.kind !== "done" && s.kind !== "refused" && payer ? ixJson(applyAttesterChangeIx({ programId, caller: new PublicKey(payer), mint: new PublicKey(c.mint) })) : null;
  return { ticker: c.ticker, mint: c.mint, configAuthority: c.admin, current: { quorum: c.quorum, attesters: c.attesters.map((a) => ({ key: a.key, kind: a.kind, joined: rolloutIso(a.addedAt) })) }, step: s.kind, lines: planLines(p), proposeInstruction: propose, applyInstruction: apply };
});
console.log(JSON.stringify({ now: rolloutIso(nowSec), programId: programId.toBase58(), secondSigner: signer, plans, note: "Nothing was signed or sent. The vault signs propose_attesters; anyone sends the apply after the 48-hour wait. Set BURNTICKER_COSIGNER_URL on the keepers BEFORE the apply lands, or readings wait." }, null, 2));
