import { endSinkOf, gameMirrorId, GAME_WIN_SERIES_RE, isMeetingsRule, POLY_MARKET_RE, settledPairShape, type BurnRule, type LockedRule } from "@/lib/burnticker/rules";
import { feedById, feedRuleProblems, loadFixture, type Feed } from "@/lib/burnticker/catalogue";
import { oneShotEligibility, type Eligibility } from "@/lib/burnticker/oneShotEligibility";
import { nativeRuleProblems, nativeSourceById } from "@/lib/burnticker/sources/native";
import { KALSHI_UNAVAILABLE } from "@/lib/burnticker/venues";
import { VAULT_HIDDEN_SENTENCE } from "@/lib/burnticker/hostedLaunch";
import { loadRefuseList, nameRefusals } from "@/lib/burnticker/oracle/refuse";
import { isReserved, loadMajors, loadReserved, majorProblem, reservedProblem, RESERVED_TICKER_REFUSAL } from "@/lib/burnticker/reservedNames";
import { controlCharProblem } from "@/lib/burnticker/launchFields";
import { regexProblem } from "@/lib/burnticker/safeRegex";
import { lookalikeRefusal, type LookalikeExisting } from "@/lib/burnticker/lookalike";
import { parseEspnSeries, teamByAbbr, teamCodeOf, teamsOf, type LeagueId } from "@/lib/burnticker/sources/espn";

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

export interface RuleCtx { kalshiEnabled?: boolean; now?: number; /** the launch is a registered pair (the body's `pair` side) */ pair?: boolean;
  /** two candidates in one race: the body's pair names candidate B's market (`pair.market`) and the race (`pair.race`) */ candidates?: { marketB: string | null; race: string | null } | null;
  /** two teams in one game: the body's pair names the other team (`pair.opp`) */ game?: { opp: string | null } | null }

/**
 * THE RIVALRY SERIES' OWN REFUSALS (sources/espn.ts window `meetings`). A head-to-head season series is launched only as a pair, one coin
 * per team, so the series winner has a partner to take the rest; it keeps the pair-winner end sink; it has no fade side (a reading is
 * already signed: a loss is the other coin's win).
 */
export const MEETINGS_SINGLE_REFUSAL = "Every game between two teams this season is launched as a pair, one coin for each team. Add the second team's coin.";
export const MEETINGS_FADE_REFUSAL = "Every game between two teams has no fade side: a loss for one team is already a win for the other team's coin.";
export const MEETINGS_END_REFUSAL = "Every game between two teams this season ends by sending whatever is left to the coin of the team that won more of their games, so the rule must keep its end sink.";
export function meetingsRefusals(r: BurnRule, ctx: Pick<RuleCtx, "pair"> = {}): PreflightRefusal[] {
  if (!isMeetingsRule(r)) return [];
  const out: PreflightRefusal[] = [];
  if (!ctx.pair && !r.pair) out.push({ status: 400, code: "meetings-pair-only", message: MEETINGS_SINGLE_REFUSAL });
  if (r.inverse) out.push({ status: 400, code: "meetings-no-fade", message: MEETINGS_FADE_REFUSAL });
  if (r.onEnd && r.onEnd.endSink !== true) out.push({ status: 400, code: "meetings-end-sink", message: MEETINGS_END_REFUSAL });
  return out;
}

/**
 * TWO CANDIDATES IN ONE RACE (owner 2026-10-13: the linked form is the default and the only form). The pair is two Polymarket outcome
 * markets of one race, each coin on its own candidate's market, burning on its YES only; both coins keep the end sink, so each one's sink
 * is pinned at creation as the pair winner naming the other (program.ts endSinkPin: PAIR_WINNER with pair_mint = the partner). The race
 * check itself (both markets are named outcomes of the race) is the bundle route's, which reads Polymarket (handlers.ts prepareLaunch).
 */
