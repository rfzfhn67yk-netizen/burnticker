// CREATOR LAUNCHES HOST FLAG (2026-10-11, LAUNCHPAD-PATH §45): BURNTICKER_CREATOR_LAUNCHES_ENABLED, default OFF. Off, every creator launch
// route refuses with one plain sentence and the catalogue says launches.creators: false; the operator's coins launch through the CLI,
// which never touches these routes. The test hook sets the flag on for the rest of the suite; these tests set and clear it themselves.
import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { CREATOR_LAUNCHES_CLOSED, CREATOR_LAUNCHES_FLAG, creatorLaunchRefusal, creatorLaunchesEnabled } from "@/lib/burnticker/creatorLaunches";
import { v1Catalogue } from "@/lib/burnticker/api/v1";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";

const ROOT = path.resolve(import.meta.dirname, "..");
const saved = process.env[CREATOR_LAUNCHES_FLAG];
afterEach(() => { if (saved === undefined) delete process.env[CREATOR_LAUNCHES_FLAG]; else process.env[CREATOR_LAUNCHES_FLAG] = saved; });
const post = (url: string, body: unknown) => new Request(url, { method: "POST", headers: { "content-type": "application/json", origin: new URL(url).origin, host: new URL(url).host }, body: JSON.stringify(body) });

describe("creator launches flag", () => {
  test("default OFF: unset, empty and 'false' are off; 1 / true / yes / on are on", () => {
    for (const v of [undefined, "", "0", "false", "no", "off"]) assert.equal(creatorLaunchesEnabled({ [CREATOR_LAUNCHES_FLAG]: v }), false, String(v));
    for (const v of ["1", "true", "YES", " on "]) assert.equal(creatorLaunchesEnabled({ [CREATOR_LAUNCHES_FLAG]: v }), true, v);
    assert.deepEqual(creatorLaunchRefusal({}), { status: 403, body: { error: CREATOR_LAUNCHES_CLOSED, code: "creator-launches-closed" } });
    assert.equal(creatorLaunchRefusal({ [CREATOR_LAUNCHES_FLAG]: "1" }), null);
  });

  test("the sentence is a plain fact: exact words, lint-clean, no 'coming soon'", () => {
    assert.equal(CREATOR_LAUNCHES_CLOSED, "Creator launches are not open yet. $DEFICIT is the first coin.");
    assert.deepEqual(lintCopy(CREATOR_LAUNCHES_CLOSED, loadCopyLintConfig()).hits, []);
    assert.doesNotMatch(CREATOR_LAUNCHES_CLOSED, /coming soon|soon/i);
  });

  test("off: POST /api/burnticker/launch, /v1/launch/bundle and /v1/launch/confirm refuse with 403 and the sentence, before anything is read", async () => {
    delete process.env[CREATOR_LAUNCHES_FLAG];
    const app = await import("../src/app/api/burnticker/launch/route.ts");
    const bundle = await import("../src/app/api/burnticker/v1/launch/bundle/route.ts");
    const confirm = await import("../src/app/api/burnticker/v1/launch/confirm/route.ts");
    for (const [h, url] of [[app.POST, "http://localhost:3000/api/burnticker/launch"], [bundle.POST, "http://localhost:3000/api/burnticker/v1/launch/bundle"], [confirm.POST, "http://localhost:3000/api/burnticker/v1/launch/confirm"]] as const) {
      const r = await h(post(url, { ticker: "X" }));
      assert.equal(r.status, 403, url);
      const j = await r.json() as { error: string; code: string };
      assert.equal(j.error, CREATOR_LAUNCHES_CLOSED, url); assert.equal(j.code, "creator-launches-closed", url);
    }
  });

  test("the catalogue says launches.creators (both the app's and /v1)", async () => {
    delete process.env[CREATOR_LAUNCHES_FLAG];
    const off = v1Catalogue(Date.now(), {}).body as { launches: { creators: boolean; note: string } };
    assert.deepEqual(off.launches, { creators: false, note: CREATOR_LAUNCHES_CLOSED });
    assert.equal((v1Catalogue(Date.now(), { [CREATOR_LAUNCHES_FLAG]: "1" }).body as { launches: { creators: boolean } }).launches.creators, true);
    const cat = await import("../src/app/api/burnticker/catalogue/route.ts");
    assert.equal(((await (await cat.GET()).json()) as { launches: { creators: boolean } }).launches.creators, false);
  });

  test("the launch page renders the sentence instead of the wizard when the catalogue says creators: false; the operator path is the CLI (runbook, deploy.md)", () => {
    const page = fs.readFileSync(path.join(ROOT, "src/app/burnticker/launch/page.tsx"), "utf8");
    // website brief 2026-10-11 §1: the gate resolves before the wizard (launchGateState.ts; closed unless creators === true, a skeleton
    // while loading) and the closed page is LaunchGate.tsx, which carries the sentence
    assert.match(page, /launchGateFromCatalogue\(j\)/); assert.match(page, /if \(!wizardMayRender\(gate\)\) return <LaunchGate /);
    assert.match(fs.readFileSync(path.join(ROOT, "src/lib/burnticker/launchGateState.ts"), "utf8"), /launches\?\.creators === true \? \{ kind: "open"/);
    assert.match(fs.readFileSync(path.join(ROOT, "src/app/burnticker/launch/LaunchGate.tsx"), "utf8"), /\{CREATOR_LAUNCHES_CLOSED\}/);
    for (const f of ["docs/burnticker/deploy.md", "docs/burnticker/runbook.md"]) assert.match(fs.readFileSync(path.join(ROOT, f), "utf8"), /BURNTICKER_CREATOR_LAUNCHES_ENABLED/, f);
  });
});
