"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { SIGN_STATEMENT_COPY as COPY, isStatementDate, signStatement, statementCommands, todayUtc, wrongSignerProblem, type SignStatementResult, type StatementTextView } from "@/lib/burnticker/trustpack/statement";
import { WalletButton } from "../../_components/WalletButton";

/**
 * The signing page's client half (trustpack/statement.ts has the rules; the script uses the same file). The PIN is held in this
 * component's state only, exactly as the claim page holds it: never in storage or a cookie, and a reload forgets it. With it,
 * GET /api/burnticker/v1/ops/statement-text (the operator's network and `x-action-pin`) returns the exact text for the chosen day and the
 * signer wallet. "Sign with this wallet" asks the connected wallet's signMessage for the UTF-8 bytes of that text (refused before the
 * wallet is asked when it is not the signer), checks the signature here in the browser, and shows it with the two commands to run. The
 * signature is never sent anywhere and never kept.
 */
export function SignStatement() {
  const wallet = useWallet();
  const [pin, setPin] = useState(""), [activePin, setActivePin] = useState("");
  const [date, setDate] = useState(() => todayUtc());
  const [v, setV] = useState<StatementTextView | null>(null), [err, setErr] = useState<string | null>(null), [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false), [result, setResult] = useState<SignStatementResult | null>(null), [copied, setCopied] = useState<string | null>(null);
  const load = useCallback(async (p: string, d: string) => {
    setResult(null);
    if (!p || !isStatementDate(d)) { setV(null); return; }
    setReading(true); setErr(null);
    try {
      const r = await fetch(`/api/burnticker/v1/ops/statement-text?date=${encodeURIComponent(d)}`, { headers: { "x-action-pin": p }, cache: "no-store" });
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error(j?.error ?? `HTTP ${r.status}`);
      setV(j as StatementTextView);
    } catch (e) { setV(null); setErr(String((e as Error).message ?? e)); } finally { setReading(false); }
  }, []);
  useEffect(() => { void load(activePin, date); }, [activePin, date, load]);
  const unlock = (e: FormEvent) => { e.preventDefault(); if (!pin.trim()) return; setActivePin(pin.trim()); setPin(""); };

  const connected = wallet.publicKey?.toBase58() ?? null;
  const wrongWallet = v ? wrongSignerProblem(connected, v.signer) : null;
  const sign = async () => {
    if (!v || busy) return;
    setBusy(true); setResult(null);
    try { setResult(await signStatement(v, connected, wallet.signMessage)); }
    catch (e) { setResult({ ok: false, error: `The wallet did not sign (${String((e as Error)?.message ?? e).slice(0, 160)}).` }); }
    finally { setBusy(false); }
  };
  const copy = (k: string, text: string) => { navigator.clipboard?.writeText(text).then(() => { setCopied(k); setTimeout(() => setCopied(null), 1500); }).catch(() => setCopied(null)); };

  const card = "rounded-lg border border-neutral-800 bg-neutral-900 p-3";
  const copyButton = (k: string, text: string) => <button type="button" className="rounded border border-neutral-700 px-2 py-0.5 text-xs hover:border-amber-400" onClick={() => copy(k, text)}>{copied === k ? COPY.copied : COPY.copy}</button>;
  return (
    <main className="mx-auto max-w-3xl space-y-5 px-4 py-6 text-sm">
      <header className="space-y-1">
        <p className="text-xs"><Link className="underline" href="/burnticker/operator">Back to the operator page</Link></p>
        <h1 className="text-2xl font-semibold">{COPY.title}</h1>
        <p className="text-neutral-400">{COPY.intro}</p>
      </header>
      {!activePin ? (
        <form className={card + " flex flex-wrap items-end gap-2"} onSubmit={unlock} data-statement-pin>
          <label className="text-xs text-neutral-400">{COPY.pin}<input type="password" autoComplete="off" className="mt-1 block w-40 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm" value={pin} onChange={(e) => setPin(e.target.value)} aria-label={COPY.pin} /></label>
          <button type="submit" className="rounded border border-neutral-700 px-3 py-1 hover:border-amber-400">{COPY.open}</button>
          <p className="w-full text-xs text-neutral-500">{COPY.pinNote}</p>
        </form>
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-neutral-400">{COPY.date}<input type="date" className="mt-1 block rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm" value={date} onChange={(e) => setDate(e.target.value)} aria-label={COPY.date} data-statement-date /></label>
          <button type="button" className="text-xs underline text-neutral-400" onClick={() => { setActivePin(""); setV(null); setResult(null); }}>Forget the PIN</button>
          {reading && <span className="text-xs text-neutral-500" role="status">Reading the statement.</span>}
        </div>
      )}
      {err && <p className="text-xs text-amber-300" role="alert" data-statement-error>{err}</p>}
      {v && (
        <>
          <section className={card + " space-y-2"} data-statement-view>
            <table className="w-full text-xs"><tbody>
              <tr className="align-top"><td className="p-1 text-neutral-400">Signer</td><td className="p-1"><code className="break-all">{v.signer}</code> <span className="text-neutral-500">({v.signerRole}, {v.cluster})</span></td></tr>
              <tr className="align-top"><td className="p-1 text-neutral-400">Connected wallet</td><td className="p-1">{connected ? <code className="break-all">{connected}</code> : "none"}</td></tr>
            </tbody></table>
            <pre className="whitespace-pre-wrap break-words rounded border border-neutral-800 bg-neutral-950 p-2 text-xs" data-statement-text>{v.text}</pre>
            <div className="flex items-center gap-2">{copyButton("text", v.text)}</div>
            {v.signedOn && <p className="text-xs text-neutral-400" data-statement-resign>{COPY.resign}</p>}
          </section>
          <section className={card + " space-y-2"} data-statement-action>
            {!connected ? <div className="space-y-2"><p className="text-xs">{COPY.connect}</p><WalletButton variant="menu" /></div>
              : wrongWallet ? <p className="text-xs text-amber-300" data-statement-wrong-wallet>{wrongWallet}</p>
              : <button type="button" disabled={busy || !wallet.signMessage} onClick={() => void sign()} className="rounded border border-amber-400 px-4 py-1 disabled:opacity-40" data-statement-sign>{busy ? COPY.busy : COPY.button}</button>}
            {connected && !wrongWallet && !wallet.signMessage && <p className="text-xs text-amber-300">{COPY.noSignMessage}</p>}
            {result && !result.ok && <p className="text-xs text-amber-300" role="alert" data-statement-failed>{result.error}</p>}
            {result && result.ok && (
              <div className="space-y-2" data-statement-signed>
                <p className="text-xs text-neutral-400">Signature (base58)</p>
                <pre className="whitespace-pre-wrap break-all rounded border border-neutral-800 bg-neutral-950 p-2 text-xs" data-statement-signature>{result.signature}</pre>
                <div className="flex items-center gap-2">{copyButton("sig", result.signature)}</div>
                <p className={`text-xs ${result.format ? "text-emerald-400" : "text-red-400"}`} data-statement-check>{result.format ? COPY.valid : COPY.invalid}</p>
                {result.format && (
                  <>
                    <p className="text-xs text-neutral-300">{COPY.next}</p>
                    {statementCommands(v.date, result.signature).map((c, i) => (
                      <div key={i} className="space-y-1" data-statement-command>
                        <pre className="whitespace-pre-wrap break-all rounded border border-neutral-800 bg-neutral-950 p-2 text-xs">{c}</pre>
                        {copyButton(`cmd${i}`, c)}
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}
