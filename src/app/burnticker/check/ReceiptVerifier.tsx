"use client";

import { useEffect, useState } from "react";
import { checkReceiptTx, jsonRpc, PUBLIC_RPC, type ReceiptCheckResult } from "@/lib/burnticker/trustpack/receiptCheck";
import { CHECK_COPY } from "@/lib/burnticker/trustpack/copy";
import { verdictOf, type CheckStatus } from "@/lib/burnticker/verificationStatus";
import { EmptyState } from "../_components/EmptyState";

/**
 * THE RECEIPT VERIFIER, IN THE VISITOR'S BROWSER (trust pack, 2026-10-10). The sample list and the rules texts come from our API
 * (/api/burnticker/v1/check/receipts); everything that decides ✓ or ✗ is fetched by this component straight from the public Solana RPC
 * and the Treasury API (src/lib/burnticker/trustpack/receiptCheck.ts — no Buffer, no web3.js, the same code the server route runs).
 */
interface Sample { ticker: string; recordDate: string; units: number; status: string; signature: string; explorerUrl: string; evidence: string; rulesPath: string }
interface Samples { cluster: "devnet"; programId: string; rpc: string; receipts: Sample[]; rules: Record<string, string>; featured?: string | null }

const MARK: Record<CheckStatus, string> = { passed: "✓", failed: "✗", unavailable: "?", "not checked": "–" };
const TONE: Record<CheckStatus, string> = { passed: "text-emerald-400", failed: "text-red-400", unavailable: "text-amber-300", "not checked": "text-neutral-500" };
const VERDICT_TONE = { verified: "text-emerald-400", "partly verified": "text-emerald-300", "could not check": "text-amber-300", failed: "text-red-400" } as const;

export default function ReceiptVerifier({ card }: { card: string }) {
  const [samples, setSamples] = useState<Samples | null>(null);
  const [sig, setSig] = useState("");
  const [rpc, setRpc] = useState<string>(PUBLIC_RPC.devnet);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<ReceiptCheckResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [demo, setDemo] = useState(false);
  const [wantDemo, setWantDemo] = useState(false);
  // website brief §5: /burnticker/check?demo=1 pre-selects the featured devnet receipt (current-status.json `demo`) and runs the check
  useEffect(() => { fetch("/api/burnticker/v1/check/receipts").then((r) => r.json()).then((j: Samples) => { setSamples(j); const want = new URLSearchParams(window.location.search).get("demo") === "1"; const f = j.featured && j.receipts.some((r) => r.signature === j.featured) ? j.featured : j.receipts[0]?.signature; if (f) setSig(f); if (want && f) setDemo(true); }).catch((e) => setErr(String(e))); }, []);
  useEffect(() => { setWantDemo(new URLSearchParams(window.location.search).get("demo") === "1"); }, []);
  useEffect(() => { if (demo && sig && samples && !busy && !res) { setDemo(false); void run(); } }, [demo, sig, samples]); // eslint-disable-line react-hooks/exhaustive-deps

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
    // UX report 3 item 7: the example's outcome and its three evidence layers come first; the signature, receipt picker and RPC fields
    // sit under "Check another receipt". scroll-mt clears the sticky mobile header when /check?demo=1#verify lands here.
    <section className={`${card} scroll-mt-24`} id="verify">
      <h2 className="font-medium">{CHECK_COPY.verifierTitle}</h2>
      <p className="text-xs text-neutral-300">{wantDemo ? CHECK_COPY.verifierDemoIntro : CHECK_COPY.verifierIntro}</p>
      {wantDemo && !res && !err && <div className="mt-3" data-verdict="checking"><EmptyState compact kind="loading" body="Checking the featured devnet receipt in this browser." /></div>}
      {err && <p className="mt-2 text-xs text-amber-300">Could not check: {err}. This is not evidence that the receipt is invalid; try again or use another RPC.</p>}
      {res && (() => { const v = verdictOf(res.checks); return (
        <div className="mt-3 text-xs" data-verdict={v.verdict}>
          <p className={`text-sm ${VERDICT_TONE[v.verdict]}`}>{v.line} <a className="text-xs underline" href={res.facts.explorerUrl} target="_blank" rel="noreferrer">transaction</a></p>
          <ul className="mt-2 grid gap-2 sm:grid-cols-3">{v.layers.map((l) => { const st = l.checks.map((c) => c.status); const sum: CheckStatus = st.includes("failed") ? "failed" : st.length && st.every((x) => x === "passed") ? "passed" : st.includes("unavailable") ? "unavailable" : "not checked"; const partly = sum === "not checked" && st.includes("passed"); return (
            <li key={l.layer} className="rounded border border-neutral-800 p-2" data-layer={l.layer}><div className={`font-medium ${TONE[sum]}`}>{MARK[sum]} {l.title} <span className="font-normal text-neutral-500">{partly ? "partly checked" : sum}</span></div><p className="mt-1 text-neutral-400">{l.what}</p><p className="mt-1 text-neutral-500">{l.checks.map((c) => `${c.label}: ${c.status}`).join(" · ") || "no check"}</p></li>); })}</ul>
          <details className="mt-2"><summary className="cursor-pointer text-neutral-300">Every check, the memo and the accounts</summary>
            <ul className="mt-2 space-y-1">{v.layers.flatMap((l) => l.checks).map((c) => <li key={c.id} className="grid grid-cols-[1.5rem_1fr] gap-1"><span className={`${TONE[c.status]} font-mono`} title={c.status}>{MARK[c.status]}</span><span><span className="text-neutral-200">{c.label}</span> <span className="text-neutral-500">({c.status})</span> — <span className="text-neutral-400 break-words">{c.detail}</span></span></li>)}</ul>
            <p className="mt-2 text-neutral-500">{CHECK_COPY.legend} ✓ passed · ✗ failed · ? unavailable (a dependency did not answer) · – not checked on this page.</p>
            {res.facts.memo && <pre className="mt-2 whitespace-pre-wrap break-all rounded bg-neutral-950 p-2">{res.facts.memo}</pre>}
            <p className="mt-1 text-neutral-500 break-all">Reading <code>{res.facts.readingAddress ?? "—"}</code> · TokenConfig <code>{res.facts.configAddress ?? "—"}</code> · mint <code>{res.facts.mint ?? "—"}</code>{res.facts.sourceUrl && <> · source <a className="underline break-all" href={res.facts.sourceUrl} target="_blank" rel="noreferrer">{res.facts.recordDate}</a> / <a className="underline" href={res.facts.prevSourceUrl ?? "#"} target="_blank" rel="noreferrer">{res.facts.prevDate}</a></>}</p>
          </details>
        </div>); })()}
      <p className="mt-2 text-xs text-neutral-500" data-signer-caveat>{CHECK_COPY.verifierCaveat}</p>
      <details className="mt-3" open={!wantDemo} data-check-another>
        <summary className="cursor-pointer text-xs text-neutral-300">{CHECK_COPY.checkAnotherTitle}</summary>
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
      </details>
    </section>
  );
}
