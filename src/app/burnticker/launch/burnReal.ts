import type { BurnRule } from "@/lib/burnticker/rules";
import type { LaunchReview, ReviewCost } from "@/lib/burnticker/launchReview";
import { BURN_TARGET_ACCOUNT_BYTES, SUGGESTED_TARGETS, admissionLine, burnTargetShapeProblems, targetHeldLine, targetReceiptLine, targetReviewSentence, type BurnTargetField } from "@/lib/burnticker/burnTarget";
import { LAMPORTS_PER_SIGNATURE, rentLamports, solText } from "@/lib/burnticker/launchCost";
// the library's own memo v3 reader, browser-safe (memoV3.ts: no web3, no Buffer); it replaced this page's duplicate reader
import { parseTargetMemo } from "@/lib/burnReceipts/memoV3";

/**
 * WEBSITE-24 (WIRING-ROUND5, owner 2026-10-13: "make the actual wif and bonk coins burn"): the launch page's half of a coin that burns a
 * real token instead of itself. Pure and client-safe (no web3, no Buffer): the per-side choice, the admission read
 * (GET /api/burnticker/burn-target, shown in the library's own words), the hashed rule field, the review sentence, the pin transaction
 * counted in the pre-wallet summary, and the coin page's receipt and held lines. Every sentence comes from src/lib/burnticker/burnTarget.ts
 * or passes the same copy lint (test/burntickerWebsite24.test.ts): no "buy", "price", "will", "target", dates or "coming soon".
 *
 * The choice is shown only when the launch state says the round-5 program is deployed (SiteLaunchState.burnReal); otherwise the page
 * says the waiting line from launchAvailability.ts in its place. Default off: the coin burns itself.
 */

/** The token a coin may burn: its mint, its Pyth feed id (64 hex) and the pool the creator names (Raydium CPMM or AMM v4 against SOL). */
export interface RealPick { symbol: string; mint: string; feedId: string; pool: string }
/** The admission read for one pick on one network; `key` says which pick it answers. */
export interface Admission { key: string; busy: boolean; ok: boolean | null; line: string | null; kind: "cpmm" | "amm-v4" | null; error: string | null }
/** One side's choice: off (the coin burns itself) or on with the pick and its admission. */
export interface SideReal { on: boolean; pick: RealPick | null; admission: Admission | null }
export const SIDE_REAL_OFF: SideReal = { on: false, pick: null, admission: null };

const HEX64 = /^[0-9a-f]{64}$/;

/**
 * The pick for a Coin vs Coin side's reference coin (a derby underlying): the suggested mint and feed when the symbol is one of
 * SUGGESTED_TARGETS, else the underlying's own Solana mint and Pyth feed. The pool is prefilled with the underlying's pool (the creator
 * can change it; admission decides). Null when the coin has no Solana mint or no Pyth feed: it cannot be burned for real.
 */
export function realPickFor(u: { symbol: string; pyth: string | null; mint: string | null; pool?: string | null } | null | undefined): RealPick | null {
  if (!u) return null;
  const s = SUGGESTED_TARGETS.find((t) => t.symbol === u.symbol.toUpperCase());
  const mint = s?.mint ?? u.mint, feedId = s?.feedId ?? (u.pyth ?? "").toLowerCase();
  if (!mint || !HEX64.test(feedId)) return null;
  return { symbol: u.symbol.toUpperCase(), mint, feedId, pool: u.pool ?? "" };
}
/** The single-coin choices: the suggested tokens (WIF, BONK), no pool yet. */
export const SINGLE_REAL_PICKS: readonly RealPick[] = SUGGESTED_TARGETS.map((t) => ({ symbol: t.symbol, mint: t.mint, feedId: t.feedId, pool: "" }));

/** Why a Coin vs Coin side offers no real burn (no Solana mint or no Pyth feed). */
export const realNotOffered = (symbol: string): string => `${symbol} cannot be burned for real here: that needs a Solana mint and a Pyth feed, so this side's coin burns itself.`;
/** Off: what the coin does. */
export const REAL_OFF_LINE = "Off: the coin burns itself, the default.";
/** The pool field. */
export const POOL_FIELD_LABEL = "The Raydium pool it swaps on";
export const poolFieldHelp = (symbol: string): string => `The address of a Raydium CPMM pool or a Raydium AMM v4 pool that pairs ${symbol} with SOL. The program checks the pool when the coin is created and on every burn.`;
export const POOL_KIND_WORDS: Record<"cpmm" | "amm-v4", string> = { cpmm: "a Raydium CPMM pool", "amm-v4": "a Raydium AMM v4 pool" };
export const checkingLine = (symbol: string): string => `Checking ${symbol} and its pool on the network.`;
export const noPoolLine = (symbol: string): string => `Name the Raydium pool that ${symbol} is swapped on.`;

