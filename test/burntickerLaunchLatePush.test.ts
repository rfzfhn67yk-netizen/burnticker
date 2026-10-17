// Block G review M3: the bt-launch-late alert (prelaunch audit 2026-10-16 F-3) reaches the phone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PUSH_KIND_OF_ALERT, PUSH_LEAD, PUSH_TITLE, planPushes } from "@/lib/burnticker/push";
import { LATE_ALERT_KIND, alertLaunchLate } from "@/lib/burnticker/draftReconciler";
import { openRegistry } from "@/lib/burnticker/registry";
import { lintCopy } from "@/lib/launch/copyLint";

test("bt-launch-late maps to a push kind with its own title and lead, and a recorded alert is planned as a push", () => {
  const kind = PUSH_KIND_OF_ALERT[LATE_ALERT_KIND];
  assert.equal(kind, "launch-late");
  assert.ok(PUSH_TITLE[kind] && PUSH_LEAD[kind]);
  assert.deepEqual(lintCopy(PUSH_LEAD[kind]).hits, []);
  const reg = openRegistry(":memory:");
  const now = Date.parse("2026-10-16T18:00:00Z");
  alertLaunchLate(reg, { mint: "Mint1111111111111111111111111111111111111111", ticker: "LATE" }, "9".repeat(88), now - 3_600_000, now - 60_000);
  const plan = planPushes({ now, alerts: reg.alertsSince(0), state: null });
  assert.ok(plan.messages.some((m) => m.kind === "launch-late" && /burnticker-draft-revive\.mts/.test(m.body)), JSON.stringify(plan.messages));
});
