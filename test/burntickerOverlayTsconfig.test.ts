// THE PUBLIC TREE'S tsconfig.json IS ALREADY WHAT `next build` WRITES (2026-10-18 prelaunch audit A-32). The deploy builds the public
// checkout with NEXT_DIST_DIR=.next-burnticker; Next then adds that directory's two type globs to tsconfig.json and rewrites the file in
// its own layout, so every deploy left a "tsconfig drift" in the public checkout (and rollback-burnticker.sh had to put the file back).
// The overlay now carries both lines in Next's layout, so a build leaves the file as it found it.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

test("the overlay tsconfig.json includes the .next-burnticker type globs and is in the layout Next writes (no drift after a build)", () => {
  const raw = fs.readFileSync(path.join(ROOT, "config/public-repo/overlay/tsconfig.json"), "utf8");
  const j = JSON.parse(raw) as { include: string[] };
  for (const g of [".next/types/**/*.ts", ".next/dev/types/**/*.ts", ".next-burnticker/types/**/*.ts", ".next-burnticker/dev/types/**/*.ts"]) assert.ok(j.include.includes(g), g);
  assert.equal(raw, `${JSON.stringify(j, null, 2)}\n`, "Next rewrites the file as two-space JSON with a final newline; anything else shows as a change after every build");
  // the monorepo's own tsconfig carries the same two globs (the deploy builds there too)
  const mono = JSON.parse(fs.existsSync(path.join(ROOT, "tsconfig.json")) ? fs.readFileSync(path.join(ROOT, "tsconfig.json"), "utf8") : "{}") as { include?: string[] };
  for (const g of [".next-burnticker/types/**/*.ts", ".next-burnticker/dev/types/**/*.ts"]) assert.ok(mono.include?.includes(g), `tsconfig.json: ${g}`);
});
