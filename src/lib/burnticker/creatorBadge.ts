import fs from "node:fs";
import path from "node:path";
import { IMAGE_MAX_BYTES } from "@/lib/burnticker/creatorProfile";

/**
 * THE BURNTICKER RECEIPT MARK ON EVERY CREATOR IMAGE (website-15 item 13, owner addition 2026-10-12). A creator's uploaded image is
 * composited here, on the server and BEFORE the Arweave pin, so the pinned copy carries the mark wherever the coin shows:
 *
 *   - the image is cropped to a centered square (the card and wallets show it square);
 *   - the receipt mark (site/burnticker/brand/avatar.png, the brand's avatar, not the wordmark) sits in the lower-left corner, about 12%
 *     of the image's width, inset about 3% from the left and bottom edges, on a thin light keyline so it reads on dark and light images;
 *   - no text is added; the mark is OPTIONAL and on by default (owner, 2026-10-12): `imageBadge: false` on the launch pins the plain
 *     upload as checked, and the choice is recorded in the pinned metadata's attributes;
 *   - the format is kept: JPEG in, JPEG out; PNG, GIF (first frame) and WebP in, PNG out; the result must be at most 2 MB, re-encoded
 *     smaller (and, for a very large image, scaled down) when it is not.
 *
 * The generated receipt stub (no upload) is never badged: it already is the brand.
 */
export const BADGE_WIDTH_FRACTION = 0.12;
export const BADGE_INSET_FRACTION = 0.03;
export const BADGE_KEYLINE = "#f2eee4";
export { BADGE_NOTE, BADGE_TOGGLE } from "@/lib/burnticker/creatorBadgeCopy";
const MARK_FILES = [path.join("site", "burnticker", "brand", "avatar.png"), path.join("public", "burnticker", "brand", "mark.png")];

/** Where the badge lands on a square image of side `side`: its outer box (keyline included) in pixels. */
export function badgeBox(side: number): { x: number; y: number; size: number; keyline: number } {
  const mark = Math.max(8, Math.round(side * BADGE_WIDTH_FRACTION));
  const keyline = Math.max(1, Math.round(mark * 0.04));
  const size = mark + 2 * keyline;
  const inset = Math.round(side * BADGE_INSET_FRACTION);
  return { x: inset, y: side - inset - size, size, keyline };
}

function markBytes(root: string): Buffer {
  for (const f of MARK_FILES) { try { return fs.readFileSync(path.join(root, f)); } catch { /* next */ } }
  throw new Error("the Burnticker receipt mark could not be read on this host");
}

/** Composites the mark onto an already-checked creator image. Never returns more than IMAGE_MAX_BYTES. */
export async function badgeCreatorImage(bytes: Uint8Array, contentType: string, root = process.cwd()): Promise<{ ok: { bytes: Uint8Array; contentType: "image/png" | "image/jpeg"; side: number } } | { error: string }> {
  const sharp = (await import("sharp")).default;
  let meta;
  try { meta = await sharp(bytes, { pages: 1 }).metadata(); } catch { return { error: "The image could not be read. Send a PNG, JPG, GIF or WebP file." }; }
  const w = meta.width ?? 0, h = meta.height ?? 0;
  if (w < 16 || h < 16) return { error: "The image is too small. Send one at least 16 pixels on each side." };
  const outType = contentType === "image/jpeg" ? "image/jpeg" : "image/png";
  // a very large picture is scaled before the work; the mark is placed on the final square
  for (const maxSide of [2048, 1536, 1024, 768]) {
    const side = Math.min(w, h, maxSide);
    const b = badgeBox(side);
    const mark = b.size - 2 * b.keyline;
    const markPng = await sharp(markBytes(root)).resize(mark, mark, { fit: "cover" }).png().toBuffer();
    const keylined = await sharp({ create: { width: b.size, height: b.size, channels: 4, background: BADGE_KEYLINE } })
      .composite([{ input: markPng, left: b.keyline, top: b.keyline }]).png().toBuffer();
    const base = sharp(bytes, { pages: 1 }).rotate().resize(side, side, { fit: "cover", position: "centre" })
      .composite([{ input: keylined, left: b.x, top: b.y }]);
    const tries = outType === "image/jpeg" ? [90, 82, 72, 60] : [9];
    for (const q of tries) {
      const out = outType === "image/jpeg"
        ? await base.clone().flatten({ background: "#ffffff" }).jpeg({ quality: q, mozjpeg: true }).toBuffer()
        : await base.clone().png({ compressionLevel: q, palette: false }).toBuffer();
      if (out.length <= IMAGE_MAX_BYTES) return { ok: { bytes: new Uint8Array(out), contentType: outType, side } };
    }
  }
  return { error: "The image is still larger than 2 MB with the mark added. Send a smaller file." };
}
