import type { FetchLike, ResolvedSelector } from "@/lib/burnticker/oracle/types";
import type { SettledEvent } from "@/lib/burnticker/units";
import type { Feed, SourceEntry } from "@/lib/burnticker/catalogue";
import { compareFact, crossReadsOf, describeEntry } from "@/lib/burnticker/coverage/sources";
import { fetchBody, parseBody } from "@/lib/burnticker/sources/attestedHttp";

/**
 * THE RUNTIME CROSS-READ (ChatGPT/Codex PR review N2, 2026-10-10). A generic catalogue feed's readings reach the registry — and so the
 * keeper's attestation — only after the independent cross-read of the SAME fact (sources.json `fact`, another operator on another
 * domain: coverage/sources.ts crossReadsOf, the gate the creation preflight uses) has been read in the same cycle and agrees. The launch
 * preflight alone is not enough: an upstream that later publishes a wrong value, or a cross-read that disappears, must stop the burn.
 *
 * The agreement rule depends on how the two sources line up (the fact's `align`):
 *   period       each primary period needs the cross-read's value for the same period, within the fact's tolerance. Readings are
 *                accepted in order up to the first one that is missing or disagrees; that one and everything after it are HELD (the
 *                scalar carry engine needs them in order) and read again next cycle.
 *   snapshot     only the latest primary value can be paired (the two reads in the same few minutes, fact.maxSkewMinutes); it is accepted
 *                when it agrees; earlier values in the same read are not applied (their change is inside the latest's delta).
 *   quarter-end  a daily primary against a quarterly cross-read (Treasury debt vs FRED GFDEBTN): a daily value cannot be paired with a
 *                quarterly one, so the check is series-level — the cross-read must be readable this cycle and every quarter both reads
 *                cover must agree; a disagreement holds everything. LIMITATION (stated on the receipt): between quarter ends a single
 *                daily value is not individually corroborated.
 * No cross-read configured, none readable, or a disagreement → every reading is held (counted as awaiting, with the reason as a
 * refusal). Each accepted reading's `method` names the cross-read, its value and the agreement basis, so the receipt shows both.
 */

export interface CorroborateDeps { entries: readonly SourceEntry[]; crossFeed: (id: string) => Feed | null; fetchImpl: FetchLike; now: () => number }
type Align = "period" | "snapshot" | "quarter-end";

