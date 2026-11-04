// Public API v1 (2026-10-10): see src/lib/burnticker/api/spec.ts (the one schema source) and docs/burnticker/api.md.
import { fail, readJsonLimited, runV1 } from "@/lib/burnticker/api/http";
import { platform, v1PolymarketBacktest } from "@/lib/burnticker/api/v1";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return runV1("backtestPolymarket", req, async () => { const r = await readJsonLimited(req); if ("tooLarge" in r) return r.tooLarge; const body = r.body; return body ? v1PolymarketBacktest(platform(), body) : fail(400, "invalid JSON body"); });
}
