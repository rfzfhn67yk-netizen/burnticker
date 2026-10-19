import type { BurnRule } from "@/lib/burnticker/rules";
import { RULES_SCHEMA } from "@/lib/burnticker/wizard";
import { applyDial, dialsFor } from "@/lib/burnticker/dials";
import { linkedShareMigratedNotice, shareOf } from "@/lib/burnticker/launchPresets";

/**
 * THE WIZARD'S DRAFT, ONE TYPED PATH FROM THE CARD TO THE REQUEST (ChatGPT launch audit 5, L01, 2026-10-11). A search card, a Browse
 * source, an election candidate or the weather template hands the page a ready rule; the page keeps it as editable fields (the preset
 * row edits the share) and composes the rule it reviews and sends from those fields. Both directions live here, pure, so a test can
 * walk every entry path: card rule → `fieldsFromRule` → `composeRule` → `launchBody` → the locked rule → initialize_token's
 * fraction_per_unit_bps, and assert that the share never changes on the way (test/burntickerLaunchDraft.test.ts).
 * Client-safe.
 */
export interface DraftPick { oracle: "kalshi" | "catalogue" | "polymarket"; series: string | null; market: string | null; title: string; source?: { unit: { size: number } | null; baseline: "previousSettlement" | number | null; direction: "up" | "down" | "abs" | null } | null }
export interface DraftFields {
  kind: "binary" | "scalar"; mode: "buyback" | "vault";
  onYes: number; onNoEnabled: boolean; onNo: number; burnOn: "yes" | "no";
  unit: number; perUnit: number; baseline: "previousSettlement" | number; direction: "up" | "down" | "abs";
  tokensYes: number; vaultShare: number; filter: string; polyPreset: string | null;
}
export const DRAFT_DEFAULTS: DraftFields = { kind: "binary", mode: "buyback", onYes: 0.02, onNoEnabled: false, onNo: 0.01, burnOn: "yes", unit: 1, perUnit: 0.01, baseline: "previousSettlement", direction: "up", tokensYes: 1_000_000, vaultShare: 0.25, filter: "", polyPreset: null };

/** What the page keeps from a ready rule (the old applyRule): the side, the share, the scalar unit. */
export function fieldsFromRule(r: BurnRule, base: DraftFields = DRAFT_DEFAULTS): DraftFields {
  const f: DraftFields = { ...base, kind: r.kind, mode: "buyback", filter: "" };
  if (r.kind === "binary" && r.binary) {
    f.burnOn = r.binary.onYes ? "yes" : "no";
    const m = (r.binary.onYes ?? r.binary.onNo) as { fractionOfPool?: number } | null;
    if (m?.fractionOfPool) f.onYes = m.fractionOfPool;
    f.onNoEnabled = !!(r.binary.onYes && r.binary.onNo);
  }
  if (r.kind === "scalar" && r.scalar) {
    const m = r.scalar.perUnit as { fractionOfPool?: number };
    if (m.fractionOfPool) f.perUnit = m.fractionOfPool;
    f.unit = r.scalar.unit; f.direction = r.scalar.direction; f.baseline = r.scalar.baseline;
  }
  return f;
}

