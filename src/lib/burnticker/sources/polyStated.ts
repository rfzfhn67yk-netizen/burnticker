/**
 * POLYMARKET'S STATED SOURCE AND DISPUTE WINDOW (sources-2, 2026-10-12; the owner accepted the recommendation 13:16 Denver: "show
 * Polymarket's stated resolution source + the dispute window on every Polymarket-settled coin; use the stated source as the cross-read
 * where an adapter exists"). Pure and client-safe: the launch page, the coin page and describe.ts read the same answer.
 *
 * resolutionSource  the market description's resolution-source sentence ("The primary resolution source will be official information
 *                   from MLB (https://www.mlb.com/) ...") as `text` (verbatim, URLs kept; data for the details view), a short `phrase`
 *                   for the coin text (no links, no "will"), and `publisher` when the sentence names a publisher the catalogue has an
 *                   adapter for (STATED_PUBLISHERS). `crossRead` is set only when that adapter reads the market's kind of fact (the
 *                   market's Gamma tags meet the publisher's `factTags`): MLB for a baseball market, the Federal Register for an
 *                   executive-order market. `refused` names a refused subject the sentence leans on (Truth Social: never a source).
 *                   Gamma's own `resolutionSource` field (a bare URL, often empty) is used when the description has no such sentence.
 * finalAfter        the dispute window before Polymarket's UMA adapter can report the payout on chain. Gamma's `customLiveness` (the
 *                   seconds the adapter set for this question; 0 = the default) when it is above 0, else the documented default of
 *                   7,200 seconds (Polymarket/uma-ctf-adapter README: "a defined liveness period (currently about 2 hours)";
 *                   UmaCtfAdapter.sol: "If 0, the default liveness period of 2 hours is used"). A first dispute resets the request
 *                   (another window); a second goes to UMA's vote, which "will return data after a 48 - 72 hour period".
 *
 * THE SETTLEMENT IS UNCHANGED: a coin settles only on the payout the Conditional Tokens contract records (oracle/polymarket.ts
 * resolvePolymarket). A proposal inside its dispute window is not a payout; the keeper reads "not resolved" and waits.
 */

export interface StatedPublisher { id: string; name: string; re: RegExp; sources: readonly string[]; factTags: readonly string[]; crossRead: string }
/** Publishers a Polymarket description may name that the catalogue has an adapter for. */
export const STATED_PUBLISHERS: readonly StatedPublisher[] = [
  { id: "mlb", name: "MLB", re: /\bMLB\b|\bmlb\.com\b|Major League Baseball/i, sources: ["mlb.statsapi"], factTags: ["mlb", "baseball", "world-series", "mlb-playoffs"], crossRead: "MLB's official feed" },
  { id: "nba", name: "the NBA", re: /\bNBA\b|\bnba\.com\b/i, sources: ["nba.cdn"], factTags: ["nba", "basketball", "nba-finals", "nba-playoffs"], crossRead: "the NBA's official feed" },
  { id: "nhl", name: "the NHL", re: /\bNHL\b|\bnhl\.com\b/i, sources: ["nhl.score"], factTags: ["nhl", "hockey", "stanley-cup"], crossRead: "the NHL's official scores" },
  { id: "bls", name: "the Bureau of Labor Statistics", re: /Bureau of Labor Statistics|\bbls\.gov\b|\bBLS\b/i, sources: ["bls.CUSR0000SA0", "bls.LNS14000000", "bls.eggs"], factTags: ["cpi", "inflation", "unemployment", "jobs-report", "egg-prices"], crossRead: "the Bureau of Labor Statistics release" },
  { id: "fed", name: "the Federal Reserve", re: /Federal Reserve|federalreserve\.gov|\bFOMC\b|stlouisfed\.org|\bFRED\b/i, sources: ["fred.UNRATE", "fred.CPIAUCSL", "fred.GFDEBTN"], factTags: ["cpi", "inflation", "unemployment"], crossRead: "the St. Louis Fed's FRED series" },
  { id: "treasury", name: "the U.S. Treasury", re: /\bTreasury\b|fiscaldata\.treasury\.gov/i, sources: ["treasury.debt"], factTags: ["national-debt", "debt-ceiling", "us-debt"], crossRead: "the Treasury's Debt to the Penny data" },
  { id: "nws", name: "the National Weather Service", re: /National Weather Service|\bweather\.gov\b|\bNOAA\b/i, sources: ["nws.cli"], factTags: ["weather", "temperature", "climate-science"], crossRead: "the National Weather Service's climate report" },
  { id: "federal-register", name: "the Federal Register", re: /Federal Register|federalregister\.gov/i, sources: ["fedreg.eo", "fedreg.finalRules"], factTags: ["executive-orders", "executive-order"], crossRead: "the Federal Register's count of executive orders" },
  { id: "fec", name: "the Federal Election Commission", re: /Federal Election Commission|\bfec\.gov\b|\bFEC\b/i, sources: ["fec.reports"], factTags: ["fundraising", "campaign-finance"], crossRead: "the FEC's filed reports" },
  { id: "usgs", name: "the U.S. Geological Survey", re: /Geological Survey|\busgs\.gov\b|\bUSGS\b/i, sources: ["usgs.quakes"], factTags: [], crossRead: "the USGS earthquake catalogue" },
  { id: "launch-library", name: "Launch Library 2", re: /Launch Library|thespacedevs\.com/i, sources: ["ll2.provider", "ll2.launch"], factTags: ["space", "spacex", "rocket-launch"], crossRead: "Launch Library 2" },
  { id: "github", name: "GitHub", re: /\bGitHub\b|\bgithub\.com\b/i, sources: ["github.releases", "github.milestone"], factTags: [], crossRead: "GitHub's repository data" },
];
/** Subjects that are never a source; a stated source naming one is marked refused (config/burnticker/refuse.json refuses the market). */
const REFUSED_SUBJECTS: readonly { id: string; re: RegExp }[] = [{ id: "truth-social", re: /truth ?social|truthsocial\.com/i }];

