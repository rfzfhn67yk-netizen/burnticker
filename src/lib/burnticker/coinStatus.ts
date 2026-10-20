/**
 * WHAT HAPPENS NEXT, IN ONE STATUS SENTENCE (coin card status, 2026-10-18; the owner's UX walkthrough at phone, tablet and desktop
 * widths). Every coin card leads with one plain sentence chosen by the coin's state, so a visitor does not have to read six numbers to
 * learn what the coin is waiting for:
 *
 *   retired / paused / draft      "Retired. No new result burns it."  "Paused. Burns wait until the operator resumes it."
 *   one-shot, decided             "Decided: Broncos won. Burns once the curve fills."  (or the side that does not burn, or the last burn)
 *   one-shot, waiting             "Waiting for the market to settle."  (a pair waiting on pools says so)
 *   rule ended                    "The rule has ended. Its burn pool burns down a little each day."
 *   live, with receipts           "Last burn 1,234 $RAYS on October 12."
 *   season / postseason / games   "Burns after each win this season."  (on its curve: "..., once the curve fills.")
 *   perpetual                     "Burns on each new reading."  (on its curve: "Burns on each new reading once the curve fills.")
 *
 * Two pure steps so the embed and share text can reuse it: coinStatusFactsOf reads the few facts it needs from a coin's status.json and
 * receipts (status, pair, latest reading, next, lifecycle, graduation), and coinStatusSentence turns those facts into the sentence. The
 * facts are small and JSON-safe, so the index and home routes send them with each coin and the client card builds the sentence.
 * Every sentence passes the copy lint (test/burntickerCoinStatus.test.ts). Client-safe: no file reads.
 */

export type CoinWindow = "one-shot" | "season" | "postseason" | "games" | "perpetual";

export interface CoinStatusFacts {
  status: "draft" | "live" | "paused" | "retired" | "expired";
  ticker: string;
  name: string;
  window: CoinWindow;
  /** the number of games for a "NEXT n GAMES" window; null otherwise */
  games: number | null;
  /** the side the rule burns on, read from its one-liner: after a win, after a loss, or null when it is neither or both */
  side: "win" | "lose" | "not" | null;
  /** review L1: a reading rule that counts only readings that rise or fall; null otherwise */
  readingDirection?: "up" | "down" | null;
  /** review M2: a fade coin ("burns on every game day the Eagles do not win"): the team as the rule names it and the verb it negates */
  fade?: { ref: string; verb: string } | null;
  /** the curve's phase, null when not read */
  phase: "curve" | "migrating" | "graduated" | null;
  /** the trading pool registered with the burn program; null when the program was not read */
  poolReady: boolean | null;
  /** the side the rule is about, by name ("Broncos"; coinCard.ts ruleSideName), never the coin's name; null for a market or a feed */
  sideName: string | null;
  /** a rivalry pair: the other coin's name, the other side's name when its status was read, and whether the pair waits on both pools */
  pair: { otherName: string; otherSideName: string | null; waiting: boolean } | null;
  /** a one-shot whose result is in: who won, whether this coin burns on it, and what the burn waits for */
  decision: {
    outcome: "this" | "other" | "draw" | "in" | "void";
    /** the settled result word of a one-shot outside a pair ("yes", "no", "win", a named outcome); null when not recorded */
    result: string | null;
    /** the result's receipt moved this coin's fuel to the pair's winner (status "forwarded") */
    forwarded: boolean;
    burnsThis: boolean;
    /** null when the burn went through, or when there is nothing to burn */
    hold: "pending-pair" | "curve" | "opening" | "pool" | "poolUnread" | "sending" | "other" | null;
  } | null;
  /** the newest confirmed burn: tokens burned (a decimal string) and when it settled (ISO) */
  lastBurn: { tokens: string; at: string } | null;
  /** the rule ended on a live coin: its pool is spent at once (drain) or a little each day (winddown) */
  ended: "drain" | "winddown" | null;
  /** continuous audit run 2, HB-16: what an undecided one-shot waits for, by its source (a market, the next earthquake, a feed); absent on older facts */
  waiting?: string | null;
}

