import { NextResponse } from "next/server";
import { platform } from "@/lib/burnticker/server";
import { coinArtUrl, publicOrigin } from "@/lib/burnticker/coinArt";
import { metadataDescription } from "@/lib/burnticker/coinText";
import { metadataJson } from "@/lib/burnticker/pin";

export const dynamic = "force-dynamic";

/**
 * The HOSTED token metadata JSON — a fallback only. A coin launched since 2026-10-10 has its metadata pinned on Arweave (pin.ts) and its
 * token URI points there; this route serves the same bytes for reference (and for a devnet script coin made under
 * BURNTICKER_ALLOW_HOSTED_METADATA, the only coins whose URI is this route). The description is the generated text, byte-for-byte:
 * the window badge line, the generated paragraph, the rule footer (coinText.metadataDescription).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ mint: string }> }) {
  const { mint } = await params;
  const p = platform();
  const t = p.registry.token(mint);
  if (!t) return NextResponse.json({ error: "no such mint" }, { status: 404 });
  const origin = publicOrigin();
  const locked = p.registry.lockedRule(t);
  const meta = p.registry.tokenMeta(mint);
  const image = meta?.imageUri ?? t.imageUrl ?? coinArtUrl(t.ticker, origin);
  const body = metadataJson({ ticker: t.ticker, mint: t.mint, name: t.name, description: metadataDescription(locked, t.description), oneLiner: "", rule: locked.rule, rulesSha256: t.rulesSha, origin, links: t.links }, image);
  return new NextResponse(body, { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=300" } });
}
