import type { Platform } from "@/lib/burnticker/server";
import type { BurnRule } from "@/lib/burnticker/rules";
import { lookalikeRefusal, mintAdoptionRefusal, type LookalikeHit } from "@/lib/burnticker/lookalike";

/**
 * The launch handler's two growth-batch guards (2026-10-10), in one call so the handler change is one line per side:
 *   · LOOKALIKE: the ticker and name against every Burnticker coin (lookalike.ts) → 409 code "lookalike";
 *   · NO ADOPTION: a mint given by the caller must be new — not registered, and no account on chain when this host has an RPC to ask
 *     (`p.market`, the read-only connection) → 409 code "mint-exists".
 */
export interface GuardRefusal { status: 409; error: string; extra: { code: "lookalike" | "mint-exists"; hits?: LookalikeHit[] } }

/** The registered coins as the lookalike check reads them (the bundle route below and the review route, launchPreflight identityRefusals). */
export function lookalikeRows(registry: Pick<Platform["registry"], "tokens" | "lockedRule">): { ticker: string; name: string; status: string; rule: Pick<BurnRule, "oracle" | "series"> | null }[] {
  return registry.tokens().map((t) => { let rule: Pick<BurnRule, "oracle" | "series"> | null = null; try { rule = registry.lockedRule(t).rule; } catch { rule = null; } return { ticker: t.ticker, name: t.name, status: t.status, rule }; });
}
export async function launchGuardRefusal(p: Pick<Platform, "registry" | "market">, c: { ticker: string; name: string; rule: Pick<BurnRule, "oracle" | "series"> | null; mint?: string | null; /** 2026-10-14: the creator's own unfinished draft of this mint is not an adoption */ creator?: string | null }): Promise<GuardRefusal | null> {
  const existing = lookalikeRows(p.registry);
  const look = lookalikeRefusal({ ticker: c.ticker, name: c.name, rule: c.rule }, existing);
  if (look) return { status: 409, error: look.reason, extra: { code: "lookalike", hits: look.hits } };
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
