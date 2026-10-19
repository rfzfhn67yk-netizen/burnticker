#!/usr/bin/env node
// Pin a coin's image and metadata JSON on Arweave (Irys) BEFORE a CLI launch (scripts/burnkeeper-launch.mts launch --uri <url>).
// The web launcher pins inside the request (src/lib/burnticker/api/handlers.ts); CLI launches — $REHEARSAL, $DEFICIT — had no way to
// pin, so this wraps src/lib/burnticker/pin.ts for a keeper rules file (config/burnkeeper/*.rules.json).
//
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/alias-hook.mjs scripts/burnticker-pin.mts \
//     --cluster mainnet --rules config/burnkeeper/rehearsal.rules.json --name REHEARSAL --image site/burnticker/brand/avatar.png \
//     [--website https://burnticker.com] [--twitter https://x.com/BurnTicker] [--origin https://burnticker.com] [--dry-run]
//
// Signs uploads with BURNTICKER_UPLOAD_PAYER from the environment (the host's upload wallet; never printed). --dry-run prints the
// metadata JSON it would upload and the image's sha256 and exits 0 without touching Irys. Output: one JSON document on stdout
// (metadataUri, metadataTx, metadataSha256, imageUri, imageTx, imageSha256, rulesSha256, mint) — keep it with the launch record.
import fs from "node:fs";
import { loadRules } from "@/lib/burnKeeper/rules";
import { metadataJson, sha256Hex, uploaderFromEnv, type PinInput, type PinUploader } from "@/lib/burnticker/pin";
import type { BurnRule } from "@/lib/burnticker/rules";

const args = process.argv.slice(2);
const opt = (n: string): string | undefined => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : undefined; };
const flag = (n: string) => args.includes(`--${n}`);
const die = (m: string): never => { console.error(m); process.exit(1); };

const cluster = (opt("cluster") ?? die("--cluster devnet|mainnet")) as "devnet" | "mainnet";
if (!["devnet", "mainnet"].includes(cluster)) die("--cluster devnet|mainnet");
const rulesFile = opt("rules") ?? die("--rules <config/burnkeeper/*.rules.json>");
const loaded = loadRules(rulesFile);
const r = loaded.rules;
if (!r.mint) die(`${rulesFile} has no "mint": write the mint in first (REHEARSAL-RUNSHEET B10)`);
const ticker = r.ticker;
const name = opt("name") ?? r.token;
const imagePath = opt("image") ?? die("--image <png path> (the coin art to pin; site/burnticker/brand/avatar.png for the rehearsal)");
const png = new Uint8Array(fs.readFileSync(imagePath));
if (!(png[0] === 0x89 && png[1] === 0x50)) die(`${imagePath} is not a PNG`);
const origin = opt("origin") ?? "https://burnticker.com";
const links: { label: string; url: string }[] = [];
if (opt("website")) links.push({ label: "website", url: opt("website")! });
if (opt("twitter")) links.push({ label: "x", url: opt("twitter")! });
// The dial line names the mode's real dial: buyback mode spends a fraction of the burn pool per unit (the legacy burnPerUnitTokens
// field is not what a buyback coin does; $REHEARSAL's immutable metadata carries the old wording, 2026-10-12).
const fraction = r.mode === "buyback" && r.buyback?.fractionPerUnit ? Number(r.buyback.fractionPerUnit) : null;
const dialLine = fraction !== null ? `${(fraction * 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}% of the burn pool per unit`
  : r.rule?.burnPerUnitTokens ? `${r.rule.burnPerUnitTokens} tokens per unit` : "see the rules file";
const description = `${r.statement}\n\nRule: ${dialLine}; rules sha256 ${loaded.sha256}. Memecoin: the rule says what supply does, not what price does. Not advice.`;
// pinCoin's `rule` only feeds the generated art; we pin our own PNG, so the BurnRule is not consulted (metadataJson does not read it).
const input: PinInput = { ticker, mint: r.mint, name, description, oneLiner: r.statement.slice(0, 140), rule: {} as BurnRule, rulesSha256: loaded.sha256, origin, links, imageUrl: null };

const tags = [{ name: "App-Name", value: "Burnticker" }, { name: "Ticker", value: ticker }, { name: "Rules-Sha256", value: loaded.sha256 }];
async function pin(uploader: PinUploader) {
  const img = await uploader.upload(png, "image/png", tags);
  const json = metadataJson(input, img.url);
  const meta = await uploader.upload(new TextEncoder().encode(json), "application/json", tags);
  return { metadataUri: meta.url, metadataTx: meta.id, metadataSha256: sha256Hex(json), imageUri: img.url, imageTx: img.id, imageSha256: sha256Hex(png), metadataJson: json };
}

if (flag("dry-run")) {
  const json = metadataJson(input, "https://arweave.net/<image-tx>");
  console.log(JSON.stringify({ dryRun: true, cluster, mint: r.mint, ticker, name, rulesSha256: loaded.sha256, imageBytes: png.length, imageSha256: sha256Hex(png), metadataJson: JSON.parse(json) }, null, 2));
  process.exit(0);
}
// literal specifiers so the public-tree publisher declares the Irys client (pin.ts loads it through variables to keep it out of the Next bundle)
await import("@irys/upload").catch(() => die("the Irys client (@irys/upload) is not installed on this host: npm ci"));
await import("@irys/upload-solana").catch(() => die("the Irys client (@irys/upload-solana) is not installed on this host: npm ci"));
const uploader = uploaderFromEnv(process.env, cluster) ?? die("BURNTICKER_UPLOAD_PAYER is not set in this environment (the host's upload wallet)");
pin(uploader).then((out) => { console.log(JSON.stringify({ cluster, mint: r.mint, ticker, name, rulesSha256: loaded.sha256, ...out, metadataJson: JSON.parse(out.metadataJson) }, null, 2)); }).catch((e) => die(`pin failed: ${(e as Error).message}`));
