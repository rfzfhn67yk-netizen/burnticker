"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { previewTotals, unitStep, type SettledEvent } from "@/lib/burnticker/units";
import type { BurnRule } from "@/lib/burnticker/rules";
import { aliasLookup } from "@/lib/burnticker/oracle/events";
import { DEFAULT_FRACTION, firstPartyRule, teamCoinSentence } from "@/lib/burnticker/wizard";
import { plainSentence, ruleOneLiner } from "@/lib/burnticker/coinCard";
import { CoinCard } from "../_components/CoinCard";
import { FieldHelp } from "../_components/FieldHelp";
import { CoinVsCoinTile } from "./CoinVsCoinTile";
import { PairCurveSign } from "./PairCurveSign";
import { launchErrorMessage, LaunchRequestError, PAIR_CURVE_REVIEW_LINE, postPairLaunch, venueFor, venueFrom409, type LaunchErrorBody, type PairVenue } from "@/lib/burnticker/pairLaunchClient";
import type { PairCurveLaunchBundle } from "@/lib/burnticker/pairCurveLaunch";
import { STATIONS, nwsSeries, parseNwsSeries } from "@/lib/burnticker/sources/nws";
import { applyDial, dialsFor, type DialId } from "@/lib/burnticker/dials";
import { describeRule, DESCRIPTION_MAX, type CoinText, type DescribeCtx } from "@/lib/burnticker/describe";
import { parseEspnSeries, seasonYearAt, teamSeries, type LeagueId, type Window as TeamWindow } from "@/lib/burnticker/sources/espn";
import { TEMPLATE_START, type TemplateId } from "@/lib/burnticker/templates";
import type { Suggestion as SearchSuggestion } from "@/lib/burnticker/search";
import { fold, meaningful, queryTokens } from "@/lib/burnticker/textMatch";

/**
 * THE CREATE WIZARD (LAUNCHPAD-PATH §1; the owner 10-09/10-10: "make it so its easier to navigate. I am still having a hard time
 * setting up an nfl team coin"). The first screen is four plain choices:
 *
 *   TEAM COIN     league → team (from Kalshi's own game events: abbreviation, city, nickname, next game in Denver time, record this
 *                 season) → one toggle "burn when we WIN / LOSE" → name, ticker prefilled → review in plain words → launch. The
 *                 selector and mapping are generated (wizard.ts teamCoinRule; 1% of the pool per game, the $1 floor) and sit behind
 *                 "Edit the rule".
 *   MATCHUP PAIR  league → upcoming game (or search a team) → both sides prefilled → "this game only" (default: one market, side B
 *                 derived by inversion — a partition, a registered pair) or "every game this season" (each side its own team's games
 *                 — two independent records, launched as two coins) → back-tests side by side → review → two bundles.
 *   ANY MARKET    one search box for teams, people, shows, elections: Kalshi (event-level search merged with series) and Polymarket
 *                 (Gamma search: events with their binary markets, the event and its tags as recurring selectors), each result with a
 *                 venue chip → a market or a series → rule → name → review → launch. Team coins and matchup pairs stay Kalshi-only in
 *                 v1: a Polymarket game is one binary market whose YES is whichever team its title lists first (no per-team leg, no
 *                 team-abbreviation field), so "every <team> loss" has no fixed side (oracle/polymarket.ts explains).
 *   BROWSE        (10-10, the owner: "navigate like Kalshi navigates"; made venue-agnostic the same day) Burnticker's categories
 *                 (config/burnticker/categories.json) on a left rail (chips on a phone); each lists source cards from every venue —
 *                 first-party feeds first, then Polymarket events, then Kalshi series while BURNTICKER_KALSHI_ENABLED is on — with
 *                 venue/tier, cadence, next event and the "burns when …" example; a Kalshi series drills down to its upcoming events and
 *                 markets. Picking a card continues into the same rule → name → review steps as Any market.
 *   ADVANCED      first-party feeds and the custom Kalshi selector (series + ticker filter, or a pasted market).
 *
 * CREATE SCREEN (10-10, launchpad conventions — docs/burnticker/ui-conventions.md): after the event choice, the coin's fields in
 * pump.fun's order — image → name → ticker → description → socials (website / X / Telegram) — with a live preview of the coin card on
 * the right (the same CoinCard the Coins page shows). Kalshi off (venues.ts): Team coin and Matchup show "venue unavailable".
 *
 * THE RULE DIALS (10-10, the owner: "after we select a rule can we edit it? like the percentage burned?"): every path — a search card,
 * Elections, Browse, Team coin, Matchup, Any market, Advanced — lands on this same create screen with the rule's dials on top
 * (dials.ts: the share of the pool 1–10 %, the side, a team coin's window, an NWS threshold); the locked rule sentence, the window badge,
 * the auto-generated description (describe.ts: the flavour line editable, the rule block locked and re-rendered) and the generated coin
 * image (coinArt.ts, "use my own image link" overrides it) all follow the dials live. The review shows the final text and the rules
 * sha256 before anything is signed. Locked at launch — a different rule is a different coin.
 *
 * Progress ("Step 2 of 4"), back buttons, state kept across a refresh (sessionStorage), a Devnet badge from the server's cluster.
 * The request body and the launch route are unchanged: the API returns the unsigned bundle(s); nothing is sent from this page.
 * Every parameter is in rules.json, shown in full under "details".
 */

type Step = "choose" | "team" | "pick" | "rule" | "name" | "review" | "launch";
/** team = one team's every game; pair = two teams; single = any Kalshi or Polymarket market; feed = advanced (first-party feed / custom selector). */
type Flow = "team" | "pair" | "single" | "feed" | "browse";
const ORDER: Record<Flow, Step[]> = { team: ["team", "name", "review", "launch"], pair: ["pick", "name", "rule", "review", "launch"], single: ["pick", "rule", "name", "review", "launch"], feed: ["pick", "rule", "name", "review", "launch"], browse: ["pick", "rule", "name", "review", "launch"] };
const LABELS: Record<Flow, Partial<Record<Step, string>>> = {
  team: { team: "Pick your team", name: "Win or lose, and a name", review: "Review", launch: "Launch" },
  pair: { pick: "Pick the game", name: "Name both sides", rule: "Back-test", review: "Review", launch: "Launch both" },
  single: { pick: "Find a market", rule: "The rule", name: "Name it", review: "Review", launch: "Launch" },
  feed: { pick: "Source", rule: "The rule", name: "Name it", review: "Review", launch: "Launch" },
  browse: { pick: "Pick a source", rule: "The rule", name: "Name it", review: "Review", launch: "Launch" },
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
interface Bundle { ready: boolean; pending: string[]; mint: string; ticker: string; rules: { text: string; sha256: string; statement: string; mode: string }; addresses: { feePda: string; feeWsol: string; vault: string | null; poolId: string; platformId: string }; allocation: { curve: string; locked: string; reserve: string; lpBurnedPct: number; teamAllocationPct: number }; fees: { sentence: string; curve: { legs: { label: string; bps: number }[]; totalBps: number }; postGraduation: { legs: { label: string; bps: number }[]; totalBps: number } }; burnPoolAuthority: string; transactions: { label: string; signers: string[]; instructions: { label: string }[] }[]; notes: string[] }
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

const SCHEMA = "burnticker.rules/v1";
const PUB = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const STORE = "burnticker.launch.v2";
const V1 = "/api/burnticker/v1";
const denver = (iso: string | null) => (iso ? new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso)) : "—");
const getJson = async <T,>(url: string): Promise<T> => { const r = await fetch(url); const j = await r.json(); if (!r.ok) throw new Error(j.error ?? r.statusText); return j as T; };

