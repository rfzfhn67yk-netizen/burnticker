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
 *   bt-backup-failed  data/backups/last-backup.json (scripts/service/run-burnticker-backup.sh) says the last run failed, or the last good
 *                     run is older than BACKUP_STALE_MS (two missed 6-hour runs and a margin), or (fourth prelaunch audit, 2026-10-18)
 *                     the file is missing or unreadable BACKUP_STATUS_GRACE_MS after the keeper started, where the backup timer is
 *                     installed (its first run is due within six hours, so no status by then means no backup has finished)
 *
 * The units are read with `systemctl --user list-units 'mct-*' --all --plain --no-legend --no-pager`. Where that cannot run (the Mac, a
 * host without a user bus) nothing is raised and the check says so in its note. Both kinds reach the phone (push.ts).
 */
export interface UnitRow { unit: string; load: string; active: string; sub: string; description: string }
export interface UnitAlert { kind: "bt-unit-failed" | "bt-backup-failed" | "bt-backup-offbox-stale"; key: string; text: string; meta: Record<string, unknown> }
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
const unitState: UnitCheckState = { activating: new Set(), restarts: new Map() };
/** `systemctl --user show -p Id -p NRestarts` output: unit → restarts. */
export function parseRestarts(stdout: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const block of stdout.split(/\n\s*\n/)) {
    const id = /^Id=(.+)$/m.exec(block)?.[1]?.trim(), n = Number(/^NRestarts=(\d+)$/m.exec(block)?.[1]);
    if (id && Number.isFinite(n)) out.set(id, n);
  }
  return out;
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
  return new Promise((res, rej) => execFile("systemctl", ["--user", "show", "-p", "Id", "-p", "NRestarts", "-p", "Type", ...units], { env, timeout: 5_000, maxBuffer: 256 * 1024 }, (e, stdout) => (e ? rej(e) : res(String(stdout)))));
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
export function backupAlerts(s: BackupStatus | null, now: number): UnitAlert[] {
  if (!s) return [];
  const out = [...backupRunAlerts(s, now)];
  // F-7 review: a destination is set, and no copy has left the box for a day (never, counted from when the destination was first seen)
  const ref = s.destConfigured ? Date.parse(s.lastOffBoxAt ?? s.firstConfiguredAt ?? "") : NaN;
  if (Number.isFinite(ref) && now - ref > OFFBOX_STALE_MS) {
    const h = Math.floor((now - ref) / 3_600_000);
    out.push({ kind: "bt-backup-offbox-stale", key: "bt-backup-offbox-stale", text: s.lastOffBoxAt ? `No backup has been copied off the box for ${h} hours (the last copy left at ${s.lastOffBoxAt}). The copies on the box are fine. Read logs/burnticker-backup.log.` : `A backup destination has been set for ${h} hours, and no copy has left the box yet. Read logs/burnticker-backup.log.`, meta: { lastOffBoxAt: s.lastOffBoxAt ?? null, offBox: s.offBox ?? null } });
  }
  return out;
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
    const l = loopingUnits(units, restarts, state, shown === null ? new Set() : parseOneshot(shown));
    state.activating = l.next.activating; state.restarts = l.next.restarts;
    alerts.push(...unitAlerts(units, expectedUnits(o.env ?? process.env), l.looping));
    backupTimerInstalled = units.some((u) => u.unit === "mct-burnticker-backup.timer" && u.load !== "not-found");
  }
  catch (e) { note = `the unit check could not list the units (${String((e as Error)?.message ?? e).slice(0, 120)}); nothing raised for units`; }
  const b = readBackupStatusFile(o.root ?? process.cwd());
  alerts.push(...backupAlerts(b.status, o.now));
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
