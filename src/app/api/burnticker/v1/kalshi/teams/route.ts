// Public API v1 (2026-10-10): the team picker for a game series (team coins). See src/lib/burnticker/api/spec.ts and docs/burnticker/api.md.
import { runV1 } from "@/lib/burnticker/api/http";
import { platform, v1KalshiTeams } from "@/lib/burnticker/api/v1";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return runV1("listKalshiTeams", req, () => v1KalshiTeams(platform(), new URL(req.url).searchParams));
}
