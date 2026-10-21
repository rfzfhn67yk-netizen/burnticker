/**
 * A SINGLE-GAME COIN'S SCHEDULE IN WORDS (owner, 2026-10-16 and 2026-10-18; owner, 2026-10-20: read as soon as the game is final, and burned once a second check five minutes later agrees), AND WHICH POLYMARKET MARKETS ARE ONE GAME (owner, 2026-10-16). No imports: the launch page, the
 * describe text, the Polymarket adapter and gameSettle.ts all read these. The schedule itself is gameSettle.ts gameSchedule.
 */
export const GAME_BURN_LINE = "A game coin burns once its final has been read and a second read five minutes later agrees.";
/** HB-157 (hourly run 15): the same settlement rule as GAME_BURN_LINE, said for a pair's "When the game is final" row. */
export const GAME_RESULT_COUNTS_LINE = "The result counts once its final has been read and a second read five minutes later agrees.";
/**
 * Where a game's final is first read, by league (coordinator 2026-10-20, confirmed against the code): MLB and NHL from the league's own
 * feed (gameSettle.ts officialOf); the NBA's official feed is not counted (espn.ts NBA_OFFICIAL_ANSWERS false), and NFL and soccer have
 * none, so those finals come from TheSportsDB's schedule (a 10-minute cache today). The second agreeing read comes five minutes later in
 * every league.
 */
export const GAME_FINAL_SOURCES_LINE = "MLB and NHL finals are read from the league's own schedule, which is read every minute while a tracked game is played. NBA, NFL and soccer finals are read from TheSportsDB's schedule, usually five to twenty minutes after the final whistle. In every league the burn waits for a second read five minutes after the first.";
export const GAME_AGREE_LINE ="Every source that reads the game must agree, and a disagreement holds the burn until they do.";
/**
 * Whether a Polymarket market is ONE GAME and so runs on the game-coin schedule (owner, 2026-10-16: one schedule for every game coin):
 *   - a two-team moneyline: Gamma sportsMarketType "moneyline", or no type at all, with a game start and two team outcomes (not Yes/No,
 *     not Over/Under);
 *   - a soccer yes/no leg of a game's three-way moneyline: type "moneyline", outcomes Yes/No, and a question shaped like
 *     "Will Coventry City FC win on 2026-10-12?" or "Will Arsenal FC vs. Leeds United FC end in a draw?".
 * Anything else is not a game: a yes/no question without that type and shape (CLARITY "Clarity Act…", TWOCUTS "Will 2 Fed rate cuts…"),
 * and spreads, totals and props (their own sportsMarketType), which keep their old cadence.
 */
const YES_NO = /^(yes|no)$/i;
const GAME_LEG = /^will .+ (win on \d{4}-\d{2}-\d{2}|end in a draw)\??$/i;
export const isGameMoneyline = (m: { sportsMarketType?: string | null; gameStartTime?: string | null; outcomes?: readonly string[] | null; question?: string | null }): boolean => {
  const outs = m.outcomes ?? [];
  if (outs.length !== 2) return false;
  if (outs.every((o) => YES_NO.test(o))) return m.sportsMarketType === "moneyline" && GAME_LEG.test((m.question ?? "").trim());
  const type = m.sportsMarketType ?? null;
  return (type === "moneyline" || type === null) && !!m.gameStartTime && !outs.some((o) => /^(yes|no|over|under)$/i.test(o.trim()));
};
