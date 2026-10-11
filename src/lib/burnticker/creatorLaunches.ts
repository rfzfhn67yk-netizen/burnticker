/**
 * CREATOR LAUNCHES (host flag, 2026-10-11; owner decision LAUNCHPAD-PATH §45): `BURNTICKER_CREATOR_LAUNCHES_ENABLED`, default OFF. Off,
 * the launch page and every creator launch route (POST /api/burnticker/launch, POST /v1/launch/bundle, POST /v1/launch/confirm) refuse
 * with one plain sentence, and the catalogue says `launches.creators: false`. The operator's own coins ($REHEARSAL, $DEFICIT) do not go
 * through these routes: they launch with the operator CLI (scripts/burnkeeper-launch.mts + scripts/burnreceipts-admin.mts, then the
 * registry by hand — runbook "Launch day" and "Add a token by hand"), which this flag does not touch.
 * Client-safe (no node imports): the wizard imports the sentence.
 */
export const CREATOR_LAUNCHES_FLAG = "BURNTICKER_CREATOR_LAUNCHES_ENABLED";
/** The refusal, word for word (lint-clean: a fact, no "coming soon"). */
export const CREATOR_LAUNCHES_CLOSED = "Creator launches are not open yet. $DEFICIT is the first coin.";
export const CREATOR_LAUNCHES_CODE = "creator-launches-closed";
/**
 * WHERE EVERY $DEFICIT LINK GOES (review 2 §2, 2026-10-11: the header went to the coin site, the launch page to /burnticker/t/DEFICIT,
 * which said "no token"). One served destination: the $DEFICIT site, until $DEFICIT is registered on this host — then the coin page
 * (`deficitHref(true)`). The app's nav, the launch page, the coin page's "not registered" state and the landing page all use it.
 */
export const DEFICIT_SITE = "https://deficit.burnticker.com/";
export const DEFICIT_COIN_PAGE = "/burnticker/t/DEFICIT";
export const deficitHref = (registeredHere: boolean): string => (registeredHere ? DEFICIT_COIN_PAGE : DEFICIT_SITE);

export function creatorLaunchesEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return /^(1|true|yes|on)$/i.test((env[CREATOR_LAUNCHES_FLAG] ?? "").trim());
}

/** The refusal body for a creator launch route while the flag is off (HTTP 403), or null when creator launches are open. */
export function creatorLaunchRefusal(env: Record<string, string | undefined> = process.env): { status: 403; body: { error: string; code: string } } | null {
  return creatorLaunchesEnabled(env) ? null : { status: 403, body: { error: CREATOR_LAUNCHES_CLOSED, code: CREATOR_LAUNCHES_CODE } };
}

/**
 * ONE AVAILABILITY STATE FOR EVERY LAUNCH CTA (review 2 §2 "Cut first", 2026-10-11): the coins page's "Launch a coin" / "Launch the
 * first one", a league page's team launch links, the templates' "Start from this", a coin or pair page's "Launch one like this", the
 * rivalries page's wizard link and the landing page's Launch door all read this — server pages from the env, client pages and the static
 * landing from the catalogue's `launches.creators` (GET /api/burnticker/catalogue). Unknown (the catalogue not read yet, or unreadable)
 * is CLOSED: a CTA appears only once the host says creator launches are open.
 */
export interface LaunchAvailability { open: boolean; cluster: string | null; closedLine: string }
/** The line shown where the launch CTAs were, while creator launches are closed. */
export function closedHostLine(cluster: string | null): string {
  return `Creator launches are closed.${cluster ? ` This host currently shows ${cluster} information.` : ""}`;
}
/** Server pages: the same flag the catalogue reports. */
export function launchAvailability(env: Record<string, string | undefined> = process.env, cluster: string | null = null): LaunchAvailability {
  const open = creatorLaunchesEnabled(env);
  return { open, cluster, closedLine: closedHostLine(cluster) };
}
/** Client pages: from the catalogue response; anything but an explicit `launches.creators: true` is closed. */
export function launchAvailabilityFromCatalogue(j: unknown): LaunchAvailability {
  const c = (j ?? {}) as { launches?: { creators?: unknown }; cluster?: unknown };
  const cluster = typeof c.cluster === "string" ? c.cluster : null;
  return { open: c.launches?.creators === true, cluster, closedLine: closedHostLine(cluster) };
}
/** Before the catalogue answers: closed, no cluster named. */
export const LAUNCH_AVAILABILITY_UNKNOWN: LaunchAvailability = { open: false, cluster: null, closedLine: closedHostLine(null) };