/** The few status.json fields the facts read (pageTypes.ts TokenStatusJson), so a test can pass a small object. */
export interface StatusInput {
  status: string; ticker: string; name: string;
  /** the rule's oracle and selector (status.json oracle, selectorKey): which source an undecided one-shot waits for (HB-16) */
  oracle?: string | null; selectorKey?: string | null;
  rules: { oneShot: boolean };
  profile?: { badge?: string | null; oneLiner?: string | null; sideName?: string | null; readingDirection?: "up" | "down" | null } | null;
  market?: { phase: "curve" | "migrating" | "graduated" | null } | null;
  program?: { initialized: boolean; pool: { registered: boolean } } | null;
  pair?: { counterpart: { name: string }; clause?: { state: "live" | "waiting" | "voided" } | null; unpaired?: unknown } | null;
  lifecycle?: { ended: { mode: "drain" | "winddown" } | null } | null;
}
/** The receipt fields the facts read (pageTypes.ts ReceiptJson). */
export interface ReceiptInput { status: string; units: number; settledAt: string; burned?: string | null; pairRole?: "won" | "lost" | "draw" | null; kind?: string | null; result?: string | null }

/**
 * The keeper's end-of-rule receipts (registry.addEndReceipt: the wind-down days, the drain and the retired-coin sweep). They are not the
 * result a one-shot waited for, so the decision is read past them, as multiKeeper.ts detectRuleEnd does (its END_KINDS; this copy keeps
 * the client bundle free of the keeper, and test/burntickerCoinStatus.test.ts holds the two equal).
 */
export const END_KINDS: ReadonlySet<string> = new Set(["winddown", "drain", "sweep"]);

const STATUSES = ["draft", "live", "paused", "retired", "expired"] as const;

/** The window from the coin's badge (describe.ts windowBadge) and its rule's one-shot flag. */
export function windowOf(badge: string | null | undefined, oneShot: boolean): { window: CoinWindow; games: number | null } {
  const b = (badge ?? "").toUpperCase();
  if (oneShot || b.startsWith("ONE-SHOT")) return { window: "one-shot", games: null };
  const n = /^NEXT (\d+) GAMES?\b/.exec(b);
  if (n) return { window: "games", games: Number(n[1]) };
  if (b.includes("POSTSEASON")) return { window: "postseason", games: null };
  if (b.includes("SEASON")) return { window: "season", games: null };
  return { window: "perpetual", games: null };
}

/** Review M2: the fade side's one-liner (describe.ts espnText, rules.ts inverse): "burns on every game day the Eagles do not win". */
const FADE = /\bburns on every game day (.+?) do(?:es)? not (win|lose|draw)\b/i;
export function fadeOf(oneLiner: string | null | undefined): { ref: string; verb: string } | null {
  const m = FADE.exec(oneLiner ?? "");
  return m ? { ref: m[1], verb: m[2].toLowerCase() } : null;
}
/**
 * The side a rule burns on, from its one-liner ("burns when the Eagles lose" → "lose"); "not" for a fade coin ("... the Eagles do not
 * win"); null for both sides, a draw, or neither.
 */
export function sideOf(oneLiner: string | null | undefined): "win" | "lose" | "not" | null {
  if (fadeOf(oneLiner) || /\bdo(?:es)? not (win|lose|draw)\b/i.test(oneLiner ?? "")) return "not";
  const t = (oneLiner ?? "").toLowerCase();
  const win = /\bwins?\b/.test(t), lose = /\blos(e|es|ing|s)\b/.test(t), other = /\b(draws?|ties?)\b/.test(t);
  if (lose && !win && !other) return "lose";
  if (win && !lose && !other) return "win";
  return null;
}

/**
 * HB-16: the waiting sentence of an undecided one-shot, by its source. Only a market (Polymarket, Kalshi) waits for "the market to settle";
 * the next-earthquake coin waits for the next qualifying earthquake; a game waits for its final; any other feed waits for its source.
 * With no oracle in the input (an older caller), the market sentence stays.
 */
export function waitingSentenceOf(oracle: string | null | undefined, selectorKey: string | null | undefined): string {
  if (!oracle || oracle === "polymarket" || oracle === "kalshi") return STATUS_SENTENCES.waitingMarket;
  const quake = /(?:^|:)usgs\.quakenext:(\d(?:\.5)?)(?:\/|$)/.exec(selectorKey ?? "");
  if (quake) return `Waiting for the next magnitude ${quake[1]} earthquake.`;
  if (oracle === "espn" || /(?:^|:)espn\./.test(selectorKey ?? "")) return STATUS_SENTENCES.waitingGame;
  return STATUS_SENTENCES.waitingSource;
}

