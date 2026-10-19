/**
 * A COIN THAT BURNS ANOTHER TOKEN (round 5, owner 2026-10-13: "is there another example where we can make the actual wif and bonk coins
 * burn?" → "build it"). The site's half: the rule field, the shape check, the admission verdict in plain words, and every sentence the
 * launch review, the trust page, the Coin vs Coin tile and the receipts page show. The program half is
 * programs/burn-receipts/.../instructions/burn_target.rs; the chain reads are src/lib/burnReceipts/burnTarget.ts.
 *
 * A burn target is pinned BEFORE the coin exists (pin_burn_target, signed with the coin's mint key while its mint account is still
 * empty), so nobody ever holds a coin whose target changes. The target token never changes; only the pool it is swapped on can be
 * re-pinned (the admin proposes, 48 hours wait, any attester can veto, the new pool passes the same checks).
 *
 * COPY RULES: no "buy", "price", "will", dates or "coming soon" (config/launch/copy-lint.json + the owner's plain-English rule): the
 * coin "swaps SOL for BONK and burns it".
 */

/**
 * The hashed rule field (rules.ts BurnRule.burnTarget): the target mint, its pool against SOL (Raydium CPMM or AMM v4), its ticker and
 * its Pyth price feed id (Crypto.<TICKER>/USD, 64 hex characters: the price the program checks every burn against).
 */
export interface BurnTargetField {
  mint: string;
  pool: string;
  symbol: string;
  feedId: string;
}

const BASE58_KEY = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SYMBOL = /^[A-Z0-9]{1,10}$/;
const WSOL = "So11111111111111111111111111111111111111112";

/** The rule field's shape (the chain checks come from admission). Empty = fine. */
export function burnTargetShapeProblems(t: unknown): string[] {
  const p: string[] = [];
  if (!t || typeof t !== "object") return ["burnTarget must be { mint, pool, symbol }"];
  const o = t as Record<string, unknown>;
  if (typeof o.mint !== "string" || !BASE58_KEY.test(o.mint)) p.push("burnTarget.mint must be a base58 address");
  if (typeof o.pool !== "string" || !BASE58_KEY.test(o.pool)) p.push("burnTarget.pool must be a base58 address");
  if (typeof o.symbol !== "string" || !SYMBOL.test(o.symbol)) p.push("burnTarget.symbol must be 1–10 capital letters or digits");
  if (typeof o.feedId !== "string" || !/^[0-9a-f]{64}$/.test(o.feedId) || /^0+$/.test(o.feedId)) p.push("burnTarget.feedId must be the Pyth feed id, 64 lowercase hex characters");
  if (typeof o.mint === "string" && o.mint === WSOL) p.push("burnTarget.mint cannot be SOL itself");
  if (typeof o.mint === "string" && o.mint === o.pool) p.push("burnTarget.pool must be the pool, not the mint");
  for (const k of Object.keys(o)) if (!["mint", "pool", "symbol", "feedId"].includes(k)) p.push(`burnTarget.${k} is not a known key`);
  return p;
}

/**
 * Tokens the create screen offers as "Burn the real <symbol>" (mainnet mints). The POOL is never hard-coded: the launch review reads the
 * pool the creator picks from chain and runs the program's admission on it (GET /api/burnticker/burn-target), and the pin records
 * exactly that pool. A token here is only a suggestion; anything that passes admission can be a target.
 */
