import fs from "node:fs";
import path from "node:path";
import type { BurnRow, ProgramReadingRow, ReadingRow } from "@/lib/burnKeeper/ledger";
import type { ProgramConfigView } from "@/lib/burnKeeper/programChain";
import { buybackSpend as programBuybackSpend } from "@/lib/burnReceipts/math";
import { pairUrl, rowUrl } from "@/lib/burnKeeper/feeds/treasury";
import { parseBuybackMemo, parseDebtMemo } from "@/lib/burnKeeper/memo";
import { buybackSpend, centsToUsd, debtStep, rawToTokens, spendablePool, tokensToRaw, type LoadedRules } from "@/lib/burnKeeper/rules";
import { explorerUrl } from "@/lib/burnKeeper/solana";
import { dateIn } from "@/lib/burnKeeper/schedule";
import { readinessOf, type Readiness } from "@/lib/burnticker/readiness";
import type { PoolMarketJson } from "@/lib/burnticker/pageTypes";

/**
 * THE STATUS PAGE (SPEC §5 — "the product people actually see"; 2026-10-09). A STATIC SITE the keeper publishes every cycle:
 * status.json, burns.json, rules.json (the rule file's exact bytes) and index.html, written atomically into BURNKEEPER_PUBLISH_DIR.
 * No server: the owner points Cloudflare Pages / GitHub Pages / any static host at the directory.
 *
 * What it shows: supply, total burned, burns today / this month (Treasury's clock), the vault balance and its projected life at the
 * trailing-30-day pace, any outstanding SHORTFALL (the vesting vault, 10-09 evening), the debt curve with burn markers (inline SVG —
 * no script dependency, renders without JavaScript), every burn with its transaction, its exact source row and a "verify it yourself"
 * block: the curl against the Treasury API, the formula, the expected amount, and a check that the keeper's own recomputation from the
 * recorded readings agrees with the memo on chain.
 *
 * BUYBACK MODE (the primary mechanic since 10-09 evening) adds: the fee pool's balance, SOL spent today / this month, tokens bought and
 * burned, the swap link beside each burn, each day's recomputed spend (pool × (1 − 0.95^units), checked against the memo to the
 * lamport), skipped days with their reason, and a "where the money came from" line — the creator-fee source and the seed deposit,
 * both on-chain addresses.
 *
 * COPY RULE (SPEC §9.2, not optional): the page says what the rule is and what it did. It never says what the price will do, never
 * implies a return, and carries that sentence on the page itself.
 *
 * Pure apart from `publishSite`, which writes files.
 */

export const STATUS_SCHEMA = "burnkeeper.status/v1";

export interface ChainSnapshot {
  cluster: string;
  mint: string | null;
  vault: string | null;
  keeper: string | null;
  /** On-chain mint supply (raw), when read this cycle. */
  supplyRaw: bigint | null;
  /** On-chain vault balance (raw), when read this cycle. In buyback mode: the keeper's token account (0 between days). */
  vaultRaw: bigint | null;
  /** Buyback mode: the keeper's SOL balance (lamports) — the fee pool before the reserve — when read this cycle. */
  feeLamports?: bigint | null;
}

/** "Where the money came from" (buyback mode): the creator-fee source and the disclosed seed, both on-chain addresses/transactions. */
export interface FundingDisclosure { creatorFeeSource: string | null; seedTx: string | null; seedSol: string | null }

/**
 * PROGRAM EXECUTION (2026-10-10): what the status page shows about the burn_receipts program — attestation (attester keys, quorum,
 * the last reading's transaction), the queue (readings not yet on chain, cranks waiting on TWAP / a pool, spend carried by the 2 %
 * cap, burn-pool cap binds) and pool health. All read from the TokenConfig and the ledger's program rows; null in legacy mode.
 */
export interface ProgramStatusInput {
  programId: string; configAddress: string; feePda: string;
  config: ProgramConfigView | null;
  feePdaLamports: bigint | null;
  programReadings: readonly ProgramReadingRow[];
  keeperAttesterKeys: readonly string[];
  lastHealth?: string | null;
  lastClaims?: readonly string[] | null;
}

export interface StatusInput {
  loaded: LoadedRules;
  readings: readonly ReadingRow[];
  burns: readonly BurnRow[];
  chain: ChainSnapshot;
  now: number;
  nextPollAt: number | null;
  lastPoll: { at: number; outcome: string } | null;
  lastError: string | null;
  funding?: FundingDisclosure | null;
  program?: ProgramStatusInput | null;
  /** The coin's LaunchLab curve as read this cycle (src/lib/burnticker/market.ts curveProgress); null or absent when not read. */
  curve?: KeeperCurve | null;
  /** indexer-1 (WIRING.md step 5): after graduation, the registered Raydium pool as read (market.ts readCpmmMarket); null or absent when not read. */
  poolMarket?: KeeperPoolMarket | null;
}

/** market.ts readCpmmMarket's answer, as status.json carries it: the pool's figures, or the read's error. */
export interface KeeperPoolMarket { market: PoolMarketJson | null; error: string | null }

/** The curve fields status.json carries (website-14): the raise is the coin's own, read from its pool, never a typed 85. */
export interface KeeperCurve { phase: "curve" | "migrating" | "graduated"; raised: string; threshold: string; quote: string; progressPct: number; poolId: string; readAt: string }

export interface BurnJson {
  recordDate: string;
  prevDate: string;
  prev: string;
  now: string;
  delta: string;
  carryIn: string;
  carryRunSince: string | null;
  units: number;
  planned: string;
  shortIn: string | null;
  owed: string | null;
  burned: string | null;
  shortOut: string | null;
  status: BurnRow["status"];
  memo: string | null;
  signature: string | null;
  txUrl: string | null;
  sourceUrl: string;
  /** Buyback mode: the pool and spend (SOL), what the swap delivered (tokens), its signature and link; why a day was skipped. */
  mode: "buyback" | "vault";
  pool: string | null;
  spent: string | null;
  got: string | null;
  swapSig: string | null;
  swapUrl: string | null;
  skippedReason: string | null;
  /** "program": the burn_receipts program swapped and burned (its Reading account is the record); "legacy": the keeper's own legs. */
  execution: "program" | "legacy";
  /** Why the crank waits (TWAP history, no pool, pool not tradable) — not an error. */
  waitReason: string | null;
  /** A day the program handled in part: spend carried by the 2 %-of-reserve cap, or the burn-pool cap bound. */
  partial: string | null;
  verify: { curl: string; formula: string; expected: string; checks: string[]; verified: boolean };
}

export interface ProgramStatusJson {
  programId: string; config: string; feePda: string; feePdaUrl: string; feePdaSol: string | null; initialized: boolean;
  attestation: {
    attesters: { key: string; kind: string; url: string; heldByKeeper: boolean }[]; quorum: number; keeperHolds: number; quorumMet: boolean;
    pendingChange: { attesters: string[]; eta: string | null } | null; adminRenounced: boolean;
    lastReading: { recordDate: string; value: string; status: string; units: number | null; signature: string | null; txUrl: string | null } | null;
    /** Every reading on chain, newest first, at most 60 (website-14: the activity line's reading rows). Absent on older files. */
    readings?: { recordDate: string; value: string; units: number | null; signature: string | null; txUrl: string | null }[];
    held: { recordDate: string; status: string; why: string | null } | null;
  };
  queue: { lastOnChain: string | null; crankCursor: string | null; readingsNotOnChain: number; awaitingCrank: number; carriedSpendSol: string; carriedRemainderUsd: string; waits: { recordDate: string; reason: string }[]; partials: { recordDate: string; note: string }[] };
  pool: { registered: boolean; address: string | null; url: string | null; untradeableSince: string | null; lastCheck: string | null };
  totals: { burned: string; spentSol: string; shortfall: string; readings: number; burns: number };
  lastClaims: string[];
}

