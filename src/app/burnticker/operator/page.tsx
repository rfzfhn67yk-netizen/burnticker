"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { EmptyState } from "../_components/EmptyState";
import { OPERATOR_COPY } from "@/lib/burnticker/trustpack/copy";
import { CurrentStatusSummary } from "../_components/CurrentStatusSummary";

/**
 * /burnticker/operator — WHO RUNS THIS (trust pack, 2026-10-10). Rendered from GET /api/burnticker/v1/operator
 * (config/burnticker/operator.json via src/lib/burnticker/trustpack/operator.ts): the operator, the entity line (TODO_ENTITY until the
 * owner decides), every operator wallet per cluster (devnet from the rehearsal records, mainnet TODO), the signed-statement slot with
 * its live ed25519 check, the never-buys monitor's last report, and the /.well-known/burnticker.json cross-links.
 */
interface Wallet { role: string; label: string; pubkey: string; source: string | null; name?: string }
interface ClusterCfg { status: string; programs: Record<string, string>; launchlabPlatform: string; squads: { vault: string; multisig: string; threshold: string; timeLock: string }; wallets: Wallet[]; platformMints: { symbol: string; mint: string }[] }
interface View {
  cluster: "devnet" | "mainnet";
  operator: { name: string; state?: string | null; country: string; contact: string; security: string; entity: string; entityPending: string };
  links: { site: string; app: string; deficitSite: string; github: string; githubOrg: string; x: string[] };
  clusters: Record<"devnet" | "mainnet", ClusterCfg>;
  signedMessage: { status: "todo" | "signed" | "invalid"; signer: string | null; message: string; signature: string | null; verified: boolean | null; how: string; detail: string };
  neverBuys: { rule: string; rehearsalNote: string; line: string; status: "clear" | "explained" | "red" | "not-run"; report: null | { ranAt: string; holdings: { role: string; wallet: string; symbol: string; amountRaw: string; tokenAccount: string }[]; acquisitions: { role: string; wallet: string; symbol: string; amountRaw: string; signature: string; blockTime: string | null; explainedBy: string | null }[]; scanned: { tokenAccounts: number; transactions: number }; errors: string[] } };
  placeholders: { path: string; value: string }[];
}

const card = "rounded-lg border border-neutral-800 bg-neutral-900 p-3";
const isTodo = (s: string) => /^TODO_/.test(s);
const statusTone: Record<string, string> = { clear: "text-emerald-400", explained: "text-amber-300", red: "text-red-400", "not-run": "text-neutral-500" };

