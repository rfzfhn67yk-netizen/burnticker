// Public API v1 (1.18.0, cheap-features item 9): see src/lib/burnticker/api/featuresSpec.ts. Operator only: a trusted host and the x-action-pin header.
import { runV1 } from "@/lib/burnticker/api/http";
import { v1OpsPostQueue } from "@/lib/burnticker/api/features";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return runV1("getOpsPostQueue", req, async () => v1OpsPostQueue(req, new URL(req.url).searchParams));
}
