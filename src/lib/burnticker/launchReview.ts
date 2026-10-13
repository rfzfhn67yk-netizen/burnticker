import fs from "node:fs";
import path from "node:path";
import { lockRule, ruleStatement, DEFAULT_ON_END, DEFAULT_WIND_DOWN_DAYS, type BurnRule, type LockedRule } from "@/lib/burnticker/rules";
import { allocationFor, raiseLamportsOf, raiseProblem } from "@/lib/burnticker/launchBundle";
import { pairCurveEnabled } from "@/lib/burnKeeper/pairCurveCrank";
import { DEFAULT_MIN_SIDE_SHARE_BPS, DEFAULT_TARGET_RAISE_LAMPORTS, DEV_FEE_BPS as PAIR_DEV_FEE_BPS, FEE_BPS as PAIR_FEE_BPS } from "@/lib/pairCurve/pricing";
import { CPMM_LP_BPS, CPMM_TRADE_BPS, LP_FEES_TO_BURN_POOL_BPS, LP_FEES_TO_OPERATOR_BPS } from "@/lib/burnticker/fees";
import { governanceLines } from "@/lib/burnticker/currentStatusText";
import { CURVE_FEES, postGraduationFeesFor, bpsPerSol, LP_LOCKED_PCT, PRE_AUDIT_POOL_CAP_SOL } from "@/lib/burnticker/fees";
import { describeRule, endText, type DescribeCtx } from "@/lib/burnticker/describe";
import { identityRefusals, ruleRefusals, sourceText } from "@/lib/burnticker/launchPreflight";
import { reviewProjection, type Projection } from "@/lib/burnticker/projection";
import { kalshiEnabled as kalshiEnabledFromEnv } from "@/lib/burnticker/venues";
import type { LookalikeExisting } from "@/lib/burnticker/lookalike";
import { DESCRIPTION_LIMIT } from "@/lib/burnticker/launchBundle";
import { linksProblems, withCreatorText } from "@/lib/burnticker/creatorProfile";
import { parseEspnSeries, teamByAbbr } from "@/lib/burnticker/sources/espn";
import { UNPLAYED_GAME_LINE, dueTiming, dueWarningDays, gameDueLabel, gameOfRule, type ScheduledGame } from "@/lib/burnticker/timing";
import { creatorTextProblems, NOTE_MAX, serverDescribeCtx } from "@/lib/burnticker/coinText";
import { DESCRIPTION_MAX } from "@/lib/burnticker/creatorProfile";
import { nameProblem } from "@/lib/burnticker/launchFields";
import { presetProblem, presetRowLabel, shareOf, shareShapeOf, pctLabel, DEFAULT_RAISE_SOL, RAISE_PRESETS_SOL, RAISE_PRESET_SHARED, RAISE_PRESET_TEXT, isRaisePreset } from "@/lib/burnticker/launchPresets";
import { availabilityFromEnv, hostCluster, launchTypeOf, siteLaunchState, PAIRS_UNAVAILABLE_LINE, type LaunchAvailabilityModel, type LaunchType } from "@/lib/burnticker/launchAvailability";
import { OPERATOR_LINE } from "@/lib/burnticker/trustpack/copy";
import { EVENT_LEVEL_REFUSAL, eventLevelRule, graduationExplainer } from "@/lib/burnticker/guidedLaunch";
import { statedSentences } from "@/lib/burnticker/sources/polyStated";
import { loadReserved } from "@/lib/burnticker/reservedNames";
import { LAMPORTS_PER_SIGNATURE, LAUNCHLAB_CREATE_RENT_SOL, TOKEN_CONFIG_BYTES, decimalSolToLamports, launchLabCostLamports, rentLamports, solText as sol } from "@/lib/burnticker/launchCost";

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
export interface ReviewInput { rule?: unknown; ticker?: unknown; name?: unknown; note?: unknown; descCtx?: unknown; pair?: { ticker?: unknown; name?: unknown; creatorDescription?: unknown } | null; companion?: { ticker?: unknown; name?: unknown; creatorDescription?: unknown; /** website-19 (intent audit item 8): the second coin's own rule, locked and shown with its fingerprint */ rule?: unknown } | null; warnings?: unknown; /** website-14: the graduation preset, "40" / "60" / "85" (default 85) */ raiseSol?: unknown }
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
  /** website-18: `profile` is the creator's own description for that side (a pair carries one per side) */
  coins: { side: "A" | "B"; name: string; ticker: string; description: string | null; profile: { description: string } }[];
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
  /** website-19: what graduation means, with the raise choices and the fee rates (guidedLaunch.ts graduationExplainer). */
  graduation: string[];
  /**
   * website-19 (ChatGPT launch-intent audit item 8): every rule the creator is asked to sign, each with its coin, its transaction number
   * and its fingerprint. A two-coin Matchup lists both locked rules; a registered pair lists side A's rule and says side B's is derived.
   */
  rules: { side: "A" | "B"; ticker: string; name: string; step: number; text: string; sha256: string; derived: boolean }[];
  /** website-19 (walkthrough snag 16): the dispute-window sentence on every one-market Polymarket review, whichever path built it. */
  dispute: string | null;
  /**
   * ChatGPT audit 6 item 3: how the rule ends, the two ends stated apart (describe.ts endText): `result` when it ends on a result (the rest
   * goes to the sink pinned at creation), `void` when it is voided or the season is cancelled (the wind-down on this coin), or null.
   */
  end: { kind: string; result: string; void: string | null };
  /**
   * ChatGPT audit 6 item 11: the plain projection from the source's saved sample at 1, 2 and 5% side by side (projection.ts, through the
   * keeper's own unit engine and burnMath's compounding), or the reason there is none.
   */
  projection: Projection;
  /**
   * ChatGPT audit 7 items 7 and 11: when a one-time result is due (the game the rule names, or the market's end), how many days away, the
   * graduation warning when that is within dueWarningDays, and what an unplayed game does. Null for a rule that repeats.
   */
  timing: { dueAt: string | null; dueLabel: string | null; dueWithinDays: number | null; warning: string | null; unplayed: string | null } | null;
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
  `Capped: each burn pool spends from at most the burn-pool cap, ${PRE_AUDIT_POOL_CAP_SOL} SOL unless the platform's multisig raises it through a public 48-hour wait. Anything above that waits until the cap rises or ends.`,
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

