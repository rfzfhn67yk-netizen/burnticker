import { advance, planReading, type LastReading } from "@/lib/burnKeeper/plan";
import { rawToTokens, settleBurn, tokensToRaw, vestedRaw, type DebtRuleFile } from "@/lib/burnKeeper/rules";
import type { DebtReading } from "@/lib/burnKeeper/feeds/treasury";

/**
 * THE REPLAY (burn keeper --replay / --vault-pace, 2026-10-09). Pure: the real Treasury series through the SAME planner and the SAME
 * settlement the keeper uses, with a modelled vault in place of the chain — "what would the keeper have burned since 2025-01-01".
 *
 * The vault model: `upfront` = the whole allocation is in the vault from day one (the spec's original 50% vault); `vesting` = the
 * LaunchLab vest (the owner, 10-09 evening) — released linearly over vestDays after cliffDays from the start, and (an assumption, said
 * out loud) claimed into the vault as it vests, so the vault holds vested − burned. A day the vault cannot cover burns what is there
 * and carries the rest as a shortfall, exactly as settleBurn does live.
 */

export interface ReplayRow {
  recordDate: string;
  prevDate: string;
  deltaCents: bigint;
  carryInCents: bigint;
  units: number;
  plannedRaw: bigint;
  shortInRaw: bigint;
  burnRaw: bigint;
  shortOutRaw: bigint;
  cumBurnRaw: bigint;
  /** Cumulative burned as % of total supply. */
  cumPctSupply: number;
  /** Allocation not yet burned, raw. */
  allocationLeftRaw: bigint;
  /** Trailing-30-calendar-day burn, raw. */
  trailing30Raw: bigint;
  /** Months the allocation left lasts at the trailing-30-day pace (null when the pace is zero). */
  lifeMonths: number | null;
}

export interface ReplayResult {
  baseline: DebtReading;
  rows: ReplayRow[];
  refusals: string[];
  readings: number;
  exhaustedOn: string | null;
}

export interface VaultModel { kind: "upfront" | "vesting"; allocationRaw: bigint; startMs: number; cliffDays: number; vestDays: number }

const ms = (d: string) => Date.parse(`${d}T00:00:00Z`);

/** Replays `readings` (oldest first) from the reading BEFORE `from` (the baseline) — one row per burn day. */
export function replay(rules: DebtRuleFile, readings: readonly DebtReading[], from: string, vault: VaultModel): ReplayResult {
  const sorted = [...readings].sort((a, b) => (a.recordDate < b.recordDate ? -1 : 1));
  const startIdx = sorted.findIndex((r) => r.recordDate >= from);
  if (startIdx <= 0) throw new Error(`replay needs a reading before ${from} as its baseline`);
  const baseline = sorted[startIdx - 1];
  const supplyRaw = tokensToRaw(rules.totalSupply, rules.decimals);
  let last: LastReading | null = { recordDate: baseline.recordDate, cents: baseline.cents, carryOutCents: BigInt(0) };
  let lastBurned: string | null = null, cum = BigInt(0), short = BigInt(0), exhaustedOn: string | null = null;
  const rows: ReplayRow[] = [], refusals: string[] = [];
  const history: { t: number; raw: bigint }[] = [];
  for (const r of sorted.slice(startIdx)) {
    const s = planReading(rules, last, lastBurned, r);
    if (s.kind === "refuse") { refusals.push(s.reason); break; }
    const prev = last;
    last = advance(last, s);
    if (s.kind !== "burn") continue;
    lastBurned = r.recordDate;
    const t = ms(r.recordDate);
    const available = vault.kind === "upfront" ? vault.allocationRaw : vestedRaw(vault.allocationRaw, vault.startMs, t, vault.cliffDays, vault.vestDays);
    const st = settleBurn({ plannedRaw: s.plannedRaw, shortfallInRaw: short, vaultRaw: available - cum, allocationLeftRaw: vault.allocationRaw - cum });
    if (st.exhausted) { exhaustedOn ??= r.recordDate; continue; }
    const shortIn = short;
    cum += st.burnRaw; short = st.shortfallRaw;
    if (cum >= vault.allocationRaw) exhaustedOn ??= r.recordDate;
    history.push({ t, raw: st.burnRaw });
    const trailing = history.filter((h) => h.t > t - 30 * 86_400_000).reduce((a, h) => a + h.raw, BigInt(0));
    const left = vault.allocationRaw - cum;
    rows.push({
      recordDate: r.recordDate, prevDate: prev!.recordDate, deltaCents: s.step.deltaCents, carryInCents: s.step.carryInCents, units: s.step.units,
      plannedRaw: s.plannedRaw, shortInRaw: shortIn, burnRaw: st.burnRaw, shortOutRaw: st.shortfallRaw, cumBurnRaw: cum,
      cumPctSupply: pct(cum, supplyRaw), allocationLeftRaw: left, trailing30Raw: trailing,
      lifeMonths: trailing > BigInt(0) ? Number((left * BigInt(1000)) / trailing) / 1000 : null,
    });
  }
  return { baseline, rows, refusals, readings: sorted.length - startIdx, exhaustedOn };
}

