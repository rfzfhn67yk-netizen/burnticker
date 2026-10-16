import { NextResponse } from "next/server";
import { clientKey, edgeJson, limiter, readTextCapped } from "@/lib/burnticker/api/http";
import { isSameOrigin } from "@/lib/sameOrigin";
import { decodeCreatorImage } from "@/lib/burnticker/creatorProfile";
import { badgeCreatorImage } from "@/lib/burnticker/creatorBadge";

export const dynamic = "force-dynamic";
/** A 2 MB image as base64 (about 2.8 MB) and its envelope. */
const IMAGE_PREVIEW_MAX_BODY = 3_000_000;

/**
 * POST { image: { contentType, base64 } } → the same image with the Burnticker receipt mark composited, exactly as a launch would pin it
 * (src/lib/burnticker/creatorBadge.ts; website-15 item 13, owner addition 2026-10-12). The review card shows this before the wallet step.
 * Nothing is stored or pinned here. Same-origin only.
 */
export async function POST(req: Request) {
  if (!isSameOrigin(req)) return NextResponse.json({ error: "cross-site request refused", code: "cross-origin" }, { status: 403 });
  // prelaunch audit M3 (2026-10-15): decoding and compositing an image is the heaviest work a visitor can ask of the one Node process:
  // limited per visitor as a heavy read, the body capped before it is parsed, the pixels capped before decoding (creatorBadge.ts)
  const rl = limiter.take(clientKey(req), "heavy");
  if (!rl.ok) return NextResponse.json({ error: `Too many requests. Please try again in ${rl.retryAfterSec} seconds.`, code: "rate-limited" }, { status: 429, headers: { "retry-after": String(rl.retryAfterSec) } });
  const text = await readTextCapped(req, IMAGE_PREVIEW_MAX_BODY);
  if (text === null) return NextResponse.json({ error: "The image has to be 2 MB or smaller.", code: "too-large" }, { status: 413 });
  let body: { image?: unknown };
  try { body = JSON.parse(text); } catch { return NextResponse.json({ error: "invalid JSON body" }, { status: 400 }); }
  const d = decodeCreatorImage(body.image);
  if ("error" in d) return NextResponse.json({ error: d.error, code: "image-refused" }, { status: 400 });
  try {
    const b = await badgeCreatorImage(d.ok.bytes, d.ok.contentType);
    if ("error" in b) return NextResponse.json({ error: b.error, code: "image-refused" }, { status: 400 });
    return NextResponse.json({ contentType: b.ok.contentType, base64: Buffer.from(b.ok.bytes).toString("base64"), bytes: b.ok.bytes.length, side: b.ok.side });
  } catch (e) {
    console.error("[burnticker/image-preview] the mark could not be added:", e);
    return edgeJson({ error: "The preview could not be made just now.", code: "preview-unavailable" }, 502);
  }
}
