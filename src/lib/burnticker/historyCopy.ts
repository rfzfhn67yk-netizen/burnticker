
/**
 * THE WORDS OF THE HISTORY PAGES (legitimacy pass, website-16, 2026-10-12): the changelog, the incident log, the bounty,
 * the verify-it-yourself walk-through and the "History" page that gathers them. Plain English, US spelling, no price talk,
 * no promised dates; every sentence here passes the copy lint and test/burntickerPlainCopy.test.ts (this module is in its list). The
 * numbers on these pages are read from the repository's files by history.ts, never typed here.
 */

/** The plain line per change between two releases (history.ts releaseLines). */
export const RELEASE_LINES = {
  first: "The first public release of the repository.",
  sameSource: "The same source as the release before it was published again.",
  /** walkthrough 13 (2026-10-14): a run of republishes of one source, said once on one entry (history.ts collapseRepublishes) */
  sameSourceTimes: (n: number): string => (n <= 1 ? "The same source as the release before it was published again." : `The same source as the release before it was published again, ${n} times in a row.`),
  program: "The burn program's build changed.",
  // HB-110 (hourly run 8): an entry with no program hash is a release that did not rebuild the programs (the build JSON lists both builds)
  programNotRecorded: "This release did not rebuild the programs.",
  idl: "The program's interface file changed.",
  allowlist: "The list of files allowed into the public repository changed.",
  files: (n: number, prev: number | null): string => {
    const files = `${n.toLocaleString("en-US")} ${n === 1 ? "file was" : "files were"} published`;
    if (prev === null) return `${files}.`;
    const d = n - prev;
    return d === 0 ? `${files}, the same number as the release before.` : `${files}, ${Math.abs(d).toLocaleString("en-US")} ${d > 0 ? "more" : "fewer"} than the release before.`;
  },
};

export const CHANGELOG_COPY = {
  title: "Changelog",
  description: "Every public release of Burnticker's source code, newest first, each linked to the public repository at that commit.",
  intro: "Every time the source code is published to the public repository, the publish script adds an entry to the changelog file. This page reads the published changelog file.",
  sinceLine: (n: number, since: string): string => `There ${n === 1 ? "has been 1 release" : `have been ${n.toLocaleString("en-US")} releases`} since ${since}.`,
  publicLink: "Open the public repository at this commit",
  // A-6: a release is named by its public commit only; the monorepo commit it was cut from is private and never shown
  noPublic: "This release was published before the changelog named public commits, so it has no link.",
  unavailable: "The changelog file could not be read on this site just now.",
  fileLine: "The file behind this page is",
};

export const INCIDENTS_COPY = {
  title: "Incident log",
  description: "Every incident recorded in Burnticker's append-only incident log, and the problems caught before they affected anyone.",
  intro: "An incident is anything that went wrong in production, such as a wrong burn, a missed burn, a failed public audit or an exposed key. The policy says what counts and how each one is written up.",
  none: "No incidents are recorded.",
  noneMore: "The log is append-only. An entry is never edited after the fact, and a correction is a new entry that names the one it corrects.",
  recordedTitle: "Recorded incidents",
  caughtTitle: "Caught before it mattered",
  caughtIntro: "These problems were found before any coin depended on the part that failed. Nothing was signed, sent or burned because of them. They are listed so the record is complete.",
  whatHappened: "What happened",
  whatWasDone: "What was done",
  policyLink: "Read the incident policy",
  logLink: "Read the log file",
  /** HB-46 residue: a caught-early entry links its source notes in the public repository; the path is never shown */
  sourceLink: "Read the notes this comes from",
  statusLink: "See the status page",
  unavailable: "The incident log could not be read on this site just now.",
};