export interface StatusJson {
  schema: typeof STATUS_SCHEMA;
  generatedAt: string;
  ticker: string;
  ruleKey: string;
  cluster: string;
  addresses: { mint: string | null; vault: string | null; keeper: string | null; mintUrl: string | null; vaultUrl: string | null; keeperUrl: string | null };
  rules: { sha256: string; statement: string; unitUsd: string; burnPerUnitTokens: string; file: "rules.json" };
  supply: { initial: string; current: string; source: "chain" | "ledger" };
  burned: { total: string; pctOfSupply: number; today: string; thisMonth: string; burnsToday: number; burnsThisMonth: number; count: number };
  shortfall: { outstanding: string };
  vault: { allocation: string; balance: string | null; allocationLeft: string; trailing30d: string; projectedLifeDays: number | null; vesting: { kind: string; cliffDays: number; vestDays: number } };
  feed: {
    name: string; lastRecordDate: string | null; lastAmount: string | null; readings: number; lastPollAt: string | null; lastPollOutcome: string | null; nextPollAt: string | null;
    /** The first reading after launch (the baseline nothing is burned for), so a page can say how far the debt has risen since launch (website-14, LAUNCHPAD-PATH §73). Absent on older files. */
    baseline?: { recordDate: string; amount: string } | null;
  };
  health: { pending: number; lastError: string | null; unverified: number; waiting: number };
  mode: "buyback" | "vault";
  execution: "program" | "legacy";
  program: ProgramStatusJson | null;
  /** The LaunchLab curve read this cycle (website-14): the raise that completes it is read from the pool. Absent on older files; null when not read. */
  curve?: KeeperCurve | null;
  /** indexer-1: the registered Raydium pool as read after graduation. Absent on older files; null when not read. */
  poolMarket?: KeeperPoolMarket | null;
  /** Where the coin stands on the way to its burns (src/lib/burnticker/readiness.ts; docs/burnticker/FIRST-BURN-PATH.md). Absent on older files. */
  readiness?: Readiness;
  /** Buyback mode only (null in vault mode). SOL amounts as decimal strings. */
  buyback: {
    feePoolSol: string | null; reserveSol: string; fractionPerUnit: string; floorUsd: string;
    spentSolToday: string; spentSolMonth: string; spentSolTotal: string; boughtAndBurned: string; skippedDays: number;
    funding: { feeWallet: string | null; feeWalletUrl: string | null; creatorFeeSource: string | null; creatorFeeSourceUrl: string | null; seedTx: string | null; seedTxUrl: string | null; seedSol: string | null };
  } | null;
  /**
   * The DEVELOPER'S fee (LaunchLab platform slot, 25 bps of curve volume → the platform fee vault, claimed by BURNTICKER_FEE_WALLET;
   * src/lib/burnticker/fees.ts, docs/burnkeeper/fees.md). Optional: published once the keeper reads the vault's balance and claims
   * (BURNTICKER_RPC_URL set); absent → the weekly post prints "not published". SOL as decimal strings; `week` = the current Mon..Sun.
   */
  platformFeeSol?: { week: string | null; total: string | null; asOf: string | null } | null;
}

const ZERO = BigInt(0);
const sumRaw = (xs: readonly (bigint | null)[]) => xs.reduce<bigint>((a, b) => a + (b ?? ZERO), ZERO);
const pct = (part: bigint, whole: bigint) => (whole === ZERO ? 0 : Number((part * BigInt(1_000_000)) / whole) / 10_000);
const sol = (lamports: bigint | null | undefined) => (lamports === null || lamports === undefined ? null : rawToTokens(lamports, 9));