export const CANDIDATES_SINK_REFUSAL = "Two candidates in one race need the end sink on both coins: the losing coin's pool goes to the winning coin's burn, and when neither candidate wins both pools go to $DEFICIT's burn.";
export const CANDIDATES_MARKETS_REFUSAL = "Two candidates in one race read two Polymarket outcome markets of that race, one for each coin. Pick two different candidates of the same race.";
export const CANDIDATES_YES_REFUSAL = "Each candidate's coin burns when its own candidate's market settles YES, so the rule burns on YES only.";
export const CANDIDATES_RACE_REFUSAL = "Two candidates in one race need the race, so the site can check that both candidates are in it.";
export function candidatesRefusals(r: BurnRule, ctx: Pick<RuleCtx, "candidates"> = {}): PreflightRefusal[] {
  const c = ctx.candidates;
  if (!c) return [];
  const out: PreflightRefusal[] = [];
  if (r.oracle !== "polymarket" || !r.market || !c.marketB || !POLY_MARKET_RE.test(c.marketB.toLowerCase()) || c.marketB.toLowerCase() === r.market) out.push({ status: 400, code: "candidates-markets", message: CANDIDATES_MARKETS_REFUSAL });
  if (r.kind !== "binary" || !r.binary?.onYes || r.binary.onNo) out.push({ status: 400, code: "candidates-yes-only", message: CANDIDATES_YES_REFUSAL });
  if (!c.race) out.push({ status: 400, code: "candidates-race", message: CANDIDATES_RACE_REFUSAL });
  if (!r.onEnd || r.onEnd.endSink !== true) out.push({ status: 400, code: "candidates-end-sink", message: CANDIDATES_SINK_REFUSAL });
  return out;
}
/**
 * TWO TEAMS IN ONE GAME (2026-10-13: the one-game rivalry pair is linked by default, the same owner rule as the election pair). Each coin
 * reads its own team's win series of the game (outcome `win`, 1 when its team won), side B the mirror (the other team's); both keep the
 * end sink, so each one's sink is pinned at creation as the pair winner naming the other.
 */
export const GAME_PAIR_SINK_REFUSAL = "Two teams in one game need the end sink on both coins: the losing team's coin's pool goes to the winning team's coin's burn, and after a draw both pools go to $DEFICIT's burn.";
export const GAME_PAIR_SERIES_REFUSAL = "Two teams in one game are linked on each team's own win in that game. Pick the game and two different teams in it.";
export function gamePairRefusals(r: BurnRule, ctx: Pick<RuleCtx, "game"> = {}): PreflightRefusal[] {
  const g = ctx.game;
  if (!g) return [];
  const out: PreflightRefusal[] = [];
  if (r.oracle !== "catalogue" || !GAME_WIN_SERIES_RE.test(r.series ?? "") || !g.opp || !gameMirrorId(r.series ?? "", g.opp) || r.inverse) out.push({ status: 400, code: "game-pair-series", message: GAME_PAIR_SERIES_REFUSAL });
  if (!r.onEnd || r.onEnd.endSink !== true) out.push({ status: 400, code: "game-pair-end-sink", message: GAME_PAIR_SINK_REFUSAL });
  return out;
}
/**
 * Both built sides of a settled-event pair (two candidates in one race, two teams in one game; the bundle's two locked rules): each ends
 * on the pair-winner sink and names the other. Side B's rule names side A's mint; side A names B at creation through pair_mint
 * (launchBundle.ts buildPairBundles), which the sink follows. Empty = both sinks are in place.
 */
