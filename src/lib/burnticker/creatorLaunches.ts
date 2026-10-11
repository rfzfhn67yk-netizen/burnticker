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

export function creatorLaunchesEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return /^(1|true|yes|on)$/i.test((env[CREATOR_LAUNCHES_FLAG] ?? "").trim());
}

/** The refusal body for a creator launch route while the flag is off (HTTP 403), or null when creator launches are open. */
export function creatorLaunchRefusal(env: Record<string, string | undefined> = process.env): { status: 403; body: { error: string; code: string } } | null {
  return creatorLaunchesEnabled(env) ? null : { status: 403, body: { error: CREATOR_LAUNCHES_CLOSED, code: CREATOR_LAUNCHES_CODE } };
}
