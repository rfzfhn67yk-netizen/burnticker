// Brand concept renderer. Each direction is a folder of standalone HTML files (real web fonts from Google Fonts,
// so a network connection is needed the first time Chrome fetches them). Headless Chrome screenshots each file at
// its exact pixel size; sharp then makes the 48 px timeline check and a 400 px preview of every avatar.
//
//   node site/brand-concepts/render.mjs            # everything
//   node site/brand-concepts/render.mjs b1 d2      # only some directions (prefix match on the folder name)
//
// Outputs, per direction folder:  avatar.png 800×800 · avatar-48.png · avatar-400.png · header.png 1500×500 · og.png 1200×630
// Then it rewrites index.html — the contact sheet — from the folders' rationale.md files.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = path.dirname(fileURLToPath(import.meta.url));
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const SIZES = { avatar: [800, 800], header: [1500, 500], og: [1200, 630] };

const DIRECTIONS = [
  "b1-thermal-receipt",
  "b2-split-flap",
  "b3-wire-service",
  "b4-ledger-engraving",
  "d1-debt-clock",
  "d2-treasury-statement",
];
const META = {
  "b1-thermal-receipt":    { code: "B1", brand: "Burnticker", name: "Thermal receipt",      type: "Courier Prime",                              palette: ["#f2eee4", "#1b1916", "#5b3fa3", "#1f1c19"] },
  "b2-split-flap":         { code: "B2", brand: "Burnticker", name: "Split-flap board",     type: "Oswald + Barlow Condensed",                  palette: ["#131312", "#2c2c2b", "#ece8dc", "#f2a60f"] },
  "b3-wire-service":       { code: "B3", brand: "Burnticker", name: "Wire service",         type: "Archivo Black + Courier Prime",              palette: ["#e8e7e1", "#141414", "#d9301c"] },
  "b4-ledger-engraving":   { code: "B4", brand: "Burnticker", name: "Ledger / engraving",   type: "Playfair Display SC + Playfair Display",     palette: ["#e9e9df", "#15302a", "#b8923f"] },
  "d1-debt-clock":         { code: "D1", brand: "$DEFICIT",   name: "Debt clock",           type: "Oswald + seven-segment (built)",             palette: ["#0a0a0a", "#ff3b2e", "#ffb000", "#f1eee6"] },
  "d2-treasury-statement": { code: "D2", brand: "$DEFICIT",   name: "Treasury statement",   type: "IBM Plex Mono + IBM Plex Sans Condensed",    palette: ["#f7f7f3", "#161616", "#c8102e", "#2a2a29"] },
};

const only = process.argv.slice(2);
const chosen = DIRECTIONS.filter((d) => only.length === 0 || only.some((o) => d.startsWith(o)));

function shoot(html, png, [w, h]) {
  execFileSync(
    CHROME,
    [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
      `--window-size=${w},${h}`,
      "--virtual-time-budget=8000",
      `--screenshot=${png}`,
      `file://${html}`,
    ],
    { stdio: ["ignore", "ignore", "ignore"] } // CVDisplayLink noise on stderr is harmless
  );
}

for (const dir of chosen) {
  const folder = path.join(here, dir);
  for (const [name, size] of Object.entries(SIZES)) {
    const html = path.join(folder, `${name}.html`);
    if (!fs.existsSync(html)) { console.error(`missing ${html}`); process.exitCode = 1; continue; }
    const png = path.join(folder, `${name}.png`);
    shoot(html, png, size);
    const meta = await sharp(png).metadata();
    if (meta.width !== size[0] || meta.height !== size[1]) {
      console.error(`${dir}/${name}.png is ${meta.width}×${meta.height}, wanted ${size.join("×")}`);
      process.exitCode = 1;
    }
    console.log(`${dir}/${name}.png  ${meta.width}×${meta.height}`);
  }
  const avatar = path.join(folder, "avatar.png");
  if (fs.existsSync(avatar)) {
    await sharp(avatar).resize(48, 48, { kernel: "lanczos3" }).png().toFile(path.join(folder, "avatar-48.png"));
    await sharp(avatar).resize(400, 400, { kernel: "lanczos3" }).png().toFile(path.join(folder, "avatar-400.png"));
    console.log(`${dir}/avatar-48.png  48×48   ${dir}/avatar-400.png  400×400`);
  }
}

