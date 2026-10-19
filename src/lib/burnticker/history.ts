import fs from "node:fs";
import path from "node:path";
import { CHANGELOG_FILE, INCIDENTS_FILE, loadTransparency } from "@/lib/burnticker/trust";
import { PUBLIC_REPO_URL } from "@/lib/burnticker/currentStatusLinks";
import { readStatusFile } from "@/lib/burnticker/deficitPrelaunch";
import { RELEASE_LINES } from "@/lib/burnticker/historyCopy";

/**
 * THE HISTORY PAGES' DATA (legitimacy pass, website-16, 2026-10-12): the changelog, the incident log, the reviews index and the receipt
 * the verify-it-yourself walk-through recomputes. Everything is read from the repository's own files at request time, so a page never
 * drifts from its file: docs/burnticker/CHANGELOG.md (every publish of the public repository), docs/burnticker/incidents/LOG.md,
 * config/burnticker/transparency.json (the reviews and the bounty) and the evidence rows under docs/burnkeeper/evidence. The sentences
 * live in historyCopy.ts.
 */

/** One publish of the public repository, as its CHANGELOG.md entry records it. */
export interface Release {
  date: string;
  /** the monorepo commit the public tree was cut from (12 hex) */
  source: string;
  /** the public repository's commit, when the changelog records it (an entry's own line, or the after-the-fact section) */
  publicCommit: string | null;
  publicUrl: string | null;
  programHash: string | null; idlSha: string | null; allowlistSha: string | null; files: number | null;
  /** plain lines, one per change against the release before it (historyCopy.ts RELEASE_LINES) */
  lines: string[];
}

const HEAD_RE = /^## (\d{4}-\d{2}-\d{2}) — publish from ([0-9a-f]{12})\s*$/;
const AFTER_RE = /^- publish from ([0-9a-f]{12}): public commit `([0-9a-f]{7,40})`\s*$/;
const field = (body: string, re: RegExp): string | null => re.exec(body)?.[1] ?? null;

/** Every publish entry of the changelog, oldest first (a stable sort by date keeps the file's order within a day). */
export function parseChangelog(md: string): Release[] {
  const lines = md.split("\n");
  const after = new Map<string, string>();
  for (const l of lines) { const m = AFTER_RE.exec(l); if (m) after.set(m[1], m[2]); }
  const raw: Omit<Release, "lines">[] = [];
  for (let i = 0; i < lines.length; i++) {
    const h = HEAD_RE.exec(lines[i]);
    if (!h) continue;
    let j = i + 1;
    while (j < lines.length && !lines[j].startsWith("## ")) j++;
    const body = lines.slice(i + 1, j).join("\n");
    const own = field(body, /^- public commit: `([0-9a-f]{7,40})`/m);
    const publicCommit = own ?? after.get(h[2]) ?? null;
    const files = field(body, /^- files published: (\d+)/m);
    raw.push({
      date: h[1], source: h[2], publicCommit, publicUrl: publicCommit ? `${PUBLIC_REPO_URL}/tree/${publicCommit}` : null,
      programHash: field(body, /^- program hash: `([0-9a-f]{64})`/m), idlSha: field(body, /^- IDL sha256[^`]*`([0-9a-f]{64})`/m),
      allowlistSha: field(body, /^- allowlist sha256[^`]*`([0-9a-f]{64})`/m), files: files === null ? null : Number(files),
    });
    i = j - 1;
  }
  const sorted = raw.map((r, k) => ({ r, k })).sort((a, b) => a.r.date.localeCompare(b.r.date) || a.k - b.k).map((x) => x.r);
  return sorted.map((r, k) => ({ ...r, lines: releaseLines(r, k === 0 ? null : sorted[k - 1]) }));
}

/** The plain lines for one release against the one before it. Facts from the two entries only. */
export function releaseLines(r: Omit<Release, "lines">, prev: Omit<Release, "lines"> | null): string[] {
  if (!prev) return [RELEASE_LINES.first, ...(r.files !== null ? [RELEASE_LINES.files(r.files, null)] : [])];
  const out: string[] = [];
  if (r.source === prev.source) out.push(RELEASE_LINES.sameSource);
  if (r.programHash && prev.programHash && r.programHash !== prev.programHash) out.push(RELEASE_LINES.program);
  if (!r.programHash) out.push(RELEASE_LINES.programNotRecorded);
  if (r.idlSha && prev.idlSha && r.idlSha !== prev.idlSha) out.push(RELEASE_LINES.idl);
  if (r.allowlistSha && prev.allowlistSha && r.allowlistSha !== prev.allowlistSha) out.push(RELEASE_LINES.allowlist);
  if (r.files !== null) out.push(RELEASE_LINES.files(r.files, prev.files));
  return out;
}

