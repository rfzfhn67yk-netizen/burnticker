/**
 * The pre-launch primary action (website brief 2026-10-11 §1/§5; UX report 3 item 2 renamed it): "Inspect the devnet receipt" opens the check page with the featured
 * devnet receipt pre-selected (the receipt itself is named once, in config/burnticker/current-status.json `demo`, and the check page
 * resolves `?demo=1` against it). Client-safe: no file reads, so the launch gate, the coin page and the static pages can all link it.
 */
export const EXPLORE_VERIFIED_BURN = {
  label: "Inspect the devnet receipt",
  href: "/burnticker/check?demo=1#verify",
  blurb: "A real devnet receipt from the rehearsal: the source reading, the rule, the transaction and every check, run in your browser.",
} as const;

/** The one destination for "Seasons" on every surface (header, footer, landing door, leagues index). */
export const SEASONS_HREF = "/burnticker/leagues";

/** The prerequisite chain from mint to first receipt (docs/burnticker/FIRST-BURN-PATH.md), in the public repository. */
export const FIRST_BURN_PATH_URL = "https://github.com/rfzfhn67yk-netizen/burnticker/blob/main/docs/burnticker/FIRST-BURN-PATH.md";

/**
 * EVIDENCE LINKS PINNED TO A PUBLIC COMMIT (website audit 4, BT-14). Every repository path a trust surface cites (decision log, incident
 * log, reviews, rehearsal records, evidence files, configs) links to the public repository AT THIS COMMIT, so the evidence a page points at
 * cannot change under the link. Bump it after each publish (scripts/ops/publish-public-repo.sh; the commit is the public repo's main
 * after the push): a file added since the pinned commit 404s until then. test/burntickerTrustLinks.test.ts checks the shape.
 */
export const PUBLIC_REPO_URL = "https://github.com/rfzfhn67yk-netizen/burnticker";
export const PUBLIC_REPO_COMMIT = "7764cbda58dbbe989eb60ebd2870d2d734902d9f";
/** Repository paths a page may cite (top-level folders of the public tree). */
export const REPO_PATH_RE = /\b(?:docs|config|src|programs|scripts|site|test|deploy)\/[A-Za-z0-9_./\[\]-]*[A-Za-z0-9_\]/-]/g;
/** The pinned GitHub URL of a repository path: a trailing "/" (a folder) opens the tree view, anything else the file. */
export function repoUrl(p: string, commit: string = PUBLIC_REPO_COMMIT): string {
  const clean = p.replace(/^\.?\//, "").replace(/[.,;:)]+$/, "");
  return `${PUBLIC_REPO_URL}/${clean.endsWith("/") ? "tree" : "blob"}/${commit}/${clean.replace(/\/$/, "")}`;
}
/** Split a sentence into text and repository-path pieces (for rendering the paths as pinned links). */
export function splitRepoPaths(input: string | null | undefined): { text: string; path: string | null }[] {
  // HB-143 (hourly run 12): the public current-status answer drops whole-path fields (withoutRepoPaths), so a caller may pass nothing
  const text = input ?? "";
  const out: { text: string; path: string | null }[] = [];
  let last = 0;
  for (const m of text.matchAll(REPO_PATH_RE)) {
    const p = m[0].replace(/[.,;:]+$/, "");
    if (m.index! > last) out.push({ text: text.slice(last, m.index), path: null });
    out.push({ text: p, path: p });
    last = m.index! + p.length;
  }
  if (last < text.length) out.push({ text: text.slice(last), path: null });
  return out;
}
