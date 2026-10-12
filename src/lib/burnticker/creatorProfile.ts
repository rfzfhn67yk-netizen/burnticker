/**
 * THE CREATOR'S OWN IMAGE, DESCRIPTION AND LINKS (website-15 item 13; owner decisions 2026-10-12, LAUNCHPAD-PATH). The owner reversed the
 * 10-10 receipt-art-only rule: a creator may upload an image, write a description and add an X, Telegram or website link. Three rules
 * stay fixed:
 *
 *   1. The generated rule sentence stays FIRST and mandatory in the metadata description; the creator's text follows it.
 *   2. The creator's text and every link label pass the copy lint with the creator scope (which adds the no-affiliation lint).
 *   3. An upload carries one line the creator confirms (RIGHTS_LINE); a team, league or company mark is the creator's own risk, and the
 *      operator page gives a takedown route (TAKEDOWN_LINE).
 *
 * The same checks run in the browser (before anything is sent) and on the server (which never trusts the browser). Client-safe: no
 * imports beyond plain functions.
 */
export const IMAGE_MAX_BYTES = 2 * 1024 * 1024;
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];
export const DESCRIPTION_MAX = 280;
export const LINK_LABELS = ["X", "Telegram", "Website"] as const;

export const RIGHTS_LINE = "I have the right to use this image. A team, league or company mark is used at my own risk.";
export const TAKEDOWN_LINE = "To ask for an image to be removed from this site, email contact@burnticker.com. The copy on Arweave is permanent and cannot be removed.";
export const IMAGE_HELP = "PNG, JPG, GIF or WebP, up to 2 MB. It is shown square. Without one, the coin uses its generated receipt art.";
/** website-19 (owner, 2026-10-12: "can you copy and paste an image in as a thumbnail?"): the three ways in, said once. */
export const IMAGE_WAYS = "Choose a file, drop one here, or paste an image.";
/**
 * The image in a paste or a drop (a DataTransfer's files or items), or null when it holds none. A pasted image has no file name, so it gets
 * a generated one ("pasted-image.png"). Whatever it returns goes through the same check as a chosen file (imageFileProblem).
 */
export function imageFromTransfer(dt: { files?: ArrayLike<{ name: string; size: number; type: string }> | null; items?: ArrayLike<{ kind: string; type: string; getAsFile(): { name: string; size: number; type: string } | null }> | null } | null): { name: string; size: number; type: string } | null {
  if (!dt) return null;
  const files = Array.from(dt.files ?? []).filter((f) => f.type.startsWith("image/"));
  let f: { name: string; size: number; type: string } | null = files[0] ?? null;
  if (!f) for (const it of Array.from(dt.items ?? [])) if (it.kind === "file" && it.type.startsWith("image/")) { f = it.getAsFile(); if (f) break; }
  return f;
}
/** The name a pasted image is given when it has none. */
export const pastedImageName = (type: string): string => `pasted-image.${({ "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" } as Record<string, string>)[type] ?? "img"}`;

/** The image type from its first bytes (the declared type is never trusted alone). Null for anything else. */
export function sniffImageType(b: Uint8Array): ImageType | null {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "image/gif";
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return null;
}

/** The browser's check on a chosen file, by its size and declared type; null when it may be sent. */
export function imageFileProblem(f: { size: number; type: string }): string | null {
  if (!(IMAGE_TYPES as readonly string[]).includes(f.type)) return "The image has to be a PNG, JPG, GIF or WebP file.";
  if (f.size > IMAGE_MAX_BYTES) return "The image has to be 2 MB or smaller.";
  if (f.size === 0) return "The image file is empty.";
  return null;
}

/**
 * The server's check on an uploaded image: `{ contentType, base64 }` from the launch request. The bytes must decode, be at most 2 MB,
 * and their first bytes must match the declared type.
 */
export function decodeCreatorImage(v: unknown): { ok: { bytes: Uint8Array; contentType: ImageType } } | { error: string } {
  const o = v as { contentType?: unknown; base64?: unknown } | null;
  if (!o || typeof o !== "object" || typeof o.contentType !== "string" || typeof o.base64 !== "string") return { error: "The image must be sent as a content type and base64 bytes." };
  if (!(IMAGE_TYPES as readonly string[]).includes(o.contentType)) return { error: "The image has to be a PNG, JPG, GIF or WebP file." };
  // a base64 string longer than 2 MB of bytes needs is refused before it is decoded
  if (o.base64.length > Math.ceil(IMAGE_MAX_BYTES / 3) * 4 + 4) return { error: "The image has to be 2 MB or smaller." };
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(o.base64)) return { error: "The image bytes are not valid base64." };
  let bytes: Uint8Array;
  try { const bin = atob(o.base64); bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0)); } catch { return { error: "The image bytes are not valid base64." }; }
  if (bytes.length === 0) return { error: "The image file is empty." };
  if (bytes.length > IMAGE_MAX_BYTES) return { error: "The image has to be 2 MB or smaller." };
  const sniffed = sniffImageType(bytes);
  if (sniffed !== o.contentType) return { error: "The image's bytes do not match its type. Send a PNG, JPG, GIF or WebP file." };
  return { ok: { bytes, contentType: sniffed } };
}

/** The creator's links, from the three fields: https only, labelled X, Telegram or Website. Problems name the field. */
export function creatorLinks(v: { x?: string; telegram?: string; website?: string }): { links: { label: string; url: string }[]; problems: string[] } {
  const links: { label: string; url: string }[] = [], problems: string[] = [];
  for (const [label, raw] of [["X", v.x], ["Telegram", v.telegram], ["Website", v.website]] as const) {
    const u = (raw ?? "").trim();
    if (!u) continue;
    if (!/^https:\/\/\S{1,200}$/.test(u)) { problems.push(`The ${label} link has to start with https:// and have no spaces.`); continue; }
    links.push({ label, url: u });
  }
  return { links, problems };
}

/**
 * The description pinned with the coin: the generated paragraph first (its first sentence is the rule), then the creator's text. The
 * creator's text never comes first and never replaces the generated paragraph.
 */
export const CREATOR_TEXT_SEPARATOR = "\n\n";
export const withCreatorText = (generated: string, creatorText: string): string => [generated.trim(), creatorText.trim()].filter(Boolean).join(CREATOR_TEXT_SEPARATOR);
/** The creator's own text from a stored description (after the generated paragraph); null when there is none. */
export function creatorTextOf(description: string): string | null {
  const i = description.indexOf(CREATOR_TEXT_SEPARATOR);
  const t = i < 0 ? "" : description.slice(i + CREATOR_TEXT_SEPARATOR.length).trim();
  return t || null;
}
