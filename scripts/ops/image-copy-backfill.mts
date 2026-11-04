/**
 * BACKFILL THE SITE'S COPY OF A PINNED IMAGE (2026-10-27). A coin launched before this host kept copies of uploaded images (imageStore.ts),
 * or while the Irys gateway was down, has an Arweave image and no file under data/burnticker-images. This script fetches the pinned
 * file from the Irys gateway (then arweave.net), checks that its sha256 is exactly the hash recorded at launch, and only then writes it
 * where GET /burnticker/img/<MINT> looks. Bytes that hash to anything else are thrown away and the script fails: the recorded hash is the
 * only thing that makes a file this coin's image.
 *
 * The first use is $GASCAT (launched 2026-10-27 while the gateway redirected every file to a host whose TLS failed): the owner's
 * original file hashes differently because the wizard draws the receipt mark before it uploads, so the marked bytes exist only on
 * Arweave. Its transaction and hash are the defaults below. Run it on the host, as the web user, once the gateway serves the file again:
 *
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/alias-hook.mjs scripts/ops/image-copy-backfill.mts
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/alias-hook.mjs scripts/ops/image-copy-backfill.mts --tx <id> --sha256 <hex> [--dir data/burnticker-images] [--dry-run]
 *
 * It reads no registry and no secrets, writes one file, and prints where it put it. --dry-run fetches and checks without writing.
 * BURNTICKER_IMAGE_DIR, when set, is the directory the web serves from; pass the same value with --dir if the units set it.
 */
import { createHash } from "node:crypto";
import { imageCopyDir, keepImageCopy, readImageCopy } from "@/lib/burnticker/imageStore";
import { sniffImageType } from "@/lib/burnticker/creatorProfile";

const GASCAT = { tx: "DzUsH1bfBKtyFnhXXZL5sQ6uV7mU7fvPvdv7D5A35qbj", sha256: "0a82bda5d32151f5cc528a2cc5bfbc0504e256268e43fa398763607a5d67fd06" };
const MAX_BYTES = 4 * 1024 * 1024;

const args = process.argv.slice(2);
const flag = (name: string): string | null => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] ?? null : null; };
const tx = (flag("--tx") ?? GASCAT.tx).trim();
const want = (flag("--sha256") ?? GASCAT.sha256).trim().toLowerCase();
const dir = (flag("--dir") ?? "").trim() || imageCopyDir();
const dryRun = args.includes("--dry-run");
if (!/^[A-Za-z0-9_-]{20,64}$/.test(tx)) { console.error("--tx is not an Arweave transaction id"); process.exit(2); }
if (!/^[0-9a-f]{64}$/.test(want)) { console.error("--sha256 is not a 64-digit hex hash"); process.exit(2); }

const already = readImageCopy(want, dir);
if (already) { console.log(`already kept: ${dir} has a sound ${already.contentType} copy for ${want.slice(0, 16)}…`); process.exit(0); }

async function fetchCapped(url: string): Promise<Uint8Array> {
  const r = await fetch(url, { redirect: "follow", cache: "no-store", signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  if (Number(r.headers.get("content-length") ?? 0) > MAX_BYTES) throw new Error(`larger than ${MAX_BYTES} bytes`);
  const buf = new Uint8Array(await r.arrayBuffer());
  if (buf.byteLength > MAX_BYTES) throw new Error(`larger than ${MAX_BYTES} bytes`);
  return buf;
}

let bytes: Uint8Array | null = null;
const tried: string[] = [];
for (const url of [`https://gateway.irys.xyz/${tx}`, `https://arweave.net/${tx}`]) {
  try { bytes = await fetchCapped(url); console.log(`read ${bytes.byteLength} bytes from ${url}`); break; }
  catch (e) { tried.push(`${url}: ${e instanceof Error ? e.message : String(e)}`); }
}
if (!bytes) { console.error(`the pinned file could not be read:\n  ${tried.join("\n  ")}`); process.exit(1); }
const got = createHash("sha256").update(bytes).digest("hex");
if (got !== want) { console.error(`the bytes hash to ${got}, not the recorded ${want}; nothing written`); process.exit(1); }
const type = sniffImageType(bytes);
if (!type) { console.error("the bytes are not a PNG, JPG, GIF or WebP file; nothing written"); process.exit(1); }
if (dryRun) { console.log(`dry run: ${type}, sha256 matches; would write under ${dir}`); process.exit(0); }
const kept = keepImageCopy(bytes, type, dir);
console.log(`kept ${kept.file} (${kept.contentType}, sha256 ${kept.sha256})`);