/** Recomputes every burn from the recorded readings and checks it against the row and its memo. */
export function buildBurnsJson(i: StatusInput): BurnJson[] {
  const { rules, sha12 } = i.loaded;
  const dec = rules.decimals;
  const readings = [...i.readings].sort((a, b) => (a.recordDate < b.recordDate ? -1 : 1));
  // Walk the readings from the baseline, recomputing the carry, so each burn's carry-in is DERIVED here, not trusted from the row.
  const derived = new Map<string, { carryIn: bigint; units: number; runSince: string | null }>();
  let prev: ReadingRow | null = null, carry = ZERO, runSince: string | null = null;
  for (const r of readings) {
    if (prev && r.kind !== "baseline") {
      const st = debtStep(rules, prev.cents, r.cents, carry);
      if (st.kind === "increase" && st.carryInCents === ZERO) runSince = prev.recordDate;
      derived.set(r.recordDate, { carryIn: st.carryInCents, units: st.units, runSince: st.carryInCents > ZERO ? runSince : null });
      carry = st.carryOutCents;
      if (st.kind !== "increase") runSince = null;
    }
    prev = r;
  }
  return i.burns.map((b) => {
    const d = derived.get(b.recordDate);
    const checks: string[] = [];
    const expectedPlanned = BigInt(b.units) * BigInt(rules.rule.burnPerUnitTokens);
    if (!d) checks.push("no recorded reading for this date");
    else {
      if (d.units !== b.units) checks.push(`units: recomputed ${d.units}, recorded ${b.units}`);
      if (d.carryIn !== b.carryInCents) checks.push(`carry in: recomputed $${centsToUsd(d.carryIn)}, recorded $${centsToUsd(b.carryInCents)}`);
    }
    if (rules.mode === "vault" && tokensToRaw(expectedPlanned, dec) !== b.plannedRaw) checks.push("planned amount ≠ units × burn per unit");
    const buyback = rules.mode === "buyback";
    const prog = b.execution === "program";
    if (prog && b.chainUnits !== null && b.chainUnits !== b.units) checks.push(`units: the program counted ${b.chainUnits}, the keeper planned ${b.units}`);
    if (!buyback && b.owedRaw !== null && b.burnRaw !== null && b.shortOutRaw !== null && b.owedRaw !== b.burnRaw + b.shortOutRaw) checks.push("owed ≠ burned + shortfall");
    let expectedSpend: bigint | null = null;
    const bps = Math.round(Number(rules.buyback.fractionPerUnit) * 10_000);
    if (buyback && prog && b.poolLamports !== null && b.ruleSpendLamports !== null) {
      // The program's own fixed-point rule spend (src/lib/burnReceipts/math.ts mirrors math.rs); the crank then spends at most 2 % of
      // the pool's reserve and carries the rest — so the check is the rule spend, and spent + carried out ≤ rule spend + carried in.
      expectedSpend = programBuybackSpend(b.poolLamports, BigInt(b.chainUnits ?? b.units), bps);
      if (expectedSpend !== b.ruleSpendLamports) checks.push(`rule spend: recomputed ${expectedSpend} lamports, the program recorded ${b.ruleSpendLamports}`);
      if (b.spendLamports !== null && b.carriedInLamports !== null && b.carriedOutLamports !== null && b.spendLamports + b.carriedOutLamports > b.ruleSpendLamports + b.carriedInLamports) checks.push("spent + carried out > rule spend + carried in");
    } else if (buyback && !prog && b.poolLamports !== null && b.spendLamports !== null) {
      expectedSpend = buybackSpend(b.poolLamports, b.units, rules.buyback.fractionPerUnit);
      if (expectedSpend !== b.spendLamports) checks.push(`spend: recomputed ${expectedSpend} lamports, recorded ${b.spendLamports}`);
    }
    const mb = buyback && b.memo ? parseBuybackMemo(b.memo) : null;
    if (buyback && b.memo) {
      if (!mb) checks.push("memo does not parse (v2)");
      else {
        if (mb.recordDate !== b.recordDate || mb.prev !== centsToUsd(b.prevCents) || mb.now !== centsToUsd(b.nowCents) || mb.delta !== centsToUsd(b.deltaCents) || mb.units !== (b.chainUnits ?? b.units)) checks.push("memo fields ≠ the recorded readings");
        if (mb.pool !== String(b.poolLamports ?? "") || mb.spent !== String(b.spendLamports ?? "")) checks.push("memo pool/spent ≠ the recorded spend");
        if (b.gotRaw !== null && mb.got !== rawToTokens(b.gotRaw, dec)) checks.push("memo got ≠ what the swap delivered");
        if (b.burnRaw !== null && mb.burn !== rawToTokens(b.burnRaw, dec)) checks.push("memo burn ≠ recorded burn");
        if (b.gotRaw !== null && b.burnRaw !== null && b.burnRaw < b.gotRaw) checks.push("burned less than the swap delivered");
        if (!prog && b.swapSig && mb.swap !== b.swapSig.slice(0, 12)) checks.push("memo swap ≠ the recorded swap signature");
        if (prog && mb.swap !== (b.swapPool ? b.swapPool.slice(0, 12) : "none")) checks.push("memo swap ≠ the pool the program swapped on");
        if (mb.rulesSha12 !== sha12) checks.push(`memo rules hash ${mb.rulesSha12} ≠ the published rule file ${sha12}`);
      }
    }
    const m = !buyback && b.memo ? parseDebtMemo(b.memo) : null;
    if (!buyback && b.memo && !m) checks.push("memo does not parse");
    if (m) {
      if (m.recordDate !== b.recordDate || m.prev !== centsToUsd(b.prevCents) || m.now !== centsToUsd(b.nowCents) || m.delta !== centsToUsd(b.deltaCents) || m.units !== (b.chainUnits ?? b.units)) checks.push("memo fields ≠ the recorded readings");
      if (b.burnRaw !== null && m.burn !== rawToTokens(b.burnRaw, dec)) checks.push("memo burn ≠ recorded burn");
      if (m.rulesSha12 !== sha12) checks.push(`memo rules hash ${m.rulesSha12} ≠ the published rule file ${sha12}`);
    }
    const verified = (b.status === "confirmed" || b.status === "skipped") && checks.length === 0;
    const carryTxt = b.carryInCents > ZERO ? ` + ${centsToUsd(b.carryInCents)} carried` : "";
    const shortTxt = b.shortInRaw && b.shortInRaw > ZERO ? ` + shortfall carried ${rawToTokens(b.shortInRaw, dec)}` : "";
    return {
      recordDate: b.recordDate, prevDate: b.prevDate, prev: centsToUsd(b.prevCents), now: centsToUsd(b.nowCents), delta: centsToUsd(b.deltaCents),
      carryIn: centsToUsd(b.carryInCents), carryRunSince: d?.runSince ?? null, units: b.units, planned: rawToTokens(b.plannedRaw, dec),
      shortIn: b.shortInRaw === null ? null : rawToTokens(b.shortInRaw, dec), owed: b.owedRaw === null ? null : rawToTokens(b.owedRaw, dec),
      burned: b.burnRaw === null ? null : rawToTokens(b.burnRaw, dec), shortOut: b.shortOutRaw === null ? null : rawToTokens(b.shortOutRaw, dec),
      status: b.status, memo: b.memo, signature: b.signature, txUrl: b.signature ? explorerUrl(i.chain.cluster, b.signature) : null, sourceUrl: rowUrl(b.recordDate),
      mode: rules.mode, pool: sol(b.poolLamports), spent: sol(b.spendLamports), got: b.gotRaw === null ? null : rawToTokens(b.gotRaw, dec),
      swapSig: b.swapSig, swapUrl: b.swapSig ? explorerUrl(i.chain.cluster, b.swapSig) : null, skippedReason: b.skippedReason,
      execution: prog ? "program" : "legacy", waitReason: b.waitReason,
      partial: [
        prog && (b.spendLamports ?? ZERO) > ZERO && (b.carriedOutLamports ?? ZERO) > ZERO ? `spend cap bound (2% of the pool's reserve): ${sol(b.spendLamports)} SOL spent, ${sol(b.carriedOutLamports)} SOL carried into the next crank` : null,
        prog && b.poolActualLamports !== null && b.poolLamports !== null && b.poolActualLamports > b.poolLamports ? `burn-pool cap bound: the rule applied to ${sol(b.poolLamports)} of ${sol(b.poolActualLamports)} SOL` : null,
      ].filter(Boolean).join("; ") || null,
      verify: buyback && prog ? {
        curl: `curl -s '${pairUrl(b.prevDate, b.recordDate)}'`,
        formula: `units = floor((${centsToUsd(b.nowCents)} − ${centsToUsd(b.prevCents)}${carryTxt}) / ${rules.rule.unitUsd}) = ${b.chainUnits ?? b.units}; rule spend = pool × (1 − (1 − ${bps}/10000)^units)${b.poolLamports !== null ? ` = ${b.poolLamports} × … = ${expectedSpend} lamports` : ""}; the program spends min(rule spend + ${sol(b.carriedInLamports) ?? "0"} SOL carried, 2% of the pool's SOL reserve) and carries the rest`,
        expected: b.status === "skipped" ? `nothing bought — ${b.skippedReason ?? "skipped"}` : b.waitReason ? `pending — ${b.waitReason}` : `rule spend ${expectedSpend ?? "?"} lamports; spent ${b.spendLamports ?? "pending"}; every token the fee PDA held burned (${b.burnRaw === null ? "pending" : rawToTokens(b.burnRaw, dec)})`,
        checks, verified,
      } : buyback ? {
        curl: `curl -s '${pairUrl(b.prevDate, b.recordDate)}'`,
        formula: `units = floor((${centsToUsd(b.nowCents)} − ${centsToUsd(b.prevCents)}${carryTxt}) / ${rules.rule.unitUsd}) = ${b.units}; spend = pool × (1 − (1 − ${rules.buyback.fractionPerUnit})^${b.units})${b.poolLamports !== null ? ` = ${b.poolLamports} × (1 − ${(1 - Number(rules.buyback.fractionPerUnit)).toFixed(6).replace(/0+$/, "")}^${b.units}) = ${expectedSpend} lamports` : ""}`,
        expected: b.status === "skipped" ? `nothing bought — ${b.skippedReason ?? "skipped"}` : `spend ${expectedSpend ?? "?"} lamports (${sol(expectedSpend) ?? "?"} SOL) buying ${rules.ticker} at market; burn every token received (${b.gotRaw === null ? "pending" : rawToTokens(b.gotRaw, dec)})`,
        checks, verified,
      } : {
        curl: `curl -s '${pairUrl(b.prevDate, b.recordDate)}'`,
        formula: `units = floor((${centsToUsd(b.nowCents)} − ${centsToUsd(b.prevCents)}${carryTxt}) / ${rules.rule.unitUsd}) = ${b.units}; burn = ${b.units} × ${rules.rule.burnPerUnitTokens} = ${expectedPlanned.toString()}${shortTxt}`,
        expected: `${expectedPlanned.toString()} ${rules.ticker}${b.shortOutRaw && b.shortOutRaw > ZERO ? ` owed; ${rawToTokens(b.burnRaw ?? ZERO, dec)} burned, ${rawToTokens(b.shortOutRaw, dec)} short (vault still vesting)` : ""}`,
        checks, verified,
      },
    };
  });
}

