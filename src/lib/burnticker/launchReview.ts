import fs from "node:fs";
import path from "node:path";
import { lockRule, ruleStatement, DEFAULT_ON_END, DEFAULT_WIND_DOWN_DAYS, type BurnRule, type LockedRule } from "@/lib/burnticker/rules";
import { allocationFor, raiseLamportsOf, raiseProblem } from "@/lib/burnticker/launchBundle";
import { pairCurveEnabled } from "@/lib/burnKeeper/pairCurveCrank";
import { DEFAULT_MIN_SIDE_SHARE_BPS, DEFAULT_TARGET_RAISE_LAMPORTS, DEV_FEE_BPS as PAIR_DEV_FEE_BPS, FEE_BPS as PAIR_FEE_BPS } from "@/lib/pairCurve/pricing";
import { CPMM_LP_BPS, CPMM_TRADE_BPS, LP_FEES_TO_BURN_POOL_BPS, LP_FEES_TO_OPERATOR_BPS } from "@/lib/burnticker/fees";
import { governanceLines } from "@/lib/burnticker/currentStatusText";
import { CURVE_FEES, postGraduationFeesFor, bpsPerSol, LP_LOCKED_PCT, PRE_AUDIT_POOL_CAP_SOL } from "@/lib/burnticker/fees";
import { describeRule } from "@/lib/burnticker/describe";
import { creatorTextProblems, NOTE_MAX, serverDescribeCtx } from "@/lib/burnticker/coinText";
import { DESCRIPTION_MAX } from "@/lib/burnticker/creatorProfile";
import { presetProblem, presetRowLabel, shareOf, shareShapeOf, pctLabel, DEFAULT_RAISE_SOL, RAISE_PRESETS_SOL, RAISE_PRESET_SHARED, RAISE_PRESET_TEXT, isRaisePreset } from "@/lib/burnticker/launchPresets";
import { availabilityFromEnv, hostCluster, launchTypeOf, siteLaunchState, PAIRS_UNAVAILABLE_LINE, type LaunchAvailabilityModel, type LaunchType } from "@/lib/burnticker/launchAvailability";
import { OPERATOR_LINE } from "@/lib/burnticker/trustpack/copy";
import { LAMPORTS_PER_SIGNATURE, LAUNCHLAB_CREATE_RENT_SOL, TOKEN_CONFIG_BYTES, launchLabCostLamports, rentLamports, solText as sol } from "@/lib/burnticker/launchCost";

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
export interface ReviewInput { rule?: unknown; ticker?: unknown; name?: unknown; note?: unknown; descCtx?: unknown; pair?: { ticker?: unknown; name?: unknown } | null; companion?: { ticker?: unknown; name?: unknown } | null; warnings?: unknown; /** website-14: the graduation preset, "40" / "60" / "85" (default 85) */ raiseSol?: unknown }
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
  /** website-14 (LAUNCHPAD-PATH §75): the chosen graduation raise, the pool it starts, the three choices and what each means. */
  raise: { sol: string; poolSol: string; presets: readonly string[]; choices: { sol: string; sentence: string }[]; shared: string; line: string } | null;
  /** website-12 (Codex F1): the venue the bundle route would build for this request; every number below is that venue's. */
  venue: "launchlab" | "pair-curve";
  /** A4: the prerequisite chain in one line, shown by default (the states it can be in follow in `prerequisiteStates`). */
  prerequisiteLine: string;
  prerequisiteStates: string[];
  /** A4: what the burn dial means, in one sentence ("Burn budget per result"). */
  budget: string;
  /** A3: what rejecting or stopping does, per transaction. */
  recovery: string[];
  /** A9: who signs readings, who can upgrade, and the waiting period, from the status record. */
  governance: string[];
  /** A1: why the launch button cannot sign on this site (null when it can). */
  signing: string | null;
  authority: string;
  operator: string;
  warnings: string[];
  problems: string[];
}

export { LAMPORTS_PER_SIGNATURE, LAUNCHLAB_CREATE_RENT_SOL, TOKEN_CONFIG_BYTES, launchLabCostLamports, launchLabCostSol, rentLamports } from "@/lib/burnticker/launchCost";

