/**
 * The pre-launch primary action (website brief 2026-10-11 §1/§5): "Explore a verified burn" opens the check page with the featured
 * devnet receipt pre-selected (the receipt itself is named once, in config/burnticker/current-status.json `demo`, and the check page
 * resolves `?demo=1` against it). Client-safe: no file reads, so the launch gate, the coin page and the static pages can all link it.
 */
export const EXPLORE_VERIFIED_BURN = {
  label: "Explore a verified burn",
  href: "/burnticker/check?demo=1#verify",
  blurb: "A real devnet receipt from the rehearsal: the source reading, the rule, the transaction and every check, run in your browser.",
} as const;

/** The one destination for "Seasons" on every surface (header, footer, landing door, leagues index). */
export const SEASONS_HREF = "/burnticker/leagues";
