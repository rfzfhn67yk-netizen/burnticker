#!/usr/bin/env node
// THE PUBLIC-REPO CARVE-OUT, the working part (2026-10-09). scripts/ops/publish-public-repo.sh is the entry point; this file does
// the listing, the two checks, the copy, the generated package.json, the tag and the standalone verification. Nothing here reads
// a secret, touches git remotes, or creates a repository anywhere.
//
//   node scripts/ops/public-repo-lib.mjs check   [--allowlist F] [--denypatterns F] [--overlay D]
//   node scripts/ops/public-repo-lib.mjs publish [--out D] [--tag] [--verify] [--link-node-modules] [--no-lockfile] [...same]
//
// THE TWO GATES. (1) The allowlist: `git ls-files -- <pathspecs>` — tracked files only, at the same paths. (2) The checks on the
// files that would be copied: every local import (./, ../, @/) of every .ts/.tsx/.mts/.mjs/.js file must resolve to a file in the
// same set (so no private module is dragged along, and the public tree type-checks on its own); every external package must be
// declared in the monorepo's package.json (so the generated package.json is complete); and every text file is scanned against
// config/public-repo.denypatterns. One failure of any kind and nothing is written.
//
// THE PROVENANCE GATE (N5, 2026-10-10). Before any of that, and before any file is read: every source must be a regular file reached
// through real directories (no symlink at the path or above it) whose realpath stays inside its root (the repo for tracked files,
// the overlay directory for overlay files). Re-proved at copy time (O_NOFOLLOW), and the staged output is rescanned afterwards (no
// symlink, nothing outside the manifest, deny scan on the staged bytes). A refusal names the path and fails the run.
//
// THE OVERLAY. config/public-repo/overlay/** is copied on top at the same relative paths: the public README, LICENSE, SECURITY.md,
// tsconfig, the test alias hook, the Next root layout — files that exist only for the public tree. They go through the same scan.
//
// THE CHANGELOG. docs/burnticker/CHANGELOG.md (monorepo) is the source of truth; it is copied to the public tree's root as
// CHANGELOG.md as well. `--tag` appends one entry to the monorepo file first (date, monorepo commit, program hash when a built .so
// exists on this host, IDL sha256, allowlist sha256, file count), so the trust page and the public root carry the same entry.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

const here = path.dirname(new URL(import.meta.url).pathname);
const args = process.argv.slice(2);
const cmd = args[0];
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : dflt; };
const flag = (name) => args.includes(`--${name}`);
// --root D: run against another checkout (the regression tests point it at a throwaway git repo). Default: this monorepo.
const REPO = path.resolve(opt("root", path.resolve(here, "..", "..")));

const ALLOWLIST = path.resolve(REPO, opt("allowlist", "config/public-repo.allowlist"));
const DENYPATTERNS = path.resolve(REPO, opt("denypatterns", "config/public-repo.denypatterns"));
const OVERLAY = path.resolve(REPO, opt("overlay", "config/public-repo/overlay"));
const OUT = path.resolve(REPO, opt("out", "../burnticker-public"));
const CHANGELOG_SRC = "docs/burnticker/CHANGELOG.md";
const CHANGELOG_PUBLIC_ROOT = "CHANGELOG.md";
const CODE_EXT = new Set([".ts", ".tsx", ".mts", ".mjs", ".js", ".cjs"]);
const BINARY_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".ico", ".so", ".woff", ".woff2", ".ttf", ".otf", ".pdf", ".zip", ".wasm"]);
const NEVER_SCANNED = new Set([path.relative(REPO, ALLOWLIST), path.relative(REPO, DENYPATTERNS)]);

const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const rel = (p) => path.relative(REPO, p).split(path.sep).join("/");
const git = (...a) => execFileSync("git", a, { cwd: REPO, encoding: "utf8" });

