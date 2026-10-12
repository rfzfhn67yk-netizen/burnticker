/**
 * THE ONE BURNTICKER LINK SET (site audit #6/#13, ChatGPT audit R06 and BT-22, 2026-10-11). The dark home, the app pages, the whitepaper
 * and the $DEFICIT site printed four different navigation bars. This file is the only list: the app header and footer read it through
 * src/app/burnticker/_components/nav.ts, scripts/whitepaper-html.mjs renders it into the whitepaper, and test/burntickerSiteNav.test.ts
 * holds the hand-written static pages (site/burnticker/index.html, status, fallback, site/deficit/index.html) to the same labels, hrefs
 * and order. Plain JavaScript so the generator and the app share it without a build step.
 *
 * kind: "app" = a Next.js page under /burnticker (Caddy proxies it); "static" = a file the static site serves; "external" = another
 * origin, opened in a new tab with rel="noopener" and an ↗ mark. Launch is listed always and labelled by the launch state.
 */

export const SITE_ORIGIN = "https://burnticker.com";

/** @typedef {{ label: string; href: string; kind: "app" | "static" | "external"; launch?: boolean }} SiteLink */

/** Header and footer, in this order, on every surface. @type {SiteLink[]} */
export const SITE_NAV = [
  { label: "Launch", href: "/burnticker/launch", kind: "app", launch: true },
  { label: "Coins", href: "/burnticker", kind: "app" },
  { label: "Seasons", href: "/burnticker/leagues", kind: "app" },
  { label: "Trust", href: "/burnticker/trust", kind: "app" },
  { label: "Whitepaper", href: "/whitepaper.html", kind: "static" },
  { label: "Docs/API", href: "/burnticker/docs", kind: "app" },
  { label: "$DEFICIT", href: "https://deficit.burnticker.com/", kind: "external" },
];

/** Footers add the X account after the shared set. @type {SiteLink[]} */
export const SITE_FOOTER_EXTRA = [{ label: "X · @BurnTicker", href: "https://x.com/BurnTicker", kind: "external" }];

/** The Launch entry's words: closed (and whenever the state cannot be read) vs open; the desktop row says "Launch" when open. */
export const LAUNCH_LABELS = { closed: "Launch · closed", open: "Launch a token", openShort: "Launch" };

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
 * The link set as HTML anchors for a static page. `origin` prefixes same-site hrefs ("" on burnticker.com itself, SITE_ORIGIN on the
 * $DEFICIT subdomain); `current` marks one href with aria-current; `self` names an external href that IS this page (the $DEFICIT site
 * marks itself current instead of external); `footer` appends SITE_FOOTER_EXTRA.
 * @param {{ origin?: string; current?: string; self?: string; footer?: boolean; indent?: string }} [o]
 */
export function siteNavHtml(o = {}) {
  const origin = o.origin ?? "", ind = o.indent ?? "";
  const links = o.footer ? [...SITE_NAV, ...SITE_FOOTER_EXTRA] : SITE_NAV;
  return links.map((l) => {
    if (l.href === o.self) return `${ind}<a href="${esc(l.href)}" aria-current="page">${esc(l.label)}</a>`;
    if (l.kind === "external") return `${ind}<a href="${esc(l.href)}" target="_blank" rel="noopener">${esc(l.label)}<span aria-hidden="true"> ↗</span></a>`;
    const href = `${origin}${l.href}`, cur = l.href === o.current ? ' aria-current="page"' : "";
    if (l.launch) return `${ind}<a href="${esc(href)}" data-launch-link${cur}>${esc(LAUNCH_LABELS.closed)}</a>`;
    return `${ind}<a href="${esc(href)}"${cur}>${esc(l.label)}</a>`;
  }).join("\n");
}
