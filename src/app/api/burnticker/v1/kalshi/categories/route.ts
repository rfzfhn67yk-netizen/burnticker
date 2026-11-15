// Public API v1 (2026-10-10): browse Kalshi like Kalshi — categories → tags → series (and Polymarket's matching tag). See src/lib/burnticker/api/spec.ts and docs/burnticker/api.md.
import { runV1 } from "@/lib/burnticker/api/http";
import { platform, v1KalshiCategories } from "@/lib/burnticker/api/v1";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return runV1("browseKalshiCategories", req, () => v1KalshiCategories(platform(), new URL(req.url).searchParams));
}
