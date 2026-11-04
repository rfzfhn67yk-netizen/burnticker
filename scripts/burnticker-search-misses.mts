// THE WEEKLY SEARCH-MISS ROLLUP (2026-10-10): what people searched for on the launch page and did not find (no card, or cards but no
// "Use this"), and how long launching took per wizard step — as markdown, from the registry's own SQLite file (productStore.ts).
// Anonymous by construction: no IP, no id, no wallet; queries folded to plain words; UTC hour buckets; timings kept as durations.
//
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/alias-hook.mjs scripts/burnticker-search-misses.mts [--days 7] [--out file.md]
//
// Reads BURNTICKER_DB (default data/burnticker.db). Writes nothing to the database.
import fs from "node:fs";
import { openRegistry, REGISTRY_FILE } from "../src/lib/burnticker/registry.ts";
import { productStore } from "../src/lib/burnticker/productStore.ts";
import { rollupMarkdown } from "../src/lib/burnticker/productRollup.ts";

const args = process.argv.slice(2);
const opt = (k: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
const days = Math.max(1, Math.min(90, Number(opt("days") ?? 7) || 7));
const registry = openRegistry((process.env.BURNTICKER_DB ?? "").trim() || REGISTRY_FILE);
const st = productStore(registry.db);
const now = Date.now();
const md = rollupMarkdown(st.missSummary(now - days * 86_400_000, 40), st.timingSummary(now - days * 86_400_000), { days, now });
const out = opt("out");
if (out) { fs.writeFileSync(out, md); console.error(`wrote ${out}`); } else console.log(md);
