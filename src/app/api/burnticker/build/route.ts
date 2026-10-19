import { NextResponse } from "next/server";
import { currentBuildId, processStartedAtMs } from "@/lib/burnticker/buildVersionServer";
import { releaseView } from "@/lib/burnticker/releaseManifest";

export const dynamic = "force-dynamic";

/**
 * GET → `{ build, startedAt, release }`: the build id this host serves now (buildVersion.ts), or null in development, and when this
 * server process started (unix ms). The launch page compares `build` with the id it was served with and, when they differ, asks the
 * creator to reload; the deploy smoke (scripts/ops/swap-web-build.sh) also requires `startedAt` after its restart. `release` (audit
 * 2026-10-19 I-13, releaseManifest.ts): the public tree's commit and digest, the monorepo commit, the build, the registry schema
 * version, both programs' hashes from the verified-build record and the keeper's release. Read-only, no-store, about a kilobyte.
 */
export async function GET() {
  const build = currentBuildId();
  let release: ReturnType<typeof releaseView> | null = null;
  try { release = releaseView({ servedBuildId: build }); } catch { release = null; }
  return NextResponse.json({ build, startedAt: processStartedAtMs(), release }, { headers: { "cache-control": "no-store" } });
}
