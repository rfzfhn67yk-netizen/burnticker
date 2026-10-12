/**
 * THE ONE BURNTICKER SHELL (website-10, 2026-10-12; the owner's review items 2, 3, 4, 11 and 16, building on site audit #6/#13 and
 * BT-22). burnticker.com and burnticker.com/burnticker printed two different sites. This file is the only source for what every page
 * shares: the link sets, the header's words (search, "Launch a coin", "Connect wallet", the closed-launches modal), the hero
 * and "How it works" copy, the footer receipt's lines and the phone tab bar. The app reads it through src/app/burnticker/_components/
 * nav.ts; the static pages (home, status, fallback, $DEFICIT) get the same header, footer, tab bar, styles and script from the render
 * functions below, written into marked regions by scripts/burnticker-site-nav.mts; scripts/whitepaper-html.mjs renders them into the
 * whitepaper. test/burntickerSiteNav.test.ts holds every surface to this file. Plain JavaScript so the generators and the app share it.
 *
 * kind: "app" = a Next.js page under /burnticker (Caddy proxies it); "static" = a file the static site serves; "external" = another
 * origin, opened in a new tab with rel="noopener" and an ↗ mark.
 */

export const SITE_ORIGIN = "https://burnticker.com";

/** @typedef {{ label: string; href: string; kind: "app" | "static" | "external"; launch?: boolean }} SiteLink */

/** The primary links, in this order, on every surface (review item 11). @type {SiteLink[]} */
export const SITE_NAV = [
  { label: "Coins", href: "/burnticker", kind: "app" },
  { label: "Seasons", href: "/burnticker/leagues", kind: "app" },
  { label: "Launch", href: "/burnticker/launch", kind: "app", launch: true },
];

/** The "Learn" menu and the footer's second row (review item 11). @type {SiteLink[]} */
export const LEARN_NAV = [
  { label: "How it works", href: "/burnticker/about", kind: "app" },
  { label: "Trust", href: "/burnticker/trust", kind: "app" },
  { label: "Operator", href: "/burnticker/operator", kind: "app" },
  { label: "Whitepaper", href: "/whitepaper.html", kind: "static" },
  { label: "Docs and API", href: "/burnticker/docs", kind: "app" },
  { label: "X", href: "https://x.com/BurnTicker", kind: "external" },
];

/** The Launch entry's words. The nav says "Launch" in every state; the header's primary button says "Launch a coin". */
export const LAUNCH_LABELS = { nav: "Launch", button: "Launch a coin" };

/**
 * What the "Launch a coin" button opens when this site's launch wizard is not available (brief rule 1: no date, no waitlist, no email).
 * Its sentence is website-12's site launch record (launchAvailability.ts SiteLaunchState.sentence), never typed here: the app passes the
 * record in, and a static page fills the sentence from GET /api/burnticker/home. `body` is the record's own loading sentence, shown until
 * the read lands; `unread` is its own unavailable sentence (test/burntickerWebsite13.test.ts pins both to SITE_SENTENCE).
 */
export const LAUNCH_CLOSED = {
  title: "Launching a coin",
  body: "Checking whether creator launches are open on this site.",
  unread: "Whether creator launches are open could not be read, so no launch controls are shown.",
  more: "You can still look through the coins and check a real receipt.",
  coins: "See the coins",
  close: "Close",
};

/**
 * The header's "Connect wallet" (website-13, 2026-10-12; owner decision on Claude site audit 2 item 6). In the app it is the real wallet
 * adapter button (src/lib/burnticker/walletShell.ts). A static page cannot load the adapter, so its button opens "Your coins" with the
 * wallet list already open. Connecting is independent of the launch state and signs nothing.
 */
export const WALLET = { label: "Connect wallet", note: "Connecting a wallet only shares its public address with this site. It is used to list your coins on Your coins. Nothing is signed when you connect.", href: "/burnticker/me?connect=1", menuNote: "A wallet is only needed for Your coins." };

/** The header search (review item 3): it searches the coin list. */
export const SEARCH = { label: "Search coins", placeholder: "Search coins", href: "/burnticker" };

/** The hero, one line and one subline (review item 7). */
export const HERO = { title: "Memecoins that burn on real-world results.", sub: "Every burn is a receipt." };