/**
 * REPUBLISHES SAID ONCE (walkthrough 13, 2026-10-14: the changelog repeated "The same source as the release before it was published
 * again." on entry after entry). Consecutive releases (oldest first, as parseChangelog returns them) that each republish the same source
 * collapse into one entry, the newest of the run (its date and public commit), whose line counts the run ("…, 3 times in a row."). Every
 * other release passes through unchanged, with `times` 1.
 */
export function collapseRepublishes(releases: readonly Release[]): (Release & { times: number })[] {
  const out: (Release & { times: number })[] = [];
  for (const r of releases) {
    const again = r.lines.includes(RELEASE_LINES.sameSource);
    const last = out[out.length - 1];
    if (again && last && last.source === r.source && last.lines.some((l) => l.startsWith(RELEASE_LINES.sameSource.slice(0, -1)))) {
      const times = last.times + 1;
      out[out.length - 1] = { ...r, times, lines: r.lines.map((l) => (l === RELEASE_LINES.sameSource ? RELEASE_LINES.sameSourceTimes(times) : l)) };
    } else out.push({ ...r, times: 1 });
  }
  return out;
}

/**
 * WHAT A VISITOR SEES OF A RELEASE (prelaunch audit 2026-10-18 A-6): its date, its public commit and its lines. The monorepo commit
 * (`source`) is how the changelog file keys a release; the changelog page, the trust API and the trust page's changelog text leave it
 * out. It is not secret everywhere (review 7): monorepo commits are also in verified-build.json's sourceCommit, in the well-known file's
 * trust.sourceCommit, and in the CHANGELOG.md the publish script copies into the public repository verbatim.
 */
export interface PublicRelease { date: string; publicCommit: string | null; publicUrl: string | null; lines: string[]; times?: number }
export const publicRelease = (r: Release & { times?: number }): PublicRelease => ({ date: r.date, publicCommit: r.publicCommit, publicUrl: r.publicUrl, lines: r.lines, ...(r.times !== undefined ? { times: r.times } : {}) });


export function readReleases(root = process.cwd()): Release[] | null {
  try { return parseChangelog(fs.readFileSync(path.join(root, CHANGELOG_FILE), "utf8")); } catch { return null; }
}

/** The first day releases are counted from (the first publish of the public repository). */
export const RELEASES_SINCE = "2026-10-10";

/** The home status line's dated counts: the reviews published and the releases since Oct 10. Null parts when a file cannot be read. */
export function historyCounts(root = process.cwd()): { reviews: number | null; releases: number | null } {
  let reviews: number | null = null;
  try { reviews = publishedReviews(root).length; } catch { reviews = null; }
  const rel = readReleases(root);
  return { reviews, releases: rel ? rel.filter((r) => r.date >= RELEASES_SINCE).length : null };
}

// ---- reviews (config/burnticker/transparency.json howBuilt.reviews; a review counts once its report file is in the repository) ----

export interface ReviewRow { id: string; reviewer: string; status: string; reportPath: string }
export function publishedReviews(root = process.cwd()): ReviewRow[] {
  const t = loadTransparency(root);
  return t.howBuilt.reviews.filter((r): r is typeof r & { reportPath: string } => !!r.reportPath && fs.existsSync(path.join(root, r.reportPath)))
    .map((r) => ({ id: r.id, reviewer: r.reviewer, status: r.status, reportPath: r.reportPath }));
}

// ---- the incident log (docs/burnticker/incidents/LOG.md): one "## " heading per incident ----

