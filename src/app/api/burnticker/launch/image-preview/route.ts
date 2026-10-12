import { NextResponse } from "next/server";
import { isSameOrigin } from "@/lib/sameOrigin";
import { decodeCreatorImage } from "@/lib/burnticker/creatorProfile";
import { badgeCreatorImage } from "@/lib/burnticker/creatorBadge";

export const dynamic = "force-dynamic";

/**
 * POST { image: { contentType, base64 } } → the same image with the Burnticker receipt mark composited, exactly as a launch would pin it
 * (src/lib/burnticker/creatorBadge.ts; website-15 item 13, owner addition 2026-10-12). The review card shows this before the wallet step.
 * Nothing is stored or pinned here. Same-origin only.
 */
export async function POST(req: Request) {
  if (!isSameOrigin(req)) return NextResponse.json({ error: "cross-site request refused", code: "cross-origin" }, { status: 403 });
  let body: { image?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON body" }, { status: 400 }); }
  const d = decodeCreatorImage(body.image);
  if ("error" in d) return NextResponse.json({ error: d.error, code: "image-refused" }, { status: 400 });
  try {
    const b = await badgeCreatorImage(d.ok.bytes, d.ok.contentType);
    if ("error" in b) return NextResponse.json({ error: b.error, code: "image-refused" }, { status: 400 });
    return NextResponse.json({ contentType: b.ok.contentType, base64: Buffer.from(b.ok.bytes).toString("base64"), bytes: b.ok.bytes.length, side: b.ok.side });
  } catch (e) {
    console.error("[burnticker/image-preview] the mark could not be added:", e);
    return NextResponse.json({ error: "The preview could not be made just now.", code: "preview-unavailable" }, { status: 502 });
  }
}
