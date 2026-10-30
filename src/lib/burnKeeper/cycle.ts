import type { FeedValidation } from "@/lib/burnKeeper/feeds/treasury";
import type { Cosigner } from "@/lib/burnticker/attesters/cosign";
import type { Ledger, BurnRow, SignatureRow, SigKind } from "@/lib/burnKeeper/ledger";
import type { AttesterGate } from "@/lib/burnKeeper/attesters/gate";
import { burnMemo, planReadings, type PlanStep } from "@/lib/burnKeeper/plan";
import { formatBuybackMemo, parseBuybackMemo, parseDebtMemo, memoDateKey } from "@/lib/burnKeeper/memo";
import { belowFloor, buybackSpend, centsToUsd, rawToTokens, settleBurn, spendablePool, tokenStringToRaw, tokensToRaw, type LoadedRules } from "@/lib/burnKeeper/rules";
import { backoffMs } from "@/lib/burnKeeper/schedule";

/**
 * ONE KEEPER CYCLE (2026-10-09): ingest the feed into the ledger, then execute the pending burns in date order. Everything that
 * touches a chain goes through `ChainPort`, so the same code runs against Solana (scripts/burn-keeper.mts, the devnet demo) and
 * against a fake chain in the tests — which is how the crash-between-send-and-record case is tested without a network.
 *
 * THE ORDER OF A BURN (SPEC §4): resolve every earlier signature for the date → look for the date's memo in the keeper's own
 * on-chain history → settle (owed / burned / shortfall, against the LIVE vault balance) and fix the memo → simulate → write the
 * signature to the ledger → send → confirm → write the row. A date is executed only after every earlier date is final, so the
 * shortfall each day inherits is known, and "one tx per record_date" holds even across restarts:
 *   · a signature still within its blockhash's life is WAITED ON, never re-signed (a second transaction could land beside it)
 *   · a signature that expired without landing is marked expired; only then may a new one be signed — with the same memo
 *   · a memo for the date already on chain from the keeper's key settles the date, whatever the local ledger says
 * Failures (simulation refused, RPC down) back off — 15 s doubling to 1 h — and the date stays planned: late, never lost.
 *
 * BUYBACK MODE (the primary mechanic since 10-09 evening) is the same discipline with two legs per date, each write-ahead and each
 * resolved before anything new is signed: (1) the SWAP — spend = pool × (1 − (1 − f)^units), f = the rule file's fractionPerUnit (1% while
 * the owner decides between 1% and 5%, 10-09), fixed on the row at the first attempt,
 * SOL → token at market through the router, validated (SOL in, the configured mint out, the keeper the only signer), simulated,
 * recorded, sent; what it delivered is read from its own transaction meta; (2) the BURN, immediately after — every token the keeper
 * holds, with the v2 memo naming the pool, the spend, what the swap delivered, what was burned and the swap's signature. Two
 * transactions, not one: the memo must state what the swap actually delivered and link its signature, which a single transaction
 * cannot know about itself; the tokens sit in the keeper's account only for the seconds between the two. A day whose spend is under
 * the floor (or whose pool is empty) is SKIPPED: recorded, nothing bought, the pool keeps the SOL.
 */

export interface SignedTx { signature: string; raw: Uint8Array; blockhash: string; lastValidBlockHeight: number }
export type ConfirmOutcome = { status: "confirmed"; slot: number | null } | { status: "failed"; err: string } | { status: "expired" };

export interface ChainPort {
  /** Vault token account balance, raw units (vested and claimed — what can actually be burned now). */
  vaultBalanceRaw(): Promise<bigint>;
  /** A confirmed, error-free transaction of the keeper whose memo contains `dateKey` ("DEBT|2026-10-08|"), or null. */
  findMemoOnChain(dateKey: string): Promise<{ signature: string; slot: number | null; memo: string } | null>;
  /** Status per signature (null = unknown to the cluster). */
  signatureStatuses(signatures: string[]): Promise<({ slot: number | null; err: string | null; confirmed: boolean } | null)[]>;
  blockHeight(): Promise<number>;
  /** Build and sign: BurnChecked(burnRaw) from the vault + Memo; burnRaw 0 = a memo-only transaction (a shortfall day). */
  buildSigned(burnRaw: bigint, memo: string): Promise<SignedTx>;
  simulate(raw: Uint8Array): Promise<{ err: string | null; logs: string[] }>;
  send(raw: Uint8Array): Promise<void>;
  confirm(tx: SignedTx): Promise<ConfirmOutcome>;
}