export async function corroborate(feed: Feed, all: readonly SettledEvent[], events: readonly SettledEvent[], primaryReadAt: number, deps: CorroborateDeps, base: Omit<ResolvedSelector, "events">): Promise<ResolvedSelector> {
  if (!events.length) return { ...base, events: [] };
  const sorted = [...events].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : 1));
  const hold = (why: string, kept: SettledEvent[] = []): ResolvedSelector => ({ ...base, events: kept, awaitingFinal: base.awaitingFinal + (sorted.length - kept.length), refusals: [...base.refusals, why] });
  const pf = feed.config.fact;
  if (!pf) return hold(`${feed.id} declares no fact, so no second source can confirm it. ${sorted.length} ${sorted.length === 1 ? "reading is" : "readings are"} held.`);
  const descs = deps.entries.map(describeEntry);
  const baseId = feed.config.id.split(":")[0];
  const desc = descs.find((s) => s.id === baseId) ?? describeEntry({ ...feed.config, id: baseId });
  const crosses = crossReadsOf(desc, descs);
  if (!crosses.length) return hold(`${feed.id} has no independent second source set up for the same fact. ${sorted.length} ${sorted.length === 1 ? "reading is" : "readings are"} held, because a primary source alone never settles a coin.`);
  let lastErr: string | null = null;
  for (const c of crosses) {
    const cf = deps.crossFeed(c.id);
    if (!cf || !cf.config.fact) { lastErr = `${c.id}: not a readable feed on this host`; continue; }
    let cr: SettledEvent[];
    try { const n = deps.now(); cr = parseBody(cf.config, await fetchBody(cf.config, n, deps.fetchImpl), n).readings; }
    catch (e) { lastErr = `${c.id}: ${(e as Error).message.slice(0, 140)}`; continue; }
    if (!cr.length) { lastErr = `${c.id}: returned no complete reading`; continue; }
    const cfct = cf.config.fact;
    const align: Align = pf.align === "snapshot" || cfct.align === "snapshot" ? "snapshot" : pf.align === "quarter-end" || cfct.align === "quarter-end" ? "quarter-end" : "period";
    const cmp = compareFact(pf, align === "period" ? sorted : all, cfct, cr, { primaryReadAt, crossReadAt: deps.now() });
    const tolObj = { ...cfct.tolerance, ...pf.tolerance };
    const tol = Object.keys(tolObj).length ? JSON.stringify(tolObj) : "exact";
    const who = `${c.id} (${c.operator})`;
    if (align === "period") {
      const byPeriod = new Map(cmp.comparisons.map((x) => [x.period, x]));
      const kept: SettledEvent[] = [];
      for (const e of sorted) {
        const x = byPeriod.get(e.id);
        if (!x) return hold(`For ${feed.id} ${e.id}, the cross-read ${who} has no value for this period yet. It is held along with ${sorted.length - kept.length - 1} later ${sorted.length - kept.length - 1 === 1 ? "reading" : "readings"}.`, kept);
        if (!x.agree) return hold(`${feed.id} ${e.id}: the primary (${x.primary}) and the cross-read ${who} (${x.crossRead}) disagree — held with every later reading`, kept);
        kept.push({ ...e, method: `${e.method ? `${e.method} · ` : ""}cross-read ${who}: ${x.crossRead} for ${e.id} agrees with ${x.primary} (tolerance ${tol})` });
      }
      return { ...base, events: kept };
    }
    if (align === "snapshot") {
      const latest = sorted[sorted.length - 1];
      const x = cmp.comparisons.find((y) => y.period === latest.id);
      if (!x) return hold(`${feed.id} ${latest.id}: the cross-read ${who} could not be paired with the latest value (${cmp.basis}) — held`);
      if (!x.agree) return hold(`${feed.id} ${latest.id}: the primary (${x.primary}) and the cross-read ${who} (${x.crossRead}) disagree — held`);
      const dropped = sorted.length - 1;
      return { ...base, events: [{ ...latest, method: `${latest.method ? `${latest.method} · ` : ""}cross-read ${who}: ${x.crossRead} agrees with ${x.primary} (${cmp.basis})` }], refusals: dropped ? [...base.refusals, `${feed.id} has ${dropped} earlier snapshot ${dropped === 1 ? "value" : "values"} in this read that could not be paired with a cross-read and are not applied (the latest value's change includes them)`] : base.refusals };
    }
    // quarter-end: series-level
    const bad = cmp.comparisons.find((y) => !y.agree);
    if (bad) return hold(`${feed.id}: the cross-read ${who} disagrees on ${bad.period} (${bad.primary} vs ${bad.crossRead}) — every reading held until the two agree`);
    const last = cmp.comparisons[cmp.comparisons.length - 1] ?? null;
    const note = last ? `series check: cross-read ${who} agrees on ${last.period} (${last.primary} vs ${last.crossRead}, tolerance ${tol}); a daily value between quarter ends is not individually corroborated` : `series check: cross-read ${who} read this cycle (latest ${cr[cr.length - 1].id}); no quarter both reads cover yet; a daily value between quarter ends is not individually corroborated`;
    return { ...base, events: sorted.map((e) => ({ ...e, method: `${e.method ? `${e.method} · ` : ""}${note}` })) };
  }
  return hold(`For ${feed.id}, no cross-read could be read this cycle (${lastErr ?? "none is set up on this host"}). ${sorted.length} ${sorted.length === 1 ? "reading is" : "readings are"} held.`);
}
