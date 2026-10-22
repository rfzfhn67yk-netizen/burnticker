// Public API v1 (trust pack, 1.5.0): see src/lib/burnticker/api/spec.ts + src/lib/burnticker/trustpack/spec.ts and docs/burnticker/api.md.
import { runV1 } from "@/lib/burnticker/api/http";
import { v1Check } from "@/lib/burnticker/trustpack/api";
import { liveDeployedReads } from "@/lib/burnticker/currentStatus";

export const dynamic = "force-dynamic";

/**
 * The sceptic's checklist (docs/burnticker/CHECK-THIS-YOURSELF.md is rendered from the same object). HS-121: the build table's deployed
 * bytes follow the live ProgramData read (five-minute cache); the document states the record and lags a live upgrade until rewritten.
 */
export async function GET(req: Request) {
  return runV1("getCheck", req, async () => v1Check(process.cwd(), await liveDeployedReads()));
}