/** The "How it works" strip under the hero (review item 8). Plain words; the precise terms live on the about page and the coin page. */
export const HOW_IT_WORKS = [
  { title: "One locked rule", text: "Each coin names one public result, such as a game score or the national debt figure. The rule is locked when the coin launches." },
  { title: "The result settles", text: "When the result is published, fees from trading the coin buy back some of it from its pool." },
  { title: "Burned, with a receipt", text: "Everything bought is burned in the same transaction. That transaction is the receipt, and anyone can check it." },
];

/**
 * PLAIN MEANINGS AT FIRST USE (website-13, 2026-10-12; Codex review 5's glossary table): the words the home page's hero, its three steps
 * and the cards use before they are explained anywhere else. Shown on demand ("What these words mean"), never as another mandatory
 * introduction. The app's coin list and the static home print the same list. @type {{ term: string; meaning: string }[]}
 */
export const FIRST_USE = [
  { term: "Memecoin", meaning: "A speculative crypto token built around a theme." },
  { term: "Burn", meaning: "Tokens the program destroys for good. It never takes tokens from anyone's wallet." },
  { term: "Receipt", meaning: "The burn's transaction and the source reading behind it, so anyone can check the burn." },
  { term: "Settles", meaning: "The source has published its final result for that period." },
  { term: "Trading fees", meaning: "A small amount collected each time someone trades the coin." },
  { term: "Pool", meaning: "The coin and SOL held by a trading program so that trades can happen." },
  { term: "Curve", meaning: "A new coin's first trading stage. When buyers have put in the full raise, the coin graduates to its own Raydium pool." },
  { term: "Mint", meaning: "The coin's unique address. A reserved address does not mean the coin exists yet." },
  { term: "Mainnet and devnet", meaning: "Mainnet is the real Solana network, where transactions use real SOL. Devnet is a practice network whose tokens have no money value." },
  { term: "SOL and Raydium", meaning: "SOL is Solana's own coin, used for fees and deposits. Raydium is the outside Solana trading service these coins trade on." },
];

/** The footer receipt: the one place the disclaimers are printed (review item 9, brief rule 5). */
export const FOOTER_COPY = {
  never: "Nothing is ever won. Things are only burned.",
  notAdvice: "Memecoins are speculative and can go to zero. Burnticker coins pay nothing and promise nothing. A coin's rule says what its supply does when a public result settles, never what its price does. Nothing on this site is investment advice.",
  affiliation: "Burnticker and its coins are not affiliated with any team, league, candidate, agency or market.",
  chain: "If a page and the chain disagree, the chain is right.",
  sources: "The rules read public sources such as the U.S. Treasury, BLS, the National Weather Service, MLB, the NHL, the NBA, TheSportsDB, the FEC, JPL, Wikimedia and Polymarket. None of them is affiliated with any coin or endorses one.",
};

/** The phone tab bar, on every page under 900 px (review item 16). @type {{ label: string; href: string; glyph: string }[]} */
export const SITE_TABS = [
  { label: "Coins", href: "/burnticker", glyph: "▦" },
  { label: "Search", href: "/burnticker#search", glyph: "⌕" },
  { label: "Launch", href: "/burnticker/launch", glyph: "+" },
  { label: "Seasons", href: "/burnticker/leagues", glyph: "⇄" },
  { label: "Learn", href: "/burnticker/about", glyph: "?" },
];

/**
 * The pages under Seasons, named the same everywhere (BT-22): the index of leagues, every league's scoreboard on one page (route
 * /burnticker/rivalries, which also lists rivalry pairs), and the Burn Derby. @type {SiteLink[]}
 */
export const SEASONS_NAV = [
  { label: "Leagues", href: "/burnticker/leagues", kind: "app" },
  { label: "Scoreboards", href: "/burnticker/rivalries", kind: "app" },
  { label: "Burn Derby", href: "/burnticker/derby", kind: "app" },
];

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * A link set as HTML anchors for a static page. `origin` prefixes same-site hrefs ("" on burnticker.com itself, SITE_ORIGIN on another
 * host); `current` marks one href with aria-current.
 * @param {SiteLink[]} links
 * @param {{ origin?: string; current?: string; indent?: string }} [o]
 */
