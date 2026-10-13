import type { Metadata } from "next";
import { API_PREFIX, API_VERSION, ENDPOINTS, RATE_LIMITS } from "@/lib/burnticker/api/spec";

export const metadata: Metadata = { title: "Docs and API", description: "The public Burnticker HTTP API, version 1. It serves public data and unsigned transactions only. This page lists the endpoints, the rate limits, the OpenAPI document and the SDK.", alternates: { canonical: "/burnticker/docs" } }; // audit 7 item 27: a canonical URL

/**
 * DOCS / API (2026-10-10): the public API at a glance, rendered from src/lib/burnticker/api/spec.ts — the same table that generates
 * openapi.json and drives the routes' cache and rate limits — so this page can never drift from the API it describes.
 */
export default function DocsPage() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-6 space-y-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Docs and API</h1>
        <p className="text-neutral-400 text-sm max-w-3xl">The API serves public data and unsigned transactions only. It uses no keys, accounts, cookies or signing. Nothing here can change a rule, claim a fee, or adopt an existing token. This is version {API_VERSION}. Within v1, changes only ever add things.</p>
      </header>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-400">Base</h2>
        <pre className="bt-hscroll font-mono text-sm border border-neutral-800 rounded p-3 overflow-x-auto" tabIndex={0}>{`API=https://burnticker.com${API_PREFIX}
curl -s "$API/catalogue"            # every source and its tier
curl -s "$API/tokens"               # every coin on the platform
curl -s "$API/tokens/<TICKER>/receipts"`}</pre>
        <p className="text-sm text-neutral-400">The machine-readable contract is <a className="underline" href={`${API_PREFIX}/openapi.json`}>{API_PREFIX}/openapi.json</a>, in OpenAPI 3.1. For TypeScript bots, <code className="font-mono">@burnticker/sdk</code> wraps every endpoint and adds local receipt verification.</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-400">Endpoints</h2>
        {/* website-15 item 19 (ChatGPT repair 5): a readable minimum width per column, and a shadow on the edge that still has more */}
        <div className="bt-hscroll overflow-x-auto border border-neutral-800 rounded" tabIndex={0} role="region" aria-label="API endpoints">
          <table className="w-full min-w-[46rem] text-sm">
            <thead className="text-left text-neutral-500"><tr><th className="p-2">Method</th><th className="p-2">Path</th><th className="p-2 min-w-[16rem]">What it does</th><th className="p-2">Cache</th><th className="p-2">Limit group</th></tr></thead>
            <tbody className="divide-y divide-neutral-800">
              {ENDPOINTS.map((e) => (
                <tr key={e.operationId} className="align-top">
                  <td className="p-2 font-mono">{e.method}</td>
                  <td className="p-2 font-mono whitespace-nowrap">{e.method === "GET" && !e.path.includes("{") ? <a className="underline" href={`${API_PREFIX}${e.path}`}>{e.path}</a> : e.path}</td>
                  <td className="p-2 text-neutral-300">{e.summary}</td>
                  <td className="p-2 font-mono text-neutral-400 whitespace-nowrap">{e.cacheSec ? `${e.cacheSec} s` : "—"}</td>
                  <td className="p-2 font-mono text-neutral-400">{e.bucket}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-400">Rate limits for each client</h2>
        <ul className="text-sm space-y-1">
          {Object.entries(RATE_LIMITS).map(([bucket, r]) => <li key={bucket}><span className="font-mono text-amber-400">{bucket}</span> <span className="text-neutral-400">{r.human}</span></li>)}
        </ul>
      </section>
    </main>
  );
}
