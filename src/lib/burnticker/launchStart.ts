/**
 * "LAUNCH A COIN" ALWAYS STARTS AT STEP 1 (owner, 2026-10-12: "if we are midway through creating a coin and hit the Launch a coin button
 * again, it should take us to the start screen again"). Arriving on the launch page never restores a draft by itself (it offers Resume);
 * a click on the header button, the header link or the Launch tab while already on the page sends this event, and the page goes back to
 * step 1 with the draft kept and offered. Client-safe.
 */
export const LAUNCH_PATH = "/burnticker/launch";
export const LAUNCH_START_EVENT = "bt:launch-start";

/** Called from a link's onClick: when the link goes to the launch page and the page is already open, step 1 is shown again. */
export function announceLaunchStart(href: string, w: { location: { pathname: string }; dispatchEvent(e: Event): boolean } | undefined = typeof window === "undefined" ? undefined : window): boolean {
  if (!w || href !== LAUNCH_PATH || w.location.pathname !== LAUNCH_PATH) return false;
  w.dispatchEvent(new Event(LAUNCH_START_EVENT));
  return true;
}