/** The deployed end-of-rule behaviour, in one sentence (the end-of-rule sink, program round 4, is not deployed and is not described). */
export const WIND_DOWN_LINE = `When the rule ends, the coin's own burn pool burns down what is left over ${DEFAULT_WIND_DOWN_DAYS} days. Then the coin retires. A retired coin's pool keeps burning any fees it still receives. The wind-down only burns this coin and sends nothing to another coin.`;

/** A4: the burn dial, said exactly (the share is of the burn budget, never of the supply). */
export const budgetLine = (share: string): string => `Each result spends ${share} of the coin's available burn budget, which is the SOL in its burn pool. The tokens bought with it are burned, so the number of tokens burned varies.`;
/** The states a prerequisite chain can be in, so no reader assumes every qualifying result burns at once. */
export const PREREQUISITE_STATES = [
  "Waiting: the curve has not raised enough yet, or the pool is not registered yet. Results are still recorded.",
  "Queued: a result is due, and the burn waits for the next run of the program.",
  "Delayed: the program held the burn, for example because the pool's price moved too far. The SOL stays in the burn pool.",
  "Below the floor: the amount due was smaller than the minimum spend fixed at launch, so nothing was bought.",
  `Capped: until the program is audited, each burn pool spends from at most ${PRE_AUDIT_POOL_CAP_SOL} SOL. Anything above that waits.`,
];
const solOf = (lamports: bigint): string => (Number(lamports) / 1e9).toLocaleString("en-US", { maximumFractionDigits: 3 });
/**
 * The compact prerequisite line for a venue, from the numbers the builder uses (launchBundle.ts, pairCurve/pricing.ts). For LaunchLab the
 * raise is the coin's own (the creator's preset); with none chosen yet, the line names the three choices instead of a typed 85.
 */
export function prerequisiteLineFor(venue: "launchlab" | "pair-curve", raiseSol?: string | null): string {
  return venue === "pair-curve"
    ? `Before the first burn, the pair's shared curve must raise ${solOf(DEFAULT_TARGET_RAISE_LAMPORTS)} SOL with each coin holding at least ${DEFAULT_MIN_SIDE_SHARE_BPS / 100}% of it, both coins must move to their own Raydium pools, and each pool must be registered and verified by the burn program.`
    : `Before the first burn, the curve must raise ${raiseSol ? `${solOf(raiseLamportsOf(raiseSol))} SOL` : `the amount its creator chose (${RAISE_PRESETS_SOL.slice(0, -1).join(", ")} or ${RAISE_PRESETS_SOL[RAISE_PRESETS_SOL.length - 1]} SOL)`} from buyers, the coin must move to its Raydium pool, and that pool must be registered and verified by the burn program.`;
}
/** The pair curve's fees per 1 SOL traded (pairCurve/pricing.ts and docs/burnticker/PAIR-CURVE.md: no creator fee after graduation). */
export const PAIR_CURVE_FEES = {
  curve: { phase: "curve" as const, legs: [{ label: "Burnticker (developer)", bps: Number(PAIR_FEE_BPS * PAIR_DEV_FEE_BPS) / 100 }, { label: "burn pool", bps: Number(PAIR_FEE_BPS) - Number(PAIR_FEE_BPS * PAIR_DEV_FEE_BPS) / 100 }], totalBps: Number(PAIR_FEE_BPS) },
  post: { phase: "post-graduation" as const, legs: [{ label: "Raydium protocol", bps: CPMM_TRADE_BPS - CPMM_LP_BPS }, { label: "Burnticker (operator, LP fees)", bps: LP_FEES_TO_OPERATOR_BPS }, { label: "burn pool (LP fees)", bps: LP_FEES_TO_BURN_POOL_BPS }], totalBps: CPMM_TRADE_BPS },
};
/** Byte size of a classic SPL mint (pair_curve creates its own mints, pairCurve/client.ts createPairMintIxs). */
export const SPL_MINT_BYTES = 82;

