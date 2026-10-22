// AN ALERT WHEN SOMEONE'S LAUNCH FAILS (owner, launch night 2026-10-13).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { LAUNCH_FAIL_ALERT_KIND, launchFailureOf, withLaunchFailureAlert } from "@/lib/burnticker/api/launchFailAlert";
import { fail, ok } from "@/lib/burnticker/api/http";
import { PUSH_KIND_OF_ALERT, PUSH_LEAD, PUSH_TITLE } from "@/lib/burnticker/push";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";

const NOW = Date.parse("2026-10-14T01:30:00Z");
const body = { ticker: "KCNFLWIN", creator: "Cre4t0r", rule: { oracle: "catalogue", series: "espn.team:nfl-KC.12-win-s2026" } };

describe("the launch-failed alert", () => {
  test("a 5xx, an internal error, a pin failure and a launch-check refusal are alerts; ordinary 4xx refusals are not", () => {
    const pre = launchFailureOf("buildLaunchBundle", body, fail(502, "The check run before launch refused this coin: only one operator can read this game", { code: "preflight" }), NOW)!;
    assert.equal(pre.kind, LAUNCH_FAIL_ALERT_KIND);
    assert.equal(pre.key, "buildLaunchBundle:preflight:KCNFLWIN:espn.team:nfl-KC.12-win-s2026:2026-10-14T01");
    assert.match(pre.text, /^A launch request failed on the site: buildLaunchBundle for \$KCNFLWIN \(espn\.team:nfl-KC\.12-win-s2026\) answered 502 preflight: The check run before launch refused/);
    assert.deepEqual(pre.meta, { operationId: "buildLaunchBundle", status: 502, code: "preflight", ticker: "KCNFLWIN", selector: "espn.team:nfl-KC.12-win-s2026", creator: "Cre4t0r" });
    assert.ok(launchFailureOf("reviewLaunch", body, fail(500, "Something went wrong on the server.", { code: "internal" }), NOW));
    assert.ok(launchFailureOf("buildLaunchBundle", body, fail(502, "pin", { code: "pin-failed" }), NOW));
    assert.ok(launchFailureOf("buildLaunchBundle", null, fail(503, "down"), NOW), "no body still alerts");
    assert.equal(launchFailureOf("buildLaunchBundle", body, fail(400, "A mint is required."), NOW), null);
    assert.equal(launchFailureOf("buildLaunchBundle", body, fail(409, "season over", { code: "season-over" }), NOW), null);
    assert.equal(launchFailureOf("buildLaunchBundle", body, ok({}), NOW), null);
  });
  test("the wrapper records through the registry only on an alert, reads the body from a clone, and never breaks the answer", async () => {
    const rows: { kind: string; key: string }[] = [];
    const reg = { recordAlert: (a: { kind: string; key: string }) => { rows.push(a); return a; } };
    const mk = () => new Request("https://burnticker.com/api/burnticker/v1/launch/bundle", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const req = mk();
    const r = await withLaunchFailureAlert(reg, "buildLaunchBundle", req, async () => { await req.json(); return fail(502, "refused", { code: "preflight" }); })();
    assert.equal(r.status, 502); assert.equal(rows.length, 1); assert.match(rows[0].key, /^buildLaunchBundle:preflight:KCNFLWIN:/);
    const fine = await withLaunchFailureAlert(reg, "buildLaunchBundle", mk(), async () => ok({ ok: true }))();
    assert.equal(fine.status, 200); assert.equal(rows.length, 1);
    const throwing = { recordAlert: () => { throw new Error("db closed"); } };
    const still = await withLaunchFailureAlert(throwing, "reviewLaunch", mk(), async () => fail(500, "x", { code: "internal" }))();
    assert.equal(still.status, 500);
  });
  test("the phone push knows the kind, with a plain title and lead", () => {
    assert.equal(PUSH_KIND_OF_ALERT[LAUNCH_FAIL_ALERT_KIND], "launch-failed");
    assert.equal(PUSH_TITLE["launch-failed"], "Burnticker launch failed");
    const cfg = loadCopyLintConfig();
    for (const t of [PUSH_TITLE["launch-failed"], PUSH_LEAD["launch-failed"]]) assert.ok(lintCopy(t, cfg).ok, t);
  });
});
