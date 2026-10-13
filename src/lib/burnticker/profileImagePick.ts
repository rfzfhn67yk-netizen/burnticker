import { IMAGE_MAX_BYTES, imageFileProblem, pastedImageName, sniffImageType, type ImageType } from "@/lib/burnticker/creatorProfile";
import type { Latest } from "@/lib/burnticker/latestOnly";

/**
 * ONE IMAGE PICK ON THE REVIEW CARD (launch audit 219–225, 2026-10-12). ProfileFields.tsx hands every chosen, dropped or pasted file to
 * pickImage, which checks it, reads it, asks POST /api/burnticker/launch/image-preview for the copy with the receipt mark, and applies the
 * answer only while it is the newest pick (latestOnly.ts). The rules:
 *
 *   219  every way out of a pick clears the busy line ("Adding the receipt mark."), including a file refused before it is read
 *   220  a replacement that fails keeps the image already chosen (and says so); with no earlier image the field shows the failure
 *   221  when the mark service cannot answer (a 5xx, a broken answer, no network), the creator's own file is used WITHOUT the mark; a
 *        refusal of the file itself (400: too small, bytes that do not match the type) is still a failure
 *   223  an answer is used only as { contentType: image/png or image/jpeg, base64 }
 *   225  a file whose browser type is empty (some systems give none) is typed by its first bytes, never refused for the missing type
 *
 * Client-safe: plain functions; the file reading and the request come in as `deps`.
 */

/** Launch audit 222: the size advice, beside IMAGE_HELP. The server refuses anything under 16 pixels on a side (creatorBadge.ts). */
export const IMAGE_SIZE_HELP = "A square image at least 512 pixels on each side looks best. The smallest one accepted is 16 pixels on each side.";
/** Launch audit 221: shown in place of the mark choice when the mark could not be added. */
export const BADGE_UNAVAILABLE_LINE = "The receipt mark could not be added just now, so this image is used without it. Choose the file again to try the mark.";
export const PREVIOUS_IMAGE_KEPT = "The previous image is kept.";
export const IMAGE_READ_FAILED = "The image could not be read. Try another file.";

export interface PickedImage { badgedUrl: string; plainUrl: string; contentType: string; base64: string; name: string; /** the mark service did not answer: the plain file is used and there is no mark to choose */ badgeUnavailable?: boolean }
export interface ImageFields { image: PickedImage | null; rights: boolean; badge: boolean; imageState?: "pending" | "failed" | null }

export type PreviewAnswer = { ok: { contentType: "image/png" | "image/jpeg"; base64: string } } | { refused: string } | { unavailable: true };
/** The image-preview route's answer, read strictly (launch audit 223). `status` null = the request never got an answer. */
export function readPreviewAnswer(status: number | null, body: unknown): PreviewAnswer {
  const o = (body && typeof body === "object" ? body : null) as { contentType?: unknown; base64?: unknown; error?: unknown } | null;
  if (status !== null && status >= 200 && status < 300) {
    if (o && (o.contentType === "image/png" || o.contentType === "image/jpeg") && typeof o.base64 === "string" && o.base64.length > 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(o.base64)) return { ok: { contentType: o.contentType, base64: o.base64 } };
    return { unavailable: true };
  }
  if (status === 400) return { refused: typeof o?.error === "string" && o.error ? o.error : "The image was refused. Try another file." };
  return { unavailable: true };
}

/** The image type from the first bytes of a base64 string, or null. */
export function sniffBase64(base64: string): ImageType | null {
  try { const head = atob(base64.slice(0, 24)); return sniffImageType(Uint8Array.from(head, (c) => c.charCodeAt(0))); } catch { return null; }
}

export interface PickDeps<P extends ImageFields> {
  latest: Latest;
  /** merges into the LATEST value (a functional update) */
  update(fn: (prev: P) => P): void;
  /** whether a valid image is chosen right now (read at the moment a pick fails, not when it began) */
  hasImage(): boolean;
  setBusy(on: boolean): void;
  setError(message: string | null): void;
  readDataUrl(file: Blob): Promise<string>;
  preview(image: { contentType: string; base64: string }): Promise<{ status: number; body: unknown }>;
}
export type PickOutcome = "none" | "failed" | "stale" | "badged" | "plain";

export async function pickImage<P extends ImageFields>(file: (Blob & { name: string; size: number; type: string }) | null, d: PickDeps<P>): Promise<PickOutcome> {
  d.setError(null);
  if (!file) return "none";
  const token = d.latest.next();
  const current = () => d.latest.isCurrent(token);
  const fail = (message: string): PickOutcome => {
    if (!current()) return "stale";
    d.setBusy(false);
    const keep = d.hasImage();
    d.setError(keep ? `${message} ${PREVIOUS_IMAGE_KEPT}` : message);
    d.update((prev) => ({ ...prev, imageState: prev.image ? null : "failed" }));
    return "failed";
  };
  // checked by size and declared type before anything is read; an empty type is decided by the bytes below
  const early = file.type ? imageFileProblem(file) : file.size > IMAGE_MAX_BYTES || file.size === 0 ? imageFileProblem({ size: file.size, type: "image/png" }) : null;
  if (early) return fail(early);
  d.update((prev) => ({ ...prev, imageState: "pending" }));
  d.setBusy(true);
  let url: string;
  try { url = await d.readDataUrl(file); } catch { return fail(IMAGE_READ_FAILED); }
  if (!current()) return "stale";
  const base64 = url.slice(url.indexOf(",") + 1);
  const type = file.type || sniffBase64(base64);
  if (!type || imageFileProblem({ size: file.size, type })) return fail("The image has to be a PNG, JPG, GIF or WebP file.");
  const name = file.name || pastedImageName(type), plainUrl = `data:${type};base64,${base64}`;
  let answer: PreviewAnswer;
  try { const r = await d.preview({ contentType: type, base64 }); answer = readPreviewAnswer(r.status, r.body); } catch { answer = { unavailable: true }; }
  if (!current()) return "stale";
  if ("refused" in answer) return fail(answer.refused);
  d.setBusy(false);
  if ("unavailable" in answer) {
    d.update((prev) => ({ ...prev, image: { badgedUrl: plainUrl, plainUrl, contentType: type, base64, name, badgeUnavailable: true }, badge: false, rights: false, imageState: null }));
    return "plain";
  }
  const ok = answer.ok;
  // a mark that came back after an earlier pick had none turns the mark on again (its default); otherwise the creator's choice stands
  d.update((prev) => ({ ...prev, image: { badgedUrl: `data:${ok.contentType};base64,${ok.base64}`, plainUrl, contentType: type, base64, name }, badge: prev.image?.badgeUnavailable ? true : prev.badge, rights: false, imageState: null }));
  return "badged";
}

/**
 * Launch audit 224: the largest launch body the page can send is a pair with two 2 MB images, each base64 (4/3 larger) inside JSON. This
 * is that size in bytes, for the host check in the tests (no proxy limit below it; the routes read the whole body).
 */
export const MAX_PAIR_IMAGE_BYTES_IN_BODY = 2 * (Math.ceil(IMAGE_MAX_BYTES / 3) * 4);
