import { NO_FEE_REVENUE_LINE, WHY_CREATE, onboardingSentences } from "@/lib/burnticker/creatorCopy";
import { launchLabCostSol } from "@/lib/burnticker/launchCost";

/**
 * CREATOR ONBOARDING, COPY ONLY (website-14, platform item 8; product idea 5): what a creator does, what it costs (the launch review's
 * own estimate for one coin), what they get, the no-fee-revenue line, and why someone creates a coin. On the templates page and the
 * launch page's first screen. Words: creatorCopy.ts.
 */
export function CreatorOnboarding({ withWhy = true }: { withWhy?: boolean }) {
  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-3 text-sm space-y-1" aria-label="What creating a coin involves" data-onboarding>
      {onboardingSentences(launchLabCostSol()).map((s) => <p key={s} className="text-neutral-200">{s}</p>)}
      <p className="text-neutral-400" data-no-fee-revenue>{NO_FEE_REVENUE_LINE}</p>
      {withWhy && <details className="text-neutral-400"><summary className="cursor-pointer text-neutral-300">Why create a coin</summary><p className="mt-1" data-why-create>{WHY_CREATE}</p></details>}
    </section>
  );
}