export interface KeeperCtx {
  ledger: Ledger;
  loaded: LoadedRules;
  log: (line: string) => void;
  now: () => number;
  dryRun: boolean;
  /**
   * Optional second attester (attesters/gate.ts; BURNKEEPER_ATTESTER). When set, nothing NEW is signed for a date until the
   * attester agrees with the keeper's figure for it — quorum 2 off chain. Resolving and adopting transactions already sent is
   * never gated: a burn that landed is a fact, whatever the attester says now.
   */
  attester?: AttesterGate | null;
  /**
   * The second reading signer on its own host (signer-2, 2026-10-12; src/lib/burnticker/attesters/cosign.ts). Program path only: each
   * reading is shown to it before submit_reading and held when it disagrees. At quorum 1 it is advisory: when it cannot check or cannot
   * be reached the reading is sent on the keeper key alone, and it does not check pair coins (HB-69). Unset: nothing changes.
   */
  cosigner?: Cosigner | null;
}

/** The attester gate at the one point per leg where something new would be signed: null = proceed; a string = hold, both figures logged. */
export async function attesterHold(ctx: KeeperCtx, b: BurnRow): Promise<string | null> {
  if (!ctx.attester) return null;
  const r = await ctx.attester.check(b);
  if (r.ok) { ctx.log(`  [attest] ${b.recordDate}: ${r.note}`); return null; }
  ctx.log(`  [attest] ${b.recordDate}: HELD — ${r.why}`);
  return r.why;
}

export const tokenKey = (l: LoadedRules) => l.rules.token;
export const feedKey = (l: LoadedRules) => l.rules.feed.id;

export interface IngestResult { steps: PlanStep[]; written: number; refusals: string[] }

/** Plans every validated reading against the ledger and records the processed steps. Never sends anything. */
export function ingest(ctx: KeeperCtx, v: FeedValidation): IngestResult {
  const T = tokenKey(ctx.loaded), F = feedKey(ctx.loaded);
  const steps = planReadings(ctx.loaded.rules, ctx.ledger.lastReading(T, F), ctx.ledger.lastBurnedDate(T, F), v.readings);
  let written = 0;
  const refusals = [...v.refusals];
  for (const s of steps) {
    if (s.kind === "refuse") { refusals.push(s.reason); break; }
    if (ctx.ledger.applyStep(T, F, s, ctx.now())) {
      written++;
      const r = s.reading;
      if (s.kind === "baseline") ctx.log(`  [feed] ${r.recordDate} $${r.amount} — baseline (nothing is burned for the first reading)`);
      else if (s.kind === "nothing") ctx.log(`  [feed] ${r.recordDate} $${r.amount} — ${s.reason}`);
      else if (s.kind === "burn") ctx.log(`  [feed] ${r.recordDate} $${r.amount} — ${s.step.units} unit(s): burn planned`);
    }
  }
  for (const x of refusals) ctx.log(`  [feed] REFUSED: ${x}`);
  return { steps, written, refusals };
}

export type ExecOutcome =
  | { recordDate: string; outcome: "confirmed"; signature: string; burnRaw: bigint; shortfallRaw: bigint; memo: string; adopted: boolean }
  | { recordDate: string; outcome: "exhausted" }
  | { recordDate: string; outcome: "dry-run"; memo: string; burnRaw: bigint; shortfallRaw: bigint }
  | { recordDate: string; outcome: "waiting"; why: string }
  | { recordDate: string; outcome: "skipped"; why: string }
  | { recordDate: string; outcome: "error"; why: string };

/**
 * Executes pending burns oldest first; stops at the first date that is not final (the next one depends on it). Buyback mode needs
 * the `buyback` port (fee pool, SOL price, the router's swap); vault mode ignores it.
 */
