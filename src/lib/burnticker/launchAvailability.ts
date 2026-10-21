import { hostedSigning as hostedSigningLive } from "@/lib/burnticker/hostedLaunch";
import type { BurnRule } from "@/lib/burnticker/rules";
import { CREATOR_LAUNCHES_CLOSED, CREATOR_LAUNCHES_CODE, CREATOR_LAUNCHES_FLAG } from "@/lib/burnticker/creatorLaunches";
import { LOOKUP_TABLES } from "@/lib/burnticker/networks";

/**
 * WHAT A CREATOR CAN LAUNCH ON THIS HOST, DERIVED, NOT WRITTEN (ChatGPT launch audit 5, L02 / audit #4, 2026-10-11: the status said
 * creator launches were closed while the host had them open, and sports, matchup and Derby paths reached a wallet prompt although sports
 * settlement and mainnet pairs were unavailable). One model, three levels:
 *
 *   global       closed   BURNTICKER_CREATOR_LAUNCHES_ENABLED off and no preview: the launch page shows the closed page
 *                preview  BURNTICKER_CREATOR_LAUNCHES_PREVIEW on (ENABLED off): the wizard and the review card render in full under a
 *                         persistent banner; nothing builds or sends a transaction (bundle / confirm answer 403 launches-closed,
 *                         preview: true); the read-only review payload works
 *                open     BURNTICKER_CREATOR_LAUNCHES_ENABLED on (it wins over PREVIEW)
 *   per type     team / matchup (sports), markets, elections, public data, weather, Coin vs Coin, registered pairs — each available or
 *                not, with the plain reason, shown on the first screen before any form is filled
 *   per source   sports settlement needs TheSportsDB's licence key on a mainnet host (devnet hosts are test networks); registered
 *                pairs on a mainnet host need BURNTICKER_PAIR_CURVE_ENABLED (current-status: "pair launches stay off on mainnet")
 *
 * The server enforces the same model: every creator launch route refuses a closed / preview host (globalRefusal) and an unavailable
 * type (typeRefusal) with a plain sentence and a code. Pure and client-safe; the catalogue carries the model to the browser.
 */
export const CREATOR_LAUNCHES_PREVIEW_FLAG = "BURNTICKER_CREATOR_LAUNCHES_PREVIEW";
/**
 * AUDIT A C1 review (1): when creator launches were closed (ISO time). While launches are closed or in preview, a launch is recorded only
 * when its create landed before this moment. Unset: the moment this host first saw launches closed (registry status launches.closedAt).
 */
export const CREATOR_LAUNCHES_CLOSED_AT_FLAG = "BURNTICKER_CREATOR_LAUNCHES_CLOSED_AT";
export type LaunchMode = "closed" | "preview" | "open";
export type LaunchType = "team" | "matchup" | "markets" | "elections" | "feeds" | "weather" | "derby" | "pairs";
export interface TypeAvailability { type: LaunchType; label: string; available: boolean; reason: string | null }
export interface SourceAvailability { id: "sports-settlement" | "sports-schedule" | "polymarket" | "nws" | "feeds" | "pair-curve" | "burn-real" | /** round 5: the incinerator end sink; on with the round-5 program unless BURNTICKER_BURN_SOL_ENABLED is off */ "burn-sol" | /** the "another coin" end choice; off until the list is curated */ "end-sink-picker" | /** HB-5: the host runs burn dispersal (catalogueLaunches only) */ "burn-dispersal"; label: string; available: boolean; reason: string | null }
export interface LaunchAvailabilityModel {
  mode: LaunchMode;
  /** True only in `open` mode: the one flag that lets a bundle be built. */
  transactions: boolean;
  cluster: string | null;
  /** The persistent banner in preview mode; the closed sentence in closed mode; null when open. */
  banner: string | null;
  types: Record<LaunchType, TypeAvailability>;
  sources: SourceAvailability[];
}

type Env = Readonly<Record<string, string | undefined>>;
const on = (v: string | undefined) => /^(1|true|yes|on)$/i.test((v ?? "").trim());