/** The pre-launch catches (sources: docs/burnticker/OPS-EDGE.md section 1, the "burnticker status chain" commit of 2026-10-12). */
export const CAUGHT_EARLY: { id: string; date: string; title: string; happened: string; done: string; source: string }[] = [
  {
    id: "keeper-restart-loop", date: "2026-10-12", title: "A keeper kept restarting",
    happened: "After the switch to mainnet on Oct 11, a keeper on the host refused to start without the setting that allows mainnet sends, and the host's service manager restarted it again and again. It stopped before its first cycle each time, so it never signed or sent anything.",
    done: "The cause was written up with the two ways out: stop the service, or start it with the mainnet setting when the run sheet calls for it. The keeper's own refusal is the safety check working as designed.",
    source: "docs/burnticker/OPS-EDGE.md",
  },
  {
    id: "status-file-404", date: "2026-10-12", title: "The status page could not find its data file",
    happened: "The status page loaded, but its data file returned a not-found error. The keeper that writes the file was not running, and a failed copy on the host could also have been hidden, because the publish step reported success even when a copy failed.",
    done: "The publish step now fails when a copy fails and refuses to run as the root user. A check logs a line when the keeper's file goes missing or stale and another when it is back, and a probe script walks every link from the keeper to the page.",
    source: "docs/burnticker/OPS-EDGE.md",
  },
];

/** The address security reports go to (SECURITY.md, transparency.json howBuilt.bounty.contact, site/burnticker/.well-known/security.txt). */
export const SECURITY_CONTACT = "security@burnticker.com";

export const BOUNTY_COPY = {
  title: "Security bounty",
  description: "How to report a security problem in Burnticker, what is in scope, the bounty wallet and its balance, and every decided report.",
  intro: "If you find a way to break Burnticker's programs, its keeper or this site, please report it privately. A valid report can be paid from the bounty wallet.",
  draft: "The terms in SECURITY.md are still a draft, and the exact amount for each severity is not final.",
  // prelaunch audit 2026-10-18 A-30: "5 to 10 SOL for each valid report" read as money on hand while 5 SOL was funded in all
  range: (lo: number, hi: number, funded: number | null = null): string => `The draft terms set aside ${lo} to ${hi} SOL for each valid report, paid from the developer fee.${funded ? ` The bounty wallet was funded with ${funded} SOL in all, so today it can pay one report at the low end. It grows from the developer fee.` : ""}`,
  walletTitle: "The bounty wallet",
  walletLine: "This mainnet wallet is held by the operator and is separate from the Squads vault.",
  balance: "Balance read from a mainnet node",
  balanceUnavailable: "The balance could not be read just now.",
  funding: "Recorded funding",
  paidRule: "Each payment is a plain transfer from the bounty wallet to the address the reporter names, and its transaction is posted in the report's thread.",
  scopeTitle: "In scope",
  scope: [
    "The burn program: any way to move SOL or tokens other than buying the coin and burning it, to store a reading without the required signatures, or to change a rule, a reading or a receipt after the fact.",
    "The pair program: any way to move a pair's SOL or tokens other than by its formula to the recorded recipients, or a privileged signer after the pair is set up.",
    "The keeper and the site's code: signing something the program should refuse, a market quote reaching a rule, a void or unsettled market leading to a burn, or the audit or the receipt checker passing a receipt that does not match.",
    "The site's API: a request from another site changing anything, or a route leaking a value it says it never reads.",
    "The publishing scripts: a way to put a file in the public repository that the list of allowed files does not name.",
  ],
  outTitle: "Out of scope",
  out: [
    "Raydium, Jupiter, Polymarket, Pyth, RedStone, Reclaim and Solana themselves. Please report to them, and tell us too.",
    "Denial of service against the keeper or the site, and social engineering.",
    "Findings that need a stolen operator key. The powers register already says what that key can do.",
    "How any coin trades.",
  ],
  historyTitle: "Decided reports",
  none: "No payouts yet.",
  noneMore: "Each report is listed here once it is decided. A paid report shows its transaction, and a rejected report shows the reason.",
  howTitle: "How to report",
  how: [
    "Write to the address below with the steps to reproduce the problem, what it affects, and the address you want to be paid at.",
    "Please report privately first. We do not take legal action against good-faith research that respects people's funds and data.",
    "Once it is safe to do so, the fix, or the reason for not fixing it, is published in the public repository.",
  ],
  termsLink: "Read SECURITY.md",
};

