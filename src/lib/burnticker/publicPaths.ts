/**
 * NO REPOSITORY PATHS IN PUBLIC ANSWERS (continuous audit run 4, HB-46: /v1/current-status, /v1/operator and the incidents page printed
 * "config/burnticker/current-status.json", "docs/burnkeeper/evidence/…" and "docs/burnticker/incidents/LOG.md"). A field whose whole value
 * is a path into the private monorepo is left out; a path inside a sentence is said as "the published record". Strings that are hashed
 * records (a rule's exact text) must not pass through this. Pure and client-safe.
 */
import { repoUrl } from "@/lib/burnticker/currentStatusLinks";

/** HB-46 residue (2026-10-19): a relative Markdown link ("../INCIDENTS.md") resolved against the folder of the file it sits in. */
export function resolveRepoLink(base: string, rel: string): string | null {
  if (/^[a-z]+:/i.test(rel) || rel.startsWith("/") || rel.startsWith("#")) return null;
  const parts = base.replace(/\/+$/, "").split("/").filter(Boolean);
  for (const seg of rel.split("#")[0].split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") { if (!parts.length) return null; parts.pop(); } else parts.push(seg);
  }
  return parts.length ? parts.join("/") : null;
}
export const REPO_PATH_RE = /(?<![\w/.:-])(?:docs|config|scripts|src|deploy|research)\/[A-Za-z0-9_./-]*[A-Za-z0-9_/]/g;
const WHOLE_PATH_RE = /^(?:\.\.\/)*(?:docs|config|scripts|src|deploy|research)\/\S*$/;
export const PUBLISHED_RECORD = "the published record";

export function sentenceWithoutRepoPaths(s: string): string {
  return s.replace(REPO_PATH_RE, PUBLISHED_RECORD).replace(/the published record(?:,? the published record)+/g, PUBLISHED_RECORD);
}

/** A deep copy of `x` with whole-path fields dropped and in-sentence paths replaced. */
export function withoutRepoPaths<T>(x: T): T {
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return sentenceWithoutRepoPaths(v);
    if (Array.isArray(v)) return v.filter((e) => !(typeof e === "string" && WHOLE_PATH_RE.test(e.trim()))).map(walk);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, e] of Object.entries(v as Record<string, unknown>)) {
        if (typeof e === "string" && WHOLE_PATH_RE.test(e.trim())) continue;
        out[k] = walk(e);
      }
      return out;
    }
    return v;
  };
  return walk(x) as T;
}

/**
 * HB-46: an incident entry's Markdown as plain pieces. "[text](https://…)" is a link; a relative link ("../INCIDENTS.md") keeps only its
 * words; `code` and **bold** marks are dropped; a bare repository path is said as "the published record". With `base` (the folder of
 * the file the line comes from), a relative link opens that file in the public repository at the pinned commit (repoUrl); its words
 * stay plain English, never the path.
 */
export function markdownLinkParts(line: string, o: { base?: string } = {}): { text: string; href: string | null }[] {
  const out: { text: string; href: string | null }[] = [];
  const re = /\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0, m: RegExpExecArray | null;
  const plain = (s: string) => sentenceWithoutRepoPaths(s.replace(/\*\*|`/g, ""));
  while ((m = re.exec(line))) {
    if (m.index > last) out.push({ text: plain(line.slice(last, m.index)), href: null });
    const resolved = o.base && !/^https?:\/\//.test(m[2]) ? resolveRepoLink(o.base, m[2]) : null;
    const href = /^https?:\/\//.test(m[2]) ? m[2] : resolved ? repoUrl(resolved) : null;
    const words = m[1].replace(/\*\*|`/g, "");
    const pathLike = /\/|\.(?:md|json|log)$/i.test(words);
    out.push({ text: href && !(resolved && pathLike) ? words : pathLike ? PUBLISHED_RECORD : plain(words), href });
    last = m.index + m[0].length;
  }
  if (last < line.length) out.push({ text: plain(line.slice(last)), href: null });
  return out.filter((p) => p.text);
}