/** The admission read is keyed by everything it checks. */
export const admissionKey = (p: RealPick, network: string): string => `${network}|${p.mint}|${p.pool.trim()}|${p.symbol}|${p.feedId}`;
export function admissionUrl(p: RealPick, network: string, coin?: string | null): string {
  const q = new URLSearchParams({ mint: p.mint, pool: p.pool.trim(), symbol: p.symbol, feed: p.feedId, network: network === "mainnet" ? "mainnet" : "devnet" });
  if (coin) q.set("coin", coin);
  return `/api/burnticker/burn-target?${q.toString()}`;
}
/** The pick's shape, as the route checks it first (a typed pool that is not an address is refused before any read). */
export const pickShapeProblems = (p: RealPick): string[] => burnTargetShapeProblems({ mint: p.mint, pool: p.pool.trim(), symbol: p.symbol, feedId: p.feedId });

/** The route's answer as the page shows it: its own `line` (admissionLine), or the library's line built from its problems. */
export function admissionFrom(key: string, symbol: string, j: unknown, httpError: string | null = null): Admission {
  const o = (j ?? {}) as { ok?: unknown; line?: unknown; problems?: unknown; pool?: { kind?: unknown } };
  const problems = Array.isArray(o.problems) ? o.problems.filter((x): x is string => typeof x === "string") : [];
  const ok = o.ok === true;
  const line = typeof o.line === "string" ? o.line : problems.length || ok ? admissionLine({ ok, problems, symbol }) : null;
  const kind = o.pool?.kind === "cpmm" || o.pool?.kind === "amm-v4" ? o.pool.kind : null;
  return { key, busy: false, ok: line ? ok : null, line, kind, error: line ? null : httpError ?? "The check could not be read just now." };
}

/** The hashed rule field for a side, only when it is on and its pool passed admission for exactly this pick. */
export function realField(s: SideReal, network: string): BurnTargetField | null {
  if (!s.on || !s.pick || !s.admission || s.admission.busy || s.admission.ok !== true || s.admission.key !== admissionKey(s.pick, network)) return null;
  return { mint: s.pick.mint, pool: s.pick.pool.trim(), symbol: s.pick.symbol, feedId: s.pick.feedId };
}
/** A rule with the side's field (or without any: off strips a stale one). Buyback rules only: a vault rule is returned unchanged. */
export function withRealBurn(rule: BurnRule, field: BurnTargetField | null): BurnRule {
  const { burnTarget: _old, ...rest } = rule;
  void _old;
  if (!field || rule.vault) return rest as BurnRule;
  return { ...rest, burnTarget: field } as BurnRule;
}

/** What still holds a side's launch: no pool, the check running, a refusal (the library's words), a failed read. Empty = ready. */
export function realBlockers(sides: { ticker: string; side: SideReal; network: string }[]): string[] {
  const out: string[] = [];
  for (const { ticker, side, network } of sides) {
    if (!side.on || !side.pick) continue;
    const who = `$${ticker || "TICKER"}`, p = side.pick, a = side.admission;
    if (!p.pool.trim()) { out.push(`${who}: ${noPoolLine(p.symbol)}`); continue; }
    if (!a || a.busy || a.key !== admissionKey(p, network)) { out.push(`${who}: ${checkingLine(p.symbol)}`); continue; }
    if (a.ok !== true) out.push(`${who}: ${a.line ?? a.error ?? admissionLine({ ok: false, problems: [], symbol: p.symbol })}`);
  }
  return out;
}

/**
 * Coin vs Coin's description says "WIF and BONK are only read, never traded or burned." (derby/spec.ts derbyReadOnlySentence). With a side
 * that burns its real coin that is no longer true, so the page swaps it for what each side does: the coins it only reads, and the
 * coins it swaps SOL for and burns. Used in the step previews, the review card and the description the launch pins.
 */
export function realReadSentence(symbols: { a: string; b: string }, list: { ticker: string; symbol: string }[]): string {
  const burned = new Set(list.map((x) => x.symbol));
  const read = [symbols.a, symbols.b].filter((s) => !burned.has(s));
  const readLine = read.length ? `${read.join(" and ")} ${read.length > 1 ? "are" : "is"} only read, never traded or burned.` : "";
  return [readLine, ...list.map((x) => `$${x.ticker || "TICKER"} swaps SOL from its own burn pool for real ${x.symbol} and burns it.`)].filter(Boolean).join(" ");
}

/** The review's sentences, one per side that burns a real token (Coin vs Coin names the side's days; a single coin does not). */
export const realReviewNotes = (list: { ticker: string; symbol: string; daysOf?: string | null }[]): string[] =>
  list.map((x) => targetReviewSentence({ ticker: x.ticker || "TICKER", symbol: x.symbol, daysOf: x.daysOf ?? null }));

