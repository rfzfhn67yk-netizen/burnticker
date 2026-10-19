import type { BurnRule } from "@/lib/burnticker/rules";
import { ruleOneLiner } from "@/lib/burnticker/coinCard";
import { isReserved, normaliseName } from "@/lib/burnticker/reservedNames";
import { lookalikeHits, sameTickerSentence, type LookalikeExisting } from "@/lib/burnticker/lookalike";

/**
 * THE TICKER CHECK AT REVIEW (walkthrough snag 9; prelaunch audit 2026-10-18 A-2 and A-40). For every side of a draft: whether another
 * creator's coin already holds its ticker (a launched coin or an open draft), and two free tickers to switch to. A held ticker is a
 * REFUSAL now (the launch prepare refuses the same ticker, launchGuards.ts), and the creator's own coins never count against them. The
 * check lists LAUNCHED coins only: a draft's mint, name and rule are never shown here, so watching a ticker never reveals a coin before
 * it exists. Every suggestion passes the same lookalike check the launch runs (lookalike.ts), so a suggested ticker is never refused.
 * A reserved name is a refusal too (reservedNames.ts). The review route runs it on every keystroke's review request.
 */
export interface InUseCoin { mint: string; name: string; ticker: string; href: string; rule: string }
export interface TickerCheck { side: "A" | "B"; ticker: string; inUse: InUseCoin[]; /** A-2: another creator's coin (launched or a draft) holds this ticker */ taken: boolean; reserved: boolean; suggestions: string[]; /** the refusal sentence when taken (it names no coin), else null */ warning: string | null }
/** `status` and `creator` may be left out by a caller that only has launched coins (then each row counts as another creator's launched coin). */
export interface TickerRow { mint: string; name: string; ticker: string; rulesJson: string; status?: string; creator?: string }

const oneLine = (rulesJson: string): string => { try { return ruleOneLiner(JSON.parse(rulesJson) as BurnRule); } catch { return "its rule could not be read"; } };

/** A-2: the refusal for a ticker another creator's coin holds (no mint, name or rule: the holder may be a draft). */
export function inUseWarning(ticker: string, coins: readonly unknown[]): string | null {
  return coins.length ? `${sameTickerSentence(ticker)} Please pick another one.` : null;
}

/**
 * Words a team coin's suggestion may add (FANS, CLUB and the rest). None is a copycat suffix (lookalike.ts SUFFIX), so they pass the
 * lookalike check. Continuous audit HB-6 (2026-10-19): only a team coin is offered them ($QUIETMFANS for an earthquake coin read as a
 * fan club), and never on another coin's ticker ($DENWINFANS right after "pick a ticker that cannot be mistaken for it").
 */
const WORDS = ["FANS", "CLUB", "CREW", "HQ", "SQUAD", "GANG"] as const;

/** Continuous audit HB-6: a coin on a team's games (the team words fit it), read from its rule. */
export function isTeamRule(rule: unknown): boolean {
  const r = rule && typeof rule === "object" ? (rule as Partial<BurnRule>) : null;
  if (!r) return false;
  if (r.oracle === "catalogue" && typeof r.series === "string" && /^espn\./.test(r.series)) return true;
  return r.oracle === "kalshi" && /^-[A-Z0-9]{2,5}$/.test(r.filter?.tickerIncludes ?? "");
}

/**
 * Free tickers built from `ticker` (A-2): not the draft's own other side, not reserved, held by no coin, and no lookalike of any coin (the
 * launch's own check), so a suggestion is never refused. The candidates are the ticker's digit endings ($BRONCO2), which pass only while
 * the ticker itself is held by no coin, and for a team coin the team words on the ticker and on its first three letters. `avoid` is a
 * ticker that is held or reserved: no suggestion starts with it (HB-6), so a refusal never offers that ticker with something added.
 */
