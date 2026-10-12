import type { Metadata, Viewport } from "next";
import { Courier_Prime, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { SiteHeader } from "@/app/burnticker/_components/SiteHeader";
import { SiteFooter, CompactFooter } from "@/app/burnticker/_components/SiteFooter";
import { FooterSwitch } from "@/app/burnticker/_components/FooterSwitch";
import { TabBar } from "@/app/burnticker/_components/TabBar";
// Runs before paint: a theme the visitor picked (header switch, shared with the static pages) wins; otherwise the OS preference decides.
import { THEME_BOOT } from "@/app/burnticker/_components/theme";
import { launchAvailability } from "@/lib/burnticker/creatorLaunches";

// site audit #19 (2026-10-11): the two families are self-hosted by next/font (one same-origin stylesheet, font-display swap, no request to
// Google from a visitor's browser); globals.css reads them through these variables
const mono = Courier_Prime({ weight: ["400", "700"], subsets: ["latin"], display: "swap", variable: "--font-courier-prime" });
const sans = Space_Grotesk({ weight: ["400", "500", "600", "700"], subsets: ["latin"], display: "swap", variable: "--font-space-grotesk" });

/**
 * BT-21 (2026-10-11): search and social previews follow the host's launch state at request time. While creator launches are closed they
 * say so and never invite launching; when the host opens them, the preview says launches are open. One flag: creatorLaunches.ts.
 */
const TITLE = "Burnticker — coins that burn on real-world results, with receipts";
const DESCRIPTION_CLOSED = "Coins that burn on real-world results, with receipts. Creator launches are closed for now. You can inspect a real devnet burn receipt. These are memecoins: the rule says what supply does, not what price does. Not advice.";
const DESCRIPTION_OPEN = "Coins that burn on real-world results, with receipts. Creator launches are open on this host. You can inspect a real devnet burn receipt first. These are memecoins: the rule says what supply does, not what price does. Not advice.";

export async function generateMetadata(): Promise<Metadata> {
  const description = launchAvailability(process.env).open ? DESCRIPTION_OPEN : DESCRIPTION_CLOSED;
  return {
    metadataBase: new URL("https://burnticker.com"),
    title: { default: "Burnticker", template: "%s · Burnticker" },
    description,
    applicationName: "Burnticker",
    icons: { icon: [{ url: "/burnticker/brand/favicon.png", type: "image/png", sizes: "32x32" }], apple: "/burnticker/brand/apple-touch-icon.png" },
    openGraph: { type: "website", siteName: "Burnticker", title: TITLE, description, url: "/burnticker", images: [{ url: "/burnticker/brand/og.png", width: 1200, height: 630, alt: "Burnticker — a thermal receipt with the burned amount scorched out of it" }] },
    twitter: { card: "summary_large_image", site: "@BurnTicker", title: TITLE, description, images: ["/burnticker/brand/og.png"] },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // dark is the default whatever the OS prefers (review item 17, 2026-10-12); the header switch turns on the paper theme
  colorScheme: "dark",
  themeColor: "#12100e",
};


/**
 * THE PUBLIC APP'S ROOT (2026-10-10, the owner: "keep it with the Burnticker branding … none of the meme coin trader stuff carries
 * over"). B1 "thermal receipt": Courier Prime for the receipt voice, Space Grotesk for reading text, the scorched-slip mark, a receipt
 * footer with the disclaimer and the operator line. This file exists only in the public tree (config/public-repo/overlay); it mounts the
 * Burnticker header and footer and nothing else — no providers, sync engines, tickers or another product's navigation.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${mono.variable} ${sans.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body className="bt-body">
        <a className="bt-skip" href="#bt-content">Skip to content</a>
        <SiteHeader />
        <div id="bt-content" className="bt-content">{children}</div>
        <FooterSwitch full={<SiteFooter />} compact={<CompactFooter />} />
        <TabBar />
      </body>
    </html>
  );
}
