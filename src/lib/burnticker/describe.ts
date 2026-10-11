import type { BurnRule } from "@/lib/burnticker/rules";
import { LEAGUES, noPlayoffs, parseEspnSeries, seasonLabel, seasonStartYear, teamByAbbr, type EspnSeries, type LeagueId, type Window } from "@/lib/burnticker/sources/espn";
import { parseNwsSeries, stationByCode } from "@/lib/burnticker/sources/nws";

/**
 * THE AUTO-GENERATED COIN TEXT (2026-10-10, the owner thinks in sentences): from the LOCKED RULE, by deterministic templates — no model —
 * a name, a ticker, a one-liner ("burns when the Rays win") and a 3–4 sentence paragraph: what it tracks, exactly when and how much it
 * burns, the settlement source and its cross-read, what happens on the other outcome, the end, and "Creator earns nothing; all LP
 * burned." Every template is built from words the copy lint (config/launch/copy-lint.json) allows; test/burntickerDescribe.test.ts
 * generates the text for every fixture rule and lints it.
 *
 *   flavour   "$RAYS26 — burns when the Rays win."         editable on the create screen
 *   ruleBlock the remaining sentences                       locked: re-rendered from the rule and the ticker, never typed; it always
 *             carries exactly ONE WINDOW SENTENCE (the owner: "the coin's window must be unmissable") — a season coin's "This coin
 *             covers the 2026 Eagles season only (regular season and playoffs). After the Eagles' last game it burns down whatever is
 *             left over four weeks and retires; it does not continue into 2027.", a perpetual coin's "No end date — this coin does not
 *             retire.", a one-shot's "Resolves once on <date>; then it burns down over four weeks and retires."
 *   badge     "2026 SEASON" / "POSTSEASON 2026" / "NEXT 5 GAMES" / "PERPETUAL" / "ONE-SHOT · Oct 31, 2026" — the coin card, the coin
 *             page header, the pair page, the token metadata's first description line and the footer of every post
 *   paragraph flavour + " " + ruleBlock                     the registry draft's description, the token metadata `description`,
 *                                                           the coin page header, the first daily post
 *
 * Client-safe (the wizard re-renders it as the ticker changes): no node imports.
 */

export interface DescribeCtx {
  ticker: string;
  /** What a market rule is about, in words ("the Rays win the 2026 World Series", "Abdul El-Sayed (D) wins the Michigan Senate race"). */
  eventPhrase?: string | null;
  /** The cross-read named in the text ("MLB's official results", "the Michigan certified result"). */
  crossRead?: string | null;
  /** ISO date the rule ends by (a market's end date; a game's start; a window's last game once known). */
  endsAt?: string | null;
  /** True once the window has ended (windowStatus): the badge then carries the end date. */
  ended?: boolean | null;
  /** A first-party feed rule: the feed's title, source and unit label. */
  feed?: { title: string; sourceName: string; unitLabel: string; crossRead?: string | null } | null;
  /** A name and ticker to suggest instead of the template's (the intent cards know "Rays WS"). */
  suggest?: { name: string; ticker: string } | null;
  /** For a one-game rule: the opponent and the date. */
  game?: { opponent: string; home: boolean; startsAt: string } | null;
}
/** The window kinds a coin can have; every description carries exactly one sentence of its kind (WINDOW_SENTENCE). */
export type WindowKind = "season" | "post" | "next" | "perpetual" | "one-shot";
export interface CoinText { name: string; ticker: string; oneLiner: string; flavour: string; ruleBlock: string; windowSentence: string; windowKind: WindowKind; badge: string; paragraph: string; shape: "recurring" | "one-shot" }

