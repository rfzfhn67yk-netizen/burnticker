/**
 * WHAT THE COIN'S IMAGE REALLY IS (audit 7 F07, 2026-10-19). A launch prepared with an ordinary https `imageUrl` (API only, behind
 * BURNTICKER_CUSTOM_IMAGES_ENABLED) keeps that outside address in its metadata: pin.ts stores no image hash for it and uploads no
 * bytes. The pinned check used to call any image "pinned too" because it only looked for a non-empty address. An image is called
 * pinned only when its bytes were uploaded with the coin and their sha256 recorded (the receipt art or an uploaded file); any other
 * image is an outside link the creator, or whoever runs that website, can change or take down. Nothing here fetches anything.
 *
 * Client-safe (no Node imports): PinnedCheck.tsx, ReviewCard.tsx and launchBundle.ts read it.
 */

export type ImagePinState = "pinned" | "outside" | "none";

const SHA256_RE = /^[0-9a-f]{64}$/i;

/** "pinned" only with a recorded sha256 of the uploaded bytes; an image address without one is "outside"; no image is "none". */
export function imagePinState(p: { imageUri: string | null | undefined; imageSha256: string | null | undefined }): ImagePinState {
  if (!p.imageUri) return "none";
  return p.imageSha256 && SHA256_RE.test(p.imageSha256) ? "pinned" : "outside";
}

/** The pinned check and the coin page, for an image that is only a link. */
export const IMAGE_OUTSIDE_LINK_LINE = "The image is a link to another website, not a pinned copy. Whoever runs that website can change it or take it down.";

/**
 * NO IMAGE BY WEB ADDRESS (owner decision 2026-10-19, the F07 follow-up). A new launch's image is the creator's uploaded bytes (the
 * `image` field: decoded, size-checked, marked and pinned to Arweave with their sha256) or the generated receipt art. An `imageUrl`
 * is refused with 400 `image-url-refused`, in every form: an https address can be swapped or vanish after launch, and every visitor's
 * browser would contact that host; an `ar://` or gateway reference cannot be checked here either, because an Arweave transaction id
 * is not a hash of the bytes and confirming them would mean fetching from the network, which this site does not do for a launch.
 * Coins registered earlier with an outside address keep it (the registry is append-only) and carry IMAGE_OUTSIDE_LINK_LINE.
 */
export const IMAGE_URL_REFUSED = "A coin's image cannot be given as a web address. Send the picture itself in the image field, and it is checked and pinned with the coin's details. Leave the image out and the coin uses its generated receipt art.";

/** True when the request named an image address at all (null, absent and the empty string mean none). */
export const imageUrlSent = (v: unknown): boolean => v !== undefined && v !== null && v !== "";

/** The review card's Image row: what is pinned with the coin's details (the page only uploads files, so both are pinned). */
export const REVIEW_IMAGE_UPLOADED = "Your image, pinned with the coin's details";
export const REVIEW_IMAGE_GENERATED = "The generated receipt art, pinned with the coin's details";