// ---------------------------------------------------------------------------------------------------------------------------------
// 1. listing
// ---------------------------------------------------------------------------------------------------------------------------------
function readAllowlist() {
  const lines = fs.readFileSync(ALLOWLIST, "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  return lines;
}

/** Tracked files per pathspec (so a line that matches nothing can be reported). Returns [{ spec, files }]. */
function listTracked(specs) {
  return specs.map((spec) => {
    const out = execFileSync("git", ["ls-files", "-z", "--", spec], { cwd: REPO, encoding: "utf8" });
    // deleted-but-staged files are not copied; lstat (not existsSync) so a dangling symlink is still listed — and then refused
    const files = out.split("\0").filter(Boolean).filter((f) => fs.existsSync(path.join(REPO, f)) || isLink(path.join(REPO, f)));
    return { spec, files };
  });
}

/**
 * Every entry under `dir` (relative, "/"-separated). A symlink — to a file or a directory — is never followed: it is reported in
 * `links` (relative path) so the caller can refuse it, and anything that is neither a regular file nor a directory lands in `odd`.
 */
function walk(dir, base = dir, acc = [], links = [], odd = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    const r = path.relative(base, p).split(path.sep).join("/");
    if (e.isSymbolicLink()) links.push(r);
    else if (e.isDirectory()) walk(p, base, acc, links, odd);
    else if (e.isFile()) acc.push(r);
    else odd.push(r);
  }
  return acc;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// 1b. provenance (N5, the ChatGPT/Codex review 2026-10-10): an allowlisted PATHNAME proves nothing about the bytes behind it. A
// symlink at an allowlisted path — or a symlinked directory above it — would publish its target (and a .png name skips the text
// scan). So every source must be a regular file reached through real directories only, and its realpath must stay inside the
// approved root: the repo root for tracked (and derived) files, the overlay directory for overlay files. Any failure REFUSES the run
// with the path named; nothing is skipped silently.
// ---------------------------------------------------------------------------------------------------------------------------------
/** Problems with `relPath` under `root` (empty array = confined regular file). Never reads file contents. */
function provenanceProblems(root, relPath, label) {
  const problems = [];
  const parts = relPath.split("/").filter(Boolean);
  let cur = root;
  for (let i = 0; i < parts.length; i++) {
    cur = path.join(cur, parts[i]);
    let st;
    try { st = fs.lstatSync(cur); } catch (e) { problems.push(`${label}${relPath}: cannot lstat ${parts.slice(0, i + 1).join("/")} (${e.code ?? e.message})`); return problems; }
    const sub = parts.slice(0, i + 1).join("/");
    if (st.isSymbolicLink()) { problems.push(`${label}${relPath}: ${i === parts.length - 1 ? "is a symlink" : `has a symlink ancestor directory ${sub}`} — refused (symlinks are never published)`); return problems; }
    if (i < parts.length - 1 && !st.isDirectory()) { problems.push(`${label}${relPath}: ancestor ${sub} is not a directory — refused`); return problems; }
    if (i === parts.length - 1 && !st.isFile()) { problems.push(`${label}${relPath}: not a regular file — refused`); return problems; }
  }
  const realRoot = fs.realpathSync(root);
  const real = fs.realpathSync(path.join(root, relPath));
  if (real !== realRoot && !real.startsWith(realRoot + path.sep)) problems.push(`${label}${relPath}: resolves outside its source root (${rel(real)}) — refused`);
  return problems;
}

/** The overlay root itself must be a real directory reached without symlinks (relative to the repo when it lives inside it). */
function overlayRootProblems() {
  if (!fs.existsSync(OVERLAY) && !isLink(OVERLAY)) return [];
  const r = path.relative(REPO, OVERLAY);
  const inside = r && !r.startsWith("..") && !path.isAbsolute(r);
  const problems = [];
  if (inside) {
    const parts = r.split(path.sep);
    let cur = REPO;
    for (let i = 0; i < parts.length; i++) {
      cur = path.join(cur, parts[i]);
      if (isLink(cur)) { problems.push(`overlay root ${r.split(path.sep).join("/")}: ${i === parts.length - 1 ? "is a symlink" : `has a symlink ancestor directory ${parts.slice(0, i + 1).join("/")}`} — refused (symlinks are never published)`); return problems; }
    }
  } else if (isLink(OVERLAY)) problems.push(`overlay root ${OVERLAY}: is a symlink — refused`);
  if (!fs.lstatSync(OVERLAY).isDirectory()) problems.push(`overlay root ${rel(OVERLAY)}: not a directory — refused`);
  return problems;
}

function isLink(p) { try { return fs.lstatSync(p).isSymbolicLink(); } catch { return false; } }

/** The source root a manifest entry must stay inside. */
const rootOf = (entry) => (entry.origin === "overlay" ? OVERLAY : REPO);

/** The whole published set: { published path → { from: absolute source, origin: "tracked" | "overlay" | "derived" } }. */
function buildManifest() {
  const specs = readAllowlist();
  const listed = listTracked(specs);
  const warnings = listed.filter((l) => l.files.length === 0).map((l) => `allowlist line matches no tracked file: ${l.spec}`);
  const manifest = new Map();
  const provenance = [];
  for (const { files } of listed) for (const f of files) {
    provenance.push(...provenanceProblems(REPO, f, ""));
    manifest.set(f, { from: path.join(REPO, f), origin: "tracked", src: f });
  }
  // the overlay wins over a tracked file at the same path (there should be none; say so if there is)
  const overlayProblems = overlayRootProblems();
  provenance.push(...overlayProblems);
  const links = [], odd = [];
  const overlayFiles = overlayProblems.length ? [] : walk(OVERLAY, OVERLAY, [], links, odd).filter((f) => !f.endsWith(".DS_Store"));
  for (const l of links) provenance.push(`overlay ${l}: is a symlink — refused (symlinks are never published)`);
  for (const o of odd) provenance.push(`overlay ${o}: not a regular file — refused`);
  for (const f of overlayFiles) {
    provenance.push(...provenanceProblems(OVERLAY, f, "overlay "));
    if (manifest.has(f) && manifest.get(f).origin === "tracked") warnings.push(`overlay replaces a tracked file: ${f}`);
    // the overlay directory itself is allowlisted (so the public can read it); its files are ALSO placed at the root
    manifest.set(f, { from: path.join(OVERLAY, f), origin: "overlay", src: f });
  }
  if (manifest.has(CHANGELOG_SRC)) manifest.set(CHANGELOG_PUBLIC_ROOT, { from: path.join(REPO, CHANGELOG_SRC), origin: "derived", src: CHANGELOG_SRC });
  return { manifest, warnings, specs, provenance: [...new Set(provenance)] };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// 2. checks
// ---------------------------------------------------------------------------------------------------------------------------------
const IMPORT_RE = /(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|^\s*import\s*['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)/gm;
const BUILTIN = (s) => s.startsWith("node:") || ["fs", "path", "os", "crypto", "url", "child_process", "util", "events", "stream", "http", "https", "zlib", "assert", "buffer", "readline", "module", "worker_threads", "sqlite", "test", "net", "tls", "dns", "process", "timers"].includes(s.split("/")[0]);

function resolveLocal(fromPublished, spec) {
  const base = spec.startsWith("@/") ? path.posix.join("src", spec.slice(2)) : path.posix.normalize(path.posix.join(path.posix.dirname(fromPublished), spec));
  return [base, `${base}.ts`, `${base}.tsx`, `${base}.mts`, `${base}.mjs`, `${base}.js`, path.posix.join(base, "index.ts"), path.posix.join(base, "index.tsx"), path.posix.join(base, "index.mjs")];
}

function pkgName(spec) { return spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]; }

function scanImports(manifest) {
  const monoPkg = JSON.parse(fs.readFileSync(path.join(REPO, "package.json"), "utf8"));
  const declared = { ...(monoPkg.devDependencies ?? {}), ...(monoPkg.dependencies ?? {}) };
  const violations = [];
  const notes = [];
  const external = new Map();   // pkg → Set(published files)
  const transitive = {};        // pkg → version read from node_modules when the monorepo does not declare it (tooling only)
  for (const [pub, { from }] of manifest) {
    if (!CODE_EXT.has(path.extname(pub))) continue;
    const src = fs.readFileSync(from, "utf8");
    let m;
    IMPORT_RE.lastIndex = 0;
    while ((m = IMPORT_RE.exec(src))) {
      const spec = m[1] ?? m[2] ?? m[3] ?? m[4];
      if (!spec) continue;
      if (spec.startsWith(".") || spec.startsWith("@/")) {
        const candidates = resolveLocal(pub, spec);
        if (!candidates.some((c) => manifest.has(c))) violations.push(`${pub}: imports "${spec}" which is not in the public tree`);
      } else if (!BUILTIN(spec) && !spec.startsWith("data:")) {
        const name = pkgName(spec);
        if (!external.has(name)) external.set(name, new Set());
        external.get(name).add(pub);
        if (!declared[name]) {
          // a package the monorepo gets transitively: allowed for tooling outside src/ (the brand render scripts use sharp), with the
          // installed version pinned so the generated package.json still installs; a src/ import of an undeclared package is a failure
          const installed = path.join(REPO, "node_modules", name, "package.json");
          if (!pub.startsWith("src/") && fs.existsSync(installed)) { transitive[name] = `^${JSON.parse(fs.readFileSync(installed, "utf8")).version}`; notes.push(`${pub}: package "${name}" is not declared by the monorepo; pinned from node_modules as ${transitive[name]} (devDependency)`); }
          else violations.push(`${pub}: imports package "${name}" which the monorepo package.json does not declare`);
        }
      }
    }
  }
  return { violations, notes, external, declared: { ...transitive, ...declared } };
}

function readDenyPatterns() {
  const out = [];
  for (const raw of fs.readFileSync(DENYPATTERNS, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^\/(.*)\/([a-z]*)(?:\s+allow:\s*(.*))?$/.exec(line);
    if (!m) throw new Error(`denypatterns: cannot parse line: ${line}`);
    out.push({ source: m[1], re: new RegExp(m[1], m[2]), allow: new Set((m[3] ?? "").split(/\s+/).filter(Boolean)) });
  }
  return out;
}

function isBinary(pub, buf) {
  if (BINARY_EXT.has(path.extname(pub).toLowerCase())) return true;
  const head = buf.subarray(0, 8000);
  return head.includes(0);
}

function scanDeny(manifest) {
  const patterns = readDenyPatterns();
  const hits = [];
  for (const [pub, { from }] of manifest) {
    if (NEVER_SCANNED.has(pub)) continue;
    const buf = fs.readFileSync(from);
    if (isBinary(pub, buf)) continue;
    const lines = buf.toString("utf8").split("\n");
    for (const p of patterns) {
      if (p.allow.has(pub)) continue;
      lines.forEach((l, i) => { p.re.lastIndex = 0; if (p.re.test(l)) hits.push(`${pub}:${i + 1}: /${p.source}/ — ${l.trim().slice(0, 140)}`); });
    }
  }
  return hits;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// 3. the generated package.json
// ---------------------------------------------------------------------------------------------------------------------------------
function generatePackageJson(external, declared) {
  const dependencies = {}, devDependencies = {};
  for (const [name, files] of [...external].sort()) {
    const inSrc = [...files].some((f) => f.startsWith("src/"));
    (inSrc ? dependencies : devDependencies)[name] = declared[name];
  }
  if (dependencies.next || dependencies.react) { dependencies.react ??= declared.react; dependencies["react-dom"] ??= declared["react-dom"]; }
  for (const d of ["typescript", "@types/node", "@types/react", "@types/react-dom", "tailwindcss", "@tailwindcss/postcss"]) if (declared[d]) devDependencies[d] = declared[d];
  if (dependencies["bn.js"] && declared["@types/bn.js"]) devDependencies["@types/bn.js"] = declared["@types/bn.js"];
  return {
    name: "burnticker",
    version: "0.1.0",
    private: false,
    license: "MIT",
    description: "Burnticker: an open launchpad for memecoins whose supply burns when a settled real-world event says so — the on-chain program, the keeper, the platform and the trust page. Carved out of a private monorepo by an explicit allowlist; see README.md.",
    scripts: {
      test: "node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/alias-hook.mjs --test --test-concurrency=1 \"test/**/*.test.ts\"",
      typecheck: "tsc --noEmit",
      check: "npm run typecheck && npm test",
      dev: "next dev", build: "next build", start: "next start",
      "keeper": "node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/alias-hook.mjs scripts/burnticker-keeper.mts",
      "keeper:deficit": "node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/alias-hook.mjs scripts/burn-keeper.mts",
      "audit": "node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/alias-hook.mjs scripts/burnticker-audit.mts",
      "platform-config": "node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/alias-hook.mjs scripts/burnticker-platform-config.mts",
      "powers-register": "node programs/burn-receipts/scripts/powers-register.mjs --check",
      "keygen": "node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/burnkeeper-keygen.mjs --new",
    },
    engines: { node: ">=22.6" },
    dependencies, devDependencies,
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// 4. tag
// ---------------------------------------------------------------------------------------------------------------------------------
function programHash() {
  const so = path.join(REPO, "programs", "burn-receipts", "target", "deploy", "burn_receipts.so");
  if (fs.existsSync(so)) return { hash: sha256(fs.readFileSync(so)), note: "sha256 of programs/burn-receipts/target/deploy/burn_receipts.so on the publishing host" };
  return { hash: null, note: "program not built on the publishing host (no target/deploy/burn_receipts.so) — the IDL hash below is the only program fingerprint in this entry" };
}

function appendTag(manifest) {
  const commit = git("rev-parse", "HEAD").trim();
  const dirty = git("status", "--porcelain").trim().length > 0;
  const idl = sha256(fs.readFileSync(path.join(REPO, "src", "lib", "burnReceipts", "idl.ts")));
  const prog = programHash();
  const allow = sha256(fs.readFileSync(ALLOWLIST));
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());   // the owner's clock, like every date in these logs
  const entry = [
    "",
    `## ${date} — publish from ${commit.slice(0, 12)}`,
    "",
    `- monorepo commit: \`${commit}\`${dirty ? " (the working tree had uncommitted changes when this tag was written)" : ""}`,
    `- program hash: ${prog.hash ? `\`${prog.hash}\`` : "none"} — ${prog.note}`,
    `- IDL sha256 (src/lib/burnReceipts/idl.ts): \`${idl}\``,
    `- allowlist sha256 (config/public-repo.allowlist): \`${allow}\``,
    `- files published: ${manifest.size}`,
    "",
  ].join("\n");
  fs.appendFileSync(path.join(REPO, CHANGELOG_SRC), entry);
  return { commit, dirty, idl, prog, allow, date };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// 5. copy + verify
// ---------------------------------------------------------------------------------------------------------------------------------
function cleanOut() {
  if (!fs.existsSync(OUT)) { fs.mkdirSync(OUT, { recursive: true }); return; }
  for (const e of fs.readdirSync(OUT)) {
    if (e === ".git" || e === "node_modules") continue;
    fs.rmSync(path.join(OUT, e), { recursive: true, force: true });
  }
}

/**
 * Copy time re-proves provenance (the tree may have changed since the check): lstat every component (no symlink, regular file),
 * realpath inside the entry's source root, then open the source with O_NOFOLLOW and confirm the open descriptor is a regular file
 * before reading. Throws on the first refusal — the caller empties the output.
 */
function copyAll(manifest) {
  for (const [pub, entry] of manifest) {
    const problems = provenanceProblems(rootOf(entry), entry.src, entry.origin === "overlay" ? "overlay " : "");
    if (problems.length) throw new Error(`copy refused: ${problems.join("; ")}`);
    const fd = fs.openSync(entry.from, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    let buf, mode;
    try {
      const st = fs.fstatSync(fd);
      if (!st.isFile()) throw new Error(`copy refused: ${pub}: source is not a regular file`);
      buf = fs.readFileSync(fd);
      mode = st.mode;
    } finally { fs.closeSync(fd); }
    const to = path.join(OUT, pub);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.writeFileSync(to, buf, { flag: "wx" });   // wx: never write through something already sitting at the destination
    if (pub.endsWith(".sh") || pub.endsWith(".mjs")) fs.chmodSync(to, mode);
  }
}

/**
 * Rescan what was actually staged (N5): walk the output (except .git and node_modules, which cleanOut keeps), refuse any symlink or
 * non-regular file, refuse any file the manifest did not put there, and run the deny scan again over the staged bytes.
 */
function rescanStaged(manifest) {
  const links = [], odd = [];
  const files = [];
  for (const e of fs.readdirSync(OUT, { withFileTypes: true })) {
    if (e.name === ".git" || e.name === "node_modules") continue;
    const p = path.join(OUT, e.name);
    if (e.isSymbolicLink()) links.push(e.name);
    else if (e.isDirectory()) walk(p, OUT, files, links, odd);
    else if (e.isFile()) files.push(e.name);
    else odd.push(e.name);
  }
  const expected = new Set([...manifest.keys(), "package.json", "package-lock.json"]);
  const problems = [
    ...links.map((l) => `staged ${l}: is a symlink`),
    ...odd.map((o) => `staged ${o}: not a regular file`),
    ...files.filter((f) => !expected.has(f)).map((f) => `staged ${f}: not in the manifest`),
  ];
  const staged = new Map(files.map((f) => [f, { from: path.join(OUT, f), origin: "staged" }]));
  const hits = scanDeny(staged);
  return { problems, hits, count: files.length };
}

/**
 * THE LOCKFILE (2026-10-10: the Burnticker host installs from this tree with `npm ci`). Derived, never resolved afresh: the monorepo's
 * package-lock.json is copied in and `npm install --package-lock-only` prunes it to the generated package.json, so every version the
 * public tree locks is the version the monorepo already runs and tests (no registry resolution of new versions). The result goes through
 * the same leak scan as every other published file. `--no-lockfile` skips it.
 */
function deriveLockfile() {
  const src = path.join(REPO, "package-lock.json");
  if (!fs.existsSync(src)) { console.log("lockfile: the monorepo has no package-lock.json — none written"); return true; }
  const to = path.join(OUT, "package-lock.json");
  fs.copyFileSync(src, to);
  const r = spawnSync("npm", ["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: OUT, encoding: "utf8", env: { ...process.env, NODE_OPTIONS: "" } });
  if (r.status !== 0) { fs.rmSync(to, { force: true }); console.log(`lockfile: npm install --package-lock-only FAILED (exit ${r.status})\n${(r.stdout + r.stderr).trim().split("\n").slice(-8).join("\n")}`); return false; }
  const hits = scanDeny(new Map([["package-lock.json", { from: to, origin: "derived" }]]));
  if (hits.length) { fs.rmSync(to, { force: true }); console.log(`lockfile: LEAK SCAN FAILED (${hits.length}) — removed:\n${hits.map((h) => `  ${h}`).join("\n")}`); return false; }
  const n = Object.keys(JSON.parse(fs.readFileSync(to, "utf8")).packages ?? {}).length;
  console.log(`lockfile: package-lock.json pruned from the monorepo's lock (${n} entries; no version resolved afresh)`);
  return true;
}

function verify() {
  if (flag("link-node-modules") && !fs.existsSync(path.join(OUT, "node_modules"))) fs.symlinkSync(path.join(REPO, "node_modules"), path.join(OUT, "node_modules"));
  if (!fs.existsSync(path.join(OUT, "node_modules"))) { console.log("verify: no node_modules in the public tree — run `npm install` there (or pass --link-node-modules for a local check)"); return false; }
  const run = (label, file, a) => {
    const r = spawnSync(file, a, { cwd: OUT, encoding: "utf8", env: { ...process.env, NODE_OPTIONS: "" } });
    const tail = (r.stdout + r.stderr).trim().split("\n").slice(-12).join("\n");
    console.log(`verify: ${label}: ${r.status === 0 ? "ok" : `FAILED (exit ${r.status})`}\n${tail.replace(/^/gm, "    ")}`);
    return r.status === 0;
  };
  const okTsc = run("tsc --noEmit", path.join(OUT, "node_modules", ".bin", "tsc"), ["--noEmit", "-p", "tsconfig.json"]);
  const okTest = run("node --test", process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--import", "./test/alias-hook.mjs", "--test", "--test-concurrency=1", "test/**/*.test.ts"]);
  return okTsc && okTest;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------------------------------------------------------------
function main() {
  if (cmd !== "check" && cmd !== "publish") { console.error("usage: public-repo-lib.mjs check|publish [--out D] [--tag] [--verify] [--link-node-modules]"); process.exit(2); }
  const { manifest, warnings, provenance } = buildManifest();
  // provenance first, and before any file is READ: a symlinked source is never opened, so its target cannot reach the report either
  if (provenance.length) {
    console.log(`PROVENANCE CHECK FAILED (${provenance.length}) — symlinks / non-regular / out-of-root sources are never published:`);
    for (const p of provenance) console.log(`  ${p}`);
    console.log(`\nnothing written.\nCHECK FAILED: ${provenance.length} provenance, 0 import, 0 leak findings`);
    process.exit(1);
  }
  const { violations, notes, external, declared } = scanImports(manifest);
  const hits = scanDeny(manifest);

  console.log(`public tree: ${manifest.size} files from ${readAllowlist().length} allowlist lines (+ overlay ${[...manifest.values()].filter((v) => v.origin === "overlay").length}, derived ${[...manifest.values()].filter((v) => v.origin === "derived").length})`);
  const byTop = new Map();
  for (const pub of manifest.keys()) { const top = pub.includes("/") ? pub.split("/").slice(0, 2).join("/") : pub; byTop.set(top, (byTop.get(top) ?? 0) + 1); }
  for (const [k, n] of [...byTop].sort()) console.log(`  ${String(n).padStart(4)}  ${k}`);
  console.log(`external packages (${external.size}): ${[...external.keys()].sort().join(", ")}`);
  for (const w of warnings) console.log(`warning: ${w}`);
  for (const n of notes) console.log(`note: ${n}`);
  if (flag("list")) for (const pub of [...manifest.keys()].sort()) console.log(`  ${pub}`);

  if (violations.length) { console.log(`\nIMPORT CHECK FAILED (${violations.length}):`); for (const v of violations) console.log(`  ${v}`); }
  else console.log("import check: every local import resolves inside the public tree; every package is declared");
  if (hits.length) { console.log(`\nLEAK SCAN FAILED (${hits.length}):`); for (const h of hits) console.log(`  ${h}`); }
  else console.log("leak scan: no pattern matched");
  // The LAST line is the verdict, worded so it cannot be misread (the orchestrator greps it): exactly "CHECK PASSED" or
  // "CHECK FAILED: N import, M leak findings" (a provenance refusal above prints "CHECK FAILED: K provenance, 0 import, 0 leak
  // findings"). Exit status agrees (0 / 1). Nothing is written on a failure or in --check.
  if (violations.length || hits.length) { console.log(`\nnothing written.\nCHECK FAILED: ${violations.length} import, ${hits.length} leak findings`); process.exit(1); }
  if (cmd === "check") { console.log("nothing written (dry run).\nCHECK PASSED"); return; }

  if (flag("tag")) { const t = appendTag(manifest); console.log(`tagged ${CHANGELOG_SRC}: ${t.date} commit ${t.commit.slice(0, 12)}${t.dirty ? " (dirty)" : ""}, program ${t.prog.hash ?? "not built here"}, IDL ${t.idl.slice(0, 16)}…`); }
  // an unchanged lockfile keeps its old mtime, so the host's `npm ci` (run when the lockfile is newer than node_modules) is not repeated for nothing
  const oldLockPath = path.join(OUT, "package-lock.json");
  const oldLock = fs.existsSync(oldLockPath) ? { buf: fs.readFileSync(oldLockPath), mtime: fs.statSync(oldLockPath).mtime } : null;
  cleanOut();
  try { copyAll(manifest); }
  catch (e) { cleanOut(); console.log(`\n${e.message}\nthe output was emptied.\nCHECK FAILED: 1 provenance, 0 import, 0 leak findings`); process.exit(1); }
  const pkg = generatePackageJson(external, declared);
  fs.writeFileSync(path.join(OUT, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
  console.log(`wrote ${OUT} (${manifest.size} files + package.json with ${Object.keys(pkg.dependencies).length} dependencies, ${Object.keys(pkg.devDependencies).length} devDependencies)`);
  if (!flag("no-lockfile") && !deriveLockfile()) process.exit(1);
  const staged = rescanStaged(manifest);
  if (staged.problems.length || staged.hits.length) {
    cleanOut();
    console.log(`\nSTAGED OUTPUT CHECK FAILED — the output was emptied:`);
    for (const p of [...staged.problems, ...staged.hits]) console.log(`  ${p}`);
    console.log(`CHECK FAILED: ${staged.problems.length} provenance, 0 import, ${staged.hits.length} leak findings`);
    process.exit(1);
  }
  console.log(`staged output: ${staged.count} regular files, no symlink, nothing outside the manifest, leak scan clean`);
  if (oldLock && fs.existsSync(oldLockPath) && fs.readFileSync(oldLockPath).equals(oldLock.buf)) fs.utimesSync(oldLockPath, oldLock.mtime, oldLock.mtime);
  if (flag("verify")) { const ok = verify(); if (!ok) process.exit(1); }
}

main();
