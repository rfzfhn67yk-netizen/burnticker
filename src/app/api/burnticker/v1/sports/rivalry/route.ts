// Public API v1: every game between two teams this season (the rivalry series picker). See src/lib/burnticker/api/spec.ts and docs/burnticker/api.md.
import { runV1 } from "@/lib/burnticker/api/http";
import { platform, v1SportsRivalry } from "@/lib/burnticker/api/v1";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return runV1("listSportsRivalry", req, () => v1SportsRivalry(platform(), new URL(req.url).searchParams));
}
