import { DEPLOY_NOTICE_TEXT } from "@/lib/burnticker/deployNotice";

/**
 * THE ERROR PAGE'S WORDS (audit 2026-10-15 H7). A page that throws shows these inside the site's header and footer (error.tsx), or on its
 * own document when the root layout itself failed (global-error.tsx). Neutral by default: the deploy sentence only while /deploying.json
 * exists (the same check as the update banner), so a real bug is never blamed on an update. Every string passes the copy lint.
 */
export const ERROR_COPY = {
  kicker: "Something went wrong",
  heading: "This page could not be shown.",
  body: "Something failed while this page was loading. Coins and burns on chain are not affected. Try again, or start from one of the pages below.",
  deploying: DEPLOY_NOTICE_TEXT,
  retry: "Try again",
  coins: "See every coin",
  home: "Go to the home page",
  reference: "Reference for a report",
} as const;

/** True when the deploy marker exists (DeployNotice.tsx's check): the only time the error page mentions an update. */
export async function deployRunning(fetchFn: typeof fetch = fetch, path = "/deploying.json"): Promise<boolean> {
  try { const r = await fetchFn(`${path}?t=${Date.now()}`, { cache: "no-store" }); return r.ok && (r.headers.get("content-type") ?? "").includes("json"); } catch { return false; }
}
