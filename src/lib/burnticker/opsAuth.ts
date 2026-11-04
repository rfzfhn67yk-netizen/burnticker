import { createHash, timingSafeEqual } from "node:crypto";

/**
 * WHO MAY READ AN OPS ROUTE (Burnticker's own copy of the rule the operator's other ops surfaces use, so the public tree carries no
 * private module): the request's Host is the operator's own network — loopback, the shared-address overlay range (RFC 6598), or a name in
 * BURNTICKER_OPS_HOSTS — AND the `x-action-pin` header equals the ops PIN (BURNTICKER_OPS_PIN, else MCT_ACTION_PIN). No PIN configured
 * → closed (503), never open. Compared as SHA-256 digests in constant time.
 */
export const OPS_PIN_HEADER = "x-action-pin";
type Env = Readonly<Record<string, string | undefined>>;

export function opsHost(req: Request, env: Env = process.env): boolean {
  const raw = (req.headers.get("host") ?? "").toLowerCase();
  const name = raw.startsWith("[") ? raw.slice(1, raw.indexOf("]")) : raw.split(":")[0];
  if (name === "localhost" || name === "127.0.0.1" || name === "::1") return true;
  const m = /^100\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(name);
  if (m && Number(m[1]) >= 64 && Number(m[1]) <= 127) return true;
  return (env.BURNTICKER_OPS_HOSTS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean).includes(name);
}
export function opsPinMatches(got: string, want: string): boolean {
  const a = createHash("sha256").update(got).digest(), b = createHash("sha256").update(want).digest();
  return timingSafeEqual(a, b);
}
/** Null when the request may read; else why not (403 / 503 / 401). */
export function opsDenied(req: Request, env: Env = process.env): { status: number; error: string; code: string } | null {
  if (!opsHost(req, env)) return { status: 403, error: "ops routes answer only on the operator's own network", code: "not-ops-host" };
  const want = ((env.BURNTICKER_OPS_PIN ?? "").trim() || (env.MCT_ACTION_PIN ?? "").trim());
  if (!want) return { status: 503, error: "no ops PIN is configured (BURNTICKER_OPS_PIN): ops routes stay closed", code: "pin-unset" };
  if (!opsPinMatches(req.headers.get(OPS_PIN_HEADER) ?? "", want)) return { status: 401, error: `the ${OPS_PIN_HEADER} header is missing or wrong`, code: "pin" };
  return null;
}