/** The dispute-window sentence when the server could not read the market's own window (UMA's documented default). */
export const DISPUTE_DEFAULT = "It settles on Polymarket's on-chain payout. The result becomes final after the dispute window, which is about 2 hours unless the market sets its own.";
const bpsPct = (bps: number): string => `${Math.round(bps) / 100}%`;
/** website-19: the graduation block with this cluster's numbers (the raise presets, the curve's fee legs, the pool's tier fee). */
export function graduationLines(cluster: string): string[] {
  const burn = CURVE_FEES.legs.filter((l) => l.label === "burn pool").reduce((a, l) => a + l.bps, 0);
  return graduationExplainer({ raises: RAISE_PRESETS_SOL, curveFeePct: bpsPct(CURVE_FEES.totalBps), curveBurnPoolPct: bpsPct(burn), poolFeePct: bpsPct(postGraduationFeesFor(cluster).totalBps) });
}

/** ChatGPT audit 6 item 3: the end line is endText's, after the window sentence with its own end clause taken out (it said it twice). */
const endsLine = (windowSentence: string, end: ReturnType<typeof endText>): string => {
  if (end.kind === "perpetual") return end.result;
  const window = windowSentence.split(/(?<=\.)\s+/).filter((x) => !/burns \$DEFICIT|burns the winning coin|burns down|retires|voided or the season is cancelled|win the championship|If they do not/.test(x)).join(" ");
  return `${window} ${end.line}`.trim();
};

