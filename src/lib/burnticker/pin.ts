import crypto from "node:crypto";
import type { BurnRule } from "@/lib/burnticker/rules";
import { renderCoinSvg } from "@/lib/burnticker/coinArt";

/**
 * NOTHING ABOUT A COIN CAN CHANGE AFTER LAUNCH (2026-10-10). LaunchLab creates the Metaplex metadata with is_mutable = false, so the
 * name, symbol and URI are fixed on chain — but a URI on a server we run would leave the description and the image behind it mutable.
 * So at launch the generated metadata JSON (name, symbol, the locked generated description byte-for-byte, the image, the coin page,
 * the socials as `extensions`) and the generated receipt-art PNG are uploaded to ARWEAVE through Irys (content-addressed; the
 * platform's ops key BURNTICKER_UPLOAD_PAYER pays the ~$0.01–0.05 per coin — never the keeper signer; devnet uses Irys devnet), and
 * the token URI is the arweave URL. The registry keeps both transaction ids and both sha256 (registry.token_meta, written once); the
 * coin page and the trust page's verifier re-fetch and compare.
 *
 * If the upload fails the launch is REFUSED: no server-hosted URI, ever. The old hosted JSON (/api/burnticker/metadata/<mint>) stays
 * only behind BURNTICKER_ALLOW_HOSTED_METADATA (default off) for devnet scripts, and such a coin is marked `hosted` everywhere.
 */

export interface PinUploader {
  readonly name: string;
  /** Uploads bytes; returns the transaction id and the gateway URL (https://arweave.net/<id>, or Irys devnet's gateway on devnet). */
  upload(body: Uint8Array, contentType: string, tags: { name: string; value: string }[]): Promise<{ id: string; url: string }>;
}
export interface PinnedCoin {
  metadataUri: string; metadataTx: string; metadataSha256: string; metadataJson: string;
  imageUri: string; imageTx: string; imageSha256: string;
  hosted: false;
}
export const sha256Hex = (b: Uint8Array | string): string => crypto.createHash("sha256").update(typeof b === "string" ? Buffer.from(b, "utf8") : b).digest("hex");

/**
 * The Irys uploader (Arweave). It loads the Irys client packages at call time — they are not dependencies of this tree until the
 * operator installs them (`@irys/upload`, `@irys/upload-solana`) — and signs with BURNTICKER_UPLOAD_PAYER (a base58 Solana secret key
 * of the ops wallet that funds Irys). Missing package or payer → an error, and the launch is refused.
 */
export class IrysUploader implements PinUploader {
  readonly name = "irys";
  private o: { cluster: "devnet" | "mainnet" | "localnet"; payer: string | null; rpcUrl?: string | null };
  constructor(o: { cluster: "devnet" | "mainnet" | "localnet"; payer: string | null; rpcUrl?: string | null }) { this.o = o; }
  async upload(body: Uint8Array, contentType: string, tags: { name: string; value: string }[]): Promise<{ id: string; url: string }> {
    if (!this.o.payer) throw new Error("BURNTICKER_UPLOAD_PAYER (the ops wallet that pays Irys) is not set");
    type IrysChain = { withWallet(k: string): IrysChain; withRpc(u: string): IrysChain; devnet(): IrysChain; then: Promise<IrysClient>["then"] };
    type IrysClient = { upload(data: Buffer, o: { tags: { name: string; value: string }[] }): Promise<{ id: string }> };
    let Uploader: (c: unknown) => IrysChain, Solana: unknown;
    try {
      const pkgA = "@irys/upload", pkgB = "@irys/upload-solana";
      ({ Uploader } = (await import(/* webpackIgnore: true */ pkgA)) as { Uploader: (c: unknown) => IrysChain });
      ({ Solana } = (await import(/* webpackIgnore: true */ pkgB)) as { Solana: unknown });
    } catch { throw new Error("the Irys client (@irys/upload, @irys/upload-solana) is not installed on this host"); }
    let chain = Uploader(Solana).withWallet(this.o.payer);
    if (this.o.cluster !== "mainnet") chain = chain.withRpc(this.o.rpcUrl ?? "https://api.devnet.solana.com").devnet();
    const client = await chain;
    const r = await client.upload(Buffer.from(body), { tags: [{ name: "Content-Type", value: contentType }, ...tags] });
    return { id: r.id, url: this.o.cluster === "mainnet" ? `https://arweave.net/${r.id}` : `https://devnet.irys.xyz/${r.id}` };
  }
}

/** The uploader from the environment (null when no payer is configured: every launch is then refused unless hosted metadata is allowed). */
export function uploaderFromEnv(env: Readonly<Record<string, string | undefined>>, cluster: "devnet" | "mainnet" | "localnet"): PinUploader | null {
  const payer = (env.BURNTICKER_UPLOAD_PAYER ?? "").trim();
  return payer ? new IrysUploader({ cluster, payer, rpcUrl: (env.BURNTICKER_RPC_URL ?? "").trim() || null }) : null;
}
export const allowHostedMetadata = (env: Readonly<Record<string, string | undefined>> = process.env): boolean => /^(1|true|on|yes)$/i.test((env.BURNTICKER_ALLOW_HOSTED_METADATA ?? "").trim());
/**
 * A creator's own image (website-15 item 13, owner decision 2026-10-12): ON by default. BURNTICKER_CUSTOM_IMAGES_ENABLED=0 (or false, off,
 * no) turns it off on a host; anything else, or nothing, leaves it on.
 */
