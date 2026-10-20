// AUDITORS' B-3 / OPS-1 (2026-10-19): the off-box copy is a PULL from the operator's own machine, so the host's backup status
// (data/backups/last-backup.json, offBox "skipped", destConfigured false) read "no off-box backup" while one ran every six hours. A good
// pull now records itself on the host as data/offbox-pull.json; the keeper reads it (ops/unitHealth.ts offboxPullFact): pulled under
// 12 hours, stale after (and the backup-offbox push), none when absent or malformed. This file checks the reader, the alert, the ops
// line, that nothing outside the receipt's fixed keys is ever accepted, the pulling script's order (when it is on this machine), and
// the copy lint on the new public sentences.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { backupAlerts, checkOffboxPull, readOffboxPullFile, readOffboxPullSeen, offboxPullAlerts, offboxPullFact, offboxPullLine, parseOffboxPull, readOffboxPull, runUnitCheck, OFFBOX_PULL_FILE, OFFBOX_PULL_KEYS, OFFBOX_PULL_SCHEMA, OFFBOX_PULL_STALE_MS, type BackupStatus } from "@/lib/burnticker/ops/unitHealth";
import { hostFactLines, type HostFacts } from "@/lib/burnticker/checkin";
import { PUSH_KIND_OF_ALERT, PUSH_LOW_PRIORITY } from "@/lib/burnticker/push";
import { lintCopy } from "@/lib/launch/copyLint";

