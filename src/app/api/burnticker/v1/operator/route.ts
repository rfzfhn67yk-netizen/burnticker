// Public API v1 (trust pack, 1.5.0): see src/lib/burnticker/api/spec.ts + src/lib/burnticker/trustpack/spec.ts and docs/burnticker/api.md.
import { runV1 } from "@/lib/burnticker/api/http";
import { platform } from "@/lib/burnticker/api/v1";
import { v1Operator } from "@/lib/burnticker/trustpack/api";

export const dynamic = "force-dynamic";

/** Who runs this, the operator wallets, the signed statement and the never-buys monitor. */
export async function GET(req: Request) {
  return runV1("getOperator", req, async () => v1Operator(platform()));
}
