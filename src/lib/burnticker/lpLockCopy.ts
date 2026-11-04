/**
 * THE LIQUIDITY LOCK IN WORDS, BEFORE AND AFTER GRADUATION (sixth pass B-16 a/b, HB-56, HS-21; 2026-10-19). Every coin's JSON said
 * `lpLockedPct: 100` and every page said "The liquidity is locked forever." while no coin had a pool yet. The lock is made at graduation
 * by the LaunchLab platform settings, and until a coin migrates those settings sit under the operator's LaunchLab admin key (it changed
 * the platform config on 19 October 2026), not under the burn program. A coin before graduation says so; `lockedPct` is null until then.
 * Client-safe; every sentence passes the copy lint (test/burntickerSixthPass.test.ts).
 */
export const LP_LOCKED_LINE = "The liquidity is locked forever.";
export const LP_BEFORE_GRADUATION_LINE = "When this coin graduates, all of its liquidity is locked forever. Until then, the platform settings that lock it can be changed by the operator's LaunchLab admin key, and the Trust page shows those settings live.";
/** The trust page's form of the same fact, for every coin rather than one. */
export const LP_BEFORE_GRADUATION_TRUST = "A coin's liquidity is locked when it graduates, not before. Until a coin graduates, the LaunchLab platform settings that make the lock can be changed by the operator's LaunchLab admin key, not by the burn program. The settings are read live on this page.";

/** The coin's lock sentence: locked once it has graduated (a locked percentage is known), the before-graduation sentence until then. */
export const lpLockLine = (lockedPct: number | null | undefined): string => (typeof lockedPct === "number" ? LP_LOCKED_LINE : LP_BEFORE_GRADUATION_LINE);
/** The second half alone, after a sentence that already says the lock happens at graduation. */
export const LP_ADMIN_KEY_LINE = "Until this coin graduates, the platform settings that lock its liquidity can be changed by the operator's LaunchLab admin key, and the Trust page shows those settings live.";
