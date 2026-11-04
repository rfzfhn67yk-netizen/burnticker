import type { Metadata } from "next";
import LegalSections from "../terms/LegalSections";
import { PRIVACY_INTRO, PRIVACY_SECTIONS, PRIVACY_TITLE } from "@/lib/burnticker/legalCopy";
import { withShareCard } from "@/lib/burnticker/pageMeta";

const DESCRIPTION = "What Burnticker keeps and where: no accounts, no cookies, your theme and watchlist in your own browser, and anonymous search words on the server.";
export const metadata: Metadata = withShareCard({ title: PRIVACY_TITLE, description: DESCRIPTION, alternates: { canonical: "/burnticker/privacy" } });

/** /burnticker/privacy (polish-1, 2026-10-12). The words live in src/lib/burnticker/legalCopy.ts. */
export default function PrivacyPage() {
  return <LegalSections title={PRIVACY_TITLE} intro={PRIVACY_INTRO} sections={PRIVACY_SECTIONS} other={{ href: "/burnticker/terms", label: "Read the terms of use" }} />;
}