const BADGE_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** The day a one-shot badge states ("ONE-SHOT · Oct 15, 2026" gives "2026-10-15"); null when it states none. Client-safe. */
export function badgeDay(badge: string | null | undefined): string | null {
  const m = /ONE-SHOT\s*·\s*([A-Z][a-z]{2}) (\d{1,2}), (\d{4})/.exec(badge ?? "");
  if (!m) return null;
  const mo = BADGE_MONTHS.indexOf(m[1]);
  return mo < 0 ? null : `${m[3]}-${String(mo + 1).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

const NO_BURN = new Set(["nothing", "void", "voided", "forwarded", "exhausted"]);

/** `other`: the pair's other coin's status, when the caller read it (its side's name names the winner on the losing side). */
export function coinStatusFactsOf(s: StatusInput, receipts: readonly ReceiptInput[], other: Pick<StatusInput, "profile"> | null = null): CoinStatusFacts {
  const status = (STATUSES as readonly string[]).includes(s.status) ? (s.status as CoinStatusFacts["status"]) : "live";
  const { window, games } = windowOf(s.profile?.badge, s.rules.oneShot);
  const phase = s.market?.phase ?? null;
  const poolReady = s.program ? s.program.initialized && s.program.pool.registered : null;
  const pair = s.pair && !s.pair.unpaired ? { otherName: s.pair.counterpart.name, otherSideName: other?.profile?.sideName ?? null, waiting: s.pair.clause?.state === "waiting" } : null;
  const byTime = [...receipts].sort((a, b) => (a.settledAt < b.settledAt ? 1 : a.settledAt > b.settledAt ? -1 : 0));
  const confirmed = byTime.find((r) => r.status === "confirmed" && Number(r.burned ?? 0) > 0) ?? null;
  // review H1: the newest RESULT receipt; a drain or wind-down receipt after it is not the decision (nor the burn the result waits for)
  const latest = byTime.find((r) => !END_KINDS.has(r.kind ?? "")) ?? null;
  let decision: CoinStatusFacts["decision"] = null;
  if (window === "one-shot" && latest) {
    const isVoid = latest.status === "void" || latest.status === "voided";
    const outcome: NonNullable<CoinStatusFacts["decision"]>["outcome"] = isVoid ? "void" : latest.pairRole === "won" ? "this" : latest.pairRole === "lost" ? "other" : latest.pairRole === "draw" ? "draw" : "in";
    const burnsThis = !isVoid && latest.units > 0 && !NO_BURN.has(latest.status);
    const hold = !burnsThis || latest.status === "confirmed" ? null
      : latest.status === "pending-pair" ? "pending-pair"
      // review L2: a full curve moving to its pool is not waiting for the curve to fill
      : phase === "curve" ? "curve"
      : phase === "migrating" ? "opening"
      // review L3: "not registered" only when the program was read and says so; an unread program is said as unread
      : poolReady === false && latest.status !== "planned" && latest.status !== "sending" ? "pool"
      : poolReady === null && latest.status !== "planned" && latest.status !== "sending" ? "poolUnread"
      : latest.status === "planned" || latest.status === "sending" ? "sending" : "other";
    decision = { outcome, result: latest.result ? latest.result.trim() || null : null, forwarded: latest.status === "forwarded", burnsThis, hold };
  }
  return {
    status, ticker: s.ticker, name: s.name, window, games, side: sideOf(s.profile?.oneLiner), fade: fadeOf(s.profile?.oneLiner), readingDirection: s.profile?.readingDirection ?? null, sideName: s.profile?.sideName ?? null, phase, poolReady, pair, decision,
    lastBurn: confirmed ? { tokens: confirmed.burned ?? "0", at: confirmed.settledAt } : null,
    // PROD-05: an end receipt shows the rule ended even when the caller did not pass the lifecycle block
    ended: s.lifecycle?.ended?.mode ?? (byTime.some((r) => r.kind === "drain") ? "drain" : byTime.some((r) => r.kind === "winddown") ? "winddown" : null),
    waiting: window === "one-shot" && !decision ? waitingSentenceOf(s.oracle, s.selectorKey) : null,
  };
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** "October 12" from an ISO time (the UTC calendar day); null when it does not parse. */
export function dayInWords(iso: string): string | null {
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00Z` : iso);
  return Number.isFinite(d.getTime()) ? `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}` : null;
}