export interface StatedSource {
  /** The resolution-source clause, verbatim (URLs kept), or Gamma's resolutionSource field; null when the market states none. */
  text: string | null;
  /** The clause as coin text: no URLs, no bare domains, at most 160 characters; the publisher's name when one is recognised. */
  phrase: string | null;
  publisher: { id: string; name: string; sources: string[] } | null;
  /** The adapter that reads this market's kind of fact from the stated publisher: the cross-read, or null. */
  crossRead: { publisher: string; sources: string[]; text: string } | null;
  refused: string | null;
}
export interface FinalAfter { seconds: number; basis: "market" | "default"; text: string; ifDisputed: string; status: string | null; proposals: number }

export const UMA_DEFAULT_LIVENESS_S = 7_200;
export const UMA_DVM_HOURS = "48 to 72 hours";

const URL_RE = /https?:\/\/[^\s)"'”]+/g;
const BARE_DOMAIN = /\b[\w-]+(?:\.[\w-]+)*\.(?:com|org|net|gov|io|xyz|app|co)\b\/?/gi;
const LEAD = /^(?:the )?(?:primary )?resolution sources? (?:for this market )?(?:will be|is|are|shall be)\s+/i;

/** The clause after "the resolution source ... is/will be", from the first sentence that names one. URLs survive sentence splitting. */
export function statedClause(description: string | null | undefined): string | null {
  if (!description) return null;
  const urls: string[] = [];
  const masked = description.replace(URL_RE, (u) => { const end = /[.,;:]+$/.exec(u)?.[0] ?? ""; urls.push(u.slice(0, u.length - end.length)); return `⟦${urls.length - 1}⟧${end}`; });
  const sentences = masked.split(/(?<=[.!?])\s+|\n+/).map((x) => x.trim()).filter(Boolean);
  const s = sentences.find((x) => /resolution sources? (?:for this market )?(?:will be|is|are|shall be)\b/i.test(x)) ?? null;
  if (!s) return null;
  const i = s.search(/(?:the )?(?:primary )?resolution sources? (?:for this market )?(?:will be|is|are|shall be)\s+/i);
  const clause = s.slice(i).replace(LEAD, "").replace(/[.\s]+$/, "");
  return clause.replace(/⟦(\d+)⟧/g, (_m, n) => urls[Number(n)]).trim() || null;
}

