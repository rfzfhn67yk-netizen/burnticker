import type { Registry } from "@/lib/burnticker/registry";
import type { BurnRule } from "@/lib/burnticker/rules";
import type { FetchLike } from "@/lib/burnticker/oracle/types";
import { loadRefuseList, refusalsFor, type RefuseList } from "@/lib/burnticker/oracle/refuse";
import { loadOwnTokens, ownTokenRefusalFrom, type OwnTokenList } from "@/lib/ownTokens";
import { DERBY_MIN_LIQUIDITY_USD, INDEX_PROXIES_FLAG, INDEX_PROXY_SYMBOLS, indexProxiesEnabled, nextUtcMidnight, seasonEndMs, underlyingKey, type DerbySpec, type DerbyUnderlying } from "@/lib/burnticker/derby/spec";
import { cryptoBase, loadPythCatalogue, type PythFeedRow } from "@/lib/burnticker/derby/pyth";
import { crossQuote } from "@/lib/burnticker/derby/cross";
import { derbyStore } from "@/lib/burnticker/derby/store";
import type { Tournament } from "@/lib/burnticker/derby/bracket";

/**
 * WHAT BURN DERBY REFUSES AT LAUNCH (2026-10-10), on top of the rule's own validation:
 *   · an underlying that is a Burnticker platform coin (any registry token by mint or ticker, or config/own-tokens.json) — our coins
 *     never sit on the input side of anyone's rule;
 *   · an underlying whose symbol (or Pyth symbol) hits the refuse list (config/burnticker/refuse.json);
 *   · a Pyth feed id that is not a Crypto/USD feed in the catalogue; an underlying with no Pyth feed whose pool liquidity (read through
 *     its cross-read) is under $250,000;
 *   · the same coin twice (spec.ts); a season that starts before the next 00:00 UTC (no window may begin before the coin exists);
 *   · a bracket slot that does not match its registered tournament (sha256, slot, underlying, fraction), a slot already held, or a
 *     tournament that has started.
 * Returns every refusal (empty = admitted); network trouble on a liquidity read is an error the caller turns into 502.
 */

export interface DerbyAdmissionDeps {
  registry: Registry;
  fetchImpl: FetchLike;
  now: number;
  refuse?: RefuseList;
  env?: Readonly<Record<string, string | undefined>>;
  own?: OwnTokenList;
  catalogue?: readonly PythFeedRow[];
}

export interface DerbyRefusal { kind: "platform-coin" | "refuse-list" | "feed" | "liquidity" | "season" | "bracket"; symbol: string | null; reason: string }

async function underlyingRefusals(u: DerbyUnderlying, d: DerbyAdmissionDeps, cryptoOnly = true): Promise<DerbyRefusal[]> {
  const out: DerbyRefusal[] = [];
  const reg = d.registry;
  const platform = reg.tokens().find((t) => t.status !== "expired" && ((u.mint && t.mint === u.mint) || t.ticker === u.symbol));
  if (platform) out.push({ kind: "platform-coin", symbol: u.symbol, reason: `${u.symbol} is a Burnticker platform coin ($${platform.ticker}) — a platform coin is never the input of a derby` });
  const own = ownTokenRefusalFrom(d.own ?? loadOwnTokens(), { address: u.mint, symbol: u.symbol });
  if (own && !platform) out.push({ kind: "platform-coin", symbol: u.symbol, reason: `${u.symbol}: ${own}` });
  const cat = d.catalogue ?? loadPythCatalogue();
  const feed = u.pyth ? cat.find((r) => r.id === u.pyth) ?? null : null;
  for (const r of refusalsFor(d.refuse ?? loadRefuseList(), { titles: [u.symbol, ...(feed ? [feed.symbol] : [])] })) out.push({ kind: "refuse-list", symbol: u.symbol, reason: r.reason });
  if (u.pyth) {
    if (!feed) out.push({ kind: "feed", symbol: u.symbol, reason: `${u.symbol}: Pyth feed ${u.pyth.slice(0, 12)}… is not in the catalogue` });
    else if (cryptoOnly && (feed.asset_type !== "Crypto" || !cryptoBase(feed.symbol))) out.push({ kind: "feed", symbol: u.symbol, reason: `${u.symbol}: ${feed.symbol} is not a Crypto/USD feed (a coin-vs-coin derby compares coins)` });
    else if ((INDEX_PROXY_SYMBOLS as readonly string[]).includes(feed.symbol) && !indexProxiesEnabled(d.env)) out.push({ kind: "feed", symbol: u.symbol, reason: `${feed.symbol} is a US index proxy: excluded unless ${INDEX_PROXIES_FLAG}=1 (index-licence caution; fund tickers such as SPY, QQQ and DIA are available)` });
  } else {
    const q = await crossQuote(d.fetchImpl, u.cross);
    if (!q) out.push({ kind: "liquidity", symbol: u.symbol, reason: `${u.symbol}: the cross-read (${u.cross}) does not know this coin` });
    else if ((q.liquidityUsd ?? 0) < DERBY_MIN_LIQUIDITY_USD) out.push({ kind: "liquidity", symbol: u.symbol, reason: `${u.symbol}: no Pyth feed and $${Math.round(q.liquidityUsd ?? 0).toLocaleString("en-US")} of liquidity (needs $${DERBY_MIN_LIQUIDITY_USD.toLocaleString("en-US")})` });
  }
  return out;
}

