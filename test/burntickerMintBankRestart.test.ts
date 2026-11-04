// 2026-10-16 prelaunch audit F-8: the mint bank ignored every deploy from 10-15 02:54Z until it was restarted by hand. The process then
// running predated the deploy-restart check (added 10-15 22:45Z), so nothing in it could see the request; and in the code since, the
// request was checked only at the top of the loop: once a minute while the bank is full, but only between fill chunks while it fills,
// and a 25-key chunk takes about half an hour on the box. The loop now lives in mintBankLoop.ts: while full it checks the request every
// few seconds, a fill chunk stops as soon as a request is waiting, and a request already on disk at start is removed as stale.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeRestartRequest } from "@/lib/burnticker/restartRequest";

function world(o: { need: () => number; grindMsPerKey?: number }) {
  let t = 0;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bt-bank-loop-"));
  const at: { ms: number; fn: () => void }[] = [];
  const logs: string[] = [];
  let ground = 0;
  const sleep = async (ms: number) => { const end = t + ms; for (const x of at.filter((a) => a.ms > t && a.ms <= end).sort((a, b) => a.ms - b.ms)) { t = x.ms; x.fn(); } t = end; };
  return {
    root, logs, now: () => t, at: (ms: number, fn: () => void) => at.push({ ms, fn }), ground: () => ground,
    deps: {
      root, now: () => t, sleep, log: (s: string) => logs.push(s), stopping: () => false, startedAt: 0,
      housekeeping: () => ({ need: o.need(), filling: o.need() > 0 }),
      grind: async (n: number, stopWhen: () => boolean) => { for (let i = 0; i < n; i++) { for (let s = 0; s < (o.grindMsPerKey ?? 80_000); s += 1_000) { if (stopWhen()) return; await sleep(1_000); } ground++; } },
    },
  };
}

describe("the mint bank honours a deploy's restart request (F-8)", () => {
  test("a full bank: a request written while it idles is taken within a few seconds", async () => {
    const { runBankLoop, IDLE_CHECK_MS } = await import("@/lib/burnticker/mintBankLoop");
    const w = world({ need: () => 0 });
    w.at(3 * 60_000 + 10_000, () => writeRestartRequest("mintbank", "BUILD2", { root: w.root, now: 1 }));
    const r = await runBankLoop({ ...w.deps, maxMs: 30 * 60_000 });
    assert.equal(r.reason, "restart");
    assert.equal(r.build, "BUILD2");
    assert.ok(w.now() - (3 * 60_000 + 10_000) <= IDLE_CHECK_MS, `taken ${w.now() - 190_000} ms after it was written`);
    assert.ok(!fs.existsSync(path.join(w.root, "data", "restart-requested.mintbank")), "consumed");
  });

  test("a filling bank: the chunk in progress stops for a waiting request instead of finishing its 25 keys", async () => {
    const { runBankLoop } = await import("@/lib/burnticker/mintBankLoop");
    const w = world({ need: () => 100, grindMsPerKey: 80_000 });
    w.at(5 * 60_000, () => writeRestartRequest("mintbank", "BUILD3", { root: w.root, now: 1 }));
    const r = await runBankLoop({ ...w.deps, maxMs: 2 * 3_600_000 });
    assert.equal(r.reason, "restart");
    assert.ok(w.now() < 5 * 60_000 + 10_000, `the restart waited until ${Math.round(w.now() / 1000)} s`);
    assert.ok(w.ground() < 25);
  });

  test("a request already on disk at start is stale: removed, said, and not honoured", async () => {
    const { runBankLoop } = await import("@/lib/burnticker/mintBankLoop");
    const w = world({ need: () => 0 });
    writeRestartRequest("mintbank", "OLD", { root: w.root, now: 1 });
    const r = await runBankLoop({ ...w.deps, maxMs: 5 * 60_000 });
    assert.equal(r.reason, "time");
    assert.ok(w.logs.some((l) => /stale restart request \(build OLD\) removed/.test(l)));
  });

  test("a request file that cannot be taken never spins the loop: the bank keeps filling and idling (F-8 review 9)", async () => {
    const { runBankLoop } = await import("@/lib/burnticker/mintBankLoop");
    const w = world({ need: () => (w.ground() < 3 ? 3 - w.ground() : 0), grindMsPerKey: 10_000 });
    // a path that exists but is not a readable request (a directory): take() answers null every time
    fs.mkdirSync(path.join(w.root, "data", "restart-requested.mintbank"), { recursive: true });
    let passes = 0;
    const hk = w.deps.housekeeping;
    const r = await Promise.race([runBankLoop({ ...w.deps, startedAt: Date.now(), housekeeping: () => { passes++; return hk(); }, maxMs: 10 * 60_000 }), new Promise<"spun">((res) => { setTimeout(() => res("spun"), 3_000).unref(); })]);
    assert.notEqual(r, "spun", "the loop spun without letting time pass");
    assert.equal(w.ground(), 3, "the fill went on");
    assert.ok(passes < 200, `${passes} housekeeping passes in ten minutes`);
  });

  test("the service script runs this loop", () => {
    const src = fs.readFileSync("scripts/burnticker-mint-bank.mts", "utf8");
    assert.match(src, /runBankLoop\(/);
  });
});
