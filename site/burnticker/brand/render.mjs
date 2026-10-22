// Publishes the CHOSEN brand renders into the two sites. The identities are B1 "Thermal receipt" for Burnticker and
// D1 "Debt clock" for $DEFICIT (owner picks, 2026-10-09/10). Their source is the concept HTML under site/brand-concepts/,
// rendered by headless Chrome with real web fonts:
//
//   node site/brand-concepts/render.mjs b1 d1     # 1. re-render the concept PNGs (after editing the concept HTML)
//   node site/burnticker/brand/render.mjs         # 2. copy them into the sites and derive the favicons
//
// Writes:
//   site/burnticker/brand/{avatar,header,og}.png  ← brand-concepts/b1-thermal-receipt/   (800×800, 1500×500, 1200×630)
//   site/burnticker/brand/favicon.png, site/burnticker/favicon.png   64×64 from the B1 avatar
//   site/deficit/{avatar,header,og}.png           ← brand-concepts/d1-debt-clock/
//   site/deficit/favicon.png                      64×64 from the D1 avatar
//   site/burnticker/deficit-avatar.png            ← brand-concepts/d1-debt-clock/avatar-400.png (the $DEFICIT card on Burnticker)
//
// It no longer rasterises the old flame / "DeFi-cit" SVGs (site/burnticker/brand/*.svg, site/deficit/*.svg): those are the
// retired 10-09 brand kit, kept for reference only. Rendering them would overwrite the chosen identities.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = path.dirname(fileURLToPath(import.meta.url));
const site = path.resolve(here, "..", "..");
const B1 = "brand-concepts/b1-thermal-receipt";
const D1 = "brand-concepts/d1-debt-clock";

const copies = [
  { src: `${B1}/avatar.png`, out: "burnticker/brand/avatar.png" },
  { src: `${B1}/header.png`, out: "burnticker/brand/header.png" },
  { src: `${B1}/og.png`, out: "burnticker/brand/og.png" },
  { src: `${D1}/avatar.png`, out: "deficit/avatar.png" },
  { src: `${D1}/header.png`, out: "deficit/header.png" },
  { src: `${D1}/og.png`, out: "deficit/og.png" },
  { src: `${D1}/avatar-400.png`, out: "burnticker/deficit-avatar.png" },
];
const favicons = [
  { src: `${B1}/avatar.png`, out: "burnticker/brand/favicon.png" },
  { src: `${B1}/avatar.png`, out: "burnticker/favicon.png" },
  { src: `${D1}/avatar.png`, out: "deficit/favicon.png" },
];
const FAVICON = 64;

const size = (f) => `${(fs.statSync(f).size / 1024).toFixed(1)} KB`;
for (const j of [...copies, ...favicons]) {
  if (!fs.existsSync(path.join(site, j.src))) { console.error(`missing ${j.src} — run node site/brand-concepts/render.mjs first`); process.exit(1); }
}
for (const j of copies) {
  const src = path.join(site, j.src), out = path.join(site, j.out);
  fs.copyFileSync(src, out);
  console.log(`${j.out}  ← ${j.src}  ${size(out)}`);
}
for (const j of favicons) {
  const src = path.join(site, j.src), out = path.join(site, j.out);
  await sharp(src).resize(FAVICON, FAVICON, { kernel: "lanczos3" }).png().toFile(out);
  console.log(`${j.out}  ${FAVICON}×${FAVICON} from ${j.src}  ${size(out)}`);
}
