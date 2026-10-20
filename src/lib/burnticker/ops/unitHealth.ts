import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import type { AlertSink } from "@/lib/burnticker/alerts";

/**
 * THE KEEPER'S UNIT CHECK (2026-10-16 prelaunch audit F-5 / F-9). A hand-installed mct-rehearsal-keeper unit failed every hour for two
 * and a half days and nobody saw it; the mint bank ignored deploys for a day; no backup existed. The keeper now looks at the host's
 * systemd user units on its five-minute alert check (scripts/burnticker-keeper.mts opsCheck, before the push check):
 *
 *   bt-unit-failed    ANY `mct-*` user unit in the failed state, and each unit in EXPECTED_UNITS that is not running (stopped, or not
 *                     installed at all), in ONE alert per cycle keyed by the set of units (unitAlerts)
 *   bt-unit-restarted (HB-1, 2026-10-19) a service whose systemd restart counter (NRestarts) rose since the last check, by fewer than
 *                     RESTART_LOOP_MIN: it stopped on its own and Restart= started it again. The web process ran out of memory twice that day
 *                     and was "active" again five seconds later each time, so neither bt-unit-failed rule saw it. Units that exit on purpose
 *                     after a deploy (SELF_RESTARTING_UNITS) and oneshot jobs are left out. One alert per unit and restart count.
 *   bt-backup-failed  data/backups/last-backup.json (scripts/service/run-burnticker-backup.sh) says the last run failed, or the last good
 *                     run is older than BACKUP_STALE_MS (two missed 6-hour runs and a margin), or (fourth prelaunch audit, 2026-10-18)
 *                     the file is missing or unreadable BACKUP_STATUS_GRACE_MS after the keeper started, where the backup timer is
 *                     installed (its first run is due within six hours, so no status by then means no backup has finished)
 *   bt-backup-offbox-stale  (B-3 / OPS-1, 2026-10-19) also when the off-box pull receipt (data/offbox-pull.json) is older than 12 hours
 *
 * The units are read with `systemctl --user list-units 'mct-*' --all --plain --no-legend --no-pager`. Where that cannot run (the Mac, a
 * host without a user bus) nothing is raised and the check says so in its note. Both kinds reach the phone (push.ts).
 */
export interface UnitRow { unit: string; load: string; active: string; sub: string; description: string }
export interface UnitAlert { kind: "bt-unit-failed" | "bt-unit-restarted" | "bt-backup-failed" | "bt-backup-offbox-stale"; key: string; text: string; meta: Record<string, unknown> }
/** The units the Burnticker host must keep running (install-burnticker-units.sh installs them). */
export const EXPECTED_UNITS: readonly { unit: string; what: string }[] = [
  // A-7 (second audit 2026-10-18): the core units too, so a stopped web or $DEFICIT keeper raises an alert (the Burnticker keeper
  // runs this check, so it is listed for a host where a second keeper instance or a manual check reads the units)
  { unit: "mct-burnticker-web.service", what: "the Burnticker website" },
  { unit: "mct-burnticker-keeper.service", what: "the Burnticker keeper (readings and burns)" },
  { unit: "mct-burnkeeper.service", what: "the $DEFICIT burn keeper" },
  { unit: "mct-burnticker-mintbank.service", what: "the mint key bank (prepared coin addresses for launches)" },
  { unit: "mct-burnticker-synth.timer", what: "the nightly synthetic creator's timer" },
  { unit: "mct-burnticker-backup.timer", what: "the 6-hourly database backup's timer" },
  // I-11 / B-4 (2026-10-19): the 5-minute external web check (it runs, and skips, even before the owner sets its ping URL)
  { unit: "mct-burnticker-web-probe.timer", what: "the 5-minute external web check's timer" },
];
/** The units only the PRIMARY host runs (review of A-7): a standby keeper's host serves no site and runs no $DEFICIT keeper. */
export const PRIMARY_ONLY_UNITS: ReadonlySet<string> = new Set(["mct-burnticker-web.service", "mct-burnkeeper.service"]);
/** The expected units for this host: all of them on the primary (BURNTICKER_KEEPER_ROLE leader or unset), less PRIMARY_ONLY_UNITS on a standby. */
export function expectedUnits(env: Readonly<Record<string, string | undefined>>): readonly { unit: string; what: string }[] {
  const standby = (env.BURNTICKER_KEEPER_ROLE ?? "").trim().toLowerCase() === "standby";
  return standby ? EXPECTED_UNITS.filter((e) => !PRIMARY_ONLY_UNITS.has(e.unit)) : EXPECTED_UNITS;
}
export const BACKUP_STALE_MS = 13 * 3_600_000;
/** How long after the keeper starts a missing or unreadable backup status is an alert: the 6-hour timer's first run and a margin. */
export const BACKUP_STATUS_GRACE_MS = 8 * 3_600_000;
/** The keeper's start, the grace's origin when the caller names none. */
const PROCESS_STARTED_AT = Date.now();
/**
 * F-5 re-review: a crash loop under Restart=always never shows "failed". It is caught two ways between consecutive checks: the unit is
 * `activating` (auto-restart) at both, or its NRestarts counter rose by RESTART_LOOP_MIN or more (one restart is a deploy's).
 */
