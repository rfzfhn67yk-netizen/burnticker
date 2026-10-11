/**
 * THE TRUST PACK'S VISIBLE WORDS (2026-10-10). Every sentence the three sceptic pages (/burnticker/check, /burnticker/fees/ledger,
 * /burnticker/operator) and the trust page's trust-pack section print that is not data lives here, so test/burntickerTrustPack.test.ts
 * runs the copy lint (config/launch/copy-lint.json, including no-prizes) over all of it. Facts and gaps only: no promises, no
 * future tense about what the platform does next, never the word "audit" for a review, and no venue named that the settlement rules
 * exclude. Text quoted from the Powers Registers is the program's own documentation and is rendered as data.
 */

export const CHECK_COPY = {
  title: "Check this yourself",
  intro: "A sceptic's checklist against ourselves. Every line names where to look; nothing here asks you to take our word. The receipt verifier at the bottom runs in your browser and asks the chain and the original data source directly.",
  moneyTitle: "Where money can go",
  moneyIntro: "Every instruction of both programs, with the only place it can move SOL or tokens. There is no withdraw, sweep or transfer-out instruction in either program.",
  powersTitle: "Who can do what",
  powersIntro: "The Powers Registers are generated from the programs' own interface files. No key holds a power over funds in either program.",
  lockedTitle: "What is locked",
  notDoneTitle: "What is not done yet",
  notDoneIntro: "Open gaps, stated plainly. Each one is also on the trust page and in docs/burnticker/TODO-OWNER.md.",
  buildTitle: "Is the deployed code this code?",
  buildIntro: "The executable hash of each program, built from this repository, next to the hash of the bytes deployed on chain.",
  verifierTitle: "Verify a receipt in your browser",
  verifierIntro: "Paste a receipt's transaction signature or pick a devnet receipt. Your browser fetches the transaction and the program's accounts from the public Solana RPC and the source values from the Treasury API, then recomputes the units and the spend. Our server is not asked for any of it except the sample list and the rules file, whose hash is checked against the chain.",
  verifierPrivacy: "Requests go from your browser to the RPC endpoint shown and to api.fiscaldata.treasury.gov. Nothing is sent to Burnticker.",
  verifierScope: "Checks buyback receipts written by the burn program (memo v2). Receipts settled on other feeds show the source line as not checkable here; the API's verify route covers them.",
  legend: "✓ passed · ✗ failed (the receipt is wrong) · – not checkable here (with the reason)",
} as const;

export const LEDGER_COPY = {
  title: "Fee ledger",
  intro: "Every lamport the developer fee wallet received or sent, read from the chain and grouped by month, next to what the fee pays for. Nothing on this page comes from our own records.",
  walletLine: "Developer fee wallet, pinned in the platform config:",
  incomeTitle: "Received, by month (from chain)",
  entriesTitle: "Every transaction",
  expensesTitle: "What the fee pays for",
  placeholder: "amount not given yet",
  oneOff: "one-off",
  unavailable: "The chain could not be read from this host just now; the ledger is never filled from our own records instead.",
  regenerated: "Regenerated from chain by scripts/burnticker-trustpack.mts fees-ledger (monthly by the keeper host, or on request); the API reads the chain directly when no published copy is newer than an hour.",
  devnetNote: "Devnet: the platform runs on devnet today, so this is the devnet wallet. Its income is rehearsal trading only.",
} as const;

export const OPERATOR_COPY = {
  title: "Operator",
  intro: "Who runs this, every wallet the operator holds for the platform, and the checks that hold those wallets to the rules.",
  entityTitle: "Entity",
  walletsTitle: "Operator wallets",
  walletsIntro: "Public keys only, copied from the rehearsal records named beside each one. Mainnet wallets are listed as TODO until they exist.",
  signedTitle: "Signed statement",
  signedPending: "Not signed yet: the statement is signed by the mainnet developer fee wallet, which does not exist yet. The text to be signed is below, and the verification code is live: once a signature is added, this line shows ✓ or ✗.",
  neverBuysTitle: "Never buys a platform coin",
  neverBuysIntro: "A monitor over the operator wallets: every token account they hold, and every recent transaction in which one of them received a platform coin.",
  neverBuysNotRun: "The monitor has not run on this host yet (scripts/burnticker-trustpack.mts never-buys).",
  crossLinksTitle: "Cross-links",
  crossLinksIntro: "The same facts in machine-readable form for wallets, explorers and anyone checking that the site, the code and the accounts belong together:",
} as const;

export const TRUSTPACK_SECTION_COPY = {
  title: "Check it yourself",
  intro: "Three pages that read only public files and the chain:",
  bountyTitle: "Bounty wallet",
  bountyTodo: "not created yet (TODO_BOUNTY_WALLET): it is the mainnet Squads vault, funded with 5–10 SOL from the developer fee once created. Terms: SECURITY.md.",
  bountyReports: "Paid and rejected reports are listed in SECURITY.md and here once decided. None yet.",
} as const;

/** Status words for the never-buys monitor (one line on the operator page and the trust page). */
export const NEVER_BUYS_STATUS = {
  clear: "clear: no operator wallet holds or received a platform coin",
  explained: "rehearsal only: the operator wallets received devnet test coins only in rehearsal transactions recorded in the evidence files listed below",
  red: "RED: an operator wallet received a platform coin outside any recorded rehearsal; see the list below",
  notRun: "not run on this host yet",
} as const;

/** Every string above, for the lint. */
export const ALL_TRUSTPACK_COPY: string[] = [CHECK_COPY, LEDGER_COPY, OPERATOR_COPY, TRUSTPACK_SECTION_COPY, NEVER_BUYS_STATUS].flatMap((o) => Object.values(o));
