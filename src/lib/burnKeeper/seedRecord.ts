/**
 * Private review 10 (stale copy a): the seed deposit the status page discloses. The owner's env (BURNKEEPER_SEED_TX / _SEED_SOL) wins;
 * without it the keeper reads the launch record (config/burnticker/current-status.json deficit.launch, copied from
 * docs/burnkeeper/evidence/mainnet-deficit-2026-10-13/launch.json) for its own mint only. No record means "not published here", never
 * "no seed deposit".
 */
import fs from "node:fs";
import path from "node:path";

export interface SeedDisclosure { seedTx: string | null; seedSol: string | null }

export const LAUNCH_RECORD_FILE = "config/burnticker/current-status.json";

/** The recorded seed for this mint from a parsed current-status.json, or null when the record is absent or names another mint. */
export function recordedSeed(record: unknown, mint: string | null | undefined): SeedDisclosure | null {
  if (!mint || !record || typeof record !== "object") return null;
  const launch = (record as { deficit?: { launch?: { mint?: unknown; seedTx?: unknown; seedSol?: unknown } } }).deficit?.launch;
  if (!launch || launch.mint !== mint || typeof launch.seedTx !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(launch.seedTx)) return null;
  const sol = typeof launch.seedSol === "number" || typeof launch.seedSol === "string" ? String(launch.seedSol) : null;
  return { seedTx: launch.seedTx, seedSol: sol && /^\d+(\.\d+)?$/.test(sol) ? sol : null };
}

/** The env's seed when set, else the launch record's, else nothing published. */
export function seedDisclosure(env: Readonly<Record<string, string | undefined>>, mint: string | null | undefined, root: string = process.cwd()): SeedDisclosure {
  const tx = env.BURNKEEPER_SEED_TX?.trim() || null;
  if (tx) return { seedTx: tx, seedSol: env.BURNKEEPER_SEED_SOL?.trim() || null };
  try { return recordedSeed(JSON.parse(fs.readFileSync(path.join(root, LAUNCH_RECORD_FILE), "utf8")), mint) ?? { seedTx: null, seedSol: null }; } catch { return { seedTx: null, seedSol: null }; }
}