export async function executePending(ctx: KeeperCtx, chain: ChainPort, buyback?: BuybackPort): Promise<ExecOutcome[]> {
  const T = tokenKey(ctx.loaded), F = feedKey(ctx.loaded);
  const out: ExecOutcome[] = [];
  const isBuyback = ctx.loaded.rules.mode === "buyback";
  if (isBuyback && !buyback) throw new Error("buyback mode needs a BuybackPort");
  for (const b0 of ctx.ledger.pendingBurns(T, F)) {
    const r = isBuyback ? await executeBuybackOne(ctx, chain, buyback!, b0) : await executeOne(ctx, chain, b0);
    out.push(r);
    if (r.outcome !== "confirmed" && r.outcome !== "exhausted" && r.outcome !== "skipped") break;
  }
  return out;
}

/**
 * Resolves every still-'sent' signature of one kind for a date: one landed → that one; one may still land → wait; all failed or
 * expired → none (marked so), and only then may a new transaction be signed for that leg.
 */
export async function resolveSent(ctx: KeeperCtx, chain: Pick<ChainPort, "signatureStatuses" | "blockHeight">, D: string, kind: SigKind): Promise<{ landed: SignatureRow & { slot: number | null } } | { waiting: string } | { none: true }> {
  const T = tokenKey(ctx.loaded), F = feedKey(ctx.loaded);
  const sent = ctx.ledger.signatures(T, F, D, kind).filter((s) => s.status === "sent");
  if (!sent.length) return { none: true };
  const st = await chain.signatureStatuses(sent.map((s) => s.signature));
  let height: number | null = null;
  for (let i = 0; i < sent.length; i++) {
    const s = sent[i], x = st[i];
    if (x && x.err === null && x.confirmed) return { landed: { ...s, slot: x.slot } };
    if (x && x.err !== null) { ctx.ledger.setSignatureStatus(s.signature, "failed", x.err, x.slot); continue; }
    height ??= await chain.blockHeight();
    if (height > s.lastValidBlockHeight) ctx.ledger.setSignatureStatus(s.signature, "expired", null, null);
    else return { waiting: `${kind} transaction ${s.signature.slice(0, 12)}… may still land (block height ${height} ≤ ${s.lastValidBlockHeight})` };
  }
  return { none: true };
}

/** What buyback mode needs beyond ChainPort. The token account it burns from is ChainPort's vault (the keeper's own ATA). */
export interface BuybackPort {
  /** The keeper's SOL balance, lamports (the fee pool before the reserve). */
  feeBalanceLamports(): Promise<bigint>;
  /** SOL in USD, read at execution — only for the floor check, and recorded on the row. */
  solUsd(): Promise<number>;
  /** Build, VALIDATE (SOL in, the configured mint out, the keeper the only signer) and sign the market swap for `lamports`. */
  buildSwap(lamports: bigint): Promise<SignedTx & { quotedOutRaw: bigint }>;
  /** Raw tokens the keeper's token account gained in a confirmed swap (from the transaction meta, not the quote); null = unreadable yet. */
  swapReceivedRaw(signature: string): Promise<bigint | null>;
}

