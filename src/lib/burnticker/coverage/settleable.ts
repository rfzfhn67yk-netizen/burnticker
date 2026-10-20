import { feedById, loadSourceEntries, type Feed } from "@/lib/burnticker/catalogue";
import { crossReadsOf, describeEntry, primaryEligibility } from "@/lib/burnticker/coverage/sources";
import { isSingleOfficialSource } from "@/lib/burnticker/singleSource";

/**
 * CAN THIS FEED SETTLE A COIN AT ALL? (launch walkthrough 2026-10-13). The creation preflight (preflight.ts preflightCatalogue) refuses a
 * feed that is not a primary source (an aggregator, a scraped page) or that has no independent second publisher of the same fact. Both
 * are facts of the source list, known without reading anything, yet the read-only review answered 200 with no problem for them: Browse
 * offered Bitcoin's Wikipedia views, Steam players, Federal Register rules and orders, Launch Library launches, NOAA flares, JPL near
 * misses, the Ethereum fee burn and DefiLlama TVL, the review passed, and the bundle refused after the wallet step. This is the same
 * check, static and with the same outcome, so the review says it before a wallet connects. Nothing here is looser than the preflight:
 * the preflight still runs the live reads at the bundle.
 */
export interface SettleRefusal { code: "not-primary" | "no-cross-read"; message: string }

/** The plain reason a source is not a primary, from primaryEligibility's note. */
function notPrimaryWhy(why: string | null): string {
  const w = why ?? "";
  if (/aggregator/i.test(w)) return "it collects the number from other publishers, and a coin settles only on the original publisher's figure";
  if (/page-scraped|tier 5/i.test(w)) return "its page cannot be read reliably enough to settle a coin";
  if (/cross-read only/i.test(w)) return "it is only used to check another source";
  return "it is not a source a coin can settle on";
}

export function catalogueSettleRefusal(feedOrId: Feed | string, o: { root?: string } = {}): SettleRefusal | null {
  const feed = typeof feedOrId === "string" ? feedById(feedOrId, {}, o.root) : feedOrId;
  if (!feed) return null;
  const all = loadSourceEntries(o.root).map(describeEntry);
  const base = feed.config.id.split(":")[0];
  const desc = all.find((s) => s.id === base) ?? describeEntry({ ...feed.config, id: base });
  const elig = primaryEligibility(desc);
  // a source that is not launchable is refused by feedRuleProblems with its own sentence; this adds nothing to it
  if (!elig.ok && /^not launchable/.test(elig.why ?? "")) return null;
  if (!elig.ok) return { code: "not-primary", message: `Coins cannot launch on "${feed.title}", because ${notPrimaryWhy(elig.why)}.` };
  // the owner's single-publisher exception (singleSource.ts): the natural-disaster feeds settle on their own publisher
  if (isSingleOfficialSource(feed.config)) return null;
  if (!crossReadsOf(desc, all).length) return { code: "no-cross-read", message: `Coins cannot launch on "${feed.title}" yet, because no second publisher reports the same number, and every result needs two sources that agree.` };
  return null;
}

/**
 * HB-134 (hourly run 11): ONE availability read for a catalogue source, used by every surface that offers it: the Browse card (HB-37),
 * the search card and the templates gallery. The Browse card said "Unavailable" for Launch Library 2 while the search offered "Use this"
 * and the "Rocket launches" template linked to it, and the creator learned at the Review step. Null when the source can launch (or is
 * not a catalogue source this check knows); otherwise the review's own refusal sentence. A catalogue that cannot be read refuses nothing.
 */
export function feedOfferRefusal(series: string | null | undefined, o: { root?: string } = {}): string | null {
  if (!series) return null;
  try { return catalogueSettleRefusal(series, o)?.message ?? null; } catch { return null; }
}