export function linksHtml(links, o = {}) {
  const origin = o.origin ?? "", ind = o.indent ?? "";
  return links.map((l) => {
    if (l.kind === "external") return `${ind}<a href="${esc(l.href)}" target="_blank" rel="noopener">${esc(l.label)}<span aria-hidden="true"> ↗</span></a>`;
    const href = `${origin}${l.href}`, cur = l.href === o.current ? ' aria-current="page"' : "";
    return `${ind}<a href="${esc(href)}"${l.launch ? " data-launch-link" : ""}${cur}>${esc(l.label)}</a>`;
  }).join("\n");
}

/** The primary links plus the Learn links, as the footer and the phone menu print them. */
export const ALL_LINKS = [...SITE_NAV, ...LEARN_NAV];

/** The receipt-paper mark, inline (the static pages carry no image request for it). */
const MARK = '<img src="ORIGIN/brand/favicon.png" width="34" height="34" alt="" class="sh-mark">';

/**
 * The static header: brand, primary links with the Learn menu, search, "Launch a coin", "Connect wallet" (a link to Your coins), the theme switch and
 * the phone menu; then the activity line and the closed-launches dialog. Same words and order as the app's SiteHeader.
 * @param {{ origin?: string; current?: string }} [o]
 */
export function shellHeaderHtml(o = {}) {
  const origin = o.origin ?? "";
  return [
    `<a class="sh-skip" href="#main">Skip to content</a>`,
    `<header class="sh-header">`,
    `  <div class="sh-row">`,
    `    <a class="sh-brand" href="${origin}/" aria-label="Burnticker home">${MARK.replace("ORIGIN", origin)}<span class="sh-word">BURNTICKER</span></a>`,
    `    <nav class="sh-nav" aria-label="Burnticker" data-site-nav="header">`,
    linksHtml(SITE_NAV, { origin, current: o.current, indent: "      " }),
    `      <details class="sh-learn"><summary>Learn</summary>`,
    `        <div class="sh-learn-menu" data-site-nav="learn">`,
    linksHtml(LEARN_NAV, { origin, current: o.current, indent: "          " }),
    `        </div>`,
    `      </details>`,
    `    </nav>`,
    `    <form class="sh-search" role="search" action="${origin}${SEARCH.href}" method="get"><label class="sh-sr" for="sh-q">${SEARCH.label}</label><input id="sh-q" name="q" type="search" placeholder="${SEARCH.placeholder}" autocomplete="off"></form>`,
    `    <div class="sh-actions">`,
    `      <a class="sh-launch" href="${origin}/burnticker/launch" data-launch-button>${LAUNCH_LABELS.button}</a>`,
    `      <a class="sh-wallet" href="${origin}${WALLET.href}" title="${esc(WALLET.note)}" data-wallet-button>${WALLET.label}<span class="sh-sr">. ${esc(WALLET.note)}</span></a>`,
    `      <button type="button" class="sh-icon" data-theme-toggle aria-label="Switch to light theme" title="Light theme">☀</button>`,
    `      <details class="sh-menu" id="menu"><summary aria-label="Menu: every page" aria-controls="menu-links">Menu</summary>`,
    `        <nav class="sh-menu-links" id="menu-links" aria-label="Burnticker (menu)" data-site-nav="menu">`,
    linksHtml(ALL_LINKS, { origin, current: o.current, indent: "          " }),
    `          <p class="sh-menu-wallet">${esc(WALLET.menuNote)} <a href="${origin}${WALLET.href}" data-wallet-button>${WALLET.label}</a></p>`,
    `        </nav>`,
    `      </details>`,
    `    </div>`,
    `  </div>`,
    `  <div class="sh-ticker" data-activity aria-label="Latest burns"><span class="sh-ticker-skel" aria-hidden="true"></span><span class="sh-sr">Loading the latest burns.</span></div>`,
    `</header>`,
    `<dialog class="sh-modal" id="sh-launch-closed" aria-labelledby="sh-launch-closed-h">`,
    `  <h2 id="sh-launch-closed-h">${esc(LAUNCH_CLOSED.title)}</h2>`,
    `  <p data-launch-sentence>${esc(LAUNCH_CLOSED.body)}</p>`,
    `  <p>${esc(LAUNCH_CLOSED.more)}</p>`,
    `  <p class="sh-modal-row"><a class="sh-launch" href="${origin}/burnticker">${esc(LAUNCH_CLOSED.coins)}</a> <button type="button" class="sh-ghost" data-modal-close>${esc(LAUNCH_CLOSED.close)}</button></p>`,
    `</dialog>`,
  ].join("\n");
}

