/**
 * THE SITEMAP MEMO (HB-35, 2026-10-20): the sitemap route keeps its body for ten minutes. It lives here, outside the route module,
 * because a Next route file may export only its handlers and route settings (the type check refuses any other export).
 */
export interface KeptSitemap { at: number; registry: unknown; body: string }
let kept: KeptSitemap | null = null;
export const keptSitemap = (): KeptSitemap | null => kept;
export function keepSitemap(k: KeptSitemap | null): void { kept = k; }
/** For tests. */
export function clearSitemapMemo(): void { kept = null; }