export function settledPairSinkProblems(a: { rule: BurnRule; mint: string }, b: { rule: BurnRule; mint: string }): string[] {
  const p: string[] = [];
  const shape = settledPairShape(a.rule);
  const sinkLine = shape === "game" ? GAME_PAIR_SINK_REFUSAL : CANDIDATES_SINK_REFUSAL;
  for (const [s, x] of [["A", a], ["B", b]] as const) if (endSinkOf(x.rule) !== "pair-winner") p.push(`Coin ${s}. ${sinkLine}`);
  if (b.rule.pair?.counterpartMint !== a.mint) p.push("Coin B does not name coin A as its partner.");
  if (!shape || settledPairShape(b.rule) !== shape) p.push(CANDIDATES_MARKETS_REFUSAL);
  else if (JSON.stringify(a.rule.pair?.race ?? a.rule.pair?.game) !== JSON.stringify(b.rule.pair?.race ?? b.rule.pair?.game)) p.push(shape === "game" ? GAME_PAIR_SERIES_REFUSAL : CANDIDATES_MARKETS_REFUSAL);
  return p;
}
/**
 * A launch body's `pair` side read as a settled-event pair: `{ market, race }` (candidate B's market and the race's Polymarket event
 * slug) for two candidates in one race; `{ opp }` (the other team's abbreviation) for two teams in one game. Null for any other pair (Coin
 * vs Coin, a one-market pair, a rivalry series). The bundle route and the review read the same body through this.
 */
export interface SettledPairInput { shape: "candidates" | "game"; candidates: { marketB: string | null; race: string | null } | null; game: { opp: string | null } | null; bundle: { race?: { slug: string; marketB: string }; game?: { opp: string } } }
export function settledPairInput(pair: unknown): SettledPairInput | null {
  if (!pair || typeof pair !== "object") return null;
  const x = pair as { market?: unknown; race?: unknown; opp?: unknown };
  const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
  if (x.market !== undefined || x.race !== undefined) {
    const marketB = str(x.market)?.toLowerCase() ?? null, race = str(x.race);
    return { shape: "candidates", candidates: { marketB, race }, game: null, bundle: marketB && race ? { race: { slug: race, marketB } } : {} };
  }
  if (x.opp !== undefined) { const opp = str(x.opp)?.toUpperCase() ?? null; return { shape: "game", candidates: null, game: { opp }, bundle: opp ? { game: { opp } } : {} }; }
  return null;
}
/** The candidates name for settledPairSinkProblems. */
export const candidatesSinkProblems = settledPairSinkProblems;

