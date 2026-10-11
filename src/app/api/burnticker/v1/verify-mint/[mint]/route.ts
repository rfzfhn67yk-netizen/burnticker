// Public API v1 (growth batch, 1.7.0): see src/lib/burnticker/api/badgeSpec.ts + src/lib/burnticker/verifyMint.ts and docs/burnticker/api.md.
import { ok, runV1 } from "@/lib/burnticker/api/http";
import { platform } from "@/lib/burnticker/server";
import { verifyMintOn } from "@/lib/burnticker/verifyMintServe";

export const dynamic = "force-dynamic";

/** GET /api/burnticker/v1/verify-mint/<mint> — is this mint a Burnticker coin (program TokenConfig + registry, compared). */
export async function GET(req: Request, ctx: { params: Promise<{ mint: string }> }) {
  const { mint } = await ctx.params;
  return runV1("verifyMint", req, async () => ok(await verifyMintOn(platform(), decodeURIComponent(mint))));
}
