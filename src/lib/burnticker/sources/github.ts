import type { HttpSourceConfig } from "@/lib/burnticker/sources/attestedHttp";
import { fitName } from "@/lib/burnticker/launchFields";

/**
 * GITHUB RELEASES AND STAR MILESTONES (sources-2, 2026-10-12). GitHub's REST API, keyless (60 requests an hour) or with the owner's
 * token in BURNTICKER_GITHUB_TOKEN (5,000 an hour; sent as a bearer header, never stored or logged). Only public repository metadata
 * is read: release publish times and the star count. No user, stargazer or contributor data is ever read. The generic attested-http
 * engine reads both series from their sources.json entries; this module holds the parameters and the coin text.
 *
 *   github.releases:<owner>/<repo>        one reading per UTC day: releases GitHub lists as published that day that are neither drafts
 *                                         nor marked pre-release; days without one read 0. "burns when <repo> ships a release".
 *   github.milestone:<owner>/<repo>.<N>   ONE reading, the first time the keeper reads a star count at or above N (id reached-<N>,
 *                                         value 1). A one-shot (rules.ts isOneShot): the coin resolves once and winds down. The day is
 *                                         the day the keeper first read it, not the day the count crossed N (GitHub gives no history).
 *
 * How it fails: a 403 or 429 when the hourly limit is used up, a 404 for a renamed or private repository, or a body without the field
 * raises or refuses; the keeper writes nothing and retries with backoff. A repository that is not there is never a zero.
 */

export const GITHUB_RELEASES_ID = "github.releases", GITHUB_MILESTONE_ID = "github.milestone";
const REPO = /^([A-Za-z0-9_.-]{1,39})\/([A-Za-z0-9_.-]{1,100})$/;
/** Star milestones a coin may name: 100 to 10,000,000. */
export const GITHUB_MILESTONE_BOUNDS = { min: 100, max: 10_000_000 } as const;
export const githubReleasesSeries = (repo: string): string => `${GITHUB_RELEASES_ID}:${repo}`;
export const githubMilestoneSeries = (repo: string, n: number): string => `${GITHUB_MILESTONE_ID}:${repo}.${n}`;
export function parseGithubSeries(id: string): { kind: "releases"; repo: string } | { kind: "milestone"; repo: string; n: number } | null {
  let m = /^github\.releases:(.+)$/.exec(id);
  if (m) return REPO.test(m[1]) ? { kind: "releases", repo: m[1] } : null;
  m = /^github\.milestone:(.+)\.(\d{3,8})$/.exec(id);
  if (!m || !REPO.test(m[1])) return null;
  const n = Number(m[2]);
  return n >= GITHUB_MILESTONE_BOUNDS.min && n <= GITHUB_MILESTONE_BOUNDS.max ? { kind: "milestone", repo: m[1], n } : null;
}

const repoUrl = (u: string, repo: string) => { const [o, r] = repo.split("/"); return u.split("{owner}").join(encodeURIComponent(o)).split("{repo}").join(encodeURIComponent(r)); };
/** The catalogue's parameter hook for github.releases. */
export function applyGithubReleases(cfg: HttpSourceConfig, param: string): HttpSourceConfig {
  if (!REPO.test(param)) throw new Error(`github.releases: ${param} is not <owner>/<repo>`);
  return { ...cfg, request: { ...cfg.request, url: repoUrl(cfg.request.url, param) }, sourceUrl: repoUrl(cfg.sourceUrl, param), title: `Releases of ${param} (GitHub)`, memoSource: `${cfg.memoSource} ${param}`.slice(0, 80) };
}
/** The catalogue's parameter hook for github.milestone: the repository into the URL, N into the milestone. */
export function applyGithubMilestone(cfg: HttpSourceConfig, param: string): HttpSourceConfig {
  const s = parseGithubSeries(`${GITHUB_MILESTONE_ID}:${param}`);
  if (!s || s.kind !== "milestone") throw new Error(`github.milestone: ${param} is not <owner>/<repo>.<N> with N from ${GITHUB_MILESTONE_BOUNDS.min} to ${GITHUB_MILESTONE_BOUNDS.max}`);
  return { ...cfg, request: { ...cfg.request, url: repoUrl(cfg.request.url, s.repo) }, sourceUrl: repoUrl(cfg.sourceUrl, s.repo), title: `${s.repo} passes ${s.n.toLocaleString("en-US")} stars (GitHub)`, select: { ...cfg.select, milestone: { ...cfg.select.milestone!, at: s.n } }, memoSource: `${cfg.memoSource} ${s.repo}`.slice(0, 80) };
}
/** A milestone the repository has already passed would burn on the first read: the review refuses it. */
export function milestoneProblem(current: number | null, n: number): string | null {
  if (current === null) return "The current count could not be read, so the milestone cannot be checked.";
  return current >= n ? `The repository already has ${current.toLocaleString("en-US")} stars, so a milestone of ${n.toLocaleString("en-US")} has already passed.` : null;
}

/** The coin text pieces (lint-clean; test/burntickerSources2.test.ts lints every variant). */
export function githubText(s: NonNullable<ReturnType<typeof parseGithubSeries>>, spends: string, inverse: boolean): { name: string; ticker: string; oneLiner: string; block: string; oneShot: boolean } {
  const name = s.repo.split("/")[1];
  if (s.kind === "releases") {
    const src = "The result comes from GitHub's public list of the repository's releases. Drafts and releases marked as pre-releases do not count, and each UTC day is read once it is over.";
    if (inverse) return { name: fitName(`${name} Quiet Days`), ticker: `NOREL${name.toUpperCase().replace(/[^A-Z0-9]/g, "")}`.slice(0, 10), oneLiner: `burns on every day the ${s.repo} repository publishes no release`, oneShot: false,
      block: `For every day the ${s.repo} repository publishes no release, ${spends}, with a receipt on chain. ${src} A day with a release burns nothing.` };
    return { name: fitName(`${name} Releases`), ticker: `${name.toUpperCase().replace(/[^A-Z0-9]/g, "")}REL`.slice(0, 10), oneLiner: `burns when the ${s.repo} repository ships a release`, oneShot: false,
      block: `For every release the ${s.repo} repository publishes, ${spends}, with a receipt on chain. ${src} A day with no release burns nothing.` };
  }
  const n = s.n.toLocaleString("en-US");
  return { name: fitName(`${name} ${n} Stars`), ticker: `${name.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6)}STAR`, oneLiner: `burns once when the ${s.repo} repository passes ${n} stars`, oneShot: true,
    block: `The first time the star count of the ${s.repo} repository reads ${n} or more, ${spends} once, with a receipt on chain. The count comes from GitHub's public repository data, read a few times a day. If the count stays under ${n}, nothing burns.` };
}