/** The rule refusals, in the order the bundle route meets them. The first one is the bundle's answer; the review lists them all. */
export function ruleRefusals(locked: LockedRule, ctx: RuleCtx = {}): PreflightRefusal[] {
  const r = locked.rule, out: PreflightRefusal[] = [];
  const now = ctx.now ?? Date.now();
  if (locked.mode === "vault") out.push({ status: 400, code: "vault-off", message: VAULT_HIDDEN_SENTENCE });
  if (r.oracle === "kalshi" && ctx.kalshiEnabled === false) out.push({ status: 503, code: "venue-off", message: KALSHI_UNAVAILABLE });
  if (r.oracle === "catalogue") {
    const native = nativeSourceById(r.series!);
    if (native) { const np = nativeRuleProblems(native, r); if (np.length) out.push({ status: 400, code: "source-rule", message: np.join("; ") }); out.push(...meetingsRefusals(r, ctx)); }
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
  out.push(...candidatesRefusals(r, ctx), ...gamePairRefusals(r, ctx));
  { const rp = reserveProblem(r.reserveSol); if (rp) out.push({ status: 400, code: "reserve", message: rp }); }
  if (r.filter.titleRegex !== undefined) { const why = regexProblem(r.filter.titleRegex); if (why) out.push({ status: 400, code: "unsafe-regex", message: why }); }
  return out;
}

export interface IdentityInput { ticker: string; name: string; description?: string; note?: string }
export interface IdentityCtx { /** false: the caller runs the refuse list's name patterns itself (the bundle route folds them into its refusals) */ refuseList?: boolean; reserved?: ReadonlySet<string>; majors?: ReadonlySet<string>; existing?: readonly LookalikeExisting[] | null; rule?: Pick<BurnRule, "oracle" | "series"> | null }

/** A side's name, ticker and texts: the refuse list's name patterns, reserved names, major coins, control characters, lookalikes. */
/**
 * sources-7 (QA walkthrough 11 H9: $LAD was accepted on an Avalanche coin). On a team coin, a ticker that is another team's code on this
 * site (its code, or its code with the generated win, loss or draw letter), in the major leagues or the coin's own league, reads as that
 * team's coin, so it is refused. The coin's own team (and a rivalry series' other team) keep their codes; any other rule is not checked.
 */
const PRO_LEAGUES: readonly LeagueId[] = ["mlb", "nba", "nfl", "nhl", "wnba"];
export function otherTeamTickerProblem(ticker: string, rule: Pick<BurnRule, "oracle" | "series"> | null | undefined): string | null {
  const e = rule && rule.oracle === "catalogue" && rule.series ? parseEspnSeries(rule.series) : null;
  if (!e || e.kind !== "team") return null;
  const t = ticker.trim().toUpperCase().replace(/^\$/, "");
  if (!/^[A-Z0-9]{2,10}$/.test(t)) return null;
  const own = new Set<string>();
  const mine = teamByAbbr(e.league, e.abbr);
  for (const x of [mine, e.window.kind === "meetings" ? teamByAbbr(e.league, e.window.opp) : null]) if (x) { own.add(x.abbr.toUpperCase()); own.add(teamCodeOf(x).toUpperCase()); }
  const base = t.replace(/(L|W|D)$/, "");
  if (own.has(t) || own.has(base)) return null;
  for (const lg of [...new Set([...PRO_LEAGUES, e.league])]) {
    let teams; try { teams = teamsOf(lg); } catch { continue; }
    const hit = teams.find((x) => [x.abbr, teamCodeOf(x)].map((c) => c.toUpperCase()).some((c) => c === t || (c === base && c.length >= 2)));
    if (hit) return `$${t} is the ticker of the ${hit.name} on this site, and this coin follows ${mine ? `the ${mine.name}` : "another team"}. Pick a ticker of your own, so nobody takes it for a ${hit.nickname} coin.`;
  }
  return null;
}

export function identityRefusals(s: IdentityInput, ctx: IdentityCtx = {}): (PreflightRefusal & { /** sources-7 round 2: the field it belongs to */ field: "name" | "ticker" | "description" | "note" })[] {
  const out: (PreflightRefusal & { field: "name" | "ticker" | "description" | "note" })[] = [];
  // the name's control characters are nameProblem's (launchFields.ts), which both the review and the bundle already run
  for (const [field, text] of [["description", s.description ?? ""], ["note", s.note ?? ""]] as const) { const c = controlCharProblem(text, field); if (c) out.push({ status: 400, code: "control-characters", message: c, field }); }
  let reserved: ReadonlySet<string> = new Set(), majors: ReadonlySet<string> = new Set();
  try { reserved = ctx.reserved ?? loadReserved(); } catch { /* an unreadable list refuses nothing */ }
  try { majors = ctx.majors ?? loadMajors(); } catch { /* the same */ }
  { const rp = reservedProblem(s, reserved); if (rp) out.push({ status: 403, code: "reserved", message: rp, field: rp === RESERVED_TICKER_REFUSAL ? "ticker" : "name" }); }
  { const mp = majorProblem(s, majors); if (mp) out.push({ status: 403, code: "major-ticker", message: mp, field: isReserved(s.ticker, majors) ? "ticker" : "name" }); }
  { const ot = otherTeamTickerProblem(s.ticker, ctx.rule); if (ot) out.push({ status: 403, code: "other-team-ticker", message: ot, field: "ticker" }); }
  if (ctx.refuseList !== false) try { const nr = nameRefusals(loadRefuseList(), s.name, s.ticker); if (nr.length) out.push({ status: 403, code: "refused", message: `This launch is refused: ${nr.map((x) => x.reason).join("; ")}`, field: "name" }); } catch { /* the bundle reads it again */ }
  if (ctx.existing) { const look = lookalikeRefusal({ ticker: s.ticker, name: s.name, rule: ctx.rule ?? null }, ctx.existing); if (look) out.push({ status: 409, code: "lookalike", message: look.reason, field: "ticker" }); }
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
