// I-6 (audit 2026-10-19): the origin answered on its public address around Cloudflare. scripts/ops/cloudflare-ufw-rules.sh PRINTS the ufw
// rules that admit only Cloudflare's ranges to 80/443 (it applies nothing); the runbook says how the owner applies them.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { CLOUDFLARE_RANGES } from "@/lib/burnticker/api/clientIp";

const ROOT = path.join(import.meta.dirname, "..");
const SCRIPT = path.join(ROOT, "scripts", "ops", "cloudflare-ufw-rules.sh");
const V4 = CLOUDFLARE_RANGES.filter((r) => !r.includes(":")), V6 = CLOUDFLARE_RANGES.filter((r) => r.includes(":"));

function run(v4: string, v6: string, ...args: string[]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cf-ufw-"));
  fs.writeFileSync(path.join(dir, "ips-v4"), v4); fs.writeFileSync(path.join(dir, "ips-v6"), v6);
  const r = spawnSync("sh", [SCRIPT, "--from", dir, ...args], { encoding: "utf8", env: { PATH: process.env.PATH ?? "/usr/bin:/bin" } as unknown as NodeJS.ProcessEnv });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

describe("I-6: the Cloudflare-only ufw rules are printed, never applied", () => {
  test("one allow rule per published range on 80,443, then the public rules removed, then a status check; no SSH or tailnet rule", () => {
    const r = run(`${V4.join("\n")}\n`, `${V6.join("\n")}\n\n`);
    assert.equal(r.code, 0, r.err);
    const allows = r.out.split("\n").filter((l) => l.startsWith("ufw allow "));
    assert.equal(allows.length, CLOUDFLARE_RANGES.length);
    for (const c of CLOUDFLARE_RANGES) assert.ok(allows.includes(`ufw allow proto tcp from ${c} to any port 80,443 comment 'cloudflare'`), c);
    const lines = r.out.split("\n");
    assert.ok(lines.indexOf("ufw delete allow 80/tcp") > lines.indexOf(allows[allows.length - 1]), "the open rules go only after every Cloudflare rule is in");
    assert.ok(lines.includes("ufw delete allow 443/tcp") && lines.includes("ufw status numbered"));
    assert.doesNotMatch(r.out.replace(/^#.*$/gm, ""), new RegExp(`port 22|${["tail", "scale"].join("")}|ufw (enable|disable|reset|default)`, "i"), "SSH, the tailnet and the defaults are not touched");
    assert.doesNotMatch(r.out, /WARNING/, "the app's list matches the published one");
  });
  test("a bad line, an empty list or a missing file prints no rule at all", () => {
    for (const [v4, v6] of [[`${V4[0]}\n<html>oops</html>\n`, V6.join("\n")], ["", V6.join("\n")], [V4.join("\n"), "not a range\n"]]) {
      const r = run(v4, v6);
      assert.equal(r.code, 1);
      assert.doesNotMatch(r.out, /^ufw /m, "never a half list");
    }
  });
  test("a range the app does not trust is printed with a warning to update clientIp.ts", () => {
    const r = run(`${[...V4, "203.0.113.0/24"].join("\n")}\n`, V6.join("\n"));
    assert.equal(r.code, 0);
    assert.match(r.out, /# WARNING: Cloudflare's list differs from CLOUDFLARE_RANGES[\s\S]*Only in Cloudflare's list: 203\.0\.113\.0\/24/);
  });
  test("--remove-only prints the undo", () => {
    const r = run(V4.join("\n"), V6.join("\n"), "--remove-only");
    assert.equal(r.code, 0);
    assert.equal(r.out.split("\n").filter((l) => l.startsWith("ufw delete allow proto tcp from ")).length, CLOUDFLARE_RANGES.length);
  });
  test("the runbook carries the section, the script never calls ufw itself, and both are published", () => {
    const rb = fs.readFileSync(path.join(ROOT, "docs", "burnticker", "runbook.md"), "utf8");
    const sec = rb.slice(rb.indexOf("## Admit only Cloudflare at the origin"));
    assert.ok(rb.includes("## Admit only Cloudflare at the origin"));
    for (const re of [/cloudflare-ufw-rules\.sh/, /tailnet's network interface/, /`22\/tcp` allowed from\n   the tailnet's address range/, /caddy validate/, /--resolve/, /[Aa]uthenticated origin pulls/]) assert.match(sec, re);
    const s = fs.readFileSync(SCRIPT, "utf8").replace(/^#.*$/gm, "");
    assert.doesNotMatch(s, /^\s*ufw /m, "the script prints ufw commands; it never runs one");
    assert.match(fs.readFileSync(path.join(ROOT, "config", "public-repo.allowlist"), "utf8"), /^scripts\/ops\/cloudflare-ufw-rules\.sh$/m);
  });
});
