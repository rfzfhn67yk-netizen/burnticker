import crypto from "node:crypto"; import { safeCreatorLink } from "@/lib/burnticker/creatorProfile";
import type { BurnRule } from "@/lib/burnticker/rules";
import { renderCoinSvg } from "@/lib/burnticker/coinArt";
import { takeOrThrow } from "@/lib/burnticker/apiBudget";


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
  /** HB-82: the prefunded upload balance and the price of `bytes` (Irys; a test double may leave it out). */
  balance?(bytes: number): Promise<UploadBalance>;
}
/** HB-82: an uploader's balance read, in lamports. */
export interface UploadBalance { address: string; balanceLamports: bigint; priceLamports: bigint }
type IrysClient = { address?: string; upload(data: Buffer, o: { tags: { name: string; value: string }[] }): Promise<{ id: string }>; getBalance(): Promise<{ toString(): string }>; getPrice(bytes: number): Promise<{ toString(): string }> };
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
  /** HB-82 (hourly run 6): the payer's prefunded Irys balance and the price of `bytes`, two reads inside the "irys" budget (the same reads scripts/ops/irys-fund.mts makes). */
  async balance(bytes: number): Promise<UploadBalance> {
    const client = await this.client();
    await takeOrThrow("irys", { units: 2, requests: 2 });
    const big = (v: { toString(): string }): bigint => BigInt(v.toString().split(".")[0]);
    const [b, p] = await withUploadTimeout(Promise.all([client.getBalance(), client.getPrice(bytes)]), UPLOAD_TIMEOUT_MS);
    return { address: String(client.address ?? ""), balanceLamports: big(b), priceLamports: big(p) };
  }
  async upload(body: Uint8Array, contentType: string, tags: { name: string; value: string }[]): Promise<{ id: string; url: string }> {
    const client = await this.client();
    await takeOrThrow("irys");   // the request budget (apiBudget.ts): a spent day refuses the upload (the launch is refused, as for any upload failure)
    const r = await withUploadTimeout(client.upload(Buffer.from(body), { tags: [{ name: "Content-Type", value: contentType }, ...tags] }), UPLOAD_TIMEOUT_MS);
    // 2026-10-13: Irys bundles free uploads to Arweave on its own schedule (the 10-12 $DEFICIT pin was still unseeded a day later, so
    // arweave.net answered 404 while gateway.irys.xyz served it). The gateway URL is the same id, served at once and from Arweave once
    // seeded, and it is one of the three forms launchGate's PINNED_URI_RE accepts.
    return { id: r.id, url: this.o.cluster === "mainnet" ? `https://gateway.irys.xyz/${r.id}` : `https://devnet.irys.xyz/${r.id}` };
  }
  private async client(): Promise<IrysClient> {
    if (!this.o.payer) throw new Error("BURNTICKER_UPLOAD_PAYER (the ops wallet that pays Irys) is not set");
    type IrysChain = { withWallet(k: string): IrysChain; withRpc(u: string): IrysChain; devnet(): IrysChain; then: Promise<IrysClient>["then"] };
    let Uploader: (c: unknown) => IrysChain, Solana: unknown;
    try {
      const pkgA = "@irys/upload", pkgB = "@irys/upload-solana";
      ({ Uploader } = (await import(/* webpackIgnore: true */ pkgA)) as { Uploader: (c: unknown) => IrysChain });
      ({ Solana } = (await import(/* webpackIgnore: true */ pkgB)) as { Solana: unknown });
    } catch { throw new Error("the Irys client (@irys/upload, @irys/upload-solana) is not installed on this host"); }
    // the SDK's own HTTP timeout (its 20 s default) cancels a slow request; withUploadTimeout (UPLOAD_TIMEOUT_MS, 30 s) is the backstop above it
    let chain = Uploader(Solana).withWallet(this.o.payer);
    if (this.o.cluster !== "mainnet") chain = chain.withRpc(this.o.rpcUrl ?? "https://api.devnet.solana.com").devnet();
    return await chain;
  }
}

/**
 * Audit 2026-10-15 M2: one Irys upload may take at most this long. A hung upload used to hold the launch request until the edge gave up
 * (90 to 100 s), and the page's retry then prepared a second draft. Past it the launch is refused like any failed upload.
 */
export const UPLOAD_TIMEOUT_MS = 30_000;
/**
 * Prelaunch audit 2026-10-18 F08: an upload that ran out of time may still have completed (and been paid for) on the other side, so it
 * is told apart from a plain refusal: the launch handler counts it against the caps and as an unknown file.
 */
