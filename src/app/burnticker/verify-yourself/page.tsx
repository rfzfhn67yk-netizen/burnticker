import type { Metadata } from "next";
import Link from "next/link";
import { verifyCommands, verifyReceipt, type VerifyReceipt } from "@/lib/burnticker/history";
import { VERIFY_YOURSELF_COPY as C } from "@/lib/burnticker/historyCopy";
import { EmptyState } from "../_components/EmptyState";
import { Page, PageHeader, Panel } from "../_components/Panel";
import { CopyButton } from "../_components/CopyButton";
import { RepoText } from "../_components/RepoText";

export const metadata: Metadata = { title: C.title, description: C.description, alternates: { canonical: "/burnticker/verify-yourself" } };
export const dynamic = "force-dynamic";

/**
 * /burnticker/verify-yourself (legitimacy pass item 7): a stranger recomputes one real receipt in a terminal. The receipt is the first
 * mainnet receipt in the evidence files once one exists, else the featured devnet receipt (history.ts verifyReceipt); every command and
 * every expected output is built from that evidence row and its rules file, never typed. The browser checker is the one-click alternative.
 */
export default function VerifyYourselfPage() {
  let v: VerifyReceipt | null = null;
  try { v = verifyReceipt(); } catch { v = null; }
  const checkHref = v ? (v.network === "devnet" ? "/burnticker/check?demo=1#verify" : `/burnticker/check?sig=${v.signature}&cluster=mainnet#verify`) : "/burnticker/check";
  return (
    <Page>
      <PageHeader title={C.title} intro={C.intro}>
        <p className="bt-body-text">{C.needs}</p>
        {v && <p className={v.network === "devnet" ? "bt-note is-devnet" : "bt-note"} data-network={v.network}>{v.network === "devnet" ? C.devnet : C.mainnet}</p>}
      </PageHeader>
      {!v ? <EmptyState kind="unavailable" body={<>{C.unavailable} <Link className="underline" href={checkHref}>{C.browserLink}</Link></>} /> : <>
        <ol className="bt-list" aria-label={C.title}>
          {verifyCommands(v).map((c, k) => (
            <li key={c.id} className="bt-panel" data-step={c.id}>
              <p className="bt-eyebrow">Step {k + 1} of 5</p>
              <h2 className="bt-h2">{C.steps[c.id].title}</h2>
              <p className="bt-body-text">{C.steps[c.id].text}</p>
              <div className="bt-cmd"><pre className="bt-pre" tabIndex={0} aria-label={`Command for step ${k + 1}`}><code>{c.command}</code></pre><CopyButton text={c.command} label={C.copy} copied={C.copied} what={`the command for step ${k + 1}`} /></div>
              <p className="bt-meta">{C.expected}</p>
              <pre className="bt-pre is-output" tabIndex={0} aria-label={`Expected output for step ${k + 1}`}><code>{c.expected}</code></pre>
            </li>
          ))}
        </ol>
        <Panel title={C.compareTitle} id="compare">
          <ul className="bt-bullets">{C.compare.map((t) => <li key={t}>{t}</li>)}</ul>
          <p className="bt-body-text">The receipt&apos;s rule spend is {v.ruleSpendLamports !== null ? v.ruleSpendLamports.toLocaleString("en-US") : "not stated"} lamports. It spent {v.spentLamports.toLocaleString("en-US")} lamports and burned {v.burned} ${v.ticker}.</p>
          {v.capped && <p className="bt-body-text">{C.capped}</p>}
        </Panel>
        <Panel title={C.browserTitle} id="browser">
          <p className="bt-body-text">{C.browser}</p>
          <p><Link className="bt-ghost-btn" href={checkHref}>{C.browserLink}</Link></p>
          <p className="bt-meta">{C.evidence} <RepoText text={v.evidence} />.</p>
        </Panel>
      </>}
    </Page>
  );
}
