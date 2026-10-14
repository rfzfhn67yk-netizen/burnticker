// Public API v1 (1.18.0, cheap-features item 3): see src/lib/burnticker/api/featuresSpec.ts and docs/burnticker/api.md.
import { runV1 } from "@/lib/burnticker/api/http";
import { platform } from "@/lib/burnticker/api/v1";
import { v1Leaderboard } from "@/lib/burnticker/api/features";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return runV1("getLeaderboard", req, async () => v1Leaderboard(platform()));
}