export default function OperatorPage() {
  const [v, setV] = useState<View | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { fetch("/api/burnticker/v1/operator").then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? r.statusText); setV(j); }).catch((e) => setErr(String(e.message ?? e))); }, []);
  const ex = (k: string, c: string) => `https://explorer.solana.com/address/${k}${c === "devnet" ? "?cluster=devnet" : ""}`;
  const key = (k: string, c: string) => (isTodo(k) ? <span className="text-amber-400">{k}</span> : <a className="underline break-all" href={ex(k, c)}><code>{k}</code></a>);
  return (
    <main className="mx-auto max-w-5xl px-4 py-6 space-y-6 text-sm">
      <header>
        <p className="text-xs"><Link className="underline" href="/burnticker/trust">← Trust</Link></p>
        <h1 className="text-2xl font-semibold">{OPERATOR_COPY.title}</h1>
        <p className="text-neutral-300">{OPERATOR_COPY.intro}</p>
      </header>
      <CurrentStatusSummary card={card} />
      {err && <EmptyState kind="unavailable" body="The operator data could not be read just now." details={err} />}
      {!v && !err && <EmptyState kind="loading" />}
      {v && <>
        <section className={card}>
          <p className="text-base">{v.operator.name} · {v.operator.state ? `${v.operator.state}, ` : ""}{v.operator.country}</p>
          <p className="text-xs">Contact <a className="underline" href={`mailto:${v.operator.contact}`}>{v.operator.contact}</a> · security reports <a className="underline" href={`mailto:${v.operator.security}`}>{v.operator.security}</a></p>
          <p className="text-xs mt-1"><b>{OPERATOR_COPY.entityTitle}:</b> {isTodo(v.operator.entity) ? <span className="text-amber-400">{v.operator.entity}</span> : v.operator.entity} — {v.operator.entityPending}</p>
        </section>

        <section className={card}>
          <h2 className="font-medium">{OPERATOR_COPY.walletsTitle}</h2>
          <p className="text-xs text-neutral-300">{OPERATOR_COPY.walletsIntro}</p>
          {(["devnet", "mainnet"] as const).map((c) => { const cl = v.clusters[c]; return (
            <div key={c} className="mt-3">
              <h3 className="text-xs font-medium">{c} <span className="text-neutral-500 font-normal">— {cl.status}</span></h3>
              <div className="overflow-x-auto"><table className="w-full text-xs"><thead className="text-neutral-400 text-left"><tr><th className="p-2">Role</th><th className="p-2">Public key</th><th className="p-2">Source</th></tr></thead>
                <tbody>{cl.wallets.map((w) => <tr key={w.role} className="border-t border-neutral-800 align-top"><td className="p-2">{w.label}{w.name ? ` (${isTodo(w.name) ? w.name : w.name})` : ""}</td><td className="p-2">{key(w.pubkey, c)}</td><td className="p-2 text-neutral-500">{w.source ?? "—"}</td></tr>)}
                  <tr className="border-t border-neutral-800 align-top"><td className="p-2">Squads multisig ({cl.squads.threshold}, time lock {cl.squads.timeLock})</td><td className="p-2">{key(cl.squads.multisig, c)}</td><td className="p-2 text-neutral-500">vault {isTodo(cl.squads.vault) ? cl.squads.vault : <code>{cl.squads.vault.slice(0, 8)}…</code>}</td></tr>
                  {Object.entries(cl.programs).map(([n, id]) => <tr key={n} className="border-t border-neutral-800"><td className="p-2">program {n}</td><td className="p-2">{key(id, c)}</td><td className="p-2 text-neutral-500">{c === "mainnet" ? "reserved id, not deployed" : "deployed"}</td></tr>)}
                  <tr className="border-t border-neutral-800"><td className="p-2">LaunchLab platform config</td><td className="p-2">{key(cl.launchlabPlatform, c)}</td><td className="p-2" /></tr></tbody></table></div>
            </div>); })}
        </section>

        <section className={card}>
          <h2 className="font-medium">{OPERATOR_COPY.signedTitle}</h2>
          <p className={`text-xs ${v.signedMessage.verified === true ? "text-emerald-400" : v.signedMessage.verified === false ? "text-red-400" : "text-amber-400"}`}>{v.signedMessage.status === "signed" ? "✓ " : v.signedMessage.status === "invalid" ? "✗ " : ""}{v.signedMessage.detail}</p>
          {v.signedMessage.status === "todo" && <p className="text-xs text-neutral-300 mt-1">{OPERATOR_COPY.signedPending}</p>}
          <pre className="text-xs whitespace-pre-wrap rounded bg-neutral-950 p-2 mt-2">{v.signedMessage.message}</pre>
          {v.signedMessage.signature && <p className="text-xs break-all mt-1">signature <code>{v.signedMessage.signature}</code> · signer <code>{v.signedMessage.signer}</code></p>}
          <p className="text-xs text-neutral-500 mt-1">{v.signedMessage.how}</p>
        </section>

        <section className={card}>
          <h2 className="font-medium">{OPERATOR_COPY.neverBuysTitle}</h2>
          <p className="text-xs text-neutral-300">{OPERATOR_COPY.neverBuysIntro} {v.neverBuys.rule}</p>
          <p className={`text-sm mt-2 ${statusTone[v.neverBuys.status]}`}>{v.cluster}: {v.neverBuys.line}{v.neverBuys.report ? ` · last run ${v.neverBuys.report.ranAt} (${v.neverBuys.report.scanned.tokenAccounts} token account(s), ${v.neverBuys.report.scanned.transactions} transaction(s) read)` : ""}</p>
          {!v.neverBuys.report && <p className="text-xs text-neutral-500">{OPERATOR_COPY.neverBuysNotRun}</p>}
          <p className="text-xs text-neutral-400 mt-1">{v.neverBuys.rehearsalNote}</p>
          {v.neverBuys.report && v.neverBuys.report.acquisitions.length > 0 && <div className="overflow-x-auto mt-2"><table className="w-full text-xs"><thead className="text-neutral-400 text-left"><tr><th className="p-2">Wallet</th><th className="p-2">Coin</th><th className="p-2 text-right">Raw amount received</th><th className="p-2">Transaction</th><th className="p-2">Explained by</th></tr></thead>
            <tbody>{v.neverBuys.report.acquisitions.map((a) => <tr key={`${a.signature}-${a.symbol}-${a.wallet}`} className="border-t border-neutral-800 align-top"><td className="p-2">{a.role}</td><td className="p-2">${a.symbol}</td><td className="p-2 text-right tabular-nums">{a.amountRaw}</td><td className="p-2"><a className="underline" href={`https://explorer.solana.com/tx/${a.signature}${v.cluster === "devnet" ? "?cluster=devnet" : ""}`}><code>{a.signature.slice(0, 12)}…</code></a></td><td className={`p-2 ${a.explainedBy ? "text-neutral-400" : "text-red-400"}`}>{a.explainedBy ?? "nothing: unexplained"}</td></tr>)}</tbody></table></div>}
          {v.neverBuys.report && v.neverBuys.report.holdings.length > 0 && <details className="text-xs mt-2"><summary className="cursor-pointer">Token accounts of platform coins held by operator wallets ({v.neverBuys.report.holdings.length})</summary><ul className="mt-1">{v.neverBuys.report.holdings.map((h) => <li key={h.tokenAccount}>{h.role}: ${h.symbol} raw {h.amountRaw} · <code>{h.tokenAccount}</code></li>)}</ul></details>}
          {v.neverBuys.report && v.neverBuys.report.errors.length > 0 && <p className="text-xs text-amber-400 mt-1">Read errors: {v.neverBuys.report.errors.join(" · ")}</p>}
        </section>

        <section className={card}>
          <h2 className="font-medium">{OPERATOR_COPY.crossLinksTitle}</h2>
          <p className="text-xs text-neutral-300">{OPERATOR_COPY.crossLinksIntro} <a className="underline" href="/.well-known/burnticker.json"><code>/.well-known/burnticker.json</code></a></p>
          <ul className="text-xs mt-1 list-disc pl-5">
            <li>Site <a className="underline" href={v.links.site}>{v.links.site}</a> · $DEFICIT <a className="underline" href={v.links.deficitSite}>{v.links.deficitSite}</a></li>
            <li>Code <a className="underline" href={v.links.github}>{v.links.github}</a>{isTodo(v.links.githubOrg) && <span className="text-amber-400"> (GitHub organisation: {v.links.githubOrg})</span>}</li>
            <li>X {v.links.x.map((x) => <a key={x} className="underline mr-2" href={x}>{x.replace("https://x.com/", "@")}</a>)}</li>
          </ul>
          <details className="text-xs mt-2"><summary className="cursor-pointer text-neutral-300">Placeholders on this page ({v.placeholders.length}) — each is on docs/burnticker/TODO-OWNER.md</summary><ul className="mt-1">{v.placeholders.map((p) => <li key={p.path + p.value}><code className="text-amber-400">{p.value}</code> <span className="text-neutral-500">{p.path}</span></li>)}</ul></details>
        </section>
      </>}
    </main>
  );
}