export const pct = (part: bigint, whole: bigint): number => (whole === BigInt(0) ? 0 : Number((part * BigInt(1_000_000)) / whole) / 10_000);

export interface MonthLine { month: string; burnDays: number; units: number; burnRaw: bigint; pctSupply: number; shortDays: number }

/** Per-calendar-month totals (by record_date). */
export function byMonth(rules: DebtRuleFile, rows: readonly ReplayRow[]): MonthLine[] {
  const supplyRaw = tokensToRaw(rules.totalSupply, rules.decimals);
  const m = new Map<string, MonthLine>();
  for (const r of rows) {
    const k = r.recordDate.slice(0, 7);
    const x = m.get(k) ?? { month: k, burnDays: 0, units: 0, burnRaw: BigInt(0), pctSupply: 0, shortDays: 0 };
    x.burnDays++; x.units += r.units; x.burnRaw += r.burnRaw; if (r.shortOutRaw > BigInt(0)) x.shortDays++;
    m.set(k, x);
  }
  return [...m.values()].map((x) => ({ ...x, pctSupply: pct(x.burnRaw, supplyRaw) }));
}

export interface PaceLine {
  sharePct: number;
  allocationTokens: string;
  burnedTokens: string;
  burnedPctOfAllocation: number;
  shortfallDays: number;
  burnDays: number;
  maxShortfallTokens: string;
  /** Months from the start until the allocation is used up — measured inside the window, else extrapolated at the window's mean pace. */
  monthsLasts: number;
  extrapolated: boolean;
  /** For comparison: months the same allocation lasts with NO vest (all in the vault on day one) at the rule's appetite. */
  monthsIfUpfront: number;
  /** The rule's appetite over the window, % of supply per month (the same for every share). */
  appetitePctPerMonth: number;
}

/**
 * --vault-pace (the owner, 10-09 evening): for vault shares of supply (20/25/30%) under a linear vest, replay the real series and say
 * how long each allocation lasts and how often the vault would have come up short. Pure.
 */