// ---------- contact sheet ----------
const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
function rationale(dir) {
  const f = path.join(here, dir, "rationale.md");
  if (!fs.existsSync(f)) return "";
  return fs.readFileSync(f, "utf8").split("\n").filter((l) => l.trim() && !l.startsWith("#")).join(" ");
}
const cards = DIRECTIONS.map((dir) => {
  const m = META[dir];
  const sw = m.palette.map((c) => `<i style="background:${c}" title="${c}"></i>`).join("");
  const handle = m.brand === "Burnticker" ? "@burnticker" : "@USA_DEFICIT";
  return `
  <section class="dir" id="${dir}">
    <header>
      <span class="code">${m.code}</span>
      <h2>${esc(m.brand)} — ${esc(m.name)}</h2>
      <span class="type">${esc(m.type)}</span>
      <span class="sw">${sw}</span>
      <a class="folder" href="${dir}/">${dir}/</a>
    </header>
    <div class="row">
      <div class="col small">
        <div class="lbl">Avatar at 48 px, as X shows it</div>
        <div class="tl light"><img src="${dir}/avatar-48.png" width="48" height="48" alt=""><div><b>${esc(m.brand)}</b><span>${handle} · 2h</span></div></div>
        <div class="tl dark"><img src="${dir}/avatar-48.png" width="48" height="48" alt=""><div><b>${esc(m.brand)}</b><span>${handle} · 2h</span></div></div>
        <div class="lbl">Avatar 800 (shown 320, circle = X crop)</div>
        <div class="av"><img src="${dir}/avatar-400.png" width="320" height="320" alt=""></div>
      </div>
      <div class="col big">
        <div class="lbl">Header 1500×500 (shown 600×200) — guides: avatar overlay zone (left) and mobile bottom crop</div>
        <div class="hd"><img src="${dir}/header.png" width="600" height="200" alt=""><div class="g gl"></div><div class="g gb"></div><div class="g gav"></div></div>
        <div class="lbl">OG card 1200×630 (shown 480×252)</div>
        <img class="og" src="${dir}/og.png" width="480" height="252" alt="">
      </div>
      <div class="col text">
        <div class="lbl">Rationale</div>
        <p>${esc(rationale(dir))}</p>
        <div class="files">avatar.png · header.png · og.png · avatar-48.png — sources: avatar.html · header.html · og.html</div>
      </div>
    </div>
  </section>`;
}).join("\n");

