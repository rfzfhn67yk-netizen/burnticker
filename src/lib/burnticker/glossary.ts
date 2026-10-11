/**
 * THE GLOSSARY AT FIRST USE (review 2 §2, 2026-10-11: a fan met burn, receipt, burn pool, attester, locked LP, Fee Key, graduation,
 * wind-down and keeper before any of them was explained). One short plain sentence per term — a tooltip or a one-line note where the term
 * first appears on the landing page, the coins page, the trust page and the pair pages — never a paragraph. Definitions describe the
 * current code, limits included; lint-clean (config/launch/copy-lint.json; test/burntickerReview2Ux.test.ts). Client-safe.
 */
export type TermId = "burn" | "receipt" | "burnPool" | "attester" | "lockedLp" | "feeKey" | "graduation" | "windDown" | "keeper";

export const GLOSSARY: Record<TermId, { term: string; short: string }> = {
  burn: { term: "burn", short: "A burn destroys tokens held by the program and lowers the coin's total supply; it never touches the tokens in your wallet." },
  receipt: { term: "receipt", short: "A receipt records the source result, the rule's calculation and the transaction; checking one can be complete, partial or unavailable." },
  burnPool: { term: "burn pool", short: "One coin's burn budget in SOL; nobody can withdraw it, and in a registered pair the other coin's share joins it when this coin's rule fires." },
  attester: { term: "reading signer (attester)", short: "A key that signs a reported source value; the signature proves who signed it, not that the value is true." },
  lockedLp: { term: "locked LP", short: "The trading pool's liquidity position, locked with Raydium's permanent lock so its principal cannot be withdrawn." },
  feeKey: { term: "Fee Key", short: "Raydium's record of the right to claim the locked position's trading fees, held by a program-controlled address." },
  graduation: { term: "moved to trading pool", short: "Graduation: the coin leaves its launch curve for an external trading pool; the lock and registration steps follow." },
  windDown: { term: "wind-down", short: "After a rule ends, scheduled burns spend down what is left in the burn pool before the coin retires; a retired coin's pool can still hold SOL." },
  keeper: { term: "automation", short: "The keeper: software that submits the program instructions that are due; the program can still refuse or defer each one." },
};

/** Beside every scoreboard: reading needs nothing. */
export const NO_WALLET_LINE = "No wallet is needed to read results or receipts.";

/** "burn — …; receipt — …" for a one-line note listing several terms. */
export const termLine = (ids: readonly TermId[]): string => ids.map((id) => `${GLOSSARY[id].term} — ${GLOSSARY[id].short}`).join(" · ");