export function vaultPace(rules: DebtRuleFile, readings: readonly DebtReading[], from: string, shares: readonly number[], vestDays: number, cliffDays = 0): PaceLine[] {
  const supply = BigInt(rules.totalSupply);
  return shares.map((sharePct) => {
    const allocTokens = (supply * BigInt(Math.round(sharePct * 100))) / BigInt(10_000);
    const allocationRaw = tokensToRaw(allocTokens, rules.decimals);
    const res = replay(rules, readings, from, { kind: "vesting", allocationRaw, startMs: ms(from), cliffDays, vestDays });
    const burned = res.rows.length ? res.rows[res.rows.length - 1].cumBurnRaw : BigInt(0);
    const maxShort = res.rows.reduce((a, r) => (r.shortOutRaw > a ? r.shortOutRaw : a), BigInt(0));
    const last = res.rows.length ? res.rows[res.rows.length - 1].recordDate : from;
    const spanMonths = (ms(last) - ms(from)) / (30.4375 * 86_400_000);
    let monthsLasts: number, extrapolated = false;
    if (res.exhaustedOn) monthsLasts = (ms(res.exhaustedOn) - ms(from)) / (30.4375 * 86_400_000);
    else {
      // Unconstrained pace over the window (planned, not vault-limited): the rule's appetite, which the vest eventually stops limiting.
      const planned = res.rows.reduce((a, r) => a + r.plannedRaw, BigInt(0));
      const perMonth = spanMonths > 0 ? Number(planned) / spanMonths : 0;
      monthsLasts = perMonth > 0 ? spanMonths + Number(allocationRaw - burned) / perMonth : Infinity;
      extrapolated = true;
    }
    const up = replay(rules, readings, from, { kind: "upfront", allocationRaw, startMs: ms(from), cliffDays: 0, vestDays: 0 });
    const app = replay(rules, readings, from, { kind: "upfront", allocationRaw: tokensToRaw(rules.totalSupply, rules.decimals), startMs: ms(from), cliffDays: 0, vestDays: 0 });
    const appLast = app.rows.length ? app.rows[app.rows.length - 1] : null;
    const appMonths = appLast ? (ms(appLast.recordDate) - ms(from)) / (30.4375 * 86_400_000) : 0;
    const appetitePctPerMonth = appLast && appMonths > 0 ? appLast.cumPctSupply / appMonths : 0;
    const monthsIfUpfront = up.exhaustedOn ? (ms(up.exhaustedOn) - ms(from)) / (30.4375 * 86_400_000) : appetitePctPerMonth > 0 ? sharePct / appetitePctPerMonth : Infinity;
    return {
      monthsIfUpfront, appetitePctPerMonth,
      sharePct, allocationTokens: allocTokens.toString(), burnedTokens: rawToTokens(burned, rules.decimals), burnedPctOfAllocation: pct(burned, allocationRaw),
      shortfallDays: res.rows.filter((r) => r.shortOutRaw > BigInt(0)).length, burnDays: res.rows.length,
      maxShortfallTokens: rawToTokens(maxShort, rules.decimals), monthsLasts, extrapolated,
    };
  });
}

const fmtInt = (s: string) => { const [w, f] = s.split("."); return w.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (f ? `.${f}` : ""); };

