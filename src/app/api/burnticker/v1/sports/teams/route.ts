// Public API v1 (2026-10-10): the team picker for team coins (the league's own schedule or TheSportsDB; never ESPN). See src/lib/burnticker/api/spec.ts and docs/burnticker/api.md.
import { runV1 } from "@/lib/burnticker/api/http";
import { platform, v1SportsTeams } from "@/lib/burnticker/api/v1";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return runV1("listSportsTeams", req, () => v1SportsTeams(platform(), new URL(req.url).searchParams));
}
