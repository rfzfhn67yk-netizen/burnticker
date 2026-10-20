// Public API v1 (1.13.0): the one current-status object (src/lib/burnticker/currentStatus.ts; website brief 2026-10-11 §4).
import { ok, runV1 } from "@/lib/burnticker/api/http";
import { currentStatusLive } from "@/lib/burnticker/currentStatus";
import { withoutRepoPaths } from "@/lib/burnticker/publicPaths";
import { platform } from "@/lib/burnticker/server";
import { registrySnapshotView } from "@/lib/burnticker/ops/snapshot";

export const dynamic = "force-dynamic";

/** Network and deployment, programs, attesters and quorum, upgrade authority with the time lock read from chain, settlement, reviews, open requirements. */
export async function GET(req: Request) {
  return runV1("getCurrentStatus", req, async () => {
    // HB-82 (hourly run 6): whether today's registry snapshot is pinned, from this host's registry (one read-only query; null when unreadable)
    let registrySnapshot: ReturnType<typeof registrySnapshotView> = null;
    try { registrySnapshot = registrySnapshotView(platform().registry, Date.now()); } catch { registrySnapshot = null; }
    return ok(withoutRepoPaths(await currentStatusLive(process.env, process.cwd(), Date.now(), { registrySnapshot })));
  });
}
