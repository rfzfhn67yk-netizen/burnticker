/**
 * HB-107c (hourly run 8): the candidates step printed "checked against <state>'s certified results from the state election office — the
 * state's election office (U.S. Election Assistance Commission directory)": the settlement text already names the state's office, and
 * the fallback link (config/burnticker/sos.json "fallback", used where no state page is listed) repeated it. The link is named for what it
 * opens, once. Client-safe, no imports.
 */
export const SOS_FALLBACK_LABEL = "the U.S. Election Assistance Commission's list of state election offices";
export function sosLinkLabel(s: { name: string }): string {
  return /^the state's election office \(/.test(s.name) ? SOS_FALLBACK_LABEL : s.name;
}
