import type { Metadata } from "next";

/**
 * THE SHARE CARD EVERY PAGE CARRIES (owner's UX walkthrough, 2026-10-18).
 *
 * The image: /brand/og.png was 603 KB, sent `no-store` by the static site, and was the og:image of eight pages. OG_IMAGE is the same
 * design as a 1200 x 630 JPEG of about 110 KB, served by the app from /burnticker/brand/ under a name that carries its own hash, so it
 * can be kept for a year (next.config `headers()`, OG_IMAGE_CACHE). A new design gets a new file and a new name.
 *
 * The words: a page that sets no openGraph block inherits the root layout's, so 21 pages shared as "/burnticker" with the site's
 * generic title and description. withShareCard builds a page's openGraph and twitter blocks from its own title, description and
 * canonical address, so a shared link shows that page.
 */
export const OG_IMAGE_FILE = "og-544200bcce.jpg";
export const OG_IMAGE_PATH = `/burnticker/brand/${OG_IMAGE_FILE}`;
export const OG_IMAGE = { url: `https://burnticker.com${OG_IMAGE_PATH}`, width: 1200, height: 630, type: "image/jpeg", alt: "Burnticker: a thermal receipt with the burned amount scorched out of it" } as const;
/** The hashed image never changes under its name: a year, immutable. */
export const OG_IMAGE_CACHE = "public, max-age=31536000, immutable";
export function ogImageHeaderRule(): { source: string; headers: { key: string; value: string }[] } {
  return { source: OG_IMAGE_PATH, headers: [{ key: "Cache-Control", value: OG_IMAGE_CACHE }] };
}

const SITE = "Burnticker";
/** The page's own title as a string (a `{ absolute }` title is used as written). */
function titleOf(t: Metadata["title"]): string | null {
  if (typeof t === "string") return t;
  if (t && typeof t === "object") { const o = t as { absolute?: string; default?: string }; return o.absolute ?? o.default ?? null; }
  return null;
}

/** A page's metadata with its own share card: og:url is its canonical address, the title and description are its own. */
export function withShareCard(m: Metadata): Metadata {
  const t = titleOf(m.title);
  const title = t ? (t.includes(SITE) ? t : `${t} · ${SITE}`) : SITE;
  const description = typeof m.description === "string" ? m.description : undefined;
  const canonical = m.alternates?.canonical;
  const url = typeof canonical === "string" ? canonical : canonical instanceof URL ? canonical.toString() : undefined;
  return {
    ...m,
    openGraph: { type: "website", siteName: SITE, title, ...(description ? { description } : {}), ...(url ? { url } : {}), images: [{ ...OG_IMAGE }] },
    twitter: { card: "summary_large_image", site: "@BurnTicker", title, ...(description ? { description } : {}), images: [OG_IMAGE.url] },
  };
}