/** The preview banner, word for word (lint-clean: a fact, no date, no "soon"). */
export const PREVIEW_BANNER = "This is a preview. Creator launches are closed, so nothing here builds or sends a transaction.";
export const LAUNCHES_CLOSED_CODE = "launches-closed";
export const TYPE_UNAVAILABLE_CODE = "launch-type-unavailable";
/** website-12 (2026-10-12, ChatGPT audit 6 A2): the ONE line beside every pair option, and the blocker behind its details. */
export const PAIRS_UNAVAILABLE_LINE = "Paired launches are not available yet.";
export const PAIRS_BLOCKER = "On mainnet this site has not turned on the program that runs pair launches, so a launch with two coins cannot be reviewed for signing or built here.";

/**
 * ROUND 5 (website-24, WIRING-ROUND5): a coin that burns a real token (WIF, BONK, ...) instead of itself needs the round-5 program, which
 * the host names with BURNTICKER_INITIALIZE_TOKEN_LAYOUT=r5 (src/lib/burnReceipts/instructions.ts INITIALIZE_TOKEN_LAYOUT_ENV; the
 * library refuses a pinned token on any other layout). Read here as a plain string so this module stays client-safe;
 * test/burntickerWebsite24.test.ts pins the name to the library's constant. Until then the launch page hides the choice and says this line.
 */
export const BURN_REAL_LAYOUT_ENV = "BURNTICKER_INITIALIZE_TOKEN_LAYOUT";
// audit 12 item 15: said plainly, with no release name; the page shows it only where a burn target could be set (WIRING-AUDIT12)
// owner 2026-10-19: WIF and BONK were only an example; a Coin comparison coin burns the coin it is measured against
export const BURN_REAL_WAITING = "Burning the coin a Coin comparison coin is measured against, instead of its own, is not offered on this site yet. Every coin made here burns its own token.";
export const burnRealFromEnv = (env: Env = process.env): boolean => (env[BURN_REAL_LAYOUT_ENV] ?? "").trim() === "r5";
/**
 * OWNER DECISION 2026-10-19: burning a real token is OFF by default, even on a round-5 host. BURNTICKER_BURN_REAL_ENABLED (1, true, on or
 * yes) turns it on; the `burn-real` source is available only with the round-5 program AND this flag. burnRealFromEnv above keeps meaning
 * "the host runs the round-5 program" (the preflight's programRound5 reads it). The review and the bundle route refuse a rule that pins a
 * token while this is off (launchPreflight.ts BURN_REAL_OFF_CODE), so the API cannot do what the page hides.
 */
export const BURN_REAL_ENABLED_FLAG = "BURNTICKER_BURN_REAL_ENABLED";
export const burnRealEnabledFromEnv = (env: Env = process.env): boolean => on(env[BURN_REAL_ENABLED_FLAG]);
/** The `burn-real` source: the round-5 program and the owner's flag. */
export const burnRealOfferedFromEnv = (env: Env = process.env): boolean => burnRealFromEnv(env) && burnRealEnabledFromEnv(env);
/**
 * OWNER DECISION 2026-10-19: the incinerator end sink ("the SOL left at the end is sent to Solana's incinerator") is ON wherever the
 * round-5 program runs. BURNTICKER_BURN_SOL_ENABLED set to 0, false, off or no hides it; anything else (unset included) leaves it on.
 */
export const BURN_SOL_ENABLED_FLAG = "BURNTICKER_BURN_SOL_ENABLED";
export const burnSolEnabledFromEnv = (env: Env = process.env): boolean => !/^(0|false|off|no)$/i.test((env[BURN_SOL_ENABLED_FLAG] ?? "").trim());
/** The `burn-sol` source: the round-5 program, unless the flag turns it off. */
export const burnSolOfferedFromEnv = (env: Env = process.env): boolean => burnRealFromEnv(env) && burnSolEnabledFromEnv(env);
export const BURN_SOL_NOT_R5 = "Sending the SOL left at the end to Solana's incinerator needs a newer version of the burn program than this site runs.";
export const BURN_SOL_OFF = "Sending the SOL left at the end to Solana's incinerator is turned off on this site. The rest goes to $DEFICIT's burn.";
/** BURNTICKER_END_SINK_PICKER=1 offers "the rest goes to another coin's burn"; anything else keeps $DEFICIT as the only sink choice. */
export const sinkPickerFromEnv = (env: Env = process.env): boolean => /^(1|true|on|yes)$/i.test((env.BURNTICKER_END_SINK_PICKER ?? "").trim());

