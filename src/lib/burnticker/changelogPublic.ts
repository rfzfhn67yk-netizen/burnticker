/**
 * THE CHANGELOG AS VISITORS READ IT (prelaunch audit 2026-10-18 A-6). docs/burnticker/CHANGELOG.md keys every release by the private
 * monorepo commit it was cut from; the trust page rendered the file verbatim and the changelog page printed "Cut from source commit …".
 * This text has every monorepo commit removed: the "- monorepo commit:" lines go, a heading's "publish from <commit>" becomes "publish",
 * an after-the-fact line keeps only its public commit, and any other mention of a monorepo commit the file records (in full, or its
 * first 12 or 8 characters) reads "a source commit". Pure; no imports. This scrubs what the site serves; the public repository's copy
 * of CHANGELOG.md, verified-build.json and the well-known file still name monorepo commits (review 7 of A-6).
 */
export function publicChangelogMarkdown(md: string): string {
  const full = [...md.matchAll(/^- monorepo commit: `([0-9a-f]{40})`/gm)].map((m) => m[1]);
  const keys = new Set<string>([
    ...full.flatMap((c) => [c, c.slice(0, 12), c.slice(0, 8)]),
    ...[...md.matchAll(/publish from ([0-9a-f]{12})/g)].flatMap((m) => [m[1], m[1].slice(0, 8)]),
  ]);
  const out = md.split("\n").filter((l) => !/^- monorepo commit: /.test(l)).map((l) => l
    .replace(/^(## \d{4}-\d{2}-\d{2} — publish) from [0-9a-f]{12}\s*$/, "$1")
    .replace(/^- publish from [0-9a-f]{12}: (public commit `[0-9a-f]{7,40}`)\s*$/, "- $1")).join("\n");
  return out.replace(/\b[0-9a-f]{8,40}\b/g, (h) => (keys.has(h) ? "a source commit" : h));
}