/** The clause as coin text: links and bare domains out, "official information from" kept as the market says it, trimmed to 160. */
export function statedPhrase(clause: string): string {
  let p = clause.replace(URL_RE, " ").replace(BARE_DOMAIN, " ").replace(/\(\s*\)/g, " ").replace(/\s+found at\s*(?=[,;]|$)/gi, " ").replace(/\s+([,;])/g, "$1").replace(/\s{2,}/g, " ").trim();
  p = p.replace(/;\s*however,?\s*/i, ", and ").replace(/\bwill\b/gi, "may").replace(/[,;\s]+$/, "");
  if (p.length > 160) p = `${p.slice(0, 157).replace(/\s+\S*$/, "")}`;
  return p;
}

/** The stated source of one market: its description's clause (else Gamma's field), the recognised publisher, the cross-read, refusals. */
export function statedSource(m: { description?: string | null; resolutionSource?: string | null; tags?: readonly string[] }, eventDescription: string | null = null): StatedSource {
  const clause = statedClause(m.description ?? eventDescription) ?? (m.resolutionSource && m.resolutionSource.trim() ? m.resolutionSource.trim() : null);
  if (!clause) return { text: null, phrase: null, publisher: null, crossRead: null, refused: null };
  const whole = `${clause} ${m.resolutionSource ?? ""}`;
  const refused = REFUSED_SUBJECTS.find((r) => r.re.test(`${whole} ${m.description ?? eventDescription ?? ""}`))?.id ?? null;
  const pub = refused ? null : STATED_PUBLISHERS.find((p) => p.re.test(whole)) ?? null;
  const tags = new Set(m.tags ?? []);
  const crossRead = pub && pub.factTags.some((t) => tags.has(t)) ? { publisher: pub.id, sources: [...pub.sources], text: pub.crossRead } : null;
  const phrase = pub ? pub.name : /^https?:\/\//.test(clause) ? null : statedPhrase(clause);
  return { text: clause, phrase: phrase || null, publisher: pub ? { id: pub.id, name: pub.name, sources: [...pub.sources] } : null, crossRead, refused };
}

/** The dispute window: the market's own liveness when Gamma reports one above 0, else UMA's documented 2-hour default. */
export function finalAfter(m: { customLiveness?: number | null; umaResolutionStatus?: string | null; umaStatuses?: readonly string[] }): FinalAfter {
  const custom = typeof m.customLiveness === "number" && m.customLiveness > 0 ? Math.round(m.customLiveness) : null;
  const seconds = custom ?? UMA_DEFAULT_LIVENESS_S;
  return { seconds, basis: custom ? "market" : "default", text: windowWords(seconds), ifDisputed: `A disputed proposal starts a new window. A second dispute goes to UMA's vote, which takes about ${UMA_DVM_HOURS}.`, status: m.umaResolutionStatus ?? null, proposals: (m.umaStatuses ?? []).filter((x) => x === "proposed").length };
}
/** "about 2 hours", "about 15 minutes". */
export function windowWords(seconds: number): string {
  if (seconds < 3_600) { const n = Math.max(1, Math.round(seconds / 60)); return `about ${n} minute${n === 1 ? "" : "s"}`; }
  const h = Math.round((seconds / 3_600) * 10) / 10;
  return `about ${h} hour${h === 1 ? "" : "s"}`;
}

/** The describe.ts sentences for a Polymarket-settled coin (lint-clean; test/burntickerSources2.test.ts). */
export function statedSentences(s: { phrase: string | null; crossRead: { text: string } | null }, f: Pick<FinalAfter, "text">): string {
  const said = s.phrase ? `Polymarket states it resolves this from ${s.phrase}.` : "Polymarket does not state a source for this market.";
  const cross = s.crossRead ? ` ${s.crossRead.text[0].toUpperCase()}${s.crossRead.text.slice(1)} is read as a cross-check.` : "";
  return `It settles on Polymarket's on-chain payout. ${said} The result becomes final after the dispute window of ${f.text}.${cross}`;
}
