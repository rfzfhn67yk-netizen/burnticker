import type { Metadata } from "next";
import type { ReactNode } from "react";
import { WalletProviders } from "./WalletProviders";

// website brief §8: the launch page's title, description and canonical (a server layout); the wallet providers stay client-side.
const DESCRIPTION = "Burnticker's launch page. It says whether creator launches are open on this site, and they are closed before launch. It also explains what a coin is: one locked rule, burns paid for by the coin's own trading fees, and a receipt for every burn.";
export const metadata: Metadata = {
  title: "Launch", description: DESCRIPTION, alternates: { canonical: "/burnticker/launch" },
  openGraph: { type: "website", siteName: "Burnticker", title: "Burnticker · Launch", description: DESCRIPTION, url: "/burnticker/launch", images: [{ url: "https://burnticker.com/brand/og.png", width: 1200, height: 630, alt: "Burnticker — a thermal receipt with the burned amount scorched out of it" }] },
};

export default function LaunchLayout({ children }: { children: ReactNode }) {
  return <WalletProviders>{children}</WalletProviders>;
}