export function launchModeFromEnv(env: Env = process.env): LaunchMode {
  if (on(env[CREATOR_LAUNCHES_FLAG])) return "open";
  return on(env[CREATOR_LAUNCHES_PREVIEW_FLAG]) ? "preview" : "closed";
}

const LABEL: Record<LaunchType, string> = { team: "Team coin", matchup: "Matchup", markets: "Prediction market", elections: "Election", feeds: "Public number", weather: "Weather", derby: "Coin vs Coin", pairs: "Paired coin" };

/** The model from the host's environment (the catalogue, the routes and server pages). */
export function availabilityFromEnv(env: Env = process.env, cluster: string | null = null): LaunchAvailabilityModel {
  const mode = launchModeFromEnv(env);
  const mainnet = cluster === "mainnet";
  const tsdb = !!(env.BURNTICKER_THESPORTSDB_KEY ?? "").trim();
  const pairCurve = on(env.BURNTICKER_PAIR_CURVE_ENABLED);
  const polymarket = !/^(0|false|no|off)$/i.test((env.BURNTICKER_POLYMARKET_DISCOVERY_ENABLED ?? "").trim());
  const sportsOk = tsdb || !mainnet;
  const pairsOk = pairCurve || !mainnet;
  const sportsWhy = sportsOk ? null : "Games without an on-chain market settle on TheSportsDB's scores, and that license is not linked on this site yet.";
  const pairsWhy = pairsOk ? null : PAIRS_BLOCKER;
  const polyWhy = polymarket ? null : "Polymarket search is turned off on this site.";
  const t = (type: LaunchType, ok: boolean, why: string | null): TypeAvailability => ({ type, label: LABEL[type], available: ok, reason: ok ? null : why });
  const types: Record<LaunchType, TypeAvailability> = {
    team: t("team", sportsOk, sportsWhy), matchup: t("matchup", sportsOk, sportsWhy),
    markets: t("markets", polymarket, polyWhy), elections: t("elections", polymarket, polyWhy),
    feeds: t("feeds", true, null), weather: t("weather", true, null),
    derby: t("derby", pairsOk, pairsWhy), pairs: t("pairs", pairsOk, pairsWhy),
  };
  const sources: SourceAvailability[] = [
    { id: "sports-settlement", label: "Sports settlement, from the on-chain payout or else TheSportsDB's licensed final score", available: sportsOk, reason: sportsWhy },
    { id: "sports-schedule", label: "Sports schedules, from the league feeds and TheSportsDB for the rest", available: true, reason: tsdb ? null : "leagues without a free official schedule list their teams without next games" },
    { id: "polymarket", label: "Polymarket discovery", available: polymarket, reason: polyWhy },
    { id: "nws", label: "National Weather Service daily climate reports", available: true, reason: null },
    { id: "feeds", label: "Public data publishers (Treasury, BLS, FRED, …)", available: true, reason: null },
    { id: "pair-curve", label: "Pair curve (registered pairs on mainnet)", available: pairCurve, reason: pairCurve ? null : "the pair curve is turned off on this site" },
    { id: "burn-real", label: "Coins that burn a real token instead of themselves", available: burnRealOfferedFromEnv(env), reason: burnRealOfferedFromEnv(env) ? null : BURN_REAL_WAITING },
    { id: "burn-sol", label: "Sending the SOL left at the end to Solana's incinerator", available: burnSolOfferedFromEnv(env), reason: burnSolOfferedFromEnv(env) ? null : burnRealFromEnv(env) ? BURN_SOL_OFF : BURN_SOL_NOT_R5 },
    // owner decision 2026-10-13 evening: a sink coin has a beneficiary, $DEFICIT has none; the picker stays off until the list is curated
    { id: "end-sink-picker", label: "Sending the rest to another coin's burn", available: sinkPickerFromEnv(env), reason: sinkPickerFromEnv(env) ? null : "What is left at the end of a rule goes to $DEFICIT's burn on this site." },
  ];
  return { mode, transactions: mode === "open", cluster, banner: mode === "preview" ? PREVIEW_BANNER : mode === "closed" ? CREATOR_LAUNCHES_CLOSED : null, types, sources };
}

