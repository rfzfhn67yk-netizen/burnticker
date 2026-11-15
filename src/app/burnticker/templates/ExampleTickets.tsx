import { ALSO_WITH, EXAMPLE_TAG, EXAMPLES_AFFILIATION, EXAMPLES_HEADING, EXAMPLES_INTRO, EXAMPLE_TICKETS, LAUNCH_STATE_UNREAD, NOT_OFFERED, SOURCE_LABEL } from "@/lib/burnticker/exampleTickets";
import type { LaunchType } from "@/lib/burnticker/launchAvailability";

/**
 * THE EXAMPLE TICKETS (website-17, creator benefits item 7): six coins nobody has created, each tagged "Example, not a real coin".
 * website-18 (the owner: "example tickets should have less info, be more brief in the description"): a short card with the ticker, the
 * name, one rule sentence, the source in a few words and the tag. Under it, the wizard path that exists today, as a link with what it
 * fills in, when this site's wizard is up and takes that kind of coin; otherwise "Not offered yet." The no-affiliation line is said once.
 * No hooks: the templates page renders it on the server, and the launch page can render it with its own launch state (WIRING-17.md).
 */
export interface ExampleSite { wizard: boolean; sentence: string; types: Record<LaunchType, { available: boolean; reason: string | null }>; pairs: { available: boolean; line: string | null } }

const PAIR_TYPES: readonly LaunchType[] = ["derby", "pairs", "matchup"];

export function ExampleTickets({ site }: { site: ExampleSite | null }) {
  return (
    <section className="space-y-3" aria-label={EXAMPLES_HEADING} data-examples>
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">{EXAMPLES_HEADING}</h2>
        <p className="max-w-3xl text-sm text-neutral-400">{EXAMPLES_INTRO} {EXAMPLES_AFFILIATION}</p>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {EXAMPLE_TICKETS.map((e) => {
          const pairOff = PAIR_TYPES.includes(e.type) && site !== null && !site.pairs.available;
          const open = !!e.opens && !!site && site.wizard && !pairOff && site.types[e.type].available;
          return (
            <li key={e.ticker} className="flex min-w-0 flex-col gap-2" data-example={e.ticker}>
              <article className="min-w-0 space-y-1 rounded-lg border border-neutral-800 bg-neutral-900 p-3" data-example-card>
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-2"><span className="font-mono font-semibold">${e.ticker}</span><span className="bt-chip">{EXAMPLE_TAG}</span></div>
                <div className="text-sm font-medium">{e.name}</div>
                <p className="text-sm text-neutral-300" data-example-rule>{e.rule}</p>
                <p className="text-xs text-neutral-500" data-example-source>{SOURCE_LABEL}: {e.sourceLine}</p>
              </article>
              <div className="px-1 text-xs" data-example-action>
                {open && e.opens
                  ? <><a className="font-medium text-amber-300 underline" href={e.opens.href}>{e.opens.line}</a>{e.opens.also && <span className="mt-1 block text-neutral-400">{ALSO_WITH} {e.opens.also.map((a, i) => <span key={a.href}>{i > 0 ? " or " : ""}<a className="underline" href={a.href}>{a.label}</a></span>)}.</span>}</>
                  : <span className="text-neutral-400" data-not-offered>{site ? NOT_OFFERED : LAUNCH_STATE_UNREAD}</span>}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
