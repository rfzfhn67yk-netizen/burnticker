"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import type { StatedJson } from "@/lib/burnticker/pageTypes";
import type { FinalAfter, StatedSource } from "@/lib/burnticker/sources/polyStated";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { previewTotals, unitStep, type SettledEvent } from "@/lib/burnticker/units";
import type { BurnRule } from "@/lib/burnticker/rules";
import { aliasLookup } from "@/lib/burnticker/oracle/events";
import { firstPartyRule } from "@/lib/burnticker/wizard";
import { plainSentence, ruleOneLiner } from "@/lib/burnticker/coinCard";
import { CoinCard } from "../_components/CoinCard";
import { FieldHelp } from "../_components/FieldHelp";
import { CoinVsCoinTile, CVC_STORE } from "./CoinVsCoinTile";
import { LAUNCH_START_EVENT } from "@/lib/burnticker/launchStart";
import { SignCard } from "./SignCard";
import { launchlabPlan, pairCurvePlan } from "@/lib/burnticker/signPlan";
import type { SerializedIx } from "@/lib/burnticker/program";
import { ReviewCard } from "./ReviewCard";
import { launchErrorMessage, LaunchRequestError, PAIR_CURVE_REVIEW_LINE, postPairLaunch, venueFor, venueFrom409, type LaunchErrorBody, type PairVenue } from "@/lib/burnticker/pairLaunchClient";
import type { PairCurveLaunchBundle } from "@/lib/burnticker/pairCurveLaunch";
import { STATIONS, nwsSeries, parseNwsSeries } from "@/lib/burnticker/sources/nws";
import { applyDial, dialsFor, ON_END_DEFAULT, type DialId } from "@/lib/burnticker/dials";
import { DEFICIT_SITE } from "@/lib/burnticker/creatorLaunches";
import { NO_WALLET_LINE } from "@/lib/burnticker/glossary";
import { LaunchRecovery } from "./LaunchRecovery";
import { LAUNCH_GATE_LOADING, launchGateFromCatalogue, wizardMayRender, type LaunchGateState } from "@/lib/burnticker/launchGateState";
import { availabilityFromCatalogue, launchTypeOf, PREVIEW_BANNER, siteLaunchStateFromCatalogue, SITE_LAUNCH_STATE_LOADING, type LaunchAvailabilityModel, type LaunchType, type SiteLaunchState } from "@/lib/burnticker/launchAvailability";
import { draftRevision, EMPTY_REVIEW_SLOT, reviewAnswered, reviewFor, reviewMatchesDraft, reviewRequested, REVIEW_UPDATING, type ReviewSlot } from "@/lib/burnticker/launchReviewSync";
import { DEFAULT_SHARE, SLICED_ABOVE, isRaisePreset, shareOf, SHARE_PRESETS, presetRowLabel, pctLabel as presetPct, snapToPreset, DEFAULT_RAISE_SOL, RAISE_PRESETS_SOL, type RaisePreset } from "@/lib/burnticker/launchPresets";
import { loadCatalogue } from "@/lib/burnticker/catalogueClient";
import { NEXT_GAME_UNAVAILABLE, sourceUnavailableLine, sportsConfirmationLine, sportsProvenanceLine, SPORTS_PROVENANCE } from "@/lib/burnticker/sources/provenance";
import { PreWalletSummary } from "./PreWalletSummary";
import { BACKTEST_UNAVAILABLE } from "@/lib/burnticker/oracle/backtest";
import { EMPTY_PROFILE, ProfileFields, chosenPreview, profileBody, profileProblems, type ProfileUpdate, type ProfileValue } from "./ProfileFields";
import { teamAdvancedDefaults } from "@/lib/burnticker/creatorCopy";
import { wxThresholdProblem } from "@/lib/burnticker/launchFields";
import { composeRule, fieldsFromRule, launchBody } from "@/lib/burnticker/launchDraft";
import type { LaunchReview } from "@/lib/burnticker/launchReview";
import { LaunchGate } from "./LaunchGate";
import { CreatorOnboarding } from "../_components/CreatorOnboarding";
import { CreatorBenefitsList } from "../templates/CreatorBenefitsList";
import { ExampleTickets } from "../templates/ExampleTickets";
import { EXAMPLES_AND_BENEFITS_LABEL } from "@/lib/burnticker/exampleTickets";
import { DuplicateNotice } from "./DuplicateNotice";
import type { ExistingCoin } from "@/lib/burnticker/duplicateRule";
import { PairFundsFlow } from "../_components/PairFundsFlow";
import { championPathRule, describeRule, shortDate, windowKindOf, DESCRIPTION_MAX, PAIR_REVIEW_LINE, independentPairFacts, winnerTakesBurnFacts, type CoinText, type DescribeCtx } from "@/lib/burnticker/describe";
import { parseEspnSeries, seasonYearAt, teamSeries, type LeagueId, type Window as TeamWindow } from "@/lib/burnticker/sources/espn";
import { TEMPLATES, TEMPLATE_START, weatherTemplateDraft, type TemplateId } from "@/lib/burnticker/templates";
import type { Suggestion as SearchSuggestion } from "@/lib/burnticker/search";
import { fold, meaningful, queryTokens } from "@/lib/burnticker/textMatch";
import { EndSection, FollowStep, GuidedTop, PatternStep, RivalryKindStep, StickyAction, type GuidedPhase } from "./GuidedSteps";
import { edgeCase } from "@/lib/burnticker/ruleEdgeCases";
import { creatorLinks } from "@/lib/burnticker/creatorProfile";
import { drainLine } from "@/lib/burnticker/drain";
import { sourceSubjectLabel } from "@/lib/burnticker/paramNames";
import { prepareIfCurrent, profileRevision, STALE_PREPARE_SENTENCE } from "@/lib/burnticker/preparedLaunch";
import { endText } from "@/lib/burnticker/describe";
import { HAZARD_FOLLOW, HAZARD_KINDS, hazardPatternOptions, hazardSwap } from "@/lib/burnticker/hazards";
import { FACT_LABELS, PATTERN_REASON, PERPETUAL_END_LINE, NO_LISTED_MEETING_LINE, RIVAL_SAME_TEAM, RIVALRY_GAME_LABEL, RIVALRY_GAME_LINE, RIVALRY_SCOPE_LINE, RIVALRY_SEASON_LABEL, RIVALRY_SEASON_LINE, SCHEDULE_UNAVAILABLE_LINE, meetingsOf, scheduleCoverageLine, seasonPairNames, costLine, electionAuthorityLines, patternWords, shareExample, upfrontLines, whichCoinLine, whichHeading, FOLLOW_CHOICES, IMAGE_NOT_KEPT, meetingOf, otherTeams, seasonPairRules, RESERVED_REFUSAL, beforeGraduationLine, budgetCopy, oneShotSentences, candidateFacts, endSentences, matchupFacts, pairIdentityProblems, pairNames, pairTickers, patternOptions, teamTicker, teamTickerForRule, unitPhrase, type FollowId, type PatternId } from "@/lib/burnticker/guidedLaunch";
import type { TickerCheck } from "@/lib/burnticker/tickerCheck";

/**
 * THE LAUNCH PAGE (LAUNCHPAD-PATH §1; rebuilt 2026-10-10 on the owner's cut: "it feels overly complicated to get a coin set up … the UI
 * needs to be simpler, even if it means giving up a little bit of adjustability"). The web UI offers PRESETS; the API offers DIALS
 * (docs/burnticker/ui-conventions.md § Presets, not dials — the list of what moved to API-only and its endpoint).
 *
 *   1. WHAT BURNS IT   the sentence search (one click on a card; an event card opens its list of names), or one of four tiles — Team
 *                      coin (league → team), Matchup (league → game), Coin vs Coin (two coins), Any result (category → source; Elections:
 *                      race → candidate) — or a template / "launch one like this".
 *   2. THE REVIEW CARD ReviewCard.tsx: generated art, name + ticker prefilled (tap to edit), the rule in one sentence, "Ends: …, then winds
 *                      down", the receipts line, one preset row with the default chosen (recurring 2 / 5 / 10 %, one-shot 10 / 50 / 100 %;
 *                      a Matchup also "until the result" / "this season"), an "add a note" link.
 *   3. LAUNCH          pressing it is the acknowledgement (the line under the button); without a wallet it opens the wallet chooser first.
 *
 * Every launched rule still passes the same lint, preflight and locked-description gates on the server; the request body and the launch
 * route are unchanged. test/burntickerThreeDecisions.test.ts holds the page to three decisions. Time-to-launch telemetry records the
 * screens shown and the decisions made per launch (productStore.ts) for the before / after.
 */

type Step = "choose" | "team" | "pick" | "rule" | "name" | "review" | "launch";
/** team = one team's every game; pair = two teams; single = any Kalshi or Polymarket market; feed = advanced (first-party feed / custom selector). */
type Flow = "team" | "pair" | "single" | "feed" | "browse";
const ORDER: Record<Flow, Step[]> = { team: ["team", "review", "launch"], pair: ["pick", "review", "launch"], single: ["pick", "review", "launch"], feed: ["pick", "review", "launch"], browse: ["pick", "review", "launch"] };
const LABELS: Record<Flow, Partial<Record<Step, string>>> = {
  team: { team: "Pick your team", review: "Review", launch: "Launch" },
  pair: { pick: "Pick the game", review: "Review", launch: "Launch both" },
  single: { pick: "Find a market", review: "Review", launch: "Launch" },
  feed: { pick: "Source", review: "Review", launch: "Launch" },
  browse: { pick: "Pick a source", review: "Review", launch: "Launch" },
};
/** A ready-made rule from the universal search (GET /api/burnticker/v1/search; the shape is search.ts Suggestion). */
type Suggestion = SearchSuggestion;
/** Browse (GET /api/burnticker/v1/browse): one source, any venue, in one shape. */
interface BrowseCategory { id: string; label: string; blurb: string; feeds: number; polymarket: string[]; kalshi: string[]; guided?: string | null; adjudicatedOnly?: boolean }
interface ElOutcome { conditionId: string; label: string; question: string; yes: string; no: string; title: string; settles: string; rule: BurnRule }
interface ElRace { slug: string; title: string; url: string; settlesOn: string | null; description: string | null; hiddenPlaceholders: number; sos: { name: string; url: string }; settlement: string; refused: string[]; outcomes: ElOutcome[] }
interface ElPairSide { candidate: string; name: string; ticker: string; components: { fecBeats: BurnRule | null; winner: BurnRule }; sentences: { fecBeats: string | null; winner: string }; outcome: { conditionId: string; question: string; yes: string; no: string } }
interface ElPair { a: ElPairSide; b: ElPairSide; crossRead: { name: string; url: string }; pending: string[] }
interface SourceCardT { id: string; venue: "feed" | "polymarket" | "kalshi"; venueLabel: string; tier: number; tierLabel: string; title: string; cadence: string | null; kind: "binary" | "scalar"; next: { label: string; at: string | null } | null; example: string; launchable: { ok: boolean; why: string | null }; refused: string[]; diagnostics?: string[]; flags: string[]; sourceName: string | null; sourceUrl: string | null; /** sources-3: the single-publisher settlement sentence (hazard feeds only) */ settlement?: string | null; /** sources-4 205: the parameter example's note */ paramNote?: string | null; /** sources-4 213: a title with a blank, resolved per child market */ outcomes?: { question: string; market: string }[] | null; pick: { oracle: "catalogue" | "polymarket" | "kalshi"; series: string | null; market: string | null; title: string }; configure?: { kind: "team"; league: string } | { kind: "weather"; metric: "high" | "rain" | "snow" } | null }
interface Series { ticker: string; title: string; category: string | null; frequency: string | null; settlementSource: { name: string; url: string } | null; refused: string[] }
interface Source { id: string; kind: string; tier: number; tierLabel: string; title: string; sourceName: string; sourceUrl: string; cadence: string; unit: { size: number; label: string; definition: string } | null; direction: "up" | "down" | "abs" | null; baseline: "previousSettlement" | number | null; flags: string[]; launchable: { ok: boolean; why: string | null }; param: string | null; lastReading: { id: string; value: string | null; at: string } | null; readings: { id: string; value: string | null }[]; preview: { window: { from: string; to: string }; units: number; burnEvents: number; poolFractionSpent: number | null } | null }
interface Backtest { sentence: string; text: string; sha256: string; sha12: string; mode: string; statement: string; seriesTitle: string | null; refusals: { reason: string }[]; matched: number; backtest: { rows: { id: string; at: string; title: string | null; result: string | null; value: string | null; units: number; kind: string }[]; totals: { events: number; burnEvents: number; voids: number; units: number; poolFractionSpent: number | null; tokens: number | null }; oneShot: { resolvesOn: string | null } | null } }
interface Bundle { ready: boolean; pending: string[]; mint: string; ticker: string; mintSecretKey: string | null; rules: { text: string; sha256: string; statement: string; mode: string }; addresses: { feePda: string; feeWsol: string; vault: string | null; poolId: string | null; platformId: string }; transactions: { label: string; signers: string[]; instructions: SerializedIx[] }[]; notes: string[] }
interface League { id: string; label: string; series: { ticker: string; title: string }[]; sport?: string; crossRead?: string | null; draws?: boolean }
interface Team { /** WIRING-PARITY audit 6 #2: the season's state for this team, with its warning when no game is left */ seasonWarning?: string | null; abbr: string; city: string; nickname: string | null; name: string; ticker: string; league: string | null; filter: string; collisions: string[]; next: { eventTicker: string; marketTicker: string; title: string; expectedAt: string | null; opponent: string | null } | null; record: { w: number; l: number; d: number; since: string }; series?: { win: string; loss: string }; recordText?: string | null }
/** The sports pickers (GET /v1/sports/teams, /v1/sports/games): the leagues' own schedules or TheSportsDB, never ESPN. */
interface SportsTeam { abbr: string; city: string; nickname: string; name: string; ticker: string; league: string; series: { win: string; loss: string }; record?: string | null; season?: { status: "upcoming" | "none-listed" | "unknown" | "over"; warning: string | null }; next: { eventId: string; title: string; startsAt: string; detail: string; opponent: string; home: boolean } | null }
interface SportsSide { abbr: string; name: string; nickname: string; ticker: string; record: string | null }
interface SportsGame { eventId: string; league: string; title: string; startsAt: string; detail: string; a: SportsSide; b: SportsSide; series: { aLoss: string; bLoss: string } }
const recordOf = (r: string | null | undefined): { w: number; l: number; d: number; since: string } => { const m = /^(\d+)-(\d+)(?:-(\d+))?$/.exec(r ?? ""); return { w: m ? Number(m[1]) : 0, l: m ? Number(m[2]) : 0, d: m && m[3] ? Number(m[3]) : 0, since: "" }; };
interface Side { abbr: string; marketTicker: string; label: string; nickname: string | null; name: string; ticker: string }
interface PolyMarket { conditionId: string; question: string; yes: string; no: string; endDate: string | null; closed: boolean; sportsMarketType: string | null; /** the outcome's name inside its event (Gamma groupItemTitle), when named */ outcome?: string | null; /** sources-2 (oracle/polymarket.ts polyStated) */ resolutionSource?: StatedSource; finalAfter?: FinalAfter }
interface PolyEvent { slug: string; title: string; url: string; endDate: string | null; closed: boolean; markets: PolyMarket[]; marketCount: number; refused: string[] }
interface PolyTag { slug: string; label: string; events: number; series: string[] }
interface PolyFound { events: PolyEvent[]; tags: PolyTag[]; markets: PolyMarket[] }
type Venue = "kalshi" | "polymarket";
interface EventHit { eventTicker: string; seriesTicker: string; title: string; subTitle: string | null; category: string | null; expectedAt: string | null; closeTime: string | null; markets: { ticker: string; suffix: string; label: string; status: string }[]; matchedSides: string[]; pair: { a: Side; b: Side; tieMarket: string | null } | null; refused: string[] }

