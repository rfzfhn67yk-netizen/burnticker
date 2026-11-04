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
/**
 * When THIS server process started (unix ms; process-bound, never read from disk). The deploy's smoke (scripts/ops/swap-web-build.sh,
 * third prelaunch audit F02) requires it to be after its restart, so an answer from the old process (or a unit that did not restart)
 * cannot pass for the new build: BUILD_ID alone is read from disk and cached for 10 s.
 */
let startedAt: number | null = null;
export function processStartedAtMs(): number {
  if (startedAt === null) startedAt = Math.round(Date.now() - process.uptime() * 1000);
  return startedAt;
}
/** Tests only. */
export function resetBuildIdCache(): void { cache = null; }
