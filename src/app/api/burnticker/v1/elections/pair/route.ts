// Public API v1 (2026-10-10): the election-pair template (candidate A vs B → two coins). See src/lib/burnticker/electionPair.ts and docs/burnticker/api.md.
import { runV1 } from "@/lib/burnticker/api/http";
import { platform, v1ElectionPair } from "@/lib/burnticker/api/v1";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return runV1("electionPair", req, () => v1ElectionPair(platform(), new URL(req.url).searchParams));
}
