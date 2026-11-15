// THE PUBLIC ALARM (the owner, 2026-10-09): recompute every receipt of every token from the recorded source readings and the published
// rule, compare with what the registry holds and — when a program client is available — with the memo on chain; write
// <site>/audit.json (the index page's badge reads it) and EXIT NON-ZERO on any mismatch. Anyone can run it against a copy of
// data/burnticker.db; it reads no key and sends nothing.
//
// THE CHAIN LEG (prelaunch audit 2026-10-18 A-6): with BURNTICKER_PROGRAM_ID and BURNTICKER_RPC_URL set, the audit reads the chain through
// the same read-only program client the web uses (ProgramBurnClient with no payer: it can read, it cannot sign) and compares each
// executed receipt's memo with the one the program wrote: the receipt's own transaction when it has a signature (one read), else the config
// account's latest signatures. A receipt the chain cannot show is counted as not checked, never as a mismatch. A mismatch makes audit.json say so; the keeper's alert check then raises
// bt-audit-mismatch, which is pushed to the owner's phone. A chain read that fails is reported as "not checked", never as a mismatch.
//
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/alias-hook.mjs scripts/burnticker-audit.mts [--json]
import path from "node:path";
import { Connection, PublicKey } from "@solana/web3.js";
import { openRegistry, REGISTRY_FILE } from "../src/lib/burnticker/registry.ts";
import { auditRegistry } from "../src/lib/burnticker/audit.ts";
import { ProgramBurnClient } from "../src/lib/burnticker/programClient.ts";
import { publishSite, toJson } from "../src/lib/burnKeeper/statusPage.ts";
import { budgetedRpcConfig, configureApiBudget, statusTableStore } from "../src/lib/burnticker/apiBudget.ts";

const SITE = process.env.BURNTICKER_PUBLISH_DIR?.trim() || path.join("data", "burnticker-site");
const registry = openRegistry(process.env.BURNTICKER_DB?.trim() || REGISTRY_FILE);
// review of A-6: the chain reads count against the keeper's share of the day (the counts are added in the registry's status table, so
// this process and the keeper add up rather than overwrite); a held or busy provider makes the chain leg "not checked", never a mismatch
const budget = configureApiBudget({ role: "keeper", store: statusTableStore(registry.db), log: (l) => console.log(l) });
budget.setPhase("audit");
const programId = process.env.BURNTICKER_PROGRAM_ID?.trim() || "";
const rpc = process.env.BURNTICKER_RPC_URL?.trim() || "";
const cluster = process.env.BURNTICKER_CLUSTER?.trim() === "mainnet" ? "mainnet" : "devnet";
// read-only: no payer, no admin; solUsd is only used to build a launch, which this script never does
const program = programId && rpc ? new ProgramBurnClient({ connection: new Connection(rpc, budgetedRpcConfig({ commitment: "confirmed", disableRetryOnRateLimit: true })), programId: new PublicKey(programId), cluster, payer: null, admin: null, solUsd: async () => { throw new Error("the audit builds no launch"); }, allowMainnet: cluster === "mainnet" }) : null;
const summary = await auditRegistry(registry, { program, now: Date.now() });
publishSite(SITE, { "audit.json": toJson(summary) });
budget.flush();
registry.close();
if (process.argv.includes("--json")) console.log(JSON.stringify(summary, null, 2));
else {
  const chain = summary.chainChecked ? "checked" : program ? `not checked (${summary.chainError ?? "the read did not finish"})` : "not checked (no BURNTICKER_PROGRAM_ID or BURNTICKER_RPC_URL)";
  console.log(`burnticker audit ${summary.ranAt}: ${summary.tokens} token(s), ${summary.receipts} receipt(s), ${summary.executed ?? 0} executed, ${summary.chainVerified ?? 0} matched on chain, ${summary.chainUnchecked ?? 0} not shown by the chain, chain ${chain} — ${summary.ok ? "OK: every receipt recomputes" : `${summary.mismatches.length} MISMATCH(ES)`}`);
  for (const m of summary.mismatches) console.log(`  ✖ $${m.ticker} ${m.eventId}: ${m.checks.join("; ")}`);
}
process.exit(summary.ok ? 0 : 1);