export interface IncidentEntry { heading: string; body: string }
export function readIncidentLog(root = process.cwd()): { entries: IncidentEntry[]; present: boolean } {
  const file = path.join(root, INCIDENTS_FILE);
  if (!fs.existsSync(file)) return { entries: [], present: false };
  const md = fs.readFileSync(file, "utf8");
  const parts = md.split(/^## /m).slice(1);
  return { present: true, entries: parts.map((p) => { const [h, ...rest] = p.split("\n"); return { heading: h.trim(), body: rest.join("\n").trim() }; }) };
}

// ---- the receipt the verify-it-yourself walk-through recomputes ----

interface EvidenceRow { recordDate: string; prevDate: string; prev: string; now: string; delta: string; units: number; status: string; memo: string; signature: string; txUrl: string; sourceUrl: string; pool: string; spent: string; got: string; burned: string; partial?: string | null; verify: { curl: string; expected: string } }

export interface VerifyReceipt {
  network: "mainnet" | "devnet"; rpcUrl: string; ticker: string; recordDate: string; prevDate: string;
  signature: string; explorerUrl: string; memo: string; memoBytes: number;
  prev: string; now: string; delta: string; units: number; unitSize: number;
  poolLamports: number; spentLamports: number; fraction: number; ruleSpendLamports: number | null; burned: string;
  treasuryCurl: string; capped: boolean; evidence: string;
}

const EVIDENCE_DIR = path.join("docs", "burnkeeper", "evidence");
/** The first confirmed mainnet receipt in the evidence folders (a folder whose name starts with "mainnet-" holding burns.json). */
function firstMainnetRow(root: string): { row: EvidenceRow; file: string } | null {
  let dirs: string[] = [];
  try { dirs = fs.readdirSync(path.join(root, EVIDENCE_DIR)).filter((d) => d.startsWith("mainnet-")).sort(); } catch { return null; }
  let best: { row: EvidenceRow; file: string } | null = null;
  for (const d of dirs) {
    const file = path.join(EVIDENCE_DIR, d, "burns.json");
    if (!fs.existsSync(path.join(root, file))) continue;
    try {
      const rows = JSON.parse(fs.readFileSync(path.join(root, file), "utf8")) as EvidenceRow[];
      for (const r of Array.isArray(rows) ? rows : []) if (r.status === "confirmed" && r.signature && (!best || r.recordDate < best.row.recordDate)) best = { row: r, file };
    } catch { /* an unreadable file is skipped */ }
  }
  return best;
}

/**
 * The receipt a stranger recomputes: the first mainnet receipt once one exists in the evidence, else the featured devnet receipt
 * (config/burnticker/current-status.json `demo`). Every value is read from the evidence row and the rules file it ran under.
 */
export function verifyReceipt(root = process.cwd()): VerifyReceipt {
  const st = readStatusFile(root);
  const main = firstMainnetRow(root);
  let row: EvidenceRow, file: string, network: "mainnet" | "devnet", rulesFile: string;
  if (main) { row = main.row; file = main.file; network = "mainnet"; rulesFile = st.deficit.rulesFile; }
  else {
    const rows = JSON.parse(fs.readFileSync(path.join(root, st.demo.evidence), "utf8")) as EvidenceRow[];
    const r = rows.find((x) => x.recordDate === st.demo.recordDate && x.status === "confirmed");
    if (!r) throw new Error(`${st.demo.evidence}: no confirmed receipt for ${st.demo.recordDate}`);
    row = r; file = st.demo.evidence; network = "devnet"; rulesFile = path.join("config", "burnkeeper", "deficit.devnet.rules.json");
  }
  const rules = JSON.parse(fs.readFileSync(path.join(root, rulesFile), "utf8")) as { buyback: { fractionPerUnit: string }; rule?: { unitUsd?: string } };
  const ruleSpend = /rule spend (\d+) lamports/.exec(row.verify.expected)?.[1];
  const poolLamports = Math.round(Number(row.pool) * 1e9), spentLamports = Math.round(Number(row.spent) * 1e9);
  const ruleSpendLamports = ruleSpend ? Number(ruleSpend) : null;
  return {
    network, rpcUrl: network === "mainnet" ? "https://api.mainnet-beta.solana.com" : "https://api.devnet.solana.com",
    ticker: st.demo.ticker, recordDate: row.recordDate, prevDate: row.prevDate, signature: row.signature, explorerUrl: row.txUrl,
    memo: row.memo, memoBytes: Buffer.byteLength(row.memo, "utf8"), prev: row.prev, now: row.now, delta: row.delta, units: row.units,
    unitSize: Number(rules.rule?.unitUsd ?? 1e9), poolLamports, spentLamports, fraction: Number(rules.buyback.fractionPerUnit), ruleSpendLamports,
    burned: row.burned, treasuryCurl: row.verify.curl, capped: ruleSpendLamports !== null && spentLamports < ruleSpendLamports, evidence: file,
  };
}

/** The exact commands and their expected output for one receipt (shown with copy buttons). */
export interface VerifyCommand { id: "tx" | "memo" | "treasury" | "units" | "spend"; command: string; expected: string }
export function verifyCommands(v: VerifyReceipt): VerifyCommand[] {
  const tx = `curl -s ${v.rpcUrl} -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"getTransaction","params":["${v.signature}",{"maxSupportedTransactionVersion":0}]}'`;
  const keep = Math.round((1 - v.fraction) * 1e6) / 1e6;
  return [
    { id: "tx", command: `${tx} | jq '.result.meta.err'`, expected: "null" },
    { id: "memo", command: `${tx} | jq -r '.result.meta.logMessages[] | select(startswith("Program log: Memo"))'`, expected: `Program log: Memo (len ${v.memoBytes}): "${v.memo}"` },
    { id: "treasury", command: `${v.treasuryCurl} | jq -r '.data[] | "\\(.record_date) \\(.tot_pub_debt_out_amt)"'`, expected: `${v.prevDate} ${v.prev}\n${v.recordDate} ${v.now}` },
    { id: "units", command: `echo '(${v.now} - ${v.prev}) / ${v.unitSize}' | bc`, expected: String(v.units) },
    { id: "spend", command: `awk 'BEGIN { printf "%.0f\\n", ${v.poolLamports} * (1 - ${keep}^${v.units}) }'`, expected: Math.round(v.poolLamports * (1 - Math.pow(keep, v.units))).toString() },
  ];
}
