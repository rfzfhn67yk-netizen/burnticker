"use client";

import { useEffect, useState } from "react";
import { currentTheme, type Theme } from "./theme";
import { CHART_PLACEHOLDER, chartUrlForTheme } from "@/lib/burnticker/coinPage";

/**
 * The GeckoTerminal chart of a coin's pool (prelaunch audit 2026-10-18, A-36 and the blank-box note). The frame loads lazily, so until
 * it scrolls into view the box shows one plain sentence underneath it instead of a blank 420 px panel; the chart, once drawn, covers
 * the sentence. The chart follows the site's theme (light_chart=1 on paper) and redraws when the header switch changes it.
 */
export function PoolChart({ src, title, className }: { src: string; title: string; className: string }) {
  const [theme, setTheme] = useState<Theme>("dark");
  useEffect(() => {
    setTheme(currentTheme());
    const o = new MutationObserver(() => setTheme(currentTheme()));
    o.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => o.disconnect();
  }, []);
  return (
    <div className={`relative ${className}`} data-pool-chart>
      <p className="absolute inset-0 flex items-center justify-center p-4 text-center text-xs text-neutral-500" data-chart-placeholder>{CHART_PLACEHOLDER}</p>
      <iframe title={title} src={chartUrlForTheme(src, theme)} className="relative h-full w-full rounded-lg border border-neutral-800 bg-transparent" loading="lazy" referrerPolicy="no-referrer" allow="clipboard-write" />
    </div>
  );
}
