// Public API v1 (2026-10-09): see src/lib/burnticker/api/spec.ts (the one schema source) and docs/burnticker/api.md.
import { clientKey, fail, readJson, runV1 } from "@/lib/burnticker/api/http";
import { platform, v1Confirm } from "@/lib/burnticker/api/v1";

export const dynamic = "force-dynamic";

/**
 * AUDIT A C1 (6, 7; findings M1 and H4): a confirmation records a launch that is already signed and on chain, so it is taken whether
 * launches are open, closed or in preview, and it is metered on the heavy bucket (spec.ts confirmLaunch), not the write bucket that
 * bundles spend. The chain decides (markLaunched verifies the transaction before anything is written).
 */
export async function POST(req: Request) {
  return runV1("confirmLaunch", req, async () => { const body = await readJson(req); return body ? v1Confirm(platform(), body, clientKey(req)) : fail(400, "invalid JSON body"); });
}
