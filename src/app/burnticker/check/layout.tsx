import type { Metadata } from "next";
import type { ReactNode } from "react";

// website brief §8: a title, description and canonical URL for this client page (the public layout's metadataBase makes them absolute)
const DESCRIPTION = "Where money can go, who can do what, what is not done, and a receipt verifier that runs in your browser on a real devnet burn.";
export const metadata: Metadata = {
  title: "Check this yourself", description: DESCRIPTION, alternates: { canonical: "/burnticker/check" },
  openGraph: { type: "website", siteName: "Burnticker", title: "Burnticker · Check this yourself", description: DESCRIPTION, url: "/burnticker/check", images: [{ url: "https://burnticker.com/burnticker/brand/og-544200bcce.jpg", width: 1200, height: 630, alt: "Burnticker — a thermal receipt with the burned amount scorched out of it" }] },
};

export default function Layout({ children }: { children: ReactNode }) { return children; }
