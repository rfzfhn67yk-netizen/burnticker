// Public API v1 (growth batch, 1.7.0): see src/lib/burnticker/api/badgeSpec.ts + src/lib/burnticker/verifyMint.ts and docs/burnticker/api.md.
import { ok, runV1 } from "@/lib/burnticker/api/http";
import { platform } from "@/lib/burnticker/server";
import { verifyMintOn } from "@/lib/burnticker/verifyMintServe";
import { knownLookalike } from "@/lib/burnticker/ops/cloneServe";

export const dynamic = "force-dynamic";

/** GET /api/burnticker/v1/verify-mint/<mint> — is this mint a Burnticker coin (program TokenConfig + registry, compared). */
export async function GET(req: Request, ctx: { params: Promise<{ mint: string }> }) {
  const { mint } = await ctx.params;
  // ChatGPT audit 7 item 2: a mint on the Not Burnticker list carries the known-lookalike answer beside the program check
  return runV1("verifyMint", req, async () => { const m = decodeURIComponent(mint); const v = await verifyMintOn(platform(), m); const lookalike = v.verdict === "burnticker" ? null : knownLookalike(platform(), m); return ok(lookalike ? { ...v, lookalike } : v); });
}
