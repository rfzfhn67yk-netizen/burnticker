# site/deficit — the $DEFICIT landing page

A single static page (`index.html`, no framework, no build) plus its brand assets. It **reads the burn keeper's own published
files** and never recomputes the rule itself:

| The keeper writes (into `BURNKEEPER_PUBLISH_DIR`, default `data/burnkeeper-site/`) | This folder expects it at | Used for |
|---|---|---|
| `status.json` (schema `burnkeeper.status/v1`, from `src/lib/burnKeeper/statusPage.ts`) | `./status.json` beside `index.html` | the live strip, the rule hash and statement, addresses, health, the countdown |
| `burns.json` (one `BurnJson` per burn day) | `./burns.json` | the receipts table, the verify blocks, the chart's points and burn markers |
| `rules.json` (the rule file's exact bytes) | `./rules.json` | linked from the page; its sha256 is the one in every memo |
| `index.html` (the keeper's plain status page) | not used — this page replaces it | keep it as `status.html` if you want the plain view too |

Everything degrades gracefully: with no `status.json` the page still renders the rule, the verify instructions and the disclaimer,
and says the keeper has not published yet. With `burns.json` but no network it draws the debt curve from the readings inside the
receipts; online it densifies the curve from the Treasury API directly (fail-soft, 7 s timeout).

## Preview locally

    cd site/deficit && python3 -m http.server 8788
    # open http://localhost:8788/?data=sample/      ← the committed replay sample (235 burn days, no transactions)
    # open http://localhost:8788/                   ← reads ./status.json (absent until the keeper has published)

`sample/` holds `status.json` + `burns.json` built by `sample/make-sample.mjs` from the frozen Treasury fixture (the same series as
docs/burnkeeper/replay-2025-2026.md: 235 burn days, 6,490 units, biggest day 2025-07-07 +$366B). It is marked as a sample in the
file and on the page. Rebuild it with `node site/deficit/sample/make-sample.mjs`. Do not deploy `sample/`.

## Deploy to a static host

The publish directory and this folder are merged into one directory on the host; the keeper's files win on name clashes
(there are none except `index.html`, which must be ours). One line, run on the VPS where the keeper runs:

    rsync -az --delete --exclude 'sample/' --exclude 'README.md' /opt/mct/meme-coin-trader/site/deficit/ user@static-host:/var/www/deficit/ && rsync -az --exclude 'index.html' /opt/mct/meme-coin-trader/data/burnkeeper-site/ user@static-host:/var/www/deficit/

Or point the keeper straight at the web root and copy the page in once:

    BURNKEEPER_PUBLISH_DIR=/var/www/deficit   # in the keeper's env; it rewrites status.json/burns.json/rules.json every cycle
    scp -r site/deficit/{index.html,avatar.png,header.png,favicon.png} user@static-host:/var/www/deficit/

(The keeper also writes its own `index.html` into the publish dir each cycle; with the second layout, set the keeper's publish
dir to a subfolder such as `/var/www/deficit/data/` and preview the page with `?data=data/` — or just use the first layout.)

Cloudflare Pages / GitHub Pages / Netlify: upload the merged directory; no build step, no server, no environment variables.

## What the owner fills in at launch

- `LINKS.trade` in `index.html` (top of the script) — the LaunchLab curve / pool URL. Until it is set, the Trade buttons point at
  the footer note.
- The Burnticker URL (`https://burnticker.com/` placeholder, two places in `index.html`) once the domain is chosen.
- The mint, keeper and fee-pool addresses come from `status.json` automatically once the keeper is bound to the mainnet mint.
- `og:image` / Twitter card use `header.png` relative to the page; set an absolute URL if the page is served from a sub-path.

## Identity

The page uses brand direction **D1 "Debt clock"** (`site/brand-concepts/d1-debt-clock/`, picked by the owner 2026-10-10): a black
LED board in a dark housing with corner bolts, the `$DEFICIT` marquee and section type in Oswald (Google Fonts, 500/600/700), the
strap BURNS WHEN AMERICA BORROWS, and seven-segment digits built from CSS boxes (the concept's `seg.css`/`seg.js`, inlined and scoped
under `.seg7`). Red is what the U.S. borrowed, amber is what was burned. The segment digits carry only the two hero figures: the latest
burn day's debt delta (`$1b`, the unit, until a receipt exists) and the total bought and burned; every other number and all body copy
stay in a legible sans / mono. Dark-first; under `prefers-color-scheme: light` the same board is shown **unlit** (enamel housing, pale
face, segments printed in matte ink, no glow) rather than inverted.

`avatar.png`, `header.png`, `og.png` and `favicon.png` are the D1 renders. Their copy states the buyback rule without figures that
drift: each $1B the U.S. borrows → a buyback and burn, with a receipt (the header and OG card show one dated reading, Treasury's
2026-10-08 figure, labelled with its date).

## Regenerating the images

    node site/brand-concepts/render.mjs d1     # re-render the concept PNGs after editing d1-debt-clock/*.html
    node site/burnticker/brand/render.mjs      # copy them here (avatar, header, og) and derive the 64 px favicon

The second script publishes both chosen identities (B1 for Burnticker, D1 here) from `site/brand-concepts/`; it no longer
rasterises SVGs. `avatar.svg` and `header.svg` in this folder are the retired 10-09 kit, kept for reference only.