export const RESTART_LOOP_MIN = 3;
export interface UnitCheckState { activating: Set<string>; restarts: Map<string, number> }
/**
 * HB-1: the units that exit by design and are started again by Restart=always, so a rise of their counter is not news: the Burnticker
 * keeper and the mint bank leave after their cycle when a deploy asks (scripts/ops/request-keeper-restart.sh). A crash loop of either is
 * still caught by the RESTART_LOOP_MIN rule.
 */
export const SELF_RESTARTING_UNITS: ReadonlySet<string> = new Set(["mct-burnticker-keeper.service", "mct-burnticker-mintbank.service"]);
const unitState: UnitCheckState = { activating: new Set(), restarts: new Map() };
/** `systemctl --user show -p Id -p NRestarts` output: unit to restarts. */
export function parseRestarts(stdout: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const block of stdout.split(/\n\s*\n/)) {
    const id = /^Id=(.+)$/m.exec(block)?.[1]?.trim(), n = Number(/^NRestarts=(\d+)$/m.exec(block)?.[1]);
    if (id && Number.isFinite(n)) out.set(id, n);
  }
  return out;
}
/** `systemctl --user show -p Id -p MemoryPeak` output: unit to its memory peak in bytes (HB-1). A unit without one ("[not set]",
 * "infinity", or a systemd too old to report it) is left out. */
