/**
 * THE FOUR EMPTY STATES (website brief 2026-10-11 §1/§7: "Distinguish 'not launched', 'no activity', 'loading' and 'data unavailable'").
 * One vocabulary for every surface that can show nothing: the app's EmptyState component (src/app/burnticker/_components/EmptyState.tsx)
 * renders these, and the static pages (site/burnticker/index.html, site/deficit/index.html, site/burnticker/status/index.html) carry the
 * same headings word for word (test/burntickerWebsite2.test.ts holds them equal).
 *
 *   not-launched   the thing does not exist yet on this host or network (no coin registered, no program on mainnet) — a fact, not a fault
 *   no-activity    it exists and was read correctly, and there is simply nothing to show yet (no receipts, no games settled)
 *   loading        the read has not answered yet: show a neutral placeholder, never the content it might replace
 *   unavailable    the read failed or the data source is down: say so in ordinary words; the diagnostics go behind a details disclosure
 *
 * Copy rules (config/launch/copy-lint.json): facts only, no "coming soon", no dates promised, no urgency.
 */
export type EmptyKind = "not-launched" | "no-activity" | "loading" | "unavailable";

export interface EmptyCopy { kind: EmptyKind; heading: string; body: string }

export const EMPTY_STATE_COPY: Record<EmptyKind, EmptyCopy> = {
  "not-launched": { kind: "not-launched", heading: "Not launched", body: "This does not exist on this network yet, so there is nothing to read. That is not an error." },
  "no-activity": { kind: "no-activity", heading: "No activity yet", body: "Everything was read correctly. There is just nothing to show yet." },
  loading: { kind: "loading", heading: "Loading", body: "The data is still loading. Nothing is shown until it arrives." },
  unavailable: { kind: "unavailable", heading: "Data unavailable", body: "The data could not be read just now. That does not mean anything is wrong with the coins or their receipts. Try again later." },
};

/** The kind for a fetch outcome: an error is `unavailable`, no answer yet is `loading`, an empty answer is the caller's choice. */
export function emptyKindFor(o: { loading: boolean; error: string | null; empty: boolean; launched?: boolean }): EmptyKind | null {
  if (o.error) return "unavailable";
  if (o.loading) return "loading";
  if (o.launched === false) return "not-launched";
  return o.empty ? "no-activity" : null;
}

/** The ordinary-words heading for a kind (the static pages' JS keeps a copy; the test compares them). */
export const emptyHeading = (k: EmptyKind): string => EMPTY_STATE_COPY[k].heading;
