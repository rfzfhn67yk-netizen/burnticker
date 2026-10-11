// THE PUBLIC ALARM (the owner, 2026-10-09): recompute every receipt of every token from the recorded source readings and the published
// rule, compare with what the registry holds and — when a program client is available — with the memo on chain; write
// <site>/audit.json (the index page's badge reads it) and EXIT NON-ZERO on any mismatch. Anyone can run it against a copy of
// data/burnticker.db; it reads no key and sends nothing.
//
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/alias-hook.mjs scripts/burnticker-audit.mts [--json]
import path from "node:path";
import { openRegistry, REGISTRY_FILE } from "../src/lib/burnticker/registry.ts";
import { auditRegistry } from "../src/lib/burnticker/audit.ts";
import { FakeBurnProgram } from "../src/lib/burnticker/program.ts";
import { publishSite, toJson } from "../src/lib/burnKeeper/statusPage.ts";

const SITE = process.env.BURNTICKER_PUBLISH_DIR?.trim() || path.join("data", "burnticker-site");
const registry = openRegistry(process.env.BURNTICKER_DB?.trim() || REGISTRY_FILE);
// The chain leg runs only with a real program client (BURNTICKER_PROGRAM_ID + RPC, not wired yet); the fake holds nothing, so chainChecked is false.
const programId = process.env.BURNTICKER_PROGRAM_ID?.trim();
const program = programId ? null : null;
void FakeBurnProgram;
const summary = await auditRegistry(registry, { program, now: Date.now() });
publishSite(SITE, { "audit.json": toJson(summary) });
registry.close();
if (process.argv.includes("--json")) console.log(JSON.stringify(summary, null, 2));
else {
  console.log(`burnticker audit ${summary.ranAt}: ${summary.tokens} token(s), ${summary.receipts} receipt(s), chain ${summary.chainChecked ? "checked" : "not checked (no program client)"} — ${summary.ok ? "OK: every receipt recomputes" : `${summary.mismatches.length} MISMATCH(ES)`}`);
  for (const m of summary.mismatches) console.log(`  ✖ $${m.ticker} ${m.eventId}: ${m.checks.join("; ")}`);
}
process.exit(summary.ok ? 0 : 1);