/** The web UI's shares come from launchPresets.ts (docs/burnticker/ui-conventions.md § Presets, not dials); the API takes any share. */
const PUB = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const STORE = "burnticker.launch.v2";
const V1 = "/api/burnticker/v1";
// snag 19: the year whenever it is not this year, and the zone named ("MDT"), so a date can never be read as the wrong one
const denver = (iso: string | null) => { if (!iso) return "—"; const d = new Date(iso); if (Number.isNaN(d.getTime())) return "—"; const other = d.getUTCFullYear() !== new Date().getUTCFullYear(); return new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", weekday: "short", month: "short", day: "numeric", ...(other ? { year: "numeric" as const } : {}), hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(d); };
/** The review card's "Ends:" line from the coin text's window sentence (describe.ts WINDOW_SENTENCE): when, then the wind-down. */
function endsLine(t: CoinText | null): string | null {
  if (!t) return null;
  const w = t.windowSentence;
  // website-18 the champion path (describe.ts championEndSentences): the end says where the rest goes, champion or not
  const champ = /covers the (.+?) season only\. (If .+ win the championship.+)$/.exec(w);
  if (champ) return `The rule ends after the team's last game of the ${champ[1]} season, playoffs included. ${champ[2]} If the result is voided or the season is cancelled, the rest burns down on this coin over four weeks instead.`;
  const season = /covers the (.+?) season only/.exec(w), post = /covers (.+?) postseason only/.exec(w), next = /next (\d+) games? only/.exec(w), once = /^(?:This coin r|R)esolves once,?(?: on ([A-Z][a-z]{2} \d{1,2}, \d{4}))?/.exec(w);
  // the deployed end of a rule: the coin's own pool burns down over 28 days, then the coin retires (no end-of-rule sink is deployed)
  const after = "Then its own burn pool burns down over 28 days, and the coin retires.";
  if (season) return `The rule ends after the last game of the ${season[1]} season. ${after}`;
  if (post) return `The rule ends after ${post[1]} postseason. ${after}`;
  if (next) return `The rule ends after ${next[1]} games. ${after}`;
  if (once) return `The rule ends when the result is in${once[1] ? `, expected around ${once[1]}` : ""}. ${after}`;
  return t.windowKind === "perpetual" ? "This coin has no end date." : null;
}
/** L05: a failed read becomes a plain sentence; the technical detail (status, body) rides on `detail`, never in the sentence. */
class ReadError extends Error { detail: string; constructor(plain: string, detail: string) { super(plain); this.detail = detail; } }
const getJson = async <T,>(url: string, init?: RequestInit): Promise<T> => {
  let r: Response;
  try { r = await fetch(url, init); } catch (e) { throw new ReadError("the source could not be reached just now", String((e as Error)?.message ?? e)); }
  const j = await r.json().catch(() => null) as { error?: string } | null;
  if (!r.ok) throw new ReadError(r.status === 429 ? "too many requests for a moment — try again shortly" : "the source did not answer just now", `HTTP ${r.status}${j?.error ? `: ${j.error}` : ""}`);
  return j as T;
};
/** L11: a refusal in plain words ("Burnticker does not offer coins on markets about deaths."), never an internal reference. */
const refusedLine = (reasons: string[]): string => `Burnticker does not offer coins on ${reasons.join(", or on ")}.`;
const detailOf = (e: unknown): string => (e instanceof ReadError ? e.detail : String((e as Error)?.message ?? e));
/** L03: where the review was entered from — restored by Back (flow, step, the query or category, the scroll position). */
type EntryKind = "search" | "exact" | "template" | "browse" | "team" | "matchup" | "like";
interface Origin { kind: EntryKind; flow: Flow; step: Step; uq: string; q2: string; cat: string; bq: string; leagueSeries: string | null; scrollY: number }
/** The unit a first-party NWS rule counts (sources/native.ts): one qualifying day (or the season's first snow). */
const weatherSource = (metric: "high" | "rain" | "snow") => ({ unit: { size: 1, label: metric === "snow" ? "the first snow" : "1 qualifying day", definition: "one burn per qualifying day, read from the final climate report once the cross-read agrees" }, baseline: 0, direction: "up" as const });
const ENTRY_LABEL: Record<EntryKind, string> = { search: "From the search", exact: "Exact market", template: "From a template", browse: "Browse", team: "Team coin", matchup: "Matchup", like: "Launch one like this" };

/**
 * audit 7 item 14: Start over resets IN PLACE (no reload): the wizard is remounted under a new key, which clears every choice, and the
 * address drops its step.
 */
export default function LaunchPage() {
  const [run, setRun] = useState(0);
  return <LaunchWizard key={run} onReset={() => setRun((n) => n + 1)} />;
}

function LaunchWizard({ onReset }: { onReset: () => void }) {
  const wallet = useWallet();
  const [flow, setFlow] = useState<Flow>("team");
  const [step, setStep] = useState<Step>("choose");
  const [cluster, setCluster] = useState<string | null>(null);
  // BURNTICKER_CREATOR_LAUNCHES_ENABLED (default off): the catalogue's launches.creators decides; until it answers a neutral skeleton
  // (launchGateState.ts — the wizard never flashes before the gate resolves; an unreadable catalogue keeps the controls hidden).
  const [gate, setGate] = useState<LaunchGateState>(LAUNCH_GATE_LOADING);
  const [venues, setVenues] = useState<{ kalshi: boolean; polymarket: boolean; feeds: boolean; pairCurve?: boolean }>({ kalshi: true, polymarket: true, feeds: true });
  // review N6: a rivalry pair goes out with the venue this host uses (catalogue venues.pairCurve; a 409 corrects a stale read)
  const [pairVenue, setPairVenue] = useState<PairVenue>("launchlab");
  // browse
  const [cats, setCats] = useState<BrowseCategory[]>([]), [cat, setCat] = useState<string>("sports"), [cards, setCards] = useState<SourceCardT[] | null>(null), [cardsBusy, setCardsBusy] = useState(false), [browseErr, setBrowseErr] = useState<string[]>([]), [bq, setBq] = useState("");
  const [drill, setDrill] = useState<string | null>(null), [drillEvents, setDrillEvents] = useState<EventHit[] | null>(null), [etypesErr, setEtypesErr] = useState<string | null>(null);
  // elections (Browse → Elections & Politics): race type → state → race → outcome (GET /v1/elections), and the election-pair template
  const [etypes, setEtypes] = useState<{ id: string; label: string; races: number }[]>([]), [etype, setEtype] = useState<string | null>(null), [estates, setEstates] = useState<{ abbr: string; name: string; races: number }[]>([]), [estate, setEstate] = useState<string | null>(null), [eraces, setEraces] = useState<ElRace[] | null>(null), [ebusy, setEbusy] = useState(false), [esel, setEsel] = useState<string[]>([]), [epair, setEpair] = useState<ElPair | null>(null);
  // weather (Browse → Weather & Climate): station + threshold
  const [wx, setWx] = useState<{ metric: "high" | "rain" | "snow"; station: string; threshold: string } | null>(null);
  // the universal search (GET /v1/search): describe the event, get ready-made rules; one click lands on the create screen
  const [closingSoon, setClosingSoon] = useState(false);
  const [uq, setUq] = useState(""), [ures, setUres] = useState<{ cards: (Suggestion & { existing?: ExistingCoin[] })[]; empty: boolean; categories: { id: string; label: string; blurb: string }[] } | null>(null), [ubusy, setUbusy] = useState(false);
  const [howSettles, setHowSettles] = useState<string | null>(null), [settleNote, setSettleNote] = useState<string | null>(null);
  const [pasted, setPasted] = useState("");
  const creator = wallet.publicKey?.toBase58() ?? (PUB.test(pasted.trim()) ? pasted.trim() : "");
  // team / pair pickers
  const [leagues, setLeagues] = useState<League[]>([]), [leagueErr, setLeagueErr] = useState<string | null>(null);
  const [leagueSeries, setLeagueSeries] = useState<string | null>(null), [leagueQ, setLeagueQ] = useState(""), [scheduleNote, setScheduleNote] = useState<string | null>(null);
  const [teams, setTeams] = useState<Team[]>([]), [teamsBusy, setTeamsBusy] = useState(false), [teamQ, setTeamQ] = useState("");
  const [team, setTeam] = useState<Team | null>(null), [winLose, setWinLose] = useState<"win" | "lose">("win");
  const [games, setGames] = useState<EventHit[]>([]), [gamesBusy, setGamesBusy] = useState(false), [gameQ, setGameQ] = useState("");
  const [game, setGame] = useState<EventHit | null>(null), [swap, setSwap] = useState(false), [pairMode, setPairMode] = useState<"game" | "season" | "perpetual">("game");
  // any-market search (events + series)
  const [q2, setQ2] = useState(""), [found, setFound] = useState<{ results: Series[]; events: EventHit[]; ranking: "events" | "series" } | null>(null), [findBusy, setFindBusy] = useState(false);
  const [polyFound, setPolyFound] = useState<PolyFound | null>(null), [polyErr, setPolyErr] = useState<string | null>(null);
  // advanced: custom selector + first-party feeds
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Series[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [pick, setPick] = useState<{ oracle: "kalshi" | "catalogue" | "polymarket"; series: string | null; market: string | null; title: string; source?: Source; yes?: string; no?: string } | null>(null);
  const [filter, setFilter] = useState("");
  // a Polymarket question filter is plain words (escaped into the rule's titleRegex); the head-to-head games preset is the one regex,
  // set by the "every <league> game" recurring choice and dropped as soon as the creator types their own words
  const [polyPreset, setPolyPreset] = useState<string | null>(null);
  // the generic rule (any market / advanced)
  const [kind, setKind] = useState<"binary" | "scalar">("binary");
  const [mode, setMode] = useState<"buyback" | "vault">("buyback");
  const [onYes, setOnYes] = useState(0.02), [onNoEnabled, setOnNoEnabled] = useState(false), [onNo, setOnNo] = useState(0.01);
  const [unit, setUnit] = useState(1), [perUnit, setPerUnit] = useState<number>(DEFAULT_SHARE.recurring), [baseline, setBaseline] = useState<"previousSettlement" | number>("previousSettlement"), [direction, setDirection] = useState<"up" | "down" | "abs">("up");
  const [tokensYes, setTokensYes] = useState(1_000_000), [vaultShare, setVaultShare] = useState(0.25);
  const [burnOn, setBurnOn] = useState<"yes" | "no">("yes");
  // team coin / pair: one fraction of the pool per settled game
  const [fraction, setFraction] = useState<number>(DEFAULT_SHARE.recurring);
  const [bt, setBt] = useState<Backtest | null>(null), [btB, setBtB] = useState<Backtest | null>(null), [btErr, setBtErr] = useState<string | null>(null), [btBusy, setBtBusy] = useState(false), [btFor, setBtFor] = useState("");
  // names
  const [name, setName] = useState(""), [ticker, setTicker] = useState(""), [description, setDescription] = useState(""), [imageUrl, setImageUrl] = useState(""), [link, setLink] = useState(""), [xUrl, setXUrl] = useState(""), [tg, setTg] = useState("");
  const [nameB, setNameB] = useState(""), [tickerB, setTickerB] = useState(""), [descB, setDescB] = useState(""), [imageB, setImageB] = useState("");
  // review / launch
  const [ackLocked, setAckLocked] = useState(false), [ackNoReturns, setAckNoReturns] = useState(false), [firstBuy, setFirstBuy] = useState("0");
  const [bundle, setBundle] = useState<Bundle | null>(null), [launchErr, setLaunchErr] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const [pairOut, setPairOut] = useState<{ pairId: string | null; a: Bundle; b: Bundle; notes: string[] } | null>(null);
  const [pcOut, setPcOut] = useState<{ pairId: string; pc: PairCurveLaunchBundle; keys: { a: string; b: string } | null; notes: string[] } | null>(null);
  // the dials (dials.ts): the rule as edited on the create screen, valid while the path's own rule is unchanged (key)
  const [draft, setDraft] = useState<{ key: string; a: BurnRule; b: BurnRule | null } | null>(null);
  // "Launch one like this": the source coin's dials, applied once to the rule the new pick builds
  const [pendingDials, setPendingDials] = useState<{ fraction: number; side: string | null; window: string | null; games: number | null; league: boolean; from: string; inverse?: boolean } | null>(null);
  // the auto-generated description (describe.ts): the flavour line is editable (null = the template's), the rule block never is
  const [flavour, setFlavour] = useState<string | null>(null), [flavourB, setFlavourB] = useState<string | null>(null);
  const [cardCtx, setCardCtx] = useState<{ key: string; ctx: Omit<DescribeCtx, "ticker"> } | null>(null), [cardYear, setCardYear] = useState<number | null>(null), [cardSet, setCardSet] = useState<{ id: string; outcome: string } | null>(null);
  const [nameAuto, setNameAuto] = useState(true), [tickerAuto, setTickerAuto] = useState(true);
  // owner, 2026-10-12 ("i halfway created token, named it 'Ea' and then abandoned it and tried to start another token, but the name was
  // locked on 'Ea'"): a typed name or ticker belongs to the thing it was typed for. editedFor records that subject; when the creator
  // picks a different team / market / feed / pair the fields go back to generated. Within one subject the typed value stays.
  const [editedFor, setEditedFor] = useState<string | null>(null);
  // ChatGPT launch-intent audit 2, item 3: the name and ticker the SOURCE suggests (an outcome's label, a card's ticker). A generated value
  // follows every source change; a value the creator typed is kept, and the review says so with a way back to the generated one.
  const [srcSuggest, setSrcSuggest] = useState<{ name: string | null; ticker: string | null }>({ name: null, ticker: null });
  const [ownImage, setOwnImage] = useState(false), [customImages, setCustomImages] = useState(false);
  // website-15 item 13: the creator's own image, description and links (ProfileFields.tsx); the image is never kept in the saved draft
  const [profile, setProfile] = useState<ProfileValue>(EMPTY_PROFILE);
  // website-18 (the owner: "I also don't see the ability to change the thumbnail pic"): side B of a Matchup has its own profile
  const [profileB, setProfileB] = useState<ProfileValue>(EMPTY_PROFILE);
  // the creator's note (≤ 140 chars): its own box on the coin page, never part of the description; linted on the server at launch
  const [note, setNote] = useState("");
  // website-14 (LAUNCHPAD-PATH §75): the graduation preset, 40 / 60 / 85 SOL, default 85; the server refuses anything else on mainnet
  const [raiseSol, setRaiseSol] = useState<RaisePreset>(DEFAULT_RAISE_SOL);
  const [cardWin, setCardWin] = useState<Record<string, number>>({});
  // an event card's outcome picker (polySearch.ts): which card is open and the picker's own filter text
  const [outPick, setOutPick] = useState<{ id: string; q: string } | null>(null);
  // launch audit 5 L02: per-type availability from the catalogue (launchAvailability.ts), explained before any form
  const [avail, setAvail] = useState<LaunchAvailabilityModel | null>(null);
  // website-12: the one launch-state record (launchAvailability.ts siteLaunchState): every open / closed / signing sentence on this page
  const [site, setSite] = useState<SiteLaunchState>(SITE_LAUNCH_STATE_LOADING);
  // A2: a pair path restored from storage or opened by a link while pairs are unavailable lands back on the first screen, said once
  const [pairNotice, setPairNotice] = useState<string | null>(null);
  // L03: the screen the review was entered from (Back returns there, with its query, category and scroll position)
  const [origin, setOrigin] = useState<Origin | null>(null);
  const restoreScroll = useRef<number | null>(null);
  // L01: a share moved onto the preset row, said out loud; L05: warnings carried from the source screen into the review
  const [shareNotice, setShareNotice] = useState<string | null>(null), [srcWarnings, setSrcWarnings] = useState<string[]>([]);
  // L06: the read-only review payload (POST /v1/launch/review) behind the pre-wallet summary
  // A6: the summary is keyed by the draft's revision (launchReviewSync.ts) — never shown beside another draft's card
  const [reviewSlot, setReviewSlot] = useState<ReviewSlot<LaunchReview>>(EMPTY_REVIEW_SLOT);
  // L06 / L12: the event as the source states it (the full question, its link, the outcome, when it resolves, the resolution rules)
  // website-20 item 53: `certified` names an election's certified result (the race card's cross-check), so the review says each source's job
  const [eventInfo, setEventInfo] = useState<{ question: string; url: string | null; outcome: string | null; resolves: string | null; criteria: string | null; stated?: StatedJson | null; certified?: string | null } | null>(null);
  // audit 6 item 7: why the last pattern tap could not apply
  const [patternNotice, setPatternNotice] = useState<string | null>(null);
  const [scheduleDetail, setScheduleDetail] = useState<string | null>(null), [leagueDetail, setLeagueDetail] = useState<string | null>(null), [drillErr, setDrillErr] = useState<string | null>(null);
  // website-19 THE GUIDED LAUNCH (guidedLaunch.ts): four questions, then the review. `follow` null is the free-text path (the search box,
  // a template's search, "launch one like this"), which goes straight to the review as before.
  const [guide, setGuide] = useState<{ follow: FollowId | null; phase: GuidedPhase; pairKind: "teams" | "candidates" | null }>({ follow: null, phase: "follow", pairKind: null });
  // a team's "once, if they win the title": the championship market found by the search (null until looked up)
  const [titleCard, setTitleCard] = useState<{ key: string; state: "loading" | "found" | "none"; card: Suggestion | null } | null>(null);
  // the fade side asked for while the rule it applies to is still being rebuilt (a Matchup switching from one game to the season)
  const [wantInverse, setWantInverse] = useState<"on" | "off" | null>(null);
  // owner, 2026-10-12: the page opens at the top; a saved draft is offered in one line, never jumped to
  const [savedDraft, setSavedDraft] = useState<Record<string, unknown> | null>(null);
  const [confirmOver, setConfirmOver] = useState(false), [classicOpen, setClassicOpen] = useState(false);
  // intent audit 5 item 11: a saved draft never keeps an image; the review says so once when the draft had one
  const [imageGone, setImageGone] = useState(false);
  // walkthrough snag 7: two candidates of one race, as two coins on their own markets
  const [elPick, setElPick] = useState<{ race: ElRace; a: ElOutcome; b: ElOutcome } | null>(null);
  // the owner's live walkthrough (2026-10-12): a rivalry pair of any two teams in a league, then one game or the season
  // website-20 item 60: the entry link's own words (a template, a derby pair), kept after the address drops its parameters
  const [entry, setEntry] = useState<{ template: string | null; a: string; b: string } | null>(null);
  // items 154 and 155: a retry for the schedule read, and the one line that explains a cleared team
  const [pendingTeam, setPendingTeam] = useState<string | null>(null);
  // item 253: the tickers the prepared plan was built for (the sign card's title and records), never the form's later edits
  const [signTickers, setSignTickers] = useState<{ a: string; b: string } | null>(null);
  const [gamesRetry, setGamesRetry] = useState(0), [rivalNote, setRivalNote] = useState<string | null>(null);
  const [rivalA, setRivalA] = useState<Team | null>(null), [rivalB, setRivalB] = useState<Team | null>(null), [rivalGame, setRivalGame] = useState<EventHit | null>(null), [rivalSeason, setRivalSeason] = useState<EventHit | null>(null);

  const pairOn = flow === "pair";
  const season = pairOn && pairMode !== "game";
  const sideA = game?.pair ? (swap ? game.pair.b : game.pair.a) : null, sideB = game?.pair ? (swap ? game.pair.a : game.pair.b) : null;

  // ---- state across a refresh (sessionStorage); `?pair=1` (the landing page's button) opens the pair flow --------------------------
  // `ready` is state, not a ref: the write effect must not run in the same commit as the restore (it would store the initial
  // values first, and React's development double-mount would then restore those).
  const [ready, setReady] = useState(false);
  /** A saved draft, applied only when the creator presses Resume (owner, 2026-10-12: the page never opens scrolled down a draft). */
  const restoreFrom = (s: Record<string, unknown>) => {
      const set = <T,>(k: string, f: (v: T) => void) => { if (s[k] !== undefined) f(s[k] as T); };
      set("flow", setFlow); set("step", (v: Step) => setStep(v === "launch" ? "review" : v)); set("leagueSeries", setLeagueSeries); set("team", setTeam); set("winLose", setWinLose);
      set("game", setGame); set("swap", setSwap); set("pairMode", setPairMode); set("pick", setPick); set("filter", setFilter); set("kind", setKind); /* launch-10: a stored "vault" mode is never restored (vault mode is hidden; hostedLaunch.ts) */
      set("onYes", setOnYes); set("onNoEnabled", setOnNoEnabled); set("onNo", setOnNo); set("unit", setUnit); set("perUnit", setPerUnit); set("baseline", setBaseline); set("direction", setDirection);
      set("tokensYes", setTokensYes); set("vaultShare", setVaultShare); set("burnOn", setBurnOn); set("fraction", setFraction);
      set("profileBadge", (v: boolean) => setProfile((x) => ({ ...x, badge: v !== false })));   // website-15: the receipt-mark choice is kept with the draft
      set("name", setName); set("ticker", setTicker); set("description", setDescription); set("imageUrl", setImageUrl); set("link", setLink); set("xUrl", setXUrl); set("tg", setTg); set("cat", setCat);
      set("nameB", setNameB); set("tickerB", setTickerB); set("descB", setDescB); set("imageB", setImageB); set("firstBuy", setFirstBuy); set("pasted", setPasted); set("q2", setQ2);
      set("guide", setGuide);
      // intent audit 5 items 11, 12 and 18: the profile's words and links, the raise (only a preset), the election pair and the rivalry teams
      set("raiseSol", (v: string) => { if (isRaisePreset(v)) setRaiseSol(v); });
      set("elPick", setElPick); set("rivalA", setRivalA); set("rivalB", setRivalB); set("rivalGame", setRivalGame); set("rivalSeason", setRivalSeason);
      type PT = { description?: string; x?: string; telegram?: string; website?: string; hadImage?: boolean };
      const words = (v: PT) => ({ description: String(v.description ?? ""), x: String(v.x ?? ""), telegram: String(v.telegram ?? ""), website: String(v.website ?? "") });
      set("profileText", (v: PT) => { setProfile((x) => ({ ...x, ...words(v) })); if (v.hadImage) setImageGone(true); });
      set("profileBText", (v: PT) => { setProfileB((x) => ({ ...x, ...words(v) })); if (v.hadImage) setImageGone(true); });
      set("uq", setUq); set("origin", setOrigin); set("editedFor", setEditedFor); set("eventInfo", setEventInfo); set("srcWarnings", setSrcWarnings); set("bq", setBq); set("wx", setWx); set("draft", setDraft); set("flavour", setFlavour); set("flavourB", setFlavourB); set("cardCtx", setCardCtx); set("cardYear", setCardYear); set("cardSet", setCardSet); set("nameAuto", setNameAuto); set("tickerAuto", setTickerAuto); set("ownImage", setOwnImage); set("note", setNote);
  };
  useEffect(() => {
    let s: Record<string, unknown> | null = null;
    try { s = JSON.parse(sessionStorage.getItem(STORE) ?? "null"); } catch { s = null; }
    const q0 = new URLSearchParams(window.location.search);
    const wantPair = q0.get("pair") === "1";
    // snag 6: a link that names what to open (a derby pair, a template, a Matchup, "launch one like this") never reopens a saved draft
    const linked = wantPair || q0.get("derby") === "1" || !!q0.get("template") || !!q0.get("like") || !!q0.get("league");
    if (linked) { try { sessionStorage.removeItem(STORE); } catch { /* ignore */ } }
    else if (s && (s.step !== "choose" || (s.guide as { phase?: string } | undefined)?.phase !== "follow")) setSavedDraft(s);
    if (wantPair) { setFlow("pair"); setStep("pick"); setGuide({ follow: "rivalry", phase: "which", pairKind: "teams" }); }
    // website-20 item 119: a league page's team link opens step 2 of the team path on that league, with that team picked once its list loads
    if (q0.get("league")) { setGuide({ follow: "team", phase: "which", pairKind: null }); setFlow("team"); setStep("team"); setLeagueSeries(q0.get("league")); setPendingTeam(q0.get("team")); }
    if (q0.get("derby") === "1") { setGuide({ follow: "coins", phase: "which", pairKind: null }); setEntry({ template: null, a: q0.get("a") ?? "", b: q0.get("b") ?? "" }); }
    const u = new URLSearchParams(window.location.search);
    const tpl = u.get("template") as TemplateId | null, like = u.get("like");
    if (tpl && TEMPLATE_START[tpl]) {
      // "Start from this" (the templates gallery): the shape's own entry point; Coin vs Coin opens its tile (CoinVsCoinTile reads the same param)
      try { sessionStorage.removeItem(STORE); } catch { /* ignore */ }
      const st = TEMPLATE_START[tpl];
      if (st.draft === "weather") {
        // L10: the weather template opens the review card with exactly the draft its example names (Detroit, 90 °F, the default share)
        const d = weatherTemplateDraft();
        applyRule(d.rule, { oracle: "catalogue", series: d.rule.series, market: null, title: d.title }, { name: d.name, ticker: d.ticker, settlement: d.settlement, source: weatherSource("high") });
        setOrigin({ kind: "template", flow: "team", step: "choose", uq: "", q2: "", cat: "science", bq: "", leagueSeries: null, scrollY: 0 });
        setGuide({ follow: "number", phase: "which", pairKind: null });
      }
      else if (st.flow) { setFlow(st.flow); setStep(ORDER[st.flow][0]); setGuide({ follow: st.flow === "team" ? "team" : st.flow === "pair" ? "rivalry" : "market", phase: "which", pairKind: st.flow === "pair" ? "teams" : null }); }
      else if (st.browse) { setFlow("browse"); setStep("pick"); setCat(st.browse); setGuide({ follow: tpl === "election-pair" ? "rivalry" : "market", phase: "which", pairKind: tpl === "election-pair" ? "candidates" : null }); }
      else if (st.derby) { setGuide({ follow: "coins", phase: "which", pairKind: null }); setEntry({ template: tpl, a: "", b: "" }); }
      else { setFlow("team"); setStep("choose"); if (st.search) { setUq(st.search); setClassicOpen(true); } }
    } else if (like) {
      // "Launch one like this" (a coin or pair page): the same rule shape, the team / race / feed re-pickable, the dials copied
      try { sessionStorage.removeItem(STORE); } catch { /* ignore */ }
      fetch(`/api/burnticker/tokens/${encodeURIComponent(like)}`).then((r) => (r.ok ? r.json() : null)).then((j: { status?: { seriesTitle?: string | null; pair?: unknown }; rulesText?: string } | null) => {
        if (!j?.rulesText) return;
        let r: BurnRule; try { r = JSON.parse(j.rulesText) as BurnRule; } catch { return; }
        const d = dialsFor(r, { nowMs: Date.now() });
        const e = r.oracle === "catalogue" && r.series ? parseEspnSeries(r.series) : null;
        const n = r.oracle === "catalogue" && r.series ? parseNwsSeries(r.series) : null;
        setPendingDials({ fraction: d.fraction, side: d.side?.value ?? null, window: d.window?.value ?? null, games: d.window?.games ?? null, league: !!d.league?.on, from: like.toUpperCase(), inverse: !!d.inverse?.on });
        if (e?.kind === "team") { setFlow("team"); setStep("team"); setLeagueSeries(e.league); }
        else if (e?.kind === "game") { setFlow("pair"); setStep("pick"); setLeagueSeries(e.league); }
        else if (n) { setFlow("browse"); setStep("pick"); setCat("science"); setWx({ metric: n.metric, station: n.station, threshold: String(n.threshold ?? "") }); }
        else if (r.oracle === "derby") { window.location.href = "/burnticker/launch?template=coin-vs-coin"; }
        else if (r.oracle === "polymarket") { setFlow("single"); setStep("pick"); }
        else { setFlow("team"); setStep("choose"); setUq(j.status?.seriesTitle ?? ""); }
      }).catch(() => { /* the plain launch page */ });
    }
    // intent audit 5 item 17: the entry parameters are read once and then dropped from the address, so a reload keeps the draft (and
    // offers Resume) instead of starting the link over
    if (linked) { try { window.history.replaceState(window.history.state, "", window.location.pathname); } catch { /* ignore */ } }
    setReady(true);
  }, []);
  const snapshot = JSON.stringify({ guide, raiseSol, elPick, rivalA, rivalB, rivalGame, rivalSeason, profileText: { description: profile.description, x: profile.x, telegram: profile.telegram, website: profile.website, hadImage: !!profile.image }, profileBText: { description: profileB.description, x: profileB.x, telegram: profileB.telegram, website: profileB.website, hadImage: !!profileB.image }, profileBadge: profile.badge, eventInfo, uq, origin, srcWarnings, bq, wx, flow, step, leagueSeries, team, winLose, game, swap, pairMode, pick, filter, kind, mode, onYes, onNoEnabled, onNo, unit, perUnit, baseline, direction, tokensYes, vaultShare, burnOn, fraction, name, ticker, description, imageUrl, link, xUrl, tg, cat, nameB, tickerB, descB, imageB, firstBuy, pasted, q2, draft, flavour, flavourB, cardCtx, cardYear, cardSet, nameAuto, tickerAuto, editedFor, ownImage, note });
  // nothing is stored until something is chosen, so an untouched first screen never replaces a saved draft
  useEffect(() => { if (ready && (step !== "choose" || guide.phase !== "follow")) { try { sessionStorage.setItem(STORE, snapshot); } catch { /* private mode: no memory, no harm */ } } }, [ready, snapshot]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const y = restoreScroll.current; restoreScroll.current = null; window.scrollTo({ top: y ?? 0 });
    // audit 6 item 4 (pass D item 40): the new step's heading takes focus, without scrolling past the top
    if (y === null) { const h = document.querySelector<HTMLElement>("[data-step-heading]"); h?.focus({ preventScroll: true }); }
  }, [step, guide.phase, guide.pairKind]);
  // audit 6 item 13: the step lives in the address (?step=…), so the browser's Back and Forward move between steps; the draft keeps the
  // picks (sessionStorage) and a reload offers Resume
  const urlStep = !guide.follow ? "follow" : guide.phase;
  useEffect(() => {
    if (!ready || step === "launch") return;
    const cur = new URLSearchParams(window.location.search).get("step") ?? "follow";
    if (cur === urlStep) return;
    try { window.history.pushState({ btStep: urlStep }, "", urlStep === "follow" ? window.location.pathname : `${window.location.pathname}?step=${urlStep}`); } catch { /* ignore */ }
  }, [urlStep, ready]);   // eslint-disable-line react-hooks/exhaustive-deps

  // owner, 2026-10-12: Start over at every step clears the draft and the stored choices and lands on question 1; it asks once only when a
  // name, a ticker or an image of the creator's own would be lost
  // website-20 pass A item 10: once anything is chosen, Start over asks first (it is the secondary action beside Back)
  const needsConfirm = !!guide.follow || step !== "choose" || (!nameAuto && !!name.trim()) || (!tickerAuto && !!ticker.trim()) || !!profile.image || !!profileB.image;
  const startOver = (force = false) => { if (!force && needsConfirm) { setConfirmOver(true); return; } try { sessionStorage.removeItem(STORE); sessionStorage.removeItem(CVC_STORE); } catch { /* ignore */ } try { window.history.replaceState(null, "", window.location.pathname); } catch { /* ignore */ } window.scrollTo({ top: 0 }); onReset(); };
  // owner, 2026-10-12: "Launch a coin" again while on this page shows step 1, with the draft kept and offered (launchStart.ts)
  useEffect(() => {
    const h = () => {
      let s: Record<string, unknown> | null = null;
      try { s = JSON.parse(sessionStorage.getItem(STORE) ?? "null"); } catch { s = null; }
      if (s && (s.step !== "choose" || (s.guide as { phase?: string } | undefined)?.phase !== "follow")) setSavedDraft(s);
      setGuide({ follow: null, phase: "follow", pairKind: null }); setStep("choose"); setConfirmOver(false); setClassicOpen(false); setOrigin(null);
      window.scrollTo({ top: 0 });
    };
    window.addEventListener(LAUNCH_START_EVENT, h);
    return () => window.removeEventListener(LAUNCH_START_EVENT, h);
  }, []);
  const resumeDraft = () => { if (savedDraft) restoreFrom(savedDraft); setSavedDraft(null); window.scrollTo({ top: 0 }); };

  // site audit #18: the one shared catalogue read (catalogueClient.ts) — the header's availability uses the same promise
  useEffect(() => { loadCatalogue().then((raw) => { const j = raw as { sources?: Source[]; cluster?: string; venues?: typeof venues; customImages?: boolean }; setSources(j.sources ?? []); setCluster(j.cluster ?? null); if (j.venues) { setVenues(j.venues); setPairVenue(venueFor(j.venues)); } setCustomImages(j.customImages === true); setAvail(availabilityFromCatalogue(j)); const st = siteLaunchStateFromCatalogue(j); setSite(st); setGate(st.read === "stale" ? { kind: "unavailable", detail: st.sentence } : launchGateFromCatalogue(j)); }).catch((e) => { const why = String((e as Error).message ?? e); setSite(siteLaunchStateFromCatalogue(null, { failure: why })); setGate(launchGateFromCatalogue(null, why)); }); }, []);
  // A2: no pair path while pairs are unavailable — a restored session, ?pair=1, the matchup template or "launch one like this" on a game
  useEffect(() => { if (site.read === "ready" && !site.pairs.available && flow === "pair" && step !== "choose") { setFlow("team"); setStep("choose"); setGame(null); setPairNotice(site.pairs.line); } }, [site, flow, step]);
  const curCat = cats.find((c) => c.id === cat);
  useEffect(() => { if (flow === "browse" && curCat?.guided === "elections" && !etypes.length && venues.polymarket) getJson<{ types: { id: string; label: string; races: number }[] }>(`${V1}/elections`).then((j) => setEtypes(j.types)).catch((e) => { setEtypes([]); setEtypesErr(`The races could not be read just now (${detailOf(e)}).`); }); }, [flow, curCat?.guided, etypes.length, venues.polymarket]);
  // intent audit 5 item 16: each picker below applies an answer only while its question is still the current one (`live`, cleared by the
  // effect's cleanup when the league, query, race type or state changes), and clears the old answer as soon as the question changes
  useEffect(() => { if (!etype) return; let live = true; setEbusy(true); setEraces(null); setEpair(null); setEsel([]); getJson<{ states: { abbr: string; name: string; races: number }[]; races: ElRace[] }>(`${V1}/elections?type=${etype}${estate ? `&state=${estate}` : ""}`).then((j) => { if (!live) return; setEstates(j.states); setEraces(etype === "control" || estate ? j.races : null); }).catch(() => { if (live) setEraces([]); }).finally(() => { if (live) setEbusy(false); }); return () => { live = false; }; }, [etype, estate]);
  useEffect(() => { if (esel.length !== 2 || !eraces?.[0]) { setEpair(null); return; } const race = eraces.find((r) => esel.every((c) => r.outcomes.some((o) => o.conditionId === c))); if (!race) return; let live = true; getJson<ElPair>(`${V1}/elections/pair?slug=${race.slug}&a=${esel[0]}&b=${esel[1]}`).then((j) => { if (live) setEpair(j); }).catch(() => { if (live) setEpair(null); }); return () => { live = false; }; }, [esel, eraces]);
  // the search box: 300 ms after the last keystroke, only for 3+ characters with at least one meaningful token, and only the response
  // to the LATEST query is shown (a sequence id discards a slow answer to an earlier keystroke); old results clear as soon as you type
  const useq = useRef(0);
  // time-to-launch (productStore.ts): the page's own step timestamps, sent with the launch bundle request only
  const stepTimes = useRef<Record<string, number>>({});
  const mark = (k: "search" | "card" | "create" | "review" | "launch") => { if (!stepTimes.current[k] || k === "launch" || k === "review") stepTimes.current[k] = Date.now(); };
  useEffect(() => { if (uq.trim()) mark("search"); }, [uq]);
  useEffect(() => { if (step === "review") { mark("create"); mark("review"); } }, [step]);
  // launch telemetry for the owner's before/after (productStore.ts): screens shown and decisions made from landing to Launch
  const flowStats = useRef({ screens: 1, decisions: 0, what: false, edited: false });
  const firstStep = useRef(true);
  useEffect(() => {
    if (firstStep.current) { firstStep.current = false; return; }
    flowStats.current.screens++;
    if (step === "review" && !flowStats.current.what) { flowStats.current.what = true; flowStats.current.decisions++; }
  }, [step]);
  const noteEdit = () => { if (!flowStats.current.edited) { flowStats.current.edited = true; flowStats.current.decisions++; } };
  // search-miss telemetry: results with cards but no "Use this" before the next query or leaving the page (anonymous; productStore.ts)
  const lastShown = useRef<{ q: string; cards: number; clicked: boolean; reported: boolean } | null>(null);
  const reportNoClick = useCallback(() => {
    const l = lastShown.current;
    if (!l || l.clicked || l.reported || l.cards < 1) return;
    l.reported = true;
    try { void fetch(`${V1}/search/miss`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: l.q, cards: l.cards }), keepalive: true }); } catch { /* telemetry never breaks the page */ }
  }, []);
  useEffect(() => { const h = () => reportNoClick(); window.addEventListener("pagehide", h); return () => window.removeEventListener("pagehide", h); }, [reportNoClick]);
  const shortQuery = uq.trim().length > 0 && (uq.trim().length < 3 || !meaningful(queryTokens(uq)).length);
  useEffect(() => {
    const qv = uq.trim(), seq = ++useq.current;
    setUres(null);
    if (qv.length < 3 || !meaningful(queryTokens(qv)).length) { setUbusy(false); return; }
    setUbusy(true);
    const t = setTimeout(() => {
      getJson<{ cards: Suggestion[]; empty: boolean; categories: { id: string; label: string; blurb: string }[]; hiddenClosingSoon?: number }>(`${V1}/search?q=${encodeURIComponent(qv)}${closingSoon ? "&closingSoon=1" : ""}`)
        .then((j) => { if (seq === useq.current) { reportNoClick(); lastShown.current = { q: qv, cards: j.cards.filter((c) => c.rule || c.matchup).length, clicked: false, reported: false }; setUres(j); } })
        .catch(() => { if (seq === useq.current) setUres({ cards: [], empty: true, categories: [] }); })
        .finally(() => { if (seq === useq.current) setUbusy(false); });
    }, 300);
    return () => clearTimeout(t);
  }, [uq, closingSoon]);
  // browse: the categories once, then one category's cards (debounced text filter)
  useEffect(() => { if (flow === "browse" && !cats.length) getJson<{ categories: BrowseCategory[] }>(`${V1}/browse`).then((j) => setCats(j.categories)).catch((e) => setBrowseErr([String((e as Error).message)])); }, [flow, cats.length]);
  // L11: the previous category's cards are cleared the moment the category changes, and only the answer to the LATEST request is shown
  const browseSeq = useRef(0), browseCat = useRef<string | null>(null);
  useEffect(() => {
    if (flow !== "browse" || step !== "pick") return;
    const seq = ++browseSeq.current;
    if (browseCat.current !== cat) { browseCat.current = cat; setCards(null); setBrowseErr([]); setDrill(null); setWx(null); }
    setCardsBusy(true);
    const t = setTimeout(() => { getJson<{ cards: SourceCardT[]; errors: string[] }>(`${V1}/browse?category=${encodeURIComponent(cat)}${bq.trim() ? `&q=${encodeURIComponent(bq.trim())}` : ""}`).then((j) => { if (seq !== browseSeq.current) return; setCards(j.cards); setBrowseErr(j.errors ?? []); }).catch((e) => { if (seq !== browseSeq.current) return; setCards([]); setBrowseErr([`${(e as Error).message} (${detailOf(e)})`]); }).finally(() => { if (seq === browseSeq.current) setCardsBusy(false); }); }, bq ? 350 : 0);
    return () => clearTimeout(t);
  }, [flow, step, cat, bq]);
  // L11: nested loading always ends: events, "none open", or the error (a request that hangs is cut after 15 seconds)
  useEffect(() => { if (!drill) { setDrillEvents(null); setDrillErr(null); return; } let live = true; setDrillErr(null); setDrillEvents(null); getJson<{ events: EventHit[] }>(`${V1}/kalshi/events?series=${encodeURIComponent(drill)}`, { signal: AbortSignal.timeout(15_000) }).then((j) => { if (live) setDrillEvents(j.events.slice(0, 12)); }).catch((e) => { if (live) { setDrillEvents([]); setDrillErr(`The events could not be read just now (${detailOf(e)}).`); } }); return () => { live = false; }; }, [drill]);
  useEffect(() => { if (!q.trim()) { setHits([]); return; } const t = setTimeout(() => { fetch(`/api/burnticker/oracle/search?q=${encodeURIComponent(q.trim())}`).then((r) => r.json()).then((j) => setHits(j.results ?? [])).catch(() => setHits([])); }, 350); return () => clearTimeout(t); }, [q]);
  // leagues for the team / pair pickers
  // Team coins and matchups: schedules from the leagues' own feeds or TheSportsDB; each game settled by two independent operators (gameSettle.ts).
  useEffect(() => { if ((flow === "team" || flow === "pair") && !leagues.length) getJson<{ leagues: { id: string; label: string; sport: string; crossRead: string | null; draws: boolean }[] }>(`${V1}/sports/teams`).then((j) => setLeagues((j.leagues ?? []).map((l) => ({ id: l.id, label: l.label, sport: l.sport, crossRead: l.crossRead, draws: l.draws, series: [{ ticker: l.id, title: l.label }] })))).catch((e) => { setLeagueErr(String((e as Error).message)); setLeagueDetail(detailOf(e)); }); }, [flow, leagues.length]);
  useEffect(() => {
    if ((flow !== "team" && !(flow === "pair" && guide.follow === "rivalry")) || !leagueSeries) return; setTeamsBusy(true); setTeams([]);
    let live = true;
    getJson<{ teams: SportsTeam[]; scheduleNote?: string | null; scheduleDetail?: string | null }>(`${V1}/sports/teams?league=${leagueSeries}`).then((j) => { if (!live) throw new Error("stale"); return j; }).then((j) => (setScheduleNote(j.scheduleNote ?? null), setScheduleDetail(j.scheduleDetail ?? null), j)).then((j) => setTeams(j.teams.map((t) => ({ abbr: t.abbr, city: t.city, nickname: t.nickname, name: t.name, ticker: t.ticker, league: t.league, filter: t.series.win, collisions: [], series: t.series, recordText: t.record ?? null, record: recordOf(t.record), seasonWarning: t.season?.status === "over" || t.season?.status === "none-listed" ? t.season.warning : null,
      next: t.next ? { eventTicker: t.next.eventId, marketTicker: t.next.eventId, title: t.next.title, expectedAt: t.next.startsAt, opponent: t.next.opponent } : null })))).catch(() => { if (live) setTeams([]); }).finally(() => { if (live) setTeamsBusy(false); });
    return () => { live = false; };
  }, [flow, leagueSeries, guide.follow]);
  useEffect(() => {
    if (flow !== "pair" || !leagueSeries) return;
    const url = `${V1}/sports/games?league=${leagueSeries}${gameQ.trim() ? `&q=${encodeURIComponent(gameQ.trim())}` : ""}`;
    setGamesBusy(true); setGames([]);
    let live = true;
    const side = (x: SportsSide, series: string): Side => ({ abbr: x.abbr, marketTicker: series, label: x.name, nickname: x.nickname, name: x.name, ticker: x.ticker });
    const t = setTimeout(() => { getJson<{ games: SportsGame[]; scheduleNote?: string | null; scheduleDetail?: string | null }>(url).then((j) => { if (!live) throw new Error("stale"); return j; }).then((j) => (setScheduleNote(j.scheduleNote ?? null), setScheduleDetail(j.scheduleDetail ?? null), j)).then((j) => setGames(j.games.map((g) => ({ eventTicker: g.eventId, seriesTicker: g.league, title: g.title, subTitle: g.detail, category: "Sports", expectedAt: g.startsAt, closeTime: null, markets: [], matchedSides: [], pair: { a: side(g.a, g.series.aLoss), b: side(g.b, g.series.bLoss), tieMarket: null }, refused: [] })))).catch((e) => { if (!live) return; setGames([]); setScheduleNote(NEXT_GAME_UNAVAILABLE); setScheduleDetail(detailOf(e)); console.error("[burnticker/launch] the games could not be read:", e); }).finally(() => { if (live) setGamesBusy(false); }); }, gameQ ? 300 : 0);
    return () => { live = false; clearTimeout(t); };
  }, [flow, leagueSeries, gameQ, gamesRetry]);
  // item 151: a league change re-checks the picks against it: a team, the two rivals and their games from another league are cleared
  useEffect(() => {
    if (!ready) return;
    const other = (t: Team | null) => !!t && !!t.league && !!leagueSeries && t.league !== leagueSeries;
    if (other(rivalA) || other(rivalB)) { setRivalA(null); setRivalB(null); setRivalGame(null); setRivalSeason(null); setRivalNote(null); }
  }, [leagueSeries, ready]);   // eslint-disable-line react-hooks/exhaustive-deps
  // any-market search
  useEffect(() => {
    if (flow !== "single" || q2.trim().length < 2) { setFound(null); setPolyFound(null); return; }
    setFindBusy(true); setFound(null); setPolyFound(null);
    let live = true;
    const t = setTimeout(() => {
      const qs = encodeURIComponent(q2.trim());
      // Both venues at once; either may fail without hiding the other.
      const kalshi = !venues.kalshi ? Promise.resolve(setFound({ results: [], events: [], ranking: "series" })) : getJson<{ results: Series[]; events: EventHit[]; ranking: "events" | "series" }>(`${V1}/kalshi/search?q=${qs}`).then((j) => { if (live) setFound({ results: j.results ?? [], events: j.events ?? [], ranking: j.ranking ?? "series" }); }).catch(() => { if (live) setFound({ results: [], events: [], ranking: "series" }); });
      const poly = !venues.polymarket ? Promise.resolve(setPolyFound({ events: [], tags: [], markets: [] })) : getJson<PolyFound>(`${V1}/polymarket/search?q=${qs}`).then((j) => { if (!live) return; setPolyFound({ events: j.events ?? [], tags: j.tags ?? [], markets: j.markets ?? [] }); setPolyErr(null); }).catch((e) => { if (!live) return; setPolyFound({ events: [], tags: [], markets: [] }); setPolyErr(String((e as Error).message)); });
      void Promise.allSettled([kalshi, poly]).then(() => { if (live) setFindBusy(false); });
    }, 400);
    return () => { live = false; clearTimeout(t); };
  }, [flow, q2, venues.kalshi, venues.polymarket]);

  // ---- the rules ------------------------------------------------------------------------------------------------------------------
  // L01: the one typed path (launchDraft.ts) — the same pure functions the tests walk from every card to the locked rule
  const genericRule: BurnRule | null = useMemo(() => composeRule(pick, { kind, mode, onYes, onNoEnabled, onNo, burnOn, unit, perUnit, baseline, direction, tokensYes, vaultShare, filter, polyPreset }), [pick, filter, polyPreset, kind, mode, onYes, onNoEnabled, onNo, unit, perUnit, baseline, direction, tokensYes, vaultShare, burnOn]);

  /** Matchups: two coins, one per team — "this game only" = each side burns if its team loses that game; "every game" = each side's team-loss coin. */
  const pairRules = useMemo(() => {
    // walkthrough snag 7: two candidates, each coin on its own outcome's market, once, at the one-shot default
    if (pairOn && elPick) return { a: applyDial(elPick.a.rule, "fraction", DEFAULT_SHARE.oneShot), b: applyDial(elPick.b.rule, "fraction", DEFAULT_SHARE.oneShot) };
    if (!pairOn || !game || !sideA || !sideB || !leagueSeries) return null;
    // a game pair is that game (one-shot: 10 % default); a season pair is this season or perpetual (recurring: 2 % default)
    if (pairMode === "game") return { a: firstPartyRule(sideA.marketTicker, DEFAULT_SHARE.recurring), b: firstPartyRule(sideB.marketTicker, DEFAULT_SHARE.recurring) };
    const lg = leagueSeries as LeagueId;
    const w: TeamWindow = pairMode === "season" ? { kind: "season", year: cardYear ?? seasonYearAt(lg, Date.now()) } : { kind: "perpetual" };
    try { return w.kind === "season" ? seasonPairRules(lg, sideA.abbr, sideB.abbr, w.year) : { a: firstPartyRule(teamSeries(lg, sideA.abbr, "loss", w), 0.02), b: firstPartyRule(teamSeries(lg, sideB.abbr, "loss", w), 0.02) }; } catch { return null; }
  }, [pairOn, game, sideA, sideB, pairMode, leagueSeries, cardYear, elPick]);
  const baseRule: BurnRule | null = useMemo(() => {
    // a team coin: this season by default (the picker's selector), 2 % per game; the side, the window and the share are dials
    // website-18: with the end clause every launch gets (dials.ts ON_END_DEFAULT = rules.ts DEFAULT_ON_END), so the review card says the
    // end the coin really has: a wins coin in MLB, the NBA or the NHL takes the champion path (describe.ts championPathRule)
    if (flow === "team") return team?.series ? { ...firstPartyRule(winLose === "win" ? team.series.win : team.series.loss, 0.02), onEnd: { ...ON_END_DEFAULT } } as BurnRule : null;
    if (flow === "pair") return pairRules?.a ?? null;
    return genericRule;
  }, [flow, team, winLose, pairRules, genericRule]);
  const baseRuleB: BurnRule | null = useMemo(() => (pairRules ? pairRules.b : null), [pairRules]);
  const baseKey = JSON.stringify([baseRule, baseRuleB]);
  const rule: BurnRule | null = draft && draft.key === baseKey ? draft.a : baseRule;
  const ruleB: BurnRule | null = draft && draft.key === baseKey ? draft.b : baseRuleB;
  const dialCtx = { nowMs: Date.now(), seasonYear: cardYear ?? (leagueSeries ? seasonYearAt(leagueSeries as LeagueId, Date.now()) : null), set: cardSet };
  useEffect(() => {
    if (!pendingDials || step !== "review" || !baseRule) return;
    const apply = (r0: BurnRule, withSide: boolean) => {
      let r = r0;
      const d0 = dialsFor(r, dialCtx);
      if (withSide && pendingDials.side && d0.side?.options.some((o) => o.value === pendingDials.side)) r = applyDial(r, "side", pendingDials.side, dialCtx);
      if (pendingDials.window && dialsFor(r, dialCtx).window) { r = applyDial(r, "window", pendingDials.window, dialCtx); if (pendingDials.games) r = applyDial(r, "games", pendingDials.games, dialCtx); }
      // intent audit items 1 and 2 (WIRING-INTENT.md): a card's fade side ("Detroit high below 32") survives the rebuild into the review
      if (pendingDials.inverse && dialsFor(r, dialCtx).inverse) r = applyDial(r, "inverse", "on", dialCtx);
      // the copied share moves to the nearest preset (the web UI offers presets; league mode is API-only) — and the page SAYS so (L01)
      const shape = dialsFor(r, dialCtx).bounds.max >= 1 ? "oneShot" : "recurring";
      const sn = snapToPreset(pendingDials.fraction, shape);
      if (sn.changed && withSide) setShareNotice(`$${pendingDials.from} burns ${presetPct(pendingDials.fraction)} each time. The web launcher offers ${presetRowLabel(shape)}, so ${presetPct(sn.value)} is selected. Use the API to launch with ${presetPct(pendingDials.fraction)}.`);
      r = applyDial(r, "fraction", sn.value, dialCtx);
      return r;
    };
    setDraft({ key: baseKey, a: apply(baseRule, true), b: baseRuleB ? apply(baseRuleB, false) : null });
    setPendingDials(null);
  }, [pendingDials, step, baseRule, baseRuleB, baseKey]);   // eslint-disable-line react-hooks/exhaustive-deps
  /** One dial → the edited rule (both sides of a pair share the share and the window; the side stays each coin's own). */
  const lastShare = useRef<{ recurring?: number; oneShot?: number }>({});
  const setShare = (v: number) => { flowStats.current.decisions++; lastShare.current[oneShotRule ? "oneShot" : "recurring"] = v; setDial("fraction", v); };
  const setDial = (id: DialId, v: string | number) => {
    if (!rule) return;
    setDraft({ key: baseKey, a: applyDial(rule, id, v, dialCtx), b: ruleB ? (id === "side" ? ruleB : applyDial(ruleB, id, v, dialCtx)) : null });
  };
  // THE PRESET ROW (the owner's cut, 2026-10-10): recurring 2 / 5 / 10 %, one-shot 10 / 50 / 100 %, the default already chosen. A share
  // that is not a preset (a copied coin, an older default) snaps to the nearest one once per rule. Any other share is API-only.
  const curDials = rule ? dialsFor(rule, dialCtx) : null;
  const oneShotRule = !!curDials && curDials.bounds.max >= 1;
  const shareOptions = oneShotRule ? SHARE_PRESETS.oneShot : SHARE_PRESETS.recurring;
  const shareValue = curDials ? curDials.fraction : shareOptions[0];
  const snapped = useRef("");
  useEffect(() => {
    if (step !== "review" || !rule || !curDials || pendingDials) return;
    if (shareOptions.some((x) => Math.abs(x - curDials.fraction) < 1e-9) || snapped.current === baseKey) return;
    snapped.current = baseKey;
    // L01: never a silent swap — the notice names the share the rule came with and the preset now selected
    const sn = oneShotRule ? { value: DEFAULT_SHARE.oneShot, changed: true } : snapToPreset(curDials.fraction, "recurring");
    setShareNotice(`This rule came with ${presetPct(curDials.fraction)} per burn. The web launcher offers ${presetRowLabel(oneShotRule ? "oneShot" : "recurring")}, so ${presetPct(sn.value)} is selected. Pick another preset below, or use the API to launch with ${presetPct(curDials.fraction)}.`);
    setDial("fraction", sn.value);
  }, [step, baseKey, curDials?.fraction, pendingDials]);   // eslint-disable-line react-hooks/exhaustive-deps
  // audit 7 item 5: after a mode switch (2 % every win, then Once, then back), the share chosen for that shape comes back, said inline
  useEffect(() => {
    if (step !== "review" || !rule || !curDials || pendingDials) return;
    const want = lastShare.current[oneShotRule ? "oneShot" : "recurring"];
    if (want === undefined || Math.abs(want - curDials.fraction) < 1e-9 || !shareOptions.some((x) => Math.abs(x - want) < 1e-9)) return;
    setDial("fraction", want);
    setShareNotice(`Your earlier choice for this kind of burn, ${presetPct(want)}, is selected again.`);
  }, [baseKey, oneShotRule]);   // eslint-disable-line react-hooks/exhaustive-deps
  // the coin text (describe.ts), re-rendered from the rule as it is now
  const aHome = !!swap;
  const textCtx = useMemo((): Omit<DescribeCtx, "ticker"> => {
    if (!rule) return {};
    if (cardCtx && cardCtx.key === (rule.market ?? rule.series ?? "")) return cardCtx.ctx;
    if (pairOn && elPick) return { eventPhrase: elPick.a.question.replace(/^will\s+/i, "").replace(/\?$/, "") };
    if (pairOn && pairMode === "game" && game && sideB) return { game: { opponent: sideB.nickname ?? sideB.name, home: aHome, startsAt: game.expectedAt ?? "" } };
    if (pick?.oracle === "polymarket") return { eventPhrase: pick.title.replace(/\s*\(resolves once\)$/, "").replace(/\?$/, "").replace(/^will\s+/i, ""), endsAt: null, ...(pick.market && eventInfo?.stated ? { stated: eventInfo.stated } : {}) };
    if (pick?.oracle === "catalogue" && pick.source?.unit && !/^(espn|nws|fec)\./.test(pick.series ?? "")) return { feed: { title: pick.title, sourceName: pick.source.sourceName, unitLabel: pick.source.unit.label } };
    return {};
  }, [rule, cardCtx, pairOn, pairMode, game, sideB, aHome, pick, eventInfo, elPick]);
  const text: CoinText | null = useMemo(() => { if (!rule) return null; try { return describeRule(rule, { ticker, ...textCtx }); } catch { return null; } }, [rule, ticker, textCtx]);
  const ctxB = useMemo((): Omit<DescribeCtx, "ticker"> => (elPick ? { eventPhrase: elPick.b.question.replace(/^will\s+/i, "").replace(/\?$/, "") } : pairMode === "game" && game && sideA ? { game: { opponent: sideA.nickname ?? sideA.name, home: !aHome, startsAt: game.expectedAt ?? "" } } : {}), [elPick, pairMode, game, sideA, aHome]);
  const textB: CoinText | null = useMemo(() => { if (!ruleB) return null; try { return describeRule(ruleB, { ticker: tickerB, ...ctxB }); } catch { return null; } }, [ruleB, tickerB, ctxB]);
  const compose = (t: CoinText | null, _fl: string | null, fallback: string) => (t ? t.paragraph.slice(0, DESCRIPTION_MAX) : fallback);
  // a quick local read of the note (the server's lint is the one that counts: copy-lint.json, incl. no-affiliation)
  const noteProblem = /https?:\/\/|www\.|\.(com|io|xyz|fun)\b/i.test(note) ? "no links in the note" : /\b(official|endorsed|partner(ed|ship)?|affiliated|backed|guaranteed|insured|audited|verified|licensed|sponsored)\b/i.test(note) ? "no claims of affiliation or endorsement" : null;
  const finalDescription = compose(text, flavour, description), finalDescriptionB = compose(textB, flavourB, descB);
  // the suggested name and ticker follow the rule (a window change re-suggests: $RAYS26 → $RAYS) until the creator types their own
  // website-19 (owner, 2026-10-12: "two teamwifs"): a team coin's ticker is the team code plus its window ($LAD, $LADWS, $LADNEXT5), a
  // pair's is the matchup ($LADVMIL and $MILVLAD); generated by default, re-suggested while the creator has not typed their own
  const genTicker = useMemo((): string | null => {
    if (!rule) return null;
    if (flow === "team" && team) return teamTickerForRule(rule, team.abbr);
    if (flow === "single" && guide.follow === "team" && team) return teamTicker(team.abbr, { league: leagueSeries, window: "title" });
    if (flow === "pair" && sideA && sideB) return pairTickers(sideA.abbr, sideB.abbr).a;
    // walkthrough snag 13: the debt coin has one ticker from every path ($DEBT itself is reserved for the flagship's rule)
    if (rule.oracle === "catalogue" && rule.series === "treasury.debt") return rule.inverse ? "FLATDEBT" : "DEBTUP";
    return null;
  }, [rule, flow, team, guide.follow, leagueSeries, sideA, sideB]);
  // the subject a typed name belongs to: the flow and the thing picked (never the name itself, never the share or the end)
  const subjectKey = [flow, guide.follow ?? "", rule?.oracle ?? "", rule?.market ?? rule?.series ?? "", team?.abbr ?? "", sideA?.abbr ?? "", sideB?.abbr ?? ""].join("|");
  useEffect(() => {
    if (nameAuto && tickerAuto) return;
    // editedFor null with a typed name = a draft saved before this fix (the owner's stuck "Ea"): regenerate it too
    if (editedFor !== subjectKey) { setNameAuto(true); setTickerAuto(true); setEditedFor(null); }
  }, [subjectKey, editedFor, nameAuto, tickerAuto]);
  useEffect(() => {
    if (!text || step !== "review") return;
    const want = genTicker ?? srcSuggest.ticker ?? text.ticker, wantName = srcSuggest.name ?? text.name;
    if (tickerAuto && want && want !== ticker) setTicker(want);
    if (nameAuto && wantName && wantName !== name && flow !== "pair") setName(wantName);
  }, [text, step, tickerAuto, nameAuto, ticker, name, flow, genTicker, srcSuggest]);
  // website-19: a pick in question 2 lands on the review step; the guided path shows question 3 first
  useEffect(() => { if (step === "review" && guide.follow && guide.phase === "which") setGuide((g) => ({ ...g, phase: "burn" })); }, [step, guide.follow, guide.phase]);
  // a team's "once, if they win the title": the championship market, found by the existing search (greyed "No market for this yet")
  useEffect(() => {
    if (guide.follow !== "team" || !team || (guide.phase !== "burn" && guide.phase !== "name" && guide.phase !== "review")) return;
    const key = `${leagueSeries}:${team.abbr}`;
    if (titleCard?.key === key) return;
    let live = true;
    const champ = ({ mlb: "World Series", nba: "NBA Finals", nhl: "Stanley Cup", nfl: "Super Bowl" } as Record<string, string>)[leagueSeries ?? ""] ?? "championship";
    setTitleCard({ key, state: "loading", card: null });
    getJson<{ cards: Suggestion[] }>(`${V1}/search?q=${encodeURIComponent(`${team.nickname ?? team.name} win the ${champ}`)}`)
      .then((j) => { if (!live) return; const c = j.cards.find((x) => x.id.startsWith("champ:") && !!x.rule?.market && !x.refused.length) ?? null; setTitleCard({ key, state: c ? "found" : "none", card: c }); })
      .catch(() => { if (live) setTitleCard({ key, state: "none", card: null }); });
    return () => { live = false; };
  }, [guide.follow, guide.phase, team, leagueSeries]);   // eslint-disable-line react-hooks/exhaustive-deps
  // the fade side once the rule it applies to exists (a Matchup moving from one game to the season rebuilds both rules first)
  useEffect(() => {
    if (!wantInverse || !rule || step !== "review" || (flow === "pair" && pairMode === "game")) return;
    if (dialsFor(rule, dialCtx).inverse && (rule.inverse === true) !== (wantInverse === "on")) setDial("inverse", wantInverse);
    setWantInverse(null);
  }, [wantInverse, baseKey, pairMode, step, flow]);   // eslint-disable-line react-hooks/exhaustive-deps

  const localPreview = useMemo(() => {
    if (!rule || !pick?.source?.readings?.length || flow !== "feed") return null;
    let prev: { value: string | null; carryOut: string } | null = null;
    const steps = pick.source.readings.map((r) => { const ev: SettledEvent = { id: r.id, at: r.id, result: null, value: r.value, title: null, sourceUrl: "" }; const st = unitStep(rule, ev, prev); if (r.value !== null) prev = { value: r.value, carryOut: st.carryOut }; return { step: st }; });
    return previewTotals(steps);
  }, [rule, pick, flow]);

  // ---- back-tests run by themselves on the rule and review steps (debounced) ---------------------------------------------------
  const btKey = JSON.stringify([rule, ruleB]);
  const runBacktest = useCallback(async () => {
    if (!rule) return;
    setBtBusy(true); setBtErr(null);
    try {
      const run = async (x: BurnRule) => { const r = await fetch("/api/burnticker/oracle/backtest", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rule: x }) }); const j = await r.json().catch(() => ({} as { error?: string })); if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`); return j as Backtest; };
      setBt(await run(rule));
      setBtB(ruleB ? await run(ruleB) : null);
      setBtFor(btKey);
    } catch (e) { setBt(null); setBtB(null); setBtErr(String((e as Error).message)); setBtFor(btKey); } finally { setBtBusy(false); }
  }, [rule, ruleB, btKey]);
  useEffect(() => {
    if (!rule || btFor === btKey || btBusy || step !== "review") return;
    const t = setTimeout(() => { void runBacktest(); }, 600);
    return () => clearTimeout(t);
  }, [rule, btKey, btFor, btBusy, step, flow, runBacktest]);
  const btFresh = btFor === btKey && !!bt;
  // L06: the read-only review payload (POST /v1/launch/review) for the pre-wallet summary — the server's numbers, debounced. A6: every
  // request carries the draft's revision; an answer for an older revision or an older request is dropped (launchReviewSync.ts)
  const reviewSeq = useRef(0);
  // item 253 (launch integrity): the whole profile, image included, is part of the draft's revision, so a prepare answer for an older
  // profile is set aside
  const reviewKey = draftRevision([rule, ticker, name, note, pairOn ? [tickerB, nameB, ruleB, pairVenue] : null, srcWarnings, textCtx, raiseSol, profileRevision(profile), pairOn ? profileRevision(profileB) : ""]);
  const curRev = useRef(reviewKey); curRev.current = reviewKey;
  useEffect(() => {
    if (step !== "review" || !rule || gate.kind === "loading") return;
    const seq = ++reviewSeq.current, rev = reviewKey;
    setReviewSlot((x) => reviewRequested(x, rev, seq));
    const t = setTimeout(() => {
      getJson<LaunchReview>(`${V1}/launch/review`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rule, ticker: ticker.toUpperCase(), name, note, descCtx: textCtx, warnings: srcWarnings, raiseSol, creatorDescription: profile.description, links: creatorLinks({ x: profile.x, telegram: profile.telegram, website: profile.website }).links, ...(pairOn && ruleB ? { companion: { ticker: tickerB.toUpperCase(), name: nameB, creatorDescription: profileB.description, rule: ruleB } } : {}) }) })
        .then((j) => setReviewSlot((x) => reviewAnswered(x, curRev.current, { rev, seq, review: j })))
        .catch((e) => setReviewSlot((x) => reviewAnswered(x, curRev.current, { rev, seq, error: `${(e as Error).message} (${detailOf(e)})` })));
    }, 400);
    return () => clearTimeout(t);
  }, [step, reviewKey, gate.kind]);   // eslint-disable-line react-hooks/exhaustive-deps
  const shownReview = reviewFor(reviewSlot, reviewKey);
  const reviewCurrent = reviewMatchesDraft(reviewSlot, reviewKey);

  // WIRING-PARITY audit 7 #3: a link the server refuses (X on x.com or twitter.com, Telegram on t.me, no look-alike or burnticker.com
  // address) is said under the fields and blocks Launch, the same check the review and the bundle run
  const linkAwareProblems = (v: ProfileValue): string[] => [...new Set([...profileProblems(v), ...creatorLinks({ x: v.x, telegram: v.telegram, website: v.website }).problems])];
  const linksOf = useCallback(() => ([["website", link], ["X", xUrl], ["Telegram", tg]] as const).filter(([, u]) => /^https:\/\/\S+$/.test(u.trim())).map(([label, u]) => ({ label, url: u.trim() })), [link, xUrl, tg]);
  const launch = useCallback(async () => {
    if (!rule || !reviewMatchesDraft(reviewSlot, curRev.current)) return;   // A6: transactions are prepared only for the reviewed draft
    setBusy(true); setLaunchErr(null);
    // 409 / 429 / 503 → a plain sentence (pairLaunchClient.launchErrorMessage)
    const post = async (body: Record<string, unknown>) => { const r = await fetch("/api/burnticker/launch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); const j = await r.json().catch(() => null); if (!r.ok) throw new LaunchRequestError(r.status, j?.code ?? null, launchErrorMessage(r.status, j as LaunchErrorBody | null, r.headers.get("retry-after"))); return j; };
    setPcOut(null);
    mark("launch");
    // pressing Launch is the acknowledgement (the line under the button states both); socials and a custom image are API-only; no launch built here carries an opening purchase (hostedLaunch.ts)
    flowStats.current.decisions++;
    const common = { creator, firstBuySol: "0", raiseSol, acknowledgements: { ruleLocked: true, noReturns: true }, timings: { ...stepTimes.current, screens: flowStats.current.screens, decisions: flowStats.current.decisions } };
    // item 253: the prepare answer applies only to the draft it was asked for; an edit while it was in flight sets no plan and never
    // reaches the wallet (preparedLaunch.ts prepareIfCurrent). The sign card's tickers are the ones sent, not the form's.
    const sentRev = curRev.current, sent = { a: ticker.toUpperCase(), b: tickerB.toUpperCase() };
    try {
      const out = await prepareIfCurrent(sentRev, () => curRev.current, async (): Promise<() => void> => {
      if (pairOn && ruleB) {
        // A matchup: two coins, one per team — two launches (each its own selector; a registered pair needs one shared selector).
        // website-18: each coin carries its own image, description and links (pinned in its own metadata file)
        const a = await post({ ...common, ticker: ticker.toUpperCase(), name, description: finalDescription, descCtx: textCtx, note, imageUrl: null, rule, ...profileBody(profile) });
        const b = await post({ ...common, firstBuySol: "0", ticker: tickerB.toUpperCase(), name: nameB, description: finalDescriptionB, descCtx: ctxB, note: "", imageUrl: null, rule: ruleB, ...profileBody(profileB) });
        return () => { setPairOut({ pairId: null, a: a.bundle, b: b.bundle, notes: [independentPairFacts(sent.a, sent.b).moves] }); setBundle(a.bundle); };
      } else {
        const body: Record<string, unknown> = { ...common, ...launchBody({ creator, ticker, name, description: finalDescription, descCtx: textCtx, note, rule, raiseSol }) };
        // website-15 item 13: a single coin carries the creator's description, links and uploaded image (with the confirmed rights line)
        // website-18: a registered pair's side A too; side B's profile rides in `pair`
        Object.assign(body, profileBody(profile));
        if (pairOn) {
          // a rivalry pair (one shared selector): the venue this host uses — the pair curve (one transaction set, both graduate or
          // neither) or two LaunchLab bundles; a 409 naming the other venue switches the review line and waits for a second press
          const j = await postPairLaunch((u, init) => fetch(u, init), { ...body, pair: { ticker: tickerB.toUpperCase(), name: nameB, description: finalDescriptionB, imageUrl: null, ...profileBody(profileB) } }, pairVenue);
          if (j.venue === "pair-curve") return () => { setPairOut(null); setBundle(null); setPcOut({ pairId: j.pair.pairId, pc: j.pairCurve, keys: j.mintSecretKeys, notes: j.pair.notes ?? [] }); };
          return () => { setPairOut({ pairId: j.pair.pairId, a: j.bundles.a as Bundle, b: j.bundles.b as Bundle, notes: j.pair.notes ?? [] }); setBundle(j.bundles.a as Bundle); };
        }
        const one = (await post(body)).bundle;
        return () => setBundle(one);
      }
      });
      if ("stale" in out) { setLaunchErr(STALE_PREPARE_SENTENCE); return; }
      out.ok(); setSignTickers(sent);
      setStep("launch");
    } catch (e) { const v = venueFrom409(e); if (v) setPairVenue(v); setLaunchErr(String((e as Error).message)); } finally { setBusy(false); }
  }, [reviewSlot, rule, ruleB, raiseSol, season, pairOn, pairVenue, creator, ticker, name, finalDescription, finalDescriptionB, imageUrl, ownImage, customImages, note, profile, profileB, textCtx, pairMode, aHome, sideA, linksOf, firstBuy, ackLocked, ackNoReturns, tickerB, nameB, imageB, game?.title]);

  // ---- navigation -----------------------------------------------------------------------------------------------------------------
  const order = ORDER[flow];
  const idx = order.indexOf(step);
  const next = () => setStep(order[Math.min(idx + 1, order.length - 1)]);
  /** L03: remember the screen a choice was made on, so Back from the review returns to it (query, category, scroll included). */
  const markOrigin = (kind: EntryKind) => setOrigin({ kind, flow, step, uq, q2, cat, bq, leagueSeries, scrollY: typeof window === "undefined" ? 0 : window.scrollY });
  /** Back to question 2's picker (from the burn, the end or the review), keeping question 1's answer. */
  const toWhich = () => {
    // item 118: the list comes back where it was (its category, filter and open event stay in state; the scroll position is restored)
    if (origin) restoreScroll.current = origin.scrollY;
    setGuide((g) => ({ ...g, phase: "which" })); setShareNotice(null); setOrigin(null);
    if (guide.follow === "team") { setFlow("team"); setStep("team"); }
    else if (elPick) { setElPick(null); setFlow("browse"); setStep("pick"); }
    else if (guide.follow === "coins" || guide.follow === "disaster") setStep("choose");
    else setStep(ORDER[flow][0]);
  };
  /** The progress strip: a tap on an answered step goes back to it. */
  const jumpTo = (p: GuidedPhase) => {
    if (p === "follow") { setGuide({ follow: null, phase: "follow", pairKind: null }); setStep("choose"); return; }
    if (p === "which") { if (step === "review") toWhich(); return; }
    if (step === "review" && (p === "burn" || p === "name" || p === "review")) setGuide((g) => ({ ...g, phase: p }));
  };
  // the browser's Back and Forward: an earlier answered step is reopened; a later one only when it was already reached
  useEffect(() => {
    const h = () => {
      const p = (new URLSearchParams(window.location.search).get("step") ?? "follow") as GuidedPhase;
      if (p === "follow") { setGuide({ follow: null, phase: "follow", pairKind: null }); setStep("choose"); return; }
      if (!guide.follow) return;
      if (p === "which") { if (step === "review") toWhich(); return; }
      if (step === "review") setGuide((g) => ({ ...g, phase: p }));
    };
    window.addEventListener("popstate", h);
    return () => window.removeEventListener("popstate", h);
  }, [guide.follow, step]);   // eslint-disable-line react-hooks/exhaustive-deps
  const back = () => {
    if (guide.follow) {
      // the guided steps: review, the end, the burn, back to the picker of question 2, then question 1
      if (step === "review" && guide.phase === "review") { setGuide((g) => ({ ...g, phase: "name" })); return; }
      if (step === "review" && guide.phase === "name") { setGuide((g) => ({ ...g, phase: "burn" })); return; }
      if (step === "review") { toWhich(); return; }
      if (false) {
        setGuide((g) => ({ ...g, phase: "which" })); setShareNotice(null); setOrigin(null);
        if (guide.follow === "team") { setFlow("team"); setStep("team"); }
        else if (elPick) { setElPick(null); setFlow("browse"); setStep("pick"); }
        else setStep(ORDER[flow][0]);
        return;
      }
      if (guide.follow === "rivalry" && guide.pairKind) { setGuide({ follow: "rivalry", phase: "which", pairKind: null }); setStep("choose"); return; }
      setGuide({ follow: null, phase: "follow", pairKind: null }); setStep("choose"); return;
    }
    if (step === "review" && origin) {
      const o = origin;
      setFlow(o.flow); setUq(o.uq); setQ2(o.q2); setCat(o.cat); setBq(o.bq); if (o.leagueSeries) setLeagueSeries(o.leagueSeries);
      restoreScroll.current = o.scrollY; setOrigin(null); setShareNotice(null); setStep(o.step);
      return;
    }
    if (idx <= 0) setStep("choose"); else setStep(order[idx - 1]);
  };
  const begin = (f: Flow) => {
    setOrigin(null); setShareNotice(null); setSrcWarnings([]); setEventInfo(null);
    setFlow(f); setStep(ORDER[f][0]); setBt(null); setBtB(null); setBtFor(""); setPairOut(null); setPcOut(null); setBundle(null);
    if (f === "team" || f === "pair") { setFraction(DEFAULT_SHARE.recurring); setLeagueSeries(null); }
    setDraft(null); setFlavour(null); setFlavourB(null); setCardCtx(null); setCardYear(null); setElPick(null); setEsel([]); setSrcSuggest({ name: null, ticker: null });
    if (f === "single" && pick?.oracle === "catalogue") setPick(null);
    if (f === "browse") { setPick(null); setDrill(null); }
  };
  /** One click from a search card (or an elections outcome) to the create screen, with the rule filled in. */
  const applyRule = (r: BurnRule, pk: NonNullable<Suggestion["pick"]>, o: { name?: string | null; ticker?: string | null; how?: string | null; settlement?: string | null; source?: Suggestion["source"] } = {}) => {
    const fromCatalogue = pk.oracle === "catalogue" ? sources.find((x) => x.id === pk.series) : undefined;
    const src = fromCatalogue ?? (o.source ? ({ id: pk.series ?? "", kind: "native", tier: 4, tierLabel: "read by the operator's automation from the original publisher", title: pk.title, sourceName: o.settlement ?? "", sourceUrl: "", cadence: "", unit: o.source.unit, direction: o.source.direction, baseline: o.source.baseline, flags: [], launchable: { ok: true, why: null }, param: null, lastReading: null, readings: [], preview: null } as Source) : undefined);
    setFlow("single"); setPick({ ...pk, source: src }); setFilter(""); setBt(null); setBtFor(""); setBundle(null); setPairOut(null); setPcOut(null);
    // L01: the card's rule becomes the draft's fields through launchDraft.ts (composeRule rebuilds exactly this rule from them)
    const f = fieldsFromRule(r, { kind, mode, onYes, onNoEnabled, onNo, burnOn, unit, perUnit, baseline, direction, tokensYes, vaultShare, filter: "", polyPreset });
    setKind(f.kind); setBurnOn(f.burnOn); setOnYes(f.onYes); setOnNoEnabled(f.onNoEnabled); setPerUnit(f.perUnit); setUnit(f.unit); setDirection(f.direction); setBaseline(f.baseline);
    setMode("buyback");
    // the source's suggestion; the review's effect applies it unless the creator typed their own (never copied over an edit)
    setSrcSuggest({ name: o.name ?? null, ticker: o.ticker ?? null });
    setHowSettles(o.how ?? null); setSettleNote(o.settlement ?? null);
    setStep("review");
  };
  /** An event card's outcome → the create screen: that outcome's own yes/no market, 10% once, its ticker ($SPIDER) editable. */
  const applyOutcome = (c: Suggestion, o: NonNullable<Suggestion["picker"]>["outcomes"][number]) => {
    if (lastShown.current) lastShown.current.clicked = true;
    markOrigin("search"); setShareNotice(null); setSrcWarnings(c.note ? [c.note] : []);
    setEventInfo({ question: o.question, url: c.href, outcome: o.yes ? `“${o.yes}”` : null, resolves: c.endAt ? denver(c.endAt) : null, criteria: c.howSettles });
    mark("card");
    setDraft(null); setFlavour(null); setFlavourB(null); setCardYear(null); setCardSet(null); setCardCtx(null); setOutPick(null);
    const r = { kind: "binary", binary: { onYes: { fractionOfPool: 0.1 }, onNo: null } } as unknown as BurnRule;   // applyRule reads the dials only
    applyRule(r, { oracle: "polymarket", series: null, market: o.conditionId, title: `${o.question} (resolves once)`, yes: o.yes, no: o.no }, { name: o.label.slice(0, 32), ticker: o.ticker, how: `Settles on "${o.question}" resolving ${o.yes}.`, settlement: c.settlement });
  };
  /** A search card → the create screen: the window the card shows (team cards offer four), its text context, its suggested name. */
  const applySuggestion = (c: Suggestion, wi = 0) => {
    if (lastShown.current) lastShown.current.clicked = true;
    // L03 / L05: where this came from (Back returns there) and the card's own warning, carried into the review
    markOrigin("search"); setShareNotice(null); setSrcWarnings(c.note ? [c.note] : []);
    setEventInfo(c.pick?.oracle === "polymarket" ? { question: c.pick.title.replace(/\s*\(resolves once\)$/, ""), url: c.href, outcome: c.pick.yes ? `“${c.pick.yes}”` : null, resolves: c.endAt ? denver(c.endAt) : null, criteria: c.howSettles } : null);
    mark("card");
    setDraft(null); setFlavour(null); setFlavourB(null); setCardYear(c.seasonYear ?? null); setCardSet(c.leagueSet ?? null);
    if (c.matchup) {
      const m = c.matchup, side = (x: typeof m.a): Side => ({ abbr: x.abbr, marketTicker: x.series, label: x.name, nickname: x.nickname, name: x.name, ticker: x.ticker });
      setLeagueSeries(m.league); setCardCtx(null);
      chooseGame({ eventTicker: m.eventId, seriesTicker: m.league, title: m.title, subTitle: null, category: "Sports", expectedAt: m.startsAt, closeTime: null, markets: [], matchedSides: [], pair: { a: side(m.a), b: side(m.b), tieMarket: null }, refused: [] });
      return;
    }
    const w = c.windows?.[wi] ?? null, r = w?.rule ?? c.rule, tx = w?.text ?? c.text;
    if (!r || !c.pick) return;
    const tk = w && wi > 0 ? tx?.ticker ?? null : c.suggestedTicker, nm = w && wi > 0 ? tx?.name ?? null : c.suggestedName;
    setCardCtx({ key: r.market ?? r.series ?? "", ctx: c.descCtx ?? {} });
    applyRule(r, { ...c.pick, series: r.series ?? c.pick.series, title: w ? w.title : c.pick.title }, { name: nm, ticker: tk, how: c.howSettles, settlement: c.settlement, source: c.source });
    if (r.inverse) setPendingDials({ fraction: shareOf(r) ?? DEFAULT_SHARE.recurring, side: null, window: null, games: null, league: false, from: "", inverse: true });
  };
  /**
   * WIRING-SOURCES3: a natural-disaster coin from its series. The scalar takes the feed's own unit, baseline and direction (nifc.acres counts
   * per 100,000 acres); a next-event series is a one-shot at the one-shot default.
   */
  const hazardRule = (series: string): BurnRule => {
    const src = sources.find((x) => x.id === series || series.startsWith(`${x.id}:`));
    const r0 = firstPartyRule(series, DEFAULT_SHARE.recurring);
    const r = src?.unit ? ({ ...r0, scalar: { ...r0.scalar!, unit: src.unit.size, baseline: src.baseline ?? 0, direction: src.direction ?? "up" } } as BurnRule) : r0;
    const one = dialsFor(r).bounds.max >= 1;
    return one ? applyDial(r, "fraction", DEFAULT_SHARE.oneShot) : r;
  };
  const chooseHazard = (series: string, title: string, publisher: string) => {
    markOrigin("browse"); setOrigin(null); setSrcWarnings([]); setShareNotice(null); setDraft(null); setCardCtx(null); setEventInfo(null);
    const src = sources.find((x) => x.id === series || series.startsWith(`${x.id}:`));
    applyRule(hazardRule(series), { oracle: "catalogue", series, market: null, title }, { settlement: publisher, source: src?.unit ? { unit: src.unit, baseline: src.baseline ?? 0, direction: src.direction ?? "up" } as Suggestion["source"] : undefined });
  };
  const chooseTeam = (t: Team) => { mark("card"); markOrigin("team"); setShareNotice(null); setSrcWarnings([]); setTeam(t); setSrcSuggest({ name: null, ticker: null }); setDraft(null); setFlavour(null); next(); };
  useEffect(() => { if (!pendingTeam || !teams.length) return; const t = teams.find((x) => x.abbr === pendingTeam); setPendingTeam(null); if (t) chooseTeam(t); }, [teams, pendingTeam]);   // eslint-disable-line react-hooks/exhaustive-deps
  const chooseGame = (g: EventHit) => {
    if (!g.pair) return;
    setGame(g); setSwap(false); setPairMode("game"); setDraft(null); setFlavour(null); setFlavourB(null);
    // walkthrough snag 10: both sides named by the matchup, symmetrically ($LADVMIL and $MILVLAD; "Dodgers vs Brewers, Dodgers side")
    const tk = pairTickers(g.pair.a.abbr, g.pair.b.abbr), nm = pairNames(g.pair.a.nickname ?? g.pair.a.name, g.pair.b.nickname ?? g.pair.b.name);
    setElPick(null); setSrcSuggest({ name: null, ticker: null });
    if (nameAuto) { setName(nm.a); setNameB(nm.b); }
    if (tickerAuto) { setTicker(tk.a); setTickerB(tk.b); }
    setFlow("pair"); setStep("review");
  };
  const doSwap = () => { setSwap(!swap); setName(nameB); setTicker(tickerB); setNameB(name); setTickerB(ticker); };
  /** Question 1 (website-19): what the coin follows, then the picker for question 2. */
  const pickFollow = (f: FollowId) => {
    flowStats.current.decisions++;
    setGuide({ follow: f, phase: "which", pairKind: null }); setTitleCard(null);
    if (f === "team") begin("team");
    else if (f === "market") begin("single");
    else if (f === "number") { begin("browse"); setCat("economics"); }
    else if (f === "disaster") { begin("team"); setStep("choose"); }
    else { setStep("choose"); }
  };
  const pickRivalry = (k: "teams" | "candidates") => {
    setGuide({ follow: "rivalry", phase: "which", pairKind: k }); setRivalA(null); setRivalB(null); setRivalGame(null); setRivalSeason(null);
    if (k === "teams") begin("pair"); else { begin("browse"); setCat("politics"); }
  };
  /** The owner's rivalry pair: two teams, then one game (their next listed meeting) or this season (each coin burns when its team loses). */
  const sideOfTeam = (t: Team): Side => ({ abbr: t.abbr, marketTicker: t.series?.loss ?? t.filter, label: t.name, nickname: t.nickname, name: t.name, ticker: t.ticker });
  const chooseRivals = (a: Team, b: Team, mode: "game" | "season", chosen: EventHit | null = null) => {
    const seasonHit: EventHit = { eventTicker: `${leagueSeries}-${a.abbr}-${b.abbr}-season`, seriesTicker: leagueSeries ?? "", title: `${a.name} vs ${b.name}`, subTitle: null, category: "Sports", expectedAt: null, closeTime: null, markets: [], matchedSides: [], pair: { a: sideOfTeam(a), b: sideOfTeam(b), tieMarket: null }, refused: [] };
    // audit 7 item 7, item 156: the exact meeting picked is the one the rule binds; without a pick, the next listed one
    const m = chosen ?? meetingOf(games, a.abbr, b.abbr);
    // the meeting with side A first, so $AVB is always the first team picked
    const meet: EventHit | null = m && m.pair ? (m.pair.a.abbr === a.abbr ? m : { ...m, pair: { a: m.pair.b, b: m.pair.a, tieMarket: m.pair.tieMarket } }) : null;
    setRivalSeason(seasonHit); setRivalGame(meet);
    markOrigin("matchup"); setOrigin(null); setSrcWarnings([]);
    chooseGame(mode === "game" && meet ? meet : seasonHit);
    if (!(mode === "game" && meet)) { setPairMode("season"); renameForSeason(a, b); }
  };
  /** Audit 7 item 9: a season pair is two "every loss" coins, so the generated names say so ("Guardians 2026 Losses"). */
  const renameForSeason = (a: { abbr: string; nickname: string | null; name: string }, b: { abbr: string; nickname: string | null; name: string }) => {
    const n = seasonPairNames(a, b, cardYear ?? (leagueSeries ? seasonYearAt(leagueSeries as LeagueId, Date.now()) : new Date().getUTCFullYear()), leagueSeries);
    if (nameAuto) { setName(n.a.name); setNameB(n.b.name); }
    if (tickerAuto) { setTicker(n.a.ticker); setTickerB(n.b.ticker); }
  };
  /** Snag 7: two candidates of one race become two coins, each on its own outcome's market (snag 8: named from the outcome picked). */
  const startElPair = (r: ElRace) => {
    const [a, b] = esel.map((id) => r.outcomes.find((o) => o.conditionId === id));
    if (!a || !b || a.conditionId === b.conditionId) return;
    const sur = (o: ElOutcome) => o.label.replace(/\s*\([A-Z]\)$/, "").trim().split(/\s+/).pop() ?? o.label;
    const tk = pairTickers(sur(a), sur(b)), nm = pairNames(sur(a), sur(b));
    const side = (o: ElOutcome, t: string): Side => ({ abbr: sur(o), marketTicker: o.conditionId, label: o.label, nickname: sur(o), name: o.label, ticker: t });
    markOrigin("browse"); setOrigin(null);
    // snag 8: a market that is not about the person by name is said in one honest sentence (the party's market settles it)
    const honest = (o: ElOutcome, t: string) => (fold(o.question).includes(fold(sur(o))) ? null : `$${t} settles on the market "${o.question}". That market is about the party's result, not ${sur(o)} by name.`);
    setSrcWarnings([honest(a, tk.a), honest(b, tk.b)].filter((x): x is string => !!x));
    setElPick({ race: r, a, b });
    setGame({ eventTicker: r.slug, seriesTicker: "elections", title: r.title, subTitle: null, category: "Politics", expectedAt: r.settlesOn, closeTime: null, markets: [], matchedSides: [], pair: { a: side(a, tk.a), b: side(b, tk.b), tieMarket: null }, refused: [] });
    setSwap(false); setPairMode("game"); setDraft(null); setFlavour(null); setFlavourB(null);
    setSrcSuggest({ name: null, ticker: null });
    if (nameAuto) { setName(nm.a); setNameB(nm.b); }
    if (tickerAuto) { setTicker(tk.a); setTickerB(tk.b); }
    setFlow("pair"); setStep("review");
  };

  const card = "rounded-lg border border-neutral-800 bg-neutral-900 p-3";
  const input = "w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm";
  const primary = "rounded bg-amber-400 text-neutral-950 font-medium px-4 py-2 text-sm disabled:opacity-40";
  const pct = (f: number) => `${(f * 100).toFixed(f * 100 % 1 === 0 ? 0 : 1)}%`;
  const record = (t: Team) => `${t.record.w}–${t.record.l}${t.record.d ? `–${t.record.d}` : ""}`;
  const okTicker = (t: string) => /^[A-Z0-9]{2,10}$/.test(t);
  const navRow = (nextLabel: string | null, disabled = false, onNext: () => void = next) => (
    <div className="flex items-center gap-3 pt-2"><button data-nav className="text-sm underline" onClick={back}>← Back</button>{nextLabel && <button data-nav className={primary} disabled={disabled} onClick={onNext}>{nextLabel}</button>}</div>
  );
  /** Every league, grouped by sport and searchable (no league first by habit). */
  const leaguePicker = (
    <div className="space-y-2">
      {leagueErr && <div className="text-red-400 text-xs" role="alert"><p>The league list is not available right now. Try again in a moment.</p><details className="text-neutral-500"><summary className="cursor-pointer">Details</summary><p className="break-words font-mono">{[leagueErr, leagueDetail].filter(Boolean).join(" ")}</p></details></div>}
      <div className="flex items-center gap-1"><input data-decision="what" data-help="league-search" className={input + " w-full sm:w-72"} placeholder="Search leagues: MLB, Premier League, WNBA, MLS, college…" value={leagueQ} onChange={(e) => setLeagueQ(e.target.value)} aria-label="search leagues" /><FieldHelp id="league-search" /></div>
      {!leagues.length && !leagueErr && <span className="text-sm text-neutral-500">Loading leagues…</span>}
      {(["baseball", "basketball", "football", "hockey", "soccer"] as const).map((sp) => {
        const ls = leagues.filter((l) => l.sport === sp && (!leagueQ.trim() || `${l.label} ${l.id} ${sp}`.toLowerCase().includes(leagueQ.trim().toLowerCase())));
        if (!ls.length) return null;
        return (
          <div key={sp} className="space-y-1">
            <div className="font-mono text-[11px] uppercase tracking-widest text-neutral-500">{sp}{sp === "baseball" && <FieldHelp id="league-pick" />}</div>
            <div className="flex flex-wrap gap-2">{ls.map((l) => (
              <button data-decision="what" key={l.id} aria-pressed={leagueSeries === l.id} onClick={() => { setLeagueSeries(l.id); setTeamQ(""); setGameQ(""); }} title={l.crossRead ? `Checked against ${l.crossRead}.` : "This league has no second source to check results, so a coin on it is refused."} className={`rounded-full border px-3 py-1.5 text-sm ${leagueSeries === l.id ? "border-amber-400 bg-amber-400 text-neutral-950" : "border-neutral-700 hover:border-neutral-500"}`}>{l.label}{!l.crossRead && <span className="ml-1 text-[10px] text-red-400">no second check</span>}</button>
            ))}</div>
          </div>
        );
      })}
    </div>
  );
  // website-19: with a league picked, the picker folds to one line ("League: MLB. Change") so question 2's list starts on the first screen
  const leagueFolded = leagueSeries
    ? <p className="text-sm text-neutral-300" data-league-folded>League: <span className="font-medium text-neutral-100">{leagues.find((l) => l.id === leagueSeries)?.label ?? leagueSeries}</span>. <button type="button" data-decision="what" className="underline" onClick={() => setLeagueSeries(null)}>Change</button></p>
    : <div className={card + " space-y-3"}><h2 className="font-medium outline-none" tabIndex={-1} data-step-heading>Choose a league</h2>{leaguePicker}</div>;
  const chip = (v: Venue) => <span className={`ml-2 inline-block rounded px-1.5 py-0.5 align-middle text-[10px] font-medium uppercase tracking-wide ring-1 ${v === "kalshi" ? "bg-emerald-500/15 text-emerald-300 ring-emerald-500/40" : "bg-indigo-500/15 text-indigo-300 ring-indigo-500/40"}`}>{v === "kalshi" ? "Kalshi" : "Polymarket"}</span>;
  // intent audit 2 item 1: a closed market is refused here as well as greyed in the list
  const pickPoly = (m: PolyMarket) => { if (m.closed) return; markOrigin("exact"); setSrcWarnings([]); const ev = polyFound?.events.find((e) => e.markets.some((x) => x.conditionId === m.conditionId)); setEventInfo({ question: m.question, url: ev?.url ?? null, outcome: `“${m.yes}”`, resolves: m.endDate ? denver(m.endDate) : ev?.endDate ? denver(ev.endDate) : null, criteria: null, stated: m.resolutionSource && m.finalAfter ? { phrase: m.resolutionSource.phrase, text: m.resolutionSource.text, crossRead: m.resolutionSource.crossRead ? { text: m.resolutionSource.crossRead.text } : null, finalAfter: { text: m.finalAfter.text, ifDisputed: m.finalAfter.ifDisputed } } : null }); setPick({ oracle: "polymarket", series: null, market: m.conditionId, title: `${m.question} (resolves once)`, yes: m.yes, no: m.no }); setKind("binary"); setBurnOn("yes"); setOnYes(DEFAULT_SHARE.oneShot); setFilter(""); setPolyPreset(null); next(); };
  const pickPolySeries = (series: string, title: string) => { markOrigin("exact"); setSrcWarnings([]); setPick({ oracle: "polymarket", series, market: null, title }); setKind("binary"); setFilter(""); setPolyPreset(series.includes("/moneyline") ? "^[^:]+ vs\\. [^:]+$" : null); next(); };
  const badge = (abbr: string) => <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-neutral-800 font-mono text-xs font-bold tracking-tight text-amber-300 ring-1 ring-neutral-700">{abbr}</span>;
  const kalshiOff = !venues.kalshi;
  const marketsOff = !venues.kalshi && !venues.polymarket;
  const oneLiner = text?.oneLiner ?? (rule ? ruleOneLiner(rule, flow === "team" ? null : pick?.title ?? null) : "pick an event first");
  const b64u = (x: string) => btoa(unescape(encodeURIComponent(x))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  /** The generated coin image for a rule still being edited (coinArt.ts via /burnticker/img/preview.svg): the default image. */
  const genImg = (r: BurnRule | null, tk: string, one: string) => (r ? `/burnticker/img/preview.svg?r=${b64u(JSON.stringify(r))}&t=${encodeURIComponent(tk || "TICKER")}&l=${encodeURIComponent(one.slice(0, 120))}` : "");
  const teamFilter = (t: Team) => { const s = teamQ.trim().toLowerCase(); if (!s) return true; if (`${t.name} ${t.abbr} ${t.city} ${t.nickname ?? ""}`.toLowerCase().includes(s)) return true; return aliasLookup(teamQ).some((a) => a.abbr === t.abbr && a.series === leagueSeries); };

  // launch audit 5 L02: per-type availability (the catalogue's model), shown before any form and on every card that leads to a type
  // the progress strip's answers ("Follows: a team", "Which: Dodgers", "Burns: every time", "Ends: $DEFICIT")
  const guideAnswers: Partial<Record<GuidedPhase, string>> = !guide.follow ? {} : {
    follow: guide.follow === "disaster" ? HAZARD_FOLLOW.label.toLowerCase() : FOLLOW_CHOICES.find((c) => c.id === guide.follow)?.label.toLowerCase(),
    which: pairOn && sideA && sideB ? `${sideA.nickname ?? sideA.name} vs ${sideB.nickname ?? sideB.name}` : flow === "team" && team ? team.nickname ?? team.name : guide.follow === "team" && team ? team.nickname ?? team.name : pick?.title ? (sourceSubjectLabel(pick.series ?? "") ?? pick.title.replace(/\s*\(resolves once\)$/, "")).slice(0, 28) : undefined,
    burn: rule ? (rule.inverse ? "when it does not happen" : windowKindOf(rule) === "one-shot" ? "once" : "every time") : undefined,
    name: ticker ? `$${ticker}${pairOn && tickerB ? ` and $${tickerB}` : ""}` : undefined,
  };
  const typeBlocked = (t: LaunchType | null): string | null => { if (!t || !avail) return null; const a = avail.types[t]; return a.available ? null : `${a.label} launches are not available on this site. ${a.reason ?? ""}`.trim(); };
  /** A2: the one line beside every pair option (Coin vs Coin, the two-coin Matchup, registered pairs) while pairs are unavailable. */
  const pairsBlocked: string | null = site.read === "ready" && !site.pairs.available ? site.pairs.line : null;
  const pairsWhy = (id: string) => pairsBlocked ? <details id={id} className="mt-2 text-xs text-amber-300" data-pairs-blocked><summary className="cursor-pointer">{pairsBlocked}</summary><p className="mt-1 text-neutral-400">{site.pairs.detail}</p></details> : null;
  const cardBlocked = (c: Suggestion): string | null => (c.matchup || c.venue === "tile" ? pairsBlocked : null) ?? typeBlocked(c.matchup ? "matchup" : c.picker ? "markets" : launchTypeOf(c.rule));
  const firstActionable = ures ? ures.cards.findIndex((c) => !c.refused.length && (!!c.picker || !!c.rule || !!c.matchup) && !cardBlocked(c)) : -1;
  const preview = gate.kind === "preview";
  /** Why the wallet cannot open for the rule on the review card (preview / closed host, an unavailable type), or null. */
  // website-12: one record decides; the review's own reason (a type or a pair this host cannot take) comes first, then the site's
  const walletBlocked = (t: LaunchType | null, two = false): string | null => (two ? pairsBlocked : null) ?? typeBlocked(t) ?? site.signingSentence ?? (step === "review" && !reviewCurrent ? REVIEW_UPDATING : null);
  // website brief §1: the gate resolves before any launch control renders (loading → skeleton; closed / unavailable → no controls)
  if (!wizardMayRender(gate)) return <LaunchGate state={gate as Exclude<LaunchGateState, { kind: "open" | "preview" }>} deficitHref={DEFICIT_SITE} noWalletLine={NO_WALLET_LINE} />;

  return (
    <main className="mx-auto max-w-4xl px-4 pt-6 pb-28 min-[900px]:pb-6 space-y-5" data-launch-main>
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">Launch a coin {cluster === "devnet" && <span className="rounded bg-sky-500/20 px-2 py-0.5 text-xs font-medium text-sky-300 ring-1 ring-sky-500/40" title="BURNTICKER_CLUSTER=devnet: test network, no real money">Devnet</span>}</h1>
          {(step === "choose" || !guide.follow) && <p className="hidden text-neutral-400 text-sm sm:block">Every <Link className="underline" href="/burnticker">Burnticker</Link> coin settles on a primary source, such as the BLS, the Treasury, the National Weather Service or a league&apos;s own feed, or on a Polymarket payout read from the chain. The rule is locked at launch. <Link className="underline" href="/burnticker/trust">See what the operator can and cannot do.</Link></p>}
        </div>
        <span className="flex items-center gap-3 text-xs"><Link className="underline text-neutral-400" href="/burnticker/templates">Templates</Link><Link className="underline text-neutral-400" href="/burnticker/me">Your coins</Link>{step !== "choose" && !guide.follow && <button data-nav className="text-neutral-500 underline" onClick={() => startOver()}>start over</button>}</span>
      </header>
      {/* website-15 item 12 (ChatGPT repair 1): sticks right under the shared header, whose measured height SiteHeader writes to --bt-header-h; website-18: from the sm width up only (at 390 px it covered the links and the step header while scrolling) */}
      {preview && <p className="z-30 sm:sticky rounded border border-amber-400 bg-neutral-950/95 px-3 py-2 text-sm font-medium text-amber-300" style={{ top: "var(--bt-header-h, 3.5rem)" }} role="status" data-preview-banner>{PREVIEW_BANNER}</p>}
      <LaunchRecovery />

      {/* intent audit 5 item 20: the one Start over confirmation, for the guided steps, the free-text review and a resumed draft alike */}
      {confirmOver && <p className="rounded border border-amber-400/50 p-2 text-xs text-amber-300" role="alert" data-start-over-confirm>Start over clears every choice on this draft. <button type="button" data-nav className="underline" onClick={() => startOver(true)}>Start over</button> <button type="button" data-nav className="ml-2 underline" onClick={() => setConfirmOver(false)}>Keep going</button></p>}
      {savedDraft && step === "choose" && guide.phase === "follow" && (
        <p className="rounded border border-amber-400/50 p-2 text-sm text-amber-200" role="status" data-saved-draft>You have a draft: {String(savedDraft.name || savedDraft.ticker || "unnamed")}. <button type="button" data-nav className="underline" onClick={resumeDraft}>Resume</button> <button type="button" data-nav className="ml-2 underline" onClick={() => startOver(true)}>Discard it</button></p>
      )}
      {(guide.follow || step === "choose") && step !== "launch" ? (
        <GuidedTop phase={guide.follow ? guide.phase : "follow"} answers={guideAnswers} onJump={jumpTo} onBack={guide.follow ? back : null} onStartOver={() => startOver()} confirm={null} />
      ) : (
        <div aria-label="Progress">
          <div className="flex items-center justify-between text-xs text-neutral-400"><span>Step {idx + 1} of {order.length}: <span className="text-neutral-200">{LABELS[flow][step]}</span></span><span data-entry-label>{step === "review" && origin ? (origin.kind === "browse" ? `Browse · ${cats.find((c) => c.id === origin.cat)?.label ?? origin.cat}` : ENTRY_LABEL[origin.kind]) : flow === "team" ? "Team coin" : flow === "pair" ? "Matchup pair" : flow === "single" ? "Exact market" : flow === "browse" ? "Browse" : "Advanced"}</span></div>
          <div className="mt-1 h-1.5 rounded bg-neutral-800"><div className="h-1.5 rounded bg-amber-400" style={{ width: `${((idx + 1) / order.length) * 100}%` }} /></div>
        </div>
      )}


      {pendingDials?.from && <p className="rounded border border-amber-400/50 p-2 text-sm text-amber-200" role="status">Launching one like ${pendingDials.from}: pick the {flow === "team" ? "team" : flow === "pair" ? "game" : flow === "browse" ? "source" : "market"}, and the review card opens with the same shape{pendingDials.side ? ` (on a ${pendingDials.side})` : ""}.</p>}

      {step === "choose" && guide.phase === "follow" && <FollowStep upfront={upfrontLines(RAISE_PRESETS_SOL)} onPick={pickFollow} blocked={(f) => (f === "disaster" ? typeBlocked("feeds") : f === "team" ? typeBlocked("team") : f === "coins" ? pairsBlocked ?? typeBlocked("derby") : f === "rivalry" ? null : f === "market" ? (marketsOff ? "Markets are not available on this site." : null) : null)} />}
      {step === "choose" && guide.follow === "rivalry" && guide.phase === "which" && !guide.pairKind && <RivalryKindStep onPick={pickRivalry} teamsBlocked={pairsBlocked ?? typeBlocked("matchup")} />}
      {step === "choose" && guide.follow === "disaster" && guide.phase === "which" && (
        <section className="space-y-3" data-guided-step="which" data-disaster-kinds><h2 className="text-xl font-semibold outline-none" tabIndex={-1} data-step-heading>{whichHeading("disaster")}</h2>
          <div className="grid gap-2 sm:grid-cols-2">{HAZARD_KINDS.map((k) => (
            <button key={k.id} type="button" data-decision="what" data-hazard={k.id} onClick={() => chooseHazard(k.every, k.label, k.publisher)} className="rounded-xl border border-neutral-800 bg-neutral-900 p-3 text-left hover:border-amber-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400">
              <span className="block text-base font-semibold">{k.label}</span><span className="block text-xs text-neutral-400">{k.publisher}</span>
            </button>
          ))}</div>
        </section>
      )}
      {step === "choose" && guide.follow === "coins" && guide.phase === "which" && (
        <section className="space-y-3" data-guided-step="which"><h2 className="text-xl font-semibold outline-none" tabIndex={-1} data-step-heading>{whichHeading("coins")}</h2>
          <CoinVsCoinTile startOpen entry={entry} pairCurve={venues.pairCurve === true} customImages={customImages} blocked={walletBlocked("derby", true)} unavailable={pairsBlocked ?? typeBlocked("derby")} unavailableDetail={pairsBlocked ? site.pairs.detail : null} />
        </section>
      )}
      {step === "choose" && guide.phase === "follow" && (
      <details className="rounded-lg border border-neutral-800 p-3" open={classicOpen} onToggle={(e) => setClassicOpen((e.target as HTMLDetailsElement).open)} data-classic>
      <summary className="cursor-pointer text-sm text-neutral-300">Or describe the event in your own words</summary>
      <div className="mt-3 space-y-5">
      {step === "choose" && (
        <section className="space-y-3" aria-label="Describe the event">
          <label className="block">
            <span className="text-lg font-medium">Describe the event</span>
            <FieldHelp id="search" /><input data-decision="what" data-help="search" enterKeyHint="search" className={input + " mt-1 text-base py-3"} value={uq} onChange={(e) => setUq(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); /* site audit #10: Enter moves to the first result (results appear as you type) */ const first = document.querySelector<HTMLElement>("[data-first-result]"); if (first) first.focus(); } }} placeholder="e.g. 'Rays win the World Series', 'Lakers win tonight', 'Arsenal win', 'Oilers lose', 'El-Sayed wins Michigan Senate', 'Detroit high above 90'" aria-label="Describe the event" />
          </label>
          <p className="text-xs text-neutral-500"><button className="underline" data-decision="what" disabled={marketsOff} onClick={() => !marketsOff && begin("single")}>or find a market by its exact listing</button></p>
          {shortQuery && <p className="text-sm text-neutral-500">Type a few more letters…</p>}
          {ubusy && <p className="text-sm text-neutral-500">Searching every source…</p>}
          {ures && (ures as { hiddenClosingSoon?: number }).hiddenClosingSoon ? <p className="text-xs text-neutral-400" data-closing-soon>{(ures as { hiddenClosingSoon?: number }).hiddenClosingSoon} one-time markets closing within 48 hours are hidden. <button type="button" data-nav className="underline" onClick={() => setClosingSoon(true)}>Show closing soon</button></p> : null}
          {ures && ures.cards.length > 0 && (
            <ul className="grid gap-2 md:grid-cols-2 lg:grid-cols-3" aria-label="Ready-made rules" aria-live="polite">
              {ures.cards.map((c, ci) => {
                const head = ci === 0 || ures.cards[ci - 1].group !== c.group ? ({ teams: "Teams", elections: "Elections", weather: "Weather", feeds: "Public data", markets: "Markets", tiles: "Coin vs Coin" } as Record<string, string>)[c.group ?? ""] ?? null : null;
                // the card's default window only (this season for a team): other windows are API-only
                const wi = 0, title = c.title, tx = c.text, badgeText = c.badge;
                return (<Fragment key={c.id}>
                {head && <li className="col-span-full font-mono text-[11px] uppercase tracking-widest text-neutral-500" aria-hidden="true">{head}</li>}
                <li className={`rounded-lg border p-3 text-sm ${c.refused.length ? "border-neutral-900 opacity-60" : "border-neutral-800 bg-neutral-900"}`}>
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                    <span className={`bt-chip bt-chip-${c.venue === "espn" || c.venue === "nws" ? "feed" : c.venue}`}>{c.venueLabel}</span>
                    {c.shape !== "tile" && <span className="bt-chip">{c.shape === "pair" ? "two coins" : c.shape}</span>}
                    {badgeText && fold(badgeText) !== fold(c.shape) && <span className="bt-chip bt-chip-window">{badgeText}</span>}
                  </div>
                  {c.alternative && <p className="mt-1 text-[11px] text-amber-300" data-alternative>This is a related rule. It is not the exact event you typed.</p>}
                  <div className="mt-1 font-medium leading-snug break-words">{title}</div>
                  <div className="text-xs text-neutral-400 break-words">{c.subtitle}</div>
                  {c.interpreted && <p className="mt-1 text-xs text-neutral-300 break-words" data-interpreted>{c.interpreted}</p>}
                  <p className="mt-1 text-xs text-neutral-400 break-words">It settles on {c.settlement}.{c.crossReadUrl && <> <a className="underline" href={c.crossReadUrl} rel="noopener" target="_blank">Open {c.crossRead ?? "the source"} ↗</a></>}</p>
                  {tx && <p className="mt-2 text-xs text-neutral-300"><span className="font-mono">${tx.ticker}</span> — {tx.oneLiner}.</p>}
                  {c.scheduleUnavailable && <p className="mt-2 text-xs text-neutral-400" data-next-game-unavailable>{NEXT_GAME_UNAVAILABLE}</p>}
                  {c.note && <p className="mt-2 text-xs text-amber-300">{c.note}</p>}
                  {c.existing && c.existing.length > 0 && <DuplicateNotice existing={c.existing} />}
                  {cardBlocked(c) && <p className="mt-2 text-xs text-amber-300" data-type-blocked>{cardBlocked(c)}</p>}
                  {c.refused.length > 0 ? <p className="mt-2 text-xs text-red-400">{refusedLine(c.refused)}</p>
                    : c.venue === "tile" ? (pairsBlocked ? null : c.href ? <Link className="mt-2 inline-block underline text-amber-300 text-xs" href={c.href}>Open Coin vs Coin →</Link> : <p className="mt-2 text-xs text-neutral-500">Coin vs Coin — not built yet</p>)
                    : c.picker ? <div className="mt-2 space-y-1">
                      <button data-decision="what" data-first-result={ci === firstActionable ? "" : undefined} className="rounded bg-amber-400 px-3 py-1 text-xs font-medium text-neutral-950" aria-expanded={outPick?.id === c.id} onClick={() => setOutPick(outPick?.id === c.id ? null : { id: c.id, q: "" })}>{outPick?.id === c.id ? "Close the list" : `Pick a ${c.picker.noun === "outcome" ? "name" : c.picker.noun} →`}</button>
                      {outPick?.id === c.id && <div className="rounded border border-neutral-700 p-2" aria-label="outcome picker">
                        <label className="block text-xs text-neutral-400">Find a {c.picker.noun === "outcome" ? "name" : c.picker.noun}<FieldHelp id="outcome-search" /><input data-decision="what" data-help="outcome-search" autoFocus className={input + " mt-1"} value={outPick.q} onChange={(e) => setOutPick({ id: c.id, q: e.target.value })} placeholder={`type part of the ${c.picker.noun === "outcome" ? "name" : c.picker.noun}'s name`} /></label>
                        <ul className="mt-1 max-h-56 overflow-y-auto divide-y divide-neutral-800">{c.picker.outcomes.filter((o) => !outPick.q.trim() || fold(o.label).replace(/ /g, "").includes(fold(outPick.q).replace(/ /g, ""))).map((o) => (
                          <li key={o.conditionId}><button data-decision="what" className="flex w-full items-center justify-between gap-2 py-1 text-left text-xs hover:text-amber-300" onClick={() => applyOutcome(c, o)}><span>{o.label}</span><span className="font-mono text-neutral-500">${o.ticker}</span></button></li>
                        ))}</ul>
                        <p className="mt-1 text-[11px] text-neutral-500">Each name is its own yes/no market; your coin burns once if the one you pick wins.</p>
                      </div>}
                    </div>
                    : (c.rule || c.matchup) ? <button data-decision="what" data-first-result={ci === firstActionable ? "" : undefined} disabled={!!cardBlocked(c)} title={cardBlocked(c) ?? undefined} className="mt-2 rounded bg-amber-400 px-3 py-1 text-xs font-medium text-neutral-950 disabled:opacity-40" onClick={() => applySuggestion(c, wi)}>Use this →</button>
                    : <button data-decision="what" className="mt-2 rounded border border-neutral-700 px-3 py-1 text-xs text-neutral-500" disabled>Use this</button>}
                </li>
              </Fragment>); })}
            </ul>
          )}
          {ures && ures.cards.length === 0 && !ubusy && (
            <div className="rounded-lg border border-dashed border-neutral-700 p-3 text-sm text-neutral-400">There is no close match. Try one of these categories: {(ures.categories ?? []).map((c) => <button data-decision="what" key={c.id} className="ml-2 underline" onClick={() => { begin("browse"); setCat(c.id); }}>{c.label}</button>)}</div>
          )}
        </section>
      )}

      {step === "choose" && (
        <section className="space-y-3" aria-label="What do you want to launch?">
          <h2 className="text-lg font-medium">…or start from one of these</h2>
          {pairNotice && <p className="rounded border border-amber-400/50 p-2 text-xs text-amber-300" role="status" data-pair-notice>{pairNotice} {site.pairs.detail}</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            {([
              ["team", "Team coin", "Any team in any league — baseball, basketball, hockey, soccer, football. It burns on every win this season. For losses, type “… lose” in the box above.", "For example, $RAYS26, $ARSENAL or $OILERS"],
              ["pair", "Matchup", "Two teams, two separate coins. Each coin burns itself when its own team loses, and no SOL moves between them.", "For example, $LAKERS vs $CELTICS"],
              ["browse", "Any result", "Natural disasters, elections, the economy, space or culture. Pick a category, then a source.", "For example, the national debt, Denver's high or a Senate race"],
            ] as const).map(([f, title, body, eg]) => { const pairTile = f === "pair" && !!pairsBlocked; const why = f === "team" ? typeBlocked("team") : f === "pair" ? pairsBlocked ?? typeBlocked("matchup") : null; return (
              <div key={f} className={`rounded-xl border border-neutral-800 bg-neutral-900 ${why ? "opacity-60" : ""}`} data-tile={f} data-unavailable={why ? "" : undefined}>
                <button data-decision="what" disabled={!!why} aria-describedby={why ? `tile-${f}-why` : undefined} onClick={() => begin(f)} className="w-full text-left rounded-xl p-5 hover:border-amber-400 focus:outline focus:outline-amber-400 disabled:cursor-not-allowed">
                  <div className="text-lg font-semibold">{title}</div>
                  <p className="mt-1 text-sm text-neutral-300">{body}</p>
                  <p className="mt-3 text-xs text-neutral-500">{eg}</p>
                </button>
                {pairTile ? <div className="px-5 pb-4">{pairsWhy(`tile-${f}-why`)}</div> : why && <p id={`tile-${f}-why`} className="px-5 pb-4 text-xs text-amber-300">{why}</p>}
              </div>
            ); })}
            <CoinVsCoinTile pairCurve={venues.pairCurve === true} customImages={customImages} blocked={walletBlocked("derby", true)} unavailable={pairsBlocked ?? typeBlocked("derby")} unavailableDetail={pairsBlocked ? site.pairs.detail : null} />
          </div>
          <p className="text-xs text-neutral-500"><Link className="underline" href="/burnticker/templates">Start with one of {TEMPLATES.length} templates.</Link></p>
        </section>
      )}
      </div>
      </details>
      )}

      {/* ---------------------------------------------------------------- TEAM COIN ---------------------------------------------------------------- */}
      {flow === "team" && step === "team" && (
        <section className="space-y-4">
          {leagueFolded}
          {leagueSeries && (
            <div className={card + " space-y-3"}>
              <div className="flex items-center justify-between gap-2 flex-wrap"><h2 className="font-medium outline-none" tabIndex={-1} data-step-heading>{whichHeading("team")}</h2><FieldHelp id="team-search" /><input data-decision="what" data-help="team-search" aria-label="Search teams in this league" className={input + " w-full sm:w-64"} placeholder={teams.length ? `${teams.slice(0, 3).map((t) => t.nickname ?? t.name).join(", ")}…` : "Type a team name"} value={teamQ} onChange={(e) => setTeamQ(e.target.value)} /></div>
              {teamsBusy && <p className="text-sm text-neutral-500">Loading teams…</p>}
              {!teamsBusy && !teams.length && <p className="text-sm text-neutral-500">No teams found for this league right now.</p>}
              <div className="grid gap-2 sm:grid-cols-2">{teams.filter(teamFilter).map((t) => (
                <button data-decision="what" key={t.abbr} aria-label={t.name} aria-pressed={team?.abbr === t.abbr} onClick={() => chooseTeam(t)} className={`flex items-center gap-3 rounded-lg border p-2 text-left hover:border-amber-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 ${team?.abbr === t.abbr ? "border-amber-400" : "border-neutral-800"}`}>
                  {badge(t.abbr)}
                  <div className="min-w-0"><div className="font-medium truncate">{t.name}</div><div className="text-xs text-neutral-400">{t.recordText ? `${record(t)} this season` : ""}{t.next ? ` · next: ${t.next.opponent ? `vs ${t.next.opponent}` : t.next.title}, starts ${denver(t.next.expectedAt)}` : scheduleNote ? ` · ${NEXT_GAME_UNAVAILABLE}` : ""}</div>{t.seasonWarning && <div className="text-xs text-amber-300" data-season-warning>{t.seasonWarning}</div>}</div>
                </button>
              ))}</div>
              <p className="text-xs text-neutral-500"><span className="bt-chip bt-chip-feed mr-1">on-chain payout · league&apos;s official feed</span>Each game settles on {SPORTS_PROVENANCE.settlement}. {sportsConfirmationLine()} Next games come from {SPORTS_PROVENANCE.schedule}. Times are in Denver time.</p>
            </div>
          )}
          {navRow(null)}
        </section>
      )}

      {/* ---------------------------------------------------------------- MATCHUP PAIR ---------------------------------------------------------------- */}
      {flow === "pair" && step === "pick" && guide.follow === "rivalry" && (
        <section className="space-y-4" data-rivalry-teams>
          {leagueFolded}
          {leagueSeries && (() => {
            // items 154 and 156: every listed meeting of the two teams, each its own choice; a failed schedule read says so, with Retry
            const meets = rivalA && rivalB ? meetingsOf(games, rivalA.abbr, rivalB.abbr) : [];
            const schedFailed = !gamesBusy && scheduleNote === NEXT_GAME_UNAVAILABLE && !games.length;
            const list = (exclude: string | null, onPick: (t: Team) => void, label: string) => (
              <div className={card + " space-y-2"} data-team-list={label}>
                <div className="flex items-center justify-between gap-2 flex-wrap"><h2 className="font-medium">{label}</h2><FieldHelp id="team-search" /><input data-decision="what" data-help="team-search" aria-label={`Search teams for the ${label.toLowerCase()}`} className={input + " w-full sm:w-64"} placeholder={teams.length ? `${otherTeams(teams, exclude).slice(0, 3).map((t) => t.nickname ?? t.name).join(", ")}…` : "Type a team name"} value={teamQ} onChange={(e) => setTeamQ(e.target.value)} /></div>
                {teamsBusy && <p className="text-sm text-neutral-500">Loading teams…</p>}
                <div className="grid gap-2 sm:grid-cols-2">{otherTeams(teams, exclude).filter(teamFilter).map((t) => (
                  <button data-decision="what" key={t.abbr} data-team={t.abbr} aria-label={t.name} onClick={() => { setTeamQ(""); onPick(t); }} className="flex items-center gap-3 rounded-lg border border-neutral-800 p-2 text-left hover:border-amber-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400">{badge(t.abbr)}<span className="min-w-0 truncate font-medium">{t.name}</span></button>
                ))}</div>
              </div>
            );
            const picked = (t: Team, label: string, clear: () => void) => <p className="text-sm text-neutral-300" data-picked={label}>{label}: <span className="font-medium text-neutral-100">{t.name}</span>. <button type="button" data-decision="what" className="underline" onClick={clear}>Change</button></p>;
            // item 155: changing the first team keeps a valid second team (it is only cleared when it is the team now picked first)
            const pickFirst = (t: Team) => { setRivalA(t); setGameQ(t.nickname ?? t.name); if (rivalB?.abbr === t.abbr) { setRivalB(null); setRivalNote(RIVAL_SAME_TEAM); } else setRivalNote(null); };
            return (<>
              {rivalA ? picked(rivalA, "First team", () => { setRivalA(null); setRivalNote(null); }) : list(rivalB?.abbr ?? null, pickFirst, "First team")}
              {rivalNote && <p className="text-xs text-amber-300" role="status" data-rival-note>{rivalNote}</p>}
              {rivalA && (rivalB ? picked(rivalB, "Second team", () => setRivalB(null)) : list(rivalA.abbr, setRivalB, "Second team"))}
              {rivalA && rivalB && (<>
                <p className="text-xs text-neutral-400" data-rivalry-scope>{RIVALRY_SCOPE_LINE}</p>
                <div className="grid gap-2 sm:grid-cols-2" data-rivalry-mode>
                  <div className="rounded-lg border border-neutral-800 p-3 text-left" data-rivalry-games>
                    <span className="block font-medium">{RIVALRY_GAME_LABEL}</span>
                    <span className="mt-0.5 block text-xs text-neutral-300">{RIVALRY_GAME_LINE}</span>
                    {gamesBusy ? <span className="mt-1 block text-xs text-neutral-400">Looking for their games.</span>
                      : schedFailed ? <span className="mt-1 block text-xs text-amber-300" role="status" data-schedule-unavailable>{SCHEDULE_UNAVAILABLE_LINE} <button type="button" data-nav className="underline" onClick={() => setGamesRetry((n) => n + 1)}>Retry</button></span>
                      : meets.length === 0 ? <span className="mt-1 block text-xs text-neutral-400" data-no-meeting>{NO_LISTED_MEETING_LINE}</span>
                      : <span className="mt-1 flex flex-wrap gap-2">{meets.slice(0, 6).map((m) => <button key={m.eventTicker} type="button" data-decision="what" data-meeting={m.eventTicker} onClick={() => chooseRivals(rivalA, rivalB, "game", m)} className="rounded-full border border-neutral-700 px-3 py-1 text-xs hover:border-amber-400">{denver(m.expectedAt)}</button>)}</span>}
                    {!gamesBusy && !schedFailed && <span className="mt-1 block text-[11px] text-neutral-500" data-schedule-source>{scheduleCoverageLine(meets.length)}</span>}
                  </div>
                  <button type="button" data-decision="what" onClick={() => chooseRivals(rivalA, rivalB, "season")} className="rounded-lg border border-amber-400 p-3 text-left">
                    <span className="block font-medium">{RIVALRY_SEASON_LABEL}</span>
                    <span className="mt-0.5 block text-xs text-neutral-300">{RIVALRY_SEASON_LINE}</span>
                  </button>
                </div>
              </>)}
            </>);
          })()}
          {navRow(null)}
        </section>
      )}
      {flow === "pair" && step === "pick" && guide.follow !== "rivalry" && (
        <section className="space-y-4">
          {leagueFolded}
          {leagueSeries && (
            <div className={card + " space-y-3"}>
              <div className="flex items-center justify-between gap-2 flex-wrap"><h2 className="font-medium">2. Pick the game</h2><FieldHelp id="game-search" /><input data-decision="what" data-help="game-search" aria-label="Search games by team" className={input + " w-full sm:w-64"} placeholder="search a team: Lakers, Oilers, Arsenal…" value={gameQ} onChange={(e) => setGameQ(e.target.value)} /></div>
              {gamesBusy && <p className="text-sm text-neutral-500">Loading games…</p>}
              {!gamesBusy && !games.length && <p className="text-sm text-neutral-500">{scheduleNote ? NEXT_GAME_UNAVAILABLE : <>No upcoming games{gameQ ? ` matching “${gameQ}”` : ""}.</>}</p>}
              <ul className="divide-y divide-neutral-800">{games.map((g) => (
                <li key={g.eventTicker}><button data-decision="what" onClick={() => { markOrigin("matchup"); setSrcWarnings([]); chooseGame(g); }} className="flex w-full items-center gap-3 py-2 text-left hover:bg-neutral-800/40">
                  {badge(g.pair!.a.abbr)}<span className="text-neutral-500 text-xs">vs</span>{badge(g.pair!.b.abbr)}
                  <span className="min-w-0"><span className="block font-medium truncate">{g.pair!.a.name} vs {g.pair!.b.name}</span><span className="block text-xs text-neutral-400">starts {denver(g.expectedAt)}, result after the final{g.pair!.tieMarket ? " · this league has draws" : ""}{g.refused.length ? ` · ${refusedLine(g.refused)}` : ""}</span></span>
                </button></li>
              ))}</ul>
            </div>
          )}
          {navRow(null)}
        </section>
      )}

      {/* ---------------------------------------------------------------- ANY MARKET ---------------------------------------------------------------- */}
      {flow === "single" && step === "pick" && (
        <section className="space-y-4">
          <div className={card + " space-y-3"}>
            <h2 className="font-medium outline-none" tabIndex={-1} data-step-heading>{whichHeading("market")}</h2>
            <FieldHelp id="market-search" /><input data-decision="what" data-help="market-search" aria-label="Search markets by name" className={input + " text-base py-2"} placeholder="a team, a player, a person, a show, a city, an election…" value={q2} onChange={(e) => setQ2(e.target.value)} />
            {findBusy && <p className="text-sm text-neutral-500">Searching…</p>}
            {found && (() => {
              const evs = (
                <div key="events" className="space-y-2">{found.events.length > 0 && <h3 className="text-xs uppercase tracking-wide text-neutral-500">Games and events{chip("kalshi")}</h3>}{found.events.map((e) => (
                  <div key={e.eventTicker} className="rounded border border-neutral-800 p-2">
                    <div className="text-sm font-medium">{e.title} <span className="text-xs text-neutral-500">{e.subTitle ?? ""} · result ~{denver(e.expectedAt)}</span></div>
                    {e.refused.length > 0 ? <p className="text-xs text-red-400">{refusedLine(e.refused)}</p> : <>
                      {e.pair && (pairsBlocked ? <p className="mt-1 text-xs text-amber-300" data-pairs-blocked>{pairsBlocked}</p> : <button data-decision="what" className="mt-1 text-xs underline text-amber-300" onClick={() => { markOrigin("exact"); chooseGame(e); }}>Make a matchup pair from this game →</button>)}
                      <ul className="mt-1 text-xs text-neutral-400 space-y-0.5">{e.markets.slice(0, 12).map((m) => <li key={m.ticker} className="flex items-center justify-between gap-2"><span><code>{m.suffix}</code> {m.label}</span><button data-decision="what" className="underline" onClick={() => { markOrigin("exact"); setPick({ oracle: "kalshi", series: null, market: m.ticker, title: `${e.title} — ${m.label} (resolves once)` }); setKind("binary"); setOnYes(DEFAULT_SHARE.oneShot); next(); }}>burn on this market →</button></li>)}</ul>
                    </>}
                  </div>
                ))}</div>
              );
              const ser = (
                <div key="series" className="space-y-1">{found.results.length > 0 && <h3 className="text-xs uppercase tracking-wide text-neutral-500">Recurring series (every future market){chip("kalshi")}</h3>}{found.results.map((h) => (
                  <div key={h.ticker} className="flex items-start justify-between gap-2 py-1"><div><div className="text-sm"><code>{h.ticker}</code> {h.title}</div><div className="text-xs text-neutral-500">{h.category} · {h.frequency ?? "—"}{h.refused.length ? ` · ${refusedLine(h.refused)}` : ""}</div></div>
                    {h.refused.length === 0 && <button data-decision="what" className="text-xs underline" onClick={() => { markOrigin("exact"); setPick({ oracle: "kalshi", series: h.ticker, market: null, title: h.title }); next(); }}>every market →</button>}</div>
                ))}</div>
              );
              const pm = polyFound;
              const poly = pm && (
                <div key="polymarket" className="space-y-2">
                  {(pm.events.length > 0 || pm.markets.length > 0) && <h3 className="text-xs uppercase tracking-wide text-neutral-500">Events and markets{chip("polymarket")}</h3>}
                  {pm.markets.map((m) => <div key={m.conditionId} className="flex items-center justify-between gap-2 rounded border border-neutral-800 p-2 text-sm"><span>{m.question} <span className="text-xs text-neutral-500">YES = {m.yes}, NO = {m.no}</span></span><button data-decision="what" className="text-xs underline disabled:no-underline disabled:opacity-50" disabled={m.closed} onClick={() => pickPoly(m)}>{m.closed ? "closed" : "burn on this market →"}</button></div>)}
                  {pm.events.map((e) => (
                    <div key={e.slug} className="rounded border border-neutral-800 p-2">
                      <div className="text-sm font-medium">{e.title}{chip("polymarket")} <span className="text-xs text-neutral-500">market closes around {denver(e.endDate)}</span></div>
                      {e.refused.length > 0 ? <p className="text-xs text-red-400">{refusedLine(e.refused)}</p> : <>
                        {/* one outcome = one yes/no market (the owner's Best Picture case): pick a name; "every market" is Advanced only */}
                        {/* owner, 2026-10-12 ("difficult to tell which 'burn if this one wins' matched the 76ers, too much dead space in between"): the
                            whole row is the button, lit on hover and focus, so the name and its action read as one line */}
                        <ul className="mt-1 text-xs text-neutral-400">{e.markets.map((m) => <li key={m.conditionId}><button type="button" data-decision="what" disabled={m.closed} onClick={() => pickPoly(m)} className="group flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left hover:bg-neutral-800 hover:text-neutral-100 focus-visible:bg-neutral-800 focus-visible:text-neutral-100 disabled:opacity-50 disabled:hover:bg-transparent"><span className="min-w-0 truncate">{m.outcome ?? m.question}{m.outcome ? null : <span className="text-neutral-500"> (YES = {m.yes}, NO = {m.no})</span>}</span><span className="shrink-0 underline group-disabled:no-underline">{m.closed ? "closed" : m.outcome ? "burn if this one wins →" : "burn on this market →"}</span></button></li>)}</ul>
                        {e.marketCount > e.markets.length && <p className="mt-1 text-[11px] text-neutral-500">Showing {e.markets.length} of {e.marketCount}. Type the name you want in the search box above to find it.</p>}
                      </>}
                    </div>
                  ))}
                  {polyErr && <p className="text-xs text-neutral-500">Polymarket is not answering right now ({polyErr}).</p>}
                </div>
              );
              const none = !found.events.length && !found.results.length && !(pm && (pm.events.length || pm.markets.length));
              return <div className="space-y-4">{found.ranking === "events" ? [evs, ser] : [ser, evs]}{poly}{none && <p className="text-sm text-neutral-500">Nothing matches “{q2}”. Try a person&apos;s last name, a race, a show — or Browse.</p>}<p className="text-xs text-neutral-500">Markets found here settle on Polymarket&apos;s on-chain payout. Prediction markets only help you find events. {sportsProvenanceLine()}</p></div>;
            })()}
          </div>
          {navRow(null)}
        </section>
      )}

      {/* ---------------------------------------------------------------- BROWSE (venue-agnostic) ---------------------------------------------------------------- */}
      {flow === "browse" && step === "pick" && (
        <section className="space-y-3">
          <div className="grid gap-4 md:grid-cols-[200px_minmax(0,1fr)]">
            {guide.pairKind !== "candidates" && <nav aria-label="Categories" role="tablist" className="bt-tabs md:flex-col md:overflow-visible">
              {cats.map((c) => <button data-decision="what" key={c.id} role="tab" aria-selected={cat === c.id} className={`bt-tab md:text-left md:rounded-md${cat === c.id ? " is-active" : ""}`} onClick={() => { setCat(c.id); setDrill(null); }} title={c.blurb}>{c.label}</button>)}
              {!cats.length && <span className="text-sm text-neutral-500">Loading categories…</span>}
            </nav>}
            <div className="min-w-0 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm text-neutral-400 flex-1 min-w-0">{cats.find((c) => c.id === cat)?.blurb ?? ""}</p>
                <FieldHelp id="browse-filter" /><input data-decision="what" data-help="browse-filter" className={input + " w-full sm:w-64"} placeholder="filter this category…" value={bq} onChange={(e) => setBq(e.target.value)} aria-label="Filter sources" />
              </div>
              {/* WIRING-SEMANTICS item 115: what the filter ignores */}
              <p className="text-[11px] text-neutral-500" data-filter-help>{edgeCase(115)}</p>
              {curCat?.adjudicatedOnly && <p className="rounded border border-dashed border-neutral-700 p-2 text-xs text-neutral-400">No first-party source qualifies for this category. So only settled Polymarket markets are listed, and each one settles on Polymarket&apos;s on-chain payout.</p>}
              {curCat?.guided === "elections" && venues.polymarket && (
                <div className={card + " space-y-3"} aria-label="Elections">
                  <h3 className="font-medium">Pick a race</h3>
                  <div className="flex flex-wrap items-center gap-2"><FieldHelp id="race-type" />{etypes.map((t) => <button data-decision="what" key={t.id} aria-pressed={etype === t.id} className={`bt-tab${etype === t.id ? " is-active" : ""}`} onClick={() => { setEtype(t.id); setEstate(null); }}>{t.label} <span className="bt-tab-count">{t.races}</span></button>)}{!etypes.length && (etypesErr ? <span className="text-xs text-red-400">{etypesErr}</span> : <span className="text-xs text-neutral-500">Loading races…</span>)}</div>
                  {etype && etype !== "control" && <label className="block text-sm">State <FieldHelp id="race-state" /><select data-decision="what" data-help="race-state" className={input + " inline w-56 ml-1"} value={estate ?? ""} onChange={(e) => setEstate(e.target.value || null)}><option value="">choose a state…</option>{estates.map((x) => <option key={x.abbr} value={x.abbr}>{x.name} ({x.races})</option>)}</select></label>}
                  {ebusy && <p className="text-xs text-neutral-500">Loading…</p>}
                  {eraces?.length === 0 && <p className="text-xs text-neutral-500">No open race listed here.</p>}
                  {eraces?.map((r) => (
                    <div key={r.slug} className="rounded border border-neutral-800 p-2 text-sm">
                      <div className="font-medium">{r.title}{r.settlesOn ? <span className="text-xs text-neutral-500"> · settles {r.settlesOn}</span> : null}</div>
                      <div className="text-xs text-neutral-500">Settled by: {r.settlement} — <a className="underline" href={r.sos.url} rel="noopener" target="_blank">{r.sos.name}</a>{r.hiddenPlaceholders ? `. ${r.hiddenPlaceholders === 1 ? "One unnamed placeholder outcome is" : `${r.hiddenPlaceholders} unnamed placeholder outcomes are`} hidden.` : ""}</div>
                      {r.refused.length ? <p className="text-xs text-red-400">{refusedLine(r.refused)}</p> : <ul className="mt-1 space-y-1">{r.outcomes.map((o) => (
                        <li key={o.conditionId} className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-medium">{o.label}</span>
                          {guide.pairKind === "candidates"
                            ? <button data-decision="what" className={`text-xs underline ${esel.includes(o.conditionId) ? "text-neutral-100" : "text-amber-300"}`} aria-pressed={esel.includes(o.conditionId)} onClick={() => setEsel((xs) => (xs.includes(o.conditionId) ? xs.filter((x) => x !== o.conditionId) : [...xs.filter((x) => r.outcomes.some((y) => y.conditionId === x)), o.conditionId].slice(-2)))}>{esel.includes(o.conditionId) ? "Picked" : "Pick"}</button>
                            : <button data-decision="what" className="text-xs underline text-amber-300" onClick={() => {
                            // intent audit 2 item 5: the coin's sentence comes from the market's own question; a party market is said as one
                            const sur = o.label.replace(/\s*\([A-Z]\)$/, "").trim().split(/\s+/).pop() ?? o.label, phrase = o.question.replace(/^will\s+/i, "").replace(/\?$/, "");
                            const tk = sur.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
                            markOrigin("browse"); setSrcWarnings(fold(o.question).includes(fold(sur)) ? [] : [`$${tk} settles on the market "${o.question}". That market is about the party's result, not ${sur} by name.`]);
                            setEventInfo({ question: o.question, url: r.url, outcome: `“${o.yes}”`, resolves: r.settlesOn, criteria: r.description, certified: r.settlement.replace(/^.*checked against /, "") });
                            applyRule(o.rule, { oracle: "polymarket", series: null, market: o.conditionId, title: `${phrase} (resolves once)`, yes: o.yes, no: o.no }, { name: `${sur} Wins`, ticker: tk, how: `${o.settles}${r.description ? `\n\nResolution rules (Polymarket): ${r.description}` : ""}`, settlement: `${r.settlement}, ${r.sos.name}` }); }}>Use: {o.label} wins →</button>}
                        </li>
                      ))}</ul>}
                      {guide.pairKind === "candidates" && !r.refused.length && (r.outcomes.length < 2
                        ? <p className="mt-1 text-xs text-amber-300" data-one-market>This race has one market only, so it cannot make a pair.</p>
                        : esel.filter((x) => r.outcomes.some((o) => o.conditionId === x)).length === 2 && <button data-decision="what" className="mt-2 rounded bg-amber-400 px-3 py-1 text-xs font-medium text-neutral-950" onClick={() => startElPair(r)}>Use these two</button>)}
                      {r.description && <details className="mt-1 text-xs text-neutral-400"><summary className="cursor-pointer">How this settles</summary><p className="mt-1 whitespace-pre-wrap">{r.description}</p></details>}
                    </div>
                  ))}
                </div>
              )}
              {guide.pairKind !== "candidates" && <>
              {cardsBusy && <p className="text-sm text-neutral-500">Loading sources…</p>}
              {bq.trim() && <p className="text-xs text-neutral-400" data-active-filter>Showing {cats.find((c) => c.id === cat)?.label ?? cat} sources matching “{bq.trim()}”. <button type="button" data-nav className="underline" onClick={() => setBq("")}>Show all in this category</button></p>}
              {!cardsBusy && cards && cards.length === 0 && <div className="rounded border border-dashed border-neutral-700 p-4 text-sm text-neutral-400" data-empty-filter><p>This site has no source in this category{bq ? ` matching “${bq}”` : ""} yet.</p>{bq.trim() && <p className="mt-2 flex flex-wrap gap-3"><button type="button" data-nav className="underline" onClick={() => setBq("")}>Clear the filter</button><button type="button" data-nav className="underline" onClick={() => { setUq(bq.trim()); setGuide({ follow: null, phase: "follow", pairKind: null }); setStep("choose"); setClassicOpen(true); }}>Search all sources for “{bq.trim()}”</button></p>}</div>}
              <div className={`grid gap-2 lg:grid-cols-2${cardsBusy ? " opacity-50" : ""}`} aria-busy={cardsBusy}>{/* snag 18: a source this host has no key for is not listed at all */}{(cards ?? []).filter((c) => c.launchable.ok || !/needs a key|API_KEY|not configured|licen[cs]ed key/i.test(c.launchable.why ?? "")).map((c) => (
                <div key={c.id} className={`rounded-lg border p-3 text-sm ${c.launchable.ok ? "border-neutral-800 bg-neutral-900" : "border-neutral-900 opacity-70"}`}>
                  <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
                    <span className={`bt-chip bt-chip-${c.venue}`}>{c.venue === "feed" ? "Feed" : c.venueLabel}</span>
                    <span className="text-neutral-500">{c.tierLabel}</span>
                    <span className="ml-auto text-neutral-500">{c.kind === "scalar" ? "a number" : "yes / no"}</span>
                  </div>
                  <div className="mt-1 font-medium leading-snug">{c.title}</div>
                  <div className="text-xs text-neutral-500">{c.venue === "feed" ? c.sourceName : ""}{c.cadence ? `${c.venue === "feed" ? " · " : ""}${c.cadence}` : ""}</div>
                  <div className="mt-1 text-xs text-neutral-300">{c.example}</div>
                  {c.settlement && <div className="text-xs text-neutral-400" data-source-settlement>{c.settlement}</div>}
                  {c.paramNote && <div className="text-xs text-neutral-500" data-param-note>{c.paramNote}</div>}
                  {c.outcomes && c.outcomes.length > 0 && <ul className="mt-1 space-y-0.5 text-xs" data-card-outcomes>{c.outcomes.map((o) => <li key={o.market} className="flex justify-between gap-2"><span>{o.question}</span><button type="button" data-decision="what" className="underline text-amber-300" onClick={() => { markOrigin("browse"); setSrcWarnings([]); setShareNotice(null); setPick({ oracle: "polymarket", series: null, market: o.market, title: o.question }); setKind("binary"); setOnYes(DEFAULT_SHARE.oneShot); setFilter(""); next(); }}>burn on this one →</button></li>)}</ul>}
                  {c.next && <div className="text-xs text-neutral-500">{c.next.at ? `${c.next.label} · ${denver(c.next.at)}` : c.next.label}</div>}
                  {c.refused.length > 0 && <div className="text-xs text-red-400">{refusedLine(c.refused)}</div>}
                  <div className="mt-2 flex flex-wrap gap-3 text-xs">
                    {c.configure?.kind === "team" ? <button data-decision="what" disabled={cardsBusy} className="underline text-amber-300 disabled:opacity-50" onClick={() => { const lg = c.configure!.kind === "team" ? c.configure!.league : null; begin("team"); setTimeout(() => setLeagueSeries(lg), 0); }}>pick a team →</button>
                    : c.configure?.kind === "weather" ? <button data-decision="what" disabled={cardsBusy} className="underline text-amber-300 disabled:opacity-50" onClick={() => setWx({ metric: c.configure!.kind === "weather" ? c.configure!.metric : "high", station: "DEN", threshold: c.configure!.kind === "weather" && c.configure!.metric === "rain" ? "0.50" : "90" })}>choose a station →</button>
                    : c.launchable.ok && c.pick.oracle === "polymarket" && !c.pick.market ? <button data-decision="what" disabled={cardsBusy} className="underline text-amber-300 disabled:opacity-50" data-pick-outcome onClick={() => { setGuide((g) => ({ follow: g.follow ? "market" : null, phase: g.follow ? "which" : g.phase, pairKind: null })); begin("single"); setQ2(c.title.replace(/\s*\(\d+ markets?\)\s*$/i, "")); }}>pick one outcome →</button>
                    : c.launchable.ok ? <button data-decision="what" disabled={cardsBusy} className="underline text-amber-300 disabled:opacity-50" onClick={() => {
                      const src = c.pick.oracle === "catalogue" ? sources.find((x) => x.id === c.pick.series) : undefined;
                      markOrigin("browse"); setSrcWarnings([]); setShareNotice(null);
                      setPick({ ...c.pick, source: src }); setFilter(""); setKind(c.kind);
                      if (c.kind === "scalar" && c.pick.oracle === "kalshi") { setUnit(1); setDirection("up"); setBaseline("previousSettlement"); }
                      next();
                    }}>use this source →</button> : <span className="text-neutral-500" data-source-unavailable>{/^This one-time event already has its result/.test(c.launchable.why ?? "") ? c.launchable.why : sourceUnavailableLine(c.launchable.why)}{(c.launchable.why || c.diagnostics?.length) && <details className="mt-1"><summary className="cursor-pointer">Details</summary><span className="block">{edgeCase(117)}</span><span className="break-words font-mono">{[c.launchable.why, ...(c.diagnostics ?? [])].filter(Boolean).join(" ")}</span></details>}</span>}
                    {c.venue === "kalshi" && !kalshiOff && <button data-decision="what" className="underline" onClick={() => setDrill(drill === c.pick.series ? null : c.pick.series)}>{drill === c.pick.series ? "hide events" : "next events"}</button>}
                    {c.sourceUrl && <a className="underline text-neutral-400" href={c.sourceUrl} rel="noopener" target="_blank">source ↗</a>}
                  </div>
                  {wx && c.configure?.kind === "weather" && c.configure.metric === wx.metric && (() => {
                    // L07: the threshold is validated where it is typed; the button says why it is disabled (linked to the field)
                    const thrErr = wx.metric === "snow" ? null : wxThresholdProblem(wx.metric, wx.threshold);
                    const sid = `wx-station-${wx.metric}`, tid = `wx-threshold-${wx.metric}`;
                    return (
                    <div className="mt-2 border-t border-neutral-800 pt-2 text-xs space-y-2">
                      <div><label htmlFor={sid}>Station</label> <FieldHelp id="nws-station" /><select id={sid} data-decision="what" data-help="nws-station" className={input + " inline w-full sm:w-56 sm:ml-1"} value={wx.station} onChange={(e) => setWx({ ...wx, station: e.target.value })}>{STATIONS.map((x) => <option key={x.code} value={x.code}>{x.label} ({x.code})</option>)}</select></div>
                      {wx.metric !== "snow" && <div><label htmlFor={tid}>{wx.metric === "high" ? "Burn on days whose high reaches this many °F" : "Burn on days with at least this many inches of rain"}</label> <FieldHelp id="nws-threshold" /><input id={tid} data-decision="what" data-help="nws-threshold" inputMode="decimal" aria-invalid={!!thrErr} aria-describedby={thrErr ? `${tid}-err` : undefined} className={input + " inline w-24 ml-1"} value={wx.threshold} onChange={(e) => setWx({ ...wx, threshold: e.target.value })} />{thrErr && <span id={`${tid}-err`} className="block text-red-400">{thrErr}</span>}</div>}
                      <button data-decision="what" className="underline text-amber-300 disabled:text-neutral-500 disabled:no-underline" disabled={!!thrErr} aria-describedby={thrErr ? `${tid}-err` : undefined} onClick={() => { if (thrErr) return; const thr = wx.metric === "snow" ? null : Number(wx.threshold); const series = nwsSeries(wx.metric, wx.station, thr); const st = STATIONS.find((x) => x.code === wx.station)!; markOrigin("browse"); applyRule(firstPartyRule(series, DEFAULT_SHARE.recurring), { oracle: "catalogue", series, market: null, title: `${st.city} ${wx.metric === "high" ? `daily high ≥ ${thr} °F` : wx.metric === "rain" ? `rain day ≥ ${Number(thr).toFixed(2)} in` : "first snow of the season"} (NWS)` }, { name: `${st.city} ${wx.metric === "high" ? "Heat" : wx.metric === "rain" ? "Rain" : "Snow"}`, ticker: `${st.code}${wx.metric === "high" ? "HOT" : wx.metric === "rain" ? "RAIN" : "SNOW"}`, settlement: "the National Weather Service's daily climate report, cross-checked against the Iowa Environmental Mesonet", source: weatherSource(wx.metric) }); }}>Use this rule →</button>
                      {thrErr && <span className="ml-2 text-neutral-500">Fix the threshold to continue.</span>}
                    </div>
                    );
                  })()}
                  {/* L11: a feed card's series is null, and so is "no drill open": only a real series opens the events panel */}
                  {drill !== null && drill === c.pick.series && (
                    <div className="mt-2 border-t border-neutral-800 pt-2 text-xs">
                      {drillEvents === null ? <span className="text-neutral-500">Loading events…</span> : drillErr ? <span className="text-red-400">{drillErr}</span> : drillEvents.length === 0 ? <span className="text-neutral-500">No events are open in this series right now.</span> : drillEvents.map((e) => (
                        <div key={e.eventTicker} className="py-1">
                          <div className="text-neutral-300">{e.title} <span className="text-neutral-500">· ~{denver(e.expectedAt ?? e.closeTime)}</span></div>
                          {e.refused.length ? <div className="text-red-400">{refusedLine(e.refused)}</div> : <ul className="mt-0.5 space-y-0.5 text-neutral-400">{e.markets.slice(0, 8).map((mk) => <li key={mk.ticker} className="flex justify-between gap-2"><span>{mk.label || mk.suffix}</span><button data-decision="what" className="underline" onClick={() => { markOrigin("browse"); setPick({ oracle: "kalshi", series: null, market: mk.ticker, title: `${e.title} — ${mk.label || mk.suffix} (resolves once)` }); setKind("binary"); next(); }}>this market only →</button></li>)}</ul>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}</div>
              {browseErr.length > 0 && <div className="text-xs text-neutral-500"><p>Some sources did not answer just now, so this list may be incomplete.</p><details><summary className="cursor-pointer">Details</summary><p className="break-words font-mono">{browseErr.join("; ")}</p></details></div>}
              </>}
            </div>
          </div>
          {navRow(null)}
        </section>
      )}

      {/* -------------------------------------------- REVIEW (every flow): the one screen between "what burns it" and the signature -------------------------------------------- */}
      {step === "review" && rule && (() => {
        const shareText = pct(shareValue);
        const A = sideA?.nickname ?? sideA?.name ?? "side A", B = sideB?.nickname ?? sideB?.name ?? "side B";
        const coinA = { key: "a", name, ticker, onName: (v: string) => { setName(v); setNameAuto(false); setEditedFor(subjectKey); noteEdit(); }, onTicker: (v: string) => { setTicker(v); setTickerAuto(false); setEditedFor(subjectKey); noteEdit(); }, image: profile.image ? chosenPreview(profile)! : genImg(rule, ticker, oneLiner), oneLiner, oracle: pairOn ? "catalogue" : pick?.oracle ?? "catalogue", badge: text?.badge ?? null };
        // website-18 THE TEAM PATH: league, team, this card, Launch. The card says the defaults in one sentence each (the burn on every
        // win through the postseason, then the champion and the not-champion ends); every other choice sits under one closed "Advanced"
        const teamPath = flow === "team" && !pairOn && championPathRule(rule);
        const imageField = (v: ProfileValue, set: (x: ProfileUpdate) => void, who: string | null, pasteTarget = true) => <ProfileFields key={who ?? "a"} value={v} onChange={set} part="image" who={who} customImages={customImages} pasteTarget={pasteTarget} />;
        const coins = pairOn && ruleB ? [coinA, { key: "b", name: nameB, ticker: tickerB, onName: (v: string) => { setNameB(v); setNameAuto(false); setEditedFor(subjectKey); noteEdit(); }, onTicker: (v: string) => { setTickerB(v); setTickerAuto(false); noteEdit(); }, image: profileB.image ? chosenPreview(profileB)! : genImg(ruleB, tickerB, textB?.oneLiner ?? ""), oneLiner: textB?.oneLiner ?? ruleOneLiner(ruleB), oracle: "catalogue", badge: textB?.badge ?? null }] : [coinA];
        // intent audit item 3: a two-coin sentence is read from the two rules (the fade side included), never written for the plain side
        const sentence0 = pairOn && sideA && sideB && text && textB
          ? `$${ticker || "A"} ${text.oneLiner}, and $${tickerB || "B"} ${textB.oneLiner}. Each coin spends ${shareText} of its own burn pool when its rule fires.`
          : pairOn && sideA && sideB
          ? (season ? `$${ticker} spends ${shareText} of its burn pool every time the ${A} lose this season, and $${tickerB} does the same for the ${B}. They are two separate coins with two separate records.` : `When ${game?.title ?? "the game"} is final, the coin of the team that lost spends ${shareText} of its own burn pool: $${ticker} if the ${A} lose, $${tickerB} if the ${B} lose.`)
          : rule.oracle === "polymarket" && rule.market && !pairOn && rule.kind === "binary" ? (() => { const no = !rule.binary?.onYes && !!rule.binary?.onNo, champ = ({ mlb: "World Series", nba: "NBA Finals", nhl: "Stanley Cup", nfl: "Super Bowl" } as Record<string, string>)[leagueSeries ?? ""] ?? "championship";
              return oneShotSentences({ share: shareValue, no, subject: guide.follow === "team" ? "they" : "it", happened: guide.follow === "team" && team ? `the ${team.nickname ?? team.name} ${no ? "did not win" : "won"} the ${champ}` : eventInfo?.question ? `“${eventInfo.question.replace(/\?$/, "")}” resolved ${no ? "NO" : eventInfo.outcome ?? "YES"}` : `the market resolved ${no ? "NO" : "YES"}` }).join(" "); })()
          : text ? (teamPath ? `${text.lead} ${text.windowSentence.replace(/^This coin covers [^.]*\.\s*/, "")}` : text.lead) : plainSentence(rule, ticker, pick?.title ?? bt?.seriesTitle ?? null);
        // owner, 2026-10-12: above 5 % a recurring burn lands in slices (one burn run buys with at most 2 % of the pool's SOL); said once
        const sentence = !oneShotRule && shareValue > SLICED_ABOVE && !/in slices sized/.test(sentence0) ? `${sentence0} The burn lands in slices sized to the pool's liquidity.` : sentence0;
        const problems = btFresh ? [...(bt?.refusals ?? []), ...(pairOn ? btB?.refusals ?? [] : [])].map((r) => r.reason) : [];
        // intent audit item 5: two sides a reader could not tell apart (same ticker or name, any case or spacing) cannot launch
        const identity = pairOn && ruleB ? pairIdentityProblems({ ticker, name }, { ticker: tickerB, name: nameB }) : [];
        const ready = !!name.trim() && okTicker(ticker) && (!pairOn || (!!nameB.trim() && okTicker(tickerB) && ticker !== tickerB)) && !noteProblem && identity.length === 0;
        const rv = shownReview.review as (LaunchReview & { tickers?: TickerCheck[] }) | null;
        const tieWord: "tie" | "draw" = leagues.find((l) => l.id === leagueSeries)?.draws ? "draw" : "tie";
        const facts = pairOn && sideA && sideB ? (ruleB ? (elPick ? candidateFacts({ a: ticker, b: tickerB, candA: elPick.a.label, candB: elPick.b.label }) : matchupFacts({ a: ticker, b: tickerB, oneLinerA: text?.oneLiner ?? "", oneLinerB: textB?.oneLiner ?? "", inverse: !!rule.inverse, once: pairMode === "game", teamA: `the ${A}`, teamB: `the ${B}`, tie: tieWord })) : winnerTakesBurnFacts(ticker || "A", tickerB || "B")) : null;
        // walkthrough snag 11: a one-shot due before the coin can graduate says what the keeper does with an early result
        const dueIso = pairOn && game?.expectedAt ? game.expectedAt : null;
        const notes = windowKindOf(rule) === "one-shot" ? [beforeGraduationLine(dueIso ? shortDate(dueIso) : eventInfo?.resolves ?? null)] : [];
        if (imageGone && !profile.image && !profileB.image) notes.push(IMAGE_NOT_KEPT);
        const timing = reviewCurrent ? (shownReview.review as (LaunchReview & { timing?: { dueLabel: string | null; warning: string | null; unplayed: string | null } | null }) | null)?.timing ?? null : null;
        if (timing?.dueLabel) notes.push(timing.dueLabel);
        if (timing?.unplayed) notes.push(timing.unplayed);
        if (timing?.warning) notes.push(timing.warning);
        if (!nameAuto && name.trim()) notes.push(`Keeping the name you typed, “${name}”. It stays while you set up this coin; picking a different thing to follow generates a new one. Press edit to change it.`);
        // guided step 3: the four patterns for the thing picked; guided step 4: the end, from the rule
        const curPattern: PatternId | null = guide.follow === "team" ? (flow === "single" ? "once" : rule.inverse ? "fade" : "every") : guide.follow === "rivalry" ? (elPick || pairMode === "game" ? "once" : rule.inverse ? "fade" : "every") : guide.follow === "market" ? (rule.kind === "binary" && rule.binary?.onNo && !rule.binary.onYes ? "fade" : "once") : windowKindOf(rule) === "one-shot" ? "once" : rule.inverse ? "fade" : "every";
        const pickPattern = (pt: PatternId) => {
          flowStats.current.decisions++; setPatternNotice(null);
          // audit 6 item 1: a new pattern is a new rule, so the generated name and ticker follow it (a name or ticker the creator typed stays)
          setSrcSuggest({ name: null, ticker: null });
          if (guide.follow === "team") {
            // audit 6 item 7: a tap never does nothing silently
            if (pt === "once") { if (titleCard?.card) applySuggestion(titleCard.card); else setPatternNotice(titleCard?.state === "loading" ? PATTERN_REASON.titleMarketLoading : PATTERN_REASON.noTitleMarket); return; }
            if (flow !== "team") { setFlow("team"); setPick(null); setEventInfo(null); setDraft(null); setCardCtx(null); }
            setWantInverse(pt === "fade" ? "on" : "off"); return;
          }
          if (guide.follow === "rivalry") {
            if (pt === "once") { if (rivalSeason && !rivalGame) { setPatternNotice(PATTERN_REASON.noMeeting); return; } if (rivalGame) { setGame(rivalGame); const g = rivalGame.pair; if (g && nameAuto) { const nm = pairNames(g.a.nickname ?? g.a.name, g.b.nickname ?? g.b.name); setName(nm.a); setNameB(nm.b); } if (g && tickerAuto) { const tk = pairTickers(g.a.abbr, g.b.abbr); setTicker(tk.a); setTickerB(tk.b); } } setPairMode("game"); return; }
            if (rivalSeason) setGame(rivalSeason); setPairMode("season"); if (rivalA && rivalB) renameForSeason(rivalA, rivalB); setWantInverse(pt === "fade" ? "on" : "off"); return;
          }
          if (guide.follow === "market") { setDial("side", pt === "fade" ? "no" : "yes"); return; }
          if (guide.follow === "disaster") {
            if (pt === "fade") { setDial("inverse", "on"); return; }
            const sw = rule.series ? hazardSwap(rule.series, pt === "once" ? "once" : "every", Date.now()) : null;
            if (!sw || "refused" in sw) { if (sw) setPatternNotice(sw.refused); return; }
            const title = pick?.title ?? "";
            applyRule(hazardRule(sw.series), { oracle: "catalogue", series: sw.series, market: null, title }, { settlement: settleNote });
            return;
          }
          setDial("inverse", pt === "fade" ? "on" : "off");
        };
        const budget = budgetCopy(rule, shareValue, unitPhrase(pick?.source?.unit ?? null));
        const preview = <><p>{sentence}</p>{!sentence.includes(" once, when ") && <p className="mt-1 text-xs text-neutral-300">{budget.line}</p>}</>;
        const nextBtn = (label: string, to: GuidedPhase) => <StickyAction><button type="button" data-nav className={primary + " w-full sm:w-auto"} onClick={() => setGuide((g) => ({ ...g, phase: to }))}>{label}</button></StickyAction>;
        const pairKindNow = guide.follow === "rivalry" ? (elPick ? "candidates" as const : "teams" as const) : null;
        const teamOutcome = rule.oracle === "catalogue" && rule.series ? parseEspnSeries(rule.series)?.outcome ?? null : null;
        if (guide.follow && guide.phase === "burn") {
          const po = guide.follow === "disaster" ? hazardPatternOptions(rule, Date.now()) : patternOptions({ follow: guide.follow, rule, titleMarket: titleCard?.state ?? "loading", pairKind: pairKindNow, meeting: rivalSeason ? !!rivalGame : null });
          // pass B item 12, audit 6 item 16: the patterns name the thing picked ("After each Dodgers win")
          const subject = guide.follow === "team" && team ? team.nickname ?? team.name : null;
          const options = po.options.map((o) => ({ ...o, ...patternWords(o.id, { follow: guide.follow!, subject, outcome: teamOutcome === "loss" ? "loss" : teamOutcome === "draw" ? "draw" : "win", pairKind: pairKindNow }) }));
          const drain = !oneShotRule && shareValue > SLICED_ABOVE ? drainLine(shareValue, guide.follow === "team" && team ? (teamOutcome === "loss" ? "loss" : "win") : "result") : null;
          return <PatternStep drain={drain} preview={preview} options={options} value={curPattern} onPick={pickPattern} shares={shareOptions} share={shareValue} onShare={setShare} pairLabel={pairOn && !!ruleB} math={budget.math} notice={patternNotice} next={nextBtn("Next", "name")} />;
        }
        // the end, stated on the review (the server adds the default end, with the $DEFICIT sink, to a rule sent without one)
        const end = endSentences(rule.onEnd ? rule : ({ ...rule, onEnd: { ...ON_END_DEFAULT } } as BurnRule), { team: team?.nickname ? `the ${team.nickname}` : null });
        const endLines = pairOn && ruleB ? end.sentences.map((x) => x.replace(/^(When the rule ends|When the result is in|After the last game or reading the rule covers), the rest of the pool/, "$1, the rest of each coin's pool")) : end.sentences;
        // item 53: an election coin says who decides the result (the race's certified count is the cross-check)
        const certified = elPick ? elPick.race.settlement.replace(/^.*checked against /, "") : eventInfo?.certified ?? null;
        const authority = certified ? electionAuthorityLines(certified) : null;
        // WIRING-SEMANTICS: the edge cases that apply to this rule, one tap away
        const espnKind = rule.oracle === "catalogue" && rule.series ? parseEspnSeries(rule.series)?.kind ?? null : null;
        const edgeIds: number[] = [
          ...(espnKind ? [78, 79, 80] : []), ...(pairOn && !elPick ? [76] : []), ...(elPick ? [82] : []),
          ...(rule.kind === "scalar" ? [85, 111, 87] : []), ...(rule.oracle === "catalogue" && /^nws\./.test(rule.series ?? "") ? [86, 87] : []),
          // WIRING-SEMANTICS-2: the floor, the end's destination, the fingerprint, and Polymarket's split and unresolved payouts
          164, 168, 174, ...(rule.oracle === "polymarket" ? [178, 179, 180] : []), ...(rule.oracle === "catalogue" ? [218] : []),
        ];
        const edgeNotes = [...new Set(edgeIds)].map((i) => edgeCase(i)).filter((x): x is string => !!x);
        const coinsN: 1 | 2 = pairOn && ruleB ? 2 : 1;
        const editTo = (p: GuidedPhase) => () => { if (p === "which") toWhich(); else setGuide((g) => ({ ...g, phase: p })); };
        const reviewFacts = guide.follow ? [
          { label: FACT_LABELS.trigger, value: sentence0.split(/(?<=\.)\s/)[0], edit: editTo("which") },
          { label: FACT_LABELS.coin, value: whichCoinLine(ticker || "A", coinsN === 2 ? tickerB || "B" : null), edit: editTo("name") },
          { label: FACT_LABELS.amount, value: `${budget.line} ${shareExample(shareValue)}`, edit: editTo("burn") },
          { label: FACT_LABELS.ends, value: endLines.join(" ") || PERPETUAL_END_LINE, edit: null },
          { label: FACT_LABELS.cost, value: costLine(shownReview.review && reviewCurrent ? shownReview.review.costs.totalSol : null, coinsN), edit: null },
        ] : null;
        const coinsForName = coins;
        if (guide.follow && guide.phase === "name") {
          return <ReviewCard mode="name" coins={coinsForName} sentence={sentence} ends={null} shares={{ options: [...shareOptions], value: shareValue, onChange: () => {} }} problems={[]} error={null} busy={false} ready={ready} creator={creator || null} onLaunch={() => {}}
            image={pairOn && ruleB ? <div className="grid min-w-0 gap-2 md:grid-cols-2" data-pair-images>{imageField(profile, setProfile, `$${ticker || "A"}`)}{imageField(profileB, setProfileB, `$${tickerB || "B"}`, false)}</div> : imageField(profile, setProfile, null)}
            profile={pairOn && ruleB ? <div className="grid min-w-0 gap-2 md:grid-cols-2"><ProfileFields value={profile} onChange={setProfile} part="text" who={`$${ticker || "A"}`} /><ProfileFields value={profileB} onChange={setProfileB} part="text" who={`$${tickerB || "B"}`} /></div> : <ProfileFields value={profile} onChange={setProfile} part="text" />}
            note={pairOn ? null : { value: note, onChange: setNote, problem: noteProblem }}
            tickerChecks={reviewCurrent ? rv?.tickers ?? null : null}
            profileProblems={[...linkAwareProblems(profile), ...(pairOn && ruleB ? linkAwareProblems(profileB).map((x) => `$${tickerB || "B"}: ${x}`) : []), ...identity]}
            next={nextBtn("Review", "review")} />;
        }
        return (
          <>
            <ReviewCard
              mode={guide.follow ? "review" : "full"}
              facts={reviewFacts}
              endSection={<EndSection sentences={endLines} options={end.options} />}
              authority={authority}
              edgeNotes={edgeNotes}
              upfront={upfrontLines(RAISE_PRESETS_SOL)}
              amountMath={budget.math}
              coins={coins}
              sentence={sentence}
              pairLine={pairOn && !ruleB ? PAIR_REVIEW_LINE : null}
              pairFacts={facts}
              ends={endText(rule.onEnd ? rule : ({ ...rule, onEnd: { ...ON_END_DEFAULT } } as BurnRule), { team: team?.nickname ? `the ${team.nickname}` : null }).line}
              shares={{ options: [...shareOptions], value: shareValue, onChange: setShare }}
              inverse={curDials?.inverse ? { options: curDials.inverse.options, value: curDials.inverse.on ? "on" : "off", onChange: (v) => { flowStats.current.decisions++; setDial("inverse", v); } } : null}
              raise={pairOn && !ruleB ? null : { options: [...RAISE_PRESETS_SOL], value: raiseSol, onChange: (v) => { flowStats.current.decisions++; setRaiseSol(v); }, line: shownReview.review?.raise?.line ?? null }}
              durations={pairOn && !elPick ? { options: [...(rivalSeason && !rivalGame ? [] : [{ value: "game", label: RIVALRY_GAME_LABEL.toLowerCase() }]), { value: "season", label: RIVALRY_SEASON_LABEL.toLowerCase() }], value: pairMode === "game" ? "game" : "season", onChange: (v) => { flowStats.current.decisions++; if (rivalSeason) setGame(v === "game" && rivalGame ? rivalGame : rivalSeason); setPairMode(v === "game" ? "game" : "season"); if (v !== "game" && rivalA && rivalB) renameForSeason(rivalA, rivalB); else if (v === "game" && rivalGame?.pair) { const g = rivalGame.pair; if (nameAuto) { const nm = pairNames(g.a.nickname ?? g.a.name, g.b.nickname ?? g.b.name); setName(nm.a); setNameB(nm.b); } if (tickerAuto) { const tk = pairTickers(g.a.abbr, g.b.abbr); setTicker(tk.a); setTickerB(tk.b); } } } } : null}
              note={pairOn ? null : { value: note, onChange: setNote, problem: noteProblem }}
              problems={problems}
              error={launchErr}
              busy={busy}
              ready={ready}
              creator={creator || null}
              onLaunch={() => { void launch(); }}
              duplicate={<DuplicateNotice existing={(shownReview.review as (LaunchReview & { existing?: ExistingCoin[] }) | null)?.existing ?? []} />}
              summary={<PreWalletSummary review={shownReview.review} loading={shownReview.loading} error={shownReview.error} updating={reviewSlot.rev !== reviewKey && !!reviewSlot.review} />}
              cost={shownReview.review && reviewCurrent ? `The estimated cost is about ${shownReview.review.costs.totalSol} SOL.` : null}
              image={pairOn && ruleB ? <div className="grid min-w-0 gap-2 md:grid-cols-2" data-pair-images>{imageField(profile, setProfile, `$${ticker || "A"}`)}{imageField(profileB, setProfileB, `$${tickerB || "B"}`, false)}</div> : imageField(profile, setProfile, null)}
              profile={pairOn && ruleB ? <div className="grid min-w-0 gap-2 md:grid-cols-2"><ProfileFields value={profile} onChange={setProfile} part="text" who={`$${ticker || "A"}`} /><ProfileFields value={profileB} onChange={setProfileB} part="text" who={`$${tickerB || "B"}`} /></div> : <ProfileFields value={profile} onChange={setProfile} part="text" />}
              advanced={teamPath ? { defaults: teamAdvancedDefaults({ sharePct: pct(shareValue), raiseSol: raiseSol, minForwardSol: String(ON_END_DEFAULT.sweepThresholdLamports / 1e9), profile: { image: !!profile.image, description: !!profile.description.trim(), links: [profile.x, profile.telegram, profile.website].filter((x) => x.trim()).length } }) } : null}
              profileProblems={[...linkAwareProblems(profile), ...(pairOn && ruleB ? linkAwareProblems(profileB).map((x) => `$${tickerB || "B"}: ${x}`) : []), ...identity, ...(reviewCurrent ? (shownReview.review?.problems ?? []).filter((x) => /^(Coin B\. )?The description /.test(x) || x.endsWith(RESERVED_REFUSAL) || /set of outcomes/.test(x)) : [])]}
              blocked={walletBlocked(pairOn ? "matchup" : launchTypeOf(rule), pairOn)}
              warnings={[...srcWarnings, ...(reviewCurrent ? (rv as { warnings?: string[] } | null)?.warnings ?? [] : [])]}
              shareNotice={shareNotice}
              event={flow === "single" && pick?.oracle === "polymarket" && !pairOn ? eventInfo : null}
              budget={budget}
              dispute={reviewCurrent ? rv?.dispute ?? null : null}
              graduation={rv?.graduation ?? null}
              tickerChecks={reviewCurrent ? rv?.tickers ?? null : null}
              notes={notes}
              namePrompt={!pairOn && text?.name === "Event Coin" ? "This question does not give a clear coin name: please name the coin (and check the ticker) before you launch." : null}
            />
            {/* website-15 item 4 (Claude site audit 3 item 2): a failed back-test says so in one line; the reason sits behind Details */}
            {/* WIRING-PARITY audit 6 #11: what the rule would have spent on past readings, at 1, 2 and 5 %, or why there is no projection */}
            {reviewCurrent && rv?.projection && <details className="text-xs text-neutral-300" data-projection><summary className="cursor-pointer">How much it would have spent before</summary>{rv.projection.available ? rv.projection.lines.map((x) => <p key={x} className="mt-1">{x}</p>) : <p className="mt-1">{rv.projection.reason}</p>}</details>}
            {btErr && btFor === btKey && !rv?.projection && <div className="text-xs text-amber-300" role="status" data-backtest-unavailable><p>{BACKTEST_UNAVAILABLE}</p><details className="text-neutral-500"><summary className="cursor-pointer">Details</summary><p className="break-words font-mono">{btErr}</p></details></div>}
            {/* website brief §2: the funds flow before a registered pair launches (pairs made now are winner-takes-the-burn) */}
            {pairOn && !ruleB && <PairFundsFlow version="winner-takes-the-burn" tickers={{ a: ticker || "A", b: tickerB || "B" }} open />}
            <p className="text-xs"><button className="underline" data-nav onClick={back}>← Back</button></p>
          </>
        );
      })()}

      {/* ------------------------------------- LAUNCH: sign and send (SignCard: the same component for one coin, two coins and the pair curve) ------------------------------------- */}
      {step === "launch" && (bundle || pcOut) && (() => {
        const st = signTickers ?? { a: ticker, b: tickerB };
        const plan = pcOut ? pairCurvePlan(pcOut.pc, pcOut.keys, st) : pairOut ? launchlabPlan([pairOut.a, pairOut.b]) : launchlabPlan([bundle!]);
        const two = !!(pcOut || pairOut);
        return (
          <section className="space-y-3 text-sm">
            <SignCard plan={plan} creator={creator || null} title={two ? `Launch $${st.a} and $${st.b}` : `Launch $${st.a}`} coinHref={(t) => `/burnticker/t/${t}`} />
            <p className="text-xs text-neutral-500">The drafts are registered; they go live once the launch transaction{two ? "s are" : " is"} confirmed and read back from the chain.</p>
          </section>
        );
      })()}

      {/* website-18 (the owner: "the examples and dev benefits take up too much space and force you to scroll to create a coin"): what a
          creator gets and the example tickets, below the wizard in one disclosure, closed by default (the launch state passed once read) */}
      {step === "choose" && (
        <details className="rounded-lg border border-neutral-800 p-3" data-examples-benefits>
          <summary className="cursor-pointer text-sm text-neutral-300">{EXAMPLES_AND_BENEFITS_LABEL}</summary>
          <div className="mt-3 space-y-5">
            {/* the onboarding block (what a creator does, the cost, what they get) moved here too: at 390 px it pushed the search box below the first screen */}
            <CreatorOnboarding />
            <CreatorBenefitsList />
            <ExampleTickets site={site === SITE_LAUNCH_STATE_LOADING ? null : site} />
          </div>
        </details>
      )}
    </main>
  );
}