export default function LaunchWizard() {
  const wallet = useWallet();
  const [flow, setFlow] = useState<Flow>("team");
  const [step, setStep] = useState<Step>("choose");
  const [cluster, setCluster] = useState<string | null>(null);
  const [venues, setVenues] = useState<{ kalshi: boolean; polymarket: boolean; feeds: boolean; pairCurve?: boolean }>({ kalshi: true, polymarket: true, feeds: true });
  // review N6: a rivalry pair goes out with the venue this host uses (catalogue venues.pairCurve; a 409 corrects a stale read)
  const [pairVenue, setPairVenue] = useState<PairVenue>("launchlab");
  // browse
  const [cats, setCats] = useState<BrowseCategory[]>([]), [cat, setCat] = useState<string>("sports"), [cards, setCards] = useState<SourceCardT[] | null>(null), [cardsBusy, setCardsBusy] = useState(false), [browseErr, setBrowseErr] = useState<string[]>([]), [bq, setBq] = useState("");
  const [drill, setDrill] = useState<string | null>(null), [drillEvents, setDrillEvents] = useState<EventHit[] | null>(null);
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
  const [fraction, setFraction] = useState(DEFAULT_FRACTION);
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
      set("draft", setDraft); set("flavour", setFlavour); set("flavourB", setFlavourB); set("cardCtx", setCardCtx); set("cardYear", setCardYear); set("cardSet", setCardSet); set("nameAuto", setNameAuto); set("tickerAuto", setTickerAuto); set("ownImage", setOwnImage); set("note", setNote);
    } else if (wantPair) { setFlow("pair"); setStep("pick"); }
    const u = new URLSearchParams(window.location.search);
    const tpl = u.get("template") as TemplateId | null, like = u.get("like");
    if (tpl && TEMPLATE_START[tpl]) {
      // "Start from this" (the templates gallery): the shape's own entry point; Coin vs Coin opens its tile (CoinVsCoinTile reads the same param)
      try { sessionStorage.removeItem(STORE); } catch { /* ignore */ }
      const st = TEMPLATE_START[tpl];
      if (st.flow) { setFlow(st.flow); setStep(ORDER[st.flow][0]); }
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
  const snapshot = JSON.stringify({ flow, step, leagueSeries, team, winLose, game, swap, pairMode, pick, filter, kind, mode, onYes, onNoEnabled, onNo, unit, perUnit, baseline, direction, tokensYes, vaultShare, burnOn, fraction, name, ticker, description, imageUrl, link, xUrl, tg, cat, nameB, tickerB, descB, imageB, firstBuy, pasted, q2, draft, flavour, flavourB, cardCtx, cardYear, cardSet, nameAuto, tickerAuto, ownImage, note });
  useEffect(() => { if (ready) { try { sessionStorage.setItem(STORE, snapshot); } catch { /* private mode: no memory, no harm */ } } }, [ready, snapshot]);
  useEffect(() => { window.scrollTo({ top: 0 }); }, [step]);
  const startOver = () => { try { sessionStorage.removeItem(STORE); } catch { /* ignore */ } window.location.href = window.location.pathname; };

  useEffect(() => { fetch("/api/burnticker/catalogue").then((r) => r.json()).then((j) => { setSources(j.sources ?? []); setCluster(j.cluster ?? null); if (j.venues) { setVenues(j.venues); setPairVenue(venueFor(j.venues)); } setCustomImages(j.customImages === true); }).catch(() => {}); }, []);
  const curCat = cats.find((c) => c.id === cat);
  useEffect(() => { if (flow === "browse" && curCat?.guided === "elections" && !etypes.length && venues.polymarket) getJson<{ types: { id: string; label: string; races: number }[] }>(`${V1}/elections`).then((j) => setEtypes(j.types)).catch(() => setEtypes([])); }, [flow, curCat?.guided, etypes.length, venues.polymarket]);
  useEffect(() => { if (!etype) return; setEbusy(true); setEraces(null); setEpair(null); setEsel([]); getJson<{ states: { abbr: string; name: string; races: number }[]; races: ElRace[] }>(`${V1}/elections?type=${etype}${estate ? `&state=${estate}` : ""}`).then((j) => { setEstates(j.states); setEraces(etype === "control" || estate ? j.races : null); }).catch(() => setEraces([])).finally(() => setEbusy(false)); }, [etype, estate]);
  useEffect(() => { if (esel.length !== 2 || !eraces?.[0]) { setEpair(null); return; } const race = eraces.find((r) => esel.every((c) => r.outcomes.some((o) => o.conditionId === c))); if (!race) return; getJson<ElPair>(`${V1}/elections/pair?slug=${race.slug}&a=${esel[0]}&b=${esel[1]}`).then(setEpair).catch(() => setEpair(null)); }, [esel, eraces]);
  // the search box: 300 ms after the last keystroke, only for 3+ characters with at least one meaningful token, and only the response
  // to the LATEST query is shown (a sequence id discards a slow answer to an earlier keystroke); old results clear as soon as you type
  const useq = useRef(0);
  // time-to-launch (productStore.ts): the page's own step timestamps, sent with the launch bundle request only
  const stepTimes = useRef<Record<string, number>>({});
  const mark = (k: "search" | "card" | "create" | "review" | "launch") => { if (!stepTimes.current[k] || k === "launch" || k === "review") stepTimes.current[k] = Date.now(); };
  useEffect(() => { if (uq.trim()) mark("search"); }, [uq]);
  useEffect(() => { if (step === "name") mark("create"); if (step === "review") mark("review"); }, [step]);
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
  useEffect(() => {
    if (flow !== "browse" || step !== "pick") return;
    setCardsBusy(true);
    const t = setTimeout(() => { getJson<{ cards: SourceCardT[]; errors: string[] }>(`${V1}/browse?category=${encodeURIComponent(cat)}${bq.trim() ? `&q=${encodeURIComponent(bq.trim())}` : ""}`).then((j) => { setCards(j.cards); setBrowseErr(j.errors ?? []); }).catch((e) => { setCards([]); setBrowseErr([String((e as Error).message)]); }).finally(() => setCardsBusy(false)); }, bq ? 350 : 0);
    return () => clearTimeout(t);
  }, [flow, step, cat, bq]);
  useEffect(() => { if (!drill) { setDrillEvents(null); return; } getJson<{ events: EventHit[] }>(`${V1}/kalshi/events?series=${encodeURIComponent(drill)}`).then((j) => setDrillEvents(j.events.slice(0, 12))).catch(() => setDrillEvents([])); }, [drill]);
  useEffect(() => { if (!q.trim()) { setHits([]); return; } const t = setTimeout(() => { fetch(`/api/burnticker/oracle/search?q=${encodeURIComponent(q.trim())}`).then((r) => r.json()).then((j) => setHits(j.results ?? [])).catch(() => setHits([])); }, 350); return () => clearTimeout(t); }, [q]);
  // leagues for the team / pair pickers
  // Team coins and matchups: schedules from the leagues' own feeds or TheSportsDB; each game settled by two independent operators (gameSettle.ts).
  useEffect(() => { if ((flow === "team" || flow === "pair") && !leagues.length) getJson<{ leagues: { id: string; label: string; sport: string; crossRead: string | null; draws: boolean }[] }>(`${V1}/sports/teams`).then((j) => setLeagues((j.leagues ?? []).map((l) => ({ id: l.id, label: l.label, sport: l.sport, crossRead: l.crossRead, draws: l.draws, series: [{ ticker: l.id, title: l.label }] })))).catch((e) => setLeagueErr(String(e.message))); }, [flow, leagues.length]);
  useEffect(() => {
    if (flow !== "team" || !leagueSeries) return; setTeamsBusy(true);
    getJson<{ teams: SportsTeam[]; scheduleNote?: string | null }>(`${V1}/sports/teams?league=${leagueSeries}`).then((j) => (setScheduleNote(j.scheduleNote ?? null), j)).then((j) => setTeams(j.teams.map((t) => ({ abbr: t.abbr, city: t.city, nickname: t.nickname, name: t.name, ticker: t.ticker, league: t.league, filter: t.series.win, collisions: [], series: t.series, recordText: t.record, record: recordOf(t.record),
      next: t.next ? { eventTicker: t.next.eventId, marketTicker: t.next.eventId, title: t.next.title, expectedAt: t.next.startsAt, opponent: t.next.opponent } : null })))).catch(() => setTeams([])).finally(() => setTeamsBusy(false));
  }, [flow, leagueSeries]);
  useEffect(() => {
    if (flow !== "pair" || !leagueSeries) return;
    const url = `${V1}/sports/games?league=${leagueSeries}${gameQ.trim() ? `&q=${encodeURIComponent(gameQ.trim())}` : ""}`;
    setGamesBusy(true);
    const side = (x: SportsSide, series: string): Side => ({ abbr: x.abbr, marketTicker: series, label: x.name, nickname: x.nickname, name: x.name, ticker: x.ticker });
    const t = setTimeout(() => { getJson<{ games: SportsGame[]; scheduleNote?: string | null }>(url).then((j) => (setScheduleNote(j.scheduleNote ?? null), j)).then((j) => setGames(j.games.map((g) => ({ eventTicker: g.eventId, seriesTicker: g.league, title: g.title, subTitle: g.detail, category: "Sports", expectedAt: g.startsAt, closeTime: null, markets: [], matchedSides: [], pair: { a: side(g.a, g.series.aLoss), b: side(g.b, g.series.bLoss), tieMarket: null }, refused: [] })))).catch(() => setGames([])).finally(() => setGamesBusy(false)); }, gameQ ? 300 : 0);
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
  const genericRule: BurnRule | null = useMemo(() => {
    if (!pick) return null;
    const mapping = (f: number, tok: number) => (mode === "buyback" ? { fractionOfPool: Number(f.toFixed(4)) } : { tokens: Math.round(tok) });
    // Kalshi filters by ticker text; Polymarket by words the market question contains (escaped into titleRegex; it has no tickers),
    // or the head-to-head preset. (Question words left over from a Polymarket pick are not a ticker filter: ignored for Kalshi.)
    const flt = pick.market ? {} : pick.oracle === "polymarket" ? (filter.trim() ? { titleRegex: filter.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&") } : polyPreset ? { titleRegex: polyPreset } : {}) : !filter.trim() ? {} : /^[-A-Za-z0-9._]{1,32}$/.test(filter.trim()) ? { tickerIncludes: filter.trim().toUpperCase() } : {};
    const base = { schema: SCHEMA, oracle: pick.oracle, series: pick.series, market: pick.market, filter: flt, onVoid: "skip" as const, floorUsd: "1", reserveSol: "0.02", vault: mode === "vault" ? { share: vaultShare, vestDays: 365, cliffDays: 0 } : null };
    if (pick.oracle === "catalogue" && pick.source?.unit) return { ...base, kind: "scalar", scalar: { unit: pick.source.unit.size, perUnit: mapping(perUnit, tokensYes), baseline: pick.source.baseline!, direction: pick.source.direction! }, binary: null } as BurnRule;
    if (kind === "binary" || pick.oracle === "polymarket") {
      const main = mapping(onYes, tokensYes), other = onNoEnabled ? mapping(onNo, Math.round(tokensYes / 4)) : null;
      return { ...base, kind: "binary", binary: burnOn === "yes" ? { onYes: main, onNo: other } : { onYes: other, onNo: main }, scalar: null } as BurnRule;
    }
    return { ...base, kind: "scalar", scalar: { unit, perUnit: mapping(perUnit, tokensYes), baseline, direction }, binary: null } as BurnRule;
  }, [pick, filter, polyPreset, kind, mode, onYes, onNoEnabled, onNo, unit, perUnit, baseline, direction, tokensYes, vaultShare, burnOn]);

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
    if (!pendingDials || step !== "name" || !baseRule) return;
    const apply = (r0: BurnRule, withSide: boolean) => {
      let r = r0;
      const d0 = dialsFor(r, dialCtx);
      if (withSide && pendingDials.side && d0.side?.options.some((o) => o.value === pendingDials.side)) r = applyDial(r, "side", pendingDials.side, dialCtx);
      if (pendingDials.window && dialsFor(r, dialCtx).window) { r = applyDial(r, "window", pendingDials.window, dialCtx); if (pendingDials.games) r = applyDial(r, "games", pendingDials.games, dialCtx); }
      r = applyDial(r, "fraction", pendingDials.fraction, dialCtx);
      if (pendingDials.league && dialsFor(r, dialCtx).league) r = applyDial(r, "league", "on", dialCtx);
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
    if (!text || step !== "name") return;
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
    if (!rule || btFor === btKey || btBusy || !["rule", "review", "name"].includes(step)) return;
    if (step === "name" && flow !== "team") return;
    const t = setTimeout(() => { void runBacktest(); }, 600);
    return () => clearTimeout(t);
  }, [rule, btKey, btFor, btBusy, step, flow, runBacktest]);
  const btFresh = btFor === btKey && !!bt;

  const linksOf = useCallback(() => ([["website", link], ["X", xUrl], ["Telegram", tg]] as const).filter(([, u]) => /^https:\/\/\S+$/.test(u.trim())).map(([label, u]) => ({ label, url: u.trim() })), [link, xUrl, tg]);
  const launch = useCallback(async () => {
    if (!rule) return;
    setBusy(true); setLaunchErr(null);
    // 409 / 429 / 503 → a plain sentence (pairLaunchClient.launchErrorMessage)
    const post = async (body: Record<string, unknown>) => { const r = await fetch("/api/burnticker/launch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); const j = await r.json().catch(() => null); if (!r.ok) throw new LaunchRequestError(r.status, j?.code ?? null, launchErrorMessage(r.status, j as LaunchErrorBody | null, r.headers.get("retry-after"))); return j; };
    setPcOut(null);
    mark("launch");
    const common = { creator, firstBuySol: firstBuy || "0", acknowledgements: { ruleLocked: ackLocked, noReturns: ackNoReturns }, timings: { ...stepTimes.current } };
    try {
      if (pairOn && ruleB) {
        // A matchup: two coins, one per team — two launches (each its own selector; a registered pair needs one shared selector).
        const a = await post({ ...common, ticker: ticker.toUpperCase(), name, description: finalDescription, descCtx: textCtx, note, imageUrl: customImages && imageUrl.trim() ? imageUrl.trim() : null, links: linksOf(), rule });
        const b = await post({ ...common, firstBuySol: "0", ticker: tickerB.toUpperCase(), name: nameB, description: finalDescriptionB, descCtx: pairMode === "game" && game && sideA ? { game: { opponent: sideA.nickname ?? sideA.name, home: !aHome, startsAt: game.expectedAt ?? "" } } : {}, note: "", imageUrl: customImages && imageB.trim() ? imageB.trim() : null, links: [], rule: ruleB });
        setPairOut({ pairId: null, a: a.bundle, b: b.bundle, notes: [season ? "Two coins, each burning on its own team's losses: two independent records. They meet only when the two teams play each other; on those games exactly one side burns." : `Two coins on ${game?.title ?? "one game"}: the loser's coin burns once the final score is confirmed; a tie burns neither.`] }); setBundle(a.bundle);
      } else {
        const body = { ...common, ticker: ticker.toUpperCase(), name, description: finalDescription, descCtx: textCtx, note, imageUrl: customImages && ownImage && imageUrl.trim() ? imageUrl.trim() : null, links: linksOf(), rule };
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
  const back = () => (idx <= 0 ? setStep("choose") : setStep(order[idx - 1]));
  const begin = (f: Flow) => {
    setFlow(f); setStep(ORDER[f][0]); setBt(null); setBtB(null); setBtFor(""); setPairOut(null); setPcOut(null); setBundle(null);
    if (f === "team" || f === "pair") { setFraction(DEFAULT_FRACTION); setLeagueSeries(null); }
    setDraft(null); setFlavour(null); setFlavourB(null); setCardCtx(null); setCardYear(null); setNameAuto(true); setTickerAuto(true);
    if (f === "single" && pick?.oracle === "catalogue") setPick(null);
    if (f === "browse") { setPick(null); setDrill(null); }
  };
  /** One click from a search card (or an elections outcome) to the create screen, with the rule filled in. */
  const applyRule = (r: BurnRule, pk: NonNullable<Suggestion["pick"]>, o: { name?: string | null; ticker?: string | null; how?: string | null; settlement?: string | null; source?: Suggestion["source"] } = {}) => {
    const fromCatalogue = pk.oracle === "catalogue" ? sources.find((x) => x.id === pk.series) : undefined;
    const src = fromCatalogue ?? (o.source ? ({ id: pk.series ?? "", kind: "native", tier: 4, tierLabel: "keeper-read primary API", title: pk.title, sourceName: o.settlement ?? "", sourceUrl: "", cadence: "", unit: o.source.unit, direction: o.source.direction, baseline: o.source.baseline, flags: [], launchable: { ok: true, why: null }, param: null, lastReading: null, readings: [], preview: null } as Source) : undefined);
    setFlow("single"); setPick({ ...pk, source: src }); setFilter(""); setBt(null); setBtFor(""); setBundle(null); setPairOut(null); setPcOut(null);
    setKind(r.kind);
    if (r.kind === "binary" && r.binary) { setBurnOn(r.binary.onYes ? "yes" : "no"); const m = (r.binary.onYes ?? r.binary.onNo) as { fractionOfPool?: number } | null; if (m?.fractionOfPool) setOnYes(m.fractionOfPool); setOnNoEnabled(!!(r.binary.onYes && r.binary.onNo)); }
    if (r.kind === "scalar" && r.scalar) { const m = r.scalar.perUnit as { fractionOfPool?: number }; if (m.fractionOfPool) setPerUnit(m.fractionOfPool); setUnit(r.scalar.unit); setDirection(r.scalar.direction); setBaseline(r.scalar.baseline); }
    setMode("buyback");
    if (o.name) setName(o.name); if (o.ticker) setTicker(o.ticker);
    setHowSettles(o.how ?? null); setSettleNote(o.settlement ?? null);
    setStep("name");
  };
  /** An event card's outcome → the create screen: that outcome's own yes/no market, 10% once, its ticker ($SPIDER) editable. */
  const applyOutcome = (c: Suggestion, o: NonNullable<Suggestion["picker"]>["outcomes"][number]) => {
    if (lastShown.current) lastShown.current.clicked = true;
    mark("card");
    setDraft(null); setFlavour(null); setFlavourB(null); setCardYear(null); setCardSet(null); setCardCtx(null); setOutPick(null);
    const r = { kind: "binary", binary: { onYes: { fractionOfPool: 0.1 }, onNo: null } } as unknown as BurnRule;   // applyRule reads the dials only
    applyRule(r, { oracle: "polymarket", series: null, market: o.conditionId, title: `${o.question} (resolves once)`, yes: o.yes, no: o.no }, { name: o.label.slice(0, 32), ticker: o.ticker, how: `Settles on "${o.question}" resolving ${o.yes}.`, settlement: c.settlement });
    setTickerAuto(false); setNameAuto(false);
  };
  /** A search card → the create screen: the window the card shows (team cards offer four), its text context, its suggested name. */
  const applySuggestion = (c: Suggestion, wi = 0) => {
    if (lastShown.current) lastShown.current.clicked = true;
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
  const chooseTeam = (t: Team) => { mark("card"); setTeam(t); setName(t.name); setTicker(t.ticker); setDraft(null); setFlavour(null); setNameAuto(true); setTickerAuto(true); next(); };
  const chooseGame = (g: EventHit) => {
    if (!g.pair) return;
    setGame(g); setSwap(false); setPairMode("game"); setDraft(null); setFlavour(null); setFlavourB(null);
    setName(g.pair.a.name); setTicker(g.pair.a.ticker); setNameB(g.pair.b.name); setTickerB(g.pair.b.ticker);
    setFlow("pair"); setStep("name");
  };
  const doSwap = () => { setSwap(!swap); setName(nameB); setTicker(tickerB); setNameB(name); setTickerB(ticker); };

  const card = "rounded-lg border border-neutral-800 bg-neutral-900 p-3";
  const input = "w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm";
  const primary = "rounded bg-amber-400 text-neutral-950 font-medium px-4 py-2 text-sm disabled:opacity-40";
  const pct = (f: number) => `${(f * 100).toFixed(f * 100 % 1 === 0 ? 0 : 1)}%`;
  const record = (t: Team) => `${t.record.w}–${t.record.l}${t.record.d ? `–${t.record.d}` : ""}`;
  const okTicker = (t: string) => /^[A-Z0-9]{2,10}$/.test(t);
  const navRow = (nextLabel: string | null, disabled = false, onNext: () => void = next) => (
    <div className="flex items-center gap-3 pt-2"><button className="text-sm underline" onClick={back}>← Back</button>{nextLabel && <button className={primary} disabled={disabled} onClick={onNext}>{nextLabel}</button>}</div>
  );
  /** Every league, grouped by sport and searchable (no league first by habit). */
  const leaguePicker = (
    <div className="space-y-2">
      {leagueErr && <p className="text-red-400 text-xs">The scoreboard is not answering right now ({leagueErr}).</p>}
      <FieldHelp id="league-search" /><input data-help="league-search" className={input + " w-72"} placeholder="Search leagues: MLB, Premier League, WNBA, MLS, college…" value={leagueQ} onChange={(e) => setLeagueQ(e.target.value)} aria-label="search leagues" />
      {!leagues.length && !leagueErr && <span className="text-sm text-neutral-500">Loading leagues…</span>}
      {(["baseball", "basketball", "football", "hockey", "soccer"] as const).map((sp) => {
        const ls = leagues.filter((l) => l.sport === sp && (!leagueQ.trim() || `${l.label} ${l.id} ${sp}`.toLowerCase().includes(leagueQ.trim().toLowerCase())));
        if (!ls.length) return null;
        return (
          <div key={sp} className="space-y-1">
            <div className="font-mono text-[11px] uppercase tracking-widest text-neutral-500">{sp}{sp === "baseball" && <FieldHelp id="league-pick" />}</div>
            <div className="flex flex-wrap gap-2">{ls.map((l) => (
              <button key={l.id} onClick={() => { setLeagueSeries(l.id); setTeamQ(""); setGameQ(""); }} title={l.crossRead ? `cross-read: ${l.crossRead}` : "cross-read missing — refused at creation"} className={`rounded-full border px-3 py-1.5 text-sm ${leagueSeries === l.id ? "border-amber-400 bg-amber-400 text-neutral-950" : "border-neutral-700 hover:border-neutral-500"}`}>{l.label}{!l.crossRead && <span className="ml-1 text-[10px] text-red-400">cross-read missing</span>}</button>
            ))}</div>
          </div>
        );
      })}
    </div>
  );
  const chip = (v: Venue) => <span className={`ml-2 inline-block rounded px-1.5 py-0.5 align-middle text-[10px] font-medium uppercase tracking-wide ring-1 ${v === "kalshi" ? "bg-emerald-500/15 text-emerald-300 ring-emerald-500/40" : "bg-indigo-500/15 text-indigo-300 ring-indigo-500/40"}`}>{v === "kalshi" ? "Kalshi" : "Polymarket"}</span>;
  const pickPoly = (m: PolyMarket) => { setPick({ oracle: "polymarket", series: null, market: m.conditionId, title: `${m.question} (resolves once)`, yes: m.yes, no: m.no }); setKind("binary"); setFilter(""); setPolyPreset(null); next(); };
  const pickPolySeries = (series: string, title: string) => { setPick({ oracle: "polymarket", series, market: null, title }); setKind("binary"); setFilter(""); setPolyPreset(series.includes("/moneyline") ? "^[^:]+ vs\\. [^:]+$" : null); next(); };
  const badge = (abbr: string) => <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-neutral-800 font-mono text-xs font-bold tracking-tight text-amber-300 ring-1 ring-neutral-700">{abbr}</span>;
  const kalshiOff = !venues.kalshi;
  const marketsOff = !venues.kalshi && !venues.polymarket;
  const oneLiner = text?.oneLiner ?? (rule ? ruleOneLiner(rule, flow === "team" ? null : pick?.title ?? null) : "pick an event first");
  const b64u = (x: string) => btoa(unescape(encodeURIComponent(x))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  /** The generated coin image for a rule still being edited (coinArt.ts via /burnticker/img/preview.svg): the default image. */
  const genImg = (r: BurnRule | null, tk: string, one: string) => (r ? `/burnticker/img/preview.svg?r=${b64u(JSON.stringify(r))}&t=${encodeURIComponent(tk || "TICKER")}&l=${encodeURIComponent(one.slice(0, 120))}` : "");
  const previewCard = (nm: string, tk: string, img: string, one: string, oracle: string, badgeText: string | null = null) => <CoinCard href={null} c={{ ticker: tk, name: nm, imageUrl: img.trim() || null, oneLiner: one, oracle, status: "draft", phase: null, progressPct: 0, raised: null, threshold: null, quote: "SOL", burns: 0, lastBurnAt: null, nextAt: null, launchedAt: null, badge: badgeText, curveNote: "a new coin starts at 0% of its bonding curve" }} />;
  const okUrl = (u: string) => !u.trim() || /^https:\/\/\S{1,200}$/.test(u.trim());
  const shownImage = ownImage && imageUrl.trim() ? imageUrl : genImg(rule, ticker, oneLiner);
  const sideLabel = (v: string) => { const e = rule && rule.oracle === "catalogue" && /^espn\./.test(rule.series ?? "") ? (text?.oneLiner.match(/^burns (?:when|if) (.+?) (?:win|lose|draw)\b/)?.[1] ?? "the team") : null; return e ? `When ${e} ${v === "win" ? "WIN" : v === "draw" ? "DRAW" : "LOSE"}` : `When it settles ${v.toUpperCase()}`; };
  /**
   * THE RULE DIALS on the create screen (dials.ts): the same set for a rule however it was reached. Each change rewrites the rule; the
   * sentence, the badge, the description's rule block and the image follow.
   */
  const sideHelpId = (d: { side: { options: { value: string }[] } | null }) => (d.side?.options.some((x) => x.value === "yes") ? "yesno" : "side");
  const dialPanel = (r: BurnRule, t: CoinText | null, o: { sides?: boolean; windows?: boolean } = {}) => {
    const d = dialsFor(r, dialCtx);
    return (
      <div className="rounded-lg border border-amber-400/50 bg-neutral-950 p-3 space-y-3" aria-label="Rule dials">
        <div className="flex flex-wrap items-center gap-2"><h3 className="font-medium">The rule</h3>{t && <span className="bt-chip bt-chip-window">{t.badge}</span>}<span className="text-xs text-neutral-500">editable until launch</span></div>
        {t && <p className="text-sm text-neutral-100">{t.ruleBlock.split(/(?<=\.)\s/)[0]}</p>}
        {d.side && o.sides !== false && <div className="text-sm">Burns on<FieldHelp id={sideHelpId(d)} /></div>}
        {d.side && o.sides !== false && <div className={`grid gap-2 ${d.side.options.length === 3 ? "grid-cols-3" : "grid-cols-2"}`}>{d.side.options.map((x) => (
          <button key={x.value} onClick={() => setDial("side", x.value)} className={`rounded-lg border p-2 text-center text-sm ${d.side!.value === x.value ? "border-amber-400 bg-amber-400 text-neutral-950" : "border-neutral-700 hover:border-neutral-500"}`}>{sideLabel(x.value === "loss" ? "lose" : x.value)}</button>
        ))}</div>}
        <label className="block text-sm">Each burn spends <b>{pct(d.fraction)}</b> of the burn pool
          <FieldHelp id={d.bounds.max >= 1 ? "share-oneshot" : "share-recurring"} /><input data-help={d.bounds.max >= 1 ? "share-oneshot" : "share-recurring"} type="range" min={d.bounds.min} max={d.bounds.max} step={d.bounds.step} value={d.fraction} onChange={(e) => setDial("fraction", Number(e.target.value))} className="w-full" aria-label="share of the burn pool per burn" />
          <span className="text-xs text-neutral-500">{d.bounds.max >= 1 ? "a one-shot: 1–100 % (default 10 %)" : "recurring: 1–10 % per burn (default 2 %)"}</span></label>
        {d.league && <div className="space-y-1 text-sm"><label><FieldHelp id="league-mode" /><input data-help="league-mode" type="checkbox" checked={d.league.on} onChange={(e) => setDial("league", e.target.checked ? "on" : "off")} /> League mode <span className="text-xs text-neutral-500">(off by default) — this coin joins set <code>{d.league.id}</code> as <code>{d.league.outcome}</code></span></label>
          {d.league.on && <label className="block text-xs">Forward {Math.round(d.league.forwardBps) / 100}% of the leftover to the set&apos;s winning coin when the window ends <FieldHelp id="league-forward" /><input data-help="league-forward" type="range" min={0} max={10000} step={500} value={d.league.forwardBps} onChange={(e) => setDial("forward", Number(e.target.value))} className="w-full" /></label>}
          {d.league.on && <p className="text-xs text-neutral-400">Only if the program&apos;s forwarding instruction is live by season end; otherwise the leftover burns down on this coin (the description says so).</p>}</div>}
        {d.window && o.windows !== false && <div className="space-y-2"><div className="text-sm">Window<FieldHelp id="window" /></div><div className="grid gap-2 sm:grid-cols-2">{d.window.options.map((x) => (
          <button key={x.value} onClick={() => setDial("window", x.value)} className={`rounded-lg border p-2 text-left text-xs ${d.window!.value === x.value ? "border-amber-400 ring-1 ring-amber-400" : "border-neutral-700 hover:border-neutral-500"}`}>{x.label}{x.value === "season" && <span className="ml-1 text-neutral-500">(default)</span>}</button>
        ))}</div>
          {d.window.value === "next" && <label className="block text-sm">Games <FieldHelp id="next-games" /><input data-help="next-games" type="number" min={1} max={20} className={input + " inline w-20 ml-1"} value={d.window.games ?? 5} onChange={(e) => setDial("games", Number(e.target.value))} /></label>}</div>}
        {d.threshold && <label className="block text-sm">{d.threshold.label} <FieldHelp id="nws-threshold" /><input data-help="nws-threshold" type="number" step={d.threshold.step} min={d.threshold.min} max={d.threshold.max} className={input + " inline w-24 ml-1"} value={d.threshold.value} onChange={(e) => setDial("threshold", Number(e.target.value))} /></label>}
        {d.fixedUnit && <p className="text-xs text-neutral-400">The unit is {d.fixedUnit}.</p>}
        {t && <p className="text-xs text-neutral-300">{t.windowSentence}</p>}
        <p className="text-xs font-medium text-amber-300">Locked at launch — a different rule is a different coin.</p>
      </div>
    );
  };
  /** The create screen in pump.fun's field order (image → name → ticker → description → socials) with the live card preview on the right. */
  const createGrid = (oracle: string, extra: ReactNode = null) => (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_320px]">
      <div className={card + " space-y-3 text-sm"}>
        <h2 className="font-medium">Create your coin</h2>
        {rule && dialPanel(rule, text)}
        <div className="block">Image<FieldHelp id="image" /> <span className="text-xs text-neutral-500">{ownImage ? "(an https link to a square image, 512×512 works best)" : "(generated receipt art from the rule — see the preview; it can't be swapped for another picture)"}</span>
          {customImages && <label className="ml-2 text-xs"><FieldHelp id="own-image-toggle" /><input data-help="own-image-toggle" type="checkbox" checked={ownImage} onChange={(e) => setOwnImage(e.target.checked)} /> use my own image link</label>}
          {ownImage && <FieldHelp id="own-image-link" />}{ownImage && <input data-help="own-image-link" className={input} value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://…/coin.png" aria-label="image link" />}
          {ownImage && !okUrl(imageUrl) && <span className="text-xs text-red-400">must be an https link</span>}</div>
        <label className="block">Name <span className="float-right text-xs text-neutral-500">{name.length}/32</span><FieldHelp id="name" /><input data-help="name" className={input} maxLength={32} value={name} onChange={(e) => { setName(e.target.value); setNameAuto(false); }} placeholder="Coin name" /></label>
        <label className="block">Ticker <span className="text-xs text-neutral-500">(2–10 letters or digits{tickerAuto && text ? "; suggested from the rule" : ""})</span>
          <span className="flex items-center gap-1"><span className="font-mono text-neutral-400">$</span><FieldHelp id="ticker" /><input data-help="ticker" className={input + " font-mono uppercase"} maxLength={10} value={ticker} onChange={(e) => { setTicker(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "")); setTickerAuto(false); }} placeholder="TICKER" /></span>
          {ticker && !okTicker(ticker) && <span className="text-xs text-red-400">2–10 letters or digits</span>}</label>
        {text && <div className="block space-y-1">
          <div>Description <span className="text-xs text-neutral-500">(generated from the rule and locked — the same text goes into the token metadata, the coin page, the card and the first post)</span></div>
          <p className="rounded border border-dashed border-neutral-700 bg-neutral-950 p-2 text-xs text-neutral-200" aria-label="description, generated"><span className="mr-1 font-mono text-[10px] uppercase tracking-wider text-neutral-500">locked · from the rule</span>{text.paragraph}</p>
        </div>}
        <label className="block">Creator&apos;s note <span className="text-xs text-neutral-500">(optional · shown in its own box, labelled &quot;creator&apos;s note — not part of the rule&quot; · no links, no claims of affiliation · can&apos;t be edited after launch)</span><span className="float-right text-xs text-neutral-500">{note.length}/140</span>
          <FieldHelp id="note" /><textarea data-help="note" className={input} rows={2} maxLength={140} value={note} onChange={(e) => setNote(e.target.value)} aria-label="creator's note" />
          {noteProblem && <span className="text-xs text-red-400">{noteProblem}</span>}</label>
        <details open={!!(link || xUrl || tg)}><summary className="cursor-pointer text-neutral-300">Add social links (optional)</summary>
          <div className="mt-2 space-y-2">{([["Website", link, setLink, "https://…"], ["X", xUrl, setXUrl, "https://x.com/…"], ["Telegram", tg, setTg, "https://t.me/…"]] as const).map(([lb, v, set, ph]) => (
            <label key={lb} className="block">{lb}<FieldHelp id="socials" /><input data-help="socials" className={input} value={v} onChange={(e) => set(e.target.value)} placeholder={ph} />{!okUrl(v) && <span className="text-xs text-red-400">must be an https link</span>}</label>
          ))}</div>
        </details>
        {extra}
      </div>
      <div className="space-y-2">
        <div className="font-mono text-[11px] uppercase tracking-widest text-neutral-500">Preview · how it shows on Coins</div>
        <div className="bt-preview-frame">{previewCard(name, ticker, shownImage, oneLiner, oracle, text?.badge ?? null)}</div>
        <p className="text-xs text-neutral-500">The line under the name, the badge and the image come from the locked rule, not from the form: a card can&apos;t say more than the rule does. Image, name and ticker can&apos;t be changed after launch.</p>
      </div>
    </div>
  );
  const createOk = !!name.trim() && okTicker(ticker) && (!ownImage || okUrl(imageUrl)) && okUrl(link) && okUrl(xUrl) && okUrl(tg);
  const teamFilter = (t: Team) => { const s = teamQ.trim().toLowerCase(); if (!s) return true; if (`${t.name} ${t.abbr} ${t.city} ${t.nickname ?? ""}`.toLowerCase().includes(s)) return true; return aliasLookup(teamQ).some((a) => a.abbr === t.abbr && a.series === leagueSeries); };

  return (
    <main className="mx-auto max-w-4xl px-4 py-6 space-y-5">
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">Launch a coin {cluster === "devnet" && <span className="rounded bg-sky-500/20 px-2 py-0.5 text-xs font-medium text-sky-300 ring-1 ring-sky-500/40" title="BURNTICKER_CLUSTER=devnet: test network, no real money">Devnet</span>}</h1>
          <p className="text-neutral-400 text-sm"><Link className="underline" href="/burnticker">Burnticker</Link> · settles on primary sources (BLS, Treasury, NWS, league feeds…) or on an on-chain Polymarket payout; prediction markets are for discovery · the rule is locked at launch · <Link className="underline" href="/burnticker/trust">what the operator can and cannot do</Link></p>
        </div>
        <span className="flex items-center gap-3 text-xs"><Link className="underline text-neutral-400" href="/burnticker/templates">Templates</Link><Link className="underline text-neutral-400" href="/burnticker/me">Your coins</Link>{step !== "choose" && <button className="text-neutral-500 underline" onClick={startOver}>start over</button>}</span>
      </header>

      {step !== "choose" && (
        <div aria-label="Progress">
          <div className="flex items-center justify-between text-xs text-neutral-400"><span>Step {idx + 1} of {order.length} · <span className="text-neutral-200">{LABELS[flow][step]}</span></span><span>{flow === "team" ? "Team coin" : flow === "pair" ? "Matchup pair" : flow === "single" ? "Any market" : flow === "browse" ? "Browse" : "Advanced"}</span></div>
          <div className="mt-1 h-1.5 rounded bg-neutral-800"><div className="h-1.5 rounded bg-amber-400" style={{ width: `${((idx + 1) / order.length) * 100}%` }} /></div>
        </div>
      )}


      {pendingDials && <p className="rounded border border-amber-400/50 p-2 text-sm text-amber-200" role="status">Launching one like ${pendingDials.from}: pick the {flow === "team" ? "team" : flow === "pair" ? "game" : flow === "browse" ? "source" : "market"} — the dials ({Math.round(pendingDials.fraction * 1000) / 10}% per burn{pendingDials.window ? `, ${pendingDials.window}` : ""}{pendingDials.side ? `, on ${pendingDials.side}` : ""}) are copied onto the new rule, and you can change them before launch.</p>}

      {step === "choose" && (
        <section className="space-y-3" aria-label="Describe the event">
          <label className="block">
            <span className="text-lg font-medium">Describe the event</span>
            <FieldHelp id="search" /><input data-help="search" autoFocus className={input + " mt-1 text-base py-3"} value={uq} onChange={(e) => setUq(e.target.value)} placeholder="e.g. 'Rays win the World Series', 'Lakers win tonight', 'Arsenal win', 'Oilers lose', 'El-Sayed wins Michigan Senate', 'Detroit high above 90'" aria-label="Describe the event" />
          </label>
          {shortQuery && <p className="text-sm text-neutral-500">Type a few more letters…</p>}
          {ubusy && <p className="text-sm text-neutral-500">Searching every source…</p>}
          {ures && ures.cards.length > 0 && (
            <ul className="grid gap-2 md:grid-cols-2 lg:grid-cols-3" aria-label="Ready-made rules">
              {ures.cards.map((c, ci) => {
                const head = ci === 0 || ures.cards[ci - 1].group !== c.group ? ({ teams: "Teams", elections: "Elections", weather: "Weather", feeds: "Public data", markets: "Markets", tiles: "Coin vs Coin" } as Record<string, string>)[c.group ?? ""] ?? null : null;
                const wi = cardWin[c.id] ?? 0, w = c.windows?.[wi] ?? null, title = w?.title ?? c.title, tx = w?.text ?? c.text, endText = w?.endText ?? c.endText, badgeText = w?.text.badge ?? c.badge;
                return (<Fragment key={c.id}>
                {head && <li className="col-span-full font-mono text-[11px] uppercase tracking-widest text-neutral-500" aria-hidden="true">{head}</li>}
                <li className={`rounded-lg border p-3 text-sm ${c.refused.length ? "border-neutral-900 opacity-60" : "border-neutral-800 bg-neutral-900"}`}>
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                    <span className={`bt-chip bt-chip-${c.venue === "espn" || c.venue === "nws" ? "feed" : c.venue}`}>{c.venueLabel}</span>
                    {c.shape !== "tile" && <span className="bt-chip">{c.shape === "pair" ? "two coins" : c.shape}</span>}
                    {badgeText && <span className="bt-chip bt-chip-window">{badgeText}</span>}
                  </div>
                  <div className="mt-1 font-medium leading-snug">{title}</div>
                  <div className="text-xs text-neutral-400">{c.subtitle}</div>
                  <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 text-xs text-neutral-400">
                    <dt className="text-neutral-500">settles on</dt><dd>{c.settlement}{c.crossRead ? <> · cross-read: {c.crossRead}</> : null}</dd>
                    {c.nextAt && <><dt className="text-neutral-500">next burn</dt><dd>{denver(c.nextAt)} (Denver) at the earliest</dd></>}
                    {(endText || c.endAt) && <><dt className="text-neutral-500">ends</dt><dd>{endText ?? ""}{c.endAt && (w?.kind ?? "season") !== "perpetual" ? ` · by ${c.endAt.slice(0, 10)}` : ""}</dd></>}
                  </dl>
                  {c.windows && c.windows.length > 1 && <div className="mt-2 flex flex-wrap items-center gap-1" role="radiogroup" aria-label="window"><FieldHelp id="card-window" />{c.windows.map((x, k) => (
                    <button key={x.kind} role="radio" aria-checked={k === wi} onClick={() => setCardWin({ ...cardWin, [c.id]: k })} className={`rounded-full border px-2 py-0.5 text-[11px] ${k === wi ? "border-amber-400 bg-amber-400 text-neutral-950" : "border-neutral-700 hover:border-neutral-500"}`}>{x.label.replace(/ \(.*\)$/, "")}</button>
                  ))}</div>}
                  {tx && <p className="mt-2 text-xs text-neutral-300"><span className="font-mono">${tx.ticker}</span> — {tx.oneLiner}.</p>}
                  {c.note && <p className="mt-2 text-xs text-amber-300">{c.note}</p>}
                  {c.howSettles && <details className="mt-1 text-xs text-neutral-400"><summary className="cursor-pointer">How this settles</summary><p className="mt-1 whitespace-pre-wrap">{c.howSettles}</p></details>}
                  {c.refused.length > 0 ? <p className="mt-2 text-xs text-red-400">REFUSED: {c.refused.join("; ")}</p>
                    : c.venue === "tile" ? (c.href ? <Link className="mt-2 inline-block underline text-amber-300 text-xs" href={c.href}>Open Coin vs Coin →</Link> : <p className="mt-2 text-xs text-neutral-500">Coin vs Coin — not built yet</p>)
                    : c.picker ? <div className="mt-2 space-y-1">
                      <button className="rounded bg-amber-400 px-3 py-1 text-xs font-medium text-neutral-950" aria-expanded={outPick?.id === c.id} onClick={() => setOutPick(outPick?.id === c.id ? null : { id: c.id, q: "" })}>{outPick?.id === c.id ? "Close the list" : `Pick a ${c.picker.noun === "outcome" ? "name" : c.picker.noun} →`}</button>
                      {outPick?.id === c.id && <div className="rounded border border-neutral-700 p-2" aria-label="outcome picker">
                        <label className="block text-xs text-neutral-400">Find a {c.picker.noun === "outcome" ? "name" : c.picker.noun}<FieldHelp id="outcome-search" /><input data-help="outcome-search" autoFocus className={input + " mt-1"} value={outPick.q} onChange={(e) => setOutPick({ id: c.id, q: e.target.value })} placeholder={`type part of the ${c.picker.noun === "outcome" ? "name" : c.picker.noun}'s name`} /></label>
                        <ul className="mt-1 max-h-56 overflow-y-auto divide-y divide-neutral-800">{c.picker.outcomes.filter((o) => !outPick.q.trim() || fold(o.label).replace(/ /g, "").includes(fold(outPick.q).replace(/ /g, ""))).map((o) => (
                          <li key={o.conditionId}><button className="flex w-full items-center justify-between gap-2 py-1 text-left text-xs hover:text-amber-300" onClick={() => applyOutcome(c, o)}><span>{o.label}</span><span className="font-mono text-neutral-500">${o.ticker}</span></button></li>
                        ))}</ul>
                        <p className="mt-1 text-[11px] text-neutral-500">Each name is its own yes/no market; your coin burns 10% once if the one you pick wins. You can change the share and the ticker on the next screen.</p>
                      </div>}
                    </div>
                    : (c.rule || c.matchup) ? <button className="mt-2 rounded bg-amber-400 px-3 py-1 text-xs font-medium text-neutral-950" onClick={() => applySuggestion(c, wi)}>Use this →</button>
                    : <button className="mt-2 rounded border border-neutral-700 px-3 py-1 text-xs text-neutral-500" disabled>Use this</button>}
                </li>
              </Fragment>); })}
            </ul>
          )}
          {ures && ures.cards.length === 0 && !ubusy && (
            <div className="rounded-lg border border-dashed border-neutral-700 p-3 text-sm text-neutral-400">No close match — try Browse: {(ures.categories ?? []).map((c) => <button key={c.id} className="ml-2 underline" onClick={() => { begin("browse"); setCat(c.id); }}>{c.label}</button>)}</div>
          )}
        </section>
      )}

      {step === "choose" && (
        <section className="space-y-3" aria-label="What do you want to launch?">
          <h2 className="text-lg font-medium">…or pick a starting point</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {([
              ["team", "Team coin", "One team in any league — baseball, basketball, hockey, soccer, football, college. Burns on every win, loss or draw — you pick. Each game settles on the game's on-chain payout where a market exists, confirmed by the league&apos;s official feed.", "e.g. $RAYS26 burns every time the Rays win · $ARSENAL every Arsenal win", false],
              ["browse", "Browse everything", "Weather, elections, economics, space, culture… pick a category, then a source.", "e.g. the U.S. national debt, Denver's high, a launch count", false],
              ["pair", "Matchup pair", "Two teams, two coins. This game only, this season, or perpetual.", "e.g. $LAKERS vs $CELTICS — the loser burns", false],
            ] as const).map(([f, title, body, eg, needsMarkets]) => {
              const off = needsMarkets && marketsOff;
              return (
                <button key={f} onClick={() => !off && begin(f)} disabled={off} aria-disabled={off} className={`text-left rounded-xl border border-neutral-800 bg-neutral-900 p-5 focus:outline-none ${off ? "opacity-60 cursor-not-allowed" : "hover:border-amber-400 focus:border-amber-400"}`}>
                  <div className="text-lg font-semibold">{title}</div>
                  <p className="mt-1 text-sm text-neutral-300">{body}</p>
                  <p className="mt-3 text-xs text-neutral-500">{off ? "no market venue is enabled on this host" : eg}</p>
                </button>
              );
            })}
          </div>
          <CoinVsCoinTile pairCurve={venues.pairCurve === true} />
          <p className="text-xs text-neutral-500">Advanced: <button className="underline" disabled={marketsOff} onClick={() => !marketsOff && begin("single")}>any market by its exact listing</button> · <button className="underline" onClick={() => begin("feed")}>first-party feed / custom selector</button></p>
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
              <div className="flex items-center justify-between gap-2 flex-wrap"><h2 className="font-medium">2. Pick your team<FieldHelp id="team-pick" /></h2><FieldHelp id="team-search" /><input data-help="team-search" className={input + " w-64"} placeholder="Rays, Lakers, Oilers, Arsenal, Inter Miami…" value={teamQ} onChange={(e) => setTeamQ(e.target.value)} /></div>
              {teamsBusy && <p className="text-sm text-neutral-500">Loading teams…</p>}
              {scheduleNote && <p className="text-sm text-amber-300">This league&apos;s {scheduleNote}: teams are listed, next games are not.</p>}
              {!teamsBusy && !teams.length && <p className="text-sm text-neutral-500">No teams found for this league right now.</p>}
              <div className="grid gap-2 sm:grid-cols-2">{teams.filter(teamFilter).map((t) => (
                <button key={t.abbr} onClick={() => chooseTeam(t)} className={`flex items-center gap-3 rounded-lg border p-2 text-left hover:border-amber-400 ${team?.abbr === t.abbr ? "border-amber-400" : "border-neutral-800"}`}>
                  {badge(t.abbr)}
                  <div className="min-w-0"><div className="font-medium truncate">{t.name}</div><div className="text-xs text-neutral-400">{t.recordText === null ? "record —" : `${record(t)} this season`}{t.next ? ` · next: ${t.next.opponent ? `vs ${t.next.opponent}` : t.next.title}, result ~${denver(t.next.expectedAt)}` : ""}</div></div>
                </button>
              ))}</div>
              <p className="text-xs text-neutral-500"><span className="bt-chip bt-chip-feed mr-1">on-chain payout · league&apos;s official feed</span>Each game settles on the game&apos;s on-chain payout where a market exists, else on a licensed final score, confirmed by the league&apos;s official feed (MLB&apos;s official feed, NHL&apos;s official scores, NBA&apos;s official feed) or a second licensed provider. Times are Denver time.</p>
            </div>
          )}
          {navRow(null)}
        </section>
      )}

      {flow === "team" && step === "name" && team && (
        <section className="space-y-4">
          {team.recordText !== null && (() => { const sideNow = rule ? dialsFor(rule, dialCtx).side?.value : "loss"; const n = sideNow === "win" ? team.record.w : team.record.l; return <p className="text-sm text-neutral-300">{team.name} this season so far: {record(team)} → {n} burn{n === 1 ? "" : "s"} would have happened.</p>; })()}
          {createGrid("catalogue", <p className="text-xs text-neutral-400">Generated selector: <code>{rule?.series}</code> — the team pinned by its ESPN id; each game settles on the game&apos;s on-chain payout or a licensed final score, counted once the league's official feed agrees. Spend floor $1 (smaller spends wait), 0.02 SOL reserve; a tie counts as neither.</p>)}
          {navRow("Next: review →", !createOk)}
        </section>
      )}

      {/* ---------------------------------------------------------------- MATCHUP PAIR ---------------------------------------------------------------- */}
      {flow === "pair" && step === "pick" && (
        <section className="space-y-4">
          <div className={card + " space-y-3"}><h2 className="font-medium">1. Pick a league</h2>{leaguePicker}</div>
          {leagueSeries && (
            <div className={card + " space-y-3"}>
              <div className="flex items-center justify-between gap-2 flex-wrap"><h2 className="font-medium">2. Pick the game</h2><FieldHelp id="game-search" /><input data-help="game-search" className={input + " w-64"} placeholder="search a team: Lakers, Oilers, Arsenal…" value={gameQ} onChange={(e) => setGameQ(e.target.value)} /></div>
              {gamesBusy && <p className="text-sm text-neutral-500">Loading games…</p>}
              {scheduleNote && <p className="text-sm text-amber-300">This league&apos;s {scheduleNote}.</p>}
              {!gamesBusy && !games.length && <p className="text-sm text-neutral-500">No upcoming games{gameQ ? ` matching “${gameQ}”` : ""}.</p>}
              <ul className="divide-y divide-neutral-800">{games.map((g) => (
                <li key={g.eventTicker}><button onClick={() => chooseGame(g)} className="flex w-full items-center gap-3 py-2 text-left hover:bg-neutral-800/40">
                  {badge(g.pair!.a.abbr)}<span className="text-neutral-500 text-xs">vs</span>{badge(g.pair!.b.abbr)}
                  <span className="min-w-0"><span className="block font-medium truncate">{g.pair!.a.name} vs {g.pair!.b.name}</span><span className="block text-xs text-neutral-400">result ~{denver(g.expectedAt)} (Denver){g.pair!.tieMarket ? " · this league has draws" : ""}{g.refused.length ? ` · REFUSED: ${g.refused.join("; ")}` : ""}</span></span>
                </button></li>
              ))}</ul>
            </div>
          )}
          {navRow(null)}
        </section>
      )}

      {flow === "pair" && step === "name" && game && sideA && sideB && (
        <section className="space-y-4">
          <div className={card + " space-y-3"}>
            <h2 className="font-medium">{game.title}<FieldHelp id="pair-window" /></h2>
            <div className="grid gap-2 sm:grid-cols-3">{([["game", "This game only", `Settles once, ~${denver(game.expectedAt)}. Exactly one coin burns.`], ["season", "This season", `${sideA.name}: every loss this season burns. ${sideB.name}: the same. Two separate records; both retire after the season.`], ["perpetual", "Perpetual", "Every loss, every season, no end date — neither coin retires."]] as const).map(([m, title, body]) => (
              <button key={m} onClick={() => setPairMode(m)} className={`rounded-lg border p-3 text-left ${pairMode === m ? "border-amber-400 ring-1 ring-amber-400" : "border-neutral-700 hover:border-neutral-500"}`}><div className="font-medium">{title}{m === "game" && <span className="ml-2 text-xs text-neutral-400">(default)</span>}</div><div className="text-xs text-neutral-400 mt-1">{body}</div></button>
            ))}</div>
            {pairMode !== "game" && <p className="text-xs text-amber-300">A season pair = two coins, each on its OWN team&apos;s games. They only meet when these two teams play each other (then exactly one burns); the rest of the time each coin keeps its own record, so they are launched as two coins, not as one registered pair.</p>}
            {pairMode === "game" && <p className="text-xs text-neutral-400">Two coins on this game: each burns once if its team loses — settled on the game&apos;s on-chain payout where a market exists, else a licensed final score, once the league&apos;s official feed agrees. A tie burns neither.</p>}
          </div>
          <div className="grid gap-3 md:grid-cols-2">{([["A", sideA, name, setName, ticker, setTicker, imageUrl, setImageUrl], ["B", sideB, nameB, setNameB, tickerB, setTickerB, imageB, setImageB]] as const).map(([k, sd, nm, setNm, tk, setTk, img, setImg]) => (
            <div key={k} className={card + " space-y-2 text-sm"}>
              <div className="flex items-center gap-2">{badge(sd.abbr)}<div className="text-xs text-neutral-400">burns when the {sd.nickname ?? sd.label} lose</div></div>
              <label className="block">Name <FieldHelp id="pair-name" /><input data-help="pair-name" className={input} maxLength={32} value={nm} onChange={(e) => setNm(e.target.value)} /></label>
              <label className="block">Ticker <FieldHelp id="pair-ticker" /><input data-help="pair-ticker" className={input} maxLength={10} value={tk} onChange={(e) => setTk(e.target.value.toUpperCase())} /></label>
              {customImages && <label className="block">Image link (optional) <FieldHelp id="pair-image" /><input data-help="pair-image" className={input} value={img} onChange={(e) => setImg(e.target.value)} placeholder="https://…" /></label>}
              {(k === "A" ? text : textB) && <p className="rounded border border-dashed border-neutral-700 bg-neutral-950 p-2 text-xs text-neutral-300"><span className="mr-1 font-mono text-[10px] uppercase tracking-wider text-neutral-500">description · locked</span>{(k === "A" ? text : textB)!.paragraph}</p>}
            </div>
          ))}</div>
          {rule && dialPanel(rule, text, { sides: false, windows: false })}
          <div className="grid gap-3 md:grid-cols-2" aria-label="Preview">{([[name, ticker, rule, text], [nameB, tickerB, ruleB, textB]] as const).map(([nm, tk, r, t], k) => <div key={k} className="bt-preview-frame">{previewCard(nm, tk, genImg(r, tk, t?.oneLiner ?? ""), t?.oneLiner ?? (r ? ruleOneLiner(r) : ""), "catalogue", t?.badge ?? null)}</div>)}</div>
          <p className="text-xs text-neutral-500"><button className="underline" onClick={doSwap}>Swap sides</button>{tickerB && tickerB === ticker ? <span className="text-red-400"> · the two coins need different tickers</span> : null}</p>
          {navRow("Next: back-test →", !name.trim() || !nameB.trim() || !okTicker(ticker) || !okTicker(tickerB) || ticker === tickerB, () => { setBt(null); setBtB(null); setBtFor(""); next(); })}
        </section>
      )}

      {flow === "pair" && step === "rule" && sideA && sideB && (
        <section className="space-y-4">
          {btBusy && <p className="text-sm text-neutral-500">Back-testing both sides on this season&apos;s results…</p>}
          {btErr && <p className="text-sm text-red-400">{btErr}</p>}
          {btFresh && bt && btB && (
            <div className="grid md:grid-cols-2 gap-2 text-sm">
              <div className={card}><div className="text-xs text-neutral-400">${ticker} · {name}</div><p>{bt.sentence}</p><p className="text-xs text-neutral-500">{bt.backtest.totals.burnEvents} burn(s) in {bt.backtest.totals.events} game day(s)</p></div>
              <div className={card}><div className="text-xs text-neutral-400">${tickerB} · {nameB}</div><p>{btB.sentence}</p><p className="text-xs text-neutral-500">{btB.backtest.totals.burnEvents} burn(s) in {btB.backtest.totals.events} game day(s)</p></div>
              <p className="md:col-span-2 text-xs text-neutral-300">{season ? "Two independent records: each coin counts its own team's losses this season. When the two teams meet, exactly one side burns (a tie burns neither)." : `This game settles once, after ${denver(game?.expectedAt ?? null)} (Denver): the loser's coin burns; nothing to back-test until then.`}</p>
              {(bt.refusals.length > 0 || btB.refusals.length > 0) && <p className="md:col-span-2 text-red-400">REFUSED: {[...bt.refusals, ...btB.refusals].map((r) => r.reason).join("; ")}</p>}
            </div>
          )}
          <p className={card + " text-xs text-neutral-400"}>${ticker}: <code>{rule?.series}</code> · ${tickerB}: <code>{ruleB?.series}</code> · each burn spends {rule ? pct(dialsFor(rule, dialCtx).fraction) : "—"} of that coin&apos;s burn pool (change it on the previous step). Each game settles on the game&apos;s on-chain payout or a licensed final score, confirmed by the league&apos;s official feed before it counts. $1 spend floor, 0.02 SOL reserve.</p>
          {navRow("Next: review →", !btFresh || !bt || !btB || bt.refusals.length > 0 || btB.refusals.length > 0)}
        </section>
      )}

      {/* ---------------------------------------------------------------- ANY MARKET ---------------------------------------------------------------- */}
      {flow === "single" && step === "pick" && (
        <section className="space-y-4">
          <div className={card + " space-y-3"}>
            <h2 className="font-medium">Search adjudicated markets by name</h2>
            <FieldHelp id="market-search" /><input data-help="market-search" autoFocus className={input + " text-base py-2"} placeholder="a team, a player, a person, a show, a city, an election…" value={q2} onChange={(e) => setQ2(e.target.value)} />
            {findBusy && <p className="text-sm text-neutral-500">Searching…</p>}
            {found && (() => {
              const evs = (
                <div key="events" className="space-y-2">{found.events.length > 0 && <h3 className="text-xs uppercase tracking-wide text-neutral-500">Games and events{chip("kalshi")}</h3>}{found.events.map((e) => (
                  <div key={e.eventTicker} className="rounded border border-neutral-800 p-2">
                    <div className="text-sm font-medium">{e.title} <span className="text-xs text-neutral-500">{e.subTitle ?? ""} · result ~{denver(e.expectedAt)}</span></div>
                    {e.refused.length > 0 ? <p className="text-xs text-red-400">REFUSED: {e.refused.join("; ")}</p> : <>
                      {e.pair && <button className="mt-1 text-xs underline text-amber-300" onClick={() => chooseGame(e)}>Make a matchup pair from this game →</button>}
                      <ul className="mt-1 text-xs text-neutral-400 space-y-0.5">{e.markets.slice(0, 12).map((m) => <li key={m.ticker} className="flex items-center justify-between gap-2"><span><code>{m.suffix}</code> {m.label}</span><button className="underline" onClick={() => { setPick({ oracle: "kalshi", series: null, market: m.ticker, title: `${e.title} — ${m.label} (resolves once)` }); setKind("binary"); next(); }}>burn on this market →</button></li>)}</ul>
                    </>}
                  </div>
                ))}</div>
              );
              const ser = (
                <div key="series" className="space-y-1">{found.results.length > 0 && <h3 className="text-xs uppercase tracking-wide text-neutral-500">Recurring series (every future market){chip("kalshi")}</h3>}{found.results.map((h) => (
                  <div key={h.ticker} className="flex items-start justify-between gap-2 py-1"><div><div className="text-sm"><code>{h.ticker}</code> {h.title}</div><div className="text-xs text-neutral-500">{h.category} · {h.frequency ?? "—"}{h.refused.length ? ` · REFUSED: ${h.refused.join("; ")}` : ""}</div></div>
                    {h.refused.length === 0 && <button className="text-xs underline" onClick={() => { setPick({ oracle: "kalshi", series: h.ticker, market: null, title: h.title }); next(); }}>every market →</button>}</div>
                ))}</div>
              );
              const pm = polyFound;
              const poly = pm && (
                <div key="polymarket" className="space-y-2">
                  {(pm.events.length > 0 || pm.markets.length > 0) && <h3 className="text-xs uppercase tracking-wide text-neutral-500">Events and markets{chip("polymarket")}</h3>}
                  {pm.markets.map((m) => <div key={m.conditionId} className="flex items-center justify-between gap-2 rounded border border-neutral-800 p-2 text-sm"><span>{m.question} <span className="text-xs text-neutral-500">YES = {m.yes}, NO = {m.no}</span></span><button className="text-xs underline" onClick={() => pickPoly(m)}>burn on this market →</button></div>)}
                  {pm.events.map((e) => (
                    <div key={e.slug} className="rounded border border-neutral-800 p-2">
                      <div className="text-sm font-medium">{e.title}{chip("polymarket")} <span className="text-xs text-neutral-500">ends ~{denver(e.endDate)}</span></div>
                      {e.refused.length > 0 ? <p className="text-xs text-red-400">REFUSED: {e.refused.join("; ")}</p> : <>
                        {/* one outcome = one yes/no market (the owner's Best Picture case): pick a name; "every market" is Advanced only */}
                        <ul className="mt-1 text-xs text-neutral-400 space-y-0.5">{e.markets.map((m) => <li key={m.conditionId} className="flex items-center justify-between gap-2"><span>{m.outcome ?? m.question}{m.outcome ? null : <span className="text-neutral-500"> (YES = {m.yes}, NO = {m.no})</span>}</span><button className="underline" onClick={() => pickPoly(m)}>{m.outcome ? "burn if this one wins →" : "burn on this market →"}</button></li>)}</ul>
                        {e.marketCount > e.markets.length && <p className="mt-1 text-[11px] text-neutral-500">Showing {e.markets.length} of {e.marketCount}. Type the name you want in the search box above to find it.</p>}
                        {e.marketCount > 1 && <details className="mt-1 text-xs text-neutral-500"><summary className="cursor-pointer">Advanced: every market of this event as one rule</summary><button className="mt-1 underline" onClick={() => pickPolySeries(`event:${e.slug}`, e.title)}>count every market of this event ({e.marketCount}) →</button></details>}
                      </>}
                    </div>
                  ))}
                  {pm.tags.length > 0 && <div className="text-xs text-neutral-400"><span className="text-neutral-500">Recurring on Polymarket:</span> {pm.tags.flatMap((t) => t.series.map((sr) => <button key={sr} className="mr-2 underline" onClick={() => pickPolySeries(sr, `${t.label}${sr.endsWith("/moneyline") ? " games (moneyline)" : ""}`)}>{sr.endsWith("/moneyline") ? `every ${t.label} game` : `every ${t.label} market`}</button>))}</div>}
                  {polyErr && <p className="text-xs text-neutral-500">Polymarket is not answering right now ({polyErr}).</p>}
                </div>
              );
              const none = !found.events.length && !found.results.length && !(pm && (pm.events.length || pm.markets.length));
              return <div className="space-y-4">{found.ranking === "events" ? [evs, ser] : [ser, evs]}{poly}{none && <p className="text-sm text-neutral-500">Nothing matches “{q2}”. Try a person&apos;s last name, a race, a show — or Browse.</p>}<p className="text-xs text-neutral-600">Settled on Polymarket&apos;s on-chain payout; prediction markets are for discovery. Team coins and matchups run on the ESPN scoreboard (Team coin, Matchup pair).</p></div>;
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
              {cats.map((c) => <button key={c.id} className={`bt-tab md:text-left md:rounded-md${cat === c.id ? " is-active" : ""}`} onClick={() => { setCat(c.id); setDrill(null); }} title={c.blurb}>{c.label}</button>)}
              {!cats.length && <span className="text-sm text-neutral-500">Loading categories…</span>}
            </nav>
            <div className="min-w-0 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm text-neutral-400 flex-1 min-w-0">{cats.find((c) => c.id === cat)?.blurb ?? ""}</p>
                <FieldHelp id="browse-filter" /><input data-help="browse-filter" className={input + " w-full sm:w-64"} placeholder="filter this category…" value={bq} onChange={(e) => setBq(e.target.value)} aria-label="Filter sources" />
              </div>
              {curCat?.adjudicatedOnly && <p className="rounded border border-dashed border-neutral-700 p-2 text-xs text-neutral-400">Adjudicated-only (Polymarket): no first-party source qualifies for this category, so only adjudicated markets are listed — each settled on Polymarket&apos;s on-chain payout.</p>}
              {curCat?.guided === "elections" && venues.polymarket && (
                <div className={card + " space-y-3"} aria-label="Elections">
                  <h3 className="font-medium">Pick a race</h3>
                  <div className="flex flex-wrap items-center gap-2"><FieldHelp id="race-type" />{etypes.map((t) => <button key={t.id} className={`bt-tab${etype === t.id ? " is-active" : ""}`} onClick={() => { setEtype(t.id); setEstate(null); }}>{t.label} <span className="bt-tab-count">{t.races}</span></button>)}{!etypes.length && <span className="text-xs text-neutral-500">Loading races…</span>}</div>
                  {etype && etype !== "control" && <label className="block text-sm">State <FieldHelp id="race-state" /><select data-help="race-state" className={input + " inline w-56 ml-1"} value={estate ?? ""} onChange={(e) => setEstate(e.target.value || null)}><option value="">choose a state…</option>{estates.map((x) => <option key={x.abbr} value={x.abbr}>{x.name} ({x.races})</option>)}</select></label>}
                  {ebusy && <p className="text-xs text-neutral-500">Loading…</p>}
                  {eraces?.length === 0 && <p className="text-xs text-neutral-500">No open race listed here.</p>}
                  {eraces?.map((r) => (
                    <div key={r.slug} className="rounded border border-neutral-800 p-2 text-sm">
                      <div className="font-medium">{r.title}{r.settlesOn ? <span className="text-xs text-neutral-500"> · settles {r.settlesOn}</span> : null}</div>
                      <div className="text-xs text-neutral-500">Settled by: {r.settlement} — <a className="underline" href={r.sos.url} rel="noopener" target="_blank">{r.sos.name}</a>{r.hiddenPlaceholders ? ` · ${r.hiddenPlaceholders} unnamed placeholder outcome(s) hidden` : ""}</div>
                      {r.refused.length ? <p className="text-xs text-red-400">REFUSED: {r.refused.join("; ")}</p> : <ul className="mt-1 space-y-1">{r.outcomes.map((o) => (
                        <li key={o.conditionId} className="flex flex-wrap items-center justify-between gap-2">
                          <label className="flex items-center gap-2"><FieldHelp id="race-outcome" /><input data-help="race-outcome" type="checkbox" checked={esel.includes(o.conditionId)} onChange={(e) => setEsel(e.target.checked ? [...esel.filter((x) => x !== o.conditionId), o.conditionId].slice(-2) : esel.filter((x) => x !== o.conditionId))} aria-label={`pair ${o.label}`} /><span className="font-medium">{o.label}</span></label>
                          <button className="text-xs underline text-amber-300" onClick={() => applyRule(o.rule, { oracle: "polymarket", series: null, market: o.conditionId, title: `${o.label} wins the ${r.title.replace(/ Election Winner$/, "")} race (resolves once)`, yes: o.yes, no: o.no }, { name: `${o.label.replace(/\s*\([A-Z]\)$/, "").split(" ").pop()} Wins`, ticker: (o.label.replace(/\s*\([A-Z]\)$/, "").split(" ").pop() ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10), how: `${o.settles}${r.description ? `\n\nResolution rules (Polymarket): ${r.description}` : ""}`, settlement: `${r.settlement} — ${r.sos.name}: ${r.sos.url}` })}>Use: {o.label} wins →</button>
                        </li>
                      ))}</ul>}
                      {r.description && <details className="mt-1 text-xs text-neutral-400"><summary className="cursor-pointer">How this settles</summary><p className="mt-1 whitespace-pre-wrap">{r.description}</p></details>}
                    </div>
                  ))}
                  {eraces && eraces.length > 0 && <p className="text-xs text-neutral-500">Tick two candidates for an election pair: two coins, one per candidate.</p>}
                  {epair && (
                    <div className="rounded border border-amber-400/50 p-2 text-sm space-y-2" aria-label="Election pair">
                      <div className="font-medium">Election pair: ${epair.a.ticker} vs ${epair.b.ticker}</div>
                      <div className="grid gap-2 md:grid-cols-2">{[epair.a, epair.b].map((sd) => (
                        <div key={sd.ticker} className="rounded border border-neutral-800 p-2 text-xs space-y-1">
                          <div className="font-medium text-sm">${sd.ticker} · {sd.candidate}</div>
                          <p>{sd.sentences.winner}</p>
                          {sd.sentences.fecBeats && <p className="text-neutral-500">{sd.sentences.fecBeats} <i>(joins when composite rules land)</i></p>}
                          <button className="underline text-amber-300" onClick={() => applyRule(sd.components.winner, { oracle: "polymarket", series: null, market: sd.outcome.conditionId, title: `${sd.candidate} wins (resolves once)`, yes: sd.outcome.yes, no: sd.outcome.no }, { name: sd.name, ticker: sd.ticker, how: sd.sentences.winner, settlement: `Polymarket on-chain payout + ${epair.crossRead.name}: ${epair.crossRead.url}` })}>Launch ${sd.ticker} (winner) →</button>
                        </div>
                      ))}</div>
                      <ul className="list-disc pl-5 text-xs text-neutral-500">{epair.pending.map((x) => <li key={x}>{x}</li>)}</ul>
                    </div>
                  )}
                </div>
              )}
              {cardsBusy && <p className="text-sm text-neutral-500">Loading sources…</p>}
              {!cardsBusy && cards && cards.length === 0 && <p className="rounded border border-dashed border-neutral-700 p-4 text-sm text-neutral-400">No source in this category on this host yet{bq ? ` matching “${bq}”` : ""}.</p>}
              <div className="grid gap-2 lg:grid-cols-2">{(cards ?? []).map((c) => (
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
                  {c.refused.length > 0 && <div className="text-xs text-red-400">REFUSED: {c.refused.join("; ")}</div>}
                  <div className="mt-2 flex flex-wrap gap-3 text-xs">
                    {c.configure?.kind === "team" ? <button className="underline text-amber-300" onClick={() => { const lg = c.configure!.kind === "team" ? c.configure!.league : null; begin("team"); setTimeout(() => setLeagueSeries(lg), 0); }}>pick a team →</button>
                    : c.configure?.kind === "weather" ? <button className="underline text-amber-300" onClick={() => setWx({ metric: c.configure!.kind === "weather" ? c.configure!.metric : "high", station: "DEN", threshold: c.configure!.kind === "weather" && c.configure!.metric === "rain" ? "0.50" : "90" })}>choose a station →</button>
                    : c.launchable.ok ? <button className="underline text-amber-300" onClick={() => {
                      const src = c.pick.oracle === "catalogue" ? sources.find((x) => x.id === c.pick.series) : undefined;
                      setPick({ ...c.pick, source: src }); setFilter(""); setKind(c.kind);
                      if (c.kind === "scalar" && c.pick.oracle === "kalshi") { setUnit(1); setDirection("up"); setBaseline("previousSettlement"); }
                      next();
                    }}>use this source →</button> : <span className="text-neutral-500">not launchable{c.launchable.why ? `: ${c.launchable.why}` : ""}</span>}
                    {c.venue === "kalshi" && !kalshiOff && <button className="underline" onClick={() => setDrill(drill === c.pick.series ? null : c.pick.series)}>{drill === c.pick.series ? "hide events" : "next events"}</button>}
                    {c.sourceUrl && <a className="underline text-neutral-400" href={c.sourceUrl} rel="noopener" target="_blank">source ↗</a>}
                  </div>
                  {wx && c.configure?.kind === "weather" && c.configure.metric === wx.metric && (
                    <div className="mt-2 border-t border-neutral-800 pt-2 text-xs space-y-2">
                      <label className="block">Station <FieldHelp id="nws-station" /><select data-help="nws-station" className={input + " inline w-56 ml-1"} value={wx.station} onChange={(e) => setWx({ ...wx, station: e.target.value })}>{STATIONS.map((x) => <option key={x.code} value={x.code}>{x.label} ({x.code})</option>)}</select></label>
                      {wx.metric !== "snow" && <label className="block">{wx.metric === "high" ? "High at or above (°F)" : "Rain at or above (inches)"} <FieldHelp id="nws-threshold" /><input data-help="nws-threshold" className={input + " inline w-24 ml-1"} value={wx.threshold} onChange={(e) => setWx({ ...wx, threshold: e.target.value })} /></label>}
                      <button className="underline text-amber-300" onClick={() => { const thr = wx.metric === "snow" ? null : Number(wx.threshold); if (thr !== null && !Number.isFinite(thr)) return; const series = nwsSeries(wx.metric, wx.station, thr); const st = STATIONS.find((x) => x.code === wx.station)!; applyRule(firstPartyRule(series, 0.01), { oracle: "catalogue", series, market: null, title: `${st.city} ${wx.metric === "high" ? `daily high ≥ ${thr} °F` : wx.metric === "rain" ? `rain day ≥ ${Number(thr).toFixed(2)} in` : "first snow of the season"} (NWS)` }, { name: `${st.city} ${wx.metric === "high" ? "Heat" : wx.metric === "rain" ? "Rain" : "Snow"}`, ticker: `${st.code}${wx.metric === "high" ? "HOT" : wx.metric === "rain" ? "RAIN" : "SNOW"}`, settlement: "NWS daily climate report · first-party, cross-read with the Iowa Environmental Mesonet", source: { unit: { size: 1, label: wx.metric === "snow" ? "the first snow" : "1 qualifying day", definition: "one burn per qualifying day, read from the final climate report once the cross-read agrees" }, baseline: 0, direction: "up" } }); }}>Use this rule →</button>
                    </div>
                  )}
                  {drill === c.pick.series && (
                    <div className="mt-2 border-t border-neutral-800 pt-2 text-xs">
                      {drillEvents === null ? <span className="text-neutral-500">Loading events…</span> : drillEvents.length === 0 ? <span className="text-neutral-500">No open events right now.</span> : drillEvents.map((e) => (
                        <div key={e.eventTicker} className="py-1">
                          <div className="text-neutral-300">{e.title} <span className="text-neutral-500">· ~{denver(e.expectedAt ?? e.closeTime)}</span></div>
                          {e.refused.length ? <div className="text-red-400">REFUSED</div> : <ul className="mt-0.5 space-y-0.5 text-neutral-400">{e.markets.slice(0, 8).map((mk) => <li key={mk.ticker} className="flex justify-between gap-2"><span>{mk.label || mk.suffix}</span><button className="underline" onClick={() => { setPick({ oracle: "kalshi", series: null, market: mk.ticker, title: `${e.title} — ${mk.label || mk.suffix} (resolves once)` }); setKind("binary"); next(); }}>this market only →</button></li>)}</ul>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}</div>
              {browseErr.length > 0 && <p className="text-xs text-neutral-500">Not answering right now: {browseErr.join(" · ")}</p>}
            </div>
          </div>
          {navRow(null)}
        </section>
      )}

      {/* ---------------------------------------------------------------- ADVANCED ---------------------------------------------------------------- */}
      {flow === "feed" && step === "pick" && (
        <section className="space-y-4">
          <div className={card}>
            <h2 className="font-medium">Custom Kalshi selector (tier 1, settled results only)</h2>
            <FieldHelp id="kalshi-series-search" /><input data-help="kalshi-series-search" className={input + " mt-2"} placeholder="search Kalshi series: MLB, CPI, Denver temperature, S&P, election…" value={q} onChange={(e) => setQ(e.target.value)} />
            <ul className="mt-2 divide-y divide-neutral-800 max-h-72 overflow-y-auto">{hits.map((h) => (
              <li key={h.ticker} className="py-2 flex items-start justify-between gap-2"><div><div className="text-sm"><code>{h.ticker}</code> {h.title}</div><div className="text-xs text-neutral-500">{h.category} · {h.frequency ?? "—"} · settles by {h.settlementSource?.name ?? "Kalshi"}{h.refused.length ? ` · REFUSED: ${h.refused.join("; ")}` : ""}</div></div>
                {h.refused.length === 0 && <button className="text-xs underline" onClick={() => { setPick({ oracle: "kalshi", series: h.ticker, market: null, title: h.title }); next(); }}>every market in this series →</button>}</li>
            ))}</ul>
            <p className="text-xs text-neutral-500 mt-2">One specific market instead? Paste its ticker: <FieldHelp id="kalshi-market-paste" /><input data-help="kalshi-market-paste" className={input + " inline w-80 ml-1"} placeholder="KXMLBGAME-26OCT13CLETB-TB" onKeyDown={(e) => { const v = (e.target as HTMLInputElement).value.trim().toUpperCase(); if (e.key === "Enter" && v) { setPick({ oracle: "kalshi", series: null, market: v, title: `market ${v} (resolves once)` }); next(); } }} /></p>
          </div>
          <div className={card}>
            <h2 className="font-medium">First-party feeds (tiers 3–5, for things no market covers)</h2>
            <div className="grid md:grid-cols-2 gap-2 mt-2">{sources.filter((s) => s.kind === "attested-http" || s.kind === "onchain").map((s) => (
              <div key={s.id} className={`rounded border p-2 text-xs ${s.launchable.ok ? "border-neutral-700" : "border-neutral-900 opacity-70"}`}>
                <div className="text-sm">{s.title} <span className="text-neutral-500">tier {s.tier}</span></div>
                <div className="text-neutral-500">{s.sourceName} · {s.cadence} · unit: {s.unit?.label}{s.lastReading ? ` · last ${s.lastReading.id}: ${s.lastReading.value}` : ""}</div>
                {s.preview && <div className="text-neutral-400">fixture window {s.preview.window.from} → {s.preview.window.to}: {s.preview.units} unit(s), {s.preview.burnEvents} burn(s), {s.preview.poolFractionSpent === null ? "" : `${(s.preview.poolFractionSpent * 100).toFixed(1)}% of the pool at 2%/unit`}</div>}
                {s.flags.length > 0 && <div className="text-neutral-500">{s.flags.join(" · ")}</div>}
                {s.launchable.ok ? <button className="underline mt-1" onClick={() => { setPick({ oracle: "catalogue", series: s.id, market: null, title: s.title, source: s }); next(); }}>use this source →</button> : <div className="text-neutral-500 mt-1">not launchable: {s.launchable.why}</div>}
              </div>
            ))}</div>
          </div>
          {navRow(null)}
        </section>
      )}

      {/* ------------------------------------------------- the generic rule step (any market / advanced) ------------------------------------------------- */}
      {(flow === "single" || flow === "feed" || flow === "browse") && step === "rule" && pick && rule && (
        <section className="space-y-4">
          <div className={card}><div className="text-sm">Market: <strong>{pick.title}</strong>{pick.oracle !== "catalogue" && chip(pick.oracle)} <span className="text-neutral-500">({pick.oracle === "kalshi" ? (pick.market ? `market ${pick.market}` : `series ${pick.series}`) : pick.oracle === "polymarket" ? (pick.market ? `condition ${pick.market.slice(0, 10)}…` : pick.series) : `source ${pick.series}`})</span></div>
            {pick.oracle === "kalshi" && !pick.market && <label className="block text-xs mt-2">Only markets whose ticker contains <FieldHelp id="kalshi-filter" /><input data-help="kalshi-filter" className={input + " inline w-40 ml-1"} placeholder="-DEN" value={filter} onChange={(e) => setFilter(e.target.value)} /> <span className="text-neutral-500">(optional; &quot;-DEN&quot; = Denver&apos;s own leg — the back-test lists what matched)</span></label>}
            {pick.oracle === "polymarket" && !pick.market && <label className="block text-xs mt-2">Only markets whose question contains… <FieldHelp id="poly-filter" /><input data-help="poly-filter" className={input + " inline w-56 ml-1"} placeholder="e.g. Best Picture" value={filter} onChange={(e) => setFilter(e.target.value)} /> <span className="text-neutral-500">(optional, plain words{polyPreset && !filter.trim() ? "; now: head-to-head games only" : ""}; the back-test below lists every past market that matched)</span></label>}
            {pick.oracle === "polymarket" && <p className="text-xs text-neutral-400 mt-2">{pick.market ? `YES = ${pick.yes ?? "the first outcome"}, NO = ${pick.no ?? "the second outcome"}.` : "YES = each market's first outcome, NO its second (for a game: the team its title lists first, which changes from game to game)."} The result is the payout Polygon&apos;s Conditional Tokens contract records; a 50-50 resolution burns nothing.</p>}
          </div>
          <div className={card + " space-y-3"}>
            {pick.oracle !== "catalogue" && kind === "binary" && <div className="space-y-1"><div className="text-sm">When should ${ticker || "your coin"} burn?<FieldHelp id="yesno" /></div><div className="grid grid-cols-2 gap-2">{(["yes", "no"] as const).map((v) => (
              <button key={v} onClick={() => setBurnOn(v)} className={`rounded-lg border p-3 text-center ${burnOn === v ? "border-amber-400 bg-amber-400 text-neutral-950" : "border-neutral-700 hover:border-neutral-500"}`}><div className="font-semibold">When it settles {v.toUpperCase()}</div><div className="text-xs opacity-80">{v === "yes" ? (pick.yes ? `YES = ${pick.yes}` : "the thing happens") : (pick.no ? `NO = ${pick.no}` : "the thing does not happen")}</div></button>
            ))}</div></div>}
            {pick.oracle !== "catalogue" && kind === "binary" && <label className="block text-sm">Each burn spends {mode === "buyback" ? pct(onYes) : `${tokensYes.toLocaleString()} tokens`} {mode === "buyback" ? "of the burn pool" : ""}
              <FieldHelp id="share-binary" />{mode === "buyback" ? <input data-help="share-binary" type="range" min={0.01} max={0.1} step={0.005} value={onYes} onChange={(e) => setOnYes(Number(e.target.value))} className="w-full" /> : <input data-help="share-binary" type="range" min={100000} max={20000000} step={100000} value={tokensYes} onChange={(e) => setTokensYes(Number(e.target.value))} className="w-full" />}</label>}
            {kind === "scalar" && pick.oracle === "kalshi" && <p className="text-xs text-neutral-400">This source settles to a number. Defaults: every 1 step above the previous settlement burns once — change the step, the direction or a fixed baseline under More options.</p>}
            <details className="text-sm" open={kind === "scalar" && pick.oracle === "kalshi"}><summary className="cursor-pointer text-neutral-300">More options</summary>
              <div className="mt-2 space-y-3">
                <div className="flex gap-4 flex-wrap">
                  {pick.oracle === "kalshi" && <label>Read the result as <FieldHelp id="read-as" /><select data-help="read-as" className={input + " inline w-32 ml-1"} value={kind} onChange={(e) => setKind(e.target.value as "binary" | "scalar")}><option value="binary">yes / no</option><option value="scalar">a number</option></select></label>}
                  <label>Burn from <FieldHelp id="burn-from" /><select data-help="burn-from" className={input + " inline w-40 ml-1"} value={mode} onChange={(e) => setMode(e.target.value as "buyback" | "vault")}><option value="buyback">the fee pool (buyback)</option><option value="vault">a vesting vault</option></select></label>
                </div>
                {mode === "vault" && <label className="block">Vault share of supply: {pct(vaultShare)} <FieldHelp id="vault-share" /><input data-help="vault-share" type="range" min={0.1} max={0.3} step={0.01} value={vaultShare} onChange={(e) => setVaultShare(Number(e.target.value))} className="w-full" /></label>}
                {pick.oracle !== "catalogue" && kind === "binary" && <label className="block"><FieldHelp id="also-burn-other" /><input data-help="also-burn-other" type="checkbox" checked={onNoEnabled} onChange={(e) => setOnNoEnabled(e.target.checked)} /> also burn on {burnOn === "yes" ? "NO" : "YES"}{onNoEnabled && mode === "buyback" && <>: {pct(onNo)} <input data-help="also-burn-other" type="range" min={0.01} max={0.1} step={0.005} value={onNo} onChange={(e) => setOnNo(Number(e.target.value))} className="w-full" /></>}</label>}
                {(kind === "scalar" || pick.oracle === "catalogue") && <>
                  {pick.oracle === "kalshi" && <>
                    <label className="block">Unit size: <FieldHelp id="unit-size" /><input data-help="unit-size" className={input + " inline w-28 ml-1"} type="number" step="any" value={unit} onChange={(e) => setUnit(Number(e.target.value))} /></label>
                    <label className="block">Baseline: <FieldHelp id="baseline" /><select data-help="baseline" className={input + " inline w-48 ml-1"} value={baseline === "previousSettlement" ? "prev" : "fixed"} onChange={(e) => setBaseline(e.target.value === "prev" ? "previousSettlement" : 0)}><option value="prev">the previous settlement</option><option value="fixed">a fixed number</option></select>{baseline !== "previousSettlement" && <input data-help="baseline" className={input + " inline w-28 ml-1"} type="number" step="any" value={baseline} onChange={(e) => setBaseline(Number(e.target.value))} />}</label>
                    <label className="block">Direction: <FieldHelp id="direction" /><select data-help="direction" className={input + " inline w-40 ml-1"} value={direction} onChange={(e) => setDirection(e.target.value as "up" | "down" | "abs")}><option value="up">up (above)</option><option value="down">down (below)</option><option value="abs">either way</option></select></label>
                  </>}
                  {pick.oracle === "catalogue" && pick.source && <p className="text-xs text-neutral-400">Fixed by the source: unit {pick.source.unit?.label} ({pick.source.unit?.definition}); direction {pick.source.direction}; baseline {String(pick.source.baseline)}.</p>}
                  <label className="block">Per unit: {mode === "buyback" ? `spend ${pct(perUnit)} of the pool (compounding)` : `burn ${tokensYes.toLocaleString()} tokens`}
                    <FieldHelp id="per-unit" />{mode === "buyback" ? <input data-help="per-unit" type="range" min={0.01} max={0.1} step={0.005} value={perUnit} onChange={(e) => setPerUnit(Number(e.target.value))} className="w-full" /> : <input data-help="per-unit" type="range" min={100000} max={20000000} step={100000} value={tokensYes} onChange={(e) => setTokensYes(Number(e.target.value))} className="w-full" />}</label>
                </>}
              </div>
            </details>
            {localPreview && <p className="text-xs text-neutral-400">Live preview over the source&apos;s fixture: {localPreview.units} unit(s) in {localPreview.burnEvents} burn(s){localPreview.poolFractionSpent !== null ? `, ${(localPreview.poolFractionSpent * 100).toFixed(1)}% of the pool` : ""}.</p>}
            {btBusy && <p className="text-xs text-neutral-500">Back-testing…</p>}
            {btErr && <p className="text-xs text-red-400">{btErr}</p>}
            {btFresh && bt && (
              <div className="text-sm space-y-2">
                <p>{bt.sentence}</p>
                {bt.refusals.length > 0 && <p className="text-red-400">REFUSED: {bt.refusals.map((r) => r.reason).join("; ")}</p>}
                {bt.backtest.oneShot && <p className="text-neutral-400">This rule resolves once{bt.backtest.oneShot.resolvesOn ? `, on ${bt.backtest.oneShot.resolvesOn}` : ""}; after that the supply is fixed.</p>}
                <details><summary className="cursor-pointer text-neutral-400">{bt.matched} matched market(s)/event(s)</summary><ul className="text-xs text-neutral-400 max-h-48 overflow-y-auto">{bt.backtest.rows.map((r) => <li key={r.id}><code>{r.id}</code> {r.at.slice(0, 10)} {r.result ?? r.value} → {r.units} unit(s) ({r.kind}){r.title ? ` — ${r.title}` : ""}</li>)}</ul></details>
              </div>
            )}
          </div>
          {navRow("Next: name it →", !btFresh || !bt || bt.refusals.length > 0)}
        </section>
      )}

      {(flow === "single" || flow === "feed" || flow === "browse") && step === "name" && (
        <section className="space-y-3">
          {pick && <p className="text-sm text-neutral-400">Burns on: <b className="text-neutral-200">{pick.title}</b></p>}
          {settleNote && <p className="text-xs text-neutral-500">Settled by: {settleNote}</p>}
          {howSettles && <details className="text-xs text-neutral-400"><summary className="cursor-pointer">How this settles</summary><p className="mt-1 whitespace-pre-wrap">{howSettles}</p></details>}
          {createGrid(pick?.oracle ?? "kalshi")}
          {navRow("Next: review →", !createOk)}
        </section>
      )}

      {/* ---------------------------------------------------------------- REVIEW (every flow) ---------------------------------------------------------------- */}
      {step === "review" && rule && (
        <section className="space-y-3 text-sm">
          <div className="rounded-xl border border-amber-400/60 bg-neutral-900 p-4 space-y-2">
            <h2 className="text-lg font-semibold">In plain words</h2>
            {text && <div className="space-y-1" aria-label="final text">
              <div className="flex flex-wrap items-center gap-2"><span className="bt-chip bt-chip-window">{text.badge}</span><span className="text-xs text-neutral-400">the final description (token metadata, coin page, card, first post)</span></div>
              <p className="text-base">{finalDescription}</p>
              {pairOn && textB && <p className="text-base border-t border-neutral-800 pt-2">{finalDescriptionB}</p>}
              <p className="font-mono text-xs text-neutral-300"><FieldHelp id="review-sha" /> rules sha256 {btFresh && bt ? bt.sha256 : "computing…"}{pairOn && ruleB ? ` · $${tickerB || "B"} ${btFresh && btB ? btB.sha256 : "computing…"}` : ""}</p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-neutral-300" aria-label="review details">
                <dt className="text-neutral-500">settled on<FieldHelp id="review-settlement" /></dt><dd>{settleNote ?? (rule.oracle === "catalogue" && /^espn\./.test(rule.series ?? "") ? "the game's on-chain payout where a market exists, else a licensed final score, confirmed by a second independent source" : rule.oracle === "polymarket" ? "the on-chain payout on Polygon" : pick?.source?.sourceName ?? "the rule's source")}</dd>
                <dt className="text-neutral-500">next possible burn<FieldHelp id="review-next" /></dt><dd>{btFresh && bt?.backtest.oneShot?.resolvesOn ? bt.backtest.oneShot.resolvesOn : "the next settled reading after launch"}</dd>
                <dt className="text-neutral-500">ends<FieldHelp id="review-end" /></dt><dd>{text.windowSentence}</dd>
                {pairOn && !ruleB && <><dt className="text-neutral-500">launch venue</dt><dd data-venue={pairVenue}>{pairVenue === "pair-curve" ? PAIR_CURVE_REVIEW_LINE : "two LaunchLab curves · each coin graduates on its own"}</dd></>}
              </dl>
              {note.trim() && <div className="rounded border border-neutral-700 p-2 text-xs"><div className="font-mono text-[10px] uppercase tracking-wider text-neutral-500">creator&apos;s note — not part of the rule</div>{note.trim()}</div>}
              <p className="text-xs font-medium text-amber-300">Locked at launch — a different rule is a different coin. Nothing above can be changed afterwards.</p>
            </div>}
            {text ? null : flow === "team" && team ? <p className="text-base">{teamCoinSentence(team.nickname ?? team.name, ticker, winLose, fraction)}</p>
              : pairOn && sideA && sideB ? <>
                <p className="text-base">{season
                  ? `Every time the ${sideA.nickname ?? sideA.name} lose, $${ticker} buys itself back with its own fees and burns it. Every time the ${sideB.nickname ?? sideB.name} lose, $${tickerB} does the same. Two separate coins, two separate records.`
                  : `When ${game?.title} is final, the loser's coin burns: if the ${sideA.nickname ?? sideA.name} lose, $${ticker} buys itself back with its own fees and burns it; if the ${sideB.nickname ?? sideB.name} lose, $${tickerB} does. A tie burns neither.`}</p>
                <p>Rules locked forever. You earn nothing from fees. All LP burned.</p>
              </> : <><p className="text-base">{plainSentence(rule, ticker, pick?.title ?? bt?.seriesTitle ?? null)}</p>{settleNote && <p className="text-sm text-neutral-400">Settled by: {settleNote}</p>}<p>Rule locked forever. You earn nothing from fees. All LP burned.</p></>}
            {flow === "team" && team && team.recordText !== null && <p className="text-neutral-400">This season so far the {team.nickname ?? team.name} are {record(team)}: that would have been {(rule ? dialsFor(rule, dialCtx).side?.value : "loss") === "win" ? team.record.w : team.record.l} burn(s).{btFresh && bt ? ` This season so far (settled readings): ${bt.backtest.totals.burnEvents} burn(s) in ${bt.backtest.totals.events} game day(s).` : ""}</p>}
            {btFresh && bt?.refusals.length ? <p className="text-red-400">REFUSED: {bt.refusals.map((r) => r.reason).join("; ")}</p> : null}
          </div>
          <details className={card}><summary className="cursor-pointer text-neutral-300">Details: the exact rule{pairOn ? "s" : ""}, the receipt format, fees</summary>
            <div className="mt-2 space-y-3">
              {[["$" + (ticker || "TICKER"), btFresh ? bt : null, rule] as const, ...(pairOn && ruleB ? [["$" + (tickerB || "B"), btFresh ? btB : null, ruleB] as const] : [])].map(([label, b, r]) => (
                <div key={label}><div className="text-xs text-neutral-400">{label}{b ? ` · sha256 ${b.sha256}` : ""}</div>{b && <p className="text-xs">{b.statement}</p>}<pre className="text-xs bg-neutral-950 border border-neutral-800 rounded p-2 overflow-x-auto mt-1">{b?.text ?? JSON.stringify(r, null, 2)}</pre></div>
              ))}
              <pre className="text-xs bg-neutral-950 border border-neutral-800 rounded p-2 overflow-x-auto">{`BT|${ticker || "TICKER"}|<market>|oracle=${rule.oracle}|market=<${rule.oracle === "polymarket" ? "condition id" : "ticker"}>|result=<yes|no|void>|settled=<time>|src=<settlement source>|value=<n|->|units=<n>|pool=<lamports>|spent=<lamports>|got=<tokens>|burn=<tokens>|swap=<sig12|none>|rules=sha256:<12>|v3`}</pre>
              <ul className="list-disc pl-5 space-y-1 text-xs text-neutral-300">
                <li>On every 1 SOL traded on the curve: 0.0025 SOL to Raydium, 0.0025 SOL to Burnticker (25 bps), 0.005 SOL to {pairOn ? "that coin's" : "the coin's"} burn pool (50 bps, 100% to the pool).</li>
                <li>After graduation: LP burned 100%; Burnticker takes 0; the burn pool receives Raydium&apos;s fixed CPMM creator fee (4.75 bps).</li>
                <li>You receive no cash from fees. Team allocation 0%. You pay LaunchLab&apos;s creation cost and gas.</li>
                <li>Swap guards (TWAP window, slippage) are set by the platform for every coin and shown in the bundle notes.</li>
                <li><Link className="underline" href="/burnticker/trust">What the operator can and cannot do</Link>: it cannot change a rule, withdraw a pool, or touch a holder&apos;s balance.</li>
              </ul>
            </div>
          </details>
          <div className={card + " space-y-2"}>
            <div className="flex items-center gap-2 flex-wrap"><WalletMultiButton /><FieldHelp id="wallet-paste" /><input data-help="wallet-paste" className={input + " w-72"} placeholder="or paste your wallet address (sign later)" value={pasted} onChange={(e) => setPasted(e.target.value)} /></div>
            <label className="block"><FieldHelp id="ack-locked" /><input data-help="ack-locked" type="checkbox" checked={ackLocked} onChange={(e) => setAckLocked(e.target.checked)} /> I understand {pairOn ? "neither rule can" : "the rule can never"} be changed, by anyone.</label>
            <label className="block"><FieldHelp id="ack-no-returns" /><input data-help="ack-no-returns" type="checkbox" checked={ackNoReturns} onChange={(e) => setAckNoReturns(e.target.checked)} /> I won&apos;t promise anyone anything about price or returns.</label>
            <details className="text-xs text-neutral-400"><summary className="cursor-pointer">Optional first buy</summary><label className="block mt-1">SOL (≤ 50): <FieldHelp id="first-buy" /><input data-help="first-buy" className={input + " inline w-28 ml-1"} value={firstBuy} onChange={(e) => setFirstBuy(e.target.value)} /></label></details>
            {launchErr && <p className="text-red-400">{launchErr}</p>}
            <div className="flex items-center gap-3 pt-1"><button className="text-sm underline" onClick={back}>← Back</button><button className={primary} disabled={!ackLocked || !ackNoReturns || !creator || busy || (btFresh && !!bt?.refusals.length)} onClick={launch}>{busy ? "building…" : pairOn ? "Build both launch bundles" : "Build the launch bundle"}</button>{!creator && <span className="text-xs text-neutral-500">connect a wallet or paste an address first</span>}</div>
          </div>
        </section>
      )}

      {step === "launch" && (bundle || pcOut) && (() => {
        const bundleCard = (b: Bundle, label: string, order: string) => (
          <div className={card} key={b.mint}>
            <h2 className="font-medium">{order}Launch bundle for ${b.ticker ?? label}</h2>
            <p>Mint <code>{b.mint}</code> · LaunchLab pool <code>{b.addresses.poolId}</code>{b.addresses.vault ? <> · vault <code>{b.addresses.vault}</code></> : null}</p>
            <p className="text-xs">Burn pool = LaunchLab creator = the burn program&apos;s fee PDA <code>{b.addresses.feePda}</code> · its WSOL account (claimed curve fees land here) <code>{b.addresses.feeWsol}</code>. Your wallet pays and signs; the keeper only pays gas.</p>
            <p className="text-xs text-neutral-500">{b.transactions.map((t) => `${t.label}: ${t.instructions.length} instruction(s), signers ${t.signers.join(" + ")}`).join(" · ")}</p>
            {b.ready ? <p className="text-emerald-400">Ready to sign.</p> : <div className="text-amber-400"><p>Not signable yet. Pending:</p><ul className="list-disc pl-5 text-xs">{b.pending.map((p) => <li key={p}>{p}</li>)}</ul><p className="text-xs text-neutral-400 mt-1">The draft is registered (status: draft) with this exact rules.json and hash. When the pieces land, come back and sign; nothing is sent from this page until the bundle says ready.</p></div>}
            <ul className="list-disc pl-5 text-xs text-neutral-400 mt-2">{b.notes.map((n) => <li key={n}>{n}</li>)}</ul>
          </div>
        );
        return (
          <section className="space-y-3 text-sm">
            {pcOut ? <>
              <PairCurveSign pc={pcOut.pc} mintKeys={pcOut.keys} creator={creator || null} tickers={{ a: ticker, b: tickerB }} notes={pcOut.notes} />
              <p><Link className="underline" href={`/burnticker/p/${pcOut.pairId}`}>Open the pair page →</Link> · <Link className="underline" href={`/burnticker/t/${ticker}`}>${ticker}</Link> · <Link className="underline" href={`/burnticker/t/${tickerB}`}>${tickerB}</Link></p>
            </> : pairOut ? <>
              <div className={card}><h2 className="font-medium">{pairOut.pairId ? <>Rivalry pair <code>{pairOut.pairId}</code></> : <>Two coins, every game this season</>}</h2><p className="text-xs text-neutral-400">{pairOut.pairId ? "Sign side A's bundle first, then side B's (B's rule names A's mint as counterpart)." : "Two independent launches: sign each bundle."}</p><ul className="list-disc pl-5 text-xs text-neutral-400">{pairOut.notes.map((n) => <li key={n}>{n}</li>)}</ul></div>
              {bundleCard(pairOut.a, ticker, "1 · ")}{bundleCard(pairOut.b, tickerB, "2 · ")}
              <p>{pairOut.pairId && <><Link className="underline" href={`/burnticker/p/${pairOut.pairId}`}>Open the pair page →</Link> · </>}<Link className="underline" href={`/burnticker/t/${ticker}`}>${ticker}</Link> · <Link className="underline" href={`/burnticker/t/${tickerB}`}>${tickerB}</Link></p>
            </> : bundle ? <>
              {bundleCard(bundle, ticker, "")}
              <p><Link className="underline" href={`/burnticker/t/${ticker}`}>Open the token page →</Link> (it shows the draft; the receipts table fills itself once live)</p>
            </> : null}
          </section>
        );
      })()}
    </main>
  );
}
