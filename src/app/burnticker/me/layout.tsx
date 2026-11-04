import type { Metadata } from "next";
import type { ReactNode } from "react";
import { withShareCard } from "@/lib/burnticker/pageMeta";

// website-13 (2026-10-12): the wallet provider moved to the app shell (ShellWalletProviders, mounted once by the root layout), so "Your
// coins" reads the same connection as the header's "Connect wallet". This layout only names the page.
export const metadata: Metadata = withShareCard({ title: "Your coins", description: "Connect a wallet to see the coins it created on Burnticker, with each coin's status and receipts. The page sends the wallet's public address to look them up. This site's server does not keep it.", alternates: { canonical: "/burnticker/me" }, robots: { index: false } });

export default function CreatorLayout({ children }: { children: ReactNode }) {
  return children;
}
