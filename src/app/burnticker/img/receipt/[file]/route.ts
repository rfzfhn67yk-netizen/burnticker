import { platform } from "@/lib/burnticker/server";
import { receiptCardImage } from "@/lib/burnticker/receiptCardServe";

export const dynamic = "force-dynamic";

/**
 * GET /burnticker/img/receipt/<MINT or TICKER>.png|.svg: the coin's receipt share card (receiptCard.ts), 1200 x 630. The coin page's Open
 * Graph image and the embeddable receipt widget (the URL by mint is the stable one). Kept for five minutes by caches, because the card
 * changes when a new burn is recorded; the server renders each (coin, newest burn) once.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const r = await receiptCardImage({ registry: platform().registry, file });
  return new Response(r.body as BodyInit, { status: r.status, headers: { "content-type": r.type, "cache-control": r.status === 200 ? "public, max-age=300, stale-while-revalidate=300" : "no-store", "access-control-allow-origin": "*", "x-content-type-options": "nosniff" } });
}
