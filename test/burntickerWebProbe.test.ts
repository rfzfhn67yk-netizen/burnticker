// Audit 2026-10-19 I-11 / B-4: a hung web process or a dead Caddy was caught by nobody. These run the real external web check
// (scripts/service/burnticker-web-probe.sh) in a temporary root with a fake curl first on PATH: 200 + the schema pings the monitor, a 503
// or a timeout or a body that is not the expected JSON posts "<url>/fail" with the code, an unset URL skips once a day, the URL is
// never logged or written; then the ops fact reader, the units and installer lines, and the public gate.
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readWebProbeStatus, webProbeFact, webProbeLine, EXPECTED_UNITS, WEB_PROBE_STALE_MS } from "@/lib/burnticker/ops/unitHealth";
import { hostFactLines, type HostFacts } from "@/lib/burnticker/checkin";

const SCRIPT = path.resolve("scripts/service/burnticker-web-probe.sh");
const PING = "https://hc-ping.com/0000-test-token";
// the fake curl: the probe call (current-status) answers per FAKE_MODE; every call is recorded, one line per call, args joined by "|"
const FAKE_CURL = `#!/bin/sh
printf '%s\\n' "$*" | tr ' ' '|' >> "$FAKE_LOG"
case "$*" in
  *current-status*)
    out=""; for a in "$@"; do if [ "$prev" = "-o" ]; then out=$a; fi; prev=$a; done
    case "$FAKE_MODE" in
      ok) printf '{"schema":"burnticker.current-status/v1","phase":"live"}' > "$out"; printf 200 ;;
      503) printf 'Service Unavailable' > "$out"; printf 503 ;;
      timeout) printf 000; exit 28 ;;
      notjson) printf '<html>ok</html>' > "$out"; printf 200 ;;
      wrongschema) printf '{"schema":"something-else/v1"}' > "$out"; printf 200 ;;
    esac ;;
  *) exit 0 ;;
esac
`;

let root = "", bin = "";
function run(mode: string, env: Record<string, string> = {}, args: string[] = []) {
  const log = path.join(root, "curl-calls.log");
  fs.rmSync(log, { force: true });
  const r = spawnSync("sh", [SCRIPT, ...args], { encoding: "utf8", env: { PATH: `${bin}:${process.env.PATH ?? "/usr/bin:/bin"}`, HOME: root, TMPDIR: root, BURNTICKER_WEB_PROBE_ROOT: root, FAKE_MODE: mode, FAKE_LOG: log, ...env } as unknown as NodeJS.ProcessEnv });
  const calls = fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n").filter(Boolean) : [];
  return { code: r.status, out: `${r.stdout}${r.stderr}`, calls };
}
const lastLog = () => fs.readFileSync(path.join(root, "logs/burnticker-web-probe.log"), "utf8").trim().split("\n").at(-1) ?? "";
const status = () => JSON.parse(fs.readFileSync(path.join(root, "data/web-probe-last.json"), "utf8")) as Record<string, unknown>;

