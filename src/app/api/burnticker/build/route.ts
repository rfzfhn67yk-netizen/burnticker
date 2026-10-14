import { NextResponse } from "next/server";
import { currentBuildId } from "@/lib/burnticker/buildVersionServer";

export const dynamic = "force-dynamic";

/**
 * GET → `{ build }`: the build id this host serves now (buildVersion.ts), or null in development. The launch page compares it with the
 * id it was served with and, when they differ, asks the creator to reload. Read-only, no-store, a few bytes.
 */
export async function GET() {
  return NextResponse.json({ build: currentBuildId() }, { headers: { "cache-control": "no-store" } });
}
