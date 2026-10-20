import { NextResponse, type NextRequest } from "next/server";
import { malformedPath, malformedResponse } from "@/lib/burnticker/malformedPath";
import { NO_SUCH_COIN_PATH, coinPageServedSafely, coinSegmentOf } from "@/lib/burnticker/coinPagePath";

/**
 * THE ONE PROXY (Next 16's name for middleware; prelaunch audit 2026-10-16 F-15). It reads only the request PATH: an address whose
 * percent-escapes do not decode is answered 404 here (malformedPath.ts) instead of the 500 Next's own segment decoding threw. It never
 * reads a body, a header or a cookie. The matcher sends it only paths that carry a "%" and coin pages (/burnticker/t/<one segment>).
 *
 * HB-100 reopened (hourly run 11): a coin page for a coin this site does not have is rewritten to an address no route matches, so Next
 * renders the /burnticker 404 copy and its links on the server under a 404 (a notFound() thrown while rendering sent Next's bare error
 * document, with the words only in the client payload). HB-152 (hourly run 13): the gate is imported dynamically and reads the registry
 * read-only under a 300 ms budget; any failure or delay serves the page (coinPagePath.ts), where the layout's own check still answers.
 */
export async function proxy(request: NextRequest): Promise<Response> {
  const raw = new URL(request.url).pathname;
  if (malformedPath(raw)) return malformedResponse(raw);
  const seg = coinSegmentOf(raw);
  if (seg !== null && !(await coinPageServedSafely(seg))) return NextResponse.rewrite(new URL(NO_SUCH_COIN_PATH, request.url));
  return NextResponse.next();
}

export const config = {
  matcher: ["/:path(.*%.*)", "/burnticker/t/:ticker"],
};
