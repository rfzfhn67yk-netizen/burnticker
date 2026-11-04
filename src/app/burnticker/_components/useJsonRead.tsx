"use client";

import { useCallback, useEffect, useState } from "react";
import { readJson, utcClock, type ReadResult } from "@/lib/burnticker/readJson";
import { EmptyState } from "./EmptyState";

/**
 * A client read with a retry (audit R01 / site audit #1): the data, the typed failure (src/lib/burnticker/readJson.ts — never a raw
 * Response.json error), the time of the last attempt, and `retry()`. A surface renders its static content regardless and puts
 * <ReadFailurePanel> only where the live part would be.
 */
export function useJsonRead<T>(url: string, timeoutMs = 15_000) {
  const [state, setState] = useState<{ result: ReadResult<T> | null; triedAt: number | null; loading: boolean }>({ result: null, triedAt: null, loading: true });
  const run = useCallback(() => {
    setState((s) => ({ ...s, loading: true }));
    readJson<T>(url, { timeoutMs }).then((result) => setState({ result, triedAt: Date.now(), loading: false }));
  }, [url, timeoutMs]);
  useEffect(() => { run(); }, [run]);
  const r = state.result;
  return { data: r && r.ok ? r.data : null, failure: r && !r.ok ? r : null, loading: state.loading, triedAt: state.triedAt, retry: run };
}

/** "Data unavailable" with the plain reason, a Retry button and when it was last tried; the technical detail behind a disclosure. */
export function ReadFailurePanel({ what, failure, triedAt, loading, retry }: { what: string; failure: { message: string; detail: string }; triedAt: number | null; loading: boolean; retry: () => void }) {
  return (
    <EmptyState kind="unavailable" body={`${what} could not be read just now. ${failure.message} The sections that do not depend on it are shown as usual.`} details={failure.detail}>
      <p className="mt-2 flex flex-wrap items-center gap-3 text-xs">
        <button type="button" className="rounded border border-neutral-600 px-3 py-1 font-medium text-neutral-100 hover:border-neutral-400 disabled:opacity-60" onClick={retry} disabled={loading} data-retry>
          {loading ? "Retrying…" : "Retry"}
        </button>
        {triedAt !== null && <span className="text-neutral-500" aria-live="polite">Last tried {utcClock(triedAt)}</span>}
      </p>
    </EmptyState>
  );
}
