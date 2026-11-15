// Public API v1 (1.6.0): see src/lib/burnticker/api/productSpec.ts. Admin only: a trusted host and the x-action-pin header.
import { runV1 } from "@/lib/burnticker/api/http";
import { platform } from "@/lib/burnticker/api/v1";
import { v1OpsSearchMisses } from "@/lib/burnticker/api/product";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return runV1("getOpsSearchMisses", req, async () => v1OpsSearchMisses(platform(), req, new URL(req.url).searchParams));
}
