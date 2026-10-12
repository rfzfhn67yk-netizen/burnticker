import fs from "node:fs";
import path from "node:path";
import { lockRule, ruleStatement, DEFAULT_ON_END, DEFAULT_WIND_DOWN_DAYS, type BurnRule, type LockedRule } from "@/lib/burnticker/rules";
import { allocationFor } from "@/lib/burnticker/launchBundle";
import { CURVE_FEES, POST_GRADUATION_FEES, bpsPerSol, LP_LOCKED_PCT, PRE_AUDIT_POOL_CAP_SOL } from "@/lib/burnticker/fees";
import { describeRule } from "@/lib/burnticker/describe";
import { creatorTextProblems, NOTE_MAX, serverDescribeCtx } from "@/lib/burnticker/coinText";
import { presetProblem, presetRowLabel, shareOf, shareShapeOf, pctLabel } from "@/lib/burnticker/launchPresets";
import { availabilityFromEnv, hostCluster, launchTypeOf, type LaunchAvailabilityModel, type LaunchType } from "@/lib/burnticker/launchAvailability";
import { GRADUATION_SOL } from "@/lib/burnticker/readiness";
import { OPERATOR_LINE } from "@/lib/burnticker/trustpack/copy";

/**
 * THE READ-ONLY REVIEW PAYLOAD (ChatGPT launch audit 5, L02 / L06, 2026-10-11): everything a creator should see before connecting a
 * wallet, computed without building, pinning, registering or reading the chain — so it works in PREVIEW mode as well as OPEN, and a
 * bot can check it before it asks for a bundle. POST /api/burnticker/v1/launch/review; the wizard's sign card shows it.
 *
 *   network, launch type and whether this host takes it · the canonical rule text, its sha256 and statement · names and tickers ·
 *   the generated description · allocation · the fee split per 1 SOL traded (curve and after graduation) · the transactions the bundle
 *   will hold and who signs each · estimated SOL (rent, the reserve moved into the burn pool, network fees) · the prerequisites
 *   before any burn (graduation, the pre-audit cap) · how the rule ends (the deployed 28-day self-burn wind-down) · who can change what
 *   (the rule hash is pinned per coin; the programs are upgradeable by the Squads vault) · the operator line · every problem found.
 *
 * Nothing here is a promise about price or return. The estimate is an estimate: the wallet shows the exact amount before approval.
 */

/** `pair` = side B of a registered pair (its rule is derived from side A's); `companion` = a second, independent coin launched alongside (a matchup's other team). */
export interface ReviewInput { rule?: unknown; ticker?: unknown; name?: unknown; note?: unknown; descCtx?: unknown; pair?: { ticker?: unknown; name?: unknown } | null; companion?: { ticker?: unknown; name?: unknown } | null; warnings?: unknown }
export interface ReviewCost { label: string; sol: string; kind: "rent" | "reserve" | "fee" }
export interface LaunchReview {
  schema: "burnticker.launch-review/v1";
  network: string;
  mode: LaunchAvailabilityModel["mode"];
  type: LaunchType | null;
  typeAvailable: boolean;
  typeReason: string | null;
  /** True only when this host would build the bundle for this request now (open mode, type available, no problem). */
  signable: boolean;
  rule: { text: string; sha256: string; sha12: string; statement: string; sentence: string; share: string; presets: string; endsLine: string };
  coins: { side: "A" | "B"; name: string; ticker: string; description: string | null }[];
  allocation: { supply: string; curve: string; locked: string; reserve: string; teamAllocationPct: 0; lpLockedPct: number };
  feesPerSol: { phase: "curve" | "post-graduation"; legs: { label: string; sol: string }[]; totalSol: string }[];
  transactions: { count: number; steps: { label: string; signers: string[] }[]; note: string };
  costs: { lines: ReviewCost[]; totalSol: string; note: string };
  prerequisites: string[];
  authority: string;
  operator: string;
  warnings: string[];
  problems: string[];
}

/** Rent-exempt minimum for an account of `bytes` (Solana: (bytes + 128) × 3,480 lamports/byte-year × 2 years). */
export const rentLamports = (bytes: number): number => (bytes + 128) * 3480 * 2;
/** Byte sizes the launch creates per coin (programs/burn-receipts TokenConfig, measured 2026-10-10; REHEARSAL-RUNSHEET §0.1). */
export const TOKEN_CONFIG_BYTES = 863;
/** LaunchLab create's account rent (pool state, two vaults, metadata), measured on the 2026-10-10 rehearsal (REHEARSAL-RUNSHEET §0.1). */
export const LAUNCHLAB_CREATE_RENT_SOL = 0.03;
export const LAMPORTS_PER_SIGNATURE = 5000;
const sol = (lamports: number) => (lamports / 1e9).toFixed(lamports < 1_000_000 ? 6 : 4).replace(/0+$/, "").replace(/\.$/, "");