describe("the external web check (I-11 / B-4)", () => {
  before(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "bt-webprobe-"));
    bin = path.join(root, "bin"); fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, "curl"), FAKE_CURL, { mode: 0o755 });
  });
  after(() => fs.rmSync(root, { recursive: true, force: true }));

  test("HTTP 200 with the schema: one GET of the public current-status, then one ping to the monitor; the URL is never logged", () => {
    const r = run("ok", { BURNTICKER_WEB_HEARTBEAT_URL: PING });
    assert.equal(r.code, 0, r.out);
    assert.equal(r.calls.length, 2, r.calls.join("\n"));
    assert.match(r.calls[0], /--max-time\|20\|.*https:\/\/burnticker\.com\/api\/burnticker\/v1\/current-status$/);
    assert.ok(r.calls[1].endsWith(`|${PING}`) && !r.calls[1].includes("/fail"), r.calls[1]);
    assert.match(lastLog(), /ok: HTTP 200, burnticker\.current-status\/v1/);
    const s = status();
    assert.equal(s.outcome, "ok"); assert.equal(s.configured, true); assert.equal(s.code, "200"); assert.equal(s.pinged, true); assert.equal(typeof s.lastOkAt, "string");
    for (const f of ["logs/burnticker-web-probe.log", "data/web-probe-last.json"]) assert.ok(!fs.readFileSync(path.join(root, f), "utf8").includes("test-token"), `${f} names the URL`);
  });

  test("HTTP 503: POST <url>/fail with the code in the body; the last ok time is kept", () => {
    const okAt = status().lastOkAt;
    const r = run("503", { BURNTICKER_WEB_HEARTBEAT_URL: PING });
    assert.equal(r.code, 0, r.out);
    assert.equal(r.calls.length, 2);
    assert.ok(r.calls[1].endsWith(`|${PING}/fail`), r.calls[1]);
    assert.match(r.calls[1], /--data-raw\|code=503\|HTTP\|503/);
    assert.match(lastLog(), /FAIL: code=503 HTTP 503/);
    const s = status();
    assert.equal(s.outcome, "fail"); assert.equal(s.code, "503"); assert.equal(s.lastOkAt, okAt);
  });

  test("a timeout: /fail with code 000 and the reason; one probe, no retry", () => {
    const r = run("timeout", { BURNTICKER_WEB_HEARTBEAT_URL: `${PING}/` });
    assert.equal(r.code, 0, r.out);
    assert.equal(r.calls.filter((c) => c.includes("current-status")).length, 1, "never retried");
    assert.ok(r.calls[1].endsWith(`|${PING}/fail`), r.calls[1]);
    assert.match(r.calls[1], /code=000\|timed\|out/);
    assert.match(lastLog(), /FAIL: code=000 timed out after 20 s/);
  });

  test("HTTP 200 but not JSON, or JSON without the expected schema: /fail", () => {
    for (const [mode, why] of [["notjson", /the body is not JSON/], ["wrongschema", /the JSON is not burnticker\.current-status\/v1/]] as const) {
      const r = run(mode, { BURNTICKER_WEB_HEARTBEAT_URL: PING });
      assert.equal(r.code, 0, r.out);
      assert.ok(r.calls[1].endsWith(`|${PING}/fail`), `${mode}: ${r.calls[1]}`);
      assert.match(r.calls[1], /code=200/);
      assert.match(lastLog(), why);
      assert.equal(status().outcome, "fail");
    }
  });

  test("the URL is read from that ONE line of the env file when the environment has none", () => {
    fs.writeFileSync(path.join(root, ".env.local"), `OTHER_SECRET=nope\nBURNTICKER_WEB_HEARTBEAT_URL="${PING}"\n`);
    try {
      const r = run("ok");
      assert.equal(r.calls.length, 2); assert.ok(r.calls[1].endsWith(`|${PING}`));
      assert.ok(!r.calls.join("\n").includes("nope"));
    } finally { fs.rmSync(path.join(root, ".env.local")); }
  });

  test("a URL that is not https or already ends in /fail is refused: nothing is sent, exit 2", () => {
    for (const u of ["http://hc-ping.com/x", `${PING}/fail`]) {
      const r = run("ok", { BURNTICKER_WEB_HEARTBEAT_URL: u });
      assert.equal(r.code, 2, r.out); assert.equal(r.calls.length, 0);
      assert.equal(status().outcome, "refused");
    }
  });

  test("unset: no request, \"skipped\" logged once a day, exit 0", () => {
    fs.rmSync(path.join(root, "data/web-probe-last.json"), { force: true });
    const before = fs.readFileSync(path.join(root, "logs/burnticker-web-probe.log"), "utf8").split("\n").length;
    const a = run("ok"), b = run("ok");
    assert.equal(a.code, 0); assert.equal(b.code, 0);
    assert.equal(a.calls.length + b.calls.length, 0, "no request without a URL");
    const lines = fs.readFileSync(path.join(root, "logs/burnticker-web-probe.log"), "utf8").split("\n");
    assert.equal(lines.length - before, 1, "one skipped line for the day");
    assert.match(lastLog(), /skipped: BURNTICKER_WEB_HEARTBEAT_URL is not set/);
    assert.equal(status().outcome, "skipped"); assert.equal(status().configured, false);
  });

  test("--check prints what it would do and makes no request", () => {
    const r = run("ok", { BURNTICKER_WEB_HEARTBEAT_URL: PING, BURNTICKER_WEB_PROBE_HOST: "staging.example.com" }, ["--check"]);
    assert.equal(r.code, 0, r.out); assert.equal(r.calls.length, 0);
    assert.match(r.out, /would GET {2}https:\/\/staging\.example\.com\/api\/burnticker\/v1\/current-status/);
    assert.match(r.out, /BURNTICKER_WEB_HEARTBEAT_URL is set/);
    assert.ok(!r.out.includes("test-token"));
  });
});

