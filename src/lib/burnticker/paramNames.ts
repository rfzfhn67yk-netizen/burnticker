/**
 * NAMES FOR OPAQUE PARAMETERS (audit item 206, 2026-10-12: "Steam app 730" and "CIK 0000320193" mean nothing to a reader). A parameter's
 * name is shown only when it was read from the publisher itself, with where and when; anything not listed keeps its id ("Steam app
 * 1234"), never a guessed name. Client-safe, no imports.
 *
 *   steam.players:730          Steam's own app details (store.steampowered.com/api/appdetails?appids=730), read 2026-10-13
 *   edgar.8k:0000320193        the SEC's own filing index, the display name on the filings in
 *                              config/burnticker/fixtures/http/edgar.json (read 2026-10-10)
 */
export interface ParamName { name: string; readFrom: string; readAt: string }

export const PARAM_NAMES: Readonly<Record<string, ParamName>> = {
  "steam.players:730": { name: "Counter-Strike 2", readFrom: "https://store.steampowered.com/api/appdetails?appids=730", readAt: "2026-10-13" },
  "edgar.8k:0000320193": { name: "Apple Inc.", readFrom: "https://efts.sec.gov/LATEST/search-index?forms=8-K&ciks=0000320193", readAt: "2026-10-10" },
};

/** The publisher's name for a series' parameter, or null (not read: the id stays). */
export const paramName = (series: string): string | null => PARAM_NAMES[series]?.name ?? null;

const FAMILY: Record<string, string> = { "steam.players": "Steam", "edgar.8k": "SEC filings", "wiki.views": "Wikipedia", "github.stars": "GitHub", "defillama.tvl": "DefiLlama", "github.releases": "GitHub", "github.milestone": "GitHub" };

/**
 * The subject a strip or a heading keeps beside the source (audit item 214): "Steam · Counter-Strike 2", "SEC filings · Apple Inc.",
 * "Wikipedia · Bitcoin", "Steam · app 1234" when the name was never read. Null for a series without a parameter.
 */
export function sourceSubjectLabel(series: string | null | undefined): string | null {
  if (!series) return null;
  const i = series.indexOf(":");
  if (i < 0) return null;
  const fam = series.slice(0, i), p = series.slice(i + 1), head = FAMILY[fam];
  if (!head) return null;
  const name = paramName(series);
  if (name) return `${head} · ${name}`;
  if (fam === "steam.players") return `${head} · app ${p}`;
  if (fam === "edgar.8k") return `${head} · CIK ${p}`;
  if (fam === "wiki.views") return `${head} · ${decodeURIComponent(p).replace(/_/g, " ")}`;
  return `${head} · ${p}`;
}

/**
 * THE EXAMPLE ON A PARAMETERISED CARD (audit item 205): the card shows a source with one parameter filled in (Steam app 730, the
 * Wikipedia article "Bitcoin", the raydium protocol). That parameter is the only one the card's sample was read for; any other choice
 * is checked by its format when it is typed and read live at review before a coin can launch on it. Null for a card without a parameter.
 */
export function paramExampleNote(series: string, param: string | null): string | null {
  if (!param) return null;
  const subject = sourceSubjectLabel(series)?.split(" · ")[1] ?? param;
  return `Shown with one example, ${subject}. Its sample is the only one read for this card. Any other choice is checked when you enter it and read live at review before a coin can launch on it.`;
}
