"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { previewTotals, unitStep, type SettledEvent } from "@/lib/burnticker/units";
import type { BurnRule } from "@/lib/burnticker/rules";
import { aliasLookup } from "@/lib/burnticker/oracle/events";
import { firstPartyRule } from "@/lib/burnticker/wizard";
import { plainSentence, ruleOneLiner } from "@/lib/burnticker/coinCard";
import { CoinCard } from "../_components/CoinCard";
import { FieldHelp } from "../_components/FieldHelp";
import { CoinVsCoinTile } from "./CoinVsCoinTile";
import { SignCard } from "./SignCard";
import { launchlabPlan, pairCurvePlan } from "@/lib/burnticker/signPlan";
import type { SerializedIx } from "@/lib/burnticker/program";
import { ReviewCard } from "./ReviewCard";
import { launchErrorMessage, LaunchRequestError, PAIR_CURVE_REVIEW_LINE, postPairLaunch, venueFor, venueFrom409, type LaunchErrorBody, type PairVenue } from "@/lib/burnticker/pairLaunchClient";
import type { PairCurveLaunchBundle } from "@/lib/burnticker/pairCurveLaunch";
import { STATIONS, nwsSeries, parseNwsSeries } from "@/lib/burnticker/sources/nws";
import { applyDial, dialsFor, type DialId } from "@/lib/burnticker/dials";
import { DEFICIT_SITE } from "@/lib/burnticker/creatorLaunches";
import { NO_WALLET_LINE } from "@/lib/burnticker/glossary";
import { LaunchRecovery } from "./LaunchRecovery";
import { LAUNCH_GATE_LOADING, launchGateFromCatalogue, wizardMayRender, type LaunchGateState } from "@/lib/burnticker/launchGateState";
import { availabilityFromCatalogue, launchTypeOf, PREVIEW_BANNER, type LaunchAvailabilityModel, type LaunchType } from "@/lib/burnticker/launchAvailability";
import { DEFAULT_SHARE, SHARE_PRESETS, presetRowLabel, pctLabel as presetPct, snapToPreset } from "@/lib/burnticker/launchPresets";
import { loadCatalogue } from "@/lib/burnticker/catalogueClient";
import { sportsConfirmationLine, sportsProvenanceLine, SPORTS_PROVENANCE } from "@/lib/burnticker/sources/provenance";
import { PreWalletSummary } from "./PreWalletSummary";
import { wxThresholdProblem } from "@/lib/burnticker/launchFields";
import { composeRule, fieldsFromRule, launchBody } from "@/lib/burnticker/launchDraft";
import type { LaunchReview } from "@/lib/burnticker/launchReview";
import { LaunchGate } from "./LaunchGate";
import { PairFundsFlow } from "../_components/PairFundsFlow";
import { describeRule, DESCRIPTION_MAX, PAIR_REVIEW_LINE, type CoinText, type DescribeCtx } from "@/lib/burnticker/describe";
import { parseEspnSeries, seasonYearAt, teamSeries, type LeagueId, type Window as TeamWindow } from "@/lib/burnticker/sources/espn";
import { TEMPLATE_START, weatherTemplateDraft, type TemplateId } from "@/lib/burnticker/templates";
import type { Suggestion as SearchSuggestion } from "@/lib/burnticker/search";
import { fold, meaningful, queryTokens } from "@/lib/burnticker/textMatch";

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
interface SourceCardT { id: string; venue: "feed" | "polymarket" | "kalshi"; venueLabel: string; tier: number; tierLabel: string; title: string; cadence: string | null; kind: "binary" | "scalar"; next: { label: string; at: string | null } | null; example: string; launchable: { ok: boolean; why: string | null }; refused: string[]; flags: string[]; sourceName: string | null; sourceUrl: string | null; pick: { oracle: "catalogue" | "polymarket" | "kalshi"; series: string | null; market: string | null; title: string }; configure?: { kind: "team"; league: string } | { kind: "weather"; metric: "high" | "rain" | "snow" } | null }
interface Series { ticker: string; title: string; category: string | null; frequency: string | null; settlementSource: { name: string; url: string } | null; refused: string[] }
interface Source { id: string; kind: string; tier: number; tierLabel: string; title: string; sourceName: string; sourceUrl: string; cadence: string; unit: { size: number; label: string; definition: string } | null; direction: "up" | "down" | "abs" | null; baseline: "previousSettlement" | number | null; flags: string[]; launchable: { ok: boolean; why: string | null }; param: string | null; lastReading: { id: string; value: string | null; at: string } | null; readings: { id: string; value: string | null }[]; preview: { window: { from: string; to: string }; units: number; burnEvents: number; poolFractionSpent: number | null } | null }
interface Backtest { sentence: string; text: string; sha256: string; sha12: string; mode: string; statement: string; seriesTitle: string | null; refusals: { reason: string }[]; matched: number; backtest: { rows: { id: string; at: string; title: string | null; result: string | null; value: string | null; units: number; kind: string }[]; totals: { events: number; burnEvents: number; voids: number; units: number; poolFractionSpent: number | null; tokens: number | null }; oneShot: { resolvesOn: string | null } | null } }
interface Bundle { ready: boolean; pending: string[]; mint: string; ticker: string; mintSecretKey: string | null; rules: { text: string; sha256: string; statement: string; mode: string }; addresses: { feePda: string; feeWsol: string; vault: string | null; poolId: string | null; platformId: string }; transactions: { label: string; signers: string[]; instructions: SerializedIx[] }[]; notes: string[] }
interface League { id: string; label: string; series: { ticker: string; title: string }[]; sport?: string; crossRead?: string | null; draws?: boolean }
interface Team { abbr: string; city: string; nickname: string | null; name: string; ticker: string; league: string | null; filter: string; collisions: string[]; next: { eventTicker: string; marketTicker: string; title: string; expectedAt: string | null; opponent: string | null } | null; record: { w: number; l: number; d: number; since: string }; series?: { win: string; loss: string }; recordText?: string | null }
/** The sports pickers (GET /v1/sports/teams, /v1/sports/games): the leagues' own schedules or TheSportsDB, never ESPN. */
interface SportsTeam { abbr: string; city: string; nickname: string; name: string; ticker: string; league: string; series: { win: string; loss: string }; record: string | null; next: { eventId: string; title: string; startsAt: string; detail: string; opponent: string; home: boolean } | null }
interface SportsSide { abbr: string; name: string; nickname: string; ticker: string; record: string | null }
interface SportsGame { eventId: string; league: string; title: string; startsAt: string; detail: string; a: SportsSide; b: SportsSide; series: { aLoss: string; bLoss: string } }
const recordOf = (r: string | null): { w: number; l: number; d: number; since: string } => { const m = /^(\d+)-(\d+)(?:-(\d+))?$/.exec(r ?? ""); return { w: m ? Number(m[1]) : 0, l: m ? Number(m[2]) : 0, d: m && m[3] ? Number(m[3]) : 0, since: "" }; };
interface Side { abbr: string; marketTicker: string; label: string; nickname: string | null; name: string; ticker: string }
interface PolyMarket { conditionId: string; question: string; yes: string; no: string; endDate: string | null; closed: boolean; sportsMarketType: string | null; /** the outcome's name inside its event (Gamma groupItemTitle), when named */ outcome?: string | null }
interface PolyEvent { slug: string; title: string; url: string; endDate: string | null; closed: boolean; markets: PolyMarket[]; marketCount: number; refused: string[] }
interface PolyTag { slug: string; label: string; events: number; series: string[] }
interface PolyFound { events: PolyEvent[]; tags: PolyTag[]; markets: PolyMarket[] }
type Venue = "kalshi" | "polymarket";
interface EventHit { eventTicker: string; seriesTicker: string; title: string; subTitle: string | null; category: string | null; expectedAt: string | null; closeTime: string | null; markets: { ticker: string; suffix: string; label: string; status: string }[]; matchedSides: string[]; pair: { a: Side; b: Side; tieMarket: string | null } | null; refused: string[] }