/** "1,234.5" from a decimal string, two decimals at most. */
function tokensText(v: string): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  const [i, f] = (Math.round(n * 100) / 100).toFixed(2).split(".");
  const dec = f.replace(/0+$/, "");
  return `${i.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${dec ? `.${dec}` : ""}`;
}

/** "Last burn 1,234 $RAYS on October 12." */
export function lastBurnSentence(f: Pick<CoinStatusFacts, "ticker" | "lastBurn">): string | null {
  if (!f.lastBurn) return null;
  const day = dayInWords(f.lastBurn.at);
  return `Last burn ${tokensText(f.lastBurn.tokens)} $${f.ticker}${day ? ` on ${day}` : ""}.`;
}

/** The fixed sentences, by state; the tests lint each one. */
export const STATUS_SENTENCES = {
  draft: "Not launched yet.",
  expired: "This draft expired, so it never launched.",
  retired: "Retired. No new result burns it.",
  paused: "Paused. Burns wait until the operator resumes it.",
  waitingMarket: "Waiting for the market to settle.",
  waitingGame: "Waiting for the game's final result.",
  waitingSource: "Waiting for its source to publish the result.",
  waitingPair: "Waiting for both coins in the pair to reach a trading pool.",
  endedDrain: "The rule has ended. Its burn pool is being spent down.",
  endedWinddown: "The rule has ended. Its burn pool burns down a little each day.",
  perpetual: "Burns on each new reading.",
  perpetualWin: "Burns after each win.",
  perpetualLose: "Burns after each loss.",
  /** the featured cards: $DEFICIT before its create, the disclosed $REHEARSAL coin, the devnet practice run */
  notCreated: "Not created yet.",
  practice: "This site does not track this practice coin's burns.",
  devnetDone: "The devnet practice run is over.",
} as const;

/** What follows "Decided: ..." for a one-shot, by what its burn waits for. */
export const DECIDED_TAILS = {
  void: "Nothing burns on it.",
  notThis: "This coin does not burn on it.",
  notThisDrain: "Its burn pool is being spent down.",
  notThisWinddown: "Its burn pool now burns down a little each day.",
  /** HB-50 (run 4): a coin still on its curve has no pool to burn from, so its wind-down waits for graduation */
  winddownOnCurve: "Its burn pool winds down once the coin graduates.",
  /** review M1: a pair's losing side burns nothing of its own; once its fuel moves or its rule ends, its pool goes to the winner */
  toWinner: "Its pool goes to the winning coin.",
  "pending-pair": "Burns once both coins in the pair have a trading pool.",
  curve: "Burns once the curve fills.",
  opening: "Burns once its trading pool opens.",
  pool: "Burns once its trading pool is registered.",
  poolUnread: "The pool state has not been read yet.",
  sending: "The burn is being sent.",
  other: "The burn is on hold.",
} as const;

/**
 * Review H2: the decision names the winning SIDE (the team's nickname from the rule), never the coin's name. In a pair the losing side
 * names the other side when its status was read, else says its own side lost. A one-shot outside a pair names its side and the result
 * ("Decided: Eagles won.") or, for a market, the outcome ("Decided: the market settled Yes."). With no side name, "Decided: the result is in."
 */
