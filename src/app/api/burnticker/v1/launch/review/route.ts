// Public API v1 (1.14.0): the read-only pre-wallet review (src/lib/burnticker/launchReview.ts; launch audit 5 L02 / L06).
import { fail, ok, readJson, runV1 } from "@/lib/burnticker/api/http";
import { buildLaunchReview } from "@/lib/burnticker/launchReview";
import { globalRefusal, launchModeFromEnv } from "@/lib/burnticker/launchAvailability";

export const dynamic = "force-dynamic";

/** Builds nothing, pins nothing, registers nothing, reads no chain: works in preview and open modes; a closed host refuses. */
export async function POST(req: Request) {
  return runV1("reviewLaunch", req, async () => {
    if (launchModeFromEnv(process.env) === "closed") { const r = globalRefusal(process.env)!; return fail(r.status, r.body.error, { code: r.body.code, preview: false }); }
    const body = await readJson(req);
    if (!body) return fail(400, "invalid JSON body");
    const r = buildLaunchReview(body);
    return "problems" in r ? fail(400, r.problems.join("; "), { problems: r.problems }) : ok(r.review);
  });
}
