/**
 * CAMPAIGN LINKS (campaign readiness 2026-10-19, item 7). A link shared on X often carries utm_source, utm_medium, utm_campaign (any
 * utm_*) or ref. Those parameters are for the sender's own counting: no page on this site reads them, so they never change what a page
 * answers (no 404, no lost launch draft), and a page's canonical address never carries them. Client-safe.
 */
export const isTrackingParam = (name: string): boolean => /^utm_[a-z0-9_]*$/i.test(name) || name.toLowerCase() === "ref";

/** The same address without any tracking parameter (a path with a query, or an absolute URL); the hash is kept. */
export function withoutTrackingParams(href: string): string {
  const abs = /^[a-z][a-z0-9+.-]*:\/\//i.test(href);
  let u: URL;
  try { u = new URL(href, "https://burnticker.invalid"); } catch { return href; }
  for (const k of [...u.searchParams.keys()]) if (isTrackingParam(k)) u.searchParams.delete(k);
  const q = u.searchParams.toString();
  const rest = `${u.pathname}${q ? `?${q}` : ""}${u.hash}`;
  return abs ? `${u.origin}${rest}` : rest;
}

/** Whether an address carries any tracking parameter. */
export const hasTrackingParams = (href: string): boolean => {
  try { return [...new URL(href, "https://burnticker.invalid").searchParams.keys()].some(isTrackingParam); } catch { return false; }
};
