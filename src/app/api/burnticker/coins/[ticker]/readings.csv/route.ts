import { platform } from "@/lib/burnticker/server";
import { coinCsv } from "@/lib/burnticker/csvServe";

export const dynamic = "force-dynamic";

/** GET /api/burnticker/coins/<TICKER>/readings.csv (polish-1; docs/burnticker/api.md "CSV export"): the coin's readings as UTF-8 CSV with a header row, streamed. */
export async function GET(_req: Request, ctx: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await ctx.params;
  return coinCsv(platform(), ticker, "readings");
}
