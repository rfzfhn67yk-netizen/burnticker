"use client";

import { useEffect, useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { CoinCard } from "../_components/CoinCard";
import { FieldHelp } from "../_components/FieldHelp";
import { ruleOneLiner } from "@/lib/burnticker/coinCard";
import type { BurnRule } from "@/lib/burnticker/rules";
import type { DerbyUnderlying } from "@/lib/burnticker/derby/spec";
import { defaultName, defaultTicker, sha256HexWeb, tileHashInput, tileRule, type TileChoice } from "@/lib/burnticker/derby/tile";

/**
 * "COIN VS COIN" — the Burn Derby wizard tile (2026-10-10). Self-contained: the choose screen renders it under the other tiles (one
 * line in page.tsx); opening it expands this panel. Pick two coins (Pyth's catalogue + Jupiter's token list, through
 * GET /api/burnticker/v1/derby/search — each hit carries the underlying the rule locks), a window (daily / weekly), a season length
 * (30 days by default) and, optionally, the one-shot flippening; both coin cards preview live; the review sentence is generated from
 * the same model the server validates (src/lib/burnticker/derby/tile.ts). Launch posts the pair to /api/burnticker/launch — side A on
 * "A wins", side B derived by inversion — and shows both unsigned bundles. Nothing is signed or sent here.
 */

interface Hit { symbol: string; name: string; source: "pyth" | "jupiter"; assetType: string; feed: string | null; mint: string | null; liquidityUsd: number | null; verified: boolean; underlying: DerbyUnderlying | null; why: string | null }
interface Bundle { mint: string; ticker: string; ready: boolean; pending: string[]; rules: { sha256: string; statement: string } }
const PUB = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

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
      <button className="text-xs underline" onClick={() => onPick(null)}>change</button>
    </div>
  );
  return (
    <div className="space-y-2">
      <label className="block text-xs text-neutral-400">{label}<FieldHelp id="derby-coin" /><input data-help="derby-coin" className="mt-1 w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm" placeholder="a ticker, a name or a mint — WIF, BONK, SHIB…" value={q} onChange={(e) => setQ(e.target.value)} /></label>
      {busy && <p className="text-xs text-neutral-500">Searching…</p>}
      {err && <p className="text-xs text-red-400">{err}</p>}
      <ul className="max-h-56 overflow-y-auto divide-y divide-neutral-800 rounded border border-neutral-800">
        {hits.filter((h) => h.symbol !== exclude).map((h) => (
          <li key={`${h.source}:${h.feed ?? h.mint}`}>
            <button disabled={!h.underlying} onClick={() => onPick(h)} className={`w-full text-left px-2 py-1.5 text-sm ${h.underlying ? "hover:bg-neutral-900" : "opacity-60 cursor-not-allowed"}`}>
              <span className="font-medium">{h.symbol}</span> <span className="text-xs text-neutral-500">{h.name}</span> <span className="ml-1 rounded bg-neutral-800 px-1.5 text-[10px]">{h.source === "pyth" ? "Pyth" : "Jupiter"}</span>
              {h.why && <span className="block text-[11px] text-neutral-500">{h.why}</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function CoinVsCoinTile() {
  const wallet = useWallet();
  const [open, setOpen] = useState(false);
  // `/burnticker/launch?derby=1&a=WIF&b=SHIB` (the Burn Derby page and the search card) opens the tile with both searches filled in.
  const [initial, setInitial] = useState<{ a: string; b: string }>({ a: "", b: "" });
  useEffect(() => {
    const u = new URLSearchParams(window.location.search);
    if (u.get("derby") === "1") { setOpen(true); setInitial({ a: (u.get("a") ?? "").slice(0, 12), b: (u.get("b") ?? "").slice(0, 12) }); }
  }, []);
  const [a, setA] = useState<Hit | null>(null), [b, setB] = useState<Hit | null>(null);
  const [window_, setWindow] = useState<"daily" | "weekly">("daily"), [seasonDays, setSeasonDays] = useState(30), [flip, setFlip] = useState(false), [fraction, setFraction] = useState(0.01);
  const [names, setNames] = useState({ a: "", b: "", ta: "", tb: "" });
  const [hash, setHash] = useState<string | null>(null);
  const [pasted, setPasted] = useState(""), [ackLocked, setAckLocked] = useState(false), [ackNoReturns, setAckNoReturns] = useState(false);
  const [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null), [out, setOut] = useState<{ pairId: string; a: Bundle; b: Bundle; notes: string[] } | null>(null);
  const creator = wallet.publicKey?.toBase58() ?? (PUB.test(pasted.trim()) ? pasted.trim() : "");
  const now = useMemo(() => Date.now(), []);
  useEffect(() => { if (a) setNames((n) => ({ ...n, a: n.a || defaultName(a.symbol), ta: n.ta || defaultTicker(a.symbol) })); }, [a]);
  useEffect(() => { if (b) setNames((n) => ({ ...n, b: n.b || defaultName(b.symbol), tb: n.tb || defaultTicker(b.symbol) })); }, [b]);
  const choice: TileChoice | null = a?.underlying && b?.underlying ? { a: a.underlying, b: b.underlying, window: window_, seasonDays, flip, fraction, now } : null;
  useEffect(() => { setHash(null); if (choice) sha256HexWeb(tileHashInput(choice)).then(setHash).catch(() => setHash(null)); }, [a, b, window_, seasonDays, flip, fraction]); // eslint-disable-line react-hooks/exhaustive-deps
  const model = choice && hash ? tileRule(choice, hash, { a: names.ta.toUpperCase(), b: names.tb.toUpperCase() }) : null;
  const ruleB: BurnRule | null = model?.rule ? { ...model.rule, binary: { onYes: null, onNo: model.rule.binary!.onYes } } : null;
  const card = (nm: string, tk: string, r: BurnRule | null) => <CoinCard href={null} c={{ ticker: tk || "TICKER", name: nm || "Name", imageUrl: null, oneLiner: r ? ruleOneLiner(r) : "pick two coins", oracle: "derby", status: "draft", phase: null, progressPct: 0, raised: null, threshold: null, quote: "SOL", burns: 0, lastBurnAt: null, nextAt: null, launchedAt: null, curveNote: "a new coin starts at 0% of its bonding curve" }} />;

  const launch = async () => {
    if (!model?.rule) return;
    setBusy(true); setErr(null); setOut(null);
    try {
      const r = await fetch("/api/burnticker/launch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ creator, ticker: names.ta.toUpperCase(), name: names.a, description: model.sentence, imageUrl: null, links: [], rule: model.rule, firstBuySol: "0", acknowledgements: { ruleLocked: ackLocked, noReturns: ackNoReturns }, pair: { ticker: names.tb.toUpperCase(), name: names.b, description: model.sentence, imageUrl: null, links: [] } }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? r.statusText);
      setOut({ pairId: j.pair.pairId, a: j.bundles.a, b: j.bundles.b, notes: j.pair.notes ?? [] });
    } catch (e) { setErr(String((e as Error).message ?? e)); } finally { setBusy(false); }
  };

  const tileButton = (
    <button onClick={() => setOpen(true)} className="w-full text-left rounded-xl border border-neutral-800 bg-neutral-900 p-5 hover:border-amber-400 focus:border-amber-400 focus:outline-none" aria-label="Coin vs Coin">
      <div className="text-lg font-semibold">Coin vs Coin <span className="ml-1 rounded bg-amber-400/15 px-1.5 text-xs text-amber-300 align-middle">Burn Derby</span></div>
      <p className="mt-1 text-sm text-neutral-300">Two coins people already hold race every day. The winner&apos;s coin burns.</p>
      <p className="mt-3 text-xs text-neutral-500">e.g. $TEAMWIF burns every day WIF out-gains SHIB (Pyth, 00:00 UTC)</p>
    </button>
  );
  if (!open) return (
    <div className="space-y-1">
      {tileButton}
      <p className="text-xs text-neutral-500"><a className="underline" href="/burnticker/derby">See the open Burn Derby pairs and brackets →</a></p>
    </div>
  );
  return (
    <section className="rounded-xl border border-amber-400/60 bg-neutral-900 p-4 space-y-4" aria-label="Coin vs Coin">
      <div className="flex items-center justify-between"><h3 className="text-lg font-semibold">Coin vs Coin</h3><span className="flex gap-3 text-xs"><a className="underline" href="/burnticker/derby">Burn Derby pairs and brackets →</a><button className="underline" onClick={() => setOpen(false)}>close</button></span></div>
      <div className="grid gap-3 md:grid-cols-2">
        <CoinPicker key={`a-${initial.a}`} initial={initial.a} label="Coin A (side A burns when it wins)" value={a} onPick={setA} exclude={b?.symbol ?? null} />
        <CoinPicker key={`b-${initial.b}`} initial={initial.b} label="Coin B (side B burns when it wins)" value={b} onPick={setB} exclude={a?.symbol ?? null} />
      </div>
      <div className="grid gap-3 md:grid-cols-4 text-sm">
        <label className="text-xs text-neutral-400">Window<FieldHelp id="derby-window" /><select data-help="derby-window" className="mt-1 w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm" value={window_} onChange={(e) => setWindow(e.target.value as "daily" | "weekly")}><option value="daily">daily (00:00 → 00:00 UTC)</option><option value="weekly">weekly (Monday → Monday)</option></select></label>
        <label className="text-xs text-neutral-400">Season (days)<FieldHelp id="derby-season" /><input data-help="derby-season" type="number" min={window_ === "weekly" ? 7 : 1} max={366} step={window_ === "weekly" ? 7 : 1} className="mt-1 w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm" value={seasonDays} onChange={(e) => setSeasonDays(Number(e.target.value) || 30)} /></label>
        <label className="text-xs text-neutral-400">Burn per winning window: {(fraction * 100).toFixed(0)}%<FieldHelp id="derby-share" /><input data-help="derby-share" type="range" min={0.01} max={0.1} step={0.01} className="mt-2 w-full" value={fraction} onChange={(e) => setFraction(Number(e.target.value))} /></label>
        <label className="text-xs text-neutral-400 flex items-center gap-2 mt-5"><FieldHelp id="derby-measure" /><input data-help="derby-measure" type="checkbox" checked={flip} onChange={(e) => setFlip(e.target.checked)} /> one-shot flippening (market cap; both coins need a Solana mint)</label>
      </div>
      <div className="grid gap-3 md:grid-cols-2 text-sm">
        {(["a", "b"] as const).map((k) => (
          <div key={k} className="grid grid-cols-2 gap-2">
            <label className="text-xs text-neutral-400">Name {k.toUpperCase()}<FieldHelp id="derby-name" /><input data-help="derby-name" className="mt-1 w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm" value={names[k]} onChange={(e) => setNames({ ...names, [k]: e.target.value })} /></label>
            <label className="text-xs text-neutral-400">Ticker {k.toUpperCase()}<FieldHelp id="derby-ticker" /><input data-help="derby-ticker" className="mt-1 w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm uppercase" value={k === "a" ? names.ta : names.tb} onChange={(e) => setNames({ ...names, [k === "a" ? "ta" : "tb"]: e.target.value.toUpperCase() })} /></label>
          </div>
        ))}
      </div>
      <div className="grid gap-3 md:grid-cols-2" aria-label="Preview">
        <div className="bt-preview-frame">{card(names.a, names.ta, model?.rule ?? null)}</div>
        <div className="bt-preview-frame">{card(names.b, names.tb, ruleB)}</div>
      </div>
      {model && <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-3 text-sm"><div className="text-xs text-neutral-400 mb-1">Review</div><p>{model.sentence}</p>{model.problems.length > 0 && <ul className="mt-2 text-xs text-red-400 list-disc pl-4">{model.problems.map((x) => <li key={x}>{x}</li>)}</ul>}<p className="mt-2 text-xs text-neutral-500">A tie burns neither coin (a receipt still posts). If the independent cross-read disagrees by more than 2 points, that window is withheld: no reading, no burn. Both or neither: burns start once both coins have a pool; if one has none by the void date, the pair voids.</p></div>}
      <div className="space-y-2 text-sm">
        {!wallet.publicKey && <label className="block text-xs text-neutral-400">Creator wallet (public key)<FieldHelp id="wallet-paste" /><input data-help="wallet-paste" className="mt-1 w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm" value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="connect a wallet above, or paste a public key" /></label>}
        <label className="flex items-center gap-2 text-xs"><FieldHelp id="ack-locked" /><input data-help="ack-locked" type="checkbox" checked={ackLocked} onChange={(e) => setAckLocked(e.target.checked)} /> I understand the rules cannot be changed by anyone, including me</label>
        <label className="flex items-center gap-2 text-xs"><FieldHelp id="ack-no-returns" /><input data-help="ack-no-returns" type="checkbox" checked={ackNoReturns} onChange={(e) => setAckNoReturns(e.target.checked)} /> I am not promising anyone anything</label>
        <button disabled={!model?.rule || !creator || !ackLocked || !ackNoReturns || busy || !names.ta || !names.tb} onClick={launch} className="rounded bg-amber-400 px-4 py-2 text-sm font-semibold text-neutral-950 disabled:opacity-50">{busy ? "Building…" : "Build both coins"}</button>
        {err && <p className="text-xs text-red-400">{err}</p>}
      </div>
      {out && <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-3 text-xs space-y-1"><div>Pair <code>{out.pairId}</code>: ${out.a.ticker} + ${out.b.ticker} — unsigned bundles built; sign A first, then B.</div>{[out.a, out.b].map((x) => <div key={x.mint}>${x.ticker} · mint <code>{x.mint}</code> · rules sha256 {x.rules.sha256.slice(0, 12)}… {x.ready ? "" : `· not signable yet: ${x.pending.join("; ")}`}</div>)}{out.notes.map((n) => <div key={n} className="text-neutral-500">{n}</div>)}<a className="underline" href={`/burnticker/p/${out.pairId}`}>Open the pair page →</a></div>}
    </section>
  );
}
