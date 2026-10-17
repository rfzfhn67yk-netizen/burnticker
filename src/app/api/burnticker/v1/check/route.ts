// Public API v1 (trust pack, 1.5.0): see src/lib/burnticker/api/spec.ts + src/lib/burnticker/trustpack/spec.ts and docs/burnticker/api.md.
import { runV1 } from "@/lib/burnticker/api/http";
import { v1Check } from "@/lib/burnticker/trustpack/api";

export const dynamic = "force-dynamic";

/** The sceptic's checklist (docs/burnticker/CHECK-THIS-YOURSELF.md is rendered from the same object). */
export async function GET(req: Request) {
  return runV1("getCheck", req, async () => v1Check());
}
