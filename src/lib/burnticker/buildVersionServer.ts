import fs from "node:fs";
import path from "node:path";
import { usableBuildId } from "@/lib/burnticker/buildVersion";

/**
 * The build id this host serves now: `<distDir>/BUILD_ID` (next.config.ts distDir: NEXT_DIST_DIR or .next), read at most every 10 s.
 * Null in development (no BUILD_ID file, or "development") or when the file cannot be read, so the version check stays quiet. Server only.
 */
let cache: { at: number; id: string | null } | null = null;
export function currentBuildId(now = Date.now(), env: Readonly<Record<string, string | undefined>> = process.env, root = process.cwd()): string | null {
  if (cache && now - cache.at < 10_000) return cache.id;
  let id: string | null = null;
  try { const raw = fs.readFileSync(path.join(root, (env.NEXT_DIST_DIR ?? "").trim() || ".next", "BUILD_ID"), "utf8").trim(); id = usableBuildId(raw) ? raw : null; } catch { id = null; }
  cache = { at: now, id };
  return id;
}
/** Tests only. */
export function resetBuildIdCache(): void { cache = null; }
