import type { BurnRule, LockedRule } from "@/lib/burnticker/rules";
import { feedById, feedRuleProblems, loadFixture, type Feed } from "@/lib/burnticker/catalogue";
import { oneShotEligibility, type Eligibility } from "@/lib/burnticker/oneShotEligibility";
import { nativeRuleProblems, nativeSourceById } from "@/lib/burnticker/sources/native";
import { KALSHI_UNAVAILABLE } from "@/lib/burnticker/venues";
import { VAULT_HIDDEN_SENTENCE } from "@/lib/burnticker/hostedLaunch";
import { loadRefuseList, nameRefusals } from "@/lib/burnticker/oracle/refuse";
import { loadMajors, loadReserved, majorProblem, reservedProblem } from "@/lib/burnticker/reservedNames";
import { controlCharProblem } from "@/lib/burnticker/launchFields";
import { regexProblem } from "@/lib/burnticker/safeRegex";
import { lookalikeRefusal, type LookalikeExisting } from "@/lib/burnticker/lookalike";

/**
 * THE ONE LAUNCH PREFLIGHT (ChatGPT audit 6 item 8, 2026-10-12: POST /launch/review answered 200 with no problems for setups the bundle
 * route refuses — unlaunchable catalogue sources, oracles this host has off, unknown series, a reserve of 0 or 1,000 SOL, a catastrophic
 * title regex). Both the read-only review (launchReview.ts) and the bundle route (handlers.ts prepareLaunch) run these checks, so the
 * review's `problems` predict exactly what the bundle refuses. Pure apart from the config reads (refuse list, reserved names, the
 * catalogue's saved samples); no network, no chain.
 *
 *   rule        vault mode · a venue this host has off · an oracle no coin can launch on yet · a native source's fixed unit · a catalogue
 *               feed that is unknown, disagrees with its fixed unit / direction / baseline, is not launchable, or whose one-time result is
 *               already in · a reserve outside RESERVE_SOL · a title regex that could backtrack catastrophically
 *   identity    the refuse list's name patterns · the platform's reserved names · major coins' tickers · control characters
 */

export interface PreflightRefusal { status: number; code: string; message: string }

/** intent audit 2 item 2: a one-time series judged on its saved sample, only when the sample is of this very series (oneShotEligibility.ts). */
export function sampleEligibility(f: Feed, now: number): Eligibility {
  try { return oneShotEligibility(f.id, f.config, loadFixture(f).body, now); } catch { return { decided: false, reason: null, subject: null }; }
}

/**
 * THE RESERVE BOUNDS. The reserve is SOL the creator moves into the coin's burn pool that the program never spends (program.ts
 * reserve_lamports). Its floor keeps the burn pool account rent-exempt (a 0-byte account needs 890,880 lamports, launchCost.ts
 * rentLamports(0)), rounded up to 0.001 SOL; its ceiling is 1 SOL, fifty times the 0.02 SOL every builder uses, so a typo cannot lock
 * up a creator's SOL or leave a pool that never burns. Launch-time only: rules already registered are not re-checked.
 */
export const RESERVE_SOL = { min: 0.001, max: 1 } as const;
export const reserveProblem = (reserveSol: string): string | null => {
  const v = Number(reserveSol);
  return Number.isFinite(v) && v >= RESERVE_SOL.min && v <= RESERVE_SOL.max ? null : `The reserve must be between ${RESERVE_SOL.min} and ${RESERVE_SOL.max} SOL. It stays in the coin's burn pool and is never spent, and every launch on this site uses 0.02 SOL.`;
};

export interface RuleCtx { kalshiEnabled?: boolean; now?: number }

