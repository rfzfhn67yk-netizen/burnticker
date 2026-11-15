import { CANDIDATES_PAIR_SENTENCE, GAME_PAIR_DETAIL, GAME_PAIR_SENTENCE } from "@/lib/burnticker/describe";
import { SHARE_PRESETS } from "@/lib/burnticker/launchPresets";

/**
 * THE TWO-COIN FORMS, ONE DESCRIBER (audit 12 item 3, 2026-10-13). Two routes said one thing and built another: the rivalry option
 * "Their next game only" promised two coins that each burn on their own team's loss with no SOL moving, and the "losing team's coin
 * burns" search card opened a linked pair where the WINNING team's coin takes the burn. The keeper runs both forms today:
 *
 *   game-linked             one game, two coins linked at creation (rules.ts pair.game): the winning team's coin burns its whole pool and
 *                           takes the losing team's coin's pool; this is what the launch page builds for one game
 *   game-independent-loss   one game, two separate single-game coins (sources-6), each burning once if its own team loses; no SOL moves
 *   candidates-linked       two candidates in one race (pair.race)
 *   season-independent      every loss this season, two separate coins
 *
 * Search cards, the pattern options, the preview and the review read their words from here, so the words follow what is built.
 * Client-safe. Plain words: no prices, no dates.
 */
export type PairForm = "game-linked" | "game-independent-loss" | "candidates-linked" | "season-independent";
export interface PairFormCopy { form: PairForm; linked: boolean; label: string; sentence: string; detail: string; shares: readonly number[] }

export function pairFormCopy(form: PairForm, o: { gameLabel?: string | null } = {}): PairFormCopy {
  const which = o.gameLabel ? `Their game on ${o.gameLabel} only` : "Their next game only";
  const when = o.gameLabel ? `When their game on ${o.gameLabel} is final` : "When their next listed game is final";
  switch (form) {
    case "game-linked": return { form, linked: true, label: `${which}, winner takes the burn`, sentence: `${when}, the winning team's coin burns its whole pool and takes the losing team's coin's pool. The two coins are linked, so SOL moves to the winner. After a draw, both pools go to $DEFICIT's burn.`, detail: GAME_PAIR_DETAIL, shares: SHARE_PRESETS.linkedOneShot };
    case "game-independent-loss": return { form, linked: false, label: `${which}, two separate coins`, sentence: `${when}, each coin burns once if its own team lost. The two coins are not linked, so no SOL moves between them.`, detail: "One coin per team. Each burns once if its own team loses that game. A tie burns neither, and no SOL moves between them.", shares: SHARE_PRESETS.oneShot };
    case "candidates-linked": return { form, linked: true, label: "Winner takes the burn", sentence: CANDIDATES_PAIR_SENTENCE, detail: CANDIDATES_PAIR_SENTENCE, shares: SHARE_PRESETS.linkedOneShot };
    case "season-independent": return { form, linked: false, label: "Each time its own team loses", sentence: "Each coin spends a share of its own burn pool after each game its team loses, this season. The two coins are not linked, so no SOL moves between them.", detail: "One coin per team, each burning from its own pool.", shares: SHARE_PRESETS.recurring };
  }
}

/** A search card's title and how-it-settles line for one game between two teams, in the form the card opens. */
export function gameCardCopy(eventName: string, form: "game-linked" | "game-independent-loss" = "game-linked"): { title: string; howSettles: string } {
  return form === "game-linked"
    ? { title: `Two linked coins on ${eventName}: the winning team's coin takes the burn`, howSettles: `${GAME_PAIR_SENTENCE} ${GAME_PAIR_DETAIL}` }
    : { title: `Two separate coins on ${eventName}: each burns if its own team loses`, howSettles: pairFormCopy("game-independent-loss").detail };
}