export function parseMemoryPeaks(stdout: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const block of stdout.split(/\n\s*\n/)) {
    const id = /^Id=(.+)$/m.exec(block)?.[1]?.trim(), raw = /^MemoryPeak=(\d+)$/m.exec(block)?.[1];
    const n = raw === undefined ? NaN : Number(raw);
    if (id && Number.isFinite(n) && n > 0 && n < 2 ** 60) out.set(id, n);
  }
  return out;
}
/** Bytes as a short reading for an alert line: "2.4 GB", "690 MB". */
export function formatBytes(n: number): string {
  return n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.round(n / 1e6)} MB`;
}
/** `systemctl --user show -p Id -p Type` output: the units whose Type is oneshot (a timer's job; a long run is not a crash loop). */
export function parseOneshot(stdout: string): Set<string> {
  const out = new Set<string>();
  for (const block of stdout.split(/\n\s*\n/)) {
    const id = /^Id=(.+)$/m.exec(block)?.[1]?.trim();
    if (id && /^Type=oneshot$/m.test(block)) out.add(id);
  }
  return out;
}
export function systemctlShowRestarts(units: readonly string[]): Promise<string> {
  const env = { ...process.env };
  if (!env.XDG_RUNTIME_DIR && typeof process.getuid === "function") env.XDG_RUNTIME_DIR = `/run/user/${process.getuid()}`;
  return new Promise((res, rej) => execFile("systemctl", ["--user", "show", "-p", "Id", "-p", "NRestarts", "-p", "Type", "-p", "MemoryPeak", ...units], { env, timeout: 5_000, maxBuffer: 256 * 1024 }, (e, stdout) => (e ? rej(e) : res(String(stdout)))));
}
/**
 * The crash loops since the last check, and the state for the next one. A-7 (second audit 2026-10-18): only a unit waiting to restart
 * (`sub` auto-restart) counts as starting again, so a oneshot timer job in the middle of a long run (publish, backup, audit, the nightly
 * synthetic creator: `activating start`) is never "restarting over and over"; oneshot units are skipped in both rules.
 */
export function loopingUnits(units: readonly UnitRow[], restarts: Map<string, number> | null, prev: UnitCheckState, oneshot: ReadonlySet<string> = new Set()): { looping: { unit: string; why: string }[]; next: UnitCheckState } {
  const looping: { unit: string; why: string }[] = [];
  const activating = new Set(units.filter((u) => u.active === "activating" && u.sub === "auto-restart" && !oneshot.has(u.unit)).map((u) => u.unit));
  for (const u of activating) if (prev.activating.has(u)) looping.push({ unit: u, why: "it was starting again at two checks in a row" });
  for (const [u, n] of restarts ?? []) {
    if (oneshot.has(u)) continue;
    const before = prev.restarts.get(u);
    if (before !== undefined && n - before >= RESTART_LOOP_MIN && !looping.some((x) => x.unit === u)) looping.push({ unit: u, why: `${n - before} restarts since the last check` });
  }
  return { looping, next: { activating, restarts: restarts ?? prev.restarts } };
}

/**
 * HB-1: the units that restarted on their own since the last check (their NRestarts rose by 1 to RESTART_LOOP_MIN - 1; a larger rise is
 * a crash loop, said by loopingUnits). Nothing is said on the first read of a unit (no earlier count) or when the count went down (a
 * manual start resets it). Oneshot jobs and SELF_RESTARTING_UNITS are skipped.
 */
export function restartedUnits(restarts: Map<string, number> | null, prev: UnitCheckState, oneshot: ReadonlySet<string> = new Set(), skip: ReadonlySet<string> = SELF_RESTARTING_UNITS): { unit: string; before: number; now: number }[] {
  const out: { unit: string; before: number; now: number }[] = [];
  for (const [u, n] of restarts ?? []) {
    if (oneshot.has(u) || skip.has(u)) continue;
    const before = prev.restarts.get(u);
    if (before !== undefined && n > before && n - before < RESTART_LOOP_MIN) out.push({ unit: u, before, now: n });
  }
  return out;
}
/** One bt-unit-restarted alert per unit, keyed by the unit and its new restart count, so each further restart is a new alert. */
export function restartAlerts(restarted: readonly { unit: string; before: number; now: number }[], peaks: ReadonlyMap<string, number> = new Map()): UnitAlert[] {
  return restarted.map((r) => {
    const peak = peaks.get(r.unit);
    const times = r.now - r.before === 1 ? "once" : `${r.now - r.before} times`;
    const peakLine = peak !== undefined ? ` Its memory peak since it started again is ${formatBytes(peak)}.` : "";
    return {
      kind: "bt-unit-restarted" as const,
      key: `bt-unit-restarted:${r.unit}:${r.now}`,
      text: `${r.unit} stopped on its own and systemd started it again (${times} since the last check; restart count ${r.now}).${peakLine} Read the reason with journalctl --user -u ${r.unit} -n 80 (an out-of-memory stop says "JavaScript heap out of memory" in its log).`,
      meta: { unit: r.unit, restartsBefore: r.before, restarts: r.now, memoryPeakBytes: peak ?? null },
    };
  });
}

/** The ACTIVE states that count as running. */
export const RUNNING_STATES: ReadonlySet<string> = new Set(["active", "activating", "reloading"]);

export function parseUnitList(stdout: string): UnitRow[] {
  return stdout.split("\n").map((l) => l.replace(/^[\s●*]+/, "").trim()).filter((l) => /^mct-[\w@.-]+\.(service|timer|socket|path|target)\s/.test(l)).map((l) => {
    const [unit, load, active, sub, ...rest] = l.split(/\s+/);
    return { unit, load, active, sub, description: rest.join(" ") };
  });
}

/**
 * ONE combined bt-unit-failed alert for the cycle (F-5 review: a per-unit alert let a stale failure, such as the rehearsal keeper's, spend
 * the day's one push while a new failure stayed silent). It names every unit in trouble first, then what to do for each. Its key is the
 * sorted set of units, so the same set is raised once a Denver day and any change in the set is a new alert.
 */
export function unitAlerts(units: readonly UnitRow[], expected: readonly { unit: string; what: string }[] = EXPECTED_UNITS, looping: readonly { unit: string; why: string }[] = []): UnitAlert[] {
  const bad: { unit: string; line: string; state: string | null }[] = [];
  // F-5 re-review: a unit restarting over and over (Restart=always hides the failure: it never stays failed)
  for (const l of looping) bad.push({ unit: l.unit, state: "restarting", line: `${l.unit} is restarting over and over (${l.why}). Read its log with journalctl --user -u ${l.unit} -n 50.` });
  for (const u of units) {
    if (u.active !== "failed") continue;
    bad.push({ unit: u.unit, state: "failed", line: `${u.unit} has failed${u.description ? ` (${u.description.slice(0, 100)})` : ""}. Read its log with journalctl --user -u ${u.unit} -n 50, fix it or remove it, then clear it with systemctl --user reset-failed ${u.unit}.` });
  }
  for (const e of expected) {
    const u = units.find((x) => x.unit === e.unit);
    if (u?.active === "failed") continue;   // said above
    if (!u || u.load === "not-found") bad.push({ unit: e.unit, state: null, line: `${e.unit}, ${e.what}, is not installed on this host. Run sh scripts/ops/install-burnticker-units.sh as mct.` });
    // F-5 review: a unit being restarted (activating, as systemd's Restart= does after a deploy's exit) or reloading is running
    else if (!RUNNING_STATES.has(u.active)) bad.push({ unit: e.unit, state: u.active, line: `${e.unit}, ${e.what}, is not running (${u.active}, ${u.sub}). Start it with systemctl --user enable --now ${e.unit}.` });
  }
  if (!bad.length) return [];
  const names = [...new Set(bad.map((x) => x.unit))].sort();
  const set = names.join("+");
  const key = set.length <= 180 ? `bt-unit-failed:${set}` : `bt-unit-failed:${names.length} units:${hash(set)}`;
  const text = `${names.length === 1 ? "One unit is" : `${names.length} units are`} failed or not running: ${names.join(", ")}. ${bad.map((x) => `The unit ${x.line}`).join(" ")}`;
  return [{ kind: "bt-unit-failed", key, text, meta: { units: bad.map((x) => ({ unit: x.unit, state: x.state })) } }];
}
const hash = (s: string): string => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return (h >>> 0).toString(16); };

export interface BackupStatus { ok: boolean; at: string; files?: string[]; offBox?: string; error?: string | null; /** a destination is set (BURNTICKER_BACKUP_DEST) */ destConfigured?: boolean; /** the last run whose copies left the box */ lastOffBoxAt?: string | null; /** the first run that saw a destination */ firstConfiguredAt?: string | null }
/** A low-priority note when a destination is set but nothing has left the box for this long (F-7 review). */
export const OFFBOX_STALE_MS = 24 * 3_600_000;
export function backupAlerts(s: BackupStatus | null, now: number, pull: OffboxPullReceipt | null = null, pullRead: Partial<Pick<OffboxPullRead, "problem" | "seenPulledAt">> = {}): UnitAlert[] {
  const pullOut = offboxPullAlerts(pull, now, pullRead);
  if (!s) return pullOut;
  const out = [...backupRunAlerts(s, now), ...pullOut];
  // F-7 review: a destination is set, and no copy has left the box for a day (never, counted from when the destination was first seen).
  // B-3 / OPS-1 (2026-10-19): a fresh pull receipt is a healthy off-box copy, so the destination's own staleness is not raised beside it.
  const ref = s.destConfigured && offboxPullFact(pull, now).offBox !== "pulled" ? Date.parse(s.lastOffBoxAt ?? s.firstConfiguredAt ?? "") : NaN;
  if (Number.isFinite(ref) && now - ref > OFFBOX_STALE_MS) {
    const h = Math.floor((now - ref) / 3_600_000);
    out.push({ kind: "bt-backup-offbox-stale", key: "bt-backup-offbox-stale", text: s.lastOffBoxAt ? `No backup has been copied off the box for ${h} hours (the last copy left at ${s.lastOffBoxAt}). The copies on the box are fine. Read logs/burnticker-backup.log.` : `A backup destination has been set for ${h} hours, and no copy has left the box yet. Read logs/burnticker-backup.log.`, meta: { lastOffBoxAt: s.lastOffBoxAt ?? null, offBox: s.offBox ?? null } });
  }
  return out;
}
/**
 * THE OFF-BOX PULL RECEIPT (auditors' B-3 / OPS-1, 2026-10-19). The off-box copy is not pushed by the backup unit (BURNTICKER_BACKUP_DEST
 * stays unset by design): the operator's own machine pulls the host's backups every six hours over ssh, checks each database copy with
 * PRAGMA quick_check, stores it in the operator's own storage, and at the end of a good pull writes data/offbox-pull.json on the host
 * (atomically, owned by the app user, mode 0640). The backup status alone therefore read "no off-box copy" while one ran. This reads the
 * receipt: "pulled" while it is younger than OFFBOX_PULL_STALE_MS (two pull periods), "stale" when older, "none" when absent or not a
 * receipt this check accepts. The receipt carries counts, a time and a method name only; any key outside OFFBOX_PULL_KEYS makes it
 * unreadable, so a secret, a path or a passphrase can never ride along into ops.json.
 */
export const OFFBOX_PULL_FILE = path.join("data", "offbox-pull.json");
export const OFFBOX_PULL_SCHEMA = "burnticker.offbox-pull/v1";
/** The one accepted method name (neutral on purpose: ops.json is public and names no storage service). */
export const OFFBOX_PULL_METHOD = "operator-pull";
/** Two missed 6-hour pulls. */
export const OFFBOX_PULL_STALE_MS = 12 * 3_600_000;
export const OFFBOX_PULL_KEYS: readonly string[] = ["schema", "pulledAt", "method", "files", "dbQuickCheck", "retentionDays", "host"];
export const OFFBOX_PULL_FILE_KEYS: readonly string[] = ["db", "secretsBundle"];
export interface OffboxPullReceipt { schema: typeof OFFBOX_PULL_SCHEMA; pulledAt: string; method: typeof OFFBOX_PULL_METHOD; files: { db: number; secretsBundle: boolean }; dbQuickCheck: "ok"; retentionDays: number; host: string | null }
/** What hostFacts and ops.json carry: a state, a time and the method name. Never the receipt's host, never a path. */
export interface OffboxPullFact { offBox: "pulled" | "stale" | "none"; lastOffBoxAt: string | null; offBoxMethod: string | null; offBoxPulledAt: string | null }
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
/** The receipt, or null when it is not exactly the v1 shape (unknown keys, wrong types, a failed check, a time in the future). */
export function parseOffboxPull(raw: string, now: number = Date.now()): OffboxPullReceipt | null {
  const c = checkOffboxPull(raw, now);
  return "receipt" in c ? c.receipt : null;
}
/** A word from the receipt said back only when it is a plain short token (ops.json is public; a value is never echoed otherwise). */
const sayWord = (x: unknown): string => (typeof x === "string" && /^[A-Za-z0-9._-]{1,32}$/.test(x) ? `"${x}"` : "an unexpected value");
/**
 * HB-49: the receipt, or the plain reason it is not one, so an unreadable receipt alerts with the reason instead of reading as "none".
 * The reason names a key or a short word at most, never a value that could carry a secret.
 */
export function checkOffboxPull(raw: string, now: number = Date.now()): { receipt: OffboxPullReceipt } | { reason: string } {
  let j: unknown;
  try { j = JSON.parse(raw); } catch { return { reason: "it is not valid JSON" }; }
  if (!isObj(j)) return { reason: "it is not a JSON object" };
  const extra = Object.keys(j).find((k) => !OFFBOX_PULL_KEYS.includes(k));
  if (extra !== undefined) return { reason: `it has a field this check does not accept (${sayWord(extra)})` };
  const f = j.files;
  if (!isObj(f)) return { reason: "its files entry is missing or not an object" };
  const extraFile = Object.keys(f).find((k) => !OFFBOX_PULL_FILE_KEYS.includes(k));
  if (extraFile !== undefined) return { reason: `its files entry has a field this check does not accept (${sayWord(extraFile)})` };
  if (j.schema !== OFFBOX_PULL_SCHEMA) return { reason: `its schema is ${sayWord(j.schema)}, not ${OFFBOX_PULL_SCHEMA}` };
  if (j.dbQuickCheck !== "ok") return { reason: `its database check says ${sayWord(j.dbQuickCheck)}, not "ok"` };
  if (typeof j.pulledAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(j.pulledAt)) return { reason: "its pull time is missing or not a UTC time" };
  const at = Date.parse(j.pulledAt);
  if (!Number.isFinite(at)) return { reason: "its pull time is not a real time" };
  if (at - now > 5 * 60_000) return { reason: `its pull time ${j.pulledAt} is more than 5 minutes ahead of the host's clock` };
  if (j.method !== OFFBOX_PULL_METHOD) return { reason: `its method is ${sayWord(j.method)}, not "${OFFBOX_PULL_METHOD}"` };
  if (!Number.isInteger(f.db) || (f.db as number) < 1) return { reason: "it counts no database copy" };
  if (typeof f.secretsBundle !== "boolean") return { reason: "it does not say whether the secrets bundle was copied" };
  if (!Number.isInteger(j.retentionDays) || (j.retentionDays as number) < 1) return { reason: "its retention days entry is missing or not a whole number" };
  if (j.host !== undefined && (typeof j.host !== "string" || !/^[A-Za-z0-9,._-]{1,64}$/.test(j.host))) return { reason: "its host entry is not a plain machine name" };
  return { receipt: { schema: OFFBOX_PULL_SCHEMA, pulledAt: j.pulledAt, method: OFFBOX_PULL_METHOD, files: { db: f.db as number, secretsBundle: f.secretsBundle }, dbQuickCheck: "ok", retentionDays: j.retentionDays as number, host: typeof j.host === "string" ? j.host : null } };
}
export function readOffboxPull(root: string, now: number = Date.now()): OffboxPullReceipt | null {
  return readOffboxPullFile(root, now).receipt;
}
/**
 * HB-49: THE "SEEN" MARKER (data/offbox-pull.seen, written by the keeper's unit check). Once a good receipt has been read, its pulledAt is
 * kept here, so a receipt that later goes missing is told apart from "no pull was ever set up": none after 12 hours then alerts like stale.
 */
