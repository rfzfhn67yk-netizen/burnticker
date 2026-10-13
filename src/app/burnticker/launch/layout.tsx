import type { Metadata } from "next";
import type { ReactNode } from "react";
import { siteLaunchState } from "@/lib/burnticker/launchAvailability";

// website brief §8: the launch page's title, description and canonical (a server layout); the wallet providers stay client-side.
// website-12 (Claude audit 2 item 1): the description reads the one launch-state record at request time, never a typed "closed".
export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const description = `${siteLaunchState(process.env).meta.description} The launch page explains what a coin is: one locked rule, a burn budget from the coin's own trading fees, and a receipt for every burn.`;
  return {
    title: "Launch", description, alternates: { canonical: "/burnticker/launch" },
    openGraph: { type: "website", siteName: "Burnticker", title: "Burnticker · Launch", description, url: "/burnticker/launch", images: [{ url: "https://burnticker.com/brand/og.png", width: 1200, height: 630, alt: "Burnticker — a thermal receipt with the burned amount scorched out of it" }] },
    twitter: { card: "summary_large_image", title: "Burnticker · Launch", description },
  };
}

export default function LaunchLayout({ children }: { children: ReactNode }) {
  // website-13 (2026-10-12): the one wallet provider is the shell's (ShellWalletProviders, mounted by the root layout); SignCard reads it
  // audit 7 item 16: Skip to content, first in the tab order (globals.css .bt-skip shows it on focus), lands on the wizard's <main>
  return <><a className="bt-skip" href="#launch-main" data-skip-link>Skip to content</a>{children}</>;
}
