import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { LruMap } from "@/lib/burnticker/lru";
import { IMAGE_TYPES, sniffImageType, type ImageType } from "@/lib/burnticker/creatorProfile";

/**
 * THE SITE'S OWN COPY OF A COIN'S UPLOADED IMAGE (2026-10-27, the $GASCAT launch). The image a creator uploads is pinned to Arweave
 * through Irys with the coin's metadata (pin.ts), and its Arweave link is the metadata's `image`: that is the permanent record and it
 * stays so. On 2026-10-27 the Irys gateway redirected every pinned file to a CDN host whose TLS failed and arweave.net had not seeded
 * the file yet, so the first coin with an uploaded image showed its receipt art everywhere and outside viewers saw nothing. This host
 * kept no copy of the bytes, so there was nothing to serve instead.
 *
 * Now the launch also writes the exact uploaded bytes (after the receipt mark, the bytes whose sha256 the registry records) under
 * BURNTICKER_IMAGE_DIR (default data/burnticker-images), named by that sha256 with the type's extension. GET /burnticker/img/<MINT>
 * serves the file whose name is the registry's recorded image hash for that mint, and nothing else: the path never comes from the
 * request, the bytes are hashed again before they leave, and a file that does not hash to its own name is treated as missing. The
 * copy is a mirror. It is never the metadata's image, it is never written when the Arweave upload did not happen, and a failure to
 * write it never refuses a launch.
 */

/** The file extension of each image type the wizard accepts (the type is read back from the extension). */
export const IMAGE_COPY_EXT: Readonly<Record<ImageType, string>> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };
/** The largest file served: the wizard takes 2 MB and the receipt mark re-encodes it; anything bigger on disk is not ours. */
export const IMAGE_COPY_MAX_BYTES = 4 * 1024 * 1024;
const SHA256_RE = /^[0-9a-f]{64}$/;
const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
/** How many files' bytes stay in memory (a copy never changes, so a hit is served without touching the disk). */
const KEEP = 64;
const kept = new LruMap<string, { bytes: Uint8Array; contentType: ImageType }>(KEEP, { maxWeight: 48 * 1024 * 1024, weigh: (v) => v.bytes.byteLength });
/** Whether a hash has a file: a yes is kept for good, a no for a minute (the backfill script may add one while the web runs). */
const presence = new LruMap<string, { yes: boolean; at: number }>(4_000);
const PRESENCE_NO_MS = 60_000;

/** The directory the copies live in: BURNTICKER_IMAGE_DIR, or data/burnticker-images under the working directory. */
export function imageCopyDir(env: Readonly<Record<string, string | undefined>> = process.env): string {
  return (env.BURNTICKER_IMAGE_DIR ?? "").trim() || path.join("data", "burnticker-images");
}

export const imageCopySha256 = (b: Uint8Array): string => createHash("sha256").update(b).digest("hex");

/** The same-origin address a coin's copy is served at (the mint, nothing else). */
export const imageCopyHref = (mint: string): string => `/burnticker/img/${mint}`;

/**
 * Writes the bytes as <sha256>.<ext> (written to a temporary name and renamed, so a reader never sees half a file). The type comes
 * from the bytes themselves, never from the caller's word: bytes that are not a PNG, JPG, GIF or WebP are refused. Returns the file.
 */
export function keepImageCopy(bytes: Uint8Array, contentType: string, dir = imageCopyDir()): { file: string; sha256: string; contentType: ImageType } {
  const sniffed = sniffImageType(bytes);
  if (!sniffed) throw new Error("the image bytes are not a PNG, JPG, GIF or WebP file");
  if (sniffed !== contentType) throw new Error(`the image bytes are ${sniffed}, not the ${contentType} the caller named`);
  if (bytes.byteLength === 0 || bytes.byteLength > IMAGE_COPY_MAX_BYTES) throw new Error(`the image is ${bytes.byteLength} bytes; the copy keeps 1 to ${IMAGE_COPY_MAX_BYTES}`);
  const sha256 = imageCopySha256(bytes);
  const file = path.join(dir, `${sha256}.${IMAGE_COPY_EXT[sniffed]}`);
  if (!fs.existsSync(file)) {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, bytes, { mode: 0o644 });
    fs.renameSync(tmp, file);
  }
  presence.set(`${dir}|${sha256}`, { yes: true, at: Date.now() });
  kept.set(`${dir}|${sha256}`, { bytes, contentType: sniffed });
  return { file, sha256, contentType: sniffed };
}

