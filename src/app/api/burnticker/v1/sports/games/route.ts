// Public API v1 (2026-10-10): upcoming games for matchups (the league's own schedule or TheSportsDB; never ESPN). See src/lib/burnticker/api/spec.ts and docs/burnticker/api.md.
import { runV1 } from "@/lib/burnticker/api/http";
import { platform, v1SportsGames } from "@/lib/burnticker/api/v1";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return runV1("listSportsGames", req, () => v1SportsGames(platform(), new URL(req.url).searchParams));
}
