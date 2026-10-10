"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { previewTotals, unitStep, type SettledEvent } from "@/lib/burnticker/units";
import type { BurnRule } from "@/lib/burnticker/rules";
import { aliasLookup } from "@/lib/burnticker/oracle/events";
import { DEFAULT_FRACTION, headToHead, matchupRules, teamCoinRule, teamCoinSentence } from "@/lib/burnticker/wizard";

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
 *   ADVANCED      first-party feeds and the custom Kalshi selector (series + ticker filter, or a pasted market).
 *
 * Progress ("Step 2 of 4"), back buttons, state kept across a refresh (sessionStorage), a Devnet badge from the server's cluster.
 * The request body and the launch route are unchanged: the API returns the unsigned bundle(s); nothing is sent from this page.
 * Every parameter is in rules.json, shown in full under "details".
 */

type Step = "choose" | "team" | "pick" | "rule" | "name" | "review" | "launch";
/** team = one team's every game; pair = two teams; single = any Kalshi or Polymarket market; feed = advanced (first-party feed / custom selector). */
type Flow = "team" | "pair" | "single" | "feed";
const ORDER: Record<Flow, Step[]> = { team: ["team", "name", "review", "launch"], pair: ["pick", "name", "rule", "review", "launch"], single: ["pick", "rule", "name", "review", "launch"], feed: ["pick", "rule", "name", "review", "launch"] };
const LABELS: Record<Flow, Partial<Record<Step, string>>> = {
  team: { team: "Pick your team", name: "Win or lose, and a name", review: "Review", launch: "Launch" },
  pair: { pick: "Pick the game", name: "Name both sides", rule: "Back-test", review: "Review", launch: "Launch both" },
  single: { pick: "Find a market", rule: "The rule", name: "Name it", review: "Review", launch: "Launch" },
  feed: { pick: "Source", rule: "The rule", name: "Name it", review: "Review", launch: "Launch" },
};
interface Series { ticker: string; title: string; category: string | null; frequency: string | null; settlementSource: { name: string; url: string } | null; refused: string[] }
interface Source { id: string; kind: string; tier: number; tierLabel: string; title: string; sourceName: string; sourceUrl: string; cadence: string; unit: { size: number; label: string; definition: string } | null; direction: "up" | "down" | "abs" | null; baseline: "previousSettlement" | number | null; flags: string[]; launchable: { ok: boolean; why: string | null }; param: string | null; lastReading: { id: string; value: string | null; at: string } | null; readings: { id: string; value: string | null }[]; preview: { window: { from: string; to: string }; units: number; burnEvents: number; poolFractionSpent: number | null } | null }
interface Backtest { sentence: string; text: string; sha256: string; sha12: string; mode: string; statement: string; seriesTitle: string | null; refusals: { reason: string }[]; matched: number; backtest: { rows: { id: string; at: string; title: string | null; result: string | null; value: string | null; units: number; kind: string }[]; totals: { events: number; burnEvents: number; voids: number; units: number; poolFractionSpent: number | null; tokens: number | null }; oneShot: { resolvesOn: string | null } | null } }
interface Bundle { ready: boolean; pending: string[]; mint: string; ticker: string; rules: { text: string; sha256: string; statement: string; mode: string }; addresses: { feePda: string; feeWsol: string; vault: string | null; poolId: string; platformId: string }; allocation: { curve: string; locked: string; reserve: string; lpBurnedPct: number; teamAllocationPct: number }; fees: { sentence: string; curve: { legs: { label: string; bps: number }[]; totalBps: number }; postGraduation: { legs: { label: string; bps: number }[]; totalBps: number } }; burnPoolAuthority: string; transactions: { label: string; signers: string[]; instructions: { label: string }[] }[]; notes: string[] }
interface League { id: string; label: string; series: { ticker: string; title: string }[] }
interface Team { abbr: string; city: string; nickname: string | null; name: string; ticker: string; league: string | null; filter: string; collisions: string[]; next: { eventTicker: string; marketTicker: string; title: string; expectedAt: string | null; opponent: string | null } | null; record: { w: number; l: number; d: number; since: string } }
interface Side { abbr: string; marketTicker: string; label: string; nickname: string | null; name: string; ticker: string }
interface PolyMarket { conditionId: string; question: string; yes: string; no: string; endDate: string | null; closed: boolean; sportsMarketType: string | null }
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
  const [pasted, setPasted] = useState("");
  const creator = wallet.publicKey?.toBase58() ?? (PUB.test(pasted.trim()) ? pasted.trim() : "");
  // team / pair pickers
  const [leagues, setLeagues] = useState<League[]>([]), [leagueErr, setLeagueErr] = useState<string | null>(null);
  const [leagueSeries, setLeagueSeries] = useState<string | null>(null);
  const [teams, setTeams] = useState<Team[]>([]), [teamsBusy, setTeamsBusy] = useState(false), [teamQ, setTeamQ] = useState("");
  const [team, setTeam] = useState<Team | null>(null), [winLose, setWinLose] = useState<"win" | "lose">("lose");
  const [games, setGames] = useState<EventHit[]>([]), [gamesBusy, setGamesBusy] = useState(false), [gameQ, setGameQ] = useState("");
  const [game, setGame] = useState<EventHit | null>(null), [swap, setSwap] = useState(false), [pairMode, setPairMode] = useState<"game" | "season">("game");
  // any-market search (events + series)
  const [q2, setQ2] = useState(""), [found, setFound] = useState<{ results: Series[]; events: EventHit[]; ranking: "events" | "series" } | null>(null), [findBusy, setFindBusy] = useState(false);
  const [polyFound, setPolyFound] = useState<PolyFound | null>(null), [polyErr, setPolyErr] = useState<string | null>(null);
  // advanced: custom selector + first-party feeds
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Series[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [pick, setPick] = useState<{ oracle: "kalshi" | "catalogue" | "polymarket"; series: string | null; market: string | null; title: string; source?: Source; yes?: string; no?: string } | null>(null);
  const [filter, setFilter] = useState("");
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
  const [name, setName] = useState(""), [ticker, setTicker] = useState(""), [description, setDescription] = useState(""), [imageUrl, setImageUrl] = useState(""), [link, setLink] = useState("");
  const [nameB, setNameB] = useState(""), [tickerB, setTickerB] = useState(""), [descB, setDescB] = useState(""), [imageB, setImageB] = useState("");
  // review / launch
  const [ackLocked, setAckLocked] = useState(false), [ackNoReturns, setAckNoReturns] = useState(false), [firstBuy, setFirstBuy] = useState("0");
  const [bundle, setBundle] = useState<Bundle | null>(null), [launchErr, setLaunchErr] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const [pairOut, setPairOut] = useState<{ pairId: string | null; a: Bundle; b: Bundle; notes: string[] } | null>(null);

  const pairOn = flow === "pair";
  const season = pairOn && pairMode === "season";
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
      set("name", setName); set("ticker", setTicker); set("description", setDescription); set("imageUrl", setImageUrl); set("link", setLink);
      set("nameB", setNameB); set("tickerB", setTickerB); set("descB", setDescB); set("imageB", setImageB); set("firstBuy", setFirstBuy); set("pasted", setPasted); set("q2", setQ2);
    } else if (wantPair) { setFlow("pair"); setStep("pick"); }
    setReady(true);
  }, []);
  const snapshot = JSON.stringify({ flow, step, leagueSeries, team, winLose, game, swap, pairMode, pick, filter, kind, mode, onYes, onNoEnabled, onNo, unit, perUnit, baseline, direction, tokensYes, vaultShare, burnOn, fraction, name, ticker, description, imageUrl, link, nameB, tickerB, descB, imageB, firstBuy, pasted, q2 });
  useEffect(() => { if (ready) { try { sessionStorage.setItem(STORE, snapshot); } catch { /* private mode: no memory, no harm */ } } }, [ready, snapshot]);
  useEffect(() => { window.scrollTo({ top: 0 }); }, [step]);
  const startOver = () => { try { sessionStorage.removeItem(STORE); } catch { /* ignore */ } window.location.href = window.location.pathname; };

  useEffect(() => { fetch("/api/burnticker/catalogue").then((r) => r.json()).then((j) => { setSources(j.sources ?? []); setCluster(j.cluster ?? null); }).catch(() => {}); }, []);
  useEffect(() => { if (!q.trim()) { setHits([]); return; } const t = setTimeout(() => { fetch(`/api/burnticker/oracle/search?q=${encodeURIComponent(q.trim())}`).then((r) => r.json()).then((j) => setHits(j.results ?? [])).catch(() => setHits([])); }, 350); return () => clearTimeout(t); }, [q]);
  // leagues for the team / pair pickers
  useEffect(() => { if ((flow === "team" || flow === "pair") && !leagues.length) getJson<{ leagues: League[] }>(`${V1}/kalshi/events`).then((j) => setLeagues(j.leagues ?? [])).catch((e) => setLeagueErr(String(e.message))); }, [flow, leagues.length]);
  useEffect(() => { if (flow !== "team" || !leagueSeries) return; setTeamsBusy(true); getJson<{ teams: Team[] }>(`${V1}/kalshi/teams?series=${leagueSeries}`).then((j) => setTeams(j.teams)).catch(() => setTeams([])).finally(() => setTeamsBusy(false)); }, [flow, leagueSeries]);
  useEffect(() => {
    if (flow !== "pair" || !leagueSeries) return;
    const url = gameQ.trim() ? `${V1}/kalshi/events?series=${leagueSeries}&q=${encodeURIComponent(gameQ.trim())}` : `${V1}/kalshi/events?series=${leagueSeries}`;
    setGamesBusy(true);
    const t = setTimeout(() => { getJson<{ events: EventHit[] }>(url).then((j) => setGames(j.events.filter((e) => e.pair))).catch(() => setGames([])).finally(() => setGamesBusy(false)); }, gameQ ? 300 : 0);
    return () => clearTimeout(t);
  }, [flow, leagueSeries, gameQ]);
  // any-market search
  useEffect(() => {
    if (flow !== "single" || q2.trim().length < 2) { setFound(null); setPolyFound(null); return; }
    setFindBusy(true);
    const t = setTimeout(() => {
      const qs = encodeURIComponent(q2.trim());
      // Both venues at once; either may fail without hiding the other.
      const kalshi = getJson<{ results: Series[]; events: EventHit[]; ranking: "events" | "series" }>(`${V1}/kalshi/search?q=${qs}`).then((j) => setFound({ results: j.results ?? [], events: j.events ?? [], ranking: j.ranking ?? "series" })).catch(() => setFound({ results: [], events: [], ranking: "series" }));
      const poly = getJson<PolyFound>(`${V1}/polymarket/search?q=${qs}`).then((j) => { setPolyFound({ events: j.events ?? [], tags: j.tags ?? [], markets: j.markets ?? [] }); setPolyErr(null); }).catch((e) => { setPolyFound({ events: [], tags: [], markets: [] }); setPolyErr(String((e as Error).message)); });
      void Promise.allSettled([kalshi, poly]).then(() => setFindBusy(false));
    }, 400);
    return () => clearTimeout(t);
  }, [flow, q2]);

  // ---- the rules ------------------------------------------------------------------------------------------------------------------
  const genericRule: BurnRule | null = useMemo(() => {
    if (!pick) return null;
    const mapping = (f: number, tok: number) => (mode === "buyback" ? { fractionOfPool: Number(f.toFixed(4)) } : { tokens: Math.round(tok) });
    // Kalshi filters by ticker text; Polymarket by a regular expression over the market question (it has no tickers).
    // (A question regex left over from a Polymarket pick is not a ticker filter, so a non-ticker text is ignored for Kalshi.)
    const flt = pick.market || !filter.trim() ? {} : pick.oracle === "polymarket" ? { titleRegex: filter.trim() } : /^[-A-Za-z0-9._]{1,32}$/.test(filter.trim()) ? { tickerIncludes: filter.trim().toUpperCase() } : {};
    const base = { schema: SCHEMA, oracle: pick.oracle, series: pick.series, market: pick.market, filter: flt, onVoid: "skip" as const, floorUsd: "1", reserveSol: "0.02", vault: mode === "vault" ? { share: vaultShare, vestDays: 365, cliffDays: 0 } : null };
    if (pick.oracle === "catalogue" && pick.source?.unit) return { ...base, kind: "scalar", scalar: { unit: pick.source.unit.size, perUnit: mapping(perUnit, tokensYes), baseline: pick.source.baseline!, direction: pick.source.direction! }, binary: null } as BurnRule;
    if (kind === "binary" || pick.oracle === "polymarket") {
      const main = mapping(onYes, tokensYes), other = onNoEnabled ? mapping(onNo, Math.round(tokensYes / 4)) : null;
      return { ...base, kind: "binary", binary: burnOn === "yes" ? { onYes: main, onNo: other } : { onYes: other, onNo: main }, scalar: null } as BurnRule;
    }
    return { ...base, kind: "scalar", scalar: { unit, perUnit: mapping(perUnit, tokensYes), baseline, direction }, binary: null } as BurnRule;
  }, [pick, filter, kind, mode, onYes, onNoEnabled, onNo, unit, perUnit, baseline, direction, tokensYes, vaultShare, burnOn]);

  const pairRules = useMemo(() => (pairOn && game && sideA && sideB ? matchupRules(game.seriesTicker, game.eventTicker, sideA.abbr, sideB.abbr, pairMode, fraction) : null), [pairOn, game, sideA, sideB, pairMode, fraction]);
  const rule: BurnRule | null = useMemo(() => {
    if (flow === "team") return team && leagueSeries ? teamCoinRule(leagueSeries, team.abbr, winLose, fraction) : null;
    if (flow === "pair") return pairRules?.a ?? null;
    return genericRule;
  }, [flow, team, leagueSeries, winLose, fraction, pairRules, genericRule]);
  /** Side B: "every game" = its own rule; "this game only" = the server's inversion, previewed here the same way (binary swap). */
  const ruleB: BurnRule | null = useMemo(() => {
    if (!pairRules) return null;
    if (pairRules.b) return pairRules.b;
    const a = pairRules.a;
    return a.binary ? { ...a, binary: { onYes: a.binary.onNo, onNo: a.binary.onYes } } : null;
  }, [pairRules]);

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

  const launch = useCallback(async () => {
    if (!rule) return;
    setBusy(true); setLaunchErr(null);
    const post = async (body: Record<string, unknown>) => { const r = await fetch("/api/burnticker/launch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); const j = await r.json(); if (!r.ok) throw new Error(j.error ?? r.statusText); return j; };
    const common = { creator, firstBuySol: firstBuy || "0", acknowledgements: { ruleLocked: ackLocked, noReturns: ackNoReturns } };
    try {
      if (season && ruleB) {
        // "Every game this season": two coins, each on its own team's games — two launches, not a registered pair (one shared selector is what a pair needs).
        const a = await post({ ...common, ticker: ticker.toUpperCase(), name, description, imageUrl: imageUrl.trim() || null, links: link.trim() ? [{ label: "link", url: link.trim() }] : [], rule });
        const b = await post({ ...common, firstBuySol: "0", ticker: tickerB.toUpperCase(), name: nameB, description: descB, imageUrl: imageB.trim() || null, links: [], rule: ruleB });
        setPairOut({ pairId: null, a: a.bundle, b: b.bundle, notes: ["Two coins, each burning on its own team's losses: two independent records. They meet only when the two teams play each other; on those games exactly one side burns."] }); setBundle(a.bundle);
      } else {
        const j = await post({ ...common, ticker: ticker.toUpperCase(), name, description, imageUrl: imageUrl.trim() || null, links: link.trim() ? [{ label: "link", url: link.trim() }] : [], rule, pair: pairOn ? { ticker: tickerB.toUpperCase(), name: nameB, description: descB, imageUrl: imageB.trim() || null, links: [] } : undefined });
        if (j.bundles) { setPairOut({ pairId: j.pair.pairId, a: j.bundles.a, b: j.bundles.b, notes: j.pair.notes }); setBundle(j.bundles.a); } else setBundle(j.bundle);
      }
      setStep("launch");
    } catch (e) { setLaunchErr(String((e as Error).message)); } finally { setBusy(false); }
  }, [rule, ruleB, season, pairOn, creator, ticker, name, description, imageUrl, link, firstBuy, ackLocked, ackNoReturns, tickerB, nameB, descB, imageB]);

  // ---- navigation -----------------------------------------------------------------------------------------------------------------
  const order = ORDER[flow];
  const idx = order.indexOf(step);
  const next = () => setStep(order[Math.min(idx + 1, order.length - 1)]);
  const back = () => (idx <= 0 ? setStep("choose") : setStep(order[idx - 1]));
  const begin = (f: Flow) => {
    setFlow(f); setStep(ORDER[f][0]); setBt(null); setBtB(null); setBtFor(""); setPairOut(null); setBundle(null);
    if (f === "team" || f === "pair") { setFraction(DEFAULT_FRACTION); setLeagueSeries(null); }
    if (f === "single" && pick?.oracle === "catalogue") setPick(null);
  };
  const chooseTeam = (t: Team) => { setTeam(t); setName(t.name); setTicker(t.ticker); next(); };
  const chooseGame = (g: EventHit) => {
    if (!g.pair) return;
    setGame(g); setSwap(false); setPairMode("game");
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
  const leaguePicker = (
    <div className="space-y-2">
      {leagueErr && <p className="text-red-400 text-xs">Kalshi is not answering right now ({leagueErr}).</p>}
      <div className="flex flex-wrap gap-2">{leagues.map((l) => l.series.length === 1
        ? <button key={l.id} onClick={() => { setLeagueSeries(l.series[0].ticker); setTeamQ(""); setGameQ(""); }} className={`rounded-full border px-4 py-2 text-sm ${leagueSeries === l.series[0].ticker ? "border-amber-400 bg-amber-400 text-neutral-950" : "border-neutral-700 hover:border-neutral-500"}`}>{l.label}</button>
        : <span key={l.id} className="inline-flex flex-wrap items-center gap-1 rounded-full border border-neutral-700 px-2 py-1 text-sm"><span className="px-2 text-neutral-400">{l.label}</span>{l.series.slice(0, 6).map((s) => <button key={s.ticker} onClick={() => { setLeagueSeries(s.ticker); setTeamQ(""); setGameQ(""); }} className={`rounded-full px-2 py-0.5 text-xs ${leagueSeries === s.ticker ? "bg-amber-400 text-neutral-950" : "bg-neutral-800 hover:bg-neutral-700"}`}>{s.title.replace(/ Game$/, "")}</button>)}</span>)}
        {!leagues.length && !leagueErr && <span className="text-sm text-neutral-500">Loading leagues…</span>}
      </div>
    </div>
  );
  const chip = (v: Venue) => <span className={`ml-2 inline-block rounded px-1.5 py-0.5 align-middle text-[10px] font-medium uppercase tracking-wide ring-1 ${v === "kalshi" ? "bg-emerald-500/15 text-emerald-300 ring-emerald-500/40" : "bg-indigo-500/15 text-indigo-300 ring-indigo-500/40"}`}>{v === "kalshi" ? "Kalshi" : "Polymarket"}</span>;
  const pickPoly = (m: PolyMarket) => { setPick({ oracle: "polymarket", series: null, market: m.conditionId, title: `${m.question} (resolves once)`, yes: m.yes, no: m.no }); setKind("binary"); setFilter(""); next(); };
  const pickPolySeries = (series: string, title: string) => { setPick({ oracle: "polymarket", series, market: null, title }); setKind("binary"); setFilter(series.includes("/moneyline") ? "^[^:]+ vs\\. [^:]+$" : ""); next(); };
  const badge = (abbr: string) => <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-neutral-800 font-mono text-xs font-bold tracking-tight text-amber-300 ring-1 ring-neutral-700">{abbr}</span>;
  const teamFilter = (t: Team) => { const s = teamQ.trim().toLowerCase(); if (!s) return true; if (`${t.name} ${t.abbr} ${t.city} ${t.nickname ?? ""}`.toLowerCase().includes(s)) return true; return aliasLookup(teamQ).some((a) => a.abbr === t.abbr && a.series === leagueSeries); };

  return (
    <main className="mx-auto max-w-4xl px-4 py-6 space-y-5">
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">Launch a coin {cluster === "devnet" && <span className="rounded bg-sky-500/20 px-2 py-0.5 text-xs font-medium text-sky-300 ring-1 ring-sky-500/40" title="BURNTICKER_CLUSTER=devnet: test network, no real money">Devnet</span>}</h1>
          <p className="text-neutral-400 text-sm"><Link className="underline" href="/burnticker">Burnticker</Link> · burns on a Kalshi settlement · the rule is locked at launch · <Link className="underline" href="/burnticker/trust">what the operator can and cannot do</Link></p>
        </div>
        {step !== "choose" && <button className="text-xs text-neutral-500 underline" onClick={startOver}>start over</button>}
      </header>

      {step !== "choose" && (
        <div aria-label="Progress">
          <div className="flex items-center justify-between text-xs text-neutral-400"><span>Step {idx + 1} of {order.length} · <span className="text-neutral-200">{LABELS[flow][step]}</span></span><span>{flow === "team" ? "Team coin" : flow === "pair" ? "Matchup pair" : flow === "single" ? "Any market" : "Advanced"}</span></div>
          <div className="mt-1 h-1.5 rounded bg-neutral-800"><div className="h-1.5 rounded bg-amber-400" style={{ width: `${((idx + 1) / order.length) * 100}%` }} /></div>
        </div>
      )}

      {step === "choose" && (
        <section className="space-y-3" aria-label="What do you want to launch?">
          <h2 className="text-lg font-medium">What do you want to launch?</h2>
          <div className="grid gap-3 md:grid-cols-3">
            {([
              ["team", "Team coin", "One team. Burns on every win, or on every loss — you pick.", "e.g. $EAGLES burns every time the Eagles lose"],
              ["pair", "Matchup pair", "Two teams, two coins. This game only, or the whole season.", "e.g. $EAGLES vs $JAGUARS — the loser burns"],
              ["single", "Any market", "Search Kalshi and Polymarket by name: a player, a show, an election, a city's weather.", "e.g. CPI, Denver snow, the Oscars"],
            ] as const).map(([f, title, body, eg]) => (
              <button key={f} onClick={() => begin(f)} className="text-left rounded-xl border border-neutral-800 bg-neutral-900 p-5 hover:border-amber-400 focus:border-amber-400 focus:outline-none">
                <div className="text-lg font-semibold">{title}</div>
                <p className="mt-1 text-sm text-neutral-300">{body}</p>
                <p className="mt-3 text-xs text-neutral-500">{eg}</p>
              </button>
            ))}
          </div>
          <p className="text-xs text-neutral-500"><button className="underline" onClick={() => begin("feed")}>Advanced: first-party feed / custom selector</button></p>
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
              <div className="flex items-center justify-between gap-2 flex-wrap"><h2 className="font-medium">2. Pick your team</h2><input className={input + " w-64"} placeholder="Eagles, Philly, PHI…" value={teamQ} onChange={(e) => setTeamQ(e.target.value)} /></div>
              {teamsBusy && <p className="text-sm text-neutral-500">Loading teams from Kalshi…</p>}
              {!teamsBusy && !teams.length && <p className="text-sm text-neutral-500">No teams found for this league right now (no open or recent games on Kalshi).</p>}
              <div className="grid gap-2 sm:grid-cols-2">{teams.filter(teamFilter).map((t) => (
                <button key={t.abbr} onClick={() => chooseTeam(t)} className={`flex items-center gap-3 rounded-lg border p-2 text-left hover:border-amber-400 ${team?.abbr === t.abbr ? "border-amber-400" : "border-neutral-800"}`}>
                  {badge(t.abbr)}
                  <div className="min-w-0"><div className="font-medium truncate">{t.name}</div><div className="text-xs text-neutral-400">{record(t)} this season{t.next ? ` · next: ${t.next.opponent ? `vs ${t.next.opponent}` : t.next.title}, result ~${denver(t.next.expectedAt)}` : ""}</div></div>
                </button>
              ))}</div>
              <p className="text-xs text-neutral-500">Teams, records and next games come from Kalshi&apos;s own game markets. Times are Denver time.</p>
            </div>
          )}
          {navRow(null)}
        </section>
      )}

      {flow === "team" && step === "name" && team && (
        <section className="space-y-4">
          <div className={card + " space-y-3"}>
            <h2 className="font-medium">When should ${ticker || team.ticker} burn?</h2>
            <div className="grid grid-cols-2 gap-2">{(["lose", "win"] as const).map((w) => (
              <button key={w} onClick={() => setWinLose(w)} className={`rounded-lg border p-4 text-center ${winLose === w ? "border-amber-400 bg-amber-400 text-neutral-950" : "border-neutral-700 hover:border-neutral-500"}`}><div className="text-lg font-semibold">When the {team.nickname ?? team.name} {w === "win" ? "WIN" : "LOSE"}</div><div className="text-xs opacity-80">{w === "lose" ? "every loss burns" : "every win burns"}</div></button>
            ))}</div>
            <p className="text-sm text-neutral-300">This season so far: {record(team)} → {winLose === "win" ? team.record.w : team.record.l} burn{(winLose === "win" ? team.record.w : team.record.l) === 1 ? "" : "s"} would have happened.</p>
          </div>
          <div className={card + " space-y-2 text-sm"}>
            <h2 className="font-medium">Name your coin</h2>
            <label className="block">Name <input className={input} maxLength={32} value={name} onChange={(e) => setName(e.target.value)} /></label>
            <label className="block">Ticker (2–10 letters or digits) <input className={input} maxLength={10} value={ticker} onChange={(e) => setTicker(e.target.value.toUpperCase())} /></label>
            <label className="block">Image link (optional, https) <input className={input} value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://…" /></label>
            <label className="block">One line about it (optional) <input className={input} maxLength={400} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
          </div>
          <details className={card + " text-sm"}>
            <summary className="cursor-pointer text-neutral-300">Edit the rule</summary>
            <div className="mt-2 space-y-2">
              <label className="block">Each {winLose === "win" ? "win" : "loss"} spends {pct(fraction)} of the burn pool <input type="range" min={0.01} max={0.1} step={0.005} value={fraction} onChange={(e) => setFraction(Number(e.target.value))} className="w-full" /></label>
              <p className="text-xs text-neutral-400">Generated selector: every <code>{leagueSeries}</code> market whose ticker contains <code>{team.filter}</code> (the {team.name}&apos; own leg of each game), burning when it settles {winLose === "win" ? "YES" : "NO"}. Spend floor $1 (smaller spends wait), 0.02 SOL reserve, a voided game burns nothing.{team.collisions.length ? ` Note: "${team.filter}" also matches ${team.collisions.join(", ")} — check the back-test on review.` : ""}{winLose === "lose" ? " Where a league has draws, a draw settles the team's leg NO, so a draw burns too." : ""}</p>
            </div>
          </details>
          {navRow("Next: review →", !name.trim() || !okTicker(ticker))}
        </section>
      )}

      {/* ---------------------------------------------------------------- MATCHUP PAIR ---------------------------------------------------------------- */}
      {flow === "pair" && step === "pick" && (
        <section className="space-y-4">
          <div className={card + " space-y-3"}><h2 className="font-medium">1. Pick a league</h2>{leaguePicker}</div>
          {leagueSeries && (
            <div className={card + " space-y-3"}>
              <div className="flex items-center justify-between gap-2 flex-wrap"><h2 className="font-medium">2. Pick the game</h2><input className={input + " w-64"} placeholder="search a team: Eagles, JAX…" value={gameQ} onChange={(e) => setGameQ(e.target.value)} /></div>
              {gamesBusy && <p className="text-sm text-neutral-500">Loading games from Kalshi…</p>}
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
            <h2 className="font-medium">{game.title}</h2>
            <div className="grid gap-2 sm:grid-cols-2">{([["game", "This game only", `Settles once, ~${denver(game.expectedAt)}. Exactly one coin burns.`], ["season", "Every game this season", `${sideA.name}: every loss burns. ${sideB.name}: every loss burns. Two separate records.`]] as const).map(([m, title, body]) => (
              <button key={m} onClick={() => setPairMode(m)} className={`rounded-lg border p-3 text-left ${pairMode === m ? "border-amber-400 ring-1 ring-amber-400" : "border-neutral-700 hover:border-neutral-500"}`}><div className="font-medium">{title}{m === "game" && <span className="ml-2 text-xs text-neutral-400">(default)</span>}</div><div className="text-xs text-neutral-400 mt-1">{body}</div></button>
            ))}</div>
            {pairMode === "season" && <p className="text-xs text-amber-300">Every game this season = two coins, each on its OWN team&apos;s games. They only meet when these two teams play each other (then exactly one burns); the rest of the season each coin keeps its own record, so they are launched as two coins, not as one registered pair.</p>}
            {pairMode === "game" && game.pair?.tieMarket && <p className="text-xs text-neutral-400">This league has draws: Kalshi settles ${ticker || sideA.ticker}&apos;s market NO on a draw, so a draw burns ${ticker || sideA.ticker}. <button className="underline" onClick={doSwap}>Swap sides</button> to give the draw to the other team.</p>}
          </div>
          <div className="grid gap-3 md:grid-cols-2">{([["A", sideA, name, setName, ticker, setTicker, imageUrl, setImageUrl], ["B", sideB, nameB, setNameB, tickerB, setTickerB, imageB, setImageB]] as const).map(([k, sd, nm, setNm, tk, setTk, img, setImg]) => (
            <div key={k} className={card + " space-y-2 text-sm"}>
              <div className="flex items-center gap-2">{badge(sd.abbr)}<div className="text-xs text-neutral-400">burns when the {sd.nickname ?? sd.label} lose</div></div>
              <label className="block">Name <input className={input} maxLength={32} value={nm} onChange={(e) => setNm(e.target.value)} /></label>
              <label className="block">Ticker <input className={input} maxLength={10} value={tk} onChange={(e) => setTk(e.target.value.toUpperCase())} /></label>
              <label className="block">Image link (optional) <input className={input} value={img} onChange={(e) => setImg(e.target.value)} placeholder="https://…" /></label>
            </div>
          ))}</div>
          <p className="text-xs text-neutral-500"><button className="underline" onClick={doSwap}>Swap sides</button>{tickerB && tickerB === ticker ? <span className="text-red-400"> · the two coins need different tickers</span> : null}</p>
          {navRow("Next: back-test →", !name.trim() || !nameB.trim() || !okTicker(ticker) || !okTicker(tickerB) || ticker === tickerB, () => { setBt(null); setBtB(null); setBtFor(""); next(); })}
        </section>
      )}

      {flow === "pair" && step === "rule" && sideA && sideB && (
        <section className="space-y-4">
          {btBusy && <p className="text-sm text-neutral-500">Back-testing both sides on Kalshi&apos;s settled history…</p>}
          {btErr && <p className="text-sm text-red-400">{btErr}</p>}
          {btFresh && bt && btB && (() => {
            const hh = season ? headToHead(bt.backtest.rows, btB.backtest.rows) : null;
            const partition = bt.backtest.totals.burnEvents + btB.backtest.totals.burnEvents === bt.backtest.totals.events - bt.backtest.totals.voids;
            return (
              <div className="grid md:grid-cols-2 gap-2 text-sm">
                <div className={card}><div className="text-xs text-neutral-400">${ticker} · {name}</div><p>{bt.sentence}</p><p className="text-xs text-neutral-500">{bt.backtest.totals.burnEvents} burn(s) of {bt.backtest.totals.events} settlement(s)</p></div>
                <div className={card}><div className="text-xs text-neutral-400">${tickerB} · {nameB}</div><p>{btB.sentence}</p><p className="text-xs text-neutral-500">{btB.backtest.totals.burnEvents} burn(s) of {btB.backtest.totals.events} settlement(s)</p></div>
                {hh ? <p className="md:col-span-2 text-xs text-neutral-300">Independent records (every game this season): each coin counts its own team&apos;s games. Head-to-head games in the window: {hh.games}{hh.games ? ` — ${ticker} burned ${hh.burnsA}, ${tickerB} burned ${hh.burnsB}${hh.both || hh.neither ? ` (${hh.both} both, ${hh.neither} neither — check the rule)` : ", exactly one each game"}` : ""}.</p>
                  : <p className={`md:col-span-2 text-xs ${partition ? "text-emerald-400" : "text-red-400"}`}>Partition check: {bt.backtest.totals.burnEvents} + {btB.backtest.totals.burnEvents} = {bt.backtest.totals.events - bt.backtest.totals.voids} settled game(s)? {partition ? "yes — every settlement burns exactly one side" : "no — check the rule"}{bt.backtest.oneShot ? ` · this game settles once (market closes by ${denver(bt.backtest.oneShot.resolvesOn)} Denver); nothing to back-test until then` : ""}</p>}
                {(bt.refusals.length > 0 || btB.refusals.length > 0) && <p className="md:col-span-2 text-red-400">REFUSED: {[...bt.refusals, ...btB.refusals].map((r) => r.reason).join("; ")}</p>}
              </div>
            );
          })()}
          <details className={card + " text-sm"}><summary className="cursor-pointer text-neutral-300">Edit the rule</summary>
            <label className="block mt-2">Each burn spends {pct(fraction)} of that coin&apos;s burn pool <input type="range" min={0.01} max={0.1} step={0.005} value={fraction} onChange={(e) => setFraction(Number(e.target.value))} className="w-full" /></label>
            <p className="text-xs text-neutral-400">{season ? <>${ticker}: every <code>{game?.seriesTicker}</code> market containing <code>-{sideA.abbr}</code>, burns on NO · ${tickerB}: every market containing <code>-{sideB.abbr}</code>, burns on NO.</> : <>Both coins read one market, <code>{sideA.marketTicker}</code>: ${ticker} burns when it settles NO, ${tickerB} when it settles YES.</>} $1 spend floor, 0.02 SOL reserve, a voided game burns nothing.</p>
          </details>
          {navRow("Next: review →", !btFresh || !bt || !btB || bt.refusals.length > 0 || btB.refusals.length > 0)}
        </section>
      )}

      {/* ---------------------------------------------------------------- ANY MARKET ---------------------------------------------------------------- */}
      {flow === "single" && step === "pick" && (
        <section className="space-y-4">
          <div className={card + " space-y-3"}>
            <h2 className="font-medium">Search Kalshi and Polymarket by name</h2>
            <input autoFocus className={input + " text-base py-2"} placeholder="a team, a player, a person, a show, a city, an election…" value={q2} onChange={(e) => setQ2(e.target.value)} />
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
                        <ul className="mt-1 text-xs text-neutral-400 space-y-0.5">{e.markets.map((m) => <li key={m.conditionId} className="flex items-center justify-between gap-2"><span>{m.question} <span className="text-neutral-500">(YES = {m.yes}, NO = {m.no})</span></span><button className="underline" onClick={() => pickPoly(m)}>burn on this market →</button></li>)}</ul>
                        {e.marketCount > 1 && <button className="mt-1 text-xs underline" onClick={() => pickPolySeries(`event:${e.slug}`, e.title)}>every market of this event ({e.marketCount}) →</button>}
                      </>}
                    </div>
                  ))}
                  {pm.tags.length > 0 && <div className="text-xs text-neutral-400"><span className="text-neutral-500">Recurring on Polymarket:</span> {pm.tags.flatMap((t) => t.series.map((sr) => <button key={sr} className="mr-2 underline" onClick={() => pickPolySeries(sr, `${t.label}${sr.endsWith("/moneyline") ? " games (moneyline)" : ""}`)}>{sr.endsWith("/moneyline") ? `every ${t.label} game` : `every ${t.label} market`}</button>))}</div>}
                  {polyErr && <p className="text-xs text-neutral-500">Polymarket is not answering right now ({polyErr}).</p>}
                </div>
              );
              const none = !found.events.length && !found.results.length && !(pm && (pm.events.length || pm.markets.length));
              return <div className="space-y-4">{found.ranking === "events" ? [evs, ser] : [ser, evs]}{poly}{none && <p className="text-sm text-neutral-500">Nothing on Kalshi or Polymarket matches “{q2}”. Try a team, a city, a series ticker (KXCPI), or a person&apos;s last name.</p>}<p className="text-xs text-neutral-600">Team coins and matchup pairs use Kalshi&apos;s per-team game markets; a Polymarket game is one market whose YES is whichever team its title lists first.</p></div>;
            })()}
          </div>
          {navRow(null)}
        </section>
      )}

      {/* ---------------------------------------------------------------- ADVANCED ---------------------------------------------------------------- */}
      {flow === "feed" && step === "pick" && (
        <section className="space-y-4">
          <div className={card}>
            <h2 className="font-medium">Custom Kalshi selector (tier 1, settled results only)</h2>
            <input className={input + " mt-2"} placeholder="search Kalshi series: NFL, CPI, Denver temperature, S&P, election…" value={q} onChange={(e) => setQ(e.target.value)} />
            <ul className="mt-2 divide-y divide-neutral-800 max-h-72 overflow-y-auto">{hits.map((h) => (
              <li key={h.ticker} className="py-2 flex items-start justify-between gap-2"><div><div className="text-sm"><code>{h.ticker}</code> {h.title}</div><div className="text-xs text-neutral-500">{h.category} · {h.frequency ?? "—"} · settles by {h.settlementSource?.name ?? "Kalshi"}{h.refused.length ? ` · REFUSED: ${h.refused.join("; ")}` : ""}</div></div>
                {h.refused.length === 0 && <button className="text-xs underline" onClick={() => { setPick({ oracle: "kalshi", series: h.ticker, market: null, title: h.title }); next(); }}>every market in this series →</button>}</li>
            ))}</ul>
            <p className="text-xs text-neutral-500 mt-2">One specific market instead? Paste its ticker: <input className={input + " inline w-80 ml-1"} placeholder="KXNFLGAME-26OCT11PHIJAC-PHI" onKeyDown={(e) => { const v = (e.target as HTMLInputElement).value.trim().toUpperCase(); if (e.key === "Enter" && v) { setPick({ oracle: "kalshi", series: null, market: v, title: `market ${v} (resolves once)` }); next(); } }} /></p>
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
      {(flow === "single" || flow === "feed") && step === "rule" && pick && rule && (
        <section className="space-y-4">
          <div className={card}><div className="text-sm">Market: <strong>{pick.title}</strong>{pick.oracle !== "catalogue" && chip(pick.oracle)} <span className="text-neutral-500">({pick.oracle === "kalshi" ? (pick.market ? `market ${pick.market}` : `series ${pick.series}`) : pick.oracle === "polymarket" ? (pick.market ? `condition ${pick.market.slice(0, 10)}…` : pick.series) : `source ${pick.series}`})</span></div>
            {pick.oracle === "kalshi" && !pick.market && <label className="block text-xs mt-2">Only markets whose ticker contains <input className={input + " inline w-40 ml-1"} placeholder="-DEN" value={filter} onChange={(e) => setFilter(e.target.value)} /> <span className="text-neutral-500">(optional; &quot;-DEN&quot; = Denver&apos;s own leg — the back-test lists what matched)</span></label>}
            {pick.oracle === "polymarket" && !pick.market && <label className="block text-xs mt-2">Only markets whose question matches <input className={input + " inline w-56 ml-1 font-mono"} placeholder="^[^:]+ vs\. [^:]+$" value={filter} onChange={(e) => setFilter(e.target.value)} /> <span className="text-neutral-500">(optional regular expression; the back-test lists what matched)</span></label>}
            {pick.oracle === "polymarket" && <p className="text-xs text-neutral-400 mt-2">{pick.market ? `YES = ${pick.yes ?? "the first outcome"}, NO = ${pick.no ?? "the second outcome"}.` : "YES = each market's first outcome, NO its second (for a game: the team its title lists first, which changes from game to game)."} The result is the payout Polygon&apos;s Conditional Tokens contract records; a 50-50 resolution burns nothing.</p>}
          </div>
          <div className={card + " space-y-3"}>
            {pick.oracle !== "catalogue" && kind === "binary" && <label className="block text-sm">Burn when it settles <select className={input + " inline w-48 ml-1"} value={burnOn} onChange={(e) => setBurnOn(e.target.value as "yes" | "no")}><option value="yes">YES{pick.yes ? ` (${pick.yes})` : ""}</option><option value="no">NO{pick.no ? ` (${pick.no})` : ""}</option></select></label>}
            {pick.oracle !== "catalogue" && kind === "binary" && <label className="block text-sm">Each burn spends {mode === "buyback" ? pct(onYes) : `${tokensYes.toLocaleString()} tokens`} {mode === "buyback" ? "of the burn pool" : ""}
              {mode === "buyback" ? <input type="range" min={0.01} max={0.1} step={0.005} value={onYes} onChange={(e) => setOnYes(Number(e.target.value))} className="w-full" /> : <input type="range" min={100000} max={20000000} step={100000} value={tokensYes} onChange={(e) => setTokensYes(Number(e.target.value))} className="w-full" />}</label>}
            <details className="text-sm"><summary className="cursor-pointer text-neutral-300">More options</summary>
              <div className="mt-2 space-y-3">
                <div className="flex gap-4 flex-wrap">
                  {pick.oracle === "kalshi" && <label>Read the result as <select className={input + " inline w-32 ml-1"} value={kind} onChange={(e) => setKind(e.target.value as "binary" | "scalar")}><option value="binary">yes / no</option><option value="scalar">a number</option></select></label>}
                  <label>Burn from <select className={input + " inline w-40 ml-1"} value={mode} onChange={(e) => setMode(e.target.value as "buyback" | "vault")}><option value="buyback">the fee pool (buyback)</option><option value="vault">a vesting vault</option></select></label>
                </div>
                {mode === "vault" && <label className="block">Vault share of supply: {pct(vaultShare)} <input type="range" min={0.1} max={0.3} step={0.01} value={vaultShare} onChange={(e) => setVaultShare(Number(e.target.value))} className="w-full" /></label>}
                {pick.oracle !== "catalogue" && kind === "binary" && <label className="block"><input type="checkbox" checked={onNoEnabled} onChange={(e) => setOnNoEnabled(e.target.checked)} /> also burn on {burnOn === "yes" ? "NO" : "YES"}{onNoEnabled && mode === "buyback" && <>: {pct(onNo)} <input type="range" min={0.01} max={0.1} step={0.005} value={onNo} onChange={(e) => setOnNo(Number(e.target.value))} className="w-full" /></>}</label>}
                {(kind === "scalar" || pick.oracle === "catalogue") && <>
                  {pick.oracle === "kalshi" && <>
                    <label className="block">Unit size: <input className={input + " inline w-28 ml-1"} type="number" step="any" value={unit} onChange={(e) => setUnit(Number(e.target.value))} /></label>
                    <label className="block">Baseline: <select className={input + " inline w-48 ml-1"} value={baseline === "previousSettlement" ? "prev" : "fixed"} onChange={(e) => setBaseline(e.target.value === "prev" ? "previousSettlement" : 0)}><option value="prev">the previous settlement</option><option value="fixed">a fixed number</option></select>{baseline !== "previousSettlement" && <input className={input + " inline w-28 ml-1"} type="number" step="any" value={baseline} onChange={(e) => setBaseline(Number(e.target.value))} />}</label>
                    <label className="block">Direction: <select className={input + " inline w-40 ml-1"} value={direction} onChange={(e) => setDirection(e.target.value as "up" | "down" | "abs")}><option value="up">up (above)</option><option value="down">down (below)</option><option value="abs">either way</option></select></label>
                  </>}
                  {pick.oracle === "catalogue" && pick.source && <p className="text-xs text-neutral-400">Fixed by the source: unit {pick.source.unit?.label} ({pick.source.unit?.definition}); direction {pick.source.direction}; baseline {String(pick.source.baseline)}.</p>}
                  <label className="block">Per unit: {mode === "buyback" ? `spend ${pct(perUnit)} of the pool (compounding)` : `burn ${tokensYes.toLocaleString()} tokens`}
                    {mode === "buyback" ? <input type="range" min={0.01} max={0.1} step={0.005} value={perUnit} onChange={(e) => setPerUnit(Number(e.target.value))} className="w-full" /> : <input type="range" min={100000} max={20000000} step={100000} value={tokensYes} onChange={(e) => setTokensYes(Number(e.target.value))} className="w-full" />}</label>
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

      {(flow === "single" || flow === "feed") && step === "name" && (
        <section className={card + " space-y-2 text-sm"}>
          <label className="block">Name <input className={input} maxLength={32} value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label className="block">Ticker (2–10 letters or digits) <input className={input} maxLength={10} value={ticker} onChange={(e) => setTicker(e.target.value.toUpperCase())} /></label>
          <label className="block">One line about it (optional) <input className={input} maxLength={400} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
          <label className="block">Image link (optional, https) <input className={input} value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} /></label>
          <label className="block">Link (optional, https) <input className={input} value={link} onChange={(e) => setLink(e.target.value)} /></label>
          {navRow("Next: review →", !name.trim() || !okTicker(ticker))}
        </section>
      )}

      {/* ---------------------------------------------------------------- REVIEW (every flow) ---------------------------------------------------------------- */}
      {step === "review" && rule && (
        <section className="space-y-3 text-sm">
          <div className="rounded-xl border border-amber-400/60 bg-neutral-900 p-4 space-y-2">
            <h2 className="text-lg font-semibold">In plain words</h2>
            {flow === "team" && team ? <p className="text-base">{teamCoinSentence(team.nickname ?? team.name, ticker, winLose, fraction)}</p>
              : pairOn && sideA && sideB ? <>
                <p className="text-base">{season
                  ? `Every time the ${sideA.nickname ?? sideA.name} lose, $${ticker} buys itself back with its own fees and burns it. Every time the ${sideB.nickname ?? sideB.name} lose, $${tickerB} does the same. Two separate coins, two separate records.`
                  : `When ${game?.title} settles, the loser's coin burns: if the ${sideA.nickname ?? sideA.name} lose${game?.pair?.tieMarket ? " (or draw)" : ""}, $${ticker} buys itself back with its own fees and burns it; if they win, $${tickerB} does. Exactly one coin burns.`}</p>
                <p>Rules locked forever. You earn nothing from fees. All LP burned.</p>
              </> : <p className="text-base">{btFresh && bt ? bt.statement : "…"} Rule locked forever. You earn nothing from fees. All LP burned.</p>}
            {flow === "team" && team && <p className="text-neutral-400">This season so far the {team.nickname ?? team.name} are {record(team)}: that would have been {winLose === "win" ? team.record.w : team.record.l} burn(s).{btFresh && bt ? ` Last 12 months on Kalshi: ${bt.backtest.totals.burnEvents} burn(s) of ${bt.backtest.totals.events} game(s).` : ""}</p>}
            {btFresh && bt?.refusals.length ? <p className="text-red-400">REFUSED: {bt.refusals.map((r) => r.reason).join("; ")}</p> : null}
          </div>
          <details className={card}><summary className="cursor-pointer text-neutral-300">Details: the exact rule{pairOn ? "s" : ""}, the receipt format, fees</summary>
            <div className="mt-2 space-y-3">
              {[["$" + (ticker || "TICKER"), btFresh ? bt : null, rule] as const, ...(pairOn && ruleB ? [["$" + (tickerB || "B"), btFresh ? btB : null, ruleB] as const] : [])].map(([label, b, r]) => (
                <div key={label}><div className="text-xs text-neutral-400">{label}{b ? ` · sha256 ${b.sha256}` : ""}</div>{b && <p className="text-xs">{b.statement}</p>}<pre className="text-xs bg-neutral-950 border border-neutral-800 rounded p-2 overflow-x-auto mt-1">{b?.text ?? JSON.stringify(r, null, 2)}</pre></div>
              ))}
              {pairOn && !season && <p className="text-xs text-neutral-500">A registered rivalry pair: the pairId is added to both canonical rules at launch, each side hashed on its own; two bundles signed in sequence (A first). Pair page: /burnticker/p/&lt;pairId&gt;.</p>}
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
            <div className="flex items-center gap-2 flex-wrap"><WalletMultiButton /><input className={input + " w-72"} placeholder="or paste your wallet address (sign later)" value={pasted} onChange={(e) => setPasted(e.target.value)} /></div>
            <label className="block"><input type="checkbox" checked={ackLocked} onChange={(e) => setAckLocked(e.target.checked)} /> I understand {pairOn ? "neither rule can" : "the rule can never"} be changed, by anyone.</label>
            <label className="block"><input type="checkbox" checked={ackNoReturns} onChange={(e) => setAckNoReturns(e.target.checked)} /> I won&apos;t promise anyone anything about price or returns.</label>
            <details className="text-xs text-neutral-400"><summary className="cursor-pointer">Optional first buy</summary><label className="block mt-1">SOL (≤ 50): <input className={input + " inline w-28 ml-1"} value={firstBuy} onChange={(e) => setFirstBuy(e.target.value)} /></label></details>
            {launchErr && <p className="text-red-400">{launchErr}</p>}
            <div className="flex items-center gap-3 pt-1"><button className="text-sm underline" onClick={back}>← Back</button><button className={primary} disabled={!ackLocked || !ackNoReturns || !creator || busy || (btFresh && !!bt?.refusals.length)} onClick={launch}>{busy ? "building…" : pairOn ? "Build both launch bundles" : "Build the launch bundle"}</button>{!creator && <span className="text-xs text-neutral-500">connect a wallet or paste an address first</span>}</div>
          </div>
        </section>
      )}

      {step === "launch" && bundle && (() => {
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
            {pairOut ? <>
              <div className={card}><h2 className="font-medium">{pairOut.pairId ? <>Rivalry pair <code>{pairOut.pairId}</code></> : <>Two coins, every game this season</>}</h2><p className="text-xs text-neutral-400">{pairOut.pairId ? "Sign side A's bundle first, then side B's (B's rule names A's mint as counterpart)." : "Two independent launches: sign each bundle."}</p><ul className="list-disc pl-5 text-xs text-neutral-400">{pairOut.notes.map((n) => <li key={n}>{n}</li>)}</ul></div>
              {bundleCard(pairOut.a, ticker, "1 · ")}{bundleCard(pairOut.b, tickerB, "2 · ")}
              <p>{pairOut.pairId && <><Link className="underline" href={`/burnticker/p/${pairOut.pairId}`}>Open the pair page →</Link> · </>}<Link className="underline" href={`/burnticker/t/${ticker}`}>${ticker}</Link> · <Link className="underline" href={`/burnticker/t/${tickerB}`}>${tickerB}</Link></p>
            </> : <>
              {bundleCard(bundle, ticker, "")}
              <p><Link className="underline" href={`/burnticker/t/${ticker}`}>Open the token page →</Link> (it shows the draft; the receipts table fills itself once live)</p>
            </>}
          </section>
        );
      })()}
    </main>
  );
}
