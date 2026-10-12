# A one-game coin's rule ends before its result is read (found by sources-2, 2026-10-12; not fixed)

A coin on one game (`espn.game:<league>-<event>-<ABBR>-<win|loss|draw>`) looks like it never burns on its result. This note tracks the
problem. The keeper flow is not changed here.

## Where

- src/lib/burnticker/sources/espn.ts:426. For a game series, `windowStatus` says `ended: !!g?.completed`, so the window ends as soon as
  the game is final.
- src/lib/burnticker/sources/gameSettle.ts:225. `sportsSettled` gives no reading until 6 hours after the start
  (`SETTLE_AFTER_START_MS`, espn.ts:306) and counts the game as awaiting until then. The same call returns the ended window
  (gameSettle.ts:239).
- src/lib/burnticker/multiKeeper.ts:162. `fetchDue` calls `recordWindowEnd` on every read, and multiKeeper.ts:119 marks the rule ended
  (wind-down) for every live coin on the selector that carries `onEnd`. Every launch since 2026-10-10 carries it.
- src/lib/burnticker/multiKeeper.ts:773. `planToken` runs only while `!d.registry.ruleEnd(t.mint)`.

## The sequence

1. The game starts at T. Around T+3 h it is final, and the next fetch sees `completed`.
2. That fetch returns no reading, because T+3 h is less than T+6 h. It does return `window.ended = true`, so `recordWindowEnd` marks the
   rule ended.
3. At T+6 h or later, a fetch writes the game's reading. `planToken` is skipped because the rule has ended. The result receipt is never
   planned, and the coin goes straight to its wind-down without the burn its rule promised.

Team-season windows are probably safe: their end waits for `SEASON_END_GRACE_MS` past the last game. That should be checked the same way.

## Proposed fix (keeper owner to decide)

Either of these would work:

- Make the window end follow the reading: for `s.kind === "game"`, return
  `ended: !!g?.completed && Date.parse(g.startsAt) + SETTLE_AFTER_START_MS <= nowMs` (espn.ts:426), and only after the game's reading
  has been written or refused.
- Or, in the planning pass, a coin whose rule ended because of its window still plans readings dated on or before the end
  (`r.at <= ruleEnd.at`). That needs a cutoff parameter in `planToken`, and it would also cover any future windowed source.

The first fix is smaller. The second protects every windowed series.

## Failing test sketch

```ts
// test/burntickerWindows.test.ts (sketch): a one-game coin with onEnd, keeper deps over fixtures
// 1. registry with one live token on espn.game:mlb-<eventId>-TB-win, rule with onEnd (DEFAULT_ON_END)
// 2. clock at start + 3h, game completed in the schedule fixture, primary payout resolved (fakeGameDeps)
await runCycle(deps);                         // fetchDue: no reading yet (under 6 h), window.ended = true
assert.equal(registry.ruleEnd(mint), null);   // FAILS today: the rule is already marked ended
// 3. clock at start + 7h
await runCycle(deps);
assert.ok(registry.receipt(mint, gameDate));  // FAILS today: the reading is written but never planned
```
