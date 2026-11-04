// Public API v1 (growth batch, 1.7.0): see src/lib/burnticker/api/badgeSpec.ts + src/lib/burnticker/badge.ts and docs/burnticker/api.md.
import { fail, ok, okRaw, runV1 } from "@/lib/burnticker/api/http";
import { platform } from "@/lib/burnticker/server";
import { badgeBody, badgeOrigin, pairBadgeData, parseBadgeFile } from "@/lib/burnticker/badgeServe";

export const dynamic = "force-dynamic";

/** GET /api/burnticker/v1/badge/pairs/<pairId>.svg|.png|.json — a rivalry pair's receipt card (no market data; cached 60 s). */
export async function GET(req: Request, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params;
  return runV1("getPairBadge", req, async () => {
    const f = parseBadgeFile(file, /^[A-Za-z0-9_-]{2,64}$/);
    if (!f) return fail(404, "pair badge paths are /badge/pairs/<pairId>.svg, .png or .json");
    const b = await pairBadgeData(platform(), f.id, badgeOrigin(req));
    if (!b) return fail(404, `no launched pair ${f.id}`);
    if (f.fmt === "json") return ok(b);
    const out = await badgeBody(b, f.fmt);
    return okRaw(out.body, out.type, f.fmt === "svg" ? { "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'" } : {});
  });
}
