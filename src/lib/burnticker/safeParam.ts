/**
 * A route param, decoded at most once and never throwing (audit 2026-10-15 H7). Next hands pages and routes params that are already
 * decoded, and several handlers decoded them again: an address such as /burnticker/creator/%25E0 arrives as "%E0", and a second
 * decodeURIComponent threw URIError, so the page crashed instead of answering "not found". A param that does not decode is used as it is.
 */
export function safeParam(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}