const CLOSER = "Creator earns nothing; all LP burned.";
const BURN_DOWN = "it burns down whatever is left over four weeks and retires";
export const PERPETUAL_SENTENCE = "No end date — this coin does not retire.";
/** One pattern per window kind; a description matches exactly one of them, exactly once (test/burntickerDescribe.test.ts). */
export const WINDOW_SENTENCE: Record<WindowKind, RegExp> = {
  season: /This coin covers the [^.]*? season only \((?:regular season and playoffs|every match of the competition)\)\. After [^.]*? last game it burns down whatever is left over four weeks and retires(?:; it does not continue into [^.]+)?\./g,
  post: /This coin covers [^.]*? postseason only\. After [^.]*? last playoff game it burns down whatever is left over four weeks and retires(?:; it does not continue into [^.]+)?\./g,
  next: /This coin covers [^.]*? next \d+ games? only, from [^.]*?\d{4}\. After game \d+ it burns down whatever is left over four weeks and retires\./g,
  perpetual: /No end date — this coin does not retire\./g,
  "one-shot": /Resolves once(?: on [A-Z][a-z]{2} \d{1,2}, \d{4}|, on [^;]+)?; then it burns down over four weeks and retires\./g,
};
const fractionText = (r: BurnRule): string => {
  const m = (r.kind === "binary" ? (r.binary?.onYes ?? r.binary?.onNo) : r.scalar?.perUnit) as { fractionOfPool?: number; tokens?: number } | null | undefined;
  return m?.tokens !== undefined ? `${m.tokens.toLocaleString("en-US")} tokens from its vault` : `${Math.round((m?.fractionOfPool ?? 0) * 1000) / 10}%`;
};
const spends = (r: BurnRule, t: string) => { const p = fractionText(r); return p.endsWith("vault") ? `burns ${p}` : `the burn pool spends ${p} buying $${t} on Raydium and burns it`; };
const possessive = (n: string) => (n.endsWith("s") ? `${n}'` : `${n}'s`);
/** "Oct 31, 2026" (America/Denver). */
export const shortDate = (iso: string | null | undefined): string | null => (iso ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00Z` : iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Denver" }) : null);
const day = shortDate;
export const tickerFrom = (s: string, suffix = ""): string => { const base = s.toUpperCase().replace(/[^A-Z0-9]/g, ""); return (base.slice(0, Math.max(2, 10 - suffix.length)) + suffix).slice(0, 10); };
const CROSS: Record<string, string> = { nhl: "NHL's official scores", mlb: "MLB's official feed", nba: "NBA's official feed" };
const CHAMP_CODE: Record<string, string> = { mlb: "WS", nfl: "SB", nba: "TITLE", nhl: "CUP" };
const yy = (league: LeagueId, year: number) => String(seasonStartYear(league, year) % 100).padStart(2, "0");
const nextSeason = (league: LeagueId, year: number) => seasonLabel(league, year + 1);
/** League mode (rules.ts `set`): the conditional forward, in the description whenever the rule carries it. */
export const leagueSentence = (r: BurnRule): string => (r.set && r.set.forwardBps > 0 ? ` League mode: ${Math.round(r.set.forwardBps) / 100}% of the leftover goes to the winning coin of set ${r.set.id}, if the forwarding instruction is live by season end; otherwise the leftover burns down on this coin.` : "");
const oneShotSentence = (iso: string | null | undefined, onWhat: string | null = null) => (onWhat ? `Resolves once, on ${onWhat}; then it burns down over four weeks and retires.` : `Resolves once${iso ? ` on ${day(iso)}` : ""}; then it burns down over four weeks and retires.`);

/** The coin's window kind from its rule alone. */
export function windowKindOf(r: BurnRule): WindowKind {
  const series = r.oracle === "catalogue" ? r.series ?? "" : "";
  const e = series ? parseEspnSeries(series) : null;
  if (e) return e.kind === "game" ? "one-shot" : e.window.kind === "legacy" ? (e.window.scope === "post" ? "post" : "season") : e.window.kind;
  if (/^nws\.snow:/.test(series)) return "one-shot";
  if (r.oracle === "polymarket" || r.market) return "one-shot";
  return "perpetual";
}

/** The window badge: "2026 SEASON", "POSTSEASON 2026", "NEXT 5 GAMES", "PERPETUAL", "ONE-SHOT · Oct 31, 2026" (+ the end once known). */
export function windowBadge(r: BurnRule, ctx: Pick<DescribeCtx, "endsAt" | "ended"> = {}): string {
  const series = r.oracle === "catalogue" ? r.series ?? "" : "";
  const e = series ? parseEspnSeries(series) : null;
  const end = ctx.endsAt ? day(ctx.endsAt) : null;
  const ended = ctx.ended && end ? ` · ENDED ${end}` : "";
  if (e?.kind === "team") {
    const w = e.window;
    if (w.kind === "season") return `${seasonLabel(e.league, w.year)} SEASON${ended}`;
    if (w.kind === "post") return `POSTSEASON ${seasonLabel(e.league, w.year)}${ended}`;
    if (w.kind === "next") return `NEXT ${w.n} GAME${w.n === 1 ? "" : "S"}${end ? ` · ENDS ${end}` : ""}`;
    if (w.kind === "perpetual") return "PERPETUAL";
    return `${w.scope === "post" ? "POSTSEASON" : "THIS SEASON"}${ended}`;
  }
  if (windowKindOf(r) === "one-shot") return `ONE-SHOT${end ? ` · ${end}` : ""}`;
  return "PERPETUAL";
}

function espnText(r: BurnRule, s: EspnSeries, c: DescribeCtx): CoinText {
  const team = teamByAbbr(s.league, s.abbr)!, nick = team.nickname, t = c.ticker, o = s.outcome, L0 = LEAGUES[s.league];
  // "the Rays", "the Lakers" — but "Arsenal", "Inter Miami", "Georgia": clubs and colleges go without the article
  const ref = L0.sport === "soccer" || s.league === "cfb" || s.league === "mcbb" || s.league === "wcbb" ? nick : `the ${nick}`;
  const Ref = ref[0].toUpperCase() + ref.slice(1), poss = possessive(ref);
  const tie = L0.draws ? "draw" : "tie";
  const verb = o === "win" ? "win" : o === "draw" ? "draw" : "lose", noun = o === "win" ? "win" : o === "draw" ? "draw" : "loss";
  const other = o === "win" ? `a loss or a ${tie}` : o === "draw" ? "a win or a loss" : `a win or a ${tie}`;
  const sfx = o === "win" ? "" : o === "draw" ? "D" : "L", Noun = o === "win" ? "Wins" : o === "draw" ? "Draws" : "Losses";
  const cross = CROSS[s.league] ?? "a second independent source";
  const badge = windowBadge(r, c);
  const mk = (name: string, ticker: string, oneLiner: string, rules: string, windowSentence: string, windowKind: WindowKind, shape: CoinText["shape"]): CoinText => {
    const ruleBlock = `${rules} ${windowSentence}${leagueSentence(r)} ${CLOSER}`;
    return { name: name.slice(0, 32), ticker, oneLiner, flavour: `$${t} — ${oneLiner}.`, ruleBlock, windowSentence, windowKind, badge, paragraph: `$${t} — ${oneLiner}. ${ruleBlock}`, shape };
  };
  if (s.kind === "team") {
    const w: Window = s.window;
    const settle = `Each game settles on the game's on-chain payout where a market exists, else on a licensed final score, confirmed by ${cross}. Nothing happens on ${other}.`;
    const oneLiner = `burns when ${ref} ${verb}`;
    const every = (scope: string) => `Every ${nick} ${noun} ${scope}, ${spends(r, t)}, with a receipt on chain. ${settle}`;
    if (w.kind === "season") {
      const L = seasonLabel(s.league, w.year);
      return mk(`${nick} ${L} ${Noun}`, tickerFrom(nick, `${sfx}${yy(s.league, w.year)}`), oneLiner, every(`in the ${L} season`),
        `This coin covers the ${L} ${nick} season only (${noPlayoffs(s.league) ? "every match of the competition" : "regular season and playoffs"}). After ${poss} last game ${BURN_DOWN}; it does not continue into ${nextSeason(s.league, w.year)}.`, "season", "recurring");
    }
    if (w.kind === "post") {
      const L = seasonLabel(s.league, w.year);
      return mk(`${nick} ${L} Playoffs`, tickerFrom(nick, `${sfx}P${yy(s.league, w.year)}`), `${oneLiner} in the postseason`, every(`in the ${L} postseason`),
        `This coin covers ${poss} ${L} postseason only. After ${poss} last playoff game ${BURN_DOWN}; it does not continue into ${nextSeason(s.league, w.year)}.`, "post", "recurring");
    }
    if (w.kind === "next") {
      const from = `${w.from.slice(0, 4)}-${w.from.slice(4, 6)}-${w.from.slice(6)}`;
      return mk(`${nick} Next ${w.n}`, tickerFrom(nick, `${sfx}${w.n}G`), `${oneLiner}, next ${w.n} game${w.n === 1 ? "" : "s"}`, every(`in their next ${w.n} game${w.n === 1 ? "" : "s"}`),
        `This coin covers ${poss} next ${w.n} game${w.n === 1 ? "" : "s"} only, from ${day(from)}. After game ${w.n} ${BURN_DOWN}.`, "next", "recurring");
    }
    if (w.kind === "perpetual") {
      return mk(`${nick} ${Noun}`, o === "win" ? tickerFrom(nick) : tickerFrom(nick, o === "draw" ? "DRAW" : "LOSE"), oneLiner, `${every("in any game, every season")} Off-season days read nothing; the pool keeps filling and readings resume with the next season's first game.`,
        PERPETUAL_SENTENCE, "perpetual", "recurring");
    }
    const scope = w.scope === "post" ? "this postseason" : w.scope === "reg" ? "for the rest of the regular season" : "this season";
    return mk(`${nick} ${Noun}`, tickerFrom(nick, o === "win" ? "WIN" : o === "draw" ? "DRAW" : "LOSE"), oneLiner, every(scope),
      w.scope === "post" ? `This coin covers ${poss} current postseason only. After ${poss} last playoff game ${BURN_DOWN}.` : `This coin covers the current ${nick} season only (regular season and playoffs). After ${poss} last game ${BURN_DOWN}.`, w.scope === "post" ? "post" : "season", "recurring");
  }
  const opp = c.game ? (L0.sport === "soccer" || s.league === "cfb" || s.league === "mcbb" || s.league === "wcbb" ? c.game.opponent : `the ${c.game.opponent}`) : null;
  const vs = c.game ? ` ${c.game.home ? "against" : "at"} ${opp}${c.game.startsAt ? ` on ${day(c.game.startsAt)}` : ""}` : ` in game ${s.eventId}`;
  const oneLiner = `burns if ${ref} ${verb}${c.game ? ` ${c.game.home ? "against" : "at"} ${opp}` : " that game"}`;
  return mk(`${nick} ${o === "win" ? "Win" : o === "draw" ? "Draw" : "Lose"}`, tickerFrom(nick, o === "win" ? "WIN" : o === "draw" ? "DRAW" : "LOSE"), oneLiner, `If ${ref} ${verb}${vs}, ${spends(r, t)} once, with a receipt on chain. Settled on the game's on-chain payout where a market exists, else on a licensed final score, confirmed by ${cross}. Nothing happens otherwise${o === "draw" ? "" : `, and a ${tie} burns nothing`}.`,
    oneShotSentence(c.game?.startsAt ?? c.endsAt), "one-shot", "one-shot");
}