describe("the external web check in the ops facts", () => {
  const now = Date.parse("2026-10-19T18:00:00Z");
  test("readWebProbeStatus reads data/web-probe-last.json; missing or malformed is null", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bt-webprobe-facts-"));
    try {
      assert.equal(readWebProbeStatus(dir), null);
      fs.mkdirSync(path.join(dir, "data"));
      fs.writeFileSync(path.join(dir, "data/web-probe-last.json"), "{nope");
      assert.equal(readWebProbeStatus(dir), null);
      fs.writeFileSync(path.join(dir, "data/web-probe-last.json"), JSON.stringify({ configured: true, outcome: "ok", at: "2026-10-19T17:57:00Z", code: "200", reason: null, lastOkAt: "2026-10-19T17:57:00Z", pinged: true }));
      const s = readWebProbeStatus(dir);
      assert.equal(s?.outcome, "ok");
      assert.match(webProbeLine(webProbeFact(s), now)!, /external web check: configured, last ok 3 min ago/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  test("the lines: not configured, no result yet, failing, refused, stale; configured from the env alone; never a URL", () => {
    assert.match(webProbeLine(webProbeFact(null), now)!, /not configured \(set BURNTICKER_WEB_HEARTBEAT_URL/);
    assert.match(webProbeLine(webProbeFact(null, { BURNTICKER_WEB_HEARTBEAT_URL: PING }), now)!, /configured, no result yet/);
    const fail = webProbeFact({ configured: true, outcome: "fail", at: "2026-10-19T17:55:00Z", code: "503", reason: "HTTP 503", lastOkAt: "2026-10-19T17:40:00Z" });
    assert.match(webProbeLine(fail, now)!, /FAILING \(code 503, HTTP 503\) 5 min ago .*last ok 20 min ago/);
    assert.match(webProbeLine(webProbeFact({ configured: true, outcome: "refused", at: "2026-10-19T17:59:00Z" }), now)!, /REFUSED/);
    const old = new Date(now - WEB_PROBE_STALE_MS - 60_000).toISOString();
    assert.match(webProbeLine(webProbeFact({ configured: true, outcome: "ok", at: old, lastOkAt: old }), now)!, /has not run for 21 min/);
    const f = webProbeFact({ configured: true, outcome: "ok", at: "2026-10-19T17:59:00Z" }, { BURNTICKER_WEB_HEARTBEAT_URL: PING });
    assert.ok(!JSON.stringify(f).includes("hc-ping"));
  });
  test("hostFactLines adds the line when the keeper reports it, and not otherwise", () => {
    const facts: HostFacts = { dispersal: { on: true, line: "dispersal on" }, webhookConfigured: false, pushConfigured: true, heartbeatConfigured: true, backupDestConfigured: true, programHashSource: "program hash: x" };
    assert.equal(hostFactLines(facts, now).length, 3);
    const lines = hostFactLines({ ...facts, webProbe: webProbeFact({ configured: true, outcome: "ok", at: "2026-10-19T17:58:00Z", lastOkAt: "2026-10-19T17:58:00Z" }) }, now);
    assert.equal(lines.length, 4); assert.match(lines[3], /external web check: configured, last ok 2 min ago/);
  });
  test("the timer is an expected unit, so a stopped probe raises bt-unit-failed", () => {
    assert.ok(EXPECTED_UNITS.some((e) => e.unit === "mct-burnticker-web-probe.timer"));
  });
});

describe("the external web check's units, installer and docs", () => {
  const read = (p: string) => fs.readFileSync(path.resolve(p), "utf8");
  test("the timer fires every 5 minutes; the service is a oneshot that runs the probe and appends to its log", () => {
    const timer = read("deploy/systemd/mct-burnticker-web-probe.timer");
    assert.match(timer, /^OnUnitActiveSec=5min$/m); assert.match(timer, /^Unit=mct-burnticker-web-probe\.service$/m); assert.match(timer, /WantedBy=timers\.target/);
    const svc = read("deploy/systemd/mct-burnticker-web-probe.service");
    assert.match(svc, /^Type=oneshot$/m);
    assert.match(svc, /^ExecStart=\/bin\/sh %h\/meme-coin-trader\/scripts\/service\/burnticker-web-probe\.sh$/m);
    assert.match(svc, /append:%h\/meme-coin-trader\/logs\/burnticker-web-probe\.log/);
  });
  test("the installer copies both units and enables and starts the timer", () => {
    const inst = read("scripts/ops/install-burnticker-units.sh");
    const units = /^UNITS="([^"]+)"/m.exec(inst)?.[1].split(" ") ?? [];
    const timers = /^TIMERS="([^"]+)"/m.exec(inst)?.[1].split(" ") ?? [];
    assert.ok(units.includes("mct-burnticker-web-probe.service") && units.includes("mct-burnticker-web-probe.timer"));
    assert.ok(timers.includes("mct-burnticker-web-probe.timer"));
  });
  test("the runbook has the External web check section and the owner's to-do has the row", () => {
    const rb = read("docs/burnticker/runbook.md");
    assert.match(rb, /^## External web check$/m);
    for (const s of ["Burnticker web", "BURNTICKER_WEB_HEARTBEAT_URL", "10 minutes", "install-burnticker-units.sh"]) assert.ok(rb.includes(s), s);
    assert.match(read("docs/burnticker/TODO-OWNER.md"), /BURNTICKER_WEB_HEARTBEAT_URL/);
  });
  // (private network names are the public leak scan's job: scripts/ops/publish-public-repo.sh --check)
  test("public gate: the probe is on the allowlist, and neither it nor its units name an address", () => {
    assert.match(read("config/public-repo.allowlist"), /^scripts\/service\/burnticker-web-probe\.sh$/m);
    for (const f of ["scripts/service/burnticker-web-probe.sh", "deploy/systemd/mct-burnticker-web-probe.service", "deploy/systemd/mct-burnticker-web-probe.timer"]) {
      const t = read(f);
      assert.ok(!/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/.test(t), `${f} names an IP address`);
    }
  });
});