export const VERIFY_YOURSELF_COPY = {
  title: "Verify a receipt yourself",
  description: "Recompute one real Burnticker receipt in a terminal: fetch the transaction, read its memo, fetch the two Treasury rows, do the arithmetic and compare.",
  intro: "You do not need this site to check a burn. These commands fetch the transaction from a public Solana node and the source rows from the U.S. Treasury, then redo the arithmetic. Each one shows the output to expect.",
  needs: "You need a terminal with curl, jq, bc and awk. Nothing here signs anything or needs a wallet.",
  devnet: "This is the featured receipt from the practice run on devnet, where tokens have no money value. No mainnet burn has executed yet. This page switches to the first mainnet receipt once one exists in the evidence files.",
  mainnet: "This is the first receipt on mainnet, read from the evidence files.",
  steps: {
    tx: { title: "Fetch the transaction and check that it succeeded", text: "An empty error means the transaction succeeded." },
    memo: { title: "Read the memo", text: "The program writes the receipt into the transaction as a memo. It carries the day, both source figures, the units, the burn pool, what was spent and what was burned." },
    treasury: { title: "Fetch the two Treasury rows", text: "The rule reads the total public debt for the day and the business day before it." },
    units: { title: "Work out the units", text: "One unit for each full step of the rule, here each full $1 billion of increase." },
    spend: { title: "Work out what the rule asked to spend, in lamports", text: "The rule spends a share of the burn pool for each unit, compounded. One SOL is a billion lamports." },
  },
  expected: "Expected output",
  copy: "Copy",
  copied: "Copied",
  compareTitle: "Compare",
  compare: [
    "The units and the two figures in the memo match what you fetched.",
    "The rule's amount matches the receipt's rule spend.",
  ],
  capped: "The program spent less than the rule asked, because one burn may spend at most a set share of the trading pool's SOL. The rest carried into the next burn, and the receipt says so.",
  browserTitle: "Or check it in your browser",
  browser: "The receipt checker runs the same steps in your browser with one click.",
  browserLink: "Check this receipt in your browser",
  evidence: "The values on this page are read from",
  unavailable: "The receipt could not be read on this site just now. The check page can still verify it in your browser.",
};

export const HISTORY_COPY = {
  title: "History",
  description: "Burnticker's release history, incident log and bounty in one place.",
  intro: "The record of how this was built and run, kept in the public repository and shown here.",
  links: [
    { href: "/burnticker/changelog", label: "Changelog", text: "Every public release of the source code." },
    { href: "/burnticker/incidents", label: "Incident log", text: "Every recorded incident, and the problems caught before they mattered." },
    { href: "/burnticker/bounty", label: "Security bounty", text: "How to report a problem, the wallet and every decided report." },
    { href: "/burnticker/verify-yourself", label: "Verify a receipt yourself", text: "Recompute a real receipt in a terminal." },
    // owner decision 2026-10-12: the devnet practice coins left the public pages; their one page is linked here and from the Trust page
    { href: "/burnticker/devnet", label: "Devnet practice runs", text: "The test coins and burns from the practice runs on devnet." },
  ],
  /** the Trust page's one link and the latest releases under How this was built */
  trustLink: "History",
  trustLatest: "The latest releases",
};

/**
 * The home status line's dated count (home.ts homeStatusLine): "There have been 69 releases since Oct 10." Owner decision 2026-10-22: the
 * site no longer counts or lists reviews, so the line carries the release count only. Null when the changelog cannot be read.
 */
export function historyCountsLine(c: { releases: number | null }): string | null {
  if (c.releases === null) return null;
  return c.releases === 1 ? "There has been 1 release since Oct 10." : `There have been ${c.releases} releases since Oct 10.`;
}
