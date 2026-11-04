// Public API v1 (2026-10-09): see src/lib/burnticker/api/spec.ts (the one schema source) and docs/burnticker/api.md.
import { MAX_JSON_BODY, clientKey, fail, readJsonLimited, runV1 } from "@/lib/burnticker/api/http";
import { platform, v1LaunchBundle } from "@/lib/burnticker/api/v1";
import { launchesClosedAt } from "@/lib/burnticker/api/handlers";
import { recordLaunchTimings } from "@/lib/burnticker/api/product";
import { globalRefusal, typeRefusal } from "@/lib/burnticker/launchAvailability";
import { withLaunchFailureAlert } from "@/lib/burnticker/api/launchFailAlert";
import { launchBodyOf } from "@/lib/burnticker/api/launchBody";

export const dynamic = "force-dynamic";

/** Never signs: returns unsigned transactions and the review payload. */
export async function POST(req: Request) {
  return runV1("buildLaunchBundle", req, withLaunchFailureAlert(platform().registry, "buildLaunchBundle", req, async () => { const closed = globalRefusal(process.env); try { launchesClosedAt(platform()); } catch { /* never breaks a request */ } if (closed) return fail(closed.status, closed.body.error, { code: closed.body.code, preview: closed.body.preview }); const read = await readJsonLimited(req, MAX_JSON_BODY); if ("tooLarge" in read) return read.tooLarge; const body = launchBodyOf(read.body); if (!body) return fail(400, "invalid JSON body");   /* A-3 follow-up: unknown fields dropped */ const off = typeRefusal(body, process.env, platform().cluster); if (off) return fail(off.status, off.body.error, { code: off.body.code, type: off.body.type }); const r = await v1LaunchBundle(platform(), body, clientKey(req)); recordLaunchTimings(platform(), body, [(r.body as { registered?: { mint?: string } | null }).registered?.mint]); return r; }));
}
