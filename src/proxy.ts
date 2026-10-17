import { NextResponse, type NextRequest } from "next/server";
import { malformedPath, malformedResponse } from "@/lib/burnticker/malformedPath";

/**
 * THE ONE PROXY (Next 16's name for middleware; prelaunch audit 2026-10-16 F-15). It reads only the request PATH: an address whose
 * percent-escapes do not decode is answered 404 here (malformedPath.ts) instead of the 500 Next's own segment decoding threw. It never
 * reads a body, a header or a cookie, and the matcher sends it only paths that carry a "%" (every other request skips it).
 */
export function proxy(request: NextRequest): Response {
  const raw = new URL(request.url).pathname;
  return malformedPath(raw) ? malformedResponse(raw) : NextResponse.next();
}

export const config = {
  matcher: ["/:path(.*%.*)"],
};