/**
 * The static footer receipt (the app's SiteFooter prints the same lines) and the phone tab bar. `operatorLine` is the trust copy's
 * OPERATOR_LINE, passed in verbatim by the generator (src/lib/burnticker/trustpack/copy.ts).
 * @param {{ origin?: string; current?: string; operatorLine: string }} o
 */
export function shellFooterHtml(o) {
  const origin = o.origin ?? "";
  return [
    `<footer class="sh-footer" id="disclosure">`,
    `  <div class="sh-slip">`,
    `    <p class="sh-slip-title">BURNTICKER</p>`,
    `    <p class="sh-slip-never">${esc(FOOTER_COPY.never)}</p>`,
    `    <div class="sh-rule"></div>`,
    `    <p><b>NOT ADVICE.</b> ${esc(FOOTER_COPY.notAdvice)}</p>`,
    `    <p>${esc(FOOTER_COPY.affiliation)} ${esc(FOOTER_COPY.chain)}</p>`,
    `    <p class="sh-slip-dim">${esc(FOOTER_COPY.sources)}</p>`,
    `    <div class="sh-rule"></div>`,
    `    <p data-operator-line>${esc(o.operatorLine)}</p>`,
    `    <div class="sh-rule"></div>`,
    `    <nav class="sh-slip-links" aria-label="Footer" data-site-nav="footer">`,
    linksHtml(ALL_LINKS, { origin, current: o.current, indent: "      " }),
    `    </nav>`,
    `    <p class="sh-slip-end">KEEP THIS RECEIPT</p>`,
    `  </div>`,
    `</footer>`,
    `<nav class="sh-tabbar" aria-label="Burnticker sections" data-site-nav="tabs">`,
    ...SITE_TABS.map((t) => `  <a href="${origin}${t.href}"${t.href === o.current ? ' aria-current="page"' : ""}><span aria-hidden="true">${t.glyph}</span><span>${t.label}</span></a>`),
    `</nav>`,
  ].join("\n");
}

/**
 * The shell's styles for the static pages: the app's B1 "thermal receipt" tokens, dark by default (review item 17); the visitor's switch
 * (`bt-theme`, shared with the app) turns on the paper theme. Every class is prefixed `sh-` so a page's own styles never collide.
 */