export function freeTickers(ticker: string, deps: { inUse: (ticker: string) => readonly unknown[]; existing: readonly LookalikeExisting[]; reserved: ReadonlySet<string>; creator?: string | null; own?: ReadonlySet<string> }, n = 2, o: { team?: boolean; avoid?: readonly (string | null | undefined)[] } = {}): string[] {
  const base = normaliseName(ticker) || "COIN", out: string[] = [], avoid = (o.avoid ?? []).map((x) => normaliseName(x ?? "")).filter(Boolean);
  const ok = (t: string) => /^[A-Z0-9]{2,10}$/.test(t) && !out.includes(t) && !avoid.some((a) => t.startsWith(a)) && !(deps.own?.has(t)) && !isReserved(t, deps.reserved) && deps.inUse(t).length === 0
    && lookalikeHits({ ticker: t, name: "", creator: deps.creator ?? null }, deps.existing).length === 0;
  const words = (stem: string) => WORDS.map((w) => `${stem.slice(0, 10 - w.length)}${w}`);
  const digits = Array.from({ length: 8 }, (_, k) => `${base.slice(0, 9)}${k + 2}`);
  // a team coin takes the team words first ($LADCLUB reads better than $LAD2); any other coin only its own digit endings
  const cands = o.team ? [...words(base), ...words(base.slice(0, 3)), ...digits] : digits;
  for (const t of cands) { if (out.length >= n) break; if (ok(t)) out.push(t); }
  return out;
}

export function tickerChecks(sides: readonly { side: "A" | "B"; ticker: string; generated?: string | null; /** HB-6: a team coin (isTeamRule); only then are team words offered */ team?: boolean }[], deps: { inUse: (ticker: string) => readonly TickerRow[]; reserved: ReadonlySet<string>; /** the registry's rows (launchGuards.ts lookalikeRows); with none, the holders found by `inUse` */ existing?: readonly LookalikeExisting[] | null; /** the connected wallet, when the review knows it: its own coins never count */ creator?: string | null }): TickerCheck[] {
  const own = new Set(sides.map((s) => s.ticker.toUpperCase()));
  // review of block M: only the (proven) creator's own unfinished draft is exempt; their own launched coin holds the ticker like any other
  const holders = (t: string): TickerRow[] => deps.inUse(t).filter((x) => !(deps.creator && x.creator === deps.creator && (x.status ?? "live") === "draft"));
  const existing: LookalikeExisting[] = [...(deps.existing ?? [])];
  for (const s of sides) for (const x of deps.inUse(s.ticker.toUpperCase())) if (!existing.some((e) => e.ticker.toUpperCase() === x.ticker.toUpperCase() && e.creator === x.creator)) existing.push({ ticker: x.ticker, name: x.name, status: x.status ?? "live", creator: x.creator ?? null });
  const fdeps = { inUse: holders, existing, reserved: deps.reserved, creator: deps.creator ?? null, own };
  // HB-6: the suggestions come from the coin's own rule (its generated ticker and that ticker's endings), never from the typed ticker
  // another coin holds or the platform reserves; with no usable generated ticker, only what can be built without extending the typed one
  const fromRule = (g: string | null | undefined, typed: string, team: boolean): string[] => {
    const t = (g ?? "").toUpperCase();
    if (!/^[A-Z0-9]{2,10}$/.test(t) || isReserved(t, deps.reserved) || t.startsWith(typed)) return freeTickers(typed, fdeps, 2, { team, avoid: [typed] });
    const held = holders(t).length > 0;
    // a generated ticker another coin holds is never extended either
    const o = { team, avoid: [typed, held ? t : null] };
    const free = !own.has(t) && !held && lookalikeHits({ ticker: t, name: "", creator: deps.creator ?? null }, existing).length === 0;
    return free ? [t, ...freeTickers(t, fdeps, 1, o)] : freeTickers(t, fdeps, 2, o);
  };
  return sides.filter((s) => /^[A-Z0-9]{2,10}$/.test(s.ticker.toUpperCase())).map((s) => {
    const ticker = s.ticker.toUpperCase();
    const held = holders(ticker);
    // A-40: launched coins only; a draft holding the ticker makes it taken without being described
    const inUse = held.filter((t) => (t.status ?? "live") !== "draft").map((t) => ({ mint: t.mint, name: t.name, ticker: t.ticker, href: `/burnticker/t/${t.mint}`, rule: oneLine(t.rulesJson) }));
    const reserved = isReserved(ticker, deps.reserved), taken = held.length > 0;
    return { side: s.side, ticker, inUse, taken, reserved, suggestions: reserved || taken ? fromRule(s.generated, ticker, !!s.team) : [], warning: taken ? inUseWarning(ticker, held) : null };
  });
}
