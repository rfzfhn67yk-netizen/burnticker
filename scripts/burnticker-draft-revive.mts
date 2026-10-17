#!/usr/bin/env node
// THE OPERATOR'S PATH FROM "expired" TO "live" (AUDIT A C1, 2026-10-15). A draft the 24 h sweep marked expired whose coin WAS created on
// chain (the browser never confirmed it) is taken live here, but only through the same check the site's confirm and the keeper's draft
// reconciler use: the launch transaction is read from the chain and verified (launchVerify.ts: signed by the mint and the creator, after
// the draft, this coin's TokenConfig locking the draft's rule, the venue's create). Nothing is written unless it passes; the write is the
// registry's append-only revival row plus the one status change the tokens_expired_final trigger allows for it. Dry run unless --apply.
//
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/alias-hook.mjs scripts/burnticker-draft-revive.mts \
//     --mint <mint> --tx <create signature> --note "why" [--late] [--apply] [--db data/burnticker.db]
//
// A create that landed after the draft's 24-hour window is refused unless --late is given (review 2026-10-15: the rule's event may have
// settled long ago, and the launch checks ran against the old draft); a late revival is recorded in draft_revivals with within_window 0.
//
// Needs BURNTICKER_RPC_URL and BURNTICKER_PROGRAM_ID (and BURNTICKER_CLUSTER=mainnet on mainnet). Normally the keeper's reconciler does
// this on its own within a few minutes; this is for a coin older than its 14-day lookback or a host without the keeper.
import fs from "node:fs";
import { Connection } from "@solana/web3.js";
import { openRegistry, REGISTRY_FILE } from "@/lib/burnticker/registry";
import { connectionLaunchVerifier, type TxReader } from "@/lib/burnticker/launchVerify";
import { reviveDraft } from "@/lib/burnticker/draftReconciler";
import { LAUNCHLAB_PROGRAM_ID, PAIR_CURVE_PROGRAM_ID } from "@/lib/burnReceipts/constants";

const args = process.argv.slice(2);
const arg = (k: string): string | null => { const i = args.indexOf(k); return i >= 0 && i + 1 < args.length ? args[i + 1] : null; };
const db = arg("--db") ?? REGISTRY_FILE;
const mint = arg("--mint"), tx = arg("--tx"), note = (arg("--note") ?? "").trim(), apply = args.includes("--apply"), late = args.includes("--late");
if (!mint || !tx || !note) { console.error("usage: --mint <mint> --tx <create signature> --note \"why\" [--late] [--apply] [--db file]"); process.exit(2); }
if (!fs.existsSync(db)) { console.error(`no registry at ${db}`); process.exit(2); }
const rpc = process.env.BURNTICKER_RPC_URL?.trim(), programId = process.env.BURNTICKER_PROGRAM_ID?.trim();
if (!rpc || !programId) { console.error("BURNTICKER_RPC_URL and BURNTICKER_PROGRAM_ID are required: a draft is taken live only after its launch is read from the chain"); process.exit(2); }
const cluster = process.env.BURNTICKER_CLUSTER?.trim() === "mainnet" ? "mainnet" : "devnet";
const reg = openRegistry(db);
const verifier = connectionLaunchVerifier(new Connection(rpc, "confirmed") as unknown as TxReader, { burnProgramId: programId, launchLabProgramId: LAUNCHLAB_PROGRAM_ID[cluster].toBase58(), pairCurveProgramId: PAIR_CURVE_PROGRAM_ID.toBase58() });
const r = await reviveDraft(reg, verifier, { mint, launchTx: tx, note, late, apply });
if (!r.ok) { console.error(r.reason); process.exit(1); }
console.log(JSON.stringify({ mint, launchTx: tx, ...r, ...(r.applied ? { status: reg.token(mint)!.status } : { next: "run again with --apply" }) }));