export function buildStatus(i: StatusInput, burnsJson: readonly BurnJson[] = buildBurnsJson(i)): StatusJson {
  const { rules, sha256 } = i.loaded;
  const dec = rules.decimals;
  const supplyRaw = tokensToRaw(rules.totalSupply, dec);
  const allocationRaw = tokensToRaw(rules.vaultAllocation, dec);
  const confirmed = i.burns.filter((b) => b.status === "confirmed");
  const totalRaw = sumRaw(confirmed.map((b) => b.burnRaw));
  const today = dateIn(i.now), month = today.slice(0, 7);
  const at = (b: BurnRow) => dateIn(b.confirmedAt ?? b.updatedAt);
  const todays = confirmed.filter((b) => at(b) === today && (b.burnRaw ?? ZERO) > ZERO), months = confirmed.filter((b) => at(b).startsWith(month) && (b.burnRaw ?? ZERO) > ZERO);
  const trailing = sumRaw(confirmed.filter((b) => (b.confirmedAt ?? 0) > i.now - 30 * 86_400_000).map((b) => b.burnRaw));
  const lastFinal = [...i.burns].reverse().find((b) => b.status === "confirmed" || b.status === "exhausted");
  const outstanding = lastFinal?.shortOutRaw ?? ZERO;
  const left = allocationRaw - totalRaw;
  const perDay = Number(trailing) / 30;
  const lastReading = i.readings.length ? i.readings[i.readings.length - 1] : null;
  const baseline = [...i.readings].sort((a, b) => (a.recordDate < b.recordDate ? -1 : 1)).find((r) => r.kind === "baseline") ?? null;
  const current = i.chain.supplyRaw ?? supplyRaw - totalRaw;
  const addr = (a: string | null) => (a ? explorerUrl(i.chain.cluster, a, "address") : null);
  return {
    schema: STATUS_SCHEMA, generatedAt: new Date(i.now).toISOString(), ticker: rules.ticker, ruleKey: rules.token, cluster: i.chain.cluster,
    addresses: { mint: i.chain.mint, vault: i.chain.vault, keeper: i.chain.keeper, mintUrl: addr(i.chain.mint), vaultUrl: addr(i.chain.vault), keeperUrl: addr(i.chain.keeper) },
    rules: { sha256, statement: rules.statement, unitUsd: rules.rule.unitUsd, burnPerUnitTokens: rules.rule.burnPerUnitTokens, file: "rules.json" },
    supply: { initial: rules.totalSupply, current: rawToTokens(current, dec), source: i.chain.supplyRaw !== null ? "chain" : "ledger" },
    burned: { total: rawToTokens(totalRaw, dec), pctOfSupply: pct(totalRaw, supplyRaw), today: rawToTokens(sumRaw(todays.map((b) => b.burnRaw)), dec), thisMonth: rawToTokens(sumRaw(months.map((b) => b.burnRaw)), dec), burnsToday: todays.length, burnsThisMonth: months.length, count: confirmed.filter((b) => (b.burnRaw ?? ZERO) > ZERO).length },
    shortfall: { outstanding: rawToTokens(outstanding, dec) },
    vault: {
      allocation: rules.vaultAllocation, balance: i.chain.vaultRaw === null ? null : rawToTokens(i.chain.vaultRaw, dec), allocationLeft: rawToTokens(left > ZERO ? left : ZERO, dec),
      trailing30d: rawToTokens(trailing, dec), projectedLifeDays: perDay > 0 ? Math.round(Number(left > ZERO ? left : ZERO) / perDay) : null,
      vesting: { kind: rules.vault.kind, cliffDays: rules.vault.cliffDays, vestDays: rules.vault.vestDays },
    },
    feed: { name: rules.feed.name, lastRecordDate: lastReading?.recordDate ?? null, lastAmount: lastReading?.amount ?? null, readings: i.readings.length,
      lastPollAt: i.lastPoll ? new Date(i.lastPoll.at).toISOString() : null, lastPollOutcome: i.lastPoll?.outcome ?? null, nextPollAt: i.nextPollAt ? new Date(i.nextPollAt).toISOString() : null,
      baseline: baseline ? { recordDate: baseline.recordDate, amount: baseline.amount } : null },
    health: { pending: i.burns.filter((b) => b.status === "planned" || b.status === "sending" || b.status === "swap-sent" || b.status === "swapped").length, lastError: i.lastError, unverified: burnsJson.filter((b) => b.status === "confirmed" && !b.verify.verified).length, waiting: i.burns.filter((b) => b.waitReason && (b.status === "planned" || b.status === "sending")).length },
    mode: rules.mode,
    execution: i.program ? "program" : "legacy",
    program: i.program ? buildProgramStatus(i.program, i.burns, i.chain.cluster, dec) : null,
    curve: i.curve ?? null,
    poolMarket: i.poolMarket ?? null,
    readiness: (() => {
      // one derivation for every page: no curve read here (null → "unavailable"), the program's pool flag, the newest burn row
      const last = [...i.burns].sort((x, y) => (x.recordDate < y.recordDate ? 1 : -1))[0] ?? null;
      const lj = last ? burnsJson.find((b) => b.recordDate === last.recordDate) ?? null : null;
      const c = i.curve ?? null;
      return readinessOf({ launched: !!i.chain.mint, phase: c?.phase ?? null, raisedSol: c ? Number(c.raised) : null, graduationSol: c && Number(c.threshold) > 0 ? Number(c.threshold) : undefined, poolVerified: i.program ? !!i.program.config?.poolRegistered : null,
        latest: last ? { status: last.status, units: last.units, skippedReason: last.skippedReason, waitReason: last.waitReason ?? null, checks: lj?.verify.checks, verified: lj?.verify.verified, burned: last.burnRaw !== null ? rawToTokens(last.burnRaw, dec) : null, readingDate: last.recordDate } : null });
    })(),
    buyback: rules.mode !== "buyback" ? null : (() => {
      const bought = i.burns.filter((b) => b.swapSig && b.spendLamports !== null && (b.status === "confirmed" || b.status === "swapped" || b.status === "sending"));
      const dayOf = (b: BurnRow) => dateIn(b.confirmedAt ?? b.updatedAt);
      const f = i.funding ?? null;
      const feePool = i.chain.feeLamports ?? null;
      return {
        feePoolSol: feePool === null ? null : sol(spendablePool(feePool, rules.buyback.reserveSol)), reserveSol: rules.buyback.reserveSol, fractionPerUnit: rules.buyback.fractionPerUnit, floorUsd: rules.buyback.floorUsd,
        spentSolToday: sol(sumRaw(bought.filter((b) => dayOf(b) === today).map((b) => b.spendLamports))) ?? "0",
        spentSolMonth: sol(sumRaw(bought.filter((b) => dayOf(b).startsWith(month)).map((b) => b.spendLamports))) ?? "0",
        spentSolTotal: sol(sumRaw(bought.map((b) => b.spendLamports))) ?? "0",
        boughtAndBurned: rawToTokens(sumRaw(confirmed.map((b) => b.burnRaw)), dec),
        skippedDays: i.burns.filter((b) => b.status === "skipped").length,
        funding: { feeWallet: i.program ? i.program.feePda : i.chain.keeper, feeWalletUrl: addr(i.program ? i.program.feePda : i.chain.keeper), creatorFeeSource: f?.creatorFeeSource ?? null, creatorFeeSourceUrl: addr(f?.creatorFeeSource ?? null),
          seedTx: f?.seedTx ?? null, seedTxUrl: f?.seedTx ? explorerUrl(i.chain.cluster, f.seedTx) : null, seedSol: f?.seedSol ?? null },
      };
    })(),
  };
}