/** The deployed end-of-rule behaviour, in one sentence (the end-of-rule sink, program round 4, is not deployed and is not described). */
export const WIND_DOWN_LINE = `When the rule ends, the coin's own burn pool burns down what is left over ${DEFAULT_WIND_DOWN_DAYS} days. Then the coin retires. A retired coin's pool keeps burning any fees it still receives. Nothing is sent to another coin.`;

/** Who can change what — scoped to the current program permissions (L06; no unscoped "no one can change it"). */
export function authorityLine(root = process.cwd()): string {
  let threshold = "two of the three keys";
  try {
    const op = JSON.parse(fs.readFileSync(path.join(root, "config", "burnticker", "operator.json"), "utf8")) as { clusters?: { mainnet?: { squads?: { threshold?: string } } } };
    const t = /^(\d) of (\d)$/.exec(op.clusters?.mainnet?.squads?.threshold ?? "");
    if (t) threshold = `${["zero", "one", "two", "three", "four", "five"][Number(t[1])] ?? t[1]} of the ${["zero", "one", "two", "three", "four", "five"][Number(t[2])] ?? t[2]} keys`;
  } catch { /* the default */ }
  return `The coin's rule is fixed when it launches. A fingerprint of the rule is stored on chain with the coin, and no instruction in the program can change it. The program itself can still be upgraded. An upgrade needs ${threshold} that control the operator's Squads vault, a shared wallet that needs several signatures. The trust page shows how long an approved upgrade must wait before it runs.`;
}

const endsLine = (windowSentence: string, perpetual: boolean): string => (perpetual ? "This coin has no end date and does not retire." : `${windowSentence} ${WIND_DOWN_LINE}`.trim());

