// Public API v1 (2026-10-09): see src/lib/burnticker/api/spec.ts (the one schema source) and docs/burnticker/api.md.
import { fail, readJson, runV1 } from "@/lib/burnticker/api/http";
import { platform, v1LaunchBundle } from "@/lib/burnticker/api/v1";
import { recordLaunchTimings } from "@/lib/burnticker/api/product";
import { creatorLaunchRefusal } from "@/lib/burnticker/creatorLaunches";

export const dynamic = "force-dynamic";

/** Never signs: returns unsigned transactions and the review payload. */
export async function POST(req: Request) {
  return runV1("buildLaunchBundle", req, async () => { const closed = creatorLaunchRefusal(process.env); if (closed) return fail(closed.status, closed.body.error, { code: closed.body.code }); const body = await readJson(req); if (!body) return fail(400, "invalid JSON body"); const r = await v1LaunchBundle(platform(), body); recordLaunchTimings(platform(), body, [(r.body as { registered?: { mint?: string } | null }).registered?.mint]); return r; });
}
