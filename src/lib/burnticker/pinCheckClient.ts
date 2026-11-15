/**
 * WHERE THE BROWSER READS A COIN'S PINNED METADATA FOR ITS OWN CHECK (prelaunch audit 2026-10-18 A-28). The coin page's second check
 * fetched the Arweave gateway straight from the browser, and that fetch failed on every page (net::ERR_SSL_PROTOCOL_ERROR), so it
 * always printed that the browser could not reach the gateway. The browser now reads the same bytes through this site's own route
 * (GET /api/burnticker/pin-check?mint=…&raw=1: bounded, kept per address, rate-limited) and hashes them itself against the sha256
 * recorded at launch. A coin with no mint on hand (an older caller) still reads the gateway. Client-safe.
 */
export function pinnedFileHref(p: { mint?: string; metadataUri: string | null }): string {
  return p.mint ? `/api/burnticker/pin-check?mint=${encodeURIComponent(p.mint)}&raw=1` : (p.metadataUri ?? "");
}

/** The line when the file this page read again through this site hashes to the recorded sha256 and carries the locked description. */
export const PIN_REREAD_OK_LINE = "This page read the file again through this site, and it matches the recorded hash and the locked description.";
/** The line when this site's check passed and the browser's own read of the file did not answer. */
export const PIN_HOST_ONLY_LINE = "This site read the pinned file and it matches the locked description. This page could not read the file a second time just now.";
