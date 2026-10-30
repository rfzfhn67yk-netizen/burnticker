/**
 * WHERE A COIN'S IMAGE IS TRIED, IN ORDER (2026-10-27, the $GASCAT launch during the Irys gateway outage). The card, the coin page and
 * the creator page draw the coin's image through CoinThumb, which until now had one address and one fallback (the receipt-style
 * initials). A pinned image has more than one honest source: this site's own copy of the uploaded bytes (imageStore.ts, when the
 * registry's hash has a file), the Irys gateway and arweave.net for the same transaction, and the coin's generated art when it is
 * registered. CoinThumb walks this list on each load error. Client-safe, pure.
 */

/** The same-origin copy, by mint only (imageStore.ts imageCopyHref). */
export const IMAGE_MIRROR_RE = /^\/burnticker\/img\/[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const PIN_RE = /^https:\/\/(gateway\.irys\.xyz|arweave\.net|devnet\.irys\.xyz)\/([A-Za-z0-9_-]{20,64})$/;

export interface ImageSourcesInput {
  /** the address the registry row shows (the pinned Arweave link, an older coin's outside link, a same-origin brand file, or a data: preview) */
  src: string | null | undefined;
  /** the same-origin copy, when the server says the registry's hash has a file (profile.imageMirror) */
  mirror?: string | null;
  ticker: string;
  /** the coin is registered: its generated art (/burnticker/img/<TICKER>.svg) is a source of last resort */
  generated?: boolean;
  /** a launch preview may show the data: image the creator just picked */
  preview?: boolean;
}

/** The addresses to try, first to last; empty means the receipt-style initials straight away. No address repeats. */
export function imageSources(i: ImageSourcesInput): string[] {
  const out: string[] = [];
  const add = (u: string | null | undefined) => { if (u && !out.includes(u)) out.push(u); };
  const src = i.src ?? null;
  if (i.mirror && IMAGE_MIRROR_RE.test(i.mirror)) add(i.mirror);
  if (i.preview && src && /^data:image\/(png|jpeg|gif|webp);base64,/.test(src)) add(src);
  else if (src && /^https:\/\//.test(src)) {
    add(src);
    const m = PIN_RE.exec(src);
    if (m) {
      const [, host, tx] = m;
      // a devnet file is on Irys devnet only; a mainnet file is at the gateway at once and on arweave.net once seeded
      if (host !== "devnet.irys.xyz") { add(`https://gateway.irys.xyz/${tx}`); add(`https://arweave.net/${tx}`); }
    }
  } else if (src && /^\/burnticker\/(img|brand)\/[\w.-]+$/.test(src)) add(src);
  if (i.generated && /^[A-Z0-9]{2,10}$/.test(i.ticker)) add(`/burnticker/img/${i.ticker}.svg`);
  return out;
}
