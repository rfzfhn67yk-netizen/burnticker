import { NextResponse } from "next/server";
import { platform } from "@/lib/burnticker/server";
import { buildTrustOps } from "@/lib/burnticker/ops/trustOps";

export const dynamic = "force-dynamic";

/** The trust page's trust-ops section: active keeper (this host + the peer), attesters per coin, latest registry snapshot, incident policy. */
export async function GET() {
  const p = platform();
  return NextResponse.json(await buildTrustOps({ registry: p.registry, publishDir: p.publishDir }), { headers: { "cache-control": "public, max-age=30" } });
}
