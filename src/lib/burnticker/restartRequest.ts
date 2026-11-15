import fs from "node:fs";
import path from "node:path";

/**
 * DEPLOY-REQUESTED RESTART (2026-10-15). The Burnticker keeper and the mint bank run from source, so they only pick up shipped code on a
 * restart, and a keeper must never be restarted mid-crank. The deploy (scripts/ops/deploy-burnticker-host.sh) therefore does not
 * restart them: it drops one request file per unit, `data/restart-requested.<unit>` holding {"build","at"}, and each loop checks for its
 * own file at the END of a cycle (between cycles, nothing in flight), logs "restart requested by deploy <build>", removes the file and
 * exits 0. systemd (Restart=always) starts it again on the new code.
 *
 * A request already on disk when a process STARTS is stale: the deploy swaps the code in first and writes the request after, so a process
 * that starts after the request runs the new code already. The keeper and the mint bank remove it at startup (clearStaleRestartRequest)
 * and honour only requests that appear while they run. The file is removed before the exit, so the restarted process never sees it
 * (no loop); a file that cannot be removed is ignored when its `at` is older than this process's start. A dry run neither takes nor removes.
 */
export const RESTART_UNITS = ["keeper", "mintbank"] as const;
export type RestartUnit = (typeof RESTART_UNITS)[number];

export const restartRequestPath = (unit: string, root = process.cwd()): string => path.join(root, "data", `restart-requested.${unit}`);

export interface RestartRequest { build: string; at: string | null; file: string }

/**
 * The pending request for `unit`, consumed (the file removed), or null. `startedAt` (ms): a request older than this process whose file
 * could not be removed is stale and ignored.
 */
export function takeRestartRequest(unit: string, o: { root?: string; startedAt?: number } = {}): RestartRequest | null {
  const file = restartRequestPath(unit, o.root);
  let raw: string;
  try { raw = fs.readFileSync(file, "utf8"); } catch { return null; }
  let build = "unknown", at: string | null = null;
  try { const j = JSON.parse(raw) as { build?: unknown; at?: unknown }; if (typeof j.build === "string" && j.build.trim()) build = j.build.trim().slice(0, 80); if (typeof j.at === "string") at = j.at; }
  catch { const t = raw.trim(); if (t) build = t.split(/\s+/)[0].slice(0, 80); }
  try { fs.rmSync(file, { force: true }); }
  catch {
    // could not consume it: honour it only when it was written after this process started (else the restart would loop)
    const ts = at ? Date.parse(at) : NaN;
    if (o.startedAt !== undefined && (!Number.isFinite(ts) || ts < o.startedAt)) return null;
  }
  return { build, at, file };
}

/** At startup: removes a request written before this process started (it already runs that code). Returns what was removed. */
export function clearStaleRestartRequest(unit: string, o: { root?: string } = {}): RestartRequest | null {
  return takeRestartRequest(unit, { root: o.root });
}

/** The deploy side (also used by tests): writes the request for each unit. */
export function writeRestartRequest(unit: string, build: string, o: { root?: string; now?: number } = {}): string {
  const file = restartRequestPath(unit, o.root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ build, at: new Date(o.now ?? Date.now()).toISOString() }) + "\n");
  return file;
}