const ATTESTER_KINDS: Record<number, string> = { 0: "operator", 1: "zkTLS relayer", 2: "oracle" };

/** The program block of status.json (see ProgramStatusInput). */
export function buildProgramStatus(p: ProgramStatusInput, burns: readonly BurnRow[], cluster: string, decimals: number): ProgramStatusJson {
  const c = p.config;
  const addr = (a: string) => explorerUrl(cluster, a, "address");
  const keys = new Set(p.keeperAttesterKeys);
  const onChain = p.programReadings.filter((r) => r.status === "confirmed" || r.status === "adopted");
  const last = onChain.length ? onChain[onChain.length - 1] : null;
  const held = [...p.programReadings].reverse().find((r) => r.status === "quorum-short" || r.status === "held" || r.status === "refused") ?? null;
  const lastOnChainDate = c?.hasBaseline ? fmtU32(c.lastRecordDate) : null;
  const pendingRows = burns.filter((b) => b.status === "planned" || b.status === "sending");
  const notOnChain = pendingRows.filter((b) => !lastOnChainDate || b.recordDate > lastOnChainDate).length;
  const holds = c ? c.attesters.filter((a) => keys.has(a.key)).length : 0;
  return {
    programId: p.programId, config: p.configAddress, feePda: p.feePda, feePdaUrl: addr(p.feePda), feePdaSol: sol(p.feePdaLamports), initialized: !!c,
    attestation: {
      attesters: (c?.attesters ?? []).map((a) => ({ key: a.key, kind: ATTESTER_KINDS[a.kind] ?? String(a.kind), url: addr(a.key), heldByKeeper: keys.has(a.key) })),
      quorum: c?.quorum ?? 0, keeperHolds: holds, quorumMet: !!c && holds >= c.quorum,
      pendingChange: c && c.pendingAttesters.length ? { attesters: c.pendingAttesters.map((a) => a.key), eta: c.pendingEta ? new Date(c.pendingEta * 1000).toISOString() : null } : null,
      adminRenounced: c?.adminRenounced ?? false,
      lastReading: last ? { recordDate: last.recordDate, value: centsToUsd(BigInt(last.value)), status: last.status, units: last.units, signature: last.signature, txUrl: last.signature ? explorerUrl(cluster, last.signature) : null } : null,
      readings: [...onChain].sort((a, b) => (a.recordDate < b.recordDate ? 1 : -1)).slice(0, 60).map((r) => ({ recordDate: r.recordDate, value: centsToUsd(BigInt(r.value)), units: r.units, signature: r.signature, txUrl: r.signature ? explorerUrl(cluster, r.signature) : null })),
      held: held && (!last || held.recordDate > last.recordDate) ? { recordDate: held.recordDate, status: held.status, why: held.error } : null,
    },
    queue: {
      lastOnChain: lastOnChainDate, crankCursor: c && c.crankCursor ? fmtU32(c.crankCursor) : null, readingsNotOnChain: notOnChain, awaitingCrank: pendingRows.length - notOnChain,
      carriedSpendSol: sol(c?.carriedSpendLamports ?? ZERO) ?? "0", carriedRemainderUsd: centsToUsd(c?.carry ?? ZERO),
      waits: pendingRows.filter((b) => b.waitReason).map((b) => ({ recordDate: b.recordDate, reason: b.waitReason! })),
      partials: burns.filter((b) => b.execution === "program" && (((b.spendLamports ?? ZERO) > ZERO && (b.carriedOutLamports ?? ZERO) > ZERO) || (b.poolActualLamports !== null && b.poolLamports !== null && b.poolActualLamports > b.poolLamports)))
        .map((b) => ({ recordDate: b.recordDate, note: [(b.carriedOutLamports ?? ZERO) > ZERO && (b.spendLamports ?? ZERO) > ZERO ? `${sol(b.carriedOutLamports)} SOL carried (2% reserve cap)` : null, b.poolActualLamports !== null && b.poolLamports !== null && b.poolActualLamports > b.poolLamports ? `burn-pool cap: ${sol(b.poolLamports)} of ${sol(b.poolActualLamports)} SOL` : null].filter(Boolean).join("; ") })),
    },
    pool: { registered: !!c?.poolRegistered, address: c?.pool ?? null, url: c?.pool ? addr(c.pool) : null, untradeableSince: c?.poolUntradeableSince ? new Date(c.poolUntradeableSince * 1000).toISOString() : null, lastCheck: p.lastHealth ?? null },
    totals: { burned: rawToTokens(c?.totalBurned ?? ZERO, decimals), spentSol: sol(c?.totalSpentLamports ?? ZERO) ?? "0", shortfall: rawToTokens(c?.shortfall ?? ZERO, decimals), readings: c?.readings ?? 0, burns: c?.burns ?? 0 },
    lastClaims: [...(p.lastClaims ?? [])],
  };
}
const fmtU32 = (d: number) => `${String(Math.floor(d / 10_000)).padStart(4, "0")}-${String(Math.floor(d / 100) % 100).padStart(2, "0")}-${String(d % 100).padStart(2, "0")}`;

