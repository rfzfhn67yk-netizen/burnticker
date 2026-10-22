// Public API v1 (1.6.0): see src/lib/burnticker/api/productSpec.ts and docs/burnticker/api.md.
import { fail, readJsonLimited, runV1 } from "@/lib/burnticker/api/http";
import { platform } from "@/lib/burnticker/api/v1";
import { v1SearchMiss } from "@/lib/burnticker/api/product";

export const dynamic = "force-dynamic";

/** The launch page reports a search that showed cards but got no click. Anonymous, append-only. */
export async function POST(req: Request) {
  return runV1("reportSearchMiss", req, async () => { const r = await readJsonLimited(req); if ("tooLarge" in r) return r.tooLarge; const body = r.body; return body ? v1SearchMiss(platform(), body) : fail(400, "invalid JSON body"); });
}
