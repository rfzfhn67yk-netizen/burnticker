import type { Metadata, Viewport } from "next";
import "./globals.css";
import { SiteHeader } from "@/app/burnticker/_components/SiteHeader";
import { SiteFooter } from "@/app/burnticker/_components/SiteFooter";
import { TabBar } from "@/app/burnticker/_components/TabBar";

const DESCRIPTION = "A memecoin launchpad: coins whose supply burns when a settled real-world event says so — with a receipt for every burn. Not advice.";

export const metadata: Metadata = {
  metadataBase: new URL("https://burnticker.com"),
  title: { default: "Burnticker", template: "%s · Burnticker" },
  description: DESCRIPTION,
  applicationName: "Burnticker",
  icons: { icon: [{ url: "/burnticker/brand/favicon.png", type: "image/png", sizes: "32x32" }], apple: "/burnticker/brand/apple-touch-icon.png" },
  openGraph: { type: "website", siteName: "Burnticker", title: "Burnticker — burns on the news", description: DESCRIPTION, url: "/burnticker", images: [{ url: "/burnticker/brand/og.png", width: 1200, height: 630, alt: "Burnticker — a thermal receipt with the burned amount scorched out of it" }] },
  twitter: { card: "summary_large_image", site: "@burnticker", title: "Burnticker — burns on the news", description: DESCRIPTION, images: ["/burnticker/brand/og.png"] },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "dark light",
  themeColor: [{ media: "(prefers-color-scheme: light)", color: "#f2eee4" }, { media: "(prefers-color-scheme: dark)", color: "#12100e" }],
};

/** Runs before paint: a theme the visitor picked (header switch) wins; otherwise the OS preference decides (globals.css), dark first. */
const THEME_BOOT = "(function(){try{var t=localStorage.getItem('bt-theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t;}catch(e){}})();";

/**
 * THE PUBLIC APP'S ROOT (2026-10-10, the owner: "keep it with the Burnticker branding … none of the meme coin trader stuff carries
 * over"). B1 "thermal receipt": Courier Prime for the receipt voice, Space Grotesk for reading text, the scorched-slip mark, a receipt
 * footer with the disclaimer and the operator line. This file exists only in the public tree (config/public-repo/overlay); it mounts the
 * Burnticker header and footer and nothing else — no providers, sync engines, tickers or another product's navigation.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font -- the static site loads the same families the same way */}
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Courier+Prime:wght@400;700&family=Space+Grotesk:wght@400;500;600;700&display=swap" />
      </head>
      <body className="bt-body">
        <a className="bt-skip" href="#bt-content">Skip to content</a>
        <SiteHeader />
        <div id="bt-content" className="bt-content">{children}</div>
        <SiteFooter />
        <TabBar />
      </body>
    </html>
  );
}