export const OFFBOX_PULL_SEEN_FILE = path.join("data", "offbox-pull.seen");
/** What the unit check reads: the receipt, or why there is none ("missing", or the reason it cannot be read), and the last good pull seen. */
export interface OffboxPullRead { receipt: OffboxPullReceipt | null; problem: string | null; seenPulledAt: string | null }
export function readOffboxPullFile(root: string, now: number = Date.now()): OffboxPullRead {
  const seenPulledAt = readOffboxPullSeen(root);
  let raw: string;
  try { raw = fs.readFileSync(path.join(root, OFFBOX_PULL_FILE), "utf8"); }
  catch (e) { return { receipt: null, problem: (e as NodeJS.ErrnoException)?.code === "ENOENT" ? "missing" : "the file could not be opened", seenPulledAt }; }
  const c = checkOffboxPull(raw, now);
  return "receipt" in c ? { receipt: c.receipt, problem: null, seenPulledAt } : { receipt: null, problem: c.reason, seenPulledAt };
}
export function readOffboxPullSeen(root: string): string | null {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(root, OFFBOX_PULL_SEEN_FILE), "utf8")) as { pulledAt?: unknown };
    return typeof j?.pulledAt === "string" && Number.isFinite(Date.parse(j.pulledAt)) ? j.pulledAt : null;
  } catch { return null; }
}
/** Keeps the newest good pulledAt in the marker (atomic; never throws). Returns the marker's time after the write. */
export function recordOffboxPullSeen(root: string, r: OffboxPullReceipt | null, seenPulledAt: string | null): string | null {
  if (!r || (seenPulledAt !== null && Date.parse(seenPulledAt) >= Date.parse(r.pulledAt))) return seenPulledAt;
  try {
    const file = path.join(root, OFFBOX_PULL_SEEN_FILE);
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify({ pulledAt: r.pulledAt })}\n`, { mode: 0o640 });
    fs.renameSync(tmp, file);
  } catch { /* the marker is a convenience for the alert; failing to write it never stops the keeper */ }
  return r.pulledAt;
}
export function offboxPullFact(r: OffboxPullReceipt | null, now: number): OffboxPullFact {
  if (!r) return { offBox: "none", lastOffBoxAt: null, offBoxMethod: null, offBoxPulledAt: null };
  const fresh = now - Date.parse(r.pulledAt) <= OFFBOX_PULL_STALE_MS;
  return { offBox: fresh ? "pulled" : "stale", lastOffBoxAt: r.pulledAt, offBoxMethod: r.method, offBoxPulledAt: r.pulledAt };
}
/**
 * The pull's own alerts: a receipt older than OFFBOX_PULL_STALE_MS; HB-49: a receipt that is there but cannot be read (always, with the
 * reason); and no receipt at all once one has been seen (the marker) and that last good pull is more than 12 hours old. No receipt and
 * no marker raises nothing: no pull has been set up yet.
 */
export function offboxPullAlerts(r: OffboxPullReceipt | null, now: number, read: Partial<Pick<OffboxPullRead, "problem" | "seenPulledAt">> = {}): UnitAlert[] {
  if (!r && read.problem && read.problem !== "missing") {
    return [{ kind: "bt-backup-offbox-stale", key: "bt-backup-offbox-pull-unreadable", text: `The off-box pull receipt on the host could not be read: ${read.problem}. Check the Mac's backup agent.`, meta: { offBox: "unreadable", reason: read.problem, offBoxPulledAt: read.seenPulledAt ?? null } }];
  }
  if (!r) {
    const seen = Date.parse(read.seenPulledAt ?? "");
    if (!Number.isFinite(seen) || now - seen <= OFFBOX_PULL_STALE_MS) return [];
    return [{ kind: "bt-backup-offbox-stale", key: "bt-backup-offbox-pull-stale", text: `The off-box pull receipt is gone from the host, and the last pull it showed was at ${read.seenPulledAt}, more than 12 hours ago. Check the Mac's backup agent.`, meta: { offBox: "none", offBoxMethod: null, offBoxPulledAt: read.seenPulledAt ?? null } }];
  }
  if (offboxPullFact(r, now).offBox !== "stale") return [];
  return [{ kind: "bt-backup-offbox-stale", key: "bt-backup-offbox-pull-stale", text: `The off-box backup pull has not reported for more than 12 hours. The last pull was at ${r.pulledAt}. Check the Mac's backup agent.`, meta: { offBox: "stale", offBoxMethod: r.method, offBoxPulledAt: r.pulledAt } }];
}
/** The ops line (null for a document without the fact). */
export function offboxPullLine(f: Partial<Pick<OffboxPullFact, "offBox" | "offBoxMethod" | "offBoxPulledAt">> | null | undefined, now: number): string | null {
  if (!f?.offBox) return null;
  if (f.offBox === "none") return "- off-box backup pull: none (no receipt in data/offbox-pull.json)";
  const t = Date.parse(f.offBoxPulledAt ?? "");
  const ago = Number.isFinite(t) ? `${Math.max(0, Math.floor((now - t) / 3_600_000))} h ago (${f.offBoxPulledAt})` : "at an unknown time";
  return f.offBox === "pulled" ? `- off-box backup pull: pulled (${f.offBoxMethod ?? "?"}), last pull ${ago}` : `- off-box backup pull: STALE (${f.offBoxMethod ?? "?"}), last pull ${ago}; more than 12 hours, check the pulling machine's backup agent`;
}
function backupRunAlerts(s: BackupStatus, now: number): UnitAlert[] {
  if (!s.ok) return [{ kind: "bt-backup-failed", key: "bt-backup-failed", text: `The database backup at ${s.at} failed: ${String(s.error ?? "no reason given").slice(0, 200)}. Read logs/burnticker-backup.log.`, meta: { at: s.at, offBox: s.offBox ?? null } }];
  const at = Date.parse(s.at);
  if (Number.isFinite(at) && now - at > BACKUP_STALE_MS) {
    const h = Math.floor((now - at) / 3_600_000);
    return [{ kind: "bt-backup-failed", key: "bt-backup-failed", text: `No database backup has finished for ${h} hours (the last was ${s.at}). Check systemctl --user list-timers mct-burnticker-backup.timer and logs/burnticker-backup.log.`, meta: { at: s.at } }];
  }
  return [];
}

