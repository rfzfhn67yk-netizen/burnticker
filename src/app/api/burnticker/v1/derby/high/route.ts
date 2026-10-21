// Public API v1 (1.15.0, WIRING-SOURCES4): a coin's record daily close, the baseline a record-close coin locks. See src/lib/burnticker/api/derbySpec.ts.
import { readJsonLimited, runV1 } from "@/lib/burnticker/api/http";
import { platform } from "@/lib/burnticker/api/v1";
import { v1DerbyHighBaseline } from "@/lib/burnticker/api/derby";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return runV1("derbyHighBaseline", req, async () => { const r = await readJsonLimited(req); return "tooLarge" in r ? r.tooLarge : v1DerbyHighBaseline(platform(), r.body); });
}
