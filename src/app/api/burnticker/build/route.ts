import { NextResponse } from "next/server";
import { currentBuildId, processStartedAtMs } from "@/lib/burnticker/buildVersionServer";

export const dynamic = "force-dynamic";

/**
 * GET → `{ build, startedAt }`: the build id this host serves now (buildVersion.ts), or null in development, and when this server
 * process started (unix ms). The launch page compares `build` with the id it was served with and, when they differ, asks the creator to
 * reload; the deploy smoke (scripts/ops/swap-web-build.sh) also requires `startedAt` after its restart. Read-only, no-store, a few bytes.
 */
export async function GET() {
  return NextResponse.json({ build: currentBuildId(), startedAt: processStartedAtMs() }, { headers: { "cache-control": "no-store" } });
}
