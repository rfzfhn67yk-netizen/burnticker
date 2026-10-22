// Public API v1 (2026-10-10): see src/lib/burnticker/api/spec.ts (the one schema source) and docs/burnticker/api.md.
import { runV1 } from "@/lib/burnticker/api/http";
import { platform, v1PolymarketSearch } from "@/lib/burnticker/api/v1";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return runV1("searchPolymarket", req, () => v1PolymarketSearch(platform(), new URL(req.url).searchParams));
}