/** The client's read of the catalogue's `launches` block; anything unreadable is CLOSED (fail closed). */
export function availabilityFromCatalogue(j: unknown): LaunchAvailabilityModel {
  const c = (j ?? {}) as { launches?: { creators?: unknown; mode?: unknown; types?: unknown; sources?: unknown; banner?: unknown }; cluster?: unknown };
  const cluster = typeof c.cluster === "string" ? c.cluster : null;
  const l = c.launches ?? {};
  const mode: LaunchMode = l.creators === true ? "open" : l.mode === "preview" ? "preview" : "closed";
  const base = availabilityFromEnv({}, cluster);
  const types = { ...base.types } as Record<LaunchType, TypeAvailability>;
  if (l.types && typeof l.types === "object") for (const k of Object.keys(types) as LaunchType[]) { const v = (l.types as Record<string, TypeAvailability | undefined>)[k]; if (v && typeof v.available === "boolean") types[k] = { type: k, label: typeof v.label === "string" ? v.label : LABEL[k], available: v.available, reason: typeof v.reason === "string" ? v.reason : null }; }
  return { mode, transactions: mode === "open", cluster, banner: mode === "preview" ? PREVIEW_BANNER : mode === "closed" ? CREATOR_LAUNCHES_CLOSED : null, types, sources: Array.isArray(l.sources) ? l.sources as SourceAvailability[] : base.sources };
}

/** The launch type a rule (and an optional side-B pair body) belongs to. */
export function launchTypeOf(rule: Pick<BurnRule, "oracle" | "series" | "market"> | null | undefined, o: { pair?: boolean } = {}): LaunchType | null {
  if (!rule) return null;
  if (rule.oracle === "derby") return "derby";
  if (o.pair) return "pairs";
  if (rule.oracle === "catalogue") {
    const s = rule.series ?? "";
    if (s.startsWith("espn.game:")) return "matchup";
    if (s.startsWith("espn.")) return "team";
    if (s.startsWith("nws.")) return "weather";
    return "feeds";
  }
  if (rule.oracle === "polymarket" || rule.oracle === "kalshi") return "markets";
  return null;
}

/** 403 for a closed or preview host (preview: true marks the preview); null when open. */
export function globalRefusal(env: Env = process.env): { status: 403; body: { error: string; code: string; preview: boolean } } | null {
  const mode = launchModeFromEnv(env);
  if (mode === "open") return null;
  return mode === "preview"
    ? { status: 403, body: { error: `${PREVIEW_BANNER} You can still read the review with POST /v1/launch/review. Building launches is refused. A launch already signed and on chain is still recorded.`, code: LAUNCHES_CLOSED_CODE, preview: true } }
    : { status: 403, body: { error: CREATOR_LAUNCHES_CLOSED, code: CREATOR_LAUNCHES_CODE, preview: false } };
}

/** 403 for a launch type this host cannot take (read from the request body: its rule and whether it carries a side-B pair). */
export function typeRefusal(body: unknown, env: Env = process.env, cluster: string | null = null): { status: 403; body: { error: string; code: string; type: LaunchType } } | null {
  const b = (body ?? {}) as { rule?: unknown; pair?: unknown };
  const rule = b.rule && typeof b.rule === "object" ? b.rule as BurnRule : null;
  const type = launchTypeOf(rule, { pair: !!b.pair });
  if (!type) return null;
  const a = availabilityFromEnv(env, cluster).types[type];
  return a.available ? null : { status: 403, body: { error: `${a.label} launches are not available on this site. ${a.reason}`, code: TYPE_UNAVAILABLE_CODE, type } };
}

/** The host's cluster as the catalogue names it (the same reading of BURNTICKER_CLUSTER as the catalogue route). */
export const hostCluster = (env: Env = process.env): "mainnet" | "devnet" | "localnet" => { const c = (env.BURNTICKER_CLUSTER ?? "").trim(); return c === "mainnet" ? "mainnet" : c === "localnet" ? "localnet" : "devnet"; };

/**
 * The catalogue's `launches` block (the app's /api/burnticker/catalogue and /v1/catalogue): `creators` (true only when open — older
 * readers keep working), `note`, and since API 1.14.0 `mode`, `banner`, `types` and `sources`.
 */