/** The program section of index.html (attestation, queue, pool health). Empty in legacy mode. */
export function renderProgramHtml(p: ProgramStatusJson | null): string {
  if (!p) return "";
  const a = p.attestation, q = p.queue;
  const link = (url: string | null, text: string | null) => (url && text ? `<a href="${esc(url)}"><code>${esc(text)}</code></a>` : "—");
  return `<h2>The burn program</h2>
<p class="muted">Burns are executed by the burn_receipts program <code>${esc(p.programId)}</code>: it swaps from its fee PDA and burns in one instruction, and writes the memo itself. The keeper only attests the Treasury reading and pays the transaction fees; anyone can crank.${p.initialized ? "" : " <strong>Its config for this mint is not readable yet.</strong>"}</p>
<ul class="addr"><li><span class="muted">Fee PDA (the burn pool; no withdraw path exists)</span> ${link(p.feePdaUrl, p.feePda)}${p.feePdaSol !== null ? ` · ${esc(p.feePdaSol)} SOL` : ""}</li><li><span class="muted">Token config</span> <code>${esc(p.config)}</code></li></ul>
<h3>Attestation</h3>
<p>Quorum <strong>${a.quorum}</strong> of ${a.attesters.length}: ${a.attesters.map((x) => `${link(x.url, x.key)} (${esc(x.kind)}${x.heldByKeeper ? ", this keeper" : ""})`).join(", ") || "—"}. ${a.quorumMet ? "The keeper holds enough keys to submit alone." : `<span class="bad">The keeper holds ${a.keeperHolds} — readings wait for the other attester(s).</span>`}${a.pendingChange ? ` Pending attester change (48 h timelock): ${a.pendingChange.attesters.map((k) => `<code>${esc(k.slice(0, 8))}…</code>`).join(", ")}, applicable from ${esc(a.pendingChange.eta)}.` : ""}${a.adminRenounced ? " The config authority has renounced: the attester set can never change." : ""}</p>
<p>Last reading on chain: ${a.lastReading ? `${esc(a.lastReading.recordDate)} — $${esc(a.lastReading.value)}${a.lastReading.units !== null ? `, ${a.lastReading.units} unit(s)` : ""} · ${link(a.lastReading.txUrl, a.lastReading.signature ? `${a.lastReading.signature.slice(0, 12)}…` : null)}` : "none yet"}.${a.held ? ` <span class="bad">${esc(a.held.recordDate)} is held (${esc(a.held.status)}): ${esc(a.held.why)}</span>` : ""}</p>
<h3>Queue</h3>
<p>Last reading on chain ${esc(q.lastOnChain ?? "—")} · processed through ${esc(q.crankCursor ?? "—")} · ${q.readingsNotOnChain} burn day(s) not yet attested · ${q.awaitingCrank} attested and waiting for a crank · spend carried into the next crank: ${esc(q.carriedSpendSol)} SOL · remainder carried toward the next unit: $${esc(q.carriedRemainderUsd)}.</p>
${q.waits.length ? `<ul>${q.waits.map((w) => `<li>${esc(w.recordDate)}: ${esc(w.reason)}</li>`).join("")}</ul>` : ""}${q.partials.length ? `<p class="muted">Partial days (the program carried the rest): ${q.partials.map((x) => `${esc(x.recordDate)} — ${esc(x.note)}`).join("; ")}.</p>` : ""}
<h3>Pool</h3>
<p>${p.pool.registered ? `Registered CPMM pool ${link(p.pool.url, p.pool.address)} — ${p.pool.untradeableSince ? `<span class="bad">untradeable since ${esc(p.pool.untradeableSince)}</span> (anyone may replace_pool 7 days after)` : "tradeable"}${p.pool.lastCheck ? ` · last check: ${esc(p.pool.lastCheck)}` : ""}.` : "No pool registered yet: the token trades on its LaunchLab curve; after graduation anyone calls register_pool with the migrated CPMM pool (its creator must be the fee PDA)."}</p>
<p class="muted">Program totals: ${esc(p.totals.readings)} readings, ${esc(p.totals.burns)} burns, ${fmtTokens(p.totals.burned)} burned, ${esc(p.totals.spentSol)} SOL spent${p.totals.shortfall !== "0" ? `, shortfall ${fmtTokens(p.totals.shortfall)}` : ""}.</p>`;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------------------------------------------------------------

const esc = (s: string | number | null | undefined) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
const fmtTokens = (s: string) => { const [w, f] = s.split("."); return w.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (f ? `.${f}` : ""); };
const trillions = (amount: string) => `$${(Number(amount) / 1e12).toFixed(3)}T`;

/** The debt curve with burn markers, inline SVG (no script). Points are the recorded readings; markers sized by units. */
export function debtChartSvg(readings: readonly { recordDate: string; amount: string }[], burns: readonly { recordDate: string; units: number; status: string }[]): string {
  return seriesChartSvg(readings, burns, { ariaLabel: "U.S. total public debt outstanding, with a marker on each burn day", tick: (v) => `$${(v / 1e12).toFixed(2)}T` });
}

/** The same chart for any series (the Burnticker token pages, 2026-10-09): a time axis from `recordDate` (a date or an ISO time), the value, burn markers sized by units. */
export function seriesChartSvg(readings: readonly { recordDate: string; amount: string }[], burns: readonly { recordDate: string; units: number; status: string }[], opts: { ariaLabel: string; tick: (v: number) => string }): string {
  if (readings.length < 2) return `<p class="muted">The chart appears after the second reading.</p>`;
  const W = 720, H = 260, L = 64, R = 12, T = 14, B = 30;
  const xs = readings.map((r) => Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(r.recordDate) ? `${r.recordDate}T00:00:00Z` : /^\d{4}-\d{2}$/.test(r.recordDate) ? `${r.recordDate}-01T00:00:00Z` : r.recordDate)), ys = readings.map((r) => Number(r.amount));
  const x0 = xs[0], x1 = xs[xs.length - 1], yMin = Math.min(...ys), yMax = Math.max(...ys), pad = (yMax - yMin) * 0.06 || 1e9;
  const sx = (t: number) => L + ((t - x0) / Math.max(1, x1 - x0)) * (W - L - R);
  const sy = (v: number) => T + (1 - (v - (yMin - pad)) / (yMax - yMin + 2 * pad)) * (H - T - B);
  const line = readings.map((r, k) => `${sx(xs[k]).toFixed(1)},${sy(ys[k]).toFixed(1)}`).join(" ");
  const byDate = new Map(readings.map((r, k) => [r.recordDate, k]));
  const marks = burns.filter((b) => b.status === "confirmed" && byDate.has(b.recordDate)).map((b) => {
    const k = byDate.get(b.recordDate)!;
    return `<circle cx="${sx(xs[k]).toFixed(1)}" cy="${sy(ys[k]).toFixed(1)}" r="${(2 + Math.sqrt(b.units)).toFixed(1)}" class="mark"><title>${esc(b.recordDate)}: ${b.units} unit(s)</title></circle>`;
  }).join("");
  const ticks = [yMin, (yMin + yMax) / 2, yMax].map((v) => `<line x1="${L}" x2="${W - R}" y1="${sy(v).toFixed(1)}" y2="${sy(v).toFixed(1)}" class="grid"/><text x="${L - 6}" y="${(sy(v) + 4).toFixed(1)}" text-anchor="end" class="axis">${esc(opts.tick(v))}</text>`).join("");
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.ariaLabel)}" class="chart">${ticks}
<polyline points="${line}" class="line"/>${marks}
<text x="${L}" y="${H - 8}" class="axis">${esc(readings[0].recordDate)}</text><text x="${W - R}" y="${H - 8}" text-anchor="end" class="axis">${esc(readings[readings.length - 1].recordDate)}</text></svg>`;
}

export function renderIndexHtml(s: StatusJson, burns: readonly BurnJson[], readings: readonly { recordDate: string; amount: string }[]): string {
  const t = esc(s.ticker);
  const rows = [...burns].reverse();
  const tile = (label: string, value: string, sub = "") => `<div class="tile"><div class="label">${esc(label)}</div><div class="value">${value}</div>${sub ? `<div class="sub">${sub}</div>` : ""}</div>`;
  const life = s.vault.projectedLifeDays === null ? "—" : `${(s.vault.projectedLifeDays / 30.4375).toFixed(1)} months`;
  const addrLine = (label: string, a: string | null, url: string | null) => `<li><span class="muted">${esc(label)}</span> ${a ? `<a href="${esc(url)}"><code>${esc(a)}</code></a>` : "<em>not set yet</em>"}</li>`;
  const bb = s.buyback;
  const check = (b: BurnJson) => (b.verify.verified ? `<span class="ok" title="recomputed from the feed and the rule; matches the memo on chain">✓</span>` : b.status === "confirmed" ? `<span class="bad" title="${esc(b.verify.checks.join("; "))}">!</span>` : "…");
  const delta = (b: BurnJson) => `${Number(b.delta) >= 0 ? "+" : "−"}$${(Math.abs(Number(b.delta)) / 1e9).toFixed(2)}B`;
  const link = (url: string | null, sig: string | null, fallback: string) => (url && sig ? `<a href="${esc(url)}">${esc(sig.slice(0, 10))}…</a>` : esc(fallback));
  const empty = `<p class="muted">No burns yet. The first reading after launch is the baseline; the first burn day follows the first full $1B increase after it.</p>`;
  const table = rows.length === 0 ? empty : bb ? `<div class="scroll"><table>
