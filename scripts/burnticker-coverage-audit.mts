// THE SETTLEMENT-COVERAGE AUDIT (2026-10-10; owner decision: Kalshi is not a settlement input). For every category of
// config/burnticker/categories.json and every selector kind the wizard can emit: the primary sources, their independent cross-reads,
// the 90-day dry run (hit rate, latency, disagreement) and the verdict — settleable / adjudicated-only (Polymarket) / uncovered.
// Prints the matrix; EXITS NON-ZERO when a category of the taxonomy is uncovered (with --require-primary: also when one has no
// primary source at all). Reads no key and sends nothing.
//
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/alias-hook.mjs scripts/burnticker-coverage-audit.mts \
//     [--offline (default) | --live] [--write] [--json] [--require-primary] [--window <days>] [--registry] [--categories <file>]
//
//   --offline   frozen fixtures only (config/burnticker/fixtures), no network; the CI gate's mode
//   --live      one polite fetch per source (serial, spaced, cached per run) and a Gamma lookup per Polymarket tag
//   --write     regenerate docs/burnticker/SETTLEMENT-COVERAGE.md from the matrix
//   --registry  latency from this host's data/burnticker.db first sightings (default with --live; offline stays fixture-only so the
//               committed document reproduces anywhere)
//   --categories <file>  audit a candidate taxonomy instead of config/burnticker/categories.json (same schema)
import fs from "node:fs";
import path from "node:path";
import { buildCoverage, coverageExitCode, renderCoverageMarkdown } from "../src/lib/burnticker/coverage/index.ts";
import { leagueCoverage } from "../src/lib/burnticker/coverage/leagues.ts";
import { loadSourceEntries } from "../src/lib/burnticker/catalogue/index.ts";
import { parseCategories } from "../src/lib/burnticker/browse.ts";
import { openRegistry, REGISTRY_FILE } from "../src/lib/burnticker/registry.ts";
import { polymarketClient } from "../src/lib/burnticker/server.ts";

const args = process.argv.slice(2);
const live = args.includes("--live");
const windowArg = args.indexOf("--window");
const windowDays = windowArg >= 0 ? Math.max(7, Math.min(365, Number(args[windowArg + 1]) || 90)) : 90;
const DOC = path.join("docs", "burnticker", "SETTLEMENT-COVERAGE.md");

// First sightings for latency: the registry's readings table, when this host has one (read-only use; never created here).
const dbFile = process.env.BURNTICKER_DB?.trim() || REGISTRY_FILE;
const registry = (live || args.includes("--registry")) && fs.existsSync(dbFile) ? openRegistry(dbFile) : null;
const catArg = args.indexOf("--categories");
const categories = catArg >= 0 ? parseCategories(JSON.parse(fs.readFileSync(args[catArg + 1], "utf8"))) : undefined;
const observations = registry ? (id: string) => registry.readings(`catalogue:${id}`).map((r) => ({ id: r.id, firstSeenAt: r.fetchedAt })) : undefined;
const pm = live ? polymarketClient() : null;

const { matrix } = await buildCoverage({ mode: live ? "live" : "offline", windowDays, observations, categories, polymarketTag: pm ? (slug) => pm.tag(slug) : null });
registry?.close();

if (args.includes("--json")) console.log(JSON.stringify(matrix, null, 2));
else {
  console.log(`settlement coverage (${matrix.mode}, ${matrix.generatedAt.slice(0, 10)}): ${matrix.summary.settleable} settleable · ${matrix.summary.adjudicatedOnly} adjudicated-only · ${matrix.summary.uncovered} uncovered · without a primary: ${matrix.summary.withoutPrimary.join(", ") || "none"}`);
  for (const c of matrix.categories) {
    console.log(`\n${c.label} [${c.id}] — ${c.verdict.toUpperCase()}`);
    console.log(`  primaries: ${c.primaries.map((p) => `${p.id} (${p.operator})`).join(", ") || "none"}`);
    console.log(`  cross-reads: ${c.crossReads.map((x) => `${x.id} of ${x.of} (${x.operator})`).join(", ") || "none"}`);
    console.log(`  polymarket: ${c.polymarket.tags.join(", ") || "none"}${c.kalshiDiscoveryOnly.length ? ` · kalshi (discovery only): ${c.kalshiDiscoveryOnly.join(", ")}` : ""}`);
    for (const k of c.kinds) console.log(`  ${k.kind.padEnd(15)} ${k.verdict.padEnd(17)} ${k.why}`);
    for (const p of [...c.primaries, ...c.crossReads]) {
      const d = p.dryRun;
      if (d) console.log(`    · ${p.id}: hit ${d.hitRate === null ? "n/a" : `${(d.hitRate * 100).toFixed(1)}% (${d.hits}/${d.expected})`} · latency ${d.latency.medianHours === null ? "n/a" : `${d.latency.medianHours} h`} · disagreement ${d.crossRead.disagreementRate === null ? "n/a" : `${(d.crossRead.disagreementRate * 100).toFixed(1)}% (${d.crossRead.compared} compared vs ${d.crossRead.id})`}${d.error ? ` · error: ${d.error}` : ""}`);
    }
  }
  if (matrix.uncovered.length) { console.log("\nuncovered (category / kind):"); for (const u of matrix.uncovered) console.log(`  ${u.category} / ${u.kind}: ${u.why}`); }
}
const leagues = leagueCoverage(loadSourceEntries());
if (!args.includes("--json")) { console.log("\nper league (team coins and matchups):"); for (const l of leagues) console.log(`  ${l.label.padEnd(26)} ${l.sport.padEnd(10)} ${String(l.teams).padStart(4)} teams · schedule ${l.schedule.id}${l.schedule.needsKey ? " (key)" : ""} · with a market: ${l.withMarket} · without: ${l.withoutMarket} · ${l.verdict}`); }
if (args.includes("--write")) { fs.writeFileSync(DOC, renderCoverageMarkdown(matrix, leagues)); console.log(`\nwrote ${DOC}`); }
process.exit(coverageExitCode(matrix, { requirePrimary: args.includes("--require-primary") }));
