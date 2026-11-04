// Public API v1: see src/lib/burnticker/api/featuresSpec.ts. Operator only: a trusted host and the x-action-pin header (the claim page's gate).
import { runV1 } from "@/lib/burnticker/api/http";
import { v1OpsStatementText } from "@/lib/burnticker/trustpack/statementOps";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return runV1("getOpsStatementText", req, async () => v1OpsStatementText(req));
}
