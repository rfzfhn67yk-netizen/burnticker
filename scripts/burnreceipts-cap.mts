// THE BURN-POOL CAP RAISE — RETIRED (owner decision 2026-10-25). THIS FILE PRINTS NO KEY AND TOUCHES NO NETWORK.
//
// The burn_receipts program no longer has a burn-pool cap, a cranker allowlist or a per-run 2 % bound. propose_cap_raise,
// cancel_cap_raise and apply_cap_raise keep their entry points but always refuse with CapRemoved (6144), so there is nothing for this
// script to propose, apply or show. Every command (propose-vault, apply, show, or anything else) exits 2 with that sentence, so an old
// runbook fails loudly instead of building a vault transaction the program would refuse.
//
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/alias-hook.mjs scripts/burnreceipts-cap.mts <anything>
//
// The PlatformConfig can still be read with scripts/burnreceipts-admin.mts; the Squads vault-message helpers stay in
// src/lib/burnReceipts/capRaise.ts.

import { CAP_REMOVED_MESSAGE } from "../src/lib/burnReceipts/capRaise.ts";

const cmd = process.argv[2] ?? "(no command)";
console.error(`refusing: ${cmd}: ${CAP_REMOVED_MESSAGE}`);
process.exit(2);