export function readBackupStatus(root: string): BackupStatus | null {
  return readBackupStatusFile(root).status;
}
/** The status, or why there is none: the file is missing, or it is there but not a status this check can read. */
export function readBackupStatusFile(root: string): { status: BackupStatus | null; problem: "missing" | "malformed" | null } {
  let raw: string;
  try { raw = fs.readFileSync(path.join(root, "data", "backups", "last-backup.json"), "utf8"); } catch { return { status: null, problem: "missing" }; }
  try { const j = JSON.parse(raw) as BackupStatus; return typeof j?.at === "string" ? { status: j, problem: null } : { status: null, problem: "malformed" }; } catch { return { status: null, problem: "malformed" }; }
}
/** The alert for no readable backup status (once the grace has passed and the backup timer is installed). */
export function missingBackupStatusAlert(problem: "missing" | "malformed"): UnitAlert {
  const why = problem === "missing" ? "The file data/backups/last-backup.json is not there." : "The status file could not be read.";
  return { kind: "bt-backup-failed", key: "bt-backup-failed", text: `No backup status was found. ${why} So there is no sign that any database backup has finished. Check systemctl --user list-timers mct-burnticker-backup.timer and logs/burnticker-backup.log.`, meta: { problem } };
}

/** `systemctl --user list-units 'mct-*'` for this user (the runtime dir is named when the environment lacks it). */
export function systemctlListUnits(): Promise<string> {
  const env = { ...process.env };
  if (!env.XDG_RUNTIME_DIR && typeof process.getuid === "function") env.XDG_RUNTIME_DIR = `/run/user/${process.getuid()}`;
  return new Promise((res, rej) => execFile("systemctl", ["--user", "list-units", "mct-*", "--all", "--plain", "--no-legend", "--no-pager"], { env, timeout: 5_000, maxBuffer: 256 * 1024 }, (e, stdout) => (e ? rej(e) : res(String(stdout)))));
}