/** The replay as markdown: summary, per-month table, the biggest days, then every burn. Pure (the doc in docs/burnkeeper/ is this). */
export function replayMarkdown(rules: DebtRuleFile, res: ReplayResult, o: { from: string; to: string; source: string; sha256: string; vaultLabel: string }): string {
  const dec = rules.decimals;
  const rows = res.rows;
  const months = byMonth(rules, rows);
  const total = rows.length ? rows[rows.length - 1].cumBurnRaw : BigInt(0);
  const planned = rows.reduce((a, r) => a + r.plannedRaw, BigInt(0));
  const supplyRaw = tokensToRaw(rules.totalSupply, dec);
  const biggest = [...rows].sort((a, b) => (b.units - a.units) || (a.recordDate < b.recordDate ? -1 : 1)).slice(0, 5);
  const shortDays = rows.filter((r) => r.shortOutRaw > BigInt(0)).length;
  const avgMonthPct = months.length ? months.reduce((a, m) => a + m.pctSupply, 0) / months.length : 0;
  const L: string[] = [];
  L.push(`# $${rules.ticker} burn keeper — replay of the real Treasury series, ${o.from} → ${o.to}`);
  L.push("");
  L.push(`Generated by \`node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/alias-hook.mjs scripts/burn-keeper.mts --replay=${o.from} --to=${o.to}\` from ${o.source}. Rule file sha256 \`${o.sha256}\` (memo \`rules=sha256:${o.sha256.slice(0, 12)}\`). The replay runs the keeper's own planner and settlement (src/lib/burnKeeper/plan.ts, rules.ts) over every business-day reading; nothing here is a re-implementation.`);
  L.push("");
  L.push(`Rule: every full $${fmtInt(rules.rule.unitUsd)} added to tot_pub_debt_out_amt vs the previous reading = 1 unit = ${fmtInt(rules.rule.burnPerUnitTokens)} tokens (0.01% of ${fmtInt(rules.totalSupply)}); the remainder carries only across consecutive increases; a down or flat day burns nothing and resets it. Baseline: ${res.baseline.recordDate} ($${res.baseline.amount}).`);
  L.push("");
  L.push(`Vault model: ${o.vaultLabel}.`);
  L.push("");
  L.push("## Summary");
  L.push("");
  L.push(`- Readings replayed: ${res.readings}; burn days: **${rows.length}**; units: ${rows.reduce((a, r) => a + r.units, 0).toLocaleString("en-US")}`);
  L.push(`- Rule asked for ${fmtInt(rawToTokens(planned, dec))} tokens (${pct(planned, supplyRaw).toFixed(2)}% of supply); burned **${fmtInt(rawToTokens(total, dec))}** (${pct(total, supplyRaw).toFixed(2)}% of supply)`);
  L.push(`- Average burned per month: **${avgMonthPct.toFixed(2)}% of supply** over ${months.length} months`);
  L.push(`- Biggest single day: **${biggest[0] ? `${biggest[0].recordDate}, ${billions(biggest[0].deltaCents)} → ${biggest[0].units} units = ${fmtInt(rawToTokens(biggest[0].plannedRaw, dec))} tokens (${pct(biggest[0].plannedRaw, supplyRaw).toFixed(2)}% of supply)` : "—"}**`);
  L.push(`- Days the vault came up short (shortfall carried): ${shortDays}${shortDays ? `; outstanding at the end ${fmtInt(rawToTokens(rows[rows.length - 1].shortOutRaw, dec))}` : ""}`);
  if (res.exhaustedOn) L.push(`- The vault allocation was used up on ${res.exhaustedOn}`);
  if (res.refusals.length) L.push(`- Refusals: ${res.refusals.join("; ")}`);
  L.push("");
  L.push("## By month");
  L.push("");
  L.push("| Month | Burn days | Units | Burned | % of supply | Short days |");
  L.push("|---|---:|---:|---:|---:|---:|");
  for (const m of months) L.push(`| ${m.month} | ${m.burnDays} | ${m.units} | ${fmtInt(rawToTokens(m.burnRaw, dec))} | ${m.pctSupply.toFixed(2)}% | ${m.shortDays} |`);
  L.push("");
  L.push("## Five biggest days");
  L.push("");
  L.push("| Record date | Debt change | Units | Rule's burn | % of supply |");
  L.push("|---|---:|---:|---:|---:|");
  for (const r of biggest) L.push(`| ${r.recordDate} | ${billions(r.deltaCents)} | ${r.units} | ${fmtInt(rawToTokens(r.plannedRaw, dec))} | ${pct(r.plannedRaw, supplyRaw).toFixed(2)}% |`);
  L.push("");
  L.push("## Every burn");
  L.push("");
  L.push("| Record date | Debt change | Carry in | Units | Burned | Short | Cum. % of supply | Vault left | Vault life (30-day pace) |");
  L.push("|---|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const r of rows) L.push(`| ${r.recordDate} | ${billions(r.deltaCents)} | ${r.carryInCents > BigInt(0) ? billions(r.carryInCents).replace("+", "") : "—"} | ${r.units} | ${fmtInt(rawToTokens(r.burnRaw, dec))} | ${r.shortOutRaw > BigInt(0) ? fmtInt(rawToTokens(r.shortOutRaw, dec)) : "—"} | ${r.cumPctSupply.toFixed(2)}% | ${fmtInt(rawToTokens(r.allocationLeftRaw, dec))} | ${r.lifeMonths === null ? "—" : `${r.lifeMonths.toFixed(1)} mo`} |`);
  L.push("");
  return L.join("\n");
}

/** --vault-pace as a plain table. */
export function paceTable(lines: readonly PaceLine[], o: { from: string; to: string; vestDays: number; cliffDays: number }): string {
  const L = [`Vault pace — real Treasury series ${o.from} → ${o.to}; linear vest over ${o.vestDays} days after a ${o.cliffDays}-day cliff, starting ${o.from} (vesting starts at GRADUATION on LaunchLab — a later graduation shifts every shortfall later)`, ""];
  L.push("| Vault share | Allocation | Burned in window | % of allocation | Lasts, vesting (months from start) | Short days / burn days | Largest shortfall | Lasts with no vest |");
  L.push("|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const p of lines) L.push(`| ${p.sharePct}% | ${fmtInt(p.allocationTokens)} | ${fmtInt(p.burnedTokens)} | ${p.burnedPctOfAllocation.toFixed(1)}% | ${Number.isFinite(p.monthsLasts) ? p.monthsLasts.toFixed(1) : "∞"}${p.extrapolated ? " (extrapolated)" : ""} | ${p.shortfallDays} / ${p.burnDays} (${p.burnDays ? ((100 * p.shortfallDays) / p.burnDays).toFixed(0) : 0}%) | ${fmtInt(p.maxShortfallTokens)} | ${Number.isFinite(p.monthsIfUpfront) ? p.monthsIfUpfront.toFixed(1) : "∞"} |`);
  if (lines[0]) {
    const vestRate = (s: number) => (s / (o.vestDays / 30.4375)).toFixed(2);
    L.push("");
    L.push(`The rule's appetite over the window: ${lines[0].appetitePctPerMonth.toFixed(2)}% of supply per month. A ${o.vestDays}-day vest releases ${lines.map((p) => `${vestRate(p.sharePct)}%/month (${p.sharePct}%)`).join(", ")} — when the appetite is above the release, the VEST sets the pace, the vault runs dry as the vest ends, and shortfalls are routine; any shortfall still owed when the allocation is used up is never burned (vault-only).`);
  }
  return L.join("\n");
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Buyback mode scenarios (the owner, 2026-10-09 evening: show burned supply under fee-pool inflows of $20 / $100 / $500 a day)
// ---------------------------------------------------------------------------------------------------------------------------------

export interface BuybackScenario {
  inflowUsdPerDay: number;
  tokenPriceUsd: number;
  burnDays: number;
  skippedDays: number;
  inflowUsd: number;
  spentUsd: number;
  burnedTokens: number;
  pctSupply: number;
  pctPerMonth: number;
  endPoolUsd: number;
  biggest: { recordDate: string; units: number; spendUsd: number; tokens: number } | null;
  months: { month: string; spentUsd: number; tokens: number; pctSupply: number }[];
}

/**
 * The buyback rule over the real series, as a SCENARIO (pure): the fee pool fills at a constant `inflowUsdPerDay` (every calendar
 * day, from `from`), each burn day spends pool × (1 − (1 − f)^units) unless that is under the floor, and the spend buys tokens at a
 * CONSTANT `tokenPriceUsd`. What it leaves out, said plainly: price impact, the price moving at all (buying pushes it up, so these
 * token counts are an upper bound at that price), SOL's own price, fees. Burned tokens scale with inflow ÷ price.
 */
export function buybackScenario(rules: DebtRuleFile, readings: readonly DebtReading[], from: string, inflowUsdPerDay: number, tokenPriceUsd: number): BuybackScenario {
  const res = replay(rules, readings, from, { kind: "upfront", allocationRaw: tokensToRaw(rules.totalSupply, rules.decimals), startMs: ms(from), cliffDays: 0, vestDays: 0 });
  const f = Number(rules.buyback.fractionPerUnit), floor = Number(rules.buyback.floorUsd), supply = Number(rules.totalSupply);
  let pool = 0, lastT = ms(from), spent = 0, tokens = 0, skipped = 0, inflow = 0;
  let biggest: BuybackScenario["biggest"] = null;
  const months = new Map<string, { month: string; spentUsd: number; tokens: number; pctSupply: number }>();
  for (const r of res.rows) {
    const t = ms(r.recordDate);
    const add = inflowUsdPerDay * Math.max(0, (t - lastT) / 86_400_000);
    pool += add; inflow += add; lastT = t;
    const spend = pool * (1 - (1 - f) ** r.units);
    if (spend < floor) { skipped++; continue; }
    pool -= spend; spent += spend;
    const got = spend / tokenPriceUsd;
    tokens += got;
    if (!biggest || spend > biggest.spendUsd) biggest = { recordDate: r.recordDate, units: r.units, spendUsd: spend, tokens: got };
    const k = r.recordDate.slice(0, 7), m = months.get(k) ?? { month: k, spentUsd: 0, tokens: 0, pctSupply: 0 };
    m.spentUsd += spend; m.tokens += got; m.pctSupply = (100 * m.tokens) / supply; months.set(k, m);
  }
  const last = res.rows.length ? ms(res.rows[res.rows.length - 1].recordDate) : ms(from);
  const spanMonths = (last - ms(from)) / (30.4375 * 86_400_000);
  return { inflowUsdPerDay, tokenPriceUsd, burnDays: res.rows.length - skipped, skippedDays: skipped, inflowUsd: inflow, spentUsd: spent, burnedTokens: tokens, pctSupply: (100 * tokens) / supply,
    pctPerMonth: spanMonths > 0 ? (100 * tokens) / supply / spanMonths : 0, endPoolUsd: pool, biggest, months: [...months.values()] };
}

/** The three-scenario table for the replay doc. */
export function buybackScenariosMarkdown(rules: DebtRuleFile, readings: readonly DebtReading[], from: string, to: string, inflows: readonly number[], tokenPriceUsd: number): string {
  const sc = inflows.map((x) => buybackScenario(rules, readings, from, x, tokenPriceUsd));
  const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
  const L: string[] = [];
  L.push(`## Buyback mode (the primary mechanic) — fee-pool scenarios, ${from} → ${to}`);
  L.push("");
  L.push(`Each burn day spends pool × (1 − (1 − ${rules.buyback.fractionPerUnit})^units) of the fee pool (days under the $${rules.buyback.floorUsd} floor buy nothing; the pool keeps it). The pool fills at a constant rate every calendar day; tokens are bought at a CONSTANT price of $${tokenPriceUsd} (a ${usd(tokenPriceUsd * Number(rules.totalSupply))} fully diluted value). Not modelled: price impact, the price responding to the buying (so token counts are an upper bound at that price), SOL's price, network fees. Burned supply scales with inflow ÷ price: double the price, half the tokens.`);
  L.push("");
  L.push("| Fee inflow | Inflow total | Spent | Tokens bought and burned | % of supply | % per month | Burn days | Skipped (floor) | Pool left | Biggest day |");
  L.push("|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|");
  for (const s of sc) L.push(`| ${usd(s.inflowUsdPerDay)}/day | ${usd(s.inflowUsd)} | ${usd(s.spentUsd)} | ${Math.round(s.burnedTokens).toLocaleString("en-US")} | ${s.pctSupply.toFixed(2)}% | ${s.pctPerMonth.toFixed(2)}% | ${s.burnDays} | ${s.skippedDays} | ${usd(s.endPoolUsd)} | ${s.biggest ? `${s.biggest.recordDate}: ${s.biggest.units} units, ${usd(s.biggest.spendUsd)} → ${Math.round(s.biggest.tokens).toLocaleString("en-US")}` : "—"} |`);
  L.push("");
  L.push(`By month, % of supply burned (${sc.map((s) => `${usd(s.inflowUsdPerDay)}/day`).join(" · ")}):`);
  L.push("");
  L.push(`| Month | ${sc.map((s) => `${usd(s.inflowUsdPerDay)}/day`).join(" | ")} |`);
  L.push(`|---|${sc.map(() => "---:").join("|")}|`);
  const monthsAll = [...new Set(sc.flatMap((s) => s.months.map((m) => m.month)))].sort();
  for (const k of monthsAll) L.push(`| ${k} | ${sc.map((s) => { const m = s.months.find((x) => x.month === k); return m ? `${m.pctSupply.toFixed(3)}%` : "—"; }).join(" | ")} |`);
  L.push("");
  return L.join("\n");
}

/** "$21.28B" — for the replay tables. */
export function billions(cents: bigint): string {
  const neg = cents < BigInt(0); const a = neg ? -cents : cents;
  const tenthsOfMillions = a / BigInt(1_000_000_000);   // cents → $10M units
  const s = (Number(tenthsOfMillions) / 100).toFixed(2);
  return `${neg ? "−" : "+"}$${s}B`;
}
