/** The update banner's words and path (DeployNotice.tsx reads them; a plain .ts file so node --test can import them). */
export const DEPLOY_NOTICE_PATH = "/deploying.json";
/**
 * HS-9 (continuous audit 2026-10-19): with no deploy running the host answers /deploying.json with {"deploying":false} (200, no-store;
 * deploy/caddy/Caddyfile @deploy_idle) instead of a 404 the browser logs every 20 s. The deploy's own file (written by
 * scripts/ops/deploy-burnticker-host.sh, {"deploying":true,...}; older ones carry no flag) still wins: the banner shows for any JSON
 * answer except one that says "deploying": false.
 */
export const DEPLOY_IDLE_BODY = '{"deploying":false}';
export function deployMarkerOn(r: { ok: boolean; contentType: string | null; body: string }): boolean {
  if (!r.ok || !(r.contentType ?? "").includes("json")) return false;
  try { const v = JSON.parse(r.body) as unknown; return !(v && typeof v === "object" && (v as { deploying?: unknown }).deploying === false); } catch { return false; }
}
/** The marker read the way DeployNotice.tsx and the error page read it. */
export async function readDeployMarker(fetchFn: typeof fetch = fetch, path: string = DEPLOY_NOTICE_PATH): Promise<boolean> {
  try { const r = await fetchFn(`${path}?t=${Date.now()}`, { cache: "no-store" }); return deployMarkerOn({ ok: r.ok, contentType: r.headers.get("content-type"), body: r.ok ? await r.text() : "" }); } catch { return false; }
}
export const DEPLOY_NOTICE_TEXT = "Burnticker is being updated. If a page or a launch fails in the next few minutes, wait a moment and try again. Coins and burns on chain are not affected.";
