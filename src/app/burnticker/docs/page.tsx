import type { Metadata } from "next";
import { API_PREFIX, API_VERSION, ENDPOINTS, RATE_LIMITS } from "@/lib/burnticker/api/spec";

export const metadata: Metadata = { title: "Docs / API", description: "The Burnticker public HTTP API (v1): public data and unsigned transactions only — endpoints, rate limits, the OpenAPI document and the SDK." };

/**
 * DOCS / API (2026-10-10): the public API at a glance, rendered from src/lib/burnticker/api/spec.ts — the same table that generates
 * openapi.json and drives the routes' cache and rate limits — so this page can never drift from the API it describes.
 */
export default function DocsPage() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-6 space-y-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Docs / API</h1>
        <p className="text-neutral-400 text-sm max-w-3xl">Public data and unsigned transactions only: no keys, accounts, cookies or signing. Nothing here can change a rule, claim a fee, or adopt an existing token. Version {API_VERSION}; within v1 changes are additive only.</p>
      </header>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-400">Base</h2>
        <pre className="font-mono text-sm border border-neutral-800 bg-neutral-900 rounded p-3 overflow-x-auto">{`API=https://burnticker.com${API_PREFIX}
curl -s "$API/catalogue"            # every source and its tier
curl -s "$API/tokens"               # every coin on the platform
curl -s "$API/tokens/<TICKER>/receipts"`}</pre>
        <p className="text-sm text-neutral-400">Machine-readable contract: <a className="underline" href={`${API_PREFIX}/openapi.json`}>{API_PREFIX}/openapi.json</a> (OpenAPI 3.1). TypeScript bots: <code className="font-mono">@burnticker/sdk</code> wraps every endpoint and adds local receipt verification.</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-400">Endpoints</h2>
        <div className="overflow-x-auto border border-neutral-800 rounded">
          <table className="w-full text-sm">
            <thead className="text-left text-neutral-500"><tr><th className="p-2">Method</th><th className="p-2">Path</th><th className="p-2">What</th><th className="p-2">Cache</th><th className="p-2">Bucket</th></tr></thead>
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
        <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-400">Rate limits (per client)</h2>
        <ul className="text-sm space-y-1">
          {Object.entries(RATE_LIMITS).map(([bucket, r]) => <li key={bucket}><span className="font-mono text-amber-400">{bucket}</span> <span className="text-neutral-400">— {r.human}</span></li>)}
        </ul>
      </section>
    </main>
  );
}