/** The BurnTarget account the pin creates (programs/burn-receipts, 373 bytes with its discriminator; the library's number). */
export const BURN_TARGET_BYTES = BURN_TARGET_ACCOUNT_BYTES;
export const PIN_SIGNATURES = 2;
export const lockStepLabel = (ticker: string): string => `Lock in $${ticker}'s rule`;
export const pinStepLabel = (ticker: string, symbol: string, link = false): string => `Pin ${symbol}'s Raydium pool for $${ticker}, then create $${ticker}${link ? " and link the two coins" : ""}`;
export const PIN_NOTE = "A coin that burns a real token takes one more transaction: its rule is locked first, then the pool it swaps on is pinned before the coin is created, all signed by the coin's new key and your wallet.";
const PIN_MARK = /^Pin .+'s Raydium pool for \$/;

/**
 * The pre-wallet summary with the pin counted: for each side that burns a real token, its "Create $X …" step becomes two (lock the rule;
 * pin the pool, then create), one more transaction with two more signatures, plus the BurnTarget account's rent. Idempotent: a review
 * whose steps already carry a pin step (the server counting it) is returned as is.
 */
export function withPinSteps(review: LaunchReview, list: { ticker: string; symbol: string }[]): LaunchReview {
  if (!list.length || review.transactions.steps.some((s) => PIN_MARK.test(s.label))) return review;
  const steps = [...review.transactions.steps];
  const lines: ReviewCost[] = [...review.costs.lines];
  let add = 0;
  for (const { ticker, symbol } of list) {
    const t = ticker || "TICKER";
    const i = steps.findIndex((s) => s.label.startsWith(`Create $${t} `));
    const signers = i >= 0 ? steps[i].signers : ["your wallet", "a new key made for this coin"];
    const pin = { label: pinStepLabel(t, symbol, i >= 0 && /link the two coins/.test(steps[i].label)), signers };
    if (i >= 0) steps.splice(i, 1, { label: lockStepLabel(t), signers }, pin); else steps.push(pin);
    const rent = rentLamports(BURN_TARGET_BYTES), fee = PIN_SIGNATURES * LAMPORTS_PER_SIGNATURE;
    lines.push({ label: `Rent for the account that pins ${symbol}'s pool to $${t}, which is ${BURN_TARGET_BYTES} bytes.`, sol: solText(rent), kind: "rent" });
    lines.push({ label: `Network fees for the two signatures on $${t}'s pin transaction. Priority fees are extra.`, sol: solText(fee), kind: "fee" });
    add += rent + fee;
  }
  const total = Math.round(Number(review.costs.totalSol) * 1e9) + add;
  const n = steps.length;
  return {
    ...review,
    transactions: { ...review.transactions, count: n, steps, note: `${n === 1 ? review.transactions.note : "You sign each transaction in your wallet. The wallet shows the exact accounts and amount of each one first, and nothing in it is sent until you approve it."} ${PIN_NOTE}` },
    costs: { ...review.costs, lines, totalSol: solText(total) },
    ...(review.recovery && n > 1 && review.transactions.count > 1 ? { recovery: review.recovery.map((x) => x.replace(/^Your wallet asks \d+ separate times/, `Your wallet asks ${n} separate times`)) } : {}),
    ...(review.recovery && n > 1 && review.transactions.count === 1 ? { recovery: [`Your wallet asks ${n} separate times, once for each transaction, in the order above.`, "If you reject the first request, nothing is sent and nothing is charged.", "If you reject a later request, the transactions already confirmed stay on chain and are not undone. Pressing the button again continues from the next step.", ...review.recovery.slice(1)] } : {}),
  };
}

// ---- the coin page --------------------------------------------------------------------------------------------------------------

/** The rule file's real-burn field (rules.json is the rule itself), or null. */
export function ruleRealBurn(rulesText: string | null | undefined): BurnTargetField | null {
  try {
    const t = (JSON.parse(rulesText ?? "null") as { burnTarget?: unknown } | null)?.burnTarget;
    return t && burnTargetShapeProblems(t).length === 0 ? (t as BurnTargetField) : null;
  } catch { return null; }
}

/** "burned 1,234 real BONK" for a receipt whose memo burned the pinned token; null otherwise. */
export function receiptRealLine(memo: string | null | undefined, field: BurnTargetField | null): string | null {
  const m = parseTargetMemo(memo ?? "");
  return m && field && m.target === field.mint ? targetReceiptLine(m.burn, field.symbol) : null;
}
/** A held crank's line when the text (a skipped reason or the last error) names one of the program's pool errors. */
export function realHeldLine(field: BurnTargetField | null, text: string | null | undefined): string | null {
  if (!field || !text) return null;
  const code = /TargetPoolBelowFloor|TargetPoolUnhealthy|TargetFeeTier/.exec(text)?.[0];
  return code ? targetHeldLine(field.symbol, code) : null;
}
