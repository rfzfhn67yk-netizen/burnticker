import "server-only";
import type { Platform } from "@/lib/burnticker/server";
import { cloneStore, cloneTerms, clonesJson, termSinceFor, type ClonesJson } from "@/lib/burnticker/ops/cloneWatch";

/**
 * KNOWN LOOKALIKES (ChatGPT audit 7 item 2): a mint on the Not Burnticker list, answered as such by /v1/search, the coins search and
 * /v1/verify-mint instead of "No coin matches". Null when the mint is not on the list or the list cannot be read.
 */
export const KNOWN_LOOKALIKE_LINE = "Known lookalike: this is NOT a Burnticker coin.";
export function knownLookalike(p: Pick<Platform, "registry">, mint: string): { kind: "known-lookalike"; mint: string; symbol: string; name: string; line: string; evidence: string[]; real: { ticker: string; mint: string } | null; listUrl: string } | null {
  const m = mint.trim();
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(m)) return null;
  let rows: ClonesJson["clones"];
  try { rows = clonesFor(p).clones; } catch { return null; }
  const c = rows.find((x) => x.mint === m);
  if (!c) return null;
  let real: { ticker: string; mint: string } | null = null;
  try { const t = p.registry.tokens().find((x) => x.ticker.toUpperCase() === c.matched.term.toUpperCase() && x.status !== "draft" && x.status !== "expired"); real = t ? { ticker: t.ticker, mint: t.mint } : null; } catch { real = null; }
  return { kind: "known-lookalike", mint: c.mint, symbol: c.symbol, name: c.name, line: `${KNOWN_LOOKALIKE_LINE}${real ? ` The real $${real.ticker} is ${real.mint}.` : ""}`, evidence: c.evidence, real, listUrl: "/burnticker/not-burnticker" };
}

/** The "Not Burnticker" list from this host's registry database (what the clone watch recorded) — the page and GET /v1/clones. */
export function clonesFor(p: Pick<Platform, "registry">, nowMs = Date.now()): ClonesJson {
  const tokens = p.registry.tokens().filter((t) => t.status !== "expired");
  // QA 11 M12: a token whose pool predates the name it matched is left out (termSinceFor dates each name)
  return clonesJson(cloneStore(p.registry.db), cloneTerms(tokens.filter((t) => t.status !== "draft").map((t) => t.ticker)), new Set(p.registry.tokens().map((t) => t.mint)), nowMs, termSinceFor(tokens));
}
