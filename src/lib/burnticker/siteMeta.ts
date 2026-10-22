import { siteLaunchState } from "@/lib/burnticker/launchAvailability";
import { HERO } from "@/lib/burnticker/siteNav.mjs";

/**
 * THE SEARCH AND SOCIAL PREVIEW WORDS (BT-21, 2026-10-11; website-13, 2026-10-12, Claude site audit 2 item 1): website-12's site launch
 * record (launchAvailability.ts siteLaunchState) writes the description. Since the prelaunch audit of 2026-10-16 (F-12/F-13) it names
 * no launch state, because statically built pages bake it in at build time. Nothing here types "open" or "closed". The layout reads it.
 */
export const META_TITLE = `Burnticker: ${HERO.title.replace(/\.$/, "")}`;
export function metaDescription(env: Readonly<Record<string, string | undefined>> = process.env): string {
  return siteLaunchState(env).meta.description;
}
