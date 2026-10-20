"use client";

import { PAIR_CHECK_TIMEOUT_MS, PAST_BURNS_HEADING, coinVsCardWords, pairUpfrontLines, pastBurnsLines, upfrontLines } from "@/lib/burnticker/guidedLaunch";
import { coinCanonicalHref } from "@/lib/burnticker/coinKey";
import { useEffect, useMemo, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { FieldHelp } from "../_components/FieldHelp";
import { ruleOneLiner } from "@/lib/burnticker/coinCard";
import { ReviewCard } from "./ReviewCard";
import type { BurnRule } from "@/lib/burnticker/rules";
import type { DerbyUnderlying } from "@/lib/burnticker/derby/spec";
import { fightLead, sha256HexWeb, tileHashInput, tileRule, type TileChoice } from "@/lib/burnticker/derby/tile";
import { DERBY_RUN_PRESETS, runPresetLabel } from "@/lib/burnticker/derby/spec";
import { rivalryById, type RivalryTemplate } from "@/lib/burnticker/templates";
import { SimulatorDisclosure } from "./SimulatorDisclosure";
import { postPairLaunch, venueFrom409, type PairVenue } from "@/lib/burnticker/pairLaunchClient";
import type { PairCurveLaunchBundle } from "@/lib/burnticker/pairCurveLaunch";
import { SignCard } from "./SignCard";
import { MintAddressBlock, useMintPool } from "./MintSearch";
import { base58, secretBase58, serverKeyFor, withLocalKey, withMintSource, withServerKey, MINT_MISMATCH_LINE, type GroundMint } from "@/lib/burnticker/vanityMint";
import { requireLaunchProof, sendWithProofFallback, walletPromptCount } from "@/lib/burnticker/walletProof";
import { launchlabPlan, pairCurvePlan, withPlanDeadline } from "@/lib/burnticker/signPlan";
import type { SerializedIx } from "@/lib/burnticker/program";
import { PAIR_REVIEW_LINE, winnerTakesBurnFacts } from "@/lib/burnticker/describe";
import { draftRevision, EMPTY_REVIEW_SLOT, reviewAnswered, reviewFor, reviewMatchesDraft, reviewRequested, REVIEW_UPDATING, type ReviewSlot } from "@/lib/burnticker/launchReviewSync";
import { derbyExplainer } from "@/lib/burnticker/launchDerby";
import { PreWalletSummary } from "./PreWalletSummary";
import type { LaunchReview } from "@/lib/burnticker/launchReview";
import { DEFAULT_RAISE_SOL, DEFAULT_SHARE, LINKED_ONE_SHOT_LINE, linkedShareMigratedNotice, RAISE_PRESETS_SOL, SHARE_PRESETS, type RaisePreset } from "@/lib/burnticker/launchPresets";
import { asLinkedPairSide, coinvsEndsLine, derbyShareLine, endSentences, pairIdentityProblems, patternOptions, IMAGE_NOT_KEPT, FACT_LABELS, GUIDED_STEPS, IMAGE_RIGHTS_REQUIRED, PAIR_COST_EXCLUSIONS, budgetCopy, costLine, shareExample, shareOfBudgetLine, triggerText, whichCoinLine, whichHeading, pairDiagramLabel, recordCloseAvailability } from "@/lib/burnticker/guidedLaunch";
import { PatternStep, StickyAction, type GuidedPhase } from "./GuidedSteps";
import { edgeCase } from "@/lib/burnticker/ruleEdgeCases";
import { createLatest } from "@/lib/burnticker/latestOnly";
import { fingerprintFor, prepareIfCurrent, profileRevision, startFingerprint, STALE_PREPARE_SENTENCE, type Fingerprint } from "@/lib/burnticker/preparedLaunch";
import { preparedRulesCheckWeb, PREPARED_MISSING_LINE } from "@/lib/burnticker/preparedRules";
import { deepLinkPick, deepLinkQuery, editedFrom, generatedNames, pickerNote, searchToken, visibleHits, NONE_EDITED, type EditedFields } from "@/lib/burnticker/coinPicker";
import { EMPTY_PROFILE, ProfileFields, chosenPreview, profileBody, type ProfileValue } from "./ProfileFields";
import { NAME_STEP_BLOCKED, fieldRuleSentence, isLintLine, profileIssues, serverFieldProblems } from "./fieldChecks";
import { pairCostSentence } from "./pageCopy";
import type { TickerCheck } from "@/lib/burnticker/tickerCheck";
import { describeRule, endText } from "@/lib/burnticker/describe";
import { highText, type HighBaseline, type HighSpan, type HighSpec } from "@/lib/burnticker/derby/high";
import { HIGH_CHOICE_LABEL, HIGH_CHOICE_LINE, HIGH_NEW_DAY, HIGH_PATTERNS, HIGH_PICKER_LABEL, HIGH_PYTH_ONLY, HIGH_READING, HIGH_RUN_NOTE, HIGH_SPAN_CHOICES, HIGH_SPAN_LABEL, PAIR_CHOICE_LABEL, PAIR_CHOICE_LINE, highBlock, highGreyed, highHashInput, highRule, highShares } from "@/lib/burnticker/derby/highTile";
import { LaunchRequestError, launchErrorMessage, type LaunchErrorBody } from "@/lib/burnticker/pairLaunchClient";
import { targetActionSentence } from "@/lib/burnticker/burnTarget";
import { BurnRealChoice } from "./BurnRealChoice";
import { derbyReadOnlySentence } from "@/lib/burnticker/derby/spec";
import { SIDE_REAL_OFF, realBlockers, realField, realNotOffered, realPickFor, realReadSentence, realReviewNotes, withRealBurn, type SideReal } from "./burnReal";
/** HB-53 (sixth pass): the Unusual-cases block on Coin comparison reviews, pair curve included: ties, a missing last day, drafts across midnight, one coin under two names, pools opening apart, the fingerprint. */
const COINVS_EDGE_IDS = { race: [69, 70, 72, 74, 76, 174], flip: [66, 70, 74, 76, 174], single: [70, 72, 174] } as const;

/**
 * "COIN VS COIN" — the Burn Derby wizard tile (2026-10-10; cut to presets the same day, the owner: "the UI needs to be simpler, even if it
 * means giving up a little bit of adjustability"). Pick two coins (Pyth's catalogue + Jupiter's token list, through
 * GET /api/burnticker/v1/derby/search) → the review card (ReviewCard.tsx: generated art, names, the sentence, "runs for 30 days, then
 * winds down", 2 / 5 / 10 %) → Launch. Daily windows are fixed here and the run is 7, 14 or 30 days (website-26); weekly windows, other lengths and brackets are
 * API-only (POST /api/burnticker/v1/launch/bundle with a derby rule). The flippening is its own template (?template=flippening), never
 * a checkbox. Launch posts the pair to /api/burnticker/launch — side A on "A wins", side B derived by inversion.
 */

/** website-22 (audit 10 item 22): the cross-read named in words ("checked against Jupiter"), never its key ("cross-read jup"). */
const lower1 = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);
export const crossName = (cross: string | null | undefined): string => {
  const k = (cross ?? "").split(":")[0];
  return k === "jup" ? "Jupiter" : k === "dexscreener" ? "DexScreener" : k === "redstone" ? "RedStone" : "a second source";
};
/**
 * launch night 2026-10-13 (hunt): a picked reference coin's source in whole sentences ("BONK Pyth feed, Jupiter's quote … is read" ran a
 * label into a sentence; "pool TWAP" was shorthand).
 */
export const refSourceLine = (pyth: boolean, crossLine: string | null, cross: string): string => {
  const first = pyth ? "Read from its Pyth feed." : "Read from its pool, averaged over time.";
  const second = crossLine ? (/[.!?]$/.test(crossLine.trim()) ? crossLine.trim() : `${crossLine.trim()}.`) : `Checked against ${cross}.`;
  return `${first} ${second}`;
};

/** The Coin vs Coin draft in sessionStorage, version 1 (intent audit 5 item 19). */
export const CVC_STORE = "burnticker.launch.cvc.v1";
/** `edited`: per field since launch audit 248 (an older draft's single boolean is read by editedFrom); `images`: whether an image was chosen (the image itself is never kept; launch audit 227); `shares`: website-20 item 55, the share per mode */
interface CvcDraft { v: 1; a: Hit | null; b: Hit | null; names: { a: string; b: string; ta: string; tb: string }; fraction: number; shares?: { daily: number; flip: number }; flip: boolean; raiseSol: string; edited: EditedFields | boolean; profA: Partial<ProfileValue>; profB: Partial<ProfileValue>; images?: { a: boolean; b: boolean }; /** website-26: the run length (7, 14 or 30 days) */ seasonDays?: number }
/** website-26 (WIRING-FEATURES item 13): a pre-made rivalry's two reference coins as picked search results. */
export function rivalryHits(r: RivalryTemplate): { a: Hit; b: Hit } {
  const hit = (u: RivalryTemplate["a"]): Hit => ({ symbol: u.symbol, name: u.symbol, source: "pyth", assetType: "crypto", feed: u.pyth, mint: u.mint, liquidityUsd: null, verified: true, underlying: u, why: null });
  return { a: hit(r.a), b: hit(r.b) };
}
/** website-26 (WIRING-FEATURES item 14): the run lengths the tile offers; anything else falls back to 30 days. */
export const runDaysOf = (v: unknown): number => ((DERBY_RUN_PRESETS as readonly number[]).includes(v as number) ? (v as number) : 30);
interface Hit { symbol: string; name: string; source: "pyth" | "jupiter"; assetType: string; feed: string | null; mint: string | null; liquidityUsd: number | null; verified: boolean; underlying: DerbyUnderlying | null; why: string | null; /** sources-6 (QA 9 #32): the result line ("WIF · EKpQ…zcjm · $12.3M liquidity · verified") and the cross-read in words */ label?: string; crossLine?: string }
interface Bundle { mint: string; ticker: string; ready: boolean; pending: string[]; mintSecretKey: string | null; rules: { text: string; sha256: string; statement: string }; transactions: { label: string; signers: string[]; instructions: SerializedIx[] }[] }

/**
 * One side's coin search (launch audit 241–246, coinPicker.ts): the other side's coin is excluded by asset, a deep link picks by itself
 * only when one asset answers, a query under 2 characters cancels any search in flight, and the line under the box says what to do next.
 */