/** One buyback day: resolve → (swap → record what it delivered) → burn everything held, with the v2 memo. See the header. */
async function executeBuybackOne(ctx: KeeperCtx, chain: ChainPort, bb: BuybackPort, b0: BurnRow): Promise<ExecOutcome> {
  const { ledger, loaded } = ctx;
  const rules = loaded.rules;
  const T = tokenKey(loaded), F = feedKey(loaded), D = b0.recordDate;
  const now = ctx.now();
  const fail = (why: string): ExecOutcome => {
    const b = ledger.burn(T, F, D);
    ledger.noteError(T, F, D, why, now + backoffMs(b?.attempts ?? 0), now);
    ctx.log(`  [buyback] ${D}: ${why} — retrying later`);
    return { recordDate: D, outcome: "error", why };
  };
  if (!ctx.dryRun && b0.nextAttemptAt && now < b0.nextAttemptAt) return { recordDate: D, outcome: "waiting", why: `backing off until ${new Date(b0.nextAttemptAt).toISOString()}` };
  try {
    // A. A burn already signed for this date?
    const burnRes = await resolveSent(ctx, chain, D, "burn");
    if ("landed" in burnRes) {
      const s = burnRes.landed;
      ledger.markConfirmed(T, F, D, { signature: s.signature, slot: s.slot, burnRaw: s.burnRaw, memo: s.memo }, now);
      ctx.log(`  [buyback] ${D}: an earlier burn landed (${s.signature.slice(0, 12)}…) — recorded`);
      return { recordDate: D, outcome: "confirmed", signature: s.signature, burnRaw: s.burnRaw, shortfallRaw: BigInt(0), memo: s.memo, adopted: true };
    }
    if ("waiting" in burnRes) return { recordDate: D, outcome: "waiting", why: burnRes.waiting };
    if (ledger.burn(T, F, D)!.status === "sending") ledger.setBurnStatus(T, F, D, "swapped", now);

    // B. The chain is the final word for the burn leg too.
    const found = await chain.findMemoOnChain(memoDateKey(rules.memo.prefix, D));
    if (found) {
      const memoText = found.memo.replace(/^\[\d+\]\s*/, "");
      const m = parseBuybackMemo(memoText);
      if (m && m.recordDate === D) {
        const burnRaw = tokenStringToRaw(m.burn, rules.decimals);
        ledger.markConfirmed(T, F, D, { signature: found.signature, slot: found.slot, burnRaw, memo: memoText }, now);
        ctx.log(`  [buyback] ${D}: burn already on chain (${found.signature.slice(0, 12)}…) — recorded, not re-sent`);
        return { recordDate: D, outcome: "confirmed", signature: found.signature, burnRaw, shortfallRaw: BigInt(0), memo: memoText, adopted: true };
      }
    }

    // C. The swap leg.
    let b = ledger.burn(T, F, D)!;
    if (b.status === "planned" || b.status === "swap-sent") {
      const sw = await resolveSent(ctx, chain, D, "swap");
      if ("waiting" in sw) return { recordDate: D, outcome: "waiting", why: sw.waiting };
      if ("landed" in sw) {
        const got = await bb.swapReceivedRaw(sw.landed.signature);
        if (got === null) return { recordDate: D, outcome: "waiting", why: `swap ${sw.landed.signature.slice(0, 12)}… landed; its meta is not readable yet` };
        ledger.markSwapped(T, F, D, sw.landed.signature, got, sw.landed.slot, now);
        ctx.log(`  [buyback] ${D}: an earlier swap landed (${sw.landed.signature.slice(0, 12)}…, got ${got} raw) — burning next`);
      } else {
        if (b.status === "swap-sent") ledger.setBurnStatus(T, F, D, "planned", now);
        // Quorum 2 (when configured): no new swap for a date the second attester has not confirmed. Held = backed off, never skipped.
        const hold = await attesterHold(ctx, b);
        if (hold) return ctx.dryRun ? { recordDate: D, outcome: "waiting", why: `second attester: ${hold}` } : fail(`second attester: ${hold}`);
        if (b.spendLamports === null) {
          const pool = spendablePool(await bb.feeBalanceLamports(), rules.buyback.reserveSol);
          const spend = buybackSpend(pool, b.units, rules.buyback.fractionPerUnit);
          const solUsd = await bb.solUsd();
          if (spend <= BigInt(0)) { if (!ctx.dryRun) ledger.markSkipped(T, F, D, `the fee pool is empty (${pool} lamports spendable)`, now); ctx.log(`  [buyback] ${D}: fee pool empty — nothing bought`); return { recordDate: D, outcome: "skipped", why: "fee pool empty" }; }
          if (belowFloor(spend, solUsd, rules.buyback.floorUsd)) {
            const why = `spend ${spend} lamports ≈ $${((Number(spend) / 1e9) * solUsd).toFixed(2)} is under the $${rules.buyback.floorUsd} floor`;
            if (!ctx.dryRun) ledger.markSkipped(T, F, D, why, now);
            ctx.log(`  [buyback] ${D}: ${why} — nothing bought (the pool keeps it)`);
            return { recordDate: D, outcome: "skipped", why };
          }
          if (ctx.dryRun) { ctx.log(`  [dry-run] ${D}: ${b.units} unit(s) → would spend ${spend} of ${pool} lamports (≈ $${((Number(spend) / 1e9) * solUsd).toFixed(2)}) buying, then burn all received`); return { recordDate: D, outcome: "dry-run", memo: "", burnRaw: BigInt(0), shortfallRaw: BigInt(0) }; }
          b = ledger.fixSpend(T, F, D, { poolLamports: pool, spendLamports: spend, solUsd }, now);
        }
        if (ctx.dryRun) return { recordDate: D, outcome: "dry-run", memo: "", burnRaw: BigInt(0), shortfallRaw: BigInt(0) };
        const spend = b.spendLamports!;
        const tx = await bb.buildSwap(spend);
        const sim = await chain.simulate(tx.raw);
        if (sim.err) return fail(`swap simulation refused: ${sim.err}${sim.logs.length ? ` · ${sim.logs.slice(-2).join(" · ")}` : ""}`);
        ledger.recordSignature({ kind: "swap", signature: tx.signature, token: T, feed: F, recordDate: D, memo: `swap ${spend} lamports SOL → ${rules.ticker}`, burnRaw: tx.quotedOutRaw, blockhash: tx.blockhash, lastValidBlockHeight: tx.lastValidBlockHeight, sentAt: now });
        try { await chain.send(tx.raw); } catch (e) { ctx.log(`  [buyback] ${D}: swap send raised ${(e as Error).message.slice(0, 120)} — the signature is on the ledger and will be resolved`); }
        const c = await chain.confirm(tx);
        if (c.status === "failed") { ledger.setSignatureStatus(tx.signature, "failed", c.err, null); ledger.setBurnStatus(T, F, D, "planned"); return fail(`swap failed on chain: ${c.err}`); }
        if (c.status === "expired") return { recordDate: D, outcome: "waiting", why: `swap ${tx.signature.slice(0, 12)}… not confirmed yet` };
        const got = await bb.swapReceivedRaw(tx.signature);
        if (got === null) return { recordDate: D, outcome: "waiting", why: `swap ${tx.signature.slice(0, 12)}… confirmed; its meta is not readable yet` };
        ledger.markSwapped(T, F, D, tx.signature, got, c.slot, ctx.now());
        ctx.log(`  [buyback] ${D}: swapped ${spend} lamports → ${got} raw ${rules.ticker} (${tx.signature})`);
      }
    }

    // D. The burn leg: EVERY token the keeper holds (what the swap delivered + any dust a crash left), with the v2 memo.
    b = ledger.burn(T, F, D)!;
    if (b.status !== "swapped") return { recordDate: D, outcome: "waiting", why: `status ${b.status}` };
    if (b.memo === null) {
      const held = await chain.vaultBalanceRaw();
      const memo = formatBuybackMemo({
        prefix: rules.memo.prefix, recordDate: D, source: rules.feed.memoSource, prev: centsToUsd(b.prevCents), now: centsToUsd(b.nowCents), delta: centsToUsd(b.deltaCents), units: b.units,
        pool: (b.poolLamports ?? BigInt(0)).toString(), spent: (b.spendLamports ?? BigInt(0)).toString(), got: rawToTokens(b.gotRaw ?? BigInt(0), rules.decimals), burn: rawToTokens(held, rules.decimals),
        swap: b.swapSig ? b.swapSig.slice(0, 12) : "none", rulesSha12: loaded.sha12, version: "v2",
      });
      b = ledger.fixSettlement(T, F, D, { memo, shortInRaw: BigInt(0), owedRaw: held, burnRaw: held, shortOutRaw: BigInt(0) }, now);
    }
    const memo = b.memo!, burnRaw = b.burnRaw ?? BigInt(0);
    const tx = await chain.buildSigned(burnRaw, memo);
    const sim = await chain.simulate(tx.raw);
    if (sim.err) return fail(`burn simulation refused: ${sim.err}`);
    ledger.recordSignature({ kind: "burn", signature: tx.signature, token: T, feed: F, recordDate: D, memo, burnRaw, blockhash: tx.blockhash, lastValidBlockHeight: tx.lastValidBlockHeight, sentAt: now });
    try { await chain.send(tx.raw); } catch (e) { ctx.log(`  [buyback] ${D}: burn send raised ${(e as Error).message.slice(0, 120)} — the signature is on the ledger and will be resolved`); }
    const c = await chain.confirm(tx);
    if (c.status === "confirmed") {
      ledger.markConfirmed(T, F, D, { signature: tx.signature, slot: c.slot, burnRaw, memo }, ctx.now());
      ctx.log(`  [buyback] ${D}: BURNED ${rawToTokens(burnRaw, rules.decimals)} — ${tx.signature} — ${memo}`);
      return { recordDate: D, outcome: "confirmed", signature: tx.signature, burnRaw, shortfallRaw: BigInt(0), memo, adopted: false };
    }
    if (c.status === "failed") { ledger.setSignatureStatus(tx.signature, "failed", c.err, null); ledger.setBurnStatus(T, F, D, "swapped"); return fail(`burn failed on chain: ${c.err}`); }
    return { recordDate: D, outcome: "waiting", why: `burn ${tx.signature.slice(0, 12)}… not confirmed yet` };
  } catch (e) {
    return fail(`RPC/chain error: ${(e as Error).message.slice(0, 200)}`);
  }
}