/** The rule the page reviews and sends, from the pick and the fields (the old genericRule, unchanged in what it builds). */
export function composeRule(pick: DraftPick | null, d: DraftFields): BurnRule | null {
  if (!pick) return null;
  const mapping = (fr: number, tok: number) => (d.mode === "buyback" ? { fractionOfPool: Number(fr.toFixed(4)) } : { tokens: Math.round(tok) });
  // Kalshi filters by ticker text; Polymarket by words the market question contains (escaped into titleRegex; it has no tickers), or the
  // head-to-head preset. (Question words left over from a Polymarket pick are not a ticker filter: ignored for Kalshi.)
  const flt = pick.market ? {} : pick.oracle === "polymarket" ? (d.filter.trim() ? { titleRegex: d.filter.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&") } : d.polyPreset ? { titleRegex: d.polyPreset } : {}) : !d.filter.trim() ? {} : /^[-A-Za-z0-9._]{1,32}$/.test(d.filter.trim()) ? { tickerIncludes: d.filter.trim().toUpperCase() } : {};
  const base = { schema: RULES_SCHEMA, oracle: pick.oracle, series: pick.series, market: pick.market, filter: flt, onVoid: "skip" as const, floorUsd: "1", reserveSol: "0.02", vault: d.mode === "vault" ? { share: d.vaultShare, vestDays: 365, cliffDays: 0 } : null };
  if (pick.oracle === "catalogue" && pick.source?.unit) return { ...base, kind: "scalar", scalar: { unit: pick.source.unit.size, perUnit: mapping(d.perUnit, d.tokensYes), baseline: pick.source.baseline!, direction: pick.source.direction! }, binary: null } as BurnRule;
  if (d.kind === "binary" || pick.oracle === "polymarket") {
    const main = mapping(d.onYes, d.tokensYes), other = d.onNoEnabled ? mapping(d.onNo, Math.round(d.tokensYes / 4)) : null;
    return { ...base, kind: "binary", binary: d.burnOn === "yes" ? { onYes: main, onNo: other } : { onYes: other, onNo: main }, scalar: null } as BurnRule;
  }
  return { ...base, kind: "scalar", scalar: { unit: d.unit, perUnit: mapping(d.perUnit, d.tokensYes), baseline: d.baseline, direction: d.direction }, binary: null } as BurnRule;
}

/** The single-coin request body POST /api/burnticker/launch receives (pressing Launch is the acknowledgement). */
export function launchBody(o: { creator: string; ticker: string; name: string; description: string; descCtx: unknown; note: string; rule: BurnRule; timings?: Record<string, number>; raiseSol?: string }): Record<string, unknown> {
  return { creator: o.creator, firstBuySol: "0", ...(o.raiseSol ? { raiseSol: o.raiseSol } : {}), acknowledgements: { ruleLocked: true, noReturns: true }, ...(o.timings ? { timings: o.timings } : {}), ticker: o.ticker.toUpperCase(), name: o.name, description: o.description, descCtx: o.descCtx, note: o.note, imageUrl: null, links: [], rule: o.rule };
}

/**
 * AUDIT 12 item 1 (2026-10-13): a saved launch-page draft (the page's session snapshot) whose LINKED pair resolves once (two candidates
 * `elPick`, one game `pairMode: "game"`) and carries a share other than 100 % is moved to 100 % when it is resumed, with a notice that says
 * what changed; nothing else in it is touched. A draft that needs no change comes back as it was, with no notice. Pure, client-safe.
 */
export function migrateLinkedShare<T extends Record<string, unknown>>(saved: T): { draft: T; notice: string | null } {
  const linked = saved.flow === "pair" && (!!saved.elPick || saved.pairMode === "game");
  if (!linked) return { draft: saved, notice: null };
  let from: number | null = null;
  const fix = (r: unknown): unknown => {
    if (!r || typeof r !== "object") return r;
    const rule = r as BurnRule;
    let one = false; try { one = dialsFor(rule).bounds.max >= 1; } catch { return r; }
    const f = shareOf(rule);
    if (!one || f === null || f === 1) return r;
    from = from ?? f;
    return applyDial(rule, "fraction", 1);
  };
  const out: Record<string, unknown> = { ...saved };
  const d = saved.draft as { key?: string; a?: unknown; b?: unknown } | null | undefined;
  if (d && typeof d === "object") out.draft = { ...d, a: fix(d.a), b: d.b ? fix(d.b) : d.b ?? null };
  if (typeof saved.fraction === "number" && saved.fraction !== 1) { from = from ?? saved.fraction; out.fraction = 1; }
  return from === null ? { draft: saved, notice: null } : { draft: out as T, notice: linkedShareMigratedNotice(from) };
}

/**
 * LAUNCH WIZARD AUDIT 2026-10-19 F4: a restored draft keeps each coin's end choice (endA / endB). A choice the host no longer offers ("another
 * coin's burn" with the picker off, the incinerator without the burn-sol source) showed no checked radio while the rule silently kept it.
 * On restore such a choice falls back to the default ($DEFICIT's burn), and the page says so in one line.
 */
export const END_CHOICE_RESET_NOTICE = "Your saved end choice is not offered on this site now, so the rest goes to $DEFICIT's burn instead.";
export const endChoiceOffered = (c: { kind: string } | null | undefined, o: { sinkPicker: boolean; burnSol: boolean }): boolean => !c || c.kind === "deficit" || (c.kind === "coin" && o.sinkPicker) || (c.kind === "burn-sol" && o.burnSol);
