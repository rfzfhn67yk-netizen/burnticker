// Public API v1 (2026-10-10): event-level Kalshi search (teams, people, contests). See src/lib/burnticker/api/spec.ts and docs/burnticker/api.md.
import { runV1 } from "@/lib/burnticker/api/http";
import { platform, v1KalshiEvents } from "@/lib/burnticker/api/v1";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return runV1("searchKalshiEvents", req, () => v1KalshiEvents(platform(), new URL(req.url).searchParams));
}
