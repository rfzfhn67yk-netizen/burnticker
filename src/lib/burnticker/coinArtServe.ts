import "server-only";
import { lockRule } from "@/lib/burnticker/rules";
import { describeRule } from "@/lib/burnticker/describe";
import { renderCoinSvg } from "@/lib/burnticker/coinArt";
import type { Registry } from "@/lib/burnticker/registry";
import { lookupCoin, sharedTickerText } from "@/lib/burnticker/coinLookup";

/**
 * Serving the coin image (coinArt.ts): `<TICKER>.svg|.png` from the registry's locked rule, or `preview.svg|.png?t=&r=` from a rule the
 * wizard is still editing (base64url JSON; validated and hashed exactly like a launch). Rendered once per (rule hash, ticker, format)
 * and cached in memory; a registered coin's image never changes because its rule never does.
 */
const cache = new Map<string, { body: Uint8Array; type: string }>();
const MAX = 500;
/** The longest base64url rule a preview takes (a pair side's rule with every field set is well under it). */
export const PREVIEW_RULE_MAX_CHARS = 16_000;

/** `<TICKER>.svg` while one coin holds the ticker, `<MINT>.svg` always; a ticker several coins share answers 300 naming their mints (owner 2026-10-12). */
export async function coinImage(o: { registry: Pick<Registry, "token" | "tokenByTicker" | "tokensByTicker" | "lockedRule">; file: string; query: URLSearchParams }): Promise<{ status: number; body: Uint8Array | string; type: string }> {
  const m = /^([A-Za-z0-9]{2,44}|preview)\.(svg|png)$/.exec(o.file);
  if (!m) return { status: 404, body: "not found", type: "text/plain; charset=utf-8" };
  const [, name, fmt] = m;
  let ticker: string, rule, sha: string, oneLiner: string | null = null;
  try {
    if (name === "preview") {
      // audit 2026-10-18 A-42: the encoded rule is capped before it is decoded and parsed (a real rule is a few kilobytes)
      if ((o.query.get("r") ?? "").length > PREVIEW_RULE_MAX_CHARS) return { status: 400, body: "The rule in this address is too long to draw.", type: "text/plain; charset=utf-8" };
      const raw = Buffer.from(o.query.get("r") ?? "", "base64url").toString("utf8");
      const locked = lockRule(JSON.parse(raw), { stored: true });
      ticker = (o.query.get("t") ?? "TICKER").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10) || "TICKER";
      rule = locked.rule; sha = locked.sha256; oneLiner = (o.query.get("l") ?? "").slice(0, 120) || null;
    } else {
      const l = lookupCoin(o.registry, name);
      if (l.kind === "many") return { status: 300, body: sharedTickerText(l), type: "text/plain; charset=utf-8" };
      if (l.kind === "none") return { status: 404, body: name.length >= 32 ? `no coin with the mint ${name}` : `no coin $${name.toUpperCase()}`, type: "text/plain; charset=utf-8" };
      const t = l.token;
      const locked = o.registry.lockedRule(t);
      ticker = t.ticker; rule = locked.rule; sha = locked.sha256;
    }
  } catch (e) { return { status: 400, body: `rule: ${(e as Error).message.slice(0, 160)}`, type: "text/plain; charset=utf-8" }; }
  const key = `${sha}:${ticker}:${oneLiner ?? ""}:${fmt}`;
  const hit = cache.get(key);
  if (hit) return { status: 200, ...hit };
  const svg = renderCoinSvg({ ticker, oneLiner: oneLiner ?? describeRule(rule, { ticker }).oneLiner, rule, sha256: sha });
  let out: { body: Uint8Array; type: string };
  if (fmt === "svg") out = { body: new TextEncoder().encode(svg), type: "image/svg+xml" };
  else { const sharp = (await import("sharp")).default; out = { body: new Uint8Array(await sharp(Buffer.from(svg)).png().toBuffer()), type: "image/png" }; }
  if (cache.size > MAX) cache.clear();
  cache.set(key, out);
  return { status: 200, ...out };
}
