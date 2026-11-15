/**
 * THE API'S OWN 404 (sixth-pass audit OP6-11: an unknown /api/burnticker path answered the site's HTML 404 page). Any path under
 * /api/burnticker that no route serves lands here (more specific routes always win) and gets a short JSON answer with the docs address.
 */
import { API_NOT_FOUND } from "@/lib/burnticker/contactCopy";

export const dynamic = "force-dynamic";

function notFound(): Response {
  return new Response(JSON.stringify(API_NOT_FOUND), { status: 404, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}

export const GET = notFound, POST = notFound, PUT = notFound, PATCH = notFound, DELETE = notFound, HEAD = notFound;
