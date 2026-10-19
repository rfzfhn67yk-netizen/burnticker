import type { Platform } from "@/lib/burnticker/server";
import type { BurnRule } from "@/lib/burnticker/rules";
import { lookalikeRefusal, mintAdoptionRefusal, sameTickerSentence, type LookalikeExisting, type LookalikeHit } from "@/lib/burnticker/lookalike";
import { freeTickers, isTeamRule } from "@/lib/burnticker/tickerCheck";
import { loadReserved } from "@/lib/burnticker/reservedNames";

/**
 * The launch handler's two growth-batch guards (2026-10-10), in one call so the handler change is one line per side:
 *   · LOOKALIKE: the ticker and name against every Burnticker coin (lookalike.ts) → 409 code "lookalike"; the very same ticker held by
 *     another creator's launched coin or open draft → 409 code "ticker-taken" (prelaunch audit 2026-10-18 A-2), with free tickers that pass;
 *   · NO ADOPTION: a mint given by the caller must be new — not registered, and no account on chain when this host has an RPC to ask
 *     (`p.market`, the read-only connection) → 409 code "mint-exists".
 */
export interface GuardRefusal { status: 409; error: string; extra: { code: "lookalike" | "ticker-taken" | "mint-exists"; hits?: LookalikeHit[]; /** A-2: free tickers that pass this same check */ suggestions?: string[] } }

/** The registered coins as the lookalike check reads them (the bundle route below and the review route, launchPreflight identityRefusals). */
export function lookalikeRows(registry: Pick<Platform["registry"], "tokens" | "lockedRule">): (LookalikeExisting & { rule: Pick<BurnRule, "oracle" | "series"> | null })[] {
  return registry.tokens().map((t) => { let rule: Pick<BurnRule, "oracle" | "series"> | null = null; try { rule = registry.lockedRule(t).rule; } catch { rule = null; } return { ticker: t.ticker, name: t.name, status: t.status, rule, creator: t.creator }; });
}
export async function launchGuardRefusal(p: { registry: Pick<Platform["registry"], "tokens" | "lockedRule" | "tickerTaken" | "tokensByTicker" | "token" | "ownDraft">; market?: Platform["market"] }, c: { ticker: string; name: string; rule: Pick<BurnRule, "oracle" | "series"> | null; mint?: string | null; /** 2026-10-14: the creator's own unfinished draft of this mint is not an adoption */ creator?: string | null; /** review of block M: the wallet whose own draft's ticker is exempt; null = nobody (an unproven claim) */ tickerOwner?: string | null }): Promise<GuardRefusal | null> {
  // prelaunch audit 2026-10-18 A-2: the registry's own ticker check, which also expires stale drafts first (their tickers are free again)
  try { p.registry.tickerTaken(c.ticker); } catch { /* the rows below decide */ }
  const existing = lookalikeRows(p.registry);
  // review of block M: the own-draft exemption only for a creator the caller has proven (tickerOwner); a bare `creator` claim never
  // tells a stranger which wallet owns a draft. Left out, `creator` is used (the registering path, which writes a draft under it).
  const owner = c.tickerOwner === undefined ? c.creator ?? null : c.tickerOwner;
  const look = lookalikeRefusal({ ticker: c.ticker, name: c.name, rule: c.rule, creator: owner }, existing);
  if (look) {
    const taken = look.hits.some((h) => h.how === "same-letters" && h.existing.toUpperCase() === `$${c.ticker.toUpperCase()}`);
    let suggestions: string[] = [];
    try { suggestions = freeTickers(c.ticker, { inUse: (t) => p.registry.tokensByTicker(t), existing, reserved: loadReserved(), creator: owner }, 2, { team: isTeamRule(c.rule), avoid: [c.ticker] }); } catch { suggestions = []; }
    const free = suggestions.length ? ` These tickers are free: ${suggestions.map((x) => `$${x}`).join(" and ")}.` : "";
    const others = [...new Set(look.hits.filter((h) => h.how !== "same-letters" || h.existing.toUpperCase() !== `$${c.ticker.toUpperCase()}`).map((h) => h.reason))];
    const error = taken ? `This launch is refused. ${sameTickerSentence(c.ticker)}${others.length ? ` ${others.join(" ")}` : ""} Please pick another ticker.${free}` : look.reason;
    return { status: 409, error, extra: { code: taken ? "ticker-taken" : "lookalike", hits: look.hits, ...(suggestions.length ? { suggestions } : {}) } };
  }
  if (c.mint) {
    let onChain: boolean | null = null;
    if (p.market) {
      try { const { PublicKey } = await import("@solana/web3.js"); onChain = (await p.market.getAccountInfo(new PublicKey(c.mint))) !== null; } catch { onChain = null; }
    }
    const why = mintAdoptionRefusal({ inRegistry: p.registry.token(c.mint) !== null && !(c.creator && p.registry.ownDraft(c.mint, c.creator)), onChain });
    if (why) return { status: 409, error: why, extra: { code: "mint-exists" } };
  }
  return null;
}

/**
 * Third prelaunch audit 2026-10-19 F04: the refusal for a ticker the registry would not reserve or register (another creator's prepare
 * holds it, or another creator's draft appeared while this prepare ran). The same 409 the guard above gives, with free tickers that pass.
 */
export function tickerTakenRefusal(p: { registry: Pick<Platform["registry"], "tokens" | "lockedRule" | "tokensByTicker" | "tickerReservation"> }, ticker: string, creator: string | null): GuardRefusal {
  let suggestions: string[] = [];
  try {
    const now = Date.now();
    const inUse = (t: string): unknown[] => { const r = p.registry.tickerReservation(t); return [...p.registry.tokensByTicker(t), ...(r && r.expiresAt > now && r.creator !== creator ? [r] : [])]; };
    suggestions = freeTickers(ticker, { inUse, existing: lookalikeRows(p.registry), reserved: loadReserved(), creator }, 2, { avoid: [ticker] }).filter((t) => t !== ticker.toUpperCase());
  } catch { suggestions = []; }
  const free = suggestions.length ? ` These tickers are free: ${suggestions.map((x) => `$${x}`).join(" and ")}.` : "";
  return { status: 409, error: `This launch is refused. ${sameTickerSentence(ticker)} Please pick another ticker.${free}`, extra: { code: "ticker-taken", ...(suggestions.length ? { suggestions } : {}) } };
}
