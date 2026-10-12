// Public API v1 (growth batch, 1.7.0): see src/lib/burnticker/api/badgeSpec.ts + src/lib/burnticker/badge.ts and docs/burnticker/api.md.
import { fail, ok, okRaw, runV1 } from "@/lib/burnticker/api/http";
import { platform } from "@/lib/burnticker/server";
import { badgeBody, badgeOrigin, coinBadgeData, parseBadgeFile } from "@/lib/burnticker/badgeServe";
import { findCoin } from "@/lib/burnticker/api/v1";
import { sharedTickerBody } from "@/lib/burnticker/coinLookup";

export const dynamic = "force-dynamic";

/** GET /api/burnticker/v1/badge/<TICKER or MINT>.svg|.png|.json — a coin's receipt card (no market data; cached 60 s). A ticker several coins share answers 300 with the coins. */
export async function GET(req: Request, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params;
  return runV1("getBadge", req, async () => {
    const f = parseBadgeFile(file);
    if (!f) return fail(404, "badge paths are /badge/<TICKER>.svg, .png or .json, and a mint address works in place of the ticker");
    const p = platform(), l = findCoin(p, f.id);
    if (l.kind === "many") return { status: 300, body: sharedTickerBody(p.registry, l) };
    const b = await coinBadgeData(p, f.id, badgeOrigin(req));
    if (!b) return fail(404, `no launched coin ${f.id.length >= 32 ? f.id : f.id.toUpperCase()}`);
    if (f.fmt === "json") return ok(b);
    const out = await badgeBody(b, f.fmt);
    return okRaw(out.body, out.type, f.fmt === "svg" ? { "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'" } : {});
  });
}