const now = Date.parse("2026-10-19T18:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
const receipt = (over: Record<string, unknown> = {}) => ({ schema: OFFBOX_PULL_SCHEMA, pulledAt: iso(now - 2 * 3_600_000), method: "operator-pull", files: { db: 3, secretsBundle: true }, dbQuickCheck: "ok", retentionDays: 30, host: "Mac15,12", ...over });
const parse = (o: unknown) => parseOffboxPull(JSON.stringify(o), now);
const noDest: BackupStatus = { ok: true, at: iso(now - 3_600_000), files: [], offBox: "skipped", destConfigured: false, lastOffBoxAt: null, error: null };

describe("B-3 / OPS-1: the off-box pull receipt", () => {
  test("a fresh receipt reads as pulled, with lastOffBoxAt = pulledAt and the method; no alert", () => {
    const r = parse(receipt());
    assert.ok(r);
    const f = offboxPullFact(r, now);
    assert.deepEqual(f, { offBox: "pulled", lastOffBoxAt: r.pulledAt, offBoxMethod: "operator-pull", offBoxPulledAt: r.pulledAt });
    assert.deepEqual(offboxPullAlerts(r, now), []);
    assert.deepEqual(backupAlerts(noDest, now, r), []);
    assert.equal(offboxPullFact(parse(receipt({ pulledAt: iso(now - OFFBOX_PULL_STALE_MS) })), now).offBox, "pulled", "exactly 12 hours is still fresh");
  });

  test("a 13-hour-old receipt is stale and raises the backup-offbox push with the plain text", () => {
    const at = iso(now - 13 * 3_600_000);
    const r = parse(receipt({ pulledAt: at }));
    assert.equal(offboxPullFact(r, now).offBox, "stale");
    const a = backupAlerts(noDest, now, r);
    assert.equal(a.length, 1);
    assert.equal(a[0].kind, "bt-backup-offbox-stale");
    assert.equal(a[0].text, `The off-box backup pull has not reported for more than 12 hours. The last pull was at ${at}. Check the Mac's backup agent.`);
    assert.equal(PUSH_KIND_OF_ALERT[a[0].kind], "backup-offbox");
    assert.ok(PUSH_LOW_PRIORITY.has("backup-offbox"));
    // raised even with no backup status file at all
    assert.equal(backupAlerts(null, now, r).length, 1);
  });

  test("absent reads as none and raises nothing", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bt-offbox-"));
    try {
      assert.equal(readOffboxPull(root, now), null);
      assert.deepEqual(offboxPullFact(null, now), { offBox: "none", lastOffBoxAt: null, offBoxMethod: null, offBoxPulledAt: null });
      assert.deepEqual(backupAlerts(noDest, now, null), []);
      fs.mkdirSync(path.join(root, "data"));
      fs.writeFileSync(path.join(root, OFFBOX_PULL_FILE), JSON.stringify(receipt()));
      assert.equal(offboxPullFact(readOffboxPull(root, now), now).offBox, "pulled", "read from data/offbox-pull.json");
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  test("a malformed receipt reads as none", () => {
    for (const bad of ["{ not json", "[]", "null", JSON.stringify(receipt({ schema: "burnticker.offbox-pull/v2" })), JSON.stringify(receipt({ dbQuickCheck: "failed" })),
      JSON.stringify(receipt({ pulledAt: "yesterday" })), JSON.stringify(receipt({ pulledAt: iso(now + 3_600_000) })), JSON.stringify(receipt({ files: { db: 0, secretsBundle: true } })),
      JSON.stringify(receipt({ files: { db: 3 } })), JSON.stringify(receipt({ retentionDays: "30" })), JSON.stringify(receipt({ method: "Mac Pull" })), JSON.stringify(receipt({ method: "machine-pull" })), JSON.stringify(receipt({ method: "operator-pull-2" })), JSON.stringify(receipt({ host: "a b" }))]) {
      const r = parseOffboxPull(bad, now);
      assert.equal(r, null, bad);
      assert.equal(offboxPullFact(r, now).offBox, "none");
    }
  });

  test("the receipt never carries a secret: only its fixed keys are accepted, and the fact never carries the host", () => {
    assert.deepEqual([...OFFBOX_PULL_KEYS].sort(), ["dbQuickCheck", "files", "host", "method", "pulledAt", "retentionDays", "schema"]);
    for (const extra of [{ passphrase: "x" }, { secret: "x" }, { path: "x" }, { env: "x" }, { files: { db: 3, secretsBundle: true, key: "x" } }]) assert.equal(parse(receipt(extra)), null, JSON.stringify(extra));
    const r = parse(receipt())!;
    assert.deepEqual(Object.keys(r).sort(), [...OFFBOX_PULL_KEYS].sort());
    assert.deepEqual(Object.keys(r.files).sort(), ["db", "secretsBundle"]);
    const f = offboxPullFact(r, now);
    assert.deepEqual(Object.keys(f).sort(), ["lastOffBoxAt", "offBox", "offBoxMethod", "offBoxPulledAt"]);
    assert.ok(!JSON.stringify(f).includes("Mac15"), "the receipt's host stays out of ops.json");
  });

  test("a fresh pull is a healthy off-box copy: the destination's own staleness is not raised beside it", () => {
    const dest: BackupStatus = { ok: true, at: iso(now - 3_600_000), offBox: "nothing to copy", destConfigured: true, lastOffBoxAt: iso(now - 40 * 3_600_000), error: null };
    assert.equal(backupAlerts(dest, now, null).length, 1, "destination stale, no pull: raised as before");
    assert.deepEqual(backupAlerts(dest, now, parse(receipt())), []);
  });

  test("hostFacts and the ops line: backupDestConfigured stays false, the off-box line says pulled / STALE / none", () => {
    const base: HostFacts = { dispersal: { on: true, line: "dispersal on" }, webhookConfigured: false, pushConfigured: true, heartbeatConfigured: true, backupDestConfigured: false, programHashSource: "program hash: x" };
    const pulled = { ...base, ...offboxPullFact(parse(receipt()), now) };
    const lines = hostFactLines(pulled, now);
    assert.match(lines[1], /BURNTICKER_BACKUP_DEST NOT SET \(the off-box copy is pulled instead; see the off-box line\)/);
    assert.match(lines.at(-1)!, /^- off-box backup pull: pulled \(operator-pull\), last pull 2 h ago \(2026-10-19T16:00:00Z\)$/);
    const stale = hostFactLines({ ...base, ...offboxPullFact(parse(receipt({ pulledAt: iso(now - 13 * 3_600_000) })), now) }, now);
    assert.match(stale.at(-1)!, /off-box backup pull: STALE/);
    assert.match(hostFactLines({ ...base, ...offboxPullFact(null, now) }, now).at(-1)!, /off-box backup pull: none/);
    assert.equal(hostFactLines(base, now).length, 3, "an older document without the fact prints no off-box line");
    assert.match(hostFactLines(base, now)[1], /BURNTICKER_BACKUP_DEST NOT SET \(backups stay on the box\)/);
    assert.equal(offboxPullLine(null, now), null);
  });

  test("the keeper's unit check reads the receipt from its root and raises the stale pull", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bt-offbox-unit-"));
    try {
      fs.mkdirSync(path.join(root, "data", "backups"), { recursive: true });
      fs.writeFileSync(path.join(root, "data", "backups", "last-backup.json"), JSON.stringify(noDest));
      fs.writeFileSync(path.join(root, OFFBOX_PULL_FILE), JSON.stringify(receipt({ pulledAt: iso(now - 13 * 3_600_000) })));
      const seen: string[] = [];
      const r = await runUnitCheck({ now, root, listUnits: async () => "", sink: async (kind, key) => { seen.push(`${kind}|${key}`); return true; }, state: { activating: new Set(), restarts: new Map() } });
      assert.deepEqual(seen.filter((s) => s.startsWith("bt-backup")), ["bt-backup-offbox-stale|bt-backup-offbox-pull-stale"]);
      assert.equal(r.raised.filter((a) => a.kind.startsWith("bt-backup")).length, 1);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  test("the pulling script writes the receipt only after the database copy and quick_check succeed (skipped where the script is absent)", () => {
    const script = process.env.BURNTICKER_OFFBOX_PULL_SCRIPT ?? path.join(os.homedir(), "mct-runner-study", "launch-debt-egg-2026-10-09", "ops", "box-backup-pull.sh");
    if (!fs.existsSync(script)) return;
    const src = fs.readFileSync(script, "utf8");
    const at = (needle: string) => { const i = src.indexOf(needle); assert.ok(i >= 0, `the script has ${needle}`); return i; };
    const write = at("offbox-pull.json\"; then exit 0");
    assert.ok(at("PRAGMA quick_check") < write && at("cp \"$f\" \"$ICLOUD/db/$b\"") < write, "quick_check and the copy come first");
    const guard = src.lastIndexOf("if [ \"$qcfail\" = 0 ] && [ \"$dbn\" -gt 0 ]; then", write);
    assert.ok(guard > at("PRAGMA quick_check"), "the write sits under the qcfail/dbn guard");
    assert.match(src, /qcfail=1; fi/, "a failed quick_check sets the guard");
    assert.match(src, /mktemp .*chown mct: .*chmod 0640 .*mv -f/, "atomic, owned by mct, mode 0640");
    const block = src.slice(src.indexOf("RECEIPT=$(printf"), write);
    for (const s of ["\"schema\":\"burnticker.offbox-pull/v1\"", "\"method\":\"operator-pull\"", "\"dbQuickCheck\":\"ok\"", "\"retentionDays\":30"]) assert.ok(block.includes(s), s);
    assert.doesNotMatch(block, /PASS|\$HOME|\$DEST|\$ICLOUD|hostname|scutil/, "no passphrase, no Mac path, no personal hostname in the receipt");
  });

  test("the new public sentences pass the copy lint", () => {
    const docs = fs.readFileSync(path.join("docs", "burnticker", "runbook.md"), "utf8").replace(/\s+/g, " ");
    const todo = fs.readFileSync(path.join("docs", "burnticker", "TODO-OWNER.md"), "utf8");
    const sentences = [
      "Instead, a copy is pulled to separate storage every six hours: the operator's own machine fetches the backups over ssh, checks each database copy with `PRAGMA quick_check`, keeps it for 30 days in the operator's own storage, and then records the pull on the host in `data/offbox-pull.json`",
      "Settled another way: a copy is pulled to separate storage every six hours (the operator's own storage), and the host records the last pull in `data/offbox-pull.json`, which ops.json reports as `offBox` `pulled`, `stale` or `none`.",
      "The off-box backup pull has not reported for more than 12 hours. The last pull was at the time below. Check the Mac's backup agent.",
      "The backups on the host are fine, but no copy has left the box for too long: the backup destination has taken none for a day, or the off-box pull has not reported for 12 hours. A lost disk would lose them.",
    ];
    assert.ok(docs.includes(sentences[0]) && todo.includes(sentences[1]), "the sentences are the ones in the docs");
    for (const s of sentences) {
      const r = lintCopy(s);
      assert.equal(r.ok, true, `${s}: ${r.hits.map((h) => h.phrase).join(", ")}`);
      assert.doesNotMatch(s, /\b(buy|price|will|payout|target|guarantee)\b|→|->|icloud|\b20\d\d-\d\d-\d\d\b/i);
    }
    assert.doesNotMatch(docs + todo, /icloud/i, "the docs do not name the operator's storage service");
  });
});

// HB-49 (continuous audit 2026-10-19, hourly run 4): a missing or unreadable receipt read as "none" and raised nothing, so a total loss of
// the off-box copy was silent. Once a good receipt has been seen (data/offbox-pull.seen), a missing one alerts after 12 hours like a stale
// one, and an unreadable one always alerts with the reason.
describe("HB-49: a lost or unreadable off-box pull receipt alerts", () => {
  const unitCheck = async (root: string, at: number) => {
    const seen: string[] = [];
    const texts: string[] = [];
    await runUnitCheck({ now: at, root, listUnits: async () => "", sink: async (kind, key, text) => { if (kind.startsWith("bt-backup")) { seen.push(`${kind}|${key}`); texts.push(text); } return true; }, state: { activating: new Set(), restarts: new Map() } });
    return { seen, texts };
  };
  const scratch = () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bt-offbox-hb49-"));
    fs.mkdirSync(path.join(root, "data", "backups"), { recursive: true });
    fs.writeFileSync(path.join(root, "data", "backups", "last-backup.json"), JSON.stringify(noDest));
    return root;
  };

  test("a good receipt writes the seen marker; deleted, with the last pull 13 hours old: one bt-backup-offbox-stale alert", async () => {
    const root = scratch();
    try {
      const pulledAt = iso(now - 2 * 3_600_000);
      fs.writeFileSync(path.join(root, OFFBOX_PULL_FILE), JSON.stringify(receipt({ pulledAt })));
      assert.deepEqual((await unitCheck(root, now)).seen, [], "a fresh receipt raises nothing");
      assert.equal(readOffboxPullSeen(root), pulledAt, "the seen marker keeps the last good pull");
      fs.rmSync(path.join(root, OFFBOX_PULL_FILE));
      assert.deepEqual((await unitCheck(root, now)).seen, [], "gone, but the last pull is under 12 hours old");
      const later = Date.parse(pulledAt) + 13 * 3_600_000;
      const { seen, texts } = await unitCheck(root, later);
      assert.deepEqual(seen, ["bt-backup-offbox-stale|bt-backup-offbox-pull-stale"]);
      assert.match(texts[0], /The off-box pull receipt is gone from the host, and the last pull it showed was at .+, more than 12 hours ago\. Check the Mac's backup agent\./);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  test("a marker 13 hours old and no receipt (the pure check)", () => {
    const seenPulledAt = iso(now - 13 * 3_600_000);
    const a = backupAlerts(noDest, now, null, { problem: "missing", seenPulledAt });
    assert.equal(a.length, 1);
    assert.equal(a[0].kind, "bt-backup-offbox-stale");
    assert.deepEqual(offboxPullAlerts(null, now, { problem: "missing", seenPulledAt: iso(now - 11 * 3_600_000) }), []);
  });

  test("a receipt with method \"rsync\" alerts naming the reason, never silence", async () => {
    const root = scratch();
    try {
      fs.writeFileSync(path.join(root, OFFBOX_PULL_FILE), JSON.stringify(receipt({ method: "rsync" })));
      const read = readOffboxPullFile(root, now);
      assert.equal(read.receipt, null);
      assert.equal(read.problem, "its method is \"rsync\", not \"operator-pull\"");
      const { seen, texts } = await unitCheck(root, now);
      assert.deepEqual(seen, ["bt-backup-offbox-stale|bt-backup-offbox-pull-unreadable"]);
      assert.equal(texts[0], "The off-box pull receipt on the host could not be read: its method is \"rsync\", not \"operator-pull\". Check the Mac's backup agent.");
      assert.equal(readOffboxPullSeen(root), null, "an unreadable receipt never sets the marker");
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  test("every unreadable shape names a reason, and a value is never echoed unless it is a plain short word", () => {
    for (const bad of ["{ not json", "[]", JSON.stringify(receipt({ dbQuickCheck: "failed" })), JSON.stringify(receipt({ pulledAt: iso(now + 3_600_000) })), JSON.stringify(receipt({ password: "x" })), JSON.stringify(receipt({ method: "s3://bucket/secret key" }))]) {
      const c = checkOffboxPull(bad, now);
      assert.ok("reason" in c && c.reason.length > 0, bad);
      assert.doesNotMatch((c as { reason: string }).reason, /bucket|secret key/);
    }
  });

  test("no receipt and no marker: none", async () => {
    const root = scratch();
    try {
      assert.deepEqual((await unitCheck(root, now)).seen, []);
      assert.deepEqual(offboxPullAlerts(null, now, { problem: "missing", seenPulledAt: null }), []);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});