/** HB-5: the catalogue source that says the host runs burn dispersal. */
export const BURN_DISPERSAL_SOURCE = "burn-dispersal" as const;
export function catalogueLaunches(env: Env = process.env, now: number = Date.now(), o: { dispersal?: boolean } = {}): { creators: boolean; note: string; mode: LaunchMode; banner: string | null; types: Record<LaunchType, TypeAvailability>; sources: SourceAvailability[]; hostedSigning: HostedSigning; readAt: string } {
  const m = availabilityFromEnv(env, hostCluster(env));
  // HB-5 (2026-10-19): burn dispersal is the host's own decision (programHash.ts webDispersalOn, a server read the caller passes in), so a
  // single one-time coin is offered 50% on the page exactly where the review and the bundle route accept it
  const sources = [...m.sources, { id: BURN_DISPERSAL_SOURCE, label: "Burning half the pool on a one-time coin", available: o.dispersal === true, reason: o.dispersal === true ? null : "A one-time coin burns its whole pool on this site." }];
  return { creators: m.mode === "open", note: m.mode === "open" ? "creator launches are open on this site" : m.mode === "preview" ? PREVIEW_BANNER : CREATOR_LAUNCHES_CLOSED, mode: m.mode, banner: m.banner, types: m.types, sources, ...catalogueLaunchState(env, now) };
}


// ---- THE SITE'S ONE LAUNCH-STATE RECORD (website-12, 2026-10-12) ------------------------------------------------------------------
/**
 * ONE TYPED RECORD FOR EVERY OPEN / CLOSED SENTENCE (Claude site audit 2 item 1, ChatGPT chat audit 6 A1 and A11, code review 5 item 2).
 * Trust and Operator said "Creator launches are closed" in the dated summary and "open" in the host line; About said closed; the header's
 * disabled wallet said closed; the meta tags said closed; and the launcher offered an enabled "Open wallet and launch" although no launch
 * can be signed on this site. Every such sentence now reads `siteLaunchState` (server pages, from the env) or
 * `siteLaunchStateFromCatalogue` (client pages, from GET /api/burnticker/catalogue). Nothing else may write "open" or "closed".
 *
 *   read           loading | ready | unavailable (the catalogue could not be read) | stale (the reading is older than STALE_AFTER_MS)
 *   mode           closed | preview | open (the host flags, launchModeFromEnv)
 *   types / pairs  which launch types this host takes and why not; `pairs` is the one pair line (Coin vs Coin, registered pairs and the
 *                  two-coin Matchup) with its blocker
 *   hostedSigning  whether a launch started on this site can be signed and sent at all. False today, from three source facts: the server
 *                  wires a stand-in LaunchLab adapter (server.ts), the server's launch route does not pass allowMainnet to the builder
 *                  (handlers.ts prepareLaunch, so launchBundle.ts refuses mainnet), and no address lookup table is pinned for the network
 *                  (networks.ts LOOKUP_TABLES, which the browser needs to sign). test/burntickerWebsite12.test.ts reads those sources so
 *                  the constants below cannot drift from them.
 *   canSign        mode open, read ready, hosted signing complete. The launch button is enabled only when this is true.
 *   sentence       THE one sentence about launching on this site; `walletNote` the header's wallet line (connection only; it gates
 *                  "Your coins"); `meta.description` the pages' description and social previews.
 *
 * Pure and client-safe. A missing or malformed catalogue field is read as the safe value (closed, cannot sign).
 */
export type SiteLaunchRead = "loading" | "ready" | "unavailable" | "stale";
export interface HostedSigning { complete: boolean; blockers: string[]; /** Phantom v1 step 2: what only a version-0 wallet still needs (the lookup-table pin) */ fallbackBlockers?: string[] }
export interface SiteLaunchState {
  read: SiteLaunchRead;
  mode: LaunchMode;
  cluster: string | null;
  types: Record<LaunchType, TypeAvailability>;
  /** Coin vs Coin, registered pairs and the two-coin Matchup: one line and its blocker (null when available). */
  pairs: { available: boolean; line: string | null; detail: string | null };
  hostedSigning: HostedSigning;
  /** Round 5: whether a coin may burn a real token on this site (the round-5 program and BURNTICKER_BURN_REAL_ENABLED), and the waiting line when not. */
  burnReal: { available: boolean; line: string | null };
  /**
   * End-sink picker (2026-10-13): whether a coin may send its rest to Solana's incinerator (a round-5 program sink another change builds).
   * Read from the `burn-sol` source (owner 2026-10-19: on wherever the round-5 program runs, unless BURNTICKER_BURN_SOL_ENABLED is off);
   * a catalogue without it reads false and the end step's slot stays hidden (fail closed).
   */
  burnSol: { available: boolean };
  /** HB-5: the host runs burn dispersal, so a single one-time coin may burn half its pool (the `burn-dispersal` source; absent reads false). */
  dispersal: { available: boolean };
  /** The "another coin's burn" end choice. Owner decision 2026-10-13 evening: held back until the list is curated (a sink coin has a
   *  beneficiary; $DEFICIT has none). Read from an `end-sink-picker` source that only BURNTICKER_END_SINK_PICKER=1 exposes. */
  sinkPicker: { available: boolean };
  /** The launch button may sign and send: open, freshly read, hosted signing complete. */
  canSign: boolean;
  /** The wizard (search, tiles, review card) may render: open or preview, freshly read. */
  wizard: boolean;
  /** THE one open / closed sentence for this site. */
  sentence: string;
  /** Why the launch button cannot sign, in one sentence (null when it can). */
  signingSentence: string | null;
  /** The header's wallet explanation: what connecting does, and that it is only for "Your coins". */
  walletNote: string;
  meta: { description: string };
  /** When the host answered (ISO), null when unknown. */
  readAt: string | null;
}

