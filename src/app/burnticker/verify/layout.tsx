import type { Metadata } from "next";
import type { ReactNode } from "react";

// ChatGPT audit 7 item 27: this client page was titled only "Burnticker", with the site-wide description and no canonical URL
const DESCRIPTION = "Paste a mint address to see whether it is a registered Burnticker coin, read from the burn program on chain.";
export const metadata: Metadata = { title: "Verify a mint", description: DESCRIPTION, alternates: { canonical: "/burnticker/verify" } };

export default function Layout({ children }: { children: ReactNode }) { return children; }
