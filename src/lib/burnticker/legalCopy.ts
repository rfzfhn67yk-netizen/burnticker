import { OPERATOR_LINE } from "@/lib/burnticker/trustpack/copy";
import { FOOTER_COPY } from "@/lib/burnticker/siteNav.mjs";

/**
 * TERMS AND PRIVACY (polish-1, 2026-10-12; PLATFORM-NEXT-2-BRIEF.md item 1). The words of /burnticker/terms and /burnticker/privacy, in
 * short sections, so the pages, the copy lint and the plain-English test all read the same strings. Every fact here is one the code
 * already enforces or the owner decided:
 *
 *   no accounts, no cookies, no email capture        the owner (WEBSITE-10-11-BRIEF.md rule 1); nothing in the app sets a cookie
 *   theme and watchlist in the browser only           _components/theme.ts, watchlist.ts (localStorage, never sent)
 *   the wallet adapter remembers the chosen wallet    _components/ShellWalletProviders.tsx (autoConnect; the adapter's own local key)
 *   this-tab memory of the launch form and signing    launch/page.tsx, signPlan.ts (sessionStorage), CoinsIndex.tsx (the selected tab)
 *   no access log of visitor addresses                deploy/caddy/Caddyfile (OP7-10: the access log deletes every address and header)
 *   rate limits counted in memory per address         api/http.ts, api/clientIp.ts (the limiter is in memory on the one app process)
 *   anonymous search reports                          api/product.ts v1SearchMiss / logNoCardSearch (plain words + the UTC hour)
 *   a coin's details and image pinned on Arweave      api/handlers.ts (launches are refused when the pin fails)
 *   the chart on a graduated coin's page              t/[ticker]/page.tsx (GeckoTerminal's embed, loaded from its own site)
 *
 * The takedown route (contact@burnticker.com, the Arweave copy permanent), the creator's
 * responsibilities and "governing law not decided yet" are the owner's words from the brief. The operator line and the not-advice
 * sentence are imported, never retyped, so the tests that pin them keep holding.
 */

export interface LegalSection { id: string; heading: string; paragraphs: string[] }

export const CONTACT_EMAIL = "contact@burnticker.com";
export const GOVERNING_LAW_SENTENCE = "The law that governs these terms has not been decided yet. This page says so plainly instead of guessing.";
export const TAKEDOWN_SENTENCE = `To ask for an image to be taken down, email ${CONTACT_EMAIL}. The copy stored on Arweave when the coin was created is permanent, and nobody can delete it.`;

/** Sixth pass B-16e / HB-59 (AP6-13): the terms, the press page and the fee ledger said the platform "never trades"; the trust page discloses one test purchase. */
export const NEVER_TRADES_SENTENCE = "Apart from one disclosed test purchase of $REHEARSAL (0.1 SOL, when it was created), the platform never trades.";
export const TERMS_TITLE = "Terms of use";
export const TERMS_INTRO = "These terms cover burnticker.com, its pages and its public API. They are short on purpose. By using the site, you agree to them.";

