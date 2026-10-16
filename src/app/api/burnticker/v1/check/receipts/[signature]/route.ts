// Public API v1 (trust pack, 1.5.0): see src/lib/burnticker/api/spec.ts + src/lib/burnticker/trustpack/spec.ts and docs/burnticker/api.md.
import { runV1 } from "@/lib/burnticker/api/http";
import { v1CheckReceipt } from "@/lib/burnticker/trustpack/api";
import { safeParam } from "@/lib/burnticker/safeParam";

export const dynamic = "force-dynamic";

/** The browser verifier's checks, run here for curl users (src/lib/burnticker/trustpack/receiptCheck.ts). */
export async function GET(req: Request, ctx: { params: Promise<{ signature: string }> }) {
  const { signature } = await ctx.params;
  return runV1("checkReceipt", req, () => v1CheckReceipt(safeParam(signature)));
}
