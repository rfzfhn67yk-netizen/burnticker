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
// WZ6-12 (sixth pass): the smallest accepted size and what happens to an animated GIF (creatorBadge.ts reads one page), said up front
export const IMAGE_HELP = "PNG, JPG, GIF or WebP, up to 2 MB and at least 16 pixels on each side. An animated GIF is pinned as its first frame. It is shown square. Without one, the coin uses its generated receipt art.";
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

/**
 * A web address a creator may link (intent audit item 13, 2026-10-12: "https://?" passed the old pattern check). The address is PARSED
 * (new URL) and must be https, at most 200 characters with no spaces, carry no user name or password, and name a host with a dot whose
 * last label is a real top-level name ("x.com" passes; "x", "?" and "localhost" do not). The page and the server use this one check.
 */
export function isWebLink(raw: string): boolean {
  if (typeof raw !== "string" || !/^https:\/\/\S{1,200}$/.test(raw)) return false;
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== "https:" || u.username || u.password) return false;
  const labels = u.hostname.split(".");
  return labels.length >= 2 && labels.every((l) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(l)) && /^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/i.test(labels[labels.length - 1]);
}
/**
 * THE LINK FIELDS, PER FIELD (ChatGPT audit 7 item 3, 2026-10-12: "javascript:alert(1)" passed as an X link on the page, Telegram took any
 * site, X took facebook.com, Website took burnticker.com). One check for the page, the review, the bundle and every place a link renders:
 *
 *   every field  https only, parsed (isWebLink): javascript:, data:, http: and anything that is not a full https address are refused
 *   X            x.com or twitter.com (www. and mobile. allowed)
 *   Telegram     t.me
 *   Website      any public site except burnticker.com and its subdomains, an address whose letters read as "burnticker" or "deficit"
 *                once look-alike characters are folded (burntlcker, burnt1cker, def1cit, rn for m), and internationalised addresses
 *                (xn--), which can imitate any of these with letters from other scripts
 */
export type LinkField = "X" | "Telegram" | "Website";
const SITE_NAMES = ["burnticker", "deficit"];
/** The letters an address reads as: lower case, look-alike digits and letter pairs folded, separators dropped. */
export const confusableSkeleton = (host: string): string => host.toLowerCase().replace(/rn/g, "m").replace(/vv/g, "w").replace(/[0o]/g, "o").replace(/[1il|]/g, "l").replace(/3/g, "e").replace(/4/g, "a").replace(/5/g, "s").replace(/7/g, "t").replace(/[^a-z]/g, "");
const lookalikeOfSite = (host: string): boolean => {
  const sk = confusableSkeleton(host.replace(/\.[a-z]+$/i, ""));
  return SITE_NAMES.some((n) => { const ns = confusableSkeleton(n); if (sk.includes(ns)) return true; for (let i = 0; i + ns.length - 1 <= sk.length; i++) { const w = sk.slice(i, i + ns.length); if (w.length === ns.length && [...w].filter((c, k) => c !== ns[k]).length === 1) return true; } return false; });
};
export const fieldOfLabel = (label: string): LinkField => (/^(x|twitter)$/i.test(label.trim()) ? "X" : /^telegram$/i.test(label.trim()) ? "Telegram" : "Website");
/** The sentence for a link that this field cannot take, naming the field, or null. */
export function linkProblem(label: string, raw: string): string | null {
  if (!/^https:\/\/\S{1,200}$/.test(raw)) return `The ${label} link has to start with https:// and have no spaces.`;
  if (!isWebLink(raw)) return `The ${label} link is not a full web address. Use one like https://example.com.`;
  const host = new URL(raw).hostname.toLowerCase();
  const field = fieldOfLabel(label);
  if (field === "X") return /^(?:(?:www|mobile)\.)?(?:x|twitter)\.com$/.test(host) ? null : `The ${label} link has to be an x.com or twitter.com address.`;
  if (field === "Telegram") return host === "t.me" ? null : `The ${label} link has to be a t.me address.`;
  if (/(^|\.)burnticker\.com$/.test(host)) return `The ${label} link cannot point at burnticker.com. Every coin already links to its own Burnticker page.`;
  if (host.split(".").some((l) => l.startsWith("xn--"))) return `The ${label} link uses an internationalised address (xn--). Use the plain spelling of the address.`;
  if (lookalikeOfSite(host)) return `The ${label} link's address reads like Burnticker's or $DEFICIT's. Link a site of your own.`;
  return null;
}
/** Every problem with a request's links (at most 4, short labels, each passing its field's check): the review and the bundle call this. */
export function linksProblems(links: unknown): string[] {
  if (!Array.isArray(links) || links.length > 4 || links.some((l) => typeof l?.url !== "string" || typeof l?.label !== "string" || l.label.length > 24)) return ["links: up to 4 https URLs with short labels"];
  return (links as { label: string; url: string }[]).map((l) => linkProblem(l.label, l.url)).filter((x): x is string => x !== null);
}
/** A stored link is shown only when it still passes its field's check (links registered before these checks included). */
export const safeCreatorLink = (l: { label?: unknown; url?: unknown }): boolean => typeof l?.url === "string" && typeof l?.label === "string" && linkProblem(l.label, l.url) === null;

/** The creator's links, from the three fields: https only, labelled X, Telegram or Website. Problems name the field. */
export function creatorLinks(v: { x?: string; telegram?: string; website?: string }): { links: { label: string; url: string }[]; problems: string[] } {
  const links: { label: string; url: string }[] = [], problems: string[] = [];
  for (const [label, raw] of [["X", v.x], ["Telegram", v.telegram], ["Website", v.website]] as const) {
    const u = (raw ?? "").trim();
    if (!u) continue;
    const lp = linkProblem(label, u);
    if (lp) { problems.push(lp); continue; }
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
/**
 * The coin description's ceiling: the generated rule paragraph, the separator and the creator's own text (launchBundle.ts re-exports it
 * as DESCRIPTION_LIMIT; kept here so the Name step can check it in the browser).
 */
export const DESCRIPTION_TOTAL_LIMIT = 1_500;
/**
 * sources-7 (QA walkthrough 11 H2): how many characters of the creator's own text fit after this generated paragraph — DESCRIPTION_MAX
 * when the paragraph leaves the whole of it, less when it does not (never below 0). The Name step and the review both read it.
 */
export const descriptionRoom = (generated: string): number => Math.max(0, Math.min(DESCRIPTION_MAX, DESCRIPTION_TOTAL_LIMIT - generated.trim().length - CREATOR_TEXT_SEPARATOR.length));
/** The Name step's sentence when the creator's text is longer than the room the rule's paragraph leaves (null: it fits). */
export function descriptionRoomProblem(generated: string, creatorText: string): string | null {
  const room = descriptionRoom(generated), n = creatorText.trim().length;
  // a text over DESCRIPTION_MAX itself is the plain length check's sentence, not this one
  if (n <= room || room === DESCRIPTION_MAX) return null;
  return room === 0
    ? "The rule's own paragraph fills this coin's description, so there is no room for your text. Leave the description empty."
    : `Your description can be at most ${room.toLocaleString("en-US")} characters for this coin, because the rule's own paragraph uses the rest. It has ${n.toLocaleString("en-US")}.`;
}
/** The creator's own text from a stored description (after the generated paragraph); null when there is none. */
export function creatorTextOf(description: string): string | null {
  const i = description.indexOf(CREATOR_TEXT_SEPARATOR);
  const t = i < 0 ? "" : description.slice(i + CREATOR_TEXT_SEPARATOR.length).trim();
  return t || null;
}
