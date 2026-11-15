import type { BurnRule } from "@/lib/burnticker/rules";
import { ruleOneLiner } from "@/lib/burnticker/coinCard";

/**
 * THE NAMED-COIN END SINK, PICKED AT CREATION (owner, 2026-10-13 ~09:00 Denver: "pick another coin to burn (except the losing coin)";
 * END-SINK-OPTIONS-BRIEF item 2). The program already pins a named coin as a coin's end sink (end.rs END_SINK_MINT: at a resolved end the
 * rest moves to that coin's burn pool while it is live, else to $DEFICIT's). This file is the one list of coins a creator may name and the
 * one check the review and the bundle route run on `onEnd.mint`:
 *
 *   a sink    a coin on this network whose registry row is live (not draft, paused, retired or expired), with an on-chain TokenConfig, in
 *             buyback mode (a vault-mode coin has no burn pool); never $DEFICIT itself (that is its own choice), never the caller's own
 *             coin, and never the other side of the caller's own pair (the pair-winner sink covers a pair; a loser must never become the
 *             sink of its winner's partner by accident).
 *
 * Pure apart from the registry rows the caller passes in; client-safe types.
 */

export interface SinkCoin { mint: string; ticker: string; name: string; /** the coin's one-line rule */ rule: string }
export interface SinkRow { mint: string; ticker: string; name: string; status: string; cluster: string; tokenConfig: string | null; mode: string; rulesJson: string }

/** The flagship's ticker: $DEFICIT is offered as its own choice, never in the list. */
export const FLAGSHIP_TICKER = "DEFICIT";

const partnerOfRule = (rulesJson: string): string | null => { try { return (JSON.parse(rulesJson) as BurnRule).pair?.counterpartMint ?? null; } catch { return null; } };
const oneLine = (rulesJson: string): string => { try { return ruleOneLiner(JSON.parse(rulesJson) as BurnRule); } catch { return "its rule could not be read"; } };

/**
 * The coins on `network` that can take another coin's rest, minus `exclude` (the caller's own mints) and every pair partner of an excluded
 * mint: the registry's pairs table (`pairOf`) and any coin whose rule names an excluded mint as its counterpart, or is named by one.
 */
export function sinkCandidates(rows: readonly SinkRow[], o: { network: string; exclude?: readonly string[]; pairOf?: (mint: string) => { mintA: string; mintB: string } | null }): SinkCoin[] {
  const ex = new Set((o.exclude ?? []).filter(Boolean));
  for (const m of [...ex]) {
    const p = o.pairOf?.(m) ?? null;
    if (p) { ex.add(p.mintA); ex.add(p.mintB); }
    const own = rows.find((r) => r.mint === m);
    const named = own ? partnerOfRule(own.rulesJson) : null;
    if (named) ex.add(named);
  }
  return rows
    .filter((r) => r.status === "live" && r.cluster === o.network && !!r.tokenConfig && r.mode === "buyback" && r.ticker.toUpperCase() !== FLAGSHIP_TICKER)
    .filter((r) => !ex.has(r.mint) && !ex.has(partnerOfRule(r.rulesJson) ?? ""))
    .map((r) => ({ mint: r.mint, ticker: r.ticker, name: r.name, rule: oneLine(r.rulesJson) }))
    .sort((a, b) => a.ticker.localeCompare(b.ticker) || a.mint.localeCompare(b.mint));
}

/** end.rs's fall-through, said once for the list: a named coin that is not live at the end hands the rest to $DEFICIT. */
export const SINK_FALLBACK_LINE = "If the coin you name is not live when this coin's rule ends, the rest goes to $DEFICIT's burn.";
/** The plain sentences the review and the bundle route answer with. */
export const NAMED_SINK_NOT_LIVE = (ticker: string): string => `$${ticker} cannot take this coin's rest: it is not a live Burnticker coin on this network. Pick a coin from the list, or send the rest to $DEFICIT's burn.`;
export const NAMED_SINK_PARTNER = (ticker: string): string => `$${ticker} is the other side of this pair, so it cannot take this coin's rest. Pick another coin, or send the rest to $DEFICIT's burn.`;
export const NAMED_SINK_TICKER = (ticker: string, real: string): string => `The coin picked to take the rest is $${real}, not $${ticker}. Pick it again from the list.`;
export const NAMED_SINK_SELF = "A coin cannot name itself to take its own rest. Pick another coin, or send the rest to $DEFICIT's burn.";

/**
 * Why `rule`'s named sink is refused (null when it has none, or when it is one of `sinks`). `own` = this launch's own mints (both sides of a
 * pair) and `partners` = mints that are the other side of this coin's pair; either one is refused with its own sentence.
 */
export function namedSinkProblem(rule: Pick<BurnRule, "onEnd">, sinks: readonly SinkCoin[], o: { own?: readonly string[]; partners?: readonly string[] } = {}): string | null {
  const m = rule.onEnd?.mint, t = rule.onEnd?.ticker ?? "";
  if (!m) return null;
  if (o.own?.includes(m)) return NAMED_SINK_SELF;
  if (o.partners?.includes(m)) return NAMED_SINK_PARTNER(t);
  const hit = sinks.find((s) => s.mint === m);
  if (!hit) return NAMED_SINK_NOT_LIVE(t);
  if (hit.ticker.toUpperCase() !== t.toUpperCase()) return NAMED_SINK_TICKER(t, hit.ticker);
  return null;
}

/** A case-insensitive search over the list by ticker, name, mint or rule (the picker's search box). */
export function searchSinks(sinks: readonly SinkCoin[], q: string): SinkCoin[] {
  const s = q.trim().toLowerCase().replace(/^\$/, "");
  if (!s) return [...sinks];
  return sinks.filter((x) => x.ticker.toLowerCase().includes(s) || x.name.toLowerCase().includes(s) || x.mint.toLowerCase() === s || x.rule.toLowerCase().includes(s));
}

/** The registry's side (structural: Registry fits): every coin row and the pairs table. */
export interface SinkRegistry { tokens(): SinkRow[]; pairOf(mint: string): { mintA: string; mintB: string } | null }
/** The list for this host's registry on `network`, `exclude` taken out with its pair partners. */
export function liveSinks(reg: SinkRegistry, network: string, exclude: readonly string[] = []): SinkCoin[] {
  return sinkCandidates(reg.tokens(), { network, exclude, pairOf: (m) => reg.pairOf(m) });
}
