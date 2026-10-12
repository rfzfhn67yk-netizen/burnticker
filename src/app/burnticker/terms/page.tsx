import type { Metadata } from "next";
import LegalSections from "./LegalSections";
import { TERMS_INTRO, TERMS_SECTIONS, TERMS_TITLE } from "@/lib/burnticker/legalCopy";

const DESCRIPTION = "Burnticker's terms of use in plain English: what the service is, what creators are responsible for, how to ask for an image to be taken down, and who runs it.";
export const metadata: Metadata = { title: TERMS_TITLE, description: DESCRIPTION, alternates: { canonical: "/burnticker/terms" } };

/** /burnticker/terms (polish-1, 2026-10-12). The words live in src/lib/burnticker/legalCopy.ts. */
export default function TermsPage() {
  return <LegalSections title={TERMS_TITLE} intro={TERMS_INTRO} sections={TERMS_SECTIONS} other={{ href: "/burnticker/privacy", label: "Read the privacy page" }} />;
}
