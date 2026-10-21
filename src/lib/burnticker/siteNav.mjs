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
  { label: "Verify it yourself", href: "/burnticker/verify-yourself", kind: "app" },   // legitimacy pass item 7
  { label: "Who runs this", href: "/burnticker/operator", kind: "app" },   // website-15 item 16: the address stays /operator
  { label: "Whitepaper", href: "/whitepaper.html", kind: "static" },
  { label: "Docs and API", href: "/burnticker/docs", kind: "app" },
  { label: "How burns are settled", href: "/burnticker/how-burns-settle", kind: "app" },   // owner, 2026-10-12
  // legitimacy pass items 1, 2, 3, 6 (owner, 2026-10-12: history is available, not on display; two clicks deep, never on the home page)
  { label: "Changelog", href: "/burnticker/changelog", kind: "app" },
  { label: "Incidents", href: "/burnticker/incidents", kind: "app" },
  { label: "Bounty", href: "/burnticker/bounty", kind: "app" },
  { label: "Press", href: "/burnticker/press", kind: "app" },
  { label: "Terms", href: "/burnticker/terms", kind: "app" },
  { label: "Privacy", href: "/burnticker/privacy", kind: "app" },
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
  unread: "Whether creator launches are open is unknown right now, so no launch controls are shown.",
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

/** The activity line's kind labels, the same words as src/lib/burnticker/activity.ts EVENT_LABEL (test/burntickerWebsite14.test.ts holds them equal). */
export const EVENT_LABELS = { burn: "Burn", reading: "Reading", graduation: "Graduated", pool: "Pool registered", created: "Created", reserved: "Mint reserved" };

/** The header search (review item 3): it searches the coin list. */
export const SEARCH = { label: "Search coins", placeholder: "Search coins", href: "/burnticker" };

/** The hero, one line and one subline (review item 7). */
/** Owner, 2026-10-14: a kicker above the title. Most coins end on a date or a result; $DEFICIT is the one with no end, and its card says so. */
/** Owner decision 2026-10-18: the kicker and the title stay as they are, with no qualifying note under the subline. */
export const HERO = { kicker: "Memecoins with an expiration date.", title: "Memecoins that burn on real-world results.", sub: "Every burn leaves a receipt." };

/**
 * TWO PATHS ON ARRIVAL (website-14, ChatGPT product idea 1): explore or create, one sentence each on what happens next. "Launch a coin"
 * opens the closed-launches dialog while launches are closed (the shell script's data-launch-button). Plain words, lint-clean.
 */
export const TWO_PATHS = [
  { id: "explore", label: "Explore coins", href: "/burnticker", text: "See every coin, its rule and its receipts, and follow coins in this browser without a wallet." },
  // prelaunch audit 2026-10-18 (optional polish): the same label as the header's launch button, and it never changes once the site
  // launch record is read; the status line under it says whether launches are open
  { id: "create", label: LAUNCH_LABELS.button, href: "/burnticker/launch", text: "Pick a public result, lock one rule, then review every detail." },
];
/**
 * The create path and its status line (audit 10 item 23, 2026-10-13; prelaunch audit 2026-10-18 optional polish). The label and the
 * sentence under it stay the same whatever the site launch record says, so nothing on the button changes when the read lands. The
 * status line under the button carries the record's own sentence (launchAvailability.ts SiteLaunchState.sentence, never typed here):
 * while it loads, the record's loading sentence; while launches are closed or the record is unreadable, that sentence and that the
 * launch page still walks through a launch with nothing signed; once a record can sign (`canSign`), its open sentence. The static home
 * runs createPathFor in the browser on GET /api/burnticker/home, so the status line is the one part of the path that changes.
 */
export const CREATE_PREVIEW = { label: "Preview a coin launch", text: "Walk through a launch and its review, with nothing signed." };
/**
 * @param {{ canSign?: boolean; sentence?: string } | null | undefined} launch the site launch record (null = not read)
 * @returns {{ label: string; text: string; status: string | null; open: boolean }}
 */
