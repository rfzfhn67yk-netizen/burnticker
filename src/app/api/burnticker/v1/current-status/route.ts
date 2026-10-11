// Public API v1 (1.13.0): the one current-status object (src/lib/burnticker/currentStatus.ts; website brief 2026-10-11 §4).
import { ok, runV1 } from "@/lib/burnticker/api/http";
import { currentStatusLive } from "@/lib/burnticker/currentStatus";

export const dynamic = "force-dynamic";

/** Network and deployment, programs, attesters and quorum, upgrade authority with the time lock read from chain, settlement, reviews, open requirements. */
export async function GET(req: Request) {
  return runV1("getCurrentStatus", req, async () => ok(await currentStatusLive()));
}