/** The coin's name, ticker, one-liner and paragraph from its rule. `ctx.ticker` is the ticker the text names (the suggestion when empty). */
export function describeRule(r: BurnRule, ctx: DescribeCtx): CoinText {
  const series = r.oracle === "catalogue" ? r.series ?? "" : "";
  const e = series ? parseEspnSeries(series) : null;
  if (e) { const t0 = espnText(r, e, { ...ctx, ticker: ctx.ticker || "TICKER" }); return ctx.ticker ? t0 : espnText(r, e, { ...ctx, ticker: t0.ticker }); }
  const n = series ? parseNwsSeries(series) : null;
  const badge = windowBadge(r, ctx);
  const build = (name0: string, tk0: string, oneLiner: string, block: (t: string) => string, windowSentence: string, shape: CoinText["shape"]): CoinText => {
    const name = ctx.suggest?.name ?? name0, tk = ctx.suggest?.ticker ?? tk0;
    const t = ctx.ticker || tk, ruleBlock = `${block(t)} ${windowSentence}${leagueSentence(r)} ${CLOSER}`;
    return { name: name.slice(0, 32), ticker: tk, oneLiner, flavour: `$${t} — ${oneLiner}.`, ruleBlock, windowSentence, windowKind: windowKindOf(r), badge, paragraph: `$${t} — ${oneLiner}. ${ruleBlock}`, shape };
  };
  if (n) {
    const st = stationByCode(n.station)!;
    const what = n.metric === "high" ? `every day ${possessive(st.city)} official high reaches ${n.threshold} °F` : n.metric === "rain" ? `every day ${st.city} gets ${n.threshold.toFixed(2)} in of rain or more` : `on ${possessive(st.city)} first measurable snow of the season`;
    const other = n.metric === "high" ? "a cooler day" : n.metric === "rain" ? "a drier day" : "a day without snow";
    const oneLiner = n.metric === "high" ? `burns on every ${st.city} day at ${n.threshold} °F or hotter` : n.metric === "rain" ? `burns on every ${st.city} day with ${n.threshold.toFixed(2)} in of rain` : `burns on ${possessive(st.city)} first snow`;
    return build(`${st.city} ${n.metric === "high" ? "Heat" : n.metric === "rain" ? "Rain" : "Snow"}`, tickerFrom(st.code, n.metric === "high" ? "HOT" : n.metric === "rain" ? "RAIN" : "SNOW"), oneLiner,
      (t) => `${what[0].toUpperCase()}${what.slice(1)}, ${spends(r, t)}${n.metric === "snow" ? " once" : ""}, with a receipt on chain. Settled on the National Weather Service's daily climate report, cross-checked against the Iowa Environmental Mesonet. Nothing happens on ${other}.`,
      n.metric === "snow" ? oneShotSentence(null, `the first snow`) : PERPETUAL_SENTENCE, n.metric === "snow" ? "one-shot" : "recurring");
  }
  if (r.oracle === "catalogue" && ctx.feed) {
    const f = ctx.feed;
    return build(f.title.split(/[(—,]/)[0].trim().slice(0, 32), tickerFrom(f.title.replace(/^U\.?S\.?\s+/i, "").split(/[\s(,—-]/)[0]), `burns per ${f.unitLabel} · ${f.title.split(/[(—,]/)[0].trim()}`,
      (t) => `For every ${f.unitLabel}, ${spends(r, t)}, with a receipt on chain. Settled on ${f.sourceName}, cross-checked against ${f.crossRead ?? "a second publisher"}. Nothing happens on a move smaller than one unit.`, PERPETUAL_SENTENCE, "recurring");
  }
  if (r.oracle === "polymarket" && r.market) {
    const phrase = (ctx.eventPhrase ?? "the market resolves YES").replace(/\s*\(resolves once\)$/, "");
    const subj = phrase.replace(/^the /i, "").split(/\s+(?:wins?|win)\b/i)[0];
    return build(`${subj.replace(/\s*\([A-Z]\)$/, "").split(" ").pop() ?? "Event"} Wins`.slice(0, 32), tickerFrom(subj.replace(/\s*\([A-Z]\)$/, "").split(" ").pop() ?? "EVENT"), `burns if ${phrase}`,
      (t) => `If it happens, ${spends(r, t)} once, with a receipt on chain. Settled on Polymarket's on-chain payout, cross-checked against ${ctx.crossRead ?? "the official result"}. Nothing happens otherwise.`, oneShotSentence(ctx.endsAt), "one-shot");
  }
  const what = ctx.eventPhrase ?? r.series ?? r.market ?? "the source";
  const yes = r.kind !== "binary" || !!r.binary?.onYes;
  const once = windowKindOf(r) === "one-shot";
  return build("Event Coin", tickerFrom(what), r.kind === "binary" ? `burns when ${what} settles ${yes ? "YES" : "NO"}` : `burns on each settled reading of ${what}`,
    (t) => `${r.kind === "binary" ? `Each time ${what} settles ${yes ? "YES" : "NO"}` : `Each time ${what} settles`}, ${spends(r, t)}, with a receipt on chain. Settled on ${r.oracle === "polymarket" ? "Polymarket's on-chain payout" : "its published source"}${ctx.crossRead ? `, cross-checked against ${ctx.crossRead}` : ""}. Nothing happens otherwise.`,
    once ? oneShotSentence(ctx.endsAt) : PERPETUAL_SENTENCE, once ? "one-shot" : "recurring");
}

/**
 * The badge for a registered coin: from its locked rule, with a one-shot's date read back from its own description's window sentence
 * ("Resolves once on Oct 31, 2026") and the end marked once the coin is retired.
 */
export function badgeFromText(r: BurnRule, description: string, retired = false): string {
  const m = /Resolves once on ([A-Z][a-z]{2} \d{1,2}, \d{4})/.exec(description);
  const endsAt = m && !Number.isNaN(Date.parse(`${m[1]} 12:00 UTC`)) ? new Date(Date.parse(`${m[1]} 12:00 UTC`)).toISOString() : null;
  const b = windowBadge(r, { endsAt });
  return retired && !/ENDED/.test(b) ? `${b} · ENDED` : b;
}

/** The championship short code for a league ("WS" for MLB) — the one-shot coin's ticker suffix. */
export const championshipCode = (league: string): string => CHAMP_CODE[league] ?? "CHAMP";
export { LEAGUES };

/** The launch route's description limit (launchBundle.launchProblems; raised from 400 on 10-10 for the window sentence). Every template
 *  stays inside it; the wizard keeps the editable flavour inside what is left. */
export const DESCRIPTION_MAX = 800;