export function createPathFor(launch) {
  const open = !!(launch && launch.canSign === true);
  const create = TWO_PATHS[1];
  const said = launch && typeof launch.sentence === "string" && launch.sentence ? launch.sentence : null;
  return { label: create.label, text: create.text, status: open ? said : (said || LAUNCH_CLOSED.unread) + " " + CREATE_PREVIEW.text, open: open };
}
/** The plain way in to the evidence, under the two paths: the devnet receipt walked through step by step. */
export const WALKTHROUGH_LINK = { label: "Watch how a burn works", href: "/burnticker/how-a-burn-works", text: "A real devnet burn, taken apart step by step." };

/** The "How it works" strip under the hero (review item 8). Plain words; the precise terms live on the about page and the coin page. */
export const HOW_IT_WORKS = [
  // `line`: the one line a phone shows under the title before the step is opened (website-15 item 14)
  { title: "One locked rule", text: "Each coin names one public result, such as a game score or the national debt figure. The rule is locked when the coin launches.", line: "Each coin names one public result." },
  { title: "The result settles", text: "When the result is published, fees from trading the coin buy back some of it from its pool.", line: "When the result is published, the coin's own fees pay for its burn." },
  { title: "Burned, with a receipt", text: "Everything bought is burned in the same transaction. That transaction is the receipt, and anyone can check it.", line: "Everything bought is burned, and the transaction is the receipt." },
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
  legal: "Read the terms of use and the privacy page.",
  sources: "The rules read public sources such as the U.S. Treasury, BLS, the National Weather Service, MLB, the NHL, the NBA, TheSportsDB, the FEC, JPL, Wikimedia and Polymarket. None of them is affiliated with any coin or endorses one.",
};

/**
 * THE FOOTER'S ROWS (site-polish-2, 2026-10-13; the private review's footer item): the slip keeps every disclosure (the risk paragraph
 * above, the operator, the fees, the API) but each explanation lives on its own page, so the rows print one line and a link to the
 * detail instead of the whole paragraph on every page. The fee line itself is fees.ts DEV_FEE_LINE (passed in by the caller); its full
 * use-of-fees paragraph is on the Trust page. `api` is the base path, which answers with the version and the docs link.
 */
export const FOOTER_ROWS = {
  operator: { label: "OPERATOR", more: "What the operator controls", href: "/burnticker/trust" },
  fees: { label: "DEV FEE", more: "The fee ledger", href: "/burnticker/fees/ledger" },
  api: { label: "API", path: "/api/burnticker/v1", more: "Docs", href: "/burnticker/docs" },
  end: "KEEP THIS RECEIPT",
};

/** The words of FOOTER_COPY.legal that link to the terms and privacy pages (polish-1 wiring). */
export const FOOTER_LEGAL_LINKS = [
  { words: "terms of use", href: "/burnticker/terms" },
  { words: "privacy page", href: "/burnticker/privacy" },
];

/**
 * THE ONE ICON SET (legitimacy pass item 4, 2026-10-12): inline SVG strokes on a 24-unit grid, drawn in the text colour, no icon font and
 * no glyph characters. Each icon is a list of path data; the app (_components/TabBar.tsx) and the static pages (tabsHtml below) draw the
 * same paths. @type {Record<string, string[]>}
 */
export const SITE_ICONS = {
  coins: ["M4 4h7v7H4z", "M13 4h7v7h-7z", "M4 13h7v7H4z", "M13 13h7v7h-7z"],
  search: ["M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13z", "M15.5 15.5 20 20"],
  launch: ["M12 5v14", "M5 12h14"],
  seasons: ["M5 7h14", "M15 3l4 4-4 4", "M19 17H5", "M9 13l-4 4 4 4"],
  learn: ["M6 3h12v17l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5-2 1.5z", "M9 8h6", "M9 12h6"],
};
/** One icon as SVG markup for a static page (the app draws the same paths in JSX). */
export const iconSvg = (name, cls = "sh-icon") => `<svg class="${cls}" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${(SITE_ICONS[name] ?? []).map((d) => `<path d="${d}"/>`).join("")}</svg>`;

/**
 * The phone tab bar, on every page under 900 px (review item 16).
 * `name` is the link's accessible name (QA pass 9 item 43): it starts with the visible label (WCAG 2.5.3, label in name) and says where
 * the tab goes, so a screen reader hears "Search coins", not a bare "Search" beside an icon.
 * @type {{ label: string; name: string; href: string; icon: string }[]}
 */
