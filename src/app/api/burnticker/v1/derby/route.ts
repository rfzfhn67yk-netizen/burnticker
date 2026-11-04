// Public API v1 (2026-10-10, Burn Derby; OpenAPI 1.4.0): see src/lib/burnticker/api/derbySpec.ts.
import { runV1 } from "@/lib/burnticker/api/http";
import { platform } from "@/lib/burnticker/api/v1";
import { v1ListDerby } from "@/lib/burnticker/api/derby";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return runV1("listDerby", req, async () => v1ListDerby(platform()));
}
