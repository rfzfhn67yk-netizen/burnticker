import fs from "node:fs";
import path from "node:path";
import { deficitQueueCore } from "@/lib/burnticker/deficitQueueCore.mjs";

/**
 * THE $DEFICIT KEEPER'S PUBLISHED FILES, READ BY THE APP (website-14, LAUNCHPAD-PATH §73). The $DEFICIT keeper (scripts/burn-keeper.mts)
 * writes status.json and burns.json into its publish directory every cycle (BURNKEEPER_PUBLISH_DIR, default data/burnkeeper-site, the
 * same default the keeper and the publish timer use). The home API, the featured card, the $DEFICIT coin page and the activity line read
 * them here; the static $DEFICIT site reads the same two files beside its page. A missing or unreadable file is "unavailable", never a
 * zero. deficitQueueCore.mjs holds the arithmetic and the sentences; this file adds types and the file read.
 */

export type QueueState = "unavailable" | "not-launched" | "no-reading" | "queued" | "pool-open";
export interface DeficitQueue {
  state: QueueState;
  /** the debt's change since the launch baseline, in dollars ("12345678901.23"); null when the file does not carry the baseline */
  riseUsd: string | null;
  /** units attested on chain and waiting for a burn run */
  units: number;
  /** units the keeper recorded that are not yet signed on chain */
  unsigned: number;
  /** 1 − (1 − fraction)^units, in percent with two decimals */
  sharePct: string | null;
  formula: string | null;
  readingDate: string | null;
  generatedAt: string | null;
  stale: boolean;
  /** the raise that completes the coin's curve, read from its LaunchLab pool by the keeper; null when not read */
  raiseSol: string | null;
  headline: string;
  lines: string[];
  /** the featured card's Burned cell while units are queued ("0 $DEFICIT, 12 units queued"); null otherwise */
  card: string | null;
}

/** `burns` is null when burns.json is missing or unparsable (website-15: unavailable, never an empty history); `burnsError` says why. */
/** `writtenAt` (hourly run 6 HB-90): when the keeper last wrote status.json, from the file itself (ISO); null when not known. */
export interface KeeperFiles { status: Record<string, unknown> | null; burns: unknown; error: string | null; burnsError?: string | null; writtenAt?: string | null }

export const keeperPublishDir = (env: Record<string, string | undefined> = process.env, root = process.cwd()): string =>
  path.resolve(root, env.BURNKEEPER_PUBLISH_DIR?.trim() || path.join("data", "burnkeeper-site"));

/** Reads status.json and burns.json from the keeper's publish directory. Never throws: a failure comes back as `error`. */
export function readKeeperFiles(env: Record<string, string | undefined> = process.env, root = process.cwd()): KeeperFiles {
  const dir = keeperPublishDir(env, root);
  let status: Record<string, unknown> | null = null;
  try { status = JSON.parse(fs.readFileSync(path.join(dir, "status.json"), "utf8")) as Record<string, unknown>; }
  catch (e) { return { status: null, burns: null, error: (e as NodeJS.ErrnoException).code === "ENOENT" ? "The keeper has not published a status file on this host." : "The keeper's status file could not be read." }; }
  let writtenAt: string | null = null;
  try { writtenAt = fs.statSync(path.join(dir, "status.json")).mtime.toISOString(); } catch { writtenAt = null; }
  let burns: unknown = null;
  let burnsError: string | null = null;
  try { burns = JSON.parse(fs.readFileSync(path.join(dir, "burns.json"), "utf8")); }
  catch (e) { burns = null; burnsError = (e as NodeJS.ErrnoException).code === "ENOENT" ? "The keeper has not published a burn list on this host." : "The keeper's burn list could not be read."; }
  return { status, burns, error: null, burnsError, writtenAt };
}

export function deficitQueue(files: KeeperFiles | null, now = Date.now()): DeficitQueue {
  // HB-90: the "published at" line is the status file's write time; a caller without it (an object built in memory) prints no time
  return deficitQueueCore(files?.status ?? null, files?.burns ?? null, now, files?.writtenAt ?? null) as DeficitQueue;
}

/** The $DEFICIT rule file's feed and schedule (the locked rules file named in current-status.json), for the next-results row. Null when unreadable. */
export function deficitRuleSchedule(root = process.cwd()): { feedName: string; feedUrl: string | null; polls: string[]; timeZone: string } | null {
  try {
    const st = JSON.parse(fs.readFileSync(path.join(root, "config", "burnticker", "current-status.json"), "utf8")) as { deficit: { rulesFile: string } };
    const r = JSON.parse(fs.readFileSync(path.join(root, st.deficit.rulesFile), "utf8")) as { feed: { name: string }; schedule: { polls: string[]; timeZone: string } };
    return { feedName: r.feed.name, feedUrl: "https://fiscaldata.treasury.gov/datasets/debt-to-the-penny/", polls: r.schedule.polls, timeZone: r.schedule.timeZone };
  } catch { return null; }
}