/** The web UI's shares come from launchPresets.ts (docs/burnticker/ui-conventions.md § Presets, not dials); the API takes any share. */
const PUB = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const STORE = "burnticker.launch.v2";
const V1 = "/api/burnticker/v1";
const denver = (iso: string | null) => (iso ? new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso)) : "—");
/** The review card's "Ends:" line from the coin text's window sentence (describe.ts WINDOW_SENTENCE): when, then the wind-down. */
function endsLine(t: CoinText | null): string | null {
  if (!t) return null;
  const w = t.windowSentence;
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

export default function LaunchWizard() {
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
  const [uq, setUq] = useState(""), [ures, setUres] = useState<{ cards: Suggestion[]; empty: boolean; categories: { id: string; label: string; blurb: string }[] } | null>(null), [ubusy, setUbusy] = useState(false);
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
  const [unit, setUnit] = useState(1), [perUnit, setPerUnit] = useState(0.01), [baseline, setBaseline] = useState<"previousSettlement" | number>("previousSettlement"), [direction, setDirection] = useState<"up" | "down" | "abs">("up");
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
  const [pendingDials, setPendingDials] = useState<{ fraction: number; side: string | null; window: string | null; games: number | null; league: boolean; from: string } | null>(null);
  // the auto-generated description (describe.ts): the flavour line is editable (null = the template's), the rule block never is
  const [flavour, setFlavour] = useState<string | null>(null), [flavourB, setFlavourB] = useState<string | null>(null);
  const [cardCtx, setCardCtx] = useState<{ key: string; ctx: Omit<DescribeCtx, "ticker"> } | null>(null), [cardYear, setCardYear] = useState<number | null>(null), [cardSet, setCardSet] = useState<{ id: string; outcome: string } | null>(null);
  const [nameAuto, setNameAuto] = useState(true), [tickerAuto, setTickerAuto] = useState(true);
  const [ownImage, setOwnImage] = useState(false), [customImages, setCustomImages] = useState(false);
  // the creator's note (≤ 140 chars): its own box on the coin page, never part of the description; linted on the server at launch
  const [note, setNote] = useState("");
  const [cardWin, setCardWin] = useState<Record<string, number>>({});
  // an event card's outcome picker (polySearch.ts): which card is open and the picker's own filter text
  const [outPick, setOutPick] = useState<{ id: string; q: string } | null>(null);
  // launch audit 5 L02: per-type availability from the catalogue (launchAvailability.ts), explained before any form
  const [avail, setAvail] = useState<LaunchAvailabilityModel | null>(null);
  // L03: the screen the review was entered from (Back returns there, with its query, category and scroll position)
  const [origin, setOrigin] = useState<Origin | null>(null);
  const restoreScroll = useRef<number | null>(null);
  // L01: a share moved onto the preset row, said out loud; L05: warnings carried from the source screen into the review
  const [shareNotice, setShareNotice] = useState<string | null>(null), [srcWarnings, setSrcWarnings] = useState<string[]>([]);
  // L06: the read-only review payload (POST /v1/launch/review) behind the pre-wallet summary
  const [review, setReview] = useState<LaunchReview | null>(null), [reviewBusy, setReviewBusy] = useState(false), [reviewErr, setReviewErr] = useState<string | null>(null);
  // L06 / L12: the event as the source states it (the full question, its link, the outcome, when it resolves, the resolution rules)
  const [eventInfo, setEventInfo] = useState<{ question: string; url: string | null; outcome: string | null; resolves: string | null; criteria: string | null } | null>(null);
  const [scheduleDetail, setScheduleDetail] = useState<string | null>(null), [leagueDetail, setLeagueDetail] = useState<string | null>(null), [drillErr, setDrillErr] = useState<string | null>(null);

  const pairOn = flow === "pair";
  const season = pairOn && pairMode !== "game";
  const sideA = game?.pair ? (swap ? game.pair.b : game.pair.a) : null, sideB = game?.pair ? (swap ? game.pair.a : game.pair.b) : null;

  // ---- state across a refresh (sessionStorage); `?pair=1` (the landing page's button) opens the pair flow --------------------------
  // `ready` is state, not a ref: the write effect must not run in the same commit as the restore (it would store the initial
  // values first, and React's development double-mount would then restore those).
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let s: Record<string, unknown> | null = null;
    try { s = JSON.parse(sessionStorage.getItem(STORE) ?? "null"); } catch { s = null; }
    const wantPair = new URLSearchParams(window.location.search).get("pair") === "1";
    if (s && (!wantPair || s.flow === "pair")) {
      const set = <T,>(k: string, f: (v: T) => void) => { if (s![k] !== undefined) f(s![k] as T); };
      set("flow", setFlow); set("step", (v: Step) => setStep(v === "launch" ? "review" : v)); set("leagueSeries", setLeagueSeries); set("team", setTeam); set("winLose", setWinLose);
      set("game", setGame); set("swap", setSwap); set("pairMode", setPairMode); set("pick", setPick); set("filter", setFilter); set("kind", setKind); set("mode", setMode);
      set("onYes", setOnYes); set("onNoEnabled", setOnNoEnabled); set("onNo", setOnNo); set("unit", setUnit); set("perUnit", setPerUnit); set("baseline", setBaseline); set("direction", setDirection);
      set("tokensYes", setTokensYes); set("vaultShare", setVaultShare); set("burnOn", setBurnOn); set("fraction", setFraction);
      set("name", setName); set("ticker", setTicker); set("description", setDescription); set("imageUrl", setImageUrl); set("link", setLink); set("xUrl", setXUrl); set("tg", setTg); set("cat", setCat);
      set("nameB", setNameB); set("tickerB", setTickerB); set("descB", setDescB); set("imageB", setImageB); set("firstBuy", setFirstBuy); set("pasted", setPasted); set("q2", setQ2);
      set("uq", setUq); set("origin", setOrigin); set("eventInfo", setEventInfo); set("srcWarnings", setSrcWarnings); set("bq", setBq); set("wx", setWx); set("draft", setDraft); set("flavour", setFlavour); set("flavourB", setFlavourB); set("cardCtx", setCardCtx); set("cardYear", setCardYear); set("cardSet", setCardSet); set("nameAuto", setNameAuto); set("tickerAuto", setTickerAuto); set("ownImage", setOwnImage); set("note", setNote);
    } else if (wantPair) { setFlow("pair"); setStep("pick"); }
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
        setOrigin({ kind: "template", flow: "team", step: "choose", uq: "", q2: "", cat: "weather", bq: "", leagueSeries: null, scrollY: 0 });
      }
      else if (st.flow) { setFlow(st.flow); setStep(ORDER[st.flow][0]); }
      else if (st.browse) { setFlow("browse"); setStep("pick"); setCat(st.browse); }
      else { setFlow("team"); setStep("choose"); if (st.search) setUq(st.search); }
    } else if (like) {
      // "Launch one like this" (a coin or pair page): the same rule shape, the team / race / feed re-pickable, the dials copied
      try { sessionStorage.removeItem(STORE); } catch { /* ignore */ }
      fetch(`/api/burnticker/tokens/${encodeURIComponent(like)}`).then((r) => (r.ok ? r.json() : null)).then((j: { status?: { seriesTitle?: string | null; pair?: unknown }; rulesText?: string } | null) => {
        if (!j?.rulesText) return;
        let r: BurnRule; try { r = JSON.parse(j.rulesText) as BurnRule; } catch { return; }
        const d = dialsFor(r, { nowMs: Date.now() });
        const e = r.oracle === "catalogue" && r.series ? parseEspnSeries(r.series) : null;
        const n = r.oracle === "catalogue" && r.series ? parseNwsSeries(r.series) : null;
        setPendingDials({ fraction: d.fraction, side: d.side?.value ?? null, window: d.window?.value ?? null, games: d.window?.games ?? null, league: !!d.league?.on, from: like.toUpperCase() });
        if (e?.kind === "team") { setFlow("team"); setStep("team"); setLeagueSeries(e.league); }
        else if (e?.kind === "game") { setFlow("pair"); setStep("pick"); setLeagueSeries(e.league); }
        else if (n) { setFlow("browse"); setStep("pick"); setCat("weather"); setWx({ metric: n.metric, station: n.station, threshold: String(n.threshold ?? "") }); }
        else if (r.oracle === "derby") { window.location.href = "/burnticker/launch?template=coin-vs-coin"; }
        else if (r.oracle === "polymarket") { setFlow("single"); setStep("pick"); }
        else { setFlow("team"); setStep("choose"); setUq(j.status?.seriesTitle ?? ""); }
      }).catch(() => { /* the plain launch page */ });
    }
    setReady(true);
  }, []);
  const snapshot = JSON.stringify({ eventInfo, uq, origin, srcWarnings, bq, wx, flow, step, leagueSeries, team, winLose, game, swap, pairMode, pick, filter, kind, mode, onYes, onNoEnabled, onNo, unit, perUnit, baseline, direction, tokensYes, vaultShare, burnOn, fraction, name, ticker, description, imageUrl, link, xUrl, tg, cat, nameB, tickerB, descB, imageB, firstBuy, pasted, q2, draft, flavour, flavourB, cardCtx, cardYear, cardSet, nameAuto, tickerAuto, ownImage, note });
  useEffect(() => { if (ready) { try { sessionStorage.setItem(STORE, snapshot); } catch { /* private mode: no memory, no harm */ } } }, [ready, snapshot]);
  useEffect(() => { const y = restoreScroll.current; restoreScroll.current = null; window.scrollTo({ top: y ?? 0 }); }, [step]);
  const startOver = () => { try { sessionStorage.removeItem(STORE); } catch { /* ignore */ } window.location.href = window.location.pathname; };

  // site audit #18: the one shared catalogue read (catalogueClient.ts) — the header's availability uses the same promise
  useEffect(() => { loadCatalogue().then((raw) => { const j = raw as { sources?: Source[]; cluster?: string; venues?: typeof venues; customImages?: boolean }; setSources(j.sources ?? []); setCluster(j.cluster ?? null); if (j.venues) { setVenues(j.venues); setPairVenue(venueFor(j.venues)); } setCustomImages(j.customImages === true); setAvail(availabilityFromCatalogue(j)); setGate(launchGateFromCatalogue(j)); }).catch((e) => setGate(launchGateFromCatalogue(null, String((e as Error).message ?? e)))); }, []);
  const curCat = cats.find((c) => c.id === cat);
  useEffect(() => { if (flow === "browse" && curCat?.guided === "elections" && !etypes.length && venues.polymarket) getJson<{ types: { id: string; label: string; races: number }[] }>(`${V1}/elections`).then((j) => setEtypes(j.types)).catch((e) => { setEtypes([]); setEtypesErr(`The races could not be read just now (${detailOf(e)}).`); }); }, [flow, curCat?.guided, etypes.length, venues.polymarket]);
  useEffect(() => { if (!etype) return; setEbusy(true); setEraces(null); setEpair(null); setEsel([]); getJson<{ states: { abbr: string; name: string; races: number }[]; races: ElRace[] }>(`${V1}/elections?type=${etype}${estate ? `&state=${estate}` : ""}`).then((j) => { setEstates(j.states); setEraces(etype === "control" || estate ? j.races : null); }).catch(() => setEraces([])).finally(() => setEbusy(false)); }, [etype, estate]);
  useEffect(() => { if (esel.length !== 2 || !eraces?.[0]) { setEpair(null); return; } const race = eraces.find((r) => esel.every((c) => r.outcomes.some((o) => o.conditionId === c))); if (!race) return; getJson<ElPair>(`${V1}/elections/pair?slug=${race.slug}&a=${esel[0]}&b=${esel[1]}`).then(setEpair).catch(() => setEpair(null)); }, [esel, eraces]);
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
      getJson<{ cards: Suggestion[]; empty: boolean; categories: { id: string; label: string; blurb: string }[] }>(`${V1}/search?q=${encodeURIComponent(qv)}`)
        .then((j) => { if (seq === useq.current) { reportNoClick(); lastShown.current = { q: qv, cards: j.cards.filter((c) => c.rule || c.matchup).length, clicked: false, reported: false }; setUres(j); } })
        .catch(() => { if (seq === useq.current) setUres({ cards: [], empty: true, categories: [] }); })
        .finally(() => { if (seq === useq.current) setUbusy(false); });
    }, 300);
    return () => clearTimeout(t);
  }, [uq]);
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
    if (flow !== "team" || !leagueSeries) return; setTeamsBusy(true);
    getJson<{ teams: SportsTeam[]; scheduleNote?: string | null; scheduleDetail?: string | null }>(`${V1}/sports/teams?league=${leagueSeries}`).then((j) => (setScheduleNote(j.scheduleNote ?? null), setScheduleDetail(j.scheduleDetail ?? null), j)).then((j) => setTeams(j.teams.map((t) => ({ abbr: t.abbr, city: t.city, nickname: t.nickname, name: t.name, ticker: t.ticker, league: t.league, filter: t.series.win, collisions: [], series: t.series, recordText: t.record, record: recordOf(t.record),
      next: t.next ? { eventTicker: t.next.eventId, marketTicker: t.next.eventId, title: t.next.title, expectedAt: t.next.startsAt, opponent: t.next.opponent } : null })))).catch(() => setTeams([])).finally(() => setTeamsBusy(false));
  }, [flow, leagueSeries]);
  useEffect(() => {
    if (flow !== "pair" || !leagueSeries) return;
    const url = `${V1}/sports/games?league=${leagueSeries}${gameQ.trim() ? `&q=${encodeURIComponent(gameQ.trim())}` : ""}`;
    setGamesBusy(true);
    const side = (x: SportsSide, series: string): Side => ({ abbr: x.abbr, marketTicker: series, label: x.name, nickname: x.nickname, name: x.name, ticker: x.ticker });
    const t = setTimeout(() => { getJson<{ games: SportsGame[]; scheduleNote?: string | null; scheduleDetail?: string | null }>(url).then((j) => (setScheduleNote(j.scheduleNote ?? null), setScheduleDetail(j.scheduleDetail ?? null), j)).then((j) => setGames(j.games.map((g) => ({ eventTicker: g.eventId, seriesTicker: g.league, title: g.title, subTitle: g.detail, category: "Sports", expectedAt: g.startsAt, closeTime: null, markets: [], matchedSides: [], pair: { a: side(g.a, g.series.aLoss), b: side(g.b, g.series.bLoss), tieMarket: null }, refused: [] })))).catch((e) => { setGames([]); setScheduleNote("The games for this league could not be read just now: try again in a moment. Settlement does not use this read."); setScheduleDetail(detailOf(e)); }).finally(() => setGamesBusy(false)); }, gameQ ? 300 : 0);
    return () => clearTimeout(t);
  }, [flow, leagueSeries, gameQ]);
  // any-market search
  useEffect(() => {
    if (flow !== "single" || q2.trim().length < 2) { setFound(null); setPolyFound(null); return; }
    setFindBusy(true);
    const t = setTimeout(() => {
      const qs = encodeURIComponent(q2.trim());
      // Both venues at once; either may fail without hiding the other.
      const kalshi = !venues.kalshi ? Promise.resolve(setFound({ results: [], events: [], ranking: "series" })) : getJson<{ results: Series[]; events: EventHit[]; ranking: "events" | "series" }>(`${V1}/kalshi/search?q=${qs}`).then((j) => setFound({ results: j.results ?? [], events: j.events ?? [], ranking: j.ranking ?? "series" })).catch(() => setFound({ results: [], events: [], ranking: "series" }));
      const poly = !venues.polymarket ? Promise.resolve(setPolyFound({ events: [], tags: [], markets: [] })) : getJson<PolyFound>(`${V1}/polymarket/search?q=${qs}`).then((j) => { setPolyFound({ events: j.events ?? [], tags: j.tags ?? [], markets: j.markets ?? [] }); setPolyErr(null); }).catch((e) => { setPolyFound({ events: [], tags: [], markets: [] }); setPolyErr(String((e as Error).message)); });
      void Promise.allSettled([kalshi, poly]).then(() => setFindBusy(false));
    }, 400);
    return () => clearTimeout(t);
  }, [flow, q2, venues.kalshi, venues.polymarket]);

  // ---- the rules ------------------------------------------------------------------------------------------------------------------
  // L01: the one typed path (launchDraft.ts) — the same pure functions the tests walk from every card to the locked rule
  const genericRule: BurnRule | null = useMemo(() => composeRule(pick, { kind, mode, onYes, onNoEnabled, onNo, burnOn, unit, perUnit, baseline, direction, tokensYes, vaultShare, filter, polyPreset }), [pick, filter, polyPreset, kind, mode, onYes, onNoEnabled, onNo, unit, perUnit, baseline, direction, tokensYes, vaultShare, burnOn]);

  /** Matchups: two coins, one per team — "this game only" = each side burns if its team loses that game; "every game" = each side's team-loss coin. */
  const pairRules = useMemo(() => {
    if (!pairOn || !game || !sideA || !sideB || !leagueSeries) return null;
    // a game pair is that game (one-shot: 10 % default); a season pair is this season or perpetual (recurring: 2 % default)
    if (pairMode === "game") return { a: firstPartyRule(sideA.marketTicker, 0.1), b: firstPartyRule(sideB.marketTicker, 0.1) };
    const lg = leagueSeries as LeagueId;
    const w: TeamWindow = pairMode === "season" ? { kind: "season", year: cardYear ?? seasonYearAt(lg, Date.now()) } : { kind: "perpetual" };
    try { return { a: firstPartyRule(teamSeries(lg, sideA.abbr, "loss", w), 0.02), b: firstPartyRule(teamSeries(lg, sideB.abbr, "loss", w), 0.02) }; } catch { return null; }
  }, [pairOn, game, sideA, sideB, pairMode, leagueSeries, cardYear]);
  const baseRule: BurnRule | null = useMemo(() => {
    // a team coin: this season by default (the picker's selector), 2 % per game; the side, the window and the share are dials
    if (flow === "team") return team?.series ? firstPartyRule(winLose === "win" ? team.series.win : team.series.loss, 0.02) : null;
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
    const sn = snapToPreset(curDials.fraction, oneShotRule ? "oneShot" : "recurring");
    setShareNotice(`This rule came with ${presetPct(curDials.fraction)} per burn. The web launcher offers ${presetRowLabel(oneShotRule ? "oneShot" : "recurring")}, so ${presetPct(sn.value)} is selected. Pick another preset below, or use the API to launch with ${presetPct(curDials.fraction)}.`);
    setDial("fraction", sn.value);
  }, [step, baseKey, curDials?.fraction, pendingDials]);   // eslint-disable-line react-hooks/exhaustive-deps
  // the coin text (describe.ts), re-rendered from the rule as it is now
  const aHome = !!swap;
  const textCtx = useMemo((): Omit<DescribeCtx, "ticker"> => {
    if (!rule) return {};
    if (cardCtx && cardCtx.key === (rule.market ?? rule.series ?? "")) return cardCtx.ctx;
    if (pairOn && pairMode === "game" && game && sideB) return { game: { opponent: sideB.nickname ?? sideB.name, home: aHome, startsAt: game.expectedAt ?? "" } };
    if (pick?.oracle === "polymarket") return { eventPhrase: pick.title.replace(/\s*\(resolves once\)$/, "").replace(/\?$/, "").replace(/^will\s+/i, ""), endsAt: null };
    if (pick?.oracle === "catalogue" && pick.source?.unit && !/^(espn|nws|fec)\./.test(pick.series ?? "")) return { feed: { title: pick.title, sourceName: pick.source.sourceName, unitLabel: pick.source.unit.label } };
    return {};
  }, [rule, cardCtx, pairOn, pairMode, game, sideB, aHome, pick]);
  const text: CoinText | null = useMemo(() => { if (!rule) return null; try { return describeRule(rule, { ticker, ...textCtx }); } catch { return null; } }, [rule, ticker, textCtx]);
  const textB: CoinText | null = useMemo(() => { if (!ruleB) return null; try { return describeRule(ruleB, { ticker: tickerB, ...(pairMode === "game" && game && sideA ? { game: { opponent: sideA.nickname ?? sideA.name, home: !aHome, startsAt: game.expectedAt ?? "" } } : {}) }); } catch { return null; } }, [ruleB, tickerB, pairMode, game, sideA, aHome]);
  const compose = (t: CoinText | null, _fl: string | null, fallback: string) => (t ? t.paragraph.slice(0, DESCRIPTION_MAX) : fallback);
  // a quick local read of the note (the server's lint is the one that counts: copy-lint.json, incl. no-affiliation)
  const noteProblem = /https?:\/\/|www\.|\.(com|io|xyz|fun)\b/i.test(note) ? "no links in the note" : /\b(official|endorsed|partner(ed|ship)?|affiliated|backed|guaranteed|insured|audited|verified|licensed|sponsored)\b/i.test(note) ? "no claims of affiliation or endorsement" : null;
  const finalDescription = compose(text, flavour, description), finalDescriptionB = compose(textB, flavourB, descB);
  // the suggested name and ticker follow the rule (a window change re-suggests: $RAYS26 → $RAYS) until the creator types their own
  useEffect(() => {
    if (!text || step !== "review") return;
    if (tickerAuto && text.ticker && text.ticker !== ticker) setTicker(text.ticker);
    if (nameAuto && text.name && text.name !== name && flow !== "pair") setName(text.name);
  }, [text, step, tickerAuto, nameAuto, ticker, name, flow]);

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
      const run = async (x: BurnRule) => { const r = await fetch("/api/burnticker/oracle/backtest", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rule: x }) }); const j = await r.json(); if (!r.ok) throw new Error(j.error ?? r.statusText); return j as Backtest; };
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
  // L06: the read-only review payload (POST /v1/launch/review) for the pre-wallet summary — the server's numbers, debounced; a stale
  // answer (the rule or names changed meanwhile) is dropped by the sequence id
  const reviewSeq = useRef(0);
  const reviewKey = JSON.stringify([rule, ticker, name, note, pairOn ? [tickerB, nameB] : null, srcWarnings, textCtx]);
  useEffect(() => {
    if (step !== "review" || !rule || gate.kind === "loading") return;
    const seq = ++reviewSeq.current;
    setReviewBusy(true); setReviewErr(null);
    const t = setTimeout(() => {
      getJson<LaunchReview>(`${V1}/launch/review`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rule, ticker: ticker.toUpperCase(), name, note, descCtx: textCtx, warnings: srcWarnings, ...(pairOn && ruleB ? { companion: { ticker: tickerB.toUpperCase(), name: nameB } } : {}) }) })
        .then((j) => { if (seq === reviewSeq.current) setReview(j); })
        .catch((e) => { if (seq === reviewSeq.current) { setReview(null); setReviewErr(`${(e as Error).message} (${detailOf(e)})`); } })
        .finally(() => { if (seq === reviewSeq.current) setReviewBusy(false); });
    }, 400);
    return () => clearTimeout(t);
  }, [step, reviewKey, gate.kind]);   // eslint-disable-line react-hooks/exhaustive-deps

  const linksOf = useCallback(() => ([["website", link], ["X", xUrl], ["Telegram", tg]] as const).filter(([, u]) => /^https:\/\/\S+$/.test(u.trim())).map(([label, u]) => ({ label, url: u.trim() })), [link, xUrl, tg]);
  const launch = useCallback(async () => {
    if (!rule) return;
    setBusy(true); setLaunchErr(null);
    // 409 / 429 / 503 → a plain sentence (pairLaunchClient.launchErrorMessage)
    const post = async (body: Record<string, unknown>) => { const r = await fetch("/api/burnticker/launch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); const j = await r.json().catch(() => null); if (!r.ok) throw new LaunchRequestError(r.status, j?.code ?? null, launchErrorMessage(r.status, j as LaunchErrorBody | null, r.headers.get("retry-after"))); return j; };
    setPcOut(null);
    mark("launch");
    // pressing Launch is the acknowledgement (the line under the button states both); socials, a first buy and a custom image are API-only
    flowStats.current.decisions++;
    const common = { creator, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true }, timings: { ...stepTimes.current, screens: flowStats.current.screens, decisions: flowStats.current.decisions } };
    try {
      if (pairOn && ruleB) {
        // A matchup: two coins, one per team — two launches (each its own selector; a registered pair needs one shared selector).
        const a = await post({ ...common, ticker: ticker.toUpperCase(), name, description: finalDescription, descCtx: textCtx, note, imageUrl: null, links: [], rule });
        const b = await post({ ...common, firstBuySol: "0", ticker: tickerB.toUpperCase(), name: nameB, description: finalDescriptionB, descCtx: pairMode === "game" && game && sideA ? { game: { opponent: sideA.nickname ?? sideA.name, home: !aHome, startsAt: game.expectedAt ?? "" } } : {}, note: "", imageUrl: null, links: [], rule: ruleB });
        setPairOut({ pairId: null, a: a.bundle, b: b.bundle, notes: [season ? "Two coins, each burning on its own team's losses: two independent records. They meet only when the two teams play each other; on those games exactly one side burns." : `Two coins on ${game?.title ?? "one game"}: the losing team's coin burns once the final score is confirmed; a tie burns neither.`] }); setBundle(a.bundle);
      } else {
        const body = { ...common, ...launchBody({ creator, ticker, name, description: finalDescription, descCtx: textCtx, note, rule }) };
        if (pairOn) {
          // a rivalry pair (one shared selector): the venue this host uses — the pair curve (one transaction set, both graduate or
          // neither) or two LaunchLab bundles; a 409 naming the other venue switches the review line and waits for a second press
          const j = await postPairLaunch((u, init) => fetch(u, init), { ...body, pair: { ticker: tickerB.toUpperCase(), name: nameB, description: finalDescriptionB, imageUrl: null, links: [] } }, pairVenue);
          if (j.venue === "pair-curve") { setPairOut(null); setBundle(null); setPcOut({ pairId: j.pair.pairId, pc: j.pairCurve, keys: j.mintSecretKeys, notes: j.pair.notes ?? [] }); }
          else { setPairOut({ pairId: j.pair.pairId, a: j.bundles.a as Bundle, b: j.bundles.b as Bundle, notes: j.pair.notes ?? [] }); setBundle(j.bundles.a as Bundle); }
        } else setBundle((await post(body)).bundle);
      }
      setStep("launch");
    } catch (e) { const v = venueFrom409(e); if (v) setPairVenue(v); setLaunchErr(String((e as Error).message)); } finally { setBusy(false); }
  }, [rule, ruleB, season, pairOn, pairVenue, creator, ticker, name, finalDescription, finalDescriptionB, imageUrl, ownImage, customImages, note, textCtx, pairMode, aHome, sideA, linksOf, firstBuy, ackLocked, ackNoReturns, tickerB, nameB, imageB, game?.title]);

  // ---- navigation -----------------------------------------------------------------------------------------------------------------
  const order = ORDER[flow];
  const idx = order.indexOf(step);
  const next = () => setStep(order[Math.min(idx + 1, order.length - 1)]);
  /** L03: remember the screen a choice was made on, so Back from the review returns to it (query, category, scroll included). */
  const markOrigin = (kind: EntryKind) => setOrigin({ kind, flow, step, uq, q2, cat, bq, leagueSeries, scrollY: typeof window === "undefined" ? 0 : window.scrollY });
  const back = () => {
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
    setDraft(null); setFlavour(null); setFlavourB(null); setCardCtx(null); setCardYear(null); setNameAuto(true); setTickerAuto(true);
    if (f === "single" && pick?.oracle === "catalogue") setPick(null);
    if (f === "browse") { setPick(null); setDrill(null); }
  };
  /** One click from a search card (or an elections outcome) to the create screen, with the rule filled in. */
  const applyRule = (r: BurnRule, pk: NonNullable<Suggestion["pick"]>, o: { name?: string | null; ticker?: string | null; how?: string | null; settlement?: string | null; source?: Suggestion["source"] } = {}) => {
    const fromCatalogue = pk.oracle === "catalogue" ? sources.find((x) => x.id === pk.series) : undefined;
    const src = fromCatalogue ?? (o.source ? ({ id: pk.series ?? "", kind: "native", tier: 4, tierLabel: "keeper-read primary API", title: pk.title, sourceName: o.settlement ?? "", sourceUrl: "", cadence: "", unit: o.source.unit, direction: o.source.direction, baseline: o.source.baseline, flags: [], launchable: { ok: true, why: null }, param: null, lastReading: null, readings: [], preview: null } as Source) : undefined);
    setFlow("single"); setPick({ ...pk, source: src }); setFilter(""); setBt(null); setBtFor(""); setBundle(null); setPairOut(null); setPcOut(null);
    // L01: the card's rule becomes the draft's fields through launchDraft.ts (composeRule rebuilds exactly this rule from them)
    const f = fieldsFromRule(r, { kind, mode, onYes, onNoEnabled, onNo, burnOn, unit, perUnit, baseline, direction, tokensYes, vaultShare, filter: "", polyPreset });
    setKind(f.kind); setBurnOn(f.burnOn); setOnYes(f.onYes); setOnNoEnabled(f.onNoEnabled); setPerUnit(f.perUnit); setUnit(f.unit); setDirection(f.direction); setBaseline(f.baseline);
    setMode("buyback");
    if (o.name) setName(o.name); if (o.ticker) setTicker(o.ticker);
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
    setTickerAuto(false); setNameAuto(false);
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
    const auto = !!tx && tk === tx.ticker; setTickerAuto(auto); setNameAuto(auto);
    applyRule(r, { ...c.pick, series: r.series ?? c.pick.series, title: w ? w.title : c.pick.title }, { name: nm, ticker: tk, how: c.howSettles, settlement: c.settlement, source: c.source });
  };
  const chooseTeam = (t: Team) => { mark("card"); markOrigin("team"); setShareNotice(null); setSrcWarnings(scheduleNote ? [scheduleNote] : []); setTeam(t); setName(t.name); setTicker(t.ticker); setDraft(null); setFlavour(null); setNameAuto(true); setTickerAuto(true); next(); };
  const chooseGame = (g: EventHit) => {
    if (!g.pair) return;
    setGame(g); setSwap(false); setPairMode("game"); setDraft(null); setFlavour(null); setFlavourB(null);
    setName(g.pair.a.name); setTicker(g.pair.a.ticker); setNameB(g.pair.b.name); setTickerB(g.pair.b.ticker);
    setFlow("pair"); setStep("review");
  };
  const doSwap = () => { setSwap(!swap); setName(nameB); setTicker(tickerB); setNameB(name); setTickerB(ticker); };

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
      {leagueErr && <p className="text-red-400 text-xs" role="alert">The league list could not be read just now ({leagueErr}). {leagueDetail && <span className="text-neutral-500">Technical detail: {leagueDetail}</span>}</p>}
      <FieldHelp id="league-search" /><input data-decision="what" data-help="league-search" className={input + " w-full sm:w-72"} placeholder="Search leagues: MLB, Premier League, WNBA, MLS, college…" value={leagueQ} onChange={(e) => setLeagueQ(e.target.value)} aria-label="search leagues" />
      {!leagues.length && !leagueErr && <span className="text-sm text-neutral-500">Loading leagues…</span>}
      {(["baseball", "basketball", "football", "hockey", "soccer"] as const).map((sp) => {
        const ls = leagues.filter((l) => l.sport === sp && (!leagueQ.trim() || `${l.label} ${l.id} ${sp}`.toLowerCase().includes(leagueQ.trim().toLowerCase())));
        if (!ls.length) return null;
        return (
          <div key={sp} className="space-y-1">
            <div className="font-mono text-[11px] uppercase tracking-widest text-neutral-500">{sp}{sp === "baseball" && <FieldHelp id="league-pick" />}</div>
            <div className="flex flex-wrap gap-2">{ls.map((l) => (
              <button data-decision="what" key={l.id} onClick={() => { setLeagueSeries(l.id); setTeamQ(""); setGameQ(""); }} title={l.crossRead ? `confirmed by: ${l.crossRead}` : "no confirmation source — refused at creation"} className={`rounded-full border px-3 py-1.5 text-sm ${leagueSeries === l.id ? "border-amber-400 bg-amber-400 text-neutral-950" : "border-neutral-700 hover:border-neutral-500"}`}>{l.label}{!l.crossRead && <span className="ml-1 text-[10px] text-red-400">cross-read missing</span>}</button>
            ))}</div>
          </div>
        );
      })}
    </div>
  );
  const chip = (v: Venue) => <span className={`ml-2 inline-block rounded px-1.5 py-0.5 align-middle text-[10px] font-medium uppercase tracking-wide ring-1 ${v === "kalshi" ? "bg-emerald-500/15 text-emerald-300 ring-emerald-500/40" : "bg-indigo-500/15 text-indigo-300 ring-indigo-500/40"}`}>{v === "kalshi" ? "Kalshi" : "Polymarket"}</span>;
  const pickPoly = (m: PolyMarket) => { markOrigin("exact"); setSrcWarnings([]); const ev = polyFound?.events.find((e) => e.markets.some((x) => x.conditionId === m.conditionId)); setEventInfo({ question: m.question, url: ev?.url ?? null, outcome: `“${m.yes}”`, resolves: m.endDate ? denver(m.endDate) : ev?.endDate ? denver(ev.endDate) : null, criteria: null }); setPick({ oracle: "polymarket", series: null, market: m.conditionId, title: `${m.question} (resolves once)`, yes: m.yes, no: m.no }); setKind("binary"); setFilter(""); setPolyPreset(null); next(); };
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
  const typeBlocked = (t: LaunchType | null): string | null => { if (!t || !avail) return null; const a = avail.types[t]; return a.available ? null : `${a.label} launches are not available on this site. ${a.reason ?? ""}`.trim(); };
  const cardBlocked = (c: Suggestion): string | null => typeBlocked(c.matchup ? "matchup" : c.picker ? "markets" : launchTypeOf(c.rule));
  const firstActionable = ures ? ures.cards.findIndex((c) => !c.refused.length && (!!c.picker || !!c.rule || !!c.matchup) && !cardBlocked(c)) : -1;
  const preview = gate.kind === "preview";
  /** Why the wallet cannot open for the rule on the review card (preview / closed host, an unavailable type), or null. */
  const walletBlocked = (t: LaunchType | null): string | null => (preview ? "This is a preview, so the wallet stays closed. Creator launches are closed on this site." : gate.kind !== "open" ? "Creator launches are closed on this host, so the wallet stays closed." : typeBlocked(t));
  // website brief §1: the gate resolves before any launch control renders (loading → skeleton; closed / unavailable → no controls)
  if (!wizardMayRender(gate)) return <LaunchGate state={gate as Exclude<LaunchGateState, { kind: "open" | "preview" }>} deficitHref={DEFICIT_SITE} noWalletLine={NO_WALLET_LINE} />;

  return (
    <main className="mx-auto max-w-4xl px-4 py-6 space-y-5">
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">Launch a coin {cluster === "devnet" && <span className="rounded bg-sky-500/20 px-2 py-0.5 text-xs font-medium text-sky-300 ring-1 ring-sky-500/40" title="BURNTICKER_CLUSTER=devnet: test network, no real money">Devnet</span>}</h1>
          <p className="text-neutral-400 text-sm">Every <Link className="underline" href="/burnticker">Burnticker</Link> coin settles on a primary source, such as the BLS, the Treasury, the National Weather Service or a league&apos;s own feed, or on a Polymarket payout read from the chain. The rule is locked at launch. <Link className="underline" href="/burnticker/trust">See what the operator can and cannot do.</Link></p>
        </div>
        <span className="flex items-center gap-3 text-xs"><Link className="underline text-neutral-400" href="/burnticker/templates">Templates</Link><Link className="underline text-neutral-400" href="/burnticker/me">Your coins</Link>{step !== "choose" && <button data-nav className="text-neutral-500 underline" onClick={startOver}>start over</button>}</span>
      </header>
      {preview && <p className="sticky top-14 z-30 rounded border border-amber-400 bg-neutral-950/95 px-3 py-2 text-sm font-medium text-amber-300" role="status" data-preview-banner>{PREVIEW_BANNER}</p>}
      <LaunchRecovery />

      {step !== "choose" && (
        <div aria-label="Progress">
          <div className="flex items-center justify-between text-xs text-neutral-400"><span>Step {idx + 1} of {order.length}: <span className="text-neutral-200">{LABELS[flow][step]}</span></span><span data-entry-label>{step === "review" && origin ? (origin.kind === "browse" ? `Browse · ${cats.find((c) => c.id === origin.cat)?.label ?? origin.cat}` : ENTRY_LABEL[origin.kind]) : flow === "team" ? "Team coin" : flow === "pair" ? "Matchup pair" : flow === "single" ? "Exact market" : flow === "browse" ? "Browse" : "Advanced"}</span></div>
          <div className="mt-1 h-1.5 rounded bg-neutral-800"><div className="h-1.5 rounded bg-amber-400" style={{ width: `${((idx + 1) / order.length) * 100}%` }} /></div>
        </div>
      )}


      {pendingDials && <p className="rounded border border-amber-400/50 p-2 text-sm text-amber-200" role="status">Launching one like ${pendingDials.from}: pick the {flow === "team" ? "team" : flow === "pair" ? "game" : flow === "browse" ? "source" : "market"}, and the review card opens with the same shape{pendingDials.side ? ` (on a ${pendingDials.side})` : ""}.</p>}

      {step === "choose" && (
        <section className="space-y-3" aria-label="Describe the event">
          <label className="block">
            <span className="text-lg font-medium">Describe the event</span>
            <FieldHelp id="search" /><input data-decision="what" data-help="search" autoFocus enterKeyHint="search" aria-describedby="search-hint" className={input + " mt-1 text-base py-3"} value={uq} onChange={(e) => setUq(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); /* site audit #10: Enter moves to the first result (results appear as you type) */ const first = document.querySelector<HTMLElement>("[data-first-result]"); if (first) first.focus(); } }} placeholder="e.g. 'Rays win the World Series', 'Lakers win tonight', 'Arsenal win', 'Oilers lose', 'El-Sayed wins Michigan Senate', 'Detroit high above 90'" aria-label="Describe the event" />
          </label>
          <p className="text-xs text-neutral-500"><button className="underline" data-decision="what" disabled={marketsOff} onClick={() => !marketsOff && begin("single")}>or find a market by its exact listing</button></p>
          <p id="search-hint" className="text-xs text-neutral-500">Results appear as you type. Press Enter to jump to the first one.</p>
          {shortQuery && <p className="text-sm text-neutral-500">Type a few more letters…</p>}
          {ubusy && <p className="text-sm text-neutral-500">Searching every source…</p>}
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
                    {badgeText && <span className="bt-chip bt-chip-window">{badgeText}</span>}
                  </div>
                  {c.alternative && <p className="mt-1 text-[11px] text-amber-300" data-alternative>This is a related rule. It is not the exact event you typed.</p>}
                  <div className="mt-1 font-medium leading-snug break-words">{title}</div>
                  <div className="text-xs text-neutral-400 break-words">{c.subtitle}</div>
                  {c.interpreted && <p className="mt-1 text-xs text-neutral-300 break-words" data-interpreted>{c.interpreted}</p>}
                  <p className="mt-1 text-xs text-neutral-400 break-words">It settles on {c.settlement}.{c.crossReadUrl && <> <a className="underline" href={c.crossReadUrl} rel="noopener" target="_blank">Open {c.crossRead ?? "the source"} ↗</a></>}</p>
                  {tx && <p className="mt-2 text-xs text-neutral-300"><span className="font-mono">${tx.ticker}</span> — {tx.oneLiner}.</p>}
                  {c.note && <p className="mt-2 text-xs text-amber-300">{c.note}</p>}
                  {cardBlocked(c) && <p className="mt-2 text-xs text-amber-300" data-type-blocked>{cardBlocked(c)}</p>}
                  {c.refused.length > 0 ? <p className="mt-2 text-xs text-red-400">{refusedLine(c.refused)}</p>
                    : c.venue === "tile" ? (c.href ? <Link className="mt-2 inline-block underline text-amber-300 text-xs" href={c.href}>Open Coin vs Coin →</Link> : <p className="mt-2 text-xs text-neutral-500">Coin vs Coin — not built yet</p>)
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
          {avail && Object.values(avail.types).some((t) => !t.available) && (
            <div className="rounded border border-neutral-800 p-2 text-xs text-neutral-400" data-availability>
              <p className="text-neutral-300">Some kinds of coin cannot be launched on this site right now.</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">{Object.values(avail.types).filter((t) => !t.available).map((t) => <li key={t.type}>{t.label} launches are not available. {t.reason}</li>)}</ul>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            {([
              ["team", "Team coin", "Any team in any league — baseball, basketball, hockey, soccer, football. It burns on every win this season. For losses, type “… lose” in the box above.", "For example, $RAYS26, $ARSENAL or $OILERS"],
              ["pair", "Matchup", "Two teams, two coins: the losing team's coin burns.", "For example, $LAKERS vs $CELTICS"],
              ["browse", "Any result", "Weather, elections, the economy, space or culture. Pick a category, then a source.", "For example, the national debt, Denver's high or a Senate race"],
            ] as const).map(([f, title, body, eg]) => { const why = f === "team" ? typeBlocked("team") : f === "pair" ? typeBlocked("matchup") : null; return (
              <button key={f} data-decision="what" disabled={!!why} aria-describedby={why ? `tile-${f}-why` : undefined} onClick={() => begin(f)} className="text-left rounded-xl border border-neutral-800 bg-neutral-900 p-5 hover:border-amber-400 focus:border-amber-400 focus:outline-none disabled:opacity-50 disabled:hover:border-neutral-800">
                <div className="text-lg font-semibold">{title}</div>
                <p className="mt-1 text-sm text-neutral-300">{body}</p>
                <p className="mt-3 text-xs text-neutral-500">{eg}</p>
                {why && <p id={`tile-${f}-why`} className="mt-2 text-xs text-amber-300">{why}</p>}
              </button>
            ); })}
            <CoinVsCoinTile pairCurve={venues.pairCurve === true} blocked={walletBlocked("derby")} unavailable={typeBlocked("derby")} />
          </div>
          <p className="text-xs text-neutral-500"><Link className="underline" href="/burnticker/templates">Templates</Link> has twelve ready shapes. The weather template opens the review card ready to launch. The others open the screen where you make the last choice.</p>
        </section>
      )}

      {/* ---------------------------------------------------------------- TEAM COIN ---------------------------------------------------------------- */}
      {flow === "team" && step === "team" && (
        <section className="space-y-4">
          <div className={card + " space-y-3"}>
            <h2 className="font-medium">1. Pick a league</h2>
            {leaguePicker}
          </div>
          {leagueSeries && (
            <div className={card + " space-y-3"}>
              <div className="flex items-center justify-between gap-2 flex-wrap"><h2 className="font-medium">2. Pick your team<FieldHelp id="team-pick" /></h2><FieldHelp id="team-search" /><input data-decision="what" data-help="team-search" aria-label="Search teams in this league" className={input + " w-full sm:w-64"} placeholder="Rays, Lakers, Oilers, Arsenal, Inter Miami…" value={teamQ} onChange={(e) => setTeamQ(e.target.value)} /></div>
              {teamsBusy && <p className="text-sm text-neutral-500">Loading teams…</p>}
              {scheduleNote && <p className="text-sm text-amber-300" role="status">{scheduleNote}{scheduleDetail && <span className="block text-xs text-neutral-500">Technical detail: {scheduleDetail}</span>}</p>}
              {!teamsBusy && !teams.length && <p className="text-sm text-neutral-500">No teams found for this league right now.</p>}
              <div className="grid gap-2 sm:grid-cols-2">{teams.filter(teamFilter).map((t) => (
                <button data-decision="what" key={t.abbr} onClick={() => chooseTeam(t)} className={`flex items-center gap-3 rounded-lg border p-2 text-left hover:border-amber-400 ${team?.abbr === t.abbr ? "border-amber-400" : "border-neutral-800"}`}>
                  {badge(t.abbr)}
                  <div className="min-w-0"><div className="font-medium truncate">{t.name}</div><div className="text-xs text-neutral-400">{t.recordText === null ? "record —" : `${record(t)} this season`}{t.next ? ` · next: ${t.next.opponent ? `vs ${t.next.opponent}` : t.next.title}, result ~${denver(t.next.expectedAt)}` : ""}</div></div>
                </button>
              ))}</div>
              <p className="text-xs text-neutral-500"><span className="bt-chip bt-chip-feed mr-1">on-chain payout · league&apos;s official feed</span>Each game settles on {SPORTS_PROVENANCE.settlement}. {sportsConfirmationLine()} Next games come from {SPORTS_PROVENANCE.schedule}. Times are in Denver time.</p>
            </div>
          )}
          {navRow(null)}
        </section>
      )}

      {/* ---------------------------------------------------------------- MATCHUP PAIR ---------------------------------------------------------------- */}
      {flow === "pair" && step === "pick" && (
        <section className="space-y-4">
          <div className={card + " space-y-3"}><h2 className="font-medium">1. Pick a league</h2>{leaguePicker}</div>
          {leagueSeries && (
            <div className={card + " space-y-3"}>
              <div className="flex items-center justify-between gap-2 flex-wrap"><h2 className="font-medium">2. Pick the game</h2><FieldHelp id="game-search" /><input data-decision="what" data-help="game-search" aria-label="Search games by team" className={input + " w-full sm:w-64"} placeholder="search a team: Lakers, Oilers, Arsenal…" value={gameQ} onChange={(e) => setGameQ(e.target.value)} /></div>
              {gamesBusy && <p className="text-sm text-neutral-500">Loading games…</p>}
              {scheduleNote && <p className="text-sm text-amber-300" role="status">{scheduleNote}{scheduleDetail && <span className="block text-xs text-neutral-500">Technical detail: {scheduleDetail}</span>}</p>}
              {!gamesBusy && !games.length && <p className="text-sm text-neutral-500">No upcoming games{gameQ ? ` matching “${gameQ}”` : ""}.</p>}
              <ul className="divide-y divide-neutral-800">{games.map((g) => (
                <li key={g.eventTicker}><button data-decision="what" onClick={() => { markOrigin("matchup"); setSrcWarnings(scheduleNote ? [scheduleNote] : []); chooseGame(g); }} className="flex w-full items-center gap-3 py-2 text-left hover:bg-neutral-800/40">
                  {badge(g.pair!.a.abbr)}<span className="text-neutral-500 text-xs">vs</span>{badge(g.pair!.b.abbr)}
                  <span className="min-w-0"><span className="block font-medium truncate">{g.pair!.a.name} vs {g.pair!.b.name}</span><span className="block text-xs text-neutral-400">result ~{denver(g.expectedAt)} (Denver){g.pair!.tieMarket ? " · this league has draws" : ""}{g.refused.length ? ` · ${refusedLine(g.refused)}` : ""}</span></span>
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
            <h2 className="font-medium">Search adjudicated markets by name</h2>
            <FieldHelp id="market-search" /><input data-decision="what" data-help="market-search" autoFocus aria-label="Search markets by name" className={input + " text-base py-2"} placeholder="a team, a player, a person, a show, a city, an election…" value={q2} onChange={(e) => setQ2(e.target.value)} />
            {findBusy && <p className="text-sm text-neutral-500">Searching…</p>}
            {found && (() => {
              const evs = (
                <div key="events" className="space-y-2">{found.events.length > 0 && <h3 className="text-xs uppercase tracking-wide text-neutral-500">Games and events{chip("kalshi")}</h3>}{found.events.map((e) => (
                  <div key={e.eventTicker} className="rounded border border-neutral-800 p-2">
                    <div className="text-sm font-medium">{e.title} <span className="text-xs text-neutral-500">{e.subTitle ?? ""} · result ~{denver(e.expectedAt)}</span></div>
                    {e.refused.length > 0 ? <p className="text-xs text-red-400">{refusedLine(e.refused)}</p> : <>
                      {e.pair && <button data-decision="what" className="mt-1 text-xs underline text-amber-300" onClick={() => { markOrigin("exact"); chooseGame(e); }}>Make a matchup pair from this game →</button>}
                      <ul className="mt-1 text-xs text-neutral-400 space-y-0.5">{e.markets.slice(0, 12).map((m) => <li key={m.ticker} className="flex items-center justify-between gap-2"><span><code>{m.suffix}</code> {m.label}</span><button data-decision="what" className="underline" onClick={() => { markOrigin("exact"); setPick({ oracle: "kalshi", series: null, market: m.ticker, title: `${e.title} — ${m.label} (resolves once)` }); setKind("binary"); next(); }}>burn on this market →</button></li>)}</ul>
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
                  {pm.markets.map((m) => <div key={m.conditionId} className="flex items-center justify-between gap-2 rounded border border-neutral-800 p-2 text-sm"><span>{m.question} <span className="text-xs text-neutral-500">YES = {m.yes}, NO = {m.no}</span></span><button data-decision="what" className="text-xs underline" onClick={() => pickPoly(m)}>burn on this market →</button></div>)}
                  {pm.events.map((e) => (
                    <div key={e.slug} className="rounded border border-neutral-800 p-2">
                      <div className="text-sm font-medium">{e.title}{chip("polymarket")} <span className="text-xs text-neutral-500">ends ~{denver(e.endDate)}</span></div>
                      {e.refused.length > 0 ? <p className="text-xs text-red-400">{refusedLine(e.refused)}</p> : <>
                        {/* one outcome = one yes/no market (the owner's Best Picture case): pick a name; "every market" is Advanced only */}
                        <ul className="mt-1 text-xs text-neutral-400 space-y-0.5">{e.markets.map((m) => <li key={m.conditionId} className="flex items-center justify-between gap-2"><span>{m.outcome ?? m.question}{m.outcome ? null : <span className="text-neutral-500"> (YES = {m.yes}, NO = {m.no})</span>}</span><button data-decision="what" className="underline" onClick={() => pickPoly(m)}>{m.outcome ? "burn if this one wins →" : "burn on this market →"}</button></li>)}</ul>
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
            <nav aria-label="Categories" className="bt-tabs md:flex-col md:overflow-visible">
              {cats.map((c) => <button data-decision="what" key={c.id} className={`bt-tab md:text-left md:rounded-md${cat === c.id ? " is-active" : ""}`} onClick={() => { setCat(c.id); setDrill(null); }} title={c.blurb}>{c.label}</button>)}
              {!cats.length && <span className="text-sm text-neutral-500">Loading categories…</span>}
            </nav>
            <div className="min-w-0 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm text-neutral-400 flex-1 min-w-0">{cats.find((c) => c.id === cat)?.blurb ?? ""}</p>
                <FieldHelp id="browse-filter" /><input data-decision="what" data-help="browse-filter" className={input + " w-full sm:w-64"} placeholder="filter this category…" value={bq} onChange={(e) => setBq(e.target.value)} aria-label="Filter sources" />
              </div>
              {curCat?.adjudicatedOnly && <p className="rounded border border-dashed border-neutral-700 p-2 text-xs text-neutral-400">No first-party source qualifies for this category. So only settled Polymarket markets are listed, and each one settles on Polymarket&apos;s on-chain payout.</p>}
              {curCat?.guided === "elections" && venues.polymarket && (
                <div className={card + " space-y-3"} aria-label="Elections">
                  <h3 className="font-medium">Pick a race</h3>
                  <div className="flex flex-wrap items-center gap-2"><FieldHelp id="race-type" />{etypes.map((t) => <button data-decision="what" key={t.id} className={`bt-tab${etype === t.id ? " is-active" : ""}`} onClick={() => { setEtype(t.id); setEstate(null); }}>{t.label} <span className="bt-tab-count">{t.races}</span></button>)}{!etypes.length && (etypesErr ? <span className="text-xs text-red-400">{etypesErr}</span> : <span className="text-xs text-neutral-500">Loading races…</span>)}</div>
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
                          <button data-decision="what" className="text-xs underline text-amber-300" onClick={() => { markOrigin("browse"); setSrcWarnings([]); setEventInfo({ question: o.question, url: r.url, outcome: `“${o.yes}”`, resolves: r.settlesOn, criteria: r.description }); applyRule(o.rule, { oracle: "polymarket", series: null, market: o.conditionId, title: `${o.label} wins the ${r.title.replace(/ Election Winner$/, "")} race (resolves once)`, yes: o.yes, no: o.no }, { name: `${o.label.replace(/\s*\([A-Z]\)$/, "").split(" ").pop()} Wins`, ticker: (o.label.replace(/\s*\([A-Z]\)$/, "").split(" ").pop() ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10), how: `${o.settles}${r.description ? `\n\nResolution rules (Polymarket): ${r.description}` : ""}`, settlement: `${r.settlement} — ${r.sos.name}` }); }}>Use: {o.label} wins →</button>
                        </li>
                      ))}</ul>}
                      {r.description && <details className="mt-1 text-xs text-neutral-400"><summary className="cursor-pointer">How this settles</summary><p className="mt-1 whitespace-pre-wrap">{r.description}</p></details>}
                    </div>
                  ))}
                </div>
              )}
              {cardsBusy && <p className="text-sm text-neutral-500">Loading sources…</p>}
              {!cardsBusy && cards && cards.length === 0 && <p className="rounded border border-dashed border-neutral-700 p-4 text-sm text-neutral-400">This site has no source in this category{bq ? ` matching “${bq}”` : ""} yet.</p>}
              <div className={`grid gap-2 lg:grid-cols-2${cardsBusy ? " opacity-50" : ""}`} aria-busy={cardsBusy}>{(cards ?? []).map((c) => (
                <div key={c.id} className={`rounded-lg border p-3 text-sm ${c.launchable.ok ? "border-neutral-800 bg-neutral-900" : "border-neutral-900 opacity-70"}`}>
                  <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
                    <span className={`bt-chip bt-chip-${c.venue}`}>{c.venue === "feed" ? "Feed" : c.venueLabel}</span>
                    <span className="text-neutral-500">tier {c.tier} · {c.tierLabel}</span>
                    <span className="ml-auto text-neutral-500">{c.kind === "scalar" ? "a number" : "yes / no"}</span>
                  </div>
                  <div className="mt-1 font-medium leading-snug">{c.title}</div>
                  <div className="text-xs text-neutral-500">{c.venue === "feed" ? c.sourceName : ""}{c.cadence ? `${c.venue === "feed" ? " · " : ""}${c.cadence}` : ""}</div>
                  <div className="mt-1 text-xs text-neutral-300">{c.example}</div>
                  {c.next && <div className="text-xs text-neutral-500">{c.next.at ? `${c.next.label} · ${denver(c.next.at)}` : c.next.label}</div>}
                  {c.refused.length > 0 && <div className="text-xs text-red-400">{refusedLine(c.refused)}</div>}
                  <div className="mt-2 flex flex-wrap gap-3 text-xs">
                    {c.configure?.kind === "team" ? <button data-decision="what" disabled={cardsBusy} className="underline text-amber-300 disabled:opacity-50" onClick={() => { const lg = c.configure!.kind === "team" ? c.configure!.league : null; begin("team"); setTimeout(() => setLeagueSeries(lg), 0); }}>pick a team →</button>
                    : c.configure?.kind === "weather" ? <button data-decision="what" disabled={cardsBusy} className="underline text-amber-300 disabled:opacity-50" onClick={() => setWx({ metric: c.configure!.kind === "weather" ? c.configure!.metric : "high", station: "DEN", threshold: c.configure!.kind === "weather" && c.configure!.metric === "rain" ? "0.50" : "90" })}>choose a station →</button>
                    : c.launchable.ok ? <button data-decision="what" disabled={cardsBusy} className="underline text-amber-300 disabled:opacity-50" onClick={() => {
                      const src = c.pick.oracle === "catalogue" ? sources.find((x) => x.id === c.pick.series) : undefined;
                      markOrigin("browse"); setSrcWarnings([]); setShareNotice(null);
                      setPick({ ...c.pick, source: src }); setFilter(""); setKind(c.kind);
                      if (c.kind === "scalar" && c.pick.oracle === "kalshi") { setUnit(1); setDirection("up"); setBaseline("previousSettlement"); }
                      next();
                    }}>use this source →</button> : <span className="text-neutral-500">not launchable{c.launchable.why ? `: ${c.launchable.why}` : ""}</span>}
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
              {browseErr.length > 0 && <p className="text-xs text-neutral-500">Some sources did not answer just now, so this list may be incomplete. <span className="text-neutral-600">Technical detail: {browseErr.join("; ")}</span></p>}
            </div>
          </div>
          {navRow(null)}
        </section>
      )}

      {/* -------------------------------------------- REVIEW (every flow): the one screen between "what burns it" and the signature -------------------------------------------- */}
      {step === "review" && rule && (() => {
        const shareText = pct(shareValue);
        const A = sideA?.nickname ?? sideA?.name ?? "side A", B = sideB?.nickname ?? sideB?.name ?? "side B";
        const coinA = { key: "a", name, ticker, onName: (v: string) => { setName(v); setNameAuto(false); noteEdit(); }, onTicker: (v: string) => { setTicker(v); setTickerAuto(false); noteEdit(); }, image: genImg(rule, ticker, oneLiner), oneLiner, oracle: pairOn ? "catalogue" : pick?.oracle ?? "catalogue", badge: text?.badge ?? null };
        const coins = pairOn && ruleB ? [coinA, { key: "b", name: nameB, ticker: tickerB, onName: (v: string) => { setNameB(v); noteEdit(); }, onTicker: (v: string) => { setTickerB(v); noteEdit(); }, image: genImg(ruleB, tickerB, textB?.oneLiner ?? ""), oneLiner: textB?.oneLiner ?? ruleOneLiner(ruleB), oracle: "catalogue", badge: textB?.badge ?? null }] : [coinA];
        const sentence = pairOn && sideA && sideB
          ? (season ? `$${ticker} burns ${shareText} of its pool every time the ${A} lose this season, and $${tickerB} does the same for the ${B}: two coins, two separate records.` : `When ${game?.title ?? "the game"} is final, the losing team's coin burns ${shareText} of its pool — $${ticker} if the ${A} lose, $${tickerB} if the ${B} lose. A tie burns neither.`)
          : text ? text.ruleBlock.split(/(?<=\.)\s/)[0] : plainSentence(rule, ticker, pick?.title ?? bt?.seriesTitle ?? null);
        const problems = btFresh ? [...(bt?.refusals ?? []), ...(pairOn ? btB?.refusals ?? [] : [])].map((r) => r.reason) : [];
        const ready = !!name.trim() && okTicker(ticker) && (!pairOn || (!!nameB.trim() && okTicker(tickerB) && ticker !== tickerB)) && !noteProblem;
        return (
          <>
            <ReviewCard
              coins={coins}
              sentence={sentence}
              pairLine={pairOn && !ruleB ? PAIR_REVIEW_LINE : null}
              ends={endsLine(text)}
              shares={{ options: [...shareOptions], value: shareValue, onChange: (v) => { flowStats.current.decisions++; setDial("fraction", v); } }}
              durations={pairOn ? { options: [{ value: "game", label: "until the result" }, { value: "season", label: "this season" }], value: pairMode === "game" ? "game" : "season", onChange: (v) => { flowStats.current.decisions++; setPairMode(v === "game" ? "game" : "season"); } } : null}
              note={pairOn ? null : { value: note, onChange: setNote, problem: noteProblem }}
              problems={problems}
              error={launchErr}
              busy={busy}
              ready={ready}
              creator={creator || null}
              onLaunch={() => { void launch(); }}
              summary={<PreWalletSummary review={review} loading={reviewBusy} error={reviewErr} />}
              blocked={walletBlocked(pairOn ? "matchup" : launchTypeOf(rule))}
              warnings={srcWarnings}
              shareNotice={shareNotice}
              event={flow === "single" && pick?.oracle === "polymarket" && !pairOn ? eventInfo : null}
              namePrompt={!pairOn && text?.name === "Event Coin" ? "This question does not give a clear coin name: please name the coin (and check the ticker) before you launch." : null}
            />
            {/* website brief §2: the funds flow before a registered pair launches (pairs made now are winner-takes-the-burn) */}
            {pairOn && !ruleB && <PairFundsFlow version="winner-takes-the-burn" tickers={{ a: ticker || "A", b: tickerB || "B" }} open />}
            {pairOn && ticker && ticker === tickerB && <p className="text-xs text-red-400">The two coins need different tickers.</p>}
            <p className="text-xs"><button className="underline" data-nav onClick={back}>← Back</button></p>
          </>
        );
      })()}

      {/* ------------------------------------- LAUNCH: sign and send (SignCard: the same component for one coin, two coins and the pair curve) ------------------------------------- */}
      {step === "launch" && (bundle || pcOut) && (() => {
        const plan = pcOut ? pairCurvePlan(pcOut.pc, pcOut.keys, { a: ticker, b: tickerB }) : pairOut ? launchlabPlan([pairOut.a, pairOut.b]) : launchlabPlan([bundle!]);
        const two = !!(pcOut || pairOut);
        return (
          <section className="space-y-3 text-sm">
            <SignCard plan={plan} creator={creator || null} title={two ? `Launch $${ticker} and $${tickerB}` : `Launch $${ticker}`} coinHref={(t) => `/burnticker/t/${t}`} />
            <p className="text-xs text-neutral-500">The drafts are registered; they go live once the launch transaction{two ? "s are" : " is"} confirmed and read back from the chain.</p>
          </section>
        );
      })()}
    </main>
  );
}