/** The headline every description starts with (Claude site audit 2 item 1: "the current headline"). */
export const SITE_HEADLINE = "Memecoins that burn on real-world results. Every burn leaves a receipt.";
/**
 * The pages' description and social previews (prelaunch audit 2026-10-16 F-12/F-13). Statically built pages bake their description in
 * when the site is built, so it names no launch state: the built pages kept saying "Creator launches are not open" after launches opened.
 * The launch state is shown on the page itself, read live.
 */
export const SITE_META_DESCRIPTION = `${SITE_HEADLINE} Each coin locks one rule when it is created, and its own trading fees pay for its burns.`;
/** A catalogue reading older than this is stale: launch controls stay off until the page reads it again. */
export const STALE_AFTER_MS = 15 * 60_000;
/**
 * The server's launch wiring. Since launch-10 (2026-10-12) the real LaunchLab client and the mainnet allowance exist in code, so
 * whether a launch started on this site can be signed is a HOST question (env), read live from hostedLaunch.ts's `hostedSigning`, not a
 * source fact. These two constants record that the code paths exist; test/burntickerWebsite12.test.ts pins them to the source.
 */
export const HOSTED_LAUNCHLAB_ADAPTER: "stand-in" | "real" = "real";
export const HOSTED_BUILDER_ALLOWS_MAINNET = true;

export const SITE_SENTENCE = {
  loading: "Checking whether creator launches are open on this site.",
  unavailable: "Whether creator launches are open is unknown right now, so no launch controls are shown.",
  stale: "The launch status on this page is out of date, so launch controls stay off. Reload the page to read it again.",
  closed: CREATOR_LAUNCHES_CLOSED,
  preview: PREVIEW_BANNER,
  reviewOnly: "You can set up and review a coin on this site, but a launch cannot be signed here yet.",
  open: "Creator launches are open on this site.",
} as const;
export const SIGNING_UNAVAILABLE = "A launch cannot be signed on this site yet, so the launch button stays off.";
export const WALLET_NOTE = "Connecting a wallet only shares its public address with this site. It is used to list your coins on Your coins. Nothing is signed when you connect.";

/**
 * Why a launch started on this site cannot be signed and sent (empty = it can): the host's live wiring from hostedLaunch.ts
 * (allowance, RPC, program, platform, admin, fee wallet, the browser RPC on mainnet, the client setting, the lookup-table pin).
 * `cluster` only overrides the network the host would otherwise read from env.
 */
export function hostedSigningFor(cluster: string | null, env: Env = process.env): HostedSigning {
  const e = cluster === "mainnet" || cluster === "devnet" ? { ...env, BURNTICKER_CLUSTER: cluster } : env;
  const h = hostedSigningLive(e as Readonly<Record<string, string | undefined>>);
  return { complete: h.canComplete, blockers: h.blockers, fallbackBlockers: h.fallbackBlockers };
}

/** Round 5 from the model's `burn-real` source; a missing source or an unfresh reading is "waiting" (fail closed). */
function burnRealOf(m: LaunchAvailabilityModel, fresh: boolean): { available: boolean; line: string | null } {
  const ok = fresh && m.sources.some((x) => x.id === "burn-real" && x.available === true);
  return { available: ok, line: ok ? null : BURN_REAL_WAITING };
}