export const SHELL_CSS = `
:root{--sh-bg:#12100e;--sh-counter:#1b1815;--sh-line:#2d2925;--sh-ink:#f2eee4;--sh-dim:#aba395;--sh-paper:#f2eee4;--sh-paper-ink:#1b1916;--sh-paper-dim:#5a5248;--sh-stamp:#9b84e6;--sh-stamp-solid:#5b3fa3;--sh-scorch:#c8873a;
  --sh-mono:"Courier Prime",ui-monospace,"SF Mono",Menlo,Consolas,"Liberation Mono",monospace;--sh-sans:"Space Grotesk",-apple-system,BlinkMacSystemFont,"Helvetica Neue",Helvetica,Arial,sans-serif}
:root[data-theme="light"]{--sh-bg:#f2eee4;--sh-counter:#e9e4d7;--sh-line:#d3ccbc;--sh-ink:#1b1916;--sh-dim:#4d473f;--sh-paper:#fbf9f4;--sh-stamp:#5b3fa3;--sh-scorch:#8a5a24}
.sh-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.sh-skip{position:absolute;left:-9999px;top:8px;z-index:60;background:var(--sh-paper);color:var(--sh-paper-ink);padding:6px 10px;font-family:var(--sh-mono)}.sh-skip:focus{left:8px}
.sh-header{position:sticky;top:0;z-index:40;background:color-mix(in srgb,var(--sh-bg) 92%,transparent);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);border-bottom:2px dashed var(--sh-line);font-family:var(--sh-sans)}
.sh-row{max-width:72rem;margin:0 auto;padding:10px 16px;display:flex;align-items:center;gap:12px}
.sh-brand{display:flex;align-items:center;gap:10px;color:var(--sh-ink);text-decoration:none;flex:0 0 auto}
.sh-mark{width:34px;height:34px;border-radius:50%;display:block}
.sh-word{font:700 1.02rem/1 var(--sh-mono);letter-spacing:.16em}
.sh-nav{display:none;align-items:center;gap:2px}
.sh-nav a,.sh-learn>summary{font:700 .78rem/1 var(--sh-mono);letter-spacing:.1em;text-transform:uppercase;color:var(--sh-dim);text-decoration:none;padding:9px 10px;border-radius:4px;white-space:nowrap;cursor:pointer;list-style:none}
.sh-learn>summary::-webkit-details-marker{display:none}
.sh-nav a:hover,.sh-learn>summary:hover{color:var(--sh-ink);background:var(--sh-counter)}
.sh-nav a[aria-current="page"]{color:var(--sh-ink);box-shadow:inset 0 -2px 0 var(--sh-stamp);border-radius:0}
.sh-learn{position:relative}
.sh-learn-menu{position:absolute;left:0;top:calc(100% + 6px);z-index:50;display:grid;min-width:200px;padding:6px;background:var(--sh-counter);border:1px solid var(--sh-line);border-radius:8px}
.sh-learn-menu a{text-transform:none;letter-spacing:.02em;font:600 .9rem/1.2 var(--sh-sans);padding:10px}
.sh-search{flex:1 1 auto;min-width:0;display:none}
.sh-search input{width:100%;max-width:26rem;font:.9rem var(--sh-sans);color:var(--sh-ink);background:var(--sh-counter);border:1px solid var(--sh-line);border-radius:6px;padding:9px 12px}
.sh-actions{display:flex;align-items:center;gap:6px;margin-left:auto}
.sh-launch{display:inline-block;font:700 .8rem/1 var(--sh-mono);letter-spacing:.08em;text-transform:uppercase;color:#fff;background:var(--sh-stamp-solid);border:2px solid var(--sh-stamp-solid);border-radius:4px;padding:9px 12px;text-decoration:none;white-space:nowrap;cursor:pointer}
.sh-wallet,.sh-ghost{font:700 .78rem/1 var(--sh-mono);letter-spacing:.08em;text-transform:uppercase;color:var(--sh-dim);background:transparent;border:1px solid var(--sh-line);border-radius:4px;padding:9px 12px;white-space:nowrap}
.sh-wallet{display:none;color:var(--sh-ink);border-color:var(--sh-stamp);text-decoration:none}.sh-wallet:hover{background:var(--sh-stamp-solid);border-color:var(--sh-stamp-solid);color:#fff}.sh-ghost{cursor:pointer}
.sh-menu-wallet{margin:6px 0 0;padding:10px;border-top:1px dashed var(--sh-line);font:.8rem/1.4 var(--sh-sans);color:var(--sh-dim)}.sh-menu-wallet a{display:inline;padding:0;color:var(--sh-ink);text-decoration:underline}
.sh-icon,.sh-menu>summary{font:700 .78rem/1 var(--sh-mono);letter-spacing:.1em;color:var(--sh-dim);background:transparent;border:1px solid var(--sh-line);border-radius:4px;height:34px;min-width:34px;padding:0 10px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;list-style:none}
.sh-menu>summary::-webkit-details-marker{display:none}
.sh-menu{position:relative}
.sh-menu-links{position:absolute;right:0;top:calc(100% + 6px);z-index:50;display:grid;gap:2px;min-width:210px;max-width:calc(100vw - 32px);padding:6px;background:var(--sh-counter);border:1px solid var(--sh-line);border-radius:8px}
.sh-menu-links a{color:var(--sh-ink);text-decoration:none;padding:11px 10px;border-radius:6px;font:600 .92rem var(--sh-sans)}
.sh-ticker{border-top:1px dashed var(--sh-line);font:.78rem/1.3 var(--sh-mono);color:var(--sh-dim);overflow-x:auto;white-space:nowrap;scrollbar-width:none;padding:7px 16px;min-height:31px}
.sh-ticker::-webkit-scrollbar{display:none}
.sh-ticker a{color:var(--sh-ink);text-decoration:none;margin-right:22px}.sh-ticker a:hover{text-decoration:underline}
.sh-ticker .sh-net{display:inline-block;margin-right:6px;padding:1px 5px;border:1px solid var(--sh-line);border-radius:3px;font-size:.66rem;text-transform:uppercase;letter-spacing:.08em;color:var(--sh-scorch)}
.sh-ticker-skel{display:inline-block;width:min(420px,70%);height:10px;border-radius:4px;background:var(--sh-line)}
.sh-modal{max-width:min(28rem,calc(100vw - 32px));background:var(--sh-counter);color:var(--sh-ink);border:1px solid var(--sh-line);border-radius:10px;padding:20px;font-family:var(--sh-sans)}
.sh-modal::backdrop{background:rgba(0,0,0,.6)}
.sh-modal h2{font:700 1rem/1.3 var(--sh-mono);letter-spacing:.06em;text-transform:uppercase;margin:0 0 10px}
.sh-modal-row{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0 0}
.sh-footer{margin-top:48px;padding:0 16px 40px;font-family:var(--sh-mono)}
.sh-slip{max-width:34rem;margin:0 auto;background:var(--sh-paper);color:var(--sh-paper-ink);font-size:.84rem;line-height:1.5;padding:24px 20px 20px;background-image:repeating-linear-gradient(0deg,rgba(0,0,0,.025) 0 1px,transparent 1px 3px)}
.sh-slip p{margin:0 0 8px}
.sh-slip-title{text-align:center;font-weight:700;font-size:1.3rem;letter-spacing:.22em}
.sh-slip-never{text-align:center;font-weight:700}
.sh-slip-dim{color:var(--sh-paper-dim);font-size:.78rem}
.sh-rule{border-top:2px dashed color-mix(in srgb,var(--sh-paper-ink) 70%,transparent);margin:12px 0}
.sh-slip a{color:var(--sh-paper-ink);text-decoration:underline;text-underline-offset:2px}
.sh-slip-links{display:flex;flex-wrap:wrap;gap:6px 14px}
.sh-slip-end{margin:14px 0 0!important;text-align:center;font-size:.72rem;letter-spacing:.18em;color:var(--sh-paper-dim)}
.sh-tabbar{display:none}
a:focus-visible,summary:focus-visible,button:focus-visible,input:focus-visible{outline:2px solid var(--sh-stamp);outline-offset:2px}
@media (min-width:640px){.sh-search{display:block}.sh-wallet{display:inline-block}}
@media (min-width:900px){.sh-nav{display:flex}.sh-menu{display:none}}
@media (max-width:899px){
  body{padding-bottom:calc(64px + env(safe-area-inset-bottom))}
  .sh-tabbar{display:grid;grid-template-columns:repeat(5,1fr);position:fixed;left:0;right:0;bottom:0;z-index:45;background:color-mix(in srgb,var(--sh-bg) 94%,transparent);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);border-top:2px dashed var(--sh-line);padding-bottom:env(safe-area-inset-bottom)}
  .sh-tabbar a{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;height:60px;font:700 10px/1 var(--sh-mono);letter-spacing:.1em;text-transform:uppercase;color:var(--sh-dim);text-decoration:none}
  .sh-tabbar a span:first-child{font-size:18px;line-height:1}
  .sh-tabbar a[aria-current="page"]{color:var(--sh-ink);box-shadow:inset 0 2px 0 var(--sh-stamp)}
}
@media (max-width:420px){.sh-row{gap:8px}.sh-launch{padding:9px 9px;font-size:.72rem}.sh-actions{gap:4px}}
@media (max-width:400px){.sh-word{display:none}}
`;

