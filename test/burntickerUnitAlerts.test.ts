// 2026-10-16 prelaunch audit F-5 / F-9: the cases that mattered reached nobody. The phone push covered ten alert kinds and a source that
// is down (bt-feed-down) or a failed systemd unit was not among them, and a hand-installed mct-rehearsal-keeper unit failed hourly for
// 2.5 days unseen. Now the push maps bt-feed-down (one per selector per day: the registry's (key, day) key), bt-unit-failed and
// bt-backup-failed, and the keeper's unit check (ops/unitHealth.ts, every five minutes beside the alert check) raises bt-unit-failed
// for ANY mct-* user unit in the failed state and for an expected unit that is not running (the mint bank, the synthetic creator's
// timer, the backup timer), and bt-backup-failed from data/backups/last-backup.json.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PUSH_KIND_OF_ALERT, PUSH_LEAD, PUSH_TITLE, planPushes } from "@/lib/burnticker/push";
import { openRegistry } from "@/lib/burnticker/registry";
import { registryAlertSink } from "@/lib/burnticker/alerts";

const LIST = [
  "mct-burnticker-web.service        loaded active   running Burnticker web",
  "mct-burnticker-keeper.service     loaded active   running Burnticker keeper",
  "mct-burnkeeper.service            loaded active   running Burn keeper for $DEFICIT",
  "mct-burnticker-mintbank.service   loaded active   running Burnticker mint key bank",
  "mct-burnticker-synth.service      loaded failed   failed  Burnticker synthetic creator",
  "mct-burnticker-synth.timer        loaded active   waiting Nightly Burnticker synthetic creator",
  "mct-rehearsal-keeper.service      loaded failed   failed  Burnticker $REHEARSAL keeper (one cycle; mainnet)",
  "mct-burnticker-backup.timer       loaded active   waiting Every 6 hours",
  "mct-burnticker-web-probe.timer    loaded active   waiting Every 5 minutes",
].join("\n");

describe("the phone push covers the cases that matter (F-5)", () => {
  test("bt-feed-down, bt-unit-failed and bt-backup-failed each map to a push kind with a title and a plain lead", () => {
    for (const k of ["bt-feed-down", "bt-unit-failed", "bt-backup-failed"]) {
      const kind = PUSH_KIND_OF_ALERT[k];
      assert.ok(kind, `${k} is not pushed`);
      assert.ok(PUSH_TITLE[kind] && PUSH_LEAD[kind], `${k}: title and lead`);
    }
  });
  test("a feed down is pushed once per selector per day: the registry keeps one row per key per Denver day", async () => {
    const reg = openRegistry(":memory:");
    const sink = registryAlertSink(reg);
    const t0 = Date.parse("2026-10-16T15:00:00Z");
    assert.ok(await sink("bt-feed-down", "bt-feed-down:espn.team:nfl-DEN", "down", null, t0));
    assert.equal(await sink("bt-feed-down", "bt-feed-down:espn.team:nfl-DEN", "down", null, t0 + 3_600_000), null, "the same selector the same day is not raised again");
    const plan = planPushes({ now: t0 + 60_000, alerts: reg.alertsSince(0), state: null });
    assert.equal(plan.messages.filter((m) => m.kind !== "daily").length, 1);
    assert.equal(plan.messages[0].kind, PUSH_KIND_OF_ALERT["bt-feed-down"]);
  });
});

