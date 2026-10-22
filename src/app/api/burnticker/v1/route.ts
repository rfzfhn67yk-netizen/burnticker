// Public API v1 (1.16.0, QA pass 9 item 10): the base path answers with the version, the OpenAPI document's address and the docs page.
// See src/lib/burnticker/api/spec.ts (getApiIndex).
import { ok, runV1 } from "@/lib/burnticker/api/http";
import { apiIndex } from "@/lib/burnticker/api/spec";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return runV1("getApiIndex", req, async () => ok(apiIndex()));
}
