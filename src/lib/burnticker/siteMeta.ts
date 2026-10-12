import { siteLaunchState } from "@/lib/burnticker/launchAvailability";
import { HERO } from "@/lib/burnticker/siteNav.mjs";

/**
 * THE SEARCH AND SOCIAL PREVIEW WORDS (BT-21, 2026-10-11; website-13, 2026-10-12, Claude site audit 2 item 1): website-12's site launch
 * record (launchAvailability.ts siteLaunchState) writes the description, the current headline followed by the one launch sentence, read
 * from the host at request time. Nothing here types "open" or "closed". The app layout reads it.
 */
export const META_TITLE = `Burnticker: ${HERO.title.replace(/\.$/, "")}`;
export function metaDescription(env: Readonly<Record<string, string | undefined>> = process.env): string {
  return siteLaunchState(env).meta.description;
}
