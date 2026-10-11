import type { Metadata } from "next";
import type { ReactNode } from "react";
import { WalletProviders } from "./WalletProviders";

// website brief §8: the launch page's title, description and canonical (a server layout); the wallet providers stay client-side.
const DESCRIPTION = "Launch a Burnticker coin: one locked rule, burns paid by the coin's own trading fees, a receipt for every burn. Shows whether creator launches are open on this host before any control.";
export const metadata: Metadata = {
  title: "Launch", description: DESCRIPTION, alternates: { canonical: "/burnticker/launch" },
  openGraph: { type: "website", siteName: "Burnticker", title: "Burnticker · Launch", description: DESCRIPTION, url: "/burnticker/launch", images: [{ url: "https://burnticker.com/brand/og.png", width: 1200, height: 630, alt: "Burnticker — a thermal receipt with the burned amount scorched out of it" }] },
};

export default function LaunchLayout({ children }: { children: ReactNode }) {
  return <WalletProviders>{children}</WalletProviders>;
}
