// @burnticker/sdk IMPORT-GRAPH LEAK TEST (2026-10-09). The SDK is published, and packages/burnticker-sdk/ goes into the public repo:
// its import closure (type-only imports included — the .d.ts files need them) must never reach private code (the trading platform's
// modules, scripts/, env files, the app's routes, the server wiring and registry, the $DEFICIT keeper's cycle/ledger), must stay inside
// an explicit allowlist AND inside config/public-repo.allowlist, must pass config/public-repo.denypatterns (the publish script's leak
// scan), and public-closure.json (what the public-repo allowlist copies) must be current.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { closure, entries, manifest, MANIFEST, REPO, PKG, specifiers, resolve } from "../packages/burnticker-sdk/scripts/closure.mjs";
import { stage } from "../packages/burnticker-sdk/scripts/build.mjs";
import type { ConfirmOutcome as KeeperConfirm } from "@/lib/burnKeeper/cycle";
import type { ConfirmOutcome as ProgramConfirm } from "@/lib/burnticker/program";

// Compile-time: program.ts's local ConfirmOutcome (kept local so the closure skips the keeper's cycle) stays identical to cycle.ts's.
const toProgram = (x: KeeperConfirm): ProgramConfirm => x;
const toKeeper = (x: ProgramConfirm): KeeperConfirm => x;
void toProgram; void toKeeper;

type Closure = { files: string[]; externals: string[]; edges: [string, string][] };
const c = closure() as Closure;
const walkFiles = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walkFiles(path.join(dir, e.name)) : [path.join(dir, e.name)]));

/** Every repository file the SDK may reach, with why. Anything else in the closure fails the test. */
const ALLOWED_DIRS = ["packages/burnticker-sdk/", "src/lib/burnticker/", "src/lib/burnReceipts/"];
const ALLOWED_BURNKEEPER: Record<string, string> = {
  "src/lib/burnKeeper/launch.ts": "the LaunchLab builders and fee views (named in the brief)",
  "src/lib/burnKeeper/launchlab.ts": "launch.ts's LaunchLab PDAs and program ids",
  "src/lib/burnKeeper/solana.ts": "launch.ts's token-program helpers and base58",
  "src/lib/burnKeeper/rules.ts": "rulesSha256 and the exact buyback-spend formula every receipt is checked against",
  "src/lib/burnKeeper/memo.ts": "the memo byte ceiling the v3 receipt memo shares",
  "src/lib/burnKeeper/burnPool.ts": "burnPoolFor: the burn program's fee PDA = LaunchLab's creator (review H-2)",
  "src/lib/burnKeeper/programPort.ts": "the import-free ProgramPort types BurnProgramClient.port() returns (2026-10-10)",
  "src/lib/burnKeeper/fakeProgram.ts": "FakeBurnProgram's in-memory burn_receipts program (the program's own math mirror; no keeper cycle)",
};
/** Platform modules that must never be in the SDK: server wiring, storage, page rendering, filesystem config readers, the keeper loop. */
const FORBIDDEN_BURNTICKER = ["server.ts", "registry.ts", "tokenPage.ts", "trust.ts", "multiKeeper.ts", "audit.ts", "catalogue/index.ts", "oracle/refuse.ts", "alerts.ts", "alertIntake.ts", "checkin.ts", "ownTokensSync.ts", "api/"];
const ALLOWED_NPM = ["@raydium-io/raydium-sdk-v2", "@solana/web3.js", "bn.js"];
const ALLOWED_BUILTINS = ["node:crypto", "node:fs"];

