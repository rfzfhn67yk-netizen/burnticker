// Public API v1 (sources-7): the coin-vs-coin pair check at pick time (wrapper pairs; a flippening whose first coin is already larger). See src/lib/burnticker/api/derbySpec.ts.
import { readJson, runV1 } from "@/lib/burnticker/api/http";
import { platform } from "@/lib/burnticker/api/v1";
import { v1DerbyPairCheck } from "@/lib/burnticker/api/derby";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return runV1("derbyPairCheck", req, async () => v1DerbyPairCheck(platform(), await readJson(req)));
}
