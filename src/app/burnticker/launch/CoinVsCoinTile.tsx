"use client";

import { useEffect, useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { FieldHelp } from "../_components/FieldHelp";
import { ruleOneLiner } from "@/lib/burnticker/coinCard";
import { ReviewCard } from "./ReviewCard";
import type { BurnRule } from "@/lib/burnticker/rules";
import type { DerbyUnderlying } from "@/lib/burnticker/derby/spec";
import { defaultName, defaultTicker, sha256HexWeb, tileHashInput, tileRule, tileSpec, type TileChoice } from "@/lib/burnticker/derby/tile";
import { postPairLaunch, venueFrom409, type PairVenue } from "@/lib/burnticker/pairLaunchClient";
import type { PairCurveLaunchBundle } from "@/lib/burnticker/pairCurveLaunch";
import { PairCurveSign } from "./PairCurveSign";

/**
 * "COIN VS COIN" — the Burn Derby wizard tile (2026-10-10; cut to presets the same day, the owner: "the UI needs to be simpler, even if it
 * means giving up a little bit of adjustability"). Pick two coins (Pyth's catalogue + Jupiter's token list, through
 * GET /api/burnticker/v1/derby/search) → the review card (ReviewCard.tsx: generated art, names, the sentence, "runs for 30 days, then
 * winds down", 2 / 5 / 10 %) → Launch. Daily windows and a 30-day run are fixed here; weekly windows, other lengths and brackets are
 * API-only (POST /api/burnticker/v1/launch/bundle with a derby rule). The flippening is its own template (?template=flippening), never
 * a checkbox. Launch posts the pair to /api/burnticker/launch — side A on "A wins", side B derived by inversion.
 */

interface Hit { symbol: string; name: string; source: "pyth" | "jupiter"; assetType: string; feed: string | null; mint: string | null; liquidityUsd: number | null; verified: boolean; underlying: DerbyUnderlying | null; why: string | null }
interface Bundle { mint: string; ticker: string; ready: boolean; pending: string[]; rules: { sha256: string; statement: string } }

function CoinPicker({ label, value, onPick, exclude, initial }: { label: string; value: Hit | null; onPick: (h: Hit | null) => void; exclude: string | null; initial?: string }) {
  const [q, setQ] = useState(initial ?? ""), [hits, setHits] = useState<Hit[]>([]), [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const s = q.trim();
    if (s.length < 2) { setHits([]); return; }
    const t = setTimeout(() => {
      setBusy(true); setErr(null);
      fetch(`/api/burnticker/v1/derby/search?q=${encodeURIComponent(s)}`).then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? r.statusText); setHits(j.hits ?? []); }).catch((e) => setErr(String(e.message ?? e))).finally(() => setBusy(false));
    }, 300);
    return () => clearTimeout(t);
  }, [q]);
  if (value) return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-3 text-sm flex items-center justify-between gap-2">
      <div><div className="text-xs text-neutral-400">{label}</div><div className="font-semibold">{value.symbol} <span className="text-xs text-neutral-500 font-normal">{value.source === "pyth" ? "Pyth feed" : "pool TWAP"} · cross-read {value.underlying?.cross.split(":")[0] ?? "—"}</span></div></div>
      <button className="text-xs underline" data-decision="what" onClick={() => onPick(null)}>change</button>
    </div>
  );
  return (
    <div className="space-y-2">
      <label className="block text-xs text-neutral-400">{label}<FieldHelp id="derby-coin" /><input data-help="derby-coin" data-decision="what" className="mt-1 w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm" placeholder="a ticker, a name or a mint — WIF, BONK, SHIB…" value={q} onChange={(e) => setQ(e.target.value)} /></label>
      {busy && <p className="text-xs text-neutral-500">Searching…</p>}
      {err && <p className="text-xs text-red-400">{err}</p>}
      <ul className="max-h-56 overflow-y-auto divide-y divide-neutral-800 rounded border border-neutral-800">
        {hits.filter((h) => h.symbol !== exclude).map((h) => (
          <li key={`${h.source}:${h.feed ?? h.mint}`}>
            <button disabled={!h.underlying} data-decision="what" onClick={() => onPick(h)} className={`w-full text-left px-2 py-1.5 text-sm ${h.underlying ? "hover:bg-neutral-900" : "opacity-60 cursor-not-allowed"}`}>
              <span className="font-medium">{h.symbol}</span> <span className="text-xs text-neutral-500">{h.name}</span> <span className="ml-1 rounded bg-neutral-800 px-1.5 text-[10px]">{h.source === "pyth" ? "Pyth" : "Jupiter"}</span>
              {h.why && <span className="block text-[11px] text-neutral-500">{h.why}</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function CoinVsCoinTile({ pairCurve = false }: { pairCurve?: boolean } = {}) {
  const wallet = useWallet();
  const [open, setOpen] = useState(false);
  // `/burnticker/launch?derby=1&a=WIF&b=SHIB` (the Burn Derby page and the search card) opens the tile with both searches filled in.
  const [initial, setInitial] = useState<{ a: string; b: string }>({ a: "", b: "" });
  useEffect(() => {
    const u = new URLSearchParams(window.location.search);
    if (u.get("derby") === "1") { setOpen(true); setInitial({ a: (u.get("a") ?? "").slice(0, 12), b: (u.get("b") ?? "").slice(0, 12) }); }
    // the templates gallery: coin-vs-coin, bracket (a Coin vs Coin season; the operator registers the bracket) and the flippening
    const tpl = u.get("template");
    if (tpl === "coin-vs-coin" || tpl === "bracket" || tpl === "flippening") { setOpen(true); if (tpl === "flippening") setFlip(true); }
  }, []);
  const [a, setA] = useState<Hit | null>(null), [b, setB] = useState<Hit | null>(null);
  // fixed on the web: daily windows, a 30-day run; the share is a preset (2 / 5 / 10 %, default 2 %); the flippening only via its template
  const window_ = "daily" as const, seasonDays = 30;
  const [flip, setFlip] = useState(false), [fraction, setFraction] = useState(0.02);
  const [names, setNames] = useState({ a: "", b: "", ta: "", tb: "" });
  const [hash, setHash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null), [out, setOut] = useState<{ pairId: string; a: Bundle; b: Bundle; notes: string[] } | null>(null);
  const creator = wallet.publicKey?.toBase58() ?? "";
  const now = useMemo(() => Date.now(), []);
  useEffect(() => { if (a) setNames((n) => ({ ...n, a: n.a || defaultName(a.symbol), ta: n.ta || defaultTicker(a.symbol) })); }, [a]);
  useEffect(() => { if (b) setNames((n) => ({ ...n, b: n.b || defaultName(b.symbol), tb: n.tb || defaultTicker(b.symbol) })); }, [b]);
  const choice: TileChoice | null = a?.underlying && b?.underlying ? { a: a.underlying, b: b.underlying, window: window_, seasonDays, flip, fraction, now } : null;
  useEffect(() => { setHash(null); if (choice) sha256HexWeb(tileHashInput(choice)).then(setHash).catch(() => setHash(null)); }, [a, b, flip, fraction]); // eslint-disable-line react-hooks/exhaustive-deps
  const model = choice && hash ? tileRule(choice, hash, { a: names.ta.toUpperCase(), b: names.tb.toUpperCase() }) : null;
  const ruleB: BurnRule | null = model?.rule ? { ...model.rule, binary: { onYes: null, onNo: model.rule.binary!.onYes } } : null;
  const b64u = (x: string) => btoa(unescape(encodeURIComponent(x))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  /** The generated receipt art for a rule not launched yet (coinArt.ts via /burnticker/img/preview.svg), never "NO IMAGE". */
  const art = (r: BurnRule | null, tk: string) => (r ? `/burnticker/img/preview.svg?r=${b64u(JSON.stringify(r))}&t=${encodeURIComponent(tk || "TICKER")}&l=${encodeURIComponent(ruleOneLiner(r).slice(0, 120))}` : "");
  const ends = choice ? (() => { const s = tileSpec(choice).season; const end = new Date(Date.parse(`${s.start}T00:00:00Z`) + s.days * 86_400_000); return `${end.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })} (after ${s.days} days), then winds down`; })() : null;

  // review N6: the venue this host uses for a pair (catalogue venues.pairCurve, passed down by the page). The venue is not shown before
  // launch (the owner's cut list); a 409 naming the other venue switches it and the build is retried once.
  const [venue, setVenue] = useState<PairVenue>(pairCurve ? "pair-curve" : "launchlab");
  useEffect(() => { setVenue(pairCurve ? "pair-curve" : "launchlab"); }, [pairCurve]);
  const [pcOut, setPcOut] = useState<{ pairId: string; pc: PairCurveLaunchBundle; keys: { a: string; b: string } | null; notes: string[] } | null>(null);
  const launch = async () => {
    if (!model?.rule || !creator) return;
    setBusy(true); setErr(null); setOut(null); setPcOut(null);
    const body = { creator, ticker: names.ta.toUpperCase(), name: names.a, description: model.sentence, imageUrl: null, links: [], rule: model.rule, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true }, pair: { ticker: names.tb.toUpperCase(), name: names.b, description: model.sentence, imageUrl: null, links: [] } };
    const run = async (v: PairVenue, retried: boolean): Promise<void> => {
      try {
        const j = await postPairLaunch((u, init) => fetch(u, init), body, v);
        if (j.venue === "pair-curve") setPcOut({ pairId: j.pair.pairId, pc: j.pairCurve, keys: j.mintSecretKeys, notes: j.pair.notes ?? [] });
        else setOut({ pairId: j.pair.pairId, a: j.bundles.a as Bundle, b: j.bundles.b as Bundle, notes: j.pair.notes ?? [] });
      } catch (e) { const nv = venueFrom409(e); if (nv && !retried) { setVenue(nv); return run(nv, true); } setErr(String((e as Error).message ?? e)); }
    };
    try { await run(venue, false); } finally { setBusy(false); }
  };

  const tileButton = (
    <button onClick={() => setOpen(true)} data-decision="what" className="w-full text-left rounded-xl border border-neutral-800 bg-neutral-900 p-5 hover:border-amber-400 focus:border-amber-400 focus:outline-none" aria-label="Coin vs Coin">
      <div className="text-lg font-semibold">Coin vs Coin <span className="ml-1 rounded bg-amber-400/15 px-1.5 text-xs text-amber-300 align-middle">Burn Derby</span></div>
      <p className="mt-1 text-sm text-neutral-300">Two coins people already hold race every day. The winner&apos;s coin burns.</p>
      <p className="mt-3 text-xs text-neutral-500">e.g. $TEAMWIF burns every day WIF out-gains SHIB (Pyth, 00:00 UTC)</p>
    </button>
  );
  if (!open) return tileButton;
  const ready = !!model?.rule && !model.problems.length && /^[A-Z0-9]{2,10}$/.test(names.ta) && /^[A-Z0-9]{2,10}$/.test(names.tb) && names.ta !== names.tb && !!names.a.trim() && !!names.b.trim();
  return (
    <section className="rounded-xl border border-amber-400/60 bg-neutral-900 p-4 space-y-4 sm:col-span-2" aria-label="Coin vs Coin">
      <div className="flex items-center justify-between"><h3 className="text-lg font-semibold">{flip ? "Flippening" : "Coin vs Coin"}</h3><span className="flex gap-3 text-xs"><a className="underline" href="/burnticker/derby">Burn Derby pairs and brackets →</a><button className="underline" data-nav onClick={() => setOpen(false)}>close</button></span></div>
      <div className="grid gap-3 md:grid-cols-2">
        <CoinPicker key={`a-${initial.a}`} initial={initial.a} label={flip ? "The coin that would pass" : "Coin A"} value={a} onPick={setA} exclude={b?.symbol ?? null} />
        <CoinPicker key={`b-${initial.b}`} initial={initial.b} label={flip ? "The coin it would pass" : "Coin B"} value={b} onPick={setB} exclude={a?.symbol ?? null} />
      </div>
      {model && !out && !pcOut && (
        <ReviewCard
          coins={[
            { key: "a", name: names.a, ticker: names.ta, onName: (v) => setNames((n) => ({ ...n, a: v })), onTicker: (v) => setNames((n) => ({ ...n, ta: v })), image: art(model.rule, names.ta), oneLiner: model.rule ? ruleOneLiner(model.rule) : "", oracle: "derby", badge: null },
            { key: "b", name: names.b, ticker: names.tb, onName: (v) => setNames((n) => ({ ...n, b: v })), onTicker: (v) => setNames((n) => ({ ...n, tb: v })), image: art(ruleB, names.tb), oneLiner: ruleB ? ruleOneLiner(ruleB) : "", oracle: "derby", badge: null },
          ]}
          sentence={model.sentence}
          ends={ends}
          shares={{ options: [0.02, 0.05, 0.1], value: fraction, onChange: setFraction }}
          problems={model.problems}
          error={err}
          busy={busy}
          ready={ready}
          creator={creator || null}
          onLaunch={() => { void launch(); }}
        />
      )}
      {pcOut && <PairCurveSign pc={pcOut.pc} mintKeys={pcOut.keys} creator={creator || null} tickers={{ a: names.ta.toUpperCase(), b: names.tb.toUpperCase() }} notes={pcOut.notes} />}
      {pcOut && <p className="text-xs"><a className="underline" href={`/burnticker/p/${pcOut.pairId}`}>Open the pair page →</a></p>}
      {out && <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-3 text-xs space-y-1"><div>Pair <code>{out.pairId}</code>: ${out.a.ticker} + ${out.b.ticker} — both coins are built; sign A first, then B.</div>{[out.a, out.b].map((x) => <div key={x.mint}>${x.ticker} · mint <code>{x.mint}</code> {x.ready ? "" : `· not signable yet: ${x.pending.join("; ")}`}</div>)}<a className="underline" href={`/burnticker/p/${out.pairId}`}>Open the pair page →</a></div>}
    </section>
  );
}
