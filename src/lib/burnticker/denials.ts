/**
 * AUDIT 12 item 9 (2026-10-13): "Not affiliated with any team." was refused in the note as a claim of affiliation. An explicit DENIAL is
 * the opposite of a claim, so the creator text checks (the note's quick local read in guidedLaunch.ts and the server's lint in coinText.ts,
 * which the description already passes through) read the text with its denials taken out. A claim beside a denial is still caught:
 * "Not affiliated with the league, but endorsed by the team" keeps "endorsed". Client-safe, no imports.
 */
const DENIAL = /\b(?:not|never|isn't|is not|aren't|are not|in no way)\s+(?:officially\s+|in any way\s+)?(?:affiliated|endorsed|sponsored|licensed|backed|partnered|associated|connected|verified)(?:\s+(?:with|by|to))?(?:,?\s+(?:or|nor)\s+(?:affiliated|endorsed|sponsored|licensed|backed|partnered|associated|connected|verified)(?:\s+(?:with|by|to))?)*\b/gi;
const NO_TIE = /\b(?:no|without any|without)\s+(?:official\s+)?(?:affiliation|endorsement|sponsorship|partnership)\b|\bunaffiliated\b|\bunofficial\b/gi;
/** The text with its explicit denials blanked out (same length, so positions still line up). */
export const withoutDenials = (text: string): string => text.replace(DENIAL, (m) => " ".repeat(m.length)).replace(NO_TIE, (m) => " ".repeat(m.length));
