/**
 * ONE THEME PREFERENCE FOR THE WHOLE SITE (site audit #6, 2026-10-11). The decision: the static pages (home, whitepaper, status) RESPECT
 * the app's light/dark switch rather than the app guessing from the referrer. All of them are on burnticker.com, so one localStorage key
 * (`bt-theme`) is shared: a visitor who picks a theme on any page sees it on every page. With no stored choice every surface is dark,
 * whatever the operating system prefers (the owner's review item 17, 2026-10-12; the switch stays). Each page runs THEME_BOOT before
 * paint (the static pages carry the same text, held equal by
 * test/burntickerSiteNav.test.ts). The $DEFICIT site is a separate origin and brand (its LED board is dark by design) and is not themed.
 */
export type Theme = "dark" | "light";
export const THEME_KEY = "bt-theme";
export const THEME_BOOT = "(function(){try{var t=localStorage.getItem('bt-theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t;}catch(e){}})();";

export function currentTheme(): Theme {
  if (typeof document === "undefined") return "dark";
  const set = document.documentElement.dataset.theme;
  return set === "light" ? "light" : "dark";
}

/**
 * THEME_BOOT's work again, after hydration (prelaunch audit 2026-10-18 A-24; ThemeSync.tsx calls it): the stored choice is set on the
 * root when it is not there already. A missing, unknown or unreadable choice changes nothing (the default is dark).
 */
export function reapplyStoredTheme(root: { dataset: DOMStringMap }, storage: Pick<Storage, "getItem"> | null): void {
  try {
    const t = storage?.getItem(THEME_KEY);
    if ((t === "light" || t === "dark") && root.dataset.theme !== t) root.dataset.theme = t;
  } catch { /* storage blocked: the default (dark) stays */ }
}