export const TERMS_SECTIONS: LegalSection[] = [
  {
    id: "what-it-is", heading: "What Burnticker is",
    paragraphs: [
      "Burnticker is a launchpad for Solana memecoins whose coins burn on public results. Each coin has one locked rule. When a result settles that rule, the coin's own trading fees buy it back on its own pool, and a program burns what they bought.",
      // sixth pass B-16e / HB-59: the one disclosed test purchase is named where "never trades" is said
      `${NEVER_TRADES_SENTENCE} It never takes an order and never pays anything to a coin's holders. It holds no coins and no money for anyone. The only money it sends to people is the bounty for a security report, paid from the bounty wallet.`,
      "Coins trade on Raydium, an outside Solana trading service. This site links to it, and a coin page's swap panel builds a swap that your own wallet signs and sends straight to the coin's Raydium curve or pool. This site has no control over Raydium.",
    ],
  },
  {
    id: "creators", heading: "What creators are responsible for",
    paragraphs: [
      "A creator chooses the coin's rule. The rule is locked when the coin is created, and a different rule means a different coin. The creator is responsible for that choice.",
      "The creator is also responsible for the image, the note and the links they add to the coin. By adding an image, the creator confirms that they have the right to use it.",
      "Team, league and company names, logos and other marks are used at the creator's own risk.",
      FOOTER_COPY.affiliation,
    ],
  },
  {
    id: "takedown", heading: "Taking an image down",
    paragraphs: [
      "If a coin's image uses something you own, or breaks the law, say which coin it is and why the image should come down.",
      TAKEDOWN_SENTENCE,
    ],
  },
  {
    id: "no-accounts", heading: "No accounts",
    paragraphs: [
      "There are no accounts on Burnticker. You never sign up, log in or give an email address.",
      "Connecting a wallet lets the site read the wallet's public address and ask the wallet to approve a transaction. Nothing is signed unless you approve it in your wallet. The site never holds your keys.",
    ],
  },
  {
    id: "stores", heading: "What the site stores",
    paragraphs: [
      "Your browser keeps your theme and your watchlist. The site holds no accounts and no tokens for anyone. The privacy page lists everything that is kept, and where.",
    ],
  },
  {
    id: "no-advice", heading: "No advice and no warranty",
    paragraphs: [
      FOOTER_COPY.notAdvice,
      "The site, its API and its programs are provided as they are, with no warranty of any kind. A reading, a page or a receipt can be late or wrong. " + FOOTER_COPY.chain,
      "As far as the law allows, the operator is not liable for any loss that comes from using the site, trading a coin or relying on anything shown here.",
    ],
  },
  {
    id: "operator", heading: "Who runs Burnticker",
    paragraphs: [OPERATOR_LINE, GOVERNING_LAW_SENTENCE],
  },
  {
    id: "changes", heading: "Changes to these terms",
    paragraphs: ["These terms can change. The version on this page is the current one, and every earlier version is in the site's public code history."],
  },
];


/**
 * Sixth pass B-16f / HB-60 (AP6-6, SEC-02): the page said it lists everything the site keeps, and left out the held-swap records. After a
 * swap is signed, the browser (swap/pending.ts, local storage) and the server (swap/pendingServer.ts, RECORD_TTL_MS) each keep a short
 * record of it, so a reload or a second tab never sends the same swap twice.
 */
export const PRIVACY_HELD_SWAP_BROWSER = "After you sign a swap on a coin page, this browser keeps a short record of it for up to 24 hours, even if you close the tab: the network, the coin, your wallet's public address, the swap's signature, whether it was a purchase or a sale, when it was signed and when it expires on chain. It is kept so the same swap is never sent twice, and it is removed once the swap settles.";
export const PRIVACY_HELD_SWAP_SERVER = "The server keeps the same record of a signed swap (network, coin, wallet address, swap signature, purchase or sale, expiry and the time it arrived) for up to 24 hours and 10 minutes, then deletes it. It is removed sooner once the swap settles.";

export const PRIVACY_TITLE = "Privacy";
export const PRIVACY_INTRO = "Burnticker has no accounts and keeps as little as it can. This page lists everything the site keeps and where it is kept.";

/**
 * Prelaunch audit 2026-10-18 A-27: the page named GeckoTerminal, the Solana network and the wallet, and said the web server keeps no
 * log of visitors' addresses, which is true of this site's own server but not of the Cloudflare proxy in front of it. Every other
 * service a visitor's browser talks to is named here: Cloudflare (the proxy, and the Web Analytics script it adds to each page),
 * the Arweave gateways coin images are shown from, and Google Fonts, which only the $DEFICIT page still loads (the app's wallet list
 * no longer pulls a Google font: _components/walletAdapter.css).
 */
export const PRIVACY_ORIGIN_LOG_SENTENCE = "This site's own web server keeps no log of visitors' addresses. Cloudflare, which sits in front of it, keeps its own records, as the section \"Other services your browser talks to\" says.";
export const PRIVACY_THIRD_PARTY_PARAGRAPHS: readonly string[] = [
  "Every request to burnticker.com passes through Cloudflare, a network company that carries traffic to the site and shields it from attacks. Cloudflare sees your address and the pages you ask for, as any network in that place does, and keeps its own records under its own privacy policy.",
  "Each page also runs Cloudflare Web Analytics, a small script from static.cloudflareinsights.com that tells Cloudflare a page was viewed and how fast it loaded. The site reads those totals to see which pages people use.",
  "Coin images are stored on Arweave and shown straight from the Arweave gateway that holds them, such as gateway.irys.xyz or arweave.net, so your browser asks that gateway for each image. It does not tell the gateway which page you were on.",
  "The $DEFICIT page loads its lettering from Google Fonts (fonts.googleapis.com and fonts.gstatic.com). The rest of the site serves its own fonts and asks Google for nothing.",
];

