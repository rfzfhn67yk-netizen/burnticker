import type { Metadata } from "next";
import type { ReactNode } from "react";
import { withShareCard } from "@/lib/burnticker/pageMeta";

// ChatGPT audit 7 item 27: this client page was titled only "Burnticker", with the site-wide description and no canonical URL
const DESCRIPTION = "The developer fee ledger: every fee the operator's wallet received, read from chain, and what the operator spends it on.";
export const metadata: Metadata = withShareCard({ title: "Fee ledger", description: DESCRIPTION, alternates: { canonical: "/burnticker/fees/ledger" } });

export default function Layout({ children }: { children: ReactNode }) { return children; }