export const SUGGESTED_TARGETS: readonly { symbol: string; mint: string; name: string; feedId: string }[] = [
  { symbol: "WIF", mint: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm", name: "dogwifhat", feedId: "4ca4beeca86f0d164160323817a4e42b10010a724c2217c6ee41b54cd4cc61fc" },
  { symbol: "BONK", mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", name: "Bonk", feedId: "72b021217ca3fe68922a19aaf990109cb9d84e9ad004b4d2025ad6f529314419" },
];

// ---------------------------------------------------------------------------------------------------------------------------------
// Sentences (every one passes the copy lint: test/burntickerBurnTarget.test.ts)
// ---------------------------------------------------------------------------------------------------------------------------------

const cash = (t: string) => `$${t}`;

/** The Coin vs Coin tile's per-side choice. */
export const targetChoiceLabel = (symbol: string): string => `Burn the real ${symbol}`;

/** What one burn does, in one line. */
export const targetActionSentence = (symbol: string): string => `Each burn swaps SOL from this coin's burn pool for ${symbol} and burns it.`;

/**
 * The launch review's sentence. `daysOf` names the side's days in a Coin vs Coin race (e.g. "BONK's"), else the coin burns the target on
 * every burn.
 */
export function targetReviewSentence(o: { ticker: string; symbol: string; daysOf?: string | null }): string {
  const when = o.daysOf ? ` on ${o.daysOf} days` : "";
  return `${cash(o.ticker)} burns real ${o.symbol}${when}, from its own burn pool; ${o.symbol}'s pool on Raydium is not ours and is not locked.`;
}

/** The trust page's "what a target burn can and cannot do". */
export function targetTrustCopy(symbol: string): { can: string[]; cannot: string[] } {
  return {
    can: [
      `Swap SOL from this coin's burn pool for ${symbol} on one pinned Raydium pool, and burn every ${symbol} it receives in the same step.`,
      "Spend at most 2% of that pool's SOL in one step, so one burn moves that pool only a little; the rest waits for the next step.",
      `Write a receipt for every step that names ${symbol}'s mint and the amount burned.`,
      "Hold the SOL, untouched, while the pinned pool is gone, switched off or holds less SOL than the minimum such a pool needs.",
      "Move to another pool for the same token, only after a public 48-hour wait that any attester can stop.",
    ],
    cannot: [
      `Change ${symbol} for another token. The token it burns is fixed before the coin exists.`,
      "Use any pool other than the pinned one.",
      "Send the SOL or the burned tokens anywhere else. There is no withdraw step.",
      `Lock ${symbol}'s pool. It belongs to its own liquidity providers, who can add or remove liquidity whenever they like.`,
      `Make ${symbol} go up, or promise anything about it.`,
    ],
  };
}

/**
 * The receipts page's line for one target burn: "burned 1,234 real BONK". (The brief's "(target)" wording trips the copy lint's
 * price-target rule, which bans the word "target" in any user-facing sentence; "real" carries the same meaning.) `amount` is the memo's
 * token amount ("1234.5").
 */
export function targetReceiptLine(amount: string, symbol: string): string {
  const [whole, frac] = amount.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `burned ${frac ? `${grouped}.${frac}` : grouped} real ${symbol}`;
}

/** Admission problems (src/lib/burnReceipts/burnTarget.ts judgeTargetAdmission) as the review shows them: one line, or the ready line. */
export function admissionLine(o: { ok: boolean; problems: readonly string[]; symbol: string }): string {
  if (o.ok) return `${o.symbol} and its pool pass every check the program makes. The program checks them again when the coin is created.`;
  return `This coin cannot burn ${o.symbol}: ${o.problems.join(" ")}`;
}

/** Why a target crank is held, in words for the status page and alerts (the keeper's WAIT_REASONS carry the long form). */
export function targetHeldLine(symbol: string, err: string): string | null {
  if (err === "TargetPoolBelowFloor") return `${symbol} pool unhealthy: the pinned pool holds less SOL than the minimum such a pool needs, so the burn pool's SOL is held.`;
  if (err === "TargetPoolUnhealthy") return `${symbol} pool unhealthy: the pinned pool is gone, switched off or changed, so the burn pool's SOL is held.`;
  if (err === "TargetFeeTier") return `${symbol} pool unhealthy: the pinned pool's fee is now above 1%, so the burn pool's SOL is held.`;
  return null;
}

// ---- the pin transaction (WIRING-ROUND5 items 2 to 4) -----------------------------------------------------------------------------

/**
 * The BurnTarget account pin_burn_target creates: 8 + BurnTarget::INIT_SPACE (programs/burn-receipts state.rs) = 373 bytes.
 * test/burntickerPinSteps.test.ts sums it from the IDL's own type, so a layout change cannot leave this number behind.
 */
export const BURN_TARGET_ACCOUNT_BYTES = 373;
/** The label the burn program client gives the pin instruction (programClient.ts); the bundle splits on it. */
export const PIN_IX_LABEL_PREFIX = "burn_receipts.pin_burn_target";
/**
 * The step that carries the pin, as the review and the bundle both name it. It matches the launch page's `^Pin .+'s Raydium pool for \$`,
 * so the page knows the server counted it. On LaunchLab the rule is locked and the pool pinned in one transaction and the coin created
 * in the next; on the pair curve one transaction locks the rule, pins the pool and then creates the coin's mint.
 */
export const pinStepText = (ticker: string, symbol: string, o: { link?: boolean; thenCreate?: boolean } = {}): string =>
  `Pin ${symbol}'s Raydium pool for $${ticker} after locking in its rule${o.link ? " and linking the two coins" : ""}${o.thenCreate ? `, then create $${ticker}` : ""}`;
/**
 * The first of a LaunchLab coin's two transactions when it burns itself (pairs since 2026-10-14, Phantom review ticket 438485; every
 * coin since 2026-10-15): initialize_token alone, then the create (createAfterPinText). A pair's side B names the link, because its
 * initialize_token completes the pairing.
 */
export const lockRuleStepText = (ticker: string, o: { link?: boolean } = {}): string => `Lock in $${ticker}'s rule${o.link ? " and link the two coins" : ""}`;
/** Owner decision 2026-10-19: a single coin on the incinerator end pins its EndSink (kind INCINERATOR) in that same first transaction. */
export const incineratorStepText = (ticker: string): string => `Lock in $${ticker}'s rule and pin its end to Solana's incinerator`;
/** The create step that follows a pin on LaunchLab, or a pair coin's lock step. */
export const createAfterPinText = (ticker: string): string => `Create $${ticker}`;
/** What the review says about the pin, once, when any coin pins a token. */
export const PIN_STEP_NOTE = "A coin that burns a real token pins the Raydium pool it swaps on while the coin does not exist yet: its rule is locked and the pool pinned first, and the coin is created after that, all signed by the coin's new key and your wallet.";
