"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { footerVariant } from "./nav";

/** The full receipt-slip footer or the one-line footer, by page (site audit #17; nav.ts footerVariant). Both are rendered on the server. */
export function FooterSwitch({ full, compact }: { full: ReactNode; compact: ReactNode }) {
  return <>{footerVariant(usePathname()) === "compact" ? compact : full}</>;
}