function stateFrom(read: SiteLaunchRead, m: LaunchAvailabilityModel, hostedSigning: HostedSigning, readAt: string | null): SiteLaunchState {
  const fresh = read === "ready";
  const mode: LaunchMode = fresh ? m.mode : "closed";
  const pairsA = m.types.pairs;
  const canSign = fresh && mode === "open" && hostedSigning.complete;
  const sentence = read === "loading" ? SITE_SENTENCE.loading : read === "unavailable" ? SITE_SENTENCE.unavailable : read === "stale" ? SITE_SENTENCE.stale
    : mode === "closed" ? SITE_SENTENCE.closed : mode === "preview" ? SITE_SENTENCE.preview : hostedSigning.complete ? SITE_SENTENCE.open : SITE_SENTENCE.reviewOnly;
  const signingSentence = canSign ? null : !fresh || mode !== "open" ? sentence : SIGNING_UNAVAILABLE;
  return {
    read, mode, cluster: m.cluster, types: m.types,
    pairs: { available: pairsA.available, line: pairsA.available ? null : PAIRS_UNAVAILABLE_LINE, detail: pairsA.available ? null : pairsA.reason },
    burnReal: burnRealOf(m, fresh),
    burnSol: { available: fresh && m.sources.some((x) => x.id === "burn-sol" && x.available === true) },
    dispersal: { available: fresh && m.sources.some((x) => x.id === BURN_DISPERSAL_SOURCE && x.available === true) },
    sinkPicker: { available: fresh && m.sources.some((x) => x.id === "end-sink-picker" && x.available === true) },
    hostedSigning, canSign, wizard: fresh && (mode === "open" || mode === "preview"), sentence, signingSentence, walletNote: WALLET_NOTE,
    meta: { description: SITE_META_DESCRIPTION },
    readAt,
  };
}

/** Server pages and routes: the record from the host's environment. */
export function siteLaunchState(env: Env = process.env, now: number = Date.now()): SiteLaunchState {
  const cluster = hostCluster(env);
  return stateFrom("ready", availabilityFromEnv(env, cluster), hostedSigningFor(cluster, env), new Date(now).toISOString());
}

/** Before the catalogue answers. */
export const SITE_LAUNCH_STATE_LOADING: SiteLaunchState = stateFrom("loading", availabilityFromCatalogue(null), { complete: false, blockers: [] }, null);

/**
 * Client pages: the record from the catalogue body. `failure` (the request failed or was not JSON) → unavailable; a `launches.readAt`
 * older than STALE_AFTER_MS → stale; a missing `hostedSigning` → cannot sign. All three keep every launch control off.
 */
export function siteLaunchStateFromCatalogue(body: unknown, o: { failure?: string | null; now?: number } = {}): SiteLaunchState {
  if (o.failure != null || !body || typeof body !== "object") return stateFrom("unavailable", availabilityFromCatalogue(null), { complete: false, blockers: [] }, null);
  const l = ((body as { launches?: { hostedSigning?: unknown; readAt?: unknown } }).launches ?? {});
  const hs = l.hostedSigning as Partial<HostedSigning> | undefined;
  const hostedSigning: HostedSigning = hs && typeof hs.complete === "boolean" && Array.isArray(hs.blockers)
    ? { complete: hs.complete, blockers: hs.blockers.filter((b): b is string => typeof b === "string"), ...(Array.isArray(hs.fallbackBlockers) ? { fallbackBlockers: hs.fallbackBlockers.filter((b): b is string => typeof b === "string") } : {}) }
    : { complete: false, blockers: ["This site did not say whether a launch can be signed here."] };
  const readAt = typeof l.readAt === "string" && !Number.isNaN(Date.parse(l.readAt)) ? l.readAt : null;
  const stale = readAt !== null && (o.now ?? Date.now()) - Date.parse(readAt) > STALE_AFTER_MS;
  return stateFrom(stale ? "stale" : "ready", availabilityFromCatalogue(body), hostedSigning, readAt);
}

/** The catalogue's additive fields for the record: `hostedSigning` and `readAt`. */
export function catalogueLaunchState(env: Env = process.env, now: number = Date.now()): { hostedSigning: HostedSigning; readAt: string } {
  return { hostedSigning: hostedSigningFor(hostCluster(env), env), readAt: new Date(now).toISOString() };
}
