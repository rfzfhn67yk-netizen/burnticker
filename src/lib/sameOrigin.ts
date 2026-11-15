/**
 * SAME-ORIGIN CHECK for a mutating route (2026-09-29, security audit AJ F1–F3; moved to its own module 2026-10-09 so the public
 * Burnticker routes can use it without importing the private app's owner-action gate).
 *
 * `Sec-Fetch-Site` is `same-origin` or `none` (the browser sets it and a page cannot forge it), or, for a caller that is not a
 * browser (a runner, curl), an `Origin` header whose host is the request's Host. Neither present → refused. A cross-site page can
 * set neither, so a CSRF POST from any other website fails here before the body is read.
 */
export function isSameOrigin(request: Request): boolean {
  const site = (request.headers.get("sec-fetch-site") ?? "").toLowerCase();
  if (site === "same-origin" || site === "none") return true;
  if (site) return false;   // cross-site or same-site, said by the browser itself
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const host = (request.headers.get("host") ?? "").toLowerCase();
  if (!host) return false;
  try { const u = new URL(origin); return (u.protocol === "http:" || u.protocol === "https:") && u.host.toLowerCase() === host; } catch { return false; }
}
