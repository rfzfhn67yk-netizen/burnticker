"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { footerVariant } from "./nav";
import { FOOTER_COPY } from "@/lib/burnticker/siteNav.mjs";

/** The full receipt-slip footer or the one-line footer, by page (site audit #17; nav.ts footerVariant). Both are rendered on the server. */
export function FooterSwitch({ full, compact }: { full: ReactNode; compact: ReactNode }) {
  const v = footerVariant(usePathname());
  if (v === "short") return (
    // the receipt's first block, the rest one click away (every line is still in the page)
    <div className="bt-footer-short" data-footer="short">
      <p className="bt-slip-text bt-slip-never"><b>{FOOTER_COPY.never}</b> <b>Not advice.</b> {FOOTER_COPY.notAdvice}</p>
      <details><summary>Show the full receipt</summary>{full}</details>
    </div>
  );
  return <>{v === "compact" ? compact : full}</>;
}