export const SITE_TABS = [
  { label: "Coins", name: "Coins, the list of every coin", href: "/burnticker", icon: "coins" },
  { label: "Search", name: "Search coins", href: "/burnticker#search", icon: "search" },
  { label: "Launch", name: "Launch a coin", href: "/burnticker/launch", icon: "launch" },
  { label: "Seasons", name: "Seasons and league scoreboards", href: "/burnticker/leagues", icon: "seasons" },
  { label: "Learn", name: "Learn how it works", href: "/burnticker/about", icon: "learn" },
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
    `      <details class="sh-learn"><summary>Learn<span aria-hidden="true" class="sh-ext">▾</span></summary>`,
    `        <div class="sh-learn-menu" data-site-nav="learn">`,
    linksHtml(LEARN_NAV, { origin, current: o.current, indent: "          " }),
    `        </div>`,
    `      </details>`,
    `    </nav>`,
    `    <form class="sh-search" role="search" action="${origin}${SEARCH.href}" method="get"><label class="sh-sr" for="sh-q">${SEARCH.label}</label><input id="sh-q" name="q" type="search" placeholder="${SEARCH.placeholder}" autocomplete="off"></form>`,
    `    <div class="sh-actions">`,
    `      <a class="sh-launch" href="${origin}/burnticker/launch" data-launch-button>${LAUNCH_LABELS.button}</a>`,
    `      <a class="sh-wallet" href="${origin}${WALLET.href}" title="${esc(WALLET.note)}" data-wallet-button>${WALLET.label}</a>`,
    `      <button type="button" class="sh-icon" data-theme-toggle aria-label="Switch to light theme" title="Light theme">☀</button>`,
    `      <details class="sh-menu" id="menu"><summary aria-label="Menu: every page" aria-controls="menu-links">Menu</summary>`,
    `        <nav class="sh-menu-links" id="menu-links" aria-label="Burnticker (menu)" data-site-nav="menu">`,
    linksHtml(ALL_LINKS, { origin, current: o.current, indent: "          " }),
    `          <p class="sh-menu-wallet">${esc(WALLET.menuNote)} <a href="${origin}${WALLET.href}" data-wallet-button>${WALLET.label}</a></p>`,
    `        </nav>`,
    `      </details>`,
    `    </div>`,
    `  </div>`,
    `  <div class="sh-ticker" data-activity tabindex="0" aria-label="Latest activity on chain"><span class="sh-ticker-skel" aria-hidden="true"></span><span class="sh-sr">Loading the latest activity.</span></div>`,
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
 * `feeLine` is visibleFeeLines.ts FOOTER_FEE_LINE (fees.ts DEV_FEE_LINE plus the HS-96 tier-pin sentence while it applies). Same order and rows as the app's SiteFooter (site-polish-2: one slip on every surface).
 * @param {{ origin?: string; current?: string; operatorLine: string; feeLine: string }} o
 */
export function shellFooterHtml(o) {
  const origin = o.origin ?? "";
  const R = FOOTER_ROWS;
  return [
    `<footer class="sh-footer" id="disclosure">`,
    `  <div class="sh-slip">`,
    `    <p class="sh-slip-title">BURNTICKER</p>`,
    `    <div class="sh-rule"></div>`,
    `    <p class="sh-slip-never">${esc(FOOTER_COPY.never)}</p>`,
    `    <p><b>*** NOT ADVICE ***</b> ${esc(FOOTER_COPY.notAdvice)}</p>`,
    `    <p>${esc(FOOTER_COPY.affiliation)} ${esc(FOOTER_COPY.chain)}</p>`,
    `    <p class="sh-slip-dim">${esc(FOOTER_COPY.sources)}</p>`,
    `    <p data-legal-line>${FOOTER_LEGAL_LINKS.reduce((h, l) => h.replace(esc(l.words), `<a href="${esc(origin + l.href)}">${esc(l.words)}</a>`), esc(FOOTER_COPY.legal))}</p>`,
    `    <div class="sh-rule"></div>`,
    `    <dl class="sh-rows">`,
    `      <div><dt>${R.operator.label}</dt><dd><span data-operator-line>${esc(o.operatorLine)}</span> <a href="${origin}${R.operator.href}">${esc(R.operator.more)}</a></dd></div>`,
    `      <div><dt>${R.fees.label}</dt><dd><span data-fee-line>${esc(o.feeLine)}</span> <a href="${origin}${R.fees.href}">${esc(R.fees.more)}</a></dd></div>`,
    `      <div><dt>${R.api.label}</dt><dd><a href="${origin}${R.api.path}">${R.api.path}</a> · <a href="${origin}${R.api.href}">${esc(R.api.more)}</a></dd></div>`,
    `    </dl>`,
    `    <div class="sh-rule"></div>`,
    `    <nav class="sh-slip-links" aria-label="Footer" data-site-nav="footer">`,
    linksHtml(ALL_LINKS, { origin, current: o.current, indent: "      " }),
    `    </nav>`,
    `    <p class="sh-slip-end">— ${R.end} —</p>`,
    `  </div>`,
    `</footer>`,
    `<nav class="sh-tabbar" aria-label="Burnticker sections" data-site-nav="tabs">`,
    ...SITE_TABS.map((t) => `  <a href="${origin}${t.href}" aria-label="${esc(t.name)}"${t.href === o.current ? ' aria-current="page"' : ""}><span aria-hidden="true">${iconSvg(t.icon)}</span><span>${t.label}</span></a>`),
    `</nav>`,
  ].join("\n");
}

/**
 * The shell's styles for the static pages: the app's B1 "thermal receipt" tokens, dark by default (review item 17); the visitor's switch
 * (`bt-theme`, shared with the app) turns on the paper theme. Every class is prefixed `sh-` so a page's own styles never collide.
 * ChatGPT audit 6 item 21: the header and the phone tab bar are opaque, and the page's bottom padding is the bar's height (60 px plus its
 * 2 px border) plus the safe area plus a gap, so no footer link or button sits under the bar. Audit 7 item 21: 12 px tab labels.
 */
export const SHELL_CSS = `
:root{--sh-bg:#12100e;--sh-counter:#1b1815;--sh-line:#2d2925;--sh-ink:#f2eee4;--sh-dim:#aba395;--sh-paper:#f2eee4;--sh-paper-ink:#1b1916;--sh-paper-dim:#5a5248;--sh-stamp:#9b84e6;--sh-stamp-solid:#5b3fa3;--sh-scorch:#c8873a;
  --sh-mono:"Courier Prime",ui-monospace,"SF Mono",Menlo,Consolas,"Liberation Mono",monospace;--sh-sans:"Space Grotesk",-apple-system,BlinkMacSystemFont,"Helvetica Neue",Helvetica,Arial,sans-serif}
:root[data-theme="light"]{--sh-bg:#f2eee4;--sh-counter:#e9e4d7;--sh-line:#d3ccbc;--sh-ink:#1b1916;--sh-dim:#4d473f;--sh-paper:#fbf9f4;--sh-stamp:#5b3fa3;--sh-scorch:#8a5a24}
.sh-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.sh-skip{position:absolute;left:-9999px;top:8px;z-index:60;background:var(--sh-paper);color:var(--sh-paper-ink);padding:6px 10px;font-family:var(--sh-mono)}.sh-skip:focus{left:8px}
.sh-header{position:sticky;top:0;z-index:40;background:var(--sh-bg);border-bottom:2px dashed var(--sh-line);font-family:var(--sh-sans)}
.sh-row{max-width:72rem;margin:0 auto;padding:10px 16px;display:flex;align-items:center;gap:16px}
.sh-brand{display:flex;align-items:center;gap:10px;color:var(--sh-ink);text-decoration:none;flex:0 0 auto}
.sh-mark{width:34px;height:34px;border-radius:50%;display:block;box-shadow:0 0 0 1px var(--sh-line)}
.sh-word{font:700 1.08rem/1 var(--sh-mono);letter-spacing:.16em}
.sh-nav{display:none;align-items:center;gap:6px;margin-left:12px} /* private review 8: room between the wordmark, the links and Learn at 1440 */
.sh-nav a,.sh-learn>summary{font:700 .8rem/1 var(--sh-mono);letter-spacing:.1em;text-transform:uppercase;color:var(--sh-dim);text-decoration:none;padding:9px 10px;border-radius:4px;white-space:nowrap;cursor:pointer;list-style:none}
.sh-learn>summary::-webkit-details-marker{display:none}
.sh-ext{font-size:.7em;margin-left:3px;opacity:.7}
.sh-nav a:hover,.sh-learn>summary:hover{color:var(--sh-ink);background:var(--sh-counter)}
.sh-nav a[aria-current="page"]{color:var(--sh-ink);box-shadow:inset 0 -2px 0 var(--sh-stamp);border-radius:0}
.sh-learn{position:relative}
.sh-learn-menu{position:absolute;left:0;top:calc(100% + 6px);z-index:50;display:grid;min-width:210px;padding:6px;background:var(--sh-counter);border:1px solid var(--sh-line);border-radius:8px;box-shadow:0 10px 28px rgba(0,0,0,.35)}
.sh-learn-menu a{text-transform:none;letter-spacing:.02em;font:600 .9rem/1.2 var(--sh-sans);padding:10px}
.sh-search{flex:1 1 auto;min-width:0;display:none}
.sh-search input{width:100%;max-width:26rem;font:.9rem var(--sh-sans);color:var(--sh-ink);background:var(--sh-counter);border:1px solid var(--sh-line);border-radius:6px;padding:9px 12px}
.sh-actions{display:flex;align-items:center;gap:6px;margin-left:auto}
.sh-launch{display:inline-block;font:700 .78rem/1 var(--sh-mono);letter-spacing:.1em;text-transform:uppercase;color:#fff;background:var(--sh-stamp-solid);border:2px solid var(--sh-stamp-solid);border-radius:4px;padding:9px 12px;text-decoration:none;white-space:nowrap;cursor:pointer}
.sh-wallet,.sh-ghost{font:700 .76rem/1 var(--sh-mono);letter-spacing:.08em;text-transform:uppercase;color:var(--sh-dim);background:transparent;border:1px solid var(--sh-line);border-radius:4px;padding:9px 12px;white-space:nowrap}
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
.sh-ticker .sh-kind{display:inline-block;margin-right:6px;padding:1px 5px;border:1px solid var(--sh-line);border-radius:3px;font-size:.66rem;text-transform:uppercase;letter-spacing:.08em;color:var(--sh-dim)}
.sh-modal{max-width:min(28rem,calc(100vw - 32px));background:var(--sh-counter);color:var(--sh-ink);border:1px solid var(--sh-line);border-radius:10px;padding:20px;font-family:var(--sh-sans)}
.sh-modal::backdrop{background:rgba(0,0,0,.6)}
.sh-modal h2{font:700 1rem/1.3 var(--sh-mono);letter-spacing:.06em;text-transform:uppercase;margin:0 0 10px}
.sh-modal-row{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0 0}
.sh-footer{margin-top:48px;padding:0 16px 40px;font-family:var(--sh-mono)}
.sh-slip{position:relative;max-width:34rem;margin:0 auto;background:var(--sh-paper);color:var(--sh-paper-ink);font-size:.86rem;line-height:1.5;padding:26px 22px 22px;transform:rotate(-.6deg);box-shadow:0 10px 28px rgba(0,0,0,.35),0 1px 0 rgba(0,0,0,.25);background-image:repeating-linear-gradient(0deg,rgba(0,0,0,.025) 0 1px,transparent 1px 3px)}
.sh-slip::before,.sh-slip::after{content:"";position:absolute;left:0;right:0;height:10px;background-repeat:repeat-x;background-size:14px 10px}
.sh-slip::before{top:-10px;background-image:conic-gradient(from 135deg at 50% 0,var(--sh-paper) 90deg,transparent 0)}
.sh-slip::after{bottom:-10px;background-image:conic-gradient(from -45deg at 50% 100%,var(--sh-paper) 90deg,transparent 0)}
.sh-slip p{margin:0 0 8px}
.sh-slip-title{text-align:center;font-weight:700;font-size:1.35rem;letter-spacing:.22em}
.sh-slip-never{text-align:center;font-weight:700}
.sh-slip-dim{color:var(--sh-paper-dim);font-size:.8rem}
.sh-rows{margin:0;display:grid;gap:6px}.sh-rows>div{display:grid;grid-template-columns:6.5rem 1fr;gap:10px}.sh-rows dt{font-weight:700;letter-spacing:.08em}.sh-rows dd{margin:0;overflow-wrap:anywhere}
.sh-rule{border-top:2px dashed color-mix(in srgb,var(--sh-paper-ink) 70%,transparent);margin:12px 0}
.sh-slip a{color:var(--sh-paper-ink);text-decoration:underline;text-underline-offset:2px}.sh-slip a:hover{color:var(--sh-stamp-solid)}
.sh-slip-links{display:flex;flex-wrap:wrap;gap:6px 14px}
.sh-slip-end{margin:14px 0 0!important;text-align:center;font-size:.72rem;letter-spacing:.18em;color:var(--sh-paper-dim)}
.sh-tabbar{display:none}
a:focus-visible,summary:focus-visible,button:focus-visible,input:focus-visible{outline:2px solid var(--sh-stamp);outline-offset:2px}
@media (min-width:640px){.sh-search{display:block}.sh-wallet{display:inline-block}}
@media (min-width:900px){.sh-nav{display:flex}.sh-menu{display:none}.sh-actions{margin-left:8px}}
@media (max-width:899px){
  body{padding-bottom:calc(62px + env(safe-area-inset-bottom) + 12px)}
  .sh-tabbar{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));position:fixed;left:0;right:0;bottom:0;z-index:45;background:var(--sh-bg);border-top:2px dashed var(--sh-line);padding-bottom:env(safe-area-inset-bottom)}
  .sh-tabbar a{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;height:60px;min-width:44px;font:700 12px/1 var(--sh-mono);letter-spacing:.03em;text-transform:uppercase;color:var(--sh-dim);text-decoration:none}
  .sh-tabbar a span:first-child{display:block;line-height:0}
  .sh-icon{width:20px;height:20px;display:block}
  .sh-tabbar a[aria-current="page"]{color:var(--sh-ink);box-shadow:inset 0 2px 0 var(--sh-stamp)}
}
.sh-ticker.more-end{-webkit-mask-image:linear-gradient(90deg,#000 calc(100% - 40px),transparent);mask-image:linear-gradient(90deg,#000 calc(100% - 40px),transparent)}
.sh-ticker.more-start{-webkit-mask-image:linear-gradient(90deg,transparent,#000 40px);mask-image:linear-gradient(90deg,transparent,#000 40px)}
.sh-ticker.more-start.more-end{-webkit-mask-image:linear-gradient(90deg,transparent,#000 40px,#000 calc(100% - 40px),transparent);mask-image:linear-gradient(90deg,transparent,#000 40px,#000 calc(100% - 40px),transparent)}
@media (max-width:420px){.sh-row{gap:8px}.sh-launch{padding:9px 9px;font-size:.72rem}.sh-actions{gap:4px}}
@media (max-width:479px){.sh-word{display:none}}
@media (max-width:480px){.sh-slip{transform:none;padding:24px 16px 18px}.sh-rows>div{grid-template-columns:1fr;gap:0}}
@media (prefers-reduced-motion:reduce){.sh-slip{transform:none}} /* audit 7 item 18: the wordmark returns only where the header tools fit beside it (no overflow at 401 to 479 px) */
`;

/**
 * ONE TYPEFACE SET (QA pass 9 item 42, 2026-10-13): the app self-hosts Courier Prime and Space Grotesk through next/font, but the static
 * pages only named them, so a visitor without them installed read the home in the system fonts. The same two families (latin subset, the
 * files next/font serves; SIL Open Font License) now ship with the static site in site/burnticker/fonts/, and every static page's shell
 * style starts with these rules. `origin` is "" on burnticker.com and SITE_ORIGIN on another host (Caddy sends the CORS header for
 * /fonts/*). Same families, weights and display as the app's layout (config/public-repo/overlay/src/app/layout.tsx).
 */
export const SHELL_FONTS = [
  { family: "Courier Prime", weight: "400", file: "courier-prime-400-latin.woff2" },
  { family: "Courier Prime", weight: "700", file: "courier-prime-700-latin.woff2" },
  { family: "Space Grotesk", weight: "300 700", file: "space-grotesk-latin.woff2" },
];
const LATIN = "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD";
/** @param {string} [origin] */
export const shellFontCss = (origin = "") => SHELL_FONTS.map((f) => `@font-face{font-family:"${f.family}";font-style:normal;font-weight:${f.weight};font-display:swap;src:url("${origin}/fonts/${f.file}") format("woff2");unicode-range:${LATIN}}`).join("\n");

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
  // prelaunch audit 2026-10-18 A-29: aria-expanded follows the menu's real state, on the toggle event and right after each press
  function sync() { sum.setAttribute("aria-expanded", m.open ? "true" : "false"); }
  m.addEventListener("toggle", function () { sync(); if (m.open) { var l = links()[0]; if (l) l.focus(); } });
  sum.addEventListener("click", function () { setTimeout(sync, 0); });
  sync();
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
  var btns = Array.prototype.slice.call(document.querySelectorAll("[data-launch-button]")), dlg = document.getElementById("sh-launch-closed"), open = false;
  var said = dlg && dlg.querySelector("[data-launch-sentence]");
  window.btHome = window.btHome || fetch(${api} + "/home", { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  window.btHome.then(function (j) { var l = j && j.launch; open = !!(l && l.wizard === true); if (said) said.textContent = l && l.sentence ? l.sentence : ${JSON.stringify(LAUNCH_CLOSED.unread)}; createPath(l || null); });
  // audit 10 item 23: the home's create path, from the same record (siteNav.mjs createPathFor, written here as source)
  function createPath(l) {
    var TWO_PATHS = ${JSON.stringify(TWO_PATHS)}, CREATE_PREVIEW = ${JSON.stringify(CREATE_PREVIEW)}, LAUNCH_CLOSED = ${JSON.stringify({ unread: LAUNCH_CLOSED.unread })};
    var p = (${createPathFor.toString()})(l), box = document.querySelector("[data-two-paths]"); if (!box) return;
    var t = box.querySelector("[data-create-label]"), x = box.querySelector("[data-create-text]"), s = box.querySelector("[data-create-status]");
    if (t) t.textContent = p.label; if (x) x.textContent = p.text; if (s) { s.textContent = p.status || ""; s.hidden = !p.status; }
    box.setAttribute("data-create-open", p.open ? "true" : "false");
  }
  if (dlg && typeof dlg.showModal === "function") btns.forEach(function (btn) { btn.addEventListener("click", function (e) { if (open) return; e.preventDefault(); dlg.showModal(); }); });
  if (dlg) { var c = dlg.querySelector("[data-modal-close]"); if (c) c.addEventListener("click", function () { dlg.close(); }); }
  if (dlg && /(^|#)launch-closed$/.test(location.hash) && typeof dlg.showModal === "function") dlg.showModal();
})();
(function () {
  // THE ACTIVITY LINE (website-14): burns, signed readings, graduations and pool registrations from GET /api/burnticker/home, each
  // labelled with its kind and linking its own evidence; never a placeholder row. No events: one line saying so. When the strip is wider
  // than the screen it scrolls sideways, and the edge that still has more fades (ChatGPT audit 6 item 24, the app's useScrollEdges).
  var box = document.querySelector("[data-activity]"); if (!box || !window.fetch) return;
  var KIND = ${JSON.stringify(EVENT_LABELS)};
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; }
  function edge() { box.classList.toggle("more-start", box.scrollLeft > 4); box.classList.toggle("more-end", box.scrollLeft + box.clientWidth < box.scrollWidth - 4); }
  box.addEventListener("scroll", edge); window.addEventListener("resize", edge);
  window.btHome.then(function (j) {
    box.textContent = "";
    if (!j || !Array.isArray(j.events)) { box.appendChild(el("span", "", "The latest activity did not load just now.")); edge(); return; }
    if (!j.events.length) { box.appendChild(el("span", "", j.noEvents)); edge(); return; }
    j.events.forEach(function (ev) { var a = el("a", ""); a.href = (/^https?:/.test(ev.href) ? "" : ${JSON.stringify(o.origin ?? "")}) + ev.href; a.setAttribute("data-kind", ev.kind || "burn"); a.appendChild(el("span", "sh-kind", KIND[ev.kind] || KIND.burn)); if (ev.network !== "mainnet") a.appendChild(el("span", "sh-net", ev.network)); a.appendChild(document.createTextNode(ev.text)); box.appendChild(a); });
    edge();
  }).catch(function () { box.textContent = ""; box.appendChild(el("span", "", "The latest activity did not load just now.")); edge(); });
})();`;
}
