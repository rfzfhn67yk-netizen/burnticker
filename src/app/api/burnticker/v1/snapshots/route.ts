// Public API v1 (trust ops, 1.7.0): see src/lib/burnticker/api/spec.ts + src/lib/burnticker/ops/spec.ts and docs/burnticker/api.md.
import { runV1 } from "@/lib/burnticker/api/http";
import { platform } from "@/lib/burnticker/api/v1";
import { v1Snapshots } from "@/lib/burnticker/ops/api";

export const dynamic = "force-dynamic";

/** The daily registry snapshots pinned to Arweave, newest first. */
export async function GET(req: Request) {
  return runV1("listSnapshots", req, async () => v1Snapshots(platform(), new URL(req.url).searchParams));
}
