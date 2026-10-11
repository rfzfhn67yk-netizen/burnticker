// Public API v1 (trust pack, 1.5.0): see src/lib/burnticker/api/spec.ts + src/lib/burnticker/trustpack/spec.ts and docs/burnticker/api.md.
import { runV1 } from "@/lib/burnticker/api/http";
import { v1CheckReceipts } from "@/lib/burnticker/trustpack/api";

export const dynamic = "force-dynamic";

/** The devnet receipts the /burnticker/check verifier offers, with each token's exact rules text. */
export async function GET(req: Request) {
  return runV1("listCheckReceipts", req, async () => v1CheckReceipts());
}
