import { CREATOR_BENEFITS, CREATOR_BENEFITS_TITLE } from "@/lib/burnticker/creatorBenefits";

/**
 * WHAT A CREATOR GETS BESIDES THE COIN (website-17, creator benefits item 6): one short list, placed right after the no-fee-revenue line
 * on the templates page and (WIRING-17.md) the launch page. Words: creatorBenefits.ts. No hooks, so a server or a client page can use it.
 */
export function CreatorBenefitsList() {
  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-3 text-sm" aria-label={CREATOR_BENEFITS_TITLE} data-creator-benefits>
      <h2 className="font-medium">{CREATOR_BENEFITS_TITLE}</h2>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-neutral-300">{CREATOR_BENEFITS.map((b) => <li key={b}>{b}</li>)}</ul>
    </section>
  );
}