export const customImagesEnabled = (env: Readonly<Record<string, string | undefined>> = process.env): boolean => !/^(0|false|off|no)$/i.test((env.BURNTICKER_CUSTOM_IMAGES_ENABLED ?? "").trim());

export interface PinInput {
  ticker: string; name: string;
  /** The token metadata description: the window badge line + the generated paragraph + the rule footer (handlers.metadataDescription). */
  description: string;
  oneLiner: string; rule: BurnRule; rulesSha256: string; origin: string;
  links: { label: string; url: string }[];
  /** A custom image by URL (API only): pinned by URL as given instead of the receipt art. */
  imageUrl?: string | null;
  /** website-15 item 13: the creator's uploaded image, already checked (creatorProfile.ts decodeCreatorImage); uploaded as given. */
  image?: { bytes: Uint8Array; contentType: string; /** the creator's receipt-mark choice, recorded in the metadata's attributes */ badge?: boolean } | null;
}

/** The metadata JSON (Metaplex token standard + `extensions`), byte-stable for the same inputs. */
export function metadataJson(i: PinInput, imageUri: string, imageType = "image/png"): string {
  const ext: Record<string, string> = {};
  for (const l of i.links) { const k = /^x$/i.test(l.label) ? "twitter" : l.label.toLowerCase(); if (["website", "twitter", "telegram"].includes(k)) ext[k] = l.url; }
  return JSON.stringify({
    name: i.name, symbol: i.ticker, description: i.description, image: imageUri, external_url: `${i.origin.replace(/\/$/, "")}/burnticker/t/${i.ticker}`,
    attributes: [{ trait_type: "rules sha256", value: i.rulesSha256 }, ...(i.image && typeof i.image.badge === "boolean" ? [{ trait_type: "Burnticker receipt mark", value: i.image.badge ? "on" : "off" }] : [])],
    properties: { category: "image", files: [{ uri: imageUri, type: imageType }] },
    ...(Object.keys(ext).length ? { extensions: ext } : {}),
  });
}

/** Renders the receipt art (PNG through sharp), uploads it, then uploads the metadata JSON naming it. Throws on any failure. */
export async function pinCoin(uploader: PinUploader, i: PinInput): Promise<PinnedCoin> {
  const tags = [{ name: "App-Name", value: "Burnticker" }, { name: "Ticker", value: i.ticker }, { name: "Rules-Sha256", value: i.rulesSha256 }];
  let imageUri: string, imageTx: string, imageSha256: string;
  let imageType = "image/png";
  if (i.image) {
    const up = await uploader.upload(i.image.bytes, i.image.contentType, tags);
    imageUri = up.url; imageTx = up.id; imageSha256 = sha256Hex(i.image.bytes); imageType = i.image.contentType;
  } else if (i.imageUrl) { imageUri = i.imageUrl; imageTx = ""; imageSha256 = ""; }
  else {
    const svg = renderCoinSvg({ ticker: i.ticker, oneLiner: i.oneLiner, rule: i.rule, sha256: i.rulesSha256 });
    const sharp = (await import("sharp")).default;
    const png = new Uint8Array(await sharp(Buffer.from(svg)).png().toBuffer());
    const up = await uploader.upload(png, "image/png", tags);
    imageUri = up.url; imageTx = up.id; imageSha256 = sha256Hex(png);
  }
  const json = metadataJson(i, imageUri, imageType);
  const up = await uploader.upload(new TextEncoder().encode(json), "application/json", tags);
  return { metadataUri: up.url, metadataTx: up.id, metadataSha256: sha256Hex(json), metadataJson: json, imageUri, imageTx, imageSha256, hosted: false };
}

/** A content-addressed fake for tests and for local previews: ids are the sha256 of the bytes; `fail` makes every upload throw. */
export class FakePinUploader implements PinUploader {
  readonly name = "fake";
  uploads: { id: string; contentType: string; bytes: Uint8Array }[] = [];
  private o: { fail?: boolean };
  constructor(o: { fail?: boolean } = {}) { this.o = o; }
  async upload(body: Uint8Array, contentType: string): Promise<{ id: string; url: string }> {
    if (this.o.fail) throw new Error("fake Irys: upload refused");
    const id = sha256Hex(body).slice(0, 43);
    this.uploads.push({ id, contentType, bytes: body });
    return { id, url: `https://arweave.net/${id}` };
  }
  get(id: string): Uint8Array | null { return this.uploads.find((u) => u.id === id)?.bytes ?? null; }
}
