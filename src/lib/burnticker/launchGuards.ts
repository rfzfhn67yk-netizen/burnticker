import type { Platform } from "@/lib/burnticker/server";
import type { BurnRule } from "@/lib/burnticker/rules";
import { lookalikeRefusal, mintAdoptionRefusal, sameTickerSentence, type LookalikeExisting, type LookalikeHit } from "@/lib/burnticker/lookalike";
import { freeTickers, isTeamRule, minutesUntil, unprovenHoldSentence, type TickerRow } from "@/lib/burnticker/tickerCheck";
import { loadReserved } from "@/lib/burnticker/reservedNames";
import { DRAFT_TTL_MS, UNPROVEN_HOLD_MS, type TokenRow } from "@/lib/burnticker/registry";

/**
 * The launch handler's two growth-batch guards (2026-10-10), in one call so the handler change is one line per side:
 *   · LOOKALIKE: the ticker and name against every Burnticker coin (lookalike.ts) → 409 code "lookalike"; the very same ticker held by
 *     another creator's launched coin or open draft → 409 code "ticker-taken" (prelaunch audit 2026-10-18 A-2), with free tickers that pass;
 *   · NO ADOPTION: a mint given by the caller must be new — not registered, and no account on chain when this host has an RPC to ask
 *     (`p.market`, the read-only connection) → 409 code "mint-exists".
 */
export interface GuardRefusal { status: 409; error: string; extra: { code: "lookalike" | "ticker-taken" | "mint-exists"; hits?: LookalikeHit[]; /** A-2: free tickers that pass this same check */ suggestions?: string[] } }

/**
 * LA-3 (fifth pass, 2026-10-19): the status a row holds a ticker with. A draft whose create never landed (no launch transaction) holds
 * its ticker for DRAFT_TTL_MS from when the prepare wrote it, the same bound registry.expireDrafts applies. The registry expires drafts
 * lazily, and the review route reads the rows without a sweep, so a draft past the bound is read here as "expired" whether or not a
 * sweep has run yet: its ticker is free, and the review's draft-held notice never names it. Inside the bound nothing changes, so the
 * draft's own creator can still finish it.
 */
export const tickerHoldStatus = (t: Pick<TokenRow, "status" | "launchTx" | "createdAt">, now: number = Date.now(), o: { unproven?: boolean; callerProven?: boolean } = {}): TokenRow["status"] => {
  if (t.status !== "draft" || t.launchTx) return t.status;
  if (now - t.createdAt >= DRAFT_TTL_MS) return "expired";
  // B-19 (seventh audit): an unproven draft (registry.ts UNPROVEN_HOLD_MS) never holds against a proven caller, and against anyone else
  // only for its first 15 minutes
  if (o.unproven && (o.callerProven || now - t.createdAt >= UNPROVEN_HOLD_MS)) return "expired";
  return t.status;
};
type UnprovenSource = Partial<Pick<Platform["registry"], "unprovenDraftMints">>;
const unprovenOf = (registry: UnprovenSource): Set<string> => { try { return typeof registry.unprovenDraftMints === "function" ? registry.unprovenDraftMints() : new Set(); } catch { return new Set(); } };
/** The registered coins as the lookalike check reads them (the bundle route below and the review route, launchPreflight identityRefusals). */
export function lookalikeRows(registry: Pick<Platform["registry"], "tokens" | "lockedRule"> & UnprovenSource, now: number = Date.now(), callerProven = false): (LookalikeExisting & { rule: Pick<BurnRule, "oracle" | "series"> | null })[] {
  const unproven = unprovenOf(registry);
  return registry.tokens().map((t) => { let rule: Pick<BurnRule, "oracle" | "series"> | null = null; try { rule = registry.lockedRule(t).rule; } catch { rule = null; } return { ticker: t.ticker, name: t.name, status: tickerHoldStatus(t, now, { unproven: unproven.has(t.mint), callerProven }), rule, creator: t.creator }; });
}
/**
 * B-19: when the only rows holding a ticker against this creator are unproven drafts, the minutes until the last of them stops holding
 * it; null when any other row holds it (or nothing does).
 */
export function unprovenHoldMinutes(registry: Pick<Platform["registry"], "tokens"> & UnprovenSource, ticker: string, creator: string | null, now: number = Date.now()): number | null {
  const unproven = unprovenOf(registry);
  const rows = registry.tokens().filter((t) => t.ticker.toUpperCase() === ticker.toUpperCase() && t.creator !== creator && tickerHoldStatus(t, now, { unproven: unproven.has(t.mint) }) !== "expired");
  if (!rows.length || rows.some((t) => !unproven.has(t.mint) || t.status !== "draft" || t.launchTx)) return null;
  return minutesUntil(Math.max(...rows.map((t) => t.createdAt + UNPROVEN_HOLD_MS)), now);
}
/**
 * B-19 at review (LA7 fix A): the rows holding a ticker as the prepare reads them (tickerHoldStatus with the unproven set), for the
 * review's ticker check. A draft past its 24 hours, or an unproven draft past its 15 minutes, holds nothing; an unproven draft inside
 * its window carries the time its hold ends. The proven caller's own draft is left in: tickerChecks exempts it by creator.
 */
export function heldTickerRows(registry: Pick<Platform["registry"], "tokensByTicker"> & UnprovenSource, ticker: string, now: number = Date.now()): TickerRow[] {
  const unproven = unprovenOf(registry);
  return registry.tokensByTicker(ticker).flatMap((x) => {
    const isUnproven = unproven.has(x.mint), status = tickerHoldStatus(x, now, { unproven: isUnproven });
    if (status === "expired") return [];
    const until = isUnproven && status === "draft" ? x.createdAt + UNPROVEN_HOLD_MS : undefined;
    return [{ mint: x.mint, name: x.name, ticker: x.ticker, rulesJson: x.rulesJson, status, creator: x.creator, ...(until !== undefined ? { unprovenUntil: until } : {}) }];
  });
}
export async function launchGuardRefusal(p: { registry: Pick<Platform["registry"], "tokens" | "lockedRule" | "tickerTaken" | "tokensByTicker" | "token" | "ownDraft"> & UnprovenSource; market?: Platform["market"] }, c: { ticker: string; name: string; rule: Pick<BurnRule, "oracle" | "series"> | null; mint?: string | null; /** 2026-10-14: the creator's own unfinished draft of this mint is not an adoption */ creator?: string | null; /** review of block M: the wallet whose own draft's ticker is exempt; null = nobody (an unproven claim) */ tickerOwner?: string | null; /** B-19: the caller's wallet proved control and holds the launch cost, so unproven drafts do not hold against it */ callerProven?: boolean }): Promise<GuardRefusal | null> {
  // prelaunch audit 2026-10-18 A-2: the registry's own ticker check, which also expires stale drafts first (their tickers are free again)
  try { p.registry.tickerTaken(c.ticker); } catch { /* the rows below decide */ }
  const existing = lookalikeRows(p.registry, Date.now(), c.callerProven === true);
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
    // B-19: a ticker held only by a launch nobody has signed yet says so, and when it frees up
    const mins = taken && !others.length ? unprovenHoldMinutes(p.registry, c.ticker, owner) : null;
    const error = mins !== null
      ? `This launch is refused for now. ${unprovenHoldSentence(c.ticker, mins)}${free}`
      : taken ? `This launch is refused. ${sameTickerSentence(c.ticker)}${others.length ? ` ${others.join(" ")}` : ""} Please pick another ticker.${free}` : look.reason;
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
