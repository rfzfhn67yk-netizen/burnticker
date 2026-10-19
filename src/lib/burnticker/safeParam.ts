/**
 * A route param as Next hands it: already decoded once, and never decoded again (audit 2026-10-15 H7, then audit 2026-10-18 A-42).
 * Several handlers decoded params a second time: /burnticker/creator/%25E0 arrives as "%E0", and a second decodeURIComponent threw
 * URIError. H7 made the second decode never throw, but it still ran: /api/burnticker/v1/tokens/%2541 arrives as "%41" and answered
 * "no token called A". A param is now used exactly as Next decoded it; a literal "%" in it stays a "%".
 */
export function safeParam(s: string): string {
  return s;
}
