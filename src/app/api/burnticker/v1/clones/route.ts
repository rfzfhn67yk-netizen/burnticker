// Public API v1 (growth batch, 1.7.0): see src/lib/burnticker/api/badgeSpec.ts + src/lib/burnticker/ops/cloneWatch.ts and docs/burnticker/api.md.
import { ok, runV1 } from "@/lib/burnticker/api/http";
import { platform } from "@/lib/burnticker/server";
import { clonesFor } from "@/lib/burnticker/ops/cloneServe";

export const dynamic = "force-dynamic";

/** GET /api/burnticker/v1/clones — the "Not Burnticker" list: lookalike tokens with evidence only (cloneWatch.ts). */
export async function GET(req: Request) {
  return runV1("listClones", req, async () => ok(clonesFor(platform())));
}
