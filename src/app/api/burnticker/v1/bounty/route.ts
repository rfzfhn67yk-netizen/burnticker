// Public API v1 (trust pack, 1.5.0): see src/lib/burnticker/api/spec.ts + src/lib/burnticker/trustpack/spec.ts and docs/burnticker/api.md.
import { runV1 } from "@/lib/burnticker/api/http";
import { v1Bounty } from "@/lib/burnticker/trustpack/api";

export const dynamic = "force-dynamic";

/** The bounty wallet (null until the mainnet Squads vault exists), its live balance, and the decided reports. */
export async function GET(req: Request) {
  return runV1("getBounty", req, () => v1Bounty());
}
