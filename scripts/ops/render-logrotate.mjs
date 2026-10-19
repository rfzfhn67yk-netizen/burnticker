#!/usr/bin/env node
// RENDERS deploy/logrotate/burnticker for this host (scripts/ops/install-burnticker-units.sh; 2026-10-18 prelaunch audit A-32).
//   node scripts/ops/render-logrotate.mjs <template> <repo dir> <user> <group>   → the config on stdout
// @REPO@, @USER@ and @GROUP@ are replaced as plain text (split/join), never through sed or a regex replacement, so a directory holding
// `&`, `|` or `\` is written as it is (the 2026-09-28 env incident: a bare `&` in a sed replacement pasted the matched text back in).
// Refused, exit 2: a repo path that is not absolute or holds whitespace, a quote, `#`, `{` or `}` (each would change how logrotate reads
// the line), and a user or group name that is not a plain account name.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function renderLogrotate(template, repo, user, group) {
  if (!path.isAbsolute(repo) || /[\s"'#{}]/.test(repo)) throw new Error(`refusing to write a logrotate path for ${JSON.stringify(repo)}: it must be absolute, with no whitespace, quote, # or brace`);
  for (const [what, v] of [["user", user], ["group", group]]) if (!/^[a-z_][a-z0-9_.-]*$/i.test(v ?? "")) throw new Error(`refusing ${what} ${JSON.stringify(v)}: not a plain account name`);
  return template.split("@REPO@").join(repo.replace(/\/+$/, "")).split("@USER@").join(user).split("@GROUP@").join(group);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [tpl, repo, user, group] = process.argv.slice(2);
  if (!tpl || !repo || !user || !group) { console.error("usage: render-logrotate.mjs <template> <repo dir> <user> <group>"); process.exit(2); }
  try { process.stdout.write(renderLogrotate(fs.readFileSync(tpl, "utf8"), repo, user, group)); }
  catch (e) { console.error(e.message); process.exit(2); }
}
