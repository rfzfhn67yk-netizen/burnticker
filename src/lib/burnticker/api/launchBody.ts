/**
 * THE LAUNCH REQUEST'S FIELDS (prelaunch audit 2026-10-18 A-3 follow-up). The page's launch route (/api/burnticker/launch) and the public
 * /v1/launch/bundle keep only the top-level fields a launch reads; anything else is dropped before the body reaches a check, a fingerprint
 * or a log, so an unknown field can never change what is prepared. Nested objects (`pair`, `rule`, `walletProof` …) are checked by
 * their own readers. Pure.
 */
export const LAUNCH_BODY_FIELDS: readonly string[] = [
  // the record of a landed launch (the page route's action: "launched"), of a create about to be sent (action: "sent"; B-2),
  // and the plan record's launch-gate read (SEC-03)
  "action", "launchTx", "sentTx", "gate",
  // LA7 fix B: the sign card's note that a version-1 dry run was refused and the create fell back to version 0 (ops log only)
  "formatFallback",
  // the coin
  "creator", "mint", "ticker", "name", "description", "descCtx", "note", "imageUrl", "links", "rule", "firstBuySol", "raiseSol", "acknowledgements",
  // the creator's own profile (website-15 item 13)
  "creatorDescription", "image", "imageRights", "imageBadge",
  // a linked pair (side B) and its venue
  "pair", "venue",
  // the request itself: the wallet's signature over it (A-3), one prepare per draft, the deploy smoke's dry run, the page's timings
  "walletProof", "idempotencyKey", "dryRun", "timings",
  // the public API's own options
  "recentBlockhash", "register",
];
const KEEP = new Set(LAUNCH_BODY_FIELDS);

/** The body with its unknown top-level fields dropped (a non-object is returned as is, for the caller's own refusal). */
export function launchBodyOf<T>(body: T): T {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  return Object.fromEntries(Object.entries(body as Record<string, unknown>).filter(([k]) => KEEP.has(k))) as T;
}