/** Campaign readiness 2026-10-19 (item 5): the counted trade links (tradeClicks.ts). */
export const PRIVACY_TRADE_CLICK_SENTENCE = "When you follow a trade link from this site, the site counts that click for the coin and the day. It stores no cookie, no address and nothing about you.";

export const PRIVACY_SECTIONS: LegalSection[] = [
  {
    id: "browser", heading: "In your browser",
    paragraphs: [
      "Your theme, light or dark, is kept in this browser's local storage. So is your watchlist of coins and results. Neither is ever sent to the site.",
      "If you connect a wallet, the wallet connector remembers which wallet you chose, so the connection comes back when you reload. It is kept in the same local storage.",
      "While a tab is open, it remembers the Coins tab you picked and, on the launch page, your unfinished form and any launch transaction your wallet signed, so a reload does not lose them. Closing the tab clears them.",
      PRIVACY_HELD_SWAP_BROWSER,
      "Clearing this site's data in your browser removes all of it.",
    ],
  },
  {
    id: "server", heading: "On the server",
    paragraphs: [
      "The site sets no cookies and asks for no name and no email address. The site holds no accounts and no tokens for anyone.",
      PRIVACY_ORIGIN_LOG_SENTENCE,
      "To limit how often one visitor can call the API, the app counts requests per address in memory. That count is never written down and is gone when the app restarts.",
      "When a search on the launch page finds nothing, or finds cards and none is used, the site keeps the search words and the hour, without an address, an id or a cookie. This shows which results people look for and cannot find.",
      PRIVACY_TRADE_CLICK_SENTENCE,
      PRIVACY_HELD_SWAP_SERVER,
    ],
  },
  {
    id: "launching", heading: "When you create a coin",
    paragraphs: [
      "A coin's name, ticker, rule, creator wallet, note and links are kept with the coin, and most of them are public on the chain and on the coin's page. The site also keeps how long each step of the launch form took, without a name.",
      "The coin's details and image are stored on Arweave, a permanent public storage network, when the coin is created. That copy cannot be deleted. The terms page says how to ask for an image to be taken off this site.",
      "The Your coins page sends your wallet's public address to the site to look up the coins it created. The site does not keep that address.",
    ],
  },
  {
    id: "others", heading: "Other services your browser talks to",
    paragraphs: [
      ...PRIVACY_THIRD_PARTY_PARAGRAPHS,
      "The receipt checker reads the Solana network and each source's own published data straight from your browser. A graduated coin's page shows a chart from GeckoTerminal, loaded from its site. Your wallet talks to the Solana network through the wallet itself. Each of these services has its own privacy rules.",
    ],
  },
  {
    id: "contact", heading: "Questions",
    paragraphs: [OPERATOR_LINE, `Questions about this page go to ${CONTACT_EMAIL}.`],
  },
];

/** For the merge reviewer (WIRING.md): the launch form's line beside the image option, and the footer receipt's one line. */
export const IMAGE_RIGHTS_LINE = "By adding an image, you confirm that you have the right to use it. The terms of use say how an image is taken down.";
export const FOOTER_LEGAL_LINE = FOOTER_COPY.legal;   // the footer receipt prints it from siteNav.mjs (static pages and app alike)

/** Every sentence the two pages print, for the copy lint and the plain-English test. */
export const ALL_LEGAL_COPY: string[] = [IMAGE_RIGHTS_LINE, FOOTER_LEGAL_LINE, TERMS_TITLE, TERMS_INTRO, PRIVACY_TITLE, PRIVACY_INTRO, ...[...TERMS_SECTIONS, ...PRIVACY_SECTIONS].flatMap((s) => [s.heading, ...s.paragraphs])];
