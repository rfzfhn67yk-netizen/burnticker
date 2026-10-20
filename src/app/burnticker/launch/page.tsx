"use client";

import { coinCanonicalHref } from "@/lib/burnticker/coinKey";
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
import { useScrollEdges } from "../_components/useScrollEdges";
import { CoinVsCoinTile, CVC_STORE, type TileAnswers } from "./CoinVsCoinTile";
import { LAUNCH_START_EVENT } from "@/lib/burnticker/launchStart";
import { SignCard } from "./SignCard";
import { MintAddressBlock, useMintPool } from "./MintSearch";
import { parseWalletProof, PROOF_MAX_AGE_MS, requireLaunchProof, sendWithProofFallback, signLaunchRequest, walletPromptCount, type WalletProof } from "@/lib/burnticker/walletProof";
import { base58, secretBase58, serverKeyFor, withLocalKey, withServerKey, MINT_MISMATCH_LINE, type GroundMint } from "@/lib/burnticker/vanityMint";
import { dropsKeptMint, keptMintKey, keptMintText, PREPARED_MINT_STORE, withKeptMint } from "@/lib/burnticker/keptMintKey";
import { launchlabPlan, pairCurvePlan, withPlanDeadline } from "@/lib/burnticker/signPlan";
import type { SerializedIx } from "@/lib/burnticker/program";
import { ReviewCard } from "./ReviewCard";
import { electionPairIdentity } from "@/lib/burnticker/electionPairLabels";
import { launchErrorMessage, LaunchRequestError, PAIR_CURVE_REVIEW_LINE, postPairLaunch, venueFor, venueFrom409, type LaunchErrorBody, type PairVenue } from "@/lib/burnticker/pairLaunchClient";
import type { PairCurveLaunchBundle } from "@/lib/burnticker/pairCurveLaunch";
import { STATIONS, nwsSeries, parseNwsSeries, stationOptionLabel } from "@/lib/burnticker/sources/nws";
import { applyDial, dialsFor, ON_END_DEFAULT, TEAM_RESULTS_LABEL, type DialId } from "@/lib/burnticker/dials";
import { DEFICIT_SITE } from "@/lib/burnticker/creatorLaunches";
import { NO_WALLET_LINE } from "@/lib/burnticker/glossary";
import { LaunchRecovery } from "./LaunchRecovery";
import { LAUNCH_GATE_LOADING, launchGateFromCatalogue, wizardMayRender, wizardMaySign, type LaunchGateState } from "@/lib/burnticker/launchGateState";
import { availabilityFromCatalogue, launchTypeOf, PREVIEW_BANNER, siteLaunchStateFromCatalogue, SITE_LAUNCH_STATE_LOADING, type LaunchAvailabilityModel, type LaunchType, type SiteLaunchState } from "@/lib/burnticker/launchAvailability";
import { createReviewRequester, draftHeldNotices, EMPTY_REVIEW_SLOT, keptReviewProof, keptReviewProofText, lapsedKeptProof, launchRevisions, REVIEW_PROOF_STORE, reviewFor, reviewIdentity, reviewMatchesDraft, reviewProofExpiresAt, REVIEW_UPDATING, usableReviewProof, type ReviewSlot } from "@/lib/burnticker/launchReviewSync";
import { DEFAULT_SHARE, SLICED_ABOVE, isRaisePreset, shareOf, SHARE_PRESETS, presetRowLabel, pctLabel as presetPct, snapToPreset, DEFAULT_RAISE_SOL, RAISE_PRESETS_SOL, LINKED_ONE_SHOT_LINE, shareShapeOf, sharePresetsForRule, type RaisePreset } from "@/lib/burnticker/launchPresets";
import { loadCatalogue } from "@/lib/burnticker/catalogueClient";
import { NEXT_GAME_UNAVAILABLE, sourceUnavailableLine, sportsConfirmationLine, sportsProvenanceLine, SPORTS_PROVENANCE } from "@/lib/burnticker/sources/provenance";
import { PreWalletSummary } from "./PreWalletSummary";
import { offSeasonLine } from "@/lib/burnticker/hazardSeason";
import { popstateFollows, stepAddress, stepHistoryAction, triggerEditPhase } from "@/lib/burnticker/stepHistory";
import { BurnRealChoice } from "./BurnRealChoice";
import { ownRealPicks, SIDE_REAL_OFF, realBlockers, realField, realReviewNotes, withRealBurn, type SideReal } from "./burnReal";
import { BACKTEST_UNAVAILABLE } from "@/lib/burnticker/oracle/backtest";
import { BACKTEST_SLOW } from "@/lib/burnticker/api/backtestWait";
import { EMPTY_PROFILE, ProfileFields, chosenPreview, profileBody, profileFieldId, type ProfileUpdate, type ProfileValue } from "./ProfileFields";
import { NAME_STEP_BLOCKED, NAME_STEP_CHECKING, fieldRuleSentence, isLintLine, nameStepWaitsForReview, noteIssue, profileIssues, serverFieldProblems } from "./fieldChecks";
import { realBurnAllowed, dropIneligibleBurnTarget } from "@/lib/burnticker/burnRealEligibility";
import { changeRuleEdgeIds } from "@/lib/burnticker/changeRule";
import { endChoicesFor, perCoinEndLines } from "@/lib/burnticker/pairEnds";
import { RESERVED_TICKER_LINE } from "./pageCopy";
import { CLOSE_PASSED_CHIP, JUMP_CONFIRM_LINE, JUMP_CONFIRM_NO, JUMP_CONFIRM_YES, NO_SECOND_CHECK, pairBudgetLine, TEAMS_NONE_LINE, TEAMS_UNREAD_LINE, humanDay, leagueButtonName, leagueButtonTitle, winPairNames } from "./pageCopy";
import { teamAdvancedDefaults } from "@/lib/burnticker/creatorCopy";
import { nameProblem, tickerProblem, wxThresholdProblem } from "@/lib/burnticker/launchFields";
import { ruleSide, suggestionFor, suggestionFromDraft, type SourceSuggestion } from "@/lib/burnticker/namePolarity";
import { composeRule, END_CHOICE_RESET_NOTICE, endChoiceOffered, fieldsFromRule, launchBody, migrateLinkedShare } from "@/lib/burnticker/launchDraft";
import { preparedRulesCheckWeb, PREPARED_MISSING_LINE } from "@/lib/burnticker/preparedRules";
import { filterOutcomes, outcomesShownLine } from "@/lib/burnticker/oracle/outcomeFilter";
import { VERSION_CHECK_EVENT } from "@/lib/burnticker/buildVersion";
import { DRAFT_STORE, KEPT_STORE, RESUME_PARAM, RESUME_REVIEW, isReviewedDraft, pickOffer, savedDraftLine } from "@/lib/burnticker/launchDraftStore";
import type { LaunchReview } from "@/lib/burnticker/launchReview";
import { LaunchGate } from "./LaunchGate";
import { CreatorOnboarding } from "../_components/CreatorOnboarding";
import { CreatorBenefitsList } from "../templates/CreatorBenefitsList";
import { ExampleTickets } from "../templates/ExampleTickets";
import { EXAMPLES_AND_BENEFITS_LABEL } from "@/lib/burnticker/exampleTickets";
import { DuplicateNotice } from "./DuplicateNotice";
import type { ExistingCoin } from "@/lib/burnticker/duplicateRule";
import { PairFundsFlow } from "../_components/PairFundsFlow";
import { FundsFlowView, type Blocker, type LaunchVenue, type ProfileFieldKey } from "./ReviewCard";
import { championOutcomeSuggest, championPathRule, describeRule, shortDate, windowKindOf, DESCRIPTION_MAX, PAIR_REVIEW_LINE, independentPairFacts, winnerTakesBurnFacts, type CoinText, type DescribeCtx } from "@/lib/burnticker/describe";
import { LEAGUES, LIVE_NOW, leagueCannotTie, parseEspnSeries, seasonLabel, seasonYearAt, teamSeries, type LeagueId, type Window as TeamWindow } from "@/lib/burnticker/sources/espn";
import { TEMPLATES, TEMPLATE_START, weatherTemplateDraft, type TemplateId } from "@/lib/burnticker/templates";
import type { Suggestion as SearchSuggestion } from "@/lib/burnticker/search";
import { fold, meaningful, queryTokens } from "@/lib/burnticker/textMatch";
import { EndChoicePicker } from "./EndChoicePicker";
import { SimulatorDisclosure } from "./SimulatorDisclosure";
import { BARE_COIN_ACTION, NO_MATCH_LEAD, NO_MATCH_SEPARATOR, bareCoinLine, bareTickerOf, pythCoinOf, EVENT_SEARCH_HINT, PICK_BOTH_LINE, OPEN_NOW_CATEGORIES, OPEN_NOW_LABEL, openNowCards, openNowEndsLine, relatedCardLine, BACKTEST_WAITING_LINE, backtestSourceOf, byeLine, nextGameWords, VISITOR_TIME_LINE, visitorTime, END_CHOICE_DEFAULT, endChoiceChangedLine, endChoiceModel, followForPick, oneMarketDate, pastedLink, PASTED_LINK_REFUSAL, patternFollowFor, withEndChoice, type EndChoice } from "@/lib/burnticker/guidedLaunch";
import type { SinkCoin } from "@/lib/burnticker/endSinks";
import { RereadCache } from "@/lib/burnticker/rereadCache";
import { EndSection, FollowStep, GuidedTop, PatternStep, RivalryKindStep, StickyAction, type GuidedPhase } from "./GuidedSteps";
import { edgeCase, edgeCaseFor, reviewEdgeIds } from "@/lib/burnticker/ruleEdgeCases";
import { sosLinkLabel } from "@/lib/burnticker/sosLabel";

import { oneShotFull } from "@/lib/burnticker/nextResult";
import { creatorLinks } from "@/lib/burnticker/creatorProfile";
import { drainLine, teamDrainUnit } from "@/lib/burnticker/drain";
import { NO_TITLE_MARKET_LINE, SEASON_OVER_LINE, SEASON_OVER_LINK_LINE, NONE_LISTED_LINE, nextSeasonButtonLabel, seasonOverRefusal, seasonOverOrder, seasonOverRowTag, seasonOverSummaryLine } from "@/lib/burnticker/seasonOver";
import { sourceSubjectLabel } from "@/lib/burnticker/paramNames";
import { prepareIfCurrent, profileRevision, STALE_PREPARE_SENTENCE } from "@/lib/burnticker/preparedLaunch";
import { endText, GAME_PAIR_SENTENCE_NO_TIE, settledPairSentence } from "@/lib/burnticker/describe";
import { PARTIES_PAIR_SENTENCE, isPartySubject } from "@/lib/burnticker/pairFundsFlow";
import { SETTLED_DEADLINE_LINE, SETTLED_END_LABEL, settledAsShown, settledPairBody, settledPairFields, settledWhichCoinLine, partyPairNames, type SettledPick } from "./settledPair";
import { HAZARD_FOLLOW, HAZARD_KINDS, HAZARD_MEASURES, hazardControls, hazardHelpId, hazardPatternOptions, hazardPatternSwitch, hazardSeriesFor, hazardSwap, isHazardSeries, hazardAlternateName, type HazardKindId } from "@/lib/burnticker/hazards";
import { FACT_LABELS, PATTERN_REASON, PERPETUAL_END_LINE, NO_LISTED_MEETING_LINE, RIVAL_SAME_TEAM, RIVALRY_GAME_LABEL, RIVALRY_GAME_LINE, RIVALRY_SCOPE_LINE, RIVALRY_SEASON_LABEL, RIVALRY_SEASON_LINE, RIVALRY_SERIES_LABEL, RIVALRY_SERIES_LINE, MEETINGS_END_LABEL, MEETINGS_DEADLINE_LINE, MEETINGS_LIST_LABEL, PATTERNS, meetingsEndLine, meetingsListRows, meetingsPairNames, meetingsPairRules, meetingsPairSentence, meetingsWhichCoinLine, seriesOptionState, type MeetingRow, SCHEDULE_UNAVAILABLE_LINE, meetingsOf, scheduleCoverageLine, seasonPairNames, costLine, electionAuthorityLines, patternWords, shareExample, upfrontLines, whichCoinLine, whichHeading, FOLLOW_CHOICES, activeUnit, eventForSide, followForRule, keptProfileLine, keptProfileParts, KEPT_PROFILE_FRESH, KEPT_PROFILE_REUSE, IMAGE_RIGHTS_REQUIRED, oneGameShare, PAIR_COST_EXCLUSIONS, mappingWarning, partyMarketWarning, pickDescribesRule, renderWarnings, reviewBlockers, shareOfBudgetLine, rivalrySeasonLine, stablePatternOptions, teamLine, triggerText, whichAnswer, IMAGE_NOT_KEPT, meetingOf, otherTeams, seasonPairRules, RESERVED_REFUSAL, beforeGraduationLine, pairDiagramLabel, namesRemadeLine, namesChangeOf, type NamesChange, budgetCopy, oneShotSentences, candidateFacts, candidatesPairRule, endSentences, gamePairFacts, gamePairRule, matchupFacts, pairIdentityProblems, pairNames, patternOptions, teamTicker, teamTickerForRule, unitPhrase, type FollowId, type PatternId } from "@/lib/burnticker/guidedLaunch";
import type { TickerCheck } from "@/lib/burnticker/tickerCheck";
import { autoTickerSwaps, freePairTickers, hazardSwapLine, pairTickerSwapLine, type TickerGuard } from "@/lib/burnticker/tickerSwap";
import { PICKER_PAGE, pickerPage } from "@/lib/burnticker/polySearch";
import { draftKeys, keyRotatingFetch } from "@/lib/burnticker/prepareKey";
import { PLAN_EXPIRED_SENTENCE, planExpired, planExpiresInMs } from "@/lib/burnticker/planAge";

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
interface ElOutcome { conditionId: string; label: string; question: string; yes: string; no: string; title: string; settles: string; rule: BurnRule; /** elections.ts RaceOutcome: the market is the party's result, not the candidate's by name */ partyMarket?: boolean; /** sources-6 (audit 10 #5): which market a candidate's coin settles on, and what a replaced nominee does */ mapping?: string | null }
interface ElRace { slug: string; title: string; url: string; settlesOn: string | null; description: string | null; hiddenPlaceholders: number; sos: { name: string; url: string }; settlement: string; refused: string[]; outcomes: ElOutcome[] }
interface ElPairSide { candidate: string; name: string; ticker: string; components: { fecBeats: BurnRule | null; winner: BurnRule }; sentences: { fecBeats: string | null; winner: string }; outcome: { conditionId: string; question: string; yes: string; no: string } }
interface ElPair { a: ElPairSide; b: ElPairSide; crossRead: { name: string; url: string }; pending: string[] }
interface SourceCardT { id: string; venue: "feed" | "polymarket" | "kalshi"; venueLabel: string; tier: number; tierLabel: string; title: string; cadence: string | null; kind: "binary" | "scalar"; next: { label: string; at: string | null } | null; example: string; launchable: { ok: boolean; why: string | null }; refused: string[]; diagnostics?: string[]; flags: string[]; sourceName: string | null; sourceUrl: string | null; /** sources-3: the single-publisher settlement sentence (hazard feeds only) */ settlement?: string | null; /** sources-4 205: the parameter example's note */ paramNote?: string | null; /** sources-4 213: a title with a blank, resolved per child market */ outcomes?: { question: string; market: string }[] | null; pick: { oracle: "catalogue" | "polymarket" | "kalshi"; series: string | null; market: string | null; title: string }; configure?: { kind: "team"; league: string } | { kind: "weather"; metric: "high" | "rain" | "snow" } | null }
interface Series { ticker: string; title: string; category: string | null; frequency: string | null; settlementSource: { name: string; url: string } | null; refused: string[] }
interface Source { id: string; kind: string; tier: number; tierLabel: string; title: string; sourceName: string; sourceUrl: string; cadence: string; unit: { size: number; label: string; definition: string } | null; direction: "up" | "down" | "abs" | null; baseline: "previousSettlement" | number | null; flags: string[]; launchable: { ok: boolean; why: string | null }; param: string | null; lastReading: { id: string; value: string | null; at: string } | null; readings: { id: string; value: string | null }[]; preview: { window: { from: string; to: string }; units: number; burnEvents: number; poolFractionSpent: number | null } | null }
interface Backtest { sentence: string; text: string; sha256: string; sha12: string; mode: string; statement: string; seriesTitle: string | null; refusals: { reason: string }[]; matched: number; backtest: { rows: { id: string; at: string; title: string | null; result: string | null; value: string | null; units: number; kind: string }[]; totals: { events: number; burnEvents: number; voids: number; units: number; poolFractionSpent: number | null; tokens: number | null }; oneShot: { resolvesOn: string | null } | null } }
interface Bundle { ready: boolean; pending: string[]; mint: string; ticker: string; mintSecretKey: string | null; rules: { text: string; sha256: string; statement: string; mode: string }; addresses: { feePda: string; feeWsol: string; vault: string | null; poolId: string | null; platformId: string }; transactions: { label: string; signers: string[]; instructions: SerializedIx[] }[]; notes: string[] }
interface League { id: string; label: string; series: { ticker: string; title: string }[]; sport?: string; crossRead?: string | null; draws?: boolean }
interface Team { /** website-25 (WIRING-SOURCES7 H6): /v1/sports/teams says this team's season is over */ seasonOver?: boolean; /** WIRING-PARITY audit 6 #2: the season's state for this team, with its warning when no game is left */ seasonWarning?: string | null; abbr: string; /** sources-6 (QA 9 #29): the code shown and used for tickers; `abbr` is what the API takes */ code?: string; city: string; nickname: string | null; name: string; ticker: string; league: string | null; filter: string; collisions: string[]; next: { eventTicker: string; marketTicker: string; title: string; expectedAt: string | null; opponent: string | null; when?: string | null; /** HS-14 */ home?: boolean | null; /** HB-87 */ undecided?: boolean | null; gamesThatDay?: number | null } | null; record: { w: number; l: number; d: number; since: string }; series?: { win: string; loss: string }; recordText?: string | null }
/** The sports pickers (GET /v1/sports/teams, /v1/sports/games): the leagues' own schedules or TheSportsDB, never ESPN. */
interface SportsTeam { abbr: string; code?: string; city: string; nickname: string; name: string; ticker: string; league: string; series: { win: string; loss: string }; record?: string | null; season?: { status: "upcoming" | "none-listed" | "unknown" | "over"; warning: string | null }; next: { eventId: string; title: string; startsAt: string; detail: string; opponent: string | null; home: boolean; live?: boolean; when?: string | null; /** HB-87 */ undecided?: boolean; gamesThatDay?: number } | null }
interface SportsSide { abbr: string; code?: string; name: string; nickname: string; ticker: string; record: string | null; /** sources-6 (QA 9 #2): this side plays at home */ home?: boolean }
interface SportsGame { eventId: string; league: string; title: string; startsAt: string; detail: string; live?: boolean; when?: string | null; a: SportsSide; b: SportsSide; series: { aLoss: string; bLoss: string } }
const recordOf = (r: string | null | undefined): { w: number; l: number; d: number; since: string } => { const m = /^(\d+)-(\d+)(?:-(\d+))?$/.exec(r ?? ""); return { w: m ? Number(m[1]) : 0, l: m ? Number(m[2]) : 0, d: m && m[3] ? Number(m[3]) : 0, since: "" }; };
/** website-21: GET /v1/sports/rivalry as the step-2 option reads it (`failed`: the read itself failed, never "no game"). */
interface RivalryRead { key: string; busy: boolean; failed: string | null; offered: boolean; offeredLine: string | null; /** HB-72 consistency: the playoff warning (meetingsLeft.ts) */ warning: string | null; scheduleNote: string | null; season: string | null; year: number | null; source: string | null; meetings: MeetingRow[]; /** sources-6 (QA 9 #4): what the one-game option searched */ oneGameSearched: string | null }
interface Side { abbr: string; marketTicker: string; label: string; nickname: string | null; name: string; ticker: string; /** sources-6: the shown code (tickers); `abbr` stays the series pin */ code?: string; /** sources-6 (QA 9 #2): this side plays at home, from the schedule */ home?: boolean }
interface PolyMarket { /** audit 12 item 8: past its scheduled close and waiting for its result */ closePassed?: boolean; conditionId: string; question: string; yes: string; no: string; endDate: string | null; closed: boolean; sportsMarketType: string | null; /** the outcome's name inside its event (Gamma groupItemTitle), when named */ outcome?: string | null; /** sources-2 (oracle/polymarket.ts polyStated) */ resolutionSource?: StatedSource; finalAfter?: FinalAfter }
interface PolyEvent { closePassed?: boolean; slug: string; title: string; url: string; endDate: string | null; closed: boolean; markets: PolyMarket[]; marketCount: number; refused: string[] }
interface PolyTag { slug: string; label: string; events: number; series: string[] }
interface PolyFound { events: PolyEvent[]; tags: PolyTag[]; markets: PolyMarket[]; /** sources-6 (QA 9 #17): markets ending within 48 hours, hidden unless asked for */ hiddenClosingSoon?: number; /** audit 12 item 8: what a market past its scheduled close is */ closePassedNote?: string }
type Venue = "kalshi" | "polymarket";
interface EventHit { eventTicker: string; seriesTicker: string; title: string; subTitle: string | null; category: string | null; expectedAt: string | null; closeTime: string | null; markets: { ticker: string; suffix: string; label: string; status: string }[]; matchedSides: string[]; pair: { a: Side; b: Side; tieMarket: string | null } | null; refused: string[] }