const index = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Brand concepts — Burnticker and $DEFICIT</title>
<style>
  :root{--bg:#1b1b1a;--panel:#232322;--ink:#e8e6df;--mute:#9a978e;--line:#34332f;--acc:#f2a60f}
  html,body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,"Helvetica Neue",Helvetica,Arial,sans-serif}
  .wrap{max-width:1520px;margin:0 auto;padding:28px 24px 80px}
  h1{font-size:22px;font-weight:600;margin:0 0 4px;letter-spacing:.2px}
  .sub{color:var(--mute);margin:0 0 18px;max-width:900px}
  .tools{display:flex;gap:18px;align-items:center;color:var(--mute);margin-bottom:22px;font-size:14px}
  .tools label{display:flex;gap:6px;align-items:center;cursor:pointer}
  nav{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:6px}
  nav a{color:var(--ink);text-decoration:none;border:1px solid var(--line);padding:4px 10px;font-size:13px}
  nav a:hover{border-color:var(--acc)}
  .dir{border-top:1px solid var(--line);padding:22px 0 10px}
  .dir header{display:flex;align-items:baseline;gap:14px;flex-wrap:wrap;margin-bottom:14px}
  .code{font-weight:700;color:var(--acc);font-size:13px;letter-spacing:2px}
  h2{font-size:19px;font-weight:600;margin:0}
  .type{color:var(--mute);font-size:13px}
  .sw i{display:inline-block;width:14px;height:14px;margin-right:3px;vertical-align:middle;border:1px solid rgba(255,255,255,.12)}
  .folder{margin-left:auto;color:var(--mute);font-size:12px;text-decoration:none}
  .row{display:grid;grid-template-columns:320px 600px 1fr;gap:28px;align-items:start}
  .lbl{font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:var(--mute);margin:0 0 6px}
  .col > .lbl + * {margin-bottom:16px}
  .tl{display:flex;gap:10px;align-items:center;padding:10px 12px;width:296px;box-sizing:border-box}
  .tl.light{background:#fff;color:#0f1419;border-radius:0}
  .tl.dark{background:#000;color:#e7e9ea;margin-top:2px}
  .tl img{border-radius:50%;display:block}
  .tl b{display:block;font-size:15px;line-height:1.2}
  .tl span{font-size:14px;opacity:.6}
  .av{position:relative;width:320px;height:320px;overflow:hidden}
  .av:after{content:"";position:absolute;inset:0;border-radius:50%;box-shadow:0 0 0 2000px rgba(27,27,26,.55);pointer-events:none;opacity:0;transition:opacity .15s}
  body.guides .av:after{opacity:1}
  .av img{display:block}
  .hd{position:relative;width:600px;height:200px}
  .hd img{display:block}
  .g{position:absolute;pointer-events:none;opacity:0;transition:opacity .15s}
  body.guides .g{opacity:1}
  .gl{left:0;top:0;width:25%;height:100%;background:rgba(255,80,60,.14);border-right:1px dashed rgba(255,120,100,.8)}
  .gb{left:0;bottom:0;width:100%;height:15%;background:rgba(255,80,60,.14);border-top:1px dashed rgba(255,120,100,.8)}
  .gav{left:16px;bottom:-26px;width:54px;height:54px;border-radius:50%;background:rgba(0,0,0,.65);border:2px solid #fff}
  .og{display:block}
  .text p{margin:0 0 10px;color:#d6d3ca;font-size:14px;line-height:1.55}
  .files{color:var(--mute);font-size:12px}
  @media (max-width:1300px){.row{grid-template-columns:320px 600px}.text{grid-column:1 / -1}}
  @media (max-width:980px){.row{grid-template-columns:1fr}.hd,.hd img{width:100%;height:auto}.hd{height:auto}.og{width:100%;height:auto}}
</style></head>
<body>
<div class="wrap">
  <h1>Brand concepts — four for Burnticker, two for $DEFICIT</h1>
  <p class="sub">Each direction is rendered from standalone HTML with real web fonts. Everything on this page is shown at the same scale (0.4×) so proportions compare truly; the 48 px timeline rows are 1:1. Regenerate with <code>node site/brand-concepts/render.mjs</code>.</p>
  <div class="tools"><label><input type="checkbox" id="guides"> show X overlay guides (avatar circle crop, header left 25% / bottom 15%)</label></div>
  <nav>${DIRECTIONS.map((d) => `<a href="#${d}">${META[d].code} ${esc(META[d].name)}</a>`).join("")}</nav>
  ${cards}
</div>
<script>
  const cb=document.getElementById('guides');const apply=()=>document.body.classList.toggle('guides',cb.checked);
  try{const v=localStorage.getItem('bc-guides');if(v!==null)cb.checked=v==='1'}catch(e){}
  cb.addEventListener('change',()=>{apply();try{localStorage.setItem('bc-guides',cb.checked?'1':'0')}catch(e){}});apply();
</script>
</body></html>
`;
fs.writeFileSync(path.join(here, "index.html"), index);
console.log("index.html written");