async function executeOne(ctx: KeeperCtx, chain: ChainPort, b0: BurnRow): Promise<ExecOutcome> {
  const { ledger, loaded } = ctx;
  const T = tokenKey(loaded), F = feedKey(loaded), D = b0.recordDate;
  const now = ctx.now();
  const fail = (why: string): ExecOutcome => {
    const b = ledger.burn(T, F, D);
    ledger.noteError(T, F, D, why, now + backoffMs(b?.attempts ?? 0), now);
    ctx.log(`  [burn] ${D}: ${why} — retrying later`);
    return { recordDate: D, outcome: "error", why };
  };
  if (!ctx.dryRun && b0.nextAttemptAt && now < b0.nextAttemptAt) return { recordDate: D, outcome: "waiting", why: `backing off until ${new Date(b0.nextAttemptAt).toISOString()}` };

  try {
    // 1. Every signature already signed for this date is resolved first.
    const res = await resolveSent(ctx, chain, D, "burn");
    if ("landed" in res) {
      const s = res.landed;
      ledger.markConfirmed(T, F, D, { signature: s.signature, slot: s.slot, burnRaw: s.burnRaw, memo: s.memo }, now);
      ctx.log(`  [burn] ${D}: an earlier send landed (${s.signature.slice(0, 12)}…) — recorded`);
      return { recordDate: D, outcome: "confirmed", signature: s.signature, burnRaw: s.burnRaw, shortfallRaw: ledger.burn(T, F, D)?.shortOutRaw ?? BigInt(0), memo: s.memo, adopted: true };
    }
    if ("waiting" in res) return { recordDate: D, outcome: "waiting", why: res.waiting.replace(/^burn transaction/, "transaction") };
    if (ledger.burn(T, F, D)!.status === "sending") ledger.setBurnStatus(T, F, D, "planned", now);

    // 2. The chain is the final word: the keeper's own memo for this date already there = done.
    const found = await chain.findMemoOnChain(memoDateKey(loaded.rules.memo.prefix, D));
    if (found) {
      const m = parseDebtMemo(found.memo.replace(/^\[\d+\]\s*/, ""));
      if (m && m.recordDate === D) {
        const burnRaw = tokenStringToRaw(m.burn, loaded.rules.decimals);
        const shortRaw = m.short ? tokenStringToRaw(m.short, loaded.rules.decimals) : BigInt(0);
        const memoText = found.memo.replace(/^\[\d+\]\s*/, "");
        const b = ledger.burn(T, F, D);
        if (b && b.memo === null) ledger.fixSettlement(T, F, D, { memo: memoText, shortInRaw: ledger.shortfallBefore(T, F, D), owedRaw: burnRaw + shortRaw, burnRaw, shortOutRaw: shortRaw }, now);
        ledger.markConfirmed(T, F, D, { signature: found.signature, slot: found.slot, burnRaw, memo: memoText }, now);
        ctx.log(`  [burn] ${D}: already on chain (${found.signature.slice(0, 12)}…) — recorded, not re-sent`);
        return { recordDate: D, outcome: "confirmed", signature: found.signature, burnRaw, shortfallRaw: shortRaw, memo: memoText, adopted: true };
      }
    }

    // 3. Settle against the live vault and fix the memo (once) — after the second attester (when configured) has confirmed the date.
    let b = ledger.burn(T, F, D)!;
    const hold = await attesterHold(ctx, b);
    if (hold) return ctx.dryRun ? { recordDate: D, outcome: "waiting", why: `second attester: ${hold}` } : fail(`second attester: ${hold}`);
    if (b.memo === null) {
      const allocationRaw = tokensToRaw(loaded.rules.vaultAllocation, loaded.rules.decimals);
      const left = allocationRaw - ledger.totalBurnedRaw(T, F);
      const shortIn = ledger.shortfallBefore(T, F, D);
      const vault = await chain.vaultBalanceRaw();
      const st = settleBurn({ plannedRaw: b.plannedRaw, shortfallInRaw: shortIn, vaultRaw: vault, allocationLeftRaw: left });
      if (st.exhausted) {
        if (!ctx.dryRun) ledger.markExhausted(T, F, D, now);
        ctx.log(`  [burn] ${D}: the vault's allocation is fully burned — nothing is owed (fixed supply from here)`);
        return { recordDate: D, outcome: "exhausted" };
      }
      const memo = burnMemo(loaded.rules, loaded.sha12, { recordDate: D, prevCents: b.prevCents, nowCents: b.nowCents, deltaCents: b.deltaCents, units: b.units }, st.burnRaw, st.shortfallRaw);
      if (ctx.dryRun) {
        ctx.log(`  [dry-run] ${D}: would burn ${st.burnRaw} raw${st.shortfallRaw > BigInt(0) ? ` (short ${st.shortfallRaw})` : ""} — memo ${memo}`);
        return { recordDate: D, outcome: "dry-run", memo, burnRaw: st.burnRaw, shortfallRaw: st.shortfallRaw };
      }
      b = ledger.fixSettlement(T, F, D, { memo, shortInRaw: shortIn, owedRaw: st.owedRaw, burnRaw: st.burnRaw, shortOutRaw: st.shortfallRaw }, now);
    }
    if (ctx.dryRun) return { recordDate: D, outcome: "dry-run", memo: b.memo!, burnRaw: b.burnRaw ?? BigInt(0), shortfallRaw: b.shortOutRaw ?? BigInt(0) };
    const memo = b.memo!, burnRaw = b.burnRaw ?? BigInt(0);

    // 4. Simulate → write-ahead → send → confirm.
    const tx = await chain.buildSigned(burnRaw, memo);
    const sim = await chain.simulate(tx.raw);
    if (sim.err) return fail(`simulation refused: ${sim.err}${sim.logs.length ? ` · ${sim.logs.slice(-3).join(" · ")}` : ""}`);
    ledger.recordSignature({ signature: tx.signature, token: T, feed: F, recordDate: D, memo, burnRaw, blockhash: tx.blockhash, lastValidBlockHeight: tx.lastValidBlockHeight, sentAt: now });
    try { await chain.send(tx.raw); } catch (e) { ctx.log(`  [burn] ${D}: send raised ${(e as Error).message.slice(0, 120)} — the signature is on the ledger and will be resolved`); }
    const c = await chain.confirm(tx);
    if (c.status === "confirmed") {
      ledger.markConfirmed(T, F, D, { signature: tx.signature, slot: c.slot, burnRaw, memo }, ctx.now());
      ctx.log(`  [burn] ${D}: CONFIRMED ${tx.signature} — ${memo}`);
      return { recordDate: D, outcome: "confirmed", signature: tx.signature, burnRaw, shortfallRaw: b.shortOutRaw ?? BigInt(0), memo, adopted: false };
    }
    if (c.status === "failed") { ledger.setSignatureStatus(tx.signature, "failed", c.err, null); ledger.setBurnStatus(T, F, D, "planned"); return fail(`transaction failed on chain: ${c.err}`); }
    // Not landed within the wait: leave it 'sent'; the next cycle resolves it (waits while it may land, re-signs only once expired).
    return { recordDate: D, outcome: "waiting", why: `transaction ${tx.signature.slice(0, 12)}… not confirmed yet` };
  } catch (e) {
    return fail(`RPC/chain error: ${(e as Error).message.slice(0, 200)}`);
  }
}