const WON = /^(yes|win|won)$/i, LOST = /^(no|loss|lose|lost)$/i;
function decidedHead(f: CoinStatusFacts, d: NonNullable<CoinStatusFacts["decision"]>): string {
  const IN = "Decided: the result is in.";
  if (d.outcome === "void") return "Decided: the result was voided.";
  if (d.outcome === "draw") return "Decided: a draw.";
  if (d.outcome === "this") return f.sideName ? `Decided: ${f.sideName} won.` : IN;
  if (d.outcome === "other") return f.pair?.otherSideName ? `Decided: ${f.pair.otherSideName} won.` : f.sideName ? `Decided: ${f.sideName} lost.` : IN;
  const r = d.result;
  if (!r) return IN;
  if (f.sideName && WON.test(r)) return `Decided: ${f.sideName} won.`;
  if (f.sideName && LOST.test(r)) return `Decided: ${f.sideName} lost.`;
  if (/^yes$/i.test(r)) return "Decided: the market settled Yes.";
  if (/^no$/i.test(r)) return "Decided: the market settled No.";
  // a named outcome ("Arsenal", "Over 2.5"): short words only, never a raw id
  return /^[\p{L}][\p{L}\p{N} .'&-]{0,39}$/u.test(r) && !f.sideName ? `Decided: the market settled on ${r.replace(/\.$/, "")}.` : IN;
}

/**
 * Follow-up 2026-10-18: a season or perpetual coin still on its curve cannot burn before graduation, so its sentence says both facts:
 * "Burns after each win this season, once the curve fills." and "Burns on each new reading once the curve fills."
 */
export const ON_CURVE = "once the curve fills";
function windowSentence(f: CoinStatusFacts): string {
  const each = f.side === "not" && f.fade ? `each game ${f.fade.ref} do not ${f.fade.verb}` : f.side === "win" ? "each win" : f.side === "lose" ? "each loss" : "each result that counts";
  const curve = f.phase === "curve";
  const end = curve ? `, ${ON_CURVE}.` : ".";
  if (f.window === "season") return `Burns after ${each} this season${end}`;
  if (f.window === "postseason") return `Burns after ${each} this postseason${end}`;
  if (f.window === "games") return `Burns after ${each} in its next ${f.games === 1 ? "game" : `${f.games ?? "few"} games`}${end}`;
  if (f.side === "win" || f.side === "lose" || (f.side === "not" && f.fade)) return `Burns after ${each}${end}`;
  return readingSentence(f.readingDirection ?? null, curve);
}

/**
 * Review L1: a reading coin. Only a qualifying reading burns, so a rule that counts rises says "each new reading that rises" ($DEFICIT:
 * the Treasury's debt), and a coin still on its curve adds that it waits for the curve: "Burns on each new reading that rises once the
 * curve fills."
 */
export function readingSentence(direction: "up" | "down" | null, onCurve: boolean): string {
  const which = direction === "up" ? " that rises" : direction === "down" ? " that falls" : "";
  return `Burns on each new reading${which}${onCurve ? ` ${ON_CURVE}` : ""}.`;
}

/** The card's one status sentence (sometimes two short ones: the decision, then what the burn waits for). */
export function coinStatusSentence(f: CoinStatusFacts): string {
  if (f.status === "draft") return STATUS_SENTENCES.draft;
  if (f.status === "expired") return STATUS_SENTENCES.expired;
  if (f.status === "retired") return STATUS_SENTENCES.retired;
  if (f.status === "paused") return STATUS_SENTENCES.paused;
  if (f.window === "one-shot") {
    const d = f.decision;
    if (!d) return f.pair?.waiting ? STATUS_SENTENCES.waitingPair : f.waiting ?? STATUS_SENTENCES.waitingMarket;
    const head = decidedHead(f, d);
    // PROD-05: a voided one-shot whose rule has ended still burns down its pool; "Nothing burns on it" only while nothing does
    const onCurve = f.phase === "curve" || f.phase === "migrating";
    const tail = d.outcome === "void" ? (f.ended === "winddown" ? (onCurve ? DECIDED_TAILS.winddownOnCurve : DECIDED_TAILS.notThisWinddown) : f.ended === "drain" ? DECIDED_TAILS.notThisDrain : DECIDED_TAILS.void)
      : !d.burnsThis && d.outcome === "other" && f.pair ? (f.ended || d.forwarded ? DECIDED_TAILS.toWinner : DECIDED_TAILS.notThis)
      : !d.burnsThis ? (f.ended === "winddown" ? (onCurve ? DECIDED_TAILS.winddownOnCurve : DECIDED_TAILS.notThisWinddown) : f.ended === "drain" ? DECIDED_TAILS.notThisDrain : DECIDED_TAILS.notThis)
      : d.hold === null ? lastBurnSentence(f) ?? DECIDED_TAILS.other
      : DECIDED_TAILS[d.hold];
    return `${head} ${tail}`;
  }
  if (f.ended === "winddown") return STATUS_SENTENCES.endedWinddown;
  if (f.ended === "drain") return STATUS_SENTENCES.endedDrain;
  return lastBurnSentence(f) ?? windowSentence(f);
}
