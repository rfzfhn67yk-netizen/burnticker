// Public API v1 (2026-10-09): see src/lib/burnticker/api/spec.ts (the one schema source) and docs/burnticker/api.md.
import { fail, readJson, runV1 } from "@/lib/burnticker/api/http";
import { platform, v1LaunchBundle } from "@/lib/burnticker/api/v1";

export const dynamic = "force-dynamic";

/** Never signs: returns unsigned transactions and the review payload. */
export async function POST(req: Request) {
  return runV1("buildLaunchBundle", req, async () => { const body = await readJson(req); return body ? v1LaunchBundle(platform(), body) : fail(400, "invalid JSON body"); });
}