export async function derbyAdmission(rule: BurnRule, d: DerbyAdmissionDeps): Promise<DerbyRefusal[]> {
  const spec = rule.derby as DerbySpec | undefined;
  if (!spec) return [{ kind: "feed", symbol: null, reason: "a derby rule needs its derby block" }];
  const out: DerbyRefusal[] = [];
  if (spec.selector === "coinvs") {
    if (underlyingKey(spec.a) === underlyingKey(spec.b)) out.push({ kind: "feed", symbol: null, reason: "the two coins must be distinct" });
    out.push(...await underlyingRefusals(spec.a, d), ...await underlyingRefusals(spec.b, d));
    const earliest = nextUtcMidnight(d.now);
    if (spec.season.start < earliest) out.push({ kind: "season", symbol: null, reason: `the season starts ${spec.season.start}: the earliest is ${earliest} (the first full window after launch)` });
    if (seasonEndMs(spec) > d.now + 400 * 86_400_000) out.push({ kind: "season", symbol: null, reason: "the season ends more than 400 days out" });
    return out;
  }
  if (spec.selector === "price") {
    out.push(...await underlyingRefusals(spec.u, d, false));
    const earliest = nextUtcMidnight(d.now);
    if (spec.season.start < earliest) out.push({ kind: "season", symbol: null, reason: `the season starts ${spec.season.start}: the earliest is ${earliest} (the first full window after launch)` });
    return out;
  }
  const row = derbyStore(d.registry.db).tournament(spec.tournamentId);
  if (!row) return [{ kind: "bracket", symbol: spec.underlying.symbol, reason: `no tournament ${spec.tournamentId} in the registry` }];
  const t = JSON.parse(row.json) as Tournament;
  if (row.sha256 !== spec.tournamentSha) out.push({ kind: "bracket", symbol: null, reason: `tournament ${t.id} is sha256 ${row.sha256.slice(0, 12)}…, the rule names ${spec.tournamentSha.slice(0, 12)}…` });
  const seeded = t.underlyings[spec.slot];
  if (!seeded) out.push({ kind: "bracket", symbol: null, reason: `tournament ${t.id} has no slot ${spec.slot}` });
  else if (JSON.stringify(seeded) !== JSON.stringify(spec.underlying) && underlyingKey(seeded) !== underlyingKey(spec.underlying)) out.push({ kind: "bracket", symbol: spec.underlying.symbol, reason: `slot ${spec.slot} of ${t.id} is ${seeded.symbol}, not ${spec.underlying.symbol}` });
  const m = rule.kind === "scalar" ? rule.scalar?.perUnit.fractionOfPool : undefined;
  if (m !== t.fractionOfPool) out.push({ kind: "bracket", symbol: null, reason: `a fan coin of ${t.id} burns ${t.fractionOfPool * 100}% per unit (the tournament's fraction), not ${m === undefined ? "a token count" : `${m * 100}%`}` });
  const taken = d.registry.tokens().find((x) => x.status !== "expired" && x.selectorKey === `derby:bracket:${t.id}:${spec.slot}`);
  if (taken) out.push({ kind: "bracket", symbol: spec.underlying.symbol, reason: `slot ${spec.slot} of ${t.id} already has its fan coin ($${taken.ticker})` });
  if (t.start < nextUtcMidnight(d.now)) out.push({ kind: "bracket", symbol: null, reason: `tournament ${t.id} started ${t.start}: fan coins launch before round one` });
  out.push(...await underlyingRefusals(spec.underlying, d));
  return out;
}
