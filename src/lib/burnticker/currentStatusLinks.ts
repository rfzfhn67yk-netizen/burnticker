/**
 * The pre-launch primary action (website brief 2026-10-11 §1/§5; UX report 3 item 2 renamed it): "Inspect the devnet receipt" opens the check page with the featured
 * devnet receipt pre-selected (the receipt itself is named once, in config/burnticker/current-status.json `demo`, and the check page
 * resolves `?demo=1` against it). Client-safe: no file reads, so the launch gate, the coin page and the static pages can all link it.
 */
export const EXPLORE_VERIFIED_BURN = {
  label: "Inspect the devnet receipt",
  href: "/burnticker/check?demo=1#verify",
  blurb: "A real devnet receipt from the rehearsal: the source reading, the rule, the transaction and every check, run in your browser.",
} as const;

/** The one destination for "Seasons" on every surface (header, footer, landing door, leagues index). */
export const SEASONS_HREF = "/burnticker/leagues";

/** The prerequisite chain from mint to first receipt (docs/burnticker/FIRST-BURN-PATH.md), in the public repository. */
export const FIRST_BURN_PATH_URL = "https://github.com/rfzfhn67yk-netizen/burnticker/blob/main/docs/burnticker/FIRST-BURN-PATH.md";