/**
 * The keeper's hook (one line in opsCheck): reads the units and the backup status, raises each alert through `sink` (the registry's
 * one-per-key-per-day table, then the webhook), and answers what it raised. Never throws.
 */
export async function runUnitCheck(o: { sink: AlertSink; now: number; root?: string; listUnits?: () => Promise<string>; showRestarts?: (units: readonly string[]) => Promise<string>; state?: UnitCheckState; log?: (s: string) => void; /** the grace's origin (default: this process's start) */ startedAt?: number; /** the host environment, for the keeper role (default process.env) */ env?: Readonly<Record<string, string | undefined>> }): Promise<{ raised: UnitAlert[]; active: UnitAlert[]; note: string | null }> {
  const alerts: UnitAlert[] = [];
  let note: string | null = null;
  let backupTimerInstalled = false;
  const state = o.state ?? unitState;
  try {
    const units = parseUnitList(await (o.listUnits ?? systemctlListUnits)());
    const services = units.filter((u) => u.unit.endsWith(".service")).map((u) => u.unit);
    const shown = services.length ? await (o.showRestarts ?? systemctlShowRestarts)(services).catch(() => null) : null;
    const restarts = shown === null ? null : parseRestarts(shown);
    const oneshot = shown === null ? new Set<string>() : parseOneshot(shown);
    const l = loopingUnits(units, restarts, state, oneshot);
    // HB-1: a single restart between checks (an out-of-memory stop) of a unit that never exits on purpose; a loop is said above instead
    const restarted = restartedUnits(restarts, state, oneshot).filter((r) => !l.looping.some((x) => x.unit === r.unit));
    state.activating = l.next.activating; state.restarts = l.next.restarts;
    alerts.push(...unitAlerts(units, expectedUnits(o.env ?? process.env), l.looping));
    alerts.push(...restartAlerts(restarted, shown === null ? new Map() : parseMemoryPeaks(shown)));
    backupTimerInstalled = units.some((u) => u.unit === "mct-burnticker-backup.timer" && u.load !== "not-found");
  }
  catch (e) { note = `the unit check could not list the units (${String((e as Error)?.message ?? e).slice(0, 120)}); nothing raised for units`; }
  const b = readBackupStatusFile(o.root ?? process.cwd());
  // HB-49: the pull receipt with why it is missing or unreadable, and the last good pull seen (kept in data/offbox-pull.seen)
  const pull = readOffboxPullFile(o.root ?? process.cwd(), o.now);
  const seenPulledAt = recordOffboxPullSeen(o.root ?? process.cwd(), pull.receipt, pull.seenPulledAt);
  alerts.push(...backupAlerts(b.status, o.now, pull.receipt, { problem: pull.problem, seenPulledAt }));
  // no readable status at all: said only on the host (the units listed, the backup timer installed), after the timer's first run was due
  if (b.problem && backupTimerInstalled && o.now - (o.startedAt ?? PROCESS_STARTED_AT) >= BACKUP_STATUS_GRACE_MS) alerts.push(missingBackupStatusAlert(b.problem));
  const raised: UnitAlert[] = [];
  for (const a of alerts) { try { if (await o.sink(a.kind, a.key, a.text, a.meta, o.now)) raised.push(a); } catch { /* the channel failing never stops the keeper */ } }
  if (note && !noted) { noted = true; o.log?.(`  [units] ${note}`); }
  return { raised, active: alerts, note };
}
let noted = false;