export function buildLaunchReview(body: ReviewInput, o: { env?: Readonly<Record<string, string | undefined>>; root?: string; seriesTitle?: string | null } = {}): { review: LaunchReview } | { problems: string[] } {
  const env = o.env ?? process.env;
  const cluster = hostCluster(env);
  const problems: string[] = [];
  if (!body.rule || typeof body.rule !== "object" || Array.isArray(body.rule)) return { problems: ["rule is required (a burnticker.rules/v1 object)"] };
  const raw = (body.rule as { onEnd?: unknown }).onEnd === undefined ? { ...(body.rule as object), onEnd: { ...DEFAULT_ON_END } } : body.rule;
  let locked: LockedRule;
  try { locked = lockRule(raw); } catch (e) { return { problems: [(e as Error).message] }; }
  const pair = body.pair && typeof body.pair === "object" ? body.pair : null;
  const second = pair ?? (body.companion && typeof body.companion === "object" ? body.companion : null);
  const ticker = String(body.ticker ?? "").toUpperCase(), name = String(body.name ?? "");
  const note = typeof body.note === "string" ? body.note.trim() : "";
  const sides: { side: "A" | "B"; name: string; ticker: string }[] = [{ side: "A", name, ticker }, ...(second ? [{ side: "B" as const, name: String(second.name ?? ""), ticker: String(second.ticker ?? "").toUpperCase() }] : [])];
  for (const s of sides) {
    const p = sides.length > 1 ? `Coin ${s.side}. ` : "";
    if (!/^[A-Z0-9]{2,10}$/.test(s.ticker)) problems.push(`${p}The ticker needs 2 to 10 letters or digits.`);
    if (s.name.trim().length < 2 || s.name.length > 32) problems.push(`${p}The name needs 2 to 32 characters.`);
    for (const x of creatorTextProblems({ name: s.name, ticker: s.ticker, note: s.side === "A" ? note : "" })) problems.push(`${p}${x.reason}`);
  }
  if (sides.length > 1 && sides[0].ticker === sides[1].ticker) problems.push("The two coins need different tickers.");
  if (note.length > NOTE_MAX) problems.push(`The note can be at most ${NOTE_MAX} characters.`);
  const pp = presetProblem(locked.rule);
  if (pp) problems.push(pp);
  const model = availabilityFromEnv(env, cluster);
  const type = launchTypeOf(locked.rule, { pair: !!pair });
  const ta = type ? model.types[type] : null;
  const ctx = serverDescribeCtx(locked.rule, body.descCtx, { seriesTitle: o.seriesTitle ?? null });
  const text = describeRule(locked.rule, { ticker: ticker || "TICKER", ...ctx });
  const alloc = allocationFor(locked);
  const per = (s: typeof CURVE_FEES) => ({ phase: s.phase, legs: s.legs.map((l) => ({ label: l.label, sol: bpsPerSol(l.bps) })), totalSol: bpsPerSol(s.totalBps) });
  const coins = sides.length;
  const rentConfig = rentLamports(TOKEN_CONFIG_BYTES), reserve = Math.round(Number(locked.rule.reserveSol) * 1e9), create = Math.round(LAUNCHLAB_CREATE_RENT_SOL * 1e9), fee = 2 * LAMPORTS_PER_SIGNATURE;
  const lines: ReviewCost[] = [
    { label: `Rent for the account that stores ${coins > 1 ? "each coin's" : "the coin's"} rule, which is ${TOKEN_CONFIG_BYTES} bytes.`, sol: sol(rentConfig * coins), kind: "rent" },
    { label: `The reserve that moves into ${coins > 1 ? "each coin's" : "the coin's"} own burn pool. It stays with the coin.`, sol: sol(reserve * coins), kind: "reserve" },
    { label: "Rent for the LaunchLab pool, its vaults and the coin's metadata. This figure was measured on the rehearsal launch.", sol: sol(create * coins), kind: "rent" },
    { label: "Network fees for two signatures per transaction. Priority fees are extra.", sol: sol(fee * coins), kind: "fee" },
  ];
  const total = (rentConfig + reserve + create + fee) * coins;
  const steps = coins > 1
    ? [{ label: `Create $${sides[0].ticker || "A"} and lock in its rule`, signers: ["your wallet", "a new key made for this coin"] }, { label: pair ? `Create $${sides[1].ticker || "B"} and link the two coins` : `Create $${sides[1].ticker || "B"} and lock in its rule`, signers: ["your wallet", "a new key made for this coin"] }]
    : [{ label: `Create $${ticker || "TICKER"} and lock in its rule`, signers: ["your wallet", "a new key made for this coin"] }];
  const share = shareOf(locked.rule);
  const warnings = Array.isArray(body.warnings) ? (body.warnings as unknown[]).filter((w): w is string => typeof w === "string" && w.length <= 300).slice(0, 6) : [];
  const review: LaunchReview = {
    schema: "burnticker.launch-review/v1", network: cluster, mode: model.mode, type, typeAvailable: !!ta?.available, typeReason: ta?.reason ?? (type ? null : "The web launcher does not offer this kind of rule."),
    signable: model.mode === "open" && !!ta?.available && problems.length === 0,
    rule: { text: locked.text, sha256: locked.sha256, sha12: locked.sha12, statement: ruleStatement(locked.rule, { seriesTitle: o.seriesTitle ?? null }), sentence: text.ruleBlock.split(/(?<=\.)\s/)[0], share: share === null ? "a vault amount" : pctLabel(share), presets: `The web launcher offers ${presetRowLabel(shareShapeOf(locked.rule))} for this kind of rule.`, endsLine: endsLine(text.windowSentence, text.windowKind === "perpetual") },
    coins: sides.map((s, i) => ({ side: s.side, name: s.name, ticker: s.ticker, description: i === 0 ? text.paragraph : null })),
    allocation: { supply: alloc.supply.toString(), curve: alloc.curve.toString(), locked: alloc.locked.toString(), reserve: alloc.reserve.toString(), teamAllocationPct: 0, lpLockedPct: LP_LOCKED_PCT },
    feesPerSol: [per(CURVE_FEES), per(POST_GRADUATION_FEES)],
    transactions: { count: steps.length, steps, note: "You sign each transaction in your wallet. The wallet shows the exact accounts and amount first, and nothing is sent until you approve." },
    costs: { lines, totalSol: sol(total), note: "This is an estimate. Your wallet shows the exact amount before you approve. The reserve stays in the coin's burn pool, and the rent stays with the new accounts." },
    prerequisites: [
      `No burn can happen until the coin's bonding curve raises ${GRADUATION_SOL} SOL from buyers and graduates to a Raydium pool, and that pool is registered with the burn program.`,
      `Until the program is audited, each burn pool spends from at most ${PRE_AUDIT_POOL_CAP_SOL} SOL. Fees above that amount wait.`,
      "Every burn needs a reading that the operator's keeper signs. Today one signature is enough, and the operator holds it.",
    ],
    authority: authorityLine(o.root),
    operator: OPERATOR_LINE,
    warnings,
    problems,
  };
  return { review };
}