describe("the SDK's import closure", () => {
  test("starts from the package entry and every example", () => {
    const e = (entries() as string[]).map((f) => path.relative(REPO, f));
    assert.ok(e.includes("packages/burnticker-sdk/src/index.ts"));
    assert.ok(e.filter((f) => f.startsWith("packages/burnticker-sdk/examples/")).length >= 3, "the three examples are walked too");
    assert.ok(c.files.length > 20);
  });
  test("never touches scripts/, env files, the app, data/config/deploy, or any directory outside src/lib's three public modules", () => {
    for (const f of c.files) {
      assert.doesNotMatch(f, /^scripts\//, f);
      assert.doesNotMatch(f, /(^|\/)\.[a-z]+(\.|$)/, `${f}: no dotfile`);
      assert.doesNotMatch(f, /^src\/app\//, f);
      assert.doesNotMatch(f, /^(data|config|deploy|electron|handoff|site)\//, f);
      if (f.startsWith("src/lib/")) assert.match(f, /^src\/lib\/(burnticker|burnReceipts|burnKeeper)\//, `${f}: only the three public src/lib modules`);
    }
  });
  test("every closure file and every package file is published by config/public-repo.allowlist", () => {
    const lines = fs.readFileSync(path.join(REPO, "config", "public-repo.allowlist"), "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
    const covered = (f: string) => lines.some((l) => f === l || f.startsWith(`${l}/`) || (l.includes("*") && new RegExp(`^${l.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*")}$`).test(f)));
    const pkgFiles = walkFiles(PKG).map((f) => path.relative(REPO, f)).filter((f) => !/\/(build|dist|node_modules)\//.test(f));
    for (const f of [...c.files, ...pkgFiles]) assert.ok(covered(f), `${f} is not matched by config/public-repo.allowlist`);
    assert.ok(lines.includes("packages/burnticker-sdk/public-closure.json"));
  });
  test("every package and closure file passes the publish leak scan (config/public-repo.denypatterns)", () => {
    const rules = fs.readFileSync(path.join(REPO, "config", "public-repo.denypatterns"), "utf8").split("\n").map((l) => l.trim()).filter((l) => l.startsWith("/")).map((l) => {
      const m = /^\/(.*)\/([a-z]*)(?:\s+allow:\s*(.*))?$/.exec(l)!;
      return { re: new RegExp(m[1], m[2]), allow: (m[3] ?? "").split(/\s+/).filter(Boolean) };
    });
    assert.ok(rules.length > 10);
    const pkgFiles = walkFiles(PKG).map((f) => path.relative(REPO, f)).filter((f) => !/\/(build|dist|node_modules)\//.test(f));
    const hits: string[] = [];
    for (const f of new Set([...c.files, ...pkgFiles, "test/burntickerSdk.test.ts", "test/burntickerApiV1.test.ts", "test/burntickerApiHelpers.ts", "test/burntickerOpenApi.test.ts", "test/burntickerDraftExpiry.test.ts", "test/burntickerSdkLeak.test.ts", "docs/burnticker/sdk.md", "docs/burnticker/api.md"])) {
      fs.readFileSync(path.join(REPO, f), "utf8").split("\n").forEach((line, i) => { for (const r of rules) if (!r.allow.includes(f) && r.re.test(line)) hits.push(`${f}:${i + 1} ${r.re}`); });
    }
    assert.deepEqual(hits, []);
  });
  test("stays inside the allowlist (burnticker, burnReceipts, the six named burnKeeper modules, the package itself)", () => {
    for (const f of c.files) {
      const ok = ALLOWED_DIRS.some((d) => f.startsWith(d)) || f in ALLOWED_BURNKEEPER;
      assert.ok(ok, `${f} is outside the SDK allowlist (reached via ${c.edges.filter(([, to]) => to === f).map(([from]) => from).join(", ")})`);
      for (const bad of FORBIDDEN_BURNTICKER) assert.ok(!f.startsWith(`src/lib/burnticker/${bad}`), `${f} must not be in the SDK (server/storage/page/config code)`);
    }
  });
  test("npm packages and node builtins are the three public dependencies and crypto/fs — no server-only, next, sqlite", () => {
    const npm = c.externals.filter((e) => !e.startsWith("node:"));
    const builtins = c.externals.filter((e) => e.startsWith("node:"));
    assert.deepEqual(npm, ALLOWED_NPM);
    for (const b of builtins) assert.ok(ALLOWED_BUILTINS.includes(b), `builtin ${b}`);
    const pkg = JSON.parse(fs.readFileSync(path.join(PKG, "package.json"), "utf8")) as { name: string; dependencies: Record<string, string>; private?: boolean };
    const root = JSON.parse(fs.readFileSync(path.join(REPO, "package.json"), "utf8")) as { dependencies: Record<string, string> };
    assert.equal(pkg.name, "@burnticker/sdk");
    assert.deepEqual(Object.keys(pkg.dependencies).sort(), ALLOWED_NPM, "package.json declares exactly what the closure imports");
    for (const d of ALLOWED_NPM) assert.equal(pkg.dependencies[d], root.dependencies[d], `${d}: the same version the platform runs`);
  });
  test("no closure file imports the private app's database, owner-action gate or refuse-list loader, or reads a secret-shaped variable", () => {
    for (const f of c.files) {
      const src = fs.readFileSync(path.join(REPO, f), "utf8");
      assert.doesNotMatch(src, /from ["']@\/lib\/(db|ownerAction|ownTokens)["']|dotenv|SECRET_KEY|PRIVATE_KEY/, f);
    }
  });
  test("public-closure.json is current (run: node packages/burnticker-sdk/scripts/closure.mjs --write)", () => {
    assert.equal(fs.readFileSync(MANIFEST, "utf8"), `${JSON.stringify(manifest(c), null, 2)}\n`);
  });
  test("the examples import only the package's public entry", () => {
    for (const f of (entries() as string[]).filter((x) => x.includes("/examples/"))) {
      for (const s of specifiers(fs.readFileSync(f, "utf8")) as string[]) {
        const r = resolve(s, f) as { file?: string; external?: string };
        if (r.file) assert.equal(path.relative(REPO, r.file), "packages/burnticker-sdk/src/index.ts", `${path.relative(REPO, f)} imports ${s}`);
        else assert.ok(["@solana/web3.js", "node:fs", "node:crypto", "node:process"].includes(r.external!), `${path.relative(REPO, f)} imports ${s}`);
      }
    }
  });
  test("the build stage copies exactly the closure and leaves no repo alias behind (the published package is self-contained)", () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "bt-sdk-stage-"));
    try {
      const files = stage(out) as string[];
      assert.ok(files.length > 20);
      for (const f of files) {
        for (const s of specifiers(fs.readFileSync(f, "utf8")) as string[]) {
          assert.ok(!s.startsWith("@/"), `${path.relative(out, f)} still imports ${s}`);
          if (s.startsWith(".")) assert.ok(fs.existsSync(path.resolve(path.dirname(f), s)), `${path.relative(out, f)}: ${s} resolves in the staged tree`);
        }
      }
      assert.deepEqual(fs.readdirSync(path.join(out, "lib")).sort(), ["burnKeeper", "burnReceipts", "burnticker"], "only the three public modules are staged");
      assert.ok(!fs.existsSync(path.join(out, "lib", "burnticker", "server.ts")));
    } finally { fs.rmSync(out, { recursive: true, force: true }); }
  });
});
