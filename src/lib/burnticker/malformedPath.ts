/**
 * MALFORMED ADDRESSES ANSWER 404, NOT 500 (prelaunch audit 2026-10-16 F-15). A path whose percent-escapes do not decode
 * (/burnticker/t/%E0, /api/burnticker/v1/tokens/%E0) made Next itself throw URIError while decoding the dynamic segment, before any of
 * our handlers ran (safeParam.ts only helps once a handler has the param), so the server answered a raw 500. The proxy (src/proxy.ts)
 * asks this module first: a path that does not decode is answered here with a plain 404, JSON under /api/. Client-safe and pure.
 */
export function malformedPath(rawPathname: string): boolean {
  if (!rawPathname.includes("%")) return false;
  for (const seg of rawPathname.split("/")) {
    if (!seg.includes("%")) continue;
    try { decodeURIComponent(seg); } catch { return true; }
  }
  return false;
}

export const MALFORMED_PATH_SENTENCE = "There is no page at this address. Part of it is not valid percent-encoding.";

/** The 404 a malformed path gets: JSON for the API, plain text for pages. Never cached long, never indexed. */
export function malformedResponse(rawPathname: string): Response {
  const api = rawPathname.startsWith("/api/");
  return new Response(api ? JSON.stringify({ error: MALFORMED_PATH_SENTENCE, code: "malformed-path" }) : `${MALFORMED_PATH_SENTENCE}\n`, {
    status: 404,
    headers: { "content-type": api ? "application/json; charset=utf-8" : "text/plain; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex", "x-content-type-options": "nosniff" },
  });
}