<thead><tr><th>Record date</th><th>Debt change</th><th>Units</th><th>SOL spent</th><th>Bought</th><th>Burned</th><th>Swap</th><th>Burn tx</th><th>Source row</th><th>Check</th></tr></thead><tbody>
${rows.map((b) => `<tr><td>${esc(b.recordDate)}</td><td class="num">${delta(b)}</td><td class="num">${b.units}</td><td class="num">${b.status === "skipped" ? "—" : esc(b.spent ?? "pending")}</td><td class="num">${b.got === null ? (b.status === "skipped" ? "—" : "pending") : fmtTokens(b.got)}</td><td class="num">${b.status === "skipped" ? `<span class="muted" title="${esc(b.skippedReason)}">skipped</span>` : b.burned === null ? "pending" : fmtTokens(b.burned)}</td><td>${link(b.swapUrl, b.swapSig, b.status === "skipped" ? "—" : b.execution === "program" ? (b.signature ? "same tx" : "…") : "…")}</td><td>${link(b.txUrl, b.signature, b.status === "skipped" ? "—" : b.waitReason ? "waiting" : b.status)}</td><td><a href="${esc(b.sourceUrl)}">row</a></td><td>${check(b)}${b.partial ? ` <span class="muted" title="${esc(b.partial)}">partial</span>` : ""}</td></tr>`).join("\n")}
</tbody></table></div>` : `<div class="scroll"><table>
<thead><tr><th>Record date</th><th>Debt change</th><th>Units</th><th>Burned</th><th>Shortfall</th><th>Transaction</th><th>Source row</th><th>Check</th></tr></thead><tbody>
${rows.map((b) => `<tr><td>${esc(b.recordDate)}</td><td class="num">${delta(b)}</td><td class="num">${b.units}</td><td class="num">${b.burned === null ? "pending" : fmtTokens(b.burned)}</td><td class="num">${b.shortOut && b.shortOut !== "0" ? fmtTokens(b.shortOut) : "—"}</td><td>${link(b.txUrl, b.signature, b.status)}</td><td><a href="${esc(b.sourceUrl)}">row</a></td><td>${check(b)}</td></tr>`).join("\n")}
</tbody></table></div>`;
  const verify = rows.slice(0, 60).map((b) => `<details><summary>${esc(b.recordDate)} — ${b.units} unit(s), ${b.status === "skipped" ? "nothing bought" : b.burned === null ? "pending" : `${fmtTokens(b.burned)} ${t} burned`}${b.verify.verified ? " ✓" : ""}</summary>
<p>1. Fetch the two Treasury rows this ${bb ? "day" : "burn"} used:</p><pre><code>${esc(b.verify.curl)}</code></pre>
<p>2. Apply the rule:</p><pre><code>${esc(b.verify.formula)}</code></pre>
${b.carryRunSince ? `<p class="muted">The carried remainder ($${esc(b.carryIn)}) comes from the run of consecutive increases since ${esc(b.carryRunSince)} — each day's leftover under $1B, reset to 0 by any day the debt did not rise.</p>` : ""}
<p>3. Expected: <strong>${esc(b.verify.expected)}</strong></p>
${bb && b.swapUrl ? `<p>4. The swap (<a href="${esc(b.swapUrl)}">transaction</a>) delivered ${esc(b.got ?? "?")} ${t}; the burn transaction that followed carries this memo${b.txUrl ? ` (<a href="${esc(b.txUrl)}">transaction</a>)` : ""}:</p>` : `<p>4. The memo on chain${b.txUrl ? ` (<a href="${esc(b.txUrl)}">transaction</a>)` : ""}:</p>`}<pre><code>${esc(b.memo ?? (b.status === "skipped" ? `no transaction — ${b.skippedReason ?? "skipped"}` : "not sent yet"))}</code></pre>
${b.verify.checks.length ? `<p class="bad">Checks that did not pass: ${esc(b.verify.checks.join("; "))}</p>` : ""}
</details>`).join("\n");
  const fundingLine = bb ? `<p><strong>Where the money came from.</strong> The fee pool is the keeper's own SOL wallet ${bb.funding.feeWallet ? `<a href="${esc(bb.funding.feeWalletUrl)}"><code>${esc(bb.funding.feeWallet)}</code></a>` : "<em>not set yet</em>"}: the token's creator fees, claimed into it${bb.funding.creatorFeeSource ? ` from <a href="${esc(bb.funding.creatorFeeSourceUrl)}"><code>${esc(bb.funding.creatorFeeSource)}</code></a>` : ""}, ${bb.funding.seedTx ? `plus a disclosed seed of ${esc(bb.funding.seedSol ?? "?")} SOL (<a href="${esc(bb.funding.seedTxUrl)}">deposit transaction</a>)` : "and no seed deposit so far"}. The keeper holds nothing else, never sells, and sends tokens nowhere but the burn.</p>` : "";
  const tiles = bb ? [
    tile("Supply", fmtTokens(s.supply.current), `of ${fmtTokens(s.supply.initial)} (${esc(s.supply.source)})`),
    tile("Bought and burned", fmtTokens(bb.boughtAndBurned), `${s.burned.pctOfSupply.toFixed(2)}% of supply · ${s.burned.count} burns`),
    tile("Fee pool", bb.feePoolSol === null ? "—" : `${esc(bb.feePoolSol)} SOL`, `spendable, after a ${esc(bb.reserveSol)} SOL fee reserve`),
    tile("SOL spent today", `${esc(bb.spentSolToday)} SOL`, "ET"),
    tile("SOL spent this month", `${esc(bb.spentSolMonth)} SOL`, `${esc(bb.spentSolTotal)} SOL in all`),
    tile("Burned today", fmtTokens(s.burned.today), `${s.burned.burnsToday} burn(s), ET`),
    tile("Burned this month", fmtTokens(s.burned.thisMonth), `${s.burned.burnsThisMonth} burn(s) · ${bb.skippedDays} day(s) under the $${esc(bb.floorUsd)} floor`),
    tile("Next feed check", `<span id="next" data-at="${esc(s.feed.nextPollAt ?? "")}">${esc(s.feed.nextPollAt ?? "—")}</span>`, "Treasury posts each business day's figure the next afternoon"),
  ].join("\n") : [
    tile("Supply", fmtTokens(s.supply.current), `of ${fmtTokens(s.supply.initial)} (${esc(s.supply.source)})`),
    tile("Total burned", fmtTokens(s.burned.total), `${s.burned.pctOfSupply.toFixed(2)}% of supply · ${s.burned.count} burns`),
    tile("Burned today", fmtTokens(s.burned.today), `${s.burned.burnsToday} burn(s), ET`),
    tile("Burned this month", fmtTokens(s.burned.thisMonth), `${s.burned.burnsThisMonth} burn(s)`),
    tile("Vault balance", s.vault.balance === null ? "—" : fmtTokens(s.vault.balance), `allocation left ${fmtTokens(s.vault.allocationLeft)} of ${fmtTokens(s.vault.allocation)}`),
    tile("Vault life at 30-day pace", esc(life), `30-day burn ${fmtTokens(s.vault.trailing30d)}`),
    tile("Shortfall owed", fmtTokens(s.shortfall.outstanding), "burned when the vesting vault refills"),
    tile("Next feed check", `<span id="next" data-at="${esc(s.feed.nextPollAt ?? "")}">${esc(s.feed.nextPollAt ?? "—")}</span>`, "Treasury posts each business day's figure the next afternoon"),
  ].join("\n");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>$${t} burn record</title>
<meta name="description" content="Every $${t} burn, indexed to U.S. Treasury Debt to the Penny, with the source row and the arithmetic to check it.">
<style>
${STATUS_CSS}
</style></head><body><main>
<h1>$${t} burn record</h1>
<p class="muted">Rule key <code>${esc(s.ruleKey)}</code> · ${esc(s.cluster)} · updated <span id="gen">${esc(s.generatedAt)}</span></p>
<div class="rule"><strong>The rule.</strong> ${esc(s.rules.statement)}<br><span class="muted">Rule file: <a href="rules.json">rules.json</a> · sha256 <code>${esc(s.rules.sha256)}</code></span></div>
<div class="tiles">
${tiles}
</div>
<h2>U.S. total public debt outstanding</h2>
<p class="muted">Latest: ${s.feed.lastAmount ? `${trillions(s.feed.lastAmount)} on ${esc(s.feed.lastRecordDate)}` : "no reading yet"} · ${esc(s.feed.name)}. Dots mark burn days (larger = more units).</p>
${debtChartSvg(readings, burns)}
<h2>Burns</h2>
${table}
<h2>Verify it yourself</h2>
<p class="muted">Every burn can be recomputed from the public Treasury API and the rule file. The keeper recomputes each one from its recorded readings and shows ✓ when that agrees with the memo it put on chain.</p>
${verify || `<p class="muted">Nothing to verify yet.</p>`}
${s.program ? "" : fundingLine}
${renderProgramHtml(s.program)}
<h2>Addresses</h2>
<ul class="addr">${addrLine("Mint", s.addresses.mint, s.addresses.mintUrl)}${s.program ? `${addrLine("Fee PDA (the burn pool; the program spends it, nobody withdraws it)", s.program.feePda, s.program.feePdaUrl)}${addrLine("Keeper (attests readings, pays transaction fees; holds no funds)", s.addresses.keeper, s.addresses.keeperUrl)}` : `${addrLine(bb ? "Keeper's token account (burned from; empty between days)" : "Burn vault (token account)", s.addresses.vault, s.addresses.vaultUrl)}${addrLine(bb ? "Keeper (the fee pool wallet; the only signer)" : "Keeper (the vault's only authority)", s.addresses.keeper, s.addresses.keeperUrl)}`}</ul>
<p class="muted">${bb ? (s.program ? `Mechanic: buyback and burn by the burn_receipts program — each day with units, one crank spends 1 − (1 − ${esc(bb.fractionPerUnit)})^units of the fee PDA's pool (at most 2% of the pool's reserve per crank; the rest carried) on the registered pool and burns everything received, in one instruction.` : `Mechanic: buyback and burn — each day with units spends 1 − (1 − ${esc(bb.fractionPerUnit)})^units of the fee pool at market, then burns everything received.`) : `Vault: ${esc(s.vault.vesting.kind)}${s.vault.vesting.kind === "vesting" ? `, ${s.vault.vesting.vestDays}-day linear release after a ${s.vault.vesting.cliffDays}-day cliff` : ""}.`} Holders' balances are never touched: there is no delegate, no transfer hook and no mint authority.</p>
<footer>This page reports what a published rule did, from public data. It is not a forecast and says nothing about what the token's price will do. Health: ${s.health.pending} pending${s.health.waiting ? ` (${s.health.waiting} waiting)` : ""}, ${s.health.unverified} unverified${s.health.lastError ? ` · last error: ${esc(s.health.lastError)}` : ""}.</footer>
</main>
<script>
(function(){var el=document.getElementById("next");if(!el)return;var at=Date.parse(el.getAttribute("data-at")||"");if(!at)return;
function tick(){var d=Math.max(0,at-Date.now()),h=Math.floor(d/3.6e6),m=Math.floor(d%3.6e6/6e4),s=Math.floor(d%6e4/1e3);el.textContent=d?("in "+h+"h "+m+"m "+s+"s"):"now";}
tick();setInterval(tick,1000);})();
</script>
</body></html>
`;
}

