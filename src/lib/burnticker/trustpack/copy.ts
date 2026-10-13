/**
 * THE TRUST PACK'S VISIBLE WORDS (2026-10-10). Every sentence the three skeptic pages (/burnticker/check, /burnticker/fees/ledger,
 * /burnticker/operator) and the trust page's trust-pack section print that is not data lives here, so test/burntickerTrustPack.test.ts
 * runs the copy lint (config/launch/copy-lint.json, including no-prizes) over all of it. Facts and gaps only: no promises, no
 * future tense about what the platform does next, never the word "audit" for a review, and no venue named that the settlement rules
 * exclude. Text quoted from the Powers Registers is the program's own documentation and is rendered as data.
 */
import { operatorShareClause } from "@/lib/burnticker/feeShareLine";

export const CHECK_COPY = {
  title: "Check this yourself",
  intro: "Check the money flows, operator powers and a real burn receipt against the source records. Every line says where to look, so you never have to take our word for anything. The receipt verifier runs in your browser and asks the chain and the original data source directly.",
  moneyTitle: "Where money can go",
  moneyIntro: "This table lists every instruction in both programs and the only place each one can move SOL or tokens. Neither program has an instruction that withdraws, sweeps or sends funds out.",
  powersTitle: "Who can do what",
  powersIntro: "The Powers Registers are generated from the programs' own interface files. Under the current instruction permissions, no instruction in either program gives any key a power over funds. Upgrade authority is a separate power: the Squads vault can replace the program code.",
  lockedTitle: "What is locked",
  notDoneTitle: "What is not done yet",
  notDoneIntro: "These are the open gaps, stated plainly. Each one is also on the trust page and on the operator's to-do list (docs/burnticker/TODO-OWNER.md).",
  buildTitle: "Is the deployed code this code?",
  buildIntro: "For each program, this shows the hash of the code built from this repository next to the hash of the bytes deployed on chain.",
  verifierTitle: "Verify a receipt in your browser",
  verifierIntro: "Paste a receipt's transaction signature, or pick a devnet receipt. Your browser fetches the transaction and the program's accounts from the public Solana RPC, and the source values from the Treasury API. It then works out the units and the spend again on its own. Our server is asked for only two things: the sample list and the rules file, and the rules file's hash is checked against the chain.",
  verifierDemoIntro: "This is the featured devnet receipt from the rehearsal. Your browser checks it against the devnet chain and the Treasury API. The result comes first, then the three layers of evidence.",
  verifierCaveat: "A signature establishes who signed a reading, not that the value is true. The source check is what tests the value. A failed check and an unavailable check are different results: unavailable means something the check needed did not answer.",
  checkAnotherTitle: "Check another receipt: pick one, paste a signature, or choose your own RPC",
  verifierPrivacy: "Your browser sends requests only to the RPC endpoint shown and to api.fiscaldata.treasury.gov. Nothing is sent to Burnticker.",
  verifierScope: "This checks buyback receipts written by the program that records burns (memo v2). For receipts settled on other feeds, the source line says it cannot be checked here; the API's verify route covers them.",
  legend: "A ✓ means the check passed. A ✗ means it failed, so the receipt is wrong. A – means it cannot be checked here, and the reason is shown.",
} as const;

export const LEDGER_COPY = {
  title: "Fee ledger",
  // review 2 §2 (2026-10-11): no universal provenance claim — the wallet blocks are chain reads, the LP-fee block is the keeper's records
  // and the expenses are operator-entered; each block names its own source.
  intro: "This page lists every lamport the developer fee wallet received or sent, grouped by month, next to what the fee pays for. Each block names where its data comes from: chain reads, the keeper's records, or values the operator entered.",
  walletLine: "The developer fee wallet set in the platform config is",
  incomeTitle: "Received each month (from chain)",
  entriesTitle: "Every transaction (from chain)",
  expensesTitle: "What the fee pays for",
  expensesSource: "These amounts are operator-entered: the operator typed them into config/burnticker/expenses.json. An amount that is not known yet says so.",
  placeholder: "not supplied", // private review 8: never the raw TODO_EXPENSE_* token
  oneOff: "one-off",
  unavailable: "The chain could not be read from this site just now. The wallet blocks are never filled in from other records instead.",
  regenerated: "This ledger is rebuilt from the chain once a month by the keeper host, or on request. When no published copy is less than an hour old, the API reads the chain directly.",
  devnetNote: "The platform runs on devnet today, so this is the devnet wallet. All of its income comes from rehearsal trading.",
} as const;

