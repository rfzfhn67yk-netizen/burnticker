// Public API v1 (trust pack, 1.5.0): see src/lib/burnticker/api/spec.ts + src/lib/burnticker/trustpack/spec.ts and docs/burnticker/api.md.
import { runV1 } from "@/lib/burnticker/api/http";
import { platform } from "@/lib/burnticker/api/v1";
import { v1FeeLedger } from "@/lib/burnticker/trustpack/api";

export const dynamic = "force-dynamic";

/** The developer fee wallet's ledger, from chain, by month, with the expenses it pays. */
export async function GET(req: Request) {
  return runV1("getFeeLedger", req, () => v1FeeLedger(platform()));
}
