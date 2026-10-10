#!/usr/bin/env node
// Builds the publishable @burnticker/sdk (2026-10-09). The package's source imports the platform's own modules through the repo's
// "@/…" alias (so the SDK can never drift from what the platform runs). This script:
//   1. stages the import closure (scripts/closure.mjs) into packages/burnticker-sdk/build/: the SDK's files under build/sdk/, the
//      platform modules under build/lib/, every local specifier rewritten to a relative path WITH its .ts extension;
//   2. compiles build/ with tsc to packages/burnticker-sdk/dist/ (ESM + .d.ts; .ts extensions rewritten to .js).
// The staged tree contains only closure files — the same list as public-closure.json, which the leak test keeps private-free.
//
//   node packages/burnticker-sdk/scripts/build.mjs            stage + compile
//   node packages/burnticker-sdk/scripts/build.mjs --stage    stage only
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { PKG, REPO, closure, resolve, specifiers } from "./closure.mjs";

const SDK_SRC = path.join(PKG, "src");

/** Where a closure file lands in the staged tree. */
export function stagedPath(abs, out) {
  if (abs.startsWith(SDK_SRC + path.sep)) return path.join(out, "sdk", path.relative(SDK_SRC, abs));
  if (abs.startsWith(path.join(PKG, "examples") + path.sep)) return path.join(out, "examples", path.relative(path.join(PKG, "examples"), abs));
  const lib = path.join(REPO, "src", "lib") + path.sep;
  if (abs.startsWith(lib)) return path.join(out, "lib", path.relative(lib, abs));
  throw new Error(`closure file outside the package and src/lib: ${path.relative(REPO, abs)}`);
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Copies the closure into `out` with every local specifier rewritten to a relative, extension-ful path. Returns the staged files. */
export function stage(out = path.join(PKG, "build"), o = { examples: false }) {
  fs.rmSync(out, { recursive: true, force: true });
  const starts = [path.join(SDK_SRC, "index.ts")];
  const c = closure(starts);
  const written = [];
  for (const relFile of c.files) {
    const abs = path.join(REPO, relFile);
    const dest = stagedPath(abs, out);
    let src = fs.readFileSync(abs, "utf8");
    for (const spec of new Set(specifiers(src))) {
      const r = resolve(spec, abs);
      if (!r.file) continue;
      let to = path.relative(path.dirname(dest), stagedPath(r.file, out)).split(path.sep).join("/");
      if (!to.startsWith(".")) to = `./${to}`;
      src = src.replace(new RegExp(`(["'])${escape(spec)}\\1`, "g"), `"${to}"`);
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, src);
    written.push(dest);
  }
  void o;
  fs.writeFileSync(path.join(out, "tsconfig.json"), `${JSON.stringify({
    compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", rewriteRelativeImportExtensions: true, declaration: true, outDir: "../dist", rootDir: ".", strict: true, skipLibCheck: true, esModuleInterop: true, resolveJsonModule: true, lib: ["ES2022", "DOM"], types: ["node"], typeRoots: [path.join(REPO, "node_modules", "@types")] },
    include: ["sdk/**/*.ts", "lib/**/*.ts"],
  }, null, 2)}\n`);
  return written;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const files = stage();
  console.log(`staged ${files.length} files into ${path.relative(REPO, path.join(PKG, "build"))}`);
  if (!process.argv.includes("--stage")) {
    // Resolve npm packages (web3.js, bn.js, the Raydium SDK) from the repository's node_modules while building in-tree.
    const nm = path.join(PKG, "build", "node_modules");
    if (!fs.existsSync(nm)) fs.symlinkSync(path.join(REPO, "node_modules"), nm, "dir");
    execFileSync(path.join(REPO, "node_modules", ".bin", "tsc"), ["-p", path.join(PKG, "build", "tsconfig.json")], { stdio: "inherit" });
    console.log(`compiled to ${path.relative(REPO, path.join(PKG, "dist"))}`);
  }
}
