import "server-only";
import type { Platform } from "@/lib/burnticker/server";
import { cloneStore, cloneTerms, clonesJson, type ClonesJson } from "@/lib/burnticker/ops/cloneWatch";

/** The "Not Burnticker" list from this host's registry database (what the clone watch recorded) — the page and GET /v1/clones. */
export function clonesFor(p: Pick<Platform, "registry">, nowMs = Date.now()): ClonesJson {
  const tokens = p.registry.tokens().filter((t) => t.status !== "expired");
  return clonesJson(cloneStore(p.registry.db), cloneTerms(tokens.filter((t) => t.status !== "draft").map((t) => t.ticker)), new Set(p.registry.tokens().map((t) => t.mint)), nowMs);
}
