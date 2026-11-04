// Public API v1 (2026-10-10, Burn Derby; OpenAPI 1.4.0): see src/lib/burnticker/api/derbySpec.ts.
import { runV1 } from "@/lib/burnticker/api/http";
import { platform } from "@/lib/burnticker/api/v1";
import { v1Derby } from "@/lib/burnticker/api/derby";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return runV1("getDerby", req, () => v1Derby(platform(), id));
}
