// Public API v1 (2026-10-09): see src/lib/burnticker/api/spec.ts (the one schema source) and docs/burnticker/api.md.
import { runV1 } from "@/lib/burnticker/api/http";
import { v1SourcePreview } from "@/lib/burnticker/api/v1";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return runV1("getSourcePreview", req, async () => v1SourcePreview(id, new URL(req.url).searchParams));
}
