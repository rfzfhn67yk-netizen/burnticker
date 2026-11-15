// Public API v1 (2026-10-10): browse every source by Burnticker category — first-party feeds, Polymarket, Kalshi (when enabled). See src/lib/burnticker/browse.ts and docs/burnticker/api.md.
import { runV1 } from "@/lib/burnticker/api/http";
import { platform, v1Browse } from "@/lib/burnticker/api/v1";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return runV1("browse", req, () => v1Browse(platform(), new URL(req.url).searchParams));
}