export class UploadTimeoutError extends Error {
  readonly uncertain = true as const;
  constructor(message: string) { super(message); this.name = "UploadTimeoutError"; }
}
/** Whether an upload error leaves it unknown whether the file was saved (a timeout, ours or the client's own). */
export const uploadMayHaveCompleted = (e: unknown): boolean => e instanceof UploadTimeoutError || /did not finish within|timed? ?out|ETIMEDOUT|ECONNRESET|socket hang up/i.test(e instanceof Error ? e.message : String(e));
export function withUploadTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, rej) => { t = setTimeout(() => rej(new UploadTimeoutError(`the Arweave upload did not finish within ${Math.round(ms / 1000)} seconds`)), ms); });
  return Promise.race([p, timeout]).finally(() => clearTimeout(t));
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
  /** The coin's mint: when given, external_url is the mint page, the address that stays the coin's own even if another coin later shares the ticker (owner 2026-10-12). */
  mint?: string | null;
  /** The token metadata description: the window badge line + the generated paragraph + the rule footer (handlers.metadataDescription). */
  description: string;
  oneLiner: string; rule: BurnRule; rulesSha256: string; origin: string;
  links: { label: string; url: string }[];
  /** website-15 item 13: the creator's uploaded image, already checked (creatorProfile.ts decodeCreatorImage); uploaded as given. */
  image?: { bytes: Uint8Array; contentType: string; /** the creator's receipt-mark choice, recorded in the metadata's attributes */ badge?: boolean } | null;
}

/** The metadata JSON (Metaplex token standard + `extensions`), byte-stable for the same inputs. */
export function metadataJson(i: PinInput, imageUri: string, imageType = "image/png"): string {
  const ext: Record<string, string> = {};
  // audit 7 item 3: only a link that passes its field's check reaches the metadata JSON
  for (const l of i.links.filter(safeCreatorLink)) { const k = /^x$/i.test(l.label) ? "twitter" : l.label.toLowerCase(); if (["website", "twitter", "telegram"].includes(k)) ext[k] = l.url; }
  return JSON.stringify({
    name: i.name, symbol: i.ticker, description: i.description, image: imageUri, external_url: `${i.origin.replace(/\/$/, "")}/burnticker/t/${encodeURIComponent(i.mint ?? i.ticker)}`,
    attributes: [{ trait_type: "rules sha256", value: i.rulesSha256 }, ...(i.image && typeof i.image.badge === "boolean" ? [{ trait_type: "Burnticker receipt mark", value: i.image.badge ? "on" : "off" }] : [])],
    properties: { category: "image", files: [{ uri: imageUri, type: imageType }] },
    ...(Object.keys(ext).length ? { extensions: ext } : {}),
  });
}

/**
 * Prelaunch audit 2026-10-18 F09: what pinCoin takes. The mint is REQUIRED: the metadata is immutable once the coin exists, and a link
 * by ticker (the old fallback) can open another coin with the same ticker, or the chooser. The launch handler picks the mint first.
 */
export type PinCoinInput = PinInput & { mint: string };

/**
 * Prelaunch audit 2026-10-18 F08: what the caller learns about each paid upload as it happens, so a later failure (the image saved, the
 * metadata not) never leaves a paid file unaccounted for. `recall` answers a file already saved with these exact bytes (it is reused, not
 * uploaded again); `uploaded` hears of each file the moment it is saved; `failed` hears of each upload that threw.
 */
export interface PinHooks {
  recall?(sha256: string, contentType: string): { id: string; url: string } | null;
  uploaded?(kind: "image" | "metadata", up: { id: string; url: string }, sha256: string, contentType: string): void;
  failed?(kind: "image" | "metadata", error: unknown): void;
}

/** Renders the receipt art (PNG through sharp), uploads it, then uploads the metadata JSON naming it. Throws on any failure. */
export async function pinCoin(uploader: PinUploader, i: PinCoinInput, hooks: PinHooks = {}): Promise<PinnedCoin> {
  if (!i.mint || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(i.mint)) throw new Error("the coin's mint must be chosen before its details are saved");
  const tags = [{ name: "App-Name", value: "Burnticker" }, { name: "Ticker", value: i.ticker }, { name: "Rules-Sha256", value: i.rulesSha256 }];
  const put = async (kind: "image" | "metadata", bytes: Uint8Array, contentType: string): Promise<{ id: string; url: string }> => {
    const sha = sha256Hex(bytes);
    const known = hooks.recall?.(sha, contentType) ?? null;
    if (known) return known;
    let up: { id: string; url: string };
    try { up = await uploader.upload(bytes, contentType, tags); }
    catch (e) { hooks.failed?.(kind, e); throw e; }
    hooks.uploaded?.(kind, up, sha, contentType);
    return up;
  };
  let imageUri: string, imageTx: string, imageSha256: string;
  let imageType = "image/png";
  if (i.image) {
    const up = await put("image", i.image.bytes, i.image.contentType);
    imageUri = up.url; imageTx = up.id; imageSha256 = sha256Hex(i.image.bytes); imageType = i.image.contentType;
  } else {   // no image by web address (owner decision 2026-10-19, imagePin.ts IMAGE_URL_REFUSED): uploaded bytes or the receipt art
    const svg = renderCoinSvg({ ticker: i.ticker, oneLiner: i.oneLiner, rule: i.rule, sha256: i.rulesSha256 });
    const sharp = (await import("sharp")).default;
    const png = new Uint8Array(await sharp(Buffer.from(svg)).png().toBuffer());
    const up = await put("image", png, "image/png");
    imageUri = up.url; imageTx = up.id; imageSha256 = sha256Hex(png);
  }
  const json = metadataJson(i, imageUri, imageType);
  const up = await put("metadata", new TextEncoder().encode(json), "application/json");
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
