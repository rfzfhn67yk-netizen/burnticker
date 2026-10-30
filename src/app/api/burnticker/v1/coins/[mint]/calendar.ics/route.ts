// Public API v1 (1.18.0, cheap-features item 2): the burn calendar as an iCalendar file. See src/lib/burnticker/api/featuresSpec.ts.
import { runV1 } from "@/lib/burnticker/api/http";
import { platform } from "@/lib/burnticker/api/v1";
import { v1CoinCalendarIcs } from "@/lib/burnticker/api/features";
import { publicOrigin } from "@/lib/burnticker/coinArt";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ mint: string }> }) {
  const { mint } = await ctx.params;
  return runV1("getCoinCalendarIcs", req, () => v1CoinCalendarIcs(platform(), mint, publicOrigin()));
}
