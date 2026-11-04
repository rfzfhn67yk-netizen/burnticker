// Public API v1 (1.6.0): see src/lib/burnticker/api/productSpec.ts. Read-only; the public rate limit.
import { runV1 } from "@/lib/burnticker/api/http";
import { platform } from "@/lib/burnticker/api/v1";
import { v1Creator } from "@/lib/burnticker/api/product";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ wallet: string }> }) {
  const { wallet } = await ctx.params;
  return runV1("getCreator", req, () => v1Creator(platform(), wallet));
}
