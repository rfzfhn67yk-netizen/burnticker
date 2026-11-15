/**
 * Settings for the three starter bots, all from the environment (no keys anywhere: the public API is keyless).
 *
 *   BURNTICKER_API    the API base   (default https://burnticker.com/api/burnticker/v1)
 *   BURNTICKER_SITE   the site that pages and posts link to (default https://burnticker.com)
 *   STARTER_STATE     where follow.ts remembers the receipts it has printed (default ./.starter-state)
 *   STARTER_QUEUE     where post.ts appends queued posts (default ./queue/posts.jsonl)
 */
import path from "node:path";
import { pathToFileURL } from "node:url";

export interface StarterConfig { api: string; site: string; stateDir: string; queueFile: string }

export function config(env: Readonly<Record<string, string | undefined>> = process.env): StarterConfig {
  const trim = (s: string | undefined, d: string) => ((s ?? "").trim() || d).replace(/\/$/, "");
  return {
    api: trim(env.BURNTICKER_API, "https://burnticker.com/api/burnticker/v1"),
    site: trim(env.BURNTICKER_SITE, "https://burnticker.com"),
    stateDir: trim(env.STARTER_STATE, ".starter-state"),
    queueFile: trim(env.STARTER_QUEUE, "queue/posts.jsonl"),
  };
}

/** `--name value` and `--flag` arguments, plus the positionals. */
export function parseArgs(argv: readonly string[]): { pos: string[]; opt: Record<string, string | true> } {
  const pos: string[] = [], opt: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) { pos.push(a); continue; }
    const [k, v] = a.slice(2).split("=", 2);
    if (v !== undefined) opt[k] = v;
    else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith("--")) opt[k] = argv[++i];
    else opt[k] = true;
  }
  return { pos, opt };
}

/** True when the module at `url` is the script node was started with (so the files can be imported by tests without running). */
export const isMain = (url: string): boolean => process.argv[1] !== undefined && url === pathToFileURL(path.resolve(process.argv[1])).href;
