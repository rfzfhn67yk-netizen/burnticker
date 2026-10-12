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
 *   no access log of visitor addresses                deploy/caddy/Caddyfile ("no access log is configured")
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

export const TERMS_TITLE = "Terms of use";
export const TERMS_INTRO = "These terms cover burnticker.com, its pages and its public API. They are short on purpose. By using the site, you agree to them.";

export const TERMS_SECTIONS: LegalSection[] = [
  {
    id: "what-it-is", heading: "What Burnticker is",
    paragraphs: [
      "Burnticker is a launchpad for Solana memecoins whose coins burn on public results. Each coin has one locked rule. When a result settles that rule, the coin's own trading fees buy it back on its own pool, and a program burns what they bought.",
      "The platform never trades, never takes an order and never pays anything to anyone. It holds no coins and no money for anyone.",
      "Coins trade on Raydium, an outside Solana trading service. This site links to it and has no control over it.",
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

export const PRIVACY_TITLE = "Privacy";
export const PRIVACY_INTRO = "Burnticker has no accounts and keeps as little as it can. This page lists everything the site keeps and where it is kept.";

export const PRIVACY_SECTIONS: LegalSection[] = [
  {
    id: "browser", heading: "In your browser",
    paragraphs: [
      "Your theme, light or dark, is kept in this browser's local storage. So is your watchlist of coins and results. Neither is ever sent to the site.",
      "If you connect a wallet, the wallet connector remembers which wallet you chose, so the connection comes back when you reload. It is kept in the same local storage.",
      "While a tab is open, it remembers the Coins tab you picked and, on the launch page, your unfinished form and any transaction your wallet signed, so a reload does not lose them. Closing the tab clears them.",
      "Clearing this site's data in your browser removes all of it.",
    ],
  },
  {
    id: "server", heading: "On the server",
    paragraphs: [
      "The site sets no cookies and asks for no name and no email address. The site holds no accounts and no tokens for anyone.",
      "The web server keeps no log of visitors' addresses. To limit how often one visitor can call the API, the app counts requests per address in memory. That count is never written down and is gone when the app restarts.",
      "When a search on the launch page finds nothing, or finds cards and none is used, the site keeps the search words and the hour, without an address, an id or a cookie. This shows which results people look for and cannot find.",
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