describe("the keeper's unit check (F-5, F-9)", () => {
  test("any mct-* unit in the failed state is an alert, and each expected unit must be running", async () => {
    const { unitAlerts, parseUnitList, EXPECTED_UNITS } = await import("@/lib/burnticker/ops/unitHealth");
    const units = parseUnitList(LIST);
    assert.equal(units.length, 9);
    const a = unitAlerts(units, EXPECTED_UNITS);
    assert.equal(a.length, 1, "one combined alert");
    assert.equal(a[0].kind, "bt-unit-failed");
    assert.equal(a[0].key, "bt-unit-failed:mct-burnticker-synth.service+mct-rehearsal-keeper.service");
    assert.match(a[0].text, /mct-rehearsal-keeper\.service has failed/); assert.match(a[0].text, /mct-burnticker-synth\.service has failed/);
    // the mint bank stopped and the backup timer never installed
    const b = unitAlerts(parseUnitList(LIST.replace("mct-burnticker-mintbank.service   loaded active   running", "mct-burnticker-mintbank.service   loaded inactive dead").split("\n").filter((l) => !l.includes("backup")).join("\n")), EXPECTED_UNITS);
    assert.equal(b.length, 1);
    assert.match(b[0].text, /mct-burnticker-mintbank\.service, the mint key bank[^.]*, is not running/);
    assert.match(b[0].text, /mct-burnticker-backup\.timer, [^.]*, is not installed/);
  });

  test("a unit restarting (activating, auto-restart) or reloading counts as running: a deploy restart spends no alert (F-5 review)", async () => {
    const { unitAlerts, parseUnitList, EXPECTED_UNITS } = await import("@/lib/burnticker/ops/unitHealth");
    for (const state of ["activating auto-restart", "reloading reload"]) {
      const list = LIST.replace("mct-burnticker-mintbank.service   loaded active   running", `mct-burnticker-mintbank.service   loaded ${state}`);
      assert.ok(!unitAlerts(parseUnitList(list), EXPECTED_UNITS).some((a) => a.text.includes("mct-burnticker-mintbank.service, the")), state);
    }
  });

  test("one combined unit alert per cycle names every failed unit, and a new failure makes a new alert the same day (F-5 review)", async () => {
    const { runUnitCheck } = await import("@/lib/burnticker/ops/unitHealth");
    const reg = openRegistry(":memory:");
    const sink = registryAlertSink(reg);
    const t0 = Date.parse("2026-10-16T15:00:00Z");
    const stale = LIST.replace("mct-burnticker-synth.service      loaded failed   failed", "mct-burnticker-synth.service      loaded inactive dead");
    const a = await runUnitCheck({ sink, now: t0, root: os.tmpdir(), listUnits: async () => stale });
    assert.equal(a.raised.filter((x) => x.kind === "bt-unit-failed").length, 1);
    assert.match(a.raised[0].text, /mct-rehearsal-keeper\.service/);
    // the stale rehearsal keeper's alert is spent for the day; the mint bank then fails: a new alert, naming both
    const b = await runUnitCheck({ sink, now: t0 + 600_000, root: os.tmpdir(), listUnits: async () => stale.replace("mct-burnticker-mintbank.service   loaded active   running", "mct-burnticker-mintbank.service   loaded failed   failed") });
    const u = b.raised.filter((x) => x.kind === "bt-unit-failed");
    assert.equal(u.length, 1, "the new failure was hidden behind the rehearsal keeper's alert");
    assert.match(u[0].text, /mct-burnticker-mintbank\.service/); assert.match(u[0].text, /mct-rehearsal-keeper\.service/);
    // the push: the first alert went out; an hour later (the per-kind limit) the new one does, naming the mint bank
    const first = planPushes({ now: t0 + 1, alerts: reg.alertsSince(0).filter((x) => x.ts === t0), state: null });
    const next = planPushes({ now: t0 + 3_700_000, alerts: reg.alertsSince(t0 + 1), state: first.state });
    assert.ok(next.messages.some((m) => /mct-burnticker-mintbank/.test(m.body)));
  });

  test("a unit crash-looping under Restart=always alerts: activating at two checks in a row, or restarts rising by 3 or more (F-5 re-review)", async () => {
    const { runUnitCheck, RESTART_LOOP_MIN } = await import("@/lib/burnticker/ops/unitHealth");
    assert.equal(RESTART_LOOP_MIN, 3);
    const looping = LIST.replace("mct-burnticker-mintbank.service   loaded active   running", "mct-burnticker-mintbank.service   loaded activating auto-restart");
    const raised: string[] = [];
    const sink = async (_k: string, _key: string, text: string) => { raised.push(text); return true; };
    const state = { activating: new Set<string>(), restarts: new Map<string, number>() };
    const show = (n: number) => async () => `Id=mct-burnticker-mintbank.service\nNRestarts=${n}\n\nId=mct-burnkeeper.service\nNRestarts=0\n`;
    const t = Date.parse("2026-10-16T20:00:00Z");
    await runUnitCheck({ sink, now: t, root: os.tmpdir(), listUnits: async () => looping, showRestarts: show(1), state });
    assert.ok(!raised.some((x) => /mct-burnticker-mintbank\.service is restarting/.test(x)), "one sighting (a deploy restart) is not an alert");
    await runUnitCheck({ sink, now: t + 300_000, root: os.tmpdir(), listUnits: async () => looping, showRestarts: show(1), state });
    assert.ok(raised.some((x) => /mct-burnticker-mintbank\.service is restarting over and over/.test(x)), "activating at two checks in a row");
    // restarts rising while every listing happens to catch it running
    raised.length = 0;
    const s2 = { activating: new Set<string>(), restarts: new Map<string, number>() };
    await runUnitCheck({ sink, now: t, root: os.tmpdir(), listUnits: async () => LIST, showRestarts: show(4), state: s2 });
    await runUnitCheck({ sink, now: t + 300_000, root: os.tmpdir(), listUnits: async () => LIST, showRestarts: show(5), state: s2 });
    assert.ok(!raised.some((x) => /restarting/.test(x)), "one restart between checks (a deploy) is not an alert");
    await runUnitCheck({ sink, now: t + 600_000, root: os.tmpdir(), listUnits: async () => LIST, showRestarts: show(9), state: s2 });
    assert.ok(raised.some((x) => /mct-burnticker-mintbank\.service is restarting over and over \(4 restarts/.test(x)));
  });

  test("HB-1: a service that restarted on its own once since the last check raises bt-unit-restarted with its count and memory peak", async () => {
    const { runUnitCheck, parseMemoryPeaks } = await import("@/lib/burnticker/ops/unitHealth");
    const raised: { kind: string; key: string; text: string }[] = [];
    const sink = async (kind: string, key: string, text: string) => { raised.push({ kind, key, text }); return true; };
    // the web, the keeper (exits by design after a deploy) and the publish job (oneshot) all move their counters by one
    const show = (web: number, keeper: number, pub: number, peak = "2576980378") => async () =>
      `Id=mct-burnticker-web.service\nType=simple\nNRestarts=${web}\nMemoryPeak=${peak}\n\nId=mct-burnticker-keeper.service\nType=simple\nNRestarts=${keeper}\nMemoryPeak=247800000\n\nId=mct-burnticker-publish.service\nType=oneshot\nNRestarts=${pub}\nMemoryPeak=[not set]\n`;
    const state = { activating: new Set<string>(), restarts: new Map<string, number>() };
    const t = Date.parse("2026-10-19T17:45:00Z");
    await runUnitCheck({ sink, now: t, root: os.tmpdir(), listUnits: async () => LIST, showRestarts: show(0, 3, 0), state });
    assert.ok(!raised.some((x) => x.kind === "bt-unit-restarted"), "the first read is the baseline");
    await runUnitCheck({ sink, now: t + 300_000, root: os.tmpdir(), listUnits: async () => LIST, showRestarts: show(1, 4, 1), state });
    const r = raised.filter((x) => x.kind === "bt-unit-restarted");
    assert.equal(r.length, 1, JSON.stringify(raised));
    assert.equal(r[0].key, "bt-unit-restarted:mct-burnticker-web.service:1");
    assert.match(r[0].text, /^mct-burnticker-web\.service stopped on its own and systemd started it again \(once since the last check; restart count 1\)\. Its memory peak since it started again is 2\.6 GB\./);
    assert.match(r[0].text, /journalctl --user -u mct-burnticker-web\.service/);
    assert.ok(!raised.some((x) => /restarting over and over/.test(x.text)), "one restart is not a loop");
    // the next restart is a new alert (its own key); an unchanged count is silent; a count that went down (a manual start) is a new baseline
    raised.length = 0;
    await runUnitCheck({ sink, now: t + 600_000, root: os.tmpdir(), listUnits: async () => LIST, showRestarts: show(1, 4, 1), state });
    assert.equal(raised.filter((x) => x.kind === "bt-unit-restarted").length, 0);
    await runUnitCheck({ sink, now: t + 900_000, root: os.tmpdir(), listUnits: async () => LIST, showRestarts: show(2, 4, 1, "[not set]"), state });
    const again = raised.filter((x) => x.kind === "bt-unit-restarted");
    assert.equal(again.length, 1); assert.equal(again[0].key, "bt-unit-restarted:mct-burnticker-web.service:2");
    assert.doesNotMatch(again[0].text, /memory peak/, "no peak reported: nothing invented");
    raised.length = 0;
    await runUnitCheck({ sink, now: t + 1_200_000, root: os.tmpdir(), listUnits: async () => LIST, showRestarts: show(0, 4, 1), state });
    await runUnitCheck({ sink, now: t + 1_500_000, root: os.tmpdir(), listUnits: async () => LIST, showRestarts: show(0, 4, 1), state });
    assert.equal(raised.filter((x) => x.kind === "bt-unit-restarted").length, 0);
    // three or more between checks is the crash-loop alert alone
    await runUnitCheck({ sink, now: t + 1_800_000, root: os.tmpdir(), listUnits: async () => LIST, showRestarts: show(3, 4, 1), state });
    assert.equal(raised.filter((x) => x.kind === "bt-unit-restarted").length, 0);
    assert.ok(raised.some((x) => /mct-burnticker-web\.service is restarting over and over \(3 restarts/.test(x.text)));
    // it reaches the phone, in plain words
    assert.equal(PUSH_KIND_OF_ALERT["bt-unit-restarted"], "unit-restarted");
    assert.equal(PUSH_TITLE["unit-restarted"], "Burnticker service restarted on its own");
    assert.match(PUSH_LEAD["unit-restarted"], /stopped and systemd started it again/);
    assert.deepEqual([...parseMemoryPeaks("Id=a.service\nMemoryPeak=690500000\n\nId=b.service\nMemoryPeak=infinity\n\nId=c.service\nMemoryPeak=18446744073709551615\n")], [["a.service", 690500000]]);
  });

  test("HB-1: the unit check asks systemctl for MemoryPeak with the restart counts", () => {
    const src = fs.readFileSync("src/lib/burnticker/ops/unitHealth.ts", "utf8");
    assert.match(src, /"-p", "NRestarts", "-p", "Type", "-p", "MemoryPeak"/);
  });

  test("the backup status file: a failed run and a stale one raise bt-backup-failed; a good recent run raises nothing", async () => {
    const { backupAlerts } = await import("@/lib/burnticker/ops/unitHealth");
    const now = Date.parse("2026-10-16T20:00:00Z");
    assert.deepEqual(backupAlerts({ ok: true, at: "2026-10-16T18:17:00Z", files: [], offBox: "copied", error: null }, now), []);
    const failed = backupAlerts({ ok: false, at: "2026-10-16T18:17:00Z", files: [], offBox: "failed", error: "the off-box copy failed" }, now);
    assert.equal(failed.length, 1); assert.equal(failed[0].kind, "bt-backup-failed"); assert.match(failed[0].text, /off-box copy failed/);
    const stale = backupAlerts({ ok: true, at: "2026-10-16T02:00:00Z", files: [], offBox: "copied", error: null }, now);
    assert.equal(stale.length, 1); assert.match(stale[0].text, /18 hours/);
  });

  test("off the box: a low-priority note after 24 h without a copy, only when a destination is configured (F-7 review 8)", async () => {
    const { backupAlerts } = await import("@/lib/burnticker/ops/unitHealth");
    const now = Date.parse("2026-10-16T20:00:00Z");
    const recent = "2026-10-16T18:17:00Z";
    assert.deepEqual(backupAlerts({ ok: true, at: recent, offBox: "skipped", destConfigured: false, lastOffBoxAt: null, error: null }, now), [], "no destination: silent");
    assert.deepEqual(backupAlerts({ ok: true, at: recent, offBox: "copied", destConfigured: true, lastOffBoxAt: recent, error: null }, now), []);
    const stale = backupAlerts({ ok: true, at: recent, offBox: "nothing to copy", destConfigured: true, lastOffBoxAt: "2026-10-15T12:17:00Z", error: null }, now);
    assert.equal(stale.length, 1); assert.equal(stale[0].kind, "bt-backup-offbox-stale"); assert.match(stale[0].text, /31 hours/);
    const never = backupAlerts({ ok: true, at: recent, offBox: "nothing to copy", destConfigured: true, lastOffBoxAt: null, firstConfiguredAt: "2026-10-15T00:17:00Z", error: null } as never, now);
    assert.equal(never.length, 1);
    const kind = PUSH_KIND_OF_ALERT["bt-backup-offbox-stale"];
    assert.ok(kind);
    const plan = planPushes({ now, alerts: [{ ts: now - 1, kind: "bt-backup-offbox-stale", key: stale[0].key, text: stale[0].text }], state: null });
    assert.equal(plan.messages.find((m) => m.kind === kind)?.priority, "low");
  });

  test("the backup script records whether a destination is set and when the last copy left the box", () => {
    const src = fs.readFileSync("scripts/service/run-burnticker-backup.sh", "utf8");
    assert.match(src, /"destConfigured":%s/); assert.match(src, /"lastOffBoxAt":%s/);
  });

  test("runUnitCheck raises through the sink; systemctl that cannot run raises nothing and says why once", async () => {
    const { runUnitCheck } = await import("@/lib/burnticker/ops/unitHealth");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bt-units-"));
    try {
      fs.mkdirSync(path.join(root, "data/backups"), { recursive: true });
      fs.writeFileSync(path.join(root, "data/backups/last-backup.json"), JSON.stringify({ ok: false, at: "2026-10-16T18:17:00Z", files: [], offBox: "not tried", error: "data/burnticker.db is missing" }));
      const raised: string[] = [];
      const sink = async (kind: string, key: string) => { raised.push(`${kind} ${key}`); return true; };
      const r = await runUnitCheck({ sink, now: Date.parse("2026-10-16T20:00:00Z"), root, listUnits: async () => LIST });
      assert.deepEqual(raised.sort(), ["bt-backup-failed bt-backup-failed", "bt-unit-failed bt-unit-failed:mct-burnticker-synth.service+mct-rehearsal-keeper.service"]);
      assert.equal(r.raised.length, 2);
      const logs: string[] = [];
      const none = await runUnitCheck({ sink, now: Date.now(), root: os.tmpdir(), listUnits: async () => { throw new Error("Failed to connect to bus"); }, log: (s) => logs.push(s) });
      assert.equal(none.raised.length, 0);
      assert.match(none.note ?? "", /could not list the units/);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  // fourth prelaunch audit (2026-10-18), operations note: a missing or unreadable last-backup.json raised nothing, so a backup that never
  // ran was silent. After a grace of BACKUP_STATUS_GRACE_MS from the keeper's start (the timer's first run is due within six hours), a
  // missing or malformed status raises bt-backup-failed with a plain sentence. Only where the unit list ran and the timer is installed.
  test("no backup status (missing or malformed) raises bt-backup-failed after the grace from the keeper's start", async () => {
    const { runUnitCheck, BACKUP_STATUS_GRACE_MS } = await import("@/lib/burnticker/ops/unitHealth");
    assert.equal(BACKUP_STATUS_GRACE_MS, 8 * 3_600_000);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bt-units-nostatus-"));
    try {
      const startedAt = Date.parse("2026-10-16T12:00:00Z");
      const run = async (now: number, listUnits: () => Promise<string> = async () => LIST) => {
        const raised: { kind: string; text: string }[] = [];
        const sink = async (kind: string, _key: string, text: string) => { raised.push({ kind, text }); return true; };
        await runUnitCheck({ sink, now, root, listUnits, startedAt } as Parameters<typeof runUnitCheck>[0]);
        return raised.filter((a) => a.kind === "bt-backup-failed");
      };
      assert.deepEqual(await run(startedAt + 7 * 3_600_000), [], "inside the grace: nothing yet");
      const missing = await run(startedAt + 8 * 3_600_000 + 1);
      assert.equal(missing.length, 1, "missing status after the grace");
      assert.match(missing[0].text, /^No backup status was found\. /);
      assert.match(missing[0].text, /systemctl --user list-timers mct-burnticker-backup\.timer/);
      assert.doesNotMatch(missing[0].text, /→|\bwill\b/);
      fs.mkdirSync(path.join(root, "data/backups"), { recursive: true });
      fs.writeFileSync(path.join(root, "data/backups/last-backup.json"), "{ not json");
      const malformed = await run(startedAt + 9 * 3_600_000);
      assert.equal(malformed.length, 1, "malformed status after the grace");
      assert.match(malformed[0].text, /^No backup status was found\. The status file could not be read\./);
      // where the units cannot be listed (a Mac, no user bus) or the timer is not installed, nothing is said about backups
      assert.deepEqual(await run(startedAt + 9 * 3_600_000, async () => { throw new Error("Failed to connect to bus"); }), []);
      assert.deepEqual(await run(startedAt + 9 * 3_600_000, async () => LIST.split("\n").filter((l) => !l.includes("backup.timer")).join("\n")), []);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  // SECOND 2026-10-18 AUDIT A-7: a stopped web unit or $DEFICIT keeper raised nothing (only the mint bank and two timers were expected),
  // and a oneshot timer job mid-run (activating start) at two checks was reported as a crash loop.
  test("A-7: a stopped web unit, Burnticker keeper or $DEFICIT keeper is an alert", async () => {
    const { unitAlerts, parseUnitList, EXPECTED_UNITS } = await import("@/lib/burnticker/ops/unitHealth");
    for (const [unit, what] of [["mct-burnticker-web.service", "the Burnticker website"], ["mct-burnticker-keeper.service", "the Burnticker keeper"], ["mct-burnkeeper.service", "the \\$DEFICIT burn keeper"]] as const) {
      const stopped = LIST.split("\n").map((l) => (l.startsWith(`${unit} `) ? `${unit}   loaded inactive dead  stopped` : l)).join("\n");
      const a = unitAlerts(parseUnitList(stopped), EXPECTED_UNITS);
      assert.equal(a.length, 1);
      assert.match(a[0].text, new RegExp(`${unit.replace(/\./g, "\\.")}, ${what}[^.]*, is not running`), a[0].text);
      const missing = unitAlerts(parseUnitList(LIST.split("\n").filter((l) => !l.startsWith(`${unit} `)).join("\n")), EXPECTED_UNITS);
      assert.match(missing[0].text, new RegExp(`${unit.replace(/\./g, "\\.")}, [^.]*is not installed`));
    }
  });

  test("review of A-7: a standby keeper's host does not expect the web unit or the $DEFICIT keeper (no daily alert there)", async () => {
    const { runUnitCheck } = await import("@/lib/burnticker/ops/unitHealth");
    const bare = LIST.split("\n").filter((l) => !l.startsWith("mct-burnticker-web.service ") && !l.startsWith("mct-burnkeeper.service ")).join("\n");
    const check = async (env: Record<string, string>) => {
      const raised: string[] = [];
      const sink = async (_k: string, _key: string, text: string) => { raised.push(text); return true; };
      await runUnitCheck({ sink, now: Date.parse("2026-10-16T20:00:00Z"), root: os.tmpdir(), listUnits: async () => bare, showRestarts: async () => "", state: { activating: new Set(), restarts: new Map() }, env });
      return raised.join("\n");
    };
    const standby = await check({ BURNTICKER_KEEPER_ROLE: "standby" });
    assert.doesNotMatch(standby, /mct-burnticker-web\.service|mct-burnkeeper\.service/, standby);
    assert.match(standby, /mct-burnticker-synth\.service has failed/, "the rest of the check still runs");
    for (const env of [{}, { BURNTICKER_KEEPER_ROLE: "leader" }] as Record<string, string>[]) {
      const primary = await check(env);
      assert.match(primary, /mct-burnticker-web\.service, the Burnticker website, is not installed/);
      assert.match(primary, /mct-burnkeeper\.service, the \$DEFICIT burn keeper, is not installed/);
    }
  });

  test("A-7: a oneshot timer job in a long run is never 'restarting over and over'; a real auto-restart still is", async () => {
    const { runUnitCheck } = await import("@/lib/burnticker/ops/unitHealth");
    const raised: string[] = [];
    const sink = async (_k: string, _key: string, text: string) => { raised.push(text); return true; };
    const t = Date.parse("2026-10-16T20:00:00Z");
    // the backup and publish jobs are mid-run (activating start) at three checks in a row, and the publish job's restart counter moves
    const busy = `${LIST}\nmct-burnticker-backup.service     loaded activating start   Burnticker backup\nmct-burnticker-publish.service    loaded activating start   Burnticker publish`;
    const show = (n: number) => async () => `Id=mct-burnticker-backup.service\nType=oneshot\nNRestarts=0\n\nId=mct-burnticker-publish.service\nType=oneshot\nNRestarts=${n}\n\nId=mct-burnkeeper.service\nType=simple\nNRestarts=0\n`;
    const state = { activating: new Set<string>(), restarts: new Map<string, number>() };
    for (let i = 0; i < 3; i++) await runUnitCheck({ sink, now: t + i * 300_000, root: os.tmpdir(), listUnits: async () => busy, showRestarts: show(i * 5), state });
    assert.ok(!raised.some((x) => /restarting over and over/.test(x)), raised.join("\n"));
    // a simple service waiting to restart (auto-restart) at two checks is still a crash loop
    const loop = LIST.replace("mct-burnkeeper.service            loaded active   running", "mct-burnkeeper.service            loaded activating auto-restart");
    const s2 = { activating: new Set<string>(), restarts: new Map<string, number>() };
    for (let i = 0; i < 2; i++) await runUnitCheck({ sink, now: t + i * 300_000, root: os.tmpdir(), listUnits: async () => loop, showRestarts: show(0), state: s2 });
    assert.ok(raised.some((x) => /mct-burnkeeper\.service is restarting over and over/.test(x)));
  });

  test("the keeper calls the unit check on its alert cadence, before the push check", () => {
    const src = fs.readFileSync("scripts/burnticker-keeper.mts", "utf8");
    const i = src.indexOf("runUnitCheck("), j = src.indexOf("runPushCheck({ registry, env: process.env, now, log })");
    assert.ok(i > 0, "the keeper does not run the unit check");
    assert.ok(i < j, "the unit check runs before the push check, so its alerts are pushed the same cycle");
  });
});
