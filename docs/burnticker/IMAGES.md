# How a coin's image is stored and served

Written 2026-10-27, after the first coin with an uploaded image launched during an Irys gateway outage.

## The permanent record is on Arweave

When a creator uploads an image in the launch wizard, the wizard checks it (type by its bytes, 2 MB or smaller), draws the receipt
mark unless the creator turned it off, and the launch handler pins the marked bytes to Arweave through Irys together with the coin's
metadata JSON (`src/lib/burnticker/pin.ts`). The registry's `token_meta` row keeps both transaction ids and both sha256 hashes, written
once. The metadata's `image` field is the Arweave address of that upload. None of this changed.

An image counts as pinned only when its bytes were uploaded with the coin and their sha256 recorded (audit 7, F07). An image given as
a web address is refused.

## The site also keeps a copy

The host used to keep none of the image bytes, so when the gateway could not serve them the card showed the receipt art and anyone
reading the metadata saw nothing. Now:

- At launch, once the image upload has succeeded (or a retry recalled the same bytes), `pinCoin` calls the `kept` hook with the exact
  uploaded bytes, and the launch handler writes them to the image directory as `<sha256>.<ext>` (`src/lib/burnticker/imageStore.ts`).
  The extension comes from the bytes themselves, never from the request. A failure to write the copy is logged and never refuses the
  launch, and the copy is never written instead of the Arweave upload.
- The directory is `BURNTICKER_IMAGE_DIR`, or `data/burnticker-images` under the working directory when it is not set. The test suite
  points it at a temporary directory like the other data paths.
- `GET /burnticker/img/<MINT>` (a bare mint, no extension) serves the file whose name is the registry's recorded image hash for that
  mint, with a one-year immutable cache header and an `x-image-sha256` header. The request contributes only the mint; the path is built
  from the registry's hash. The file must be 4 MB or smaller by its size on disk and must hash to its own name, or the route answers 404
  as if there were no file. A coin whose image was not uploaded bytes has no copy and answers 404.
- The coin read (`server.ts`) adds `imageMirror` (the same-origin address) to the coin's profile, the coins index and the creator page
  when the file exists. The check is one memoised existence test per coin.

## Which address the browser tries

`CoinThumb` walks a list (`src/lib/burnticker/imageChain.ts`), moving to the next entry on a load error:

1. this site's copy, when the server said it has one;
2. the address the registry row shows (the pinned Arweave link);
3. `gateway.irys.xyz/<tx>` and `arweave.net/<tx>` for the same transaction, whichever the row did not already name;
4. the coin's generated art at `/burnticker/img/<TICKER>.svg` for a registered coin;
5. the receipt-style initials, drawn in CSS, when every address failed.

The receipt share card and the Open Graph image draw the coin's generated art and never the uploaded image, so they are not affected.
The content security policy already allows `'self'` and any https image, so no origin was added.

## What the pinned check says

The coin page's pinned check reads the site's copy, hashes it in the browser and compares it with the hash recorded at launch. It
prints one of four lines (`src/lib/burnticker/imagePin.ts`): the copy matches, the copy does not match, the site keeps no copy, or
the copy could not be read just now. Every line says that the Arweave copy is the permanent record and the site copy is a mirror.
The pin-check API adds an `image` object with `mirror` ("ok" or "none") and the copy's address.

## Backfilling a coin launched before this

`scripts/ops/image-copy-backfill.mts` fetches a pinned file from the gateway (then arweave.net), refuses it unless its sha256 is the
recorded one, and writes it into the image directory. Its defaults are $GASCAT's transaction and hash. Run it on the host as the web
user once the gateway serves the file again; `--dry-run` fetches and checks without writing. It reads no registry and no secrets.