/**
 * The shell's script for the static pages: the theme switch (one `bt-theme` key with the app), the phone menu (keyboard: Enter opens,
 * Tab stays inside, Escape closes), the Learn menu closing on a click outside, the launch button (the closed-launches dialog unless the
 * host's catalogue says creator launches are open) and the activity line read from GET /api/burnticker/home.
 * @param {{ origin?: string }} [o]
 */
export function shellScript(o = {}) {
  const api = JSON.stringify(`${o.origin ?? ""}/api/burnticker`);
  return `(function () {
  // ONE THEME PREFERENCE: the same "bt-theme" key and switch as the app header; dark unless the visitor picked light
  var root = document.documentElement, b = document.querySelector("[data-theme-toggle]");
  function cur() { return root.dataset.theme === "light" ? "light" : "dark"; }
  function label() { if (!b) return; var d = cur() === "dark"; b.textContent = d ? "\\u2600" : "\\u263E"; b.setAttribute("aria-label", d ? "Switch to light theme" : "Switch to dark theme"); b.title = d ? "Light theme" : "Dark theme"; }
  if (b) b.addEventListener("click", function () { var n = cur() === "dark" ? "light" : "dark"; root.dataset.theme = n; try { localStorage.setItem("bt-theme", n); } catch (e) { /* private window */ } label(); });
  label();
})();
(function () {
  // the phone menu: Enter or Space opens it, focus moves to its first link, Tab and Shift+Tab stay inside, Escape closes it
  var m = document.getElementById("menu"); if (!m) return;
  var sum = m.querySelector("summary");
  function links() { return Array.prototype.slice.call(m.querySelectorAll(".sh-menu-links a[href]")); }
  m.addEventListener("toggle", function () { sum.setAttribute("aria-expanded", m.open ? "true" : "false"); if (m.open) { var l = links()[0]; if (l) l.focus(); } });
  sum.setAttribute("aria-expanded", "false");
  document.addEventListener("keydown", function (e) {
    if (!m.open) return;
    if (e.key === "Escape") { e.preventDefault(); m.open = false; sum.focus(); return; }
    if (e.key !== "Tab") return;
    var ring = [sum].concat(links()), i = ring.indexOf(document.activeElement);
    e.preventDefault();
    ring[i === -1 ? 0 : (e.shiftKey ? (i - 1 + ring.length) % ring.length : (i + 1) % ring.length)].focus();
  });
  document.addEventListener("click", function (e) {
    if (m.open && !m.contains(e.target)) m.open = false;
    var l = document.querySelector(".sh-learn"); if (l && l.open && !l.contains(e.target)) l.open = false;
  });
})();
(function () {
  // "Launch a coin": the launch page when the site's launch record (GET /api/burnticker/home \u2192 launch, website-12's SiteLaunchState) says
  // the wizard is available; otherwise the dialog with the record's own sentence. Unreadable = the dialog with the unavailable sentence.
  var btn = document.querySelector("[data-launch-button]"), dlg = document.getElementById("sh-launch-closed"), open = false;
  var said = dlg && dlg.querySelector("[data-launch-sentence]");
  window.btHome = window.btHome || fetch(${api} + "/home", { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  window.btHome.then(function (j) { var l = j && j.launch; open = !!(l && l.wizard === true); if (said) said.textContent = l && l.sentence ? l.sentence : ${JSON.stringify(LAUNCH_CLOSED.unread)}; });
  if (btn && dlg && typeof dlg.showModal === "function") btn.addEventListener("click", function (e) { if (open) return; e.preventDefault(); dlg.showModal(); });
  if (dlg) { var c = dlg.querySelector("[data-modal-close]"); if (c) c.addEventListener("click", function () { dlg.close(); }); }
  if (dlg && /(^|#)launch-closed$/.test(location.hash) && typeof dlg.showModal === "function") dlg.showModal();
})();
(function () {
  // THE ACTIVITY LINE: confirmed burns only, from GET /api/burnticker/home; never a placeholder row. No events: one line saying so.
  var box = document.querySelector("[data-activity]"); if (!box || !window.fetch) return;
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; }
  window.btHome.then(function (j) {
    box.textContent = "";
    if (!j || !Array.isArray(j.events)) { box.appendChild(el("span", "", "The latest burns could not be read just now.")); return; }
    if (!j.events.length) { box.appendChild(el("span", "", j.noEvents)); return; }
    j.events.forEach(function (ev) { var a = el("a", ""); a.href = ${JSON.stringify(o.origin ?? "")} + ev.href; if (ev.network !== "mainnet") a.appendChild(el("span", "sh-net", ev.network)); a.appendChild(document.createTextNode(ev.text)); box.appendChild(a); });
  }).catch(function () { box.textContent = ""; box.appendChild(el("span", "", "The latest burns could not be read just now.")); });
})();`;
}