function CoinPicker({ label, value, onPick, exclude, initial, locked = false }: { label: string; value: Hit | null; onPick: (h: Hit | null) => void; exclude: Hit | null; initial?: string; /** launch integrity 252: no change while a launch is prepared or signed */ locked?: boolean }) {
  const [q, setQ] = useState(initial ?? ""), [hits, setHits] = useState<Hit[]>([]), [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null), [searched, setSearched] = useState(false);
  const [ambiguous, setAmbiguous] = useState<Hit[]>([]);
  // walkthrough snag 6: a link that names a coin (?derby=1&a=SOL&b=ETH) selects it once its search answers, not only types it
  const autoPicked = useRef(false);
  useEffect(() => {
    if (autoPicked.current || value || !initial) return;
    const r = deepLinkPick(hits, initial, exclude);
    if (r.pick) { autoPicked.current = true; onPick(r.pick); } else setAmbiguous(r.ambiguous);
  }, [hits]); // eslint-disable-line react-hooks/exhaustive-deps
  // intent audit item 12: only the answer to the latest query is shown; a query under 2 characters makes every answer in flight stale
  const latest = useRef(createLatest()).current;
  useEffect(() => {
    const s = q.trim();
    const my = searchToken(latest, q);
    if (my === null) { setHits([]); setBusy(false); setErr(null); setSearched(false); return; }
    setHits([]); setSearched(false);
    const t = setTimeout(() => {
      setBusy(true); setErr(null);
      fetch(`/api/burnticker/v1/derby/search?q=${encodeURIComponent(s)}&assets=all`).then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? r.statusText); if (latest.isCurrent(my)) { setHits(j.hits ?? []); setSearched(true); } }).catch((e) => { if (latest.isCurrent(my)) setErr(String(e.message ?? e)); }).finally(() => { if (latest.isCurrent(my)) setBusy(false); });
    }, 300);
    return () => clearTimeout(t);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  if (value) return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-3 text-sm flex items-center justify-between gap-2">
      <div><div className="text-xs text-neutral-400">{label}</div><div className="font-semibold">{value.symbol} <span className="text-xs text-neutral-500 font-normal">{refSourceLine(value.source === "pyth", value.crossLine ?? null, crossName(value.underlying?.cross))}</span></div></div>
      {!locked && <button className="text-xs underline" data-decision="what" aria-label={`Change the ${lower1(label)}`} onClick={() => onPick(null)}>change</button>}
    </div>
  );
  const shown = visibleHits(hits, exclude);
  const note = pickerNote({ query: q, searched, busy, error: err, hits, exclude, ambiguous: q.trim() === (initial ?? "").trim() ? ambiguous : [] });
  return (
    <div className="space-y-2">
      <label className="block text-xs text-neutral-400">{label}<FieldHelp id="derby-coin" /><input data-help="derby-coin" data-decision="what" aria-label={`Search for the ${lower1(label)}`} className="mt-1 w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm" placeholder="a ticker, a name or a mint — WIF, BONK, SHIB…" value={q} onChange={(e) => setQ(e.target.value)} /></label>
      {busy && <p className="text-xs text-neutral-500">Searching…</p>}
      <p className="text-xs text-red-400 empty:hidden" aria-live="polite">{err ?? ""}</p>
      {note && <p className="text-xs text-neutral-400" data-picker-note>{note}</p>}
      <ul className="max-h-56 overflow-y-auto divide-y divide-neutral-800 rounded border border-neutral-800">
        {shown.map((h) => (
          <li key={`${h.source}:${h.feed ?? h.mint}`}>
            {/* continuous audit HB-34: the row's own words name the button */}
            <button type="button" disabled={!h.underlying} data-decision="what" aria-label={`${h.label || `${h.symbol}, ${h.name}`}, from ${h.source === "pyth" ? "Pyth" : "Jupiter"}${h.why ? `. ${h.why}` : ""}`} onClick={() => onPick(h)} className={`w-full text-left px-2 py-1.5 text-sm ${h.underlying ? "hover:bg-neutral-900" : "opacity-60 cursor-not-allowed"}`}>
              {h.label ? <span className="font-medium" data-hit-label>{h.label}</span> : <><span className="font-medium">{h.symbol}</span> <span className="text-xs text-neutral-500">{h.name}</span></>} <span className="ml-1 rounded bg-neutral-800 px-1.5 text-[10px]">{h.source === "pyth" ? "Pyth" : "Jupiter"}</span>
              {h.why && <span className="block text-[11px] text-neutral-500">{h.why}</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * WIRING-SOURCES4 (website-21): A COIN'S RECORD CLOSE, the tile's other choice (derby/high.ts, derby/highTile.ts). One reference coin
 * (the derby search, Pyth feeds only), how far back its record reaches, every record close or once on the next one, then the server's
 * baseline read (POST /v1/derby/high): its refusal is the review's refusal sentence, its line sits under the rule sentence. The block's
 * season starts on the day the baseline was read (UTC); when the UTC day turns the record is read again (derby/admission.ts refuses an
 * older one). One coin, one LaunchLab launch; the same review, prepare latch and gates as every launch.
 */
/** website-22: what the progress strip says for each answered step of the tile. */
export interface TileAnswers { which: string | null; burn: string | null; name: string | null }
function RecordClose({ blocked = null, customImages = true, phase: phaseIn = null, onPhase, onAnswers, initial = "" }: { /** website-25 (WIRING-SOURCES7 H1): the coin a record-close link names (?kind=record-close&a=BTC) */ initial?: string; blocked?: string | null; customImages?: boolean; phase?: GuidedPhase | null; onPhase?: (p: GuidedPhase) => void; onAnswers?: (a: TileAnswers) => void }) {
  const wallet = useWallet();
  const creator = wallet.publicKey?.toBase58() ?? "";
  // 2026-10-14 night: the server's prepared burn-ending address; the tab's one in-browser search (MintSearch.tsx useMintPool, shared with
  // the page and the tile) only when the server has none ready
  const mintPool = useMintPool();
  const [ref, setRef] = useState<Hit | null>(null), [span, setSpan] = useState<HighSpan>("all"), [once, setOnce] = useState(false);
  // each pattern keeps its own share (the recurring row defaults to 2 %, the one-time row to 100 %)
  const [shares, setShares] = useState<{ every: number; once: number }>({ every: highShares(false).fallback, once: highShares(true).fallback });
  const fraction = once ? shares.once : shares.every;
  const setFraction = (v: number) => setShares((x) => (once ? { ...x, once: v } : { ...x, every: v }));
  const [raiseSol, setRaiseSol] = useState<RaisePreset>(DEFAULT_RAISE_SOL);
  const [names, setNames] = useState({ name: "", ticker: "" }), [edited, setEdited] = useState({ name: false, ticker: false });
  const [prof, setProf] = useState<ProfileValue>(EMPTY_PROFILE);
  const [now, setNow] = useState(() => Date.now());
  const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  useEffect(() => { const t = setInterval(() => setNow((n) => (utcDay(Date.now()) !== utcDay(n) ? Date.now() : n)), 60_000); return () => clearInterval(t); }, []);
  const today = utcDay(now);
  const [retry, setRetry] = useState(0), [newDay, setNewDay] = useState(false);
  const firstDay = useRef(today); useEffect(() => { if (firstDay.current !== today) { firstDay.current = today; setNewDay(true); } }, [today]);
  const u = ref?.underlying ?? null;
  const noPyth = !!ref && !u?.pyth;
  const baseKey = u && u.pyth ? `${today}|${span}|${JSON.stringify(u)}|${retry}` : "";
  const [base, setBase] = useState<{ key: string; busy: boolean; baseline: HighBaseline | null; line: string | null; refusal: string | null; error: string | null; today: string | null } | null>(null);
  useEffect(() => {
    if (!baseKey || !u) { setBase(null); return; }
    let live = true;
    setBase({ key: baseKey, busy: true, baseline: null, line: null, refusal: null, error: null, today: null });
    fetch("/api/burnticker/v1/derby/high", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ u, span }) })
      .then(async (r) => { const j = await r.json().catch(() => null); if (!r.ok) throw new Error(j?.error ?? `HTTP ${r.status}`); return j as { today: string; baseline?: HighBaseline; line?: string; refusal?: { reason: string } }; })
      .then((j) => { if (live) setBase({ key: baseKey, busy: false, baseline: j.baseline ?? null, line: j.line ?? null, refusal: j.refusal?.reason ?? null, error: null, today: j.today }); })
      .catch((e) => { if (live) setBase({ key: baseKey, busy: false, baseline: null, line: null, refusal: null, error: String((e as Error).message ?? e), today: null }); });
    return () => { live = false; };
  }, [baseKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const block: HighSpec | null = u && base && base.key === baseKey && base.baseline && base.today ? highBlock({ u, span, once, baseline: base.baseline, nowMs: Date.parse(`${base.today}T12:00:00Z`) }) : null;
  const hashIn = block ? highHashInput(block) : null;
  const [hash, setHash] = useState<{ input: string; hex: string } | null>(null);
  useEffect(() => { if (!hashIn) return; let live = true; void sha256HexWeb(hashIn).then((hex) => { if (live) setHash({ input: hashIn, hex }); }); return () => { live = false; }; }, [hashIn]);
  const rule: BurnRule | null = block && hash && hash.input === hashIn ? highRule(block, hash.hex, fraction) : null;
  const gen = block ? highText(block, "") : null;
  useEffect(() => { if (!gen) return; setNames((n) => ({ name: edited.name ? n.name : gen.name, ticker: edited.ticker ? n.ticker : gen.ticker })); }, [gen?.name, gen?.ticker, edited.name, edited.ticker]); // eslint-disable-line react-hooks/exhaustive-deps
  const text = useMemo(() => { if (!rule) return null; try { return describeRule(rule, { ticker: names.ticker.toUpperCase() || "TICKER" }); } catch { return null; } }, [rule, names.ticker]);
  // the review (POST /v1/launch/review), keyed by the draft's revision; Launch prepares only the reviewed draft
  const [slot, setSlot] = useState<ReviewSlot<LaunchReview>>(EMPTY_REVIEW_SLOT);
  const reviewKey = draftRevision([rule, names, raiseSol, prof.description, profileRevision(prof)]);
  const curRev = useRef(reviewKey); curRev.current = reviewKey;
  const seqRef = useRef(0);
  useEffect(() => {
    if (!rule) return;
    const seq = ++seqRef.current, rev = reviewKey;
    setSlot((x) => reviewRequested(x, rev, seq));
    const t = setTimeout(() => {
      fetch("/api/burnticker/v1/launch/review", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rule, ticker: names.ticker.toUpperCase(), name: names.name, raiseSol, creatorDescription: prof.description, links: profileBody(prof).links }) })
        .then(async (r) => { const j = await r.json().catch(() => null); if (!r.ok) throw new Error(r.status === 403 ? "creator launches are closed on this site" : `the review could not be read (HTTP ${r.status})`); return j as LaunchReview; })
        .then((j) => setSlot((x) => reviewAnswered(x, curRev.current, { rev, seq, review: j })))
        .catch((e) => setSlot((x) => reviewAnswered(x, curRev.current, { rev, seq, error: String((e as Error).message) })));
    }, 400);
    return () => clearTimeout(t);
  }, [reviewKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = reviewFor(slot, reviewKey), reviewCurrent = reviewMatchesDraft(slot, reviewKey);
  // F06 (prelaunch audit 2026-10-18): `at` = when this tile received the prepared plan; the plan's deadline is counted from it
  const [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null), [out, setOut] = useState<{ bundle: Bundle; ticker: string; at: number } | null>(null);
  const signPlan = useMemo(() => (out ? withPlanDeadline(launchlabPlan([out.bundle]), out.at) : null), [out]);
  const launch = async () => {
    if (!rule || !text || !creator || !reviewMatchesDraft(slot, curRev.current)) return;
    // the UTC day turned since the record was read: read it again for a launch today, then the creator presses Launch again
    if (base?.today && utcDay(Date.now()) !== base.today) { setNow(Date.now()); setErr(HIGH_NEW_DAY); return; }
    setBusy(true); setErr(null); setOut(null);
    const sentRev = curRev.current, ticker = names.ticker.toUpperCase();
    const body = { creator, ticker, name: names.name, description: text.paragraph, note: "", imageUrl: null, rule, firstBuySol: "0", raiseSol, acknowledgements: { ruleLocked: true, noReturns: true }, ...profileBody(prof) };
    try {
      // 2026-10-14 night: the server's prepared address that ends in burn (no mint sent); when it has none ready, this browser finds one
      const got = await prepareIfCurrent(sentRev, () => curRev.current, () => withMintSource({ pool: mintPool, n: 1, stale: () => curRev.current !== sentRev, staleLine: STALE_PREPARE_SENTENCE }, async (keys: GroundMint[] | null) => {
        const kA = keys?.[0];
        // prelaunch audit 2026-10-18 A-3: the wallet signs the request (walletProof.ts)
        const walletProof = await requireLaunchProof(wallet.signMessage, { origin: window.location.origin, creator, tickers: [ticker], mints: kA ? [kA.publicKey] : [] }, base58);
        // review of block M: a refused signature is sent once more unsigned (walletProof.ts sendWithProofFallback)
        const j = await sendWithProofFallback({ ...body, ...(kA ? { mint: kA.publicKey } : {}), ...(walletProof ? { walletProof } : {}) }, async (sent) => {
          const r = await fetch("/api/burnticker/launch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(sent) });
          const got = await r.json().catch(() => null);
          if (!r.ok) throw new LaunchRequestError(r.status, got?.code ?? null, launchErrorMessage(r.status, got as LaunchErrorBody | null, r.headers.get("retry-after")));
          return got;
        });
        if (kA) mintPool?.consume(kA.publicKey);
        return { bundle: (j as { bundle: Bundle }).bundle, kA };
      }));
      if ("stale" in got) { setErr(STALE_PREPARE_SENTENCE); return; }
      setOut({ bundle: got.ok.kA ? withLocalKey(got.ok.bundle, got.ok.kA) : withServerKey(got.ok.bundle), ticker, at: Date.now() });
    } catch (e) { setErr(String((e as Error).message ?? e)); } finally { setBusy(false); }
  };
  const sh = highShares(once);
  const ready = !!rule && /^[A-Z0-9]{2,10}$/.test(names.ticker.toUpperCase()) && !!names.name.trim();
  const greyed = highGreyed(rule);
  // website-22 (QA 9 item 38, audit 10 item 13): the record close walks the real steps too (which coin, how it burns, name, review)
  useEffect(() => { onAnswers?.({ which: ref?.symbol ?? null, burn: once ? HIGH_PATTERNS.once.label.toLowerCase() : HIGH_PATTERNS.every.label.toLowerCase(), name: names.ticker ? `$${names.ticker.toUpperCase()}` : null }); }, [ref?.symbol, once, names.ticker]); // eslint-disable-line react-hooks/exhaustive-deps
  const phase: GuidedPhase = phaseIn && phaseIn !== "follow" ? phaseIn : "which";
  {
    const coin = { key: "a", name: names.name, ticker: names.ticker, onName: (v: string) => { setEdited((e) => ({ ...e, name: true })); setNames((n) => ({ ...n, name: v })); }, onTicker: (v: string) => { setEdited((e) => ({ ...e, ticker: true })); setNames((n) => ({ ...n, ticker: v })); }, image: prof.image ? chosenPreview(prof)! : art(rule, names.ticker), oneLiner: text?.oneLiner ?? "", oracle: "derby", badge: text?.badge ?? null, nameIssue: fieldRuleSentence("name", names.name), tickerIssue: fieldRuleSentence("ticker", names.ticker) };
    // website-25 (QA 11 H5): every field rule runs on the name step and keeps Review disabled; the server's field problems join them
    const genH = reviewCurrent ? shown.review?.coins?.[0]?.description ?? null : null, issuesH = profileIssues(prof, genH);
    const saidH = new Set([coin.nameIssue, coin.tickerIssue, ...issuesH.map((x) => x.text)].filter((x): x is string => !!x).map((x) => x.replace(/\.$/, "").toLowerCase()));
    const serverH = reviewCurrent ? serverFieldProblems(shown.review?.problems ?? [], saidH) : [];
    const blockersH = [...issuesH.map((x) => ({ text: x.text, edit: () => onPhase?.("name") })), ...serverH.map((x) => ({ text: x.text, edit: () => onPhase?.("name") }))];
    const rightsH = !!prof.image && !prof.rights, nameBlockedH = rightsH || !ready || blockersH.length > 0 || !!coin.nameIssue || !!coin.tickerIssue;
    const next = (label: string, to: GuidedPhase, disabled = false, why: string | null = null) => <StickyAction>{why && <p className="mb-1 text-xs text-amber-300" role="status">{why}</p>}<button type="button" data-nav disabled={disabled} className="w-full rounded bg-amber-400 px-4 py-2 text-sm font-medium text-neutral-950 disabled:opacity-40 sm:w-auto" onClick={() => onPhase?.(to)}>{label}</button></StickyAction>;
    const status = <>{newDay && <p className="text-xs text-amber-300" role="status" data-high-new-day>{HIGH_NEW_DAY}</p>}{base?.busy && <p className="text-xs text-neutral-400" role="status">{HIGH_READING}</p>}{base && !base.busy && base.error && <p className="text-xs text-amber-300" role="status" data-high-unread>The daily closes could not be read just now. <button type="button" data-nav className="underline" onClick={() => setRetry((n) => n + 1)}>Retry</button><span className="block break-words font-mono text-neutral-500">{base.error}</span></p>}{base && !base.busy && base.refusal && <p className="rounded border border-amber-400/50 p-2 text-sm text-amber-200" role="alert" data-high-refusal>{base.refusal}</p>}</>;
    if (phase === "which") return (
      <div className="space-y-3" data-record-close data-guided-phase="which">
        <div className="min-w-0 max-w-md"><CoinPicker key={`high-${initial}`} initial={initial} label={HIGH_PICKER_LABEL} value={ref} onPick={(h) => { setRef(h); setNewDay(false); }} exclude={null} locked={busy || !!out} /></div>
        {noPyth && <p className="text-xs text-amber-300" role="status" data-high-no-pyth>{HIGH_PYTH_ONLY}</p>}
        <div className="flex min-w-0 flex-wrap items-center gap-2" role="radiogroup" aria-label={HIGH_SPAN_LABEL} data-high-span>
          <span className="text-xs text-neutral-400" aria-hidden="true">{HIGH_SPAN_LABEL}</span>
          {HIGH_SPAN_CHOICES.map((c) => <button key={String(c.span)} type="button" role="radio" aria-checked={span === c.span} data-decision="what" disabled={busy || !!out} onClick={() => setSpan(c.span)} className={`rounded-full border px-3 py-1 text-sm ${span === c.span ? "border-amber-400 bg-amber-400 text-neutral-950" : "border-neutral-700"}`}>{c.label}</button>)}
        </div>
        {status}
        {next("Next", "burn", !rule)}
      </div>
    );
    if (phase === "burn") return (
      <PatternStep preview={<p>{text?.lead ?? HIGH_READING}</p>} options={[...([false, true] as const).map((o) => ({ id: (o ? "once" : "every") as "once" | "every", label: (o ? HIGH_PATTERNS.once : HIGH_PATTERNS.every).label, sentence: (o ? HIGH_PATTERNS.once : HIGH_PATTERNS.every).line, available: true, reason: null })), ...greyed.map((g) => ({ id: g.id as "fade" | "winner", label: g.label, sentence: "", available: false, reason: g.reason }))]}
        value={once ? "once" : "every"} onPick={(id) => setOnce(id === "once")} shares={sh.options} share={fraction} onShare={setFraction} next={next("Next", "name", !rule)} extra={status} />
    );
    if (!rule || !text) return <div className="space-y-3" data-record-close>{status}{next("Back to the coin", "which")}</div>;
    if (phase === "name") return (
      <ReviewCard mode="name" coins={[coin]} sentence={text.lead} ends={null} shares={{ options: [...sh.options], value: fraction, onChange: () => {} }} problems={[]} error={null} busy={false} ready={ready} creator={creator || null} onLaunch={() => {}}
        image={<ProfileFields value={prof} onChange={setProf} part="image" customImages={customImages} side="a" />} profile={<ProfileFields value={prof} onChange={setProf} part="text" side="a" generated={genH} />}
        tickerChecks={reviewCurrent ? (shown.review as (LaunchReview & { tickers?: TickerCheck[] }) | null)?.tickers ?? null : null}
        profileProblems={blockersH} next={next("Review", "review", nameBlockedH, nameBlockedH ? (rightsH ? IMAGE_RIGHTS_REQUIRED : NAME_STEP_BLOCKED) : null)} />
    );
    const b = budgetCopy(rule, fraction, null);
    return (<>
      {!out && <ReviewCard mode="review"
        signs={shown.review?.transactions.count ? walletPromptCount({ transactions: shown.review.transactions.count, proof: !wallet.connected || !!wallet.signMessage }) : null} signsProof={!wallet.connected || !!wallet.signMessage}
        edgeNotes={COINVS_EDGE_IDS.single.map((i) => edgeCase(i)).filter((x): x is string => !!x)}
        upfront={upfrontLines(RAISE_PRESETS_SOL)}
        facts={[
          { label: FACT_LABELS.trigger, value: triggerText({ lead: text.lead, fallback: text.oneLiner }), edit: () => onPhase?.("which") },
          { label: FACT_LABELS.coin, value: whichCoinLine(names.ticker.toUpperCase() || "TICKER", null), edit: () => onPhase?.("name") },
          { label: FACT_LABELS.amount, value: `${b.line} ${shareOfBudgetLine(fraction)} ${shareExample(fraction)}`, edit: () => onPhase?.("burn") },
          { label: FACT_LABELS.ends, value: endText(rule).line, edit: null },
          { label: FACT_LABELS.cost, value: costLine(shown.review && reviewCurrent ? shown.review.costs.totalSol : null, 1), edit: null },
        ]}
        publicProfile={{ coins: [{ side: "a", image: coin.image, name: names.name, ticker: names.ticker, description: prof.description, links: profileBody(prof).links, note: null }], edit: () => onPhase?.("name") }}
        coins={[coin]} sentence={text.lead} notes={[...(base?.line ? [base.line] : []), ...(once ? [HIGH_RUN_NOTE] : [])]} ends={endText(rule).line}
        shares={{ options: [...sh.options], value: fraction, onChange: setFraction }}
        raise={{ options: [...RAISE_PRESETS_SOL], value: raiseSol, onChange: setRaiseSol, line: shown.review?.raise?.line ?? null }} graduation={shown.review?.graduation ?? null}
        profileProblems={blockersH}
        problems={reviewCurrent ? (shown.review?.problems ?? []).filter((x) => !isLintLine(x) && !serverH.some((f) => f.text === x)) : []} error={err} busy={busy} ready={ready} creator={creator || null} onLaunch={() => { void launch(); }}
        cost={shown.review && reviewCurrent ? `The estimated cost is about ${shown.review.costs.totalSol} SOL.` : null} venue="single"
        mintSearch={<MintAddressBlock pool={mintPool} />}
        summary={<PreWalletSummary review={shown.review} loading={shown.loading} error={shown.error} updating={slot.rev !== reviewKey && !!slot.review} proof={!wallet.connected || !!wallet.signMessage} />}
        blocked={blocked ?? (reviewCurrent ? null : REVIEW_UPDATING)} />}
      {out && signPlan && <SignCard plan={signPlan} creator={creator || null} title={`Launch $${out.ticker}`} coinHref={coinCanonicalHref} onStartOver={() => { setOut(null); setErr(null); setNow(Date.now()); }} />}
    </>);
  }
}

/** The generated receipt art for a rule not launched yet (coinArt.ts via /burnticker/img/preview.svg), never "NO IMAGE". */
function art(r: BurnRule | null, tk: string): string {
  const b64u = (x: string) => btoa(unescape(encodeURIComponent(x))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return r ? `/burnticker/img/preview.svg?r=${b64u(JSON.stringify(r))}&t=${encodeURIComponent(tk || "TICKER")}&l=${encodeURIComponent(ruleOneLiner(r).slice(0, 120))}` : "";
}

/**
 * `blocked`: why the wallet cannot open (preview mode, a closed host, pairs off on this host) — the review card disables its button and
 * says so. `unavailable`: Coin vs Coin cannot launch on this host at all (launch audit 5 L02) — the tile says why before any picking.
 */
export function CoinVsCoinTile({ recordKeyed = null, burnReal = null, network = null, pairCurve = false, blocked = null, unavailable = null, unavailableDetail = null, customImages = true, startOpen = false, entry = null, phase: phaseIn = null, onPhase, onAnswers }: { /** WIRING-AUDIT12 item 11: the host can read past daily closes (a Pyth access key); null = not known */ recordKeyed?: boolean | null; /** website-22 (QA 9 item 38): the guided step on screen (which, burn, name, review), set by the page */ phase?: GuidedPhase | null; onPhase?: (p: GuidedPhase) => void; onAnswers?: (a: TileAnswers) => void; /** website-24 (WIRING-ROUND5): the launch state's round-5 line (SiteLaunchState.burnReal): the per-side "Burn the real <symbol>" choice shows only when available */ burnReal?: { available: boolean; line: string | null } | null; /** the network the admission check reads (the catalogue's cluster) */ network?: string | null; /** website-20 item 60: the link that opened the page (the page drops its parameters from the address once read), so a template or a derby link still lands on what it names */ entry?: { template: string | null; a: string; b: string; kind?: string | null; rivalry?: string | null } | null; pairCurve?: boolean; blocked?: string | null; unavailable?: string | null; /** A2: the blocker behind the one line, in its details */ unavailableDetail?: string | null; /** website-18: the host takes custom images (catalogue customImages) */ customImages?: boolean; /** website-19: the guided path opens it as question 2, with the burn pattern and the end beside the review */ startOpen?: boolean } = {}) {
  const wallet = useWallet();
  const [open, setOpen] = useState(startOpen);
  // WIRING-SOURCES4: two coins racing, or one coin's record close (RecordClose above)
  const [kind, setKind] = useState<"pair" | "high">("pair");
  // `/burnticker/launch?derby=1&a=WIF&b=SHIB` (the Burn Derby page and the search card) opens the tile with both searches filled in.
  const [initial, setInitial] = useState<{ a: string; b: string }>({ a: "", b: "" });
  useEffect(() => {
    // A2: a direct link never opens the tile while Coin vs Coin is unavailable; the greyed tile says why
    if (unavailable) { setOpen(false); return; }
    const u = new URLSearchParams(window.location.search);
    if (u.get("derby") === "1") { setOpen(true); setInitial({ a: deepLinkQuery(u.get("a")), b: deepLinkQuery(u.get("b")) }); }
    else if (entry?.a || entry?.b) { setOpen(true); setInitial({ a: deepLinkQuery(entry.a), b: deepLinkQuery(entry.b) }); }   // website-20 item 60: the page already dropped the address's parameters
    // the templates gallery: coin-vs-coin, bracket (a Coin vs Coin season; the operator registers the bracket) and the flippening
    // website-25 (WIRING-SOURCES7 H1): a record-close link (?kind=record-close&a=BTC) opens one coin's record close with the coin searched
    if ((u.get("kind") ?? entry?.kind) === "record-close") { setOpen(true); setKind("high"); setInitial({ a: deepLinkQuery(u.get("a") ?? entry?.a ?? null), b: "" }); }
    const tpl = u.get("template") ?? entry?.template ?? null;
    if (tpl === "coin-vs-coin" || tpl === "bracket" || tpl === "flippening") { setOpen(true); if (tpl === "flippening") setFlip(true); }
    // website-26 (WIRING-FEATURES item 13): a pre-made rivalry (?template=coin-vs-coin&rivalry=wif-bonk) picks both coins and opens the Name step
    const riv = rivalryById(u.get("rivalry") ?? entry?.rivalry ?? null);
    if (riv && rivalryDone.current !== riv.id) {
      rivalryDone.current = riv.id;
      const h = rivalryHits(riv);
      setOpen(true); setKind("pair"); setA(h.a); setB(h.b); setFlip(riv.flip); setSeasonDays(runDaysOf(riv.seasonDays));
      onPhase?.("name");
    }
  }, [unavailable, entry]); // eslint-disable-line react-hooks/exhaustive-deps
  const [a, setA] = useState<Hit | null>(null), [b, setB] = useState<Hit | null>(null);
  // website-24 (WIRING-ROUND5): each side's "Burn the real <symbol>" choice, default off (the coin burns itself); a new pick resets it
  const [realA, setRealA] = useState<SideReal>(SIDE_REAL_OFF), [realB, setRealB] = useState<SideReal>(SIDE_REAL_OFF);
  useEffect(() => { setRealA(SIDE_REAL_OFF); }, [a?.symbol, a?.underlying?.mint]);
  useEffect(() => { setRealB(SIDE_REAL_OFF); }, [b?.symbol, b?.underlying?.mint]);
  const realOn = burnReal?.available === true;
  const net = network === "mainnet" ? "mainnet" : "devnet";
  const fieldA = realOn ? realField(realA, net) : null, fieldB = realOn ? realField(realB, net) : null;
  // fixed on the web: daily windows, a 30-day run; the share is a preset (2 / 5 / 10 %, default 2 %); the flippening only via its template
  // website-26 (WIRING-FEATURES item 14): the run is 7, 14 or 30 days (DERBY_RUN_PRESETS), picked beside the share; 30 by default
  const window_ = "daily" as const;
  const [seasonDays, setSeasonDays] = useState<number>(30);
  const rivalryDone = useRef<string | null>(null);
  const [flip, setFlip] = useState(false);
  // website-20 item 55: each mode keeps its own share (the daily race 2 % by default, the flippening 100 %), so switching back and forth
  // never resets a choice; the line under the two modes names both
  const [shares, setShares] = useState<{ daily: number; flip: number }>({ daily: DEFAULT_SHARE.recurring, flip: DEFAULT_SHARE.oneShot });
  const fraction = flip ? shares.flip : shares.daily;
  const setFraction = (v: number) => setShares((x) => (flip ? { ...x, flip: v } : { ...x, daily: v }));
  // WIRING-AUDIT12 P1-1: the flippening is a linked pair on one result, so its only share is 100 % (SHARE_PRESETS.linkedOneShot)
  const shareRow = flip ? SHARE_PRESETS.linkedOneShot : SHARE_PRESETS.recurring;
  const [shareMigrated, setShareMigrated] = useState<string | null>(null);
  // website-19 (walkthrough snag 2): the raise is picked once and shared by both coins (the review answers null for the pair curve)
  const [raiseSol, setRaiseSol] = useState<RaisePreset>(DEFAULT_RAISE_SOL);
  const [names, setNames] = useState({ a: "", b: "", ta: "", tb: "" });
  // website-18 (the owner: "I also don't see the ability to change the thumbnail pic"): each coin of the pair has its own image, description and links
  const [profA, setProfA] = useState<ProfileValue>(EMPTY_PROFILE), [profB, setProfB] = useState<ProfileValue>(EMPTY_PROFILE);
  // intent audit 5 item 19: the pair draft is kept across a refresh, Back and Resume (versioned; an image is never kept), and cleared by
  // Start over (the page removes CVC_STORE with its own draft)
  const restored = useRef(false);
  // launch audit 227: a restored draft had an image that was not kept; one line beside the image fields says so
  const [imagesDropped, setImagesDropped] = useState(false);
  useEffect(() => {
    if (restored.current) return; restored.current = true;
    const u = new URLSearchParams(window.location.search);
    if (u.get("derby") === "1" || u.get("template") || entry) return;
    let d: CvcDraft | null = null;
    try { d = JSON.parse(sessionStorage.getItem(CVC_STORE) ?? "null") as CvcDraft | null; } catch { d = null; }
    if (!d || d.v !== 1) return;
    if (d.a) setA(d.a); if (d.b) setB(d.b); setNames(d.names); setFlip(!!d.flip); if (d.shares && typeof d.shares.daily === "number" && typeof d.shares.flip === "number") setShares(d.shares); else if (typeof d.fraction === "number") setShares((x) => (d!.flip ? { ...x, flip: d!.fraction } : { ...x, daily: d!.fraction }));
    // WIRING-AUDIT12 P1-1: a saved flippening share other than 100 % is set to 100 % and the creator is told (never silently)
    const savedFlip = d.shares && typeof d.shares.flip === "number" ? d.shares.flip : d.flip && typeof d.fraction === "number" ? d.fraction : null;
    if (savedFlip !== null && savedFlip !== 1) { setShares((x) => ({ ...x, flip: 1 })); if (d.flip) setShareMigrated(linkedShareMigratedNotice(savedFlip)); }
    if (d.raiseSol && (RAISE_PRESETS_SOL as readonly string[]).includes(d.raiseSol)) setRaiseSol(d.raiseSol as RaisePreset);
    if (d.seasonDays !== undefined) setSeasonDays(runDaysOf(d.seasonDays));
    setEdited(editedFrom(d.edited));
    setProfA((x) => ({ ...x, ...d!.profA })); setProfB((x) => ({ ...x, ...d!.profB }));
    if (d.images?.a || d.images?.b) setImagesDropped(true);
  }, []);
  // launch integrity 251: the fingerprint is held with the input it was computed for (preparedLaunch.ts)
  const [fp, setFp] = useState<Fingerprint | null>(null);
  const hashLatest = useRef(createLatest()).current;
  // launch integrity 252: the prepared set carries the tickers it was prepared with; the signing card never reads the form again
  const [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null), [out, setOut] = useState<{ pairId: string; a: Bundle; b: Bundle; notes: string[]; tickers: { a: string; b: string }; /** F06: when this tile received the plan */ at: number } | null>(null);
  const creator = wallet.publicKey?.toBase58() ?? "";
  // WIRING-SEMANTICS item 72: `now` is re-read whenever the UTC day turns (checked each minute, and again right before Launch), so a
  // draft that crosses 00:00 UTC is rebuilt and re-hashed for the new first day instead of being refused at launch
  const [now, setNow] = useState(() => Date.now());
  const utcDay = (ms: number) => Math.floor(ms / 86_400_000);
  useEffect(() => { const t = setInterval(() => setNow((n) => (utcDay(Date.now()) !== utcDay(n) ? Date.now() : n)), 60_000); return () => clearInterval(t); }, []);
  // WIRING-SEMANTICS item 96: names, images and words the creator typed stay with the side when the picked coins change; say so once
  const [picksMoved, setPicksMoved] = useState(false);
  const picksKey = useRef<string | null>(null);
  // website-19 (owner, 2026-10-12: "two teamwifs"): both sides are named by the matchup ($WIFVBONK and $BONKVWIF; "WIF vs BONK, WIF side"),
  // generated until the creator types their own
  // launch audit 248: each name and ticker is tracked on its own, so typing coin A's name never freezes coin B's generated names
  const [edited, setEdited] = useState<EditedFields>(NONE_EDITED);
  useEffect(() => { const k = `${a?.symbol ?? ""}|${b?.symbol ?? ""}`; if (picksKey.current !== null && picksKey.current !== k && Object.values(edited).some(Boolean)) setPicksMoved(true); picksKey.current = k; }, [a, b]); // eslint-disable-line react-hooks/exhaustive-deps
  // website-26 (WIRING-FEATURES item 15): a daily race's sides carry the fight ($WIFWINS / $BONKWINS); the flippening keeps $SOLVETH
  useEffect(() => { setNames((n) => generatedNames(a, b, n, edited, { flip })); }, [a, b, edited, flip]);
  useEffect(() => {
    if (!restored.current || (!a && !b)) return;
    const words = (p: ProfileValue) => ({ description: p.description, x: p.x, telegram: p.telegram, website: p.website });
    const d: CvcDraft = { v: 1, a, b, names, fraction, shares, flip, raiseSol, edited, profA: words(profA), profB: words(profB), images: { a: !!profA.image, b: !!profB.image } };
    d.seasonDays = seasonDays;
    try { sessionStorage.setItem(CVC_STORE, JSON.stringify(d)); } catch { /* private mode */ }
  }, [a, b, names, fraction, shares, flip, raiseSol, edited, profA, profB, seasonDays]);
  // website-25 (WIRING-SOURCES7 H7): the pair is checked when both coins are picked (POST /v1/derby/pair): a wrapper of the other coin
  // (SOL and JITOSOL) is refused there, and a flippening the first coin has already won is refused with a swap when the other order works
  const [pairCheck, setPairCheck] = useState<{ key: string; ok: boolean; swap: boolean; reason: string | null; busy: boolean } | null>(null);
  const pairCheckKey = a?.underlying && b?.underlying ? JSON.stringify([a.underlying, b.underlying, flip]) : "";
  useEffect(() => {
    if (!pairCheckKey || !a?.underlying || !b?.underlying) { setPairCheck(null); return; }
    let live = true;
    setPairCheck({ key: pairCheckKey, ok: true, swap: false, reason: null, busy: true });
    // HB-79 (hourly run 5): the check is bounded (PAIR_CHECK_TIMEOUT_MS); a slow or failed answer stops the wait and refuses nothing here
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), PAIR_CHECK_TIMEOUT_MS);
    fetch("/api/burnticker/v1/derby/pair", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ a: a.underlying, b: b.underlying, flip }), signal: ctl.signal })
      .then(async (r) => { const j = await r.json().catch(() => null) as { ok?: boolean; swap?: boolean; refusal?: { reason: string } | null; error?: string } | null; if (!live) return; if (!r.ok) { setPairCheck({ key: pairCheckKey, ok: true, swap: false, reason: null, busy: false }); return; } setPairCheck({ key: pairCheckKey, ok: j?.ok !== false, swap: !!j?.swap, reason: j?.refusal?.reason ?? null, busy: false }); })
      .catch(() => { if (live) setPairCheck({ key: pairCheckKey, ok: true, swap: false, reason: null, busy: false }); })
      .finally(() => clearTimeout(timer));
    return () => { live = false; clearTimeout(timer); ctl.abort(); };
  }, [pairCheckKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const pairRefused = !!pairCheck && pairCheck.key === pairCheckKey && !pairCheck.ok;
  const pairCheckLine = pairRefused ? (
    <div className="space-y-1 rounded border border-amber-400/50 p-2 text-xs text-amber-200" role="alert" data-pair-check>
      <p>{pairCheck!.reason}</p>
      {pairCheck!.swap && <button type="button" data-decision="what" className="underline" onClick={() => { const x = a; setA(b); setB(x); }} data-pair-swap>Swap the two coins</button>}
    </div>
  ) : null;
  const choice: TileChoice | null = a?.underlying && b?.underlying ?{ a: a.underlying, b: b.underlying, window: window_, seasonDays, flip, fraction, now } : null;
  useEffect(() => { if (choice) void startFingerprint(hashLatest, tileHashInput(choice), sha256HexWeb, setFp); else { hashLatest.cancel(); setFp(null); } }, [a, b, flip, fraction, seasonDays]); // eslint-disable-line react-hooks/exhaustive-deps
  const hash = choice ? fingerprintFor(fp, tileHashInput(choice)) : null;
  const model = choice && hash ? tileRule(choice, hash, { a: names.ta.toUpperCase(), b: names.tb.toUpperCase() }) : null;
  // side A's rule carries its own pinned token; side B never inherits it (rules.ts invertMapping): its own rides in `pair.burnTarget`
  const ruleA: BurnRule | null = model?.rule ? withRealBurn(model.rule, fieldA) : null;
  // the sides that burn their real coin (admitted), and the description that says so instead of "only read, never traded or burned"
  const realList = [...(fieldA ? [{ ticker: names.ta.toUpperCase() || "A", symbol: fieldA.symbol, daysOf: flip ? null : `${fieldA.symbol}'s` }] : []), ...(fieldB ? [{ ticker: names.tb.toUpperCase() || "B", symbol: fieldB.symbol, daysOf: flip ? null : `${fieldB.symbol}'s` }] : [])];
  const sentence = model ? (realList.length ? model.sentence.replace(derbyReadOnlySentence(model.spec), realReadSentence({ a: model.spec.a.symbol, b: model.spec.b.symbol }, realList)) : model.sentence) : null;
  const ruleB: BurnRule | null = model?.rule ? withRealBurn({ ...model.rule, binary: { onYes: null, onNo: model.rule.binary!.onYes } }, fieldB) : null;
  // L13: the start boundary too, in UTC (the windows' clock) — the facts list above adds Denver time
  // continuous audit HB-2: the review's "When it ends" is the same end the burn step and the server review say (guidedLaunch.ts coinvsEndsLine)
  const ends = model?.rule ? coinvsEndsLine(model.rule) : null;

  // review N6: the venue this host uses for a pair (catalogue venues.pairCurve, passed down by the page). The venue is not shown before
  // launch (the owner's cut list); a 409 naming the other venue switches it and the build is retried once.
  const [venue, setVenue] = useState<PairVenue>(pairCurve ? "pair-curve" : "launchlab");
  useEffect(() => { setVenue(pairCurve ? "pair-curve" : "launchlab"); }, [pairCurve]);
  const [pcOut, setPcOut] = useState<{ pairId: string; pc: PairCurveLaunchBundle; keys: { a: string; b: string } | null; notes: string[]; tickers: { a: string; b: string }; /** F06: when this tile received the plan */ at: number } | null>(null);
  const prepared = pcOut ?? out;
  // 2026-10-14 night: the server's two prepared addresses; the in-browser search (MintSearch.tsx) only when it has none ready
  const mintPool = useMintPool();
  const launch = async () => {
    if (!ruleA || !creator || !reviewMatchesDraft(slot, curRev.current)) return;   // A6: only the reviewed draft is prepared
    // item 72: the UTC day turned since this draft was built: rebuild it for the new first day, and the creator presses Launch again
    if (utcDay(Date.now()) !== utcDay(now)) { setNow(Date.now()); setErr(edgeCase(72)); return; }
    setBusy(true); setErr(null); setOut(null); setPcOut(null);
    const sentRev = prepRev.current;
    const body = { creator, ticker: names.ta.toUpperCase(), name: names.a, description: sentence!, imageUrl: null, rule: ruleA, firstBuySol: "0", raiseSol, acknowledgements: { ruleLocked: true, noReturns: true }, ...profileBody(profA), pair: { ticker: names.tb.toUpperCase(), name: names.b, description: sentence!, imageUrl: null, ...profileBody(profB), ...(fieldB ? { burnTarget: fieldB } : {}) } };
    // launch audit 249: a 409 naming the other venue switches the venue and says so; the creator presses again after the review is
    // read again for the new terms (the venue is part of reviewKey), never a silent rebuild on the other venue
    const run = async (v: PairVenue): Promise<void> => {
      try {
        // launch integrity 252: an answer for a draft that changed while it was prepared is set aside: no plan, no wallet, a fresh review
        // 2026-10-14 night: the server's two prepared addresses (no mint sent); when it has none ready, this browser finds both in parallel
        const got = await prepareIfCurrent(sentRev, () => prepRev.current, () => withMintSource({ pool: mintPool, n: 2, stale: () => prepRev.current !== sentRev, staleLine: STALE_PREPARE_SENTENCE }, async (keys: GroundMint[] | null) => {
          const [kA, kB] = keys ?? [];
          // prelaunch audit 2026-10-18 A-3: the wallet signs the request for both coins (walletProof.ts)
          const walletProof = await requireLaunchProof(wallet.signMessage, { origin: window.location.origin, creator, tickers: [body.ticker, body.pair.ticker], mints: kA && kB ? [kA.publicKey, kB.publicKey] : [] }, base58);
          const sentBody = { ...(kA && kB ? { ...body, mint: kA.publicKey, pair: { ...body.pair, mint: kB.publicKey } } : body), ...(walletProof ? { walletProof } : {}) };
          const j = await sendWithProofFallback(sentBody, (b) => postPairLaunch((u, init) => fetch(u, init), b, v));   // review of block M: unsigned once on a refused signature
          return { j, kA, kB };
        }));
        if ("stale" in got) { setErr(STALE_PREPARE_SENTENCE); return; }
        const { j, kA, kB } = got.ok, tickers = { a: body.ticker, b: body.pair.ticker };
        if (kA && kB) { mintPool?.consume(kA.publicKey); mintPool?.consume(kB.publicKey); }
        if (j.venue === "pair-curve") {
          if (kA && kB && (j.pairCurve.mints.a !== kA.publicKey || j.pairCurve.mints.b !== kB.publicKey)) throw new Error(MINT_MISMATCH_LINE);
          const keysAB = kA && kB ? { a: secretBase58(kA), b: secretBase58(kB) } : { a: secretBase58(serverKeyFor(j.pairCurve.mints.a, j.mintSecretKeys?.a)), b: secretBase58(serverKeyFor(j.pairCurve.mints.b, j.mintSecretKeys?.b)) };
          setPcOut({ pairId: j.pair.pairId, pc: j.pairCurve, keys: keysAB, notes: j.pair.notes ?? [], tickers, at: Date.now() });
        }
        else {
          // WIRING-AUDIT12 P1-2: the bundles' rules against the review's prepared rules, before any wallet request
          const A = j.bundles.a as Bundle, B = j.bundles.b as Bundle, prep = reviewFor(slot, reviewKey).review?.prepared ?? null;
          const lines = prep ? await preparedRulesCheckWeb(prep, { a: { text: A.rules.text, sha256: A.rules.sha256, mint: A.mint }, b: { text: B.rules.text, sha256: B.rules.sha256 } }) : [PREPARED_MISSING_LINE];
          if (lines.length) { setErr(lines.join(" ")); onPhase?.("review"); return; }
          setOut({ pairId: j.pair.pairId, a: kA ? withLocalKey(A, kA) : withServerKey(A), b: kB ? withLocalKey(B, kB) : withServerKey(B), notes: j.pair.notes ?? [], tickers, at: Date.now() });
        }
      } catch (e) { const nv = venueFrom409(e); if (nv) setVenue(nv); setErr(String((e as Error).message ?? e)); }
    };
    try { await run(venue); } finally { setBusy(false); }
  };

  // L06 / L13: the read-only review payload for the pair (the server's numbers), debounced; the pair's side B rule is derived at build
  // A6: keyed by the draft's revision (launchReviewSync.ts): a summary for an older pick or older names is never shown
  const [slot, setSlot] = useState<ReviewSlot<LaunchReview>>(EMPTY_REVIEW_SLOT);
  const reviewKey = draftRevision([ruleA, fieldB, names, profA.description, profB.description, raiseSol, venue]);
  const curRev = useRef(reviewKey); curRev.current = reviewKey;
  // launch integrity 252: everything the launch body carries, so a change during preparation (a profile link, an image) is seen too
  const prepRev = useRef(""); prepRev.current = draftRevision([reviewKey, fraction, flip, profileRevision(profA), profileRevision(profB)]);
  // the signing plan is built once from the prepared answer (its tickers included) and never from the form
  // F06 (prelaunch audit 2026-10-18): with its deadline, counted from when this tile received the plan
  const signPlan = useMemo(() => (pcOut ? withPlanDeadline(pairCurvePlan(pcOut.pc, pcOut.keys, pcOut.tickers), pcOut.at) : out ? withPlanDeadline(launchlabPlan([out.a, out.b]), out.at) : null), [pcOut, out]);
  const seqRef = useRef(0);
  useEffect(() => {
    if (!ruleA) return;
    const seq = ++seqRef.current, rev = reviewKey;
    setSlot((x) => reviewRequested(x, rev, seq));
    const t = setTimeout(() => {
      fetch("/api/burnticker/v1/launch/review", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rule: ruleA, ticker: names.ta.toUpperCase(), name: names.a, raiseSol, creatorDescription: profA.description, pair: { ticker: names.tb.toUpperCase(), name: names.b, creatorDescription: profB.description, ...(fieldB ? { burnTarget: fieldB } : {}) } }) })
        .then(async (r) => { const j = await r.json().catch(() => null); if (!r.ok) throw new Error(r.status === 403 ? "creator launches are closed on this site" : `the review could not be read (HTTP ${r.status})`); return j as LaunchReview; })
        .then((j) => setSlot((x) => reviewAnswered(x, curRev.current, { rev, seq, review: j })))
        .catch((e) => setSlot((x) => reviewAnswered(x, curRev.current, { rev, seq, error: String((e as Error).message) })));
    }, 400);
    return () => clearTimeout(t);
  }, [reviewKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = reviewFor(slot, reviewKey), reviewCurrent = reviewMatchesDraft(slot, reviewKey);

  const tileButton = (
    <button onClick={() => setOpen(true)} data-decision="what" disabled={!!unavailable} aria-describedby={unavailable ? "cvc-why" : undefined} className="w-full text-left rounded-xl border border-neutral-800 bg-neutral-900 p-5 disabled:cursor-not-allowed hover:border-amber-400 focus:border-amber-400 disabled:opacity-50" aria-label="Coin vs Coin">
      <div className="text-lg font-semibold">Coin vs Coin <span className="ml-1 rounded bg-amber-400/15 px-1.5 text-xs text-amber-300 align-middle">Burn Derby</span></div>
      <p className="mt-1 text-sm text-neutral-300">Pick two coins that people already hold. Burnticker only reads their published feeds. You launch two new coins that race on those feeds every day, and the new coin on the winning side burns.</p>
      <p className="mt-3 text-xs text-neutral-500">For example, $WIFWINS burns on every UTC day that WIF gains more than SHIB, read from Pyth at 00:00 UTC.</p>
    </button>
  );
  const tile = unavailable ? (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900" data-tile="derby" data-unavailable="">
      {tileButton}
      <div className="px-5 pb-4">{unavailableDetail ? <details id="cvc-why" className="text-xs text-amber-300" data-pairs-blocked><summary className="cursor-pointer">{unavailable}</summary><p className="mt-1 text-neutral-400">{unavailableDetail}</p></details> : <p id="cvc-why" className="text-xs text-amber-300">{unavailable}</p>}</div>
    </div>
  ) : tileButton;
  // website-22 (QA 9 item 38, audit 10 item 13): the progress strip's answers for the steps the tile walks
  useEffect(() => { if (kind === "pair") onAnswers?.({ which: a && b ? `${a.symbol} vs ${b.symbol}` : null, burn: flip ? "once, the flippening" : "every day, the daily race", name: names.ta ? `$${names.ta.toUpperCase()} and $${names.tb.toUpperCase()}` : null }); }, [kind, a?.symbol, b?.symbol, flip, names.ta, names.tb]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!open || unavailable) return tile;
  const recordAvail = recordKeyed === null ? null : recordCloseAvailability({ keyed: recordKeyed });
  const kindChoice = (
    <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="What the coins follow" data-derby-kind>
      {/* continuous audit HB-9: each radio is named, and a record close is marked unavailable (with the reason beside it) while it cannot start */}
      {(["pair", "high"] as const).map((k) => { const off = k === "high" && !!recordAvail && !recordAvail.available; return (
        <button key={k} type="button" role="radio" aria-checked={kind === k} aria-label={k === "pair" ? PAIR_CHOICE_LABEL : HIGH_CHOICE_LABEL} aria-disabled={off || undefined} aria-describedby={off ? "bt-record-availability" : undefined} data-decision="what" data-derby-kind-choice={k} disabled={busy || !!prepared || off} onClick={() => setKind(k)} className={`rounded-lg border p-3 text-left text-sm disabled:opacity-50 ${kind === k ? "border-amber-400 bg-amber-400/10" : "border-neutral-800"}`}>
          <span className="block font-medium">{k === "pair" ? PAIR_CHOICE_LABEL : HIGH_CHOICE_LABEL}</span><span className="mt-0.5 block text-xs text-neutral-300">{k === "pair" ? PAIR_CHOICE_LINE : HIGH_CHOICE_LINE}</span>
        </button>
      ); })}
      {/* WIRING-AUDIT12 item 11: whether a record close can start on this site, said beside the choice before any setup */}
      {recordAvail && <div id="bt-record-availability" className="text-xs text-neutral-300 sm:col-start-2" data-record-availability={recordAvail.available ? "yes" : "no"}>
        <p>{recordAvail.line}</p>
        {recordAvail.alternative && <p className="mt-0.5 text-neutral-400">{recordAvail.alternative} <button type="button" data-nav className="underline" disabled={busy || !!prepared} onClick={() => { setKind("pair"); setFlip(false); }}>Two coins</button> <button type="button" data-nav className="ml-1 underline" disabled={busy || !!prepared} onClick={() => { setKind("pair"); setFlip(true); }}>The flippening</button></p>}
      </div>}
    </div>
  );
  // website-22: in the guided launch each step is its own screen, with the page's progress strip, Back and Start over above it
  const stepHead = (p: GuidedPhase) => <h2 className="text-xl font-semibold outline-none" tabIndex={-1} data-step-heading>{p === "which" ? whichHeading("coins", null, kind === "high" ? "record" : "race") : GUIDED_STEPS.find((s) => s.id === p)?.question}</h2>;
  const phase: GuidedPhase = phaseIn && phaseIn !== "follow" ? phaseIn : "which";
  if (kind === "high") return (
    <section className="space-y-3" aria-label={HIGH_CHOICE_LABEL} data-guided-step={phase} data-derby-guided="high">
      {phase !== "burn" && stepHead(phase)}
      {phase === "which" && kindChoice}
      <RecordClose initial={initial.a} blocked={blocked} customImages={customImages} phase={phase} onPhase={onPhase} onAnswers={onAnswers} />
    </section>
  );
  // intent audit item 5: the two sides must be told apart (ticker and name, any case or spacing)
  const identity = pairIdentityProblems({ ticker: names.ta, name: names.a }, { ticker: names.tb, name: names.b });
  const ready = !!model?.rule && !model.problems.length && /^[A-Z0-9]{2,10}$/.test(names.ta) && /^[A-Z0-9]{2,10}$/.test(names.tb) && identity.length === 0 && !!names.a.trim() && !!names.b.trim();
  // website-19: the burn pattern (each day's winner, or once: the flippening) and the end, read from the rule
  const po = patternOptions({ follow: "coins", rule: model?.rule ?? null });
  // continuous audit HB-2: the end of the pair as the bundle links it (winner takes the rest), never the single coin's $DEFICIT end; the
  // burn step says it once, so the "At the end" block is left out when the coin's sentence already carries it
  const end = model?.rule ? endSentences(asLinkedPairSide(model.rule)) : null;
  const endSaid = !!end && !!sentence && sentence.includes(end.sentences.join(" "));
  {
    // website-22 (QA 9 item 38, audit 10 item 13): Coin comparison and the flippening walk Which, Burns, Name and Review like every coin
    const next = (label: string, to: GuidedPhase, disabled = false, why: string | null = null) => <StickyAction>{why && <p className="mb-1 text-xs text-amber-300" role="status" data-next-blocked>{why}</p>}<button type="button" data-nav disabled={disabled} className="w-full rounded bg-amber-400 px-4 py-2 text-sm font-medium text-neutral-950 disabled:opacity-40 sm:w-auto" onClick={() => onPhase?.(to)}>{label}</button></StickyAction>;
    const coinsNow = [
      { key: "a", name: names.a, ticker: names.ta, onName: (v: string) => { setEdited((e) => ({ ...e, a: true })); setNames((n) => ({ ...n, a: v })); }, onTicker: (v: string) => { setEdited((e) => ({ ...e, ta: true })); setNames((n) => ({ ...n, ta: v })); }, image: profA.image ? chosenPreview(profA)! : art(model?.rule ?? null, names.ta), oneLiner: model?.rule ? ruleOneLiner(model.rule) : "", oracle: "derby", badge: null, nameIssue: fieldRuleSentence("name", names.a), tickerIssue: fieldRuleSentence("ticker", names.ta) },
      { key: "b", name: names.b, ticker: names.tb, onName: (v: string) => { setEdited((e) => ({ ...e, b: true })); setNames((n) => ({ ...n, b: v })); }, onTicker: (v: string) => { setEdited((e) => ({ ...e, tb: true })); setNames((n) => ({ ...n, tb: v })); }, image: profB.image ? chosenPreview(profB)! : art(ruleB, names.tb), oneLiner: ruleB ? ruleOneLiner(ruleB) : "", oracle: "derby", badge: null, nameIssue: fieldRuleSentence("name", names.b), tickerIssue: fieldRuleSentence("ticker", names.tb) },
    ];
    const TA = names.ta.toUpperCase() || "A", TB = names.tb.toUpperCase() || "B";
    // website-26 (WIRING-FEATURES item 11): a daily race leads with the fight; the Pyth sentence comes second (not the flippening)
    const lead = !flip && a && b ? fightLead(TA, TB, seasonDays) : null;
    // website-25 (QA 11 H5): the description's wording rules on both sides, and the server's own field problems, on the name step
    const issuesA = profileIssues(profA, reviewCurrent ? shown.review?.coins?.[0]?.description ?? null : null), issuesB = profileIssues(profB);
    const saidP = new Set([...coinsNow.flatMap((c) => [c.nameIssue, c.tickerIssue]), ...issuesA.map((x) => x.text), ...issuesB.map((x) => x.text), ...identity].filter((x): x is string => !!x).map((x) => x.replace(/\.$/, "").toLowerCase()));
    const serverP = reviewCurrent ? serverFieldProblems(shown.review?.problems ?? [], saidP) : [];
    const blockers = [...issuesA.map((x) => ({ text: `$${TA}: ${x.text}`, edit: () => onPhase?.("name") })), ...issuesB.map((x) => ({ text: `$${TB}: ${x.text}`, edit: () => onPhase?.("name") })), ...identity.map((x) => ({ text: x, edit: () => onPhase?.("name") })), ...serverP.map((x) => ({ text: x.text, edit: () => onPhase?.("name") })), ...(realOn ? realBlockers([{ ticker: TA, side: realA, network: net }, { ticker: TB, side: realB, network: net }]).map((x) => ({ text: x, edit: () => onPhase?.("burn") })) : [])];
    // the review's other problems (the rule's own), said once beside the tile's
    const ruleProblemsP = [...model?.problems ?? [], ...(reviewCurrent ? (shown.review?.problems ?? []).filter((x) => !isLintLine(x) && !serverP.some((f) => f.text === x) && !saidP.has(x.replace(/^Coin [AB]\. /, "").replace(/\.$/, "").toLowerCase()) && !(model?.problems ?? []).includes(x)) : [])];
    const rightsMissing = (!!profA.image && !profA.rights) || (!!profB.image && !profB.rights);
    const nameBlockedP = rightsMissing || !ready || blockers.length > 0 || coinsNow.some((c) => !!c.nameIssue || !!c.tickerIssue);
    // website-24 (WIRING-ROUND5): each side may burn its real reference coin instead of itself, once the round-5 program is deployed;
    // until then the tile shows nothing in its place
    const pickA = realPickFor(a?.underlying ? { ...a.underlying, symbol: a.symbol } : null), pickB = realPickFor(b?.underlying ? { ...b.underlying, symbol: b.symbol } : null);
    // HB-12 (2026-10-19), the launch wizard audit's F16 rule: with the feature off the tile says nothing about it. A Coin comparison pair
    // never arrives with a token already named (no template or saved draft carries one), so there is no choice it would otherwise have.
    const realChoices = !a || !b || !realOn ? null : (
      <div className="grid min-w-0 gap-2 md:grid-cols-2" data-burn-real-choices>
        {pickA ? <BurnRealChoice side="a" who={`$${TA}`} picks={[pickA]} value={realA} onChange={setRealA} network={net} locked={busy || !!prepared} /> : <p className="text-xs text-neutral-400" data-burn-real-none="a">{realNotOffered(a.symbol)}</p>}
        {pickB ? <BurnRealChoice side="b" who={`$${TB}`} picks={[pickB]} value={realB} onChange={setRealB} network={net} locked={busy || !!prepared} /> : <p className="text-xs text-neutral-400" data-burn-real-none="b">{realNotOffered(b.symbol)}</p>}
      </div>
    );
    if (phase === "which") return (
      <section className="space-y-3" aria-label="Coin vs Coin" data-guided-step="which" data-derby-guided="pair">
        {stepHead("which")}
        {kindChoice}
        <p className="text-xs text-neutral-300" data-derby-explainer>The two coins you pick are <b>reference feeds</b>. Burnticker reads their published feeds{realOn ? ". By default it never trades or burns them; on the next step each side can choose to burn the real coin instead of itself" : " and never trades or burns them"}. Launching creates two <b>new</b> coins, and their own trading fees pay for their burns.</p>
        <div className="grid min-w-0 gap-3 md:grid-cols-2">
          <CoinPicker key={`a-${initial.a}`} initial={initial.a} label={flip ? "Reference coin A, the one that may pass the other" : "Reference coin A"} value={a} onPick={setA} exclude={b} locked={busy || !!prepared} />
          <CoinPicker key={`b-${initial.b}`} initial={initial.b} label={flip ? "Reference coin B, the one that may be passed" : "Reference coin B"} value={b} onPick={setB} exclude={a} locked={busy || !!prepared} />
        </div>
        <p className="text-[11px] text-neutral-500" data-same-coin>{edgeCase(74)}</p>
        {picksMoved && <p className="text-xs text-amber-300" role="status" data-picks-moved>{edgeCase(96)}</p>}
        {pairCheckLine}
        {next("Next", "burn", !a?.underlying || !b?.underlying || pairRefused)}
      </section>
    );
    if (phase === "burn") {
      // HS-40 (hourly run 7): the two cards named by cadence, in the pair sentence's words, with the race's own daily share
      const cards = coinVsCardWords(shares.daily, seasonDays);
      const options = po.options.map((o) => (o.id === "once" ? { ...o, ...cards.once } : o.id === "winner" ? { ...o, ...cards.race } : o));
      // website-26 (WIRING-FEATURES item 14): the run length beside the share presets
      const runRow = (
        <div className="flex min-w-0 flex-wrap items-center gap-2" role="radiogroup" aria-label="How long it runs" data-run-presets>
          <span className="text-xs text-neutral-500">How long it runs</span>
          {DERBY_RUN_PRESETS.map((d) => <button key={d} type="button" role="radio" aria-checked={seasonDays === d} data-optional="preset" disabled={busy || !!prepared} onClick={() => setSeasonDays(d)} className={`rounded-full border px-3 py-1 text-sm ${seasonDays === d ? "border-amber-400 bg-amber-400 text-neutral-950" : "border-neutral-700"}`}>{runPresetLabel(d)}</button>)}
        </div>
      );
      return (
        <div data-derby-guided="pair">
          <PatternStep preview={<>{lead && <p className="font-medium text-amber-200" data-fight-lead>{lead}</p>}<p>{sentence ?? "Reading the two coins."}</p></>} options={options} value={flip ? "once" : "winner"} onPick={(id) => setFlip(id === "once")} shares={shareRow} share={fraction} onShare={setFraction} shareLine={flip ? LINKED_ONE_SHOT_LINE : null} notice={flip ? shareMigrated : null} pairLabel
            extra={<>{runRow}<p className="text-xs text-neutral-300" data-share-memory>{derbyShareLine(shares.daily, shares.flip)}</p>{pairCheckLine}{realChoices}{end && !endSaid && <div className="space-y-0.5 text-xs text-neutral-300" data-end-sentences><p className="font-medium text-neutral-200">At the end</p>{end.sentences.map((x) => <p key={x}>{x}</p>)}</div>}</>}
            next={next("Next", "name", !model?.rule || pairRefused)} />
        </div>
      );
    }
    if (!model?.rule) return <section className="space-y-3" data-derby-guided="pair"><p className="text-sm text-neutral-300">Reading the two coins.</p>{next("Back to the coins", "which")}</section>;
    if (phase === "name") return (
      <div data-derby-guided="pair">
        <ReviewCard mode="name" coins={coinsNow} sentence={sentence!} ends={null} shares={{ options: [...shareRow], value: fraction, onChange: () => {} }} problems={[]} error={null} busy={false} ready={ready} creator={creator || null} onLaunch={() => {}}
          image={<div className="grid min-w-0 gap-2 md:grid-cols-2" data-pair-images>{imagesDropped && !profA.image && !profB.image && <p className="text-xs text-amber-300 md:col-span-2" data-image-not-kept>{IMAGE_NOT_KEPT}</p>}<ProfileFields value={profA} onChange={setProfA} part="image" who={`$${TA}`} customImages={customImages} side="a" /><ProfileFields value={profB} onChange={setProfB} part="image" who={`$${TB}`} customImages={customImages} pasteTarget={false} side="b" /></div>}
          profile={<div className="grid min-w-0 gap-2 md:grid-cols-2"><ProfileFields value={profA} onChange={setProfA} part="text" who={`$${TA}`} side="a" generated={reviewCurrent ? shown.review?.coins?.[0]?.description ?? null : null} /><ProfileFields value={profB} onChange={setProfB} part="text" who={`$${TB}`} side="b" /></div>}
          tickerChecks={reviewCurrent ? (shown.review as (LaunchReview & { tickers?: TickerCheck[] }) | null)?.tickers ?? null : null}
          profileProblems={blockers} next={next("Review", "review", nameBlockedP, nameBlockedP ? (rightsMissing ? IMAGE_RIGHTS_REQUIRED : NAME_STEP_BLOCKED) : null)} />
      </div>
    );
    const x = derbyExplainer(model.spec, { a: TA, b: TB });
    const bud = budgetCopy(model.rule, fraction, null);
    const reviewVenue = venue === "pair-curve" ? "pair-curve" as const : "linked" as const;
    return (
      <div className="space-y-3" data-derby-guided="pair">
        {!out && !pcOut && <ReviewCard mode="review"
          signs={shown.review?.transactions.count ? walletPromptCount({ transactions: shown.review.transactions.count, proof: !wallet.connected || !!wallet.signMessage }) : null} signsProof={!wallet.connected || !!wallet.signMessage}
          edgeNotes={((model.rule.derby as { flip?: boolean } | undefined)?.flip ? COINVS_EDGE_IDS.flip : COINVS_EDGE_IDS.race).map((i) => edgeCase(i)).filter((x): x is string => !!x)}
          upfront={pairUpfrontLines(reviewVenue, RAISE_PRESETS_SOL, shown.review?.prerequisiteLine ?? null)}
          facts={[
            { label: FACT_LABELS.trigger, value: triggerText({ pair: { a: TA, b: TB, oneA: ruleOneLiner(model.rule), oneB: ruleB ? ruleOneLiner(ruleB) : "" }, fallback: sentence! }), edit: () => onPhase?.("which") },
            { label: FACT_LABELS.coin, value: whichCoinLine(TA, TB, true), edit: () => onPhase?.("name") },
            { label: FACT_LABELS.amount, value: `${bud.line} ${shareOfBudgetLine(fraction)} ${shareExample(fraction)}`, edit: () => onPhase?.("burn") },
            { label: FACT_LABELS.ends, value: ends ?? "", edit: null },
            { label: FACT_LABELS.cost, value: costLine(shown.review && reviewCurrent ? shown.review.costs.totalSol : null, 2), edit: null },
          ]}
          publicProfile={{ coins: [
            { side: "a", image: coinsNow[0].image, name: names.a, ticker: names.ta, description: profA.description, links: profileBody(profA).links, note: null },
            { side: "b", image: coinsNow[1].image, name: names.b, ticker: names.tb, description: profB.description, links: profileBody(profB).links, note: null },
          ], edit: () => onPhase?.("name") }}
          lead={lead} simulator={reviewCurrent && shown.review?.simulation ? <SimulatorDisclosure simulation={shown.review.simulation} rule={model.rule} /> : null}
          coins={coinsNow} sentence={sentence!} pairLine={PAIR_REVIEW_LINE} pairFacts={winnerTakesBurnFacts(TA, TB)} pairDiagram="linked" pairDiagramText={pairDiagramLabel(model.rule, true)} venue={reviewVenue} ends={ends}
          notes={[x.window, x.tie, ...realReviewNotes(realList)]}
          shares={{ options: [...shareRow], value: fraction, onChange: setFraction }}
          raise={shown.review?.raise ? { options: [...RAISE_PRESETS_SOL], value: raiseSol, onChange: setRaiseSol, line: shown.review.raise.line } : null}
          graduation={shown.review?.graduation ?? null}
          profileProblems={blockers} problems={ruleProblemsP} error={err} busy={busy} ready={ready} creator={creator || null} onLaunch={() => { void launch(); }}
          /* website-25 (QA 11 H4): the server's two-coin estimate for the venue it reviewed, said with that venue and the server's own note */
          mintSearch={<MintAddressBlock pool={mintPool} />}
          cost={shown.review && reviewCurrent ? pairCostSentence(shown.review.costs.totalSol, shown.review.venue) : null} costNote={shown.review?.venue === "pair-curve" ? shown.review.costs.note : PAIR_COST_EXCLUSIONS}
          summary={<PreWalletSummary review={shown.review} loading={shown.loading} error={shown.error} updating={slot.rev !== reviewKey && !!slot.review} proof={!wallet.connected || !!wallet.signMessage} />}
          blocked={blocked ?? (reviewCurrent ? null : REVIEW_UPDATING)} />}
        {!out && !pcOut && <details className="text-xs text-neutral-300" data-projection data-past-burns><summary className="cursor-pointer">{PAST_BURNS_HEADING}</summary>{pastBurnsLines({ loading: shown.loading || !!(pairCheck?.busy && pairCheck.key === pairCheckKey), error: shown.error, projection: reviewCurrent ? (shown.review as (LaunchReview & { projection?: { available: boolean; lines: string[]; reason: string | null } | null }) | null)?.projection : null }).map((x) => <p key={x} className="mt-1" role="status">{x}</p>)}</details>}
        {!out && !pcOut && <details className="text-xs text-neutral-300"><summary className="cursor-pointer">What this creates, in full</summary><ul className="mt-1 min-w-0 list-disc space-y-0.5 break-words pl-5" aria-label="What this creates" data-derby-facts><li>{realList.length ? `${model.spec.a.symbol} and ${model.spec.b.symbol} are reference feeds. ${realReadSentence({ a: model.spec.a.symbol, b: model.spec.b.symbol }, realList)}` : x.references}</li><li>{x.created}</li><li>{x.window}</li><li>{x.start}</li><li>{x.end}</li><li>{x.tie}</li><li>{x.missing}</li>{flip && <li>{edgeCase(66)}</li>}{flip && <li>{edgeCase(70)}</li>}<li>{edgeCase(72)}</li><li>{edgeCase(62)}</li>{realList.map((r) => <li key={r.ticker} data-burn-real-fact>${r.ticker}: {targetActionSentence(r.symbol)}</li>)}</ul></details>}
        {prepared && signPlan && <SignCard plan={signPlan} creator={creator || null} title={`Launch $${prepared.tickers.a} and $${prepared.tickers.b}`} coinHref={coinCanonicalHref} onStartOver={() => { setOut(null); setPcOut(null); setErr(null); setNow(Date.now()); }} />}
        {(pcOut || out) && <p className="text-xs"><a className="underline" href={`/burnticker/p/${(pcOut ?? out)!.pairId}`}>Open the pair page →</a></p>}
      </div>
    );
  }
}
