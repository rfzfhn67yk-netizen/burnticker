import { NextResponse } from "next/server";
import { deficitPrelaunch } from "@/lib/burnticker/deficitPrelaunch";
import { deficitQueue, readKeeperFiles } from "@/lib/burnticker/deficitQueue";
import { eventsFromKeeper, sortEvents } from "@/lib/burnticker/activity";

export const dynamic = "force-dynamic";

/**
 * The $DEFICIT page's data while the coin is not registered on this host (src/lib/burnticker/deficitPrelaunch.ts): the locked rules
 * file + config/burnticker/current-status.json, and since website-14 its keeper's published files: the queued-units counter, where the
 * coin stands (the keeper's own readiness, from its curve read) and its activity rows. `keeper` is null when the files were not read.
 */
export async function GET() {
  try {
    const now = Date.now();
    const k = readKeeperFiles();
    const st = k.status as { schema?: string; readiness?: unknown; curve?: unknown } | null;
    const live = st?.schema === "burnkeeper.status/v1";
    return NextResponse.json({
      ...deficitPrelaunch(),
      queue: deficitQueue(k, now),
      keeper: live ? { readiness: st!.readiness ?? null, curve: st!.curve ?? null, events: sortEvents(eventsFromKeeper(k.status, k.burns, { includeBurns: true }), 40) } : null,
    }, { headers: { "cache-control": "public, max-age=60" } });
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 500 }); }
}