/** The web UI's shares come from launchPresets.ts (docs/burnticker/ui-conventions.md § Presets, not dials); the API takes any share. */
const PUB = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const STORE = DRAFT_STORE;
/** Keeps a signed launch request for the review after a reload (launchReviewSync.ts keptReviewProof); private mode keeps nothing. */
function keepReviewProof(p: WalletProof): void { try { sessionStorage.setItem(REVIEW_PROOF_STORE, keptReviewProofText(p) ?? ""); } catch { /* no memory, no harm */ } }
/** LA6-4: the single coin's prepared mint key across a reload (keptMintKey.ts), read for this wallet and ticker only; private mode keeps nothing. */
function readKeptMint(creator: string | null | undefined, ticker: string): GroundMint | null { try { return keptMintKey(sessionStorage.getItem(PREPARED_MINT_STORE), { creator, ticker }); } catch { return null; } }
function keepPreparedMint(k: { creator: string | null | undefined; ticker: string; mint: string; secret: string | null }): void { try { const t = keptMintText(k); if (t) sessionStorage.setItem(PREPARED_MINT_STORE, t); } catch { /* no memory, no harm */ } }
function dropPreparedMint(): void { try { sessionStorage.removeItem(PREPARED_MINT_STORE); } catch { /* ignore */ } }
/** The draft to offer (launchDraftStore.ts pickOffer): the named one in progress, else the kept one that reached the review. */
const readOffer = (): Record<string, unknown> | null => {
  const read = (k: string): Record<string, unknown> | null => { try { const v = JSON.parse(sessionStorage.getItem(k) ?? "null") as unknown; return v && typeof v === "object" ? v as Record<string, unknown> : null; } catch { return null; } };
  return pickOffer(read(STORE), read(KEPT_STORE));
};
const V1 = "/api/burnticker/v1";
// snag 19: the year whenever it is not this year, and the zone named ("MDT"), so a date can never be read as the wrong one
const denver = (iso: string | null) => { if (!iso) return "—"; const d = new Date(iso); if (Number.isNaN(d.getTime())) return "—"; const other = d.getUTCFullYear() !== new Date().getUTCFullYear(); return new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", weekday: "short", month: "short", day: "numeric", ...(other ? { year: "numeric" as const } : {}), hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(d); };
/** website-21: a game's day in the meetings list ("Thu, Oct 23"), in Denver time, with the year only when it is not this year. */
const dayLabel = (iso: string) => { const d = new Date(iso); if (Number.isNaN(d.getTime())) return "—"; const other = d.getUTCFullYear() !== new Date().getUTCFullYear(); return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", ...(other ? { year: "numeric" as const } : {}) }).format(d); };
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
  // sources-6 (QA 9 #31): a refusal the API states (a 4xx with its own sentence) is shown as is
  if (!r.ok) throw new ReadError(r.status === 429 ? "too many requests for a moment — try again shortly" : r.status >= 400 && r.status < 500 && j?.error ? j.error : "the source did not answer just now", `HTTP ${r.status}${j?.error ? `: ${j.error}` : ""}`);
  return j as T;
};
/** A-22 (2026-10-18): the end-sink list per network, read at most once a minute (rereadCache.ts); a failed read is asked again next time. */
const sinksReads = new Map<string, RereadCache<{ sinks: SinkCoin[] }>>();
const sinksFor = (net: string, read: () => Promise<{ sinks: SinkCoin[] }>): Promise<{ sinks: SinkCoin[] }> => {
  let c = sinksReads.get(net);
  if (!c) { c = new RereadCache<{ sinks: SinkCoin[] }>(); sinksReads.set(net, c); }
  return c.get(read);
};
/**
 * sources-6 (QA 9 #40): the values the threshold selects show for the series on screen: the creator's own choice, else the one value set
 * whose series is the current one (a pattern switch carries a magnitude over), else the control's default.
 */
function hazardShownValues(kind: HazardKindId, pat: "every" | "once", series: string, chosen: Record<string, string>, now: number): Record<string, string> {
  const ctls = hazardControls()[kind][pat];
  const base = Object.fromEntries(ctls.map((c) => [c.id, chosen[c.id] ?? c.default]));
  const hit = (v: Record<string, string>) => { const r = hazardSeriesFor(kind, pat, v, now); return "series" in r && r.series === series; };
  if (hit(base)) return base;
  const [c0, c1] = ctls;
  for (const o0 of c0?.options ?? []) {
    if (!c1) { const v = { [c0.id]: o0.value }; if (hit(v)) return v; continue; }
    for (const o1 of c1.options) { const v = { [c0.id]: o0.value, [c1.id]: o1.value }; if (hit(v)) return v; }
  }
  return base;
}
/** L11: a refusal in plain words ("Burnticker does not offer coins on markets about deaths."), never an internal reference. */
const refusedLine = (reasons: string[]): string => `Burnticker does not offer coins on ${reasons.join(", or on ")}.`;
const detailOf = (e: unknown): string => (e instanceof ReadError ? e.detail : String((e as Error)?.message ?? e));
/** website-22 (QA 9 item 41): a read that a pause can fix (too many requests, a gateway that did not answer, a host that was busy). */
const transientRead = (e: unknown): boolean => /^HTTP (429|502|503|504)\b/.test(detailOf(e)) || /HTTP (429|502|503|504)\b/.test(String((e as Error)?.message ?? ""));
const RETRY_MAX = 3;
const RETRYING_LINE = "The server is busy just now, so the summary is read again in a few seconds.";
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
  /** HB-53: the press asks the wallet to sign the launch request when it can (before it connects, the usual wallet can) */
  const proofAsked = !wallet.connected || !!wallet.signMessage;
  const [flow, setFlow] = useState<Flow>("team");
  const [step, setStep] = useState<Step>("choose");
  const [cluster, setCluster] = useState<string | null>(null);
  // BURNTICKER_CREATOR_LAUNCHES_ENABLED (default off): the catalogue's launches.creators decides; until it answers a neutral skeleton
  // (launchGateState.ts — the wizard never flashes before the gate resolves; an unreadable catalogue keeps the controls hidden).
  const [gate, setGate] = useState<LaunchGateState>(LAUNCH_GATE_LOADING);
  const [venues, setVenues] = useState<{ kalshi: boolean; polymarket: boolean; feeds: boolean; pairCurve?: boolean }>({ kalshi: true, polymarket: true, feeds: true });
  // WIRING-AUDIT12 item 11: whether this host can read past daily closes (a Pyth access key); null until the catalogue is read
  const [recordKeyed, setRecordKeyed] = useState<boolean | null>(null);
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
  // launch night 2026-10-13: which league's list the last answer was for, and whether the read failed ("No teams found" showed while the
  // list was still being read, and for a read that failed)
  const [teamsFor, setTeamsFor] = useState<{ key: string; failed: boolean } | null>(null);
  const [teams, setTeams] = useState<Team[]>([]), [teamsBusy, setTeamsBusy] = useState(false), [teamQ, setTeamQ] = useState("");
  const [team, setTeam] = useState<Team | null>(null), [winLose, setWinLose] = useState<"win" | "lose">("win");
  const [games, setGames] = useState<EventHit[]>([]), [gamesBusy, setGamesBusy] = useState(false), [gameQ, setGameQ] = useState("");
  const [game, setGame] = useState<EventHit | null>(null), [swap, setSwap] = useState(false), [pairMode, setPairMode] = useState<"game" | "season" | "perpetual" | "meetings">("game");
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
  // F-3 (prelaunch audit 2026-10-16): when this page received the plan it signs (planAge.ts). A plan older than its drafts' window is not
  // signable; `clock` is re-read when the plan reaches that age and whenever the tab is shown again (a tab left open overnight).
  const [planAt, setPlanAt] = useState<number | null>(null), [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    if (planAt === null) return;
    const tick = () => setClock(Date.now());
    const timer = window.setTimeout(tick, planExpiresInMs(planAt, Date.now()) + 1_000);
    document.addEventListener("visibilitychange", tick); window.addEventListener("focus", tick);
    tick();
    return () => { window.clearTimeout(timer); document.removeEventListener("visibilitychange", tick); window.removeEventListener("focus", tick); };
  }, [planAt]);
  // the dials (dials.ts): the rule as edited on the create screen, valid while the path's own rule is unchanged (key)
  const [draft, setDraft] = useState<{ key: string; a: BurnRule; b: BurnRule | null } | null>(null);
  // THE END CHOICE (END-SINK-OPTIONS-BRIEF item 2; guidedLaunch.ts endChoiceModel): where each coin's rest goes when it does not win. A
  // linked pair keeps the pair winner and shows no choice; an independent pair's two coins pick their own.
  const [endA, setEndA] = useState<EndChoice>(END_CHOICE_DEFAULT);
  const [endB, setEndB] = useState<EndChoice>(END_CHOICE_DEFAULT);
  // launch wizard audit 2026-10-19 F4: a restored end choice the host no longer offers falls back to the default, said in one line
  const endRestored = useRef(false), [endNotice, setEndNotice] = useState<string | null>(null);
  const [sinks, setSinks] = useState<SinkCoin[] | null>(null);
  // "Launch one like this": the source coin's dials, applied once to the rule the new pick builds
  const [pendingDials, setPendingDials] = useState<{ fraction: number; side: string | null; window: string | null; games: number | null; league: boolean; from: string; inverse?: boolean } | null>(null);
  // the auto-generated description (describe.ts): the flavour line is editable (null = the template's), the rule block never is
  const [flavour, setFlavour] = useState<string | null>(null), [flavourB, setFlavourB] = useState<string | null>(null);
  const [cardCtx, setCardCtx] = useState<{ key: string; ctx: Omit<DescribeCtx, "ticker"> } | null>(null), [cardYear, setCardYear] = useState<number | null>(null), [cardSet, setCardSet] = useState<{ id: string; outcome: string } | null>(null);
  const [nameAuto, setNameAuto] = useState(true), [tickerAuto, setTickerAuto] = useState(true);
  // HB-30: a generated ticker the review's own check refuses (held, reserved or a lookalike) is replaced by the check's first free ticker;
  // the map keeps the replacement while the generators below keep proposing the refused one
  const [genFix, setGenFix] = useState<Record<string, string>>({});
  const fixGen = (t: string): string => genFix[t.toUpperCase()] ?? t;
  // owner, 2026-10-12 ("i halfway created token, named it 'Ea' and then abandoned it and tried to start another token, but the name was
  // locked on 'Ea'"): a typed name or ticker belongs to the thing it was typed for. editedFor records that subject; when the creator
  // picks a different team / market / feed / pair the fields go back to generated. Within one subject the typed value stays.
  const [editedFor, setEditedFor] = useState<string | null>(null);
  // ChatGPT launch-intent audit 2, item 3: the name and ticker the SOURCE suggests (an outcome's label, a card's ticker). A generated value
  // follows every source change; a value the creator typed is kept, and the review says so with a way back to the generated one.
  // continuous audit 2026-10-19T1919Z PROD-02: the suggestion keeps the side it was made for, so a flip to NO renames an untouched coin
  const [srcSuggest, setSrcSuggest] = useState<SourceSuggestion>({ name: null, ticker: null });
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
  const [outPick, setOutPick] = useState<{ id: string; q: string; shown?: number } | null>(null);
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
  const [eventInfo, setEventInfo] = useState<{ question: string; url: string | null; outcome: string | null; resolves: string | null; /** HB-38: the market's own close (ISO), for the Name header */ resolvesAt?: string | null; criteria: string | null; stated?: StatedJson | null; certified?: string | null } | null>(null);
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
  const [confirmOver, setConfirmOver] = useState(false);
  // website-25 (QA 11 M1): the "Follows" chip asks before it clears the later answers, and step 1 then shows the choice that was made
  const [confirmJump, setConfirmJump] = useState(false), [prevFollow, setPrevFollow] = useState<FollowId | null>(null);
  // intent audit 5 item 11: a saved draft never keeps an image; the review says so once when the draft had one
  const [imageGone, setImageGone] = useState(false);
  // walkthrough snag 7: two candidates of one race, as two coins on their own markets
  const [elPick, setElPick] = useState<{ race: ElRace; a: ElOutcome; b: ElOutcome } | null>(null);
  // the owner's live walkthrough (2026-10-12): a rivalry pair of any two teams in a league, then one game or the season
  // website-20 item 60: the entry link's own words (a template, a derby pair), kept after the address drops its parameters
  const [entry, setEntry] = useState<{ template: string | null; a: string; b: string; kind?: string | null; rivalry?: string | null } | null>(null);
  // items 154 and 155: a retry for the schedule read, and the one line that explains a cleared team
  const [pendingTeam, setPendingTeam] = useState<string | null>(null);
  // website-25 (WIRING-SOURCES7 H6): a league page link for a team whose season is over (?season=over), and the next season the creator
  // chose instead (the review's seasonOver.next: the same rule on the next season's series)
  const [deepSeasonOver, setDeepSeasonOver] = useState<string | null>(null);
  const [seasonSwap, setSeasonSwap] = useState<{ abbr: string; series: string; label: string } | null>(null);
  // item 253: the tickers the prepared plan was built for (the sign card's title and records), never the form's later edits
  const [signTickers, setSignTickers] = useState<{ a: string; b: string } | null>(null);
  const [gamesRetry, setGamesRetry] = useState(0), [rivalNote, setRivalNote] = useState<string | null>(null);
  const [rivalA, setRivalA] = useState<Team | null>(null), [rivalB, setRivalB] = useState<Team | null>(null), [rivalGame, setRivalGame] = useState<EventHit | null>(null), [rivalSeason, setRivalSeason] = useState<EventHit | null>(null);
  // website-21 (WIRING-RIVALRY-SERIES, owner 2026-10-12: "sixers vs celtics as a pair ... burn schedule based on their head-to-head games"):
  // the third rivalry option, every game between the two teams this season, read from GET /v1/sports/rivalry once both teams are picked
  const [rivalry, setRivalry] = useState<RivalryRead | null>(null), [rivalryRetry, setRivalryRetry] = useState(0), [meetingsYear, setMeetingsYear] = useState<number | null>(null);
  // website-22 (audit 10 item 11): the words, links and note kept from the coin set up before a new step-1 choice, said once on step 4
  const [keptProfile, setKeptProfile] = useState<string[] | null>(null);
  // website-22 (QA 9 item 11): the field a review Edit link points at; step 4 opens, scrolls to it and focuses it
  const [focusField, setFocusField] = useState<string | null>(null);
  // website-22 (QA 9 item 41): a 429 or a 502 from the review or the back-test is retried after a pause, a few times, then said once;
  // a new draft starts the count again
  // review of block M: the wallet's signature over the review's tickers, which lets the review count the creator's own drafts as theirs
  const [reviewProof, setReviewProof] = useState<WalletProof | null>(null);
  // LA-4: the last proof this tab dropped at its age limit (or read back already past it after a reload), so a draft-held notice for
  // that wallet and ticker says the signature ran out
  const [lapsedProof, setLapsedProof] = useState<WalletProof | null>(null);
  const [btRetry, setBtRetry] = useState<{ key: string; n: number }>({ key: "", n: 0 });
  const searchRef = useRef<HTMLInputElement>(null), [focusSearch, setFocusSearch] = useState(false);
  const lastFollow = useRef<FollowId | null>(null);
  // sources-6 (QA 9 #28): college football lists the FBS first; "Show all divisions" asks for every team
  const [teamsDivision, setTeamsDivision] = useState<"fbs" | "all">("fbs"), [divisionLine, setDivisionLine] = useState<string | null>(null);
  // sources-6 (QA 9 #17): one-time Polymarket markets closing within 48 hours, hidden unless asked for
  const [polyClosingSoon, setPolyClosingSoon] = useState(false);
  // WIRING-AUDIT12 item 13: one event's every outcome (searched by its slug, up to 200), filtered and paged here (outcomeFilter.ts)
  const [allOut, setAllOut] = useState<{ slug: string; url: string; markets: PolyMarket[] | null; failed: boolean; text: string; limit: number } | null>(null);
  const showAllOutcomes = (e: PolyEvent) => {
    setAllOut({ slug: e.slug, url: e.url, markets: null, failed: false, text: "", limit: 12 });
    getJson<PolyFound>(`${V1}/polymarket/search?q=${encodeURIComponent(e.slug)}${polyClosingSoon ? "&closingSoon=1" : ""}`)
      .then((j) => { const ev = (j.events ?? []).find((x) => x.slug === e.slug); setAllOut((a) => (a && a.slug === e.slug ? { ...a, markets: ev?.markets ?? [], failed: !ev } : a)); })
      .catch(() => setAllOut((a) => (a && a.slug === e.slug ? { ...a, failed: true } : a)));
  };
  const [hazardCatalogueOf, setHazardCatalogueOf] = useState<ReturnType<typeof hazardControls> | null>(null);
  // sources-6 (QA 9 #40): the natural disaster picked in step 2 and the threshold values chosen per pattern
  const [hazardKind, setHazardKind] = useState<HazardKindId | null>(null), [hazardVals, setHazardVals] = useState<{ every: Record<string, string>; once: Record<string, string> }>({ every: {}, once: {} });
  // website-22: the Coin comparison tile's answers for the progress strip (it walks the guided steps itself)
  const [coinAnswers, setCoinAnswers] = useState<TileAnswers | null>(null);

  const pairOn = flow === "pair";
  // 2026-10-14 night (owner: "the BURN vanity address is mandatory. Save them like pump.fun does so they launch instantly."): every coin's
  // mint address ends in burn or BURN. Launch sends no mint: the server takes a prepared key from its bank and returns its secret in the
  // bundle, checked here (withServerKey) before anything is signed. Only when the server has none ready (mint-bank-empty) does this
  // browser search (MintSearch.tsx, vanityMint.ts withMintSource), and then only the public key is sent. Keys live in page memory, never
  // in the saved draft; LA6-4: a single coin's prepared key is also kept in its own tab store (keptMintKey.ts) until launch or Start over.
  const mintPool = useMintPool();
  const mintsNeeded = pairOn ? 2 : 1;
  // website-21: a rivalry series pair (two teams, every game between them this season): one linked LaunchLab pair, side B on the mirror
  const meetingsOn = pairOn && pairMode === "meetings" && !elPick;
  const season = pairOn && pairMode !== "game";
  const sideA = game?.pair ? (swap ? game.pair.b : game.pair.a) : null, sideB = game?.pair ? (swap ? game.pair.a : game.pair.b) : null;
  // website-23 (WIRING-SETTLED-PAIRS, owner 2026-10-13): two candidates in one race and two teams in one game are ONE linked LaunchLab pair
  // (winner takes the burn, both end sinks pair-winner, 30 days both-or-neither). Side A's rule is built here; side B rides in `pair`.
  const gameSides = useMemo(() => {
    if (!pairOn || elPick || pairMode !== "game" || !sideA || !sideB) return null;
    const a = parseEspnSeries(sideA.marketTicker), b = parseEspnSeries(sideB.marketTicker);
    return a?.kind === "game" && b?.kind === "game" && a.league === b.league && a.eventId === b.eventId && a.abbr !== b.abbr ? { league: a.league, eventId: a.eventId, a: a.abbr, b: b.abbr } : null;
  }, [pairOn, elPick, pairMode, sideA, sideB]);
  // WIRING-AUDIT12 item 5: two party markets are named by the parties (the review then says PARTIES_PAIR_SENTENCE)
  const settledPick: SettledPick | null = useMemo(() => (pairOn && elPick ? { shape: "candidates" as const, market: elPick.b.conditionId, race: elPick.race.slug, names: partyPairNames(elPick.a, elPick.b) ?? { a: elPick.a.label, b: elPick.b.label } }
    : gameSides && sideA && sideB ? { shape: "game" as const, opp: gameSides.b, names: { a: sideA.nickname ?? sideA.name, b: sideB.nickname ?? sideB.name } } : null), [pairOn, elPick, gameSides, sideA, sideB]);
  const settledOn = !!settledPick;
  // walkthrough 13 (2026-10-14): a race between two parties says "party" in its race line, its end and its facts, never "candidate"
  const partyRace = settledPick?.shape === "candidates" && isPartySubject(settledPick.names);
  const settledLine = settledPick ? (partyRace ? PARTIES_PAIR_SENTENCE : settledPick.shape === "game" && leagueCannotTie(leagueSeries) ? GAME_PAIR_SENTENCE_NO_TIE : settledPairSentence(settledPick.shape)) : null;

  // ---- state across a refresh (sessionStorage); `?pair=1` (the landing page's button) opens the pair flow --------------------------
  // `ready` is state, not a ref: the write effect must not run in the same commit as the restore (it would store the initial
  // values first, and React's development double-mount would then restore those).
  const [ready, setReady] = useState(false);
  /** A saved draft, applied only when the creator presses Resume (owner, 2026-10-12: the page never opens scrolled down a draft). */
  const restoreFrom = (s: Record<string, unknown>) => {
      const set = <T,>(k: string, f: (v: T) => void) => { if (s[k] !== undefined) f(s[k] as T); };
      set("flow", setFlow); set("step", (v: Step) => setStep(v === "launch" ? "review" : v)); set("leagueSeries", setLeagueSeries); set("team", setTeam); set("winLose", setWinLose); set("seasonSwap", setSeasonSwap);   // HB-120: the chosen next season survives Resume
      set("game", setGame); set("swap", setSwap); set("pairMode", setPairMode); set("pick", setPick); set("filter", setFilter); set("kind", setKind); /* launch-10: a stored "vault" mode is never restored (vault mode is hidden; hostedLaunch.ts) */
      set("onYes", setOnYes); set("onNoEnabled", setOnNoEnabled); set("onNo", setOnNo); set("unit", setUnit); set("perUnit", setPerUnit); set("baseline", setBaseline); set("direction", setDirection);
      set("tokensYes", setTokensYes); set("vaultShare", setVaultShare); set("burnOn", setBurnOn); set("fraction", setFraction);
      set("profileBadge", (v: boolean) => setProfile((x) => ({ ...x, badge: v !== false })));   // website-15: the receipt-mark choice is kept with the draft
      set("name", setName); set("ticker", setTicker); set("description", setDescription); set("imageUrl", setImageUrl); set("link", setLink); set("xUrl", setXUrl); set("tg", setTg); set("cat", setCat);
      set("nameB", setNameB); set("tickerB", setTickerB); set("descB", setDescB); set("imageB", setImageB); set("firstBuy", setFirstBuy); set("pasted", setPasted); set("q2", setQ2);
      set("guide", setGuide);
      // intent audit 5 items 11, 12 and 18: the profile's words and links, the raise (only a preset), the election pair and the rivalry teams
      set("raiseSol", (v: string) => { if (isRaisePreset(v)) setRaiseSol(v); });
      set("elPick", setElPick); set("meetingsYear", setMeetingsYear); set("rivalA", setRivalA); set("rivalB", setRivalB); set("rivalGame", setRivalGame); set("rivalSeason", setRivalSeason);
      type PT = { description?: string; x?: string; telegram?: string; website?: string; hadImage?: boolean };
      const words = (v: PT) => ({ description: String(v.description ?? ""), x: String(v.x ?? ""), telegram: String(v.telegram ?? ""), website: String(v.website ?? "") });
      set("profileText", (v: PT) => { setProfile((x) => ({ ...x, ...words(v) })); if (v.hadImage) setImageGone(true); });
      set("profileBText", (v: PT) => { setProfileB((x) => ({ ...x, ...words(v) })); if (v.hadImage) setImageGone(true); });
      // the end-sink picker: each coin's end choice (a picked coin keeps its mint and ticker; the review re-checks it is still live)
      set("endA", setEndA); set("endB", setEndB); if (s.endA !== undefined || s.endB !== undefined) endRestored.current = true;
      set("uq", setUq); set("origin", setOrigin); set("editedFor", setEditedFor); set("eventInfo", setEventInfo); set("srcWarnings", setSrcWarnings); set("bq", setBq); set("wx", setWx); set("draft", setDraft); set("flavour", setFlavour); set("flavourB", setFlavourB); set("cardCtx", setCardCtx); set("cardYear", setCardYear); set("cardSet", setCardSet); set("nameAuto", setNameAuto); set("tickerAuto", setTickerAuto); set("ownImage", setOwnImage); set("note", setNote);
      // PROD-02: the source's suggestion and its side, so a resumed draft keeps the default name the side calls for
      set("srcSuggest", (v: unknown) => setSrcSuggest(suggestionFromDraft(v)));
  };
  // F4: checked once the launch state is read (a loading state offers nothing, so it would reset every saved choice)
  useEffect(() => {
    if (!endRestored.current || site.read === "loading") return;
    endRestored.current = false;
    const o = { sinkPicker: site.sinkPicker.available, burnSol: site.burnSol.available };
    const badA = !endChoiceOffered(endA, o), badB = !endChoiceOffered(endB, o);
    if (badA) setEndA(END_CHOICE_DEFAULT);
    if (badB) setEndB(END_CHOICE_DEFAULT);
    if (badA || badB) setEndNotice(END_CHOICE_RESET_NOTICE);
  }, [site, endA, endB]);
  // WIRING-AUDIT12 P1-1: a saved linked pair on one result with a share other than 100 % is set to 100 % on resume, and said
  // HB-12 + PROD-01: a saved rule that names a token to burn on a family that may not have one (a natural disaster, a team, a market) is
  // resumed without it, and the notice says so once (burnRealEligibility.ts); it is never revived
  const resumeFrom = (saved: Record<string, unknown>) => { const { draft: d0, notice } = migrateLinkedShare(saved); const { draft: d, notice: burnNotice } = dropIneligibleBurnTarget(d0); restoreFrom(d); const said = [notice, burnNotice].filter(Boolean).join(" "); if (said) setShareNotice(said); };
  useEffect(() => {
    // launch night 2026-10-13 (launchDraftStore.ts): the draft offered is the named one in progress, else the kept one that reached the review
    const offer = readOffer();
    const q0 = new URLSearchParams(window.location.search);
    const wantPair = q0.get("pair") === "1";
    // snag 6: a link that names what to open (a derby pair, a template, a Matchup, "launch one like this") never reopens a saved draft
    const linked = wantPair || q0.get("derby") === "1" || !!q0.get("template") || !!q0.get("like") || !!q0.get("league");
    // "Start a new launch from the review" (the recovery notice, the signing card): the kept draft opens on its review, rule, name and ticker intact
    const resumeReview = !linked && q0.get(RESUME_PARAM) === RESUME_REVIEW;
    if (linked) { try { sessionStorage.removeItem(STORE); } catch { /* ignore */ } }
    else if (resumeReview && offer) resumeFrom(offer);
    else if (offer) setSavedDraft(offer);
    if (resumeReview) { try { window.history.replaceState(window.history.state, "", window.location.pathname); } catch { /* ignore */ } }
    if (wantPair) { setFlow("pair"); setStep("pick"); setGuide({ follow: "rivalry", phase: "which", pairKind: "teams" }); }
    // website-20 item 119: a league page's team link opens step 2 of the team path on that league, with that team picked once its list loads
    if (q0.get("league")) { setGuide({ follow: "team", phase: "which", pairKind: null }); setFlow("team"); setStep("team"); setLeagueSeries(q0.get("league")); setPendingTeam(q0.get("team")); setDeepSeasonOver(q0.get("season") === "over" ? q0.get("team") : null); }
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
      else if (st.derby) { setGuide({ follow: "coins", phase: "which", pairKind: null }); setEntry({ template: tpl, a: u.get("a") ?? "", b: u.get("b") ?? "", kind: u.get("kind") }); }
      // website-22 (QA 9 item 9): a search template opens step 1 with its words in the search line, scrolled to and focused
      else { setFlow("team"); setStep("choose"); if (st.search) { setUq(st.search); setFocusSearch(true); } }
      // website-26 (WIRING-FEATURES item 13): a pre-made rivalry rides on the derby entry; the tile picks both coins and opens Name
      const rivalryParam = u.get("rivalry");
      if (st.derby && rivalryParam) setEntry((e) => (e ? { ...e, rivalry: rivalryParam } : e));
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
        // website-22 (audit 10 item 14): "launch one like this" walks the same five steps as every other entry
        if (e?.kind === "team") { setGuide({ follow: "team", phase: "which", pairKind: null }); setFlow("team"); setStep("team"); setLeagueSeries(e.league); }
        else if (e?.kind === "game") { setGuide({ follow: "rivalry", phase: "which", pairKind: "teams" }); setFlow("pair"); setStep("pick"); setLeagueSeries(e.league); }
        else if (n) { setGuide({ follow: "number", phase: "which", pairKind: null }); setFlow("browse"); setStep("pick"); setCat("science"); setWx({ metric: n.metric, station: n.station, threshold: String(n.threshold ?? "") }); }
        else if (r.oracle === "derby") { window.location.href = "/burnticker/launch?template=coin-vs-coin"; }
        else if (r.oracle === "polymarket") { setGuide({ follow: "market", phase: "which", pairKind: null }); setFlow("single"); setStep("pick"); }
        else { setFlow("team"); setStep("choose"); setUq(j.status?.seriesTitle ?? ""); }
      }).catch(() => { /* the plain launch page */ });
    }
    // intent audit 5 item 17: the entry parameters are read once and then dropped from the address, so a reload keeps the draft (and
    // offers Resume) instead of starting the link over
    if (linked) { try { window.history.replaceState(window.history.state, "", window.location.pathname); } catch { /* ignore */ } }
    setReady(true);
  }, []);
  const snapshot = JSON.stringify({ guide, raiseSol, elPick, rivalA, rivalB, rivalGame, rivalSeason, profileText: { description: profile.description, x: profile.x, telegram: profile.telegram, website: profile.website, hadImage: !!profile.image }, profileBText: { description: profileB.description, x: profileB.x, telegram: profileB.telegram, website: profileB.website, hadImage: !!profileB.image }, profileBadge: profile.badge, eventInfo, uq, origin, srcWarnings, bq, wx, flow, step, leagueSeries, team, winLose, seasonSwap, game, swap, pairMode, meetingsYear, pick, filter, kind, mode, onYes, onNoEnabled, onNo, unit, perUnit, baseline, direction, tokensYes, vaultShare, burnOn, fraction, name, ticker, description, imageUrl, link, xUrl, tg, cat, nameB, tickerB, descB, imageB, firstBuy, pasted, q2, draft, flavour, flavourB, cardCtx, cardYear, cardSet, endA, endB, nameAuto, tickerAuto, editedFor, ownImage, note, srcSuggest });
  // nothing is stored until something is chosen, so an untouched first screen never replaces a saved draft
  // launch night 2026-10-13: a draft that reached the review is also kept in its own slot, which only another reviewed draft replaces
  const launched = useRef(false);
  useEffect(() => { if (ready && !launched.current && (step !== "choose" || guide.phase !== "follow")) { try { sessionStorage.setItem(STORE, snapshot); if (isReviewedDraft(JSON.parse(snapshot))) sessionStorage.setItem(KEPT_STORE, snapshot); } catch { /* private mode: no memory, no harm */ } } }, [ready, snapshot]);   // eslint-disable-line react-hooks/exhaustive-deps
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
    // HB-94 (hourly run 7): a jump back (an Edit, a crumb) replaces the entry, so Back never lands on a step the draft has left
    const act = stepHistoryAction(cur, urlStep);
    if (act === "none") return;
    try { window.history[act === "replace" ? "replaceState" : "pushState"]({ btStep: urlStep }, "", stepAddress(window.location.pathname, urlStep)); } catch { /* ignore */ }
  }, [urlStep, ready]);   // eslint-disable-line react-hooks/exhaustive-deps

  // owner, 2026-10-12: Start over at every step clears the draft and the stored choices and lands on question 1; it asks once only when a
  // name, a ticker or an image of the creator's own would be lost
  // website-20 pass A item 10: once anything is chosen, Start over asks first (it is the secondary action beside Back)
  const needsConfirm = !!guide.follow || step !== "choose" || (!nameAuto && !!name.trim()) || (!tickerAuto && !!ticker.trim()) || !!profile.image || !!profileB.image;
  const startOver = (force = false) => { if (!force && needsConfirm) { setConfirmOver(true); return; } setPrevFollow(null); setConfirmOver(false); try { sessionStorage.removeItem(STORE); sessionStorage.removeItem(KEPT_STORE); sessionStorage.removeItem(CVC_STORE); sessionStorage.removeItem(REVIEW_PROOF_STORE); sessionStorage.removeItem(PREPARED_MINT_STORE); } catch { /* ignore */ } try { window.history.replaceState(null, "", window.location.pathname); } catch { /* ignore */ } window.scrollTo({ top: 0 }); onReset(); };
  // owner, 2026-10-12: "Launch a coin" again while on this page shows step 1, with the draft kept and offered (launchStart.ts)
  useEffect(() => {
    const h = () => {
      const s = readOffer();
      if (s) setSavedDraft(s);
      setGuide({ follow: null, phase: "follow", pairKind: null }); setStep("choose"); setConfirmOver(false); setOrigin(null);
      window.scrollTo({ top: 0 });
    };
    window.addEventListener(LAUNCH_START_EVENT, h);
    return () => window.removeEventListener(LAUNCH_START_EVENT, h);
  }, []);
  /** launch night 2026-10-13: once every coin is live and recorded, the draft that made them is no longer offered */
  const dropDraft = () => { launched.current = true; try { sessionStorage.removeItem(STORE); sessionStorage.removeItem(KEPT_STORE); sessionStorage.removeItem(REVIEW_PROOF_STORE); sessionStorage.removeItem(PREPARED_MINT_STORE); } catch { /* ignore */ } setSavedDraft(null); };
  const resumeDraft = () => { if (savedDraft) resumeFrom(savedDraft); setSavedDraft(null); window.scrollTo({ top: 0 }); };

  // site audit #18: the one shared catalogue read (catalogueClient.ts) — the header's availability uses the same promise
  useEffect(() => { loadCatalogue().then((raw) => { const j = raw as { sources?: Source[]; cluster?: string; venues?: typeof venues; customImages?: boolean; derby?: { recordCloseKeyed?: boolean }; hazards?: { id: HazardKindId; controls: ReturnType<typeof hazardControls>[HazardKindId] }[] }; setSources(j.sources ?? []); setRecordKeyed(typeof j.derby?.recordCloseKeyed === "boolean" ? j.derby.recordCloseKeyed : null); setCluster(j.cluster ?? null); if (j.venues) { setVenues(j.venues); setPairVenue(venueFor(j.venues)); } setCustomImages(j.customImages === true); if (j.hazards) setHazardCatalogueOf(Object.fromEntries(j.hazards.map((h) => [h.id, h.controls])) as ReturnType<typeof hazardControls>); setAvail(availabilityFromCatalogue(j)); const st = siteLaunchStateFromCatalogue(j); setSite(st); setGate(st.read === "stale" ? { kind: "unavailable", detail: st.sentence } : launchGateFromCatalogue(j)); }).catch((e) => { const why = String((e as Error).message ?? e); setSite(siteLaunchStateFromCatalogue(null, { failure: why })); setGate(launchGateFromCatalogue(null, why)); }); }, []);
  // A2: no pair path while pairs are unavailable — a restored session, ?pair=1, the matchup template or "launch one like this" on a game
  useEffect(() => { if (site.read === "ready" && !site.pairs.available && flow === "pair" && step !== "choose") { setFlow("team"); setStep("choose"); setGame(null); setPairNotice(site.pairs.line); } }, [site, flow, step]);
  const curCat = cats.find((c) => c.id === cat);
  // WIRING-POLISH 1 (audit 6 item 24): under 768 px the categories row scrolls sideways; the edge that still has more fades
  const catHint = useScrollEdges<HTMLElement>([cats.length, flow, step, guide.pairKind]);
  useEffect(() => { if (flow === "browse" && curCat?.guided === "elections" && !etypes.length && venues.polymarket) getJson<{ types: { id: string; label: string; races: number }[] }>(`${V1}/elections`).then((j) => setEtypes(j.types)).catch((e) => { setEtypes([]); setEtypesErr(`The races could not be read just now (${detailOf(e)}).`); }); }, [flow, curCat?.guided, etypes.length, venues.polymarket]);
  // intent audit 5 item 16: each picker below applies an answer only while its question is still the current one (`live`, cleared by the
  // effect's cleanup when the league, query, race type or state changes), and clears the old answer as soon as the question changes
  useEffect(() => { if (!etype) return; let live = true; setEbusy(true); setEraces(null); setEpair(null); setEsel([]); getJson<{ states: { abbr: string; name: string; races: number }[]; races: ElRace[] }>(`${V1}/elections?type=${etype}${estate ? `&state=${estate}` : ""}`).then((j) => { if (!live) return; setEstates(j.states); setEraces(etype === "control" || estate ? j.races : null); }).catch(() => { if (live) setEraces([]); }).finally(() => { if (live) setEbusy(false); }); return () => { live = false; }; }, [etype, estate]);
  // website-22 (audit 10 item 16): the race type, state and picks belong to the picker that set them (one outcome, or two candidates);
  // moving to the other picker starts its filters fresh
  const electionPicker = `${guide.follow ?? ""}|${guide.pairKind ?? ""}`, lastPicker = useRef(electionPicker);
  useEffect(() => { if (lastPicker.current === electionPicker) return; lastPicker.current = electionPicker; setEtype(null); setEstate(null); setEsel([]); setEraces(null); setEpair(null); }, [electionPicker]);
  useEffect(() => { if (esel.length !== 2 || !eraces?.[0]) { setEpair(null); return; } const race = eraces.find((r) => esel.every((c) => r.outcomes.some((o) => o.conditionId === c))); if (!race) return; let live = true; getJson<ElPair>(`${V1}/elections/pair?slug=${race.slug}&a=${esel[0]}&b=${esel[1]}`).then((j) => { if (live) setEpair(j); }).catch(() => { if (live) setEpair(null); }); return () => { live = false; }; }, [esel, eraces]);
  // the search box: 300 ms after the last keystroke, only for 3+ characters with at least one meaningful token, and only the response
  // to the LATEST query is shown (a sequence id discards a slow answer to an earlier keystroke); old results clear as soon as you type
  const useq = useRef(0);
  // time-to-launch (productStore.ts): the page's own step timestamps, sent with the launch bundle request only
  const stepTimes = useRef<Record<string, number>>({});
  const mark = (k: "search" | "card" | "create" | "review" | "launch") => { if (!stepTimes.current[k] || k === "launch" || k === "review") stepTimes.current[k] = Date.now(); };
  useEffect(() => { if (uq.trim()) mark("search"); }, [uq]);
  useEffect(() => { if (step === "review") { mark("create"); mark("review"); } }, [step]);
  // launch night 2026-10-13: the review asks whether this page is still the site's current version (VersionCheck.tsx)
  useEffect(() => { if (step === "review" && guide.phase === "review") window.dispatchEvent(new Event(VERSION_CHECK_EVENT)); }, [step, guide.phase]);
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
    // HB-42 (run 4): a pasted link is never searched as words; a Polymarket event link opens that event under Event outcome
    if (pastedLink(qv)) { setUbusy(false); return; }
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
  // HS-47 (hourly run 9): a bare ticker with no card is looked up with the coin picker's own search; a Pyth coin gets one card
  const [bareCoin, setBareCoin] = useState<{ q: string; symbol: string } | null>(null);
  useEffect(() => {
    const sym = ures && ures.cards.length === 0 ? bareTickerOf(uq) : null;
    if (!sym) { setBareCoin(null); return; }
    let live = true;
    getJson<{ hits?: { symbol: string; source: string; feed: string | null }[] }>(`${V1}/derby/search?q=${encodeURIComponent(sym)}`)
      .then((j) => { if (!live) return; const s = pythCoinOf(j.hits ?? [], sym); setBareCoin(s ? { q: uq, symbol: s } : null); })
      .catch(() => { if (live) setBareCoin(null); });
    return () => { live = false; };
  }, [ures, uq]);
  useEffect(() => {
    const l = pastedLink(uq);
    if (l?.kind !== "polymarket" || !venues.polymarket) return;
    const slug = l.slug;
    pickFollow("market"); setUq(""); setTimeout(() => setQ2(slug), 0);
  }, [uq, venues.polymarket]);   // eslint-disable-line react-hooks/exhaustive-deps -- pickFollow is a plain handler
  // browse: the categories once, then one category's cards (debounced text filter)
  // HB-21 (run 4): the list is kept per mode, so Published data never shows the full list a politics browse loaded first (or the reverse)
  const catsMode = useRef<string | null>(null);
  useEffect(() => { const mode = guide.follow === "number" ? "feed" : "all"; if (flow === "browse" && (!cats.length || catsMode.current !== mode)) { catsMode.current = mode; getJson<{ categories: BrowseCategory[] }>(`${V1}/browse${mode === "feed" ? "?venue=feed" : ""}`).then((j) => { if (catsMode.current === mode) setCats(j.categories); }).catch((e) => setBrowseErr([String((e as Error).message)])); } }, [flow, cats.length, guide.follow]);
  // L11: the previous category's cards are cleared the moment the category changes, and only the answer to the LATEST request is shown
  const browseSeq = useRef(0), browseCat = useRef<string | null>(null);
  useEffect(() => {
    if (flow !== "browse" || step !== "pick") return;
    const seq = ++browseSeq.current;
    if (browseCat.current !== cat) { browseCat.current = cat; setCards(null); setBrowseErr([]); setDrill(null); setWx(null); }
    setCardsBusy(true);
    const t = setTimeout(() => { getJson<{ cards: SourceCardT[]; errors: string[] }>(`${V1}/browse?category=${encodeURIComponent(cat)}${guide.follow === "number" ? "&venue=feed" : ""}${bq.trim() ? `&q=${encodeURIComponent(bq.trim())}` : ""}`).then((j) => { if (seq !== browseSeq.current) return; setCards(j.cards); setBrowseErr(j.errors ?? []); }).catch((e) => { if (seq !== browseSeq.current) return; setCards([]); setBrowseErr([`${(e as Error).message} (${detailOf(e)})`]); }).finally(() => { if (seq === browseSeq.current) setCardsBusy(false); }); }, bq ? 350 : 0);
    return () => clearTimeout(t);
  }, [flow, step, cat, bq, guide.follow]);
  // L11: nested loading always ends: events, "none open", or the error (a request that hangs is cut after 15 seconds)
  useEffect(() => { if (!drill) { setDrillEvents(null); setDrillErr(null); return; } let live = true; setDrillErr(null); setDrillEvents(null); getJson<{ events: EventHit[] }>(`${V1}/kalshi/events?series=${encodeURIComponent(drill)}`, { signal: AbortSignal.timeout(15_000) }).then((j) => { if (live) setDrillEvents(j.events.slice(0, 12)); }).catch((e) => { if (live) { setDrillEvents([]); setDrillErr(`The events could not be read just now (${detailOf(e)}).`); } }); return () => { live = false; }; }, [drill]);
  useEffect(() => { if (!q.trim()) { setHits([]); return; } const t = setTimeout(() => { fetch(`/api/burnticker/oracle/search?q=${encodeURIComponent(q.trim())}`).then((r) => r.json()).then((j) => setHits(j.results ?? [])).catch(() => setHits([])); }, 350); return () => clearTimeout(t); }, [q]);
  // leagues for the team / pair pickers
  // Team coins and matchups: schedules from the leagues' own feeds or TheSportsDB; each game settled by two independent operators (gameSettle.ts).
  useEffect(() => { if ((flow === "team" || flow === "pair") && !leagues.length) getJson<{ leagues: { id: string; label: string; sport: string; crossRead: string | null; draws: boolean }[] }>(`${V1}/sports/teams`).then((j) => setLeagues((j.leagues ?? []).map((l) => ({ id: l.id, label: l.label, sport: l.sport, crossRead: l.crossRead, draws: l.draws, series: [{ ticker: l.id, title: l.label }] })))).catch((e) => { setLeagueErr(String((e as Error).message)); setLeagueDetail(detailOf(e)); }); }, [flow, leagues.length]);
  useEffect(() => {
    if ((flow !== "team" && !(flow === "pair" && guide.follow === "rivalry")) || !leagueSeries) return; setTeamsBusy(true); setTeams([]);
    let live = true;
    const teamsKey = `${leagueSeries}|${teamsDivision}`;
    // sources-6 (QA 9 #28, #29): the list is alphabetical as served; college football lists the FBS unless "Show all divisions" asks for all
    getJson<{ teams: SportsTeam[]; scheduleNote?: string | null; scheduleDetail?: string | null; division?: { shown: string; line: string | null } }>(`${V1}/sports/teams?league=${leagueSeries}${teamsDivision === "all" ? "&division=all" : ""}`).then((j) => { if (!live) throw new Error("stale"); return j; }).then((j) => (setScheduleNote(j.scheduleNote ?? null), setScheduleDetail(j.scheduleDetail ?? null), setDivisionLine(j.division?.line ?? null), j)).then((j) => setTeams(j.teams.map((t) => ({ abbr: t.abbr, code: t.code ?? t.abbr, city: t.city, nickname: t.nickname, name: t.name, ticker: t.ticker, league: t.league, filter: t.series.win, collisions: [], series: t.series, recordText: t.record ?? null, record: recordOf(t.record), seasonWarning: t.season?.status === "over" || t.season?.status === "none-listed" ? t.season.warning : null, seasonOver: t.season?.status === "over",
      next: t.next ? { eventTicker: t.next.eventId, marketTicker: t.next.eventId, title: t.next.title, expectedAt: t.next.startsAt, opponent: t.next.opponent, home: t.next.home ?? null, undecided: t.next.undecided ?? null, gamesThatDay: t.next.gamesThatDay ?? null, when: t.next.when ?? null } : null })))).then(() => { if (live) setTeamsFor({ key: teamsKey, failed: false }); }).catch(() => { if (live) { setTeams([]); setTeamsFor({ key: teamsKey, failed: true }); } }).finally(() => { if (live) setTeamsBusy(false); });
    return () => { live = false; };
  }, [flow, leagueSeries, guide.follow, teamsDivision]);
  useEffect(() => {
    if (flow !== "pair" || !leagueSeries) return;
    const url = `${V1}/sports/games?league=${leagueSeries}${gameQ.trim() ? `&q=${encodeURIComponent(gameQ.trim())}` : ""}`;
    setGamesBusy(true); setGames([]);
    let live = true;
    const side = (x: SportsSide, series: string): Side => ({ abbr: x.abbr, code: x.code ?? x.abbr, home: x.home, marketTicker: series, label: x.name, nickname: x.nickname, name: x.name, ticker: x.ticker });
    const t = setTimeout(() => { getJson<{ games: SportsGame[]; scheduleNote?: string | null; scheduleDetail?: string | null }>(url).then((j) => { if (!live) throw new Error("stale"); return j; }).then((j) => (setScheduleNote(j.scheduleNote ?? null), setScheduleDetail(j.scheduleDetail ?? null), j)).then((j) => setGames(j.games.map((g) => ({ eventTicker: g.eventId, seriesTicker: g.league, title: g.title, subTitle: g.when ?? g.detail, category: "Sports", expectedAt: g.startsAt, closeTime: null, markets: [], matchedSides: [], pair: { a: side(g.a, g.series.aLoss), b: side(g.b, g.series.bLoss), tieMarket: null }, refused: [] })))).catch((e) => { if (!live) return; setGames([]); setScheduleNote(NEXT_GAME_UNAVAILABLE); setScheduleDetail(detailOf(e)); console.error("[burnticker/launch] the games could not be read:", e); }).finally(() => { if (live) setGamesBusy(false); }); }, gameQ ? 300 : 0);
    return () => { live = false; clearTimeout(t); };
  }, [flow, leagueSeries, gameQ, gamesRetry]);
  // website-21: the rivalry series read (every game between the two teams this season, from the league's own feed or TheSportsDB) once
  // both teams are picked; only the answer for the current two teams is kept
  useEffect(() => {
    if (flow !== "pair" || guide.follow !== "rivalry" || !leagueSeries || !rivalA || !rivalB) return;
    const key = `${leagueSeries}:${rivalA.abbr}:${rivalB.abbr}`, empty = { failed: null, offered: false, offeredLine: null, warning: null, scheduleNote: null, season: null, year: null, source: null, meetings: [] as MeetingRow[], oneGameSearched: null };
    let live = true;
    setRivalry({ key, busy: true, ...empty });
    getJson<{ offered?: boolean; offeredLine?: string | null; warning?: string | null; scheduleNote?: string | null; season?: string | null; year?: number | null; source?: string | null; meetings?: MeetingRow[]; oneGame?: { searched?: string | null } }>(`${V1}/sports/rivalry?league=${encodeURIComponent(leagueSeries)}&a=${encodeURIComponent(rivalA.abbr)}&b=${encodeURIComponent(rivalB.abbr)}`)
      .then((j) => { if (live) setRivalry({ key, busy: false, failed: null, offered: j.offered === true, offeredLine: j.offeredLine ?? null, warning: j.warning ?? null, scheduleNote: j.scheduleNote ?? null, season: j.season ?? null, year: j.year ?? null, source: j.source ?? null, meetings: j.meetings ?? [], oneGameSearched: j.oneGame?.searched ?? null }); })
      .catch((e) => { if (live) setRivalry({ key, busy: false, ...empty, failed: detailOf(e) }); });
    return () => { live = false; };
  }, [flow, guide.follow, leagueSeries, rivalA?.abbr, rivalB?.abbr, rivalryRetry]);   // eslint-disable-line react-hooks/exhaustive-deps
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
      const poly = !venues.polymarket ? Promise.resolve(setPolyFound({ events: [], tags: [], markets: [] })) : getJson<PolyFound>(`${V1}/polymarket/search?q=${qs}${polyClosingSoon ? "&closingSoon=1" : ""}`).then((j) => { if (!live) return; setPolyFound({ events: j.events ?? [], tags: j.tags ?? [], markets: j.markets ?? [], hiddenClosingSoon: j.hiddenClosingSoon ?? 0, closePassedNote: j.closePassedNote }); setAllOut(null); setPolyErr(null); }).catch((e) => { if (!live) return; setPolyFound({ events: [], tags: [], markets: [] }); setPolyErr(String((e as Error).message)); });
      void Promise.allSettled([kalshi, poly]).then(() => { if (live) setFindBusy(false); });
    }, 400);
    return () => { live = false; clearTimeout(t); };
  }, [flow, q2, venues.kalshi, venues.polymarket, polyClosingSoon]);
  // HS-32 (hourly run 6): before any query, up to six "Open now" cards from the Browse answers the Browse step reads (server-cached), once a visit
  const [openNow, setOpenNow] = useState<SourceCardT[] | null>(null);
  useEffect(() => {
    // source helper N5 (hourly run 9): only the Event outcome search shows the cards, so a team or weather pick step fetches nothing
    if (flow !== "single" || step !== "pick" || openNow !== null || !venues.polymarket || (guide.follow && guide.follow !== "market")) return;
    let live = true;
    void Promise.all(OPEN_NOW_CATEGORIES.map((c) => getJson<{ cards: SourceCardT[] }>(`${V1}/browse?category=${c}`).then((j) => j.cards ?? []).catch(() => [] as SourceCardT[]))).then((lists) => { if (live) setOpenNow(openNowCards(lists)); });
    return () => { live = false; };
  }, [flow, step, openNow, venues.polymarket, guide.follow]);

  // ---- the rules ------------------------------------------------------------------------------------------------------------------
  // L01: the one typed path (launchDraft.ts) — the same pure functions the tests walk from every card to the locked rule
  const genericRule: BurnRule | null = useMemo(() => composeRule(pick, { kind, mode, onYes, onNoEnabled, onNo, burnOn, unit, perUnit, baseline, direction, tokensYes, vaultShare, filter, polyPreset }), [pick, filter, polyPreset, kind, mode, onYes, onNoEnabled, onNo, unit, perUnit, baseline, direction, tokensYes, vaultShare, burnOn]);

  /** Matchups: two coins, one per team — "this game only" = each side burns if its team loses that game; "every game" = each side's team-loss coin. */
  const pairRules = useMemo(() => {
    // walkthrough snag 7: two candidates, each coin on its own outcome's market, once, at the one-shot default
    // website-23: two candidates in one race, side A on candidate A's market (YES only, 100 %, the end sink on); side B is shown from
    // candidate B's market and built by the bundle route (the body's `pair` names it)
    if (pairOn && elPick) return { a: candidatesPairRule(elPick.a.conditionId, DEFAULT_SHARE.oneShot), b: candidatesPairRule(elPick.b.conditionId, DEFAULT_SHARE.oneShot) };
    if (!pairOn || !game || !sideA || !sideB || !leagueSeries) return null;
    // website-21: every game between the two teams this season: side A on its team's series, side B on the mirror (2 % default)
    if (pairMode === "meetings") { try { return meetingsPairRules(leagueSeries as LeagueId, sideA.abbr, sideB.abbr, meetingsYear ?? seasonYearAt(leagueSeries as LeagueId, Date.now()), DEFAULT_SHARE.recurring); } catch { return null; } }
    // a game pair is that game (one-shot: 10 % default); a season pair is this season or perpetual (recurring: 2 % default)
    // website-22 (QA 9 item 3, owner): one game burns once, so it starts at the one-shot default (100 %) wherever the rule's dial runs to
    // 100 %; the dial's bounds are the library's (dials.ts), so the page follows them and never forces a share the keeper would not drain
    // website-23: one game is a linked pair, each coin on its own team's win of that game (the single-game share row, 100 / 50 %, stays)
    if (pairMode === "game" && gameSides) { const f = oneGameShare(dialsFor(gamePairRule(gameSides.league, gameSides.eventId, gameSides.a, DEFAULT_SHARE.recurring)).bounds.max); return { a: gamePairRule(gameSides.league, gameSides.eventId, gameSides.a, f), b: gamePairRule(gameSides.league, gameSides.eventId, gameSides.b, f) }; }
    if (pairMode === "game") { const f = oneGameShare(dialsFor(firstPartyRule(sideA.marketTicker, DEFAULT_SHARE.recurring)).bounds.max); return { a: firstPartyRule(sideA.marketTicker, f), b: firstPartyRule(sideB.marketTicker, f) }; }
    const lg = leagueSeries as LeagueId;
    const w: TeamWindow = pairMode === "season" ? { kind: "season", year: cardYear ?? seasonYearAt(lg, Date.now()) } : { kind: "perpetual" };
    try { return w.kind === "season" ? seasonPairRules(lg, sideA.abbr, sideB.abbr, w.year) : { a: firstPartyRule(teamSeries(lg, sideA.abbr, "loss", w), 0.02), b: firstPartyRule(teamSeries(lg, sideB.abbr, "loss", w), 0.02) }; } catch { return null; }
  }, [pairOn, game, sideA, sideB, pairMode, leagueSeries, cardYear, elPick, meetingsYear, gameSides]);
  const baseRule: BurnRule | null = useMemo(() => {
    // a team coin: this season by default (the picker's selector), 2 % per game; the side, the window and the share are dials
    // website-18: with the end clause every launch gets (dials.ts ON_END_DEFAULT = rules.ts DEFAULT_ON_END), so the review card says the
    // end the coin really has: a wins coin in MLB, the NBA or the NHL takes the champion path (describe.ts championPathRule)
    if (flow === "team") return team?.series ? { ...firstPartyRule(seasonSwap && seasonSwap.abbr === team.abbr ? seasonSwap.series : winLose === "win" ? team.series.win : team.series.loss, 0.02), onEnd: { ...ON_END_DEFAULT } } as BurnRule : null;
    if (flow === "pair") return pairRules?.a ?? null;
    return genericRule;
  }, [flow, team, winLose, pairRules, genericRule, seasonSwap]);
  const baseRuleB: BurnRule | null = useMemo(() => (pairRules ? pairRules.b : null), [pairRules]);
  const baseKey = JSON.stringify([baseRule, baseRuleB]);
  const rule0: BurnRule | null = draft && draft.key === baseKey ? draft.a : baseRule;
  // website-24 (WIRING-ROUND5): a coin may burn the coin it is measured against instead of itself, once the launch state says the
  // round-5 program is deployed; default off. The pinned field joins the hashed rule only after its pool passed the admission read.
  const [realOne, setRealOne] = useState<SideReal>(SIDE_REAL_OFF);
  const realNet = (site.cluster ?? cluster) === "mainnet" ? "mainnet" : "devnet";
  // HB-12 + PROD-01 (2026-10-19): and only on a rule family that may burn a real token (burnRealEligibility.ts: published data; never a
  // natural disaster, a team, a market or a pair), the same contract the review and the bundle route enforce
  // owner 2026-10-19: no fixed menu; the only token a coin may burn is the coin it is measured against (burnReal.ts ownRealPicks)
  const realOnePicks = useMemo(() => ownRealPicks(rule0), [rule0]);
  const realOneOffered = site.burnReal.available && !pairOn && !!rule0 && !rule0.vault && realBurnAllowed(rule0) && realOnePicks.length > 0;
  const fieldOne = realOneOffered ? realField(realOne, realNet) : null;
  const fieldOneKey = fieldOne ? JSON.stringify(fieldOne) : "";
  // a linked pair (a rivalry series, a settled-event pair, a registered pair) keeps the pair-winner end; every other coin takes its choice
  const endPickable = !meetingsOn && !settledPick && !(pairOn && !baseRuleB);
  const rule: BurnRule | null = useMemo(() => { const r = rule0 && (fieldOne || rule0.burnTarget) ? withRealBurn(rule0, fieldOne) : rule0; return r && endPickable ? withEndChoice(r, endA) : r; }, [rule0, fieldOneKey, endA, endPickable]); // eslint-disable-line react-hooks/exhaustive-deps
  const ruleB0: BurnRule | null = draft && draft.key === baseKey ? draft.b : baseRuleB;
  const ruleB: BurnRule | null = useMemo(() => (ruleB0 && endPickable ? withEndChoice(ruleB0, endB) : ruleB0), [ruleB0, endB, endPickable]);
  // the coins that can take the rest (GET /sinks on this network), read when the review opens; a failed read leaves the list empty
  useEffect(() => {
    if ((step !== "review" && guide.phase !== "name" && guide.phase !== "review") || !endPickable) return;
    let live = true;
    // A-22 (2026-10-18): one read per network a minute, shared by every step that shows the picker (it was read five times per review)
    sinksFor(realNet, () => getJson<{ sinks: SinkCoin[] }>(`${V1}/sinks?network=${realNet}`)).then((j) => { if (live) setSinks(j.sinks ?? []); }).catch(() => { if (live) setSinks([]); });
    return () => { live = false; };
  }, [step, guide.phase, endPickable, realNet]);
  // website-21: a rivalry series pair is described and ended as the bundle builds it (winner takes the burn, the pair-winner end sink)
  // website-23: a settled-event pair likewise, its race or its game locked in the pair clause (the race's or the game's own end)
  const ruleShown = useMemo((): BurnRule | null => (rule && settledPick && ruleB ? settledAsShown(rule, "A", settledPick, { a: rule, b: ruleB }) : rule && meetingsOn ? ({ ...rule, pair: { pairId: "review-pair", side: "A", counterpartMint: null, winnerTakesBurn: true } } as BurnRule) : rule), [rule, ruleB, meetingsOn, settledPick]);
  const ruleShownB = useMemo((): BurnRule | null => (ruleB && settledPick && rule ? settledAsShown(ruleB, "B", settledPick, { a: rule, b: ruleB }) : ruleB && meetingsOn ? ({ ...ruleB, pair: { pairId: "review-pair", side: "B", counterpartMint: null, winnerTakesBurn: true } } as BurnRule) : ruleB), [rule, ruleB, meetingsOn, settledPick]);
  // WIRING-AUDIT12 P1-1: two candidates or one game are a LINKED pair on one result, which moves the whole pool (100 % only)
  const linkedPair = pairOn && (!!elPick || pairMode === "game");
  const dialCtx = { nowMs: Date.now(), seasonYear: cardYear ?? (leagueSeries ? seasonYearAt(leagueSeries as LeagueId, Date.now()) : null), set: cardSet, linked: linkedPair };
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
      const shape = shareShapeOf(r, { linked: linkedPair, dispersal: site.dispersal.available });
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
  // HB-5 (2026-10-19): a single one-time coin is offered 50% where the host runs burn dispersal (the catalogue's burn-dispersal source)
  const shareOptions = rule ? sharePresetsForRule(rule, { linked: linkedPair, dispersal: site.dispersal.available }) : SHARE_PRESETS.recurring;
  const linkedOneShotRow = !!curDials?.linkedOneShot;
  const shareValue = curDials ? curDials.fraction : shareOptions[0];
  const snapped = useRef("");
  useEffect(() => {
    if (step !== "review" || !rule || !curDials || pendingDials) return;
    if (shareOptions.some((x) => Math.abs(x - curDials.fraction) < 1e-9) || snapped.current === baseKey) return;
    snapped.current = baseKey;
    // L01: never a silent swap — the notice names the share the rule came with and the preset now selected
    const sn = oneShotRule ? { value: DEFAULT_SHARE.oneShot, changed: true } : snapToPreset(curDials.fraction, "recurring");
    setShareNotice(`This rule came with ${presetPct(curDials.fraction)} per burn. The web launcher offers ${presetRowLabel(shareShapeOf(rule, { linked: linkedPair, dispersal: site.dispersal.available }))}, so ${presetPct(sn.value)} is selected. Pick another preset below, or use the API to launch with ${presetPct(curDials.fraction)}.`);
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
  // sources-6 (QA 9 #2): home and away come from the schedule's own flag on side A (a flipped meeting keeps it), never from the swap
  const aHome = sideA?.home ?? !!swap;
  const textCtx = useMemo((): Omit<DescribeCtx, "ticker"> => {
    if (!rule) return {};
    if (cardCtx && cardCtx.key === (rule.market ?? rule.series ?? "")) return cardCtx.ctx;
    if (pairOn && elPick) return { eventPhrase: elPick.a.question.replace(/^will\s+/i, "").replace(/\?$/, "") };
    if (pairOn && pairMode === "game" && game && sideB) return { game: { opponent: sideB.nickname ?? sideB.name, home: aHome, startsAt: game.expectedAt ?? "" } };
    // website-22 (audit 10 item 2): a pick lends its words only while it is the rule's own subject (never a market left from another path)
    const own = pickDescribesRule(rule, pick);
    if (own && pick?.oracle === "polymarket") return { eventPhrase: pick.title.replace(/\s*\(resolves once\)$/, "").replace(/\?$/, "").replace(/^will\s+/i, ""), endsAt: eventInfo?.resolvesAt ?? null, ...(pick.market && eventInfo?.stated ? { stated: eventInfo.stated } : {}) };
    if (own && pick?.oracle === "catalogue" && pick.source?.unit && !/^(espn|nws|fec)\./.test(pick.series ?? "")) return { feed: { title: pick.title, sourceName: pick.source.sourceName, unitLabel: pick.source.unit.label } };
    return {};
  }, [rule, cardCtx, pairOn, pairMode, game, sideB, aHome, pick, eventInfo, elPick]);
  const text: CoinText | null = useMemo(() => { if (!ruleShown) return null; try { return describeRule(ruleShown, { ticker, ...textCtx }); } catch { return null; } }, [ruleShown, ticker, textCtx]);
  const ctxB = useMemo((): Omit<DescribeCtx, "ticker"> => (elPick ? { eventPhrase: elPick.b.question.replace(/^will\s+/i, "").replace(/\?$/, "") } : pairMode === "game" && game && sideA ? { game: { opponent: sideA.nickname ?? sideA.name, home: !aHome, startsAt: game.expectedAt ?? "" } } : {}), [elPick, pairMode, game, sideA, aHome]);
  const textB: CoinText | null = useMemo(() => { if (!ruleShownB) return null; try { return describeRule(ruleShownB, { ticker: tickerB, ...ctxB }); } catch { return null; } }, [ruleShownB, tickerB, ctxB]);
  const compose = (t: CoinText | null, _fl: string | null, fallback: string) => (t ? t.paragraph.slice(0, DESCRIPTION_MAX) : fallback);
  // a quick local read of the note (the server's lint is the one that counts: copy-lint.json, incl. no-affiliation)
  // website-22 (QA 9 item 12): a full sentence, said beside the note and in the review's list of what still blocks the launch
  // website-25 (QA 11 H5): one sentence from the same wording rules the server runs (fieldChecks.ts noteIssue)
  const noteProblem = noteIssue(note);
  const finalDescription = compose(text, flavour, description), finalDescriptionB = compose(textB, flavourB, descB);
  // the suggested name and ticker follow the rule (a window change re-suggests: $RAYS26 → $RAYS) until the creator types their own
  // website-19 (owner, 2026-10-12: "two teamwifs"): a team coin's ticker is the team code plus its window ($LAD, $LADWS, $LADNEXT5), a
  // pair's is the matchup ($LADVMIL and $MILVLAD); generated by default, re-suggested while the creator has not typed their own
  // website-25 (QA 11 H8): the pair's generated names and tickers for the pattern on screen (see the effect below)
  // B-12 (sixth pass): the tickers already launched, read once per page load, so a generated pair ticker that the review would refuse is
  // replaced before it is shown (tickerSwap.ts freePairTickers). A ticker the creator typed is never changed (tickerAuto).
  const [liveTickers, setLiveTickers] = useState<string[]>([]);
  useEffect(() => { let live = true; getJson<{ tokens?: { ticker: string }[] }>(`${V1}/tokens?limit=200`).then((j) => { if (live) setLiveTickers((j.tokens ?? []).map((t) => t.ticker)); }).catch(() => { /* no guard: the review's swap still applies */ }); return () => { live = false; }; }, []);
  const tickerGuard = useMemo((): TickerGuard => ({ existing: liveTickers.map((t) => ({ ticker: t, name: "", status: "live" })) }), [liveTickers]);
  const pairGen = useMemo(() => {
    if (!pairOn || elPick || !sideA || !sideB) return null;
    if (pairMode === "season") return seasonPairNames(sideA, sideB, cardYear ?? (leagueSeries ? seasonYearAt(leagueSeries as LeagueId, Date.now()) : new Date().getUTCFullYear()), leagueSeries);
    return winPairNames(sideA, sideB, tickerGuard);
  }, [pairOn, elPick, sideA, sideB, pairMode, cardYear, leagueSeries, tickerGuard]);
  /** B-12: which generated pair tickers were replaced before they were shown (the one-game and every-game pairs; the season pair has its own). */
  const pairSwap = pairGen && "swapped" in pairGen ? (pairGen as { swapped: { a: boolean; b: boolean } }).swapped : null;
  const [namesRemade, setNamesRemade] = useState<false | NamesChange>(false);
  /** HB-23 (run 4): whether the search words were typed by the creator (a template or a deep link fills them otherwise) */
  const [uqTyped, setUqTyped] = useState(false);
  // HS-15: the team list's no-game note, carried while the rule is that team's season coin
  const byeNow = flow === "team" && team?.seasonWarning === NONE_LISTED_LINE && rule && parseEspnSeries(rule.series ?? "")?.kind === "team" ? byeLine(team.nickname ?? team.name) : null;
  useEffect(() => { if (guide.phase === "review" || !guide.follow) setNamesRemade(false); }, [guide.phase, guide.follow]);
  const genTicker = useMemo((): string | null => {
    if (!rule) return null;
    if (flow === "team" && team) return teamTickerForRule(rule, team.code ?? team.abbr);
    if (flow === "single" && guide.follow === "team" && team) return teamTicker(team.abbr, { league: leagueSeries, window: "title" });
    if (flow === "pair" && pairGen) return pairGen.a.ticker;
    // walkthrough 13: an election pair's first coin keeps the ticker electionPairIdentity gave it ($DEMVREP beside $REPVDEM); the team
    // generator below turned the side word "Democrats" into $DEMOVREPU on the review
    if (flow === "pair" && elPick) return electionPairIdentity(elPick.a.label, elPick.b.label).tickers.a;
    if (flow === "pair" && sideA && sideB) return freePairTickers({ abbr: sideA.abbr, code: sideA.code }, { abbr: sideB.abbr, code: sideB.code }, tickerGuard).a;
    // walkthrough snag 13: the debt coin has one ticker from every path ($DEBT itself is reserved for the flagship's rule)
    if (rule.oracle === "catalogue" && rule.series === "treasury.debt") return rule.inverse ? "FLATDEBT" : "DEBTUP";
    return null;
  }, [rule, flow, team, guide.follow, leagueSeries, sideA, sideB, pairGen, elPick]);
  // the subject a typed name belongs to: the flow and the thing picked (never the name itself, never the share or the end)
  const subjectKey = [flow, guide.follow ?? "", rule?.oracle ?? "", rule?.market ?? rule?.series ?? "", team?.abbr ?? "", sideA?.abbr ?? "", sideB?.abbr ?? ""].join("|");
  useEffect(() => {
    if (nameAuto && tickerAuto) return;
    // editedFor null with a typed name = a draft saved before this fix (the owner's stuck "Ea"): regenerate it too
    // website-25 (QA 11 H8): both coins' names and tickers are made again together, and the name step says so once
    // HB-40 (run 4): the note says what changed, and only when a name or ticker was actually typed
    const typed = (!nameAuto && !!name.trim()) || (!tickerAuto && !!ticker.trim());
    if (editedFor !== subjectKey) { setNameAuto(true); setTickerAuto(true); setEditedFor(null); if (editedFor !== null && typed) setNamesRemade(namesChangeOf(editedFor, subjectKey)); }
  }, [subjectKey, editedFor, nameAuto, tickerAuto]);   // eslint-disable-line react-hooks/exhaustive-deps -- name and ticker are read, not watched
  // website-25 (QA 11 H8): a two-team pair's four generated names and tickers come from ONE generator for the pattern on screen, so both
  // coins regenerate together or both keep what was typed (nameAuto and tickerAuto are shared by the two coins), and the names say which
  // way the coin burns ("Arsenal Wins vs Spurs" for one game or every game between them; "Arsenal 2026 Losses" for the season pair)
  useEffect(() => {
    if (!pairGen || step !== "review") return;
    if (nameAuto && (name !== pairGen.a.name || nameB !== pairGen.b.name)) { setName(pairGen.a.name); setNameB(pairGen.b.name); }
    const ga = fixGen(pairGen.a.ticker), gb = fixGen(pairGen.b.ticker);
    if (tickerAuto && (ticker !== ga || tickerB !== gb)) { setTicker(ga); setTickerB(gb); }
  }, [pairGen, step, nameAuto, tickerAuto, name, nameB, ticker, tickerB, genFix]);   // eslint-disable-line react-hooks/exhaustive-deps -- fixGen reads genFix
  // PROD-02: a source's suggestion follows the side the coin burns on (namePolarity.ts): "Dems sweep" on a NO coin is "Dems sweep No"
  // beside $NODEMOCRAT, and back to "Dems sweep" on YES; a name or ticker the creator typed is kept (nameAuto / tickerAuto)
  const sideNow = ruleSide(ruleShown);
  /** HB-117: the generated name, or the hazard alternative's name when the review swapped the generated ticker for that alternative. */
  const hazardNameFor = (t: CoinText): string => { const to = t.ticker ? genFix[t.ticker.toUpperCase()] : undefined; return (to && hazardAlternateName(ruleShown?.series, { ticker: t.ticker, name: t.name }, to)) || t.name; };
  /** HB-117: the swap the name step announces for a single coin's generated ticker (and name), or null. */
  const singleSwap = !pairOn && tickerAuto && text?.ticker && genFix[text.ticker.toUpperCase()] && genFix[text.ticker.toUpperCase()] === ticker.toUpperCase()
    ? { from: text.ticker, to: ticker, name: nameAuto && name !== text.name ? name : null } : null;
  useEffect(() => {
    if (!text || step !== "review") return;
    const sug = suggestionFor(srcSuggest, sideNow);
    // HB-117: when the review swapped a natural-disaster coin's generated ticker for its hazard-word alternative, the name follows it
    const want0 = genTicker ?? sug.ticker ?? text.ticker, want = want0 ? fixGen(want0) : want0, wantName = sug.name ?? hazardNameFor(text);
    if (tickerAuto && want && want !== ticker) setTicker(want);
    if (nameAuto && wantName && wantName !== name && flow !== "pair") setName(wantName);
  }, [text, step, tickerAuto, nameAuto, ticker, name, flow, genTicker, srcSuggest, sideNow, genFix]);   // eslint-disable-line react-hooks/exhaustive-deps -- fixGen reads genFix
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
  const [btWaiting, setBtWaiting] = useState(false);
  const runBacktest = useCallback(async () => {
    if (!rule) return;
    // HB-43 (run 4): one back-test source per rule. A team or game coin is counted from the league's schedule (the review's last season),
    // so the venue back-test is not asked as well
    if (backtestSourceOf(rule) === "schedule" && (!ruleB || backtestSourceOf(ruleB) === "schedule")) { setBt(null); setBtB(null); setBtErr(null); setBtWaiting(false); setBtFor(btKey); return; }
    setBtBusy(true); setBtErr(null);
    try {
      const run = async (x: BurnRule) => { const r = await fetch("/api/burnticker/oracle/backtest", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rule: x }) }); const j = await r.json().catch(() => ({} as { error?: string })); if (!r.ok) throw new Error(`HTTP ${r.status}${j.error ? `: ${j.error}` : ""}`); return j as Backtest; };
      setBt(await run(rule));
      setBtB(ruleB ? await run(ruleB) : null);
      setBtFor(btKey); setBtWaiting(false);
    } catch (e) {
      setBt(null); setBtB(null); setBtErr(String((e as Error).message)); setBtFor(btKey);
      // website-22 (QA 9 item 41): a 429 or 502 is asked again after a pause (2, 4, 8 s) for this rule only; a new rule starts the count again
      const key = btKey, n = btRetry.key === key ? btRetry.n : 0;
      // HB-43 / HS-13: while a retry is coming the review says the estimate is being worked out, not that it failed
      const retrying = (transientRead(e) || String((e as Error).message).includes(BACKTEST_SLOW)) && n < RETRY_MAX;
      setBtWaiting(retrying);
      if (retrying) setTimeout(() => { setBtRetry({ key, n: n + 1 }); setBtFor((f) => (f === key ? "" : f)); setBtErr(null); }, 2000 * 2 ** n);
    } finally { setBtBusy(false); }
  }, [rule, ruleB, btKey, btRetry]);
  useEffect(() => {
    if (!rule || btFor === btKey || btBusy || step !== "review") return;
    const t = setTimeout(() => { void runBacktest(); }, 600);
    return () => clearTimeout(t);
  }, [rule, btKey, btFor, btBusy, step, flow, runBacktest]);
  const btFresh = btFor === btKey && !!bt;
  // L06: the read-only review payload (POST /v1/launch/review) for the pre-wallet summary — the server's numbers, debounced. A6: every
  // request carries the draft's revision; an answer for an older revision or an older request is dropped (launchReviewSync.ts)
  // audit 7 F03: the proof rides only for the wallet that signed it and the tickers it covers, and is dropped at its age limit; the
  // wallet and the proof are part of the revision, so a connect, disconnect, switch, new proof or expiry asks again
  const sentProof = usableReviewProof(reviewProof, creator, [ticker, ...(pairOn ? [tickerB] : [])], parseWalletProof);
  useEffect(() => {
    if (!reviewProof) return;
    const at = reviewProofExpiresAt(reviewProof, PROOF_MAX_AGE_MS, parseWalletProof) ?? 0;
    // LA-4: dropping it changes the review key (reviewIdentity), so the review is asked again WITHOUT the proof and the slot holds no
    // answer for the new key until it comes back (reviewMatchesDraft): Launch never rides on the earlier, proven answer
    const t = setTimeout(() => { setLapsedProof(reviewProof); setReviewProof((p) => (p === reviewProof ? null : p)); }, Math.max(0, at - Date.now()));
    return () => clearTimeout(t);
  }, [reviewProof]);
  // synthetic creator b-reload-relaunch (launchReviewSync.ts keptReviewProof): the latest signed request over this draft's tickers is kept
  // in this tab, so a reload's kept review still counts the creator's own unlaunched draft as theirs; read back once on load
  useEffect(() => { let raw: string | null = null; try { raw = sessionStorage.getItem(REVIEW_PROOF_STORE); } catch { raw = null; } const kept = keptReviewProof(raw, PROOF_MAX_AGE_MS, parseWalletProof); if (kept) setReviewProof((p) => p ?? kept); else { const lapsed = lapsedKeptProof(raw, PROOF_MAX_AGE_MS, parseWalletProof); if (lapsed) setLapsedProof(lapsed); } }, []);
  // item 253 (launch integrity): the whole profile, image included, is part of the draft's revision, so a prepare answer for an older
  // profile is set aside
  // second audit 2026-10-19 I-12: two revisions (launchReviewSync.ts launchRevisions). draftKey (no wallet, no proof) is the prepare key
  // and the stale-press check; reviewKey (the draft plus the wallet and its proof) is the review requester's key
  const { draft: draftKey, review: reviewKey } = launchRevisions([rule, ticker, name, note, pairOn ? [tickerB, nameB, ruleB, pairVenue] : null, srcWarnings, textCtx, raiseSol, profileRevision(profile), pairOn ? profileRevision(profileB) : ""], reviewIdentity(creator, sentProof));
  const curRev = useRef(reviewKey); curRev.current = reviewKey;
  const curDraft = useRef(draftKey); curDraft.current = draftKey;
  // audit 2026-10-15 M2: one prepare per draft. The key stays the same for one draft revision (a double press or the same request sent
  // again gets the first answer, the same draft and the same addresses); an edit makes a new draft and a new key (api/idempotency.ts).
  // review 2026-10-15 item 1: on idempotency-key-reused the draft gets a new key and the request is sent once more (prepareKey.ts)
  const [prepareKeys] = useState(() => draftKeys());
  const rotatePrepareKey = (): string => prepareKeys.rotate(curDraft.current);
  const launchFetch = keyRotatingFetch((u, init) => fetch(u, init), rotatePrepareKey);
  // audit 7 F02: the debounce, the request, late and out-of-order answers and the retry ladder live in createReviewRequester; the slot
  // moves to a revision only when its request is sent, so a draft edited and put back inside the debounce keeps its review
  // website-22 (QA 9 item 41): a busy or briefly unreachable server is asked again after a pause (2, 4, 8 s) for this draft only
  const [reviewer] = useState(() => createReviewRequester<LaunchReview, Record<string, unknown>>({
    send: (body) => getJson<LaunchReview>(`${V1}/launch/review`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    onSlot: setReviewSlot, debounceMs: 600, retryMax: RETRY_MAX, transient: transientRead, retryingLine: RETRYING_LINE,
    describe: (e) => `${(e as Error).message} (${detailOf(e)})`,
  }));
  useEffect(() => () => reviewer.cancel(), [reviewer]);
  useEffect(() => {
    // A-22 (2026-10-18): a draft whose review is held or in flight is not asked again (reviewRequestDue, against the slot)
    const active = step === "review" && !!rule && gate.kind !== "loading";
    reviewer.want(reviewKey, active ? { rule, ...(creator ? { creator } : {}), ...(sentProof ? { walletProof: sentProof } : {}), ticker: ticker.toUpperCase(), name, note, descCtx: textCtx, warnings: renderWarnings(srcWarnings, ticker.toUpperCase(), tickerB.toUpperCase()), raiseSol, creatorDescription: profile.description, links: creatorLinks({ x: profile.x, telegram: profile.telegram, website: profile.website }).links, ...(pairOn && ruleB ? (settledPick
            // website-23: a settled-event pair is reviewed as the one linked pair it launches as: side B in `pair` with the other market and
            // the race, or the other team; never a `companion`
            // website-24: side B's own describe context (candidate B's event words, or team B's game) rides as pair.descCtx
            ? { pair: { ...settledPairBody(settledPick, { ticker: tickerB, name: nameB, creatorDescription: profileB.description, links: creatorLinks({ x: profileB.x, telegram: profileB.telegram, website: profileB.website }).links }), descCtx: ctxB } }
            : meetingsOn
            // website-21: a rivalry series pair is reviewed as the linked pair it launches as (side B rides in `pair`; never a two-coin `companion`)
            ? { pair: { ticker: tickerB.toUpperCase(), name: nameB, creatorDescription: profileB.description, links: creatorLinks({ x: profileB.x, telegram: profileB.telegram, website: profileB.website }).links } }
            : { companion: { ticker: tickerB.toUpperCase(), name: nameB, creatorDescription: profileB.description, rule: ruleB } }) : {}) } : null);
  }, [step, reviewKey, gate.kind]);   // eslint-disable-line react-hooks/exhaustive-deps -- the body belongs to the render its key was built in; A-2 and F03: the wallet and its proof are in the key
  const shownReview = reviewFor(reviewSlot, reviewKey);
  const reviewCurrent = reviewMatchesDraft(reviewSlot, reviewKey);
  // HB-30: the review checks the tickers as soon as the rule is picked (the burn step), so a generated ticker another coin holds or one
  // letter from another coin's is swapped for its own free ticker before the Name step shows it; a typed ticker is never changed
  // LA-4: a ticker an unlaunched draft holds, asked with no usable proof: a notice beside Launch (and on the Name step), never a blocker
  const draftHeld = reviewCurrent ? draftHeldNotices(shownReview.review?.notices, { lapsed: lapsedProof, creator, maxAgeMs: PROOF_MAX_AGE_MS, parse: parseWalletProof }) : [];
  // LA-4: a generated ticker this tab already pressed Launch for (its signature ran out) is the creator's own draft's: never swapped away
  const ownLapsed = new Set(draftHeld.filter((n) => n.expired).map((n) => n.ticker.toUpperCase()));
  const autoSwaps = autoTickerSwaps(reviewCurrent ? ((shownReview.review as (LaunchReview & { tickers?: TickerCheck[] }) | null)?.tickers ?? null)?.filter((t) => !ownLapsed.has(t.ticker.toUpperCase())) ?? null : null, { a: ticker, b: pairOn ? tickerB : "" }, tickerAuto);
  useEffect(() => {
    if (!autoSwaps.a && !autoSwaps.b) return;
    setGenFix((m) => ({ ...m, ...(autoSwaps.a ? { [ticker.toUpperCase()]: autoSwaps.a } : {}), ...(autoSwaps.b ? { [tickerB.toUpperCase()]: autoSwaps.b } : {}) }));
    if (autoSwaps.a) setTicker(autoSwaps.a);
    if (autoSwaps.b) setTickerB(autoSwaps.b);
  }, [autoSwaps.a, autoSwaps.b]);   // eslint-disable-line react-hooks/exhaustive-deps -- the swap belongs to the review that found it
  // website-21: a rivalry series pair's review block (the per-game and season-end money path, side B's description)
  const reviewMeetings = meetingsOn && reviewCurrent ? shownReview.review?.meetings ?? null : null;
  // website-23: a settled-event pair's review block (review.settled: the sentence, the money path, coin B's description)
  const reviewSettled = settledOn && reviewCurrent ? shownReview.review?.settled ?? null : null;

  // WIRING-PARITY audit 7 #3: a link the server refuses (X on x.com or twitter.com, Telegram on t.me, no look-alike or burnticker.com
  // address) is said under the fields and blocks Launch, the same check the review and the bundle run
  // website-22: profileFieldProblems (ProfileFields.tsx) runs the server's own link check per field, so the page and the review say the same thing
  const linksOf = useCallback(() => ([["website", link], ["X", xUrl], ["Telegram", tg]] as const).filter(([, u]) => /^https:\/\/\S+$/.test(u.trim())).map(([label, u]) => ({ label, url: u.trim() })), [link, xUrl, tg]);
  // review of block M: one signature over the review's tickers (no transaction, no fee); shown only for a ticker the review calls taken
  const proveTicker = creator && wallet.signMessage ? () => { void signLaunchRequest(wallet.signMessage, { origin: window.location.origin, creator, tickers: [ticker, ...(pairOn ? [tickerB] : [])].filter(Boolean).map((t) => t.toUpperCase()), mints: [] }, base58).then((p) => { if (p) { setReviewProof(p); keepReviewProof(p); } }); } : null;
  const launch = useCallback(async () => {
    if (!rule || !reviewMatchesDraft(reviewSlot, curRev.current)) return;   // A6: transactions are prepared only for the reviewed draft
    setBusy(true); setLaunchErr(null);
    // 409 / 429 / 503 → a plain sentence (pairLaunchClient.launchErrorMessage)
    // review of block M: a refused signature (401 wallet-proof-invalid) is sent once more unsigned (walletProof.ts sendWithProofFallback)
    const post = (body: Record<string, unknown>) => sendWithProofFallback(body, postOnce);
    const postOnce = async (body: Record<string, unknown>) => { const r = await launchFetch("/api/burnticker/launch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); const j = await r.json().catch(() => null); if (!r.ok) throw new LaunchRequestError(r.status, j?.code ?? null, launchErrorMessage(r.status, j as LaunchErrorBody | null, r.headers.get("retry-after"))); return j; };
    setPcOut(null);
    mark("launch");
    // pressing Launch is the acknowledgement (the line under the button states both); socials and a custom image are API-only; no launch built here carries an opening purchase (hostedLaunch.ts)
    flowStats.current.decisions++;
    const idempotencyKey = prepareKeys.keyFor(curDraft.current);
    const common = { creator, firstBuySol: "0", raiseSol, idempotencyKey, acknowledgements: { ruleLocked: true, noReturns: true }, timings: { ...stepTimes.current, screens: flowStats.current.screens, decisions: flowStats.current.decisions } };
    // item 253: the prepare answer applies only to the draft it was asked for; an edit while it was in flight sets no plan and never
    // reaches the wallet (preparedLaunch.ts prepareIfCurrent). The sign card's tickers are the ones sent, not the form's.
    // I-12: the stale check follows the draft only (a proof expiring or a wallet change mid-press keeps the paid prepare current)
    const sentRev = curDraft.current, sent = { a: ticker.toUpperCase(), b: tickerB.toUpperCase() };
    // WIRING-AUDIT12 P1-2: the bundles' rules are checked against the review's prepared rules before any wallet request; a difference
    // keeps the wallet closed and sends the creator back to the review with the sentences
    const preparedOnReview = reviewFor(reviewSlot, curRev.current).review?.prepared ?? null;
    let pressProof: WalletProof | null = null;
    // LA6-4: a single coin's key kept from an earlier press in this tab (same wallet, same ticker) is used again, so a wallet refusal and a
    // reload reuse the creator's own draft instead of taking a new key from the bank
    const keptMint = !pairOn ? readKeptMint(creator, sent.a) : null;
    const checkBeforeWallet = async (a: Bundle, b: Bundle | null) => {
      const lines = preparedOnReview ? await preparedRulesCheckWeb(preparedOnReview, { a: { text: a.rules.text, sha256: a.rules.sha256, mint: a.mint }, b: b ? { text: b.rules.text, sha256: b.rules.sha256 } : null }) : [PREPARED_MISSING_LINE];
      if (lines.length) throw new Error(lines.join(" "));
    };
    try {
      // the mint addresses: the server's prepared ones (no mint sent, keys = null); when it has none ready, this browser's search finds
      // them (the panel above Launch counts) and the press goes on with their public keys. An edit made while the search ran sets the
      // press aside before anything more is sent (withMintSource's stale check, and prepareIfCurrent's).
      const out = await prepareIfCurrent(sentRev, () => curDraft.current, () => withKeptMint(keptMint, { pool: mintPool, n: mintsNeeded, stale: () => curDraft.current !== sentRev, staleLine: STALE_PREPARE_SENTENCE }, async (keys: GroundMint[] | null): Promise<() => void> => {
      const [kA, kB] = keys ?? [];
      // the key each bundle is signed with: this browser's own (checked against the bundle's mint), or the server's (checked to derive it and end in burn)
      const keyed = (bundle: Bundle, k: GroundMint | undefined) => (k ? withLocalKey(bundle, k) : withServerKey(bundle));
      const sentMint = (k: GroundMint | undefined) => (k ? { mint: k.publicKey } : {});
      // prelaunch audit 2026-10-18 A-3: the wallet signs this press's request (no transaction, no fee), so the site's uploads and prepared
      // addresses are spent only for a wallet that asked; one signature covers every ticker and mint of the press
      // HB-53: a refused or failed proof stops here, before any prepare or send (requireLaunchProof throws PROOF_REJECTED_SENTENCE)
      const walletProof = await requireLaunchProof(wallet.signMessage, { origin: window.location.origin, creator, tickers: pairOn && ruleB ? [sent.a, sent.b] : [sent.a], mints: [kA?.publicKey, kB?.publicKey].filter((m): m is string => !!m) }, base58);
      if (walletProof) { Object.assign(common, { walletProof }); keepReviewProof(walletProof); pressProof = walletProof; }
      if (pairOn && ruleB && !meetingsOn && !settledPick) {
        // A matchup: two coins, one per team — two launches (each its own selector; a registered pair needs one shared selector).
        // website-18: each coin carries its own image, description and links (pinned in its own metadata file)
        const a = await post({ ...common, idempotencyKey: `${idempotencyKey}_a`, ticker: ticker.toUpperCase(), name, description: finalDescription, descCtx: textCtx, note, imageUrl: null, rule, ...profileBody(profile), ...sentMint(kA) });
        if (kA) mintPool?.consume(kA.publicKey);
        const b = await post({ ...common, idempotencyKey: `${idempotencyKey}_b`, firstBuySol: "0", ticker: tickerB.toUpperCase(), name: nameB, description: finalDescriptionB, descCtx: ctxB, note: "", imageUrl: null, rule: ruleB, ...profileBody(profileB), ...sentMint(kB) });
        if (kB) mintPool?.consume(kB.publicKey);
        await checkBeforeWallet(a.bundle as Bundle, b.bundle as Bundle);
        const A = keyed(a.bundle as Bundle, kA), B = keyed(b.bundle as Bundle, kB);
        return () => { setPairOut({ pairId: null, a: A, b: B, notes: [independentPairFacts(sent.a, sent.b).moves] }); setBundle(A); };
      } else {
        const body: Record<string, unknown> = { ...common, ...launchBody({ creator, ticker, name, description: finalDescription, descCtx: textCtx, note, rule, raiseSol }), ...sentMint(kA) };
        // website-15 item 13: a single coin carries the creator's description, links and uploaded image (with the confirmed rights line)
        // website-18: a registered pair's side A too; side B's profile rides in `pair`
        Object.assign(body, profileBody(profile));
        if (pairOn) {
          // a rivalry pair (one shared selector): the venue this host uses — the pair curve (one transaction set, both graduate or
          // neither) or two LaunchLab bundles; a 409 naming the other venue switches the review line and waits for a second press
          // website-21: a rivalry series pair is always two LaunchLab coins linked at creation (the pair curve is for crypto references);
          // side B's description is the review's own (review.meetings.descriptionB), the generated one while the review is being read
          // website-23: a settled-event pair is one linked LaunchLab pair too (never the pair curve): side B names the other market and the
          // race, or the other team, and carries the review's own description (review.settled.descriptionB)
          // website-24: a settled pair's side B sends its own describe context (ctxB) as pair.descCtx; the bundle route writes coin B's
          // paragraph from it, the same one the review answers (review.settled.descriptionB)
          const descB = meetingsOn ? (reviewMeetings?.descriptionB ?? finalDescriptionB) : settledPick ? (reviewSettled?.descriptionB || finalDescriptionB) : finalDescriptionB;
          const settledFields = settledPick ? { ...settledPairFields(settledPick), descCtx: ctxB } : {};
          const j = await sendWithProofFallback({ ...body, pair: { ...sentMint(kB), ticker: tickerB.toUpperCase(), name: nameB, description: descB, imageUrl: null, ...profileBody(profileB), ...settledFields } }, (b) => postPairLaunch((u, init) => launchFetch(u, init as never), b, meetingsOn || settledPick ? "launchlab" : pairVenue));
          if (kA && kB) { mintPool?.consume(kA.publicKey); mintPool?.consume(kB.publicKey); }
          if (j.venue === "pair-curve") {
            // the pair curve's two mints: this page's own two (their keys are this page's), or the server's two (each key checked)
            if (kA && kB && (j.pairCurve.mints.a !== kA.publicKey || j.pairCurve.mints.b !== kB.publicKey)) throw new Error(MINT_MISMATCH_LINE);
            const keysAB = kA && kB ? { a: secretBase58(kA), b: secretBase58(kB) } : { a: secretBase58(serverKeyFor(j.pairCurve.mints.a, j.mintSecretKeys?.a)), b: secretBase58(serverKeyFor(j.pairCurve.mints.b, j.mintSecretKeys?.b)) };
            return () => { setPairOut(null); setBundle(null); setPcOut({ pairId: j.pair.pairId, pc: j.pairCurve, keys: keysAB, notes: j.pair.notes ?? [] }); };
          }
          const A = keyed(j.bundles.a as Bundle, kA), B = keyed(j.bundles.b as Bundle, kB);
          await checkBeforeWallet(j.bundles.a as Bundle, j.bundles.b as Bundle);
          return () => { setPairOut({ pairId: j.pair.pairId, a: A, b: B, notes: j.pair.notes ?? [] }); setBundle(A); };
        }
        const got = (await post(body)).bundle as Bundle;
        if (kA) mintPool?.consume(kA.publicKey);
        const one = keyed(got, kA);
        // LA6-4: the key this press signs with is kept for this wallet and ticker until launch or Start over
        if (!keptMint) keepPreparedMint({ creator, ticker: sent.a, mint: one.mint, secret: one.mintSecretKey });   // a reused key keeps its first time, so it never outlives its draft
        await checkBeforeWallet(one, null);
        return () => setBundle(one);
      }
      }));
      if ("stale" in out) { setLaunchErr(STALE_PREPARE_SENTENCE); return; }
      out.ok(); setSignTickers(sent);
      setStep("launch"); setPlanAt(Date.now());
    } catch (e) { const v = venueFrom409(e); if (v) setPairVenue(v); if (keptMint && dropsKeptMint(e)) dropPreparedMint(); setLaunchErr(String((e as Error).message)); } finally {
      setBusy(false);
      // LA-4: the press's signature also rides with the review from now on (set after the press, so the review key never moves mid-press):
      // the draft's own wallet keeps Launch on; another wallet that signed sees the ordinary same-ticker refusal and Launch turns off
      if (pressProof) { const p = pressProof; setReviewProof(p); }
    }
  }, [reviewSlot, rule, ruleB, raiseSol, season, pairOn, pairVenue, creator, ticker, name, finalDescription, finalDescriptionB, imageUrl, ownImage, customImages, note, profile, profileB, textCtx, pairMode, aHome, sideA, linksOf, firstBuy, ackLocked, ackNoReturns, tickerB, nameB, imageB, game?.title, meetingsOn, reviewMeetings, settledPick, reviewSettled, ctxB, mintPool, mintsNeeded]);

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
  /** website-22: the Coin comparison tile moves between the guided steps itself. */
  const setCoinsPhase = (p: GuidedPhase) => setGuide((g) => ({ ...g, phase: p }));
  const jumpTo = (p: GuidedPhase) => {
    if (p === "follow") { if (needsConfirm) { setConfirmJump(true); return; } setGuide({ follow: null, phase: "follow", pairKind: null }); setStep("choose"); return; }
    if (guide.follow === "coins" && step === "choose") { setGuide((g) => ({ ...g, phase: p })); return; }
    if (p === "which") { if (step === "review") toWhich(); return; }
    if (step === "review" && (p === "burn" || p === "name" || p === "review")) setGuide((g) => ({ ...g, phase: p }));
  };
  /** website-22 (QA 9 item 11): a review Edit link opens step 4 and lands on that field (its disclosure opened, scrolled to, focused). */
  const editField = (side: "a" | "b", field: ProfileFieldKey | "rights") => {
    setFocusField(profileFieldId(side, field === "rights" ? "image" : field));
    if (guide.follow && step === "review") setGuide((g) => ({ ...g, phase: "name" }));
  };
  useEffect(() => {
    if (!focusField) return;
    const t = setTimeout(() => {
      const el = document.getElementById(focusField) ?? document.getElementById(`${focusField}-file`);
      setFocusField(null);
      if (!el) return;
      for (let d = el.closest("details"); d; d = d.parentElement?.closest("details") ?? null) d.open = true;
      el.scrollIntoView({ block: "center" }); el.focus({ preventScroll: true });
    }, 60);
    return () => clearTimeout(t);
  }, [focusField, guide.phase]);
  // website-22 (QA 9 item 9): a search template's line is scrolled to and focused once it is on screen
  useEffect(() => {
    if (!focusSearch || !ready) return;
    const t = setTimeout(() => { const el = searchRef.current; if (!el) return; setFocusSearch(false); el.scrollIntoView({ block: "center" }); el.focus({ preventScroll: true }); }, 80);
    return () => clearTimeout(t);
  }, [focusSearch, ready, step, guide.phase]);
  // the browser's Back and Forward: an earlier answered step is reopened; a later one only when it was already reached
  useEffect(() => {
    const h = () => {
      const p = (new URLSearchParams(window.location.search).get("step") ?? "follow") as GuidedPhase;
      // HB-94 (hourly run 7): a step the page cannot reopen leaves the address on the step that is shown
      if (!popstateFollows({ asked: p, follow: guide.follow, step })) { try { window.history.replaceState({ btStep: urlStep }, "", stepAddress(window.location.pathname, urlStep)); } catch { /* ignore */ } return; }
      // website-25 (QA 11 M1): like Start over, the chip asks first, then clears the draft, and step 1 shows the choice that was made
    if (p === "follow") { if (needsConfirm) { setConfirmJump(true); return; } setGuide({ follow: null, phase: "follow", pairKind: null }); setStep("choose"); return; }
      if (!guide.follow) return;
      if (guide.follow === "coins" && step === "choose") { setGuide((g) => ({ ...g, phase: p })); return; }
      if (p === "which") { if (step === "review") toWhich(); return; }
      if (step === "review") setGuide((g) => ({ ...g, phase: p }));
    };
    window.addEventListener("popstate", h);
    return () => window.removeEventListener("popstate", h);
  }, [guide.follow, step, urlStep]);   // eslint-disable-line react-hooks/exhaustive-deps
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
      // website-22 (QA 9 item 38): Coin comparison steps back one step at a time, like every other coin
      if (guide.follow === "coins" && (guide.phase === "burn" || guide.phase === "name" || guide.phase === "review")) { const prev: Record<string, GuidedPhase> = { burn: "which", name: "burn", review: "name" }; setGuide((g) => ({ ...g, phase: prev[g.phase] ?? "which" })); return; }
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
    setSrcSuggest({ name: o.name ?? null, ticker: o.ticker ?? null, side: ruleSide(r) });
    setHowSettles(o.how ?? null); setSettleNote(o.settlement ?? null);
    setStep("review");
  };
  /**
   * website-22 (audit 10 item 14, one flow): a card picked from the search line, a template's search or a deep link answers step 1 by
   * the rule it builds, so it walks the same five steps (the burn, the name, the review) and never the older chooser.
   */
  const adoptFollow = (f: FollowId) => {
    if (guide.follow) return;
    if (lastFollow.current && lastFollow.current !== f) { const kept = keptProfileParts(profile, note); setKeptProfile(kept.length ? kept : null); }
    lastFollow.current = f;
    setGuide({ follow: f, phase: "which", pairKind: f === "rivalry" ? "teams" : null });
  };
  /** An event card's outcome → the create screen: that outcome's own yes/no market, 10% once, its ticker ($SPIDER) editable. */
  const applyOutcome = (c: Suggestion, o: NonNullable<Suggestion["picker"]>["outcomes"][number]) => {
    if (lastShown.current) lastShown.current.clicked = true;
    adoptFollow("market");
    markOrigin("search"); setShareNotice(null); setSrcWarnings(c.note ? [c.note] : []);
    { const at = o.endsAt ?? c.endAt ?? null; setEventInfo({ question: o.question, url: c.href, outcome: o.yes ? `“${o.yes}”` : null, resolves: at ? denver(at) : null, resolvesAt: at, criteria: c.howSettles }); }
    mark("card");
    setDraft(null); setFlavour(null); setFlavourB(null); setCardYear(null); setCardSet(null); setCardCtx(null); setOutPick(null);
    const r = { kind: "binary", binary: { onYes: { fractionOfPool: 0.1 }, onNo: null } } as unknown as BurnRule;   // applyRule reads the dials only
    applyRule(r, { oracle: "polymarket", series: null, market: o.conditionId, title: `${o.question} (resolves once)`, yes: o.yes, no: o.no }, { name: o.label.slice(0, 32), ticker: o.ticker, how: `Settles on "${o.question}" resolving ${o.yes}.`, settlement: c.settlement });
  };
  /** A search card → the create screen: the window the card shows (team cards offer four), its text context, its suggested name. */
  const applySuggestion = (c: Suggestion, wi = 0) => {
    if (lastShown.current) lastShown.current.clicked = true;
    { const r0 = c.windows?.[wi]?.rule ?? c.rule; adoptFollow(followForRule(r0, { matchup: !!c.matchup, hazard: isHazardSeries(r0?.series ?? null) })); }
    // L03 / L05: where this came from (Back returns there) and the card's own warning, carried into the review
    markOrigin("search"); setShareNotice(null); setSrcWarnings(c.note ? [c.note] : []);
    setEventInfo(c.pick?.oracle === "polymarket" ? { question: c.pick.title.replace(/\s*\(resolves once\)$/, ""), url: c.href, outcome: c.pick.yes ? `“${c.pick.yes}”` : null, resolves: c.endAt ? denver(c.endAt) : null, resolvesAt: c.endAt ?? null, criteria: c.howSettles } : null);
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
    // HB-74 (hourly run 5): a status line from the previous hazard's pattern switch is cleared with the hazard
    markOrigin("browse"); setOrigin(null); setSrcWarnings([]); setShareNotice(null); setPatternNotice(null); setDraft(null); setCardCtx(null); setEventInfo(null);
    const src = sources.find((x) => x.id === series || series.startsWith(`${x.id}:`));
    applyRule(hazardRule(series), { oracle: "catalogue", series, market: null, title }, { settlement: publisher, source: src?.unit ? { unit: src.unit, baseline: src.baseline ?? 0, direction: src.direction ?? "up" } as Suggestion["source"] : undefined });
  };
  const chooseTeam = (t: Team) => { mark("card"); markOrigin("team"); setShareNotice(null); setSrcWarnings([]); setTeam(t); setSrcSuggest({ name: null, ticker: null }); setDraft(null); setFlavour(null); next(); };
  useEffect(() => { if (!pendingTeam || !teams.length) return; const t = teams.find((x) => x.abbr === pendingTeam); setPendingTeam(null); if (t) chooseTeam(t); }, [teams, pendingTeam]);   // eslint-disable-line react-hooks/exhaustive-deps
  const chooseGame = (g: EventHit) => {
    if (!g.pair) return;
    setGame(g); setSwap(false); setPairMode("game"); setDraft(null); setFlavour(null); setFlavourB(null);
    // walkthrough snag 10: both sides named by the matchup, symmetrically ($LADVMIL and $MILVLAD; "Dodgers vs Brewers, Dodgers side")
    const tk = freePairTickers({ abbr: g.pair.a.abbr, code: g.pair.a.code }, { abbr: g.pair.b.abbr, code: g.pair.b.code }, tickerGuard), nm = pairNames(g.pair.a.nickname ?? g.pair.a.name, g.pair.b.nickname ?? g.pair.b.name, { a: g.pair.a.code ?? g.pair.a.abbr, b: g.pair.b.code ?? g.pair.b.abbr });
    setElPick(null); setSrcSuggest({ name: null, ticker: null });
    if (nameAuto) { setName(nm.a); setNameB(nm.b); }
    if (tickerAuto) { setTicker(tk.a); setTickerB(tk.b); }
    setFlow("pair"); setStep("review");
  };
  const doSwap = () => { setSwap(!swap); setName(nameB); setTicker(tickerB); setNameB(name); setTickerB(ticker); };
  /** HB-37 (run 4): a feed chosen from any browse is published data, whichever family opened the browse (Event outcome's politics tab). */
  const adoptFeedFamily = (oracle: string) => { const fam = followForPick(guide.follow, oracle); if (fam !== guide.follow) setGuide((g) => ({ ...g, follow: fam, pairKind: null })); };
  /** Question 1 (website-19): what the coin follows, then the picker for question 2. */
  const pickFollow = (f: FollowId) => {
    flowStats.current.decisions++;
    // website-22 (audit 10 item 11): words typed for another kind of coin stay, and step 4 says so with Reuse and Start fresh
    if (lastFollow.current && lastFollow.current !== f) { const kept = keptProfileParts(profile, note); setKeptProfile(kept.length ? kept : null); }
    lastFollow.current = f;
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
  /** sources-6 (QA 9 #2, #4): the meetings still to be played as one-game choices, side A the first team picked, at home or away as listed. */
  const oneGameHits = (rv: RivalryRead | null, a: Team, b: Team): EventHit[] => (rv && !rv.busy ? rv.meetings : []).filter((m) => !!m.oneGame).map((m) => ({
    eventTicker: m.eventId, seriesTicker: leagueSeries ?? "", title: `${a.name} vs ${b.name}`, subTitle: null, category: "Sports", expectedAt: m.startsAt, closeTime: null, markets: [], matchedSides: [], refused: [],
    pair: { a: { ...sideOfTeam(a), marketTicker: m.oneGame!.series.aLoss, home: m.oneGame!.aHome }, b: { ...sideOfTeam(b), marketTicker: m.oneGame!.series.bLoss, home: !m.oneGame!.aHome }, tieMarket: null },
  })).sort((x, y) => Date.parse(x.expectedAt ?? "") - Date.parse(y.expectedAt ?? ""));
  const sideOfTeam = (t: Team): Side => ({ abbr: t.abbr, code: t.code ?? t.abbr, marketTicker: t.series?.loss ?? t.filter, label: t.name, nickname: t.nickname, name: t.name, ticker: t.ticker });
  const chooseRivals = (a: Team, b: Team, mode: "game" | "season" | "meetings", chosen: EventHit | null = null) => {
    const seasonHit: EventHit = { eventTicker: `${leagueSeries}-${a.abbr}-${b.abbr}-season`, seriesTicker: leagueSeries ?? "", title: `${a.name} vs ${b.name}`, subTitle: null, category: "Sports", expectedAt: null, closeTime: null, markets: [], matchedSides: [], pair: { a: sideOfTeam(a), b: sideOfTeam(b), tieMarket: null }, refused: [] };
    // audit 7 item 7, item 156: the exact meeting picked is the one the rule binds; without a pick, the next listed one
    const m = chosen ?? oneGameHits(rivalry?.key === `${leagueSeries}:${a.abbr}:${b.abbr}` ? rivalry : null, a, b)[0] ?? meetingOf(games, a.abbr, b.abbr);
    // the meeting with side A first, so $AVB is always the first team picked
    const meet: EventHit | null = m && m.pair ? (m.pair.a.abbr === a.abbr ? m : { ...m, pair: { a: m.pair.b, b: m.pair.a, tieMarket: m.pair.tieMarket } }) : null;
    setRivalSeason(seasonHit); setRivalGame(meet);
    markOrigin("matchup"); setOrigin(null); setSrcWarnings([]);
    if (mode === "meetings") {
      // website-21: every game between them this season, a linked pair named for the matchup ($PHIVBOS and $BOSVPHI); the season year is
      // the schedule's own (GET /v1/sports/rivalry), so the two series name the season the meetings list shows
      chooseGame(seasonHit); setPairMode("meetings");
      setMeetingsYear(rivalry?.key === `${leagueSeries}:${a.abbr}:${b.abbr}` ? rivalry.year : null);
      const n = meetingsPairNames(a, b), ft = freePairTickers(a, b, tickerGuard);
      if (nameAuto) { setName(n.a.name); setNameB(n.b.name); }
      if (tickerAuto) { setTicker(ft.a); setTickerB(ft.b); }
      return;
    }
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
    // private review 10 F2: party control is "Democrats vs Republicans" ($DEMVREP / $REPVDEM), never "Party vs Party"; one surname twice
    // takes a first initial, then the full name (electionPairLabels.ts)
    const id = electionPairIdentity(a.label, b.label), tk = id.tickers, nm = id.names;
    const side = (o: ElOutcome, t: string, w: string): Side => ({ abbr: w, marketTicker: o.conditionId, label: o.label, nickname: w, name: o.label, ticker: t });
    markOrigin("browse"); setOrigin(null);
    // snag 8: a market that is not about the person by name is said in one honest sentence (the party's market settles it)
    // website-22 (audit 10 item 6): the warning names the coin by the ticker on screen when it is shown, never the one generated here
    const honest = (o: ElOutcome, side: "A" | "B") => (o.mapping ? mappingWarning(o.mapping, side) : fold(o.question).includes(fold(sur(o))) ? null : partyMarketWarning(o.question, sur(o), side));
    setSrcWarnings([honest(a, "A"), honest(b, "B")].filter((x): x is string => !!x));
    setElPick({ race: r, a, b });
    setGame({ eventTicker: r.slug, seriesTicker: "elections", title: r.title, subTitle: null, category: "Politics", expectedAt: r.settlesOn, closeTime: null, markets: [], matchedSides: [], pair: { a: side(a, tk.a, id.words.a), b: side(b, tk.b, id.words.b), tieMarket: null }, refused: [] });
    setSwap(false); setPairMode("game"); setDraft(null); setFlavour(null); setFlavourB(null);
    setSrcSuggest({ name: null, ticker: null });
    if (nameAuto) { setName(nm.a); setNameB(nm.b); }
    if (tickerAuto) { setTicker(tk.a); setTickerB(tk.b); }
    setFlow("pair"); setStep("review");
  };

  const card = "rounded-lg border border-neutral-800 bg-neutral-900 p-3";
  const closePassedChip = <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-normal text-amber-300" data-close-passed>{CLOSE_PASSED_CHIP}</span>;
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
              <button data-decision="what" key={l.id} aria-pressed={leagueSeries === l.id} onClick={() => { setLeagueSeries(l.id); setTeamQ(""); setGameQ(""); }} aria-label={leagueButtonName(l.label, l.crossRead)} title={leagueButtonTitle(l.crossRead)} className={`rounded-full border px-3 py-1.5 text-sm ${leagueSeries === l.id ? "border-amber-400 bg-amber-400 text-neutral-950" : "border-neutral-700 hover:border-neutral-500"}`}>{l.label}{!l.crossRead && <span className="ml-1 text-[10px] text-red-400" aria-hidden="true">{NO_SECOND_CHECK}</span>}</button>
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
  const pickPoly = (m: PolyMarket) => { if (m.closed) return; markOrigin("exact"); setSrcWarnings([]); const ev = polyFound?.events.find((e) => e.markets.some((x) => x.conditionId === m.conditionId)) ?? (allOut?.markets?.some((x) => x.conditionId === m.conditionId) ? polyFound?.events.find((e) => e.slug === allOut.slug) : undefined); const champ = championOutcomeSuggest(ev?.title, m.outcome); /* HS-33: a winner-market outcome is named for its rule */ setSrcSuggest({ name: champ?.name ?? (m.outcome ? m.outcome.slice(0, 32) : null), ticker: champ?.ticker ?? null, side: "yes" }); setEventInfo({ question: m.question, url: ev?.url ?? null, outcome: `“${m.yes}”`, resolves: m.endDate ? denver(m.endDate) : ev?.endDate ? denver(ev.endDate) : null, resolvesAt: m.endDate ?? ev?.endDate ?? null, criteria: null, stated: m.resolutionSource && m.finalAfter ? { phrase: m.resolutionSource.phrase, text: m.resolutionSource.text, crossRead: m.resolutionSource.crossRead ? { text: m.resolutionSource.crossRead.text } : null, finalAfter: { text: m.finalAfter.text, ifDisputed: m.finalAfter.ifDisputed } } : null }); setPick({ oracle: "polymarket", series: null, market: m.conditionId, title: `${m.question} (resolves once)`, yes: m.yes, no: m.no }); setKind("binary"); setBurnOn("yes"); setOnYes(DEFAULT_SHARE.oneShot); setFilter(""); setPolyPreset(null); next(); };
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
  const guideAnswers: Partial<Record<GuidedPhase, string>> = !guide.follow ? {} : guide.follow === "coins" ? {
    follow: FOLLOW_CHOICES.find((c) => c.id === "coins")?.label.toLowerCase(), which: coinAnswers?.which ?? undefined, burn: coinAnswers?.burn ?? undefined, name: coinAnswers?.name ?? undefined,
  } : {
    follow: guide.follow === "disaster" ? HAZARD_FOLLOW.label.toLowerCase() : FOLLOW_CHOICES.find((c) => c.id === guide.follow)?.label.toLowerCase(),
    which: pairOn && sideA && sideB ? `${sideA.nickname ?? sideA.name} vs ${sideB.nickname ?? sideB.name}` : flow === "team" && team ? team.nickname ?? team.name : guide.follow === "team" && team ? team.nickname ?? team.name : pick?.title ? whichAnswer(sourceSubjectLabel(pick.series ?? "") ?? pick.title) : undefined,
    burn: meetingsOn ? PATTERNS.winner.label.toLowerCase() : rule && guide.follow === "market" && rule.kind === "binary" ? (!rule.binary?.onYes && rule.binary?.onNo ? "if it resolves NO" : "if it resolves YES") : rule ? (rule.inverse ? "when it does not happen" : windowKindOf(rule) === "one-shot" ? "once" : "every time") : undefined,
    name: ticker ? `$${ticker}${pairOn && tickerB ? ` and $${tickerB}` : ""}` : undefined,
  };
  const typeBlocked = (t: LaunchType | null): string | null => { if (!t || !avail) return null; const a = avail.types[t]; return a.available ? null : `${a.label} launches are not available on this site. ${a.reason ?? ""}`.trim(); };
  /** A2: the one line beside every pair option (Coin vs Coin, the two-coin Matchup, registered pairs) while pairs are unavailable. */
  const pairsBlocked: string | null = site.read === "ready" && !site.pairs.available ? site.pairs.line : null;
  const cardBlocked = (c: Suggestion): string | null => (c.matchup || c.venue === "tile" ? pairsBlocked : null) ?? typeBlocked(c.matchup ? "matchup" : c.picker ? "markets" : launchTypeOf(c.rule));
  const firstActionable = ures ? ures.cards.findIndex((c) => !c.refused.length && (!!c.picker || !!c.rule || !!c.matchup) && !cardBlocked(c)) : -1;
  const preview = gate.kind === "preview";
  /** Why the wallet cannot open for the rule on the review card (preview / closed host, an unavailable type), or null. */
  // website-12: one record decides; the review's own reason (a type or a pair this host cannot take) comes first, then the site's
  const walletBlocked = (t: LaunchType | null, two = false): string | null => (two ? pairsBlocked : null) ?? typeBlocked(t) ?? site.signingSentence ?? (step === "review" && !reviewCurrent ? REVIEW_UPDATING : null);
  // website brief §1: the gate resolves before any launch control renders (loading → skeleton; closed / unavailable → no controls)
  if (!wizardMayRender(gate)) return <LaunchGate state={gate as Exclude<LaunchGateState, { kind: "open" | "preview" }>} deficitHref={DEFICIT_SITE} noWalletLine={NO_WALLET_LINE} />;
  // website-22 (QA 9 item 39): the free-text line and its results, at the top of step 1 (FollowStep's search slot)
  const searchBlock = (
        <section className="space-y-2" aria-label="Describe it in your own words" data-free-text>
          {/* website-22 (QA 9 item 39, owner: the middle path): the free text is one line at the top of step 1; the six cards stay primary */}
          <div className="flex min-w-0 items-center gap-2">
            <label htmlFor="bt-free-text" className="shrink-0 text-sm text-neutral-300">Or describe it</label>
            <input id="bt-free-text" ref={searchRef} data-decision="what" data-help="search" enterKeyHint="search" className={input + " min-w-0 flex-1 py-2"} value={uq} onChange={(e) => { setUq(e.target.value); setUqTyped(true); }} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); /* site audit #10: Enter moves to the first result (results appear as you type) */ const first = document.querySelector<HTMLElement>("[data-first-result]"); if (first) first.focus(); } }} placeholder="Rays win the World Series, Detroit high above 90…" />
            <FieldHelp id="search" />
          </div>
          {shortQuery && <p className="text-sm text-neutral-500">Type a few more letters…</p>}
          {pastedLink(uq) && (pastedLink(uq)?.kind === "other" || !venues.polymarket) && <p className="text-sm text-neutral-400" role="status" data-pasted-link>{PASTED_LINK_REFUSAL}</p>}
          {ubusy && <p className="text-sm text-neutral-500">Searching every source…</p>}
          {ures && (ures as { hiddenClosingSoon?: number }).hiddenClosingSoon ? <p className="text-xs text-neutral-400" data-closing-soon>{(ures as { hiddenClosingSoon?: number }).hiddenClosingSoon} one-time markets closing within 48 hours are hidden. <button type="button" data-nav className="underline" onClick={() => setClosingSoon(true)}>Show closing soon</button></p> : null}
          {ures && ures.cards.length > 0 && (
            <ul className="grid gap-2 md:grid-cols-2 lg:grid-cols-3" aria-label="Ready-made rules" aria-live="polite">
              {ures.cards.map((c, ci) => {
                const head = ci === 0 || ures.cards[ci - 1].group !== c.group ? ({ teams: "Teams", elections: "Elections", weather: "Weather", feeds: "Public data", disasters: "Natural disaster", markets: "Markets", tiles: "Coin vs Coin" } as Record<string, string>)[c.group ?? ""] ?? null : null;
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
                  {c.alternative && <p className="mt-1 text-[11px] text-amber-300" data-alternative>{relatedCardLine({ template: !!entry?.template, typed: uqTyped })}</p>}
                  <div className="mt-1 font-medium leading-snug break-words">{title}</div>
                  <div className="text-xs text-neutral-400 break-words">{c.subtitle}</div>
                  {c.interpreted && <p className="mt-1 text-xs text-neutral-300 break-words" data-interpreted>{c.interpreted}</p>}
                  <p className="mt-1 text-xs text-neutral-400 break-words">It settles on {c.settlement}.{c.crossReadUrl && <> <a className="underline" href={c.crossReadUrl} rel="noopener" target="_blank">Open {c.crossRead ?? "the source"} ↗</a></>}</p>
                  {tx && <p className="mt-2 text-xs text-neutral-300"><span className="font-mono">${tx.ticker}</span> — {tx.oneLiner}.</p>}
                  {c.scheduleUnavailable && <p className="mt-2 text-xs text-neutral-400" data-next-game-unavailable>{NEXT_GAME_UNAVAILABLE}</p>}
                  {c.note && <p className="mt-2 text-xs text-amber-300">{c.note}</p>}
                  {c.existing && c.existing.length > 0 && <DuplicateNotice existing={c.existing} />}
                  {cardBlocked(c) && <p className="mt-2 text-xs text-amber-300" data-type-blocked>{cardBlocked(c)}</p>}
                  {c.refused.length > 0 ? <p className="mt-2 text-xs text-red-400" data-refused>{refusedLine(c.refused)}</p>
                    : c.venue === "tile" ? (pairsBlocked ? null : c.href ? <Link className="mt-2 inline-block underline text-amber-300 text-xs" href={c.href}>{c.id.startsWith("tile:record-close") ? "Open a coin's record close" : "Open Coin vs Coin"}</Link> : <p className="mt-2 text-xs text-neutral-500">Coin vs Coin — not built yet</p>)
                    : c.picker ? <div className="mt-2 space-y-1">
                      <button data-decision="what" data-first-result={ci === firstActionable ? "" : undefined} className="rounded bg-amber-400 px-3 py-1 text-xs font-medium text-neutral-950" aria-expanded={outPick?.id === c.id} onClick={() => setOutPick(outPick?.id === c.id ? null : { id: c.id, q: "" })}>{outPick?.id === c.id ? "Close the list" : `Pick a ${c.picker.noun === "outcome" ? "name" : c.picker.noun}`}</button>
                      {outPick?.id === c.id && <div className="rounded border border-neutral-700 p-2" aria-label="outcome picker">
                        <label className="block text-xs text-neutral-400">Find a {c.picker.noun === "outcome" ? "name" : c.picker.noun}<FieldHelp id="outcome-search" /><input data-decision="what" data-help="outcome-search" autoFocus className={input + " mt-1"} value={outPick.q} onChange={(e) => setOutPick({ id: c.id, q: e.target.value, shown: PICKER_PAGE })} placeholder={`type part of the ${c.picker.noun === "outcome" ? "name" : c.picker.noun}'s name`} /></label>
                        {/* sources-6 (audit 10 #21): long outcome lists filter and page (polySearch.ts pickerPage) */}{(() => { const pg = pickerPage(c.picker.outcomes, outPick.q, outPick.shown); return (<><ul className="mt-1 max-h-56 overflow-y-auto divide-y divide-neutral-800">{pg.outcomes.map((o) => (
                          <li key={o.conditionId}><button data-decision="what" className="flex w-full items-center justify-between gap-2 py-1 text-left text-xs hover:text-amber-300" onClick={() => applyOutcome(c, o)}><span>{o.label}</span><span className="font-mono text-neutral-500">${o.ticker}</span></button></li>
                        ))}</ul>{pg.moreLabel && <button type="button" data-nav className="mt-1 text-xs underline" data-picker-more onClick={() => setOutPick({ id: c.id, q: outPick.q, shown: (outPick.shown ?? PICKER_PAGE) + PICKER_PAGE })}>{pg.moreLabel}</button>}</>); })()}
                        <p className="mt-1 text-[11px] text-neutral-500">Each name is its own yes/no market; your coin burns once if the one you pick wins.</p>
                      </div>}
                    </div>
                    : (c.rule || c.matchup) ? <button data-decision="what" data-first-result={ci === firstActionable ? "" : undefined} disabled={!!cardBlocked(c)} title={cardBlocked(c) ?? undefined} className="mt-2 rounded bg-amber-400 px-3 py-1 text-xs font-medium text-neutral-950 disabled:opacity-40" onClick={() => applySuggestion(c, wi)}>Use this</button>
                    : <button data-decision="what" className="mt-2 rounded border border-neutral-700 px-3 py-1 text-xs text-neutral-500" disabled>Use this</button>}
                </li>
              </Fragment>); })}
            </ul>
          )}
          {ures && ures.cards.length === 0 && !ubusy && bareCoin && bareCoin.q === uq && (
            <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3 text-sm" data-bare-coin>
              <p className="text-neutral-200">{bareCoinLine(bareCoin.symbol)}</p>
              <button type="button" data-decision="what" className="mt-2 rounded bg-amber-400 px-3 py-1 text-xs font-medium text-neutral-950" onClick={() => { markOrigin("search"); setGuide({ follow: "coins", phase: "which", pairKind: null }); setEntry({ template: null, a: bareCoin.symbol, b: "" }); }}>{BARE_COIN_ACTION}</button>
            </div>
          )}
          {ures && ures.cards.length === 0 && !ubusy && (
            // HB-42 / HS-47 (hourly run 9): the category names are separated, and each one is a tab the Published data step has
            <div className="rounded-lg border border-dashed border-neutral-700 p-3 text-sm text-neutral-400" data-no-match>{NO_MATCH_LEAD} {(ures.categories ?? []).map((c, i) => <Fragment key={c.id}>{i > 0 && <span aria-hidden="true">{NO_MATCH_SEPARATOR}</span>}<button data-decision="what" className="underline" onClick={() => { pickFollow("number"); setCat(c.id); }}>{c.label}</button></Fragment>)}</div>
          )}
        </section>
  );

  return (
    // website-22 (QA 9 item 36): the bottom padding is the sticky action bar's measured height (GuidedSteps STICKY_VAR), not a fixed guess;
    // HS-51 (hourly run 10): under 900 px the bar sticks above the tab bar, so the padding adds the tab bar and 16 px and the last card scrolls clear
    <main id="launch-main" tabIndex={-1} className="mx-auto max-w-4xl px-4 pt-6 pb-[calc(var(--bt-sticky-h,0px)+var(--bt-tabbar-h,62px)+env(safe-area-inset-bottom)+26px)] min-[900px]:pb-[calc(var(--bt-sticky-h,0px)+1.5rem)] space-y-5 outline-none" data-launch-main>
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">Launch a coin {cluster === "devnet" && <span className="rounded bg-sky-500/20 px-2 py-0.5 text-xs font-medium text-sky-300 ring-1 ring-sky-500/40" title="BURNTICKER_CLUSTER=devnet: test network, no real money">Devnet</span>}</h1>
          {/* qa-12 L5: the step-1 intro on step 1 only (Rivalry and Coin comparison keep step === "choose" on their own step 2) */}
          {(!guide.follow || (step === "choose" && guide.phase === "follow")) && <p className="hidden text-neutral-400 text-sm sm:block" data-step-one-intro>Every <Link className="underline" href="/burnticker">Burnticker</Link> coin settles on a primary source, such as the BLS, the Treasury, the National Weather Service or a league&apos;s own feed, or on a Polymarket payout read from the chain. The rule is locked at launch. <Link className="underline" href="/burnticker/trust">See what the operator can and cannot do.</Link></p>}
        </div>
        <span className="flex items-center gap-3 text-xs"><Link className="underline text-neutral-400" href="/burnticker/templates">Templates</Link><Link className="underline text-neutral-400" href="/burnticker/me">Your coins</Link>{step !== "choose" && !guide.follow && <button data-nav className="text-neutral-500 underline" onClick={() => startOver()}>start over</button>}</span>
      </header>
      {/* website-15 item 12 (ChatGPT repair 1): sticks right under the shared header, whose measured height SiteHeader writes to --bt-header-h; website-18: from the sm width up only (at 390 px it covered the links and the step header while scrolling) */}
      {preview && <p className="z-30 sm:sticky rounded border border-amber-400 bg-neutral-950/95 px-3 py-2 text-sm font-medium text-amber-300" style={{ top: "var(--bt-header-h, 3.5rem)" }} role="status" data-preview-banner>{PREVIEW_BANNER}</p>}
      <LaunchRecovery />

      {/* intent audit 5 item 20: the one Start over confirmation, for the guided steps, the free-text review and a resumed draft alike */}
      {confirmJump && <p className="rounded border border-amber-400/50 p-2 text-xs text-amber-300" role="alert" data-jump-confirm>{JUMP_CONFIRM_LINE} <button type="button" data-nav className="underline" onClick={() => { const was = guide.follow; setConfirmJump(false); startOver(true); setPrevFollow(was); }}>{JUMP_CONFIRM_YES}</button> <button type="button" data-nav className="ml-2 underline" onClick={() => setConfirmJump(false)}>{JUMP_CONFIRM_NO}</button></p>}
      {confirmOver && <p className="rounded border border-amber-400/50 p-2 text-xs text-amber-300" role="alert" data-start-over-confirm>Start over clears every choice on this draft. <button type="button" data-nav className="underline" onClick={() => startOver(true)}>Start over</button> <button type="button" data-nav className="ml-2 underline" onClick={() => setConfirmOver(false)}>Keep going</button></p>}
      {savedDraft && step === "choose" && guide.phase === "follow" && (
        <p className="rounded border border-amber-400/50 p-2 text-sm text-amber-200" role="status" data-saved-draft>{savedDraftLine(savedDraft)} <button type="button" data-nav className="underline" onClick={resumeDraft}>Resume</button> <button type="button" data-nav className="ml-2 underline" onClick={() => startOver(true)}>Discard it</button></p>
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

      {/* A2: a pair path that could not open says so once, on step 1 */}
      {step === "choose" && guide.phase === "follow" && pairNotice && <p className="rounded border border-amber-400/50 p-2 text-xs text-amber-300" role="status" data-pair-notice>{pairNotice} {site.pairs.detail}</p>}
      {step === "choose" && guide.phase === "follow" && <FollowStep search={searchBlock} value={guide.follow ?? prevFollow} upfront={upfrontLines(RAISE_PRESETS_SOL)} onPick={pickFollow} blocked={(f) => (f === "disaster" ? typeBlocked("feeds") : f === "team" ? typeBlocked("team") : f === "coins" ? pairsBlocked ?? typeBlocked("derby") : f === "rivalry" ? null : f === "market" ? (marketsOff ? "Markets are not available on this site." : null) : null)} />}
      {step === "choose" && guide.follow === "rivalry" && guide.phase === "which" && !guide.pairKind && <RivalryKindStep value={guide.pairKind} onPick={pickRivalry} teamsBlocked={pairsBlocked ?? typeBlocked("matchup")} />}
      {step === "choose" && guide.follow === "disaster" && guide.phase === "which" && (
        <section className="space-y-3" data-guided-step="which" data-disaster-kinds><h2 className="text-xl font-semibold outline-none" tabIndex={-1} data-step-heading>{whichHeading("disaster")}</h2>
          <div className="grid gap-2 sm:grid-cols-2">{HAZARD_KINDS.map((k) => (
            <button key={k.id} type="button" data-decision="what" data-hazard={k.id} aria-label={`${k.label}, from ${k.publisher}`} onClick={() => { setHazardKind(k.id); setHazardVals({ every: {}, once: {} }); chooseHazard(k.every, k.label, k.publisher); }} className="rounded-xl border border-neutral-800 bg-neutral-900 p-3 text-left hover:border-amber-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400">
              <span className="block text-base font-semibold">{k.label}</span><span className="block text-xs text-neutral-400">{k.publisher}</span>
            </button>
          ))}</div>
        </section>
      )}
      {/* website-22 (QA 9 item 38, audit 10 item 13): Coin comparison and the flippening walk the real Which, Burns, Name and Review steps;
          the tile stays mounted across them, so every pick, share and name is kept */}
      {step === "choose" && guide.follow === "coins" && guide.phase !== "follow" && (
        <div data-coins-steps>
          {(pairsBlocked ?? typeBlocked("derby")) && <h2 className="text-xl font-semibold outline-none" tabIndex={-1} data-step-heading>{whichHeading("coins", null, null)}</h2>}
          <CoinVsCoinTile recordKeyed={recordKeyed} burnReal={site.burnReal} network={site.cluster ?? cluster} startOpen phase={guide.phase} onPhase={setCoinsPhase} onAnswers={setCoinAnswers} entry={entry} pairCurve={venues.pairCurve === true} customImages={customImages} blocked={walletBlocked("derby", true)} unavailable={pairsBlocked ?? typeBlocked("derby")} unavailableDetail={pairsBlocked ? site.pairs.detail : null} />
        </div>
      )}

      {/* ---------------------------------------------------------------- TEAM COIN ---------------------------------------------------------------- */}
      {flow === "team" && step === "team" && (
        <section className="space-y-4">
          {leagueFolded}
          {leagueSeries && (
            <div className={card + " space-y-3"}>
              <div className="flex items-center justify-between gap-2 flex-wrap"><h2 className="font-medium outline-none" tabIndex={-1} data-step-heading>{whichHeading("team")}</h2><FieldHelp id="team-search" /><input data-decision="what" data-help="team-search" aria-label="Search teams in this league" className={input + " w-full sm:w-64"} placeholder={teams.length ? `${teams.slice(0, 3).map((t) => t.nickname ?? t.name).join(", ")}…` : "Type a team name"} value={teamQ} onChange={(e) => setTeamQ(e.target.value)} /></div>
              {teamsBusy && <p className="text-sm text-neutral-500">Loading teams…</p>}{leagueSeries === "cfb" && <p className="text-xs text-neutral-400" data-division>{teamsDivision === "fbs" ? divisionLine : null} <button type="button" data-nav className="underline" onClick={() => setTeamsDivision((d) => (d === "all" ? "fbs" : "all"))}>{teamsDivision === "all" ? "Show the FBS only" : "Show all divisions"}</button></p>}
              {!teamsBusy && !teams.length && teamsFor?.key === `${leagueSeries}|${teamsDivision}` && <p className="text-sm text-neutral-500" role={teamsFor.failed ? "alert" : undefined}>{teamsFor.failed ? TEAMS_UNREAD_LINE : TEAMS_NONE_LINE}</p>}
              {(() => {
                // HS-37 (hourly run 6): season-over teams are said once at the top, greyed and listed after the teams still playing
                const lg = leagueSeries as LeagueId, yr = seasonYearAt(lg, Date.now()), nextLabel = seasonLabel(lg, yr + 1);
                const over = teams.filter((t) => t.seasonOver).length;
                return over > 1 ? <p className="text-sm text-amber-300" data-season-over-summary>{seasonOverSummaryLine(over, seasonLabel(lg, yr), nextLabel)}</p> : null;
              })()}
              <div className="grid gap-2 sm:grid-cols-2">{seasonOverOrder(teams.filter(teamFilter)).map((t) => {
                const grey = !!t.seasonOver && teams.filter((x) => x.seasonOver).length > 1;
                return (
                <button data-decision="what" key={t.abbr} aria-label={t.name} aria-pressed={team?.abbr === t.abbr} onClick={() => chooseTeam(t)} data-season-over={grey ? "" : undefined} className={`flex items-center gap-3 rounded-lg border p-2 text-left hover:border-amber-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 ${team?.abbr === t.abbr ? "border-amber-400" : "border-neutral-800"} ${grey ? "opacity-60" : ""}`}>
                  {badge(t.code ?? t.abbr)}
                  <div className="min-w-0"><div className="font-medium truncate">{t.name}</div><div className="text-xs text-neutral-400" data-team-line>{teamLine([t.recordText ? `${record(t)} this season` : null, t.next ? `next: ${nextGameWords(t.next)}, ${t.next.when ?? `starts ${visitorTime(t.next.expectedAt)}`}` : scheduleNote ? NEXT_GAME_UNAVAILABLE : null])}</div>{grey ? <div className="text-xs text-neutral-500" data-season-over-tag>{seasonOverRowTag(seasonLabel(leagueSeries as LeagueId, seasonYearAt(leagueSeries as LeagueId, Date.now()) + 1))}</div> : t.seasonWarning && <div className="text-xs text-amber-300" data-season-warning>{t.seasonWarning}</div>}</div>
                </button>
                );
              })}</div>
              <p className="text-xs text-neutral-500"><span className="bt-chip bt-chip-feed mr-1">on-chain payout · league&apos;s official feed</span>Each game settles on {SPORTS_PROVENANCE.settlement}. {sportsConfirmationLine()} Next games come from {SPORTS_PROVENANCE.schedule}. {VISITOR_TIME_LINE}</p>
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
            // sources-6 (QA 9 #4): the one-game choices are every meeting still to be played in the season's schedule (GET /v1/sports/rivalry
            // meetings[].oneGame), never only the next eight days of games; the search it made is said under the option
            const rvNow = rivalA && rivalB && rivalry?.key === `${leagueSeries}:${rivalA.abbr}:${rivalB.abbr}` ? rivalry : null;
            const meets = rivalA && rivalB ? oneGameHits(rvNow, rivalA, rivalB) : [];
            const gamesReading = !rvNow || rvNow.busy;
            const schedFailed = !!rvNow && !rvNow.busy && (!!rvNow.failed || !!rvNow.scheduleNote);
            const list = (exclude: string | null, onPick: (t: Team) => void, label: string) => (
              <div className={card + " space-y-2"} data-team-list={label}>
                <div className="flex items-center justify-between gap-2 flex-wrap"><h2 className="font-medium">{label}</h2><FieldHelp id="team-search" /><input data-decision="what" data-help="team-search" aria-label={`Search teams for the ${label.toLowerCase()}`} className={input + " w-full sm:w-64"} placeholder={teams.length ? `${otherTeams(teams, exclude).slice(0, 3).map((t) => t.nickname ?? t.name).join(", ")}…` : "Type a team name"} value={teamQ} onChange={(e) => setTeamQ(e.target.value)} /></div>
                {teamsBusy && <p className="text-sm text-neutral-500">Loading teams…</p>}{leagueSeries === "cfb" && <p className="text-xs text-neutral-400" data-division>{teamsDivision === "fbs" ? divisionLine : null} <button type="button" data-nav className="underline" onClick={() => setTeamsDivision((d) => (d === "all" ? "fbs" : "all"))}>{teamsDivision === "all" ? "Show the FBS only" : "Show all divisions"}</button></p>}
                <div className="grid gap-2 sm:grid-cols-2">{otherTeams(teams, exclude).filter(teamFilter).map((t) => (
                  <button data-decision="what" key={t.abbr} data-team={t.abbr} aria-label={t.name} onClick={() => { setTeamQ(""); onPick(t); }} className="flex items-center gap-3 rounded-lg border border-neutral-800 p-2 text-left hover:border-amber-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400">{badge(t.code ?? t.abbr)}<span className="min-w-0 truncate font-medium">{t.name}</span></button>
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
                    {gamesReading ? <span className="mt-1 block text-xs text-neutral-400">Looking for their games.</span>
                      : schedFailed ? <span className="mt-1 block text-xs text-amber-300" role="status" data-schedule-unavailable>{rvNow?.scheduleNote ?? SCHEDULE_UNAVAILABLE_LINE} <button type="button" data-nav className="underline" onClick={() => setRivalryRetry((n) => n + 1)}>Retry</button></span>
                      : meets.length === 0 ? <span className="mt-1 block text-xs text-neutral-400" data-no-meeting>{NO_LISTED_MEETING_LINE}</span>
                      : <span className="mt-1 flex flex-wrap gap-2">{meets.slice(0, 6).map((m) => <button key={m.eventTicker} type="button" data-decision="what" data-meeting={m.eventTicker} onClick={() => chooseRivals(rivalA, rivalB, "game", m)} className="rounded-full border border-neutral-700 px-3 py-1 text-xs hover:border-amber-400">{denver(m.expectedAt)} {m.pair?.a.home ? `vs ${rivalB.code ?? rivalB.abbr}` : `at ${rivalB.code ?? rivalB.abbr}`}</button>)}</span>}
                    {!gamesReading && !schedFailed && <span className="mt-1 block text-[11px] text-neutral-500" data-schedule-source data-one-game-searched>{rvNow?.oneGameSearched ?? scheduleCoverageLine(meets.length)}</span>}
                  </div>
                  <button type="button" data-decision="what" aria-label={RIVALRY_SEASON_LABEL} onClick={() => chooseRivals(rivalA, rivalB, "season")} className="rounded-lg border border-amber-400 p-3 text-left">
                    <span className="block font-medium">{RIVALRY_SEASON_LABEL}</span>
                    <span className="mt-0.5 block text-xs text-neutral-300">{rivalrySeasonLine((leagueSeries ?? null) as LeagueId | null)}</span>
                  </button>
                  {(() => {
                    // website-21 (WIRING-RIVALRY-SERIES): the third option, every game between them this season, with its meetings list
                    const rv = rivalry?.key === `${leagueSeries}:${rivalA.abbr}:${rivalB.abbr}` ? rivalry : null;
                    const busy = !rv || rv.busy, failed = !!rv && !rv.busy && (!!rv.failed || !!rv.scheduleNote);
                    // HB-72 (hourly run 5): greyed with a notice when no meeting is left to play (guidedLaunch.ts seriesOptionState)
                    // HB-72 consistency (hourly run 7): offered with the playoff warning while a playoff meeting is still possible (meetingsLeft.ts)
                    const optionState = busy || failed ? null : seriesOptionState(rv!);
                    const why = busy ? null : failed ? (rv!.scheduleNote ?? SCHEDULE_UNAVAILABLE_LINE) : optionState!.why;
                    const playoffWarning = optionState?.warning ?? null;
                    const rows = rv && !busy && !failed ? meetingsListRows(rv.meetings, rivalA.abbr, rivalB.abbr) : [];
                    const off = busy || !!why;
                    return (
                      <div className={`rounded-lg border p-3 text-left sm:col-span-2 ${off ? "border-neutral-800" : "border-amber-400"}`} data-rivalry-series data-offered={off ? "no" : "yes"}>
                        <button type="button" data-decision="what" disabled={off} aria-label={`${RIVALRY_SERIES_LABEL}${rv?.season ? ` ${rv.season}` : ""}`} aria-describedby="rivalry-series-why" onClick={() => chooseRivals(rivalA, rivalB, "meetings")} className="w-full text-left disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400">
                          <span className="block font-medium">{RIVALRY_SERIES_LABEL}{rv?.season ? <>{" "}<span className="ml-1 text-xs font-normal text-neutral-400">{rv.season}</span></> : null}</span>
                          <span className="mt-0.5 block text-xs text-neutral-300">{RIVALRY_SERIES_LINE}</span>
                        </button>
                        <div id="rivalry-series-why">
                          {busy ? <span className="mt-1 block text-xs text-neutral-400">Looking for their games.</span>
                            : failed ? <span className="mt-1 block text-xs text-amber-300" role="status" data-schedule-unavailable>{why} <button type="button" data-nav className="underline" onClick={() => setRivalryRetry((n) => n + 1)}>Retry</button></span>
                            : why ? <span className="mt-1 block text-xs text-neutral-400" data-no-meeting>{why}{rows.length > 0 && <span className="block" data-meetings-played>{rows.map((m) => `${dayLabel(m.startsAt)} ${m.where}${m.state ? ` (${m.state})` : ""}`).join(", ")}</span>}</span>
                            : <div className="mt-2" data-meetings-list>
                                {playoffWarning && <p className="mb-1 text-xs text-amber-300" role="note" data-playoffs-only>{playoffWarning}</p>}
                                <p className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">{MEETINGS_LIST_LABEL}</p>
                                <ul className="mt-1 flex flex-wrap gap-1.5">{rows.map((m) => (
                                  <li key={m.key} className="rounded-full border border-neutral-700 px-2.5 py-0.5 text-xs text-neutral-200" data-meeting-row={m.key}>{dayLabel(m.startsAt)} {m.where}{m.playoff && <span className="ml-1 text-amber-300" data-playoff>playoffs</span>}{m.state && <>{" "}<span className="text-neutral-400">({m.state})</span></>}</li>
                                ))}</ul>
                                {rv?.source && <p className="mt-1 text-[11px] text-neutral-500" data-schedule-source>{rv.source} {VISITOR_TIME_LINE}</p>}
                              </div>}
                        </div>
                      </div>
                    );
                  })()}
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
                  {badge(g.pair!.a.code ?? g.pair!.a.abbr)}<span className="text-neutral-500 text-xs">vs</span>{badge(g.pair!.b.code ?? g.pair!.b.abbr)}
                  <span className="min-w-0"><span className="block font-medium truncate">{g.pair!.a.name} vs {g.pair!.b.name}</span><span className="block text-xs text-neutral-400">{g.subTitle === LIVE_NOW ? g.subTitle : `starts ${denver(g.expectedAt)}`}, result after the final{g.pair!.tieMarket ? " · this league has draws" : ""}{g.refused.length ? ` · ${refusedLine(g.refused)}` : ""}</span></span>
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
            {q2.trim().length < 2 && <p className="text-xs text-neutral-400" data-event-hint>{EVENT_SEARCH_HINT}</p>}
            {q2.trim().length < 2 && !!openNow?.length && (
              <div className="space-y-1" data-open-now><h3 className="text-xs uppercase tracking-wide text-neutral-500">{OPEN_NOW_LABEL}</h3>
                <div className="grid gap-2 sm:grid-cols-2">{openNow.map((c) => <button key={c.id} type="button" data-decision="what" className="rounded border border-neutral-800 p-2 text-left text-sm hover:border-amber-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400" aria-label={c.title} data-open-now-card onClick={() => setQ2(c.title)}><span className="block truncate">{c.title}</span>{openNowEndsLine(c.next?.at) && <span className="block text-xs text-neutral-500" data-open-now-ends>{openNowEndsLine(c.next?.at)}</span>}</button>)}</div>
              </div>
            )}
            {findBusy && <p className="text-sm text-neutral-500">Searching…</p>}
            {found && (() => {
              const evs = (
                <div key="events" className="space-y-2">{found.events.length > 0 && <h3 className="text-xs uppercase tracking-wide text-neutral-500">Games and events{chip("kalshi")}</h3>}{found.events.map((e) => (
                  <div key={e.eventTicker} className="rounded border border-neutral-800 p-2">
                    <div className="text-sm font-medium">{e.title} <span className="text-xs text-neutral-500">{e.subTitle ?? ""} · result ~{denver(e.expectedAt)}</span></div>
                    {e.refused.length > 0 ? <p className="text-xs text-red-400" data-refused>{refusedLine(e.refused)}</p> : <>
                      {e.pair && (pairsBlocked ? <p className="mt-1 text-xs text-amber-300" data-pairs-blocked>{pairsBlocked}</p> : <button data-decision="what" className="mt-1 text-xs underline text-amber-300" onClick={() => { markOrigin("exact"); chooseGame(e); }}>Make a matchup pair from this game</button>)}
                      <ul className="mt-1 text-xs text-neutral-400 space-y-0.5">{e.markets.slice(0, 12).map((m) => <li key={m.ticker} className="flex items-center justify-between gap-2"><span><code>{m.suffix}</code> {m.label}</span><button data-decision="what" className="underline" onClick={() => { markOrigin("exact"); setPick({ oracle: "kalshi", series: null, market: m.ticker, title: `${e.title} — ${m.label} (resolves once)` }); setKind("binary"); setOnYes(DEFAULT_SHARE.oneShot); next(); }}>burn on this market</button></li>)}</ul>
                    </>}
                  </div>
                ))}</div>
              );
              const ser = (
                <div key="series" className="space-y-1">{found.results.length > 0 && <h3 className="text-xs uppercase tracking-wide text-neutral-500">Recurring series (every future market){chip("kalshi")}</h3>}{found.results.map((h) => (
                  <div key={h.ticker} className="flex items-start justify-between gap-2 py-1"><div><div className="text-sm"><code>{h.ticker}</code> {h.title}</div><div className="text-xs text-neutral-500">{h.category} · {h.frequency ?? "—"}{h.refused.length ? ` · ${refusedLine(h.refused)}` : ""}</div></div>
                    {h.refused.length === 0 && <button data-decision="what" className="text-xs underline" onClick={() => { markOrigin("exact"); setPick({ oracle: "kalshi", series: h.ticker, market: null, title: h.title }); next(); }}>every market</button>}</div>
                ))}</div>
              );
              const pm = polyFound;
              const poly = pm && (
                <div key="polymarket" className="space-y-2">
                  {(pm.events.length > 0 || pm.markets.length > 0) && <h3 className="text-xs uppercase tracking-wide text-neutral-500">Events and markets{chip("polymarket")}</h3>}
                  {!polyClosingSoon && (pm.hiddenClosingSoon ?? 0) > 0 && <p className="text-xs text-neutral-400" data-closing-soon>{pm.hiddenClosingSoon} one-time markets closing within 48 hours are hidden. <button type="button" data-nav className="underline" onClick={() => setPolyClosingSoon(true)}>Show closing soon</button></p>}
                  {pm.closePassedNote && (pm.markets.some((m) => m.closePassed) || pm.events.some((e) => e.closePassed || e.markets.some((m) => m.closePassed))) && <p className="text-xs text-neutral-400" data-close-passed-note>{pm.closePassedNote}</p>}
                  {pm.markets.map((m) => <div key={m.conditionId} className="flex items-center justify-between gap-2 rounded border border-neutral-800 p-2 text-sm"><span>{m.question} <span className="text-xs text-neutral-500">YES = {m.yes}, NO = {m.no}</span>{m.closePassed && <> {closePassedChip}</>}</span><button data-decision="what" className="text-xs underline disabled:no-underline disabled:opacity-50" disabled={m.closed} onClick={() => pickPoly(m)}>{m.closed ? "closed" : "burn on this market"}</button></div>)}
                  {pm.events.map((e) => (
                    <div key={e.slug} className="rounded border border-neutral-800 p-2">
                      <div className="text-sm font-medium">{e.title}{chip("polymarket")} {(() => { const one = oneMarketDate(e); return one ? <span className="text-xs text-neutral-500" data-market-closes>the market closes by {denver(one)}</span> : null; })()}{e.closePassed && <> {closePassedChip}</>}</div>
                      {e.refused.length > 0 ? <p className="text-xs text-red-400" data-refused>{refusedLine(e.refused)}</p> : <>
                        {/* one outcome = one yes/no market (the owner's Best Picture case): pick a name; "every market" is Advanced only */}
                        {/* owner, 2026-10-12 ("difficult to tell which 'burn if this one wins' matched the 76ers, too much dead space in between"): the
                            whole row is the button, lit on hover and focus, so the name and its action read as one line */}
                        <ul className="mt-1 text-xs text-neutral-400">{(allOut?.slug === e.slug && allOut.markets ? filterOutcomes(allOut.markets, allOut.text, { limit: allOut.limit }).shown : e.markets).map((m) => <li key={m.conditionId}><button type="button" data-decision="what" disabled={m.closed} onClick={() => pickPoly(m)} className="group flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left hover:bg-neutral-800 hover:text-neutral-100 focus-visible:bg-neutral-800 focus-visible:text-neutral-100 disabled:opacity-50 disabled:hover:bg-transparent"><span className="min-w-0 truncate">{m.outcome ?? m.question}{m.outcome ? null : <span className="text-neutral-500"> (YES = {m.yes}, NO = {m.no})</span>}{m.closePassed && !e.closePassed && <> {closePassedChip}</>}{!oneMarketDate(e) && m.endDate && <span className="text-neutral-500" data-market-closes> · closes by {denver(m.endDate)}</span>}</span><span className="shrink-0 underline group-disabled:no-underline">{m.closed ? "closed" : m.outcome ? (/\bwins?\b|winner/i.test(m.question ?? "") ? "burn if this one wins" : "burn if this resolves YES") : "burn on this market"}</span></button></li>)}</ul>
                        {/* WIRING-AUDIT12 item 13: "Show all N" reads every outcome of the event, then a filter and paging here */}
                        {e.marketCount > e.markets.length && allOut?.slug !== e.slug && <p className="mt-1 text-[11px] text-neutral-500" data-show-all>Showing {e.markets.length} of {e.marketCount}. <button type="button" data-nav className="underline" onClick={() => showAllOutcomes(e)}>Show all {e.marketCount}</button></p>}
                        {allOut?.slug === e.slug && (() => {
                          if (allOut.failed) return <p className="mt-1 text-[11px] text-amber-300" role="status" data-show-all-failed>The full list could not be read just now. <button type="button" data-nav className="underline" onClick={() => showAllOutcomes(e)}>Try again</button></p>;
                          if (!allOut.markets) return <p className="mt-1 text-[11px] text-neutral-500" role="status">Reading every outcome.</p>;
                          const r = filterOutcomes(allOut.markets, allOut.text, { limit: allOut.limit });
                          return <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-neutral-500" data-all-outcomes>
                            <FieldHelp id="outcome-filter" /><input data-nav data-help="outcome-filter" aria-label="Filter the outcomes" className={input + " w-full sm:w-56"} placeholder="Filter by name" value={allOut.text} onChange={(ev) => setAllOut({ ...allOut, text: ev.target.value, limit: 12 })} />
                            <span data-outcomes-shown>{outcomesShownLine(r, !!allOut.text.trim())}</span>
                            {r.nextOffset !== null && <button type="button" data-nav className="underline" onClick={() => setAllOut({ ...allOut, limit: allOut.limit + 12 })}>Show 12 more</button>}
                          </div>;
                        })()}
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
          <div className={`grid gap-4 ${guide.pairKind === "candidates" ? "" : "md:grid-cols-[200px_minmax(0,1fr)]"}`} data-browse-grid>
            {guide.pairKind !== "candidates" && <nav ref={catHint.ref} onScroll={catHint.onScroll} aria-label="Categories" role="tablist" className={`bt-tabs md:flex-col md:overflow-visible ${catHint.className}`} data-scroll-hint>
              {cats.map((c) => <button data-decision="what" key={c.id} role="tab" aria-selected={cat === c.id} className={`bt-tab md:text-left md:rounded-md${cat === c.id ? " is-active" : ""}`} onClick={() => { setCat(c.id); setDrill(null); }} title={c.blurb}>{c.label}</button>)}
              {!cats.length && <span className="text-sm text-neutral-500">Loading categories…</span>}
            </nav>}
            <div className="min-w-0 space-y-3">
              {/* HB-102 (hourly run 8): the two-candidates rivalry step offers only the race picker, so the category blurb ("laws signed, rules
                  published") and the source filter are left out of it */}
              {guide.pairKind !== "candidates" && <>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm text-neutral-400 flex-1 min-w-0">{cats.find((c) => c.id === cat)?.blurb ?? ""}</p>
                <FieldHelp id="browse-filter" /><input data-decision="what" data-help="browse-filter" className={input + " w-full sm:w-64"} placeholder="filter this category…" value={bq} onChange={(e) => setBq(e.target.value)} aria-label="Filter sources" />
              </div>
              {/* WIRING-SEMANTICS item 115: what the filter ignores */}
              <p className="text-[11px] text-neutral-500" data-filter-help>{edgeCase(115)}</p>
              </>}

              {curCat?.adjudicatedOnly && <p className="rounded border border-dashed border-neutral-700 p-2 text-xs text-neutral-400">No first-party source qualifies for this category. So only settled Polymarket markets are listed, and each one settles on Polymarket&apos;s on-chain payout.</p>}
              {curCat?.guided === "elections" && venues.polymarket && (
                <div className={card + " space-y-3"} aria-label="Elections">
                  <h3 className="font-medium">Pick a race</h3>
                  <div className="flex flex-wrap items-center gap-2"><FieldHelp id="race-type" />{etypes.map((t) => <button data-decision="what" key={t.id} aria-pressed={etype === t.id} className={`bt-tab${etype === t.id ? " is-active" : ""}`} onClick={() => { setEtype(t.id); setEstate(null); }}>{t.label} <span className="bt-tab-count">{t.races}</span></button>)}<span className="text-xs text-red-400 empty:hidden" aria-live="polite">{!etypes.length && etypesErr ? etypesErr : ""}</span>{!etypes.length && !etypesErr && <span className="text-xs text-neutral-500">Loading races…</span>}</div>
                  {etype && etype !== "control" && <label className="block text-sm">State <FieldHelp id="race-state" /><select data-decision="what" data-help="race-state" aria-label="State" className={input + " inline w-56 ml-1"} value={estate ?? ""} onChange={(e) => setEstate(e.target.value || null)}><option value="">choose a state…</option>{[...estates].sort((x, y) => x.name.localeCompare(y.name)).map((x) => <option key={x.abbr} value={x.abbr}>{x.name} ({x.races})</option>)}</select></label>}
                  {ebusy && <p className="text-xs text-neutral-500">Loading…</p>}
                  {eraces?.length === 0 && <p className="text-xs text-neutral-500">No open race listed here.</p>}
                  {eraces?.map((r) => (
                    <div key={r.slug} className="rounded border border-neutral-800 p-2 text-sm">
                      <div className="font-medium">{r.title}{r.settlesOn ? <span className="text-xs text-neutral-500"> · settles {humanDay(r.settlesOn)}</span> : null}</div>
                      <div className="text-xs text-neutral-500">Settled by: {r.settlement}. Source: <a className="underline" href={r.sos.url} rel="noopener" target="_blank">{sosLinkLabel(r.sos)}</a>.</div>
                      {r.refused.length ? <p className="text-xs text-red-400" data-refused>{refusedLine(r.refused)}</p> : <ul className="mt-1 space-y-1">{r.outcomes.map((o) => (
                        <li key={o.conditionId} className="flex flex-wrap items-center justify-between gap-2">
                          <span className="min-w-0"><span className="font-medium">{o.label}</span>{o.mapping && <span className="block text-[11px] text-neutral-400" data-mapping>{o.mapping}</span>}</span>
                          {guide.pairKind === "candidates"
                            ? <button data-decision="what" className={`text-xs underline ${esel.includes(o.conditionId) ? "text-neutral-100" : "text-amber-300"}`} aria-label={`${esel.includes(o.conditionId) ? "Picked: " : "Pick "}${o.label.replace(/\s*\([A-Z]\)$/, "")}`} aria-pressed={esel.includes(o.conditionId)} onClick={() => setEsel((xs) => (xs.includes(o.conditionId) ? xs.filter((x) => x !== o.conditionId) : [...xs.filter((x) => r.outcomes.some((y) => y.conditionId === x)), o.conditionId].slice(-2)))}>{esel.includes(o.conditionId) ? "Picked" : "Pick"}</button>
                            : <button data-decision="what" className="text-xs underline text-amber-300" aria-label={`Use ${o.label.replace(/\s*\([A-Z]\)$/, "")} wins`} onClick={() => {
                            // intent audit 2 item 5: the coin's sentence comes from the market's own question; a party market is said as one
                            const sur = o.label.replace(/\s*\([A-Z]\)$/, "").trim().split(/\s+/).pop() ?? o.label, phrase = o.question.replace(/^will\s+/i, "").replace(/\?$/, "");
                            const tk = sur.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
                            markOrigin("browse"); setSrcWarnings(o.mapping ? [mappingWarning(o.mapping, "A")] : fold(o.question).includes(fold(sur)) ? [] : [partyMarketWarning(o.question, sur)]);
                            setEventInfo({ question: o.question, url: r.url, outcome: `“${o.yes}”`, resolves: r.settlesOn, criteria: r.description, certified: r.settlement.replace(/^.*checked against /, "") });
                            applyRule(o.rule, { oracle: "polymarket", series: null, market: o.conditionId, title: `${phrase} (resolves once)`, yes: o.yes, no: o.no }, { name: `${sur} Wins`, ticker: tk, how: `${o.settles}${r.description ? `\n\nResolution rules (Polymarket): ${r.description}` : ""}`, settlement: `${r.settlement}, ${sosLinkLabel(r.sos)}` }); }}>Use: {o.label} wins</button>}
                        </li>
                      ))}</ul>}
                      {guide.pairKind === "candidates" && !r.refused.length && (r.outcomes.length < 2
                        ? <p className="mt-1 text-xs text-amber-300" data-one-market>This race has one market only, so it cannot make a pair.</p>
                        : esel.filter((x) => r.outcomes.some((o) => o.conditionId === x)).length === 2 ? <button data-decision="what" className="mt-2 rounded bg-amber-400 px-3 py-1 text-xs font-medium text-neutral-950" onClick={() => startElPair(r)}>Use these two</button> : <p className="mt-1 text-xs text-neutral-400" data-pick-both>{PICK_BOTH_LINE}</p>)}
                      {r.description && <details className="mt-1 text-xs text-neutral-400"><summary className="cursor-pointer">How this settles</summary><p className="mt-1 whitespace-pre-wrap">{r.description}</p></details>}
                    </div>
                  ))}
                </div>
              )}
              {guide.pairKind !== "candidates" && <>
              {cardsBusy && <p className="text-sm text-neutral-500">Loading sources…</p>}
              {bq.trim() && <p className="text-xs text-neutral-400" data-active-filter>Showing {cats.find((c) => c.id === cat)?.label ?? cat} sources matching “{bq.trim()}”. <button type="button" data-nav className="underline" onClick={() => setBq("")}>Show all in this category</button></p>}
              {!cardsBusy && cards && cards.length === 0 && <div className="rounded border border-dashed border-neutral-700 p-4 text-sm text-neutral-400" data-empty-filter><p>This site has no source in this category{bq ? ` matching “${bq}”` : ""} yet.</p>{bq.trim() && <p className="mt-2 flex flex-wrap gap-3"><button type="button" data-nav className="underline" onClick={() => setBq("")}>Clear the filter</button><button type="button" data-nav className="underline" onClick={() => { setUq(bq.trim()); setGuide({ follow: null, phase: "follow", pairKind: null }); setStep("choose"); setFocusSearch(true); }}>Search all sources for “{bq.trim()}”</button></p>}</div>}
              <div className={`grid gap-2 lg:grid-cols-2${cardsBusy ? " opacity-50" : ""}`} aria-busy={cardsBusy}>{/* snag 18: a source this host has no key for is not listed at all */}{(cards ?? []).filter((c) => c.launchable.ok || !/needs a key|API_KEY|not configured|licen[cs]ed key/i.test(c.launchable.why ?? "")).map((c) => (
                <div key={c.id} data-source-card={c.id} className={`rounded-lg border p-3 text-sm ${c.launchable.ok ? "border-neutral-800 bg-neutral-900" : "border-neutral-900 opacity-70"}`}>
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
                  {c.outcomes && c.outcomes.length > 0 && <ul className="mt-1 space-y-0.5 text-xs" data-card-outcomes>{c.outcomes.map((o) => <li key={o.market} className="flex justify-between gap-2"><span>{o.question}</span><button type="button" data-decision="what" className="underline text-amber-300" onClick={() => { markOrigin("browse"); setSrcWarnings([]); setShareNotice(null); setPick({ oracle: "polymarket", series: null, market: o.market, title: o.question }); setKind("binary"); setOnYes(DEFAULT_SHARE.oneShot); setFilter(""); next(); }}>burn on this one</button></li>)}</ul>}
                  {c.next && <div className="text-xs text-neutral-500">{c.next.at ? `${c.next.label} · ${denver(c.next.at)}` : c.next.label}</div>}
                  {c.refused.length > 0 && <div className="text-xs text-red-400" data-refused>{refusedLine(c.refused)}</div>}
                  <div className="mt-2 flex flex-wrap gap-3 text-xs">
                    {c.configure?.kind === "team" ? <button data-decision="what" disabled={cardsBusy} className="underline text-amber-300 disabled:opacity-50" onClick={() => { const lg = c.configure!.kind === "team" ? c.configure!.league : null; begin("team"); setTimeout(() => setLeagueSeries(lg), 0); }}>pick a team</button>
                    : c.configure?.kind === "weather" ? <button data-decision="what" disabled={cardsBusy} className="underline text-amber-300 disabled:opacity-50" onClick={() => setWx({ metric: c.configure!.kind === "weather" ? c.configure!.metric : "high", station: "DEN", threshold: c.configure!.kind === "weather" && c.configure!.metric === "rain" ? "0.50" : "90" })}>choose a station</button>
                    : c.launchable.ok && c.pick.oracle === "polymarket" && !c.pick.market ? <button data-decision="what" disabled={cardsBusy} className="underline text-amber-300 disabled:opacity-50" data-pick-outcome onClick={() => { setGuide((g) => ({ follow: g.follow ? "market" : null, phase: g.follow ? "which" : g.phase, pairKind: null })); begin("single"); setQ2(c.title.replace(/\s*\(\d+ markets?\)\s*$/i, "")); }}>pick one outcome</button>
                    : c.launchable.ok ? <button data-decision="what" data-use-source disabled={cardsBusy} className="underline text-amber-300 disabled:opacity-50" onClick={() => {
                      const src = c.pick.oracle === "catalogue" ? sources.find((x) => x.id === c.pick.series) : undefined;
                      markOrigin("browse"); setSrcWarnings([]); setShareNotice(null);
                      adoptFeedFamily(c.pick.oracle);
                      setPick({ ...c.pick, source: src }); setFilter(""); setKind(c.kind);
                      if (c.kind === "scalar" && c.pick.oracle === "kalshi") { setUnit(1); setDirection("up"); setBaseline("previousSettlement"); }
                      next();
                    }}>use this source</button> : <span className="text-neutral-500" data-source-unavailable>{/^This one-time event already has its result/.test(c.launchable.why ?? "") ? c.launchable.why : sourceUnavailableLine(c.launchable.why)}{(c.launchable.why || c.diagnostics?.length) && <details className="mt-1"><summary className="cursor-pointer">Details</summary><span className="block">{edgeCase(117)}</span><span className="break-words font-mono">{[c.launchable.why, ...(c.diagnostics ?? [])].filter(Boolean).join(" ")}</span></details>}</span>}
                    {c.venue === "kalshi" && !kalshiOff && <button data-decision="what" className="underline" onClick={() => setDrill(drill === c.pick.series ? null : c.pick.series)}>{drill === c.pick.series ? "hide events" : "next events"}</button>}
                    {c.sourceUrl && <a className="underline text-neutral-400" href={c.sourceUrl} rel="noopener" target="_blank">source ↗</a>}
                  </div>
                  {wx && c.configure?.kind === "weather" && c.configure.metric === wx.metric && (() => {
                    // L07: the threshold is validated where it is typed; the button says why it is disabled (linked to the field)
                    const thrErr = wx.metric === "snow" ? null : wxThresholdProblem(wx.metric, wx.threshold);
                    const sid = `wx-station-${wx.metric}`, tid = `wx-threshold-${wx.metric}`;
                    return (
                    <div className="mt-2 border-t border-neutral-800 pt-2 text-xs space-y-2">
                      <div><label htmlFor={sid}>Station</label> <FieldHelp id="nws-station" /><select id={sid} data-decision="what" data-help="nws-station" className={input + " inline w-full sm:w-56 sm:ml-1"} value={wx.station} onChange={(e) => setWx({ ...wx, station: e.target.value })}>{STATIONS.map((x) => <option key={x.code} value={x.code}>{stationOptionLabel(x)}</option>)}</select></div>
                      {wx.metric !== "snow" && <div><label htmlFor={tid}>{wx.metric === "high" ? "Burn on days whose high reaches this many °F" : "Burn on days with at least this many inches of rain"}</label> <FieldHelp id="nws-threshold" /><input id={tid} data-decision="what" data-help="nws-threshold" inputMode="decimal" aria-invalid={!!thrErr} aria-describedby={thrErr ? `${tid}-err` : undefined} className={input + " inline w-24 ml-1"} value={wx.threshold} onChange={(e) => setWx({ ...wx, threshold: e.target.value })} />{thrErr && <span id={`${tid}-err`} className="block text-red-400">{thrErr}</span>}</div>}
                      <button data-decision="what" className="underline text-amber-300 disabled:text-neutral-500 disabled:no-underline" disabled={!!thrErr} aria-describedby={thrErr ? `${tid}-err` : undefined} onClick={() => { if (thrErr) return; const thr = wx.metric === "snow" ? null : Number(wx.threshold); const series = nwsSeries(wx.metric, wx.station, thr); const st = STATIONS.find((x) => x.code === wx.station)!; markOrigin("browse"); applyRule(firstPartyRule(series, DEFAULT_SHARE.recurring), { oracle: "catalogue", series, market: null, title: `${st.city} ${wx.metric === "high" ? `daily high ≥ ${thr} °F` : wx.metric === "rain" ? `rain day ≥ ${Number(thr).toFixed(2)} in` : "first snow of the season"} (NWS)` }, { name: `${st.city} ${wx.metric === "high" ? "Heat" : wx.metric === "rain" ? "Rain" : "Snow"}`, ticker: `${st.code}${wx.metric === "high" ? "HOT" : wx.metric === "rain" ? "RAIN" : "SNOW"}`, settlement: "the National Weather Service's daily climate report, cross-checked against the Iowa Environmental Mesonet", source: weatherSource(wx.metric) }); }}>Use this rule</button>
                      {thrErr && <span className="ml-2 text-neutral-500">Fix the threshold to continue.</span>}
                    </div>
                    );
                  })()}
                  {/* L11: a feed card's series is null, and so is "no drill open": only a real series opens the events panel */}
                  {drill !== null && drill === c.pick.series && (
                    <div className="mt-2 border-t border-neutral-800 pt-2 text-xs">
                      <span className="text-red-400 empty:hidden" aria-live="polite">{drillErr ?? ""}</span>{drillEvents === null ? <span className="text-neutral-500">Loading events…</span> : drillErr ? null : drillEvents.length === 0 ? <span className="text-neutral-500">No events are open in this series right now.</span> : drillEvents.map((e) => (
                        <div key={e.eventTicker} className="py-1">
                          <div className="text-neutral-300">{e.title} <span className="text-neutral-500">· ~{denver(e.expectedAt ?? e.closeTime)}</span></div>
                          {e.refused.length ? <div className="text-red-400" data-refused>{refusedLine(e.refused)}</div> : <ul className="mt-0.5 space-y-0.5 text-neutral-400">{e.markets.slice(0, 8).map((mk) => <li key={mk.ticker} className="flex justify-between gap-2"><span>{mk.label || mk.suffix}</span><button data-decision="what" className="underline" onClick={() => { markOrigin("browse"); setPick({ oracle: "kalshi", series: null, market: mk.ticker, title: `${e.title} — ${mk.label || mk.suffix} (resolves once)` }); setKind("binary"); next(); }}>this market only</button></li>)}</ul>}
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
        const coinA = { key: "a", name, ticker, onName: (v: string) => { setName(v); setNameAuto(false); setEditedFor(subjectKey); noteEdit(); }, onTicker: (v: string) => { setTicker(v); setTickerAuto(false); setEditedFor(subjectKey); noteEdit(); }, image: profile.image ? chosenPreview(profile)! : genImg(rule, ticker, oneLiner), oneLiner, oracle: pairOn ? "catalogue" : pick?.oracle ?? "catalogue", badge: text?.badge ?? null, nameIssue: fieldRuleSentence("name", name), tickerIssue: fieldRuleSentence("ticker", ticker) };
        // website-18 THE TEAM PATH: league, team, this card, Launch. The card says the defaults in one sentence each (the burn on every
        // win through the postseason, then the champion and the not-champion ends); every other choice sits under one closed "Advanced"
        const teamPath = flow === "team" && !pairOn && championPathRule(rule);
        const imageField = (v: ProfileValue, set: (x: ProfileUpdate) => void, who: string | null, pasteTarget = true, side: "a" | "b" = "a") => <ProfileFields key={side} value={v} onChange={set} part="image" who={who} customImages={customImages} pasteTarget={pasteTarget} side={side} />;
        const coins = pairOn && ruleB ? [coinA, { key: "b", name: nameB, ticker: tickerB, onName: (v: string) => { setNameB(v); setNameAuto(false); setEditedFor(subjectKey); noteEdit(); }, onTicker: (v: string) => { setTickerB(v); setTickerAuto(false); setEditedFor(subjectKey); noteEdit(); }, image: profileB.image ? chosenPreview(profileB)! : genImg(ruleB, tickerB, textB?.oneLiner ?? ""), oneLiner: textB?.oneLiner ?? ruleOneLiner(ruleB), oracle: "catalogue", badge: textB?.badge ?? null, nameIssue: fieldRuleSentence("name", nameB), tickerIssue: fieldRuleSentence("ticker", tickerB) }] : [coinA];
        // intent audit item 3: a two-coin sentence is read from the two rules (the fade side included), never written for the plain side
        // website-21: a rivalry series pair says both coins' rules, then what each game between them moves (pairFundsFlow.ts meetingsFundsFlow)
        // website-22 (audit 10 items 1 and 2): the pick and the event card speak for this rule only, and for the side it burns on
        const ownPick = pickDescribesRule(rule, pick);
        const eventShown = eventForSide(ownPick ? eventInfo : null, rule, { yes: pick?.yes ?? null, no: pick?.no ?? null });
        const oneShotParts = rule.oracle === "polymarket" && rule.market && !pairOn && rule.kind === "binary" ? (() => { const no = !rule.binary?.onYes && !!rule.binary?.onNo, champ = ({ mlb: "World Series", nba: "NBA Finals", nhl: "Stanley Cup", nfl: "Super Bowl" } as Record<string, string>)[leagueSeries ?? ""] ?? "championship";
          return oneShotSentences({ share: shareValue, no, subject: guide.follow === "team" && team ? "they" : "it", happened: guide.follow === "team" && team ? `the ${team.nickname ?? team.name} ${no ? "did not win" : "won"} the ${champ}` : eventShown?.question ? `“${eventShown.question.replace(/\?$/, "")}” resolved ${no ? "NO" : eventShown.outcome ?? "YES"}` : `the market resolved ${no ? "NO" : "YES"}` }); })() : null;
        // website-23: a settled-event pair says both coins' rules, then the pair's one sentence (describe.ts settledPairSentence)
        const sentence0 = settledPick && text && textB
          ? `$${ticker || "A"} ${text.oneLiner}, and $${tickerB || "B"} ${textB.oneLiner}. ${settledLine}`
          : meetingsOn && sideA && sideB && text && textB
          ? meetingsPairSentence({ a: ticker || "A", b: tickerB || "B", oneA: text.oneLiner, oneB: textB.oneLiner, share: shareText })
          : pairOn && sideA && sideB && text && textB
          ? `$${ticker || "A"} ${text.oneLiner}, and $${tickerB || "B"} ${textB.oneLiner}. Each coin spends ${shareText} of its own burn pool when its rule fires.`
          : pairOn && sideA && sideB
          ? (season ? `$${ticker} spends ${shareText} of its burn pool every time the ${A} lose this season, and $${tickerB} does the same for the ${B}. They are two separate coins with two separate records.` : `When ${game?.title ?? "the game"} is final, the coin of the team that lost spends ${shareText} of its own burn pool: $${ticker} if the ${A} lose, $${tickerB} if the ${B} lose.`)
          : oneShotParts ? oneShotParts.join(" ")
          : text ? (teamPath ? `${text.lead} ${text.windowSentence.replace(/^This coin covers [^.]*\.\s*/, "")}` : text.lead) : plainSentence(rule, ticker, ownPick ? pick?.title ?? null : bt?.seriesTitle ?? null);
        // website-22 (audit 10 item 7): the trigger fact is built from its parts, never cut at the first full stop ("U.S." broke it)
        const trigger = triggerText({ pair: pairOn && sideA && sideB && text && textB ? { a: ticker, b: tickerB, oneA: text.oneLiner, oneB: textB.oneLiner } : null, oneShot: oneShotParts?.[0] ?? null, lead: pairOn ? null : text?.lead ?? null, fallback: sentence0 });
        // owner, 2026-10-12: above 5 % a recurring burn lands in slices (one burn run buys with at most 2 % of the pool's SOL); said once
        const sentence = !oneShotRule && shareValue > SLICED_ABOVE && !/in slices sized/.test(sentence0) ? `${sentence0} The burn lands in slices sized to the pool's liquidity.` : sentence0;
        const problems = btFresh ? [...(bt?.refusals ?? []), ...(pairOn ? btB?.refusals ?? [] : [])].map((r) => r.reason) : [];
        // intent audit item 5: two sides a reader could not tell apart (same ticker or name, any case or spacing) cannot launch
        const identity = pairOn && ruleB ? pairIdentityProblems({ ticker, name }, { ticker: tickerB, name: nameB }) : [];
        const ready = !!name.trim() && okTicker(ticker) && (!pairOn || (!!nameB.trim() && okTicker(tickerB) && ticker !== tickerB)) && !noteProblem && identity.length === 0;
        const rv = shownReview.review as (LaunchReview & { tickers?: TickerCheck[] }) | null;
        const tieWord: "tie" | "draw" = leagues.find((l) => l.id === leagueSeries)?.draws ? "draw" : "tie";
        // website-21: a rivalry series pair renders its own money path (review.meetings.flow), never the one-result or no-SOL-moves facts
        // website-23: one game is the linked pair's four facts (gamePairFacts), never the separate coins' matchupFacts
        const facts = meetingsOn ? null : pairOn && sideA && sideB ? (ruleB ? (elPick ? candidateFacts({ a: ticker, b: tickerB, candA: elPick.a.label, candB: elPick.b.label, party: partyRace }) : settledPick?.shape === "game" ? gamePairFacts({ a: ticker, b: tickerB, teamA: A, teamB: B, tie: tieWord }) : matchupFacts({ a: ticker, b: tickerB, oneLinerA: text?.oneLiner ?? "", oneLinerB: textB?.oneLiner ?? "", inverse: !!rule.inverse, once: pairMode === "game", teamA: `the ${A}`, teamB: `the ${B}`, tie: tieWord })) : winnerTakesBurnFacts(ticker || "A", tickerB || "B")) : null;
        // walkthrough snag 11: a one-shot due before the coin can graduate says what the keeper does with an early result
        const dueIso = pairOn && game?.expectedAt ? game.expectedAt : null;
        // WIRING-AUDIT12 item 4: what happens after that waiting burn, from the pair's own end (one game, two candidates, another linked pair)
        const endLink = !pairOn ? null : elPick ? "candidates" as const : settledPick?.shape === "game" ? "game" as const : meetingsOn || !ruleB ? "pair" as const : null;
        const notes = windowKindOf(rule) === "one-shot" ? [beforeGraduationLine(dueIso ? shortDate(dueIso) : eventInfo?.resolves ?? null, rule, endLink)] : [];
        // HS-15 (run 4): a season coin whose team has no game in the next 8 days says so here too, not only on the team list
        if (byeNow) notes.push(byeNow);
        // website-24: the review sentence for a coin that burns a real token
        const realOneList = fieldOne ? [{ ticker: ticker.toUpperCase(), symbol: fieldOne.symbol }] : [];
        notes.push(...realReviewNotes(realOneList));
        if (imageGone && !profile.image && !profileB.image) notes.push(IMAGE_NOT_KEPT);
        const timing = reviewCurrent ? (shownReview.review as (LaunchReview & { timing?: { dueLabel: string | null; warning: string | null; unplayed: string | null } | null }) | null)?.timing ?? null : null;
        if (timing?.dueLabel) notes.push(timing.dueLabel);
        if (timing?.unplayed) notes.push(timing.unplayed);
        if (timing?.warning) notes.push(timing.warning);
        if (!nameAuto && name.trim()) notes.push(`Keeping the name you typed, “${name}”. It stays while you set up this coin; picking a different thing to follow generates a new one. Press edit to change it.`);
        // guided step 3: the four patterns for the thing picked; guided step 4: the end, from the rule
        // website-22 (QA 9 item 1): a natural-disaster coin's chosen card is the one hazards.ts reads from its series (a next-event series is
        // "once"), and a team coin opened from the search box is read from its rule (no team picked in step 2)
        const curPattern: PatternId | null = guide.follow === "disaster" ? hazardPatternOptions(rule, Date.now(), { dispersal: site.dispersal.available }).preselected
          : guide.follow === "team" ? (rule.oracle === "polymarket" ? "once" : rule.inverse ? "fade" : "every") : guide.follow === "rivalry" ? (meetingsOn || settledPick ? "winner" : elPick || pairMode === "game" ? "once" : rule.inverse ? "fade" : "every") : guide.follow === "market" ? (rule.kind === "binary" && rule.binary?.onNo && !rule.binary.onYes ? "fade" : "once") : windowKindOf(rule) === "one-shot" ? "once" : rule.inverse ? "fade" : "every";
        const pickPattern = (pt: PatternId) => {
          flowStats.current.decisions++; setPatternNotice(null);
          // audit 6 item 1: a new pattern is a new rule, so the generated name and ticker follow it (a name or ticker the creator typed stays)
          // a market keeps its outcome's suggestion on either side (the same subject); PROD-02: the review's effect words it for the side
          if (guide.follow !== "market") setSrcSuggest({ name: null, ticker: null });
          if (guide.follow === "team" && !team) {
            // website-22 (audit 10 item 14): a team coin opened from the search box has its rule but no team picked in step 2
            if (pt === "once") { setPatternNotice(PATTERN_REASON.noTitleMarket); return; }
            if (dialsFor(rule, dialCtx).inverse) setDial("inverse", pt === "fade" ? "on" : "off"); return;
          }
          if (guide.follow === "team") {
            // audit 6 item 7: a tap never does nothing silently
            if (pt === "once") { if (titleCard?.card) applySuggestion(titleCard.card); else setPatternNotice(titleCard?.state === "loading" ? PATTERN_REASON.titleMarketLoading : PATTERN_REASON.noTitleMarket); return; }
            if (flow !== "team") { setFlow("team"); setPick(null); setEventInfo(null); setDraft(null); setCardCtx(null); }
            setWantInverse(pt === "fade" ? "on" : "off"); return;
          }
          if (guide.follow === "rivalry") {
            // website-23: two candidates in one race and two teams in one game offer Winner takes the burn only (PATTERN_REASON
            // candidatesLinked / gameLinked grey the rest)
            if (meetingsOn || settledPick) return;   // website-21: every game between them offers Winner takes the burn only (patternOptions rivalryScope "meetings")
            if (pt === "once") { if (rivalSeason && !rivalGame) { setPatternNotice(PATTERN_REASON.noMeeting); return; } if (rivalGame) { setGame(rivalGame); const g = rivalGame.pair; if (g && nameAuto) { const nm = pairNames(g.a.nickname ?? g.a.name, g.b.nickname ?? g.b.name, { a: g.a.code ?? g.a.abbr, b: g.b.code ?? g.b.abbr }); setName(nm.a); setNameB(nm.b); } if (g && tickerAuto) { const tk = freePairTickers({ abbr: g.a.abbr, code: g.a.code }, { abbr: g.b.abbr, code: g.b.code }, tickerGuard); setTicker(tk.a); setTickerB(tk.b); } } setPairMode("game"); return; }
            if (rivalSeason) setGame(rivalSeason); setPairMode("season"); if (rivalA && rivalB) renameForSeason(rivalA, rivalB); setWantInverse(pt === "fade" ? "on" : "off"); return;
          }
          if (guide.follow === "market") { setDial("side", pt === "fade" ? "no" : "yes"); return; }
          if (guide.follow === "disaster") {
            // HB-71 (hourly run 5): one pure reducer (hazards.ts hazardPatternSwitch); Every and Once always turn the fade side off, so a
            // stale draft that kept "inverse" on can never trap the creator on "When it does not happen"
            const sw = rule.series ? hazardPatternSwitch({ series: rule.series, inverse: !!rule.inverse }, pt, Date.now()) : null;
            if (!sw) return;
            if ("refused" in sw) { setPatternNotice(sw.refused); return; }
            if (sw.next.series === rule.series) { if (dialsFor(rule, dialCtx).inverse && !!rule.inverse !== sw.next.inverse) setDial("inverse", sw.next.inverse ? "on" : "off"); }
            else { applyRule(hazardRule(sw.next.series), { oracle: "catalogue", series: sw.next.series, market: null, title: pick?.title ?? "" }, { settlement: settleNote }); setWantInverse(sw.next.inverse ? "on" : "off"); }
            // sources-6 (QA 9 #40): a switch that changes a threshold or the subject says so beside the cards
            if (sw.notice) setPatternNotice(sw.notice);
            return;
          }
          setDial("inverse", pt === "fade" ? "on" : "off");
        };
        // website-22 (audit 10 item 2): the unit is the active rule's own, never a source picked on another path
        const budget0 = budgetCopy(rule, shareValue, unitPhrase(activeUnit(rule, pick)), { raiseSol });
        // launch night 2026-10-13 (hunt): two separate coins each spend from their own pool ("this coin" read as one coin for both)
        const budget = pairOn && ruleB && endPickable ? { ...budget0, line: pairBudgetLine(budget0.line) } : budget0;
        // WIRING-AUDIT12 item 16: a team coin names its season beside the team on the Burns step too ("Dodgers, 2026 season")
        const teamSeason = (() => { if (guide.follow !== "team" || !team) return null; const e = rule.oracle === "catalogue" && rule.series ? parseEspnSeries(rule.series) : null; return e && e.kind === "team" && (e.window.kind === "season" || e.window.kind === "post") ? `${team.nickname ?? team.name}, ${seasonLabel(e.league, e.window.year)} season` : null; })();
        const preview = <>{teamSeason && <p className="mb-1 text-xs font-medium text-amber-200" data-team-season>{teamSeason}</p>}<p>{sentence}</p>{!sentence.includes(" once, when ") && <p className="mt-1 text-xs text-neutral-300">{budget.line}</p>}{renderWarnings(srcWarnings, ticker, tickerB).map((w) => <p key={w} className="mt-1 text-xs text-amber-200" data-preview-warning>{w}</p>)}</>;
        const nextBtn = (label: string, to: GuidedPhase) => <StickyAction><button type="button" data-nav className={primary + " w-full sm:w-auto"} onClick={() => setGuide((g) => ({ ...g, phase: to }))}>{label}</button></StickyAction>;
        const pairKindNow = guide.follow === "rivalry" ? (elPick ? "candidates" as const : "teams" as const) : null;
        const rivalryScope = pairKindNow === "teams" ? (meetingsOn ? "meetings" as const : pairMode === "game" ? "game" as const : "season" as const) : null;
        const teamOutcome = rule.oracle === "catalogue" && rule.series ? parseEspnSeries(rule.series)?.outcome ?? null : null;
        if (guide.follow && guide.phase === "burn") {
          // website-22 (QA 9 item 1): a natural disaster's cards are the same set in both its forms (per event, next event), with its own words
          const hazardOpts = (): ReturnType<typeof hazardPatternOptions>["options"] => {
            const now = Date.now(), cur = hazardPatternOptions(rule, now, { dispersal: site.dispersal.available }), once = cur.preselected === "once";
            const sib = rule.series ? hazardSwap(rule.series, once ? "every" : "once", now) : null;
            return stablePatternOptions(cur.options, sib && "series" in sib ? hazardPatternOptions(hazardRule(sib.series), now, { dispersal: site.dispersal.available }).options : null);
          };
          const po = guide.follow === "disaster" ? { options: hazardOpts() } : patternOptions({ follow: patternFollowFor(guide.follow, rule), rule, titleMarket: guide.follow === "team" && !team ? "none" : titleCard?.state ?? "loading", pairKind: pairKindNow, meeting: rivalSeason ? !!rivalGame : null, rivalryScope });
          // pass B item 12, audit 6 item 16: the patterns name the thing picked ("After each Dodgers win")
          const subject = guide.follow === "team" && team ? team.nickname ?? team.name : null;
          // website-25 (WIRING-SOURCES7 M2): a one-game pair on a later game says that game's date, not "their next game"
          const firstGame = rivalA && rivalB ? oneGameHits(rivalry?.key === `${leagueSeries}:${rivalA.abbr}:${rivalB.abbr}` ? rivalry : null, rivalA, rivalB)[0] ?? null : null;
          const gameLabel = pairKindNow === "teams" && rivalGame?.expectedAt && firstGame && firstGame.eventTicker !== rivalGame.eventTicker ? new Date(rivalGame.expectedAt).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "America/Denver" }) : null;
          // website-25 (WIRING-SOURCES7 H6): a team whose season is over offers no season pattern until the creator moves to the next season
          const so = reviewCurrent ? (shownReview.review as (LaunchReview & { seasonOver?: { message: string; next: { series: string; year: number; label: string } } | null }) | null)?.seasonOver ?? null : null;
          const teamOver = guide.follow === "team" && !!team && (!!team.seasonOver || deepSeasonOver === team.abbr) && !(seasonSwap && seasonSwap.abbr === team.abbr);
          const options0 = guide.follow === "disaster" ? po.options : po.options.map((o) => ({ ...o, ...patternWords(o.id, { follow: guide.follow!, subject, outcome: teamOutcome ?? "win", pairKind: pairKindNow, rivalryScope, gameLabel, league: leagueSeries }) }));
          const options = teamOver ? options0.map((o) => (o.id === "every" || o.id === "fade" ? { ...o, available: false, reason: SEASON_OVER_LINE } : o)) : options0;
          // website-25 (WIRING-SOURCES7 M2): "per game without a win" on the fade side (drain.ts teamDrainUnit), never "per win"
          const drain = !oneShotRule && shareValue > SLICED_ABOVE ? drainLine(shareValue, guide.follow === "team" && team ? teamDrainUnit(teamOutcome ?? "win", !!rule.inverse) : "result") : null;
          // WIRING-SOURCES7 M4: the review's drain warning (projection.ts drainWarning), said here as the share changes
          const drainWarn = reviewCurrent ? ((shownReview.review as { warnings?: string[] } | null)?.warnings ?? []).find((w) => /half the pool would be gone/.test(w)) ?? null : null;
          const seasonBlocked = (guide.follow === "team" && !!so) || (teamOver && curPattern !== "once");
          // HB-119 (hourly run 10): the next-season offer is there up front (seasonOver.ts seasonOverRefusal, the same offer the review
          // makes), not only after Next is refused; the title-market button appears only when a market exists, otherwise it says so
          const soNext = so?.next ?? (teamOver ? seasonOverRefusal(rule)?.next ?? null : null);
          const seasonExtra = guide.follow === "team" && team && (so || teamOver) ? (
            <div className="space-y-1 rounded border border-amber-400/50 p-2 text-xs text-amber-200" role="status" data-season-over>
              <p>{so?.message ?? (deepSeasonOver === team.abbr ? SEASON_OVER_LINK_LINE : SEASON_OVER_LINE)}</p>
              <p className="flex flex-wrap gap-3">
                {soNext && <button type="button" data-decision="what" data-season-next={soNext.series} className="rounded bg-amber-400 px-3 py-1 font-medium text-neutral-950" onClick={() => { setSeasonSwap({ abbr: team.abbr, series: soNext.series, label: soNext.label }); setPatternNotice(null); }}>{nextSeasonButtonLabel(team.nickname ?? team.name, soNext.label)}</button>}
                {titleCard?.state === "found" ? <button type="button" data-decision="what" className="underline" onClick={() => pickPattern("once")}>Follow next season&apos;s title market instead</button>
                  : titleCard?.state === "none" ? <span className="text-neutral-400" data-no-title-market>{NO_TITLE_MARKET_LINE}</span> : null}
              </p>
            </div>
          ) : null;
          // sources-6 (QA 9 #40, audit 10 #18): a natural disaster's thresholds as choices the adapter reads, and what the pattern measures
          const hk: HazardKindId | null = hazardKind ?? (/^usgs\.volcano/.test(rule.series ?? "") ? "volcano" : /^usgs\.quake/.test(rule.series ?? "") ? "quake" : /^nhc\./.test(rule.series ?? "") ? "hurricane" : /^spc\./.test(rule.series ?? "") ? "tornado" : /^nifc\./.test(rule.series ?? "") ? "wildfire" : null);
          const hazardExtra = guide.follow === "disaster" && hk ? (() => {
            const hazardKind = hk;
            const pat: "every" | "once" = curPattern === "once" ? "once" : "every", now = Date.now();
            const ctls = (hazardCatalogueOf ?? hazardControls())[hazardKind]?.[pat] ?? [];
            const shown = hazardShownValues(hazardKind, pat, rule.series ?? "", hazardVals[pat], now);
            const change = (id: string, v: string) => {
              const vals = { ...shown, [id]: v }; setHazardVals((x) => ({ ...x, [pat]: vals }));
              const r = hazardSeriesFor(hazardKind, pat, vals, now);
              if ("refused" in r) { setPatternNotice(r.refused); return; }
              setPatternNotice(null);
              applyRule(hazardRule(r.series), { oracle: "catalogue", series: r.series, market: null, title: pick?.title ?? "" }, { settlement: settleNote });
              if (pat === "every" && rule.inverse) setWantInverse("on");
            };
            return (
              <div className="space-y-2" data-hazard-controls>
                <p className="text-xs text-neutral-300" data-hazard-measures>{HAZARD_MEASURES[hazardKind][pat]}</p>
                {ctls.length > 0 && <div className="flex flex-wrap gap-3">{ctls.map((c) => (
                  <label key={c.id} className="block text-xs text-neutral-400">{c.label}<FieldHelp id={hazardHelpId(c.id)} />
                    <select data-decision="what" data-help={hazardHelpId(c.id)} aria-label={c.label} data-hazard-control={c.id} className={input + " mt-1 block w-auto"} value={shown[c.id] ?? c.default} onChange={(e) => change(c.id, e.target.value)}>{c.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
                  </label>
                ))}</div>}
              </div>
            );
          })() : null;
          // owner 2026-10-13: a soccer team coin picks which results burn, one of win, draw or loss or any two of them (espn.ts
          // PairOutcome; the side dial's options, dials.ts). Shown on the plain side only: the fade side is its own pattern, and a coin on two
          // results cannot take it (inverse.ts), so picking two results there would be refused.
          const teamE = guide.follow === "team" && team && rule.oracle === "catalogue" && rule.series ? parseEspnSeries(rule.series) : null;
          const resultsExtra = teamE?.kind === "team" && teamE.window.kind !== "meetings" && curPattern === "every" && !rule.inverse && LEAGUES[teamE.league].sport === "soccer" && curDials?.side ? (
            <label className="block text-xs text-neutral-400" data-team-results>{TEAM_RESULTS_LABEL}<FieldHelp id="team-results" />
              <select data-decision="what" data-help="team-results" aria-label={TEAM_RESULTS_LABEL} className={input + " mt-1 block w-auto"} value={curDials.side.value} onChange={(e) => { flowStats.current.decisions++; setDial("side", e.target.value); }}>{curDials.side.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
            </label>
          ) : null;
          // website-24 (WIRING-ROUND5): what the coin burns, itself (the default) or a real token; the waiting line until round 5 is deployed
          const realExtra = pairOn || !rule || rule.vault ? null : realOneOffered
            ? <BurnRealChoice side="one" who={`$${ticker.toUpperCase() || "TICKER"}`} picks={realOnePicks} value={realOne} onChange={setRealOne} network={realNet} locked={busy} />
            // WIRING-AUDIT12 item 15: only where a target could be set (this condition), one tap away
            // launch wizard audit 2026-10-19 F16: and only where the creator expects the choice, a rule that came with a burn target (a
            // "launch one like this" link or a template of such a coin); every other coin says nothing about a feature this site does not offer
            : site.burnReal.line && rule0?.burnTarget && realBurnAllowed(rule0) ? <details className="text-xs text-neutral-400" data-burn-real-waiting><summary className="cursor-pointer">What is not offered yet</summary><p className="mt-1">{site.burnReal.line}</p></details> : null;
          return <PatternStep drain={drain} preview={preview} options={options} value={curPattern} onPick={pickPattern} shares={shareOptions} share={shareValue} onShare={setShare} shareLine={linkedOneShotRow ? LINKED_ONE_SHOT_LINE : null} pairLabel={pairOn && !!ruleB} math={budget.math} notice={patternNotice ?? shareNotice} extra={hazardExtra || realExtra || seasonExtra || drainWarn || resultsExtra || byeNow ? <>{byeNow && <p className="text-xs text-neutral-400" data-bye-line>{byeNow}</p>}{seasonExtra}{resultsExtra}{drainWarn && <p className="text-xs text-amber-300" role="status" data-drain-warning>{drainWarn}</p>}{hazardExtra}{realExtra}</> : null} next={seasonBlocked ? <StickyAction><button type="button" data-nav disabled className={primary + " w-full sm:w-auto"}>Next</button></StickyAction> : nextBtn("Next", "name")} />;
        }
        // the end, stated on the review (the server adds the default end, with the $DEFICIT sink, to a rule sent without one)
        // website-21: a rivalry series pair ends as built (the pair-winner sink): the rest goes to the series winner, and no other end is offered
        const endRule = ruleShown ?? rule;
        const end = endSentences(endRule.onEnd ? endRule : ({ ...endRule, onEnd: { ...ON_END_DEFAULT } } as BurnRule), { team: team?.nickname ? `the ${team.nickname}` : null, party: partyRace });
        // website-21: the guided review states the end as one fact (the end section shows only without facts): the one end, its sentence
        // and the pair's 30-day both-or-neither deadline
        const meetingsEndFact = `${MEETINGS_END_LABEL}. ${meetingsEndLine(rule)} ${MEETINGS_DEADLINE_LINE}`;
        // the end-sink picker: each coin's choice of where its rest goes when it does not win (both coins of an independent pair)
        const teamRef = team?.nickname ? `the ${team.nickname}` : null;
        // website-26 (WIRING-END-SINKS): the incinerator is a single coin's choice (a pair rule with it is refused), shown only while the
        // launch state says the host has it (burnSol, off until round 5 is deployed); "another coin's burn" only while sinkPicker is on
        const endSite = { burnSol: site.burnSol.available, sinkPicker: site.sinkPicker.available };
        // PROD-03 (2026-10-19): two independent coins get the same choices, each from its own rule (pairEnds.ts endChoicesFor)
        const choiceA = endPickable && rule ? endChoiceModel(rule, { ...endChoicesFor(rule, endSite), team: teamRef }) : null;
        const teamRefB = pairOn && ruleB && sideB?.nickname ? `the ${sideB.nickname}` : null;
        const choiceB = endPickable && pairOn && ruleB ? endChoiceModel(ruleB, { ...endChoicesFor(ruleB, endSite), team: teamRefB }) : null;
        // walkthrough 13 (2026-10-14): on the review the end sentences above the picker already say the champion path, so the picker there
        // (withWinning false) states only where the rest goes when the team does not win; the name step's picker stands alone and keeps it
        const endChoiceFor = (withWinning: boolean) => choiceA?.offered || choiceB?.offered ? (
          <div className={`grid min-w-0 gap-3 ${choiceA?.offered && choiceB?.offered ? "md:grid-cols-2" : ""}`} data-end-choices>
            {endNotice && <p className="text-xs text-amber-300 md:col-span-2" role="status" data-end-notice>{endNotice}</p>}
            {choiceA?.offered && <EndChoicePicker model={choiceA} hideWinning={!withWinning} value={endA} onChange={(c) => { flowStats.current.decisions++; setEndA(c); }} sinks={sinks} who={pairOn && ruleB ? `$${ticker.toUpperCase() || "A"}` : null} locked={busy} side="a" />}
            {choiceB?.offered && <EndChoicePicker model={choiceB} hideWinning={!withWinning} value={endB} onChange={(c) => { flowStats.current.decisions++; setEndB(c); }} sinks={sinks} who={`$${tickerB.toUpperCase() || "B"}`} locked={busy} side="b" />}
          </div>
        ) : null;
        const endChoiceBlock = endChoiceFor(true), endChoiceReview = endChoiceFor(false);
        // website-23: a settled-event pair's one end (the race's or the game's pair-winner end) and its 30-day both-or-neither deadline
        const settledEndFact = `${SETTLED_END_LABEL}. ${end.sentences.join(" ")} ${SETTLED_DEADLINE_LINE}`;
        // PROD-03: two independent coins each say their own end on their own line, led by the coin's ticker (pairEnds.ts perCoinEndLines);
        // a linked pair (endPickable false) keeps its one pair end
        const endRuleB = ruleShownB ?? ruleB;
        const endTextB = endPickable && pairOn && endRuleB ? endSentences(endRuleB.onEnd ? endRuleB : ({ ...endRuleB, onEnd: { ...ON_END_DEFAULT } } as BurnRule), { team: teamRefB }) : null;
        const losingPathOff = (xs: string[], c: typeof choiceA) => (c?.offered && c.winning ? xs.filter((x) => !/^If they do not\b/.test(x)) : xs);
        // walkthrough 13: with a champion-path picker below, the losing path ("If they do not, the rest goes to …") is the picker's to say
        const endLines = perCoinEndLines({ ticker: ticker.toUpperCase(), sentences: losingPathOff(end.sentences, choiceA) }, endTextB ? { ticker: tickerB.toUpperCase(), sentences: losingPathOff(endTextB.sentences, choiceB) } : null);
        // item 53: an election coin says who decides the result (the race's certified count is the cross-check)
        const certified = elPick ? elPick.race.settlement.replace(/^.*checked against /, "") : eventInfo?.certified ?? null;
        const authority = certified ? electionAuthorityLines(certified) : null;
        // WIRING-SEMANTICS: the edge cases that apply to this rule, one tap away
        const espnParsed = rule.oracle === "catalogue" && rule.series ? parseEspnSeries(rule.series) : null;
        // website-25 (QA 11 M8): only the unusual cases this league can have: draws and cup ties where the league has draws, doubleheaders in MLB
        const espnCases = espnParsed ? [...(leagues.find((l) => l.id === espnParsed.league)?.draws ? [78] : []), 79, ...(espnParsed.league === "mlb" ? [80] : [])] : [];
        const separatePair = pairOn && pairMode === "season" && !meetingsOn && !settledPick && !elPick;
        const edgeIds: number[] = [
          // HB-81 R1 (hourly run 5): the separate "Every loss this season" pair moves nothing between its coins, so the linked-pair cases
          // (76 waiting for both pools, 168 leftover to another coin) are not listed for it
          ...espnCases, ...(pairOn && !separatePair && (!elPick || settledPick) ? [76] : []), ...(elPick ? [82] : []),
          ...changeRuleEdgeIds(rule), ...(rule.oracle === "catalogue" && /^nws\./.test(rule.series ?? "") ? [86, 87] : []),
          // WIRING-SEMANTICS-2: the floor, the end's destination, the fingerprint, and Polymarket's split and unresolved payouts
          // HB-33: the minimum-burn (2% limit) and leftover-to-another-coin cases only where the rule can meet them
          ...reviewEdgeIds({ oneShotFull: oneShotFull(rule), otherCoin: (pairOn && !separatePair) || endA.kind === "coin" || endB.kind === "coin" }), ...(rule.oracle === "polymarket" ? [178, 179, 180] : []), ...(rule.oracle === "catalogue" ? [218] : []),
        ];
        // HB-81 D5: item 218 on a one-time coin does not say that nothing ends the rule (its one burn or its deadline does)
        const edgeNotes = [...new Set(edgeIds)].map((i) => edgeCaseFor(i, { oneGame: espnParsed?.kind === "game", oneShot: windowKindOf(rule) === "one-shot", racePair: !!rule.pair?.race })).filter((x): x is string => !!x);
        // HB-93 (hourly run 7): an inverse hurricane coin burns on every off-season day (hazardSeason.ts, the source's season dates)
        { const off = offSeasonLine(rule); if (off) edgeNotes.unshift(off); }
        const coinsN: 1 | 2 = pairOn && ruleB ? 2 : 1;
        const editTo = (p: GuidedPhase) => () => { if (p === "which") toWhich(); else setGuide((g) => ({ ...g, phase: p })); };
        const endFact = meetingsOn ? meetingsEndFact : settledPick ? settledEndFact : endLines.join(endTextB ? "\n" : " ") || PERPETUAL_END_LINE;
        // HS-49 (hourly run 9): an end other than the default is named on the review, with an Edit link back to the Name step's choice
        const endChanged = pairOn ? null : endChoiceChangedLine(endA);
        const reviewFacts = guide.follow ? [
          // HS-39 (hourly run 7): a hazard coin's trigger is built on the burn step (pattern, strength, area), so Edit opens it with those
          // choices kept; "Change which" in the crumbs still changes the hazard
          { label: FACT_LABELS.trigger, value: trigger, edit: editTo(triggerEditPhase(guide.follow)) },
          { label: FACT_LABELS.coin, value: settledPick ? settledWhichCoinLine(settledPick, { a: ticker || "A", b: tickerB || "B" }) : meetingsOn ? meetingsWhichCoinLine({ a: ticker || "A", b: tickerB || "B", teamA: A, teamB: B }) : whichCoinLine(ticker || "A", coinsN === 2 ? tickerB || "B" : null), edit: editTo("name") },
          { label: FACT_LABELS.amount, value: `${budget.line} ${shareOfBudgetLine(shareValue)} ${shareExample(shareValue)}`, edit: editTo("burn") },
          { label: FACT_LABELS.ends, value: endChanged ? `${endFact}\n${endChanged}` : endFact, edit: endChanged ? editTo("name") : null, extra: endChoiceReview },
          { label: FACT_LABELS.cost, value: costLine(shownReview.review && reviewCurrent ? shownReview.review.costs.totalSol : null, coinsN), edit: null },
        ] : null;
        const two = pairOn && !!ruleB;
        // website-22 (QA 9 items 11 and 12, audit 10 item 10): every problem in the name step's fields, each with the field it belongs to,
        // so the review lists all of them (the note included) and each one's Edit link lands on its field
        // website-25 (QA 11 H5, WIRING-SOURCES7 H2): the description's wording rules and the room the rule's own paragraph leaves
        // (profileIssues), and the server's own field problems (a reserved, major or lookalike ticker, another team's code, a campaign
        // phrase) said here too, each with its Edit link, so the name step and the review list the same things
        const genA = rv?.coins?.[0]?.description ?? null;
        const genB = reviewMeetings?.descriptionB ?? reviewSettled?.descriptionB ?? rv?.coins?.[1]?.description ?? null;
        const issuesA = profileIssues(profile, genA), issuesB = two ? profileIssues(profileB, genB) : [];
        const sideTag = (side: "a" | "b") => (two ? `$${(side === "a" ? ticker : tickerB) || side.toUpperCase()}: ` : "");
        const clientSaidName = new Set([nameProblem(name), tickerProblem(ticker), coinA.nameIssue, coinA.tickerIssue, ...(two ? [nameProblem(nameB), tickerProblem(tickerB), coins[1]?.nameIssue, coins[1]?.tickerIssue] : []), ...issuesA.map((x) => x.text), ...issuesB.map((x) => x.text), noteProblem ?? "", ...identity].filter((x): x is string => !!x).map((x) => x.replace(/\.$/, "").toLowerCase()));
        const serverFields = reviewCurrent ? serverFieldProblems(shownReview.review?.problems ?? [], clientSaidName) : [];
        const profileBlockers: Blocker[] = [
          ...issuesA.map((x) => ({ text: `${sideTag("a")}${x.text}`, edit: () => editField("a", x.field) })),
          ...issuesB.map((x) => ({ text: `${sideTag("b")}${x.text}`, edit: () => editField("b", x.field) })),
          ...(noteProblem && !pairOn ? [{ text: noteProblem, edit: () => editField("a", "note") }] : []),
          ...identity.map((x) => ({ text: x, edit: () => editField("b", /ticker/.test(x) ? "ticker" : "name") })),
          ...serverFields.map((x) => ({ text: x.text, edit: () => editField(x.side, x.field) })),
        ];
        // prelaunch audit 2026-10-18 (the Name step): the server's ticker problem (a held or lookalike ticker) is said under the field
        const nameBlockers = profileBlockers.filter((b) => !serverFields.some((x) => x.field === "ticker" && x.text === (typeof b === "string" ? b : b.text)));
        const serverTicker = (side: "a" | "b") => serverFields.find((x) => x.side === side && x.field === "ticker")?.text.replace(/^Coin [AB]\. /, "") ?? null;
        const coinsForName = coins.map((c, i) => { const t = c.tickerIssue || serverTicker(i === 0 ? "a" : "b"); return t ? { ...c, tickerIssue: t } : c; });
        // QA 9 item 14: the image line is confirmed on step 4; Next waits, and says why beside it
        const rightsMissing = (!!profile.image && !profile.rights) || (two && !!profileB.image && !profileB.rights);
        // website-25 (QA 11 H5): Review stays disabled while any field on this step has a problem, as it already did for the image line
        // HB-86: the server's ticker checks (exact, near, draft-held) come back in the review answer; the step waits for it
        const nameChecking = nameStepWaitsForReview({ reviewCurrent, reviewError: shownReview.error });
        const nameStepBlocked = rightsMissing || !ready || nameChecking || nameBlockers.length > 0 || coinsForName.some((c) => !!c.nameIssue || !!c.tickerIssue);
        if (guide.follow && guide.phase === "name") {
          return <>
            {pairGen && pairSwap && tickerAuto && sideA && sideB && (pairSwap.a || pairSwap.b) && (() => { const sw = pairSwap, orig = freePairTickers(sideA, sideB, null); return <p className="text-xs text-neutral-300" role="status" data-pair-ticker-swap>{[sw.a ? pairTickerSwapLine(orig.a, pairGen.a.ticker) : null, sw.b ? pairTickerSwapLine(orig.b, pairGen.b.ticker) : null].filter(Boolean).join(" ")}</p>; })()}
            {singleSwap && <p className="text-xs text-neutral-300" role="status" data-ticker-swap>{hazardSwapLine(singleSwap.from, singleSwap.to, singleSwap.name)}</p>}
            {namesRemade && <p className="rounded border border-amber-400/50 p-2 text-xs text-amber-200" role="status" data-names-remade>{namesRemadeLine(pairOn ? 2 : 1, namesRemade || "follows")}</p>}
            {keptProfile && keptProfile.length > 0 && <p className="rounded border border-amber-400/50 p-2 text-xs text-amber-200" role="status" data-kept-profile>{keptProfileLine(keptProfile)} <button type="button" data-nav className="underline" onClick={() => setKeptProfile(null)}>{KEPT_PROFILE_REUSE}</button> <button type="button" data-nav className="ml-2 underline" onClick={() => { setProfile((x) => ({ ...x, description: "", x: "", telegram: "", website: "" })); setProfileB((x) => ({ ...x, description: "", x: "", telegram: "", website: "" })); setNote(""); setKeptProfile(null); }}>{KEPT_PROFILE_FRESH}</button></p>}
            <ReviewCard mode="name" endChoice={endChoiceBlock} coins={coinsForName} sentence={sentence} ends={null} shares={{ options: [...shareOptions], value: shareValue, onChange: () => {} }} problems={[]} error={null} busy={false} ready={ready} creator={creator || null} onLaunch={() => {}}
            image={two ? <div className="grid min-w-0 gap-2 md:grid-cols-2" data-pair-images>{imageField(profile, setProfile, `$${ticker || "A"}`, true, "a")}{imageField(profileB, setProfileB, `$${tickerB || "B"}`, false, "b")}</div> : imageField(profile, setProfile, null)}
            profile={two ? <div className="grid min-w-0 gap-2 md:grid-cols-2"><ProfileFields value={profile} onChange={setProfile} generated={genA} part="text" who={`$${ticker || "A"}`} side="a" /><ProfileFields value={profileB} onChange={setProfileB} generated={genB} part="text" who={`$${tickerB || "B"}`} side="b" /></div> : <ProfileFields value={profile} onChange={setProfile} generated={genA} part="text" side="a" />}
            note={pairOn ? null : { value: note, onChange: setNote, problem: noteProblem }}
            tickerChecks={reviewCurrent && rv?.tickers ? rv.tickers.map((t) => (t.reserved && coinsForName[t.side === "A" ? 0 : 1]?.tickerIssue === RESERVED_TICKER_LINE ? { ...t, reserved: false } : t)) : null} onProveTicker={proveTicker} draftHeld={draftHeld}
            profileProblems={nameBlockers}
            next={<StickyAction>{nameStepBlocked && <p className="mb-1 text-xs text-amber-300" role="status" data-next-blocked>{rightsMissing ? IMAGE_RIGHTS_REQUIRED : nameChecking && nameBlockers.length === 0 && !coinsForName.some((c) => !!c.nameIssue || !!c.tickerIssue) ? NAME_STEP_CHECKING : NAME_STEP_BLOCKED}</p>}<button type="button" data-nav className={primary + " w-full sm:w-auto"} disabled={nameStepBlocked} onClick={() => setGuide((g) => ({ ...g, phase: "review" }))}>Review</button></StickyAction>} />
          </>;
        }
        // website-22 (audit 10 item 10): the server's own problems join the list, each said once (a problem the page already names is not repeated)
        const clientSaid = new Set([nameProblem(name), tickerProblem(ticker), ...(two ? [nameProblem(nameB), tickerProblem(tickerB)] : []), ...issuesA.map((x) => x.text), ...issuesB.map((x) => x.text), noteProblem ?? "", ...problems].filter(Boolean).map((x) => x.replace(/\.$/, "").toLowerCase()));
        // website-25: the per-hit lint lines are said once per field by the page, and the field problems already sit in profileBlockers
        const serverBlockers = reviewCurrent ? (shownReview.review?.problems ?? []).filter((x) => !isLintLine(x) && !serverFields.some((f) => f.text === x) && !clientSaidName.has(x.replace(/^Coin [AB]\. /, "").replace(/\.$/, "").toLowerCase()) && !clientSaid.has(x.replace(/^Coin [AB]\. /, "").replace(/\.$/, "").toLowerCase())) : [];
        const realOneBlockers: Blocker[] = realOneOffered ? realBlockers([{ ticker: ticker.toUpperCase(), side: realOne, network: realNet }]).map((t) => ({ text: t, edit: guide.follow ? () => setGuide((g) => ({ ...g, phase: "burn" })) : null })) : [];
        const allBlockers: Blocker[] = [...profileBlockers, ...realOneBlockers, ...reviewBlockers({ serverProblems: serverBlockers }).map((t) => ({ text: t, edit: /description/i.test(t) ? () => editField(/^Coin B\. /.test(t) ? "b" : "a", "description") : /\bnote\b/i.test(t) ? () => editField("a", "note") : null }))];
        // audit 10 item 3: the fee sentence by the venue the launch really uses
        const venue: LaunchVenue = !two && !(pairOn && !ruleB) ? "single" : meetingsOn || settledPick ? "linked" : pairOn && !ruleB ? (pairVenue === "pair-curve" ? "pair-curve" : "linked") : "independent";
        // QA 9 item 13, audit 10 item 19: the public profile as it is pinned, with an Edit link per field
        const publicProfile = guide.follow ? {
          coins: [
            { side: "a" as const, image: coinA.image, name, ticker, description: profile.description, links: creatorLinks({ x: profile.x, telegram: profile.telegram, website: profile.website }).links, note: pairOn ? null : note, generated: reviewCurrent ? genA : null },
            ...(two ? [{ side: "b" as const, image: coins[1].image, name: nameB, ticker: tickerB, description: profileB.description, links: creatorLinks({ x: profileB.x, telegram: profileB.telegram, website: profileB.website }).links, note: null, generated: reviewCurrent ? genB : null }] : []),
          ],
          edit: (side: "a" | "b", f: ProfileFieldKey) => editField(side, f),
        } : null;
        return (
          <>
            <ReviewCard
              mode={guide.follow ? "review" : "full"}
              facts={reviewFacts}
              endSection={meetingsOn ? <EndSection title={MEETINGS_END_LABEL} sentences={[meetingsEndLine(rule), MEETINGS_DEADLINE_LINE]} options={[]} /> : settledPick ? <EndSection title={SETTLED_END_LABEL} sentences={[...end.sentences, SETTLED_DEADLINE_LINE]} options={[]} /> : <EndSection sentences={endLines} options={end.options.filter((o) => o.available || (o.kind === "named-coin" ? site.sinkPicker.available : o.kind === "incinerator" ? endChoicesFor(rule, endSite).burnSol : true))} choice={endChoiceReview} />}
              authority={authority}
              edgeNotes={edgeNotes}
              upfront={upfrontLines(RAISE_PRESETS_SOL, { team: guide.follow === "team", end: pairOn ? null : endA, pair: pairOn, perpetual: !pairOn && windowKindOf(rule) === "perpetual", endLine: pairOn ? endFact.replace(/\n/g, " ") : null })}
              amountMath={budget.math}
              coins={coins}
              sentence={sentence}
              pairLine={settledPick ? reviewSettled?.sentence ?? settledLine : pairOn && !ruleB ? PAIR_REVIEW_LINE : null}
              pairFacts={facts}
              ends={endText(endRule.onEnd ? endRule : ({ ...endRule, onEnd: { ...ON_END_DEFAULT } } as BurnRule), { team: team?.nickname ? `the ${team.nickname}` : null, party: partyRace }).line}
              shares={{ options: [...shareOptions], value: shareValue, onChange: setShare }}
              inverse={curDials?.inverse ? { options: curDials.inverse.options, value: curDials.inverse.on ? "on" : "off", onChange: (v) => { flowStats.current.decisions++; setDial("inverse", v); } } : null}
              raise={pairOn && !ruleB ? null : (meetingsOn || settledPick) && !shownReview.review?.raise ? null : { options: [...RAISE_PRESETS_SOL], value: raiseSol, onChange: (v) => { flowStats.current.decisions++; setRaiseSol(v); }, line: shownReview.review?.raise?.line ?? null }}
              durations={pairOn && !elPick && !meetingsOn ? { options: [...(rivalSeason && !rivalGame ? [] : [{ value: "game", label: RIVALRY_GAME_LABEL.toLowerCase() }]), { value: "season", label: RIVALRY_SEASON_LABEL.toLowerCase() }], value: pairMode === "game" ? "game" : "season", onChange: (v) => { flowStats.current.decisions++; if (rivalSeason) setGame(v === "game" && rivalGame ? rivalGame : rivalSeason); setPairMode(v === "game" ? "game" : "season"); if (v !== "game" && rivalA && rivalB) renameForSeason(rivalA, rivalB); else if (v === "game" && rivalGame?.pair) { const g = rivalGame.pair; if (nameAuto) { const nm = pairNames(g.a.nickname ?? g.a.name, g.b.nickname ?? g.b.name, { a: g.a.code ?? g.a.abbr, b: g.b.code ?? g.b.abbr }); setName(nm.a); setNameB(nm.b); } if (tickerAuto) { const tk = freePairTickers({ abbr: g.a.abbr, code: g.a.code }, { abbr: g.b.abbr, code: g.b.code }, tickerGuard); setTicker(tk.a); setTickerB(tk.b); } } } } : null}
              note={pairOn ? null : { value: note, onChange: setNote, problem: noteProblem }}
              problems={problems}
              error={launchErr}
              busy={busy}
              signs={shownReview.review?.transactions.count ? walletPromptCount({ transactions: shownReview.review.transactions.count, proof: proofAsked }) : null}
              signsProof={proofAsked}
              ready={ready}
              creator={creator || null}
              onLaunch={() => { void launch(); }}
              mintSearch={<MintAddressBlock pool={mintPool} />}
              duplicate={<DuplicateNotice existing={(shownReview.review as (LaunchReview & { existing?: ExistingCoin[] }) | null)?.existing ?? []} />}
              summary={<PreWalletSummary review={shownReview.review} loading={shownReview.loading} error={shownReview.error} updating={reviewSlot.rev !== reviewKey && !!reviewSlot.review} proof={proofAsked} />}
              cost={shownReview.review && reviewCurrent ? `The estimated cost is about ${shownReview.review.costs.totalSol} SOL.` : null}
              costNote={venue === "linked" || venue === "pair-curve" ? PAIR_COST_EXCLUSIONS : null}
              venue={venue}
              publicProfile={publicProfile}
              pairDiagram={two || (pairOn && !ruleB) ? (venue === "independent" ? "independent" : "linked") : null}
              pairDiagramText={two || (pairOn && !ruleB) ? pairDiagramLabel(rule, venue !== "independent") : null}
              image={two ? <div className="grid min-w-0 gap-2 md:grid-cols-2" data-pair-images>{imageField(profile, setProfile, `$${ticker || "A"}`, true, "a")}{imageField(profileB, setProfileB, `$${tickerB || "B"}`, false, "b")}</div> : imageField(profile, setProfile, null)}
              profile={two ? <div className="grid min-w-0 gap-2 md:grid-cols-2"><ProfileFields value={profile} onChange={setProfile} generated={genA} part="text" who={`$${ticker || "A"}`} side="a" /><ProfileFields value={profileB} onChange={setProfileB} generated={genB} part="text" who={`$${tickerB || "B"}`} side="b" /></div> : <ProfileFields value={profile} onChange={setProfile} generated={genA} part="text" side="a" />}
              advanced={teamPath ? { defaults: teamAdvancedDefaults({ sharePct: pct(shareValue), raiseSol: raiseSol, minForwardSol: String(ON_END_DEFAULT.sweepThresholdLamports / 1e9), profile: { image: !!profile.image, description: !!profile.description.trim(), links: [profile.x, profile.telegram, profile.website].filter((x) => x.trim()).length } }) } : null}
              profileProblems={allBlockers}
              blocked={walletBlocked(pairOn ? "matchup" : launchTypeOf(rule), pairOn)}
              warnings={[...new Set([...renderWarnings(srcWarnings, ticker, tickerB), ...(reviewCurrent ? (rv as { warnings?: string[] } | null)?.warnings ?? [] : [])])]}
              shareNotice={shareNotice}
              event={flow === "single" && pick?.oracle === "polymarket" && !pairOn ? eventShown : null}
              budget={budget}
              dispute={reviewCurrent ? rv?.dispute ?? null : null}
              graduation={rv?.graduation ?? null}
              tickerChecks={reviewCurrent && rv?.tickers ? rv.tickers.map((t) => (t.reserved && coinsForName[t.side === "A" ? 0 : 1]?.tickerIssue === RESERVED_TICKER_LINE ? { ...t, reserved: false } : t)) : null} onProveTicker={proveTicker} draftHeld={draftHeld}
              notes={notes}
              simulator={reviewCurrent && rv?.simulation ? <SimulatorDisclosure simulation={rv.simulation} rule={rule} /> : null}
              namePrompt={!pairOn && text?.name === "Event Coin" ? "This question does not give a clear coin name: please name the coin (and check the ticker) before you launch." : null}
            />
            {/* website-15 item 4 (Claude site audit 3 item 2): a failed back-test says so in one line; the reason sits behind Details */}
            {/* WIRING-PARITY audit 6 #11: what the rule would have spent on past readings, at 1, 2 and 5 %, or why there is no projection */}
            {/* website-26 (WIRING-FEATURES item 5): a team coin's last season (review.backtest) where the projection is unavailable */}
            {reviewCurrent && rv?.projection && <details className="text-xs text-neutral-300" data-projection><summary className="cursor-pointer">How much it would have spent before</summary>{rv.projection.available ? rv.projection.lines.map((x) => <p key={x} className="mt-1">{x}</p>) : rv.backtest?.available ? rv.backtest.lines.map((x) => <p key={x} className="mt-1" data-last-season>{x}</p>) : <><p className="mt-1">{rv.projection.reason}</p>{rv.backtest?.reason && <details className="mt-1 text-neutral-500" data-last-season-unavailable><summary className="cursor-pointer">Details</summary><p className="break-words">{rv.backtest.reason}</p></details>}</>}</details>}
            {(btBusy || btWaiting) && !(reviewCurrent && rv?.projection) && <p className="text-xs text-neutral-400" role="status" data-backtest-waiting>{BACKTEST_WAITING_LINE}</p>}
            {btErr && !btWaiting && btFor === btKey && !rv?.projection && <div className="text-xs text-amber-300" role="status" data-backtest-unavailable><p>{btErr.includes(BACKTEST_SLOW) ? BACKTEST_SLOW : BACKTEST_UNAVAILABLE}</p><details className="text-neutral-500"><summary className="cursor-pointer">Details</summary><p className="break-words font-mono">{btErr}</p>{rv?.backtest?.reason && <p className="break-words">{rv.backtest.reason}</p>}</details></div>}
            {/* website brief §2: the funds flow before a registered pair launches (pairs made now are winner-takes-the-burn) */}
            {reviewMeetings?.flow && <FundsFlowView flow={reviewMeetings.flow} open />}
            {/* website-23: a settled-event pair's money path and coin B's description, as the review answered them (review.settled) */}
            {/* walkthrough 13: the race line is said once, by the review card's pair line above, so the money path leaves it out */}
            {reviewSettled?.flow && <FundsFlowView flow={reviewSettled.flow} open saidAbove={reviewSettled.sentence ?? settledLine} />}
            {settledPick && reviewSettled?.descriptionB && !(two && publicProfile) && <section className="rounded-lg border border-neutral-800 p-3 text-xs" aria-label={`$${tickerB || "B"}'s description`} data-settled-description-b><p className="font-mono text-[11px] uppercase tracking-widest text-neutral-500">${tickerB || "B"}&apos;s description</p><p className="mt-1 break-words text-neutral-200">{reviewSettled.descriptionB}</p></section>}
            {pairOn && !ruleB && <PairFundsFlow version="winner-takes-the-burn" tickers={{ a: ticker || "A", b: tickerB || "B" }} open />}
            <p className="text-xs"><button className="underline" data-nav onClick={back}>← Back</button></p>
          </>
        );
      })()}

      {/* ------------------------------------- LAUNCH: sign and send (SignCard: the same component for one coin, two coins and the pair curve) ------------------------------------- */}
      {step === "launch" && (bundle || pcOut) && (() => {
        const st = signTickers ?? { a: ticker, b: tickerB };
        // F06 (prelaunch audit 2026-10-18): the plan carries its deadline into the card and the shared runner (a plan without a receipt
        // time is treated as already past it)
        const plan = withPlanDeadline(pcOut ? pairCurvePlan(pcOut.pc, pcOut.keys, st) : pairOut ? launchlabPlan([pairOut.a, pairOut.b]) : launchlabPlan([bundle!]), planAt ?? 0);
        const two = !!(pcOut || pairOut);
        if (planExpired(planAt, clock)) return (
          <section className="space-y-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm" data-plan-expired>
            <p>{PLAN_EXPIRED_SENTENCE}</p>
            <button type="button" data-decision="new-plan" className="rounded border border-neutral-600 px-3 py-1 text-xs" onClick={() => startOver(true)}>Start over</button>
          </section>
        );
        return (
          <section className="space-y-3 text-sm">
            <SignCard plan={plan} creator={creator || null} title={two ? `Launch $${st.a} and $${st.b}` : `Launch $${st.a}`} coinHref={coinCanonicalHref} onLive={dropDraft} onStartOver={() => startOver(true)} />
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