/**
 * THE EXTERNAL WEB CHECK (audit 2026-10-19 I-11 / B-4). scripts/service/burnticker-web-probe.sh, every 5 minutes, GETs the public
 * current-status through Cloudflare and pings a Healthchecks.io check (BURNTICKER_WEB_HEARTBEAT_URL) on a good answer, "<url>/fail"
 * otherwise. It writes data/web-probe-last.json; this reads it for the ops facts, so ops.json and the Trust/ops page can say
 * "external web check: configured, last ok <time>". The URL carries the check's token and is in neither the file nor anything here.
 */
export interface WebProbeStatus { configured: boolean; outcome: "ok" | "fail" | "skipped" | "refused"; at: string; code?: string | null; reason?: string | null; lastOkAt?: string | null; pinged?: boolean }
/** What ops.json carries (names, outcomes and times only). */
export interface WebProbeFact { configured: boolean; outcome: WebProbeStatus["outcome"] | null; at: string | null; lastOkAt: string | null; code: string | null; reason: string | null }
export const WEB_PROBE_FILE = path.join("data", "web-probe-last.json");
/** The timer fires every 5 minutes; a status older than this means the probe stopped running. */
export const WEB_PROBE_STALE_MS = 20 * 60_000;
const OUTCOMES = new Set(["ok", "fail", "skipped", "refused"]);
export function readWebProbeStatus(root: string): WebProbeStatus | null {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(root, WEB_PROBE_FILE), "utf8")) as WebProbeStatus;
    return j && typeof j.at === "string" && OUTCOMES.has(j.outcome) ? j : null;
  } catch { return null; }
}
/** The fact: configured when the keeper's environment names the URL or the probe's last run saw one. Never the URL. */
export function webProbeFact(s: WebProbeStatus | null, env: Readonly<Record<string, string | undefined>> = {}): WebProbeFact {
  const configured = !!env.BURNTICKER_WEB_HEARTBEAT_URL?.trim() || s?.configured === true;
  return { configured, outcome: s?.outcome ?? null, at: s?.at ?? null, lastOkAt: s?.lastOkAt ?? null, code: s?.code ?? null, reason: s?.reason ?? null };
}
/** The ops line. */
export function webProbeLine(f: WebProbeFact | null | undefined, now: number): string | null {
  if (!f) return null;
  const ago = (iso: string | null): string => { const t = Date.parse(iso ?? ""); return Number.isFinite(t) ? `${Math.max(0, Math.round((now - t) / 60_000))} min ago (${iso})` : "never"; };
  if (!f.configured) return "- external web check: not configured (set BURNTICKER_WEB_HEARTBEAT_URL to the Healthchecks check's ping URL, so a hung site or a dead Caddy is noticed)";
  if (!f.at || f.outcome === "skipped") return "- external web check: configured, no result yet (the probe runs every 5 minutes: systemctl --user list-timers mct-burnticker-web-probe.timer)";
  const at = Date.parse(f.at);
  const stale = Number.isFinite(at) && now - at > WEB_PROBE_STALE_MS ? `; the probe has not run for ${Math.round((now - at) / 60_000)} min (systemctl --user list-timers mct-burnticker-web-probe.timer)` : "";
  if (f.outcome === "refused") return `- external web check: configured, REFUSED (the ping URL is not https or ends in /fail; nothing is sent)${stale}`;
  if (f.outcome === "fail") return `- external web check: configured, FAILING (code ${f.code ?? "?"}${f.reason ? `, ${f.reason}` : ""}) ${ago(f.at)}; last ok ${ago(f.lastOkAt)}${stale}`;
  return `- external web check: configured, last ok ${ago(f.lastOkAt ?? f.at)}${stale}`;
}

