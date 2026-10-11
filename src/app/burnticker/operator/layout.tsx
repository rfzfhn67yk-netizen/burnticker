import type { Metadata } from "next";
import type { ReactNode } from "react";

// website brief §8: a title, description and canonical URL for this client page (the public layout's metadataBase makes them absolute)
const DESCRIPTION = "Who runs Burnticker: one independent operator, every operator wallet per network, the signed-statement slot and the never-buys monitor.";
export const metadata: Metadata = {
  title: "Operator", description: DESCRIPTION, alternates: { canonical: "/burnticker/operator" },
  openGraph: { type: "website", siteName: "Burnticker", title: "Burnticker · Operator", description: DESCRIPTION, url: "/burnticker/operator", images: [{ url: "https://burnticker.com/brand/og.png", width: 1200, height: 630, alt: "Burnticker — a thermal receipt with the burned amount scorched out of it" }] },
};

export default function Layout({ children }: { children: ReactNode }) { return children; }