/** The file for a hash, if one of the accepted extensions exists under `dir`; the hash is checked for shape first. */
function findCopy(sha256: string, dir: string): { file: string; contentType: ImageType } | null {
  if (!SHA256_RE.test(sha256)) return null;
  for (const t of IMAGE_TYPES) {
    const file = path.join(dir, `${sha256}.${IMAGE_COPY_EXT[t]}`);
    if (fs.existsSync(file)) return { file, contentType: t };
  }
  return null;
}

/** Whether a copy with this hash is on disk (memoised: see `presence`). The registry's hash, lower-cased; never a visitor's string. */
export function hasImageCopy(sha256: string | null | undefined, dir = imageCopyDir(), now = Date.now()): boolean {
  if (!sha256) return false;
  const h = sha256.toLowerCase();
  if (!SHA256_RE.test(h)) return false;
  const k = `${dir}|${h}`;
  const m = presence.get(k);
  if (m && (m.yes || now - m.at < PRESENCE_NO_MS)) return m.yes;
  const yes = findCopy(h, dir) !== null;
  presence.set(k, { yes, at: now });
  return yes;
}

/**
 * The bytes for a hash, bounded: the file must exist under one of the accepted names, be at most IMAGE_COPY_MAX_BYTES by its size
 * on disk, and hash to its own name; otherwise null (a wrong or damaged file is as good as none). Kept in memory once read.
 */
export function readImageCopy(sha256: string | null | undefined, dir = imageCopyDir()): { bytes: Uint8Array; contentType: ImageType } | null {
  if (!sha256) return null;
  const h = sha256.toLowerCase();
  if (!SHA256_RE.test(h)) return null;
  const k = `${dir}|${h}`;
  const hit = kept.get(k);
  if (hit) return hit;
  const f = findCopy(h, dir);
  if (!f) return null;
  let st: fs.Stats;
  try { st = fs.statSync(f.file); } catch { return null; }
  if (!st.isFile() || st.size === 0 || st.size > IMAGE_COPY_MAX_BYTES) return null;
  const bytes = new Uint8Array(fs.readFileSync(f.file));
  if (imageCopySha256(bytes) !== h) return null;
  if (sniffImageType(bytes) !== f.contentType) return null;
  const v = { bytes, contentType: f.contentType };
  kept.set(k, v);
  presence.set(k, { yes: true, at: Date.now() });
  return v;
}

/** For tests: forgets the kept bytes and the presence memo. */
export function clearImageCopyMemo(): void { kept.clear(); presence.clear(); }

/**
 * GET /burnticker/img/<MINT>: the copy whose name is the registry's recorded image hash for that coin. 404 when the mint is not one,
 * the coin is unknown, its image was not uploaded bytes (no recorded hash: the receipt art of an older coin or an outside link), or no
 * sound file is on disk. The mint is the only thing the request contributes; it is matched against the registry, never the disk.
 */
export function serveImageCopy(o: { registry: { tokenMeta(mint: string): { imageSha256: string | null } | null }; mint: string; dir?: string }): { status: 200; body: Uint8Array; type: ImageType; sha256: string } | { status: 404; body: string; type: "text/plain; charset=utf-8" } {
  const miss = (why: string) => ({ status: 404 as const, body: why, type: "text/plain; charset=utf-8" as const });
  if (!MINT_RE.test(o.mint)) return miss("not found");
  const meta = o.registry.tokenMeta(o.mint);
  if (!meta?.imageSha256) return miss("this site keeps no copy of that coin's image");
  const c = readImageCopy(meta.imageSha256, o.dir);
  if (!c) return miss("this site keeps no copy of that coin's image");
  return { status: 200, body: c.bytes, type: c.contentType, sha256: meta.imageSha256.toLowerCase() };
}