/** The one operator line (the owner, 2026-10-09; re-exported by src/lib/burnticker/fees.ts). */
export const OPERATOR_LINE = "Operated by one independent operator (United States) — contact: contact@burnticker.com";

export const OPERATOR_COPY = {
  title: "Who runs this",
  intro: "This page says who runs Burnticker, lists every wallet the operator holds for the platform, and shows the checks that hold those wallets to the rules.",
  entityTitle: "Legal entity",
  walletsTitle: "Operator wallets",
  walletsIntro: "Only public keys are shown, each with where it comes from. The devnet keys are copied from the rehearsal records. The mainnet keys are the addresses the operator set up.",
  /** under the mainnet table: what the developer fee wallet receives (the table cell names the role only) */
  devFeeNote: `The developer fee wallet is also the operator treasury. It receives the 0.25% fee on curve trades, the launch fees, and, after a coin graduates, ${operatorShareClause()}.`,
  signedTitle: "Signed statement",
  signedPending: "The developer fee wallet listed above is the one that signs it. The text to sign is below.",
  neverBuysTitle: "Never buys a platform coin",
  neverBuysIntro: "A monitor checks the operator wallets against one rule.",
  neverBuysNotRun: "Once it runs, its report is listed here.",
  crossLinksTitle: "The same facts in machine-readable form",
  crossLinksIntro: "Wallets, explorers and anyone else can check that the site, the code and the accounts belong together. The same facts are in one file:",
  placeholdersTitle: "What is not decided yet",
} as const;

/**
 * Each TODO_ placeholder the operator page lists, as a sentence (website-9: a reader never sees a token). The placeholders stay
 * TODO_ values in the config files so docs/burnticker/TODO-OWNER.md and its test can track them.
 */
export const PLACEHOLDER_SENTENCES: Record<string, string> = {
  TODO_ENTITY: "Whether to form a legal entity is not decided yet.",
  TODO_GITHUB_ORG: "The code has no GitHub organization yet.",
  TODO_THIRD_SIGNER_NAME: "The third Squads signer is not named yet.",
  TODO_SIGNED_MESSAGE: "The operator statement is not signed yet.",
};
export const placeholderSentence = (token: string): string => PLACEHOLDER_SENTENCES[token] ?? "One more value is not decided yet.";

export const TRUSTPACK_SECTION_COPY = {
  title: "Check it yourself",
  intro: "These three pages read only public files and the chain.",
  bountyTitle: "Bounty wallet",
  bountyTodo: "The bounty wallet is not set up on this site. The terms are in SECURITY.md.",
  bountyReports: "Paid and rejected reports are listed in SECURITY.md, and here once decided. There are none yet.",
} as const;

/** Status words for the never-buys monitor (one line on the operator page and the trust page). */
export const NEVER_BUYS_STATUS = {
  clear: "Clear. No operator wallet holds or has received a platform coin.",
  explained: "Rehearsal only. The operator wallets received devnet test coins only in rehearsal transactions, each recorded in the evidence files listed below.",
  red: "Red. An operator wallet received a platform coin outside any recorded rehearsal. See the list below.",
  notRun: "The monitor has not run on this site yet.",
} as const;

/** Every string above, for the lint. */
export const ALL_TRUSTPACK_COPY: string[] = [CHECK_COPY, LEDGER_COPY, OPERATOR_COPY, PLACEHOLDER_SENTENCES, TRUSTPACK_SECTION_COPY, NEVER_BUYS_STATUS].flatMap((o) => Object.values(o));
