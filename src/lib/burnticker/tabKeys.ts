/**
 * ARROW KEYS ON A TAB LIST (prelaunch audit 2026-10-18, A-29): the coins tabs and the coin and pair page tabs follow the ARIA tabs
 * pattern. Only the selected tab is in the Tab order (roving tabindex); Left and Right move to the previous and next tab and wrap,
 * Home and End go to the first and last, and moving selects the tab. Pure and client-safe; the pages focus the returned tab's button.
 */
export function tabForKey<T>(tabs: readonly T[], current: T, key: string): T | null {
  const i = tabs.indexOf(current), n = tabs.length;
  if (i < 0 || n === 0) return null;
  if (key === "ArrowRight") return tabs[(i + 1) % n];
  if (key === "ArrowLeft") return tabs[(i - 1 + n) % n];
  if (key === "Home") return tabs[0];
  if (key === "End") return tabs[n - 1];
  return null;
}

/** The tab list's onKeyDown: select the tab the key names and move focus to its button (`idOf` gives the button's id). */
export function tabKeyHandler<T>(tabs: readonly T[], current: T, select: (t: T) => void, idOf: (t: T) => string) {
  return (e: { key: string; preventDefault(): void }): void => {
    const next = tabForKey(tabs, current, e.key);
    if (next === null) return;
    e.preventDefault();
    select(next);
    if (typeof document !== "undefined") document.getElementById(idOf(next))?.focus();
  };
}