export function buildLaunchReview(body: ReviewInput, o: { env?: Readonly<Record<string, string | undefined>>; root?: string; /** website-19: the reserved names (tests pass their own) */ reserved?: ReadonlySet<string>; seriesTitle?: string | null; timeLockSecs?: number | null; /** the server's own read of a one-market Polymarket rule (coinText.ts statedCtx), so the review's description matches the pinned one */ stated?: DescribeCtx["stated"];
  /** audit 6 item 8: whether this host serves Kalshi (the platform's flag; default from the env) */ kalshiEnabled?: boolean;
  /** audit 6 item 8: the registered coins, for the lookalike refusal the bundle route makes (null: not checked) */ existing?: readonly LookalikeExisting[] | null;
  /** audit 6 item 2: a team with no games left this season (the route reads the schedule) */ seasonWarning?: string | null; now?: number;
  /** audit 7 items 7 and 11: the game a one-game rule names, from the schedule (the route reads it); its start is the due date */ game?: ScheduledGame | null } = {}): { review: LaunchReview } | { problems: string[] } {
  const env = o.env ?? process.env;
  const cluster = hostCluster(env);
  const problems: string[] = [];
  if (!body.rule || typeof body.rule !== "object" || Array.isArray(body.rule)) return { problems: ["rule is required (a burnticker.rules/v1 object)"] };
  const raw = (body.rule as { onEnd?: unknown }).onEnd === undefined ? { ...(body.rule as object), onEnd: { ...DEFAULT_ON_END } } : body.rule;
  // website-19 (intent audit 2, item 1): an event-level market is refused in plain words before anything else
  if (eventLevelRule(raw as BurnRule)) return { problems: [EVENT_LEVEL_REFUSAL] };
  let locked: LockedRule;
  try { locked = lockRule(raw); } catch (e) { return { problems: [(e as Error).message] }; }
  const now = o.now ?? Date.now();
  // THE ONE LAUNCH PREFLIGHT (launchPreflight.ts; ChatGPT audit 6 item 8): every rule refusal the bundle route makes, as problems
  for (const x of ruleRefusals(locked, { kalshiEnabled: o.kalshiEnabled ?? kalshiEnabledFromEnv(env), now })) problems.push(x.message);
  const pair = body.pair && typeof body.pair === "object" ? body.pair : null;
  // audit 6 test A: a registered pair locks side A's rule with a pair clause (handlers.ts buildPairBundles); a source that cannot pair
  // (an ESPN team, a feed) is refused there, so the review says so here
  if (pair) { try { lockRule({ ...(raw as object), pair: { pairId: "review-pair", side: "A", counterpartMint: null } }); } catch (e) { problems.push((e as Error).message.replace(/^rule: /, "")); } }
  const second = pair ?? (body.companion && typeof body.companion === "object" ? body.companion : null);
  const ticker = String(body.ticker ?? "").toUpperCase(), name = String(body.name ?? "");
  const note = typeof body.note === "string" ? body.note.trim() : "";
  const sides: { side: "A" | "B"; name: string; ticker: string }[] = [{ side: "A", name, ticker }, ...(second ? [{ side: "B" as const, name: String(second.name ?? ""), ticker: String(second.ticker ?? "").toUpperCase() }] : [])];
  for (const s of sides) {
    const p = sides.length > 1 ? `Coin ${s.side}. ` : "";
    if (!/^[A-Z0-9]{2,10}$/.test(s.ticker)) problems.push(`${p}The ticker needs 2 to 10 letters or digits.`);
    { const np = nameProblem(s.name); if (np) problems.push(`${p}${np}`); }
    for (const x of creatorTextProblems({ name: s.name, ticker: s.ticker, note: s.side === "A" ? note : "" })) problems.push(`${p}${x.reason}`);
  }
  if (sides.length > 1 && sides[0].ticker === sides[1].ticker) problems.push("The two coins need different tickers.");
  if (sides.length > 1 && sides[0].name.trim() && sides[0].name.toUpperCase().replace(/[^A-Z0-9]/g, "") === sides[1].name.toUpperCase().replace(/[^A-Z0-9]/g, "")) problems.push("The two coins need different names.");
  // website-19 (owner, 2026-10-12): the platform's reserved names, for the ticker and the name of every side; audit 6 items 8 and 9: the
  // same identity refusals the bundle route makes (refuse-list name patterns, major coins' tickers, control characters, lookalikes)
  let reserved: ReadonlySet<string> = new Set();
  try { reserved = o.reserved ?? loadReserved(); } catch { /* an unreadable list refuses nothing here; the launch route reads it again */ }
  const descOf = (i: number) => { const d = i === 0 ? (body as { creatorDescription?: unknown }).creatorDescription : second?.creatorDescription; return typeof d === "string" ? d : ""; };
  sides.forEach((s, i) => { for (const x of identityRefusals({ ticker: s.ticker, name: s.name, description: descOf(i), note: i === 0 ? note : "" }, { reserved, existing: o.existing ?? null, rule: i === 0 ? locked.rule : null })) problems.push(`${sides.length > 1 ? `Coin ${s.side}. ` : ""}${x.message}`); });
  if (note.length > NOTE_MAX) problems.push(`The note can be at most ${NOTE_MAX} characters.`);
  // audit 7 item 3: the creator's links, checked exactly as the bundle checks them (creatorProfile.ts linksProblems)
  if ((body as { links?: unknown }).links !== undefined) problems.push(...linksProblems((body as { links?: unknown }).links));
  // website-15 item 13: the creator's own description passes the same creator lint and fits 280 characters
  const creatorText = typeof (body as { creatorDescription?: unknown }).creatorDescription === "string" ? String((body as { creatorDescription: string }).creatorDescription).trim() : "";
  if (creatorText.length > DESCRIPTION_MAX) problems.push(`The description can be at most ${DESCRIPTION_MAX} characters.`);
  for (const x of creatorTextProblems({ name: "", ticker: "", note: "", description: creatorText })) problems.push(x.reason);
  // website-18: a pair's side B has its own description, checked the same way
  const creatorTextB = second && typeof second.creatorDescription === "string" ? second.creatorDescription.trim() : "";
  if (creatorTextB.length > DESCRIPTION_MAX) problems.push(`Coin B. The description can be at most ${DESCRIPTION_MAX} characters.`);
  for (const x of creatorTextProblems({ name: "", ticker: "", note: "", description: creatorTextB })) problems.push(`Coin B. ${x.reason}`);
  // website-19 (intent audit item 8): a Matchup's second coin carries its own rule; it is locked here like side A's so its exact text and
  // fingerprint are shown before signing
  let companionLocked: LockedRule | null = null;
  const cr = !pair && body.companion && typeof body.companion === "object" ? (body.companion as { rule?: unknown }).rule : undefined;
  if (cr && typeof cr === "object" && !Array.isArray(cr)) {
    try { companionLocked = lockRule((cr as { onEnd?: unknown }).onEnd === undefined ? { ...(cr as object), onEnd: { ...DEFAULT_ON_END } } : cr); } catch (e) { problems.push(`Coin B. ${(e as Error).message}`); }
  }
  // audit 6 item 8: the bundle route takes any share inside the rule's bounds, so a share off the web launcher's preset row is a warning
  const pp = presetProblem(locked.rule);
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
  // audit 6 item 26: the source's own title and unit (as the bundle route reads them), so no text falls back to the raw series id
  const src = sourceText(locked.rule, now);
  const ctx = { ...serverDescribeCtx(locked.rule, body.descCtx, { seriesTitle: o.seriesTitle ?? src?.title ?? null, feed: src?.feed ?? null, stated: o.stated ?? null }), ...(src?.subjectName ? { subjectName: src.subjectName } : {}) };
  const text = describeRule(locked.rule, { ticker: ticker || "TICKER", ...ctx });
  // the description the bundle pins: the generated paragraph, then the creator's own text, within the bundle's ceiling
  { const full = withCreatorText(text.paragraph, creatorText); if (full.length > DESCRIPTION_LIMIT) problems.push(`The description, the rule's paragraph and your own text together, comes to ${full.length.toLocaleString("en-US")} characters, and a coin's description can be at most ${DESCRIPTION_LIMIT.toLocaleString("en-US")}. Shorten your text.`); }
  const espn = locked.rule.oracle === "catalogue" && locked.rule.series ? parseEspnSeries(locked.rule.series) : null;
  const teamName = espn ? teamByAbbr(espn.league, espn.abbr)?.nickname ?? null : null;
  const end = endText(locked.rule, { team: teamName ? `the ${teamName}` : null });
  const alloc = allocationFor(locked);
  const per = (s: typeof CURVE_FEES) => ({ phase: s.phase, legs: s.legs.map((l) => ({ label: l.label, sol: bpsPerSol(l.bps) })), totalSol: bpsPerSol(s.totalBps) });
  const perPc = (s: typeof PAIR_CURVE_FEES.curve | typeof PAIR_CURVE_FEES.post) => ({ phase: s.phase, legs: s.legs.map((l) => ({ label: l.label, sol: bpsPerSol(l.bps) })), totalSol: bpsPerSol(s.totalBps) });
  const coins = sides.length;
  const rentConfig = rentLamports(TOKEN_CONFIG_BYTES), reserve = decimalSolToLamports(locked.rule.reserveSol);
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
  if (pp) warnings.push(pp);
  // audit 7 items 7 and 11: the one-time result's own due date (the picked game, never "the next meeting"), and the warning when it is near
  const oneTime = text.windowKind === "one-shot";
  const game = oneTime && o.game && gameOfRule(locked.rule, [o.game]) ? o.game : null;
  const dueIso = game ? game.startsAt : oneTime ? (ctx as { endsAt?: string | null }).endsAt ?? null : null;
  const due = dueTiming(dueIso, now, dueWarningDays(env));
  const timing = oneTime ? { dueAt: due.dueAt, dueLabel: game ? gameDueLabel(game) : null, dueWithinDays: due.dueWithinDays, warning: due.warning, unplayed: espn?.kind === "game" ? UNPLAYED_GAME_LINE : null } : null;
  if (timing?.warning) warnings.push(timing.warning);
  if (o.seasonWarning) warnings.unshift(o.seasonWarning);
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
    rule: { text: locked.text, sha256: locked.sha256, sha12: locked.sha12, statement: ruleStatement(locked.rule, { seriesTitle: o.seriesTitle ?? null, feedTitle: src?.title ?? null, unitLabel: src?.unitLabel ?? null }), sentence: text.lead, share: shareText, presets: `The web launcher offers ${presetRowLabel(shareShapeOf(locked.rule))} for this kind of rule.`, endsLine: endsLine(text.windowSentence, end) },
    coins: sides.map((s, i) => ({ side: s.side, name: s.name, ticker: s.ticker, description: i === 0 ? text.paragraph : null, profile: { description: i === 0 ? creatorText : creatorTextB } })),
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
    graduation: graduationLines(cluster),
    rules: [
      { side: "A" as const, ticker: tk(0), name, step: 1, text: locked.text, sha256: locked.sha256, derived: false },
      ...(companionLocked ? [{ side: "B" as const, ticker: tk(1), name: sides[1]?.name ?? "", step: 2, text: companionLocked.text, sha256: companionLocked.sha256, derived: false }] : []),
      ...(pair ? [{ side: "B" as const, ticker: tk(1), name: sides[1]?.name ?? "", step: 2, text: "", sha256: "", derived: true }] : []),
    ],
    dispute: locked.rule.oracle === "polymarket" && locked.rule.market ? (o.stated ? statedSentences(o.stated, o.stated.finalAfter) : DISPUTE_DEFAULT) : null,
    end: { kind: end.kind, result: end.result, void: end.void },
    projection: reviewProjection(locked.rule, now),
    timing,
  };
  return { review };
}