/** A9: the governance sentences from the status record (current-status.json, operator.json) and the time lock last read from chain. */
export function reviewGovernance(root: string, cluster: string, timeLockSecs: number | null): string[] {
  try {
    const st = JSON.parse(fs.readFileSync(path.join(root, "config", "burnticker", "current-status.json"), "utf8")) as { attesters: { quorum: number; active: { independent: boolean }[] }; squads: Record<string, { operatorControlledKeys?: number }> };
    const op = JSON.parse(fs.readFileSync(path.join(root, "config", "burnticker", "operator.json"), "utf8")) as { clusters?: Record<string, { squads?: { threshold?: string } }> };
    const c = cluster === "mainnet" ? "mainnet" : "devnet";
    return governanceLines({ quorum: st.attesters.quorum, signers: st.attesters.active, operatorKeys: st.squads[c]?.operatorControlledKeys ?? null, threshold: op.clusters?.[c]?.squads?.threshold ?? "2 of 3", timeLockSecs });
  } catch { return ["Who signs readings and who can upgrade the program could not be read just now. The Trust page has both."]; }
}

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

export function buildLaunchReview(body: ReviewInput, o: { env?: Readonly<Record<string, string | undefined>>; root?: string; seriesTitle?: string | null; timeLockSecs?: number | null } = {}): { review: LaunchReview } | { problems: string[] } {
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
  // website-15 item 13: the creator's own description passes the same creator lint and fits 280 characters
  const creatorText = typeof (body as { creatorDescription?: unknown }).creatorDescription === "string" ? String((body as { creatorDescription: string }).creatorDescription).trim() : "";
  if (creatorText.length > DESCRIPTION_MAX) problems.push(`The description can be at most ${DESCRIPTION_MAX} characters.`);
  for (const x of creatorTextProblems({ name: "", ticker: "", note: "", description: creatorText })) problems.push(x.reason);
  const pp = presetProblem(locked.rule);
  if (pp) problems.push(pp);
  // website-14 (§75): the graduation raise, server-enforced: 40, 60 or 85 SOL on mainnet; 85 when the request names none
  const raiseSol = body.raiseSol === undefined || body.raiseSol === null ? DEFAULT_RAISE_SOL : String(body.raiseSol);
  const rp = raiseProblem(raiseSol, cluster);
  if (rp) problems.push(rp);
  const model = availabilityFromEnv(env, cluster);
  const type = launchTypeOf(locked.rule, { pair: !!pair });
  const ta = type ? model.types[type] : null;
  // A2: a second coin (a registered pair, or the two-coin Matchup) needs the pair launches this host may not offer
  const twoCoinBlocked = !!second && !model.types.pairs.available;
  const typeAvailable = !!ta?.available && !twoCoinBlocked;
  const typeReason = twoCoinBlocked ? `${PAIRS_UNAVAILABLE_LINE} ${model.types.pairs.reason ?? ""}`.trim() : ta?.reason ?? (type ? null : "The web launcher does not offer this kind of rule.");
  // Codex F1: the venue the bundle route selects (handlers.ts prepareLaunch: a registered pair goes to pair_curve when the flag is on)
  const venue: "launchlab" | "pair-curve" = pair && pairCurveEnabled(env) ? "pair-curve" : "launchlab";
  const ctx = serverDescribeCtx(locked.rule, body.descCtx, { seriesTitle: o.seriesTitle ?? null });
  const text = describeRule(locked.rule, { ticker: ticker || "TICKER", ...ctx });
  const alloc = allocationFor(locked);
  const per = (s: typeof CURVE_FEES) => ({ phase: s.phase, legs: s.legs.map((l) => ({ label: l.label, sol: bpsPerSol(l.bps) })), totalSol: bpsPerSol(s.totalBps) });
  const perPc = (s: typeof PAIR_CURVE_FEES.curve | typeof PAIR_CURVE_FEES.post) => ({ phase: s.phase, legs: s.legs.map((l) => ({ label: l.label, sol: bpsPerSol(l.bps) })), totalSol: bpsPerSol(s.totalBps) });
  const coins = sides.length;
  const rentConfig = rentLamports(TOKEN_CONFIG_BYTES), reserve = Math.round(Number(locked.rule.reserveSol) * 1e9);
  const tk = (i: number) => sides[i]?.ticker || (i === 0 ? "A" : "B");
  let lines: ReviewCost[], total: number, steps: { label: string; signers: string[] }[], costNote: string;
  if (venue === "pair-curve") {
    const mintRent = rentLamports(SPL_MINT_BYTES), fee = 5 * LAMPORTS_PER_SIGNATURE;   // two signatures on each create, one on the link
    lines = [
      { label: `Rent for the account that stores each coin's rule, which is ${TOKEN_CONFIG_BYTES} bytes.`, sol: sol(rentConfig * 2), kind: "rent" },
      { label: "The reserve that moves into each coin's own burn pool. It stays with the coin.", sol: sol(reserve * 2), kind: "reserve" },
      { label: `Rent for the two new mints, ${SPL_MINT_BYTES} bytes each.`, sol: sol(mintRent * 2), kind: "rent" },
      { label: "Network fees for five signatures across the three transactions. Priority fees are extra.", sol: sol(fee), kind: "fee" },
    ];
    total = (rentConfig + reserve + mintRent) * 2 + fee;
    steps = [
      { label: `Create $${tk(0)} and lock in its rule`, signers: ["your wallet", "a new key made for this coin"] },
      { label: `Create $${tk(1)} and lock in its rule`, signers: ["your wallet", "a new key made for this coin"] },
      { label: "Link the two coins as one pair on the pair curve", signers: ["your wallet"] },
    ];
    costNote = "This is an estimate. It does not include the rent for the pair's own account and vaults, which has not been measured. Your wallet shows the exact amount before you approve. The reserve stays in each coin's burn pool, and the rent stays with the new accounts.";
  } else {
    const create = Math.round(LAUNCHLAB_CREATE_RENT_SOL * 1e9), fee = 2 * LAMPORTS_PER_SIGNATURE;
    lines = [
      { label: `Rent for the account that stores ${coins > 1 ? "each coin's" : "the coin's"} rule, which is ${TOKEN_CONFIG_BYTES} bytes.`, sol: sol(rentConfig * coins), kind: "rent" },
      { label: `The reserve that moves into ${coins > 1 ? "each coin's" : "the coin's"} own burn pool. It stays with the coin.`, sol: sol(reserve * coins), kind: "reserve" },
      { label: "Rent for the LaunchLab pool, its vaults and the coin's metadata. This figure was measured on the rehearsal launch.", sol: sol(create * coins), kind: "rent" },
      { label: "Network fees for two signatures per transaction. Priority fees are extra.", sol: sol(fee * coins), kind: "fee" },
    ];
    total = launchLabCostLamports(locked.rule.reserveSol, coins);
    steps = coins > 1
      ? [{ label: `Create $${tk(0)} and lock in its rule`, signers: ["your wallet", "a new key made for this coin"] }, { label: pair ? `Create $${tk(1)} and link the two coins` : `Create $${tk(1)} and lock in its rule`, signers: ["your wallet", "a new key made for this coin"] }]
      : [{ label: `Create $${ticker || "TICKER"} and lock in its rule`, signers: ["your wallet", "a new key made for this coin"] }];
    costNote = "This is an estimate. Your wallet shows the exact amount before you approve. The reserve stays in the coin's burn pool, and the rent stays with the new accounts.";
  }
  const share = shareOf(locked.rule);
  const shareText = share === null ? "a vault amount" : pctLabel(share);
  const warnings = Array.isArray(body.warnings) ? (body.warnings as unknown[]).filter((w): w is string => typeof w === "string" && w.length <= 300).slice(0, 6) : [];
  const n = steps.length;
  const recovery = n === 1
    ? ["If you reject the request in your wallet, nothing is sent and nothing is charged. The draft is kept for 24 hours, so you can press the button again."]
    : [
      `Your wallet asks ${n} separate times, once for each transaction, in the order above.`,
      "If you reject the first request, nothing is sent and nothing is charged.",
      "If you reject a later request, the transactions already confirmed stay on chain and are not undone. This page shows which steps are confirmed, with their signatures, and pressing the button again continues from the next step.",
      ...(venue === "pair-curve" ? ["Until the last step links the two coins, the pair is not set up, so finish every step."] : []),
    ];
  recovery.push("If a send is uncertain, this tab keeps the signature and checks the chain before anything is sent again. After a reload, the unfinished launch is listed at the top of this page.");
  const launchState = siteLaunchState(env);
  const signable = model.mode === "open" && typeAvailable && problems.length === 0;
  const review: LaunchReview = {
    schema: "burnticker.launch-review/v1", network: cluster, mode: model.mode, type, typeAvailable, typeReason,
    signable,
    rule: { text: locked.text, sha256: locked.sha256, sha12: locked.sha12, statement: ruleStatement(locked.rule, { seriesTitle: o.seriesTitle ?? null }), sentence: text.ruleBlock.split(/(?<=\.)\s/)[0], share: shareText, presets: `The web launcher offers ${presetRowLabel(shareShapeOf(locked.rule))} for this kind of rule.`, endsLine: endsLine(text.windowSentence, text.windowKind === "perpetual") },
    coins: sides.map((s, i) => ({ side: s.side, name: s.name, ticker: s.ticker, description: i === 0 ? text.paragraph : null })),
    allocation: { supply: alloc.supply.toString(), curve: alloc.curve.toString(), locked: alloc.locked.toString(), reserve: alloc.reserve.toString(), teamAllocationPct: 0, lpLockedPct: LP_LOCKED_PCT },
    feesPerSol: venue === "pair-curve" ? [perPc(PAIR_CURVE_FEES.curve), perPc(PAIR_CURVE_FEES.post)] : [per(CURVE_FEES), per(postGraduationFeesFor(cluster))],
    transactions: { count: n, steps, note: n === 1 ? "You sign the transaction in your wallet. The wallet shows the exact accounts and amount first, and nothing is sent until you approve." : "You sign each transaction in your wallet. The wallet shows the exact accounts and amount of each one first, and nothing in it is sent until you approve it." },
    costs: { lines, totalSol: sol(total), note: costNote },
    prerequisites: [
      prerequisiteLineFor(venue, venue === "launchlab" ? raiseSol : null),
      `Until the program is audited, each burn pool spends from at most ${PRE_AUDIT_POOL_CAP_SOL} SOL. Fees above that amount wait.`,
      "Every burn needs a reading that the operator's keeper signs. Today one signature is enough, and the operator holds it.",
    ],
    venue,
    prerequisiteLine: prerequisiteLineFor(venue, venue === "launchlab" ? raiseSol : null),
    raise: venue === "launchlab" ? {
      sol: raiseSol, poolSol: raiseSol, presets: RAISE_PRESETS_SOL,
      choices: RAISE_PRESETS_SOL.map((x) => ({ sol: x, sentence: RAISE_PRESET_TEXT[x] })), shared: RAISE_PRESET_SHARED,
      line: `The curve is complete once buyers have put in ${raiseSol} SOL, and the coin moves to its Raydium pool, which starts with roughly ${raiseSol} SOL.${isRaisePreset(raiseSol) ? "" : " This raise is not one of the three choices, so it is only accepted off mainnet."}`,
    } : null,
    prerequisiteStates: PREREQUISITE_STATES,
    budget: share === null ? "This rule moves a fixed vault amount instead of a share of the burn budget." : budgetLine(shareText),
    recovery,
    governance: reviewGovernance(o.root ?? process.cwd(), cluster, o.timeLockSecs ?? null),
    signing: !typeAvailable ? typeReason : !launchState.canSign ? launchState.signingSentence : problems.length ? "This draft has problems to fix before it can be signed." : null,
    authority: authorityLine(o.root),
    operator: OPERATOR_LINE,
    warnings,
    problems,
  };
  return { review };
}