/** The status site's stylesheet, shared with the Burnticker token pages (2026-10-09) so every page on the host looks the same. */
export const STATUS_CSS = `:root{--bg:#fbfaf7;--fg:#1c1b19;--muted:#6b6862;--card:#ffffff;--line:#e4e1da;--accent:#b4441f;--ok:#2f7d4f;--bad:#b3261e;--chart:#1c1b19}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--bg:#141413;--fg:#ecebe6;--muted:#a19e96;--card:#1d1c1a;--line:#2f2e2b;--accent:#e2774f;--ok:#6cc58f;--bad:#f2867d;--chart:#ecebe6}}
:root[data-theme="dark"]{--bg:#141413;--fg:#ecebe6;--muted:#a19e96;--card:#1d1c1a;--line:#2f2e2b;--accent:#e2774f;--ok:#6cc58f;--bad:#f2867d;--chart:#ecebe6}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:960px;margin:0 auto;padding:24px 16px 64px}h1{font-size:1.6rem;margin:0 0 4px}h2{font-size:1.15rem;margin:32px 0 8px}
.muted{color:var(--muted)}a{color:var(--accent)}code,pre{font:13px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace}
pre{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:10px;overflow-x:auto;white-space:pre-wrap;word-break:break-all}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin-top:16px}
.tile{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px}.label{font-size:.8rem;color:var(--muted)}.value{font-size:1.25rem;font-weight:600;font-variant-numeric:tabular-nums}.sub{font-size:.8rem;color:var(--muted)}
.rule{background:var(--card);border:1px solid var(--line);border-left:3px solid var(--accent);border-radius:8px;padding:12px 14px}
.chart{width:100%;height:auto;background:var(--card);border:1px solid var(--line);border-radius:10px}.chart .line{fill:none;stroke:var(--chart);stroke-width:1.6}.chart .mark{fill:var(--accent);fill-opacity:.75}.chart .grid{stroke:var(--line)}.chart .axis{fill:var(--muted);font-size:11px}
.scroll{overflow-x:auto;border:1px solid var(--line);border-radius:10px}table{border-collapse:collapse;width:100%;font-size:.9rem}th,td{padding:7px 10px;border-bottom:1px solid var(--line);text-align:left;white-space:nowrap}th{color:var(--muted);font-weight:500}td.num{text-align:right;font-variant-numeric:tabular-nums}
.ok{color:var(--ok);font-weight:700}.bad{color:var(--bad);font-weight:700}details{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:8px 12px;margin:6px 0}summary{cursor:pointer}
ul.addr{padding-left:18px}ul.addr code{word-break:break-all}footer{margin-top:40px;font-size:.85rem;color:var(--muted)}
`;

/** Writes the site atomically (tmp + rename per file), so a static host never serves a half-written page. */
export function publishSite(dir: string, files: Record<string, string>): void {
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(dir, name), tmp = `${file}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, content, { mode: 0o644 });
    fs.renameSync(tmp, file);
  }
}

/** JSON with BigInt-free values (everything above is already strings/numbers). */
export const toJson = (v: unknown): string => `${JSON.stringify(v, null, 2)}\n`;
