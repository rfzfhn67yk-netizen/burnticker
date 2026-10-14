// Public API v1 (1.18.0, cheap-features item 9): see src/lib/burnticker/api/featuresSpec.ts. Operator only: a trusted host and the x-action-pin header.
import { readJson, runV1 } from "@/lib/burnticker/api/http";
import { v1OpsPostUsed } from "@/lib/burnticker/api/features";

export const dynamic = "force-dynamic";

/** Marks one queued post as used (an appended mark in its own file). Never posts. */
export async function POST(req: Request) {
  return runV1("markPostUsed", req, async () => v1OpsPostUsed(req, await readJson(req)));
}
