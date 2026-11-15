// Public API v1 (2026-10-09): see src/lib/burnticker/api/spec.ts (the one schema source) and docs/burnticker/api.md.
import { runV1 } from "@/lib/burnticker/api/http";
import { platform, v1Verify } from "@/lib/burnticker/api/v1";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ ticker: string; id: string }> }) {
  const { ticker, id } = await ctx.params;
  return runV1("verifyReceipt", req, () => v1Verify(platform(), ticker, id));
}
