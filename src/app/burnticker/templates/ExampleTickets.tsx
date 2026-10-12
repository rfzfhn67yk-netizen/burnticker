import { ViewCard } from "../_components/CoinCard";
import { ALSO_WITH, EXAMPLES_HEADING, EXAMPLES_INTRO, EXAMPLE_TICKETS, LAUNCH_STATE_UNREAD, NOT_OFFERED, exampleCardView } from "@/lib/burnticker/exampleTickets";
import type { LaunchType } from "@/lib/burnticker/launchAvailability";

/**
 * THE EXAMPLE TICKETS (website-17, creator benefits item 7): six coins nobody has created, on the real coin card, each tagged "Example,
 * not a real coin". Under each card: the wizard path that exists today, as a link with what it fills in, when this site's wizard is up
 * and takes that kind of coin; otherwise "Not offered yet." with the reason (the ticket's own, or this site's availability sentence).
 * No hooks: the templates page renders it on the server, and the launch page can render it with its own launch state (WIRING-17.md).
 */
export interface ExampleSite { wizard: boolean; sentence: string; types: Record<LaunchType, { available: boolean; reason: string | null }>; pairs: { available: boolean; line: string | null } }

const PAIR_TYPES: readonly LaunchType[] = ["derby", "pairs", "matchup"];

export function ExampleTickets({ site }: { site: ExampleSite | null }) {
  return (
    <section className="space-y-3" aria-label={EXAMPLES_HEADING} data-examples>
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">{EXAMPLES_HEADING}</h2>
        <p className="max-w-3xl text-sm text-neutral-400">{EXAMPLES_INTRO}</p>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {EXAMPLE_TICKETS.map((e) => {
          const pairOff = PAIR_TYPES.includes(e.type) && site !== null && !site.pairs.available;
          const blocked = !e.opens ? null : !site ? LAUNCH_STATE_UNREAD : !site.wizard ? site.sentence : pairOff ? site.pairs.line : !site.types[e.type].available ? site.types[e.type].reason : null;
          return (
            <li key={e.ticker} className="flex min-w-0 flex-col gap-2" data-example={e.ticker}>
              <ViewCard v={exampleCardView(e)} />
              <div className="px-1 text-xs" data-example-action>
                {e.opens && !blocked
                  ? <><a className="font-medium text-amber-300 underline" href={e.opens.href}>{e.opens.line}</a>{e.opens.also && <span className="mt-1 block text-neutral-400">{ALSO_WITH} {e.opens.also.map((a, i) => <span key={a.href}>{i > 0 ? " or " : ""}<a className="underline" href={a.href}>{a.label}</a></span>)}.</span>}</>
                  : <span className="text-neutral-400" data-not-offered>{e.notOffered ?? `${NOT_OFFERED} ${blocked ?? LAUNCH_STATE_UNREAD}`}</span>}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
