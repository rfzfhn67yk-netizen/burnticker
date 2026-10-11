import type { Metadata } from "next";
import type { ReactNode } from "react";

// website brief §8: a title, description and canonical URL for this client page (the public layout's metadataBase makes them absolute)
const DESCRIPTION = "The current status in one place: deployment, programs, signing, upgrade authority and its time lock read from chain, reviews, fees and every wallet.";
export const metadata: Metadata = {
  title: "Trust", description: DESCRIPTION, alternates: { canonical: "/burnticker/trust" },
  openGraph: { type: "website", siteName: "Burnticker", title: "Burnticker · Trust", description: DESCRIPTION, url: "/burnticker/trust", images: [{ url: "https://burnticker.com/brand/og.png", width: 1200, height: 630, alt: "Burnticker — a thermal receipt with the burned amount scorched out of it" }] },
};

export default function Layout({ children }: { children: ReactNode }) { return children; }
