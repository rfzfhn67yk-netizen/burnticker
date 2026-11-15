import { platform } from "@/lib/burnticker/server";
import { deficitMint } from "@/lib/burnticker/home";
import { countTradeClick, goRedirect } from "@/lib/burnticker/tradeClicks";

export const dynamic = "force-dynamic";

/**
 * GET /burnticker/go/raydium?mint=<mint>[&to=swap] and /burnticker/go/jupiter?mint=<mint>: the counted trade link (tradeClicks.ts).
 * 302 to the same Raydium or Jupiter address the link used to carry, counted per coin and per day; no cookie, no address stored.
 */
export async function GET(req: Request, { params }: { params: Promise<{ venue: string }> }) {
  const { venue } = await params;
  const p = platform();
  return goRedirect(req, venue, {
    listed: (mint) => { if (mint === deficitMint()) return true; const t = p.registry.token(mint); return !!t && t.status !== "expired"; },
    count: (mint, v, now) => countTradeClick(p.registry.db, mint, v, now),
  });
}
