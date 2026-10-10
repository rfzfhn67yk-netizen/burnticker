import { assertClean, type CopyLintConfig } from "@/lib/launch/copyLint";
import type { DerbyDayJson, DerbyPairJson, DerbyTournamentJson } from "@/lib/burnticker/derby/page";
import type { FetchLike } from "@/lib/burnticker/oracle/types";
import { handleFromLink, JUP_SEARCH_URL, tokensFromJupiter } from "@/lib/burnticker/derby/cross";

/**
 * THE DERBY DAY POST (2026-10-10). One line a day, a report filled from the pair's derby block — never retyped:
 *
 *   Day 12 · WIF 7 – SHIB 5 · $TEAMWIF burned 1% · receipt 5h3K…
 *   @dogwifcoin @shibtoken
 *   Scoreboard: <site>/p/<pairId>/
 *   two memecoins — each rule says what its supply does, not what price does
 *
 * The score is each coin's winning days so far (WIF 7 = $TEAMWIF's burn days); "burned 1%" is the share of its burn pool the winning
 * coin spent buying itself back and burning it (the rule's fraction). A tie says so ("tie · no burn · receipt …"); a withheld window
 * says why ("reading withheld — the cross-read disagreed · no burn"). The @handles are the two communities' X accounts from the
 * Jupiter token list or our coins' registry links, when present. No predictions, no odds, nothing about any coin's next move. Every
 * output goes through the copy lint (assertClean) before it is returned.
 */

export const DERBY_DISCLAIMER = "two memecoins — each rule says what its supply does, not what price does";

const shortSig = (s: string | null | undefined) => (s ? `${s.slice(0, 12)}…` : null);
const pct = (f: number) => `${Math.round(f * 10_000) / 100}%`;

export interface DerbyPostInput {
  pair: Pick<DerbyPairJson, "pairId" | "symbols" | "score" | "selector" | "flip">;
  day: DerbyDayJson;
  tickers: { a: string; b: string };
  /** The rule's fraction per burn (the winning side's), for "burned 1%". */
  fraction: number;
  handles?: string[];
  site?: string | null;
}

/** The score after `day` (wins counted through that day only), from the pair's days. */
export function scoreThrough(days: readonly DerbyDayJson[], through: DerbyDayJson): { a: number; b: number } {
  const upTo = days.filter((d) => d.at <= through.at);
  return { a: upTo.filter((d) => d.winner === "A").length, b: upTo.filter((d) => d.winner === "B").length };
}

export function derbyDayText(i: DerbyPostInput & { days?: readonly DerbyDayJson[] }, cfg?: CopyLintConfig): string {
  const { day, pair, tickers } = i;
  const A = pair.symbols.a, B = pair.symbols.b ?? "";
  const sc = i.days ? scoreThrough(i.days, day) : { a: pair.score.a, b: pair.score.b };
  const head = `Day ${day.day} · ${A} ${sc.a} – ${B} ${sc.b}`;
  const sig = shortSig(day.winner === "A" ? day.receipts.a?.signature : day.winner === "B" ? day.receipts.b?.signature : day.receipts.a?.signature ?? day.receipts.b?.signature);
  const what = day.status === "withheld" ? `reading withheld — ${/cross-read/.test(day.reason ?? "") ? "the cross-read disagreed" : "a value was missing at the boundary"} · no burn`
    : day.winner === "tie" ? `tie · no burn${sig ? ` · receipt ${sig}` : ""}`
    : `$${day.winner === "A" ? tickers.a : tickers.b} burned ${pct(i.fraction)}${sig ? ` · receipt ${sig}` : " · receipt pending"}`;
  const lines = [`${head} · ${what}`, (i.handles ?? []).filter((h) => /^@[A-Za-z0-9_]{1,15}$/.test(h)).join(" ") || null, i.site !== undefined ? `Scoreboard: ${(i.site ?? "{SITE_URL}").replace(/\/$/, "")}/p/${pair.pairId}/` : null, DERBY_DISCLAIMER].filter((x): x is string => !!x);
  return assertClean(lines.join("\n"), "the derby day post", cfg);
}

/** The bracket's round post: "Round 2 · WIF 4 – 3 BONK (WIF advances) · SHIB 5 – 2 PEPE (SHIB advances)". */
export function bracketRoundText(t: Pick<DerbyTournamentJson, "id" | "title" | "rounds">, round: number, cfg?: CopyLintConfig): string {
  const r = t.rounds[round];
  if (!r) throw new Error(`no round ${round + 1}`);
  const ms = r.matches.filter((m) => m.a && m.b).map((m) => `${m.a!.symbol} ${m.winsA} – ${m.winsB} ${m.b!.symbol}${m.winner !== null ? ` (${m.winner === m.a!.slot ? m.a!.symbol : m.b!.symbol} advances${m.tiebreak === "cumulative" ? " on the tiebreak" : m.tiebreak === "lower-slot" ? " on the seed" : ""})` : ""}`);
  return assertClean([`${t.title} · ${r.final ? "Final" : `Round ${round + 1}`}`, ...ms, "Losing fan coins retire: no further readings.", DERBY_DISCLAIMER].join("\n"), "the bracket round post", cfg);
}

/** The community handles for an underlying: its X link in Jupiter's token list (by mint), when present. */
export async function jupiterHandle(fetchImpl: FetchLike, mint: string | null): Promise<string | null> {
  if (!mint) return null;
  try {
    const res = await fetchImpl(`${JUP_SEARCH_URL}?query=${mint}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const t = tokensFromJupiter(await res.json()).find((x) => x.id === mint);
    return handleFromLink(t?.twitter ?? null);
  } catch { return null; }
}

/** An X handle from a registry token's links (label X / Twitter, or an x.com URL). */
export const registryHandle = (links: readonly { label: string; url: string }[]): string | null => {
  for (const l of links) { const h = handleFromLink(l.url); if (h) return h; }
  return null;
};