/** The rule refusals, in the order the bundle route meets them. The first one is the bundle's answer; the review lists them all. */
export function ruleRefusals(locked: LockedRule, ctx: RuleCtx = {}): PreflightRefusal[] {
  const r = locked.rule, out: PreflightRefusal[] = [];
  const now = ctx.now ?? Date.now();
  if (locked.mode === "vault") out.push({ status: 400, code: "vault-off", message: VAULT_HIDDEN_SENTENCE });
  if (r.oracle === "kalshi" && ctx.kalshiEnabled === false) out.push({ status: 503, code: "venue-off", message: KALSHI_UNAVAILABLE });
  if (r.oracle === "catalogue") {
    const native = nativeSourceById(r.series!);
    if (native) { const np = nativeRuleProblems(native, r); if (np.length) out.push({ status: 400, code: "source-rule", message: np.join("; ") }); }
    else {
      const feed = feedById(r.series!);
      if (!feed) out.push({ status: 400, code: "unknown-source", message: "This rule names a source that is not in the catalogue. Pick one from the catalogue." });
      else {
        const fp = feedRuleProblems(feed, r);
        if (fp.length) out.push({ status: 400, code: "source-rule", message: fp.join("; ") });
        else { const elig = sampleEligibility(feed, now); if (elig.decided) out.push({ status: 400, code: "already-decided", message: elig.reason! }); }
      }
    }
  } else if (r.oracle !== "kalshi" && r.oracle !== "polymarket" && r.oracle !== "derby") out.push({ status: 400, code: "oracle-off", message: `Coins cannot launch on the ${r.oracle} source yet. Kalshi, Polymarket, our own feeds and the Burn Derby are live.` });
  { const rp = reserveProblem(r.reserveSol); if (rp) out.push({ status: 400, code: "reserve", message: rp }); }
  if (r.filter.titleRegex !== undefined) { const why = regexProblem(r.filter.titleRegex); if (why) out.push({ status: 400, code: "unsafe-regex", message: why }); }
  return out;
}

export interface IdentityInput { ticker: string; name: string; description?: string; note?: string }
export interface IdentityCtx { /** false: the caller runs the refuse list's name patterns itself (the bundle route folds them into its refusals) */ refuseList?: boolean; reserved?: ReadonlySet<string>; majors?: ReadonlySet<string>; existing?: readonly LookalikeExisting[] | null; rule?: Pick<BurnRule, "oracle" | "series"> | null }

/** A side's name, ticker and texts: the refuse list's name patterns, reserved names, major coins, control characters, lookalikes. */
export function identityRefusals(s: IdentityInput, ctx: IdentityCtx = {}): PreflightRefusal[] {
  const out: PreflightRefusal[] = [];
  // the name's control characters are nameProblem's (launchFields.ts), which both the review and the bundle already run
  for (const [field, text] of [["description", s.description ?? ""], ["note", s.note ?? ""]] as const) { const c = controlCharProblem(text, field); if (c) out.push({ status: 400, code: "control-characters", message: c }); }
  let reserved: ReadonlySet<string> = new Set(), majors: ReadonlySet<string> = new Set();
  try { reserved = ctx.reserved ?? loadReserved(); } catch { /* an unreadable list refuses nothing */ }
  try { majors = ctx.majors ?? loadMajors(); } catch { /* the same */ }
  { const rp = reservedProblem(s, reserved); if (rp) out.push({ status: 403, code: "reserved", message: rp }); }
  { const mp = majorProblem(s, majors); if (mp) out.push({ status: 403, code: "major-ticker", message: mp }); }
  if (ctx.refuseList !== false) try { const nr = nameRefusals(loadRefuseList(), s.name, s.ticker); if (nr.length) out.push({ status: 403, code: "refused", message: `This launch is refused: ${nr.map((x) => x.reason).join("; ")}` }); } catch { /* the bundle reads it again */ }
  if (ctx.existing) { const look = lookalikeRefusal({ ticker: s.ticker, name: s.name, rule: ctx.rule ?? null }, ctx.existing); if (look) out.push({ status: 409, code: "lookalike", message: look.reason }); }
  return out;
}

/**
 * The source's title and unit in words, exactly as the bundle route reads them (handlers.ts prepareLaunch: a native source's title; a
 * feed's title, or a named launch's own name from its saved sample), so the review's statement and description never fall back to the
 * raw series id (ChatGPT audit 6 item 26). Null for market and derby rules.
 */
export function sourceText(r: BurnRule, now: number = Date.now()): { title: string; unitLabel: string | null; subjectName: string | null; feed: { title: string; sourceName: string; unitLabel: string } | null } | null {
  if (r.oracle !== "catalogue" || !r.series) return null;
  const native = nativeSourceById(r.series);
  if (native) return { title: native.title, unitLabel: native.unit?.label ?? null, subjectName: null, feed: null };
  const feed = feedById(r.series);
  if (!feed) return null;
  const elig = sampleEligibility(feed, now);
  return { title: elig.subject ? `${elig.subject.name} succeeds (Launch Library 2)` : feed.title, unitLabel: feed.unit?.label ?? null, subjectName: elig.subject?.name ?? null, feed: feed.unit ? { title: feed.title, sourceName: feed.sourceName, unitLabel: feed.unit.label } : null };
}
