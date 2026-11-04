// Public API v1 (1.18.0, cheap-features item 10): see src/lib/burnticker/api/featuresSpec.ts and docs/burnticker/api.md.
import { runV1 } from "@/lib/burnticker/api/http";
import { platform } from "@/lib/burnticker/api/v1";
import { v1CoinChecklist } from "@/lib/burnticker/api/features";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ mint: string }> }) {
  const { mint } = await ctx.params;
  return runV1("getCoinChecklist", req, () => v1CoinChecklist(platform(), mint));
}
