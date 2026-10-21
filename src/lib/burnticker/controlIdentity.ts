/**
 * HB-171 (seventh pass WZ7-2, HS-66), moved here from elections.ts (which reads files) so the launch page's Elections browse path can use
 * it too (eighth pass HB-196 / WZ8-1 / HS-80). Pure and client-safe.
 */
export interface ControlIdentity { party: "Democratic" | "Republican"; chamber: "Senate" | "House"; year: string | null; phrase: string; name: string; ticker: string }
export function controlIdentity(r: { type: string; title: string; settlesOn: string | null }, o: { label: string; question: string }): ControlIdentity | null {
  if (r.type !== "control") return null;
  const chamber = /\bSenate\b/i.test(r.title) ? "Senate" : /\bHouse\b/i.test(r.title) ? "House" : null;
  const partyOf = (s: string) => (/\bDemocrat/i.test(s) ? "Democratic" : /\bRepublican/i.test(s) ? "Republican" : null);
  const party = partyOf(o.label) ?? partyOf(o.question);
  if (!chamber || !party) return null;
  const year = /\b(20\d\d)\b/.exec(r.title)?.[1] ?? r.settlesOn?.slice(0, 4) ?? null;
  return {
    party, chamber, year,
    phrase: `the ${party} Party wins control of the ${chamber}${year ? ` in the ${year} election` : ""}`,
    name: `${party === "Democratic" ? "Democrats" : "Republicans"} win the ${chamber}`,
    ticker: `${party === "Democratic" ? "DEM" : "REP"}${chamber.toUpperCase()}`,
  };
}
