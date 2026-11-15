// Public API v1 (1.17.0): the live coins a new coin may name to take its rest when its rule ends. See src/lib/burnticker/endSinks.ts and docs/burnticker/api.md.
import { runV1 } from "@/lib/burnticker/api/http";
import { platform, v1Sinks } from "@/lib/burnticker/api/v1";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return runV1("listSinks", req, async () => v1Sinks(platform(), new URL(req.url).searchParams));
}
