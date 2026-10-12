/**
 * THE LAUNCH PAGE'S GATE, RESOLVED BEFORE ANY CONTROL RENDERS (website brief 2026-10-11 §1: "the launch page briefly displays the
 * wizard, then replaces it with 'Creator launches are not open yet'"). The page reads GET /api/burnticker/catalogue once; until it
 * answers the page shows a neutral skeleton (EmptyState "loading"), never the wizard. Four states:
 *
 *   loading      the catalogue has not answered
 *   closed       the host says `launches.creators !== true` (BURNTICKER_CREATOR_LAUNCHES_ENABLED off — the default)
 *   open         the host says `launches.creators === true`
 *   preview      launch audit 5 L02: the host says `launches.mode === "preview"` (BURNTICKER_CREATOR_LAUNCHES_PREVIEW): the wizard and
 *                the review card render under a persistent banner; the wallet button is disabled with the reason; nothing builds
 *   unavailable  the catalogue could not be read: launch controls stay hidden (fail closed) and the page says the data is unavailable
 *
 * `open` and `preview` render the wizard; only `open` lets it ask for a bundle. Pure; the page and test/burntickerWebsite2.test.ts share it.
 */
export type LaunchGateState =
  | { kind: "loading" }
  | { kind: "closed"; cluster: string | null }
  | { kind: "open"; cluster: string | null }
  | { kind: "preview"; cluster: string | null }
  | { kind: "unavailable"; detail: string };

export const LAUNCH_GATE_LOADING: LaunchGateState = { kind: "loading" };

/** From the catalogue body (or null when the request failed / was not JSON, with the reason). */
export function launchGateFromCatalogue(body: unknown, failure: string | null = null): LaunchGateState {
  if (failure !== null) return { kind: "unavailable", detail: failure };
  if (!body || typeof body !== "object") return { kind: "unavailable", detail: "the catalogue answered without a JSON object" };
  const j = body as { launches?: { creators?: unknown; mode?: unknown }; cluster?: unknown };
  const cluster = typeof j.cluster === "string" ? j.cluster : null;
  return j.launches?.creators === true ? { kind: "open", cluster } : j.launches?.mode === "preview" ? { kind: "preview", cluster } : { kind: "closed", cluster };
}

/** True only when the wizard (search box, tiles, review card) may render: open, or the read-only preview. */
export const wizardMayRender = (s: LaunchGateState): s is Extract<LaunchGateState, { kind: "open" | "preview" }> => s.kind === "open" || s.kind === "preview";
/** True only when the wizard may ask for a bundle and open the wallet (open mode). */
export const wizardMaySign = (s: LaunchGateState): boolean => s.kind === "open";

/** The closed page's network line: what this host shows while creator launches are closed. */
export function closedNetworkLine(cluster: string | null): string {
  return cluster ? `This host currently shows ${cluster} information.` : "";
}
