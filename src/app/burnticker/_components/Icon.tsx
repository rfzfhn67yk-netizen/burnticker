import { SITE_ICONS } from "@/lib/burnticker/siteNav.mjs";

/** One icon from the site's one set (siteNav.mjs SITE_ICONS): inline SVG strokes in the text colour, decorative (the label names it). */
export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths = (SITE_ICONS as Record<string, string[]>)[name] ?? [];
  return (
    <svg className="bt-icon" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {paths.map((d) => <path key={d} d={d} />)}
    </svg>
  );
}
