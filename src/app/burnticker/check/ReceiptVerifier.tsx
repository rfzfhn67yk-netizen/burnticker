"use client";

import { useEffect, useState } from "react";
import { checkReceiptTx, jsonRpc, PUBLIC_RPC, type ReceiptCheckResult } from "@/lib/burnticker/trustpack/receiptCheck";
import { CHECK_COPY } from "@/lib/burnticker/trustpack/copy";

/**
 * THE RECEIPT VERIFIER, IN THE VISITOR'S BROWSER (trust pack, 2026-10-10). The sample list and the rules texts come from our API
 * (/api/burnticker/v1/check/receipts); everything that decides ✓ or ✗ is fetched by this component straight from the public Solana RPC
 * and the Treasury API (src/lib/burnticker/trustpack/receiptCheck.ts — no Buffer, no web3.js, the same code the server route runs).
 */
interface Sample { ticker: string; recordDate: string; units: number; status: string; signature: string; explorerUrl: string; evidence: string; rulesPath: string }
interface Samples { cluster: "devnet"; programId: string; rpc: string; receipts: Sample[]; rules: Record<string, string> }

const mark = (ok: boolean | null) => (ok === true ? "✓" : ok === false ? "✗" : "–");
const tone = (ok: boolean | null) => (ok === true ? "text-emerald-400" : ok === false ? "text-red-400" : "text-neutral-500");

export default function ReceiptVerifier({ card }: { card: string }) {
  const [samples, setSamples] = useState<Samples | null>(null);
  const [sig, setSig] = useState("");
  const [rpc, setRpc] = useState<string>(PUBLIC_RPC.devnet);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<ReceiptCheckResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { fetch("/api/burnticker/v1/check/receipts").then((r) => r.json()).then((j: Samples) => { setSamples(j); if (j.receipts[0]) setSig(j.receipts[0].signature); }).catch((e) => setErr(String(e))); }, []);

  async function run() {
    setBusy(true); setRes(null); setErr(null);
    try {
      const s = samples?.receipts.find((r) => r.signature === sig.trim());
      const out = await checkReceiptTx({
        signature: sig.trim(), cluster: "devnet", programId: samples?.programId ?? "AuQjoSgq7upmyPBv2itwy2TSZ1VjoVipyy4z9wd7zhMM",
        rpc: jsonRpc(rpc.trim(), window.fetch.bind(window)),
        rulesText: s ? samples?.rules[s.rulesPath] ?? null : null,
        fetchSource: (u) => window.fetch(u, { headers: { accept: "application/json" } }),
      });
      setRes(out);
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  }

  return (
    <section className={card} id="verify">
      <h2 className="font-medium">{CHECK_COPY.verifierTitle}</h2>
      <p className="text-xs text-neutral-300">{CHECK_COPY.verifierIntro}</p>
      <div className="mt-2 grid gap-2 text-xs">
        <label className="grid gap-1"><span className="text-neutral-400">Devnet receipt</span>
          <select className="rounded border border-neutral-700 bg-neutral-950 p-2" value={samples?.receipts.some((r) => r.signature === sig) ? sig : ""} onChange={(e) => setSig(e.target.value)}>
            <option value="">— paste a signature below —</option>
            {samples?.receipts.map((r) => <option key={r.signature} value={r.signature}>${r.ticker} · reading {r.recordDate} · {r.units} unit(s) · {r.status}</option>)}
          </select>
        </label>
        <label className="grid gap-1"><span className="text-neutral-400">Transaction signature</span>
          <input className="rounded border border-neutral-700 bg-neutral-950 p-2 font-mono break-all" value={sig} onChange={(e) => setSig(e.target.value)} spellCheck={false} placeholder="88 base58 characters" />
        </label>
        <label className="grid gap-1"><span className="text-neutral-400">RPC endpoint (any devnet RPC you trust)</span>
          <input className="rounded border border-neutral-700 bg-neutral-950 p-2 font-mono" value={rpc} onChange={(e) => setRpc(e.target.value)} spellCheck={false} />
        </label>
        <div><button type="button" disabled={busy || !sig.trim()} onClick={run} className="rounded bg-violet-700 px-3 py-2 text-white disabled:opacity-50">{busy ? "Checking…" : "Verify in this browser"}</button></div>
        <p className="text-neutral-500">{CHECK_COPY.verifierPrivacy} {CHECK_COPY.verifierScope}</p>
      </div>
      {err && <p className="mt-2 text-xs text-red-400">{err}</p>}
      {res && (
        <div className="mt-3 text-xs">
          <p className={res.verified ? "text-emerald-400" : "text-red-400"}>{res.verified ? "✓ Verified: every check that could run here passed." : "✗ Not verified: see the failed or unrun checks."} <a className="underline" href={res.facts.explorerUrl} target="_blank" rel="noreferrer">explorer</a></p>
          <ul className="mt-2 space-y-1">{res.checks.map((c) => <li key={c.id} className="grid grid-cols-[1.5rem_1fr] gap-1"><span className={`${tone(c.ok)} font-mono`}>{mark(c.ok)}</span><span><span className="text-neutral-200">{c.label}</span> — <span className="text-neutral-400 break-words">{c.detail}</span></span></li>)}</ul>
          <p className="mt-2 text-neutral-500">{CHECK_COPY.legend}</p>
          {res.facts.memo && <pre className="mt-2 whitespace-pre-wrap break-all rounded bg-neutral-950 p-2">{res.facts.memo}</pre>}
          <p className="mt-1 text-neutral-500">Reading <code>{res.facts.readingAddress ?? "—"}</code> · TokenConfig <code>{res.facts.configAddress ?? "—"}</code> · mint <code>{res.facts.mint ?? "—"}</code>{res.facts.sourceUrl && <> · source <a className="underline break-all" href={res.facts.sourceUrl} target="_blank" rel="noreferrer">{res.facts.recordDate}</a> / <a className="underline" href={res.facts.prevSourceUrl ?? "#"} target="_blank" rel="noreferrer">{res.facts.prevDate}</a></>}</p>
        </div>
      )}
    </section>
  );
}
