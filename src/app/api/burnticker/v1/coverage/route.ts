// Public API v1 (2026-10-09): see src/lib/burnticker/api/spec.ts (the one schema source) and docs/burnticker/api.md.
import { runV1 } from "@/lib/burnticker/api/http";
import { platform, v1Coverage } from "@/lib/burnticker/api/v1";

export const dynamic = "force-dynamic";

/** The settlement-coverage matrix (1.3.0): offline from the fixtures, cached; the trust page's "Settlement coverage" section reads it. */
export async function GET(req: Request) {
  return runV1("getCoverage", req, () => v1Coverage(platform()));
}
