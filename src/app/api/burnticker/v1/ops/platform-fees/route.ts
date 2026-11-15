// Public API v1: see src/lib/burnticker/api/featuresSpec.ts. Operator only: a trusted host and the x-action-pin header (the post queue's gate).
import { runV1 } from "@/lib/burnticker/api/http";
import { v1OpsPlatformFees } from "@/lib/burnticker/platformFeeClaim";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return runV1("getOpsPlatformFees", req, async () => v1OpsPlatformFees(req));
}
