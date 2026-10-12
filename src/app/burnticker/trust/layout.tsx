import type { Metadata } from "next";
import type { ReactNode } from "react";

// website brief §8: a title, description and canonical URL for this client page (the public layout's metadataBase makes them absolute)
const DESCRIPTION = "What the operator can and cannot do, in one place. It covers the deployment, the programs, who signs readings, who can approve an upgrade and how long it must wait, the reviews, the fees and every wallet, read from the chain where possible.";
export const metadata: Metadata = {
  title: "Trust", description: DESCRIPTION, alternates: { canonical: "/burnticker/trust" },
  openGraph: { type: "website", siteName: "Burnticker", title: "Burnticker · Trust", description: DESCRIPTION, url: "/burnticker/trust", images: [{ url: "https://burnticker.com/brand/og.png", width: 1200, height: 630, alt: "Burnticker — a thermal receipt with the burned amount scorched out of it" }] },
};

export default function Layout({ children }: { children: ReactNode }) { return children; }
