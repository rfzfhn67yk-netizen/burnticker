// THE SOURCE-OUTAGE DRILL (trust-ops item 6, 2026-10-10 night; monthly, runbook "Monthly drills"). Runs the keeper's planning pass in a
// SCRATCH registry against a wrapped copy of one source and asserts what the runbook promises when a source fails: the reading is withheld,
// an alert is raised, the status page shows it, and no crank is planned — after a control run proves the same coin cranks on a healthy
// source. Touches no real registry, no network, no key; the FakeBurnProgram stands in for the chain (src/lib/burnticker/ops/drill.ts).
//
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/alias-hook.mjs scripts/burnticker-drill.mts --feed <id> --mode down|disagree|stale [--json] [--keep]
//
//   --feed     a catalogue feed with a fixed unit (day or month periods): treasury.debt, bls.eggs, fred.UNRATE, noaa.flares, …
//   --mode     down (every read fails) · disagree (the cross-read disagrees on every new reading) · stale (nothing new for longer than the cadence allows)
//   --all      every mode in turn for the feed
//   --keep     print the scratch directory (registry + status.json) instead of deleting it
// Exit 0 = every check passed; 1 = a check failed (that is an incident: INCIDENTS.md); 2 = usage.
import fs from "node:fs";
import { runDrill, type DrillMode } from "../src/lib/burnticker/ops/drill.ts";

const args = process.argv.slice(2);
const opt = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : undefined; };
const flag = (n: string) => args.includes(`--${n}`);
const feed = opt("feed"), mode = opt("mode");
const modes: DrillMode[] = flag("all") ? ["down", "disagree", "stale"] : mode === "down" || mode === "disagree" || mode === "stale" ? [mode] : [];
if (!feed || !modes.length) { console.error(fs.readFileSync(new URL(import.meta.url)).toString().split("\n").filter((l) => l.startsWith("//")).map((l) => l.slice(3)).join("\n")); process.exit(2); }

let allOk = true;
const out = [];
for (const m of modes) {
  let r;
  try { r = await runDrill({ feed, mode: m }); } catch (e) { console.error(`drill: ${(e as Error).message}`); process.exit(2); }
  allOk &&= r.ok;
  out.push(r);
  if (!flag("json")) {
    console.log(`${r.ok ? "DRILL PASSED" : "DRILL FAILED"} — ${r.feed} · mode ${r.mode} · ${r.selectorKey} · ${r.ranAt}`);
    for (const c of r.checks) console.log(`  ${c.ok ? "✓" : "✗"} ${c.id.padEnd(9)} ${c.detail}`);
    if (flag("keep")) console.log(`  scratch: ${r.scratch.db} · ${r.scratch.site}/status/status.json`);
  }
  if (!flag("keep")) fs.rmSync(r.scratch.db.replace(/\/drill\.db$/, ""), { recursive: true, force: true });
}
if (flag("json")) console.log(JSON.stringify(out.length === 1 ? out[0] : out, null, 2));
process.exit(allOk ? 0 : 1);