/**
 * HB-145 (2026-10-20): the web's slow moments in the last hour, from logs/burnticker-web-slow.log (scripts/service/web-slowlog.cjs writes
 * one JSON line per request over 2 s and per event-loop hold over 1 s). Only the file's last SLOW_TAIL_BYTES are read. Null when the file
 * is absent (the web has not run with the log, or nothing was ever slow), so ops.json says "none recorded" only when it can.
 */
export const WEB_SLOW_FILE = path.join("logs", "burnticker-web-slow.log");
export const SLOW_TAIL_BYTES = 256 * 1024;
export interface SlowRequestsFact { requests: number; loopHolds: number; worstMs: number | null; worstRoute: string | null; longestHoldMs: number | null; lastAt: string | null }
export function readSlowRequests(root: string, now: number, file: string = WEB_SLOW_FILE): SlowRequestsFact | null {
  let text: string;
  try {
    const fd = fs.openSync(path.join(root, file), "r");
    try {
      const size = fs.fstatSync(fd).size, len = Math.min(size, SLOW_TAIL_BYTES), buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, size - len);
      text = buf.toString("utf8");
    } finally { fs.closeSync(fd); }
  } catch { return null; }
  const f: SlowRequestsFact = { requests: 0, loopHolds: 0, worstMs: null, worstRoute: null, longestHoldMs: null, lastAt: null };
  for (const line of text.split("\n")) {
    let r: { kind?: unknown; at?: unknown; ms?: unknown; route?: unknown; method?: unknown };
    try { r = JSON.parse(line); } catch { continue; }   // the first line of a tail read may be cut
    if (typeof r.at !== "number" || typeof r.ms !== "number" || r.at > now || now - r.at > 3_600_000) continue;
    if (r.kind === "request") {
      f.requests++;
      if (f.worstMs === null || r.ms > f.worstMs) { f.worstMs = r.ms; f.worstRoute = `${typeof r.method === "string" ? r.method : "?"} ${typeof r.route === "string" ? r.route.slice(0, 120) : "?"}`; }
    } else if (r.kind === "loop") { f.loopHolds++; if (f.longestHoldMs === null || r.ms > f.longestHoldMs) f.longestHoldMs = r.ms; } else continue;
    const at = new Date(r.at).toISOString();
    if (!f.lastAt || at > f.lastAt) f.lastAt = at;
  }
  return f;
}
/** The ops line: "slow requests (last hour)". */
export function slowRequestsLine(f: SlowRequestsFact | null | undefined): string | null {
  if (f === undefined) return null;
  if (f === null) return "- slow requests (last hour): none recorded (no logs/burnticker-web-slow.log yet)";
  if (!f.requests && !f.loopHolds) return "- slow requests (last hour): 0";
  const worst = f.worstMs !== null ? `; the slowest ${f.worstRoute} in ${(f.worstMs / 1000).toFixed(1)} s` : "";
  const holds = f.loopHolds ? `; the event loop was held ${f.loopHolds} time${f.loopHolds === 1 ? "" : "s"}, the longest ${((f.longestHoldMs ?? 0) / 1000).toFixed(1)} s` : "";
  return `- slow requests (last hour): ${f.requests} over 2 s${worst}${holds}; the last at ${f.lastAt} (logs/burnticker-web-slow.log)`;
}
